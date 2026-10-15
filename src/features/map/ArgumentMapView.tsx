// Carte d'argument (B1) : @xyflow/react 12. Cette vue orchestre l'état et les gestes ;
// le rendu est découpé dans ui/ (cartes, liens, barre d'outils, barre de sélection, guides, tiroir)
// et la géométrie pure dans ui/geom.ts (aimantation, collisions, voisinage) et ui/layouts.ts (rangements).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type NodePositionChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/600.css';
import { useShallow } from 'zustand/react/shallow';
import { BookOpen, ChevronsDownUp, ChevronsUpDown, Copy, CornerDownRight, Lightbulb, Map as MapIcon, Maximize2, Palette, PanelLeft, Pencil, ScanSearch, Star, Trash2, Wand2, X, AlignStartVertical, MousePointer2 } from 'lucide-react';
import { ContextMenu, type MenuEntry } from '../workspaces/wsUi';
import { separateUndoStep, uid, useStore } from '../../lib/store';
import { RELATIONS, kindLabel, type ExtractKind } from '../../lib/categories';
import { fmtKeys, isMac, matchKeys } from '../../lib/keys';
import { isTextEditingTarget } from '../history/keys';
import type { ArgumentMap, EdgeStrength, Highlight, MapEdge, RelationId } from '../../lib/types';
import { CENTRAL_W, IDEA_COLORS, MapCtx, NODE_H, NODE_W, reducedMotion, type ExtractData, type IdeaData, type MapUiCtx, type RelEdgeData } from './ui/ctx';
import { nodeTypes } from './ui/nodes';
import { ArrowDefs, edgeTypes } from './ui/edges';
import { EdgeMenu, type EdgeMenuState } from './ui/EdgeMenu';
import { MapToolbar } from './ui/MapToolbar';
import { ALIGN_ACTIONS, SelectionBar } from './ui/SelectionBar';
import { Guides } from './ui/Guides';
import { PlaceDrawer } from './ui/PlaceDrawer';
import { alignBoxes, bounds, freeSpot, nearestFree, neighborIn, resolveCollisions, snapBox, type AlignKind, type Box, type Guide, type Pt } from './ui/geom';
import { LAYOUTS, layoutMap, type LayoutKind, type LNode } from './ui/layouts';
import './map.css';

const EMPTY_MAP: ArgumentMap = { bookId: '', nodes: [], edges: [], viewport: null };
/** Distance d'aimantation, en pixels d'écran. */
const SNAP_PX = 7;
/** Durée des glissements (rangement, collisions, alignement) : voir .map-glide dans map.css. */
const GLIDE_MS = 520;

/** Préférences d'affichage propres à l'appareil (mini-carte ouverte…). */
const pref = {
  get(k: string, d: boolean): boolean {
    try {
      const v = localStorage.getItem(`marginalia.map.${k}`);
      return v == null ? d : v === '1';
    } catch {
      return d;
    }
  },
  set(k: string, v: boolean) {
    try {
      localStorage.setItem(`marginalia.map.${k}`, v ? '1' : '0');
    } catch {
      /* stockage indisponible */
    }
  },
};

/** Clé d'ordre dans le texte d'un extrait (chapitre/page puis position). */
function textKey(h: Highlight): number {
  const a = h.anchor as Highlight['anchor'] | undefined;
  if (!a) return h.createdAt;
  if (a.kind === 'html') return a.chapter * 1e9 + a.start;
  const top = a.rects?.[0]?.y ?? 0;
  return a.page * 1e9 + Math.round(top * 1e6);
}

const sizeOf = (n: Node | undefined) => ({
  w: n?.measured?.width ?? ((n?.data as { central?: boolean } | undefined)?.central ? CENTRAL_W : NODE_W),
  h: n?.measured?.height ?? NODE_H,
});
const boxOf = (n: Node): Box => ({ id: n.id, x: n.position.x, y: n.position.y, ...sizeOf(n) });

/** Retire les groupes devenus singletons. */
const normalize = (list: MapEdge[]): MapEdge[] => {
  const cnt = new Map<string, number>();
  for (const e of list) if (e.groupId) cnt.set(`${e.target}::${e.groupId}`, (cnt.get(`${e.target}::${e.groupId}`) ?? 0) + 1);
  return list.map((e) => (e.groupId && (cnt.get(`${e.target}::${e.groupId}`) ?? 0) < 2 ? { ...e, groupId: null } : e));
};

/**
 * Source de la carte affichée : la carte d'un livre (rangée sous son bookId), ou une
 * carte libre (« board ») fournie avec ses fonctions de lecture / écriture. Une carte
 * libre peut citer des extraits de plusieurs livres.
 */
export type MapSource =
  | { kind: 'book'; bookId: string }
  | { kind: 'board'; mapId: string; get(): ArgumentMap; set(m: ArgumentMap): void };

const sourceKey = (s: MapSource) => (s.kind === 'book' ? s.bookId : s.mapId);

