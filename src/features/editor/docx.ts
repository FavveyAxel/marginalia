// ─────────────────────────────────────────────────────────────
// Outils OOXML purs (JSZip + DOMParser), indépendants du moteur d'édition :
//  - G1 : injection d'un sectPr A4 si absent / vide ;
//  - génération d'un .docx à partir d'un HTML simple (notes de bas de page réelles) ;
//  - lecture d'un .docx en modèle de blocs (exports MD / HTML / TXT / PDF) ;
//  - comptage de mots (garde-fou G2).
// ─────────────────────────────────────────────────────────────
import JSZip from 'jszip';
import { PRIVATE_STYLE_DEF, PRIVATE_STYLE_ID } from './privateNotes';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ── Comptage ─────────────────────────────────────────────────
const WORD_RE = /[\p{L}\p{N}]+(?:['’\-‐][\p{L}\p{N}]+)*/gu;
export function countWords(text: string): number {
  return (text.match(WORD_RE) ?? []).length;
}

// ── Zip ──────────────────────────────────────────────────────
async function loadZip(data: ArrayBuffer): Promise<JSZip> {
  return JSZip.loadAsync(data);
}
async function zipToBuffer(zip: JSZip): Promise<ArrayBuffer> {
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ── G1 : format de page A4 ───────────────────────────────────
/** A4 portrait, marges 2,5 cm (1 cm = 566,93 twips). */
export const A4 = { w: 11906, h: 16838, margin: 1417 };
const PG_SZ = `<w:pgSz w:w="${A4.w}" w:h="${A4.h}"/>`;
const PG_MAR = `<w:pgMar w:top="${A4.margin}" w:right="${A4.margin}" w:bottom="${A4.margin}" w:left="${A4.margin}" w:header="709" w:footer="709" w:gutter="0"/>`;
export const A4_SECTPR = `<w:sectPr>${PG_SZ}${PG_MAR}</w:sectPr>`;

/**
 * Corrige (en chaîne, sans réécrire le reste du XML) le sectPr de fin de corps :
 * - absent → ajouté avant </w:body> ;
 * - vide (<w:sectPr/>) → remplacé par un A4 ;
 * - présent sans pgSz / pgMar → complété.
 * Renvoie null si aucune modification n'est nécessaire.
 */
export function fixSectPrXml(xml: string): string | null {
  const bodyEnd = xml.lastIndexOf('</w:body>');
  if (bodyEnd < 0) return null; // préfixe inhabituel : on ne touche à rien (G2 reste actif)
  const idx = xml.lastIndexOf('<w:sectPr', bodyEnd);
  const seg = idx >= 0 ? xml.slice(idx, bodyEnd) : '';
  const bodyLevel = idx >= 0 && !/<\/w:p>|<\/w:pPr>|<\/w:tbl>/.test(seg);
  if (!bodyLevel) return xml.slice(0, bodyEnd) + A4_SECTPR + xml.slice(bodyEnd);
  // vide, auto-fermant
  if (/^<w:sectPr\b[^>]*\/>\s*$/.test(seg)) {
    const open = seg.match(/^<w:sectPr\b([^>]*?)\s*\/>/)!;
    return xml.slice(0, idx) + `<w:sectPr${open[1]}>${PG_SZ}${PG_MAR}</w:sectPr>` + xml.slice(bodyEnd);
  }
  const m = seg.match(/^(<w:sectPr\b[^>]*>)([\s\S]*)(<\/w:sectPr>)\s*$/);
  if (!m) return null;
  let inner = m[2];
  const hasSz = /<w:pgSz\b/.test(inner);
  const hasMar = /<w:pgMar\b/.test(inner);
  if (hasSz && hasMar) return null;
  // Ordre du schéma : headerReference*, footerReference*, footnotePr?, endnotePr?, type?, pgSz?, pgMar?, …
  const lead = inner.match(/^(\s*(?:<w:(?:headerReference|footerReference)\b[^>]*\/>\s*|<w:(?:footnotePr|endnotePr)\b[\s\S]*?<\/w:(?:footnotePr|endnotePr)>\s*|<w:type\b[^>]*\/>\s*)*)/);
  const head = lead ? lead[1] : '';
  let rest = inner.slice(head.length);
  if (!hasSz) rest = PG_SZ + rest;
  if (!hasMar) rest = rest.replace(/(<w:pgSz\b[^>]*\/>)/, `$1${PG_MAR}`);
  inner = head + rest;
  return xml.slice(0, idx) + m[1] + inner + m[3] + xml.slice(bodyEnd);
}

/** G1 sur un paquet .docx. `changed` = false : octets d'origine renvoyés tels quels. */
export async function ensureA4SectPr(data: ArrayBuffer): Promise<{ data: ArrayBuffer; changed: boolean }> {
  const zip = await loadZip(data);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('Fichier .docx invalide (word/document.xml absent)');
  const xml = await f.async('string');
  const fixed = fixSectPrXml(xml);
  if (fixed === null) return { data, changed: false };
  zip.file('word/document.xml', fixed);
  return { data: await zipToBuffer(zip), changed: true };
}

// ── Modèle de lecture ────────────────────────────────────────
/** Marqueur interne d'un saut de page dans le texte d'un paragraphe (caractère de la zone privée). */
const PAGE_MARK = '\uE000';
/**
 * Mise en forme de caractères (exports fidèles : PDF, HTML). Valeurs absentes = héritées.
 * `b` / `i` / `u` à false : explicitement désactivés (ex. run non gras dans un titre gras).
 */
export interface TextFmt {
  /** Famille de police (nom Word, polices de thème résolues). */
  font?: string;
  /** Taille en points. */
  size?: number;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  /** Couleur du texte, « #rrggbb ». */
  color?: string;
  /** Surlignage / trame de fond, couleur CSS « #rrggbb ». */
  hl?: string;
  /** Barré. */
  s?: boolean;
  /** Petites capitales / capitales. */
  sc?: boolean;
  caps?: boolean;
  /** Exposant / indice. */
  va?: 'super' | 'sub';
}
/** Mise en forme de paragraphe ; longueurs en points. */
export interface ParaFmt {
  align?: 'left' | 'center' | 'right' | 'justify';
  /** Retraits gauche / droit et de première ligne (négatif = retrait suspendu). */
  indLeft?: number;
  indRight?: number;
  firstLine?: number;
  /** Espacements avant / après. */
  before?: number;
  after?: number;
  /** Interligne : multiple (lineRule auto, 1 = simple) ou hauteur en points (exact / au moins). */
  line?: number;
  lineRule?: 'auto' | 'exact' | 'atLeast';
}
export type BlockFmt = TextFmt & ParaFmt;

export type Inline =
  | ({ t: 'text'; text: string } & TextFmt)
  | { t: 'br' }
  | { t: 'note'; id: string };

export type BlockKind = 'title' | 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'quote' | 'li';
export interface Block {
  kind: BlockKind;
  inlines: Inline[];
  /** Listes : niveau (0…) et type. */
  level?: number;
  ordered?: boolean;
  /** Identifiant de liste (numId) pour regrouper / numéroter. */
  listId?: string;
  /** Style de paragraphe Word (pStyle) et mise en forme effective du paragraphe (style + directe). */
  styleId?: string;
  fmt?: BlockFmt;
  /** Commence sur une nouvelle page (saut de page, « saut de page avant », saut de section). */
  pageBreak?: boolean;
}
/** Typographie du document (styles.xml, thème, sectPr), pour des exports PDF / HTML fidèles. */
export interface DocTypography {
  /** Style de paragraphe par défaut (docDefaults + Normal). */
  base: BlockFmt;
  /** Mise en forme effective de chaque genre de bloc (style usuel du genre), et des notes. */
  kinds: Partial<Record<BlockKind | 'note', BlockFmt>>;
  /** Format de page en points (sectPr de fin de corps). */
  page?: { width: number; height: number; top: number; right: number; bottom: number; left: number };
  /** Table des polices : famille générique et police de remplacement (w:altName). */
  fonts: Record<string, { generic?: 'serif' | 'sans-serif' | 'monospace' | 'cursive'; alt?: string }>;
  /** Coupure automatique des mots activée dans le document (w:autoHyphenation). Absent : pas de césure. */
  hyphenate?: boolean;
}
export interface DocModel {
  blocks: Block[];
  /** Notes de bas de page dans l'ordre d'appel : id → paragraphes. */
  notes: Map<string, Inline[][]>;
  /** Ordre d'apparition des notes (numérotation 1, 2, 3…). */
  noteOrder: string[];
  /** Mots du corps (w:t + w:delText), pour G2. */
  bodyWords: number;
  /**
   * Mots des zones de texte (w:txbxContent, hors doublon mc:Fallback). Non exportés en MD/HTML/TXT ;
   * comptés seulement pour G2 à l'enregistrement, au cas où le moteur les affiche dans le flux.
   */
  extraWords: number;
  /** Typographie (absente pour un modèle construit à la main : les exports gardent leurs valeurs par défaut). */
  typo?: DocTypography;
}

const el =(n: Element, local: string) => Array.from(n.children).filter((c) => c.localName === local && c.namespaceURI === W_NS);
const first = (n: Element, local: string) => el(n, local)[0] ?? null;
const wattr = (n: Element | null, name: string) => (n ? n.getAttributeNS(W_NS, name) ?? n.getAttribute('w:' + name) : null);
const onOff = (n: Element | null) => {
  if (!n) return false;
  const v = wattr(n, 'val');
  return v === null || !['0', 'false', 'off', 'none'].includes(v);
};

interface StyleInfo {
  kind: BlockKind | null;
}

function parseStyles(xml: string | null): Map<string, StyleInfo> {
  const out = new Map<string, StyleInfo>();
  if (!xml) return out;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const styles = Array.from(doc.getElementsByTagNameNS(W_NS, 'style'));
  const raw = new Map<string, { name: string; basedOn: string | null; outline: number | null }>();
  for (const s of styles) {
    if (wattr(s, 'type') !== 'paragraph') continue;
    const id = wattr(s, 'styleId') ?? '';
    const name = (wattr(first(s, 'name'), 'val') ?? '').toLowerCase();
    const basedOn = wattr(first(s, 'basedOn'), 'val');
    const ppr = first(s, 'pPr');
    const ol = ppr ? wattr(first(ppr, 'outlineLvl'), 'val') : null;
    raw.set(id, { name, basedOn, outline: ol !== null ? Number(ol) : null });
  }
  const resolve = (id: string, depth = 0): BlockKind | null => {
    const k = kindFromId(id);
    if (k) return k;
    const r = raw.get(id);
    if (!r) return null;
    const byName = kindFromName(r.name);
    if (byName) return byName;
    if (r.outline !== null && r.outline < 9) return headingKind(r.outline + 1);
    if (r.basedOn && depth < 8) {
      const b = resolve(r.basedOn, depth + 1);
      if (b && b !== 'title') return b;
    }
    return null;
  };
  for (const id of raw.keys()) out.set(id, { kind: resolve(id) });
  return out;
}
function headingKind(n: number): BlockKind {
  return n <= 1 ? 'h1' : n === 2 ? 'h2' : n === 3 ? 'h3' : 'h4';
}
function kindFromId(id: string): BlockKind | null {
  const m = id.match(/^(?:Heading|Titre|heading)\s?(\d)$/);
  if (m) return headingKind(Number(m[1]));
  if (/^Title$/i.test(id)) return 'title';
  if (/^(Quote|BlockText|IntenseQuote|Citation|Citationintense)$/i.test(id)) return 'quote';
  return null;
}
function kindFromName(name: string): BlockKind | null {
  const m = name.match(/^(?:heading|titre)\s*(\d)$/);
  if (m) return headingKind(Number(m[1]));
  if (name === 'title' || name === 'titre') return 'title';
  if (/^(quote|block text|intense quote|citation|citation intense)$/.test(name)) return 'quote';
  return null;
}

// ── Typographie (styles.xml, thème, table des polices) ──
const HIGHLIGHT: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkBlue: '#000080',
  darkCyan: '#008080',
  darkGreen: '#008000',
  darkMagenta: '#800080',
  darkRed: '#800000',
  darkYellow: '#808000',
  darkGray: '#808080',
  lightGray: '#c0c0c0',
  black: '#000000',
  white: '#ffffff',
};
const hex = (v: string | null) => (v && /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : undefined);
const num = (v: string | null) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const tw = (v: string | null) => {
  const n = num(v);
  return n === undefined ? undefined : n / 20;
};

/** Polices de thème (a:majorFont / a:minorFont, script latin). */
function parseTheme(xml: string | null): { major?: string; minor?: string } {
  if (!xml) return {};
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const face = (tag: string) => {
    const f = Array.from(doc.getElementsByTagName('*')).find((e) => e.localName === tag);
    const latin = f ? Array.from(f.children).find((c) => c.localName === 'latin') : null;
    return latin?.getAttribute('typeface') || undefined;
  };
  return { major: face('majorFont'), minor: face('minorFont') };
}

function parseFontTable(xml: string | null): DocTypography['fonts'] {
  const out: DocTypography['fonts'] = {};
  if (!xml) return out;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const f of Array.from(doc.getElementsByTagNameNS(W_NS, 'font'))) {
    const name = wattr(f, 'name');
    if (!name) continue;
    const fam = wattr(first(f, 'family'), 'val');
    const pitch = wattr(first(f, 'pitch'), 'val');
    const generic = pitch === 'fixed' || fam === 'modern' ? 'monospace' : fam === 'roman' ? 'serif' : fam === 'swiss' ? 'sans-serif' : fam === 'script' ? 'cursive' : undefined;
    const alt = wattr(first(f, 'altName'), 'val') || undefined;
    out[name] = { ...(generic ? { generic } : {}), ...(alt ? { alt } : {}) };
  }
  return out;
}

type Theme = { major?: string; minor?: string };

/** Mise en forme de caractères d'un w:rPr (sans héritage). */
function readRPr(rpr: Element | null, theme: Theme): TextFmt {
  const f: TextFmt = {};
  if (!rpr) return f;
  const rf = first(rpr, 'rFonts');
  if (rf) {
    const th = (v: string | null) => (v ? (/^major/.test(v) ? theme.major : /^minor/.test(v) ? theme.minor : undefined) : undefined);
    // Les attributs de thème l'emportent sur les noms explicites (comportement de Word).
    const font = th(wattr(rf, 'asciiTheme')) || th(wattr(rf, 'hAnsiTheme')) || wattr(rf, 'ascii') || wattr(rf, 'hAnsi') || undefined;
    if (font) f.font = font;
  }
  const sz = num(wattr(first(rpr, 'sz'), 'val'));
  if (sz) f.size = sz / 2;
  const b = first(rpr, 'b');
  if (b) f.b = onOff(b);
  const i = first(rpr, 'i');
  if (i) f.i = onOff(i);
  const u = first(rpr, 'u');
  if (u) f.u = (wattr(u, 'val') ?? 'single') !== 'none';
  const color = hex(wattr(first(rpr, 'color'), 'val'));
  if (color) f.color = color;
  const hlv = wattr(first(rpr, 'highlight'), 'val');
  const shd = hex(wattr(first(rpr, 'shd'), 'fill'));
  if (hlv && hlv !== 'none') {
    if (HIGHLIGHT[hlv]) f.hl = HIGHLIGHT[hlv];
  } else if (shd) f.hl = shd;
  const st = first(rpr, 'strike') ?? first(rpr, 'dstrike');
  if (st) f.s = onOff(st);
  const sc = first(rpr, 'smallCaps');
  if (sc) f.sc = onOff(sc);
  const caps = first(rpr, 'caps');
  if (caps) f.caps = onOff(caps);
  const va = wattr(first(rpr, 'vertAlign'), 'val');
  if (va === 'superscript') f.va = 'super';
  else if (va === 'subscript') f.va = 'sub';
  return f;
}

/** Mise en forme de paragraphe d'un w:pPr (sans héritage). */
function readPPr(ppr: Element | null): ParaFmt {
  const f: ParaFmt = {};
  if (!ppr) return f;
  const jc = wattr(first(ppr, 'jc'), 'val');
  if (jc) f.align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : /^(both|distribute|justify|thaiDistribute|lowKashida|mediumKashida|highKashida)$/.test(jc) ? 'justify' : 'left';
  const ind = first(ppr, 'ind');
  if (ind) {
    const l = tw(wattr(ind, 'left') ?? wattr(ind, 'start'));
    if (l !== undefined) f.indLeft = l;
    const r = tw(wattr(ind, 'right') ?? wattr(ind, 'end'));
    if (r !== undefined) f.indRight = r;
    const fl = tw(wattr(ind, 'firstLine'));
    const hg = tw(wattr(ind, 'hanging'));
    if (hg !== undefined) f.firstLine = -hg;
    else if (fl !== undefined) f.firstLine = fl;
  }
  const sp = first(ppr, 'spacing');
  if (sp) {
    const on = (v: string | null) => ['1', 'true', 'on'].includes(v ?? '');
    const b = tw(wattr(sp, 'before'));
    if (on(wattr(sp, 'beforeAutospacing'))) f.before = 14;
    else if (b !== undefined) f.before = b;
    const a = tw(wattr(sp, 'after'));
    if (on(wattr(sp, 'afterAutospacing'))) f.after = 14;
    else if (a !== undefined) f.after = a;
    const line = num(wattr(sp, 'line'));
    if (line) {
      const rule = (wattr(sp, 'lineRule') ?? 'auto') as ParaFmt['lineRule'];
      f.lineRule = rule === 'exact' || rule === 'atLeast' ? rule : 'auto';
      f.line = f.lineRule === 'auto' ? line / 240 : line / 20;
    }
  }
  return f;
}

/** `b` complète `a` (les valeurs de `b` l'emportent). */
function mergeFmt<T extends object>(a: T, b: T): T {
  const out = { ...a } as Record<string, unknown>;
  for (const [k, v] of Object.entries(b)) if (v !== undefined) out[k] = v;
  if ((b as ParaFmt).line !== undefined) out.lineRule = (b as ParaFmt).lineRule;
  return out as T;
}

interface StyleDef {
  type: string;
  basedOn: string | null;
  r: TextFmt;
  p: ParaFmt;
}

/** Résolution des styles (héritage basedOn → docDefaults), comme Word. */
class TypoResolver {
  private defs = new Map<string, StyleDef>();
  private cache = new Map<string, BlockFmt>();
  readonly defaults: BlockFmt;
  readonly defaultPara: string | null = null;
  readonly defaultChar: string | null = null;
  constructor(stylesXml: string | null, readonly theme: Theme) {
    let dflt: BlockFmt = {};
    if (stylesXml) {
      const doc = new DOMParser().parseFromString(stylesXml, 'application/xml');
      const dd = doc.getElementsByTagNameNS(W_NS, 'docDefaults')[0];
      if (dd) {
        const rd = first(dd, 'rPrDefault');
        const pd = first(dd, 'pPrDefault');
        dflt = mergeFmt<BlockFmt>(readPPr(pd ? first(pd, 'pPr') : null), readRPr(rd ? first(rd, 'rPr') : null, theme));
      }
      for (const s of Array.from(doc.getElementsByTagNameNS(W_NS, 'style'))) {
        const id = wattr(s, 'styleId');
        if (!id) continue;
        const type = wattr(s, 'type') ?? 'paragraph';
        this.defs.set(id, { type, basedOn: wattr(first(s, 'basedOn'), 'val'), r: readRPr(first(s, 'rPr'), theme), p: readPPr(first(s, 'pPr')) });
        const isDefault = ['1', 'true', 'on'].includes(wattr(s, 'default') ?? '');
        if (isDefault && type === 'paragraph' && !this.defaultPara) this.defaultPara = id;
        if (isDefault && type === 'character' && !this.defaultChar) this.defaultChar = id;
      }
    }
    this.defaults = dflt;
    if (!this.defaultPara && this.defs.has('Normal')) this.defaultPara = 'Normal';
  }
  has(id: string): boolean {
    return this.defs.has(id);
  }
  /** Chaîne d'un style, de la racine au style lui-même. */
  private chain(id: string): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    for (let cur: string | null = id; cur && !seen.has(cur) && out.length < 20; ) {
      seen.add(cur);
      const d = this.defs.get(cur);
      if (!d) break;
      out.unshift(d);
      cur = d.basedOn;
    }
    return out;
  }
  /** Mise en forme effective d'un style de paragraphe (docDefaults + chaîne basedOn). */
  para(id: string | null): BlockFmt {
    const sid = id && this.defs.has(id) ? id : this.defaultPara;
    const key = sid ?? '';
    const hit = this.cache.get(key);
    if (hit) return hit;
    let f: BlockFmt = { ...this.defaults };
    if (sid) for (const d of this.chain(sid)) f = mergeFmt<BlockFmt>(mergeFmt<BlockFmt>(f, d.p), d.r);
    this.cache.set(key, f);
    return f;
  }
  /** Mise en forme d'un style de caractères (chaîne basedOn, sans docDefaults). */
  char(id: string | null): TextFmt {
    if (!id || id === this.defaultChar) return {};
    let f: TextFmt = {};
    for (const d of this.chain(id)) if (d.type === 'character' || d.type === 'paragraph') f = mergeFmt<TextFmt>(f, d.r);
    return f;
  }
}

