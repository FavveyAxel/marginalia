// Mise à jour automatique (electron/updater.cjs), sans Electron ni réseau externe :
//  - manifeste signé (scripts/sign-update-manifest.mjs, comme la CI) : signature valide acceptée ;
//    signature fausse / autre clé / manifeste modifié / sans signature, version inférieure ou égale → refus ;
//  - choix du fichier selon le système et le processeur ;
//  - téléchargement depuis un serveur HTTP local : progression, reprise après coupure ou annulation
//    (en-tête Range), serveur sans reprise, redirection, adresse refusée, empreinte ou taille fausses → refus ;
//  - Windows : version installée / portable, arguments de l'installateur ;
//  - Mac : emplacement (translocation, image disque, dossier non modifiable), script de remplacement
//    (contenu, chemins échappés), puis scénario réel sur un faux « .app » avec hdiutil/ditto/xattr/open
//    simulés dans le PATH : remplacement réussi, et échec sans dommage.
// Lancer : node scripts/test-autoupdate.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const U = require(path.join(ROOT, 'electron/updater.cjs'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-autoupdate-'));
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
const rejects = async (p, code, m) => {
  try {
    await p;
    ok(false, m, 'aucune erreur');
  } catch (e) {
    ok(!code || e.code === code || e.name === code, m, `${e.code || e.name} : ${e.message}`);
  }
};

// ── Clés de test (jamais la vraie clé) ──
const kp = crypto.generateKeyPairSync('ed25519');
const PUB = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIV = kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const other = crypto.generateKeyPairSync('ed25519');
const OTHER_PRIV = other.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

// ── Faux fichiers de la Release ──
const REL = path.join(TMP, 'release');
fs.mkdirSync(REL);
const NAMES = ['Marginalia-mac-arm64.dmg', 'Marginalia-mac-x64.dmg', 'Marginalia-win-x64-setup.exe', 'Marginalia-win-arm64-setup.exe'];
for (const [i, n] of NAMES.entries()) fs.writeFileSync(path.join(REL, n), crypto.randomBytes(400_000 + i * 1000));
fs.writeFileSync(path.join(REL, 'Marginalia-3.28.0-win-x64-portable.exe'), crypto.randomBytes(1000));

// ── 1. Manifeste signé par le script de la CI ──
const sign = (dir, version, key, extra = []) =>
  spawnSync(process.execPath, [path.join(ROOT, 'scripts/sign-update-manifest.mjs'), dir, version, ...extra], { env: { ...process.env, MARGINALIA_UPDATE_KEY: key }, encoding: 'utf8' });
let r = sign(REL, 'v3.28', PRIV);
ok(r.status === 0 && fs.existsSync(path.join(REL, 'latest.json')) && fs.existsSync(path.join(REL, 'latest.json.sig')), 'CI : latest.json et latest.json.sig écrits', r.stderr);
ok(!r.stdout.includes('PRIVATE') && !r.stdout.includes(PRIV.split('\n')[1]), 'CI : la clé privée n’apparaît pas dans la sortie');
const MANIFEST = fs.readFileSync(path.join(REL, 'latest.json'));
const SIG = fs.readFileSync(path.join(REL, 'latest.json.sig'), 'utf8');
const man = JSON.parse(MANIFEST);
ok(man.version === '3.28' && Object.keys(man.files).sort().join() === 'mac-arm64,mac-x64,win-arm64,win-x64', 'manifeste : version et 4 fichiers', Object.keys(man.files));
ok(man.files['win-x64'].size === fs.statSync(path.join(REL, 'Marginalia-win-x64-setup.exe')).size, 'manifeste : taille exacte');
const noKeyDir = fs.mkdtempSync(path.join(TMP, 'nokey-'));
r = sign(noKeyDir, '3.28', '');
ok(r.status === 0 && !fs.existsSync(path.join(noKeyDir, 'latest.json')) && r.stdout.includes('::warning::'), 'CI sans secret : pas de manifeste, simple avertissement');
for (const n of NAMES) fs.copyFileSync(path.join(REL, n), path.join(noKeyDir, n));
r = sign(noKeyDir, '3.28', OTHER_PRIV, ['--pubkey', path.join(ROOT, 'electron/update-key.cjs')]);
ok(r.status === 0 && !fs.existsSync(path.join(noKeyDir, 'latest.json')), 'CI : clé qui ne correspond pas à celle de l’app → pas de manifeste');
const realPub = require(path.join(ROOT, 'electron/update-key.cjs'));
ok(crypto.createPublicKey(realPub).asymmetricKeyType === 'ed25519', 'clé publique embarquée : Ed25519 lisible');

