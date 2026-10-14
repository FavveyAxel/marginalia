// Icône par nature d'objet (corbeille, journal).
import { Bookmark, BookOpen, Brain, FileDown, FilePen, Folder, FolderOpen, Highlighter, Lightbulb, Link2, ListTree, Network, NotebookPen, Sigma } from 'lucide-react';
import type { ActivityKind } from '../../lib/types';

export function KindIcon({ kind, size = 15 }: { kind: ActivityKind; size?: number }) {
  const p = { size, 'aria-hidden': true } as const;
  switch (kind) {
    case 'book':
      return <BookOpen {...p} />;
    case 'highlight':
      return <Highlighter {...p} />;
    case 'concept':
      return <Lightbulb {...p} />;
    case 'argument':
      return <Sigma {...p} />;
    case 'study':
      return <NotebookPen {...p} />;
    case 'plan':
      return <ListTree {...p} />;
    case 'draft':
      return <FilePen {...p} />;
    case 'card':
      return <Brain {...p} />;
    case 'workspace':
      return <FolderOpen {...p} />;
    case 'group':
      return <Folder {...p} />;
    case 'map':
      return <Network {...p} />;
    case 'wsItem':
      return <Link2 {...p} />;
    case 'bookmark':
      return <Bookmark {...p} />;
    default:
      return <FileDown {...p} />;
  }
}