/** Champs de mise en forme de caractères égaux ? (fusion des runs consécutifs) */
const FMT_KEYS: (keyof TextFmt)[] = ['font', 'size', 'b', 'i', 'u', 'color', 'hl', 's', 'sc', 'caps', 'va'];
function sameFmt(a: TextFmt, b: TextFmt): boolean {
  return FMT_KEYS.every((k) => a[k] === b[k]);
}
function pickFmt(f: TextFmt): TextFmt {
  const out: TextFmt = {};
  for (const k of FMT_KEYS) if (f[k] !== undefined) (out as Record<string, unknown>)[k] = f[k];
  return out;
}

function parseNumbering(xml: string | null): Map<string, Map<number, boolean>> {
  // numId → (ilvl → ordered ?)
  const out = new Map<string, Map<number, boolean>>();
  if (!xml) return out;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const abs = new Map<string, Map<number, boolean>>();
  for (const a of Array.from(doc.getElementsByTagNameNS(W_NS, 'abstractNum'))) {
    const lv = new Map<number, boolean>();
    for (const l of el(a, 'lvl')) {
      const fmt = wattr(first(l, 'numFmt'), 'val') ?? 'decimal';
      lv.set(Number(wattr(l, 'ilvl') ?? 0), !['bullet', 'none'].includes(fmt));
    }
    abs.set(wattr(a, 'abstractNumId') ?? '', lv);
  }
  for (const n of Array.from(doc.getElementsByTagNameNS(W_NS, 'num'))) {
    const aid = wattr(first(n, 'abstractNumId'), 'val') ?? '';
    out.set(wattr(n, 'numId') ?? '', abs.get(aid) ?? new Map());
  }
  return out;
}

