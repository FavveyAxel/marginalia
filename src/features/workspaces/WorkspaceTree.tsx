// Section « Espaces » de la barre latérale : espaces, groupes, sous-groupes et éléments.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useMultiSelect, type MultiSelect } from '../../lib/useMultiSelect';
import { ChevronRight, Folder, FolderOpen, MoreHorizontal, Plus } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { WorkspaceGroup } from '../../lib/types';
import {
  countInGroup,
  goToWorkspace,
  openItem,
  renameGroup,
  renameWorkspace,
  sortedGroups,
  useResolvedItems,
  useWorkspaces,
  type DragPayload,
  type ResolvedItem,
} from './wsModel';
import { ContextMenu, InlineName, ItemIcon, dragSource, dropProps, useMenu, type DropArgs, type DropMark, type MenuEntry } from './wsUi';
import { groupMenu, itemMenu, workspaceMenu } from './wsMenus';
import { CollabBadge, useCollabMark } from '../collab/SidebarCollab';
import { useWsDialogs } from './wsDialogs';
import { importHere, newBoardHere, newDraftHere } from './wsActions';
import { SelectionBar, useSelOwner, useSelectionActions } from './wsSelection';
import './workspaces.css';

type Editing = { t: 'newWs' } | { t: 'newGroup'; workspaceId: string; parentId: string | null } | { t: 'rename'; kind: 'ws' | 'group'; id: string };

interface Env {
  groups: WorkspaceGroup[];
  editing: Editing | null;
  setEditing(e: Editing | null): void;
  drop: DropMark | null;
  setDrop(d: DropMark | null): void;
  menu(e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, entries: MenuEntry[], label: string): void;
  menuFrom(el: HTMLElement, entries: MenuEntry[], label: string): void;
  ctx: ReturnType<typeof useWsDialogs>['ctx'];
  collapsedWs: Set<string>;
  toggleWs(id: string, open?: boolean): void;
  expandLater(key: string, run: () => void): void;
  cancelExpand(): void;
  route: ReturnType<typeof useStore.getState>['route'];
  activeWs: string | null;
  /** Sélection multiple des éléments (⌘-clic, ⇧-clic), limitée à un espace à la fois. */
  sel: MultiSelect;
  /** Clic sur un élément : true si consommé par la sélection. */
  selClick(itemId: string, workspaceId: string, e: ReactMouseEvent): boolean;
  selEntries(): MenuEntry[];
}
const EnvCtx = createContext<Env>(null as unknown as Env);

const LS_KEY = 'marginalia.ws.collapsed';
const readCollapsed = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
};

