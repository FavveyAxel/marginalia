// Récupère le module natif iroh (collaboration par Internet, electron/collab-iroh.cjs) pour chaque
// système visé et le range dans electron/native/<os>-<arch>/iroh.node, que l'app empaquetée charge.
// electron-builder n'embarque que le dossier du système et du processeur fabriqués (voir package.json).
// Pas de binaire publié pour les Mac Intel : ces Mac gardent la collaboration sur le même Wi-Fi.
//
// Usage : node scripts/fetch-iroh.mjs mac-arm64 win-x64 win-arm64   (sans argument : ce système-ci)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const require = createRequire(import.meta.url);
const VERSION = require(path.join(ROOT, 'node_modules/@number0/iroh/package.json')).version;
const PKG = {
  'mac-arm64': 'darwin-arm64',
  'win-x64': 'win32-x64-msvc',
  'win-arm64': 'win32-arm64-msvc',
  'linux-x64': 'linux-x64-gnu',
  'linux-arm64': 'linux-arm64-gnu',
};
const here = `${{ darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform]}-${process.arch}`;
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : [here];

/** Lit une archive .tgz (format tar ustar) et renvoie le contenu du fichier dont le nom finit par `suffix`. */
function fromTgz(tgz, suffix) {
  const tar = zlib.gunzipSync(fs.readFileSync(tgz));
  for (let off = 0; off + 512 <= tar.length; ) {
    const name = tar.subarray(off, off + 100).toString('utf8').replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(tar.subarray(off + 124, off + 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    const start = off + 512;
    if (name.endsWith(suffix)) return tar.subarray(start, start + size);
    off = start + Math.ceil(size / 512) * 512;
  }
  return null;
}

let failed = false;
for (const target of wanted) {
  const p = PKG[target];
  if (!p) {
    console.log(`${target} : pas de module iroh publié (collaboration sur le même Wi-Fi seulement).`);
    continue;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iroh-'));
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', `@number0/iroh-${p}@${VERSION}`, '--silent', '--pack-destination', tmp], { encoding: 'utf8', shell: process.platform === 'win32' });
  const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
  const bin = r.status === 0 && tgz ? fromTgz(path.join(tmp, tgz), `iroh.${p}.node`) : null;
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!bin || bin.length < 1_000_000) {
    console.error(`${target} : module iroh introuvable (${r.stderr || r.error || 'archive vide'})`);
    failed = true;
    continue;
  }
  const dir = path.join(ROOT, 'electron', 'native', target);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'iroh.node'), bin);
  console.log(`${target} : iroh ${VERSION} (${(bin.length / 1e6).toFixed(1)} Mo) → electron/native/${target}/iroh.node`);
}
process.exit(failed ? 1 : 0);
