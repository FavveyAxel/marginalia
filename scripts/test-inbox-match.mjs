// Test de la recherche de passage de la boîte de dépôt (src/features/inbox/match.ts) — port 5291.
// Lancer : timeout 300 node scripts/test-inbox-match.mjs
import fs from 'node:fs';
import path from 'node:path';
import { withApp } from './harness.mjs';
import { epubLong, importBuffer, para, xhtml, zipEpub } from './fixtures-books.mjs';

const PORT = 5291;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let failed = 0;
let passed = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${extra !== '' ? ' — ' + extra : ''}`);
  if (cond) passed++;
  else failed++;
};

// ── Fixtures ─────────────────────────────────────────────────

// Fragments de Pascal (domaine public) : vocabulaire distinct des autres livres de test.
const PASCAL = [
  'L’homme n’est qu’un roseau, le plus faible de la nature ; mais c’est un roseau pensant. Il ne faut pas que l’univers entier s’arme pour l’écraser : une vapeur, une goutte d’eau, suffit pour le tuer.',
  'Mais, quand l’univers l’écraserait, l’homme serait encore plus noble que ce qui le tue, puisqu’il sait qu’il meurt, et l’avantage que l’univers a sur lui ; l’univers n’en sait rien.',
  'Toute notre dignité consiste donc en la pensée. C’est de là qu’il nous faut relever et non de l’espace et de la durée, que nous ne saurions remplir. Travaillons donc à bien penser : voilà le principe de la morale.',
  'Le cœur a ses raisons, que la raison ne connaît point ; on le sait en mille choses. Je dis que le cœur aime l’être universel naturellement, et soi-même naturellement, selon qu’il s’y adonne ; et il se durcit contre l’un ou l’autre à son choix.',
  'Le silence éternel de ces espaces infinis m’effraie. Quand je considère la petite durée de ma vie, absorbée dans l’éternité précédant et suivant, le petit espace que je remplis, et même que je vois, abîmé dans l’infinie immensité des espaces que j’ignore et qui m’ignorent, je m’effraie et m’étonne de me voir ici plutôt que là.',
  'Qu’est-ce que l’homme dans la nature ? Un néant à l’égard de l’infini, un tout à l’égard du néant, un milieu entre rien et tout. Infiniment éloigné de comprendre les extrêmes, la fin des choses et leur principe sont pour lui invinciblement cachés dans un secret impénétrable.',
  'La philosophie n’est pas une science qui se laisse enseigner comme les autres ; elle suppose une conversion du regard, et chacun doit refaire pour son compte le chemin que les maîtres ont parcouru avant lui.',
];
const pb = (id, label) => `<span epub:type="pagebreak" id="${id}" title="${label}"></span>`;

async function epubPascal() {
  const ch1 = xhtml('Misère', `${pb('p1', '1')}<h1>Misère de l’homme</h1><p>${para('Ouverture du recueil', 900, 3)}</p><p>${PASCAL[0]} ${PASCAL[1]}</p>${pb('p2', '2')}<p>${PASCAL[2]}</p>`);
  const ch2 = xhtml('Grandeur', `${pb('p3', '3')}<h1>Grandeur de l’homme</h1><p>${PASCAL[3]}</p><p>${para('Transition', 700, 5)}</p>${pb('p4', '4')}<p>${PASCAL[4]}</p><p>${PASCAL[5]}</p>`);
  const ch3 = xhtml('Méthode', `${pb('p5', '5')}<h1>De la méthode</h1><p>${PASCAL[6]}</p><p>${para('Conclusion', 1200, 8)}</p>`);
  const plist = [['ch1.xhtml#p1', '1'], ['ch1.xhtml#p2', '2'], ['ch2.xhtml#p3', '3'], ['ch2.xhtml#p4', '4'], ['ch3.xhtml#p5', '5']];
  const nav = xhtml(
    'Sommaire',
    `<nav epub:type="toc"><ol><li><a href="ch1.xhtml">Misère de l’homme</a></li><li><a href="ch2.xhtml">Grandeur de l’homme</a></li><li><a href="ch3.xhtml">De la méthode</a></li></ol></nav>` +
      `<nav epub:type="page-list" hidden="hidden"><ol>${plist.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ol></nav>`,
  );
  return zipEpub('Pensées', { 'ch1.xhtml': ch1, 'ch2.xhtml': ch2, 'ch3.xhtml': ch3 }, nav, { author: 'Blaise Pascal' });
}

// PDF « livre » : N pages de texte (Helvetica 11, WinAnsi), passage unique page 7 avec une césure.
const WIN = { '’': "'", 'œ': '\\234', '«': '\\253', '»': '\\273' };
function pdfStr(s) {
  let out = '';
  for (const ch of s) {
    if (WIN[ch]) out += WIN[ch];
    else if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else {
      const c = ch.charCodeAt(0);
      out += c > 126 ? '\\' + c.toString(8).padStart(3, '0') : ch;
    }
  }
  return out;
}
function wrap(text, width = 88) {
  const lines = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    if (cur && cur.length + 1 + w.length > width) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}
const PDF_PASSAGE_LINES = [
  'Il faut donc, avant toute chose, apprendre à douter de ce que les maîtres nous ont transmis sans',
  'preuve ; car la philo-',
  'sophie commence là où cesse la docilité, et nul ne pense vraiment qui n’a jamais accepté de se',
  'trouver seul devant une question dont il ignore encore jusqu’à la forme de la réponse.',
];
function pdfBook(nPages = 150) {
  const objs = [];
  const pageIds = [];
  for (let i = 0; i < nPages; i++) pageIds.push(4 + i * 2);
  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${nPages} >>`;
  objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  for (let i = 0; i < nPages; i++) {
    let lines = [`TRAITÉ DU DOUTE ${i + 1}`, ''];
    if (i === 6) lines.push(...wrap(para('Chapitre sept', 600, i)), ...PDF_PASSAGE_LINES, ...wrap(para('Suite', 1400, i + 3)));
    else lines.push(...wrap(para(`Page ${i + 1}`, 3200, i)));
    lines = lines.slice(0, 52);
    let y = 790;
    const ops = lines.map((l) => {
      const s = `BT /F1 11 Tf 56 ${y} Td (${pdfStr(l)}) Tj ET`;
      y -= 14;
      return s;
    });
    const content = ops.join('\n');
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objs[5 + i * 2] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
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

/** Bruit « OCR » : accents retirés, lettres fausses, retours à la ligne avec césures, numéro de page, titre courant. */
function ocrNoise(s) {
  let t = s.normalize('NFD').replace(/\p{M}/gu, '');
  t = t.replace('roseau, le plus', 'roseau, le pluz').replace('nature ;', 'naturc ;').replace('univers entier', 'univers cntier').replace('goutte', 'gouttc');
  t = t.replace('pensant.', 'pen-\nsant.').replace('l’écraser', 'l’écra-\nser').replace('l’ecraser', 'l’ecra-\nser');
  t = t.replace(' Il ne faut', '\n127\nIl ne faut').replace(' suffit', '\nsuffit');
  return 'PENSEES DE PASCAL\n' + t.replace(/’/g, "'") + '\n';
}

// ── Test ─────────────────────────────────────────────────────

await withApp(PORT, async (page) => {
  // Bibliothèque
  const ids = {};
  ids.pascal = await importBuffer(page, 'pensees.epub', await epubPascal(), false);
  ids.discEpub = await importBuffer(page, 'discours.epub', fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')), false);
  ids.discPdf = await importBuffer(page, 'discours.pdf', fs.readFileSync(path.join(ROOT, 'fixtures/discours.pdf')), false);
  ids.pdfBook = await importBuffer(page, 'traite-du-doute.pdf', pdfBook(150), false);
  ids.long = await importBuffer(page, 'passions.epub', await epubLong(), false);
  ids.image = await importBuffer(page, 'photo-page.png', fs.readFileSync(path.join(ROOT, 'fixtures/cover.png')), false);
  ok(Object.values(ids).every(Boolean), 'import des 6 livres', JSON.stringify(ids));
  const fmt = await page.evaluate((id) => window.__store.getState().books.find((b) => b.id === id)?.format, ids.image);
  ok(fmt === 'image', 'livre image importé', fmt);

  // OCR synthétique pour le livre image (mots + boîtes normalisées).
  const IMG_TEXT = ['Le doute n’est pas un état', 'agréable, mais la certitude est', 'un état absurde, disait Voltaire', 'dans une lettre à Frédéric.'];
  await page.evaluate(
    async ({ id, lines }) => {
      const { host } = await import('/src/lib/platform.ts');
      const paras = [{ lines: lines.map((l, li) => {
        let x = 0.1;
        return { words: l.split(' ').map((t) => { const w = { t, x, y: 0.2 + li * 0.05, w: t.length * 0.012, h: 0.03, c: 90 }; x += t.length * 0.012 + 0.01; return w; }) };
      }) }];
      const data = { v: 1, engine: 'test', langs: 'fra', width: 1000, height: 1400, paras, confidence: 90, ms: 1, createdAt: Date.now() };
      const bytes = new TextEncoder().encode(JSON.stringify(data));
      await host.storeFile(id, 'ocr.json', bytes.buffer);
    },
    { id: ids.image, lines: IMG_TEXT },
  );

  // Outil : lancer findPassage dans la page.
  const find = (text, opts = {}) =>
    page.evaluate(
      async ({ text, opts }) => {
        const m = await import('/src/features/inbox/match.ts');
        const t0 = performance.now();
        const res = await m.findPassage(text, opts);
        return { res, ms: Math.round(performance.now() - t0) };
      },
      { text, opts },
    );
  /** Texte de chapitre (référence des offsets) du livre HTML. */
  const chapters = (bookId) =>
    page.evaluate(async (bookId) => {
      const { parseBook } = await import('/src/features/reader/html/parse.ts');
      const { host } = await import('/src/lib/platform.ts');
      const book = window.__store.getState().books.find((b) => b.id === bookId);
      const parsed = await parseBook(book, await host.readFile(book.id, book.fileName));
      return parsed.chapters.map((c) => ({ text: c.text, label: c.label }));
    }, bookId);

  // ── Perf : construction des index ──
  const perf = {};
  for (const [k, id] of [['epubLong', ids.long], ['pdf150', ids.pdfBook], ['pascal', ids.pascal]]) {
    const r = await find('texte qui ne sert qu’à construire l’index du livre pour mesurer le temps', { bookIds: [id] });
    perf[k] = r.ms;
  }

  // 1. Passage exact dans un EPUB
  const P = PASCAL[0];
  const ch = await chapters(ids.pascal);
  const ci = ch.findIndex((c) => c.text.includes(P));
  const cs = ch[ci].text.indexOf(P);
  let r = await find(P);
  perf.searchAll = r.ms;
  let m = r.res[0];
  ok(r.res.length === 1, 'exact EPUB : une seule correspondance', r.res.map((x) => x.bookId + ':' + x.score).join(', '));
  ok(m?.bookId === ids.pascal && m.anchor.kind === 'html', 'exact EPUB : bon livre');
  ok(m?.anchor.chapter === ci && m.anchor.start === cs && m.anchor.end === cs + P.length, 'exact EPUB : offsets exacts', m && `${m.anchor.chapter}:${m.anchor.start}-${m.anchor.end} attendu ${ci}:${cs}-${cs + P.length}`);
  ok(m?.text === P, 'exact EPUB : texte du livre');
  ok(m?.score === 1, 'exact EPUB : score 1', m?.score);
  ok(m?.locationLabel === ch[ci].label && m.locationLabel, 'exact EPUB : libellé de chapitre', m?.locationLabel);
  ok(m?.printedPage === '1', 'exact EPUB : page imprimée', m?.printedPage);
  ok(m?.anchor.prefix === ch[ci].text.slice(Math.max(0, cs - 32), cs) && m.anchor.suffix === ch[ci].text.slice(cs + P.length, cs + P.length + 32), 'exact EPUB : contexte prefix/suffix');

  // 2. Même passage bruité (OCR)
  const noisy = ocrNoise(P);
  r = await find(noisy);
  m = r.res[0];
  ok(r.res.length === 1 && m?.bookId === ids.pascal, 'OCR bruité : retrouvé', JSON.stringify(noisy));
  ok(m?.anchor.start === cs && m?.anchor.end === cs + P.length, 'OCR bruité : même étendue', m && `${m.anchor.start}-${m.anchor.end}`);
  ok(m && m.score >= 0.8 && m.score < 1, 'OCR bruité : score élevé mais < 1', m?.score);

  // 2b. Passage partiel, mots coupés aux bords, sans ponctuation
  const part = 'oute notre dignité consiste donc en la pensée. C’est de là qu’il nous faut relever et non de l’espace et de la du';
  r = await find(part);
  m = r.res[0];
  const P2 = 'Toute notre dignité consiste donc en la pensée. C’est de là qu’il nous faut relever et non de l’espace et de la durée';
  ok(m?.bookId === ids.pascal && m.text === P2, 'bords coupés : mots complétés', m?.text);

  // 2c. Passage à cheval sur deux paragraphes (même chapitre)
  const P3 = PASCAL[4].slice(-80) + ' ' + PASCAL[5].slice(0, 90);
  r = await find(P3);
  m = r.res[0];
  ok(m?.bookId === ids.pascal && /m’ignorent, je m’effraie[\s\S]*plutôt que là\.\n?Qu’est-ce que l’homme dans la nature \? Un néant/.test(m.text) && m.score >= 0.95, 'deux paragraphes : étendue sur les deux', JSON.stringify(m?.text) + ' ' + m?.score);

  // 3. PDF : page, rectangles, césure
  const pdfQuery = 'apprendre à douter de ce que les maîtres nous ont transmis sans preuve ; car la philosophie commence là où cesse la docilité, et nul ne pense vraiment';
  r = await find(pdfQuery);
  m = r.res.find((x) => x.bookId === ids.pdfBook);
  ok(r.res[0]?.bookId === ids.pdfBook, 'PDF : meilleur résultat', r.res.map((x) => x.bookId).join(','));
  ok(m?.anchor.kind === 'pdf' && m.anchor.page === 7, 'PDF : page 7', m?.anchor.page);
  const rects = m?.anchor.rects ?? [];
  ok(rects.length === 3 && rects.every((q) => q.x >= 0 && q.y >= 0 && q.w > 0 && q.h > 0 && q.x + q.w <= 1.0001 && q.y + q.h <= 1.0001), 'PDF : 3 rectangles (3 lignes) dans 0..1', JSON.stringify(rects));
  ok(m?.text?.includes('philosophie commence') && m.text.startsWith('apprendre') && m.text.endsWith('vraiment'), 'PDF : texte (césure recollée)', m?.text);
  ok(m?.locationLabel === 'p. 7' && m.printedPage === '7', 'PDF : libellé et page imprimée', `${m?.locationLabel} / ${m?.printedPage}`);
  // Décalage de pages de l'édition
  await page.evaluate((id) => window.__store.getState().updateBook?.(id, { edition: { ...window.__store.getState().books.find((b) => b.id === id).edition, pageOffset: 10 } }), ids.pdfBook);
  r = await find(pdfQuery, { bookIds: [ids.pdfBook] });
  ok(r.res[0]?.printedPage === '17', 'PDF : page imprimée avec décalage', r.res[0]?.printedPage);

  // 3b. PDF : rectangles comparés à ceux du lecteur (sélection réelle dans le calque de texte)
  await page.evaluate((id) => window.__store.getState().openBook(id), ids.discPdf);
  await page.waitForSelector('.pdf-page[data-page="1"] .textLayer[data-ready="1"]', { timeout: 20000 });
  const sel = await page.evaluate(async () => {
    const layer = document.querySelector('.pdf-page[data-page="1"] .textLayer');
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let all = '';
    let n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: all.length });
      all += n.data;
    }
    const at = (needle, end) => {
      const i = all.indexOf(needle);
      const off = end ? i + needle.length : i;
      for (let k = nodes.length - 1; k >= 0; k--) if (nodes[k].start <= off && off <= nodes[k].start + nodes[k].node.data.length) return { node: nodes[k].node, offset: off - nodes[k].start };
      return null;
    };
    const a = at('Et ainsi la diversité', false);
    const b = at('considérons pas les mêmes choses', true);
    const rg = document.createRange();
    rg.setStart(a.node, a.offset);
    rg.setEnd(b.node, b.offset);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(rg);
    const { readSelection } = await import('/src/features/reader/pdf/selection.ts');
    const out = readSelection(document.body);
    s.removeAllRanges();
    return out && { text: out.text, anchor: out.anchor };
  });
  ok(!!sel, 'lecteur PDF : sélection lue', sel?.text?.slice(0, 50));
  if (sel) {
    r = await find(sel.text, { bookIds: [ids.discPdf] });
    m = r.res[0];
    ok(m?.anchor.page === sel.anchor.page && m.text === sel.text, 'PDF : même page et même texte que la sélection du lecteur', m?.text?.slice(0, 50));
    const A = sel.anchor.rects;
    const B = m?.anchor.rects ?? [];
    const diffs = A.map((q, i) => (B[i] ? Math.max(Math.abs(q.x - B[i].x), Math.abs(q.y - B[i].y), Math.abs(q.x + q.w - B[i].x - B[i].w), Math.abs(q.y + q.h - B[i].y - B[i].h)) : 1));
    const maxDiff = Math.max(...diffs);
    ok(A.length === B.length && maxDiff < 0.012, 'PDF : rectangles ≈ ceux du lecteur (écart max < 1,2 % de page)', `lecteur ${A.length}, boîte ${B.length}, écart max ${maxDiff.toFixed(4)}`);
    console.log('   lecteur :', JSON.stringify(A));
    console.log('   boîte   :', JSON.stringify(B));
  }
  await page.evaluate(() => window.__store.getState().navigate?.({ name: 'library' }));

  // 3c. PDF : passage à cheval sur deux pages → ancré sur la page qui en porte le plus
  r = await find('tant de perfection dans les ouvrages composés de plusieurs pièces, et faits de la main de divers maîtres, qu’en ceux auxquels un seul a travaillé. Les quatre préceptes Le premier était de ne recevoir', { bookIds: [ids.discPdf] });
  m = r.res[0];
  ok(m?.anchor.page === 1 && m.text.startsWith('tant de perfection') && /travaillé\.?$/.test(m.text) && m.score > 0.9, 'PDF deux pages : page 1, texte coupé à la fin de la page', `${m?.anchor.page} ${m?.score} ${JSON.stringify(m?.text)}`);

  // 4. Texte absent de la bibliothèque
  r = await find('La musique est une arithmétique secrète de l’âme, qui calcule sans savoir qu’elle calcule, disait Leibniz dans une lettre à Goldbach.');
  ok(r.res.length === 0, 'absent : aucune correspondance', JSON.stringify(r.res.map((x) => [x.bookId, x.score, x.text.slice(0, 40)])));
  r = await find('distincte et claire idée une volonté la jugement le raison la doute le méthodique'); // mots des remplissages, à rebours
  ok(r.res.length === 0, 'mots courants dans le désordre : rien', JSON.stringify(r.res.map((x) => [x.bookId, x.score])));

  // 5. Texte très court, présent dans deux livres
  r = await find('la puissance de bien juger');
  ok(r.res.length === 2 && new Set(r.res.map((x) => x.bookId)).size === 2 && r.res.every((x) => [ids.discEpub, ids.discPdf].includes(x.bookId)), 'court (5 mots) : un résultat par livre (EPUB et PDF)', r.res.map((x) => `${x.bookId}:${x.score}:${x.text}`).join(' | '));
  ok(r.res.every((x) => x.text.toLowerCase().includes('puissance de bien juger')), 'court : texte exact', r.res.map((x) => x.text).join(' | '));
  r = await find('la puissanse de bien juger');
  ok(r.res.length === 0, 'court avec faute : exact exigé → rien');
  r = await find('raison');
  ok(r.res.length === 0, 'un seul mot : rien');

  // 6. bookIds restreint la recherche
  r = await find('la puissance de bien juger', { bookIds: [ids.discEpub] });
  ok(r.res.length === 1 && r.res[0].bookId === ids.discEpub, 'bookIds : seulement le livre demandé');
  r = await find(P, { bookIds: [ids.discEpub] });
  ok(r.res.length === 0, 'bookIds : passage d’un autre livre → rien');

  // 7. Livre image (OCR)
  r = await find('Le doute n’est pas un état agréable, mais la certitude est un état absurde');
  m = r.res[0];
  ok(m?.bookId === ids.image && m.anchor.kind === 'pdf' && m.anchor.page === 1, 'image : retrouvée (page 1)', m?.bookId);
  ok(m?.anchor.rects.length === 3 && m.anchor.rects.every((q) => q.x >= 0 && q.y >= 0 && q.x + q.w <= 1 && q.y + q.h <= 1), 'image : 3 rectangles (3 lignes)', JSON.stringify(m?.anchor.rects));
  ok(m?.text === 'Le doute n’est pas un état agréable, mais la certitude est un état absurde' && m.locationLabel === 'Image', 'image : texte et libellé', m?.text);

  // 8. Interruption
  const aborted = await page.evaluate(async () => {
    const m = await import('/src/features/inbox/match.ts');
    m.forgetIndex();
    const ac = new AbortController();
    const p = m.findPassage('Le cœur a ses raisons, que la raison ne connaît point ; on le sait en mille choses.', { signal: ac.signal });
    setTimeout(() => ac.abort(), 30);
    try {
      await p;
      return 'terminé';
    } catch (e) {
      return e.name;
    }
  });
  ok(aborted === 'AbortError', 'signal : interruption', aborted);

  // 9. Index reconstruit après forgetIndex, puis recherche « à chaud »
  r = await find(PASCAL[3]);
  const cold = r.ms;
  ok(r.res[0]?.bookId === ids.pascal, 'après forgetIndex : retrouvé');
  r = await find(PASCAL[3]);
  perf.searchWarm = r.ms;
  perf.searchColdAll = cold;
  ok(r.res[0]?.bookId === ids.pascal, 'recherche à chaud');

  console.log('\nPerf (ms) :', JSON.stringify(perf));
});

console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
