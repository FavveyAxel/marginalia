// ─────────────────────────────────────────────────────────────
// Boîte de dépôt : retrouver un passage (texte copié, texte reconnu sur une photo) dans la
// bibliothèque, pour en faire un extrait ancré au bon endroit.
//
// Principe :
//  1. Texte reçu et livres sont découpés en mots repliés (casse, accents, apostrophes,
//     ligatures), césures de fin de ligne recollées (« philo-\nsophie »), nombres ignorés
//     (numéros de page), titre courant en majuscules retiré en tête / en fin de texte reçu.
//  2. Texte court (< 6 mots) : correspondance exacte de la suite de mots.
//     Sinon : « bardeaux » de 3 mots consécutifs. Les bardeaux du texte reçu trouvés dans le
//     livre forment des « touches » ; la meilleure fenêtre du livre (pas plus de 2× la longueur
//     du texte reçu) est celle dont les touches couvrent le plus de mots du texte reçu.
//     Les touches éloignées de la diagonale dominante sont écartées, puis l'étendue est
//     prolongée mot à mot vers les bornes du texte reçu (mots égaux ou presque : une lettre
//     fausse, mot coupé au bord).
//  3. Score = part des mots du texte reçu retrouvés. Seuil : SCORE_MIN. Si un autre endroit
//     du même livre fait presque aussi bien (passage répété), le score est pénalisé.
//  4. L'étendue est ramenée au chapitre (HTML) ou à la page (PDF) qui en porte le plus.
//
// Index : par livre (id + nom de fichier), en mémoire, construit à la demande.
//  - index léger (gardé) : identifiants des mots + bornes des chapitres / pages ;
//  - détail (textes, positions des mots, géométrie PDF) : petit cache LRU, reconstruit en
//    relisant le fichier si besoin (seulement pour les livres qui correspondent).
// ─────────────────────────────────────────────────────────────
import type { Anchor, Book, NormRect } from '../../lib/types';
import { useStore } from '../../lib/store';
import { host } from '../../lib/platform';
import { makeAnchor } from '../reader/html/anchoring';
import { buildIndex, mergeLineRects, toNorm, type Px } from '../reader/pdf/textindex';
import type { PageMark } from '../reader/html/parse';
import type { WordModel } from '../reader/image/textlayer';

export interface PassageMatch {
  bookId: string;
  /** Ancrage prêt pour addHighlight (html : offsets de chapitre ; pdf/image : page + rectangles normalisés). */
  anchor: Anchor;
  /** Texte exact du livre couvert par l'ancrage (et non le texte reçu, souvent bruité par l'OCR). */
  text: string;
  /** Comme le lecteur : titre du chapitre (html) ou « p. 12 » (pdf). */
  locationLabel: string;
  /** Page imprimée si connue (page-list EPUB, décalage de pages du PDF), sinon ''. */
  printedPage: string;
  /** 0..1 : part du texte reçu retrouvée dans le livre. */
  score: number;
}

export interface FindOptions {
  /** Limiter la recherche à ces livres (choix manuel d'un livre). */
  bookIds?: string[];
  signal?: AbortSignal;
}

// ── Réglages ─────────────────────────────────────────────────

/** Score minimal d'une correspondance retenue. */
const SCORE_MIN = 0.45;
/** En dessous de ce nombre de mots : correspondance exacte exigée. */
const SHORT_WORDS = 6;
/** Texte court : au moins 2 mots et 10 lettres (un mot isolé ne désigne pas un passage). */
const SHORT_MIN_CHARS = 10;
/** Taille des bardeaux (mots consécutifs). */
const K = 3;
/** Second endroit du même livre à moins de cet écart de score : passage ambigu. */
const AMBIGUOUS_GAP = 0.1;
/** Pénalité d'un passage ambigu (répété dans le livre). */
const AMBIGUOUS_FACTOR = 0.8;
/** Livres dont le détail (textes, géométrie) reste en mémoire. */
const DETAIL_LRU = 4;
/** Rendre la main à l'interface au moins toutes les … ms. */
const SLICE_MS = 12;
/** Garde-fou : nombre maximal de touches examinées par livre. */
const MAX_HITS = 200_000;

// ── Repli et découpage en mots ───────────────────────────────

