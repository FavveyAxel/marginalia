// ─────────────────────────────────────────────────────────────
// EPUB CFI (emplacements de Livres) → ancrage Marginalia (chapitre + offsets de caractères).
//
// Principe : on résout le CFI dans le document XHTML d'origine, on y insère deux marqueurs
// invisibles (caractères à usage privé), puis on fait passer ce document par EXACTEMENT les
// mêmes étapes que le lecteur (préparation, assainissement, canonisation). La position des
// marqueurs dans le texte obtenu donne les offsets, ramenés au texte canonique du chapitre.
// Le texte sélectionné dans Livres sert de contrôle : s'il ne correspond pas, on le cherche
// dans le chapitre visé, puis dans tout le livre ; sinon le passage est déclaré introuvable
// (jamais d'ancrage approximatif).
// ─────────────────────────────────────────────────────────────
import { canonicalBodyText, parseSpineDoc, resolvePath } from '../reader/html/parse';
import { allIndexes, fold, type Folded } from '../reader/html/anchoring';

const START = '';
const END = '';

interface Step {
  index: number;
  assert?: string;
}
interface CfiPath {
  pkg: Step[];
  content: Step[];
  offset: number | null;
}

/** Chapitre tel que le lecteur le découpe (chemin dans l'archive + texte canonique). */
export interface CfiChapter {
  path: string;
  text: string;
}

export interface CfiContext {
  opf: Document;
  manifest: Map<string, { path: string; type: string }>;
  chapters: CfiChapter[];
  read(path: string): Promise<string | null>;
  folded: Map<number, Folded>;
}

export interface CfiSpan {
  chapter: number;
  start: number;
  end: number;
  method: 'cfi' | 'texte-chapitre' | 'texte-livre';
}

// ── Analyse syntaxique ───────────────────────────────────────

/** Découpe au premier niveau (virgules hors crochets, échappements « ^ »). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '^' && i + 1 < s.length) {
      cur += c + s[++i];
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function parsePath(s: string): CfiPath | null {
  const pkg: Step[] = [];
  const content: Step[] = [];
  let cur = pkg;
  let offset: number | null = null;
  let i = 0;
  const num = () => {
    let n = '';
    while (i < s.length && s[i] >= '0' && s[i] <= '9') n += s[i++];
    return n;
  };
  const assertion = (): string | undefined => {
    if (s[i] !== '[') return undefined;
    i++;
    let out = '';
    while (i < s.length && s[i] !== ']') {
      if (s[i] === '^') i++;
      out += s[i] ?? '';
      i++;
    }
    i++;
    return out;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '/') {
      i++;
      const n = num();
      if (!n) return null;
      const a = assertion();
      cur.push({ index: Number(n), assert: a ? a.split(';')[0] : undefined });
    } else if (c === '!') {
      i++;
      if (cur === content) return null;
      cur = content;
    } else if (c === ':') {
      i++;
      const n = num();
      if (!n) return null;
      offset = Number(n);
      break; // assertion de texte, biais (;s=…) : ignorés
    } else if (c === '~' || c === '@' || c === '[') break;
    else return null;
  }
  return { pkg, content, offset };
}

/** CFI → point (ou début et fin pour une plage). null si illisible. */
export function parseCfi(cfi: string): { start: CfiPath; end: CfiPath | null } | null {
  const m = /^epubcfi\(([\s\S]*)\)$/.exec(cfi.trim());
  if (!m) return null;
  const parts = splitTop(m[1]);
  if (parts.length === 3) {
    const start = parsePath(parts[0] + parts[1]);
    const end = parsePath(parts[0] + parts[2]);
    return start && end ? { start, end } : null;
  }
  const start = parsePath(parts[0]);
  return start ? { start, end: null } : null;
}

// ── Contexte (archive EPUB) ──────────────────────────────────

