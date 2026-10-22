// Modèle dérivé des espaces : arborescence, résolution des éléments, déplacements, cascades.
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, type State } from '../../lib/store';
import type { ArgumentMap, Workspace, WorkspaceGroup, WorkspaceItem, WorkspaceItemKind } from '../../lib/types';

export const KIND_LABEL: Record<WorkspaceItemKind, string> = {
  book: 'Livre',
  draft: 'Écrit',
  plan: 'Plan',
  argument: 'Argument',
  study: 'Fiche-texte',
  map: 'Carte',
};

export const KIND_ORDER: WorkspaceItemKind[] = ['book', 'draft', 'plan', 'argument', 'study', 'map'];

export const TINTS = ['--cat-these', '--cat-argument', '--cat-concept', '--cat-exemple', '--cat-probleme', '--cat-objection'];
export const TINT_LABEL: Record<string, string> = {
  '--cat-these': 'Ocre',
  '--cat-argument': 'Vert',
  '--cat-concept': 'Bleu',
  '--cat-exemple': 'Violet',
  '--cat-probleme': 'Terre cuite',
  '--cat-objection': 'Rose',
};

export interface ResolvedItem {
  item: WorkspaceItem;
  title: string;
  /** Ligne secondaire (auteur, nombre de mots…). */
  meta: string;
  /** Texte d'aperçu sobre pour les cartes non-livre. */
  preview: string;
  bookId: string | null;
  /** Carte libre (élément 'map' dont refId est la clé d'une carte libre dans `maps`). */
  board?: ArgumentMap;
}

export interface WsData {
  workspace: Workspace;
  groups: WorkspaceGroup[];
  items: ResolvedItem[];
}

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

export const sortedGroups = (groups: WorkspaceGroup[], workspaceId: string, parentId: string | null) =>
  groups.filter((g) => g.workspaceId === workspaceId && g.parentId === parentId).sort(byOrder);

/** Éléments résolus (les orphelins sont écartés) d'un espace. */
export function useResolvedItems(workspaceId: string): ResolvedItem[] {
  const wsItems = useStore((s) => s.wsItems);
  const books = useStore((s) => s.books);
  const drafts = useStore((s) => s.drafts);
  const plans = useStore((s) => s.plans);
  const args = useStore((s) => s.arguments);
  const studies = useStore((s) => s.studies);
  const maps = useStore((s) => s.maps);
  return useMemo(() => {
    const out: ResolvedItem[] = [];
    for (const item of wsItems) {
      if (item.workspaceId !== workspaceId) continue;
      const r = resolve(item, { books, drafts, plans, args, studies, maps });
      if (r) out.push(r);
    }
    return out.sort((a, b) => a.item.order - b.item.order);
  }, [wsItems, books, drafts, plans, args, studies, maps, workspaceId]);
}

