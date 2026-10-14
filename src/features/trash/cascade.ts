// ─────────────────────────────────────────────────────────────
// Suppressions en cascade (fonctions pures). Une seule définition sert à :
//  - supprimer un élément (le résultat, comparé à l'état de départ, devient l'entrée de corbeille) ;
//  - retirer d'un élément restauré les références vers ce qui est encore dans la corbeille
//    (l'élément racine est alors absent : seule la partie « références » agit).
// Les éléments non concernés gardent la même référence objet (diff fiable).
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, PlanNode, TrashKind, WorkspaceGroup } from '../../lib/types';
import type { Data } from '../history/engine';

/** map qui renvoie le même tableau si aucun élément n'a changé. */
function mapKeep<T>(arr: T[], fn: (x: T) => T): T[] {
  let changed = false;
  const out = arr.map((x) => {
    const y = fn(x);
    if (y !== x) changed = true;
    return y;
  });
  return changed ? out : arr;
}
function filterKeep<T>(arr: T[], keep: (x: T) => boolean): T[] {
  const out = arr.filter(keep);
  return out.length === arr.length ? arr : out;
}

type RefKind = 'highlight' | 'concept' | 'argument';
function stripPlanNodes(nodes: PlanNode[], kind: RefKind, ids: Set<string>): PlanNode[] {
  return mapKeep(nodes, (n) => {
    const items = filterKeep(n.items, (it) => !(it.ref.kind === kind && ids.has((it.ref as { id: string }).id)));
    const children = stripPlanNodes(n.children, kind, ids);
    return items === n.items && children === n.children ? n : { ...n, items, children };
  });
}
function stripPlans(d: Data, kind: RefKind, ids: Set<string>): Data['plans'] {
  return mapKeep(d.plans, (p) => {
    const parts = stripPlanNodes(p.parts, kind, ids);
    return parts === p.parts ? p : { ...p, parts };
  });
}

function stripHighlightRefs(d: Data, ids: Set<string>): Data {
  if (!ids.size) return d;
  let mapsChanged = false;
  const maps: Record<string, ArgumentMap> = {};
  for (const [k, m] of Object.entries(d.maps)) {
    const removed = new Set(m.nodes.filter((n) => n.highlightId && ids.has(n.highlightId)).map((n) => n.id));
    if (removed.size) {
      mapsChanged = true;
      maps[k] = { ...m, nodes: m.nodes.filter((n) => !removed.has(n.id)), edges: m.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)) };
    } else maps[k] = m;
  }
  return {
    ...d,
    maps: mapsChanged ? maps : d.maps,
    cards: filterKeep(d.cards, (c) => !(c.highlightId && ids.has(c.highlightId))),
    plans: stripPlans(d, 'highlight', ids),
    arguments: mapKeep(d.arguments, (a) => {
      const hit = (s: { highlightId: string | null }) => !!s.highlightId && ids.has(s.highlightId);
      if (!a.premises.some(hit) && !hit(a.conclusion)) return a;
      return {
        ...a,
        premises: a.premises.map((p) => (hit(p) ? { ...p, highlightId: null } : p)),
        conclusion: hit(a.conclusion) ? { ...a.conclusion, highlightId: null } : a.conclusion,
      };
    }),
    concepts: mapKeep(d.concepts, (c) => {
      const senses = mapKeep(c.senses, (se) => {
        const highlightIds = filterKeep(se.highlightIds, (x) => !ids.has(x));
        return highlightIds === se.highlightIds ? se : { ...se, highlightIds };
      });
      return senses === c.senses ? c : { ...c, senses };
    }),
  };
}

const dropWsRefs = (d: Data, kind: string, ids: Set<string>) => filterKeep(d.wsItems, (i) => !(i.kind === kind && ids.has(i.refId)));

/** Sous-arbre d'un groupe (le groupe compris, même s'il n'existe plus). */
function subtree(groups: WorkspaceGroup[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups)
      if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
        ids.add(g.id);
        grew = true;
      }
  }
  return ids;
}

export interface CascadeOpts {
  /** Groupe : le contenu remonte d'un niveau ('lift') ou part avec lui ('tree'). */
  mode?: 'lift' | 'tree';
  /** Parent du groupe supprimé (utile quand le groupe n'est plus dans les données). */
  groupParentId?: string | null;
}

