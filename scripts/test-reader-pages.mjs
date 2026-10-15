// Repères de page (EPUB) et « Aller à la page » (EPUB, PDF).
// - EPUB 3 à pages imprimées (page-list + repères pagebreak, chiffres romains) : numéros des repères,
//   page imprimée des extraits, sélection / copie sans les repères, offsets des surlignages inchangés ;
// - même livre sans page-list (repères epub:type / role="doc-pagebreak" seuls) ;
// - EPUB sans pages : pagination estimée stable quand la taille du texte change ;
// - réglage « Marquer les pages » (trait et numéro / trait seul / aucun) ;
// - aller à la page : indicateur, raccourci ⌘⌥G (Ctrl+Maj+G sous Windows), palette ⌘K (« page 3 », « p x », « 45 »),
//   page inexistante, pastille de retour, position sauvegardée ; PDF à libellés de page (i, ii, 1, 2…) ;
// - captures clair / sombre / côte à côte.
// Lancer : timeout 300 node scripts/test-reader-pages.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5405;

let failures = 0;
let passes = 0;
const check = (cond, label, extra) => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${label}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
};

async function withApp(fn, { width = 1440, height = 900, query = '' } = {}) {
  const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-' + PORT, server: { port: PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  try {
    await page.goto(`http://localhost:${PORT}/${query}`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 45000 });
    await fn(page, errors);
  } finally {
    if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + errors.slice(0, 12).join('\n'));
    check(!errors.some((e) => /pages|PageJump|HtmlReader|PdfReader/.test(e)), 'aucune erreur navigateur liée aux pages', errors.slice(0, 3));
    await browser.close();
    await server.close();
  }
}

async function shot(page, out) {
  const abs = path.resolve(ROOT, out);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  await page.mouse.move(2, 300);
  await page.evaluate(() => {
    const s = window.__store.getState();
    (s.toasts ?? []).forEach((t) => s.dismissToast?.(t.id));
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: abs });
  console.log('capture:', out);
}

// ── Fixtures ─────────────────────────────────────────────────

const WORDS =
  'la raison le jugement la volonté une idée claire et distincte le doute méthodique conduit l’esprit vers la vérité ' +
  'car il faut une fois en sa vie se défaire de toutes les opinions reçues et recommencer tout de nouveau dès les fondements ' +
  'or les sens nous trompent quelquefois et il est de la prudence de ne se fier jamais entièrement à ceux qui nous ont une fois trompés';
const W = WORDS.split(' ');
/** Paragraphe déterministe d'environ `n` caractères, commençant par `lead`. */
function para(lead, n, seed) {
  let out = lead;
  let i = seed * 7;
  while (out.length < n) out += ' ' + W[i++ % W.length];
  return out + '.';
}

