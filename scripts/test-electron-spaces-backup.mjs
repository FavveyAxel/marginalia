// Espaces chiffrés et sauvegarde complète, de bout en bout (Electron) : exporter une sauvegarde alors
// qu'un espace est chiffré et verrouillé, vérifier que l'archive ne contient rien en clair de cet espace,
// puis la restaurer — sur la même installation (après des modifications) et sur une installation NEUVE —
// et rouvrir l'espace avec le mot de passe : les clés voyagent dans la sauvegarde.
// Prérequis : npx vite build ; Xvfb ; unzip. Lancer : xvfb-run -a node scripts/test-electron-spaces-backup.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
  return c;
};
const EPUB = fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')).toString('base64');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-spbk-'));
const SECRET = 'SECRET-SAUVEGARDE-9K4';
const PASSWORD = 'correct horse battery';
const ZIP = path.join(TMP, 'sauvegarde.zip');
let app, page;
const errors = [];
async function launch(name) {
  const home = path.join(TMP, name);
  fs.mkdirSync(home, { recursive: true });
  app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: path.join(home, 'donnees'), VITE_DEV_SERVER_URL: '' },
    timeout: 120000,
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
  page.on('pageerror', (e) => errors.push(String(e)));
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
  await ready();
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
  return path.join(home, 'donnees');
}
const ready = () => page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 120000 });
const quit = async () => { await app.close().catch(() => {}); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (fn, arg) => page.evaluate(fn, arg);
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
const flush = async () => { await st(() => window.__store.getState().updateSettings({})); await wait(900); };
const until = async (fn, ms = 30000) => { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t > ms) return null; await wait(200); } };
const unzip = (entry) => spawnSync('unzip', ['-p', ZIP, entry], { maxBuffer: 512 * 1024 * 1024 }).stdout;
const unlock = async (wsId) => {
  await st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), wsId);
  await page.waitForSelector('[data-testid="space-locked"]', { timeout: 30000 });
  await page.fill('[data-testid="space-password"]', PASSWORD);
  await page.click('[data-testid="space-unlock"]');
  await page.waitForSelector('[data-testid="space-bar"]', { timeout: 30000 });
};
const lock = async (wsId) => {
  await st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), wsId);
  await page.click('[data-testid="space-lock"]');
  await page.waitForSelector('[data-testid="space-locked"]', { timeout: 30000 });
};

