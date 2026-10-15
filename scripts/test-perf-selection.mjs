// Performance de la sélection dans un gros EPUB couvert d'extraits — port 5391.
// Lancer : timeout 600 node scripts/test-perf-selection.mjs [--n=800] [--profile] [--throttle=4] [--light] [--keep]
//
// Fixture générée dans un dossier temporaire : EPUB d'environ 1,7 Mo de texte (26 chapitres, titres,
// page-list), puis N extraits (défaut 800) injectés via le store : surtout des surlignages simples
// venus de Livres (`source.app = 'livres'`), quelques catégorisés, quelques notes. Thème sombre,
// panneau Extraits ouvert (comme dans la vidéo du bug 3.3.2 : gel de 2–3 s avant la barre).
//
// Mesures (souris réelle de Playwright) :
//  - latence souris relâchée → barre de sélection peinte : 1re sélection après ouverture, puis suivantes ;
//  - tâches longues (PerformanceObserver longtask) pendant un long glissé et autour du relâchement ;
//  - rendus React du panneau Extraits pendant la sélection (aucun attendu) ;
//  - avec --profile : fonctions les plus coûteuses (CDP Profiler) pendant la 1re sélection.
// Échec si la barre met > 200 ms, ou si une tâche longue > 150 ms survient pendant une sélection.
import { createServer } from 'vite';
import { chromium, _electron } from 'playwright-core';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 5391;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ARGS = process.argv.slice(2);
const arg = (k, d) => (ARGS.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const N = Number(arg('n', 800));
const PROFILE = ARGS.includes('--profile');
const TRACE = ARGS.includes('--trace'); // trace Chromium (style, mise en page, peinture) pendant chaque sélection
const THROTTLE = Number(arg('throttle', 1));
const DARK = !ARGS.includes('--light');
const PANEL = !ARGS.includes('--no-panel'); // diagnostic : panneau Extraits fermé
const KEEP = ARGS.includes('--keep');
const A11Y = ARGS.includes('--a11y'); // arbre d'accessibilité actif (macOS : VoiceOver, PopClip, gestionnaires de fenêtres…)
const DPR = Number(arg('dpr', 1));
const MAX_TOOLBAR_MS = 200;
const MAX_LONGTASK_MS = 150;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'marg-perfsel-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${name}${detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
};

