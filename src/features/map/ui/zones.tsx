// 12. Zones de la carte : cadres titrés et colorés dessinés SOUS les cartes (couche dans la vue
// de React Flow, donc qui suit le zoom et le défilement).
//   - glisser le bandeau de titre déplace la zone ET son contenu (moveZone du modèle) ;
//   - poignée en bas à droite : redimensionner (l'appartenance suit : une carte dont le centre
//     entre dans le cadre en fait partie) ;
//   - double-clic sur le titre : le renommer en place ; palette, replier/déplier, supprimer
//     (le cadre seul : les cartes restent) dans le bandeau et au clic droit ;
//   - zone repliée : étiquette compacte « Titre · 5 cartes », cartes et liens masqués.
// Outils purs pour la vue : zoneAt (zone sous le pointeur pendant un glisser), growZonesFor
// (une carte lâchée dans une zone l'agrandit au besoin), zoneBlocks (rangements : une zone = un bloc).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { ViewportPortal, useReactFlow, type Node } from '@xyflow/react';
import { ChevronRight, ChevronsDownUp, Palette, X } from 'lucide-react';
import type { ArgumentMap, MapZone } from '../../../lib/types';
import { separateUndoStep } from '../../../lib/store';
import { lookup } from '../model/actions';
import { nodeText } from '../model/core';
import { centerInside, nodeRect, type SizeMap } from '../model/geometry';
import { ZONE_COLORS, ZONE_HEADER, moveZone, nodesInZone, resizeZone, updateZone } from '../model/zones';
import { RELATION_BY_ID } from '../../../lib/categories';
import { useRects } from './edges';

/** Teintes douces proposées (variables du thème). */
export const ZONE_PALETTE: { id: string; label: string }[] = [
  { id: ZONE_COLORS[0], label: 'Ambre' },
  { id: ZONE_COLORS[1], label: 'Vert' },
  { id: ZONE_COLORS[2], label: 'Rose' },
  { id: ZONE_COLORS[3], label: 'Bleu' },
  { id: ZONE_COLORS[4], label: 'Violet' },
  { id: ZONE_COLORS[5], label: 'Orange' },
];

const cssColor = (c: string) => (c.startsWith('--') ? `var(${c})` : c);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Hauteur de l'étiquette d'une zone repliée. */
export const ZONE_CHIP_H = 38;

export interface ZoneLayerProps {
  zones: MapZone[];
  map: ArgumentMap;
  mutate(fn: (m: ArgumentMap) => ArgumentMap): void;
  readMap(): ArgumentMap;
  sizes(): SizeMap;
  setNodes(fn: (ns: Node[]) => Node[]): void;
  editingId: string | null;
  setEditingId(id: string | null): void;
  /** Zone mise en évidence (une carte glissée va y entrer). */
  dropTarget: string | null;
  /** Les zones glissent vers leur place (rangement automatique). */
  glide: boolean;
  onMenu(e: React.MouseEvent, z: MapZone): void;
  onPalette(e: React.MouseEvent, z: MapZone): void;
  onToggle(z: MapZone): void;
  onDelete(z: MapZone): void;
}

interface Live {
  id: string;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  inner: Set<string>;
}