/** Inlines d'un paragraphe (runs, liens, insertions, champs simples, sdt). */
function parseInlines(p: Element, notes: string[] | null, counter: { words: string[] }, typo?: TypoResolver): Inline[] {
  const out: Inline[] = [];
  const walk = (n: Element) => {
    for (const c of Array.from(n.children)) {
      if (c.namespaceURI !== W_NS) {
        // mc:AlternateContent, etc. : on descend dans le choix de repli
        if (c.localName === 'AlternateContent') {
          const fb = Array.from(c.children).find((x) => x.localName === 'Fallback') ?? c.children[0];
          if (fb) walk(fb);
        }
        continue;
      }
      switch (c.localName) {
        case 'r':
          run(c);
          break;
        case 'hyperlink':
        case 'ins':
        case 'smartTag':
        case 'fldSimple':
        case 'customXml':
        case 'moveTo':
          walk(c);
          break;
        case 'sdt': {
          const sc = first(c, 'sdtContent');
          if (sc) walk(sc);
          break;
        }
        case 'del':
        case 'moveFrom':
          // texte supprimé (suivi des modifications) : compté pour G2, absent des exports
          for (const t of Array.from(c.getElementsByTagNameNS(W_NS, 'delText'))) counter.words.push(t.textContent ?? '');
          break;
        default:
          break;
      }
    }
  };
  let inField = 0; // fldChar begin…separate : instructions à ignorer
  const run = (r: Element) => {
    const rpr = first(r, 'rPr');
    // Mise en forme directe du run (style de caractères + rPr) ; celle du paragraphe est dans Block.fmt.
    const fmt = pickFmt(
      typo
        ? mergeFmt<TextFmt>(typo.char(rpr ? wattr(first(rpr, 'rStyle'), 'val') : null), readRPr(rpr, typo.theme))
        : readRPr(rpr, {}),
    );
    for (const c of Array.from(r.children)) {
      if (c.namespaceURI !== W_NS) continue;
      switch (c.localName) {
        case 't': {
          const text = c.textContent ?? '';
          counter.words.push(text);
          if (inField === 1) break;
          const last = out[out.length - 1];
          if (last && last.t === 'text' && sameFmt(last, fmt)) last.text += text;
          else out.push({ t: 'text', text, ...fmt });
          break;
        }
        case 'delText':
          counter.words.push(c.textContent ?? '');
          break;
        case 'tab':
          out.push({ t: 'text', text: '\t' });
          counter.words.push(' ');
          break;
        case 'br':
        case 'cr':
          // saut de page : repéré par un marqueur, retiré ensuite (le bloc est coupé à cet endroit)
          if (wattr(c, 'type') === 'page') out.push({ t: 'text', text: PAGE_MARK });
          else out.push({ t: 'br' });
          counter.words.push(' ');
          break;
        case 'noBreakHyphen':
          out.push({ t: 'text', text: '-' });
          break;
        case 'fldChar': {
          const ty = wattr(c, 'fldCharType');
          if (ty === 'begin') inField = 1;
          else if (ty === 'separate') inField = 2;
          else if (ty === 'end') inField = 0;
          break;
        }
        case 'footnoteReference': {
          const id = wattr(c, 'id') ?? '';
          if (notes) notes.push(id);
          out.push({ t: 'note', id });
          break;
        }
        default:
          break;
      }
    }
  };
  walk(p);
  return out;
}