/** Conteneur animé (hauteur + opacité) : le contenu reste monté pour animer l'ouverture comme la fermeture. */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`ws-collapse ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="ws-collapse-inner">{children}</div>
    </div>
  );
}

export function WorkspaceTree() {
  const workspaces = useWorkspaces();
  const groups = useStore((s) => s.groups);
  const route = useStore((s) => s.route);
  const activeWs = useStore((s) => s.settings.activeWorkspaceId);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [drop, setDrop] = useState<DropMark | null>(null);
  const [collapsedWs, setCollapsedWs] = useState<Set<string>>(readCollapsed);
  const m = useMenu();
  const timer = useRef<{ key: string; id: ReturnType<typeof setTimeout> } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wsItems = useStore((s) => s.wsItems);

  // Ordre affiché des éléments (lignes visibles : espaces et groupes dépliés), relu dans le DOM.
  const [order, setOrder] = useState<string[]>([]);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ids = Array.from(el.querySelectorAll<HTMLElement>('[data-sel-id]'))
      .filter((x) => !x.closest('[aria-hidden="true"]'))
      .map((x) => x.dataset.selId!);
    if (ids.join('|') !== order.join('|')) setOrder(ids);
  });
  const sel = useMultiSelect(order);
  const selWs = sel.size ? (wsItems.find((i) => i.id === sel.ids[0])?.workspaceId ?? null) : null;
  const owner = useSelOwner((s) => s.owner);
  const claim = useSelOwner((s) => s.claim);
  useEffect(() => {
    if (sel.size && owner !== 'tree') claim('tree');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.size]);
  useEffect(() => {
    // La vue a pris la main (ou un clic dans son vide a rendu la main) : la sélection de l'arbre s'efface.
    if (owner !== 'tree' && sel.size) sel.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);
  // Échap vide la sélection de l'arbre même quand le focus a quitté la barre latérale.
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    if (!sel.size) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [aria-modal="true"]')) return;
      e.preventDefault();
      selRef.current.clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel.size]);

  const toggleWs = (id: string, open?: boolean) =>
    setCollapsedWs((prev) => {
      const next = new Set(prev);
      const shouldOpen = open ?? next.has(id);
      if (shouldOpen) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify([...next]));
      } catch {
        /* stockage indisponible */
      }
      return next;
    });

  const { ctx, dialogs } = useWsDialogs({
    newGroup: (workspaceId, parentId) => {
      if (parentId) useStore.getState().patch('groups', parentId, { collapsed: false });
      else toggleWs(workspaceId, true);
      setEditing({ t: 'newGroup', workspaceId, parentId });
    },
    rename: (kind, id) => setEditing({ t: 'rename', kind, id }),
    importHere: (w, g) => void importHere(w, g),
    newDraftHere: (w, g) => void newDraftHere(w, g),
    newBoardHere: (w, g) => void newBoardHere(w, g),
  });

  const actions = useSelectionActions({
    ids: sel.ids,
    workspaceId: selWs ?? '',
    clear: sel.clear,
    onGrouped: (id, parentId) => {
      if (parentId) useStore.getState().patch('groups', parentId, { collapsed: false });
      else if (selWs) toggleWs(selWs, true);
      setEditing({ t: 'rename', kind: 'group', id });
    },
  });

  const env: Env = {
    sel,
    selClick: (itemId, workspaceId, e) => {
      if (!(e.metaKey || e.ctrlKey || e.shiftKey)) return false;
      // Une sélection ne mélange pas deux espaces : on repart de zéro dans le nouvel espace.
      if (selWs && selWs !== workspaceId) sel.clear();
      return sel.click(itemId, e);
    },
    selEntries: actions.entries,
    groups,
    editing,
    setEditing,
    drop,
    setDrop,
    menu: (e, entries, label) => {
      e.preventDefault();
      e.stopPropagation();
      m.open(e.clientX, e.clientY, entries, label);
    },
    menuFrom: (el, entries, label) => {
      const r = el.getBoundingClientRect();
      m.open(r.left, r.bottom + 4, entries, label);
    },
    ctx,
    collapsedWs,
    toggleWs,
    expandLater: (key, run) => {
      if (timer.current?.key === key) return;
      if (timer.current) clearTimeout(timer.current.id);
      timer.current = { key, id: setTimeout(run, 650) };
    },
    cancelExpand: () => {
      if (timer.current) clearTimeout(timer.current.id);
      timer.current = null;
    },
    route,
    activeWs,
  };

  // Nettoie le marquage si un glisser est abandonné hors de l'arbre.
  useEffect(() => {
    const end = () => {
      setDrop(null);
      env.cancelExpand();
    };
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => {
      window.removeEventListener('dragend', end);
      window.removeEventListener('drop', end);
    };
  });

  return (
    <EnvCtx.Provider value={env}>
      <section
        className="ws-tree"
        aria-label="Espaces de travail"
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest('input, textarea')) return;
          const mod = e.metaKey || e.ctrlKey;
          if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
            // ⌘A dans l'arbre : tous les éléments visibles de l'espace de la ligne qui a le focus.
            const row = (e.target as HTMLElement).closest<HTMLElement>('[data-ws-id]');
            const wsId = row?.dataset.wsId;
            if (!wsId) return;
            e.preventDefault();
            const inWs = new Set(wsItems.filter((i) => i.workspaceId === wsId).map((i) => i.id));
            sel.set(order.filter((id) => inWs.has(id)));
          } else if (e.key === 'Escape' && sel.size) {
            e.preventDefault();
            sel.clear();
          }
        }}
      >
        <div className="sidebar-section ws-head">
          <span>Espaces</span>
          <button className="icon-btn sm ws-add" aria-label="Nouvel espace" title="Nouvel espace" onClick={() => setEditing({ t: 'newWs' })}>
            <Plus size={14} />
          </button>
        </div>
        <div role="tree" aria-label="Espaces" aria-multiselectable="true" className="ws-list" ref={listRef}>
          {editing?.t === 'newWs' && (
            <div className="ws-row ws-row-edit anim-in" style={{ ['--d' as string]: 0 }}>
              <span className="ws-chev-slot" />
              <span className="ws-dot ws-dot-new" />
              <InlineName
                label="Nom du nouvel espace"
                placeholder="Nom de l’espace"
                onCancel={() => setEditing(null)}
                onSubmit={(name) => {
                  setEditing(null);
                  const w = useStore.getState().createWorkspace(name);
                  goToWorkspace(w.id, null);
                }}
              />
            </div>
          )}
          {workspaces.map((w) => (
            <WsNode key={w.id} id={w.id} />
          ))}
          {workspaces.length === 0 && editing?.t !== 'newWs' && (
            <button className="ws-empty-cta" onClick={() => setEditing({ t: 'newWs' })}>
              <Plus size={13} /> Créer un espace de travail
            </button>
          )}
        </div>
      </section>
      {m.menu && <ContextMenu x={m.menu.x} y={m.menu.y} entries={m.menu.entries} label={m.menu.label} onClose={m.close} />}
      {owner === 'tree' && sel.size > 0 && selWs && <SelectionBar actions={actions} onClear={sel.clear} />}
      {actions.dialog}
      {dialogs}
    </EnvCtx.Provider>
  );
}

// ── Espace ─────────────────────────────────────────────────

function useDropHandlers(opts: {
  key: string;
  workspaceId: string;
  groupId: string | null;
  zone?: DropArgs['zone'];
  target: DropArgs['target'];
  expand?: () => void;
}) {
  const env = useContext(EnvCtx);
  return dropProps({ ...opts, drop: env.drop, setDrop: env.setDrop, expandLater: env.expandLater, cancelExpand: env.cancelExpand });
}

function MoreButton({ onOpen, label }: { onOpen(el: HTMLElement): void; label: string }) {
  return (
    <button
      className="icon-btn sm ws-more"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(e.currentTarget);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <MoreHorizontal size={14} />
    </button>
  );
}

function WsNode({ id }: { id: string }) {
  const env = useContext(EnvCtx);
  const ws = useStore((s) => s.workspaces.find((w) => w.id === id));
  const items = useResolvedItems(id);
  const collab = useCollabMark(id);
  const open = !env.collapsedWs.has(id);
  const rowRef = useRef<HTMLDivElement>(null);
  const dh = useDropHandlers({
    key: `ws:${id}`,
    workspaceId: id,
    groupId: null,
    target: () => ({ kind: 'workspace', workspaceId: id }),
    expand: () => env.toggleWs(id, true),
  });
  if (!ws) return null;
  const isRoute = env.route.name === 'workspace' && env.route.workspaceId === id;
  const active = isRoute && env.route.name === 'workspace' && env.route.groupId === null;
  const editing = env.editing?.t === 'rename' && env.editing.kind === 'ws' && env.editing.id === id;
  const entries = () => workspaceMenu(env.ctx, id, ws.tint);
  const rootGroups = sortedGroups(env.groups, id, null);
  const rootItems = items.filter((i) => i.item.groupId === null);
  const empty = rootGroups.length === 0 && rootItems.length === 0 && !(env.editing?.t === 'newGroup' && env.editing.workspaceId === id);

  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') goToWorkspace(id, null);
    else if (e.key === 'ArrowRight') env.toggleWs(id, true);
    else if (e.key === 'ArrowLeft') env.toggleWs(id, false);
    else if (e.key === 'F2') env.setEditing({ t: 'rename', kind: 'ws', id });
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      env.menuFrom(e.currentTarget as HTMLElement, entries(), `Menu de l’espace ${ws.name}`);
    }
  };

  return (
    <div className={`ws-node ${collab ? 'ws-collab' : ''} ${collab?.reconnecting ? 'reconnecting' : ''}`} role="none" style={collab ? ({ '--collab-color': collab.color } as React.CSSProperties) : undefined} data-collab={collab ? 'live' : undefined} title={collab ? `En direct : ${collab.names}` : undefined}>
      <div
        ref={rowRef}
        role="treeitem"
        aria-expanded={open}
        aria-selected={active}
        tabIndex={0}
        data-ws-id={id}
        className={`ws-row ws-row-ws ${active ? 'active' : ''} ${isRoute && !active ? 'in-route' : ''} ${dh.mark?.pos === 'into' ? 'drop-into' : ''} ${dh.mark?.file ? 'drop-file' : ''}`}
        style={{ ['--d' as string]: 0 }}
        onClick={() => {
          env.sel.clear();
          goToWorkspace(id, null);
        }}
        onDoubleClick={() => env.setEditing({ t: 'rename', kind: 'ws', id })}
        onContextMenu={(e) => env.menu(e, entries(), `Menu de l’espace ${ws.name}`)}
        onKeyDown={onKey}
        {...dh.props}
      >
        <button
          className="ws-chev"
          tabIndex={-1}
          aria-label={open ? 'Replier' : 'Déplier'}
          onClick={(e) => {
            e.stopPropagation();
            env.toggleWs(id);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <ChevronRight size={13} className={open ? 'open' : ''} />
        </button>
        <span className="ws-dot" style={{ background: `var(${ws.tint})` }} />
        {editing ? (
          <InlineName
            label="Nom de l’espace"
            initial={ws.name}
            placeholder="Nom de l’espace"
            onCancel={() => env.setEditing(null)}
            onSubmit={(v) => {
              renameWorkspace(id, v);
              env.setEditing(null);
            }}
          />
        ) : (
          <span className="ws-name truncate">{ws.name}</span>
        )}
        {!editing && collab && <CollabBadge mark={collab} />}
        {!editing && !collab && <span className="ws-count">{items.length || ''}</span>}
        {!editing && <MoreButton label={`Actions de l’espace ${ws.name}`} onOpen={(el) => env.menuFrom(el, entries(), `Menu de l’espace ${ws.name}`)} />}
      </div>
      <Collapse open={open}>
        <div role="group">
          {env.editing?.t === 'newGroup' && env.editing.workspaceId === id && env.editing.parentId === null && <NewGroupRow depth={1} workspaceId={id} parentId={null} />}
          {rootGroups.map((g) => (
            <GroupNode key={g.id} g={g} depth={1} items={items} />
          ))}
          {rootItems.map((r) => (
            <ItemRow key={r.item.id} r={r} depth={1} />
          ))}
          {empty && (
            <div className="ws-hint" style={{ ['--d' as string]: 1 }}>
              Espace vide
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
}

function NewGroupRow({ depth, workspaceId, parentId }: { depth: number; workspaceId: string; parentId: string | null }) {
  const env = useContext(EnvCtx);
  return (
    <div className="ws-row ws-row-edit anim-in" style={{ ['--d' as string]: depth }}>
      <span className="ws-chev-slot" />
      <Folder size={14} className="ws-ico" />
      <InlineName
        label={parentId ? 'Nom du sous-groupe' : 'Nom du groupe'}
        placeholder={parentId ? 'Nom du sous-groupe' : 'Nom du groupe'}
        onCancel={() => env.setEditing(null)}
        onSubmit={(name) => {
          env.setEditing(null);
          useStore.getState().createGroup(workspaceId, parentId, name);
        }}
      />
    </div>
  );
}

// ── Groupe ─────────────────────────────────────────────────

function GroupNode({ g, depth, items }: { g: WorkspaceGroup; depth: number; items: ResolvedItem[] }) {
  const env = useContext(EnvCtx);
  const children = sortedGroups(env.groups, g.workspaceId, g.id);
  const own = items.filter((i) => i.item.groupId === g.id);
  const open = !g.collapsed;
  const total = countInGroup(env.groups, items, g.id).items;
  const setOpen = (v: boolean) => useStore.getState().patch('groups', g.id, { collapsed: !v });
  const route = env.route;
  const active = route.name === 'workspace' && route.groupId === g.id;
  const editing = env.editing?.t === 'rename' && env.editing.kind === 'group' && env.editing.id === g.id;
  const entries = () => groupMenu(env.ctx, g);
  const payload: DragPayload = { type: 'group', id: g.id, workspaceId: g.workspaceId };
  const hasKids = children.length + own.length > 0;

  const dh = useDropHandlers({
    key: `group:${g.id}`,
    workspaceId: g.workspaceId,
    groupId: g.id,
    zone: (e, drag) => {
      if (drag?.type !== 'group') return 'into';
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      if (y < 0.28) return 'before';
      if (y > 0.72 && (!open || !hasKids)) return 'after';
      return 'into';
    },
    target: (pos) => ({ kind: 'group', groupId: g.id, pos }),
    expand: () => setOpen(true),
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') goToWorkspace(g.workspaceId, g.id);
    else if (e.key === 'ArrowRight') setOpen(true);
    else if (e.key === 'ArrowLeft') setOpen(false);
    else if (e.key === 'F2') env.setEditing({ t: 'rename', kind: 'group', id: g.id });
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      env.menuFrom(e.currentTarget as HTMLElement, entries(), `Menu du groupe ${g.name}`);
    }
  };

  return (
    <div className="ws-node" role="none">
      <div
        role="treeitem"
        aria-expanded={open}
        aria-selected={active}
        tabIndex={0}
        data-ws-id={g.workspaceId}
        className={`ws-row ws-row-group ${active ? 'active' : ''} ${dh.mark?.pos === 'into' ? 'drop-into' : ''} ${dh.mark?.pos === 'before' ? 'drop-before' : ''} ${dh.mark?.pos === 'after' ? 'drop-after' : ''} ${dh.mark?.file ? 'drop-file' : ''}`}
        style={{ ['--d' as string]: depth }}
        onClick={() => {
          env.sel.clear();
          goToWorkspace(g.workspaceId, g.id);
        }}
        onDoubleClick={() => env.setEditing({ t: 'rename', kind: 'group', id: g.id })}
        onContextMenu={(e) => env.menu(e, entries(), `Menu du groupe ${g.name}`)}
        onKeyDown={onKey}
        {...dragSource(payload, () => env.setDrop(null))}
        {...dh.props}
      >
        <button
          className={`ws-chev ${hasKids ? '' : 'empty'}`}
          tabIndex={-1}
          aria-label={open ? 'Replier' : 'Déplier'}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <ChevronRight size={13} className={open ? 'open' : ''} />
        </button>
        {open && hasKids ? <FolderOpen size={14} className="ws-ico" /> : <Folder size={14} className="ws-ico" />}
        {editing ? (
          <InlineName
            label="Nom du groupe"
            initial={g.name}
            placeholder="Nom du groupe"
            onCancel={() => env.setEditing(null)}
            onSubmit={(v) => {
              renameGroup(g.id, v);
              env.setEditing(null);
            }}
          />
        ) : (
          <span className="ws-name truncate">{g.name}</span>
        )}
        {!editing && <span className="ws-count">{total || ''}</span>}
        {!editing && <MoreButton label={`Actions du groupe ${g.name}`} onOpen={(el) => env.menuFrom(el, entries(), `Menu du groupe ${g.name}`)} />}
      </div>
      <Collapse open={open}>
        <div role="group">
          {env.editing?.t === 'newGroup' && env.editing.parentId === g.id && <NewGroupRow depth={depth + 1} workspaceId={g.workspaceId} parentId={g.id} />}
          {children.map((c) => (
            <GroupNode key={c.id} g={c} depth={depth + 1} items={items} />
          ))}
          {own.map((r) => (
            <ItemRow key={r.item.id} r={r} depth={depth + 1} />
          ))}
        </div>
      </Collapse>
    </div>
  );
}

// ── Élément ────────────────────────────────────────────────

function ItemRow({ r, depth }: { r: ResolvedItem; depth: number }) {
  const env = useContext(EnvCtx);
  const { item } = r;
  const route = env.route;
  const active =
    (item.kind === 'book' && route.name === 'reader' && route.bookId === item.refId && route.tab === 'lecture') ||
    (item.kind === 'map' && route.name === 'reader' && route.bookId === item.refId && route.tab === 'carte') ||
    (item.kind === 'map' && route.name === 'board' && route.boardId === item.refId) ||
    (item.kind === 'draft' && route.name === 'write' && route.draftId === item.refId) ||
    (item.kind === 'plan' && route.name === 'plans' && route.planId === item.refId) ||
    (item.kind === 'argument' && route.name === 'arguments' && route.argumentId === item.refId);
  const selected = env.sel.has(item.id);
  const entries = () => {
    if (selected && env.sel.size > 1) return env.selEntries();
    if (env.sel.size && !selected) env.sel.clear();
    return itemMenu(env.ctx, item);
  };
  const payload = (): DragPayload =>
    env.sel.has(item.id) && env.sel.size > 1
      ? { type: 'item', id: item.id, workspaceId: item.workspaceId, ids: env.sel.ids }
      : { type: 'item', id: item.id, workspaceId: item.workspaceId };
  const dh = useDropHandlers({
    key: `item:${item.id}`,
    workspaceId: item.workspaceId,
    groupId: item.groupId,
    zone: (e) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      return e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
    },
    target: (pos) => ({ kind: 'item', itemId: item.id, pos: pos === 'after' ? 'after' : 'before' }),
  });
  return (
    <div
      role="treeitem"
      aria-selected={selected || active}
      aria-current={active ? 'page' : undefined}
      tabIndex={0}
      title={r.title}
      data-sel-id={item.id}
      data-ws-id={item.workspaceId}
      className={`ws-row ws-row-item ${active ? 'active' : ''} ${selected ? 'selected' : ''} ${dh.mark?.pos === 'before' ? 'drop-before' : ''} ${dh.mark?.pos === 'after' ? 'drop-after' : ''}`}
      style={{ ['--d' as string]: depth }}
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      onClick={(e) => {
        if (env.selClick(item.id, item.workspaceId, e)) return;
        env.sel.clear();
        openItem(item);
      }}
      onContextMenu={(e) => env.menu(e, entries(), selected && env.sel.size > 1 ? `Menu de la sélection (${env.sel.size})` : `Menu de ${r.title}`)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') openItem(item);
        else if (e.key === ' ') {
          // Espace : ajoute / retire de la sélection l'élément qui a le focus (⇧Espace : plage).
          e.preventDefault();
          env.selClick(item.id, item.workspaceId, { metaKey: !e.shiftKey, shiftKey: e.shiftKey } as ReactMouseEvent);
        } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          env.menuFrom(e.currentTarget as HTMLElement, entries(), `Menu de ${r.title}`);
        }
      }}
      {...dragSource(payload, () => env.setDrop(null))}
      {...dh.props}
    >
      <span className="ws-chev-slot" />
      <span className={`ws-ico ws-ico-${item.kind}`}>
        <ItemIcon kind={item.kind} />
      </span>
      <span className="ws-name truncate">{r.title}</span>
      <MoreButton label={`Actions de ${r.title}`} onOpen={(el) => env.menuFrom(el, entries(), `Menu de ${r.title}`)} />
    </div>
  );
}
