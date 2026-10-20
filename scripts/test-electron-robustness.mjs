// Robustesse et sûreté des données de l'app Electron (Linux, après npm run build && npm run package) :
// sauvegarde quotidienne, écritures concurrentes, fermeture pendant une écriture, sauvegarde avant
// migration, base corrompue → restauration automatique + avis, rotation du journal, plantage du rendu
// → proposition de rechargement sans perte, ErrorBoundary, erreurs JS au journal (limitées), export /
// restauration d'une sauvegarde complète (.zip, archive piégée refusée), app:// sans traversée,
// IPC qui valident leurs arguments, nettoyage des temporaires, aucune requête réseau.
// Lancer : xvfb-run -a timeout 600 node scripts/test-electron-robustness.mjs
import { _electron as electron } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PACKAGED = path.join(ROOT, 'release/Marginalia-darwin-arm64/Marginalia.app/Contents/Resources/app');
// L'app empaquetée seulement si elle est à jour (même code Electron que le dépôt), sinon le dépôt (dist/).
const same = (f) => {
  try {
    return fs.readFileSync(path.join(PACKAGED, f), 'utf8') === fs.readFileSync(path.join(ROOT, f), 'utf8');
  } catch {
    return false;
  }
};
const APP_DIR = same('electron/main.cjs') && same('electron/preload.cjs') ? PACKAGED : ROOT;
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-robust-'));
const SYS_TMP = path.join(TMP, 'tmp');
fs.mkdirSync(SYS_TMP);
const UD = path.join(TMP, '.config', 'Marginalia');
const DB = path.join(UD, 'db.json');
const BACKUPS = path.join(UD, 'backups');
const LOG = path.join(UD, 'diagnostic.log');
const EPUB = path.join(ROOT, 'fixtures/discours.epub');

const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 15000, step = 100) {
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
const readDb = () => JSON.parse(fs.readFileSync(DB, 'utf8'));
const backups = () => (fs.existsSync(BACKUPS) ? fs.readdirSync(BACKUPS) : []);
const log = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '');
const marker = () => readDb().settings?.robustesseMarqueur;

const requests = [];
async function launch(extraEnv = {}, args = []) {
  const env = { ...process.env, HOME: TMP, XDG_CONFIG_HOME: path.join(TMP, '.config'), TMPDIR: SYS_TMP, VITE_DEV_SERVER_URL: '', MARGINALIA_E2E: '1', ...extraEnv };
  delete env.MARGINALIA_APPLE_BOOKS;
  const app = await electron.launch({ executablePath: EXE, args: ['--no-sandbox', APP_DIR, ...args], env, timeout: 60000 });
  const page = await app.firstWindow();
  page.on('request', (r) => requests.push(r.url()));
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  // Les dialogues natifs sont remplacés (réponses programmées, appels consignés).
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
  return { app, page };
}
const answer = (app, kind, value) => app.evaluate((_e, [k, v]) => (globalThis.__dlg.answers[k] ||= []).push(v), [kind, value]);
const dlgCalls = (app) => app.evaluate(() => globalThis.__dlg.calls);
const clickMenu = (app, label) =>
  app.evaluate(({ Menu }, l) => {
    const find = (items) => {
      for (const i of items) {
        if (i.label === l) return i;
        const s = i.submenu && find(i.submenu.items);
        if (s) return s;
      }
      return null;
    };
    find(Menu.getApplicationMenu().items).click();
  }, label);
const setMarker = (page, v) => page.evaluate((x) => window.__store.getState().updateSettings({ robustesseMarqueur: x }), v);
const state = (page) =>
  page.evaluate(() => {
    const s = window.__store.getState();
    return { books: s.books.length, marker: s.settings.robustesseMarqueur, toasts: s.toasts.map((t) => t.message), route: s.route.name };
  });

// Temporaires laissés par une session interrompue : l'ancien est supprimé, le récent gardé.
const oldTmp = path.join(SYS_TMP, 'marginalia-print-ancien.html');
const newTmp = path.join(SYS_TMP, 'marginalia-img-recent');
fs.writeFileSync(oldTmp, 'x');
fs.mkdirSync(newTmp);
const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
fs.utimesSync(oldTmp, twoHoursAgo, twoHoursAgo);

