// ─────────────────────────────────────────────────────────────
// Versions (instantanés) d'une carte d'argument — partie pure (sans store).
// L'enregistrement dans `Database.mapVersions` est fait par actions.ts.
//
// Un instantané est une copie JSON légère de la carte : sans viewport, sans champs vides,
// coordonnées arrondies. Les instantanés automatiques (rangement automatique, conversion,
// suppression multiple, restauration) sont élagués : on garde les 20 derniers par carte ;
// les instantanés nommés (manuels) ne sont jamais élagués.
//
// API :
//   MAX_AUTO_VERSIONS                         = 20
//   lightMap(map)                             → ArgumentMap   copie allégée
//   makeVersion(map, mapKey, opts)            → MapVersion
//   pruneVersions(all, mapKey, keep?)         → MapVersion[]  élagage (cette carte seulement)
//   versionsOf(all, mapKey)                   → MapVersion[]  du plus récent au plus ancien
//   restoredMap(current, version)             → ArgumentMap   carte restaurée (garde viewport et clé)
//   versionSummary(v)                         → « 12 cartes, 9 liens, 2 zones »
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, MapVersion } from '../../../lib/types';
import { defaultId, type IdFn } from './core';

export const MAX_AUTO_VERSIONS = 20;

export const VERSION_REASON_LABEL: Record<MapVersion['reason'], string> = {
  manual: 'Version enregistrée',
  layout: 'Avant le rangement automatique',
  convert: 'Avant la conversion',
  'delete-many': 'Avant une suppression multiple',
  restore: 'Avant la restauration d’une version',
};

/** Copie JSON (les champs undefined disparaissent). */
const strip = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

export function lightMap(map: ArgumentMap): ArgumentMap {
  const m = strip({ ...map, viewport: null });
  m.nodes = m.nodes.map((n) => ({ ...n, x: Math.round(n.x), y: Math.round(n.y) }));
  for (const n of m.nodes) if (!n.collapsed) delete n.collapsed;
  for (const e of m.edges) if (!e.note) delete e.note;
  if (m.zones && !m.zones.length) delete m.zones;
  return m;
}

export interface MakeVersionOpts {
  reason?: MapVersion['reason'];
  name?: string | null;
  now?: number;
  id?: IdFn;
}

export function makeVersion(map: ArgumentMap, mapKey: string, opts: MakeVersionOpts = {}): MapVersion {
  const name = opts.name?.trim() || null;
  return {
    id: (opts.id ?? defaultId)(),
    mapKey,
    createdAt: opts.now ?? Date.now(),
    name,
    reason: opts.reason ?? 'manual',
    map: lightMap(map),
  };
}

/** Garde, pour `mapKey`, les `keep` instantanés non nommés les plus récents + tous les nommés. */
export function pruneVersions(all: MapVersion[], mapKey: string, keep = MAX_AUTO_VERSIONS): MapVersion[] {
  const auto = all.filter((v) => v.mapKey === mapKey && !v.name).sort((a, b) => b.createdAt - a.createdAt);
  const drop = new Set(auto.slice(keep).map((v) => v.id));
  return drop.size ? all.filter((v) => !drop.has(v.id)) : all;
}

export const versionsOf = (all: MapVersion[] | undefined, mapKey: string): MapVersion[] =>
  (all ?? []).filter((v) => v.mapKey === mapKey).sort((a, b) => b.createdAt - a.createdAt);

/** Carte restaurée : le contenu de la version, la vue et l'identité de la carte actuelle. */
export function restoredMap(current: ArgumentMap, v: MapVersion): ArgumentMap {
  const snap: ArgumentMap = JSON.parse(JSON.stringify(v.map));
  return {
    ...snap,
    bookId: current.bookId,
    ...(current.id ? { id: current.id } : {}),
    ...(current.kind ? { kind: current.kind } : {}),
    viewport: current.viewport,
    ...(current.createdAt ? { createdAt: current.createdAt } : {}),
  };
}

export function versionSummary(v: MapVersion): string {
  const p = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  const bits = [p(v.map.nodes.length, 'carte', 'cartes'), p(v.map.edges.length, 'lien', 'liens')];
  if (v.map.zones?.length) bits.push(p(v.map.zones.length, 'zone', 'zones'));
  return bits.join(', ');
}
