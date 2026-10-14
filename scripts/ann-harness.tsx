// Banc de test des panneaux A5 hors lecteur (le moteur de lecture peut être un stub).
// Pilotage : window.__ann.render({ c: 'popover'|'toc'|'search'|'typo'|'search-null', ... })
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../src/styles/tokens.css';
import '../src/styles/app.css';
import '../src/features/reader/reader.css';
import { useStore } from '../src/lib/store';
import { TocPanel } from '../src/features/reader/TocPanel';
import { SearchBar } from '../src/features/reader/SearchBar';
import { TypographyPopover } from '../src/features/reader/TypographyPopover';
import { HighlightPopover } from '../src/features/annotations/HighlightPopover';
import type { EngineHandle, SearchHit } from '../src/features/reader/engine';

const w = window as any;
w.__store = useStore;
w.__ann = { log: [] as string[], render: (_: any) => {} };

const applyTheme = () => {
  const t = useStore.getState().settings.theme;
  document.documentElement.dataset.theme = t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
};
useStore.subscribe(applyTheme);
applyTheme();

const TEXT = [
  'Le bon sens est la chose du monde la mieux partagée',
  'la diversité de nos opinions ne vient pas de ce que les uns sont plus raisonnables',
  'le principal est de l’appliquer bien',
  'Le premier était de ne recevoir jamais aucune chose pour vraie',
  'je pense, donc je suis, était si ferme et si assurée',
  'ce que j’étais, une substance dont toute l’essence est de penser',
  'le bon sens ou la raison, est naturellement égale en tous les hommes',
];
const strip = (x: string) => x.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const engine: EngineHandle = {
  goTo: () => {},
  goToHighlight: () => {},
  goToAnchor: () => {},
  getHighlightRect: () => null,
  async search(q: string) {
    w.__ann.log.push('search:' + q);
    const hits: SearchHit[] = [];
    TEXT.forEach((t, i) => {
      const at = strip(t).indexOf(strip(q));
      if (at >= 0) hits.push({ id: 'h' + i, snippet: t, matchStart: at, matchLength: q.length, locationLabel: i < 3 ? 'Première partie' : 'Seconde partie', payload: i });
    });
    return hits;
  },
  goToSearchHit: (h) => w.__ann.log.push('go:' + h.id),
  clearSearch: () => w.__ann.log.push('clear'),
};

function Root() {
  const [cfg, setCfg] = useState<any>({ c: 'none' });
  const [closed, setClosed] = useState(0);
  const [selected, setSelected] = useState('');
  w.__ann.render = (c: any) => {
    setClosed(0);
    setSelected('');
    setCfg(c);
  };
  w.__ann.closed = closed;
  w.__ann.selected = selected;
  const anchor = new DOMRect(520, 300, 220, 22);
  return (
    <div style={{ height: '100vh', background: 'var(--bg-app)', padding: 8, display: 'flex', gap: 8 }}>
      {(cfg.c === 'toc') && (
        <aside className="panel reader-side" style={{ width: 248, height: 560 }}>
          <TocPanel items={cfg.items} currentLabel={cfg.currentLabel} progress={cfg.progress} onSelect={(i) => setSelected(i.id)} />
        </aside>
      )}
      <section className="panel" style={{ flex: 1, position: 'relative', background: 'var(--bg-page)', padding: '120px 160px', fontFamily: 'var(--font-read)', fontSize: 19, lineHeight: 1.65 }}>
        {(cfg.c === 'search' || cfg.c === 'search-null') && (
          <div className="reader-search-host">
            <SearchBar engine={cfg.c === 'search' ? engine : null} onClose={() => setClosed((n) => n + 1)} />
          </div>
        )}
        <p>
          Et remarquant que cette vérité : <span style={{ position: 'absolute', left: 520, top: 300, width: 220, height: 22 }} className="hl hl-argument" /> je pense, donc je suis, était si ferme et si assurée, que toutes les plus extravagantes suppositions des sceptiques n’étaient pas capables de l’ébranler.
        </p>
      </section>
      {cfg.c === 'popover' && cfg.highlightId && <HighlightPopover highlightId={cfg.highlightId} rect={anchor} onClose={() => setClosed((n) => n + 1)} />}
      {cfg.c === 'typo' && <TypographyPopover anchor={new DOMRect(1200, 8, 30, 30)} onClose={() => setClosed((n) => n + 1)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
