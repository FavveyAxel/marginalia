// Miniature d'une carte : ses cartes (rectangles teintés) et ses liens, à l'échelle.
// Partagée par les espaces de travail et la vue « Cartes ».
import { useStore } from '../../../lib/store';
import type { ArgumentMap } from '../../../lib/types';
import './BoardThumb.css';

/** Miniature d'une carte libre : ses cartes (rectangles teintés) et ses liens, à l'échelle. */
export function BoardThumb({ map }: { map: ArgumentMap }) {
  const highlights = useStore((s) => s.highlights);
  const W = 120;
  const H = 80;
  if (!map.nodes.length)
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="ws-doc-board" aria-hidden="true">
        <rect x="38" y="28" width="44" height="24" rx="4" className="ws-board-empty" />
      </svg>
    );
  const NW = 280;
  const NH = 110;
  const xs = map.nodes.map((n) => n.x);
  const ys = map.nodes.map((n) => n.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const bw = Math.max(...xs) + NW - x0;
  const bh = Math.max(...ys) + NH - y0;
  const k = Math.min((W - 8) / bw, (H - 8) / bh, 0.2);
  const ox = (W - bw * k) / 2;
  const oy = (H - bh * k) / 2;
  const pos = new Map(map.nodes.map((n) => [n.id, { x: ox + (n.x - x0) * k, y: oy + (n.y - y0) * k }]));
  const cat = new Map(highlights.map((h) => [h.id, h.category]));
  const fill = (hid: string | null, color?: string) => {
    const c = hid ? cat.get(hid) : null;
    return c ? `var(--cat-${c})` : color ? (color.startsWith('--') ? `var(${color})` : color) : 'var(--cat-these)';
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ws-doc-board" aria-hidden="true" data-testid="board-thumb">
      {map.edges.map((e) => {
        const a = pos.get(e.source);
        const b = pos.get(e.target);
        if (!a || !b) return null;
        return <line key={e.id} x1={a.x + (NW * k) / 2} y1={a.y + (NH * k) / 2} x2={b.x + (NW * k) / 2} y2={b.y + (NH * k) / 2} />;
      })}
      {map.nodes.slice(0, 80).map((n) => {
        const p = pos.get(n.id)!;
        return <rect key={n.id} x={p.x} y={p.y} width={Math.max(6, NW * k)} height={Math.max(4, NH * k)} rx={Math.max(1, 6 * k)} style={{ ['--f' as string]: fill(n.highlightId, n.color) }} />;
      })}
    </svg>
  );
}
