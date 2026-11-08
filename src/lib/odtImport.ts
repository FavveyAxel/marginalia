// Documents OpenDocument (.odt : LibreOffice, OpenOffice) → HTML simple, transformé en écrit par
// htmlToDocx (editor/docx.ts) : titres (plan), paragraphes et leur alignement, gras, italique,
// souligné, barré, exposant, listes, citations, tableaux, images, notes de bas de page, sauts de page.
// Tout se passe ici, sur l'ordinateur : le fichier n'est envoyé nulle part.
import JSZip from 'jszip';

const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  dc: 'http://purl.org/dc/elements/1.1/',
};

interface StyleInfo {
  parent: string | null;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  pos?: 'sup' | 'sub';
  align?: string;
  pageBefore?: boolean;
  /** Nom affiché du style (« Quotations », « Title »…), pour les styles nommés. */
  display?: string;
}

const attr = (e: Element, ns: string, name: string) => e.getAttributeNS(ns, name) ?? e.getAttribute(name.includes(':') ? name : '') ?? null;

/** Styles nommés (styles.xml) et automatiques (content.xml, styles.xml). */
function readStyles(docs: Document[]) {
  const styles = new Map<string, StyleInfo>();
  const lists = new Map<string, boolean[]>(); // nom → numéroté ? par niveau (1…10)
  for (const doc of docs) {
    for (const st of Array.from(doc.getElementsByTagNameNS(NS.style, 'style'))) {
      const name = st.getAttributeNS(NS.style, 'name');
      if (!name) continue;
      const info: StyleInfo = { parent: st.getAttributeNS(NS.style, 'parent-style-name'), display: st.getAttributeNS(NS.style, 'display-name') ?? name };
      const tp = st.getElementsByTagNameNS(NS.style, 'text-properties')[0];
      if (tp) {
        const w = tp.getAttributeNS(NS.fo, 'font-weight');
        if (w) info.bold = w === 'bold' || Number(w) >= 600;
        const fs = tp.getAttributeNS(NS.fo, 'font-style');
        if (fs) info.italic = fs === 'italic' || fs === 'oblique';
        const u = tp.getAttributeNS(NS.style, 'text-underline-style');
        if (u) info.underline = u !== 'none';
        const lt = tp.getAttributeNS(NS.style, 'text-line-through-style');
        if (lt) info.strike = lt !== 'none';
        const pos = tp.getAttributeNS(NS.style, 'text-position');
        if (pos) info.pos = /^super|^\d/.test(pos) && !pos.startsWith('-') && !pos.startsWith('0%') ? 'sup' : /^sub|^-/.test(pos) ? 'sub' : undefined;
      }
      const pp = st.getElementsByTagNameNS(NS.style, 'paragraph-properties')[0];
      if (pp) {
        const a = pp.getAttributeNS(NS.fo, 'text-align');
        if (a) info.align = a;
        if (pp.getAttributeNS(NS.fo, 'break-before') === 'page') info.pageBefore = true;
      }
      styles.set(name, info);
    }
    for (const ls of Array.from(doc.getElementsByTagNameNS(NS.text, 'list-style'))) {
      const name = ls.getAttributeNS(NS.style, 'name');
      if (!name) continue;
      const lv: boolean[] = [];
      for (const c of Array.from(ls.children)) {
        const level = Number(c.getAttributeNS(NS.text, 'level') || 1);
        lv[level] = c.localName === 'list-level-style-number';
      }
      lists.set(name, lv);
    }
  }
  /** Propriété d'un style, en remontant ses parents. */
  const get = <K extends keyof StyleInfo>(name: string | null, k: K): StyleInfo[K] | undefined => {
    for (let n = name, guard = 0; n && guard < 20; guard++) {
      const s = styles.get(n);
      if (!s) return undefined;
      if (s[k] !== undefined) return s[k];
      n = s.parent;
    }
    return undefined;
  };
  /** Le style ou un parent porte ce nom affiché (ex. « Quotations », « Citation »). */
  const isA = (name: string | null, re: RegExp) => {
    for (let n = name, guard = 0; n && guard < 20; guard++) {
      const s = styles.get(n);
      if (re.test(n) || (s?.display && re.test(s.display))) return true;
      n = s?.parent ?? null;
    }
    return false;
  };
  return { get, isA, lists };
}

