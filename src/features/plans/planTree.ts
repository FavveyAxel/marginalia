// Opérations pures sur l'arbre d'un plan (PlanNode[]).
import { uid } from '../../lib/store';
import type { PlanItemRef, PlanNode } from '../../lib/types';
import { roman } from '../study/studyUtils';

export const MAX_DEPTH = 3; // parties, sous-parties, sous-sous-parties

export const newNode = (title = ''): PlanNode => ({ id: uid(), title, note: '', items: [], children: [] });

export function nodeLabel(depth: number, index: number): string {
  if (depth === 0) return `${roman(index + 1)}.`;
  if (depth === 1) return `${String.fromCharCode(65 + (index % 26))}.`;
  return `${index + 1}.`;
}

export interface FlatNode {
  node: PlanNode;
  depth: number;
  label: string;
  /** « I. A. 2. » : chemin complet. */
  path: string;
}

export function flatten(nodes: PlanNode[], depth = 0, prefix = ''): FlatNode[] {
  return nodes.flatMap((n, i) => {
    const label = nodeLabel(depth, i);
    const path = `${prefix}${label}`;
    return [{ node: n, depth, label, path }, ...flatten(n.children, depth + 1, `${path} `)];
  });
}

export function findNode(nodes: PlanNode[], id: string): PlanNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const c = findNode(n.children, id);
    if (c) return c;
  }
  return null;
}

export function updateNode(nodes: PlanNode[], id: string, fn: (n: PlanNode) => PlanNode): PlanNode[] {
  return nodes.map((n) => (n.id === id ? fn(n) : { ...n, children: updateNode(n.children, id, fn) }));
}

export function addChild(nodes: PlanNode[], parentId: string | null, child: PlanNode): PlanNode[] {
  if (parentId === null) return [...nodes, child];
  return updateNode(nodes, parentId, (n) => ({ ...n, children: [...n.children, child] }));
}

export function removeNode(nodes: PlanNode[], id: string): PlanNode[] {
  return nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: removeNode(n.children, id) }));
}

/** Monte (-1) ou descend (+1) un nœud parmi ses frères. */
export function shiftNode(nodes: PlanNode[], id: string, dir: -1 | 1): PlanNode[] {
  const i = nodes.findIndex((n) => n.id === id);
  if (i >= 0) {
    const j = i + dir;
    if (j < 0 || j >= nodes.length) return nodes;
    const out = [...nodes];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }
  return nodes.map((n) => ({ ...n, children: shiftNode(n.children, id, dir) }));
}

function depthOf(nodes: PlanNode[]): number {
  return nodes.length ? 1 + Math.max(...nodes.map((n) => depthOf(n.children))) : 0;
}

function contains(node: PlanNode, id: string): boolean {
  return node.id === id || node.children.some((c) => contains(c, id));
}

function insertRelative(nodes: PlanNode[], targetId: string, moved: PlanNode, after: boolean): PlanNode[] {
  const i = nodes.findIndex((n) => n.id === targetId);
  if (i >= 0) {
    const out = [...nodes];
    out.splice(after ? i + 1 : i, 0, moved);
    return out;
  }
  return nodes.map((n) => ({ ...n, children: insertRelative(n.children, targetId, moved, after) }));
}

/**
 * Déplace `id` avant ou après `targetId` (même parent que la cible).
 * Renvoie null si le déplacement est impossible (cible dans le sous-arbre, profondeur dépassée).
 */
export function moveNodeTo(nodes: PlanNode[], id: string, targetId: string, after: boolean): PlanNode[] | null {
  if (id === targetId) return null;
  const moved = findNode(nodes, id);
  if (!moved || contains(moved, targetId)) return null;
  const targetDepth = flatten(nodes).find((f) => f.node.id === targetId)?.depth ?? 0;
  if (targetDepth + depthOf([moved]) > MAX_DEPTH) return null;
  return insertRelative(removeNode(nodes, id), targetId, moved, after);
}

export function addItem(nodes: PlanNode[], nodeId: string, ref: PlanItemRef): PlanNode[] {
  return updateNode(nodes, nodeId, (n) => ({ ...n, items: [...n.items, { id: uid(), ref }] }));
}

export function removeItem(nodes: PlanNode[], itemId: string): PlanNode[] {
  return nodes.map((n) => ({
    ...n,
    items: n.items.filter((it) => it.id !== itemId),
    children: removeItem(n.children, itemId),
  }));
}

export function findItem(nodes: PlanNode[], itemId: string): PlanNode['items'][number] | null {
  for (const n of nodes) {
    const it = n.items.find((x) => x.id === itemId);
    if (it) return it;
    const c = findItem(n.children, itemId);
    if (c) return c;
  }
  return null;
}

export function countItems(nodes: PlanNode[]): number {
  return nodes.reduce((acc, n) => acc + n.items.length + countItems(n.children), 0);
}

export function placedRefs(nodes: PlanNode[], kind: PlanItemRef['kind']): Map<string, number> {
  const m = new Map<string, number>();
  const walk = (ns: PlanNode[]) =>
    ns.forEach((n) => {
      n.items.forEach((it) => {
        if (it.ref.kind === kind && 'id' in it.ref) m.set(it.ref.id, (m.get(it.ref.id) ?? 0) + 1);
      });
      walk(n.children);
    });
  walk(nodes);
  return m;
}
