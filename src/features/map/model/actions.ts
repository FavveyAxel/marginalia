// ─────────────────────────────────────────────────────────────
// Actions de carte branchées sur le store (sans interface).
//
// Toutes les modifications passent par store.setMap / insert / trashDelete : elles sont donc
// journalisées et annulables (⌘Z) comme le reste ; les cartes libres et les cartes de mouvement
// supprimées vont à la corbeille (kind 'map', restaurables). Les versions (instantanés) sont
// rangées dans `mapVersions`, hors du journal et de ⌘Z.
//
// `key` désigne une carte dans `maps` : bookId pour une carte de livre, `id` sinon
// (voir mapKeyOf). Une carte de livre absente est créée vide à la première écriture.
//
// API (toutes synchrones sauf mention) :
//   Lecture
//     lookup()                               → MapLookup (extraits, livres, fiches du store)
//     readMap(key)                           → ArgumentMap
//     updateMap(key, fn)                     → ArgumentMap  écrit fn(carte) si elle a changé (updatedAt)
//   12. Zones
//     addZone(key, nodeIds, opts?)           → zoneId
//     moveZoneBy(key, zoneId, dx, dy, sizes?) ; resizeZoneTo(key, zoneId, rect)
//     setZoneCollapsed(key, zoneId, collapsed, sizes?) ; editZone(key, zoneId, {title?, color?})
//     deleteZone(key, zoneId)                (retire le cadre, les cartes restent ; ⌘Z)
//   13. Cartes libres multi-livres
//     createBoard(title, bookIds?)           → key
//     renameMap(key, title)
//     deleteMap(key) / deleteMaps(keys)      → corbeille (cartes libres et de mouvement uniquement)
//     restoreMap(trashEntryId)               → RestoreResult
//     boards()                               → ArgumentMap[] ; trashedMaps() → TrashEntry[]
//     placeHighlights(key, highlightIds)     → nodeIds   (extraits de n'importe quel livre)
//     copyNodesInto(key, sourceKey, nodeIds) → nodeIds   (copie + liens entre elles, sans chevauchement)
//     addIdeas(key, texts) / addConcepts(key, conceptIds) → nodeIds
//     createBoardIn(workspaceId, groupId, title?) → key  (créée, rangée dans l'espace / le groupe)
//     boardTitle(key)                        → titre affiché
//   14. guidedReadingOf(key)                 → GuidedStep[]
//   15. gapsOf(key)                          → { gaps, messages }
//   16. convertToPlan(key, title?)           → planId          (instantané « convert » avant)
//       convertToDraft(key, title?)          → Promise<draftId> (createDraft ; instantané avant)
//   17. movementMaps(studyId)                → { movement, index, title, key }[]
//       openMovementMap(studyId, movementId) → key  (crée la carte si besoin, idempotent)
//       linkMapToMovement(key, studyId, movementId | null)
//       candidatesOf(key)                    → Highlight[]  extraits catégorisés du mouvement non placés
//   18. exportSvg(key, opts?)                → SvgResult
//       exportPng(key, scale = 2)            → Promise<ArrayBuffer>
//       exportPdf(key)                       → Promise<ArrayBuffer>  (host.printToPdf : app de bureau)
//       saveMapPdf(key)                      → Promise<string | null> (boîte « Enregistrer », journal)
//       (insertion dans un écrit : htmlToDocx ne gère pas encore les images → utiliser le PNG.)
//   19. versions(key)                        → MapVersion[] (récent d'abord)
//       saveVersion(key, name)               → MapVersion   (nommée : jamais élaguée)
//       autoSnapshot(key, reason)            → MapVersion | null (rien si identique à la dernière)
//       beforeAutoLayout(key)                → instantané « layout » + étape d'annulation séparée
//       deleteNodes(key, nodeIds)            → retire cartes + liens (instantané si ≥ 2)
//       restoreVersion(versionId)            → boolean  (instantané « restore » avant, ⌘Z, toast Annuler)
//       renameVersion(versionId, name) ; deleteVersion(versionId)
//   20. setEdgeNoteOf(key, edgeId, note)
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, Highlight, MapVersion, MapZone, TrashEntry } from '../../../lib/types';
import { host } from '../../../lib/platform';
import { separateUndoStep, uid, useStore, type RestoreResult } from '../../../lib/store';
import { createDraft } from '../../editor/api';
import { sortMovements } from '../../study/studyUtils';
import { addHighlightNodes, isBoard, listBoards, newBoard, setEdgeNote, touch } from './boards';
import { conceptNode, copyIntoMap, ideaNode, placeNewNodes } from './copy';
import { mapToDraftHtml, mapDisplayTitle, mapToPlan } from './convert';
import { mapKindOf, type MapLookup } from './core';
import { gapMessages, mapGaps, type GapMessage, type MapGaps } from './gaps';
import type { Rect, SizeMap } from './geometry';
import { guidedReading, type GuidedStep } from './guided';
import { svgToPdf, svgToPng } from './image';
import { findMovementMap, movementCandidates, movementMapKey, movementRange, movementTitle } from './movements';
import { mapToSvg, type SvgOpts, type SvgResult } from './svg';
import { PORTAL_KIND_LABEL, portalTarget } from './portals';
import { lightMap, makeVersion, pruneVersions, restoredMap, versionsOf } from './versions';
import { collapseZone, createZoneAround, expandZone, moveZone, removeZone, resizeZone, updateZone, type CreateZoneOpts } from './zones';

