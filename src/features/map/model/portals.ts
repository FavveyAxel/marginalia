// ─────────────────────────────────────────────────────────────
// Portails entre cartes (pur, sans store ni DOM).
//
// Une carte (MapNode) peut être un « portail » vers une autre carte : `portal` = clé de la
// carte cible dans `maps` (carte libre, carte d'un livre, carte d'un mouvement). Le champ est
// facultatif : une base ancienne reste valable telle quelle.
//
// API :
//   PORTAL_KIND_LABEL                         → libellé de la nature d'une carte
//   portalTarget(maps, key, lk)               → PortalTarget | null (null : carte introuvable)
//   portalNode(targetKey, at, id, title?)     → MapNode  (texte = titre au moment de la pose, repli)
//   portalIndex(maps)                         → { backlinks, extractMaps }  (mémorisé par objet `maps`)
//       backlinks   : clé cible → clés des cartes qui contiennent un portail vers elle
//       extractMaps : highlightId → clés des cartes où l'extrait est posé
//   backlinksOf(maps, key) / otherMapsOfExtract(maps, highlightId, exceptKey)
//   mapChoices(maps, lk, exceptKey?)          → PortalTarget[]  cartes proposées dans le sélecteur
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, MapNode } from '../../../lib/types';
import { mapKindOf, type MapLookup } from './core';
import { movementRange } from './movements';

export type MapKind = 'book' | 'board' | 'movement';

export const PORTAL_KIND_LABEL: Record<MapKind, string> = {
  board: 'Carte libre',
  book: 'Carte de livre',
  movement: 'Carte de mouvement',
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export interface PortalTarget {
  key: string;
  map: ArgumentMap;
  kind: MapKind;
  title: string;
  /** Précision : auteur d'une carte de livre, livre d'une carte de mouvement. */
  sub: string;
  nodeCount: number;
}

/** Une carte de livre n'existe que si son livre existe encore. */
function alive(m: ArgumentMap, key: string, lk: MapLookup): boolean {
  const k = mapKindOf(m);
  if (k === 'board') return true;
  return lk.books.some((b) => b.id === (k === 'book' ? key : m.bookId));
}

export function portalTarget(maps: Record<string, ArgumentMap>, key: string | undefined, lk: MapLookup): PortalTarget | null {
  if (!key) return null;
  const m = maps[key];
  if (!m || !alive(m, key, lk)) return null;
  const kind = mapKindOf(m);
  const book = lk.books.find((b) => b.id === (kind === 'book' ? key : m.bookId));
  let title: string;
  if (kind === 'board') title = m.title?.trim() || 'Carte sans titre';
  else if (kind === 'book') title = m.title?.trim() || book?.title || 'Carte du livre';
  else {
    const st = m.studyId ? lk.studies?.find((s) => s.id === m.studyId) : undefined;
    const r = st && m.movementId ? movementRange(st, m.movementId) : null;
    title = r ? `${ROMAN[r.index] ?? r.index + 1}. ${r.movement.title.trim() || `Mouvement ${r.index + 1}`}` : m.title?.trim() || 'Mouvement';
  }
  // Précision : l'auteur pour la carte d'un livre (son titre est déjà le titre), le livre pour un mouvement.
  const sub = kind === 'board' ? '' : kind === 'book' ? (title === book?.title ? (book?.author ?? '') : (book?.title ?? '')) : (book?.title ?? '');
  return { key, map: m, kind, title, sub, nodeCount: m.nodes.length };
}

export function portalNode(targetKey: string, at: { x: number; y: number }, id: string, title = ''): MapNode {
  return { id, highlightId: null, text: title, x: Math.round(at.x), y: Math.round(at.y), portal: targetKey };
}

export interface PortalIndex {
  backlinks: Map<string, string[]>;
  extractMaps: Map<string, string[]>;
}

// Index recalculé seulement quand l'objet `maps` change (chaque écriture en crée un nouveau).
let cache: { maps: Record<string, ArgumentMap>; index: PortalIndex } | null = null;

export function portalIndex(maps: Record<string, ArgumentMap>): PortalIndex {
  if (cache && cache.maps === maps) return cache.index;
  const backlinks = new Map<string, string[]>();
  const extractMaps = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const l = m.get(k);
    if (!l) m.set(k, [v]);
    else if (!l.includes(v)) l.push(v);
  };
  for (const [key, m] of Object.entries(maps)) {
    for (const n of m.nodes) {
      if (n.portal && n.portal !== key) push(backlinks, n.portal, key);
      if (n.highlightId) push(extractMaps, n.highlightId, key);
    }
  }
  const index = { backlinks, extractMaps };
  cache = { maps, index };
  return index;
}

const NONE: string[] = [];
export const backlinksOf = (maps: Record<string, ArgumentMap>, key: string): string[] => portalIndex(maps).backlinks.get(key) ?? NONE;
export const otherMapsOfExtract = (maps: Record<string, ArgumentMap>, highlightId: string, exceptKey: string): string[] =>
  (portalIndex(maps).extractMaps.get(highlightId) ?? NONE).filter((k) => k !== exceptKey);

/** Cartes proposées comme cibles : toutes, sauf `exceptKey` et les cartes de livre / mouvement vides. */
export function mapChoices(maps: Record<string, ArgumentMap>, lk: MapLookup, exceptKey?: string): PortalTarget[] {
  const out: PortalTarget[] = [];
  for (const [key, m] of Object.entries(maps)) {
    if (key === exceptKey) continue;
    if (mapKindOf(m) !== 'board' && !m.nodes.length) continue;
    const t = portalTarget(maps, key, lk);
    if (t) out.push(t);
  }
  const order: Record<MapKind, number> = { board: 0, book: 1, movement: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title, 'fr'));
}
