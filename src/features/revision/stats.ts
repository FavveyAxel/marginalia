// Statistiques sobres : cartes par état, série de jours, rétention estimée.
import type { ReviewCard } from '../../lib/types';
import { retrievability } from './fsrs';
import { isNew } from './queue';

const KEY = 'marginalia.revision.days';

export const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function loadDays(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Mémorise (sur cet appareil) qu'une révision a eu lieu ce jour. */
export function recordReviewDay(now: number) {
  try {
    const days = new Set(loadDays());
    days.add(dayKey(now));
    localStorage.setItem(KEY, JSON.stringify([...days].sort().slice(-400)));
  } catch {
    /* stockage indisponible : la série se déduit alors des dernières révisions des cartes */
  }
}

/** Série de jours consécutifs avec révision (aujourd'hui ou, à défaut, hier comme point de départ). */
export function streak(cards: ReviewCard[], now: number): number {
  const days = new Set(loadDays());
  for (const c of cards) if (c.fsrs.last_review) days.add(dayKey(c.fsrs.last_review));
  let t = now;
  if (!days.has(dayKey(t))) t -= 86_400_000;
  let n = 0;
  while (days.has(dayKey(t))) {
    n++;
    t -= 86_400_000;
  }
  return n;
}

export interface StateCounts {
  fresh: number;
  learning: number;
  mastered: number;
  suspended: number;
  retention: number | null;
}

export function stateCounts(cards: ReviewCard[], now: number): StateCounts {
  const out: StateCounts = { fresh: 0, learning: 0, mastered: 0, suspended: 0, retention: null };
  const r: number[] = [];
  for (const c of cards) {
    if (c.suspended) {
      out.suspended++;
      continue;
    }
    if (isNew(c)) out.fresh++;
    else if (c.fsrs.state === 2) {
      out.mastered++;
      r.push(retrievability(c.fsrs, now));
    } else out.learning++;
  }
  if (r.length) out.retention = r.reduce((a, b) => a + b, 0) / r.length;
  return out;
}
