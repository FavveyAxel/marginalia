// Historique de versions d'un écrit.
//
// Chaque version est une copie .docx rangée dans le dossier de l'écrit
// (bibliothèque : <draftId>/versions/<horodatage>-<id>.docx) ; ses métadonnées
// (date, nom, nombre de mots, empreinte du texte) vivent dans Draft.versions.
// Ce champ est ignoré par le journal et ⌘Z (history/engine.ts) ; il part à la corbeille
// avec l'écrit, et ses fichiers sont effacés avec lui au vidage (store.ts, filesOf).
//
// Instantanés automatiques : ~10 min d'écriture active, fermeture de l'écrit, avant une
// restauration, avant « Tout remplacer » (voir snapshotActiveDraft). Instantanés manuels
// nommés : « Créer une version… » (⌘⌥S).
//
// Élagage : toutes les versions nommées ; les automatiques des dernières 24 h ; au-delà,
// une par jour (la plus récente) sur 30 jours ; rien d'automatique après 30 jours.
import { diffWordsWithSpace, type Change } from 'diff';
import { host } from '../../lib/platform';
import { uid, useStore } from '../../lib/store';
import type { Draft, DraftVersion } from '../../lib/types';
export type { DraftVersion };
import { parseDocx, type Block, type DocModel } from './docx';

export const VERSIONS_DIR = 'versions';
/** Écriture active cumulée avant un instantané automatique. */
export const AUTO_ACTIVE_MS = 10 * 60_000;
const DAY = 86_400_000;
const KEEP_ALL_MS = DAY;
const KEEP_DAILY_DAYS = 30;

// ── Texte d'un document ──────────────────────────────────────
function blockText(b: Block): string {
  let s = '';
  for (const i of b.inlines) {
    if (i.t === 'text') s += i.text;
    else if (i.t === 'br') s += '\n';
  }
  return s;
}

/** Texte brut d'un modèle : un paragraphe par ligne (notes de bas de page exclues). */
export function modelText(m: DocModel): string {
  return m.blocks.map(blockText).join('\n');
}

export interface VersionContent {
  model: DocModel;
  text: string;
}

export async function readContent(data: ArrayBuffer): Promise<VersionContent> {
  const model = await parseDocx(data);
  return { model, text: modelText(model) };
}

/** Empreinte courte (FNV-1a 32 bits + longueur). */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + '.' + s.length.toString(36);
}

// ── Lecture / écriture ───────────────────────────────────────
export function versionsOf(draftId: string): DraftVersion[] {
  return useStore.getState().drafts.find((d) => d.id === draftId)?.versions ?? [];
}

function setVersions(draftId: string, list: DraftVersion[]) {
  const s = useStore.getState();
  if (!s.drafts.some((d) => d.id === draftId)) return;
  s.patch('drafts', draftId, { versions: list });
}

export function readVersion(draftId: string, v: DraftVersion): Promise<ArrayBuffer> {
  return host.readFile(draftId, v.fileName);
}

export interface CreateOptions {
  kind: DraftVersion['kind'];
  name?: string | null;
  /** Créer même si le texte est identique à la dernière version (versions nommées). */
  force?: boolean;
}

/**
 * Enregistre `data` comme nouvelle version de l'écrit. Renvoie null si le texte n'a pas
 * changé depuis la dernière version (et que la version n'est pas nommée).
 */
export async function addVersion(draftId: string, data: ArrayBuffer, opts: CreateOptions): Promise<DraftVersion | null> {
  const { model, text } = await readContent(data);
  const hash = hashText(text);
  const list = versionsOf(draftId);
  const last = list[list.length - 1];
  const name = opts.name?.trim() || null;
  if (!name && !opts.force && last && last.hash === hash) return null;
  const now = Math.max(Date.now(), (last?.createdAt ?? 0) + 1);
  const id = uid();
  const v: DraftVersion = {
    id,
    fileName: `${VERSIONS_DIR}/${now}-${id}.docx`,
    createdAt: now,
    name,
    kind: name ? (opts.kind === 'auto' ? 'manual' : opts.kind) : opts.kind,
    wordCount: model.bodyWords,
    hash,
  };
  await host.storeFile(draftId, v.fileName, data);
  setVersions(draftId, [...versionsOf(draftId), v]);
  await pruneVersions(draftId);
  return v;
}

/** Version du fichier enregistré dans la bibliothèque (document.docx). */
export async function addVersionFromLibrary(draftId: string, opts: CreateOptions): Promise<DraftVersion | null> {
  const d = useStore.getState().drafts.find((x) => x.id === draftId);
  if (!d) return null;
  const data = await host.readFile(d.id, d.fileName);
  return addVersion(draftId, data, opts);
}

