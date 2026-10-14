// Reconstruction d'arguments en forme standard (B1) : P1, P2… puis « Donc, C : ».
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowDown, ArrowUp, Check, Copy, Quote, Plus, Search, Sigma, Trash2, X, ExternalLink } from 'lucide-react';
import { uid, useStore } from '../../lib/store';
import { CATEGORY_BY_ID, catColor } from '../../lib/categories';
import { formatFootnote, locatorOf } from '../../lib/citation';
import type { ArgumentReconstruction, ArgumentStep, Book, Highlight } from '../../lib/types';
import './arguments.css';

const blankStep = (): ArgumentStep => ({ id: uid(), text: '', highlightId: null, implicit: false });

function AutoTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
  className,
  taRef,
  ariaLabel,
}: {
  value: string;
  onChange(v: string): void;
  onKeyDown?(e: React.KeyboardEvent<HTMLTextAreaElement>): void;
  placeholder?: string;
  className?: string;
  taRef?(el: HTMLTextAreaElement | null): void;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        taRef?.(el);
      }}
      rows={1}
      className={className}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

// ── Sélecteur d'extraits ─────────────────────────────────────
function ExtractPicker({ highlights, onPick, onClose }: { highlights: Highlight[]; onPick(h: Highlight): void; onClose(): void }) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const list = highlights.filter((h) => !q.trim() || h.text.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="floating arg-picker anim-scale" ref={ref} data-testid="arg-picker">
      <div className="arg-picker-search">
        <Search size={13} />
        <input autoFocus placeholder="Chercher dans les extraits" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="arg-picker-list">
        {list.map((h) => (
          <button key={h.id} className="arg-picker-item" data-hl={h.id} style={{ '--c': h.category ? catColor(h.category) : 'var(--muted)' } as CSSProperties} onClick={() => onPick(h)}>
            <span className="cat">{h.category ? CATEGORY_BY_ID[h.category].label : 'Note'}</span>
            <span className="txt">{h.text.replace(/\s+/g, ' ').trim()}</span>
            <span className="loc">{locatorOf(h)}</span>
          </button>
        ))}
        {list.length === 0 && (
          <p className="arg-picker-none">{highlights.length ? 'Aucun extrait ne correspond.' : 'Aucun extrait disponible. Choisissez un livre source, ou surlignez des passages dans la lecture.'}</p>
        )}
      </div>
    </div>
  );
}

