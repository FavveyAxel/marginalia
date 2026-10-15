// ─────────────────────────────────────────────────────────────
// Copier des cartes d'une carte vers une autre (pur, sans store ni DOM) — panneau « Ajouter »
// des cartes libres : onglet « Autres cartes », et ajout d'idées et de concepts.
//
// API :
//   copyNodesFromMap(source, nodeIds, opts?)   → { nodes, edges }
//       Copie des cartes choisies (nouveaux ids) et des liens qui les relient ENTRE ELLES
//       (relation, force, note ; les groupes conjoints sont renumérotés). Chaque copie garde
//       son extrait d'origine (highlightId), son texte, sa teinte, son concept, et note sa
//       provenance (`from: { mapKey, nodeId }`). Positions relatives conservées.
//   placeBlock(target, copy, opts?)            → { nodes, edges }
//       Translate le bloc copié pour qu'il ne chevauche rien sur la carte cible : sous le
//       contenu (ou à `opts.at`, décalé vers le bas tant qu'il chevauche).
//   mergeCopy(target, copy, opts?)             → { map, nodeIds }
//       Ajoute le bloc à la carte. Les extraits DÉJÀ présents sur la cible ne sont pas dupliqués :
//       les liens copiés se rebranchent sur la carte existante ; un lien identique (mêmes
//       extrémités, même relation) n'est pas recréé. Carte libre : livres des extraits → bookIds.
//   copyIntoMap(target, source, nodeIds, opts?) → { map, nodeIds }   les trois à la suite
//   ideaNode(text, at, id?) / conceptNode(concept, at, id?)          → MapNode
//   freeSpot(target, size?, lk?)               → { x, y }  coin libre sous le contenu
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, Concept, MapEdge, MapNode } from '../../../lib/types';
import { clean, defaultId, mapKeyOf, nodeText, type IdFn, type MapLookup } from './core';
import { NODE_W, nodeRect, unionRects, type Rect } from './geometry';
import { isBoard } from './boards';

export interface CopyResult {
  nodes: MapNode[];
  edges: MapEdge[];
}

export interface CopyOpts {
  id?: IdFn;
  /** Clé de la carte source (sinon mapKeyOf(source)). */
  sourceKey?: string;
}

export function copyNodesFromMap(source: ArgumentMap, nodeIds: string[], opts: CopyOpts = {}): CopyResult {
  const id = opts.id ?? defaultId;
  const key = opts.sourceKey ?? mapKeyOf(source);
  const wanted = new Set(nodeIds);
  const idMap = new Map<string, string>();
  const nodes: MapNode[] = [];
  for (const n of source.nodes) {
    if (!wanted.has(n.id) || idMap.has(n.id)) continue;
    const nid = id();
    idMap.set(n.id, nid);
    const { collapsed: _c, ...rest } = n;
    nodes.push({ ...rest, id: nid, from: n.from ?? { mapKey: key, nodeId: n.id } });
  }
  const groupMap = new Map<string, string>();
  const edges: MapEdge[] = [];
  for (const e of source.edges) {
    const s = idMap.get(e.source);
    const t = idMap.get(e.target);
    if (!s || !t) continue;
    let groupId: string | null = null;
    if (e.groupId) {
      if (!groupMap.has(e.groupId)) groupMap.set(e.groupId, id());
      groupId = groupMap.get(e.groupId)!;
    }
    edges.push({ ...e, id: id(), source: s, target: t, groupId });
  }
  // Un groupe conjoint réduit à un seul lien n'a plus de sens.
  const count = new Map<string, number>();
  for (const e of edges) if (e.groupId) count.set(e.groupId, (count.get(e.groupId) ?? 0) + 1);
  return { nodes, edges: edges.map((e) => (e.groupId && count.get(e.groupId)! < 2 ? { ...e, groupId: null } : e)) };
}

const GAP = 60;

const overlaps = (a: Rect, b: Rect, pad = 24) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

function rectsOf(nodes: MapNode[], lk?: MapLookup): Rect[] {
  return nodes.map((n) => nodeRect(n, lk ? nodeText(n, lk) : clean(n.text), undefined));
}

/** Coin supérieur gauche libre sous le contenu de la carte (origine si la carte est vide). */
export function freeSpot(target: ArgumentMap, lk?: MapLookup): { x: number; y: number } {
  const all = unionRects([...rectsOf(target.nodes, lk), ...(target.zones ?? []).map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h }))]);
  return all ? { x: Math.round(all.x), y: Math.round(all.y + all.h + GAP) } : { x: 0, y: 0 };
}

export interface PlaceBlockOpts {
  /** Coin supérieur gauche souhaité (sinon : sous le contenu). */
  at?: { x: number; y: number };
  lookup?: MapLookup;
}

