// Banc de mesure des performances (démarrage, ouverture d'un livre, d'un écrit, de la carte, frappe,
// sauvegarde avec une grosse base, vues lourdes, ⌘K, mémoire). Reproductible : base générée.
//
// Lancer (Linux sans écran : DISPLAY=:99, Xvfb :99 -screen 0 1440x900x24 &) :
//   npm run build && node scripts/bench.mjs [--dist=dist] [--runs=5] [--json=out.json] [--skip-browser]
//
// L'app Electron est lancée depuis une copie (package.json + electron/ + dist/) dans un dossier temporaire,
// avec MARGINALIA_E2E=1 (store exposé) et un profil neuf (XDG_CONFIG_HOME). La base générée contient
// 50 livres (EPUB de fixtures/), 5000 extraits, 200 écrits (.docx de fixtures/), 100 concepts,
// 50 cartes de livre (30 cartes chacune) et 10 cartes libres.
// Chromium : sert le même dist/ (serveur statique), base vide (IndexedDB), mesure le démarrage.
import { _electron as electron, chromium } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const arg = (k, d) => (ARGS.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const DIST = path.resolve(ROOT, arg('dist', 'dist'));
const RUNS = Number(arg('runs', 5));
const JSON_OUT = arg('json', '');
const SKIP_BROWSER = ARGS.includes('--skip-browser');
// --profile=editeur,cmdk,sauvegarde,extraits : profil CPU (fonctions les plus coûteuses) de ces étapes
// (utile avec un dist non minifié : npx vite build --minify false --outDir /tmp/dist-nomin).
const PROFILE = new Set(arg('profile', '').split(',').filter(Boolean));
const ELECTRON = path.join(ROOT, 'node_modules/electron/dist/electron');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-bench-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
const results = {};
const record = (k, v) => (results[k] ??= []).push(Math.round(v * 10) / 10);

// ── Copie de l'app à mesurer ─────────────────────────────────
const APP = path.join(TMP, 'app');
fs.mkdirSync(APP);
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(APP, 'package.json'));
fs.cpSync(path.join(ROOT, 'electron'), path.join(APP, 'electron'), { recursive: true });
fs.cpSync(DIST, path.join(APP, 'dist'), { recursive: true });
const distKb = (re) =>
  Math.round(
    fs
      .readdirSync(path.join(DIST, 'assets'))
      .filter((f) => re.test(f))
      .reduce((n, f) => n + fs.statSync(path.join(DIST, 'assets', f)).size, 0) / 1024,
  );
const indexHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const entry = indexHtml.match(/src="\.\/assets\/([^"]+\.js)"/)?.[1];
const entryKb = entry ? Math.round(fs.statSync(path.join(DIST, 'assets', entry)).size / 1024) : NaN;
const preloadKb = [...indexHtml.matchAll(/modulepreload"[^>]*href="\.\/assets\/([^"]+)"/g)].reduce((n, m) => n + fs.statSync(path.join(DIST, 'assets', m[1])).size / 1024, 0);

async function launch(profile, extraArgs = []) {
  const t0 = performance.now();
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: ['--no-sandbox', '--js-flags=--expose-gc', ...extraArgs, APP],
    env: { ...process.env, MARGINALIA_E2E: '1', VITE_DEV_SERVER_URL: '', XDG_CONFIG_HOME: profile },
    timeout: 90_000,
  });
  const page = await app.firstWindow({ timeout: 60_000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => window.__store && window.__store.getState().ready && document.querySelector('.app .sidebar') && document.querySelector('main.main > *'), null, { timeout: 60_000, polling: 16 });
  const tReady = performance.now() - t0;
  const inPage = await page.evaluate(() => performance.now());
  return { app, page, errors, tReady, inPage };
}

// ── Profil de référence : un livre importé par l'app, puis base générée ──
async function seedProfile() {
  const base = path.join(TMP, 'seed');
  fs.mkdirSync(base);
  const { app, page } = await launch(base);
  const epub = fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')).toString('base64');
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.__store.getState().importFiles([{ name: 'discours.epub', data: bin.buffer }], { asBook: true });
  }, epub);
  await sleep(2500);
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  await app.close();
  const db = JSON.parse(fs.readFileSync(path.join(userData, 'db.json'), 'utf8'));
  const book0 = db.books[0];
  const lib = path.join(userData, 'library');
  const docx = fs.readFileSync(path.join(ROOT, 'fixtures/discours.docx'));
  const now = Date.now();
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const WORDS = 'raison méthode doute vérité esprit jugement certitude connaissance nature âme corps substance pensée liberté volonté évidence idée Dieu monde science morale sens perception erreur'.split(' ');
  const phrase = (n) => Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(' ');
  const CATS = ['probleme', 'these', 'argument', 'objection', 'concept', 'exemple', null];
  db.books = [];
  for (let i = 0; i < 50; i++) {
    const id = `bk${String(i).padStart(3, '0')}`;
    fs.cpSync(path.join(lib, book0.id), path.join(lib, id), { recursive: true });
    db.books.push({ ...book0, id, title: `${book0.title} — ${i + 1} ${phrase(2)}`, author: `Auteur ${i % 17}`, addedAt: now - i * 3600_000, lastOpenedAt: i < 10 ? now - i * 60_000 : null });
  }
  db.concepts = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, name: `${phrase(1)} ${i}`, definition: phrase(25), senses: [], links: [], programme: null, createdAt: now, updatedAt: now }));
  db.highlights = Array.from({ length: 5000 }, (_, i) => {
    const cat = CATS[i % CATS.length];
    const start = 50 + (i % 40) * 120;
    return {
      id: `h${i}`,
      bookId: db.books[i % 50].id,
      category: cat,
      plain: cat ? undefined : true,
      text: phrase(12 + (i % 30)),
      note: i % 3 ? '' : phrase(15),
      noteKind: null,
      conceptIds: i % 5 ? [] : [`c${i % 100}`],
      anchor: { kind: 'html', chapter: 1 + (i % 4), start, end: start + 60, prefix: '', suffix: '' },
      locationLabel: 'Première partie',
      printedPage: String(1 + (i % 300)),
      createdAt: now - i * 1000,
      updatedAt: now - i * 1000,
    };
  });
  db.drafts = [];
  for (let i = 0; i < 200; i++) {
    const id = `dr${String(i).padStart(3, '0')}`;
    fs.mkdirSync(path.join(lib, id), { recursive: true });
    fs.writeFileSync(path.join(lib, id, 'document.docx'), docx);
    db.drafts.push({ id, title: `Dissertation ${i + 1} : ${phrase(4)}`, fileName: 'document.docx', externalPath: null, wordCount: 2500, template: null, createdAt: now - i * 5000, updatedAt: now - i * 5000 });
  }
  db.maps = {};
  db.books.forEach((b, bi) => {
    const hs = db.highlights.filter((h) => h.bookId === b.id).slice(0, 30);
    const nodes = hs.map((h, k) => ({ id: `n${bi}-${k}`, highlightId: h.id, text: '', x: (k % 6) * 320, y: Math.floor(k / 6) * 220 }));
    const edges = nodes.slice(1).map((n, k) => ({ id: `e${bi}-${k}`, source: n.id, target: nodes[Math.floor(k / 3)].id, relation: ['soutient', 'objecte', 'precise', 'illustre'][k % 4], groupId: null }));
    db.maps[b.id] = { bookId: b.id, nodes, edges, viewport: null };
  });
  for (let i = 0; i < 10; i++) {
    const id = `board${i}`;
    const nodes = Array.from({ length: 40 }, (_, k) => ({ id: `bn${i}-${k}`, highlightId: k % 2 ? `h${i * 40 + k}` : null, text: k % 2 ? '' : phrase(10), x: (k % 8) * 300, y: Math.floor(k / 8) * 200 }));
    db.maps[id] = { id, kind: 'board', title: `Carte libre ${i}`, bookId: '', bookIds: [], nodes, edges: [], viewport: null, createdAt: now, updatedAt: now };
  }
  db.activity = [];
  fs.writeFileSync(path.join(userData, 'db.json'), JSON.stringify(db));
  return { base, userData, dbBytes: fs.statSync(path.join(userData, 'db.json')).size };
}

function freshProfile(seedDir) {
  const p = fs.mkdtempSync(path.join(TMP, 'run-'));
  fs.cpSync(seedDir, p, { recursive: true });
  return p;
}

