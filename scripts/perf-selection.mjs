// Mesure de la sélection de texte (EPUB long, PDF long, vue simple et côte à côte, dizaines de surlignages).
// Port 5218. Lancer : timeout 400 node scripts/perf-selection.mjs [--renders] [--profile] [--throttle=4]
// Sortie : latence d'apparition de la barre de sélection, coût du glissé (script / style / mise en page,
// images longues), temps de création d'un surlignage, nombre de rendus React par composant.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 5218;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ARGS = process.argv.slice(2);
const RENDERS = ARGS.includes('--renders');
const PROFILE = ARGS.includes('--profile');
const THROTTLE = Number((ARGS.find((a) => a.startsWith('--throttle=')) ?? '--throttle=1').split('=')[1]);
const ONLY = (ARGS.find((a) => a.startsWith('--only=')) ?? '').split('=')[1] ?? '';
const TRACE = ARGS.includes('--trace');
const RUNS = TRACE ? 2 : 5;
const CSS = (ARGS.find((a) => a.startsWith('--css=')) ?? '').slice(6);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'marg-perf-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Fixtures longues ──────────────────────────────────────────
async function longEpub(times = 60, names = ['EPUB/text/ch001.xhtml', 'EPUB/text/ch002.xhtml', 'EPUB/text/ch003.xhtml'], out = path.join(TMP, 'discours-long.epub')) {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')));
  for (const name of names) {
    const x = await zip.file(name).async('string');
    const paras = x.match(/<p>[\s\S]*?<\/p>/g) ?? [];
    const body = paras.join('\n');
    const rep = Array.from({ length: times }, () => body).join('\n');
    zip.file(name, x.replace(paras[paras.length - 1], paras[paras.length - 1] + '\n' + rep));
  }
  fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' }));
  return out;
}

async function longPdf(browser, times = 12) {
  const html = fs.readFileSync(path.join(ROOT, 'fixtures/discours.html'), 'utf8');
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)[1];
  const page = await browser.newPage();
  await page.setContent(html.replace(body, Array.from({ length: times }, () => body).join('\n')));
  const out = path.join(TMP, 'discours-long.pdf');
  await page.pdf({ path: out, format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' } });
  await page.close();
  return out;
}

// ── Compteur de rendus React (crochet DevTools minimal) ───────
const RENDER_HOOK = () => {
  const rc = { on: false, commits: 0, by: {} };
  window.__rc = rc;
  const nameOf = (f) => {
    const t = f.type;
    if (!t || typeof t === 'string') return null;
    return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)) || null;
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject() {
      return 1;
    },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      if (!rc.on) return;
      rc.commits++;
      const stack = [root.current];
      while (stack.length) {
        const f = stack.pop();
        if ([0, 1, 11, 14, 15].includes(f.tag) && (f.alternate === null || f.flags & 1)) {
          const n = nameOf(f);
          if (n) rc.by[n] = (rc.by[n] || 0) + 1;
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
    },
    isDisabled: false,
  };
};

// ── Mesures dans la page ──────────────────────────────────────
const INSTRUMENT = () => {
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...a) {
    if (window.__perf?.recording) window.__perf.ctx = (window.__perf.ctx || 0) + 1;
    return gc.apply(this, a);
  };
  const m = { up: 0, toolbar: 0, key: 0, hl: 0, frames: [], longtasks: [], recording: false };
  window.__perf = m;
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (m.recording) m.longtasks.push(e.duration);
  }).observe({ type: 'longtask', buffered: false });
  window.addEventListener('mouseup', () => (m.up = performance.now()), true);
  window.addEventListener('keydown', () => (m.key = performance.now()), true);
  const mo = new MutationObserver((recs) => {
    for (const r of recs)
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (!m.toolbar && (n.matches?.('.sel-toolbar') || n.querySelector?.('.sel-toolbar'))) {
          const t = performance.now();
          requestAnimationFrame(() => (m.toolbar = performance.now()));
          m.toolbarDom = t;
        }
        if (m.watchHl && !m.hl && (n.matches?.(`[data-hl-id="${m.watchHl}"]`) || n.querySelector?.(`[data-hl-id="${m.watchHl}"]`))) {
          requestAnimationFrame(() => (m.hl = performance.now()));
        }
      }
  });
  const startMo = () => mo.observe(document.body, { childList: true, subtree: true });
  if (document.body) startMo();
  else document.addEventListener('DOMContentLoaded', startMo);
  let last = 0;
  const tick = (t) => {
    if (m.recording) {
      if (last) m.frames.push(t - last);
      last = t;
    } else last = 0;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function launch(fn) {
  const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-' + PORT, server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    await fn(browser);
  } finally {
    await browser.close();
    await server.close();
  }
}

