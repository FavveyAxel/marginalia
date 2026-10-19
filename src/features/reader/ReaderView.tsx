// Coquille du lecteur (intégrateur) : moteur(s), panneaux, popovers, côte à côte, fiche-texte.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ALargeSmall, Bookmark as BookmarkIcon, ChevronLeft, Columns2, Download, PanelLeft, PanelRight, Search, X } from 'lucide-react';
import { useStore, selectBook, uid } from '../../lib/store';
import { host } from '../../lib/platform';
import type { Book, Bookmark, Highlight, Movement, ReaderPosition, Route, TextStudy, TocItem } from '../../lib/types';
import type { BookmarkPoint, EngineHandle, EngineProps, NewHighlightInput, NewMovementInput } from './engine';
import { HtmlReader } from './html/HtmlReader';
import { PdfReader } from './pdf/PdfReader';
import { ImageReader } from './image/ImageReader';
import { TocPanel, type ProgressMark } from './TocPanel';
import { BookmarkPopover, BookmarksPanel, addBookmarkAt, bookmarkCommands, bookmarkKey, type BmPopoverState } from './bookmarks/BookmarkUi';
import { bookmarkColor } from './bookmarks/bookmarks';
import { isTextEditingTarget } from '../history/keys';
import { SearchBar } from './SearchBar';
import { TypographyPopover } from './TypographyPopover';
import { ExtractsPanel } from '../annotations/ExtractsPanel';
import { HighlightPopover } from '../annotations/HighlightPopover';
import { StudyPanel } from '../study/StudyPanel';
import { ReaderMapTab } from '../map/ui/stage/ReaderMapTab';
import { BookCover } from '../library/BookCover';
import { bookToMarkdown } from '../../lib/exportMarkdown';
import { PageSkeleton, useFloating } from '../../components/ui';
import './reader.css';
import { RESUME_EVENT, type PendingResume } from '../library/appleBooksAnnotations';
import { fmtKeys, isMac, isMod, matchKeys } from '../../lib/keys';
import { PAGE_JUMP_KEY, PageJumpField, type PageRequest, type ReturnPoint } from './PageJump';
import { GOTO_PAGE_EVENT, type PageStatus } from './pages';
import { ReaderCursors } from './ReaderCursors';

// ── Rendus : le lecteur reste fluide pendant la lecture et la sélection ──
// Chaque sauvegarde de position (toutes les ~800 ms en défilant) et chaque progression remontée
// par un moteur re-rendaient toute la coquille : moteur(s), toutes les pages PDF, la liste des
// extraits et la fiche-texte. Les panneaux et moteurs sont donc mémoïsés, reçoivent des rappels
// stables et un `book` qui ne change pas quand seule la position change.
const MemoHtmlReader = memo(HtmlReader);
const MemoPdfReader = memo(PdfReader);
const MemoImageReader = memo(ImageReader);
const MemoExtractsPanel = memo(ExtractsPanel);
const MemoStudyPanel = memo(StudyPanel);
const MemoTocPanel = memo(TocPanel);
const MemoBookmarksPanel = memo(BookmarksPanel);

/** Bouton principal enfoncé (glissé de sélection en cours) : les sauvegardes de position attendent. */
let pointerHeld = false;
/** Instant du dernier relâchement : la barre de sélection apparaît juste après, rien ne doit la retarder. */
let pointerUpAt = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => e.button === 0 && (pointerHeld = true), true);
  const up = () => {
    pointerHeld = false;
    pointerUpAt = performance.now();
  };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  window.addEventListener('blur', () => (pointerHeld = false));
}
/**
 * Moment de sélectionner : glissé en cours ou relâché à l'instant (la barre de sélection apparaît).
 * Une sauvegarde de position à ce moment-là modifie le livre dans le store et re-rend ses abonnés
 * (la liste des extraits entière) juste quand la barre doit s'afficher : elle attend ~½ s
 * (au plus POS_MAX_DEFER_MS au total, pour ne jamais perdre la position).
 */
function selecting(): boolean {
  return pointerHeld || performance.now() - pointerUpAt < 500;
}
const POS_MAX_DEFER_MS = 10_000;

/** Champs de Book que les moteurs n'utilisent pas et qui changent pendant la lecture. */
const VOLATILE_BOOK_KEYS = new Set<keyof Book>(['position', 'progress', 'lastOpenedAt']);
function sameBookForEngine(a: Book, b: Book): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Book)[]);
  for (const k of keys) if (!VOLATILE_BOOK_KEYS.has(k) && a[k] !== b[k]) return false;
  return true;
}
/** Le même objet Book tant que seuls position / progression / date d'ouverture changent. */
function useEngineBook(book: Book | null): Book | null {
  const ref = useRef(book);
  if (!book || !ref.current || !sameBookForEngine(ref.current, book)) ref.current = book;
  return ref.current;
}

