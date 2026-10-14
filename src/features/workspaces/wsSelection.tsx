// Sélection multiple dans les espaces : actions groupées (barre flottante, menu contextuel),
// confirmation de suppression, et coordination entre la vue d'espace et l'arbre latéral
// (une seule sélection « active » à la fois).
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { ArrowRightLeft, FolderInput, FolderPlus, MinusCircle, MoreHorizontal, Trash2, X } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { TrashKind, WorkspaceItem, WorkspaceItemKind } from '../../lib/types';
import { commonParent, groupItems, moveItems, sortedGroups, useWorkspaces } from './wsModel';
import { ConfirmDialog, ContextMenu, useMenu, type MenuEntry } from './wsUi';

/** Qui détient la sélection en cours : la vue d'espace ou l'arbre de la barre latérale. */
export const useSelOwner = create<{ owner: 'view' | 'tree' | null; claim(o: 'view' | 'tree' | null): void }>((set) => ({
  owner: null,
  claim: (owner) => set({ owner }),
}));

const KIND_PLURAL: Record<WorkspaceItemKind, [string, string]> = {
  book: ['livre', 'livres'],
  draft: ['écrit', 'écrits'],
  plan: ['plan', 'plans'],
  argument: ['argument', 'arguments'],
  study: ['fiche-texte', 'fiches-texte'],
  map: ['carte d’argument', 'cartes d’argument'],
};
const FEM = new Set<WorkspaceItemKind>(['study', 'map']);

/** « 43 livres », « 3 éléments » (nature commune, sinon « éléments »). */
export function countLabel(items: Pick<WorkspaceItem, 'kind'>[]): { text: string; fem: boolean } {
  const n = items.length;
  const kinds = new Set(items.map((i) => i.kind));
  if (kinds.size === 1) {
    const k = items[0].kind;
    return { text: `${n} ${KIND_PLURAL[k][n > 1 ? 1 : 0]}`, fem: FEM.has(k) };
  }
  return { text: `${n} élément${n > 1 ? 's' : ''}`, fem: false };
}
const agree = (n: number, fem: boolean, word: string) => `${word}${fem ? 'e' : ''}${n > 1 ? 's' : ''}`;

export interface SelectionActionsOpts {
  ids: string[];
  workspaceId: string;
  /** Parent du groupe créé par « Nouveau groupe avec la sélection » (sinon : parent commun). */
  parentForNewGroup?: string | null;
  clear(): void;
  /** Après « Nouveau groupe avec la sélection » : lancer le renommage du groupe créé. */
  onGrouped(groupId: string, parentId: string | null): void;
}

