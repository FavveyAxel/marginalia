// Parseurs du moteur HTML : EPUB (JSZip), DOCX (mammoth), Markdown (marked), HTML, TXT.
// Sortie commune : des chapitres assainis (DOMPurify) et canonisés (espaces, séparateurs
// de blocs) dont le textContent sert de référence aux ancrages.
import DOMPurify from 'dompurify';
import type { Book, TocItem } from '../../../lib/types';
import { isBlockEl, offsetOf } from './anchoring';
import { looksBinary } from '../../../lib/sniff';

export interface Chapter {
  /** Conteneur détaché (.html-chapter-text) prêt à être inséré. */
  el: HTMLElement;
  /** textContent canonique (référence des offsets). */
  text: string;
  label: string;
  /** Chemin de la ressource d'origine (EPUB) pour la réécriture des liens. */
  path: string;
}

export interface PageMark {
  chapter: number;
  offset: number;
  label: string;
}

export interface ParsedDoc {
  chapters: Chapter[];
  toc: TocItem[];
  /** Page-list EPUB triée (vide si absente). */
  pages: PageMark[];
  /** Blob URLs à révoquer au démontage. */
  urls: string[];
  lang: string;
}

/** Erreur à montrer telle quelle (en français). */
export class ReaderError extends Error {}

export const DRM_MESSAGE =
  'Ce livre est protégé par un DRM (verrou numérique) : Marginalia ne peut pas l’ouvrir. Importez une version sans DRM du même texte (EPUB libre ou vendu sans verrou).';

/** Taille cible d'une partie de TXT très long. */
export const TXT_PART = 40000;

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const OPS_NS = 'http://www.idpf.org/2007/ops';

// ── Utilitaires ──────────────────────────────────────────────

const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function decodeText(data: ArrayBuffer, charset = 'utf-8'): string {
  try {
    return new TextDecoder(charset, { fatal: true }).decode(data);
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(data);
    } catch {
      return new TextDecoder().decode(data);
    }
  }
}

function sniffCharset(data: ArrayBuffer): string {
  const head = new TextDecoder('ascii').decode(data.slice(0, 4096));
  const m = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head);
  if (!m) return 'utf-8';
  try {
    new TextDecoder(m[1]);
    return m[1];
  } catch {
    return 'utf-8';
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseXml(src: string, type: DOMParserSupportedType = 'application/xhtml+xml'): Document {
  const p = new DOMParser();
  const doc = p.parseFromString(src, type);
  if (type !== 'text/html' && doc.getElementsByTagName('parsererror').length) {
    return p.parseFromString(src, 'text/html');
  }
  return doc;
}

function bodyOf(doc: Document): Element {
  return doc.body ?? doc.getElementsByTagNameNS(XHTML_NS, 'body')[0] ?? doc.getElementsByTagName('body')[0] ?? doc.documentElement;
}

/** Résout un chemin relatif (href EPUB) par rapport au fichier `base`. */
export function resolvePath(base: string, href: string): { path: string; frag: string } {
  const hashAt = href.indexOf('#');
  let rel = hashAt >= 0 ? href.slice(0, hashAt) : href;
  let frag = hashAt >= 0 ? href.slice(hashAt + 1) : '';
  const q = rel.indexOf('?');
  if (q >= 0) rel = rel.slice(0, q);
  try {
    rel = decodeURIComponent(rel);
  } catch {
    /* garder tel quel */
  }
  try {
    frag = decodeURIComponent(frag);
  } catch {
    /* garder tel quel */
  }
  if (!rel) return { path: base, frag };
  const parts = rel.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return { path: parts.join('/'), frag };
}

const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href);

// ── Préparation de la source (document inerte) puis assainissement ─────────

interface PrepareCtx {
  /** Chemin du document source (EPUB) ; '' pour les documents uniques. */
  path: string;
  /** EPUB : les images sont résolues dans l'archive. */
  epub: boolean;
}

/**
 * Travail sur le document inerte (DOMParser) AVANT DOMPurify :
 * attributs data-* de l'éditeur retirés, id → data-fid (unicité par instance),
 * liens et images réécrits en attributs data-* (aucune navigation possible).
 */
