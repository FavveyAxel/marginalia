// « Suivre une chaîne » : état, feuille de style, bouton et panneau flottant.
//
// Le calcul est dans model/chain.ts. Pour rester instantané sur des centaines de cartes, le mode ne
// fait re-rendre ni la vue de la carte ni React Flow :
//  - l'état (carte suivie, sens) vit dans un petit magasin propre à la carte (ChainCtl), lu par la
//    vue au moment d'un geste (clavier, clic, menu) et observé seulement par le panneau et le bouton ;
//  - le panneau, monté dans .map-root, y pose une feuille de style générée : tout s'estompe
//    (.map-root:has(> .map-chain-panel), voir chain.css) sauf les cartes et liens de la chaîne,
//    repérés par leur id ([data-id], [data-testid]). Opacité et filtre seulement : aucune remise en page.
// Les cartes masquées (zones repliées, branches pliées) ne sont pas rendues : la vue passe leur
// ensemble (`hidden`) au calcul, qui les ignore.
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Link2, ScanSearch, X } from 'lucide-react';
import { useStore } from '../../../lib/store';
import type { ArgumentMap } from '../../../lib/types';
import { chainSummary, computeChain, type Chain, type ChainRole } from '../model/chain';
import './chain.css';

/** Raccourci (touche seule, une carte choisie) : « L » comme « liens ». C, M, S, H, N servent ailleurs. */
export const CHAIN_KEY = 'L';

interface ChainSnap {
  /** Carte suivie (null : mode inactif). */
  rootId: string | null;
  /** Suivre aussi les conséquences (ce que la carte soutient). */
  up: boolean;
}

/** Commande du mode, stable pour toute la vie de la carte (lecture à l'instant du geste). */
export interface ChainCtl {
  readonly rootId: string | null;
  start(id: string): void;
  stop(): void;
  setUp(v: boolean): void;
  snap(): ChainSnap;
  subscribe(fn: () => void): () => void;
}

