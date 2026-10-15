// 20. Notes sur les liens : « Pourquoi ? » dans le menu d'un lien (par analogie, par
// l'absurde…). La note s'affiche au survol du lien, sous le nom de la relation ; une petite
// marque discrète sur la pastille du lien signale qu'il en porte une.
import { useEffect, useRef, useState } from 'react';
import { PenLine } from 'lucide-react';

const SUGGESTIONS = ['par analogie', 'par l’absurde', 'par l’exemple', 'a fortiori', 'par définition', 'par les conséquences'];

/** Champ « Pourquoi ? » du menu d'un lien. Enregistre à Entrée, à la sortie du champ et à la fermeture du menu. */
export function EdgeNoteField({ note, onSave }: { note: string; onSave(t: string): void }) {
  const [v, setV] = useState(note);
  const latest = useRef({ v, note, onSave });
  latest.current = { v, note, onSave };
  useEffect(() => setV(note), [note]);
  // Fermeture du menu (clic ailleurs, Échap) : on garde ce qui a été tapé.
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.v.trim() !== l.note.trim()) l.onSave(l.v);
    },
    [],
  );
  const commit = (t = v) => {
    if (t.trim() !== note.trim()) onSave(t);
  };
  const empty = !v.trim();
  return (
    <div className="map-note-field">
      <label className="map-menu-title" htmlFor="map-edge-note">
        Pourquoi ?
      </label>
      <textarea
        id="map-edge-note"
        className="map-note-input"
        data-testid="edge-note"
        rows={v.length > 34 ? 2 : 1}
        value={v}
        maxLength={240}
        placeholder="Par analogie, par l’absurde…"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          // Échap ferme le menu (la note tapée est gardée) ; les autres touches restent au champ.
          if (e.key !== 'Escape') e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
      {empty && (
        <div className="map-note-sugg">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              onClick={() => {
                setV(s);
                commit(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Marque discrète « ce lien a une note » (dans la pastille du lien, visible sans survol). */
export function EdgeNoteMark() {
  return (
    <span className="map-pill-mark" aria-hidden>
      <PenLine size={8} strokeWidth={2.6} />
    </span>
  );
}

/** Note affichée sous le nom de la relation (pastille dépliée). */
export function EdgeNoteText({ note }: { note: string }) {
  return <span className="map-pill-note">{note}</span>;
}
