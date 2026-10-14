// Première sélection après ouverture : la page ne doit ni sauter ni changer de hauteur.
import { withApp, shot } from './harness.mjs';
import JSZip from 'jszip';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const zip = await JSZip.loadAsync(fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')));
const names = Object.keys(zip.files).filter((n) => /ch00\d\.xhtml$/.test(n));
for (const n of names) {
  const x = await zip.file(n).async('string');
  const body = x.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  const p = body.replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/g, '');
  zip.file(n, x.replace('</body>', p.repeat(40) + '</body>'));
}
const out = path.join(os.tmpdir(), 'discours-long-sel.epub');
fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' }));
await withApp(5295, async (page) => {
  const b64 = fs.readFileSync(out).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const [b] = await window.__store.getState().importFiles([{ name: 'long.epub', data: bin.buffer }]);
    window.__store.getState().openBook(b.id);
  }, b64);
  await page.waitForFunction(() => document.querySelector('.html-doc p') && !document.querySelector('.reader-loading.overlay'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  console.log('debug', await page.evaluate(() => [...document.querySelectorAll('.html-doc p')].slice(0,6).map((p) => [Math.round(p.getBoundingClientRect().top), Math.round(p.getBoundingClientRect().height), p.textContent.length])), await page.evaluate(() => innerHeight));
  const probe = () => page.evaluate(() => { const sc = document.querySelector('.html-doc')?.closest('[class*="scroll"]') || [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY !== 'visible' && e.querySelector('.html-doc')); return { top: Math.round(sc.scrollTop), h: sc.scrollHeight }; });
  await page.mouse.move(700, 450);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(120); }
  await page.waitForTimeout(600);
  const before = await probe();
  const box = await page.evaluate(() => { const p = [...document.querySelectorAll('.html-doc p')].find((p) => { const r = p.getBoundingClientRect(); return r.top > 90 && r.top < innerHeight - 150 && r.height > 10 && p.textContent.length > 40; }); const r = p.getBoundingClientRect(); return { x: r.left + 5, y: r.top + 10, w: r.width }; });
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + box.w * 0.6, box.y + 2, { steps: 10 }); await page.mouse.up();
  await page.waitForSelector('.sel-toolbar', { timeout: 5000 });
  await page.waitForTimeout(400);
  const after = await probe();
  console.log('avant', JSON.stringify(before), 'après', JSON.stringify(after));
  console.log(before.top === after.top && before.h === after.h ? 'OK   aucun saut à la première sélection' : 'ÉCHEC saut ou changement de hauteur');
});