const xhtml = (title, body) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="fr"><head><title>${title}</title></head><body>${body}</body></html>`;

/**
 * EPUB 3 à pages imprimées. Préface : ix (début), x (milieu d'un paragraphe), xi (entre deux paragraphes).
 * Chapitre premier : 1 (début), 2 (milieu), 3 (entre), 4 (milieu). Chapitre II : 5 (début), 6, 7.
 * `pageList` : nav page-list (sinon seulement les repères pagebreak du texte, epub:type et ARIA).
 */
async function epubPrinted({ pageList = true, title = 'Méditations paginées' } = {}) {
  const pb = (id, label, aria = false) =>
    aria ? `<span role="doc-pagebreak" id="${id}" aria-label="${label}"></span>` : `<span epub:type="pagebreak" id="${id}" title="${label}"></span>`;
  const mid = (lead, label, id, seed, aria) => {
    const p = para(lead, 900, seed);
    const cut = p.indexOf(' ', 450);
    return `<p>${p.slice(0, cut + 1)}${pb(id, label, aria)}${p.slice(cut + 1)}</p>`;
  };
  const pre = xhtml(
    'Préface',
    `${pb('page_ix', 'ix')}<h1>Préface</h1><p>${para('Préface du traducteur, qui ouvre ce volume', 700, 1)}</p>` +
      mid('Le lecteur trouvera ici', 'x', 'page_x', 2) +
      `<p>${para('Fin de la page dix', 500, 3)}</p>${pb('page_xi', 'xi')}<p>${para('Début de la page onze en chiffres romains', 900, 4)}</p>`,
  );
  const ch1 = xhtml(
    'Chapitre premier',
    `${pb('page_1', '1')}<h1>Chapitre premier</h1><p>${para('Il y a déjà quelque temps', 1100, 5)}</p>` +
      mid('Je supposerai donc', '2', 'page_2', 6) +
      `<p>${para('Fin de la page deux', 600, 7)}</p>${pb('page_3', '3', true)}<p>${para('Début de la page trois et du doute', 1200, 8)}</p>` +
      mid('Mais aussitôt après', '4', 'page_4', 9, true) +
      `<p>${para('Ce qui suit la page quatre', 1400, 10)}</p>`,
  );
  const ch2 = xhtml(
    'Chapitre II',
    `${pb('page_5', '5')}<h1>Chapitre II</h1><p>${para('De la nature de l’esprit humain', 1300, 11)}</p>` +
      mid('Archimède, pour tirer le globe', '6', 'page_6', 12) +
      `<p>${para('Je suppose donc que toutes les choses', 1500, 13)}</p>${pb('page_7', '7')}<p>${para('Début de la page sept', 1600, 14)}</p>` +
      `<p>${para('Dernier paragraphe du livre', 1800, 15)}</p>`,
  );
  const plist = [
    ['pre.xhtml#page_ix', 'ix'],
    ['pre.xhtml#page_x', 'x'],
    ['pre.xhtml#page_xi', 'xi'],
    ['ch1.xhtml#page_1', '1'],
    ['ch1.xhtml#page_2', '2'],
    ['ch1.xhtml#page_3', '3'],
    ['ch1.xhtml#page_4', '4'],
    ['ch2.xhtml#page_5', '5'],
    ['ch2.xhtml#page_6', '6'],
    ['ch2.xhtml#page_7', '7'],
  ];
  const nav = xhtml(
    'Sommaire',
    `<nav epub:type="toc"><ol><li><a href="pre.xhtml">Préface</a></li><li><a href="ch1.xhtml">Chapitre premier</a></li><li><a href="ch2.xhtml">Chapitre II</a></li></ol></nav>` +
      (pageList ? `<nav epub:type="page-list" hidden="hidden"><ol>${plist.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ol></nav>` : ''),
  );
  return zipEpub(title, { 'pre.xhtml': pre, 'ch1.xhtml': ch1, 'ch2.xhtml': ch2 }, nav);
}

/** EPUB sans pages imprimées : 3 chapitres, ~60 000 signes. */
async function epubPlain() {
  const chapters = {};
  for (let c = 1; c <= 3; c++) {
    let body = `<h1>Partie ${c}</h1>`;
    for (let k = 0; k < 18; k++) body += `<p>${para(`Partie ${c}, paragraphe ${k + 1} :`, 600 + ((k * 397 + c * 131) % 900), c * 31 + k)}</p>`;
    chapters[`p${c}.xhtml`] = xhtml(`Partie ${c}`, body);
  }
  const nav = xhtml('Sommaire', `<nav epub:type="toc"><ol>${Object.keys(chapters).map((f, i) => `<li><a href="${f}">Partie ${i + 1}</a></li>`).join('')}</ol></nav>`);
  return zipEpub('Traité sans pages', chapters, nav);
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

/** PDF de 5 pages dont la numérotation imprimée est i, ii, 1, 2, 3 (PageLabels). */
function pdfWithLabels() {
  const n = 5;
  const objs = [];
  const pageIds = [];
  // 1 catalogue, 2 pages, 3 police, puis (page, contenu) × n
  for (let i = 0; i < n; i++) pageIds.push(4 + i * 2);
  objs[1] = `<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 2 << /S /D >>] >> >>`;
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`;
  objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  for (let i = 0; i < n; i++) {
    const label = ['i', 'ii', '1', '2', '3'][i];
    const text = `BT /F1 22 Tf 60 700 Td (Page physique ${i + 1}, imprimee ${label}) Tj ET BT /F1 12 Tf 60 660 Td (Texte de la page ${i + 1} pour le test des libelles.) Tj ET`;
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objs[5 + i * 2] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  }
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ── Aides ────────────────────────────────────────────────────

async function importBuffer(page, name, buf, open = true) {
  const b64 = Buffer.from(buf).toString('base64');
  return page.evaluate(
    async ({ name, b64, open }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await window.__store.getState().importFiles([{ name, data: bin.buffer }], { asBook: true });
      if (open && book) window.__store.getState().openBook(book.id);
      return book?.id;
    },
    { name, b64, open },
  );
}

async function waitHtml(page, pane = 'a') {
  await page.waitForFunction(
    (pane) => {
      const p = document.querySelector(`.reader-page[data-pane="${pane}"]`);
      return !!p && !!p.querySelector('.html-chapter-text') && !p.querySelector('.reader-loading') && !!p.querySelector('[data-testid=page-indicator]');
    },
    pane,
    { timeout: 25000 },
  );
  await page.waitForTimeout(400);
}

