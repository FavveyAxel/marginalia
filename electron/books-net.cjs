// ─────────────────────────────────────────────────────────────
// Livres papier : retrouver une édition (titre, auteur, éditeur, année, ISBN, couverture) à partir
// du texte tapé ou d'un ISBN lu sur le code-barres.
//
// Connexions (processus principal seulement, jamais le rendu ; réglage « Rechercher les livres
// papier sur Internet », activé par défaut ; désactivé : AUCUNE requête) :
//  - https://www.googleapis.com/books/v1/volumes?q=…        (Google Books, sans clé)
//  - https://openlibrary.org/search.json?…                  (Open Library, recherche)
//  - https://openlibrary.org/isbn/<isbn>.json               (Open Library, une édition)
//  - couvertures : https://covers.openlibrary.org/…, https://books.google.com/…,
//    https://*.googleusercontent.com/… ; Open Library range une partie de ses couvertures sur
//    archive.org : une REDIRECTION de covers.openlibrary.org vers https://archive.org ou
//    https://*.archive.org est suivie (jamais une adresse de départ).
// Seul le texte tapé (ou l'ISBN) part ; aucun cookie, aucun identifiant, aucune photo. Chaque
// adresse (et chaque redirection) est contrôlée ; réponses de taille limitée ; délai maximal.
// ─────────────────────────────────────────────────────────────
'use strict';

const http = require('node:http');
const https = require('node:https');

const MAX_JSON = 2 * 1024 * 1024;
const MAX_COVER = 3 * 1024 * 1024;
const TIMEOUT_MS = 9000;
const MAX_QUERY = 200;
const MAX_RESULTS = 12;

// ── ISBN ─────────────────────────────────────────────────────

/** Chiffres (et X final) d'une saisie : espaces, tirets et préfixe « ISBN » retirés. */
function cleanIsbn(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/^\s*ISBN(?:-1[03])?:?\s*/, '')
    .replace(/[\s ‐-―-]/g, '');
}
function isValidIsbn10(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (10 - i) * (s[i] === 'X' ? 10 : Number(s[i]));
  return sum % 11 === 0;
}
function isValidIsbn13(s) {
  if (!/^97[89]\d{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
  return sum % 10 === 0;
}
/** ISBN-10 → ISBN-13 (préfixe 978, nouvelle clé). */
function isbn10to13(s) {
  const core = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
  return core + String((10 - (sum % 10)) % 10);
}
/** ISBN-13 (978) → ISBN-10, sinon null. */
function isbn13to10(s) {
  if (!/^978\d{10}$/.test(s)) return null;
  const core = s.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i]);
  const c = (11 - (sum % 11)) % 11;
  return core + (c === 10 ? 'X' : String(c));
}
/** ISBN-13 valide d'une saisie (ISBN-10 converti), sinon null. */
function normalizeIsbn(s) {
  const c = cleanIsbn(s);
  if (isValidIsbn13(c)) return c;
  if (isValidIsbn10(c)) return isbn10to13(c);
  return null;
}

// ── Adresses ─────────────────────────────────────────────────

const PROD = {
  google: 'https://www.googleapis.com/books/v1/volumes',
  olSearch: 'https://openlibrary.org/search.json',
  olIsbn: 'https://openlibrary.org/isbn/',
  olCovers: 'https://covers.openlibrary.org',
};

/** Adresses de test (serveur local unique, MARGINALIA_E2E_BOOKS_BASE=http://127.0.0.1:port). */
function testEndpoints(base) {
  const b = String(base).replace(/\/+$/, '');
  return { google: `${b}/google/books/v1/volumes`, olSearch: `${b}/ol/search.json`, olIsbn: `${b}/ol/isbn/`, olCovers: `${b}/olcovers` };
}

function parseUrl(u) {
  try {
    const x = new URL(u);
    if (x.username || x.password) return null;
    return x;
  } catch {
    return null;
  }
}
const isLocalTest = (x) => x.protocol === 'http:' && x.hostname === '127.0.0.1';

