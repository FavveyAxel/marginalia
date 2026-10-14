// Notes privées : boutons de la barre d'outils, préférence « Masquer les notes privées »,
// raccourci ⌘⌥N et nettoyage du presse-papiers. Logique documentaire : privateNotes.ts.
import { useEffect, useRef, type MutableRefObject } from 'react';
import { create } from 'zustand';
import { Eye, EyeOff, NotebookPen } from 'lucide-react';
import type { DocEngine, EngineState } from './engine';
import { PRIVATE_STYLE_ID } from './privateNotes';
import { keepFocus, tip } from './controls';
import './notes-outline.css';
import { fmtKeys, matchKeys } from '../../lib/keys';

export const PRIVATE_NOTE_KEY = fmtKeys('⌘⌥N');
const HIDE_KEY = 'marginalia.ed.hidePrivateNotes';

const readHidden = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
};

/** Préférence d'affichage (commune à tous les écrits, retenue d'une session à l'autre). */
export const useNotesView = create<{ hidden: boolean; setHidden: (v: boolean) => void }>((set) => ({
  hidden: readHidden(),
  setHidden: (v) => {
    try {
      localStorage.setItem(HIDE_KEY, v ? '1' : '0');
    } catch {
      /* indisponible */
    }
    set({ hidden: v });
  },
}));

type Notify = (message: string, tone?: 'info' | 'error' | 'success') => void;

/** Insère / convertit / retire une note privée au curseur (réaffiche les notes si elles étaient masquées). */
export async function runPrivateNote(e: DocEngine, notify: Notify): Promise<void> {
  const view = useNotesView.getState();
  if (view.hidden && !e.inPrivateNote()) {
    view.setHidden(false);
    e.setPrivateNotesHidden(false);
  }
  const r = await e.togglePrivateNote();
  if (r === null) notify('Placez le curseur dans le texte pour ajouter une note privée.', 'info');
  else if (r === 'reverted') notify('Note privée repassée en texte normal : elle sera exportée.', 'info');
}

/** Boutons de la barre d'outils : note privée, masquer / afficher. */
export function PrivateNoteTools({ engine, fmt, editable, refresh, notify }: { engine: () => DocEngine | null; fmt: EngineState; editable: boolean; refresh: () => void; notify: Notify }) {
  const hidden = useNotesView((s) => s.hidden);
  const setHidden = useNotesView((s) => s.setHidden);
  const inNote = fmt.styleId === PRIVATE_STYLE_ID;
  return (
    <>
      <button
        className={`ed-tb-text ed-pn-btn ${inNote ? 'active' : ''}`}
        disabled={!editable}
        onMouseDown={keepFocus}
        onClick={() => {
          const e = engine();
          if (e) void runPrivateNote(e, notify).then(refresh);
        }}
        title={tip(inNote ? 'Repasser la note privée en texte normal' : 'Note privée : visible ici, jamais exportée', PRIVATE_NOTE_KEY)}
        aria-label="Note privée"
        aria-pressed={inNote}
        data-tb="private-note"
      >
        <NotebookPen size={14} />
        Privée
      </button>
      <button
        className={`icon-btn sm ed-tb-btn ${hidden ? 'active' : ''}`}
        onMouseDown={keepFocus}
        onClick={() => {
          setHidden(!hidden);
          engine()?.setPrivateNotesHidden(!hidden);
          refresh();
        }}
        title={hidden ? 'Afficher les notes privées' : 'Masquer les notes privées'}
        aria-label="Masquer les notes privées"
        aria-pressed={hidden}
        data-tb="hide-notes"
      >
        {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </>
  );
}

/** La cible du clavier est-elle le texte du document ? */
function inDocument(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && typeof el.closest === 'function' && !!el.closest('.ProseMirror, .ed-engine');
}

/**
 * Branche les notes privées sur l'éditeur : préférence d'affichage appliquée à l'ouverture et
 * après chaque réouverture (`tick` change), raccourci ⌘⌥N, presse-papiers sans notes privées.
 */
export function usePrivateNotes(engineRef: MutableRefObject<DocEngine | null>, ready: boolean, editable: boolean, tick: unknown, notify: Notify, refresh: () => void) {
  const hidden = useNotesView((s) => s.hidden);
  const cb = useRef({ notify, refresh, editable });
  cb.current = { notify, refresh, editable };

  useEffect(() => {
    if (!ready) return;
    engineRef.current?.setPrivateNotesHidden(hidden);
    // filet : un appel de note de bas de page dans une note masquée garde une ligne peinte
    document.querySelector('.ed-engine')?.classList.toggle('ed-pn-hidden', hidden);
  }, [engineRef, ready, hidden, tick]);

  // Enregistré au montage (avant les raccourcis d'EditorScreen, également en capture sur window) :
  // stopImmediatePropagation empêche tout autre traitement de ⌘⌥N.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const e = engineRef.current;
      if (!e || !cb.current.editable || !matchKeys(ev, '⌘⌥N') || !inDocument(ev.target)) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      void runPrivateNote(e, cb.current.notify).then(cb.current.refresh);
    };
    const onCopy = (ev: ClipboardEvent) => {
      const e = engineRef.current;
      if (!e || !inDocument(ev.target)) return;
      e.stripCopy(ev);
    };
    window.addEventListener('keydown', onKey, true);
    // phase de bouillonnement : après l'éditeur, qui a déjà rempli le presse-papiers
    window.addEventListener('copy', onCopy);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('copy', onCopy);
    };
  }, [engineRef]);
}
