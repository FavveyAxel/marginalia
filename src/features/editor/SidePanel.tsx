// Panneau droit de l'éditeur à contenus multiples (vue partagée) : Livre, Extraits, Concepts, Plan.
// Redimensionnable par une poignée (largeur mémorisée), 50/50 d'un clic. Le contenu et le livre
// choisis sont restaurés à la réouverture (préférence locale).
//
// Rendus : le panneau est mémoïsé et ne reçoit que des rappels stables ; son état (contenu, largeur,
// livre) vit ici, pas dans l'éditeur. Le lecteur n'est chargé qu'à la première ouverture du
// contenu « Livre » (React.lazy).
import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChevronRight, Columns2, CornerDownLeft, Search, X } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { Book, Highlight, PlanItemRef } from '../../lib/types';
import { CategoryDot, PageSkeleton } from '../../components/ui';
import { ExtractsPane } from './ExtractsPane';
import { flatten } from '../plans/planTree';
import { locatorOf } from '../../lib/citation';
import './side-panel.css';

const BookPane = lazy(() => import('./BookPane'));

export type SideContent = 'book' | 'extracts' | 'concepts' | 'plan';
const CONTENTS: { id: SideContent; label: string }[] = [
  { id: 'book', label: 'Livre' },
  { id: 'extracts', label: 'Extraits' },
  { id: 'concepts', label: 'Concepts' },
  { id: 'plan', label: 'Plan' },
];

interface SidePrefs {
  content: SideContent;
  bookId: string | null;
  width: number;
  half: boolean;
}
const PREFS_KEY = 'marginalia.ed.side';
const DEFAULT_PREFS: SidePrefs = { content: 'extracts', bookId: null, width: 360, half: false };
export const SIDE_MIN = 300;
/** Largeur minimale laissée à l'écrit. */
const EDITOR_MIN = 420;

function readPrefs(): SidePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<SidePrefs>;
    return {
      content: CONTENTS.some((c) => c.id === p.content) ? (p.content as SideContent) : DEFAULT_PREFS.content,
      bookId: typeof p.bookId === 'string' ? p.bookId : null,
      width: typeof p.width === 'number' && Number.isFinite(p.width) ? Math.max(SIDE_MIN, p.width) : DEFAULT_PREFS.width,
      half: !!p.half,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}
function writePrefs(p: SidePrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* indisponible */
  }
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export interface SidePanelProps {
  disabled: boolean;
  draftId: string;
  onClose(): void;
  /** Cite un extrait au curseur de l'écrit (citation + note, lien `_mglHl_`). */
  onInsertExtract(h: Highlight, b: Book): boolean;
  /** « Citer dans l'écrit » depuis le livre : comme onInsertExtract, puis retour dans l'écrit. */
  onCite(h: Highlight, b: Book): boolean;
  /** Insère du texte brut au curseur. */
  onInsertText(text: string): void;
}

