// Cas limites — port 5411. Lancer : timeout 400 node scripts/test-edge.mjs      Captures : shots/edge/
// EPUB sans titre ni table des matières, PDF scanné (sans texte), titre très long (débordements),
// livre supprimé alors qu'il est ouvert dans le panneau de l'éditeur, extrait dont le livre est à la
// corbeille, raccourcis en mode Windows simulé (?platform=win). Échoue sur toute erreur console / pageerror.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/edge');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5411;

let failed = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${name}${detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });
const S = (page, fn, arg) => page.evaluate(fn, arg);

// ── Fichiers fabriqués ──
async function epubNoTitleNoToc() {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file(
    'OEBPS/content.opf',
    '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:language>fr</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
  );
  const para = (t) => `<p>${t} La pensée ne se laisse pas réduire à ce qu’on en dit ; il faut la reprendre à chaque lecture.</p>`;
  const ch = (n) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title></title></head><body>${Array.from({ length: 30 }, (_, i) => para(`Chapitre ${n}, paragraphe ${i + 1}.`)).join('')}</body></html>`;
  z.file('OEBPS/c1.xhtml', ch(1));
  z.file('OEBPS/c2.xhtml', ch(2));
  return z.generateAsync({ type: 'nodebuffer' });
}
/** PDF d'une page sans aucun texte (un rectangle gris : comme un scan sans OCR). */
function pdfNoText() {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << >> >>',
  ];
  const content = '0.6 g 60 60 475 722 re f';
  objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function importBuf(page, name, buf, opts = { asBook: true }) {
  return page.evaluate(
    async ({ name, b64, opts }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const out = await window.__store.getState().importFiles([{ name, data: bin.buffer }], opts);
      return out[0]?.id ?? null;
    },
    { name, b64: buf.toString('base64'), opts },
  );
}
/** Éléments qui débordent horizontalement de la fenêtre ou de leur conteneur coupé. */
const overflowX = (page) =>
  page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const bad = [];
    if (document.documentElement.scrollWidth > W + 1) bad.push('page:' + document.documentElement.scrollWidth);
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.right > W + 2 && el.closest('.react-flow__viewport, .html-scroll, .pdf-scroll, .ed-engine, [data-overflow-ok]') == null) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}:${Math.round(r.right)}`);
    }
    return bad.slice(0, 8);
  });

