// Liens de la carte : courbes douces, flèches fines, épaisseur selon la force,
// nom de la relation au survol, tracé progressif d'un lien qui vient d'être créé.
import { useMemo, type CSSProperties } from 'react';
import { EdgeLabelRenderer, useStore as useRfStore, type EdgeProps } from '@xyflow/react';
import { RELATIONS, RELATION_BY_ID } from '../../../lib/categories';
import type { EdgeStrength } from '../../../lib/types';
import { NODE_H, NODE_W, useMapCtx, type RelEdgeData } from './ctx';
import type { Pt } from './geom';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Point du bord de `r` en direction de `toward`, et normale sortante du côté touché. */
function exit(r: Rect, toward: Pt, gap = 3): { p: Pt; n: Pt } {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return { p: c, n: { x: 0, y: 1 } };
  const sx = r.w / 2 / Math.abs(dx || 1e-6);
  const sy = r.h / 2 / Math.abs(dy || 1e-6);
  const s = Math.min(sx, sy);
  // Côté touché : vertical (gauche/droite) si sx < sy.
  const n = sx < sy ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
  return { p: { x: c.x + dx * s + n.x * gap, y: c.y + dy * s + n.y * gap }, n };
}

/** Épaisseur du trait selon la force du lien. */
export const STROKE: Record<EdgeStrength, number> = { 1: 1.15, 2: 1.75, 3: 2.75 };
/** Taille de la flèche (unités de la carte) selon la force. */
const ARROW: Record<EdgeStrength, number> = { 1: 9, 2: 11, 3: 14 };

export function useRects(ids: string[]): Rect[] {
  const key = useRfStore((s) =>
    ids
      .map((id) => {
        const n = s.nodeLookup.get(id);
        if (!n) return '0,0,0,0';
        const p = n.internals.positionAbsolute;
        return [p.x, p.y, n.measured.width ?? NODE_W, n.measured.height ?? NODE_H].map((v) => Math.round(v)).join(',');
      })
      .join('|'),
  );
  return useMemo(
    () =>
      key.split('|').map((k) => {
        const [x, y, w, h] = k.split(',').map(Number);
        return { x, y, w, h };
      }),
    [key],
  );
}

/**
 * Faut-il contourner ? Deux cartes alignées (colonne ou rangée) mais séparées par un grand
 * écart, où d'autres cartes s'intercalent typiquement. Côté choisi : droite (colonne) ou haut (rangée).
 */
function bracket(s: Rect, t: Rect): { side: 1 | -1; axis: 'v' | 'h' } | null {
  const ox = Math.min(s.x + s.w, t.x + t.w) - Math.max(s.x, t.x);
  const oy = Math.min(s.y + s.h, t.y + t.h) - Math.max(s.y, t.y);
  const gapY = Math.max(s.y, t.y) - Math.min(s.y + s.h, t.y + t.h);
  const gapX = Math.max(s.x, t.x) - Math.min(s.x + s.w, t.x + t.w);
  if (ox > Math.min(s.w, t.w) * 0.6 && gapY > 110) return { side: 1, axis: 'v' };
  if (oy > Math.min(s.h, t.h) * 0.6 && gapX > 150) return { side: -1, axis: 'h' };
  return null;
}
/** Une autre carte se trouve-t-elle entre deux cartes alignées (couloir du lien droit) ? */
function useBlocked(source: string, target: string): boolean {
  return useRfStore((s) => {
    const rect = (id: string): Rect | null => {
      const n = s.nodeLookup.get(id);
      if (!n) return null;
      const p = n.internals.positionAbsolute;
      return { x: p.x, y: p.y, w: n.measured.width ?? NODE_W, h: n.measured.height ?? NODE_H };
    };
    const a = rect(source);
    const b = rect(target);
    if (!a || !b) return false;
    const br = bracket(a, b);
    if (!br) return false;
    // Couloir : la bande commune aux deux cartes, entre elles.
    const c =
      br.axis === 'v'
        ? { x: Math.max(a.x, b.x) + 8, y: Math.min(a.y + a.h, b.y + b.h), w: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) - 16, h: Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h) }
        : { x: Math.min(a.x + a.w, b.x + b.w), y: Math.max(a.y, b.y) + 8, w: Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), h: Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) - 16 };
    for (const [id, n] of s.nodeLookup) {
      if (id === source || id === target || n.hidden) continue;
      const r = rect(id)!;
      if (r.x < c.x + c.w && c.x < r.x + r.w && r.y < c.y + c.h && c.y < r.y + r.h) return true;
    }
    return false;
  });
}

