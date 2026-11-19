// Espaces chiffrés, de bout en bout dans l'app (Electron) : chiffrer un espace par l'interface, puis
// vérifier sur le DISQUE et dans la MÉMOIRE de l'interface que son contenu a disparu quand il est
// verrouillé ; déverrouiller (mot de passe, clé de secours), modifier, redémarrer, retirer le chiffrement.
// Attaques : mauvais mot de passe, interface compromise qui demande l'ouverture sans mot de passe,
// capsule altérée sur le disque.
// Prérequis : npx vite build ; Xvfb. Lancer : xvfb-run -a node scripts/test-electron-spaces.mjs
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
const EPUB = fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')).toString('base64');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-spaces-'));
const UD = path.join(home, 'donnees');
const SECRET = 'SECRET-DE-LEA-7Q2';
const PASSWORD = 'correct horse battery';
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: UD, VITE_DEV_SERVER_URL: '', MARGINALIA_E2E_FAKE_SAFESTORAGE: '1', MARGINALIA_E2E_FAKE_TOUCHID: '1' },
    timeout: 120000,
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
}
const quit = async () => { await app.close().catch(() => {}); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (fn, arg) => page.evaluate(fn, arg);
/** Tous les fichiers de données de l'app, avec leur contenu. */
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
const dbOnDisk = () => JSON.parse(fs.readFileSync(path.join(UD, 'db.json'), 'utf8'));
const flush = async () => { await st(() => window.__store.getState().updateSettings({})); await wait(900); };
const menu = async (wsId, label) => {
  await page.click(`[data-ws-id="${wsId}"]`, { button: 'right' });
  await page.getByRole('menuitem', { name: label }).click();
};

/** Verrouillage : le rendu est remplacé par un processus neuf ; on attend que la nouvelle page soit prête. */
async function lockAndRenew(pg, act) {
  await pg.evaluate(() => { window.__mgOldRenderer = 1; });
  await act();
  await pg.waitForFunction(() => !window.__mgOldRenderer && window.__store && window.__store.getState().ready, null, { timeout: 60000 });
}
try {
  await launch();
  // ── Préparation : un espace « Privé » (écrit, livre annoté) et un espace « Cours » ordinaire ──
  const seed = await st(async ({ b64, secret }) => {
    const s = () => window.__store.getState();
    const cours = s().createWorkspace('Cours').id;
    s().navigate({ name: 'workspace', workspaceId: cours, groupId: null });
    await new Promise((r) => setTimeout(r, 300));
    await s().importFiles([{ name: 'Dissertation.md', data: new TextEncoder().encode('# Dissertation\n\nTexte ordinaire du cours.\n').buffer }]);
    const dCours = s().drafts[0].id;
    const prive = s().createWorkspace('Privé').id;
    s().navigate({ name: 'workspace', workspaceId: prive, groupId: null });
    await new Promise((r) => setTimeout(r, 300));
    await s().importFiles([{ name: 'Journal.md', data: new TextEncoder().encode(`# Journal intime\n\n${secret} dans le texte.\n`).buffer }]);
    const dPrive = s().drafts.find((d) => d.id !== dCours).id;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const [book] = await s().importFiles([{ name: 'Discours de la méthode.epub', data: bytes.buffer }]);
    if (!s().wsItems.some((i) => i.workspaceId === prive && i.refId === book.id)) s().addToWorkspace(prive, null, 'book', book.id);
    if (!s().wsItems.some((i) => i.workspaceId === prive && i.refId === dPrive)) s().addToWorkspace(prive, null, 'draft', dPrive);
    s().insert('highlights', { id: 'hl-secret', bookId: book.id, text: 'passage', note: `note ${secret}`, category: 'these', conceptIds: [], createdAt: Date.now(), updatedAt: Date.now(), anchor: null });
    s().createGroup(prive, null, 'Groupe ' + secret);
    return { cours, prive, dCours, dPrive, book: book.id, draftFile: s().drafts.find((d) => d.id === dPrive).fileName, bookFile: s().books.find((b) => b.id === book.id).fileName, wsOfDraft: s().wsItems.filter((i) => i.refId === dPrive).map((i) => i.workspaceId) };
  }, { b64: EPUB, secret: SECRET });
  await flush();
  ok(seed.wsOfDraft.length === 1 && seed.wsOfDraft[0] === seed.prive, 'préparation : le journal n’est rangé que dans « Privé »');
  ok(diskHas(SECRET).length > 0 && /Journal intime/.test(fs.readFileSync(path.join(UD, 'db.json'), 'utf8')), 'avant : le contenu est en clair sur le disque (espace ordinaire)', diskHas(SECRET).slice(0, 4));
  const before = await st(({ dPrive, book }) => { const s = window.__store.getState(); return JSON.stringify([s.drafts.find((d) => d.id === dPrive), s.books.find((b) => b.id === book)?.title, s.highlights.filter((h) => h.bookId === book), s.groups.filter((g) => /Groupe/.test(g.name))]); }, seed);

  // ── 1. Chiffrer « Privé » par l'interface : mot de passe commun, clé de secours ──
  await menu(seed.prive, 'Chiffrer cet espace…');
  await page.waitForSelector('[data-testid="space-encrypt-dialog"]');
  await page.fill('[data-testid="space-new-password"]', 'court');
  await page.fill('[data-testid="space-new-password2"]', 'court');
  await page.click('[data-testid="space-encrypt-go"]');
  ok(/8 caractères/.test(await page.textContent('[data-testid="space-error"]')), 'mot de passe trop court : refusé');
  await page.fill('[data-testid="space-new-password"]', PASSWORD);
  await page.fill('[data-testid="space-new-password2"]', PASSWORD);
  await page.click('[data-testid="space-encrypt-go"]');
  await page.waitForSelector('[data-testid="space-recovery"]');
  const RECOVERY = await page.getAttribute('[data-testid="space-recovery"]', 'data-key');
  ok(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/.test(RECOVERY), 'clé de secours affichée (32 caractères)');
  ok(await page.isDisabled('[data-testid="space-encrypt-go"]'), 'il faut confirmer avoir noté la clé');
  await page.check('[data-testid="space-kept"]');
  await page.click('[data-testid="space-encrypt-go"]');
  await page.waitForSelector('[data-testid="space-encrypt-dialog"]', { state: 'detached', timeout: 30000 });
  await flush();
  let db = dbOnDisk();
  ok(db.workspaces.find((w) => w.id === seed.prive)?.encrypted === true && typeof db.sealedSpaces?.[seed.prive] === 'string' && !!db.spaceKeys, 'base : espace marqué chiffré, capsule scellée, clés enveloppées');
  ok(!db.drafts.some((d) => d.id === seed.dPrive) && !db.books.some((b) => b.id === seed.book) && !db.highlights.some((h) => h.id === 'hl-secret') && !db.groups.some((g) => g.workspaceId === seed.prive) && !db.wsItems.some((i) => i.workspaceId === seed.prive), 'base commune : ni l’écrit, ni le livre, ni l’extrait, ni les groupes de l’espace');
  ok(db.drafts.some((d) => d.id === seed.dCours) && db.workspaces.some((w) => w.name === 'Privé'), 'base commune : le reste est là, et le nom de l’espace reste visible');
  const leak = diskHas(SECRET);
  ok(leak.length === 0, 'disque : plus aucune trace du contenu (base, fichiers, sauvegardes, journal)', leak);
  ok(diskHas('Journal intime').length === 0, 'disque : le titre de l’écrit non plus', diskHas('Journal intime'));
  const head = (id, f) => fs.readFileSync(path.join(UD, 'library', id, f)).subarray(0, 7).toString('latin1');
  ok(head(seed.dPrive, seed.draftFile) === 'MGLSPC2' && head(seed.book, seed.bookFile) === 'MGLSPC2', 'fichiers de l’écrit et du livre : scellés avec la clé de l’espace');
  ok(head(seed.dCours, (await st((id) => window.__store.getState().drafts.find((d) => d.id === id).fileName, seed.dCours))) !== 'MGLSPC2', 'fichier de l’écrit du cours : inchangé');
  ok((await st(({ dPrive }) => window.__store.getState().drafts.some((d) => d.id === dPrive), seed)), 'encore déverrouillé : le contenu reste utilisable');
  const readable = await st(({ dPrive, f }) => window.marginalia.readFile(dPrive, f).then((b) => b.byteLength > 100, () => false), { dPrive: seed.dPrive, f: seed.draftFile });
  ok(readable, 'déverrouillé : le fichier de l’écrit se lit');

  // ── 2. Verrouiller : plus rien en mémoire ──
  await st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), seed.prive);
  await lockAndRenew(page, () => page.click('[data-testid="space-lock"]'));
  await page.waitForSelector('[data-testid="space-locked"]', { timeout: 30000 });
  const mem = await st((secret) => JSON.stringify(window.__store.getState(), (k, v) => (typeof v === 'function' ? undefined : v)).includes(secret) || JSON.stringify(window.__store.getState().drafts).includes('Journal'), SECRET);
  ok(!mem, 'verrouillé : rien du contenu dans la mémoire de l’interface (store)');
  ok(await st(() => !window.__store.getState().unlockedSpaces.length), 'verrouillé : aucun espace ouvert');
  ok((await page.locator('[data-testid="ws-lock-icon"]').count()) === 1, 'cadenas sur l’espace dans la barre latérale');
  const refused = await st(async ({ dPrive, f, book, bf, prive }) => {
    const t = (p) => p.then(() => 'accepté', (e) => String(e.message || e));
    return {
      lireEcrit: await t(window.marginalia.readFile(dPrive, f)),
      lireLivre: await t(window.marginalia.readFile(book, bf)),
      ecrire: await t(window.marginalia.storeFile(dPrive, 'pirate.txt', new ArrayBuffer(4))),
      ouvrirSansMotDePasse: JSON.stringify(await window.marginalia.spaces.open(prive)),
      enregistrerCapsule: await t(window.marginalia.saveDbJson('{"version":2}', { version: 2, items: 0 }, { spaces: { [prive]: '{"v":1}' }, drop: [] })),
      supprimerCapsule: await t(window.marginalia.saveDbJson('{"version":2}', { version: 2, items: 0 }, { spaces: {}, drop: [prive] })),
    };
  }, { dPrive: seed.dPrive, f: seed.draftFile, book: seed.book, bf: seed.bookFile, prive: seed.prive });
  ok(/verrouill/i.test(refused.lireEcrit) && /verrouill/i.test(refused.lireLivre) && /verrouill/i.test(refused.ecrire), 'interface compromise : lecture et écriture des fichiers de l’espace refusées', refused);
  ok(/"ok":false/.test(refused.ouvrirSansMotDePasse) && /verrouill/i.test(refused.enregistrerCapsule) && /verrouill/i.test(refused.supprimerCapsule), 'interface compromise : ni ouverture sans mot de passe, ni remplacement ni suppression de la capsule');
  // La base du disque n'a pas été abîmée par ces tentatives (elles sont refusées avant toute écriture).
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  db = dbOnDisk();
  ok(typeof db.sealedSpaces?.[seed.prive] === 'string' && db.drafts.some((d) => d.id === seed.dCours), 'après les tentatives : capsule et base intactes');

  // ── 3. Déverrouiller : mauvais mot de passe, puis le bon ──
  await st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), seed.prive);
  await page.waitForSelector('[data-testid="space-locked"]');
  await page.fill('[data-testid="space-password"]', 'pas le bon');
  await page.click('[data-testid="space-unlock"]');
  await page.waitForSelector('[data-testid="space-error"]');
  ok(/incorrect/i.test(await page.textContent('[data-testid="space-error"]')), 'mauvais mot de passe : refusé');
  await page.fill('[data-testid="space-password"]', PASSWORD);
  await page.click('[data-testid="space-unlock"]');
  await page.waitForSelector('[data-testid="space-bar"]', { timeout: 30000 });
  const after = await st(({ dPrive, book }) => { const s = window.__store.getState(); return JSON.stringify([s.drafts.find((d) => d.id === dPrive), s.books.find((b) => b.id === book)?.title, s.highlights.filter((h) => h.bookId === book), s.groups.filter((g) => /Groupe/.test(g.name))]); }, seed);
  ok(after === before, 'bon mot de passe : le contenu revient à l’identique');
  // ── 4. Modifier et ajouter pendant qu'il est ouvert, verrouiller, quitter ──
  const added = await st(async ({ prive, dPrive, secret }) => {
    const s = () => window.__store.getState();
    s().patch('drafts', dPrive, { title: 'Journal modifié' });
    s().navigate({ name: 'workspace', workspaceId: prive, groupId: null });
    await new Promise((r) => setTimeout(r, 300));
    const before = new Set(s().drafts.map((d) => d.id));
    await s().importFiles([{ name: 'Lettre.md', data: new TextEncoder().encode(`# Lettre\n\n${secret} bis.\n`).buffer }]);
    const d = s().drafts.find((x) => !before.has(x.id));
    if (!s().wsItems.some((i) => i.workspaceId === prive && i.refId === d.id)) s().addToWorkspace(prive, null, 'draft', d.id);
    return { id: d.id, file: d.fileName };
  }, { prive: seed.prive, dPrive: seed.dPrive, secret: SECRET });
  await flush();
  ok(head(added.id, added.file) === 'MGLSPC2' && diskHas(SECRET).length === 0, 'écrit ajouté dans l’espace ouvert : scellé lui aussi, rien en clair', diskHas(SECRET));
  await lockAndRenew(page, () => page.click('[data-testid="space-lock"]'));
  await page.waitForSelector('[data-testid="space-locked"]', { timeout: 30000 });
  await quit();
  ok(diskHas(SECRET).length === 0 && diskHas('Journal modifié').length === 0, 'app fermée : rien en clair sur le disque', [...diskHas(SECRET), ...diskHas('Journal modifié')]);

  // ── 5. Redémarrage : verrouillé d'office ; clé de secours ──
  await launch();
  ok(await st(({ dPrive }) => !window.__store.getState().drafts.some((d) => d.id === dPrive) && window.__store.getState().workspaces.some((w) => w.name === 'Privé' && w.encrypted), seed), 'au redémarrage : espace présent, verrouillé, contenu absent');
  // Capsule altérée sur le disque : refusée proprement, puis remise en place.
  const dbFile = path.join(UD, 'db.json');
  const good = fs.readFileSync(dbFile, 'utf8');
  const j = JSON.parse(good);
  const blob = Buffer.from(j.sealedSpaces[seed.prive], 'base64');
  blob[blob.length - 20] ^= 1;
  j.sealedSpaces[seed.prive] = blob.toString('base64');
  fs.writeFileSync(dbFile, JSON.stringify(j));
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  const tampered = await st(({ prive, pw }) => window.marginalia.spaces.unlock(prive, pw), { prive: seed.prive, pw: PASSWORD });
  ok(tampered.ok === false && /illisible/.test(tampered.error), 'capsule altérée sur le disque : refusée, message clair', tampered);
  fs.writeFileSync(dbFile, good);
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), seed.prive);
  await page.waitForSelector('[data-testid="space-locked"]');
  await page.fill('[data-testid="space-password"]', RECOVERY.toLowerCase());
  await page.click('[data-testid="space-unlock"]');
  await page.waitForSelector('[data-testid="space-bar"]', { timeout: 30000 });
  ok(await st(({ dPrive, added }) => { const s = window.__store.getState(); return s.drafts.find((d) => d.id === dPrive)?.title === 'Journal modifié' && s.drafts.some((d) => d.id === added); }, { dPrive: seed.dPrive, added: added.id }), 'clé de secours : déverrouillé, modifications et nouvel écrit retrouvés');
  const text = await st(({ id, f }) => window.marginalia.readFile(id, f).then((b) => b.byteLength, () => -1), { id: added.id, f: added.file });
  ok(text > 100, 'le fichier du nouvel écrit se lit après redémarrage', text);

  // ── 6. Retirer le chiffrement ──
  await menu(seed.prive, 'Retirer le chiffrement…');
  await page.waitForSelector('[data-testid="space-decrypt-dialog"]');
  await page.fill('[data-testid="space-decrypt-dialog"] [data-testid="space-password"]', 'faux');
  await page.click('[data-testid="space-decrypt-go"]');
  await page.waitForSelector('[data-testid="space-decrypt-dialog"] [data-testid="space-error"]');
  ok(true, 'retirer le chiffrement : mauvais mot de passe refusé');
  await page.fill('[data-testid="space-decrypt-dialog"] [data-testid="space-password"]', PASSWORD);
  await page.click('[data-testid="space-decrypt-go"]');
  await page.waitForSelector('[data-testid="space-decrypt-dialog"]', { state: 'detached', timeout: 30000 });
  await flush();
  db = dbOnDisk();
  ok(!db.workspaces.find((w) => w.id === seed.prive)?.encrypted && !db.sealedSpaces?.[seed.prive] && db.drafts.some((d) => d.id === seed.dPrive && d.title === 'Journal modifié') && db.books.some((b) => b.id === seed.book) && db.highlights.some((h) => h.id === 'hl-secret'), 'chiffrement retiré : tout le contenu est revenu dans la base commune');
  ok(head(seed.dPrive, seed.draftFile) !== 'MGLSPC2' && head(seed.book, seed.bookFile) !== 'MGLSPC2' && head(added.id, added.file) !== 'MGLSPC2', 'chiffrement retiré : fichiers rendus lisibles');

  // ── 7. Rechiffrer (mot de passe déjà choisi), Touch ID ──
  await menu(seed.prive, 'Chiffrer cet espace…');
  await page.waitForSelector('[data-testid="space-encrypt-dialog"]');
  ok((await page.locator('[data-testid="space-new-password"]').count()) === 0, 'mot de passe déjà choisi : on ne le redemande pas en double');
  await page.fill('[data-testid="space-encrypt-dialog"] [data-testid="space-password"]', PASSWORD);
  await page.click('[data-testid="space-encrypt-go"]');
  await page.waitForSelector('[data-testid="space-encrypt-dialog"]', { state: 'detached', timeout: 30000 });
  await flush();
  ok(diskHas(SECRET).length === 0 && head(seed.dPrive, seed.draftFile) === 'MGLSPC2', 'rechiffré : de nouveau scellé, rien en clair', diskHas(SECRET));
  const tid = await st((pw) => window.marginalia.spaces.setTouchId(true, pw), PASSWORD);
  ok(tid.ok === true && (await st(() => window.marginalia.spaces.setTouchId(true, 'faux'))).ok === false, 'Touch ID : activé avec le mot de passe, refusé sans');
  await st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), seed.prive);
  await lockAndRenew(page, () => page.click('[data-testid="space-lock"]'));
  await page.waitForSelector('[data-testid="space-locked"]', { timeout: 30000 });
  await page.click('[data-testid="space-touchid"]');
  await page.waitForSelector('[data-testid="space-bar"]', { timeout: 30000 });
  ok(await st(({ dPrive }) => window.__store.getState().drafts.some((d) => d.id === dPrive), seed), 'Touch ID (simulé) : espace déverrouillé');

  // ── 8. Avec le chiffrement global de l'app par-dessus ──
  const pend = await st(() => window.marginalia.security.prepare());
  await st((t) => window.marginalia.security.enable(t), pend.token);
  for (let i = 0; i < 120; i++) {
    const s2 = await st(() => window.marginalia.security.status());
    if (s2.encrypted && !(s2.migration && (s2.migration.running || !s2.migration.finished))) break;
    await wait(500);
  }
  await wait(1500);
  const h8 = (f) => fs.readFileSync(f).subarray(0, 7).toString('latin1');
  ok(h8(path.join(UD, 'db.json')) === 'MGLENC1', 'chiffrement global activé : la base est chiffrée');
  ok(head(seed.dPrive, seed.draftFile) === 'MGLSPC2' && head(seed.book, seed.bookFile) === 'MGLSPC2', 'les fichiers de l’espace gardent la clé de l’espace (pas de double chiffrement)');
  const coursFile = await st((id) => window.__store.getState().drafts.find((d) => d.id === id).fileName, seed.dCours);
  ok(head(seed.dCours, coursFile) === 'MGLENC1', 'les autres fichiers passent au chiffrement global');
  ok(await st(({ dPrive, f }) => window.marginalia.readFile(dPrive, f).then((b) => b.byteLength > 100, () => false), { dPrive: seed.dPrive, f: seed.draftFile }), 'fichier de l’espace toujours lisible, espace ouvert');
  await st(({ dPrive }) => window.__store.getState().patch('drafts', dPrive, { title: 'Journal sous double protection' }), seed);
  await flush();
  await lockAndRenew(page, () => page.click('[data-testid="space-lock"]'));
  await page.waitForSelector('[data-testid="space-locked"]', { timeout: 30000 });
  await quit();
  ok(diskHas(SECRET).length === 0 && diskHas('Journal').length === 0 && diskHas('Dissertation').length === 0, 'app fermée : plus aucun texte en clair, ni de l’espace ni du reste', [...diskHas(SECRET), ...diskHas('Journal'), ...diskHas('Dissertation')]);
  await launch();
  ok(await st(({ dPrive, dCours }) => { const s = window.__store.getState(); return s.drafts.some((d) => d.id === dCours) && !s.drafts.some((d) => d.id === dPrive); }, seed), 'redémarrage : la base (chiffrée) s’ouvre par le trousseau, l’espace reste verrouillé');
  await st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), seed.prive);
  await page.waitForSelector('[data-testid="space-locked"]');
  await page.fill('[data-testid="space-password"]', PASSWORD);
  await page.click('[data-testid="space-unlock"]');
  await page.waitForSelector('[data-testid="space-bar"]', { timeout: 30000 });
  ok(await st(({ dPrive }) => window.__store.getState().drafts.find((d) => d.id === dPrive)?.title === 'Journal sous double protection', seed), 'espace déverrouillé sous chiffrement global : contenu retrouvé');
  ok(await st(({ dPrive, f }) => window.marginalia.readFile(dPrive, f).then((b) => b.byteLength > 100, () => false), { dPrive: seed.dPrive, f: seed.draftFile }), 'et son fichier se lit');
  ok(errors.length === 0, 'aucune erreur de page', errors.slice(0, 3));
} catch (e) {
  ok(false, 'exception — ' + String(e && e.stack || e).slice(0, 700));
} finally {
  await quit();
  fs.rmSync(home, { recursive: true, force: true });
}
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