/** Nom court d'un livre pour l'étiquette d'une carte multi-livres : nom de l'auteur, sinon début du titre. */
export function bookShortName(b: { title: string; author: string } | undefined): string {
  if (!b) return '';
  const a = (b.author || '').split(/[,;&]| et /)[0].trim();
  if (a) {
    const parts = a.split(/\s+/).filter((w) => !/^(de|d’|d'|la|le|von|van|du)$/i.test(w));
    return parts[parts.length - 1] ?? a;
  }
  const t = b.title.replace(/\s+/g, ' ').trim();
  return t.length > 22 ? `${t.slice(0, 20).trim()}…` : t;
}

// ── Vue ──────────────────────────────────────────────────────
function Inner({ source }: { source: MapSource }) {
  const rf = useReactFlow();
  const key = sourceKey(source);
  const bookId = source.kind === 'book' ? source.bookId : '';
  // Une carte libre n'est pas forcément dans le store : on relit `get()` après chaque écriture.
  const [tick, setTick] = useState(0);
  const storeMap = useStore((s) => s.maps[key]);
  const srcRef = useRef(source);
  srcRef.current = source;
  const map = useMemo<ArgumentMap>(() => {
    if (source.kind === 'board') return source.get();
    return storeMap ?? { ...EMPTY_MAP, bookId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeMap, tick, bookId, source.kind]);
  /** Lecture fraîche de la carte (hors rendu). */
  const readMap = useCallback((): ArgumentMap => {
    const s = srcRef.current;
    return s.kind === 'board' ? s.get() : useStore.getState().getMap(s.bookId);
  }, []);
  const multi = source.kind === 'board';
  // Extraits concernés : ceux du livre ; pour une carte libre, ceux des livres de la carte et ceux qu'elle cite.
  const bookIdsKey = multi ? [...new Set([...(map.bookIds ?? []), ...(map.bookId ? [map.bookId] : [])])].sort().join('|') : bookId;
  const citedKey = multi ? map.nodes.map((n) => n.highlightId).filter(Boolean).sort().join('|') : '';
  const highlights = useStore(
    useShallow((s) => {
      if (!multi) return s.highlights.filter((h) => h.bookId === bookId);
      const books = new Set(bookIdsKey.split('|').filter(Boolean));
      const cited = new Set(citedKey.split('|').filter(Boolean));
      return s.highlights.filter((h) => books.has(h.bookId) || cited.has(h.id));
    }),
  );
  const books = useStore((s) => s.books);
  const jumpToHighlight = useStore((s) => s.jumpToHighlight);
  const hlById = useMemo(() => new Map(highlights.map((h) => [h.id, h])), [highlights]);
  /** Livres réellement cités (ordre : bookIds de la carte, puis ordre d'apparition). */
  const bookOrder = useMemo(() => {
    const ids: string[] = [...(map.bookIds ?? [])];
    for (const n of map.nodes) {
      const h = n.highlightId ? hlById.get(n.highlightId) : null;
      if (h && !ids.includes(h.bookId)) ids.push(h.bookId);
    }
    return ids;
  }, [map.bookIds, map.nodes, hlById]);
  /** Étiquette de livre sur les cartes : seulement quand la carte mêle plusieurs livres (ou est libre). */
  const bookTags = useMemo(() => {
    const out = new Map<string, string>();
    if (!multi) return out;
    for (const id of bookOrder) out.set(id, bookShortName(books.find((b) => b.id === id)));
    return out;
  }, [multi, bookOrder, books]);

  const mutate = useCallback(
    (fn: (m: ArgumentMap) => ArgumentMap) => {
      const s = srcRef.current;
      if (s.kind === 'board') {
        s.set(fn(s.get()));
        setTick((t) => t + 1);
        return;
      }
      const st = useStore.getState();
      st.setMap(s.bookId, fn(st.getMap(s.bookId)));
    },
    [],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [menu, setMenu] = useState<EdgeMenuState | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; entries: MenuEntry[]; label: string } | null>(null);
  const [drawer, setDrawer] = useState(() => highlights.some((h) => !map.nodes.some((n) => n.highlightId === h.id)));
  const [filter, setFilter] = useState<ExtractKind | null>(null);
  const [glide, setGlide] = useState<ReadonlySet<string>>(() => new Set());
  const [dropping, setDropping] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const [selectTool, setSelectTool] = useState(false);
  const [miniOpen, setMiniOpen] = useState(() => pref.get('minimap', true));
  const [dragging, setDragging] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const pointer = useRef<Pt>({ x: 0, y: 0 });
  /** Carte à sélectionner dès qu'elle apparaît (création au clavier). */
  const pendingSelect = useRef<string | null>(null);
  /** ⌘ (Ctrl) enfoncé : pas d'aimantation pendant le glisser. */
  const modDown = useRef(false);
  /** La carte a le « focus clavier » (dernier clic dedans). */
  const active = useRef(false);
  const snap = useRef({ dx: 0, dy: 0 });
  const finalPos = useRef(new Map<string, Pt>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Thèse centrale : marquée explicitement, sinon la première thèse posée.
  const centralId = useMemo(() => {
    if (map.centralId && map.nodes.some((n) => n.id === map.centralId)) return map.centralId;
    return map.nodes.find((n) => n.highlightId && hlById.get(n.highlightId)?.category === 'these')?.id ?? null;
  }, [map.centralId, map.nodes, hlById]);

  // Nœuds React Flow dérivés du store (positions = store ; état de sélection/mesure conservé)
  useEffect(() => {
    // Consommé hors de la fonction de mise à jour (rejouée deux fois en mode strict).
    const want = pendingSelect.current;
    const hasWant = !!want && map.nodes.some((n) => n.id === want);
    if (hasWant) pendingSelect.current = null;
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return map.nodes.map((n) => {
        const o = old.get(n.id);
        const h = n.highlightId ? (hlById.get(n.highlightId) ?? null) : null;
        const central = n.id === centralId;
        return {
          ...(o ?? {}),
          id: n.id,
          type: n.highlightId ? 'extract' : 'idea',
          position: { x: n.x, y: n.y },
          className: glide.has(n.id) ? 'map-glide' : undefined,
          selected: hasWant ? n.id === want : (o?.selected ?? false),
          data: n.highlightId
            ? ({ highlight: h, central, collapsed: n.collapsed, book: h ? bookTags.get(h.bookId) : undefined } as ExtractData)
            : ({ text: n.text, central, color: n.color } as IdeaData),
        } as Node;
      });
    });
  }, [map.nodes, hlById, centralId, glide, setNodes, bookTags]);

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
      const data: RelEdgeData = {
        relation: e.relation,
        strength: e.strength ?? 2,
        groupSources: bundle ? grp.map((g) => g.source) : [],
        lead,
        hover: e.id === hoverEdge,
        fresh: fresh.has(e.id),
      };
      return { id: e.id, source: e.source, target: e.target, type: 'rel', selected: e.id === selEdge, zIndex: e.id === selEdge ? 10 : 0, data };
    });
  }, [map.edges, selEdge, hoverEdge, fresh]);

  const selIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);
  const selKey = selIds.join('|');
  const selIdeaCount = useMemo(() => nodes.filter((n) => n.selected && n.type === 'idea').length, [nodes]);

  const titleOf = useCallback(
    (nodeId: string) => {
      const n = map.nodes.find((x) => x.id === nodeId);
      if (!n) return '?';
      const h = n.highlightId ? hlById.get(n.highlightId) : null;
      const base = h ? h.text : n.text;
      const words = base.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
      const cat = h ? kindLabel(h) : 'Idée';
      return `${cat} : ${words || '…'}${base.trim().split(/\s+/).length > 6 ? '…' : ''}`;
    },
    [map.nodes, hlById],
  );

  // ── Animations ponctuelles ──
  const markFresh = useCallback((id: string) => {
    if (reducedMotion()) return;
    setFresh((s) => new Set(s).add(id));
    later(() => setFresh((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    }), 760);
  }, []);

  /** Écrit des positions ; `animate` : les cartes glissent vers leur place. */
  const commitPositions = useCallback(
    (pos: Map<string, Pt>, animate: boolean) => {
      if (!pos.size) return;
      if (animate && !reducedMotion()) {
        setGlide(new Set(pos.keys()));
        later(() => setGlide(new Set()), GLIDE_MS + 80);
      }
      mutate((m) => ({ ...m, nodes: m.nodes.map((n) => (pos.has(n.id) ? { ...n, x: Math.round(pos.get(n.id)!.x), y: Math.round(pos.get(n.id)!.y) } : n)) }));
    },
    [mutate],
  );

  // ── Cadrage ──
  /** Ajuste la vue sur un rectangle en tenant compte du tiroir et de la barre flottante. */
  const fitBox = useCallback(
    (bb: { x: number; y: number; width: number; height: number }, duration: number, maxZoom = 1) => {
      const el = wrap.current;
      if (!el) return;
      const left = drawer ? 316 : 48;
      const aw = Math.max(200, el.clientWidth - left - 48);
      const ah = Math.max(200, el.clientHeight - 56 - 88);
      const zoom = Math.max(0.25, Math.min(maxZoom, aw / Math.max(bb.width, 1), ah / Math.max(bb.height, 1)));
      rf.setViewport({ x: left + (aw - bb.width * zoom) / 2 - bb.x * zoom, y: 56 + (ah - bb.height * zoom) / 2 - bb.y * zoom, zoom }, { duration: reducedMotion() ? 0 : duration });
    },
    [rf, drawer],
  );
  const fitAll = useCallback(
    (duration = 400) => {
      const list = rf.getNodes().filter((n) => !n.hidden);
      if (list.length) fitBox(rf.getNodesBounds(list), duration);
    },
    [rf, fitBox],
  );
  const zoomSelection = useCallback(() => {
    const sel = rf.getNodes().filter((n) => n.selected);
    if (sel.length) fitBox(rf.getNodesBounds(sel), 450, 1.25);
  }, [rf, fitBox]);
  /** Fait entrer une carte dans la vue si elle en sort. */
  const reveal = useCallback(
    (id: string) => {
      const n = rf.getNode(id);
      const el = wrap.current;
      if (!n || !el) return;
      const b = boxOf(n);
      const vp = rf.getViewport();
      const sx = b.x * vp.zoom + vp.x;
      const sy = b.y * vp.zoom + vp.y;
      const inside = sx > 20 && sy > 20 && sx + b.w * vp.zoom < el.clientWidth - 20 && sy + b.h * vp.zoom < el.clientHeight - 90;
      if (!inside) rf.setCenter(b.x + b.w / 2, b.y + b.h / 2, { zoom: vp.zoom, duration: reducedMotion() ? 0 : 320 });
    },
    [rf],
  );

  // ── Création ──
  const freePosition = useCallback((): Pt => {
    const r = wrap.current?.getBoundingClientRect();
    const c = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2 + (drawer ? 140 : 0), y: r.top + r.height / 2 }) : { x: 0, y: 0 };
    // Au centre de la vue, sans recouvrir une carte existante.
    const boxes = rf.getNodes().filter((n) => !n.hidden).map(boxOf);
    const p = nearestFree({ x: Math.round(c.x - NODE_W / 2), y: Math.round(c.y - 60) }, NODE_W, 120, boxes);
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }, [rf, drawer]);

  const addHighlightNode = useCallback(
    (hid: string, at?: Pt) => {
      const pos = at ?? freePosition();
      mutate((m) => (m.nodes.some((n) => n.highlightId === hid) ? m : { ...m, nodes: [...m.nodes, { id: uid(), highlightId: hid, text: '', x: pos.x, y: pos.y }] }));
    },
    [mutate, freePosition],
  );

  /** Nouvelle idée (sélectionnée, en édition), éventuellement reliée. */
  const newIdea = useCallback(
    (at: Pt, link?: { to: string; relation: RelationId; reverse?: boolean }) => {
      const id = uid();
      const edgeId = uid();
      pendingSelect.current = id;
      mutate((m) => ({
        ...m,
        nodes: [...m.nodes, { id, highlightId: null, text: '', x: Math.round(at.x), y: Math.round(at.y) }],
        edges: link
          ? [...m.edges, { id: edgeId, source: link.reverse ? link.to : id, target: link.reverse ? id : link.to, relation: link.relation, groupId: null }]
          : m.edges,
      }));
      if (link) markFresh(edgeId);
      setSelEdge(null);
      setMenu(null);
      later(() => setEditingId(id), 60);
      later(() => reveal(id), 90);
      return id;
    },
    [mutate, markFresh, reveal],
  );

  const addIdea = () => newIdea(freePosition());

  /** Tab : carte « enfant » placée dessous, qui soutient la carte choisie. */
  const addChild = useCallback(
    (parentId: string) => {
      const p = rf.getNode(parentId);
      if (!p) return;
      const b = boxOf(p);
      const boxes = rf.getNodes().map(boxOf);
      const at = freeSpot({ x: b.x + b.w / 2 - NODE_W / 2, y: b.y + b.h + 76 }, NODE_W, 96, boxes, { x: NODE_W + 32, y: 0 });
      newIdea(at, { to: parentId, relation: 'soutient' });
    },
    [rf, newIdea],
  );

  /** Entrée : carte « sœur » à droite, reliée au même parent par la même relation. */
  const addSibling = useCallback(
    (sibId: string) => {
      const s = rf.getNode(sibId);
      if (!s) return;
      const b = boxOf(s);
      const boxes = rf.getNodes().map(boxOf);
      const at = freeSpot({ x: b.x + b.w + 40, y: b.y }, NODE_W, 96, boxes, { x: NODE_W + 32, y: 0 });
      const up = readMap().edges.find((e) => e.source === sibId);
      newIdea(at, up ? { to: up.target, relation: up.relation } : undefined);
    },
    [rf, bookId, newIdea],
  );

  const select = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      setNodes((ns) => ns.map((n) => (n.selected === set.has(n.id) ? n : { ...n, selected: set.has(n.id) })));
      setSelEdge(null);
    },
    [setNodes],
  );

  const ctx = useMemo<MapUiCtx>(
    () => ({
      editingId,
      setEditingId,
      setIdeaText: (id, text) => mutate((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, text } : n)) })),
      editTab: (id, text) => {
        setEditingId(null);
        const cur = readMap().nodes.find((n) => n.id === id);
        if (cur && cur.text !== text) mutate((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, text } : n)) }));
        addChild(id);
      },
      setCollapsed: (id, collapsed) => mutate((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, collapsed } : n)) })),
      openEdge: (id, x, y) => {
        setSelEdge(id);
        setMenu({ edgeId: id, x, y, fresh: false });
      },
      hoverEdge: setHoverEdge,
      jump: (hid) => jumpToHighlight(hid),
    }),
    [editingId, mutate, jumpToHighlight, bookId, addChild],
  );

  // ── Liens ──
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const m = readMap();
      const dup = m.edges.find((e) => e.source === c.source && e.target === c.target);
      const id = dup?.id ?? uid();
      if (!dup) {
        mutate((mm) => ({ ...mm, edges: [...mm.edges, { id, source: c.source!, target: c.target!, relation: 'soutient', groupId: null }] }));
        markFresh(id);
      }
      setSelEdge(id);
      setMenu({ edgeId: id, x: pointer.current.x, y: pointer.current.y, fresh: true });
    },
    [bookId, mutate, markFresh],
  );

  /** Lien lâché dans le vide : crée une nouvelle carte « idée » à cet endroit, reliée à la carte de départ. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode) return;
      const pt = 'changedTouches' in event ? event.changedTouches[0] : event;
      if (!pt) return;
      // Si l'on a tiré depuis une poignée d'entrée, la nouvelle carte pointe vers la carte de départ.
      const reverse = state.fromHandle?.type === 'target';
      // Lâché sur le corps d'une autre carte (loin de ses poignées) : on relie quand même.
      const over = (document.elementFromPoint(pt.clientX, pt.clientY) as HTMLElement | null)?.closest<HTMLElement>('.react-flow__node');
      const overId = over?.dataset.id;
      if (overId && overId !== state.fromNode.id) {
        onConnect(reverse ? { source: overId, target: state.fromNode.id, sourceHandle: null, targetHandle: null } : { source: state.fromNode.id, target: overId, sourceHandle: null, targetHandle: null });
        return;
      }
      if (overId) return;
      const p = rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
      newIdea({ x: p.x - NODE_W / 2, y: p.y - 28 }, { to: state.fromNode.id, relation: 'soutient', reverse: !reverse });
    },
    [rf, newIdea, onConnect],
  );

  const onDelete = useCallback(
    ({ nodes: dn, edges: de }: { nodes: { id: string }[]; edges: { id: string }[] }) => {
      const nIds = new Set(dn.map((n) => n.id));
      const eIds = new Set(de.map((e) => e.id));
      mutate((m) => ({
        ...m,
        nodes: m.nodes.filter((n) => !nIds.has(n.id)),
        edges: normalize(m.edges.filter((e) => !eIds.has(e.id) && !nIds.has(e.source) && !nIds.has(e.target))),
        ...(m.centralId && nIds.has(m.centralId) ? { centralId: undefined } : {}),
      }));
      setSelEdge(null);
      setMenu(null);
    },
    [mutate],
  );

  // ── Glisser : aimantation, guides, collisions ──
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      const pos = changes.filter((c): c is NodePositionChange => c.type === 'position' && !!c.position);
      if (pos.length) {
        const live = pos.some((c) => c.dragging);
        if (live) {
          if (modDown.current) {
            snap.current = { dx: 0, dy: 0 };
            setGuides((g) => (g.length ? [] : g));
          } else {
            const ids = new Set(pos.map((c) => c.id));
            const moving = pos.map((c) => ({ id: c.id, x: c.position!.x, y: c.position!.y, ...sizeOf(rf.getNode(c.id)) }));
            const bb = bounds(moving)!;
            const others = rf
              .getNodes()
              .filter((n) => !ids.has(n.id) && !n.hidden)
              .map(boxOf);
            const r = snapBox({ id: '', ...bb }, others, SNAP_PX / rf.getZoom());
            snap.current = { dx: r.dx, dy: r.dy };
            setGuides(r.guides);
          }
        }
        const { dx, dy } = snap.current;
        changes = changes.map((c) => {
          if (c.type !== 'position' || !c.position) return c;
          const p = { x: c.position.x + dx, y: c.position.y + dy };
          finalPos.current.set(c.id, p);
          return { ...c, position: p };
        });
        if (!live) snap.current = { dx: 0, dy: 0 };
      }
      onNodesChange(changes);
    },
    [rf, onNodesChange],
  );

  const onNodeDragStart = useCallback(() => {
    finalPos.current = new Map();
    snap.current = { dx: 0, dy: 0 };
    setDragging(true);
    setMenu(null);
    setNodeMenu(null);
  }, []);

  const onNodeDragStop = useCallback(() => {
    setDragging(false);
    setGuides([]);
    const moved = finalPos.current;
    finalPos.current = new Map();
    if (!moved.size) return;
    // Les voisines chevauchées s'écartent doucement.
    const boxes = rf.getNodes().map((n) => {
      const b = boxOf(n);
      const p = moved.get(n.id);
      return p ? { ...b, x: p.x, y: p.y } : b;
    });
    const pushed = resolveCollisions(boxes, new Set(moved.keys()), 22);
    separateUndoStep();
    const all = new Map(moved);
    for (const [id, p] of pushed) all.set(id, p);
    if (pushed.size && !reducedMotion()) {
      setGlide(new Set(pushed.keys()));
      later(() => setGlide(new Set()), GLIDE_MS + 80);
    }
    mutate((m) => ({ ...m, nodes: m.nodes.map((n) => (all.has(n.id) ? { ...n, x: Math.round(all.get(n.id)!.x), y: Math.round(all.get(n.id)!.y) } : n)) }));
  }, [rf, mutate]);

  // ── Rangement automatique ──
  const applyLayout = useCallback(
    (kind: LayoutKind) => {
      const list = rf.getNodes().filter((n) => !n.hidden);
      if (!list.length) return;
      const m = readMap();
      const byId = new Map(m.nodes.map((n) => [n.id, n]));
      const ranks = list
        .map((n) => byId.get(n.id))
        .filter((n) => n?.highlightId && hlById.get(n.highlightId))
        .map((n) => {
          const h = hlById.get(n!.highlightId!)!;
          // Carte multi-livres : par livre (ordre de la carte), puis ordre du texte.
          const bi = bookOrder.indexOf(h.bookId);
          return { id: n!.id, b: bi < 0 ? 999 : bi, k: textKey(h) };
        })
        .sort((a, b) => a.b - b.b || a.k - b.k);
      const rank = new Map(ranks.map((r, i) => [r.id, i]));
      const lnodes: LNode[] = list.map((n) => {
        const mn = byId.get(n.id);
        const h = mn?.highlightId ? hlById.get(mn.highlightId) : null;
        const bi = h && multi ? bookOrder.indexOf(h.bookId) : -1;
        return { id: n.id, ...sizeOf(n), category: h?.category ?? null, idea: !mn?.highlightId, textRank: rank.get(n.id) ?? null, book: bi < 0 ? null : bi };
      });
      const bb = bounds(list.map(boxOf))!;
      const pos = layoutMap(kind, lnodes, m.edges, centralId, { x: bb.x, y: bb.y });
      separateUndoStep();
      commitPositions(pos, true);
      separateUndoStep();
      later(() => {
        const ids = new Set(pos.keys());
        const nb = list.map((n) => ({ ...boxOf(n), ...(pos.get(n.id) ?? {}) })).filter((b) => ids.has(b.id));
        const r = bounds(nb);
        if (r) fitBox({ x: r.x, y: r.y, width: r.w, height: r.h }, GLIDE_MS);
      }, 40);
      const label = LAYOUTS.find((l) => l.id === kind)?.label ?? '';
      useStore.getState().toast(`Carte rangée : ${label}. ${fmtKeys('⌘Z')} pour revenir.`, 'success');
    },
    [rf, readMap, hlById, bookOrder, multi, centralId, commitPositions, fitBox],
  );

  // ── Sélection groupée ──
  const selectedBoxes = () => rf.getNodes().filter((n) => n.selected).map(boxOf);
  const align = useCallback(
    (k: AlignKind) => {
      const pos = alignBoxes(rf.getNodes().filter((n) => n.selected).map(boxOf), k);
      // Les autres cartes recouvertes s'écartent, comme après un glisser.
      const boxes = rf.getNodes().filter((n) => !n.hidden).map((n) => {
        const b = boxOf(n);
        const p = pos.get(n.id);
        return p ? { ...b, ...p } : b;
      });
      for (const [id, p] of resolveCollisions(boxes, new Set(pos.keys()), 22)) pos.set(id, p);
      separateUndoStep();
      commitPositions(pos, true);
    },
    [rf, commitPositions],
  );
  const colorIdeas = useCallback(
    (ids: string[], color: string | undefined) => {
      const set = new Set(ids);
      mutate((m) => ({
        ...m,
        nodes: m.nodes.map((n) => {
          if (!set.has(n.id) || n.highlightId) return n;
          const { color: _old, ...rest } = n;
          return color ? { ...rest, color } : rest;
        }),
      }));
    },
    [mutate],
  );
  const setCentral = useCallback((id: string | undefined) => mutate((m) => ({ ...m, centralId: id })), [mutate]);

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

  // Premier cadrage : celui de React Flow ignore le tiroir « À placer » et la barre
  // flottante (des nœuds restaient cachés dessous). On cadre nous-mêmes, une fois les
  // nœuds mesurés, et on masque la vue jusque-là pour éviter un saut.
  const nodesReady = useNodesInitialized();
  const [prefit, setPrefit] = useState(() => !map.viewport && map.nodes.length > 0);
  useEffect(() => {
    if (!prefit || !nodesReady) return;
    fitAll(0);
    requestAnimationFrame(() => setPrefit(false));
  }, [prefit, nodesReady, fitAll]);

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

  // ── Clavier ──
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (!active.current || !wrap.current?.isConnected) return;
    if (isTextEditingTarget(e.target) || editingId) return;
    if (menu || nodeMenu || document.querySelector('[role="menu"], .modal, [role="dialog"]')) return;
    const all = rf.getNodes().filter((n) => !n.hidden);
    const sel = all.filter((n) => n.selected);
    const one = sel.length === 1 ? sel[0] : null;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (matchKeys(e, '⇧1')) {
      stop();
      fitAll(450);
    } else if (matchKeys(e, '⇧2')) {
      stop();
      zoomSelection();
    } else if (matchKeys(e, '⌘A')) {
      stop();
      select(all.map((n) => n.id));
    } else if (e.key === 'Tab' && plain && !e.shiftKey && one) {
      stop();
      addChild(one.id);
    } else if (e.key === 'Enter' && plain && one) {
      stop();
      if (one.type === 'idea' && !e.shiftKey) setEditingId(one.id);
      else addSibling(one.id);
    } else if (e.key.startsWith('Arrow') && plain) {
      stop();
      const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[e.key as 'ArrowUp'];
      if (!dir) return;
      if (e.shiftKey && sel.length) {
        // ⇧ + flèche : déplace la sélection.
        const d = { up: [0, -10], down: [0, 10], left: [-10, 0], right: [10, 0] }[dir];
        commitPositions(new Map(sel.map((n) => [n.id, { x: n.position.x + d[0], y: n.position.y + d[1] }])), false);
        return;
      }
      const from = one ?? all.find((n) => n.id === centralId) ?? all[0];
      if (!from) return;
      const next = one ? neighborIn(boxOf(one), all.map(boxOf), dir) : from.id;
      if (next) {
        select([next]);
        reveal(next);
      }
    } else if (e.key === 'Escape') {
      if (selectTool) setSelectTool(false);
      if (sel.length || selEdge) {
        stop();
        select([]);
      }
    }
  };

  useEffect(() => {
    const down = (e: PointerEvent) => {
      active.current = !!wrap.current?.contains(e.target as globalThis.Node);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Control') modDown.current = isMac ? e.metaKey : e.ctrlKey;
      keyRef.current(e);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Meta' || e.key === 'Control') modDown.current = isMac ? e.metaKey : e.ctrlKey;
    };
    const blur = () => (modDown.current = false);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // ── Menus contextuels ──
  const alignEntries = (): MenuEntry[] => ALIGN_ACTIONS.map((a) => ({ label: a.label, icon: a.icon, onClick: () => align(a.id), disabled: a.id.endsWith('spread') && selectedBoxes().length < 3 }));
  const colorEntries = (ids: string[], current?: string): MenuEntry[] =>
    IDEA_COLORS.map((c) => ({ label: c.label, swatch: c.id ? `var(${c.id})` : 'var(--cat-these)', checked: current === c.id, onClick: () => colorIdeas(ids, c.id) }));
  const layoutEntries = (): MenuEntry[] => LAYOUTS.map((l) => ({ label: l.label, hint: l.hint, onClick: () => applyLayout(l.id) }));

  const onNodeContextMenu = (e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setMenu(null);
    const sel = rf.getNodes().filter((n) => n.selected);
    const group = node.selected && sel.length > 1 ? sel : [node];
    if (!node.selected) select([node.id]);
    const m = readMap();
    const mapNode = m.nodes.find((n) => n.id === node.id);
    const entries: MenuEntry[] = [];
    if (group.length === 1 && mapNode) {
      if (mapNode.highlightId) {
        const hid = mapNode.highlightId;
        entries.push({ label: 'Ouvrir dans le livre', icon: <BookOpen size={14} />, onClick: () => jumpToHighlight(hid) });
        const long = !!document.querySelector(`.react-flow__node[data-id="${CSS.escape(node.id)}"] .map-node.long`);
        if (long) {
          const collapsed = !!document.querySelector(`.react-flow__node[data-id="${CSS.escape(node.id)}"] .map-node.collapsed`);
          entries.push({
            label: collapsed ? 'Déplier l’extrait' : 'Replier l’extrait',
            icon: collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />,
            onClick: () => ctx.setCollapsed(node.id, !collapsed),
          });
        }
      } else {
        entries.push({ label: 'Modifier', icon: <Pencil size={14} />, hint: fmtKeys('↩'), onClick: () => setEditingId(node.id) });
        entries.push({ label: 'Couleur', icon: <Palette size={14} />, children: colorEntries([node.id], mapNode.color) });
        entries.push({
          label: 'Dupliquer',
          icon: <Copy size={14} />,
          onClick: () => {
            const id = uid();
            mutate((mm) => ({ ...mm, nodes: [...mm.nodes, { ...mapNode, id, x: mapNode.x + 30, y: mapNode.y + 30 }] }));
          },
        });
      }
      entries.push({ label: 'Nouvelle idée reliée dessous', icon: <CornerDownRight size={14} />, hint: 'Tab', onClick: () => addChild(node.id) });
      if (m.centralId === node.id) entries.push({ label: 'Ne plus marquer comme thèse centrale', icon: <Star size={14} />, onClick: () => setCentral(undefined) });
      else if (centralId !== node.id) entries.push({ label: 'Marquer comme thèse centrale', icon: <Star size={14} />, onClick: () => setCentral(node.id) });
      entries.push({ sep: true });
    } else {
      const ideaIds = group.filter((n) => n.type === 'idea').map((n) => n.id);
      entries.push({ label: 'Aligner', icon: <AlignStartVertical size={14} />, children: alignEntries() });
      if (ideaIds.length) entries.push({ label: ideaIds.length > 1 ? `Couleur des ${ideaIds.length} idées` : 'Couleur de l’idée', icon: <Palette size={14} />, children: colorEntries(ideaIds) });
      entries.push({ label: 'Zoom sur la sélection', icon: <ScanSearch size={14} />, hint: fmtKeys('⇧2'), onClick: zoomSelection });
      entries.push({ sep: true });
    }
    entries.push({
      label: group.length > 1 ? `Supprimer les ${group.length} cartes` : 'Supprimer la carte',
      hint: group.some((n) => n.type === 'extract') ? 'extrait conservé' : undefined,
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => onDelete({ nodes: group, edges: [] }),
    });
    setNodeMenu({ x: e.clientX, y: e.clientY, entries, label: 'Menu de la carte' });
  };

  const onPaneContextMenu = (e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    setMenu(null);
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const has = map.nodes.length > 0;
    const entries: MenuEntry[] = [{ label: 'Nouvelle idée ici', icon: <Lightbulb size={14} />, hint: 'double-clic', onClick: () => newIdea({ x: at.x - NODE_W / 2, y: at.y - 40 }) }];
    if (has) {
      entries.push({ label: 'Ranger', icon: <Wand2 size={14} />, children: layoutEntries() });
      entries.push({ label: 'Tout sélectionner', icon: <MousePointer2 size={14} />, hint: fmtKeys('⌘A'), onClick: () => select(rf.getNodes().map((n) => n.id)) });
      entries.push({ label: 'Tout voir', icon: <Maximize2 size={14} />, hint: fmtKeys('⇧1'), onClick: () => fitAll(450) });
    }
    setNodeMenu({ x: e.clientX, y: e.clientY, label: 'Menu du schéma', entries });
  };

  const menuEdge = menu ? map.edges.find((e) => e.id === menu.edgeId) : null;
  const empty = map.nodes.length === 0;
  const toggleMini = () => {
    pref.set('minimap', !miniOpen);
    setMiniOpen(!miniOpen);
  };
  const miniClass = (n: Node) => {
    if (n.type === 'idea') return 'mm-idea';
    const h = (n.data as ExtractData).highlight;
    const c = h ? (h.category ?? (h.plain ? 'plain' : 'note')) : 'note';
    return `mm-${c}${(n.data as ExtractData).central ? ' mm-central' : ''}`;
  };

  return (
    <MapCtx.Provider value={ctx}>
      <div
        ref={wrap}
        className={`map-root ${dropping ? 'map-dropping' : ''} ${prefit ? 'map-prefit' : ''} ${dragging ? 'map-dragging' : ''} ${selectTool ? 'map-selecttool' : ''}`}
        data-testid="map-root"
        onPointerMove={(e) => {
          pointer.current = { x: e.clientX, y: e.clientY };
          modDown.current = isMac ? e.metaKey : e.ctrlKey;
        }}
        onDoubleClick={(e) => {
          const t = e.target as HTMLElement;
          if (!t.closest('.react-flow__pane') || t.closest('.react-flow__node, .react-flow__edge, .react-flow__panel')) return;
          const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          newIdea({ x: at.x - NODE_W / 2, y: at.y - 36 });
        }}
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
        <ArrowDefs />

        <ReactFlow
          className="map-flow"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onDelete={onDelete}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={36}
          deleteKeyCode={['Backspace', 'Delete']}
          multiSelectionKeyCode={isMac ? 'Meta' : 'Control'}
          selectionKeyCode="Shift"
          selectionOnDrag={selectTool}
          panOnDrag={selectTool ? [1, 2] : true}
          selectionMode={SelectionMode.Partial}
          disableKeyboardA11y
          zoomOnDoubleClick={false}
          minZoom={0.25}
          maxZoom={1.8}
          defaultViewport={map.viewport ?? undefined}
          proOptions={{ hideAttribution: true }}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onSelectionDragStart={onNodeDragStart}
          onSelectionDragStop={onNodeDragStop}
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
          onEdgeMouseEnter={(_, edge) => setHoverEdge(edge.id)}
          onEdgeMouseLeave={() => setHoverEdge(null)}
          onNodeContextMenu={onNodeContextMenu}
          onSelectionContextMenu={(e) => {
            const first = rf.getNodes().find((n) => n.selected);
            if (first) onNodeContextMenu(e, first);
          }}
          onPaneContextMenu={onPaneContextMenu}
          onMoveEnd={onMoveEnd}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.15} color="var(--map-dot)" />
          <Controls position="bottom-left" showInteractive={false} showFitView={false} />
          {!empty && miniOpen && (
            <MiniMap
              className="map-minimap anim-fade"
              position="bottom-right"
              pannable
              zoomable
              ariaLabel="Mini-carte"
              nodeClassName={miniClass}
              nodeBorderRadius={10}
              nodeStrokeWidth={0}
              maskColor="var(--map-mini-mask)"
              style={{ width: 184, height: 124 }}
            />
          )}
          <Guides guides={guides} />
          <SelectionBar
            ids={selIds}
            ideaCount={selIdeaCount}
            visible={selIds.length > 1 && !dragging && !menu && !nodeMenu}
            onAlign={align}
            onColor={(c) => colorIdeas(selKey.split('|'), c)}
            onDelete={() => onDelete({ nodes: selIds.map((id) => ({ id })), edges: [] })}
          />
        </ReactFlow>

        {!empty && (
          <button
            className={`map-mini-toggle ${miniOpen ? 'open' : ''}`}
            data-act="minimap"
            onClick={toggleMini}
            title={miniOpen ? 'Masquer la mini-carte' : 'Afficher la mini-carte'}
            aria-pressed={miniOpen}
          >
            {miniOpen ? <X size={12} /> : <MapIcon size={15} />}
          </button>
        )}

        {nodeMenu && <ContextMenu x={nodeMenu.x} y={nodeMenu.y} entries={nodeMenu.entries} label={nodeMenu.label} onClose={() => setNodeMenu(null)} />}
        {!empty && (
          <div className="map-legend anim-fade" aria-label="Relations">
            {RELATIONS.map((r) => (
              <span key={r.id} style={{ '--c': `var(${r.cssVar})` } as CSSProperties}>
                <svg width="22" height="8">
                  <line x1="1" y1="4" x2="21" y2="4" stroke="var(--c)" strokeWidth="1.75" strokeDasharray={r.dashed ? '5 3' : undefined} strokeLinecap="round" />
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
              <p className="map-empty-hint">Double-cliquez dans le vide pour noter une idée ; tirez depuis le bord d’une carte pour créer un lien.</p>
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

        <PlaceDrawer
          open={drawer}
          highlights={highlights}
          unplaced={unplaced}
          filter={filter}
          setFilter={setFilter}
          onOpen={() => setDrawer(true)}
          onClose={() => setDrawer(false)}
          onAdd={(hid) => addHighlightNode(hid)}
          bookOf={multi ? (h) => bookTags.get(h.bookId) || bookShortName(books.find((b) => b.id === h.bookId)) : undefined}
        />

        <MapToolbar
          empty={empty}
          hasSelection={selIds.length > 0}
          selectTool={selectTool}
          onIdea={addIdea}
          onLayout={applyLayout}
          onToggleSelect={() => setSelectTool((v) => !v)}
          onZoomSelection={zoomSelection}
          onFitAll={() => fitAll(450)}
        />

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
            onStrength={(s: EdgeStrength) =>
              mutate((m) => ({
                ...m,
                edges: m.edges.map((e) => {
                  if (e.id !== menu.edgeId) return e;
                  const { strength: _old, ...rest } = e;
                  return s === 2 ? rest : { ...rest, strength: s };
                }),
              }))
            }
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

/**
 * Carte d'argument. `bookId` : la carte du livre (usage historique) ; `source` : carte de
 * livre ou carte libre (voir MapSource).
 */
export function ArgumentMapView(props: { bookId: string } | { source: MapSource }) {
  const source: MapSource = 'source' in props ? props.source : { kind: 'book', bookId: props.bookId };
  return (
    <ReactFlowProvider>
      <Inner key={`${source.kind}:${sourceKey(source)}`} source={source} />
    </ReactFlowProvider>
  );
}
