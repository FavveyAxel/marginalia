// ─────────────────────────────────────────────────────────────
// Store global v2 (FIGÉ pour l'API publique ; l'intégrateur seul l'étend).
// Pour sélectionner un tableau / objet dérivé : useStore(useShallow(sel)).
// ─────────────────────────────────────────────────────────────
import { create, type StateCreator } from 'zustand';
import type {
  ActivityEntry,
  ArgumentMap,
  Book,
  Bookmark,
  CategoryId,
  CollectionName,
  Concept,
  Database,
  Edition,
  Highlight,
  Route,
  Settings,
  ItemChange,
  TrackedCollection,
  TrashEntry,
  TrashKind,
  Workspace,
  WorkspaceGroup,
  WorkspaceItem,
  WorkspaceItemKind,
} from './types';
import { host, type PickedFile, extOf } from './platform';
import { createDraftFromFile, isDraftFile } from './draftImport';
import { sniffFile } from './sniff';
import { extractMetadata } from '../features/library/metadata';
import { TRACKED, applyChange, composeChanges, deepEqual, diffData, revert, type Data, type UndoCol, type UndoData } from '../features/history/engine';
import { cascade, cascadeMany, danglingRefs } from '../features/trash/cascade';
import {
  COL_KIND,
  KIND_COL,
  KIND_LABEL,
  TRASHABLE,
  buildEntries,
  bookIdOf,
  labelOf,
  mergeActivity,
  pruneActivity,
  titleOf,
  type Meta,
} from '../features/history/describe';
import { fmtKeys } from './keys';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  fontSize: 19,
  lineHeight: 1.65,
  measure: 66,
  fontFamily: 'serif',
  showToc: true,
  showExtracts: true,
  rightPanel: 'extraits',
  showConnectors: false,
  activeWorkspaceId: null,
  newCardsPerBook: 10,
};

export const EMPTY_EDITION: Edition = { publisher: '', year: '', translator: '', place: '', pageOffset: 0 };

const emptyDb = (): Database => ({
  version: 2,
  books: [],
  highlights: [],
  concepts: [],
  maps: {},
  arguments: [],
  studies: [],
  plans: [],
  drafts: [],
  cards: [],
  workspaces: [],
  groups: [],
  wsItems: [],
  bookmarks: [],
  settings: { ...DEFAULT_SETTINGS },
  trash: [],
  activity: [],
  mapVersions: [],
});

/** Complète une base ancienne ou partielle avec les valeurs par défaut. */
function migrate(db: Partial<Database> | null): Database {
  const base = emptyDb();
  if (!db) return base;
  const out: Database = { ...base, ...db, version: 2, settings: { ...DEFAULT_SETTINGS, ...(db.settings ?? {}) } } as Database;
  out.books = (out.books ?? []).map((b) => ({
    ...b,
    originalName: b.originalName ?? b.fileName,
    edition: { ...EMPTY_EDITION, ...(b.edition ?? {}) },
  }));
  out.highlights = (out.highlights ?? []).map((h) => ({
    ...h,
    noteKind: h.noteKind ?? null,
    printedPage: h.printedPage ?? '',
    conceptIds: h.conceptIds ?? [],
  }));
  out.concepts = (out.concepts ?? []).map((c) => ({ ...c, senses: c.senses ?? [], links: c.links ?? [], programme: c.programme ?? null }));
  for (const k of Object.keys(out.maps ?? {})) {
    out.maps[k] = { ...out.maps[k], edges: out.maps[k].edges.map((e) => ({ ...e, groupId: e.groupId ?? null })) };
  }
  // Corbeille et journal (bases antérieures : absents ; entrées illisibles écartées).
  out.trash = Array.isArray(db.trash)
    ? db.trash.filter((t) => t && typeof t.id === 'string' && typeof t.refId === 'string' && Array.isArray(t.changes)).map((t) => ({ ...t, files: Array.isArray(t.files) ? t.files : [] }))
    : [];
  out.activity = Array.isArray(db.activity) ? db.activity.filter((e) => e && typeof e.id === 'string' && typeof e.at === 'number') : [];
  // Signets (bases antérieures : absents).
  out.bookmarks = Array.isArray(db.bookmarks)
    ? db.bookmarks.filter((b) => b && typeof b.id === 'string' && typeof b.bookId === 'string' && b.position && typeof b.position === 'object').map((b) => ({ ...b, label: typeof b.label === 'string' ? b.label : 'Signet' }))
    : [];
  // Instantanés de cartes (bases antérieures : absents).
  out.mapVersions = Array.isArray(db.mapVersions)
    ? db.mapVersions.filter((v) => v && typeof v.id === 'string' && typeof v.mapKey === 'string' && v.map && Array.isArray(v.map.nodes))
    : [];
  return out;
}

export interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

export interface JumpRequest {
  highlightId: string;
  nonce: number;
}

export interface BookmarkJump {
  bookmarkId: string;
  nonce: number;
}

type Item<C extends CollectionName> = Database[C][number];

export interface State extends Database {
  ready: boolean;
  route: Route;
  activeHighlightId: string | null;
  jump: JumpRequest | null;
  /** Retour demandé vers un signet (⌘K, journal) : le lecteur l'exécute une fois prêt. */
  bookmarkJump: BookmarkJump | null;
  importing: number;
  toasts: Toast[];
  commandOpen: boolean;

  init(): Promise<void>;
  navigate(route: Route): void;
  setCommandOpen(open: boolean): void;
  toast(message: string, tone?: Toast['tone'], action?: Toast['action']): void;
  dismissToast(id: string): void;

  // ── Génériques (pour toutes les collections) ──
  insert<C extends CollectionName>(col: C, item: Item<C>): Item<C>;
  patch<C extends CollectionName>(col: C, id: string, patch: Partial<Item<C>>): void;
  /** Suppression simple, sans cascade (préférer les removeX spécifiques quand ils existent). */
  remove<C extends CollectionName>(col: C, id: string): void;

  // ── Livres ──
  /** `toWorkspace: false` : jamais rangé dans un espace (synchro en arrière-plan). */
  importFiles(files: PickedFile[], opts?: { toWorkspace?: boolean; /** Forcer l'import comme livre (lecture seule), même pour un .md/.docx. */ asBook?: boolean }): Promise<Book[]>;
  updateBook(id: string, patch: Partial<Book>): void;
  removeBook(id: string): Promise<void>;
  /** Ouvre un livre dans le lecteur. `split` : second livre côte à côte. */
  openBook(id: string, split?: string | null): void;

  // ── Extraits ──
  addHighlight(
    h: Omit<Highlight, 'id' | 'createdAt' | 'updatedAt' | 'note' | 'conceptIds' | 'noteKind' | 'printedPage'> &
      Partial<Pick<Highlight, 'note' | 'conceptIds' | 'noteKind' | 'printedPage'>>,
  ): Highlight;
  updateHighlight(id: string, patch: Partial<Highlight>): void;
  removeHighlight(id: string): void;
  setActiveHighlight(id: string | null): void;
  jumpToHighlight(id: string): void;
  setCategoryOf(highlightId: string, category: CategoryId | null): void;

  // ── Signets ──
  addBookmark(b: Omit<Bookmark, 'id' | 'createdAt'>): Bookmark;
  updateBookmark(id: string, patch: Partial<Bookmark>): void;
  /** Supprime un signet (toast « Annuler » ; ⌘Z le remet aussi). */
  removeBookmark(id: string, opts?: { silent?: boolean }): void;
  /** Ouvre le livre du signet (au besoin) et y retourne. */
  jumpToBookmark(id: string): void;

  // ── Concepts ──
  addConcept(name: string, definition?: string, programme?: Concept['programme']): Concept;
  updateConcept(id: string, patch: Partial<Concept>): void;
  removeConcept(id: string): void;
  toggleHighlightConcept(highlightId: string, conceptId: string): void;

  // ── Carte d'argument ──
  getMap(bookId: string): ArgumentMap;
  setMap(bookId: string, map: ArgumentMap): void;
  addHighlightToMap(highlightId: string): void;

