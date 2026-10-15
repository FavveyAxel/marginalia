// Tests du moteur HTML (A1) : EPUB, DOCX, MD, TXT (+ HTML), ré-ancrage après rechargement,
// connecteurs, recherche, page-list EPUB, DRM, côte à côte, captures clair / sombre.
// Lancer : timeout 170 node scripts/test-html.mjs
import { importFixture, shot } from './harness.mjs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5201;

// ── Banc de test local ───────────────────────────────────────
// Même rôle que withApp de harness.mjs, mais résistant aux modules des AUTRES agents en
// cours d'écriture : un import relatif introuvable (hors de src/features/reader/html) est
// remplacé par un module factice qui exporte des composants vides sous les noms importés.
// Nos propres fichiers ne sont jamais remplacés.
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stubMissing = {
  name: 'a1-stub-missing',
  enforce: 'pre',
  async resolveId(source, importer, opts) {
    if (!importer || !source.startsWith('.') || importer.includes('/features/reader/html/') || importer.startsWith('\0')) return null;
    const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
    if (r) return null;
    console.log(`[banc] module absent remplacé : ${source} (importé par ${path.relative(ROOT, importer)})`);
    return `\0a1stub:${importer}::${source}`;
  },
  load(id) {
    if (!id.startsWith('\0a1stub:')) return null;
    const [importer, source] = id.slice('\0a1stub:'.length).split('::');
    if (/\.css$/.test(source)) return '';
    const src = fs.readFileSync(importer, 'utf8');
    const names = new Set();
    let hasDefault = false;
    const re = new RegExp(`import\\s+(?:type\\s+)?([\\s\\S]*?)\\s+from\\s+['"]${escRe(source)}['"]`, 'g');
    for (const m of src.matchAll(re)) {
      const clause = m[1];
      const braces = /\{([\s\S]*)\}/.exec(clause);
      if (braces) for (const part of braces[1].split(',')) {
        const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (n) names.add(n);
      }
      if (/^\s*[A-Za-z_$][\w$]*\s*(,|$)/.test(clause)) hasDefault = true;
    }
    return [
      'const Stub = () => null;',
      ...[...names].map((n) => `export const ${n} = Stub;`),
      hasDefault ? 'export default Stub;' : '',
    ].join('\n');
  },
};

async function withApp(port, fn, { width = 1440, height = 900, dark = false } = {}) {
  const server = await createServer({ root: ROOT, server: { port, strictPort: true }, logLevel: 'error', plugins: [stubMissing] });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  try {
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 45000 });
    await fn(page, errors);
  } finally {
    const own = errors.filter((e) => /reader\/html|HtmlReader|anchoring|parse\.ts/.test(e));
    if (errors.length) console.log(`ERREURS NAVIGATEUR (${errors.length}, dont ${own.length} liées au moteur HTML):\n` + errors.slice(0, 12).join('\n'));
    await browser.close();
    await server.close();
  }
}
let failures = 0;
let passes = 0;
const check = (cond, label, extra) => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${label}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
};

// ── Aides ────────────────────────────────────────────────────

async function importBuffer(page, name, buf, open = true) {
  const b64 = Buffer.from(buf).toString('base64');
  return page.evaluate(
    async ({ name, b64, open }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await window.__store.getState().importFiles([{ name, data: bin.buffer }]);
      if (open && book) window.__store.getState().openBook(book.id);
      return book?.id;
    },
    { name, b64, open },
  );
}

async function waitReady(page, pane = 'a') {
  await page.waitForFunction(
    (pane) => {
      const p = document.querySelector(`.reader-page[data-pane="${pane}"]`);
      return !!p && !!p.querySelector('.html-chapter-text') && !p.querySelector('.reader-loading');
    },
    pane,
    { timeout: 25000 },
  );
  await page.waitForTimeout(350);
}