function prepareSource(root: Element, ctx: PrepareCtx) {
  root.querySelectorAll('[hidden], script, style, link, template, noscript').forEach((el) => el.remove());
  // SVG de couverture (image unique) → <img>
  root.querySelectorAll('svg').forEach((svg) => {
    const img = svg.querySelector('image');
    if (!img || svg.querySelector('text')) return;
    const href = img.getAttribute('href') ?? img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? img.getAttribute('xlink:href');
    if (!href) return;
    const doc = svg.ownerDocument;
    const el = doc.createElementNS(XHTML_NS, 'img');
    el.setAttribute('src', href);
    el.setAttribute('alt', '');
    svg.replaceWith(el);
  });
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-')) el.removeAttribute(attr.name);
    }
    const id = el.getAttribute('id') ?? (el.localName === 'a' ? el.getAttribute('name') : null);
    if (id) el.setAttribute('data-fid', id);
    el.removeAttribute('id');
    const epubType = el.getAttributeNS(OPS_NS, 'type') ?? el.getAttribute('epub:type');
    if (epubType && /\bpagebreak\b/.test(epubType)) el.setAttribute('data-pagebreak', el.getAttribute('title') ?? squash(el.textContent));
    if (el.localName === 'a') {
      const href = el.getAttribute('href');
      el.removeAttribute('href');
      if (href) {
        if (isExternal(href)) {
          if (!/^javascript:/i.test(href)) el.setAttribute('data-ext', href);
        } else {
          const r = ctx.path ? resolvePath(ctx.path, href) : { path: '', frag: href.replace(/^#/, '') };
          el.setAttribute('data-link-path', r.path);
          if (r.frag) el.setAttribute('data-link-frag', r.frag);
        }
      }
    }
    if (el.localName === 'img') {
      const src = el.getAttribute('src') ?? '';
      el.removeAttribute('srcset');
      if (ctx.epub) {
        el.removeAttribute('src');
        if (src && !isExternal(src)) el.setAttribute('data-res', resolvePath(ctx.path, src).path);
      } else if (!/^(data:image\/|https?:|blob:)/i.test(src)) {
        // Chemin relatif d'un fichier isolé : introuvable, on retire l'image.
        el.remove();
      }
    }
  }
}

const PURIFY_CFG = {
  RETURN_DOM_FRAGMENT: true as const,
  FORBID_TAGS: ['style', 'link', 'meta', 'base', 'form', 'input', 'button', 'select', 'textarea', 'iframe', 'object', 'embed', 'video', 'audio', 'source', 'track', 'canvas', 'noscript', 'template', 'font', 'center'],
  FORBID_ATTR: ['style', 'class', 'id', 'name', 'width', 'height', 'align', 'valign', 'bgcolor', 'color', 'face', 'size', 'border', 'tabindex', 'target', 'srcset', 'background', 'contenteditable'],
  ALLOW_DATA_ATTR: true,
};

function sanitize(root: Element): HTMLElement {
  const frag = DOMPurify.sanitize(root, PURIFY_CFG);
  const div = document.createElement('div');
  div.appendChild(frag);
  // Liens : classe d'affichage (les href ont été retirés).
  div.querySelectorAll('a[data-link-path], a[data-link-frag]').forEach((a) => a.classList.add('html-link'));
  div.querySelectorAll('a[data-ext]').forEach((a) => {
    a.classList.add('html-link', 'html-link-ext');
    a.setAttribute('title', a.getAttribute('data-ext') ?? '');
  });
  return div;
}

// ── Canonisation : la forme finale du texte, donc des offsets ─────────────

function insidePre(n: Node, stop: Node): boolean {
  for (let p = n.parentNode; p && p !== stop; p = p.parentNode) {
    if (p.nodeType === 1 && /^(PRE|TEXTAREA)$/i.test((p as Element).tagName)) return true;
  }
  return false;
}

/**
 * Espaces fusionnées, blancs inter-blocs supprimés, un « \n » entre blocs voisins et après <br>.
 * Rend le textContent lisible (citations propres) et stable d'une ouverture à l'autre.
 */
