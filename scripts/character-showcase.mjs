// Vitrine des compagnons en grand : chacun aux niveaux 0, 2 et 4 de face, puis en scène (lecture,
// profil, guitare, cigare). Lancer : node scripts/character-showcase.mjs [sortie.png]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2] || path.join(ROOT, 'shots/compagnons/vitrine.png');
const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', ssr: { external: ['react', 'react-dom'] } });
const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { Sprite } = await server.ssrLoadModule('/src/features/mascot/Sprite.tsx');
const { CHARACTERS } = await server.ssrLoadModule('/src/features/mascot/characters/index.ts');
let n = 0;
const svg = (p) => { const k = ++n; return renderToStaticMarkup(React.createElement(Sprite, p)).replace(/mascot-(halo|vol)-[A-Za-z0-9_]+/g, (m) => m + 'x' + k); };
const SEAT = new Set(['sit', 'read', 'think', 'doze', 'sitwave', 'guitar', 'write', 'cigar']);
const cell = (p, label) => { const a = SEAT.has(p.pose) ? (p.view === 'side' ? 64 : 70) : 124; return `<div class="cell"><div class="edge" style="top:${14 + (260 * a) / 130}px"></div><div class="sp">${svg(p)}</div><small>${label}</small></div>`; };
let html = '';
for (const id of ['socrate', 'platon', 'aristote', 'rousseau']) {
  const ch = CHARACTERS[id];
  html += `<div class="row"><div class="lab"><b>${ch.name}</b><span>grandit : ${ch.grows}</span></div>`;
  for (const l of [0, 2, 4]) html += cell({ pose: 'stand', frame: 0, level: l, view: 'front', character: ch }, `niveau ${l}`);
  html += cell({ pose: 'read', frame: 0, level: 2, view: 'front', character: ch }, 'lit');
  html += cell({ pose: 'walk', frame: 1, level: 2, view: 'side', character: ch }, 'marche');
  html += cell({ pose: 'guitar', frame: 7, level: 2, view: 'front', character: ch }, 'guitare');
  html += cell({ pose: 'cigar', frame: 1, level: 2, view: 'front', character: ch }, 'cigare');
  html += cell({ pose: 'stand', frame: 0, level: 4, view: 'back', character: ch }, 'de dos');
  html += '</div>';
}
await server.close();
const page = `<!doctype html><meta charset=utf-8><style>
body{margin:0;background:#efebe3;color:#1d1a15;font:14px -apple-system,system-ui,sans-serif;--bg-panel:#fbf9f4;width:max-content;padding:16px 22px}
.row{display:flex;align-items:flex-start;gap:8px;margin:6px 0 14px}
.lab{width:130px;display:flex;flex-direction:column;gap:4px;padding-top:110px} .lab span{opacity:.6;font-size:12px}
.cell{position:relative;width:206px;height:300px;display:flex;flex-direction:column;align-items:center}
.sp{width:200px;height:260px;position:relative;z-index:1;margin-top:14px} small{opacity:.55;margin-top:2px}
.edge{position:absolute;left:8px;right:8px;height:26px;background:var(--bg-panel);border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
</style>${html}`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1400, height: 400 }, deviceScaleFactor: 1.5 });
await p.setContent(page);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
