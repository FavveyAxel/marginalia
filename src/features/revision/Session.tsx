// Session de révision : une carte à la fois, notation à 4 boutons (1-4), annulation (⌘Z), sortie (Échap).
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Undo2, X } from 'lucide-react';
import { useStore } from '../../lib/store';
import { Kbd } from '../../components/ui';
import type { Grade } from 'ts-fsrs';
import type { Book, Highlight } from '../../lib/types';
import { applyGrade, GRADE_LABEL, GRADES, previewGrades, type FsrsState } from './fsrs';
import { dayLabel, nextDue } from './queue';
import { KIND_LABEL, Rich, sourceOf } from './RichText';
import { recordReviewDay } from './stats';

/** Une carte notée « à revoir » ou en apprentissage revient dans la session si son échéance est proche. */
const REQUEUE_MS = 20 * 60_000;

interface Snapshot {
  queue: string[];
  pos: number;
  counts: number[];
  cardId: string;
  prev: FsrsState;
}

const fmtDuration = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, '0')} s`;
};

export function Session({ ids, onExit }: { ids: string[]; onExit: () => void }) {
  const cards = useStore((s) => s.cards);
  const books = useStore((s) => s.books);
  const highlights = useStore((s) => s.highlights);
  const patch = useStore((s) => s.patch);
  const jump = useStore((s) => s.jumpToHighlight);

  const [queue, setQueue] = useState(ids);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [counts, setCounts] = useState([0, 0, 0, 0]);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const startedAt = useRef(Date.now());

  const done = pos >= queue.length;
  const card = done ? null : (cards.find((c) => c.id === queue[pos]) ?? null);

  // Carte supprimée en cours de route : passer à la suivante.
  useEffect(() => {
    if (!done && !card) setPos((p) => p + 1);
  }, [done, card]);

  useEffect(() => setShownAt(Date.now()), [pos, queue.length]);

  const previews = useMemo(() => (card ? previewGrades(card.fsrs, shownAt) : []), [card?.id, card?.fsrs, shownAt]);

  const rate = (grade: Grade) => {
    if (!card || !revealed) return;
    const now = Date.now();
    const next = applyGrade(card.fsrs, grade, now);
    patch('cards', card.id, { fsrs: next });
    recordReviewDay(now);
    setHistory((h) => [...h, { queue, pos, counts, cardId: card.id, prev: card.fsrs }]);
    setCounts((c) => c.map((n, i) => (i === grade - 1 ? n + 1 : n)));
    const again = next.due - now <= REQUEUE_MS;
    const q = again ? [...queue, card.id] : queue;
    setQueue(q);
    setPos(pos + 1);
    setRevealed(false);
    if (pos + 1 >= q.length) setFinishedAt(now);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    patch('cards', last.cardId, { fsrs: last.prev });
    setQueue(last.queue);
    setPos(last.pos);
    setCounts(last.counts);
    setHistory((h) => h.slice(0, -1));
    setFinishedAt(null);
    setRevealed(true);
  };

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onExit();
    } else if (done) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onExit();
      }
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (t && t.tagName === 'BUTTON' && e.key === 'Enter') return; // laisser le bouton focalisé agir
      e.preventDefault();
      if (!revealed) setRevealed(true);
    } else if (revealed && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      rate(GRADES[Number(e.key) - 1]);
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const total = queue.length;
  const pct = total ? Math.min(100, (pos / total) * 100) : 0;

  return (
    <>
      <header className="topbar">
        <button className="btn btn-ghost" onClick={onExit}>
          <X size={14} /> Quitter <Kbd>Échap</Kbd>
        </button>
        <div className="spacer" />
        <button className="btn btn-ghost" onClick={undo} disabled={!history.length} title="Annuler la dernière note">
          <Undo2 size={14} /> Annuler la note <Kbd>⌘Z</Kbd>
        </button>
      </header>
      <div
        className="rev-progress"
        role="progressbar"
        aria-label="Progression de la session"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(pos, total)}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="rev-stage">
        {done ? (
          <Finish counts={counts} startedAt={startedAt.current} finishedAt={finishedAt ?? Date.now()} onExit={onExit} />
        ) : card ? (
          <div className="rev-deck">
            <article key={`${pos}-${card.id}`} className="rev-card anim-scale" aria-live="polite">
              <div className="rev-card-meta">
                <span className="rev-kind">{KIND_LABEL[card.kind]}</span>
                <span className="rev-count" aria-label={`Carte ${pos + 1} sur ${total}`}>
                  {pos + 1} / {total}
                </span>
              </div>
              <Rich text={card.front} className="rev-front" />
              {revealed && (
                <div className="rev-answer anim-fade">
                  <div className="rev-rule" />
                  <Rich text={card.back} className="rev-back" />
                  <Source cardId={card.id} onOpen={jump} books={books} highlights={highlights} />
                </div>
              )}
            </article>
            <div className="rev-foot">
              {!revealed ? (
                <button className="btn rev-reveal" onClick={() => setRevealed(true)} autoFocus>
                  Afficher la réponse <Kbd>Espace</Kbd>
                </button>
              ) : (
                <div className="rev-grades anim-fade" role="group" aria-label="Noter votre réponse">
                  {previews.map((p, i) => (
                    <button key={p.grade} className={`rev-grade g${p.grade}`} onClick={() => rate(p.grade)} aria-keyshortcuts={String(i + 1)}>
                      <span className="rev-grade-label">
                        {GRADE_LABEL[p.grade]} <Kbd>{i + 1}</Kbd>
                      </span>
                      <span className="rev-grade-int">{p.interval}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function Source({
  cardId,
  books,
  highlights,
  onOpen,
}: {
  cardId: string;
  books: Book[];
  highlights: Highlight[];
  onOpen: (id: string) => void;
}) {
  const card = useStore((s) => s.cards.find((c) => c.id === cardId));
  if (!card) return null;
  const src = sourceOf(card, books, highlights);
  if (!src) return null;
  return (
    <div className="rev-source">
      <Rich text={src.md} className="rev-source-ref" />
      {src.highlightId && (
        <button className="rev-link" onClick={() => onOpen(src.highlightId!)}>
          Ouvrir le passage <ArrowUpRight size={13} />
        </button>
      )}
    </div>
  );
}

function Finish({ counts, startedAt, finishedAt, onExit }: { counts: number[]; startedAt: number; finishedAt: number; onExit: () => void }) {
  const cards = useStore((s) => s.cards);
  const n = counts.reduce((a, b) => a + b, 0);
  const kept = n - counts[0];
  const next = nextDue(cards, Date.now());
  return (
    <section className="rev-finish anim-scale" aria-label="Session terminée">
      <h2 className="page-title">{n ? 'Session terminée' : 'Aucune carte notée'}</h2>
      {n > 0 && (
        <>
          <p className="rev-finish-score">
            <span className="rev-big">{kept}</span>
            <span className="muted"> / {n} retenues</span>
          </p>
          <dl className="rev-finish-facts">
            <div>
              <dt>Durée</dt>
              <dd>{fmtDuration(finishedAt - startedAt)}</dd>
            </div>
            <div>
              <dt>À revoir</dt>
              <dd>{counts[0]}</dd>
            </div>
            <div>
              <dt>Prochaine échéance</dt>
              <dd>{next ? `${dayLabel(next.at, Date.now())} (${next.count} ${next.count > 1 ? 'cartes' : 'carte'})` : 'aucune'}</dd>
            </div>
          </dl>
        </>
      )}
      <button className="btn btn-primary" onClick={onExit} autoFocus>
        Terminer <Kbd>↵</Kbd>
      </button>
    </section>
  );
}

