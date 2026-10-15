// Adaptateur entre la page d'une carte libre (BoardView) et le composant de carte générique
// (ArgumentMapView en mode `source: { kind: 'board' }`).
import { useMemo } from 'react';
import { useStore } from '../../lib/store';
import { ArgumentMapView, type MapSource } from './ArgumentMapView';
import { touch } from './model/boards';

export type BoardSource = Extract<MapSource, { kind: 'board' }>;

/** Source « carte libre » : lecture et écriture par le store (journalisées, annulables ⌘Z). */
export function boardSource(key: string): BoardSource {
  return {
    kind: 'board',
    mapId: key,
    get: () => {
      const s = useStore.getState();
      return s.maps[key] ?? s.getMap(key);
    },
    set: (m) => useStore.getState().setMap(key, touch(m)),
  };
}

export function BoardCanvas({ boardKey }: { boardKey: string }) {
  const source = useMemo(() => boardSource(boardKey), [boardKey]);
  return <ArgumentMapView source={source} />;
}
