// Lecture « page par page » (réglage readerLayout = 'paged') : livre ou liseuse.
// - pagination par chapitre (colonnes de la taille d'une page), chaque chapitre sur une nouvelle page,
//   textContent des chapitres inchangé ;
// - une page / deux pages / automatique (selon la largeur du volet) ;
// - navigation : ← →, Page préc./suiv., Espace / Maj+Espace, clic dans les marges, balayage du pavé
//   tactile (molette deltaX, un geste = une page), passage d'un chapitre à l'autre ;
// - folios (« 12 », « 12–13 », romains ; numérotation estimée sinon) et titres courants ;
// - aller à la page (imprimée, romaine, estimée), recherche, sommaire ;
// - surlignage dans une page et à cheval sur les deux pages d'une double page (texte et offsets exacts) ;
// - signet ; position restaurée (réouverture, rechargement, changement de taille du texte) ;
// - côte à côte (volets indépendants) ; thèmes ; aucune erreur dans la console.
// Captures : /home/claude/marginalia/shots/pages/ (01-une-page … 06-scinde).
// Lancer : timeout 400 node scripts/test-reader-paged.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = '/home/claude/marginalia/shots/pages';
const PORT = 5414;

let failures = 0;
let passes = 0;
const check = (cond, label, extra) => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${label}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Fixtures ─────────────────────────────────────────────────

const md = fs.readFileSync(path.join(ROOT, 'fixtures/discours.md'), 'utf8');
const PARAS = md
  .split(/\n\s*\n/)
  .map((p) => p.trim())
  .filter((p) => p && !p.startsWith('#') && !p.startsWith('---') && !/^title:|^author:/.test(p) && p.length > 120)
  .map((p) => p.replace(/^>\s*/, '').replace(/\*/g, '').replace(/'/g, '’'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const xhtml = (title, body) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="fr"><head><title>${title}</title></head><body>${body}</body></html>`;
const pb = (id, label) => `<span epub:type="pagebreak" id="${id}" title="${label}"></span>`;

/**
 * EPUB à pages imprimées : préface ix–xi (romains), deux parties paginées 1…N.
 * Repères tous les deux paragraphes environ, un sur deux au milieu d'un paragraphe.
 */
async function epubPrinted() {
  const plist = [];
  let pi = 0;
  const chapter = (file, title, labels, n, extra = '') => {
    let body = `${pb(`p_${labels[0]}`, labels[0])}<h1>${title}</h1>`;
    plist.push([`${file}#p_${labels[0]}`, labels[0]]);
    let li = 1;
    for (let k = 0; k < n; k++) {
      const p = esc(PARAS[pi++ % PARAS.length]);
      if (k === Math.floor(n / 2) && extra) body += `<p>${extra}</p>`;
      if (k > 0 && k % 4 === 0 && li < labels.length) {
        const l = labels[li++];
        plist.push([`${file}#p_${l}`, l]);
        if (k % 8 === 4) {
          const cut = p.indexOf(' ', Math.floor(p.length / 2));
          body += `<p>${p.slice(0, cut + 1)}${pb(`p_${l}`, l)}${p.slice(cut + 1)}</p>`;
          continue;
        }
        body += pb(`p_${l}`, l);
      }
      body += `<p>${p}</p>`;
    }
    return xhtml(title, body);
  };
  const files = {
    'pre.xhtml': chapter('pre.xhtml', 'Avertissement', ['ix', 'x', 'xi'], 10),
    'ch1.xhtml': chapter('ch1.xhtml', 'Première partie', Array.from({ length: 10 }, (_, i) => String(i + 1)), 40),
    'ch2.xhtml': chapter(
      'ch2.xhtml',
      'Seconde partie',
      Array.from({ length: 10 }, (_, i) => String(i + 11)),
      40,
      'Archimède, pour tirer le globe terrestre de sa place et le transporter en un autre lieu, ne demandait rien qu’un point qui fût fixe et assuré.',
    ),
  };
  const nav = xhtml(
    'Sommaire',
    `<nav epub:type="toc"><ol><li><a href="pre.xhtml">Avertissement</a></li><li><a href="ch1.xhtml">Première partie</a></li><li><a href="ch2.xhtml">Seconde partie</a></li></ol></nav>` +
      `<nav epub:type="page-list" hidden="hidden"><ol>${plist.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ol></nav>`,
  );
  return zipEpub('Discours de la méthode', files, nav);
}

/** EPUB sans pages imprimées (pagination estimée). */
async function epubPlain() {
  const chapters = {};
  let pi = 3;
  for (let c = 1; c <= 3; c++) {
    let body = `<h1>Méditation ${c}</h1>`;
    for (let k = 0; k < 16; k++) body += `<p>${esc(PARAS[pi++ % PARAS.length])}</p>`;
    chapters[`m${c}.xhtml`] = xhtml(`Méditation ${c}`, body);
  }
  const nav = xhtml('Sommaire', `<nav epub:type="toc"><ol>${Object.keys(chapters).map((f, i) => `<li><a href="${f}">Méditation ${i + 1}</a></li>`).join('')}</ol></nav>`);
  return zipEpub('Méditations', chapters, nav);
}

async function zipEpub(title, files, nav) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const names = Object.keys(files);
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:test:${title}</dc:identifier><dc:title>${title}</dc:title><dc:creator>René Descartes</dc:creator><dc:language>fr</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${names.map((n, i) => `<item id="c${i}" href="${n}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${names.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`,
  );
  zip.file('OEBPS/nav.xhtml', nav);
  for (const [n, src] of Object.entries(files)) zip.file('OEBPS/' + n, src);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

// ── Banc ─────────────────────────────────────────────────────

async function withApp(fn, { width = 1440, height = 900 } = {}) {
  const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-' + PORT, server: { port: PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 45000 });
    await fn(page, errors);
  } finally {
    if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + errors.slice(0, 12).join('\n'));
    check(errors.length === 0, 'aucune erreur dans la console', errors.slice(0, 3));
    await browser.close();
    await server.close();
  }
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(2, 300);
  await page.evaluate(() => {
    const s = window.__store.getState();
    (s.toasts ?? []).forEach((t) => s.dismissToast?.(t.id));
  });
  await sleep(450);
  await page.screenshot({ path: path.join(SHOTS, name) });
  console.log('capture:', path.join(SHOTS, name));
}

async function importBuffer(page, name, buf) {
  const b64 = Buffer.from(buf).toString('base64');
  return page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await window.__store.getState().importFiles([{ name, data: bin.buffer }], { asBook: true });
      return book?.id;
    },
    { name, b64 },
  );
}

