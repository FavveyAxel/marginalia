// Barre latérale : un espace partagé en direct est encadré de la couleur de la session, avec l'icône
// « deux personnes » et le nombre de connectés ; les prénoms au survol. Chez l'hôte comme chez les invités.
import { Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { isLiveIn, useCollab } from './collabState';
import './collab.css';

export interface CollabMark {
  count: number;
  names: string;
  color: string;
  reconnecting: boolean;
}

/** Marque de session d'un espace (null hors session). */
export function useCollabMark(workspaceId: string): CollabMark | null {
  return useCollab((s) => {
    if (!isLiveIn(s, workspaceId)) return null;
    const live = s.members.filter((m) => m.state === 'live');
    const hostColor = s.members.find((m) => m.host)?.color ?? '#c2410c';
    // Objet stable pour zustand : on le reconstruit seulement si la clé change.
    const key = `${live.length}|${live.map((m) => m.name).join(', ')}|${hostColor}|${s.phase}`;
    const prev = cache.get(workspaceId);
    if (prev && prev.key === key) return prev.mark;
    const mark = { count: Math.max(1, live.length), names: live.map((m) => m.name).join(', '), color: hostColor, reconnecting: s.phase === 'reconnecting' };
    cache.set(workspaceId, { key, mark });
    return mark;
  });
}
const cache = new Map<string, { key: string; mark: CollabMark }>();

/** Pastille « deux personnes · n » de la ligne de l'espace. */
export function CollabBadge({ mark }: { mark: CollabMark }) {
  return (
    <span className="ws-collab-badge" title={`En direct : ${mark.names}`} aria-label={`Partagé en direct avec ${mark.count} personnes : ${mark.names}`} data-testid="ws-collab-badge">
      <Users size={11} strokeWidth={2.4} />
      {mark.count}
    </span>
  );
}

export function RailCollab({ workspaceId, children }: { workspaceId: string; children: (m: CollabMark | null) => ReactNode }) {
  const mark = useCollabMark(workspaceId);
  return <>{children(mark)}</>;
}