const S = () => useStore.getState();

export function lookup(): MapLookup {
  const s = S();
  return { highlights: s.highlights, books: s.books, studies: s.studies };
}

export function readMap(key: string): ArgumentMap {
  return S().maps[key] ?? S().getMap(key);
}

export function updateMap(key: string, fn: (m: ArgumentMap) => ArgumentMap): ArgumentMap {
  const cur = readMap(key);
  const next = fn(cur);
  if (next === cur) return cur;
  const out = touch(next);
  S().setMap(key, out);
  return out;
}

// ── 12. Zones ────────────────────────────────────────────────
export function addZone(key: string, nodeIds: string[], opts: Omit<CreateZoneOpts, 'lookup' | 'id'> = {}): string {
  let id = '';
  updateMap(key, (m) => {
    const r = createZoneAround(m, nodeIds, { ...opts, lookup: lookup(), id: uid });
    id = r.zone.id;
    return r.map;
  });
  return id;
}
export const moveZoneBy = (key: string, zoneId: string, dx: number, dy: number, sizes?: SizeMap) =>
  updateMap(key, (m) => moveZone(m, zoneId, dx, dy, lookup(), sizes));
export const resizeZoneTo = (key: string, zoneId: string, r: Partial<Rect>) => updateMap(key, (m) => resizeZone(m, zoneId, r));
export const setZoneCollapsed = (key: string, zoneId: string, collapsed: boolean, sizes?: SizeMap) =>
  updateMap(key, (m) => (collapsed ? collapseZone(m, zoneId, lookup(), sizes) : expandZone(m, zoneId)));
export const editZone = (key: string, zoneId: string, patch: Partial<Pick<MapZone, 'title' | 'color'>>) => updateMap(key, (m) => updateZone(m, zoneId, patch));
export const deleteZone = (key: string, zoneId: string) => updateMap(key, (m) => removeZone(m, zoneId));

// ── 13. Cartes libres ────────────────────────────────────────
export function createBoard(title: string, bookIds: string[] = []): string {
  const b = newBoard(title, { bookIds, id: uid });
  S().setMap(b.id!, b);
  return b.id!;
}

export function renameMap(key: string, title: string): void {
  const t = title.trim();
  if (!t) return;
  updateMap(key, (m) => (m.title === t ? m : { ...m, title: t }));
}

const deletable = (key: string) => {
  const m = S().maps[key];
  return !!m && mapKindOf(m) !== 'book';
};