async function profiled(page, label, fn) {
  if (!PROFILE.has(label)) return fn();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  try {
    return await fn();
  } finally {
    const { profile } = await cdp.send('Profiler.stop');
    await cdp.detach();
    const self = new Map();
    const dt = profile.timeDeltas;
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const counts = new Map();
    profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)));
    for (const [id, us] of counts) {
      const n = byId.get(id);
      const f = n.callFrame;
      const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
      self.set(k, (self.get(k) ?? 0) + us / 1000);
    }
    console.log(`   profil ${label} :`);
    const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25);
    for (const [k, ms] of top) console.log(`     ${ms.toFixed(1).padStart(8)} ms  ${k}`);
    // Chaînes d'appel des fonctions JS les plus coûteuses (hors natif).
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const name = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    for (const [k] of top.filter(([k]) => !/^\((program|idle|garbage collector)\)/.test(k)).slice(0, Number(process.env.BENCH_CHAINS || 3))) {
      const chains = new Map();
      for (const [id, us] of counts) {
        const n = byId.get(id);
        if (name(n) !== k) continue;
        const chain = [];
        let p = parent.get(id);
        while (p && chain.length < Number(process.env.BENCH_DEPTH || 9)) {
          const pn = byId.get(p);
          if (pn.callFrame.url) chain.push(name(pn));
          p = parent.get(p);
        }
        const ck = chain.join(' < ');
        chains.set(ck, (chains.get(ck) ?? 0) + us / 1000);
      }
      console.log(`     ← ${k}`);
      for (const [c, ms] of [...chains].sort((a, b) => b[1] - a[1]).slice(0, 3)) console.log(`         ${ms.toFixed(0)} ms : ${c}`);
    }
  }
}

async function longTasks(page, fn, settleMs = 0, label = '') {
  if (label) return profiled(page, label, () => longTasks(page, fn, settleMs));
  await page.evaluate(() => {
    window.__lt = [];
    window.__ltObs?.disconnect();
    window.__ltObs = new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration)));
    window.__ltObs.observe({ type: 'longtask' });
  });
  const t0 = performance.now();
  await fn();
  const dt = performance.now() - t0;
  if (settleMs) await sleep(settleMs);
  const lt = await page.evaluate(() => window.__lt);
  return { dt, ltSum: lt.reduce((a, b) => a + b, 0), ltMax: lt.length ? Math.max(...lt) : 0 };
}

async function heap(page) {
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => (window.gc ? (window.gc(), window.gc()) : null));
  await sleep(300);
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  await cdp.detach();
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { heapMb: m.JSHeapUsedSize / 1048576, nodes: m.Nodes, listeners: m.JSEventListeners, docs: m.Documents };
}

