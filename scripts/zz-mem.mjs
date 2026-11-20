// Espaces chiffrés : que reste-t-il dans la MÉMOIRE RÉELLE des processus de l'app après le verrouillage ?
// Le test ouvre un espace chiffré (mot de passe tapé au clavier), affiche son écrit, le verrouille, puis
// lit la mémoire de tous les processus de l'app (/proc/<pid>/mem) et y cherche le texte secret, le mot de
// passe, la clé de secours, la clé maîtresse et la clé de l'espace. Même mesure après un déverrouillage
// par la clé de secours, puis après le verrouillage de l'app entière (mot de passe de l'app et clé de
// données cherchés aussi). Le processus du rendu doit avoir changé à chaque verrouillage, et le mot de
// passe ne doit jamais entrer dans le processus principal, même espace ouvert.
// Témoin : espace ouvert, le texte DOIT être trouvé (sinon la méthode ne prouve rien).
// Discipline : dans la session mesurée, aucun secret ne passe par l'outil de test (les messages de
// Playwright traversent le processus principal) : saisies tapées touche à touche, attentes qui ne
// renvoient qu'un booléen (jamais un sélecteur dont la description citerait le texte).
// Linux seulement (lecture de /proc), en root ou avec ptrace autorisé.
// Prérequis : npx vite build ; Xvfb. Lancer : xvfb-run -a node scripts/test-electron-spaces-memory.mjs
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const spacesKit = require(path.join(ROOT, 'electron/spaces.cjs'));
const vault = require(path.join(ROOT, 'electron/vault.cjs'));
const REPORT_ONLY = process.argv.includes('--report');
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c && !REPORT_ONLY) process.exitCode = 1;
  return c;
};
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-spaces-mem-'));
const UD = path.join(home, 'donnees');
// Marqueurs longs et uniques : aucune chance de les trouver par hasard dans la mémoire.
const SECRET = 'SECRET-MEMOIRE-LEA-7Q2-ZXKW';
const PASSWORD = 'mdp memoire zq81 kvh7 w3';
const APP_PASSWORD = 'app verrou 5tq9 hh2m pz';
let app, page;
async function launch() {
  app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: UD, VITE_DEV_SERVER_URL: '', MARGINALIA_E2E_FAKE_SAFESTORAGE: '1', MARGINALIA_E2E_FAKE_TOUCHID: '1' },
    timeout: 120000,
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
}
async function ready() {
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 120000 });
}
const quit = async () => { await app.close().catch(() => {}); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (fn, arg) => page.evaluate(fn, arg);
const flush = async () => { await st(() => window.__store.getState().updateSettings({})); await wait(900); };

// ── Lecture de la mémoire des processus ──
function tree(rootPid) {
  const kids = new Map();
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(Number(d));
    } catch { /* processus disparu */ }
  }
  const out = [];
  const walk = (p) => { out.push(p); for (const k of kids.get(p) || []) walk(k); };
  walk(rootPid);
  return out;
}
const kindOf = (pid) => {
  try {
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'latin1').split(/[\0 ]/);
    const t = cmd.find((a) => a.startsWith('--type='));
    const u = cmd.find((a) => a.startsWith('--utility-sub-type='));
    return t ? t.slice(7) + (u ? ':' + u.slice(19).split('.').pop() : '') : 'principal';
  } catch { return '?'; }
};
/** Cherche chaque motif dans la mémoire lisible et modifiable (ou anonyme) du processus. */
function scan(pid, needles) {
  const hits = {};
  let bytes = 0;
  let maps;
  try { maps = fs.readFileSync(`/proc/${pid}/maps`, 'utf8'); } catch { return { hits, bytes }; }
  let fd;
  try { fd = fs.openSync(`/proc/${pid}/mem`, 'r'); } catch { return { hits, bytes, denied: true }; }
  const CHUNK = 8 << 20;
  const OVER = 256;
  const buf = Buffer.allocUnsafe(CHUNK + OVER);
  try {
    for (const line of maps.split('\n')) {
      const m = /^([0-9a-f]+)-([0-9a-f]+) (\S+) \S+ \S+ \S+\s*(.*)$/.exec(line);
      if (!m || m[3][0] !== 'r') continue;
      const name = m[4];
      if (name === '[vvar]' || name === '[vsyscall]' || name === '[vdso]') continue;
      // Fichiers du programme en lecture seule : aucune donnée de l'utilisateur.
      if (m[3][1] !== 'w' && name.startsWith('/') && !name.startsWith('/dev/shm') && !name.startsWith('/memfd')) continue;
      let pos = BigInt('0x' + m[1]);
      const end = BigInt('0x' + m[2]);
      let carry = 0;
      while (pos < end) {
        const want = Number(end - pos > BigInt(CHUNK) ? BigInt(CHUNK) : end - pos);
        let got;
        try { got = fs.readSync(fd, buf, carry, want, pos); } catch { break; }
        if (!got) break;
        bytes += got;
        const view = buf.subarray(0, carry + got);
        for (const [label, n] of needles) {
          let i = view.indexOf(n);
          while (i !== -1) {
            (hits[label] ||= []).push(name || 'anonyme'); if (process.env.MEMDBG && pid === app.process().pid) { const at = i; console.log('   [main hit]', label, line, 'off', (pos - BigInt(carry) + BigInt(at)).toString(16), JSON.stringify(view.subarray(Math.max(0, at - 96), at + n.length + 48).toString('latin1').replace(/[^\x20-\x7e]/g, '.'))); }
            i = view.indexOf(n, i + n.length);
          }
        }
        // Chevauchement : un motif à cheval sur deux blocs (il est compté une seule fois, côté suivant).
        carry = Math.min(OVER, view.length);
        buf.copy(buf, 0, view.length - carry, view.length);
        // Ne pas recompter un motif entièrement dans le chevauchement.
        for (const [label, n] of needles) {
          let i = buf.subarray(0, carry).indexOf(n);
          while (i !== -1) { hits[label].pop(); i = buf.subarray(0, carry).indexOf(n, i + n.length); }
        }
        pos += BigInt(got);
      }
    }
  } finally { fs.closeSync(fd); }
  return { hits, bytes };
}
function dump(label, needles) {
  const pids = tree(app.process().pid);
  const total = {};
  const main = {};
  let bytes = 0;
  const detail = [];
  for (const pid of pids) {
    const r = scan(pid, needles);
    bytes += r.bytes;
    for (const [k, v] of Object.entries(r.hits)) {
      if (!v.length) continue;
      total[k] = (total[k] || 0) + v.length;
      if (pid === app.process().pid) main[k] = (main[k] || 0) + v.length;
      const where = {};
      for (const w of v) where[w] = (where[w] || 0) + 1;
      detail.push(`${k} × ${v.length} dans ${kindOf(pid)} (${pid}) ${JSON.stringify(where)}`);
    }
  }
  console.log(`\n── ${label} : ${pids.length} processus, ${(bytes / 1048576).toFixed(0)} Mo lus ──`);
  for (const d of detail) console.log('   ' + d);
  if (!detail.length) console.log('   (aucune trace)');
  Object.defineProperty(total, 'main', { value: main, enumerable: false });
  return total;
}
/** Processus du rendu de la fenêtre (identifiant système), lu par le processus principal. */
const rendererPid = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()).webContents.getOSProcessId());
const alive = (pid) => {
  try {
    return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2] !== 'Z';
  } catch {
    return false;
  }
};
/** Le rendu est remplacé par un processus neuf au verrouillage : on attend la nouvelle page. */
async function renewed(act, until) {
  await page.evaluate(() => { window.__mgOldRenderer = 1; });
  await act();
  await page.waitForFunction(until, null, { timeout: 60000 });
}
const typeInto = async (sel, text) => {
  await page.click(sel);
  await page.keyboard.type(text, { delay: 15 });
};
/** Écrit de l'espace affiché ; l'attente ne renvoie qu'un booléen. */
async function showDraft(draftId) {
  await st((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), draftId);
  await page.waitForFunction(() => document.body.innerText.includes('dans le texte'), null, { timeout: 30000 });
  await wait(1500);
}
async function unlockSpace(wsId, secret) {
  await st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), wsId);
  await page.waitForSelector('[data-testid="space-locked"]');
  await typeInto('[data-testid="space-password"]', secret);
  await page.click('[data-testid="space-unlock"]');
  await page.waitForSelector('[data-testid="space-bar"]', { timeout: 30000 });
}
async function unlockApp() {
  await page.waitForSelector('#lock-password', { timeout: 60000 });
  await typeInto('#lock-password', APP_PASSWORD);
  await page.keyboard.press('Enter');
  await ready();
}
const both = (label, s) => [[label + ' (texte)', Buffer.from(s, 'latin1')], [label + ' (UTF-16)', Buffer.from(s, 'utf16le')]];
const sum = (t, prefix) => Object.entries(t).filter(([k]) => k.startsWith(prefix)).reduce((a, [, n]) => a + n, 0);

