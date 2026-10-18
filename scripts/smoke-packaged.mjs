// Test de démarrage de l'app EMPAQUETÉE par electron-builder (local et GitHub Actions).
// Lance l'exécutable, attend que l'interface soit prête, vérifie que dist/ est bien servi
// depuis app.asar (index, OCR, pdf.js), puis ferme l'app. Code de sortie 0 = OK.
//
// Usage :
//   node scripts/smoke-packaged.mjs                  # détecte l'exécutable dans release/builder/
//   node scripts/smoke-packaged.mjs <exécutable>…    # un ou plusieurs exécutables explicites
// Sous Linux sans écran : DISPLAY=:99 (Xvfb :99 -screen 0 1440x900x24 &).
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'release', 'builder');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const NAME = pkg.build?.productName || pkg.productName || 'Marginalia';

/** Exécutables plausibles pour l'OS courant (sorties « unpacked » d'electron-builder). */
function detect() {
  const c = [];
  if (process.platform === 'darwin') {
    for (const d of ['mac-arm64', 'mac', 'mac-universal']) c.push(path.join(OUT, d, `${NAME}.app`, 'Contents', 'MacOS', NAME));
  } else if (process.platform === 'win32') {
    for (const d of ['win-unpacked', 'win-arm64-unpacked']) c.push(path.join(OUT, d, `${NAME}.exe`));
  } else {
    for (const d of ['linux-unpacked', 'linux-arm64-unpacked']) c.push(path.join(OUT, d, pkg.name));
  }
  return c.filter((p) => fs.existsSync(p));
}

const ASSETS = [
  'index.html',
  'ocr/worker.min.js',
  'ocr/tesseract-core-simd-lstm.wasm.js',
  'ocr/lang/fra.traineddata.gz',
  'ocr/lang/eng.traineddata.gz',
  'pdfjs/cmaps/78-H.bcmap',
];

async function smoke(exe) {
  console.log(`\n── ${path.relative(ROOT, exe)} ──`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-smoke-'));
  const failures = [];
  const ok = (cond, msg) => {
    console.log((cond ? 'OK     ' : 'ÉCHEC  ') + msg);
    if (!cond) failures.push(msg);
    // Sur GitHub Actions : l'échec apparaît aussi en annotation (lisible sans le journal complet).
    if (!cond && process.env.GITHUB_ACTIONS) console.log(`::error title=Test de démarrage (${process.platform} ${process.arch})::${String(msg).replace(/\r?\n/g, ' ')}`);
  };
  const args = process.platform === 'linux' ? ['--no-sandbox'] : [];
  // Lancement : une seconde tentative si le premier échoue (machines Mac de GitHub parfois lentes au
  // premier démarrage d'une app non signée) ; l'erreur est toujours affichée.
  let app = null;
  for (let attempt = 1; attempt <= 2 && !app; attempt++) {
    try {
      app = await electron.launch({
        executablePath: exe,
        args,
        // MARGINALIA_E2E=1 : le rendu expose son store (window.__store), déjà utilisé par les tests e2e.
        env: { ...process.env, MARGINALIA_E2E: '1', VITE_DEV_SERVER_URL: '', XDG_CONFIG_HOME: tmp },
        timeout: 120_000,
      });
    } catch (e) {
      const full = String(e && e.message);
      console.log(`       lancement (essai ${attempt}) :\n${full}`);
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Lancement essai ${attempt} (${process.platform} ${process.arch})::${full.replace(/\r?\n/g, ' ⏎ ').slice(0, 3000)}`);
      if (attempt === 2) ok(false, `lancement : ${full.split('\n')[0]}`);
      else {
        // Une instance restée ouverte bloquerait la suivante (instance unique) : on la ferme.
        try {
          const { execSync } = await import('node:child_process');
          if (process.platform === 'win32') execSync(`taskkill /F /IM "${path.basename(exe)}"`, { stdio: 'ignore' });
          else execSync(`pkill -f ${JSON.stringify(exe)}`, { stdio: 'ignore' });
        } catch {}
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  if (!app) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return failures;
  }
  let crashed = null;
  try {
    const info = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, appPath: app.getAppPath() }));
    ok(info.packaged, `app.isPackaged (${info.appPath})`);
    ok(/app\.asar$/.test(info.appPath), 'code chargé depuis app.asar');
    ok(info.version === pkg.version, `version ${info.version} = package.json ${pkg.version}`);

    const page = await app.firstWindow({ timeout: 60_000 });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      console.log('   console.error :', m.text());
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=console.error::${m.text().replace(/\r?\n/g, ' ').slice(0, 400)}`);
    });
    page.on('crash', () => (crashed = 'renderer'));
    app.on('close', () => (crashed ??= 'app fermée'));

    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60_000 });
    ok(true, `interface prête (${page.url()})`);
    ok(await page.evaluate(() => typeof window.marginalia === 'object' && window.marginalia.kind === 'electron'), 'pont preload window.marginalia');
    ok(await page.locator('.app').first().isVisible(), 'conteneur .app visible');

    const served = await page.evaluate(async (list) => {
      const out = {};
      for (const a of list) {
        try {
          const r = await fetch(`app://marginalia/${a}`);
          out[a] = r.ok ? (await r.arrayBuffer()).byteLength : -r.status;
        } catch (e) {
          out[a] = String(e);
        }
      }
      return out;
    }, ASSETS);
    for (const a of ASSETS) ok(typeof served[a] === 'number' && served[a] > 0, `app://marginalia/${a} servi (${served[a]} octets)`);

    // Quelques secondes de vie : rien ne doit planter.
    await page.waitForTimeout(3000);
    ok(!crashed, 'aucun plantage après 3 s');
    ok(pageErrors.length === 0, `aucune exception non gérée dans le rendu${pageErrors.length ? ' : ' + pageErrors.join(' | ') : ''}`);
    if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SMOKE_SCREENSHOT });
  } catch (e) {
    ok(false, `exception : ${e.message.split('\n')[0]}`);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return failures;
}

const exes = process.argv.slice(2).length ? process.argv.slice(2).map((p) => path.resolve(p)) : detect();
if (!exes.length) {
  console.error(`Aucun exécutable trouvé dans ${path.relative(ROOT, OUT)}/ — lancez d'abord electron-builder (npm run dist:dir).`);
  process.exit(2);
}
let failed = 0;
for (const exe of exes) {
  if (!fs.existsSync(exe)) {
    console.error(`Introuvable : ${exe}`);
    failed++;
    continue;
  }
  const f = await smoke(exe);
  if (f.length) failed++;
}
console.log(failed ? `\n${failed} exécutable(s) en échec.` : '\nTest de démarrage réussi.');
process.exit(failed ? 1 : 0);
