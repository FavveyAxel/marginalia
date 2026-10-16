// « Suivre une chaîne » : la chaîne d'une carte, calculée sans interface.
//
// Sens des liens (voir onConnect / gaps.ts) : un lien { source: A, target: T, relation: 'soutient' }
// se lit « A soutient T ». De même « O objecte à T », « R répond à O ».
//
//  - appuis : ce qui soutient, précise ou illustre la carte, puis ce qui appuie ces appuis (récursif) ;
//  - objections : ce qui objecte à (ou s'oppose à, ou répond à) la carte ou à l'un de ses appuis ;
//  - réponses : ce qui répond à ces objections ;
//  - conséquences (facultatif) : ce que la carte soutient, en remontant (récursif) ;
//  - liées : les voisines directes de la carte par un lien neutre (« lien », dans un sens ou dans
//    l'autre), hors de la chaîne. Un lien neutre n'affirme rien : ni appui, ni objection ; ces
//    cartes sont données à part (`linked`, `linkedEdges`), sans rôle, pour un affichage discret,
//    et n'entrent pas dans le diagnostic.
//
// Diagnostic : branches d'appui indépendantes (prémisses conjointes = une seule branche), chaîne
// la plus longue, objections sans réponse, et « point fragile » : une carte dont le retrait
// coupe la carte de tous ses appuis de base. Les cycles sont tolérés (parcours avec visités).
import type { ArgumentMap, MapEdge, RelationId } from '../../../lib/types';

export const SUPPORT_RELATIONS: ReadonlySet<RelationId> = new Set<RelationId>(['soutient', 'precise', 'illustre']);
export const ATTACK_RELATIONS: ReadonlySet<RelationId> = new Set<RelationId>(['objecte', 'oppose']);
export const REPLY_RELATIONS: ReadonlySet<RelationId> = new Set<RelationId>(['repond']);
/** Relations neutres : ni appui, ni objection. */
export const NEUTRAL_RELATIONS: ReadonlySet<RelationId> = new Set<RelationId>(['lien']);

export type ChainRole = 'root' | 'support' | 'objection' | 'reply' | 'consequence';

export interface ChainDiagnosis {
  /** Nombre de cartes qui appuient (directement ou non) la carte. */
  supportCount: number;
  /** Branches d'appui indépendantes : appuis directs, prémisses conjointes comptées une fois. */
  branches: number;
  /** Appuis directs (liens d'appui qui arrivent à la carte). */
  direct: number;
  /** Nombre de liens de la plus longue chaîne d'appuis qui aboutit à la carte. */
  longest: number;
  objectionCount: number;
  /** Objections de la chaîne sans aucune réponse (ordre de profondeur). */
  unanswered: string[];
  /** Points fragiles : retirer l'un d'eux coupe tous les appuis (le plus proche de la carte d'abord). */
  fragile: string[];
  consequenceCount: number;
}

export interface Chain {
  root: string;
  supports: string[];
  objections: string[];
  replies: string[];
  consequences: string[];
  /** Voisines directes par un lien neutre, hors de la chaîne (sans rôle : affichage estompé « liées »). */
  linked: string[];
  /** Liens neutres qui relient la carte à ces voisines. */
  linkedEdges: string[];
  /** Ids des liens de la chaîne. */
  edges: string[];
  /** Distance à la carte (0 pour elle ; négative pour les conséquences). */
  depth: Record<string, number>;
  role: Record<string, ChainRole>;
  diagnosis: ChainDiagnosis;
}

export interface ChainOptions {
  /** Suivre aussi, en remontant, ce que la carte soutient. */
  consequences?: boolean;
  /** Cartes masquées (zones repliées, branches pliées…) : ignorées, comme leurs liens. */
  hidden?: ReadonlySet<string>;
}

type MapLike = Pick<ArgumentMap, 'nodes' | 'edges'>;

