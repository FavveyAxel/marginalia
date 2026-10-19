// Mise à jour automatique : vérification du manifeste signé, téléchargement avec reprise,
// préparation de l'installation (Mac : copie de l'app depuis le .dmg et script de remplacement ;
// Windows : installateur NSIS en silencieux).
//
// Module sans dépendance à Electron : testé seul par scripts/test-autoupdate.mjs (serveur local).
//
// Sécurité : rien n'est installé sans un manifeste latest.json signé (Ed25519) par la clé dont la
// partie publique est embarquée (electron/update-key.cjs) ; le fichier téléchargé doit avoir la
// taille et l'empreinte SHA-256 du manifeste ; la version du manifeste doit être plus récente que
// celle qui tourne (pas de retour en arrière). Aucune donnée de l'utilisateur n'est envoyée : des
// requêtes GET sans cookie, avec le seul en-tête User-Agent « Marginalia ».
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const { execFile } = require('node:child_process');

/** Taille maximale acceptée pour un fichier de mise à jour (un .dmg fait ~200 Mo). */
const MAX_UPDATE_SIZE = 800 * 1024 * 1024;
/** Taille maximale du manifeste et de sa signature. */
const MAX_MANIFEST_SIZE = 64 * 1024;
const PLATFORM_KEYS = ['mac-arm64', 'mac-x64', 'win-x64', 'win-arm64'];
const MANIFEST_NAME = 'latest.json';
const SIGNATURE_NAME = 'latest.json.sig';

/** Compare deux versions « 3.22 », « v3.22.1 » : < 0, 0, > 0. */
function compareVersions(a, b) {
  const p = (v) => String(v || '').replace(/^v/i, '').split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : NaN));
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const m = Number.isNaN(x[i] ?? 0) ? 0 : x[i] ?? 0;
    const n = Number.isNaN(y[i] ?? 0) ? 0 : y[i] ?? 0;
    if (m !== n) return m - n;
  }
  return 0;
}

/**
 * Fichier de la Release pour ce système : mac-arm64, mac-x64, win-x64, win-arm64 (null ailleurs).
 * `translated` : app x64 qui tourne sur un processeur ARM (Rosetta, émulation Windows) → version arm64.
 */
function platformKey(platform, arch, translated = false) {
  const arm = arch === 'arm64' || !!translated;
  if (platform === 'darwin') return arm ? 'mac-arm64' : arch === 'x64' ? 'mac-x64' : null;
  if (platform === 'win32') return arm ? 'win-arm64' : arch === 'x64' ? 'win-x64' : null;
  return null;
}

class UpdateError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'echec';
  }
}

/**
 * Vérifie la signature Ed25519 du manifeste (octets exacts) puis son contenu.
 * Renvoie { ok: true, manifest } ou { ok: false, code, reason } (message en français).
 */
