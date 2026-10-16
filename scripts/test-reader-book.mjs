// Mise en page livre (réglage bookLayout → .book-layout) — port 5411.
// Lancer : timeout 400 node scripts/test-reader-book.mjs
// - interrupteur « Mise en page livre » du panneau « Mise en page et affichage » (bouton « Aa ») ;
// - textContent des chapitres inchangé (ancrages), surlignage toujours peint, recherche, repères de page ;
// - styles calculés : justifié, césure, alinéa entre deux paragraphes, aucun alinéa après un titre, un
//   séparateur, une citation, une liste, des vers, un blanc ; aucun blanc entre paragraphes ; titres
//   centrés ; chiffres elzéviriens ; mesure ~60–66 signes ;
// - pages façon papier : alinéa gardé quand une feuille commence entre deux paragraphes, pas de
//   retrait quand la phrase reprend au milieu d'un paragraphe ;
// - captures shots/livre/ : sans / livre (même passage), sombre, sépia, feuilles, titres de chapitre.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5411;
const OUT = process.env.SHOTS_DIR ?? path.join(ROOT, 'shots/livre');

let failures = 0;
let passes = 0;
const check = (cond, label, extra) => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${label}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  const abs = path.resolve(OUT, name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  await page.mouse.move(2, 300);
  await page.evaluate(() => {
    const s = window.__store.getState();
    (s.toasts ?? []).forEach((t) => s.dismissToast?.(t.id));
    getSelection().removeAllRanges();
  });
  await sleep(350);
  await page.screenshot({ path: abs });
  console.log('capture:', abs);
}

// ── Fixture : un essai composé (titres, sous-titre, séparateur, citation, liste, vers, blanc) ──

const P = [
  'Le bon sens est la chose du monde la mieux partagée ; car chacun pense en être si bien pourvu, que ceux même qui sont les plus difficiles à contenter en toute autre chose n’ont point coutume d’en désirer plus qu’ils en ont.',
  'En quoi il n’est pas vraisemblable que tous se trompent ; mais plutôt cela témoigne que la puissance de bien juger et distinguer le vrai d’avec le faux, qui est proprement ce qu’on nomme le bon sens ou la raison, est naturellement égale en tous les hommes.',
  'Et ainsi la diversité de nos opinions ne vient pas de ce que les uns sont plus raisonnables que les autres, mais seulement de ce que nous conduisons nos pensées par diverses voies, et ne considérons pas les mêmes choses.',
  'Car ce n’est pas assez d’avoir l’esprit bon, mais le principal est de l’appliquer bien. Les plus grandes âmes sont capables des plus grands vices, aussi bien que des plus grandes vertus ; et ceux qui ne marchent que fort lentement peuvent avancer beaucoup davantage, s’ils suivent toujours le droit chemin, que ne font ceux qui courent et qui s’en éloignent.',
  'Pour moi, je n’ai jamais présumé que mon esprit fût en rien plus parfait que ceux du commun ; même j’ai souvent souhaité d’avoir la pensée aussi prompte, ou l’imagination aussi nette et distincte, ou la mémoire aussi ample ou aussi présente, que quelques autres.',
];
const long = (k, n = 3) => Array.from({ length: n }, (_, i) => P[(k + i) % P.length]).join(' ');

