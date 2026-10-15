// Banc de test : la carte d'argument affichée hors lecteur, sur une carte libre fournie en prop
// (source « board » avec get/set en mémoire, sans passer par store.maps).
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../src/styles/tokens.css';
import '../src/styles/app.css';
import { useStore } from '../src/lib/store';
import { ArgumentMapView, type MapSource } from '../src/features/map/ArgumentMapView';
import type { ArgumentMap } from '../src/lib/types';

const w = window as any;
w.__store = useStore;
const qs = new URLSearchParams(location.search);
document.documentElement.dataset.theme = qs.get('theme') ?? 'light';

let board: ArgumentMap = { id: 'board-test', kind: 'board', title: 'Comparer', bookId: '', bookIds: [], nodes: [], edges: [], viewport: null };
w.__board = () => board;
w.__writes = 0;

function Root() {
  const [ver, setVer] = useState(0);
  w.__setBoard = (m: ArgumentMap) => {
    board = m;
    setVer((v) => v + 1);
  };
  const source: MapSource = {
    kind: 'board',
    mapId: board.id!,
    get: () => board,
    set: (m) => {
      board = m;
      w.__writes++;
    },
  };
  return (
    <div style={{ position: 'relative', height: '100vh', background: 'var(--bg-app)' }}>
      <ArgumentMapView key={ver} source={source} />
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
