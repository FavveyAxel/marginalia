// Lecture « page par page » (réglage readerLayout = 'paged') : livre ou liseuse.
// - pagination par chapitre (colonnes de la taille d'une page), chaque chapitre sur une nouvelle page,
//   textContent des chapitres inchangé ;
// - une page / deux pages / automatique (selon la largeur du volet) ;
// - navigation : ← →, Page préc./suiv., Espace / Maj+Espace, clic dans les marges, balayage du pavé
//   tactile (molette deltaX, un geste = une page), passage d'un chapitre à l'autre ;
// - folios : un seul numéro, la page du livre en cours au premier caractère de la page d'écran (répété
//   si besoin, jamais « 12–13 » ; romains ; numérotation estimée sinon) et titres courants ;
// - pastille numérotée dans la marge extérieure où une page du livre commence en cours de page d'écran
//   (encoche au mot exact ; aucune si la page commence en haut ; masquées avec les numéros) ;
// - aller à la page (imprimée, romaine, estimée), recherche, sommaire ;
// - surlignage dans une page et à cheval sur les deux pages d'une double page (texte et offsets exacts) ;
// - signet ; position restaurée (réouverture, rechargement, changement de taille du texte) ;
// - côte à côte (volets indépendants) ; thèmes ; aucune erreur dans la console ;
// - débordement (livre long, ≈ 470 pages) : aucune ligne du chapitre lu visible hors de la page ou
//   de la double page (rectangles des lignes, et au pixel près sur une capture), chaque ligne dans sa
//   case de colonne, pas des colonnes mesuré = largeur de page ; mise en page livre oui/non × serif/sans
//   × une/deux pages × panneau « Aa » ouvert/fermé, après bascule de la mise en page livre et après
//   redimensionnement (passage lu gardé) ; découpe du document même si celle du chapitre manquait.
// Captures : /home/claude/marginalia/shots/pages/ (01-une-page … 06-scinde).
// Lancer : timeout 400 node scripts/test-reader-paged.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { epubLong } from './fixtures-books.mjs';

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

/**
 * Folios et pastilles des pages d'écran affichées, comparés à la vérité du DOM : pour chaque feuille,
 * le premier caractère visible et le dernier repère de page qui le précède (la page en cours) ; pour
 * chaque repère qui commence sur une feuille ailleurs qu'à son premier caractère, sa pastille.
 */