interface Props {
  bookId: string;
  tab: 'lecture' | 'carte';
  splitBookId: string | null;
}

type PaneKey = 'a' | 'b';

// Retour depuis le lecteur : vers la vue d'où l'on vient (Extraits, Espace, Accueil…),
// et non toujours vers la Bibliothèque.
let returnRoute: Route = { name: 'library' };
useStore.subscribe((s, prev) => {
  if (s.route.name === 'reader' && prev.route.name !== 'reader') returnRoute = prev.route;
});
const RETURN_LABEL: Record<Exclude<Route['name'], 'reader'>, string> = {
  home: 'Accueil',
  library: 'Bibliothèque',
  import: 'Importer',
  workspace: 'Espace',
  concepts: 'Concepts',
  extracts: 'Extraits',
  arguments: 'Arguments',
  revision: 'Révision',
  plans: 'Plans',
  board: 'Carte',
  maps: 'Cartes',
  write: 'Écrits',
  trash: 'Corbeille',
  inbox: 'Boîte de réception',
  history: 'Historique',
  help: 'Aide',
  settings: 'Réglages',
};
function returnLabel(): string {
  if (returnRoute.name === 'reader') return 'Bibliothèque';
  if (returnRoute.name === 'workspace') {
    const ws = useStore.getState().workspaces.find((w) => w.id === (returnRoute as { workspaceId: string }).workspaceId);
    if (!ws) return 'Bibliothèque';
    return ws.name.length > 22 ? 'Espace' : ws.name;
  }
  return RETURN_LABEL[returnRoute.name];
}
function goBack(navigate: (r: Route) => void) {
  const r = returnRoute;
  const ok =
    r.name !== 'reader' &&
    (r.name !== 'workspace' || useStore.getState().workspaces.some((w) => w.id === r.workspaceId));
  navigate(ok ? r : { name: 'library' });
}

interface PaneState {
  toc: TocItem[];
  label: string;
  progress: number;
  ready: boolean;
}

