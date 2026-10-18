// Visite guidée au premier lancement (app réelle) : nouvel utilisateur → elle démarre d'elle-même ;
// passée → ne revient pas ; utilisateur existant (données déjà là) → rien.
// Prérequis : dist/ construit. Lancer : DISPLAY=:99 timeout 240 node scripts/test-electron-tour.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-tour-'));
const ok = (c, m, extra = '') => { console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + extra : '')); if (!c) process.exitCode = 1; };
async function launch(first) {
  const env = { ...process.env, HOME, XDG_CONFIG_HOME: path.join(HOME, '.config'), VITE_DEV_SERVER_URL: '', MARGINALIA_E2E: '1', MARGINALIA_E2E_FIRST_RUN: first ? '1' : '0' };
  const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  return { app, page };
}
try {
  let { app, page } = await launch(true);
  await page.waitForSelector('[data-testid="tour"] .tour-card.is-placed', { timeout: 15000 });
  ok((await page.getAttribute('[data-testid="tour"]', 'data-step')) === 'bienvenue', 'nouvel utilisateur : la visite démarre d’elle-même');
  ok(!(await page.$('[data-testid="whats-new"]')), 'pas de « Quoi de neuf » pour un nouvel utilisateur');
  await page.click('.tour-skip');
  await page.waitForSelector('[data-testid="tour"]', { state: 'detached' });
  await page.waitForTimeout(800);
  await app.close();
  ({ app, page } = await launch(true));
  await page.waitForTimeout(2500);
  ok(!(await page.$('[data-testid="tour"]')), 'passée une fois : ne revient pas d’elle-même');
  await app.close();
  fs.rmSync(path.join(HOME, '.config'), { recursive: true, force: true });
  ({ app, page } = await launch(false));
  await page.waitForTimeout(2500);
  ok(!(await page.$('[data-testid="tour"]')), 'utilisateur existant (mise à jour) : pas de visite automatique');
  await app.close();
} finally {
  fs.rmSync(HOME, { recursive: true, force: true });
}