const folioAudit = (page, pane = 'a') =>
  page.evaluate((pane) => {
    const p = document.querySelector(`.reader-page[data-pane="${pane}"]`);
    const sec = p.querySelector('.html-chapter.paged-cur');
    const root = sec.querySelector('.html-chapter-text');
    const v = sec.getBoundingClientRect();
    const doc = getComputedStyle(p.querySelector('.html-doc'));
    const w = parseFloat(doc.getPropertyValue('--pg-w'));
    const mx = parseFloat(doc.getPropertyValue('--pg-mx'));
    const sheets = [...p.querySelectorAll('.paged-page')];
    const marks = [...p.querySelectorAll('.pg-mark')];
    const firstChar = (slot) => {
      const lo = v.left + slot * w + mx;
      const hi = lo + w - 2 * mx;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const r = document.createRange();
      let n;
      while ((n = walker.nextNode())) {
        const nr = document.createRange();
        nr.selectNodeContents(n);
        if (![...nr.getClientRects()].some((q) => q.right > lo - 2 && q.left < hi + 2)) continue;
        for (let i = 0; i < n.data.length; i++) {
          if (/\s/.test(n.data[i])) continue;
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          const rect = r.getClientRects()[0];
          if (rect && rect.left >= lo - 2 && rect.right <= hi + 2 && rect.top >= v.top && rect.bottom <= v.bottom) return { node: n, i, rect };
        }
      }
      return null;
    };
    const before = (m, node) => !!(m.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
    // Rectangle du premier caractère non blanc après un repère.
    const charAfter = (m) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      walker.currentNode = m;
      let n;
      const r = document.createRange();
      while ((n = walker.nextNode())) {
        for (let i = 0; i < n.data.length; i++) {
          if (/\s/.test(n.data[i])) continue;
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          return { node: n, i, rect: r.getClientRects()[0] };
        }
      }
      return null;
    };
    const pills = [...p.querySelectorAll('.paged-pill')]
      .filter((e) => e.offsetParent && getComputedStyle(e.parentElement).display !== 'none')
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.right > v.left && r.left < v.right);
    const out = sheets.map((sheet, slot) => {
      const sr = sheet.getBoundingClientRect();
      const folioEl = sheet.querySelector('.paged-folio');
      const headEl = sheet.querySelector('.paged-head');
      const fc = sheet.classList.contains('is-blank') ? null : firstChar(slot);
      let truth = '';
      if (fc) for (const m of marks) if (before(m, fc.node) || (m.nextSibling === fc.node && fc.i === 0)) truth = m.dataset.pg;
      // Repères qui commencent sur cette feuille, après son premier caractère.
      const starts = [];
      if (fc)
        for (const m of root.querySelectorAll('.pg-mark')) {
          if (/pg-chap|pg-start/.test(m.className)) continue;
          const c = charAfter(m);
          if (!c?.rect) continue;
          const cx = c.rect.left + c.rect.width / 2;
          if (cx < sr.left || cx > sr.right || c.rect.top < v.top || c.rect.bottom > v.bottom) continue;
          if (c.node === fc.node && c.i === fc.i) continue;
          // Encoche : dessinée juste devant le premier caractère de la page, sur sa ligne.
          const tk = [...p.querySelectorAll(`.paged-tick[data-pg-index="${m.dataset.pgIndex}"]`)].map((e) => e.getBoundingClientRect()).find((t) => t.height > 0);
          const tick = !!tk && Math.abs(tk.left - c.rect.left) <= 2.5 && tk.top >= c.rect.top - 1 && tk.bottom <= c.rect.bottom + 1;
          starts.push({ label: m.dataset.pg, y: c.rect.top + c.rect.height / 2, inline: m.classList.contains('pg-inline'), tick });
        }
      const mine = pills.filter(({ r }) => r.left + r.width / 2 > sr.left && r.left + r.width / 2 < sr.right);
      const fr = folioEl.getBoundingClientRect();
      const hr = headEl.getBoundingClientRect();
      const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return {
        slot,
        folio: folioEl.textContent,
        truth,
        starts,
        pills: mine.map(({ e, r }) => ({
          label: e.textContent,
          y: r.top + r.height / 2,
          side: r.right <= sr.left + mx + 1 ? 'left' : r.left >= sr.right - mx - 1 ? 'right' : 'text',
          inSheet: r.left >= sr.left && r.right <= sr.right,
          clipped: r.left < v.left - 0.5 || r.right > v.right + 0.5 || r.top < v.top - 0.5 || r.bottom > v.bottom + 0.5,
          hitsFolio: overlap(r, fr) || (getComputedStyle(headEl).visibility !== 'hidden' && headEl.textContent && overlap(r, hr)),
          paint: getComputedStyle(e).color,
        })),
      };
    });
    return { n: sheets.length, sheets: out, indicator: p.querySelector('[data-testid=page-indicator]')?.textContent ?? null };
  }, pane);

