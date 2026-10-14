// Carte d'argument (B1) : @xyflow/react 12, nœuds « extrait » et « idée », arêtes à relation, co-prémisses.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore as useRfStore,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type FinalConnectionState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useShallow } from 'zustand/react/shallow';
import { Check, GripVertical, LayoutGrid, Lightbulb, Link2, Maximize2, PanelLeft, Plus, Trash2, Unlink, X } from 'lucide-react';
import { uid, useStore } from '../../lib/store';
import { CATEGORIES, CATEGORY_BY_ID, NOTE_KIND_BY_ID, RELATIONS, RELATION_BY_ID, catColor } from '../../lib/categories';
import { locatorOf } from '../../lib/citation';
import { useFloating } from '../../components/ui';
import type { ArgumentMap, CategoryId, Highlight, MapEdge, MapNode, RelationId } from '../../lib/types';
import './map.css';

const NODE_W = 280;
const NODE_H = 190;

// ── Contexte partagé entre nœuds, arêtes et menus ───────────
interface Ctx {
  editingId: string | null;
  setEditingId(id: string | null): void;
  setIdeaText(id: string, text: string): void;
  openEdge(id: string, x: number, y: number): void;
  conceptName(id: string): string;
  jump(highlightId: string): void;
}
const MapCtx = createContext<Ctx | null>(null);
const useCtx = () => useContext(MapCtx) as Ctx;

interface ExtractData extends Record<string, unknown> {
  highlight: Highlight | null;
}
interface IdeaData extends Record<string, unknown> {
  text: string;
}
interface RelEdgeData extends Record<string, unknown> {
  relation: RelationId;
  /** Sources des arêtes du même faisceau (vide si arête isolée). */
  groupSources: string[];
  lead: boolean;
}

const EMPTY_MAP: ArgumentMap = { bookId: '', nodes: [], edges: [], viewport: null };

// ── Géométrie ────────────────────────────────────────────────
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Pt {
  x: number;
  y: number;
}
const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
function boundary(r: Rect, toward: Pt, gap = 3): Pt {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const s = Math.min(r.w / 2 / Math.abs(dx || 1e-6), r.h / 2 / Math.abs(dy || 1e-6));
  const len = Math.hypot(dx, dy);
  return { x: c.x + dx * s + (dx / len) * gap, y: c.y + dy * s + (dy / len) * gap };
}

function useRects(ids: string[]): Rect[] {
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

// ── Nœuds ────────────────────────────────────────────────────
const sides: [Position, string][] = [
  [Position.Top, 't'],
  [Position.Right, 'r'],
  [Position.Bottom, 'b'],
  [Position.Left, 'l'],
];
const Handles = () => (
  <>
    {sides.map(([p, id]) => (
      <Handle key={id} id={id} type="source" position={p} className={`map-h map-h-${id}`} />
    ))}
  </>
);

function ExtractNode({ data, selected }: NodeProps) {
  const ctx = useCtx();
  const h = (data as ExtractData).highlight;
  const conceptNames = useStore(useShallow((s) => (h ? h.conceptIds.map((id) => s.concepts.find((c) => c.id === id)?.name).filter(Boolean) as string[] : [])));
  if (!h) {
    return (
      <div className="map-node map-extract missing" style={{ '--c': 'var(--faint)' } as CSSProperties}>
        <p className="map-node-text muted">Extrait introuvable</p>
        <Handles />
      </div>
    );
  }
  const color = h.category ? catColor(h.category) : 'var(--muted)';
  const text = h.text.replace(/\s+/g, ' ').trim();
  return (
    <div className={`map-node map-extract ${selected ? 'sel' : ''}`} style={{ '--c': color } as CSSProperties} onDoubleClick={() => ctx.jump(h.id)} title="Double-clic : retrouver dans le texte">
      <div className="map-node-head">
        <span className="map-node-cat">{h.category ? CATEGORY_BY_ID[h.category].label : 'Note de marge'}</span>
        <span className="map-node-loc">{locatorOf(h)}</span>
      </div>
      <p className="map-node-text">{text}</p>
      {h.note.trim() && (
        <p className="map-node-note">
          {h.noteKind && <b>{NOTE_KIND_BY_ID[h.noteKind].label}</b>} {h.note}
        </p>
      )}
      {conceptNames.length > 0 && (
        <div className="map-node-concepts">
          {conceptNames.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      )}
      <Handles />
    </div>
  );
}

function IdeaNode({ id, data, selected }: NodeProps) {
  const ctx = useCtx();
  const text = (data as IdeaData).text;
  const editing = ctx.editingId === id;
  const [draft, setDraft] = useState(text);
  useEffect(() => {
    if (editing) setDraft(text);
  }, [editing, text]);
  const done = (commit: boolean) => {
    ctx.setEditingId(null);
    // Une carte vide reste sur la carte (on peut la déplacer, la relier, l'écrire plus tard) ;
    // elle ne disparaît que par une suppression explicite.
    if (commit) ctx.setIdeaText(id, draft.trim());
  };
  return (
    <div className={`map-node map-idea ${selected ? 'sel' : ''}`} style={{ '--c': 'var(--ink-2)' } as CSSProperties} onDoubleClick={() => ctx.setEditingId(id)}>
      <div className="map-node-head">
        <span className="map-node-cat">Idée</span>
        <span className="map-node-loc">ma voix</span>
      </div>
      {editing ? (
        <textarea
          className="map-idea-input nodrag nowheel"
          autoFocus
          value={draft}
          placeholder="Écrire une idée, une objection, un lien…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => done(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              done(false);
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              done(true);
            }
          }}
        />
      ) : (
        <p className={`map-node-text idea ${text ? '' : 'placeholder'}`}>{text || 'Double-clic pour écrire'}</p>
      )}
      <Handles />
    </div>
  );
}

