// Vue d'ensemble des activités ajoutées : une rangée par activité (et par compagnon montré), 8 images
// réparties sur le cycle. Lancer : node scripts/activities-overview.mjs [sortie.png]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] || path.join(ROOT, 'shots/activites/ensemble.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', ssr: { external: ['react', 'react-dom'] } });
const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { Sprite, isSeated } = await server.ssrLoadModule('/src/features/mascot/Sprite.tsx');
const { CHARACTERS } = await server.ssrLoadModule('/src/features/mascot/characters/index.ts');
const ROWS = [
  ['coffee', 'Café', ['brain', 'socrate'], 16],
  ['spyglass', 'Longue-vue et loupe', ['brain', 'aristote'], 24],
  ['paint', 'Peinture', ['brain', 'rousseau'], 32],
  ['juggle', 'Jonglage', ['brain', 'platon'], 32],
  ['plane', 'Avion en papier', ['brain', 'socrate'], 24],
  ['meditate', 'Méditation (cerveau)', ['brain'], 12],
  ['question', 'Socrate questionne', ['socrate'], 18],
  ['geometry', 'Platon et la géométrie', ['platon'], 30],
  ['classify', 'Aristote classe', ['aristote'], 32],
  ['herborize', 'Rousseau herborise', ['rousseau'], 22],
];
let n = 0;
const svg = (props) => renderToStaticMarkup(React.createElement(Sprite, props)).replace(/mascot-(halo|vol|vol3d|volc|vols)-[A-Za-z0-9_]+/g, (m) => m + 'x' + ++n);
let html = '';
for (const [id, label, chars, cyc] of ROWS) {
  const anchor = isSeated(id) ? 70 : 124;
  for (const c of chars) {
    html += `<div class="row"><span class="lab"><b>${label}</b><br>${CHARACTERS[c].name}</span>`;
    for (let i = 0; i < 8; i++) {
      const f = Math.round((i * cyc) / 8);
      html += `<div class="cell"><div class="edge" style="top:${30 + (109 * anchor) / 130}px"></div><div class="sp">${svg({ pose: id, frame: f, level: 2, view: 'front', character: CHARACTERS[c] })}</div></div>`;
    }
    html += '</div>';
  }
}
await server.close();
const page = `<!doctype html><meta charset=utf-8><style>
body{margin:0;width:max-content;font:12px -apple-system,system-ui,sans-serif;background:#efebe3;color:#1d1a15;--bg-panel:#fbf9f4;padding:10px 16px}
.row{display:flex;align-items:flex-start;gap:2px;margin:0;border-bottom:1px solid rgba(0,0,0,.06)} .lab{width:150px;flex:none;padding-top:50px;line-height:1.4}
.cell{position:relative;width:132px;height:170px;flex:none;display:flex;justify-content:center;overflow:hidden}
.sp{width:84px;height:109px;position:relative;z-index:1;margin-top:30px}
.edge{position:absolute;left:4px;right:4px;height:22px;background:var(--bg-panel);border-radius:7px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.mascot-svg{overflow:visible}
</style>${html}`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1300, height: 400 }, deviceScaleFactor: 1.5 });
await p.setContent(page);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