/** Folios et pastilles conformes ? Renvoie la liste des écarts (vide : tout va bien). */
function auditIssues(a, { pills = true } = {}) {
  const bad = [];
  a.sheets.forEach((s, i) => {
    if (!s.truth && !s.folio) return;
    if (s.folio !== s.truth) bad.push(`feuille ${i} : folio « ${s.folio} », attendu « ${s.truth} »`);
    if (/[–-]/.test(s.folio)) bad.push(`feuille ${i} : folio en intervalle « ${s.folio} »`);
    if (!pills) {
      if (s.pills.length) bad.push(`feuille ${i} : pastilles alors que les numéros sont masqués`);
      if (s.starts.some((st) => st.tick)) bad.push(`feuille ${i} : encoche alors que les numéros sont masqués`);
      return;
    }
    const want = a.n === 2 && i === 0 ? 'left' : 'right';
    for (const st of s.starts) {
      const pl = s.pills.find((x) => x.label === st.label);
      if (!pl) bad.push(`feuille ${i} : pas de pastille pour la page ${st.label}`);
      else {
        if (Math.abs(pl.y - st.y) > 3) bad.push(`pastille ${st.label} : pas à la hauteur de la ligne (${pl.y} / ${st.y})`);
        if (pl.side !== want) bad.push(`pastille ${st.label} : marge ${pl.side}, attendu ${want}`);
        if (!pl.inSheet || pl.clipped) bad.push(`pastille ${st.label} : coupée ou hors de la feuille`);
        if (pl.hitsFolio) bad.push(`pastille ${st.label} : chevauche le folio ou le titre courant`);
      }
      if (st.inline && !st.tick) bad.push(`page ${st.label} : pas d’encoche au mot exact`);
    }
    for (const pl of s.pills) if (!s.starts.some((st) => st.label === pl.label)) bad.push(`feuille ${i} : pastille ${pl.label} en trop (page commencée en haut ?)`);
  });
  return bad;
}

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
  check(st.folios.every((f) => /^\d+$/.test(f)) && auditIssues(await folioAudit(page)).length === 0, 'folios : un seul numéro (page imprimée) en bas de chaque page', st.folios);
  check(st.indicator === 'p. 5 / 20', 'indicateur : la page demandée', st.indicator);
  check(await markVisible(page, '5'), 'aller à la page 5 : la page d’écran où elle commence');
  // Parcourir la partie : folio = page en cours au premier caractère ; pastille là où une page commence.
  let issues = [];
  let midStarts = 0;
  let pillsSeen = 0;
  let seenPill = null;
  for (let i = 0; i < 9; i++) {
    const a = await folioAudit(page);
    issues.push(...auditIssues(a));
    midStarts += a.sheets.reduce((t, x) => t + x.starts.length, 0);
    pillsSeen += a.sheets.reduce((t, x) => t + x.pills.length, 0);
    if (!seenPill) seenPill = a.sheets.find((x) => x.pills.length) ?? null;
    // Indicateur (hors saut demandé) : page en cours au premier caractère de la page de gauche.
    if (i > 0 && a.indicator !== `p. ${a.sheets[0].truth} / 20`) issues.push(`indicateur ${a.indicator}, attendu p. ${a.sheets[0].truth}`);
    await page.keyboard.press('ArrowRight');
    await sleep(300);
  }
  check(issues.length === 0, 'folios et pastilles conformes sur 9 doubles pages (folio = page au 1er caractère, pastille en marge extérieure)', issues.slice(0, 6));
  console.log('  pastilles :', { midStarts, pillsSeen, seenPill: seenPill && { folio: seenPill.folio, pills: seenPill.pills.map((x) => x.label + ':' + x.side) } });
  check(midStarts > 0 && pillsSeen === midStarts, 'pages commencées en cours de page d’écran : une pastille chacune', { midStarts, pillsSeen });
  check(!!seenPill, 'pastille vue', seenPill);
  // Une page d'écran dont la page imprimée commence ailleurs qu'en haut : folio = la précédente.
  await jumpTo(page, '5');
  // Une seule page à l'écran.
  await set(page, { pagedSpread: 'single' });
  await sleep(600);
  issues = [];
  const singles = [];
  for (let i = 0; i < 10; i++) {
    const a = await folioAudit(page);
    issues.push(...auditIssues(a));
    singles.push(a.sheets[0].folio);
    await page.keyboard.press('ArrowRight');
    await sleep(300);
  }
  check(issues.length === 0, 'une page : folios et pastilles (marge droite) conformes', issues.slice(0, 6));
  console.log('  folios (une page) :', singles.join(' '));
  check(singles.some((f, i) => i > 0 && f === singles[i - 1]), 'folio répété quand deux pages d’écran tombent dans la même page du livre', singles);
  // Numéros de page masqués : plus de pastille ni d'encoche, les folios restent.
  await set(page, { pageMarks: 'off' });
  await sleep(500);
  let a0 = await folioAudit(page);
  check(auditIssues(a0, { pills: false }).length === 0 && a0.sheets.every((x) => x.folio), 'numéros masqués : folios gardés, aucune pastille', auditIssues(a0, { pills: false }));
  await set(page, { pageMarks: 'numbered', pagedSpread: 'double' });
  await sleep(600);
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
  check(st.folios[0] === '1' && st.folios.every((f) => /^\d+$/.test(f)), 'pagination estimée : folios numérotés depuis 1, un seul numéro', st.folios);
  check(auditIssues(await folioAudit(page)).length === 0, 'pagination estimée : folios et pastilles conformes', auditIssues(await folioAudit(page)));
  await jumpTo(page, '5');
  st = await state(page);
  check((await markVisible(page, '5')) && auditIssues(await folioAudit(page)).length === 0, 'aller à la page 5 (estimée) : sa page d’écran, folio et pastille', st);

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


