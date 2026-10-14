// Test Bibliothèque : métadonnées des fixtures, captures (vide / grille / liste / menu / infos, clair + sombre),
// export Markdown sur données injectées. Usage : timeout 170 node scripts/test-lib.mjs
import { withApp, importFixture, shot } from './harness.mjs';
import fs from 'node:fs';

const PORT = 5204;
const FIXTURES = ['discours.epub', 'discours.pdf', 'discours.docx', 'discours.md', 'discours.html', 'premiere-partie.txt'];
let failures = 0;
const check = (ok, msg) => {
  console.log((ok ? 'OK   ' : 'ÉCHEC') + ' ' + msg);
  if (!ok) failures++;
};

async function importAll(page) {
  const rows = [];
  for (const f of FIXTURES) {
    const id = await importFixture(page, 'fixtures/' + f);
    const b = await page.evaluate((id) => {
      const b = window.__store.getState().books.find((x) => x.id === id);
      return b && { ...b, cover: b.cover ? b.cover.slice(0, 22) + '…(' + b.cover.length + ' car.)' : null };
    }, id);
    rows.push(b);
    console.log(
      `${f.padEnd(24)} → titre « ${b?.title} » | auteur « ${b?.author} » | format ${b?.format} | couverture ${b?.cover ?? 'aucune'} | édition ${JSON.stringify(b?.edition)}`,
    );
  }
  return rows;
}

