// Vues chargées à la demande (React.lazy) et leur préchargement en arrière-plan.
// Pourquoi : le paquet principal embarquait tout (pdf.js, carte @xyflow, éditeur, révision…),
// soit ~1,8 Mo de JavaScript à analyser avant le premier affichage. L'accueil et la bibliothèque
// restent dans le paquet principal ; le reste est préchargé dès que le fil principal est libre,
// si bien qu'en pratique les vues s'ouvrent comme avant, sans écran de chargement.
import { lazy, type ComponentType } from 'react';

type Loader = () => Promise<unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K): ComponentType<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType<any> })));
}

const load = {
  reader: () => import('./features/reader/ReaderView'),
  write: () => import('./features/editor/WriteView'),
  workspace: () => import('./features/workspaces/WorkspaceView'),
  extracts: () => import('./features/annotations/AllExtractsView'),
  concepts: () => import('./features/concepts/ConceptsView'),
  board: () => import('./features/map/BoardView'),
  plans: () => import('./features/plans/PlansView'),
  arguments: () => import('./features/arguments/ArgumentsView'),
  revision: () => import('./features/revision/RevisionView'),
  trash: () => import('./features/trash/TrashView'),
  inbox: () => import('./features/inbox/InboxView'),
  import: () => import('./features/library/ImportView'),
  history: () => import('./features/history/HistoryView'),
  help: () => import('./features/help/HelpView'),
  maps: () => import('./features/maps/MapsView'),
  settings: () => import('./features/security/SettingsView'),
  paper: () => import('./features/paper/PaperBookView'),
};

export const lazyViews = {
  ReaderView: lazyNamed(load.reader, 'ReaderView'),
  WriteView: lazyNamed(load.write, 'WriteView'),
  WorkspaceView: lazyNamed(load.workspace, 'WorkspaceView'),
  AllExtractsView: lazyNamed(load.extracts, 'AllExtractsView'),
  ConceptsView: lazyNamed(load.concepts, 'ConceptsView'),
  BoardView: lazyNamed(load.board, 'BoardView'),
  PlansView: lazyNamed(load.plans, 'PlansView'),
  ArgumentsView: lazyNamed(load.arguments, 'ArgumentsView'),
  RevisionView: lazyNamed(load.revision, 'RevisionView'),
  TrashView: lazyNamed(load.trash, 'TrashView'),
  InboxView: lazyNamed(load.inbox, 'InboxView'),
  ImportView: lazyNamed(load.import, 'ImportView'),
  HistoryView: lazyNamed(load.history, 'HistoryView'),
  HelpView: lazyNamed(load.help, 'HelpView'),
  MapsView: lazyNamed(load.maps, 'MapsView'),
  SettingsView: lazyNamed(load.settings, 'SettingsView'),
  PaperBookView: lazyNamed(load.paper, 'PaperBookView'),
};

/** Ordre de préchargement : du plus probable au moins probable. */
const PRELOAD: Loader[] = [load.reader, load.write, load.workspace, load.extracts, load.concepts, load.board, load.plans, load.arguments, load.revision, load.trash, load.import, load.history, load.help, load.maps, load.settings, load.paper];

/**
 * Charge toutes les vues. Sert en développement (serveur Vite, tests de bout en bout), où chaque
 * module est transformé à la demande : l'app attend ce chargement avant de s'initialiser, comme
 * lorsque les vues étaient dans le paquet principal (aucune vue en chargement pendant un test).
 */
export function loadAllViews(): Promise<void> {
  return Promise.all(PRELOAD.map((l) => l().catch(() => {}))).then(() => {});
}

const idle = (fn: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout: 1500 });
    return () => cancelIdleCallback(id);
  }
  const t = setTimeout(fn, 200);
  return () => clearTimeout(t);
};

/** Précharge les vues une à une, pendant les temps morts du fil principal. Renvoie l'annulation. */
export function preloadViews(): () => void {
  let cancel = () => {};
  let stopped = false;
  let i = 0;
  const next = () => {
    if (stopped || i >= PRELOAD.length) return;
    const loader = PRELOAD[i++];
    loader()
      .catch(() => {
        /* chargé à nouveau à l'ouverture de la vue, où l'erreur sera visible */
      })
      .finally(() => {
        cancel = idle(next);
      });
  };
  // Laisser d'abord l'accueil se peindre.
  const t = setTimeout(() => (cancel = idle(next)), 300);
  return () => {
    stopped = true;
    clearTimeout(t);
    cancel();
  };
}