// ── Débordement : rien du texte hors du cadre de la page ─────
//
// Régression « des mots sortent du cadre » (page par page + mise en page livre) : une ligne de la
// page suivante peinte à droite de la feuille, hors du cadre. Contrôles, sur un livre long :
// - chaque ligne du chapitre lu tient dans sa case de colonne (largeur et hauteur de la zone de texte) ;
// - le pas des colonnes mesuré (largeur réelle de la boîte + intervalle réel) vaut la largeur de page ;
// - aucun rectangle de ligne n'est visible (découpes des ancêtres comprises) hors de la (double) page ;
// - au pixel : aucune encre dans le volet hors des feuilles (capture d'écran) ;
// - découpe de secours : même sans la découpe du chapitre, et colonnes décalées d'une demi-page,
//   le document ne peint rien hors des feuilles.

/** Audit géométrique du chapitre lu (volet a). */
const overflowAudit = (page) =>
  page.evaluate(() => {
    const p = document.querySelector('.reader-page[data-pane="a"]');
    const sc = p.querySelector('.html-scroll');
    const docEl = p.querySelector('.html-doc');
    const cs = getComputedStyle(docEl);
    const v = (k) => parseFloat(cs.getPropertyValue(k));
    const w = v('--pg-w');
    const mx = v('--pg-mx');
    const cw = v('--pg-cw');
    const chh = v('--pg-ch');
    const n = v('--pg-n');
    const sr = sc.getBoundingClientRect();
    const box = { l: sr.left + v('--pg-left'), t: sr.top + v('--pg-top'), r: sr.left + v('--pg-left') + n * w, b: sr.top + v('--pg-top') + v('--pg-h') };
    const sheets = [...p.querySelectorAll('.paged-page')].map((e) => e.getBoundingClientRect());
    const sheetBox = { l: Math.min(...sheets.map((s) => s.left)), r: Math.max(...sheets.map((s) => s.right)), t: Math.min(...sheets.map((s) => s.top)), b: Math.max(...sheets.map((s) => s.bottom)) };
    const sec = p.querySelector('.html-chapter.paged-cur');
    const col = sec.querySelector('.html-col');
    const ccs = getComputedStyle(col);
    const colW = col.offsetWidth;
    const gap = parseFloat(ccs.columnGap);
    // Région de découpe d'un élément : intersection des boîtes de ses ancêtres qui découpent.
    const clipOf = (el) => {
      let c = { l: -1e9, t: -1e9, r: 1e9, b: 1e9 };
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        let q = null;
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') q = a.getBoundingClientRect();
        const m = /^inset\(([^)]*)\)$/.exec(s.clipPath);
        if (m) {
          const r = a.getBoundingClientRect();
          const parts = m[1].split(/\s+/).map(parseFloat);
          const [t0, r0 = t0, b0 = t0, l0 = r0] = parts.every(Number.isFinite) ? parts : [0, 0, 0, 0];
          const ins = { l: r.left + l0, t: r.top + t0, r: r.right - r0, b: r.bottom - b0 };
          q = q ? { left: Math.max(q.left, ins.l), top: Math.max(q.top, ins.t), right: Math.min(q.right, ins.r), bottom: Math.min(q.bottom, ins.b) } : { left: ins.l, top: ins.t, right: ins.r, bottom: ins.b };
        }
        if (q) c = { l: Math.max(c.l, q.left), t: Math.max(c.t, q.top), r: Math.min(c.r, q.right), b: Math.min(c.b, q.bottom) };
      }
      return c;
    };
    const tf = col.style.transform;
    const k0 = Math.round(-parseFloat((/translateX\((-?[\d.]+)px\)/.exec(tf) ?? [0, 0])[1]) / w);
    const walker = document.createTreeWalker(sec.querySelector('.html-chapter-text'), NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    const visibleOut = [];
    const texts = [];
    let t;
    while ((t = walker.nextNode())) {
      if (!/\S/.test(t.data) || getComputedStyle(t.parentElement).visibility === 'hidden') continue;
      texts.push(t);
      const clip = clipOf(t.parentElement);
      r.selectNodeContents(t);
      for (const q of r.getClientRects()) {
        const l = Math.max(q.left, clip.l);
        const rr = Math.min(q.right, clip.r);
        const tt = Math.max(q.top, clip.t);
        const bb = Math.min(q.bottom, clip.b);
        if (rr - l < 1 || bb - tt < 1) continue;
        if (l < box.l - 1 || rr > box.r + 1 || tt < box.t - 1 || bb > box.b + 1) visibleOut.push({ text: t.data.slice(0, 30), q: [q.left, q.top, q.right, q.bottom].map(Math.round) });
      }
    }
    // Cases de colonne : la colonne sans translation, chaque ligne dans [k·w, k·w + cw] × [0, ch].
    col.style.transform = 'none';
    const cr = col.getBoundingClientRect();
    const slots = [];
    for (const tn of texts) {
      r.selectNodeContents(tn);
      for (const q of r.getClientRects()) {
        if (q.width < 1 || q.height < 1) continue;
        const dx = q.left - cr.left;
        const k = Math.floor((dx + mx) / w);
        const ok = dx >= k * w - 1.5 && q.right - cr.left <= k * w + cw + 1.5 && q.top - cr.top >= -4 && q.bottom - cr.top <= chh + 1.5;
        if (!ok) slots.push({ text: tn.data.slice(0, 30), k, x: Math.round(dx - k * w), y: Math.round(q.top - cr.top), b: Math.round(q.bottom - cr.top) });
      }
    }
    col.style.transform = tf;
    // Premier caractère visible de la page de gauche (offset dans le chapitre).
    let first = -1;
    {
      const root = sec.querySelector('.html-chapter-text');
      const wk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let pos = 0;
      let nn;
      const lo = box.l + mx - 2;
      const hi = box.l + w - mx + 2;
      const inPage = (q) => q && q.left >= lo && q.right <= hi && q.top >= box.t && q.bottom <= box.b;
      while ((nn = wk.nextNode()) && first < 0) {
        r.selectNodeContents(nn);
        const rs = [...r.getClientRects()];
        if (/\S/.test(nn.data) && rs.some(inPage)) {
          for (let i = 0; i < nn.data.length; i++) {
            if (/\s/.test(nn.data[i])) continue;
            r.setStart(nn, i);
            r.setEnd(nn, i + 1);
            if (inPage(r.getClientRects()[0])) {
              first = pos + i;
              break;
            }
          }
        }
        pos += nn.data.length;
      }
    }
    return {
      chapter: [...p.querySelectorAll('.html-chapter')].indexOf(sec),
      page: k0,
      w,
      mx,
      cw,
      colW,
      gap,
      step: colW + gap,
      sheetsMatch: Math.abs(sheetBox.l - box.l) < 1.5 && Math.abs(sheetBox.r - box.r) < 1.5,
      docClip: cs.clipPath,
      secClip: getComputedStyle(sec).clipPath,
      visibleOut: visibleOut.length,
      visibleSample: visibleOut.slice(0, 3),
      slots: slots.length,
      slotSample: slots.slice(0, 3),
      first,
      indicator: p.querySelector('[data-testid=page-indicator]')?.textContent,
    };
  });

