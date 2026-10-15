// Portails entre cartes : une carte posée sur une carte mène à une autre carte (libre, de livre,
// de mouvement). Ici : la carte « portail » (nœud React Flow), la navigation (avec une petite pile
// « ← Revenir à… » en mémoire), le sélecteur de cartes, les rétroliens (« Liée depuis N cartes »)
// et le badge « aussi dans N cartes » des extraits. Le modèle pur est dans model/portals.ts.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { create } from 'zustand';
import { ArrowLeft, ArrowRight, BookOpen, Layers, Network, Search, Unlink, Waypoints } from 'lucide-react';
import { useStore } from '../../../lib/store';
import type { ArgumentMap } from '../../../lib/types';
import { ContextMenu, type MenuEntry } from '../../workspaces/wsUi';
import { BoardThumb } from './BoardThumb';
import { useMapCtx } from './ctx';
import { goToMovementMap, useMapChoice } from './movement/movement';
import { PORTAL_KIND_LABEL, backlinksOf, mapChoices, otherMapsOfExtract, portalNode, portalTarget, type MapKind, type PortalTarget } from '../model/portals';
import type { MapLookup } from '../model/core';
import { lookup, updateMap } from '../model/actions';
import { placeNewNodes } from '../model/copy';
import { separateUndoStep, uid } from '../../../lib/store';

