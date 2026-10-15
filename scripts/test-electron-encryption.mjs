// Chiffrement local et verrouillage (options) de l'app Electron, après npm run package :
// désactivé par défaut (fichiers en clair) ; niveau 1 (trousseau simulé) → tous les fichiers chiffrés,
// aucun texte en clair ; redémarrage et lecture d'un EPUB / PDF chiffrés ; trousseau qui refuse → clé
// de secours ; désactivation → fichiers en clair ; conversion interrompue (arrêt brutal) puis reprise ;
// verrouillage par mot de passe → écran de verrouillage, IPC refusés, mauvais mot de passe refusé ;
// « Verrouiller maintenant » sans perte ; clé de secours + nouveau mot de passe ; verrouillage après
// inactivité sans perte ; sauvegarde complète chiffrée / en clair, restauration (même clé, autre clé).
// Lancer : DISPLAY=:99 timeout 900 node scripts/test-electron-encryption.mjs
import { _electron as electron } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APP_DIR = path.join(ROOT, 'release/Marginalia-darwin-arm64/Marginalia.app/Contents/Resources/app');
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-chiffre-'));
const UD = path.join(TMP, '.config', 'Marginalia');
const DB = path.join(UD, 'db.json');
const KS = path.join(UD, 'keystore.json');
const SHOTS = path.join(ROOT, 'shots/security');
fs.mkdirSync(SHOTS, { recursive: true });
const EPUB = path.join(ROOT, 'fixtures/discours.epub');
const PDF = path.join(ROOT, 'fixtures/discours.pdf');
const MAGIC = Buffer.from('MGLENC1\0', 'latin1');
const SECRET = 'SECRET-étude-Spinoza-7731';
const PASSWORD = 'cheval agrafe batterie';
const PASSWORD2 = 'nouveau mot de passe 2';

const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 20000, step = 150) {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* pas encore */
    }
    if (Date.now() - t0 > timeout) return null;
    await sleep(step);
  }
}

// ── Fichiers de données ──
function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(f));
    else if (d.isFile() && !d.name.endsWith('.tmp')) out.push(f);
  }
  return out;
}
const dataFiles = () => [DB, DB + '.bak', ...walk(path.join(UD, 'backups')), ...walk(path.join(UD, 'library'))].filter((f) => fs.existsSync(f));
const sealed = (f) => fs.readFileSync(f).subarray(0, 8).equals(MAGIC);
const rel = (f) => path.relative(UD, f);
function formatReport() {
  const files = dataFiles();
  return { files: files.length, sealed: files.filter(sealed).map(rel), plain: files.filter((f) => !sealed(f)).map(rel) };
}
const containsSecret = (f) => fs.readFileSync(f).includes(Buffer.from(SECRET, 'utf8'));
const logFiles = () => [path.join(UD, 'diagnostic.log'), path.join(UD, 'diagnostic.log.1')].filter((f) => fs.existsSync(f));

