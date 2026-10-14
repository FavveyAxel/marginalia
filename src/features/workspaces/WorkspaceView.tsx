// Vue d'un espace (ou d'un de ses groupes) : sous-groupes en tuiles, éléments en cartes.
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Check, CheckSquare, ChevronRight, FilePen, Folder, FolderPlus, MoreHorizontal, PackagePlus, Pencil, Upload } from 'lucide-react';
import { LassoBox, useLasso, useMultiSelect, useSelectionKeys, type MultiSelect } from '../../lib/useMultiSelect';
import { useStore } from '../../lib/store';
import type { WorkspaceGroup } from '../../lib/types';
import { BookCover } from '../library/BookCover';
import {
  KIND_LABEL,
  countInGroup,
  dueCardsFor,
  goToWorkspace,
  groupPath,
  openItem,
  renameGroup,
  renameWorkspace,
  sortedGroups,
  subtreeIds,
  useResolvedItems,
  type DragPayload,
  type ResolvedItem,
} from './wsModel';
import { ContextMenu, InlineName, ItemIcon, dragSource, dropProps, useMenu, type DropArgs, type DropMark, type MenuEntry } from './wsUi';
import { groupMenu, itemMenu, workspaceMenu } from './wsMenus';
import { useWsDialogs } from './wsDialogs';
import { importHere, newDraftHere } from './wsActions';
import { SelectionBar, useSelOwner, useSelectionActions } from './wsSelection';
import './workspaces.css';
import { OS_TEXT, fmtKeys } from '../../lib/keys';

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function WorkspaceView({ workspaceId, groupId }: { workspaceId: string; groupId: string | null }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const groups = useStore((s) => s.groups);
  const cards = useStore((s) => s.cards);
  const highlights = useStore((s) => s.highlights);
  const activeWs = useStore((s) => s.settings.activeWorkspaceId);
  const items = useResolvedItems(workspaceId);
  const navigate = useStore((s) => s.navigate);

  const [drop, setDrop] = useState<DropMark | null>(null);
  const [editTitle, setEditTitle] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [renamingTile, setRenamingTile] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const m = useMenu();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ws && activeWs !== workspaceId) useStore.getState().updateSettings({ activeWorkspaceId: workspaceId });
  }, [ws, activeWs, workspaceId]);

  const group = groupId ? groups.find((g) => g.id === groupId && g.workspaceId === workspaceId) : undefined;
  const effGroupId = group ? group.id : null;
  const path = useMemo(() => groupPath(groups, effGroupId), [groups, effGroupId]);

  const { ctx, dialogs } = useWsDialogs({
    newGroup: (w, parentId) => {
      if (parentId === effGroupId) setNewGroup(true);
      else {
        useStore.getState().patch('groups', parentId ?? '', { collapsed: false });
        goToWorkspace(w, parentId);
        setNewGroup(true);
      }
    },
    rename: (kind, id) => {
      if ((kind === 'ws' && !effGroupId && id === workspaceId) || (kind === 'group' && id === effGroupId)) setEditTitle(true);
      else if (kind === 'group') setRenamingTile(id);
      else {
        goToWorkspace(workspaceId, null);
        setEditTitle(true);
      }
    },
    importHere: (w, g) => void importHere(w, g),
    newDraftHere: (w, g) => void newDraftHere(w, g),
  });

  // ── Sélection multiple (éléments affichés ici, dans l'ordre affiché) ──
  const here = useMemo(() => items.filter((i) => i.item.groupId === effGroupId), [items, effGroupId]);
  const order = useMemo(() => here.map((r) => r.item.id), [here]);
  const sel = useMultiSelect(order);
  const owner = useSelOwner((s) => s.owner);
  const claim = useSelOwner((s) => s.claim);
  useEffect(() => {
    if (sel.size && owner !== 'view') claim('view');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.size]);
  useEffect(() => {
    if (owner === 'tree' && sel.size) sel.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);
  useEffect(() => () => {
    if (useSelOwner.getState().owner === 'view') useSelOwner.getState().claim(null);
  }, []);
  useEffect(() => {
    if (!here.length) setSelectMode(false);
  }, [here.length]);
  useSelectionKeys(sel, { enabled: !!ws, onEscape: selectMode ? () => setSelectMode(false) : undefined });
  const lasso = useLasso({ container: scrollRef, sel, disabled: !ws });
  const actions = useSelectionActions({
    ids: sel.ids,
    workspaceId,
    parentForNewGroup: effGroupId,
    clear: sel.clear,
    onGrouped: (id) => setRenamingTile(id),
  });

  const scope = useMemo(() => {
    if (!effGroupId) return items;
    const ids = subtreeIds(groups, effGroupId);
    return items.filter((i) => i.item.groupId && ids.has(i.item.groupId));
  }, [items, groups, effGroupId]);

  const stats = useMemo(() => {
    const bookIds = new Set(scope.filter((i) => i.item.kind === 'book').map((i) => i.item.refId));
    return {
      books: bookIds.size,
      highlights: highlights.filter((h) => bookIds.has(h.bookId)).length,
      due: dueCardsFor(bookIds),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, highlights, cards]);

  if (!ws) {
    return (
      <div className="ws-view anim-view">
        <header className="topbar">
          <span className="spacer" />
        </header>
        <div className="empty">
          <h3>Cet espace n’existe plus</h3>
          <p>Il a été supprimé. Vos documents sont toujours dans la bibliothèque.</p>
          <button className="btn btn-primary" onClick={() => navigate({ name: 'home' })}>
            Retour à l’accueil
          </button>
        </div>
      </div>
    );
  }

  const subGroups = sortedGroups(groups, workspaceId, effGroupId);
  const fullyEmpty = !effGroupId && groups.filter((g) => g.workspaceId === workspaceId).length === 0 && items.length === 0;
  const title = group ? group.name : ws.name;

  const dArgs = (key: string, workspace: string, g: string | null, extra: Partial<DropArgs> = {}) =>
    dropProps({
      key,
      drop,
      setDrop,
      workspaceId: workspace,
      groupId: g,
      target: () => (g ? { kind: 'group', groupId: g, pos: 'into' } : { kind: 'workspace', workspaceId: workspace }),
      ...extra,
    });

  const page = dArgs('page', workspaceId, effGroupId);
  const menuEntries = (): MenuEntry[] => (group ? groupMenu(ctx, group) : workspaceMenu(ctx, workspaceId, ws.tint));
  const openMenuAt = (el: HTMLElement, entries: MenuEntry[], label: string) => {
    const r = el.getBoundingClientRect();
    m.open(Math.max(8, r.right - 220), r.bottom + 4, entries, label);
  };
  const ctxMenu = (e: React.MouseEvent, entries: MenuEntry[], label: string) => {
    e.preventDefault();
    e.stopPropagation();
    m.open(e.clientX, e.clientY, entries, label);
  };

  return (
    <div className="ws-view anim-view" style={{ ['--ws-tint' as string]: `var(${ws.tint})` }}>
      <header className="topbar">
        <nav className="ws-crumbs" aria-label="Fil d’Ariane">
          <Crumb
            label={ws.name}
            tint={ws.tint}
            current={!effGroupId}
            onClick={() => goToWorkspace(workspaceId, null)}
            drop={dArgs('crumb:ws', workspaceId, null)}
          />
          {path.map((g, i) => (
            <span key={g.id} className="ws-crumb-wrap">
              <ChevronRight size={12} className="ws-crumb-sep" />
              <Crumb label={g.name} current={i === path.length - 1} onClick={() => goToWorkspace(workspaceId, g.id)} drop={dArgs(`crumb:${g.id}`, workspaceId, g.id)} />
            </span>
          ))}
        </nav>
        <span className="spacer" />
        <button className="icon-btn" aria-label="Actions" title="Actions" onClick={(e) => openMenuAt(e.currentTarget, menuEntries(), 'Menu')}>
          <MoreHorizontal size={16} />
        </button>
      </header>

      <div
        ref={scrollRef}
        className={`ws-scroll ${page.mark ? 'drop-page' : ''} ${selectMode ? 'select-mode' : ''}`}
        {...page.props}
        onMouseDown={(e) => {
          // Clic dans le vide de la vue : une sélection faite dans l'arbre latéral s'efface aussi.
          const t = e.target as Element;
          if (e.button === 0 && useSelOwner.getState().owner === 'tree' && !t.closest('[data-sel-id], button, input, [data-no-lasso]')) claim(null);
          lasso.onMouseDown(e);
        }}
        onContextMenu={(e) => ctxMenu(e, menuEntries(), 'Menu')}
      >
        <div className="ws-page">
          <div className="ws-title-block">
            {editTitle ? (
              <InlineName
                className="ws-title-input page-title"
                label="Nom"
                initial={title}
                placeholder="Nom"
                onCancel={() => setEditTitle(false)}
                onSubmit={(v) => {
                  if (group) renameGroup(group.id, v);
                  else renameWorkspace(workspaceId, v);
                  setEditTitle(false);
                }}
              />
            ) : (
              <h1 className="page-title ws-title" onClick={() => setEditTitle(true)} title="Cliquer pour renommer">
                {title}
                <Pencil size={15} className="ws-title-pen" />
              </h1>
            )}
            {!fullyEmpty && (
            <div className="ws-stats" aria-label="Statistiques">
              <span>{plural(scope.length, 'élément', 'éléments')}</span>
              {stats.books > 0 && <span>{plural(stats.books, 'livre', 'livres')}</span>}
              {stats.books > 0 && <span>{plural(stats.highlights, 'extrait', 'extraits')}</span>}
              {stats.due > 0 && <span className="ws-stat-due">{plural(stats.due, 'carte à réviser', 'cartes à réviser')}</span>}
              {!effGroupId && subGroups.length > 0 && <span>{plural(groups.filter((g) => g.workspaceId === workspaceId).length, 'groupe', 'groupes')}</span>}
            </div>
            )}
          </div>

          {!fullyEmpty && (
            <div className="ws-actions">
              <button className="btn btn-primary" onClick={() => ctx.openAdd(workspaceId, effGroupId)}>
                <PackagePlus size={14} /> Ajouter…
              </button>
              <button className="btn" onClick={() => setNewGroup(true)}>
                <FolderPlus size={14} /> Nouveau groupe
              </button>
              <button className="btn" onClick={() => void importHere(workspaceId, effGroupId)}>
                <Upload size={14} /> Importer ici
              </button>
              <button className="btn" onClick={() => void newDraftHere(workspaceId, effGroupId)}>
                <FilePen size={14} /> Nouvel écrit ici
              </button>
              {here.length > 0 && (
                <button
                  className={`btn ws-select-toggle ${selectMode ? 'on' : ''}`}
                  aria-pressed={selectMode}
                  title={fmtKeys("Cocher plusieurs éléments (ou ⌘-clic, ⇧-clic, ⌘A)")}
                  onClick={() => {
                    if (selectMode) sel.clear();
                    setSelectMode(!selectMode);
                  }}
                >
                  {selectMode ? <Check size={14} /> : <CheckSquare size={14} />} {selectMode ? 'Terminer' : 'Sélectionner'}
                </button>
              )}
            </div>
          )}

          {fullyEmpty && !newGroup && (
            <div className="ws-empty anim-in">
              <h3>Un espace pour un même travail</h3>
              <p>Un espace réunit les textes, notes et écrits d’un même travail : un cours, un mémoire, une notion. Rangez-les dans des groupes et des sous-groupes.</p>
              <div className="ws-empty-actions">
                <button className="btn btn-primary" onClick={() => ctx.openAdd(workspaceId, null)}>
                  <PackagePlus size={14} /> Ajouter des éléments
                </button>
                <button className="btn" onClick={() => void importHere(workspaceId, null)}>
                  <Upload size={14} /> Importer un texte
                </button>
                <button className="btn" onClick={() => setNewGroup(true)}>
                  <FolderPlus size={14} /> Nouveau groupe
                </button>
              </div>
              <span className="ws-empty-tip">Vous pouvez aussi glisser un fichier depuis {OS_TEXT.fileManager}.</span>
            </div>
          )}

          {(subGroups.length > 0 || newGroup) && (
            <section aria-label="Groupes" className="ws-section">
              <div className="ws-tiles anim-stagger">
                {newGroup && (
                  <div className="ws-tile ws-tile-new" style={{ ['--i' as string]: 0 }}>
                    <span className="ws-tile-ico">
                      <Folder size={16} />
                    </span>
                    <InlineName
                      label="Nom du groupe"
                      placeholder={effGroupId ? 'Nom du sous-groupe' : 'Nom du groupe'}
                      onCancel={() => setNewGroup(false)}
                      onSubmit={(name) => {
                        setNewGroup(false);
                        useStore.getState().createGroup(workspaceId, effGroupId, name);
                      }}
                    />
                  </div>
                )}
                {subGroups.map((g, i) => (
                  <Tile
                    key={g.id}
                    g={g}
                    index={i + 1}
                    items={items}
                    renaming={renamingTile === g.id}
                    stopRenaming={() => setRenamingTile(null)}
                    drop={drop}
                    setDrop={setDrop}
                    onMenu={(e, entries) => ctxMenu(e, entries, `Menu du groupe ${g.name}`)}
                    onMenuAt={(el, entries) => openMenuAt(el, entries, `Menu du groupe ${g.name}`)}
                    ctx={ctx}
                  />
                ))}
              </div>
            </section>
          )}

          {here.length > 0 && (
            <section aria-label="Éléments" className="ws-section">
              <div className="ws-grid anim-stagger" role="listbox" aria-multiselectable="true" aria-label="Éléments">
                {here.map((r, i) => (
                  <ItemCard
                    key={r.item.id}
                    r={r}
                    index={i}
                    drop={drop}
                    setDrop={setDrop}
                    sel={sel}
                    selectMode={selectMode}
                    selEntries={actions.entries}
                    onMenu={(e, entries) => ctxMenu(e, entries, sel.has(r.item.id) && sel.size > 1 ? `Menu de la sélection (${sel.size})` : `Menu de ${r.title}`)}
                    onMenuAt={(el, entries) => openMenuAt(el, entries, `Menu de ${r.title}`)}
                    ctx={ctx}
                  />
                ))}
              </div>
            </section>
          )}

          {!fullyEmpty && here.length === 0 && subGroups.length === 0 && !newGroup && (
            <div className="ws-drop-empty">
              <p>{group ? 'Ce groupe est vide.' : 'Rien à la racine de cet espace.'}</p>
              <span className="muted">Ajoutez des éléments, ou glissez-y un fichier ou un élément de la barre latérale.</span>
            </div>
          )}
        </div>
      </div>
      {lasso.box && <LassoBox box={lasso.box} className="ws-lasso" />}
      {owner === 'view' && sel.size > 0 && <SelectionBar actions={actions} onClear={sel.clear} />}
      {actions.dialog}
      {m.menu && <ContextMenu x={m.menu.x} y={m.menu.y} entries={m.menu.entries} label={m.menu.label} onClose={m.close} />}
      {dialogs}
    </div>
  );
}

function Crumb({ label, tint, current, onClick, drop }: { label: string; tint?: string; current: boolean; onClick(): void; drop: ReturnType<typeof dropProps> }) {
  return (
    <button
      className={`ws-crumb ${current ? 'current' : ''} ${drop.mark ? 'drop-into' : ''}`}
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
      {...drop.props}
    >
      {tint && <span className="ws-dot" style={{ background: `var(${tint})` }} />}
      <span className="truncate">{label}</span>
    </button>
  );
}

type CommonProps = {
  drop: DropMark | null;
  setDrop(d: DropMark | null): void;
  onMenu(e: React.MouseEvent, entries: MenuEntry[]): void;
  onMenuAt(el: HTMLElement, entries: MenuEntry[]): void;
  ctx: ReturnType<typeof useWsDialogs>['ctx'];
};

const xZone = (e: DragEvent) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  return x < 0.5 ? ('before' as const) : ('after' as const);
};