/** Lit un .docx (corps + notes) en modèle de blocs. */
export async function parseDocx(data: ArrayBuffer): Promise<DocModel> {
  const zip = await loadZip(data);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) throw new Error('word/document.xml absent');
  const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? null;
  const numXml = (await zip.file('word/numbering.xml')?.async('string')) ?? null;
  const fnXml = (await zip.file('word/footnotes.xml')?.async('string')) ?? null;
  const themeXml = (await zip.file('word/theme/theme1.xml')?.async('string')) ?? null;
  const fontXml = (await zip.file('word/fontTable.xml')?.async('string')) ?? null;
  const settingsXml = (await zip.file('word/settings.xml')?.async('string')) ?? '';
  const hyphenate = /<w:autoHyphenation(?:\s*\/>|\s+w:val="(?:1|true|on)")/.test(settingsXml);
  const styles = parseStyles(stylesXml);
  const typo = new TypoResolver(stylesXml, parseTheme(themeXml));
  const numbering = parseNumbering(numXml);
  const doc = new DOMParser().parseFromString(docXml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML du document illisible');
  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  const blocks: Block[] = [];
  const noteOrder: string[] = [];
  const counter = { words: [] as string[] };

  /** Le prochain paragraphe commence une page (saut en fin de paragraphe, saut de section). */
  let breakNext = false;
  const para = (p: Element) => {
    const ppr = first(p, 'pPr');
    const styleId = ppr ? wattr(first(ppr, 'pStyle'), 'val') : null;
    let kind: BlockKind = (styleId && (styles.get(styleId)?.kind ?? kindFromId(styleId))) || 'p';
    const outline = ppr ? wattr(first(ppr, 'outlineLvl'), 'val') : null;
    if (kind === 'p' && outline !== null && Number(outline) < 9) kind = headingKind(Number(outline) + 1);
    const numPr = ppr ? first(ppr, 'numPr') : null;
    if (styleId === PRIVATE_STYLE_ID) {
      // Note privée : comptée (G2 compare avec l'éditeur, qui l'affiche) mais jamais exportée,
      // ni elle ni les notes de bas de page qu'elle appellerait.
      parseInlines(p, [], counter);
      counter.words.push('\n');
      return;
    }
    const sid = styleId && typo.has(styleId) ? styleId : typo.defaultPara;
    const fmt = mergeFmt<BlockFmt>(typo.para(sid), readPPr(ppr));
    const block: Block = { kind, inlines: parseInlines(p, noteOrder, counter, typo), fmt, ...(sid ? { styleId: sid } : {}) };
    if (ppr && onOff(first(ppr, 'pageBreakBefore'))) block.pageBreak = true;
    if (breakNext) {
      block.pageBreak = true;
      breakNext = false;
    }
    counter.words.push('\n');
    if (numPr && (kind === 'p' || kind === 'quote')) {
      const numId = wattr(first(numPr, 'numId'), 'val') ?? '';
      const ilvl = Number(wattr(first(numPr, 'ilvl'), 'val') ?? 0);
      if (numId !== '0' && numbering.has(numId)) {
        block.kind = 'li';
        block.level = ilvl;
        block.listId = numId;
        block.ordered = numbering.get(numId)?.get(ilvl) ?? false;
      }
    }
    pushSplit(block);
    // saut de section « page suivante » porté par ce paragraphe : la suite commence sur une nouvelle page
    const sect = ppr ? first(ppr, 'sectPr') : null;
    if (sect) {
      const ty = wattr(first(sect, 'type'), 'val');
      if (!ty || ty === 'nextPage' || ty === 'evenPage' || ty === 'oddPage') breakNext = true;
    }
  };
  /** Coupe un paragraphe à ses sauts de page : le morceau qui suit un saut commence une page. */
  const pushSplit = (block: Block) => {
    if (!block.inlines.some((i) => i.t === 'text' && i.text.includes(PAGE_MARK))) {
      blocks.push(block);
      return;
    }
    let cur: Inline[] = [];
    let brk = !!block.pageBreak;
    const parts: { inlines: Inline[]; pageBreak: boolean }[] = [];
    for (const inl of block.inlines) {
      if (inl.t !== 'text' || !inl.text.includes(PAGE_MARK)) {
        cur.push(inl);
        continue;
      }
      const segs = inl.text.split(PAGE_MARK);
      segs.forEach((seg, k) => {
        if (k > 0) {
          parts.push({ inlines: cur, pageBreak: brk });
          cur = [];
          brk = true;
        }
        if (seg) cur.push({ ...inl, text: seg });
      });
    }
    parts.push({ inlines: cur, pageBreak: brk });
    // un saut tout au début ou tout à la fin ne crée pas de paragraphe vide, sauf si la page qu'il
    // ferme est déjà vide (deux sauts de suite = une page blanche, gardée comme paragraphe vide)
    const hasText = (x: Inline[]) => x.some((i) => i.t !== 'text' || i.text.trim() !== '');
    parts.forEach((part, k) => {
      const last = k === parts.length - 1;
      if (!hasText(part.inlines) && parts.length > 1 && !(part.pageBreak && !last)) {
        if (last) breakNext = breakNext || part.pageBreak;
        else parts[k + 1].pageBreak = parts[k + 1].pageBreak || part.pageBreak;
        return;
      }
      const b: Block = { ...block, inlines: part.inlines };
      if (part.pageBreak) b.pageBreak = true;
      else delete b.pageBreak;
      blocks.push(b);
    });
  };
  const walk = (n: Element) => {
    for (const c of Array.from(n.children)) {
      if (c.namespaceURI !== W_NS) continue;
      if (c.localName === 'p') para(c);
      else if (c.localName === 'tbl') {
        for (const tr of el(c, 'tr'))
          for (const tc of el(tr, 'tc')) walk(tc);
      } else if (c.localName === 'sdt') {
        const sc = first(c, 'sdtContent');
        if (sc) walk(sc);
      } else if (c.localName === 'customXml' || c.localName === 'ins') walk(c);
    }
  };
  if (body) walk(body);

  const notes = new Map<string, Inline[][]>();
  if (fnXml) {
    const fdoc = new DOMParser().parseFromString(fnXml, 'application/xml');
    for (const fn of Array.from(fdoc.getElementsByTagNameNS(W_NS, 'footnote'))) {
      const ty = wattr(fn, 'type');
      if (ty === 'separator' || ty === 'continuationSeparator' || ty === 'continuationNotice') continue;
      const paras = el(fn, 'p').map((p) =>
        trimNote(parseInlines(p, null, { words: [] }, typo).map((i) => (i.t === 'text' && i.text.includes(PAGE_MARK) ? { ...i, text: i.text.split(PAGE_MARK).join(' ') } : i))),
      );
      notes.set(wattr(fn, 'id') ?? '', paras);
    }
  }
  const seen = new Set<string>();
  const order = noteOrder.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  const extra: string[] = [];
  for (const tb of Array.from(doc.getElementsByTagNameNS(W_NS, 'txbxContent'))) {
    let inFallback = false;
    for (let a = tb.parentElement; a; a = a.parentElement) if (a.localName === 'Fallback') inFallback = true;
    if (inFallback) continue;
    for (const t of Array.from(tb.getElementsByTagNameNS(W_NS, 't'))) extra.push(t.textContent ?? '');
    extra.push('\n');
  }
  return {
    blocks,
    notes,
    noteOrder: order,
    bodyWords: countWords(counter.words.join('')),
    extraWords: countWords(extra.join(' ')),
    typo: { ...docTypography(typo, blocks, body, fnXml, parseFontTable(fontXml)), ...(hyphenate ? { hyphenate: true } : {}) },
  };
}