async function newApp(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (RENDERS) await page.addInitScript(RENDER_HOOK);
  await page.addInitScript(INSTRUMENT);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  if (CSS) await page.addStyleTag({ content: CSS });
  page.on('console', (m) => m.text().startsWith('ROUTE') && console.log(m.text()));
  await page.evaluate(() => window.__store.subscribe((s, p) => s.route !== p.route && console.log('ROUTE ' + JSON.stringify(s.route) + ' ' + new Error().stack.split('\n').slice(2, 9).join(' | '))));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  return { page, cdp, ctx, errors };
}

async function importFile(page, abs) {
  const b64 = fs.readFileSync(abs).toString('base64');
  return page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await window.__store.getState().importFiles([{ name, data: bin.buffer }]);
      return book.id;
    },
    { name: path.basename(abs), b64 },
  );
}

const CATS = ['probleme', 'these', 'argument', 'these-adverse', 'concept', 'exemple'];

/** Dizaines de surlignages HTML répartis dans les chapitres. */
async function seedHtmlHighlights(page, bookId, n) {
  return page.evaluate(
    ({ bookId, n, CATS }) => {
      const roots = [...document.querySelectorAll('.reader-page[data-pane="a"] .html-chapter-text')];
      const list = [];
      const now = Date.now();
      for (let k = 0; k < n; k++) {
        const root = roots[k % roots.length];
        const chapter = Number(root.dataset.chapter);
        const t = root.textContent;
        const start = Math.floor(((k + 0.5) / n) * (t.length - 400));
        const s = t.indexOf(' ', start) + 1;
        const e = t.indexOf(' ', s + 60 + (k % 5) * 30);
        list.push({
          id: 'seed' + k,
          bookId,
          anchor: { kind: 'html', chapter, start: s, end: e, prefix: t.slice(Math.max(0, s - 32), s), suffix: t.slice(e, e + 32) },
          text: t.slice(s, e),
          locationLabel: 'seed',
          category: CATS[k % CATS.length],
          note: '',
          conceptIds: [],
          noteKind: null,
          printedPage: '',
          createdAt: now + k,
          updatedAt: now + k,
        });
      }
      window.__store.setState((s) => ({ highlights: [...s.highlights, ...list] }));
      return list.length;
    },
    { bookId, n, CATS },
  );
}

/** Dizaines de surlignages PDF (rectangles normalisés) sur les premières pages. */
async function seedPdfHighlights(page, bookId, n, pages = 6) {
  return page.evaluate(
    ({ bookId, n, pages, CATS }) => {
      const list = [];
      const now = Date.now();
      for (let k = 0; k < n; k++) {
        const p = 1 + (k % pages);
        const y = 0.1 + ((Math.floor(k / pages) * 0.07) % 0.8);
        list.push({
          id: 'seed' + k,
          bookId,
          anchor: { kind: 'pdf', page: p, rects: [ { x: 0.12, y, w: 0.76, h: 0.018 }, { x: 0.12, y: y + 0.022, w: 0.4, h: 0.018 } ] },
          text: 'seed ' + k,
          locationLabel: 'p. ' + p,
          category: CATS[k % CATS.length],
          note: '',
          conceptIds: [],
          noteKind: null,
          printedPage: String(p),
          createdAt: now + k,
          updatedAt: now + k,
        });
      }
      window.__store.setState((s) => ({ highlights: [...s.highlights, ...list] }));
      return list.length;
    },
    { bookId, n, pages, CATS },
  );
}