/** Ajoute un début de mouvement à la fiche-texte du livre (créée au besoin). */
function addMovement(bookId: string, input: NewMovementInput) {
  const s = useStore.getState();
  let study: TextStudy | undefined = [...s.studies].filter((x) => x.bookId === bookId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const now = Date.now();
  if (!study) {
    study = { id: uid(), bookId, title: input.locationLabel || 'Passage étudié', probleme: '', these: '', enjeu: '', movements: [], createdAt: now, updatedAt: now };
    s.insert('studies', study);
  }
  const mv: Movement = {
    id: uid(),
    anchor: input.anchor,
    startText: input.text.slice(0, 80),
    title: `Mouvement ${study.movements.length + 1}`,
    role: '',
  };
  s.patch('studies', study.id, { movements: [...study.movements, mv] });
  s.toast(`${mv.title} marqué`, 'success');
}

/** Volet de lecture (aussi utilisé, en mode compact, dans le panneau de l'éditeur). */
export const ReaderPane = memo(function ReaderPane({
  paneKey,
  bookId,
  focused,
  onFocus,
  engineRef,
  onState,
  onPopover,
  onClose,
  split,
  onCite,
  onBookmarkPopover,
  pageRequest,
}: {
  paneKey: PaneKey;
  bookId: string;
  focused: boolean;
  onFocus(): void;
  engineRef: MutableRefObject<EngineHandle | null>;
  onState(p: Partial<PaneState>): void;
  onPopover(p: { id: string; rect: DOMRect } | null): void;
  onClose?: () => void;
  split: boolean;
  /** « Citer dans l'écrit » (panneau de l'éditeur) : la sélection est citée au curseur. */
  onCite?: (input: NewHighlightInput) => void;
  /** Popover d'un signet (nouveau, ou clic sur son repère). Absent : pas de signets dans ce volet. */
  onBookmarkPopover?: (p: BmPopoverState | null) => void;
  /** « Aller à la page » demandé pour ce volet (⌘⌥G, ⌘K). */
  pageRequest?: PageRequest | null;
}) {
  const book = useStore(selectBook(bookId));
  const highlights = useStore(useShallow((s) => s.highlights.filter((h) => h.bookId === bookId)));
  const movements = useStore(useShallow((s) => s.studies.filter((x) => x.bookId === bookId).flatMap((x) => x.movements)));
  const bookmarks = useStore(useShallow((s) => s.bookmarks.filter((b) => b.bookId === bookId)));
  const settings = useStore((s) => s.settings);
  const activeHighlightId = useStore((s) => s.activeHighlightId);
  const updateBook = useStore((s) => s.updateBook);
  const addHighlight = useStore((s) => s.addHighlight);
  const setActiveHighlight = useStore((s) => s.setActiveHighlight);
  const updateSettings = useStore((s) => s.updateSettings);
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pageStatus, setPageStatus] = useState<PageStatus | null>(null);
  const initialPosition = useMemo(() => book?.position ?? null, [bookId]);
  const engineBook = useEngineBook(book);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const onPopoverRef = useRef(onPopover);
  onPopoverRef.current = onPopover;
  const onCiteRef = useRef(onCite);
  onCiteRef.current = onCite;
  const hasCite = !!onCite;
  const onBmPopRef = useRef(onBookmarkPopover);
  onBmPopRef.current = onBookmarkPopover;
  const hasBookmarks = !!onBookmarkPopover;

  const missing = !!book?.missing;
  useEffect(() => {
    if (!book || missing) return;
    let alive = true;
    setData(null);
    setReady(false);
    host
      .readFile(book.id, book.fileName)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [book?.id, missing]);

  /** Livre reçu sans fichier : on choisit le même livre, qui complète l'entrée (voir importFiles). */
  const importMissing = useCallback(async () => {
    if (!book) return;
    const files = await host.pickFiles();
    if (!files.length) return;
    await useStore.getState().importFiles(files, { toWorkspace: false, asBook: true });
    if (useStore.getState().books.find((b) => b.id === book.id)?.missing)
      useStore.getState().toast('Ce fichier n’est pas le même livre que celui du partage : il a été ajouté à la bibliothèque, mais « ' + book.title + ' » reste sans fichier.', 'error');
  }, [book?.id, book?.title]);

  const lastPos = useRef(0);
  const deferSince = useRef(0);
  const posTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPos = useRef<(() => void) | null>(null);
  const onPosition = useCallback(
    (pos: ReaderPosition, progress: number, label: string) => {
      onState({ label, progress });
      // Chaque sauvegarde modifie le livre dans le store (et re-rend ses abonnés) : jamais pendant
      // un glissé de sélection, au plus toutes les 1,5 s pendant un défilement continu.
      const save = (force = false) => {
        posTimer.current = null;
        if (!force) {
          deferSince.current ||= Date.now();
          if (selecting() && Date.now() - deferSince.current < POS_MAX_DEFER_MS) {
            posTimer.current = setTimeout(save, 250);
            return;
          }
        }
        deferSince.current = 0;
        pendingPos.current = null;
        lastPos.current = Date.now();
        // lastOpenedAt suit la lecture (pas seulement l'ouverture) : la synchro avec Livres
        // compare cette date à celle de Livres (le plus récent gagne).
        updateBook(bookId, { position: pos, progress, lastOpenedAt: Date.now() });
      };
      pendingPos.current = () => save(true);
      if (posTimer.current) clearTimeout(posTimer.current);
      if (Date.now() - lastPos.current > 1500 && !selecting()) save();
      else posTimer.current = setTimeout(save, 900);
    },
    [bookId],
  );
  // Fermeture du livre : la dernière position n'est pas perdue.
  useEffect(
    () => () => {
      if (posTimer.current) clearTimeout(posTimer.current);
      const p = pendingPos.current;
      pendingPos.current = null;
      if (p) p();
    },
    [bookId],
  );

  const onCreateHighlight = useCallback(
    (input: NewHighlightInput, withNote: boolean): Highlight => {
      const h = addHighlight({ ...input, bookId });
      if (withNote) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const rect = engineRef.current?.getHighlightRect(h.id);
            if (rect) {
              setActiveHighlight(h.id);
              onPopover({ id: h.id, rect });
            }
          }),
        );
      }
      return h;
    },
    [bookId],
  );

  // Rappels stables (les moteurs mémoïsés ne se re-rendent que si leurs données changent).
  const callbacks = useMemo(
    () => ({
      onToc: (toc: TocItem[]) => onStateRef.current({ toc }),
      onCreateMovement: (input: NewMovementInput) => {
        addMovement(bookId, input);
        updateSettings({ rightPanel: 'etude', showExtracts: true });
      },
      onHighlightClick: (id: string, rect: DOMRect) => {
        setActiveHighlight(id);
        onPopoverRef.current({ id, rect });
      },
      onMovementClick: () => updateSettings({ rightPanel: 'etude', showExtracts: true }),
      onBackgroundClick: () => {
        onPopoverRef.current(null);
        if (useStore.getState().activeHighlightId !== null) setActiveHighlight(null);
      },
      onReady: () => {
        setReady(true);
        onStateRef.current({ ready: true });
      },
      onError: (m: string) => setError(m),
      onPage: (st: PageStatus | null) => setPageStatus(st),
      onCite: hasCite ? (input: NewHighlightInput) => onCiteRef.current?.(input) : undefined,
      onBookmarkClick: hasBookmarks ? (id: string, rect: DOMRect) => onBmPopRef.current?.({ id, rect, isNew: false }) : undefined,
      onAddBookmark: hasBookmarks
        ? (point: BookmarkPoint, rect: DOMRect | null) => {
            const b = addBookmarkAt(bookId, point);
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const r = engineRef.current?.getBookmarkRect?.(b.id) ?? rect;
                if (r) onBmPopRef.current?.({ id: b.id, rect: r, isNew: true });
              }),
            );
          }
        : undefined,
    }),
    [bookId, hasCite, hasBookmarks],
  );

  // PDF : le champ « Aller à la page » vit dans la barre de zoom du moteur.
  const pdfRequest = book?.format === 'pdf' ? (pageRequest ?? undefined) : undefined;
  const engineProps: EngineProps | null = useMemo(
    () =>
      engineBook
        ? {
            pageRequest: pdfRequest,
            book: engineBook,
            data: data as ArrayBuffer,
            highlights,
            movements,
            bookmarks,
            activeHighlightId,
            settings,
            initialPosition,
            onPosition,
            onCreateHighlight,
            ...callbacks,
          }
        : null,
    [engineBook, data, highlights, movements, bookmarks, activeHighlightId, settings, initialPosition, onPosition, onCreateHighlight, callbacks, pdfRequest],
  );

  // Demande sans pages repérées (image, document vide) : le dire plutôt que ne rien faire.
  const lastReq = useRef(pageRequest?.nonce ?? 0);
  useEffect(() => {
    if (!pageRequest || pageRequest.nonce === lastReq.current) return;
    lastReq.current = pageRequest.nonce;
    if (ready && !pageStatus && book?.format !== 'pdf') useStore.getState().toast('Ce document n’a pas de numéros de page', 'info');
  }, [pageRequest?.nonce]);

  const goPage = useCallback((q: string): string | null => {
    const go = engineRef.current?.goToPage;
    return go ? go(q) : 'Ce document n’a pas de numéros de page';
  }, []);
  const capturePage = useCallback((): ReturnPoint | null => {
    const eng = engineRef.current;
    const pt = eng?.bookmarkPoint?.();
    if (!eng || !pt) return null;
    const label = eng.pageStatus?.()?.label ?? '';
    return {
      label,
      back: () =>
        engineRef.current?.goToBookmark?.({ id: 'page-return', bookId, position: pt.position, anchor: pt.anchor, excerpt: pt.excerpt, progress: pt.progress, label: pt.label, createdAt: 0 }),
    };
  }, [bookId]);

  if (!book || !engineProps) return null;

  return (
    <section className={`panel reader-page ${split && focused ? 'is-focused' : ''}`} onMouseDownCapture={onFocus} data-pane={paneKey}>
      {split && (
        <div className="reader-pane-head">
          <BookCover book={book} size="xs" />
          <span className="truncate">{book.title}</span>
          {onClose && (
            <button className="icon-btn sm" onClick={onClose} title="Fermer ce volet">
              <X size={14} />
            </button>
          )}
        </div>
      )}
      <div className="reader-pane-body">
        {missing ? (
          <div className="empty" style={{ height: '100%' }} data-testid="reader-missing">
            <h3>Ce livre est arrivé sans son fichier</h3>
            <p>Il a été reçu par un partage, sans le fichier du livre : ses extraits et ses notes se lisent, mais le texte ne peut pas s’afficher. Importez le même livre (le même fichier) pour le compléter : tout ce qui a été reçu s’y rattachera.</p>
            <button className="btn btn-primary" onClick={() => void importMissing()} data-testid="reader-import-missing">
              Importer le livre…
            </button>
          </div>
        ) : error ? (
          <div className="empty" style={{ height: '100%' }}>
            <h3>Lecture impossible</h3>
            <p>{error}</p>
          </div>
        ) : !data ? (
          <PageSkeleton />
        ) : book.format === 'pdf' ? (
          <MemoPdfReader ref={engineRef} {...engineProps} />
        ) : book.format === 'image' ? (
          <MemoImageReader ref={engineRef} {...engineProps} />
        ) : (
          <MemoHtmlReader ref={engineRef} {...engineProps} />
        )}
        {ready && !error && data && <ReaderCursors bookId={book.id} format={book.format} pageLabel={pageStatus?.label ?? ''} />}
        {ready && !error && book.format !== 'pdf' && pageStatus && (
          <div className="reader-pagejump-host">
            <PageJumpField status={pageStatus} onGo={goPage} capture={capturePage} request={pageRequest} variant="pill" />
          </div>
        )}
        {!ready && data && !error && (
          <div className="reader-loading overlay">
            <PageSkeleton />
          </div>
        )}
      </div>
    </section>
  );
});