/** Dictionnaire global mot replié → identifiant (et inverse). */
const dict = new Map<string, number>();
const words: string[] = [];
function intern(w: string): number {
  let id = dict.get(w);
  if (id === undefined) {
    id = words.length;
    words.push(w);
    dict.set(w, id);
  }
  return id;
}

/** Repli d'un caractère : null = séparateur, '' = ignoré (marque, césure conditionnelle), sinon lettres. */
const foldTable = new Map<number, string | null>();
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const IGNORED = /^[\p{M}\u00ad\u200b-\u200d\u2060\ufeff]$/u;
function foldChar(cp: number): string | null {
  let f = foldTable.get(cp);
  if (f !== undefined) return f;
  const ch = String.fromCodePoint(cp);
  if (IGNORED.test(ch)) f = '';
  else {
    let s = ch.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
    s = s.replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss');
    let out = '';
    for (const c of s) if (LETTER_OR_DIGIT.test(c)) out += c;
    f = out || null;
  }
  foldTable.set(cp, f);
  return f;
}

/** Trait d'union de césure possible (« ¬ » : lecture OCR fréquente du tiret de fin de ligne). */
const isHyphen = (c: number) => c === 0x2d || c === 0x2010 || c === 0x2011 || c === 0xac;
const isHSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0xa0 || c === 0x202f;
const isNewline = (c: number) => c === 0x0a || c === 0x0d;
const isLower = (ch: string) => ch !== ch.toUpperCase() && ch === ch.toLowerCase();

interface Tokens {
  ids: number[];
  starts: number[];
  ends: number[];
}

/**
 * Découpe `s` en mots repliés (offsets dans `s`). Les nombres seuls sont ignorés.
 * Césure : lettre + « - » + fin de ligne + minuscule → un seul mot.
 */
function tokenize(s: string, out: Tokens = { ids: [], starts: [], ends: [] }): Tokens {
  let cur = '';
  let start = -1;
  let end = -1;
  let digitsOnly = true;
  const flush = () => {
    if (cur && !digitsOnly) {
      out.ids.push(intern(cur));
      out.starts.push(start);
      out.ends.push(end);
    }
    cur = '';
    start = -1;
    digitsOnly = true;
  };
  const n = s.length;
  for (let i = 0; i < n; ) {
    const cp = s.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    const f = foldChar(cp);
    if (f === '') {
      i += len;
      continue;
    }
    if (f === null) {
      if (cur && isHyphen(cp)) {
        let j = i + 1;
        while (j < n && isHSpace(s.charCodeAt(j))) j++;
        if (j < n && isNewline(s.charCodeAt(j))) {
          while (j < n && /\s/.test(s[j])) j++;
          if (j < n && isLower(s[j])) {
            i = j;
            continue;
          }
        }
      }
      flush();
      i += len;
      continue;
    }
    if (!cur) start = i;
    cur += f;
    if (digitsOnly && !/^\d+$/.test(f)) digitsOnly = false;
    end = i + len;
    i += len;
  }
  flush();
  return out;
}

// ── Index ────────────────────────────────────────────────────

interface PdfPageGeo {
  /** Taille de la page (échelle 1). */
  w: number;
  h: number;
  /** Pour chaque élément de texte : début / fin dans le texte de la page. */
  itemStart: Int32Array;
  itemEnd: Int32Array;
  /** left, top, right, bottom (unités de page) par élément. */
  boxes: Float32Array;
  /** Famille de police du calque de texte, par élément (indice dans `fams`). */
  fam: Uint16Array;
  fams: string[];
}

/** Index léger, gardé en mémoire. */
interface LightIndex {
  kind: 'html' | 'pdf' | 'image';
  ids: Int32Array;
  /** Premier mot de chaque unité (chapitre / page), + total en dernière case. */
  unitFirst: Int32Array;
}

/** Détail nécessaire pour construire l'ancrage (reconstruit au besoin). */
interface Detail {
  texts: string[];
  starts: Int32Array;
  ends: Int32Array;
  labels: string[];
  /** HTML : page-list. */
  pages?: PageMark[];
  printedPageAt?: (pages: PageMark[], chapter: number, offset: number) => string;
  /** PDF : géométrie par page et libellés imprimés (null : inutilisables). */
  pdf?: { geo: PdfPageGeo[]; pageLabels: string[] | null };
  /** Image : modèle de mots de l'OCR, par page (une seule pour une image). */
  image?: { models: WordModel[] };
}

interface Built {
  light: LightIndex;
  detail: Detail;
}