const xhtml = (title, body) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="fr"><head><title>${title}</title></head><body>${body}</body></html>`;
const pb = (id, label) => `<span epub:type="pagebreak" id="${id}" title="${label}"></span>`;

function chapter1() {
  const mid = long(3, 3);
  const cut = mid.indexOf(' ', Math.floor(mid.length / 2));
  return xhtml(
    'Chapitre premier',
    `${pb('p1', '1')}<h1>Chapitre premier</h1><h2>Des sciences et de la méthode</h2>` +
      `<p id="t-after-h">${long(0, 2)}</p>` +
      `<p id="t-second">${long(1, 3)} En 1637, à Leyde, parurent les Essais.</p>` +
      `<p>${long(2, 2)}</p>` +
      `<p id="t-mid">${mid.slice(0, cut + 1)}${pb('p2', '2')}${mid.slice(cut + 1)}</p>` +
      `<p>${long(4, 2)}</p>${pb('p3', '3')}<p id="t-pageblock">${long(0, 3)}</p>` +
      `<hr/><p id="t-after-hr">${long(1, 2)}</p><p>${long(2, 2)}</p>` +
      `<blockquote><p>${P[3]}</p><p>${P[4]}</p></blockquote><p id="t-after-bq">${long(3, 2)}</p>` +
      `<ul><li>la première, de ne recevoir jamais aucune chose pour vraie ;</li><li>la seconde, de diviser chacune des difficultés ;</li><li>la troisième, de conduire par ordre mes pensées.</li></ul>` +
      `<p id="t-after-ul">${long(4, 2)}</p>` +
      `<p id="t-verse">Mignonne, allons voir si la rose<br/>Qui ce matin avoit desclose<br/>Sa robe de pourpre au Soleil,<br/>A point perdu ceste vesprée</p>` +
      `<p id="t-after-verse">${long(0, 2)}</p>` +
      `<div class="poem"><div class="stanza"><p class="line" id="t-poem-line">Heureux qui, comme Ulysse, a fait un beau voyage,</p><p class="line">Ou comme cestuy-là qui conquit la toison,</p></div></div>` +
      `<p>${long(1, 1)}</p><p class="space"> </p><p id="t-after-blank">${long(2, 2)}</p>` +
      `<h3 id="t-h3">Seconde maxime</h3><p id="t-after-h3">${long(3, 2)}</p><p>${long(4, 4)}</p>`,
  );
}
function chapter2() {
  let body = `${pb('p4', '4')}<h1>Chapitre II</h1><h2>Où l’on poursuit</h2>`;
  for (let k = 0; k < 6; k++) body += `<p>${long(k, 3)}</p>`;
  return xhtml('Chapitre II', body);
}

async function epub() {
  const files = { 'ch1.xhtml': chapter1(), 'ch2.xhtml': chapter2() };
  const plist = [
    ['ch1.xhtml#p1', '1'],
    ['ch1.xhtml#p2', '2'],
    ['ch1.xhtml#p3', '3'],
    ['ch2.xhtml#p4', '4'],
  ];
  const nav = xhtml(
    'Sommaire',
    `<nav epub:type="toc"><ol><li><a href="ch1.xhtml">Chapitre premier</a></li><li><a href="ch2.xhtml">Chapitre II</a></li></ol></nav>` +
      `<nav epub:type="page-list" hidden="hidden"><ol>${plist.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ol></nav>`,
  );
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const names = Object.keys(files);
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:test:livre</dc:identifier><dc:title>Essais composés</dc:title><dc:creator>René Descartes</dc:creator><dc:language>fr</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${names.map((n, i) => `<item id="c${i}" href="${n}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${names.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`,
  );
  zip.file('OEBPS/nav.xhtml', nav);
  for (const [n, src] of Object.entries(files)) zip.file('OEBPS/' + n, src);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

// ── Aides ────────────────────────────────────────────────────

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
  await page.waitForSelector('.html-doc.is-revealed', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.reader-loading'), null, { timeout: 30000 });
  await sleep(600);
}
const setS = (page, patch) => page.evaluate((p) => window.__store.getState().updateSettings(p), patch);
const texts = (page) => page.$$eval('.html-chapter-text', (els) => els.map((e) => e.textContent));
/** Le paragraphe dont la source portait l'id (data-fid), son style calculé et le retrait réel de sa première lettre. */
const para = (page, fid) =>
  page.evaluate((fid) => {
    const p = document.querySelector(`.html-chapter-text [data-fid="${fid}"]`);
    if (!p) return null;
    const cs = getComputedStyle(p);
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode()) && !/\S/.test(n.data));
    const r = document.createRange();
    const i = n.data.search(/\S/);
    r.setStart(n, i);
    r.setEnd(n, i + 1);
    const col = p.closest('.html-chapter-text').getBoundingClientRect();
    return {
      align: cs.textAlign,
      indent: parseFloat(cs.textIndent),
      mt: parseFloat(cs.marginTop),
      mb: parseFloat(cs.marginBottom),
      hyphens: cs.hyphens,
      fs: parseFloat(cs.fontSize),
      numeric: cs.fontVariantNumeric,
      firstX: Math.round(r.getBoundingClientRect().left - col.left),
    };
  }, fid);
