// Commentaires en marge de l'éditeur : bulles alignées sur les passages commentés.
//
// Les commentaires sont de vrais commentaires Word (w:comments) gérés par le moteur (engine.ts :
// listComments, addComment…) : ils sont enregistrés dans le .docx, rouverts tels quels, et
// s'ouvrent dans Word. L'interface native de SuperDoc est coupée (engine.ts : modules.comments).
// Les exports PDF, Markdown, page web et texte partent du modèle de docx.ts, qui ignore les
// commentaires (comme les notes privées).
//
// Placement : chaque bulle vise la ligne de son passage (positions de la mise en page,
// engine.rangeRects) ; les bulles proches s'empilent sans se chevaucher, la bulle active restant
// alignée sur son passage (les autres s'écartent au-dessus et au-dessous).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type RefObject } from 'react';
import { Check, Ellipsis, MessageSquare, MessageSquarePlus, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { CommentSnapshot, DocComment, DocEngine } from './engine';
import { Popover, usePop } from './Popover';
import { fmtKeys, matchKeys } from '../../lib/keys';
import './comments.css';

export const COMMENT_KEY = fmtKeys('⌘⌥M');
const SHOWN_KEY = 'marginalia.ed.commentsShown';
const RESOLVED_KEY = 'marginalia.ed.commentsResolved';
const PENDING = '__pending';
/** Écart entre deux bulles empilées, entre la page et la colonne. */
const GAP = 10;
const COL_GAP = 22;
/** Largeur de la colonne : bornes (la page garde au moins ~75 % de zoom à côté). */
const COL_MIN = 212;
const COL_MAX = 276;
const PAGE_ROOM = 640;

const readFlag = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};
const writeFlag = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    /* indisponible */
  }
};

// ── Dates relatives ──────────────────────────────────────────
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export function relativeDate(t: number | null, now = Date.now()): string {
  if (!t) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 50) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.max(1, Math.round(s / 60))} min`;
  const d = new Date(t);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86400000);
  const hm = `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
  if (days === 0) return s < 4 * 3600 ? `il y a ${Math.round(s / 3600)} h` : `aujourd’hui, ${hm}`;
  if (days === 1) return `hier, ${hm}`;
  const md = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === today.getFullYear() ? md : `${md} ${d.getFullYear()}`;
}
const fullDate = (t: number | null) => (t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : '');

/** Pastille de l'auteur : « Vous » prend la couleur des commentaires, les autres une couleur stable. */
const AUTHOR_HUES = ['var(--cat-concept)', 'var(--cat-exemple)', 'var(--cat-argument)', 'var(--cat-objection)', 'var(--cat-these)'];
function authorColor(c: DocComment): string {
  if (c.mine) return 'var(--cm-accent)';
  let h = 0;
  for (const ch of c.author) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AUTHOR_HUES[h % AUTHOR_HUES.length];
}
const authorName = (c: DocComment) => (c.mine ? 'Vous' : c.author);

// ── Fils ─────────────────────────────────────────────────────
export interface Thread {
  id: string;
  root: DocComment;
  replies: DocComment[];
}
function threadsOf(list: DocComment[]): Thread[] {
  const map = new Map<string, Thread>();
  const out: Thread[] = [];
  for (const c of list) {
    if (c.parentId) continue;
    const t = { id: c.id, root: c, replies: [] as DocComment[] };
    map.set(c.id, t);
    out.push(t);
  }
  for (const c of list) if (c.parentId) map.get(c.parentId)?.replies.push(c);
  for (const t of out) t.replies.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return out;
}

/**
 * Empilement sans chevauchement. `want` : haut visé de chaque bulle (ordre du document),
 * `h` : hauteurs. La bulle `pin` (active) garde sa place ; les précédentes remontent, les
 * suivantes descendent. Aucune ne passe au-dessus de `min`.
 */
export function placeBubbles(want: number[], h: number[], pin: number, min: number, gap = GAP): number[] {
  const n = want.length;
  const top = want.map((w) => Math.max(min, w));
  if (!n) return top;
  if (pin < 0 || pin >= n) {
    for (let i = 1; i < n; i++) top[i] = Math.max(top[i], top[i - 1] + h[i - 1] + gap);
    return top;
  }
  for (let i = pin + 1; i < n; i++) top[i] = Math.max(top[i], top[i - 1] + h[i - 1] + gap);
  for (let i = pin - 1; i >= 0; i--) top[i] = Math.min(top[i], top[i + 1] - h[i] - gap);
  // trop haut : tout redescend depuis le début (la bulle active cède alors un peu)
  if (top[0] < min) {
    top[0] = min;
    for (let i = 1; i < n; i++) top[i] = Math.max(top[i], top[i - 1] + h[i - 1] + gap);
  }
  return top;
}