// ── Lancement ──
let app = null;
let page = null;
async function launch(extraEnv = {}, args = [], { expectLock = false } = {}) {
  const env = {
    ...process.env,
    HOME: TMP,
    XDG_CONFIG_HOME: path.join(TMP, '.config'),
    VITE_DEV_SERVER_URL: '',
    MARGINALIA_E2E: '1',
    MARGINALIA_E2E_FAKE_SAFESTORAGE: '1',
    ...extraEnv,
  };
  delete env.MARGINALIA_APPLE_BOOKS;
  app = await electron.launch({ executablePath: EXE, args: ['--no-sandbox', APP_DIR, ...args], env, timeout: 60000 });
  page = await app.firstWindow();
  await app.evaluate(({ dialog, shell }) => {
    globalThis.__dlg = { calls: [], answers: {} };
    const rec = (kind) => async (...a) => {
      const opts = a.find((x) => x && typeof x === 'object' && !x.webContents && (x.message || x.title || x.filters || x.defaultPath)) || {};
      globalThis.__dlg.calls.push({ kind, message: opts.message || opts.title || '' });
      const q = globalThis.__dlg.answers[kind];
      return q && q.length ? q.shift() : kind === 'box' ? { response: 1 } : { canceled: true, filePaths: [] };
    };
    dialog.showMessageBox = rec('box');
    dialog.showSaveDialog = rec('save');
    dialog.showOpenDialog = rec('open');
    dialog.showErrorBox = (title, content) => globalThis.__dlg.calls.push({ kind: 'error', message: `${title} : ${content}` });
    shell.showItemInFolder = () => {};
  });
  if (expectLock) await page.waitForSelector('.lock-screen', { timeout: 60000 });
  else await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  return { app, page };
}
async function quit() {
  if (!app) return;
  const a = app;
  app = null;
  await a.close().catch(() => {});
}
const answer = (kind, value) => app.evaluate((_e, [k, v]) => (globalThis.__dlg.answers[k] ||= []).push(v), [kind, value]);
const dlgCalls = () => app.evaluate(() => globalThis.__dlg.calls);
const clickMenu = (label) =>
  app.evaluate(({ Menu }, l) => {
    const find = (items) => {
      for (const i of items) {
        if (i.label === l) return i;
        const s = i.submenu && find(i.submenu.items);
        if (s) return s;
      }
      return null;
    };
    const item = find(Menu.getApplicationMenu().items);
    if (!item || !item.enabled) return false;
    item.click();
    return true;
  }, label);
const status = () => page.evaluate(() => window.marginalia.security.status());
const storeMarker = () => page.evaluate(() => window.__store.getState().settings.secretMarker);
const setMarker = (v) => page.evaluate((x) => window.__store.getState().updateSettings({ secretMarker: x }), v);
const waitMigrationDone = (to) => waitFor(async () => {
  const s = await status();
  return s.migration && s.migration.to === to && s.migration.finished;
}, 60000);
const waitReady = () => page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
async function shot(name, theme) {
  if (theme) {
    await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme);
    await page.evaluate((t) => {
      const s = window.__store?.getState();
      if (s?.ready) s.updateSettings({ theme: t });
      else {
        // Écran de verrouillage : il suit le dernier thème choisi (gardé hors de la base).
        localStorage.setItem('marginalia.lastTheme', t);
        document.documentElement.dataset.theme = t;
      }
    }, theme);
    await sleep(500);
  }
  await page.screenshot({ path: path.join(SHOTS, name) });
}

/** Parcours de l'assistant (clé de secours affichée, cochée, deux groupes retapés). Renvoie la clé. */
async function walkRecoverySteps(shotPrefix) {
  await page.waitForSelector('.sec-key[data-key]', { timeout: 20000 });
  const key = await page.getAttribute('.sec-key', 'data-key');
  if (shotPrefix) {
    await shot(`${shotPrefix}-cle-clair.png`, 'light');
    await shot(`${shotPrefix}-cle-sombre.png`, 'dark');
    await shot(`${shotPrefix}-cle-retour.png`, 'light');
    fs.rmSync(path.join(SHOTS, `${shotPrefix}-cle-retour.png`), { force: true });
  }
  if (shotPrefix === 'niveau1') {
    // Clé de secours enregistrée en PDF (à imprimer)
    const pdfOut = path.join(TMP, 'cle-de-secours.pdf');
    await answer('save', { canceled: false, filePath: pdfOut });
    await page.locator('.sec-key-actions button', { hasText: 'Enregistrer en PDF' }).click();
    ok(!!(await waitFor(() => fs.existsSync(pdfOut) && fs.readFileSync(pdfOut).subarray(0, 4).toString() === '%PDF', 20000)), 'clé de secours enregistrée en PDF');
  }
  const cont = page.locator('.sec-dialog .btn-primary', { hasText: 'Continuer' });
  ok(await cont.isDisabled(), 'clé de secours : « Continuer » attend la case « J’ai noté… »');
  await page.check('.sec-check input');
  await cont.click();
  await page.waitForSelector('.sec-probe', { timeout: 10000 });
  const labels = await page.locator('.sec-probe label span').allTextContents();
  const groups = key.split('-');
  const idx = labels.map((l) => Number(l.match(/\d+/)[0]) - 1);
  // D'abord une erreur volontaire
  await page.locator('.sec-probe-input').nth(0).fill('ZZZZ');
  await page.locator('.sec-probe-input').nth(1).fill(groups[idx[1]]);
  await page.locator('.sec-dialog form .btn-primary').click();
  ok(!!(await waitFor(() => page.locator('.sec-error').isVisible(), 5000)), 'vérification : un groupe faux est refusé');
  await page.locator('.sec-probe-input').nth(0).fill(groups[idx[0]].toLowerCase());
  await page.locator('.sec-dialog form .btn-primary').click();
  return key;
}

