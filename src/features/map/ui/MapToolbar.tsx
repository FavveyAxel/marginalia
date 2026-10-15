// Barre d'outils flottante de la carte : idée, rangement automatique, outil de sélection, cadrage.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, GitFork, Lightbulb, ListOrdered, Maximize2, Columns2, ScanSearch, SquareDashedMousePointer, Wand2 } from 'lucide-react';
import { fmtKeys } from '../../../lib/keys';
import { LAYOUTS, type LayoutKind } from './layouts';

const LAYOUT_ICON: Record<LayoutKind, JSX.Element> = {
  arbre: <GitFork size={15} style={{ transform: 'rotate(180deg)' }} />,
  debat: <Columns2 size={15} />,
  chrono: <ListOrdered size={15} />,
};

export function MapToolbar({
  empty,
  hasSelection,
  selectTool,
  onIdea,
  onLayout,
  onToggleSelect,
  onZoomSelection,
  onFitAll,
}: {
  empty: boolean;
  hasSelection: boolean;
  selectTool: boolean;
  onIdea(): void;
  onLayout(kind: LayoutKind): void;
  onToggleSelect(): void;
  onZoomSelection(): void;
  onFitAll(): void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
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
    <div className="map-bar anim-in" role="toolbar" aria-label="Outils de la carte" ref={ref}>
      <button className="btn btn-ghost btn-sm" data-act="idea" onClick={onIdea} title={fmtKeys('Nouvelle idée (double-clic dans le vide)')}>
        <Lightbulb size={14} /> Idée
      </button>
      <div className="map-bar-menuwrap">
        <button className={`btn btn-ghost btn-sm ${open ? 'active' : ''}`} data-act="organise" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={empty}>
          <Wand2 size={14} /> Ranger <ChevronDown size={12} className="map-bar-caret" />
        </button>
        {open && (
          <div className="map-bar-menu floating anim-scale" role="menu" data-testid="map-layout-menu">
            <div className="map-menu-title">Ranger automatiquement</div>
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                role="menuitem"
                className="menu-item map-layout-item"
                data-layout={l.id}
                onClick={() => {
                  setOpen(false);
                  onLayout(l.id);
                }}
              >
                <span className="map-layout-ico">{LAYOUT_ICON[l.id]}</span>
                <span className="map-layout-txt">
                  <b>{l.label}</b>
                  <small>{l.hint}</small>
                </span>
              </button>
            ))}
            <div className="map-bar-menu-foot">{fmtKeys('⌘Z')} rétablit la disposition précédente</div>
          </div>
        )}
      </div>
      <span className="map-bar-sep" />
      <button
        className={`icon-btn map-bar-icon ${selectTool ? 'on' : ''}`}
        data-act="select-tool"
        aria-pressed={selectTool}
        onClick={onToggleSelect}
        title={fmtKeys('Outil sélection : glisser pour encadrer des cartes (sinon ⇧ + glisser dans le vide)')}
      >
        <SquareDashedMousePointer size={16} />
      </button>
      <button className="icon-btn map-bar-icon" data-act="zoom-selection" onClick={onZoomSelection} disabled={!hasSelection} title={fmtKeys('Zoom sur la sélection (⇧2)')}>
        <ScanSearch size={16} />
      </button>
      <button className="icon-btn map-bar-icon" data-act="fit" onClick={onFitAll} disabled={empty} title={fmtKeys('Tout voir (⇧1)')}>
        <Maximize2 size={15} />
      </button>
    </div>
  );
}
