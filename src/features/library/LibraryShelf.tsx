// ─────────────────────────────────────────────────────────────
// Bibliothèque en étagère (style « Skeuomorphisme ») : les livres sont rangés sur la tranche, sur des
// étagères murales. Clic : le livre sort, pivote et montre sa couverture ; « Ouvrir » tourne la
// couverture puis ouvre le lecteur ; « Remettre en place », Échap ou un clic à côté le rangent.
// Sélection, menu contextuel et glisser vers un espace : comme dans la grille.
// ─────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Undo2 } from 'lucide-react';
import type { Book } from '../../lib/types';
import { hashString, paletteFor } from './BookCover';
import { CassettePile, PILE_MAX, PILE_W } from '../video/CassettePile';
import './shelf.css';

type Ink = { c: string; t: string };

// ── Couleur de la tranche : la teinte moyenne de la couverture (sinon la palette de l'app) ──
const inkCache = new Map<string, Ink>();
const inkListeners = new Set<() => void>();
function inkFromCover(book: Book): Ink | null {
  if (!book.cover) return null;
  const key = book.id + ':' + book.cover.length;
  const hit = inkCache.get(key);
  if (hit) return hit;
  if (!inkCache.has(key + '?')) {
    inkCache.set(key + '?', { c: '', t: '' });
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = 12;
        cv.height = 18;
        const ctx = cv.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 12, 18);
        const d = ctx.getImageData(0, 0, 12, 18).data;
        let r = 0;
        let g = 0;
        let b = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) (r += d[i]), (g += d[i + 1]), (b += d[i + 2]);
        r = Math.round(r / n);
        g = Math.round(g / n);
        b = Math.round(b / n);
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        inkCache.set(key, { c: `rgb(${r}, ${g}, ${b})`, t: lum > 150 ? '#2b2620' : '#f3ece0' });
        inkListeners.forEach((f) => f());
      } catch {
        /* image illisible : palette de l'app */
      }
    };
    img.src = book.cover;
  }
  return null;
}
function useInk(book: Book): Ink {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    inkListeners.add(f);
    return () => void inkListeners.delete(f);
  }, []);
  const fromCover = inkFromCover(book);
  if (fromCover) return fromCover;
  const p = paletteFor(book.id);
  return { c: p.bg, t: p.ink };
}

/** Format du livre sur l'étagère : hauteur et épaisseur variées, mais stables (tirées de son identifiant). */
function dimsOf(book: Book) {
  const h = 168 + (hashString(book.id + 'h') % 40);
  const pages = book.pages?.length ?? 0;
  const bySize = Math.log2(Math.max(1, (book.size || 200_000) / 40_000)) * 5;
  const w = Math.round(Math.max(18, Math.min(46, 20 + bySize + (hashString(book.id + 'w') % 9) + pages)));
  return { h, w, d: Math.round(h * 0.66) };
}

const GAP = 2;
const SIDE = 26;

/** Titre et auteur ajustés à la place sur le dos (jamais coupés) ; l'auteur passe dessous sur un dos épais. */
function SpineText({ title, author }: { title: string; author: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const t = ref.current;
    const spine = t?.parentElement;
    if (!t || !spine) return;
    const avail = spine.clientHeight - 40;
    const availW = spine.clientWidth - 6;
    t.classList.toggle('two', spine.clientWidth >= 34);
    let size = 13;
    t.style.fontSize = size + 'px';
    const authorEl = t.querySelector<HTMLElement>('.sh-author');
    if (authorEl) authorEl.style.display = '';
    const fits = () => {
      const r = t.getBoundingClientRect();
      return r.height <= avail && r.width <= availW;
    };
    while (!fits() && size > 8) t.style.fontSize = (size -= 0.5) + 'px';
    if (!fits() && !t.classList.contains('two') && spine.clientWidth >= 26) {
      t.classList.add('two');
      size = 12;
      t.style.fontSize = size + 'px';
      while (!fits() && size > 7.5) t.style.fontSize = (size -= 0.5) + 'px';
    }
    if (!fits() && authorEl) authorEl.style.display = 'none';
  }, [title, author]);
  return (
    <span ref={ref} className="sh-text">
      <span className="sh-title">{title}</span>
      {author && <span className="sh-author">{author}</span>}
    </span>
  );
}

