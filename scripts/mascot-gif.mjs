// GIF de démonstration des passe-temps du compagnon dans l'app (guitare, écriture, cigare, sifflet).
// Lancer : node scripts/mascot-gif.mjs [sortie.gif]
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { withApp } from './harness.mjs';
const out = process.argv[2] || 'shots/mascotte/passe-temps.gif';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await withApp(5429, async (page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async () => {
    const enc = new TextEncoder();
    await window.__store.getState().importFiles(['Éthique', 'Pensées', 'Essais', 'Manuel', 'Le Rire', 'Méditations'].map((t) => ({ name: `${t}.txt`, data: enc.encode(`${t}\n\nx`).buffer })), { asBook: true });
    window.__store.getState().updateSettings({ mascot: 'often', theme: 'light' });
    window.__store.getState().navigate({ name: 'home' });
  });
  await sleep(1200);
  await page.evaluate(() => window.__mascot.appear());
  await page.waitForFunction(() => window.__mascot.state().visible);
  await page.evaluate(() => { const m = window.__mascot; m.calm(); const el = document.querySelector('.home-resume-card'); m.perchOn(el, 150); m.hush(); });
  const clip = await page.evaluate(() => { const c = document.querySelector('.home-resume-card').getBoundingClientRect(); return { x: c.left + 40, y: c.top - 175, width: 520, height: 250 }; });
  await page.evaluate(() => {
    const m = window.__mascot;
    m.act('stand', 600000, undefined, 'front');
    m.act('whistle', 4000, 'whistle', 'front');
    m.act('cigar', 6000, 'cigar', 'front');
    m.act('write', 5000, 'write', 'side', 1);
    m.act('guitar', 5500, 'guitar', 'front');
  });
  fs.rmSync('/tmp/mascot-gif2', { recursive: true, force: true });
  fs.mkdirSync('/tmp/mascot-gif2', { recursive: true });
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < 21000) { const t = Date.now(); await page.screenshot({ path: `/tmp/mascot-gif2/${String(i++).padStart(4, '0')}.png`, clip }); await sleep(Math.max(0, 90 - (Date.now() - t))); }
  globalThis.ms = Math.round(21000 / i);
});
execSync(`python3 -c "
from PIL import Image; import glob
fr=[Image.open(f).convert('RGB') for f in sorted(glob.glob('/tmp/mascot-gif2/*.png'))]
fr[0].save('${out}', save_all=True, append_images=fr[1:], duration=${globalThis.ms}, loop=0, optimize=True)"`);
console.log(out);