try {
  await launch('a');
  const seed = await st(async ({ b64, secret }) => {
    const s = () => window.__store.getState();
    const cours = s().createWorkspace('Cours').id;
    s().navigate({ name: 'workspace', workspaceId: cours, groupId: null });
    await new Promise((r) => setTimeout(r, 300));
    await s().importFiles([{ name: 'Dissertation.md', data: new TextEncoder().encode('# Dissertation\n\nTexte ordinaire.\n').buffer }]);
    const dCours = s().drafts[0].id;
    const prive = s().createWorkspace('Privé').id;
    s().navigate({ name: 'workspace', workspaceId: prive, groupId: null });
    await new Promise((r) => setTimeout(r, 300));
    await s().importFiles([{ name: 'Journal.md', data: new TextEncoder().encode(`# Journal intime\n\n${secret} dans le texte.\n`).buffer }]);
    const dPrive = s().drafts.find((d) => d.id !== dCours).id;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const [book] = await s().importFiles([{ name: 'Discours de la méthode.epub', data: bytes.buffer }]);
    for (const [k, id] of [['book', book.id], ['draft', dPrive]]) if (!s().wsItems.some((i) => i.workspaceId === prive && i.refId === id)) s().addToWorkspace(prive, null, k, id);
    s().insert('highlights', { id: 'hl-secret', bookId: book.id, text: 'passage', note: `note ${secret}`, category: 'these', conceptIds: [], createdAt: Date.now(), updatedAt: Date.now(), anchor: null });
    return { cours, prive, dCours, dPrive, book: book.id, draftFile: s().drafts.find((d) => d.id === dPrive).fileName, bookFile: s().books.find((b) => b.id === book.id).fileName };
  }, { b64: EPUB, secret: SECRET });
  await flush();
  // Chiffrer « Privé », puis le verrouiller.
  await page.click(`[data-ws-id="${seed.prive}"]`, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Chiffrer cet espace…' }).click();
  await page.fill('[data-testid="space-new-password"]', PASSWORD);
  await page.fill('[data-testid="space-new-password2"]', PASSWORD);
  await page.click('[data-testid="space-encrypt-go"]');
  await page.waitForSelector('[data-testid="space-recovery"]');
  const RECOVERY = await page.getAttribute('[data-testid="space-recovery"]', 'data-key');
  await page.check('[data-testid="space-kept"]');
  await page.click('[data-testid="space-encrypt-go"]');
  await page.waitForSelector('[data-testid="space-encrypt-dialog"]', { state: 'detached', timeout: 30000 });
  await flush();
  await lock(seed.prive);

  // ── 1. Exporter une sauvegarde complète, espace verrouillé ──
  await answer('save', { canceled: false, filePath: ZIP });
  ok(await clickMenu('Exporter une sauvegarde complète…'), 'menu : Exporter une sauvegarde complète…');
  ok(!!(await until(() => fs.existsSync(ZIP) && fs.statSync(ZIP).size > 1000)), 'sauvegarde exportée, espace verrouillé');
  await wait(800);
  const entries = spawnSync('unzip', ['-Z1', ZIP]).stdout.toString().split('\n').filter((n) => n && !n.endsWith('/'));
  const dbz = JSON.parse(unzip('db.json').toString('utf8'));
  ok(typeof dbz.sealedSpaces?.[seed.prive] === 'string' && !!dbz.spaceKeys && dbz.spaceOwners?.[seed.dPrive] === seed.prive, 'archive : capsule scellée, clés enveloppées et liste des fichiers de l’espace');
  ok(!dbz.drafts.some((d) => d.id === seed.dPrive) && !dbz.books.some((b) => b.id === seed.book) && dbz.drafts.some((d) => d.id === seed.dCours), 'archive : la base ne contient pas le contenu de l’espace, mais bien le reste');
  const leaks = entries.filter((n) => { const b = unzip(n); return b.includes(Buffer.from(SECRET)) || b.includes(Buffer.from('Journal intime')); });
  ok(leaks.length === 0, `archive : aucune des ${entries.length} entrées ne contient le texte ou le titre de l’espace`, leaks);
  const libOf = (id) => entries.filter((n) => n.startsWith(`library/${id}/`));
  ok(libOf(seed.dPrive).length > 0 && [...libOf(seed.dPrive), ...libOf(seed.book)].every((n) => unzip(n).subarray(0, 7).toString('latin1') === 'MGLSPC1'), 'archive : les fichiers de l’espace y sont, scellés avec sa clé', [...libOf(seed.dPrive), ...libOf(seed.book)]);
  ok(libOf(seed.dCours).length > 0 && libOf(seed.dCours).every((n) => unzip(n).subarray(0, 7).toString('latin1') !== 'MGLSPC1'), 'archive : les autres fichiers sont inchangés');

  // ── 2. Modifier après l'export, puis restaurer sur la même installation ──
  await unlock(seed.prive);
  await st(({ dPrive, dCours }) => { const s = window.__store.getState(); s.patch('drafts', dPrive, { title: 'Modifié après la sauvegarde' }); s.patch('drafts', dCours, { title: 'Cours modifié' }); }, seed);
  await flush();
  await answer('open', { canceled: false, filePaths: [ZIP] });
  await answer('box', { response: 0 });
  ok(await clickMenu('Restaurer une sauvegarde…'), 'menu : Restaurer une sauvegarde…');
  ok(!!(await until(async () => (await st((id) => window.__store?.getState().ready && window.__store.getState().drafts.find((d) => d.id === id)?.title, seed.dCours)) === 'Dissertation', 60000)), 'restauration : la base d’avant est revenue (écrit du cours)', (await dlgCalls()).filter((c) => c.kind === 'error'));
  await ready();
  ok(await st(({ prive, dPrive }) => { const s = window.__store.getState(); return s.workspaces.some((w) => w.id === prive && w.encrypted) && !s.drafts.some((d) => d.id === dPrive) && !s.unlockedSpaces.length; }, seed), 'après restauration : l’espace est là, chiffré et verrouillé');
  await unlock(seed.prive);
  ok(await st(({ dPrive, book }) => { const s = window.__store.getState(); return s.drafts.find((d) => d.id === dPrive)?.title !== 'Modifié après la sauvegarde' && !!s.drafts.find((d) => d.id === dPrive) && s.books.some((b) => b.id === book) && s.highlights.some((h) => h.id === 'hl-secret'); }, seed), 'espace déverrouillé après restauration : contenu de la sauvegarde (pas la modification faite ensuite)');
  const read = (id, f) => st(({ id, f }) => window.marginalia.readFile(id, f).then((b) => b.byteLength, (e) => String(e.message || e)), { id, f });
  ok((await read(seed.dPrive, seed.draftFile)) > 100 && (await read(seed.book, seed.bookFile)) > 1000, 'les fichiers de l’écrit et du livre de l’espace se lisent', [await read(seed.dPrive, seed.draftFile), await read(seed.book, seed.bookFile)]);
  await quit();

  // ── 3. Restaurer sur une installation NEUVE (autre ordinateur) ──
  const UD2 = await launch('b');
  ok(await st(() => window.__store.getState().workspaces.length === 0), 'installation neuve : vide');
  await answer('open', { canceled: false, filePaths: [ZIP] });
  await answer('box', { response: 0 });
  await clickMenu('Restaurer une sauvegarde…');
  ok(!!(await until(async () => await st((id) => window.__store?.getState().ready && window.__store.getState().workspaces.some((w) => w.id === id && w.encrypted), seed.prive), 60000)), 'installation neuve : la sauvegarde est restaurée, l’espace chiffré est là', (await dlgCalls()).filter((c) => c.kind === 'error'));
  await ready();
  ok(await st(({ dPrive, dCours }) => { const s = window.__store.getState(); return !s.drafts.some((d) => d.id === dPrive) && s.drafts.some((d) => d.id === dCours); }, seed), 'installation neuve : espace verrouillé, le reste lisible');
  const wrong = await st(({ prive }) => window.marginalia.spaces.unlock(prive, 'pas le bon'), seed);
  ok(wrong.ok === false, 'installation neuve : mauvais mot de passe refusé');
  await unlock(seed.prive);
  ok(await st(({ dPrive, book }) => { const s = window.__store.getState(); return s.drafts.find((d) => d.id === dPrive)?.title === 'Journal' || /Journal/.test(s.drafts.find((d) => d.id === dPrive)?.title ?? '') ; }, seed) && await st(({ book }) => window.__store.getState().highlights.some((h) => h.id === 'hl-secret' && /SECRET/.test(h.note)) && window.__store.getState().books.some((b) => b.id === book), seed), 'installation neuve : le mot de passe ouvre l’espace (les clés ont voyagé dans la sauvegarde), contenu complet');
  ok((await read(seed.dPrive, seed.draftFile)) > 100 && (await read(seed.book, seed.bookFile)) > 1000, 'installation neuve : fichiers de l’espace lisibles', [await read(seed.dPrive, seed.draftFile), await read(seed.book, seed.bookFile)]);
  // Clé de secours aussi, après verrouillage.
  await lock(seed.prive);
  const rk = await st(({ prive, k }) => window.marginalia.spaces.unlock(prive, k), { prive: seed.prive, k: RECOVERY });
  ok(rk.ok === true, 'installation neuve : la clé de secours ouvre aussi l’espace');
  await page.reload();
  await ready();
  const all = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) { if (!/Cache|blob_storage|Storage|Network|Crashpad|Dictionar|shared_proto|Service Worker/.test(e.name)) all(f, out); } else out.push(f); } return out; };
  const onDisk = all(UD2).filter((f) => { try { return fs.readFileSync(f).includes(Buffer.from(SECRET)); } catch { return false; } }).map((f) => path.relative(UD2, f));
  ok(onDisk.length === 0, 'installation neuve : rien de l’espace en clair sur le disque après restauration', onDisk);
  ok(errors.length === 0, 'aucune erreur de page', errors.slice(0, 3));
} catch (e) {
  ok(false, 'exception — ' + String((e && e.stack) || e).slice(0, 700));
} finally {
  await quit();
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