function Tile({ g, index, items, renaming, stopRenaming, drop, setDrop, onMenu, onMenuAt, ctx }: CommonProps & { g: WorkspaceGroup; index: number; items: ResolvedItem[]; renaming: boolean; stopRenaming(): void }) {
  const groups = useStore((s) => s.groups);
  const c = countInGroup(groups, items, g.id);
  const payload: DragPayload = { type: 'group', id: g.id, workspaceId: g.workspaceId };
  const dh = dropProps({
    key: `tile:${g.id}`,
    drop,
    setDrop,
    workspaceId: g.workspaceId,
    groupId: g.id,
    zone: (e, d) => {
      if (d?.type !== 'group') return 'into';
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      return x < 0.22 ? 'before' : x > 0.78 ? 'after' : 'into';
    },
    target: (pos) => ({ kind: 'group', groupId: g.id, pos }),
  });
  const entries = () => groupMenu(ctx, g);
  const inner = (
    <>
      <span className="ws-tile-ico">
        <Folder size={16} />
      </span>
      <span className="ws-tile-text">
        {renaming ? (
          <InlineName
            label="Nom du groupe"
            initial={g.name}
            placeholder="Nom du groupe"
            onCancel={stopRenaming}
            onSubmit={(v) => {
              renameGroup(g.id, v);
              stopRenaming();
            }}
          />
        ) : (
          <span className="ws-tile-name truncate">{g.name}</span>
        )}
        <span className="ws-tile-meta muted">
          {plural(c.items, 'élément', 'éléments')}
          {c.groups > 0 && `, ${plural(c.groups, 'sous-groupe', 'sous-groupes')}`}
        </span>
      </span>
    </>
  );
  return (
    <div
      data-no-lasso
      className={`ws-tile lift ${dh.mark?.pos === 'into' ? 'drop-into' : ''} ${dh.mark?.pos === 'before' ? 'drop-before' : ''} ${dh.mark?.pos === 'after' ? 'drop-after' : ''}`}
      style={{ ['--i' as string]: index }}
      onContextMenu={(e) => onMenu(e, entries())}
      {...dragSource(payload, () => setDrop(null))}
      {...dh.props}
    >
      {renaming ? (
        <div className="ws-tile-main">{inner}</div>
      ) : (
        <button className="ws-tile-main" onClick={() => goToWorkspace(g.workspaceId, g.id)}>
          {inner}
        </button>
      )}
      <button
        className="icon-btn sm ws-more"
        aria-label={`Actions du groupe ${g.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onMenuAt(e.currentTarget, entries());
        }}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
}

function ItemCard({
  r,
  index,
  drop,
  setDrop,
  sel,
  selectMode,
  selEntries,
  onMenu,
  onMenuAt,
  ctx,
}: CommonProps & { r: ResolvedItem; index: number; sel: MultiSelect; selectMode: boolean; selEntries(): MenuEntry[] }) {
  const { item } = r;
  const book = useStore((s) => (item.kind === 'book' ? s.books.find((b) => b.id === item.refId) : undefined));
  const selected = sel.has(item.id);
  // Glisser un élément sélectionné emporte toute la sélection.
  const payload = (): DragPayload =>
    sel.has(item.id) && sel.size > 1
      ? { type: 'item', id: item.id, workspaceId: item.workspaceId, ids: sel.ids }
      : { type: 'item', id: item.id, workspaceId: item.workspaceId };
  const dh = dropProps({
    key: `card:${item.id}`,
    drop,
    setDrop,
    workspaceId: item.workspaceId,
    groupId: item.groupId,
    zone: xZone,
    target: (pos) => ({ kind: 'item', itemId: item.id, pos: pos === 'after' ? 'after' : 'before' }),
  });
  const entries = () => {
    // Clic droit sur un élément de la sélection : le menu agit sur toute la sélection.
    if (selected && sel.size > 1) return selEntries();
    // Sur un élément hors sélection : la sélection devient cet élément (comme le Finder).
    if (sel.size && !selected) sel.clear();
    return itemMenu(ctx, item);
  };
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      data-sel-id={item.id}
      role="option"
      aria-selected={selected}
      className={`ws-card lift kind-${item.kind} ${selected ? 'selected' : ''} ${dh.mark?.pos === 'before' ? 'drop-before' : ''} ${dh.mark?.pos === 'after' ? 'drop-after' : ''}`}
      style={{ ['--i' as string]: index }}
      onContextMenu={(e) => onMenu(e, entries())}
      {...dragSource(payload, () => setDrop(null))}
      {...dh.props}
    >
      <button
        className="ws-card-main"
        title={r.title}
        // ⇧-clic : pas de sélection de texte.
        onMouseDown={(e) => e.shiftKey && e.preventDefault()}
        onClick={(e) => {
          if (sel.click(item.id, e, { toggle: selectMode })) return;
          sel.clear();
          openItem(item);
        }}
      >
        {(selectMode || selected) && (
          <span className={`ws-check-box ${selected ? 'on' : ''}`} aria-hidden="true">
            {selected && <Check size={12} strokeWidth={3} />}
          </span>
        )}
        <span className="ws-card-preview">{book ? <BookCover book={book} size="md" /> : <DocPreview r={r} />}</span>
        <span className="ws-card-body">
          <span className="ws-card-kind">
            <ItemIcon kind={item.kind} size={12} /> {KIND_LABEL[item.kind]}
          </span>
          <span className="ws-card-title">{r.title}</span>
          {r.meta && <span className="ws-card-meta muted truncate">{r.meta}</span>}
        </span>
      </button>
      <button
        className="icon-btn sm ws-more"
        aria-label={`Actions de ${r.title}`}
        onClick={(e) => {
          e.stopPropagation();
          onMenuAt(e.currentTarget, entries());
        }}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
}

/** Aperçu sobre des éléments sans couverture : vrai texte s'il existe, sinon lignes de page stylisées. */
function DocPreview({ r }: { r: ResolvedItem }) {
  const k = r.item.kind;
  return (
    <div className={`ws-doc ws-doc-${k}`}>
      {r.preview ? (
        <p className="ws-doc-text">{r.preview}</p>
      ) : k === 'map' ? (
        <svg viewBox="0 0 120 80" className="ws-doc-graph" aria-hidden="true">
          <path d="M22 40 L58 20 M22 40 L58 60 M58 20 L98 40 M58 60 L98 40" />
          <circle cx="22" cy="40" r="7" />
          <circle cx="58" cy="20" r="7" />
          <circle cx="58" cy="60" r="7" />
          <circle cx="98" cy="40" r="7" />
        </svg>
      ) : (
        <div className="ws-doc-lines" aria-hidden="true">
          {(k === 'plan' ? [70, 52, 52, 70, 52, 40] : k === 'argument' ? [88, 74, 0, 82] : k === 'study' ? [30, 92, 78, 30, 86, 30, 70] : [92, 100, 84, 96, 60, 0, 94, 88, 50]).map((w, i) => (
            <span key={i} className={w ? '' : 'gap'} style={{ width: `${w}%`, marginLeft: k === 'plan' && (i === 1 || i === 2 || i === 4 || i === 5) ? 14 : 0 }} />
          ))}
        </div>
      )}
    </div>
  );
}