/** Points de départ / arrivée d'un glissé sur ~8 lignes dans le volet a. */
async function dragPoints(page, kind, run) {
  return page.evaluate(
    ({ kind, run }) => {
      const pane = document.querySelector('.reader-page[data-pane="a"]');
      if (kind === 'html') {
        const roots = [...pane.querySelectorAll('.html-chapter-text')].filter((r) => r.querySelectorAll('p').length > 100);
        const root = roots[1] ?? roots[0];
        const ps = [...root.querySelectorAll('p')];
        const p = ps[40 + run * 7];
        p.scrollIntoView({ block: 'start' });
        const sc = pane.querySelector('.html-scroll');
        sc.scrollTop -= 120;
        const r1 = p.getBoundingClientRect();
        const box = sc.getBoundingClientRect();
        const cy = (y) => Math.max(box.top + 20, Math.min(box.bottom - 40, y));
        return { x0: r1.left + 30, y0: cy(r1.top + 12), x1: r1.left + r1.width * 0.6, y1: cy(r1.top + 12 + 8 * 30) };
      }
      const pg = pane.querySelector(`.pdf-page[data-page="${2 + (run % 3)}"]`);
      pg.scrollIntoView({ block: 'start' });
      const spans = [...pg.querySelectorAll('.textLayer span:not(.markedContent)')].filter((s) => s.textContent.trim().length > 20);
      const a = spans[6].getBoundingClientRect();
      const b = spans[Math.min(spans.length - 1, 22)].getBoundingClientRect();
      return { x0: a.left + 3, y0: a.top + a.height / 2, x1: b.left + b.width * 0.7, y1: b.top + b.height / 2 };
    },
    { kind, run },
  );
}

const metric = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const pct = (a, q) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
};
const med = (a) => pct(a, 0.5);
const r1 = (v) => Math.round(v * 10) / 10;

