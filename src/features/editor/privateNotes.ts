// Notes privées de l'auteur : paragraphes de style « MarginaliaNotePrivee », visibles dans
// l'éditeur (fond teinté, filet à gauche), JAMAIS exportés.
//
// Tous les chemins de sortie (Word, PDF, Markdown, page web, texte, fichier d'origine,
// export de l'original, texte de secours, copie vers le presse-papiers) passent par
// `stripForExport` (paquet .docx), par `parseDocx` (qui saute ces paragraphes), par
// `engine.plainText({ privateNotes: false })` (texte brut) ou par `stripClipboard`.
// Le .docx stocké dans la bibliothèque garde les notes.
//
// Le même nettoyage retire les signets techniques des citations (`_mglHl_…`, lien
// citation → extrait) : ils n'ont pas de sens hors de Marginalia.
import JSZip from 'jszip';

export const PRIVATE_STYLE_ID = 'MarginaliaNotePrivee';
/** Préfixe des signets qui relient une citation à son extrait (Highlight). */
export const CITE_BOOKMARK_PREFIX = '_mglHl_';

export const PRIVATE_STYLE_DEF =
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${PRIVATE_STYLE_ID}"><w:name w:val="Note privée (Marginalia)"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="99"/><w:qFormat/>` +
  `<w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="D9A400"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="FFF3C4"/><w:spacing w:before="60" w:after="120" w:line="276" w:lineRule="auto"/><w:ind w:left="170" w:right="170" w:firstLine="0"/><w:jc w:val="left"/></w:pPr>` +
  `<w:rPr><w:i/><w:iCs/><w:color w:val="6B5310"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>`;

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Le paragraphe XML est-il une note privée ? */
function isPrivatePara(p: Element): boolean {
  for (const c of Array.from(p.children)) {
    if (c.localName !== 'pPr' || c.namespaceURI !== W_NS) continue;
    for (const s of Array.from(c.children)) {
      if (s.localName === 'pStyle' && s.namespaceURI === W_NS) {
        const v = s.getAttributeNS(W_NS, 'val') ?? s.getAttribute('w:val');
        return v === PRIVATE_STYLE_ID;
      }
    }
  }
  return false;
}

export interface StripResult {
  xml: string;
  /** Notes retirées. */
  removed: number;
  /** Identifiants des notes de bas de page appelées dans les paragraphes retirés. */
  footnoteIds: string[];
  changed: boolean;
}

/** Retire les notes privées et les signets de citation d'un document.xml. */
export function stripDocumentXml(xml: string): StripResult {
  if (!xml.includes(PRIVATE_STYLE_ID) && !xml.includes(CITE_BOOKMARK_PREFIX)) return { xml, removed: 0, footnoteIds: [], changed: false };
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML du document illisible');
  let removed = 0;
  const footnoteIds: string[] = [];
  const paras = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));
  for (const p of paras) {
    if (!p.isConnected || !isPrivatePara(p)) continue;
    // Une note dans une cellule de tableau : on vide le paragraphe (une cellule doit garder un <w:p>).
    for (const r of Array.from(p.getElementsByTagNameNS(W_NS, 'footnoteReference'))) footnoteIds.push(r.getAttributeNS(W_NS, 'id') ?? r.getAttribute('w:id') ?? '');
    const parent = p.parentElement;
    const inCell = parent?.localName === 'tc';
    // Le dernier paragraphe peut porter le sectPr d'une section : on le garde, vidé.
    const holdsSect = Array.from(p.getElementsByTagNameNS(W_NS, 'sectPr')).length > 0;
    const siblingsP = parent ? Array.from(parent.children).filter((c) => c.localName === 'p') : [];
    if (inCell && siblingsP.length <= 1) {
      for (const c of Array.from(p.children)) if (c.localName !== 'pPr') c.remove();
      const ppr = Array.from(p.children).find((c) => c.localName === 'pPr');
      ppr?.querySelectorAll('*').forEach((x) => x.localName === 'pStyle' && x.remove());
    } else if (holdsSect) {
      for (const c of Array.from(p.children)) if (c.localName !== 'pPr') c.remove();
      const ppr = Array.from(p.children).find((c) => c.localName === 'pPr');
      for (const s of Array.from(ppr?.children ?? [])) if (s.localName === 'pStyle') s.remove();
    } else p.remove();
    removed++;
  }
  // Signets techniques des citations (début et fin appariés par w:id).
  const ids = new Set<string>();
  for (const b of Array.from(doc.getElementsByTagNameNS(W_NS, 'bookmarkStart'))) {
    const name = b.getAttributeNS(W_NS, 'name') ?? b.getAttribute('w:name') ?? '';
    if (name.startsWith(CITE_BOOKMARK_PREFIX)) {
      ids.add(b.getAttributeNS(W_NS, 'id') ?? b.getAttribute('w:id') ?? '');
      b.remove();
    }
  }
  if (ids.size)
    for (const b of Array.from(doc.getElementsByTagNameNS(W_NS, 'bookmarkEnd'))) {
      const id = b.getAttributeNS(W_NS, 'id') ?? b.getAttribute('w:id') ?? '';
      if (ids.has(id)) b.remove();
    }
  // Fins de signet orphelines (début retiré avec une note privée).
  if (removed) {
    const starts = new Set(Array.from(doc.getElementsByTagNameNS(W_NS, 'bookmarkStart')).map((b) => b.getAttributeNS(W_NS, 'id') ?? b.getAttribute('w:id') ?? ''));
    for (const b of Array.from(doc.getElementsByTagNameNS(W_NS, 'bookmarkEnd'))) {
      const id = b.getAttributeNS(W_NS, 'id') ?? b.getAttribute('w:id') ?? '';
      if (!starts.has(id)) b.remove();
    }
  }
  if (!removed && !ids.size) return { xml, removed: 0, footnoteIds: [], changed: false };
  let out = new XMLSerializer().serializeToString(doc);
  if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + out;
  return { xml: out, removed, footnoteIds, changed: true };
}

