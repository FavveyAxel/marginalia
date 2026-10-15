// ─────────────────────────────────────────────────────────────
// Zones de la carte (cadres titrés qui regroupent des cartes). Pur : chaque fonction
// reçoit une carte et renvoie une NOUVELLE carte (à passer à store.setMap, donc annulable).
//
// Appartenance : une carte est « dans » une zone si son centre est dans le rectangle de la
// zone (zone repliée : la liste figée `hiddenNodeIds` fait foi).
//
// API :
//   createZoneAround(map, nodeIds, opts?)  → { map, zone }   zone autour des cartes (+ marge)
//   nodesInZone(map, zoneId, lk?, sizes?)   → string[]        ids des cartes contenues
//   moveZone(map, zoneId, dx, dy, lk?)      → map             déplace la zone ET son contenu
//   resizeZone(map, zoneId, rect)           → map             nouveau rectangle (taille min.)
//   collapseZone(map, zoneId, lk?)          → map             replie : contenu → hiddenNodeIds
//   expandZone(map, zoneId)                 → map             déplie
//   toggleZone(map, zoneId, lk?)            → map
//   updateZone(map, zoneId, {title,color})  → map
//   removeZone(map, zoneId)                 → map             retire le cadre (les cartes restent)
//   hiddenNodeIds(map)                      → Set<string>     cartes masquées par des zones repliées
//   zoneOfNode(map, nodeId, lk?)            → MapZone | null  plus petite zone contenant la carte
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, MapZone } from '../../../lib/types';
import { defaultId, nodeText, type IdFn, type MapLookup } from './core';
import { centerInside, nodeRect, unionRects, type Rect, type SizeMap } from './geometry';

export const ZONE_MARGIN = 32;
/** Bandeau de titre au-dessus du contenu. */
export const ZONE_HEADER = 36;
export const ZONE_MIN_W = 200;
export const ZONE_MIN_H = 120;
/** Teintes proposées (variables CSS existantes). */
export const ZONE_COLORS = ['--cat-these', '--cat-argument', '--cat-objection', '--cat-concept', '--cat-exemple', '--cat-probleme'];

const textOf = (lk?: MapLookup) => (n: ArgumentMap['nodes'][number]) => (lk ? nodeText(n, lk) : n.text);

const zonesOf = (m: ArgumentMap) => m.zones ?? [];
const withZone = (m: ArgumentMap, id: string, fn: (z: MapZone) => MapZone): ArgumentMap => {
  const zones = zonesOf(m);
  if (!zones.some((z) => z.id === id)) return m;
  return { ...m, zones: zones.map((z) => (z.id === id ? fn(z) : z)) };
};

export interface CreateZoneOpts {
  title?: string;
  color?: string;
  margin?: number;
  lookup?: MapLookup;
  sizes?: SizeMap;
  id?: IdFn;
}

/** Crée une zone qui entoure les cartes `nodeIds` (marge + bandeau de titre). */
export function createZoneAround(map: ArgumentMap, nodeIds: string[], opts: CreateZoneOpts = {}): { map: ArgumentMap; zone: MapZone } {
  const margin = opts.margin ?? ZONE_MARGIN;
  const t = textOf(opts.lookup);
  const rects = map.nodes.filter((n) => nodeIds.includes(n.id)).map((n) => nodeRect(n, t(n), opts.sizes));
  const bb = unionRects(rects) ?? { x: 0, y: 0, w: ZONE_MIN_W - 2 * margin, h: ZONE_MIN_H - 2 * margin - ZONE_HEADER };
  const n = zonesOf(map).length;
  const zone: MapZone = {
    id: (opts.id ?? defaultId)(),
    title: opts.title?.trim() || 'Nouvelle zone',
    color: opts.color ?? ZONE_COLORS[n % ZONE_COLORS.length],
    x: Math.round(bb.x - margin),
    y: Math.round(bb.y - margin - ZONE_HEADER),
    w: Math.max(ZONE_MIN_W, Math.round(bb.w + 2 * margin)),
    h: Math.max(ZONE_MIN_H, Math.round(bb.h + 2 * margin + ZONE_HEADER)),
  };
  return { map: { ...map, zones: [...zonesOf(map), zone] }, zone };
}

