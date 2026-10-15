// Surlignage simple (sans catégorie ni note) — port 5373. Lancer : timeout 400 node scripts/test-plain-highlight.mjs
// EPUB : sélection + H / 0 → surlignage créé sans fenêtre de note, couleur neutre (--hl-plain) ;
// panneau Extraits : filtre « Surlignages », compteurs, « Classer » d'un clic, ajout d'une note (→ note de marge) ;
// popover : état « Surlignage » ; export Markdown ; correspondance des couleurs de Livres (test unitaire) ;
// vues qui affichent la catégorie (Extraits, accueil, carte, ⌘K, historique) sans plantage ;
// PDF : sélection + H. Captures clair / sombre / sépia dans shots/plain-highlight/.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importFixture } from './harness.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/plain-highlight');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5373;

let failed = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${name}${detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = (page, fn, arg) => page.evaluate(fn, arg);
const hls = (page) => store(page, () => window.__store.getState().highlights);
async function shot(page, name) {
  await page.mouse.move(2, 300);
  await page.evaluate(() => {
    const s = window.__store.getState();
    (s.toasts ?? []).forEach((t) => s.dismissToast?.(t.id));
  });
  await sleep(250);
  const p = path.join(OUT, name);
  await page.screenshot({ path: p });
  console.log('capture:', path.relative(ROOT, p));
}

async function waitHtml(page) {
  await page.waitForSelector('.html-doc.is-revealed', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.reader-loading.overlay'), null, { timeout: 30000 });
  await sleep(500);
}

/** Sélectionne `needle` dans le texte du lecteur HTML et attend la barre. */
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

/** Sélection dans le calque de texte d'une page PDF. */
async function selectPdf(page, needle, pageNo = 1) {
  const ok = await page.evaluate(
    ({ needle, pageNo }) => {
      const layer = document.querySelector(`.pdf-page[data-page="${pageNo}"] .textLayer`);
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let all = '';
      let n;
      while ((n = walker.nextNode())) {
        nodes.push({ node: n, start: all.length });
        all += n.data;
      }
      const i = all.indexOf(needle);
      if (i < 0) return false;
      const at = (off, atEnd) => {
        for (let k = nodes.length - 1; k >= 0; k--) {
          const e = nodes[k].start + nodes[k].node.data.length;
          if (nodes[k].start <= off && (off < e || (atEnd && off === e))) return [nodes[k].node, off - nodes[k].start];
        }
        return null;
      };
      const a = at(i, false);
      const b = at(i + needle.length, true);
      const r = document.createRange();
      r.setStart(a[0], a[1]);
      r.setEnd(b[0], b[1]);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return true;
    },
    { needle, pageNo },
  );
  if (!ok) throw new Error('Texte PDF introuvable : ' + needle);
  await page.waitForSelector('.sel-toolbar', { timeout: 4000 });
  await sleep(150);
}

/** Couleur de fond calculée d'un élément de surlignage. */
const bgOf = (page, sel) =>
  page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const cs = getComputedStyle(e);
    return { bg: cs.backgroundColor, shadow: cs.boxShadow };
  }, sel);