let app;
let page;
try {
  // ── 1. Premier lancement, import, sauvegarde quotidienne ──
  ({ app, page } = await launch({}, [EPUB]));
  ok(!!(await waitFor(() => !fs.existsSync(oldTmp))), 'temporaire ancien (marginalia-*) supprimé au démarrage');
  ok(fs.existsSync(newTmp), 'temporaire récent conservé');
  ok(!!(await waitFor(async () => (await state(page)).books === 1, 30000)), 'livre importé');
  await setMarker(page, 'm1');
  ok(!!(await waitFor(() => marker() === 'm1')), 'base écrite (marqueur m1)');
  await setMarker(page, 'm1b');
  const day = new Date();
  const dayName = `quotidienne-${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}.json`;
  ok(!!(await waitFor(() => backups().includes(dayName))), 'sauvegarde quotidienne créée', backups());
  const bookId = readDb().books[0].id;
  const libFile = path.join(UD, 'library', bookId, readDb().books[0].fileName);
  ok(fs.existsSync(libFile), 'fichier du livre dans la bibliothèque');

  // ── 2. Écritures concurrentes : 25 écritures simultanées → la dernière gagne, JSON valide ──
  const conc = await page.evaluate(async () => {
    const base = window.__store.getState();
    const db = JSON.parse(JSON.stringify({ ...base, toasts: undefined }));
    const jobs = [];
    for (let i = 0; i < 25; i++) jobs.push(window.marginalia.saveDbJson(JSON.stringify({ ...db, settings: { ...db.settings, robustesseMarqueur: 'c' + i } }), { version: 2, items: 1 }));
    const r = await Promise.allSettled(jobs);
    return r.filter((x) => x.status === 'rejected').length;
  });
  ok(conc === 0, 'écritures concurrentes : aucune erreur');
  ok(marker() === 'c24', 'écritures concurrentes : la plus récente est sur le disque', marker());
  ok(!fs.readdirSync(UD).some((n) => n.endsWith('.tmp')), 'aucun fichier temporaire laissé dans le dossier de données');
  await setMarker(page, 'm2');
  ok(!!(await waitFor(() => marker() === 'm2')), 'le rendu réécrit son état ensuite');

  // ── 3. IPC : arguments refusés ──
  fs.writeFileSync(path.join(TMP, 'autre.docx'), 'x');
  const ipc = await page.evaluate(async (p) => {
    const tryIt = async (f) => f().then(() => 'accepté', (e) => String(e.message || e));
    return {
      ext: await tryIt(() => window.marginalia.writeExternal(p, new ArrayBuffer(4))),
      read: await tryIt(() => window.marginalia.readFile('..', 'db.json')),
      read2: await tryIt(() => window.marginalia.readFile('abc', '../../db.json')),
      save: await tryIt(() => window.marginalia.saveDb('pas une base')),
      saveArr: await tryIt(() => window.marginalia.saveDb([1, 2])),
    };
  }, path.join(TMP, 'autre.docx'));
  ok(/pas été ouvert/.test(ipc.ext) && fs.readFileSync(path.join(TMP, 'autre.docx'), 'utf8') === 'x', 'writeExternal refuse un .docx non ouvert par l’utilisateur', ipc.ext);
  ok(ipc.read !== 'accepté' && ipc.read2 !== 'accepté', 'readFile refuse la remontée de chemin', [ipc.read, ipc.read2]);
  ok(ipc.save !== 'accepté' && ipc.saveArr !== 'accepté', 'saveDb refuse une base invalide', [ipc.save, ipc.saveArr]);
  ok(marker() === 'm2', 'base intacte après les appels refusés');

  // ── 4. app:// : pas de traversée ; aucune requête réseau ──
  const proto = await page.evaluate(async () => {
    const st = async (u) => fetch(u).then((r) => r.status, () => 'erreur');
    return {
      a: await st('app://marginalia/..%2f..%2fpackage.json'),
      b: await st('app://marginalia/%2e%2e/%2e%2e/electron/main.cjs'),
      c: await st('app://marginalia/..%5C..%5Celectron%5Cmain.cjs'),
      d: await st('app://autre/index.html'),
      e: await st('app://marginalia/index.html'),
      net: await fetch('https://example.com/').then(() => 'passé', () => 'bloqué'),
    };
  });
  ok(proto.a !== 200 && proto.b !== 200 && proto.c !== 200, 'app:// refuse ../ (encodé ou non)', proto);
  ok(proto.d !== 200 && proto.e === 200, 'app:// ne sert que l’hôte marginalia', proto);
  ok(proto.net === 'bloqué', 'requête réseau sortante bloquée');
  // La page est déjà bridée par sa CSP ; la session elle-même bloque aussi (requête du processus principal).
  const viaSession = await app.evaluate(({ net }) => net.fetch('https://example.com/').then(() => 'passé', () => 'bloqué'));
  ok(viaSession === 'bloqué', 'session : requête sortante bloquée');
  await waitFor(() => / reseau-bloque /.test(log()), 5000);
  const blk = log().split('\n').filter((l) => / reseau-bloque /.test(l));
  ok(blk.length === 1 && /example\.com/.test(blk[0]), 'seule la requête du test a été bloquée (et consignée, hôte seulement)', blk);

  // ── 5. Erreurs JS du rendu → journal (limitées) ──
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('boom-robustesse');
    });
    setTimeout(() => Promise.reject(new Error('rejet-robustesse')));
  });
  ok(!!(await waitFor(() => /erreur-js.*boom-robustesse/.test(log()) && /promesse-rejetee.*rejet-robustesse/.test(log()))), 'erreurs JS et promesses rejetées consignées');
  await page.evaluate(() => {
    for (let i = 0; i < 60; i++) setTimeout(() => { throw new Error('rafale-' + i); });
  });
  await sleep(800);
  const bursts = log().split('\n').filter((l) => /erreur-js.*rafale-\d+/.test(l)).length;
  ok(bursts > 0 && bursts <= 20, 'limitation de débit des erreurs (≤ 20/min)', bursts);

  // ── 6. ErrorBoundary ──
  await page.evaluate((id) => {
    window.__mgCrashView = 'lecteur';
    window.__store.getState().openBook(id);
  }, bookId);
  ok(!!(await waitFor(() => page.getByText('Cette vue a rencontré un problème').isVisible())), 'lecteur en erreur : message au lieu d’un écran blanc');
  ok(!!(await waitFor(() => /erreur-vue.*lecteur/.test(log()))), 'erreur de vue consignée au journal');
  await page.evaluate(() => (window.__mgCrashView = null));
  await page.getByRole('button', { name: 'Recharger la vue' }).click();
  ok(!!(await waitFor(() => page.locator('.html-doc p').first().isVisible(), 30000)), 'Recharger la vue : le lecteur s’affiche');
  await page.evaluate(() => {
    window.__mgCrashView = 'bibliothèque';
    window.__store.getState().navigate({ name: 'library' });
  });
  ok(!!(await waitFor(() => page.getByText('Cette vue a rencontré un problème').isVisible())), 'bibliothèque en erreur : message');
  ok(await page.locator('nav.sidebar').isVisible(), 'la barre latérale reste utilisable');
  await page.evaluate(() => (window.__mgCrashView = null));
  await page.getByRole('button', { name: 'Revenir à l’accueil' }).click();
  ok((await state(page)).route === 'home' && !(await page.getByText('Cette vue a rencontré un problème').count()), 'Revenir à l’accueil');

  // ── 8. Export d'une sauvegarde complète ──
  const ZIP = path.join(TMP, 'export', 'Sauvegarde.zip');
  fs.mkdirSync(path.dirname(ZIP));
  await setMarker(page, 'au-moment-export');
  await waitFor(() => marker() === 'au-moment-export');
  await answer(app, 'save', { canceled: false, filePath: ZIP });
  await clickMenu(app, 'Exporter une sauvegarde complète…');
  ok(!!(await waitFor(() => fs.existsSync(ZIP), 30000)), 'archive exportée');
  const list = spawnSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  ok(list.includes('db.json') && list.includes('manifest.json') && list.some((n) => n.startsWith(`library/${bookId}/`)), 'archive : db.json, manifest.json, fichiers de la bibliothèque', list);
  ok(spawnSync('unzip', ['-tq', ZIP]).status === 0, 'archive valide (unzip -t)');
  const zdb = JSON.parse(spawnSync('unzip', ['-p', ZIP, 'db.json'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout);
  ok(zdb.settings.robustesseMarqueur === 'au-moment-export', 'archive : base à jour');
  ok(!!(await waitFor(async () => (await state(page)).toasts.some((t) => /Sauvegarde complète enregistrée/.test(t)))), 'avis d’export');

  // ── 9. Restauration ──
  await setMarker(page, 'apres-export');
  await page.evaluate(async (id) => {
    const s = window.__store.getState();
    s.trashDelete('book', id);
    await window.__store.getState().purgeTrash();
  }, bookId);
  ok(!!(await waitFor(() => !fs.existsSync(libFile))), 'livre purgé de la corbeille : fichier supprimé');
  ok(!fs.existsSync(path.join(UD, 'library', bookId)), 'dossier du livre purgé supprimé');
  await answer(app, 'open', { canceled: false, filePaths: [ZIP] });
  await answer(app, 'box', { response: 0 });
  await clickMenu(app, 'Restaurer une sauvegarde…');
  ok(!!(await waitFor(async () => (await dlgCalls(app)).some((c) => c.kind === 'box' && /Remplacer vos données actuelles/.test(c.message)))), 'confirmation demandée avant la restauration');
  const restored = await waitFor(async () => {
    const w = app.windows()[0];
    const s = await w.evaluate(() => window.__store && window.__store.getState().ready && { books: window.__store.getState().books.length, m: window.__store.getState().settings.robustesseMarqueur });
    return s && s.books === 1 && s.m === 'au-moment-export' ? w : null;
  }, 30000);
  ok(!!restored, 'restauration : base de la sauvegarde rechargée');
  if (restored) page = restored;
  ok(fs.existsSync(libFile), 'restauration : fichier du livre revenu');
  ok(backups().some((n) => n.startsWith('avant-restauration-') && fs.existsSync(path.join(BACKUPS, n, 'db.json'))), 'état précédent mis de côté (backups/avant-restauration-…)');
  ok(!!(await waitFor(async () => (await state(page)).toasts.some((t) => /restaurée/.test(t)))), 'avis de restauration');
  await waitFor(() => marker() === 'au-moment-export');

  // Archive piégée (chemin ../) : refusée, rien n'est écrit dehors, données inchangées.
  const EVIL = path.join(TMP, 'piege.zip');
  spawnSync('python3', ['-I', '-c', `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],'w')\nz.writestr('db.json','{"books":[]}')\nz.writestr('../../evade.txt','x')\nz.close()`, EVIL]);
  await answer(app, 'open', { canceled: false, filePaths: [EVIL] });
  await answer(app, 'box', { response: 0 });
  await clickMenu(app, 'Restaurer une sauvegarde…');
  ok(!!(await waitFor(async () => (await dlgCalls(app)).some((c) => c.kind === 'error' && /chemin interdit/.test(c.message)))), 'archive piégée refusée');
  ok(!fs.existsSync(path.join(UD, '..', 'evade.txt')) && !fs.existsSync(path.join(TMP, 'evade.txt')), 'rien d’écrit hors du dossier');
  ok((await state(page)).books === 1 && marker() === 'au-moment-export', 'données inchangées après le refus');

  await app.close();

  // ── 7. Plantage du rendu → proposition de rechargement, données intactes ──
  // (Playwright considère la page plantée comme perdue : vérifications par le processus principal.)
  ({ app, page } = await launch());
  await setMarker(page, 'avant-plantage');
  await waitFor(() => marker() === 'avant-plantage');
  await answer(app, 'box', { response: 0 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  ok(!!(await waitFor(async () => (await dlgCalls(app)).some((c) => c.kind === 'box' && /arrêtée de manière inattendue/.test(c.message)))), 'plantage : rechargement proposé');
  const js = (code) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(c), code);
  const after = await waitFor(
    () => js('window.__store && window.__store.getState().ready && JSON.stringify({ books: window.__store.getState().books.length, marker: window.__store.getState().settings.robustesseMarqueur, toasts: window.__store.getState().toasts.map((t) => t.message) })'),
    30000,
  );
  ok(!!after, 'fenêtre rechargée après le plantage');
  if (after) {
    const st = JSON.parse(after);
    ok(st.books === 1 && st.marker === 'avant-plantage', 'données intactes après le plantage', { books: st.books, marker: st.marker });
    const toast = await waitFor(async () => JSON.parse(await js('JSON.stringify(window.__store.getState().toasts.map((t) => t.message))')).some((t) => /rechargée après un incident/.test(t)));
    ok(!!toast, 'avis « rechargée après un incident »');
  }
  ok(/plantage du rendu/.test(log()), 'plantage consigné au journal');
  await app.close();

  // ── 10. Fermeture pendant une écriture lente : rien n'est perdu ──
  ({ app, page } = await launch({ MARGINALIA_TEST_SAVE_DELAY_MS: '1500' }));
  await setMarker(page, 'fermeture-rapide');
  const t0 = Date.now();
  await app.close();
  ok(true, `fermeture attendue ${Date.now() - t0} ms`);
  ok(marker() === 'fermeture-rapide', 'fermeture juste après une modification : écrite sur le disque', marker());
  ok(/fermeture/.test(log()), 'fermeture consignée');

  // ── 11. Migration de format : sauvegarde avant ; rotation du journal ──
  const d1 = readDb();
  d1.version = 1;
  fs.writeFileSync(DB, JSON.stringify(d1));
  fs.writeFileSync(LOG, 'x'.repeat(5 * 1024 * 1024) + '\n');
  ({ app, page } = await launch());
  ok(!!(await waitFor(() => backups().some((n) => n.startsWith('avant-migration-v1-')))), 'sauvegarde avant migration de format', backups());
  ok(fs.existsSync(LOG + '.1') && fs.statSync(LOG).size < 1024 * 1024, 'journal > 4 Mo : rotation en diagnostic.log.1');
  await waitFor(() => readDb().version === 2);
  await app.close();

  // ── 12. Base corrompue → restauration automatique + avis ──
  fs.writeFileSync(DB, '{"books": [ {"id": tronqué');
  fs.rmSync(DB + '.bak', { force: true }); // seule une sauvegarde de backups/ peut sauver la mise
  ({ app, page } = await launch());
  const st = await state(page);
  ok(st.books === 1, 'base corrompue : bibliothèque restaurée depuis la dernière sauvegarde', st);
  ok(!!(await waitFor(async () => (await state(page)).toasts.some((t) => /illisible.*restaurée automatiquement/.test(t)))), 'avis à l’utilisateur (toast)');
  ok(backups().some((n) => n.startsWith('corrompue-')), 'base endommagée conservée dans backups/');
  ok(/restauree depuis/.test(log()), 'restauration consignée au journal');
  ok(readDb().books.length === 1, 'db.json réécrit avec la sauvegarde');
  await app.close();

  // Base corrompue sans aucune sauvegarde : démarrage vide, mais la base est conservée.
  fs.rmSync(BACKUPS, { recursive: true, force: true });
  fs.rmSync(DB + '.bak', { force: true });
  fs.writeFileSync(DB, 'garbage');
  ({ app, page } = await launch());
  ok(!!(await waitFor(async () => (await state(page)).toasts.some((t) => /aucune sauvegarde valide/.test(t)))), 'sans sauvegarde : avis explicite');
  ok(backups().some((n) => n.startsWith('corrompue-') && fs.readFileSync(path.join(BACKUPS, n), 'utf8') === 'garbage'), 'sans sauvegarde : base illisible conservée');
  await app.close();
  app = null;

  const external = requests.filter((u) => /^(https?|wss?|ftp):/i.test(u));
  ok(external.length === 0, 'aucune requête réseau émise par l’interface', external);
  const blocked = log().split('\n').filter((l) => / reseau-bloque /.test(l));
  ok(blocked.length === 0, 'aucune requête réseau bloquée pendant les derniers lancements', blocked);
} catch (e) {
  ok(false, 'exception', String(e && e.stack));
} finally {
  if (app) await app.close().catch(() => {});
}