  // ── Espaces de travail ──
  createWorkspace(name: string): Workspace;
  removeWorkspace(id: string): void;
  createGroup(workspaceId: string, parentId: string | null, name: string): WorkspaceGroup;
  /** Supprime un groupe : ses éléments et sous-groupes remontent dans le parent. */
  removeGroup(id: string): void;
  /** Ajoute un élément à un espace (sans doublon dans le même espace). */
  addToWorkspace(workspaceId: string, groupId: string | null, kind: WorkspaceItemKind, refId: string): WorkspaceItem;
  moveWsItem(itemId: string, groupId: string | null, order?: number): void;
  removeFromWorkspace(itemId: string): void;
  /**
   * Retrait groupé (sélection multiple) : les documents restent dans la bibliothèque. Une seule
   * transaction (un ⌘Z), un toast « N éléments retirés — Annuler ». Renvoie le nombre retiré.
   */
  removeManyFromWorkspace(itemIds: string[]): number;
  /**
   * Suppression groupée d'éléments de natures mêlées (livres, écrits, plans…) : comme trashDeleteMany,
   * une entrée de corbeille par élément, un seul ⌘Z et un toast « N éléments placés dans la corbeille — Annuler ».
   */
  trashDeleteMixed(targets: { kind: TrashKind; id: string }[]): TrashEntry[];

  // ── Écrits ──
  removeDraft(id: string): Promise<void>;

  updateSettings(patch: Partial<Settings>): void;

  // ── Corbeille ──
  /** Place un élément et tout ce qui en dépend dans la corbeille (rien n'est effacé du disque). */
  trashDelete(kind: TrashKind, id: string, opts?: { mode?: 'lift' | 'tree'; silent?: boolean }): TrashEntry | null;
  /**
   * Suppression groupée (sélection multiple) : une entrée de corbeille par élément (restaurables un à un),
   * mais une seule opération pour l'utilisateur : un toast « N … placés dans la corbeille — Annuler »
   * qui restaure tout, et un seul pas d'annulation (⌘Z).
   */
  trashDeleteMany(kind: TrashKind, ids: string[], opts?: { silent?: boolean }): TrashEntry[];
  /** Remet un élément de la corbeille exactement en place. */
  restoreFromTrash(entryId: string, opts?: { silent?: boolean }): RestoreResult;
  /** Supprime définitivement (fichiers compris). Sans argument : vide la corbeille. */
  purgeTrash(entryIds?: string[], reason?: 'manual' | 'empty' | 'expired'): Promise<number>;
  /** Purge des éléments de plus de 30 jours (appelée au démarrage). */
  purgeExpiredTrash(): Promise<number>;

  // ── Journal et annulation ──
  /** Annule la dernière action sur les données (⌘Z). */
  undo(): boolean;
  /** Rétablit la dernière action annulée (⇧⌘Z). */
  redo(): boolean;
  /** « Revenir à l'état d'avant » une entrée du journal. */
  revertActivity(entryId: string): RestoreResult;
  /** Ajoute une entrée au journal (export, etc.). */
  logActivity(e: Omit<ActivityEntry, 'id' | 'at' | 'startedAt'>): void;
  /**
   * Écriture venue d'une synchro externe (Livres) : hors de ⌘Z et du journal ligne par ligne.
   * `update` reçoit l'état courant et renvoie les collections à remplacer ; `log` : une entrée groupée.
   */
  applyExternal(update: (s: State) => Partial<Pick<Database, 'books' | 'highlights' | 'bookmarks' | 'settings'>> | null, log?: Omit<ActivityEntry, 'id' | 'at' | 'startedAt'>): void;
}

export interface RestoreResult {
  ok: boolean;
  message: string;
}

/** Durée de conservation dans la corbeille. */
export const TRASH_DAYS = 30;
export const TRASH_MS = TRASH_DAYS * 86_400_000;

const pickDb = (s: State): Database => ({
  version: 2,
  books: s.books,
  highlights: s.highlights,
  concepts: s.concepts,
  maps: s.maps,
  arguments: s.arguments,
  studies: s.studies,
  plans: s.plans,
  drafts: s.drafts,
  cards: s.cards,
  workspaces: s.workspaces,
  groups: s.groups,
  wsItems: s.wsItems,
  bookmarks: s.bookmarks,
  settings: s.settings,
  trash: s.trash,
  activity: s.activity,
  mapVersions: s.mapVersions,
});

const pickData = (s: State): UndoData => ({
  books: s.books,
  highlights: s.highlights,
  concepts: s.concepts,
  maps: s.maps,
  arguments: s.arguments,
  studies: s.studies,
  plans: s.plans,
  drafts: s.drafts,
  cards: s.cards,
  workspaces: s.workspaces,
  groups: s.groups,
  wsItems: s.wsItems,
  bookmarks: s.bookmarks,
  trash: s.trash,
});

// ─────────────────────────────────────────────────────────────
// Point central du journal et de l'annulation : chaque écriture du store
// (actions, patch génériques, useStore.setState des modules) passe par ici.
// Les changements d'un même tour de boucle forment une transaction.
// ─────────────────────────────────────────────────────────────
const UNDO_COLS: UndoCol[] = [...TRACKED, 'trash'];
const UNDO_MAX = 100;
const UNDO_COALESCE_MS = 1500;

interface Tx {
  label: string;
  changes: ItemChange[];
  at: number;
}
let undoStack: Tx[] = [];
let redoStack: Tx[] = [];
/** > 0 : écritures non enregistrées (chargement, application d'une annulation). */
let quiet = 0;
let nextMeta: Meta | null = null;
let pending: { changes: ItemChange[]; meta: Meta | null } | null = null;
let rawSet: (partial: Partial<State>) => void = () => {};
let lastTrashToastAt = 0;
let initPromise: Promise<void> | null = null;

/** Exposé aux tests et à l'interface : état des piles d'annulation. */
export const undoInfo = () => ({ undo: undoStack.map((t) => t.label), redo: redoStack.map((t) => t.label) });

function recordChange(prev: State, next: State) {
  if (!prev.ready || !next.ready) {
    nextMeta = null;
    return;
  }
  const meta = nextMeta;
  nextMeta = null;
  if (quiet) return;
  if (!UNDO_COLS.some((c) => (prev as any)[c] !== (next as any)[c])) return;
  const changes = diffData(pickData(prev), pickData(next), UNDO_COLS);
  if (!changes.length) return;
  if (!pending) {
    pending = { changes: [], meta: null };
    queueMicrotask(flush);
  }
  pending.changes.push(...changes);
  if (meta) pending.meta = meta;
}

function flush() {
  const p = pending;
  pending = null;
  if (!p) return;
  const changes = composeChanges(p.changes);
  if (!changes.length) return;
  const s = useStore.getState();
  const entries = buildEntries(changes, p.meta, s);
  const now = Date.now();
  const undoable =
    p.meta?.undoable !== false &&
    p.meta?.action !== 'import' &&
    !changes.some((c) => (c.col === 'books' || c.col === 'drafts') && c.before == null);
  if (undoable) {
    const label = entries.length === 1 ? labelOf(entries[0]) : entries.length ? `${entries.length} modifications` : 'réorganisation';
    const last = undoStack[undoStack.length - 1];
    const single = changes.length === 1 && changes[0].before != null && changes[0].after != null && !p.meta;
    if (
      single &&
      last &&
      !redoStack.length &&
      now - last.at < UNDO_COALESCE_MS &&
      last.changes.length === 1 &&
      last.changes[0].col === changes[0].col &&
      last.changes[0].id === changes[0].id &&
      last.changes[0].before != null &&
      last.changes[0].after != null
    ) {
      last.changes = [{ ...last.changes[0], after: changes[0].after }];
      last.at = now;
    } else {
      undoStack.push({ label, changes, at: now });
      if (undoStack.length > UNDO_MAX) undoStack = undoStack.slice(-UNDO_MAX);
    }
    redoStack = [];
  }
  if (entries.length) rawSet({ activity: mergeActivity(s.activity, entries, now, s, uid) });
}

/** Termine immédiatement la transaction en cours (avant une annulation, par exemple). */
function flushNow() {
  if (pending) flush();
}

/**
 * La prochaine écriture forme une étape d'annulation distincte (pas de fusion avec la
 * précédente, même rapprochée) : rangement automatique de la carte, début d'un glisser…
 */
export function separateUndoStep() {
  flushNow();
  const last = undoStack[undoStack.length - 1];
  if (last) last.at = 0;
}

/** Middleware : enveloppe setState (actions ET useStore.setState externes). */
/** Les « Annuler » des toasts précédents ne correspondent plus à l'état : on les retire. */
function dropActionToasts() {
  const s = useStore.getState();
  if (s.toasts.some((t) => t.action)) rawSet({ toasts: s.toasts.filter((t) => !t.action) });
}