/** Le livre en volume : tranche, couverture (charnière sur le dos), page de titre, dessous, dessus. */
function BookBox({ book, ink, open }: { book: Book; ink: Ink; open?: boolean }) {
  const { h, w, d } = dimsOf(book);
  const pal = paletteFor(book.id);
  const titleRef = useRef<HTMLElement>(null);
  // Titre de couverture : il tient dans la largeur (un mot long réduit la taille).
  useLayoutEffect(() => {
    const b = titleRef.current;
    if (!b) return;
    let size = 17;
    b.style.fontSize = size + 'px';
    const box = b.parentElement!;
    const avail = box.clientWidth * 0.76;
    const widest = () =>
      Math.max(
        ...b.textContent!.split(/\s+/).map((word) => {
          const m = document.createElement('span');
          m.style.cssText = `font:${getComputedStyle(b).font};white-space:nowrap;position:absolute;visibility:hidden`;
          m.textContent = word;
          document.body.appendChild(m);
          const x = m.getBoundingClientRect().width;
          m.remove();
          return x;
        }),
      );
    while ((widest() > avail || b.offsetHeight > box.clientHeight * 0.5) && size > 10) b.style.fontSize = (size -= 0.5) + 'px';
  }, [book.title]);
  const style = { width: w, height: h, '--w': `${w}px`, '--d': `${d}px`, '--c': ink.c, '--t': ink.t } as CSSProperties;
  return (
    <span className={`sh-box ${open ? 'open' : ''}`} style={style}>
      <span className="sh-box-in">
      <span className="sh-face sh-top" />
      <span className="sh-face sh-bottom" />
      <span className="sh-face sh-fore" />
      <span className="sh-face sh-back" />
      <span className="sh-face sh-coverbox">
        <span className="sh-inside">
          <b>{book.title}</b>
          {book.author && <em>{book.author}</em>}
        </span>
        <span
          className={`sh-cover ${book.cover ? 'img' : 'typo'}`}
          style={book.cover ? { backgroundImage: `url(${book.cover})` } : ({ background: pal.bg, color: pal.ink, '--rule': pal.rule } as CSSProperties)}
        >
          {!book.cover && (
            <>
              <i />
              <b ref={titleRef}>{book.title}</b>
              {book.author && <em>{book.author}</em>}
            </>
          )}
          <span className="sh-lining" />
        </span>
      </span>
      <span className="sh-face sh-spine">
        <SpineText title={book.title} author={book.author} />
      </span>
      </span>
    </span>
  );
}