/** Repères : libellé, chapitre, offset dans le textContent, styles calculés du trait et du numéro. */
const marks = (page, pane = 'a') =>
  page.evaluate((pane) => {
    return [...document.querySelectorAll(`.reader-page[data-pane="${pane}"] .pg-mark`)].map((el) => {
      const root = el.closest('.html-chapter-text');
      const r = document.createRange();
      r.setStart(root, 0);
      r.setEndBefore(el);
      const b = getComputedStyle(el, '::before');
      const a = getComputedStyle(el, '::after');
      return {
        label: el.dataset.pg,
        chapter: Number(root.dataset.chapter),
        offset: r.toString().length,
        cls: el.className,
        rule: b.display !== 'none' && b.content !== 'none',
        num: a.display !== 'none' && a.content !== 'none' ? a.content : null,
        title: el.title,
      };
    });
  }, pane);

const indicator = (page, pane = 'a') => page.evaluate((pane) => document.querySelector(`.reader-page[data-pane="${pane}"] [data-testid=page-indicator]`)?.textContent ?? null, pane);

/** Le repère de la page `label` est-il en haut de la fenêtre (juste sous le bord) ? */
const markNearTop = (page, label, pane = 'a') =>
  page.evaluate(
    ({ label, pane }) => {
      const sc = document.querySelector(`.reader-page[data-pane="${pane}"] .html-scroll`);
      const el = [...sc.querySelectorAll('.pg-mark')].find((m) => m.dataset.pg === label);
      if (!el) return null;
      return Math.round(el.getBoundingClientRect().top - sc.getBoundingClientRect().top);
    },
    { label, pane },
  );

async function jumpViaIndicator(page, q, pane = 'a') {
  await page.click(`.reader-page[data-pane="${pane}"] [data-testid=page-indicator]`);
  await page.waitForSelector('[data-testid=page-jump-input]', { timeout: 3000 });
  await page.fill('[data-testid=page-jump-input]', q);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
}

async function jumpViaPalette(page, q) {
  await page.evaluate(() => window.__store.getState().setCommandOpen(true));
  await page.waitForSelector('.cmd-input');
  await page.fill('.cmd-input', q);
  await page.waitForTimeout(150);
  const first = await page.evaluate(() => document.querySelector('.cmd-item .cmd-label')?.textContent ?? '');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  return first;
}

/** Sélectionne [needleA … needleB] dans un chapitre (traverse un repère de page). */
const selectAcross = (page, a, b, pane = 'a') =>
  page.evaluate(
    ({ a, b, pane }) => {
      const root = [...document.querySelectorAll(`.reader-page[data-pane="${pane}"] .html-chapter-text`)].find((r) => r.textContent.includes(a) && r.textContent.includes(b));
      const t = root.textContent;
      const s = t.indexOf(a);
      const e = t.indexOf(b, s) + b.length;
      const loc = (off, end) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let pos = 0;
        let n;
        while ((n = w.nextNode())) {
          const len = n.data.length;
          if (off < pos + len || (end && off === pos + len)) return [n, off - pos];
          pos += len;
        }
        return null;
      };
      const [n0, o0] = loc(s, false);
      const [n1, o1] = loc(e, true);
      n0.parentElement.scrollIntoView({ block: 'center' });
      const r = document.createRange();
      r.setStart(n0, o0);
      r.setEnd(n1, o1);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      const crosses = [...root.querySelectorAll('.pg-mark')].some((m) => r.intersectsNode(m));
      const st = sel.toString();
      const ex = t.slice(s, e);
      let d = 0;
      while (d < st.length && st[d] === ex[d]) d++;
      return { sel: st, expected: ex, crosses, diff: st === ex ? null : { at: d, sel: JSON.stringify(st.slice(d - 5, d + 10)), exp: JSON.stringify(ex.slice(d - 5, d + 10)) } };
    },
    { a, b, pane },
  );

/** Sélectionne `before` caractères avant le repère `label` et `after` après (traverse le repère). */
const selectAroundMark = (page, label, before = 30, after = 26, pane = 'a') =>
  page.evaluate(
    ({ label, before, after, pane }) => {
      const el = [...document.querySelectorAll(`.reader-page[data-pane="${pane}"] .pg-mark`)].find((m) => m.dataset.pg === label);
      const root = el.closest('.html-chapter-text');
      const r0 = document.createRange();
      r0.setStart(root, 0);
      r0.setEndBefore(el);
      const off = r0.toString().length;
      const t = root.textContent;
      const s = off - before;
      const e = off + after;
      const loc = (o, end) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let pos = 0;
        let n;
        while ((n = w.nextNode())) {
          const len = n.data.length;
          if (o < pos + len || (end && o === pos + len)) return [n, o - pos];
          pos += len;
        }
        return null;
      };
      const [n0, o0] = loc(s, false);
      const [n1, o1] = loc(e, true);
      n0.parentElement.scrollIntoView({ block: 'center' });
      const r = document.createRange();
      r.setStart(n0, o0);
      r.setEnd(n1, o1);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return { sel: sel.toString(), expected: t.slice(s, e), crosses: r.intersectsNode(el) };
    },
    { label, before, after, pane },
  );