/** Retire de footnotes.xml les notes appelées uniquement depuis des notes privées. */
function stripFootnotes(xml: string, ids: string[]): string {
  if (!ids.length) return xml;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return xml;
  const set = new Set(ids);
  let n = 0;
  for (const f of Array.from(doc.getElementsByTagNameNS(W_NS, 'footnote'))) {
    const id = f.getAttributeNS(W_NS, 'id') ?? f.getAttribute('w:id') ?? '';
    if (set.has(id)) {
      f.remove();
      n++;
    }
  }
  if (!n) return xml;
  let out = new XMLSerializer().serializeToString(doc);
  if (!out.startsWith('<?xml')) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + out;
  return out;
}

export interface ExportStrip {
  data: ArrayBuffer;
  removed: number;
}

/**
 * Copie d'export d'un .docx : sans notes privées (ni leurs notes de bas de page), sans signets
 * de citation. Octets d'origine renvoyés s'il n'y a rien à retirer.
 */
export async function stripForExport(data: ArrayBuffer): Promise<ExportStrip> {
  const zip = await JSZip.loadAsync(data);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('Fichier .docx invalide (word/document.xml absent)');
  const r = stripDocumentXml(await f.async('string'));
  if (!r.changed) return { data, removed: 0 };
  zip.file('word/document.xml', r.xml);
  if (r.footnoteIds.length) {
    // une note de bas de page n'est retirée que si plus aucun appel ne subsiste dans le corps
    const still = new Set(Array.from(r.xml.matchAll(/<w:footnoteReference\b[^>]*w:id="([^"]+)"/g)).map((m) => m[1]));
    const orphan = r.footnoteIds.filter((id) => !still.has(id));
    const fn = zip.file('word/footnotes.xml');
    if (fn && orphan.length) zip.file('word/footnotes.xml', stripFootnotes(await fn.async('string'), orphan));
  }
  const out = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  return { data: out, removed: r.removed };
}

/** Le paquet contient-il des notes privées ? */
export async function hasPrivateNotes(data: ArrayBuffer): Promise<boolean> {
  const zip = await JSZip.loadAsync(data);
  const xml = (await zip.file('word/document.xml')?.async('string')) ?? '';
  return new RegExp(`<w:pStyle\\s+w:val="${PRIVATE_STYLE_ID}"`).test(xml);
}

// ── Côté éditeur (nœuds ProseMirror de SuperDoc ; appelé seulement par engine.ts) ──
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** Méta des transactions d'affichage (masquer / afficher) : pas une modification de l'écrit. */
export const VIEW_META = 'marginaliaView';

export const isPrivateNode = (n: Any): boolean => n?.type?.name === 'paragraph' && n.attrs?.paragraphProperties?.styleId === PRIVATE_STYLE_ID;

/** Paragraphes de note privée du document (à toute profondeur). */
export function privateParagraphs(doc: Any): { node: Any; pos: number }[] {
  const out: { node: Any; pos: number }[] = [];
  doc.descendants((n: Any, pos: number) => {
    if (n.type.name === 'paragraph') {
      if (isPrivateNode(n)) out.push({ node: n, pos });
      return false;
    }
    return true;
  });
  return out;
}

/** Textes des blocs, notes privées comprises ou non. */
export function textblocksOf(doc: Any, withPrivate: boolean): string[] {
  const out: string[] = [];
  doc.descendants((n: Any) => {
    if (n.isTextblock) {
      if (withPrivate || !isPrivateNode(n)) out.push(n.textContent);
      return false;
    }
    return true;
  });
  return out;
}

/** Le curseur (début de sélection) est-il dans une note privée ? */
export function inPrivateNote(state: Any): boolean {
  const $f = state.selection.$from;
  for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === 'paragraph') return isPrivateNode($f.node(d));
  return false;
}