// ── 2. Vérification du manifeste ──
let v = U.verifyManifest(MANIFEST, SIG, PUB, { current: '3.27', expectedVersion: '3.28' });
ok(v.ok && v.manifest.version === '3.28', 'signature valide acceptée');
v = U.verifyManifest(MANIFEST, SIG, PUB, { current: '3.27.0', expectedVersion: 'v3.28.0' });
ok(v.ok, 'versions à trois nombres et préfixe v');
v = U.verifyManifest(MANIFEST, SIG, realPub, { current: '3.27' });
ok(!v.ok && v.code === 'signature', 'signée par une autre clé que celle de l’app → refus', v.reason);
const badSig = Buffer.from(SIG, 'base64');
badSig[5] ^= 1;
v = U.verifyManifest(MANIFEST, badSig.toString('base64'), PUB, { current: '3.27' });
ok(!v.ok && v.code === 'signature', 'signature modifiée → refus');
const tampered = Buffer.from(MANIFEST.toString().replace(man.files['mac-arm64'].sha256, 'a'.repeat(64)));
v = U.verifyManifest(tampered, SIG, PUB, { current: '3.27' });
ok(!v.ok && v.code === 'signature', 'manifeste modifié (empreinte changée) → refus');
v = U.verifyManifest(MANIFEST, '', PUB, { current: '3.27' });
ok(!v.ok && v.code === 'signature' && /non signé/.test(v.reason), 'manifeste sans signature → refus', v.reason);
v = U.verifyManifest(MANIFEST, null, PUB, { current: '3.27' });
ok(!v.ok && v.code === 'signature', 'signature absente (null) → refus');
v = U.verifyManifest(MANIFEST, '%%%pas du base64%%%', PUB, { current: '3.27' });
ok(!v.ok && v.code === 'signature', 'signature illisible → refus');
v = U.verifyManifest(MANIFEST, SIG, PUB, { current: '3.28' });
ok(!v.ok && v.code === 'version', 'version égale → refus (pas de réinstallation)', v.reason);
v = U.verifyManifest(MANIFEST, SIG, PUB, { current: '3.29' });
ok(!v.ok && v.code === 'version', 'version inférieure → refus (pas de retour en arrière)', v.reason);
v = U.verifyManifest(MANIFEST, SIG, PUB, { current: '3.27', expectedVersion: '3.29' });
ok(!v.ok && v.code === 'version', 'manifeste d’une autre version que la Release → refus');
// Manifestes signés mais malformés.
const signRaw = (obj) => {
  const b = Buffer.from(JSON.stringify(obj));
  return [b, crypto.sign(null, b, kp.privateKey).toString('base64')];
};
let [mb, sb] = signRaw({ version: '3.28', files: { 'mac-arm64': { name: '../../evil.dmg', sha256: 'a'.repeat(64), size: 10 } } });
ok(!U.verifyManifest(mb, sb, PUB, { current: '3.27' }).ok, 'nom de fichier avec chemin → refus');
[mb, sb] = signRaw({ version: '3.28', files: { 'mac-arm64': { name: 'a.dmg', sha256: 'a'.repeat(64), size: U.MAX_UPDATE_SIZE + 1 } } });
ok(U.verifyManifest(mb, sb, PUB, { current: '3.27' }).code === 'taille', 'taille au-delà de la limite → refus');
[mb, sb] = signRaw({ version: '3.28', files: { 'mac-arm64': { name: 'a.dmg', sha256: 'xyz', size: 10 } } });
ok(!U.verifyManifest(mb, sb, PUB, { current: '3.27' }).ok, 'empreinte malformée → refus');
[mb, sb] = signRaw({ version: 'latest', files: {} });
ok(!U.verifyManifest(mb, sb, PUB, { current: '3.27' }).ok, 'version malformée → refus');