const tracked =
  (config: StateCreator<State>): StateCreator<State> =>
  (set, get, api) => {
    const orig = api.setState;
    rawSet = (partial) => orig(partial);
    const wrapped: typeof api.setState = (partial, replace) => {
      const prev = api.getState();
      (orig as any)(partial, replace);
      recordChange(prev, api.getState());
    };
    api.setState = wrapped;
    return config(wrapped, get, api);
  };

const colOfKind = (k: TrashKind) => KIND_COL[k];

/** Applique une liste de changements (sens annuler ou rétablir) ; renvoie s'il s'est passé quelque chose. */
function applyChanges(changes: ItemChange[], dir: 'undo' | 'redo', force = false, meta?: Meta): boolean {
  const s = useStore.getState();
  const data = pickData(s);
  let changed = false;
  for (const ch of changes) if (applyChange(data, ch, dir, force) === 'ok') changed = true;
  if (!changed) return false;
  if (meta) {
    nextMeta = meta;
    useStore.setState(data as Partial<State>);
  } else {
    quiet++;
    try {
      useStore.setState(data as Partial<State>);
    } finally {
      quiet--;
    }
  }
  return true;
}

/** Où se trouve un élément supprimé : dans une entrée de corbeille (racine ou cascade). */
function findInTrash(trash: TrashEntry[], col: TrackedCollection, id: string): TrashEntry | null {
  return trash.find((t) => t.changes.some((c) => c.col === col && c.id === id && c.after == null && c.before != null)) ?? null;
}

/** Message d'empêchement si le parent indispensable d'un élément manque. */
function parentBlock(kind: TrashKind, root: any, d: UndoData): string | null {
  if (!root) return null;
  const need: { col: TrackedCollection; id: string | null; what: string }[] = [];
  if (kind === 'highlight' || kind === 'study') need.push({ col: 'books', id: root.bookId, what: 'le livre' });
  if (kind === 'card') {
    need.push({ col: 'highlights', id: root.highlightId, what: 'l’extrait' });
    need.push({ col: 'concepts', id: root.conceptId, what: 'le concept' });
    need.push({ col: 'books', id: root.bookId, what: 'le livre' });
  }
  if (kind === 'group') need.push({ col: 'workspaces', id: root.workspaceId, what: 'l’espace' });
  const own = kind === 'highlight' ? 'cet extrait' : kind === 'study' ? 'cette fiche-texte' : kind === 'card' ? 'cette carte' : 'ce groupe';
  for (const n of need) {
    if (!n.id || (d as any)[n.col].some((x: { id: string }) => x.id === n.id)) continue;
    const t = findInTrash(d.trash, n.col, n.id);
    if (t) {
      const what = t.refId === n.id ? `${n.what} « ${t.title} »` : `« ${t.title} »`;
      return `Restaurez d’abord ${what} : ${own} en dépend.`;
    }
    return `${n.what.charAt(0).toUpperCase() + n.what.slice(1)} dont dépend ${own} a été supprimé définitivement : la restauration est impossible.`;
  }
  return null;
}

/** Adapte un élément restauré en cascade à ce qui existe encore ; null = à ne pas restaurer. */
function fitChild(col: TrackedCollection, item: any, d: UndoData): any | null {
  const has = (c: TrackedCollection, id: string | null | undefined) => !id || (d as any)[c].some((x: { id: string }) => x.id === id);
  switch (col) {
    case 'highlights':
    case 'studies':
    case 'bookmarks':
      return has('books', item.bookId) ? item : null;
    case 'cards':
      return has('highlights', item.highlightId) && has('concepts', item.conceptId) && has('books', item.bookId) ? item : null;
    case 'groups':
      if (!has('workspaces', item.workspaceId)) return null;
      return has('groups', item.parentId) ? item : { ...item, parentId: null };
    case 'wsItems': {
      if (!has('workspaces', item.workspaceId)) return null;
      const refCol: Record<string, TrackedCollection> = { book: 'books', map: 'books', draft: 'drafts', plan: 'plans', argument: 'arguments', study: 'studies' };
      const isFreeMap = item.kind === 'map' && !!d.maps[item.refId];
      if (!isFreeMap && !has(refCol[item.kind] ?? 'books', item.refId)) return null;
      return has('groups', item.groupId) ? item : { ...item, groupId: null };
    }
    default:
      return item;
  }
}

/**
 * Après une restauration : ce qui vient de revenir ne doit pas pointer vers ce qui est
 * encore dans la corbeille. On applique la cascade de chaque entrée restante (racine absente :
 * seules les références sont retirées) et on l'ajoute à son entrée, qui saura les remettre.
 */
function recascade(d: UndoData): void {
  d.trash = d.trash.map((t) => {
    const byKind = new Map<TrashKind, { id: string; parentId: string | null }[]>();
    for (const c of t.changes) {
      if (c.after != null || c.before == null || c.col === 'maps' || c.col === 'wsItems' || c.col === 'trash') continue;
      const kind = COL_KIND[c.col as TrackedCollection];
      if (!TRASHABLE.has(kind)) continue;
      byKind.set(kind as TrashKind, [...(byKind.get(kind as TrashKind) ?? []), { id: c.id, parentId: (c.before as any)?.parentId ?? null }]);
    }
    let cur: Data = d;
    const added: ItemChange[] = [];
    for (const [kind, list] of byKind) {
      const next =
        kind === 'group' && t.mode !== 'tree'
          ? list.reduce<Data>((acc, g) => cascade(acc, 'group', g.id, { mode: 'lift', groupParentId: g.parentId }), cur)
          : cascadeMany(cur, kind, list.map((x) => x.id), { mode: t.mode });
      if (next !== cur) {
        added.push(...diffData(cur, next, TRACKED, true));
        cur = next;
      }
    }
    if (!added.length) return t;
    for (const col of TRACKED) (d as any)[col] = (cur as any)[col];
    return { ...t, changes: [...t.changes, ...added] };
  });
}

/** Fichiers à effacer au vidage. */
function filesOf(kind: TrashKind, root: any): TrashEntry['files'] {
  if (kind === 'book') return [{ ownerId: root.id, fileName: root.fileName }];
  // L'éditeur garde aussi une copie de la version précédente (document.prev.docx).
  // … et son historique de versions (versions/*.docx), effacé avec lui au vidage.
  if (kind === 'draft')
    return [
      { ownerId: root.id, fileName: root.fileName },
      { ownerId: root.id, fileName: 'document.prev.docx' },
      ...((root.versions ?? []) as { fileName: string }[]).map((v) => ({ ownerId: root.id, fileName: v.fileName })),
    ];
  return [];
}

/** « Avec 12 extraits, la carte d'argument et 3 cartes de révision ». */
function detailOf(kind: TrashKind, changes: ItemChange[], rootId: string): string {
  const rootCol = colOfKind(kind);
  const removed = (col: UndoCol) => changes.filter((c) => c.col === col && c.after == null && !(col === rootCol && c.id === rootId)).length;
  const touched = (col: UndoCol) => changes.filter((c) => c.col === col && c.before != null && c.after != null).length;
  const join = (bits: string[]) => (bits.length > 1 ? `${bits.slice(0, -1).join(', ')} et ${bits[bits.length - 1]}` : (bits[0] ?? ''));
  const n = (bits: string[], k: number, one: string, many: string) => k && bits.push(`${k} ${k > 1 ? many : one}`);
  // Groupe dégroupé : rien n'est retiré, son contenu remonte d'un niveau.
  if (kind === 'group' && !changes.some((c) => c.after == null && !(c.col === 'groups' && c.id === rootId))) {
    const moved: string[] = [];
    n(moved, touched('groups'), 'sous-groupe', 'sous-groupes');
    n(moved, touched('wsItems'), 'référence', 'références');
    return moved.length ? `Contenu remonté d’un niveau : ${join(moved)}` : 'Groupe vide';
  }
  const bits: string[] = [];
  n(bits, removed('highlights'), 'extrait', 'extraits');
  if (removed('maps')) bits.push('la carte d’argument');
  n(bits, removed('studies'), 'fiche-texte', 'fiches-texte');
  n(bits, removed('cards'), 'carte de révision', 'cartes de révision');
  n(bits, removed('bookmarks'), 'signet', 'signets');
  n(bits, removed('groups'), 'groupe', 'groupes');
  const group = kind === 'workspace' || kind === 'group';
  n(bits, removed('wsItems'), group ? 'référence' : 'référence dans un espace', group ? 'références' : 'références dans des espaces');
  // Références retirées d'autres éléments (qui, eux, restent en place).
  const refs: string[] = [];
  n(refs, touched('highlights'), 'extrait', 'extraits');
  n(refs, touched('concepts'), 'concept', 'concepts');
  n(refs, touched('arguments'), 'argument', 'arguments');
  n(refs, touched('plans'), 'plan', 'plans');
  n(refs, touched('maps'), 'carte d’argument', 'cartes d’argument');
  const out: string[] = [];
  if (bits.length) out.push(`Avec ${join(bits)}`);
  if (refs.length) out.push(`${bits.length ? 'retiré' : 'Retiré'} de ${join(refs)}`);
  return out.join(' ; ');
}

