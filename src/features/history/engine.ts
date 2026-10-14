// ─────────────────────────────────────────────────────────────
// Moteur commun du journal, de la corbeille et d'annuler / rétablir.
// Pur (aucun accès au store) : différences entre deux états, et
// application inverse « à trois voies » qui ne détruit pas ce que
// l'utilisateur a modifié entre-temps.
// ─────────────────────────────────────────────────────────────
import type { Database, ItemChange, TrackedCollection, TrashEntry } from '../../lib/types';

export const TRACKED: TrackedCollection[] = [
  'books',
  'highlights',
  'concepts',
  'maps',
  'arguments',
  'studies',
  'plans',
  'drafts',
  'cards',
  'workspaces',
  'groups',
  'wsItems',
  'bookmarks',
];

export type Data = Pick<Database, TrackedCollection>;
/** Données + corbeille : ce que l'annulation sait remettre en état. */
export type UndoData = Data & { trash: TrashEntry[] };
export type UndoCol = TrackedCollection | 'trash';

/**
 * Champs sans valeur « historique » : la position de lecture, l'état de révision FSRS,
 * le cadrage de la carte, le compteur de mots… Une modification qui ne touche qu'eux
 * n'est ni journalisée ni annulable (mais elle est conservée lors d'une annulation).
 */
const IGNORED: Partial<Record<UndoCol, string[]>> = {
  books: ['position', 'progress', 'lastOpenedAt'],
  maps: ['viewport'],
  cards: ['fsrs'],
  // versions : historique propre à l'écrit (fichiers sur disque), hors du journal et de ⌘Z.
  drafts: ['wordCount', 'versions'],
  groups: ['collapsed'],
};
const ALWAYS_IGNORED = ['updatedAt'];

export function ignoredFields(col: UndoCol): string[] {
  return [...ALWAYS_IGNORED, ...(IGNORED[col] ?? [])];
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    // NaN, undefined vs absent
    return a !== a && b !== b;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ka = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const kb = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

/** Égalité en ignorant les champs sans valeur historique. */
export function sameIgnoring(col: UndoCol, a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isObj(a) || !isObj(b)) return deepEqual(a, b);
  const ign = ignoredFields(col);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (ign.includes(k)) continue;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

/** Champs réellement modifiés entre deux versions d'un élément. */
export function changedFields(col: UndoCol, before: unknown, after: unknown): string[] {
  if (!isObj(before) || !isObj(after)) return [];
  const ign = ignoredFields(col);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => !ign.includes(k) && !deepEqual(before[k], after[k]));
}

type Row = { id: string };

/**
 * Différence élément par élément entre deux états.
 * `raw` : compte aussi les modifications des champs ignorés (corbeille : tout doit revenir).
 */
export function diffData(prev: Partial<UndoData>, next: Partial<UndoData>, cols: UndoCol[], raw = false): ItemChange[] {
  const out: ItemChange[] = [];
  for (const col of cols) {
    const a = (prev as any)[col];
    const b = (next as any)[col];
    if (a === b || a === undefined || b === undefined) continue;
    if (col === 'maps') {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        const x = a[k];
        const y = b[k];
        if (x === y) continue;
        if (x === undefined) out.push({ col, id: k, before: null, after: y });
        else if (y === undefined) out.push({ col, id: k, before: x, after: null });
        else if (raw ? !deepEqual(x, y) : !sameIgnoring(col, x, y)) out.push({ col, id: k, before: x, after: y });
      }
      continue;
    }
    const arrA = a as Row[];
    const arrB = b as Row[];
    const am = new Map(arrA.map((x) => [x.id, x]));
    const bm = new Map(arrB.map((x) => [x.id, x]));
    let prevKey: string | null = null;
    arrA.forEach((x, i) => {
      if (!bm.has(x.id)) out.push({ col, id: x.id, before: x, after: null, prevId: prevKey, index: i });
      prevKey = x.id;
    });
    prevKey = null;
    arrB.forEach((y, i) => {
      const x = am.get(y.id);
      if (!x) out.push({ col, id: y.id, before: null, after: y, prevId: prevKey, index: i });
      else if (x !== y && (raw ? !deepEqual(x, y) : !sameIgnoring(col, x, y))) out.push({ col, id: y.id, before: x, after: y });
      prevKey = y.id;
    });
  }
  return out;
}

/** Fusionne une suite de changements (même transaction) : premier « avant », dernier « après ». */
export function composeChanges(list: ItemChange[]): ItemChange[] {
  const m = new Map<string, ItemChange>();
  for (const c of list) {
    const k = c.col + '\u0000' + c.id;
    const cur = m.get(k);
    if (!cur) m.set(k, { ...c });
    else m.set(k, { ...cur, after: c.after });
  }
  return [...m.values()].filter((c) => !(c.before == null && c.after == null) && !deepEqual(c.before, c.after));
}

// ── Application inverse à trois voies ────────────────────────

function keyOf(arrays: unknown[][]): string | null {
  const all = arrays.flat();
  if (!all.length) return null;
  for (const key of ['id', 'conceptId']) {
    if (!all.every((x) => isObj(x) && typeof x[key] === 'string')) continue;
    if (arrays.every((arr) => new Set(arr.map((x) => (x as any)[key])).size === arr.length)) return key;
  }
  return null;
}
const isPrim = (x: unknown) => x === null || ['string', 'number', 'boolean'].includes(typeof x);