// ── Arête personnalisée ──────────────────────────────────────
const linePath = (a: Pt, b: Pt) => `M ${a.x} ${a.y} L ${b.x} ${b.y}`;

function RelEdge({ id, source, target, data, selected }: EdgeProps) {
  const ctx = useCtx();
  const d = data as RelEdgeData;
  const rel = RELATION_BY_ID[d.relation];
  const grouped = d.groupSources.length > 1;
  const rects = useRects([source, target, ...d.groupSources]);
  const [src, tgt, ...sibs] = rects;
  const tc = center(tgt);
  const color = `var(${rel.cssVar})`;
  const dash = rel.dashed ? '7 5' : undefined;
  const width = selected ? 3 : 2;

  let path: string;
  let pill: Pt;
  let trunk: { b: Pt; j: Pt } | null = null;
  if (grouped) {
    const sibCenters = sibs.map(center);
    const avg = { x: sibCenters.reduce((a, p) => a + p.x, 0) / sibCenters.length, y: sibCenters.reduce((a, p) => a + p.y, 0) / sibCenters.length };
    const b = boundary(tgt, avg, 2);
    const len = Math.hypot(avg.x - b.x, avg.y - b.y) || 1;
    const reach = Math.min(64, len / 2);
    const j = { x: b.x + ((avg.x - b.x) / len) * reach, y: b.y + ((avg.y - b.y) / len) * reach };
    const p1 = boundary(src, j, 3);
    path = linePath(p1, j);
    pill = { x: p1.x + (j.x - p1.x) * 0.42, y: p1.y + (j.y - p1.y) * 0.42 };
    trunk = { b, j };
  } else {
    const p1 = boundary(src, tc, 3);
    const p2 = boundary(tgt, center(src), 5);
    path = linePath(p1, p2);
    pill = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  }
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    ctx.openEdge(id, e.clientX, e.clientY);
  };

  return (
    <>
      <g className={`map-edge ${selected ? 'sel' : ''}`} style={{ color }}>
        <BaseEdge
          id={id}
          path={path}
          interactionWidth={22}
          markerEnd={grouped ? undefined : `url(#map-arrow-${d.relation})`}
          style={{ stroke: color, strokeWidth: width, strokeDasharray: dash, strokeLinecap: 'round' }}
        />
        {trunk && d.lead && (
          <>
            <path d={linePath(trunk.j, trunk.b)} className="map-trunk" style={{ stroke: color, strokeWidth: 2.6 }} markerEnd={`url(#map-arrow-${d.relation})`} />
            <circle cx={trunk.j.x} cy={trunk.j.y} r={5} className="map-junction" style={{ fill: color }} />
          </>
        )}
      </g>
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`map-pill nodrag nopan ${selected ? 'sel' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${pill.x}px, ${pill.y}px)`, '--c': color } as CSSProperties}
          onClick={open}
        >
          <i />
          {rel.label}
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