/** Couverture : adresse de départ admise ? */
function coverUrlAllowed(u, allowLocal) {
  const x = parseUrl(u);
  if (!x) return false;
  if (allowLocal && isLocalTest(x)) return true;
  if (x.protocol !== 'https:') return false;
  const h = x.hostname.toLowerCase();
  return h === 'covers.openlibrary.org' || h === 'books.google.com' || h.endsWith('.googleusercontent.com');
}
/** Redirection d'une couverture : admise si la cible est admise, ou archive.org depuis covers.openlibrary.org. */
function coverRedirectAllowed(from, to, allowLocal) {
  if (coverUrlAllowed(to, allowLocal)) return true;
  const a = parseUrl(from);
  const b = parseUrl(to);
  if (!a || !b || b.protocol !== 'https:') return false;
  const h = b.hostname.toLowerCase();
  return a.hostname.toLowerCase() === 'covers.openlibrary.org' && (h === 'archive.org' || h.endsWith('.archive.org'));
}

// ── Requêtes ─────────────────────────────────────────────────

class NetError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/**
 * GET contrôlé : chaque adresse et chaque redirection passent par `allow(from, to)` ; délai total ;
 * taille maximale ; aucun cookie (aucun n'est jamais gardé ni envoyé), seul un User-Agent générique.
 */
function get(url, { allow, limit, accept, timeoutMs = TIMEOUT_MS, maxRedirects = 4, onRequest }) {
  return new Promise((resolve, reject) => {
    let done = false;
    let current = null;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(v);
    };
    const timer = setTimeout(() => {
      if (current) current.destroy();
      finish(reject, new NetError('Délai dépassé.', 'timeout'));
    }, timeoutMs);
    const go = (u, from, left) => {
      if (!allow(from, u)) return finish(reject, new NetError('Adresse refusée.', 'adresse'));
      const mod = u.startsWith('https:') ? https : http;
      if (onRequest) onRequest(u);
      let req;
      try {
        req = mod.get(u, { headers: { 'User-Agent': 'Marginalia', Accept: accept }, agent: false }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            if (left <= 0) return finish(reject, new NetError('Trop de redirections.', 'reseau'));
            let next;
            try {
              next = new URL(res.headers.location, u).toString();
            } catch {
              return finish(reject, new NetError('Redirection invalide.', 'reseau'));
            }
            return go(next, u, left - 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return finish(reject, new NetError(`HTTP ${res.statusCode}`, res.statusCode === 404 ? 'absent' : 'reseau'));
          }
          const len = Number(res.headers['content-length']);
          if (Number.isFinite(len) && len > limit) {
            finish(reject, new NetError('Réponse trop longue.', 'taille'));
            return res.destroy();
          }
          const chunks = [];
          let n = 0;
          res.on('data', (c) => {
            n += c.length;
            if (n > limit) {
              finish(reject, new NetError('Réponse trop longue.', 'taille'));
              res.destroy();
            } else chunks.push(c);
          });
          res.on('end', () => finish(resolve, { body: Buffer.concat(chunks), type: String(res.headers['content-type'] || '') }));
          res.on('error', (e) => finish(reject, e));
          res.on('aborted', () => finish(reject, new NetError('Connexion interrompue.', 'reseau')));
        });
      } catch (e) {
        return finish(reject, e);
      }
      current = req;
      req.on('error', (e) => finish(reject, new NetError(e && e.message ? e.message : 'Réseau indisponible.', 'reseau')));
    };
    go(url, null, maxRedirects);
  });
}

// ── Lecture des réponses ─────────────────────────────────────