// ── 3. Choix du fichier ──
const cases = [
  ['darwin', 'arm64', false, 'mac-arm64', 'Marginalia-mac-arm64.dmg'],
  ['darwin', 'x64', false, 'mac-x64', 'Marginalia-mac-x64.dmg'],
  ['darwin', 'x64', true, 'mac-arm64', 'Marginalia-mac-arm64.dmg'], // app Intel sous Rosetta
  ['win32', 'x64', false, 'win-x64', 'Marginalia-win-x64-setup.exe'],
  ['win32', 'arm64', false, 'win-arm64', 'Marginalia-win-arm64-setup.exe'],
  ['win32', 'x64', true, 'win-arm64', 'Marginalia-win-arm64-setup.exe'], // émulation x64 sur ARM
  ['win32', 'ia32', false, null, null],
  ['linux', 'x64', false, null, null],
  ['darwin', 'ppc', false, null, null],
];
for (const [p, a, t, key, name] of cases) {
  const k = U.platformKey(p, a, t);
  const f = U.selectFile(v.ok ? v.manifest : U.verifyManifest(MANIFEST, SIG, PUB, { current: '3.27' }).manifest, k);
  ok(k === key && (f ? f.name : null) === name, `fichier pour ${p}/${a}${t ? ' (traduit)' : ''} : ${name ?? 'aucun'}`);
}
const portable = { version: '3.28', files: { 'win-x64': { name: 'Marginalia-3.28-win-x64-portable.exe', sha256: 'a'.repeat(64), size: 1 }, 'mac-arm64': { name: 'Marginalia.zip', sha256: 'a'.repeat(64), size: 1 } } };
ok(U.selectFile(portable, 'win-x64') === null && U.selectFile(portable, 'mac-arm64') === null, 'portable / autre format : jamais choisis');

