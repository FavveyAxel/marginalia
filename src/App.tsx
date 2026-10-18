// Styles de toutes les vues, en premier : même ordre de cascade qu'avant le découpage du code.
import './styles/cascade';
import { Suspense, useEffect, useState } from 'react';
import { BookOpen, Brain, CircleHelp, Settings2, PanelLeftClose, PanelLeftOpen, Coffee, FilePen, Highlighter, History, Home, Inbox, Laptop, Lightbulb, ListTree, Moon, Network, Plus, Search, Sigma, Sun, Trash2, Upload } from 'lucide-react';
import { useStore } from './lib/store';
import { host, filesFromDataTransfer } from './lib/platform';
import { UpdatesLayer } from './features/updates/Updates';
import type { Route, ThemeId } from './lib/types';
import { Kbd, PageSkeleton } from './components/ui';
import { lazyViews, loadAllViews, preloadViews } from './lazyViews';
import { HomeView } from './features/home/HomeView';
import { Mascot } from './features/mascot/Mascot';
import { LibraryView } from './features/library/LibraryView';
import { useDueCount } from './features/revision/useDueCount';
import { WorkspaceTree } from './features/workspaces/WorkspaceTree';
import { CommandPalette } from './components/CommandPalette';
import { bindPainterMenu } from './features/editor/painterMenu';
import { isTextEditingTarget } from './features/history/keys';
import { useAppleBooksSync } from './features/library/appleBooks';
import { useInboxSync, useInboxCount } from './features/inbox/inbox';
import { useResizeDiagnostics } from './lib/diagnostics';
import { useDocxMigration } from './features/library/docxMigration';
import { fmtKeys, isMac, isMod, isWindows, matchKeys } from './lib/keys';
import { useFormatRepair } from './features/library/formatRepair';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LockScreen } from './features/security/LockScreen';
import { SecurityAsk } from './features/security/SecurityAsk';
import { refreshSecurity, useSecurity } from './features/security/state';
import type { SecurityStatus } from './lib/platform';

// Vues chargées à la demande (découpage du code) : l'accueil et la bibliothèque sont dans le paquet
// principal, le reste (lecteur, éditeur, carte, révision…) est préchargé en arrière-plan après l'affichage.
const { ReaderView, ConceptsView, AllExtractsView, ArgumentsView, RevisionView, PlansView, WriteView, WorkspaceView, TrashView, InboxView, ImportView, HistoryView, HelpView, BoardView, MapsView, SettingsView } = lazyViews;