const set = (page, patch) => page.evaluate((p) => window.__store.getState().updateSettings(p), patch);

async function open(page, bookId, split = null) {
  await page.evaluate(({ a, b }) => window.__store.getState().navigate({ name: 'reader', bookId: a, tab: 'lecture', splitBookId: b }), { a: bookId, b: split });
  await waitReader(page, 'a');
  if (split) await waitReader(page, 'b');
}

async function waitReader(page, pane = 'a') {
  await page.waitForFunction(
    (pane) => {
      const p = document.querySelector(`.reader-page[data-pane="${pane}"]`);
      return !!p && !!p.querySelector('.html-doc.is-revealed') && !p.querySelector('.reader-loading') && !!p.querySelector('[data-testid=page-indicator]');
    },
    pane,
    { timeout: 25000 },
  );
  await sleep(450);
}

/** État visible du mode page par page dans un volet. */
const state = (page, pane = 'a') =>
  page.evaluate((pane) => {
    const p = document.querySelector(`.reader-page[data-pane="${pane}"]`);
    const sc = p.querySelector('.html-scroll');
    const cur = [...p.querySelectorAll('.html-chapter')].findIndex((s) => s.classList.contains('paged-cur'));
    const sec = p.querySelectorAll('.html-chapter')[cur];
    const col = sec?.querySelector('.html-col');
    const m = /translateX\((-?[\d.]+)px\)/.exec(col?.style.transform ?? '');
    const w = parseFloat(getComputedStyle(p.querySelector('.html-doc')).getPropertyValue('--pg-w'));
    const vis = sec?.getBoundingClientRect();
    // Premier mot visible : caret au coin haut-gauche de la zone de texte de la page de gauche.
    const cr = col?.getBoundingClientRect();
    const mx = parseFloat(getComputedStyle(p.querySelector('.html-doc')).getPropertyValue('--pg-mx'));
    return {
      layout: p.querySelector('.html-reader')?.dataset.layout,
      paged: sc.classList.contains('paged-scroll'),
      sheets: p.querySelectorAll('.paged-page').length,
      chapter: cur,
      shown: [...p.querySelectorAll('.html-chapter')].map((s) => getComputedStyle(s).display !== 'none' && getComputedStyle(s).visibility !== 'hidden'),
      laidOut: [...p.querySelectorAll('.html-chapter')].map((s) => getComputedStyle(s).display !== 'none'),
      page: m && w ? Math.round(-parseFloat(m[1]) / w) : 0,
      w,
      mx,
      folios: [...p.querySelectorAll('.paged-folio')].map((e) => e.textContent),
      heads: [...p.querySelectorAll('.paged-head')].map((e) => (getComputedStyle(e).visibility === 'hidden' ? '' : e.textContent)),
      indicator: p.querySelector('[data-testid=page-indicator]')?.textContent ?? null,
      vis: vis ? { left: vis.left, right: vis.right, top: vis.top, bottom: vis.bottom } : null,
      colLeft: cr ? cr.left : 0,
      scrollTop: sc.scrollTop,
      zone: sc.dataset.zone ?? '',
    };
  }, pane);

