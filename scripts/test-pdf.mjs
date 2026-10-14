// Test du moteur PDF (A2) — port 5202. Lancer : timeout 170 node scripts/test-pdf.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { withApp, importFixture, shot } from './harness.mjs';

const PORT = 5202;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let failed = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** Sélectionne dans le calque de texte d'une page le passage allant de `from` à `to` (inclus). */
async function selectRange(page, from, to = from, { startPage = null, endPage = null } = {}) {
  return page.evaluate(
    ({ from, to, startPage, endPage }) => {
      const pos = (pageNo, needle, atEnd, after) => {
        const pages = [...document.querySelectorAll('.pdf-page')].filter((p) => !pageNo || p.dataset.page == pageNo);
        for (const p of pages) {
          const layer = p.querySelector('.textLayer');
          if (!layer) continue;
          const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
          const nodes = [];
          let all = '';
          let n;
          while ((n = walker.nextNode())) {
            nodes.push({ node: n, start: all.length });
            all += n.data;
          }
          const i = all.indexOf(needle, after ?? 0);
          if (i < 0) continue;
          const off = atEnd ? i + needle.length : i;
          for (let k = nodes.length - 1; k >= 0; k--) {
            if (nodes[k].start <= off && (off < nodes[k].start + nodes[k].node.data.length || (atEnd && off === nodes[k].start + nodes[k].node.data.length)))
              return { node: nodes[k].node, offset: off - nodes[k].start, page: p.dataset.page };
          }
        }
        return null;
      };
      const a = pos(startPage, from, false);
      const b = pos(endPage ?? (to === from ? startPage : endPage), to, true);
      if (!a || !b) return null;
      const r = document.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      const bb = r.getBoundingClientRect();
      return { page: a.page, x: bb.x, y: bb.y, w: bb.width, h: bb.height };
    },
    { from, to, startPage, endPage },
  );
}

/** Rectangle englobant (écran) des éléments .hl d'un surlignage. */
const hlBox = (page, id) =>
  page.evaluate((id) => {
    const els = [...document.querySelectorAll(`.hl[data-hl-id="${id}"]`)];
    if (!els.length) return null;
    const rs = els.map((e) => e.getBoundingClientRect());
    const l = Math.min(...rs.map((r) => r.left));
    const t = Math.min(...rs.map((r) => r.top));
    const r = Math.max(...rs.map((r) => r.right));
    const b = Math.max(...rs.map((r) => r.bottom));
    return { left: l, top: t, right: r, bottom: b, n: els.length };
  }, id);

const waitText = (page, pageNo = 1) => page.waitForSelector(`.pdf-page[data-page="${pageNo}"] .textLayer[data-ready="1"]`, { timeout: 20000 });
const waitScale = (page, scalePrefix) =>
  page.waitForFunction(
    (s) => {
      const c = document.querySelector('.pdf-page[data-page="1"] canvas');
      const l = document.querySelector('.pdf-page[data-page="1"] .textLayer');
      return c && l && Math.abs(Number(c.dataset.scale) - s) < 0.01 && Math.abs(Number(l.dataset.scale) - s) < 0.01;
    },
    scalePrefix,
    { timeout: 15000 },
  );
const getScale = (page) => page.evaluate(() => Number(document.querySelector('.pdf-page[data-page="1"]').style.getPropertyValue('--scale-factor')));
const store = (page, fn, arg) => page.evaluate(fn, arg);

async function pickCategory(page, label) {
  await page.waitForSelector('.sel-toolbar', { timeout: 5000 });
  await page.click(`.sel-toolbar .cat-btn[title^="${label}"]`);
  await page.waitForSelector('.sel-toolbar', { state: 'detached', timeout: 3000 });
}