// Thème choisi, gardé aussi hors de la base (préférence d'affichage, sans donnée personnelle) :
// l'écran de verrouillage s'affiche avant que la base soit lisible.
const LAST_THEME_KEY = 'marginalia.lastTheme';
function lastTheme(): ThemeId {
  try {
    const v = localStorage.getItem(LAST_THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'sepia' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function useTheme(theme: ThemeId, remember: boolean) {
  useEffect(() => {
    if (remember) {
      try {
        localStorage.setItem(LAST_THEME_KEY, theme);
      } catch {
        /* stockage indisponible */
      }
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      // Menus et fond de fenêtre natifs alignés sur le choix (sépia = clair côté système) ;
      // hors Mac, les boutons de fenêtre prennent le fond et l'encre du thème affiché.
      host.setTheme?.(theme === 'system' ? 'system' : theme === 'dark' ? 'dark' : 'light', isMac ? undefined : titleBarColors()).catch(() => {});
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, remember]);
}

/** Verrouillage après inactivité : les gestes de l'utilisateur sont signalés (au plus toutes les 10 s). */
function useActivityPing(active: boolean) {
  useEffect(() => {
    const api = host.security;
    if (!active || !api) return;
    let last = 0;
    const ping = () => {
      const now = Date.now();
      if (now - last < 10_000) return;
      last = now;
      api.activity();
    };
    const evs = ['pointerdown', 'keydown', 'wheel', 'mousemove', 'touchstart'] as const;
    for (const e of evs) window.addEventListener(e, ping, { capture: true, passive: true });
    return () => {
      for (const e of evs) window.removeEventListener(e, ping, { capture: true });
    };
  }, [active]);
}

/** Couleurs du thème affiché (#rrggbb) pour les boutons de fenêtre de Windows. */
function titleBarColors(): { color: string; symbolColor: string } | undefined {
  const css = getComputedStyle(document.documentElement);
  const hex = (v: string) => {
    const t = v.trim();
    if (/^#[0-9a-f]{6}$/i.test(t)) return t;
    if (/^#[0-9a-f]{3}$/i.test(t)) return '#' + [...t.slice(1)].map((c) => c + c).join('');
    const m = t.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? '#' + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('') : null;
  };
  const color = hex(css.getPropertyValue('--bg-app'));
  const symbolColor = hex(css.getPropertyValue('--ink-2'));
  return color && symbolColor ? { color, symbolColor } : undefined;
}

/**
 * Windows : la barre de menus native est cachée avec la barre de titre. Alt seul (relâché sans
 * autre touche) ou F10 l'ouvre ; les commandes Importer et Aide des menus arrivent ici.
 */
function useNativeMenu() {
  useEffect(() => {
    const offMenu = host.onMenuCommand?.((cmd) => {
      if (cmd === 'import') void importViaDialog();
      else if (cmd === 'help') useStore.getState().navigate({ name: 'help' });
    });
    // Édition › Copier / Coller la mise en forme (⌥⌘C / ⌥⌘V, Ctrl+Maj+C / V) → pinceau de l'éditeur.
    const offPainter = bindPainterMenu();
    if (isMac || !host.popupMenu)
      return () => {
        offMenu?.();
        offPainter();
      };
    let altAlone = false;
    // Bouton de souris enfoncé : Alt modifie le geste en cours (glisser-déposer : Alt = copier), pas de menu.
    let pressed = false;
    const down = (e: KeyboardEvent) => {
      altAlone = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey && !pressed;
      if (e.key === 'F10' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        void host.popupMenu?.();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && altAlone) {
        e.preventDefault();
        void host.popupMenu?.();
      }
      altAlone = false;
    };
    const reset = () => (altAlone = false);
    const pDown = () => {
      pressed = true;
      altAlone = false;
    };
    const pUp = () => {
      pressed = false;
      altAlone = false;
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('mousedown', reset, true);
    window.addEventListener('pointerdown', pDown, true);
    window.addEventListener('pointerup', pUp, true);
    return () => {
      offMenu?.();
      offPainter();
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('mousedown', reset, true);
      window.removeEventListener('pointerdown', pDown, true);
      window.removeEventListener('pointerup', pUp, true);
    };
  }, []);
}

/**
 * Déplacement de la fenêtre par les barres du haut, en JS (pas de -webkit-app-region,
 * dont le recalcul sur macOS provoquait saccades et redimensionnements involontaires).
 */
const DRAG_ZONES = '.topbar, .drag, .sidebar-top, .sidebar-brand';
const NOT_DRAG = 'button, a, input, textarea, select, label, [role="button"], [role="tab"], [contenteditable="true"], .no-drag, .segmented, .floating';
function useWindowDrag() {
  useEffect(() => {
    // Windows : zones -webkit-app-region natives (voir .platform-win dans app.css).
    if (!host.windowDragStart || isWindows) return;
    let dragging = false;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest(DRAG_ZONES) || t.closest(NOT_DRAG)) return;
      e.preventDefault();
      if (e.detail === 2) {
        host.windowDoubleClick?.();
        return;
      }
      dragging = true;
      host.windowDragStart?.();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      host.windowDragEnd?.();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('blur', onUp);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('blur', onUp);
    };
  }, []);
}



const THEMES: { id: ThemeId; label: string; icon: JSX.Element }[] = [
  { id: 'system', label: isMac ? 'Automatique (suit le Mac)' : 'Automatique (suit le système)', icon: <Laptop size={14} /> },
  { id: 'light', label: 'Clair', icon: <Sun size={14} /> },
  { id: 'dark', label: 'Sombre', icon: <Moon size={14} /> },
  { id: 'sepia', label: 'Sépia', icon: <Coffee size={14} /> },
];

function AppearanceSwitch() {
  const theme = useStore((s) => s.settings.theme);
  const updateSettings = useStore((s) => s.updateSettings);
  return (
    <div className="appearance" role="radiogroup" aria-label="Apparence">
      <span className="appearance-label">Apparence</span>
      <div className="segmented appearance-seg">
        {THEMES.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={theme === t.id}
            aria-label={t.label}
            title={t.label}
            className={theme === t.id ? 'active' : ''}
            onClick={() => updateSettings({ theme: t.id })}
          >
            {t.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

export async function importViaDialog() {
  const files = await host.pickFiles();
  if (!files.length) return;
  const books = await useStore.getState().importFiles(files);
  if (books.length === 1) useStore.getState().openBook(books[0].id);
}

/** Bouton « Importer » : ouvre la page Importer (en gardant l'espace d'où l'on vient). */
export function openImport() {
  const r = useStore.getState().route;
  useStore.getState().navigate(r.name === 'workspace' ? { name: 'import', workspaceId: r.workspaceId, groupId: r.groupId } : { name: 'import' });
}

/** Outil du bas de la barre : icône seule (libellé en infobulle), pastille si besoin. */
function FootItem({ route, icon, label, count, match }: { route: Route; icon: JSX.Element; label: string; count?: number; match: Route['name'] }) {
  const current = useStore((s) => s.route.name);
  const navigate = useStore((s) => s.navigate);
  return (
    <button className={`nav-item foot-item ${current === match ? 'active' : ''}`} onClick={() => navigate(route)} title={count ? `${label} (${count})` : label} aria-label={label} aria-current={current === match ? 'page' : undefined}>
      {icon}
      {!!count && <span className="foot-dot" aria-hidden="true" />}
    </button>
  );
}

/** Boîte de réception, à côté d'« Importer » : ce qui arrive du téléphone. */
function InboxButton({ n, rail }: { n: number; rail?: boolean }) {
  const current = useStore((s) => s.route.name);
  const label = n ? `Boîte de réception : ${n} élément${n > 1 ? 's' : ''} reçu${n > 1 ? 's' : ''} du téléphone` : 'Boîte de réception (rien en attente)';
  return (
    <button
      className={`icon-btn inbox-btn ${rail ? 'rail' : ''} ${current === 'inbox' ? 'active' : ''}`}
      onClick={() => useStore.getState().navigate({ name: 'inbox' })}
      title={label}
      aria-label={label}
    >
      <Inbox size={16} />
      {n > 0 && <span className="inbox-badge">{n > 9 ? '9+' : n}</span>}
    </button>
  );
}

function NavItem({ route, icon, label, count, match, activeAlso, alert }: { route: Route; icon: JSX.Element; label: string; count?: number | string; match: Route['name']; activeAlso?: Route['name']; alert?: string }) {
  const current = useStore((s) => s.route.name);
  const navigate = useStore((s) => s.navigate);
  return (
    <button className={`nav-item ${current === match || (!!activeAlso && current === activeAlso) ? 'active' : ''}`} onClick={() => navigate(route)} title={label} aria-label={label}>
      {icon} <span className="nav-label">{label}</span>
      {alert && (
        <span className="nav-alert" title={alert} aria-label={alert} role="img">
          !
        </span>
      )}
      {!!count && <span className="count">{count}</span>}
    </button>
  );
}

function Sidebar() {
  const nBooks = useStore((s) => s.books.length);
  const nHighlights = useStore((s) => s.highlights.length);
  const nConcepts = useStore((s) => s.concepts.length);
  const nDrafts = useStore((s) => s.drafts.length);
  // Cartes libres + cartes de livre / de mouvement non vides (même compte que la vue « Cartes »).
  const nMaps = useStore((s) => {
    let n = 0;
    for (const m of Object.values(s.maps)) if (m.kind === 'board' || (m.nodes.length && s.books.some((b) => b.id === m.bookId))) n++;
    return n;
  });
  const nTrash = useStore((s) => s.trash.length);
  const inboxOn = useStore((s) => !!s.settings.inbox);
  const routeName = useStore((s) => s.route.name);
  // Boîte de réception : toujours accessible dans l'app de bureau (réception par le Wi-Fi).
  const inboxAvail = host.kind === 'electron' && !!host.inbox?.wifiStart;
  const nInbox = useInboxCount();
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const due = useDueCount();
  const collapsed = useStore((s) => !!s.settings.sidebarCollapsed);
  const workspaces = useStore((s) => s.workspaces);
  const route = useStore((s) => s.route);
  const toggle = () => useStore.getState().updateSettings({ sidebarCollapsed: !collapsed });

  return (
    <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Navigation">
      <div className="sidebar-top drag">
        <button
          className="icon-btn sm sidebar-toggle"
          onClick={toggle}
          title={fmtKeys(collapsed ? 'Afficher la barre latérale (⌃⌘S)' : 'Replier la barre latérale (⌃⌘S)')}
          aria-label={collapsed ? 'Afficher la barre latérale' : 'Replier la barre latérale'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>
      {!collapsed && <div className="sidebar-brand">Marginalia</div>}
      <button className="nav-item" onClick={() => setCommandOpen(true)} title={fmtKeys('Rechercher (⌘K)')} aria-label="Rechercher">
        <Search size={15} /> <span className="nav-label">Rechercher</span>
        <span className="count">
          <Kbd>⌘K</Kbd>
        </span>
      </button>
      <div className="sidebar-scroll">
        <NavItem match="home" route={{ name: 'home' }} icon={<Home size={15} />} label="Accueil" />
        <NavItem match="library" activeAlso="inbox" route={{ name: 'library' }} icon={<BookOpen size={15} />} label="Bibliothèque" count={nBooks} alert={nInbox ? (nInbox === 1 ? 'Un élément reçu du téléphone attend votre décision' : `${nInbox} éléments reçus du téléphone attendent votre décision`) : undefined} />
        <NavItem match="write" route={{ name: 'write', draftId: null }} icon={<FilePen size={15} />} label="Écrits" count={nDrafts} />
        <NavItem match="maps" route={{ name: 'maps' }} icon={<Network size={15} />} label="Cartes" count={nMaps} />
        <div className="sidebar-section">Étudier</div>
        <NavItem match="extracts" route={{ name: 'extracts' }} icon={<Highlighter size={15} />} label="Extraits" count={nHighlights} />
        <NavItem match="concepts" route={{ name: 'concepts', conceptId: null }} icon={<Lightbulb size={15} />} label="Concepts" count={nConcepts} />
        <NavItem match="arguments" route={{ name: 'arguments', argumentId: null }} icon={<Sigma size={15} />} label="Arguments" />
        <NavItem match="plans" route={{ name: 'plans', planId: null }} icon={<ListTree size={15} />} label="Plans" />
        <NavItem match="revision" route={{ name: 'revision' }} icon={<Brain size={15} />} label="Révision" count={due || undefined} />
        {collapsed ? (
          <>
            {workspaces.length > 0 && <div className="sidebar-section" aria-hidden="true" />}
            {workspaces.map((w) => (
              <button
                key={w.id}
                className={`nav-item rail-ws ${route.name === 'workspace' && route.workspaceId === w.id ? 'active' : ''}`}
                title={w.name}
                aria-label={`Espace ${w.name}`}
                onClick={() => useStore.getState().navigate({ name: 'workspace', workspaceId: w.id, groupId: null })}
              >
                <span className="rail-dot" style={{ background: `var(${w.tint})` }}>
                  {w.name.trim().charAt(0).toUpperCase()}
                </span>
              </button>
            ))}
          </>
        ) : (
          <WorkspaceTree />
        )}
      </div>
      <div className="sidebar-foot foot-row" role="group" aria-label="Outils">
        <FootItem match="history" route={{ name: 'history' }} icon={<History size={16} />} label="Historique" />
        <FootItem match="trash" route={{ name: 'trash' }} icon={<Trash2 size={16} />} label="Corbeille" count={nTrash} />
        <FootItem match="settings" route={{ name: 'settings' }} icon={<Settings2 size={16} />} label="Réglages" />
        <FootItem match="help" route={{ name: 'help' }} icon={<CircleHelp size={16} />} label="Aide" />
      </div>
      {!collapsed && <AppearanceSwitch />}
      {collapsed ? (
        <>
          <button className="icon-btn rail-import" onClick={openImport} title="Importer" aria-label="Importer">
            <Plus size={16} />
          </button>
          {(inboxOn || inboxAvail) && <InboxButton n={nInbox} rail />}
        </>
      ) : (
        <div className="import-row">
          <button className={`btn import-btn ${routeName === 'import' ? 'active' : ''}`} onClick={openImport} aria-current={routeName === 'import' ? 'page' : undefined}>
            <Plus size={15} /> Importer <span style={{ marginLeft: 'auto' }} /> <Kbd>⌘O</Kbd>
          </button>
          {(inboxOn || inboxAvail) && <InboxButton n={nInbox} />}
        </div>
      )}
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
  // Page « Importer » : sa propre zone de dépôt (le calque la masquerait).
  const onImportPage = useStore((s) => s.route.name === 'import');
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
      const { files } = await filesFromDataTransfer(e.dataTransfer!);
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
  if (!over || onImportPage) return null;
  return (
    <div className="drop-overlay">
      <div className="drop-card">
        <Upload size={28} />
        <strong>Déposez pour importer</strong>
        <span className="muted">Fichiers ou dossiers : EPUB, PDF, Word, Markdown, TXT, HTML, photos</span>
      </div>
    </div>
  );
}

/** Ouverture du lecteur avant que son code soit chargé (bref) : page fantôme plein écran. */
function ReaderFallback() {
  return (
    <div className="reader-fallback" aria-busy="true" style={{ height: '100vh', display: 'flex', background: 'var(--bg-app)' }}>
      <PageSkeleton />
    </div>
  );
}

/** Nom des vues dans le journal et pour les tests (ErrorBoundary). */
const VIEW_NAMES: Partial<Record<Route['name'], string>> = { write: 'éditeur', board: 'carte', workspace: 'espaces', home: 'accueil', library: 'bibliothèque' };
const goHome = () => useStore.getState().navigate({ name: 'home' });

export function App() {
  const ready = useStore((s) => s.ready);
  const route = useStore((s) => s.route);
  const theme = useStore((s) => s.settings.theme);
  // App de bureau : la base n'est chargée qu'une fois Marginalia déverrouillé (option « Verrouiller »).
  const [gate, setGate] = useState<'checking' | 'locked' | 'open'>(host.security ? 'checking' : 'open');
  const [lockStatus, setLockStatus] = useState<SecurityStatus | null>(null);
  const security = useSecurity();
  useTheme(ready ? theme : lastTheme(), ready);
  useActivityPing(ready && !!security?.lock);
  useWindowDrag();
  useNativeMenu();
  useAppleBooksSync();
  useInboxSync();
  useDocxMigration();
  useFormatRepair();
  useResizeDiagnostics();

  useEffect(() => {
    if (gate !== 'checking') return;
    refreshSecurity()
      .then((st) => {
        setLockStatus(st);
        setGate(st && st.locked ? 'locked' : 'open');
      })
      .catch(() => setGate('open'));
  }, [gate]);

  useEffect(() => {
    if (gate !== 'open') return;
    if (import.meta.env.DEV) void loadAllViews().then(() => useStore.getState().init());
    else useStore.getState().init();
  }, [gate]);

  // Une fois l'interface affichée : précharger en tâche de fond les vues probables (lecteur d'abord).
  useEffect(() => {
    if (ready) return preloadViews();
  }, [ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌃⌘S (Mac) / Ctrl+Maj+B (Windows) : barre latérale.
      if (matchKeys(e, '⌃⌘S')) {
        e.preventDefault();
        const st = useStore.getState();
        st.updateSettings({ sidebarCollapsed: !st.settings.sidebarCollapsed });
        return;
      }
      // Windows : F1 ouvre l'aide.
      if (!isMac && e.key === 'F1' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        useStore.getState().navigate({ name: 'help' });
        return;
      }
      if (!isMod(e)) return;
      if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
        e.preventDefault();
        useStore.getState().navigate({ name: 'help' });
        return;
      }
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useStore.getState().setCommandOpen(!useStore.getState().commandOpen);
      } else if (e.key.toLowerCase() === 'o') {
        e.preventDefault();
        importViaDialog();
      } else if ((e.key.toLowerCase() === 'z' || (!isMac && !e.shiftKey && e.key.toLowerCase() === 'y')) && !e.altKey) {
        // Annuler / rétablir global : hors des champs de saisie et de l'éditeur (qui ont le leur).
        // Windows : Ctrl+Y rétablit aussi.
        if (isTextEditingTarget(e.target)) return;
        // Décision différée : un module qui gère lui-même ⌘Z (séance de révision…) l'a alors signalé
        // par preventDefault, même si son écouteur a été posé après celui-ci.
        const redo = e.shiftKey || e.key.toLowerCase() === 'y';
        setTimeout(() => {
          const s = useStore.getState();
          if (e.defaultPrevented || s.commandOpen) return;
          if (s.route.name === 'write' && s.route.draftId) return;
          if (redo) s.redo();
          else s.undo();
        }, 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (gate === 'locked' && lockStatus)
    return (
      <LockScreen
        status={lockStatus}
        onUnlocked={() => {
          void refreshSecurity();
          setGate('open');
        }}
      />
    );

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
        <ErrorBoundary key={route.bookId} view="lecteur" onHome={goHome}>
          <Suspense fallback={<ReaderFallback />}>
            <ReaderView key={route.bookId} bookId={route.bookId} tab={route.tab} splitBookId={route.splitBookId} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <div className="app">
          <Sidebar />
          <main className="main" key={route.name === 'workspace' ? route.workspaceId : route.name === 'board' ? 'board:' + route.boardId : route.name}>
            <ErrorBoundary view={VIEW_NAMES[route.name] ?? route.name} onHome={route.name === 'home' ? undefined : goHome}>
            <Suspense fallback={<PageSkeleton />}>
            {route.name === 'home' && <HomeView />}
            {route.name === 'library' && <LibraryView />}
            {route.name === 'workspace' && <WorkspaceView key={route.workspaceId} workspaceId={route.workspaceId} groupId={route.groupId} />}
            {route.name === 'concepts' && <ConceptsView conceptId={route.conceptId} />}
            {route.name === 'extracts' && <AllExtractsView />}
            {route.name === 'arguments' && <ArgumentsView argumentId={route.argumentId} />}
            {route.name === 'revision' && <RevisionView />}
            {route.name === 'plans' && <PlansView planId={route.planId} />}
            {route.name === 'write' && <WriteView key={route.draftId ?? 'list'} draftId={route.draftId} />}
            {route.name === 'trash' && <TrashView />}
            {route.name === 'inbox' && <InboxView />}
            {route.name === 'import' && <ImportView key={route.workspaceId ?? ''} workspaceId={route.workspaceId} />}
            {route.name === 'history' && <HistoryView />}
            {route.name === 'help' && <HelpView />}
            {route.name === 'board' && <BoardView key={route.boardId} boardId={route.boardId} />}
            {route.name === 'maps' && <MapsView />}
            {route.name === 'settings' && <SettingsView />}
            </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      )}
      <Mascot route={route.name} workspaceId={route.name === 'workspace' ? route.workspaceId : undefined} />
      <CommandPalette />
      <UpdatesLayer />
      <ImportProgress />
      <DropOverlay />
      <SecurityAsk />
      <Toasts />
    </>
  );
}
