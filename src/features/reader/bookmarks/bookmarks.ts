// Signets : libellés proposés, ordre dans le texte, teintes, navigation suivant / précédent.
// Pur (aucun accès au DOM) : partagé par le lecteur, le panneau de l'éditeur et la palette ⌘K.
import type { Bookmark, BookmarkColor, ReaderPosition } from '../../../lib/types';
import type { BookmarkPoint } from '../engine';

export const BOOKMARK_COLORS: { id: BookmarkColor; label: string; cssVar: string }[] = [
  { id: 'rouge', label: 'Rouge', cssVar: '--cat-objection' },
  { id: 'orange', label: 'Orange', cssVar: '--cat-probleme' },
  { id: 'jaune', label: 'Jaune', cssVar: '--cat-these' },
  { id: 'vert', label: 'Vert', cssVar: '--cat-argument' },
  { id: 'bleu', label: 'Bleu', cssVar: '--cat-concept' },
  { id: 'violet', label: 'Violet', cssVar: '--cat-exemple' },
];

/** Couleur CSS d'un signet (teinte par défaut : l'accent du lecteur). */
export function bookmarkColor(c: BookmarkColor | null | undefined): string {
  const found = c ? BOOKMARK_COLORS.find((x) => x.id === c) : null;
  return found ? `var(${found.cssVar})` : 'var(--bm-default)';
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Coupe à `max` caractères sur une fin de mot, avec « … » si coupé. */
export function clipWords(s: string, max = 44): string {
  const t = squash(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–—-]+$/, '') + '…';
}

/** Début de la phrase qui commence à (ou contient) `offset` dans `text`. */
export function sentenceAt(text: string, offset: number): string {
  let i = Math.max(0, Math.min(offset, text.length));
  // Revenir au début de la phrase, sans quitter le paragraphe.
  for (let k = i; k > 0 && i - k < 400; k--) {
    const c = text[k - 1];
    if (c === '\n') break;
    if (/[.!?…]/.test(c) && /\s/.test(text[k] ?? '')) break;
    i = k - 1;
  }
  const end = text.indexOf('\n', i);
  return squash(text.slice(i, end < 0 ? Math.min(text.length, i + 240) : Math.min(end, i + 240)));
}

/** Libellé proposé : « Section — début de la phrase… » (ou l'un des deux s'il manque l'autre). */
export function proposeLabel(section: string, phrase: string): string {
  const sec = clipWords(section, 40);
  const ph = clipWords(phrase.replace(/^[«"“\s]+/, ''), sec ? 36 : 56);
  if (sec && ph && sec.toLowerCase() !== ph.replace(/…$/, '').toLowerCase()) return `${sec} — ${ph}`;
  return sec || ph || 'Signet';
}

/** Clé d'ordre dans le texte : (chapitre ou page, position dans le chapitre ou la page). */
export function orderKey(b: { position: ReaderPosition; anchor?: Bookmark['anchor'] }): [number, number] {
  const a = b.anchor;
  if (a?.kind === 'html') return [a.chapter, a.start];
  if (a?.kind === 'pdf') return [a.page, a.rects[0]?.y ?? 0];
  const p = b.position;
  // Sans ancrage : la fraction du chapitre, ramenée à une échelle d'offsets plausible.
  if (p.kind === 'html') return [p.chapter, Math.round(p.scroll * 1e6)];
  return [p.page, p.offset];
}

export function compareKeys(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

export function sortBookmarks(list: Bookmark[]): Bookmark[] {
  return [...list].sort((a, b) => compareKeys(orderKey(a), orderKey(b)) || a.createdAt - b.createdAt);
}

/**
 * Signet suivant (dir 1) ou précédent (dir -1) par rapport à l'endroit lu.
 * `atView` : le signet déjà à l'endroit lu, ignoré (sinon on y reviendrait).
 */
export function neighbour(list: Bookmark[], here: BookmarkPoint | null, atView: string | null, dir: 1 | -1): Bookmark | null {
  const sorted = sortBookmarks(list);
  if (!sorted.length) return null;
  const at = atView ? sorted.findIndex((b) => b.id === atView) : -1;
  if (at >= 0) return sorted[at + dir] ?? null;
  if (!here) return dir === 1 ? sorted[0] : sorted[sorted.length - 1];
  const key = orderKey(here);
  if (dir === 1) return sorted.find((b) => compareKeys(orderKey(b), key) > 0) ?? null;
  for (let i = sorted.length - 1; i >= 0; i--) if (compareKeys(orderKey(sorted[i]), key) < 0) return sorted[i];
  return null;
}

/** Ligne de localisation d'un signet : « Chapitre II · 34 % » ou « p. 42 ». */
export function whereOf(b: Bookmark): string {
  const loc = b.locationLabel || (b.position.kind === 'pdf' ? `p. ${b.position.page}` : '');
  const pct = typeof b.progress === 'number' && b.position.kind === 'html' ? `${Math.round(b.progress * 100)} %` : '';
  return [loc, pct].filter(Boolean).join(' · ');
}