const epubReadable = (id) =>
  page.evaluate(async (id) => {
    const b = window.__store.getState().books.find((x) => x.id === id);
    const buf = new Uint8Array(await window.marginalia.readFile(id, b.fileName));
    return String.fromCharCode(buf[0], buf[1]);
  }, id);

try {
  // ── 1. Par défaut : rien n'est chiffré ──
  await launch({}, [EPUB, PDF]);
  ok(!!(await waitFor(async () => (await page.evaluate(() => window.__store.getState().books.length)) === 2, 40000)), 'EPUB et PDF importés');
  await setMarker(SECRET);
  await page.evaluate((s) => window.marginalia.diag('test', 'passage', s), SECRET);
  ok(!!(await waitFor(() => fs.existsSync(DB) && fs.readFileSync(DB, 'utf8').includes(SECRET))), 'base écrite');
  let st = await status();
  ok(!st.encrypted && !st.lock && !st.locked && !fs.existsSync(KS), 'par défaut : ni chiffrement ni verrouillage, pas de keystore.json', st);
  let rep = formatReport();
  ok(rep.sealed.length === 0 && rep.files >= 3, 'par défaut : tous les fichiers en clair', rep);
  ok(logFiles().some(containsSecret), 'journal de diagnostic : la ligne de test est lisible avant chiffrement');
  const books = await page.evaluate(() => window.__store.getState().books.map((b) => ({ id: b.id, format: b.format, fileName: b.fileName })));
  const epubId = books.find((b) => b.format === 'epub')?.id;
  const pdfId = books.find((b) => b.format === 'pdf')?.id;
  ok(!!epubId && !!pdfId, 'identifiants des livres', books);

  // Réglages : section visible
  await page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await page.waitForSelector('#set-encrypt', { timeout: 15000 });
  ok(await page.getByText('Confidentialité et sécurité').isVisible(), 'Réglages › Confidentialité et sécurité');
  ok((await page.getAttribute('#set-encrypt [role="switch"]', 'aria-checked')) === 'false', 'interrupteur « Chiffrer mes données » désactivé par défaut');
  await shot('reglages-off-clair.png', 'light');

  // ── 2. Niveau 1 par l'interface ──
  await page.click('#set-encrypt [role="switch"]');
  await page.waitForSelector('.sec-dialog[data-step="intro"]');
  await shot('assistant-intro-clair.png');
  await page.locator('.sec-dialog .btn-primary', { hasText: 'Continuer' }).click();
  const key1 = await walkRecoverySteps('niveau1');
  ok(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/.test(key1), 'clé de secours au format XXXX-…', key1);
  ok(!!(await waitMigrationDone('encrypted')), 'chiffrement des fichiers terminé');
  ok(!!(await waitFor(() => page.getByText('C’est fait').isVisible(), 10000)), 'assistant : « C’est fait »');
  await page.locator('.sec-dialog .btn-primary', { hasText: 'Terminé' }).click();
  rep = formatReport();
  ok(rep.plain.length === 0 && rep.sealed.length >= 5, 'niveau 1 : base, .bak, sauvegardes et bibliothèque chiffrées', rep);
  ok(!dataFiles().some(containsSecret), 'niveau 1 : le texte témoin n’apparaît dans aucun fichier');
  ok(!logFiles().some(containsSecret), 'niveau 1 : journal de diagnostic chiffré ligne par ligne');
  ok(fs.existsSync(KS) && !fs.readFileSync(KS, 'utf8').includes(SECRET), 'keystore.json créé (enveloppes de clé seulement)');
  const ks1 = JSON.parse(fs.readFileSync(KS, 'utf8'));
  ok(ks1.enabled && !ks1.migration && ks1.system && ks1.recovery && !ks1.password, 'keystore : trousseau + clé de secours, pas de mot de passe', Object.keys(ks1));
  ok(fs.readdirSync(path.join(UD, 'backups')).some((n) => n.startsWith('avant-chiffrement-')), 'copie de la base avant chiffrement (elle-même chiffrée)');
  ok((await epubReadable(epubId)) === 'PK', 'EPUB relu en clair par l’app (IPC)');
  await setMarker(SECRET + '-2');
  ok(!!(await waitFor(() => sealed(DB) && !containsSecret(DB))), 'nouvelle écriture de la base : chiffrée');
  await page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await page.waitForSelector('#set-encrypt .set-badge');
  await shot('reglages-niveau1-clair.png', 'light');
  await shot('reglages-niveau1-sombre.png', 'dark');
  await app.evaluate(({ nativeTheme }) => (nativeTheme.themeSource = 'light'));
  await quit();

  // ── 3. Redémarrage : ouverture normale, lecteur EPUB et PDF ──
  await launch();
  ok((await storeMarker()) === SECRET + '-2', 'redémarrage : base chiffrée relue sans rien demander');
  await page.evaluate((id) => window.__store.getState().openBook(id), epubId);
  ok(!!(await waitFor(() => page.locator('.html-doc p').first().isVisible(), 40000)), 'lecteur : EPUB chiffré affiché');
  await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
  await page.evaluate((id) => window.__store.getState().openBook(id), pdfId);
  ok(!!(await waitFor(() => page.locator('.pdf-page[data-page="1"] canvas').first().isVisible(), 40000)), 'lecteur : PDF chiffré affiché');
  await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
  await quit();

  // ── 4. Le trousseau ne rend plus la clé → clé de secours ──
  await launch({ MARGINALIA_E2E_KEYCHAIN_FAIL: '1' }, [], { expectLock: true });
  st = await status();
  ok(st.locked && st.lockReason === 'keychain', 'trousseau en échec : écran « clé de secours nécessaire »', st.lockReason);
  ok(await page.getByText('Clé de secours nécessaire').isVisible(), 'titre de l’écran');
  await shot('trousseau-clair.png', 'light');
  await page.fill('#lock-key', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH');
  await page.click('.lock-submit');
  ok(!!(await waitFor(() => page.locator('.lock-error').isVisible(), 8000)), 'mauvaise clé de secours refusée');
  await page.fill('#lock-key', key1.toLowerCase().replace(/-/g, ' '));
  await page.click('.lock-submit');
  await waitReady();
  ok((await storeMarker()) === SECRET + '-2', 'clé de secours (saisie tolérante) : données retrouvées');
  await quit();
  await launch();
  ok((await storeMarker()) === SECRET + '-2', 'après la clé de secours, le trousseau rend de nouveau la clé');

  // ── 5. Désactivation par l'interface → fichiers en clair ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await page.click('#set-encrypt [role="switch"]');
  await page.waitForSelector('.sec-dialog[data-step="confirm"]');
  await page.locator('.sec-dialog .btn-primary', { hasText: 'Tout remettre en clair' }).click();
  ok(!!(await waitMigrationDone('plain')), 'déchiffrement terminé');
  await page.locator('.sec-dialog .btn-primary', { hasText: 'Terminé' }).click();
  rep = formatReport();
  ok(rep.sealed.length === 0, 'désactivé : tous les fichiers de nouveau en clair', rep);
  ok(!fs.existsSync(KS) && !fs.existsSync(KS + '.bak'), 'désactivé : keystore.json retiré');
  ok(JSON.parse(fs.readFileSync(DB, 'utf8')).settings.secretMarker === SECRET + '-2', 'base en clair lisible, marqueur intact');
  ok(logFiles().some(containsSecret), 'journal remis en clair');
  await quit();

  // ── 6. Conversion interrompue (arrêt brutal) puis reprise ──
  await launch({ MARGINALIA_E2E_MIGRATION_CRASH_AFTER: '3' });
  const exited = new Promise((r) => app.process().once('exit', (code) => r(code)));
  await page
    .evaluate(async () => {
      const p = await window.marginalia.security.prepare();
      await window.marginalia.security.enable(p.token);
    })
    .catch(() => {});
  const code = await Promise.race([exited, sleep(30000).then(() => 'délai')]);
  ok(code === 70, 'arrêt brutal pendant le chiffrement (simulé)', code);
  app = null;
  rep = formatReport();
  const ksMid = JSON.parse(fs.readFileSync(KS, 'utf8'));
  ok(rep.sealed.length >= 1 && rep.plain.length >= 1, 'dossier à moitié converti (chiffrés + en clair)', { chiffres: rep.sealed.length, clairs: rep.plain.length });
  ok(ksMid.migration && ksMid.migration.to === 'encrypted', 'keystore : conversion en attente');
  await launch();
  ok((await storeMarker()) === SECRET + '-2', 'état mixte : l’app lit tout (en-tête détecté fichier par fichier)');
  ok(!!(await waitMigrationDone('encrypted')), 'reprise automatique de la conversion au lancement');
  rep = formatReport();
  ok(rep.plain.length === 0, 'après reprise : tout est chiffré', rep);
  ok(!JSON.parse(fs.readFileSync(KS, 'utf8')).migration, 'keystore : plus de conversion en attente');
  ok((await epubReadable(epubId)) === 'PK', 'EPUB toujours lisible après reprise');
  // Retour en clair (API) pour activer le verrouillage depuis zéro par l'interface.
  await page.evaluate(() => window.marginalia.security.disable());
  ok(!!(await waitMigrationDone('plain')), 'désactivation (API)');

  // ── 7. Verrouillage par mot de passe (depuis zéro, par l'interface) ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await page.click('#set-lock [role="switch"]');
  await page.waitForSelector('.sec-dialog[data-step="password"]');
  await page.fill('.sec-dialog input[aria-label="Mot de passe"]', 'court');
  await page.fill('.sec-dialog input[aria-label="Confirmer le mot de passe"]', 'court');
  await page.locator('.sec-dialog form .btn-primary').click();
  ok(!!(await waitFor(() => page.locator('.sec-error').isVisible(), 5000)), 'mot de passe trop court refusé');
  await page.fill('.sec-dialog input[aria-label="Mot de passe"]', PASSWORD);
  await page.fill('.sec-dialog input[aria-label="Confirmer le mot de passe"]', PASSWORD);
  await page.locator('.sec-dialog .set-seg button', { hasText: '30 min' }).click();
  await shot('assistant-mot-de-passe-clair.png', 'light');
  await shot('assistant-mot-de-passe-sombre.png', 'dark');
  await page.locator('.sec-dialog form .btn-primary').click();
  const key2 = await walkRecoverySteps('niveau2');
  ok(!!(await waitMigrationDone('encrypted')), 'verrouillage activé : données chiffrées');
  await page.locator('.sec-dialog .btn-primary', { hasText: 'Terminé' }).click();
  const ks2 = JSON.parse(fs.readFileSync(KS, 'utf8'));
  ok(ks2.lock.enabled && ks2.password && ks2.password.kdf === 'scrypt' && ks2.password.N >= 2 ** 17 && !ks2.system && ks2.lock.autoLockMinutes === 30, 'keystore : mot de passe (scrypt), pas de copie dans le trousseau, 30 min', { lock: ks2.lock, system: !!ks2.system });
  rep = formatReport();
  ok(rep.plain.length === 0 && !dataFiles().some(containsSecret), 'niveau 2 : tout est chiffré, aucun texte en clair');
  await page.waitForSelector('#set-lock .set-badge');
  await shot('reglages-niveau2-clair.png', 'light');
  await shot('reglages-niveau2-sombre.png', 'dark');
  await quit();

  // ── 8. Redémarrage : écran de verrouillage, IPC refusés ──
  await launch({}, [], { expectLock: true });
  ok(!(await page.evaluate(() => !!(window.__store && window.__store.getState().ready))), 'verrouillé : la base n’est pas chargée dans le rendu');
  const refused = await page.evaluate(async (id) => {
    const t = (f) => f().then(() => 'accepté', (e) => String(e.message || e));
    return {
      loadDb: await t(() => window.marginalia.loadDb()),
      readFile: await t(() => window.marginalia.readFile(id, 'source.epub')),
      saveDb: await t(() => window.marginalia.saveDbJson('{"books":[]}', { version: 1, items: 0 })),
      storeFile: await t(() => window.marginalia.storeFile(id, 'x.txt', new ArrayBuffer(4))),
    };
  }, epubId);
  ok(Object.values(refused).every((v) => /verrouill/i.test(v)), 'verrouillé : lecture et écriture des données refusées (IPC)', refused);
  ok(!fs.existsSync(path.join(UD, 'library', epubId, 'x.txt')), 'aucune écriture pendant le verrouillage');
  await shot('verrouillage-clair.png', 'light');
  await shot('verrouillage-sombre.png', 'dark');
  await app.evaluate(({ nativeTheme }) => (nativeTheme.themeSource = 'light'));
  await page.fill('#lock-password', 'pas le bon');
  await page.click('.lock-submit');
  ok(!!(await waitFor(() => page.locator('.lock-error').isVisible(), 10000)), 'mauvais mot de passe refusé');
  await shot('verrouillage-erreur-clair.png');
  await page.fill('#lock-password', PASSWORD);
  await page.click('.lock-submit');
  await waitReady();
  ok((await storeMarker()) === SECRET + '-2', 'bon mot de passe : déverrouillé, données chargées');

  // ── 9. « Verrouiller maintenant » : la modification en attente est enregistrée ──
  await setMarker('avant-verrou');
  ok(await clickMenu('Verrouiller maintenant'), 'menu Fichier › Verrouiller maintenant');
  await page.waitForSelector('.lock-screen', { timeout: 20000 });
  ok(!(await page.evaluate(() => !!(window.__store && window.__store.getState().ready))), 'verrouillé : la page est rechargée sans données');
  // Clé de secours + nouveau mot de passe
  await page.getByText('Mot de passe oublié ? Utiliser la clé de secours').click();
  await page.fill('#lock-key', key2);
  await page.fill('input[aria-label="Nouveau mot de passe"]', PASSWORD2);
  await page.fill('input[aria-label="Confirmer le nouveau mot de passe"]', PASSWORD2);
  await shot('verrouillage-cle-de-secours-clair.png');
  await page.click('.lock-submit');
  await waitReady();
  ok((await storeMarker()) === 'avant-verrou', 'modification faite juste avant le verrouillage : conservée');
  ok(true, 'clé de secours : déverrouillé, nouveau mot de passe défini');
  await clickMenu('Verrouiller maintenant');
  await page.waitForSelector('.lock-screen', { timeout: 20000 });
  await page.fill('#lock-password', PASSWORD);
  await page.click('.lock-submit');
  ok(!!(await waitFor(() => page.locator('.lock-error').isVisible(), 10000)), 'ancien mot de passe refusé');
  await page.fill('#lock-password', PASSWORD2);
  await page.click('.lock-submit');
  await waitReady();
  ok(true, 'nouveau mot de passe accepté');

  // ── 9 bis. Réglages : délai de verrouillage, nouvelle clé de secours (mot de passe exigé) ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await page.waitForSelector('#set-lock .set-badge');
  await page.locator('.set-seg button', { hasText: '15 min' }).click();
  ok(!!(await waitFor(() => JSON.parse(fs.readFileSync(KS, 'utf8')).lock.autoLockMinutes === 15)), 'réglage « Verrouiller après » : 15 min enregistré');
  await page.locator('#set-recovery button', { hasText: 'Afficher une nouvelle clé de secours' }).click();
  await page.waitForSelector('.sec-dialog[data-step="confirm"]');
  await page.fill('.sec-dialog input[aria-label="Mot de passe actuel"]', 'faux mot de passe');
  await page.locator('.sec-dialog form .btn-primary').click();
  ok(!!(await waitFor(() => page.locator('.sec-error').isVisible(), 8000)), 'nouvelle clé de secours : mauvais mot de passe refusé');
  await page.fill('.sec-dialog input[aria-label="Mot de passe actuel"]', PASSWORD2);
  await page.locator('.sec-dialog form .btn-primary').click();
  const key3 = await walkRecoverySteps('');
  ok(!!(await waitFor(() => page.getByText('Nouvelle clé de secours enregistrée').isVisible(), 10000)), 'nouvelle clé de secours enregistrée', key3);
  ok(key3 !== key2, 'la nouvelle clé diffère de l’ancienne');

  // ── 10. Sauvegarde complète : chiffrée, en clair, restauration ──
  const ZIP_ENC = path.join(TMP, 'export', 'chiffree.zip');
  const ZIP_PLAIN = path.join(TMP, 'export', 'clair.zip');
  fs.mkdirSync(path.dirname(ZIP_ENC), { recursive: true });
  await setMarker('au-moment-export');
  await sleep(2500);
  await answer('box', { response: 0 });
  await answer('save', { canceled: false, filePath: ZIP_ENC });
  await clickMenu('Exporter une sauvegarde complète…');
  ok(!!(await waitFor(() => fs.existsSync(ZIP_ENC), 30000)), 'sauvegarde chiffrée exportée');
  const unzip = (zip, entry) => spawnSync('unzip', ['-p', zip, entry], { maxBuffer: 256 * 1024 * 1024 }).stdout;
  const man = JSON.parse(unzip(ZIP_ENC, 'manifest.json').toString('utf8'));
  ok(man.encrypted === true && man.keyId && man.keys && man.keys.recovery && man.keys.password, 'manifest : archive chiffrée, enveloppes clé de secours et mot de passe', Object.keys(man));
  ok(unzip(ZIP_ENC, 'db.json').subarray(0, 8).equals(MAGIC), 'archive chiffrée : db.json chiffré');
  const libEntries = spawnSync('unzip', ['-Z1', ZIP_ENC]).stdout.toString().split('\n').filter((n) => n.startsWith('library/') && !n.endsWith('/'));
  ok(libEntries.length >= 2 && libEntries.every((n) => unzip(ZIP_ENC, n).subarray(0, 8).equals(MAGIC)), 'archive chiffrée : fichiers de la bibliothèque chiffrés', libEntries.length);
  await answer('box', { response: 1 });
  await answer('box', { response: 0 });
  await answer('save', { canceled: false, filePath: ZIP_PLAIN });
  await clickMenu('Exporter une sauvegarde complète…');
  ok(!!(await waitFor(() => fs.existsSync(ZIP_PLAIN), 30000)), 'sauvegarde en clair exportée (après avertissement)');
  const calls = (await dlgCalls()).map((c) => c.message);
  ok(calls.some((m) => /chiffrée ou en clair/.test(m)) && calls.some((m) => /sans chiffrement/.test(m)), 'choix chiffrée / en clair, puis avertissement', calls);
  ok(unzip(ZIP_PLAIN, 'db.json').toString('utf8').includes('au-moment-export'), 'archive en clair : db.json lisible');
  ok(unzip(ZIP_PLAIN, libEntries.find((n) => n.endsWith('.epub'))).subarray(0, 2).toString() === 'PK', 'archive en clair : EPUB déchiffré');
  // Restauration de l'archive chiffrée (même clé : rien à demander)
  await setMarker('apres-export');
  await sleep(2500);
  await answer('open', { canceled: false, filePaths: [ZIP_ENC] });
  await answer('box', { response: 0 });
  await clickMenu('Restaurer une sauvegarde…');
  await sleep(1500);
  await waitReady();
  ok(!!(await waitFor(async () => (await storeMarker()) === 'au-moment-export', 20000)), 'restauration de l’archive chiffrée (même clé)');
  ok(formatReport().plain.length === 0, 'après restauration : fichiers chiffrés avec la clé de cette installation');

  // ── 11. Verrouillage après inactivité (délai de test) sans perte ──
  await quit();
  await launch({ MARGINALIA_E2E_AUTOLOCK_MS: '3000' }, [], { expectLock: true });
  await page.fill('#lock-password', PASSWORD2);
  await page.click('.lock-submit');
  await waitReady();
  await page.evaluate(() => {
    window.marginalia.security.activity();
    setTimeout(() => window.__store.getState().updateSettings({ secretMarker: 'juste-avant-auto' }), 2800);
  });
  const t0 = Date.now();
  ok(!!(await page.waitForSelector('.lock-screen', { timeout: 15000 }).catch(() => null)), 'verrouillage automatique après inactivité', `${Date.now() - t0} ms`);
  await page.getByText('Mot de passe oublié ? Utiliser la clé de secours').click();
  await page.fill('#lock-key', key2);
  await page.fill('input[aria-label="Nouveau mot de passe"]', PASSWORD2);
  await page.fill('input[aria-label="Confirmer le nouveau mot de passe"]', PASSWORD2);
  await page.click('.lock-submit');
  ok(!!(await waitFor(() => page.getByText('Clé de secours incorrecte').isVisible(), 10000)), 'l’ancienne clé de secours ne fonctionne plus');
  await page.getByText('Revenir au mot de passe').click();
  await page.fill('#lock-password', PASSWORD2);
  await page.click('.lock-submit');
  await waitReady();
  ok((await storeMarker()) === 'juste-avant-auto', 'modification faite juste avant le verrouillage automatique : conservée');
  await quit();

  // ── 12. Restauration d'une archive chiffrée sur une installation sans chiffrement (autre clé) ──
  await launch({}, [], { expectLock: true });
  await page.fill('#lock-password', PASSWORD2);
  await page.click('.lock-submit');
  await waitReady();
  await page.evaluate((pw) => window.marginalia.security.disable(pw), PASSWORD2);
  ok(!!(await waitMigrationDone('plain')), 'chiffrement désactivé (mot de passe exigé)');
  ok(!fs.existsSync(KS), 'plus de fichier de clés');
  await setMarker('etat-local');
  await sleep(2500);
  await answer('open', { canceled: false, filePaths: [ZIP_ENC] });
  await answer('box', { response: 0 });
  await clickMenu('Restaurer une sauvegarde…');
  await page.waitForSelector('.sec-ask input', { timeout: 20000 });
  await shot('restauration-demande-clair.png');
  await page.fill('.sec-ask input', 'mauvaise valeur');
  await page.click('.sec-ask .btn-primary');
  ok(!!(await waitFor(() => page.getByText('Clé de secours ou mot de passe incorrect').isVisible(), 15000)), 'archive chiffrée : valeur fausse refusée');
  await page.fill('.sec-ask input', key3);
  await page.click('.sec-ask .btn-primary');
  await sleep(2000);
  await waitReady();
  ok(!!(await waitFor(async () => (await storeMarker()) === 'au-moment-export', 30000)), 'archive chiffrée restaurée avec la clé de secours (celle en vigueur à l’export)');
  rep = formatReport();
  ok(rep.sealed.length === 0, 'restaurée sans chiffrement local : fichiers remis en clair', rep);
  ok((await epubReadable(epubId)) === 'PK', 'EPUB restauré lisible');
  const errs = (await dlgCalls()).filter((c) => c.kind === 'error');
  ok(errs.length === 0, 'aucune boîte d’erreur', errs);
} catch (e) {
  console.error(e);
  ok(false, 'exception', String(e && e.stack ? e.stack : e));
} finally {
  await quit();
  if (!process.exitCode) fs.rmSync(TMP, { recursive: true, force: true });
  else console.log('Dossier de test conservé :', TMP);
}