/** Actions groupées sur une sélection d'éléments d'un espace, partagées par la barre et le menu contextuel. */
export function useSelectionActions(o: SelectionActionsOpts) {
  const [confirm, setConfirm] = useState(false);
  const wsItems = useStore((s) => s.wsItems);
  const groups = useStore((s) => s.groups);
  const workspaces = useWorkspaces();
  const items = o.ids.map((id) => wsItems.find((x) => x.id === id)).filter((x): x is WorkspaceItem => !!x);
  const deletable = items.filter((i) => i.kind !== 'map');

  const toast = (m: string) => useStore.getState().toast(m, 'success');

  const move = (workspaceId: string, groupId: string | null, name: string) => {
    const n = moveItems(o.ids, workspaceId, groupId);
    if (!n) return;
    const { text, fem } = countLabel(items);
    toast(`${text} ${agree(n, fem, 'déplacé')} vers « ${name} »`);
    if (workspaceId !== o.workspaceId) o.clear();
  };

  /** Destinations : racine et groupes de l'espace, puis les autres espaces (sous-menu). */
  const moveEntries = (): MenuEntry[] => {
    const here = commonParent(o.ids);
    const allHere = (g: string | null) => items.length > 0 && items.every((i) => i.workspaceId === o.workspaceId && i.groupId === g);
    const tree = (wsId: string, wsName: string, current: boolean): MenuEntry[] => {
      const out: MenuEntry[] = [
        { label: `${wsName} (racine)`, icon: <FolderInput size={14} />, disabled: current && allHere(null), hint: current && allHere(null) ? 'ici' : undefined, onClick: () => move(wsId, null, wsName) },
      ];
      const walk = (parent: string | null, depth: number) => {
        for (const g of sortedGroups(groups, wsId, parent)) {
          const isHere = current && here === g.id && allHere(g.id);
          out.push({ label: g.name, indent: depth, icon: <FolderInput size={14} />, disabled: isHere, hint: isHere ? 'ici' : undefined, onClick: () => move(wsId, g.id, g.name) });
          walk(g.id, depth + 1);
        }
      };
      walk(null, 1);
      return out;
    };
    const ws = workspaces.find((w) => w.id === o.workspaceId);
    const out = tree(o.workspaceId, ws?.name ?? 'Espace', true);
    const others = workspaces.filter((w) => w.id !== o.workspaceId);
    if (others.length) {
      out.push({ sep: true }, { label: 'Vers un autre espace', icon: <ArrowRightLeft size={14} />, children: others.map((w) => ({ label: w.name, swatch: w.tint, children: tree(w.id, w.name, false) })) });
    }
    return out;
  };

  const newGroup = () => {
    const parent = o.parentForNewGroup !== undefined ? o.parentForNewGroup : commonParent(o.ids);
    const g = groupItems(o.ids, o.workspaceId, parent);
    o.clear();
    o.onGrouped(g.id, parent);
  };

  const remove = () => {
    useStore.getState().removeManyFromWorkspace(o.ids);
    o.clear();
  };

  const entries = (): MenuEntry[] => {
    const n = items.length;
    const out: MenuEntry[] = [
      { label: 'Déplacer vers', icon: <ArrowRightLeft size={14} />, children: moveEntries() },
      { label: 'Nouveau groupe avec la sélection', icon: <FolderPlus size={14} />, onClick: newGroup },
      { sep: true },
      { label: n > 1 ? `Retirer ${n} éléments de l’espace` : 'Retirer de l’espace', icon: <MinusCircle size={14} />, onClick: remove },
    ];
    if (deletable.length) out.push({ label: 'Supprimer…', icon: <Trash2 size={14} />, danger: true, onClick: () => setConfirm(true) });
    out.push({ sep: true }, { label: 'Tout désélectionner', icon: <X size={14} />, onClick: o.clear });
    return out;
  };

  let dialog: ReactNode = null;
  if (confirm && deletable.length) {
    const { text } = countLabel(deletable);
    const n = deletable.length;
    const skipped = items.length - n;
    const onlyBooks = deletable.every((i) => i.kind === 'book');
    dialog = (
      <ConfirmDialog
        title={`Supprimer ${text} ?`}
        body={
          <>
            {`${n > 1 ? 'Ils' : 'Il'} ${n > 1 ? 'sont placés' : 'est placé'} dans la corbeille${onlyBooks ? ', avec leurs extraits, fiches et cartes de révision,' : ''} et ${n > 1 ? 'disparaissent' : 'disparaît'} de tous les espaces. Vous pouvez ${n > 1 ? 'les' : 'le'} restaurer pendant 30 jours.`}
            {skipped > 0 && ` ${skipped} carte${skipped > 1 ? 's' : ''} d’argument ne se suppriment pas d’ici : elle${skipped > 1 ? 's restent' : ' reste'} dans l’espace.`}
            {' Pour seulement les sortir de l’espace, choisissez plutôt «\u00a0Retirer de l’espace\u00a0».'}
          </>
        }
        confirmLabel={`Supprimer ${text}`}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          useStore.getState().trashDeleteMixed(deletable.map((i) => ({ kind: i.kind as TrashKind, id: i.refId })));
          o.clear();
        }}
      />
    );
  }

  return { items, deletable, entries, moveEntries, newGroup, remove, askDelete: () => setConfirm(true), dialog };
}

/** Barre d'actions flottante en bas de la fenêtre (≥ 1 élément sélectionné). Le dialogue de suppression
 * (`actions.dialog`) est rendu par le propriétaire de la sélection, pas par la barre. */
export function SelectionBar({ actions, onClear }: { actions: ReturnType<typeof useSelectionActions>; onClear(): void }) {
  const m = useMenu();
  const n = actions.items.length;
  if (!n) return null;
  const openAt = (el: HTMLElement, entries: MenuEntry[], label: string) => {
    const r = el.getBoundingClientRect();
    m.open(r.left, r.top - 8 - Math.min(420, 34 * entries.length), entries, label);
  };
  return (
    <>
      {createPortal(
        <div className="ws-selbar" role="toolbar" aria-label={`Actions sur la sélection (${n})`} data-no-lasso>
          <span className="ws-selbar-count" aria-live="polite">
            {n} sélectionné{n > 1 ? 's' : ''}
          </span>
          <span className="ws-selbar-sep" />
          <button className="btn ws-selbar-btn" onClick={(e) => openAt(e.currentTarget, actions.moveEntries(), 'Déplacer vers')}>
            <ArrowRightLeft size={14} /> Déplacer vers…
          </button>
          <button className="btn ws-selbar-btn" onClick={actions.newGroup}>
            <FolderPlus size={14} /> Nouveau groupe
          </button>
          <button className="btn ws-selbar-btn" onClick={actions.remove} title="Les documents restent dans la bibliothèque">
            <MinusCircle size={14} /> Retirer de l’espace
          </button>
          {actions.deletable.length > 0 && (
            <button className="btn ws-selbar-btn ws-selbar-danger" onClick={actions.askDelete}>
              <Trash2 size={14} /> Supprimer…
            </button>
          )}
          <button className="icon-btn sm ws-selbar-more" aria-label="Plus d’actions" title="Plus d’actions" onClick={(e) => openAt(e.currentTarget, actions.entries(), 'Actions sur la sélection')}>
            <MoreHorizontal size={15} />
          </button>
          <button className="icon-btn sm ws-selbar-close" aria-label="Tout désélectionner" title="Tout désélectionner (Échap)" onClick={onClear}>
            <X size={15} />
          </button>
        </div>,
        document.body,
      )}
      {m.menu && <ContextMenu x={m.menu.x} y={m.menu.y} entries={m.menu.entries} label={m.menu.label} onClose={m.close} />}
    </>
  );
}