interface ShelfProps {
  books: Book[];
  selected: (id: string) => boolean;
  showChecks: boolean;
  /** Clic avec modificateurs ou en mode « Sélectionner » : true si la sélection l'a traité. */
  onSelectClick(e: ReactMouseEvent, b: Book): boolean;
  onOpen(b: Book): void;
  onContext(e: ReactMouseEvent, b: Book): void;
  dragProps(b: Book): object;
  counts: Record<string, number>;
  /** Vidéos : couchées en pile de cassettes au bout de l'étagère. */
  videos?: Book[];
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Perspective du calque du livre sorti. */
const PERSP = 1400;
/** Livre à sa place (même liste de fonctions que les autres poses : l'interpolation reste propre). */
const REST = 'translate3d(0px, 0px, 0px) scale(1) rotateX(0deg) rotateY(0deg)';

export function LibraryShelf({ books, selected, showChecks, onSelectClick, onOpen, onContext, dragProps, videos = [] }: ShelfProps) {
  const wallRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useLayoutEffect(() => {
    const el = wallRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Rangées : autant de livres que la largeur en tient ; puis les piles de cassettes, au bout.
  const rows = useMemo(() => {
    const inner = Math.max(200, width - SIDE * 2 - 36);
    const out: { books: Book[]; piles: Book[][] }[] = [];
    let row: { books: Book[]; piles: Book[][] } = { books: [], piles: [] };
    let used = 0;
    const room = (w: number) => {
      if ((row.books.length || row.piles.length) && used + w > inner) {
        out.push(row);
        row = { books: [], piles: [] };
        used = 0;
      }
      used += w;
    };
    for (const b of books) {
      room(dimsOf(b).w + GAP);
      row.books.push(b);
    }
    for (let i = 0; i < videos.length; i += PILE_MAX) {
      room(PILE_W);
      row.piles.push(videos.slice(i, i + PILE_MAX));
    }
    if (row.books.length || row.piles.length) out.push(row);
    return out;
  }, [books, videos, width]);

  // ── Livre sorti ──
  // Le livre glisse hors du rang et y rentre vu DE FACE (point de vue posé sur lui) : sa tranche
  // n'apparaît jamais et il ne passe pas par-dessus ses voisins. Le point de vue ne rejoint le
  // centre de l'écran que pendant le vol, quand le livre est déjà sorti.
  const [pulled, setPulled] = useState<{ book: Book; rect: DOMRect } | null>(null);
  const [phase, setPhase] = useState<'out' | 'shown' | 'open' | 'back'>('out');
  const busy = useRef(false);
  const flyRef = useRef<HTMLSpanElement>(null) as React.RefObject<HTMLSpanElement>;
  const stageRef = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>;

  const outOf = (b: Book) => `translate3d(0px, -4px, ${dimsOf(b).d * 0.55}px) scale(1) rotateX(0deg) rotateY(0deg)`;

  const pull = async (b: Book, el: HTMLElement) => {
    if (pulled || busy.current) return;
    busy.current = true;
    const { h, w } = dimsOf(b);
    // Place du livre sur l'étagère, sans le soulèvement du survol.
    const t = getComputedStyle(el).transform;
    const lift = t && t !== 'none' ? new DOMMatrix(t).f : 0;
    const r0 = el.getBoundingClientRect();
    const rect = new DOMRect(r0.left, r0.top - lift, w, h);
    setPulled({ book: b, rect });
    setPhase('out');
    await wait(40);
    const fly = flyRef.current;
    const stage = stageRef.current;
    if (!fly || !stage) return void (busy.current = false);
    // 1. Il glisse hors du rang, droit vers soi.
    fly.style.transition = 'transform .42s cubic-bezier(.3,.7,.3,1)';
    fly.style.transform = outOf(b);
    await wait(400);
    // 2. Vol jusqu'au centre, couverture face à soi ; le point de vue suit.
    const X = innerWidth / 2;
    const Y = innerHeight / 2 - 60;
    const Z = 120;
    const scale = Math.min(1.9, 330 / h) * ((PERSP - Z) / PERSP);
    stage.style.transition = 'perspective-origin .75s cubic-bezier(.2,.8,.2,1)';
    stage.style.perspectiveOrigin = `${X}px ${Y}px`;
    fly.style.transition = 'transform .75s cubic-bezier(.2,.8,.2,1)';
    fly.style.transform = `translate3d(${X - (rect.left + w / 2)}px, ${Y - (rect.top + h / 2)}px, ${Z}px) scale(${scale}) rotateX(16deg) rotateY(-72deg)`;
    await wait(560);
    setPhase('shown');
    busy.current = false;
  };

  const putBack = async () => {
    if (!pulled || busy.current) return;
    busy.current = true;
    const fly = flyRef.current;
    const stage = stageRef.current;
    if (phase === 'open') {
      setPhase('shown');
      await wait(700);
    }
    setPhase('back');
    if (fly && stage) {
      const { rect, book } = pulled;
      // 1. Retour devant sa place, le dos face à soi ; le point de vue revient sur lui.
      stage.style.transition = 'perspective-origin .6s cubic-bezier(.4,0,.2,1)';
      stage.style.perspectiveOrigin = `${rect.left + rect.width / 2}px ${rect.top + rect.height / 2}px`;
      fly.style.transition = 'transform .6s cubic-bezier(.4,0,.2,1)';
      fly.style.transform = outOf(book);
      await wait(600);
      // 2. Il rentre dans le rang, droit.
      fly.style.transition = 'transform .34s cubic-bezier(.5,0,.75,0)';
      fly.style.transform = REST;
      await wait(350);
    }
    setPulled(null);
    setPhase('out');
    busy.current = false;
  };

  const openPulled = async () => {
    if (!pulled || busy.current) return;
    busy.current = true;
    setPhase('open');
    await wait(900);
    const b = pulled.book;
    setPulled(null);
    setPhase('out');
    busy.current = false;
    onOpen(b);
  };

  useEffect(() => {
    if (!pulled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        void putBack();
      } else if (e.key === 'Enter' && phase === 'shown') void openPulled();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div className="sh-wall" ref={wallRef} role="listbox" aria-multiselectable="true" aria-label="Documents" data-testid="lib-shelf">
      {rows.map((row, ri) => (
        <div className="sh-row" key={ri} style={{ '--i': ri } as CSSProperties}>
          {row.books.map((b) => (
            <Spine
              key={b.id}
              book={b}
              hidden={pulled?.book.id === b.id}
              selected={selected(b.id)}
              showChecks={showChecks}
              onClick={(e, el) => {
                if (onSelectClick(e, b)) return;
                void pull(b, el);
              }}
              onContext={(e) => onContext(e, b)}
              drag={dragProps(b)}
            />
          ))}
          {row.piles.map((pile, pi) => (
            <CassettePile
              key={'pile' + pi}
              videos={pile}
              selected={selected}
              showChecks={showChecks}
              onSelectClick={onSelectClick}
              onOpen={onOpen}
              onContext={onContext}
              dragProps={dragProps}
            />
          ))}
          <span className="sh-plank" aria-hidden="true" />
        </div>
      ))}
      {pulled &&
        createPortal(
          <PulledLayer
            book={pulled.book}
            rect={pulled.rect}
            stageRef={stageRef}
            phase={phase}
            flyRef={flyRef}
            onBack={() => void putBack()}
            onOpen={() => void openPulled()}
          />,
          document.body,
        )}
    </div>
  );
}

function Spine({
  book,
  hidden,
  selected,
  showChecks,
  onClick,
  onContext,
  drag,
}: {
  book: Book;
  hidden: boolean;
  selected: boolean;
  showChecks: boolean;
  onClick(e: ReactMouseEvent, el: HTMLElement): void;
  onContext(e: ReactMouseEvent): void;
  drag: object;
}) {
  const ink = useInk(book);
  const { h, w, d } = dimsOf(book);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={`${book.title}${book.author ? ', ' + book.author : ''}`}
      title={`${book.title}${book.author ? ' · ' + book.author : ''}`}
      data-sel-id={book.id}
      data-book={book.id}
      className={`sh-book ${selected ? 'selected' : ''} ${showChecks ? 'selecting' : ''}`}
      style={{ width: w, height: h, visibility: hidden ? 'hidden' : undefined, '--w': `${w}px`, '--d': `${d}px`, '--c': ink.c, '--t': ink.t } as CSSProperties}
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      onClick={(e) => onClick(e, e.currentTarget)}
      onContextMenu={onContext}
      {...drag}
    >
      <span className="sh-face sh-top" />
      <span className="sh-cast" />
      <span className="sh-face sh-spine">
        <SpineText title={book.title} author={book.author} />
      </span>
    </button>
  );
}

function PulledLayer({
  book,
  rect,
  stageRef,
  phase,
  flyRef,
  onBack,
  onOpen,
}: {
  book: Book;
  rect: DOMRect;
  stageRef: React.RefObject<HTMLDivElement>;
  phase: 'out' | 'shown' | 'open' | 'back';
  flyRef: React.RefObject<HTMLSpanElement>;
  onBack(): void;
  onOpen(): void;
}): ReactNode {
  const ink = useInk(book);
  const { h, d } = dimsOf(book);
  const scale = Math.min(1.9, 330 / h);
  const shadowW = d * scale * 1.15;
  const shown = phase === 'shown' || phase === 'open';
  return (
    <div className="sh-layer" data-testid="shelf-pulled">
      <div className={`sh-veil ${phase === 'back' ? '' : 'on'}`} onClick={onBack} />
      <span
        className={`sh-ground ${shown ? 'on' : ''}`}
        style={{ left: innerWidth / 2 - shadowW / 2 - 14, top: innerHeight / 2 - 60 + (h * scale * 1.06) / 2 - 11, width: shadowW }}
      />
      <div
        ref={stageRef}
        className="sh-stage"
        style={{ perspective: `${PERSP}px`, perspectiveOrigin: `${rect.left + rect.width / 2}px ${rect.top + rect.height / 2}px` }}
      >
        <span ref={flyRef} className="sh-fly" style={{ left: rect.left, top: rect.top, transform: REST, transformOrigin: `50% 50% ${-d / 2}px` }}>
          <BookBox book={book} ink={ink} open={phase === 'open'} />
        </span>
      </div>
      <div className={`sh-panel ${shown ? 'on' : ''}`}>
        <h2>{book.title}</h2>
        {book.author && <p>{book.author}</p>}
        <div className="sh-btns">
          <button className="btn" onClick={onBack} data-act="shelf-back">
            <Undo2 size={14} /> Remettre en place
          </button>
          <button className="btn btn-primary" onClick={onOpen} data-act="shelf-open" autoFocus>
            <BookOpen size={14} /> Ouvrir
          </button>
        </div>
      </div>
    </div>
  );
}
