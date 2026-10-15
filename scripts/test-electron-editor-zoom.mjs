// Zoom de la page (Écrire) contre zoom de l'interface (menu Présentation / Affichage d'Electron) — port 5371.
// Lancer : timeout 200 xvfb-run -a node scripts/test-electron-editor-zoom.mjs
// Touches natives (webContents.sendInputEvent, même chemin que le clavier : la page d'abord, puis les
// raccourcis du menu si la page ne les a pas consommés). Dans le texte : seul le zoom de la page change ;
// dans un champ de l'interface : le menu zoome toute l'interface, comme avant.
import { _electron as electron } from 'playwright-core';
import { createServer } from 'vite';
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5371;
const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-zoom-'));
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env: { ...process.env, XDG_CONFIG_HOME: TMP, VITE_DEV_SERVER_URL: `http://localhost:${PORT}/` }, timeout: 60000 });
const ok = (c, m) => { console.log((c ? 'OK   ' : 'ÉCHEC ') + m); if (!c) process.exitCode = 1; };
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  const d = await page.evaluate(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Z', html: '<p>Bonjour le monde</p>' }));
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), d.id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const zf = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
  await page.evaluate(() => window.__ed.engine().focus());
  const z0 = await page.evaluate(() => window.__ed.engine().zoom());
  const send = () => app.evaluate(({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.sendInputEvent({ type: 'keyDown', keyCode: '-', modifiers: ['control'] }); wc.sendInputEvent({ type: 'char', keyCode: '-', modifiers: ['control'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: '-', modifiers: ['control'] }); });
  await send();
  await page.waitForTimeout(600);
  const z1 = await page.evaluate(() => window.__ed.engine().zoom());
  const f1 = await zf();
  ok(z1 < z0 && f1 === 1, `⌘- dans le texte : page ${z0} → ${z1} %, interface ${f1}`);
  await page.focus('.ed-title-input');
  await send();
  await page.waitForTimeout(600);
  const f2 = await zf();
  ok(f2 < 1 && (await page.evaluate(() => window.__ed.engine().zoom())) === z1, `⌘- dans le titre : interface ${f2.toFixed(2)}, page inchangée`);
} finally { await app.close(); await server.close(); }