try {
  // ── Session 1 (non mesurée) : espace chiffré et verrouillage de l'app, puis quitter ──
  await launch();
  await ready();
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
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
  const RECOVERY = await page.getAttribute('[data-testid="space-recovery"]', 'data-key');
  await page.check('[data-testid="space-kept"]');
  await page.click('[data-testid="space-encrypt-go"]');
  await page.waitForSelector('[data-testid="space-encrypt-dialog"]', { state: 'detached', timeout: 30000 });
  await flush();
  // Verrouillage de l'app (chiffrement des données + mot de passe), conversion attendue.
  const enabled = await st(async (pw) => {
    const sec = window.marginalia.security;
    const p = await sec.prepare();
    const r = await sec.enable(p.token, { password: pw, touchId: false, autoLockMinutes: 0, lockOnSleep: false });
    for (let i = 0; i < 300; i++) {
      const s = await sec.status();
      if (s.encrypted && !s.migration?.running && (!s.migration || s.migration.finished)) return r.ok && s.lock;
      await new Promise((res) => setTimeout(res, 200));
    }
    return false;
  }, APP_PASSWORD);
  await flush();
  await quit();
  ok(enabled, 'préparation : verrouillage de l’app activé (mot de passe), données chiffrées');

  const db = JSON.parse(fs.readFileSync(path.join(UD, 'db.json'), 'utf8').startsWith('{') ? fs.readFileSync(path.join(UD, 'db.json'), 'utf8') : '{}');
  const ks = JSON.parse(fs.readFileSync(path.join(UD, 'keystore.json'), 'utf8'));
  const DEK = await vault.unwrapWithPassword(APP_PASSWORD, ks.password);
  // La base est chiffrée par la clé de données : les clés des espaces sont lues dedans.
  const dbPlain = db.spaceKeys ? db : JSON.parse(vault.open(DEK, fs.readFileSync(path.join(UD, 'db.json'))).toString('utf8'));
  const SK = await spacesKit.unlock(dbPlain.spaceKeys, PASSWORD);
  ok(!!SK && !!DEK, 'préparation : clé maîtresse des espaces et clé de données retrouvées hors de l’app pour les chercher en mémoire');
  const needles = [
    ...both('texte secret', SECRET),
    ...both('mot de passe', PASSWORD),
    ...both('clé de secours', RECOVERY),
    ...both('mot de passe de l’app', APP_PASSWORD),
    ['clé maîtresse (brute)', Buffer.from(SK)],
    ...both('clé maîtresse hex', SK.toString('hex')),
    ...both('clé maîtresse base64', SK.toString('base64')),
    ['clé de l’espace (brute)', spacesKit.spaceKey(SK, seed.prive)],
    ['clé de données (brute)', Buffer.from(DEK)],
    ...both('clé de données base64', DEK.toString('base64')),
  ];
  const SPACE = ['texte secret', 'mot de passe (', 'clé de secours', 'clé maîtresse', 'clé de l’espace', 'mot de passe de l’app'];
  const nothingOf = (t, prefixes) => prefixes.every((p) => sum(t, p) === 0);

  // ── Session 2 (mesurée) : rien de secret ne passe par l'outil de test ──
  await launch();
  await page.waitForSelector('#lock-password', { timeout: 60000 });
  const t0 = dump('Témoin 0 : app lancée, verrouillée', needles);
  ok(Object.keys(t0).length === 0, 'app lancée, verrouillée : aucune trace en mémoire', t0);
  await unlockApp();
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));

  await unlockSpace(seed.prive, PASSWORD);
  await showDraft(seed.draft);
  const t1 = dump('Témoin 1 : app et espace ouverts, écrit affiché', needles);
  ok(sum(t1, 'texte secret') > 0, 'témoin : espace ouvert, le texte est bien trouvé en mémoire (la méthode voit ce qu’elle cherche)');
  ok(sum(t1, 'clé maîtresse (brute)') > 0, 'témoin : espace ouvert, la clé maîtresse est bien trouvée en mémoire');
  ok(sum(t1, 'clé de données (brute)') > 0, 'témoin : app ouverte, la clé de données est bien trouvée en mémoire');
  ok(sum(t1.main, 'mot de passe (') === 0 && sum(t1.main, 'mot de passe de l’app') === 0, 'espace ouvert : aucun mot de passe dans le processus principal (ni celui des espaces, ni celui de l’app)', t1.main);
  ok(sum(t1.main, 'texte secret') === 0 && sum(t1.main, 'clé maîtresse') === 0 && sum(t1.main, 'clé de l’espace') === 0, 'espace ouvert : ni contenu, ni clé maîtresse dans le processus principal', t1.main);

  if (process.env.MEMDBG) { const smaps = fs.readFileSync(`/proc/${app.process().pid}/smaps`, 'utf8'); fs.writeFileSync('/tmp/claude-0/smaps.txt', smaps); throw new Error('stop'); }
  // ── Verrouiller l'espace ──
  const pid1 = await rendererPid();
  await st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), seed.prive);
  await renewed(() => page.click('[data-testid="space-lock"]'), () => !window.__mgOldRenderer && window.__store && window.__store.getState().ready && !!document.querySelector('[data-testid="space-locked"]'));
  const pid2 = await rendererPid();
  ok(pid2 !== pid1 && !alive(pid1), 'verrouillage de l’espace : le rendu est un processus neuf, l’ancien s’est terminé', { avant: pid1, après: pid2, ancienVivant: alive(pid1) });
  await wait(2500);
  const t2 = dump('Mesure : espace verrouillé depuis 2,5 s', needles);
  await wait(20000);
  const t3 = dump('Mesure : espace verrouillé depuis 25 s', needles);

  ok(sum(t3, 'clé maîtresse') === 0, 'verrouillé : plus de clé maîtresse en mémoire', t3);
  ok(sum(t3, 'clé de l’espace') === 0, 'verrouillé : plus de clé de l’espace en mémoire', t3);
  ok(sum(t2, 'mot de passe (') === 0 && sum(t3, 'mot de passe (') === 0, 'verrouillé : plus de mot de passe en mémoire', t2);
  ok(sum(t3, 'clé de secours') === 0, 'verrouillé : pas de clé de secours en mémoire', t3);
  ok(sum(t2, 'mot de passe de l’app') === 0, 'verrouillé : plus de mot de passe de l’app en mémoire non plus (rendu remplacé)', t2);
  ok(sum(t2, 'texte secret') === 0, 'verrouillé (2,5 s) : plus de texte de l’espace en mémoire', t2);
  ok(sum(t3, 'texte secret') === 0, 'verrouillé (25 s) : plus de texte de l’espace en mémoire', t3);
  ok(await st(() => !window.__store.getState().unlockedSpaces.length), 'l’app fonctionne toujours, espace verrouillé');

  // ── Clé de secours ──
  await unlockSpace(seed.prive, RECOVERY);
  await showDraft(seed.draft);
  const t4 = dump('Témoin 2 : espace ouvert par la clé de secours, écrit affiché', needles);
  ok(sum(t4, 'texte secret') > 0, 'témoin : ouvert par la clé de secours, le texte est bien trouvé en mémoire');
  ok(sum(t4.main, 'clé de secours') === 0 && sum(t4.main, 'texte secret') === 0, 'ouvert par la clé de secours : ni la clé ni le contenu dans le processus principal', t4.main);
  const pid3 = await rendererPid();
  await st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), seed.prive);
  await renewed(() => page.click('[data-testid="space-lock"]'), () => !window.__mgOldRenderer && window.__store && window.__store.getState().ready && !!document.querySelector('[data-testid="space-locked"]'));
  const pid4 = await rendererPid();
  ok(pid4 !== pid3 && !alive(pid3), 'verrouillage (clé de secours) : rendu neuf, l’ancien s’est terminé', { avant: pid3, après: pid4 });
  await wait(2500);
  const t5 = dump('Mesure : verrouillé après la clé de secours, depuis 2,5 s', needles);
  ok(nothingOf(t5, SPACE), 'verrouillé après la clé de secours : ni clé de secours, ni mot de passe, ni clé, ni contenu en mémoire', t5);

  // ── Verrouillage de l'app entière, espace ouvert ──
  await unlockSpace(seed.prive, PASSWORD);
  await showDraft(seed.draft);
  const pid5 = await rendererPid();
  await renewed(() => page.evaluate(() => window.marginalia.security.lockNow()), () => !window.__mgOldRenderer && !!document.querySelector('#lock-password'));
  const pid6 = await rendererPid();
  ok(pid6 !== pid5 && !alive(pid5), 'verrouillage de l’app : rendu neuf, l’ancien s’est terminé', { avant: pid5, après: pid6 });
  await wait(2500);
  const t6 = dump('Mesure : app verrouillée depuis 2,5 s (espace ouvert au moment du verrouillage)', needles);
  ok(nothingOf(t6, SPACE), 'app verrouillée : ni mot de passe (espaces, app), ni clé de secours, ni clé, ni contenu en mémoire', t6);
  ok(sum(t6, 'clé de données') === 0, 'app verrouillée : plus de clé de données en mémoire', t6);

  // L'app se rouvre normalement ; l'espace est verrouillé.
  await unlockApp();
  ok(await st((id) => !window.__store.getState().unlockedSpaces.length && window.__store.getState().workspaces.some((w) => w.id === id && w.encrypted), seed.prive), 'après le verrouillage de l’app : rouverte, espace verrouillé');
} catch (e) {
  console.log('ÉCHEC exception — ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await quit();
  fs.rmSync(home, { recursive: true, force: true });
}
