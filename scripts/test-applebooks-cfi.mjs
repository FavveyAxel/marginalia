// Test unitaire : EPUB CFI (Livres) → ancrage Marginalia, sur fixtures/discours.epub.
// Les CFI sont fabriqués à partir du vrai contenu XHTML (comme Livres les écrit), puis résolus
// par src/features/library/appleBooksCfi.ts dans Chromium (DOMParser, DOMPurify). Port 5341.
// Lancer : node scripts/test-applebooks-cfi.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5341;
let failed = 0;
const ok = (c, m, d = '') => {
  if (!c) failed++;
  console.log(`${c ? 'OK   ' : 'ÉCHEC'} ${m}${d ? ' — ' + d : ''}`);
};

const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  const b64 = fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')).toString('base64');
  const EPUB = path.join(ROOT, 'fixtures/discours.epub');
  const files = Object.fromEntries(['EPUB/content.opf', 'EPUB/text/ch001.xhtml', 'EPUB/text/ch002.xhtml', 'EPUB/text/ch003.xhtml'].map((f) => [f, execFileSync('unzip', ['-p', EPUB, f]).toString('utf8')]));
  const r = await page.evaluate(async ({ b64, files }) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    const { parseBook } = await import('/src/features/reader/html/parse.ts');
    const cfi = await import('/src/features/library/appleBooksCfi.ts');
    const { fold } = await import('/src/features/reader/html/anchoring.ts');
    const book = { id: 'x', title: 'Discours', author: '', format: 'epub', fileName: 'source.epub', originalName: 'd.epub', size: 0, addedAt: 0, lastOpenedAt: null, progress: 0, position: null, cover: null, edition: {} };
    const parsed = await parseBook(book, data);
    const ctx = await cfi.loadCfiContext(data, parsed.chapters);
    const opf = new DOMParser().parseFromString(files['EPUB/content.opf'], 'application/xml');
    const refs = [...opf.getElementsByTagNameNS('*', 'itemref')];
    const out = { cases: [], chapters: parsed.chapters.map((c) => c.path) };
    const F = (s) => fold(s).text.trim();

    // Générateur de CFI (même convention que Livres) pour un point (nœud texte, décalage).
    const elIndex = (el) => 2 * ([...el.parentNode.childNodes].filter((n) => n.nodeType === 1).indexOf(el) + 1);
    const elPath = (el) => {
      const steps = [];
      for (let e = el; e && e !== e.ownerDocument.documentElement; e = e.parentNode) steps.unshift(`/${elIndex(e)}${e.getAttribute('id') ? `[${e.getAttribute('id')}]` : ''}`);
      return steps.join('');
    };
    const textStep = (t, off) => {
      const sibs = [...t.parentNode.childNodes];
      const i = sibs.indexOf(t);
      const k = sibs.slice(0, i).filter((n) => n.nodeType === 1).length;
      let before = 0;
      for (let j = i - 1; j >= 0 && sibs[j].nodeType !== 1; j--) if (sibs[j].nodeType === 3) before += sibs[j].data.length;
      return `/${2 * k + 1}:${before + off}`;
    };
    // Petit générateur pseudo-aléatoire déterministe.
    let seed = 7;
    const rnd = (n) => ((seed = (seed * 48271) % 2147483647), seed % n);

    for (let si = 0; si < refs.length; si++) {
      const idref = refs[si].getAttribute('idref');
      if (!/^ch00/.test(idref)) continue;
      const href = opf.querySelector(`item[id="${idref}"]`).getAttribute('href');
      const src = files['EPUB/' + href];
      const doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
      const texts = [];
      const w = doc.createTreeWalker(doc.getElementsByTagName('body')[0], NodeFilter.SHOW_TEXT);
      while (w.nextNode()) if (w.currentNode.data.trim().length > 25) texts.push(w.currentNode);
      const pkg = `/6/${2 * (si + 1)}[${idref}]!`;
      for (let n = 0; n < 12 && texts.length; n++) {
        // Plage dans un nœud, ou à cheval sur deux paragraphes.
        const t1 = texts[rnd(texts.length)];
        const across = n % 4 === 3;
        let t2 = across ? (texts[texts.indexOf(t1) + 1] ?? t1) : t1;
        // Plage à cheval : seulement entre deux frères (chemin commun = parent commun).
        if (t2 !== t1 && t2.parentNode.parentNode !== t1.parentNode.parentNode) t2 = t1;
        const a = rnd(Math.max(1, t1.data.length - 20));
        const b = t2 === t1 ? a + 5 + rnd(Math.max(1, t1.data.length - a - 5)) : 3 + rnd(t2.data.length - 3);
        const range = doc.createRange();
        range.setStart(t1, a);
        range.setEnd(t2, b);
        const quote = range.toString();
        if (!quote.trim()) continue;
        // Forme de Livres : chemin commun + deux chemins locaux.
        let cfiStr;
        if (t1 === t2) cfiStr = `epubcfi(${pkg}${elPath(t1.parentNode)}${textStep(t1, 0).replace(/:\d+$/, '')},:${textStep(t1, a).split(':')[1]},:${textStep(t1, b).split(':')[1]})`;
        else cfiStr = `epubcfi(${pkg}${elPath(t1.parentNode.parentNode)},${elPath(t1.parentNode).slice(elPath(t1.parentNode.parentNode).length)}${textStep(t1, a)},${elPath(t2.parentNode).slice(elPath(t2.parentNode.parentNode).length)}${textStep(t2, b)})`;
        const span = await cfi.resolveCfiRange(ctx, cfiStr, quote);
        const got = span ? parsed.chapters[span.chapter].text.slice(span.start, span.end) : null;
        out.cases.push({ cfi: cfiStr, quote: quote.slice(0, 50), ok: !!span && F(got) === F(quote), method: span?.method, chapterOk: !!span && parsed.chapters[span.chapter].path === 'EPUB/' + href });
      }
    }
    // Cas écrits à la main sur la Seconde partie (ch002) : « Le second, de diviser… ».
    const sec = 'Le second, de diviser chacune des difficultés';
    const hand = await cfi.resolveCfiRange(ctx, `epubcfi(/6/10[ch002_xhtml]!/4/2/8/6,/1:0,/1:${sec.length})`, sec);
    out.hand = hand && parsed.chapters[hand.chapter].text.slice(hand.start, hand.end);
    out.handMethod = hand?.method;
    // Index de spine faux mais assertion juste : l'assertion l'emporte.
    const asrt = await cfi.resolveCfiRange(ctx, `epubcfi(/6/99[ch002_xhtml]!/4/2/8/6,/1:0,/1:${sec.length})`, sec);
    out.assert = asrt && parsed.chapters[asrt.chapter].text.slice(asrt.start, asrt.end);
    // CFI décalé (édition différente) : repli sur le texte dans le chapitre visé.
    const shifted = await cfi.resolveCfiRange(ctx, `epubcfi(/6/10[ch002_xhtml]!/4/2/8/4,/1:10,/1:40)`, sec);
    out.shifted = shifted && { text: parsed.chapters[shifted.chapter].text.slice(shifted.start, shifted.end), method: shifted.method };
    // Typographie différente dans Livres (apostrophe droite, espaces multiples) : repli tolérant.
    const typo = "J'étais  alors en Allemagne, où l'occasion des guerres";
    const ty = await cfi.resolveCfiRange(ctx, `epubcfi(/6/10[ch002_xhtml]!/4/2/4,/1:0,/1:53)`, typo);
    out.typo = ty && { text: parsed.chapters[ty.chapter].text.slice(ty.start, ty.end), method: ty.method };
    // Texte absent du livre : introuvable (null), jamais un ancrage faux.
    out.absent = await cfi.resolveCfiRange(ctx, `epubcfi(/6/10[ch002_xhtml]!/4/2/8/6,/1:0,/1:20)`, 'Ce passage n’existe nulle part dans ce livre.');
    // CFI illisible + texte court ambigu : introuvable.
    out.garbage = await cfi.resolveCfiRange(ctx, 'epubcfi(n’importe quoi)', 'de');
    // Point (signet / position) : début du paragraphe.
    const pt = await cfi.resolveCfiPoint(ctx, `epubcfi(/6/10[ch002_xhtml]!/4/2/8/6/1:0)`);
    out.point = pt && parsed.chapters[pt.chapter].text.slice(pt.offset, pt.offset + 20);
    const pt2 = await cfi.resolveCfiPoint(ctx, `epubcfi(/6/10[ch002_xhtml]!)`);
    out.point2 = pt2 && { chapter: parsed.chapters[pt2.chapter].path, offset: pt2.offset };
    return out;
  }, { b64, files });
  const good = r.cases.filter((c) => c.ok && c.method === 'cfi' && c.chapterOk);
  ok(r.cases.length >= 30 && good.length === r.cases.length, `CFI générés résolus exactement par le CFI : ${good.length}/${r.cases.length}`);
  for (const c of r.cases.filter((c) => !(c.ok && c.method === 'cfi'))) console.log('   ', JSON.stringify(c));
  ok(r.hand === 'Le second, de diviser chacune des difficultés' && r.handMethod === 'cfi', 'CFI écrit à la main (plage /1:0,/1:N)', r.hand);
  ok(r.assert === 'Le second, de diviser chacune des difficultés', 'assertion d’itemref prioritaire sur un index faux', r.assert);
  ok(r.shifted?.text === 'Le second, de diviser chacune des difficultés' && r.shifted.method === 'texte-chapitre', 'CFI décalé : texte retrouvé dans le chapitre', JSON.stringify(r.shifted));
  ok(r.typo?.text === 'J’étais alors en Allemagne, où l’occasion des guerres', 'typographie différente (apostrophes, espaces) : comparaison tolérante', JSON.stringify(r.typo));
  ok(r.absent === null, 'texte absent : introuvable (pas d’ancrage)');
  ok(r.garbage === null, 'CFI illisible et texte ambigu : introuvable');
  ok(r.point === 'Le second, de divise', 'point CFI → début du paragraphe', r.point);
  ok(r.point2?.chapter === 'EPUB/text/ch002.xhtml' && r.point2.offset === 0, 'CFI sans chemin de contenu → début du chapitre', JSON.stringify(r.point2));
  ok(!errors.length, 'aucune erreur dans la page', errors.join(' | '));
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