/** Styles usuels de chaque genre de bloc, si aucun bloc du document ne les utilise. */
const KIND_STYLES: Record<BlockKind | 'note', string[]> = {
  title: ['Title', 'Titre'],
  h1: ['Heading1', 'Titre1'],
  h2: ['Heading2', 'Titre2'],
  h3: ['Heading3', 'Titre3'],
  h4: ['Heading4', 'Titre4'],
  p: [],
  quote: ['Quote', 'Citation'],
  li: ['ListParagraph', 'Paragraphedeliste'],
  note: ['FootnoteText', 'Notedebasdepage'],
};

function docTypography(typo: TypoResolver, blocks: Block[], body: Element | undefined, fnXml: string | null, fonts: DocTypography['fonts']): DocTypography {
  const base = typo.para(typo.defaultPara);
  const kinds: DocTypography['kinds'] = {};
  for (const k of Object.keys(KIND_STYLES) as (BlockKind | 'note')[]) {
    if (k === 'note') continue;
    // style le plus fréquent parmi les blocs du genre
    const counts = new Map<string, number>();
    for (const b of blocks) if (b.kind === k) counts.set(b.styleId ?? '', (counts.get(b.styleId ?? '') ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const id = top !== undefined ? top : k === 'p' ? typo.defaultPara : KIND_STYLES[k].find((x) => typo.has(x));
    if (top !== undefined || id) kinds[k] = typo.para(id || null);
  }
  // Notes : style du premier paragraphe de note, sinon FootnoteText.
  let noteStyle: string | null | undefined = KIND_STYLES.note.find((x) => typo.has(x));
  if (fnXml) {
    const m = /<w:footnote\b(?![^>]*w:type="(?:separator|continuationSeparator|continuationNotice)")[\s\S]*?<w:pStyle w:val="([^"]+)"/.exec(fnXml);
    if (m && typo.has(m[1])) noteStyle = m[1];
  }
  if (noteStyle) kinds.note = typo.para(noteStyle);
  // Page : dernier sectPr du corps.
  let page: DocTypography['page'];
  const sect = body ? el(body, 'sectPr').pop() : undefined;
  if (sect) {
    const sz = first(sect, 'pgSz');
    const mar = first(sect, 'pgMar');
    const w = tw(wattr(sz, 'w'));
    const h = tw(wattr(sz, 'h'));
    if (w && h) {
      const m = (k: string, d: number) => {
        const v = tw(wattr(mar, k));
        return v === undefined ? d : Math.abs(v);
      };
      page = { width: w, height: h, top: m('top', 72), right: m('right', 72), bottom: m('bottom', 72), left: m('left', 72) };
    }
  }
  return { base, kinds, ...(page ? { page } : {}), fonts };
}