/** Cartes contenues dans une zone (centre dans le cadre ; zone repliée : cartes masquées). */
export function nodesInZone(map: ArgumentMap, zoneId: string, lk?: MapLookup, sizes?: SizeMap): string[] {
  const z = zonesOf(map).find((x) => x.id === zoneId);
  if (!z) return [];
  if (z.collapsed) return [...(z.hiddenNodeIds ?? [])];
  const t = textOf(lk);
  return map.nodes.filter((n) => centerInside(nodeRect(n, t(n), sizes), z)).map((n) => n.id);
}

/** Déplace une zone et tout son contenu (les sous-zones entièrement incluses suivent aussi). */
export function moveZone(map: ArgumentMap, zoneId: string, dx: number, dy: number, lk?: MapLookup, sizes?: SizeMap): ArgumentMap {
  const z = zonesOf(map).find((x) => x.id === zoneId);
  if (!z || (!dx && !dy)) return map;
  const ids = new Set(nodesInZone(map, zoneId, lk, sizes));
  const inner = (o: MapZone) => o.id !== z.id && o.x >= z.x && o.y >= z.y && o.x + o.w <= z.x + z.w && o.y + o.h <= z.y + z.h;
  return {
    ...map,
    nodes: map.nodes.map((n) => (ids.has(n.id) ? { ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) } : n)),
    zones: zonesOf(map).map((o) => (o.id === z.id || inner(o) ? { ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy) } : o)),
  };
}

/** Nouveau rectangle (taille minimale respectée). Les cartes ne bougent pas. */
export function resizeZone(map: ArgumentMap, zoneId: string, r: Partial<Rect>): ArgumentMap {
  return withZone(map, zoneId, (z) => ({
    ...z,
    x: Math.round(r.x ?? z.x),
    y: Math.round(r.y ?? z.y),
    w: Math.max(ZONE_MIN_W, Math.round(r.w ?? z.w)),
    h: Math.max(ZONE_MIN_H, Math.round(r.h ?? z.h)),
  }));
}

/** Replie une zone : ses cartes sont listées dans hiddenNodeIds (l'interface les masque). */
export function collapseZone(map: ArgumentMap, zoneId: string, lk?: MapLookup, sizes?: SizeMap): ArgumentMap {
  const z = zonesOf(map).find((x) => x.id === zoneId);
  if (!z || z.collapsed) return map;
  const hidden = nodesInZone(map, zoneId, lk, sizes);
  return withZone(map, zoneId, (o) => ({ ...o, collapsed: true, hiddenNodeIds: hidden }));
}

export function expandZone(map: ArgumentMap, zoneId: string): ArgumentMap {
  return withZone(map, zoneId, (o) => {
    if (!o.collapsed) return o;
    const { hiddenNodeIds: _h, collapsed: _c, ...rest } = o;
    return rest;
  });
}

export function toggleZone(map: ArgumentMap, zoneId: string, lk?: MapLookup, sizes?: SizeMap): ArgumentMap {
  const z = zonesOf(map).find((x) => x.id === zoneId);
  return z?.collapsed ? expandZone(map, zoneId) : collapseZone(map, zoneId, lk, sizes);
}

export function updateZone(map: ArgumentMap, zoneId: string, patch: Partial<Pick<MapZone, 'title' | 'color'>>): ArgumentMap {
  return withZone(map, zoneId, (z) => ({ ...z, ...patch }));
}

export function removeZone(map: ArgumentMap, zoneId: string): ArgumentMap {
  const zones = zonesOf(map);
  if (!zones.some((z) => z.id === zoneId)) return map;
  return { ...map, zones: zones.filter((z) => z.id !== zoneId) };
}

/** Cartes masquées par les zones repliées (à ne pas afficher). */
export function hiddenNodeIds(map: ArgumentMap): Set<string> {
  const out = new Set<string>();
  for (const z of zonesOf(map)) if (z.collapsed) for (const id of z.hiddenNodeIds ?? []) out.add(id);
  return out;
}

/** Plus petite zone (dépliée) qui contient la carte. */
export function zoneOfNode(map: ArgumentMap, nodeId: string, lk?: MapLookup, sizes?: SizeMap): MapZone | null {
  const n = map.nodes.find((x) => x.id === nodeId);
  if (!n) return null;
  const r = nodeRect(n, textOf(lk)(n), sizes);
  const hits = zonesOf(map).filter((z) => (z.collapsed ? (z.hiddenNodeIds ?? []).includes(nodeId) : centerInside(r, z)));
  hits.sort((a, b) => a.w * a.h - b.w * b.h);
  return hits[0] ?? null;
}
