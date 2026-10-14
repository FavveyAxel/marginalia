// Popover d'un extrait : catégorie, note « ma voix », page imprimée, concepts, actions.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Copy, Layers, Plus, Trash2, Waypoints, X } from 'lucide-react';
import { useStore, uid } from '../../lib/store';
import { CATEGORIES, CATEGORY_BY_ID, NOTE_KINDS } from '../../lib/categories';
import { formatCitation, referenceParts, locatorOf } from '../../lib/citation';
import { useFloating } from '../../components/ui';
import type { Highlight, NoteKind, ReviewCard } from '../../lib/types';
import { copyText, norm } from './util';
import './annotations.css';

const W = 360;

export function HighlightPopover({ highlightId, rect, onClose }: { highlightId: string; rect: DOMRect; onClose(): void }) {
  const h = useStore((s) => s.highlights.find((x) => x.id === highlightId));
  const book = useStore((s) => (h ? s.books.find((b) => b.id === h.bookId) : undefined));
  const concepts = useStore((s) => s.concepts);
  const [ref, style] = useFloating(rect, 'below');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRefs = (el: HTMLDivElement | null) => {
    rootRef.current = el;
    ref(el);
  };
  // La carte grandit (note, suggestions) : elle reste entièrement dans la fenêtre
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setHeight(el.getBoundingClientRect().height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [h?.id, !!book]);
  const top = typeof style.top === 'number' && height ? Math.max(8, Math.min(style.top, window.innerHeight - 8 - height)) : style.top;

  // Fermeture : clic extérieur / Échap (jamais en cliquant dedans)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && rootRef.current?.contains(t)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  if (!h || !book) return null;

  return createPortal(
    <div ref={setRefs} className="floating ann-pop" style={{ ...style, top, width: W }} role="dialog" aria-label="Extrait" data-hid={h.id}>
      <PopBody h={h} onClose={onClose} concepts={concepts} ready={style.visibility !== 'hidden'} />
    </div>,
    document.body,
  );
}

