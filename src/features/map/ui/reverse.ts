// « Inverser le sens » d'un lien : la source devient la cible et inversement.
// (Version locale de l'interface ; le modèle peut en fournir une équivalente — voir model/actions.ts.)
import type { ArgumentMap } from '../../../lib/types';

/**
 * Inverse le lien `edgeId` dans `m`. Un lien inversé change de cible : il quitte son
 * faisceau de co-prémisses (groupId remis à null). Un doublon de sens contraire déjà
 * présent rend l'opération sans effet.
 */
export function reverseEdgeIn(m: ArgumentMap, edgeId: string): ArgumentMap {
  const e = m.edges.find((x) => x.id === edgeId);
  if (!e) return m;
  if (m.edges.some((x) => x.id !== e.id && x.source === e.target && x.target === e.source)) return m;
  return { ...m, edges: m.edges.map((x) => (x.id === edgeId ? { ...x, source: x.target, target: x.source, groupId: null } : x)) };
}