/** « livres », « écrits »… (accord au masculin : « placés », « restaurés »). */
function pluralKind(kind: TrashKind, n: number): string {
  const L: Partial<Record<TrashKind, [string, string]>> = {
    book: ['livre', 'livres'],
    draft: ['écrit', 'écrits'],
    plan: ['plan', 'plans'],
    argument: ['argument', 'arguments'],
    concept: ['concept', 'concepts'],
    highlight: ['extrait', 'extraits'],
    workspace: ['espace', 'espaces'],
    group: ['groupe', 'groupes'],
    map: ['carte', 'cartes'],
  };
  const [one, many] = L[kind] ?? ['élément', 'éléments'];
  return n > 1 ? many : one;
}

/** Fusionne en un seul pas d'annulation les transactions empilées depuis `before` (opération groupée). */
function mergeNewTx(before: Set<Tx>, label: string) {
  const added = undoStack.filter((t) => !before.has(t));
  if (added.length < 2) return;
  const keep = undoStack.filter((t) => before.has(t));
  // Annuler applique les changements dans l'ordre : la dernière transaction passe en premier.
  const changes = [...added].reverse().flatMap((t) => t.changes);
  undoStack = [...keep, { label, changes, at: Date.now() }];
}

function trashToastText(e: TrashEntry): string {
  if (e.kind === 'highlight') return 'Extrait placé dans la corbeille';
  if (e.kind === 'card') return 'Carte placée dans la corbeille';
  if (e.kind === 'study') return 'Fiche-texte placée dans la corbeille';
  if (e.kind === 'map') return `Carte « ${e.title} » placée dans la corbeille`;
  return `« ${e.title} » placé dans la corbeille`;
}

// Fichiers ouverts avec Marginalia (double-clic, « Ouvrir avec ») pendant cette session : la visite
// guidée d'un nouvel utilisateur attend alors qu'il revienne à l'accueil, au lieu de l'interrompre.
let openedFiles = false;
export const filesOpenedThisSession = () => openedFiles;