export function placeBlock(target: ArgumentMap, copy: CopyResult, opts: PlaceBlockOpts = {}): CopyResult {
  if (!copy.nodes.length) return copy;
  const lk = opts.lookup;
  const block = unionRects(rectsOf(copy.nodes, lk))!;
  const existing = [...rectsOf(target.nodes, lk), ...(target.zones ?? []).map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h }))];
  let at = opts.at ?? freeSpot(target, lk);
  // Décale vers le bas tant que le bloc chevauche une carte ou une zone existante.
  for (let guard = 0; guard < 200; guard++) {
    const r = { x: at.x, y: at.y, w: block.w, h: block.h };
    const hit = existing.filter((e) => overlaps(r, e));
    if (!hit.length) break;
    at = { x: at.x, y: Math.max(...hit.map((e) => e.y + e.h)) + GAP };
  }
  const dx = Math.round(at.x - block.x);
  const dy = Math.round(at.y - block.y);
  return { nodes: copy.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })), edges: copy.edges };
}

export interface MergeOpts {
  lookup?: MapLookup;
}

export function mergeCopy(target: ArgumentMap, copy: CopyResult, opts: MergeOpts = {}): { map: ArgumentMap; nodeIds: string[] } {
  const byHl = new Map(target.nodes.filter((n) => n.highlightId).map((n) => [n.highlightId!, n.id]));
  const redirect = new Map<string, string>();
  const nodes: MapNode[] = [];
  for (const n of copy.nodes) {
    const ex = n.highlightId ? byHl.get(n.highlightId) : undefined;
    if (ex) redirect.set(n.id, ex);
    else nodes.push(n);
  }
  const r = (x: string) => redirect.get(x) ?? x;
  const sig = (e: Pick<MapEdge, 'source' | 'target' | 'relation'>) => `${e.source}>${e.target}:${e.relation}`;
  const seen = new Set(target.edges.map(sig));
  const edges: MapEdge[] = [];
  for (const e of copy.edges) {
    const ne = { ...e, source: r(e.source), target: r(e.target) };
    if (ne.source === ne.target || seen.has(sig(ne))) continue;
    seen.add(sig(ne));
    edges.push(ne);
  }
  if (!nodes.length && !edges.length) return { map: target, nodeIds: [...redirect.values()] };
  let map: ArgumentMap = { ...target, nodes: [...target.nodes, ...nodes], edges: [...target.edges, ...edges] };
  if (isBoard(target) && opts.lookup) {
    const hl = new Map(opts.lookup.highlights.map((h) => [h.id, h.bookId]));
    const books = nodes.map((n) => (n.highlightId ? hl.get(n.highlightId) : undefined)).filter((b): b is string => !!b);
    if (books.length) map = { ...map, bookIds: [...new Set([...(target.bookIds ?? []), ...books])] };
  }
  return { map, nodeIds: [...nodes.map((n) => n.id), ...redirect.values()] };
}

export function copyIntoMap(target: ArgumentMap, source: ArgumentMap, nodeIds: string[], opts: CopyOpts & PlaceBlockOpts = {}): { map: ArgumentMap; nodeIds: string[] } {
  const copy = placeBlock(target, copyNodesFromMap(source, nodeIds, opts), opts);
  return mergeCopy(target, copy, { lookup: opts.lookup });
}

/** Carte « idée » (texte libre). */
export function ideaNode(text: string, at: { x: number; y: number }, id: IdFn = defaultId): MapNode {
  return { id: id(), highlightId: null, text: clean(text), x: Math.round(at.x), y: Math.round(at.y) };
}

/** Carte « concept » : nom et définition dans le texte (lisible partout), concept d'origine dans conceptId. */
export function conceptNode(concept: Pick<Concept, 'id' | 'name' | 'definition'>, at: { x: number; y: number }, id: IdFn = defaultId): MapNode {
  const def = clean(concept.definition ?? '');
  return { id: id(), highlightId: null, text: def ? `${clean(concept.name)} — ${def}` : clean(concept.name), x: Math.round(at.x), y: Math.round(at.y), conceptId: concept.id, color: '--cat-concept' };
}

/** Pose une suite de cartes neuves en ligne dans un coin libre (idées, concepts). */
export function placeNewNodes(target: ArgumentMap, nodes: MapNode[], lk?: MapLookup, columns = 3): MapNode[] {
  const laid = nodes.map((n, i) => ({ ...n, x: (i % columns) * (NODE_W + 40), y: Math.floor(i / columns) * 200 }));
  return placeBlock(target, { nodes: laid, edges: [] }, { lookup: lk }).nodes;
}
