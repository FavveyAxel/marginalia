// ─────────────────────────────────────────────────────────────
// Lecture guidée d'une carte (pur, sans store ni DOM).
//
// Ordre de présentation, en suivant les liens :
//   centre de la carte (problématique ou sujet, voir center.ts), puis les thèses qui y répondent
//   (ou s'y rattachent), chacune développée comme ci-dessous ;
//   problème(s) → thèse (carte centrale d'abord) et ses précisions / exemples
//   → arguments (« soutient » la thèse), chacun suivi de ses sous-arguments, précisions, exemples
//   → thèses opposées (« s’oppose à », cartes multi-livres) et leurs arguments
//   → objections (« objecte à » une carte déjà présentée), chacune suivie de ses réponses
//   → idées restantes (non reliées à ce qui précède), dans l'ordre de lecture (haut → bas, gauche → droite).
//
// Liens neutres (« lien », qui n'affirment rien) : la carte tirée (cible) est présentée juste après
// la carte d'où on l'a tirée (source), comme « idée liée » (récursif), après ses sous-arguments,
// précisions et exemples. Depuis le centre, les cartes liées sont présentées comme les thèses qui y
// répondent (ou s'y rattachent), avec la légende « liée à ».
//
// API :
//   guidedReading(map, lk) → GuidedStep[]
//     GuidedStep = { nodeId, role, edgesToHighlight, caption, depth, parentId, label }
//     edgesToHighlight : liens entre cette carte et celles déjà présentées (à mettre en évidence).
//   GUIDED_ROLE_LABEL : libellés français des rôles.
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, MapEdge, MapNode, RelationId } from '../../../lib/types';
import { nodeCategory, nodeText, type MapLookup } from './core';
import { mapCenter } from './center';

export type GuidedRole = 'problematique' | 'sujet' | 'probleme' | 'these' | 'argument' | 'sous-argument' | 'exemple' | 'precision' | 'liee' | 'opposition' | 'objection' | 'reponse' | 'reste';

export const GUIDED_ROLE_LABEL: Record<GuidedRole, string> = {
  problematique: 'Problématique',
  sujet: 'Sujet',
  probleme: 'Problème',
  these: 'Thèse',
  argument: 'Argument',
  'sous-argument': 'Sous-argument',
  exemple: 'Exemple',
  precision: 'Précision',
  liee: 'Idée liée',
  opposition: 'Thèse opposée',
  objection: 'Objection',
  reponse: 'Réponse',
  reste: 'Idée restante',
};

export interface GuidedStep {
  nodeId: string;
  role: GuidedRole;
  /** Liens entre cette carte et les cartes déjà présentées. */
  edgesToHighlight: string[];
  /** Phrase de présentation (« Argument 2 : soutient la thèse »). */
  caption: string;
  /** Profondeur dans l'arbre de présentation (0 : problème, thèse, objection…). */
  depth: number;
  /** Carte à laquelle celle-ci se rattache (null : départ). */
  parentId: string | null;
  /** Nom court de la carte dans la lecture (« l’argument 2 »). */
  label: string;
}

/** Ordre de lecture d'une carte : haut → bas puis gauche → droite (lignes de 60 px). */
const byPos = (a: MapNode, b: MapNode) => Math.round(a.y / 60) - Math.round(b.y / 60) || a.x - b.x || a.y - b.y;

/** Rôle d'un enfant selon la relation qui le rattache. */
const CHILD_ROLE: Partial<Record<RelationId, GuidedRole>> = { soutient: 'sous-argument', precise: 'precision', illustre: 'exemple' };