function resolve(
  item: WorkspaceItem,
  d: {
    books: State['books'];
    drafts: State['drafts'];
    plans: State['plans'];
    args: State['arguments'];
    studies: State['studies'];
    maps: State['maps'];
  },
): ResolvedItem | null {
  switch (item.kind) {
    case 'book': {
      const b = d.books.find((x) => x.id === item.refId);
      return b ? { item, title: b.title, meta: b.author || b.format.toUpperCase(), preview: '', bookId: b.id } : null;
    }
    case 'draft': {
      const x = d.drafts.find((y) => y.id === item.refId);
      return x
        ? { item, title: x.title || 'Sans titre', meta: `${x.wordCount} mot${x.wordCount > 1 ? 's' : ''}`, preview: '', bookId: null }
        : null;
    }
    case 'plan': {
      const x = d.plans.find((y) => y.id === item.refId);
      if (!x) return null;
      const n = x.parts.length;
      return {
        item,
        title: x.title || 'Plan sans titre',
        meta: n ? `${n} partie${n > 1 ? 's' : ''}` : 'Plan vide',
        preview: x.sujet || x.problematique,
        bookId: null,
      };
    }
    case 'argument': {
      const x = d.args.find((y) => y.id === item.refId);
      if (!x) return null;
      const n = x.premises.length;
      return {
        item,
        title: x.title || 'Argument sans titre',
        meta: `${n} prémisse${n > 1 ? 's' : ''}`,
        preview: x.conclusion.text,
        bookId: x.bookId,
      };
    }
    case 'study': {
      const x = d.studies.find((y) => y.id === item.refId);
      if (!x) return null;
      const b = d.books.find((y) => y.id === x.bookId);
      return { item, title: x.title || 'Fiche sans titre', meta: b?.title ?? '', preview: x.these || x.probleme, bookId: x.bookId };
    }
    case 'map': {
      const fm = d.maps[item.refId];
      if (fm && fm.kind === 'board') {
        const n = fm.nodes.length;
        const e = fm.edges.length;
        return {
          item,
          title: fm.title?.trim() || 'Carte sans titre',
          meta: n ? `${n} carte${n > 1 ? 's' : ''}${e ? ` · ${e} lien${e > 1 ? 's' : ''}` : ''}` : 'Carte vide',
          preview: '',
          bookId: null,
          board: fm,
        };
      }
      const b = d.books.find((y) => y.id === item.refId);
      if (!b) return null;
      const n = d.maps[b.id]?.nodes.length ?? 0;
      return { item, title: `Carte — ${b.title}`, meta: `${n} nœud${n > 1 ? 's' : ''}`, preview: '', bookId: b.id };
    }
  }
}

/** Identifiants du groupe et de tous ses descendants. */
export function subtreeIds(groups: WorkspaceGroup[], rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups) if (g.parentId && out.has(g.parentId) && !out.has(g.id)) (out.add(g.id), (grew = true));
  }
  return out;
}

/** Chaîne des groupes de la racine jusqu'à `groupId` (inclus). */
export function groupPath(groups: WorkspaceGroup[], groupId: string | null): WorkspaceGroup[] {
  const path: WorkspaceGroup[] = [];
  let cur = groupId ? groups.find((g) => g.id === groupId) : undefined;
  let guard = 0;
  while (cur && guard++ < 100) {
    path.unshift(cur);
    cur = cur.parentId ? groups.find((g) => g.id === cur!.parentId) : undefined;
  }
  return path;
}

/** Renumérote `order` de façon contiguë pour chaque fratrie (groupes et éléments d'un espace). */
export function normalizeOrders(workspaceId: string) {
  useStore.setState((s) => {
    const gOrder = new Map<string, number>();
    const buckets = new Map<string, WorkspaceGroup[]>();
    for (const g of s.groups) if (g.workspaceId === workspaceId) (buckets.get(String(g.parentId)) ?? buckets.set(String(g.parentId), []).get(String(g.parentId))!).push(g);
    for (const list of buckets.values()) list.sort(byOrder).forEach((g, i) => gOrder.set(g.id, i));
    const iOrder = new Map<string, number>();
    const ib = new Map<string, WorkspaceItem[]>();
    for (const it of s.wsItems) if (it.workspaceId === workspaceId) (ib.get(String(it.groupId)) ?? ib.set(String(it.groupId), []).get(String(it.groupId))!).push(it);
    for (const list of ib.values()) list.sort(byOrder).forEach((it, i) => iOrder.set(it.id, i));
    return {
      groups: s.groups.map((g) => (gOrder.has(g.id) ? { ...g, order: gOrder.get(g.id)! } : g)),
      wsItems: s.wsItems.map((it) => (iOrder.has(it.id) ? { ...it, order: iOrder.get(it.id)! } : it)),
    };
  });
}

// ── Déplacements ────────────────────────────────────────────

