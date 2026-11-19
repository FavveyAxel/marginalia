// Espaces chiffrés : attaques et pièges trouvés par une relecture indépendante (Electron, de bout en bout).
// Chaque cas a d'abord été reproduit sur la 3.59 ; il doit maintenant échouer.
//  A. Deux espaces chiffrés ouverts : un écrit rangé dans les deux, un écrit déplacé de l'un à l'autre,
//     un écrit supprimé — rien de perdu, rien en clair sur le disque.
//  B. Interface compromise : essais de mot de passe en rafale, suppression d'un fichier d'un espace
//     verrouillé, Touch ID retiré sans mot de passe, base invalide, capsule qui réclame un écrit commun.
//  C. Disque modifié, app fermée : clés retirées, capsule retirée, fichier scellé remplacé par un fichier
//     en clair, liste des fichiers de l'espace vidée, marque « chiffré » retirée.
// Prérequis : npx vite build ; Xvfb. Lancer : xvfb-run -a node scripts/test-electron-spaces-attacks.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PASSWORD = 'correct horse battery';
function mk(name) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `mg-spatk-${name}-`));
  const UD = path.join(home, 'donnees');
  const h = { home, UD, app: null, page: null, errors: [] };
  h.launch = async (env = {}) => {
    h.app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT],
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: UD, VITE_DEV_SERVER_URL: '', MARGINALIA_E2E_FAKE_SAFESTORAGE: '1', MARGINALIA_E2E_FAKE_TOUCHID: '1', ...env }, timeout: 120000 });
    h.page = await h.app.firstWindow();
    await h.page.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
    h.page.on('pageerror', (e) => h.errors.push(String(e)));
    await h.page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 120000 });
    await h.page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
  };
  h.quit = async () => { await h.app.close().catch(() => {}); };
  h.st = (fn, arg) => h.page.evaluate(fn, arg);
  h.wait = (ms) => new Promise((r) => setTimeout(r, ms));
  h.flush = async () => { await h.st(() => window.__store.getState().updateSettings({})); await h.wait(1200); };
  const allFiles = (dir = UD, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) { if (!/^(Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|blob_storage|Session Storage|Local Storage|shared_proto_db|Network|Dictionaries|Shared Dictionary|WebStorage|Crashpad|Service Worker|VideoDecodeStats)$/.test(e.name)) allFiles(f, out); } else out.push(f); } return out; };
  h.diskHas = (needle) => allFiles().filter((f) => { try { return fs.readFileSync(f).includes(Buffer.from(needle)); } catch { return false; } }).map((f) => path.relative(UD, f));
  h.db = () => JSON.parse(fs.readFileSync(path.join(UD, 'db.json'), 'utf8'));
  h.menu = async (wsId, label) => { await h.page.click(`[data-ws-id="${wsId}"]`, { button: 'right' }); await h.page.getByRole('menuitem', { name: label }).click(); };
  h.nav = async (wsId) => { await h.st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), wsId); await h.wait(300); };
  h.encryptFirst = async (wsId) => {
    await h.menu(wsId, 'Chiffrer cet espace…'); await h.page.waitForSelector('[data-testid="space-encrypt-dialog"]');
    await h.page.fill('[data-testid="space-new-password"]', PASSWORD); await h.page.fill('[data-testid="space-new-password2"]', PASSWORD);
    await h.page.click('[data-testid="space-encrypt-go"]'); await h.page.waitForSelector('[data-testid="space-recovery"]');
    const rec = await h.page.getAttribute('[data-testid="space-recovery"]', 'data-key');
    await h.page.check('[data-testid="space-kept"]'); await h.page.click('[data-testid="space-encrypt-go"]');
    await h.page.waitForSelector('[data-testid="space-encrypt-dialog"]', { state: 'detached', timeout: 30000 }); await h.flush(); return rec;
  };
  h.encryptNext = async (wsId) => {
    await h.menu(wsId, 'Chiffrer cet espace…'); await h.page.waitForSelector('[data-testid="space-encrypt-dialog"]');
    if (await h.page.locator('[data-testid="space-password"]').count()) await h.page.fill('[data-testid="space-password"]', PASSWORD);
    await h.page.click('[data-testid="space-encrypt-go"]');
    await h.page.waitForSelector('[data-testid="space-encrypt-dialog"]', { state: 'detached', timeout: 30000 }); await h.flush();
  };
  h.lock = async (wsId) => { await h.nav(wsId); await h.page.click('[data-testid="space-lock"]'); await h.page.waitForSelector('[data-testid="space-locked"]', { timeout: 30000 }); await h.wait(300); };
  h.unlock = async (wsId, pw = PASSWORD) => { await h.nav(wsId); await h.page.waitForSelector('[data-testid="space-locked"]'); await h.page.fill('[data-testid="space-password"]', pw); await h.page.click('[data-testid="space-unlock"]'); await h.page.waitForSelector('[data-testid="space-bar"]', { timeout: 30000 }); await h.wait(300); };
  h.head = (id, f) => { try { return fs.readFileSync(path.join(UD, 'library', id, f)).subarray(0, 7).toString('latin1'); } catch (e) { return 'ERR ' + e.code; } };
  return h;
}