function verifyManifest(manifestBytes, signatureText, publicKeyPem, { current, expectedVersion } = {}) {
  const fail = (code, reason) => ({ ok: false, code, reason });
  if (!manifestBytes || !manifestBytes.length) return fail('manifeste', 'Manifeste de mise à jour absent.');
  if (signatureText == null || !String(signatureText).trim()) return fail('signature', 'Manifeste de mise à jour non signé.');
  if (manifestBytes.length > MAX_MANIFEST_SIZE) return fail('manifeste', 'Manifeste de mise à jour trop long.');
  let sig;
  try {
    const t = String(signatureText).trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(t)) throw new Error('base64');
    sig = Buffer.from(t, 'base64');
  } catch {
    return fail('signature', 'Signature de mise à jour illisible.');
  }
  if (sig.length !== 64) return fail('signature', 'Signature de mise à jour illisible.');
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(manifestBytes), crypto.createPublicKey(publicKeyPem), sig);
  } catch {
    valid = false;
  }
  if (!valid) return fail('signature', 'Signature de mise à jour invalide : la mise à jour est refusée.');
  let m;
  try {
    m = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  } catch {
    return fail('manifeste', 'Manifeste de mise à jour illisible.');
  }
  if (!m || typeof m !== 'object' || typeof m.version !== 'string' || !/^v?\d+(\.\d+){0,3}$/.test(m.version)) return fail('manifeste', 'Manifeste de mise à jour illisible.');
  if (!m.files || typeof m.files !== 'object') return fail('manifeste', 'Manifeste de mise à jour illisible.');
  const files = {};
  for (const [k, f] of Object.entries(m.files)) {
    if (!PLATFORM_KEYS.includes(k)) continue;
    if (!f || typeof f.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(f.name)) return fail('manifeste', 'Manifeste de mise à jour illisible.');
    if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) return fail('manifeste', 'Manifeste de mise à jour illisible.');
    if (!Number.isSafeInteger(f.size) || f.size <= 0) return fail('manifeste', 'Manifeste de mise à jour illisible.');
    if (f.size > MAX_UPDATE_SIZE) return fail('taille', 'Fichier de mise à jour trop gros.');
    files[k] = { name: f.name, sha256: f.sha256, size: f.size };
  }
  const version = m.version.replace(/^v/i, '');
  if (current != null && compareVersions(version, current) <= 0) return fail('version', `La version ${version} n’est pas plus récente que la ${current} : refusée.`);
  if (expectedVersion != null && compareVersions(version, expectedVersion) !== 0) return fail('version', 'Le manifeste ne correspond pas à la version publiée.');
  return { ok: true, manifest: { version, files } };
}

/** Entrée du manifeste pour ce système (.dmg sur Mac, installateur -setup.exe sous Windows). */
function selectFile(manifest, key) {
  if (!manifest || !key) return null;
  const f = manifest.files && manifest.files[key];
  if (!f) return null;
  if (key.startsWith('mac-') && !/\.dmg$/i.test(f.name)) return null;
  if (key.startsWith('win-') && !/-setup\.exe$/i.test(f.name)) return null;
  return f;
}

/** Adresses de téléchargement admises en production : GitHub (et ses serveurs de fichiers), en https. */
function githubUrlAllowed(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && !x.username && !x.password && (x.hostname === 'github.com' || x.hostname.endsWith('.githubusercontent.com'));
  } catch {
    return false;
  }
}

/** GET (redirections suivies, chaque adresse contrôlée par allowUrl). Résout avec la réponse. */
function httpGet(url, { headers = {}, signal, timeoutMs = 30000, allowUrl = githubUrlAllowed, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const go = (u, left) => {
      if (!allowUrl(u)) return reject(new UpdateError('Adresse de téléchargement refusée.', 'adresse'));
      if (signal && signal.aborted) return reject(abortError());
      const mod = u.startsWith('https:') ? https : http;
      let req;
      try {
        req = mod.get(u, { headers: { 'User-Agent': 'Marginalia', ...headers }, timeout: timeoutMs, signal }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            if (left <= 0) return reject(new UpdateError('Trop de redirections.', 'reseau'));
            let next;
            try {
              next = new URL(res.headers.location, u).toString();
            } catch {
              return reject(new UpdateError('Redirection invalide.', 'reseau'));
            }
            return go(next, left - 1);
          }
          resolve(res);
        });
      } catch (e) {
        return reject(e);
      }
      req.on('timeout', () => req.destroy(new UpdateError('Délai dépassé.', 'reseau')));
      req.on('error', (e) => reject(signal && signal.aborted ? abortError() : e));
    };
    go(url, maxRedirects);
  });
}

function abortError() {
  const e = new UpdateError('Téléchargement annulé.', 'annule');
  e.name = 'AbortError';
  return e;
}

/** Petit fichier (manifeste, signature) : au plus `limit` octets. */
async function fetchBuffer(url, { limit = MAX_MANIFEST_SIZE, ...opts } = {}) {
  const res = await httpGet(url, { headers: { Accept: 'application/octet-stream' }, ...opts });
  if (res.statusCode !== 200) {
    res.resume();
    throw new UpdateError(`HTTP ${res.statusCode}`, 'reseau');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    let failed = null;
    res.on('data', (c) => {
      n += c.length;
      if (n > limit) {
        failed = new UpdateError('Réponse trop longue.', 'taille');
        reject(failed);
        res.destroy();
      } else chunks.push(c);
    });
    res.on('end', () => !failed && resolve(Buffer.concat(chunks)));
    res.on('error', (e) => reject(failed || e));
    res.on('aborted', () => reject(failed || new UpdateError('Connexion interrompue.', 'reseau')));
  });
}

