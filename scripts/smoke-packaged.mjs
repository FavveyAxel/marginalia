// Test de démarrage de l'app EMPAQUETÉE par electron-builder (local et GitHub Actions).
// Lance l'exécutable en autotest (--mg-self-test : interface prête, dist/ servi depuis app.asar, rendu PDF,
// aucun plantage), avec les variables de développement et de test posées, qui doivent être ignorées ; puis
// vérifie les fusibles : ELECTRON_RUN_AS_NODE ignoré, --inspect et --remote-debugging-port refusés.
// Code de sortie 0 = OK.
//
// Usage :
//   node scripts/smoke-packaged.mjs                  # détecte l'exécutable dans release/builder/
//   node scripts/smoke-packaged.mjs <exécutable>…    # un ou plusieurs exécutables explicites
// Sous Linux sans écran : DISPLAY=:99 (Xvfb :99 -screen 0 1440x900x24 &).
import { spawn } from 'node:child_process';
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

/** Lance l'exécutable et attend sa fin ; { code, out } (sortie standard et d'erreur mêlées). */
function run(exe, args, env, ms) {
  return new Promise((resolve) => {
    const p = spawn(exe, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (out += c));
    const t = setTimeout(() => {
      out += `\n[délai de ${ms / 1000} s dépassé : arrêt]`;
      try {
        p.kill('SIGKILL');
      } catch {}
    }, ms);
    p.on('error', (e) => {
      clearTimeout(t);
      resolve({ code: -1, out: out + String(e) });
    });
    p.on('exit', (code) => {
      clearTimeout(t);
      resolve({ code, out });
    });
  });
}
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

async function smoke(exe) {
  console.log(`\n── ${path.relative(ROOT, exe)} ──`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-smoke-'));
  const failures = [];
  const label = path.relative(ROOT, exe).split(path.sep).slice(0, 3).join('/');
  const ok = (cond, msg) => {
    console.log((cond ? 'OK     ' : 'ÉCHEC  ') + msg);
    if (!cond) failures.push(msg);
    // Sur GitHub Actions : l'échec apparaît aussi en annotation (lisible sans le journal complet).
    if (!cond && process.env.GITHUB_ACTIONS) console.log(`::error title=Test de démarrage (${label})::${String(msg).replace(/\r?\n/g, ' ')}`);
  };
  const base = process.platform === 'linux' ? ['--no-sandbox'] : [];
  // Les portes de développement et de test sont posées : l'app installée doit les ignorer.
  const hostile = { VITE_DEV_SERVER_URL: 'http://127.0.0.1:9/', MARGINALIA_E2E: '1', MARGINALIA_E2E_UPDATE_PUBKEY: 'x', MARGINALIA_UPDATE_URL: 'http://127.0.0.1:9/' };
  try {
    // 1. Autotest (deux essais : machines Mac de GitHub parfois lentes au premier lancement d'une app non signée).
    let rep = null;
    let last = null;
    for (let attempt = 1; attempt <= 2 && !rep; attempt++) {
      const file = path.join(tmp, `rapport-${attempt}.json`);
      last = await run(exe, [...base, `--mg-self-test=${file}`], hostile, 180_000);
      rep = readJson(file);
      if (!rep) console.log(`       autotest (essai ${attempt}) sans rapport, code ${last.code} :\n${last.out.slice(-3000)}`);
    }
    ok(!!rep, 'autotest : rapport écrit');
    if (rep) {
      ok(rep.packaged, `app.isPackaged (${rep.appPath})`);
      ok(/app\.asar$/.test(rep.appPath || ''), 'code chargé depuis app.asar');
      ok(rep.version === pkg.version, `version ${rep.version} = package.json ${pkg.version}`);
      ok(rep.checks.ui === true, 'interface prête, pont preload window.marginalia');
      ok(String(rep.checks.url || '').startsWith('app://marginalia/'), `page de l'app, pas une adresse imposée (${rep.checks.url})`);
      ok(rep.checks.envClean === true, 'variables MARGINALIA_* et VITE_DEV_SERVER_URL ignorées');
      for (const a of ASSETS) ok(typeof rep.checks.assets?.[a] === 'number' && rep.checks.assets[a] > 0, `app://marginalia/${a} servi (${rep.checks.assets?.[a]} octets)`);
      ok(rep.checks.pdfBytes > 500, `rendu PDF de la fenêtre d'impression (${rep.checks.pdfBytes} octets)`);
      ok(rep.checks.alive === true, 'aucun plantage après 3 s');
      ok(rep.pageErrors.length === 0, `aucune exception non gérée dans le rendu${rep.pageErrors.length ? ' : ' + rep.pageErrors.join(' | ') : ''}`);
      ok(rep.errors.length === 0, `autotest sans erreur${rep.errors.length ? ' : ' + rep.errors.join(' | ') : ''}`);
      for (const m of rep.consoleErrors) {
        console.log('   console.error :', m);
        if (process.env.GITHUB_ACTIONS) console.log(`::warning title=console.error::${m.replace(/\r?\n/g, ' ').slice(0, 400)}`);
      }
    }

    // 2. Fusible RunAsNode : ELECTRON_RUN_AS_NODE ignoré (l'app démarre, ne joue pas les scripts Node).
    const nodeFile = path.join(tmp, 'rapport-node.json');
    const n = await run(exe, ['-e', "console.log('MG_NODE_' + 'MARK')", ...base, `--mg-self-test=${nodeFile}`], { ELECTRON_RUN_AS_NODE: '1' }, 180_000);
    ok(!n.out.includes('MG_NODE_MARK'), 'ELECTRON_RUN_AS_NODE ignoré (aucun script Node exécuté)');

    // 3. Options de débogage : refusées, l'app se ferme sans démarrer.
    for (const flag of ['--remote-debugging-port=0', '--inspect=0']) {
      const f = path.join(tmp, `rapport-debug-${flag.replace(/\W/g, '')}.json`);
      const d = await run(exe, [...base, flag, `--mg-self-test=${f}`], {}, 60_000);
      ok(!fs.existsSync(f) && d.code !== 0, `${flag} refusé (code ${d.code})`);
    }
  } catch (e) {
    ok(false, `exception : ${String(e && e.message).split('\n')[0]}`);
  } finally {
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
