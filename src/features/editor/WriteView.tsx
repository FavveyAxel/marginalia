// Vue « Écrits » : liste des écrits ou éditeur pleine page.
import './editor.css';
import { DraftList } from './DraftList';
import { EditorScreen } from './EditorScreen';

export function WriteView({ draftId }: { draftId: string | null }) {
  return draftId ? <EditorScreen key={draftId} draftId={draftId} /> : <DraftList />;
}