/** Chaque surlignage couvre exactement h.text, au même offset que son ancrage. */
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
        return { ok, cat: h.category, text: h.text.slice(0, 30), covered: ok ? undefined : covered.slice(0, 40), start: r0.toString().length, anchor: h.anchor.start, printedPage: h.printedPage };
      });
  }, bookId);

// ── Scénario ─────────────────────────────────────────────────

await withApp(async (page) => {
  await page.evaluate(() => window.__store.getState().updateSettings({ showToc: true, showExtracts: true, theme: 'light' }));

  console.log('\n== EPUB 3 à pages imprimées (page-list) ==');
  const printedId = await importBuffer(page, 'meditations-paginees.epub', await epubPrinted());
  await waitHtml(page);
  let ms = await marks(page);
  check(JSON.stringify(ms.map((m) => m.label)) === JSON.stringify(['ix', 'x', 'xi', '1', '2', '3', '4', '5', '6', '7']), 'repères : numéros imprimés dans l’ordre (romains compris)', ms.map((m) => m.label));
  const byLabel = Object.fromEntries(ms.map((m) => [m.label, m]));
  check(byLabel.x?.cls.includes('pg-inline') && byLabel['2']?.cls.includes('pg-inline') && byLabel['4']?.cls.includes('pg-inline'), 'page commencée au milieu d’un paragraphe : encoche (pg-inline)', ms.map((m) => m.cls));
  check(byLabel.xi?.cls.includes('pg-block') && byLabel['3']?.cls.includes('pg-block'), 'page commencée entre deux paragraphes : pg-block');
  check(byLabel.ix?.cls.includes('pg-start') && !byLabel.ix.num && byLabel['1']?.cls.includes('pg-chap') && byLabel['1'].num === '"1"', 'première page sans repère ; début de chapitre : numéro seul', [byLabel.ix, byLabel['1']]);
  check(byLabel.x?.rule && byLabel.x.num === '"x"' && byLabel['6']?.rule && byLabel['6'].num === '"6"', 'trait et numéro (« x », « 6 »)', [byLabel.x, byLabel['6']]);
  check(byLabel.x && !/estimée/.test(byLabel.x.title), 'pages imprimées : pas de mention « estimée »', byLabel.x?.title);
  // Le texte des chapitres ne contient aucun numéro de repère (pseudo-éléments seulement).
  const leaks = await page.evaluate(() => [...document.querySelectorAll('.pg-mark')].filter((m) => m.textContent !== '' || m.childNodes.length).length);
  check(leaks === 0, 'repères vides : rien dans le textContent');
  const ind0 = await indicator(page);
  check(/^p\. (–|ix) \/ 7$/.test(ind0 ?? ''), 'indicateur « p. … / 7 » (dernière page imprimée)', ind0);

  // Extraits : page imprimée proposée, ancrages exacts ; un extrait à cheval sur un repère.
  const mkHl = async (a, b, cat) => {
    const r = await selectAcross(page, a, b);
    await page.waitForSelector('.sel-toolbar', { timeout: 4000 });
    await page.waitForTimeout(150);
    await page.keyboard.press(cat);
    await page.waitForTimeout(350);
    if (await page.$('.ann-pop')) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }
    return r;
  };
  // Passage de la page ix qui traverse le repère « x » (milieu de paragraphe).
  const across = await selectAroundMark(page, 'x');
  await page.waitForSelector('.sel-toolbar', { timeout: 4000 });
  await page.waitForTimeout(150);
  await page.keyboard.press('2');
  await page.waitForTimeout(350);
  check(across.crosses && across.sel === across.expected, 'sélection à travers un repère : texte exact, sans numéro', { sel: across.sel, exp: across.expected });
  await mkHl('Début de la page trois', 'et du doute', '3');
  await mkHl('Début de la page onze', 'chiffres romains', '5');
  let hv = await verifyHighlights(page, printedId);
  check(hv.length === 3 && hv.every((h) => h.ok), 'surlignages : texte et offsets exacts malgré les repères', hv);
  const pp = Object.fromEntries(hv.map((h) => [h.text.slice(0, 12), h.printedPage]));
  check(hv.find((h) => h.text.startsWith('Début de la page trois'))?.printedPage === '3' && hv.find((h) => h.text.startsWith('Début de la page onze'))?.printedPage === 'xi', 'page imprimée des extraits (« 3 », « xi ») = numéros des repères', pp);
  check(hv.find((h) => h.cat === 'these')?.printedPage === 'ix', 'extrait commencé avant le repère « x » : page « ix »', pp);

  // Copie (⌘C) d'une sélection qui traverse un repère : pas de numéro dans le presse-papiers.
  const sel2 = await selectAroundMark(page, '3', 40, 30);
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(150);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => 'ERR ' + e.message));
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  check(sel2.crosses && norm(clip) === norm(sel2.expected) && !/[0-9]Début/.test(clip), 'copie : le numéro de page n’est pas copié', { clip: clip.slice(-90), exp: sel2.expected.slice(-90) });
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.keyboard.press('Escape');

  console.log('\n== Aller à la page (EPUB imprimé) ==');
  await jumpViaIndicator(page, '4');
  let top = await markNearTop(page, '4');
  check(top !== null && top > 0 && top < 140, 'indicateur → p. 4 : le début de la page est en haut', top);
  check((await indicator(page)) === 'p. 4 / 7', 'indicateur après le saut : « p. 4 / 7 »', await indicator(page));
  check(!!(await page.$('[data-testid=page-back]')), 'pastille de retour après le saut');
  await page.waitForTimeout(1600);
  const pos = await page.evaluate((id) => window.__store.getState().books.find((b) => b.id === id).position, printedId);
  check(pos?.kind === 'html' && pos.chapter === byLabel['4'].chapter, 'position de lecture sauvegardée après le saut', pos);

  await page.keyboard.press('Control+Alt+KeyG');
  const focused = await page.waitForSelector('[data-testid=page-jump-input]', { timeout: 3000 }).then(() => page.evaluate(() => document.activeElement?.dataset.testid));
  check(focused === 'page-jump-input', '⌘⌥G ouvre le champ, curseur dedans', focused);
  await page.keyboard.type('xi');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  top = await markNearTop(page, 'xi');
  check(top !== null && top > 0 && top < 140 && (await indicator(page)) === 'p. xi / 7', '⌘⌥G « xi » : page en chiffres romains', { top, ind: await indicator(page) });

  await page.click('[data-testid=page-back]');
  await page.waitForTimeout(900);
  check((await indicator(page)) === 'p. 4 / 7', 'pastille « ← p. 4 » : retour à l’endroit quitté', await indicator(page));

  let first = await jumpViaPalette(page, 'page 6');
  check(first === 'Aller à la page 6' && (await indicator(page)) === 'p. 6 / 7', '⌘K « page 6 »', { first, ind: await indicator(page) });
  first = await jumpViaPalette(page, 'p x');
  check(first === 'Aller à la page x' && (await indicator(page)) === 'p. x / 7', '⌘K « p x » (romain)', { first, ind: await indicator(page) });
  first = await jumpViaPalette(page, '2');
  top = await markNearTop(page, '2');
  check(first === 'Aller à la page 2' && (await indicator(page)) === 'p. 2 / 7' && top > 0 && top < 140, '⌘K « 2 »', { first, top, ind: await indicator(page) });

  await jumpViaIndicator(page, '900');
  const err = await page.evaluate(() => document.querySelector('[data-testid=page-jump-error]')?.textContent ?? null);
  check(err === 'Ce livre n’a pas de page 900 — dernière page : 7', 'page inexistante : message clair', err);
  await shot(page, 'shots/reader-pages-error.png');
  await page.keyboard.press('Escape');
  check(!(await page.$('[data-testid=page-jump-input]')), 'Échap referme le champ');

  // Captures : page imprimée en clair, réglages.
  await jumpViaPalette(page, 'page 2');
  await page.evaluate(() => {
    const sc = document.querySelector('.html-scroll');
    sc.scrollTop -= 160;
  });
  await page.waitForTimeout(400);
  await shot(page, 'shots/reader-pages-light.png');
  {
    const box = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.pg-mark')].find((m) => m.dataset.pg === '2');
      const col = el.closest('.html-col').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, col.left - 40), y: Math.max(0, r.top - 90), width: col.width + 110, height: 200 };
    });
    await page.screenshot({ path: path.resolve(ROOT, 'shots/reader-pages-zoom.png'), clip: box });
    console.log('capture: shots/reader-pages-zoom.png');
  }
  // Champ « Aller à la page » ouvert, numéro saisi (capture).
  await page.click('[data-testid=page-indicator]');
  await page.waitForSelector('[data-testid=page-jump-input]');
  await page.keyboard.type('6');
  await page.waitForTimeout(250);
  {
    const abs = path.resolve(ROOT, 'shots/reader-pages-goto.png');
    await page.screenshot({ path: abs });
    console.log('capture: shots/reader-pages-goto.png');
  }
  await page.keyboard.press('Escape');
  check(!(await page.$('[data-testid=page-jump-input]')) && (await indicator(page)) === 'p. 1 / 7', 'Échap : champ refermé sans saut', await indicator(page));
  await page.click('.reader-topbar button[title="Affichage"]');
  await page.waitForSelector('[data-testid=page-marks-switch]');
  await shot(page, 'shots/reader-pages-settings.png');
  await page.click('.typo-seg-sub button:has-text("Trait seul")');
  await page.waitForTimeout(200);
  ms = await marks(page);
  check(ms.filter((m) => !m.cls.includes('pg-start') && !m.cls.includes('pg-chap')).every((m) => m.rule && !m.num), 'réglage « trait seul » : trait sans numéro');
  await page.click('[data-testid=page-marks-switch]');
  await page.waitForTimeout(200);
  ms = await marks(page);
  check(ms.every((m) => !m.rule && !m.num), 'réglage « Marquer les pages » désactivé : aucun repère visible');
  hv = await verifyHighlights(page, printedId);
  check(hv.every((h) => h.ok), 'repères masqués : surlignages inchangés', hv);
  await jumpViaPalette(page, 'page 5');
  check((await indicator(page)) === 'p. 5 / 7', 'repères masqués : « Aller à la page » fonctionne toujours', await indicator(page));
  await page.click('[data-testid=page-marks-switch]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ms = await marks(page);
  check(ms.find((m) => m.label === '6')?.num === '"6"', 'réactivé : trait et numéro');

  // Rechargement : surlignages identiques.
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
  await page.evaluate((id) => window.__store.getState().openBook(id), printedId);
  await waitHtml(page);
  hv = await verifyHighlights(page, printedId);
  check(hv.length === 3 && hv.every((h) => h.ok), 'après rechargement : surlignages exacts', hv);

  console.log('\n== Repères pagebreak sans page-list (epub:type et ARIA) ==');
  const inlineId = await importBuffer(page, 'meditations-sans-page-list.epub', await epubPrinted({ pageList: false, title: 'Méditations sans page-list' }));
  await waitHtml(page);
  ms = await marks(page);
  check(JSON.stringify(ms.map((m) => m.label)) === JSON.stringify(['ix', 'x', 'xi', '1', '2', '3', '4', '5', '6', '7']), 'repères du texte seuls (epub:type pagebreak, role doc-pagebreak) : mêmes numéros', ms.map((m) => m.label));
  await mkHl('Début de la page trois', 'et du doute', '3');
  hv = await verifyHighlights(page, inlineId);
  check(hv[0]?.ok && hv[0].printedPage === '3', 'page imprimée depuis un repère ARIA (« 3 »)', hv);

  console.log('\n== EPUB sans pages : pagination estimée ==');
  const plainId = await importBuffer(page, 'traite-sans-pages.epub', await epubPlain());
  await waitHtml(page);
  const est1 = await marks(page);
  const texts = await page.evaluate(() => [...document.querySelectorAll('.reader-page[data-pane="a"] .html-chapter-text')].map((r) => r.textContent));
  const total = texts.reduce((n, t) => n + t.length, 0);
  check(est1.length >= Math.floor(total / 1800) - 2 && est1.length <= Math.ceil(total / 1800) + 3, `pages estimées : ${est1.length} pour ${total} signes (~1 800 par page)`, est1.length);
  check(est1.every((m, i) => m.label === String(i + 1)), 'numérotation continue 1…N d’un chapitre à l’autre');
  check(est1.every((m) => m.offset === 0 || /\s/.test(texts[m.chapter][m.offset - 1])), 'coupes à une frontière de mot ou de paragraphe');
  check(/pagination estimée/.test(est1[3]?.title ?? ''), 'repère : info-bulle « pagination estimée »', est1[3]?.title);
  const indTitle = await page.evaluate(() => document.querySelector('[data-testid=page-indicator]')?.title ?? '');
  check(/pagination estimée \(le livre n’indique pas ses pages imprimées\)/.test(indTitle), 'indicateur : info-bulle « pagination estimée »', indTitle);
  const sig = (l) => l.map((m) => `${m.label}@${m.chapter}:${m.offset}`).join(',');
  await page.evaluate(() => window.__store.getState().updateSettings({ fontSize: 26, measure: 52 }));
  await page.waitForTimeout(700);
  const est2 = await marks(page);
  check(sig(est1) === sig(est2), 'pagination estimée identique après changement de taille et de largeur');
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(500);
  check(sig(est1) === sig(await marks(page)), 'pagination estimée identique après redimensionnement de la fenêtre');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.__store.getState().updateSettings({ fontSize: 19, measure: 66 }));
  await page.waitForTimeout(500);
  const last = est1.length;
  first = await jumpViaPalette(page, String(last - 3));
  top = await markNearTop(page, String(last - 3));
  check(first === `Aller à la page ${last - 3}` && top > 0 && top < 140 && (await indicator(page)) === `p. ${last - 3} / ${last}`, `⌘K « ${last - 3} » : page estimée lointaine (dernier chapitre)`, { first, top, ind: await indicator(page) });
  await jumpViaIndicator(page, '3');
  check((await indicator(page)) === `p. 3 / ${last}`, 'indicateur : retour à la page 3', await indicator(page));
  await jumpViaIndicator(page, String(last + 50));
  const err2 = await page.evaluate(() => document.querySelector('[data-testid=page-jump-error]')?.textContent ?? null);
  check(err2 === `Ce livre n’a pas de page ${last + 50} — dernière page : ${last}`, 'page estimée inexistante : message', err2);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const sc = document.querySelector('.html-scroll');
    sc.scrollTop -= 220;
  });
  await page.waitForTimeout(400);
  await shot(page, 'shots/reader-pages-estimated.png');

  console.log('\n== Thème sombre, sépia, côte à côte ==');
  await page.evaluate((id) => window.__store.getState().openBook(id), printedId);
  await waitHtml(page);
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
  await jumpViaPalette(page, 'page 2');
  await page.evaluate(() => {
    document.querySelector('.html-scroll').scrollTop -= 160;
  });
  await page.waitForTimeout(500);
  await shot(page, 'shots/reader-pages-dark.png');
  const darkNum = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.pg-mark')].find((m) => m.dataset.pg === '2');
    return { num: getComputedStyle(el, '::after').color, bg: getComputedStyle(document.querySelector('.html-scroll')).backgroundColor };
  });
  check(darkNum.num !== darkNum.bg, 'thème sombre : numéro lisible sur le fond', darkNum);
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'sepia' }));
  await page.waitForTimeout(300);
  await shot(page, 'shots/reader-pages-sepia.png');
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));
  await page.evaluate(
    ({ a, b }) => {
      const s = window.__store.getState();
      s.navigate({ name: 'reader', bookId: a, tab: 'lecture', splitBookId: b });
    },
    { a: printedId, b: plainId },
  );
  await waitHtml(page, 'b');
  const mb = await marks(page, 'b');
  check(mb.length === est1.length, 'côte à côte : repères dans le second volet', mb.length);
  await page.click('.reader-page[data-pane="b"] .html-scroll', { position: { x: 30, y: 200 } });
  await page.keyboard.press('Control+Alt+KeyG');
  await page.waitForSelector('.reader-page[data-pane="b"] [data-testid=page-jump-input]', { timeout: 3000 });
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  check((await indicator(page, 'b')) === `p. 5 / ${last}`, 'côte à côte : ⌘⌥G agit sur le volet actif', await indicator(page, 'b'));
  await jumpViaIndicator(page, '3', 'a');
  check((await indicator(page, 'a')) === 'p. 3 / 7' && (await indicator(page, 'b')) === `p. 5 / ${last}`, 'côte à côte : chaque volet a sa page', [await indicator(page, 'a'), await indicator(page, 'b')]);
  await shot(page, 'shots/reader-pages-split.png');
  await page.evaluate((a) => window.__store.getState().navigate({ name: 'reader', bookId: a, tab: 'lecture', splitBookId: null }), printedId);

  console.log('\n== PDF à libellés de page (i, ii, 1, 2, 3) ==');
  const pdfId = await importBuffer(page, 'libelles.pdf', pdfWithLabels());
  await page.waitForSelector('.pdf-page[data-page="1"] .textLayer[data-ready="1"]', { timeout: 25000 });
  await page.waitForFunction(() => !document.querySelector('.reader-loading'), null, { timeout: 15000 });
  await page.waitForTimeout(500);
  const pdfInd = () => page.evaluate(() => document.querySelector('[data-testid=pdf-page]')?.textContent ?? null);
  const physical = () =>
    page.evaluate(() => {
      const sc = document.querySelector('.pdf-scroll');
      const y = sc.getBoundingClientRect().top + 30;
      const p = [...document.querySelectorAll('.pdf-page')].find((el) => el.getBoundingClientRect().bottom > y);
      return Number(p?.dataset.page);
    });
  check((await pdfInd()) === 'p. i / 3', 'PDF : indicateur en numérotation imprimée « p. i / 3 »', await pdfInd());
  first = await jumpViaPalette(page, '1');
  check(first === 'Aller à la page 1' && (await physical()) === 3 && (await pdfInd()) === 'p. 1 / 3', 'PDF : ⌘K « 1 » → page physique 3 (libellé « 1 »)', { first, phys: await physical(), ind: await pdfInd() });
  // Clic par le DOM : le clic de Playwright fait défiler le document (pdf.js ajoute un canevas caché
  // de 16 px sous le corps de la page), ce qui fausserait la vérification ci-dessous.
  await page.evaluate(() => document.querySelector('[data-testid=pdf-page]').click());
  await page.fill('[data-testid=page-jump-input]', 'ii');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  check((await physical()) === 2 && (await pdfInd()) === 'p. ii / 3', 'PDF : indicateur « ii » → page physique 2', { phys: await physical(), ind: await pdfInd() });
  await page.keyboard.press('Control+Alt+KeyG');
  await page.waitForSelector('[data-testid=page-jump-input]', { timeout: 3000 });
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const perr = await page.evaluate(() => document.querySelector('[data-testid=page-jump-error]')?.textContent ?? null);
  check(perr === 'Ce livre n’a pas de page 9 — dernière page : 3', 'PDF : page inexistante', perr);
  const shift = await page.evaluate(() => [document.scrollingElement.scrollTop, document.querySelector('#root')?.scrollTop ?? 0, document.querySelector('.reader-topbar').getBoundingClientRect().top]);
  check(shift.every((v) => v === 0), 'champ de page ouvert : la fenêtre ne se décale pas', shift);
  await shot(page, 'shots/reader-pages-pdf-error.png');
  await page.keyboard.press('Escape');
  // Extrait : page imprimée = libellé du PDF.
  await jumpViaPalette(page, '2');
  await page.waitForSelector('.pdf-page[data-page="4"] .textLayer[data-ready="1"]', { timeout: 15000 });
  await page.evaluate(() => {
    const span = [...document.querySelectorAll('.pdf-page[data-page="4"] .textLayer span')].find((s) => s.textContent.includes('Texte de la page 4'));
    const r = document.createRange();
    r.selectNodeContents(span.firstChild ?? span);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForSelector('.sel-toolbar', { timeout: 4000 });
  await page.waitForTimeout(150);
  await page.keyboard.press('2');
  await page.waitForTimeout(400);
  const pdfHl = await page.evaluate((id) => window.__store.getState().highlights.find((h) => h.bookId === id), pdfId);
  check(pdfHl?.printedPage === '2' && pdfHl.anchor.page === 4, 'PDF : page imprimée de l’extrait = libellé « 2 » (page physique 4)', pdfHl && { p: pdfHl.printedPage, page: pdfHl.anchor.page });
});

