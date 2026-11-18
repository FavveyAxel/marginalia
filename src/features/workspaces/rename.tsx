// « Renommer » un document depuis un menu : livre, PDF, vidéo, image (titre dans Marginalia : le
// fichier d'origine garde son nom), écrit ou plan. Une seule petite fenêtre, montée par App.tsx.
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useStore } from '../../lib/store';
import { Modal } from './wsUi';

export type RenameKind = 'book' | 'draft' | 'plan';
interface RenameTarget {
  kind: RenameKind;
  id: string;
}
const useRenameUi = create<{ target: RenameTarget | null }>(() => ({ target: null }));

/** Types d'éléments qu'on peut renommer d'ici. */
export const canRename = (kind: string): kind is RenameKind => kind === 'book' || kind === 'draft' || kind === 'plan';
/** Ouvre la fenêtre « Renommer ». */
export const askRename = (kind: RenameKind, id: string) => useRenameUi.setState({ target: { kind, id } });

function current(t: RenameTarget): { title: string; what: string } | null {
  const s = useStore.getState();
  if (t.kind === 'book') {
    const b = s.books.find((x) => x.id === t.id);
    if (!b) return null;
    const what = b.format === 'video' ? 'la vidéo' : b.format === 'image' ? 'l’image' : b.format === 'pdf' ? 'le PDF' : 'le livre';
    return { title: b.title, what };
  }
  if (t.kind === 'draft') {
    const d = s.drafts.find((x) => x.id === t.id);
    return d ? { title: d.title, what: 'l’écrit' } : null;
  }
  const p = s.plans.find((x) => x.id === t.id);
  return p ? { title: p.title, what: 'le plan' } : null;
}

function RenameDialog({ target, onClose }: { target: RenameTarget; onClose: () => void }) {
  const cur = current(target);
  const [name, setName] = useState(cur?.title ?? '');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  if (!cur) return null;
  const t = name.trim();
  const save = () => {
    if (t && t !== cur.title) {
      const s = useStore.getState();
      if (target.kind === 'book') s.updateBook(target.id, { title: t });
      else s.patch(target.kind === 'draft' ? 'drafts' : 'plans', target.id, { title: t });
      s.toast('Renommé', 'success');
    }
    onClose();
  };
  return (
    <Modal title={`Renommer ${cur.what}`} onClose={onClose}>
      <form
        className="ws-confirm"
        data-testid="rename-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h3>Renommer {cur.what}</h3>
        <input ref={input} className="input ws-rename-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nouveau titre" data-testid="rename-input" />
        {target.kind === 'book' && <p className="ws-rename-hint">Le titre change dans Marginalia ; le fichier d’origine garde son nom.</p>}
        <div className="ws-confirm-actions">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={!t} data-testid="rename-save">
            Renommer
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function RenameHost() {
  const target = useRenameUi((s) => s.target);
  if (!target) return null;
  return <RenameDialog key={`${target.kind}:${target.id}`} target={target} onClose={() => useRenameUi.setState({ target: null })} />;
}