function PopBody({ h, onClose, concepts, ready }: { h: Highlight; onClose(): void; concepts: ReturnType<typeof useStore.getState>['concepts']; ready: boolean }) {
  const book = useStore((s) => s.books.find((b) => b.id === h.bookId))!;
  const st = useStore.getState;

  const cat = h.category ? CATEGORY_BY_ID[h.category] : null;

  // ── Note (sauvegarde auto) ──
  const [note, setNote] = useState(h.note);
  const noteRef = useRef(h.note);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [saved, setSaved] = useState(false);
  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const cur = useStore.getState().highlights.find((x) => x.id === h.id);
    if (cur && cur.note !== noteRef.current) {
      st().updateHighlight(h.id, { note: noteRef.current });
      setSaved(true);
    }
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const autosize = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight + 2, 220) + 'px';
  };
  useEffect(autosize, [note]);
  // Focus quand la carte est positionnée (un élément masqué ne peut pas être focalisé)
  const focused = useRef(false);
  useEffect(() => {
    if (!ready || focused.current) return;
    focused.current = true;
    if (!h.note.trim()) taRef.current?.focus();
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1400);
    return () => clearTimeout(t);
  }, [saved]);

  const onNote = (v: string) => {
    setNote(v);
    noteRef.current = v;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 450);
  };

  // ── Concepts ──
  const [cq, setCq] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const [cOpen, setCOpen] = useState(false);
  const linked = useMemo(() => h.conceptIds.map((id) => concepts.find((c) => c.id === id)).filter(Boolean) as typeof concepts, [h.conceptIds, concepts]);
  const q = norm(cq.trim());
  const suggestions = useMemo(() => {
    const pool = concepts.filter((c) => !h.conceptIds.includes(c.id));
    const list = q ? pool.filter((c) => norm(c.name).includes(q)) : pool;
    return list.sort((a, b) => a.name.localeCompare(b.name, 'fr')).slice(0, 6);
  }, [concepts, h.conceptIds, q]);
  const exact = !!q && concepts.some((c) => norm(c.name) === q);
  const canCreate = !!q && !exact;
  const options: ({ kind: 'existing'; id: string; name: string } | { kind: 'create'; name: string })[] = [
    ...suggestions.map((c) => ({ kind: 'existing' as const, id: c.id, name: c.name })),
    ...(canCreate ? [{ kind: 'create' as const, name: cq.trim() }] : []),
  ];
  useEffect(() => setFocusIdx(0), [cq]);

  const pick = (o: (typeof options)[number]) => {
    if (o.kind === 'existing') {
      if (!h.conceptIds.includes(o.id)) st().toggleHighlightConcept(h.id, o.id);
    } else {
      const c = st().addConcept(o.name);
      const cur = useStore.getState().highlights.find((x) => x.id === h.id);
      if (cur && !cur.conceptIds.includes(c.id)) st().toggleHighlightConcept(h.id, c.id);
    }
    setCq('');
  };

  // ── Actions ──
  const copy = async () => {
    const ok = await copyText(formatCitation(h, book));
    st().toast(ok ? 'Citation copiée' : 'Copie impossible', ok ? 'success' : 'error');
  };

  const makeCard = () => {
    const s = st();
    if (s.cards.some((c) => c.highlightId === h.id)) {
      s.toast('Une carte existe déjà pour cet extrait');
      return;
    }
    const isDef = h.category === 'concept';
    const first = linked[0];
    const text = h.text.replace(/\s+/g, ' ').trim();
    const short = text.length > 90 ? text.slice(0, 90).trimEnd() + '…' : text;
    const who = book.author || 'l’auteur';
    const front = isDef
      ? first
        ? `Comment ${who} définit-il « ${first.name} » ?`
        : `Quelle distinction ou définition ${who} pose-t-il ici ? « ${short} »`
      : `De quel texte est tiré ce passage, et que dit-il ? « ${short} »`;
    const back = `${text}\n\n${referenceParts(book).plain}${locatorOf(h) ? `, ${locatorOf(h)}` : ''}.`;
    const card: ReviewCard = {
      id: uid(),
      kind: isDef ? 'definition' : 'citation',
      front,
      back,
      highlightId: h.id,
      conceptId: isDef && first ? first.id : null,
      bookId: h.bookId,
      suspended: false,
      fsrs: { due: Date.now(), stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null },
      createdAt: Date.now(),
    };
    s.insert('cards', card);
    s.toast('Carte de révision créée', 'success');
  };

  const del = () => {
    flush();
    // Corbeille : le store propose « Annuler » (restauration exacte, cartes et liens compris).
    st().removeHighlight(h.id);
    onClose();
  };

  const setKind = (k: NoteKind | null) => st().updateHighlight(h.id, { noteKind: k });

  return (
    <>
      <div className="ann-pop-cats" role="radiogroup" aria-label="Catégorie">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="radio"
            aria-checked={h.category === c.id}
            className={`ann-cat-btn ${h.category === c.id ? 'active' : ''}`}
            style={{ ['--c' as string]: `var(${c.cssVar})` }}
            onClick={() => st().setCategoryOf(h.id, c.id)}
            title={`${c.label} — ${c.description} (${c.key})`}
            data-cat={c.id}
          >
            <span className="cat-dot" style={{ background: `var(${c.cssVar})` }} />
            <span>{c.label}</span>
          </button>
        ))}
        <button
          role="radio"
          aria-checked={h.category === null}
          className={`ann-cat-btn ${h.category === null ? 'active' : ''}`}
          style={{ ['--c' as string]: 'var(--muted)' }}
          onClick={() => st().setCategoryOf(h.id, null)}
          title="Note de marge, sans catégorie"
          data-cat="none"
        >
          <span className="cat-dot ann-dot-note" />
          <span>Note de marge</span>
        </button>
      </div>

      <div className="ann-pop-quote" style={{ ['--c' as string]: cat ? `var(${cat.cssVar})` : 'var(--muted)' }}>
        {h.text}
      </div>

      <div className="ann-pop-section">
        <div className="ann-pop-label">
          <span>Ma note</span>
          <span className={`ann-saved ${saved ? 'on' : ''}`}>Enregistré</span>
        </div>
        <textarea
          ref={taRef}
          className="textarea ann-note-area"
          rows={2}
          placeholder="Votre voix : reformuler, questionner, objecter…"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          onBlur={flush}
          onKeyDown={(e) => e.key === 'Escape' && flush()}
        />
        <div className="ann-kinds" role="radiogroup" aria-label="Type de note">
          <button role="radio" aria-checked={h.noteKind === null} className={`ann-kind ${h.noteKind === null ? 'active' : ''}`} onClick={() => setKind(null)} data-kind="none">
            Aucun
          </button>
          {NOTE_KINDS.map((k) => (
            <button
              key={k.id}
              role="radio"
              aria-checked={h.noteKind === k.id}
              className={`ann-kind ${h.noteKind === k.id ? 'active' : ''}`}
              onClick={() => setKind(k.id)}
              title={k.description}
              data-kind={k.id}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ann-pop-row">
        <label className="ann-pop-label" htmlFor={`pg-${h.id}`}>
          Page
        </label>
        <input
          id={`pg-${h.id}`}
          className="input ann-page-input"
          value={h.printedPage}
          placeholder="ex. 42"
          onChange={(e) => st().updateHighlight(h.id, { printedPage: e.target.value })}
          inputMode="text"
        />
        <span className="muted ann-page-hint truncate">{h.locationLabel}</span>
      </div>

      <div className="ann-pop-section">
        <div className="ann-pop-label">
          <span>Concepts</span>
          {linked.length === 1 && (
            <button className="ann-link" onClick={() => st().navigate({ name: 'concepts', conceptId: linked[0].id })}>
              Voir la fiche <ArrowUpRight size={11} />
            </button>
          )}
        </div>
        <div className="ann-concept-chips">
          {linked.map((c) => (
            <span key={c.id} className="ann-concept-chip" data-concept={c.id}>
              <button
                className="ann-concept-name"
                title="Voir la fiche"
                onClick={() => st().navigate({ name: 'concepts', conceptId: c.id })}
              >
                {c.name}
              </button>
              <button className="ann-concept-x" title="Retirer" onClick={() => st().toggleHighlightConcept(h.id, c.id)}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <div className="ann-concept-field">
          <Plus size={13} />
          <input
            className="ann-concept-input"
            placeholder="Ajouter un concept…"
            value={cq}
            onChange={(e) => {
              setCq(e.target.value);
              setCOpen(true);
            }}
            onFocus={() => setCOpen(true)}
            onBlur={() => setTimeout(() => setCOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocusIdx((i) => Math.min(options.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocusIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const o = options[focusIdx] ?? options[0];
                if (o) pick(o);
              }
            }}
          />
        </div>
        {cOpen && options.length > 0 && (
          <div className="ann-suggest" role="listbox">
            {options.map((o, i) => (
              <button
                key={o.kind === 'existing' ? o.id : 'create'}
                role="option"
                aria-selected={i === focusIdx}
                className={`ann-suggest-item ${i === focusIdx ? 'focused' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setFocusIdx(i)}
                onClick={() => pick(o)}
                data-create={o.kind === 'create' ? '1' : undefined}
              >
                {o.kind === 'create' ? (
                  <>
                    <Plus size={12} /> Créer « {o.name} »
                  </>
                ) : (
                  o.name
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ann-pop-actions">
        <button className="btn btn-sm" onClick={() => st().addHighlightToMap(h.id)}>
          <Waypoints size={13} /> Ajouter à la carte
        </button>
        <button className="btn btn-sm" onClick={copy}>
          <Copy size={13} /> Copier la citation
        </button>
        <button className="btn btn-sm" onClick={makeCard}>
          <Layers size={13} /> Créer une carte de révision
        </button>
        <button className="btn btn-sm btn-danger ann-pop-del" onClick={del}>
          <Trash2 size={13} /> Supprimer
        </button>
      </div>
    </>
  );
}