function trimNote(inl: Inline[]): Inline[] {
  // Le premier run d'une note contient souvent l'espace qui suit l'appel.
  const outArr = inl.filter((x) => x.t !== 'note');
  const f = outArr[0];
  if (f && f.t === 'text') outArr[0] = { ...f, text: f.text.replace(/^\s+/, '') };
  return outArr;
}

/** Nombre de mots du corps d'un .docx (texte courant + texte supprimé suivi). */
export async function countDocxWords(data: ArrayBuffer): Promise<number> {
  return (await parseDocx(data)).bodyWords;
}

// ── Génération HTML → .docx ──────────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface RunFmt {
  b?: boolean;
  i?: boolean;
  u?: boolean;
}
function runXml(text: string, f: RunFmt, extraRPr = ''): string {
  const rpr = `${extraRPr}${f.b ? '<w:b/><w:bCs/>' : ''}${f.i ? '<w:i/><w:iCs/>' : ''}${f.u ? '<w:u w:val="single"/>' : ''}`;
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** Texte de note : « *Titre* » → italique (convention de formatFootnote(…, 'md')). */
function noteRuns(text: string): string {
  const parts = text.split(/(\*[^*\n]+\*)/g).filter(Boolean);
  return parts.map((p) => (/^\*[^*]+\*$/.test(p) ? runXml(p.slice(1, -1), { i: true }) : runXml(p, {}))).join('');
}

interface GenCtx {
  notes: string[];
  nums: { ordered: boolean }[];
  /** Signets de citation liés (`<span data-cite-hl>`) déjà émis. */
  bms?: number;
}

function inlineXml(node: Node, f: RunFmt, ctx: GenCtx): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.textContent ?? '').replace(/\s+/g, ' ');
    return t ? runXml(t, f) : '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const e = node as HTMLElement;
  const tag = e.tagName.toLowerCase();
  if (e.hasAttribute('data-footnote')) {
    ctx.notes.push(e.getAttribute('data-footnote') ?? '');
    const id = ctx.notes.length; // ids 1…n (‑1 et 0 : séparateurs)
    return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
  }
  if (tag === 'br') return '<w:r><w:br/></w:r>';
  // Citation liée à un extrait : <span data-cite-hl="<highlightId>">« texte »</span> → signet Word
  // `_mglHl_<id>` autour du texte (même lien citation → extrait que l'insertion depuis l'éditeur).
  const hl = e.getAttribute('data-cite-hl');
  if (hl && /^[A-Za-z0-9_-]+$/.test(hl)) {
    ctx.bms = (ctx.bms ?? 0) + 1;
    const bid = 900 + ctx.bms;
    const inner = Array.from(e.childNodes).map((c) => inlineXml(c, f, ctx)).join('');
    return `<w:bookmarkStart w:id="${bid}" w:name="_mglHl_${hl}"/>${inner}<w:bookmarkEnd w:id="${bid}"/>`;
  }
  const nf: RunFmt = { ...f };
  if (tag === 'strong' || tag === 'b') nf.b = true;
  if (tag === 'em' || tag === 'i' || tag === 'cite') nf.i = true;
  if (tag === 'u') nf.u = true;
  return Array.from(e.childNodes)
    .map((c) => inlineXml(c, nf, ctx))
    .join('');
}

