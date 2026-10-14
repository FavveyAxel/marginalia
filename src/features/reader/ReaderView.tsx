// Coquille du lecteur (intégrateur) : moteur(s), panneaux, popovers, côte à côte, fiche-texte.
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronLeft, Columns2, Download, PanelLeft, PanelRight, Search, Type, X } from 'lucide-react';
import { useStore, selectBook, uid } from '../../lib/store';
import { host } from '../../lib/platform';
import type { Highlight, Movement, ReaderPosition, Route, TextStudy, TocItem } from '../../lib/types';
import type { EngineHandle, EngineProps, NewHighlightInput, NewMovementInput } from './engine';
import { HtmlReader } from './html/HtmlReader';
import { PdfReader } from './pdf/PdfReader';
import { TocPanel } from './TocPanel';
import { SearchBar } from './SearchBar';
import { TypographyPopover } from './TypographyPopover';
import { ExtractsPanel } from '../annotations/ExtractsPanel';
import { HighlightPopover } from '../annotations/HighlightPopover';
import { StudyPanel } from '../study/StudyPanel';
import { ArgumentMapView } from '../map/ArgumentMapView';
import { BookCover } from '../library/BookCover';
import { bookToMarkdown } from '../../lib/exportMarkdown';
import { PageSkeleton, useFloating } from '../../components/ui';
import './reader.css';

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
  workspace: 'Espace',
  concepts: 'Concepts',
  extracts: 'Extraits',
  arguments: 'Arguments',
  revision: 'Révision',
  plans: 'Plans',
  write: 'Écrits',
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

