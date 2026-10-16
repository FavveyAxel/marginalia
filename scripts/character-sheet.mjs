// Planche d'un compagnon (aperçu visuel) : ses poses principales aux niveaux 0 à 4, et une rangée en thème sombre.
// Lancer : node scripts/character-sheet.mjs <socrate|platon|aristote|rousseau|brain|all> [sortie.png]
// « all » : tous les compagnons côte à côte, debout de face, aux niveaux 0, 2 et 4.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const id = process.argv[2] || 'socrate';
const out = process.argv[3] || path.join(ROOT, `shots/compagnons/${id}.png`);
const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', ssr: { external: ['react', 'react-dom'] } });
const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { Sprite } = await server.ssrLoadModule('/src/features/mascot/Sprite.tsx');
const { CHARACTERS, CHARACTER_IDS } = await server.ssrLoadModule('/src/features/mascot/characters/index.ts');
let n = 0;
const svg = (props) => {
  const k = ++n;
  return renderToStaticMarkup(React.createElement(Sprite, props)).replace(/mascot-(halo|vol)-[A-Za-z0-9_]+/g, (m) => m + 'x' + k);
};
const SEAT = new Set(['sit', 'read', 'think', 'doze', 'sitwave', 'guitar', 'write', 'cigar']);
const cell = (props, label) => {
  const seat = SEAT.has(props.pose);
  const anchor = seat ? (props.view === 'side' ? 64 : 70) : 124;
  return `<div class="cell"><div class="edge" style="top:${8 + (109 * anchor) / 130}px"></div><div class="sp">${svg(props)}</div><small>${label}</small></div>`;
};
const CELLS = [
  ['stand', 0, 'front'], ['stand', 0, 'side'], ['stand', 0, 'back'], ['walk', 1, 'side'], ['walk', 3, 'side'], ['wave', 0, 'front'], ['jump', 0, 'side'],
  ['sit', 0, 'front'], ['sit', 0, 'side'], ['read', 0, 'front'], ['read', 0, 'side'], ['think', 2, 'front'], ['doze', 0, 'front'],
  ['guitar', 3, 'front'], ['write', 5, 'front'], ['cigar', 2, 'front'], ['whistle', 1, 'front'], ['flex', 0, 'front'],
];
let html = '';
if (id === 'all') {
  for (const theme of ['light', 'dark'])
    html += `<div class="theme ${theme}"><div class="row">${CHARACTER_IDS.map((c) => [0, 2, 4].map((l) => cell({ pose: 'stand', frame: 0, level: l, view: 'front', character: CHARACTERS[c], halo: theme === 'dark' ? '#e9dfcc' : undefined }, `${CHARACTERS[c].name} ${l}`)).join('')).join('')}</div></div>`;
} else {
  const ch = CHARACTERS[id];
  for (const theme of ['light', 'dark']) {
    html += `<div class="theme ${theme}">`;
    for (const level of theme === 'dark' ? [4] : [0, 1, 2, 3, 4]) {
      html += `<div class="row"><span class="lab">niveau ${level}</span>`;
      for (const [p, f, v] of CELLS) html += cell({ pose: p, frame: f, level, view: v, character: ch, halo: theme === 'dark' ? '#e9dfcc' : undefined }, `${p} ${v}`);
      html += '</div>';
    }
    html += '</div>';
  }
}
await server.close();
const page = `<!doctype html><meta charset=utf-8><style>
body{margin:0;width:max-content;font:11px -apple-system,system-ui,sans-serif}
.theme{padding:14px 18px;width:max-content;min-width:100%;box-sizing:border-box} .light{background:#efebe3;color:#1d1a15;--bg-panel:#fbf9f4} .dark{background:#121110;color:#ece6da;--bg-panel:#1c1b19}
.row{display:flex;align-items:flex-end;gap:4px;margin:4px 0;flex-wrap:nowrap} .lab{width:56px;opacity:.6;flex:none}
.cell{position:relative;width:92px;height:136px;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:flex-start}
.sp{width:84px;height:109px;position:relative;z-index:1;margin-top:8px} small{opacity:.5;margin-top:4px;white-space:nowrap}
.edge{position:absolute;left:4px;right:4px;height:22px;background:var(--bg-panel);border-radius:7px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
</style>${html}`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1200, height: 400 }, deviceScaleFactor: 2 });
await p.setContent(page);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