export function guidedReading(map: ArgumentMap, lk: MapLookup): GuidedStep[] {
  const nodes = new Map(map.nodes.map((n) => [n.id, n]));
  const steps: GuidedStep[] = [];
  const seen = new Set<string>();
  const labels = new Map<string, string>();
  const counters: Partial<Record<GuidedRole, number>> = {};
  const cat = (id: string) => {
    const n = nodes.get(id);
    return n ? nodeCategory(n, lk) : null;
  };
  const sorted = (ids: Iterable<string>) =>
    [...new Set(ids)]
      .filter((id) => nodes.has(id) && !seen.has(id))
      .map((id) => nodes.get(id)!)
      .sort(byPos)
      .map((n) => n.id);
  const into = (id: string, rels: RelationId[]) => sorted(map.edges.filter((e) => e.target === id && rels.includes(e.relation)).map((e) => e.source));
  /** Cartes tirées de `id` par un lien neutre (cibles des liens « lien » qui en partent). */
  const linkedFrom = (id: string) => sorted(map.edges.filter((e) => e.source === id && e.relation === 'lien').map((e) => e.target));
  const edgeBetween = (id: string): string[] =>
    map.edges.filter((e) => (e.source === id && seen.has(e.target)) || (e.target === id && seen.has(e.source))).map((e) => e.id);

  const nameOf = (role: GuidedRole, n: number): string => {
    switch (role) {
      case 'problematique':
        return 'la problématique';
      case 'sujet':
        return 'le sujet';
      case 'probleme':
        return n > 1 ? `le problème ${n}` : 'le problème';
      case 'these':
        return n > 1 ? `la thèse ${n}` : 'la thèse';
      case 'argument':
        return `l’argument ${n}`;
      case 'sous-argument':
        return `le sous-argument ${n}`;
      case 'exemple':
        return `l’exemple ${n}`;
      case 'precision':
        return `la précision ${n}`;
      case 'liee':
        return `l’idée liée ${n}`;
      case 'opposition':
        return n > 1 ? `la thèse opposée ${n}` : 'la thèse opposée';
      case 'objection':
        return `l’objection ${n}`;
      case 'reponse':
        return `la réponse ${n}`;
      case 'reste':
        return `l’idée ${n}`;
    }
  };
  const short = (id: string) => {
    const n = nodes.get(id);
    const t = n ? nodeText(n, lk) : '';
    return t.length > 60 ? `« ${t.slice(0, 57).replace(/\s+\S*$/, '')}… »` : t ? `« ${t} »` : 'une carte';
  };
  const ref = (id: string | null) => (id ? (labels.get(id) ?? short(id)) : '');

  const center = mapCenter(map);
  /** Liens neutres du centre vers ses thèses (légende « liée à » plutôt que « répond à »). */
  const neutralFromCenter = new Set<string>();
  const visit = (id: string, role: GuidedRole, parentId: string | null, depth: number, rel?: RelationId) => {
    if (seen.has(id) || !nodes.has(id)) return false;
    const k = (counters[role] = (counters[role] ?? 0) + 1);
    const label = nameOf(role, k);
    const edges = edgeBetween(id);
    seen.add(id);
    labels.set(id, label);
    const parent = ref(parentId);
    let caption: string;
    switch (role) {
      case 'problematique':
        caption = 'La problématique : la question à résoudre';
        break;
      case 'sujet':
        caption = 'Le sujet : le thème à explorer';
        break;
      case 'probleme':
        caption = k > 1 ? `Problème ${k} : une autre question que le texte affronte` : 'Le problème : la question que le texte affronte';
        break;
      case 'these':
        caption =
          parentId && center?.id === parentId
            ? `Thèse ${k} : ${neutralFromCenter.has(id) ? 'liée à' : center.kind === 'question' ? 'répond à' : 'se rattache à'} ${parent}`
            : k > 1
              ? `Thèse ${k} : une autre affirmation de l’auteur`
              : 'La thèse : ce que l’auteur affirme';
        break;
      case 'argument':
        caption = `Argument ${k} : soutient ${parent}`;
        break;
      case 'sous-argument':
        caption = `Sous-argument : soutient ${parent}`;
        break;
      case 'exemple':
        caption = `Exemple : illustre ${parent}`;
        break;
      case 'precision':
        caption = `Précision : précise ${parent}`;
        break;
      case 'liee':
        caption = `Idée liée à ${parent}`;
        break;
      case 'opposition':
        caption = `Thèse opposée : s’oppose à ${parent}`;
        break;
      case 'objection':
        caption = parentId ? `Objection ${k} : objecte à ${parent}` : `Objection ${k} : une thèse adverse discutée par le texte`;
        break;
      case 'reponse':
        caption = `Réponse : répond à ${parent}`;
        break;
      default:
        caption = rel && parentId ? `Idée restante, liée à ${parent}` : 'Idée restante, hors de l’enchaînement principal';
    }
    // « à le sujet » → « au sujet », « à le problème » → « au problème »…
    caption = caption.replace(/(^|\s)à le /g, '$1au ');
    steps.push({ nodeId: id, role, edgesToHighlight: edges, caption, depth, parentId, label });
    return true;
  };

  /** Idées liées à une carte par un lien neutre (récursif). */
  const expandLinked = (id: string, depth: number) => {
    for (const c of linkedFrom(id)) if (visit(c, 'liee', id, depth + 1, 'lien')) expandSupport(c, depth + 1);
  };
  /** Sous-arguments, précisions et exemples d'une carte, puis ses idées liées (récursif). */
  const expandSupport = (id: string, depth: number) => {
    for (const rel of ['precise', 'illustre', 'soutient'] as RelationId[]) {
      for (const c of into(id, [rel])) {
        if (visit(c, CHILD_ROLE[rel]!, id, depth + 1, rel)) expandSupport(c, depth + 1);
      }
    }
    expandLinked(id, depth);
  };
  /** Thèse : précisions et exemples directs, puis arguments (chacun développé), puis idées liées. */
  const expandThesis = (id: string, depth: number) => {
    for (const rel of ['precise', 'illustre'] as RelationId[])
      for (const c of into(id, [rel])) if (visit(c, CHILD_ROLE[rel]!, id, depth + 1, rel)) expandSupport(c, depth + 1);
    for (const a of into(id, ['soutient'])) if (visit(a, 'argument', id, depth + 1)) expandSupport(a, depth + 1);
    expandLinked(id, depth);
  };
  const opposedTo = (id: string) =>
    sorted(map.edges.filter((e) => e.relation === 'oppose' && (e.source === id || e.target === id)).map((e) => (e.source === id ? e.target : e.source)));

  // 0. Le centre (problématique ou sujet) ouvre la lecture ; ce qui y répond (ou s'y rattache)
  //    est présenté ensuite comme autant de thèses.
  const centerTheses = center ? into(center.id, ['repond', 'rattache', 'soutient']) : [];
  if (center) {
    // Cartes tirées du centre par un lien neutre (ou reliées à lui par un lien neutre dans l'autre sens).
    const linkedToCenter = sorted([...linkedFrom(center.id), ...into(center.id, ['lien'])]).filter((id) => !centerTheses.includes(id));
    for (const id of linkedToCenter) neutralFromCenter.add(id);
    centerTheses.push(...linkedToCenter);
  }
  if (center) visit(center.id, center.kind === 'question' ? 'problematique' : 'sujet', null, 0);

  // 1. Problèmes.
  for (const p of sorted(map.nodes.filter((n) => cat(n.id) === 'probleme').map((n) => n.id))) visit(p, 'probleme', null, 0);

  // 2. Thèses : la carte centrale, puis les thèses du texte (les plus soutenues d'abord) ;
  //    à défaut, les sommets des chaînes « soutient ».
  const support = (id: string) => map.edges.filter((e) => e.target === id && e.relation === 'soutient').length;
  let theses = map.nodes.filter((n) => cat(n.id) === 'these').map((n) => n.id);
  if (!theses.length && !map.centralId)
    theses = map.nodes.filter((n) => support(n.id) > 0 && !map.edges.some((e) => e.source === n.id && e.relation === 'soutient')).map((n) => n.id);
  theses = sorted(theses).sort((a, b) => support(b) - support(a));
  if (map.centralId && nodes.has(map.centralId)) theses = [map.centralId, ...theses.filter((t) => t !== map.centralId)];
  theses = [...centerTheses, ...theses.filter((t) => !centerTheses.includes(t))];
  const fromCenter = new Set(centerTheses);
  const thesisQueue = [...theses];
  while (thesisQueue.length) {
    const t = thesisQueue.shift()!;
    if (!visit(t, 'these', fromCenter.has(t) && center ? center.id : null, 0)) continue;
    expandThesis(t, 0);
    // Thèses opposées (et leurs arguments), juste après la thèse qu'elles contestent.
    // (une thèse qui répond elle aussi au centre garde son rang de thèse.)
    const opp = opposedTo(t).filter((o) => !fromCenter.has(o));
    while (opp.length) {
      const o = opp.shift()!;
      if (!visit(o, 'opposition', t, 0)) continue;
      expandThesis(o, 0);
      opp.push(...opposedTo(o).filter((x) => !fromCenter.has(x)));
    }
  }

  // 3. Objections aux cartes déjà présentées, suivies de leurs réponses ; on recommence tant
  //    que de nouvelles cartes apparaissent (objection à une réponse…).
  const answer = (o: string, depth: number) => {
    expandSupport(o, depth);
    for (const r of into(o, ['repond'])) if (visit(r, 'reponse', o, depth + 1)) expandSupport(r, depth + 1);
  };
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of [...steps]) {
      for (const o of into(s.nodeId, ['objecte'])) {
        if (visit(o, 'objection', s.nodeId, 0)) {
          grew = true;
          answer(o, 0);
        }
      }
      for (const r of into(s.nodeId, ['repond'])) {
        if (visit(r, 'reponse', s.nodeId, s.depth + 1)) {
          grew = true;
          expandSupport(r, s.depth + 1);
        }
      }
    }
    // Objections non reliées (catégorie « Thèse adverse »).
    if (!grew) {
      const loose = sorted(map.nodes.filter((n) => cat(n.id) === 'objection').map((n) => n.id));
      if (loose.length && visit(loose[0], 'objection', null, 0)) {
        grew = true;
        answer(loose[0], 0);
      }
    }
  }

  // 4. Idées restantes, dans l'ordre de lecture (chacune avec ce qui s'y rattache).
  for (const n of [...map.nodes].sort(byPos)) {
    if (seen.has(n.id)) continue;
    const linked = map.edges.find((e) => (e.source === n.id && seen.has(e.target)) || (e.target === n.id && seen.has(e.source)));
    const parent = linked ? (linked.source === n.id ? linked.target : linked.source) : null;
    visit(n.id, 'reste', parent, 0, linked?.relation);
    expandSupport(n.id, 0);
    for (const r of into(n.id, ['repond', 'objecte'])) if (visit(r, 'reste', n.id, 1, 'repond')) expandSupport(r, 1);
  }
  return steps;
}

/** Texte d'une étape (pour les exports et l'écrit). */
export const stepText = (map: ArgumentMap, step: GuidedStep, lk: MapLookup): string => {
  const n = map.nodes.find((x) => x.id === step.nodeId);
  return n ? nodeText(n, lk) : '';
};

/** Liens d'une carte (pour la mise en évidence) — utilitaire pour l'interface. */
export const edgesOf = (map: ArgumentMap, nodeId: string): MapEdge[] => map.edges.filter((e) => e.source === nodeId || e.target === nodeId);