const str = (v, max = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const yearOf = (v) => {
  const m = /(1[4-9]\d\d|20\d\d)/.exec(String(v == null ? '' : v));
  return m ? m[1] : '';
};
// Google donne ses vignettes en http : passées en https (sauf le serveur local des tests).
const httpsOf = (u) => (typeof u === 'string' ? u.replace(/^http:\/\/(?!127\.0\.0\.1[:/])/i, 'https://') : '');

function fromGoogle(json) {
  const items = json && Array.isArray(json.items) ? json.items : [];
  const out = [];
  for (const it of items) {
    const v = (it && it.volumeInfo) || {};
    const title = str(v.title);
    if (!title) continue;
    const ids = Array.isArray(v.industryIdentifiers) ? v.industryIdentifiers : [];
    const id13 = ids.find((x) => x && x.type === 'ISBN_13');
    const id10 = ids.find((x) => x && x.type === 'ISBN_10');
    const isbn13 = normalizeIsbn(id13 && id13.identifier) || normalizeIsbn(id10 && id10.identifier) || '';
    let cover = '';
    const links = v.imageLinks || {};
    const raw = httpsOf(links.thumbnail || links.smallThumbnail || '');
    if (raw) {
      try {
        const x = new URL(raw);
        x.searchParams.delete('edge');
        cover = x.toString();
      } catch {
        cover = '';
      }
    }
    out.push({
      source: 'google',
      title,
      subtitle: str(v.subtitle),
      authors: (Array.isArray(v.authors) ? v.authors : []).map((a) => str(a, 120)).filter(Boolean).slice(0, 6),
      publisher: str(v.publisher, 160),
      year: yearOf(v.publishedDate),
      isbn: isbn13,
      pages: Number.isFinite(v.pageCount) && v.pageCount > 0 ? v.pageCount : null,
      language: str(v.language, 8),
      cover,
    });
  }
  return out;
}

function olCover(ep, id) {
  return Number.isFinite(id) && id > 0 ? `${ep.olCovers}/b/id/${Math.floor(id)}-M.jpg` : '';
}

function fromOpenLibrarySearch(json, ep) {
  const docs = json && Array.isArray(json.docs) ? json.docs : [];
  const out = [];
  for (const d of docs) {
    if (!d) continue;
    // Meilleure édition (champ « editions » de la recherche), sinon l'œuvre.
    const ed = d.editions && Array.isArray(d.editions.docs) && d.editions.docs[0] ? d.editions.docs[0] : null;
    const title = str((ed && ed.title) || d.title);
    if (!title) continue;
    const isbns = [...((ed && ed.isbn) || []), ...(ed ? [] : d.isbn || [])];
    let isbn = '';
    for (const i of isbns) {
      const n = normalizeIsbn(i);
      if (n) {
        isbn = n;
        break;
      }
    }
    const pubs = (ed && ed.publisher) || d.publisher || [];
    out.push({
      source: 'openlibrary',
      title,
      subtitle: str((ed && ed.subtitle) || d.subtitle),
      authors: (Array.isArray(d.author_name) ? d.author_name : []).map((a) => str(a, 120)).filter(Boolean).slice(0, 6),
      publisher: str(Array.isArray(pubs) ? pubs[0] : pubs, 160),
      year: yearOf((ed && ed.publish_date) || d.first_publish_year),
      isbn,
      pages: null,
      language: '',
      cover: olCover(ep, (ed && ed.cover_i) || d.cover_i),
    });
  }
  return out;
}

/** Édition Open Library (/isbn/<isbn>.json) ; les auteurs n'y sont que des références (non suivies). */
function fromOpenLibraryEdition(json, ep, isbn) {
  if (!json || typeof json !== 'object') return [];
  const title = str(json.title);
  if (!title) return [];
  const pubs = Array.isArray(json.publishers) ? json.publishers : [];
  const covers = Array.isArray(json.covers) ? json.covers.filter((c) => Number.isFinite(c) && c > 0) : [];
  const own = [...(json.isbn_13 || []), ...(json.isbn_10 || [])].map(normalizeIsbn).find(Boolean);
  return [
    {
      source: 'openlibrary',
      title,
      subtitle: str(json.subtitle),
      authors: (typeof json.by_statement === 'string' ? [str(json.by_statement, 120)] : []).filter(Boolean),
      publisher: str(pubs[0], 160),
      year: yearOf(json.publish_date),
      isbn: own || isbn,
      pages: Number.isFinite(json.number_of_pages) && json.number_of_pages > 0 ? json.number_of_pages : null,
      language: '',
      cover: olCover(ep, covers[0]),
    },
  ];
}

// ── Fusion ───────────────────────────────────────────────────

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const lastName = (a) => fold(a).split(' ').pop() || '';
const workKey = (r) => `${fold(r.title)}|${lastName(r.authors[0])}|${r.year}`;

/**
 * Google d'abord, Open Library en complément : même ISBN, ou même titre + auteur + année, et c'est
 * la même édition (les champs vides de Google sont complétés) ; sinon une ligne de plus.
 */
function mergeResults(google, openlibrary, limit = MAX_RESULTS) {
  const out = [];
  const byIsbn = new Map();
  const byWork = new Map();
  const add = (r) => {
    const hit = (r.isbn && byIsbn.get(r.isbn)) || byWork.get(workKey(r));
    if (hit) {
      for (const k of ['subtitle', 'publisher', 'year', 'isbn', 'language', 'cover']) if (!hit[k] && r[k]) hit[k] = r[k];
      if (!hit.authors.length && r.authors.length) hit.authors = r.authors;
      if (!hit.pages && r.pages) hit.pages = r.pages;
      if (!hit.sources.includes(r.source)) hit.sources.push(r.source);
      if (hit.isbn) byIsbn.set(hit.isbn, hit);
      return;
    }
    const row = { ...r, sources: [r.source] };
    delete row.source;
    out.push(row);
    if (row.isbn) byIsbn.set(row.isbn, row);
    byWork.set(workKey(row), row);
  };
  for (const r of google) add(r);
  for (const r of openlibrary) add(r);
  return out.slice(0, limit);
}

// ── Service ──────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {() => boolean} o.enabled  réglage « Rechercher les livres papier sur Internet »
 * @param {string} [o.testBase]      tests : serveur local (http://127.0.0.1:port) à la place des vrais
 * @param {(url: string) => void} [o.onRequest] tests : chaque requête partie (adresse complète)
 * @param {(...a: any[]) => void} [o.diag]
 */
function createBooksNet(o) {
  const local = !!o.testBase;
  const ep = local ? testEndpoints(o.testBase) : PROD;
  const diag = o.diag || (() => {});
  const apiAllowed = (u) => {
    const x = parseUrl(u);
    if (!x) return false;
    if (local) return isLocalTest(x);
    return x.protocol === 'https:' && (x.hostname === 'www.googleapis.com' || x.hostname === 'openlibrary.org');
  };
  const json = async (url) => {
    const r = await get(url, { allow: (_from, to) => apiAllowed(to), limit: MAX_JSON, accept: 'application/json', onRequest: o.onRequest });
    try {
      return JSON.parse(r.body.toString('utf8'));
    } catch {
      throw new NetError('Réponse illisible.', 'format');
    }
  };
  const off = () => ({ ok: false, off: true, results: [], error: 'La recherche sur Internet est désactivée dans les Réglages.' });

  async function both(gUrl, olTasks) {
    const [g, ...ol] = await Promise.allSettled([json(gUrl), ...olTasks.map((t) => t.run())]);
    const errors = [];
    const google = g.status === 'fulfilled' ? fromGoogle(g.value) : (errors.push({ source: 'google', error: g.reason && g.reason.message }), []);
    const openlibrary = [];
    ol.forEach((r, i) => {
      if (r.status === 'fulfilled') openlibrary.push(...olTasks[i].parse(r.value));
      else if (!(r.reason && r.reason.code === 'absent')) errors.push({ source: 'openlibrary', error: r.reason && r.reason.message });
    });
    const failedAll = g.status === 'rejected' && ol.every((r) => r.status === 'rejected');
    if (errors.length) diag('papier', 'recherche partielle', errors.map((e) => `${e.source}: ${e.error}`).join(' ; '));
    if (failedAll && !(ol.every((r) => r.reason && r.reason.code === 'absent') && g.reason && g.reason.code === 'absent'))
      return { ok: false, results: [], error: 'Impossible de joindre Google Books ni Open Library (pas de connexion ?).', errors };
    return { ok: true, results: mergeResults(google, openlibrary), errors };
  }

  /** Recherche par texte (titre, auteur) ou par ISBN (reconnu dans le texte). */
  async function search(q) {
    if (!o.enabled()) return off();
    const text = String(q || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
    if (text.length < 2) return { ok: true, results: [] };
    const isbn = normalizeIsbn(text);
    if (isbn) return byIsbn(isbn);
    const g = `${ep.google}?q=${encodeURIComponent(text)}&maxResults=10&printType=books`;
    const fields = 'key,title,subtitle,author_name,first_publish_year,cover_i,isbn,publisher,editions,editions.title,editions.subtitle,editions.publisher,editions.publish_date,editions.isbn,editions.cover_i';
    const ol = `${ep.olSearch}?q=${encodeURIComponent(text)}&limit=10&fields=${encodeURIComponent(fields)}`;
    return both(g, [{ run: () => json(ol), parse: (j) => fromOpenLibrarySearch(j, ep) }]);
  }

  /** Une édition par son ISBN (10 ou 13 chiffres ; ISBN invalide : refusé sans requête). */
  async function byIsbn(raw) {
    if (!o.enabled()) return off();
    const isbn = normalizeIsbn(raw);
    if (!isbn) return { ok: false, results: [], error: 'Cet ISBN n’est pas valide (vérifiez les chiffres).' };
    const g = `${ep.google}?q=${encodeURIComponent('isbn:' + isbn)}&maxResults=5`;
    const fields = 'key,title,subtitle,author_name,first_publish_year,cover_i,isbn,publisher,editions,editions.title,editions.subtitle,editions.publisher,editions.publish_date,editions.isbn,editions.cover_i';
    const res = await both(g, [
      { run: () => json(`${ep.olSearch}?isbn=${isbn}&limit=3&fields=${encodeURIComponent(fields)}`), parse: (j) => fromOpenLibrarySearch(j, ep) },
      { run: () => json(`${ep.olIsbn}${isbn}.json`), parse: (j) => fromOpenLibraryEdition(j, ep, isbn) },
    ]);
    // Le code lu fait foi : on garde l'édition de cet ISBN en tête, ISBN noté même s'il manque.
    if (res.ok) {
      res.results.sort((a, b) => (b.isbn === isbn) - (a.isbn === isbn));
      res.results = res.results.filter((r, i) => i === 0 || r.isbn === isbn).slice(0, 3);
      if (res.results[0] && !res.results[0].isbn) res.results[0].isbn = isbn;
    }
    return { ...res, isbn };
  }

  /** Couverture (image), en data: URL ; null si absente, refusée ou trop grosse. */
  async function cover(url) {
    if (!o.enabled()) return null;
    if (!coverUrlAllowed(url, local)) return null;
    try {
      const r = await get(url, { allow: (from, to) => (from ? coverRedirectAllowed(from, to, local) : coverUrlAllowed(to, local)), limit: MAX_COVER, accept: 'image/*', onRequest: o.onRequest });
      const b = r.body;
      const mime =
        b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'image/webp' : b.slice(0, 3).toString() === 'GIF' ? 'image/gif' : null;
      // Image trop petite : pixel transparent ou « pas de couverture ».
      if (!mime || b.length < 600) return null;
      return `data:${mime};base64,${b.toString('base64')}`;
    } catch (e) {
      diag('papier', 'couverture', e && e.message);
      return null;
    }
  }

  return { search, byIsbn, cover };
}

module.exports = {
  createBooksNet,
  normalizeIsbn,
  cleanIsbn,
  isValidIsbn10,
  isValidIsbn13,
  isbn10to13,
  isbn13to10,
  mergeResults,
  coverUrlAllowed,
  coverRedirectAllowed,
  fromGoogle,
  fromOpenLibrarySearch,
  PROD,
};