/** Carte libre ou de mouvement → corbeille (une carte de livre part avec son livre). */
export function deleteMap(key: string): TrashEntry | null {
  if (!deletable(key)) return null;
  return S().trashDelete('map', key);
}
export function deleteMaps(keys: string[]): TrashEntry[] {
  const ok = keys.filter(deletable);
  return ok.length ? S().trashDeleteMany('map', ok) : [];
}
export const restoreMap = (trashEntryId: string): RestoreResult => S().restoreFromTrash(trashEntryId);
export const boards = (): ArgumentMap[] => listBoards(S().maps);
export const trashedMaps = (): TrashEntry[] => S().trash.filter((t) => t.kind === 'map');

export function placeHighlights(key: string, highlightIds: string[]): string[] {
  separateUndoStep(); // un clic « Ajouter » = une étape d'annulation
  const all = new Map(S().highlights.map((h) => [h.id, h]));
  const hls = highlightIds.map((id) => all.get(id)).filter(Boolean) as Highlight[];
  let ids: string[] = [];
  updateMap(key, (m) => {
    const r = addHighlightNodes(m, hls, { id: uid });
    ids = r.nodeIds;
    return r.map;
  });
  return ids;
}

/** Copie des cartes (et leurs liens internes) d'une autre carte. Une seule étape d'annulation. */
export function copyNodesInto(key: string, sourceKey: string, nodeIds: string[]): string[] {
  const src = S().maps[sourceKey];
  if (!src || sourceKey === key || !nodeIds.length) return [];
  separateUndoStep();
  let ids: string[] = [];
  updateMap(key, (m) => {
    const r = copyIntoMap(m, src, nodeIds, { id: uid, sourceKey, lookup: lookup() });
    ids = r.nodeIds;
    return r.map;
  });
  return ids;
}

export function addIdeas(key: string, texts: string[]): string[] {
  const list = texts.map((t) => t.trim()).filter(Boolean);
  if (!list.length) return [];
  separateUndoStep();
  let ids: string[] = [];
  updateMap(key, (m) => {
    const nodes = placeNewNodes(m, list.map((t) => ideaNode(t, { x: 0, y: 0 }, uid)), lookup());
    ids = nodes.map((n) => n.id);
    return { ...m, nodes: [...m.nodes, ...nodes] };
  });
  return ids;
}

/** Concepts posés comme cartes (un concept déjà présent n'est pas dupliqué). */
export function addConcepts(key: string, conceptIds: string[]): string[] {
  separateUndoStep();
  let ids: string[] = [];
  updateMap(key, (m) => {
    const have = new Set(m.nodes.map((n) => n.conceptId).filter(Boolean));
    const cs = S().concepts.filter((c) => conceptIds.includes(c.id) && !have.has(c.id));
    if (!cs.length) return m;
    const nodes = placeNewNodes(m, cs.map((c) => conceptNode(c, { x: 0, y: 0 }, uid)), lookup());
    ids = nodes.map((n) => n.id);
    return { ...m, nodes: [...m.nodes, ...nodes] };
  });
  return ids;
}

/** Nouvelle carte libre rangée dans un espace (et un groupe) : une seule étape d'annulation. */
export function createBoardIn(workspaceId: string, groupId: string | null, title = 'Nouvelle carte'): string {
  separateUndoStep();
  const key = createBoard(title);
  S().addToWorkspace(workspaceId, groupId, 'map', key);
  return key;
}

export function boardTitle(key: string): string {
  const m = S().maps[key];
  return m ? mapDisplayTitle(m, lookup()) : 'Carte';
}

// ── 14 / 15. Lecture guidée, signaux ─────────────────────────
export const guidedReadingOf = (key: string): GuidedStep[] => guidedReading(readMap(key), lookup());
export function gapsOf(key: string): { gaps: MapGaps; messages: GapMessage[] } {
  const gaps = mapGaps(readMap(key), lookup());
  return { gaps, messages: gapMessages(gaps) };
}

// ── 16. Conversions ──────────────────────────────────────────
export function convertToPlan(key: string, title?: string): string {
  autoSnapshot(key, 'convert');
  const plan = mapToPlan(readMap(key), lookup(), { id: uid, title });
  S().insert('plans', plan);
  return plan.id;
}

