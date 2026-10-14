// Panneau « Plan » : titres 1 à 3, clic = défilement, titre courant (curseur ou défilement),
// sections réordonnées par glisser-déposer ou au clavier (⌥⇧↑ / ⌥⇧↓). Opérations : outlineMove.ts.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { GripVertical } from 'lucide-react';
import type { DocEngine, OutlineItem } from './engine';
import './notes-outline.css';

type Notify = (message: string, tone?: 'info' | 'error' | 'success') => void;

export const MOVE_KEYS = { up: '⌥⇧↑', down: '⌥⇧↓' };

/** Titre courant d'après le défilement : dernier titre dont le haut est passé sous le haut de la zone. */
function scrollActive(items: OutlineItem[]): number {
  const scroller = document.querySelector('.ed-scroll');
  if (!scroller || !items.length) return -1;
  const limit = scroller.getBoundingClientRect().top + Math.min(160, scroller.clientHeight * 0.3);
  const frags = Array.from(document.querySelectorAll<HTMLElement>('.ed-engine .superdoc-fragment[data-pm-start]'));
  const starts = frags.map((f) => Number(f.dataset.pmStart));
  let cur = -1;
  items.forEach((o, i) => {
    const k = starts.findIndex((s) => s > o.pos && s <= o.pos + 4);
    if (k < 0) return;
    if (frags[k].getBoundingClientRect().top <= limit) cur = i;
  });
  return cur;
}

/** ⌥⇧↑ / ⌥⇧↓ dans le texte : déplace la section du curseur. */
export function useSectionKeys(engineRef: MutableRefObject<DocEngine | null>, editable: boolean, notify: Notify, refresh: () => void) {
  const cb = useRef({ editable, notify, refresh });
  cb.current = { editable, notify, refresh };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!ev.altKey || !ev.shiftKey || ev.metaKey || ev.ctrlKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
      const t = ev.target as HTMLElement | null;
      if (!t || typeof t.closest !== 'function' || !t.closest('.ProseMirror')) return;
      const e = engineRef.current;
      if (!e || !cb.current.editable) return;
      ev.preventDefault();
      ev.stopPropagation();
      const ok = e.stepSection(ev.key === 'ArrowUp' ? -1 : 1);
      if (!ok) cb.current.notify(ev.key === 'ArrowUp' ? 'Cette section est déjà la première de son niveau.' : 'Cette section est déjà la dernière de son niveau.', 'info');
      cb.current.refresh();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [engineRef]);
}