/** Place un élément dans `groupId`, avant `beforeId` (null = à la fin). */
export function placeItem(itemId: string, groupId: string | null, beforeId: string | null = null) {
  useStore.setState((s) => {
    const it = s.wsItems.find((x) => x.id === itemId);
    if (!it) return {};
    const sibs = s.wsItems
      .filter((x) => x.workspaceId === it.workspaceId && x.groupId === groupId && x.id !== itemId)
      .sort(byOrder);
    let idx = beforeId ? sibs.findIndex((x) => x.id === beforeId) : -1;
    if (idx < 0) idx = sibs.length;
    const next = [...sibs.slice(0, idx), { ...it, groupId }, ...sibs.slice(idx)];
    const ord = new Map(next.map((x, i) => [x.id, i]));
    const oldGroup = it.groupId;
    return {
      wsItems: s.wsItems.map((x) => (ord.has(x.id) ? { ...x, groupId: x.id === itemId ? groupId : x.groupId, order: ord.get(x.id)! } : x)),
      groups:
        oldGroup !== groupId && groupId
          ? s.groups.map((g) => (g.id === groupId && g.collapsed ? { ...g, collapsed: false } : g))
          : s.groups,
    };
  });
  const it = useStore.getState().wsItems.find((x) => x.id === itemId);
  if (it) normalizeOrders(it.workspaceId);
}

/** Place un groupe sous `parentId`, avant `beforeId` (null = à la fin). Refuse les cycles. */
export function placeGroup(groupId: string, parentId: string | null, beforeId: string | null = null): boolean {
  const s = useStore.getState();
  const g = s.groups.find((x) => x.id === groupId);
  if (!g) return false;
  if (parentId && subtreeIds(s.groups, groupId).has(parentId)) return false;
  useStore.setState((st) => {
    const sibs = st.groups.filter((x) => x.workspaceId === g.workspaceId && x.parentId === parentId && x.id !== groupId).sort(byOrder);
    let idx = beforeId ? sibs.findIndex((x) => x.id === beforeId) : -1;
    if (idx < 0) idx = sibs.length;
    const next = [...sibs.slice(0, idx), { ...g, parentId }, ...sibs.slice(idx)];
    const ord = new Map(next.map((x, i) => [x.id, i]));
    return {
      groups: st.groups.map((x) =>
        ord.has(x.id)
          ? { ...x, parentId: x.id === groupId ? parentId : x.parentId, order: ord.get(x.id)!, collapsed: x.id === parentId ? false : x.collapsed }
          : x,
      ),
    };
  });
  normalizeOrders(g.workspaceId);
  return true;
}

/** Document venu d'un autre onglet (Écrire, Bibliothèque, Cartes, Plans) : pas encore dans l'espace visé. */
export type DragRef = { kind: WorkspaceItemKind; refId: string };

/**
 * `ids` : glisser d'une sélection multiple d'éléments (`id` = l'élément saisi, inclus dans `ids`).
 * `type: 'ref'` : documents glissés depuis un autre onglet (`refs`), à ranger dans un espace ; `workspaceId` vide.
 */
export type DragPayload = { type: 'item' | 'group' | 'ref'; id: string; workspaceId: string; ids?: string[]; refs?: DragRef[] };

/** Éléments déplacés par un glisser (un seul, ou toute la sélection). */
export const dragIds = (d: DragPayload): string[] => (d.type === 'item' && d.ids && d.ids.length ? d.ids : [d.id]);
export type DropTarget =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'group'; groupId: string; pos: 'before' | 'after' | 'into' }
  | { kind: 'item'; itemId: string; pos: 'before' | 'after' };

