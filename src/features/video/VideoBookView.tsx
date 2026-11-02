// Page d'une vidéo : lecteur intégré (YouTube, Vimeo, Dailymotion) ou lien ouvert dans le navigateur ;
// transcription synchronisée (sous-titres YouTube) qu'on surligne comme un livre ; « Noter ce moment » ;
// extraits minutés (un clic sur le minutage ramène la vidéo à ce moment).
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Bookmark as BookmarkIcon, Check, ChevronLeft, Copy, ExternalLink, FileText, Highlighter, ListTree, Maximize2, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { Book, Bookmark, CategoryId, Highlight } from '../../lib/types';
import { CATEGORIES, CATEGORY_BY_ID } from '../../lib/categories';
import { formatCitation } from '../../lib/citation';
import { fmtKeys, isMod } from '../../lib/keys';
import { CategoryPicker } from '../paper/PaperBookView';
import { paperBackLabel, paperGoBack } from '../paper/paper';
import { usePlayer } from './usePlayer';
import {
  CONTROLLED,
  EMBEDDED,
  PROVIDER_LABEL,
  addVideoBookmark,
  addVideoExtract,
  byTime,
  chapterAt,
  embedUrl,
  fetchTranscript,
  fmtDuration,
  fmtTime,
  loadTranscript,
  parseTime,
  saveVideoPosition,
  secondsOfBookmark,
  startOfExtract,
  useVideoSeek,
  type TranscriptLine,
} from './video';
import './video.css';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand('copy');
    } finally {
      ta.remove();
    }
  }
}

const openOutside = (url: string) => window.open(url, '_blank', 'noopener');

// ── Extraits ─────────────────────────────────────────────────

const ExtractItem = memo(function ExtractItem({ h, book, active, onSeek, onReplay }: { h: Highlight; book: Book; active: boolean; onSeek(sec: number): void; onReplay?: (h: Highlight) => void }) {
  const c = h.category ? CATEGORY_BY_ID[h.category] : null;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  return (
    <li ref={ref} className={`vv-extract ${active ? 'is-active' : ''}`} data-hl={h.id} data-testid="video-extract" style={c ? ({ ['--c' as string]: `var(${c.cssVar})` } as React.CSSProperties) : undefined}>
      <button className="vv-time" onClick={() => onSeek(startOfExtract(h))} title="Revoir ce moment" data-testid="video-extract-time">
        {h.locationLabel || fmtTime(startOfExtract(h))}
      </button>
      <div className="vv-extract-body">
        <blockquote className="vv-extract-text">{h.text}</blockquote>
        {(c || h.note) && (
          <div className="vv-extract-meta">
            {c && (
              <span className="vv-extract-cat">
                <span className="pb-cat-dot" aria-hidden="true" /> {c.label}
              </span>
            )}
            {h.note && <span className="vv-extract-note">{h.note}</span>}
          </div>
        )}
      </div>
      <div className="vv-extract-actions">
        {onReplay && (
          <button className="icon-btn sm" aria-label="Rejouer l’extrait" title="Rejouer exactement ce passage" onClick={() => onReplay(h)} data-testid="video-extract-replay">
            <RotateCcw size={14} />
          </button>
        )}
        <button
          className="icon-btn sm"
          aria-label="Copier la citation"
          title="Copier la citation (avec la chaîne, le titre et le minutage)"
          onClick={async () => {
            const ok = await copyText(formatCitation(h, book));
            useStore.getState().toast(ok ? 'Citation copiée, avec sa référence' : 'Copie impossible', ok ? 'success' : 'error');
          }}
        >
          <Copy size={14} />
        </button>
        <button className="icon-btn sm pb-danger" aria-label="Supprimer l’extrait" title="Supprimer (corbeille)" onClick={() => useStore.getState().removeHighlight(h.id)}>
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
});

/** « Noter ce moment » : minutage (la minute en cours, modifiable), texte, catégorie, note. */
function MomentComposer({ bookId, now, live }: { bookId: string; now: number; live: boolean }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [cat, setCat] = useState<CategoryId | null>(null);
  const [time, setTime] = useState('');
  const [typed, setTyped] = useState(false);
  // Tant qu'on n'a pas tapé un minutage, il suit la vidéo.
  const shown = typed ? time : fmtTime(now);
  const add = () => {
    const sec = parseTime(shown);
    if (!text.trim() || sec == null) return;
    const h = addVideoExtract(bookId, { text, start: sec, category: cat, note });
    useStore.getState().toast(`Extrait ajouté à ${h.locationLabel}`, 'success');
    setText('');
    setNote('');
    setTyped(false);
  };
  return (
    <form
      className="vv-compose"
      aria-label="Noter ce moment"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <div className="vv-compose-row">
        <label className="vv-compose-time" title={live ? 'La minute en cours ; tapez-en une autre au besoin' : 'Minutage du passage'}>
          <span className="sr-label">Minutage</span>
          <input
            className="input"
            value={shown}
            onChange={(e) => {
              setTyped(true);
              setTime(e.target.value);
            }}
            inputMode="numeric"
            aria-label="Minutage"
            data-testid="video-moment-time"
          />
        </label>
        <textarea
          className="input vv-compose-text"
          rows={2}
          placeholder="Ce qui est dit à ce moment, ou votre idée…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => {
            if (!typed && live) {
              // On fige la minute au moment où l'on commence à noter.
              setTime(fmtTime(now));
              setTyped(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isMod(e)) {
              e.preventDefault();
              add();
            }
          }}
          aria-label="Texte de l’extrait"
          data-testid="video-moment-text"
        />
      </div>
      <CategoryPicker value={cat} onChange={setCat} name="vv-new-cat" />
      <div className="vv-compose-foot">
        <input className="input vv-compose-note" placeholder="Ma note (facultative)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Ma note" />
        <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim() || parseTime(shown) == null} title={fmtKeys('Ajouter l’extrait (⌘↩)')} data-testid="video-moment-add">
          <Check size={13} /> Noter ce moment
        </button>
      </div>
    </form>
  );
}

