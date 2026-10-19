// Livres papier, de bout en bout dans Electron (dist/ requis : npx vite build), avec un FAUX serveur
// local Google Books / Open Library (MARGINALIA_E2E_BOOKS_BASE ; jamais le vrai réseau) :
//  1. Bibliothèque › « Livre papier » : menu ancré, recherche au fil de la frappe (délai, indicateur),
//     résultats avec couvertures (téléchargées par le processus principal), ajout d'un clic ;
//     couverture rangée avec le livre (data: URL), pastille « Papier », filtre « Papier » ;
//  2. page du livre : édition, « Ajouter un extrait » (texte + page), citation copiée avec auteur,
//     titre, éditeur, année et page ;
//  3. ISBN lu par le téléphone (page « Scanner un livre » simulée : envoi chiffré) → édition proposée
//     sur l'ordinateur → confirmée → ajoutée ; le téléphone voit « Ajouté à la bibliothèque » ;
//  4. « Ajouter par photo » : photo d'une page (titre courant et numéro lus par l'OCR) envoyée par le
//     téléphone → proposition « « Du contrat social », p. 48 ? » sur la page du livre → confirmée →
//     extrait p. 48 avec sa photo rangée dans le dossier du livre ;
//  5. réglage « Rechercher les livres papier sur Internet » désactivé : aucune requête, saisie à la main.
// Captures claires et sombres : shots/papier/.
// Lancer : (pgrep Xvfb || Xvfb :99 -screen 0 1600x1000x24 &) ; DISPLAY=:99 LANG=C.UTF-8 timeout 400 node scripts/test-electron-paper.mjs
import { _electron as electron } from 'playwright-core';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { keyOf, upload, open as openSealed, req } from './qr-telephone.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = path.join(ROOT, 'shots/papier');
fs.mkdirSync(SHOTS, { recursive: true });
let nOk = 0;
let nKo = 0;
const ok = (c, m, extra = '') => {
  if (c) nOk++;
  else nKo++;
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
  console.error('dist/ manquant : lancez d’abord « npx vite build ».');
  process.exit(1);
}

