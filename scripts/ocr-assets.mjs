// Copie dans public/ocr/ tout ce qu'il faut pour l'OCR hors ligne (aucun CDN à l'exécution) :
//   worker.min.js                     tesseract.js 7.0.0 (Apache-2.0), node_modules/tesseract.js/dist
//   tesseract-core-simd-lstm.wasm.js  tesseract.js-core 7.0.0 (Apache-2.0), cœur WebAssembly SIMD, LSTM seul
//   lang/fra.traineddata.gz           modèles « best_int » (tessdata_best, Apache-2.0) publiés par
//   lang/eng.traineddata.gz           @tesseract.js-data/fra@1.0.0 et @tesseract.js-data/eng@1.0.0
// Usage : node scripts/ocr-assets.mjs   (télécharge les paquets de langue avec `npm pack`)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public', 'ocr');
fs.mkdirSync(path.join(OUT, 'lang'), { recursive: true });

const copy = (from, to) => {
  fs.copyFileSync(from, path.join(OUT, to));
  console.log(to.padEnd(36), (fs.statSync(from).size / 1048576).toFixed(2), 'Mo');
};
copy(path.join(ROOT, 'node_modules/tesseract.js/dist/worker.min.js'), 'worker.min.js');
copy(path.join(ROOT, 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-lang-'));
for (const lang of ['fra', 'eng']) {
  const r = spawnSync('npm', ['pack', `@tesseract.js-data/${lang}@1.0.0`, '--silent'], { cwd: tmp, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`npm pack ${lang} : ${r.stderr}`);
  const dir = path.join(tmp, lang);
  fs.mkdirSync(dir);
  spawnSync('tar', ['-xzf', path.join(tmp, r.stdout.trim()), '-C', dir]);
  copy(path.join(dir, 'package/4.0.0_best_int', `${lang}.traineddata.gz`), `lang/${lang}.traineddata.gz`);
}
fs.rmSync(tmp, { recursive: true, force: true });