async function sha256File(file) {
  const h = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', resolve).on('error', reject);
  });
  return h.digest('hex');
}

/** Le fichier a-t-il exactement la taille et l'empreinte attendues ? */
async function verifyFile(file, { size, sha256 }) {
  const st = await fsp.stat(file).catch(() => null);
  if (!st || !st.isFile() || st.size !== size) return false;
  return (await sha256File(file)) === sha256;
}

/**
 * Télécharge `url` vers `dest` (fichier `dest.part` pendant le téléchargement, repris s'il existe
 * pour la même empreinte). Vérifie taille et SHA-256 avant de renommer en `dest`.
 * Annulation (signal) : le .part est gardé pour une reprise. Taille ou empreinte fausse : supprimé.
 */
async function downloadFile({ url, dest, size, sha256, signal, onProgress, allowUrl, timeoutMs = 30000 }) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_UPDATE_SIZE) throw new UpdateError('Taille de mise à jour invalide.', 'taille');
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (await verifyFile(dest, { size, sha256 })) return { file: dest, resumedFrom: 0, reused: true };
  await fsp.rm(dest, { force: true });
  const part = dest + '.part';
  const metaFile = part + '.json';
  // Un .part d'un autre fichier (autre empreinte) ne sert pas.
  const meta = await fsp.readFile(metaFile, 'utf8').then(JSON.parse, () => null);
  if (!meta || meta.sha256 !== sha256 || meta.size !== size) {
    await fsp.rm(part, { force: true });
    await fsp.writeFile(metaFile, JSON.stringify({ sha256, size }));
  }
  let start = (await fsp.stat(part).catch(() => null))?.size || 0;
  if (start > size) {
    await fsp.rm(part, { force: true });
    start = 0;
  }
  const resumedFrom = start;
  let last = 0;
  const progress = (received) => {
    const now = Date.now();
    if (onProgress && (now - last > 200 || received === size)) {
      last = now;
      onProgress({ received, total: size });
    }
  };
  if (start < size) {
    const headers = { Accept: 'application/octet-stream' };
    if (start > 0) headers.Range = `bytes=${start}-`;
    let res = await httpGet(url, { headers, signal, allowUrl, timeoutMs });
    if (start > 0 && res.statusCode === 416) {
      // Le serveur refuse la plage : on recommence de zéro.
      res.resume();
      await fsp.rm(part, { force: true });
      start = 0;
      res = await httpGet(url, { headers: { Accept: 'application/octet-stream' }, signal, allowUrl, timeoutMs });
    }
    if (res.statusCode === 206) {
      const m = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(String(res.headers['content-range'] || ''));
      if (!m || Number(m[1]) !== start) {
        res.resume();
        await fsp.rm(part, { force: true });
        throw new UpdateError('Reprise du téléchargement impossible.', 'reseau');
      }
    } else if (res.statusCode === 200) {
      start = 0; // pas de reprise côté serveur : fichier complet
    } else {
      res.resume();
      throw new UpdateError(`Téléchargement impossible (HTTP ${res.statusCode}).`, 'reseau');
    }
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && start + declared > size) {
      res.resume();
      throw new UpdateError('Fichier de mise à jour plus gros qu’annoncé : mise à jour refusée.', 'taille');
    }
    let received = start;
    progress(received);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(part, { flags: start > 0 ? 'a' : 'w' });
      let failed = null;
      const fail = (e) => {
        if (failed) return;
        failed = e;
        res.destroy();
        out.destroy();
      };
      res.on('data', (c) => {
        received += c.length;
        if (received > size) return fail(new UpdateError('Fichier de mise à jour plus gros qu’annoncé : mise à jour refusée.', 'taille'));
        progress(received);
      });
      res.on('aborted', () => fail(signal && signal.aborted ? abortError() : new UpdateError('Connexion interrompue.', 'reseau')));
      res.on('error', (e) => fail(signal && signal.aborted ? abortError() : e));
      out.on('error', (e) => fail(e));
      out.on('close', () => (failed ? reject(failed) : resolve()));
      res.pipe(out);
    }).catch(async (e) => {
      if (e && e.code === 'taille') await fsp.rm(part, { force: true });
      throw e && e.name === 'AbortError' ? abortError() : e;
    });
  }
  const st = await fsp.stat(part).catch(() => null);
  if (!st || st.size < size) throw new UpdateError('Téléchargement interrompu : il reprendra plus tard.', 'reseau');
  if (st.size !== size) {
    await fsp.rm(part, { force: true });
    throw new UpdateError('Taille du fichier de mise à jour incorrecte : mise à jour refusée.', 'taille');
  }
  if ((await sha256File(part)) !== sha256) {
    await fsp.rm(part, { force: true });
    await fsp.rm(metaFile, { force: true });
    throw new UpdateError('Empreinte du fichier de mise à jour incorrecte : mise à jour refusée.', 'empreinte');
  }
  await fsp.rename(part, dest);
  await fsp.rm(metaFile, { force: true });
  return { file: dest, resumedFrom, reused: false };
}