export function canonicalize(root: HTMLElement) {
  // Sections CDATA (XHTML) → texte ordinaire : textContent les compte mais les parcours
  // SHOW_TEXT les ignoreraient, ce qui décalerait tous les offsets suivants.
  const cdata: Node[] = [];
  const wc = document.createTreeWalker(root, NodeFilter.SHOW_CDATA_SECTION);
  while (wc.nextNode()) cdata.push(wc.currentNode);
  for (const c of cdata) c.parentNode?.replaceChild(document.createTextNode(c.nodeValue ?? ''), c);
  root.normalize();
  const texts: Text[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = w.nextNode())) texts.push(n as Text);
  for (const t of texts) {
    if (insidePre(t, root)) continue;
    t.data = t.data.replace(/[ \t\n\r\f]+/g, ' ');
  }
  for (const t of texts) {
    if (insidePre(t, root)) continue;
    const parent = t.parentNode;
    const blockCtx = parent === root || isBlockEl(parent);
    if (!blockCtx) continue;
    const prev = t.previousSibling;
    const next = t.nextSibling;
    const atStart = !prev || isBlockEl(prev) || (prev.nodeType === 1 && (prev as Element).tagName === 'BR');
    const atEnd = !next || isBlockEl(next);
    if (atStart) t.data = t.data.replace(/^ +/, '');
    if (atEnd) t.data = t.data.replace(/ +$/, '');
    if (!t.data) t.remove();
  }
  const blocks = Array.from(root.querySelectorAll('*')).filter((el) => isBlockEl(el) || el.tagName === 'BR');
  for (const el of blocks) {
    if (insidePre(el, root) || el.tagName === 'PRE') {
      if (el.tagName !== 'PRE') continue;
    }
    const parent = el.parentNode;
    if (!parent) continue;
    if (el.tagName !== 'BR') {
      const prev = el.previousSibling;
      if (prev && !(prev.nodeType === 3 && (prev as Text).data.endsWith('\n'))) parent.insertBefore(document.createTextNode('\n'), el);
    }
    const next = el.nextSibling;
    if (next && !(next.nodeType === 3 && (next as Text).data.startsWith('\n'))) parent.insertBefore(document.createTextNode('\n'), next);
  }
  root.normalize();
}

function makeChapterEl(content: Node[] | DocumentFragment): HTMLElement {
  const el = document.createElement('div');
  el.className = 'html-chapter-text';
  if (content instanceof DocumentFragment) el.appendChild(content);
  else for (const c of content) el.appendChild(c);
  canonicalize(el);
  return el;
}

const hasContent = (el: HTMLElement) => /\S/.test(el.textContent ?? '') || !!el.querySelector('img, hr, table');

// ── Découpage aux titres (documents uniques) ─────────────────

const UNWRAPPABLE = /^(DIV|SECTION|ARTICLE|MAIN|HEADER|FOOTER|NAV|ASIDE|HGROUP|BODY|SPAN)$/;

/** Fait remonter les titres de découpe au premier niveau (déballe section, div…). */
function hoistHeadings(root: HTMLElement, tag: string) {
  for (let guard = 0; guard < 10000; guard++) {
    const h = Array.from(root.querySelectorAll(tag)).find((x) => x.parentNode !== root && canHoist(x, root));
    if (!h) return;
    let top: Node = h;
    while (top.parentNode && top.parentNode !== root) top = top.parentNode;
    const el = top as Element;
    while (el.firstChild) root.insertBefore(el.firstChild, el);
    el.remove();
  }
}

function canHoist(h: Element, root: Element): boolean {
  for (let p = h.parentElement; p && p !== root; p = p.parentElement) if (!UNWRAPPABLE.test(p.tagName)) return false;
  return true;
}

function headingLabel(el: Element | null): string {
  return squash(el?.textContent).slice(0, 120);
}

function splitAtHeadings(root: HTMLElement, fallbackLabel: string): { el: HTMLElement; label: string }[] {
  const tag = root.querySelector('h1') ? 'H1' : root.querySelector('h2') ? 'H2' : null;
  if (!tag) {
    const el = makeChapterEl(Array.from(root.childNodes));
    return [{ el, label: headingLabel(el.querySelector('h1, h2, h3')) || fallbackLabel }];
  }
  hoistHeadings(root, tag.toLowerCase());
  const chunks: Node[][] = [[]];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 1 && (node as Element).tagName === tag && chunks[chunks.length - 1].length) chunks.push([]);
    chunks[chunks.length - 1].push(node);
  }
  const out: { el: HTMLElement; label: string }[] = [];
  for (const nodes of chunks) {
    const el = makeChapterEl(nodes);
    if (!hasContent(el)) continue;
    const first = el.firstElementChild;
    const label = first && first.tagName === tag ? headingLabel(first) : headingLabel(el.querySelector('h1, h2, h3')) || fallbackLabel;
    out.push({ el, label: label || fallbackLabel });
  }
  return out;
}

// ── TOC depuis les titres ────────────────────────────────────