function paraXml(style: string | null, runs: string, extraPPr = ''): string {
  const ppr = `${style ? `<w:pStyle w:val="${style}"/>` : ''}${extraPPr}`;
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`;
}

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'div', 'section', 'article', 'header', 'footer', 'pre', 'hr', 'table']);

function blocksXml(parent: Element, ctx: GenCtx, quote = false): string {
  let out = '';
  let pending: Node[] = [];
  const flush = () => {
    if (!pending.length) return;
    const runs = pending.map((n) => inlineXml(n, {}, ctx)).join('');
    const hasText = pending.some((n) => (n.textContent ?? '').trim() || (n as Element).hasAttribute?.('data-footnote'));
    if (hasText) out += paraXml(quote ? 'Quote' : null, runs);
    pending = [];
  };
  for (const c of Array.from(parent.childNodes)) {
    const tag = c.nodeType === Node.ELEMENT_NODE ? (c as Element).tagName.toLowerCase() : '';
    if (!BLOCK_TAGS.has(tag)) {
      pending.push(c);
      continue;
    }
    flush();
    const e = c as HTMLElement;
    const inl = () => Array.from(e.childNodes).map((n) => inlineXml(n, {}, ctx)).join('');
    if (/^h[1-6]$/.test(tag)) {
      const lvl = Math.min(3, Number(tag[1]));
      out += paraXml(`Heading${lvl}`, inl());
    } else if (tag === 'p' && e.dataset.break === 'page') out += paraXml(null, '<w:r><w:br w:type="page"/></w:r>');
    else if (tag === 'p' && e.dataset.style && /^[A-Za-z0-9]+$/.test(e.dataset.style)) out += paraXml(e.dataset.style, inl());
    else if (tag === 'p') out += paraXml(quote ? 'Quote' : null, inl());
    else if (tag === 'blockquote') out += blocksXml(e, ctx, true);
    else if (tag === 'ul' || tag === 'ol') out += listXml(e, ctx, 0);
    else if (tag === 'hr') out += paraXml(null, '');
    else out += blocksXml(e, ctx, quote);
  }
  flush();
  return out;
}

function listXml(list: Element, ctx: GenCtx, level: number, numIdIn?: number): string {
  const ordered = list.tagName.toLowerCase() === 'ol';
  let numId = numIdIn;
  if (numId === undefined || level === 0) {
    ctx.nums.push({ ordered });
    numId = ctx.nums.length;
  }
  let out = '';
  for (const li of Array.from(list.children)) {
    if (li.tagName.toLowerCase() !== 'li') continue;
    const inlineNodes: Node[] = [];
    const sub: Element[] = [];
    for (const c of Array.from(li.childNodes)) {
      const tag = c.nodeType === Node.ELEMENT_NODE ? (c as Element).tagName.toLowerCase() : '';
      if (tag === 'ul' || tag === 'ol') sub.push(c as Element);
      else if (tag === 'p') inlineNodes.push(...Array.from(c.childNodes));
      else inlineNodes.push(c);
    }
    const runs = inlineNodes.map((n) => inlineXml(n, {}, ctx)).join('');
    out += paraXml('ListParagraph', runs, `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`);
    for (const s of sub) {
      // sous-liste : même instance de numérotation si même type, sinon nouvelle
      const subOrdered = s.tagName.toLowerCase() === 'ol';
      if (subOrdered === ordered) out += listXml(s, ctx, level + 1, numId);
      else {
        ctx.nums.push({ ordered: subOrdered });
        out += listXml(s, ctx, level + 1, ctx.nums.length);
      }
    }
  }
  return out;
}

const NS_DECL =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** Options de mise en page des écrits générés. */
export interface DocLayout {
  /** Présentation universitaire : alinéa, citations et notes en 10, page de garde, numéros de page. */
  academic?: boolean;
  /** Police du corps et des titres (défaut : Times New Roman, celle des modèles universitaires). */
  font?: string;
}

function stylesXml(layout: DocLayout = {}): string {
  const ac = !!layout.academic;
  const f = esc(layout.font?.trim() || 'Times New Roman');
  const font = `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/>`;
  const heading = (n: number, size: number, before: number, extra = '') =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="120" w:line="276" w:lineRule="auto"/>${ac ? '<w:ind w:firstLine="0"/>' : ''}<w:jc w:val="left"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/>${extra}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS_DECL}><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="fr-FR" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr>${ac ? '<w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="709"/>' : ''}<w:jc w:val="both"/></w:pPr>${ac ? `<w:rPr>${font}<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>` : ''}</w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="${ac ? 2880 : 0}" w:after="360" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="120" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="35"/><w:qFormat/><w:pPr><w:spacing w:before="60" w:after="200" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:iCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
${heading(1, 32, 480)}
${heading(2, 28, 360)}
${heading(3, 24, 240, '<w:i/><w:iCs/>')}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/><w:pPr><w:spacing w:before="120" w:after="200" w:line="${ac ? 240 : 300}" w:lineRule="auto"/><w:ind w:left="851" w:right="567" w:firstLine="0"/><w:jc w:val="both"/></w:pPr><w:rPr><w:sz w:val="${ac ? 20 : 22}"/><w:szCs w:val="${ac ? 20 : 22}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720" w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="${ac ? 'both' : 'left'}"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:uiPriority w:val="99"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
${PRIVATE_STYLE_DEF}
</w:styles>`;
}