function ReaderPane({
  paneKey,
  bookId,
  focused,
  onFocus,
  engineRef,
  onState,
  onPopover,
  onClose,
  split,
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
}) {
  const book = useStore(selectBook(bookId));
  const highlights = useStore(useShallow((s) => s.highlights.filter((h) => h.bookId === bookId)));
  const movements = useStore(useShallow((s) => s.studies.filter((x) => x.bookId === bookId).flatMap((x) => x.movements)));
  const settings = useStore((s) => s.settings);
  const activeHighlightId = useStore((s) => s.activeHighlightId);
  const updateBook = useStore((s) => s.updateBook);
  const addHighlight = useStore((s) => s.addHighlight);
  const setActiveHighlight = useStore((s) => s.setActiveHighlight);
  const updateSettings = useStore((s) => s.updateSettings);
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const initialPosition = useMemo(() => book?.position ?? null, [bookId]);

  useEffect(() => {
    if (!book) return;
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
  }, [book?.id]);

  const lastPos = useRef(0);
  const posTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPosition = useCallback(
    (pos: ReaderPosition, progress: number, label: string) => {
      onState({ label, progress });
      const save = () => updateBook(bookId, { position: pos, progress });
      if (posTimer.current) clearTimeout(posTimer.current);
      const now = Date.now();
      if (now - lastPos.current > 800) {
        lastPos.current = now;
        save();
      } else posTimer.current = setTimeout(save, 900);
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

  if (!book) return null;

  const engineProps: EngineProps = {
    book,
    data: data as ArrayBuffer,
    highlights,
    movements,
    activeHighlightId,
    settings,
    initialPosition,
    onToc: (toc) => onState({ toc }),
    onPosition,
    onCreateHighlight,
    onCreateMovement: (input) => {
      addMovement(bookId, input);
      updateSettings({ rightPanel: 'etude', showExtracts: true });
    },
    onHighlightClick: (id, rect) => {
      setActiveHighlight(id);
      onPopover({ id, rect });
    },
    onMovementClick: () => updateSettings({ rightPanel: 'etude', showExtracts: true }),
    onBackgroundClick: () => {
      onPopover(null);
      setActiveHighlight(null);
    },
    onReady: () => {
      setReady(true);
      onState({ ready: true });
    },
    onError: (m) => setError(m),
  };

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
        {error ? (
          <div className="empty" style={{ height: '100%' }}>
            <h3>Lecture impossible</h3>
            <p>{error}</p>
          </div>
        ) : !data ? (
          <PageSkeleton />
        ) : book.format === 'pdf' ? (
          <PdfReader ref={engineRef} {...engineProps} />
        ) : (
          <HtmlReader ref={engineRef} {...engineProps} />
        )}
        {!ready && data && !error && (
          <div className="reader-loading overlay">
            <PageSkeleton />
          </div>
        )}
      </div>
    </section>
  );
}

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
    .filter((b) => !q || norm(b.title + ' ' + b.author).includes(norm(q)))
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
  const book = useStore(selectBook(bookId));
  const settings = useStore((s) => s.settings);
  const jump = useStore((s) => s.jump);
  const navigate = useStore((s) => s.navigate);
  const setActiveHighlight = useStore((s) => s.setActiveHighlight);
  const updateSettings = useStore((s) => s.updateSettings);

  const engineA = useRef<EngineHandle | null>(null);
  const engineB = useRef<EngineHandle | null>(null);
  const [focus, setFocus] = useState<PaneKey>('a');
  const [panes, setPanes] = useState<Record<PaneKey, PaneState>>({
    a: { toc: [], label: '', progress: book?.progress ?? 0, ready: false },
    b: { toc: [], label: '', progress: 0, ready: false },
  });
  const [popover, setPopover] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [typoAnchor, setTypoAnchor] = useState<DOMRect | null>(null);
  const [splitAnchor, setSplitAnchor] = useState<DOMRect | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const split = !!splitBookId && tab === 'lecture';
  const activeKey: PaneKey = split ? focus : 'a';
  const activeBookId = activeKey === 'b' && splitBookId ? splitBookId : bookId;
  const activeEngine = activeKey === 'b' ? engineB : engineA;
  const pane = panes[activeKey];

  const updatePane = useCallback((k: PaneKey) => (p: Partial<PaneState>) => setPanes((s) => ({ ...s, [k]: { ...s[k], ...p } })), []);
  const onStateA = useMemo(() => updatePane('a'), []);
  const onStateB = useMemo(() => updatePane('b'), []);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (meta && e.key === '1') {
        e.preventDefault();
        navigate({ name: 'reader', bookId, tab: 'lecture', splitBookId });
      } else if (meta && e.key === '2') {
        e.preventDefault();
        navigate({ name: 'reader', bookId, tab: 'carte', splitBookId });
      } else if (meta && e.key === '[') {
        e.preventDefault();
        goBack(navigate);
      } else if (e.key === 'Escape' && popover) {
        setPopover(null);
        setActiveHighlight(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bookId, splitBookId, popover]);

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
          <button className="btn btn-ghost btn-sm reader-back" onClick={() => goBack(navigate)} title={`Revenir : ${returnLabel()} (⌘[)`}>
            <ChevronLeft size={16} /> <span className="truncate">{returnLabel()}</span>
          </button>
          {tab === 'lecture' && (
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
          <button role="tab" aria-selected={tab === 'lecture'} className={tab === 'lecture' ? 'active' : ''} onClick={() => goTab('lecture')} title="Lecture (⌘1)">
            Lecture
          </button>
          <button role="tab" aria-selected={tab === 'carte'} className={tab === 'carte' ? 'active' : ''} onClick={() => goTab('carte')} title="Carte d’argument (⌘2)">
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
              <button className={`icon-btn ${searchOpen ? 'active' : ''}`} onClick={() => setSearchOpen((v) => !v)} title="Rechercher (⌘F)">
                <Search size={16} />
              </button>
              <button className={`icon-btn ${typoAnchor ? 'active' : ''}`} onClick={(e) => setTypoAnchor(typoAnchor ? null : e.currentTarget.getBoundingClientRect())} title="Affichage">
                <Type size={16} />
              </button>
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
          {settings.showToc && !split && (
            <aside className="panel reader-side reader-toc">
              <TocPanel items={pane.toc} currentLabel={pane.label} progress={pane.progress} onSelect={(item) => activeEngine.current?.goTo(item.target)} />
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
              onFocus={() => setFocus('a')}
              engineRef={engineA}
              onState={onStateA}
              onPopover={setPopover}
              split={split}
            />
            {split && splitBookId && (
              <ReaderPane
                key={splitBookId}
                paneKey="b"
                bookId={splitBookId}
                focused={activeKey === 'b'}
                onFocus={() => setFocus('b')}
                engineRef={engineB}
                onState={onStateB}
                onPopover={setPopover}
                split
                onClose={() => {
                  setFocus('a');
                  navigate({ name: 'reader', bookId, tab, splitBookId: null });
                }}
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
                </div>
              </div>
              <div className="reader-side-body">
                {settings.rightPanel === 'extraits' ? (
                  <ExtractsPanel
                    key={activeBookId}
                    bookId={activeBookId}
                    onJump={(id) => {
                      const h = useStore.getState().highlights.find((x) => x.id === id);
                      if (h) {
                        setActiveHighlight(id);
                        activeEngine.current?.goToHighlight(h);
                      }
                    }}
                  />
                ) : (
                  <StudyPanel key={activeBookId} bookId={activeBookId} onGoTo={(anchor) => activeEngine.current?.goToAnchor(anchor)} />
                )}
              </div>
            </aside>
          )}
        </div>
        {tab === 'carte' && (
          <section className="panel reader-map">
            <ArgumentMapView bookId={bookId} />
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