/** Sélectionne la n-ième occurrence de `needle` dans le textContent des chapitres du volet. */
async function selectIn(page, pane, needle, nth = 0) {
  const ok = await page.evaluate(
    ({ pane, needle, nth }) => {
      const roots = [...document.querySelectorAll(`.reader-page[data-pane="${pane}"] .html-chapter-text`)];
      let seen = 0;
      for (const root of roots) {
        const t = root.textContent;
        let i = t.indexOf(needle);
        while (i >= 0) {
          if (seen === nth) {
            const loc = (off, endBias) => {
              const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
              let pos = 0;
              let n;
              while ((n = w.nextNode())) {
                const len = n.data.length;
                if (off < pos + len || (endBias && off === pos + len)) return [n, off - pos];
                pos += len;
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
          seen++;
          i = t.indexOf(needle, i + 1);
        }
      }
      return false;
    },
    { pane, needle, nth },
  );
  if (!ok) throw new Error('Texte introuvable pour la sélection : ' + needle);
  await page.waitForSelector('.sel-toolbar', { timeout: 4000 });
  await page.waitForTimeout(120);
}

async function annotate(page, pane, needle, what, nth = 0) {
  await selectIn(page, pane, needle, nth);
  const sel =
    what === 'note'
      ? '.sel-toolbar button[title^="Note personnelle"]'
      : what === 'movement'
        ? '.sel-toolbar button[title^="Début de mouvement"]'
        : `.sel-toolbar button[title^="${what}"]`;
  await page.click(sel);
  await page.waitForTimeout(250);
  // Fermer un éventuel popover de note
  if (await page.$('.ann-pop')) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

/** Capture sans toast ni survol parasite. */
async function cleanShot(page, file) {
  await page.mouse.move(2, 300);
  await page.evaluate(() => {
    const s = window.__store.getState();
    (s.toasts ?? []).forEach((t) => s.dismissToast(t.id));
  });
  await page.waitForTimeout(250);
  await shot(page, file);
}

/** Sélection RÉELLE à la souris (glisser du premier au dernier caractère de `needle`). */
async function dragSelect(page, pane, needle) {
  // Toasts (« Extrait placé dans la corbeille »…) empilés par-dessus le texte : le glissé finirait dessus.
  await page.evaluate(() => {
    const s = window.__store.getState();
    (s.toasts ?? []).forEach((t) => s.dismissToast?.(t.id));
  });
  const pts = await page.evaluate(
    ({ pane, needle }) => {
      const root = [...document.querySelectorAll(`.reader-page[data-pane="${pane}"] .html-chapter-text`)].find((r) => r.textContent.includes(needle));
      if (!root) return null;
      const t = root.textContent;
      const i = t.indexOf(needle);
      const at = (off) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let pos = 0;
        let n;
        while ((n = w.nextNode())) {
          if (off < pos + n.data.length) return [n, off - pos];
          pos += n.data.length;
        }
        return null;
      };
      const [n0] = at(i);
      n0.parentElement.scrollIntoView({ block: 'center' });
      const rectOf = (off) => {
        const [n, o] = at(off);
        const r = document.createRange();
        r.setStart(n, o);
        r.setEnd(n, o + 1);
        return r.getClientRects()[0];
      };
      const a = rectOf(i);
      const b = rectOf(i + needle.length - 1);
      return { x0: a.left + 1, y0: a.top + a.height / 2, x1: b.right - 1, y1: b.top + b.height / 2 };
    },
    { pane, needle },
  );
  if (!pts) throw new Error('dragSelect : texte introuvable ' + needle);
  await page.waitForTimeout(150);
  await page.mouse.move(pts.x0, pts.y0);
  await page.mouse.down();
  await page.mouse.move((pts.x0 + pts.x1) / 2, (pts.y0 + pts.y1) / 2, { steps: 4 });
  await page.mouse.move(pts.x1, pts.y1, { steps: 4 });
  await page.mouse.up();
  await page.waitForSelector('.sel-toolbar', { timeout: 4000 });
  await page.waitForTimeout(120);
}

/** Vérifie pour chaque surlignage du livre que ses éléments couvrent EXACTEMENT h.text. */
async function verifyHighlights(page, bookId, pane = 'a', { strictOffsets = true } = {}) {
  return page.evaluate(
    ({ bookId, pane, strictOffsets }) => {
      const doc = document.querySelector(`.reader-page[data-pane="${pane}"] .html-doc`);
      const hs = window.__store.getState().highlights.filter((h) => h.bookId === bookId);
      return hs.map((h) => {
        const els = [...doc.querySelectorAll(`[data-hl-id="${h.id}"]`)];
        if (!els.length) return { id: h.id, text: h.text.slice(0, 30), ok: false, why: 'aucun élément' };
        const root = els[0].closest('.html-chapter-text');
        const r0 = document.createRange();
        r0.setStart(root, 0);
        r0.setStartBefore(root.firstChild);
        r0.setEndBefore(els[0]);
        const start = r0.toString().length;
        const r = document.createRange();
        r.setStartBefore(els[0]);
        r.setEndAfter(els[els.length - 1]);
        const covered = r.toString();
        const chapter = Number(root.getAttribute('data-chapter'));
        const cls = h.category ? `hl-${h.category}` : 'hl-note';
        const classOk = els.every((e) => e.classList.contains('hl') && e.classList.contains(cls));
        const sameRoot = els.every((e) => e.closest('.html-chapter-text') === root);
        const offOk = !strictOffsets || (start === h.anchor.start && chapter === h.anchor.chapter);
        const ok = covered === h.text && classOk && sameRoot && offOk;
        return { id: h.id, text: h.text.slice(0, 30), ok, covered: ok ? undefined : covered.slice(0, 60), start, anchorStart: h.anchor.start, chapter, classOk };
      });
    },
    { bookId, pane, strictOffsets },
  );
}

const chapterTexts = (page, pane = 'a') =>
  page.evaluate((pane) => [...document.querySelectorAll(`.reader-page[data-pane="${pane}"] .html-chapter-text`)].map((r) => r.textContent), pane);

async function reload(page, bookId) {
  await page.waitForTimeout(900); // persistance différée (350 ms)
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
  await page.evaluate((id) => window.__store.getState().openBook(id), bookId);
  await waitReady(page);
}

const allOk = (rows) => rows.length > 0 && rows.every((r) => r.ok);

// ── Fichiers synthétiques ────────────────────────────────────

async function epubWithPageList() {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')));
  let ch2 = await zip.file('EPUB/text/ch002.xhtml').async('string');
  ch2 = ch2.replace('<p>Entre lesquelles', '<span epub:type="pagebreak" id="page_12" title="12"></span><p>Entre lesquelles');
  ch2 = ch2.replace('<p>Le second, de diviser', '<span epub:type="pagebreak" id="page_13" title="13"></span><p>Le second, de diviser');
  zip.file('EPUB/text/ch002.xhtml', ch2);
  let nav = await zip.file('EPUB/nav.xhtml').async('string');
  nav = nav.replace(
    '</body>',
    '<nav epub:type="page-list" hidden="hidden"><ol><li><a href="text/ch001.xhtml">11</a></li><li><a href="text/ch002.xhtml#page_12">12</a></li><li><a href="text/ch002.xhtml#page_13">13</a></li></ol></nav></body>',
  );
  zip.file('EPUB/nav.xhtml', nav);
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

async function epubWithDrm() {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')));
  zip.file(
    'META-INF/encryption.xml',
    `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="EPUB/text/ch001.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

function longTxt() {
  const src = fs.readFileSync(path.join(ROOT, 'fixtures/premiere-partie.txt'), 'utf8');
  const paras = src.split(/\n\s*\n/).filter((p) => p.trim() && p.length > 40);
  let out = 'Méditations de test\n\n';
  let n = 0;
  while (out.length < 130000) {
    out += `Paragraphe ${++n}. ` + paras[n % paras.length] + '\n\n';
  }
  return Buffer.from(out + 'Dernière phrase unique du long texte.\n', 'utf8');
}

// ── Scénario principal : EPUB ───────────────────────────────

await withApp(PORT, async (page, errors) => {
  console.log('\n== EPUB ==');
  const id = await importFixture(page, 'fixtures/discours.epub', { open: true });
  await waitReady(page);
  const tocLabels = await page.$$eval('.reader-toc .toc-label', (els) => els.map((e) => e.textContent));
  check(['Première partie', 'Des études', 'Seconde partie', 'Les quatre préceptes', 'Quatrième partie'].every((l) => tocLabels.includes(l)), 'sommaire EPUB (nav) transmis', tocLabels);
  const nCh = await page.$$eval('.reader-page[data-pane="a"] .html-chapter-text', (e) => e.length);
  check(nCh === 5, 'chapitres EPUB = spine hors nav (5)', nCh);
  const purity = await page.evaluate(() => {
    const doc = document.querySelector('.html-doc');
    return { script: doc.querySelectorAll('script,style,link').length, ids: doc.querySelectorAll('[id]').length, styled: doc.querySelectorAll('[style]:not(.html-chapter):not(.html-mv)').length, blob: [...doc.querySelectorAll('img')].every((i) => i.src.startsWith('blob:')) };
  });
  check(purity.script === 0 && purity.ids === 0 && purity.styled === 0, 'HTML assaini : ni script, ni style, ni id', purity);
  check(purity.blob, 'images EPUB en blob URLs');
  const texts0 = await chapterTexts(page);

  await annotate(page, 'a', 'Le bon sens est la chose du monde la mieux partagée', 'Thèse');
  await annotate(page, 'a', 'la mieux partagée ; car chacun pense', 'Argument'); // chevauche la thèse
  await annotate(page, 'a', 'la puissance de bien juger et distinguer le vrai d’avec le faux', 'note');
  await annotate(page, 'a', 'bon sens', 'Concept', 1); // 2e occurrence
  await annotate(page, 'a', 'naturellement égale en tous les hommes.\nEt ainsi la diversité de nos opinions', 'Exemple'); // deux paragraphes
  await annotate(page, 'a', 'cette vérité : je pense, donc je suis, était si ferme', 'Thèse adverse'); // traverse <em>
  await annotate(page, 'a', 'Et ainsi la diversité de nos opinions ne vient pas', 'movement');

  let st = await page.evaluate((id) => {
    const s = window.__store.getState();
    return { hs: s.highlights.filter((h) => h.bookId === id), studies: s.studies.filter((x) => x.bookId === id) };
  }, id);
  check(st.hs.length === 6, '6 surlignages créés dans le store', st.hs.length);
  const note = st.hs.find((h) => h.category === null);
  check(!!note && note.text === 'la puissance de bien juger et distinguer le vrai d’avec le faux', 'note de marge pure category:null', note?.text);
  const these = st.hs.find((h) => h.category === 'these');
  check(these?.locationLabel === 'Première partie' && these.anchor.kind === 'html' && these.anchor.chapter === 2 && these.printedPage === '', 'ancre, libellé de lieu, page imprimée vide sans page-list', these && { l: these.locationLabel, a: these.anchor, p: these.printedPage });
  {
    const t = texts0[these.anchor.chapter];
    const a = these.anchor;
    check(
      t.slice(a.start, a.end) === these.text && a.prefix === t.slice(Math.max(0, a.start - 32), a.start) && a.suffix === t.slice(a.end, a.end + 32) && a.suffix.length === 32,
      'offsets textContent + prefix/suffix 32 car.',
      a,
    );
  }
  const cross = st.hs.find((h) => h.category === 'exemple');
  check(cross?.text === 'naturellement égale en tous les hommes.\nEt ainsi la diversité de nos opinions', 'surlignage sur deux paragraphes (texte avec \\n)', cross?.text);
  const mv = st.studies[0]?.movements ?? [];
  check(mv.length === 1 && mv[0].startText.startsWith('Et ainsi la diversité'), 'mouvement créé (fiche-texte)', mv);
  const mvMark = await page.$eval('.reader-page[data-pane="a"] .html-mv', (e) => e.textContent).catch(() => null);
  check(mvMark === '§Mouvement 1', 'repère de mouvement dans la marge', mvMark);

  let v = await verifyHighlights(page, id);
  check(allOk(v), 'rendu : chaque surlignage couvre exactement son texte', v.filter((x) => !x.ok));
  check(JSON.stringify(await chapterTexts(page)) === JSON.stringify(texts0), 'textContent des chapitres inchangé par les décorations');
  const overlapNested = await page.evaluate(() => document.querySelectorAll('.hl .hl, .hl-these + .hl-argument, .hl-argument + .hl-these').length);
  check(overlapNested > 0, 'chevauchement rendu (éléments imbriqués)', overlapNested);
  const multi = await page.evaluate((hid) => document.querySelectorAll(`[data-hl-id="${hid}"]`).length, cross.id);
  check(multi >= 2, 'surlignage multi-éléments', multi);

  // Clic sur un surlignage → popover + actif
  await page.click(`.reader-page[data-pane="a"] [data-hl-id="${these.id}"]`);
  await page.waitForTimeout(250);
  const act = await page.evaluate((hid) => ({ a: window.__store.getState().activeHighlightId, cls: document.querySelector(`[data-hl-id="${hid}"]`).classList.contains('active') }), these.id);
  check(act.a === these.id && act.cls, 'clic surlignage → onHighlightClick + .active', act);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // Clic sur le repère de mouvement
  await page.evaluate(() => window.__store.getState().updateSettings({ rightPanel: 'extraits' }));
  await page.click('.reader-page[data-pane="a"] .html-mv');
  await page.waitForTimeout(150);
  check((await page.evaluate(() => window.__store.getState().settings.rightPanel)) === 'etude', 'clic repère → onMovementClick');

  await cleanShot(page, 'shots/html/epub-clair.png');

  // ── Rechargement : ré-ancrage exact
  await reload(page, id);
  v = await verifyHighlights(page, id);
  check(allOk(v), 'après rechargement : ré-ancrage exact de tous les surlignages', v.filter((x) => !x.ok));
  check((await page.$$('.reader-page[data-pane="a"] .html-mv')).length === 1, 'repère de mouvement restauré');

  // ── Robustesse : offsets décalés, contexte perdu, texte absent
  const drift = await page.evaluate(
    ({ id, cid, tid }) => {
      const s = window.__store.getState();
      const c = s.highlights.find((h) => h.id === cid);
      const t = s.highlights.find((h) => h.id === tid);
      s.patch('highlights', tid, { anchor: { ...t.anchor, start: t.anchor.start + 9, end: t.anchor.end + 9 } });
      s.patch('highlights', cid, { anchor: { ...c.anchor, start: c.anchor.start + 3, end: c.anchor.end + 3, prefix: '', suffix: '' } });
      const ghost = s.addHighlight({ bookId: id, category: 'probleme', text: 'Phrase absente du livre, à ne jamais afficher', anchor: { ...t.anchor, start: 10, end: 56 }, locationLabel: 'x' });
      return { trueStartC: c.anchor.start, trueStartT: t.anchor.start, ghost: ghost.id };
    },
    { id, cid: st.hs.find((h) => h.category === 'concept').id, tid: these.id },
  );
  await page.waitForTimeout(200);
  v = await verifyHighlights(page, id, 'a', { strictOffsets: false });
  const vc = v.find((x) => x.id === st.hs.find((h) => h.category === 'concept').id);
  const vt = v.find((x) => x.id === these.id);
  check(vt?.ok && vt.start === drift.trueStartT, 'offsets décalés → ré-ancré par citation (prefix+text+suffix)', vt);
  check(vc?.ok && vc.start === drift.trueStartC, 'sans contexte → occurrence la plus proche des offsets (2e « bon sens »)', vc);
  const ghostEls = await page.evaluate((g) => document.querySelectorAll(`[data-hl-id="${g}"]`).length, drift.ghost);
  check(ghostEls === 0, 'texte introuvable → rien affiché (pas de faux ancrage)', ghostEls);
  await page.evaluate(
    ({ ghost, tid, cid, ta, ca }) => {
      const s = window.__store.getState();
      s.removeHighlight(ghost);
      s.patch('highlights', tid, { anchor: ta });
      s.patch('highlights', cid, { anchor: ca });
    },
    { ghost: drift.ghost, tid: these.id, cid: st.hs.find((h) => h.category === 'concept').id, ta: these.anchor, ca: st.hs.find((h) => h.category === 'concept').anchor },
  );
  await page.waitForTimeout(150);

  // Mise à jour sans perdre la sélection en cours
  await selectIn(page, 'a', 'Les plus grandes âmes sont capables');
  await page.evaluate((hid) => window.__store.getState().updateHighlight(hid, { category: 'probleme' }), these.id);
  await page.waitForTimeout(200);
  const kept = await page.evaluate(() => getSelection().toString());
  check(kept === 'Les plus grandes âmes sont capables', 'sélection conservée quand highlights change', kept);
  const recolored = await page.evaluate((hid) => [...document.querySelectorAll(`[data-hl-id="${hid}"]`)].every((e) => e.classList.contains('hl-probleme')), these.id);
  check(recolored, 'changement de catégorie rendu');
  await page.evaluate((hid) => window.__store.getState().updateHighlight(hid, { category: 'these' }), these.id);
  await page.keyboard.press('Escape');

  // ── Connecteurs
  await page.evaluate(() => window.__store.getState().updateSettings({ showConnectors: true }));
  await page.waitForTimeout(400);
  const conn = await page.evaluate(() => [...document.querySelectorAll('.reader-page[data-pane="a"] .connector')].map((e) => e.textContent));
  check(conn.includes('car') && conn.includes('Car') && conn.includes('donc') && conn.includes('Mais'), 'connecteurs entourés (mots entiers, casse)', conn.slice(0, 12));
  check(!conn.some((c) => !/^[\p{L}’' -]+$/u.test(c)), 'connecteurs : mots seulement', conn);
  check(JSON.stringify(await chapterTexts(page)) === JSON.stringify(texts0), 'connecteurs : textContent inchangé');
  v = await verifyHighlights(page, id);
  check(allOk(v), 'connecteurs actifs : ancrages toujours exacts', v.filter((x) => !x.ok));
  await annotate(page, 'a', 'Car je me trouvais embarrassé de tant de doutes', 'Argument');
  v = await verifyHighlights(page, id);
  check(allOk(v) && v.length === 7, 'surlignage créé avec connecteurs actifs : exact', v.filter((x) => !x.ok));
  await reload(page, id);
  v = await verifyHighlights(page, id);
  check(allOk(v), 'connecteurs actifs + rechargement : ancrages exacts', v.filter((x) => !x.ok));
  await cleanShot(page, 'shots/html/epub-connecteurs.png');
  await page.evaluate(() => window.__store.getState().updateSettings({ showConnectors: false }));
  await page.waitForTimeout(300);
  check((await page.$$('.connector')).length === 0 && allOk(await verifyHighlights(page, id)), 'connecteurs retirés, ancrages exacts');

  // ── Contre-épreuve aléatoire : 60 surlignages au hasard (chevauchements, traversées de
  // blocs, 1 à 400 caractères, notes), connecteurs actifs, recatégorisation, suppressions,
  // rechargement. Chaque étape : chaque surlignage couvre exactement son texte, aux offsets.
  {
    await page.evaluate(() => window.__store.getState().updateSettings({ showConnectors: true }));
    await page.waitForTimeout(250);
    const made = await page.evaluate(
      ({ id, texts }) => {
        let seed = 20261014;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
        const cats = ['probleme', 'these', 'argument', 'objection', 'concept', 'exemple', null];
        const s = window.__store.getState();
        const ids = [];
        let guard = 0;
        while (ids.length < 60 && guard++ < 1000) {
          const ch = Math.floor(rnd() * texts.length);
          const t = texts[ch];
          if (t.length < 50) continue;
          let a = Math.floor(rnd() * (t.length - 1));
          let b = Math.min(t.length, a + 1 + Math.floor(rnd() * 400));
          while (a < b && /\s/.test(t[a])) a++;
          while (b > a && /\s/.test(t[b - 1])) b--;
          if (b <= a) continue;
          const h = s.addHighlight({
            bookId: id,
            category: cats[Math.floor(rnd() * cats.length)],
            text: t.slice(a, b),
            anchor: { kind: 'html', chapter: ch, start: a, end: b, prefix: t.slice(Math.max(0, a - 32), a), suffix: t.slice(b, b + 32) },
            locationLabel: 'aléatoire',
            printedPage: '',
          });
          ids.push(h.id);
        }
        return ids;
      },
      { id, texts: texts0 },
    );
    await page.waitForTimeout(300);
    v = await verifyHighlights(page, id);
    check(allOk(v) && v.length >= 66, `aléatoire : ${made.length} surlignages ajoutés (connecteurs actifs), tous exacts`, v.filter((x) => !x.ok).slice(0, 3));
    check(JSON.stringify(await chapterTexts(page)) === JSON.stringify(texts0), 'aléatoire : textContent inchangé');
    await page.evaluate((ids) => {
      const s = window.__store.getState();
      ids.forEach((hid, i) => {
        if (i % 3 === 0) s.removeHighlight(hid);
        else if (i % 3 === 1) s.updateHighlight(hid, { category: i % 2 ? 'concept' : null });
      });
    }, made);
    await page.waitForTimeout(300);
    v = await verifyHighlights(page, id);
    check(allOk(v), 'aléatoire : après suppressions et recatégorisations, tous exacts', v.filter((x) => !x.ok).slice(0, 3));
    const orphans = await page.evaluate((ids) => ids.filter((x, i) => i % 3 === 0 && document.querySelector(`[data-hl-id="${x}"]`)).length, made);
    check(orphans === 0, 'aléatoire : surlignages supprimés retirés du DOM', orphans);
    await reload(page, id);
    v = await verifyHighlights(page, id);
    check(allOk(v), 'aléatoire : après rechargement, tous exacts', v.filter((x) => !x.ok).slice(0, 3));
    check(JSON.stringify(await chapterTexts(page)) === JSON.stringify(texts0), 'rechargement : textContent identique (parse déterministe)');
    await page.evaluate((ids) => {
      const s = window.__store.getState();
      ids.forEach((hid) => s.highlights.some((h) => h.id === hid) && s.removeHighlight(hid));
      s.updateSettings({ showConnectors: false });
    }, made);
    await page.waitForTimeout(300);
    check(allOk(await verifyHighlights(page, id)), 'aléatoire : nettoyage, surlignages d’origine exacts');
  }

  // ── Sélection réelle à la souris (le corps de l'app est en user-select: none)
  {
    const needle = 'Les plus grandes âmes sont capables des plus grands vices';
    await dragSelect(page, 'a', needle);
    const selTxt = await page.evaluate(() => getSelection().toString());
    check(selTxt === needle, 'sélection à la souris : texte sélectionnable, barre affichée', selTxt);
    await page.click('.sel-toolbar button[title^="Concept"]');
    await page.waitForTimeout(250);
    const h = await page.evaluate((id) => window.__store.getState().highlights.filter((x) => x.bookId === id).sort((a, b) => b.createdAt - a.createdAt)[0], id);
    check(h.text === needle && h.category === 'concept', 'surlignage créé depuis une sélection souris', h.text);
    const cleared = await page.evaluate(() => ({ sel: getSelection().toString(), bar: !!document.querySelector('.sel-toolbar') }));
    check(cleared.sel === '' && !cleared.bar, 'sélection effacée après création', cleared);
    check(allOk(await verifyHighlights(page, id)), 'surlignage souris exact');
    await page.evaluate((hid) => window.__store.getState().removeHighlight(hid), h.id);
    await page.waitForTimeout(150);
  }

  // ── Sélection à cheval sur deux chapitres : limitée au premier
  {
    await page.evaluate(() => {
      const roots = document.querySelectorAll('.reader-page[data-pane="a"] .html-chapter-text');
      const a = roots[2];
      const b = roots[3];
      const ta = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
      let last = null;
      let n;
      while ((n = ta.nextNode())) if (/\S/.test(n.data)) last = n;
      const tb = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      let first = null;
      while ((n = tb.nextNode())) if (/\S/.test(n.data)) { first = n; break; }
      last.parentElement.scrollIntoView({ block: 'center' });
      const r = document.createRange();
      r.setStart(last, Math.max(0, last.data.length - 20));
      r.setEnd(first, Math.min(first.data.length, 6));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await page.waitForSelector('.sel-toolbar', { timeout: 4000 });
    await page.waitForTimeout(120);
    await page.click('.sel-toolbar button[title^="Exemple"]');
    await page.waitForTimeout(250);
    const h = await page.evaluate((id) => window.__store.getState().highlights.filter((x) => x.bookId === id).sort((a, b) => b.createdAt - a.createdAt)[0], id);
    const t2 = texts0[2];
    check(h.anchor.chapter === 2 && h.anchor.end === t2.trimEnd().length && h.text === t2.trimEnd().slice(-20).trimStart(), 'sélection sur deux chapitres : limitée au premier', { a: h.anchor, text: h.text });
    check(allOk(await verifyHighlights(page, id)), 'sélection sur deux chapitres : rendu exact');
    await page.evaluate((hid) => window.__store.getState().removeHighlight(hid), h.id);
    await page.waitForTimeout(150);
  }

  // ── Recherche (UI SearchBar → engine.search)
  await page.click('button[title="Rechercher (⌘F)"]');
  await page.fill('.search-bar-input', 'VERITE');
  await page.waitForSelector('.reader-page[data-pane="a"] .search-hit.current', { timeout: 5000 });
  const sr = await page.evaluate(() => ({
    cur: document.querySelector('.search-hit.current').textContent,
    n: new Set([...document.querySelectorAll('.search-hit')].map((e) => e.getAttribute('data-hit'))).size,
    snippet: document.querySelector('.search-bar-hit')?.textContent,
  }));
  check(sr.cur.toLowerCase() === 'vérité', 'recherche insensible casse/accents (VERITE → vérité)', sr);
  check(JSON.stringify(await chapterTexts(page)) === JSON.stringify(texts0), 'recherche : textContent inchangé');
  await page.fill('.search-bar-input', 'c\'est-a-dire');
  await page.waitForTimeout(700);
  const sr2 = await page.$$eval('.search-hit', (e) => e.map((x) => x.textContent));
  check(sr2.includes('c’est-à-dire'), 'recherche apostrophe droite → typographique', sr2);
  await page.fill('.search-bar-input', 'bon sens');
  await page.waitForTimeout(700);
  const nBon = await page.$$eval('.search-bar-hit', (e) => e.length);
  check(nBon === 2, 'recherche : 2 résultats « bon sens » + liste', nBon);
  const snip0 = await page.$eval('.search-bar-hit', (e) => e.textContent);
  check(!snip0.includes('partie Le bon') && snip0.includes('Le bon sens est la chose'), 'extrait de résultat borné au paragraphe', snip0);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await cleanShot(page, 'shots/html/epub-recherche.png');
  await page.click('.search-bar button[title="Fermer (Échap)"]');
  await page.waitForTimeout(200);
  check((await page.$$('.search-hit')).length === 0, 'clearSearch retire les marques');

  // ── Position : sommaire, changement de typographie, restauration
  await page.click('.reader-toc .toc-item:has-text("Les quatre préceptes")');
  await page.waitForTimeout(700);
  const topText = async () =>
    page.evaluate(() => {
      const sc = document.querySelector('.reader-page[data-pane="a"] .html-scroll');
      const r = sc.getBoundingClientRect();
      const col = sc.querySelector('.html-col').getBoundingClientRect();
      for (const dy of [20, 60, 120]) {
        const cr = document.caretRangeFromPoint(col.left + 40, r.top + dy);
        if (cr && cr.startContainer.nodeType === 3) {
          const rr = document.createRange();
          rr.setStart(cr.startContainer, cr.startOffset);
          rr.setEnd(cr.startContainer, Math.min(cr.startContainer.data.length, cr.startOffset + 1));
          return { t: cr.startContainer.data.slice(cr.startOffset, cr.startOffset + 25), y: rr.getBoundingClientRect().top - r.top };
        }
      }
      return null;
    });
  const posA = await page.evaluate((id) => window.__store.getState().books.find((b) => b.id === id).position, id);
  const label = await page.$eval('.reader-toc .toc-item.current', (e) => e.textContent).catch(() => null);
  check(posA?.kind === 'html' && posA.chapter === 3 && posA.scroll > 0, 'onPosition après goTo (chapitre 3, fraction)', posA);
  check(label && label.includes('Seconde partie'), 'locationLabel = titre du chapitre courant', label);
  const before = await topText();
  await page.evaluate(() => window.__store.getState().updateSettings({ fontSize: 24, measure: 52 }));
  await page.waitForTimeout(700);
  const after = await topText();
  check(before && after && before.t.slice(0, 12) === after.t.slice(0, 12) && Math.abs(before.y - after.y) < 40, 'réglages typographiques : position conservée', { before, after });
  await page.evaluate(() => window.__store.getState().updateSettings({ fontSize: 19, measure: 66 }));
  await page.waitForTimeout(600);
  const beforeReload = await topText();
  await reload(page, id);
  const afterReload = await topText();
  check(beforeReload && afterReload && Math.abs(beforeReload.y - afterReload.y) < 60 && beforeReload.t.slice(0, 5) === afterReload.t.slice(0, 5), 'position restaurée après rechargement', { beforeReload, afterReload });

  // goToHighlight via le panneau d'extraits (jump)
  await page.evaluate(() => {
    const sc = document.querySelector('.reader-page[data-pane="a"] .html-scroll');
    window.__samples = [];
    const t0 = performance.now();
    const tick = () => {
      window.__samples.push(Math.round(sc.scrollTop));
      if (performance.now() - t0 < 800) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.evaluate((hid) => window.__store.getState().jumpToHighlight(hid), these.id);
  await page.waitForTimeout(900);
  const samples = await page.evaluate(() => window.__samples);
  const distinct = new Set(samples).size;
  check(distinct >= 5, 'goToHighlight : défilement fluide (positions intermédiaires)', { distinct, first: samples[0], last: samples[samples.length - 1] });
  const vis = await page.evaluate((hid) => {
    const el = document.querySelector(`.reader-page[data-pane="a"] [data-hl-id="${hid}"]`);
    const sc = el.closest('.html-scroll').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { inView: r.top > sc.top && r.bottom < sc.bottom, pulse: el.classList.contains('pulse') };
  }, these.id);
  check(vis.inView && vis.pulse, 'goToHighlight : visible + .pulse', vis);

  // ── Côte à côte, même livre
  await page.evaluate((id) => window.__store.getState().openBook(id, id), id);
  await waitReady(page, 'a');
  await waitReady(page, 'b');
  const vb = await verifyHighlights(page, id, 'b');
  check(allOk(vb), 'volet B (même livre) : surlignages exacts', vb.filter((x) => !x.ok));
  const widthB = await page.$eval('.reader-page[data-pane="b"] .html-scroll', (e) => e.clientWidth);
  await selectIn(page, 'b', 'Le troisième, de conduire par ordre mes pensées');
  const toolbars = await page.$$('.sel-toolbar');
  check(toolbars.length === 1, 'une seule barre de sélection avec deux volets', toolbars.length);
  await page.click('.sel-toolbar button[title^="Exemple"]');
  await page.waitForTimeout(300);
  const va = await verifyHighlights(page, id, 'a');
  const vb2 = await verifyHighlights(page, id, 'b');
  check(allOk(va) && allOk(vb2) && va.length === 8, 'surlignage créé dans B rendu dans A et B, exact', { a: va.filter((x) => !x.ok), b: vb2.filter((x) => !x.ok) });
  const dupIds = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    return ids.length - new Set(ids).size;
  });
  check(dupIds === 0, 'aucun id DOM dupliqué avec deux instances', dupIds);
  await page.evaluate(() => {
    const sc = document.querySelector('.reader-page[data-pane="b"] .html-scroll');
    sc.scrollTop = 0;
  });
  await page.waitForTimeout(300);
  await cleanShot(page, 'shots/html/epub-cote-a-cote-clair.png');
  console.log('largeur du volet B :', widthB);

  // Volet étroit (~420 px)
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.evaluate(() => window.__store.getState().updateSettings({ showToc: false }));
  await page.waitForTimeout(600);
  const narrow = await page.$eval('.reader-page[data-pane="b"] .html-scroll', (e) => ({ w: e.clientWidth, overflow: e.scrollWidth - e.clientWidth }));
  check(narrow.overflow <= 0, 'volet étroit : pas de débordement horizontal', narrow);
  await page.evaluate(() => {
    const sc = document.querySelector('.reader-page[data-pane="b"] .html-scroll');
    const el = sc.querySelector('.html-mv');
    if (el) sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 200;
  });
  await page.waitForTimeout(300);
  await cleanShot(page, 'shots/html/epub-cote-a-cote-etroit.png');
  console.log('volet étroit :', narrow);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.__store.getState().updateSettings({ showToc: true }));

  // ── Page-list EPUB
  console.log('\n== EPUB avec page-list ==');
  const pid = await importBuffer(page, 'pages.epub', await epubWithPageList());
  await waitReady(page);
  await annotate(page, 'a', 'Le bon sens est la chose du monde', 'Thèse');
  await annotate(page, 'a', 'je demeurais tout le jour'.replace('je', 'Je'), 'Argument');
  await annotate(page, 'a', 'il n’y a pas tant de perfection', 'Concept');
  await annotate(page, 'a', 'de diviser chacune des difficultés', 'Exemple');
  const pages = await page.evaluate((pid) => Object.fromEntries(window.__store.getState().highlights.filter((h) => h.bookId === pid).map((h) => [h.category, h.printedPage])), pid);
  check(pages.these === '11' && pages.argument === '11' && pages.concept === '12' && pages.exemple === '13', 'page imprimée proposée depuis la page-list', pages);

  // ── DRM
  console.log('\n== EPUB avec DRM ==');
  await importBuffer(page, 'drm.epub', await epubWithDrm());
  await page.waitForSelector('.reader-pane-body .empty', { timeout: 15000 });
  const drmMsg = await page.$eval('.reader-pane-body .empty', (e) => e.textContent);
  check(/DRM/.test(drmMsg) && /Importez une version sans DRM/.test(drmMsg), 'EPUB protégé : message explicite', drmMsg);

  check(!errors.some((e) => e.startsWith('pageerror')), 'aucune exception de page', errors.filter((e) => e.startsWith('pageerror')));
});

// ── DOCX, MD, TXT, HTML, TXT long ───────────────────────────

const OTHERS = [
  { file: 'fixtures/discours.docx', apos: '’', chapters: 4 },
  { file: 'fixtures/discours.md', apos: "'", chapters: 3 },
  { file: 'fixtures/premiere-partie.txt', apos: "'", chapters: 1 },
  { file: 'fixtures/discours.html', apos: '’', chapters: 4 },
];

if (process.env.ONLY_EPUB) {
  console.log(`\n${passes} vérifications réussies, ${failures} échec(s).`);
  process.exit(failures ? 1 : 0);
}
await withApp(PORT, async (page, errors) => {
  for (const f of OTHERS) {
    const ext = path.extname(f.file).slice(1).toUpperCase();
    console.log(`\n== ${ext} ==`);
    const id = await importFixture(page, f.file, { open: true });
    await waitReady(page);
    const info = await page.evaluate(() => ({
      n: document.querySelectorAll('.reader-page[data-pane="a"] .html-chapter-text').length,
      toc: [...document.querySelectorAll('.reader-toc .toc-label')].map((e) => e.textContent),
    }));
    check(info.n === f.chapters, `${ext} : découpe en ${f.chapters} chapitre(s)`, info);
    if (ext !== 'TXT') check(info.toc.includes('Première partie') && info.toc.includes('Des études'), `${ext} : sommaire depuis h1-h3`, info.toc);
    else check(info.toc.includes('Première partie'), 'TXT : titres détectés dans le sommaire', info.toc);
    const texts = await chapterTexts(page);
    check(!texts.join('').includes('title:'), `${ext} : pas de front matter ni de métadonnées dans le texte`);
    await annotate(page, 'a', 'Le bon sens est la chose du monde la mieux partagée', 'Thèse');
    await annotate(page, 'a', 'la puissance de bien juger et distinguer le vrai', 'note');
    await annotate(page, 'a', `ceux même qui sont les plus difficiles à contenter`, 'Argument');
    await annotate(page, 'a', `Les plus grandes âmes sont capables des plus grands vices`, 'movement');
    let v = await verifyHighlights(page, id);
    check(allOk(v) && v.length === 3, `${ext} : rendu exact`, v.filter((x) => !x.ok));
    const hs = await page.evaluate((id) => window.__store.getState().highlights.filter((h) => h.bookId === id), id);
    check(hs.some((h) => h.category === null), `${ext} : note category:null`);
    await reload(page, id);
    v = await verifyHighlights(page, id);
    check(allOk(v) && v.length === 3, `${ext} : ré-ancrage exact après rechargement`, v.filter((x) => !x.ok));
    check((await page.$$('.reader-page[data-pane="a"] .html-mv')).length === 1, `${ext} : repère de mouvement`);
    await page.evaluate(() => window.__store.getState().updateSettings({ showConnectors: true }));
    await page.waitForTimeout(250);
    v = await verifyHighlights(page, id);
    check(allOk(v) && (await page.$$('.connector')).length > 0, `${ext} : connecteurs sans fausser les ancrages`, v.filter((x) => !x.ok));
    await page.evaluate(() => window.__store.getState().updateSettings({ showConnectors: false }));
    if (ext === 'MD') await cleanShot(page, 'shots/html/md-clair.png');
    if (ext === 'DOCX') await cleanShot(page, 'shots/html/docx-clair.png');
  }

  console.log('\n== TXT long ==');
  const lid = await importBuffer(page, 'long.txt', longTxt());
  await waitReady(page);
  const parts = await page.evaluate(() => [...document.querySelectorAll('.reader-page[data-pane="a"] .html-chapter-text')].map((r) => r.textContent.length));
  check(parts.length >= 3 && parts.slice(0, -1).every((n) => n > 38000 && n < 46000), 'TXT long : parties d’environ 40 000 caractères', parts);
  await page.click('.reader-toc .toc-item >> nth=-1').catch(() => {});
  await page.waitForTimeout(800); // laisser finir le glissé du sommaire
  await page.evaluate(() => {
    const sc = document.querySelector('.reader-page[data-pane="a"] .html-scroll');
    sc.scrollTop = sc.scrollHeight;
  });
  await page.waitForTimeout(500);
  await annotate(page, 'a', 'Dernière phrase unique du long texte.', 'Concept');
  await reload(page, lid);
  const vl = await verifyHighlights(page, lid);
  check(allOk(vl), 'TXT long : ré-ancrage exact dans la dernière partie', vl);
  const lastPos = await page.evaluate((id) => window.__store.getState().books.find((b) => b.id === id).position, lid);
  check(lastPos?.chapter === parts.length - 1, 'TXT long : position restaurée dans la dernière partie', lastPos);
  check(!errors.some((e) => e.startsWith('pageerror')), 'aucune exception de page', errors.filter((e) => e.startsWith('pageerror')));
});

// ── Captures sombres ────────────────────────────────────────

await withApp(
  PORT,
  async (page) => {
    console.log('\n== Thème sombre ==');
    const id = await importFixture(page, 'fixtures/discours.epub', { open: true });
    await waitReady(page);
    await annotate(page, 'a', 'Le bon sens est la chose du monde la mieux partagée', 'Thèse');
    await annotate(page, 'a', 'la mieux partagée ; car chacun pense', 'Argument');
    await annotate(page, 'a', 'la puissance de bien juger et distinguer le vrai d’avec le faux', 'note');
    await annotate(page, 'a', 'Et ainsi la diversité de nos opinions ne vient pas', 'movement');
    await page.evaluate(() => window.__store.getState().updateSettings({ showConnectors: true }));
    await page.waitForTimeout(300);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    check(theme === 'dark', 'thème sombre actif', theme);
    await cleanShot(page, 'shots/html/epub-sombre.png');
    await page.evaluate((id) => window.__store.getState().openBook(id, id), id);
    await waitReady(page, 'a');
    await waitReady(page, 'b');
    await cleanShot(page, 'shots/html/epub-cote-a-cote-sombre.png');
    await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'sepia', showConnectors: false }));
    await page.waitForTimeout(300);
    await cleanShot(page, 'shots/html/epub-cote-a-cote-sepia.png');
  },
  { dark: true },
);

console.log(`\n${passes} vérifications réussies, ${failures} échec(s).`);
process.exit(failures ? 1 : 0);
