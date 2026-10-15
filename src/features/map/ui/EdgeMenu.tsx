// Menu d'un lien : relation, force, co-prémisses, suppression.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, Link2, Trash2, Unlink } from 'lucide-react';
import { RELATIONS } from '../../../lib/categories';
import { useFloating } from '../../../components/ui';
import type { EdgeStrength, MapEdge, RelationId } from '../../../lib/types';
import { EdgeNoteField } from './EdgeNote';

export interface EdgeMenuState {
  edgeId: string;
  x: number;
  y: number;
  fresh: boolean;
}

const STRENGTHS: { id: EdgeStrength; label: string }[] = [
  { id: 1, label: 'Faible' },
  { id: 2, label: 'Moyen' },
  { id: 3, label: 'Fort' },
];

export function EdgeMenu({
  menu,
  edges,
  titleOf,
  onClose,
  onRelation,
  onStrength,
  onDelete,
  onGroupWith,
  onUngroup,
  onNote,
}: {
  menu: EdgeMenuState;
  edges: MapEdge[];
  titleOf(nodeId: string): string;
  onClose(): void;
  onRelation(r: RelationId): void;
  onStrength(s: EdgeStrength): void;
  onDelete(): void;
  onGroupWith(otherId: string): void;
  onUngroup(): void;
  /** 20. Note du lien (« Pourquoi ? ») ; absent : pas de champ. */
  onNote?(note: string): void;
}) {
  const edge = edges.find((e) => e.id === menu.edgeId);
  const [view, setView] = useState<'main' | 'group'>('main');
  const anchor = useMemo(() => new DOMRect(menu.x, menu.y, 0, 0), [menu.x, menu.y]);
  const [setRef, style] = useFloating(anchor, 'below');
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  if (!edge) return null;
  const strength = edge.strength ?? 2;
  const mates = edges.filter((e) => e.id !== edge.id && e.target === edge.target && !(edge.groupId && e.groupId === edge.groupId));
  const inGroup = !!edge.groupId && edges.filter((e) => e.target === edge.target && e.groupId === edge.groupId).length > 1;
  return (
    <div
      className="floating map-menu anim-scale"
      data-testid="map-edge-menu"
      ref={(el) => {
        ref.current = el;
        setRef(el);
      }}
      style={style}
    >
      {view === 'main' ? (
        <>
          <div className="map-menu-title">{menu.fresh ? 'Quelle relation ?' : 'Relation'}</div>
          <div className="map-menu-sub truncate">
            {titleOf(edge.source)} <b>→</b> {titleOf(edge.target)}
          </div>
          {RELATIONS.map((r) => (
            <button key={r.id} className="menu-item map-menu-rel" data-rel={r.id} onClick={() => onRelation(r.id)}>
              <span className="map-menu-swatch" style={{ '--c': `var(${r.cssVar})` } as CSSProperties} data-dashed={r.dashed} />
              {r.label}
              {edge.relation === r.id && <Check size={13} style={{ marginLeft: 'auto' }} />}
            </button>
          ))}
          <div className="divider" />
          <div className="map-menu-title">Force du lien</div>
          <div className="map-strength" role="radiogroup" aria-label="Force du lien">
            {STRENGTHS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={strength === s.id}
                className={strength === s.id ? 'on' : ''}
                data-strength={s.id}
                onClick={() => onStrength(s.id)}
              >
                <svg width="22" height="10" aria-hidden>
                  <line x1="2" y1="5" x2="20" y2="5" strokeWidth={s.id === 1 ? 1.2 : s.id === 2 ? 2 : 3.2} strokeLinecap="round" />
                </svg>
                {s.label}
              </button>
            ))}
          </div>
          {onNote && (
            <>
              <div className="divider" />
              <EdgeNoteField key={edge.id} note={edge.note ?? ''} onSave={onNote} />
            </>
          )}
          <div className="divider" />
          {inGroup ? (
            <button className="menu-item" data-act="ungroup" onClick={onUngroup}>
              <Unlink size={14} /> Délier des co-prémisses
            </button>
          ) : null}
          <button className="menu-item" data-act="group" onClick={() => setView('group')}>
            <Link2 size={14} /> Lier comme co-prémisse avec…
          </button>
          <button className="menu-item map-danger" data-act="delete" onClick={onDelete}>
            <Trash2 size={14} /> Supprimer le lien
          </button>
        </>
      ) : (
        <>
          <div className="map-menu-title">Co-prémisse avec…</div>
          <div className="map-menu-sub">Prémisses qui ne valent qu’ensemble, vers la même conclusion.</div>
          {mates.length === 0 && <div className="map-menu-none">Aucun autre lien n’arrive sur « {titleOf(edge.target)} ». Reliez d’abord un second extrait à la même cible.</div>}
          {mates.map((m) => (
            <button key={m.id} className="menu-item map-menu-mate" onClick={() => onGroupWith(m.id)}>
              <span className="truncate">{titleOf(m.source)}</span>
            </button>
          ))}
          <div className="divider" />
          <button className="menu-item" onClick={() => setView('main')}>
            Retour
          </button>
        </>
      )}
    </div>
  );
}
