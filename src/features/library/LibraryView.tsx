import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  ArrowUpDown,
  BookOpen,
  Columns2,
  FolderPlus,
  Info,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
  ChevronRight,
  ChevronLeft,
  FileDown,
  Library as LibraryIcon,
  Cloud,
  Lock,
  Check,
  CheckSquare,
} from 'lucide-react';
import { useStore } from '../../lib/store';
import { host, ACCEPTED_EXTENSIONS, type AppleBook } from '../../lib/platform';
import { appleBooksAvailable, importAppleBooks } from './appleBooks';
import type { Book, BookFormat, Database } from '../../lib/types';
import { relativeTime } from '../../components/ui';
import { importViaDialog } from '../../App';
import { bookToMarkdown } from '../../lib/exportMarkdown';
import { BookCover } from './BookCover';
import { useMultiSelect, useLasso, useSelectionKeys, LassoBox } from '../../lib/useMultiSelect';
import { SelectionActionBar, SelectCheck, AddToWorkspaceDialog, selectedLabel } from '../../components/MultiSelect';
import { ContextMenu, type MenuEntry } from '../workspaces/wsUi';
import './library.css';

type SortKey = 'recent' | 'title' | 'author' | 'added';
type ViewMode = 'grid' | 'list';
type FilterKey = 'all' | 'epub' | 'pdf' | 'docs';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'recent', label: 'Récents' },
  { id: 'title', label: 'Titre' },
  { id: 'author', label: 'Auteur' },
  { id: 'added', label: 'Ajout' },
];

const FORMAT_LABEL: Record<BookFormat, string> = { epub: 'EPUB', pdf: 'PDF', docx: 'DOCX', md: 'MD', txt: 'TXT', html: 'HTML', image: 'Image' };

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Progression en fraction 0-1 (tolère une valeur déjà exprimée en pourcentage). */
const fraction = (p: number) => Math.max(0, Math.min(1, !p ? 0 : p > 1 ? p / 100 : p));
const pct = (p: number) => Math.round(fraction(p) * 100);

const inFilter = (b: Book, f: FilterKey) =>
  f === 'all' ? true : f === 'epub' ? b.format === 'epub' : f === 'pdf' ? b.format === 'pdf' : ['docx', 'md', 'txt', 'html', 'image'].includes(b.format);

function readPref<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    if (v && allowed.includes(v)) return v;
  } catch {
    /* stockage indisponible */
  }
  return fallback;
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible */
  }
}

function slug(s: string): string {
  return (
    fold(s)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'notes'
  );
}

function snapshotDb(): Database {
  const s = useStore.getState();
  return {
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
    trash: s.trash,
    activity: s.activity,
  };
}

