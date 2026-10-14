// Constitution de la file du jour : dues d'abord, puis nouvelles (plafond par livre et par jour), livres alternés.
import type { ReviewCard } from '../../lib/types';

export interface Filters {
  bookId: string | null;
  kind: ReviewCard['kind'] | null;
  conceptId: string | null;
}
export const NO_FILTERS: Filters = { bookId: null, kind: null, conceptId: null };

export const startOfDay = (now: number) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const endOfDay = (now: number) => {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
};

export const isNew = (c: ReviewCard) => c.fsrs.state === 0;
const bookKey = (c: ReviewCard) => c.bookId ?? '';

/**
 * Carte vue pour la première fois aujourd'hui (heuristique : le modèle ne conserve pas la date de première
 * révision ; une carte dont la dernière révision a eu lieu aujourd'hui, sans jour écoulé ni oubli, est comptée).
 */
export function introducedToday(c: ReviewCard, now: number): boolean {
  const f = c.fsrs;
  return f.state !== 0 && f.last_review != null && f.last_review >= startOfDay(now) && f.elapsed_days === 0 && f.lapses === 0;
}

const matches = (c: ReviewCard, f: Filters) =>
  (!f.bookId || c.bookId === f.bookId) && (!f.kind || c.kind === f.kind) && (!f.conceptId || c.conceptId === f.conceptId);

export interface DayPlan {
  /** Cartes dues aujourd'hui (échéance ≤ fin de journée), les plus anciennes d'abord. */
  due: ReviewCard[];
  /** Nouvelles cartes autorisées (plafond par livre), livres alternés. */
  fresh: ReviewCard[];
  /** Nouvelles cartes en attente au-delà du plafond. */
  waiting: number;
}

export function planDay(cards: ReviewCard[], cap: number, filters: Filters, now: number): DayPlan {
  const end = endOfDay(now);
  const live = cards.filter((c) => !c.suspended);
  const due = live
    .filter((c) => !isNew(c) && c.fsrs.due <= end && matches(c, filters))
    .sort((a, b) => a.fsrs.due - b.fsrs.due);

  const introduced = new Map<string, number>();
  for (const c of live) if (introducedToday(c, now)) introduced.set(bookKey(c), (introduced.get(bookKey(c)) ?? 0) + 1);

  const byBook = new Map<string, ReviewCard[]>();
  for (const c of live.filter((x) => isNew(x) && matches(x, filters)).sort((a, b) => a.createdAt - b.createdAt)) {
    const k = bookKey(c);
    byBook.set(k, [...(byBook.get(k) ?? []), c]);
  }
  const groups: ReviewCard[][] = [];
  let waiting = 0;
  for (const [k, list] of byBook) {
    const quota = Math.max(0, cap - (introduced.get(k) ?? 0));
    groups.push(list.slice(0, quota));
    waiting += Math.max(0, list.length - quota);
  }
  const fresh: ReviewCard[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++) for (const g of groups) if (i < g.length) fresh.push(g[i]);
  return { due, fresh, waiting };
}

/** Nombre de cartes à voir aujourd'hui (dues + nouvelles autorisées), sans filtre. */
export function dueCount(cards: ReviewCard[], cap: number, now: number): number {
  const p = planDay(cards, cap, NO_FILTERS, now);
  return p.due.length + p.fresh.length;
}

/** Prochaine échéance parmi les cartes déjà vues (au-delà de `now`) et nombre de cartes ce jour-là. */
export function nextDue(cards: ReviewCard[], now: number): { at: number; count: number } | null {
  const future = cards.filter((c) => !c.suspended && !isNew(c) && c.fsrs.due > now);
  if (!future.length) return null;
  const at = Math.min(...future.map((c) => c.fsrs.due));
  const day = startOfDay(at);
  return { at, count: future.filter((c) => startOfDay(c.fsrs.due) === day).length };
}

export const dayLabel = (at: number, now: number): string => {
  const d0 = startOfDay(now);
  const diff = Math.round((startOfDay(at) - d0) / 86_400_000);
  if (diff <= 0) return `aujourd’hui à ${new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  if (diff === 1) return 'demain';
  if (diff < 7) return `dans ${diff} j`;
  return `le ${new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
};
