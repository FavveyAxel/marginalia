// Espaces chiffrés : verrouillage automatique, que le verrouillage de l'app soit activé ou non.
//   1. Après inactivité (délai raccourci par MARGINALIA_E2E_SPACES_AUTOLOCK_MS, tests seulement).
//   2. À la mise en veille (powerMonitor « suspend »), puis au verrouillage de l'écran (« lock-screen »).
// À chaque fois : la modification faite juste avant est enregistrée (rien de perdu), le disque ne
// contient rien en clair, le store de l'interface (rendu neuf) ne contient plus rien de l'espace.
// Prérequis : npx vite build ; Xvfb. Lancer : xvfb-run -a node scripts/test-electron-spaces-autolock.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
  return c;
};
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-spaces-auto-'));
const UD = path.join(home, 'donnees');
const SECRET = 'SECRET-AUTO-VERROU-91KQ';
const PASSWORD = 'mot de passe auto 8812';
let app, page;
async function launch(extra = {}) {
  app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: UD, VITE_DEV_SERVER_URL: '', ...extra },
    timeout: 120000,
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
}
const quit = async () => { await app.close().catch(() => {}); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (fn, arg) => page.evaluate(fn, arg);
const flush = async () => { await st(() => window.__store.getState().updateSettings({})); await wait(900); };
function allFiles(dir = UD, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/^(Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|blob_storage|Session Storage|Local Storage|shared_proto_db|Network|Dictionaries|Shared Dictionary|WebStorage|Crashpad|Service Worker|VideoDecodeStats)$/.test(e.name)) allFiles(f, out);
    } else out.push(f);
  }
  return out;
}
const diskHas = (needle) => allFiles().filter((f) => { try { return fs.readFileSync(f).includes(Buffer.from(needle)); } catch { return false; } }).map((f) => path.relative(UD, f));
const storeHas = (needle) => st((n) => JSON.stringify(window.__store.getState(), (k, v) => (typeof v === 'function' ? undefined : v)).includes(n), needle);
const nav = (id) => st((wsId) => window.__store.getState().navigate({ name: 'workspace', workspaceId: wsId, groupId: null }), id);
async function unlock(wsId) {
  await nav(wsId);
  await page.waitForSelector('[data-testid="space-locked"]');
  await page.fill('[data-testid="space-password"]', PASSWORD);
  await page.click('[data-testid="space-unlock"]');
  await page.waitForSelector('[data-testid="space-bar"]', { timeout: 30000 });
}
/** Le verrouillage remplace le rendu : on attend la nouvelle page, prête, sans espace ouvert. */
async function lockedBy(act, timeout = 60000) {
  await st(() => { window.__mgOldRenderer = 1; });
  await act();
  await page.waitForFunction(() => !window.__mgOldRenderer && window.__store && window.__store.getState().ready && !window.__store.getState().unlockedSpaces.length, null, { timeout });
}
/** Modifie l'écrit de l'espace juste avant le verrouillage : la modification ne doit pas être perdue. */
const touch = (draft, title) => st(({ id, t }) => window.__store.getState().patch('drafts', id, { title: t }), { id: draft, t: title });
async function checkAfter(label, seed, title) {
  ok(diskHas(SECRET).length === 0 && diskHas(title).length === 0, `${label} : rien en clair sur le disque`, [...diskHas(SECRET), ...diskHas(title)]);
  ok(!(await storeHas(SECRET)) && !(await storeHas(title)), `${label} : rien de l’espace dans le store de l’interface`);
  await unlock(seed.prive);
  ok(await st(({ id, t }) => window.__store.getState().drafts.find((d) => d.id === id)?.title === t, { id: seed.draft, t: title }), `${label} : la modification faite juste avant est retrouvée (rien de perdu)`);
}

try {
  // ── Préparation : un espace chiffré (sans verrouillage de l'app) ──
  await launch();
  const seed = await st(async ({ secret }) => {
    const s = () => window.__store.getState();
    const prive = s().createWorkspace('Privé').id;
    s().navigate({ name: 'workspace', workspaceId: prive, groupId: null });
    await new Promise((r) => setTimeout(r, 300));
    await s().importFiles([{ name: 'Journal.md', data: new TextEncoder().encode(`# Journal intime\n\n${secret} dans le texte.\n`).buffer }]);
    const d = s().drafts[0];
    if (!s().wsItems.some((i) => i.workspaceId === prive && i.refId === d.id)) s().addToWorkspace(prive, null, 'draft', d.id);
    return { prive, draft: d.id };
  }, { secret: SECRET });
  await flush();
  await page.click(`[data-ws-id="${seed.prive}"]`, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Chiffrer cet espace…' }).click();
  await page.waitForSelector('[data-testid="space-encrypt-dialog"]');
  await page.fill('[data-testid="space-new-password"]', PASSWORD);
  await page.fill('[data-testid="space-new-password2"]', PASSWORD);
  await page.click('[data-testid="space-encrypt-go"]');
  await page.waitForSelector('[data-testid="space-recovery"]');
  await page.check('[data-testid="space-kept"]');
  await page.click('[data-testid="space-encrypt-go"]');
  await page.waitForSelector('[data-testid="space-encrypt-dialog"]', { state: 'detached', timeout: 30000 });
  await flush();
  ok(!(await st(() => window.marginalia.security.status())).lock, 'préparation : verrouillage de l’app désactivé');
  ok(await st(() => window.__store.getState().unlockedSpaces.length === 1), 'préparation : espace chiffré, ouvert');

  // ── 2. Veille, puis écran verrouillé (délai d'inactivité normal : 15 min) ──
  await touch(seed.draft, 'Titre avant la veille');
  await lockedBy(() => app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend')));
  ok(true, 'mise en veille : espace verrouillé');
  await checkAfter('veille', seed, 'Titre avant la veille');

  await touch(seed.draft, 'Titre avant l’écran verrouillé');
  await lockedBy(() => app.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen')));
  ok(true, 'écran verrouillé : espace verrouillé');
  await checkAfter('écran verrouillé', seed, 'Titre avant l’écran verrouillé');
  await quit();

  // ── 1. Inactivité (délai raccourci à 4 s pour le test) ──
  await launch({ MARGINALIA_E2E_SPACES_AUTOLOCK_MS: '4000' });
  ok(await st(() => window.__store.getState().unlockedSpaces.length === 0), 'relance : espace verrouillé d’office');
  await unlock(seed.prive);
  await touch(seed.draft, 'Titre avant l’inactivité');
  const t0 = Date.now();
  await lockedBy(async () => {}, 30000);
  const after = Date.now() - t0;
  ok(after >= 2500, 'inactivité : verrouillé après le délai, pas avant', { ms: after });
  await checkAfter('inactivité', seed, 'Titre avant l’inactivité');
  ok(await st(() => window.__store.getState().unlockedSpaces.length === 1), 'l’espace se rouvre normalement après un verrouillage automatique');
} catch (e) {
  console.log('ÉCHEC exception — ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await quit();
  fs.rmSync(home, { recursive: true, force: true });
}
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
