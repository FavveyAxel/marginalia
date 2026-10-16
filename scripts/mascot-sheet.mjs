// Planche des poses et niveaux du compagnon (aperçu visuel). Lancer : node scripts/mascot-sheet.mjs [sortie.png]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] || path.join(ROOT, 'shots/mascotte/planche.png');
const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', ssr: { external: ['react', 'react-dom'] }, resolve: { preserveSymlinks: false } });
const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { Sprite } = await server.ssrLoadModule('/src/features/mascot/Sprite.tsx');
const poses = ['stand', 'walk', 'walk', 'wave', 'sit', 'read', 'read', 'think', 'doze', 'flex', 'puff'];
const frames = [0, 0, 1, 0, 0, 0, 11, 2, 0, 0, 1];
let html = '';
let n = 0;
for (const theme of ['light', 'dark']) {
  html += `<div class="theme ${theme}">`;
  for (const level of theme === 'dark' ? [0, 4] : [0, 1, 2, 3, 4]) {
    html += `<div class="row"><span class="lab">niveau ${level}</span>`;
    poses.forEach((p, i) => {
      const seat = ['sit', 'read', 'think', 'doze'].includes(p);
      html += `<div class="cell"><div class="edge ${seat ? 'seat' : 'ground'}"></div><div class="sp">${renderToStaticMarkup(React.createElement(Sprite, { pose: p, frame: frames[i], level, halo: theme === 'dark' ? '#e9dfcc' : undefined })).replaceAll('mascot-halo-R0', 'mh' + ++n)}</div><small>${p}${frames[i] ? ' ' + frames[i] : ''}</small></div>`;
    });
    html += '</div>';
  }
  html += '</div>';
}
await server.close();
const page = `<!doctype html><meta charset=utf-8><style>
body{margin:0;font:12px -apple-system,system-ui,sans-serif}
.theme{padding:16px 20px} .light{background:#efebe3;color:#1d1a15;--bg-panel:#fbf9f4} .dark{background:#121110;color:#ece6da;--bg-panel:#1c1b19;--mascot-halo:#e9dfcc}
.row{display:flex;align-items:flex-end;gap:6px;margin:6px 0} .lab{width:64px;opacity:.6}
.cell{position:relative;width:96px;height:132px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end}
.sp{width:84px;height:109px;position:relative;z-index:1} small{opacity:.5;margin-top:2px}
.edge{position:absolute;left:4px;right:4px;background:var(--bg-panel);border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.edge.seat{top:${16 + 109 * 70 / 130}px;bottom:16px} .edge.ground{top:${16 + 109 * 124 / 130}px;bottom:14px}
</style>${html}`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1180, height: 400 }, deviceScaleFactor: 2 });
await p.setContent(page);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