/** Retrait de la ligne qui suit un repère de page en milieu de paragraphe (doit être nul en mode papier). */
const afterMark = (page, label) =>
  page.evaluate((label) => {
    const m = [...document.querySelectorAll('.pg-mark')].find((e) => e.dataset.pg === label);
    let n = m.nextSibling;
    while (n && (n.nodeType !== 3 || !/\S/.test(n.data))) n = n.nodeType === 1 ? n.firstChild ?? n.nextSibling : n.nextSibling;
    const r = document.createRange();
    const i = n.data.search(/\S/);
    r.setStart(n, i);
    r.setEnd(n, i + 1);
    const col = m.closest('.html-chapter-text').getBoundingClientRect();
    return Math.round(r.getBoundingClientRect().left - col.left);
  }, label);

async function selectHtml(page, needle) {
  const ok = await page.evaluate((needle) => {
    for (const root of document.querySelectorAll('.html-chapter-text')) {
      const t = root.textContent;
      const i = t.indexOf(needle);
      if (i < 0) continue;
      const loc = (off, endBias) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let pos = 0;
        let n;
        while ((n = w.nextNode())) {
          if (off < pos + n.data.length || (endBias && off === pos + n.data.length)) return [n, off - pos];
          pos += n.data.length;
        }
        return null;
      };
      const a = loc(i, false);
      const b = loc(i + needle.length, true);
      const r = document.createRange();
      r.setStart(a[0], a[1]);
      r.setEnd(b[0], b[1]);
      r.startContainer.parentElement.scrollIntoView({ block: 'center' });
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return true;
    }
    return false;
  }, needle);
  if (!ok) throw new Error('Texte introuvable : ' + needle);
  await page.waitForSelector('.sel-toolbar', { timeout: 4000 });
  await sleep(150);
}
const hlRects = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.html-chapter-text [data-hl-id]')].flatMap((e) => [...e.getClientRects()]).filter((r) => r.width > 2 && r.height > 4).length,
  );
/** Signes par ligne d'un long paragraphe (hauteur / interligne). */
const charsPerLine = (page, fid) =>
  page.evaluate((fid) => {
    const p = document.querySelector(`.html-chapter-text [data-fid="${fid}"]`);
    const lh = parseFloat(getComputedStyle(p).lineHeight);
    const lines = Math.round(p.getBoundingClientRect().height / lh);
    return Math.round(p.textContent.trim().length / lines);
  }, fid);
async function scrollToText(page, needle, block = 'start') {
  await page.evaluate(
    ({ needle, block }) => {
      const el = [...document.querySelectorAll('.html-chapter-text :is(p, h1, h2, h3)')].find((e) => e.textContent.includes(needle));
      el.scrollIntoView({ block });
    },
    { needle, block },
  );
  await sleep(500);
}

// ── Banc ─────────────────────────────────────────────────────