type Notify = (message: string, tone?: 'info' | 'error' | 'success', action?: { label: string; run: () => void }) => void;

interface Pending {
  from: number;
  to: number;
  quote: string;
}

interface Geo {
  /** Bord gauche de la colonne (coordonnées du contenu défilant). */
  left: number;
  pageTop: number;
  pageRight: number;
  contentW: number;
  contentH: number;
  /** Par fil : haut de la première ligne, extrémité de cette ligne, rectangles (passages sans surlignage peint). */
  anchors: Record<string, { y: number; x: number; h: number; rects: { x: number; y: number; w: number; h: number }[] }>;
}

export interface CommentsCtl {
  ready: boolean;
  editable: boolean;
  threads: Thread[];
  visible: Thread[];
  openCount: number;
  resolvedCount: number;
  shown: boolean;
  setShown: (v: boolean) => void;
  showResolved: boolean;
  setShowResolved: (v: boolean) => void;
  /** La colonne est affichée (commentaires visibles ou commentaire en cours). */
  columnOn: boolean;
  colW: number;
  pending: Pending | null;
  activeId: string | null;
  hoverId: string | null;
  setHover: (id: string | null) => void;
  activate: (id: string | null) => void;
  start: () => boolean;
  cancelPending: () => void;
  submitPending: (text: string) => boolean;
  reply: (rootId: string, text: string) => boolean;
  edit: (id: string, text: string) => boolean;
  resolve: (rootId: string, resolved: boolean) => void;
  remove: (id: string) => void;
  engine: () => DocEngine | null;
  scrollRef: RefObject<HTMLElement | null>;
  hostRef: RefObject<HTMLElement | null>;
  tick: number;
  now: number;
}

/** La cible du clavier est-elle le texte du document ? */
function inDocument(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && typeof el.closest === 'function' && !!el.closest('.ProseMirror, .ed-engine');
}

/**
 * État des commentaires de l'écrit ouvert. `tick` change après chaque modification ou sélection
 * (EditorScreen) ; `caret` : position du curseur (la bulle du passage qui le contient devient active).
 */
