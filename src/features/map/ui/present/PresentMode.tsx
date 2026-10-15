// 14. Lecture guidée / présentation : plein écran sobre qui parcourt les étapes de guidedReading
// (problème → thèse → arguments → objections → réponses → idées restantes). La carte courante est
// centrée et mise en valeur, celles déjà vues restent lisibles, les suivantes s'estompent ; les liens
// qui la rattachent à ce qui précède sont soulignés. ← / → / Espace pour avancer, Échap pour quitter.
// « Masquer le texte » (M) : chaque carte n'affiche que son rôle, un clic la révèle (s'entraîner à l'oral).
//
// Vue indépendante (sa propre instance React Flow, lecture seule) : la carte éditable n'est pas touchée.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { Background, BackgroundVariant, ConnectionMode, ReactFlow, ReactFlowProvider, useNodesInitialized, useNodesState, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { ChevronLeft, ChevronRight, Eye, EyeOff, X } from 'lucide-react';
import { useStore } from '../../../../lib/store';
import { kindColor } from '../../../../lib/categories';
import { fmtKeys } from '../../../../lib/keys';
import type { ArgumentMap, MapEdge } from '../../../../lib/types';
import { GUIDED_ROLE_LABEL, guidedReading, type GuidedStep } from '../../model/guided';
import { mapDisplayTitle } from '../../model/convert';
import { MapCtx, reducedMotion, type ExtractData, type IdeaData, type MapUiCtx, type RelEdgeData } from '../ctx';
import { ExtractNode, IdeaNode } from '../nodes';
import { ArrowDefs, edgeTypes } from '../edges';
import './present.css';

interface PresData {
  /** Le texte est masqué : seul le rôle s'affiche. */
  masked: boolean;
  role: string;
  color: string;
}

/** Enveloppe d'une carte : masque « rôle seulement » par-dessus la carte ordinaire. */
function presented(Inner: ComponentType<NodeProps>) {
  return function PresNode(props: NodeProps) {
    const p = (props.data as { pres: PresData }).pres;
    return (
      <div className={`pres-node ${p.masked ? 'masked' : ''}`} style={{ '--c': p.color } as CSSProperties}>
        <Inner {...props} />
        {p.masked && (
          <div className="pres-mask" data-testid="pres-mask">
            <b>{p.role}</b>
            <small>Cliquer pour révéler</small>
          </div>
        )}
      </div>
    );
  };
}
const presNodeTypes = { extract: presented(ExtractNode), idea: presented(IdeaNode) };

const NOOP_CTX: MapUiCtx = {
  editingId: null,
  setEditingId: () => {},
  setIdeaText: () => {},
  editTab: () => {},
  setCollapsed: () => {},
  openEdge: () => {},
  hoverEdge: () => {},
  jump: () => {},
};