async function seed(page) {
  // Données de test injectées via le store : progression, extraits, espace, concept, fiche, carte, argument.
  return page.evaluate(() => {
    const s = window.__store.getState();
    const [epub, pdf, docx, md, html, txt] = ['epub', 'pdf', 'docx', 'md', 'html', 'txt'].map((f) => s.books.find((b) => b.format === f));
    const now = Date.now();
    s.updateBook(epub.id, { progress: 0.42, lastOpenedAt: now - 3600e3, edition: { publisher: 'GF Flammarion', year: '2000', translator: '', place: 'Paris', pageOffset: 0 } });
    s.updateBook(pdf.id, { progress: 0.1, lastOpenedAt: now - 86400e3 * 2, edition: { ...pdf.edition, pageOffset: -8 } });
    s.updateBook(docx.id, { progress: 0.8 });
    // Un livre sans couverture ni auteur pour montrer les couvertures typographiques
    s.updateBook(md.id, { cover: null });
    s.updateBook(html.id, { cover: null, author: '' });
    const ws = s.createWorkspace('Terminale — Le sujet');
    s.createWorkspace('Dissertation : la raison');
    const mk = (b, category, text, extra = {}) =>
      s.addHighlight({
        bookId: b.id,
        category,
        text,
        anchor: { kind: 'html', chapter: 2, start: 100, end: 100 + text.length, prefix: '', suffix: '' },
        locationLabel: 'Seconde partie',
        ...extra,
      });
    const c1 = s.addConcept('Bon sens', 'La puissance de bien juger, égale en tous les hommes.');
    const h2 = mk(epub, 'these', 'La puissance de bien juger et distinguer le vrai d’avec le faux est naturellement égale en tous les hommes.', {
      printedPage: '3', note: 'Thèse égalitaire : la raison n’est pas distribuée inégalement.', noteKind: 'reformulation', conceptIds: [c1.id],
    });
    const h1 = mk(epub, 'probleme', 'Le bon sens est la chose du monde la mieux partagée.', {
      anchor: { kind: 'html', chapter: 1, start: 10, end: 70, prefix: '', suffix: '' }, locationLabel: 'Première partie', printedPage: '1',
    });
    const h3 = mk(epub, 'argument', 'Chacun pense en être si bien pourvu que ceux même qui sont les plus difficiles à contenter n’en désirent point plus.', {
      anchor: { kind: 'html', chapter: 1, start: 80, end: 190, prefix: '', suffix: '' }, locationLabel: 'Première partie', printedPage: '2',
    });
    const h4 = mk(epub, null, 'ce qu’on nomme le bon sens ou la raison', {
      anchor: { kind: 'html', chapter: 2, start: 400, end: 440, prefix: '', suffix: '' }, note: 'Identité posée : bon sens = raison. À rapprocher de Spinoza ?', noteKind: 'question',
    });
    const h5 = mk(epub, 'objection', 'Que tous se trompent', {
      anchor: { kind: 'html', chapter: 1, start: 60, end: 80, prefix: '', suffix: '' }, locationLabel: 'Première partie', printedPage: '1',
    });
    s.addHighlight({ bookId: pdf.id, category: 'exemple', text: 'Un exemple tiré du PDF, page 3.', anchor: { kind: 'pdf', page: 3, rects: [{ x: 0.1, y: 0.4, w: 0.5, h: 0.03 }] }, locationLabel: 'p. 3', printedPage: '' });
    s.addHighlight({ bookId: pdf.id, category: 'these', text: 'Une thèse en haut de la page 3.', anchor: { kind: 'pdf', page: 3, rects: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.03 }] }, locationLabel: 'p. 3', printedPage: '' });
    s.updateConcept(c1.id, {
      senses: [{ id: 'sn1', author: 'René Descartes', bookId: epub.id, definition: 'Faculté de juger et de distinguer le vrai du faux.', highlightIds: [h2.id] }],
    });
    const c2 = s.addConcept('Raison', 'Faculté de connaître par principes.');
    s.updateConcept(c1.id, { links: [{ conceptId: c2.id, kind: 'proche', note: 'Descartes les identifie.' }] });
    s.insert('studies', { id: 'st1', bookId: epub.id, title: 'Première partie, le bon sens', probleme: 'La raison est-elle également partagée ?', these: 'Oui : la diversité des opinions vient de l’usage, non de la faculté.', enjeu: 'Fonder la méthode sur une égalité de droit.', movements: [
      { id: 'm1', anchor: h1.anchor, startText: 'Le bon sens est la chose du monde la mieux partagée', title: 'Thèse de l’égalité', role: 'pose la thèse' },
      { id: 'm2', anchor: h3.anchor, startText: 'Et ainsi la diversité de nos opinions', title: 'Cause de la diversité', role: 'répond à l’objection' } ], createdAt: now, updatedAt: now });
    const n = (id, hl, x) => ({ id, highlightId: hl, text: '', x, y: 0 });
    s.setMap(epub.id, { bookId: epub.id, viewport: null,
      nodes: [n('n1', h1.id, 0), n('n2', h3.id, 300), n('n3', h2.id, 600), n('n4', h5.id, 900)],
      edges: [
        { id: 'e1', source: 'n2', target: 'n3', relation: 'soutient', groupId: 'g1' },
        { id: 'e2', source: 'n1', target: 'n3', relation: 'soutient', groupId: 'g1' },
        { id: 'e3', source: 'n4', target: 'n3', relation: 'objecte', groupId: null } ] });
    s.insert('arguments', { id: 'a1', title: 'L’égalité de la raison', bookId: epub.id, premises: [
      { id: 'p1', text: 'Chacun pense être suffisamment pourvu de bon sens.', highlightId: h3.id, implicit: false },
      { id: 'p2', text: 'Nul ne se plaint de manquer de ce dont il a assez.', highlightId: null, implicit: true } ],
      conclusion: { id: 'c', text: 'Le bon sens est également partagé.', highlightId: h2.id, implicit: false }, comment: 'Argument plutôt faible : un consensus ne prouve pas l’égalité.', createdAt: now, updatedAt: now });
    s.addToWorkspace(ws.id, null, 'book', epub.id);
    return { epub: epub.id, pdf: pdf.id };
  });
}