/** Résout une cible en (parent, avant-qui) ou null si le dépôt est impossible. */
function resolveTarget(drag: DragPayload, t: DropTarget): { parentId: string | null; beforeId: string | null } | null {
  const s = useStore.getState();
  if (t.kind === 'workspace') return t.workspaceId === drag.workspaceId ? { parentId: null, beforeId: null } : null;
  if (t.kind === 'item') {
    if (drag.type !== 'item') return null;
    const moving = new Set(dragIds(drag));
    const target = s.wsItems.find((i) => i.id === t.itemId);
    if (!target || target.workspaceId !== drag.workspaceId || moving.has(target.id)) return null;
    if (t.pos === 'before') return { parentId: target.groupId, beforeId: target.id };
    const sibs = s.wsItems
      .filter((i) => i.workspaceId === target.workspaceId && i.groupId === target.groupId && !moving.has(i.id))
      .sort(byOrder);
    const at = sibs.findIndex((i) => i.id === target.id);
    return { parentId: target.groupId, beforeId: sibs[at + 1]?.id ?? null };
  }
  const g = s.groups.find((x) => x.id === t.groupId);
  if (!g || g.workspaceId !== drag.workspaceId) return null;
  if (drag.type === 'item' || t.pos === 'into') {
    if (drag.type === 'group' && (drag.id === g.id || subtreeIds(s.groups, drag.id).has(g.id))) return null;
    return { parentId: g.id, beforeId: null };
  }
  // groupe sur groupe : avant / après (frère)
  if (drag.id === g.id || subtreeIds(s.groups, drag.id).has(g.id)) return null;
  if (t.pos === 'before') return { parentId: g.parentId, beforeId: g.id };
  const sibs = sortedGroups(s.groups, g.workspaceId, g.parentId).filter((x) => x.id !== drag.id);
  const at = sibs.findIndex((x) => x.id === g.id);
  return { parentId: g.parentId, beforeId: sibs[at + 1]?.id ?? null };
}

/** Où ranger des documents venus d'un autre onglet : l'espace, le groupe et l'élément avant lequel les poser. */
function resolveRefTarget(t: DropTarget): { workspaceId: string; groupId: string | null; beforeId: string | null } | null {
  const s = useStore.getState();
  if (t.kind === 'workspace') return s.workspaces.some((w) => w.id === t.workspaceId) ? { workspaceId: t.workspaceId, groupId: null, beforeId: null } : null;
  if (t.kind === 'group') {
    const g = s.groups.find((x) => x.id === t.groupId);
    return g ? { workspaceId: g.workspaceId, groupId: g.id, beforeId: null } : null;
  }
  const target = s.wsItems.find((i) => i.id === t.itemId);
  if (!target) return null;
  if (t.pos === 'before') return { workspaceId: target.workspaceId, groupId: target.groupId, beforeId: target.id };
  const sibs = s.wsItems.filter((i) => i.workspaceId === target.workspaceId && i.groupId === target.groupId).sort(byOrder);
  const at = sibs.findIndex((i) => i.id === target.id);
  return { workspaceId: target.workspaceId, groupId: target.groupId, beforeId: sibs[at + 1]?.id ?? null };
}

export const canDrop = (drag: DragPayload, t: DropTarget) => (drag.type === 'ref' ? !!drag.refs?.length && !!resolveRefTarget(t) : !!resolveTarget(drag, t));

/**
 * Range des documents venus d'un autre onglet. Déjà dans cet espace : ils y sont déplacés (pas de doublon).
 * Renvoie le nombre de documents rangés.
 */
function dropRefs(refs: DragRef[], t: DropTarget): number {
  const r = resolveRefTarget(t);
  if (!r) return 0;
  const s = useStore.getState();
  let n = 0;
  for (const ref of refs) {
    const it = s.addToWorkspace(r.workspaceId, r.groupId, ref.kind, ref.refId);
    if (r.beforeId !== it.id) placeItem(it.id, r.groupId, r.beforeId);
    n++;
  }
  // Le groupe visé s'ouvre dans la barre latérale : on voit où les documents sont arrivés.
  if (r.groupId) useStore.setState((st) => ({ groups: st.groups.map((g) => (g.id === r.groupId && g.collapsed ? { ...g, collapsed: false } : g)) }));
  normalizeOrders(r.workspaceId);
  const place = r.groupId ? s.groups.find((g) => g.id === r.groupId)?.name : s.workspaces.find((w) => w.id === r.workspaceId)?.name;
  if (n && place) useStore.getState().toast(n > 1 ? `${n} documents rangés dans « ${place} »` : `Rangé dans « ${place} »`, 'success');
  return n;
}