/** Libellé court d'une étape : « Thèse », « Argument 2/4 ». */
function stepLabels(steps: GuidedStep[]): Map<string, string> {
  const total = new Map<string, number>();
  for (const s of steps) total.set(s.role, (total.get(s.role) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const s of steps) {
    const k = (seen.get(s.role) ?? 0) + 1;
    seen.set(s.role, k);
    const n = total.get(s.role)!;
    out.set(s.nodeId, n > 1 ? `${GUIDED_ROLE_LABEL[s.role]} ${k}/${n}` : GUIDED_ROLE_LABEL[s.role]);
  }
  return out;
}

function Present({ mapKey, onClose }: { mapKey: string; onClose(): void }) {
  const rf = useReactFlow();
  const storeMap = useStore((s) => s.maps[mapKey]);
  const map: ArgumentMap = storeMap ?? useStore.getState().getMap(mapKey);
  const highlights = useStore((s) => s.highlights);
  const books = useStore((s) => s.books);
  const studies = useStore((s) => s.studies);
  const lk = useMemo(() => ({ highlights, books, studies }), [highlights, books, studies]);
  const steps = useMemo(() => guidedReading(map, lk), [map, lk]);
  const labels = useMemo(() => stepLabels(steps), [steps]);
  const hlById = useMemo(() => new Map(highlights.map((h) => [h.id, h])), [highlights]);
  const [i, setI] = useState(0);
  const [hide, setHide] = useState(false);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const step = steps[Math.min(i, steps.length - 1)] ?? null;
  const order = useMemo(() => new Map(steps.map((s, k) => [s.nodeId, k])), [steps]);
  const central = map.centralId ?? map.nodes.find((n) => n.highlightId && hlById.get(n.highlightId)?.category === 'these')?.id ?? null;

  const wanted = useMemo<Node[]>(
    () =>
      map.nodes.map((n) => {
        const h = n.highlightId ? (hlById.get(n.highlightId) ?? null) : null;
        const k = order.get(n.id) ?? Infinity;
        const cur = step?.nodeId === n.id;
        const state = cur ? 'pres-cur' : k < i ? 'pres-seen' : 'pres-future';
        const pres: PresData = {
          masked: hide && !revealed.has(n.id),
          role: labels.get(n.id) ?? 'Carte',
          color: h ? kindColor(h) : n.color ? `var(${n.color})` : 'var(--cat-these)',
        };
        const data = h
          ? ({ highlight: h, central: n.id === central, collapsed: cur ? false : n.collapsed, pres } as ExtractData)
          : ({ text: n.text, central: n.id === central, color: n.color, pres } as IdeaData);
        return { id: n.id, type: n.highlightId ? 'extract' : 'idea', position: { x: n.x, y: n.y }, data, className: state, draggable: false, selectable: false, connectable: false } as Node;
      }),
    [map.nodes, hlById, order, step, i, hide, revealed, labels, central],
  );

  // Nœuds contrôlés : les mesures de React Flow (taille, poignées) sont conservées d'une étape à l'autre.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return wanted.map((n) => ({ ...(old.get(n.id) ?? {}), ...n }));
    });
  }, [wanted, setNodes]);

  const edges = useMemo<Edge[]>(() => {
    const groups = new Map<string, MapEdge[]>();
    for (const e of map.edges) if (e.groupId) groups.set(`${e.target}::${e.groupId}`, [...(groups.get(`${e.target}::${e.groupId}`) ?? []), e]);
    const lit = new Set(step?.edgesToHighlight ?? []);
    const shown = new Set(steps.slice(0, i + 1).map((s) => s.nodeId));
    return map.edges.map((e) => {
      const grp = e.groupId ? (groups.get(`${e.target}::${e.groupId}`) ?? []) : [];
      const bundle = grp.length > 1;
      const data: RelEdgeData = {
        relation: e.relation,
        strength: e.strength ?? 2,
        groupSources: bundle ? grp.map((g) => g.source) : [],
        lead: bundle ? [...grp].sort((a, b) => a.id.localeCompare(b.id))[0].id === e.id : false,
        hover: false,
        fresh: false,
      };
      const cls = lit.has(e.id) ? 'pres-edge-lit' : shown.has(e.source) && shown.has(e.target) ? 'pres-edge-seen' : 'pres-edge-dim';
      return { id: e.id, source: e.source, target: e.target, type: 'rel', data, selected: lit.has(e.id), className: cls, zIndex: lit.has(e.id) ? 5 : 0, selectable: false };
    });
  }, [map.edges, step, steps, i]);

  // Cadrage : la carte courante (et celle à laquelle elle se rattache) au centre.
  const ready = useNodesInitialized();
  const first = useRef(true);
  useEffect(() => {
    if (!ready || !step) return;
    const ids = [step.nodeId, ...(step.parentId ? [step.parentId] : [])];
    const list = ids.map((id) => rf.getNode(id)).filter(Boolean) as Node[];
    if (!list.length) return;
    const b = rf.getNodesBounds(list);
    const cur = rf.getNode(step.nodeId)!;
    const w = cur.measured?.width ?? 280;
    const h = cur.measured?.height ?? 160;
    const cx = cur.position.x + w / 2;
    const cy = cur.position.y + h / 2;
    // Zoom : la paire tient dans la fenêtre, sans dépasser 1,15 ; centré sur la carte courante.
    const vw = window.innerWidth - 160;
    const vh = window.innerHeight - 260;
    const zoom = Math.max(0.35, Math.min(1.15, vw / Math.max(1, b.width * 1.15 + 80), vh / Math.max(1, b.height * 1.1 + 60)));
    rf.setCenter(cx, cy + 40 / zoom, { zoom, duration: first.current || reducedMotion() ? 0 : 650 });
    first.current = false;
  }, [ready, step?.nodeId, rf]);

  const go = useCallback((d: number) => setI((k) => Math.max(0, Math.min(steps.length - 1, k + d))), [steps.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      let used = true;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'PageDown' || k === 'Enter') go(e.shiftKey && k === ' ' ? -1 : 1);
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') go(-1);
      else if (k === 'Home') setI(0);
      else if (k === 'End') setI(steps.length - 1);
      else if (k === 'Escape') onClose();
      else if (k.toLowerCase() === 'm') setHide((v) => !v);
      else used = false;
      if (used) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, onClose, steps.length]);

  const title = mapDisplayTitle(map, lk);
  const color = step ? (wanted.find((n) => n.id === step.nodeId)?.data as { pres: PresData } | undefined)?.pres.color : undefined;
  const pct = steps.length > 1 ? (i / (steps.length - 1)) * 100 : 100;

  return (
    <MapCtx.Provider value={NOOP_CTX}>
      <div className="map-root pres-root anim-fade" role="dialog" aria-modal="true" aria-label={`Présentation : ${title}`} data-testid="present">
        <ArrowDefs />
        <ReactFlow
          className="map-flow pres-flow"
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          nodeTypes={presNodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          disableKeyboardA11y
          minZoom={0.2}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => {
            if (hide) {
              setRevealed((s) => {
                const next = new Set(s);
                if (next.has(n.id)) next.delete(n.id);
                else next.add(n.id);
                return next;
              });
            } else {
              const k = order.get(n.id);
              if (k != null) setI(k);
            }
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.15} color="var(--map-dot)" />
        </ReactFlow>

        <header className="pres-top">
          <span className="pres-kicker">Lecture guidée</span>
          <span className="pres-title truncate">{title}</span>
          <span className="spacer" />
          <button
            className={`pres-toggle ${hide ? 'on' : ''}`}
            onClick={() => {
              setHide((v) => !v);
              setRevealed(new Set());
            }}
            aria-pressed={hide}
            data-testid="pres-hide"
            title="S’entraîner à l’oral : chaque carte n’affiche que son rôle ; un clic la révèle (M)"
          >
            {hide ? <EyeOff size={14} /> : <Eye size={14} />} Masquer le texte
          </button>
          <button className="pres-close" onClick={onClose} title="Quitter la présentation (Échap)" aria-label="Quitter la présentation" data-testid="pres-close">
            <X size={16} />
          </button>
        </header>

        {step ? (
          <footer className="pres-foot">
            <div className="pres-caption anim-in" key={step.nodeId} style={{ '--c': color ?? 'var(--focus)' } as CSSProperties}>
              <span className="pres-role" data-testid="pres-role">
                {labels.get(step.nodeId)}
              </span>
              <span className="pres-text" data-testid="pres-caption">
                {step.caption}
              </span>
            </div>
            <div className="pres-nav">
              <button className="pres-nav-btn" onClick={() => go(-1)} disabled={i === 0} aria-label="Étape précédente" title="Étape précédente (←)">
                <ChevronLeft size={18} />
              </button>
              <span className="pres-count" data-testid="pres-count">
                {i + 1} <i>/</i> {steps.length}
              </span>
              <button className="pres-nav-btn" onClick={() => go(1)} disabled={i >= steps.length - 1} aria-label="Étape suivante" title="Étape suivante (→ ou Espace)">
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="pres-keys">{fmtKeys('← → ou Espace pour avancer · M masque le texte · Échap pour quitter')}</div>
          </footer>
        ) : (
          <div className="pres-empty">
            <p>La carte est vide : rien à présenter.</p>
          </div>
        )}
        <div className="pres-progress" aria-hidden>
          <span style={{ width: `${pct}%` }} data-testid="pres-progress" />
        </div>
      </div>
    </MapCtx.Provider>
  );
}

export function PresentMode({ mapKey, onClose }: { mapKey: string; onClose(): void }) {
  return createPortal(
    <ReactFlowProvider>
      <Present mapKey={mapKey} onClose={onClose} />
    </ReactFlowProvider>,
    document.body,
  );
}
