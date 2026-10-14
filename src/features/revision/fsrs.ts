// Pont entre ReviewCard.fsrs (dates en ms) et les cartes de ts-fsrs 5.4.2.
import { createEmptyCard, fsrs, Rating, type Card, type Grade, type State } from 'ts-fsrs';
import type { ReviewCard } from '../../lib/types';

export type FsrsState = ReviewCard['fsrs'];

/** Planificateur par défaut : rétention 90 %, étapes d'apprentissage 1 min / 10 min, sans « fuzz » (déterministe). */
export const scheduler = fsrs();

export const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

export const GRADE_LABEL: Record<number, string> = {
  [Rating.Again]: 'À revoir',
  [Rating.Hard]: 'Difficile',
  [Rating.Good]: 'Bien',
  [Rating.Easy]: 'Facile',
};

export function toCard(s: FsrsState): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as State,
    last_review: s.last_review == null ? undefined : new Date(s.last_review),
  };
}

export function fromCard(c: Card): FsrsState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as number,
    last_review: c.last_review ? c.last_review.getTime() : null,
  };
}

/** État initial d'une carte neuve (échue immédiatement). */
export function newFsrs(now = Date.now()): FsrsState {
  return fromCard(createEmptyCard(now));
}

export interface GradePreview {
  grade: Grade;
  label: string;
  due: number;
  interval: string;
}

/** Intervalles prévus pour les quatre notes, à l'instant `now`. */
export function previewGrades(s: FsrsState, now: number): GradePreview[] {
  const rec = scheduler.repeat(toCard(s), now);
  return GRADES.map((g) => {
    const due = rec[g].card.due.getTime();
    return { grade: g, label: GRADE_LABEL[g], due, interval: formatInterval(due - now) };
  });
}

/** Applique une note et renvoie le nouvel état sérialisé. */
export function applyGrade(s: FsrsState, grade: Grade, now: number): FsrsState {
  return fromCard(scheduler.next(toCard(s), now, grade).card);
}

/** Probabilité estimée de rappel (0-1) d'une carte déjà vue. */
export function retrievability(s: FsrsState, now: number): number {
  return scheduler.get_retrievability(toCard(s), now, false);
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const fr = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));

/** « 10 min », « 3 h », « 3 j », « 2 mois », « 1,2 an ». */
export function formatInterval(ms: number): string {
  if (ms < MIN) return '< 1 min';
  if (ms < HOUR) return `${Math.round(ms / MIN)} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)} j`;
  if (days < 365) {
    const m = Math.round((days / 30.44) * 10) / 10;
    return `${fr(m)} mois`;
  }
  const y = Math.round((days / 365.25) * 10) / 10;
  return `${fr(y)} ${y >= 2 ? 'ans' : 'an'}`;
}