const server = await createServer({
  root: ROOT,
  cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`),
  server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errors = [];
let step = '';
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(`[${step}] pageerror: ${e.message} ${(e.stack || '').split('\n').slice(1, 3).join(' ')}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${step}] console: ${m.text().slice(0, 400)}`));
  page.on('response', (r) => r.status() >= 400 && errors.push(`[${step}] HTTP ${r.status()} : ${r.url()}`));
};
const begin = (s) => {
  step = s;
  console.log('—', s);
};

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });

  // ── EPUB sans titre ni table des matières ──
  begin('EPUB sans titre ni TdM');
  const e1 = await importBuf(page, 'sans-titre.epub', await epubNoTitleNoToc());
  check('import EPUB sans titre', !!e1);
  const b1 = await S(page, (id) => window.__store.getState().books.find((b) => b.id === id), e1);
  check('titre de repli non vide (nom du fichier)', !!b1?.title?.trim(), b1?.title);
  await S(page, (id) => window.__store.getState().openBook(id), e1);
  await page.waitForSelector('.html-doc.is-revealed', { timeout: 30000 });
  await sleep(1000);
  check('texte affiché', (await page.locator('.html-doc p').count()) >= 30);
  await S(page, () => window.__store.getState().updateSettings({ showToc: true }));
  await sleep(500);
  await shot(page, '1-epub-sans-titre.png');
  await page.evaluate(() => (document.querySelector('.html-scroll').scrollTop = 3000));
  await sleep(600);
  await page.keyboard.press('ControlOrMeta+KeyD');
  await sleep(500);
  const bm = await S(page, (id) => window.__store.getState().bookmarks.filter((b) => b.bookId === id), e1);
  check('signet dans un EPUB sans TdM', bm.length === 1 && !!bm[0].label, bm[0]?.label);
  await page.keyboard.press('Escape');

  // ── PDF sans texte ──
  begin('PDF scanné sans texte');
  const p1 = await importBuf(page, 'scan.pdf', pdfNoText());
  check('import PDF sans texte', !!p1);
  await S(page, (id) => window.__store.getState().openBook(id), p1);
  await page.waitForSelector('.pdf-page[data-page="1"]', { timeout: 30000 });
  await sleep(2500);
  check('PDF sans texte : plus de voile de chargement', !(await page.$('.reader-loading.overlay')));
  await page.keyboard.press('ControlOrMeta+KeyD');
  await sleep(500);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+KeyF');
  await sleep(300);
  await page.keyboard.type('raison');
  await page.keyboard.press('Enter');
  await sleep(800);
  await page.keyboard.press('Escape');
  await shot(page, '2-pdf-sans-texte.png');

  // ── Titre très long ──
  begin('titre très long');
  const long = 'Essai sur l’entendement humain où l’on montre quelle est l’étendue des connaissances certaines et la manière dont nous y parvenons, avec des remarques sur ' + 'la croyance, l’opinion et l’assentiment, '.repeat(4);
  await S(page, ([id, t]) => window.__store.getState().updateBook(id, { title: t, author: 'Un auteur au nom lui-même interminable, traduit et annoté par plusieurs mains successives' }), [e1, long]);
  const ws = await S(page, (id) => {
    const st = window.__store.getState();
    const w = st.createWorkspace('Un espace de travail au nom démesurément long pour vérifier les débordements de la barre latérale');
    st.addToWorkspace(w.id, null, 'book', id);
    return w.id;
  }, e1);
  for (const r of [{ name: 'home' }, { name: 'library' }, { name: 'workspace', workspaceId: ws, groupId: null }, { name: 'reader', bookId: e1, tab: 'lecture', splitBookId: null }, { name: 'reader', bookId: e1, tab: 'carte', splitBookId: null }]) {
    begin('titre très long : ' + r.name + (r.tab ? ' ' + r.tab : ''));
    await S(page, (r) => window.__store.getState().navigate(r), r);
    await sleep(1200);
    const ov = await overflowX(page);
    check(`pas de débordement horizontal (${r.name}${r.tab ? ' ' + r.tab : ''})`, ov.length === 0, ov);
    await shot(page, `3-long-${r.name}${r.tab ? '-' + r.tab : ''}.png`);
  }

  // ── Livre ouvert dans le panneau de l'éditeur, puis supprimé ──
  begin('suppression du livre du panneau de l’éditeur');
  const epub = await importBuf(page, 'discours.epub', fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')));
  const did = await page.evaluate(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Panneau', html: '<p>Texte.</p>' }).then((d) => d.id));
  await S(page, (id) => window.__store.getState().navigate({ name: 'write', draftId: id }), did);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await sleep(800);
  if (!(await page.$('.ed-side'))) await page.keyboard.press('ControlOrMeta+Alt+KeyB').catch(() => {});
  await page.waitForSelector('.ed-side', { timeout: 8000 }).catch(() => {});
  await page.click('.ed-side-tabs [data-side="book"]').catch(() => {});
  await sleep(500);
  await page.locator('.ed-side .ed-book-row, .ed-side button:has-text("Discours de la méthode")').first().click({ timeout: 5000 }).catch((e) => console.log('   (choix du livre)', e.message.split('\n')[0]));
  await page.waitForSelector('.ed-book .html-doc.is-revealed', { timeout: 30000 }).catch(() => {});
  await sleep(800);
  check('livre ouvert dans le panneau', !!(await page.$('.ed-book .html-doc')));
  await S(page, (id) => window.__store.getState().trashDelete('book', id), epub);
  await sleep(1200);
  check('panneau : plus de livre supprimé affiché', !(await page.$('.ed-book .html-doc')));
  check('éditeur toujours là', !!(await page.$('.ed-engine-in')));
  await shot(page, '4-panneau-livre-supprime.png');
  // Restauration puis vérification
  await S(page, () => {
    const st = window.__store.getState();
    const e = st.trash.find((t) => t.kind === 'book');
    if (e) st.restoreFromTrash(e.id);
  });
  await sleep(800);

  // ── Extrait dont le livre est à la corbeille ──
  begin('extrait d’un livre à la corbeille');
  await S(page, (id) => window.__store.getState().openBook(id), epub);
  await page.waitForSelector('.html-doc.is-revealed', { timeout: 30000 });
  await sleep(800);
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.html-doc p')].find((p) => p.textContent.includes('bon sens'));
    p.scrollIntoView({ block: 'center' });
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const n = w.nextNode();
    const r = document.createRange();
    r.setStart(n, 0);
    r.setEnd(n, Math.min(40, n.data.length));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await sleep(400);
  await page.keyboard.press('2');
  await sleep(500);
  const hl = await S(page, (id) => window.__store.getState().highlights.find((h) => h.bookId === id)?.id, epub);
  check('extrait créé', !!hl);
  const cid = await S(page, (h) => {
    const st = window.__store.getState();
    const c = st.addConcept('Bon sens');
    st.toggleHighlightConcept(h, c.id);
    return c.id;
  }, hl);
  await S(page, (id) => window.__store.getState().trashDelete('book', id), epub);
  await sleep(600);
  for (const r of [{ name: 'extracts' }, { name: 'concepts', conceptId: cid }, { name: 'home' }, { name: 'revision' }, { name: 'arguments', argumentId: null }, { name: 'plans', planId: null }]) {
    begin('livre à la corbeille : ' + r.name);
    await S(page, (r) => window.__store.getState().navigate(r), r);
    await sleep(800);
  }
  begin('livre à la corbeille : jumpToHighlight');
  await S(page, (h) => window.__store.getState().jumpToHighlight(h), hl);
  await sleep(1000);
  const route = await S(page, () => window.__store.getState().route.name);
  check('aller à un extrait dont le livre est à la corbeille : pas de lecteur cassé', route !== 'reader' || !!(await page.$('.html-doc')), route);
  await shot(page, '5-extrait-livre-corbeille.png');
  begin('livre à la corbeille : panneau de l’éditeur');
  await S(page, (id) => window.__store.getState().navigate({ name: 'write', draftId: id }), did);
  await sleep(1500);
  await page.click('.ed-side-tabs [data-side="extracts"]').catch(() => {});
  await sleep(600);
  await page.click('.ed-side-tabs [data-side="book"]').catch(() => {});
  await sleep(600);
  await ctx.close();

  // ── Mode Windows simulé ──
  begin('mode Windows simulé');
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const w = await ctx2.newPage();
  watch(w);
  await w.goto(`http://localhost:${PORT}/?platform=win`);
  await w.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  const wb = await importBuf(w, 'discours.epub', fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')));
  await sleep(400);
  const tips = await w.evaluate(() => [...document.querySelectorAll('[title]')].map((e) => e.getAttribute('title')).filter((t) => /⌘|⌥|⇧/.test(t)));
  check('Windows : aucune infobulle avec ⌘ ⌥ ⇧', tips.length === 0, tips.slice(0, 5));
  const kbds = await w.evaluate(() => [...document.querySelectorAll('kbd, .kbd, .nav-kbd, .cmd-kbd')].map((e) => e.textContent).filter((t) => /⌘|⌥/.test(t)));
  check('Windows : aucun raccourci affiché avec ⌘ ⌥', kbds.length === 0, kbds.slice(0, 5));
  await w.keyboard.press('Control+KeyK');
  await sleep(400);
  check('Windows : Ctrl+K ouvre la palette', await w.evaluate(() => window.__store.getState().commandOpen));
  await w.keyboard.press('Escape');
  await sleep(200);
  await w.keyboard.press('Meta+KeyK');
  await sleep(300);
  check('Windows : la touche Windows+K n’ouvre pas la palette', !(await w.evaluate(() => window.__store.getState().commandOpen)));
  await w.keyboard.press('Escape');
  await S(w, (id) => window.__store.getState().openBook(id), wb);
  await w.waitForSelector('.html-doc.is-revealed', { timeout: 30000 });
  await sleep(800);
  await w.evaluate(() => (document.querySelector('.html-scroll').scrollTop = 2000));
  await sleep(400);
  await w.keyboard.press('Control+KeyD');
  await sleep(500);
  check('Windows : Ctrl+D pose un signet', (await S(w, () => window.__store.getState().bookmarks.length)) === 1);
  await w.keyboard.press('Escape');
  for (const r of [{ name: 'help' }, { name: 'write', draftId: null }, { name: 'reader', bookId: wb, tab: 'carte', splitBookId: null }]) {
    await S(w, (r) => window.__store.getState().navigate(r), r);
    await sleep(900);
    const t2 = await w.evaluate(() => [...document.querySelectorAll('[title], [aria-label], kbd')].map((e) => (e.getAttribute('title') || '') + ' ' + (e.tagName === 'KBD' ? e.textContent : '')).filter((t) => /⌘|⌥/.test(t)));
    check(`Windows : pas de ⌘/⌥ affiché (${r.name}${r.tab ? ' ' + r.tab : ''})`, t2.length === 0, t2.slice(0, 5));
  }
  await shot(w, '6-windows-aide.png');
  await ctx2.close();
} catch (e) {
  failed++;
  console.log(`ÉCHEC exception à l’étape « ${step} » : ${e.stack}`);
} finally {
  check('aucune erreur navigateur', errors.length === 0, errors.join('\n'));
  await browser.close();
  await server.close();
}
console.log(failed ? `\n${failed} échec(s)` : '\nTOUT PASSE');
process.exit(failed ? 1 : 0);
