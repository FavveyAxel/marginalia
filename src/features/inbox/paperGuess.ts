// ─────────────────────────────────────────────────────────────
// Photo d'une page de livre papier : deviner, EN LOCAL, de quel livre papier et de quelle page il
// s'agit, pour PROPOSER le rattachement (« Du contrat social, p. 47 ? ») ; l'utilisateur confirme.
//  1. Titre courant / auteur lus par l'OCR en haut (ou en bas) de la page : comparés aux titres et
//     auteurs des livres papier de la bibliothèque (mots repliés : casse, accents, ligatures).
//  2. Sinon : le livre de la série de photos en cours (« Ajouter par photo » sur la page du livre),
//     puis le livre du dernier extrait papier (dans les dernières heures).
//  3. Numéro de page : un nombre seul en début ou en fin de la première ou de la dernière ligne.
// Rien ne quitte l'ordinateur : ni la photo, ni son texte.
// ─────────────────────────────────────────────────────────────
import type { OcrData, OcrLine } from '../reader/image/ocr';
import type { Book, Highlight } from '../../lib/types';

export interface PaperGuess {
  /** Livre proposé (null : à choisir dans la liste). */
  bookId: string | null;
  /** Comment il a été deviné. */
  reason: 'header' | 'series' | 'last' | null;
  /** Page lue sur la photo ('' : inconnue). */
  page: string;
  /** Texte de la page sans le titre courant ni le numéro de page. */
  text: string;
}

const STOP = new Set(['le', 'la', 'les', 'de', 'des', 'du', 'un', 'une', 'et', 'ou', 'en', 'au', 'aux', 'a', 'l', 'd', 'the', 'of', 'and', 'sur', 'par', 'pour', 'dans']);

export function foldWords(s: string): string[] {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
const meaningful = (s: string) => foldWords(s).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));

const lineText = (l: OcrLine) => l.words.map((w) => w.t).join(' ');
const lineTop = (l: OcrLine) => Math.min(...l.words.map((w) => w.y));
const lineBottom = (l: OcrLine) => Math.max(...l.words.map((w) => w.y + w.h));

/** Lignes de la page dans l'ordre de lecture (haut en bas). */
function linesOf(ocr: OcrData): OcrLine[] {
  return ocr.paras.flatMap((p) => p.lines).filter((l) => l.words.length).sort((a, b) => lineTop(a) - lineTop(b));
}

/** Numéro de page : nombre seul (1 à 4 chiffres) au début ou à la fin d'une ligne de bord. */
function pageIn(l: OcrLine | undefined): string {
  if (!l) return '';
  const words = l.words.map((w) => w.t.replace(/[^\p{L}\p{N}]/gu, ''));
  const cand = [words[0], words[words.length - 1]].filter((w) => w && /^\d{1,4}$/.test(w));
  const n = cand.map(Number).find((x) => x > 0 && x < 3000);
  return n ? String(n) : '';
}

/** Ligne de bord : courte (titre courant, numéro), à moins de 14 % du haut ou du bas de l'image. */
const isHeaderLine = (l: OcrLine) => lineTop(l) < 0.14 && l.words.length <= 9;
const isFooterLine = (l: OcrLine) => lineBottom(l) > 0.86 && l.words.length <= 4;

/** Score 0..1 d'un livre papier pour un titre courant : mots du titre (ou nom de l'auteur) retrouvés. */
export function headerScore(header: string, book: Pick<Book, 'title' | 'author'>): number {
  const have = new Set(foldWords(header));
  if (!have.size) return 0;
  const title = meaningful(book.title.split(/[.:]/)[0] || book.title);
  const tScore = title.length ? title.filter((w) => have.has(w)).length / title.length : 0;
  const last = meaningful(book.author).pop();
  const aScore = last && have.has(last) ? 0.75 : 0;
  return Math.max(tScore, aScore);
}

export function guessPaperBook(
  ocr: OcrData | null,
  ctx: { books: Book[]; highlights: Highlight[]; series: { bookId: string; at: number } | null; now?: number },
): PaperGuess {
  const now = ctx.now ?? Date.now();
  const papers = ctx.books.filter((b) => b.format === 'paper');
  const lines = ocr ? linesOf(ocr) : [];
  // Lignes du haut : titre courant (reconnu par un livre papier) ou numéro de page seul. Une ligne
  // de texte ordinaire en haut d'une photo bien cadrée reste dans le texte.
  const top = lines.filter(isHeaderLine).slice(0, 2);
  const best = (t: string) => papers.map((b) => ({ b, s: headerScore(t, b) })).sort((x, y) => y.s - x.s);
  const head = top.filter((l) => (best(lineText(l))[0]?.s ?? 0) >= 0.6 || (!!pageIn(l) && l.words.length <= 6));
  const foot = lines.filter((l) => !head.includes(l) && isFooterLine(l) && !!pageIn(l)).slice(-1);
  const page = pageIn(head[0]) || pageIn(head[1]) || pageIn(foot[0]);
  // Texte de la page : sans titre courant ni numéro de page.
  const body = lines.filter((l) => !head.includes(l) && !foot.includes(l));
  const text = body
    .map(lineText)
    .join('\n')
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .replace(/\n(?!\n)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 1. Titre courant ou auteur en haut de page.
  const headerText = head.map(lineText).join(' ');
  if (headerText && papers.length) {
    const scored = best(headerText);
    if (scored[0].s >= 0.6 && (scored.length === 1 || scored[1].s < scored[0].s)) return { bookId: scored[0].b.id, reason: 'header', page, text };
  }
  // 2. Série de photos en cours (dans la dernière heure).
  if (ctx.series && now - ctx.series.at < 3_600_000 && papers.some((b) => b.id === ctx.series!.bookId)) return { bookId: ctx.series.bookId, reason: 'series', page, text };
  // 3. Livre du dernier extrait papier (dans les 6 dernières heures).
  const paperIds = new Set(papers.map((b) => b.id));
  const last = ctx.highlights.filter((h) => paperIds.has(h.bookId) && now - h.createdAt < 6 * 3_600_000).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (last) return { bookId: last.bookId, reason: 'last', page, text };
  return { bookId: null, reason: null, page, text };
}
