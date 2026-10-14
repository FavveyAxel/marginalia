import { _electron as electron } from 'playwright-core';
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APP_DIR = path.join(ROOT, 'release/Marginalia-darwin-arm64/Marginalia.app/Contents/Resources/app');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-sel-'));
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', APP_DIR, path.join(ROOT, 'fixtures/discours.epub')], env: { ...process.env, XDG_CONFIG_HOME: TMP, VITE_DEV_SERVER_URL: '' }, timeout: 60000 });
const bounds = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { ...w.getBounds(), max: w.isMaximized(), fs: w.isFullScreen(), zoom: w.webContents.getZoomFactor() }; });
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
  await page.waitForSelector('.html-doc p', { timeout: 30000 });
  await page.waitForTimeout(1500);
  console.log('avant', JSON.stringify(await bounds()));
  const box = await page.evaluate(() => { const p = [...document.querySelectorAll('.html-doc p')].find(p => p.textContent.includes('bon sens')); p.scrollIntoView({block:'center'}); const r = p.getBoundingClientRect(); return { x: r.left + 5, y: r.top + 10, w: r.width }; });
  await page.waitForTimeout(300);
  const t0 = Date.now();
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + box.w * 0.5, box.y + 2, { steps: 15 }); await page.mouse.up();
  await page.waitForSelector('.sel-toolbar', { timeout: 10000 });
  console.log('barre après', Date.now() - t0, 'ms');
  console.log('après glissé', JSON.stringify(await bounds()));
  await page.mouse.dblclick(box.x + 40, box.y + 30);
  await page.waitForTimeout(800);
  console.log('après double-clic', JSON.stringify(await bounds()));
  const lt = await page.evaluate(() => new Promise(r => { const out=[]; new PerformanceObserver(l => l.getEntries().forEach(e => out.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); setTimeout(() => r(out), 500); }));
  console.log('longtasks', lt);
} finally { await app.close(); }
