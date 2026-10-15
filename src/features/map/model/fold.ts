// ─────────────────────────────────────────────────────────────
// Replier / déplier des branches, comme une carte mentale (pur, sans store ni DOM).
//
// Règle de l'arbre (une seule, partagée par l'interface, l'export et les tests) :
//   - un lien A → B (« A soutient / précise / illustre / objecte à / répond à / se rattache à B »)
//     fait de A un ENFANT de B ; « s’oppose à » (symétrique, entre deux thèses) ne crée pas de
//     filiation ;
//   - chaque carte n'a qu'UN parent : on parcourt la carte en largeur depuis les racines, et la
//     première racine qui atteint une carte la garde (le chemin le plus court vers le centre).
//     Racines, dans l'ordre : le centre (problématique / sujet), la thèse centrale, puis les cartes
//     qui ne pointent vers aucune autre (sommets), haut → bas puis gauche → droite ; les cartes
//     prises dans un cycle sans sommet servent de racine à leur tour : aucun cycle ne boucle ;
//   - les descendantes d'une carte : ses enfants, leurs enfants, etc.
//
// Replier une carte (MapNode.folded) masque ses descendantes et leurs liens — rien n'est supprimé.
// L'état est rangé dans la carte : il survit au rechargement et passe par l'annulation du store.
//
// API :
//   FOLD_RELATIONS                       relations qui créent une filiation
//   foldTree(map, rootId?)               → { parent, children, roots, depth }
//   descendants(tree, id)                → string[]  (sans la carte elle-même)
//   foldHiddenIds(map, rootId?)          → Set<string>  cartes masquées par des branches repliées
//   foldInfo(map, rootId?)               → Map<id, { count, folded }>  cartes qui ont des descendantes
//   setFolded(map, id, folded)           → map
//   toggleFold(map, id)                  → map
//   foldAll(map, rootId?)                → map   replie tout sauf le premier niveau autour des racines
//   unfoldAll(map)                       → map
//   unfoldTo(map, id, rootId?)           → map   déplie les ancêtres repliés d'une carte (la rend visible)
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, MapNode, RelationId } from '../../../lib/types';
import { isCenter } from './center';

/** Relations « enfant → parent » (ordre de préférence des enfants). */
export const FOLD_RELATIONS: RelationId[] = ['repond', 'rattache', 'soutient', 'precise', 'illustre', 'objecte'];
const REL_RANK = new Map(FOLD_RELATIONS.map((r, i) => [r, i]));

export interface FoldTree {
  parent: Map<string, string>;
  children: Map<string, string[]>;
  roots: string[];
  depth: Map<string, number>;
}

type MapLike = Pick<ArgumentMap, 'nodes' | 'edges' | 'centralId'>;

const byPos = (a: MapNode, b: MapNode) => Math.round(a.y / 60) - Math.round(b.y / 60) || a.x - b.x || a.id.localeCompare(b.id);

export function foldTree(map: MapLike, rootId?: string | null): FoldTree {
  const ids = new Set(map.nodes.map((n) => n.id));
  const pos = new Map(map.nodes.map((n) => [n.id, n]));
  const into = new Map<string, { id: string; rel: RelationId }[]>();
  const hasOut = new Set<string>();
  for (const e of map.edges) {
    if (!REL_RANK.has(e.relation) || e.source === e.target || !ids.has(e.source) || !ids.has(e.target)) continue;
    into.set(e.target, [...(into.get(e.target) ?? []), { id: e.source, rel: e.relation }]);
    hasOut.add(e.source);
  }
  for (const list of into.values())
    list.sort((a, b) => REL_RANK.get(a.rel)! - REL_RANK.get(b.rel)! || byPos(pos.get(a.id)!, pos.get(b.id)!));

  const sorted = [...map.nodes].sort(byPos).map((n) => n.id);
  const first: string[] = [];
  const push = (id: string | null | undefined) => {
    if (id && ids.has(id) && !first.includes(id)) first.push(id);
  };
  push(rootId);
  for (const n of map.nodes) if (isCenter(n)) push(n.id);
  push(map.centralId);
  for (const id of sorted) if (!hasOut.has(id)) push(id);

  const parent = new Map<string, string>();
  const children = new Map<string, string[]>();
  const depth = new Map<string, number>();
  const roots: string[] = [];
  const grow = (r: string) => {
    if (depth.has(r)) return;
    roots.push(r);
    depth.set(r, 0);
    const queue = [r];
    while (queue.length) {
      const x = queue.shift()!;
      for (const c of into.get(x) ?? []) {
        if (depth.has(c.id)) continue;
        depth.set(c.id, depth.get(x)! + 1);
        parent.set(c.id, x);
        children.set(x, [...(children.get(x) ?? []), c.id]);
        queue.push(c.id);
      }
    }
  };
  for (const r of first) grow(r);
  // Cartes prises dans un cycle sans sommet : chacune devient racine à son tour.
  for (const id of sorted) grow(id);
  return { parent, children, roots, depth };
}