/** Pixels d'encre (sombres) peints dans le volet hors des feuilles (ombres, panneau et indicateur exclus). */
async function inkOutside(page) {
  await page.mouse.move(2, 2);
  await sleep(120);
  const geo = await page.evaluate(() => {
    const p = document.querySelector('.reader-page[data-pane="a"]');
    const sc = p.querySelector('.html-scroll');
    const r = sc.getBoundingClientRect();
    const rect = (e) => {
      const q = e.getBoundingClientRect();
      return [q.left, q.top, q.right, q.bottom];
    };
    const masks = [...p.querySelectorAll('.paged-page')].map((e) => {
      const [l, t, rr, b] = rect(e);
      return [l - 6, t - 4, rr + 9, b + 22];
    });
    for (const e of document.querySelectorAll('[data-testid=reader-panel], .reader-pagejump-host, .toast, .floating')) {
      const [l, t, rr, b] = rect(e);
      masks.push([l - 28, t - 28, rr + 28, b + 40]);
    }
    return { sc: [r.left, r.top, r.width, r.height], masks };
  });
  const [x, y, w, h] = geo.sc;
  const buf = await page.screenshot({ clip: { x, y, width: w, height: h } });
  return page.evaluate(
    async ({ b64, geo }) => {
      const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const c = new OffscreenCanvas(img.width, img.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      const sx = img.width / geo.sc[2];
      let n = 0;
      let box = null;
      for (let j = 0; j < img.height; j++)
        for (let i = 0; i < img.width; i++) {
          const k = (j * img.width + i) * 4;
          if (0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2] > 110) continue;
          const px = geo.sc[0] + i / sx;
          const py = geo.sc[1] + j / sx;
          if (geo.masks.some(([l, t, r, b]) => px >= l && px <= r && py >= t && py <= b)) continue;
          n++;
          box = box ? [Math.min(box[0], px), Math.min(box[1], py), Math.max(box[2], px), Math.max(box[3], py)] : [px, py, px, py];
        }
      return { n, box: box && box.map(Math.round) };
    },
    { b64: buf.toString('base64'), geo },
  );
}