function tocFromHeadings(chapters: Chapter[]): TocItem[] {
  const items: { label: string; level: number; chapter: number; fragment: string }[] = [];
  chapters.forEach((ch, i) => {
    let n = 0;
    ch.el.querySelectorAll('h1, h2, h3').forEach((h) => {
      const label = headingLabel(h);
      if (!label) return;
      let fid = h.getAttribute('data-fid');
      if (!fid) {
        fid = `mg-h-${i}-${n}`;
        h.setAttribute('data-fid', fid);
      }
      n++;
      items.push({ label, level: Number(h.tagName[1]), chapter: i, fragment: fid });
    });
  });
  const min = Math.min(...items.map((x) => x.level), 9);
  return items.map((x, k) => ({ id: `toc-${k}`, label: x.label, depth: x.level - min, target: { kind: 'html', chapter: x.chapter, fragment: x.fragment } }));
}

function finishSingle(parts: { el: HTMLElement; label: string }[], lang: string): ParsedDoc {
  const chapters: Chapter[] = parts.map((p) => ({ el: p.el, label: p.label, text: p.el.textContent ?? '', path: '' }));
  if (!chapters.length || !chapters.some((c) => hasContent(c.el))) throw new ReaderError('Ce document ne contient aucun texte lisible.');
  return { chapters, toc: tocFromHeadings(chapters), pages: [], urls: [], lang };
}

function fromHtmlString(html: string, book: Book): ParsedDoc {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lang = doc.documentElement.getAttribute('lang') ?? '';
  const body = bodyOf(doc);
  prepareSource(body, { path: '', epub: false });
  const root = sanitize(body);
  return finishSingle(splitAtHeadings(root, book.title || 'Document'), lang);
}

// ── TXT ──────────────────────────────────────────────────────

