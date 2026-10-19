// Bouton « Partager » en haut à droite d'un espace (et de ses cartes) : un seul endroit pour donner
// une copie ou travailler ensemble. Pendant une session dans cet espace, il montre les présents et
// « En direct », et ouvre directement la fenêtre de la session.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Share2, Users } from 'lucide-react';
import { useStore } from '../../lib/store';
import { openShareDialog } from '../share/shareUi';
import { collabAvailable, isLiveIn, openCollabPanel, useCollab } from './collabState';
import './collab.css';

/** L'espace d'un élément (carte, écrit) : celui de la session en cours s'il en fait partie, sinon le premier. */
export function useWorkspaceOf(kind: 'map' | 'draft', refId: string): string | null {
  const live = useCollab((s) => (s.role ? s.workspaceId : null));
  return useStore((s) => {
    const ids = s.wsItems.filter((i) => i.kind === kind && i.refId === refId).map((i) => i.workspaceId);
    if (!ids.length) return null;
    return live && ids.includes(live) ? live : ids[0];
  });
}

export function ShareButton({ workspaceId }: { workspaceId: string | null }) {
  const c = useCollab();
  const wsName = useStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.name ?? '');
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  if (!workspaceId) return null;

  if (isLiveIn(c, workspaceId)) {
    const shown = c.members.slice(0, 4);
    const more = c.members.length - shown.length;
    const off = c.phase === 'reconnecting';
    return (
      <button
        className={`btn cl-sharebtn is-live${off ? ' off' : ''}`}
        onClick={() => openCollabPanel(workspaceId)}
        title={`${off ? 'Connexion perdue' : 'En direct'} : ${c.members.map((m) => (m.id === c.me ? 'vous' : m.name)).join(', ')}`}
        data-testid="ws-share-live"
      >
        <span className="cl-sharebtn-dot" aria-hidden="true" />
        <span>{off ? 'Reconnexion…' : 'En direct'}</span>
        <span className="cl-sharebtn-faces">
          {shown.map((m) => (
            <span key={m.id} className="cl-face" style={{ background: m.color }} aria-label={m.id === c.me ? 'Vous' : m.name}>
              {m.name.trim().charAt(0).toUpperCase()}
            </span>
          ))}
          {more > 0 && <span className="cl-face cl-face-more">+{more}</span>}
        </span>
      </button>
    );
  }

  const copy = () => {
    setOpen(false);
    openShareDialog({ kind: 'workspace', workspaceId });
  };
  return (
    <>
      <button
        ref={btn}
        className="btn cl-sharebtn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (collabAvailable() ? setOpen(!open) : copy())}
        data-testid="ws-share"
      >
        <Share2 size={14} /> Partager
      </button>
      {open && (
        <SharePop
          anchor={btn.current}
          title={wsName}
          onClose={() => setOpen(false)}
          onCopy={copy}
          onLive={() => {
            setOpen(false);
            openCollabPanel(workspaceId);
          }}
        />
      )}
    </>
  );
}

function SharePop({ anchor, title, onClose, onCopy, onLive }: { anchor: HTMLElement | null; title: string; onClose: () => void; onCopy: () => void; onLive: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const r = anchor?.getBoundingClientRect();
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchor?.focus();
      }
    };
    document.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);
  if (!r) return null;
  return createPortal(
    <div
      ref={box}
      className="cl-sharepop anim-scale"
      role="dialog"
      aria-label={`Partager « ${title} »`}
      style={{ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) }}
      data-testid="ws-share-pop"
    >
      <p className="cl-sharepop-title">Partager « {title} »</p>
      <button className="cl-sharepop-opt" onClick={onCopy} data-testid="ws-share-copy">
        <span className="cl-sharepop-art is-copy" aria-hidden="true">
          <Copy size={20} />
        </span>
        <span className="cl-sharepop-text">
          <strong>Envoyer une copie</strong>
          <span>L’espace arrive chez l’autre, puis chacun continue de son côté.</span>
        </span>
      </button>
      <button className="cl-sharepop-opt" onClick={onLive} data-testid="ws-share-collab">
        <span className="cl-sharepop-art is-live" aria-hidden="true">
          <Users size={20} />
        </span>
        <span className="cl-sharepop-text">
          <strong>Travailler ensemble</strong>
          <span>Tout le monde modifie en direct, jusqu’à 6 personnes.</span>
        </span>
      </button>
    </div>,
    document.body,
  );
}
