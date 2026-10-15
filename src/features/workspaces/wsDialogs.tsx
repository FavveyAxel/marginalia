// Dialogues partagés (confirmation, ajout, déplacement) pilotés par un seul hook.
import { useState, type ReactNode } from 'react';
import { useStore } from '../../lib/store';
import { AddItemsDialog, ConfirmDialog, MoveDialog } from './wsUi';
import { deleteGroupCascade, goToWorkspace, subtreeIds, type DragPayload } from './wsModel';
import type { MenuCtx } from './wsMenus';

type Dlg =
  | { t: 'delWs'; id: string }
  | { t: 'delGroup'; id: string }
  | { t: 'add'; workspaceId: string; groupId: string | null }
  | { t: 'move'; p: DragPayload };

export function useWsDialogs(base: Pick<MenuCtx, 'newGroup' | 'rename'> & Partial<Pick<MenuCtx, 'importHere' | 'newDraftHere' | 'newBoardHere'>>): { ctx: MenuCtx; dialogs: ReactNode } {
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const ctx: MenuCtx = {
    ...base,
    askDeleteWs: (id) => setDlg({ t: 'delWs', id }),
    askDeleteGroup: (id) => setDlg({ t: 'delGroup', id }),
    openAdd: (workspaceId, groupId) => setDlg({ t: 'add', workspaceId, groupId }),
    openMove: (p) => setDlg({ t: 'move', p }),
  };
  const close = () => setDlg(null);
  let node: ReactNode = null;
  if (dlg?.t === 'delWs') node = <DelWs id={dlg.id} onClose={close} />;
  else if (dlg?.t === 'delGroup') node = <DelGroup id={dlg.id} onClose={close} />;
  else if (dlg?.t === 'add') node = <AddItemsDialog workspaceId={dlg.workspaceId} groupId={dlg.groupId} onClose={close} />;
  else if (dlg?.t === 'move') node = <MoveDialog payload={dlg.p} onClose={close} />;
  return { ctx, dialogs: node };
}

function DelWs({ id, onClose }: { id: string; onClose: () => void }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === id));
  const n = useStore((s) => s.wsItems.filter((i) => i.workspaceId === id).length);
  if (!ws) return null;
  return (
    <ConfirmDialog
      title={`Supprimer l’espace « ${ws.name} » ?`}
      body={`Les groupes et les ${n} référence${n > 1 ? 's' : ''} de l’espace sont supprimés. Vos livres, écrits, plans et arguments restent intacts. L’espace reste 30 jours dans la corbeille.`}
      confirmLabel="Supprimer l’espace"
      onClose={onClose}
      onConfirm={() => {
        const s = useStore.getState();
        const r = s.route;
        s.removeWorkspace(id);
        if (r.name === 'workspace' && r.workspaceId === id) s.navigate({ name: 'home' });
      }}
    />
  );
}

function DelGroup({ id, onClose }: { id: string; onClose: () => void }) {
  const g = useStore((s) => s.groups.find((x) => x.id === id));
  const groups = useStore((s) => s.groups);
  const wsItems = useStore((s) => s.wsItems);
  if (!g) return null;
  const ids = subtreeIds(groups, id);
  const n = wsItems.filter((i) => i.groupId && ids.has(i.groupId)).length;
  return (
    <ConfirmDialog
      title={`Supprimer le groupe « ${g.name} » ?`}
      body={`Le groupe, ses ${ids.size - 1} sous-groupe${ids.size - 1 > 1 ? 's' : ''} et ses ${n} référence${n > 1 ? 's' : ''} disparaissent de l’espace. Les documents eux-mêmes restent dans votre bibliothèque. Pour garder le contenu, choisissez plutôt « Dégrouper ». Le groupe reste 30 jours dans la corbeille.`}
      confirmLabel="Supprimer le groupe"
      onClose={onClose}
      onConfirm={() => {
        const s = useStore.getState();
        const r = s.route;
        deleteGroupCascade(id);
        if (r.name === 'workspace' && r.groupId && ids.has(r.groupId)) goToWorkspace(g.workspaceId, g.parentId);
      }}
    />
  );
}
