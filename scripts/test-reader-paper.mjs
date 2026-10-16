// Aspect papier (réglage paperLook → .paper-look sur la racine du lecteur).
// - la classe suit le réglage (bascule provisoire du popover « Affichage ») ;
// - grain présent (background-image en data-URI, aucune requête réseau) en colonne continue et
//   sur chaque feuille (pages façon papier) ;
// - contraste du texte calculé sur les pixels réels du papier (grain compris) : ≥ 7:1 dans les
//   trois thèmes ; surlignages et sélection toujours lisibles ;
// - textContent des chapitres identique avec et sans l'aspect papier ;
// - défilement d'un long livre : pas de repeinture supplémentaire, images/s équivalentes ;
// - captures shots/papier-aspect/ (clair, sépia, sombre, zoom sur le grain, surlignages).
// Lancer : timeout 300 node scripts/test-reader-paper.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.env.PORT) || 5412;
const SHOTS = path.resolve(ROOT, process.env.SHOTS_DIR || 'shots/papier-aspect');

let failures = 0;
let passes = 0;
const check = (cond, label, extra) => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${label}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
};

// ── Fixture : un long livre (40 chapitres, ≈ 900 000 signes) ──

const WORDS =
  'la raison le jugement la volonté une idée claire et distincte le doute méthodique conduit l’esprit vers la vérité ' +
  'car il faut une fois en sa vie se défaire de toutes les opinions reçues et recommencer tout de nouveau dès les fondements ' +
  'or les sens nous trompent quelquefois et il est de la prudence de ne se fier jamais entièrement à ceux qui nous ont une fois trompés';
const W = WORDS.split(' ');
function para(lead, n, seed) {
  let out = lead;
  let i = seed * 7;
  while (out.length < n) out += ' ' + W[i++ % W.length];
  return out + '.';
}
const xhtml = (title, body) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="fr"><head><title>${title}</title></head><body>${body}</body></html>`;

async function longEpub(chapters = 40) {
  const files = {};
  for (let c = 1; c <= chapters; c++) {
    let body = `<h1>Méditation ${c}</h1>`;
    for (let k = 0; k < 24; k++) body += `<p>${para(`Méditation ${c}, paragraphe ${k + 1} :`, 600 + ((k * 397 + c * 131) % 900), c * 31 + k)}</p>`;
    files[`m${c}.xhtml`] = xhtml(`Méditation ${c}`, body);
  }
  const nav = xhtml('Sommaire', `<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc"><ol>${Object.keys(files).map((f, i) => `<li><a href="${f}">Méditation ${i + 1}</a></li>`).join('')}</ol></nav>`);
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const names = Object.keys(files);
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:test:papier</dc:identifier><dc:title>Méditations sur papier</dc:title><dc:creator>René Descartes</dc:creator><dc:language>fr</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${names.map((n, i) => `<item id="c${i}" href="${n}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${names.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`,
  );
  zip.file('OEBPS/nav.xhtml', nav);
  for (const [n, src] of Object.entries(files)) zip.file('OEBPS/' + n, src);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

// ── Aides ────────────────────────────────────────────────────

async function withApp(fn, { width = 1440, height = 900, scale = 1 } = {}) {
  const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-' + PORT, server: { port: PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('request', (r) => !/^(data:|blob:|http:\/\/localhost)/.test(r.url()) && external.push(r.url()));
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 45000 });
    await fn(page, browser);
  } finally {
    if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + errors.slice(0, 12).join('\n'));
    check(!errors.some((e) => /paper|HtmlReader|TypographyPopover/i.test(e)), 'aucune erreur navigateur liée au lecteur', errors.slice(0, 3));
    check(external.length === 0, 'aucune requête réseau externe', external.slice(0, 3));
    await browser.close();
    await server.close();
  }
}

async function importBuffer(page, name, buf) {
  const b64 = Buffer.from(buf).toString('base64');
  return page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await window.__store.getState().importFiles([{ name, data: bin.buffer }], { asBook: true });
      if (book) window.__store.getState().openBook(book.id);
      return book?.id;
    },
    { name, b64 },
  );
}

async function waitHtml(page) {
  await page.waitForFunction(() => {
    const p = document.querySelector('.reader-page[data-pane="a"]');
    return !!p && !!p.querySelector('.html-chapter-text') && !p.querySelector('.reader-loading');
  }, null, { timeout: 30000 });
  await page.waitForTimeout(700);
}

