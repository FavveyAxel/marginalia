// L'app Electron (build de production, protocole app://) charge-t-elle l'OCR hors ligne ?
// Prérequis : dist/ construit (npm run package, ou npx vite build). Linux : lancer sous Xvfb :
//   xvfb-run -a timeout 300 node scripts/test-electron-ocr.mjs
// APP_DIR=<dossier> : lance ce dossier d'app au lieu du projet, par exemple le contenu empaqueté
//   APP_DIR=release/Marginalia-darwin-arm64/Marginalia.app/Contents/Resources/app
// Dossier de données isolé (XDG_CONFIG_HOME temporaire) ; l'image est passée en argument de
// lancement, comme un fichier ouvert depuis le Finder : l'app l'importe et l'ouvre.
import { _electron as electron } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APP_DIR = path.resolve(ROOT, process.env.APP_DIR || '.');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'marg-electron-'));
let failed = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${extra !== '' ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};

if (!fs.existsSync(path.join(APP_DIR, 'dist/index.html')) || !fs.existsSync(path.join(APP_DIR, 'dist/ocr/worker.min.js'))) {
  console.error('dist/ absent ou sans données OCR : lancer d’abord `npm run package` ou `npx vite build`.');
  process.exit(2);
}

const IMG = path.join(TMP, 'page-photographiee.jpg');
const gen = spawnSync('python3', ['-I', path.join(ROOT, 'scripts/make-image-fixture.py'), IMG, path.join(TMP, 'verite.txt')], { encoding: 'utf8' });
if (gen.status !== 0) throw new Error('fixture : ' + gen.stderr);

const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', APP_DIR, IMG],
  env: { ...process.env, XDG_CONFIG_HOME: TMP, VITE_DEV_SERVER_URL: '' },
  timeout: 60000,
});
const requests = [];
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.context().on('request', (r) => requests.push(r.url()));
  console.log('app :', path.relative(ROOT, APP_DIR) || '.');
  ok(page.url().startsWith('app://marginalia/'), 'page servie par app://', page.url());

  const t0 = Date.now();
  await page.waitForSelector('.img-picture', { timeout: 60000 });
  ok(true, 'image importée (argument de lancement) et ouverte', `${Date.now() - t0} ms`);
  await page.waitForSelector('[data-testid="img-ocr-offer"]', { timeout: 15000 });
  await page.click('[data-testid="img-ocr-offer"] button');
  const chip = await page.waitForSelector('.img-ocr-pct', { timeout: 15000 }).catch(() => null);
  ok(!!chip, 'progression de la reconnaissance visible');
  await page.waitForFunction(() => document.querySelectorAll('.img-text span[data-i]').length > 200, null, { timeout: 180000 });
  ok(true, 'texte reconnu sous app:// (worker, cœur WebAssembly, modèles fra + eng)', `${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const lib = path.join(TMP, 'Marginalia', 'library');
  const dirs = fs.existsSync(lib) ? fs.readdirSync(lib) : [];
  const ocrFile = dirs.map((d) => path.join(lib, d, 'ocr.json')).find((f) => fs.existsSync(f));
  const ocr = ocrFile ? JSON.parse(fs.readFileSync(ocrFile, 'utf8')) : null;
  const words = ocr ? ocr.paras.flatMap((p) => p.lines.flatMap((l) => l.words)) : [];
  ok(!!ocr && words.length > 200, 'ocr.json écrit dans la bibliothèque', ocr ? `${words.length} mots, ${ocr.engine}, ${ocr.langs}, ${ocr.ms} ms` : 'absent');

  const own = [...new Set(requests)].filter((u) => /\/ocr\//.test(u));
  // (Le script du worker lui-même n'est pas signalé par Playwright ; le cœur et les modèles, chargés
  //  PAR le worker, prouvent qu'il tourne.)
  ok(
    own.some((u) => u.startsWith('app://marginalia/ocr/tesseract-core-simd-lstm.wasm.js')) && own.some((u) => u.startsWith('app://marginalia/ocr/lang/fra.traineddata.gz')),
    'cœur WebAssembly et modèles chargés par le worker depuis app://',
    own.map((u) => u.replace('app://marginalia/', '')).join(', '),
  );
  const external = [...new Set(requests)].filter((u) => !/^(app|blob|data|devtools|chrome-extension):/.test(u));
  ok(external.length === 0, 'aucune requête réseau', external.slice(0, 3).join(' '));
  ok(errors.length === 0, 'aucune erreur dans la page', errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: path.join(TMP, 'electron.png') });
  fs.mkdirSync(path.join(ROOT, 'shots/image'), { recursive: true });
  fs.copyFileSync(path.join(TMP, 'electron.png'), path.join(ROOT, 'shots/image/20-electron-app.png'));
  console.log('capture: shots/image/20-electron-app.png');
} finally {
  await app.close().catch(() => undefined);
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} ÉCHEC(S)` : '\nTOUS LES TESTS PASSENT');
process.exit(failed ? 1 : 0);
