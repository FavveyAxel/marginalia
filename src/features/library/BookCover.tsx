import type { CSSProperties } from 'react';
import type { Book } from '../../lib/types';
import './library.css';

type Size = 'xs' | 'sm' | 'md' | 'lg';

/** Dimensions (px) et échelle typographique par taille. Ratio 2:3. */
const DIMS: Record<Size, { w: number; h: number; title: number; author: number; badge: number; radius: number; pad: number }> = {
  xs: { w: 18, h: 26, title: 0, author: 0, badge: 0, radius: 3, pad: 0 },
  sm: { w: 52, h: 78, title: 8.5, author: 5, badge: 0, radius: 4, pad: 5 },
  md: { w: 132, h: 198, title: 17, author: 8.5, badge: 7.5, radius: 5, pad: 13 },
  lg: { w: 200, h: 300, title: 25, author: 11, badge: 9, radius: 6, pad: 19 },
};

/**
 * Petite palette éditoriale de teintes sourdes (couvertures typographiques).
 * Seule exception à la règle « aucune couleur en dur » : ces teintes sont propres
 * à l'objet-livre et identiques dans les trois thèmes.
 */
const PALETTE: { bg: string; ink: string; rule: string }[] = [
  { bg: '#6f7d6a', ink: '#f3efe3', rule: '#d7d3bd' }, // sauge
  { bg: '#8a5a4a', ink: '#f6ece2', rule: '#e2c3ae' }, // terre cuite
  { bg: '#4f6377', ink: '#eef0ee', rule: '#bccad4' }, // ardoise
  { bg: '#7b6a4c', ink: '#f6efdc', rule: '#ddcfa6' }, // ocre sourd
  { bg: '#6b4f5f', ink: '#f4e9ee', rule: '#d8b9c8' }, // prune
  { bg: '#3f5a54', ink: '#ecf0eb', rule: '#a9c4bb' }, // vert de gris
  { bg: '#9a8466', ink: '#2a2218', rule: '#5a4a32' }, // lin
  { bg: '#5a5f78', ink: '#eeeef3', rule: '#b9bcd4' }, // bleu poussière
];

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function paletteFor(id: string) {
  return PALETTE[hashString(id) % PALETTE.length];
}

export function BookCover({ book, size = 'md' }: { book: Book; size?: Size }) {
  const d = DIMS[size];
  const box: CSSProperties = { width: d.w, height: d.h, borderRadius: d.radius };

  if (book.cover) {
    return (
      <span className={`lib-cover lib-cover-img lib-cover-${size}`} style={box} aria-hidden="true">
        <img src={book.cover} alt="" draggable={false} />
      </span>
    );
  }

  const p = paletteFor(book.id);
  const style: CSSProperties = {
    ...box,
    background: p.bg,
    color: p.ink,
    padding: d.pad,
    ['--lib-rule' as string]: p.rule,
  };

  if (size === 'xs') {
    return (
      <span className="lib-cover lib-cover-typo lib-cover-xs" style={style} aria-hidden="true">
        <span className="lib-cover-initial">{(book.title.trim()[0] ?? '·').toUpperCase()}</span>
      </span>
    );
  }

  return (
    <span className={`lib-cover lib-cover-typo lib-cover-${size}`} style={style} aria-hidden="true">
      <span className="lib-cover-rule" />
      <span className="lib-cover-title" style={{ fontSize: d.title }}>
        {book.title}
      </span>
      {book.author && (
        <span className="lib-cover-author" style={{ fontSize: d.author }}>
          {book.author}
        </span>
      )}
      {d.badge > 0 && (
        <span className="lib-cover-badge" style={{ fontSize: d.badge }}>
          {book.format}
        </span>
      )}
    </span>
  );
}
