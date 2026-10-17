// Planche d'une activité ajoutée : ses images successives pour chaque compagnon (et une rangée sombre).
// Lancer : node scripts/activity-sheet.mjs <id> [nombre d'images, 12 par défaut] [sortie.png]
// Une grande marge autour de chaque image laisse voir ce qui dépasse (vapeur, avion, livres lancés…).
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const id = process.argv[2] || 'coffee';
const frames = Number(process.argv[3] || 12);
const out = process.argv[4] || path.join(ROOT, `shots/activites/${id}.png`);
fs.mkdirSync(path.dirname(out), { recursive: true });
const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', ssr: { external: ['react', 'react-dom'] } });
const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { Sprite, isSeated } = await server.ssrLoadModule('/src/features/mascot/Sprite.tsx');
const { CHARACTERS, CHARACTER_IDS } = await server.ssrLoadModule('/src/features/mascot/characters/index.ts');
const { EXTRA_ACTIVITIES } = await server.ssrLoadModule('/src/features/mascot/activities/index.ts');
const act = EXTRA_ACTIVITIES.find((a) => a.id === id);
const chars = act?.chars?.length ? act.chars : CHARACTER_IDS;
let n = 0;
const svg = (props) => {
  const k = ++n;
  return renderToStaticMarkup(React.createElement(Sprite, props)).replace(/mascot-(halo|vol|vol3d|volc|vols)-[A-Za-z0-9_]+/g, (m) => m + 'x' + k);
};
const anchor = isSeated(id) ? 70 : 124;
const cell = (props, label) =>
  `<div class="cell"><div class="edge" style="top:${40 + (109 * anchor) / 130}px"></div><div class="sp">${svg(props)}</div><small>${label}</small></div>`;
let html = '';
for (const theme of ['light', 'dark']) {
  html += `<div class="theme ${theme}">`;
  for (const c of theme === 'dark' ? [chars[0]] : chars) {
    html += `<div class="row"><span class="lab">${CHARACTERS[c].name}</span>`;
    for (let f = 0; f < frames; f++) html += cell({ pose: id, frame: f, level: c === 'brain' ? 2 : 2, view: 'front', character: CHARACTERS[c], halo: theme === 'dark' ? '#e9dfcc' : undefined }, `image ${f}`);
    html += '</div>';
  }
  html += '</div>';
}
await server.close();
const page = `<!doctype html><meta charset=utf-8><style>
body{margin:0;width:max-content;font:11px -apple-system,system-ui,sans-serif}
.theme{padding:14px 18px;width:max-content;min-width:100%;box-sizing:border-box} .light{background:#efebe3;color:#1d1a15;--bg-panel:#fbf9f4} .dark{background:#121110;color:#ece6da;--bg-panel:#1c1b19}
.row{display:flex;align-items:flex-end;gap:4px;margin:4px 0;flex-wrap:nowrap} .lab{width:64px;opacity:.6;flex:none}
.cell{position:relative;width:150px;height:200px;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;outline:1px dashed rgba(127,127,127,.15)}
.sp{width:84px;height:109px;position:relative;z-index:1;margin-top:40px} small{opacity:.5;margin-top:44px;white-space:nowrap}
.edge{position:absolute;left:6px;right:6px;height:22px;background:var(--bg-panel);border-radius:7px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.mascot-svg{overflow:visible}
</style>${html}`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1200, height: 400 }, deviceScaleFactor: 2 });
await p.setContent(page);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
