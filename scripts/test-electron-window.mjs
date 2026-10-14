// Vérifie le déplacement de fenêtre en JS (sans app-region), le double-clic et le thème natif.
import { _electron as electron } from 'playwright-core';
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APP_DIR = path.join(ROOT, 'release/Marginalia-darwin-arm64/Marginalia.app/Contents/Resources/app');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-win-'));
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', APP_DIR, path.join(ROOT, 'fixtures/discours.epub')], env: { ...process.env, XDG_CONFIG_HOME: TMP, VITE_DEV_SERVER_URL: '' }, timeout: 60000 });
const ok = (c, m) => { console.log((c ? 'OK   ' : 'ÉCHEC ') + m); if (!c) process.exitCode = 1; };
try {
  const page = await app.firstWindow();
  await page.waitForSelector('.html-doc p', { timeout: 30000 });
  const regions = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).getPropertyValue('-webkit-app-region').trim() === 'drag').length);
  ok(regions === 0, `aucune zone app-region: drag (${regions})`);
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getPosition());
  await page.evaluate(() => window.marginalia.windowDragStart());
  await new Promise((r) => setTimeout(r, 120));
  await page.evaluate(() => window.marginalia.windowDragEnd());
  ok(true, `glisser démarre/s'arrête sans erreur (position ${before})`);
  // la sélection de texte ne touche pas à la fenêtre
  const b0 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const box = await page.evaluate(() => { const p = [...document.querySelectorAll('.html-doc p')].find((p) => p.textContent.includes('bon sens')); p.scrollIntoView({ block: 'center' }); const r = p.getBoundingClientRect(); return { x: r.left + 5, y: r.top + 10, w: r.width }; });
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + box.w * 0.5, box.y + 2, { steps: 10 }); await page.mouse.up();
  await page.waitForSelector('.sel-toolbar', { timeout: 5000 });
  await page.mouse.dblclick(box.x + 60, box.y + 30);
  await page.waitForTimeout(400);
  const b1 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  ok(JSON.stringify(b0) === JSON.stringify(b1), 'sélection et double-clic dans le texte ne changent pas la fenêtre');
  await page.evaluate(() => window.__mg_dummy = 1);
  await page.evaluate(() => window.marginalia.setTheme('dark'));
  const dark = await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
  ok(dark === 'dark', 'thème natif sombre');
  await page.evaluate(() => window.marginalia.setTheme('system'));
  ok((await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)) === 'system', 'thème natif automatique');
} finally { await app.close(); }