export function ZoneLayer(p: ZoneLayerProps) {
  const rf = useReactFlow();
  const [live, setLive] = useState<Live | null>(null);
  if (!p.zones.length) return null;
  // Les plus grandes d'abord : une sous-zone reste visible (et saisissable) au-dessus.
  const ordered = [...p.zones].sort((a, b) => b.w * b.h - a.w * a.h);

  const begin = (e: RPointerEvent, z: MapZone, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    if (mode === 'move' && (e.target as HTMLElement).closest('button, input')) return;
    e.stopPropagation();
    e.preventDefault();
    const zoom = rf.getZoom();
    const sx = e.clientX;
    const sy = e.clientY;
    const m = p.readMap();
    const sizes = p.sizes();
    const members = mode === 'move' ? new Set(nodesInZone(m, z.id, lookup(), sizes)) : new Set<string>();
    const inner = new Set(
      mode === 'move'
        ? (m.zones ?? []).filter((o) => o.id !== z.id && o.x >= z.x && o.y >= z.y && o.x + o.w <= z.x + z.w && o.y + o.h <= z.y + z.h).map((o) => o.id)
        : [],
    );
    const orig = new Map(m.nodes.filter((n) => members.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]));
    let d = { x: 0, y: 0 };
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      started = true;
      d = { x: (ev.clientX - sx) / zoom, y: (ev.clientY - sy) / zoom };
      if (mode === 'move') {
        setLive({ id: z.id, dx: d.x, dy: d.y, dw: 0, dh: 0, inner });
        p.setNodes((ns) => ns.map((n) => (orig.has(n.id) ? { ...n, position: { x: orig.get(n.id)!.x + d.x, y: orig.get(n.id)!.y + d.y } } : n)));
      } else setLive({ id: z.id, dx: 0, dy: 0, dw: d.x, dh: d.y, inner });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('map-zone-grabbing');
      if (started) {
        separateUndoStep();
        if (mode === 'move') p.mutate((mm) => moveZone(mm, z.id, Math.round(d.x), Math.round(d.y), lookup(), sizes));
        else p.mutate((mm) => resizeZone(mm, z.id, { w: z.w + d.x, h: z.h + d.y }));
      }
      setLive(null);
    };
    document.body.classList.add('map-zone-grabbing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <ViewportPortal>
      <div className={`map-zones ${p.glide && !live ? 'glide' : ''}`} data-testid="map-zones">
        {!live && p.zones.some((z) => z.collapsed) && <CollapsedLinks map={p.map} />}
        {ordered.map((z) => {
          const own = live?.id === z.id;
          const carried = live && live.inner.has(z.id);
          const dx = own || carried ? live!.dx : 0;
          const dy = own || carried ? live!.dy : 0;
          const w = Math.max(200, z.w + (own ? live!.dw : 0));
          const h = Math.max(120, z.h + (own ? live!.dh : 0));
          return (
            <ZoneBox
              key={z.id}
              z={z}
              x={z.x + dx}
              y={z.y + dy}
              w={w}
              h={h}
              count={z.collapsed ? (z.hiddenNodeIds ?? []).length : countIn(p.map, z, p.sizes)}
              moving={!!own || !!carried}
              drop={p.dropTarget === z.id}
              editing={p.editingId === z.id}
              onBegin={begin}
              props={p}
            />
          );
        })}
      </div>
    </ViewportPortal>
  );
}

/**
 * Zone repliée : ses cartes et leurs liens sont masqués, mais les liens qui sortent de la zone
 * restent suggérés — un trait pointillé discret, à la couleur de la relation, relie l'étiquette
 * à la carte visible (ou à l'étiquette d'une autre zone repliée).
 */
function CollapsedLinks({ map }: { map: ArgumentMap }) {
  const owner = new Map<string, MapZone>();
  for (const z of map.zones ?? []) if (z.collapsed) for (const id of z.hiddenNodeIds ?? []) owner.set(id, z);
  const seen = new Set<string>();
  const links: { key: string; from: string; to: string; rel: string }[] = [];
  const end = (id: string) => (owner.has(id) ? `zone:${owner.get(id)!.id}` : id);
  for (const e of map.edges) {
    const a = end(e.source);
    const b = end(e.target);
    if (a === b || (a === e.source && b === e.target)) continue;
    const key = `${a}>${b}>${e.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ key, from: a, to: b, rel: e.relation });
  }
  const nodeIds = [...new Set(links.flatMap((l) => [l.from, l.to]).filter((id) => !id.startsWith('zone:')))];
  const rects = useRects(nodeIds);
  // Largeur réelle des étiquettes (mesurée après rendu).
  const [chipW, setChipW] = useState<Record<string, number>>({});
  const ref = useRef<SVGSVGElement | null>(null);
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const next: Record<string, number> = {};
    host.querySelectorAll<HTMLElement>('.map-zone.collapsed[data-zone]').forEach((el) => (next[el.dataset.zone!] = el.offsetWidth));
    if (Object.keys(next).some((k) => next[k] !== chipW[k])) setChipW(next);
  });
  if (!links.length) return null;
  const rectOf = (id: string) => {
    if (id.startsWith('zone:')) {
      const z = (map.zones ?? []).find((o) => `zone:${o.id}` === id);
      return z ? { x: z.x, y: z.y, w: chipW[z.id] ?? 180, h: ZONE_CHIP_H } : null;
    }
    const r = rects[nodeIds.indexOf(id)];
    return r && r.w ? r : null;
  };
  /** Point du bord du rectangle sur le segment centre → p (avec un petit écart). */
  const border = (r: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }, gap: number) => {
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const k = Math.min(Math.abs(dx) > 0.01 ? r.w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 0.01 ? r.h / 2 / Math.abs(dy) : Infinity);
    const len = Math.hypot(dx, dy) || 1;
    return { x: c.x + dx * k + (dx / len) * gap, y: c.y + dy * k + (dy / len) * gap };
  };
  return (
    <svg ref={ref} className="map-zone-links" data-testid="zone-proxy-links" width="1" height="1" aria-hidden>
      {links.map((l) => {
        const a = rectOf(l.from);
        const b = rectOf(l.to);
        if (!a || !b) return null;
        const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
        const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        const p = border(a, cb, 4);
        const q = border(b, ca, 6);
        const rel = RELATION_BY_ID[l.rel as keyof typeof RELATION_BY_ID] ?? RELATION_BY_ID.soutient;
        return (
          <line
            key={l.key}
            data-link={l.key}
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            style={{ stroke: `var(${rel.cssVar})` }}
            markerEnd={`url(#map-arrow-${rel.id}-1)`}
          />
        );
      })}
    </svg>
  );
}