export function descendants(tree: FoldTree, id: string): string[] {
  const out: string[] = [];
  const stack = [...(tree.children.get(id) ?? [])];
  const seen = new Set<string>([id]);
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    stack.push(...(tree.children.get(c) ?? []));
  }
  return out;
}

/** Cartes masquées par des branches repliées. */
export function foldHiddenIds(map: MapLike, rootId?: string | null): Set<string> {
  const out = new Set<string>();
  if (!map.nodes.some((n) => n.folded)) return out;
  const tree = foldTree(map, rootId);
  for (const n of map.nodes) if (n.folded) for (const d of descendants(tree, n.id)) out.add(d);
  return out;
}

export interface FoldState {
  /** Nombre de descendantes (masquées si la carte est repliée). */
  count: number;
  folded: boolean;
}

/** État de repli des cartes qui ont des descendantes. */
export function foldInfo(map: MapLike, rootId?: string | null): Map<string, FoldState> {
  const tree = foldTree(map, rootId);
  const out = new Map<string, FoldState>();
  for (const n of map.nodes) {
    if (!tree.children.get(n.id)?.length) continue;
    out.set(n.id, { count: descendants(tree, n.id).length, folded: !!n.folded });
  }
  return out;
}

export function setFolded<M extends Pick<ArgumentMap, 'nodes'>>(map: M, id: string, folded: boolean): M {
  const n = map.nodes.find((x) => x.id === id);
  if (!n || !!n.folded === folded) return map;
  return {
    ...map,
    nodes: map.nodes.map((x) => {
      if (x.id !== id) return x;
      const { folded: _f, ...rest } = x;
      return folded ? { ...rest, folded: true } : rest;
    }),
  };
}

export function toggleFold<M extends Pick<ArgumentMap, 'nodes'>>(map: M, id: string): M {
  const n = map.nodes.find((x) => x.id === id);
  return n ? setFolded(map, id, !n.folded) : map;
}

/**
 * Tout replier : chaque carte qui a des descendantes est repliée, sauf les racines — on voit le
 * centre et sa première couronne, chaque branche refermée. Si cela ne masque rien (les branches
 * n'ont qu'un niveau), les racines se replient à leur tour.
 */
export function foldAll<M extends MapLike>(map: M, rootId?: string | null): M {
  const tree = foldTree(map, rootId);
  const rootSet = new Set(tree.roots);
  const inner = new Set(map.nodes.filter((n) => !rootSet.has(n.id) && tree.children.get(n.id)?.length).map((n) => n.id));
  const target = inner.size ? inner : new Set(tree.roots.filter((r) => tree.children.get(r)?.length));
  if (!target.size) return map;
  return { ...map, nodes: map.nodes.map((n) => (target.has(n.id) && !n.folded ? { ...n, folded: true } : n)) };
}

export function unfoldAll<M extends Pick<ArgumentMap, 'nodes'>>(map: M): M {
  if (!map.nodes.some((n) => n.folded)) return map;
  return {
    ...map,
    nodes: map.nodes.map((n) => {
      if (!n.folded) return n;
      const { folded: _f, ...rest } = n;
      return rest;
    }),
  };
}

/** Déplie les ancêtres repliés d'une carte (pour la montrer : signal, recherche…). */
export function unfoldTo<M extends MapLike>(map: M, id: string, rootId?: string | null): M {
  const tree = foldTree(map, rootId);
  const up = new Set<string>();
  for (let p = tree.parent.get(id), k = 0; p && k < 10000; p = tree.parent.get(p), k++) up.add(p);
  if (!map.nodes.some((n) => n.folded && up.has(n.id))) return map;
  return {
    ...map,
    nodes: map.nodes.map((n) => {
      if (!n.folded || !up.has(n.id)) return n;
      const { folded: _f, ...rest } = n;
      return rest;
    }),
  };
}
