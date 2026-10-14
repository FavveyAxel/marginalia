import { useEffect, useState } from 'react';
import { BookOpen, Brain, FilePen, Highlighter, Home, Lightbulb, ListTree, Plus, Search, Sigma, Upload } from 'lucide-react';
import { useStore } from './lib/store';
import { host, filesFromDrop } from './lib/platform';
import type { Route, ThemeId } from './lib/types';
import { Kbd } from './components/ui';
import { HomeView } from './features/home/HomeView';
import { LibraryView } from './features/library/LibraryView';
import { ReaderView } from './features/reader/ReaderView';
import { ConceptsView } from './features/concepts/ConceptsView';
import { AllExtractsView } from './features/annotations/AllExtractsView';
import { ArgumentsView } from './features/arguments/ArgumentsView';
import { RevisionView } from './features/revision/RevisionView';
import { useDueCount } from './features/revision/useDueCount';
import { PlansView } from './features/plans/PlansView';
import { WriteView } from './features/editor/WriteView';
import { WorkspaceTree } from './features/workspaces/WorkspaceTree';
import { WorkspaceView } from './features/workspaces/WorkspaceView';
import { CommandPalette } from './components/CommandPalette';

function useTheme(theme: ThemeId) {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

export async function importViaDialog() {
  const files = await host.pickFiles();
  if (!files.length) return;
  const books = await useStore.getState().importFiles(files);
  if (books.length === 1) useStore.getState().openBook(books[0].id);
}

function NavItem({ route, icon, label, count, match }: { route: Route; icon: JSX.Element; label: string; count?: number | string; match: Route['name'] }) {
  const current = useStore((s) => s.route.name);
  const navigate = useStore((s) => s.navigate);
  return (
    <button className={`nav-item ${current === match ? 'active' : ''}`} onClick={() => navigate(route)}>
      {icon} {label}
      {!!count && <span className="count">{count}</span>}
    </button>
  );
}

function Sidebar() {
  const nBooks = useStore((s) => s.books.length);
  const nHighlights = useStore((s) => s.highlights.length);
  const nConcepts = useStore((s) => s.concepts.length);
  const nDrafts = useStore((s) => s.drafts.length);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const due = useDueCount();

  return (
    <nav className="sidebar" aria-label="Navigation">
      <div className="sidebar-top drag" />
      <div className="sidebar-brand">Marginalia</div>
      <button className="nav-item" onClick={() => setCommandOpen(true)}>
        <Search size={15} /> Rechercher
        <span className="count">
          <Kbd>⌘K</Kbd>
        </span>
      </button>
      <div className="sidebar-scroll">
        <NavItem match="home" route={{ name: 'home' }} icon={<Home size={15} />} label="Accueil" />
        <NavItem match="library" route={{ name: 'library' }} icon={<BookOpen size={15} />} label="Bibliothèque" count={nBooks} />
        <NavItem match="write" route={{ name: 'write', draftId: null }} icon={<FilePen size={15} />} label="Écrits" count={nDrafts} />
        <div className="sidebar-section">Étudier</div>
        <NavItem match="extracts" route={{ name: 'extracts' }} icon={<Highlighter size={15} />} label="Extraits" count={nHighlights} />
        <NavItem match="concepts" route={{ name: 'concepts', conceptId: null }} icon={<Lightbulb size={15} />} label="Concepts" count={nConcepts} />
        <NavItem match="arguments" route={{ name: 'arguments', argumentId: null }} icon={<Sigma size={15} />} label="Arguments" />
        <NavItem match="plans" route={{ name: 'plans', planId: null }} icon={<ListTree size={15} />} label="Plans" />
        <NavItem match="revision" route={{ name: 'revision' }} icon={<Brain size={15} />} label="Révision" count={due || undefined} />
        <WorkspaceTree />
      </div>
      <button className="btn" style={{ margin: '8px 4px 0' }} onClick={importViaDialog}>
        <Plus size={15} /> Importer <span style={{ marginLeft: 'auto' }} /> <Kbd>⌘O</Kbd>
      </button>
    </nav>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} onClick={() => dismiss(t.id)}>
          {t.message}
          {t.action && (
            <button
              className="toast-action"
              onClick={(e) => {
                e.stopPropagation();
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Import en cours (depuis n'importe quelle vue) : fine barre indéterminée en haut de la fenêtre. */
function ImportProgress() {
  const importing = useStore((s) => s.importing);
  if (!importing) return null;
  return (
    <div className="progress-indeterminate import-progress anim-fade" role="progressbar" aria-label={importing > 1 ? `Import de ${importing} documents en cours` : 'Import en cours'} />
  );
}

function DropOverlay() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const files = await filesFromDrop(e.dataTransfer!.files);
      if (!files.length) {
        useStore.getState().toast('Format non pris en charge', 'error');
        return;
      }
      const books = await useStore.getState().importFiles(files);
      if (books.length === 1) useStore.getState().openBook(books[0].id);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, []);
  if (!over) return null;
  return (
    <div className="drop-overlay">
      <div className="drop-card">
        <Upload size={28} />
        <strong>Déposez pour importer</strong>
        <span className="muted">EPUB, PDF, Word, Markdown, TXT ou HTML</span>
      </div>
    </div>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const route = useStore((s) => s.route);
  const theme = useStore((s) => s.settings.theme);
  useTheme(theme);

  useEffect(() => {
    useStore.getState().init();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useStore.getState().setCommandOpen(!useStore.getState().commandOpen);
      } else if (e.key.toLowerCase() === 'o') {
        e.preventDefault();
        importViaDialog();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready)
    return (
      <div className="app" aria-busy="true" aria-label="Chargement de Marginalia">
        <div className="sidebar boot-sidebar anim-fade">
          {[46, 70, 62, 54, 0, 66, 58, 72, 50].map((w, i) => (w ? <div key={i} className="skeleton" style={{ width: `${w}%` }} /> : <div key={i} />))}
        </div>
        <div className="main boot-main">
          <div className="skeleton" style={{ height: 40, width: 260, marginBottom: 28 }} />
          <div className="skeleton" style={{ height: 120, borderRadius: 'var(--radius-lg)', marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 120, borderRadius: 'var(--radius-lg)' }} />
        </div>
      </div>
    );

  return (
    <>
      {route.name === 'reader' ? (
        <ReaderView key={route.bookId} bookId={route.bookId} tab={route.tab} splitBookId={route.splitBookId} />
      ) : (
        <div className="app">
          <Sidebar />
          <main className="main" key={route.name === 'workspace' ? route.workspaceId : route.name}>
            {route.name === 'home' && <HomeView />}
            {route.name === 'library' && <LibraryView />}
            {route.name === 'workspace' && <WorkspaceView key={route.workspaceId} workspaceId={route.workspaceId} groupId={route.groupId} />}
            {route.name === 'concepts' && <ConceptsView conceptId={route.conceptId} />}
            {route.name === 'extracts' && <AllExtractsView />}
            {route.name === 'arguments' && <ArgumentsView argumentId={route.argumentId} />}
            {route.name === 'revision' && <RevisionView />}
            {route.name === 'plans' && <PlansView planId={route.planId} />}
            {route.name === 'write' && <WriteView key={route.draftId ?? 'list'} draftId={route.draftId} />}
          </main>
        </div>
      )}
      <CommandPalette />
      <ImportProgress />
      <DropOverlay />
      <Toasts />
    </>
  );
}
