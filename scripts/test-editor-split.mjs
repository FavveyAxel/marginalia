// Vue partagée de l'éditeur (SidePanel / BookPane) — port 5323.
// Lancer : timeout 240 node scripts/test-editor-split.mjs
// Écrit ouvert → contenu « Livre » → choix d'un livre → sélection → « Citer dans l'écrit »
// (citation insérée + extrait créé + signet _mglHl_) → Extraits puis retour au livre (même position)
// → redimensionnement (poignée, 50/50) → réouverture (contenu et livre restaurés) → PDF → captures.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/editor-split');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5323;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
}
async function shot(page, name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p });
  console.log('capture:', path.relative(ROOT, p));
}

async function importFixture(page, file) {
  const b64 = fs.readFileSync(path.join(ROOT, file)).toString('base64');
  return page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await window.__store.getState().importFiles([{ name, data: bin.buffer }]);
      return book?.id;
    },
    { name: path.basename(file), b64 },
  );
}
async function openDraft(page, id) {
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(700);
}
async function caretAfterHeading(page, headingText) {
  await page.evaluate((t) => {
    const e = window.__ed.engine();
    const o = e.outline().find((x) => x.text === t);
    e.goTo(o.pos);
  }, headingText);
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
}
async function waitBook(page) {
  await page.waitForSelector('.ed-book .html-doc.is-revealed', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.ed-book .reader-loading.overlay'), null, { timeout: 30000 });
  await page.waitForTimeout(500);
}
/** Sélectionne `needle` dans le livre du panneau (événement selectionchange → barre de sélection). */
async function selectInBook(page, needle) {
  return page.evaluate((needle) => {
    const root = document.querySelector('.ed-book .html-doc');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = n.textContent.indexOf(needle);
      if (i >= 0) {
        n.parentElement.scrollIntoView({ block: 'center' });
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + needle.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
      }
    }
    return false;
  }, needle);
}

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
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').slice(0, 600)));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('response', (r) => r.status() >= 400 && errors.push(r.status() + ' : ' + r.url()));

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });

  const epubId = await importFixture(page, 'fixtures/discours.epub');
  const pdfId = await importFixture(page, 'fixtures/discours.pdf');
  check('livres importés', !!epubId && !!pdfId);
  // Livre EPUB « récemment ouvert » : premier de la liste
  await page.evaluate((id) => window.__store.getState().updateBook(id, { lastOpenedAt: Date.now() }), epubId);

  const draft = await page.evaluate(async () => {
    const m = await import('/src/features/editor/api.ts');
    return m.createDraft({ title: 'Le doute', template: 'dissertation' });
  });
  await openDraft(page, draft.id);
  check('panneau latéral ouvert par défaut sur Extraits', await page.isVisible('.ed-side[data-content="extracts"] .ed-extracts'));

  // ── Choix d'un livre ──
  await page.click('.ed-side-tabs [data-side="book"]');
  await page.waitForSelector('.ed-bookpick', { timeout: 10000 });
  const firstPick = await page.getAttribute('.ed-bookpick-item >> nth=0', 'data-book');
  check('choix du livre : récents en premier', firstPick === epubId);
  await page.fill('.ed-bookpick input', 'discours');
  const nPick = await page.locator('.ed-bookpick-item').count();
  check('choix du livre : recherche', nPick === 2, `${nPick} livre(s)`);
  await page.click(`.ed-bookpick-item[data-book="${epubId}"]`);
  await waitBook(page);
  check('livre affiché dans le panneau (vrai lecteur HTML)', await page.isVisible('.ed-book .html-reader'));
  await shot(page, '1-livre-clair.png');

  // ── Citer dans l'écrit ──
  await caretAfterHeading(page, 'Introduction');
  await page.keyboard.type('Descartes écrit : ');
  await page.waitForTimeout(300);
  const nHl0 = await page.evaluate(() => window.__store.getState().highlights.length);
  const needle = 'Le bon sens est la chose du monde la mieux partagée';
  check('sélection dans le livre', await selectInBook(page, needle));
  await page.waitForSelector('.sel-toolbar .sel-cite', { timeout: 5000 });
  await shot(page, '2-barre-citer.png');
  await page.click('.sel-toolbar .sel-cite');
  await page.waitForTimeout(900);
  const after = await page.evaluate(async (needle) => {
    const s = window.__store.getState();
    const h = s.highlights[s.highlights.length - 1];
    const { citationRanges } = await import('/src/features/editor/citeLink.ts');
    const e = window.__ed.engine();
    return { n: s.highlights.length, h, text: e.plainText(), ranges: citationRanges(e).map((r) => r.highlightId), active: document.activeElement?.closest('.ProseMirror') !== null };
  }, needle);
  check('extrait créé', after.n === nHl0 + 1 && after.h.text.includes(needle), after.h?.text?.slice(0, 60));
  check('citation insérée dans l’écrit', after.text.includes(`« ${after.h.text.replace(/\s+/g, ' ').trim()} »`));
  check('lien citation → extrait (_mglHl_)', after.ranges.includes(after.h.id));
  check('surlignage visible dans le livre', await page.isVisible(`.ed-book [data-hl-id="${after.h.id}"]`).catch(() => false) || (await page.locator(`.ed-book .hl`).count()) > 0);
  check('la frappe reprend dans l’écrit', after.active);
  await page.keyboard.type('MARQUEUR-APRES');
  await page.waitForTimeout(300);
  check('saisie après la citation', await page.evaluate(() => window.__ed.engine().plainText().includes('MARQUEUR-APRES')));
  await shot(page, '3-citation-inseree.png');

  // ── Position : défilement, Extraits, retour au livre ──
  await page.evaluate(() => {
    const sc = document.querySelector('.ed-book .html-scroll');
    sc.scrollTop = Math.min(sc.scrollHeight - sc.clientHeight, 9000);
  });
  await page.waitForTimeout(2600);
  const scroll1 = await page.evaluate(() => document.querySelector('.ed-book .html-scroll').scrollTop);
  const label1 = await page.textContent('.ed-book-title-sub');
  await page.click('.ed-side-tabs [data-side="extracts"]');
  await page.waitForTimeout(400);
  check('Extraits affichés, livre démonté', (await page.isVisible('.ed-side .ed-extracts')) && !(await page.$('.ed-book')));
  check('le nouvel extrait figure dans Extraits', await page.isVisible(`.ed-side .ed-xt[data-hl="${after.h.id}"]`));
  const pos = await page.evaluate((id) => window.__store.getState().books.find((b) => b.id === id).position, epubId);
  check('position du livre enregistrée', !!pos && pos.kind === 'html', JSON.stringify(pos));
  await page.click('.ed-side-tabs [data-side="book"]');
  await waitBook(page);
  await page.waitForTimeout(800);
  const scroll2 = await page.evaluate(() => document.querySelector('.ed-book .html-scroll').scrollTop);
  const label2 = await page.textContent('.ed-book-title-sub');
  check('retour au livre à la même position', Math.abs(scroll2 - scroll1) < 120 && label1 === label2, `${Math.round(scroll1)} → ${Math.round(scroll2)} ; « ${label1} » / « ${label2} »`);

  // ── Sommaire ──
  await page.click('.ed-book-head [aria-label="Sommaire"]');
  await page.waitForTimeout(300);
  check('sommaire dans le panneau', (await page.locator('.ed-book-toc [data-toc]').count()) > 0);
  await shot(page, '4-sommaire.png');
  await page.click('.ed-book-toc [data-toc] >> nth=0');
  await page.waitForTimeout(600);
  check('sommaire refermé après choix', !(await page.$('.ed-book-toc')));

  // ── Redimensionnement ──
  const w0 = await page.evaluate(() => document.querySelector('.ed-side').getBoundingClientRect().width);
  const grip = await page.locator('.ed-side-grip').boundingBox();
  await page.mouse.move(grip.x + 4, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 100, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.move(grip.x - 200, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const w1 = await page.evaluate(() => document.querySelector('.ed-side').getBoundingClientRect().width);
  const prefW = await page.evaluate(() => JSON.parse(localStorage.getItem('marginalia.ed.side')).width);
  check('redimensionnement par la poignée', Math.abs(w1 - w0 - 200) < 6 && Math.abs(prefW - w1) < 2, `${Math.round(w0)} → ${Math.round(w1)} (mémorisé ${prefW})`);
  // borne max : l'écrit garde sa largeur minimale
  await page.mouse.move(grip.x - 196, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(0, grip.y + grip.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const wMax = await page.evaluate(() => {
    const body = document.querySelector('.ed-body');
    return { side: document.querySelector('.ed-side').getBoundingClientRect().width, body: body.clientWidth };
  });
  check('largeur maximale bornée', wMax.side <= wMax.body - 419, `${Math.round(wMax.side)} / ${wMax.body}`);
  await page.click('.ed-side-head [aria-label="Partager l’écran à 50/50"]');
  await page.waitForTimeout(400);
  const half = await page.evaluate(() => ({ side: document.querySelector('.ed-side').getBoundingClientRect().width, body: document.querySelector('.ed-body').clientWidth }));
  check('50/50', Math.abs(half.side - half.body / 2) < 4, `${Math.round(half.side)} / ${half.body}`);
  await shot(page, '5-cinquante-cinquante.png');
  await page.click('.ed-side-head [aria-label="Partager l’écran à 50/50"]');
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => document.querySelector('.ed-side').getBoundingClientRect().width);
  check('retour à la largeur choisie', Math.abs(back - wMax.side) < 4, `${Math.round(back)}`);
  // largeur raisonnable pour la suite
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('marginalia.ed.side'));
    localStorage.setItem('marginalia.ed.side', JSON.stringify({ ...p, width: 480 }));
  });

  // ── Performance : défiler le livre ne re-rend pas l'éditeur ──
  const renders = await page.evaluate(async () => {
    // compte les mutations de la barre d'outils de l'éditeur pendant un défilement du livre
    let n = 0;
    const mo = new MutationObserver((l) => (n += l.length));
    mo.observe(document.querySelector('.ed-toolbar-row'), { subtree: true, childList: true, attributes: true, characterData: true });
    const sc = document.querySelector('.ed-book .html-scroll');
    for (let i = 0; i < 20; i++) {
      sc.scrollTop += 400;
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 1800));
    mo.disconnect();
    return n;
  });
  check('défilement du livre : éditeur non re-rendu', renders === 0, `${renders} mutation(s) dans la barre d’outils`);

  // ── Réouverture : contenu et livre restaurés ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'write', draftId: null }));
  await page.waitForTimeout(600);
  await openDraft(page, draft.id);
  await waitBook(page);
  const restored = await page.evaluate(() => ({ content: document.querySelector('.ed-side')?.dataset.content, book: document.querySelector('.ed-book')?.dataset.book, w: document.querySelector('.ed-side').getBoundingClientRect().width }));
  check('réouverture : contenu, livre et largeur restaurés', restored.content === 'book' && restored.book === epubId && Math.abs(restored.w - 480) < 3, JSON.stringify(restored));

  // ── Changer de livre sans fermer le panneau : PDF ──
  await page.click('.ed-book-title');
  await page.waitForSelector('.ed-book-overlay .ed-bookpick');
  await page.click(`.ed-book-overlay .ed-bookpick-item[data-book="${pdfId}"]`);
  await page.waitForSelector('.ed-book .pdf-reader, .ed-book [class*="pdf"]', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.ed-book .reader-loading.overlay'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  check('PDF dans le panneau', (await page.$eval('.ed-book', (el) => el.dataset.book)) === pdfId);
  await shot(page, '6-pdf.png');

  // Fermer / rouvrir le panneau
  await page.click('.ed-side-head [aria-label="Fermer le panneau"]');
  await page.waitForTimeout(300);
  check('panneau fermé', !(await page.$('.ed-side')));
  await page.click('[aria-label="Afficher le panneau latéral"]');
  await page.waitForSelector('.ed-side .ed-book', { timeout: 10000 });
  check('panneau rouvert sur le dernier livre', (await page.$eval('.ed-book', (el) => el.dataset.book)) === pdfId);

  // ── Thèmes ──
  await page.click('.ed-book-title');
  await page.click(`.ed-book-overlay .ed-bookpick-item[data-book="${epubId}"]`);
  await waitBook(page);
  for (const theme of ['dark', 'sepia']) {
    await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
    await page.waitForTimeout(500);
    await selectInBook(page, 'je pense, donc je suis').catch(() => false);
    await page.waitForTimeout(400);
    await shot(page, `7-theme-${theme}.png`);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));

  // ── Autres contenus ──
  await page.evaluate(() => {
    const s = window.__store.getState();
    const c = s.addConcept('Doute', 'Suspension du jugement en vue de la certitude.');
    const h = s.highlights[s.highlights.length - 1];
    s.toggleHighlightConcept(h.id, c.id);
  });
  await page.click('.ed-side-tabs [data-side="concepts"]');
  await page.click('.ed-cpt-head >> nth=0');
  await page.waitForTimeout(300);
  check('Concepts : définition et extraits rattachés', (await page.isVisible('.ed-cpt.is-open .ed-cpt-def')) && (await page.locator('.ed-cpt.is-open .ed-xt').count()) === 1);
  await shot(page, '8-concepts.png');
  await page.click('.ed-side-tabs [data-side="plan"]');
  await page.waitForTimeout(300);
  check('Plan : affiché (ou état vide)', await page.isVisible('.ed-side .ed-plan, .ed-side .ed-extracts-empty'));
} catch (e) {
  console.error(e);
  check('exécution sans exception', false, String(e?.message ?? e));
  await shot(page, 'erreur.png').catch(() => undefined);
} finally {
  // 404 : seulement l'icône du site (le message de la console ne donne pas l'adresse)
  const only404Favicon = errors.filter((x) => /^404 : /.test(x)).every((x) => /favicon/.test(x));
  const errs = [...new Set(errors)].filter((x) => !/favicon/.test(x) && !(only404Favicon && /status of 404/.test(x)));
  if (errs.length) console.log('ERREURS NAVIGATEUR:\n' + errs.join('\n'));
  check('aucune erreur dans la console', errs.length === 0);
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