const withVanish = (props: Any, on: boolean): Any => {
  const rp = { ...(props ?? {}) };
  if (on) rp.vanish = true;
  else delete rp.vanish;
  return rp;
};

/**
 * Masque (texte masqué, w:vanish : la mise en page referme la place) ou réaffiche les notes privées.
 * Transaction hors historique, marquée VIEW_META. Renvoie le nombre de notes touchées.
 */
export function setNotesHidden(ed: Any, hidden: boolean): number {
  const { state } = ed;
  const tr = state.tr;
  let n = 0;
  for (const { node, pos } of privateParagraphs(state.doc)) {
    const pp = node.attrs.paragraphProperties ?? {};
    const cur = !!pp.runProperties?.vanish;
    let touched = cur !== hidden;
    if (touched) tr.setNodeMarkup(pos, undefined, { ...node.attrs, paragraphProperties: { ...pp, runProperties: withVanish(pp.runProperties, hidden) } });
    node.descendants((c: Any, rel: number) => {
      if (c.type.name !== 'run') return true;
      if (!!c.attrs.runProperties?.vanish !== hidden) {
        tr.setNodeMarkup(pos + 1 + rel, undefined, { ...c.attrs, runProperties: withVanish(c.attrs.runProperties, hidden) });
        touched = true;
      }
      return false;
    });
    if (touched) n++;
  }
  if (!tr.docChanged) return 0;
  tr.setMeta('addToHistory', false);
  tr.setMeta(VIEW_META, true);
  ed.view.dispatch(tr);
  if (hidden && inPrivateNote(ed.state)) {
    // curseur hors de la note masquée : début du paragraphe visible suivant (ou précédent)
    const $f = ed.state.selection.$from;
    let d = $f.depth;
    while (d > 0 && $f.node(d).type.name !== 'paragraph') d--;
    const after = $f.after(d);
    const size = ed.state.doc.content.size;
    let target = -1;
    ed.state.doc.nodesBetween(after, size, (c: Any, p: number) => {
      if (target >= 0) return false;
      if (c.type.name === 'paragraph') {
        if (!isPrivateNode(c)) target = p + 1;
        return false;
      }
      return true;
    });
    if (target < 0) target = Math.max(1, $f.before(d) - 1);
    try {
      ed.commands.setTextSelection({ from: target, to: target });
    } catch {
      /* position hors texte */
    }
  }
  return n;
}

/**
 * Note privée au curseur :
 *  - dans une note : la (les) repasse en texte normal ;
 *  - sélection de texte, ou paragraphe vide : transforme le(s) paragraphe(s) en note ;
 *  - sinon : nouvelle note (paragraphe vide) après le paragraphe du curseur.
 * Renvoie 'inserted' | 'converted' | 'reverted' | null.
 */