async function electronRun(seedDir, dbJsonPath, run) {
  const profile = freshProfile(seedDir);
  const dbFile = path.join(profile, path.relative(seedDir, dbJsonPath));
  const { app, page, errors, tReady, inPage } = await launch(profile);
  try {
    record('electron.demarrage_ms (lancement → interface prête, grosse base)', tReady);
    record('electron.demarrage_rendu_ms (navigation → interface prête)', inPage);
    // Lecture de la base par le pont (IPC) : coût de loadDb au démarrage, comparé au JSON.parse du même texte.
    const io = await page.evaluate(async () => {
      let t = performance.now();
      const db = await window.marginalia.loadDb();
      const ipc = performance.now() - t;
      const json = JSON.stringify(db);
      t = performance.now();
      JSON.parse(json);
      return { ipc, parse: performance.now() - t };
    });
    record('electron.loadDb_ipc_ms', io.ipc);
    record('electron.json_parse_meme_base_ms', io.parse);
    await sleep(1500); // laisser passer la sauvegarde initiale et les préchargements éventuels
    // Compteur de workers vivants (instrumentation posée après le démarrage)
    await page.evaluate(() => {
      const W = window.Worker;
      window.__workers = new Set();
      window.Worker = class extends W {
        constructor(...a) {
          super(...a);
          window.__workers.add(this);
          const t = this.terminate.bind(this);
          this.terminate = () => (window.__workers.delete(this), t());
        }
      };
    });

    // Vues lourdes
    for (const [name, route, sel] of [
      ['bibliotheque', { name: 'library' }, '.main .lib-card:not(.lib-skeleton), .main .lib-row'],
      ['extraits', { name: 'extracts' }, '.main .ax-item'],
      ['ecrits', { name: 'write', draftId: null }, '.main [data-draft]'],
    ]) {
      let found = true;
      const r = await longTasks(page, async () => {
        await page.evaluate((r) => window.__store.getState().navigate(r), route);
        await page.waitForSelector(sel, { timeout: 20000 }).catch(() => (found = false));
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      });
      record(`vue.${name}_ms`, found ? r.dt : NaN);
      record(`vue.${name}_noeuds_dom`, await page.evaluate(() => document.querySelectorAll('*').length));
      await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
      await sleep(300);
    }

    // ⌘K : ouverture puis frappe d'une requête courte (beaucoup de résultats) et longue
    {
      const r = await longTasks(page, async () => {
        await page.evaluate(() => window.__store.getState().setCommandOpen(true));
        await page.waitForSelector('.cmd-input');
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      });
      record('cmdk.ouverture_ms', r.dt);
      const q = await longTasks(
        page,
        async () => {
          for (const ch of 'raison') {
            await page.keyboard.type(ch);
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          }
        },
        0,
        'cmdk',
      );
      record('cmdk.frappe_6_car_ms', q.dt);
      record('cmdk.taches_longues_ms', q.ltSum);
      await page.keyboard.press('Escape');
    }

    const h0 = await heap(page);
    if (run === 0) record('memoire.depart_tas_mo', h0.heapMb);

    // Ouverture d'un livre (EPUB)
    {
      const r = await longTasks(page, async () => {
        await page.evaluate(() => window.__store.getState().openBook('bk001'));
        await page.waitForSelector('.html-doc p', { timeout: 30000 });
      });
      record('ouverture.livre_ms', r.dt);
    }
    // Carte du livre
    {
      const r = await longTasks(page, async () => {
        await page.evaluate(() => window.__store.setState({ route: { name: 'reader', bookId: 'bk001', tab: 'carte', splitBookId: null } }));
        await page.waitForSelector('[data-testid=map-root] .react-flow__node', { timeout: 30000 });
      });
      record('ouverture.carte_ms', r.dt);
    }
    await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
    await sleep(300);
    // Écrit
    {
      const r = await longTasks(page, async () => {
        await page.evaluate(() => window.__store.getState().navigate({ name: 'write', draftId: 'dr003' }));
        await page.waitForSelector('.ed-engine-in', { timeout: 60000 });
      });
      record('ouverture.ecrit_ms', r.dt);
      await sleep(1200);
      // Frappe : 120 caractères au milieu du document
      await page.evaluate(() => {
        const el = document.querySelector('.ed-engine-in [contenteditable="true"], .ed-engine-in .ProseMirror') || document.querySelector('[contenteditable="true"]');
        el?.focus();
      });
      await page.keyboard.press('End');
      const txt = ' Le bon sens est la chose du monde la mieux partagée, car chacun pense en être si bien pourvu que ceux même qui';
      const t = await longTasks(
        page,
        async () => {
          await page.keyboard.type(txt);
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        },
        2500,
        'editeur',
      );
      record('editeur.frappe_par_car_ms', t.dt / txt.length);
      record('editeur.taches_longues_frappe+2.5s_ms', t.ltSum);
      record('editeur.tache_longue_max_ms', t.ltMax);
    }
    await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
    await sleep(500);

    // Sauvegarde avec grosse base : modification d'une note d'extrait, attente de l'écriture disque.
    {
      const sizes = [];
      const stable = async () => {
        let m = fs.statSync(dbFile).mtimeMs;
        for (let t = 0; t < 40; t++) {
          await sleep(250);
          const m2 = fs.statSync(dbFile).mtimeMs;
          if (m2 === m && t >= 3) return;
          m = m2;
        }
      };
      for (let k = 0; k < 4; k++) {
        await stable();
        const m0 = fs.statSync(dbFile).mtimeMs;
        const r = await longTasks(
          page,
          async () => {
            await page.evaluate((k) => window.__store.getState().updateHighlight(`h${10 + k}`, { note: 'note de mesure ' + k + ' ' + Date.now() }), k);
            const t0 = Date.now();
            while (fs.statSync(dbFile).mtimeMs === m0 && Date.now() - t0 < 8000) await sleep(5);
          },
          600,
          k === 1 ? 'sauvegarde' : '',
        );
        record('sauvegarde.modif→disque_ms', r.dt);
        record('sauvegarde.blocage_rendu_ms (tâches longues)', r.ltSum);
        sizes.push(fs.statSync(dbFile).size);
      }
      if (run === 0) record('sauvegarde.taille_base_ko', sizes.at(-1) / 1024);
      // Rafale : 30 modifications espacées de 50 ms (saisie dans une note)
      const r = await longTasks(
        page,
        async () => {
          for (let k = 0; k < 30; k++) {
            await page.evaluate((k) => window.__store.getState().updateHighlight('h42', { note: 'saisie '.repeat(1 + k) }), k);
            await sleep(50);
          }
        },
        2500,
        'rafale',
      );
      record('sauvegarde.rafale30_blocage_ms', r.ltSum);
    }

    // Mémoire : 4 ouvertures/fermetures de livre, puis 4 d'écrit (retour à l'accueil entre deux)
    {
      const home = async () => {
        await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
        await sleep(300);
      };
      const delta = async (label, b) => {
        await sleep(1500);
        const a = await heap(page);
        record(`memoire.${label}.tas_delta_mo`, a.heapMb - b.heapMb);
        record(`memoire.${label}.noeuds_dom_delta`, a.nodes - b.nodes);
        record(`memoire.${label}.ecouteurs_delta`, a.listeners - b.listeners);
        record(`memoire.${label}.workers_vivants`, await page.evaluate(() => window.__workers.size));
        return a;
      };
      let b = await heap(page);
      for (let k = 0; k < 4; k++) {
        await page.evaluate((k) => window.__store.getState().openBook(`bk00${k + 2}`), k);
        await page.waitForSelector('.html-doc p', { timeout: 30000 });
        await sleep(400);
        await home();
      }
      b = await delta('4_livres', b);
      for (let k = 0; k < 4; k++) {
        await page.evaluate((k) => window.__store.getState().navigate({ name: 'write', draftId: `dr01${k}` }), k);
        await page.waitForSelector('.ed-engine-in', { timeout: 60000 });
        await sleep(600);
        await home();
      }
      await delta('4_ecrits', b);
    }
    if (errors.length) console.log('   exceptions rendu :', [...new Set(errors)].join(' | '));
  } finally {
    await app.close().catch(() => {});
  }
}