async function measureScenario(browser, label, kind, file, { split = false, seed = 60 } = {}) {
  const { page, cdp, ctx, errors } = await newApp(browser);
  const bookId = await importFile(page, file);
  const nav = split ? { name: 'reader', bookId, tab: 'lecture', splitBookId: bookId } : null;
  await page.evaluate(({ bookId, nav }) => {
    window.__store.getState().openBook(bookId);
    if (nav) window.__store.getState().navigate(nav);
  }, { bookId, nav });
  if (kind === 'html') await page.waitForSelector('.reader-page[data-pane="a"] .html-doc.is-revealed', { timeout: 60000 });
  else await page.waitForSelector('.reader-page[data-pane="a"] .pdf-page[data-page="1"] .textLayer[data-ready="1"]', { timeout: 60000 });
  if (split) await page.waitForSelector('.reader-page[data-pane="b"]', { timeout: 30000 });
  await sleep(800);
  if (kind === 'html') await seedHtmlHighlights(page, bookId, seed);
  else await seedPdfHighlights(page, bookId, seed);
  await sleep(800);

  const res = { toolbar: [], toolbarDom: [], hl: [], dragScript: [], dragLayout: [], dragStyle: [], dragTask: [], frameP95: [], frameMax: [], longDrag: [], hlTask: [], hlLong: [] };
  let renders = null;
  if (PROFILE) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  }
  for (let run = 0; run < RUNS; run++) {
    console.log("  run", run, JSON.stringify(await page.evaluate(() => window.__store.getState().route)), await page.evaluate(() => document.querySelectorAll(".reader-page").length));
    const pts = await dragPoints(page, kind, run);
    console.log("  pts", JSON.stringify(pts));
    if (kind === 'pdf') await page.waitForSelector(`.reader-page[data-pane="a"] .pdf-page[data-page="${2 + (run % 3)}"] .textLayer[data-ready="1"]`, { timeout: 20000 });
    // Laisse finir le rendu des pages voisines (sinon il pollue la mesure du glissé).
    await sleep(kind === 'pdf' ? 600 * THROTTLE : 500);
    await page.mouse.move(pts.x0, pts.y0);
    await sleep(100);
    await page.evaluate((r) => {
      Object.assign(window.__perf, { up: 0, toolbar: 0, toolbarDom: 0, key: 0, hl: 0, frames: [], longtasks: [], recording: true, watchHl: null });
      if (window.__rc) Object.assign(window.__rc, { on: r, commits: 0, by: {} });
    }, RENDERS && run === RUNS - 1);
    if (PROFILE && run === RUNS - 1) await cdp.send('Profiler.start');
    let traceDone = null;
    if (TRACE && run === RUNS - 1) {
      const events = [];
      cdp.on('Tracing.dataCollected', (d) => events.push(...d.value));
      traceDone = new Promise((r) => cdp.once('Tracing.tracingComplete', () => r(events)));
      await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink,cc,toplevel', transferMode: 'ReportEvents' });
    }
    const m0 = await metric(cdp);
    await page.mouse.down();
    // Glissé réaliste : ~40 déplacements, ~16 ms d'écart
    const steps = 40;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      await page.mouse.move(pts.x0 + (pts.x1 - pts.x0) * k, pts.y0 + (pts.y1 - pts.y0) * k);
      await sleep(16);
    }
    const m1 = await metric(cdp);
    if (traceDone) {
      console.log('  contextes 2D créés pendant le glissé :', await page.evaluate(() => window.__perf.ctx || 0), 'pages rendues :', await page.evaluate(() => document.querySelectorAll('.reader-page[data-pane="a"] .pdf-canvas canvas').length));
      await cdp.send('Tracing.end');
      summarizeTrace(label, await traceDone);
    }
    const rcDrag = RENDERS && run === RUNS - 1 ? await page.evaluate(() => { const r = JSON.parse(JSON.stringify(window.__rc)); Object.assign(window.__rc, { commits: 0, by: {} }); return r; }) : null;
    const dragFrames = await page.evaluate(() => ({ frames: window.__perf.frames.slice(), long: window.__perf.longtasks.slice() }));
    await page.mouse.up();
    await page.waitForFunction(() => window.__perf.toolbar > 0, null, { timeout: 5000 }).catch(() => null);
    const t = await page.evaluate(() => ({ tb: window.__perf.toolbar - window.__perf.up, tbDom: window.__perf.toolbarDom - window.__perf.up }));
    res.toolbar.push(t.tb);
    res.toolbarDom.push(t.tbDom);
    res.dragScript.push((m1.ScriptDuration - m0.ScriptDuration) * 1000);
    res.dragLayout.push((m1.LayoutDuration - m0.LayoutDuration) * 1000);
    res.dragStyle.push((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000);
    res.dragTask.push((m1.TaskDuration - m0.TaskDuration) * 1000);
    res.frameP95.push(pct(dragFrames.frames, 0.95));
    res.frameMax.push(Math.max(0, ...dragFrames.frames));
    res.longDrag.push(dragFrames.long.length);
    await sleep(200);
    // Création d'un surlignage (touche 2 = Thèse)
    const before = await page.evaluate(() => window.__store.getState().highlights.length);
    await page.evaluate(() => {
      window.__perf.longtasks = [];
      window.__perf.hl = 0;
      window.__perf.watchHl = '__next__';
      const ids = new Set(window.__store.getState().highlights.map((h) => h.id));
      const unsub = window.__store.subscribe((s) => {
        const h = s.highlights.find((x) => !ids.has(x.id));
        if (h) {
          window.__perf.watchHl = h.id;
          unsub();
          // l'élément peut déjà être inséré dans la même tâche
          queueMicrotask(() => {
            if (document.querySelector(`[data-hl-id="${h.id}"]`)) requestAnimationFrame(() => (window.__perf.hl = window.__perf.hl || performance.now()));
          });
        }
      });
    });
    const rcUp = RENDERS && run === RUNS - 1 ? await page.evaluate(() => { const r = JSON.parse(JSON.stringify(window.__rc)); Object.assign(window.__rc, { commits: 0, by: {} }); return r; }) : null;
    if (PROFILE && run === RUNS - 1 && process.env.PROFILE_HL) await cdp.send('Profiler.start');
    const h0 = await metric(cdp);
    await page.keyboard.press('2');
    await page.waitForFunction(() => window.__perf.hl > 0, null, { timeout: 5000 }).catch(() => null);
    await sleep(500); // laisse passer la persistance différée
    const h1 = await metric(cdp);
    const hl = await page.evaluate(() => ({ d: window.__perf.hl - window.__perf.key, long: window.__perf.longtasks.slice() }));
    const after = await page.evaluate(() => window.__store.getState().highlights.length);
    if (after !== before + 1) { console.log("  ! surlignage non créé", label, run, JSON.stringify(t)); await page.screenshot({ path: "/tmp/claude-0/-home-claude-marginalia/20780725-4b55-55db-8901-1877c1efdc09/scratchpad/fail.png" }); }
    res.hl.push(hl.d);
    res.hlTask.push((h1.TaskDuration - h0.TaskDuration) * 1000);
    res.hlLong.push(hl.long.length);
    if (PROFILE && run === RUNS - 1) {
      const { profile } = await cdp.send('Profiler.stop');
      summarizeProfile(label, profile);
    }
    if (RENDERS && run === RUNS - 1) renders = { drag: rcDrag, up: rcUp, hl: await page.evaluate(() => ({ commits: window.__rc.commits, by: window.__rc.by })) };
    await page.evaluate(() => (window.__perf.recording = false));
  }
  const out = {
    scenario: label,
    'barre (ms, souris relâchée → peinte)': r1(med(res.toolbar)),
    'glissé : tâches (ms)': r1(med(res.dragTask)),
    'glissé : script (ms)': r1(med(res.dragScript)),
    'glissé : style (ms)': r1(med(res.dragStyle)),
    'glissé : layout (ms)': r1(med(res.dragLayout)),
    'glissé : image p95 (ms)': r1(med(res.frameP95)),
    'glissé : image max (ms)': r1(med(res.frameMax)),
    'glissé : tâches longues': med(res.longDrag),
    'surlignage (ms, touche → peint)': r1(med(res.hl)),
    'surlignage : tâches (ms)': r1(med(res.hlTask)),
  };
  console.log(JSON.stringify(out));
  if (renders) {
    for (const [phase, r] of Object.entries(renders)) {
      const total = Object.values(r.by).reduce((a, b) => a + b, 0);
      const top = Object.entries(r.by).sort((a, b) => b[1] - a[1]).slice(0, process.env.ALL ? 80 : 12);
      console.log(`  rendus React [${phase}] : ${r.commits} commits, ${total} composants ; ` + top.map(([n, c]) => `${n}×${c}`).join(', '));
    }
  }
  if (errors.length) console.log('  erreurs :', errors.slice(0, 3).join(' | '));
  await ctx.close();
  return out;
}