function SplitPicker({ anchor, currentId, onPick, onClose }: { anchor: DOMRect; currentId: string; onPick(id: string): void; onClose(): void }) {
  const books = useStore((s) => s.books);
  const [ref, style] = useFloating(anchor, 'below');
  const [q, setQ] = useState('');
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.split-picker')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  const norm = (x: string) => x.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const list = [...books]
    .sort((a, b) => (a.id === currentId ? -1 : b.id === currentId ? 1 : (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)))
    // Un livre papier n'a pas de texte à afficher côte à côte.
    .filter((b) => b.format !== 'paper' && (!q || norm(b.title + ' ' + b.author).includes(norm(q))))
    .slice(0, 12);
  return (
    <div ref={ref} className="floating split-picker" style={{ ...style, width: 320 }}>
      <div style={{ padding: 8 }}>
        <input className="input" autoFocus placeholder="Comparer avec…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ maxHeight: 340, overflow: 'auto', padding: '0 6px 6px' }}>
        {list.map((b) => (
          <button key={b.id} className="menu-item" style={{ height: 40 }} onClick={() => onPick(b.id)}>
            <BookCover book={b} size="xs" />
            <span className="truncate" style={{ flex: 1 }}>
              {b.id === currentId ? `${b.title} (autre passage)` : b.title}
            </span>
            <span className="muted truncate" style={{ maxWidth: 90, fontSize: 'var(--fs-sm)' }}>
              {b.author}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReaderView({ bookId, tab, splitBookId }: Props) {
  // Seuls le titre et l'auteur s'affichent ici : pas de re-rendu à chaque sauvegarde de position.
  const book = useStore(useShallow((s) => {
    const b = selectBook(bookId)(s);
    return b ? { title: b.title, author: b.author, format: b.format } : null;
  }));
  const settings = useStore((s) => s.settings);
  const jump = useStore((s) => s.jump);
  const bookmarkJump = useStore((s) => s.bookmarkJump);
  const navigate = useStore((s) => s.navigate);
  const setActiveHighlight = useStore((s) => s.setActiveHighlight);
  const updateSettings = useStore((s) => s.updateSettings);

  const engineA = useRef<EngineHandle | null>(null);
  const engineB = useRef<EngineHandle | null>(null);
  const [focus, setFocus] = useState<PaneKey>('a');
  const [panes, setPanes] = useState<Record<PaneKey, PaneState>>({
    a: { toc: [], label: '', progress: selectBook(bookId)(useStore.getState())?.progress ?? 0, ready: false },
    b: { toc: [], label: '', progress: 0, ready: false },
  });
  const [popover, setPopover] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [typoAnchor, setTypoAnchor] = useState<DOMRect | null>(null);
  const [splitAnchor, setSplitAnchor] = useState<DOMRect | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bmPop, setBmPop] = useState<BmPopoverState | null>(null);
  const [pageReq, setPageReq] = useState<(PageRequest & { pane: PaneKey }) | null>(null);
  const bmBtnRef = useRef<HTMLButtonElement>(null);

  const split = !!splitBookId && tab === 'lecture';
  const activeKey: PaneKey = split ? focus : 'a';
  const activeBookId = activeKey === 'b' && splitBookId ? splitBookId : bookId;
  const activeEngine = activeKey === 'b' ? engineB : engineA;
  const pane = panes[activeKey];
  const activeFormat = useStore((s) => s.books.find((b) => b.id === activeBookId)?.format);
  const canBookmark = tab === 'lecture' && !!activeFormat && activeFormat !== 'image';
  const bookmarks = useStore(useShallow((s) => s.bookmarks.filter((b) => b.bookId === activeBookId)));
  // Signet à l'endroit lu : recalculé à chaque position remontée par le moteur (pane.progress / label).
  const atView = canBookmark && pane.ready ? (activeEngine.current?.bookmarkAtView?.(bookmarks) ?? null) : null;
  const tocMarks = useMemo<ProgressMark[]>(
    () => bookmarks.filter((b) => typeof b.progress === 'number').map((b) => ({ id: b.id, progress: b.progress!, label: b.label, color: bookmarkColor(b.color) })),
    [bookmarks],
  );

  // Pas de nouvel état si rien ne change (les moteurs remontent souvent la même position).
  const updatePane = useCallback(
    (k: PaneKey) => (p: Partial<PaneState>) =>
      setPanes((s) => {
        const cur = s[k];
        if ((Object.keys(p) as (keyof PaneState)[]).every((key) => Object.is(cur[key], p[key]))) return s;
        return { ...s, [k]: { ...cur, ...p } };
      }),
    [],
  );
  const onStateA = useMemo(() => updatePane('a'), []);
  const onStateB = useMemo(() => updatePane('b'), []);
  const focusA = useCallback(() => setFocus('a'), []);
  const focusB = useCallback(() => setFocus('b'), []);
  const activeEngineRef = useRef(activeEngine);
  activeEngineRef.current = activeEngine;
  const onTocSelect = useCallback((item: TocItem) => activeEngineRef.current.current?.goTo(item.target), []);
  const onJumpExtract = useCallback((id: string) => {
    const h = useStore.getState().highlights.find((x) => x.id === id);
    if (h) {
      setActiveHighlight(id);
      activeEngineRef.current.current?.goToHighlight(h);
    }
  }, []);
  const onStudyGoTo = useCallback((anchor: Highlight['anchor']) => activeEngineRef.current.current?.goToAnchor(anchor), []);
  const activeBookIdRef = useRef(activeBookId);
  activeBookIdRef.current = activeBookId;
  const bmCmd = useMemo(
    () =>
      bookmarkCommands(
        () => ({ bookId: activeBookIdRef.current, engine: activeEngineRef.current.current }),
        setBmPop,
        () => bmBtnRef.current?.getBoundingClientRect() ?? null,
      ),
    [],
  );
  const onGoBookmark = useCallback((b: Bookmark) => activeEngineRef.current.current?.goToBookmark?.(b), []);
  const onAddBookmark = useCallback(() => bmCmd.toggle(), [bmCmd]);
  const onTocMark = useCallback((id: string) => {
    const b = useStore.getState().bookmarks.find((x) => x.id === id);
    if (b) activeEngineRef.current.current?.goToBookmark?.(b);
  }, []);
  const closeSplit = useCallback(() => {
    setFocus('a');
    const r = useStore.getState().route;
    if (r.name === 'reader') navigate({ name: 'reader', bookId: r.bookId, tab: r.tab, splitBookId: null });
  }, []);

  // Navigation demandée vers un extrait
  useEffect(() => {
    if (!jump) return;
    const h = useStore.getState().highlights.find((x) => x.id === jump.highlightId);
    if (!h) return;
    const key: PaneKey | null = h.bookId === bookId ? 'a' : split && h.bookId === splitBookId ? 'b' : null;
    if (!key || !panes[key].ready) return;
    if (tab !== 'lecture') navigate({ name: 'reader', bookId, tab: 'lecture', splitBookId });
    (key === 'a' ? engineA : engineB).current?.goToHighlight(h);
    setFocus(key);
  }, [jump?.nonce, panes.a.ready, panes.b.ready]);

  // Retour demandé vers un signet (⌘K, journal)
  const doneBmJump = useRef(0);
  useEffect(() => {
    if (!bookmarkJump || doneBmJump.current === bookmarkJump.nonce) return;
    const b = useStore.getState().bookmarks.find((x) => x.id === bookmarkJump.bookmarkId);
    if (!b) return;
    const key: PaneKey | null = b.bookId === bookId ? 'a' : split && b.bookId === splitBookId ? 'b' : null;
    if (!key || !panes[key].ready) return;
    doneBmJump.current = bookmarkJump.nonce;
    if (tab !== 'lecture') navigate({ name: 'reader', bookId, tab: 'lecture', splitBookId });
    (key === 'a' ? engineA : engineB).current?.goToBookmark?.(b);
    setFocus(key);
  }, [bookmarkJump?.nonce, panes.a.ready, panes.b.ready]);

  // « Reprendre là où vous étiez dans Livres » (toast de la synchro) : aller à cette position.
  useEffect(() => {
    const onResume = (e: Event) => {
      const d = (e as CustomEvent<PendingResume>).detail;
      if (!d) return;
      const key: PaneKey | null = d.bookId === bookId ? 'a' : split && d.bookId === splitBookId ? 'b' : null;
      if (!key) return;
      if (tab !== 'lecture') navigate({ name: 'reader', bookId, tab: 'lecture', splitBookId });
      const pseudo: Bookmark = { id: `livres-${d.bookId}`, bookId: d.bookId, position: d.position, anchor: d.anchor, excerpt: d.excerpt, progress: d.progress, label: 'Livres', createdAt: 0 };
      (key === 'a' ? engineA : engineB).current?.goToBookmark?.(pseudo);
      setFocus(key);
    };
    window.addEventListener(RESUME_EVENT, onResume);
    return () => window.removeEventListener(RESUME_EVENT, onResume);
  }, [bookId, splitBookId, split, tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = isMod(e);
      if (meta && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (meta && e.key === '1') {
        e.preventDefault();
        navigate({ name: 'reader', bookId, tab: 'lecture', splitBookId });
      } else if (meta && e.key === '2') {
        e.preventDefault();
        navigate({ name: 'reader', bookId, tab: 'carte', splitBookId });
      } else if ((meta && e.key === '[') || (!isMac && matchKeys(e, '⌘['))) {
        e.preventDefault();
        goBack(navigate);
      } else if (matchKeys(e, PAGE_JUMP_KEY) && tab === 'lecture') {
        e.preventDefault();
        setPageReq((r) => ({ pane: activeKey, nonce: (r?.nonce ?? 0) + 1 }));
      } else if (bookmarkKey(e) && tab === 'lecture' && !isTextEditingTarget(e.target)) {
        e.preventDefault();
        const k = bookmarkKey(e);
        if (k === 'toggle') bmCmd.toggle();
        else bmCmd.go(k === 'next' ? 1 : -1);
      } else if (e.key === 'Escape' && popover) {
        setPopover(null);
        setActiveHighlight(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bookId, splitBookId, popover, tab, activeKey]);

  // « Aller à la page 45 » depuis la palette ⌘K : volet actif, onglet Lecture.
  useEffect(() => {
    const onGoto = (e: Event) => {
      const q = (e as CustomEvent<{ query?: string }>).detail?.query;
      if (tab !== 'lecture') navigate({ name: 'reader', bookId, tab: 'lecture', splitBookId });
      setPageReq((r) => ({ pane: activeKey, nonce: (r?.nonce ?? 0) + 1, query: q }));
    };
    window.addEventListener(GOTO_PAGE_EVENT, onGoto);
    return () => window.removeEventListener(GOTO_PAGE_EVENT, onGoto);
  }, [bookId, splitBookId, tab, activeKey]);

  if (!book) {
    return (
      <div className="empty" style={{ height: '100%' }}>
        <h3>Document introuvable</h3>
        <button className="btn" onClick={() => navigate({ name: 'library' })}>
          Retour à la bibliothèque
        </button>
      </div>
    );
  }

  const exportMd = async () => {
    const b = useStore.getState().books.find((x) => x.id === activeBookId)!;
    const md = bookToMarkdown(activeBookId, useStore.getState());
    const ok = await host.saveText(`${b.title.replace(/[\\/:*?"<>|]/g, '-')}.md`, md);
    if (ok) useStore.getState().toast('Notes exportées en Markdown', 'success');
  };

  const goTab = (t: 'lecture' | 'carte') => navigate({ name: 'reader', bookId, tab: t, splitBookId });

  return (
    <div className="reader anim-fade">
      <header className="topbar reader-topbar">
        <div className="reader-topbar-left">
          <button className="btn btn-ghost btn-sm reader-back" onClick={() => goBack(navigate)} title={fmtKeys(`Revenir : ${returnLabel()} (⌘[)`)}>
            <ChevronLeft size={16} /> <span className="truncate">{returnLabel()}</span>
          </button>
          {tab === 'lecture' && book.format !== 'image' && (
            <button className={`icon-btn ${settings.showToc ? 'active' : ''}`} onClick={() => updateSettings({ showToc: !settings.showToc })} title="Sommaire">
              <PanelLeft size={16} />
            </button>
          )}
        </div>
        <div className="spacer" />
        <div className="reader-title">
          <span className="truncate reader-title-main">{book.title}</span>
          {book.author && <span className="truncate muted">{book.author}</span>}
        </div>
        <div className="segmented reader-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'lecture'} className={tab === 'lecture' ? 'active' : ''} onClick={() => goTab('lecture')} title={fmtKeys("Lecture (⌘1)")}>
            Lecture
          </button>
          <button role="tab" aria-selected={tab === 'carte'} className={tab === 'carte' ? 'active' : ''} onClick={() => goTab('carte')} title={fmtKeys("Carte d’argument (⌘2)")}>
            Carte
          </button>
        </div>
        <div className="spacer" />
        <div className="reader-topbar-right">
          {tab === 'lecture' && (
            <>
              <button
                className={`icon-btn ${split ? 'active' : ''}`}
                onClick={(e) =>
                  split
                    ? navigate({ name: 'reader', bookId, tab, splitBookId: null })
                    : setSplitAnchor(splitAnchor ? null : e.currentTarget.getBoundingClientRect())
                }
                title={split ? 'Fermer la vue côte à côte' : 'Côte à côte'}
              >
                <Columns2 size={16} />
              </button>
              <button className={`icon-btn ${searchOpen ? 'active' : ''}`} onClick={() => setSearchOpen((v) => !v)} title={fmtKeys("Rechercher (⌘F)")}>
                <Search size={16} />
              </button>
              {/* Un seul bouton pour tout l'affichage : présentation, typographie, livre, numéros de page, thème. */}
              <button
                className={`icon-btn ${typoAnchor ? 'active' : ''}`}
                onClick={(e) => setTypoAnchor(typoAnchor ? null : e.currentTarget.getBoundingClientRect())}
                title="Mise en page et affichage"
                aria-label="Mise en page et affichage"
                aria-haspopup="dialog"
                aria-expanded={!!typoAnchor}
                data-testid="reader-display-btn"
              >
                <ALargeSmall size={17} />
              </button>
              {canBookmark && (
                <button
                  ref={bmBtnRef}
                  className={`icon-btn bm-toggle ${atView ? 'is-on' : ''}`}
                  onClick={() => bmCmd.toggle()}
                  title={fmtKeys(atView ? 'Signet à cet endroit : renommer, colorer, supprimer (⌘D)' : 'Ajouter un signet ici (⌘D)')}
                  aria-label={atView ? 'Modifier le signet de cet endroit' : 'Ajouter un signet ici'}
                  aria-pressed={!!atView}
                  data-testid="bookmark-toggle"
                >
                  <BookmarkIcon key={atView ? 'on' : 'off'} size={16} fill={atView ? 'currentColor' : 'none'} />
                </button>
              )}
            </>
          )}
          <button className="icon-btn" onClick={exportMd} title="Exporter les notes (Markdown)">
            <Download size={16} />
          </button>
          {tab === 'lecture' && (
            <button className={`icon-btn ${settings.showExtracts ? 'active' : ''}`} onClick={() => updateSettings({ showExtracts: !settings.showExtracts })} title="Panneau latéral">
              <PanelRight size={16} />
            </button>
          )}
        </div>
      </header>

      <div className="reader-body">
        <div className={`reader-lecture ${tab === 'lecture' ? '' : 'is-hidden'}`}>
          {/* Une image (photo, scan) n'a pas de sommaire : pas de panneau vide. */}
          {settings.showToc && !split && book.format !== 'image' && (
            <aside className="panel reader-side reader-toc">
              <MemoTocPanel items={pane.toc} currentLabel={pane.label} progress={pane.progress} onSelect={onTocSelect} marks={tocMarks} onMark={onTocMark} />
            </aside>
          )}
          <div className={`reader-panes ${split ? 'is-split' : ''}`}>
            {searchOpen && (
              <div className="reader-search-host">
                <SearchBar engine={activeEngine.current} onClose={() => setSearchOpen(false)} />
              </div>
            )}
            <ReaderPane
              paneKey="a"
              bookId={bookId}
              focused={activeKey === 'a'}
              onFocus={focusA}
              engineRef={engineA}
              onState={onStateA}
              onPopover={setPopover}
              split={split}
              onBookmarkPopover={setBmPop}
              pageRequest={pageReq?.pane === 'a' ? pageReq : null}
            />
            {split && splitBookId && (
              <ReaderPane
                key={splitBookId}
                paneKey="b"
                bookId={splitBookId}
                focused={activeKey === 'b'}
                onFocus={focusB}
                engineRef={engineB}
                onState={onStateB}
                onPopover={setPopover}
                split
                onClose={closeSplit}
                onBookmarkPopover={setBmPop}
                pageRequest={pageReq?.pane === 'b' ? pageReq : null}
              />
            )}
          </div>
          {settings.showExtracts && (
            <aside className="panel reader-side reader-extracts">
              <div className="reader-side-switch">
                <div className="segmented">
                  <button className={settings.rightPanel === 'extraits' ? 'active' : ''} onClick={() => updateSettings({ rightPanel: 'extraits' })}>
                    Extraits
                  </button>
                  <button className={settings.rightPanel === 'etude' ? 'active' : ''} onClick={() => updateSettings({ rightPanel: 'etude' })}>
                    Fiche-texte
                  </button>
                  {canBookmark && (
                    <button className={settings.rightPanel === 'signets' ? 'active' : ''} onClick={() => updateSettings({ rightPanel: 'signets' })}>
                      Signets{bookmarks.length ? ` · ${bookmarks.length}` : ''}
                    </button>
                  )}
                </div>
              </div>
              <div className="reader-side-body">
                {settings.rightPanel === 'signets' && canBookmark ? (
                  <MemoBookmarksPanel key={activeBookId} bookId={activeBookId} currentId={atView} onGo={onGoBookmark} onAdd={onAddBookmark} />
                ) : settings.rightPanel === 'etude' ? (
                  <MemoStudyPanel key={activeBookId} bookId={activeBookId} onGoTo={onStudyGoTo} />
                ) : (
                  <MemoExtractsPanel key={activeBookId} bookId={activeBookId} onJump={onJumpExtract} />
                )}
              </div>
            </aside>
          )}
        </div>
        {tab === 'carte' && (
          <section className="panel reader-map">
            <ReaderMapTab bookId={bookId} />
          </section>
        )}
      </div>

      {popover && tab === 'lecture' && (
        <HighlightPopover
          key={popover.id}
          highlightId={popover.id}
          rect={popover.rect}
          onClose={() => {
            setPopover(null);
            setActiveHighlight(null);
          }}
        />
      )}
      {typoAnchor && <TypographyPopover anchor={typoAnchor} onClose={() => setTypoAnchor(null)} />}
      {bmPop && tab === 'lecture' && <BookmarkPopover key={bmPop.id} {...bmPop} onClose={() => setBmPop(null)} />}
      {splitAnchor && (
        <SplitPicker
          anchor={splitAnchor}
          currentId={bookId}
          onClose={() => setSplitAnchor(null)}
          onPick={(id) => {
            setSplitAnchor(null);
            setFocus('b');
            navigate({ name: 'reader', bookId, tab: 'lecture', splitBookId: id });
          }}
        />
      )}
    </div>
  );
}
