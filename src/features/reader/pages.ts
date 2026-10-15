// Pages d'un livre : pages imprimées (EPUB : page-list, pageList NCX, repères pagebreak ;
// PDF : libellés de page) ou, à défaut, pagination estimée. Module partagé par le lecteur
// (repères de page, indicateur « p. 12 / 240 », « Aller à la page… ») et par la palette ⌘K.
//
// Pagination estimée (EPUB sans pages imprimées) : une page tous les ~SYNTH_PAGE caractères
// du texte canonique, coupée à une frontière de paragraphe (sinon de mot), comptée en continu
// d'un chapitre à l'autre. Elle ne dépend que du texte : les numéros ne bougent pas quand on
// change la police, la taille, l'interligne ou la largeur de la fenêtre.

export interface PageEntry {
  chapter: number;
  offset: number;
  label: string;
}

export interface Pagination {
  /** printed : pages du livre imprimé ; estimated : découpage de Marginalia. */
  kind: 'printed' | 'estimated';
  pages: PageEntry[];
}

/** Taille d'une page estimée (caractères), proche d'une page de livre de poche. */
export const SYNTH_PAGE = 1800;
/** Une nouvelle page s'ouvre au début d'un chapitre si la page en cours a déjà ce nombre de caractères. */
const CHAPTER_BREAK_MIN = 600;
/** Fenêtre de recherche d'une fin de paragraphe autour de la coupe visée. */
const PARA_WINDOW = 450;
const WORD_WINDOW = 200;

export const ESTIMATED_NOTE = 'pagination estimée (le livre n’indique pas ses pages imprimées)';

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

/** Coupe la plus proche de `target` dans [lo, hi] : début de paragraphe, sinon début de mot. */
function snap(t: string, target: number, lo: number, hi: number): number {
  let best = -1;
  for (let d = 0; d <= PARA_WINDOW; d++) {
    for (const i of d ? [target - d, target + d] : [target]) {
      if (i < lo || i > hi) continue;
      if (t[i - 1] === '\n' && !isSpace(t[i])) {
        best = i;
        break;
      }
    }
    if (best >= 0) return best;
  }
  for (let d = 0; d <= WORD_WINDOW; d++) {
    for (const i of d ? [target - d, target + d] : [target]) {
      if (i < lo || i > hi) continue;
      if (isSpace(t[i - 1]) && !isSpace(t[i])) return i;
    }
  }
  return Math.max(lo, Math.min(hi, target));
}

/** Pagination estimée, déterministe, à partir des seuls textes des chapitres. */
export function estimatedPages(texts: string[]): PageEntry[] {
  const out: PageEntry[] = [];
  if (!texts.length) return out;
  out.push({ chapter: 0, offset: 0, label: '1' });
  let acc = 0; // caractères de la page en cours
  for (let c = 0; c < texts.length; c++) {
    const t = texts[c];
    if (c > 0 && acc >= CHAPTER_BREAK_MIN) {
      out.push({ chapter: c, offset: 0, label: String(out.length + 1) });
      acc = 0;
    }
    let pos = 0;
    for (;;) {
      const target = pos + (SYNTH_PAGE - acc);
      // Pas de coupe qui laisserait une queue de page minuscule en fin de chapitre.
      if (target >= t.length - SYNTH_PAGE * 0.25) {
        acc += t.length - pos;
        break;
      }
      const b = snap(t, target, Math.max(pos + 1, target - PARA_WINDOW), Math.min(t.length - 1, target + PARA_WINDOW));
      out.push({ chapter: c, offset: b, label: String(out.length + 1) });
      acc = 0;
      pos = b;
    }
  }
  return out;
}

/** Pages imprimées si le livre en donne, sinon pagination estimée. */
export function paginate(printed: PageEntry[], texts: string[]): Pagination {
  if (printed.length) return { kind: 'printed', pages: printed };
  return { kind: 'estimated', pages: estimatedPages(texts) };
}

/** Index de la page qui couvre (chapitre, offset) ; -1 avant la première page. */
export function pageIndexAt(pages: PageEntry[], chapter: number, offset: number): number {
  let lo = 0;
  let hi = pages.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = pages[mid];
    if (p.chapter < chapter || (p.chapter === chapter && p.offset <= offset)) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

// ── Numéros romains ──────────────────────────────────────────

const ROMAN_RE = /^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

export function romanToInt(s: string): number | null {
  if (!s || !ROMAN_RE.test(s)) return null;
  const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const t = s.toLowerCase();
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const a = v[t[i]];
    const b = v[t[i + 1]] ?? 0;
    n += a < b ? -a : a;
  }
  return n;
}