console.log('\n== Windows : Ctrl+Maj+G ==');
await withApp(
  async (page) => {
    await importBuffer(page, 'meditations-win.epub', await epubPrinted({ title: 'Méditations Windows' }));
    await waitHtml(page);
    const tip = await page.evaluate(() => document.querySelector('[data-testid=page-indicator]')?.title ?? '');
    check(/Ctrl\+Maj\+G/.test(tip), 'Windows : info-bulle « Ctrl+Maj+G »', tip);
    await page.keyboard.press('Control+Alt+KeyG');
    await page.waitForTimeout(300);
    check(!(await page.$('[data-testid=page-jump-input]')), 'Windows : Ctrl+Alt+G (AltGr) sans effet');
    await page.keyboard.press('Control+Shift+KeyG');
    await page.waitForSelector('[data-testid=page-jump-input]', { timeout: 3000 });
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    check((await indicator(page)) === 'p. 5 / 7', 'Windows : Ctrl+Maj+G puis « 5 »', await indicator(page));
    await page.evaluate(() => window.__store.getState().setCommandOpen(true));
    await page.waitForSelector('.cmd-input');
    await page.fill('.cmd-input', 'aller à la page');
    await page.waitForTimeout(150);
    const hint = await page.evaluate(() => [...document.querySelectorAll('.cmd-item')].find((i) => /Aller à la page…/.test(i.textContent))?.querySelector('.kbd')?.textContent ?? '');
    check(hint === 'Ctrl+Maj+G', 'Windows : ⌘K « Aller à la page… » affiche Ctrl+Maj+G', hint);
    await page.keyboard.press('Escape');
  },
  { query: '?platform=win' },
);

console.log(`\n${passes} OK, ${failures} échec(s)`);
process.exit(failures ? 1 : 0);