export function useComments(opts: {
  engineRef: MutableRefObject<DocEngine | null>;
  hostRef: RefObject<HTMLElement | null>;
  ready: boolean;
  editable: boolean;
  tick: number;
  caret: number;
  notify: Notify;
}): CommentsCtl {
  const { engineRef, hostRef, ready, editable, tick, caret, notify } = opts;
  const engine = useCallback(() => engineRef.current, [engineRef]);
  const [list, setList] = useState<DocComment[]>([]);
  const sig = useRef('');
  const [shown, setShownState] = useState(() => readFlag(SHOWN_KEY, true));
  const [showResolved, setShowResolvedState] = useState(() => readFlag(RESOLVED_KEY, false));
  const [pending, setPending] = useState<Pending | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeFromCaret = useRef(false);
  const [hoverId, setHover] = useState<string | null>(null);
  const [localTick, setLocalTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLElement | null>(null);
  const [colW, setColW] = useState(COL_MAX);
  const cb = useRef({ notify });
  cb.current = { notify };

  const reload = useCallback(() => {
    const e = engineRef.current;
    const next = e ? e.listComments() : [];
    const s = JSON.stringify(next);
    if (s !== sig.current) {
      sig.current = s;
      setList(next);
    }
    setLocalTick((t) => t + 1);
  }, [engineRef]);

  useEffect(() => {
    if (ready) reload();
  }, [ready, tick, reload]);

  // dates relatives : rafraîchies chaque minute
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    scrollRef.current = (hostRef.current?.closest('.ed-scroll') as HTMLElement | null) ?? null;
  });

  const threads = useMemo(() => threadsOf(list), [list]);
  const visible = useMemo(() => (shown ? threads.filter((t) => showResolved || !t.root.resolved) : []), [threads, shown, showResolved]);
  const openCount = threads.filter((t) => !t.root.resolved).length;
  const resolvedCount = threads.length - openCount;

  // Curseur dans un passage commenté → sa bulle devient active (et cesse de l'être en sortant).
  useEffect(() => {
    if (!ready) return;
    const hit = threads.find((t) => !t.root.resolved && caret >= t.root.from && caret <= t.root.to);
    if (hit) {
      activeFromCaret.current = true;
      setActiveId((cur) => (cur === hit.id ? cur : hit.id));
    } else if (activeFromCaret.current) {
      activeFromCaret.current = false;
      setActiveId(null);
    }
    // (le fil actif par clic reste actif tant que le curseur ne change pas)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caret, ready]);

  const activate = useCallback((id: string | null) => {
    activeFromCaret.current = false;
    setActiveId(id);
  }, []);

  const setShown = useCallback((v: boolean) => {
    writeFlag(SHOWN_KEY, v);
    setShownState(v);
  }, []);
  const setShowResolved = useCallback((v: boolean) => {
    writeFlag(RESOLVED_KEY, v);
    setShowResolvedState(v);
  }, []);

  const start = useCallback((): boolean => {
    const e = engineRef.current;
    if (!e || !editable) return false;
    const r = e.selectionRange();
    if (!r) {
      cb.current.notify('Sélectionnez le passage à commenter.', 'info');
      return false;
    }
    if (!readFlag(SHOWN_KEY, true)) setShown(true);
    setPending(r);
    activeFromCaret.current = false;
    setActiveId(PENDING);
    return true;
  }, [engineRef, editable, setShown]);

  const cancelPending = useCallback(() => {
    setPending(null);
    setActiveId((a) => (a === PENDING ? null : a));
    engineRef.current?.focus();
  }, [engineRef]);

  const submitPending = useCallback(
    (text: string): boolean => {
      const e = engineRef.current;
      if (!e || !pending || !text.trim()) return false;
      const id = e.addComment(pending, text);
      if (!id) {
        cb.current.notify('Le commentaire n’a pas pu être ajouté. Sélectionnez à nouveau le passage.', 'error');
        return false;
      }
      setPending(null);
      activeFromCaret.current = false;
      setActiveId(id);
      reload();
      // le curseur, posé à la fin du passage, rend la bulle active « par le curseur »
      activeFromCaret.current = true;
      e.focus();
      return true;
    },
    [engineRef, pending, reload],
  );

  const reply = useCallback(
    (rootId: string, text: string) => {
      const e = engineRef.current;
      if (!e || !text.trim()) return false;
      const ok = !!e.replyComment(rootId, text);
      if (!ok) cb.current.notify('La réponse n’a pas pu être ajoutée.', 'error');
      reload();
      return ok;
    },
    [engineRef, reload],
  );

  const edit = useCallback(
    (id: string, text: string) => {
      const e = engineRef.current;
      if (!e || !text.trim()) return false;
      const ok = e.editComment(id, text);
      reload();
      return ok;
    },
    [engineRef, reload],
  );

  const resolve = useCallback(
    (rootId: string, resolved: boolean) => {
      const e = engineRef.current;
      if (!e) return;
      if (!e.setCommentResolved(rootId, resolved)) {
        cb.current.notify('Impossible de modifier ce commentaire.', 'error');
        return;
      }
      if (resolved) {
        activeFromCaret.current = false;
        setActiveId((a) => (a === rootId ? null : a));
        if (!readFlag(RESOLVED_KEY, false)) cb.current.notify('Commentaire résolu : il reste dans le document, masqué.', 'info', { label: 'Afficher', run: () => setShowResolved(true) });
      }
      reload();
    },
    [engineRef, reload, setShowResolved],
  );

  const remove = useCallback(
    (id: string) => {
      const e = engineRef.current;
      if (!e) return;
      const snap: CommentSnapshot | null = e.deleteComment(id);
      if (!snap) {
        cb.current.notify('Impossible de supprimer ce commentaire.', 'error');
        return;
      }
      setActiveId((a) => (a === id ? null : a));
      reload();
      cb.current.notify(snap.reply ? 'Réponse supprimée' : 'Commentaire supprimé', 'info', {
        label: 'Annuler',
        run: () => {
          const x = engineRef.current;
          if (!x || !x.restoreComment(snap)) {
            cb.current.notify('Le passage commenté a changé : le commentaire n’a pas pu être remis.', 'error');
            return;
          }
          reload();
        },
      });
    },
    [engineRef, reload],
  );

  // ⌘⌥M (Windows : Ctrl+Maj+M) : commenter la sélection.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!matchKeys(ev, '⌘⌥M') || !engineRef.current || !inDocument(ev.target)) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      start();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [engineRef, start]);

  // Survol d'un passage commenté → sa bulle est mise en avant.
  useEffect(() => {
    const h = hostRef.current;
    if (!h || !ready) return;
    let last: string | null = null;
    const over = (ev: PointerEvent) => {
      const el = (ev.target as HTMLElement | null)?.closest?.('.superdoc-comment-highlight') as HTMLElement | null;
      const ids = el?.dataset.commentIds?.split(',').filter(Boolean) ?? [];
      const id = ids.length ? ids[ids.length - 1] : null;
      if (id !== last) {
        last = id;
        setHover(id);
      }
    };
    const leave = () => {
      if (last !== null) {
        last = null;
        setHover(null);
      }
    };
    h.addEventListener('pointerover', over);
    h.addEventListener('pointerleave', leave);
    return () => {
      h.removeEventListener('pointerover', over);
      h.removeEventListener('pointerleave', leave);
    };
  }, [hostRef, ready]);

  // Largeur de la colonne selon la place disponible (la page garde ~75 % de zoom).
  useEffect(() => {
    const center = hostRef.current?.closest('.ed-center') as HTMLElement | null;
    if (!center || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const w = center.clientWidth;
      setColW(Math.round(Math.max(COL_MIN, Math.min(COL_MAX, w - PAGE_ROOM - COL_GAP))));
    });
    ro.observe(center);
    return () => ro.disconnect();
  }, [hostRef, ready]);

  // Fil disparu (supprimé, annulé par ⌘Z) : plus actif.
  useEffect(() => {
    if (activeId && activeId !== PENDING && !threads.some((t) => t.id === activeId)) setActiveId(null);
  }, [threads, activeId]);

  const columnOn = ready && shown && (visible.length > 0 || !!pending);

  return {
    ready,
    editable,
    threads,
    visible,
    openCount,
    resolvedCount,
    shown,
    setShown,
    showResolved,
    setShowResolved,
    columnOn,
    colW,
    pending,
    activeId,
    hoverId,
    setHover,
    activate,
    start,
    cancelPending,
    submitPending,
    reply,
    edit,
    resolve,
    remove,
    engine,
    scrollRef,
    hostRef,
    tick: tick + localTick,
    now,
  };
}

