// 17. Une carte par mouvement : quelle carte l'onglet Carte d'un livre affiche (celle du livre ou
// celle d'un mouvement), ouverture depuis la fiche-texte, extraits proposés en priorité.
import { useMemo } from 'react';
import { create } from 'zustand';
import { useStore } from '../../../../lib/store';
import type { ArgumentMap, Highlight } from '../../../../lib/types';
import { openMovementMap } from '../../model/actions';
import { highlightsInMovement, movementRange } from '../../model/movements';
import { roman } from '../../../study/studyUtils';

/** Carte affichée dans l'onglet Carte de chaque livre (null : la carte du livre). Non persisté. */
export const useMapChoice = create<{ byBook: Record<string, string | null>; choose(bookId: string, key: string | null): void }>((set) => ({
  byBook: {},
  choose: (bookId, key) => set((s) => ({ byBook: { ...s.byBook, [bookId]: key } })),
}));

/** Ouvre (et crée au besoin) la carte d'un mouvement dans l'onglet Carte de son livre. */
export function goToMovementMap(studyId: string, movementId: string): string | null {
  const s = useStore.getState();
  const st = s.studies.find((x) => x.id === studyId);
  if (!st) return null;
  const key = openMovementMap(studyId, movementId);
  if (!key) return null;
  useMapChoice.getState().choose(st.bookId, key);
  const r = s.route;
  s.navigate({ name: 'reader', bookId: st.bookId, tab: 'carte', splitBookId: r.name === 'reader' && r.bookId === st.bookId ? r.splitBookId : null });
  return key;
}

/** Libellé court d'un mouvement : « II. Le droit du plus fort ». */
export function movementShort(map: ArgumentMap): string {
  const s = useStore.getState();
  const st = map.studyId ? s.studies.find((x) => x.id === map.studyId) : null;
  const r = st && map.movementId ? movementRange(st, map.movementId) : null;
  if (!r) return map.title || 'Mouvement';
  return `${roman(r.index + 1)}. ${r.movement.title.trim() || `Mouvement ${r.index + 1}`}`;
}

/**
 * Carte d'un mouvement : extraits situés dans l'étendue du mouvement, à proposer en premier dans le
 * tiroir « À placer » (undefined pour les autres cartes).
 */
export function useMovementPriority(map: ArgumentMap, highlights: Highlight[]): { ids: ReadonlySet<string>; label: string } | undefined {
  const study = useStore((s) => (map.kind === 'movement' && map.studyId ? s.studies.find((x) => x.id === map.studyId) : undefined));
  return useMemo(() => {
    if (!study || !map.movementId) return undefined;
    const ids = new Set(highlightsInMovement(study, map.movementId, highlights).map((h) => h.id));
    return { ids, label: 'Dans ce mouvement' };
  }, [study, map.movementId, highlights]);
}