export function togglePrivateNote(ed: Any): 'inserted' | 'converted' | 'reverted' | null {
  const { state } = ed;
  const S = state.schema;
  const { selection } = state;
  const paras: { node: Any; pos: number }[] = [];
  state.doc.nodesBetween(selection.from, Math.max(selection.to, selection.from), (n: Any, pos: number) => {
    if (n.type.name === 'paragraph') {
      paras.push({ node: n, pos });
      return false;
    }
    return true;
  });
  const $f = selection.$from;
  let d = $f.depth;
  while (d > 0 && $f.node(d).type.name !== 'paragraph') d--;
  if (!paras.length && d > 0) paras.push({ node: $f.node(d), pos: $f.before(d) });
  if (!paras.length) return null;
  const setStyle = (on: boolean) => {
    const tr = state.tr;
    for (const { node, pos } of paras) {
      const pp: Any = { ...(node.attrs.paragraphProperties ?? {}) };
      if (on) {
        pp.styleId = PRIVATE_STYLE_ID;
        delete pp.numberingProperties;
      } else {
        delete pp.styleId;
        if (pp.runProperties?.vanish) pp.runProperties = withVanish(pp.runProperties, false);
      }
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, paragraphProperties: pp });
    }
    ed.view.dispatch(tr);
  };
  if (inPrivateNote(state)) {
    setStyle(false);
    return 'reverted';
  }
  const cur = d > 0 ? $f.node(d) : null;
  if (!selection.empty || (cur && cur.content.size === 0)) {
    setStyle(true);
    return 'converted';
  }
  if (d <= 0) return null;
  const at = $f.after(d);
  const p = S.nodes.paragraph.create({ paragraphProperties: { styleId: PRIVATE_STYLE_ID } });
  ed.view.dispatch(state.tr.insert(at, p));
  ed.commands.setTextSelection({ from: at + 1, to: at + 1 });
  return 'inserted';
}

/**
 * Copie vers le presse-papiers : si la sélection mêle texte et notes privées, les notes sont
 * retirées des données copiées (texte brut reconstruit, HTML nettoyé ou abandonné).
 * Une sélection entièrement dans une note reste copiable (geste explicite de l'auteur).
 * À appeler pendant l'évènement `copy`, après le traitement de l'éditeur.
 */
export function stripClipboard(ed: Any, ev: ClipboardEvent): boolean {
  const dt = ev.clipboardData;
  if (!dt) return false;
  const { state } = ed;
  const { from, to, empty } = state.selection;
  if (empty) return false;
  const keep: string[] = [];
  const dropped: string[] = [];
  state.doc.nodesBetween(from, to, (n: Any, pos: number) => {
    if (n.isTextblock) {
      const a = Math.max(from, pos + 1);
      const b = Math.min(to, pos + n.nodeSize - 1);
      const t = b > a ? state.doc.textBetween(a, b, '', ' ') : '';
      (isPrivateNode(n) ? dropped : keep).push(t);
      return false;
    }
    return true;
  });
  if (!dropped.length || !keep.length) return false;
  const html = dt.getData('text/html');
  const others = Array.from(dt.types).filter((t) => t !== 'text/plain' && t !== 'text/html');
  for (const t of others) dt.clearData(t);
  if (html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    d.querySelectorAll(`[styleid="${PRIVATE_STYLE_ID}"],[data-style-id="${PRIVATE_STYLE_ID}"],[data-styleid="${PRIVATE_STYLE_ID}"]`).forEach((x) => x.remove());
    const rest = d.body.textContent ?? '';
    const leak = dropped.some((t) => t.trim().length > 2 && rest.includes(t.trim()));
    if (leak) dt.clearData('text/html');
    else dt.setData('text/html', d.body.innerHTML);
  }
  dt.setData('text/plain', keep.join('\n'));
  ev.preventDefault();
  return true;
}

/**
 * Le fichier externe `disk` est-il exactement la copie d'export (sans notes privées) du .docx de
 * la bibliothèque `lib` ? (Réouverture d'un fichier enregistré par Marginalia : la copie de la
 * bibliothèque, qui garde les notes, ne doit alors pas être remplacée.)
 */
export async function isExportOf(lib: ArrayBuffer, disk: ArrayBuffer): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([JSZip.loadAsync(lib), JSZip.loadAsync(disk)]);
    const xa = (await a.file('word/document.xml')?.async('string')) ?? '';
    const xb = (await b.file('word/document.xml')?.async('string')) ?? null;
    if (xb === null) return false;
    return stripDocumentXml(xa).xml === xb;
  } catch {
    return false;
  }
}