function numberingXml(nums: { ordered: boolean }[]): string {
  const lvl = (ordered: boolean, i: number) =>
    ordered
      ? `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${['decimal', 'lowerLetter', 'lowerRoman'][i % 3]}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + 360 * i}" w:hanging="360"/></w:pPr></w:lvl>`
      : `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${['•', '–', '◦'][i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + 360 * i}" w:hanging="360"/></w:pPr></w:lvl>`;
  const abs = (id: number, ordered: boolean) =>
    `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 6 }, (_, i) => lvl(ordered, i)).join('')}</w:abstractNum>`;
  // Une définition abstraite par instance pour que chaque liste numérotée reparte de 1.
  const absXml = nums.map((n, k) => abs(k, n.ordered)).join('');
  const numXml = nums.map((_, k) => `<w:num w:numId="${k + 1}"><w:abstractNumId w:val="${k}"/></w:num>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering ${NS_DECL}>${absXml}${numXml}</w:numbering>`;
}

function footnotesXml(notes: string[]): string {
  const body = notes
    .map(
      (t, k) =>
        `<w:footnote w:id="${k + 1}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${noteRuns(t)}</w:p></w:footnote>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes ${NS_DECL}><w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${body}</w:footnotes>`;
}

/** Famille (w:family) et police de repli (w:altName) des polices proposées pour les nouveaux écrits. */
const FONT_INFO: Record<string, { family: 'roman' | 'swiss'; alt?: string; panose?: string }> = {
  Literata: { family: 'roman', alt: 'Georgia' },
  Georgia: { family: 'roman', panose: '02040502050405020303' },
  Arial: { family: 'swiss', panose: '020B0604020202020204' },
  'Helvetica Neue': { family: 'swiss', alt: 'Arial', panose: '02000503000000020004' },
  'Segoe UI': { family: 'swiss', alt: 'Arial', panose: '020B0502040204020203' },
};
function fontTableXml(font: string | undefined): string | null {
  const f = font?.trim();
  if (!f || f === 'Times New Roman') return null;
  const i = FONT_INFO[f] ?? { family: 'auto' as const };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:fonts ${NS_DECL}><w:font w:name="${esc(f)}">${i.alt ? `<w:altName w:val="${i.alt}"/>` : ''}${'panose' in i && i.panose ? `<w:panose1 w:val="${i.panose}"/>` : ''}<w:charset w:val="00"/><w:family w:val="${i.family}"/><w:pitch w:val="variable"/></w:font><w:font w:name="Times New Roman"><w:panose1 w:val="02020603050405020304"/><w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font></w:fonts>`;
}

/** Construit un .docx complet (A4, styles français usuels, vraies notes) depuis un HTML simple. */
export async function htmlToDocx(html: string, title: string, layout: DocLayout = {}): Promise<ArrayBuffer> {
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const ctx: GenCtx = { notes: [], nums: [] };
  let bodyXml = blocksXml(dom.body, ctx);
  if (!bodyXml) bodyXml = paraXml(null, '');
  const ac = !!layout.academic;
  // Police choisie (nouveaux écrits) : table des polices avec sa famille, pour qu'un Word où elle
  // n'est pas installée la remplace par une police de même genre (Literata → une serif, pas Calibri).
  const ft = fontTableXml(layout.font);
  // Présentation universitaire : pied « numéro de page » centré, page de garde sans numéro (titlePg).
  const sectPr = ac ? `<w:sectPr><w:footerReference w:type="default" r:id="rId10"/><w:footerReference w:type="first" r:id="rId11"/>${PG_SZ}${PG_MAR}<w:titlePg/></w:sectPr>` : A4_SECTPR;
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS_DECL}><w:body>${bodyXml}${sectPr}</w:body></w:document>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${ac ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}${ft ? '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>' : ''}</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>${ac ? '<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>' : ''}${ft ? '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>' : ''}</Relationships>`,
  );
  zip.file('word/document.xml', docXml);
  zip.file('word/styles.xml', stylesXml(layout));
  if (ft) zip.file('word/fontTable.xml', ft);
  if (ac) {
    zip.file(
      'word/footer1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${NS_DECL}><w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`,
    );
    zip.file('word/footer2.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${NS_DECL}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr></w:p></w:ftr>`);
  }
  zip.file(
    'word/settings.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings ${NS_DECL}><w:defaultTabStop w:val="708"/><w:hyphenationZone w:val="425"/><w:characterSpacingControl w:val="doNotCompress"/><w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr><w:compat><w:doNotExpandShiftReturn/><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><w:themeFontLang w:val="fr-FR"/></w:settings>`,
  );
  zip.file('word/numbering.xml', numberingXml(ctx.nums.length ? ctx.nums : [{ ordered: false }, { ordered: true }]));
  zip.file('word/footnotes.xml', footnotesXml(ctx.notes));
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:language>fr-FR</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  zip.file(
    'docProps/app.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Marginalia</Application></Properties>`,
  );
  return zipToBuffer(zip);
}