export async function loadCfiContext(data: ArrayBuffer, chapters: CfiChapter[]): Promise<CfiContext | null> {
  const { default: JSZip } = await import('jszip');
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return null;
  }
  const cache = new Map<string, Promise<string | null>>();
  const read = (p: string) => {
    let hit = cache.get(p);
    if (!hit) {
      const f = zip.file(p) ?? zip.file(decodeURI(p));
      hit = f ? f.async('string') : Promise.resolve(null);
      cache.set(p, hit);
    }
    return hit;
  };
  const container = await read('META-INF/container.xml');
  if (!container) return null;
  const cdoc = new DOMParser().parseFromString(container, 'application/xml');
  const opfPath = cdoc.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  const opfSrc = opfPath ? await read(opfPath) : null;
  if (!opfPath || !opfSrc) return null;
  const opf = new DOMParser().parseFromString(opfSrc, 'application/xml');
  const manifest = new Map<string, { path: string; type: string }>();
  for (const it of Array.from(opf.getElementsByTagNameNS('*', 'item'))) {
    manifest.set(it.getAttribute('id') ?? '', { path: resolvePath(opfPath, it.getAttribute('href') ?? '').path, type: it.getAttribute('media-type') ?? '' });
  }
  return { opf, manifest, chapters, read, folded: new Map() };
}

// ── Résolution ───────────────────────────────────────────────

const elementChildren = (n: Node): Element[] => Array.from(n.childNodes).filter((c): c is Element => c.nodeType === 1);

/** Élément désigné par un pas pair (avec contrôle de l'assertion d'id). */
function stepElement(parent: Node, step: Step, doc: Document): Element | null {
  if (step.index % 2 !== 0 || step.index < 2) return null;
  const el = elementChildren(parent)[step.index / 2 - 1] ?? null;
  if (step.assert && (!el || el.getAttribute('id') !== step.assert)) {
    // L'assertion d'id prime sur l'index (structure légèrement différente).
    const byId = Array.from(doc.getElementsByTagName('*')).find((e) => e.getAttribute('id') === step.assert);
    if (byId) return byId;
  }
  return el;
}

type DomPoint = { text: Text; offset: number } | { parent: Node; before: Node | null };

/** Point DOM désigné par les pas de contenu (après « ! ») et le décalage final. */
function contentPoint(doc: Document, steps: Step[], offset: number | null): DomPoint | null {
  let node: Node = doc.documentElement;
  if (!steps.length) {
    const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement;
    return { parent: body, before: body.firstChild };
  }
  for (let k = 0; k < steps.length; k++) {
    const st = steps[k];
    const last = k === steps.length - 1;
    if (st.index % 2 === 0) {
      const el = stepElement(node, st, doc);
      if (!el) return null;
      if (last) {
        // Décalage sur un élément : texte de l'élément s'il en a, sinon juste avant lui.
        if (offset != null && offset > 0) return chunkPoint(el, Array.from(el.childNodes), offset);
        return { parent: el.parentNode!, before: el };
      }
      node = el;
    } else {
      if (!last) return null;
      const k2 = (st.index - 1) / 2; // nombre d'éléments avant ce morceau de texte
      const kids = Array.from(node.childNodes);
      const els = elementChildren(node);
      const after = k2 > 0 ? els[k2 - 1] : null;
      const before = els[k2] ?? null;
      if (k2 > els.length) return null;
      const from = after ? kids.indexOf(after) + 1 : 0;
      const to = before ? kids.indexOf(before) : kids.length;
      const chunk = kids.slice(from, to);
      const p = chunkPoint(node, chunk, offset ?? 0);
      return p ?? { parent: node, before };
    }
  }
  return null;
}

/** Point à `offset` caractères dans une suite de nœuds texte (CDATA comprises). */
function chunkPoint(parent: Node, nodes: Node[], offset: number): DomPoint | null {
  const texts = nodes.filter((n): n is Text => n.nodeType === 3 || n.nodeType === 4);
  if (!texts.length) return null;
  let rest = offset;
  for (const t of texts) {
    if (rest <= t.data.length) return { text: t, offset: rest };
    rest -= t.data.length;
  }
  // Au-delà du texte (décalage incohérent) : on s'arrête à la fin, le texte sélectionné tranchera.
  const last = texts[texts.length - 1];
  void parent;
  return { text: last, offset: last.data.length };
}