const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
  return c;
};
const homes = [];
const mkh = (n) => { const h = mk(n); homes.push(h); return h; };
const seedTwo = (h) =>
  h.st(async () => {
    const s = () => window.__store.getState();
    const w1 = s().createWorkspace('Un').id;
    const w2 = s().createWorkspace('Deux').id;
    const plain = s().createWorkspace('Cours').id;
    const [lo, hi] = [w1, w2].sort();
    const imp = async (ws, name, body) => {
      s().navigate({ name: 'workspace', workspaceId: ws, groupId: null });
      await new Promise((r) => setTimeout(r, 300));
      const before = new Set(s().drafts.map((d) => d.id));
      await s().importFiles([{ name, data: new TextEncoder().encode(body).buffer }]);
      const d = s().drafts.find((x) => !before.has(x.id));
      if (!s().wsItems.some((i) => i.workspaceId === ws && i.refId === d.id)) s().addToWorkspace(ws, null, 'draft', d.id);
      return d.id;
    };
    const shared = await imp(lo, 'Shared.md', '# TITRE-SHARED-ZZ1\n\nCONTENU-SHARED-ZZ1\n');
    s().addToWorkspace(hi, null, 'draft', shared);
    const move = await imp(hi, 'Move.md', '# TITRE-MOVE-ZZ2\n\nCONTENU-MOVE-ZZ2\n');
    const del = await imp(lo, 'Del.md', '# TITRE-DEL-ZZ3\n\nCONTENU-DEL-ZZ3\n');
    const only = await imp(hi, 'Only.md', '# TITRE-ONLY-ZZ4\n\nCONTENU-ONLY-ZZ4\n');
    const common = await imp(plain, 'Commun.md', '# Dissertation commune\n\nTexte du cours.\n');
    const fn = (id) => s().drafts.find((d) => d.id === id).fileName;
    return { lo, hi, plain, shared, move, del, only, common, fShared: fn(shared), fMove: fn(move), fDel: fn(del), fOnly: fn(only), fCommon: fn(common) };
  });
const has = (h, id) => h.st((i) => window.__store.getState().drafts.some((d) => d.id === i), id);
const sealed = (x) => x === 'MGLSPC1' || x === 'MGLSPC2';

