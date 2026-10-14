// Signets — port 5331. Lancer : timeout 300 node scripts/test-bookmarks.mjs
// EPUB : ⌘D (libellé proposé, popover, renommage), repère dans la marge, retour exact après avoir
// défilé ailleurs, ⌘⌥↓ / ⌘⌥↑, liste du panneau, rechargement + ⌘K, suppression puis Annuler,
// cascade à la suppression du livre + restauration. PDF : ⌘D (« Page N »), repère, retour.
// Lecteur compact de l'éditeur : ⌘D et liste. Captures clair / sombre / sépia.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importFixture } from './harness.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/bookmarks');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5331;

let failed = 0;
// check(nom, condition, détail) — ou check(condition, nom, détail).
const check = (a, b, detail = '') => {
  const [name, cond] = typeof a === 'string' ? [a, b] : [b, a];
  if (!cond) failed++;
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${name}${detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(page, name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p });
  console.log('capture:', path.relative(ROOT, p));
}
const store = (page, fn, arg) => page.evaluate(fn, arg);
const bookmarksOf = (page, bookId) => store(page, (id) => window.__store.getState().bookmarks.filter((b) => b.bookId === id), bookId);

async function waitHtml(page, scope = '') {
  await page.waitForSelector(`${scope} .html-doc.is-revealed`, { timeout: 30000 });
  await page.waitForFunction((s) => !document.querySelector(`${s} .reader-loading.overlay`), scope, { timeout: 30000 });
  await sleep(500);
}
async function waitPdf(page) {
  await page.waitForSelector('.pdf-page[data-page="1"] .textLayer[data-ready="1"]', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.reader-loading.overlay'), null, { timeout: 30000 });
  await sleep(600);
}
/** Le repère du signet est-il dans le haut de la fenêtre de lecture (0 – 45 %) ? */
async function markerInView(page, id, scrollSel = '.html-scroll') {
  return page.evaluate(
    ({ id, scrollSel }) => {
      const sc = document.querySelector(scrollSel);
      const m = document.querySelector(`[data-bm-id="${id}"]`);
      if (!sc || !m) return { ok: false, why: 'absent' };
      const a = sc.getBoundingClientRect();
      const r = m.getBoundingClientRect();
      const d = r.top - a.top;
      return { ok: d >= -40 && d <= a.height * 0.45, d: Math.round(d), h: Math.round(a.height) };
    },
    { id, scrollSel },
  );
}
const pressed = (page, sel = '[data-testid="bookmark-toggle"]') => page.getAttribute(sel, 'aria-pressed');

const server = await createServer({
  root: ROOT,
  cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`),
  server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').slice(0, 400)));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('response', (r) => r.status() >= 400 && errors.push(r.status() + ' : ' + r.url()));

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  check('base sans signets : tableau vide', await store(page, () => Array.isArray(window.__store.getState().bookmarks) && window.__store.getState().bookmarks.length === 0));

  // ── EPUB ─────────────────────────────────────────────────
  const epubId = await importFixture(page, 'fixtures/discours.epub', { open: true });
  await waitHtml(page);
  await store(page, () => window.__store.getState().updateSettings({ showExtracts: true, showToc: true }));
  await page.evaluate(() => (document.querySelector('.html-scroll').scrollTop = 2600));
  await sleep(700);
  check('bouton signet vide hors signet', (await pressed(page)) === 'false');
  await page.click('.html-scroll', { position: { x: 30, y: 300 } });
  await page.keyboard.press('Control+KeyD');
  await page.waitForSelector('.bm-pop', { timeout: 5000 });
  let list = await bookmarksOf(page, epubId);
  check('⌘D en EPUB : signet créé', list.length === 1, list.length);
  const bm1 = list[0];
  check('libellé proposé (section — début de phrase)', !!bm1 && bm1.label.length > 6 && bm1.label !== 'Signet', bm1?.label);
  check('ancrage texte + extrait de 40 caractères', bm1?.anchor?.kind === 'html' && bm1.excerpt?.length > 10, bm1?.excerpt);
  check('position HTML enregistrée', bm1?.position?.kind === 'html');
  const popVal = await page.inputValue('.bm-pop input[aria-label="Libellé du signet"]');
  check('popover : libellé proposé modifiable', popVal === bm1.label, popVal);
  await sleep(250);
  await shot(page, '1-epub-popover-clair.png');
  await page.fill('.bm-pop input[aria-label="Libellé du signet"]', 'Mon passage préféré');
  await page.keyboard.press('Enter');
  await sleep(300);
  list = await bookmarksOf(page, epubId);
  check('renommage depuis le popover', list[0]?.label === 'Mon passage préféré', list[0]?.label);
  check('popover fermé', !(await page.$('.bm-pop')));
  check('repère dans la marge du texte', !!(await page.$(`.html-bm[data-bm-id="${bm1.id}"]`)));
  check('bouton signet plein à cet endroit', (await pressed(page)) === 'true');
  check('repère sur la barre de progression', (await page.locator('.toc-track .bm-tick').count()) === 1);

  // Retour exact après avoir défilé ailleurs (liste du panneau)
  await page.evaluate(() => (document.querySelector('.html-scroll').scrollTop = 0));
  await sleep(600);
  check('bouton vide après avoir défilé ailleurs', (await pressed(page)) === 'false');
  await page.click('.reader-side-switch button:has-text("Signets")');
  await page.waitForSelector('[data-testid="bookmarks-panel"] .bm-row');
  await page.click(`.bm-row[data-bm-row="${bm1.id}"] .bm-row-main`);
  await sleep(1200);
  let v = await markerInView(page, bm1.id);
  check('clic dans la liste : retour exact au passage', v.ok, v);
  check('surlignage bref du paragraphe', (await page.locator('.html-bm-flash').count()) === 1);
  check('bouton plein au retour', (await pressed(page)) === 'true');
  const exact = await page.evaluate((ex) => {
    const sc = document.querySelector('.html-scroll');
    const a = sc.getBoundingClientRect();
    const w = document.createTreeWalker(document.querySelector('.html-doc'), NodeFilter.SHOW_TEXT);
    let n;
    const probe = ex.slice(0, 20);
    while ((n = w.nextNode())) {
      const i = n.data.indexOf(probe);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + 1);
      const t = r.getBoundingClientRect().top - a.top;
      if (t > -5 && t < a.height * 0.45) return Math.round(t);
    }
    return null;
  }, bm1.excerpt);
  check('le début du passage marqué est en haut de la fenêtre', exact !== null, exact);
  await shot(page, '2-epub-liste-retour.png');

  // Deuxième signet plus loin, puis suivant / précédent
  await page.evaluate(() => (document.querySelector('.html-scroll').scrollTop = 7000));
  await sleep(700);
  await page.keyboard.press('Control+KeyD');
  await page.waitForSelector('.bm-pop');
  await page.keyboard.press('Escape');
  await sleep(200);
  list = await bookmarksOf(page, epubId);
  check('second signet', list.length === 2);
  const bm2 = list.find((b) => b.id !== bm1.id);
  check('liste triée dans l’ordre du texte', (await page.getAttribute('.bm-row >> nth=0', 'data-bm-row')) === bm1.id);
  await page.evaluate(() => (document.querySelector('.html-scroll').scrollTop = 0));
  await sleep(500);
  await page.keyboard.press('Control+Alt+ArrowDown');
  await sleep(1100);
  v = await markerInView(page, bm1.id);
  check('⌘⌥↓ : premier signet', v.ok, v);
  await page.keyboard.press('Control+Alt+ArrowDown');
  await sleep(1100);
  v = await markerInView(page, bm2.id);
  check('⌘⌥↓ : signet suivant', v.ok, v);
  await page.keyboard.press('Control+Alt+ArrowUp');
  await sleep(1100);
  v = await markerInView(page, bm1.id);
  check('⌘⌥↑ : signet précédent', v.ok, v);

  // Renommage dans la liste
  await page.hover(`.bm-row[data-bm-row="${bm2.id}"]`);
  await page.click(`.bm-row[data-bm-row="${bm2.id}"] [aria-label="Renommer le signet"]`);
  await page.fill('.bm-row-label-input', 'Plus loin');
  await page.keyboard.press('Enter');
  await sleep(200);
  check('renommage dans la liste', (await bookmarksOf(page, epubId)).find((b) => b.id === bm2.id)?.label === 'Plus loin');
  // Couleur
  await page.hover(`.bm-row[data-bm-row="${bm2.id}"]`);
  await page.click(`.bm-row[data-bm-row="${bm2.id}"] [aria-label="Couleur du signet"]`);
  await page.click(`.bm-row[data-bm-row="${bm2.id}"] .bm-swatch[aria-label="Vert"]`);
  await sleep(200);
  check('couleur optionnelle', (await bookmarksOf(page, epubId)).find((b) => b.id === bm2.id)?.color === 'vert');

  // Suppression puis Annuler
  await page.hover(`.bm-row[data-bm-row="${bm2.id}"]`);
  await page.click(`.bm-row[data-bm-row="${bm2.id}"] [aria-label="Supprimer le signet"]`);
  await sleep(200);
  check('suppression', (await bookmarksOf(page, epubId)).length === 1);
  await page.click('.toast button:has-text("Annuler"), [class*="toast"] button:has-text("Annuler")');
  await sleep(300);
  list = await bookmarksOf(page, epubId);
  check('Annuler remet le signet (même libellé, même couleur)', list.length === 2 && list.find((b) => b.id === bm2.id)?.label === 'Plus loin' && list.find((b) => b.id === bm2.id)?.color === 'vert');
  check('journal : signet consigné', await store(page, () => window.__store.getState().activity.some((e) => e.kind === 'bookmark')));

  // Menu contextuel : « Ajouter un signet ici »
  const para = await page.evaluate(() => {
    const sc = document.querySelector('.html-scroll');
    const a = sc.getBoundingClientRect();
    const ps = [...document.querySelectorAll('.html-chapter-text p')].filter((p) => {
      const r = p.getBoundingClientRect();
      return r.top > a.top + 250 && r.bottom < a.bottom - 40 && (p.textContent ?? '').trim().length > 60;
    });
    const p = ps[0];
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: r.left + 40, y: r.top + 8, text: p.textContent.trim().slice(0, 30) };
  });
  if (para) {
    await page.mouse.click(para.x, para.y, { button: 'right' });
    await page.waitForSelector('.ws-menu');
    await shot(page, '3-epub-menu-contextuel.png');
    await page.click('.ws-menu .menu-item:has-text("Ajouter un signet ici")');
    await page.waitForSelector('.bm-pop');
    await page.keyboard.press('Escape');
    list = await bookmarksOf(page, epubId);
    const b3 = list.find((b) => b.id !== bm1.id && b.id !== bm2.id);
    check('clic droit : signet au début du paragraphe cliqué', !!b3 && b3.excerpt.replace(/\s+/g, ' ').startsWith(para.text.replace(/\s+/g, ' ').slice(0, 20)), { ex: b3?.excerpt, p: para.text });
    if (b3) await store(page, (id) => window.__store.getState().removeBookmark(id, { silent: true }), b3.id);
  } else check('clic droit : paragraphe trouvé', false);

  // Thème sombre / sépia
  await store(page, () => window.__store.getState().updateSettings({ theme: 'dark' }));
  await sleep(400);
  await shot(page, '4-epub-sombre.png');
  await store(page, () => window.__store.getState().updateSettings({ theme: 'sepia' }));
  await page.click('[data-testid="bookmark-toggle"]');
  await page.waitForSelector('.bm-pop');
  await sleep(250);
  await shot(page, '5-epub-sepia-popover.png');
  await page.keyboard.press('Escape');
  await store(page, () => window.__store.getState().updateSettings({ theme: 'light' }));

  // ── Rechargement : persistance, ⌘K, retour exact ──
  await sleep(2600); // écriture différée de la base
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  list = await bookmarksOf(page, epubId);
  check('après rechargement : signets conservés', list.length === 2 && list.some((b) => b.label === 'Mon passage préféré'));
  await store(page, () => window.__store.getState().navigate({ name: 'library' }));
  await sleep(300);
  await page.keyboard.press('Control+KeyK');
  await page.waitForSelector('.cmd-input');
  await page.fill('.cmd-input', 'passage préféré');
  await sleep(200);
  const item = await page.textContent('.cmd-item.focused');
  check('⌘K : résultat « Signet — libellé — livre »', /Signet — Mon passage préféré/.test(item) && /discours|Discours/i.test(item), item);
  await shot(page, '6-cmdk.png');
  await page.keyboard.press('Enter');
  await waitHtml(page);
  await sleep(1400);
  v = await markerInView(page, bm1.id);
  check('⌘K après rechargement : retour exact au signet', v.ok, v);

  // ── PDF ──────────────────────────────────────────────────
  const pdfId = await importFixture(page, 'fixtures/discours.pdf', { open: true });
  await waitPdf(page);
  await page.evaluate(() => {
    const sc = document.querySelector('.pdf-scroll');
    const pages = document.querySelectorAll('.pdf-page');
    const p = pages[Math.min(2, pages.length - 1)];
    sc.scrollTop = p.offsetTop + 120;
  });
  await sleep(1200);
  const curPage = Number((await page.textContent('[data-testid="pdf-page"]')).match(/p\.\s*(\d+)/)[1]);
  await page.keyboard.press('Control+KeyD');
  await page.waitForSelector('.bm-pop');
  list = await bookmarksOf(page, pdfId);
  const pb = list[0];
  check('⌘D en PDF : signet créé', list.length === 1);
  check('libellé « Page N »', pb && /^Page \d+$/.test(pb.label) && Math.abs(pb.position.page - curPage) <= 1, pb?.label + ' / page affichée ' + curPage);
  check('PDF : ancrage sur une ligne de texte', pb?.anchor?.kind === 'pdf' && pb.anchor.rects[0].w < 1 && (pb.excerpt ?? '').length > 3, pb?.excerpt);
  await page.keyboard.press('Enter');
  await sleep(300);
  check('PDF : ruban sur la page', !!(await page.$(`.pdf-bm[data-bm-id="${pb.id}"]`)));
  check('PDF : bouton plein', (await pressed(page)) === 'true');
  await shot(page, '7-pdf-signet.png');
  await page.evaluate(() => (document.querySelector('.pdf-scroll').scrollTop = 0));
  await sleep(500);
  check('PDF : bouton vide ailleurs', (await pressed(page)) === 'false');
  await page.keyboard.press('Control+Alt+ArrowDown');
  await sleep(900);
  v = await markerInView(page, pb.id, '.pdf-scroll');
  check('PDF : ⌘⌥↓ ramène au signet', v.ok, v);
  check('PDF : surlignage bref de la ligne', (await page.locator('.pdf-bm-flash').count()) === 1);
  await shot(page, '8-pdf-retour.png');

  // ── Cascade : suppression du livre puis restauration ──
  await store(page, () => window.__store.getState().navigate({ name: 'library' }));
  await sleep(300);
  const entry = await store(page, (id) => {
    const e = window.__store.getState().trashDelete('book', id);
    return e && { id: e.id, detail: e.detail };
  }, epubId);
  check('suppression du livre : signets retirés', (await bookmarksOf(page, epubId)).length === 0);
  check('corbeille : « avec 2 signets »', /2 signets/.test(entry?.detail ?? ''), entry?.detail);
  await store(page, (id) => window.__store.getState().restoreFromTrash(id), entry.id);
  list = await bookmarksOf(page, epubId);
  check('restauration du livre : signets revenus', list.length === 2 && list.some((b) => b.label === 'Mon passage préféré'));

  // ── Lecteur compact (panneau de l'éditeur) ──
  const draft = await page.evaluate(async () => {
    const m = await import('/src/features/editor/api.ts');
    return m.createDraft({ title: 'Signets', template: 'vide' });
  });
  await store(page, (id) => window.__store.getState().navigate({ name: 'write', draftId: id }), draft.id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await sleep(600);
  await page.click('.ed-side-tabs [data-side="book"]');
  await page.waitForSelector('.ed-bookpick', { timeout: 10000 });
  await page.click(`.ed-bookpick-item[data-book="${epubId}"]`);
  await waitHtml(page, '.ed-book');
  await page.evaluate(() => (document.querySelector('.ed-book .html-scroll').scrollTop = 4000));
  await sleep(700);
  await page.click('.ed-book .html-scroll', { position: { x: 40, y: 200 } });
  await page.keyboard.press('Control+KeyD');
  await page.waitForSelector('.bm-pop');
  await page.keyboard.press('Enter');
  list = await bookmarksOf(page, epubId);
  check('éditeur : ⌘D dans le lecteur compact', list.length === 3);
  check('éditeur : ruban dans la marge', (await page.locator('.ed-book .html-bm').count()) >= 1);
  check('éditeur : icône pleine', (await pressed(page, '[data-testid="ed-bookmarks"]')) === 'true' || (await page.getAttribute('[data-testid="ed-bookmarks"]', 'class')).includes('is-on'));
  await page.evaluate(() => (document.querySelector('.ed-book .html-scroll').scrollTop = 0));
  await sleep(400);
  await page.click('[data-testid="ed-bookmarks"]');
  await page.waitForSelector('.ed-book-bookmarks .bm-row');
  await sleep(600);
  check('éditeur : liste des signets', (await page.locator('.ed-book-bookmarks .bm-row').count()) === 3);
  await shot(page, '9-editeur-liste.png');
  const newest = list.sort((a, b) => b.createdAt - a.createdAt)[0];
  await page.click(`.ed-book-bookmarks .bm-row[data-bm-row="${newest.id}"] .bm-row-main`);
  await sleep(1200);
  v = await markerInView(page, newest.id, '.ed-book .html-scroll');
  check('éditeur : retour au signet', v.ok, v);
  await shot(page, '10-editeur-retour.png');
} catch (e) {
  failed++;
  console.log('ÉCHEC (exception)', e);
  await shot(page, 'erreur.png').catch(() => {});
} finally {
  if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + errors.slice(0, 15).join('\n'));
  await browser.close();
  await server.close();
}
console.log(failed ? `\n${failed} échec(s)` : '\nTout est vert.');
process.exit(failed ? 1 : 0);