export async function convertToDraft(key: string, title?: string): Promise<string> {
  autoSnapshot(key, 'convert');
  const { title: t, html } = mapToDraftHtml(readMap(key), lookup(), { title });
  const d = await createDraft({ title: t, html });
  return d.id;
}

// ── 17. Cartes de mouvement ──────────────────────────────────
export function movementMaps(studyId: string): { movementId: string; index: number; title: string; key: string | null }[] {
  const st = S().studies.find((x) => x.id === studyId);
  if (!st) return [];
  return sortMovements(st.movements).map((mv, index) => {
    const m = findMovementMap(S().maps, studyId, mv.id);
    return { movementId: mv.id, index, title: movementTitle(st, mv.id), key: m ? (m.id ?? movementMapKey(studyId, mv.id)) : null };
  });
}

/** Carte du mouvement (créée vide si besoin). Renvoie sa clé, ou null si la fiche / le mouvement n'existe pas. */
export function openMovementMap(studyId: string, movementId: string): string | null {
  const st = S().studies.find((x) => x.id === studyId);
  if (!st || !movementRange(st, movementId)) return null;
  const found = findMovementMap(S().maps, studyId, movementId);
  if (found) return found.id ?? movementMapKey(studyId, movementId);
  const key = movementMapKey(studyId, movementId);
  const now = Date.now();
  S().setMap(key, {
    id: key,
    kind: 'movement',
    bookId: st.bookId,
    studyId,
    movementId,
    title: movementTitle(st, movementId),
    nodes: [],
    edges: [],
    zones: [],
    viewport: null,
    createdAt: now,
    updatedAt: now,
  });
  return key;
}

/** Relie (ou délie : movementId null) une carte libre ou de mouvement à un mouvement de fiche-texte. */
export function linkMapToMovement(key: string, studyId: string, movementId: string | null): boolean {
  const m = S().maps[key];
  if (!m || mapKindOf(m) === 'book') return false;
  if (!movementId) {
    updateMap(key, ({ studyId: _s, movementId: _m, ...rest }) => ({ ...rest, kind: 'board', bookIds: [...new Set([...(rest.bookIds ?? []), ...(rest.bookId ? [rest.bookId] : [])])], bookId: '' }));
    return true;
  }
  const st = S().studies.find((x) => x.id === studyId);
  if (!st || !movementRange(st, movementId)) return false;
  updateMap(key, (x) => ({ ...x, kind: 'movement', bookId: st.bookId, studyId, movementId, title: x.title || movementTitle(st, movementId) }));
  return true;
}

export function candidatesOf(key: string): Highlight[] {
  const m = readMap(key);
  const st = m.studyId ? S().studies.find((x) => x.id === m.studyId) : null;
  return st ? movementCandidates(m, st, S().highlights) : [];
}

// ── 18. Exports ──────────────────────────────────────────────
export function exportSvg(key: string, opts: SvgOpts = {}): SvgResult {
  const m = readMap(key);
  const lk = lookup();
  const portalInfo = (k: string) => {
    const t = portalTarget(S().maps, k, lk);
    return t ? { title: t.title, kind: PORTAL_KIND_LABEL[t.kind] } : null;
  };
  return mapToSvg(m, lk, { title: mapDisplayTitle(m, lk), portalInfo, ...opts });
}
export async function exportPng(key: string, scale = 2, opts: SvgOpts = {}): Promise<ArrayBuffer> {
  const r = exportSvg(key, opts);
  return svgToPng(r.svg, r.width, r.height, scale);
}
export async function exportPdf(key: string, opts: SvgOpts = {}): Promise<ArrayBuffer> {
  const r = exportSvg(key, opts);
  return svgToPdf(r.svg, r.width, r.height, mapDisplayTitle(readMap(key), lookup()));
}
export async function saveMapPdf(key: string): Promise<string | null> {
  const title = mapDisplayTitle(readMap(key), lookup());
  const data = await exportPdf(key);
  const path = await host.saveBinary(`${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Carte'}.pdf`, data, 'pdf');
  if (path) S().logActivity({ action: 'export', kind: 'map', refId: key, title, bookId: readMap(key).bookId || null, summary: 'Carte exportée en PDF' });
  return path;
}

