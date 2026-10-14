// ─────────────────────────────────────────────────────────────
// Store global v2 (FIGÉ pour l'API publique ; l'intégrateur seul l'étend).
// Pour sélectionner un tableau / objet dérivé : useStore(useShallow(sel)).
// ─────────────────────────────────────────────────────────────
import { create } from 'zustand';
import type {
  ArgumentMap,
  Book,
  CategoryId,
  CollectionName,
  Concept,
  Database,
  Edition,
  Highlight,
  Route,
  Settings,
  Workspace,
  WorkspaceGroup,
  WorkspaceItem,
  WorkspaceItemKind,
} from './types';
import { host, type PickedFile, extOf } from './platform';
import { extractMetadata } from '../features/library/metadata';

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
  settings: { ...DEFAULT_SETTINGS },
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

type Item<C extends CollectionName> = Database[C][number];

export interface State extends Database {
  ready: boolean;
  route: Route;
  activeHighlightId: string | null;
  jump: JumpRequest | null;
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
  importFiles(files: PickedFile[]): Promise<Book[]>;
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

  // ── Écrits ──
  removeDraft(id: string): Promise<void>;

  updateSettings(patch: Partial<Settings>): void;
}

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
  settings: s.settings,
});

export const useStore = create<State>((set, get) => ({
  ...emptyDb(),
  ready: false,
  route: { name: 'home' },
  activeHighlightId: null,
  jump: null,
  importing: 0,
  toasts: [],
  commandOpen: false,

  async init() {
    let db: Database | null = null;
    try {
      db = await host.loadDb();
    } catch (e) {
      console.error(e);
    }
    set({ ...migrate(db), ready: true });
    host.onOpenFiles((files) => {
      get()
        .importFiles(files)
        .then((books) => {
          if (books.length === 1) get().openBook(books[0].id);
        });
    });
  },

  navigate(route) {
    set({ route, activeHighlightId: null });
  },
  setCommandOpen(open) {
    set({ commandOpen: open });
  },
  toast(message, tone = 'info', action) {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { id, message, tone, action }] }));
    setTimeout(() => get().dismissToast(id), action ? 6000 : 3600);
  },
  dismissToast(id) {
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
    set((s) => ({ [col]: (s[col] as any[]).filter((x) => x.id !== id) }) as Partial<State>);
  },

  async importFiles(files) {
    const added: Book[] = [];
    set((s) => ({ importing: s.importing + files.length }));
    for (const f of files) {
      try {
        const meta = await extractMetadata(f);
        const id = uid();
        const ext = extOf(f.name);
        const fileName = `source.${ext || 'bin'}`;
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
        set((s) => ({ books: [book, ...s.books] }));
        // Ajout automatique à l'espace actif
        const ws = get().settings.activeWorkspaceId;
        if (ws && get().workspaces.some((w) => w.id === ws)) get().addToWorkspace(ws, null, 'book', id);
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
    return added;
  },

  updateBook(id, patch) {
    set((s) => ({ books: s.books.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  },

  async removeBook(id) {
    const book = get().books.find((b) => b.id === id);
    if (!book) return;
    try {
      await host.deleteFile(id, book.fileName);
    } catch (e) {
      console.warn(e);
    }
    set((s) => {
      const maps = { ...s.maps };
      delete maps[id];
      const hlIds = new Set(s.highlights.filter((h) => h.bookId === id).map((h) => h.id));
      return {
        books: s.books.filter((b) => b.id !== id),
        highlights: s.highlights.filter((h) => h.bookId !== id),
        maps,
        studies: s.studies.filter((x) => x.bookId !== id),
        cards: s.cards.filter((c) => c.bookId !== id && !(c.highlightId && hlIds.has(c.highlightId))),
        wsItems: s.wsItems.filter((i) => !((i.kind === 'book' || i.kind === 'map') && i.refId === id)),
      };
    });
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
      highlights: s.highlights.map((h) => (h.id === id ? { ...h, ...patch, updatedAt: Date.now() } : h)),
    }));
  },
  removeHighlight(id) {
    set((s) => {
      const maps: Record<string, ArgumentMap> = {};
      for (const [k, m] of Object.entries(s.maps)) {
        const removed = new Set(m.nodes.filter((n) => n.highlightId === id).map((n) => n.id));
        maps[k] = removed.size
          ? {
              ...m,
              nodes: m.nodes.filter((n) => !removed.has(n.id)),
              edges: m.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
            }
          : m;
      }
      const stripPlan = (nodes: any[]): any[] =>
        nodes.map((n) => ({
          ...n,
          items: n.items.filter((it: any) => !(it.ref.kind === 'highlight' && it.ref.id === id)),
          children: stripPlan(n.children),
        }));
      return {
        highlights: s.highlights.filter((h) => h.id !== id),
        maps,
        cards: s.cards.filter((c) => c.highlightId !== id),
        plans: s.plans.map((p) => ({ ...p, parts: stripPlan(p.parts) })),
        arguments: s.arguments.map((a) => ({
          ...a,
          premises: a.premises.map((p) => (p.highlightId === id ? { ...p, highlightId: null } : p)),
          conclusion: a.conclusion.highlightId === id ? { ...a.conclusion, highlightId: null } : a.conclusion,
        })),
        concepts: s.concepts.map((c) => ({
          ...c,
          senses: c.senses.map((se) => ({ ...se, highlightIds: se.highlightIds.filter((x) => x !== id) })),
        })),
        activeHighlightId: s.activeHighlightId === id ? null : s.activeHighlightId,
      };
    });
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
    set((s) => ({
      concepts: s.concepts
        .filter((c) => c.id !== id)
        .map((c) => (c.links.some((l) => l.conceptId === id) ? { ...c, links: c.links.filter((l) => l.conceptId !== id) } : c)),
      highlights: s.highlights.map((h) => (h.conceptIds.includes(id) ? { ...h, conceptIds: h.conceptIds.filter((x) => x !== id) } : h)),
      cards: s.cards.filter((c) => c.conceptId !== id),
    }));
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
    set((s) => ({
      workspaces: s.workspaces.filter((w) => w.id !== id),
      groups: s.groups.filter((g) => g.workspaceId !== id),
      wsItems: s.wsItems.filter((i) => i.workspaceId !== id),
      settings: s.settings.activeWorkspaceId === id ? { ...s.settings, activeWorkspaceId: null } : s.settings,
    }));
  },
  createGroup(workspaceId, parentId, name) {
    const siblings = get().groups.filter((g) => g.workspaceId === workspaceId && g.parentId === parentId);
    const g: WorkspaceGroup = { id: uid(), workspaceId, parentId, name: name.trim() || 'Nouveau groupe', order: siblings.length, collapsed: false };
    set((s) => ({ groups: [...s.groups, g] }));
    return g;
  },
  removeGroup(id) {
    const g = get().groups.find((x) => x.id === id);
    if (!g) return;
    set((s) => ({
      groups: s.groups.filter((x) => x.id !== id).map((x) => (x.parentId === id ? { ...x, parentId: g.parentId } : x)),
      wsItems: s.wsItems.map((i) => (i.groupId === id ? { ...i, groupId: g.parentId } : i)),
    }));
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
    set((s) => ({ wsItems: s.wsItems.filter((i) => i.id !== itemId) }));
  },

  async removeDraft(id) {
    const d = get().drafts.find((x) => x.id === id);
    if (!d) return;
    try {
      await host.deleteFile(id, d.fileName);
    } catch (e) {
      console.warn(e);
    }
    set((s) => ({
      drafts: s.drafts.filter((x) => x.id !== id),
      wsItems: s.wsItems.filter((i) => !(i.kind === 'draft' && i.refId === id)),
      plans: s.plans.map((p) => (p.draftId === id ? { ...p, draftId: null } : p)),
    }));
  },

  updateSettings(patch) {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
  },
}));

// ── Persistance (écriture différée) ──────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaved = '';
useStore.subscribe((s) => {
  if (!s.ready) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const db = pickDb(useStore.getState());
    const json = JSON.stringify(db);
    if (json === lastSaved) return;
    lastSaved = json;
    host.saveDb(db).catch((e) => console.error('saveDb', e));
  }, 350);
});

// ── Sélecteurs utilitaires ───────────────────────────────────
export const selectBook = (id: string | null) => (s: State) => (id ? (s.books.find((b) => b.id === id) ?? null) : null);
export const selectBookHighlights = (bookId: string) => (s: State) => s.highlights.filter((h) => h.bookId === bookId);
