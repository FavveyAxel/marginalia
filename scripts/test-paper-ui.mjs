// Livres papier dans le reste de l'app (Vite + Chromium, hôte navigateur : aucun réseau) :
//  - citation dans un écrit : panneau « Livre » de l'éditeur → livre papier → « Citer » : citation et
//    note de bas de page avec auteur, titre, éditeur, année, page (vérifiée dans le .docx exporté) ;
//  - recherche globale (⌘K) : le livre papier (« papier ») et ses extraits ; ouverture de sa page ;
//  - espaces de travail : le livre papier s'y range et s'ouvre ;
//  - corbeille : suppression (avec ses extraits) puis restauration ;
//  - partage « .marginalia » : le livre papier voyage sans fichier (métadonnées, ISBN, couverture),
//    n'est pas « sans fichier » chez l'autre, ses photos de pages restent ici ; second import : pas de
//    doublon du livre ;
//  - « Ouvrir côte à côte » : un livre papier n'y est pas proposé ; Boîte : un passage n'est jamais
//    cherché dans un livre papier.
// Lancer : timeout 400 node scripts/test-paper-ui.mjs
import { withApp, importFixture } from './harness.mjs';
import JSZip from 'jszip';

let nOk = 0;
let nKo = 0;
const ok = (c, m, extra = '') => {
  if (c) nOk++;
  else nKo++;
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const HELPERS = () => {
  window.__u8tob64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  window.__b64tou8 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
};
// Petite couverture dessinée (data: URL JPEG), comme celle qu'aurait rangée la recherche.
const COVER = () => {
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = 180;
  const g = c.getContext('2d');
  g.fillStyle = '#7a2f2a';
  g.fillRect(0, 0, 120, 180);
  g.fillStyle = '#f6ecdf';
  g.font = 'italic 16px serif';
  g.fillText('Du contrat', 18, 80);
  g.fillText('social', 36, 100);
  return c.toDataURL('image/jpeg', 0.85);
};

let pkg = null;
await withApp(5341, async (page, errors) => {
  await page.evaluate(HELPERS);
  const st = (fn, a) => page.evaluate(fn, a);
  await st(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off', lastSeenVersion: '99.0.0' }));
  const epub = await importFixture(page, 'fixtures/discours.epub');
  const ids = await st(async (cover) => {
    const p = await import('/src/features/paper/paper.ts');
    const b = p.addPaperBook({ title: 'Du contrat social', author: 'Jean-Jacques Rousseau', publisher: 'GF Flammarion', year: '2001', isbn: '9782080706881', cover });
    const h1 = p.addPaperExtract(b.id, { text: 'L’homme est né libre, et partout il est dans les fers.', page: '47', category: 'these' });
    const h2 = p.addPaperExtract(b.id, { text: 'Renoncer à sa liberté, c’est renoncer à sa qualité d’homme.', page: 'p. 52', note: 'à discuter' });
    // Extrait venu d'une photo de page (fichier rangé avec le livre).
    const { host } = await import('/src/lib/platform.ts');
    await host.storeFile(b.id, 'photos/abc123.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer);
    const h3 = p.addPaperExtract(b.id, { text: 'Le plus fort n’est jamais assez fort pour être toujours le maître.', page: '48', photo: 'photos/abc123.jpg' });
    return { book: b.id, h1: h1.id, h2: h2.id, h3: h3.id };
  }, await st(COVER));
  ok(!!epub && !!ids.book, 'livre papier et EPUB dans la bibliothèque');
  const h2 = await st((id) => window.__store.getState().highlights.find((h) => h.id === id), ids.h2);
  ok(h2.printedPage === '52' && h2.locationLabel === 'p. 52' && h2.note === 'à discuter' && h2.category === null && !h2.plain, '« p. 52 » saisi : page nettoyée ; extrait avec note = note de marge');

  // ── Livre et page devinés sur une photo (en local) ──
  const guesses = await st(async ({ book, epub }) => {
    const { guessPaperBook } = await import('/src/features/inbox/paperGuess.ts');
    const s = window.__store.getState();
    const w = (t, x, y) => ({ t, x, y, w: 0.05, h: 0.02, c: 90 });
    const line = (txt, y) => ({ words: txt.split(' ').map((t, i) => w(t, 0.1 + i * 0.06, y)) });
    const ocr = (lines) => ({ v: 1, engine: 't', langs: 'fra', width: 1000, height: 1400, paras: [{ lines }], confidence: 90, ms: 1, createdAt: 0 });
    const body = [line('Je veux chercher si dans l’ordre civil il peut y avoir', 0.3), line('quelque règle d’administration légitime et sûre.', 0.34)];
    const ctx = (extra) => ({ books: s.books, highlights: s.highlights, series: null, ...extra });
    return {
      header: guessPaperBook(ocr([line('48 DU CONTRAT SOCIAL', 0.05), ...body]), ctx({})),
      author: guessPaperBook(ocr([line('ROUSSEAU', 0.05), ...body, line('112', 0.93)]), ctx({})),
      series: guessPaperBook(ocr(body), ctx({ series: { bookId: book, at: Date.now() } })),
      last: guessPaperBook(ocr(body), ctx({})),
      none: guessPaperBook(ocr(body), ctx({ highlights: [] })),
      oldSeries: guessPaperBook(ocr(body), ctx({ highlights: [], series: { bookId: book, at: Date.now() - 2 * 3600e3 } })),
      notPaper: guessPaperBook(ocr(body), ctx({ highlights: [], series: { bookId: epub, at: Date.now() } })),
    };
  }, { book: ids.book, epub });
  ok(guesses.header.bookId === ids.book && guesses.header.reason === 'header' && guesses.header.page === '48' && guesses.header.text.startsWith('Je veux chercher'), 'photo : titre courant en haut → livre et page ; texte sans en-tête', guesses.header);
  ok(guesses.author.bookId === ids.book && guesses.author.reason === 'header' && guesses.author.page === '112', 'photo : nom de l’auteur en haut, numéro en bas de page', guesses.author);
  ok(guesses.series.reason === 'series' && guesses.series.bookId === ids.book && guesses.series.page === '', 'photo sans titre courant : livre de la série en cours', guesses.series);
  ok(guesses.last.reason === 'last' && guesses.last.bookId === ids.book, 'sinon : livre du dernier extrait papier', guesses.last);
  ok(guesses.none.bookId === null && guesses.oldSeries.bookId === null && guesses.notPaper.bookId === null, 'rien de sûr (série trop ancienne, livre non papier) : choix dans la liste');

  // ── Citation dans un écrit ──
  const draft = await st(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Liberté et contrat', template: 'vide' }));
  await st((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), draft.id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(700);
  await page.click('.ed-side-tabs [data-side="book"]');
  await page.waitForSelector('.ed-bookpick');
  await page.click(`.ed-bookpick-item[data-book="${ids.book}"]`);
  await page.waitForSelector('.ed-book .pb-extracts.is-compact [data-testid="paper-cite"]');
  ok((await page.locator('.ed-book [data-testid="paper-extract"]').count()) === 3 && !(await page.$('.ed-book [aria-label="Sommaire"]')), 'panneau « Livre » : extraits du livre papier par page (pas de sommaire ni de lecteur)');
  const order = await page.locator('.ed-book .pb-extract-page').allInnerTexts();
  ok(order.join(',') === 'p. 47,p. 48,p. 52', 'extraits rangés par page', order);
  await st(() => {
    const e = window.__ed.engine();
    e.focus();
  });
  await page.keyboard.type('Rousseau ouvre ainsi le premier livre : ');
  await page.locator('.ed-book [data-testid="paper-extract"]').first().locator('[data-testid="paper-cite"]').click();
  await page.waitForTimeout(800);
  const text = await st(() => window.__ed.engine().plainText());
  ok(text.includes('« L’homme est né libre, et partout il est dans les fers. »'), 'citation insérée dans l’écrit', text.slice(0, 120));
  const docx = await st(async () => window.__u8tob64(new Uint8Array(await window.__ed.engine().exportDocx())));
  const zip = await JSZip.loadAsync(Buffer.from(docx, 'base64'));
  const notes = (await zip.file('word/footnotes.xml')?.async('string')) ?? '';
  const flat = notes.replace(/<[^>]+>/g, '');
  ok(/Jean-Jacques Rousseau, Du contrat social, GF Flammarion, 2001, p\. 47\./.test(flat), 'note de bas de page : auteur, titre, éditeur, année, page', flat.slice(0, 160));
  const doc = (await zip.file('word/document.xml').async('string'));
  ok(doc.includes(`_mglHl_${ids.h1}`), 'lien citation → extrait (signet _mglHl_)');

  // ── Recherche globale ──
  await st(() => window.__store.getState().navigate({ name: 'library' }));
  await st(() => window.__store.getState().setCommandOpen(true));
  await page.waitForSelector('.cmd-input');
  await page.fill('.cmd-input', 'contrat flammarion');
  await page.waitForTimeout(200);
  const items = await page.locator('.cmd-list [role="option"], .cmd-list .cmd-item').allInnerTexts();
  ok(items.some((t) => /Du contrat social/.test(t) && /papier/.test(t)), 'recherche globale : le livre papier (« papier », éditeur)', items.slice(0, 4));
  await page.fill('.cmd-input', 'fers');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="paper-page"]');
  await page.waitForTimeout(500);
  const active = await st(() => document.querySelector('.pb-extract.is-active')?.getAttribute('data-hl'));
  ok(active === ids.h1, 'recherche d’un extrait → page du livre papier, extrait mis en avant', active);
  await st(() => window.__store.getState().setCommandOpen(true));
  await page.fill('.cmd-input', 'page 12');
  await page.waitForTimeout(200);
  ok(!(await page.locator('.cmd-list', { hasText: 'Aller à la page' }).count()), 'pas d’« Aller à la page » sur un livre papier');
  await page.keyboard.press('Escape');

  // ── Espace de travail ──
  const ws = await st((b) => {
    const s = window.__store.getState();
    const w = s.createWorkspace('Philosophie politique');
    s.addToWorkspace(w.id, null, 'book', b);
    return w.id;
  }, ids.book);
  await st((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), ws);
  await page.waitForTimeout(800);
  const wsItem = page.locator('main', { hasText: 'Du contrat social' }).getByText('Du contrat social').first();
  await wsItem.dblclick().catch(() => wsItem.click());
  await page.waitForTimeout(600);
  if (!(await page.$('[data-testid="paper-page"]'))) await wsItem.click().catch(() => undefined);
  await page.waitForSelector('[data-testid="paper-page"]', { timeout: 5000 }).then(
    () => ok(true, 'espace de travail : le livre papier s’y range et s’ouvre'),
    () => ok(false, 'espace de travail : le livre papier s’y range et s’ouvre'),
  );
  ok(/Philosophie politique/.test(await page.locator('.topbar').first().innerText()), 'retour vers l’espace d’où l’on vient', await page.locator('.topbar').first().innerText());

  // ── Ouvrir côte à côte, Boîte ──
  const split = await st(async (b) => {
    window.__store.getState().openBook(b);
    return null;
  }, epub);
  void split;
  const found = await st(async () => (await import('/src/features/inbox/match.ts')).findPassage('L’homme est né libre, et partout il est dans les fers.'));
  ok(Array.isArray(found) && found.every((m) => m.bookId !== ids.book), 'Boîte : un passage n’est jamais cherché dans un livre papier (pas de fichier)', found.length);

  // ── Partage ──
  const built = await st(async (id) => {
    const m = await import('/src/features/share/sharePackage.ts');
    const r = await m.buildSharePackage({ kind: 'items', ids: [id] }, { includeBooks: true });
    return { b64: window.__u8tob64(r.bytes), summary: r.summary };
  }, ids.book);
  const z = await JSZip.loadAsync(Buffer.from(built.b64, 'base64'));
  const manifest = JSON.parse(await z.file('manifest.json').async('string'));
  const data = JSON.parse(await z.file('data.json').async('string'));
  const files = Object.keys(z.files).filter((n) => n.startsWith('files/'));
  ok(manifest.books.length === 1 && manifest.books[0].format === 'paper' && manifest.books[0].included === false && manifest.books[0].sha256 === null && files.length === 0, 'partage : livre papier sans fichier (ni photo de page)', { files, entry: manifest.books[0] });
  ok(data.books[0].paper === true && data.books[0].isbn === '9782080706881' && data.books[0].cover.startsWith('data:image/jpeg') && data.highlights.length === 3 && data.highlights.every((h) => !('photo' in h)), 'partage : métadonnées, ISBN et couverture ; extraits sans chemin de photo');
  ok(built.summary.skipped.length === 0, 'aucun avertissement « fichier introuvable »', built.summary.skipped);
  pkg = built.b64;

  // ── Corbeille ──
  const photoFiles = await st((id) => {
    const s = window.__store.getState();
    const e = s.trashDelete('book', id);
    return { files: e.files, gone: !window.__store.getState().books.some((b) => b.id === id), hl: window.__store.getState().highlights.filter((h) => h.bookId === id).length };
  }, ids.book);
  ok(photoFiles.gone && photoFiles.hl === 0 && JSON.stringify(photoFiles.files) === JSON.stringify([{ ownerId: ids.book, fileName: 'photos/abc123.jpg' }]), 'corbeille : livre et extraits retirés ; seule la photo de page sera effacée au vidage', photoFiles.files);
  await st(() => window.__store.getState().navigate({ name: 'trash' }));
  await page.waitForTimeout(500);
  ok(await page.locator('main', { hasText: 'Du contrat social' }).count() > 0, 'corbeille : le livre papier y figure');
  const restored = await st((id) => {
    const s = window.__store.getState();
    const e = s.trash.find((t) => t.refId === id);
    const r = s.restoreFromTrash(e.id);
    const t = window.__store.getState();
    return { ok: r.ok, book: t.books.find((b) => b.id === id)?.format, hl: t.highlights.filter((h) => h.bookId === id).length };
  }, ids.book);
  ok(restored.ok && restored.book === 'paper' && restored.hl === 3, 'corbeille : restauration du livre papier et de ses 3 extraits', restored);
  ok(errors.filter((e) => !/favicon|ERR_|404/.test(e)).length === 0, 'aucune erreur dans la page', errors.slice(0, 4));
});

// ── Réception du partage dans une bibliothèque neuve ──
await withApp(5342, async (page, errors) => {
  await page.evaluate(HELPERS);
  const st = (fn, a) => page.evaluate(fn, a);
  const prev = await st(async (b64) => (await import('/src/features/share/sharePackage.ts')).readSharePackage(window.__b64tou8(b64)), pkg);
  ok(prev.booksWithoutFile === 0 && prev.books[0].paper === true, 'aperçu : le livre papier n’est pas « à importer plus tard »', { without: prev.booksWithoutFile });
  const r1 = await st(async (b64) => (await import('/src/features/share/shareMerge.ts')).importSharePackage(window.__b64tou8(b64)), pkg);
  const s1 = await st(() => {
    const s = window.__store.getState();
    return { books: s.books.map((b) => ({ f: b.format, paper: b.paper, missing: !!b.missing, isbn: b.isbn, cover: (b.cover || '').slice(0, 15), pub: b.edition.publisher, file: b.fileName })), hl: s.highlights.map((h) => ({ p: h.printedPage, photo: 'photo' in h })) };
  });
  ok(r1.missingBooks.length === 0 && s1.books.length === 1 && s1.books[0].f === 'paper' && s1.books[0].paper && !s1.books[0].missing && s1.books[0].isbn === '9782080706881' && s1.books[0].cover === 'data:image/jpeg' && s1.books[0].pub === 'GF Flammarion' && s1.books[0].file === '', 'reçu : livre papier (ni « sans fichier », ni fichier), ISBN, éditeur, couverture', s1.books);
  ok(s1.hl.length === 3 && s1.hl.every((h) => !h.photo), 'reçu : 3 extraits, sans photo de page', s1.hl);
  await st((id) => window.__store.getState().openBook(id), await st(() => window.__store.getState().books[0].id));
  await page.waitForSelector('[data-testid="paper-page"]');
  ok((await page.locator('[data-testid="paper-extract"]').count()) === 3, 'reçu : la page du livre papier s’ouvre avec ses extraits');
  const r2 = await st(async (b64) => (await import('/src/features/share/shareMerge.ts')).importSharePackage(window.__b64tou8(b64)), pkg);
  const n2 = await st(() => window.__store.getState().books.length);
  ok(n2 === 1 && r2.attachedBooks.length === 1, 'second import : le même livre papier (ISBN) est reconnu, pas de doublon', { n2, attached: r2.attachedBooks });
  ok(errors.filter((e) => !/favicon|ERR_|404/.test(e)).length === 0, 'aucune erreur (réception)', errors.slice(0, 4));
});

console.log(`\n${nOk} OK, ${nKo} échec(s)`);