function insertMarker(doc: Document, p: DomPoint, mark: string) {
  if ('text' in p) p.text.data = p.text.data.slice(0, p.offset) + mark + p.text.data.slice(p.offset);
  else p.parent.insertBefore(doc.createTextNode(mark), p.before);
}

/** Index du document du spine désigné par les pas de paquet ; null si introuvable. */
function spineItem(ctx: CfiContext, pkg: Step[]): { path: string; type: string } | null {
  let node: Node = ctx.opf.documentElement;
  let itemref: Element | null = null;
  for (const st of pkg) {
    const el = st.index % 2 === 0 ? elementChildren(node)[st.index / 2 - 1] ?? null : null;
    if (el && el.localName === 'itemref') {
      itemref = el;
      if (st.assert && el.getAttribute('id') !== st.assert && el.getAttribute('idref') !== st.assert) {
        const all = Array.from(ctx.opf.getElementsByTagNameNS('*', 'itemref'));
        itemref = all.find((x) => x.getAttribute('id') === st.assert || x.getAttribute('idref') === st.assert) ?? el;
      }
      break;
    }
    if (!el) {
      // Index faux : l'assertion d'itemref peut encore désigner le bon document.
      if (st.assert) itemref = Array.from(ctx.opf.getElementsByTagNameNS('*', 'itemref')).find((x) => x.getAttribute('id') === st.assert || x.getAttribute('idref') === st.assert) ?? null;
      break;
    }
    node = el;
  }
  if (!itemref) return null;
  return ctx.manifest.get(itemref.getAttribute('idref') ?? '') ?? null;
}

/** Nombre de caractères non blancs dans s[0:pos]. */
function nonSpaceBefore(s: string, pos: number): number {
  let n = 0;
  for (let i = 0; i < pos && i < s.length; i++) if (!/\s/.test(s[i])) n++;
  return n;
}
/** Position juste après le n-ième caractère non blanc de s. */
function afterNonSpace(s: string, n: number): number {
  if (n <= 0) return 0;
  let m = 0;
  for (let j = 0; j < s.length; j++) if (!/\s/.test(s[j]) && ++m === n) return j + 1;
  return s.length;
}

/** Plage (ou point si `end` absent) en offsets canoniques du chapitre, d'après le seul CFI. */
async function cfiOffsets(ctx: CfiContext, cfi: string): Promise<{ chapter: number; start: number; end: number } | null> {
  const parsed = parseCfi(cfi);
  if (!parsed) return null;
  const item = spineItem(ctx, parsed.start.pkg);
  if (!item) return null;
  const chapter = ctx.chapters.findIndex((c) => c.path === item.path);
  if (chapter < 0) return null;
  const chText = ctx.chapters[chapter].text;
  if (!parsed.start.content.length && (!parsed.end || !parsed.end.content.length)) return { chapter, start: 0, end: 0 };
  const src = await ctx.read(item.path);
  if (src == null) return null;
  const doc = parseSpineDoc(src, item.type);
  const a = contentPoint(doc, parsed.start.content, parsed.start.offset);
  const b = parsed.end ? contentPoint(doc, parsed.end.content, parsed.end.offset) : null;
  if (!a || (parsed.end && !b)) return null;
  // Fin d'abord : si les deux points tombent dans le même nœud texte, le début reste valable.
  if (b) insertMarker(doc, b, END);
  insertMarker(doc, a, START);
  let text: string;
  try {
    text = canonicalBodyText(doc, item.path);
  } catch {
    return null;
  }
  const si = text.indexOf(START);
  const ei = b ? text.indexOf(END) : si;
  if (si < 0 || ei < 0) return null;
  // Positions dans le texte sans marqueurs.
  const clean = text.replace(/[]/g, '');
  let s = si - (b && ei < si ? 1 : 0);
  let e = b ? ei - (si < ei ? 1 : 0) : s;
  if (e < s) [s, e] = [e, s];
  if (clean !== chText) {
    // Seuls les blancs peuvent différer (un marqueur empêche parfois un rognage) : on recale
    // par le nombre de caractères non blancs.
    s = afterNonSpace(chText, nonSpaceBefore(clean, s));
    e = afterNonSpace(chText, nonSpaceBefore(clean, e));
    if (e < s) e = s;
  }
  return { chapter, start: s, end: e };
}