export const useStore = create<State>()(tracked((set, get) => ({
  ...emptyDb(),
  ready: false,
  route: { name: 'home' },
  activeHighlightId: null,
  jump: null,
  bookmarkJump: null,
  importing: 0,
  toasts: [],
  commandOpen: false,

  init() {
    // Une seule initialisation : React.StrictMode appelle l'effet deux fois en développement,
    // et un second chargement de la base écraserait la purge de corbeille faite par le premier.
    if (initPromise) return initPromise;
    initPromise = (async () => {
      let db: Database | null = null;
      let loadError = false;
      try {
        db = await host.loadDb();
      } catch (e) {
        console.error(e);
        loadError = true;
      }
      // Lecture impossible (≠ premier lancement) : on n'écrit rien, sinon une base vide remplacerait la vraie.
      if (loadError) persistBlocked = true;
      host.onNotice?.((n) => get().toast(n.message, n.tone, n.tone === 'success' ? undefined : { label: 'OK', run: () => {} }));
      host.onFlushRequest?.(flushPendingSave);
      set({ ...migrate(db), ready: true });
      if (loadError)
        get().toast('Impossible de lire vos données : rien ne sera enregistré pendant cette session. Quittez puis relancez Marginalia.', 'error', {
          label: 'OK',
          run: () => {},
        });
      rawSet({ activity: pruneActivity(get().activity, Date.now()) });
      get()
        .purgeExpiredTrash()
        .catch((e) => console.warn('corbeille', e));
      host.onOpenFiles((files) => {
        openedFiles = true;
        get()
          .importFiles(files)
          .then((books) => {
            if (books.length === 1) get().openBook(books[0].id);
          });
      });
    })();
    return initPromise;
  },

  navigate(route) {
    set({ route, activeHighlightId: null });
  },
  setCommandOpen(open) {
    set({ commandOpen: open });
  },
  toast(message, tone = 'info', action) {
    // Les modules annoncent parfois eux-mêmes « … supprimé » : la corbeille l'a déjà dit, avec « Annuler ».
    if (tone === 'info' && !action && /supprim/i.test(message) && Date.now() - lastTrashToastAt < 2000) return;
    // Exports : tous les modules confirment par un toast de succès ; on le consigne au journal.
    if (tone === 'success' && /export/i.test(message)) logExport(message);
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { id, message, tone, action }] }));
    setTimeout(() => get().dismissToast(id), action ? 6000 : 3600);
  },
  dismissToast(id) {
    if (!get().toasts.some((t) => t.id === id)) return;
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  insert(col, item) {
    set((s) => ({ [col]: [...(s[col] as any[]), item] }) as Partial<State>);
    return item;
  },
  patch(col, id, patch) {
    set(
      (s) =>
        ({
          [col]: (s[col] as any[]).map((x) =>
            x.id === id ? { ...x, ...patch, ...('updatedAt' in x ? { updatedAt: Date.now() } : {}) } : x,
          ),
        }) as Partial<State>,
    );
  },
  remove(col, id) {
    if (col === 'wsItems') return get().removeFromWorkspace(id);
    if (col === 'bookmarks') return get().removeBookmark(id);
    const kind = COL_KIND[col] as TrashKind;
    if (TRASHABLE.has(kind)) get().trashDelete(kind, id);
  },

  async importFiles(files, opts) {
    const r0 = get().route;
    const target =
      opts?.toWorkspace === false
        ? null
        : r0.name === 'workspace'
          ? { workspaceId: r0.workspaceId, groupId: r0.groupId }
          : r0.name === 'import' && r0.workspaceId
            ? { workspaceId: r0.workspaceId, groupId: r0.groupId ?? null }
            : null;
    const added: Book[] = [];
    set((s) => ({ importing: s.importing + files.length }));
    const drafts: { id: string; title: string }[] = [];
    for (const f of files) {
      try {
        // Un document Word ou Markdown est un écrit (éditable), pas un livre.
        if (!opts?.asBook && isDraftFile(f.name)) {
          const d = await createDraftFromFile(f.name, f.data);
          drafts.push(d);
          if (target && get().workspaces.some((w) => w.id === target.workspaceId)) get().addToWorkspace(target.workspaceId, target.groupId, 'draft', d.id);
          continue;
        }
        const meta = await extractMetadata(f);
        const id = uid();
        const ext = extOf(f.name);
        // Extension réelle d'après le contenu (photo sans extension, extension trompeuse…).
        const sniffedExt = sniffFile(f.data).ext;
        const fileName = `source.${sniffedExt ?? (ext || 'bin')}`;
        await host.storeFile(id, fileName, f.data);
        const book: Book = {
          id,
          title: meta.title,
          author: meta.author,
          format: meta.format,
          fileName,
          originalName: f.name,
          size: f.data.byteLength,
          addedAt: Date.now(),
          lastOpenedAt: null,
          progress: 0,
          position: null,
          cover: meta.cover,
          edition: { ...EMPTY_EDITION, ...(meta.edition ?? {}) },
        };
        added.push(book);
        nextMeta = { action: 'import' };
        set((s) => ({ books: [book, ...s.books] }));
        // Ajout à un espace seulement si l'import a été lancé depuis cet espace (pas depuis la bibliothèque).
        if (target && get().workspaces.some((w) => w.id === target.workspaceId)) get().addToWorkspace(target.workspaceId, target.groupId, 'book', id);
      } catch (e) {
        console.error(e);
        get().toast(`Impossible d’importer « ${f.name} »`, 'error');
      } finally {
        set((s) => ({ importing: Math.max(0, s.importing - 1) }));
      }
    }
    if (added.length) {
      get().toast(added.length === 1 ? `« ${added[0].title} » ajouté` : `${added.length} documents ajoutés`, 'success');
    }
    if (drafts.length) {
      const first = drafts[0];
      get().toast(
        drafts.length === 1 ? `« ${first.title} » ajouté à tes écrits` : `${drafts.length} documents ajoutés à tes écrits`,
        'success',
        drafts.length === 1 ? { label: 'Ouvrir', run: () => get().navigate({ name: 'write', draftId: first.id }) } : { label: 'Voir', run: () => get().navigate({ name: 'write', draftId: null }) },
      );
    }
    return added;
  },

  updateBook(id, patch) {
    set((s) => ({ books: s.books.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  },

  async removeBook(id) {
    // Le fichier reste sur le disque jusqu'au vidage de la corbeille (ou 30 jours).
    get().trashDelete('book', id);
  },

  openBook(id, split = null) {
    get().updateBook(id, { lastOpenedAt: Date.now() });
    set({ route: { name: 'reader', bookId: id, tab: 'lecture', splitBookId: split }, activeHighlightId: null });
  },

  addHighlight(h) {
    const now = Date.now();
    const full: Highlight = {
      note: '',
      conceptIds: [],
      noteKind: null,
      printedPage: '',
      ...h,
      id: uid(),
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ highlights: [...s.highlights, full] }));
    return full;
  },
  updateHighlight(id, patch) {
    set((s) => ({
      highlights: s.highlights.map((h) => {
        if (h.id !== id) return h;
        const next = { ...h, ...patch, updatedAt: Date.now() };
        // Un surlignage simple devient note de marge (ou catégorisé) dès qu'on lui ajoute quelque chose.
        if (next.plain && (next.category !== null || next.note.trim() || next.noteKind)) delete next.plain;
        return next;
      }),
    }));
  },
  removeHighlight(id) {
    get().trashDelete('highlight', id);
  },
  setActiveHighlight(id) {
    set({ activeHighlightId: id });
  },
  jumpToHighlight(id) {
    const h = get().highlights.find((x) => x.id === id);
    if (!h) return;
    const r = get().route;
    const inReader = r.name === 'reader' && (r.bookId === h.bookId || r.splitBookId === h.bookId) && r.tab === 'lecture';
    if (!inReader) {
      get().updateBook(h.bookId, { lastOpenedAt: Date.now() });
      set({ route: { name: 'reader', bookId: h.bookId, tab: 'lecture', splitBookId: null } });
    }
    set({ activeHighlightId: id, jump: { highlightId: id, nonce: Date.now() } });
  },
  setCategoryOf(highlightId, category) {
    get().updateHighlight(highlightId, { category });
  },

  addBookmark(b) {
    const full: Bookmark = { ...b, id: uid(), createdAt: Date.now() };
    set((s) => ({ bookmarks: [...s.bookmarks, full] }));
    return full;
  },
  updateBookmark(id, patch) {
    set((s) => ({ bookmarks: s.bookmarks.map((b) => (b.id === id ? { ...b, ...patch, id } : b)) }));
  },
  removeBookmark(id, opts = {}) {
    flushNow();
    const s = get();
    const index = s.bookmarks.findIndex((b) => b.id === id);
    if (index < 0) return;
    const bm = s.bookmarks[index];
    set({ bookmarks: s.bookmarks.filter((b) => b.id !== id) });
    if (opts.silent) return;
    const change: ItemChange = { col: 'bookmarks', id, before: bm, after: null, prevId: s.bookmarks[index - 1]?.id ?? null, index };
    get().toast('Signet supprimé', 'info', {
      label: 'Annuler',
      run: () => {
        flushNow();
        applyChanges([change], 'undo', false, { action: 'restore', kind: 'bookmark', refId: id, bookId: bm.bookId, title: bm.label || 'Signet', summary: 'Signet remis' });
        dropActionToasts();
      },
    });
  },
  jumpToBookmark(id) {
    const b = get().bookmarks.find((x) => x.id === id);
    if (!b || !get().books.some((x) => x.id === b.bookId)) return;
    const r = get().route;
    const inReader = r.name === 'reader' && (r.bookId === b.bookId || r.splitBookId === b.bookId) && r.tab === 'lecture';
    if (!inReader) {
      get().updateBook(b.bookId, { lastOpenedAt: Date.now() });
      set({ route: { name: 'reader', bookId: b.bookId, tab: 'lecture', splitBookId: null }, activeHighlightId: null });
    }
    set({ bookmarkJump: { bookmarkId: id, nonce: Date.now() } });
  },

  addConcept(name, definition = '', programme = null) {
    const norm = (x: string) => x.trim().toLowerCase();
    const existing = get().concepts.find((c) => norm(c.name) === norm(name));
    if (existing) return existing;
    const now = Date.now();
    const c: Concept = { id: uid(), name: name.trim(), definition, senses: [], links: [], programme, createdAt: now, updatedAt: now };
    set((s) => ({ concepts: [...s.concepts, c] }));
    return c;
  },
  updateConcept(id, patch) {
    set((s) => ({ concepts: s.concepts.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)) }));
  },
  removeConcept(id) {
    get().trashDelete('concept', id);
  },
  toggleHighlightConcept(highlightId, conceptId) {
    set((s) => ({
      highlights: s.highlights.map((h) =>
        h.id !== highlightId
          ? h
          : {
              ...h,
              conceptIds: h.conceptIds.includes(conceptId) ? h.conceptIds.filter((x) => x !== conceptId) : [...h.conceptIds, conceptId],
              updatedAt: Date.now(),
            },
      ),
    }));
  },

  getMap(bookId) {
    return get().maps[bookId] ?? { bookId, nodes: [], edges: [], viewport: null };
  },
  setMap(bookId, map) {
    set((s) => ({ maps: { ...s.maps, [bookId]: map } }));
  },
  addHighlightToMap(highlightId) {
    const h = get().highlights.find((x) => x.id === highlightId);
    if (!h) return;
    const map = get().getMap(h.bookId);
    if (map.nodes.some((n) => n.highlightId === highlightId)) {
      get().toast('Déjà sur la carte');
      return;
    }
    const i = map.nodes.length;
    const node = { id: uid(), highlightId, text: '', x: 80 + (i % 4) * 300, y: 80 + Math.floor(i / 4) * 200 };
    get().setMap(h.bookId, { ...map, nodes: [...map.nodes, node] });
    get().toast('Ajouté à la carte d’argument', 'success');
  },

  createWorkspace(name) {
    const tints = ['--cat-these', '--cat-argument', '--cat-concept', '--cat-exemple', '--cat-probleme', '--cat-objection'];
    const n = get().workspaces.length;
    const ws: Workspace = { id: uid(), name: name.trim() || 'Nouvel espace', tint: tints[n % tints.length], order: n, createdAt: Date.now() };
    set((s) => ({ workspaces: [...s.workspaces, ws] }));
    return ws;
  },
  removeWorkspace(id) {
    get().trashDelete('workspace', id);
  },
  createGroup(workspaceId, parentId, name) {
    const siblings = get().groups.filter((g) => g.workspaceId === workspaceId && g.parentId === parentId);
    const g: WorkspaceGroup = { id: uid(), workspaceId, parentId, name: name.trim() || 'Nouveau groupe', order: siblings.length, collapsed: false };
    set((s) => ({ groups: [...s.groups, g] }));
    return g;
  },
  removeGroup(id) {
    get().trashDelete('group', id, { mode: 'lift' });
  },
  addToWorkspace(workspaceId, groupId, kind, refId) {
    const existing = get().wsItems.find((i) => i.workspaceId === workspaceId && i.kind === kind && i.refId === refId);
    if (existing) {
      if (existing.groupId !== groupId) get().moveWsItem(existing.id, groupId);
      return existing;
    }
    const order = get().wsItems.filter((i) => i.workspaceId === workspaceId && i.groupId === groupId).length;
    const item: WorkspaceItem = { id: uid(), workspaceId, groupId, kind, refId, order };
    set((s) => ({ wsItems: [...s.wsItems, item] }));
    return item;
  },
  moveWsItem(itemId, groupId, order) {
    set((s) => ({
      wsItems: s.wsItems.map((i) =>
        i.id === itemId ? { ...i, groupId, order: order ?? s.wsItems.filter((x) => x.groupId === groupId).length } : i,
      ),
    }));
  },
  removeFromWorkspace(itemId) {
    const s = get();
    const index = s.wsItems.findIndex((i) => i.id === itemId);
    if (index < 0) return;
    const item = s.wsItems[index];
    set({ wsItems: s.wsItems.filter((i) => i.id !== itemId) });
    const change: ItemChange = { col: 'wsItems', id: itemId, before: item, after: null, prevId: s.wsItems[index - 1]?.id ?? null, index };
    get().toast('Retiré de l’espace', 'info', { label: 'Annuler', run: () => applyChanges([change], 'undo', false, { action: 'restore', kind: 'wsItem', refId: itemId, title: titleOf('wsItems', item, get()), summary: 'Remis dans l’espace' }) });
  },
  removeManyFromWorkspace(itemIds) {
    const s = get();
    const wanted = new Set(itemIds);
    // Positions d'origine (ordre du tableau) : remis dans cet ordre, chacun retrouve sa place.
    const changes: ItemChange[] = [];
    s.wsItems.forEach((item, index) => {
      if (wanted.has(item.id)) changes.push({ col: 'wsItems', id: item.id, before: item, after: null, prevId: s.wsItems[index - 1]?.id ?? null, index });
    });
    const n = changes.length;
    if (n <= 1) {
      if (n) get().removeFromWorkspace(changes[0].id);
      return n;
    }
    flushNow();
    set({ wsItems: s.wsItems.filter((i) => !wanted.has(i.id)) });
    const wsId = (changes[0].before as WorkspaceItem).workspaceId;
    const ws = s.workspaces.find((w) => w.id === wsId);
    get().toast(`${n} éléments retirés de l’espace`, 'info', {
      label: 'Annuler',
      run: () => {
        flushNow();
        applyChanges(changes, 'undo', false, { action: 'restore', kind: 'wsItem', refId: changes[0].id, title: ws?.name ?? 'Espace', summary: `${n} éléments remis dans l’espace` });
        dropActionToasts();
        get().toast(`${n} éléments remis dans l’espace`, 'success');
      },
    });
    return n;
  },
  trashDeleteMixed(targets) {
    const kinds = new Set(targets.map((t) => t.kind));
    if (kinds.size <= 1) return targets.length ? get().trashDeleteMany(targets[0].kind, targets.map((t) => t.id)) : [];
    flushNow();
    const before = new Set(undoStack);
    const entries: TrashEntry[] = [];
    const seen = new Set<string>();
    for (const t of targets) {
      if (seen.has(t.kind + ':' + t.id)) continue;
      seen.add(t.kind + ':' + t.id);
      // Un élément déjà emporté par la cascade d'un autre (fiche-texte d'un livre supprimé) est ignoré.
      const e = get().trashDelete(t.kind, t.id, { silent: true });
      if (e) entries.push(e);
    }
    flushNow();
    const n = entries.length;
    if (!n) return entries;
    mergeNewTx(before, `${n} élément${n > 1 ? 's' : ''} placé${n > 1 ? 's' : ''} dans la corbeille`);
    const restoreAll = () => {
      flushNow();
      const mark = new Set(undoStack);
      let ok = 0;
      for (const e of [...entries].reverse()) if (get().restoreFromTrash(e.id, { silent: true }).ok) ok++;
      flushNow();
      mergeNewTx(mark, `${ok} élément${ok > 1 ? 's' : ''} restauré${ok > 1 ? 's' : ''}`);
      dropActionToasts();
      if (ok === n) get().toast(`${n} élément${n > 1 ? 's' : ''} restauré${n > 1 ? 's' : ''}`, 'success');
      else get().toast(`${ok} sur ${n} restaurés : les autres ne peuvent plus revenir`, ok ? 'info' : 'error');
    };
    get().toast(n === 1 ? trashToastText(entries[0]) : `${n} éléments placés dans la corbeille`, 'info', { label: 'Annuler', run: restoreAll });
    lastTrashToastAt = Date.now();
    return entries;
  },

  async removeDraft(id) {
    // Le .docx reste sur le disque jusqu'au vidage de la corbeille (ou 30 jours).
    get().trashDelete('draft', id);
  },

  updateSettings(patch) {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
  },

  // ── Corbeille ──────────────────────────────────────────────
  trashDelete(kind, id, opts = {}) {
    flushNow();
    const s = get();
    const data = pickData(s);
    const col = colOfKind(kind);
    // `maps` est un objet indexé (cartes libres / de mouvement), les autres collections des tableaux.
    const root = col === 'maps' ? data.maps[id] : (data as any)[col].find((x: { id: string }) => x.id === id);
    if (!root) return null;
    const mode = kind === 'group' ? (opts.mode ?? 'lift') : undefined;
    const next = cascade(data, kind, id, { mode });
    const changes = diffData(data, next, TRACKED, true);
    const entry: TrashEntry = {
      id: uid(),
      kind,
      refId: id,
      title: titleOf(col, root, s),
      detail: detailOf(kind, changes, id),
      bookId: kind === 'book' ? id : bookIdOf(col, root, s),
      deletedAt: Date.now(),
      ...(mode ? { mode } : {}),
      changes,
      files: filesOf(kind, root),
    };
    nextMeta = { action: 'delete', kind, refId: id, title: entry.title, bookId: entry.bookId, summary: entry.detail || 'Placé dans la corbeille', trashId: entry.id };
    const patch: Partial<State> = { trash: [entry, ...s.trash] };
    for (const c of TRACKED) if ((next as any)[c] !== (data as any)[c]) (patch as any)[c] = (next as any)[c];
    if (kind === 'highlight' && s.activeHighlightId === id) patch.activeHighlightId = null;
    if (kind === 'workspace' && s.settings.activeWorkspaceId === id) patch.settings = { ...s.settings, activeWorkspaceId: null };
    set(patch);
    if (!opts.silent) {
      get().toast(trashToastText(entry), 'info', { label: 'Annuler', run: () => get().restoreFromTrash(entry.id) });
      lastTrashToastAt = Date.now();
    }
    return entry;
  },

  trashDeleteMany(kind, ids, opts = {}) {
    const unique = [...new Set(ids)];
    if (unique.length <= 1) {
      const one = unique.length ? get().trashDelete(kind, unique[0], opts) : null;
      return one ? [one] : [];
    }
    flushNow();
    const before = new Set(undoStack);
    const entries: TrashEntry[] = [];
    for (const id of unique) {
      const e = get().trashDelete(kind, id, { silent: true });
      if (e) entries.push(e);
    }
    flushNow();
    const n = entries.length;
    if (!n) return entries;
    mergeNewTx(before, `${n} ${pluralKind(kind, n)} placé${n > 1 ? 's' : ''} dans la corbeille`);
    if (!opts.silent) {
      const restoreAll = () => {
        flushNow();
        const mark = new Set(undoStack);
        let ok = 0;
        // Ordre inverse : chaque élément retrouve sa place exacte (positions dans les espaces).
        for (const e of [...entries].reverse()) if (get().restoreFromTrash(e.id, { silent: true }).ok) ok++;
        flushNow();
        mergeNewTx(mark, `${ok} ${pluralKind(kind, ok)} restauré${ok > 1 ? 's' : ''}`);
        dropActionToasts();
        if (ok === n) get().toast(`${n} ${pluralKind(kind, n)} restauré${n > 1 ? 's' : ''}`, 'success');
        else get().toast(`${ok} sur ${n} restaurés : les autres ne peuvent plus revenir`, ok ? 'info' : 'error');
      };
      get().toast(n === 1 ? trashToastText(entries[0]) : `${n} ${pluralKind(kind, n)} placés dans la corbeille`, 'info', { label: 'Annuler', run: restoreAll });
      lastTrashToastAt = Date.now();
    }
    return entries;
  },

  restoreFromTrash(entryId, opts = {}) {
    flushNow();
    const s = get();
    const entry = s.trash.find((t) => t.id === entryId);
    if (!entry) return { ok: false, message: 'Cet élément n’est plus dans la corbeille.' };
    const data: UndoData = { ...pickData(s), trash: s.trash.filter((t) => t.id !== entryId) };
    const col = colOfKind(entry.kind);
    const root = entry.changes.find((c) => c.col === col && c.id === entry.refId && c.after == null)?.before;
    const block = parentBlock(entry.kind, root, data);
    if (block) {
      if (!opts.silent) get().toast(block, 'error');
      return { ok: false, message: block };
    }
    let skipped = 0;
    const restoredKeys: { col: TrackedCollection; id: string }[] = [];
    for (const ch of entry.changes) {
      if (ch.col === 'trash') continue;
      const c = ch.col as TrackedCollection;
      if (ch.after == null && ch.before != null) {
        let item = ch.before;
        if (c === 'maps') {
          // Carte de livre : clé = bookId ; carte de mouvement : son livre ; carte libre : aucun parent.
          const m = ch.before as ArgumentMap;
          const need = !m.kind || m.kind === 'book' ? ch.id : m.kind === 'movement' ? m.bookId : null;
          if (need && !data.books.some((b) => b.id === need)) {
            skipped++;
            continue;
          }
        } else {
          item = fitChild(c, item, data);
          if (item == null) {
            skipped++;
            continue;
          }
        }
        if (applyChange(data, { ...ch, before: item }, 'undo') === 'ok') restoredKeys.push({ col: c, id: ch.id });
      } else if (ch.before != null && ch.after != null) {
        const st = applyChange(data, ch, 'undo');
        if (st === 'ok') restoredKeys.push({ col: c, id: ch.id });
        else if (st === 'missing') {
          // L'élément à recompléter est lui-même dans la corbeille : on complète sa copie.
          data.trash = data.trash.map((t) => {
            let hit = false;
            const changes = t.changes.map((x) => {
              if (x.col !== ch.col || x.id !== ch.id || x.after != null || x.before == null) return x;
              hit = true;
              return { ...x, before: revert(x.before, ch.before, ch.after) };
            });
            return hit ? { ...t, changes } : t;
          });
        }
      }
    }
    recascade(data);
    // Références vers des éléments supprimés définitivement depuis : retirées.
    const inTrash = (k: TrashKind, id: string) => !!findInTrash(data.trash, colOfKind(k), id);
    const sub: Data = { ...data } as Data;
    for (const c of TRACKED) {
      if (c === 'maps') {
        const keys = new Set(restoredKeys.filter((k) => k.col === 'maps').map((k) => k.id));
        sub.maps = Object.fromEntries(Object.entries(data.maps).filter(([k]) => keys.has(k)));
      } else {
        const ids = new Set(restoredKeys.filter((k) => k.col === c).map((k) => k.id));
        (sub as any)[c] = (data as any)[c].filter((x: { id: string }) => ids.has(x.id));
      }
    }
    let cleaned: Data = data;
    for (const g of danglingRefs(sub, data, inTrash)) cleaned = cascade(cleaned, g.kind, g.id);
    for (const c of TRACKED) (data as any)[c] = (cleaned as any)[c];

    nextMeta = {
      action: 'restore',
      kind: entry.kind,
      refId: entry.refId,
      title: entry.title,
      bookId: entry.bookId,
      summary: skipped ? `Restauré en partie : ${skipped} élément${skipped > 1 ? 's' : ''} lié${skipped > 1 ? 's' : ''} n’existe${skipped > 1 ? 'nt' : ''} plus` : entry.detail ? `Restauré ${entry.detail.charAt(0).toLowerCase()}${entry.detail.slice(1)}` : 'Restauré',
      trashId: entry.id,
    };
    set(data as Partial<State>);
    dropActionToasts();
    const message = skipped
      ? `« ${entry.title} » restauré, sauf ${skipped} élément${skipped > 1 ? 's' : ''} lié${skipped > 1 ? 's' : ''} qui n’existe${skipped > 1 ? 'nt' : ''} plus`
      : `« ${entry.title} » restauré`;
    if (!opts.silent) get().toast(message, 'success');
    return { ok: true, message };
  },

  async purgeTrash(entryIds, reason = entryIds ? 'manual' : 'empty') {
    flushNow();
    const s = get();
    const list = entryIds ? s.trash.filter((t) => entryIds.includes(t.id)) : s.trash;
    if (!list.length) return 0;
    const gone = new Set(list.map((t) => t.id));
    // 1. Retirer les entrées et enregistrer la base AVANT d'effacer les fichiers :
    //    une coupure entre les deux laisse au pire un fichier orphelin, jamais un livre sans fichier.
    quiet++;
    try {
      set({ trash: s.trash.filter((t) => !gone.has(t.id)) });
    } finally {
      quiet--;
    }
    // Plus aucune annulation ne doit pouvoir faire revenir un élément effacé.
    undoStack = [];
    redoStack = [];
    // Base non enregistrée (échec d'écriture) : on garde les fichiers. Un fichier orphelin ne gêne
    // rien ; un élément de la base sans son fichier serait perdu.
    const saved = await writeDb(pickDb(get()));
    // 2. Fichiers : jamais ceux d'un élément présent ou encore dans la corbeille.
    for (const t of saved ? list : [])
      for (const f of t.files) {
        const st = get();
        const inUse =
          st.books.some((b) => b.id === f.ownerId) ||
          st.drafts.some((d) => d.id === f.ownerId) ||
          st.trash.some((o) => o.files.some((g) => g.ownerId === f.ownerId));
        if (inUse) continue;
        try {
          await host.deleteFile(f.ownerId, f.fileName);
        } catch (e) {
          console.warn('deleteFile', e);
        }
      }
    const one = list.length === 1 ? list[0] : null;
    get().logActivity({
      action: 'purge',
      kind: one ? one.kind : 'file',
      refId: one ? one.refId : null,
      bookId: one ? one.bookId : null,
      title: one ? one.title : `${list.length} éléments`,
      summary: reason === 'expired' ? `Effacé après ${TRASH_DAYS} jours dans la corbeille` : reason === 'empty' ? 'Corbeille vidée' : 'Supprimé définitivement',
    });
    return list.length;
  },

  async purgeExpiredTrash() {
    const limit = Date.now() - TRASH_MS;
    const ids = get()
      .trash.filter((t) => !(t.deletedAt > limit))
      .map((t) => t.id);
    return ids.length ? get().purgeTrash(ids, 'expired') : 0;
  },

  // ── Annuler / rétablir ─────────────────────────────────────
  undo() {
    flushNow();
    dropActionToasts();
    for (let tx = undoStack.pop(); tx; tx = undoStack.pop()) {
      if (!applyChanges(tx.changes, 'undo')) continue;
      redoStack.push(tx);
      get().logActivity(historyEntry(tx, 'Annulé'));
      get().toast(`Annulé : ${tx.label}`, 'info', { label: 'Rétablir', run: () => get().redo() });
      return true;
    }
    get().toast('Rien à annuler');
    return false;
  },
  redo() {
    flushNow();
    dropActionToasts();
    for (let tx = redoStack.pop(); tx; tx = redoStack.pop()) {
      if (!applyChanges(tx.changes, 'redo')) continue;
      undoStack.push(tx);
      get().logActivity(historyEntry(tx, 'Rétabli'));
      get().toast(`Rétabli : ${tx.label}`, 'info', { label: 'Annuler', run: () => get().undo() });
      return true;
    }
    get().toast('Rien à rétablir');
    return false;
  },

  revertActivity(entryId) {
    flushNow();
    const s = get();
    const e = s.activity.find((x) => x.id === entryId);
    const fail = (message: string) => {
      get().toast(message, 'error');
      return { ok: false, message };
    };
    if (!e) return fail('Cette entrée n’existe plus.');
    // Suppression → restaurer depuis la corbeille.
    if (e.action === 'delete' && e.trashId) {
      if (!s.trash.some((t) => t.id === e.trashId)) return fail(`« ${e.title} » a été supprimé définitivement : il ne peut plus revenir.`);
      return get().restoreFromTrash(e.trashId);
    }
    // Création, import, restauration → remettre à la corbeille ce qui existe encore.
    if ((e.action === 'create' || e.action === 'import' || e.action === 'restore') && TRASHABLE.has(e.kind) && !e.changes) {
      const kind = e.kind as TrashKind;
      const ids = (e.refIds ?? (e.refId ? [e.refId] : [])).filter((id) => (s as any)[colOfKind(kind)].some((x: { id: string }) => x.id === id));
      if (!ids.length) return fail('Ces éléments n’existent plus.');
      for (const id of ids) get().trashDelete(kind, id, { silent: ids.length > 1 });
      if (ids.length > 1) get().toast(`${ids.length} éléments placés dans la corbeille`, 'info');
      return { ok: true, message: 'Placé dans la corbeille' };
    }
    if (!e.changes?.length) return fail('Cette action ne peut pas être défaite.');
    const done = applyChanges(e.changes, 'undo', true, {
      action: 'revert',
      kind: e.kind,
      refId: e.refId,
      bookId: e.bookId,
      title: e.title,
      summary: `Défait : « ${e.summary} »`,
    });
    if (!done) return fail('Rien à changer : l’élément est déjà dans cet état, ou n’existe plus.');
    get().toast(`« ${e.title} » est revenu à l’état d’avant`, 'success');
    return { ok: true, message: 'Revenu à l’état d’avant' };
  },

  logActivity(e) {
    const s = get();
    rawSet({ activity: mergeActivity(s.activity, [e], Date.now(), s, uid) });
  },

  applyExternal(update, log) {
    flushNow();
    const patch = update(get());
    if (patch && Object.keys(patch).length) {
      quiet++;
      try {
        set(patch as Partial<State>);
      } finally {
        quiet--;
      }
    }
    if (log) get().logActivity(log);
  },
})));