// ── Bouton de la barre du haut ───────────────────────────────
export function CommentsButton({ ctl }: { ctl: CommentsCtl }) {
  const n = ctl.openCount;
  const label = ctl.shown ? 'Masquer les commentaires' : 'Afficher les commentaires';
  return (
    <button
      className={`icon-btn ed-cm-toggle ${ctl.shown && ctl.threads.length ? 'active' : ''}`}
      onClick={() => ctl.setShown(!ctl.shown)}
      title={`${label}${n ? ` (${n} ouvert${n > 1 ? 's' : ''})` : ''} — commenter la sélection : ${COMMENT_KEY}`}
      aria-label={label}
      aria-pressed={ctl.shown}
      disabled={!ctl.ready}
      data-tb="comments"
    >
      <MessageSquare size={16} />
      {n > 0 && <span className="ed-cm-count">{n}</span>}
    </button>
  );
}

// ── Bouton de la barre de sélection ──────────────────────────
export function CommentSelButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="ed-tb-text ed-sb-comment" onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={`Commenter le passage (${COMMENT_KEY})`} aria-label="Commenter" data-sb="comment">
      <MessageSquarePlus size={15} />
      Commenter
    </button>
  );
}

// ── Colonne de marge ─────────────────────────────────────────
/** Zone de saisie qui s'agrandit avec le texte. Entrée valide, ⇧Entrée va à la ligne. */
function Composer({
  initial = '',
  placeholder,
  autoFocus,
  submitLabel,
  onSubmit,
  onCancel,
  compact,
  testId,
}: {
  initial?: string;
  placeholder: string;
  autoFocus?: boolean;
  submitLabel: string;
  onSubmit: (text: string) => boolean | void;
  onCancel: (empty: boolean) => void;
  compact?: boolean;
  testId?: string;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(220, el.scrollHeight)}px`;
  }, [text]);
  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    // après le placement de la bulle (pas de saut de défilement vers une bulle encore hors place)
    // Le moteur peut reprendre le focus juste après (fin de la sélection) : nouvelles tentatives
    // tant que le focus est dans le document, jamais s'il est passé dans un autre champ.
    const grab = (first: boolean) => {
      const cur = document.activeElement as HTMLElement | null;
      if (cur === el) return;
      const elsewhere = cur && cur !== document.body && (cur.matches('input, textarea, select') || (!cur.closest('.ed-engine') && !cur.closest('.ed-selbar') && !cur.closest('.cm-col')));
      if (!first && elsewhere) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    };
    const ts = [30, 140, 320, 600].map((ms, i) => setTimeout(() => grab(i === 0), ms));
    return () => ts.forEach(clearTimeout);
  }, [autoFocus]);
  const submit = () => {
    if (!text.trim()) return;
    if (onSubmit(text) !== false && !initial) setText('');
  };
  const empty = !text.trim();
  return (
    <div className={`cm-composer ${compact ? 'compact' : ''} ${empty ? 'is-empty' : ''}`}>
      <textarea
        ref={ref}
        value={text}
        rows={1}
        placeholder={placeholder}
        spellCheck
        data-cm={testId}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel(empty);
          }
        }}
      />
      {(!compact || !empty) && (
        <div className="cm-composer-bar">
          <span className="cm-hint">↩ publier · ⇧↩ ligne</span>
          <button className="btn btn-ghost btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => onCancel(true)}>
            Annuler
          </button>
          <button className="btn btn-primary btn-sm" disabled={empty} onMouseDown={(e) => e.preventDefault()} onClick={submit} data-cm={testId ? `${testId}-submit` : undefined}>
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function Meta({ c, now }: { c: DocComment; now: number }) {
  return (
    <div className="cm-meta">
      <span className={`cm-dot ${c.mine ? 'mine' : ''}`} style={{ '--dot': authorColor(c) } as CSSProperties} aria-hidden />
      <span className="cm-author">{authorName(c)}</span>
      {c.createdAt && (
        <time className="cm-date" dateTime={new Date(c.createdAt).toISOString()} title={fullDate(c.createdAt)}>
          {relativeDate(c.createdAt, now)}
        </time>
      )}
    </div>
  );
}

function Bubble({
  t,
  ctl,
  active,
  hot,
  top,
  placed,
  setRef,
}: {
  t: Thread;
  ctl: CommentsCtl;
  active: boolean;
  hot: boolean;
  top: number;
  placed: boolean;
  setRef: (id: string, el: HTMLElement | null) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const menu = usePop();
  const [menuFor, setMenuFor] = useState<DocComment | null>(null);
  const resolved = t.root.resolved;
  const expanded = active && !resolved;
  const shownReplies = expanded ? t.replies : [];
  const openMenu = (c: DocComment, el: HTMLElement) => {
    setMenuFor(c);
    menu.toggle(el);
  };
  useEffect(() => {
    if (!active) setEditing(null);
  }, [active]);

  const body = (c: DocComment, isRoot: boolean) =>
    editing === c.id ? (
      <Composer
        initial={c.text}
        placeholder="Modifier le commentaire"
        autoFocus
        submitLabel="Enregistrer"
        onSubmit={(txt) => {
          const ok = ctl.edit(c.id, txt);
          if (ok) setEditing(null);
          return ok;
        }}
        onCancel={() => setEditing(null)}
        testId="edit"
      />
    ) : (
      <p className={`cm-text ${isRoot && !expanded ? 'clamp' : ''}`}>{c.text}</p>
    );

  return (
    <article
      ref={(el) => setRef(t.id, el)}
      className={`cm-bubble ${active ? 'active' : ''} ${hot ? 'hot' : ''} ${resolved ? 'resolved' : ''} ${placed ? 'placed' : ''}`}
      style={{ transform: `translateY(${Math.round(top)}px)` }}
      data-cm-id={t.id}
      aria-label={`Commentaire de ${authorName(t.root)}`}
      onPointerEnter={() => ctl.setHover(t.id)}
      onPointerLeave={() => ctl.setHover(null)}
      onMouseDown={(e) => {
        // un clic dans la bulle ne doit pas vider la sélection du document
        if (!(e.target as HTMLElement).closest('textarea, button, input')) e.preventDefault();
      }}
      onClick={() => {
        if (!active) ctl.activate(t.id);
      }}
    >
      <header className="cm-head">
        <Meta c={t.root} now={ctl.now} />
        <div className="cm-actions">
          {ctl.editable &&
            (resolved ? (
              <button className="icon-btn sm" title="Rouvrir" aria-label="Rouvrir le commentaire" onClick={(e) => (e.stopPropagation(), ctl.resolve(t.id, false))} data-cm="reopen">
                <RotateCcw size={13} />
              </button>
            ) : (
              <button className="icon-btn sm cm-resolve" title="Marquer comme résolu" aria-label="Marquer comme résolu" onClick={(e) => (e.stopPropagation(), ctl.resolve(t.id, true))} data-cm="resolve">
                <Check size={14} />
              </button>
            ))}
          {ctl.editable && (
            <button className="icon-btn sm" title="Plus" aria-label="Plus d’actions" onClick={(e) => (e.stopPropagation(), openMenu(t.root, e.currentTarget))} data-cm="menu">
              <Ellipsis size={14} />
            </button>
          )}
        </div>
      </header>
      {resolved ? (
        <p className="cm-text cm-resolved-line">
          <Check size={12} /> <span>Résolu</span> — {t.root.text}
        </p>
      ) : (
        body(t.root, true)
      )}
      {!expanded && !resolved && t.replies.length > 0 && (
        <div className="cm-replies-sum">
          <span className="cm-mini-dots">
            {t.replies.slice(-3).map((r) => (
              <span key={r.id} className="cm-dot xs" style={{ '--dot': authorColor(r) } as CSSProperties} />
            ))}
          </span>
          {t.replies.length} réponse{t.replies.length > 1 ? 's' : ''}
        </div>
      )}
      {shownReplies.length > 0 && (
        <ol className="cm-replies">
          {shownReplies.map((r) => (
            <li key={r.id} className="cm-reply" data-cm-reply={r.id}>
              <div className="cm-reply-head">
                <Meta c={r} now={ctl.now} />
                {ctl.editable && (
                  <button className="icon-btn sm cm-reply-more" title="Plus" aria-label="Plus d’actions" onClick={(e) => (e.stopPropagation(), openMenu(r, e.currentTarget))}>
                    <Ellipsis size={13} />
                  </button>
                )}
              </div>
              {body(r, false)}
            </li>
          ))}
        </ol>
      )}
      {expanded && ctl.editable && !editing && (
        <Composer
          key={`reply-${t.id}`}
          placeholder="Répondre…"
          compact
          submitLabel="Répondre"
          onSubmit={(txt) => ctl.reply(t.id, txt)}
          onCancel={(empty) => {
            if (empty) {
              ctl.activate(null);
              ctl.engine()?.focus();
            }
          }}
          testId="reply"
        />
      )}
      <Popover pop={menu} label="Commentaire" className="ed-menu cm-menu">
        <button
          className="menu-item"
          onClick={() => {
            menu.close();
            if (!menuFor) return;
            ctl.activate(t.id);
            if (resolved) ctl.resolve(t.id, false);
            setEditing(menuFor.id);
          }}
          data-cm="edit"
        >
          <Pencil size={14} /> Modifier
        </button>
        <button
          className="menu-item cm-danger"
          onClick={() => {
            menu.close();
            if (menuFor) ctl.remove(menuFor.id);
          }}
          data-cm="delete"
        >
          <Trash2 size={14} /> {menuFor && menuFor.parentId ? 'Supprimer la réponse' : 'Supprimer le fil'}
        </button>
      </Popover>
    </article>
  );
}

function PendingBubble({ ctl, top, placed, setRef }: { ctl: CommentsCtl; top: number; placed: boolean; setRef: (id: string, el: HTMLElement | null) => void }) {
  return (
    <article ref={(el) => setRef(PENDING, el)} className={`cm-bubble active pending ${placed ? 'placed' : ''}`} style={{ transform: `translateY(${Math.round(top)}px)` }} data-cm-id={PENDING}>
      <header className="cm-head">
        <div className="cm-meta">
          <span className="cm-dot mine" style={{ '--dot': 'var(--cm-accent)' } as CSSProperties} aria-hidden />
          <span className="cm-author">Vous</span>
          <span className="cm-date">nouveau commentaire</span>
        </div>
      </header>
      <Composer
        placeholder="Votre commentaire…"
        autoFocus
        submitLabel="Commenter"
        onSubmit={(txt) => ctl.submitPending(txt)}
        onCancel={(empty) => {
          if (empty) ctl.cancelPending();
        }}
        testId="new"
      />
    </article>
  );
}

/** Colonne des bulles, rendue dans la zone défilante (.ed-scroll), à droite de la page. */
export function CommentsLayer({ ctl }: { ctl: CommentsCtl }) {
  const els = useRef(new Map<string, HTMLElement>());
  const [geo, setGeo] = useState<Geo | null>(null);
  const [tops, setTops] = useState<Record<string, number>>({});
  const [relayout, setRelayout] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  // bulles déjà posées (la première pose se fait sans transition, bulle invisible avant)
  const [placed, setPlaced] = useState<ReadonlySet<string>>(() => new Set());
  const { columnOn, visible, pending, activeId, hoverId } = ctl;

  const setRef = useCallback((id: string, el: HTMLElement | null) => {
    const m = els.current;
    const prev = m.get(id);
    if (prev === el) return;
    if (prev) roRef.current?.unobserve(prev);
    if (el) {
      m.set(id, el);
      roRef.current?.observe(el);
    } else m.delete(id);
  }, []);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setRelayout((n) => n + 1));
    });
    roRef.current = ro;
    for (const el of els.current.values()) ro.observe(el);
    const host = ctl.hostRef.current;
    if (host) ro.observe(host);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      roRef.current = null;
    };
  }, [ctl.hostRef, columnOn]);

  // Géométrie : page et passages (coordonnées du contenu défilant).
  const measure = useCallback(() => {
    const e = ctl.engine();
    const sc = ctl.scrollRef.current;
    const host = ctl.hostRef.current;
    if (!e || !sc || !host || !columnOn) return setGeo(null);
    const pages = host.querySelectorAll('.superdoc-page');
    const page = pages[0];
    if (!page) return;
    const sr = sc.getBoundingClientRect();
    const toX = (x: number) => x - sr.left + sc.scrollLeft;
    const toY = (y: number) => y - sr.top + sc.scrollTop;
    const pr = page.getBoundingClientRect();
    const anchors: Geo['anchors'] = {};
    const items: { id: string; from: number; to: number; overlay: boolean }[] = visible.map((t) => ({ id: t.id, from: t.root.from, to: t.root.to, overlay: t.root.resolved }));
    if (pending) items.push({ id: PENDING, from: pending.from, to: pending.to, overlay: true });
    for (const it of items) {
      const rects = e.rangeRects(it.from, it.to);
      if (!rects.length) continue;
      const r0 = rects[0];
      anchors[it.id] = {
        y: toY(r0.top),
        x: toX(r0.right),
        h: r0.bottom - r0.top,
        rects: it.overlay ? rects.map((r) => ({ x: toX(r.left), y: toY(r.top), w: r.right - r.left, h: r.bottom - r.top })) : [],
      };
    }
    const next: Geo = {
      // à droite de la page, sans déborder de la zone (ni toucher le panneau latéral)
      left: Math.round(Math.max(toX(pr.right) + 10, Math.min(toX(pr.right) + COL_GAP, sc.clientWidth + sc.scrollLeft - ctl.colW - 14))),
      pageTop: Math.round(toY(pr.top)),
      pageRight: Math.round(toX(pr.right)),
      // dimensions du calque : la zone visible en largeur, les pages en hauteur (jamais la taille de
      // défilement elle-même, que le calque entretiendrait)
      contentW: sc.clientWidth + sc.scrollLeft,
      contentH: Math.round(toY(pages[pages.length - 1].getBoundingClientRect().bottom) + 24),
      anchors,
    };
    setGeo((g) => (g && JSON.stringify(g) === JSON.stringify(next) ? g : next));
  }, [ctl, columnOn, visible, pending]);

  // Mesure après chaque changement (la mise en page du moteur suit la transaction : 2e passe).
  useLayoutEffect(() => {
    measure();
    const t = setTimeout(measure, 140);
    return () => clearTimeout(t);
  }, [measure, ctl.tick, relayout]);

  // Placement des bulles.
  const order = useMemo(() => {
    const ids = visible.map((t) => ({ id: t.id, from: t.root.from }));
    if (pending) ids.push({ id: PENDING, from: pending.from });
    // ordre du document ; à égalité, ordre de la mise en page (haut de la ligne)
    return ids.sort((a, b) => {
      const ya = geo?.anchors[a.id]?.y ?? 0;
      const yb = geo?.anchors[b.id]?.y ?? 0;
      return Math.abs(ya - yb) > 2 ? ya - yb : a.from - b.from;
    });
  }, [visible, pending, geo]);
  const headH = 30;
  useLayoutEffect(() => {
    if (!geo) return;
    const ids = order.map((o) => o.id).filter((id) => geo.anchors[id]);
    const want = ids.map((id) => geo.anchors[id].y - 8);
    const hs = ids.map((id) => els.current.get(id)?.offsetHeight ?? 64);
    const pin = ids.indexOf(activeId ?? '');
    const res = placeBubbles(want, hs, pin, geo.pageTop + headH + 6);
    const next: Record<string, number> = {};
    ids.forEach((id, i) => (next[id] = res[i]));
    setTops((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
  }, [geo, order, activeId, relayout, ctl.tick]);

  // première pose sans transition ; ensuite, déplacements animés
  useEffect(() => {
    const t = requestAnimationFrame(() => {
      setPlaced((cur) => {
        const ids = Object.keys(tops);
        if (ids.length === cur.size && ids.every((id) => cur.has(id))) return cur;
        return new Set(ids);
      });
    });
    return () => cancelAnimationFrame(t);
  }, [tops]);

  // Clic hors des bulles (dans la page) : la bulle active cesse de l'être ; un commentaire vide en cours est abandonné.
  useEffect(() => {
    if (!columnOn) return;
    const down = (ev: PointerEvent) => {
      const t = ev.target as HTMLElement;
      if (t.closest?.('.cm-col, .cm-menu, .ed-selbar')) return;
      if (!t.closest?.('.ed-engine')) return;
      if (ctl.pending) {
        const ta = document.querySelector<HTMLTextAreaElement>('.cm-bubble.pending textarea');
        if (!ta || !ta.value.trim()) ctl.cancelPending();
      }
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [columnOn, ctl]);

  if (!columnOn || !geo) return null;
  const hot = hoverId ?? activeId;
  const hotAnchor = hot ? geo.anchors[hot] : undefined;
  const hotTop = hot ? tops[hot] : undefined;
  const hotThread = visible.find((t) => t.id === hot);
  const overlayRects = Object.entries(geo.anchors).flatMap(([id, a]) => a.rects.map((r) => ({ id, ...r })));
  return (
    <>
      {/* surbrillance du passage mis en avant (passages peints par le moteur) */}
      {hot && hot !== PENDING && hotThread && !hotThread.root.resolved && (
        <style>{`.ed-engine .superdoc-comment-highlight[data-comment-ids*="${CSS.escape(hot)}"]{background-color:var(--cm-hl-hot)!important;box-shadow:inset 0 -1.5px 0 var(--cm-rule)}`}</style>
      )}
      <svg className="cm-links" width={geo.contentW} height={geo.contentH} aria-hidden>
        {overlayRects.map((r, i) => (
          <rect key={i} className={`cm-pass ${r.id === PENDING ? 'pending' : ''} ${r.id === hot ? 'hot' : ''}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={2} />
        ))}
        {order.map(({ id }) => {
          const a = geo.anchors[id];
          if (!a || tops[id] === undefined) return null;
          return <circle key={id} className={`cm-anchor ${id === hot ? 'hot' : ''}`} cx={(geo.pageRight + geo.left) / 2} cy={a.y + a.h / 2} r={id === hot ? 3 : 2.25} />;
        })}
        {hotAnchor && hotTop !== undefined && (
          <path
            className="cm-link"
            d={(() => {
              const y0 = hotAnchor.y + hotAnchor.h / 2;
              // depuis le bord de la page (le trait ne barre pas la fin de la ligne)
              const xm = (geo.pageRight + geo.left) / 2;
              const y1 = hotTop + 19;
              const x1 = geo.left;
              if (Math.abs(y1 - y0) < 2) return `M ${xm} ${y0} L ${x1} ${y1}`;
              return `M ${xm} ${y0} C ${xm + 8} ${y0}, ${x1 - 8} ${y1}, ${x1} ${y1}`;
            })()}
          />
        )}
      </svg>
      <div className="cm-col ed-comments" style={{ left: geo.left, width: ctl.colW, top: 0, height: geo.contentH }} aria-label="Commentaires" role="complementary">
        <div className="cm-colhead" style={{ transform: `translateY(${geo.pageTop}px)` }}>
          <span className="cm-colhead-title">
            <MessageSquare size={13} /> {ctl.openCount ? `${ctl.openCount} commentaire${ctl.openCount > 1 ? 's' : ''}` : 'Commentaires'}
          </span>
          {ctl.resolvedCount > 0 && (
            <button className={`cm-filter ${ctl.showResolved ? 'on' : ''}`} onClick={() => ctl.setShowResolved(!ctl.showResolved)} aria-pressed={ctl.showResolved} data-cm="filter-resolved" title={ctl.showResolved ? 'Masquer les commentaires résolus' : 'Afficher les commentaires résolus'}>
              <Check size={12} /> {ctl.resolvedCount} résolu{ctl.resolvedCount > 1 ? 's' : ''}
            </button>
          )}
        </div>
        {visible.map((t) => (
          <Bubble key={t.id} t={t} ctl={ctl} active={activeId === t.id} hot={hoverId === t.id} top={tops[t.id] ?? geo.anchors[t.id]?.y ?? 0} placed={placed.has(t.id)} setRef={setRef} />
        ))}
        {pending && <PendingBubble ctl={ctl} top={tops[PENDING] ?? geo.anchors[PENDING]?.y ?? 0} placed={placed.has(PENDING)} setRef={setRef} />}
      </div>
    </>
  );
}