function insertAfterPredecessor<T>(out: T[], target: T[], i: number, same: (a: T, b: T) => boolean) {
  let pos = 0;
  for (let j = i - 1; j >= 0; j--) {
    const p = out.findIndex((x) => same(x, target[j]));
    if (p >= 0) {
      pos = p + 1;
      break;
    }
  }
  out.splice(pos, 0, target[i]);
}

/**
 * Ramène `cur` de l'état `base` vers l'état `target`, en ne touchant qu'à ce qui a changé
 * entre `base` et `target`. Ce qui a été modifié entre-temps est conservé ; en cas de conflit
 * sur une valeur simple, `force` donne raison à `target` (« revenir à l'état d'avant »).
 */
export function revert(cur: unknown, target: unknown, base: unknown, force = false): unknown {
  if (deepEqual(base, target)) return cur;
  if (deepEqual(cur, base)) return target;
  if (isObj(cur) && isObj(target) && isObj(base)) {
    const out: Record<string, unknown> = { ...cur };
    for (const k of new Set([...Object.keys(target), ...Object.keys(base)])) {
      if (deepEqual(target[k], base[k])) continue;
      const v = revert(cur[k], target[k], base[k], force);
      if (v === undefined) delete out[k];
      else out[k] = v;
    }
    return out;
  }
  if (Array.isArray(cur) && Array.isArray(target) && Array.isArray(base)) {
    const key = keyOf([cur, target, base]);
    if (key) {
      const k = (x: unknown) => (x as any)[key] as string;
      const T = new Map(target.map((x) => [k(x), x]));
      const B = new Map(base.map((x) => [k(x), x]));
      // retirés : présents dans base (ajoutés par le changement) mais pas dans target
      let out = cur.filter((x) => !(B.has(k(x)) && !T.has(k(x))));
      out = out.map((x) => {
        const kk = k(x);
        return T.has(kk) && B.has(kk) ? revert(x, T.get(kk), B.get(kk), force) : x;
      });
      // remis : présents dans target (retirés par le changement), absents aujourd'hui
      target.forEach((t, i) => {
        const kk = k(t);
        if (B.has(kk) || out.some((x) => k(x) === kk)) return;
        insertAfterPredecessor(out, target, i, (a, b) => k(a) === k(b));
      });
      return out;
    }
    if ([cur, target, base].every((arr) => arr.every(isPrim))) {
      let out = cur.filter((x) => !(base.includes(x) && !target.includes(x)));
      target.forEach((t, i) => {
        if (base.includes(t) || out.includes(t)) return;
        insertAfterPredecessor(out, target, i, (a, b) => a === b);
      });
      return out;
    }
  }
  return force ? target : cur;
}

export type ApplyStatus = 'ok' | 'exists' | 'missing' | 'noop';

/**
 * Applique un changement dans un sens (`undo` : vers `before`, `redo` : vers `after`)
 * sur une copie de travail des données (modifiée en place, collections remplacées).
 */
export function applyChange(data: UndoData, ch: ItemChange, dir: 'undo' | 'redo', force = false): ApplyStatus {
  const target = dir === 'undo' ? ch.before : ch.after;
  const base = dir === 'undo' ? ch.after : ch.before;
  const col = ch.col;
  if (col === 'maps') {
    const cur = data.maps[ch.id];
    if (target == null) {
      if (cur === undefined) return 'noop';
      const maps = { ...data.maps };
      delete maps[ch.id];
      data.maps = maps;
      return 'ok';
    }
    if (base == null) {
      if (cur !== undefined) return deepEqual(cur, target) ? 'noop' : 'exists';
      data.maps = { ...data.maps, [ch.id]: target as any };
      return 'ok';
    }
    if (cur === undefined) return 'missing';
    const v = revert(cur, target, base, force);
    if (deepEqual(v, cur)) return 'noop';
    data.maps = { ...data.maps, [ch.id]: v as any };
    return 'ok';
  }
  const arr = (data as any)[col] as Row[];
  const idx = arr.findIndex((x) => x.id === ch.id);
  if (target == null) {
    if (idx < 0) return 'noop';
    (data as any)[col] = arr.filter((x) => x.id !== ch.id);
    return 'ok';
  }
  if (base == null) {
    if (idx >= 0) return deepEqual(arr[idx], target) ? 'noop' : 'exists';
    if (col === 'wsItems') {
      // Jamais deux fois le même élément dans un espace (il y a été remis entre-temps).
      const t = target as { workspaceId: string; kind: string; refId: string };
      if ((arr as unknown as typeof t[]).some((x) => x.workspaceId === t.workspaceId && x.kind === t.kind && x.refId === t.refId)) return 'exists';
    }
    const next = arr.slice();
    let pos: number;
    if (ch.prevId === null) pos = 0;
    else {
      const p = ch.prevId ? next.findIndex((x) => x.id === ch.prevId) : -1;
      pos = p >= 0 ? p + 1 : Math.min(ch.index ?? next.length, next.length);
    }
    next.splice(pos, 0, target as Row);
    (data as any)[col] = next;
    return 'ok';
  }
  if (idx < 0) return 'missing';
  const v = revert(arr[idx], target, base, force);
  if (deepEqual(v, arr[idx])) return 'noop';
  const next = arr.slice();
  next[idx] = v as Row;
  (data as any)[col] = next;
  return 'ok';
}