// ── Ligne de prémisse ou conclusion ──────────────────────────
function StepRow({
  step,
  label,
  conclusion,
  index,
  count,
  hl,
  highlights,
  onChange,
  onMove,
  onRemove,
  onEnter,
  registerRef,
}: {
  step: ArgumentStep;
  label: string;
  conclusion?: boolean;
  index?: number;
  count?: number;
  hl: Highlight | null;
  highlights: Highlight[];
  onChange(patch: Partial<ArgumentStep>): void;
  onMove?(dir: -1 | 1): void;
  onRemove?(): void;
  onEnter?(): void;
  registerRef?(el: HTMLTextAreaElement | null): void;
}) {
  const [picking, setPicking] = useState(false);
  const jump = useStore((s) => s.jumpToHighlight);
  const closePicker = useCallback(() => setPicking(false), []);
  return (
    <div className={`arg-step ${step.implicit ? 'implicit' : ''} ${conclusion ? 'conclusion' : ''}`} data-step={conclusion ? 'C' : label} style={{ '--i': index ?? 0 } as CSSProperties}>
      <div className="arg-step-label">{label}</div>
      <div className="arg-step-body">
        <AutoTextarea
          className="arg-step-text"
          value={step.text}
          taRef={registerRef}
          ariaLabel={conclusion ? 'Conclusion' : `Prémisse ${label}`}
          placeholder={conclusion ? 'Ce qui découle des prémisses' : step.implicit ? 'Ce que l’auteur suppose sans le dire' : 'Une affirmation, dans vos mots ou ceux du texte'}
          onChange={(text) => onChange({ text })}
          onKeyDown={
            onEnter
              ? (e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    onEnter();
                  }
                }
              : undefined
          }
        />
        <div className="arg-step-meta">
          {!conclusion && (
            <label className="arg-implicit">
              <input type="checkbox" checked={step.implicit} onChange={(e) => onChange({ implicit: e.target.checked })} />
              <span>implicite</span>
            </label>
          )}
          {hl ? (
            <span className="arg-src" style={{ '--c': hl.category ? catColor(hl.category) : 'var(--muted)' } as CSSProperties}>
              <i />
              <button className="arg-src-main" title="Ouvrir l’extrait dans le livre" onClick={() => jump(hl.id)}>
                {hl.category ? CATEGORY_BY_ID[hl.category].label : 'Note'}, {locatorOf(hl)}
                <ExternalLink size={11} />
              </button>
              <button className="arg-src-x" title="Détacher l’extrait" aria-label="Détacher l’extrait" onClick={() => onChange({ highlightId: null })}>
                <X size={11} />
              </button>
            </span>
          ) : (
            <span className="arg-pick-wrap">
              <button className="btn btn-ghost btn-sm arg-pick" data-act="pick" onClick={() => setPicking((v) => !v)}>
                <Quote size={13} /> Depuis un extrait
              </button>
              {picking && (
                <ExtractPicker
                  highlights={highlights}
                  onClose={closePicker}
                  onPick={(h) => {
                    onChange({ text: h.text.replace(/\s+/g, ' ').trim(), highlightId: h.id, implicit: false });
                    setPicking(false);
                  }}
                />
              )}
            </span>
          )}
        </div>
      </div>
      {!conclusion && (
        <div className="arg-step-tools">
          <button className="icon-btn sm" title="Monter" aria-label="Monter" disabled={index === 0} onClick={() => onMove?.(-1)}>
            <ArrowUp size={13} />
          </button>
          <button className="icon-btn sm" title="Descendre" aria-label="Descendre" disabled={index === (count ?? 1) - 1} onClick={() => onMove?.(1)}>
            <ArrowDown size={13} />
          </button>
          <button className="icon-btn sm" title="Supprimer la prémisse" aria-label="Supprimer la prémisse" data-act="remove-premise" onClick={onRemove}>
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Texte « forme standard » ─────────────────────────────────
function standardText(a: ArgumentReconstruction, hlById: Map<string, Highlight>, books: Map<string, Book>): string {
  const ref = (s: ArgumentStep) => {
    const h = s.highlightId ? hlById.get(s.highlightId) : null;
    const b = h ? books.get(h.bookId) : null;
    return h && b ? ` (${formatFootnote(h, b, 'plain').replace(/\.$/, '')})` : '';
  };
  const lines = a.premises.map((p, i) => `P${i + 1}. ${p.implicit ? '[implicite] ' : ''}${p.text.trim() || '…'}${ref(p)}`);
  const c = `C. ${a.conclusion.text.trim() || '…'}${ref(a.conclusion)}`;
  return `${a.title.trim() ? a.title.trim() + '\n\n' : ''}${lines.join('\n')}\n―――\n${c}`;
}

// ── Éditeur ──────────────────────────────────────────────────
function Editor({ arg, books, highlights }: { arg: ArgumentReconstruction; books: Book[]; highlights: Highlight[] }) {
  const patch = useStore((s) => s.patch);
  const remove = useStore((s) => s.remove);
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const focusNext = useRef<string | null>(null);

  const hlById = useMemo(() => new Map(highlights.map((h) => [h.id, h])), [highlights]);
  const bookMap = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const pool = useMemo(() => (arg.bookId ? highlights.filter((h) => h.bookId === arg.bookId) : highlights), [highlights, arg.bookId]);

  const titleRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    setConfirm(false);
    setCopied(false);
    // Argument tout neuf : le curseur va dans le titre.
    if (!arg.title && !arg.comment && arg.premises.every((p) => !p.text)) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arg.id]);
  useEffect(() => {
    const id = focusNext.current;
    if (id && refs.current[id]) {
      refs.current[id]!.focus();
      focusNext.current = null;
    }
  });

  const set = (p: Partial<ArgumentReconstruction>) => patch('arguments', arg.id, p);
  const setPremise = (id: string, p: Partial<ArgumentStep>) => set({ premises: arg.premises.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const addPremiseAfter = (index: number) => {
    const nxt = arg.premises[index + 1];
    if (nxt && !nxt.text.trim()) {
      refs.current[nxt.id]?.focus();
      return;
    }
    const s = blankStep();
    focusNext.current = s.id;
    const next = [...arg.premises];
    next.splice(index + 1, 0, s);
    set({ premises: next });
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= arg.premises.length) return;
    const next = [...arg.premises];
    [next[i], next[j]] = [next[j], next[i]];
    set({ premises: next });
  };
  const text = standardText(arg, hlById, bookMap);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast('Forme standard copiée', 'success');
    } catch {
      toast('Copie impossible : sélectionnez le texte de l’aperçu', 'error');
    }
  };

  return (
    <div className="arg-editor anim-view" data-testid="arg-editor" key={arg.id}>
      <div className="arg-col">
        <input ref={titleRef} className="arg-title page-title" aria-label="Titre de l’argument" placeholder="Titre de l’argument" value={arg.title} onChange={(e) => set({ title: e.target.value })} />
        <div className="arg-book">
          <label htmlFor="arg-book-sel">Livre source</label>
          <select id="arg-book-sel" className="input" value={arg.bookId ?? ''} onChange={(e) => set({ bookId: e.target.value || null })}>
            <option value="">Aucun livre</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </div>

        <div className="arg-premises">
          {arg.premises.map((p, i) => (
            <StepRow
              key={p.id}
              step={p}
              label={`P${i + 1}`}
              index={i}
              count={arg.premises.length}
              hl={p.highlightId ? (hlById.get(p.highlightId) ?? null) : null}
              highlights={pool}
              registerRef={(el) => (refs.current[p.id] = el)}
              onChange={(pp) => setPremise(p.id, pp)}
              onMove={(d) => move(i, d)}
              onRemove={() => set({ premises: arg.premises.filter((x) => x.id !== p.id) })}
              onEnter={() => addPremiseAfter(i)}
            />
          ))}
        </div>
        <button className="btn btn-ghost btn-sm arg-add" data-act="add-premise" onClick={() => addPremiseAfter(arg.premises.length - 1)}>
          <Plus size={14} /> Ajouter une prémisse
        </button>

        <div className="arg-rule" aria-hidden />
        <div className="arg-donc">Donc, C :</div>
        <StepRow
          step={arg.conclusion}
          label="C"
          conclusion
          hl={arg.conclusion.highlightId ? (hlById.get(arg.conclusion.highlightId) ?? null) : null}
          highlights={pool}
          onChange={(p) => set({ conclusion: { ...arg.conclusion, ...p } })}
        />

        <h4 className="arg-h">Commentaire</h4>
        <AutoTextarea
          className="textarea arg-comment"
          value={arg.comment}
          ariaLabel="Commentaire"
          placeholder="Le raisonnement est-il valide ? Quelle prémisse est contestable ? Quelle objection lui opposer ?"
          onChange={(comment) => set({ comment })}
        />

        <section className="arg-preview" data-testid="arg-preview">
          <header>
            <h4 className="arg-h">Forme standard</h4>
            <button className="btn btn-sm" data-act="copy" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copié' : 'Copier'}
            </button>
          </header>
          <pre>{text}</pre>
        </section>

        <div className="arg-danger">
          {confirm ? (
            <div className="arg-confirm anim-in" role="alertdialog" aria-label="Confirmer la suppression">
              <span>Supprimer « {arg.title.trim() || 'Argument sans titre'} » ? Cette action est définitive.</span>
              <button className="btn btn-sm" onClick={() => setConfirm(false)}>
                Garder
              </button>
              <button
                className="btn btn-sm btn-danger"
                data-act="confirm-delete"
                onClick={() => {
                  remove('arguments', arg.id);
                  navigate({ name: 'arguments', argumentId: null });
                }}
              >
                Supprimer l’argument
              </button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" data-act="delete" onClick={() => setConfirm(true)}>
              <Trash2 size={14} /> Supprimer l’argument
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Vue ──────────────────────────────────────────────────────
export function ArgumentsView({ argumentId }: { argumentId: string | null }) {
  const ready = useStore((s) => s.ready);
  const args = useStore((s) => s.arguments);
  const books = useStore(useShallow((s) => s.books));
  const highlights = useStore((s) => s.highlights);
  const insert = useStore((s) => s.insert);
  const navigate = useStore((s) => s.navigate);
  const [q, setQ] = useState('');
  const [bookFilter, setBookFilter] = useState('');

  const bookTitle = (id: string | null) => books.find((b) => b.id === id)?.title ?? '';
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return [...args]
      .filter((a) => (bookFilter ? a.bookId === bookFilter : true))
      .filter((a) => !n || `${a.title} ${a.premises.map((p) => p.text).join(' ')} ${a.conclusion.text}`.toLowerCase().includes(n))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [args, q, bookFilter]);

  const current = args.find((a) => a.id === argumentId) ?? null;

  const create = () => {
    const now = Date.now();
    const a: ArgumentReconstruction = {
      id: uid(),
      title: '',
      bookId: bookFilter || (current?.bookId ?? null),
      premises: [blankStep(), blankStep()],
      conclusion: blankStep(),
      comment: '',
      createdAt: now,
      updatedAt: now,
    };
    insert('arguments', a);
    navigate({ name: 'arguments', argumentId: a.id });
    setQ('');
  };

  return (
    <>
      <header className="topbar">
        <span className="spacer" />
        {args.length > 0 && (
          <button className="btn btn-primary" data-act="new-arg" onClick={create}>
            <Plus size={14} /> Nouvel argument
          </button>
        )}
      </header>
      <div className="arg-layout">
        <aside className="panel arg-list" data-testid="arg-list">
          <div className="arg-list-head">
            <h1 className="arg-list-title">Arguments</h1>
            <div className="arg-search">
              <Search size={13} />
              <input placeholder="Chercher" aria-label="Chercher un argument" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {books.length > 0 && (
              <select className="input arg-filter" aria-label="Filtrer par livre" value={bookFilter} onChange={(e) => setBookFilter(e.target.value)}>
                <option value="">Tous les livres</option>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="arg-list-body anim-stagger">
            {!ready && (
              <div className="skeleton" style={{ height: 52 }} />
            )}
            {list.map((a, i) => (
              <button key={a.id} data-arg={a.id} className={`arg-item ${a.id === argumentId ? 'active' : ''}`} style={{ '--i': i } as CSSProperties} onClick={() => navigate({ name: 'arguments', argumentId: a.id })}>
                <span className="t">{a.title.trim() || 'Argument sans titre'}</span>
                <span className="s">
                  {a.premises.length} prémisse{a.premises.length > 1 ? 's' : ''}
                  {a.bookId && bookTitle(a.bookId) ? `, ${bookTitle(a.bookId)}` : ''}
                </span>
              </button>
            ))}
            {ready && args.length === 0 && <p className="arg-list-none">Vos reconstructions apparaîtront ici.</p>}
            {ready && list.length === 0 && args.length > 0 && <p className="arg-list-none">Aucun argument ne correspond à cette recherche.</p>}
          </div>
        </aside>

        <section className="panel arg-stage">
          {current ? (
            <Editor arg={current} books={books} highlights={highlights} />
          ) : (
            <div className="arg-blank anim-in" data-testid="arg-empty">
              <div className="empty anim-fade">
                <Sigma size={26} />
                <h3>{args.length ? 'Choisissez un argument' : 'Reconstruire un argument'}</h3>
                <p>
                  {args.length
                    ? 'Sélectionnez-en un dans la liste, ou commencez-en un nouveau.'
                    : 'Écrivez ses prémisses une à une, puis ce qu’elles établissent. Vous verrez vite quelle prémisse porte tout le poids, et laquelle l’auteur n’a pas dite.'}
                </p>
                <button className="btn btn-primary" data-act="new-arg" onClick={create}>
                  <Plus size={14} /> Nouvel argument
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