function countIn(map: ArgumentMap, z: MapZone, sizes: () => SizeMap): number {
  const s = sizes();
  const lk = lookup();
  return map.nodes.filter((n) => centerInside(nodeRect(n, nodeText(n, lk), s), z)).length;
}

function ZoneBox({
  z,
  x,
  y,
  w,
  h,
  count,
  moving,
  drop,
  editing,
  onBegin,
  props: p,
}: {
  z: MapZone;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
  moving: boolean;
  drop: boolean;
  editing: boolean;
  onBegin(e: RPointerEvent, z: MapZone, mode: 'move' | 'resize'): void;
  props: ZoneLayerProps;
}) {
  const style = { transform: `translate(${x}px, ${y}px)`, width: z.collapsed ? undefined : w, height: z.collapsed ? undefined : h, '--zc': cssColor(z.color) } as CSSProperties;
  const title = (
    <ZoneTitle
      z={z}
      editing={editing}
      onEdit={() => p.setEditingId(z.id)}
      onDone={(t) => {
        p.setEditingId(null);
        const v = t.trim();
        if (v && v !== z.title) {
          separateUndoStep();
          p.mutate((m) => updateZone(m, z.id, { title: v }));
        }
      }}
    />
  );
  const countLabel = plural(count, 'carte', 'cartes');
  if (z.collapsed) {
    return (
      <div
        className={`map-zone collapsed ${moving ? 'moving' : ''}`}
        style={style}
        data-zone={z.id}
        onContextMenu={(e) => p.onMenu(e, z)}
      >
        <div className="map-zone-chip nodrag nopan" onPointerDown={(e) => onBegin(e, z, 'move')} onDoubleClick={() => !editing && p.onToggle(z)} title="Glisser pour déplacer · double-clic pour déplier">
          <button className="map-zone-btn" data-act="zone-expand" onClick={() => p.onToggle(z)} aria-label="Déplier la zone" title="Déplier la zone">
            <ChevronRight size={14} />
          </button>
          {title}
          <span className="map-zone-count" data-testid="zone-count">
            {countLabel}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={`map-zone ${moving ? 'moving' : ''} ${drop ? 'drop' : ''}`} style={style} data-zone={z.id} aria-label={`Zone « ${z.title} »`}>
      <div
        className="map-zone-head nodrag nopan"
        style={{ height: ZONE_HEADER }}
        onPointerDown={(e) => onBegin(e, z, 'move')}
        onContextMenu={(e) => p.onMenu(e, z)}
        title="Glisser pour déplacer la zone et ses cartes"
      >
        {title}
        <span className="map-zone-count">{countLabel}</span>
        <span className="map-zone-tools">
          <button className="map-zone-btn" data-act="zone-color" onClick={(e) => p.onPalette(e, z)} aria-label="Couleur de la zone" title="Couleur">
            <Palette size={13} />
          </button>
          <button className="map-zone-btn" data-act="zone-collapse" onClick={() => p.onToggle(z)} aria-label="Replier la zone" title="Replier la zone">
            <ChevronsDownUp size={13} />
          </button>
          <button className="map-zone-btn" data-act="zone-delete" onClick={() => p.onDelete(z)} aria-label="Supprimer la zone" title="Supprimer la zone (les cartes restent)">
            <X size={13} />
          </button>
        </span>
      </div>
      <div className="map-zone-resize nodrag nopan" data-act="zone-resize" onPointerDown={(e) => onBegin(e, z, 'resize')} title="Redimensionner" />
    </div>
  );
}

function ZoneTitle({ z, editing, onEdit, onDone }: { z: MapZone; editing: boolean; onEdit(): void; onDone(t: string): void }) {
  const [v, setV] = useState(z.title);
  const ref = useRef<HTMLInputElement | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (!editing) return;
    done.current = false;
    setV(z.title);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
  }, [editing, z.title]);
  if (!editing)
    return (
      <span
        className="map-zone-title"
        data-testid="zone-title"
        onDoubleClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        title="Double-clic pour renommer"
      >
        {z.title || 'Zone'}
      </span>
    );
  const finish = (t: string) => {
    if (done.current) return;
    done.current = true;
    onDone(t);
  };
  return (
    <input
      ref={ref}
      className="map-zone-input"
      aria-label="Titre de la zone"
      value={v}
      size={Math.max(8, v.length + 1)}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(v);
        else if (e.key === 'Escape') finish(z.title);
      }}
      onBlur={() => finish(v)}
    />
  );
}

