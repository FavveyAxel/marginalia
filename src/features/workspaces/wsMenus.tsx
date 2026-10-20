// Contenu des menus contextuels (identique dans l'arbre et dans la vue).
import { ArrowRightLeft, Copy, ExternalLink, GitCompareArrows, FolderPlus, FolderX, Palette, PackagePlus, Pencil, Trash2, Ungroup, Upload, FilePen, Network, Share2, Users, UserX } from 'lucide-react';
import { collabAvailable, isLiveIn, openCollabPanel, stopCollab, useCollab } from '../collab/collabState';
import { useStore } from '../../lib/store';
import type { WorkspaceGroup, WorkspaceItem } from '../../lib/types';
import { TINTS, TINT_LABEL, openItem, ungroup, type DragPayload } from './wsModel';
import type { MenuEntry } from './wsUi';
import { openShareDialog } from '../share/shareUi';

export interface MenuCtx {
  newGroup(workspaceId: string, parentId: string | null): void;
  rename(kind: 'ws' | 'group', id: string): void;
  askDeleteWs(id: string): void;
  askDeleteGroup(id: string): void;
  openAdd(workspaceId: string, groupId: string | null): void;
  openMove(p: DragPayload): void;
  importHere?(workspaceId: string, groupId: string | null): void;
  newDraftHere?(workspaceId: string, groupId: string | null): void;
  newBoardHere?(workspaceId: string, groupId: string | null): void;
  /** « Comparer avec un autre livre… » (carte libre à deux colonnes), sur un livre de l'espace. */
  compareWith?(bookId: string): void;
}

export function workspaceMenu(ctx: MenuCtx, workspaceId: string, tint: string): MenuEntry[] {
  const set = (t: string) => useStore.getState().patch('workspaces', workspaceId, { tint: t });
  return [
    { label: 'Nouveau groupe', icon: <FolderPlus size={14} />, onClick: () => ctx.newGroup(workspaceId, null) },
    { label: 'Ajouter un élément…', icon: <PackagePlus size={14} />, onClick: () => ctx.openAdd(workspaceId, null) },
    ...(ctx.newDraftHere ? [{ label: 'Nouvel écrit ici', icon: <FilePen size={14} />, onClick: () => ctx.newDraftHere!(workspaceId, null) }] : []),
    ...(ctx.newBoardHere ? [{ label: 'Nouvelle carte ici', icon: <Network size={14} />, onClick: () => ctx.newBoardHere!(workspaceId, null) }] : []),
    ...collabEntry(workspaceId),
    { sep: true },
    shareEntry(workspaceId),
    { label: 'Renommer', icon: <Pencil size={14} />, onClick: () => ctx.rename('ws', workspaceId) },
    {
      label: 'Changer la teinte',
      icon: <Palette size={14} />,
      children: TINTS.map((t) => ({ label: TINT_LABEL[t], swatch: t, checked: t === tint, onClick: () => set(t) })),
    },
    { sep: true },
    { label: 'Supprimer l’espace', icon: <Trash2 size={14} />, danger: true, onClick: () => ctx.askDeleteWs(workspaceId) },
  ];
}

/** Pendant une session dans cet espace : « Arrêter le partage » (« Quitter le partage » chez un invité). */
function collabEntry(workspaceId: string): MenuEntry[] {
  if (!collabAvailable()) return [];
  const c = useCollab.getState();
  if (isLiveIn(c, workspaceId)) return [{ label: c.role === 'host' ? 'Arrêter le partage' : 'Quitter le partage', icon: <UserX size={14} />, onClick: () => void stopCollab() }];
  return [];
}

/** « Partager » : le même choix que le bouton en haut à droite — une copie, ou travailler ensemble en direct. */
function shareEntry(workspaceId: string): MenuEntry {
  const copy = { label: 'Envoyer une copie…', icon: <Copy size={14} />, onClick: () => openShareDialog({ kind: 'workspace', workspaceId }) };
  if (!collabAvailable()) return { ...copy, label: 'Partager l’espace…', icon: <Share2 size={14} /> };
  const live = isLiveIn(useCollab.getState(), workspaceId);
  return {
    label: 'Partager',
    icon: <Share2 size={14} />,
    children: [copy, { label: live ? 'Session en direct…' : 'Travailler ensemble…', icon: <Users size={14} />, onClick: () => openCollabPanel(workspaceId) }],
  };
}

export function groupMenu(ctx: MenuCtx, g: WorkspaceGroup): MenuEntry[] {
  const out: MenuEntry[] = [
    { label: 'Nouveau sous-groupe', icon: <FolderPlus size={14} />, onClick: () => ctx.newGroup(g.workspaceId, g.id) },
    { label: 'Ajouter un élément…', icon: <PackagePlus size={14} />, onClick: () => ctx.openAdd(g.workspaceId, g.id) },
  ];
  if (ctx.importHere) out.push({ label: 'Importer ici…', icon: <Upload size={14} />, onClick: () => ctx.importHere!(g.workspaceId, g.id) });
  if (ctx.newDraftHere) out.push({ label: 'Nouvel écrit ici', icon: <FilePen size={14} />, onClick: () => ctx.newDraftHere!(g.workspaceId, g.id) });
  if (ctx.newBoardHere) out.push({ label: 'Nouvelle carte ici', icon: <Network size={14} />, onClick: () => ctx.newBoardHere!(g.workspaceId, g.id) });
  out.push(
    { sep: true },
    { label: 'Renommer', icon: <Pencil size={14} />, onClick: () => ctx.rename('group', g.id) },
    { label: 'Déplacer vers…', icon: <ArrowRightLeft size={14} />, onClick: () => ctx.openMove({ type: 'group', id: g.id, workspaceId: g.workspaceId }) },
    { sep: true },
    { label: 'Dégrouper', icon: <Ungroup size={14} />, hint: 'garde le contenu', onClick: () => ungroup(g.id) },
    { label: 'Supprimer le groupe et son contenu', icon: <FolderX size={14} />, danger: true, onClick: () => ctx.askDeleteGroup(g.id) },
  );
  return out;
}

export function itemMenu(ctx: MenuCtx, item: WorkspaceItem): MenuEntry[] {
  return [
    { label: 'Ouvrir', icon: <ExternalLink size={14} />, onClick: () => openItem(item) },
    ...(item.kind === 'book' && ctx.compareWith ? [{ label: 'Comparer avec un autre livre…', icon: <GitCompareArrows size={14} />, onClick: () => ctx.compareWith!(item.refId) }] : []),
    { label: 'Déplacer vers…', icon: <ArrowRightLeft size={14} />, onClick: () => ctx.openMove({ type: 'item', id: item.id, workspaceId: item.workspaceId }) },
    { sep: true },
    { label: 'Retirer de l’espace', icon: <Trash2 size={14} />, danger: true, onClick: () => useStore.getState().removeFromWorkspace(item.id) },
  ];
}