// ── Windows ──────────────────────────────────────────────────
// Installation par l'installateur NSIS (« assisted », par utilisateur, sans élévation) : `/S` en
// silencieux, `--updated` (mise à jour : raccourcis gardés), `--force-run` (relance l'app à la fin ;
// seulement pour « Redémarrer », pas pour une installation à la fermeture).

/** Version installée par l'installateur (pas la version portable, pas un dossier copié à la main). */
function windowsInstallCheck({ exe, env = process.env }) {
  if (env.PORTABLE_EXECUTABLE_DIR || env.PORTABLE_EXECUTABLE_FILE)
    return { ok: false, reason: 'Version portable de Marginalia : téléchargez la nouvelle version depuis le site.' };
  const dir = path.dirname(exe || '');
  if (!exe || !fs.existsSync(path.join(dir, 'Uninstall Marginalia.exe')))
    return { ok: false, reason: 'Marginalia n’a pas été installée par son installateur : téléchargez la nouvelle version depuis le site.' };
  return { ok: true };
}

// Relance : on ne compte pas sur l'installateur (en mode silencieux, sa relance par le raccourci ne part pas
// toujours). Un petit PowerShell caché attend la fin de l'installateur, puis rouvre l'app elle-même. Le
// script passe en -EncodedCommand (UTF-16LE, base64) : chemins avec espaces, accents ou apostrophes compris.
const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";
function windowsInstallCommand(setupPath, { relaunch, exe = null, env = process.env }) {
  if (!relaunch || !exe) return { cmd: setupPath, args: ['/S', '--updated'] };
  const script = [
    `$p = Start-Process -FilePath ${psQuote(setupPath)} -ArgumentList '/S','--updated' -PassThru -Wait`,
    'Start-Sleep -Milliseconds 800',
    `if (Test-Path -LiteralPath ${psQuote(exe)}) { Start-Process -FilePath ${psQuote(exe)} -ArgumentList '--updated' }`,
  ].join('; ');
  const ps = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return {
    cmd: ps,
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    script,
  };
}

// ── Mac ──────────────────────────────────────────────────────
// App non signée par un développeur Apple : pas de Squirrel.Mac. On monte le .dmg (lecture seule,
// invisible dans le Finder), on copie le .app à côté de l'app actuelle (même volume : renommage
// atomique), puis un script détaché attend la fin de Marginalia et échange les deux dossiers.

/** …/Marginalia.app/Contents/MacOS/Marginalia → …/Marginalia.app (null si l'exécutable n'est pas dans un .app). */
function macBundleFromExe(exe) {
  const i = String(exe || '').indexOf('.app/Contents/MacOS/');
  return i < 0 ? null : exe.slice(0, i + 4);
}