const lightCache = new Map<string, Promise<LightIndex | null>>();
const detailLru = new Map<string, Detail>();
const keyOf = (b: Book) => `${b.id}\u0000${b.fileName}`;

function rememberDetail(key: string, d: Detail) {
  detailLru.delete(key);
  detailLru.set(key, d);
  while (detailLru.size > DETAIL_LRU) detailLru.delete(detailLru.keys().next().value!);
}

const abortError = () => new DOMException('Recherche interrompue', 'AbortError');
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

let lastYield = 0;
async function breathe(signal?: AbortSignal) {
  const now = performance.now();
  if (now - lastYield >= SLICE_MS) {
    await new Promise((r) => setTimeout(r, 0));
    lastYield = performance.now();
  }
  checkAbort(signal);
}

function pack(kind: LightIndex['kind'], units: Tokens[], texts: string[], labels: string[], extra: Partial<Detail>): Built {
  let total = 0;
  for (const u of units) total += u.ids.length;
  const ids = new Int32Array(total);
  const starts = new Int32Array(total);
  const ends = new Int32Array(total);
  const unitFirst = new Int32Array(units.length + 1);
  let k = 0;
  units.forEach((u, i) => {
    unitFirst[i] = k;
    ids.set(u.ids, k);
    starts.set(u.starts, k);
    ends.set(u.ends, k);
    k += u.ids.length;
  });
  unitFirst[units.length] = k;
  return { light: { kind, ids, unitFirst }, detail: { texts, starts, ends, labels, ...extra } };
}

async function buildHtml(book: Book, signal?: AbortSignal): Promise<Built> {
  const { parseBook, printedPageAt } = await import('../reader/html/parse');
  const data = await host.readFile(book.id, book.fileName);
  checkAbort(signal);
  const parsed = await parseBook(book, data);
  for (const u of parsed.urls) URL.revokeObjectURL(u);
  const texts: string[] = [];
  const labels: string[] = [];
  const units: Tokens[] = [];
  for (const ch of parsed.chapters) {
    texts.push(ch.text);
    labels.push(ch.label);
    units.push(tokenize(ch.text));
    await breathe(signal);
  }
  // Les éléments DOM des chapitres ne sont pas gardés (seuls textes et libellés le sont).
  return pack('html', units, texts, labels, { pages: parsed.pages, printedPageAt });
}

// Mesures de police (comme le calque de texte de pdf.js, qui affiche le texte dans une police
// de substitution étirée à la largeur de l'élément).
let measureCtx: CanvasRenderingContext2D | null = null;
const metricsCache = new Map<string, { asc: number; desc: number }>();
const familyOf = (f: string | undefined) => (f && f.trim()) || 'sans-serif';
function ctx2d(): CanvasRenderingContext2D | null {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  return measureCtx;
}
function metricsOf(fam: string): { asc: number; desc: number } {
  let m = metricsCache.get(fam);
  if (!m) {
    const c = ctx2d();
    let asc = 0;
    let desc = 0;
    if (c) {
      c.font = `100px ${fam}`;
      const t = c.measureText('');
      asc = (t.fontBoundingBoxAscent ?? 0) / 100;
      desc = Math.abs(t.fontBoundingBoxDescent ?? 0) / 100;
    }
    m = asc > 0 ? { asc, desc } : { asc: 0.9, desc: 0.25 };
    metricsCache.set(fam, m);
  }
  return m;
}
/** Largeur relative (0..1) des `k` premiers caractères de `s` dans la police `fam`. */
function prefixRatio(s: string, k: number, fam: string): number {
  if (k <= 0) return 0;
  if (k >= s.length) return 1;
  const c = ctx2d();
  if (!c) return k / s.length;
  c.font = `100px ${fam}`;
  const all = c.measureText(s).width;
  return all > 0 ? c.measureText(s.slice(0, k)).width / all : k / s.length;
}

