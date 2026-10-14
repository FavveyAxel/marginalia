// Badge de la barre latérale : cartes dues aujourd'hui + nouvelles cartes autorisées (plafond par livre).
import { useMemo } from 'react';
import { useStore } from '../../lib/store';
import { dueCount } from './queue';

export function useDueCount(): number {
  const cards = useStore((s) => s.cards);
  const cap = useStore((s) => s.settings.newCardsPerBook);
  return useMemo(() => dueCount(cards, cap, Date.now()), [cards, cap]);
}