const cssVar = (page, v) => page.evaluate((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), v);

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

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await store(page, () => window.__store.getState().updateSettings({ theme: 'light' }));

  // ── EPUB ─────────────────────────────────────────────────
  const epubId = await importFixture(page, 'fixtures/discours.epub', { open: true });
  await waitHtml(page);
  await store(page, () => window.__store.getState().updateSettings({ showExtracts: true, rightPanel: 'extraits' }));
  await sleep(300);

  const P1 = 'Le bon sens est la chose du monde la mieux partagée';
  await selectHtml(page, P1);
  const btn = await page.evaluate(() => {
    const first = document.querySelector('.sel-toolbar > button');
    return { cls: first?.className, title: first?.getAttribute('title'), text: first?.textContent };
  });
  check('barre : « Surligner » en premier', /sel-plain/.test(btn.cls ?? '') && /Surligner/.test(btn.text ?? ''), btn);
  check('info-bulle « Surligner (H) — sans catégorie »', btn.title === 'Surligner (H) — sans catégorie', btn.title);
  await shot(page, '1-barre-clair.png');
  await page.keyboard.press('h');
  await page.waitForSelector('.sel-toolbar', { state: 'detached', timeout: 3000 });
  await sleep(400);
  let list = await hls(page);
  const h1 = list.find((h) => h.text === P1);
  check('H : surlignage créé', !!h1, list.map((h) => h.text));
  check('H : sans catégorie ni note, drapeau plain', h1 && h1.category === null && h1.plain === true && h1.note === '' && !h1.noteKind, h1);
  check('H : aucune fenêtre de note ouverte', !(await page.$('.ann-pop')));
  check('rendu .hl.hl-plain dans le texte', (await page.locator(`.hl.hl-plain[data-hl-id="${h1?.id}"]`).count()) >= 1);
  const plainBg = await bgOf(page, `.hl.hl-plain[data-hl-id="${h1?.id}"]`);
  check('couleur neutre (fond --hl-plain, sans filet de catégorie)', !!plainBg && plainBg.bg !== 'rgba(0, 0, 0, 0)' && plainBg.shadow === 'none', plainBg);

  // 0 : même effet
  const P2 = 'à contenter en toute autre chose';
  await selectHtml(page, P2);
  await page.keyboard.press('0');
  await page.waitForSelector('.sel-toolbar', { state: 'detached', timeout: 3000 });
  await sleep(300);
  list = await hls(page);
  check('0 : surlignage simple aussi', list.some((h) => h.text === P2 && h.plain === true && h.category === null));
  check('0 : aucune fenêtre de note ouverte', !(await page.$('.ann-pop')));

  // Clic sur le bouton
  const P3 = 'principal est de l’appliquer bien';
  await selectHtml(page, P3);
  await page.click('.sel-toolbar .sel-plain');
  await page.waitForSelector('.sel-toolbar', { state: 'detached', timeout: 3000 });
  await sleep(300);
  const P6 = 'conduisons nos pensées par diverses voies';
  await selectHtml(page, P6);
  await page.keyboard.press('h');
  await sleep(300);

  // Pour comparer : une thèse (2) et une note de marge (N)
  const P4 = 'Les plus grandes âmes sont capables des plus grands vices';
  await selectHtml(page, P4);
  await page.keyboard.press('2');
  await sleep(300);
  const P5 = 'mêmes choses';
  await selectHtml(page, P5);
  await page.keyboard.press('n');
  await page.waitForSelector('.ann-pop', { timeout: 3000 });
  check('N : la fenêtre de note s’ouvre toujours', true);
  await page.keyboard.press('Escape');
  await sleep(300);
  list = await hls(page);
  const these = list.find((h) => h.text === P4);
  const theseBg = await bgOf(page, `.hl[data-hl-id="${these?.id}"]`);
  check('surlignage simple distinct de la Thèse', theseBg && plainBg && theseBg.bg !== plainBg.bg, { plain: plainBg?.bg, these: theseBg?.bg });
  const note = list.find((h) => h.text === P5);
  check('note de marge : ni catégorie ni plain', note && note.category === null && !note.plain);

  // Panneau Extraits : filtre et compteurs
  await page.waitForSelector('[data-filter="plain"]', { timeout: 5000 });
  const n = async (k) => Number(await page.textContent(`[data-filter="${k}"] .ann-chip-n`));
  check('compteur « Surlignages » = 4', (await n('plain')) === 4, await n('plain'));
  check('compteur « Notes » = 1', (await n('note')) === 1, await n('note'));
  check('compteur « Thèse » = 1', (await n('these')) === 1, await n('these'));
  await page.click('[data-filter="plain"]');
  await sleep(300);
  const shown = await page.$$eval('.ann-card', (cs) => cs.map((c) => c.querySelector('.ann-card-cat')?.textContent));
  check('filtre « Surlignages » : 4 cartes « Surlignage »', shown.length === 4 && shown.every((t) => t === 'Surlignage'), shown);
  await shot(page, '2-epub-extraits-clair.png');

  // Classer d'un clic
  const h3 = list.find((h) => h.text === P3);
  await page.click(`.ann-card[data-hid="${h3.id}"] [data-set-cat="argument"]`);
  await sleep(300);
  let h3b = (await hls(page)).find((h) => h.id === h3.id);
  check('classer ensuite : catégorie Argument, plus de drapeau plain', h3b.category === 'argument' && h3b.plain === undefined, h3b);
  check('rendu passé en .hl-argument', (await page.locator(`.hl.hl-argument[data-hl-id="${h3.id}"]`).count()) >= 1);
  check('compteur « Surlignages » = 3', (await n('plain')) === 3, await n('plain'));

  // Ajouter une note → note de marge
  const h6 = list.find((h) => h.text === P6);
  await page.click(`.ann-card[data-hid="${h6.id}"] [data-add-note]`);
  await page.fill(`.ann-card[data-hid="${h6.id}"] .ann-plain-note`, 'À relier au doute méthodique');
  await page.click('.ann-head, .ann-chips', { position: { x: 2, y: 2 } }).catch(() => {});
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(300);
  const h6b = (await hls(page)).find((h) => h.id === h6.id);
  check('ajouter une note : devient note de marge', h6b.note === 'À relier au doute méthodique' && h6b.category === null && !h6b.plain, h6b);
  check('compteurs : Surlignages 2, Notes 2', (await n('plain')) === 2 && (await n('note')) === 2, [await n('plain'), await n('note')]);
  await page.click('[data-filter="plain"]');
  await sleep(200);

  // Popover d'un surlignage simple
  await page.click(`.hl.hl-plain[data-hl-id="${h1.id}"]`);
  await page.waitForSelector('.ann-pop', { timeout: 3000 });
  check('popover : « Surlignage » coché', (await page.getAttribute('.ann-pop [data-cat="plain"]', 'aria-checked')) === 'true');
  check('popover : « Note de marge » non coché', (await page.getAttribute('.ann-pop [data-cat="none"]', 'aria-checked')) === 'false');
  await shot(page, '3-popover-clair.png');
  await page.keyboard.press('Escape');
  await sleep(200);

  // ── Export Markdown ──
  const md = await page.evaluate(async (bookId) => {
    const m = await import('/src/lib/exportMarkdown.ts');
    return m.bookToMarkdown(bookId, window.__store.getState());
  }, epubId);
  fs.writeFileSync(path.join(OUT, 'export.md'), md);
  check('export : callout « Surlignage » pour un surlignage simple', /> \[!quote\][^\n]*Surlignage[^\n]*\n> Le bon sens est la chose du monde la mieux partagée/.test(md));
  check('export : récapitulatif « Surlignages : 2 »', md.includes('- Surlignages : 2'));
  check('export : notes de marge comptées à part (2)', md.includes('- Notes de marge : 2'));
  check('export : note de marge toujours en callout note', /> \[!note\][^\n]*Note de marge/.test(md));

  // ── Livres : correspondance des couleurs ──
  const ab = await page.evaluate(async () => {
    const m = await import('/src/features/library/appleBooksAnnotations.ts');
    return {
      plainNoNote: m.kindForTarget('plain', ''),
      plainNote: m.kindForTarget('plain', 'une note'),
      note: m.kindForTarget('note', ''),
      cat: m.kindForTarget('these', ''),
      def: m.colorMapOf({}),
      custom: m.colorMapOf({ appleBooksColorMap: { jaune: 'plain', rose: 'note' } }),
    };
  });
  check('Livres : « Surlignage simple » sans note → plain', ab.plainNoNote.category === null && ab.plainNoNote.plain === true, ab.plainNoNote);
  check('Livres : « Surlignage simple » avec note Livres → note de marge', ab.plainNote.category === null && ab.plainNote.plain === false, ab.plainNote);
  check('Livres : note et catégorie inchangées', ab.note.plain === false && ab.note.category === null && ab.cat.category === 'these' && !ab.cat.plain);
  check('Livres : correspondance par défaut inchangée', JSON.stringify(ab.def) === JSON.stringify({ jaune: 'these', vert: 'argument', bleu: 'concept', rose: 'objection', violet: 'exemple', souligne: 'probleme' }), ab.def);
  check('Livres : réglages existants préservés + « plain »', ab.custom.jaune === 'plain' && ab.custom.rose === 'note' && ab.custom.vert === 'argument', ab.custom);

  // ── Vues qui affichent la catégorie ──
  const errBefore = errors.length;
  await store(page, () => window.__store.getState().navigate?.({ name: 'extracts' }) ?? window.__store.setState({ route: { name: 'extracts' } }));
  await page.waitForSelector('[data-cat="plain"]', { timeout: 5000 });
  const axN = Number(await page.textContent('[data-cat="plain"] .ax-n'));
  check('vue Extraits : filtre « Surlignages » (2)', axN === 2, axN);
  await page.click('[data-cat="plain"]');
  await sleep(300);
  await shot(page, '4-tous-extraits-clair.png');
  check('vue Extraits : libellé « Surlignage »', (await page.locator('text=Surlignage').count()) > 0);
  await page.click('[data-cat="plain"]');
  for (const route of [{ name: 'home' }, { name: 'history' }, { name: 'reader', bookId: epubId, tab: 'carte', splitBookId: null }, { name: 'concepts' }, { name: 'arguments' }, { name: 'plans' }, { name: 'revision' }]) {
    await store(page, (r) => window.__store.setState({ route: r }), route);
    await sleep(700);
    if (route.name === 'home') await shot(page, '5-accueil-clair.png');
    if (route.tab === 'carte') {
      const has = await page.locator('text=Surlignages').count();
      check('carte d’argument : filtre « Surlignages »', has > 0);
      await shot(page, '6-carte-clair.png');
    }
  }
  await page.keyboard.press('Control+KeyK');
  await sleep(300);
  await page.keyboard.type('bon sens est la chose');
  await sleep(400);
  check('⌘K : extrait surligné trouvé', (await page.locator('.cmd-item, [role="option"]').filter({ hasText: 'Le bon sens est la chose' }).count()) > 0);
  await shot(page, '7-palette-clair.png');
  await page.keyboard.press('Escape');
  check('aucune erreur dans les vues', errors.length === errBefore, errors.slice(errBefore));

  // ── Sombre / sépia ──
  await store(page, (id) => window.__store.getState().openBook(id), epubId);
  await waitHtml(page);
  await page.evaluate(() => document.querySelector('.hl.hl-plain')?.scrollIntoView({ block: 'center' }));
  await sleep(400);
  await store(page, () => window.__store.getState().updateSettings({ theme: 'dark' }));
  await sleep(400);
  const darkVar = await cssVar(page, '--hl-plain');
  check('sombre : variable --hl-plain dédiée', !!darkVar, darkVar);
  await shot(page, '8-epub-sombre.png');
  await selectHtml(page, 'puissance de bien juger');
  await shot(page, '9-barre-sombre.png');
  await page.keyboard.press('Escape');
  await page.evaluate(() => getSelection().removeAllRanges());
  await store(page, () => window.__store.getState().updateSettings({ theme: 'sepia' }));
  await sleep(400);
  await shot(page, '10-epub-sepia.png');
  await store(page, () => window.__store.getState().updateSettings({ theme: 'light' }));
  await sleep(300);

  // ── PDF ──────────────────────────────────────────────────
  const pdfId = await importFixture(page, 'fixtures/discours.pdf', { open: true });
  await page.waitForSelector('.pdf-page[data-page="1"] .textLayer[data-ready="1"]', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.reader-loading.overlay'), null, { timeout: 30000 });
  await sleep(600);
  const Q = 'Le bon sens est la chose du monde la mieux partagée';
  await selectPdf(page, Q);
  check('PDF : bouton « Surligner » dans la barre', !!(await page.$('.sel-toolbar .sel-plain')));
  await page.keyboard.press('h');
  await page.waitForSelector('.sel-toolbar', { state: 'detached', timeout: 3000 });
  await sleep(400);
  const ph = (await hls(page)).find((h) => h.bookId === pdfId);
  check('PDF : H crée un surlignage simple', ph && ph.category === null && ph.plain === true && ph.anchor.kind === 'pdf', ph);
  check('PDF : aucune fenêtre de note', !(await page.$('.ann-pop')));
  check('PDF : rendu .hl-plain', (await page.locator(`.hl.hl-plain[data-hl-id="${ph?.id}"]`).count()) >= 1);
  const pdfBg = await bgOf(page, `.hl.hl-plain[data-hl-id="${ph?.id}"]`);
  check('PDF : fond neutre', pdfBg && pdfBg.bg !== 'rgba(0, 0, 0, 0)', pdfBg);
  await shot(page, '11-pdf-clair.png');
  await store(page, () => window.__store.getState().updateSettings({ theme: 'dark' }));
  await sleep(400);
  await shot(page, '12-pdf-sombre.png');
  await store(page, () => window.__store.getState().updateSettings({ theme: 'light' }));

  // Historique : libellé
  const hist = await page.evaluate(async () => {
    const m = await import('/src/features/history/describe.ts');
    return Object.keys(m);
  });
  check('module historique chargé', hist.length > 0);
} catch (e) {
  failed++;
  console.log('ÉCHEC exception :', e.message);
  await page.screenshot({ path: path.join(OUT, 'erreur.png') }).catch(() => {});
} finally {
  if (errors.length) console.log('ERREURS NAVIGATEUR :\n' + errors.join('\n'));
  await browser.close();
  await server.close();
}
console.log(failed ? `\n${failed} échec(s)` : '\nTout est vert.');
process.exit(failed ? 1 : 0);
