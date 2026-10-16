// Panneau « Mise en page et affichage » du lecteur (bouton « Aa », TypographyPopover) :
// - ouverture / fermeture (bouton, clic extérieur, Échap), tient dans une fenêtre de 900 px (défilement interne) ;
// - chaque réglage change le réglage et la racine du lecteur : data-layout (scroll | sheets | paged),
//   data-spread, .book-layout, .paper-look, classe pg-* (repères), thème, police, taille… ;
// - persistance après rechargement (réglages, racine, sections repliées) ;
// - clavier : Entrée ouvre, focus sur la présentation choisie, flèches dans les choix, Tab, Échap rend le focus ;
// - captures shots/panneau/ : clair, sombre, sépia, « Page par page » et ses choix.
// Lancer : timeout 300 node scripts/test-reader-panel.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5413;
// Les captures vont dans le dépôt principal (même depuis un worktree).
const SHOTS = process.env.SHOTS_DIR ?? path.resolve(ROOT.replace(/\/\.claude\/worktrees\/[^/]+$/, ''), 'shots/panneau');

let failures = 0;
let passes = 0;
const check = (cond, label, extra) => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${label}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
};

const WORDS =
  'la raison le jugement la volonté une idée claire et distincte le doute méthodique conduit l’esprit vers la vérité ' +
  'car il faut une fois en sa vie se défaire de toutes les opinions reçues et recommencer tout de nouveau dès les fondements';
