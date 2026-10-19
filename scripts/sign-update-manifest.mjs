// Manifeste signé des mises à jour automatiques (utilisé par la CI, .github/workflows/release.yml).
//   MARGINALIA_UPDATE_KEY=<clé privée Ed25519, PEM PKCS8> node scripts/sign-update-manifest.mjs <dossier> <version> [--pubkey electron/update-key.cjs]
// Écrit <dossier>/latest.json = { version, files: { "mac-arm64": { name, sha256, size }, … } } pour les
// copies à nom fixe de la Release, et <dossier>/latest.json.sig = signature Ed25519 (base64) des
// octets exacts de latest.json. La clé n'est jamais affichée.
// Clé absente : rien n'est écrit (code 0, avertissement) ; l'app propose alors la page du site.
// Clé qui ne correspond pas à la clé publique de l'app (--pubkey) : rien n'est écrit, avertissement.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const FILES = {
  'mac-arm64': 'Marginalia-mac-arm64.dmg',
  'mac-x64': 'Marginalia-mac-x64.dmg',
  'win-x64': 'Marginalia-win-x64-setup.exe',
  'win-arm64': 'Marginalia-win-arm64-setup.exe',
};

const args = process.argv.slice(2);
const pkIdx = args.indexOf('--pubkey');
const pubkeyFile = pkIdx >= 0 ? args.splice(pkIdx, 2)[1] : null;
const [dir, rawVersion] = args;
if (!dir || !rawVersion) {
  console.error('Usage : node scripts/sign-update-manifest.mjs <dossier> <version> [--pubkey electron/update-key.cjs]');
  process.exit(2);
}
const version = String(rawVersion).replace(/^v/i, '');
if (!/^\d+(\.\d+){0,3}$/.test(version)) {
  console.error(`Version invalide : ${version}`);
  process.exit(2);
}
const pem = process.env.MARGINALIA_UPDATE_KEY || '';
if (!pem.trim()) {
  console.log('::warning::Secret MARGINALIA_UPDATE_KEY absent : Release sans manifeste signé (pas de mise à jour automatique).');
  process.exit(0);
}
let key;
try {
  key = crypto.createPrivateKey(pem);
} catch {
  console.log('::warning::Secret MARGINALIA_UPDATE_KEY illisible (PEM PKCS8 attendu) : Release sans manifeste signé.');
  process.exit(0);
}
if (key.asymmetricKeyType !== 'ed25519') {
  console.log('::warning::Secret MARGINALIA_UPDATE_KEY : clé Ed25519 attendue. Release sans manifeste signé.');
  process.exit(0);
}
const pub = crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString();
if (pubkeyFile) {
  const embedded = createRequire(import.meta.url)(path.resolve(pubkeyFile));
  if (crypto.createPublicKey(embedded).export({ type: 'spki', format: 'der' }).toString('base64') !== crypto.createPublicKey(pub).export({ type: 'spki', format: 'der' }).toString('base64')) {
    console.log('::warning::La clé MARGINALIA_UPDATE_KEY ne correspond pas à la clé publique de l’app : Release sans manifeste signé.');
    process.exit(0);
  }
}

const files = {};
for (const [k, name] of Object.entries(FILES)) {
  const f = path.join(dir, name);
  if (!fs.existsSync(f)) {
    console.error(`Fichier manquant : ${name}`);
    process.exit(1);
  }
  const buf = fs.readFileSync(f);
  files[k] = { name, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
}
const manifest = Buffer.from(JSON.stringify({ version, files }, null, 2) + '\n', 'utf8');
const sig = crypto.sign(null, manifest, key).toString('base64');
// Contrôle : la signature se vérifie avec la clé publique.
if (!crypto.verify(null, manifest, crypto.createPublicKey(pub), Buffer.from(sig, 'base64'))) {
  console.error('Signature invalide (contrôle).');
  process.exit(1);
}
fs.writeFileSync(path.join(dir, 'latest.json'), manifest);
fs.writeFileSync(path.join(dir, 'latest.json.sig'), sig + '\n');
console.log(manifest.toString('utf8'));
console.log('Manifeste signé : latest.json, latest.json.sig');