export function dropOnto(drag: DragPayload, t: DropTarget): boolean {
  if (drag.type === 'ref') return dropRefs(drag.refs ?? [], t) > 0;
  const r = resolveTarget(drag, t);
  if (!r) return false;
  if (drag.type === 'item') {
    // Sélection multiple : chacun est posé avant la même cible, dans l'ordre affiché (une seule transaction).
    for (const id of sortForMove(dragIds(drag))) placeItem(id, r.parentId, r.beforeId);
  } else return placeGroup(drag.id, r.parentId, r.beforeId);
  return true;
}

// ── Opérations groupées (sélection multiple) ───────────────

/** Ordre stable pour déplacer plusieurs éléments : groupe d'origine, puis rang. */
function sortForMove(ids: string[]): string[] {
  const items = useStore.getState().wsItems;
  const at = new Map(items.map((x, i) => [x.id, i]));
  const byId = new Map(items.map((x) => [x.id, x]));
  return ids
    .filter((id) => byId.has(id))
    .sort((a, b) => {
      const x = byId.get(a)!;
      const y = byId.get(b)!;
      if (x.groupId !== y.groupId) return at.get(a)! - at.get(b)!;
      return x.order - y.order;
    });
}

/**
 * Déplace des éléments vers un groupe (ou la racine) d'un espace, éventuellement un autre espace.
 * Dans un autre espace, un document déjà présent n'est pas dupliqué : sa référence d'origine est retirée.
 * Tout se fait dans le même tour de boucle : une seule entrée d'historique, un seul ⌘Z.
 */
export function moveItems(ids: string[], workspaceId: string, groupId: string | null): number {
  const ordered = sortForMove(ids);
  if (!ordered.length) return 0;
  const s = useStore.getState();
  const fromWs = new Set(ordered.map((id) => s.wsItems.find((x) => x.id === id)!.workspaceId));
  const same = ordered.filter((id) => s.wsItems.find((x) => x.id === id)!.workspaceId === workspaceId);
  const other = ordered.filter((id) => !same.includes(id));
  for (const id of same) placeItem(id, groupId, null);
  if (other.length) {
    useStore.setState((st) => {
      let next = st.wsItems;
      let order = next.filter((x) => x.workspaceId === workspaceId && x.groupId === groupId).length;
      const drop = new Set<string>();
      const patch = new Map<string, Partial<WorkspaceItem>>();
      for (const id of other) {
        const it = next.find((x) => x.id === id)!;
        const dup = next.find((x) => x.workspaceId === workspaceId && x.kind === it.kind && x.refId === it.refId);
        if (dup) drop.add(id);
        else patch.set(id, { workspaceId, groupId, order: order++ });
      }
      next = next.filter((x) => !drop.has(x.id)).map((x) => (patch.has(x.id) ? { ...x, ...patch.get(x.id)! } : x));
      return {
        wsItems: next,
        groups: groupId ? st.groups.map((g) => (g.id === groupId && g.collapsed ? { ...g, collapsed: false } : g)) : st.groups,
      };
    });
    normalizeOrders(workspaceId);
    for (const w of fromWs) normalizeOrders(w);
  }
  return ordered.length;
}

/** Crée un groupe sous `parentId` et y range les éléments ; renvoie le groupe (à renommer). */
export function groupItems(ids: string[], workspaceId: string, parentId: string | null, name = 'Nouveau groupe'): WorkspaceGroup {
  const g = useStore.getState().createGroup(workspaceId, parentId, name);
  moveItems(ids, workspaceId, g.id);
  return g;
}

/** Parent commun des éléments (même groupe pour tous), sinon la racine. */
export function commonParent(ids: string[]): string | null {
  const items = useStore.getState().wsItems.filter((x) => ids.includes(x.id));
  const g = items[0]?.groupId ?? null;
  return items.every((x) => x.groupId === g) ? g : null;
}

// ── Suppressions / dégroupage ───────────────────────────────