function createChainCtl(): ChainCtl {
  let snap: ChainSnap = { rootId: null, up: false };
  const subs = new Set<() => void>();
  const set = (p: Partial<ChainSnap>) => {
    const next = { ...snap, ...p };
    if (next.rootId === snap.rootId && next.up === snap.up) return;
    snap = next;
    subs.forEach((f) => f());
  };
  return {
    get rootId() {
      return snap.rootId;
    },
    start: (id) => set({ rootId: id }),
    stop: () => set({ rootId: null }),
    setUp: (up) => set({ up }),
    snap: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}

export function useChainCtl(): ChainCtl {
  return useState(createChainCtl)[0];
}
const useSnap = (ctl: ChainCtl) => useSyncExternalStore(ctl.subscribe, ctl.snap);

const q = (id: string) => `"${CSS.escape(id)}"`;
const nodeSel = (ids: string[]) => `.map-root:has(> .map-chain-panel) .map-flow :is(${ids.map((id) => `.react-flow__node[data-id=${q(id)}]`).join(',')})`;
const edgeSel = (ids: string[]) => `.map-root:has(> .map-chain-panel) .map-flow :is(${ids.map((id) => `.react-flow__edge[data-testid=${q(`rf__edge-${id}`)}]`).join(',')})`;

/** Feuille de style de la chaîne : cartes et liens nets, anneaux selon le rôle. */
export function chainCss(chain: Chain): string {
  const byRole: Record<ChainRole, string[]> = { root: [], support: [], objection: [], reply: [], consequence: [] };
  for (const [id, r] of Object.entries(chain.role)) byRole[r].push(id);
  const out = [`${nodeSel(Object.keys(chain.role))}{opacity:1;filter:none}`];
  for (const r of ['root', 'objection', 'reply', 'consequence'] as const) if (byRole[r].length) out.push(`${nodeSel(byRole[r])} .map-node{box-shadow:var(--chain-ring-${r})}`);
  if (chain.edges.length) {
    out.push(`${edgeSel(chain.edges)}{opacity:1}`);
    out.push(`${edgeSel(chain.edges)} .map-edge-halo{stroke-opacity:.16}`);
    // Étiquettes des liens (rendues hors des liens).
    out.push(`.map-root:has(> .map-chain-panel) :is(${chain.edges.map((id) => `.map-pill[data-edge=${q(id)}]`).join(',')}){opacity:1}`);
  }
  return out.join('\n');
}

/** Texte court d'une carte (début de l'extrait ou de l'idée). */
function useShortText(map: ArgumentMap, id: string | null | undefined, words = 7): string {
  const node = id ? map.nodes.find((n) => n.id === id) : undefined;
  const hlText = useStore((s) => (node?.highlightId ? (s.highlights.find((h) => h.id === node.highlightId)?.text ?? '') : ''));
  if (!node) return '';
  const base = (node.highlightId ? hlText : node.text).replace(/\s+/g, ' ').trim();
  const list = base.split(' ');
  return list.length > words ? `${list.slice(0, words).join(' ')}…` : base || 'Idée sans texte';
}

/** Bouton de la barre d'outils : suivre la chaîne de la carte choisie, ou quitter. */
export function ChainButton({ ctl, selected }: { ctl: ChainCtl; selected: string[] }) {
  const { rootId } = useSnap(ctl);
  const on = !!rootId;
  return (
    <button
      className={`icon-btn map-bar-icon ${on ? 'on' : ''}`}
      data-act="chain"
      aria-pressed={on}
      disabled={!on && selected.length !== 1}
      onClick={() => (on ? ctl.stop() : selected.length === 1 && ctl.start(selected[0]))}
      title={on ? 'Quitter la chaîne (Échap)' : `Suivre la chaîne de la carte choisie (${CHAIN_KEY})`}
    >
      <Link2 size={15} />
    </button>
  );
}

export function ChainPanel({
  ctl,
  map,
  hidden,
  onFocus,
  onFit,
}: {
  ctl: ChainCtl;
  map: ArgumentMap;
  hidden: ReadonlySet<string>;
  /** Centre la vue sur une carte (point fragile). */
  onFocus(id: string): void;
  /** Cadre toutes les cartes de la chaîne. */
  onFit(ids: string[]): void;
}) {
  const { rootId, up } = useSnap(ctl);
  // Recalcul seulement quand la structure change (pas quand une carte est déplacée).
  const nodeKey = rootId ? map.nodes.map((n) => n.id).join('|') : '';
  const chain = useMemo(
    () => (rootId ? computeChain(map, rootId, { consequences: up, hidden }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeKey, map.edges, rootId, up, hidden],
  );
  // La carte suivie a disparu (supprimée, masquée) : on sort du mode.
  useEffect(() => {
    if (rootId && !chain) ctl.stop();
  }, [rootId, chain, ctl]);
  const rootText = useShortText(map, chain?.root);
  const fragileId = chain?.diagnosis.fragile[0];
  const fragileText = useShortText(map, fragileId, 6);
  const css = useMemo(() => (chain ? chainCss(chain) : ''), [chain]);
  if (!chain) return null;
  const parts = chainSummary(chain.diagnosis, { consequences: up });
  return (
    <div className="map-chain-panel anim-in nodrag nopan" role="region" aria-label="Suivre une chaîne" data-testid="map-chain">
      <style>{css}</style>
      <div className="map-chain-head">
        <Link2 size={14} className="map-chain-ico" aria-hidden />
        <span className="map-chain-title">
          Chaîne de : <b data-testid="map-chain-root">« {rootText} »</b>
        </span>
        <button className="icon-btn sm" data-act="chain-fit" title="Cadrer la chaîne" aria-label="Cadrer la chaîne" onClick={() => onFit(Object.keys(chain.role))}>
          <ScanSearch size={14} />
        </button>
      </div>
      <p className="map-chain-diag" data-testid="map-chain-diag">
        {parts.map((p, i) => (
          <Fragment key={i}>
            {i > 0 && <i aria-hidden> · </i>}
            <span className={/sans réponse|aucun appui/.test(p) ? 'warn' : undefined}>{p}</span>
          </Fragment>
        ))}
      </p>
      {fragileId && (
        <button className="map-chain-fragile" data-act="chain-fragile" data-node={fragileId} onClick={() => onFocus(fragileId)} title="Centrer cette carte">
          <AlertTriangle size={13} aria-hidden />
          <span>
            Point fragile : tout repose sur <b>“{fragileText}”</b>
          </span>
        </button>
      )}
      <div className="map-chain-foot">
        <div className="map-chain-seg" role="radiogroup" aria-label="Direction suivie">
          <button role="radio" aria-checked={!up} className={!up ? 'on' : ''} data-act="chain-down" onClick={() => ctl.setUp(false)} title="Ce qui appuie la carte, et ce qui l’attaque">
            Appuis
          </button>
          <button role="radio" aria-checked={up} className={up ? 'on' : ''} data-act="chain-up" onClick={() => ctl.setUp(true)} title="Suivre aussi ce que la carte soutient">
            Conséquences
          </button>
        </div>
        <button className="map-chain-quit" data-act="chain-quit" onClick={ctl.stop}>
          <X size={12} aria-hidden /> Quitter <kbd>Échap</kbd>
        </button>
      </div>
    </div>
  );
}
