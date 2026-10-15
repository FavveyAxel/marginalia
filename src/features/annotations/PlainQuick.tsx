// Actions rapides d'un surlignage simple (carte d'extrait) : le classer d'un clic, ou lui ajouter une note.
import { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { useStore } from '../../lib/store';
import { CATEGORIES } from '../../lib/categories';
import type { Highlight } from '../../lib/types';
import './annotations.css';

export function PlainQuick({ h }: { h: Highlight }) {
  const [noting, setNoting] = useState(false);
  const [text, setText] = useState('');
  const pending = useRef('');
  pending.current = noting ? text : '';
  const save = () => {
    pending.current = '';
    const v = text.trim();
    if (v) useStore.getState().updateHighlight(h.id, { note: v });
    setNoting(false);
  };
  // Carte démontée en cours de saisie (liste virtualisée défilée) : la note n'est pas perdue.
  useEffect(
    () => () => {
      const v = pending.current.trim();
      if (v && useStore.getState().highlights.some((x) => x.id === h.id)) useStore.getState().updateHighlight(h.id, { note: v });
    },
    [h.id],
  );
  return (
    <div className="ann-plain-quick" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {noting ? (
        <textarea
          className="textarea ann-plain-note"
          rows={2}
          autoFocus
          aria-label="Note sur ce surlignage"
          placeholder="Votre note (devient une note de marge)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setText('');
              setNoting(false);
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
          }}
        />
      ) : (
        <>
          <span className="ann-plain-lbl">Classer</span>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              className="ann-plain-cat"
              title={`${c.label} — ${c.description}`}
              aria-label={`Classer en ${c.label}`}
              data-set-cat={c.id}
              onClick={() => useStore.getState().setCategoryOf(h.id, c.id)}
            >
              <span className="cat-dot" style={{ background: `var(${c.cssVar})` }} />
            </button>
          ))}
          <button className="ann-plain-add" title="Ajouter une note (devient une note de marge)" data-add-note onClick={() => setNoting(true)}>
            <MessageSquarePlus size={12} /> Note
          </button>
        </>
      )}
    </div>
  );
}