/** L'app peut-elle se remplacer elle-même à cet endroit ? */
function checkMacLocation(appPath, { access = (p) => fs.accessSync(p, fs.constants.W_OK) } = {}) {
  if (!appPath || !/\.app$/.test(appPath)) return { ok: false, reason: 'Emplacement de Marginalia inconnu : téléchargez la nouvelle version depuis le site.' };
  if (/\/AppTranslocation\//.test(appPath))
    return { ok: false, reason: 'macOS fait tourner Marginalia depuis un emplacement temporaire. Glissez-la dans le dossier Applications pour recevoir les mises à jour automatiques.' };
  if (/^\/Volumes\/Marginalia[^/]*\//.test(appPath))
    return { ok: false, reason: 'Marginalia tourne depuis l’image disque. Glissez-la dans le dossier Applications pour recevoir les mises à jour automatiques.' };
  try {
    access(path.dirname(appPath));
    access(appPath);
  } catch {
    return { ok: false, reason: 'Le dossier de Marginalia n’est pas modifiable par votre compte : téléchargez la nouvelle version depuis le site.' };
  }
  return { ok: true };
}

/** Chaîne entre apostrophes pour /bin/sh. */
function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Script de remplacement (sh) : attend la fin du processus `pid` (60 s au plus), garde l'ancienne
 * app sous un autre nom, met la nouvelle à sa place (en cas d'échec, remet l'ancienne), supprime
 * l'ancienne une fois le remplacement réussi, retire l'attribut de quarantaine, démonte le .dmg,
 * écrit le résultat et relance l'app si demandé.
 */
function buildMacScript({ pid, appPath, newAppPath, oldAppPath, mountPoint, resultFile, relaunch, version }) {
  const q = shQuote;
  return `#!/bin/sh
# Marginalia : installation de la version ${String(version).replace(/[^0-9A-Za-z.-]/g, '')} (script généré, supprimé après usage).
PID=${Number(pid) | 0}
APP=${q(appPath)}
NEW=${q(newAppPath)}
OLD=${q(oldAppPath)}
MNT=${q(mountPoint)}
RESULT=${q(resultFile)}

finish() {
  hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || hdiutil detach "$MNT" -force -quiet >/dev/null 2>&1
  rmdir "$MNT" >/dev/null 2>&1
  printf '%s\\n' "$1" > "$RESULT"
${relaunch ? '  open "$APP" >/dev/null 2>&1\n' : ''}  rm -f "$0"
  exit 0
}

# 1. Attendre la fin de Marginalia (60 secondes au plus).
i=0
while kill -0 "$PID" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 600 ]; then rm -rf "$NEW"; finish "echec attente"; fi
  sleep 0.1
done

# 2. Remplacer : l'ancienne app est gardée tant que la nouvelle n'est pas en place.
[ -d "$NEW/Contents/MacOS" ] || finish "echec copie"
rm -rf "$OLD"
if ! mv "$APP" "$OLD"; then rm -rf "$NEW"; finish "echec renommage"; fi
if ! mv "$NEW" "$APP"; then
  mv "$OLD" "$APP"
  rm -rf "$NEW"
  finish "echec remplacement"
fi
rm -rf "$OLD"

# 3. Pas de quarantaine sur la nouvelle version (copiée depuis un fichier téléchargé).
xattr -dr com.apple.quarantine "$APP" >/dev/null 2>&1

finish "ok"
`;
}

/** Valeur d'une clé (chaîne) d'un Info.plist XML ; binaire : PlistBuddy. */
async function readPlistKey(plistPath, key, run) {
  const raw = await fsp.readFile(plistPath);
  if (raw.subarray(0, 6).toString('latin1') === 'bplist') {
    const out = await run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath]);
    return String(out).trim();
  }
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`<key>${esc}</key>\\s*<string>([^<]*)</string>`).exec(raw.toString('utf8'));
  return m ? m[1].trim() : null;
}