function looksLikeHeading(block: string, i: number, total: number): boolean {
  if (total < 2 || block.includes('\n')) return false;
  const s = block.trim();
  if (s.length < 2 || s.length > 70) return false;
  if (/[.,;:!?…»"')\]\-–—]$/.test(s)) return false;
  return /^[\p{Lu}\d§IVXLC]/u.test(s) && /\p{L}/u.test(s) && i < total - 1;
}

function fromTxt(data: ArrayBuffer, book: Book): ParsedDoc {
  const raw = decodeText(data).replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  let blocks = raw.split(/\n[ \t]*\n+/).map((b) => b.replace(/^\n+|\n+$/g, '')).filter((b) => b.trim());
  const lines = raw.split('\n').filter((l) => l.trim()).length;
  if (blocks.length <= 1 && lines > 1) blocks = raw.split('\n').filter((l) => l.trim());
  const html = blocks.map((b, i) => {
    if (looksLikeHeading(b, i, blocks.length)) return { len: b.length, html: `<h2>${escapeHtml(b.trim())}</h2>` };
    const ls = b.split('\n').map((l) => l.trim()).filter(Boolean);
    const verse = ls.length >= 2 && ls.every((l) => l.length < 50);
    return { len: b.length, html: `<p>${ls.map(escapeHtml).join(verse ? '<br>' : ' ')}</p>` };
  });
  // Parties d'environ TXT_PART caractères, coupées entre deux paragraphes.
  const groups: string[][] = [[]];
  let size = 0;
  for (const b of html) {
    if (size >= TXT_PART && groups[groups.length - 1].length) {
      groups.push([]);
      size = 0;
    }
    groups[groups.length - 1].push(b.html);
    size += b.len;
  }
  const parts = groups.map((g, i) => {
    const doc = new DOMParser().parseFromString(`<body>${g.join('\n')}</body>`, 'text/html');
    const el = makeChapterEl(Array.from(sanitize(bodyOf(doc)).childNodes));
    const label = groups.length === 1 ? book.title || 'Texte' : headingLabel(el.querySelector('h2')) || `Partie ${i + 1}`;
    return { el, label };
  });
  return finishSingle(parts, '');
}

// ── Markdown ─────────────────────────────────────────────────

export function stripFrontMatter(src: string): string {
  return src.replace(/^﻿?(---|\+\+\+)[ \t]*\r?\n[\s\S]*?\r?\n(---|\.\.\.|\+\+\+)[ \t]*(\r?\n|$)/, '');
}

async function fromMarkdown(data: ArrayBuffer, book: Book): Promise<ParsedDoc> {
  const { marked } = await import('marked');
  const src = stripFrontMatter(decodeText(data));
  const html = (await marked.parse(src, { async: false, gfm: true })) as string;
  return fromHtmlString(html, book);
}

// ── DOCX ─────────────────────────────────────────────────────

async function fromDocx(data: ArrayBuffer, book: Book): Promise<ParsedDoc> {
  const mod: any = await import('mammoth');
  const mammoth = mod.convertToHtml ? mod : mod.default;
  let res: { value: string };
  try {
    res = await mammoth.convertToHtml(
      { arrayBuffer: data },
      {
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Titre'] => h1:fresh",
          "p[style-name='Block Text'] => blockquote > p:fresh",
          "p[style-name='Quote'] => blockquote > p:fresh",
          "p[style-name='Citation'] => blockquote > p:fresh",
        ],
      },
    );
  } catch (e) {
    throw new ReaderError('Ce fichier Word est illisible (DOCX endommagé ou protégé par mot de passe).');
  }
  return fromHtmlString(res.value, book);
}

// ── HTML ─────────────────────────────────────────────────────

function fromHtml(data: ArrayBuffer, book: Book): ParsedDoc {
  return fromHtmlString(decodeText(data, sniffCharset(data)), book);
}

// ── EPUB ─────────────────────────────────────────────────────

interface ManifestItem {
  id: string;
  path: string;
  type: string;
  props: string;
}

function attrNS(el: Element, ns: string, name: string): string | null {
  return el.getAttributeNS(ns, name) ?? el.getAttribute(`epub:${name}`);
}

async function fromEpub(data: ArrayBuffer, book: Book): Promise<ParsedDoc> {
  const { default: JSZip } = await import('jszip');
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new ReaderError('Ce fichier EPUB est illisible (archive endommagée).');
  }
  const file = (p: string) => zip.file(p) ?? zip.file(decodeURI(p)) ?? null;
  const readText = async (p: string) => {
    const f = file(p);
    if (!f) return null;
    return decodeText(await f.async('arraybuffer'));
  };

  // DRM : Adobe ADEPT (rights.xml), Apple FairPlay (sinf.xml), Readium LCP (license.lcpl),
  // ou toute ressource chiffrée autrement que par l'obfuscation de polices.
  if (file('META-INF/rights.xml') || file('META-INF/sinf.xml') || file('META-INF/license.lcpl')) throw new ReaderError(DRM_MESSAGE);
  const encXml = await readText('META-INF/encryption.xml');
  if (encXml) {
    const enc = parseXml(encXml, 'application/xml');
    const fontObf = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);
    for (const ed of Array.from(enc.getElementsByTagNameNS('*', 'EncryptedData'))) {
      const alg = ed.getElementsByTagNameNS('*', 'EncryptionMethod')[0]?.getAttribute('Algorithm') ?? '';
      if (!fontObf.has(alg)) throw new ReaderError(DRM_MESSAGE);
    }
  }

  const containerXml = await readText('META-INF/container.xml');
  if (!containerXml) throw new ReaderError('Ce fichier EPUB est illisible : META-INF/container.xml est introuvable.');
  const container = parseXml(containerXml, 'application/xml');
  const opfPath = container.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  const opfXml = opfPath ? await readText(opfPath) : null;
  if (!opfPath || !opfXml) throw new ReaderError('Ce fichier EPUB est illisible : le fichier OPF est introuvable.');
  const opf = parseXml(opfXml, 'application/xml');
  const lang = squash(opf.getElementsByTagNameNS('*', 'language')[0]?.textContent);

  const manifest = new Map<string, ManifestItem>();
  for (const it of Array.from(opf.getElementsByTagNameNS('*', 'item'))) {
    const id = it.getAttribute('id') ?? '';
    const href = it.getAttribute('href') ?? '';
    manifest.set(id, { id, path: resolvePath(opfPath, href).path, type: it.getAttribute('media-type') ?? '', props: it.getAttribute('properties') ?? '' });
  }
  const byPath = new Map<string, ManifestItem>();
  manifest.forEach((m) => byPath.set(m.path, m));
  const navItem = Array.from(manifest.values()).find((m) => /\bnav\b/.test(m.props)) ?? null;
  const spineEl = opf.getElementsByTagNameNS('*', 'spine')[0];
  const ncxItem = (spineEl?.getAttribute('toc') && manifest.get(spineEl.getAttribute('toc')!)) || Array.from(manifest.values()).find((m) => m.type === 'application/x-dtbncx+xml') || null;

  // Spine : documents linéaires, hors document de navigation (le sommaire est dans l'app).
  const spine: ManifestItem[] = [];
  for (const ref of Array.from(opf.getElementsByTagNameNS('*', 'itemref'))) {
    if (ref.getAttribute('linear') === 'no') continue;
    const m = manifest.get(ref.getAttribute('idref') ?? '');
    if (!m || (navItem && m.id === navItem.id)) continue;
    if (!/x?html|xml/.test(m.type)) continue;
    spine.push(m);
  }
  if (!spine.length) throw new ReaderError('Ce fichier EPUB ne contient aucun chapitre lisible.');

  const chapters: Chapter[] = [];
  for (const m of spine) {
    const src = await readText(m.path);
    if (src == null) continue;
    const doc = parseXml(src, m.type.includes('html') && !m.type.includes('xhtml') ? 'text/html' : 'application/xhtml+xml');
    const body = bodyOf(doc);
    prepareSource(body, { path: m.path, epub: true });
    const root = sanitize(body);
    const el = makeChapterEl(Array.from(root.childNodes));
    if (!hasContent(el)) continue;
    chapters.push({ el, text: el.textContent ?? '', label: '', path: m.path });
  }
  if (!chapters.length) throw new ReaderError('Ce fichier EPUB ne contient aucun texte lisible.');
  const chapterOf = new Map<string, number>();
  chapters.forEach((c, i) => chapterOf.set(c.path, i));

  // Images → blob URLs
  const urls: string[] = [];
  const blobFor = new Map<string, string>();
  for (const c of chapters) {
    for (const img of Array.from(c.el.querySelectorAll('img[data-res]'))) {
      const p = img.getAttribute('data-res')!;
      let url = blobFor.get(p);
      if (url === undefined) {
        const f = file(p);
        if (f) {
          const bytes = await f.async('arraybuffer');
          const type = byPath.get(p)?.type || (p.endsWith('.svg') ? 'image/svg+xml' : '');
          url = URL.createObjectURL(new Blob([bytes], { type }));
          urls.push(url);
        } else url = '';
        blobFor.set(p, url);
      }
      if (url) img.setAttribute('src', url);
      else img.remove();
    }
  }

  // TOC et page-list : nav EPUB 3, sinon NCX.
  type Entry = { label: string; depth: number; path: string; frag: string };
  let tocEntries: Entry[] = [];
  let pageEntries: Entry[] = [];
  if (navItem) {
    const navSrc = await readText(navItem.path);
    if (navSrc) {
      const nav = parseXml(navSrc);
      const walk = (ol: Element, depth: number, out: Entry[]) => {
        for (const li of Array.from(ol.children).filter((x) => x.localName === 'li')) {
          const a = Array.from(li.children).find((x) => x.localName === 'a' || x.localName === 'span');
          if (a) {
            const href = a.getAttribute('href');
            const label = squash(a.textContent);
            if (href && label) out.push({ label, depth, ...resolvePath(navItem.path, href) });
          }
          const sub = Array.from(li.children).find((x) => x.localName === 'ol');
          if (sub) walk(sub, depth + 1, out);
        }
      };
      for (const navEl of Array.from(nav.getElementsByTagNameNS('*', 'nav'))) {
        const type = attrNS(navEl, OPS_NS, 'type') ?? '';
        const ol = Array.from(navEl.children).find((x) => x.localName === 'ol');
        if (!ol) continue;
        if (/\btoc\b/.test(type)) walk(ol, 0, tocEntries);
        else if (/\bpage-list\b/.test(type)) walk(ol, 0, pageEntries);
      }
    }
  }
  if ((!tocEntries.length || !pageEntries.length) && ncxItem) {
    const ncxSrc = await readText(ncxItem.path);
    if (ncxSrc) {
      const ncx = parseXml(ncxSrc, 'application/xml');
      const labelOf = (el: Element) => squash(Array.from(el.children).find((x) => x.localName === 'navLabel')?.textContent);
      const srcOf = (el: Element) => Array.from(el.children).find((x) => x.localName === 'content')?.getAttribute('src') ?? '';
      if (!tocEntries.length) {
        const walk = (parent: Element, depth: number) => {
          for (const np of Array.from(parent.children).filter((x) => x.localName === 'navPoint')) {
            const label = labelOf(np);
            const src = srcOf(np);
            if (label && src) tocEntries.push({ label, depth, ...resolvePath(ncxItem.path, src) });
            walk(np, depth + 1);
          }
        };
        const navMap = ncx.getElementsByTagNameNS('*', 'navMap')[0];
        if (navMap) walk(navMap, 0);
      }
      if (!pageEntries.length) {
        for (const pt of Array.from(ncx.getElementsByTagNameNS('*', 'pageTarget'))) {
          const label = labelOf(pt) || pt.getAttribute('value') || '';
          const src = srcOf(pt);
          if (label && src) pageEntries.push({ label, depth: 0, ...resolvePath(ncxItem.path, src) });
        }
      }
    }
  }

  const toc: TocItem[] = [];
  tocEntries.forEach((e) => {
    const chapter = chapterOf.get(e.path);
    if (chapter === undefined) return;
    toc.push({ id: `toc-${toc.length}`, label: e.label, depth: e.depth, target: { kind: 'html', chapter, ...(e.frag ? { fragment: e.frag } : {}) } });
  });
  const minDepth = Math.min(...toc.map((t) => t.depth), 0);
  toc.forEach((t) => (t.depth -= minDepth));

  // Libellés de chapitres : entrée du sommaire, sinon premier titre.
  chapters.forEach((c, i) => {
    const entries = toc.filter((t) => t.target.kind === 'html' && t.target.chapter === i);
    const whole = entries.find((t) => t.target.kind === 'html' && !t.target.fragment);
    c.label =
      (whole ?? entries[0])?.label ||
      headingLabel(c.el.querySelector('h1, h2, h3')) ||
      (/\S/.test(c.text) ? squash(c.text).slice(0, 60) : i === 0 ? 'Couverture' : `Section ${i + 1}`);
  });

  const pages: PageMark[] = [];
  for (const e of pageEntries) {
    const chapter = chapterOf.get(e.path);
    if (chapter === undefined) continue;
    const root = chapters[chapter].el;
    let offset = 0;
    if (e.frag) {
      const target = root.querySelector(`[data-fid="${CSS.escape(e.frag)}"]`);
      if (!target) continue;
      offset = offsetOf(root, target, 0);
    }
    pages.push({ chapter, offset, label: e.label });
  }
  pages.sort((a, b) => a.chapter - b.chapter || a.offset - b.offset);

  return { chapters, toc: toc.length ? toc : tocFromHeadings(chapters), pages, urls, lang };
}

