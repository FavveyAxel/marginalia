// Actions asynchrones des espaces : import dans un groupe, nouvel écrit.
import { useStore } from '../../lib/store';
import { host, filesFromDrop, type PickedFile } from '../../lib/platform';
import { createDraft } from '../editor/api';
import type { Book } from '../../lib/types';
import { goToWorkspace } from './wsModel';

export async function importIntoWorkspace(files: PickedFile[], workspaceId: string, groupId: string | null): Promise<Book[]> {
  const s = useStore.getState();
  if (!files.length) return [];
  // importFiles ajoute à l'espace actif : on le fixe d'abord sur la cible pour éviter une référence parasite.
  s.updateSettings({ activeWorkspaceId: workspaceId });
  const books = await s.importFiles(files);
  for (const b of books) useStore.getState().addToWorkspace(workspaceId, groupId, 'book', b.id);
  return books;
}

export async function importFromDrop(list: FileList, workspaceId: string, groupId: string | null) {
  const files = await filesFromDrop(list);
  if (!files.length) {
    useStore.getState().toast('Format non pris en charge', 'error');
    return [];
  }
  return importIntoWorkspace(files, workspaceId, groupId);
}

export async function importHere(workspaceId: string, groupId: string | null) {
  const files = await host.pickFiles();
  return importIntoWorkspace(files, workspaceId, groupId);
}

export async function newDraftHere(workspaceId: string, groupId: string | null) {
  try {
    const d = await createDraft({ title: 'Sans titre', template: 'vide' });
    useStore.getState().addToWorkspace(workspaceId, groupId, 'draft', d.id);
    goToWorkspaceSilently(workspaceId);
    useStore.getState().navigate({ name: 'write', draftId: d.id });
  } catch (e) {
    console.error(e);
    useStore.getState().toast('Impossible de créer l’écrit', 'error');
  }
}

function goToWorkspaceSilently(workspaceId: string) {
  useStore.getState().updateSettings({ activeWorkspaceId: workspaceId });
}

export { goToWorkspace };
