// Mise à jour automatique, de bout en bout (Release GitHub simulée par un serveur local, clé de test) :
//  1. Windows simulé : la nouvelle version est PROPOSÉE (rien ne se télécharge sans accord) ;
//     « Télécharger la mise à jour » → téléchargement en arrière-plan (bannière discrète), « prête » ;
//     « Plus tard » : rien ne s'installe à la fermeture ; relance en 3.28 : « Quoi de neuf », dossier nettoyé ;
//  2. Windows simulé : fermer sans rien choisir n'installe rien ; relance : fichier déjà vérifié
//     réutilisé ; « Redémarrer pour mettre à jour » → cmd.exe (start /wait installateur /S --updated,
//     puis Marginalia rouverte ; plus de PowerShell), l'app quitte ;
//  3. Mac simulé (hdiutil/ditto/xattr/open remplacés dans le PATH) : « Redémarrer » prépare la copie et
//     lance le script, qu'on exécute ensuite pour de vrai sur le faux .app ;
//  4. signature fausse : aucune mise à jour automatique, annonce classique (page du site) ;
//  5. fichier corrompu (empreinte) : refus, annonce classique avec explication.
// Jamais d'installation réelle : MARGINALIA_E2E_UPDATE_SPAWN_LOG remplace le lancement par un journal.
// Prérequis : dist/ construit (npx vite build). Lancer : DISPLAY=:99 timeout 400 node scripts/test-electron-autoupdate.mjs
import { _electron as electron } from 'playwright-core';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-autoupd-e2e-'));
const SHOTS = path.join(ROOT, 'shots/maj');
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0,
  fail = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (c) pass++;
  else {
    fail++;
    process.exitCode = 1;
  }
};

// ── Release simulée, signée par une clé de test ──
const kp = crypto.generateKeyPairSync('ed25519');
const PUB = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIV = kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const REL = path.join(TMP, 'release');
fs.mkdirSync(REL);
const NAMES = ['Marginalia-mac-arm64.dmg', 'Marginalia-mac-x64.dmg', 'Marginalia-win-x64-setup.exe', 'Marginalia-win-arm64-setup.exe'];
for (const n of NAMES) fs.writeFileSync(path.join(REL, n), crypto.randomBytes(2_400_000));
const s = spawnSync(process.execPath, [path.join(ROOT, 'scripts/sign-update-manifest.mjs'), REL, '3.28'], { env: { ...process.env, MARGINALIA_UPDATE_KEY: PRIV }, encoding: 'utf8' });
ok(s.status === 0, 'manifeste de test signé (script de la CI)', s.stderr);
const GOOD_SIG = fs.readFileSync(path.join(REL, 'latest.json.sig'), 'utf8');
const NOTES = '## Nouveautés\n\n- **Plusieurs photos, un seul document** : assemblez des photos en un document à lire page par page.\n- Partager avec un autre Marginalia.';