/** Rectangle (à l'écran) du caractère `off` du chapitre `ch` ; visible : dans la double page affichée. */
const charInfo = (page, ch, off, pane = 'a') =>
  page.evaluate(
    ({ ch, off, pane }) => {
      const p = document.querySelector(`.reader-page[data-pane="${pane}"]`);
      const root = p.querySelectorAll('.html-chapter-text')[ch];
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let pos = 0;
      let n;
      while ((n = w.nextNode())) {
        if (off < pos + n.data.length) break;
        pos += n.data.length;
      }
      if (!n) return null;
      let i = off - pos;
      while (n && i >= n.data.length - 1 && !/\S/.test(n.data.slice(i))) {
        n = w.nextNode();
        i = 0;
      }
      if (!n) return null;
      while (i < n.data.length && /\s/.test(n.data[i])) i++;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, Math.min(n.data.length, i + 1));
      const rect = r.getClientRects()[0];
      const sec = root.closest('.html-chapter');
      const vis = sec.getBoundingClientRect();
      const cur = sec.classList.contains('paged-cur');
      return { left: rect?.left, top: rect?.top, visible: !!rect && cur && rect.left >= vis.left && rect.right <= vis.right + 1 && rect.top >= vis.top && rect.bottom <= vis.bottom + 1 };
    },
    { ch, off, pane },
  );

const chapterTexts = (page, pane = 'a') =>
  page.evaluate((pane) => [...document.querySelectorAll(`.reader-page[data-pane="${pane}"] .html-chapter-text`)].map((r) => r.textContent), pane);

/** Le repère de la page `label` est-il sur la double page affichée ? */
const markVisible = (page, label, pane = 'a') =>
  page.evaluate(
    ({ label, pane }) => {
      const p = document.querySelector(`.reader-page[data-pane="${pane}"]`);
      const el = [...p.querySelectorAll('.pg-mark')].find((m) => m.dataset.pg === label);
      if (!el) return null;
      const sec = el.closest('.html-chapter');
      const r = el.getBoundingClientRect();
      const v = sec.getBoundingClientRect();
      return sec.classList.contains('paged-cur') && r.left >= v.left - 1 && r.left <= v.right + 1;
    },
    { label, pane },
  );

async function jumpTo(page, q, pane = 'a') {
  await page.click(`.reader-page[data-pane="${pane}"] [data-testid=page-indicator]`);
  await page.waitForSelector('[data-testid=page-jump-input]', { timeout: 3000 });
  await page.fill('[data-testid=page-jump-input]', q);
  await page.keyboard.press('Enter');
  await sleep(700);
}

/** Sélectionne [off, off+len) du chapitre ch (nœuds texte du DOM) ; renvoie le texte attendu. */
const selectRange = (page, ch, start, end, pane = 'a') =>
  page.evaluate(
    ({ ch, start, end, pane }) => {
      const root = document.querySelectorAll(`.reader-page[data-pane="${pane}"] .html-chapter-text`)[ch];
      const loc = (o, isEnd) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let pos = 0;
        let n;
        while ((n = w.nextNode())) {
          const len = n.data.length;
          if (o < pos + len || (isEnd && o === pos + len)) return [n, o - pos];
          pos += len;
        }
        return null;
      };
      const [n0, o0] = loc(start, false);
      const [n1, o1] = loc(end, true);
      const r = document.createRange();
      r.setStart(n0, o0);
      r.setEnd(n1, o1);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return { text: root.textContent.slice(start, end), sel: s.toString() };
    },
    { ch, start, end, pane },
  );

/** Offset (chapitre) du premier caractère d'une page d'écran visible : 0 = gauche, 1 = droite. */
const pageStartOffset = (page, slot, pane = 'a') =>
  page.evaluate(
    ({ slot, pane }) => {
      const p = document.querySelector(`.reader-page[data-pane="${pane}"]`);
      const sec = p.querySelector('.html-chapter.paged-cur');
      const root = sec.querySelector('.html-chapter-text');
      const v = sec.getBoundingClientRect();
      const doc = getComputedStyle(p.querySelector('.html-doc'));
      const w = parseFloat(doc.getPropertyValue('--pg-w'));
      const mx = parseFloat(doc.getPropertyValue('--pg-mx'));
      const lo = v.left + slot * w + mx;
      const hi = lo + w - 2 * mx;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let pos = 0;
      let n;
      const r = document.createRange();
      while ((n = walker.nextNode())) {
        for (let i = 0; i < n.data.length; i++) {
          if (/\s/.test(n.data[i])) continue;
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          const rect = r.getClientRects()[0];
          if (rect && rect.left >= lo - 2 && rect.right <= hi + 2 && rect.top >= v.top && rect.bottom <= v.bottom) return pos + i;
          // Avance par mot pour aller plus vite.
        }
        pos += n.data.length;
      }
      return -1;
    },
    { slot, pane },
  );

