// Pont entre l'éditeur et « Travailler à plusieurs » : léger (la session se charge à la demande).
import { useStore } from '../../lib/store';
import { useCollab } from './collabState';
import type { CollabBinding } from './rooms';

export type { CollabBinding };

/** L'écrit appartient-il à l'espace partagé en cours ? */
export function inLiveWorkspace(draftId: string): boolean {
  const c = useCollab.getState();
  if (!c.role || !c.workspaceId) return false;
  return useStore.getState().wsItems.some((i) => i.workspaceId === c.workspaceId && i.kind === 'draft' && i.refId === draftId);
}

/**
 * Lien Yjs pour l'écrit qui s'ouvre, s'il est dans l'espace partagé en cours ; null sinon.
 * 'offline' : invité dont la connexion est coupée (l'écrit s'ouvre en lecture seule jusqu'au retour).
 */
export async function collabBindingFor(draftId: string): Promise<CollabBinding | 'offline' | null> {
  const c = useCollab.getState();
  if (!inLiveWorkspace(draftId)) return null;
  if (c.phase === 'reconnecting') return 'offline';
  if (c.phase !== 'live') return null;
  const m = await import('./session');
  try {
    return await m.bindDraft(draftId);
  } catch (e) {
    useStore.getState().toast(e instanceof Error ? e.message : String(e), 'info');
    return null;
  }
}