const srv = { badSig: false, corrupt: false, throttle: true, hits: [] };
const server = http.createServer((req, res) => {
  srv.hits.push({ url: req.url, range: req.headers.range || null });
  const base = `http://127.0.0.1:${server.address().port}`;
  if (req.url.startsWith('/repos/')) {
    const assets = ['latest.json', 'latest.json.sig', ...NAMES].map((name) => ({ name, browser_download_url: `${base}/dl/${name}` }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ tag_name: 'v3.28', draft: false, prerelease: false, body: NOTES, published_at: '2026-10-20T10:00:00Z', assets }));
  }
  const name = decodeURIComponent(req.url.replace(/^\/dl\//, ''));
  if (name === 'latest.json.sig' && srv.badSig) {
    const b = Buffer.from(GOOD_SIG, 'base64');
    b[0] ^= 0xff;
    res.writeHead(200);
    return res.end(b.toString('base64'));
  }
  const f = path.join(REL, name);
  if (!fs.existsSync(f)) {
    res.writeHead(404);
    return res.end();
  }
  let buf = fs.readFileSync(f);
  if (srv.corrupt && name.endsWith('.exe')) {
    buf = Buffer.from(buf);
    buf[1000] ^= 0xff;
  }
  const m = /^bytes=(\d+)-$/.exec(req.headers.range || '');
  const start = m ? Number(m[1]) : 0;
  const body = buf.subarray(start);
  res.writeHead(start ? 206 : 200, { 'Content-Length': body.length, ...(start ? { 'Content-Range': `bytes ${start}-${buf.length - 1}/${buf.length}` } : {}) });
  if (!srv.throttle || name.startsWith('latest')) return res.end(body);
  // ~3 s pour 2,4 Mo : de quoi voir la progression.
  let i = 0;
  const t = setInterval(() => {
    if (res.destroyed) return clearInterval(t);
    if (i >= body.length) {
      clearInterval(t);
      return res.end();
    }
    res.write(body.subarray(i, i + 64 * 1024));
    i += 64 * 1024;
  }, 80);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const UPDATE_URL = `http://127.0.0.1:${server.address().port}/repos/FavveyAxel/marginalia/releases/latest`;

// Faux Windows installé (désinstalleur présent à côté de l'exécutable).
const WIN_DIR = path.join(TMP, 'win', 'Marginalia');
fs.mkdirSync(WIN_DIR, { recursive: true });
fs.writeFileSync(path.join(WIN_DIR, 'Marginalia.exe'), '');
fs.writeFileSync(path.join(WIN_DIR, 'Uninstall Marginalia.exe'), '');

async function launch(home, version, extra = {}) {
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    VITE_DEV_SERVER_URL: '',
    MARGINALIA_E2E: '1',
    MARGINALIA_E2E_USER_DATA: path.join(home, 'userData'),
    MARGINALIA_UPDATE_URL: UPDATE_URL,
    MARGINALIA_APP_VERSION: version,
    MARGINALIA_E2E_UPDATE_PUBKEY: PUB,
    MARGINALIA_E2E_UPDATE_SPAWN_LOG: path.join(home, 'spawn.log'),
    ...extra,
  };
  const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  return { app, page };
}
const WIN_ENV = { MARGINALIA_E2E_UPDATE_PLATFORM: 'win32', MARGINALIA_E2E_UPDATE_ARCH: 'x64', MARGINALIA_E2E_UPDATE_EXE: path.join(WIN_DIR, 'Marginalia.exe') };
const spawnLog = (home) => (fs.existsSync(path.join(home, 'spawn.log')) ? fs.readFileSync(path.join(home, 'spawn.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const theme = (page, t) => page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), t);
const exited = (app) => new Promise((r) => app.process().once('exit', r));
const settingsShot = async (page, file) => {
  await page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await page.waitForSelector('#set-updates');
  await page.locator('#set-updates').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('#set-updates')?.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, file) });
};

try {
  // ── 1. Windows, « Oui » ──
  const H1 = path.join(TMP, 'h1');
  fs.mkdirSync(H1);
  let { app, page } = await launch(H1, '3.27', WIN_ENV);
  await theme(page, 'light');
  await page.waitForSelector('[data-testid="update-banner"]', { timeout: 20000 });
  const offer = await page.locator('[data-testid="update-banner"]').innerText();
  ok(/Marginalia 3\.28 est disponible/.test(offer) && /Télécharger la mise à jour/.test(offer), 'nouvelle version proposée : « Télécharger la mise à jour »', offer.replace(/\n/g, ' | '));
  await page.waitForTimeout(1500);
  ok(!srv.hits.some((h) => h.url.endsWith('.exe')), 'rien n’est téléchargé sans accord', srv.hits.map((h) => h.url));
  await page.screenshot({ path: path.join(SHOTS, '09-proposition-clair.png') });
  await page.click('[data-testid="update-download"]');
  await page.waitForSelector('[data-testid="update-progress"]', { timeout: 20000 });
  await page.waitForFunction(() => {
    const t = document.querySelector('[data-testid="update-progress"] .up-mini-pct')?.textContent || '';
    const n = parseInt(t, 10);
    return n >= 25 && n <= 85;
  }, null, { timeout: 15000 });
  const progText = await page.locator('[data-testid="update-progress"]').innerText();
  ok(/Mise à jour 3\.28/.test(progText) && /\d+ %/.test(progText), 'téléchargement en arrière-plan : bannière discrète avec pourcentage', progText.replace(/\n/g, ' | '));
  ok((await page.locator('[data-testid="update-progress"] [role="progressbar"]').getAttribute('aria-valuenow')) !== null, 'barre de progression accessible');
  await page.screenshot({ path: path.join(SHOTS, '10-telechargement-clair.png') });
  await theme(page, 'dark');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, '11-telechargement-sombre.png') });
  await theme(page, 'light');
  ok(!(await page.$('[data-testid="update-banner"]')), 'pendant le téléchargement : plus d’annonce, la progression');
  await page.waitForSelector('[data-testid="update-ready"]', { timeout: 20000 });
  const readyText = await page.locator('[data-testid="update-ready"]').innerText();
  ok(readyText.includes('Marginalia 3.28 est prête') && readyText.includes('Redémarrer pour mettre à jour') && readyText.includes('Plus tard'), '« Marginalia 3.28 est prête » : Redémarrer / Plus tard', readyText.replace(/\n/g, ' | '));
  ok(readyText.includes('Plusieurs photos, un seul document'), 'premier point du récap affiché');
  const dlFile = path.join(H1, 'userData', 'updates', '3.28', 'Marginalia-win-x64-setup.exe');
  ok(fs.existsSync(dlFile) && fs.statSync(dlFile).size === 2_400_000 && !fs.existsSync(dlFile + '.part'), 'fichier téléchargé dans userData/updates/3.28');
  ok(!srv.hits.some((h) => /mac|arm64/.test(h.url)), 'seul le fichier de ce système est téléchargé', srv.hits.map((h) => h.url));
  await page.screenshot({ path: path.join(SHOTS, '12-prete-clair.png') });
  await theme(page, 'dark');
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, '13-prete-sombre.png') });
  await theme(page, 'light');

  // Réglages
  await settingsShot(page, '14-reglages-clair.png');
  const row = page.locator('[data-testid="set-auto-install"]');
  ok((await row.innerText()).includes('vous choisissez de la télécharger, puis quand redémarrer'), 'réglage : « vous choisissez de la télécharger, puis quand redémarrer »', await row.innerText());
  ok((await row.locator('button[role="radio"]').count()) === 0, 'pas de choix « installer à la fermeture »');
  ok((await page.locator('#set-updates').locator('..').innerText()).includes('La version 3.28 est téléchargée et vérifiée'), 'réglages : état de la mise à jour');
  await theme(page, 'dark');
  await page.waitForTimeout(250);
  await settingsShot(page, '15-reglages-sombre.png');
  await theme(page, 'light');
  await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
  await page.waitForSelector('[data-testid="update-ready"]');
  await page.click('[data-testid="update-ready"] button:has-text("Plus tard")');
  await page.waitForSelector('[data-testid="update-ready"]', { state: 'detached' });
  ok(true, '« Plus tard » : bannière fermée');
  ok((await page.locator('body').innerText()).includes('redémarrez quand vous voulez'), '« Plus tard » : la mise à jour attend un redémarrage choisi');
  await app.close();
  let log = spawnLog(H1);
  ok(log.length === 0, 'Windows, fermeture : rien n’est installé (on redémarre quand on veut)', log);
  ok(fs.existsSync(dlFile), 'la mise à jour reste téléchargée pour plus tard');

  // Lancement suivant : la 3.28 tourne.
  ({ app, page } = await launch(H1, '3.28', WIN_ENV));
  await page.waitForSelector('[data-testid="whats-new"]', { timeout: 15000 });
  ok((await page.locator('[data-testid="whats-new"]').innerText()).includes('Marginalia 3.28'), 'après la mise à jour : « Quoi de neuf » de la 3.28');
  await page.waitForTimeout(1500);
  ok(!fs.existsSync(path.join(H1, 'userData', 'updates', '3.28')) && !fs.existsSync(path.join(H1, 'userData', 'updates', 'installing.json')), 'après la mise à jour : fichiers téléchargés supprimés');
  await page.click('[data-testid="whats-new"] button:has-text("Continuer")');
  await page.waitForTimeout(5500);
  ok(!(await page.$('[data-testid="update-progress"]')) && !(await page.$('[data-testid="update-ready"]')), 'à jour : plus rien à télécharger');
  await app.close();
  ok(spawnLog(H1).length === 0, 'à jour : rien d’installé à la fermeture');

  // ── 2. Windows, « Me demander » ──
  const H2 = path.join(TMP, 'h2');
  fs.mkdirSync(H2);
  srv.hits.length = 0;
  ({ app, page } = await launch(H2, '3.27', WIN_ENV));
  await page.waitForSelector('[data-testid="update-download"]', { timeout: 20000 });
  await page.click('[data-testid="update-download"]');
  await page.waitForSelector('[data-testid="update-ready"]', { timeout: 30000 });
  ok(true, 'téléchargée après accord, puis « Redémarrer » proposé');
  await page.waitForTimeout(300);
  await app.close();
  ok(spawnLog(H2).length === 0, 'fermeture sans choix : rien n’est installé');
  srv.hits.length = 0;
  ({ app, page } = await launch(H2, '3.27', WIN_ENV));
  await page.waitForSelector('[data-testid="update-download"]', { timeout: 20000 });
  await page.click('[data-testid="update-download"]');
  await page.waitForSelector('[data-testid="update-ready"]', { timeout: 20000 });
  ok(!srv.hits.some((h) => h.url.endsWith('.exe')), 'relance : fichier déjà vérifié réutilisé (pas de nouveau téléchargement)', srv.hits.map((h) => h.url));
  const gone = exited(app);
  await page.click('[data-testid="update-ready"] button:has-text("Redémarrer pour mettre à jour")');
  const code = await Promise.race([gone.then(() => 'quit'), new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
  ok(code === 'quit', '« Redémarrer pour mettre à jour » : l’app quitte d’elle-même');
  log = spawnLog(H2);
  {
    const line = (log[0] && log[0].args[3]) || '';
    ok(log.length === 1 && /cmd\.exe$/i.test(log[0].cmd) && log[0].args.slice(0, 3).join(' ') === '/d /s /c' && /^"start "" \/wait ".*Marginalia-win-x64-setup\.exe" \/S --updated & ping -n 2 127\.0\.0\.1 >nul & start "" ".*Marginalia\.exe" --updated"$/.test(line) && !/powershell/i.test(JSON.stringify(log)) && log[0].relaunch === true, 'Redémarrer : invite de commandes cachée (pas de PowerShell) : installateur attendu, puis Marginalia rouverte', line || log);
  }
  await app.close().catch(() => {});

  // ── 3. Mac simulé ──
  const H3 = path.join(TMP, 'h3');
  const STUBS = path.join(TMP, 'stubs');
  const TOOL_LOG = path.join(TMP, 'tools.log');
  fs.mkdirSync(H3);
  fs.mkdirSync(STUBS);
  const stub = (name, body) => fs.writeFileSync(path.join(STUBS, name), `#!/bin/sh\necho "${name} $*" >> '${TOOL_LOG}'\n${body}\n`, { mode: 0o755 });
  stub('hdiutil', 'if [ "$1" = attach ]; then while [ $# -gt 0 ]; do if [ "$1" = -mountpoint ]; then shift; MP="$1"; fi; shift; done; cp -R "$FAKE_DMG_DIR"/. "$MP"/; fi\nexit 0');
  stub('ditto', 'cp -R "$1" "$2"');
  stub('xattr', 'exit 0');
  stub('open', 'exit 0');
  const plist = (ver) => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.axelbierne.marginalia</string><key>CFBundleShortVersionString</key><string>${ver}</string></dict></plist>\n`;
  const makeApp = (dir, ver, marker) => {
    fs.mkdirSync(path.join(dir, 'Contents', 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Contents', 'Info.plist'), plist(ver));
    fs.writeFileSync(path.join(dir, 'Contents', 'MacOS', 'Marginalia'), marker);
  };
  const MAC_APP = path.join(TMP, 'Applications', 'Marginalia.app');
  makeApp(MAC_APP, '3.27.0', 'ancienne');
  makeApp(path.join(TMP, 'dmg', 'Marginalia.app'), '3.28.0', 'nouvelle');
  const MAC_ENV = {
    MARGINALIA_E2E_UPDATE_PLATFORM: 'darwin',
    MARGINALIA_E2E_UPDATE_ARCH: 'arm64',
    MARGINALIA_E2E_UPDATE_APP_PATH: MAC_APP,
    PATH: `${STUBS}:${process.env.PATH}`,
    FAKE_DMG_DIR: path.join(TMP, 'dmg'),
  };
  srv.hits.length = 0;
  ({ app, page } = await launch(H3, '3.27', MAC_ENV));
  await page.waitForSelector('[data-testid="update-download"]', { timeout: 20000 });
  await page.click('[data-testid="update-download"]');
  await page.waitForSelector('[data-testid="update-ready"]', { timeout: 30000 });
  ok(srv.hits.some((h) => h.url.endsWith('Marginalia-mac-arm64.dmg')) && !srv.hits.some((h) => h.url.endsWith('.exe') || h.url.includes('mac-x64')), 'Mac arm64 : le .dmg arm64 est téléchargé');
  const gone3 = exited(app);
  await page.click('[data-testid="update-ready"] button:has-text("Redémarrer pour mettre à jour")');
  await Promise.race([gone3, new Promise((r) => setTimeout(r, 20000))]);
  log = spawnLog(H3);
  ok(log.length === 1 && log[0].cmd === '/bin/sh' && log[0].args.length === 1 && log[0].args[0].endsWith('install-mac.sh') && log[0].relaunch === true, 'Mac : script de remplacement lancé (sh détaché)', log.map((l) => ({ cmd: l.cmd, args: l.args })));
  const tools = fs.readFileSync(TOOL_LOG, 'utf8');
  ok(/hdiutil attach -nobrowse -readonly/.test(tools) && /ditto .*Marginalia\.app .*\.Marginalia-maj-3\.28\.app/.test(tools), 'Mac : .dmg monté en lecture seule, app copiée à côté', tools.trim().split('\n'));
  ok(log[0].script.includes(`APP='${MAC_APP}'`) && log[0].script.includes('open "$APP"'), 'Mac : script avec le chemin de l’app et la relance');
  // Exécution réelle du script (le processus attendu est terminé).
  const run = spawnSync('/bin/sh', [log[0].args[0]], { env: { ...process.env, PATH: `${STUBS}:${process.env.PATH}` } });
  ok(run.status === 0 && fs.readFileSync(path.join(MAC_APP, 'Contents/MacOS/Marginalia'), 'utf8') === 'nouvelle', 'Mac : le script remplace réellement l’app');
  ok(/^open .*Marginalia\.app$/m.test(fs.readFileSync(TOOL_LOG, 'utf8')) && fs.readFileSync(path.join(H3, 'userData/updates/install-result.txt'), 'utf8').trim() === 'ok', 'Mac : relance et résultat « ok »');
  await app.close().catch(() => {});

  // ── 4. Signature fausse ──
  const H4 = path.join(TMP, 'h4');
  fs.mkdirSync(H4);
  srv.badSig = true;
  srv.hits.length = 0;
  ({ app, page } = await launch(H4, '3.27', WIN_ENV));
  await page.waitForSelector('[data-testid="update-banner"]', { timeout: 20000 });
  ok(!(await page.$('[data-testid="update-progress"]')) && !srv.hits.some((h) => h.url.endsWith('.exe')), 'signature fausse : rien n’est téléchargé', srv.hits.map((h) => h.url));
  ok((await page.locator('[data-testid="update-banner"] a.btn-primary').getAttribute('href')) === 'https://marginalia-bice.vercel.app/#telecharger', 'signature fausse : annonce classique (page du site)');
  await page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await page.waitForSelector('#set-updates');
  await page.click('button:has-text("Rechercher maintenant")');
  await page.waitForSelector('button:has-text("Voir la version 3.28")');
  ok(true, 'signature fausse : « Rechercher maintenant » propose la page, pas d’installation');
  await app.close();
  ok(spawnLog(H4).length === 0, 'signature fausse : rien installé à la fermeture');
  srv.badSig = false;

  // ── 5. Fichier corrompu ──
  const H5 = path.join(TMP, 'h5');
  fs.mkdirSync(H5);
  srv.corrupt = true;
  srv.throttle = false;
  ({ app, page } = await launch(H5, '3.27', WIN_ENV));
  await page.waitForSelector('[data-testid="update-download"]', { timeout: 20000 });
  await page.click('[data-testid="update-download"]');
  await page.waitForFunction(() => /Empreinte/.test(document.querySelector('[data-testid="update-banner"]')?.textContent || ''), null, { timeout: 30000 });
  const fb = await page.locator('[data-testid="update-banner"]').innerText();
  ok(/Empreinte du fichier de mise à jour incorrecte/.test(fb) && /depuis le site/.test(fb), 'empreinte fausse : refus expliqué, repli sur la page', fb.replace(/\n/g, ' | '));
  ok(!fs.existsSync(path.join(H5, 'userData/updates/3.28/Marginalia-win-x64-setup.exe')), 'empreinte fausse : aucun fichier prêt');
  await page.screenshot({ path: path.join(SHOTS, '16-echec-clair.png') });
  await app.close();
  ok(spawnLog(H5).length === 0, 'empreinte fausse : rien installé à la fermeture');
  srv.corrupt = false;

  // ── 6. Linux (pas de simulation) : la raison s'affiche dans les réglages ──
  const H6 = path.join(TMP, 'h6');
  fs.mkdirSync(H6);
  ({ app, page } = await launch(H6, '3.28', {}));
  await page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await page.waitForSelector('[data-testid="set-auto-install"]');
  await page.waitForTimeout(300);
  ok((await page.locator('[data-testid="set-auto-install"]').innerText()).includes('proposée sur Mac et Windows'), 'Linux : raison affichée (pas de mise à jour automatique)');
  await app.close();
} finally {
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\n${pass} réussis, ${fail} échoués`);