async function buildPdf(book: Book, signal?: AbortSignal): Promise<Built> {
  const { openPdf, pdfjsLib } = await import('../reader/pdf/pdfjs');
  const data = await host.readFile(book.id, book.fileName);
  checkAbort(signal);
  const task = openPdf(data);
  try {
    const pdf = await task.promise;
    const texts: string[] = [];
    const labels: string[] = [];
    const units: Tokens[] = [];
    const geo: PdfPageGeo[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent({ includeMarkedContent: false, disableNormalization: true });
      let raw = '';
      const is: number[] = [];
      const ie: number[] = [];
      const bx: number[] = [];
      const fi: number[] = [];
      const fams: string[] = [];
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        const s = it.str;
        if (s) {
          const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
          const fh = Math.hypot(tx[2], tx[3]);
          // Même géométrie que le calque de texte de pdf.js : élément placé à (ligne de base −
          // ascendante relative × hauteur), police de substitution, largeur ramenée à celle du PDF ;
          // le rectangle d'une sélection y est la boîte de contenu de la police (texte horizontal supposé).
          const fam = familyOf(tc.styles[it.fontName]?.fontFamily);
          let f = fams.indexOf(fam);
          if (f < 0) f = fams.push(fam) - 1;
          const { asc, desc } = metricsOf(fam);
          const left = tx[4];
          const top = tx[5] - (asc / (asc + desc)) * fh + ((1 - asc - desc) * fh) / 2;
          const w = it.width * vp.scale || fh * 0.5 * s.length;
          is.push(raw.length);
          raw += s;
          ie.push(raw.length);
          fi.push(f);
          bx.push(left, top, left + w, top + (asc + desc) * fh);
        }
        if (it.hasEOL) raw += '\n';
      }
      page.cleanup();
      texts.push(raw);
      labels.push(`p. ${p}`);
      units.push(tokenize(raw));
      geo.push({ w: vp.width, h: vp.height, itemStart: Int32Array.from(is), itemEnd: Int32Array.from(ie), boxes: Float32Array.from(bx), fam: Uint16Array.from(fi), fams });
      await breathe(signal);
    }
    // Numérotation imprimée : même règle que le lecteur PDF.
    const rawLabels = await pdf.getPageLabels().catch(() => null);
    const usable = !!rawLabels && rawLabels.length === pdf.numPages && rawLabels.some((l, i) => (l ?? '').trim() !== String(i + 1)) && rawLabels.every((l) => (l ?? '').trim());
    return pack('pdf', units, texts, labels, { pdf: { geo, pageLabels: usable ? rawLabels!.map((l) => l.trim()) : null } });
  } finally {
    task.destroy().catch(() => undefined);
  }
}

async function buildImage(book: Book): Promise<Built | null> {
  const [{ loadOcr, ocrKey }, { wordModel }] = await Promise.all([import('../reader/image/ocr'), import('../reader/image/textlayer')]);
  // Document de photos : une unité par page (texte reconnu de chaque page, s'il existe).
  const n = book.pages && book.pages.length > 1 ? book.pages.length : 1;
  const models: WordModel[] = [];
  let any = false;
  for (let pg = 1; pg <= n; pg++) {
    const ocr = await loadOcr(ocrKey(book.id, pg));
    if (ocr) any = true;
    models.push(wordModel(ocr));
  }
  if (!any) return null;
  const labels = n > 1 ? models.map((_, i) => `Page ${i + 1}`) : ['Image'];
  return pack('image', models.map((m) => tokenize(m.raw)), models.map((m) => m.raw), labels, { image: { models } });
}

async function build(book: Book, signal?: AbortSignal): Promise<Built | null> {
  try {
    if (book.format === 'pdf') return await buildPdf(book, signal);
    if (book.format === 'image') return await buildImage(book);
    return await buildHtml(book, signal);
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    // Livre illisible (DRM, fichier absent ou endommagé) : ignoré sans bruit.
    void host.diag?.('boite', 'livre ignoré pour la recherche de passage', book.title, String((e as Error)?.message ?? e));
    return null;
  }
}

/** Index léger d'un livre (construit au besoin). Les images (OCR modifiable) ne sont pas gardées. */
async function lightOf(book: Book, signal?: AbortSignal): Promise<LightIndex | null> {
  if (book.format === 'image') {
    const b = await build(book, signal);
    if (b) rememberDetail(keyOf(book), b.detail);
    return b?.light ?? null;
  }
  const key = keyOf(book);
  for (let attempt = 0; ; attempt++) {
    let p = lightCache.get(key);
    if (!p) {
      p = build(book, signal).then((b) => {
        if (b) rememberDetail(key, b.detail);
        return b?.light ?? null;
      });
      lightCache.set(key, p);
      p.catch(() => {
        if (lightCache.get(key) === p) lightCache.delete(key);
      });
    }
    try {
      return await p;
    } catch (e) {
      // Construction lancée par une autre recherche, interrompue : on la relance pour nous.
      if ((e as Error)?.name === 'AbortError' && !signal?.aborted && attempt < 2) continue;
      throw e;
    }
  }
}

