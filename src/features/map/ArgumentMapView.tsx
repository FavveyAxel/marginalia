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
import { BookOpen, ChevronsDownUp, ChevronsUpDown, Copy, CornerDownRight, Lightbulb, Map as MapIcon, Maximize2, Palette, PanelLeft, Pencil, ScanSearch, Star, Trash2, Wand2, X, AlignStartVertical, MousePointer2, Group, History, Link2 } from 'lucide-react';
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
import type { MapToolbarItem } from './ui/MapToolbar';
import { ZONE_PALETTE, ZoneLayer, growZonesFor, zoneAt, zoneBlocks } from './ui/zones';
import { GapsPanel, GapsPill, gapMarks, useMapGaps } from './ui/gaps';
import { ExportMenu } from './ui/ExportMenu';
import { VersionsPanel, useMapVersions } from './ui/VersionsPanel';
import { autoSnapshot, beforeAutoLayout, lookup, placeHighlights } from './model/actions';
import { setEdgeNote } from './model/boards';
import type { SizeMap } from './model/geometry';
import { collapseZone, createZoneAround, expandZone, hiddenNodeIds, removeZone, updateZone } from './model/zones';
import type { MapZone } from '../../lib/types';
import { PASSAGE_TYPE, dropPassage, isPassageDrag, usePassagePlacer } from './ui/passage/passage';
import { useMovementPriority } from './ui/movement/movement';
import { useBarOverlap } from './ui/useBarOverlap';
import { CHAIN_KEY, ChainButton, ChainPanel, useChainCtl } from './ui/chain';
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
/** Le centre de la carte est-il dans la zone ? (règle d'appartenance du modèle) */
const insideZone = (n: Node, z: { x: number; y: number; w: number; h: number }) => {
  const b = boxOf(n);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h;
};

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
function Inner({ source, tools }: { source: MapSource; tools?: MapToolbarItem[] }) {
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
  // Carte libre rangée dans un espace de travail : les livres de cet espace (tous groupes) fournissent
  // aussi leurs extraits au tiroir « À placer ».
  const mapKey = source.kind === 'board' ? source.mapId : '';
  const wsBooksKey = useStore((s) => {
    if (!multi || !mapKey) return '';
    const wsIds = new Set(s.wsItems.filter((i) => i.kind === 'map' && i.refId === mapKey).map((i) => i.workspaceId));
    if (!wsIds.size) return '';
    return [...new Set(s.wsItems.filter((i) => wsIds.has(i.workspaceId) && i.kind === 'book').map((i) => i.refId))].sort().join('|');
  });
  const bookIdsKey = multi
    ? [...new Set([...(map.bookIds ?? []), ...(map.bookId ? [map.bookId] : []), ...wsBooksKey.split('|').filter(Boolean)])].sort().join('|')
    : bookId;
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
    if (!multi || map.kind === 'movement') return out;
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
  /** Panneau latéral ouvert (« gaps », « versions »… ; extensible). */
  const [sidePanel, setSidePanel] = useState<string | null>(null);
  // 12. Zones : titre en cours d'édition, zone visée pendant un glisser, glissement après rangement.
  const [editingZone, setEditingZone] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<string | null>(null);
  const [zoneGlide, setZoneGlide] = useState(false);
  // 15. Signaux : marques sur les cartes (préférence de l'appareil), carte mise en évidence.
  const [gapMarksOn, setGapMarksOn] = useState(() => pref.get('gaps', false));
  const [flash, setFlash] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const narrow = useBarOverlap(wrap);
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

  /** Tailles mesurées des cartes (pour les fonctions du modèle : zones, export). */
  const sizes = useCallback((): SizeMap => {
    const out: SizeMap = {};
    for (const n of rf.getNodes()) if (n.measured?.width && n.measured?.height) out[n.id] = { w: n.measured.width, h: n.measured.height };
    return out;
  }, [rf]);
  /** Cartes masquées par les zones repliées. */
  const hidden = useMemo(() => hiddenNodeIds(map), [map]);
  /** « Suivre une chaîne » (ui/chain.tsx) : commande stable ; le mode ne re-rend pas la vue. */
  const chain = useChainCtl();
  const { gaps, messages: gapMsgs } = useMapGaps(map);
  const marks = useMemo(() => (gapMarksOn ? gapMarks(gaps) : new Map<string, string>()), [gapMarksOn, gaps]);
  const versionCount = useMapVersions(key).length;

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
          className: [glide.has(n.id) ? 'map-glide' : '', marks.get(n.id) ?? '', flash === n.id ? 'map-flash' : ''].filter(Boolean).join(' ') || undefined,
          hidden: hidden.has(n.id),
          selected: hasWant ? n.id === want : !hidden.has(n.id) && (o?.selected ?? false),
          data: n.highlightId
            ? ({ highlight: h, central, collapsed: n.collapsed, book: h ? bookTags.get(h.bookId) : undefined } as ExtractData)
            : ({ text: n.text, central, color: n.color } as IdeaData),
        } as Node;
      });
    });
  }, [map.nodes, hlById, centralId, glide, setNodes, bookTags, hidden, marks, flash]);

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
        note: e.note?.trim() || undefined,
      };
      const off = hidden.has(e.source) || hidden.has(e.target);
      return { id: e.id, source: e.source, target: e.target, type: 'rel', hidden: off, selected: e.id === selEdge, zIndex: e.id === selEdge ? 10 : 0, data };
    });
  }, [map.edges, selEdge, hoverEdge, fresh, hidden]);

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
      // Les zones (bandeau de titre, étiquettes repliées) entrent aussi dans le cadrage.
      const zs = (readMap().zones ?? []).map((z) => ({ id: z.id, x: z.x, y: z.y, w: z.collapsed ? Math.min(z.w, 300) : z.w, h: z.collapsed ? 40 : z.h }));
      const bb = bounds([...list.map(boxOf), ...zs]);
      if (bb) fitBox({ x: bb.x, y: bb.y, width: bb.w, height: bb.h }, duration);
    },
    [rf, fitBox, readMap],
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
        // 13. Carte libre : entre deux livres différents, le lien proposé est « s’oppose à ».
        const bookOfNode = (nid: string) => {
          const hid = m.nodes.find((n) => n.id === nid)?.highlightId;
          return hid ? hlById.get(hid)?.bookId : undefined;
        };
        const b1 = multi ? bookOfNode(c.source) : undefined;
        const b2 = multi ? bookOfNode(c.target) : undefined;
        const relation: RelationId = b1 && b2 && b1 !== b2 ? 'oppose' : 'soutient';
        mutate((mm) => ({ ...mm, edges: [...mm.edges, { id, source: c.source!, target: c.target!, relation, groupId: null }] }));
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
      // 19. Suppression de plusieurs cartes : instantané automatique avant (panneau Versions).
      if (nIds.size > 1) autoSnapshot(sourceKey(srcRef.current), 'delete-many');
      mutate((m) => ({
        ...m,
        nodes: m.nodes.filter((n) => !nIds.has(n.id)),
        edges: normalize(m.edges.filter((e) => !eIds.has(e.id) && !nIds.has(e.source) && !nIds.has(e.target))),
        ...(m.centralId && nIds.has(m.centralId) ? { centralId: undefined } : {}),
        ...(m.zones?.some((z) => z.hiddenNodeIds?.some((id) => nIds.has(id)))
          ? { zones: m.zones.map((z) => (z.hiddenNodeIds ? { ...z, hiddenNodeIds: z.hiddenNodeIds.filter((id) => !nIds.has(id)) } : z)) }
          : {}),
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
          // 12. La zone où la carte va entrer s'éclaire (pas celle d'où elle part).
          const mv = pos.map((c) => ({ x: c.position!.x, y: c.position!.y, ...sizeOf(rf.getNode(c.id)) }));
          const bb2 = bounds(mv.map((b, i) => ({ id: String(i), ...b })))!;
          const z = zoneAt(readMap(), { x: bb2.x + bb2.w / 2, y: bb2.y + bb2.h / 2 }, dragFromZone.current);
          setDropZone((o) => (o === (z?.id ?? null) ? o : (z?.id ?? null)));
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
    [rf, onNodesChange, readMap],
  );

  /** Zone d'où part le glisser (non mise en évidence). */
  const dragFromZone = useRef<string | null>(null);
  const onNodeDragStart = useCallback(() => {
    finalPos.current = new Map();
    snap.current = { dx: 0, dy: 0 };
    const sel = rf.getNodes().filter((n) => n.selected || n.dragging);
    const bb = bounds(sel.map(boxOf));
    dragFromZone.current = bb ? (zoneAt(readMap(), { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 })?.id ?? null) : null;
    setDragging(true);
    setMenu(null);
    setNodeMenu(null);
  }, []);

  const onNodeDragStop = useCallback(() => {
    setDragging(false);
    setGuides([]);
    setDropZone(null);
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
    // 12. Une carte lâchée dans une zone en fait partie ; si elle déborde, la zone s'agrandit.
    const sz = sizes();
    mutate((m) =>
      growZonesFor({ ...m, nodes: m.nodes.map((n) => (all.has(n.id) ? { ...n, x: Math.round(all.get(n.id)!.x), y: Math.round(all.get(n.id)!.y) } : n)) }, [...moved.keys()], sz),
    );
  }, [rf, mutate, sizes]);

  // ── Rangement automatique ──
  const applyLayout = useCallback(
    (kind: LayoutKind) => {
      const list = rf.getNodes().filter((n) => !n.hidden);
      const m = readMap();
      if (!list.length && !m.zones?.length) return;
      // 12. Chaque zone (de premier niveau) est rangée comme un bloc ; son contenu la suit tel quel.
      const sz = sizes();
      const { blocks, owner } = zoneBlocks(m, sz);
      const byId = new Map(m.nodes.map((n) => [n.id, n]));
      const ranks = m.nodes
        .filter((n) => n.highlightId && hlById.get(n.highlightId))
        .map((n) => {
          const h = hlById.get(n.highlightId!)!;
          // Carte multi-livres : par livre (ordre de la carte), puis ordre du texte.
          const bi = bookOrder.indexOf(h.bookId);
          return { id: n.id, b: bi < 0 ? 999 : bi, k: textKey(h) };
        })
        .sort((a, b) => a.b - b.b || a.k - b.k);
      const rank = new Map(ranks.map((r, i) => [r.id, i]));
      const free = list.filter((n) => !owner.has(n.id));
      const lnodes: LNode[] = free.map((n) => {
        const mn = byId.get(n.id);
        const h = mn?.highlightId ? hlById.get(mn.highlightId) : null;
        const bi = h && multi ? bookOrder.indexOf(h.bookId) : -1;
        return { id: n.id, ...sizeOf(n), category: h?.category ?? null, idea: !mn?.highlightId, textRank: rank.get(n.id) ?? null, book: bi < 0 ? null : bi };
      });
      const CAT_PRIO = ['these', 'probleme', 'argument', 'objection', 'concept', 'exemple'] as const;
      for (const b of blocks) {
        const cats = b.members.map((id) => byId.get(id)?.highlightId).map((hid) => (hid ? hlById.get(hid)?.category : null));
        const category = CAT_PRIO.find((c) => cats.includes(c)) ?? null;
        const rs = b.members.map((id) => rank.get(id)).filter((r): r is number => r != null);
        lnodes.push({ id: `zone:${b.zone.id}`, w: b.w, h: b.h, category, idea: false, textRank: rs.length ? Math.min(...rs) : null, book: null });
      }
      const remap = (id: string) => (owner.has(id) ? `zone:${owner.get(id)}` : id);
      const ledges = m.edges.map((e) => ({ source: remap(e.source), target: remap(e.target), relation: e.relation })).filter((e) => e.source !== e.target);
      const boxes0 = [...free.map(boxOf), ...blocks.map((b) => ({ id: b.zone.id, x: b.zone.x, y: b.zone.y, w: b.w, h: b.h }))];
      const bb = bounds(boxes0)!;
      const pos = layoutMap(kind, lnodes, ledges, centralId ? remap(centralId) : null, { x: bb.x, y: bb.y });
      // Positions finales : cartes libres, puis contenu des zones décalé avec leur bloc.
      const npos = new Map<string, Pt>();
      const zpos = new Map<string, Pt>();
      for (const n of free) if (pos.has(n.id)) npos.set(n.id, pos.get(n.id)!);
      for (const b of blocks) {
        const p = pos.get(`zone:${b.zone.id}`);
        if (!p) continue;
        const dx = p.x - b.zone.x;
        const dy = p.y - b.zone.y;
        for (const id of b.members) {
          const n = byId.get(id);
          if (n) npos.set(id, { x: n.x + dx, y: n.y + dy });
        }
        for (const zid of [b.zone.id, ...b.inner]) {
          const z = m.zones!.find((x) => x.id === zid)!;
          zpos.set(zid, { x: z.x + dx, y: z.y + dy });
        }
      }
      // 19. Instantané « avant le rangement » (+ étape d'annulation distincte).
      beforeAutoLayout(sourceKey(srcRef.current));
      if (!reducedMotion()) {
        setGlide(new Set(npos.keys()));
        setZoneGlide(true);
        later(() => {
          setGlide(new Set());
          setZoneGlide(false);
        }, GLIDE_MS + 80);
      }
      mutate((mm) => ({
        ...mm,
        nodes: mm.nodes.map((n) => (npos.has(n.id) ? { ...n, x: Math.round(npos.get(n.id)!.x), y: Math.round(npos.get(n.id)!.y) } : n)),
        ...(mm.zones ? { zones: mm.zones.map((z) => (zpos.has(z.id) ? { ...z, x: Math.round(zpos.get(z.id)!.x), y: Math.round(zpos.get(z.id)!.y) } : z)) } : {}),
      }));
      separateUndoStep();
      later(() => {
        const nb = [
          ...free.filter((n) => npos.has(n.id)).map((n) => ({ ...boxOf(n), ...npos.get(n.id)! })),
          ...blocks.filter((b) => zpos.has(b.zone.id)).map((b) => ({ id: b.zone.id, ...zpos.get(b.zone.id)!, w: b.w, h: b.h })),
        ];
        const r = bounds(nb);
        if (r) fitBox({ x: r.x, y: r.y, width: r.w, height: r.h }, GLIDE_MS);
      }, 40);
      const label = LAYOUTS.find((l) => l.id === kind)?.label ?? '';
      useStore.getState().toast(`Carte rangée : ${label}. ${fmtKeys('⌘Z')} pour revenir.`, 'success');
    },
    [rf, readMap, hlById, bookOrder, multi, centralId, fitBox, sizes, mutate],
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

  // ── 12. Zones ──
  /** Encadre des cartes dans une nouvelle zone, dont le titre passe aussitôt en édition. */
  const frameInZone = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      separateUndoStep();
      let zid = '';
      mutate((m) => {
        const r = createZoneAround(m, ids, { lookup: lookup(), sizes: sizes(), id: uid });
        zid = r.zone.id;
        return r.map;
      });
      setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
      setEditingZone(zid);
    },
    [mutate, sizes, setNodes],
  );
  const toggleZone = useCallback(
    (z: MapZone) => {
      separateUndoStep();
      mutate((m) => (z.collapsed ? expandZone(m, z.id) : collapseZone(m, z.id, lookup(), sizes())));
    },
    [mutate, sizes],
  );
  const deleteZone = useCallback(
    (z: MapZone) => {
      separateUndoStep();
      mutate((m) => removeZone(m, z.id));
      useStore.getState().toast(`Zone « ${z.title} » retirée : les cartes restent. ${fmtKeys('⌘Z')} pour revenir.`, 'info');
    },
    [mutate],
  );
  const zonePalette = (z: MapZone): MenuEntry[] =>
    ZONE_PALETTE.map((c) => ({
      label: c.label,
      swatch: `var(${c.id})`,
      checked: z.color === c.id,
      onClick: () => {
        separateUndoStep();
        mutate((m) => updateZone(m, z.id, { color: c.id }));
      },
    }));
  const onZoneMenu = (e: React.MouseEvent, z: MapZone) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu(null);
    const entries: MenuEntry[] = [
      { label: 'Renommer', icon: <Pencil size={14} />, onClick: () => setEditingZone(z.id) },
      { label: 'Couleur', icon: <Palette size={14} />, children: zonePalette(z) },
      z.collapsed
        ? { label: 'Déplier la zone', icon: <ChevronsUpDown size={14} />, onClick: () => toggleZone(z) }
        : { label: 'Replier la zone', icon: <ChevronsDownUp size={14} />, onClick: () => toggleZone(z) },
    ];
    if (!z.collapsed)
      entries.push({
        label: 'Sélectionner ses cartes',
        icon: <MousePointer2 size={14} />,
        onClick: () => select(readMap().nodes.filter((n) => rf.getNode(n.id) && insideZone(rf.getNode(n.id)!, z)).map((n) => n.id)),
      });
    entries.push({ sep: true }, { label: 'Supprimer la zone', hint: 'les cartes restent', icon: <Trash2 size={14} />, danger: true, onClick: () => deleteZone(z) });
    setNodeMenu({ x: e.clientX, y: e.clientY, entries, label: 'Menu de la zone' });
  };
  const onZonePalette = (e: React.MouseEvent, z: MapZone) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setNodeMenu({ x: r.left, y: r.bottom + 6, entries: zonePalette(z), label: 'Couleur de la zone' });
  };

  // ── 15. Signaux de manques ──
  /** Centre la vue sur une carte (à gauche du panneau latéral) et la met en évidence. */
  const focusNode = useCallback(
    (id: string) => {
      const z = (readMap().zones ?? []).find((x) => x.collapsed && x.hiddenNodeIds?.includes(id));
      if (z) mutate((m) => expandZone(m, z.id));
      later(() => {
        const n = rf.getNode(id);
        if (!n) return;
        const b = boxOf(n);
        const zoom = Math.max(rf.getZoom(), 0.85);
        const shift = sidePanel ? 170 / zoom : 0;
        select([id]);
        rf.setCenter(b.x + b.w / 2 + shift, b.y + b.h / 2, { zoom, duration: reducedMotion() ? 0 : 420 });
        setFlash(id);
        later(() => setFlash((f) => (f === id ? null : f)), 1800);
      }, z ? 80 : 0);
    },
    [readMap, mutate, rf, select, sidePanel],
  );
  const placeFromGaps = useCallback(
    (ids: string[]) => {
      const nids = placeHighlights(sourceKey(srcRef.current), ids);
      if (srcRef.current.kind === 'board') setTick((t) => t + 1);
      if (!nids.length) return;
      useStore.getState().toast(nids.length > 1 ? `${nids.length} extraits placés sur la carte` : 'Extrait placé sur la carte', 'success');
      later(() => {
        select(nids);
        if (nids.length === 1) focusNode(nids[0]);
        else {
          const sel = rf.getNodes().filter((n) => nids.includes(n.id));
          if (sel.length) fitBox(rf.getNodesBounds(sel), 450, 1);
        }
      }, 80);
    },
    [select, focusNode, rf, fitBox],
  );
  const toggleMarks = () => {
    pref.set('gaps', !gapMarksOn);
    setGapMarksOn(!gapMarksOn);
  };

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

  // 11. Passage du livre à côté, déposé (ou « Sur la carte ») : la carte est créée à l'endroit voulu.
  usePassagePlacer((hid, at) => {
    const had = readMap().nodes.find((n) => n.highlightId === hid);
    if (had) {
      select([had.id]);
      later(() => reveal(had.id), 60);
      return had.id;
    }
    const id = uid();
    const pos = at ?? freePosition();
    const bookOfHl = useStore.getState().highlights.find((h) => h.id === hid)?.bookId;
    pendingSelect.current = id;
    mutate((m) => ({
      ...m,
      nodes: [...m.nodes, { id, highlightId: hid, text: '', x: Math.round(pos.x), y: Math.round(pos.y) }],
      // Carte libre : le livre du passage rejoint ceux de la carte.
      ...(m.kind === 'board' && bookOfHl && !(m.bookIds ?? []).includes(bookOfHl) ? { bookIds: [...(m.bookIds ?? []), bookOfHl] } : {}),
    }));
    if (!at) later(() => reveal(id), 90);
    return id;
  });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    if (isPassageDrag(e)) {
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      dropPassage({ x: e.clientX, y: e.clientY }, { x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - 40) });
      return;
    }
    const hid = e.dataTransfer.getData('text/marginalia-hl');
    if (!hid) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addHighlightNode(hid, { x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - 40) });
  };

  /** 17. Carte d'un mouvement : extraits du mouvement proposés en premier dans « À placer ». */
  const priority = useMovementPriority(map, highlights);
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
    } else if (matchKeys(e, '⌘G') && sel.length) {
      stop();
      frameInZone(sel.map((n) => n.id));
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
    } else if (e.key === 'Escape' && chain.rootId) {
      stop();
      chain.stop();
    } else if (matchKeys(e, CHAIN_KEY) && (one || chain.rootId)) {
      // L : suivre la chaîne de la carte choisie (de nouveau : quitter).
      stop();
      if (one && one.id !== chain.rootId) chain.start(one.id);
      else chain.stop();
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
      entries.push(
        chain.rootId === node.id
          ? { label: 'Quitter la chaîne', icon: <Link2 size={14} />, hint: 'Échap', onClick: chain.stop }
          : { label: 'Suivre la chaîne', icon: <Link2 size={14} />, hint: CHAIN_KEY, onClick: () => chain.start(node.id) },
      );
      entries.push({ label: 'Nouvelle idée reliée dessous', icon: <CornerDownRight size={14} />, hint: 'Tab', onClick: () => addChild(node.id) });
      if (m.centralId === node.id) entries.push({ label: 'Ne plus marquer comme thèse centrale', icon: <Star size={14} />, onClick: () => setCentral(undefined) });
      else if (centralId !== node.id) entries.push({ label: 'Marquer comme thèse centrale', icon: <Star size={14} />, onClick: () => setCentral(node.id) });
      entries.push({ label: 'Encadrer dans une zone', icon: <Group size={14} />, hint: fmtKeys('⌘G'), onClick: () => frameInZone([node.id]) });
      entries.push({ sep: true });
    } else {
      const ideaIds = group.filter((n) => n.type === 'idea').map((n) => n.id);
      entries.push({ label: 'Aligner', icon: <AlignStartVertical size={14} />, children: alignEntries() });
      if (ideaIds.length) entries.push({ label: ideaIds.length > 1 ? `Couleur des ${ideaIds.length} idées` : 'Couleur de l’idée', icon: <Palette size={14} />, children: colorEntries(ideaIds) });
      entries.push({ label: 'Encadrer dans une zone', icon: <Group size={14} />, hint: fmtKeys('⌘G'), onClick: () => frameInZone(group.map((n) => n.id)) });
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
  /** Barre d'outils : éléments ajoutés par les fonctionnalités (voir MapToolbarItem). */
  const panelBtn = (id: string, label: string, icon: React.ReactNode, title: string) => (
    <button className={`btn btn-ghost btn-sm ${sidePanel === id ? 'active' : ''}`} data-act={id} aria-pressed={sidePanel === id} onClick={() => setSidePanel((p) => (p === id ? null : id))} title={title}>
      {icon} {label}
    </button>
  );
  const toolbarItems: MapToolbarItem[] = [
    { id: 'export', order: 10, group: 'share', node: <ExportMenu mapKey={key} empty={empty} sizes={sizes} /> },
    { id: 'versions', order: 20, group: 'share', node: panelBtn('versions', 'Versions', <History size={14} />, versionCount ? `Versions de la carte (${versionCount})` : 'Versions de la carte') },
  ];
  toolbarItems.push({ id: 'chain', order: 5, group: 'chain', node: <ChainButton ctl={chain} selected={selIds} /> });
  if (tools) toolbarItems.push(...tools);
  if (gaps.total) toolbarItems.push({ id: 'gaps', order: 90, group: 'gaps', node: <GapsPill total={gaps.total} open={sidePanel === 'gaps'} onClick={() => setSidePanel((p) => (p === 'gaps' ? null : 'gaps'))} /> });

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
        className={`map-root ${dropping ? 'map-dropping' : ''} ${prefit ? 'map-prefit' : ''} ${dragging ? 'map-dragging' : ''} ${selectTool ? 'map-selecttool' : ''} ${narrow ? 'map-narrow' : ''}`}
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
          if (e.dataTransfer.types.includes('text/marginalia-hl') || e.dataTransfer.types.includes(PASSAGE_TYPE)) {
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
          onNodeClick={(_, node) => {
            setSelEdge(null);
            setMenu(null);
            // Chaîne suivie : cliquer une autre carte la recentre sur celle-ci.
            if (chain.rootId && chain.rootId !== node.id) chain.start(node.id);
          }}
          onPaneClick={() => {
            chain.stop();
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
          <ZoneLayer
            zones={map.zones ?? []}
            map={map}
            mutate={mutate}
            readMap={readMap}
            sizes={sizes}
            setNodes={setNodes}
            editingId={editingZone}
            setEditingId={setEditingZone}
            dropTarget={dropZone}
            glide={zoneGlide}
            onMenu={onZoneMenu}
            onPalette={onZonePalette}
            onToggle={toggleZone}
            onDelete={deleteZone}
          />
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
            extra={
              <button className="icon-btn sm" data-act="frame-zone" title={fmtKeys('Encadrer dans une zone (⌘G)')} aria-label="Encadrer dans une zone" onClick={() => frameInZone(selKey.split('|'))}>
                <Group size={15} />
              </button>
            }
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
        {!empty && !sidePanel && (
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
              <h3>{map.kind === 'movement' ? 'La carte de ce mouvement' : 'Une carte à construire'}</h3>
              <p>
                {map.kind === 'movement' && priority?.ids.size
                  ? 'Les extraits situés dans ce mouvement sont proposés en tête du tiroir « À placer » : posez-les, puis reliez-les.'
                  : highlights.length
                  ? 'Posez ici les extraits qui comptent, puis reliez-les : un argument soutient une thèse, une objection s’y attaque, une réponse la pare.'
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
          bookOf={multi && map.kind !== 'movement' ? (h) => bookTags.get(h.bookId) || bookShortName(books.find((b) => b.id === h.bookId)) : undefined}
          priority={priority}
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
          items={toolbarItems}
        />

        {sidePanel === 'gaps' && (
          <GapsPanel
            messages={gapMsgs}
            total={gaps.total}
            marks={gapMarksOn}
            titleOf={titleOf}
            onToggleMarks={toggleMarks}
            onFocus={focusNode}
            onPlace={placeFromGaps}
            onClose={() => setSidePanel(null)}
          />
        )}
        <ChainPanel
          ctl={chain}
          map={map}
          hidden={hidden}
          onFocus={focusNode}
          onFit={(ids) => {
            const ns = rf.getNodes().filter((n) => ids.includes(n.id) && !n.hidden);
            if (ns.length) fitBox(rf.getNodesBounds(ns), 450, 1);
          }}
        />
        {sidePanel === 'versions' && <VersionsPanel mapKey={key} onClose={() => setSidePanel(null)} />}

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
            onNote={(t) => {
              const id = menu.edgeId;
              separateUndoStep();
              mutate((m) => setEdgeNote(m, id, t));
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
export function ArgumentMapView(props: ({ bookId: string } | { source: MapSource }) & { tools?: MapToolbarItem[] }) {
  const source: MapSource = 'source' in props ? props.source : { kind: 'book', bookId: props.bookId };
  return (
    <ReactFlowProvider>
      <Inner key={`${source.kind}:${sourceKey(source)}`} source={source} tools={props.tools} />
    </ReactFlowProvider>
  );
}