type Styles = ReturnType<typeof readStyles>;

const CM_PX = 96 / 2.54;
function lengthPx(v: string | null): number | null {
  if (!v) return null;
  const m = v.match(/^([\d.]+)(cm|mm|in|pt|px)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Math.round(m[2] === 'cm' ? n * CM_PX : m[2] === 'mm' ? (n / 10) * CM_PX : m[2] === 'in' ? n * 96 : m[2] === 'pt' ? (n * 96) / 72 : n);
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };

function toBase64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface OdtResult {
  html: string;
  title: string | null;
}

/** Convertit un .odt en HTML simple (voir editor/api.ts › CreateDraftOptions.html). */
export async function odtToHtml(data: ArrayBuffer): Promise<OdtResult> {
  const zip = await JSZip.loadAsync(data);
  const read = async (n: string) => (zip.file(n) ? await zip.file(n)!.async('string') : null);
  const contentXml = await read('content.xml');
  if (!contentXml) throw new Error('Fichier .odt invalide (content.xml absent)');
  const parse = (x: string) => new DOMParser().parseFromString(x, 'application/xml');
  const content = parse(contentXml);
  if (content.getElementsByTagName('parsererror').length) throw new Error('Fichier .odt illisible');
  const stylesXml = await read('styles.xml');
  const metaXml = await read('meta.xml');
  const st: Styles = readStyles([...(stylesXml ? [parse(stylesXml)] : []), content]);
  const title = metaXml ? (parse(metaXml).getElementsByTagNameNS(NS.dc, 'title')[0]?.textContent?.trim() ?? null) : null;

  // images : lues dans le paquet (Pictures/…) et intégrées en data: URL
  const images = new Map<string, string>();
  for (const href of Array.from(content.getElementsByTagNameNS(NS.draw, 'image')).map((i) => i.getAttributeNS(NS.xlink, 'href') ?? '')) {
    const ext = href.split('.').pop()?.toLowerCase() ?? '';
    const f = zip.file(href);
    if (!f || !MIME[ext] || images.has(href)) continue;
    images.set(href, `data:${MIME[ext]};base64,${toBase64(await f.async('uint8array'))}`);
  }

  const out = document.implementation.createHTMLDocument('');
  const root = out.createElement('div');

  /** Texte des notes : brut (les notes de bas de page gardent leur texte, pas leur mise en forme). */
  const noteText = (note: Element) => {
    const body = note.getElementsByTagNameNS(NS.text, 'note-body')[0];
    if (!body) return '';
    return Array.from(body.children)
      .map((p) => inlineText(p))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  };
  const inlineText = (e: Element): string => {
    let t = '';
    for (const c of Array.from(e.childNodes)) {
      if (c.nodeType === 3) t += c.textContent;
      else if (c.nodeType === 1) {
        const el = c as Element;
        if (el.localName === 's') t += ' '.repeat(Number(el.getAttributeNS(NS.text, 'c') || 1));
        else if (el.localName === 'tab' || el.localName === 'line-break') t += ' ';
        else if (el.localName !== 'note') t += inlineText(el);
      }
    }
    return t;
  };

  /** Contenu en ligne d'un paragraphe (spans, notes, images…). Renvoie les nœuds HTML. */
  const inline = (e: Element, into: HTMLElement) => {
    for (const c of Array.from(e.childNodes)) {
      if (c.nodeType === 3) {
        into.append(out.createTextNode(c.textContent ?? ''));
        continue;
      }
      if (c.nodeType !== 1) continue;
      const el = c as Element;
      const ln = el.localName;
      if (el.namespaceURI === NS.text) {
        if (ln === 's') into.append(out.createTextNode(' '.repeat(Math.max(0, Number(el.getAttributeNS(NS.text, 'c') || 1) - 1)) + ' '));
        else if (ln === 'tab') into.append(out.createTextNode(' '));
        else if (ln === 'line-break') into.append(out.createElement('br'));
        else if (ln === 'note') {
          if ((el.getAttributeNS(NS.text, 'note-class') || 'footnote') === 'footnote' || true) {
            const sp = out.createElement('span');
            sp.setAttribute('data-footnote', noteText(el));
            into.append(sp);
          }
        } else if (ln === 'span' || ln === 'a') {
          const name = el.getAttributeNS(NS.text, 'style-name');
          let target: HTMLElement = into;
          const wrap = (tag: string) => {
            const w = out.createElement(tag);
            target.append(w);
            target = w;
          };
          if (name) {
            if (st.get(name, 'bold')) wrap('strong');
            if (st.get(name, 'italic')) wrap('em');
            if (st.get(name, 'underline')) wrap('u');
            if (st.get(name, 'strike')) wrap('s');
            const pos = st.get(name, 'pos');
            if (pos) wrap(pos);
          }
          inline(el, target);
        } else if (ln === 'soft-page-break' || ln === 'bookmark' || ln === 'bookmark-start' || ln === 'bookmark-end' || ln === 'reference-mark' || ln === 'change' || ln === 'change-start' || ln === 'change-end') {
          /* sans contenu */
        } else inline(el, into);
      } else if (el.namespaceURI === NS.draw && ln === 'frame') {
        frame(el, into);
      } else if (el.namespaceURI === NS.draw && ln === 'a') inline(el, into);
    }
  };

  /** Cadre : image (dans le paragraphe), ou zone de texte (ses paragraphes). */
  const frame = (f: Element, into: HTMLElement) => {
    const img = f.getElementsByTagNameNS(NS.draw, 'image')[0];
    if (img) {
      const src = images.get(img.getAttributeNS(NS.xlink, 'href') ?? '');
      if (!src) return;
      const i = out.createElement('img');
      i.src = src;
      const w = lengthPx(f.getAttributeNS(NS.svg, 'width'));
      const h = lengthPx(f.getAttributeNS(NS.svg, 'height'));
      if (w) i.setAttribute('width', String(w));
      if (h) i.setAttribute('height', String(h));
      const alt = f.getElementsByTagNameNS(NS.svg, 'title')[0]?.textContent ?? f.getAttributeNS(NS.draw, 'name') ?? '';
      i.alt = alt;
      into.append(i);
      return;
    }
    const box = f.getElementsByTagNameNS(NS.draw, 'text-box')[0];
    if (box) for (const c of Array.from(box.children)) inline(c, into);
  };

  const para = (e: Element, parent: HTMLElement, quote: boolean) => {
    const name = e.getAttributeNS(NS.text, 'style-name');
    if (st.get(name, 'pageBefore') && parent.childNodes.length) {
      const br = out.createElement('p');
      br.dataset.break = 'page';
      parent.append(br);
    }
    let tag = 'p';
    if (e.localName === 'h') {
      const lvl = Math.min(6, Math.max(1, Number(e.getAttributeNS(NS.text, 'outline-level') || 1)));
      tag = `h${lvl}`;
    } else if (st.isA(name, /^(Title|Titre)$/i)) tag = 'h1';
    else if (st.isA(name, /^(Subtitle|Sous-titre)$/i)) tag = 'h2';
    const p = out.createElement(tag);
    const align = st.get(name, 'align');
    if (align && align !== 'start' && align !== 'left') p.dataset.align = align === 'end' ? 'right' : align;
    // style du paragraphe en gras/italique : appliqué à tout son texte
    let target: HTMLElement = p;
    if (tag === 'p') {
      if (st.get(name, 'bold')) {
        const b = out.createElement('strong');
        p.append(b);
        target = b;
      }
      if (st.get(name, 'italic')) {
        const i = out.createElement('em');
        target.append(i);
        target = i;
      }
    }
    inline(e, target);
    if (!quote && tag === 'p' && st.isA(name, /^(Quotations|Citation|Citations|Quote)$/i)) {
      const bq = out.createElement('blockquote');
      bq.append(p);
      parent.append(bq);
    } else parent.append(p);
  };

  const list = (e: Element, parent: HTMLElement, level: number, styleName: string | null) => {
    const name = e.getAttributeNS(NS.text, 'style-name') ?? styleName;
    const ordered = !!(name && st.lists.get(name)?.[level]);
    const l = out.createElement(ordered ? 'ol' : 'ul');
    for (const item of Array.from(e.children)) {
      if (item.localName !== 'list-item' && item.localName !== 'list-header') continue;
      const li = out.createElement('li');
      for (const c of Array.from(item.children)) {
        if (c.localName === 'list') list(c, li, level + 1, name);
        else if (c.localName === 'p' || c.localName === 'h') {
          const tmp = out.createElement('p');
          inline(c, tmp);
          if (li.childNodes.length && !(li.lastChild as HTMLElement)?.tagName?.match(/^(UL|OL)$/)) li.append(out.createElement('br'));
          li.append(...Array.from(tmp.childNodes));
        }
      }
      l.append(li);
    }
    parent.append(l);
  };

  const table = (e: Element, parent: HTMLElement) => {
    const t = out.createElement('table');
    const rows: Element[] = [];
    const collect = (n: Element) => {
      for (const c of Array.from(n.children)) {
        if (c.localName === 'table-row') rows.push(c);
        else if (c.localName === 'table-header-rows' || c.localName === 'table-rows' || c.localName === 'table-row-group') collect(c);
      }
    };
    collect(e);
    const headerRows = new Set(Array.from(e.getElementsByTagNameNS(NS.table, 'table-header-rows')).flatMap((h) => Array.from(h.children)));
    for (const r of rows) {
      const tr = out.createElement('tr');
      for (const c of Array.from(r.children)) {
        if (c.localName !== 'table-cell') continue; // cellules couvertes (fusion) : ignorées
        const td = out.createElement(headerRows.has(r) ? 'th' : 'td');
        blocks(c, td, false);
        tr.append(td);
      }
      t.append(tr);
    }
    parent.append(t);
  };

  const blocks = (container: Element, parent: HTMLElement, quote: boolean) => {
    for (const c of Array.from(container.children)) {
      const ln = c.localName;
      if (c.namespaceURI === NS.text) {
        if (ln === 'p' || ln === 'h') para(c, parent, quote);
        else if (ln === 'list') list(c, parent, 1, null);
        else if (ln === 'section' || ln === 'index-body') blocks(c, parent, quote);
        else if (ln === 'table-of-content' || ln === 'alphabetical-index' || ln === 'bibliography' || ln === 'illustration-index' || ln === 'sequence-decls' || ln === 'variable-decls' || ln === 'tracked-changes') {
          /* tables générées et déclarations : l'éditeur a les siennes */
        } else blocks(c, parent, quote);
      } else if (c.namespaceURI === NS.table && ln === 'table') table(c, parent);
      else if (c.namespaceURI === NS.draw && ln === 'frame') {
        const p = out.createElement('p');
        frame(c, p);
        if (p.childNodes.length) parent.append(p);
      }
    }
  };

  const body = content.getElementsByTagNameNS(NS.office, 'text')[0];
  if (!body) throw new Error('Ce fichier .odt ne contient pas de texte (tableur ou présentation ?)');
  blocks(body, root, false);
  return { html: root.innerHTML, title: title || null };
}