export function Outline({
  items,
  caretActive,
  engine,
  editable,
  notify,
  refresh,
}: {
  items: OutlineItem[];
  /** Titre courant d'après le curseur. */
  caretActive: number;
  engine: () => DocEngine | null;
  editable: boolean;
  notify: Notify;
  refresh: () => void;
}) {
  const [active, setActive] = useState(caretActive);
  const [drag, setDrag] = useState<number | null>(null);
  /** Indice d'insertion (avant l'élément k ; items.length = fin du document). */
  const [drop, setDrop] = useState<number | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Texte du titre à refocaliser après un déplacement au clavier. */
  const refocus = useRef<string | null>(null);
  /** Après un clic, le défilement animé ne doit pas changer le titre courant. */
  const scrollLock = useRef(0);

  useEffect(() => setActive(caretActive), [caretActive]);

  // Titre courant au défilement
  useEffect(() => {
    const scroller = document.querySelector('.ed-scroll');
    if (!scroller) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (performance.now() < scrollLock.current) return;
        const i = scrollActive(items);
        if (i >= 0) setActive(i);
      });
    };
    scroller.addEventListener('scroll', on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', on);
    };
  }, [items]);

  // Après un déplacement au clavier, le focus suit la section déplacée.
  useEffect(() => {
    const t = refocus.current;
    if (!t) return;
    const b = Array.from(listRef.current?.querySelectorAll<HTMLElement>('.ed-outline-item') ?? []).find((x) => x.textContent === t);
    if (b) {
      refocus.current = null;
      b.focus();
    }
  }, [items]);

  useEffect(() => {
    if (!moved) return;
    const t = setTimeout(() => setMoved(null), 900);
    return () => clearTimeout(t);
  }, [moved]);

  const after = (text: string, ok: boolean) => {
    if (!ok) {
      notify('Ce déplacement n’est pas possible (titre dans un tableau ou section déplacée dans elle-même).', 'info');
      return;
    }
    setMoved(text);
    refresh();
  };

  const doDrop = (k: number) => {
    const from = drag;
    setDrag(null);
    setDrop(null);
    const e = engine();
    if (from === null || !e || !editable) return;
    const src = items[from];
    const target = k < items.length ? items[k].pos : e.docEnd();
    if (k === from || k === from + 1) return;
    after(src.text, e.moveSection(src.pos, target));
  };

  const onItemKey = (ev: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (ev.altKey && ev.shiftKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      ev.preventDefault();
      const e = engine();
      if (!e || !editable) return;
      const dir = ev.key === 'ArrowUp' ? -1 : 1;
      const ok = e.stepSection(dir, items[i].pos);
      if (!ok) notify(dir < 0 ? 'Cette section est déjà la première de son niveau.' : 'Cette section est déjà la dernière de son niveau.', 'info');
      else {
        refocus.current = items[i].text;
        after(items[i].text, true);
      }
      return;
    }
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      const btns = listRef.current?.querySelectorAll<HTMLElement>('.ed-outline-item');
      btns?.[Math.max(0, Math.min((btns?.length ?? 1) - 1, i + (ev.key === 'ArrowUp' ? -1 : 1)))]?.focus();
    }
  };

  return (
    <nav className="ed-outline" aria-label="Plan de l’écrit">
      <div className="ed-outline-title">Plan</div>
      {items.length === 0 ? (
        <p className="ed-outline-empty">Les titres de votre écrit apparaîtront ici.</p>
      ) : (
        <div
          ref={listRef}
          className={`ed-ol-list ${drag !== null ? 'dragging' : ''}`}
          role="list"
          onDragOver={(ev) => {
            if (drag === null) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(ev) => {
            ev.preventDefault();
            if (drop !== null) doDrop(drop);
          }}
        >
          {items.map((o, i) => (
            <div
              key={`${o.pos}-${i}`}
              role="listitem"
              className={`ed-ol-row l${o.level} ${drag === i ? 'is-drag' : ''} ${drop === i ? 'drop-before' : ''} ${drop === items.length && i === items.length - 1 ? 'drop-after' : ''} ${moved === o.text ? 'is-moved' : ''}`}
              draggable={editable}
              onDragStart={(ev) => {
                setDrag(i);
                ev.dataTransfer.effectAllowed = 'move';
                ev.dataTransfer.setData('text/plain', o.text);
              }}
              onDragEnd={() => {
                setDrag(null);
                setDrop(null);
              }}
              onDragOver={(ev) => {
                if (drag === null) return;
                ev.preventDefault();
                const r = ev.currentTarget.getBoundingClientRect();
                const k = ev.clientY < r.top + r.height / 2 ? i : i + 1;
                if (k !== drop) setDrop(k);
              }}
              data-pos={o.pos}
            >
              {editable && <GripVertical size={12} className="ed-ol-grip" aria-hidden />}
              <button
                className={`ed-outline-item l${o.level} ${i === active ? 'active' : ''}`}
                aria-current={i === active ? 'location' : undefined}
                onClick={() => {
                  setActive(i);
                  scrollLock.current = performance.now() + 900;
                  engine()?.goTo(o.pos);
                }}
                onKeyDown={(ev) => onItemKey(ev, i)}
                title={editable ? `${o.text}\nGlisser pour déplacer la section (${MOVE_KEYS.up} / ${MOVE_KEYS.down})` : o.text}
                aria-keyshortcuts="Alt+Shift+ArrowUp Alt+Shift+ArrowDown"
              >
                <span className="ed-outline-text">{o.text}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
