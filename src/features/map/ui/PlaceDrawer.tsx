// Tiroir « À placer » : extraits du livre pas encore posés sur la carte.
import { type CSSProperties } from 'react';
import { GripVertical, PanelLeft, Plus, X } from 'lucide-react';
import { CATEGORIES, catColor, kindColor, kindLabel, kindOf, type ExtractKind } from '../../../lib/categories';
import { locatorOf } from '../../../lib/citation';
import type { Highlight } from '../../../lib/types';

export function PlaceDrawer({
  open,
  highlights,
  unplaced,
  filter,
  setFilter,
  onOpen,
  onClose,
  onAdd,
  bookOf,
}: {
  open: boolean;
  highlights: Highlight[];
  unplaced: Highlight[];
  filter: ExtractKind | null;
  setFilter(f: ExtractKind | null): void;
  onOpen(): void;
  onClose(): void;
  onAdd(hid: string): void;
  /** Carte libre : nom court du livre de l'extrait. */
  bookOf?(h: Highlight): string | undefined;
}) {
  if (!open)
    return (
      <button className="map-drawer-open anim-fade" onClick={onOpen} data-testid="map-drawer-open">
        <PanelLeft size={14} /> À placer
        {unplaced.length > 0 && <span>{unplaced.length}</span>}
      </button>
    );
  const shown = unplaced.filter((h) => (filter === null ? true : kindOf(h) === filter));
  const chip = (id: ExtractKind, label: string, dot?: string) => (
    <button key={id} className={`chip ${filter === id ? 'active' : ''}`} onClick={() => setFilter(filter === id ? null : id)}>
      {dot && <span className="cat-dot" style={{ background: dot }} />}
      {label}
    </button>
  );
  return (
    <aside className="map-drawer anim-slide" data-testid="map-drawer">
      <header>
        <b>À placer</b>
        <span className="muted">{unplaced.length}</span>
        <span style={{ flex: 1 }} />
        <button className="icon-btn sm" title="Fermer" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="map-drawer-filters">
        <button className={`chip ${filter === null ? 'active' : ''}`} onClick={() => setFilter(null)}>
          Tous
        </button>
        {CATEGORIES.map((c) => chip(c.id, c.label, catColor(c.id)))}
        {chip('plain', 'Surlignages', 'var(--cat-plain)')}
        {chip('note', 'Notes')}
      </div>
      <div className="map-drawer-list anim-stagger">
        {shown.map((h, i) => (
          <div
            key={h.id}
            className="map-drawer-item lift"
            data-hl={h.id}
            style={{ '--c': kindColor(h), '--i': i } as CSSProperties}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/marginalia-hl', h.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
          >
            <GripVertical size={13} className="grip" />
            <div className="body">
              <span className="cat">{kindLabel(h)}</span>
              <p>{h.text.replace(/\s+/g, ' ').trim()}</p>
              <span className="loc">
                {bookOf?.(h) && <i className="book">{bookOf(h)} · </i>}
                {locatorOf(h)}
              </span>
            </div>
            <button className="icon-btn sm add" title="Ajouter à la carte" onClick={() => onAdd(h.id)}>
              <Plus size={14} />
            </button>
          </div>
        ))}
        {shown.length === 0 && (
          <p className="map-drawer-none muted">
            {highlights.length === 0
              ? bookOf
                ? 'Aucun extrait disponible. Surlignez des passages dans vos livres.'
                : 'Aucun extrait pour ce livre. Surlignez des passages dans la lecture.'
              : unplaced.length === 0
                ? 'Tous les extraits sont sur la carte.'
                : 'Aucun extrait dans cette catégorie.'}
          </p>
        )}
      </div>
    </aside>
  );
}
