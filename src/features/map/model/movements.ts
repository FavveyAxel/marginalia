// ─────────────────────────────────────────────────────────────
// Carte d'un mouvement de fiche-texte (pur, sans store ni DOM).
//
// Étendue d'un mouvement : de son ancrage de début jusqu'au début du mouvement suivant
// (dans l'ordre du texte, voir sortMovements), ou jusqu'à la fin du livre pour le dernier.
//
// API :
//   movementMapKey(studyId, movementId)          → string   clé de la carte dans `maps`
//   movementRange(study, movementId)             → { movement, index, next } | null
//   highlightsInMovement(study, movementId, hls, { categorizedOnly? }) → Highlight[] (ordre du texte)
//   movementCandidates(map, study, hls)          → Highlight[] extraits catégorisés du mouvement pas encore placés
//   movementTitle(study, movementId)             → « Titre de la fiche — I. Titre du mouvement »
//   findMovementMap(maps, studyId, movementId)   → ArgumentMap | null
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, Highlight, Movement, TextStudy } from '../../../lib/types';
import { compareAnchors, roman, sortMovements } from '../../study/studyUtils';

export const movementMapKey = (studyId: string, movementId: string) => `mv-${studyId}-${movementId}`;

export function movementRange(study: TextStudy, movementId: string): { movement: Movement; index: number; next: Movement | null } | null {
  const list = sortMovements(study.movements);
  const index = list.findIndex((m) => m.id === movementId);
  if (index < 0) return null;
  return { movement: list[index], index, next: list[index + 1] ?? null };
}

export function highlightsInMovement(study: TextStudy, movementId: string, highlights: Highlight[], opts: { categorizedOnly?: boolean } = {}): Highlight[] {
  const r = movementRange(study, movementId);
  if (!r) return [];
  return highlights
    .filter(
      (h) =>
        h.bookId === study.bookId &&
        (!opts.categorizedOnly || h.category !== null) &&
        compareAnchors(h.anchor, r.movement.anchor) >= 0 &&
        (!r.next || compareAnchors(h.anchor, r.next.anchor) < 0),
    )
    .sort((a, b) => compareAnchors(a.anchor, b.anchor));
}

/** Extraits catégorisés du mouvement qui ne sont pas encore sur la carte (à proposer). */
export function movementCandidates(map: ArgumentMap, study: TextStudy, highlights: Highlight[]): Highlight[] {
  if (!map.movementId) return [];
  const placed = new Set(map.nodes.map((n) => n.highlightId).filter(Boolean));
  return highlightsInMovement(study, map.movementId, highlights, { categorizedOnly: true }).filter((h) => !placed.has(h.id));
}

export function movementTitle(study: TextStudy, movementId: string): string {
  const r = movementRange(study, movementId);
  if (!r) return study.title.trim() || 'Mouvement';
  const mv = `${roman(r.index + 1)}. ${r.movement.title.trim() || `Mouvement ${r.index + 1}`}`;
  return study.title.trim() ? `${study.title.trim()} — ${mv}` : mv;
}

export function findMovementMap(maps: Record<string, ArgumentMap>, studyId: string, movementId: string): ArgumentMap | null {
  const direct = maps[movementMapKey(studyId, movementId)];
  if (direct) return direct;
  return Object.values(maps).find((m) => m.kind === 'movement' && m.studyId === studyId && m.movementId === movementId) ?? null;
}
