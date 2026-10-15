// Parcours complet de l'application — port 5410. Échoue sur toute erreur console / pageerror / réponse ≥ 400.
// Lancer : timeout 600 node scripts/test-tour.mjs        Captures : shots/tour/
// Accueil (base vide) → import de chaque fixture → bibliothèque → lecteurs EPUB / PDF / HTML / image
// (surlignage, signet, panneau latéral) → carte d'argument (rangements, zones, export, versions) →
// extraits, concepts, arguments, plans, révision → écrits (éditeur, panneau latéral Livre / Extraits,
// commentaire, versions, export) → espaces (carte libre) → historique, corbeille, aide → thèmes
// clair / sombre / sépia → barre latérale repliée → mode Windows simulé (?platform=win).
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/tour');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5410;

let failed = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${name}${detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => page.screenshot({ path: path.join(OUT, name) });
const S = (page, fn, arg) => page.evaluate(fn, arg);
const nav = (page, route) => S(page, (r) => window.__store.getState().navigate(r), route);

const server = await createServer({
  root: ROOT,
  cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`),
  server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

let step = 'démarrage';
const errors = [];
function watch(page) {
  page.on('pageerror', (e) => errors.push(`[${step}] pageerror: ${e.message} ${(e.stack || '').split('\n').slice(1, 3).join(' ')}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${step}] console: ${m.text().slice(0, 400)}`));
  page.on('response', (r) => r.status() >= 400 && errors.push(`[${step}] HTTP ${r.status()} : ${r.url()}`));
  page.on('requestfailed', (r) => {
    const u = r.url();
    // Annulations normales (navigation, blob révoqué après usage).
    if (/ERR_ABORTED/.test(r.failure()?.errorText ?? '') || u.startsWith('blob:') || u.startsWith('data:')) return;
    errors.push(`[${step}] requête échouée : ${u} ${r.failure()?.errorText}`);
  });
}
const begin = (name) => {
  step = name;
  console.log('—', name);
};
/** Clique si l'élément existe et est visible ; renvoie vrai si cliqué. */
async function tap(page, sel, opts = {}) {
  const loc = page.locator(sel).first();
  if (!(await loc.count()) || !(await loc.isVisible().catch(() => false))) return false;
  if (await loc.isDisabled().catch(() => false)) return false;
  await loc.click({ timeout: 4000, ...opts }).catch((e) => console.log('   (clic impossible', sel, e.message.split('\n')[0], ')'));
  await sleep(opts.wait ?? 350);
  return true;
}
async function esc(page, n = 1) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Escape');
    await sleep(150);
  }
}
async function importFile(page, file, opts = {}) {
  const b64 = fs.readFileSync(path.join(ROOT, file)).toString('base64');
  return page.evaluate(
    async ({ name, b64, opts }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const out = await window.__store.getState().importFiles([{ name, data: bin.buffer }], opts);
      return out.map((b) => b.id);
    },
    { name: path.basename(file), b64, opts },
  );
}
async function selectIn(page, rootSel, minLen = 30) {
  return page.evaluate(
    ({ rootSel, minLen }) => {
      const root = document.querySelector(rootSel);
      if (!root) return null;
      const sc = root.closest('.html-scroll, .pdf-scroll') || document.scrollingElement;
      const vis = sc.getBoundingClientRect();
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (n.data.trim().length < minLen) continue;
        const r0 = n.parentElement.getBoundingClientRect();
        if (r0.top < vis.top + 40 || r0.bottom > vis.bottom - 40 || r0.width < 50) continue;
        const r = document.createRange();
        const i = n.data.search(/\S/);
        r.setStart(n, i);
        r.setEnd(n, Math.min(n.data.length, i + minLen));
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        document.dispatchEvent(new Event('selectionchange'));
        const b = r.getBoundingClientRect();
        return { x: b.left, y: b.top + b.height / 2, w: b.width, text: r.toString() };
      }
      return null;
    },
    { rootSel, minLen },
  );
}
/** Vraie sélection à la souris sur le passage choisi par selectIn. */
async function mouseSelect(page, rootSel) {
  const box = await selectIn(page, rootSel);
  if (!box) return null;
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.mouse.move(box.x + 1, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w - 1, box.y, { steps: 8 });
  await page.mouse.up();
  await sleep(400);
  return box;
}

async function tour(page, { platform = '' } = {}) {
  await page.goto(`http://localhost:${PORT}/${platform ? '?platform=' + platform : ''}`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await sleep(800);

  // ── Base vide ──
  for (const r of ['home', 'library', 'extracts', 'revision', 'trash', 'history', 'help']) {
    begin('base vide : ' + r);
    await nav(page, { name: r });
    await sleep(500);
  }
  for (const r of [{ name: 'concepts', conceptId: null }, { name: 'arguments', argumentId: null }, { name: 'plans', planId: null }, { name: 'write', draftId: null }]) {
    begin('base vide : ' + r.name);
    await nav(page, r);
    await sleep(600);
  }
  await shot(page, `${platform || 'mac'}-01-vide.png`);

  // ── Imports ──
  begin('import des fixtures');
  const ids = {};
  for (const f of ['discours.epub', 'discours.pdf', 'discours.html', 'premiere-partie.txt', 'discours.md', 'discours.docx', 'cover.png']) {
    ids[f] = (await importFile(page, 'fixtures/' + f, { asBook: true }))[0];
    check(`import ${f}`, !!ids[f]);
  }
  // .md / .docx importés comme écrits.
  const mdDraft = await importFile(page, 'fixtures/discours-notes.md');
  const docxDraft = await importFile(page, 'fixtures/discours.docx');
  await sleep(600);
  const drafts = await S(page, () => window.__store.getState().drafts.map((d) => d.id));
  check('import .md / .docx comme écrits', drafts.length >= 2, { drafts: drafts.length, mdDraft, docxDraft });

  // ── Accueil, bibliothèque ──
  begin('accueil rempli');
  await nav(page, { name: 'home' });
  await sleep(800);
  begin('bibliothèque');
  await nav(page, { name: 'library' });
  await sleep(800);
  await shot(page, `${platform || 'mac'}-02-bibliotheque.png`);
  await tap(page, '.lib-card >> nth=0', { button: 'right' });
  await esc(page);

  // ── Lecteur EPUB ──
  begin('lecteur EPUB');
  await S(page, (id) => window.__store.getState().openBook(id), ids['discours.epub']);
  await page.waitForSelector('.html-doc.is-revealed', { timeout: 30000 });
  await sleep(1200);
  await page.evaluate(() => (document.querySelector('.html-scroll').scrollTop = 1400));
  await sleep(500);
  const before = await S(page, () => window.__store.getState().highlights.length);
  begin('surlignage EPUB');
  const sel = await mouseSelect(page, '.html-doc');
  check('sélection EPUB', !!sel, sel?.text);
  await page.keyboard.press('2');
  await sleep(500);
  const after = await S(page, () => window.__store.getState().highlights.length);
  check('surlignage EPUB créé', after === before + 1, { before, after });
  // Deux extraits de plus (autres catégories), pour une carte d'argument non vide.
  for (const [top, key] of [[3200, '1'], [5200, '4']]) {
    await page.evaluate((t) => (document.querySelector('.html-scroll').scrollTop = t), top);
    await sleep(600);
    if (await mouseSelect(page, '.html-doc')) await page.keyboard.press(key);
    await sleep(400);
  }
  begin('signet EPUB');
  await page.keyboard.press('ControlOrMeta+KeyD');
  await sleep(500);
  await esc(page);
  begin('panneau latéral du lecteur');
  for (const t of ['Signets', 'Extraits']) await tap(page, `.reader-side-switch button:has-text("${t}")`);
  begin('clic sur un surlignage');
  await tap(page, '.html-doc mark, .html-doc .hl', { wait: 500 });
  await esc(page, 2);
  begin('recherche dans le livre');
  await page.keyboard.press('ControlOrMeta+KeyF');
  await sleep(300);
  await page.keyboard.type('raison');
  await page.keyboard.press('Enter');
  await sleep(500);
  await esc(page, 2);
  await shot(page, `${platform || 'mac'}-03-epub.png`);

  // ── Carte d'argument ──
  begin('carte d’argument');
  const hlIds = await S(page, (bid) => window.__store.getState().highlights.filter((h) => h.bookId === bid).map((h) => h.id), ids['discours.epub']);
  for (const id of await S(page, (bid) => window.__store.getState().highlights.filter((h) => h.bookId === bid).map((h) => h.id), ids['discours.epub']))
    await S(page, (id) => window.__store.getState().addHighlightToMap(id), id);
  check('extraits EPUB', hlIds.length >= 1);
  await nav(page, { name: 'reader', bookId: ids['discours.epub'], tab: 'carte', splitBookId: null });
  await page.waitForSelector('[data-testid="map-root"]', { timeout: 20000 });
  await sleep(1200);
  begin('carte : ranger');
  if (await tap(page, '[data-act="organise"]')) {
    const layouts = await page.locator('[data-layout]').evaluateAll((els) => els.map((e) => e.getAttribute('data-layout')));
    await esc(page);
    for (const l of layouts) {
      begin('carte : ranger ' + l);
      await tap(page, '[data-act="organise"]');
      await tap(page, `[data-layout="${l}"]`, { wait: 900 });
    }
  }
  begin('carte : idée');
  await tap(page, '[data-act="idea"]', { wait: 500 });
  await esc(page, 2);
  begin('carte : export');
  if (await tap(page, '[data-act="export"]')) {
    const kinds = await page.locator('[data-export]').evaluateAll((els) => els.map((e) => e.getAttribute('data-export')));
    await esc(page);
    for (const k of kinds.filter((k) => k !== 'draft')) {
      begin('carte : export ' + k);
      await tap(page, '[data-act="export"]');
      const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
      await tap(page, `[data-export="${k}"]`, { wait: 300 });
      await dl;
      await sleep(400);
    }
  }
  begin('carte : menus');
  for (const act of ['zones', 'gaps', 'versions', 'present', 'more', 'fit']) {
    if (await tap(page, `[data-act="${act}"]`, { wait: 600 })) await esc(page, 2);
  }
  await tap(page, '[data-testid="present"]', { wait: 800 });
  await esc(page, 2);
  await tap(page, '[data-testid="map-drawer-open"]', { wait: 500 });
  await esc(page, 2);
  await shot(page, `${platform || 'mac'}-04-carte.png`);

  // ── Lecteur PDF ──
  begin('lecteur PDF');
  await S(page, (id) => window.__store.getState().openBook(id), ids['discours.pdf']);
  await page.waitForSelector('.pdf-page[data-page="1"] .textLayer[data-ready="1"]', { timeout: 30000 });
  await sleep(1200);
  begin('surlignage PDF');
  const psel = await mouseSelect(page, '.pdf-page[data-page="1"] .textLayer');
  check('sélection PDF', !!psel, psel?.text);
  await page.keyboard.press('3');
  await sleep(500);
  begin('signet PDF');
  await page.keyboard.press('ControlOrMeta+KeyD');
  await sleep(400);
  await esc(page);
  await tap(page, '[data-testid="pdf-zoom"] button >> nth=0');
  await shot(page, `${platform || 'mac'}-05-pdf.png`);

  // ── Côte à côte ──
  begin('lecture côte à côte');
  await S(page, ([a, b]) => window.__store.getState().openBook(a, b), [ids['discours.epub'], ids['discours.pdf']]);
  await sleep(2500);

  // ── HTML, texte, image ──
  for (const f of ['discours.html', 'premiere-partie.txt', 'discours.md', 'discours.docx']) {
    begin('lecteur ' + f);
    await S(page, (id) => window.__store.getState().openBook(id), ids[f]);
    await page.waitForSelector('.html-doc.is-revealed', { timeout: 30000 }).catch(() => errors.push(`[${step}] lecteur non affiché`));
    await sleep(800);
  }
  begin('lecteur image');
  await S(page, (id) => window.__store.getState().openBook(id), ids['cover.png']);
  await sleep(2500);
  await tap(page, '[data-testid="img-zoom"] button >> nth=0');
  await tap(page, '[data-testid="img-text-toggle"]', { wait: 800 });
  await shot(page, `${platform || 'mac'}-06-image.png`);

  // ── Extraits, concepts, arguments, plans, révision ──
  begin('tous les extraits');
  await nav(page, { name: 'extracts' });
  await sleep(800);
  await tap(page, '.ax-row, .ax-item, [data-hl] >> nth=0');
  await esc(page, 2);
  begin('concepts');
  const cpt = await S(page, () => {
    const st = window.__store.getState();
    const c = st.addConcept('Raison', 'Faculté de bien juger.');
    const h = st.highlights[0];
    if (h) st.toggleHighlightConcept(h.id, c.id);
    return c.id;
  });
  await nav(page, { name: 'concepts', conceptId: cpt });
  await sleep(800);
  await nav(page, { name: 'concepts', conceptId: null });
  await sleep(500);
  begin('arguments');
  await nav(page, { name: 'arguments', argumentId: null });
  await sleep(600);
  await tap(page, 'button:has-text("Nouvel argument")', { wait: 700 });
  await esc(page);
  begin('plans');
  await nav(page, { name: 'plans', planId: null });
  await sleep(600);
  await tap(page, 'button:has-text("Nouveau plan")', { wait: 700 });
  await tap(page, '[data-testid="add-part"]');
  await tap(page, '[data-testid="add-sub"]');
  await esc(page);
  begin('révision');
  await nav(page, { name: 'revision' });
  await sleep(800);
  await tap(page, 'button:has-text("Commencer")', { wait: 600 });
  await tap(page, 'button:has-text("Afficher")', { wait: 400 });
  await esc(page);

  // ── Écrits ──
  begin('écrits : liste');
  await nav(page, { name: 'write', draftId: null });
  await sleep(800);
  begin('écrits : éditeur');
  const did = await page.evaluate(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Tour', html: '<h1>Titre</h1><p>Premier paragraphe du texte de la visite.</p><p>Second paragraphe.</p>' }).then((d) => d.id));
  await nav(page, { name: 'write', draftId: did });
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await sleep(800);
  await page.evaluate(() => {
    const ed = window.__ed.engine().debugEditor().editor;
    let at = null;
    ed.state.doc.descendants((n, pos) => {
      if (at === null && n.isText && n.text.includes('Premier paragraphe')) at = pos + n.text.length;
      return at === null;
    });
    ed.view.focus();
    ed.commands.setTextSelection({ from: at, to: at });
  });
  await sleep(200);
  await page.keyboard.type(' Ajout « tapé » au clavier.');
  await sleep(400);
  begin('écrits : commentaire');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('ControlOrMeta+Alt+KeyM');
  await sleep(400);
  await page.keyboard.type('Un commentaire');
  await page.keyboard.press('Enter');
  await sleep(300);
  await esc(page, 2);
  begin('écrits : panneau latéral');
  if (!(await page.$('.ed-side'))) await tap(page, '[aria-label="Panneau latéral"], [data-act="side"], button[title*="anneau"]');
  for (const c of ['extracts', 'book', 'comments', 'versions', 'notes', 'outline']) {
    begin('écrits : panneau ' + c);
    await tap(page, `.ed-side-tabs [data-side="${c}"]`, { wait: 900 });
  }
  begin('écrits : livre du panneau');
  await tap(page, '.ed-side .ed-book-pick button, .ed-side [data-book-id] >> nth=0', { wait: 1500 });
  begin('écrits : versions');
  await tap(page, 'button:has-text("Versions")', { wait: 700 });
  await esc(page, 2);
  begin('écrits : export');
  if (await tap(page, '.ed-topbar [data-tb="export"]:has-text("Exporter")')) {
    const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await tap(page, '.ed-export-menu [data-fmt="docx"], .ed-export-menu [data-fmt] >> nth=0', { wait: 300 });
    await dl;
    await sleep(600);
    await esc(page, 2);
  }
  await shot(page, `${platform || 'mac'}-07-editeur.png`);
  begin('écrits : autres outils');
  for (const lbl of ['Mise en page', 'Typographie française']) {
    await tap(page, `[aria-label="${lbl}"]`, { wait: 500 });
    await esc(page, 2);
  }
  await page.keyboard.press('ControlOrMeta+Shift+KeyF');
  await sleep(500);
  await page.keyboard.press('ControlOrMeta+Shift+KeyF');
  await sleep(300);

  // ── Espaces, carte libre ──
  begin('espaces');
  const ws = await S(page, ({ bid, did }) => {
    const st = window.__store.getState();
    const w = st.createWorkspace('Visite');
    const g = st.createGroup(w.id, null, 'Groupe');
    st.addToWorkspace(w.id, null, 'book', bid);
    st.addToWorkspace(w.id, g.id, 'draft', did);
    return w.id;
  }, { bid: ids['discours.epub'], did });
  await nav(page, { name: 'workspace', workspaceId: ws, groupId: null });
  await sleep(900);
  begin('espaces : carte libre');
  if (await tap(page, 'button:has-text("Nouvelle carte"), button:has-text("Carte libre")', { wait: 1200 })) {
    await tap(page, '[data-testid="board-add-confirm"]', { wait: 800 });
    await esc(page, 2);
    await tap(page, '[data-testid="board-back"]', { wait: 800 });
  }
  await shot(page, `${platform || 'mac'}-08-espace.png`);

  // ── Historique, corbeille, aide ──
  begin('historique');
  await nav(page, { name: 'history' });
  await sleep(900);
  begin('corbeille');
  await S(page, (id) => window.__store.getState().trashDelete('book', id), ids['premiere-partie.txt']);
  await nav(page, { name: 'trash' });
  await sleep(900);
  await tap(page, 'button:has-text("Restaurer") >> nth=0', { wait: 600 });
  begin('aide');
  await nav(page, { name: 'help' });
  await sleep(800);
  begin('palette de commandes');
  await page.keyboard.press('ControlOrMeta+KeyK');
  await sleep(400);
  await page.keyboard.type('raison');
  await sleep(600);
  await esc(page, 2);

  // ── Thèmes ──
  for (const theme of ['light', 'dark', 'sepia']) {
    begin('thème ' + theme);
    await S(page, (t) => window.__store.getState().updateSettings({ theme: t }), theme);
    await S(page, (id) => window.__store.getState().openBook(id), ids['discours.epub']);
    await sleep(1200);
    await shot(page, `${platform || 'mac'}-09-theme-${theme}.png`);
    await nav(page, { name: 'library' });
    await sleep(500);
  }
  await S(page, () => window.__store.getState().updateSettings({ theme: 'system' }));

  // ── Barre latérale repliée ──
  begin('barre latérale repliée');
  await S(page, () => window.__store.getState().updateSettings({ sidebarCollapsed: true }));
  await sleep(500);
  for (const r of [{ name: 'home' }, { name: 'library' }, { name: 'write', draftId: null }]) {
    await nav(page, r);
    await sleep(500);
  }
  await shot(page, `${platform || 'mac'}-10-replie.png`);
  await S(page, () => window.__store.getState().updateSettings({ sidebarCollapsed: false }));

  // ── Annuler / rétablir ──
  begin('annuler / rétablir');
  for (let i = 0; i < 4; i++) await S(page, () => window.__store.getState().undo());
  for (let i = 0; i < 4; i++) await S(page, () => window.__store.getState().redo());
  await sleep(500);
  return ids;
}

try {
  for (const platform of ['', 'win']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    watch(page);
    const n0 = errors.length;
    await tour(page, { platform });
    check(`parcours ${platform || 'par défaut'} sans erreur`, errors.length === n0, errors.slice(n0).join('\n'));
    await ctx.close();
  }
} catch (e) {
  failed++;
  console.log(`ÉCHEC exception à l’étape « ${step} » : ${e.message}`);
} finally {
  if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + errors.join('\n'));
  await browser.close();
  await server.close();
}
console.log(failed ? `\n${failed} échec(s)` : '\nTOUT PASSE');
process.exit(failed ? 1 : 0);