// ── Fixture : gros EPUB ─────────────────────────────────────────
async function bigEpub(out, chapters = 26) {
  const src = await JSZip.loadAsync(fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')));
  const paras = [];
  for (const n of ['EPUB/text/ch001.xhtml', 'EPUB/text/ch002.xhtml', 'EPUB/text/ch003.xhtml']) {
    const x = await src.file(n).async('string');
    for (const m of x.matchAll(/<p>([\s\S]*?)<\/p>/g)) paras.push(m[1]);
  }
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const ROMAN = (i) => ['I', 'II', 'III', 'IV', 'V', 'VI'][i % 6];
  const items = [];
  const toc = [];
  const pageList = [];
  let page = 1;
  for (let c = 1; c <= chapters; c++) {
    const id = `ch${String(c).padStart(3, '0')}`;
    let body = `<h1 id="t${c}">Chapitre ${c}. ${c % 2 ? 'La condition humaine' : 'Le travail et l’œuvre'}</h1>\n`;
    let len = 0;
    let sinceBreak = 0;
    for (let k = 0; k < 190; k++) {
      if (k % 30 === 0) body += `<h2 id="s${c}-${k}">§ ${ROMAN(k / 30)}. Section ${c}.${k / 30 + 1}</h2>\n`;
      const p = paras[(c * 7 + k) % paras.length];
      let pb = '';
      if (sinceBreak > 2400) {
        pb = `<span epub:type="pagebreak" id="p${page}" title="${page}"></span>`;
        pageList.push(`<li><a href="${id}.xhtml#p${page}">${page}</a></li>`);
        page++;
        sinceBreak = 0;
      }
      // Petite variation par chapitre/paragraphe : les passages ne sont pas tous identiques.
      const txt = `${pb}${p} (${c}.${k})`;
      body += `<p>${txt}</p>\n`;
      len += txt.length;
      sinceBreak += txt.length;
    }
    zip.file(`OEBPS/${id}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="fr" xml:lang="fr"><head><meta charset="utf-8"/><title>${id}</title></head><body>\n${body}</body></html>`);
    items.push(id);
    toc.push(`<li><a href="${id}.xhtml">Chapitre ${c}</a></li>`);
  }
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="fr"><head><meta charset="utf-8"/><title>Sommaire</title></head><body><nav epub:type="toc"><ol>${toc.join('')}</ol></nav><nav epub:type="page-list" hidden=""><ol>${pageList.join('')}</ol></nav></body></html>`);
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>\n<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:perf-selection-0001</dc:identifier><dc:title>Condition de l’homme moderne (perf)</dc:title><dc:creator>Hannah Arendt</dc:creator><dc:language>fr</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${items
      .map((id) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`)
      .join('')}</manifest><spine>${items.map((id) => `<itemref idref="${id}"/>`).join('')}</spine></package>`,
  );
  fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip', compression: 'DEFLATE' }));
  return out;
}

// ── Instrumentation dans la page ────────────────────────────────
const INSTRUMENT = () => {
  const m = { up: 0, toolbar: 0, recording: false, longtasks: [], renders: 0 };
  window.__perf = m;
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (m.recording) m.longtasks.push({ d: Math.round(e.duration), t: Math.round(e.startTime) });
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    /* pas de longtask : ignoré */
  }
  window.addEventListener('mouseup', () => (m.up = performance.now()), true);
  const mo = new MutationObserver((recs) => {
    if (m.toolbar || !m.up) return;
    for (const r of recs)
      for (const n of r.addedNodes)
        if (n.nodeType === 1 && (n.matches?.('.sel-toolbar') || n.querySelector?.('.sel-toolbar'))) {
          requestAnimationFrame(() => setTimeout(() => (m.toolbar = m.toolbar || performance.now()), 0));
          return;
        }
  });
  const start = () => mo.observe(document.body, { childList: true, subtree: true });
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
  // Compteur de rendus des cartes du panneau (crochet DevTools minimal)
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      if (!m.recording) return;
      const stack = [root.current];
      while (stack.length) {
        const f = stack.pop();
        const t = f.type;
        const name = t && typeof t !== 'string' ? t.displayName || t.name || t.type?.name : null;
        if (name === 'ExtractCard' && (f.alternate === null || f.flags & 1)) m.renders++;
        if (f.sibling) stack.push(f.sibling);
        if (f.child && (f.alternate === null || f.child !== f.alternate.child)) stack.push(f.child);
      }
    },
    isDisabled: false,
  };
};

/** Trace Chromium : temps par type d'événement du thread principal du rendu, et tâches les plus longues. */
async function traceStart(cdp) {
  await cdp.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'v8.execute', 'toplevel'] },
  });
}
async function traceStop(cdp, label) {
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  const { stream } = await done;
  let txt = '';
  for (;;) {
    const { data, eof } = await cdp.send('IO.read', { handle: stream, size: 1 << 22 });
    txt += data;
    if (eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  const ev = JSON.parse(txt).traceEvents ?? JSON.parse(txt);
  const main = ev.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain' && ev.some((x) => x.pid === e.pid && x.name === 'FunctionCall'));
  const mine = ev.filter((e) => main && e.pid === main.pid && e.tid === main.tid && e.ph === 'X' && e.dur);
  const by = new Map();
  for (const e of mine) by.set(e.name, (by.get(e.name) ?? 0) + e.dur / 1000);
  const tasks = mine.filter((e) => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask').sort((a, b) => b.dur - a.dur).slice(0, 5);
  console.log(`  trace (${label}) — thread principal :`);
  const key = ['LayoutView::HitTest', 'Editor::SyncSelection', 'Document::UpdateStyleAndLayout', 'Paint', 'PrePaint', 'Blink.Animate.UpdateTime'];
  console.log(`  bilan (${label}) : ${key.map((k) => `${k.replace(/^.*::|^Blink\.|\.UpdateTime$/g, '')} ${(by.get(k) ?? 0).toFixed(1)}`).join(' | ')} ms`);
  for (const [k, v] of [...by.entries()].filter(([k]) => !/RunTask|ThreadController|MessageLoop/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`    ${v.toFixed(1).padStart(8)} ms  ${k}`);
  for (const t of tasks) {
    const inner = mine.filter((e) => e !== t && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && !/RunTask|ThreadController/.test(e.name));
    const sub = new Map();
    for (const e of inner) sub.set(e.name, Math.max(sub.get(e.name) ?? 0, e.dur / 1000));
    console.log(`    tâche ${(t.dur / 1000).toFixed(1)} ms : ${[...sub.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`);
  }
}

function summarizeProfile(profile, top = 18) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const f = n.callFrame;
    const key = `${f.functionName || '(anonyme)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
  });
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  for (const [k, v] of rows) console.log(`    ${v.toFixed(1).padStart(8)} ms  ${k}`);
}