/** Point de sortie sur le côté droit (colonne) ou le haut (rangée), un peu décalé vers l'autre carte. */
function sideExit(r: Rect, side: 1 | -1, axis: 'v' | 'h', other: Rect): { p: Pt; n: Pt } {
  if (axis === 'v') {
    const toward = other.y > r.y ? 1 : -1;
    return { p: { x: r.x + r.w + 3, y: r.y + r.h / 2 + toward * Math.min(18, r.h / 4) }, n: { x: side, y: 0 } };
  }
  const toward = other.x > r.x ? 1 : -1;
  return { p: { x: r.x + r.w / 2 + toward * Math.min(40, r.w / 4), y: r.y - 3 }, n: { x: 0, y: side } };
}

/**
 * Point d'attache d'un lien isolé : cartes nettement côte à côte → côtés gauche / droit
 * (courbe en S), sinon haut / bas ; le point glisse un peu vers l'autre carte pour que
 * plusieurs liens arrivant du même côté ne se superposent pas.
 */
function smartExit(r: Rect, o: Rect, gap: number): { p: Pt; n: Pt } {
  const gapX = Math.max(r.x, o.x) - Math.min(r.x + r.w, o.x + o.w);
  const gapY = Math.max(r.y, o.y) - Math.min(r.y + r.h, o.y + o.h);
  const oc = center(o);
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  if (gapX > 60 || (gapX > 0 && gapX >= gapY)) {
    const s = oc.x > r.x + r.w / 2 ? 1 : -1;
    const y = clamp(oc.y, r.y + r.h * 0.32, r.y + r.h * 0.68);
    return { p: { x: s > 0 ? r.x + r.w + gap : r.x - gap, y }, n: { x: s, y: 0 } };
  }
  if (gapY > 0) {
    const s = oc.y > r.y + r.h / 2 ? 1 : -1;
    const x = clamp(oc.x, r.x + r.w * 0.3, r.x + r.w * 0.7);
    return { p: { x, y: s > 0 ? r.y + r.h + gap : r.y - gap }, n: { x: 0, y: s } };
  }
  return exit(r, oc, gap);
}

