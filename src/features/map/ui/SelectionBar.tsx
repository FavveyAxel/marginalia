// Petite barre flottante au-dessus d'une sélection de cartes : aligner, répartir, colorer, supprimer.
import type { CSSProperties, ReactNode } from 'react';
import { NodeToolbar, Position } from '@xyflow/react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Trash2,
} from 'lucide-react';
import { fmtKeys } from '../../../lib/keys';
import type { AlignKind } from './geom';
import { IDEA_COLORS } from './ctx';

export const ALIGN_ACTIONS: { id: AlignKind; label: string; icon: ReactNode }[] = [
  { id: 'left', label: 'Aligner à gauche', icon: <AlignStartVertical size={15} /> },
  { id: 'center', label: 'Centrer horizontalement', icon: <AlignCenterVertical size={15} /> },
  { id: 'right', label: 'Aligner à droite', icon: <AlignEndVertical size={15} /> },
  { id: 'top', label: 'Aligner en haut', icon: <AlignStartHorizontal size={15} /> },
  { id: 'middle', label: 'Centrer verticalement', icon: <AlignCenterHorizontal size={15} /> },
  { id: 'bottom', label: 'Aligner en bas', icon: <AlignEndHorizontal size={15} /> },
  { id: 'hspread', label: 'Répartir horizontalement', icon: <AlignHorizontalDistributeCenter size={15} /> },
  { id: 'vspread', label: 'Répartir verticalement', icon: <AlignVerticalDistributeCenter size={15} /> },
];

export function SelectionBar({
  ids,
  ideaCount,
  visible,
  onAlign,
  onColor,
  onDelete,
  extra,
}: {
  ids: string[];
  ideaCount: number;
  visible: boolean;
  onAlign(k: AlignKind): void;
  onColor(c: string | undefined): void;
  onDelete(): void;
  /** Boutons ajoutés par d'autres fonctionnalités (ex. « Encadrer dans une zone »), avant Supprimer. */
  extra?: ReactNode;
}) {
  return (
    <NodeToolbar nodeId={ids} isVisible={visible} position={Position.Top} offset={14}>
      <div className="map-selbar anim-scale nodrag nopan" role="toolbar" aria-label="Sélection" data-testid="map-selbar">
        <span className="map-selbar-count">{ids.length} cartes</span>
        <span className="map-bar-sep" />
        {ALIGN_ACTIONS.map((a, i) => (
          <span key={a.id} style={{ display: 'contents' }}>
            {i === 6 && <span className="map-bar-sep" />}
            <button className="icon-btn sm" data-align={a.id} title={a.label} aria-label={a.label} onClick={() => onAlign(a.id)} disabled={a.id.endsWith('spread') && ids.length < 3}>
              {a.icon}
            </button>
          </span>
        ))}
        {ideaCount > 0 && (
          <>
            <span className="map-bar-sep" />
            {IDEA_COLORS.map((c) => (
              <button
                key={c.label}
                className="map-selbar-swatch"
                data-color={c.id ?? 'jaune'}
                title={`Idées en ${c.label.toLowerCase()}`}
                aria-label={`Colorer les idées : ${c.label}`}
                style={{ '--c': c.id ? `var(${c.id})` : 'var(--cat-these)' } as CSSProperties}
                onClick={() => onColor(c.id)}
              />
            ))}
          </>
        )}
        {extra && (
          <>
            <span className="map-bar-sep" />
            {extra}
          </>
        )}
        <span className="map-bar-sep" />
        <button className="icon-btn sm map-danger" data-act="delete-selection" title={fmtKeys('Supprimer les cartes (⌫)')} aria-label="Supprimer les cartes" onClick={onDelete}>
          <Trash2 size={15} />
        </button>
      </div>
    </NodeToolbar>
  );
}