// ───────────────────────── Passe principale (écran 1x, clair puis sombre) ─────────────────────────
let bookId;
await withApp(PORT, async (page, errors) => {
  page.on('response', (r) => r.status() >= 400 && console.log('HTTP', r.status(), r.url()));
  bookId = await importFixture(page, 'fixtures/discours.pdf', { open: true });
  await waitText(page, 1);
  await page.waitForSelector('.pdf-zoombar');
  await sleep(500);

  // 1. Rendu, ajustement à la largeur, pilule
  const geo = await page.evaluate(() => {
    const sc = document.querySelector('.pdf-scroll').getBoundingClientRect();
    const p = document.querySelector('.pdf-page[data-page="1"]').getBoundingClientRect();
    const c = document.querySelector('.pdf-page[data-page="1"] canvas');
    return { scW: sc.width, pW: p.width, pL: p.left - sc.left, n: document.querySelectorAll('.pdf-page').length, cw: c?.width, dpr: Number(c?.dataset.dpr), zoom: document.querySelector('[data-testid=pdf-zoom]').textContent, lab: document.querySelector('[data-testid=pdf-page]').textContent };
  });
  console.log('géométrie', JSON.stringify(geo));
  ok(geo.n === 2, 'deux pages créées');
  ok(near(geo.pW, geo.scW - 72, 16) || geo.pW > geo.scW * 0.6, 'page ajustée à la largeur', `page ${geo.pW}px / zone ${geo.scW}px`);
  ok(near(geo.pL * 2 + geo.pW, geo.scW, 20), 'page centrée');
  ok(geo.cw >= Math.floor(geo.pW * geo.dpr) - 1, 'canvas à la résolution physique', `canvas ${geo.cw}px, dpr ${geo.dpr}`);
  ok(/^\d+ %$/.test(geo.zoom) && /^p\. 1 \/ 2$/.test(geo.lab), 'pilule de zoom et page', `${geo.zoom} · ${geo.lab}`);

  // Sommaire (via le panneau du lecteur)
  const toc = await page.evaluate(() => [...document.querySelectorAll('.toc-item .toc-label')].map((e) => e.textContent));
  ok(toc.length >= 2, 'sommaire (signets) transmis', JSON.stringify(toc));
  if (toc.length) {
    await page.click(`.toc-item:has-text("${toc[toc.length - 1]}")`);
    await sleep(500);
    const lab = await page.textContent('[data-testid=pdf-page]');
    ok(/p\. 2/.test(lab), 'clic dans le sommaire : défile à la page', lab);
    await page.evaluate(() => (document.querySelector('.pdf-scroll').scrollTop = 0));
    await sleep(300);
  }

  // 2. Surlignage « Thèse » via sélection + barre
  const N1 = 'Le bon sens est la chose du monde la mieux partagée';
  const s1 = await selectRange(page, N1, N1, { startPage: 1 });
  ok(!!s1, 'sélection du premier passage');
  await page.click('.pdf-page[data-page="1"] .textLayer', { position: { x: 5, y: 5 }, trial: true }).catch(() => {});
  await pickCategory(page, 'Thèse');
  let hs = await store(page, () => window.__store.getState().highlights);
  ok(hs.length === 1, 'un surlignage dans le store');
  const h1 = hs[0];
  ok(h1.category === 'these' && h1.anchor.kind === 'pdf' && h1.anchor.page === 1, 'catégorie et ancrage page 1');
  ok(h1.text === N1, 'texte propre', JSON.stringify(h1.text));
  ok(h1.locationLabel === 'p. 1' && h1.printedPage === '1', 'libellé « p. 1 » et page imprimée', `${h1.locationLabel} / ${h1.printedPage}`);
  ok(h1.anchor.rects.length >= 1 && h1.anchor.rects.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001 && r.w > 0 && r.h > 0), 'rects normalisés 0..1', JSON.stringify(h1.anchor.rects));
  ok((await page.locator(`.hl.hl-these[data-hl-id="${h1.id}"]`).count()) === h1.anchor.rects.length, 'rendu .hl .hl-these avec data-hl-id');

  // 3. Note de marge pure (touche N)
  const N2 = 'puissance de bien juger et distinguer le vrai d’avec le faux';
  await selectRange(page, N2, N2, { startPage: 1 });
  await page.waitForSelector('.sel-toolbar');
  await page.click('.sel-toolbar button[title^="Note personnelle"]');
  await sleep(300);
  hs = await store(page, () => window.__store.getState().highlights);
  const h2 = hs.find((h) => h.category === null);
  ok(!!h2 && h2.text === N2, 'note de marge : category null', JSON.stringify(h2?.text));
  ok((await page.locator(`.hl.hl-note[data-hl-id="${h2.id}"]`).count()) >= 1, 'rendu .hl .hl-note');
  await page.keyboard.press('Escape');

  // 4. Texte propre sur deux lignes + clavier (6 = Exemple)
  const A = 'Car je me trouvais embarrassé';
  const B = 'profit';
  await selectRange(page, A, B, { startPage: 1, endPage: 1 });
  await page.waitForSelector('.sel-toolbar');
  await page.keyboard.press('6');
  await page.waitForSelector('.sel-toolbar', { state: 'detached' });
  hs = await store(page, () => window.__store.getState().highlights);
  const h3 = hs.find((h) => h.category === 'exemple');
  ok(!!h3 && !/\n|\s\s/.test(h3.text) && h3.text.startsWith(A) && h3.text.endsWith(B), 'sélection multiligne : espaces normalisés', JSON.stringify(h3?.text));
  ok(h3 && h3.anchor.rects.length >= 2, 'deux lignes → au moins deux rects', `${h3?.anchor.rects.length}`);

  // 5. Sélection à cheval sur deux pages : limitée à la première
  await selectRange(page, 'qu’en ceux auxquels', 'ne recevoir jamais', { startPage: 1, endPage: 2 });
  await page.waitForSelector('.sel-toolbar');
  await page.keyboard.press('5');
  await page.waitForSelector('.sel-toolbar', { state: 'detached' });
  hs = await store(page, () => window.__store.getState().highlights);
  const h4 = hs.find((h) => h.category === 'concept');
  ok(!!h4 && h4.anchor.page === 1 && !h4.text.includes('Les quatre préceptes') && h4.text.startsWith('qu’en ceux'), 'sélection multi-pages limitée à la page 1', JSON.stringify(h4?.text));

  // 6. Mouvement
  await selectRange(page, 'Seconde partie', 'Seconde partie', { startPage: 1 });
  await page.waitForSelector('.sel-toolbar');
  await page.click('.sel-toolbar button[title^="Début de mouvement"]');
  await sleep(300);
  const studies = await store(page, () => window.__store.getState().studies);
  const mv = studies[0]?.movements?.[0];
  ok(!!mv && mv.anchor.kind === 'pdf' && mv.anchor.page === 1 && mv.startText === 'Seconde partie', 'mouvement créé dans la fiche-texte', JSON.stringify(mv?.startText));
  const mk = await page.evaluate(() => {
    const b = document.querySelector('.pdf-mv');
    const p = document.querySelector('.pdf-page[data-page="1"]').getBoundingClientRect();
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { right: r.right, pLeft: p.left, top: r.top, pTop: p.top, ph: p.height, label: b.querySelector('.pdf-mv-label')?.textContent };
  });
  ok(!!mk && mk.right <= mk.pLeft + 1, 'repère de mouvement dans la marge gauche', JSON.stringify(mk));
  ok(!!mk && near((mk.top - mk.pTop) / mk.ph, mv.anchor.rects[0].y, 0.02), 'repère au niveau du premier rect');
  await page.hover('.pdf-mv');
  await sleep(250);
  await shot(page, 'shots/pdf/01-clair-annotations.png');
  await page.click('.pdf-mv');
  await sleep(200);
  const rp = await store(page, () => window.__store.getState().settings.rightPanel);
  ok(rp === 'etude', 'clic sur le repère → onMovementClick (panneau Étude)');

  // 7. Clic sur surlignage / arrière-plan
  const b1 = await hlBox(page, h1.id);
  await page.mouse.click((b1.left + b1.right) / 2, (b1.top + b1.bottom) / 2);
  await sleep(200);
  let active = await store(page, () => window.__store.getState().activeHighlightId);
  ok(active === h1.id, 'clic sur un surlignage → onHighlightClick (actif)');
  ok((await page.locator(`.hl.active[data-hl-id="${h1.id}"]`).count()) >= 1, 'classe .active sur le surlignage actif');
  const pb = await page.evaluate(() => document.querySelector('.pdf-page[data-page="1"]').getBoundingClientRect().toJSON());
  await page.mouse.click(pb.left + pb.width / 2, pb.bottom - 20);
  await sleep(200);
  active = await store(page, () => window.__store.getState().activeHighlightId);
  ok(active === null, 'clic ailleurs → onBackgroundClick');

  // 8. Zoom : le surlignage reste aligné sur le texte
  const sameBox = async (id, needle, tag) => {
    await selectRange(page, needle, needle, { startPage: 1 });
    const t = await page.evaluate(() => {
      const r = window.getSelection().getRangeAt(0);
      const rs = [...r.getClientRects()].filter((q) => q.width > 1);
      return { left: Math.min(...rs.map((q) => q.left)), top: Math.min(...rs.map((q) => q.top)), right: Math.max(...rs.map((q) => q.right)), bottom: Math.max(...rs.map((q) => q.bottom)) };
    });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.getSelection().removeAllRanges());
    const b = await hlBox(page, id);
    const tol = 2.5;
    ok(near(b.left, t.left, tol) && near(b.right, t.right, tol) && near(b.top, t.top, tol) && near(b.bottom, t.bottom, tol), `surlignage aligné sur le texte (${tag})`, `hl ${[b.left, b.top, b.right, b.bottom].map(Math.round)} / texte ${[t.left, t.top, t.right, t.bottom].map(Math.round)}`);
  };
  const s0 = await getScale(page);
  await sameBox(h1.id, N1, `zoom ${Math.round(s0 * 100)} %`);
  await page.click('.pdf-page[data-page="1"]', { position: { x: 4, y: 4 } }); // focus de l'instance
  await page.click('button[aria-label="Zoom avant"]');
  await page.click('button[aria-label="Zoom avant"]');
  const s2 = await getScale(page);
  ok(s2 > s0 * 1.2, 'le bouton + agrandit', `${s0.toFixed(2)} → ${s2.toFixed(2)}`);
  await waitScale(page, s2);
  await sameBox(h1.id, N1, `zoom ${Math.round(s2 * 100)} %`);
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  const s3 = await getScale(page);
  ok(s3 < s2 * 0.7, '⌘− (instance focalisée) réduit le zoom', `${s2.toFixed(2)} → ${s3.toFixed(2)}`);
  await waitScale(page, s3);
  await sameBox(h1.id, N1, `zoom ${Math.round(s3 * 100)} %`);
  await page.keyboard.press('Control+0');
  await sleep(300);
  const s4 = await getScale(page);
  ok(near(s4, s0, 0.02), '⌘0 revient à l’ajustement', `${s4.toFixed(2)}`);
  await waitScale(page, s4);

  // Zoom net : le canvas suit l'échelle
  const cz = await page.evaluate(() => { const c = document.querySelector('.pdf-page[data-page="1"] canvas'); const p = document.querySelector('.pdf-page[data-page="1"]').getBoundingClientRect(); return { cw: c.width, pw: p.width, dpr: Number(c.dataset.dpr) }; });
  ok(cz.cw >= Math.floor(cz.pw * cz.dpr) - 1, 'canvas re-rendu à la nouvelle échelle', JSON.stringify(cz));

  // 9. Position + onglet Carte (display:none) + reprise
  await page.evaluate(() => document.querySelector('.pdf-page[data-page="2"]').scrollIntoView());
  await sleep(1300);
  let book = await store(page, (id) => window.__store.getState().books.find((b) => b.id === id), bookId);
  ok(book.position?.kind === 'pdf' && book.position.page === 2, 'position enregistrée (page 2)', JSON.stringify(book.position));
  const top1 = await page.evaluate(() => document.querySelector('.pdf-scroll').scrollTop);
  await page.evaluate(() => (document.querySelector('.reader-lecture').style.display = 'none'));
  await sleep(300);
  await page.evaluate(() => (document.querySelector('.reader-lecture').style.display = ''));
  await sleep(900);
  const top2 = await page.evaluate(() => document.querySelector('.pdf-scroll').scrollTop);
  ok(near(top1, top2, 4) && top1 > 100, 'défilement repris après display:none', `${Math.round(top1)} → ${Math.round(top2)}`);
  book = await store(page, (id) => window.__store.getState().books.find((b) => b.id === id), bookId);
  ok(book.position?.page === 2, 'position non écrasée par le masquage');

  // 10. Recherche (insensible à la casse et aux accents)
  await page.evaluate(() => (document.querySelector('.pdf-scroll').scrollTop = 0));
  await page.keyboard.press('Control+f');
  await page.waitForSelector('.search-bar-input');
  await page.fill('.search-bar-input', 'ETUDES');
  await page.waitForSelector('.search-bar-hit', { timeout: 10000 });
  const hits = await page.evaluate(() => [...document.querySelectorAll('.search-bar-hit')].map((h) => h.textContent));
  ok(hits.length >= 1 && /études/i.test(hits.join(' ')), 'recherche « ETUDES » trouve « études »', JSON.stringify(hits.slice(0, 3)));
  await page.waitForSelector('.pdf-search-layer .search-hit.current', { timeout: 8000 });
  const hitInfo = await page.evaluate(() => {
    const m = document.querySelector('.pdf-search-layer .search-hit.current').getBoundingClientRect();
    const sc = document.querySelector('.pdf-scroll').getBoundingClientRect();
    const spans = [...document.querySelectorAll('.textLayer span')].filter((s) => /tudes/.test(s.textContent));
    const under = spans.find((s) => { const r = s.getBoundingClientRect(); return r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top; });
    return { inView: m.top >= sc.top - 2 && m.bottom <= sc.bottom + 2, under: under?.textContent ?? null };
  });
  ok(hitInfo.inView && !!hitInfo.under, 'résultat défilé en vue et marqué sur le texte', JSON.stringify(hitInfo));
  await page.fill('.search-bar-input', 'sec ond');
  await sleep(600);
  ok((await page.locator('.search-bar-hit').count()) === 0, 'requête sans résultat');
  await page.fill('.search-bar-input', 'raison');
  await page.waitForSelector('.search-bar-hit', { timeout: 10000 });
  await shot(page, 'shots/pdf/02-clair-recherche.png');
  await page.click('.search-bar button[title^="Fermer"]');
  await sleep(300);
  ok((await page.locator('.pdf-search-layer .search-hit').count()) === 0, 'clearSearch retire la marque');

  // 11. Thème sombre
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
  await sleep(500);
  await page.evaluate(() => (document.querySelector('.pdf-scroll').scrollTop = 0));
  await sleep(400);
  const filt = await page.evaluate(() => getComputedStyle(document.querySelector('.pdf-page[data-page="1"] canvas')).filter);
  ok(/invert/.test(filt) && /hue-rotate/.test(filt), 'thème sombre : invert + hue-rotate sur le canvas', filt);
  await shot(page, 'shots/pdf/03-sombre.png');
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));
  await sleep(300);

  // 12. Persistance après rechargement
  await page.evaluate(() => document.querySelector('.pdf-page[data-page="2"]').scrollIntoView());
  await sleep(2200);
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
  const persisted = await store(page, () => ({ h: window.__store.getState().highlights.length, m: window.__store.getState().studies.flatMap((s) => s.movements).length }));
  ok(persisted.h === 4 && persisted.m === 1, 'surlignages et mouvement persistés après rechargement', JSON.stringify(persisted));
  await page.evaluate((id) => window.__store.getState().openBook(id), bookId);
  await page.waitForSelector('.textLayer[data-ready="1"]', { timeout: 20000 });
  await sleep(1500);
  ok((await page.locator('.hl[data-hl-id]').count()) >= 4, 'surlignages re-rendus après rechargement');
  const afterReload = await page.evaluate(() => ({ lab: document.querySelector('[data-testid=pdf-page]').textContent, top: document.querySelector('.pdf-scroll').scrollTop }));
  ok(/p\. 2/.test(afterReload.lab) && afterReload.top > 100, 'position restaurée après rechargement', JSON.stringify(afterReload));
  await page.evaluate(() => (document.querySelector('.pdf-scroll').scrollTop = 0));
  await sleep(400);
  await shot(page, 'shots/pdf/04-clair-recharge.png');

  // 13. Vue côte à côte
  await page.evaluate((id) => window.__store.getState().openBook(id, id), bookId);
  await page.waitForFunction(() => document.querySelectorAll('.pdf-reader').length === 2 && document.querySelectorAll('.pdf-zoombar').length === 2, null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.textLayer[data-ready="1"]').length >= 2, null, { timeout: 20000 });
  await sleep(1200);
  await shot(page, 'shots/pdf/05-cote-a-cote.png');
  // Les raccourcis ne touchent que l'instance focalisée.
  const zooms = () => page.evaluate(() => [...document.querySelectorAll('[data-testid=pdf-zoom]')].map((e) => e.textContent));
  const z0 = await zooms();
  await page.click('.reader-page[data-pane="b"] .pdf-page[data-page="1"]', { position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+=');
  await sleep(300);
  const z1 = await zooms();
  ok(z1[0] === z0[0] && z1[1] !== z0[1], '⌘+ : seule l’instance focalisée (volet B) change', `${z0} → ${z1}`);
  await page.click('.reader-page[data-pane="a"] .pdf-page[data-page="1"]', { position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+-');
  await sleep(300);
  const z2 = await zooms();
  ok(z2[0] !== z1[0] && z2[1] === z1[1], '⌘− : seule l’instance focalisée (volet A) change', `${z1} → ${z2}`);
  const two = await page.evaluate(() => [...document.querySelectorAll('.pdf-reader')].map((r) => r.querySelectorAll('.hl').length));
  ok(two.every((n) => n >= 4), 'surlignages dans les deux volets', JSON.stringify(two));
  await sleep(300);
  await shot(page, 'shots/pdf/06-cote-a-cote-zoom.png');

  // Erreurs navigateur
  const real = errors.filter((e) => !/favicon|Failed to load resource.*404/.test(e));
  ok(real.length === 0, 'aucune erreur navigateur', real.slice(0, 3).join(' | '));
});

// ───────────────────────── Passe écran Retina (dpr 2) : netteté ─────────────────────────
{
  const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const page = await ctx.newPage();
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
    await importFixture(page, 'fixtures/discours.pdf', { open: true });
    await waitText(page, 1);
    await sleep(800);
    const r = await page.evaluate(() => { const c = document.querySelector('.pdf-page[data-page="1"] canvas'); const p = document.querySelector('.pdf-page[data-page="1"]').getBoundingClientRect(); return { cw: c.width, pw: p.width, dpr: Number(c.dataset.dpr) }; });
    ok(r.dpr === 2 && r.cw >= Math.floor(r.pw * 2) - 1, 'écran Retina : canvas en résolution 2x', JSON.stringify(r));
    await shot(page, 'shots/pdf/07-retina.png');
  } finally {
    await browser.close();
    await server.close();
  }
}

console.log(failed ? `\n${failed} ÉCHEC(S)` : '\nTOUS LES TESTS PASSENT');
process.exit(failed ? 1 : 0);
