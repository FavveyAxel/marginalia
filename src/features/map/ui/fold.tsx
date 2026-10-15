// Replier / déplier des branches (carte mentale) : interface. La règle de l'arbre est dans
// model/fold.ts ; ici : la pastille ronde au bord d'une carte (« − » / « +N »), l'état dérivé
// de la carte pour la vue, et les entrées de menu.
//
// Raccourcis (carte sélectionnée) : ⌥↑ replier la branche, ⌥↓ la déplier ; ⌥⇧↑ tout replier,
// ⌥⇧↓ tout déplier. (⌥← / ⌥→ sont évités : Alt+← est « revenir » sous Windows.)
import { useMemo } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Minus } from 'lucide-react';
import type { ArgumentMap } from '../../../lib/types';
import { fmtKeys } from '../../../lib/keys';
import type { MenuEntry } from '../../workspaces/wsUi';
import { foldHiddenIds, foldInfo, type FoldState } from '../model/fold';

export const FOLD_KEYS = { fold: '⌥↑', unfold: '⌥↓', foldAll: '⌥⇧↑', unfoldAll: '⌥⇧↓' } as const;

/** Données de repli passées à une carte (data.fold). */
export interface FoldData extends FoldState {
  toggle(): void;
}

const plural = (n: number) => `${n} carte${n > 1 ? 's' : ''}`;

/** Pastille au bord d'une carte qui a des descendantes : « − » (au survol) pour replier, « +N » pour déplier. */
export function FoldToggle({ fold }: { fold?: FoldData }) {
  if (!fold?.count) return null;
  const { folded, count } = fold;
  return (
    <button
      type="button"
      className={`map-fold nodrag nopan ${folded ? 'folded' : ''}`}
      data-act="fold"
      aria-expanded={!folded}
      aria-label={folded ? `Déplier la branche (${plural(count)} masquée${count > 1 ? 's' : ''})` : `Replier la branche (${plural(count)})`}
      title={fmtKeys(folded ? `Déplier la branche : ${plural(count)} (⌥↓)` : `Replier la branche : ${plural(count)} (⌥↑)`)}
      onClick={(e) => {
        e.stopPropagation();
        fold.toggle();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {folded ? <span>+{count}</span> : <Minus size={11} strokeWidth={2.6} />}
    </button>
  );
}

/** État de repli de la carte affichée : cartes masquées, et cartes qui ont des descendantes. */
export function useFoldView(map: ArgumentMap) {
  const key = useMemo(
    () => `${map.nodes.map((n) => `${n.id}${n.folded ? '*' : ''}${n.kind ?? ''}`).join('|')}#${map.edges.map((e) => `${e.source}>${e.target}:${e.relation}`).join('|')}#${map.centralId ?? ''}`,
    [map.nodes, map.edges, map.centralId],
  );
  return useMemo(() => {
    const m = { nodes: map.nodes, edges: map.edges, centralId: map.centralId };
    return { hidden: foldHiddenIds(m), info: foldInfo(m) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Entrées « Replier / Déplier la branche » du menu d'une carte. */
export function foldNodeEntries(info: FoldState | undefined, toggle: () => void): MenuEntry[] {
  if (!info?.count) return [];
  return info.folded
    ? [{ label: `Déplier la branche (${plural(info.count)})`, icon: <ChevronsUpDown size={14} />, hint: fmtKeys(FOLD_KEYS.unfold), onClick: toggle }]
    : [{ label: 'Replier la branche', icon: <ChevronsDownUp size={14} />, hint: fmtKeys(FOLD_KEYS.fold), onClick: toggle }];
}

/** Entrées « Tout replier / Tout déplier » (menu du vide, barre d'outils). */
export function foldAllEntries(info: Map<string, FoldState>, onFoldAll: () => void, onUnfoldAll: () => void): MenuEntry[] {
  if (!info.size) return [];
  const anyFolded = [...info.values()].some((f) => f.folded);
  return [
    { label: 'Tout replier', icon: <ChevronsDownUp size={14} />, hint: fmtKeys(FOLD_KEYS.foldAll), onClick: onFoldAll },
    { label: 'Tout déplier', icon: <ChevronsUpDown size={14} />, hint: fmtKeys(FOLD_KEYS.unfoldAll), onClick: onUnfoldAll, disabled: !anyFolded },
  ];
}
