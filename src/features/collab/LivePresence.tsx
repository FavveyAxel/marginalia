// Éditeur : « En direct » et les personnes qui écrivent dans le même écrit (leurs curseurs sont dans la page).
import { Eye, Users, WifiOff } from 'lucide-react';
import { useStore } from '../../lib/store';
import { useCollab } from './collabState';
import './collab.css';

export function LivePresence({ draftId, mode }: { draftId: string; mode: 'live' | 'offline' }) {
  const members = useCollab((s) => s.members);
  const rooms = useCollab((s) => s.rooms);
  const me = useCollab((s) => s.me);
  const phase = useCollab((s) => s.phase);
  const readOnly = useCollab((s) => s.role === 'guest' && !s.perm.drafts);
  const host = useCollab((s) => s.members.find((m) => m.host)?.name ?? 'L’hôte');
  const gid = useStore((s) => {
    const d = s.drafts.find((x) => x.id === draftId);
    return d?.shareOrigin?.srcId ?? draftId;
  });
  if (mode === 'offline' || phase === 'reconnecting')
    return (
      <span className="cl-live off" data-testid="ed-live" role="status">
        <WifiOff size={13} /> {mode === 'offline' ? 'Connexion perdue : lecture seule' : 'Connexion perdue : vous continuez seul'}
      </span>
    );
  const here = (rooms[gid] ?? []).filter((id) => id !== me).map((id) => members.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m);
  return (
    <span className="cl-live" data-testid="ed-live" title={readOnly ? `${host} a choisi que les invités ne modifient pas les écrits.` : here.length ? `Écrivent aussi ici : ${here.map((m) => m.name).join(', ')}` : 'Écrit partagé en direct'}>
      {readOnly ? <Eye size={13} /> : <Users size={13} />} {readOnly ? 'En direct · lecture seule' : 'En direct'}
      {here.map((m) => (
        <span key={m.id} className="cl-face" style={{ background: m.color }} aria-label={m.name}>
          {m.name.trim().charAt(0).toUpperCase()}
        </span>
      ))}
    </span>
  );
}