/** Versions à garder (élagage) ; l'ordre est conservé. */
export function prunePlan(list: DraftVersion[], now = Date.now()): { keep: DraftVersion[]; drop: DraftVersion[] } {
  const keepIds = new Set<string>();
  const dayBest = new Map<string, DraftVersion>();
  for (const v of list) {
    if (v.name) keepIds.add(v.id);
    else if (now - v.createdAt < KEEP_ALL_MS) keepIds.add(v.id);
    else if (now - v.createdAt < KEEP_DAILY_DAYS * DAY) {
      const d = new Date(v.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const cur = dayBest.get(key);
      if (!cur || v.createdAt > cur.createdAt) dayBest.set(key, v);
    }
  }
  for (const v of dayBest.values()) keepIds.add(v.id);
  return { keep: list.filter((v) => keepIds.has(v.id)), drop: list.filter((v) => !keepIds.has(v.id)) };
}

export async function pruneVersions(draftId: string, now = Date.now()): Promise<number> {
  const { keep, drop } = prunePlan(versionsOf(draftId), now);
  if (!drop.length) return 0;
  // Métadonnées d'abord : au pire un fichier orphelin, jamais une version sans fichier.
  setVersions(draftId, keep);
  for (const v of drop) await host.deleteFile(draftId, v.fileName).catch((e) => console.warn('version', e));
  return drop.length;
}

export async function deleteVersion(draftId: string, versionId: string): Promise<void> {
  const list = versionsOf(draftId);
  const v = list.find((x) => x.id === versionId);
  if (!v) return;
  setVersions(draftId, list.filter((x) => x.id !== versionId));
  await host.deleteFile(draftId, v.fileName).catch((e) => console.warn('version', e));
}

export function renameVersion(draftId: string, versionId: string, name: string): void {
  const n = name.trim() || null;
  setVersions(
    draftId,
    versionsOf(draftId).map((v) => (v.id === versionId ? { ...v, name: n, kind: n && v.kind === 'auto' ? 'manual' : v.kind } : v)),
  );
}

// ── Écriture active (instantanés automatiques) ───────────────
/** Cumule le temps d'écriture : deux modifications à moins d'une minute d'écart = temps actif. */
export class ActiveClock {
  activeMs = 0;
  private lastAt = 0;
  touch(now = Date.now()) {
    const gap = this.lastAt ? now - this.lastAt : Infinity;
    this.activeMs += gap < 60_000 ? gap : 5_000;
    this.lastAt = now;
  }
  get due() {
    return this.activeMs >= AUTO_ACTIVE_MS;
  }
  get dirty() {
    return this.activeMs > 0;
  }
  reset() {
    this.activeMs = 0;
  }
}

// ── Instantané de l'écrit ouvert (pour « Tout remplacer » et autres opérations en masse) ──
type Snapshotter = (kind: DraftVersion['kind'], name?: string | null) => Promise<DraftVersion | null>;
let active: Snapshotter | null = null;

/** L'éditeur ouvert s'enregistre ici (une seule instance à la fois). */
export function registerSnapshotter(fn: Snapshotter): () => void {
  active = fn;
  return () => {
    if (active === fn) active = null;
  };
}

/**
 * Crée une version de l'écrit ouvert avant une opération en masse.
 * À appeler (et attendre) avant « Tout remplacer » : `await snapshotActiveDraft('replace')`.
 */
export async function snapshotActiveDraft(kind: DraftVersion['kind'] = 'replace', name?: string | null): Promise<DraftVersion | null> {
  if (!active) return null;
  try {
    return await active(kind, name);
  } catch (e) {
    console.warn('instantané', e);
    return null;
  }
}

// ── Présentation ─────────────────────────────────────────────
export const KIND_LABEL: Record<DraftVersion['kind'], string> = {
  auto: 'Automatique',
  close: 'À la fermeture',
  restore: 'Avant une restauration',
  replace: 'Avant « Tout remplacer »',
  manual: 'Version nommée',
};

export function versionTitle(v: DraftVersion): string {
  return v.name ?? KIND_LABEL[v.kind];
}

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dayYearFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

export const fmtTime = (t: number) => timeFmt.format(t);

/** « Aujourd’hui », « Hier », « lundi 12 octobre », « 3 mars 2025 ». */
export function dayLabel(t: number, now = Date.now()): string {
  const a = new Date(t);
  const b = new Date(now);
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(b) - start(a)) / DAY);
  if (days === 0) return 'Aujourd’hui';
  if (days === 1) return 'Hier';
  const s = a.getFullYear() === b.getFullYear() ? dayFmt.format(a) : dayYearFmt.format(a);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** « 14 oct. à 15:32 » (nom proposé pour une version manuelle). */
export function defaultVersionName(t = Date.now()): string {
  return `Version du ${shortFmt.format(t)} à ${timeFmt.format(t)}`;
}

export function fullDate(t: number): string {
  return `${dayLabel(t)} à ${timeFmt.format(t)}`;
}

// ── Différences ──────────────────────────────────────────────
export interface DiffResult {
  parts: Change[];
  added: number;
  removed: number;
}

const wordsIn = (s: string) => (s.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;

/** Différences mot à mot de `before` (version) à `after` (état actuel) ; null si trop long à calculer. */
export function computeDiff(before: string, after: string): DiffResult | null {
  const parts = diffWordsWithSpace(before, after, { timeout: 4000 });
  if (!parts) return null;
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    if (p.added) added += wordsIn(p.value);
    else if (p.removed) removed += wordsIn(p.value);
  }
  return { parts, added, removed };
}

/** Titre d'un écrit restauré comme nouvel écrit. */
export function restoredTitle(d: Draft, v: DraftVersion): string {
  return `${d.title} (${v.name ? v.name : 'version du ' + shortFmt.format(v.createdAt) + ' à ' + timeFmt.format(v.createdAt)})`;
}