async function detailOf(book: Book, signal?: AbortSignal): Promise<Detail | null> {
  const key = keyOf(book);
  const d = detailLru.get(key);
  if (d) {
    rememberDetail(key, d);
    return d;
  }
  const b = await build(book, signal);
  if (!b) return null;
  rememberDetail(key, b.detail);
  return b.detail;
}

// ── Texte reçu ───────────────────────────────────────────────

interface Query {
  ids: Int32Array;
  chars: number;
  /** Ponctuation ouvrante en tête / finale en fin du texte reçu (à inclure si le livre l'a). */
  leadPunct: boolean;
  trailPunct: boolean;
}

/** Ligne de titre courant (majuscules, courte) ou numéro de page seul. */
function isHeaderLine(line: string): boolean {
  const t = line.replace(/[\d\s.,;:·•\-–—|]+/g, ' ').trim();
  if (!t) return true;
  const letters = t.replace(/[^\p{L}]/gu, '');
  return letters.length > 0 && letters === letters.toUpperCase() && letters !== letters.toLowerCase() && t.split(/\s+/).length <= 8;
}

function prepareQuery(text: string): Query {
  let lines = text.replace(/\r\n?/g, '\n').split('\n');
  // Photo de page : titre courant / numéro en haut ou en bas (seulement si le texte a plusieurs lignes).
  const nonEmpty = lines.filter((l) => l.trim()).length;
  if (nonEmpty >= 3) {
    const firstIdx = lines.findIndex((l) => l.trim());
    if (firstIdx >= 0 && isHeaderLine(lines[firstIdx])) lines[firstIdx] = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      if (isHeaderLine(lines[i])) lines[i] = '';
      break;
    }
  }
  const cleaned = lines.join('\n');
  const t = tokenize(cleaned);
  const trimmed = cleaned.trim();
  return {
    ids: Int32Array.from(t.ids),
    chars: t.ids.reduce((a, id) => a + words[id].length, 0),
    leadPunct: /^[«“"(\[‘]/.test(trimmed),
    trailPunct: /[.;:!?…»”")\]’]$/.test(trimmed),
  };
}

// ── Recherche dans un livre ──────────────────────────────────

interface Found {
  score: number;
  /** Premier et dernier mot (indices globaux) de l'étendue, dans une seule unité. */
  first: number;
  last: number;
  unit: number;
}

const hash3 = (a: number, b: number, c: number) => (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca77) ^ Math.imul(c + 1, 0xc2b2ae3d)) | 0;

