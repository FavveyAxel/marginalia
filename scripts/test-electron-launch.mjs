// Lancement et fermeture de l'app (souci vu sur Windows : il fallait cliquer deux fois sur l'icône, et
// l'app ne se rouvrait pas après une mise à jour).
// Vérifie : fenêtre affichée même si « ready-to-show » n'arrive pas (simulé) ; second lancement pendant
// que l'app tourne → pas de deuxième app, la fenêtre existante revient ; relance « --updated » pendant que
// l'ancienne version se ferme → elle attend le verrou puis s'ouvre, affichée ; fermeture avec une session
// Internet (iroh) ouverte → sortie propre et rapide (avant : arrêt brutal du module natif).
// Prérequis : npx vite build ; Xvfb (:99). Lancer : DISPLAY=:99 LANG=C.UTF-8 timeout 300 node scripts/test-electron-launch.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ok = (c, m, x = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (x !== '' ? ' — ' + (typeof x === 'string' ? x : JSON.stringify(x)) : ''));
  if (!c) process.exitCode = 1;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const envFor = (home, extra = {}) => ({ ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: path.join(home, 'd'), MARGINALIA_E2E_LAN: '127.0.0.1', VITE_DEV_SERVER_URL: '', ...extra });
const launch = (env, extra = []) => electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT, ...extra], env, timeout: 30000 });
const ready = (p) => p.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
const windows = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), top: w.isAlwaysOnTop() })));

// ── 1. « ready-to-show » absent ──
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-launch-'));
  const app = await launch(envFor(home, { MARGINALIA_E2E_NO_READY_TO_SHOW: '1' }));
  await ready(await app.firstWindow());
  await wait(1200);
  const w = await windows(app);
  ok(w.length === 1 && w[0].visible, 'sans « ready-to-show » : la fenêtre s’affiche quand même (fin du chargement)', w);
  const log = fs.readFileSync(path.join(home, 'd', 'diagnostic.log'), 'utf8');
  ok(/affichee.*chargee/.test(log), 'journal : « fenêtre affichée (chargée) »');
  await app.close();
}

// ── 2. Second lancement, puis relance par la mise à jour ──
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-launch-'));
  const env = envFor(home);
  const A = await launch(env);
  await ready(await A.firstWindow());
  await A.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  const B = await launch(env).then(() => 'lancée', () => 'refusée');
  await wait(1500);
  const w = await windows(A);
  ok(B === 'refusée' && w.length === 1 && w[0].visible, 'second clic pendant que l’app tourne : pas de deuxième app, la fenêtre revient', { B, w });

  setTimeout(() => A.evaluate(({ app }) => app.quit()).catch(() => {}), 2000);
  const t0 = Date.now();
  const C = await launch(env, ['--updated']).catch(() => null);
  ok(!!C, 'relance « --updated » pendant que l’ancienne se ferme : elle attend puis démarre', { ms: Date.now() - t0 });
  if (C) {
    await ready(await C.firstWindow());
    await wait(900);
    const v = await windows(C);
    ok(v.length === 1 && v[0].visible && !v[0].top, 'relance : fenêtre affichée au premier plan, puis normale', v);
    await C.close();
  }
}

// ── 3. Fermeture avec une session Internet ouverte ──
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-launch-'));
  const app = await launch(envFor(home, { MARGINALIA_E2E_INTERNET: '1' }));
  const page = await app.firstWindow();
  await ready(page);
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true }));
  await page.evaluate(() => window.marginalia.collabNet.internet(true));
  await page.evaluate(async () => {
    const s = window.__store.getState();
    const ws = s.createWorkspace('Essai').id;
    await (await window.__collab.session()).startHost(ws, { name: 'Léa', color: '#c2410c' });
  });
  await wait(1500);
  const proc = app.process();
  const t0 = Date.now();
  const exited = new Promise((r) => proc.once('exit', (code, sig) => r({ ms: Date.now() - t0, code, sig })));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.close()));
  const r = await Promise.race([exited, wait(15000).then(() => ({ ms: 'toujours en vie après 15 s' }))]);
  ok(r.code === 0 && !r.sig && r.ms < 5000, 'fermeture avec une session Internet : sortie propre et rapide', r);
  try {
    proc.kill('SIGKILL');
  } catch {
    /* déjà sorti */
  }
}

console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
process.exit(process.exitCode || 0);