try {
  // ══ A. Deux espaces chiffrés ══
  let h = mkh('a');
  await h.launch();
  let seed = await seedTwo(h);
  await h.flush();
  await h.encryptFirst(seed.lo);
  await h.encryptNext(seed.hi);
  ok(['ZZ1', 'ZZ2', 'ZZ3', 'ZZ4'].every((m) => h.diskHas(m).length === 0), 'deux espaces chiffrés : rien en clair sur le disque');
  // Suppression d'un écrit de l'espace : ni corbeille ni journal dans la base commune.
  await h.st((id) => window.__store.getState().trashDelete('draft', id), seed.del);
  await h.flush();
  let db = h.db();
  ok(h.diskHas('ZZ3').length === 0 && !JSON.stringify(db.trash).includes('ZZ3') && !JSON.stringify(db.activity).includes('ZZ3'), 'écrit supprimé dans l’espace : ni sa corbeille ni son journal ne partent en clair', h.diskHas('ZZ3'));
  // Déplacement de hi vers lo.
  await h.st(({ lo, hi, move }) => { const s = window.__store.getState(); const it = s.wsItems.find((i) => i.workspaceId === hi && i.refId === move); s.addToWorkspace(lo, null, 'draft', move); window.__store.getState().removeFromWorkspace(it.id); }, seed);
  await h.flush();
  db = h.db();
  ok(db.spaceOwners[seed.move] === seed.lo && sealed(h.head(seed.move, seed.fMove)) && h.diskHas('ZZ2').length === 0, 'écrit déplacé d’un espace chiffré à l’autre : rescellé pour le nouvel espace, jamais en clair', [db.spaceOwners[seed.move] === seed.lo, h.head(seed.move, seed.fMove), h.diskHas('ZZ2')]);
  ok((await h.st(({ id, f }) => window.marginalia.readFile(id, f).then((b) => b.byteLength, (e) => String(e.message)), { id: seed.move, f: seed.fMove })) > 100, 'et il se lit toujours');
  // Verrouiller hi (le second) pendant que lo reste ouvert : l'écrit rangé dans les deux ne disparaît pas.
  await h.lock(seed.hi);
  await h.st((lo) => window.__store.getState().createGroup(lo, null, 'g'), seed.lo);
  await h.flush();
  ok(await has(h, seed.shared), 'verrouiller le second espace : l’écrit rangé dans les deux reste dans le premier');
  ok(sealed(h.head(seed.shared, seed.fShared)) && h.diskHas('ZZ1').length === 0, 'son fichier reste scellé', [h.head(seed.shared, seed.fShared), h.diskHas('ZZ1')]);
  await h.lock(seed.lo);
  ok(['ZZ1', 'ZZ2', 'ZZ3', 'ZZ4'].every((m) => h.diskHas(m).length === 0), 'tout verrouillé : rien en clair', ['ZZ1', 'ZZ2', 'ZZ3', 'ZZ4'].map((m) => h.diskHas(m)));
  await h.quit();
  await h.launch();
  await h.unlock(seed.lo);
  await h.unlock(seed.hi);
  ok((await has(h, seed.shared)) && (await has(h, seed.move)) && (await has(h, seed.only)), 'après redémarrage et réouverture : les trois écrits sont là');
  ok((await h.st((id) => window.__store.getState().trash.some((t) => t.refId === id), seed.del)), 'et l’écrit supprimé est bien dans la corbeille de l’espace');

  // ══ B. Interface compromise (lo ouvert, hi verrouillé) ══
  await h.lock(seed.hi);
  const delLocked = await h.st(({ id, f }) => window.marginalia.deleteFile(id, f).then(() => 'supprimé', (e) => String(e.message)), { id: seed.only, f: seed.fOnly });
  ok(/verrouill/i.test(delLocked) && sealed(h.head(seed.only, seed.fOnly)), 'supprimer un fichier d’un espace verrouillé : refusé', delLocked);
  const bad = await h.st(() => window.marginalia.saveDbJson('{"junk":{"k":1}', { version: 2, items: 0 }).then(() => 'écrit', (e) => String(e.message)));
  ok(/invalide/i.test(bad) && !!h.db().sealedSpaces, 'base invalide envoyée par l’interface : refusée, base du disque intacte', bad);
  await h.st((pw) => window.marginalia.spaces.setTouchId(true, pw), PASSWORD);
  await h.lock(seed.lo);
  const tOff = await h.st(() => window.marginalia.spaces.setTouchId(false));
  ok(tOff.ok === false, 'Touch ID retiré sans mot de passe, tout verrouillé : refusé', tOff);
  for (let i = 0; i < 4; i++) await h.st(() => window.marginalia.spaces.verify('faux'));
  const t0 = Date.now();
  const burst = await h.st(() => Promise.all([...Array(24)].map(() => window.marginalia.spaces.verify('faux'))));
  const dt = Date.now() - t0;
  const st1 = await h.st(() => window.marginalia.spaces.status());
  ok(burst.every((r) => r.ok === false) && st1.waitMs > 0, `24 essais de mot de passe lancés ensemble : au plus 2 évalués, les autres refusés (${Math.round(dt / 100) / 10} s, attente imposée ensuite ${Math.round(st1.waitMs / 1000)} s)`);
  await h.quit();

  // ══ C. Disque modifié, app fermée ══
  const dbFile = path.join(h.UD, 'db.json');
  const good = fs.readFileSync(dbFile, 'utf8');
  const edit = (fn) => { const j = JSON.parse(good); fn(j); fs.writeFileSync(dbFile, JSON.stringify(j)); for (const f of [dbFile + '.bak']) fs.rmSync(f, { force: true }); };
  // C1. Clés retirées : pas de nouveau mot de passe par-dessus.
  edit((j) => { delete j.spaceKeys; });
  await h.launch();
  const stLost = await h.st(() => window.marginalia.spaces.status());
  const setupLost = await h.st(() => window.marginalia.spaces.setup('nouveau mot de passe'));
  ok(stLost.keysLost === true && setupLost.ok === false && /introuvables/.test(setupLost.error), 'clés retirées de la base : créer un nouveau mot de passe est refusé', setupLost);
  await h.menu(seed.plain, 'Chiffrer cet espace…');
  ok((await h.page.locator('[data-testid="space-keys-lost"]').count()) === 1, 'l’interface l’explique et renvoie vers la restauration');
  await h.quit();
  // C2. Capsule retirée : pas d'espace « vide » ouvert en silence.
  edit((j) => { delete j.sealedSpaces[seed.hi]; });
  await h.launch();
  const noBlob = await h.st(({ hi, pw }) => window.marginalia.spaces.unlock(hi, pw), { hi: seed.hi, pw: PASSWORD });
  ok(noBlob.ok === false && /absent/.test(noBlob.error), 'capsule retirée : déverrouillage refusé avec un message clair', noBlob);
  await h.quit();
  // C3. Marque « chiffré » retirée : remise au chargement.
  edit((j) => { for (const w of j.workspaces) delete w.encrypted; });
  await h.launch();
  await h.wait(800);
  ok(await h.st(({ lo, hi }) => window.__store.getState().workspaces.filter((w) => w.id === lo || w.id === hi).every((w) => w.encrypted), seed), 'marque « chiffré » retirée de la base : remise d’office (l’espace ne passe pas pour un espace vide)');
  await h.quit();
  // C4. Fichier scellé remplacé par un fichier en clair.
  fs.writeFileSync(dbFile, good);
  const target = path.join(h.UD, 'library', seed.only, seed.fOnly);
  const sealedBytes = fs.readFileSync(target);
  fs.writeFileSync(target, 'CONTENU-ATTAQUANT');
  await h.launch();
  await h.unlock(seed.hi);
  const forged = await h.st(({ id, f }) => window.marginalia.readFile(id, f).then((b) => new TextDecoder().decode(b), (e) => 'refus: ' + String(e.message)), { id: seed.only, f: seed.fOnly });
  ok(/^refus/.test(forged) && fs.readFileSync(target, 'utf8') === 'CONTENU-ATTAQUANT', 'fichier scellé remplacé par un fichier en clair : lecture refusée, et il n’est pas scellé comme authentique', forged.slice(0, 120));
  // C5. Fichier scellé d'un autre écrit du même espace mis à sa place.
  await h.lock(seed.hi);
  await h.quit();
  fs.writeFileSync(target, sealedBytes);
  await h.launch();
  await h.unlock(seed.hi);
  const fresh = await h.st(async (hi) => { const s = () => window.__store.getState(); s().navigate({ name: 'workspace', workspaceId: hi, groupId: null }); await new Promise((r) => setTimeout(r, 300)); const before = new Set(s().drafts.map((d) => d.id)); await s().importFiles([{ name: 'Autre.md', data: new TextEncoder().encode('# AUTRE-ZZ9\n\nautre\n').buffer }]); const d = s().drafts.find((x) => !before.has(x.id)); if (!s().wsItems.some((i) => i.workspaceId === hi && i.refId === d.id)) s().addToWorkspace(hi, null, 'draft', d.id); return { id: d.id, f: d.fileName }; }, seed.hi);
  await h.flush();
  ok(h.head(fresh.id, fresh.f) === 'MGLSPC2', 'nouveau fichier de l’espace : scellé avec son emplacement (MGLSPC2)', h.head(fresh.id, fresh.f));
  await h.lock(seed.hi);
  await h.quit();
  fs.copyFileSync(path.join(h.UD, 'library', fresh.id, fresh.f), path.join(h.UD, 'library', fresh.id, fresh.f + '.sauve'));
  const other = fs.readFileSync(path.join(h.UD, 'library', fresh.id, fresh.f));
  // Un second fichier du même espace, scellé pour un AUTRE emplacement, mis à la place du premier.
  await h.launch();
  await h.unlock(seed.hi);
  const second = await h.st(async ({ id }) => { await window.marginalia.storeFile(id, 'second.bin', new TextEncoder().encode('SECOND-FICHIER').buffer); return true; }, fresh);
  await h.lock(seed.hi);
  await h.quit();
  fs.copyFileSync(path.join(h.UD, 'library', fresh.id, 'second.bin'), path.join(h.UD, 'library', fresh.id, fresh.f));
  await h.launch();
  await h.unlock(seed.hi);
  const swapped = await h.st(({ id, f }) => window.marginalia.readFile(id, f).then((b) => new TextDecoder().decode(b), (e) => 'refus: ' + String(e.message)), fresh);
  ok(second && /^refus/.test(swapped), 'fichier scellé d’un autre emplacement mis à sa place : refusé', swapped.slice(0, 100));
  fs.writeFileSync(path.join(h.UD, 'library', fresh.id, fresh.f), other);
  // C6. Liste des fichiers de l'espace vidée : refaite d'après la capsule, rien n'est écrit en clair.
  await h.lock(seed.hi);
  await h.quit();
  const j6 = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  j6.spaceOwners = {};
  fs.writeFileSync(dbFile, JSON.stringify(j6));
  fs.rmSync(dbFile + '.bak', { force: true });
  await h.launch();
  await h.unlock(seed.hi);
  await h.st(({ id }) => window.marginalia.storeFile(id, 'derive.txt', new TextEncoder().encode('DERIVE-SECRET-ZZ8').buffer), { id: seed.only });
  await h.flush();
  ok(h.db().spaceOwners[seed.only] === seed.hi && sealed(h.head(seed.only, 'derive.txt')) && h.diskHas('DERIVE-SECRET-ZZ8').length === 0, 'liste des fichiers de l’espace vidée dans la base : refaite au déverrouillage, l’écriture reste scellée', [h.db().spaceOwners[seed.only] === seed.hi, h.head(seed.only, 'derive.txt')]);
  // C7. Capsule qui réclame un écrit commun (interface compromise, espace ouvert).
  const claim = await h.st(async ({ hi, common }) => {
    const s = window.__store.getState();
    const cap = { v: 1, wsId: hi, books: [], highlights: [], concepts: [], maps: {}, arguments: [], studies: [], plans: [], drafts: [{ id: common, title: 'volé' }], cards: [], groups: [], wsItems: [], bookmarks: [], trash: [], activity: [], mapVersions: [] };
    const db = { version: 2, books: s.books, highlights: [], concepts: [], maps: {}, arguments: [], studies: [], plans: [], drafts: s.drafts.filter((d) => d.id === common), cards: [], workspaces: s.workspaces, groups: [], wsItems: [], bookmarks: [], settings: s.settings, trash: [], activity: [], mapVersions: [] };
    return window.marginalia.saveDbJson(JSON.stringify(db), { version: 2, items: 1 }, { spaces: { [hi]: JSON.stringify(cap) }, drop: [] }).then(() => 'accepté', (e) => String(e.message));
  }, seed);
  ok(!sealed(h.head(seed.common, seed.fCommon)) && h.db().spaceOwners[seed.common] === undefined, 'capsule forgée réclamant un écrit commun : son fichier n’est ni pris ni scellé', [claim, h.head(seed.common, seed.fCommon)]);
  ok(h.errors.length === 0, 'aucune erreur de page', h.errors.slice(0, 3));
} catch (e) {
  ok(false, 'exception — ' + String((e && e.stack) || e).slice(0, 800));
} finally {
  for (const h of homes) {
    await h.quit();
    fs.rmSync(h.home, { recursive: true, force: true });
  }
}
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