// ── Transcription ────────────────────────────────────────────

interface SelPop {
  x: number;
  y: number;
  text: string;
  from: number;
  to: number;
}

function Transcript({
  book,
  lines,
  timeMs,
  highlights,
  onSeek,
  state,
  onFetch,
}: {
  book: Book;
  lines: TranscriptLine[] | null;
  timeMs: number;
  highlights: Highlight[];
  onSeek(sec: number): void;
  state: 'idle' | 'loading' | 'error';
  onFetch(): void;
}) {
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const [pop, setPop] = useState<SelPop | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const userScroll = useRef(0);

  const active = useMemo(() => {
    if (!lines?.length) return -1;
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].s <= timeMs) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }, [lines, timeMs]);

  const marks = useMemo(() => {
    const m = new Map<number, Highlight>();
    if (!lines) return m;
    for (const h of highlights) {
      if (h.anchor.kind !== 'html') continue;
      const s = h.anchor.start;
      const e = Math.max(h.anchor.end, s + 1);
      lines.forEach((l, i) => {
        if (l.s < e && l.e > s && !m.has(i)) m.set(i, h);
      });
    }
    return m;
  }, [lines, highlights]);

  const q = fold(query.trim());
  const shown = useMemo(() => (lines ? lines.map((l, i) => ({ l, i })).filter(({ l }) => !q || fold(l.t).includes(q)) : []), [lines, q]);

  // La ligne en cours reste visible, sauf si l'on vient de faire défiler soi-même.
  useEffect(() => {
    if (!follow || q || active < 0 || Date.now() - userScroll.current < 4000) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active, follow, q]);

  const onMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? '';
    if (!sel || !text || !listRef.current || sel.rangeCount === 0) return setPop(null);
    const lineOf = (n: Node | null) => (n ? (n instanceof Element ? n : n.parentElement)?.closest<HTMLElement>('[data-line]') : null);
    const a = lineOf(sel.anchorNode);
    const b = lineOf(sel.focusNode);
    if (!a || !b || !listRef.current.contains(a) || !listRef.current.contains(b)) return setPop(null);
    const ia = Number(a.dataset.line);
    const ib = Number(b.dataset.line);
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setPop({ x: r.left + r.width / 2, y: r.top, text, from: Math.min(ia, ib), to: Math.max(ia, ib) });
  };

  const keep = (category: CategoryId | null) => {
    if (!pop || !lines) return;
    const h = addVideoExtract(book.id, { text: pop.text, start: lines[pop.from].s / 1000, end: lines[pop.to].e / 1000, category });
    window.getSelection()?.removeAllRanges();
    setPop(null);
    useStore.getState().toast(`Extrait ajouté à ${h.locationLabel}`, 'success');
  };

  if (!lines) {
    const youtube = book.video?.provider === 'youtube';
    return (
      <div className="vv-tr-empty" data-testid="video-transcript-empty">
        <FileText size={22} aria-hidden="true" />
        <h3>Pas encore de transcription</h3>
        {youtube ? (
          <>
            <p>Les sous-titres de la vidéo deviennent un texte qu’on lit et qu’on surligne, comme un livre. Chaque passage garde son minutage.</p>
            <button className="btn btn-sm btn-primary" onClick={onFetch} disabled={state === 'loading'} data-testid="video-transcript-fetch">
              <RefreshCw size={13} className={state === 'loading' ? 'spin' : ''} /> {state === 'loading' ? 'Récupération…' : 'Récupérer la transcription'}
            </button>
          </>
        ) : (
          <p>La transcription automatique existe pour les vidéos YouTube. Ici, notez les moments qui comptent avec « Noter ce moment » : chaque extrait garde son minutage.</p>
        )}
      </div>
    );
  }

  return (
    <div className="vv-tr">
      <div className="vv-tr-head">
        <label className="vv-tr-search">
          <Search size={13} aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher dans la transcription" aria-label="Chercher dans la transcription" data-testid="video-transcript-search" />
        </label>
        <label className="vv-follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Suivre
        </label>
      </div>
      <p className="vv-tr-hint">
        <Highlighter size={12} aria-hidden="true" /> Sélectionnez un passage pour en faire un extrait
        {book.video?.transcript?.auto ? ' · sous-titres automatiques' : ''}
      </p>
      <div
        ref={listRef}
        className="vv-tr-list"
        onMouseUp={onMouseUp}
        onWheel={() => (userScroll.current = Date.now())}
        onScroll={() => pop && setPop(null)}
        role="list"
        aria-label="Transcription"
        data-testid="video-transcript"
      >
        {shown.length === 0 && <p className="vv-tr-none">Aucun passage ne contient « {query.trim()} ».</p>}
        {shown.map(({ l, i }) => {
          const h = marks.get(i);
          const c = h?.category ? CATEGORY_BY_ID[h.category] : null;
          return (
            <div
              key={i}
              role="listitem"
              className={`vv-line ${i === active ? 'is-now' : ''} ${h ? 'is-marked' : ''}`}
              data-line={i}
              style={h ? ({ ['--c' as string]: c ? `var(${c.cssVar})` : 'var(--hl-plain, #e8c547)' } as React.CSSProperties) : undefined}
            >
              <button className="vv-line-time" onClick={() => onSeek(l.s / 1000)} tabIndex={-1} title="Aller à ce moment">
                {fmtTime(l.s / 1000)}
              </button>
              <p className="vv-line-text">{l.t}</p>
            </div>
          );
        })}
      </div>
      {pop && (
        <div className="floating vv-selpop anim-scale" style={{ left: pop.x, top: pop.y }} role="toolbar" aria-label="Faire un extrait" data-testid="video-selpop" onMouseDown={(e) => e.preventDefault()}>
          <button className="vv-selpop-btn" onClick={() => keep(null)} title="Extrait sans catégorie">
            <Highlighter size={13} /> Extrait
          </button>
          {CATEGORIES.map((c) => (
            <button key={c.id} className="vv-selpop-cat" style={{ ['--c' as string]: `var(${c.cssVar})` } as React.CSSProperties} onClick={() => keep(c.id)} title={c.label} aria-label={c.label} data-cat={c.id}>
              <span className="pb-cat-dot" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Extraits d'une vidéo, par minutage, à citer (panneau « Livre » de l'éditeur). */
export function VideoExtracts({ bookId, onCite }: { bookId: string; onCite?: (h: Highlight, b: Book) => void }) {
  const book = useStore((s) => s.books.find((b) => b.id === bookId) ?? null);
  const highlights = useStore(useShallow((s) => s.highlights.filter((h) => h.bookId === bookId)));
  const sorted = useMemo(() => [...highlights].sort(byTime), [highlights]);
  if (!book) return null;
  if (!sorted.length)
    return (
      <div className="empty vv-compact-empty">
        <h3>Aucun extrait pour l’instant</h3>
        <p>Ouvrez la vidéo pour surligner sa transcription ou noter un moment : ses extraits se citent ici avec leur minutage.</p>
        <button className="btn btn-sm" onClick={() => useStore.getState().openBook(bookId)}>
          Ouvrir la vidéo
        </button>
      </div>
    );
  return (
    <ul className="vv-list vv-compact" aria-label="Extraits de la vidéo">
      {sorted.map((h) => {
        const c = h.category ? CATEGORY_BY_ID[h.category] : null;
        return (
          <li key={h.id} className="vv-extract" style={c ? ({ ['--c' as string]: `var(${c.cssVar})` } as React.CSSProperties) : undefined} data-testid="video-extract">
            <span className="vv-time" aria-label="Minutage">
              {h.locationLabel}
            </span>
            <div className="vv-extract-body">
              <blockquote className="vv-extract-text">{h.text}</blockquote>
            </div>
            {onCite && (
              <button className="btn btn-sm" onClick={() => onCite(h, book)} title="Insérer la citation au curseur de l’écrit, avec sa référence">
                Citer
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Sommaire : les chapitres de la vidéo ; le chapitre en cours est mis en avant. */
function ChapterList({ chapters, now, onSeek, counts }: { chapters: { s: number; t: string }[]; now: number; onSeek(sec: number): void; counts: number[] }) {
  const cur = chapterAt(chapters, now)?.i ?? -1;
  return (
    <ol className="vv-chapters" aria-label="Chapitres" data-testid="video-chapters">
      {chapters.map((c, i) => (
        <li key={i}>
          <button className={`vv-chapter ${i === cur ? 'is-now' : ''}`} onClick={() => onSeek(c.s)} data-testid="video-chapter">
            <span className="vv-chapter-time">{fmtTime(c.s)}</span>
            <span className="vv-chapter-title">{c.t}</span>
            {counts[i] > 0 && <span className="vv-chapter-n" title={`${counts[i]} extrait${counts[i] > 1 ? 's' : ''}`}>{counts[i]}</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Signets de la vidéo : minutage (clic : y aller), nom modifiable, suppression. */
function BookmarkList({ marks, onSeek }: { marks: Bookmark[]; onSeek(sec: number): void }) {
  if (!marks.length)
    return (
      <div className="vv-tr-empty" data-testid="video-bookmarks-empty">
        <BookmarkIcon size={22} aria-hidden="true" />
        <h3>Aucun signet</h3>
        <p>« Signet » sous le lecteur (ou ⌘D) marque le moment en cours, pour y revenir d’un clic.</p>
      </div>
    );
  return (
    <ul className="vv-marks" aria-label="Signets" data-testid="video-bookmarks">
      {marks.map((bm) => (
        <li key={bm.id} className="vv-mark" data-testid="video-bookmark">
          <button className="vv-line-time" onClick={() => onSeek(secondsOfBookmark(bm))} title="Aller à ce moment">
            {bm.locationLabel}
          </button>
          <div className="vv-mark-body">
            <input
              className="vv-mark-label"
              defaultValue={bm.label}
              aria-label="Nom du signet"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== bm.label) useStore.getState().updateBookmark(bm.id, { label: v });
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            {bm.excerpt && <p className="vv-mark-excerpt">{bm.excerpt}</p>}
          </div>
          <button className="icon-btn sm pb-danger" aria-label="Supprimer le signet" onClick={() => useStore.getState().removeBookmark(bm.id)}>
            <Trash2 size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

// ── Page ─────────────────────────────────────────────────────

export function VideoBookView({ bookId }: { bookId: string }) {
  const book = useStore((s) => s.books.find((b) => b.id === bookId) ?? null);
  const highlights = useStore(useShallow((s) => s.highlights.filter((h) => h.bookId === bookId)));
  const activeHl = useStore((s) => s.activeHighlightId);
  const online = useStore((s) => s.settings.videoOnline !== false);
  const jump = useStore((s) => s.jump);
  const provider = book?.video?.provider ?? 'link';
  const player = usePlayer(provider);
  const embedded = EMBEDDED(provider) && online;
  const controlled = embedded && CONTROLLED(provider);
  // Minute de départ du lecteur (reprise ; Dailymotion : saut = rechargement à la bonne minute).
  const [startAt, setStartAt] = useState(() => book?.video?.position ?? 0);
  const [reload, setReload] = useState(0);
  const [lines, setLines] = useState<TranscriptLine[] | null>(null);
  const [trState, setTrState] = useState<'idle' | 'loading' | 'error'>('idle');
  const sorted = useMemo(() => [...highlights].sort(byTime), [highlights]);
  const marks = useStore(useShallow((s) => s.bookmarks.filter((b) => b.bookId === bookId)));
  const sortedMarks = useMemo(() => [...marks].sort((a, b) => secondsOfBookmark(a) - secondsOfBookmark(b)), [marks]);
  const [tab, setTab] = useState<'transcript' | 'chapters' | 'marks'>('transcript');
  const [rate, setRate] = useState(1);

  useEffect(() => {
    useStore.getState().updateBook(bookId, { lastOpenedAt: Date.now() });
    let alive = true;
    void loadTranscript(bookId).then((l) => alive && setLines(l));
    return () => {
      alive = false;
    };
  }, [bookId]);

  const seek = useCallback(
    (sec: number) => {
      if (controlled && player.ready) player.seek(sec);
      else if (embedded) {
        setStartAt(sec);
        setReload((n) => n + 1);
      }
    },
    [controlled, embedded, player],
  );

  // Arrivée par un extrait (recherche, Extraits, carte) : la vidéo va à ce moment.
  const jumped = useRef(0);
  useEffect(() => {
    if (!jump || jump.nonce === jumped.current) return;
    const h = useStore.getState().highlights.find((x) => x.id === jump.highlightId);
    if (h?.bookId !== bookId) return;
    if (controlled && !player.ready) return; // on attend que le lecteur réponde
    jumped.current = jump.nonce;
    useStore.getState().setActiveHighlight(h.id);
    seek(startOfExtract(h));
  }, [jump, bookId, controlled, player.ready, seek]);

  // Arrivée par un signet (⌘K, liste des signets) ou par une phrase trouvée dans une transcription.
  const bmJump = useStore((s) => s.bookmarkJump);
  const seekReq = useVideoSeek((s) => s.req);
  const handled = useRef(new Set<number>());
  useEffect(() => {
    if (controlled && !player.ready) return;
    if (bmJump && !handled.current.has(bmJump.nonce)) {
      const bm = useStore.getState().bookmarks.find((x) => x.id === bmJump.bookmarkId);
      if (bm?.bookId === bookId) {
        handled.current.add(bmJump.nonce);
        seek(secondsOfBookmark(bm));
      }
    }
    if (seekReq && seekReq.bookId === bookId && !handled.current.has(seekReq.nonce)) {
      handled.current.add(seekReq.nonce);
      seek(seekReq.sec);
    }
  }, [bmJump, seekReq, bookId, controlled, player.ready, seek]);

  // « Rejouer l'extrait » : du début à la fin du passage (au moins 15 s pour un moment noté), puis pause.
  const replayUntil = useRef<number | null>(null);
  const replay = useCallback(
    (h: Highlight) => {
      const start = startOfExtract(h);
      const end = h.anchor.kind === 'html' ? h.anchor.end / 1000 : start;
      replayUntil.current = Math.max(end, start + 15);
      player.seek(start, true);
      useStore.getState().setActiveHighlight(h.id);
    },
    [player],
  );
  useEffect(() => {
    if (replayUntil.current != null && player.time >= replayUntil.current) {
      replayUntil.current = null;
      player.pause();
    }
  }, [player.time, player]);

  // Signet au moment en cours (bouton « Signet », ou ⌘D hors d'un champ de saisie).
  const linesRef = useRef<TranscriptLine[] | null>(null);
  linesRef.current = lines;
  const addMark = useCallback(() => {
    const b = useStore.getState().books.find((x) => x.id === bookId);
    const t = controlled ? player.time : b?.video?.position ?? 0;
    const ch = chapterAt(b?.video?.chapters, t);
    const line = linesRef.current?.filter((l) => l.s <= t * 1000).pop();
    const bm = addVideoBookmark(bookId, t, ch ? ch.t : '', line?.t ?? '');
    useStore.getState().toast(`Signet ajouté à ${bm.locationLabel}`, 'success');
    setTab('marks');
  }, [bookId, controlled, player.time]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isMod(e) || e.key.toLowerCase() !== 'd' || e.shiftKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      addMark();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addMark]);

  // Où l'on en est : retenu toutes les 5 secondes de lecture, et en quittant la page.
  const saved = useRef(0);
  useEffect(() => {
    if (!controlled || !player.ready) return;
    if (Math.abs(player.time - saved.current) >= 5 || (player.duration && player.duration - player.time < 2)) {
      saved.current = player.time;
      saveVideoPosition(bookId, player.time, player.duration);
    }
  }, [controlled, player.ready, player.time, player.duration, bookId]);
  const last = useRef({ t: 0, d: 0 });
  last.current = { t: player.time, d: player.duration };
  useEffect(
    () => () => {
      if (last.current.t > 0) saveVideoPosition(bookId, last.current.t, last.current.d);
    },
    [bookId],
  );

  // Plein écran : le lecteur seul ; Échap (ou le bouton du lecteur) revient à la page.
  const playerBox = useRef<HTMLDivElement>(null);
  const fullscreen = () => {
    const el = playerBox.current;
    if (!el) return;
    void el.requestFullscreen?.().catch(() => useStore.getState().toast('Plein écran indisponible', 'error'));
  };

  const getTranscript = async () => {
    setTrState('loading');
    const r = await fetchTranscript(bookId);
    if (r.ok && r.lines) {
      setLines(r.lines);
      setTrState('idle');
      useStore.getState().toast(r.chapters ? `Transcription prête, et ${r.chapters} chapitres` : 'Transcription prête', 'success');
    } else {
      setTrState('error');
      useStore.getState().toast(r.error ?? 'Transcription impossible', 'error');
    }
  };

  if (!book || !book.video) {
    return (
      <div className="empty" style={{ marginTop: 80 }}>
        <h3>Cette vidéo n’existe plus</h3>
        <p>Elle a peut-être été supprimée : regardez dans la corbeille.</p>
        <button className="btn" onClick={() => useStore.getState().navigate({ name: 'library' })}>
          Bibliothèque
        </button>
      </div>
    );
  }
  const v = book.video;
  const now = controlled ? player.time : 0;
  const src = embedded ? embedUrl(provider, v.id, startAt) : '';
  const curChapter = chapterAt(v.chapters, controlled ? player.time : startAt);

  return (
    <div className="vv" data-testid="video-view">
      <header className="topbar vv-top">
        <button className="btn btn-sm btn-ghost" onClick={paperGoBack} title={`Revenir : ${paperBackLabel()}`}>
          <ChevronLeft size={15} /> {paperBackLabel()}
        </button>
        <div className="vv-heading">
          <h1 className="vv-title" title={book.title}>
            {book.title}
          </h1>
          <span className="vv-sub">{[book.author, v.provider === 'link' ? 'Lien' : PROVIDER_LABEL[v.provider], fmtDuration(v.duration)].filter(Boolean).join(' · ')}</span>
        </div>
        <span className="spacer" />
        {v.provider === 'youtube' && lines && online && (
          <button className="btn btn-sm btn-ghost" onClick={() => void getTranscript()} disabled={trState === 'loading'} title="Récupérer à nouveau les sous-titres">
            <RefreshCw size={13} className={trState === 'loading' ? 'spin' : ''} /> Transcription
          </button>
        )}
        <button className="btn btn-sm" onClick={() => openOutside(v.url)} title="Ouvrir la vidéo sur la plateforme, dans votre navigateur" data-testid="video-open-outside">
          <ExternalLink size={13} /> Ouvrir dans le navigateur
        </button>
      </header>

      <div className="vv-body">
        <section className="vv-main" aria-label="Vidéo">
          <div className="vv-player" ref={playerBox}>
            {src ? (
              <iframe
                key={`${provider}:${v.id}:${reload}`}
                ref={player.frameRef}
                src={src}
                title={`Lecteur : ${book.title}`}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                onLoad={player.onLoad}
                data-testid="video-frame"
              />
            ) : (
              <div className="vv-player-off" data-testid="video-player-off">
                <p>
                  {v.provider === 'link'
                    ? 'Cette vidéo se regarde sur sa plateforme : ouvrez-la dans votre navigateur et notez ici les moments qui comptent.'
                    : 'Les vidéos en ligne sont désactivées dans les Réglages : le lecteur n’est pas chargé.'}
                </p>
                <button className="btn btn-sm" onClick={() => openOutside(v.url)}>
                  <ExternalLink size={13} /> Ouvrir dans le navigateur
                </button>
              </div>
            )}
          </div>
          <div className="vv-under">
            {src && (
              <button className="btn btn-sm btn-ghost" onClick={fullscreen} title="Regarder en plein écran (Échap pour revenir)" data-testid="video-fullscreen">
                <Maximize2 size={13} /> Plein écran
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={addMark} title={fmtKeys('Marquer ce moment (⌘D)')} data-testid="video-bookmark-add">
              <BookmarkIcon size={13} /> Signet
            </button>
            {controlled && (
              <label className="vv-rate" title="Vitesse de lecture">
                <span className="sr-label">Vitesse de lecture</span>
                <select
                  className="vv-rate-select"
                  value={rate}
                  onChange={(e) => {
                    const r = Number(e.target.value);
                    setRate(r);
                    player.setRate(r);
                  }}
                  data-testid="video-rate"
                >
                  {RATES.map((r) => (
                    <option key={r} value={r}>
                      {String(r).replace('.', ',')}×
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="spacer" />
            {curChapter && (
              <span className="vv-now-chapter" title="Chapitre en cours" data-testid="video-now-chapter">
                {curChapter.t}
              </span>
            )}
            {controlled && (
              <span className="vv-clock" aria-live="off">
                <span data-testid="video-now">{fmtTime(player.time)}</span>
                {player.duration > 0 && <span className="vv-clock-dur"> / {fmtTime(player.duration)}</span>}
              </span>
            )}
          </div>
          <MomentComposer bookId={book.id} now={now} live={controlled && player.ready} />
          <div className="vv-extracts">
            <h2 className="vv-h">
              Mes extraits <span className="vv-count">{sorted.length}</span>
            </h2>
            {sorted.length === 0 ? (
              <p className="vv-empty">Les passages que vous notez ou surlignez arrivent ici, rangés par minutage.</p>
            ) : (
              <ul className="vv-list" aria-label="Extraits de la vidéo">
                {sorted.map((h, i) => {
                  const ch = chapterAt(v.chapters, startOfExtract(h));
                  const prev = i > 0 ? chapterAt(v.chapters, startOfExtract(sorted[i - 1])) : null;
                  return (
                    <Fragment key={h.id}>
                      {ch && ch.i !== prev?.i && (
                        <li className="vv-list-chapter" aria-hidden="true" data-testid="video-extract-chapter">
                          {ch.t}
                        </li>
                      )}
                      <ExtractItem h={h} book={book} active={activeHl === h.id} onSeek={seek} onReplay={controlled ? replay : undefined} />
                    </Fragment>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
        <aside className="vv-side" aria-label="Transcription, sommaire et signets">
          <div className="vv-tabs" role="tablist" aria-label="Panneau">
            <button role="tab" aria-selected={tab === 'transcript'} className={`vv-tab ${tab === 'transcript' ? 'is-on' : ''}`} onClick={() => setTab('transcript')} data-testid="video-tab-transcript">
              Transcription
            </button>
            {!!v.chapters?.length && (
              <button role="tab" aria-selected={tab === 'chapters'} className={`vv-tab ${tab === 'chapters' ? 'is-on' : ''}`} onClick={() => setTab('chapters')} data-testid="video-tab-chapters">
                <ListTree size={13} /> Sommaire
              </button>
            )}
            <button role="tab" aria-selected={tab === 'marks'} className={`vv-tab ${tab === 'marks' ? 'is-on' : ''}`} onClick={() => setTab('marks')} data-testid="video-tab-marks">
              Signets {marks.length > 0 && <span className="vv-tab-n">{marks.length}</span>}
            </button>
          </div>
          {tab === 'transcript' && <Transcript book={book} lines={lines} timeMs={now * 1000} highlights={highlights} onSeek={seek} state={trState} onFetch={() => void getTranscript()} />}
          {tab === 'chapters' && v.chapters?.length ? (
            <ChapterList chapters={v.chapters} now={now} onSeek={seek} counts={v.chapters.map((_, i) => sorted.filter((h) => chapterAt(v.chapters, startOfExtract(h))?.i === i).length)} />
          ) : null}
          {tab === 'marks' && <BookmarkList marks={sortedMarks} onSeek={seek} />}
        </aside>
      </div>
    </div>
  );
}
