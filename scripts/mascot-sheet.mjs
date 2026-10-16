// Planche des poses et niveaux du compagnon (aperçu visuel). Lancer : node scripts/mascot-sheet.mjs [sortie.png] [--new]
// --new : seulement les poses guitare, sifflet, écriture et cigare, en grand (niveaux 0 et 4, et une rangée sombre).
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const onlyNew = args.includes('--new');
const out = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'shots/mascotte/planche.png');
const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', ssr: { external: ['react', 'react-dom'] }, resolve: { preserveSymlinks: false } });
const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { Sprite } = await server.ssrLoadModule('/src/features/mascot/Sprite.tsx');
const cells = [
  ['stand', 0, 'front'], ['walk', 0, 'side'], ['walk', 1, 'side'], ['walk', 2, 'side'], ['walk', 3, 'side'], ['stand', 0, 'side'], ['stand', 0, 'back'], ['walk', 1, 'back'],
  ['wave', 0, 'front'], ['flex', 0, 'front'], ['sit', 0, 'front'], ['sitwave', 0, 'front'], ['read', 0, 'front'], ['read', 2, 'front'], ['think', 2, 'front'], ['doze', 0, 'front'],
  ['sit', 0, 'side'], ['read', 0, 'side'], ['read', 11, 'side'], ['think', 2, 'side'], ['doze', 0, 'side'], ['sit', 0, 'back'], ['puff', 1, 'front'],
];
const newCells = [
  ['guitar', 0, 'front'], ['guitar', 3, 'front'], ['guitar', 7, 'front'], ['guitar', 1, 'side'], ['guitar', 8, 'side'], ['whistle', 0, 'front'], ['whistle', 2, 'front'], ['whistle', 1, 'side'],
  ['whistle', 4, 'side'], ['write', 2, 'front'], ['write', 5, 'front'], ['write', 7, 'front'], ['write', 3, 'side'], ['cigar', 0, 'front'], ['cigar', 5, 'front'], ['cigar', 9, 'front'],
  ['cigar', 1, 'side'], ['cigar', 6, 'side'],
];
const BREAKS = onlyNew ? [9] : [8, 16, cells.length, cells.length + 9];
const sheet = onlyNew ? newCells : [...cells, ...newCells];
const SEATED = ['sit', 'read', 'think', 'doze', 'sitwave', 'guitar', 'write', 'cigar'];
let html = '';
let n = 0;
for (const theme of ['light', 'dark']) {
  html += `<div class="theme ${theme}">`;
  for (const level of theme === 'dark' ? [4] : onlyNew ? [0, 4] : [0, 2, 4]) {
    html += `<div class="row"><span class="lab">niveau ${level}</span>`;
    sheet.forEach(([p, f, v], i) => {
      if (BREAKS.includes(i)) html += `</div><div class="row"><span class="lab"></span>`;
      const seat = SEATED.includes(p);
      const anchor = seat ? (v === 'side' && !['sitwave'].includes(p) ? 64 : 70) : 124;
      ++n;
      const svg = renderToStaticMarkup(React.createElement(Sprite, { pose: p, frame: f, level, view: v, halo: theme === 'dark' ? '#e9dfcc' : undefined })).replaceAll(/mascot-(halo|vol)-R0/g, (m) => m + 'x' + n);
      html += `<div class="cell"><div class="edge" style="top:${16 + (109 * anchor) / 130}px;bottom:${seat ? 16 : 14}px"></div><div class="sp">${svg}</div><small>${p} ${v}${f ? ' ' + f : ''}</small></div>`;
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
const p = await b.newPage({ viewport: { width: onlyNew ? 1040 : 1060, height: 400 }, deviceScaleFactor: onlyNew ? 3 : 2 });
await p.setContent(page);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