const W = WORDS.split(' ');
function para(lead, n, seed) {
  let out = lead;
  let i = seed * 7;
  while (out.length < n) out += ' ' + W[i++ % W.length];
  return out + '.';
}
const xhtml = (title, body) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="fr"><head><title>${title}</title></head><body>${body}</body></html>`;

async function epub() {
  const files = {};
  for (let c = 1; c <= 2; c++) {
    let body = `<h1>Méditation ${c === 1 ? 'première' : 'seconde'}</h1>`;
    for (let k = 0; k < 14; k++) body += `<p>${para(`Paragraphe ${k + 1} :`, 700 + ((k * 397 + c * 131) % 700), c * 31 + k)}</p>`;
    files[`m${c}.xhtml`] = xhtml(`Méditation ${c}`, body);
  }
  const nav = xhtml('Sommaire', `<nav epub:type="toc"><ol><li><a href="m1.xhtml">Méditation première</a></li><li><a href="m2.xhtml">Méditation seconde</a></li></ol></nav>`);
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const names = Object.keys(files);
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:test:panneau</dc:identifier><dc:title>Méditations métaphysiques</dc:title><dc:creator>René Descartes</dc:creator><dc:language>fr</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${names.map((n, i) => `<item id="c${i}" href="${n}" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${names.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`,
  );
  zip.file('OEBPS/nav.xhtml', nav);
  for (const [n, src] of Object.entries(files)) zip.file('OEBPS/' + n, src);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
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
  await page.waitForFunction(
    () => {
      const p = document.querySelector('.reader-page[data-pane="a"]');
      return !!p && !!p.querySelector('.html-chapter-text') && !p.querySelector('.reader-loading') && !!p.querySelector('[data-testid=page-indicator]');
    },
    null,
    { timeout: 25000 },
  );
  await page.waitForTimeout(400);
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(2, 300);
  await page.evaluate(() => {
    const s = window.__store.getState();
    (s.toasts ?? []).forEach((t) => s.dismissToast?.(t.id));
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, name) });
  console.log('capture:', path.join(SHOTS, name));
}

/** État de la racine du lecteur et des réglages. */
const rootState = (page) =>
  page.evaluate(() => {
    const r = document.querySelector('.reader-page[data-pane="a"] .html-reader');
    const doc = r?.querySelector('.html-doc');
    const s = window.__store.getState().settings;
    return {
      layout: r?.dataset.layout,
      spread: r?.dataset.spread,
      book: r?.classList.contains('book-layout'),
      paper: r?.classList.contains('paper-look'),
      pg: doc ? [...doc.classList].find((c) => /^pg-/.test(c)) : null,
      theme: document.documentElement.dataset.theme,
      s: { readerLayout: s.readerLayout, pagedSpread: s.pagedSpread, bookLayout: s.bookLayout, paperLook: s.paperLook, pageMarks: s.pageMarks, fontFamily: s.fontFamily, fontSize: s.fontSize, theme: s.theme },
    };
  });

const panelOpen = (page) => page.evaluate(() => !!document.querySelector('[data-testid=reader-panel]'));
const active = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a ? { testid: a.dataset.testid, layout: a.dataset.layout, spread: a.dataset.spread, role: a.getAttribute('role'), text: a.textContent?.trim().slice(0, 40), inPanel: !!a.closest('[data-testid=reader-panel]') } : null;
  });

const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-' + PORT, server: { port: PORT, strictPort: true }, logLevel: 'error' });
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
  await page.evaluate(() => window.__store.getState().updateSettings({ showToc: true, showExtracts: true, theme: 'light' }));
  const bookId = await importBuffer(page, 'meditations.epub', await epub());
  await waitHtml(page);

  console.log('\n== Défauts ==');
  let st = await rootState(page);
  check(st.layout === 'scroll' && st.spread === 'auto' && !st.book && !st.paper && st.pg === 'pg-numbered', 'racine par défaut : data-layout=scroll, data-spread=auto, sans .book-layout ni .paper-look, trait et numéro', st);
  const textsBefore = await page.evaluate(() => [...document.querySelectorAll('.html-chapter-text')].map((r) => r.textContent));

  console.log('\n== Ouverture / fermeture ==');
  const btn = page.locator('[data-testid=reader-display-btn]');
  check((await btn.getAttribute('title')) === 'Mise en page et affichage' && (await btn.getAttribute('aria-expanded')) === 'false', 'bouton « Mise en page et affichage » (fermé)');
  check((await page.locator('.reader-topbar .icon-btn[title="Affichage"]').count()) === 0, 'plus de bouton « Affichage » séparé');
  await btn.click();
  await page.waitForSelector('[data-testid=reader-panel]');
  await page.waitForTimeout(250);
  check((await btn.getAttribute('aria-expanded')) === 'true', 'bouton : aria-expanded=true');
  const sections = await page.evaluate(() => [...document.querySelectorAll('.rp-section-title')].map((e) => e.textContent));
  check(JSON.stringify(sections) === JSON.stringify(['Présentation', 'Typographie', 'Livre', 'Numéros de page', 'Thème']), 'sections : Présentation, Typographie, Livre, Numéros de page, Thème', sections);
  const geo = await page.evaluate(() => {
    const p = document.querySelector('[data-testid=reader-panel]').getBoundingClientRect();
    const b = document.querySelector('.rp-body');
    return { top: p.top, bottom: p.bottom, right: p.right, vh: innerHeight, vw: innerWidth, scrollH: b.scrollHeight, clientH: b.clientHeight, overflow: getComputedStyle(b).overflowY };
  });
  check(geo.bottom <= geo.vh - 4 && geo.top >= 0 && geo.right <= geo.vw, 'le panneau tient dans la fenêtre de 900 px', geo);
  check(geo.overflow === 'auto', 'défilement interne du panneau', geo);
  await shot(page, '01-panneau-clair.png');
  await page.mouse.click(500, 500);
  await page.waitForTimeout(150);
  check(!(await panelOpen(page)), 'clic extérieur : fermé');
  await btn.click();
  await page.waitForSelector('[data-testid=reader-panel]');
  await btn.click();
  await page.waitForTimeout(150);
  check(!(await panelOpen(page)), 'second clic sur le bouton : fermé');
  await btn.click();
  await page.waitForSelector('[data-testid=reader-panel]');
  await page.locator('.rp-close').click();
  await page.waitForTimeout(150);
  check(!(await panelOpen(page)), 'bouton × : fermé');

  console.log('\n== Présentation ==');
  await btn.click();
  await page.waitForSelector('[data-testid=reader-panel]');
  await page.click('[data-testid=layout-choice] [data-layout=sheets]');
  await page.waitForTimeout(300);
  st = await rootState(page);
  check(st.layout === 'sheets' && st.s.readerLayout === 'sheets' && st.pg === 'pg-paper', '« Feuilles » : data-layout=sheets, rendu pages façon papier', st);
  check(await page.evaluate(() => document.querySelector('.html-col') && getComputedStyle(document.querySelector('.html-col')).backgroundColor !== 'rgba(0, 0, 0, 0)'), '« Feuilles » : la colonne devient une feuille');
  check(!(await page.$('[data-testid=spread-choice]')), 'pas de choix « Une / Deux pages » hors « Page par page »');
  await page.click('[data-testid=layout-choice] [data-layout=paged]');
  await page.waitForTimeout(300);
  st = await rootState(page);
  check(st.layout === 'paged' && st.s.readerLayout === 'paged', '« Page par page » : data-layout=paged', st);
  const spreads = await page.evaluate(() => [...document.querySelectorAll('[data-testid=spread-choice] [role=radio]')].map((b) => `${b.textContent}${b.getAttribute('aria-checked') === 'true' ? '*' : ''}`));
  check(JSON.stringify(spreads) === JSON.stringify(['Une page', 'Deux pages', 'Automatique*']), 'sous-choix : Une page, Deux pages, Automatique (choisi)', spreads);
  for (const sp of ['single', 'double', 'auto']) {
    await page.click(`[data-testid=spread-choice] [data-spread=${sp}]`);
    await page.waitForTimeout(150);
    st = await rootState(page);
    check(st.spread === sp && st.s.pagedSpread === sp, `pages à l’écran « ${sp} » : data-spread=${sp}`, st);
  }
  await page.click('[data-testid=spread-choice] [data-spread=double]');
  await page.waitForTimeout(200);
  await page.evaluate(() => (document.querySelector('.rp-body').scrollTop = 0));
  await shot(page, '04-page-par-page-choix.png');
  await page.click('[data-testid=spread-choice] [data-spread=auto]');
  await page.click('[data-testid=layout-choice] [data-layout=scroll]');
  await page.waitForTimeout(300);
  st = await rootState(page);
  check(st.layout === 'scroll' && st.pg === 'pg-numbered' && !(await page.$('[data-testid=spread-choice]')), '« Défilement continu » : data-layout=scroll, trait et numéro', st);

  console.log('\n== Livre ==');
  await page.click('[data-testid=book-layout-switch]');
  await page.waitForTimeout(150);
  st = await rootState(page);
  check(st.book && st.s.bookLayout === true && (await page.getAttribute('[data-testid=book-layout-switch]', 'aria-checked')) === 'true', '« Mise en page livre » : .book-layout', st);
  await page.click('[data-testid=paper-look-switch]');
  await page.waitForTimeout(150);
  st = await rootState(page);
  check(st.paper && st.s.paperLook === true, '« Aspect papier » : .paper-look', st);
  await page.click('[data-testid=book-layout-switch]');
  await page.waitForTimeout(150);
  st = await rootState(page);
  check(!st.book && st.paper, '« Mise en page livre » désactivée : classe retirée, papier gardé', st);

  console.log('\n== Numéros de page ==');
  const modes = await page.evaluate(() => [...document.querySelectorAll('[data-testid=page-marks-mode] [role=radio]')].map((b) => `${b.textContent}${b.getAttribute('aria-checked') === 'true' ? '*' : ''}`));
  check(JSON.stringify(modes) === JSON.stringify(['Trait et numéro*', 'Numéro seul']), 'styles : Trait et numéro (choisi), Numéro seul', modes);
  await page.click('.typo-choice[data-mode=number]');
  await page.waitForTimeout(200);
  st = await rootState(page);
  const markStyle = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.pg-mark')].find((e) => !/pg-start|pg-chap/.test(e.className));
    const b = getComputedStyle(m, '::before');
    const a = getComputedStyle(m, '::after');
    return { rule: b.display !== 'none', num: a.display !== 'none' ? a.content : null };
  });
  check(st.pg === 'pg-number' && st.s.pageMarks === 'number' && !markStyle.rule && markStyle.num, '« Numéro seul » : pg-number, numéro sans trait', { st, markStyle });
  await page.click('[data-testid=page-marks-switch]');
  await page.waitForTimeout(200);
  st = await rootState(page);
  check(st.pg === 'pg-off' && st.s.pageMarks === 'off' && !(await page.$('[data-testid=page-marks-mode]')), 'numéros masqués : pg-off, styles cachés', st);
  await page.click('[data-testid=page-marks-switch]');
  await page.waitForTimeout(200);
  st = await rootState(page);
  check(st.pg === 'pg-numbered', 'numéros réaffichés : trait et numéro', st);

  console.log('\n== Typographie et thème ==');
  await page.click('.typo-pop button:text-is("Sans")');
  await page.focus('#typo-size');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  st = await rootState(page);
  check(st.s.fontFamily === 'sans' && st.s.fontSize === 20, 'police Sans, taille +1 au clavier', st.s);
  check(await page.evaluate(() => document.querySelector('.html-doc').style.getPropertyValue('--html-fs') === '20px'), 'taille appliquée au texte');
  await page.click('.typo-pop button:text-is("Serif")');
  await page.focus('#typo-size');
  await page.keyboard.press('ArrowLeft');
  await page.click('.typo-pop [data-theme-id="dark"]');
  await page.waitForTimeout(250);
  st = await rootState(page);
  check(st.theme === 'dark' && st.s.theme === 'dark', 'thème sombre appliqué', st);
  // Captures sombre et sépia, avec « Livre » et « Page par page » visibles.
  await page.click('[data-testid=layout-choice] [data-layout=paged]');
  await page.waitForTimeout(250);
  await page.evaluate(() => (document.querySelector('.rp-body').scrollTop = 0));
  await shot(page, '02-panneau-sombre.png');
  await page.click('.typo-pop [data-theme-id="sepia"]');
  await page.waitForTimeout(250);
  await page.evaluate(() => (document.querySelector('.rp-body').scrollTop = 0));
  await shot(page, '03-panneau-sepia.png');
  check((await rootState(page)).theme === 'sepia', 'thème sépia appliqué');
  await page.click('.typo-pop [data-theme-id="light"]');
  await page.click('[data-testid=layout-choice] [data-layout=scroll]');
  await page.waitForTimeout(200);
  // Panneau défilé tout en bas : les derniers réglages restent atteignables.
  const bottom = await page.evaluate(() => {
    const b = document.querySelector('.rp-body');
    b.scrollTop = b.scrollHeight;
    const t = document.querySelector('[data-section=theme]').getBoundingClientRect();
    return t.bottom <= b.getBoundingClientRect().bottom + 1;
  });
  check(bottom, 'défilement interne : la section Thème est atteignable');
  await shot(page, '05-panneau-bas.png');

  console.log('\n== Sections repliables ==');
  await page.evaluate(() => (document.querySelector('.rp-body').scrollTop = 0));
  await page.click('[data-section=typo] .rp-section-btn');
  await page.waitForTimeout(100);
  check(!(await page.$('#typo-size')) && (await page.getAttribute('[data-section=typo] .rp-section-btn', 'aria-expanded')) === 'false', 'Typographie repliée (aria-expanded=false)');
  check((await page.textContent('[data-section=typo] .rp-section-summary')) === 'Serif · 19 px', 'section repliée : résumé « Serif · 19 px »', await page.textContent('[data-section=typo] .rp-section-summary'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check(!(await panelOpen(page)), 'Échap ferme le panneau');
  await btn.click();
  await page.waitForSelector('[data-testid=reader-panel]');
  check(!(await page.$('#typo-size')), 'réouverture : Typographie toujours repliée (mémorisé)');

  console.log('\n== Clavier ==');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await btn.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid=reader-panel]');
  await page.waitForTimeout(200);
  let a = await active(page);
  check(a?.inPanel && a.role === 'radio' && a.layout === 'scroll', 'Entrée ouvre ; focus sur la présentation choisie', a);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  a = await active(page);
  st = await rootState(page);
  check(a?.layout === 'sheets' && st.layout === 'sheets', 'flèche droite : « Feuilles » choisi et focalisé', { a, layout: st.layout });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  st = await rootState(page);
  check(st.layout === 'paged', 'flèche droite : « Page par page »', st.layout);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  st = await rootState(page);
  check(st.layout === 'scroll', 'flèche droite en bout : retour au « Défilement continu »', st.layout);
  await page.keyboard.press('End');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab');
  a = await active(page);
  check(a?.role === 'radio' && a.spread === 'auto', 'Tab : passe au choix « Pages à l’écran » (un seul arrêt par groupe)', a);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(150);
  st = await rootState(page);
  check(st.spread === 'double', 'flèche gauche dans « Pages à l’écran » : Deux pages', st.spread);
  await page.keyboard.press('Tab');
  a = await active(page);
  check(a?.inPanel && /Typographie/.test(a.text ?? ''), 'Tab : en-tête de section suivant (Typographie)', a);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  check(!!(await page.$('#typo-size')), 'Entrée sur l’en-tête : Typographie dépliée');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  check(!(await page.$('#typo-size')), 'Entrée à nouveau : Typographie repliée');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  a = await active(page);
  check(!(await panelOpen(page)) && a?.testid === 'reader-display-btn', 'Échap : fermé, focus rendu au bouton', a);

  console.log('\n== Persistance ==');
  await page.evaluate(() => window.__store.getState().updateSettings({ readerLayout: 'paged', pagedSpread: 'single', bookLayout: true, paperLook: true, pageMarks: 'number' }));
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
  await page.evaluate((id) => window.__store.getState().openBook(id), bookId);
  await waitHtml(page);
  st = await rootState(page);
  check(
    st.layout === 'paged' && st.spread === 'single' && st.book && st.paper && st.pg === 'pg-number',
    'après rechargement : data-layout=paged, data-spread=single, .book-layout, .paper-look, numéro seul',
    st,
  );
  await page.click('[data-testid=reader-display-btn]');
  await page.waitForSelector('[data-testid=reader-panel]');
  check(
    (await page.getAttribute('[data-testid=layout-choice] [data-layout=paged]', 'aria-checked')) === 'true' &&
      (await page.getAttribute('[data-testid=spread-choice] [data-spread=single]', 'aria-checked')) === 'true' &&
      (await page.getAttribute('[data-testid=book-layout-switch]', 'aria-checked')) === 'true' &&
      !(await page.$('#typo-size')),
    'après rechargement : le panneau reflète les réglages (et Typographie reste repliée)',
  );
  await page.click('[data-section=typo] .rp-section-btn');
  await page.keyboard.press('Escape');

  console.log('\n== Ancien réglage « pages façon papier » ==');
  await page.evaluate(() => window.__store.getState().updateSettings({ readerLayout: undefined, pageMarks: 'paper', bookLayout: false, paperLook: false }));
  await page.waitForTimeout(300);
  st = await rootState(page);
  // Décision d'intégration (« je préfère quand tout était à la suite ») : l'ancien « pages façon papier »
  // se lit défilement continu + trait et numéro tant qu'aucune présentation n'est choisie.
  check(st.layout === 'scroll' && st.pg === 'pg-numbered', 'pageMarks « paper » sans présentation choisie : défilement continu, trait et numéro', st);
  await page.click('[data-testid=reader-display-btn]');
  await page.waitForSelector('[data-testid=reader-panel]');
  check(
    (await page.getAttribute('[data-testid=layout-choice] [data-layout=scroll]', 'aria-checked')) === 'true' &&
      (await page.getAttribute('[data-testid=page-marks-switch]', 'aria-checked')) === 'true' &&
      (await page.getAttribute('.typo-choice[data-mode=numbered]', 'aria-checked')) === 'true',
    'pageMarks « paper » : le panneau montre « Défilement continu » et « Trait et numéro »',
  );
  await page.click('[data-testid=page-marks-switch]');
  await page.waitForTimeout(200);
  st = await rootState(page);
  check(st.layout === 'scroll' && st.pg === 'pg-off' && st.s.pageMarks === 'off', 'changer les numéros : toujours en défilement continu', st);
  await page.keyboard.press('Escape');

  const textsAfter = await page.evaluate(() => [...document.querySelectorAll('.html-chapter-text')].map((r) => r.textContent));
  check(JSON.stringify(textsAfter) === JSON.stringify(textsBefore), 'textContent des chapitres inchangé (ancrages des surlignages)');
} finally {
  if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + errors.slice(0, 12).join('\n'));
  check(!errors.some((e) => /TypographyPopover|HtmlReader|display|pageerror/.test(e)), 'aucune erreur navigateur', errors.slice(0, 3));
  await browser.close();
  await server.close();
}
console.log(`\n${passes} OK, ${failures} échec(s)`);
process.exit(failures ? 1 : 0);