/** Chaîne de `rootId` ; null si la carte n'existe pas ou est masquée. */
export function computeChain(map: MapLike, rootId: string, opts: ChainOptions = {}): Chain | null {
  const hidden = opts.hidden;
  const visible = new Set(map.nodes.filter((n) => !hidden?.has(n.id)).map((n) => n.id));
  if (!visible.has(rootId)) return null;
  const edges = map.edges.filter((e) => e.source !== e.target && visible.has(e.source) && visible.has(e.target));
  const into = new Map<string, MapEdge[]>();
  const outOf = new Map<string, MapEdge[]>();
  for (const e of edges) {
    (into.get(e.target) ?? into.set(e.target, []).get(e.target)!).push(e);
    (outOf.get(e.source) ?? outOf.set(e.source, []).get(e.source)!).push(e);
  }
  const role: Record<string, ChainRole> = { [rootId]: 'root' };
  const depth: Record<string, number> = { [rootId]: 0 };
  const chainEdges = new Set<string>();
  const supports: string[] = [];
  const objections: string[] = [];
  const replies: string[] = [];
  const consequences: string[] = [];

  // ── Appuis (largeur d'abord : profondeur = plus court chemin) ──
  const queue = [rootId];
  for (let i = 0; i < queue.length; i++) {
    const x = queue[i];
    for (const e of into.get(x) ?? []) {
      if (!SUPPORT_RELATIONS.has(e.relation)) continue;
      chainEdges.add(e.id);
      const s = e.source;
      if (role[s]) continue;
      role[s] = 'support';
      depth[s] = depth[x] + 1;
      supports.push(s);
      queue.push(s);
    }
  }
  const anchored = new Set(queue);

  // ── Objections contre la carte ou ses appuis, puis réponses ──
  for (const x of queue) {
    for (const e of into.get(x) ?? []) {
      // Une réponse adressée à la carte suivie (une objection, par exemple) la conteste aussi.
      if (!ATTACK_RELATIONS.has(e.relation) && !REPLY_RELATIONS.has(e.relation)) continue;
      chainEdges.add(e.id);
      if (role[e.source]) continue;
      role[e.source] = 'objection';
      depth[e.source] = depth[x] + 1;
      objections.push(e.source);
    }
  }
  const unanswered: string[] = [];
  for (const o of objections) {
    let answered = false;
    for (const e of into.get(o) ?? []) {
      if (!REPLY_RELATIONS.has(e.relation)) continue;
      answered = true;
      chainEdges.add(e.id);
      if (role[e.source]) continue;
      role[e.source] = 'reply';
      depth[e.source] = depth[o] + 1;
      replies.push(e.source);
    }
    if (!answered) unanswered.push(o);
  }

  // ── Conséquences : ce que la carte soutient, en remontant ──
  if (opts.consequences) {
    const up = [rootId];
    for (let i = 0; i < up.length; i++) {
      const x = up[i];
      for (const e of outOf.get(x) ?? []) {
        if (!SUPPORT_RELATIONS.has(e.relation)) continue;
        const t = e.target;
        // Boucle vers un appui ou la carte elle-même : le lien est montré, sans reclasser.
        chainEdges.add(e.id);
        if (role[t]) continue;
        role[t] = 'consequence';
        depth[t] = depth[x] - 1;
        consequences.push(t);
        up.push(t);
      }
    }
  }

  // ── Liées : voisines directes par un lien neutre (hors chaîne, sans rôle) ──
  const linked: string[] = [];
  const linkedEdges: string[] = [];
  for (const e of [...(outOf.get(rootId) ?? []), ...(into.get(rootId) ?? [])]) {
    if (!NEUTRAL_RELATIONS.has(e.relation)) continue;
    const other = e.source === rootId ? e.target : e.source;
    if (role[other]) continue;
    linkedEdges.push(e.id);
    if (!linked.includes(other)) linked.push(other);
  }

  // ── Diagnostic ──
  const supIn = (x: string) => (into.get(x) ?? []).filter((e) => SUPPORT_RELATIONS.has(e.relation) && anchored.has(e.source));
  const preds = new Map([...anchored].map((x) => [x, supIn(x).map((e) => e.source).filter((p) => p !== x)]));
  const directIn = supIn(rootId).filter((e) => e.source !== rootId);
  const branchKeys = new Set(directIn.map((e) => (e.groupId ? `g:${e.groupId}` : `n:${e.source}`)));

  // Chaîne la plus longue : chemin d'appuis le plus long vers la carte, les retours en arrière
  // (cycles) étant coupés par la pile de parcours.
  const memo = new Map<string, number>();
  const onStack = new Set<string>();
  const longestTo = (x: string): number => {
    const m = memo.get(x);
    if (m != null) return m;
    onStack.add(x);
    let best = 0;
    for (const p of preds.get(x) ?? []) if (!onStack.has(p)) best = Math.max(best, 1 + longestTo(p));
    onStack.delete(x);
    memo.set(x, best);
    return best;
  };
  const longest = supports.length ? longestTo(rootId) : 0;

  const fragile = supports.length ? fragilePoints(rootId, supports, anchored, preds).sort((a, b) => depth[a] - depth[b]) : [];

  return {
    root: rootId,
    supports,
    objections,
    replies,
    consequences,
    linked,
    linkedEdges,
    edges: [...chainEdges],
    depth,
    role,
    diagnosis: {
      supportCount: supports.length,
      branches: branchKeys.size,
      direct: directIn.length,
      longest,
      objectionCount: objections.length,
      unanswered,
      fragile,
      consequenceCount: consequences.length,
    },
  };
}

/**
 * Points fragiles. Les « appuis de base » sont les cartes des composantes fortement connexes
 * sources du graphe des appuis (une carte que rien n'appuie, ou une boucle d'appuis que rien
 * d'extérieur n'appuie). Une carte est fragile si tout chemin d'un appui de base vers la carte
 * suivie passe par elle : ce sont les dominateurs de la carte suivie depuis une entrée virtuelle
 * reliée à chaque appui de base (algorithme itératif de Cooper, Harvey et Kennedy).
 */
