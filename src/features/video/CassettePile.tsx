// Étagère (style Skeuomorphisme) : les vidéos en pile, chacune dans son boîtier VHS couché, la tranche
// tournée vers soi (titre, chaîne). Un clic sort le boîtier de la pile : il se redresse au centre
// (jaquette avec la miniature), la cassette glisse hors du boîtier ; « Regarder » ouvre la vidéo, « Remettre en place » la range.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Play, Undo2 } from 'lucide-react';
import type { Book } from '../../lib/types';
import { hashString } from '../library/BookCover';
import { Cassette, bandOf, watchedLabel } from './VideoCover';
import { PROVIDER_LABEL, fmtDuration } from './video';
import './video.css';

/** Boîtiers par pile (au-delà, une seconde pile à côté). */
export const PILE_MAX = 6;
/** Largeur d'une pile sur l'étagère (px, marge comprise). */
export const PILE_W = 236;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Boîtier VHS vu de face : jaquette imprimée (miniature, titre, chaîne) sous le film transparent. */
function VhsCase({ book }: { book: Book }) {
  const v = book.video;
  return (
    <span className="vs-case" style={{ ['--band' as string]: bandOf(book.id) }} aria-hidden="true">
      <span className="vs-jacket">
        <span className="vs-jacket-art">{book.cover ? <img src={book.cover} alt="" draggable={false} /> : <span className="vs-jacket-art-blank" />}</span>
        <span className="vs-jacket-band" />
        <span className="vs-jacket-title">{book.title}</span>
        {book.author && <span className="vs-jacket-author">{book.author}</span>}
        <span className="vs-jacket-foot">{[v ? (v.provider === 'link' ? 'Vidéo' : PROVIDER_LABEL[v.provider]) : 'Vidéo', fmtDuration(v?.duration)].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="vs-film" />
    </span>
  );
}

function OutLayer({ book, from, onBack, onOpen }: { book: Book; from: DOMRect; onBack(): void; onOpen(): void }) {
  const [phase, setPhase] = useState<'in' | 'flown' | 'out' | 'back'>('in');
  const boxRef = useRef<HTMLSpanElement>(null);
  const busy = useRef(true);
  // Boîtier : couché dans la pile (tranche vers soi), il se redresse en venant au centre ; puis la cassette sort.
  const flatPose = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const cx = from.left + from.width / 2 - (r.left + r.width / 2);
    const cy = from.top + from.height / 2 - (r.top + r.height / 2);
    // Couché, le grand côté du boîtier (sa hauteur debout) est la longueur de la tranche.
    return `translate(${cx}px, ${cy}px) rotate(-90deg) scale(${from.width / r.height})`;
  };
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.transform = flatPose(el);
    void el.offsetWidth;
    const fast = reduced();
    el.style.transition = fast ? 'none' : 'transform .6s cubic-bezier(.2,.8,.2,1)';
    el.style.transform = 'none';
    void (async () => {
      await wait(fast ? 0 : 580);
      setPhase('flown');
      await wait(fast ? 0 : 60);
      setPhase('out');
      busy.current = false;
    })();
  }, [from]);

  const back = async () => {
    if (busy.current) return;
    busy.current = true;
    const fast = reduced();
    setPhase('flown'); // la cassette rentre dans son boîtier
    await wait(fast ? 0 : 480);
    setPhase('back');
    const el = boxRef.current;
    if (el) {
      el.style.transition = 'none';
      el.style.transform = 'none';
      const pose = flatPose(el);
      void el.offsetWidth;
      el.style.transition = fast ? 'none' : 'transform .5s cubic-bezier(.4,0,.2,1)';
      el.style.transform = pose;
      await wait(fast ? 0 : 480);
    }
    onBack();
  };
  const open = () => {
    if (busy.current) return;
    onOpen();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        void back();
      } else if (e.key === 'Enter' && phase === 'out') open();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return createPortal(
    <div className={`vs-layer is-${phase}`} data-testid="cassette-out">
      <div className="vs-veil" onClick={() => void back()} />
      <div className="vs-stage">
        <div className="vs-box">
          <span className="vs-cassette">
            <Cassette book={book} />
          </span>
          <span ref={boxRef} className="vs-case-wrap">
            <VhsCase book={book} />
          </span>
        </div>
        <div className="vs-panel">
          <h2>{book.title}</h2>
          <p>{[book.author, watchedLabel(book)].filter(Boolean).join(' · ')}</p>
          <div className="vs-btns">
            <button className="btn" onClick={() => void back()} data-act="cassette-back">
              <Undo2 size={14} /> Remettre en place
            </button>
            <button className="btn btn-primary" onClick={open} data-act="cassette-open" autoFocus>
              <Play size={14} /> Regarder
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CassettePile({
  videos,
  selected,
  showChecks,
  onSelectClick,
  onOpen,
  onContext,
  dragProps,
}: {
  videos: Book[];
  selected(id: string): boolean;
  showChecks: boolean;
  onSelectClick(e: ReactMouseEvent, b: Book): boolean;
  onOpen(b: Book): void;
  onContext(e: ReactMouseEvent, b: Book): void;
  dragProps(b: Book): object;
}) {
  const [out, setOut] = useState<{ book: Book; rect: DOMRect } | null>(null);
  return (
    <div className="vp-pile" role="group" aria-label="Vidéos" data-testid="cassette-pile">
      {videos.map((b, i) => {
        const h = hashString(b.id);
        const dx = ((h % 13) - 6) * 1.2;
        const rot = (((h >> 4) % 9) - 4) * 0.12;
        return (
          <button
            key={b.id}
            type="button"
            className={`vp-tape ${selected(b.id) ? 'selected' : ''} ${out?.book.id === b.id ? 'is-out' : ''}`}
            style={{ ['--dx' as string]: `${dx}px`, ['--rot' as string]: `${rot}deg`, ['--band' as string]: bandOf(b.id), zIndex: videos.length - i }}
            aria-label={`${b.title}${b.author ? ', ' + b.author : ''}, vidéo`}
            title={[b.title, b.author, fmtDuration(b.video?.duration)].filter(Boolean).join(' · ')}
            data-sel-id={b.id}
            data-book={b.id}
            data-testid="cassette-edge"
            onClick={(e) => {
              if (onSelectClick(e, b) || out) return;
              setOut({ book: b, rect: e.currentTarget.getBoundingClientRect() });
            }}
            onContextMenu={(e) => onContext(e, b)}
            {...dragProps(b)}
          >
            <span className="vp-band" aria-hidden="true" />
            <span className="vp-label">
              <span className="vp-title">{b.title}</span>
              {b.author && <span className="vp-author">{b.author}</span>}
            </span>
            <span className="vp-dur" aria-hidden="true">
              {fmtDuration(b.video?.duration)}
            </span>
          </button>
        );
      })}
      {out && (
        <OutLayer
          book={out.book}
          from={out.rect}
          onBack={() => setOut(null)}
          onOpen={() => {
            const b = out.book;
            setOut(null);
            onOpen(b);
          }}
        />
      )}
    </div>
  );
}