/** Supprime `id` (de nature `kind`) et tout ce qui en dépend ; renvoie le nouvel état. */
export function cascade(d: Data, kind: TrashKind, id: string, opts: CascadeOpts = {}): Data {
  const one = new Set([id]);
  switch (kind) {
    case 'book': {
      const hl = new Set(d.highlights.filter((h) => h.bookId === id).map((h) => h.id));
      const studyIds = new Set(d.studies.filter((x) => x.bookId === id).map((x) => x.id));
      let maps = d.maps;
      if (id in maps) {
        maps = { ...maps };
        delete maps[id];
      }
      let n: Data = {
        ...d,
        books: filterKeep(d.books, (b) => b.id !== id),
        highlights: filterKeep(d.highlights, (h) => h.bookId !== id),
        studies: filterKeep(d.studies, (x) => x.bookId !== id),
        maps,
      };
      n = stripHighlightRefs(n, hl);
      return {
        ...n,
        cards: filterKeep(n.cards, (c) => c.bookId !== id),
        wsItems: filterKeep(n.wsItems, (i) => !(((i.kind === 'book' || i.kind === 'map') && i.refId === id) || (i.kind === 'study' && studyIds.has(i.refId)))),
      };
    }
    case 'highlight':
      return stripHighlightRefs({ ...d, highlights: filterKeep(d.highlights, (h) => h.id !== id) }, one);
    case 'concept':
      return {
        ...d,
        concepts: mapKeep(
          filterKeep(d.concepts, (c) => c.id !== id),
          (c) => (c.links.some((l) => l.conceptId === id) ? { ...c, links: c.links.filter((l) => l.conceptId !== id) } : c),
        ),
        highlights: mapKeep(d.highlights, (h) => (h.conceptIds.includes(id) ? { ...h, conceptIds: h.conceptIds.filter((x) => x !== id) } : h)),
        cards: filterKeep(d.cards, (c) => c.conceptId !== id),
        plans: stripPlans(d, 'concept', one),
      };
    case 'argument':
      return { ...d, arguments: filterKeep(d.arguments, (a) => a.id !== id), plans: stripPlans(d, 'argument', one), wsItems: dropWsRefs(d, 'argument', one) };
    case 'study':
      return { ...d, studies: filterKeep(d.studies, (x) => x.id !== id), wsItems: dropWsRefs(d, 'study', one) };
    case 'plan':
      return { ...d, plans: filterKeep(d.plans, (p) => p.id !== id), wsItems: dropWsRefs(d, 'plan', one) };
    case 'draft':
      return {
        ...d,
        drafts: filterKeep(d.drafts, (x) => x.id !== id),
        wsItems: dropWsRefs(d, 'draft', one),
        plans: mapKeep(d.plans, (p) => (p.draftId === id ? { ...p, draftId: null } : p)),
      };
    case 'card':
      return { ...d, cards: filterKeep(d.cards, (c) => c.id !== id) };
    case 'workspace':
      return {
        ...d,
        workspaces: filterKeep(d.workspaces, (w) => w.id !== id),
        groups: filterKeep(d.groups, (g) => g.workspaceId !== id),
        wsItems: filterKeep(d.wsItems, (i) => i.workspaceId !== id),
      };
    case 'group': {
      if (opts.mode === 'tree') {
        const ids = subtree(d.groups, id);
        return {
          ...d,
          groups: filterKeep(d.groups, (g) => !ids.has(g.id)),
          wsItems: filterKeep(d.wsItems, (i) => !(i.groupId && ids.has(i.groupId))),
        };
      }
      const g = d.groups.find((x) => x.id === id);
      const parent = g ? g.parentId : (opts.groupParentId ?? null);
      return {
        ...d,
        groups: mapKeep(
          filterKeep(d.groups, (x) => x.id !== id),
          (x) => (x.parentId === id ? { ...x, parentId: parent } : x),
        ),
        wsItems: mapKeep(d.wsItems, (i) => (i.groupId === id ? { ...i, groupId: parent } : i)),
      };
    }
  }
}

/** Cascade de plusieurs éléments de même nature (une seule passe pour les extraits). */
export function cascadeMany(d: Data, kind: TrashKind, ids: string[], opts: CascadeOpts = {}): Data {
  if (!ids.length) return d;
  if (kind === 'highlight') {
    const set = new Set(ids);
    return stripHighlightRefs({ ...d, highlights: filterKeep(d.highlights, (h) => !set.has(h.id)) }, set);
  }
  let cur = d;
  for (const id of ids) cur = cascade(cur, kind, id, opts);
  return cur;
}

/**
 * Références d'un élément restauré vers des éléments qui n'existent plus nulle part
 * (ni dans les données, ni dans la corbeille) : on les retire comme l'aurait fait leur suppression.
 */
export function danglingRefs(d: Data, full: Data, inTrash: (kind: TrashKind, id: string) => boolean): { kind: TrashKind; id: string }[] {
  // `d` : les éléments à vérifier ; `full` : toutes les données (ce qui existe).
  const out = new Map<string, { kind: TrashKind; id: string }>();
  const has = {
    highlight: new Set(full.highlights.map((x) => x.id)),
    concept: new Set(full.concepts.map((x) => x.id)),
    argument: new Set(full.arguments.map((x) => x.id)),
    draft: new Set(full.drafts.map((x) => x.id)),
  };
  const check = (kind: keyof typeof has, id: string | null | undefined) => {
    if (!id || has[kind].has(id) || inTrash(kind, id)) return;
    out.set(kind + ':' + id, { kind, id });
  };
  for (const h of d.highlights) h.conceptIds.forEach((c) => check('concept', c));
  for (const c of d.concepts) {
    c.links.forEach((l) => check('concept', l.conceptId));
    c.senses.forEach((s) => s.highlightIds.forEach((x) => check('highlight', x)));
  }
  for (const a of d.arguments) [...a.premises, a.conclusion].forEach((s) => check('highlight', s.highlightId));
  for (const c of d.cards) {
    check('highlight', c.highlightId);
    check('concept', c.conceptId);
  }
  for (const m of Object.values(d.maps)) m.nodes.forEach((n) => check('highlight', n.highlightId));
  const walk = (nodes: PlanNode[]) =>
    nodes.forEach((n) => {
      n.items.forEach((it) => it.ref.kind !== 'text' && check(it.ref.kind, it.ref.id));
      walk(n.children);
    });
  for (const p of d.plans) {
    walk(p.parts);
    check('draft', p.draftId);
  }
  return [...out.values()];
}