const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-' + PORT, server: { port: PORT, strictPort: true, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 45000 });
  await setS(page, { theme: 'light', readerLayout: 'scroll', pageMarks: 'numbered', bookLayout: false });

  // ── 1. Défilement continu (trait et numéro) ──
  const essaiId = await importBuffer(page, 'essais-composes.epub', await epub());
  await waitHtml(page);
  const t0 = await texts(page);
  const marks0 = await page.$$eval('.pg-mark', (e) => e.map((m) => m.dataset.pg));
  check(!(await page.$('.html-reader.book-layout')), 'par défaut : pas de mise en page livre');
  const before = await para(page, 't-second');
  check(before.align !== 'justify' && before.indent === 0 && before.mb > 0, 'par défaut : fer à gauche, sans alinéa, blanc entre paragraphes', before);

  await selectHtml(page, 'la puissance de bien juger');
  await page.keyboard.press('h');
  await sleep(500);
  check((await hlRects(page)) > 0, 'surlignage peint (avant)');

  // Interrupteur « Mise en page livre » du panneau « Mise en page et affichage ».
  await page.click('[data-testid=reader-display-btn]');
  await page.waitForSelector('[data-testid=book-layout-switch]');
  await page.click('[data-testid=book-layout-switch]');
  await sleep(700);
  check((await page.evaluate(() => window.__store.getState().settings.bookLayout)) === true, 'bascule : réglage bookLayout activé');
  check(!!(await page.$('.html-reader.book-layout')), 'bascule : classe .book-layout sur la racine du lecteur');
  check((await page.getAttribute('[data-testid=book-layout-switch]', 'aria-checked')) === 'true', 'bascule : interrupteur coché');
  await page.keyboard.press('Escape');
  await sleep(200);

  check(JSON.stringify(await texts(page)) === JSON.stringify(t0), 'livre : textContent des chapitres inchangé');
  check(JSON.stringify(await page.$$eval('.pg-mark', (e) => e.map((m) => m.dataset.pg))) === JSON.stringify(marks0), 'livre : repères de page inchangés');
  check((await hlRects(page)) > 0, 'livre : surlignage toujours peint');
  check(
    await page.evaluate(() => {
      const el = document.querySelector('[data-hl-id]');
      return el.closest('[data-fid="t-after-h"]') !== null;
    }),
    'livre : surlignage dans son paragraphe',
  );

  const second = await para(page, 't-second');
  check(second.align === 'justify', 'livre : texte justifié', second.align);
  check(second.hyphens === 'auto', 'livre : césure automatique', second.hyphens);
  check(Math.abs(second.indent - 1.5 * second.fs) < 1 && second.firstX > 20, 'livre : alinéa (≈ 1,5 em) d’un paragraphe à l’autre', second);
  check(second.mt === 0 && second.mb === 0, 'livre : aucun blanc entre paragraphes', second);
  check(/oldstyle-nums/.test(second.numeric), 'livre : chiffres elzéviriens', second.numeric);
  check((await page.evaluate(() => document.querySelector('.html-doc').getAttribute('lang'))) === 'fr', 'livre : langue du livre (césure française)');

  for (const [fid, label] of [
    ['t-after-h', 'après un titre'],
    ['t-after-hr', 'après un séparateur'],
    ['t-after-bq', 'après une citation'],
    ['t-after-ul', 'après une liste'],
    ['t-after-verse', 'après des vers'],
    ['t-after-blank', 'après un blanc'],
    ['t-after-h3', 'après un intertitre'],
  ]) {
    const s = await para(page, fid);
    check(s.indent === 0 && s.firstX < 2, `livre : pas d’alinéa ${label}`, s);
  }
  const verse = await para(page, 't-verse');
  check(verse.align === 'left' && verse.indent === 0 && verse.hyphens === 'manual', 'livre : strophe (retours forcés) au fer à gauche, sans césure', verse);
  const poem = await para(page, 't-poem-line');
  check(poem.align === 'left' && poem.indent === 0, 'livre : vers marqués poème à la source (data-verse) au fer à gauche', poem);
  const heads = await page.evaluate(() => {
    const t = document.querySelector('.html-chapter-text');
    const h1 = getComputedStyle(t.querySelector('h1'));
    const h2 = getComputedStyle(t.querySelector('h1 + h2'));
    return { h1: h1.textAlign, h2: h2.textAlign, h2caps: h2.fontVariantCaps };
  });
  check(heads.h1 === 'center' && heads.h2 === 'center' && heads.h2caps === 'all-small-caps', 'livre : titre de chapitre centré, sous-titre en petites capitales', heads);
  const cpl = await charsPerLine(page, 't-pageblock');
  check(cpl >= 55 && cpl <= 72, 'livre : mesure resserrée (~60–66 signes par ligne)', cpl);
  const rule = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.pg-mark')].find((e) => e.dataset.pg === '3');
    return getComputedStyle(m, '::before').display !== 'none';
  });
  check(rule, 'livre : trait de page entre deux paragraphes toujours dessiné');

  // Recherche : marques posées, textContent inchangé.
  await page.click('button[title="Rechercher (⌘F)"]');
  await page.fill('.search-bar-input', 'Leyde');
  await page.waitForSelector('.search-hit.current', { timeout: 5000 });
  const hit = await page.evaluate(() => {
    const r = document.querySelector('.search-hit.current').getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  check(hit.w > 10 && hit.h > 10, 'livre : résultat de recherche peint', hit);
  await page.click('.search-bar button[title="Fermer (Échap)"]');
  await sleep(250);
  check(JSON.stringify(await texts(page)) === JSON.stringify(t0), 'livre : textContent inchangé après recherche');

  await page.evaluate(() => (document.querySelector('.html-scroll').scrollTop = 0));
  await sleep(400);
  await shot(page, '06-titres-chapitre.png');
  await scrollToText(page, 'Mignonne', 'center');
  await shot(page, '07-livre-citation-liste-vers.png');

  // ── 2. Pages façon papier ──
  await setS(page, { readerLayout: 'sheets' });
  await sleep(900);
  check(JSON.stringify(await texts(page)) === JSON.stringify(t0), 'feuilles : textContent inchangé');
  check((await hlRects(page)) > 0, 'feuilles : surlignage peint');
  const pb3 = await para(page, 't-pageblock');
  check(pb3.firstX > 20, 'feuilles : alinéa gardé quand la feuille commence entre deux paragraphes', pb3);
  const cont = await afterMark(page, '2');
  check(cont < 2, 'feuilles : pas de retrait où la phrase reprend en haut de la feuille suivante', cont);
  const sheetGap = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.pg-mark')].find((e) => e.dataset.pg === '3');
    const r = m.getBoundingClientRect();
    const prev = m.closest('p').previousElementSibling.getBoundingClientRect();
    return Math.round(r.top - prev.bottom);
  });
  check(sheetGap >= -1 && sheetGap <= 2, 'feuilles : la coupure entre paragraphes ne chevauche pas la dernière ligne', sheetGap);
  const second2 = await para(page, 't-second');
  check(second2.align === 'justify' && second2.indent > 0, 'feuilles : justifié et alinéas', second2);

  // ── 3. Désactivation ──
  await setS(page, { bookLayout: false });
  await sleep(500);
  check(!(await page.$('.html-reader.book-layout')), 'désactivé : classe retirée');
  check(JSON.stringify(await texts(page)) === JSON.stringify(t0), 'désactivé : textContent inchangé');

  // ── 4. Captures sur un vrai texte (Discours de la méthode), même passage ──
  await setS(page, { readerLayout: 'scroll', pageMarks: 'numbered', bookLayout: false, theme: 'light' });
  await importBuffer(page, 'discours.epub', fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')));
  await waitHtml(page);
  const PASS = 'Première partie';
  await scrollToText(page, PASS, 'start');
  await shot(page, '01-sans.png');
  await setS(page, { bookLayout: true });
  await sleep(700);
  await scrollToText(page, PASS, 'start');
  await shot(page, '02-livre.png');
  await setS(page, { theme: 'dark' });
  await sleep(500);
  await shot(page, '03-livre-sombre.png');
  await setS(page, { theme: 'sepia' });
  await sleep(500);
  await shot(page, '04-livre-sepia.png');
  // Feuilles : l'essai composé, à la coupure entre deux paragraphes (page 3 : l'alinéa est gardé).
  await setS(page, { theme: 'light', readerLayout: 'sheets' });
  await page.evaluate((id) => window.__store.getState().openBook(id), essaiId);
  await waitHtml(page);
  await page.evaluate(() => {
    const sc = document.querySelector('.html-scroll');
    const m = [...sc.querySelectorAll('.pg-mark')].find((e) => e.dataset.pg === '3');
    sc.scrollTop += m.getBoundingClientRect().top - sc.getBoundingClientRect().top - 430;
  });
  await sleep(500);
  await shot(page, '05-livre-feuilles.png');
} catch (e) {
  failures++;
  console.log('ÉCHEC exception :', e.message);
} finally {
  if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + errors.slice(0, 12).join('\n'));
  check(!errors.some((e) => /pageerror/.test(e)), 'aucune erreur de page', errors.slice(0, 3));
  await browser.close();
  await server.close();
}
console.log(`\n${passes} OK, ${failures} échec(s)`);
process.exit(failures ? 1 : 0);