/** Les éléments et sous-groupes remontent dans le parent. */
export function ungroup(groupId: string) {
  const g = useStore.getState().groups.find((x) => x.id === groupId);
  if (!g) return;
  // place les enfants à la suite des frères avant de retirer le groupe
  useStore.setState((s) => {
    const nGroups = s.groups.filter((x) => x.workspaceId === g.workspaceId && x.parentId === g.parentId).length;
    const nItems = s.wsItems.filter((x) => x.workspaceId === g.workspaceId && x.groupId === g.parentId).length;
    return {
      groups: s.groups.map((x) => (x.parentId === groupId ? { ...x, order: nGroups + x.order } : x)),
      wsItems: s.wsItems.map((x) => (x.groupId === groupId ? { ...x, order: nItems + x.order } : x)),
    };
  });
  useStore.getState().removeGroup(groupId);
  normalizeOrders(g.workspaceId);
}

/** Supprime le groupe, ses sous-groupes et les références qu'ils contiennent (les documents eux-mêmes restent). */
export function deleteGroupCascade(groupId: string) {
  const s = useStore.getState();
  const g = s.groups.find((x) => x.id === groupId);
  if (!g) return;
  // Corbeille : le groupe, ses sous-groupes et leurs références restent restaurables 30 jours.
  s.trashDelete('group', groupId, { mode: 'tree' });
  normalizeOrders(g.workspaceId);
}

export function countInGroup(groups: WorkspaceGroup[], items: ResolvedItem[], groupId: string): { items: number; groups: number } {
  const ids = subtreeIds(groups, groupId);
  return { items: items.filter((i) => i.item.groupId && ids.has(i.item.groupId)).length, groups: ids.size - 1 };
}

// ── Ouverture ───────────────────────────────────────────────

export function openItem(item: WorkspaceItem) {
  const s = useStore.getState();
  switch (item.kind) {
    case 'book':
      s.openBook(item.refId);
      break;
    case 'draft':
      s.navigate({ name: 'write', draftId: item.refId });
      break;
    case 'plan':
      s.navigate({ name: 'plans', planId: item.refId });
      break;
    case 'argument':
      s.navigate({ name: 'arguments', argumentId: item.refId });
      break;
    case 'study': {
      const st = s.studies.find((x) => x.id === item.refId);
      if (!st) return;
      s.updateSettings({ rightPanel: 'etude' });
      s.openBook(st.bookId);
      break;
    }
    case 'map':
      if (isFreeMapKey(item.refId)) {
        s.navigate({ name: 'board', boardId: item.refId });
        break;
      }
      s.updateBook(item.refId, { lastOpenedAt: Date.now() });
      s.navigate({ name: 'reader', bookId: item.refId, tab: 'carte', splitBookId: null });
      break;
  }
}

/** L'élément 'map' désigne-t-il une carte libre (et non la carte d'un livre) ? */
export function isFreeMapKey(refId: string): boolean {
  const m = useStore.getState().maps[refId];
  return !!m && m.kind === 'board';
}

export function goToWorkspace(workspaceId: string, groupId: string | null) {
  const s = useStore.getState();
  s.updateSettings({ activeWorkspaceId: workspaceId });
  s.navigate({ name: 'workspace', workspaceId, groupId });
}

export function useWorkspaces() {
  return useStore(useShallow((s) => [...s.workspaces].sort(byOrder)));
}

export function renameWorkspace(id: string, name: string) {
  const n = name.trim();
  if (n) useStore.getState().patch('workspaces', id, { name: n });
}
export function renameGroup(id: string, name: string) {
  const n = name.trim();
  if (n) useStore.getState().patch('groups', id, { name: n });
}

/** Cartes à réviser (échéance dépassée, non suspendues) rattachées aux livres donnés. */
export function dueCardsFor(bookIds: Set<string>): number {
  const s = useStore.getState();
  const hl = new Map(s.highlights.map((h) => [h.id, h.bookId]));
  const now = Date.now();
  return s.cards.filter((c) => {
    if (c.suspended || c.fsrs.due > now) return false;
    const b = c.bookId ?? (c.highlightId ? hl.get(c.highlightId) : null);
    return !!b && bookIds.has(b);
  }).length;
}