export interface PortalData extends Record<string, unknown> {
  portal: string;
  central: boolean;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n > 1 ? many : one}`;
const KIND_ICON: Record<MapKind, JSX.Element> = {
  board: <Network size={13} />,
  book: <BookOpen size={13} />,
  movement: <Layers size={13} />,
};

/** Lecture des cibles (réactive) : cartes, livres, fiches-texte. */
function useLk(): { maps: Record<string, ArgumentMap>; lk: MapLookup } {
  const maps = useStore((s) => s.maps);
  const books = useStore((s) => s.books);
  const studies = useStore((s) => s.studies);
  return useMemo(() => ({ maps, lk: { highlights: [], books, studies } }), [maps, books, studies]);
}

const lkNow = (): MapLookup => {
  const s = useStore.getState();
  return { highlights: [], books: s.books, studies: s.studies };
};

/** Titre lisible d'une carte (ou null si elle n'existe plus). */
export function mapTitleNow(key: string): string | null {
  return portalTarget(useStore.getState().maps, key, lkNow())?.title ?? null;
}

/** Pose un portail vers `targetKey` sur la carte `key`, dans un coin libre. Renvoie l'id de la carte posée. */
export function addPortal(key: string, targetKey: string): string | null {
  const title = mapTitleNow(targetKey);
  if (!title || key === targetKey) return null;
  separateUndoStep();
  let id: string | null = null;
  updateMap(key, (m) => {
    const [n] = placeNewNodes(m, [portalNode(targetKey, { x: 0, y: 0 }, uid(), title)], lookup());
    id = n.id;
    return { ...m, nodes: [...m.nodes, n] };
  });
  return id;
}

// ── Navigation ──────────────────────────────────────────────
/** Ouvre une carte là où elle vit : page de la carte libre, onglet Carte du livre, carte du mouvement. */
export function openMapKey(key: string): boolean {
  const s = useStore.getState();
  const t = portalTarget(s.maps, key, lkNow());
  if (!t) {
    s.toast('Cette carte n’existe plus', 'error');
    return false;
  }
  const m = t.map;
  if (t.kind === 'board') {
    s.navigate({ name: 'board', boardId: key });
    return true;
  }
  if (t.kind === 'movement' && m.studyId && m.movementId && goToMovementMap(m.studyId, m.movementId)) return true;
  const bookId = t.kind === 'book' ? key : m.bookId;
  useMapChoice.getState().choose(bookId, t.kind === 'movement' ? key : null);
  const r = s.route;
  s.navigate({ name: 'reader', bookId, tab: 'carte', splitBookId: r.name === 'reader' && r.bookId === bookId ? r.splitBookId : null });
  return true;
}

/** Pile des sauts par portail (en mémoire, non persistée) : de quelle carte vient-on ? */
export const usePortalTrail = create<{ stack: { from: string; to: string }[]; push(from: string, to: string): void; pop(): { from: string; to: string } | undefined }>((set, get) => ({
  stack: [],
  push: (from, to) => set((s) => ({ stack: [...s.stack, { from, to }].slice(-30) })),
  pop: () => {
    const st = get().stack;
    const last = st[st.length - 1];
    if (last) set({ stack: st.slice(0, -1) });
    return last;
  },
}));

/** Saut d'une carte à une autre : mémorise d'où l'on vient (« ← Revenir à… »). */
export function jumpToMap(fromKey: string | undefined, toKey: string): boolean {
  if (fromKey === toKey) return false;
  const ok = openMapKey(toKey);
  if (ok && fromKey) usePortalTrail.getState().push(fromKey, toKey);
  return ok;
}

/** Pastille « ← Revenir à <carte précédente> », affichée sur la carte où un portail a mené. */
export function PortalBackPill({ mapKey }: { mapKey: string }) {
  const last = usePortalTrail((s) => s.stack[s.stack.length - 1]);
  const { maps, lk } = useLk();
  if (!last || last.to !== mapKey) return null;
  const t = portalTarget(maps, last.from, lk);
  if (!t) return null;
  return (
    <button
      className="map-portal-back anim-in"
      data-testid="portal-back"
      title={`Revenir à « ${t.title} »`}
      onClick={() => {
        usePortalTrail.getState().pop();
        openMapKey(last.from);
      }}
    >
      <ArrowLeft size={13} />
      <span className="map-portal-back-lbl">Revenir à</span>
      <b className="truncate">{t.title}</b>
    </button>
  );
}

// ── Carte « portail » ───────────────────────────────────────
const sides: [Position, string][] = [
  [Position.Top, 't'],
  [Position.Right, 'r'],
  [Position.Bottom, 'b'],
  [Position.Left, 'l'],
];

export function PortalNode({ data, selected }: NodeProps) {
  const ctx = useMapCtx();
  const d = data as PortalData;
  const tmap = useStore((s) => s.maps[d.portal]);
  const books = useStore((s) => s.books);
  const studies = useStore((s) => s.studies);
  const t = useMemo<PortalTarget | null>(
    () => (tmap ? portalTarget({ [d.portal]: tmap }, d.portal, { highlights: [], books, studies }) : null),
    [tmap, d.portal, books, studies],
  );
  const open = (e?: ReactMouseEvent) => {
    e?.stopPropagation();
    if (t) jumpToMap(ctx?.mapKey, d.portal);
  };
  const handles = sides.map(([p, id]) => <Handle key={id} id={id} type="source" position={p} className={`map-h map-h-${id}`} />);
  if (!t) {
    return (
      <div className={`map-node map-portal missing ${selected ? 'sel' : ''}`} data-portal={d.portal} data-testid="portal-node">
        <div className="map-portal-head">
          <Unlink size={13} />
          <span className="map-node-cat">Portail</span>
        </div>
        <p className="map-portal-missing">Carte introuvable</p>
        <p className="map-portal-meta muted">Elle a été supprimée (voir la corbeille). Supprimez ce portail ou restaurez la carte.</p>
        {handles}
      </div>
    );
  }
  return (
    <div
      className={`map-node map-portal ${selected ? 'sel' : ''}`}
      data-portal={d.portal}
      data-kind={t.kind}
      data-testid="portal-node"
      style={{ '--c': `var(--portal-${t.kind})` } as CSSProperties}
      onDoubleClick={open}
      title="Double-clic : ouvrir la carte liée"
    >
      <div className="map-portal-head">
        <Waypoints size={13} />
        <span className="map-node-cat">Portail · {PORTAL_KIND_LABEL[t.kind]}</span>
      </div>
      <div className="map-portal-body">
        <div className="map-portal-thumb">
          <BoardThumb map={t.map} />
        </div>
        <div className="map-portal-info">
          <b className="map-portal-title" data-testid="portal-title">
            {t.title}
          </b>
          {t.sub && <span className="map-portal-sub truncate">{t.sub}</span>}
          <span className="map-portal-meta">{t.nodeCount ? plural(t.nodeCount, 'carte') : 'Carte vide'}</span>
        </div>
      </div>
      <div className="map-portal-foot">
        <button type="button" className="map-portal-open nodrag" data-act="portal-open" onClick={open} onDoubleClick={(e) => e.stopPropagation()}>
          Ouvrir <ArrowRight size={13} />
        </button>
      </div>
      {handles}
    </div>
  );
}

// ── Sélecteur de cartes ─────────────────────────────────────
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Petit sélecteur flottant (recherche + liste) des cartes vers lesquelles poser un lien. */
export function MapPicker({ x, y, exceptKey, onPick, onClose }: { x: number; y: number; exceptKey?: string; onPick(key: string, title: string): void; onClose(): void }) {
  const { maps, lk } = useLk();
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const all = useMemo(() => mapChoices(maps, lk, exceptKey), [maps, lk, exceptKey]);
  const shown = useMemo(() => {
    const n = fold(q.trim());
    return n ? all.filter((t) => fold(`${t.title} ${t.sub} ${PORTAL_KIND_LABEL[t.kind]}`).includes(n)) : all;
  }, [all, q]);
  useEffect(() => setFocus(0), [q]);
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [onClose]);
  // Bas de l'écran (barre d'outils, clic près du bord) : le sélecteur s'ouvre au-dessus du point.
  const left = Math.max(8, Math.min(window.innerWidth - 348, x));
  const up = y > window.innerHeight * 0.6;
  const place: CSSProperties = up ? { left, bottom: Math.max(8, window.innerHeight - y) } : { left, top: Math.max(8, Math.min(window.innerHeight - 420, y)) };
  const pick = (t: PortalTarget) => {
    onPick(t.key, t.title);
    onClose();
  };
  return createPortal(
    <div ref={ref} className="floating map-portal-picker anim-scale" style={place} role="dialog" aria-label="Lien vers une autre carte" data-testid="portal-picker">
      <div className="map-portal-picker-head">
        <Waypoints size={14} />
        <b>Lien vers une autre carte</b>
      </div>
      <label className="map-portal-picker-search">
        <Search size={13} />
        <input
          autoFocus
          value={q}
          placeholder="Rechercher une carte"
          aria-label="Rechercher une carte"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') (e.preventDefault(), setFocus((f) => Math.min(shown.length - 1, f + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setFocus((f) => Math.max(0, f - 1)));
            else if (e.key === 'Enter' && shown[focus]) (e.preventDefault(), pick(shown[focus]));
          }}
        />
      </label>
      <div className="map-portal-picker-list" role="listbox" aria-label="Cartes">
        {shown.length === 0 && <p className="muted map-portal-picker-empty">{all.length ? 'Aucune carte ne correspond.' : 'Aucune autre carte pour l’instant.'}</p>}
        {shown.map((t, i) => (
          <button
            key={t.key}
            role="option"
            aria-selected={i === focus}
            className={`map-portal-picker-row ${i === focus ? 'focused' : ''}`}
            data-map={t.key}
            onMouseEnter={() => setFocus(i)}
            onClick={() => pick(t)}
          >
            <span className="map-portal-picker-ico" data-kind={t.kind}>
              {KIND_ICON[t.kind]}
            </span>
            <span className="map-portal-picker-txt">
              <b className="truncate">{t.title}</b>
              <small className="truncate">
                {PORTAL_KIND_LABEL[t.kind]}
                {t.sub ? ` · ${t.sub}` : ''} · {t.nodeCount ? plural(t.nodeCount, 'carte') : 'vide'}
              </small>
            </span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** Bouton de la barre d'outils : « Lien vers une autre carte… ». */
export function PortalToolButton({ onOpen }: { onOpen(x: number, y: number): void }) {
  return (
    <button
      className="btn btn-ghost btn-sm"
      data-act="portal-link"
      title="Lien vers une autre carte… (un portail qui y mène)"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onOpen(r.left, r.top - 8);
      }}
    >
      <Waypoints size={14} /> <span className="map-bar-lbl">Lien</span>
    </button>
  );
}

// ── Rétroliens ──────────────────────────────────────────────
/** Nombre de cartes qui contiennent un portail vers `mapKey`. */
export const useBacklinkCount = (mapKey: string) => useStore((s) => backlinksOf(s.maps, mapKey).length);

/** « Liée depuis N cartes » : liste cliquable des cartes qui mènent ici. */
export function BacklinksButton({ mapKey }: { mapKey: string }) {
  const keys = useStore((s) => backlinksOf(s.maps, mapKey).join('|'));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const list = keys ? keys.split('|') : [];
  if (!list.length) return null;
  const entries = (): MenuEntry[] => {
    const maps = useStore.getState().maps;
    const lk = lkNow();
    return list
      .map((k) => portalTarget(maps, k, lk))
      .filter((t): t is PortalTarget => !!t)
      .map((t) => ({ label: t.title, icon: KIND_ICON[t.kind], hint: PORTAL_KIND_LABEL[t.kind], onClick: () => jumpToMap(mapKey, t.key) }));
  };
  return (
    <>
      <button
        className={`btn btn-ghost btn-sm map-backlinks ${menu ? 'active' : ''}`}
        data-act="backlinks"
        data-testid="map-backlinks"
        aria-haspopup="menu"
        title="Cartes qui contiennent un lien vers celle-ci"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          // La barre est en bas : la liste s'ouvre au-dessus (ContextMenu la garde dans l'écran).
          setMenu(menu ? null : { x: r.left, y: r.top - 14 - list.length * 34 });
        }}
      >
        <Waypoints size={13} /> Liée depuis {plural(list.length, 'carte')}
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={entries()} label="Cartes liées vers celle-ci" onClose={() => setMenu(null)} />}
    </>
  );
}

// ── Extrait présent sur d'autres cartes ─────────────────────
/** Badge discret « aussi dans N cartes » (index mémorisé highlightId → cartes). */
export function ReuseBadge({ highlightId, mapKey }: { highlightId: string; mapKey: string | undefined }) {
  const keys = useStore((s) => (mapKey ? otherMapsOfExtract(s.maps, highlightId, mapKey).join('|') : ''));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (!keys || !mapKey) return null;
  const maps = useStore.getState().maps;
  const lk = lkNow();
  const list = keys
    .split('|')
    .map((k) => portalTarget(maps, k, lk))
    .filter((t): t is PortalTarget => !!t);
  if (!list.length) return null;
  return (
    <span className="map-reuse-wrap" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="map-reuse nodrag"
        data-act="reuse"
        data-testid="reuse-badge"
        title="Cet extrait est aussi posé sur d’autres cartes"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: r.left, y: r.bottom + 6 });
        }}
      >
        aussi dans {plural(list.length, 'carte')}
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="Autres cartes où figure cet extrait"
          entries={list.map((t) => ({ label: t.title, icon: KIND_ICON[t.kind], hint: PORTAL_KIND_LABEL[t.kind], onClick: () => jumpToMap(mapKey, t.key) }))}
          onClose={() => setMenu(null)}
        />
      )}
    </span>
  );
}

/** Entrées du menu contextuel d'une carte portail. */
export function portalMenuEntries(fromKey: string, target: string, onRetarget: () => void): MenuEntry[] {
  const exists = !!mapTitleNow(target);
  return [
    { label: 'Ouvrir la carte liée', icon: <ArrowRight size={14} />, hint: 'double-clic', disabled: !exists, onClick: () => jumpToMap(fromKey, target) },
    { label: 'Changer de carte…', icon: <Waypoints size={14} />, onClick: onRetarget },
  ];
}