export function LibraryView() {
  const books = useStore((s) => s.books);
  const highlights = useStore((s) => s.highlights);
  const importing = useStore((s) => s.importing);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>(() => readPref<SortKey>('lib.sort', ['recent', 'title', 'author', 'added'], 'recent'));
  const [view, setView] = useState<ViewMode>(() => readPref<ViewMode>('lib.view', ['grid', 'list'], 'grid'));
  const [filter, setFilter] = useState<FilterKey>('all');
  const [menu, setMenu] = useState<{ bookId: string; x: number; y: number } | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [booksOpen, setBooksOpen] = useState(false);
  // Sélection multiple
  const [selectMode, setSelectMode] = useState(false);
  const [multiMenu, setMultiMenu] = useState<{ x: number; y: number } | null>(null);
  const [addIds, setAddIds] = useState<string[] | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const h of highlights) m[h.bookId] = (m[h.bookId] ?? 0) + 1;
    return m;
  }, [highlights]);

  const filterCounts = useMemo(
    () => ({
      all: books.length,
      epub: books.filter((b) => inFilter(b, 'epub')).length,
      pdf: books.filter((b) => inFilter(b, 'pdf')).length,
      docs: books.filter((b) => inFilter(b, 'docs')).length,
    }),
    [books],
  );

  const visible = useMemo(() => {
    const q = fold(query.trim());
    const list = books.filter((b) => {
      if (!inFilter(b, filter)) return false;
      if (!q) return true;
      const hay = fold([b.title, b.author, b.edition.publisher, b.edition.translator, b.originalName].join(' '));
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
    const cmp: Record<SortKey, (a: Book, b: Book) => number> = {
      recent: (a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.addedAt - a.addedAt,
      title: (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }),
      author: (a, b) => (a.author || '￿').localeCompare(b.author || '￿', 'fr', { sensitivity: 'base' }) || a.title.localeCompare(b.title, 'fr'),
      added: (a, b) => b.addedAt - a.addedAt,
    };
    return [...list].sort(cmp[sort]);
  }, [books, query, filter, sort]);

  const visibleIds = useMemo(() => visible.map((b) => b.id), [visible]);
  const sel = useMultiSelect(visibleIds);
  const lasso = useLasso({ container: scrollRef, sel });
  const exitSelect = () => {
    sel.clear();
    setSelectMode(false);
  };
  useSelectionKeys(sel, { onEscape: selectMode ? () => setSelectMode(false) : undefined });
  const showChecks = selectMode || sel.size > 0;

  const resume = useMemo(
    () => books.filter((b) => b.lastOpenedAt && b.format !== 'image').sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0] ?? null,
    [books],
  );

  const open = (b: Book) => useStore.getState().openBook(b.id);
  const openMenu = (bookId: string, x: number, y: number) => setMenu({ bookId, x, y });

  const exportNotes = async (b: Book) => {
    try {
      const md = bookToMarkdown(b.id, snapshotDb());
      const ok = await host.saveText(`${slug(b.title)}-notes.md`, md);
      if (ok) useStore.getState().toast('Notes exportées', 'success');
    } catch (e) {
      console.error(e);
      useStore.getState().toast('Export impossible', 'error');
    }
  };

  /** Notes de plusieurs livres : un seul fichier Markdown, un livre après l'autre. */
  const exportMany = async (ids: string[]) => {
    const list = ids.map((id) => books.find((b) => b.id === id)).filter((b): b is Book => !!b);
    if (list.length === 1) return exportNotes(list[0]);
    try {
      const db = snapshotDb();
      const md = list.map((b) => bookToMarkdown(b.id, db)).join('\n\n---\n\n');
      const ok = await host.saveText(`notes-${list.length}-livres.md`, md);
      if (ok) useStore.getState().toast(`Notes de ${list.length} livres exportées`, 'success');
    } catch (e) {
      console.error(e);
      useStore.getState().toast('Export impossible', 'error');
    }
  };
  /** Suppression groupée : confirmation seulement si des extraits partent avec les livres. */
  const deleteMany = (ids: string[]) => {
    if (ids.reduce((n, id) => n + (counts[id] ?? 0), 0) > 0) setDeleteIds(ids);
    else useStore.getState().trashDeleteMany('book', ids);
  };

  /** Clic sur un livre : ⌘ / ⇧ / mode « Sélectionner » → sélection ; sinon ouvrir. */
  const onItemClick = (e: React.MouseEvent, b: Book) => {
    if (sel.click(b.id, e, { toggle: selectMode })) return;
    open(b);
  };
  const onItemKey = (e: React.KeyboardEvent, b: Book) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === ' ') {
      e.preventDefault();
      sel.click(b.id, { metaKey: !e.shiftKey, shiftKey: e.shiftKey });
    } else if (e.key === 'Enter') {
      if (selectMode) sel.toggle(b.id);
      else open(b);
    }
  };
  const onItemContext = (e: React.MouseEvent, b: Book) => {
    e.preventDefault();
    if (sel.has(b.id) && sel.size > 1) {
      setMultiMenu({ x: e.clientX, y: e.clientY });
      return;
    }
    if (sel.size && !sel.has(b.id)) sel.clear();
    openMenu(b.id, e.clientX, e.clientY);
  };
  const multiEntries = (ids: string[]): MenuEntry[] => [
    { label: 'Ajouter à un espace…', icon: <FolderPlus size={14} />, onClick: () => setAddIds(ids) },
    { label: 'Exporter les notes', icon: <FileDown size={14} />, onClick: () => void exportMany(ids) },
    { sep: true },
    { label: `Supprimer ${ids.length} livres…`, icon: <Trash2 size={14} />, danger: true, onClick: () => deleteMany(ids) },
  ];

  const empty = books.length === 0 && importing === 0;
  const infoBook = books.find((b) => b.id === infoId) ?? null;
  const deleteBook = books.find((b) => b.id === deleteId) ?? null;

  return (
    <div className="lib-root msel-host">
      <header className="topbar">
        {!empty && (
          <>
            <label className="lib-search">
              <Search size={14} />
              <input
                className="lib-search-input"
                placeholder="Rechercher un titre, un auteur…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Rechercher dans la bibliothèque"
              />
              {query && (
                <button className="icon-btn sm" onClick={() => setQuery('')} aria-label="Effacer la recherche">
                  <X size={13} />
                </button>
              )}
            </label>
            <label className="lib-sort" title="Trier par">
              <ArrowUpDown size={13} />
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as SortKey);
                  writePref('lib.sort', e.target.value);
                }}
                aria-label="Trier par"
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="segmented" role="group" aria-label="Affichage">
              <button
                className={view === 'grid' ? 'active' : ''}
                onClick={() => {
                  setView('grid');
                  writePref('lib.view', 'grid');
                }}
                aria-label="Grille"
                title="Grille"
              >
                <LayoutGrid size={13} style={{ verticalAlign: -2 }} />
              </button>
              <button
                className={view === 'list' ? 'active' : ''}
                onClick={() => {
                  setView('list');
                  writePref('lib.view', 'list');
                }}
                aria-label="Liste"
                title="Liste"
              >
                <ListIcon size={13} style={{ verticalAlign: -2 }} />
              </button>
            </div>
            <button
              className={`btn btn-ghost msel-toggle ${selectMode ? 'active' : ''}`}
              aria-pressed={selectMode}
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              title={selectMode ? 'Quitter la sélection (Échap)' : 'Sélectionner plusieurs documents (⌘-clic, ⇧-clic, ⌘A)'}
            >
              <CheckSquare size={14} /> {selectMode ? 'Terminé' : 'Sélectionner'}
            </button>
          </>
        )}
        <span className="spacer" />
        {importing > 0 && (
          <span className="lib-importing" role="status">
            <Loader2 size={13} className="lib-spin" /> Import en cours{importing > 1 ? ` (${importing})` : ''}…
          </span>
        )}
        {appleBooksAvailable() && (
          <button className="btn" onClick={() => setBooksOpen(true)} title="Importer et synchroniser les livres sans DRM de l’app Livres (iCloud)">
            <LibraryIcon size={14} /> Depuis Livres
          </button>
        )}
        <button className="btn btn-primary" onClick={() => importViaDialog()}>
          <Plus size={14} /> Importer
        </button>
      </header>

      <div className="lib-scroll" ref={scrollRef} onMouseDown={lasso.onMouseDown}>
        <div className="lib-page anim-view">
          <h1 className="page-title lib-title">Bibliothèque</h1>

          {empty ? (
            <div className="lib-drop" onClick={() => importViaDialog()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && importViaDialog()}>
              <div className="lib-drop-icon">
                <Upload size={22} />
              </div>
              <h3>Déposez vos textes ici</h3>
              <p>Glissez des fichiers n’importe où dans la fenêtre, ou choisissez-les sur votre Mac.</p>
              <button
                className="btn btn-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  importViaDialog();
                }}
              >
                <Plus size={14} /> Importer
              </button>
              {appleBooksAvailable() && (
                <button
                  className="btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setBooksOpen(true);
                  }}
                >
                  <LibraryIcon size={14} /> Récupérer mes livres de l’app Livres
                </button>
              )}
              <div className="lib-formats">
                {['EPUB', 'PDF', 'DOCX', 'Markdown', 'TXT', 'HTML'].map((f) => (
                  <span key={f} className="lib-format-tag">
                    {f}
                  </span>
                ))}
              </div>
              <span className="lib-accept" aria-hidden="true">
                {ACCEPTED_EXTENSIONS.join(' · ')}
              </span>
            </div>
          ) : (
            <>
              {resume && !query && filter === 'all' && (
                <section className="lib-resume" aria-label="Reprendre la lecture">
                  <BookCover book={resume} size="sm" />
                  <div className="lib-resume-body">
                    <div className="lib-eyebrow">Reprendre la lecture</div>
                    <div className="lib-resume-title truncate">{resume.title}</div>
                    <div className="muted truncate">
                      {resume.author || 'Auteur inconnu'} · {relativeTime(resume.lastOpenedAt)}
                    </div>
                    <div className="lib-progress lib-progress-wide" aria-label={`Progression ${pct(resume.progress)} %`}>
                      <span style={{ width: `${pct(resume.progress)}%` }} />
                    </div>
                  </div>
                  <button className="btn btn-primary" onClick={() => open(resume)}>
                    <BookOpen size={14} /> Reprendre
                  </button>
                </section>
              )}

              <div className="lib-filters" role="group" aria-label="Filtrer par format">
                {(
                  [
                    ['all', 'Tous'],
                    ['epub', 'EPUB'],
                    ['pdf', 'PDF'],
                    ['docs', 'Documents'],
                  ] as [FilterKey, string][]
                ).map(([k, label]) => (
                  <button key={k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
                    {label}
                    <span className="lib-chip-count">{filterCounts[k]}</span>
                  </button>
                ))}
              </div>

              {visible.length === 0 && importing === 0 ? (
                <div className="empty lib-noresult">
                  <h3>Aucun résultat</h3>
                  <p>Aucun document ne correspond à cette recherche.</p>
                  <button
                    className="btn"
                    onClick={() => {
                      setQuery('');
                      setFilter('all');
                    }}
                  >
                    Réinitialiser
                  </button>
                </div>
              ) : view === 'grid' ? (
                <div className={`lib-grid anim-stagger ${showChecks ? 'lib-selecting' : ''}`} role="listbox" aria-multiselectable="true" aria-label="Documents">
                  {Array.from({ length: importing }).map((_, i) => (
                    <div key={'sk' + i} className="lib-card lib-skeleton" aria-hidden="true">
                      <span className="lib-skel-cover" />
                      <span className="lib-skel-line" />
                      <span className="lib-skel-line short" />
                    </div>
                  ))}
                  {visible.map((b, i) => (
                    <div
                      key={b.id}
                      className={`lib-card ${sel.has(b.id) ? 'selected' : ''}`}
                      style={{ ['--i' as string]: i }}
                      tabIndex={0}
                      role="option"
                      aria-selected={sel.has(b.id)}
                      aria-label={`${b.title}${b.author ? ', ' + b.author : ''}`}
                      data-sel-id={b.id}
                      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                      onClick={(e) => onItemClick(e, b)}
                      onKeyDown={(e) => onItemKey(e, b)}
                      onContextMenu={(e) => onItemContext(e, b)}
                    >
                      <div className="lib-card-cover">
                        {showChecks && (
                          <span className="lib-check">
                            <SelectCheck checked={sel.has(b.id)} onToggle={() => sel.toggle(b.id)} label={`Sélectionner « ${b.title} »`} />
                          </span>
                        )}
                        <BookCover book={b} size="md" />
                        <button
                          className="icon-btn sm lib-more"
                          aria-label="Plus d’actions"
                          onClick={(e) => {
                            e.stopPropagation();
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            openMenu(b.id, r.left, r.bottom + 4);
                          }}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                      <div className="lib-card-title" title={b.title}>
                        {b.title}
                      </div>
                      <div className="lib-card-author truncate">{b.author || 'Auteur inconnu'}</div>
                      <div className="lib-card-meta">
                        <span className="lib-progress" aria-label={`Progression ${pct(b.progress)} %`}>
                          <span style={{ width: `${pct(b.progress)}%` }} />
                        </span>
                        <span>{pct(b.progress)} %</span>
                        <span className="lib-dot">·</span>
                        <span>
                          {counts[b.id] ?? 0} extrait{(counts[b.id] ?? 0) > 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`lib-list anim-fade ${showChecks ? 'lib-selecting' : ''}`} role="grid" aria-multiselectable="true" aria-label="Documents">
                  <div className="lib-row lib-row-head" role="row">
                    <span />
                    <span>Titre</span>
                    <span>Auteur</span>
                    <span>Format</span>
                    <span className="num">Extraits</span>
                    <span>Dernière ouverture</span>
                    <span>Progression</span>
                    <span />
                  </div>
                  {importing > 0 &&
                    Array.from({ length: importing }).map((_, i) => (
                      <div key={'sk' + i} className="lib-row lib-skeleton" aria-hidden="true">
                        <span className="lib-skel-xs" />
                        <span className="lib-skel-line" />
                      </div>
                    ))}
                  {visible.map((b) => (
                    <div
                      key={b.id}
                      className={`lib-row ${sel.has(b.id) ? 'selected' : ''}`}
                      role="row"
                      tabIndex={0}
                      aria-selected={sel.has(b.id)}
                      data-sel-id={b.id}
                      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                      onClick={(e) => onItemClick(e, b)}
                      onKeyDown={(e) => onItemKey(e, b)}
                      onContextMenu={(e) => onItemContext(e, b)}
                    >
                      {showChecks ? (
                        <SelectCheck checked={sel.has(b.id)} onToggle={() => sel.toggle(b.id)} label={`Sélectionner « ${b.title} »`} />
                      ) : (
                        <BookCover book={b} size="xs" />
                      )}
                      <span className="lib-row-title truncate">{b.title}</span>
                      <span className="truncate muted">{b.author || '—'}</span>
                      <span className="muted">{FORMAT_LABEL[b.format]}</span>
                      <span className="num muted">{counts[b.id] ?? 0}</span>
                      <span className="muted truncate">{b.lastOpenedAt ? relativeTime(b.lastOpenedAt) : '—'}</span>
                      <span className="lib-row-progress">
                        <span className="lib-progress">
                          <span style={{ width: `${pct(b.progress)}%` }} />
                        </span>
                        <span className="muted">{pct(b.progress)} %</span>
                      </span>
                      <button
                        className="icon-btn sm lib-row-more"
                        aria-label="Plus d’actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          openMenu(b.id, r.left - 200, r.bottom + 4);
                        }}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {menu && (
        <BookMenu
          menu={menu}
          books={books}
          onClose={() => setMenu(null)}
          onInfo={(id) => setInfoId(id)}
          onDelete={(id) => setDeleteId(id)}
          onExport={exportNotes}
        />
      )}
      {lasso.box && <LassoBox box={lasso.box} />}
      <SelectionActionBar count={sel.size} label={sel.size > 1 ? 'livres sélectionnés' : 'livre sélectionné'} onClear={exitSelect}>
        <button className="btn btn-ghost btn-sm" onClick={() => setAddIds(sel.ids)}>
          <FolderPlus size={14} /> Ajouter à un espace…
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void exportMany(sel.ids)}>
          <FileDown size={14} /> Exporter les notes
        </button>
        <button className="btn btn-ghost btn-sm msel-danger" onClick={() => deleteMany(sel.ids)}>
          <Trash2 size={14} /> Supprimer
        </button>
      </SelectionActionBar>
      {multiMenu && sel.size > 1 && (
        <ContextMenu x={multiMenu.x} y={multiMenu.y} entries={multiEntries(sel.ids)} onClose={() => setMultiMenu(null)} label={selectedLabel(sel.size, 'livre', 'livres')} />
      )}
      {addIds && <AddToWorkspaceDialog kind="book" refIds={addIds} onClose={() => setAddIds(null)} />}
      {deleteIds && (
        <DeleteManyDialog
          books={deleteIds.map((id) => books.find((b) => b.id === id)).filter((b): b is Book => !!b)}
          nExtracts={deleteIds.reduce((n, id) => n + (counts[id] ?? 0), 0)}
          onClose={() => setDeleteIds(null)}
        />
      )}
      {booksOpen && <AppleBooksDialog onClose={() => setBooksOpen(false)} />}
      {infoBook && <InfoDialog book={infoBook} onClose={() => setInfoId(null)} />}
      {deleteBook && <DeleteDialog book={deleteBook} nExtracts={counts[deleteBook.id] ?? 0} onClose={() => setDeleteId(null)} />}
    </div>
  );
}

// ── Menu contextuel ──────────────────────────────────────────
function BookMenu({
  menu,
  books,
  onClose,
  onInfo,
  onDelete,
  onExport,
}: {
  menu: { bookId: string; x: number; y: number };
  books: Book[];
  onClose(): void;
  onInfo(id: string): void;
  onDelete(id: string): void;
  onExport(b: Book): void;
}) {
  const workspaces = useStore(useShallow((s) => s.workspaces));
  const wsItems = useStore(useShallow((s) => s.wsItems));
  const [mode, setMode] = useState<'root' | 'split' | 'ws'>('root');
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y, ready: false });
  const book = books.find((b) => b.id === menu.bookId);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(window.innerWidth - r.width - 8, menu.x)),
      top: Math.max(8, Math.min(window.innerHeight - r.height - 8, menu.y)),
      ready: true,
    });
  }, [menu.x, menu.y, mode]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  if (!book) return null;
  const st = useStore.getState();
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const others = books.filter((b) => b.id !== book.id);

  return (
    <div ref={ref} className="floating lib-menu" style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }} role="menu">
      {mode === 'root' && (
        <>
          <button className="menu-item" role="menuitem" onClick={run(() => st.openBook(book.id))}>
            <BookOpen size={14} /> Ouvrir
          </button>
          <button className="menu-item" role="menuitem" disabled={others.length === 0} onClick={() => setMode('split')}>
            <Columns2 size={14} /> Ouvrir côte à côte avec…
            <ChevronRight size={13} className="lib-menu-chev" />
          </button>
          <div className="divider" />
          <button className="menu-item" role="menuitem" onClick={run(() => onInfo(book.id))}>
            <Info size={14} /> Infos et édition
          </button>
          <button className="menu-item" role="menuitem" onClick={() => setMode('ws')}>
            <FolderPlus size={14} /> Ajouter à un espace
            <ChevronRight size={13} className="lib-menu-chev" />
          </button>
          <button className="menu-item" role="menuitem" onClick={run(() => onExport(book))}>
            <FileDown size={14} /> Exporter les notes
          </button>
          <div className="divider" />
          <button className="menu-item lib-danger" role="menuitem" onClick={run(() => onDelete(book.id))}>
            <Trash2 size={14} /> Supprimer
          </button>
        </>
      )}
      {mode === 'split' && (
        <>
          <button className="menu-item lib-menu-back" onClick={() => setMode('root')}>
            <ChevronLeft size={13} /> Ouvrir côte à côte avec…
          </button>
          <div className="divider" />
          <div className="lib-menu-scroll">
            {others.map((o) => (
              <button key={o.id} className="menu-item" role="menuitem" onClick={run(() => st.openBook(book.id, o.id))}>
                <BookCover book={o} size="xs" />
                <span className="truncate">{o.title}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {mode === 'ws' && (
        <>
          <button className="menu-item lib-menu-back" onClick={() => setMode('root')}>
            <ChevronLeft size={13} /> Ajouter à un espace
          </button>
          <div className="divider" />
          <div className="lib-menu-scroll">
            {workspaces.length === 0 && <div className="lib-menu-note muted">Aucun espace pour l’instant. Créez-en un depuis la barre latérale.</div>}
            {workspaces.map((w) => {
              const already = wsItems.some((i) => i.workspaceId === w.id && i.kind === 'book' && i.refId === book.id);
              return (
                <button
                  key={w.id}
                  className="menu-item"
                  role="menuitem"
                  disabled={already}
                  onClick={run(() => {
                    st.addToWorkspace(w.id, null, 'book', book.id);
                    st.toast(`Ajouté à « ${w.name} »`, 'success');
                  })}
                >
                  <span className="lib-ws-dot" style={{ background: `var(${w.tint})` }} />
                  <span className="truncate">{w.name}</span>
                  {already && <span className="muted lib-menu-chev">déjà présent</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Boîtes de dialogue maison ────────────────────────────────
function Modal({ title, onClose, children, footer, width = 460 }: { title: string; onClose(): void; children: React.ReactNode; footer: React.ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="lib-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lib-dialog" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="lib-dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn sm" onClick={onClose} aria-label="Fermer">
            <X size={14} />
          </button>
        </div>
        <div className="lib-dialog-body">{children}</div>
        <div className="lib-dialog-foot">{footer}</div>
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="lib-field">
      <span className="lib-field-label">{label}</span>
      {children}
      {hint && <span className="lib-field-hint">{hint}</span>}
    </label>
  );
}

function InfoDialog({ book, onClose }: { book: Book; onClose(): void }) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [publisher, setPublisher] = useState(book.edition.publisher);
  const [year, setYear] = useState(book.edition.year);
  const [translator, setTranslator] = useState(book.edition.translator);
  const [place, setPlace] = useState(book.edition.place);
  const [offset, setOffset] = useState(String(book.edition.pageOffset || 0));
  const isPdf = book.format === 'pdf';
  const off = Number.parseInt(offset, 10);
  const offValid = Number.isFinite(off);

  const save = () => {
    useStore.getState().updateBook(book.id, {
      title: title.trim() || book.title,
      author: author.trim(),
      edition: {
        publisher: publisher.trim(),
        year: year.trim(),
        translator: translator.trim(),
        place: place.trim(),
        pageOffset: isPdf && offValid ? off : book.edition.pageOffset,
      },
    });
    onClose();
  };

  return (
    <Modal
      title="Infos et édition"
      onClose={onClose}
      width={520}
      footer={
        <>
          <span className="lib-foot-note muted truncate">
            {FORMAT_LABEL[book.format]} · {(book.size / 1024 / 1024).toFixed(book.size > 1048576 ? 1 : 2)} Mo · {book.originalName}
          </span>
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={save}>
            Enregistrer
          </button>
        </>
      }
    >
      <div className="lib-dialog-hero">
        <BookCover book={book} size="sm" />
        <p className="muted">L’édition de référence sert à composer vos citations : auteur, titre, traducteur, lieu, éditeur, année et page.</p>
      </div>
      <Field label="Titre">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </Field>
      <Field label="Auteur">
        <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} />
      </Field>
      <div className="lib-field-row">
        <Field label="Éditeur">
          <input className="input" value={publisher} onChange={(e) => setPublisher(e.target.value)} placeholder="GF Flammarion" />
        </Field>
        <Field label="Année">
          <input className="input" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2000" inputMode="numeric" />
        </Field>
      </div>
      <div className="lib-field-row">
        <Field label="Traducteur">
          <input className="input" value={translator} onChange={(e) => setTranslator(e.target.value)} />
        </Field>
        <Field label="Lieu d’édition">
          <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Paris" />
        </Field>
      </div>
      {isPdf && (
        <Field
          label="Décalage de pagination"
          hint="Page imprimée = page du fichier + décalage. Exemple : si la page 1 du livre est la 9e page du fichier PDF, saisissez −8."
        >
          <input
            className="input lib-offset"
            type="number"
            step={1}
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            aria-invalid={!offValid}
          />
        </Field>
      )}
    </Modal>
  );
}

function DeleteDialog({ book, nExtracts, onClose }: { book: Book; nExtracts: number; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Supprimer ce document ?"
      onClose={onClose}
      width={420}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await useStore.getState().removeBook(book.id);
              useStore.getState().toast(`« ${book.title} » supprimé`);
              onClose();
            }}
          >
            <Trash2 size={14} /> Supprimer
          </button>
        </>
      }
    >
      <div className="lib-dialog-hero">
        <BookCover book={book} size="sm" />
        <div>
          <p style={{ margin: 0 }}>
            <strong>{book.title}</strong>
          </p>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {nExtracts > 0
              ? `Le fichier, ses ${nExtracts} extrait${nExtracts > 1 ? 's' : ''}, sa carte, ses fiches-texte et ses cartes de révision iront avec lui dans la corbeille, où vous pourrez tout restaurer pendant 30 jours.`
              : 'Le document et ses données associées iront dans la corbeille, où vous pourrez tout restaurer pendant 30 jours.'}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function DeleteManyDialog({ books, nExtracts, onClose }: { books: Book[]; nExtracts: number; onClose(): void }) {
  const n = books.length;
  return (
    <Modal
      title={`Supprimer ${n} documents ?`}
      onClose={onClose}
      width={440}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose} autoFocus>
            Annuler
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              useStore.getState().trashDeleteMany('book', books.map((b) => b.id));
              onClose();
            }}
          >
            <Trash2 size={14} /> Supprimer {n} documents
          </button>
        </>
      }
    >
      <div className="lib-dialog-hero">
        <span className="lib-cover-stack" aria-hidden="true">
          {books.slice(0, 3).map((b, i) => (
            <span key={b.id} style={{ ['--k' as string]: i }}>
              <BookCover book={b} size="sm" />
            </span>
          ))}
        </span>
        <div>
          <p style={{ margin: 0 }}>
            <strong>
              {books
                .slice(0, 3)
                .map((b) => `« ${b.title} »`)
                .join(', ')}
              {n > 3 ? ` et ${n - 3} autre${n - 3 > 1 ? 's' : ''}` : ''}
            </strong>
          </p>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {`Les fichiers, leurs ${nExtracts} extrait${nExtracts > 1 ? 's' : ''}, leurs cartes, fiches-texte et cartes de révision iront avec eux dans la corbeille. Un seul « Annuler » remet tout en place, et chaque document reste restaurable pendant 30 jours.`}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function AppleBooksDialog({ onClose }: { onClose(): void }) {
  const books = useStore((s) => s.books);
  const settings = useStore((s) => s.settings);
  const [list, setList] = useState<AppleBook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sync, setSync] = useState(settings.appleBooksSync ?? true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const inLibrary = useMemo(() => new Set(books.map((b) => b.originalName)), [books]);

  useEffect(() => {
    let alive = true;
    host.appleBooksScan!()
      .then((l) => {
        if (!alive) return;
        setList(l);
        const seen = new Set(settings.appleBooksSeen ?? []);
        setPicked(new Set(l.filter((b) => !b.drm && !b.pending && !inLibrary.has(b.name) && !seen.has(b.name)).map((b) => b.name)));
      })
      .catch((e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importable = (list ?? []).filter((b) => !b.drm && !b.pending && !inLibrary.has(b.name));
  const nDrm = (list ?? []).filter((b) => b.drm).length;
  const toggle = (name: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  const allOn = importable.length > 0 && importable.every((b) => picked.has(b.name));

  const go = async () => {
    const s = useStore.getState();
    // Tout ce qui est listé est « vu » : la synchro n'importera ensuite que les nouveaux livres.
    s.updateSettings({ appleBooksSync: sync, appleBooksSeen: [...new Set([...(s.settings.appleBooksSeen ?? []), ...(list ?? []).filter((b) => !b.pending).map((b) => b.name)])] });
    const todo = importable.filter((b) => picked.has(b.name));
    if (todo.length) {
      setProgress({ done: 0, total: todo.length });
      const n = await importAppleBooks(todo, (done, total) => setProgress({ done, total }));
      s.toast(n === 1 ? '1 livre importé depuis Livres' : `${n} livres importés depuis Livres`, n ? 'success' : 'error');
    } else if (sync) s.toast('Synchronisation avec Livres activée', 'success');
    onClose();
  };

  return (
    <Modal
      title="Livres d’Apple"
      onClose={progress ? () => undefined : onClose}
      width={560}
      footer={
        <>
          <label className="lib-books-sync">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} disabled={!!progress} />
            <span>
              <strong>Synchroniser automatiquement</strong>
              <small>Les livres sans DRM ajoutés dans Livres (iPhone, iPad, Mac) arriveront ici tout seuls.</small>
            </span>
          </label>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={!!progress}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={go} disabled={!list || !!progress}>
            {progress ? (
              <>
                <Loader2 size={13} className="lib-spin" /> {progress.done}/{progress.total}
              </>
            ) : picked.size ? (
              `Importer ${picked.size} livre${picked.size > 1 ? 's' : ''}`
            ) : (
              'Valider'
            )}
          </button>
        </>
      }
    >
      {error ? (
        <p className="lib-books-note">Impossible de lire le dossier de Livres : {error}</p>
      ) : !list ? (
        <div className="lib-books-loading">
          <Loader2 size={16} className="lib-spin" /> Recherche des livres…
        </div>
      ) : list.length === 0 ? (
        <p className="lib-books-note">
          Aucun livre trouvé. Vérifie que « Livres » est activé dans Réglages système › Identifiant Apple › iCloud › iCloud Drive, puis autorise Marginalia à accéder à iCloud Drive si macOS le demande.
        </p>
      ) : (
        <>
          <div className="lib-books-head">
            <span>
              {list.length} livre{list.length > 1 ? 's' : ''}
              {nDrm ? ` · ${nDrm} protégé${nDrm > 1 ? 's' : ''} par DRM (non importable${nDrm > 1 ? 's' : ''})` : ''}
            </span>
            {importable.length > 0 && (
              <button className="btn btn-ghost sm" onClick={() => setPicked(allOn ? new Set() : new Set(importable.map((b) => b.name)))}>
                {allOn ? 'Tout désélectionner' : 'Tout sélectionner'}
              </button>
            )}
          </div>
          <ul className="lib-books-list">
            {list.map((b) => {
              const have = inLibrary.has(b.name);
              const disabled = !!b.drm || !!b.pending || have || !!progress;
              return (
                <li key={b.path} className={disabled ? 'off' : ''}>
                  <label>
                    <input type="checkbox" checked={!disabled && picked.has(b.name)} disabled={disabled} onChange={() => toggle(b.name)} />
                    <span className="lib-books-meta">
                      <span className="lib-books-title">{b.title}</span>
                      <span className="lib-books-sub">
                        {b.author || (b.kind === 'pdf' ? 'PDF' : 'EPUB')}
                      </span>
                    </span>
                    {b.drm ? (
                      <span className="lib-books-tag warn">
                        <Lock size={11} /> DRM {b.drm}
                      </span>
                    ) : b.pending ? (
                      <span className="lib-books-tag">
                        <Cloud size={11} /> Dans iCloud
                      </span>
                    ) : have ? (
                      <span className="lib-books-tag ok">
                        <Check size={11} /> Déjà là
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Modal>
  );
}
