// ─────────────────────────────────────────────────────────────
// Cartes libres multi-livres (« comparer deux auteurs ») et petites opérations de carte
// — partie pure (sans store). L'enregistrement est fait par actions.ts.
//
// Rangement : dans `Database.maps`, comme les cartes de livre, mais sous leur propre clé
// (`id`, préfixe « board- ») avec kind 'board' et bookId ''. Les cartes de livre (clé =
// bookId, sans `kind`) ne changent pas : aucune migration.
//
// API :
//   newBoard(title, opts?)                 → ArgumentMap (kind 'board')
//   isBoard(map) / isMovementMap(map) / isBookMap(map)
//   listBoards(maps)                       → ArgumentMap[]  plus récentes d'abord
//   addHighlightNodes(map, hls, opts?)     → { map, nodeIds }  place des extraits (grille sous le contenu)
//   setEdgeNote(map, edgeId, note)         → ArgumentMap   note libre sur un lien ('' : retire)
//   reverseEdgeIn(map, edgeId)             → ArgumentMap   inverse le sens d'un lien (source ↔ cible) ;
//                                                          quitte son groupe de prémisses conjointes ;
//                                                          inchangée si le lien inverse existe déjà
//   touch(map, now?)                       → ArgumentMap   updatedAt
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, Highlight, MapNode } from '../../../lib/types';
import { defaultId, mapKindOf, type IdFn } from './core';
import { NODE_W } from './geometry';

export const BOARD_PREFIX = 'board-';

export interface NewBoardOpts {
  bookIds?: string[];
  id?: IdFn;
  now?: number;
}

export function newBoard(title: string, opts: NewBoardOpts = {}): ArgumentMap {
  const now = opts.now ?? Date.now();
  return {
    id: BOARD_PREFIX + (opts.id ?? defaultId)(),
    kind: 'board',
    bookId: '',
    title: title.trim() || 'Nouvelle carte',
    bookIds: [...new Set(opts.bookIds ?? [])],
    nodes: [],
    edges: [],
    zones: [],
    viewport: null,
    createdAt: now,
    updatedAt: now,
  };
}

export const isBoard = (m: ArgumentMap) => mapKindOf(m) === 'board';
export const isMovementMap = (m: ArgumentMap) => mapKindOf(m) === 'movement';
export const isBookMap = (m: ArgumentMap) => mapKindOf(m) === 'book';

export function listBoards(maps: Record<string, ArgumentMap>): ArgumentMap[] {
  return Object.values(maps)
    .filter(isBoard)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export const touch = (m: ArgumentMap, now = Date.now()): ArgumentMap => ({ ...m, updatedAt: now });

export interface PlaceOpts {
  id?: IdFn;
  /** Point de départ (sinon : sous le contenu existant, à gauche). */
  at?: { x: number; y: number };
  columns?: number;
}

/**
 * Place des extraits sur la carte (ceux déjà présents sont ignorés), en grille sous le contenu.
 * Carte libre : les livres des extraits sont ajoutés à `bookIds`.
 */
export function addHighlightNodes(map: ArgumentMap, hls: Highlight[], opts: PlaceOpts = {}): { map: ArgumentMap; nodeIds: string[] } {
  const placed = new Set(map.nodes.map((n) => n.highlightId).filter(Boolean));
  const todo = hls.filter((h, i) => !placed.has(h.id) && hls.findIndex((x) => x.id === h.id) === i);
  if (!todo.length) return { map, nodeIds: [] };
  const cols = Math.max(1, opts.columns ?? 3);
  const maxY = map.nodes.length ? Math.max(...map.nodes.map((n) => n.y)) + 220 : 0;
  const minX = map.nodes.length ? Math.min(...map.nodes.map((n) => n.x)) : 0;
  const at = opts.at ?? { x: minX, y: maxY };
  const id = opts.id ?? defaultId;
  const nodes: MapNode[] = todo.map((h, i) => ({
    id: id(),
    highlightId: h.id,
    text: '',
    x: Math.round(at.x + (i % cols) * (NODE_W + 40)),
    y: Math.round(at.y + Math.floor(i / cols) * 200),
  }));
  let next: ArgumentMap = { ...map, nodes: [...map.nodes, ...nodes] };
  if (isBoard(map)) next = { ...next, bookIds: [...new Set([...(map.bookIds ?? []), ...todo.map((h) => h.bookId)])] };
  return { map: next, nodeIds: nodes.map((n) => n.id) };
}

export function setEdgeNote(map: ArgumentMap, edgeId: string, note: string): ArgumentMap {
  const e = map.edges.find((x) => x.id === edgeId);
  if (!e) return map;
  const t = note.trim();
  if ((e.note ?? '') === t) return map;
  return {
    ...map,
    edges: map.edges.map((x) => {
      if (x.id !== edgeId) return x;
      if (t) return { ...x, note: t };
      const { note: _n, ...rest } = x;
      return rest;
    }),
  };
}

/**
 * Inverse le sens d'un lien : la source devient la cible et réciproquement (relation, force et note
 * gardées). Un lien inversé quitte son groupe de prémisses conjointes (il ne vise plus la même carte).
 * Carte inchangée si le lien n'existe pas, boucle sur lui-même, ou si le lien inverse (mêmes
 * extrémités, même relation) existe déjà.
 */
export function reverseEdgeIn(map: ArgumentMap, edgeId: string): ArgumentMap {
  const e = map.edges.find((x) => x.id === edgeId);
  if (!e || e.source === e.target) return map;
  if (map.edges.some((x) => x.id !== edgeId && x.source === e.target && x.target === e.source && x.relation === e.relation)) return map;
  return {
    ...map,
    edges: map.edges.map((x) => (x.id === edgeId ? { ...x, source: e.target, target: e.source, groupId: null } : x)),
  };
}
