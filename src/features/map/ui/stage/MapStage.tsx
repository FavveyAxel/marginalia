// Scène d'une carte : la carte (ArgumentMapView), le livre à côté (11), la présentation (14), les
// conversions (16) et la comparaison (13). Leurs boutons vont dans la barre d'outils de la carte
// (point d'extension MapToolbarItem) : « Présenter », « Livre à côté », menu « … ».
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, FilePen, GitCompareArrows, ListTree, MoreHorizontal, Presentation } from 'lucide-react';
import { useStore } from '../../../../lib/store';
import { ArgumentMapView, type MapSource } from '../../ArgumentMapView';
import type { MapToolbarItem } from '../MapToolbar';
import { BookSide, type BookSideAt } from '../passage/BookSide';
import { PassageMenu } from '../passage/PassageMenu';
import { PresentMode } from '../present/PresentMode';
import { ConvertDialog, type ConvertKind } from '../convert/ConvertDialog';
import { CompareDialog } from '../compare/CompareDialog';
import { originWorkspace } from '../compare/compare';
import '../passage/passage.css';
import './stage.css';

const SIDE_KEY = 'marginalia.map.bookside';
const readSide = (): BookSideAt => {
  try {
    return localStorage.getItem(SIDE_KEY) === 'right' ? 'right' : 'left';
  } catch {
    return 'left';
  }
};
const writeSide = (s: BookSideAt) => {
  try {
    localStorage.setItem(SIDE_KEY, s);
  } catch {
    /* stockage indisponible */
  }
};

/** Menu « … » de la barre de la carte : conversions, comparaison. */
function MoreMenu({ entries }: { entries: { id: string; label: string; icon: JSX.Element; hint?: string; disabled?: boolean; run(): void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return (
    <div className="map-bar-menuwrap" ref={ref}>
      <button
        className={`icon-btn map-bar-icon ${open ? 'on' : ''}`}
        data-act="map-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Plus d’actions sur la carte"
        title="Plan, explication, comparaison…"
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="map-bar-menu stage-menu floating anim-scale" role="menu" data-testid="map-more-menu">
          <div className="map-menu-title">À partir de la carte</div>
          {entries.map((e) => (
            <button
              key={e.id}
              role="menuitem"
              className="menu-item map-layout-item"
              data-item={e.id}
              disabled={e.disabled}
              onClick={() => {
                setOpen(false);
                e.run();
              }}
            >
              <span className="map-layout-ico">{e.icon}</span>
              <span className="map-layout-txt">
                <b>{e.label}</b>
                {e.hint && <small>{e.hint}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MapStage({
  mapKey,
  source,
  bookId,
  compareFrom,
}: {
  mapKey: string;
  source: MapSource;
  /** Livre proposé dans le panneau « Livre à côté » (null : choisir). */
  bookId: string | null;
  /** Livre de départ de « Comparer avec un autre livre… » (absent : pas de comparaison). */
  compareFrom?: string | null;
}) {
  const [side, setSide] = useState<BookSideAt | null>(null);
  const [paneBook, setPaneBook] = useState<string | null>(bookId);
  const [presenting, setPresenting] = useState(false);
  const [convert, setConvert] = useState<ConvertKind | null>(null);
  const [comparing, setComparing] = useState(false);
  const count = useStore((s) => s.maps[mapKey]?.nodes.length ?? 0);
  useEffect(() => setPaneBook(bookId), [bookId]);

  const toggleBook = () => setSide((s) => (s ? null : readSide()));
  const tools = useMemo<MapToolbarItem[]>(
    () => [
      {
        id: 'present',
        order: 40,
        group: 'stage',
        node: (
          <button className="btn btn-ghost btn-sm" data-act="present" onClick={() => setPresenting(true)} disabled={!count} title="Présenter la carte étape par étape (lecture guidée, plein écran)">
            <Presentation size={14} /> <span className="map-bar-lbl">Présenter</span>
          </button>
        ),
      },
      {
        id: 'book-side',
        order: 41,
        group: 'stage',
        node: (
          <button
            className={`btn btn-ghost btn-sm ${side ? 'active' : ''}`}
            data-act="book-side"
            aria-pressed={!!side}
            onClick={toggleBook}
            title="Ouvrir le texte du livre à côté de la carte : glissez un passage sélectionné sur la carte"
          >
            <BookOpenText size={14} /> <span className="map-bar-lbl">Livre à côté</span>
          </button>
        ),
      },
      {
        id: 'more',
        order: 42,
        group: 'stage',
        node: (
          <MoreMenu
            entries={[
              { id: 'plan', label: 'Créer un plan à partir de la carte', hint: 'Arguments → parties, objections → discussion', icon: <ListTree size={15} />, disabled: !count, run: () => setConvert('plan') },
              { id: 'draft', label: 'Rédiger une explication à partir de la carte', hint: 'Brouillon dans l’ordre de la lecture guidée', icon: <FilePen size={15} />, disabled: !count, run: () => setConvert('draft') },
              ...(compareFrom
                ? [{ id: 'compare', label: 'Comparer avec un autre livre…', hint: 'Carte libre : une colonne par auteur', icon: <GitCompareArrows size={15} />, run: () => setComparing(true) }]
                : []),
            ]}
          />
        ),
      },
    ],
    [count, side, compareFrom],
  );

  return (
    <div className={`map-stage ${side ? `book-${side}` : ''}`}>
      {side && (
        <BookSide
          bookId={paneBook}
          at={side}
          onPickBook={setPaneBook}
          onSwap={() => {
            const next = side === 'left' ? 'right' : 'left';
            writeSide(next);
            setSide(next);
          }}
          onClose={() => setSide(null)}
        />
      )}
      <div className="map-stage-map">
        <ArgumentMapView source={source} tools={tools} />
      </div>
      <PassageMenu />
      {presenting && <PresentMode mapKey={mapKey} onClose={() => setPresenting(false)} />}
      {convert && <ConvertDialog mapKey={mapKey} kind={convert} onClose={() => setConvert(null)} />}
      {comparing && compareFrom && <CompareDialog firstId={compareFrom} into={originWorkspace()} onClose={() => setComparing(false)} />}
    </div>
  );
}
