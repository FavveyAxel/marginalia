// ─────────────────────────────────────────────────────────────
// Centre d'une carte : problématique ou sujet (pur, sans store ni DOM).
//
// Une carte peut avoir en son cœur une carte « centre » (MapNode.kind) :
//   - 'question' : une PROBLÉMATIQUE (« Peut-on avoir le droit de mentir ? ») — les thèses
//     qui s'y rattachent y répondent (relation « répond à ») : la carte se lit comme un
//     problème à résoudre ;
//   - 'subject'  : un SUJET, un thème (« Le mensonge ») — les idées s'y rattachent (relation
//     « se rattache à ») : la carte se lit comme un thème à explorer (carte mentale).
// En principe un seul centre par carte ; plusieurs ne cassent rien (le premier fait foi).
//
// Liens tracés à la main (tirer un lien depuis une carte, vers une carte ou dans le vide) : ils sont
// NEUTRES par défaut (relation « lien », qui n'affirme rien), y compris depuis ou vers le centre ;
// leur sens est celui du geste (source = carte de départ). L'utilisateur leur donne une nature
// ensuite s'il le souhaite. « répond à » / « se rattache à » ne sont plus posés automatiquement que
// par les commandes explicites (Tab sur le centre : « une thèse qui y répond »).
//
// API :
//   CENTER_LABEL, CENTER_PLACEHOLDER          libellés (« Problématique », « Sujet »)
//   isCenter(n)                                la carte est-elle un centre ?
//   mapCenter(map)                             premier centre de la carte (ou null)
//   centerRelation(kind)                       relation naturelle vers un centre ('repond' / 'rattache')
//   NEUTRAL_RELATION                           'lien' : relation par défaut d'un lien tracé à la main
//   newLinkRelation()                          relation d'un nouveau lien tracé (toujours 'lien')
//   relationToward(map, targetId)              relation d'une carte CRÉÉE comme enfant de `targetId` par une
//                                              commande explicite (Tab) : celle du centre, sinon null
//   addCenter(map, kind, at, opts)             → { map, id }   pose un centre (texte vide, à écrire)
//   setNodeCenter(map, nodeId, kind | null)    → map           fait d'une idée le centre (ou l'inverse) ;
//                                                              les liens « soutient » vers elle deviennent
//                                                              la relation du centre (et réciproquement)
//   layoutRootId(map, centralId)               racine des rangements : le centre, sinon la thèse centrale
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, MapNode, RelationId } from '../../../lib/types';
import { clean, defaultId, type IdFn } from './core';

export type CenterKind = 'question' | 'subject';

export const CENTER_LABEL: Record<CenterKind, string> = { question: 'Problématique', subject: 'Sujet' };
export const CENTER_PLACEHOLDER: Record<CenterKind, string> = {
  question: 'Peut-on avoir le droit de mentir ?',
  subject: 'Le mensonge',
};

export const isCenter = (n: Pick<MapNode, 'kind' | 'highlightId'> | undefined | null): boolean =>
  !!n && !n.highlightId && (n.kind === 'question' || n.kind === 'subject');

/** Premier centre de la carte (ordre des cartes). */
export function mapCenter(map: Pick<ArgumentMap, 'nodes'>): MapNode | null {
  return map.nodes.find(isCenter) ?? null;
}

/** Relation naturelle d'une carte vers un centre : une thèse « répond à » la problématique, une idée « se rattache à » un sujet. */
export const centerRelation = (kind: CenterKind): RelationId => (kind === 'question' ? 'repond' : 'rattache');

/** Relation par défaut d'un lien tracé à la main : neutre, elle n'affirme rien. */
export const NEUTRAL_RELATION: RelationId = 'lien';

/**
 * Relation d'un nouveau lien tracé à la main (glisser depuis une carte, vers une autre carte ou dans
 * le vide), quelle que soit la carte de départ ou d'arrivée — centre compris : toujours neutre.
 * Le lien va de la carte de départ (source) à la carte atteinte ou créée (cible).
 */
export const newLinkRelation = (): RelationId => NEUTRAL_RELATION;

/**
 * Relation d'une carte créée comme « enfant » de `targetId` par une commande explicite (Tab : « une
 * thèse qui répond à la problématique ») : celle du centre, sinon null (relation ordinaire). Ne sert
 * plus pour les liens tracés à la main (voir newLinkRelation).
 */
export function relationToward(map: Pick<ArgumentMap, 'nodes'>, targetId: string): RelationId | null {
  const t = map.nodes.find((n) => n.id === targetId);
  return t && isCenter(t) ? centerRelation(t.kind!) : null;
}

export interface AddCenterOpts {
  id?: IdFn;
  text?: string;
}

/** Pose un centre à la position `at` (coin haut-gauche). */
export function addCenter(map: ArgumentMap, kind: CenterKind, at: { x: number; y: number }, opts: AddCenterOpts = {}): { map: ArgumentMap; id: string } {
  const id = (opts.id ?? defaultId)();
  const node: MapNode = { id, highlightId: null, text: clean(opts.text ?? ''), x: Math.round(at.x), y: Math.round(at.y), kind };
  return { map: { ...map, nodes: [...map.nodes, node] }, id };
}

/**
 * Fait de la carte `nodeId` (une idée) le centre `kind`, ou la rend à l'état d'idée (`kind` null).
 * Les liens entrants suivent : « soutient » ↔ relation du centre (« répond à » / « se rattache à ») ;
 * les liens neutres (« lien ») et les autres relations restent tels quels.
 * Un extrait ne devient pas un centre (le centre est la question ou le thème de l'utilisateur).
 */
export function setNodeCenter(map: ArgumentMap, nodeId: string, kind: CenterKind | null): ArgumentMap {
  const n = map.nodes.find((x) => x.id === nodeId);
  if (!n || n.highlightId) return map;
  const before = isCenter(n) ? centerRelation(n.kind!) : 'soutient';
  const after = kind ? centerRelation(kind) : 'soutient';
  const nodes = map.nodes.map((x) => {
    if (x.id !== nodeId) return x;
    const { kind: _k, color: _c, ...rest } = x;
    return kind ? { ...rest, kind } : rest;
  });
  const swap = new Set<RelationId>(['soutient', 'repond', 'rattache']);
  const edges =
    before === after
      ? map.edges
      : map.edges.map((e) => (e.target === nodeId && swap.has(e.relation) && e.relation === before ? { ...e, relation: after } : e));
  return { ...map, nodes, edges, ...(map.centralId === nodeId ? { centralId: undefined } : {}) };
}

/** Racine des rangements et des replis : le centre de la carte, sinon la thèse centrale. */
export function layoutRootId(map: Pick<ArgumentMap, 'nodes'>, centralId: string | null): string | null {
  return mapCenter(map)?.id ?? centralId;
}