// ── 4. Téléchargement (serveur local) ──
const hits = [];
let mode = 'normal';
const server = http.createServer((req, res) => {
  hits.push({ url: req.url, range: req.headers.range || null, headers: Object.keys(req.headers).sort().join() });
  if (req.url.startsWith('/redirect/')) {
    res.writeHead(302, { Location: '/files/' + req.url.slice('/redirect/'.length) });
    return res.end();
  }
  const name = decodeURIComponent(req.url.replace(/^\/files\//, ''));
  const f = path.join(REL, name);
  if (!req.url.startsWith('/files/') || !fs.existsSync(f)) {
    res.writeHead(404);
    return res.end();
  }
  const buf = fs.readFileSync(f);
  let start = 0;
  const m = /^bytes=(\d+)-$/.exec(req.headers.range || '');
  if (m && mode !== 'norange') start = Number(m[1]);
  if (start >= buf.length && m && mode !== 'norange') {
    res.writeHead(416);
    return res.end();
  }
  const body = buf.subarray(start);
  const headers = { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length };
  if (start > 0) headers['Content-Range'] = `bytes ${start}-${buf.length - 1}/${buf.length}`;
  res.writeHead(start > 0 ? 206 : 200, headers);
  if (mode === 'cut') {
    // Coupure franche après ~40 % du fichier.
    res.write(body.subarray(0, Math.floor(buf.length * 0.4)));
    setTimeout(() => res.socket.destroy(), 30);
    return;
  }
  if (mode === 'slow') {
    let i = 0;
    const step = 16 * 1024;
    const t = setInterval(() => {
      if (res.destroyed) return clearInterval(t);
      if (i >= body.length) {
        clearInterval(t);
        return res.end();
      }
      res.write(body.subarray(i, i + step));
      i += step;
    }, 20);
    return;
  }
  res.end(body);
});
await new Promise((ok_) => server.listen(0, '127.0.0.1', ok_));
const BASE = `http://127.0.0.1:${server.address().port}`;
const local = (u) => u.startsWith(BASE + '/');
const DL = path.join(TMP, 'userData', 'updates', '3.28');
const fileOf = (k) => man.files[k];
const urlOf = (name) => `${BASE}/files/${encodeURIComponent(name)}`;

// a) Manifeste et signature par HTTP
const mBytes = await U.fetchBuffer(`${BASE}/files/latest.json`, { allowUrl: local });
const sBytes = await U.fetchBuffer(`${BASE}/files/latest.json.sig`, { allowUrl: local });
ok(U.verifyManifest(mBytes, sBytes.toString(), PUB, { current: '3.27', expectedVersion: '3.28' }).ok, 'manifeste et signature servis en HTTP : acceptés');
ok(hits.every((h) => h.headers === 'accept,connection,host,user-agent'), 'requêtes : aucun en-tête en dehors du strict nécessaire', hits.map((h) => h.headers));
await rejects(U.fetchBuffer(`${BASE}/files/Marginalia-mac-arm64.dmg`, { allowUrl: local }), 'taille', 'manifeste trop long → refus');

// b) Téléchargement complet, progression
let f = fileOf('mac-arm64');
let dest = path.join(DL, f.name);
const prog = [];
let res = await U.downloadFile({ url: urlOf(f.name), dest, size: f.size, sha256: f.sha256, allowUrl: local, onProgress: (p) => prog.push(p) });
ok(res.file === dest && fs.statSync(dest).size === f.size && !fs.existsSync(dest + '.part'), 'téléchargement complet et vérifié');
ok(prog.length >= 1 && prog.at(-1).received === f.size && prog.at(-1).total === f.size, 'progression jusqu’à 100 %', prog.length);
res = await U.downloadFile({ url: urlOf(f.name), dest, size: f.size, sha256: f.sha256, allowUrl: local });
ok(res.reused, 'fichier déjà téléchargé et vérifié : réutilisé sans requête');

// c) Empreinte fausse
f = fileOf('mac-x64');
dest = path.join(DL, f.name);
await rejects(U.downloadFile({ url: urlOf(f.name), dest, size: f.size, sha256: 'b'.repeat(64), allowUrl: local }), 'empreinte', 'empreinte fausse → refus');
ok(!fs.existsSync(dest) && !fs.existsSync(dest + '.part'), 'empreinte fausse : rien de gardé');

// d) Taille fausse (fichier plus gros, puis plus petit qu'annoncé)
await rejects(U.downloadFile({ url: urlOf(f.name), dest, size: f.size - 10, sha256: f.sha256, allowUrl: local }), 'taille', 'fichier plus gros qu’annoncé → refus');
ok(!fs.existsSync(dest) && !fs.existsSync(dest + '.part'), 'taille fausse : rien de gardé');
await rejects(U.downloadFile({ url: urlOf(f.name), dest, size: f.size + 10, sha256: f.sha256, allowUrl: local }), null, 'fichier plus petit qu’annoncé → pas installable');
ok(!fs.existsSync(dest), 'fichier plus petit : jamais renommé en fichier prêt');
await rejects(U.downloadFile({ url: urlOf(f.name), dest, size: U.MAX_UPDATE_SIZE + 1, sha256: f.sha256, allowUrl: local }), 'taille', 'taille au-delà de la limite → refus');
await fs.promises.rm(path.join(DL, f.name + '.part'), { force: true });

// e) Coupure puis reprise (Range)
f = fileOf('win-x64');
dest = path.join(DL, f.name);
mode = 'cut';
await rejects(U.downloadFile({ url: urlOf(f.name), dest, size: f.size, sha256: f.sha256, allowUrl: local }), null, 'connexion coupée → erreur');
const partSize = fs.statSync(dest + '.part').size;
ok(partSize > 0 && partSize < f.size && !fs.existsSync(dest), 'coupure : partie reçue gardée', partSize);
mode = 'normal';
hits.length = 0;
res = await U.downloadFile({ url: urlOf(f.name), dest, size: f.size, sha256: f.sha256, allowUrl: local });
ok(res.resumedFrom === partSize && hits[0].range === `bytes=${partSize}-`, 'reprise : en-tête Range depuis la partie reçue', hits[0].range);
ok(crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex') === f.sha256, 'reprise : fichier complet et exact');

// f) Annulation puis reprise
f = fileOf('win-arm64');
dest = path.join(DL, f.name);
mode = 'slow';
const ctrl = new AbortController();
const p = U.downloadFile({ url: urlOf(f.name), dest, size: f.size, sha256: f.sha256, allowUrl: local, signal: ctrl.signal });
setTimeout(() => ctrl.abort(), 150);
await rejects(p, 'AbortError', 'annulation pendant le téléchargement');
const part2 = fs.statSync(dest + '.part').size;
ok(part2 > 0 && part2 < f.size, 'annulation : partie gardée pour la reprise', part2);
mode = 'normal';
hits.length = 0;
res = await U.downloadFile({ url: urlOf(f.name), dest, size: f.size, sha256: f.sha256, allowUrl: local });
ok(res.resumedFrom === part2 && fs.statSync(dest).size === f.size, 'reprise après annulation : complète');

// g) Serveur sans reprise : recommence à zéro
await fs.promises.rm(dest, { force: true });
fs.writeFileSync(dest + '.part', fs.readFileSync(path.join(REL, f.name)).subarray(0, 1000));
mode = 'norange';
res = await U.downloadFile({ url: urlOf(f.name), dest, size: f.size, sha256: f.sha256, allowUrl: local });
ok(fs.statSync(dest).size === f.size, 'serveur sans reprise (200) : fichier recommencé et exact');
mode = 'normal';

// h) .part d'un autre fichier : ignoré
await fs.promises.rm(dest, { force: true });
fs.writeFileSync(dest + '.part', crypto.randomBytes(5000));
fs.writeFileSync(dest + '.part.json', JSON.stringify({ sha256: 'c'.repeat(64), size: f.size }));
res = await U.downloadFile({ url: urlOf(f.name), dest, size: f.size, sha256: f.sha256, allowUrl: local });
ok(res.resumedFrom === 0 && fs.statSync(dest).size === f.size, 'partie d’un autre fichier : jetée, pas mélangée');

// i) Redirection et adresses refusées
await fs.promises.rm(dest, { force: true });
res = await U.downloadFile({ url: `${BASE}/redirect/${encodeURIComponent(f.name)}`, dest, size: f.size, sha256: f.sha256, allowUrl: local });
ok(fs.statSync(dest).size === f.size, 'redirection suivie');
await rejects(U.downloadFile({ url: urlOf(f.name), dest: dest + '2', size: f.size, sha256: f.sha256 }), 'adresse', 'adresse hors GitHub refusée (règle de production)');
ok(U.githubUrlAllowed('https://github.com/FavveyAxel/marginalia/releases/download/v3.28/latest.json') && U.githubUrlAllowed('https://release-assets.githubusercontent.com/x'), 'GitHub et ses serveurs de fichiers admis');
ok(!U.githubUrlAllowed('http://github.com/x') && !U.githubUrlAllowed('https://github.com.evil.example/x') && !U.githubUrlAllowed('https://user:pw@github.com/x'), 'http, faux domaine, identifiants : refusés');
server.close();

// ── 5. Windows ──
const winDir = path.join(TMP, 'win', 'Programs', 'Marginalia');
fs.mkdirSync(winDir, { recursive: true });
fs.writeFileSync(path.join(winDir, 'Marginalia.exe'), '');
ok(!U.windowsInstallCheck({ exe: path.join(winDir, 'Marginalia.exe'), env: {} }).ok, 'Windows sans désinstalleur (copie manuelle) : pas d’installation automatique');
fs.writeFileSync(path.join(winDir, 'Uninstall Marginalia.exe'), '');
ok(U.windowsInstallCheck({ exe: path.join(winDir, 'Marginalia.exe'), env: {} }).ok, 'Windows installé : installation automatique possible');
const pc = U.windowsInstallCheck({ exe: path.join(winDir, 'Marginalia.exe'), env: { PORTABLE_EXECUTABLE_DIR: 'C:\\x' } });
ok(!pc.ok && /portable/i.test(pc.reason), 'Windows portable : jamais d’installation automatique', pc.reason);
let cmd = U.windowsInstallCommand('C:\\Users\\Léa O\'Neil\\AppData\\setup.exe', { relaunch: true, exe: 'C:\\Users\\Léa O\'Neil\\AppData\\Local\\Programs\\Marginalia\\Marginalia.exe', env: { SystemRoot: 'C:\\Windows' } });
{
  const enc = cmd.args[cmd.args.indexOf('-EncodedCommand') + 1];
  const script = Buffer.from(enc, 'base64').toString('utf16le');
  ok(/powershell\.exe$/i.test(cmd.cmd) && cmd.args.includes('-WindowStyle') && cmd.args.includes('Hidden') && !cmd.args.includes('--force-run'), 'Redémarrer : PowerShell caché (pas de relance laissée à l’installateur)', cmd.cmd);
  ok(script.includes("-FilePath 'C:\\Users\\Léa O''Neil\\AppData\\setup.exe' -ArgumentList '/S','--updated' -PassThru -Wait"), 'il attend la fin de l’installateur silencieux (chemin avec espace, accent et apostrophe)', script);
  ok(/-Wait;.*Start-Sleep.*Start-Process -FilePath 'C:\\Users\\Léa O''Neil\\AppData\\Local\\Programs\\Marginalia\\Marginalia\.exe'/.test(script), 'puis rouvre Marginalia elle-même', script);
}
cmd = U.windowsInstallCommand('C:\\U\\s.exe', { relaunch: false });
ok(cmd.args.join(' ') === '/S --updated', 'installateur à la fermeture : sans relance', cmd.args);

// ── 6. Mac : emplacement ──
const yes = () => {};
const no = () => {
  throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
};
ok(U.macBundleFromExe('/Applications/Marginalia.app/Contents/MacOS/Marginalia') === '/Applications/Marginalia.app', 'chemin du .app depuis l’exécutable');
ok(U.checkMacLocation('/Applications/Marginalia.app', { access: yes }).ok, '/Applications modifiable : accepté');
let loc = U.checkMacLocation('/private/var/folders/ab/xyz/T/AppTranslocation/1234-5678/d/Marginalia.app', { access: yes });
ok(!loc.ok && /temporaire/.test(loc.reason), 'translocation : refus', loc.reason);
loc = U.checkMacLocation('/Volumes/Marginalia 3.27.0/Marginalia.app', { access: yes });
ok(!loc.ok && /image disque/.test(loc.reason), 'depuis le .dmg monté : refus', loc.reason);
loc = U.checkMacLocation('/Applications/Marginalia.app', { access: no });
ok(!loc.ok && /modifiable/.test(loc.reason), 'dossier non modifiable : refus', loc.reason);
ok(U.checkMacLocation('/Volumes/Disque externe/Apps/Marginalia.app', { access: yes }).ok, 'disque externe modifiable : accepté');
ok(!U.checkMacLocation(null).ok && !U.checkMacLocation('/usr/bin/marginalia').ok, 'hors d’un .app : refus');

// ── 7. Mac : script ──
const weird = `/Users/o'brien/Mes Apps $HOME \`x\`/Marginalia.app`;
const script = U.buildMacScript({ pid: 4242, appPath: weird, newAppPath: '/a/.Marginalia-maj-3.28.app', oldAppPath: '/a/.Marginalia-ancienne.app', mountPoint: '/u/mnt-1', resultFile: '/u/r.txt', relaunch: true, version: '3.28' });
ok(script.includes(`APP='/Users/o'\\''brien/Mes Apps $HOME \`x\`/Marginalia.app'`), 'chemins entre apostrophes, apostrophe échappée ($ et ` non interprétés)');
ok(script.includes('PID=4242') && script.includes('kill -0 "$PID"') && script.includes('xattr -dr com.apple.quarantine "$APP"') && script.includes('hdiutil detach "$MNT"') && script.includes('open "$APP"'), 'script : attente, quarantaine, démontage, relance');
ok(/mv "\$APP" "\$OLD"[\s\S]*mv "\$NEW" "\$APP"[\s\S]*mv "\$OLD" "\$APP"[\s\S]*rm -rf "\$OLD"/.test(script), 'script : ancienne app gardée jusqu’au succès, remise en cas d’échec');
ok(!U.buildMacScript({ pid: 1, appPath: '/a.app', newAppPath: '/b', oldAppPath: '/c', mountPoint: '/m', resultFile: '/r', relaunch: false, version: '3' }).includes('open "$APP"'), 'installation à la fermeture : pas de relance');
const shCheck = spawnSync('sh', ['-n'], { input: script });
ok(shCheck.status === 0, 'script : syntaxe sh valide', shCheck.stderr && shCheck.stderr.toString());

// ── 8. Mac : scénario réel (Linux, outils simulés) ──
const STUBS = path.join(TMP, 'stubs');
const TOOL_LOG = path.join(TMP, 'tools.log');
fs.mkdirSync(STUBS);
const stub = (name, body) => fs.writeFileSync(path.join(STUBS, name), `#!/bin/sh\necho "${name} $*" >> '${TOOL_LOG}'\n${body}\n`, { mode: 0o755 });
// hdiutil attach … -mountpoint <dir> <dmg> : « monte » le contenu préparé dans $FAKE_DMG_DIR.
stub(
  'hdiutil',
  `if [ "$1" = attach ]; then
  while [ $# -gt 0 ]; do if [ "$1" = -mountpoint ]; then shift; MP="$1"; fi; shift; done
  cp -R "$FAKE_DMG_DIR"/. "$MP"/
fi
exit 0`,
);
stub('ditto', 'cp -R "$1" "$2"');
stub('xattr', 'exit 0');
stub('open', 'exit 0');
const runStub = (c, a, o = {}) => U.runCommand(c, a, { ...o, env: { ...process.env, PATH: `${STUBS}:${process.env.PATH}`, FAKE_DMG_DIR: path.join(TMP, 'dmg') } });
const plist = (id, ver) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n<key>CFBundleIdentifier</key>\n<string>${id}</string>\n<key>CFBundleShortVersionString</key>\n<string>${ver}</string>\n</dict></plist>\n`;
const makeApp = (dir, id, ver, marker) => {
  fs.mkdirSync(path.join(dir, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Contents', 'Info.plist'), plist(id, ver));
  fs.writeFileSync(path.join(dir, 'Contents', 'MacOS', 'Marginalia'), marker);
};
const APPS = path.join(TMP, "Applications d'Axel $x");
const APP = path.join(APPS, 'Marginalia.app');
const WORK = path.join(TMP, 'userData', 'updates');
const DMG = path.join(DL, 'Marginalia-mac-arm64.dmg');
const resetScenario = (dmgId = 'com.axelbierne.marginalia', dmgVer = '3.28.0') => {
  fs.rmSync(APPS, { recursive: true, force: true });
  fs.rmSync(path.join(TMP, 'dmg'), { recursive: true, force: true });
  fs.rmSync(TOOL_LOG, { force: true });
  makeApp(APP, 'com.axelbierne.marginalia', '3.27.0', 'ancienne');
  makeApp(path.join(TMP, 'dmg', 'Marginalia.app'), dmgId, dmgVer, 'nouvelle');
  fs.symlinkSync('/Applications', path.join(TMP, 'dmg', 'Applications'));
};
const waitExit = (child) => new Promise((ok_) => child.on('exit', ok_));

// a) Remplacement réussi, avec relance
resetScenario();
let sleeper = spawn('sleep', ['0.6']);
let prep = await U.prepareMac({ dmg: DMG, appPath: APP, version: '3.28', workDir: WORK, pid: sleeper.pid, relaunch: true, run: runStub });
let log = fs.readFileSync(TOOL_LOG, 'utf8');
ok(/hdiutil attach -nobrowse -readonly -noautoopen -mountpoint .*mnt-[0-9a-f]+ .*Marginalia-mac-arm64\.dmg/.test(log), 'hdiutil attach -nobrowse -readonly sur un point de montage privé', log.split('\n')[0]);
ok(fs.existsSync(path.join(prep.newAppPath, 'Contents/MacOS/Marginalia')) && path.dirname(prep.newAppPath) === APPS, 'copie ditto à côté de l’app actuelle (même volume)', prep.newAppPath);
ok(fs.readFileSync(path.join(APP, 'Contents/MacOS/Marginalia'), 'utf8') === 'ancienne', 'avant la fermeture : l’app actuelle est intacte');
const t0 = Date.now();
let child = spawn('/bin/sh', [prep.scriptPath], { env: { ...process.env, PATH: `${STUBS}:${process.env.PATH}` }, stdio: 'ignore' });
await waitExit(child);
ok(Date.now() - t0 >= 400, 'le script attend la fin du processus', Date.now() - t0);
ok(fs.readFileSync(path.join(APP, 'Contents/MacOS/Marginalia'), 'utf8') === 'nouvelle', 'app remplacée par la nouvelle version');
ok(!fs.existsSync(prep.oldAppPath) && !fs.existsSync(prep.newAppPath), 'ancienne app supprimée après le succès, plus de copie temporaire');
ok(fs.readFileSync(path.join(WORK, 'install-result.txt'), 'utf8').trim() === 'ok', 'résultat : ok');
log = fs.readFileSync(TOOL_LOG, 'utf8');
ok(log.includes(`xattr -dr com.apple.quarantine ${APP}`) && log.includes(`hdiutil detach ${prep.mountPoint} -quiet`) && log.includes(`open ${APP}`), 'quarantaine retirée, .dmg démonté, app relancée', log.trim().split('\n').slice(-3));
ok(!fs.existsSync(prep.scriptPath), 'script supprimé après usage');

// b) Copie disparue avant la fermeture : échec sans dommage, ancienne app intacte
resetScenario();
sleeper = spawn('sleep', ['0.2']);
prep = await U.prepareMac({ dmg: DMG, appPath: APP, version: '3.28', workDir: WORK, pid: sleeper.pid, relaunch: false, run: runStub });
fs.rmSync(prep.newAppPath, { recursive: true, force: true });
child = spawn('/bin/sh', [prep.scriptPath], { env: { ...process.env, PATH: `${STUBS}:${process.env.PATH}` }, stdio: 'ignore' });
await waitExit(child);
ok(fs.readFileSync(path.join(APP, 'Contents/MacOS/Marginalia'), 'utf8') === 'ancienne' && fs.readFileSync(path.join(WORK, 'install-result.txt'), 'utf8').startsWith('echec'), 'échec : ancienne app intacte, résultat « echec »');
ok(!/^open /m.test(fs.readFileSync(TOOL_LOG, 'utf8')), 'installation à la fermeture : pas de relance');

// c) Remplacement impossible (nouvelle copie non déplaçable) : l'ancienne app est remise
resetScenario();
sleeper = spawn('sleep', ['0.1']);
prep = await U.prepareMac({ dmg: DMG, appPath: APP, version: '3.28', workDir: WORK, pid: sleeper.pid, relaunch: false, run: runStub });
// Un « mv » simulé qui refuse de déplacer la nouvelle copie (disque plein, droits…).
stub('mv', `case "$1" in *-maj-*) exit 1;; esac\nexec /bin/mv "$@"`);
child = spawn('/bin/sh', [prep.scriptPath], { env: { ...process.env, PATH: `${STUBS}:${process.env.PATH}` }, stdio: 'ignore' });
await waitExit(child);
fs.rmSync(path.join(STUBS, 'mv'));
ok(fs.readFileSync(path.join(APP, 'Contents/MacOS/Marginalia'), 'utf8') === 'ancienne' && !fs.existsSync(prep.oldAppPath), 'remplacement impossible : ancienne app remise en place');
ok(fs.readFileSync(path.join(WORK, 'install-result.txt'), 'utf8').trim() === 'echec remplacement', 'résultat : echec remplacement');

// d) .dmg d'une autre app ou d'une autre version : refus, rien de copié, démonté
for (const [id, ver, what] of [
  ['com.exemple.autre', '3.28.0', 'autre identifiant'],
  ['com.axelbierne.marginalia', '3.26.0', 'autre version'],
]) {
  resetScenario(id, ver);
  await rejects(U.prepareMac({ dmg: DMG, appPath: APP, version: '3.28', workDir: WORK, pid: 1, relaunch: true, run: runStub }), 'paquet', `.dmg avec ${what} : refus`);
  log = fs.readFileSync(TOOL_LOG, 'utf8');
  ok(!fs.readdirSync(APPS).some((n) => n.includes('-maj-')) && /hdiutil detach/.test(log) && !/ditto/.test(log), `${what} : rien copié, .dmg démonté`);
}
// e) Emplacement refusé : rien n'est monté
resetScenario();
await rejects(U.prepareMac({ dmg: DMG, appPath: APP, version: '3.28', workDir: WORK, pid: 1, relaunch: true, run: runStub, access: no }), 'emplacement', 'dossier non modifiable : refus avant tout montage');
ok(!fs.existsSync(TOOL_LOG), 'emplacement refusé : aucune commande lancée');

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} réussis, ${fail} échoués`);