function historyEntry(tx: Tx, verb: string): Omit<ActivityEntry, 'id' | 'at' | 'startedAt'> {
  const c = tx.changes.find((x) => x.col !== 'trash') ?? tx.changes[0];
  const col = (c?.col === 'trash' ? 'books' : c?.col) as TrackedCollection;
  const item = (c?.after ?? c?.before) as any;
  const s = useStore.getState();
  return {
    action: 'revert',
    kind: c && c.col !== 'trash' ? COL_KIND[col] : 'file',
    refId: c && c.col !== 'trash' ? c.id : null,
    bookId: c && c.col !== 'trash' ? bookIdOf(col, item, s) : null,
    title: c && c.col !== 'trash' ? titleOf(col, item, s) : tx.label,
    summary: `${verb} (${fmtKeys(verb === 'Annulé' ? '⌘Z' : '⇧⌘Z')}) : ${tx.label}`,
  };
}

/** Journalise un export d'après le toast de confirmation (tous les modules en affichent un). */
function logExport(message: string) {
  const s = useStore.getState();
  const r = s.route;
  let kind: ActivityEntry['kind'] = 'file';
  let refId: string | null = null;
  let title = message.replace(/^.*?:\s*/, '') || 'Export';
  let bookId: string | null = null;
  if (r.name === 'write' && r.draftId) {
    const d = s.drafts.find((x) => x.id === r.draftId);
    if (d) [kind, refId, title] = ['draft', d.id, d.title];
  } else if (r.name === 'reader') {
    const b = s.books.find((x) => x.id === r.bookId);
    if (b) [kind, refId, title, bookId] = ['book', b.id, b.title, b.id];
  } else if (r.name === 'concepts' && r.conceptId) {
    const c = s.concepts.find((x) => x.id === r.conceptId);
    if (c) [kind, refId, title] = ['concept', c.id, c.name];
  }
  s.logActivity({ action: 'export', kind, refId, bookId, title, summary: message });
}