// ── « Aller à la page… » ─────────────────────────────────────

/**
 * Extrait le numéro demandé : « 45 », « p 45 », « p. 45 », « page 45 », « p. xii », « page iv ».
 * Sans préfixe, seuls les chiffres arabes sont acceptés (« mix » n'est pas une page) ;
 * `requirePrefix` : le préfixe est obligatoire.
 */
export function parsePageQuery(input: string, { requirePrefix = false }: { requirePrefix?: boolean } = {}): string | null {
  const s = input.trim().replace(/\s+/g, ' ');
  const m = /^(?:(p(?:age|g)?\.?)\s*)?([0-9]{1,6}|[ivxlcdm]{1,12})$/i.exec(s);
  if (!m) return null;
  const prefixed = !!m[1];
  const val = m[2];
  if (!prefixed && (requirePrefix || !/^[0-9]+$/.test(val))) return null;
  if (!/^[0-9]+$/.test(val) && romanToInt(val) === null) return null;
  return val.toLowerCase();
}

const norm = (s: string) => s.trim().toLowerCase().replace(/^p(?:age)?\.?\s*/, '');

/** Dernière page « parlante » (dernier libellé arabe, sinon le dernier libellé). */
export function lastLabel(labels: string[]): string {
  for (let i = labels.length - 1; i >= 0; i--) if (/^[0-9]+$/.test(labels[i].trim())) return labels[i].trim();
  return labels[labels.length - 1]?.trim() ?? '';
}

export type PageLookup = { ok: true; index: number } | { ok: false; message: string };

/**
 * Trouve la page demandée parmi les libellés (dans l'ordre du livre).
 * 1. libellé identique (« 12 », « xii », insensible à la casse) ;
 * 2. numéro arabe absent mais compris entre deux pages du livre (page blanche non repérée) :
 *    la page précédente la plus proche ;
 * sinon un message clair : « Ce livre n'a pas de page 900 — dernière page : 412 ».
 */
export function findPage(labels: string[], query: string): PageLookup {
  const q = norm(query);
  const last = lastLabel(labels);
  const fail = (): PageLookup => ({
    ok: false,
    message: q ? `Ce livre n’a pas de page ${q}${last ? ` — dernière page : ${last}` : ''}` : 'Indiquez un numéro de page',
  });
  if (!q || !labels.length) return fail();
  const exact = labels.findIndex((l) => l.trim().toLowerCase() === q);
  if (exact >= 0) return { ok: true, index: exact };
  if (/^[0-9]+$/.test(q)) {
    const n = Number(q);
    let below = -1;
    let min = Infinity;
    let max = -Infinity;
    labels.forEach((l, i) => {
      if (!/^[0-9]+$/.test(l.trim())) return;
      const v = Number(l.trim());
      min = Math.min(min, v);
      max = Math.max(max, v);
      if (v <= n && (below < 0 || v >= Number(labels[below].trim()))) below = i;
    });
    if (n >= min && n <= max && below >= 0) return { ok: true, index: below };
  } else {
    const r = romanToInt(q);
    if (r !== null) {
      const i = labels.findIndex((l) => romanToInt(l.trim()) === r);
      if (i >= 0) return { ok: true, index: i };
    }
  }
  return fail();
}

// ── Page courante d'un volet (pour l'indicateur et la palette) ──

/** Ce que le lecteur affiche dans l'indicateur « p. 12 / 240 ». */
export interface PageStatus {
  /** Libellé de la page courante ('' avant la première page repérée). */
  label: string;
  /** Dernière page (« 412 », ou le nombre de pages estimées). */
  last: string;
  /** Nombre de pages repérées. */
  count: number;
  estimated: boolean;
  /** PDF : numéro de la page dans le fichier quand il diffère du libellé imprimé. */
  physical?: number;
}

/** Demande d'« Aller à la page » adressée à un volet. */
export interface PageRequest {
  nonce: number;
  /** Absent : ouvrir le champ ; présent : y aller directement (palette ⌘K). */
  query?: string;
}

/** Événement : « Aller à la page » demandé hors du lecteur (palette ⌘K). detail : { query?: string } (sans query : ouvrir le champ). */
export const GOTO_PAGE_EVENT = 'marginalia:goto-page';

export function requestGoToPage(query?: string) {
  window.dispatchEvent(new CustomEvent(GOTO_PAGE_EVENT, { detail: { query } }));
}