const set = (page, patch) => page.evaluate((p) => window.__store.getState().updateSettings(p), patch);
const chapterTexts = (page) => page.evaluate(() => [...document.querySelectorAll('.reader-page[data-pane="a"] .html-chapter-text')].map((r) => r.textContent));

async function shot(page, name, clip) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(2, 300);
  await page.evaluate(() => {
    const s = window.__store.getState();
    (s.toasts ?? []).forEach((t) => s.dismissToast?.(t.id));
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, name), ...(clip ? { clip } : {}) });
  console.log('capture:', path.relative(ROOT, path.join(SHOTS, name)));
}

/** Luminance relative (WCAG) d'une couleur sRGB 0–255. */
const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/**
 * Pixels du papier : capture d'une zone sans texte (interligne de la colonne de lecture) décodée
 * dans la page ; renvoie la couleur moyenne et les couleurs « pires » (1er et 99e centiles de luminance).
 */
async function paperPixels(page, clip) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    const px = [];
    for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
    const L = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    px.sort((a, b) => L(a) - L(b));
    const avg = [0, 1, 2].map((k) => Math.round(px.reduce((s, p) => s + p[k], 0) / px.length));
    const lo = px[Math.floor(px.length * 0.01)];
    const hi = px[Math.floor(px.length * 0.99)];
    const distinct = new Set(px.map((p) => p.join(','))).size;
    return { avg, lo, hi, distinct };
  }, png.toString('base64'));
}

/** Zone vide : la marge gauche de la colonne de lecture, à hauteur du texte. */
const blankClip = (page) =>
  page.evaluate(() => {
    const col = document.querySelector('.reader-page[data-pane="a"] .html-col');
    const sc = document.querySelector('.reader-page[data-pane="a"] .html-scroll').getBoundingClientRect();
    const text = col.querySelector('.html-chapter-text').getBoundingClientRect();
    const r = col.getBoundingClientRect();
    // Feuilles : entre le bord de la feuille et le texte ; colonne continue : la marge à gauche
    // de la colonne (ombrage des bords compris, donc le cas le plus sombre).
    let left = Math.max(r.left, sc.left) + 8;
    let width = Math.min(40, text.left - left - 8);
    if (width < 10) {
      left = sc.left + 24;
      width = Math.min(120, r.left - left - 24);
    }
    const y = Math.max(sc.top + 60, Math.min(sc.bottom - 260, text.top + 40));
    return { x: Math.round(left), y: Math.round(y), width: Math.round(width), height: 200 };
  });

const inkColor = (page) =>
  page.evaluate(() => {
    const p = document.querySelector('.reader-page[data-pane="a"] .html-chapter-text p');
    return getComputedStyle(p).color.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  });

/** Couleur effective d'un fond translucide posé sur `under` (rgba(...) calculé). */
const over = (rgba, under) => {
  const [r, g, b, a = 1] = rgba.match(/[\d.]+/g).map(Number);
  return [r, g, b].map((c, i) => Math.round(c * a + under[i] * (1 - a)));
};

async function scrollPerf(page, browser, label) {
  // Défilement continu, image par image, dans un long livre : images/s et nombre de peintures.
  await page.evaluate(() => (document.querySelector('.reader-page[data-pane="a"] .html-scroll').scrollTop = 0));
  await page.waitForTimeout(400);
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc'] });
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const sc = document.querySelector('.reader-page[data-pane="a"] .html-scroll');
        const t0 = performance.now();
        let frames = 0;
        let worst = 0;
        let last = t0;
        const step = (t) => {
          frames++;
          worst = Math.max(worst, t - last);
          last = t;
          sc.scrollTop += 40;
          if (t - t0 < 3000) requestAnimationFrame(step);
          else resolve({ fps: Math.round((frames * 1000) / (t - t0)), worst: Math.round(worst), top: Math.round(sc.scrollTop) });
        };
        requestAnimationFrame(step);
      }),
  );
  const trace = JSON.parse((await browser.stopTracing()).toString());
  const ev = trace.traceEvents ?? trace;
  const paints = ev.filter((e) => e.name === 'Paint').length;
  // Rastérisation (fils de travail, hors du fil principal) : pour information.
  const rasterMs = Math.round(ev.filter((e) => e.name === 'RasterTask' && e.dur).reduce((s, e) => s + e.dur, 0) / 1000);
  const paintMs = Math.round(ev.filter((e) => e.name === 'Paint' && e.dur).reduce((s, e) => s + e.dur, 0) / 1000);
  console.log(`  ${label} : ${fps.fps} images/s (pire image ${fps.worst} ms), ${paints} peintures (${paintMs} ms), rastérisation ${rasterMs} ms, descendu à ${fps.top}px`);
  return { ...fps, paints, paintMs, rasterMs };
}