// ── Persistance (écriture différée) ──────────────────────────
// Seuls les changements de données relancent l'attente (pas les toasts ni la navigation),
// et l'écriture n'attend jamais plus de 2 s : une suite de changements ne peut plus la repousser indéfiniment.
const PERSISTED: (keyof Database)[] = ['books', 'highlights', 'concepts', 'maps', 'arguments', 'studies', 'plans', 'drafts', 'cards', 'workspaces', 'groups', 'wsItems', 'bookmarks', 'settings', 'trash', 'activity', 'mapVersions'];
// Une écriture échouée est retentée (5 s) ; l'utilisateur est prévenu au plus une fois par minute.
// La fermeture de la fenêtre, l'export et la restauration d'une sauvegarde demandent d'abord une
// écriture immédiate (flushPendingSave), précédée de celles des modules inscrits (registerFlusher).
const SAVE_DEBOUNCE_MS = 350;
const SAVE_MAX_WAIT_MS = 2000;
const SAVE_RETRY_MS = 5000;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savePendingSince = 0;
let lastSaved = '';
let lastSaveErrorToast = 0;
/** Base illisible au démarrage : rien n'est écrit pendant la session (pour ne rien écraser). */
let persistBlocked = false;
const flushers = new Set<() => unknown>();

/** Inscrit une écriture à faire avant la fermeture (ex. : l'éditeur et son enregistrement différé). */
export function registerFlusher(fn: () => unknown): () => void {
  flushers.add(fn);
  return () => void flushers.delete(fn);
}

