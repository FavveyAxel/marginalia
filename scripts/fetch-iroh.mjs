// Récupère le module natif iroh (collaboration par Internet, electron/collab-iroh.cjs) pour chaque
// système visé et le range dans electron/native/<os>-<arch>/iroh.node, que l'app empaquetée charge.
// electron-builder n'embarque que le dossier du système et du processeur fabriqués (voir package.json).
// Pas de binaire publié pour les Mac Intel : ces Mac gardent la collaboration sur le même Wi-Fi.
//
// Intégrité : chaque binaire est comparé à son empreinte SHA-256 épinglée ci-dessous (PINS) pour la version
// exacte installée. Une autre version, ou un binaire différent (paquet republié ou compromis en amont),
// arrête la fabrication. Changer de version : vérifier les nouveaux binaires, puis mettre à jour PINS.
//
// Usage : node scripts/fetch-iroh.mjs mac-arm64 win-x64 win-arm64   (sans argument : ce système-ci)
import crypto from 'node:crypto';
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
/** Empreintes SHA-256 des modules natifs, par version de @number0/iroh. */
const PINS = {
  '1.1.0': {
    'mac-arm64': '3d8b1c05a9994e9d36b2693e3af832ed9cd113d64ac0eaf4d7d082f2a5d1aef8',
    'win-x64': '4fef61d33fc9a903a21cb1a2ae154b1e9576e8e453343b295d7d4d387e44bbe1',
    'win-arm64': '5d651bb3cc3a53c08bfb5c2d567d54b7e7367771df4d7c3b0d781654c225aa5a',
    'linux-x64': 'd660aa1abbc2b65b99a970e8da094339256725078b75ed1201b49e0b0acbda55',
  },
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
  const pin = PINS[VERSION]?.[target];
  const sha = crypto.createHash('sha256').update(bin).digest('hex');
  if (!pin) {
    console.error(`${target} : pas d'empreinte épinglée pour iroh ${VERSION} (scripts/fetch-iroh.mjs, PINS) — ${sha}`);
    failed = true;
    continue;
  }
  if (sha !== pin) {
    console.error(`${target} : empreinte inattendue pour iroh ${VERSION} : ${sha} (attendue ${pin}). Module refusé.`);
    failed = true;
    continue;
  }
  const dir = path.join(ROOT, 'electron', 'native', target);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'iroh.node'), bin);
  console.log(`${target} : iroh ${VERSION} (${(bin.length / 1e6).toFixed(1)} Mo, empreinte vérifiée) → electron/native/${target}/iroh.node`);
}
process.exit(failed ? 1 : 0);