// ── 19. Versions ─────────────────────────────────────────────
const allVersions = () => S().mapVersions ?? [];
const writeVersions = (list: MapVersion[]) => useStore.setState({ mapVersions: list });

export const versions = (key: string): MapVersion[] => versionsOf(allVersions(), key);

function pushVersion(key: string, v: MapVersion): MapVersion {
  writeVersions(pruneVersions([v, ...allVersions()], key));
  return v;
}

export function saveVersion(key: string, name: string): MapVersion {
  return pushVersion(key, makeVersion(readMap(key), key, { name: name.trim() || 'Version sans nom', reason: 'manual', id: uid }));
}

export function autoSnapshot(key: string, reason: Exclude<MapVersion['reason'], 'manual'>): MapVersion | null {
  const m = readMap(key);
  if (!m.nodes.length && !m.edges.length && !m.zones?.length) return null;
  const light = lightMap(m);
  const last = versions(key)[0];
  const strip = (x: ArgumentMap) => JSON.stringify({ ...x, updatedAt: 0 });
  if (last && strip(last.map) === strip(light)) return null;
  return pushVersion(key, makeVersion(m, key, { reason, id: uid }));
}

export function beforeAutoLayout(key: string): MapVersion | null {
  const v = autoSnapshot(key, 'layout');
  separateUndoStep();
  return v;
}

export function deleteNodes(key: string, nodeIds: string[]): void {
  const ids = new Set(nodeIds);
  if (!ids.size) return;
  if (ids.size > 1) autoSnapshot(key, 'delete-many');
  updateMap(key, (m) => {
    if (!m.nodes.some((n) => ids.has(n.id))) return m;
    return {
      ...m,
      nodes: m.nodes.filter((n) => !ids.has(n.id)),
      edges: m.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
      ...(m.zones ? { zones: m.zones.map((z) => (z.hiddenNodeIds ? { ...z, hiddenNodeIds: z.hiddenNodeIds.filter((x) => !ids.has(x)) } : z)) } : {}),
      ...(m.centralId && ids.has(m.centralId) ? { centralId: undefined } : {}),
    };
  });
}

export function restoreVersion(versionId: string): boolean {
  const v = allVersions().find((x) => x.id === versionId);
  if (!v) return false;
  const before = S().maps[v.mapKey];
  if (!before && !isBookKey(v.mapKey)) {
    S().toast('Cette carte n’existe plus : restaurez-la d’abord depuis la corbeille', 'error');
    return false;
  }
  const cur = readMap(v.mapKey);
  autoSnapshot(v.mapKey, 'restore');
  separateUndoStep();
  const next = touch(restoredMap(cur, v));
  S().setMap(v.mapKey, next);
  separateUndoStep();
  const label = v.name ? `« ${v.name} »` : 'la version';
  S().toast(`Carte revenue à ${label}`, 'success', {
    label: 'Annuler',
    run: () => {
      if (S().maps[v.mapKey] === next) S().setMap(v.mapKey, cur);
      else S().toast('La carte a changé depuis : utilisez ⌘Z ou une autre version', 'info');
    },
  });
  return true;
}

const isBookKey = (key: string) => S().books.some((b) => b.id === key);

export function renameVersion(versionId: string, name: string): void {
  // Nommer une version la protège de l'élagage ; lui retirer son nom la rend de nouveau élagable.
  writeVersions(allVersions().map((v) => (v.id === versionId ? { ...v, name: name.trim() || null } : v)));
}
export function deleteVersion(versionId: string): void {
  writeVersions(allVersions().filter((v) => v.id !== versionId));
}

// ── 20. Notes sur les liens ──────────────────────────────────
export const setEdgeNoteOf = (key: string, edgeId: string, note: string) => updateMap(key, (m) => setEdgeNote(m, edgeId, note));

export { isBoard };
