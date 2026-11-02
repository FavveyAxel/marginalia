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

/** Décalage final (px) : le boîtier glisse d'autant à gauche, la cassette d'autant à droite. */
const SHIFT = 78;
const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';
const EASE_INOUT = 'cubic-bezier(.65,0,.35,1)';
const POSE = (x: number, y: number, r: number, sx: number, sy = sx) => `translate(${x}px, ${y}px) rotate(${r}deg) scale(${sx}, ${sy})`;

function OutLayer({ book, from, onBack, onOpen }: { book: Book; from: DOMRect; onBack(): void; onOpen(): void }) {
  const [phase, setPhase] = useState<'in' | 'out' | 'closing' | 'back'>('in');
  const boxRef = useRef<HTMLSpanElement>(null);
  const casRef = useRef<HTMLSpanElement>(null);
  const busy = useRef(true);
  // Couché dans la pile (tranche vers soi) : sa hauteur est la longueur de la tranche. Deux poses :
  // « mince », exactement la forme de la tranche ; « épais », le boîtier soulevé de la pile, à sa vraie
  // épaisseur (même échelle dans les deux sens : la rotation qui suit ne déforme rien).
  const flatPoses = (el: HTMLElement) => {
    const r = el.getBoundingClientRect(); // sans transformation (mesuré avant toute animation)
    const x = from.left + from.width / 2 - (r.left + r.width / 2);
    const y = from.top + from.height / 2 - (r.top + r.height / 2);
    const s = from.width / r.height;
    return { thin: POSE(x, y, -90, from.height / r.width, s), thick: POSE(x + 8, y - (r.width * s - from.height) / 2 - 6, -90, s, s) };
  };
  const pose = useRef({ thin: '', thick: '' });

  // Un seul mouvement continu : le boîtier se redresse en venant au centre ; avant qu'il ne soit posé,
  // la cassette commence à glisser hors du boîtier (sans pivoter : on voit déjà tout sur la jaquette).
  useEffect(() => {
    const box = boxRef.current;
    const cas = casRef.current;
    if (!box || !cas) return;
    // Mesure sans animation en cours (un effet relancé ne doit pas mesurer un boîtier déjà en vol).
    box.getAnimations().forEach((a) => a.cancel());
    cas.getAnimations().forEach((a) => a.cancel());
    pose.current = flatPoses(box);
    const k = reduced() ? 0 : 1;
    const total = 1150 * k;
    const landed = 0.52;
    box.animate(
      [
        { transform: pose.current.thin, easing: 'cubic-bezier(.3,.6,.4,1)' },
        { transform: pose.current.thick, offset: 0.1, easing: EASE_OUT },
        { transform: POSE(0, 0, 0, 1), offset: landed, easing: EASE_OUT },
        { transform: POSE(-SHIFT, 0, 0, 1) },
      ],
      { duration: total, fill: 'forwards' },
    );
    cas.animate(
      [
        { transform: 'translateX(0px)', opacity: 0 },
        { transform: 'translateX(0px)', opacity: 0, offset: landed - 0.01 },
        { transform: 'translateX(0px)', opacity: 1, offset: landed, easing: EASE_OUT },
        { transform: `translateX(${SHIFT}px)`, opacity: 1 },
      ],
      { duration: total, fill: 'forwards' },
    );
    const t1 = window.setTimeout(() => setPhase('out'), 640 * k);
    const t2 = window.setTimeout(() => (busy.current = false), total);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      box.getAnimations().forEach((a) => a.cancel());
      cas.getAnimations().forEach((a) => a.cancel());
    };
  }, [from]);

  // Rangement, même mouvement à l'envers : la cassette rentre, et le boîtier repart vers la pile sans attendre.
  const back = async () => {
    if (busy.current) return;
    busy.current = true;
    const box = boxRef.current;
    const cas = casRef.current;
    const k = reduced() ? 0 : 1;
    const total = 940 * k;
    setPhase('closing');
    if (box && cas) {
      box.animate(
        [
          { transform: POSE(-SHIFT, 0, 0, 1), easing: EASE_INOUT },
          { transform: POSE(0, 0, 0, 1), offset: 0.38, easing: 'cubic-bezier(.5,0,.3,1)' },
          { transform: pose.current.thick, offset: 0.86, easing: 'cubic-bezier(.4,0,.6,1)' },
          { transform: pose.current.thin },
        ],
        { duration: total, fill: 'forwards' },
      );
      cas.animate(
        [
          { transform: `translateX(${SHIFT}px)`, opacity: 1, easing: EASE_INOUT },
          { transform: 'translateX(0px)', opacity: 1, offset: 0.38 },
          { transform: 'translateX(0px)', opacity: 0, offset: 0.39 },
          { transform: 'translateX(0px)', opacity: 0 },
        ],
        { duration: total, fill: 'forwards' },
      );
    }
    await wait(360 * k);
    setPhase('back');
    await wait(580 * k);
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
          <span ref={casRef} className="vs-cassette">
            <span className="vs-cassette-in">
              <Cassette book={book} />
            </span>
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
