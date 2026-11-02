// Vignette d'une vidéo dans la bibliothèque : sa miniature (style Normal) ou une cassette (style
// Skeuomorphisme), dont la bande passe d'une bobine à l'autre à mesure qu'on regarde.
import type { CSSProperties } from 'react';
import { Play } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { Book } from '../../lib/types';
import { paletteFor } from '../library/BookCover';
import { PROVIDER_LABEL, fmtDuration, videoProgress } from './video';
import './video.css';

/** Couleur de l'étiquette de la cassette (comme celle d'une couverture). */
const BANDS = ['#d9a21b', '#3b9a5f', '#d4556b', '#4f7fc4', '#8c63d9', '#c8693a'];
export const bandOf = (id: string) => BANDS[Math.abs(paletteFor(id).bg.length + id.charCodeAt(0) + id.charCodeAt(id.length - 1)) % BANDS.length];

function Reel({ side, size }: { side: 'l' | 'r'; size: number }) {
  return (
    <>
      <span className={`vc-spool vc-spool-${side}`} style={{ width: size, height: size }} />
      <span className={`vc-hub vc-hub-${side}`} />
    </>
  );
}

export function Cassette({ book, compact }: { book: Book; compact?: boolean }) {
  const w = videoProgress(book);
  const band = bandOf(book.id);
  const provider = book.video ? PROVIDER_LABEL[book.video.provider] : 'Vidéo';
  const dur = fmtDuration(book.video?.duration);
  return (
    <span className={`vc-cassette ${compact ? 'is-compact' : ''}`} aria-hidden="true" data-testid="video-cassette">
      <span className="vc-screw tl" />
      <span className="vc-screw tr" />
      <span className="vc-screw bl" />
      <span className="vc-screw br" />
      <span className="vc-label" style={{ ['--band' as string]: band }}>
        <span className="vc-label-title">{book.title}</span>
        <span className="vc-label-meta">
          <span className="vc-label-author">{book.author}</span>
          <span className="vc-label-src">{[provider, dur].filter(Boolean).join(' · ')}</span>
        </span>
      </span>
      <span className="vc-window">
        <span className="vc-tape" />
        <Reel side="l" size={Math.round(30 + (1 - w) * 22)} />
        <Reel side="r" size={Math.round(30 + w * 22)} />
        <span className="vc-glare" />
      </span>
      <span className="vc-grip" />
    </span>
  );
}

export function VideoThumb({ book }: { book: Book }) {
  const dur = fmtDuration(book.video?.duration);
  const p = paletteFor(book.id);
  return (
    <span className="vt-thumb" aria-hidden="true" data-testid="video-thumb" style={book.cover ? undefined : ({ background: p.bg, color: p.ink } as CSSProperties)}>
      {book.cover ? <img src={book.cover} alt="" draggable={false} /> : <span className="vt-thumb-title">{book.title}</span>}
      <span className="vt-play">
        <Play size={16} fill="currentColor" />
      </span>
      {dur && <span className="vt-dur">{dur}</span>}
    </span>
  );
}

/** Barre d'avancement sous la vignette. */
export function VideoProgress({ book }: { book: Book }) {
  const w = videoProgress(book);
  const pct = Math.round(w * 100);
  return (
    <span className="vt-progress" role="progressbar" aria-label="Avancement de la vidéo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} data-testid="video-progress">
      <span style={{ width: `${pct}%`, background: bandOf(book.id) }} />
    </span>
  );
}

/** Où l'on en est : « 33 min sur 52 », « Vue en entier », « Pas encore regardée ». */
export function watchedLabel(book: Book): string {
  const v = book.video;
  if (!v) return '';
  const w = videoProgress(book);
  if (w >= 0.99) return 'Vue en entier';
  if (!v.position) return 'Pas encore regardée';
  const pos = Math.round(v.position / 60);
  return v.duration ? `${pos} min sur ${fmtDuration(v.duration)}` : `${pos} min regardées`;
}

/** Vignette selon le style de l'app. */
export function VideoCover({ book, compact }: { book: Book; compact?: boolean }) {
  const skeuo = useStore((s) => s.settings.appStyle === 'skeuo');
  return skeuo ? <Cassette book={book} compact={compact} /> : <VideoThumb book={book} />;
}