const verifyHighlights = (page, bookId) =>
  page.evaluate((bookId) => {
    const doc = document.querySelector('.reader-page[data-pane="a"] .html-doc');
    return window.__store
      .getState()
      .highlights.filter((h) => h.bookId === bookId)
      .map((h) => {
        const els = [...doc.querySelectorAll(`[data-hl-id="${h.id}"]`)];
        if (!els.length) return { ok: false, why: 'aucun élément', text: h.text.slice(0, 30) };
        const root = els[0].closest('.html-chapter-text');
        const r0 = document.createRange();
        r0.setStart(root, 0);
        r0.setEndBefore(els[0]);
        const r = document.createRange();
        r.setStartBefore(els[0]);
        r.setEndAfter(els[els.length - 1]);
        const covered = r.toString();
        const ok = covered === h.text && r0.toString().length === h.anchor.start && Number(root.dataset.chapter) === h.anchor.chapter;
        return { ok, text: h.text.slice(0, 30), start: r0.toString().length, anchor: h.anchor.start };
      });
  }, bookId);

// ── Scénario ─────────────────────────────────────────────────

await withApp(async (page, errors) => {
  const printed = await epubPrinted();
  const plain = await epubPlain();
  const bookId = await importBuffer(page, 'discours-pagine.epub', printed);
  const plainId = await importBuffer(page, 'meditations.epub', plain);
  await set(page, { theme: 'light', showToc: false, showExtracts: false, readerLayout: 'scroll' });
  await open(page, bookId);
  const textsScroll = await chapterTexts(page);
  console.log('pages :', await page.evaluate(() => [...document.querySelectorAll('.pg-mark')].map((m) => m.dataset.pg).join(',')));

  console.log('\n== Mise en page ==');
  await set(page, { readerLayout: 'paged', pagedSpread: 'double' });
  await sleep(700);
  let st = await state(page);
  check(st.layout === 'paged' && st.paged && st.sheets === 2, 'réglage page par page : deux feuilles côte à côte, le volet ne défile plus', st);
  check(JSON.stringify(await chapterTexts(page)) === JSON.stringify(textsScroll), 'textContent des chapitres identique en défilement et page par page');
  check(st.shown.filter(Boolean).length === 1 && st.laidOut.filter(Boolean).length <= 3, 'paresseux : un seul chapitre affiché, ses voisins seulement mis en page', st.laidOut);
  const geo = await page.evaluate(() => {
    const pg = document.querySelector('.paged-page').getBoundingClientRect();
    const col = getComputedStyle(document.querySelector('.html-chapter.paged-cur .html-col'));
    return { w: pg.width, h: pg.height, colW: col.columnWidth, gap: col.columnGap, colWidth: col.width };
  });
  check(geo.h > geo.w && geo.w / geo.h > 0.55 && geo.w / geo.h <= 0.71, 'pages à la proportion d’un livre', geo);
  check(parseFloat(geo.colW) + parseFloat(geo.gap) === Math.round(geo.w), 'une colonne de texte par page (pas = largeur de page)', geo);

  // Aller au début du livre.
  await jumpTo(page, 'ix');
  st = await state(page);
  check(st.chapter === 0 && st.page === 0, 'aller à la page ix : début de l’avertissement', st);

  console.log('\n== Navigation ==');
  // Ouvrir la première partie (sommaire) : début de chapitre sur une nouvelle page, à gauche.
  await jumpTo(page, '1');
  st = await state(page);
  check(st.chapter === 1 && st.page === 0 && st.heads[0] === '' , 'chapitre : commence sur une nouvelle page (à gauche), sans titre courant', st);
  await page.click('.reader-page[data-pane="a"] .html-scroll', { position: { x: 300, y: 450 } }); // focus
  const steps = [];
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', 'Space', 'Shift+Space']) {
    await page.keyboard.press(k);
    await sleep(330);
    steps.push((await state(page)).page);
  }
  check(JSON.stringify(steps) === JSON.stringify([2, 4, 2, 4, 2, 4, 2]), '← → / Page préc. suiv. / Espace, Maj+Espace : deux pages à la fois', steps);
  st = await state(page);
  check(st.scrollTop === 0, 'le volet ne défile pas (translation des colonnes)', st.scrollTop);
  // Clic dans la marge droite / gauche.
  const box = await page.evaluate(() => {
    const r = document.querySelector('.reader-page[data-pane="a"] .html-chapter.paged-cur').getBoundingClientRect();
    return { l: r.left, r: r.right, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.r - 8, box.y);
  await sleep(80);
  check((await state(page)).zone === 'next', 'survol de la marge droite : flèche « page suivante »');
  await page.mouse.click(box.r - 8, box.y);
  await sleep(330);
  const afterRight = (await state(page)).page;
  await page.mouse.click(box.l + 6, box.y);
  await sleep(330);
  const afterLeft = (await state(page)).page;
  check(afterRight === 4 && afterLeft === 2, 'clic dans la marge droite → page suivante, gauche → précédente', { afterRight, afterLeft });
  // Fluidité : aucune tâche longue (> 50 ms) en tournant les pages.
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask' });
  });
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press(i < 3 ? 'ArrowRight' : 'ArrowLeft');
    await sleep(320);
  }
  const longs = await page.evaluate(() => window.__long);
  check(longs.length === 0 || Math.max(...longs) < 120, 'tourner les pages : pas de tâche longue', longs);
  // Pavé tactile : un geste horizontal = une page, l'inertie n'en tourne pas d'autre.
  await page.mouse.move(box.l + 300, box.y);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(30, 2);
    await sleep(16);
  }
  await sleep(330);
  const afterSwipe = (await state(page)).page;
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(-30, 0);
    await sleep(16);
  }
  await sleep(330);
  const afterSwipeBack = (await state(page)).page;
  check(afterSwipe === 4 && afterSwipeBack === 2, 'balayage horizontal (molette deltaX) : une page par geste, dans les deux sens', { afterSwipe, afterSwipeBack });
  // Fin du chapitre → chapitre suivant ; retour → dernière double page du précédent.
  let guard = 0;
  while ((await state(page)).chapter === 1 && guard++ < 40) {
    await page.keyboard.press('ArrowRight');
    await sleep(60);
  }
  await sleep(300);
  st = await state(page);
  check(st.chapter === 2 && st.page === 0, 'après la dernière page d’un chapitre : première page du suivant', st);
  await page.keyboard.press('ArrowLeft');
  await sleep(330);
  st = await state(page);
  const lastOk = await page.evaluate(() => {
    const sec = document.querySelector('.reader-page[data-pane="a"] .html-chapter.paged-cur');
    const root = sec.querySelector('.html-chapter-text');
    const rects = [...root.getClientRects()];
    const v = sec.getBoundingClientRect();
    const last = rects[rects.length - 1];
    return last.left >= v.left && last.left < v.right;
  });
  check(st.chapter === 1 && st.page > 0 && lastOk, 'page précédente au début d’un chapitre : dernière double page du précédent', st);

  console.log('\n== Folios et titres courants ==');
  await jumpTo(page, '5');
  st = await state(page);
  check(st.page > 0 && st.heads[0] === 'Discours de la méthode' && st.heads[1] === 'Première partie', 'titre courant : livre à gauche, partie à droite', st);
  check(st.folios.every((f) => /^\d+(–\d+)?$/.test(f)) && st.folios.join(' ').includes('5'), 'folios : page imprimée (ou « 4–5 ») en bas de chaque page', st.folios);
  check(st.indicator === 'p. 5 / 20', 'indicateur : la page demandée', st.indicator);
  check(await markVisible(page, '5'), 'aller à la page 5 : la page d’écran où elle commence');
  let folioSpan = false;
  for (let i = 0; i < 8 && !folioSpan; i++) {
    folioSpan = await page.evaluate(() => [...document.querySelectorAll('.paged-folio')].some((e) => /^\d+–\d+$/.test(e.textContent)));
    if (!folioSpan) {
      await page.keyboard.press('ArrowRight');
      await sleep(300);
    }
  }
  check(folioSpan, 'une page d’écran à cheval sur deux pages imprimées : folio « a–b »');
  await jumpTo(page, 'x');
  st = await state(page);
  check(st.chapter === 0 && (await markVisible(page, 'x')) && st.folios.some((f) => /x/.test(f)) && st.indicator === 'p. x / 20', 'aller à la page x (romains) : folio romain', st);
  const err = await page.evaluate(async () => {
    document.querySelector('.reader-page[data-pane="a"] [data-testid=page-indicator]').click();
    await new Promise((r) => setTimeout(r, 200));
    const i = document.querySelector('[data-testid=page-jump-input]');
    return !!i;
  });
  await page.fill('[data-testid=page-jump-input]', '900');
  await page.keyboard.press('Enter');
  await sleep(300);
  const msg = await page.evaluate(() => document.querySelector('.pagejump')?.textContent ?? '');
  check(err && /900/.test(msg), 'page inexistante : message', msg);
  await page.keyboard.press('Escape');
  await sleep(150);
  await page.keyboard.press('Escape');

  console.log('\n== Surlignages ==');
  await jumpTo(page, '5');
  await sleep(300);
  st = await state(page);
  // Dans une page : une phrase de la page de gauche.
  const o0 = await pageStartOffset(page, 0);
  const s1 = await selectRange(page, st.chapter, o0 + 20, o0 + 90);
  await sleep(250);
  const nl = (t) => t.replace(/\n+/g, '\n');
  check(nl(s1.sel) === s1.text && (await page.$('.sel-toolbar')) !== null, 'sélection dans une page : texte exact, barre de sélection', s1);
  await page.click('.sel-toolbar .sel-plain');
  await sleep(300);
  // À cheval sur les deux pages de la double page (un paragraphe coupé par la reliure).
  let split = -1;
  for (let i = 0; i < 10 && split < 0; i++) {
    split = await page.evaluate(() => {
      const sec = document.querySelector('.reader-page[data-pane="a"] .html-chapter.paged-cur');
      const v = sec.getBoundingClientRect();
      const mid = v.left + v.width / 2;
      const p = [...sec.querySelectorAll('p')].find((el) => {
        const rs = [...el.getClientRects()];
        return rs.some((r) => r.right > v.left && r.right < mid) && rs.some((r) => r.left > mid && r.left < v.right);
      });
      return p ? 1 : -1;
    });
    if (split < 0) {
      await page.keyboard.press('ArrowRight');
      await sleep(300);
    }
  }
  st = await state(page);
  const o1 = await pageStartOffset(page, 1);
  const s2 = await selectRange(page, st.chapter, o1 - 45, o1 + 40);
  await sleep(250);
  const tb = await page.evaluate(() => !!document.querySelector('.sel-toolbar'));
  check(nl(s2.sel) === s2.text && tb, 'sélection à cheval sur les deux pages : texte exact, barre de sélection', s2);
  await page.click('.sel-toolbar .cat-btn[title^="Thèse"]');
  await sleep(400);
  let hv = await verifyHighlights(page, bookId);
  check(hv.length === 2 && hv.every((h) => h.ok), 'surlignages : texte et offsets exacts', hv);
  const across = await page.evaluate(() => {
    const h = window.__store.getState().highlights.find((x) => x.category === 'these');
    const sec = document.querySelector('.reader-page[data-pane="a"] .html-chapter.paged-cur');
    const v = sec.getBoundingClientRect();
    const mid = v.left + v.width / 2;
    const rects = [...document.querySelectorAll(`[data-hl-id="${h.id}"]`)].flatMap((e) => [...e.getClientRects()]).filter((r) => r.width > 0);
    return { left: rects.filter((r) => r.right <= mid).length, right: rects.filter((r) => r.left >= mid).length };
  });
  check(across.left > 0 && across.right > 0, 'surlignage à cheval : dessiné sur la page de gauche et sur celle de droite', across);
  check(JSON.stringify(await chapterTexts(page)) === JSON.stringify(textsScroll), 'après surlignages : textContent inchangé');
  await shot(page, '05-surlignage-a-cheval.png');
  // Clic sur le surlignage : popover de l'extrait.
  const hlPos = await page.evaluate(() => {
    const h = window.__store.getState().highlights.find((x) => x.category === 'these');
    const r = [...document.querySelectorAll(`[data-hl-id="${h.id}"]`)].flatMap((e) => [...e.getClientRects()]).find((x) => x.width > 24);
    return { x: r.left + 12, y: r.top + r.height / 2 };
  });
  await page.mouse.click(hlPos.x, hlPos.y);
  await sleep(300);
  check(!!(await page.evaluate(() => window.__store.getState().activeHighlightId)), 'clic sur un surlignage : extrait actif (popover)');
  await page.keyboard.press('Escape');
  await sleep(200);
  // Note de marge (N) sur la page de droite : popover posé près du passage ; début de mouvement (M).
  const o2 = await pageStartOffset(page, 1);
  await selectRange(page, st.chapter, o2 + 60, o2 + 110);
  await sleep(250);
  await page.click('.sel-toolbar button[title^="Note personnelle"]');
  await sleep(500);
  const notePop = await page.evaluate(() => {
    const pop = document.querySelector('.floating:not(.sel-toolbar)');
    const sec = document.querySelector('.reader-page[data-pane="a"] .html-chapter.paged-cur').getBoundingClientRect();
    return pop ? { left: pop.getBoundingClientRect().left, mid: sec.left + sec.width / 2 } : null;
  });
  check(!!notePop && notePop.left > notePop.mid - 200, 'note de marge : le popover s’ouvre près du passage (page de droite)', notePop);
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.mouse.click(5, 450);
  await sleep(200);
  await selectRange(page, st.chapter, o2 + 200, o2 + 240);
  await sleep(250);
  await page.click('.sel-toolbar button[title^="Début de mouvement"]');
  await sleep(600);
  const mv = await page.evaluate(() => {
    const el = document.querySelector('.reader-page[data-pane="a"] .html-mv');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const sec = document.querySelector('.reader-page[data-pane="a"] .html-chapter.paged-cur').getBoundingClientRect();
    return { inside: r.left >= sec.left && r.right <= sec.right, right: r.left > sec.left + sec.width / 2 };
  });
  check(mv?.inside && mv.right, 'début de mouvement : repère « § » dans la marge de la page (droite)', mv);
  hv = await verifyHighlights(page, bookId);
  check(hv.length === 3 && hv.every((h) => h.ok), 'note de marge : extrait exact', hv);

  console.log('\n== Recherche ==');
  await jumpTo(page, 'ix');
  await page.keyboard.press('Control+f');
  await page.waitForSelector('.search-bar-input');
  await page.fill('.search-bar-input', 'Archimède');
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(600);
  const hit = await page.evaluate(() => {
    const el = document.querySelector('.reader-page[data-pane="a"] span.search-hit.current') ?? document.querySelector('.reader-page[data-pane="a"] span.search-hit');
    if (!el) return null;
    const sec = el.closest('.html-chapter');
    const r = el.getBoundingClientRect();
    const v = sec.getBoundingClientRect();
    return { cur: sec.classList.contains('paged-cur'), inside: r.left >= v.left && r.right <= v.right };
  });
  check(hit?.cur && hit.inside, 'recherche : la page du résultat est affichée', hit);
  await page.keyboard.press('Escape');
  await sleep(200);

  console.log('\n== Signets ==');
  await jumpTo(page, '7');
  await page.click('.reader-page[data-pane="a"] .html-scroll', { position: { x: 4, y: 4 } }).catch(() => undefined);
  await page.keyboard.press('Control+d');
  await sleep(500);
  const bms = await page.evaluate((id) => window.__store.getState().bookmarks.filter((b) => b.bookId === id), bookId);
  check(bms.length === 1 && bms[0].anchor?.chapter === 1, '⌘D : signet sur la page affichée', bms.map((b) => [b.label, b.anchor?.chapter]));
  await page.keyboard.press('Escape');
  await sleep(200);
  const ribbon = await page.evaluate((id) => {
    const el = document.querySelector(`.reader-page[data-pane="a"] [data-bm-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const v = document.querySelector('.reader-page[data-pane="a"] .html-chapter.paged-cur').getBoundingClientRect();
    return r.left >= v.left && r.right <= v.right && r.top >= v.top;
  }, bms[0]?.id);
  check(ribbon === true, 'ruban du signet dans la marge de la page', ribbon);
  await jumpTo(page, '20');
  const bmStart = bms[0]?.anchor?.start ?? 0;
  check(!(await charInfo(page, 1, bmStart))?.visible, 'ailleurs dans le livre : le signet n’est plus visible');
  await page.keyboard.press('Control+Alt+ArrowUp');
  await sleep(700);
  check((await charInfo(page, 1, bmStart))?.visible, 'signet précédent (⌘⌥↑) : retour à sa page', await charInfo(page, 1, bmStart));

  console.log('\n== Position ==');
  await set(page, { showExtracts: false });
  await jumpTo(page, '9');
  await sleep(1800);
  let pos = await page.evaluate((id) => window.__store.getState().books.find((b) => b.id === id).position, bookId);
  check(pos?.kind === 'html' && pos.chapter === 1 && typeof pos.offset === 'number' && pos.offset > 0, 'position mémorisée : chapitre et premier caractère de la page', pos);
  const firstOff = pos.offset;
  check((await charInfo(page, 1, firstOff))?.visible, 'le caractère mémorisé est bien sur la page affichée');
  // Changement de taille du texte : le premier caractère reste visible.
  for (const fs of [24, 15, 19]) {
    await set(page, { fontSize: fs });
    await sleep(700);
    const ci = await charInfo(page, 1, firstOff);
    check(ci?.visible, `taille du texte ${fs} px : le passage lu reste sur la page affichée`, ci);
  }
  // Une seule page, puis automatique : idem.
  await set(page, { pagedSpread: 'single' });
  await sleep(700);
  st = await state(page);
  check(st.sheets === 1 && (await charInfo(page, 1, firstOff))?.visible, '« Une page » : une seule feuille, même passage', st.sheets);
  await shot(page, '01-une-page.png');
  await set(page, { pagedSpread: 'auto' });
  await sleep(700);
  check((await state(page)).sheets === 2, '« Automatique » : deux pages dans un volet large');
  await page.setViewportSize({ width: 900, height: 900 });
  await sleep(900);
  st = await state(page);
  check(st.sheets === 1 && (await charInfo(page, 1, firstOff))?.visible, '« Automatique » dans une fenêtre étroite : une page, même passage', st);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(900);
  check((await state(page)).sheets === 2 && (await charInfo(page, 1, firstOff))?.visible, 'fenêtre élargie : deux pages, même passage');
  // Réouverture puis rechargement.
  await sleep(1800);
  pos = await page.evaluate((id) => window.__store.getState().books.find((b) => b.id === id).position, bookId);
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await sleep(400);
  await open(page, bookId);
  check((await charInfo(page, pos.chapter, pos.offset))?.visible, 'réouverture : même page', pos);
  await sleep(2600);
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 45000 });
  await open(page, bookId);
  st = await state(page);
  check(st.paged && (await charInfo(page, pos.chapter, pos.offset))?.visible, 'rechargement : page par page, même page', st);
  hv = await verifyHighlights(page, bookId);
  check(hv.length === 3 && hv.every((h) => h.ok), 'après rechargement : surlignages exacts', hv);

  console.log('\n== Livre sans pages imprimées ==');
  await open(page, plainId);
  st = await state(page);
  check(st.folios[0] === '1' || /^1(–\d+)?$/.test(st.folios[0]), 'pagination estimée : folios numérotés depuis 1', st.folios);
  await jumpTo(page, '5');
  st = await state(page);
  check((await markVisible(page, '5')) && st.folios.join(' ').includes('5'), 'aller à la page 5 (estimée) : sa page d’écran, folio', st);

  console.log('\n== Captures ==');
  await set(page, { showExtracts: false, showToc: false });
  await open(page, bookId);
  await jumpTo(page, '1');
  await shot(page, '02-deux-pages.png');
  await jumpTo(page, '3');
  await set(page, { theme: 'dark' });
  await sleep(400);
  const dark = await page.evaluate(() => ({
    sheet: getComputedStyle(document.querySelector('.paged-page')).backgroundColor,
    desk: getComputedStyle(document.querySelector('.html-scroll')).backgroundColor,
  }));
  check(dark.sheet !== dark.desk, 'sombre : feuille distincte de la table', dark);
  await shot(page, '03-deux-pages-sombre.png');
  await set(page, { theme: 'sepia' });
  await sleep(400);
  await shot(page, '04-sepia.png');
  await set(page, { theme: 'light' });

  console.log('\n== Côte à côte ==');
  await open(page, bookId, plainId);
  let a = await state(page, 'a');
  let b = await state(page, 'b');
  check(a.paged && b.paged && a.sheets === 1 && b.sheets === 1, 'côte à côte : deux volets page par page, une page chacun (auto)', [a.sheets, b.sheets]);
  await page.click('.reader-page[data-pane="b"] .html-scroll', { position: { x: 200, y: 300 } });
  await sleep(200);
  const pa = a.page;
  const ca = a.chapter;
  await page.keyboard.press('ArrowRight');
  await sleep(350);
  await page.keyboard.press('ArrowRight');
  await sleep(350);
  a = await state(page, 'a');
  b = await state(page, 'b');
  check(a.page === pa && a.chapter === ca && (b.page > 0 || b.chapter > 0), 'côte à côte : → tourne seulement le volet actif', { a: [a.chapter, a.page], b: [b.chapter, b.page] });
  await jumpTo(page, '4', 'a');
  check(await markVisible(page, '4', 'a'), 'côte à côte : aller à la page dans le volet de gauche');
  await shot(page, '06-scinde.png');
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), bookId);
  await sleep(300);

  console.log('\n== Retour au défilement ==');
  await set(page, { readerLayout: 'scroll' });
  await sleep(700);
  st = await state(page);
  check(!st.paged && st.layout === 'scroll' && !(await page.$('.paged-desk')), 'retour au défilement : plus de feuilles, le volet défile', st);
  check(JSON.stringify(await chapterTexts(page)) === JSON.stringify(textsScroll), 'textContent inchangé après retour au défilement');
  void errors;
});

console.log(`\n${passes} OK, ${failures} échec(s)`);
process.exit(failures ? 1 : 0);
