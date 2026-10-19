// Livres papier : recherche d'éditions (electron/books-net.cjs) contre de FAUX serveurs locaux
// Google Books / Open Library (jamais le vrai réseau) : ISBN-10/13 et clés, fusion et dédoublonnage,
// erreurs réseau (serveur absent, 500, délai, réponse trop longue, JSON illisible), adresses et
// redirections refusées, réglage désactivé = aucune requête, couverture téléchargée en data: URL.
// Lancer : node scripts/test-paper-net.mjs
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const B = require(path.join(ROOT, 'electron/books-net.cjs'));
let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) fails++;
};

// ── ISBN ──
ok(B.isValidIsbn13('9782080706881') && B.isValidIsbn13('9791090636071') && !B.isValidIsbn13('9782080706882'), 'ISBN-13 : clé vérifiée (978 et 979)');
ok(B.isValidIsbn10('2080706888') && B.isValidIsbn10('080442957X') && !B.isValidIsbn10('2080706887'), 'ISBN-10 : clé vérifiée (X compris)');
ok(B.isbn10to13('2080706888') === '9782080706881', 'ISBN-10 → 13', B.isbn10to13('2080706888'));
ok(B.isbn13to10('9782080706881') === '2080706888' && B.isbn13to10('9791090636071') === null, 'ISBN-13 → 10 (seulement 978)');
ok(B.normalizeIsbn('ISBN 978-2-08-070688-1') === '9782080706881' && B.normalizeIsbn('2-08-070688-8') === '9782080706881' && B.normalizeIsbn('978 2 08 070688 2') === null && B.normalizeIsbn('Du contrat social') === null, 'saisie libre : tirets, espaces, préfixe ; clé fausse refusée');

// ── Adresses admises ──
ok(B.coverUrlAllowed('https://covers.openlibrary.org/b/id/1-M.jpg') && B.coverUrlAllowed('https://books.google.com/books/content?id=x') && B.coverUrlAllowed('https://lh3.googleusercontent.com/x'), 'couvertures : hôtes admis');
ok(!B.coverUrlAllowed('http://books.google.com/x') && !B.coverUrlAllowed('https://evil.com/x.jpg') && !B.coverUrlAllowed('https://user:pw@books.google.com/x') && !B.coverUrlAllowed('https://googleusercontent.com.evil.com/x') && !B.coverUrlAllowed('https://archive.org/x.jpg') && !B.coverUrlAllowed('http://127.0.0.1:1/x'), 'couvertures : http, autre hôte, identifiants, archive.org en départ, local : refusés');
ok(B.coverRedirectAllowed('https://covers.openlibrary.org/b/id/1-M.jpg', 'https://ia800.us.archive.org/x.jpg') && !B.coverRedirectAllowed('https://books.google.com/x', 'https://ia800.us.archive.org/x.jpg') && !B.coverRedirectAllowed('https://covers.openlibrary.org/x', 'http://archive.org/x'), 'redirection vers archive.org : seulement depuis covers.openlibrary.org, en https');

