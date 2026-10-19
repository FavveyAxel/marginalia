// ─────────────────────────────────────────────────────────────
// Travailler à plusieurs : mémoire de la dernière session de chaque espace partagé, pour la réunion.
//
// À la fin d'une session, chacun garde (dans sa bibliothèque, dossier « collab », chiffré comme le reste
// si le chiffrement est actif) : l'état commun des éléments de l'espace (gids, comme sur le réseau), le
// texte des écrits paragraphe par paragraphe, les alias de livres, et l'heure de dernière modification
// de chaque élément. Ensuite, tant que l'espace existe, un observateur note l'heure de chaque
// modification faite ici (pour « la dernière gagne » sur les positions). Rien ne part sur le réseau.
// ─────────────────────────────────────────────────────────────
import { host } from '../../lib/platform';
import { useStore } from '../../lib/store';
import { docxTexts } from './docxMerge';
import { RecordSync } from './records';

const OWNER = 'collab';
const INDEX = 'index.json';
const fileOf = (shareId: string) => `memoire-${shareId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100)}.json`;

export interface Memory {
  v: 1;
  shareId: string;
  workspaceId: string;
  endedAt: number;
  /** Prénom de l'hôte de la dernière session (chez un invité), ou null. */
  peer: string | null;
  /** Clé col:gid → enregistrement (JSON, gids) à la fin de la session. */
  records: Record<string, string>;
  aliases: [string, string][];
  privateKeys: string[];
  /** gid d'écrit → textes de ses paragraphes à la fin de la session. */
  drafts: Record<string, string[]>;
  /** Clé → dernière modification connue (ms). */
  mtimes: Record<string, number>;
}

const dec = new TextDecoder();
const enc = new TextEncoder();

async function readJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(dec.decode(await host.readFile(OWNER, name))) as T;
  } catch {
    return null;
  }
}
async function writeJson(name: string, v: unknown) {
  await host.storeFile(OWNER, name, enc.encode(JSON.stringify(v)).buffer as ArrayBuffer);
}

export async function loadMemory(shareId: string): Promise<Memory | null> {
  const m = await readJson<Memory>(fileOf(shareId));
  return m && m.v === 1 && m.shareId === shareId ? m : null;
}
async function saveMemory(m: Memory) {
  await writeJson(fileOf(m.shareId), m);
  const idx = (await readJson<string[]>(INDEX)) ?? [];
  if (!idx.includes(m.shareId)) await writeJson(INDEX, [...idx, m.shareId]);
}

// ── Observateurs (hors session) ──
const watchers = new Map<string, { rs: RecordSync; mem: Memory; timer: ReturnType<typeof setTimeout> | null }>();

function startWatch(mem: Memory) {
  stopWatch(mem.shareId);
  if (!useStore.getState().workspaces.some((w) => w.id === mem.workspaceId)) return;
  const w = { rs: null as unknown as RecordSync, mem, timer: null as ReturnType<typeof setTimeout> | null };
  w.rs = new RecordSync({
    workspaceId: mem.workspaceId,
    shareId: mem.shareId,
    me: 'ici',
    send: (recs) => {
      const now = Date.now();
      for (const r of recs) w.mem.mtimes[`${r.c}:${r.g}`] = now;
      if (!w.timer)
        w.timer = setTimeout(() => {
          w.timer = null;
          void saveMemory(w.mem).catch((e) => console.warn('collab : mémoire', e));
        }, 1500);
    },
    fetch: () => {},
  });
  for (const [g, l] of mem.aliases) w.rs.addAlias('book', g, l);
  for (const k of mem.privateKeys) w.rs.privateKeys.add(k);
  w.rs.start();
  watchers.set(mem.shareId, w);
}
export function stopWatch(shareId: string) {
  const w = watchers.get(shareId);
  if (!w) return;
  w.rs.stop();
  if (w.timer) {
    clearTimeout(w.timer);
    void saveMemory(w.mem).catch(() => undefined);
  }
  watchers.delete(shareId);
}

let started = false;
/** Au lancement : un observateur par espace partagé dont on garde la mémoire. */
export async function initMemory() {
  if (started || !host.collabNet) return;
  started = true;
  for (const id of (await readJson<string[]>(INDEX)) ?? []) {
    const m = await loadMemory(id);
    if (m) startWatch(m);
  }
}

/** Heures de dernière modification connues (mémoire + observateur) d'un espace partagé. */
export async function knownMtimes(shareId: string): Promise<Record<string, number>> {
  const w = watchers.get(shareId);
  if (w) return { ...w.mem.mtimes };
  return (await loadMemory(shareId))?.mtimes ?? {};
}

/** Fin de session : l'état commun est gardé, l'observateur reprend. */
export async function rememberSession(shareId: string, workspaceId: string | null, records: RecordSync | null, peer: string | null): Promise<void> {
  if (!records || !workspaceId || !shareId) return;
  const prev = await loadMemory(shareId);
  const snap = records.snapshot();
  const drafts: Record<string, string[]> = {};
  const st = useStore.getState();
  for (const v of snap.values()) {
    if (v.c !== 'draft') continue;
    const d = st.drafts.find((x) => x.id === v.id);
    if (!d) continue;
    try {
      drafts[v.g] = await docxTexts(await host.readFile(d.id, d.fileName));
    } catch (e) {
      console.warn('collab : texte de base', e);
    }
  }
  const mem: Memory = {
    v: 1,
    shareId,
    workspaceId,
    endedAt: Date.now(),
    peer,
    records: Object.fromEntries([...snap].map(([k, v]) => [k, v.json])),
    aliases: [...records.aliasToLocal].filter(([k]) => k.startsWith('book:')).map(([k, l]) => [k.slice(5), l]),
    privateKeys: [...records.privateKeys],
    drafts,
    mtimes: { ...(prev?.mtimes ?? {}), ...Object.fromEntries(records.mtimes) },
  };
  await saveMemory(mem);
  startWatch(mem);
}
