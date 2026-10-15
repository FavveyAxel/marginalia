// Onglet « Carte » d'un livre : la carte du livre, ou celle d'un mouvement de fiche-texte (17).
// En haut, un fil d'Ariane « Livre › II. Mouvement » et un petit sélecteur des cartes de mouvement
// (affiché seulement si le livre a des mouvements).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Network, Plus } from 'lucide-react';
import { useStore } from '../../../../lib/store';
import { boardSource } from '../../BoardCanvas';
import { movementMaps } from '../../model/actions';
import { highlightsInMovement } from '../../model/movements';
import { goToMovementMap, movementShort, useMapChoice } from '../movement/movement';
import { MapStage } from './MapStage';
import './stage.css';

function MovementStrip({ bookId, current }: { bookId: string; current: string | null }) {
  const book = useStore((s) => s.books.find((b) => b.id === bookId));
  const studies = useStore(useShallow((s) => s.studies.filter((x) => x.bookId === bookId)));
  // Re-rendu quand une carte de mouvement apparaît ou change de titre.
  useStore(useShallow((s) => Object.keys(s.maps).filter((k) => s.maps[k].kind === 'movement' && s.maps[k].bookId === bookId)));
  const map = useStore((s) => (current ? s.maps[current] : undefined));
  const toPlace = useStore((s) => {
    if (!map?.studyId) return 0;
    const st = s.studies.find((x) => x.id === map.studyId);
    if (!st || !map.movementId) return 0;
    // Même compte que la section « Dans ce mouvement » du tiroir « À placer ».
    const placed = new Set(map.nodes.map((n) => n.highlightId));
    return highlightsInMovement(st, map.movementId, s.highlights).filter((h) => !placed.has(h.id)).length;
  });
  const choose = useMapChoice((s) => s.choose);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  const groups = [...studies]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((st) => ({ st, list: movementMaps(st.id) }))
    .filter((g) => g.list.length);
  if (!groups.length && !current) return null;
  const existing = groups.reduce((n, g) => n + g.list.filter((x) => x.key).length, 0);
  return (
    <div className="map-strip" data-testid="map-strip">
      <nav className="map-crumbs" aria-label="Fil d’Ariane">
        {current && map ? (
          <>
            <button className="map-crumb map-crumb-back" onClick={() => choose(bookId, null)} title="Revenir à la carte du livre" data-testid="crumb-book">
              <ChevronLeft size={14} />
              <span className="truncate">{book?.title ?? 'Livre'}</span>
            </button>
            <ChevronRight size={13} className="map-crumb-sep" />
            <span className="map-crumb map-crumb-cur truncate" data-testid="crumb-movement">
              {movementShort(map)}
            </span>
          </>
        ) : (
          <span className="map-crumb map-crumb-cur">
            <Network size={14} /> Carte du livre
          </span>
        )}
      </nav>
      {current && toPlace > 0 && (
        <span className="map-strip-hint" data-testid="movement-to-place">
          {toPlace} extrait{toPlace > 1 ? 's' : ''} du mouvement à placer
        </span>
      )}
      <span className="spacer" />
      <div className="map-strip-pick" ref={ref}>
        <button className={`map-strip-btn ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} data-testid="movement-picker">
          Cartes de mouvement{existing ? <i>{existing}</i> : null}
          <ChevronDown size={13} />
        </button>
        {open && (
          <div className="map-strip-menu floating anim-scale" role="menu">
            <button role="menuitem" className="menu-item" onClick={() => (choose(bookId, null), setOpen(false))}>
              <span className="map-strip-check">{!current && <Check size={13} />}</span>
              <span className="truncate">Carte du livre</span>
            </button>
            {groups.map(({ st, list }) => (
              <div key={st.id}>
                <div className="map-menu-title truncate">{st.title || 'Fiche-texte'}</div>
                {list.map((mv) => (
                  <button
                    key={mv.movementId}
                    role="menuitem"
                    className={`menu-item ${mv.key ? '' : 'is-new'}`}
                    data-movement={mv.movementId}
                    onClick={() => {
                      setOpen(false);
                      goToMovementMap(st.id, mv.movementId);
                    }}
                  >
                    <span className="map-strip-check">{mv.key && mv.key === current ? <Check size={13} /> : !mv.key ? <Plus size={12} /> : null}</span>
                    <span className="truncate">{mv.title.replace(/^.* — /, '')}</span>
                    {!mv.key && <small>créer</small>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReaderMapTab({ bookId }: { bookId: string }) {
  const chosen = useMapChoice((s) => s.byBook[bookId] ?? null);
  // Carte de mouvement disparue (corbeille) ou d'un autre livre : retour à la carte du livre.
  const valid = useStore((s) => !!chosen && s.maps[chosen]?.kind === 'movement' && s.maps[chosen]?.bookId === bookId);
  const current = valid ? chosen : null;
  const source = useMemo(() => (current ? boardSource(current) : ({ kind: 'book', bookId } as const)), [current, bookId]);
  return (
    <div className="map-tab">
      <MovementStrip bookId={bookId} current={current} />
      <div className="map-tab-body">
        <MapStage mapKey={current ?? bookId} source={source} bookId={bookId} compareFrom={bookId} />
      </div>
    </div>
  );
}