// ── Scénario ─────────────────────────────────────────────────

await withApp(async (page, browser) => {
  await set(page, { theme: 'light', pageMarks: 'numbered', paperLook: false, showToc: false, showExtracts: false });
  const id = await importBuffer(page, 'meditations-papier.epub', await longEpub());
  await waitHtml(page);

  const root = () => page.evaluate(() => document.querySelector('.reader-page[data-pane="a"] .html-reader').className);
  check(!/paper-look/.test(await root()), 'par défaut : pas d’aspect papier');
  const textsOff = await chapterTexts(page);

  // Bascule provisoire du popover « Affichage ».
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.icon-btn')].find((b) => /affichage/i.test(b.getAttribute('aria-label') || b.title || ''));
    btn?.click();
  });
  await page.waitForTimeout(300);
  const sw = await page.$('[data-testid=paper-look-switch]');
  check(!!sw, 'popover : bascule « Aspect papier » présente');
  if (sw) {
    await sw.click();
    await page.waitForTimeout(200);
    check((await page.evaluate(() => window.__store.getState().settings.paperLook)) === true, 'popover : la bascule active le réglage');
    await page.keyboard.press('Escape');
  } else await set(page, { paperLook: true });
  await page.waitForTimeout(400);

  check(/(^|\s)paper-look(\s|$)/.test(await root()), 'classe .paper-look sur la racine du lecteur');
  const bg = await page.evaluate(() => {
    const r = document.querySelector('.reader-page[data-pane="a"]');
    return { doc: getComputedStyle(r.querySelector('.html-doc')).backgroundImage, scroll: getComputedStyle(r.querySelector('.html-scroll')).backgroundColor };
  });
  check(/url\("data:image\/svg\+xml/.test(bg.doc) && /feTurbulence/.test(bg.doc), 'colonne continue : grain SVG (feTurbulence) en data-URI', bg.doc.slice(0, 60));
  check(bg.doc.length < 4000, 'grain : carreau minuscule (< 4 Ko)', bg.doc.length);
  check(bg.scroll === 'rgb(250, 246, 236)', 'colonne continue : teinte blanc cassé chaud', bg.scroll);
  check(JSON.stringify(await chapterTexts(page)) === JSON.stringify(textsOff), 'textContent des chapitres identique avec l’aspect papier');

  // Contraste, sur les vrais pixels (grain compris), dans les trois thèmes.
  const contrast = {};
  for (const theme of ['light', 'sepia', 'dark']) {
    await set(page, { theme });
    await page.waitForTimeout(350);
    const px = await paperPixels(page, await blankClip(page));
    const ink = await inkColor(page);
    const worst = ratio(ink, theme === 'dark' ? px.hi : px.lo);
    contrast[theme] = { avg: ratio(ink, px.avg), worst, px };
    check(px.distinct > 12, `${theme} : le papier a du grain (${px.distinct} teintes distinctes)`, px.distinct);
    check(worst >= 7, `${theme} : contraste du texte ≥ 7:1 même sur le grain le plus marqué (moy. ${ratio(ink, px.avg).toFixed(1)}:1, pire ${worst.toFixed(1)}:1)`);
  }
  const amp = (t) => Math.abs(lum(contrast[t].px.hi) - lum(contrast[t].px.lo));
  check(amp('dark') < amp('light'), 'sombre : grain plus discret qu’en clair', { dark: amp('dark').toFixed(4), light: amp('light').toFixed(4) });

  // Captures des trois thèmes (colonne continue), puis feuilles.
  await set(page, { theme: 'light' });
  await page.evaluate(() => (document.querySelector('.reader-page[data-pane="a"] .html-scroll').scrollTop = 0));
  await page.waitForTimeout(400);
  await shot(page, '01-papier-clair.png');
  await set(page, { theme: 'sepia' });
  await page.waitForTimeout(400);
  await shot(page, '02-papier-sepia.png');
  await set(page, { theme: 'dark' });
  await page.waitForTimeout(400);
  await shot(page, '03-papier-sombre.png');

  // Feuilles (pages façon papier) : la texture est sur chaque feuille, la table reste unie.
  await set(page, { theme: 'light', pageMarks: 'paper' });
  await page.waitForTimeout(700);
  const sheet = await page.evaluate(() => {
    const r = document.querySelector('.reader-page[data-pane="a"]');
    return {
      col: getComputedStyle(r.querySelector('.html-col')).backgroundImage,
      doc: getComputedStyle(r.querySelector('.html-doc')).backgroundImage,
    };
  });
  check(/feTurbulence/.test(sheet.col) && sheet.doc === 'none', 'feuilles : grain sur chaque feuille, pas sur la table', { doc: sheet.doc.slice(0, 30) });
  check(JSON.stringify(await chapterTexts(page)) === JSON.stringify(textsOff), 'feuilles : textContent inchangé');
  {
    const ink = await inkColor(page);
    const px = await paperPixels(page, await blankClip(page));
    check(ratio(ink, px.lo) >= 7, `feuilles : contraste ≥ 7:1 sur le papier (${ratio(ink, px.lo).toFixed(1)}:1)`);
  }
  await shot(page, '06-papier-feuilles.png');
  await set(page, { theme: 'dark' });
  await page.waitForTimeout(400);
  await shot(page, '07-papier-feuilles-sombre.png');

  // Pages (mise en page paginée, autre branche) : la règle .paper-look .paged-page s'applique.
  const paged = await page.evaluate(() => {
    const host = document.querySelector('.reader-page[data-pane="a"] .html-reader');
    const el = document.createElement('div');
    el.className = 'paged-page';
    host.appendChild(el);
    const b = getComputedStyle(el).backgroundImage;
    el.remove();
    return b;
  });
  check(/feTurbulence/.test(paged), '.paper-look .paged-page : grain sur chaque page');

  // Surlignages et sélection sur le papier.
  await set(page, { theme: 'light', pageMarks: 'numbered' });
  await page.waitForTimeout(500);
  await page.evaluate((id) => {
    const s = window.__store.getState();
    const t = document.querySelector('.reader-page[data-pane="a"] .html-chapter-text').textContent;
    const cats = ['plain', 'these', 'argument', 'objection', 'concept', 'exemple', 'probleme'];
    const base = t.indexOf('paragraphe 1 :') + 60;
    cats.forEach((category, i) => {
      // Sept surlignages rapprochés (une ligne sur deux environ), tous visibles dans la capture.
      const a = t.indexOf(' ', base + i * 120) + 1;
      const b = t.indexOf(' ', a + 50);
      s.addHighlight({ bookId: id, category, text: t.slice(a, b), anchor: { kind: 'html', chapter: 0, start: a, end: b, prefix: t.slice(Math.max(0, a - 32), a), suffix: t.slice(b, b + 32) }, locationLabel: 'papier', printedPage: '' });
    });
  }, id);
  await page.waitForTimeout(500);
  check(JSON.stringify(await chapterTexts(page)) === JSON.stringify(textsOff), 'surlignages : textContent inchangé');
  // Contraste du texte surligné / sélectionné (fond translucide posé sur le papier), comparé au
  // même calcul sans l'aspect papier : le papier, un peu plus teinté, ne doit pas le dégrader.
  const measureHl = () =>
    page.evaluate(() => {
      const r = document.querySelector('.reader-page[data-pane="a"]');
      return {
        ink: getComputedStyle(r.querySelector('.html-chapter-text p')).color,
        hls: [...r.querySelectorAll('.html-chapter-text [data-hl-id]')].map((el) => ({ cls: el.className.replace(/\bhl\b|\s+/g, ' ').trim(), bg: getComputedStyle(el).backgroundColor })),
        sel: getComputedStyle(r.querySelector('.html-doc'), '::selection').backgroundColor,
        base: getComputedStyle(r.querySelector('.html-scroll')).backgroundColor,
      };
    });
  const ratios = (res) => {
    const ink = res.ink.match(/[\d.]+/g).slice(0, 3).map(Number);
    const base = res.base.match(/[\d.]+/g).slice(0, 3).map(Number);
    return { hl: res.hls.map((h) => [h.cls, ratio(ink, over(h.bg, base))]), sel: ratio(ink, over(res.sel, base)), n: res.hls.length };
  };
  for (const theme of ['light', 'sepia', 'dark']) {
    await set(page, { theme, paperLook: false });
    await page.waitForTimeout(300);
    const off = ratios(await measureHl());
    await set(page, { paperLook: true });
    await page.waitForTimeout(300);
    const on = ratios(await measureHl());
    const worstOn = Math.min(...on.hl.map((x) => x[1]));
    const worstOff = Math.min(...off.hl.map((x) => x[1]));
    console.log(`  ${theme} : ` + on.hl.map(([c, v], i) => `${c} ${v.toFixed(1)} (sans ${off.hl[i][1].toFixed(1)})`).join(', '));
    check(on.n >= 7 && worstOn >= 4.5, `${theme} : texte surligné lisible sur le papier, ≥ 4,5:1 (pire ${worstOn.toFixed(1)}:1)`);
    const lost = on.hl.filter(([, v], i) => v < Math.min(7, off.hl[i][1] - 0.6));
    check(lost.length === 0, `${theme} : chaque surlignage reste ≥ 7:1, ou à moins de 0,6 de son contraste sans papier (pire ${worstOn.toFixed(1)} contre ${worstOff.toFixed(1)} sans)`, lost.length ? lost : undefined);
    check(on.sel >= 7, `${theme} : texte sélectionné ≥ 7:1 (${on.sel.toFixed(1)}:1, sans papier ${off.sel.toFixed(1)}:1)`);
  }
  await set(page, { theme: 'light' });
  await page.waitForTimeout(300);
  await page.evaluate(() => (document.querySelector('.reader-page[data-pane="a"] .html-scroll').scrollTop = 0));
  // Une sélection en cours, pour la voir sur le papier.
  await page.evaluate(() => {
    // Un long nœud texte non surligné, visible à l'écran.
    const root = document.querySelector('.reader-page[data-pane="a"] .html-chapter-text');
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.length < 150 || n.parentElement.closest('[data-hl-id]')) continue;
      const q = document.createRange();
      q.setStart(n, 10);
      q.setEnd(n, 140);
      if (q.getBoundingClientRect().bottom < 820) break;
    }
    if (!n) return;
    const r = document.createRange();
    r.setStart(n, 10);
    r.setEnd(n, 140);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await page.waitForTimeout(300);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, '05-papier-surlignage.png') });
  console.log('capture: shots/papier-aspect/05-papier-surlignage.png');
  await page.evaluate(() => getSelection().removeAllRanges());

  // Défilement d'un long livre : avec et sans l'aspect papier.
  console.log('\n== Défilement (40 chapitres) ==');
  await page.keyboard.press('Escape');
  // Échauffement : un premier passage met en page tous les chapitres (content-visibility),
  // puis mesures alternées avec et sans, en gardant la meilleure de chaque.
  await page.evaluate(async () => {
    const sc = document.querySelector('.reader-page[data-pane="a"] .html-scroll');
    for (let y = 0; y < 8000; y += 400) {
      sc.scrollTop = y;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  });
  const best = (a, b) => ({ ...(a.fps >= b.fps ? a : b), paints: Math.min(a.paints, b.paints), paintMs: Math.min(a.paintMs, b.paintMs) });
  for (const [marks, name] of [['numbered', 'colonne continue'], ['paper', 'feuilles']]) {
    console.log(`  — ${name}`);
    await set(page, { pageMarks: marks });
    await page.waitForTimeout(500);
    const runs = { on: [], off: [] };
    for (const mode of ['on', 'off', 'on', 'off']) {
      await set(page, { paperLook: mode === 'on' });
      await page.waitForTimeout(400);
      runs[mode].push(await scrollPerf(page, browser, mode === 'on' ? 'aspect papier' : 'sans         '));
    }
    const on = best(...runs.on);
    const off = best(...runs.off);
    check(on.fps >= off.fps * 0.9, `${name} : images/s au défilement non dégradées (${on.fps} contre ${off.fps})`);
    check(on.paints <= off.paints * 1.25 + 10, `${name} : pas de repeinture supplémentaire au défilement (${on.paints} contre ${off.paints})`);
    check(on.paintMs <= off.paintMs * 1.5 + 30, `${name} : temps de peinture équivalent (${on.paintMs} ms contre ${off.paintMs} ms)`);
  }
});

// Zoom sur le grain à 2× (rendu Retina) : 400 × 300.
await withApp(
  async (page) => {
    await set(page, { theme: 'light', pageMarks: 'numbered', paperLook: true, showToc: false, showExtracts: false });
    await importBuffer(page, 'meditations-papier.epub', await longEpub(3));
    await waitHtml(page);
    const clip = await page.evaluate(() => {
      const t = document.querySelector('.reader-page[data-pane="a"] .html-chapter-text p').getBoundingClientRect();
      return { x: Math.round(t.left - 160), y: Math.round(t.top - 20), width: 400, height: 300 };
    });
    await shot(page, '04-zoom-grain.png', clip);
  },
  { scale: 2 },
);

console.log(`\n${passes} OK, ${failures} échec(s)`);
process.exit(failures ? 1 : 0);