function fragilePoints(rootId: string, supports: string[], anchored: Set<string>, preds: Map<string, string[]>): string[] {
  const nodes = [...anchored];
  const comp = scc(nodes, (x) => preds.get(x) ?? []);
  // Composante source : aucun appui venu d'une autre composante.
  const hasExternal = new Set<number>();
  for (const x of nodes) for (const p of preds.get(x) ?? []) if (comp.get(p) !== comp.get(x)) hasExternal.add(comp.get(x)!);
  let base = supports.filter((x) => !hasExternal.has(comp.get(x)!));
  if (!base.length) base = supports;

  // Graphe dans le sens des appuis (p → x : p appuie x), entrée virtuelle → appuis de base.
  const ENTRY = '\u0000entrée';
  const succ = new Map<string, string[]>([[ENTRY, base]]);
  const pred = new Map<string, string[]>(nodes.map((x) => [x, [...(preds.get(x) ?? [])]]));
  for (const b of base) pred.get(b)!.push(ENTRY);
  for (const [x, ps] of preds) for (const p of ps) (succ.get(p) ?? succ.set(p, []).get(p)!).push(x);
  // Ordre postfixe depuis l'entrée (itératif).
  const order: string[] = [];
  const seen = new Set<string>([ENTRY]);
  const work: { v: string; i: number }[] = [{ v: ENTRY, i: 0 }];
  while (work.length) {
    const top = work[work.length - 1];
    const ns = succ.get(top.v) ?? [];
    if (top.i < ns.length) {
      const w = ns[top.i++];
      if (!seen.has(w)) {
        seen.add(w);
        work.push({ v: w, i: 0 });
      }
    } else {
      order.push(top.v);
      work.pop();
    }
  }
  if (!seen.has(rootId)) return [];
  const po = new Map(order.map((v, i) => [v, i]));
  const rpo = [...order].reverse();
  const idom = new Map<string, string>([[ENTRY, ENTRY]]);
  const intersect = (a: string, b: string) => {
    while (a !== b) {
      while (po.get(a)! < po.get(b)!) a = idom.get(a)!;
      while (po.get(b)! < po.get(a)!) b = idom.get(b)!;
    }
    return a;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const v of rpo) {
      if (v === ENTRY) continue;
      let nd: string | undefined;
      for (const p of pred.get(v) ?? []) {
        if (!idom.has(p)) continue;
        nd = nd === undefined ? p : intersect(p, nd);
      }
      if (nd !== undefined && idom.get(v) !== nd) {
        idom.set(v, nd);
        changed = true;
      }
    }
  }
  const out: string[] = [];
  for (let v = idom.get(rootId); v && v !== ENTRY; v = idom.get(v)) out.push(v);
  return out;
}

/** Composantes fortement connexes (Tarjan, itératif) ; `next` donne les voisins. */
function scc(nodes: string[], next: (x: string) => string[]): Map<string, number> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onSt = new Set<string>();
  const st: string[] = [];
  const comp = new Map<string, number>();
  let idx = 0;
  let c = 0;
  for (const start of nodes) {
    if (index.has(start)) continue;
    const work: { v: string; i: number }[] = [{ v: start, i: 0 }];
    index.set(start, idx);
    low.set(start, idx++);
    st.push(start);
    onSt.add(start);
    while (work.length) {
      const top = work[work.length - 1];
      const ns = next(top.v);
      if (top.i < ns.length) {
        const w = ns[top.i++];
        if (!index.has(w)) {
          index.set(w, idx);
          low.set(w, idx++);
          st.push(w);
          onSt.add(w);
          work.push({ v: w, i: 0 });
        } else if (onSt.has(w)) low.set(top.v, Math.min(low.get(top.v)!, index.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].v;
        low.set(parent, Math.min(low.get(parent)!, low.get(top.v)!));
      }
      if (low.get(top.v) === index.get(top.v)) {
        let w: string;
        do {
          w = st.pop()!;
          onSt.delete(w);
          comp.set(w, c);
        } while (w !== top.v);
        c++;
      }
    }
  }
  return comp;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Diagnostic en clair, par morceaux (à joindre par « · »). */
export function chainSummary(d: ChainDiagnosis, opts: { consequences?: boolean } = {}): string[] {
  const parts: string[] = [];
  if (!d.supportCount) parts.push('aucun appui');
  else {
    parts.push(d.branches > 1 ? `${d.branches} appuis indépendants` : d.direct > 1 ? '1 appui (prémisses conjointes)' : '1 seul appui direct');
    parts.push(`chaîne la plus longue : ${d.longest}`);
  }
  if (d.unanswered.length) parts.push(plural(d.unanswered.length, 'objection sans réponse', 'objections sans réponse'));
  else if (d.objectionCount) parts.push(d.objectionCount > 1 ? `${d.objectionCount} objections, toutes répondues` : '1 objection, répondue');
  if (opts.consequences) parts.push(d.consequenceCount ? `soutient ${plural(d.consequenceCount, 'idée', 'idées')}` : 'ne soutient rien d’autre');
  return parts;
}