/** execFile en promesse (stdout) ; commandes cherchées dans le PATH (remplaçables en test). */
function runCommand(cmd, args, { timeout = 120000, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, env, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.message = `${path.basename(cmd)} : ${String(stderr || err.message).trim().slice(0, 300)}`;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

/**
 * Prépare l'installation Mac : monte le .dmg, contrôle l'app qu'il contient (même identifiant,
 * bonne version), la copie avec ditto à côté de l'app actuelle, et écrit le script de remplacement.
 * Tout échec : rien n'est modifié (copie supprimée, .dmg démonté) et une UpdateError est levée.
 */
async function prepareMac({ dmg, appPath, version, workDir, pid, relaunch, run = runCommand, access }) {
  const loc = checkMacLocation(appPath, access ? { access } : undefined);
  if (!loc.ok) throw new UpdateError(loc.reason, 'emplacement');
  const appId = await readPlistKey(path.join(appPath, 'Contents', 'Info.plist'), 'CFBundleIdentifier', run).catch(() => null);
  if (!appId) throw new UpdateError('Identifiant de l’app actuelle illisible.', 'paquet');
  await fsp.mkdir(workDir, { recursive: true });
  const mountPoint = path.join(workDir, `mnt-${crypto.randomBytes(4).toString('hex')}`);
  await fsp.mkdir(mountPoint, { recursive: true });
  const newAppPath = path.join(path.dirname(appPath), `.${path.basename(appPath, '.app')}-maj-${version}.app`);
  const oldAppPath = path.join(path.dirname(appPath), `.${path.basename(appPath, '.app')}-ancienne.app`);
  let mounted = false;
  try {
    await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mountPoint, dmg]);
    mounted = true;
    const entries = await fsp.readdir(mountPoint, { withFileTypes: true });
    const apps = entries.filter((e) => e.isDirectory() && e.name.endsWith('.app'));
    if (apps.length !== 1) throw new UpdateError('Image disque de mise à jour inattendue.', 'paquet');
    const src = path.join(mountPoint, apps[0].name);
    const id = await readPlistKey(path.join(src, 'Contents', 'Info.plist'), 'CFBundleIdentifier', run).catch(() => null);
    if (!id || id !== appId) throw new UpdateError('L’app de la mise à jour n’est pas Marginalia : refusée.', 'paquet');
    const v = await readPlistKey(path.join(src, 'Contents', 'Info.plist'), 'CFBundleShortVersionString', run).catch(() => null);
    if (!v || compareVersions(v, version) !== 0) throw new UpdateError('Version de l’app de la mise à jour inattendue : refusée.', 'paquet');
    await fsp.rm(newAppPath, { recursive: true, force: true });
    await run('ditto', [src, newAppPath], { timeout: 600000 });
    const script = buildMacScript({ pid, appPath, newAppPath, oldAppPath, mountPoint, resultFile: path.join(workDir, 'install-result.txt'), relaunch, version });
    const scriptPath = path.join(workDir, 'install-mac.sh');
    await fsp.writeFile(scriptPath, script, { mode: 0o700 });
    return { script, scriptPath, mountPoint, newAppPath, oldAppPath };
  } catch (e) {
    await fsp.rm(newAppPath, { recursive: true, force: true }).catch(() => {});
    if (mounted) await run('hdiutil', ['detach', mountPoint, '-force', '-quiet']).catch(() => {});
    await fsp.rmdir(mountPoint).catch(() => {});
    throw e instanceof UpdateError ? e : new UpdateError(`Préparation de la mise à jour impossible (${e && e.message}).`, 'paquet');
  }
}

module.exports = {
  MAX_UPDATE_SIZE,
  MAX_MANIFEST_SIZE,
  MANIFEST_NAME,
  SIGNATURE_NAME,
  PLATFORM_KEYS,
  UpdateError,
  compareVersions,
  platformKey,
  verifyManifest,
  selectFile,
  githubUrlAllowed,
  httpGet,
  fetchBuffer,
  sha256File,
  verifyFile,
  downloadFile,
  windowsInstallCheck,
  windowsInstallCommand,
  macBundleFromExe,
  checkMacLocation,
  shQuote,
  buildMacScript,
  readPlistKey,
  runCommand,
  prepareMac,
};