function summarizeTrace(label, events) {
  // Durée propre par nom d'événement sur le fil principal du moteur de rendu.
  const main = events.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const evs = events.filter((e) => e.ph === 'X' && main && e.pid === main.pid && e.tid === main.tid).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const self = new Map();
  const stack = [];
  for (const e of evs) {
    while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts) stack.pop();
    if (stack.length) stack[stack.length - 1].child += e.dur;
    e.child = 0;
    stack.push(e);
  }
  for (const e of evs) self.set(e.name, (self.get(e.name) ?? 0) + (e.dur - e.child) / 1000);
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  console.log(`  trace ${label} (glissé, temps propre fil principal, ms) : ` + top.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' ; '));
}

function summarizeProfile(label, profile) {
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const cf = n.callFrame;
    const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').slice(-2).join('/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
  });
  const top = [...self.entries()].filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log(`  profil ${label} (temps propre, ms) :`);
  for (const [k, v] of top) console.log(`    ${v.toFixed(1).padStart(7)}  ${k}`);
}

await launch(async (browser) => {
  const epub = await longEpub();
  const pdf = await longPdf(browser);
  const epub1 = await longEpub(500, ['EPUB/text/ch002.xhtml'], path.join(TMP, 'discours-un-chapitre.epub'));
  console.log(`fixtures : ${epub} (${fs.statSync(epub).size} o), ${pdf} (${fs.statSync(pdf).size} o) ; throttle ×${THROTTLE}`);
  const scen = [
    ['EPUB long, vue simple', 'html', epub, false],
    ['EPUB long, côte à côte', 'html', epub, true],
    ['EPUB chapitre de 1 Mo, vue simple', 'html', epub1, false],
    ['PDF long, vue simple', 'pdf', pdf, false],
    ['PDF long, côte à côte', 'pdf', pdf, true],
  ].filter(([l]) => !ONLY || l.toLowerCase().includes(ONLY.toLowerCase()));
  for (const [label, kind, file, split] of scen) await measureScenario(browser, label, kind, file, { split });
});
fs.rmSync(TMP, { recursive: true, force: true });
