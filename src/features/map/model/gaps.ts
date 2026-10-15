// ─────────────────────────────────────────────────────────────
// Signaux de manques d'une carte (pur, sans store ni DOM).
//
//   - thèse sans argument : thèse (catégorie « Thèse » ou carte centrale) qu'aucun lien « soutient » n'appuie ;
//   - objection sans réponse : objection (catégorie « Thèse adverse » ou source d'un lien « objecte à »)
//     qu'aucun lien « répond à » ne vise ;
//   - extraits catégorisés non placés : extraits du livre (carte de livre), du mouvement (carte de
//     mouvement) ou des livres cités (carte libre) qui ont une catégorie mais ne sont pas sur la carte ;
//   - cartes isolées : cartes sans aucun lien (seulement quand la carte en compte au moins deux ;
//     les cartes « Problème », qui n'ont pas de relation propre, ne comptent pas).
//
// API :
//   mapGaps(map, lk)        → MapGaps
//   gapMessages(gaps)       → GapMessage[]   phrases prêtes à afficher (« 2 objections sans réponse »)
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, Highlight } from '../../../lib/types';
import { mapBookIds, mapKindOf, nodeCategory, type MapLookup } from './core';
import { highlightsInMovement } from './movements';

export interface MapGaps {
  thesesWithoutArgument: string[];
  objectionsWithoutAnswer: string[];
  unplaced: { count: number; highlightIds: string[] };
  isolated: string[];
  /** Nombre total de signaux (0 : rien à signaler). */
  total: number;
}

export interface GapMessage {
  kind: 'these' | 'objection' | 'unplaced' | 'isolated';
  text: string;
  /** Cartes concernées (vide pour les extraits non placés : voir highlightIds). */
  nodeIds: string[];
  highlightIds: string[];
}

/** Extraits « du périmètre » de la carte (selon sa nature). */
export function scopeHighlights(map: ArgumentMap, lk: MapLookup): Highlight[] {
  const kind = mapKindOf(map);
  if (kind === 'movement' && map.studyId && map.movementId) {
    const st = lk.studies?.find((s) => s.id === map.studyId);
    if (st) return highlightsInMovement(st, map.movementId, lk.highlights);
  }
  const books = new Set(kind === 'board' ? mapBookIds(map, lk) : [map.bookId]);
  return lk.highlights.filter((h) => books.has(h.bookId));
}

export function mapGaps(map: ArgumentMap, lk: MapLookup): MapGaps {
  const cat = new Map(map.nodes.map((n) => [n.id, nodeCategory(n, lk)]));
  const hasIn = (id: string, rel: string) => map.edges.some((e) => e.target === id && e.relation === rel);
  const theses = map.nodes.filter((n) => cat.get(n.id) === 'these' || n.id === map.centralId);
  const objections = map.nodes.filter((n) => cat.get(n.id) === 'objection' || map.edges.some((e) => e.source === n.id && e.relation === 'objecte'));
  const placed = new Set(map.nodes.map((n) => n.highlightId).filter(Boolean) as string[]);
  const unplacedIds = scopeHighlights(map, lk)
    .filter((h) => h.category !== null && !placed.has(h.id))
    .map((h) => h.id);
  const linked = new Set(map.edges.flatMap((e) => [e.source, e.target]));
  // Le problème n'a pas de relation propre vers la thèse : jamais compté comme isolé.
  const isolated = map.nodes.length > 1 ? map.nodes.filter((n) => !linked.has(n.id) && cat.get(n.id) !== 'probleme').map((n) => n.id) : [];
  const out: MapGaps = {
    thesesWithoutArgument: theses.filter((n) => !hasIn(n.id, 'soutient')).map((n) => n.id),
    objectionsWithoutAnswer: objections.filter((n) => !hasIn(n.id, 'repond')).map((n) => n.id),
    unplaced: { count: unplacedIds.length, highlightIds: unplacedIds },
    isolated,
    total: 0,
  };
  out.total = out.thesesWithoutArgument.length + out.objectionsWithoutAnswer.length + (out.unplaced.count ? 1 : 0) + out.isolated.length;
  return out;
}

const n = (k: number, one: string, many: string) => `${k} ${k > 1 ? many : one}`;

export function gapMessages(g: MapGaps): GapMessage[] {
  const out: GapMessage[] = [];
  if (g.thesesWithoutArgument.length)
    out.push({ kind: 'these', text: `${n(g.thesesWithoutArgument.length, 'thèse', 'thèses')} sans argument`, nodeIds: g.thesesWithoutArgument, highlightIds: [] });
  if (g.objectionsWithoutAnswer.length)
    out.push({ kind: 'objection', text: `${n(g.objectionsWithoutAnswer.length, 'objection', 'objections')} sans réponse`, nodeIds: g.objectionsWithoutAnswer, highlightIds: [] });
  if (g.unplaced.count)
    out.push({ kind: 'unplaced', text: `${n(g.unplaced.count, 'extrait catégorisé', 'extraits catégorisés')} pas encore sur la carte`, nodeIds: [], highlightIds: g.unplaced.highlightIds });
  if (g.isolated.length) out.push({ kind: 'isolated', text: `${n(g.isolated.length, 'carte isolée', 'cartes isolées')} (sans lien)`, nodeIds: g.isolated, highlightIds: [] });
  return out;
}