// ── Outils purs pour la vue ──────────────────────────────────

/** Plus petite zone dépliée qui contient le point (coordonnées de la carte). */
export function zoneAt(map: ArgumentMap, pt: { x: number; y: number }, except?: string | null): MapZone | null {
  const hits = (map.zones ?? []).filter((z) => !z.collapsed && z.id !== except && pt.x >= z.x && pt.x <= z.x + z.w && pt.y >= z.y && pt.y <= z.y + z.h);
  hits.sort((a, b) => a.w * a.h - b.w * b.h);
  return hits[0] ?? null;
}

/**
 * Une carte posée dans une zone (son centre y est) mais qui en déborde : la zone s'agrandit
 * pour l'englober (marge). Renvoie la carte inchangée si rien ne déborde.
 */
export function growZonesFor(map: ArgumentMap, nodeIds: string[], sizes: SizeMap): ArgumentMap {
  if (!map.zones?.length) return map;
  const lk = lookup();
  const pad = 18;
  let zones = map.zones;
  let changed = false;
  for (const id of nodeIds) {
    const n = map.nodes.find((x) => x.id === id);
    if (!n) continue;
    const r = nodeRect(n, nodeText(n, lk), sizes);
    const hits = zones.filter((z) => !z.collapsed && centerInside(r, z)).sort((a, b) => a.w * a.h - b.w * b.h);
    const z = hits[0];
    if (!z) continue;
    const x0 = Math.min(z.x, r.x - pad);
    const y0 = Math.min(z.y, r.y - pad - ZONE_HEADER);
    const x1 = Math.max(z.x + z.w, r.x + r.w + pad);
    const y1 = Math.max(z.y + z.h, r.y + r.h + pad);
    if (x0 === z.x && y0 === z.y && x1 === z.x + z.w && y1 === z.y + z.h) continue;
    changed = true;
    zones = zones.map((o) => (o.id === z.id ? { ...o, x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) } : o));
  }
  return changed ? { ...map, zones } : map;
}

export interface ZoneBlock {
  zone: MapZone;
  /** Cartes qui suivent le bloc (contenu de la zone, sous-zones comprises). */
  members: string[];
  /** Sous-zones entièrement incluses (elles suivent aussi). */
  inner: string[];
  /** Taille du bloc pour le rangement. */
  w: number;
  h: number;
}

/**
 * Rangements automatiques : chaque zone « de premier niveau » (non incluse dans une autre)
 * devient un bloc rangé comme une grande carte ; son contenu garde sa disposition et la suit.
 * Une carte n'appartient qu'à un bloc (le premier qui la contient).
 */
export function zoneBlocks(map: ArgumentMap, sizes: SizeMap): { blocks: ZoneBlock[]; owner: Map<string, string> } {
  const zones = map.zones ?? [];
  const inside = (o: MapZone, z: MapZone) => o.id !== z.id && o.x >= z.x && o.y >= z.y && o.x + o.w <= z.x + z.w && o.y + o.h <= z.y + z.h;
  const top = zones.filter((z) => !zones.some((o) => inside(z, o))).sort((a, b) => b.w * b.h - a.w * a.h);
  const owner = new Map<string, string>();
  const blocks: ZoneBlock[] = [];
  const lk = lookup();
  for (const z of top) {
    const members = nodesInZone(map, z.id, lk, sizes).filter((id) => !owner.has(id));
    for (const id of members) owner.set(id, z.id);
    // Contenu des sous-zones repliées (masqué, hors du cadre géométrique éventuellement).
    const inner = zones.filter((o) => inside(o, z));
    for (const o of inner) for (const id of o.collapsed ? (o.hiddenNodeIds ?? []) : []) if (!owner.has(id)) owner.set(id, z.id), members.push(id);
    blocks.push({ zone: z, members, inner: inner.map((o) => o.id), w: z.collapsed ? Math.min(z.w, 300) : z.w, h: z.collapsed ? ZONE_CHIP_H : z.h });
  }
  return { blocks, owner };
}