// --electron : l'app Electron (rendu construit dans dist/, comme l'app empaquetée), sinon Vite + Chromium.
const ELECTRON = ARGS.includes('--electron');
const APP_DIR = arg('app', ROOT);
let server = null;
let browser = null;
let eapp = null;
if (!ELECTRON) {
  server = await createServer({
    root: ROOT,
    cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`),
    server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
    logLevel: 'error',
  });
  await server.listen();
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', ...(A11Y ? ['--force-renderer-accessibility'] : [])] });
}
const errors = [];
try {
  const epub = await bigEpub(path.join(TMP, 'condition-homme-moderne.epub'));
  console.log(`fixture : ${(fs.statSync(epub).size / 1024).toFixed(0)} Ko (zip) — ${N} extraits — thème ${DARK ? 'sombre' : 'clair'}${THROTTLE > 1 ? ` — CPU ÷${THROTTLE}` : ''}${ELECTRON ? ' — Electron' : ''}`);
  let page;
  let cdp;
  if (ELECTRON) {
    eapp = await _electron.launch({
      executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
      args: ['--no-sandbox', ...(A11Y ? ['--force-renderer-accessibility'] : []), APP_DIR],
      env: { ...process.env, XDG_CONFIG_HOME: path.join(TMP, 'config'), VITE_DEV_SERVER_URL: '', MARGINALIA_E2E: '1' },
      timeout: 60000,
    });
    page = await eapp.firstWindow();
    await eapp.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setContentSize(1440, 900);
    });
    await page.addInitScript(INSTRUMENT);
    await page.reload();
    cdp = await page.context().newCDPSession(page);
  } else {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR, colorScheme: DARK ? 'dark' : 'light' });
    page = await ctx.newPage();
    await page.addInitScript(INSTRUMENT);
    await page.goto(`http://localhost:${PORT}/`);
    cdp = await ctx.newCDPSession(page);
  }
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon/.test(JSON.stringify(m.location())) && errors.push('console: ' + m.text() + ' ' + JSON.stringify(m.location())));
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  // Import, extraits injectés (avant l'ouverture : comme au lancement de l'app après une synchro Livres).
  const b64 = fs.readFileSync(epub).toString('base64');
  const bookId = await page.evaluate(async ({ b64, dark, panel }) => {
    const st = window.__store.getState();
    if (dark) st.updateSettings({ theme: 'dark' });
    st.updateSettings({ showExtracts: panel, rightPanel: 'extraits' });
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const [b] = await st.importFiles([{ name: 'condition-homme-moderne.epub', data: bin.buffer }]);
    return b.id;
  }, { b64, dark: DARK, panel: PANEL });
  // Textes des chapitres (mêmes offsets que le lecteur : textContent de .html-chapter-text).
  await page.evaluate((id) => window.__store.getState().openBook(id), bookId);
  await page.waitForSelector('.html-doc.is-revealed', { timeout: 60000 });
  const totalChars = await page.evaluate(() => [...document.querySelectorAll('.html-chapter-text')].reduce((n, r) => n + r.textContent.length, 0));
  console.log(`texte : ${(totalChars / 1e6).toFixed(2)} M caractères, ${await page.evaluate(() => document.querySelectorAll('.html-chapter-text').length)} chapitres`);
  await page.evaluate(({ bookId, N }) => {
    const roots = [...document.querySelectorAll('.html-chapter-text')];
    const CATS = ['probleme', 'these', 'argument', 'these-adverse', 'concept', 'exemple'];
    const now = Date.now() - 86400000;
    const list = [];
    for (let k = 0; k < N; k++) {
      const root = roots[k % roots.length];
      const chapter = Number(root.dataset.chapter);
      const t = root.textContent;
      const per = Math.ceil(N / roots.length);
      const slot = Math.floor(k / roots.length);
      const s0 = Math.floor(((slot + 0.3) / per) * (t.length - 600));
      const s = t.indexOf(' ', s0) + 1;
      const e = t.indexOf(' ', s + 40 + (k % 7) * 25);
      const kind = k % 10; // 0–6 : Livres (simple), 7–8 : catégorisé, 9 : note
      const fromLivres = kind <= 6;
      const category = kind === 7 || kind === 8 ? CATS[k % CATS.length] : null;
      list.push({
        id: 'perf' + k,
        bookId,
        category,
        ...(kind <= 6 ? { plain: true } : {}),
        text: t.slice(s, e),
        note: kind === 9 ? 'Note de lecture ' + k : '',
        noteKind: null,
        conceptIds: [],
        anchor: { kind: 'html', chapter, start: s, end: e, prefix: t.slice(Math.max(0, s - 32), s), suffix: t.slice(e, e + 32) },
        locationLabel: 'Chapitre ' + (chapter + 1),
        printedPage: String(1 + Math.floor(k / 3)),
        createdAt: now + k * 1000,
        updatedAt: now + k * 1000,
        ...(fromLivres ? { source: { app: 'livres', uuid: 'U' + k, modified: now, category: null, plain: true, note: '', text: t.slice(s, e) } } : {}),
      });
    }
    window.__store.setState((s) => ({ highlights: [...s.highlights, ...list] }));
  }, { bookId, N });
  // Réouverture : 1re sélection après ouverture du livre avec tous ses extraits.
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await sleep(500);
  await page.evaluate((id) => window.__store.getState().openBook(id), bookId);
  await page.waitForSelector('.html-doc.is-revealed', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.reader-loading.overlay'), null, { timeout: 60000 });
  if (PANEL) await page.waitForSelector('.ann-panel', { timeout: 10000 });
  await sleep(1200);
  const panelInfo = await page.evaluate(() => ({
    count: document.querySelector('.ann-count')?.textContent?.trim(),
    cards: document.querySelectorAll('.ann-card').length,
    hl: document.querySelectorAll('.html-doc .hl').length,
    nodes: document.getElementsByTagName('*').length,
  }));
  console.log('panneau / DOM :', JSON.stringify(panelInfo));
  if (PANEL) check('panneau Extraits : compteur', panelInfo.count?.startsWith(String(N)), panelInfo.count);

  /** Paragraphe visible dans le texte → points de glissé. */
  const dragPoints = (lines, run) =>
    page.evaluate(
      ({ lines, run }) => {
        const sc = document.querySelector('.html-scroll');
        const box = sc.getBoundingClientRect();
        const ps = [...document.querySelectorAll('.html-chapter-text p')].filter((p) => {
          const r = p.getBoundingClientRect();
          return r.top > box.top + 60 && r.top < box.bottom - 360 && r.height > 60 && p.textContent.length > 200;
        });
        const p = ps[run % Math.max(1, ps.length)] ?? null;
        if (!p) return null;
        const r = p.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(p).lineHeight) || 30;
        return { x0: r.left + 40, y0: r.top + lh / 2, x1: r.left + r.width * 0.55, y1: r.top + lh / 2 + lh * lines };
      },
      { lines, run },
    );

  async function selectOnce(label, { lines = 0, steps = 8, profile = false, wheel = 0 } = {}) {
    await page.evaluate(() => {
      getSelection().removeAllRanges();
      Object.assign(window.__perf, { up: 0, toolbar: 0, longtasks: [], renders: 0 });
    });
    await sleep(300);
    if (wheel) {
      // Lecture puis sélection aussitôt : la position de lecture est enregistrée pendant la sélection.
      await page.mouse.move(700, 450);
      await page.evaluate(() => (window.__perf.recording = true));
      for (let i = 0; i < wheel; i++) {
        await page.mouse.wheel(0, 240);
        await sleep(40);
      }
      await sleep(120);
    }
    const pts = await dragPoints(lines, label.length);
    if (!pts) throw new Error('aucun paragraphe visible');
    await page.mouse.move(pts.x0, pts.y0);
    await page.evaluate(() => (window.__perf.recording = true));
    if (TRACE) await traceStart(cdp);
    if (profile) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
      await cdp.send('Profiler.start');
    }
    await page.mouse.down();
    const n = Math.max(steps, lines * 6);
    for (let i = 1; i <= n; i++) {
      await page.mouse.move(pts.x0 + ((pts.x1 - pts.x0) * i) / n, pts.y0 + ((pts.y1 - pts.y0) * i) / n);
      await sleep(16);
    }
    const dragLong = await page.evaluate(() => window.__perf.longtasks.slice());
    await page.mouse.up();
    await page.waitForFunction(() => window.__perf.toolbar > 0, null, { timeout: 15000 }).catch(() => null);
    await sleep(1600); // tâches différées après l'apparition de la barre (sauvegarde de position, persistance)
    const r = await page.evaluate(() => ({ ms: window.__perf.toolbar ? Math.round(window.__perf.toolbar - window.__perf.up) : -1, long: window.__perf.longtasks.slice(), renders: window.__perf.renders }));
    await page.evaluate(() => (window.__perf.recording = false));
    if (TRACE) await traceStop(cdp, label);
    if (profile) {
      const { profile: prof } = await cdp.send('Profiler.stop');
      console.log(`  profil (${label}) — temps propre :`);
      summarizeProfile(prof);
    }
    const maxLong = Math.max(0, ...r.long.map((x) => x.d));
    console.log(`  ${label.padEnd(26)} barre ${String(r.ms).padStart(5)} ms | tâches longues ${r.long.length} (max ${maxLong} ms; glissé ${dragLong.length}) | rendus de cartes ${r.renders}`);
    return { ...r, maxLong, dragLong };
  }

  const results = [];
  results.push(['1re sélection', await selectOnce('1re sélection', { profile: PROFILE })]);
  for (let i = 2; i <= 4; i++) results.push([`sélection ${i}`, await selectOnce(`sélection ${i}`, { profile: PROFILE && i >= 2 })]);
  results.push(['long glissé (12 lignes)', await selectOnce('long glissé (12 lignes)', { lines: 12 })]);
  // Défilement ailleurs dans le livre (autre chapitre), puis sélection.
  await page.evaluate(() => {
    const sc = document.querySelector('.html-scroll');
    sc.scrollTop = sc.scrollHeight * 0.55;
  });
  await sleep(900);
  results.push(['après saut (milieu)', await selectOnce('après saut (milieu)')]);
  for (let i = 1; i <= 3; i++) results.push([`défilement puis sélection ${i}`, await selectOnce(`défilement puis sélection ${i}`, { wheel: 6, profile: PROFILE && i === 1 })]);

  for (const [label, r] of results) {
    check(`${label} : barre en ≤ ${MAX_TOOLBAR_MS} ms`, r.ms > 0 && r.ms <= MAX_TOOLBAR_MS, `${r.ms} ms`);
    check(`${label} : aucune tâche longue > ${MAX_LONGTASK_MS} ms`, r.maxLong <= MAX_LONGTASK_MS, `max ${r.maxLong} ms`);
  }
  check('panneau Extraits non re-rendu par la sélection', results.every(([, r]) => r.renders === 0), results.map(([, r]) => r.renders).join(','));

  // Le surlignage marche toujours : H crée un surlignage simple, visible dans le texte et le panneau.
  await selectOnce('avant H');
  const before = await page.evaluate(() => window.__store.getState().highlights.length);
  await page.keyboard.press('h');
  await sleep(600);
  const after = await page.evaluate(() => {
    const s = window.__store.getState();
    const h = s.highlights[s.highlights.length - 1];
    return { n: s.highlights.length, inText: !!document.querySelector(`.html-doc [data-hl-id="${h.id}"]`), plain: !!h.plain };
  });
  check('H : surlignage créé et affiché', after.n === before + 1 && after.inText && after.plain, after);
  const count = await page.evaluate(() => document.querySelector('.ann-count')?.textContent?.trim());
  if (PANEL) check('compteur du panneau mis à jour', count?.startsWith(String(N + 1)), count);

  // Liste virtualisée : défilement jusqu'au bout, clic sur une carte, carte active suivie, filtres.
  if (PANEL) {
    const v0 = await page.evaluate(() => ({ cards: document.querySelectorAll('.ann-card').length }));
    check('panneau : cartes montées limitées à la zone visible', v0.cards > 3 && v0.cards < 60, v0);
    const bottom = await page.evaluate(async () => {
      const l = document.querySelector('.ann-list');
      for (let i = 0; i < 6; i++) {
        l.scrollTop = l.scrollHeight;
        await new Promise((r) => setTimeout(r, 120));
      }
      const cards = [...document.querySelectorAll('.ann-card')];
      const last = cards[cards.length - 1];
      const lr = l.getBoundingClientRect();
      const r = last.getBoundingClientRect();
      return { pad: parseFloat(getComputedStyle(document.querySelector('.ann-vlist')).paddingBottom), gap: Math.round(lr.bottom - r.bottom), cards: cards.length, id: last.dataset.hid };
    });
    check('panneau : défilé jusqu’au bout, dernière carte montée et visible', bottom.pad === 0 && bottom.gap >= 0 && bottom.gap < 80 && bottom.cards < 60, bottom);
    // Clic sur une carte (milieu de liste) → le texte va au passage.
    const mid = await page.evaluate(async () => {
      const l = document.querySelector('.ann-list');
      l.scrollTop = l.scrollHeight / 2;
      await new Promise((r) => setTimeout(r, 200));
      const c = [...document.querySelectorAll('.ann-card')].find((e) => {
        const r = e.getBoundingClientRect();
        const lr = l.getBoundingClientRect();
        return r.top > lr.top + 20 && r.bottom < lr.bottom - 20;
      });
      return c?.dataset.hid;
    });
    await page.click(`.ann-card[data-hid="${mid}"] .ann-card-text`);
    await sleep(1500);
    const jumped = await page.evaluate((id) => {
      const sc = document.querySelector('.html-scroll').getBoundingClientRect();
      const el = document.querySelector(`.html-doc [data-hl-id="${id}"]`);
      const r = el?.getBoundingClientRect();
      return { active: window.__store.getState().activeHighlightId === id, inView: !!r && r.top >= sc.top && r.bottom <= sc.bottom };
    }, mid);
    check('clic sur une carte : passage affiché dans le texte', jumped.inView, jumped);
    // Carte lointaine rendue active depuis le texte → la liste défile jusqu'à elle.
    const far = await page.evaluate(async () => {
      const l = document.querySelector('.ann-list');
      l.scrollTop = 0;
      await new Promise((r) => setTimeout(r, 200));
      const ids = window.__store.getState().highlights.map((h) => h.id);
      const id = ids.find((x) => x === 'perf' + (ids.length - 30)) ?? ids[ids.length - 30];
      window.__store.setState({ activeHighlightId: id });
      await new Promise((r) => setTimeout(r, 1200));
      const el = document.querySelector(`.ann-card[data-hid="${id}"]`);
      const r = el?.getBoundingClientRect();
      const lr = l.getBoundingClientRect();
      return { id, mounted: !!el, active: !!el?.classList.contains('active'), inView: !!r && r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1 };
    });
    check('carte active lointaine : montée, marquée et visible dans la liste', far.mounted && far.active && far.inView, far);
    await page.evaluate(() => window.__store.setState({ activeHighlightId: null }));
    // Filtre « Thèse » : compteur et cartes.
    await page.click('.ann-chip[data-filter="these"]');
    await sleep(300);
    const filt = await page.evaluate(() => {
      const hs = window.__store.getState().highlights.filter((h) => h.category === 'these');
      const cards = [...document.querySelectorAll('.ann-card')].map((c) => c.dataset.hid);
      return { want: hs.length, count: document.querySelector('.ann-count')?.textContent?.trim(), cards: cards.length, allThese: cards.every((id) => hs.some((h) => h.id === id)) };
    });
    check('filtre « Thèse » : compteur et cartes', filt.count?.startsWith(String(filt.want)) && filt.allThese && filt.cards === Math.min(filt.want, filt.cards) && filt.cards > 0, filt);
    await page.click('.ann-chip[data-filter="these"]');
    await sleep(300);
    const back = await page.evaluate(() => document.querySelector('.ann-count')?.textContent?.trim());
    check('filtre retiré : compteur complet', back?.startsWith(String(N + 1)), back);
  }
} finally {
  if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + errors.join('\n'));
  await browser?.close();
  await eapp?.close();
  await server?.close();
  if (!KEEP) fs.rmSync(TMP, { recursive: true, force: true });
}
if (errors.length) failed++;
console.log(failed ? `\n${failed} échec(s)` : '\nTout est OK');
process.exit(failed ? 1 : 0);