export const SidePanel = memo(function SidePanel({ disabled, draftId, onClose, onInsertExtract, onCite, onInsertText }: SidePanelProps) {
  const [prefs, setPrefsState] = useState<SidePrefs>(readPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const setPrefs = useCallback((patch: Partial<SidePrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    writePrefs(next);
    setPrefsState(next);
  }, []);
  const asideRef = useRef<HTMLElement>(null);
  const [resizing, setResizing] = useState(false);

  // Le contenu « Livre » est démonté quand un autre contenu est affiché : rien ne tourne pendant la
  // frappe, et la position du livre, enregistrée à la fermeture, est restaurée au retour.
  const insertExtract = useCallback((h: Highlight, b: Book) => void onInsertExtract(h, b), [onInsertExtract]);

  /** Largeur bornée : au moins SIDE_MIN, et l'écrit garde EDITOR_MIN. */
  const clampWidth = useCallback((w: number) => {
    const body = asideRef.current?.parentElement;
    const max = body ? Math.max(SIDE_MIN, body.clientWidth - EDITOR_MIN) : 900;
    return Math.round(Math.max(SIDE_MIN, Math.min(max, w)));
  }, []);

  // ── Poignée de redimensionnement ──
  const onGripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const aside = asideRef.current;
    if (!aside) return;
    e.preventDefault();
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = aside.getBoundingClientRect().width;
    let w = startW;
    setResizing(true);
    const move = (ev: PointerEvent) => {
      w = clampWidth(startW + (startX - ev.clientX));
      aside.style.width = `${w}px`; // directement : aucun rendu React pendant le glissé
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      setResizing(false);
      setPrefs({ width: w, half: false });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  };
  const onGripKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = asideRef.current?.getBoundingClientRect().width ?? prefs.width;
    setPrefs({ width: clampWidth(cur + (e.key === 'ArrowLeft' ? 32 : -32)), half: false });
  };

  // Fenêtre rétrécie : la largeur mémorisée reste bornée.
  const [, setTick] = useState(0);
  useEffect(() => {
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const width = prefs.half ? undefined : clampWidth(prefs.width);
  const content = prefs.content;

  return (
    <aside
      ref={asideRef}
      className={`ed-side panel anim-slide ${prefs.half ? 'is-half' : ''} ${resizing ? 'is-resizing' : ''}`}
      style={width ? { width } : undefined}
      aria-label="Panneau latéral"
      data-content={content}
    >
      <div
        className="ed-side-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionner le panneau"
        tabIndex={0}
        onPointerDown={onGripDown}
        onKeyDown={onGripKey}
        onDoubleClick={() => setPrefs({ half: !prefs.half })}
        title="Glisser pour redimensionner · double-clic : 50/50"
      />
      <div className="ed-side-head">
        <div className="segmented ed-side-tabs" role="tablist" aria-label="Contenu du panneau">
          {CONTENTS.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={content === c.id}
              className={content === c.id ? 'active' : ''}
              onClick={() => setPrefs({ content: c.id })}
              data-side={c.id}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button
          className={`icon-btn sm ${prefs.half ? 'active' : ''}`}
          onClick={() => setPrefs({ half: !prefs.half })}
          title={prefs.half ? 'Revenir à la largeur choisie' : 'Partager l’écran à 50/50'}
          aria-label="Partager l’écran à 50/50"
          aria-pressed={prefs.half}
        >
          <Columns2 size={15} />
        </button>
        <button className="icon-btn sm" onClick={onClose} aria-label="Fermer le panneau" title="Fermer le panneau">
          <X size={15} />
        </button>
      </div>
      <div className="ed-side-body">
        {content === 'book' && (
          <Suspense fallback={<PageSkeleton />}>
            <BookPane bookId={prefs.bookId} onPickBook={(id) => setPrefs({ bookId: id })} onCite={onCite} />
          </Suspense>
        )}
        {content === 'extracts' && <ExtractsPane embedded disabled={disabled} onInsert={insertExtract} onClose={onClose} />}
        {content === 'concepts' && <ConceptsContent disabled={disabled} onInsertExtract={insertExtract} onInsertText={onInsertText} />}
        {content === 'plan' && <PlanContent draftId={draftId} disabled={disabled} onInsertExtract={insertExtract} onInsertText={onInsertText} />}
      </div>
    </aside>
  );
});

// ── Concepts ────────────────────────────────────────────────────

function ConceptsContent({
  disabled,
  onInsertExtract,
  onInsertText,
}: {
  disabled: boolean;
  onInsertExtract(h: Highlight, b: Book): void;
  onInsertText(text: string): void;
}) {
  const concepts = useStore(useShallow((s) => s.concepts));
  const highlights = useStore(useShallow((s) => s.highlights));
  const books = useStore(useShallow((s) => s.books));
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const byBook = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const list = useMemo(() => {
    const nq = norm(q.trim());
    return [...concepts]
      .filter((c) => !nq || norm(`${c.name} ${c.definition} ${c.senses.map((s) => `${s.author} ${s.definition}`).join(' ')}`).includes(nq))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [concepts, q]);

  return (
    <div className="ed-side-list-wrap">
      <div className="ed-extracts-filters">
        <label className="ed-search">
          <Search size={14} />
          <input className="input" placeholder="Rechercher un concept" aria-label="Rechercher un concept" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="ed-extracts-list">
        {list.length === 0 ? (
          <div className="ed-extracts-empty">
            <strong>{concepts.length ? 'Aucun résultat' : 'Pas encore de concepts'}</strong>
            <span>{concepts.length ? 'Essayez un autre mot.' : 'Créez vos concepts dans la vue Concepts : leurs définitions seront à portée de main ici.'}</span>
          </div>
        ) : (
          list.map((c) => {
            const isOpen = open === c.id;
            const hls = isOpen ? highlights.filter((h) => h.conceptIds.includes(c.id) && byBook.has(h.bookId)) : [];
            const def = c.definition.trim();
            return (
              <div key={c.id} className={`ed-cpt ${isOpen ? 'is-open' : ''}`} data-concept={c.id}>
                <button className="ed-cpt-head" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}>
                  <ChevronRight size={13} className="ed-cpt-chev" />
                  <span className="ed-cpt-name">{c.name}</span>
                  {c.programme && <span className="ed-cpt-tag">{c.programme === 'notion' ? 'Notion' : 'Repère'}</span>}
                </button>
                {def && <p className={`ed-cpt-def ${isOpen ? '' : 'clamp'}`}>{def}</p>}
                {isOpen && (
                  <div className="ed-cpt-more">
                    {def && (
                      <button className="btn btn-sm ed-xt-insert" disabled={disabled} onClick={() => onInsertText(`${c.name} : ${def}`)}>
                        <CornerDownLeft size={13} /> Insérer la définition
                      </button>
                    )}
                    {c.senses.filter((s) => s.definition.trim()).map((s) => (
                      <div key={s.id} className="ed-cpt-sense">
                        <p>
                          <strong>{s.author || 'Sens'}</strong> — {s.definition.trim()}
                        </p>
                        <button
                          className="icon-btn sm"
                          disabled={disabled}
                          title="Insérer ce sens"
                          aria-label="Insérer ce sens"
                          onClick={() => onInsertText(`${c.name} (${s.author || 'sens'}) : ${s.definition.trim()}`)}
                        >
                          <CornerDownLeft size={13} />
                        </button>
                      </div>
                    ))}
                    {hls.map((h) => {
                      const b = byBook.get(h.bookId)!;
                      const loc = locatorOf(h);
                      return (
                        <div key={h.id} className="ed-xt" data-hl={h.id}>
                          <p className="ed-xt-text">{h.text.replace(/\s+/g, ' ').trim()}</p>
                          <div className="ed-xt-foot">
                            <div className="ed-xt-meta">
                              {h.category && <CategoryDot id={h.category} size={7} />}
                              <span className="truncate">
                                {b.title}
                                {loc ? ` · ${loc}` : ''}
                              </span>
                            </div>
                            <button className="btn btn-sm ed-xt-insert" disabled={disabled} onClick={() => onInsertExtract(h, b)}>
                              <CornerDownLeft size={13} /> Insérer
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {!def && !c.senses.length && !hls.length && <p className="ed-cpt-none">Aucune définition ni extrait rattaché.</p>}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Plan de dissertation ───────────────────────────────────────

function PlanContent({
  draftId,
  disabled,
  onInsertExtract,
  onInsertText,
}: {
  draftId: string;
  disabled: boolean;
  onInsertExtract(h: Highlight, b: Book): void;
  onInsertText(text: string): void;
}) {
  const plans = useStore(useShallow((s) => s.plans));
  const highlights = useStore(useShallow((s) => s.highlights));
  const books = useStore(useShallow((s) => s.books));
  const concepts = useStore(useShallow((s) => s.concepts));
  const sorted = useMemo(() => [...plans].sort((a, b) => b.updatedAt - a.updatedAt), [plans]);
  // Par défaut : le plan dont cet écrit est issu, sinon le plus récent.
  const [planId, setPlanId] = useState<string>(() => (plans.find((p) => p.draftId === draftId) ?? sorted[0])?.id ?? '');
  const plan = plans.find((p) => p.id === planId) ?? sorted[0] ?? null;
  const flat = useMemo(() => (plan ? flatten(plan.parts) : []), [plan]);
  const hlById = useMemo(() => new Map(highlights.map((h) => [h.id, h])), [highlights]);
  const bookById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  if (!plan) {
    return (
      <div className="ed-extracts-empty">
        <strong>Pas encore de plan</strong>
        <span>Construisez un plan de dissertation dans la vue Plans : il s’affichera ici pendant que vous rédigez.</span>
      </div>
    );
  }

  const item = (ref: PlanItemRef, key: string) => {
    if (ref.kind === 'highlight') {
      const h = hlById.get(ref.id);
      const b = h && bookById.get(h.bookId);
      if (!h || !b) return null;
      return (
        <div key={key} className="ed-plan-item ed-xt" data-hl={h.id}>
          <p className="ed-xt-text">{h.text.replace(/\s+/g, ' ').trim()}</p>
          <div className="ed-xt-foot">
            <div className="ed-xt-meta">
              {h.category && <CategoryDot id={h.category} size={7} />}
              <span className="truncate">{b.title}</span>
            </div>
            <button className="btn btn-sm ed-xt-insert" disabled={disabled} onClick={() => onInsertExtract(h, b)}>
              <CornerDownLeft size={13} /> Insérer
            </button>
          </div>
        </div>
      );
    }
    const text = ref.kind === 'text' ? ref.text : ref.kind === 'concept' ? concepts.find((c) => c.id === ref.id)?.name : null;
    if (!text) return null;
    return (
      <div key={key} className="ed-plan-item ed-plan-note">
        <span>{text}</span>
        <button className="icon-btn sm" disabled={disabled} title="Insérer" aria-label="Insérer" onClick={() => onInsertText(text)}>
          <CornerDownLeft size={13} />
        </button>
      </div>
    );
  };

  return (
    <div className="ed-side-list-wrap">
      {sorted.length > 1 && (
        <div className="ed-extracts-filters">
          <select className="input ed-select" value={plan.id} onChange={(e) => setPlanId(e.target.value)} aria-label="Choisir un plan">
            {sorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title || p.sujet || 'Plan sans titre'}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="ed-extracts-list ed-plan">
        <h3 className="ed-plan-title">{plan.title || 'Plan sans titre'}</h3>
        {plan.sujet && <p className="ed-plan-sujet">{plan.sujet}</p>}
        {plan.problematique.trim() && (
          <div className="ed-plan-block">
            <div className="ed-plan-label">Problématique</div>
            <p>{plan.problematique}</p>
          </div>
        )}
        {flat.map(({ node, depth, label }) => (
          <div key={node.id} className={`ed-plan-node d${depth}`}>
            <div className="ed-plan-node-head">
              <span className="ed-plan-num">{label}</span>
              <span className="ed-plan-node-title">{node.title || 'Sans titre'}</span>
              {node.title && (
                <button className="icon-btn sm" disabled={disabled} title="Insérer le titre" aria-label="Insérer le titre" onClick={() => onInsertText(node.title)}>
                  <CornerDownLeft size={13} />
                </button>
              )}
            </div>
            {node.note.trim() && <p className="ed-plan-note-text">{node.note}</p>}
            {node.items.map((it) => item(it.ref, it.id))}
          </div>
        ))}
        {plan.conclusion.trim() && (
          <div className="ed-plan-block">
            <div className="ed-plan-label">Conclusion</div>
            <p>{plan.conclusion}</p>
          </div>
        )}
      </div>
    </div>
  );
}
