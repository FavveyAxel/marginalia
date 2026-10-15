// Page d'une carte libre (« board ») : titre renommable, retour vers l'espace d'origine,
// panneau « Ajouter » (extraits de tous les livres, autres cartes, concepts, idées) et le
// composant de carte générique en mode `board` (voir BoardCanvas).
import { useMemo, useState } from 'react';
import { ArrowLeft, FileDown, FilePen, ListTree, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { Route } from '../../lib/types';
import { ContextMenu, InlineName, useMenu, type MenuEntry } from '../workspaces/wsUi';
import { boardSource } from './BoardCanvas';
import { MapStage } from './ui/stage/MapStage';
import { ConvertDialog, type ConvertKind } from './ui/convert/ConvertDialog';
import { AddPanel } from './board/AddPanel';
import { boardTitle, deleteMap, renameMap, saveMapPdf } from './model/actions';
import { isBoard } from './model/boards';
import './board/board.css';

// Retour : vers la vue d'où l'on vient (espace, ⌘K…), sinon vers l'espace qui contient la carte.
let returnRoute: Route | null = null;
useStore.subscribe((s, prev) => {
  if (s.route.name === 'board' && prev.route.name !== 'board' && prev.route.name !== 'reader') returnRoute = prev.route;
});

function backTarget(boardId: string): { route: Route; label: string } {
  const s = useStore.getState();
  const r = returnRoute;
  if (r && r.name === 'workspace') {
    const ws = s.workspaces.find((w) => w.id === r.workspaceId);
    if (ws) {
      const g = r.groupId ? s.groups.find((x) => x.id === r.groupId) : null;
      return { route: r, label: g?.name ?? ws.name };
    }
  }
  const it = s.wsItems.find((i) => i.kind === 'map' && i.refId === boardId && s.workspaces.some((w) => w.id === i.workspaceId));
  if (it) {
    const ws = s.workspaces.find((w) => w.id === it.workspaceId)!;
    const g = it.groupId ? s.groups.find((x) => x.id === it.groupId) : null;
    return { route: { name: 'workspace', workspaceId: ws.id, groupId: g ? g.id : null }, label: g?.name ?? ws.name };
  }
  const LABEL: Partial<Record<Route['name'], string>> = { home: 'Accueil', history: 'Historique', trash: 'Corbeille', library: 'Bibliothèque' };
  if (r && r.name !== 'board' && LABEL[r.name]) return { route: r, label: LABEL[r.name]! };
  return { route: { name: 'home' }, label: 'Accueil' };
}

export function BoardView({ boardId }: { boardId: string }) {
  const map = useStore((s) => s.maps[boardId]);
  // Re-rendu quand le titre ou l'espace d'origine change.
  useStore((s) => s.wsItems);
  useStore((s) => s.workspaces);
  const navigate = useStore((s) => s.navigate);
  const [editTitle, setEditTitle] = useState(false);
  const [adding, setAdding] = useState(() => !!map && map.nodes.length === 0);
  const m = useMenu();
  const back = backTarget(boardId);
  const [convert, setConvert] = useState<ConvertKind | null>(null);
  const source = useMemo(() => boardSource(boardId), [boardId]);

  if (!map || !isBoard(map)) {
    return (
      <div className="board-view anim-view">
        <header className="topbar">
          <button className="btn btn-ghost board-back" onClick={() => navigate(back.route)}>
            <ArrowLeft size={14} /> {back.label}
          </button>
        </header>
        <div className="empty">
          <h3>Cette carte n’existe plus</h3>
          <p>Elle a été supprimée. Elle reste 30 jours dans la corbeille, d’où vous pouvez la restaurer.</p>
          <button className="btn btn-primary" onClick={() => navigate({ name: 'trash' })}>
            Ouvrir la corbeille
          </button>
        </div>
      </div>
    );
  }

  const title = boardTitle(boardId);
  const run = (p: Promise<unknown>, err: string) => p.catch((e) => (console.error(e), useStore.getState().toast(err, 'error')));
  const entries = (): MenuEntry[] => [
    { label: 'Renommer', icon: <Pencil size={14} />, onClick: () => setEditTitle(true) },
    { sep: true },
    {
      label: 'Transformer en plan',
      icon: <ListTree size={14} />,
      disabled: !map.nodes.length,
      onClick: () => setConvert('plan'),
    },
    {
      label: 'Transformer en écrit',
      icon: <FilePen size={14} />,
      disabled: !map.nodes.length,
      onClick: () => setConvert('draft'),
    },
    { label: 'Exporter en PDF…', icon: <FileDown size={14} />, disabled: !map.nodes.length, onClick: () => void run(saveMapPdf(boardId), 'Export PDF impossible') },
    { sep: true },
    {
      label: 'Supprimer la carte',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => {
        const target = backTarget(boardId).route;
        if (deleteMap(boardId)) navigate(target);
      },
    },
  ];

  return (
    <div className="board-view anim-view">
      <header className="topbar board-top">
        <button className="btn btn-ghost board-back" onClick={() => navigate(back.route)} title={`Retour à « ${back.label} »`} data-testid="board-back">
          <ArrowLeft size={14} /> <span className="truncate">{back.label}</span>
        </button>
        <span className="board-sep" />
        {editTitle ? (
          <InlineName
            className="board-title-input"
            label="Titre de la carte"
            initial={title}
            placeholder="Titre de la carte"
            onCancel={() => setEditTitle(false)}
            onSubmit={(v) => {
              renameMap(boardId, v);
              setEditTitle(false);
            }}
          />
        ) : (
          <h1 className="board-title truncate" onClick={() => setEditTitle(true)} title="Cliquer pour renommer" data-testid="board-title">
            {title}
            <Pencil size={13} className="board-title-pen" />
          </h1>
        )}
        <span className="spacer" />
        <span className="muted board-count">
          {map.nodes.length} carte{map.nodes.length > 1 ? 's' : ''}
          {map.edges.length > 0 && ` · ${map.edges.length} lien${map.edges.length > 1 ? 's' : ''}`}
        </span>
        <button className={`btn ${adding ? 'board-add-on' : 'btn-primary'}`} aria-pressed={adding} onClick={() => setAdding(!adding)} data-testid="board-add-toggle">
          <Plus size={14} /> Ajouter
        </button>
        <button
          className="icon-btn"
          aria-label="Actions de la carte"
          title="Actions"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            m.open(Math.max(8, r.right - 230), r.bottom + 4, entries(), 'Actions de la carte');
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </header>
      <div className="board-body">
        <div className="board-canvas">
          <MapStage mapKey={boardId} source={source} bookId={map.bookIds?.[0] ?? null} />
        </div>
        {adding && <AddPanel boardKey={boardId} onClose={() => setAdding(false)} />}
      </div>
      {convert && <ConvertDialog mapKey={boardId} kind={convert} onClose={() => setConvert(null)} />}
      {m.menu && <ContextMenu x={m.menu.x} y={m.menu.y} entries={m.menu.entries} label={m.menu.label} onClose={m.close} />}
    </div>
  );
}