function unitAt(ix: LightIndex, tok: number): number {
  const uf = ix.unitFirst;
  let lo = 0;
  let hi = uf.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (uf[mid] <= tok) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Mots égaux ou presque (lettre fausse de l'OCR) ; `edge` : mot coupé au bord du texte reçu. */
function similar(q: number, s: number, edge: 'start' | 'end' | null): boolean {
  if (q === s) return true;
  const a = words[q];
  const b = words[s];
  if (edge === 'start' && a.length >= 2 && b.endsWith(a)) return true;
  if (edge === 'end' && a.length >= 2 && b.startsWith(a)) return true;
  if (a.length < 4 || b.length < 4) return false;
  return levenshtein(a, b, a.length >= 8 ? 2 : 1) <= (a.length >= 8 ? 2 : 1);
}

/** Toutes les occurrences exactes de la suite de mots. */
function exactOccurrences(ix: LightIndex, q: Int32Array, cap = 50): number[] {
  const out: number[] = [];
  const ids = ix.ids;
  const n = q.length;
  const q0 = q[0];
  outer: for (let i = 0; i + n <= ids.length; i++) {
    if (ids[i] !== q0) continue;
    for (let k = 1; k < n; k++) if (ids[i + k] !== q[k]) continue outer;
    out.push(i);
    if (out.length >= cap) break;
  }
  return out;
}

/** Ramène l'étendue [first, last] à l'unité qui en porte le plus de mots. */
function clipToUnit(ix: LightIndex, first: number, last: number): { unit: number; first: number; last: number } {
  const u0 = unitAt(ix, first);
  const u1 = unitAt(ix, last);
  if (u0 === u1) return { unit: u0, first, last };
  let best = u0;
  let bestN = -1;
  for (let u = u0; u <= u1; u++) {
    const n = Math.min(last + 1, ix.unitFirst[u + 1]) - Math.max(first, ix.unitFirst[u]);
    if (n > bestN) {
      bestN = n;
      best = u;
    }
  }
  return { unit: best, first: Math.max(first, ix.unitFirst[best]), last: Math.min(last, ix.unitFirst[best + 1] - 1) };
}

interface Hit {
  s: number;
  q: number;
}

/** Meilleure fenêtre (≤ W mots du livre) : nombre de mots du texte reçu couverts par ses touches. */
function bestWindow(hits: Hit[], n: number, W: number): { cov: number; lo: number; hi: number } {
  const cnt = new Int32Array(n);
  let covered = 0;
  let best = { cov: 0, lo: 0, hi: -1 };
  let l = 0;
  for (let r = 0; r < hits.length; r++) {
    for (let t = hits[r].q; t < hits[r].q + K; t++) if (cnt[t]++ === 0) covered++;
    while (hits[r].s - hits[l].s > W) {
      for (let t = hits[l].q; t < hits[l].q + K; t++) if (--cnt[t] === 0) covered--;
      l++;
    }
    if (covered > best.cov) best = { cov: covered, lo: l, hi: r };
  }
  return best;
}

function searchBook(ix: LightIndex, q: Query): Found | null {
  const n = q.ids.length;
  const ids = ix.ids;
  if (!ids.length) return null;

  if (n < SHORT_WORDS) {
    const occ = exactOccurrences(ix, q.ids);
    if (!occ.length) return null;
    const c = clipToUnit(ix, occ[0], occ[0] + n - 1);
    return { score: occ.length > 1 ? AMBIGUOUS_FACTOR : 1, ...c };
  }

  // Bardeaux du texte reçu.
  const qmap = new Map<number, number[]>();
  for (let j = 0; j + K <= n; j++) {
    const h = hash3(q.ids[j], q.ids[j + 1], q.ids[j + 2]);
    const l = qmap.get(h);
    if (l) l.push(j);
    else qmap.set(h, [j]);
  }
  const hits: Hit[] = [];
  for (let i = 0; i + K <= ids.length; i++) {
    const l = qmap.get(hash3(ids[i], ids[i + 1], ids[i + 2]));
    if (!l) continue;
    for (const j of l) if (ids[i] === q.ids[j] && ids[i + 1] === q.ids[j + 1] && ids[i + 2] === q.ids[j + 2]) hits.push({ s: i, q: j });
    if (hits.length >= MAX_HITS) break;
  }
  if (!hits.length) return null;
  const W = Math.max(2 * n, n + 8);
  const win = bestWindow(hits, n, W);
  if (win.hi < win.lo) return null;

  // Diagonale dominante : les touches isolées (bardeau courant ailleurs dans la fenêtre) sont écartées.
  const inWin = hits.slice(win.lo, win.hi + 1);
  const diags = inWin.map((h) => h.s - h.q).sort((a, b) => a - b);
  const med = diags[diags.length >> 1];
  const tol = Math.max(4, Math.round(0.25 * n));
  const kept = inWin.filter((h) => Math.abs(h.s - h.q - med) <= tol);
  const cov = new Uint8Array(n);
  let sMin = Infinity;
  let sMax = -1;
  let qMin = Infinity;
  let qMax = -1;
  for (const h of kept) {
    for (let t = h.q; t < h.q + K; t++) cov[t] = 1;
    sMin = Math.min(sMin, h.s);
    sMax = Math.max(sMax, h.s + K - 1);
    qMin = Math.min(qMin, h.q);
    qMax = Math.max(qMax, h.q + K - 1);
  }

  // Prolongement vers les bornes du texte reçu (mots égaux ou presque, un saut au plus de chaque côté).
  {
    const uStart = ix.unitFirst[unitAt(ix, sMin)];
    let s = sMin - 1;
    let j = qMin - 1;
    let skips = 0;
    while (j >= 0 && s >= uStart) {
      if (similar(q.ids[j], ids[s], j === 0 ? 'start' : null)) {
        cov[j] = 1;
        sMin = s;
        s--;
        j--;
      } else if (skips < 2 && j > 0 && similar(q.ids[j - 1], ids[s], j - 1 === 0 ? 'start' : null)) {
        j--;
        skips++;
      } else if (skips < 2 && s > uStart && similar(q.ids[j], ids[s - 1], j === 0 ? 'start' : null)) {
        s--;
        skips++;
      } else break;
    }
    const uEnd = ix.unitFirst[unitAt(ix, sMax) + 1] - 1;
    s = sMax + 1;
    j = qMax + 1;
    skips = 0;
    while (j < n && s <= uEnd) {
      if (similar(q.ids[j], ids[s], j === n - 1 ? 'end' : null)) {
        cov[j] = 1;
        sMax = s;
        s++;
        j++;
      } else if (skips < 2 && j < n - 1 && similar(q.ids[j + 1], ids[s], j + 1 === n - 1 ? 'end' : null)) {
        j++;
        skips++;
      } else if (skips < 2 && s < uEnd && similar(q.ids[j], ids[s + 1], j === n - 1 ? 'end' : null)) {
        s++;
        skips++;
      } else break;
    }
  }
  let covered = 0;
  for (let t = 0; t < n; t++) covered += cov[t];
  let score = covered / n;
  if (score < SCORE_MIN) return null;

  // Second endroit du livre (hors de l'étendue retenue) : passage répété ?
  const others = hits.filter((h) => h.s < sMin - n || h.s > sMax + n);
  if (others.length) {
    const second = bestWindow(others, n, W).cov / n;
    if (second >= SCORE_MIN && second > score - AMBIGUOUS_GAP) score *= AMBIGUOUS_FACTOR;
  }
  return { score, ...clipToUnit(ix, sMin, sMax) };
}

// ── Ancrage ──────────────────────────────────────────────────

const OPEN_PUNCT = /[«“"(\[‘]/;
const CLOSE_PUNCT = /[.,;:!?…»”")\]’]/;

/** Étend [cs, ce[ à la ponctuation voisine (« … » ; espace fine française comprise). */
function widenPunct(text: string, cs: number, ce: number, q: Query): [number, number] {
  if (q.trailPunct) {
    let e = ce;
    let k = e;
    if (k < text.length && /[ \u00a0\u202f]/.test(text[k])) k++;
    if (k < text.length && CLOSE_PUNCT.test(text[k])) {
      e = k;
      while (e < text.length && CLOSE_PUNCT.test(text[e])) e++;
      ce = e;
    }
  }
  if (q.leadPunct) {
    let k = cs - 1;
    if (k >= 0 && /[ \u00a0\u202f]/.test(text[k])) k--;
    if (k >= 0 && OPEN_PUNCT.test(text[k])) cs = k;
  }
  return [cs, ce];
}

function pdfRects(g: PdfPageGeo, pageText: string, cs: number, ce: number): NormRect[] {
  const px: Px[] = [];
  for (let k = 0; k < g.itemStart.length; k++) {
    const a = g.itemStart[k];
    const b = g.itemEnd[k];
    if (b <= cs) continue;
    if (a >= ce) break;
    const str = pageText.slice(a, b);
    const fam = g.fams[g.fam[k]];
    const from = prefixRatio(str, Math.max(cs, a) - a, fam);
    const to = prefixRatio(str, Math.min(ce, b) - a, fam);
    const l = g.boxes[4 * k];
    const t = g.boxes[4 * k + 1];
    const r = g.boxes[4 * k + 2];
    const btm = g.boxes[4 * k + 3];
    px.push({ left: l + (r - l) * from, right: l + (r - l) * to, top: t, bottom: btm });
  }
  return mergeLineRects(px).map((r) => toNorm(r, { left: 0, top: 0, width: g.w, height: g.h }));
}

function toMatch(book: Book, ix: LightIndex, d: Detail, f: Found, q: Query): PassageMatch | null {
  const text = d.texts[f.unit];
  if (text == null) return null;
  let cs = d.starts[f.first];
  let ce = d.ends[f.last];
  [cs, ce] = widenPunct(text, cs, ce, q);
  const score = Math.round(f.score * 1000) / 1000;
  if (ix.kind === 'html') {
    return {
      bookId: book.id,
      anchor: makeAnchor(text, f.unit, cs, ce),
      text: text.slice(cs, ce),
      locationLabel: d.labels[f.unit] ?? '',
      printedPage: d.pages && d.printedPageAt ? d.printedPageAt(d.pages, f.unit, cs) : '',
      score,
    };
  }
  if (ix.kind === 'pdf' && d.pdf) {
    const page = f.unit + 1;
    const rects = pdfRects(d.pdf.geo[f.unit], text, cs, ce);
    if (!rects.length) return null;
    const off = book.edition?.pageOffset ?? 0;
    const pl = d.pdf.pageLabels;
    return {
      bookId: book.id,
      anchor: { kind: 'pdf', page, rects },
      text: buildIndex(text.slice(cs, ce)).clean.trim(),
      locationLabel: `p. ${page}`,
      printedPage: !off && pl ? pl[page - 1] ?? String(page) : String(page + off),
      score,
    };
  }
  if (ix.kind === 'image' && d.image) {
    const model = d.image.models[f.unit];
    return model ? imageMatch(book, model, f.unit + 1, d.labels[f.unit] ?? 'Image', cs, ce, score) : null;
  }
  return null;
}

let textlayerMod: typeof import('../reader/image/textlayer') | null = null;

function imageMatch(book: Book, model: WordModel, page: number, label: string, cs: number, ce: number, score: number): PassageMatch | null {
  const tl = textlayerMod;
  if (!tl || !model.words.length) return null;
  const ai = tl.wordAtRaw(model, cs);
  const bi = tl.wordAtRaw(model, Math.max(cs, ce - 1));
  const a = { i: ai, off: Math.max(0, Math.min(model.words[ai].t.length, cs - model.starts[ai])) };
  const b = { i: bi, off: Math.max(0, Math.min(model.words[bi].t.length, ce - model.starts[bi])) };
  const rects = tl.rectsForWords(model, a, b);
  const text = tl.textForWords(model, a, b);
  if (!rects.length || !text) return null;
  const off = book.edition?.pageOffset ?? 0;
  return { bookId: book.id, anchor: { kind: 'pdf', page, rects }, text, locationLabel: label, printedPage: off ? String(page + off) : '', score };
}

// ── API ──────────────────────────────────────────────────────

/**
 * Meilleures correspondances (la meilleure d'abord, au plus une par livre), seulement celles
 * jugées fiables. Liste vide si rien de convaincant.
 */
export async function findPassage(text: string, opts: FindOptions = {}): Promise<PassageMatch[]> {
  const { signal } = opts;
  checkAbort(signal);
  const q = prepareQuery(text ?? '');
  const n = q.ids.length;
  if (n < 2 || (n < SHORT_WORDS && q.chars < SHORT_MIN_CHARS)) return [];

  // Livres sans texte à fouiller : livres papier, livres reçus sans leur fichier.
  let books = useStore.getState().books.filter((b) => b.format !== 'paper' && !b.missing);
  if (opts.bookIds) {
    const want = new Set(opts.bookIds);
    books = books.filter((b) => want.has(b.id));
  }
  if (books.some((b) => b.format === 'image')) textlayerMod ??= await import('../reader/image/textlayer');
  lastYield = performance.now();

  const found: { book: Book; ix: LightIndex; f: Found }[] = [];
  for (const book of books) {
    const ix = await lightOf(book, signal);
    if (!ix) continue;
    const f = searchBook(ix, q);
    if (f && f.score >= SCORE_MIN) found.push({ book, ix, f });
    await breathe(signal);
  }

  const out: PassageMatch[] = [];
  for (const { book, ix, f } of found) {
    const d = await detailOf(book, signal);
    if (!d) continue;
    const m = toMatch(book, ix, d, f, q);
    if (m) out.push(m);
    checkAbort(signal);
  }
  // À score égal : le livre ouvert le plus récemment (celui qu'on est probablement en train de lire).
  out.sort((a, b) => b.score - a.score || (lastOpened(b.bookId) - lastOpened(a.bookId)));
  return out;
}

function lastOpened(id: string): number {
  return useStore.getState().books.find((b) => b.id === id)?.lastOpenedAt ?? 0;
}

/** Oublie les index en mémoire (livre supprimé ou remplacé). Sans argument : tout. */
export function forgetIndex(bookId?: string): void {
  if (bookId === undefined) {
    lightCache.clear();
    detailLru.clear();
    return;
  }
  const prefix = `${bookId}\u0000`;
  for (const k of [...lightCache.keys()]) if (k.startsWith(prefix)) lightCache.delete(k);
  for (const k of [...detailLru.keys()]) if (k.startsWith(prefix)) detailLru.delete(k);
}