async function scenario(page, dark) {
  const tag = dark ? 'sombre' : 'clair';
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await page.waitForSelector('.lib-root');
  await page.evaluate(() => window.__store.setState({ toasts: [] }));
  await page.waitForTimeout(400);
  await shot(page, `shots/lib/grille-${tag}.png`);

  // Liste
  await page.click('button[aria-label="Liste"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__store.setState({ toasts: [] }));
  await shot(page, `shots/lib/liste-${tag}.png`);
  await page.click('button[aria-label="Grille"]');
  await page.waitForTimeout(150);

  // Menu contextuel (clic droit sur la première carte)
  await page.click('.lib-card >> nth=1', { button: 'right' });
  await page.waitForSelector('.lib-menu');
  await page.waitForTimeout(300);
  await shot(page, `shots/lib/menu-${tag}.png`);
  await page.click('.lib-menu >> text=Ajouter à un espace');
  await page.waitForTimeout(300);
  await shot(page, `shots/lib/menu-espaces-${tag}.png`);
  await page.keyboard.press('Escape');

  // Boîte « Infos et édition » (livre PDF pour voir le décalage)
  await page.click('.lib-card >> nth=1', { button: 'right' }); // PDF (décalage de pagination visible)
  await page.waitForSelector('.lib-menu');
  await page.click('.lib-menu >> text=Infos et édition');
  await page.waitForSelector('.lib-dialog');
  await page.waitForTimeout(300);
  await shot(page, `shots/lib/infos-${tag}.png`);
  await page.keyboard.press('Escape');

  // Confirmation de suppression
  await page.click('.lib-card >> nth=0', { button: 'right' });
  await page.click('.lib-menu >> text=Supprimer');
  await page.waitForSelector('.lib-dialog');
  await page.waitForTimeout(300);
  await shot(page, `shots/lib/suppression-${tag}.png`);
  await page.keyboard.press('Escape');

  // Recherche sans résultat + recherche valide
  await page.fill('.lib-search-input', 'spinoza');
  await page.waitForTimeout(150);
  check((await page.locator('.lib-card').count()) === 0, 'recherche « spinoza » : aucun résultat');
  await page.fill('.lib-search-input', 'descartes');
  await page.waitForTimeout(150);
  check((await page.locator('.lib-card').count()) >= 3, 'recherche « descartes » : au moins 3 livres');
  await page.fill('.lib-search-input', '');
  await page.click('.chip >> text=PDF');
  check((await page.locator('.lib-card').count()) === 1, 'filtre PDF : 1 livre');
  await page.click('.chip >> text=Tous');
}

// ── 1. bibliothèque vide + import des fixtures + export Markdown (clair) ──
await withApp(PORT, async (page) => {
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await page.waitForSelector('.lib-drop');
  await shot(page, 'shots/lib/vide-clair.png');

  const rows = await importAll(page);
  const epub = rows[0];
  check(epub.title === 'Discours de la méthode', 'EPUB : titre « Discours de la méthode »');
  check(epub.author === 'René Descartes', 'EPUB : auteur « René Descartes »');
  check(!!epub.cover && epub.cover.startsWith('data:image/jpeg'), 'EPUB : couverture JPEG data URL');
  check(rows[1].format === 'pdf' && rows[1].title.length > 0, `PDF : titre non vide (« ${rows[1].title} ») ; couverture ${rows[1].cover ? 'oui' : 'non'}`);
  check(rows[2].title === 'Discours de la méthode' && rows[2].author === 'René Descartes', 'DOCX : titre + auteur (core.xml)');
  check(rows[3].title === 'Discours de la méthode' && rows[3].author === 'René Descartes', 'MD : titre + auteur (front matter)');
  check(rows[4].author === 'René Descartes' && rows[4].title.includes('thode'), `HTML : <title> + meta author (« ${rows[4].title} »)`);
  check(rows[5].title === 'Premiere partie', `TXT : titre de secours embelli (« ${rows[5].title} »)`);

  // Hauteur des couvertures ≤ 600 px
  const heights = await page.evaluate(async () => {
    const out = [];
    for (const b of window.__store.getState().books) {
      if (!b.cover) continue;
      const img = new Image();
      img.src = b.cover;
      await img.decode();
      out.push([b.format, img.naturalWidth, img.naturalHeight]);
    }
    return out;
  });
  console.log('Couvertures (format, largeur, hauteur) :', JSON.stringify(heights));
  check(heights.every(([, , h]) => h <= 600), 'couvertures ≤ 600 px de haut');

  // Import d'un fichier corrompu : ne doit pas échouer
  const bad = await page.evaluate(async () => {
    const data = new TextEncoder().encode('pas un epub').buffer;
    const [b] = await window.__store.getState().importFiles([{ name: 'cassé.epub', data }]);
    return b && { title: b.title, author: b.author, cover: b.cover };
  });
  check(bad && bad.title === 'Cassé' && bad.cover === null, `EPUB corrompu : titre de secours « ${bad?.title} »`);
  await page.evaluate(() => window.__store.getState().removeBook(window.__store.getState().books[0].id));

  await seed(page);
  await scenario(page, false);

  // ── Export Markdown ──
  const md = await page.evaluate(async () => {
    const m = await import('/src/lib/exportMarkdown.ts');
    const s = window.__store.getState();
    const db = { version: 2, books: s.books, highlights: s.highlights, concepts: s.concepts, maps: s.maps, arguments: s.arguments, studies: s.studies, plans: s.plans, drafts: s.drafts, cards: s.cards, workspaces: s.workspaces, groups: s.groups, wsItems: s.wsItems, settings: s.settings };
    const epub = s.books.find((b) => b.format === 'epub');
    const bon = s.concepts.find((c) => c.name === 'Bon sens');
    return { book: m.bookToMarkdown(epub.id, db), concept: m.conceptToMarkdown(bon.id, db), all: m.conceptsToMarkdown(db), none: m.bookToMarkdown('inconnu', db) };
  });
  fs.mkdirSync('shots/lib', { recursive: true });
  fs.writeFileSync('shots/lib/export-livre.md', md.book);
  fs.writeFileSync('shots/lib/export-concept.md', md.concept);
  fs.writeFileSync('shots/lib/export-concepts.md', md.all);
  console.log('\n════ bookToMarkdown(epub) ════\n' + md.book);
  console.log('════ conceptToMarkdown(Bon sens) ════\n' + md.concept);
  console.log('════ conceptsToMarkdown ════\n' + md.all);
  check(md.book.startsWith('---\ntitle: "Discours de la méthode"'), 'export livre : front matter');
  check(md.book.indexOf('Première partie · p. 1') < md.book.indexOf('Seconde partie'), 'export livre : extraits dans l’ordre du texte');
  check(md.book.includes('> [!quote] Thèse · Seconde partie · p. 3') && md.book.includes('> [!note] Note de marge'), 'export livre : callouts quote + note');
  check(md.book.includes('[[Bon sens]]') && md.book.includes('**soutiennent**') === false && md.book.includes('(co-prémisses) **soutient**'), 'export livre : wikilinks + co-prémisses');
  check(md.book.includes('## Fiches-texte') && md.book.includes('## Carte d’argument') && md.book.includes('## Arguments reconstruits') && md.book.includes('## Récapitulatif'), 'export livre : sections');
  check(md.none === '', 'export : livre inconnu → chaîne vide');
}, { dark: false });

// ── 2. thème sombre ──
await withApp(PORT, async (page) => {
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await page.waitForSelector('.lib-drop');
  await shot(page, 'shots/lib/vide-sombre.png');
  await importAll(page);
  await seed(page);
  await scenario(page, true);
}, { dark: true });

console.log(failures ? `\n${failures} échec(s)` : '\nTous les contrôles passent');
process.exit(failures ? 1 : 0);