const trimSpan = (text: string, s: number, e: number): [number, number] => {
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  return [s, e];
};

function foldedOf(ctx: CfiContext, chapter: number): Folded {
  let f = ctx.folded.get(chapter);
  if (!f) {
    f = fold(ctx.chapters[chapter].text);
    ctx.folded.set(chapter, f);
  }
  return f;
}

/**
 * Surlignage : CFI de plage + texte sélectionné → passage du chapitre.
 * Ordre : CFI confirmé par le texte ; texte dans le chapitre visé (le plus proche) ; texte dans
 * tout le livre (seulement s'il est sans ambiguïté). null : introuvable.
 */
export async function resolveCfiRange(ctx: CfiContext, cfi: string, quote: string): Promise<CfiSpan | null> {
  const at = await cfiOffsets(ctx, cfi).catch(() => null);
  const fq = fold(quote).text.trim();
  if (!fq) {
    if (!at || at.end <= at.start) return null;
    const [s, e] = trimSpan(ctx.chapters[at.chapter].text, at.start, at.end);
    return e > s ? { chapter: at.chapter, start: s, end: e, method: 'cfi' } : null;
  }
  if (at && at.end > at.start) {
    const text = ctx.chapters[at.chapter].text;
    const [s, e] = trimSpan(text, at.start, at.end);
    if (fold(text.slice(s, e)).text.trim() === fq) return { chapter: at.chapter, start: s, end: e, method: 'cfi' };
  }
  const span = (chapter: number, pos: number) => {
    const f = foldedOf(ctx, chapter);
    const text = ctx.chapters[chapter].text;
    const [s, e] = trimSpan(text, f.starts[pos], f.ends[pos + fq.length - 1]);
    return { s, e };
  };
  // Dans le chapitre visé par le CFI : l'occurrence la plus proche.
  if (at) {
    const f = foldedOf(ctx, at.chapter);
    const hits = allIndexes(f.text, fq, 500);
    if (hits.length) {
      let best = hits[0];
      for (const h of hits) if (Math.abs(f.starts[h] - at.start) < Math.abs(f.starts[best] - at.start)) best = h;
      const near = Math.abs(f.starts[best] - at.start) <= 400;
      // Passage court et répété loin de l'endroit indiqué : trop incertain.
      if (hits.length === 1 || fq.length >= 12 || near) {
        const { s, e } = span(at.chapter, best);
        if (e > s) return { chapter: at.chapter, start: s, end: e, method: 'texte-chapitre' };
      }
    }
  }
  // Dans tout le livre : une seule occurrence, ou un passage long (le plus proche du chapitre visé).
  if (fq.length >= 4) {
    const cands: { chapter: number; pos: number }[] = [];
    ctx.chapters.forEach((_, chapter) => {
      for (const pos of allIndexes(foldedOf(ctx, chapter).text, fq, 50)) cands.push({ chapter, pos });
    });
    if (cands.length === 1 || (cands.length > 1 && fq.length >= 30)) {
      const ref = at?.chapter ?? 0;
      const c = cands.reduce((a, b) => (Math.abs(b.chapter - ref) < Math.abs(a.chapter - ref) ? b : a));
      const { s, e } = span(c.chapter, c.pos);
      if (e > s) return { chapter: c.chapter, start: s, end: e, method: 'texte-livre' };
    }
  }
  return null;
}

/** Signet ou position : CFI (point ou plage) → chapitre et offset du début. */
export async function resolveCfiPoint(ctx: CfiContext, cfi: string): Promise<{ chapter: number; offset: number } | null> {
  const at = await cfiOffsets(ctx, cfi).catch(() => null);
  if (!at) return null;
  const text = ctx.chapters[at.chapter].text;
  let o = Math.max(0, Math.min(at.start, text.length));
  while (o < text.length && /\s/.test(text[o])) o++;
  return { chapter: at.chapter, offset: Math.min(o, text.length) };
}