// ── Accès bas niveau pour la synchro avec Livres (CFI → offsets) ──

/** Analyse un document du spine exactement comme le lecteur. */
export function parseSpineDoc(src: string, mediaType: string): Document {
  return parseXml(src, mediaType.includes('html') && !mediaType.includes('xhtml') ? 'text/html' : 'application/xhtml+xml');
}

/**
 * textContent canonique du corps d'un document EPUB, obtenu par les mêmes étapes que le lecteur
 * (préparation, assainissement, canonisation). Le document est modifié : passer une copie.
 */
export function canonicalBodyText(doc: Document, path: string): string {
  const body = bodyOf(doc);
  prepareSource(body, { path, epub: true });
  const root = sanitize(body);
  return makeChapterEl(Array.from(root.childNodes)).textContent ?? '';
}

// ── Point d'entrée ───────────────────────────────────────────

export async function parseBook(book: Book, data: ArrayBuffer): Promise<ParsedDoc> {
  switch (book.format) {
    case 'epub':
      return fromEpub(data, book);
    case 'docx':
      return fromDocx(data, book);
    case 'md':
      return fromMarkdown(data, book);
    case 'txt':
      // Un fichier binaire (photo mal reconnue…) ne doit pas être affiché comme un texte : des
      // mégaoctets de caractères illisibles figeaient ou faisaient planter la fenêtre.
      if (looksBinary(data)) throw new ReaderError('Ce fichier n’est pas un texte lisible.');
      return fromTxt(data, book);
    case 'html':
      return fromHtml(data, book);
    default:
      throw new ReaderError('Format non pris en charge par le lecteur de texte.');
  }
}

/** Page imprimée (page-list EPUB) couvrant un offset ; '' si aucune. */
export function printedPageAt(pages: PageMark[], chapter: number, offset: number): string {
  let label = '';
  for (const p of pages) {
    if (p.chapter < chapter || (p.chapter === chapter && p.offset <= offset)) label = p.label;
    else break;
  }
  return label;
}