const nodeTypes = { extract: ExtractNode, idea: IdeaNode };
const edgeTypes = { rel: RelEdge };

// ── Menu d'une arête ─────────────────────────────────────────
interface MenuState {
  edgeId: string;
  x: number;
  y: number;
  fresh: boolean;
}

function EdgeMenu({
  menu,
  edges,
  titleOf,
  onClose,
  onRelation,
  onDelete,
  onGroupWith,
  onUngroup,
}: {
  menu: MenuState;
  edges: MapEdge[];
  titleOf(nodeId: string): string;
  onClose(): void;
  onRelation(r: RelationId): void;
  onDelete(): void;
  onGroupWith(otherId: string): void;
  onUngroup(): void;
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

// ── Disposition simple par catégorie ─────────────────────────
function layout(nodes: MapNode[], hlById: Map<string, Highlight>): Map<string, Pt> {
  const catOf = (n: MapNode): CategoryId | 'autre' => {
    const h = n.highlightId ? hlById.get(n.highlightId) : null;
    return h?.category ?? 'autre';
  };
  const byPos = (a: MapNode, b: MapNode) => a.x - b.x || a.y - b.y;
  const pick = (cats: (CategoryId | 'autre')[]) => nodes.filter((n) => cats.includes(catOf(n))).sort(byPos);
  const top = pick(['probleme', 'these']);
  const mid = pick(['argument']);
  const bottom = pick(['exemple', 'concept', 'autre']);
  const right = pick(['objection']);
  const colW = NODE_W + 56;
  const rowH = 300;
  const per = 4;
  const out = new Map<string, Pt>();
  const cols = Math.max(1, Math.min(per, Math.max(top.length, mid.length, bottom.length)));
  let y = 0;
  const row = (list: MapNode[], centered: boolean): number => {
    let rows = 0;
    for (let i = 0; i < list.length; i += per) {
      const slice = list.slice(i, i + per);
      const x0 = centered ? ((cols - slice.length) * colW) / 2 : 0;
      slice.forEach((n, k) => out.set(n.id, { x: x0 + k * colW, y: y + rows * rowH }));
      rows++;
    }
    return rows;
  };
  const rightY = top.length ? Math.ceil(top.length / per) * rowH : 0;
  y += row(top, true) * rowH;
  y += row(mid, true) * rowH;
  row(bottom, true);
  right.forEach((n, i) => out.set(n.id, { x: cols * colW + colW * 0.25, y: rightY + i * rowH }));
  return out;
}

// ── Vue ──────────────────────────────────────────────────────
function Inner({ bookId }: { bookId: string }) {
  const rf = useReactFlow();
  const mapRaw = useStore((s) => s.maps[bookId]);
  const map = mapRaw ?? { ...EMPTY_MAP, bookId };
  const highlights = useStore(useShallow((s) => s.highlights.filter((h) => h.bookId === bookId)));
  const concepts = useStore((s) => s.concepts);
  const jumpToHighlight = useStore((s) => s.jumpToHighlight);
  const hlById = useMemo(() => new Map(highlights.map((h) => [h.id, h])), [highlights]);

  const mutate = useCallback(
    (fn: (m: ArgumentMap) => ArgumentMap) => {
      const st = useStore.getState();
      st.setMap(bookId, fn(st.getMap(bookId)));
    },
    [bookId],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [drawer, setDrawer] = useState(() => highlights.some((h) => !map.nodes.some((n) => n.highlightId === h.id)));
  const [filter, setFilter] = useState<CategoryId | 'note' | null>(null);
  const [animating, setAnimating] = useState(false);
  const [dropping, setDropping] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const pointer = useRef<Pt>({ x: 0, y: 0 });

  // Nœuds React Flow dérivés du store (positions = store ; état de sélection/mesure conservé)
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return map.nodes.map((n) => {
        const o = old.get(n.id);
        const h = n.highlightId ? (hlById.get(n.highlightId) ?? null) : null;
        return {
          ...(o ?? {}),
          id: n.id,
          type: n.highlightId ? 'extract' : 'idea',
          position: { x: n.x, y: n.y },
          data: n.highlightId ? ({ highlight: h } as ExtractData) : ({ text: n.text } as IdeaData),
        } as Node;
      });
    });
  }, [map.nodes, hlById, setNodes]);

  const edges = useMemo<Edge[]>(() => {
    const counts = new Map<string, MapEdge[]>();
    for (const e of map.edges) {
      if (!e.groupId) continue;
      const k = `${e.target}::${e.groupId}`;
      counts.set(k, [...(counts.get(k) ?? []), e]);
    }
    return map.edges.map((e) => {
      const grp = e.groupId ? (counts.get(`${e.target}::${e.groupId}`) ?? []) : [];
      const bundle = grp.length > 1;
      const lead = bundle ? [...grp].sort((a, b) => a.id.localeCompare(b.id))[0].id === e.id : false;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'rel',
        selected: e.id === selEdge,
        zIndex: e.id === selEdge ? 10 : 0,
        data: { relation: e.relation, groupSources: bundle ? grp.map((g) => g.source) : [], lead } as RelEdgeData,
      };
    });
  }, [map.edges, selEdge]);

  const titleOf = useCallback(
    (nodeId: string) => {
      const n = map.nodes.find((x) => x.id === nodeId);
      if (!n) return '?';
      const h = n.highlightId ? hlById.get(n.highlightId) : null;
      const base = h ? h.text : n.text;
      const words = base.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
      const cat = h ? (h.category ? CATEGORY_BY_ID[h.category].label : 'Note de marge') : 'Idée';
      return `${cat} : ${words || '…'}${base.trim().split(/\s+/).length > 6 ? '…' : ''}`;
    },
    [map.nodes, hlById],
  );

  // Retire les groupes devenus singletons
  const normalize = (list: MapEdge[]): MapEdge[] => {
    const cnt = new Map<string, number>();
    for (const e of list) if (e.groupId) cnt.set(`${e.target}::${e.groupId}`, (cnt.get(`${e.target}::${e.groupId}`) ?? 0) + 1);
    return list.map((e) => (e.groupId && (cnt.get(`${e.target}::${e.groupId}`) ?? 0) < 2 ? { ...e, groupId: null } : e));
  };

  const freePosition = useCallback((): Pt => {
    const r = wrap.current?.getBoundingClientRect();
    const c = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2 + (drawer ? 140 : 0), y: r.top + r.height / 2 }) : { x: 0, y: 0 };
    const k = useStore.getState().getMap(bookId).nodes.length % 6;
    return { x: Math.round(c.x - NODE_W / 2 + k * 26), y: Math.round(c.y - NODE_H / 2 + k * 26) };
  }, [rf, bookId, drawer]);

  const addHighlightNode = useCallback(
    (hid: string, at?: Pt) => {
      const pos = at ?? freePosition();
      mutate((m) => (m.nodes.some((n) => n.highlightId === hid) ? m : { ...m, nodes: [...m.nodes, { id: uid(), highlightId: hid, text: '', x: pos.x, y: pos.y }] }));
    },
    [mutate, freePosition],
  );

  const addIdea = () => {
    const pos = freePosition();
    const id = uid();
    mutate((m) => ({ ...m, nodes: [...m.nodes, { id, highlightId: null, text: '', x: pos.x, y: pos.y }] }));
    setTimeout(() => setEditingId(id), 60);
  };

  const ctx = useMemo<Ctx>(
    () => ({
      editingId,
      setEditingId,
      setIdeaText: (id, text) =>
        mutate((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, text } : n)) })),
      openEdge: (id, x, y) => {
        setSelEdge(id);
        setMenu({ edgeId: id, x, y, fresh: false });
      },
      conceptName: (id) => concepts.find((c) => c.id === id)?.name ?? '',
      jump: (hid) => jumpToHighlight(hid),
    }),
    [editingId, mutate, concepts, jumpToHighlight],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const m = useStore.getState().getMap(bookId);
      const dup = m.edges.find((e) => e.source === c.source && e.target === c.target);
      const id = dup?.id ?? uid();
      if (!dup) mutate((mm) => ({ ...mm, edges: [...mm.edges, { id, source: c.source!, target: c.target!, relation: 'soutient', groupId: null }] }));
      setSelEdge(id);
      setMenu({ edgeId: id, x: pointer.current.x, y: pointer.current.y, fresh: true });
    },
    [bookId, mutate],
  );

  /** Lien lâché dans le vide : crée une nouvelle carte « idée » à cet endroit, reliée à la carte de départ. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode) return;
      const pt = 'changedTouches' in event ? event.changedTouches[0] : event;
      if (!pt) return;
      const p = rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
      const id = uid();
      const edgeId = uid();
      const from = state.fromNode.id;
      // Si l'on a tiré depuis une poignée d'entrée, la nouvelle carte pointe vers la carte de départ.
      const reverse = state.fromHandle?.type === 'target';
      mutate((m) => ({
        ...m,
        nodes: [...m.nodes, { id, highlightId: null, text: '', x: Math.round(p.x - 140), y: Math.round(p.y - 28) }],
        edges: [...m.edges, { id: edgeId, source: reverse ? id : from, target: reverse ? from : id, relation: 'soutient', groupId: null }],
      }));
      setSelEdge(null);
      setMenu(null);
      setTimeout(() => setEditingId(id), 60);
    },
    [rf, mutate],
  );

  const onDelete = useCallback(
    ({ nodes: dn, edges: de }: { nodes: Node[]; edges: Edge[] }) => {
      const nIds = new Set(dn.map((n) => n.id));
      const eIds = new Set(de.map((e) => e.id));
      mutate((m) => ({
        ...m,
        nodes: m.nodes.filter((n) => !nIds.has(n.id)),
        edges: normalize(m.edges.filter((e) => !eIds.has(e.id) && !nIds.has(e.source) && !nIds.has(e.target))),
      }));
      setSelEdge(null);
      setMenu(null);
    },
    [mutate],
  );

  // Viewport (écriture différée)
  const vpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMoveEnd = useCallback(
    (_: unknown, vp: { x: number; y: number; zoom: number }) => {
      if (vpTimer.current) clearTimeout(vpTimer.current);
      vpTimer.current = setTimeout(() => mutate((m) => ({ ...m, viewport: { x: vp.x, y: vp.y, zoom: vp.zoom } })), 350);
    },
    [mutate],
  );
  useEffect(() => () => void (vpTimer.current && clearTimeout(vpTimer.current)), []);

  /** Ajuste la vue en tenant compte du tiroir et de la barre flottante. */
  const fit = (duration: number) => {
    const el = wrap.current;
    const list = rf.getNodes();
    if (!el || !list.length) return;
    const bb = rf.getNodesBounds(list);
    const left = drawer ? 316 : 48;
    const aw = Math.max(200, el.clientWidth - left - 48);
    const ah = Math.max(200, el.clientHeight - 56 - 88);
    const zoom = Math.max(0.25, Math.min(1, aw / Math.max(bb.width, 1), ah / Math.max(bb.height, 1)));
    rf.setViewport({ x: left + (aw - bb.width * zoom) / 2 - bb.x * zoom, y: 56 + (ah - bb.height * zoom) / 2 - bb.y * zoom, zoom }, { duration });
  };

  // Premier cadrage : celui de React Flow ignore le tiroir « À placer » et la barre
  // flottante (des nœuds restaient cachés dessous). On cadre nous-mêmes, une fois les
  // nœuds mesurés, et on masque la vue jusque-là pour éviter un saut.
  const nodesReady = useNodesInitialized();
  const [prefit, setPrefit] = useState(() => !map.viewport && map.nodes.length > 0);
  useEffect(() => {
    if (!prefit || !nodesReady) return;
    fit(0);
    requestAnimationFrame(() => setPrefit(false));
  }, [prefit, nodesReady]);

  const organise = () => {
    const pos = layout(map.nodes, hlById);
    setAnimating(true);
    mutate((m) => ({ ...m, nodes: m.nodes.map((n) => ({ ...n, x: Math.round(pos.get(n.id)?.x ?? n.x), y: Math.round(pos.get(n.id)?.y ?? n.y) })) }));
    setTimeout(() => fit(500), 60);
    setTimeout(() => setAnimating(false), 700);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const hid = e.dataTransfer.getData('text/marginalia-hl');
    if (!hid) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addHighlightNode(hid, { x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - 40) });
  };

  const unplaced = useMemo(() => {
    const placed = new Set(map.nodes.map((n) => n.highlightId).filter(Boolean));
    return highlights.filter((h) => !placed.has(h.id));
  }, [highlights, map.nodes]);
  const shown = unplaced.filter((h) => (filter === null ? true : filter === 'note' ? h.category === null : h.category === filter));

  const menuEdge = menu ? map.edges.find((e) => e.id === menu.edgeId) : null;
  const empty = map.nodes.length === 0;

  return (
    <MapCtx.Provider value={ctx}>
      <div
        ref={wrap}
        className={`map-root ${animating ? 'map-animating' : ''} ${dropping ? 'map-dropping' : ''} ${prefit ? 'map-prefit' : ''}`}
        data-testid="map-root"
        onPointerMove={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('text/marginalia-hl')) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDropping(false);
        }}
        onDrop={onDrop}
      >
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
          <defs>
            {RELATIONS.map((r) => (
              <marker key={r.id} id={`map-arrow-${r.id}`} viewBox="0 0 12 12" refX="10" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M 1.5 1.5 L 10.5 6 L 1.5 10.5 Z" style={{ fill: `var(${r.cssVar})`, stroke: `var(${r.cssVar})`, strokeWidth: 1, strokeLinejoin: 'round' }} />
              </marker>
            ))}
          </defs>
        </svg>

        <ReactFlow
          className="map-flow"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onDelete={onDelete}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={36}
          deleteKeyCode={['Backspace', 'Delete']}
          zoomOnDoubleClick={false}
          minZoom={0.25}
          maxZoom={1.8}
          defaultViewport={map.viewport ?? undefined}
          proOptions={{ hideAttribution: true }}
          onNodeDragStop={(_, __, dragged) =>
            mutate((m) => {
              const pos = new Map(dragged.map((d) => [d.id, d.position]));
              return { ...m, nodes: m.nodes.map((n) => (pos.has(n.id) ? { ...n, x: Math.round(pos.get(n.id)!.x), y: Math.round(pos.get(n.id)!.y) } : n)) };
            })
          }
          onNodeClick={() => {
            setSelEdge(null);
            setMenu(null);
          }}
          onPaneClick={() => {
            setSelEdge(null);
            setMenu(null);
            setEditingId(null);
          }}
          onEdgeClick={(e, edge) => ctx.openEdge(edge.id, e.clientX, e.clientY)}
          onMoveEnd={onMoveEnd}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="var(--border-strong)" />
          <Controls position="bottom-left" showInteractive={false} showFitView={false} />
        </ReactFlow>

        {!empty && (
          <div className="map-legend anim-fade" aria-label="Relations">
            {RELATIONS.map((r) => (
              <span key={r.id} style={{ '--c': `var(${r.cssVar})` } as CSSProperties}>
                <svg width="22" height="8">
                  <line x1="1" y1="4" x2="21" y2="4" stroke="var(--c)" strokeWidth="2" strokeDasharray={r.dashed ? '4 3' : undefined} strokeLinecap="round" />
                </svg>
                {r.label}
              </span>
            ))}
          </div>
        )}

        {empty && (
          <div className="map-empty anim-in" data-testid="map-empty">
            <div className="empty">
              <h3>Une carte à construire</h3>
              <p>
                {highlights.length
                  ? 'Posez ici les extraits qui comptent, puis reliez-les : un argument soutient une thèse, une objection s’y attaque, une réponse la parre.'
                  : 'Surlignez d’abord quelques passages dans la lecture : ils apparaîtront ici, prêts à être placés et reliés.'}
              </p>
              <p className="map-empty-hint">Tirez depuis un point d’un nœud vers un autre pour créer un lien.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {highlights.length > 0 && !drawer && (
                  <button className="btn btn-primary" onClick={() => setDrawer(true)}>
                    <PanelLeft size={14} /> Voir les extraits à placer
                  </button>
                )}
                <button className="btn" onClick={addIdea}>
                  <Lightbulb size={14} /> Ajouter une idée
                </button>
              </div>
            </div>
          </div>
        )}

        {drawer ? (
          <aside className="map-drawer anim-slide" data-testid="map-drawer">
            <header>
              <b>À placer</b>
              <span className="muted">{unplaced.length}</span>
              <span style={{ flex: 1 }} />
              <button className="icon-btn sm" title="Fermer" onClick={() => setDrawer(false)}>
                <X size={14} />
              </button>
            </header>
            <div className="map-drawer-filters">
              <button className={`chip ${filter === null ? 'active' : ''}`} onClick={() => setFilter(null)}>
                Tous
              </button>
              {CATEGORIES.map((c) => (
                <button key={c.id} className={`chip ${filter === c.id ? 'active' : ''}`} onClick={() => setFilter(filter === c.id ? null : c.id)}>
                  <span className="cat-dot" style={{ background: catColor(c.id) }} />
                  {c.label}
                </button>
              ))}
              <button className={`chip ${filter === 'note' ? 'active' : ''}`} onClick={() => setFilter(filter === 'note' ? null : 'note')}>
                Notes
              </button>
            </div>
            <div className="map-drawer-list anim-stagger">
              {shown.map((h, i) => (
                <div
                  key={h.id}
                  className="map-drawer-item lift"
                  data-hl={h.id}
                  style={{ '--c': h.category ? catColor(h.category) : 'var(--muted)', '--i': i } as CSSProperties}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/marginalia-hl', h.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <GripVertical size={13} className="grip" />
                  <div className="body">
                    <span className="cat">{h.category ? CATEGORY_BY_ID[h.category].label : 'Note de marge'}</span>
                    <p>{h.text.replace(/\s+/g, ' ').trim()}</p>
                    <span className="loc">{locatorOf(h)}</span>
                  </div>
                  <button className="icon-btn sm add" title="Ajouter à la carte" onClick={() => addHighlightNode(h.id)}>
                    <Plus size={14} />
                  </button>
                </div>
              ))}
              {shown.length === 0 && (
                <p className="map-drawer-none muted">
                  {highlights.length === 0
                    ? 'Aucun extrait pour ce livre. Surlignez des passages dans la lecture.'
                    : unplaced.length === 0
                      ? 'Tous les extraits sont sur la carte.'
                      : 'Aucun extrait dans cette catégorie.'}
                </p>
              )}
            </div>
          </aside>
        ) : (
          <button className="map-drawer-open anim-fade" onClick={() => setDrawer(true)} data-testid="map-drawer-open">
            <PanelLeft size={14} /> À placer
            {unplaced.length > 0 && <span>{unplaced.length}</span>}
          </button>
        )}

        <div className="map-bar anim-in" role="toolbar">
          <button className="btn btn-ghost btn-sm" data-act="idea" onClick={addIdea}>
            <Lightbulb size={14} /> Idée
          </button>
          <button className="btn btn-ghost btn-sm" data-act="organise" onClick={organise} disabled={empty}>
            <LayoutGrid size={14} /> Organiser
          </button>
          <button className="btn btn-ghost btn-sm" data-act="fit" onClick={() => fit(400)} disabled={empty}>
            <Maximize2 size={14} /> Ajuster
          </button>
        </div>

        {menu && menuEdge && (
          <EdgeMenu
            menu={menu}
            edges={map.edges}
            titleOf={titleOf}
            onClose={() => setMenu(null)}
            onRelation={(r) => {
              mutate((m) => ({ ...m, edges: m.edges.map((e) => (e.id === menu.edgeId ? { ...e, relation: r } : e)) }));
              setMenu(null);
            }}
            onDelete={() => {
              mutate((m) => ({ ...m, edges: normalize(m.edges.filter((e) => e.id !== menu.edgeId)) }));
              setMenu(null);
              setSelEdge(null);
            }}
            onUngroup={() => {
              mutate((m) => ({ ...m, edges: normalize(m.edges.map((e) => (e.id === menu.edgeId ? { ...e, groupId: null } : e))) }));
              setMenu(null);
            }}
            onGroupWith={(otherId) => {
              mutate((m) => {
                const a = m.edges.find((e) => e.id === menu.edgeId);
                const b = m.edges.find((e) => e.id === otherId);
                if (!a || !b) return m;
                const g = a.groupId ?? b.groupId ?? uid();
                return { ...m, edges: m.edges.map((e) => (e.id === a.id || e.id === b.id || (e.groupId && (e.groupId === a.groupId || e.groupId === b.groupId) && e.target === a.target) ? { ...e, groupId: g } : e)) };
              });
              setMenu(null);
            }}
          />
        )}
      </div>
    </MapCtx.Provider>
  );
}

export function ArgumentMapView({ bookId }: { bookId: string }) {
  return (
    <ReactFlowProvider>
      <Inner key={bookId} bookId={bookId} />
    </ReactFlowProvider>
  );
}
