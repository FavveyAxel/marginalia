// Espaces chiffrés : que reste-t-il dans la MÉMOIRE RÉELLE des processus de l'app après le verrouillage ?
// Le test ouvre un espace chiffré (mot de passe tapé au clavier), affiche son écrit, le verrouille, puis
// lit la mémoire de tous les processus de l'app (/proc/<pid>/mem) et y cherche le texte secret, le mot de
// passe, la clé de secours, la clé maîtresse et la clé de l'espace.
// Témoin : espace ouvert, le texte DOIT être trouvé (sinon la méthode ne prouve rien).
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
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
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
            (hits[label] ||= []).push(name || 'anonyme');
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
  let bytes = 0;
  const detail = [];
  for (const pid of pids) {
    const r = scan(pid, needles);
    bytes += r.bytes;
    for (const [k, v] of Object.entries(r.hits)) {
      if (!v.length) continue;
      total[k] = (total[k] || 0) + v.length;
      const where = {};
      for (const w of v) where[w] = (where[w] || 0) + 1;
      detail.push(`${k} × ${v.length} dans ${kindOf(pid)} (${pid}) ${JSON.stringify(where)}`);
    }
  }
  console.log(`\n── ${label} : ${pids.length} processus, ${(bytes / 1048576).toFixed(0)} Mo lus ──`);
  for (const d of detail) console.log('   ' + d);
  if (!detail.length) console.log('   (aucune trace)');
  return total;
}
const both = (label, s) => [[label + ' (texte)', Buffer.from(s, 'latin1')], [label + ' (UTF-16)', Buffer.from(s, 'utf16le')]];
const sum = (t, prefix) => Object.entries(t).filter(([k]) => k.startsWith(prefix)).reduce((a, [, n]) => a + n, 0);

try {
  // ── Session 1 (non mesurée) : préparer un espace chiffré, verrouillé, puis quitter ──
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
  const RECOVERY = await page.getAttribute('[data-testid="space-recovery"]', 'data-key');
  await page.check('[data-testid="space-kept"]');
  await page.click('[data-testid="space-encrypt-go"]');
  await page.waitForSelector('[data-testid="space-encrypt-dialog"]', { state: 'detached', timeout: 30000 });
  await flush();
  await quit();

  const db = JSON.parse(fs.readFileSync(path.join(UD, 'db.json'), 'utf8'));
  const SK = await spacesKit.unlock(db.spaceKeys, PASSWORD);
  ok(!!SK, 'préparation : espace chiffré, clé maîtresse retrouvée hors de l’app pour la chercher en mémoire');
  const needles = [
    ...both('texte secret', SECRET),
    ...both('mot de passe', PASSWORD),
    ...both('clé de secours', RECOVERY),
    ['clé maîtresse (brute)', Buffer.from(SK)],
    ...both('clé maîtresse hex', SK.toString('hex')),
    ...both('clé maîtresse base64', SK.toString('base64')),
    ['clé de l’espace (brute)', spacesKit.spaceKey(SK, seed.prive)],
  ];

  // ── Session 2 (mesurée) : rien de secret ne passe par l'outil de test (mot de passe tapé touche à touche) ──
  await launch();
  const t0 = dump('Témoin 0 : app lancée, espace jamais ouvert', needles);
  ok(Object.keys(t0).length === 0, 'app lancée, espace verrouillé : aucune trace en mémoire', t0);

  await st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), seed.prive);
  await page.waitForSelector('[data-testid="space-locked"]');
  await page.click('[data-testid="space-password"]');
  await page.keyboard.type(PASSWORD, { delay: 15 });
  await page.click('[data-testid="space-unlock"]');
  await page.waitForSelector('[data-testid="space-bar"]', { timeout: 30000 });
  await st((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), seed.draft);
  await page.getByText('dans le texte').first().waitFor({ timeout: 30000 });
  await wait(1500);
  const t1 = dump('Témoin 1 : espace ouvert, écrit affiché', needles);
  ok(sum(t1, 'texte secret') > 0, 'témoin : espace ouvert, le texte est bien trouvé en mémoire (la méthode voit ce qu’elle cherche)');
  ok(sum(t1, 'clé maîtresse (brute)') > 0, 'témoin : espace ouvert, la clé maîtresse est bien trouvée en mémoire');
  const pwOpen = sum(t1, 'mot de passe');
  console.log(pwOpen ? `   ⚠ mot de passe encore en mémoire pendant que l’espace est ouvert : ${pwOpen} copie(s)` : '   mot de passe : déjà absent pendant que l’espace est ouvert');

  // ── Verrouiller l'espace ──
  await st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), seed.prive);
  await page.click('[data-testid="space-lock"]');
  await page.waitForSelector('[data-testid="space-locked"]', { timeout: 30000 });
  await wait(2500);
  const t2 = dump('Mesure : espace verrouillé depuis 2,5 s', needles);
  await wait(20000);
  const t3 = dump('Mesure : espace verrouillé depuis 25 s', needles);

  ok(sum(t3, 'clé maîtresse') === 0, 'verrouillé : plus de clé maîtresse en mémoire', t3);
  ok(sum(t3, 'clé de l’espace') === 0, 'verrouillé : plus de clé de l’espace en mémoire', t3);
  ok(sum(t3, 'mot de passe') === 0, 'verrouillé : plus de mot de passe en mémoire', t3);
  ok(sum(t3, 'clé de secours') === 0, 'verrouillé : pas de clé de secours en mémoire', t3);
  ok(sum(t2, 'texte secret') === 0, 'verrouillé (2,5 s) : plus de texte de l’espace en mémoire', t2);
  ok(sum(t3, 'texte secret') === 0, 'verrouillé (25 s) : plus de texte de l’espace en mémoire', t3);
  ok(await st(() => !window.__store.getState().unlockedSpaces.length), 'l’app fonctionne toujours, espace verrouillé');
} catch (e) {
  console.log('ÉCHEC exception — ' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await quit();
  fs.rmSync(home, { recursive: true, force: true });
}