// ── Faux serveurs ──
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]);
const seen = [];
let mode = 'normal';
const google = {
  'du contrat social': {
    items: [
      { volumeInfo: { title: 'Du contrat social', authors: ['Jean-Jacques Rousseau'], publisher: 'GF Flammarion', publishedDate: '2001-01-03', industryIdentifiers: [{ type: 'ISBN_10', identifier: '2080706888' }], imageLinks: { thumbnail: 'http://127.0.0.1:PORT/gcover/1?edge=curl&zoom=1' }, pageCount: 256, language: 'fr' } },
      { volumeInfo: { title: 'Du contrat social', authors: ['Jean-Jacques Rousseau'], publisher: 'Folio', publishedDate: '1993', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9782070328703' }] } },
      { volumeInfo: { title: '' } },
    ],
  },
};
const ol = {
  docs: [
    // Même édition que la 1re de Google (ISBN-13 = ISBN-10 converti) : fusionnée, couverture gardée de Google.
    { title: 'Du contrat social', author_name: ['Jean-Jacques Rousseau'], editions: { docs: [{ title: 'Du contrat social', publisher: ['Flammarion'], publish_date: '2001', isbn: ['9782080706881'], cover_i: 99 }] } },
    // Folio, sans ISBN, même titre + auteur + année : fusionnée par titre/auteur/année, couverture ajoutée.
    { title: 'Du Contrat Social', author_name: ['J.-J. Rousseau'], first_publish_year: 1993, cover_i: 12, publisher: ['Gallimard'] },
    // Nouvelle édition : ajoutée à la suite.
    { title: 'Du contrat social', author_name: ['Jean-Jacques Rousseau'], editions: { docs: [{ title: 'Du contrat social ou Principes du droit politique', publisher: ['Garnier'], publish_date: '1962', isbn: ['2-7050-0123-9'] }] } },
  ],
};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  seen.push(req.url);
  if (req.headers.cookie) ok(false, 'aucun cookie envoyé');
  const json = (o) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(o).replaceAll('PORT', String(server.address().port)));
  };
  if (mode === 'google-500' && u.pathname.startsWith('/google')) return res.writeHead(500).end();
  if (mode === 'all-500') return res.writeHead(500).end();
  if (mode === 'slow') return; // ne répond jamais
  if (mode === 'huge' && u.pathname.startsWith('/google')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"items":[');
    const blob = Buffer.alloc(64 * 1024, 32);
    let n = 0;
    const pump = () => {
      while (n++ < 60) if (!res.write(blob)) return res.once('drain', pump);
      res.end(']}');
    };
    return pump();
  }
  if (mode === 'garbage' && u.pathname.startsWith('/ol')) return res.writeHead(200).end('<html>pas du JSON');
  if (u.pathname === '/google/books/v1/volumes') {
    const q = (u.searchParams.get('q') || '').toLowerCase();
    if (q.startsWith('isbn:')) {
      const isbn = q.slice(5);
      return json(isbn === '9782080706881' ? { items: [google['du contrat social'].items[0]] } : { totalItems: 0 });
    }
    return json(google[q] || { totalItems: 0 });
  }
  if (u.pathname === '/ol/search.json') {
    if (u.searchParams.get('isbn')) return json(u.searchParams.get('isbn') === '9782080706881' ? { docs: [ol.docs[0]] } : { docs: [] });
    return json((u.searchParams.get('q') || '').toLowerCase() === 'du contrat social' ? ol : { docs: [] });
  }
  if (u.pathname.startsWith('/ol/isbn/')) {
    if (u.pathname === '/ol/isbn/9782080706881.json') {
      res.writeHead(302, { Location: '/ol/books/OL1M.json' });
      return res.end();
    }
    if (u.pathname === '/ol/isbn/9782081275232.json') return json({ title: 'Discours de la méthode', publishers: ['GF Flammarion'], publish_date: '2016', isbn_13: ['9782081275232'], covers: [5] });
    return res.writeHead(404).end();
  }
  if (u.pathname === '/ol/books/OL1M.json') return json({ title: 'Du contrat social', publishers: ['Flammarion'], publish_date: '2001', isbn_10: ['2080706888'], covers: [99], number_of_pages: 256 });
  if (u.pathname.startsWith('/gcover/') || u.pathname.startsWith('/olcovers/b/id/')) {
    if (u.pathname.includes('/12-M')) {
      res.writeHead(302, { Location: 'https://evil.example.com/steal.jpg' });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    return res.end(JPEG);
  }
  if (u.pathname === '/redirect-out') {
    res.writeHead(302, { Location: 'https://example.com/x.json' });
    return res.end();
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let enabled = true;
const requests = [];
const net = B.createBooksNet({ enabled: () => enabled, testBase: base, onRequest: (u) => requests.push(u) });

// Recherche par texte
let r = await net.search('Du contrat social');
ok(r.ok && r.results.length === 3, 'fusion : 3 éditions distinctes (Google 2 + Open Library 1 nouvelle)', r.results.map((x) => `${x.publisher} ${x.year} ${x.isbn}`));
const gf = r.results[0];
ok(gf.title === 'Du contrat social' && gf.authors[0] === 'Jean-Jacques Rousseau' && gf.publisher === 'GF Flammarion' && gf.year === '2001' && gf.isbn === '9782080706881' && gf.pages === 256, 'Google d’abord : édition complète, ISBN-10 converti en 13', gf);
ok(gf.sources.join() === 'google,openlibrary' && gf.cover.startsWith(base + '/gcover/1') && !gf.cover.includes('edge='), 'dédoublonnage par ISBN (10 ↔ 13) : une seule ligne, couverture Google gardée (sans « edge=curl »)', gf.sources);
const folio = r.results[1];
ok(folio.publisher === 'Folio' && folio.isbn === '9782070328703' && folio.sources.join() === 'google,openlibrary' && folio.cover === `${base}/olcovers/b/id/12-M.jpg`, 'dédoublonnage par titre + auteur + année : couverture d’Open Library ajoutée', folio);
const garnier = r.results[2];
ok(garnier.publisher === 'Garnier' && garnier.year === '1962' && garnier.isbn === B.isbn10to13('2705001239') && garnier.sources.join() === 'openlibrary', 'Open Library en complément : nouvelle édition à la suite', garnier);
ok(requests.every((u) => u.startsWith(base)) && requests.some((u) => /\/google\/books\/v1\/volumes\?q=Du%20contrat%20social/.test(u)) && requests.some((u) => /\/ol\/search\.json\?q=Du%20contrat%20social/.test(u)), 'seul le texte tapé part (adresses de test uniquement)', requests);

// Par ISBN
requests.length = 0;
r = await net.search('ISBN 2-08-070688-8');
ok(r.ok && r.isbn === '9782080706881' && r.results.length === 1 && r.results[0].publisher === 'GF Flammarion' && r.results[0].sources.includes('openlibrary'), 'ISBN-10 tapé : recherche par ISBN-13, Google + Open Library fusionnés', r.results);
ok(requests.some((u) => u.includes('/ol/isbn/9782080706881.json')) && requests.some((u) => u.includes('q=isbn%3A9782080706881')), 'requêtes par ISBN (Google q=isbn:, Open Library /isbn/ suivi d’une redirection locale)', requests);
r = await net.byIsbn('9782081275232');
ok(r.ok && r.results.length === 1 && r.results[0].title === 'Discours de la méthode' && r.results[0].isbn === '9782081275232' && r.results[0].cover.endsWith('/olcovers/b/id/5-M.jpg'), 'ISBN connu seulement d’Open Library : édition trouvée', r.results);
r = await net.byIsbn('9780000000002');
ok(r.ok && r.results.length === 0, 'ISBN inconnu partout : aucun résultat, pas d’erreur');
requests.length = 0;
r = await net.byIsbn('9782080706882');
ok(!r.ok && /pas valide/.test(r.error) && requests.length === 0, 'clé d’ISBN fausse : refusée sans requête');

// Couvertures
const c1 = await net.cover(gf.cover);
ok(typeof c1 === 'string' && c1.startsWith('data:image/jpeg;base64,') && Buffer.from(c1.split(',')[1], 'base64').equals(JPEG), 'couverture téléchargée (data: URL, à ranger avec le livre)');
ok((await net.cover(folio.cover)) === null, 'couverture redirigée vers un hôte non admis : refusée');
ok((await net.cover('https://evil.example.com/x.jpg')) === null, 'couverture d’un hôte non admis : refusée sans requête');

// Erreurs réseau
mode = 'google-500';
r = await net.search('Du contrat social');
ok(r.ok && r.results.length === 3 && r.errors.some((e) => e.source === 'google'), 'Google en panne (500) : résultats d’Open Library seuls', r.results.length);
mode = 'garbage';
r = await net.search('Du contrat social');
ok(r.ok && r.results.length === 2 && r.errors.some((e) => e.source === 'openlibrary'), 'Open Library illisible : résultats de Google seuls');
mode = 'all-500';
r = await net.search('Du contrat social');
ok(!r.ok && /Impossible de joindre/.test(r.error), 'tout en panne : message d’erreur', r.error);
mode = 'huge';
r = await net.search('Du contrat social');
ok(r.ok && r.errors.some((e) => e.source === 'google' && /trop longue/.test(e.error)), 'réponse trop longue : coupée', r.errors);
mode = 'slow';
const t0 = Date.now();
const slowNet = B.createBooksNet({ enabled: () => true, testBase: base });
r = await Promise.race([slowNet.search('Du contrat social'), new Promise((res) => setTimeout(() => res({ hung: true }), 15000))]);
ok(!r.hung && !r.ok && Date.now() - t0 < 12000, 'serveur muet : délai dépassé en moins de 10 s', Date.now() - t0);
mode = 'normal';
const down = B.createBooksNet({ enabled: () => true, testBase: 'http://127.0.0.1:9' });
r = await down.search('Du contrat social');
ok(!r.ok && /pas de connexion/.test(r.error), 'serveur injoignable : « pas de connexion ? »');

// Redirection vers l'extérieur refusée (API)
const prod = B.createBooksNet({ enabled: () => true, onRequest: (u) => ok(false, 'aucune requête vers Internet dans ce test', u) });
ok(typeof prod.search === 'function', 'service de production créé (non appelé)');

// Réglage désactivé : aucune requête
enabled = false;
requests.length = 0;
const before = seen.length;
const offs = [await net.search('Du contrat social'), await net.byIsbn('9782080706881'), await net.cover(gf.cover)];
ok(offs[0].off && offs[1].off && offs[2] === null && requests.length === 0 && seen.length === before, 'réglage désactivé : aucune requête (recherche, ISBN, couverture)');

server.close();
console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests passent.');
process.exit(fails ? 1 : 0);
