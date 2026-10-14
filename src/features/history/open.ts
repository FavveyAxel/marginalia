// Ouvrir l'objet d'une entrée du journal (ou de la corbeille).
import { useStore } from '../../lib/store';
import type { ActivityKind } from '../../lib/types';

/** Ouvre l'objet ; renvoie false s'il n'existe plus. */
export function openTarget(kind: ActivityKind, refId: string | null, bookId: string | null): boolean {
  const s = useStore.getState();
  const has = (col: 'books' | 'highlights' | 'concepts' | 'arguments' | 'plans' | 'drafts' | 'studies' | 'cards' | 'workspaces' | 'groups' | 'wsItems', id: string | null) =>
    !!id && (s[col] as { id: string }[]).some((x) => x.id === id);
  switch (kind) {
    case 'book':
      if (!has('books', refId)) return false;
      s.openBook(refId!);
      return true;
    case 'highlight':
      if (!has('highlights', refId)) return false;
      s.jumpToHighlight(refId!);
      return true;
    case 'concept':
      if (!has('concepts', refId)) return false;
      s.navigate({ name: 'concepts', conceptId: refId });
      return true;
    case 'argument':
      if (!has('arguments', refId)) return false;
      s.navigate({ name: 'arguments', argumentId: refId });
      return true;
    case 'plan':
      if (!has('plans', refId)) return false;
      s.navigate({ name: 'plans', planId: refId });
      return true;
    case 'draft':
      if (!has('drafts', refId)) return false;
      s.navigate({ name: 'write', draftId: refId });
      return true;
    case 'study': {
      const st = s.studies.find((x) => x.id === refId);
      if (!st || !has('books', st.bookId)) return false;
      s.updateSettings({ rightPanel: 'etude', showExtracts: true });
      s.openBook(st.bookId);
      return true;
    }
    case 'card':
      if (!has('cards', refId)) return false;
      s.navigate({ name: 'revision' });
      return true;
    case 'map': {
      const id = refId ?? bookId;
      if (!has('books', id)) return false;
      s.navigate({ name: 'reader', bookId: id!, tab: 'carte', splitBookId: null });
      return true;
    }
    case 'workspace':
      if (!has('workspaces', refId)) return false;
      s.navigate({ name: 'workspace', workspaceId: refId!, groupId: null });
      return true;
    case 'group': {
      const g = s.groups.find((x) => x.id === refId);
      if (!g || !has('workspaces', g.workspaceId)) return false;
      s.navigate({ name: 'workspace', workspaceId: g.workspaceId, groupId: g.id });
      return true;
    }
    case 'wsItem': {
      const it = s.wsItems.find((x) => x.id === refId);
      if (!it || !has('workspaces', it.workspaceId)) return false;
      s.navigate({ name: 'workspace', workspaceId: it.workspaceId, groupId: it.groupId });
      return true;
    }
    default:
      return false;
  }
}

/** L'objet existe-t-il encore ? */
export function targetExists(kind: ActivityKind, refId: string | null, bookId: string | null): boolean {
  const s = useStore.getState();
  const col: Partial<Record<ActivityKind, keyof typeof s>> = {
    book: 'books',
    highlight: 'highlights',
    concept: 'concepts',
    argument: 'arguments',
    plan: 'plans',
    draft: 'drafts',
    study: 'studies',
    card: 'cards',
    workspace: 'workspaces',
    group: 'groups',
    wsItem: 'wsItems',
  };
  if (kind === 'map') return s.books.some((b) => b.id === (refId ?? bookId));
  const c = col[kind];
  return !!c && !!refId && (s[c] as unknown as { id: string }[]).some((x) => x.id === refId);
}