const auditOk = (a) => a.visibleOut === 0 && a.slots === 0 && Math.abs(a.step - a.w) < 1 && Math.abs(a.colW - a.cw) < 1 && a.sheetsMatch;

/** Panneau « Aa » ouvert ou fermé. */
async function panel(page, open) {
  const isOpen = !!(await page.$('[data-testid=reader-panel]'));
  if (isOpen !== open) await page.click('[data-testid=reader-display-btn]');
  if (open) await page.waitForSelector('[data-testid=reader-panel]');
  else await page.waitForSelector('[data-testid=reader-panel]', { state: 'detached' });
  await sleep(350);
}

async function nextPage(page) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('ArrowRight');
  await sleep(380);
}

await withApp(async (page) => {
  console.log('\n== Débordement : rien hors du cadre de la page (livre long) ==');
  await set(page, { theme: 'light', fontSize: 19, lineHeight: 1.65, measure: 66, showToc: true, showExtracts: false, showConnectors: true, readerLayout: 'paged', pagedSpread: 'single', bookLayout: true, paperLook: false, pageMarks: 'numbered', fontFamily: 'sans' });
  const longId = await importBuffer(page, 'traite-long.epub', await epubLong({ shy: true }));
  await open(page, longId);
  await jumpTo(page, '158');
  const total = Number((/\/\s*(\d+)/.exec((await state(page)).indicator ?? '') ?? [])[1]);
  check(total >= 300, `livre long : ${total} pages imprimées`, total);

  // Mise en page livre : mesure plus étroite et marges plus amples, prises de la cascade.
  const geoBook = await overflowAudit(page);
  await set(page, { bookLayout: false });
  await sleep(600);
  const geoPlain = await overflowAudit(page);
  check(geoBook.cw < geoPlain.cw && geoBook.mx > geoPlain.mx, 'mise en page livre : zone de texte plus étroite, marges plus amples', { livre: [geoBook.cw, geoBook.mx], ecran: [geoPlain.cw, geoPlain.mx] });

  let bad = 0;
  for (const pagedSpread of ['single', 'double'])
    for (const fontFamily of ['serif', 'sans'])
      for (const bookLayout of [true, false])
        for (const open of [false, true]) {
          await set(page, { pagedSpread, fontFamily, bookLayout });
          await panel(page, open);
          await sleep(300);
          const label = `${pagedSpread === 'single' ? 'une page' : 'deux pages'}, ${fontFamily}, livre ${bookLayout ? 'oui' : 'non'}, panneau ${open ? 'ouvert' : 'fermé'}`;
          for (let t = 0; t < 2; t++) {
            if (t) await nextPage(page);
            const a = await overflowAudit(page);
            const ink = await inkOutside(page);
            const ok = auditOk(a) && ink.n === 0;
            if (!ok) bad++;
            check(ok, `${label}${t ? ', page suivante' : ''} : aucune ligne hors du cadre (${a.indicator})`, { a, ink });
          }
        }
  await panel(page, false);

  // Bascule de la mise en page livre depuis le panneau (police sans, une page) : le passage lu reste.
  await set(page, { pagedSpread: 'single', fontFamily: 'sans', bookLayout: false });
  await sleep(500);
  await panel(page, true);
  // Page tournée par le lecteur : le passage lu est alors le premier caractère de la page. Il doit
  // rester à l'écran à chaque bascule, sans dériver d'une bascule à l'autre.
  await nextPage(page);
  const before = await overflowAudit(page);
  for (const target of [true, false, true]) {
    await page.click('[data-testid=book-layout-switch]');
    await sleep(700);
    const a = await overflowAudit(page);
    const ink = await inkOutside(page);
    const kept = a.chapter === before.chapter ? await charInfo(page, a.chapter, before.first) : null;
    check(auditOk(a) && ink.n === 0, `bascule « Mise en page livre » → ${target ? 'oui' : 'non'} : aucune ligne hors du cadre`, { a, ink });
    check(!!kept?.visible, `bascule « Mise en page livre » → ${target ? 'oui' : 'non'} : le premier caractère lu (avant les bascules) reste à l'écran`, { before: [before.chapter, before.first], after: [a.chapter, a.first] });
  }
  await page.getByRole('radio', { name: 'Serif' }).click();
  await sleep(700);
  {
    const a = await overflowAudit(page);
    check(auditOk(a) && (await inkOutside(page)).n === 0, 'police changée depuis le panneau (serif) : aucune ligne hors du cadre', a);
  }

  // Redimensionnement (volet plus étroit, puis double page), panneau ouvert.
  for (const [W, H, spread] of [
    [1100, 900, 'single'],
    [1100, 900, 'double'],
    [1440, 900, 'double'],
  ]) {
    await set(page, { pagedSpread: spread });
    await sleep(400);
    const before = await overflowAudit(page);
    await page.setViewportSize({ width: W, height: H });
    await sleep(700);
    const a = await overflowAudit(page);
    const ink = await inkOutside(page);
    const kept = a.chapter === before.chapter ? await charInfo(page, a.chapter, before.first) : null;
    check(auditOk(a) && ink.n === 0, `redimensionné ${W}×${H}, ${spread} : aucune ligne hors du cadre`, { a, ink });
    check(!!kept?.visible, `redimensionné ${W}×${H}, ${spread} : le premier caractère lu reste à l'écran`, { before: [before.chapter, before.first], after: [a.chapter, a.first] });
  }
  await panel(page, false);
  await shot(page, '07-livre-long-deux-pages.png');

  // Découpe de secours : sans la découpe du chapitre, colonnes décalées d'une demi-page (une colonne
  // voisine à cheval sur chaque bord) — le document ne peint toujours rien hors des feuilles.
  for (const spread of ['single', 'double']) {
    await set(page, { pagedSpread: spread, bookLayout: true, fontFamily: 'sans' });
    await sleep(500);
    await page.evaluate(() => {
      const sec = document.querySelector('.reader-page[data-pane="a"] .html-chapter.paged-cur');
      const col = sec.querySelector('.html-col');
      const w = parseFloat(getComputedStyle(sec.parentElement).getPropertyValue('--pg-w'));
      sec.style.overflow = 'visible';
      sec.style.clipPath = 'none';
      col.dataset.tf = col.style.transform;
      col.style.transform = `${col.style.transform} translateX(${w / 2}px)`;
    });
    await sleep(150);
    const ink = await inkOutside(page);
    check(ink.n === 0, `découpe de secours (${spread}) : rien de peint hors des feuilles même sans la découpe du chapitre`, ink);
    await page.evaluate(() => {
      const sec = document.querySelector('.reader-page[data-pane="a"] .html-chapter.paged-cur');
      const col = sec.querySelector('.html-col');
      sec.style.overflow = '';
      sec.style.clipPath = '';
      col.style.transform = col.dataset.tf;
    });
  }
  // Défilement continu et feuilles, mise en page livre : aucune ligne ne dépasse la zone de texte de
  // sa colonne (adresse web insécable, mots longs coupés plutôt que débordants).
  for (const readerLayout of ['scroll', 'sheets'])
    for (const fontFamily of ['serif', 'sans']) {
      await set(page, { readerLayout, bookLayout: true, fontFamily });
      await sleep(900);
      const out = await page.evaluate(() => {
        const p = document.querySelector('.reader-page[data-pane="a"]');
        const sc = p.querySelector('.html-scroll').getBoundingClientRect();
        const bad = [];
        const r = document.createRange();
        for (const root of p.querySelectorAll('.html-chapter-text')) {
          const cr = root.getBoundingClientRect();
          if (cr.bottom < sc.top - 2000 || cr.top > sc.bottom + 2000) continue;
          const wk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = wk.nextNode())) {
            if (!/\S/.test(n.data)) continue;
            r.selectNodeContents(n);
            for (const q of r.getClientRects()) if (q.width >= 1 && (q.left < cr.left - 1 || q.right > cr.right + 1)) bad.push({ t: n.data.slice(0, 30), q: [q.left, q.right].map(Math.round), box: [cr.left, cr.right].map(Math.round) });
          }
        }
        return { n: bad.length, sample: bad.slice(0, 3) };
      });
      check(out.n === 0, `${readerLayout === 'scroll' ? 'défilement continu' : 'feuilles'}, ${fontFamily}, mise en page livre : aucune ligne hors de la zone de texte`, out);
    }
  await set(page, { readerLayout: 'paged' });
  console.log(`débordement : ${bad} configuration(s) en défaut`);
});

console.log(`\n${passes} OK, ${failures} échec(s)`);
process.exit(failures ? 1 : 0);
