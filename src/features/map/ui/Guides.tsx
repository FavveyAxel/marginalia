// Lignes guides d'alignement et d'espacement égal, dessinées pendant le glisser (coordonnées de la carte).
import { ViewportPortal } from '@xyflow/react';
import type { Guide } from './geom';

export function Guides({ guides }: { guides: Guide[] }) {
  if (!guides.length) return null;
  return (
    <ViewportPortal>
      <svg className="map-guides" style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }} aria-hidden>
        {guides.map((g, i) =>
          g.kind === 'line' ? (
            <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} className="map-guide-line" vectorEffect="non-scaling-stroke" />
          ) : (
            <g key={i} className="map-guide-gap">
              <line x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} vectorEffect="non-scaling-stroke" />
              {g.x1 === g.x2 ? (
                <>
                  <line x1={g.x1 - 5} y1={g.y1} x2={g.x1 + 5} y2={g.y1} vectorEffect="non-scaling-stroke" />
                  <line x1={g.x2 - 5} y1={g.y2} x2={g.x2 + 5} y2={g.y2} vectorEffect="non-scaling-stroke" />
                </>
              ) : (
                <>
                  <line x1={g.x1} y1={g.y1 - 5} x2={g.x1} y2={g.y1 + 5} vectorEffect="non-scaling-stroke" />
                  <line x1={g.x2} y1={g.y2 - 5} x2={g.x2} y2={g.y2 + 5} vectorEffect="non-scaling-stroke" />
                </>
              )}
            </g>
          ),
        )}
      </svg>
    </ViewportPortal>
  );
}