function itemCount(db: Database): number {
  let n = 0;
  for (const v of Object.values(db)) if (Array.isArray(v)) n += v.length;
  return n;
}

/** Écrit la base ; renvoie false si rien n'a été écrit (échec ou écriture suspendue). */
async function writeDb(db: Database, json = serializeDb(db)): Promise<boolean> {
  if (persistBlocked) return false;
  try {
    if (host.saveDbJson) await host.saveDbJson(json, { version: db.version, items: itemCount(db) });
    else await host.saveDb(db);
    lastSaved = json;
    return true;
  } catch (e) {
    lastSaved = '';
    console.error('saveDb', e);
    void host.diag?.('enregistrement-echoue', String((e as Error)?.message ?? e));
    if (Date.now() - lastSaveErrorToast > 60_000) {
      lastSaveErrorToast = Date.now();
      useStore.getState().toast('Enregistrement impossible pour l’instant : vos modifications restent affichées, Marginalia réessaie.', 'error');
    }
    return false;
  }
}

// Sérialisation incrémentale : les collections du store sont immuables (chaque modification en crée
// une nouvelle copie), on garde donc le JSON de chacune tant que sa référence ne change pas. Taper une
// note ne resérialise plus que sa collection au lieu de toute la base (plusieurs Mo avec des milliers
// d'extraits) ; le résultat est identique, octet pour octet, à JSON.stringify(db).
const jsonParts = new Map<string, { ref: unknown; json: string | undefined }>();
// Même principe à l'intérieur des tableaux : le JSON de chaque élément (objet immuable) est gardé ;
// modifier un extrait parmi des milliers ne resérialise que lui.
const itemJson = new WeakMap<object, string>();
function stringifyValue(v: unknown): string | undefined {
  if (!Array.isArray(v)) return JSON.stringify(v);
  let out = '[';
  for (let i = 0; i < v.length; i++) {
    const e: unknown = v[i];
    let j: string | undefined;
    if (e !== null && typeof e === 'object' && !Array.isArray(e)) {
      j = itemJson.get(e);
      if (j === undefined) {
        j = JSON.stringify(e);
        itemJson.set(e, j);
      }
    } else j = JSON.stringify(e);
    out += (i ? ',' : '') + (j ?? 'null'); // comme JSON.stringify : undefined/fonction → null
  }
  return out + ']';
}
function serializeDb(db: Database): string {
  let out = '{';
  let first = true;
  for (const k of Object.keys(db)) {
    const v = (db as unknown as Record<string, unknown>)[k];
    let part = jsonParts.get(k);
    if (!part || part.ref !== v) {
      // 1re écriture (démarrage) : sérialisation d'un bloc, plus rapide ; le détail par élément
      // ne sert qu'aux écritures suivantes.
      part = { ref: v, json: part ? stringifyValue(v) : JSON.stringify(v) };
      jsonParts.set(k, part);
    }
    if (part.json === undefined) continue; // comme JSON.stringify : clé omise (undefined, fonction)
    out += (first ? '' : ',') + JSON.stringify(k) + ':' + part.json;
    first = false;
  }
  return out + '}';
}

async function saveIfChanged(): Promise<boolean> {
  const db = pickDb(useStore.getState());
  const json = serializeDb(db);
  if (json === lastSaved) return true;
  return writeDb(db, json);
}

function scheduleSave() {
  const now = performance.now();
  if (saveTimer) clearTimeout(saveTimer);
  else savePendingSince = now;
  const wait = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, savePendingSince + SAVE_MAX_WAIT_MS - now));
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveIfChanged().then((ok) => {
      if (!ok && !persistBlocked) setTimeout(() => !saveTimer && scheduleSave(), SAVE_RETRY_MS);
    });
  }, wait);
}

/** Écrit immédiatement tout ce qui attend (modules inscrits, puis la base). */
export async function flushPendingSave(): Promise<void> {
  for (const f of [...flushers]) {
    try {
      await f();
    } catch (e) {
      console.warn('flush', e);
    }
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (useStore.getState().ready) await saveIfChanged();
}

useStore.subscribe((s, prev) => {
  if (!s.ready) return;
  if (prev.ready && PERSISTED.every((k) => s[k] === prev[k])) return;
  scheduleSave();
});

// ── Sélecteurs utilitaires ───────────────────────────────────
export const selectBook = (id: string | null) => (s: State) => (id ? (s.books.find((b) => b.id === id) ?? null) : null);
export const selectBookHighlights = (bookId: string) => (s: State) => s.highlights.filter((h) => h.bookId === bookId);
export const selectBookBookmarks = (bookId: string) => (s: State) => s.bookmarks.filter((b) => b.bookId === bookId);