// ── Faux serveur Google Books / Open Library ──
const covers = new Map(); // nom → octets JPEG (couvertures dessinées par le test)
const requests = [];
const GOOGLE = {
  'du contrat social': [
    { title: 'Du contrat social', authors: ['Jean-Jacques Rousseau'], publisher: 'GF Flammarion', publishedDate: '2001', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9782080706881' }], cover: 'contrat-gf' },
    { title: 'Du contrat social', authors: ['Jean-Jacques Rousseau'], publisher: 'Folio essais', publishedDate: '1993', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9782070328703' }], cover: 'contrat-folio' },
  ],
};
const OL = {
  'du contrat social': [{ title: 'Du contrat social ou Principes du droit politique', author_name: ['Jean-Jacques Rousseau'], editions: { docs: [{ title: 'Du contrat social ou Principes du droit politique', publisher: ['Garnier'], publish_date: '1962', isbn: ['9782705001230'], cover_i: 31 }] } }],
};
const server = http.createServer((rq, res) => {
  const u = new URL(rq.url, 'http://x');
  requests.push(rq.url);
  const json = (o) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  const base = `http://127.0.0.1:${server.address().port}`;
  const g = (v) => ({ volumeInfo: { ...v, imageLinks: v.cover ? { thumbnail: `${base}/gcover/${v.cover}` } : undefined } });
  if (u.pathname === '/google/books/v1/volumes') {
    const q = (u.searchParams.get('q') || '').toLowerCase().trim();
    if (q === 'isbn:9782081275232') return json({ totalItems: 0 });
    if (q.startsWith('isbn:')) return json({ items: Object.values(GOOGLE).flat().filter((v) => v.industryIdentifiers[0].identifier === q.slice(5)).map(g) });
    const hit = Object.keys(GOOGLE).find((k) => k.startsWith(q) || q.startsWith(k));
    return json(hit ? { items: GOOGLE[hit].map(g) } : { totalItems: 0 });
  }
  if (u.pathname === '/ol/search.json') {
    if (u.searchParams.get('isbn')) return json({ docs: [] });
    const q = (u.searchParams.get('q') || '').toLowerCase().trim();
    const hit = Object.keys(OL).find((k) => k.startsWith(q) || q.startsWith(k));
    return json({ docs: hit ? OL[hit] : [] });
  }
  if (u.pathname === '/ol/isbn/9782081275232.json') return json({ title: 'Discours de la méthode', by_statement: 'René Descartes', publishers: ['GF Flammarion'], publish_date: '2016', isbn_13: ['9782081275232'], covers: [77] });
  if (u.pathname.startsWith('/ol/isbn/')) return res.writeHead(404).end();
  const cover = u.pathname.startsWith('/gcover/') ? u.pathname.slice(8) : u.pathname === '/olcovers/b/id/31-M.jpg' ? 'garnier' : u.pathname === '/olcovers/b/id/77-M.jpg' ? 'discours' : null;
  if (cover && covers.has(cover)) {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    return res.end(covers.get(cover));
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-papier-'));
const env = {
  ...process.env,
  HOME,
  XDG_CONFIG_HOME: path.join(HOME, '.config'),
  VITE_DEV_SERVER_URL: '',
  LANG: 'C.UTF-8',
  MARGINALIA_E2E: '1',
  MARGINALIA_E2E_USER_DATA: path.join(HOME, 'donnees'),
  MARGINALIA_E2E_LAN: '127.0.0.1',
  MARGINALIA_E2E_BOOKS_BASE: BASE,
  MARGINALIA_INBOX_DIR: path.join(HOME, 'Documents/Marginalia'),
};
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env, timeout: 60000 });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && !/ERR_|net::|favicon/.test(m.text()) && errors.push('console: ' + m.text()));
const st = (fn, a) => page.evaluate(fn, a);
const shot = async (name) => {
  // Captures sans les avis du bas (ils masquent le contenu montré).
  await page.evaluate(() => window.__store.setState({ toasts: [] }));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, name) });
  console.log('capture: shots/papier/' + name);
};
const setTheme = async (theme) => {
  await st((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await page.waitForTimeout(300);
};

try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await st(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off', lastSeenVersion: '99.0.0', updateCheck: false }));

  // Couvertures de démonstration DESSINÉES (typographiques), et photo d'une page de livre (texte du domaine public).
  const drawn = await st(() => {
    const cover = (bg, ink, title, author, pub) => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 384;
      const g = c.getContext('2d');
      g.fillStyle = bg;
      g.fillRect(0, 0, 256, 384);
      g.strokeStyle = ink;
      g.globalAlpha = 0.5;
      g.strokeRect(14, 14, 228, 356);
      g.globalAlpha = 1;
      g.fillStyle = ink;
      g.textAlign = 'center';
      g.font = '500 15px serif';
      g.fillText(author.toUpperCase(), 128, 70);
      g.font = 'italic 600 30px serif';
      const words = title.split(' ');
      let line = '';
      let y = 150;
      for (const w of words) {
        if (g.measureText(line + w).width > 200) {
          g.fillText(line.trim(), 128, y);
          line = '';
          y += 36;
        }
        line += w + ' ';
      }
      g.fillText(line.trim(), 128, y);
      g.fillRect(108, y + 28, 40, 2);
      g.font = '13px sans-serif';
      g.fillText(pub, 128, 350);
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    };
    const page = () => {
      const c = document.createElement('canvas');
      c.width = 1240;
      c.height = 1700;
      const g = c.getContext('2d');
      g.fillStyle = '#fbf8f1';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#1d1a15';
      g.font = '34px serif';
      g.textAlign = 'left';
      g.fillText('48', 110, 120);
      g.textAlign = 'center';
      g.font = '32px serif';
      g.fillText('DU CONTRAT SOCIAL', 620, 120);
      g.textAlign = 'left';
      g.font = '42px serif';
      const text =
        'Je veux chercher si dans l’ordre civil il peut y avoir quelque règle d’administration légitime et sûre, en prenant les hommes tels qu’ils sont, et les lois telles qu’elles peuvent être. Je tâcherai d’allier toujours dans cette recherche ce que le droit permet avec ce que l’intérêt prescrit, afin que la justice et l’utilité ne se trouvent point divisées.';
      let line = '';
      let y = 300;
      for (const w of text.split(' ')) {
        if (g.measureText(line + w).width > 1000) {
          g.fillText(line.trim(), 120, y);
          line = '';
          y += 64;
        }
        line += w + ' ';
      }
      g.fillText(line.trim(), 120, y);
      return c.toDataURL('image/jpeg', 0.92).split(',')[1];
    };
    return {
      'contrat-gf': cover('#7a2f2a', '#f6ecdf', 'Du contrat social', 'Jean-Jacques Rousseau', 'GF Flammarion'),
      'contrat-folio': cover('#e9e4d6', '#2a2a2a', 'Du contrat social', 'Rousseau', 'Folio essais'),
      garnier: cover('#2f4a5c', '#eef0ee', 'Du contrat social ou Principes du droit politique', 'J.-J. Rousseau', 'Garnier'),
      discours: cover('#c9a74a', '#1f1a12', 'Discours de la méthode', 'René Descartes', 'GF Flammarion'),
      prince: cover('#3d3a5c', '#f0ecf6', 'Le Prince', 'Machiavel', 'GF Flammarion'),
      page: page(),
    };
  });
  for (const [k, b64] of Object.entries(drawn)) if (k !== 'page') covers.set(k, Buffer.from(b64, 'base64'));
  const PAGE_JPG = Buffer.from(drawn.page, 'base64');

  // ── 1. Bouton et menu ──
  await st(() => window.__store.getState().navigate({ name: 'library' }));
  await page.waitForSelector('[data-testid="paper-add"]');
  const btns = await st(() => [...document.querySelectorAll('.topbar .btn')].map((b) => b.textContent.trim()));
  ok(btns.indexOf('Livre papier') >= 0 && btns.indexOf('Livre papier') < btns.indexOf('Importer'), 'bouton compact « Livre papier » à côté de « Importer »', btns);
  await page.click('[data-testid="paper-add"]');
  await page.waitForSelector('[data-testid="paper-menu"]');
  await page.waitForTimeout(400); // fin de l'animation d'apparition
  const geo = await st(() => {
    const m = document.querySelector('[data-testid="paper-menu"]').getBoundingClientRect();
    const b = document.querySelector('[data-testid="paper-add"]').getBoundingClientRect();
    return { top: m.top, bBottom: b.bottom, right: m.right, bRight: b.right, w: m.width, focus: document.activeElement?.getAttribute('data-testid') };
  });
  ok(geo.top >= geo.bBottom && geo.top - geo.bBottom < 12 && Math.abs(geo.right - geo.bRight) < 2 && geo.w < 420, 'menu ancré juste sous le bouton, compact', geo);
  ok(geo.focus === 'paper-search', 'la barre de recherche est en premier et a le focus');
  const rows = await page.locator('[data-testid="paper-menu"] .pp-row').allInnerTexts();
  ok(rows.join('|') === 'Scanner le code-barres avec le téléphone|Remplir à la main', 'menu : recherche, puis scanner, puis à la main', rows);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok(!(await page.$('[data-testid="paper-menu"]')) && (await st(() => document.activeElement?.getAttribute('data-testid'))) === 'paper-add', 'Échap ferme le menu et rend le focus au bouton');
  await page.click('[data-testid="paper-add"]');
  await page.mouse.click(300, 600);
  await page.waitForTimeout(200);
  ok(!(await page.$('[data-testid="paper-menu"]')), 'clic dehors : menu fermé');

  // ── Recherche au fil de la frappe ──
  await page.click('[data-testid="paper-add"]');
  requests.length = 0;
  await page.type('[data-testid="paper-search"]', 'Du contrat social', { delay: 35 });
  await page.waitForSelector('[data-testid="paper-menu"] .pp-spin', { timeout: 2000 }).then(
    () => ok(true, 'indicateur de chargement pendant la recherche'),
    () => ok(false, 'indicateur de chargement pendant la recherche'),
  );
  await page.waitForSelector('[data-testid="paper-result"]', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-result"] .pp-thumb img').length >= 3, null, { timeout: 15000 });
  const res = await page.locator('[data-testid="paper-result"]').allInnerTexts();
  ok(res.length === 3 && /GF Flammarion · 2001/.test(res[0]) && /Folio essais · 1993/.test(res[1]) && /Garnier · 1962/.test(res[2]), 'résultats fusionnés : Google d’abord, Open Library en complément', res.map((r) => r.replace(/\n/g, ' / ')));
  const googleQ = requests.filter((u) => u.startsWith('/google/'));
  ok(googleQ.length >= 1 && googleQ.length <= 3 && googleQ.every((u) => /q=D/.test(u)), 'recherche avec délai : peu de requêtes pendant la frappe (seul le texte tapé part)', googleQ);
  const thumbs = await st(() => [...document.querySelectorAll('[data-testid="paper-result"] .pp-thumb img')].map((i) => i.src.slice(0, 23)));
  ok(thumbs.every((s) => s.startsWith('data:image/jpeg;base64')), 'petites couvertures servies par le processus principal (data:, rien chargé d’Internet par l’interface)', thumbs);
  await setTheme('light');
  await shot('01-menu-resultats-clair.png');
  await setTheme('dark');
  await shot('02-menu-resultats-sombre.png');
  await setTheme('light');

  // Clavier : flèche bas puis Entrée = 2e résultat ; on prend plutôt le 1er à la souris.
  await page.locator('[data-testid="paper-result"]').first().click();
  await page.waitForFunction(() => window.__store.getState().books.some((b) => b.format === 'paper'), null, { timeout: 10000 });
  const gf = await st(() => window.__store.getState().books.find((b) => b.format === 'paper'));
  ok(gf.paper === true && gf.title === 'Du contrat social' && gf.author === 'Jean-Jacques Rousseau' && gf.edition.publisher === 'GF Flammarion' && gf.edition.year === '2001' && gf.isbn === '9782080706881' && gf.fileName === '' && gf.size === 0, 'livre papier ajouté : marqueur, ISBN, éditeur, année, sans fichier', { ...gf, cover: gf.cover?.slice(0, 30) });
  ok(typeof gf.cover === 'string' && gf.cover.startsWith('data:image/jpeg;base64,') && gf.cover.length > 2000, 'couverture téléchargée et rangée avec le livre (data: URL dans la base)');
  ok(!(await page.$('[data-testid="paper-menu"]')), 'menu refermé après l’ajout');
  await page.waitForSelector('[data-testid="lib-paper-tag"]');
  ok((await page.locator('.lib-card', { hasText: 'Du contrat social' }).locator('[data-testid="lib-paper-tag"]').count()) === 1, 'pastille « Papier » sur la carte');
  const chip = await page.locator('.lib-filters .chip', { hasText: 'Papier' }).innerText();
  ok(/Papier\s*1/.test(chip), 'filtre « Papier » à côté de EPUB / PDF / Documents', chip);
  await page.locator('.lib-filters .chip', { hasText: 'Papier' }).click();
  ok((await page.locator('.lib-card').count()) === 1, 'filtre « Papier » : seul le livre papier');
  await page.locator('.lib-filters .chip', { hasText: 'Tous' }).click();

  // ── 2. Page du livre ──
  await page.locator('.lib-card', { hasText: 'Du contrat social' }).click();
  await page.waitForSelector('[data-testid="paper-page"]');
  const hero = await page.locator('.pb-hero').innerText();
  ok(/Livre papier/.test(hero) && /Du contrat social/.test(hero) && /GF Flammarion, 2001/.test(hero) && /ISBN 9782080706881/.test(hero), 'page du livre : couverture, édition, ISBN', hero.replace(/\n/g, ' / '));
  ok(await page.isVisible('.sidebar'), 'la page s’ouvre dans l’app (barre latérale), pas dans le lecteur');
  await page.fill('[data-testid="paper-extract-text"]', 'L’homme est né libre, et partout il est dans les fers.');
  await page.fill('[data-testid="paper-extract-page"]', '47');
  await page.locator('.pb-cat', { hasText: 'Thèse' }).first().click();
  await page.click('[data-testid="paper-extract-add"]');
  await page.waitForSelector('[data-testid="paper-extract"]');
  const hl = await st(() => window.__store.getState().highlights.find((h) => h.text.startsWith('L’homme est né libre')));
  ok(hl && hl.printedPage === '47' && hl.locationLabel === 'p. 47' && hl.category === 'these' && hl.anchor.kind === 'pdf' && hl.anchor.page === 47, 'extrait tapé : page en printedPage / locationLabel, catégorie', hl && { p: hl.printedPage, l: hl.locationLabel, c: hl.category, a: hl.anchor });
  await page.fill('[data-testid="paper-extract-text"]', 'Trouver une forme d’association qui défende et protège de toute la force commune la personne et les biens de chaque associé.');
  await page.fill('[data-testid="paper-extract-page"]', '56');
  await page.locator('.pb-cat', { hasText: 'Problème' }).first().click();
  await page.click('[data-testid="paper-extract-text"]');
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-extract"]').length === 2);
  ok(true, '⌘/Ctrl+Entrée ajoute l’extrait');
  await page.locator('[data-testid="paper-extract"]').first().locator('[data-testid="paper-copy-citation"]').click();
  await page.waitForTimeout(300);
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  ok(clip === '« L’homme est né libre, et partout il est dans les fers. » (Jean-Jacques Rousseau, Du contrat social, GF Flammarion, 2001, p. 47).', 'citation copiée : auteur, titre, éditeur, année, page', clip);
  await page.mouse.move(10, 10);
  await shot('03-page-livre-clair.png');
  await setTheme('dark');
  await shot('04-page-livre-sombre.png');
  await setTheme('light');

  // ── 3. ISBN lu par le téléphone ──
  await st(() => window.__store.getState().navigate({ name: 'library' }));
  await page.click('[data-testid="paper-add"]');
  await page.click('[data-testid="paper-scan"]');
  await page.waitForSelector('[data-testid="paper-menu"] .wr-qr', { timeout: 10000 });
  const info = await st(() => window.marginalia.inbox.wifiInfo());
  const K = keyOf(info.urls[0].url);
  const R = `http://127.0.0.1:${info.port}${info.path}`;
  const scanPage = await req('GET', `${R}/scan`, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148' } });
  const csp = scanPage.headers['content-security-policy'] || '';
  ok(scanPage.status === 200 && /Scanner un livre/.test(scanPage.body) && /MultiFormatReader/.test(scanPage.body) && !/<script[^>]+src=/.test(scanPage.body) && /default-src 'none'/.test(csp), 'page « Scanner un livre » servie par l’app, lecteur de codes-barres embarqué (CSP stricte, rien d’Internet)');
  await page.waitForFunction(() => /connecté/.test(document.querySelector('[data-testid="paper-scan-status"]')?.textContent || ''), null, { timeout: 5000 }).then(
    () => ok(true, 'ordinateur : « iPhone connecté »'),
    () => ok(false, 'ordinateur : « iPhone connecté »'),
  );
  await shot('05-menu-scan-qr.png');
  const sent = await upload(R, K, { meta: { t: 'isbn' }, text: '978-2-08-127523-2' });
  ok(sent.status === 200 && sent.json?.isbn === '9782081275232', 'ISBN envoyé chiffré, reçu par l’ordinateur', sent.json);
  await page.waitForSelector('[data-testid="paper-scan-found"] [data-testid="paper-result"]', { timeout: 15000 });
  const found = await page.locator('[data-testid="paper-scan-found"]').innerText();
  ok(/Discours de la méthode/.test(found) && /GF Flammarion · 2016/.test(found), 'édition trouvée aussitôt, à confirmer', found.replace(/\n/g, ' / '));
  const phoneSees = async () => openSealed(K, (await req('GET', `${R}/result?id=${sent.idTxt}`)).body);
  await page.waitForTimeout(400);
  const seen1 = await phoneSees();
  ok(seen1?.state === 'waiting' && /Discours de la méthode — GF Flammarion, 2016 : à confirmer/.test(seen1.label), 'téléphone : « … à confirmer sur l’ordinateur » (réponse chiffrée)', seen1);
  await shot('06-menu-scan-trouve.png');
  await page.click('[data-testid="paper-scan-confirm"]');
  await page.waitForFunction(() => window.__store.getState().books.some((b) => b.isbn === '9782081275232'), null, { timeout: 10000 });
  const desc = await st(() => window.__store.getState().books.find((b) => b.isbn === '9782081275232'));
  ok(desc.format === 'paper' && desc.title === 'Discours de la méthode' && desc.edition.publisher === 'GF Flammarion' && desc.cover?.startsWith('data:image/jpeg'), 'livre scanné ajouté (édition, couverture)', { t: desc.title, p: desc.edition.publisher });
  await page.waitForSelector('[data-testid="paper-scan-added"]', { timeout: 5000 });
  ok(/« Discours de la méthode » ajouté/.test(await page.locator('[data-testid="paper-scan-added"]').innerText()) && (await page.isVisible('[data-testid="paper-menu"] .wr-qr')), 'ajouté : la réception reste ouverte pour scanner le livre suivant');
  await page.waitForTimeout(300);
  const seen2 = await phoneSees();
  ok(seen2?.state === 'library' && /Ajouté à la bibliothèque : « Discours de la méthode »/.test(seen2.label), 'téléphone : « Ajouté à la bibliothèque »', seen2);
  const bad = await upload(R, K, { meta: { t: 'isbn' }, text: '9782081275233' });
  ok(bad.status === 400 && /pas un ISBN valide/.test(bad.json?.error || ''), 'ISBN à la clé fausse : refusé par l’ordinateur', bad.json);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok(!(await page.$('[data-testid="paper-menu"]')), 'Échap : retour au menu, puis fermeture');
  const closed = await req('GET', `${R}/state`);
  ok(closed.status !== 200, 'menu fermé : la réception par le Wi-Fi est fermée', closed.status);
  await page.waitForTimeout(300);

  // ── 4. Photo d'une page rattachée ──
  await page.locator('.lib-card', { hasText: 'Du contrat social' }).click();
  await page.waitForSelector('[data-testid="paper-page"]');
  // Un extrait d'un autre livre papier entre-temps : la proposition doit venir du titre courant lu en haut de la page.
  await st((id) => window.__store.getState().addHighlight({ bookId: id, category: null, plain: true, text: 'Le bon sens est la chose du monde la mieux partagée.', anchor: { kind: 'pdf', page: 1, rects: [] }, locationLabel: 'p. 1', printedPage: '1' }), desc.id);
  await page.click('[data-testid="paper-by-photo"]');
  await page.waitForSelector('[data-testid="wifi-receive"] .wr-qr');
  const info2 = await st(() => window.marginalia.inbox.wifiInfo());
  const K2 = keyOf(info2.urls[0].url);
  const R2 = `http://127.0.0.1:${info2.port}${info2.path}`;
  const up = await upload(R2, K2, { name: 'IMG_2041.JPG', bytes: PAGE_JPG });
  ok(up.status === 200, 'photo de la page envoyée par le téléphone', up.status);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="paper-proposal"]', { timeout: 120000 });
  const q = await page.locator('[data-testid="paper-proposal"] .pp-propose-q').innerText();
  ok(/« Du contrat social », p\. 48 \?/.test(q) && /titre lu en haut de la page/.test(q), 'proposition devinée en local : « Du contrat social », p. 48 ? (titre courant)', q);
  const pText = await page.locator('[data-testid="paper-proposal"] textarea').inputValue();
  ok(/ordre civil/.test(pText) && !/CONTRAT SOCIAL/.test(pText) && !/^48/.test(pText), 'texte de la page lu, sans le titre courant ni le numéro', pText.slice(0, 80));
  await shot('07-proposition-clair.png');
  await setTheme('dark');
  await shot('08-proposition-sombre.png');
  await setTheme('light');
  await page.click('[data-testid="paper-proposal-confirm"]');
  await page.waitForFunction(() => window.__store.getState().highlights.some((h) => h.printedPage === '48'), null, { timeout: 15000 });
  const h48 = await st(() => window.__store.getState().highlights.find((h) => h.printedPage === '48'));
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  ok(h48.bookId === gf.id && /ordre civil/.test(h48.text) && h48.locationLabel === 'p. 48' && /^photos\/[a-z0-9]+\.jpg$/.test(h48.photo) && fs.existsSync(path.join(userData, 'library', gf.id, h48.photo)), 'confirmé : extrait p. 48 rattaché au livre, photo rangée dans son dossier', { photo: h48.photo });
  await page.waitForSelector(`[data-hl="${h48.id}"] .pb-photo img`, { timeout: 10000 });
  ok(true, 'la photo de la page s’affiche avec l’extrait');
  await page.waitForTimeout(300);
  await shot('09-page-avec-photo.png');

  // ── 5. Réglage désactivé : aucune requête ──
  await st(() => window.__store.getState().updateSettings({ paperOnline: false }));
  await page.waitForTimeout(300);
  requests.length = 0;
  const off = await st(() => window.marginalia.paper.search('Le Prince'));
  const offIsbn = await st(() => window.marginalia.paper.isbn('9782080706881'));
  ok(off.off && offIsbn.off && requests.length === 0, 'réglage désactivé : aucune requête (même appelée directement)', requests);
  await st(() => window.__store.getState().navigate({ name: 'library' }));
  await page.click('[data-testid="paper-add"]');
  await page.waitForSelector('[data-testid="paper-title"]');
  ok(!(await page.$('[data-testid="paper-search"]')) && !(await page.$('[data-testid="paper-scan"]')), 'réglage désactivé : seule la saisie à la main');
  await page.fill('[data-testid="paper-title"]', 'Le Prince');
  await page.fill('[data-testid="paper-author"]', 'Machiavel');
  await page.fill('[data-testid="paper-publisher"]', 'GF Flammarion');
  await page.fill('[data-testid="paper-year"]', '1992');
  await page.setInputFiles('[data-testid="paper-cover-file"]', { name: 'couverture.jpg', mimeType: 'image/jpeg', buffer: covers.get('prince') });
  await page.waitForSelector('.pp-cover-pick img');
  await shot('10-menu-main-clair.png');
  await page.click('[data-testid="paper-manual-add"]');
  await page.waitForFunction(() => window.__store.getState().books.some((b) => b.title === 'Le Prince'));
  const prince = await st(() => window.__store.getState().books.find((b) => b.title === 'Le Prince'));
  ok(prince.format === 'paper' && prince.author === 'Machiavel' && prince.edition.year === '1992' && prince.cover?.startsWith('data:image/jpeg') && requests.length === 0, 'saisie à la main avec photo de couverture (aucune requête)');
  await st(() => window.__store.getState().updateSettings({ paperOnline: true }));
  await page.waitForTimeout(300);
  await shot('11-bibliotheque-clair.png');
  await setTheme('dark');
  await shot('12-bibliotheque-sombre.png');
  await setTheme('light');

  // Aucune requête de l'interface vers Internet (le rendu bloque tout ; le journal des blocages reste vide d'hôtes de livres).
  const diagLog = fs.existsSync(path.join(userData, 'diagnostic.log')) ? fs.readFileSync(path.join(userData, 'diagnostic.log'), 'utf8') : '';
  ok(!/reseau-bloque.*(googleapis|openlibrary|googleusercontent|books\.google)/.test(diagLog), 'l’interface n’a tenté aucune requête vers Google ou Open Library');
  ok(errors.length === 0, 'aucune erreur dans la page', errors.slice(0, 5));
} catch (e) {
  console.error(e);
  ok(false, 'exception : ' + (e && e.message));
  await page.screenshot({ path: path.join(SHOTS, 'zz-erreur.png') }).catch(() => undefined);
} finally {
  await app.close().catch(() => undefined);
  server.close();
  console.log(`\n${nOk} OK, ${nKo} échec(s)`);
}