// ── Chromium : dist/ servi statiquement, base vide ───────────
function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      const idx = path.join(dir, 'index.html');
      res.writeHead(fs.existsSync(p) ? 200 : 404, { 'content-type': 'text/html' });
      return res.end(fs.existsSync(p) ? fs.readFileSync(idx) : '');
    }
    res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  });
  return new Promise((r) => server.listen(0, () => r(server)));
}

async function browserRuns() {
  const server = await serve(DIST);
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    for (let i = 0; i < RUNS; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      const t0 = performance.now();
      await page.goto(`http://localhost:${port}/index.html?e2e=1`);
      await page.waitForFunction(() => window.__store && window.__store.getState().ready && document.querySelector('.app .sidebar') && document.querySelector('main.main > *'), null, { timeout: 60_000, polling: 16 });
      record('chromium.demarrage_ms (goto → interface prête)', performance.now() - t0);
      record('chromium.demarrage_rendu_ms', await page.evaluate(() => performance.now()));
      const js = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\.js$/.test(e.name)).reduce((n, e) => n + (e.decodedBodySize || 0), 0) / 1024);
      record('chromium.js_charge_au_demarrage_ko', js);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

console.log(`dist : ${path.relative(ROOT, DIST) || DIST} — entrée ${entry} ${entryKb} Ko (+ ${Math.round(preloadKb)} Ko préchargés), JS total ${distKb(/\.js$/)} Ko`);
results['bundle.entree_ko'] = [entryKb];
results['bundle.entree+preload_ko'] = [Math.round(entryKb + preloadKb)];
console.log('Génération de la base…');
const seed = await seedProfile();
console.log(`Base générée : ${Math.round(seed.dbBytes / 1024)} Ko`);
for (let i = 0; i < RUNS; i++) {
  process.stdout.write(`Electron, passe ${i + 1}/${RUNS}…\n`);
  await electronRun(seed.base, path.join(seed.userData, 'db.json'), i);
}
if (!SKIP_BROWSER) await browserRuns();

console.log('\nMédianes (' + RUNS + ' passes) :');
const summary = {};
for (const [k, v] of Object.entries(results)) {
  summary[k] = median(v);
  console.log(`  ${k.padEnd(60)} ${String(median(v)).padStart(9)}   [${v.join(', ')}]`);
}
if (JSON_OUT) fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify({ dist: DIST, runs: RUNS, summary, results }, null, 1));
fs.rmSync(TMP, { recursive: true, force: true });