const bez = (a: Pt, c1: Pt, c2: Pt, b: Pt) => `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
const bezMid = (a: Pt, c1: Pt, c2: Pt, b: Pt): Pt => ({ x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 });
const add = (p: Pt, n: Pt, k: number): Pt => ({ x: p.x + n.x * k, y: p.y + n.y * k });

export function RelEdge({ id, source, target, data, selected }: EdgeProps) {
  const ctx = useMapCtx();
  const d = data as RelEdgeData;
  const rel = RELATION_BY_ID[d.relation] ?? RELATION_BY_ID.soutient;
  const strength = d.strength ?? 2;
  const grouped = d.groupSources.length > 1;
  const rects = useRects([source, target, ...d.groupSources]);
  const blocked = useBlocked(source, target);
  const [src, tgt, ...sibs] = rects;
  const color = `var(${rel.cssVar})`;
  const width = STROKE[strength] + (selected ? 0.75 : 0);
  const marker = `url(#map-arrow-${rel.id}-${strength})`;

  let path: string;
  let mid: Pt;
  let trunk: { b: Pt; j: Pt } | null = null;
  if (grouped) {
    const sc = sibs.map(center);
    const avg = { x: sc.reduce((a, p) => a + p.x, 0) / sc.length, y: sc.reduce((a, p) => a + p.y, 0) / sc.length };
    const { p: b } = exit(tgt, avg, 2);
    const len = Math.hypot(avg.x - b.x, avg.y - b.y) || 1;
    const u = { x: (avg.x - b.x) / len, y: (avg.y - b.y) / len };
    const reach = Math.min(64, len / 2);
    const j = add(b, u, reach);
    const { p: p1, n: n1 } = exit(src, j, 3);
    const k = Math.min(70, Math.hypot(j.x - p1.x, j.y - p1.y) * 0.4);
    const c1 = add(p1, n1, k);
    const c2 = add(j, u, k * 0.6);
    path = bez(p1, c1, c2, j);
    mid = bezMid(p1, c1, c2, j);
    trunk = { b, j };
  } else if (blocked && bracket(src, tgt)) {
    // Cartes l'une au-dessus de l'autre mais éloignées (colonne d'un rangement) : le lien
    // contourne par le côté au lieu de passer sous les cartes intermédiaires.
    const { side, axis } = bracket(src, tgt)!;
    const a = sideExit(src, side, axis, tgt);
    const b = sideExit(tgt, side, axis, src);
    const span = axis === 'v' ? Math.abs(b.p.y - a.p.y) : Math.abs(b.p.x - a.p.x);
    const k = Math.max(40, Math.min(110, span * 0.28));
    const c1 = add(a.p, a.n, k);
    const c2 = add(b.p, b.n, k);
    path = bez(a.p, c1, c2, b.p);
    mid = bezMid(a.p, c1, c2, b.p);
  } else {
    const a = smartExit(src, tgt, 3);
    const b = smartExit(tgt, src, 4);
    const dist = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y);
    const k = Math.max(18, Math.min(90, dist * 0.42));
    const c1 = add(a.p, a.n, k);
    const c2 = add(b.p, b.n, k);
    path = bez(a.p, c1, c2, b.p);
    mid = bezMid(a.p, c1, c2, b.p);
  }
  const showLabel = d.hover || !!selected;
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    ctx.openEdge(id, e.clientX, e.clientY);
  };

  return (
    <>
      <g className={`map-edge ${selected ? 'sel' : ''} ${d.hover ? 'hover' : ''} ${d.fresh ? 'fresh' : ''}`} data-strength={strength} style={{ color } as CSSProperties}>
        <path d={path} className="map-edge-halo" style={{ strokeWidth: width + 6 }} />
        <path
          d={path}
          className="map-edge-path"
          pathLength={d.fresh ? 1 : undefined}
          markerEnd={grouped || d.fresh ? undefined : marker}
          style={{ stroke: color, strokeWidth: width, strokeDasharray: d.fresh ? undefined : rel.dashed ? `${4 + strength * 1.5} ${3 + strength}` : undefined }}
        />
        <path d={path} className="react-flow__edge-interaction" fill="none" strokeOpacity={0} strokeWidth={22} />
        {trunk && d.lead && (
          <>
            <path d={`M ${trunk.j.x} ${trunk.j.y} L ${trunk.b.x} ${trunk.b.y}`} className="map-trunk" style={{ stroke: color, strokeWidth: width + 0.6 }} markerEnd={marker} />
            <circle cx={trunk.j.x} cy={trunk.j.y} r={3.5 + strength * 0.5} className="map-junction" style={{ fill: color }} />
          </>
        )}
      </g>
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`map-pill nodrag nopan ${selected ? 'sel' : ''} ${showLabel ? 'show' : ''}`}
          data-edge={id}
          style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)`, '--c': color } as CSSProperties}
          onClick={open}
          onMouseEnter={() => ctx.hoverEdge(id)}
          onMouseLeave={() => ctx.hoverEdge(null)}
          aria-label={`Relation : ${rel.label}`}
        >
          <i />
          <span className="map-pill-label">{rel.label}</span>
        </button>
        {trunk && d.lead && (
          <span
            className="map-together nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${(trunk.j.x + trunk.b.x) / 2 + 26}px, ${(trunk.j.y + trunk.b.y) / 2 - 8}px)`, '--c': color } as CSSProperties}
          >
            ensemble
          </span>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = { rel: RelEdge };

/** Pointes de flèche (une par relation et par force). */
export function ArrowDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {RELATIONS.flatMap((r) =>
          ([1, 2, 3] as EdgeStrength[]).map((s) => (
            <marker
              key={`${r.id}-${s}`}
              id={`map-arrow-${r.id}-${s}`}
              viewBox="0 0 12 12"
              refX="10.5"
              refY="6"
              markerWidth={ARROW[s]}
              markerHeight={ARROW[s]}
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M 1.2 1.6 L 11 6 L 1.2 10.4 L 3.8 6 Z" style={{ fill: `var(${r.cssVar})` }} />
            </marker>
          )),
        )}
      </defs>
    </svg>
  );
}
