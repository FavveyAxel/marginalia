// Interface du partage entre deux Marginalia, de bout en bout : deux processus Electron (dossiers de données
// distincts, réseau local simulé par MARGINALIA_E2E_LAN=127.0.0.1).
//  1. A partage un espace (écrit, carte, extraits, livre) : Partager › Envoyer par le Wi-Fi › code ; B le saisit
//     (Importer › Depuis un autre Marginalia), voit l'aperçu, A voit « … demande à recevoir » et accepte ; B a l'espace.
//  2. Refus de A ; mauvais code ; « déjà reçu ».
//  3. Livre reçu sans fichier : « Sans fichier » dans la bibliothèque, message dans le lecteur, « Importer le livre… »
//     complète l'entrée (aucun doublon).
//  4. Fichier .marginalia enregistré par A (livre joint), ouvert chez B (ouverture système, sélecteur, glisser-déposer) :
//     jamais importé comme livre ; aperçu puis import.
// Captures claires et sombres dans shots/partage/. Prérequis : npx vite build ; Xvfb (:99).
// Lancer : DISPLAY=:99 timeout 400 node scripts/test-share-ui.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = path.join(ROOT, 'shots/partage');
fs.mkdirSync(SHOTS, { recursive: true });
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
  console.error('dist/ manquant : lancez d’abord « npx vite build ».');
  process.exit(1);
}
const EPUB = path.join(ROOT, 'fixtures/discours.epub');
const dirs = [];
async function launch(name) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `mg-shui-${name}-`));
  dirs.push(home);
  const app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: path.join(home, 'donnees'), MARGINALIA_E2E_LAN: '127.0.0.1', VITE_DEV_SERVER_URL: '' },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 860 }).catch(() => {});
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { app, page, home, errors };
}
const theme = (p, t) => p.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), t).then(() => p.waitForTimeout(250));
/** Capture de la fenêtre ouverte, en clair puis en sombre. */
async function shotBoth(p, sel, name) {
  // La fenêtre tient dans son cadre : ni défilement, ni élément qui dépasse (avant : « Envoyé » défilait,
  // l'illustration réduite à 24 px débordait en bas à droite).
  await p.waitForTimeout(450);
  const fit = await p.evaluate((sel) => {
    const d = document.querySelector(sel);
    if (!d) return { absent: true };
    const r = d.getBoundingClientRect();
    const out = [...d.querySelectorAll('*')].filter((e) => {
      const b = e.getBoundingClientRect();
      // ce qui est replié (« L’autre ordinateur ne trouve pas ? ») ne compte pas : invisible tant qu’on n’ouvre pas
      if (e.checkVisibility && !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      if (e.closest('details:not([open]) > :not(summary)')) return false;
      return b.width > 0 && b.height > 0 && (b.right > r.right + 1 || b.bottom > r.bottom + 1 || b.left < r.left - 1);
    });
    return { scroll: d.scrollWidth > d.clientWidth + 1 || d.scrollHeight > d.clientHeight + 1, outside: out.map((e) => String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className)).slice(0, 4) };
  }, sel);
  ok(!fit.absent && !fit.scroll && !fit.outside.length, `${name} : la fenêtre tient dans son cadre`, fit);
  for (const [t, label] of [['light', 'clair'], ['dark', 'sombre']]) {
    await theme(p, t);
    await p.locator(sel).first().screenshot({ path: path.join(SHOTS, `${name}-${label}.png`) });
  }
  await theme(p, 'light');
}
const typeCode = async (p, code) => {
  // Saisie comme on la lit à l'écran : « 735-700 ».
  await p.locator('[data-testid="receive-code-input"]').fill(`${code.slice(0, 3)}-${code.slice(3)}`);
};
const openReceive = async (p) => {
  await p.evaluate(() => window.__store.getState().navigate({ name: 'import' }));
  await p.click('[data-testid="import-share-open"]');
  await p.waitForSelector('[data-testid="receive-dialog"]');
};
const closeDialog = async (p) => {
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
};

const A = await launch('envoi');
const B = await launch('reception');
try {
  // ── Préparation de A : un espace avec un livre, deux extraits, un écrit et une carte ──
  const epubB64 = fs.readFileSync(EPUB).toString('base64');
  const mdText = '# Dissertation sur le bon sens\n\nIntroduction : le bon sens est-il la chose du monde la mieux partagée ?\n';
  const seeded = await A.page.evaluate(
    async ({ epubB64, mdText }) => {
      const s = () => window.__store.getState();
      const bytes = Uint8Array.from(atob(epubB64), (c) => c.charCodeAt(0));
      const [book] = await s().importFiles([{ name: 'Discours de la méthode.epub', data: bytes.buffer }]);
      const ws = s().createWorkspace('Philosophie').id;
      s().navigate({ name: 'workspace', workspaceId: ws, groupId: null });
      s().addToWorkspace(ws, null, 'book', book.id);
      const anchor = (i) => ({ kind: 'html', chapter: 0, start: i, end: i + 20, prefix: '', suffix: '' });
      s().addHighlight({ bookId: book.id, category: 'these', text: 'Le bon sens est la chose du monde la mieux partagée', anchor: anchor(0), locationLabel: 'Première partie', note: 'Ma note' });
      s().addHighlight({ bookId: book.id, category: 'argument', text: 'la diversité de nos opinions', anchor: anchor(40), locationLabel: 'Première partie' });
      await s().importFiles([{ name: 'Dissertation.md', data: new TextEncoder().encode(mdText).buffer }]);
      const now = Date.now();
      const board = 'board-shui';
      s().setMap(board, { id: board, kind: 'board', bookId: '', title: 'Comparer', bookIds: [book.id], viewport: null, zones: [], nodes: [{ id: 'n1', highlightId: null, text: 'Idée libre', x: 0, y: 0 }], edges: [], createdAt: now, updatedAt: now });
      s().addToWorkspace(ws, null, 'map', board);
      return { ws, book: book.id, drafts: s().drafts.length };
    },
    { epubB64, mdText },
  );
  ok(seeded.drafts === 1, 'A : espace « Philosophie » prêt (livre, 2 extraits, 1 écrit, 1 carte)', seeded);
  // L'importation d'un .md depuis l'espace l'a rangé dans l'espace : on vérifie.
  ok((await A.page.evaluate(() => window.__store.getState().wsItems.map((i) => i.kind).sort().join())) === 'book,draft,map', 'A : l’espace contient le livre, l’écrit et la carte');

  // ── 1. Menu « ⋯ » de l'espace › Partager l'espace… ──
  await A.page.click('button[aria-label="Actions"]');
  await A.page.locator('.ws-menu .menu-item', { hasText: 'Partager' }).click();
  await A.page.getByText('Envoyer une copie…').click();
  await A.page.waitForSelector('[data-testid="share-dialog"]');
  await A.page.waitForSelector('[data-testid="share-summary"]');
  const sum = await A.page.textContent('[data-testid="share-summary"]');
  ok(/Philosophie/.test(sum) && /1 écrit/.test(sum) && /1 carte/.test(sum) && /2 extraits/.test(sum), 'Partager : résumé (titre, écrit, carte, extraits)', sum.replace(/\s+/g, ' '));
  ok(!(await A.page.isChecked('[data-testid="share-include-books"]')), '« Joindre les livres » décochée par défaut');
  const bookLine = await A.page.textContent('.sh-books');
  ok(/Mo|Ko/.test(bookLine), 'la case « Joindre les livres » indique la taille', bookLine.replace(/\s+/g, ' '));
  await shotBoth(A.page, '[data-testid="share-dialog"]', '01-partager-choix');

  await A.page.click('[data-testid="share-wifi"]');
  await A.page.waitForSelector('[data-testid="share-code"]');
  const code1 = await A.page.getAttribute('[data-testid="share-code"]', 'data-code');
  ok(/^\d{6}$/.test(code1), 'Envoyer par le Wi-Fi : grand code à 6 chiffres', code1);
  ok(/Valable encore (\d+ min )?\d+ s/.test(await A.page.textContent('.sh-left')), 'durée restante affichée');
  ok(/En attente…/.test(await A.page.textContent('[data-testid="share-status"]')), '« En attente… »');
  ok(/Pas de Wi-Fi commun \?/.test(await A.page.textContent('.br-trouble')), 'indication « Pas de Wi-Fi commun ? »');
  await shotBoth(A.page, '[data-testid="share-dialog"]', '02-wifi-code');

  // B : Importer › Depuis un autre Marginalia
  await openReceive(B.page);
  await shotBoth(B.page, '[data-testid="receive-dialog"]', '05-recevoir-code');
  ok(/Pas de Wi-Fi commun \?/.test(await B.page.textContent('.br-trouble')), 'Recevoir : indication « Pas de Wi-Fi commun ? »');
  await typeCode(B.page, code1);
  await B.page.waitForSelector('[data-testid="receive-preview"]', { timeout: 30000 });
  const prev = await B.page.textContent('[data-testid="receive-preview"]');
  ok(/Philosophie/.test(prev) && /1 écrit/.test(prev) && /1 carte/.test(prev) && /2 extraits/.test(prev) && /sans fichier/.test(prev), 'B : aperçu (titre, écrits, cartes, extraits, livre sans fichier)', prev.replace(/\s+/g, ' ').slice(0, 220));
  ok(!(await B.page.isVisible('[data-testid="receive-already"]')), 'B : pas de « déjà reçu » la première fois');
  await shotBoth(B.page, '[data-testid="receive-dialog"]', '06-recevoir-apercu');

  // A voit la demande
  await A.page.waitForSelector('[data-testid="share-request"]', { timeout: 15000 });
  const ask = await A.page.textContent('[data-testid="share-request"]');
  ok(/demande à recevoir « Philosophie »/.test(ask), 'A : « … demande à recevoir « Philosophie » »', ask.replace(/\s+/g, ' '));
  await shotBoth(A.page, '[data-testid="share-dialog"]', '03-demande');
  await B.page.click('[data-testid="receive-go"]');
  await B.page.waitForSelector('[data-testid="receive-progress"]');
  ok(/accord/.test(await B.page.textContent('[data-testid="receive-progress"]')), 'B : « En attente de l’accord de l’expéditeur… »');
  await A.page.click('[data-testid="share-accept"]');
  await B.page.waitForSelector('[data-testid="receive-result"]', { timeout: 30000 });
  await A.page.waitForSelector('[data-testid="share-done"]', { timeout: 15000 });
  ok(/Envoyé ✓/.test(await A.page.textContent('[data-testid="share-done"]')), 'A : « Envoyé ✓ »');
  const sentence = await B.page.textContent('[data-testid="receive-sentence"]');
  ok(/1 écrit/.test(sentence) && /1 carte/.test(sentence) && /2 extraits/.test(sentence), 'B : résultat (phrase de résumé)', sentence);
  ok(/Ouvrir l’espace/.test(await B.page.textContent('[data-testid="receive-open"]')), 'B : bouton « Ouvrir l’espace »');
  await shotBoth(A.page, '[data-testid="share-dialog"]', '04-envoye');
  await shotBoth(B.page, '[data-testid="receive-dialog"]', '07-recevoir-resultat');
  const bState = await B.page.evaluate(() => {
    const s = window.__store.getState();
    return { ws: s.workspaces.map((w) => w.name), books: s.books.map((b) => ({ missing: !!b.missing, title: b.title })), drafts: s.drafts.length, hl: s.highlights.length, maps: Object.keys(s.maps).length };
  });
  ok(bState.ws.join() === 'Philosophie' && bState.drafts === 1 && bState.hl === 2 && bState.books.length === 1 && bState.books[0].missing && bState.maps >= 1, 'B : espace, écrit, extraits, carte et livre (sans fichier) créés', bState);
  await B.page.click('[data-testid="receive-open"]');
  await B.page.waitForTimeout(300);
  const route = await B.page.evaluate(() => window.__store.getState().route);
  ok(route.name === 'workspace', '« Ouvrir l’espace » ouvre l’espace reçu', route);
  ok(!(await B.page.isVisible('[data-testid="receive-dialog"]')), 'la fenêtre se ferme');
  await closeDialog(A.page);
  ok(!(await A.page.isVisible('[data-testid="share-dialog"]')), 'A : fenêtre fermée');

  // ── 2. Refus, déjà reçu, mauvais code ──
  await A.page.click('button[aria-label="Actions"]');
  await A.page.locator('.ws-menu .menu-item', { hasText: 'Partager' }).click();
  await A.page.getByText('Envoyer une copie…').click();
  await A.page.click('[data-testid="share-wifi"]');
  await A.page.waitForSelector('[data-testid="share-code"]');
  const code2 = await A.page.getAttribute('[data-testid="share-code"]', 'data-code');
  await openReceive(B.page);
  const wrong = String((Number(code2) + 1) % 1000000).padStart(6, '0');
  const countB = () => B.page.evaluate(() => { const s = window.__store.getState(); return { w: s.workspaces.length, b: s.books.length, d: s.drafts.length, h: s.highlights.length }; });
  const beforeWrong = await countB();
  // Par diffusion : un mauvais code ne trouve aucun envoi. L'indice de découverte ne fait que 4 bits :
  // une fois sur 16, il correspond par hasard et c'est la preuve qui refuse (« Code incorrect »).
  await typeCode(B.page, wrong);
  await B.page.waitForSelector('[data-testid="receive-error"]', { timeout: 30000 });
  const e0 = await B.page.textContent('[data-testid="receive-error"]');
  ok(/Aucun envoi trouvé avec ce code sur ce réseau|Code incorrect/.test(e0), 'mauvais code (diffusion) : « Aucun envoi trouvé avec ce code… »', e0.slice(0, 80));
  // Par adresse saisie (« Saisir une adresse ») : « Code incorrect ».
  const addr = (await A.page.textContent('.sh-mono')).trim();
  await B.page.click('.br-trouble summary'); // aide repliée : « Rien n’est trouvé ? »
  await B.page.click('[data-testid="receive-manual"]');
  await B.page.fill('[data-testid="receive-address"]', addr);
  await B.page.click('[data-testid="receive-search"]');
  await B.page.waitForFunction(() => /Code incorrect/.test(document.querySelector('[data-testid="receive-error"]')?.textContent ?? ''), null, { timeout: 30000 });
  const e1 = await B.page.textContent('[data-testid="receive-error"]');
  // Mauvais code : rien n'est téléchargé ni ajouté chez B, et A ne voit aucune demande.
  await B.page.waitForTimeout(1500);
  ok(JSON.stringify(await countB()) === JSON.stringify(beforeWrong), 'mauvais code : rien n’est arrivé chez B (espaces, livres, écrits, extraits inchangés)', await countB());
  ok(!(await A.page.$('[data-testid="share-request"]')), 'mauvais code : aucune demande n’apparaît chez A');
  ok(!(await B.page.$('[data-testid="receive-preview"], .sh-preview')), 'mauvais code : aucun aperçu chez B');
  ok(/Code incorrect/.test(e1), 'mauvais code (adresse saisie) : « Code incorrect »', e1);
  await shotBoth(B.page, '[data-testid="receive-dialog"]', '09-erreur-code');
  // (A n’est averti que si le code passe le filtre d’indice de 4 bits : non déterministe : non vérifié ici.)
  await closeDialog(B.page);
  await openReceive(B.page);
  await typeCode(B.page, code2);
  await B.page.waitForSelector('[data-testid="receive-already"]', { timeout: 30000 });
  ok(/Déjà reçu/.test(await B.page.textContent('[data-testid="receive-already"]')), 'B : « Déjà reçu » (même partage reçu plus tôt)');
  await shotBoth(B.page, '[data-testid="receive-dialog"]', '06b-recevoir-deja-recu');
  await A.page.waitForSelector('[data-testid="share-request"]');
  await B.page.click('[data-testid="receive-go"]');
  await A.page.click('[data-testid="share-reject"]');
  await B.page.waitForSelector('[data-testid="receive-error"]', { timeout: 30000 });
  ok(/L’envoi a été refusé\./.test(await B.page.textContent('[data-testid="receive-error"]')), 'refus : B lit « L’envoi a été refusé. »');
  ok((await B.page.evaluate(() => window.__store.getState().workspaces.length)) === 1, 'refus : rien n’a été ajouté chez B');
  ok(/Demande refusée/.test(await A.page.textContent('.sh-wifi')) && !(await A.page.isVisible('[data-testid="share-request"]')), 'A : demande refusée, le code reste affiché');
  await closeDialog(B.page);
  await closeDialog(A.page);

  // ── 3. Livre reçu sans fichier ──
  await B.page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await B.page.waitForSelector('[data-testid="lib-nofile"]');
  ok(/Sans fichier/.test(await B.page.textContent('[data-testid="lib-nofile"]')), 'bibliothèque de B : mention « Sans fichier »');
  await theme(B.page, 'light');
  await B.page.screenshot({ path: path.join(SHOTS, '11-bibliotheque-sans-fichier-clair.png') });
  await theme(B.page, 'dark');
  await B.page.screenshot({ path: path.join(SHOTS, '11-bibliotheque-sans-fichier-sombre.png') });
  await theme(B.page, 'light');
  const bid = await B.page.evaluate(() => window.__store.getState().books[0].id);
  await B.page.evaluate((id) => window.__store.getState().openBook(id), bid);
  await B.page.waitForSelector('[data-testid="reader-missing"]');
  ok(/arrivé sans son fichier/.test(await B.page.textContent('[data-testid="reader-missing"]')), 'lecteur : message clair pour un livre sans fichier');
  await theme(B.page, 'light');
  await B.page.screenshot({ path: path.join(SHOTS, '10-lecteur-sans-fichier-clair.png') });
  await theme(B.page, 'dark');
  await B.page.screenshot({ path: path.join(SHOTS, '10-lecteur-sans-fichier-sombre.png') });
  await theme(B.page, 'light');
  // Un autre fichier : ajouté à part, le livre reste sans fichier.
  await B.app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, path.join(ROOT, 'fixtures/discours.html'));
  await B.page.click('[data-testid="reader-import-missing"]');
  await B.page.waitForTimeout(1500);
  ok((await B.page.evaluate(() => window.__store.getState().books.filter((b) => b.missing).length)) === 1, 'un autre fichier ne complète pas le livre');
  await B.page.evaluate((id) => window.__store.getState().openBook(id), bid);
  await B.page.waitForSelector('[data-testid="reader-missing"]');
  // Le bon fichier : complète l'entrée, aucun doublon.
  const before = await B.page.evaluate(() => window.__store.getState().books.length);
  await B.app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, EPUB);
  await B.page.click('[data-testid="reader-import-missing"]');
  await B.page.waitForFunction((id) => !window.__store.getState().books.find((b) => b.id === id)?.missing, bid, { timeout: 30000 });
  const after = await B.page.evaluate((id) => {
    const s = window.__store.getState();
    const b = s.books.find((x) => x.id === id);
    return { n: s.books.length, missing: !!b.missing, hl: s.highlights.filter((h) => h.bookId === id).length, name: b.fileName };
  }, bid);
  ok(after.n === before && !after.missing && after.hl === 2, 'le même fichier (même SHA-256) complète le livre : pas de doublon, extraits rattachés', after);
  await B.page.waitForSelector('.html-doc [data-chapter], .reader-pane-body iframe, .reader-pane-body .html-doc', { timeout: 30000 });
  ok(!(await B.page.isVisible('[data-testid="reader-missing"]')), 'le lecteur ouvre maintenant le livre');

  // ── 4. Fichier .marginalia ──
  const out = path.join(A.home, 'Partage test.marginalia');
  await A.app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, out);
  await A.page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await A.page.click('.msel-toggle');
  await A.page.click('.lib-card [role="checkbox"], .lib-card .msel-check, .lib-card input[type="checkbox"], .lib-card .select-check');
  await A.page.click('[data-testid="lib-share"]');
  await A.page.waitForSelector('[data-testid="share-summary"]');
  await A.page.check('[data-testid="share-include-books"]');
  ok(/fichiers? joints?/.test(await A.page.textContent('[data-testid="share-summary"]')), 'bibliothèque : « Partager… » avec « Joindre les livres »');
  await A.page.click('[data-testid="share-save"]');
  await A.page.waitForSelector('[data-testid="share-saved"]', { timeout: 30000 });
  ok(fs.existsSync(out) && fs.statSync(out).size > fs.statSync(EPUB).size, 'fichier .marginalia enregistré (livre joint)', fs.existsSync(out) ? fs.statSync(out).size : 0);
  ok(fs.readFileSync(out).subarray(0, 2).toString() === 'PK', 'c’est une archive ZIP');
  await shotBoth(A.page, '[data-testid="share-dialog"]', '08-fichier-enregistre');
  await closeDialog(A.page);

  const fileB64 = fs.readFileSync(out).toString('base64');
  const booksBefore = await B.page.evaluate(() => window.__store.getState().books.length);
  // 4a. Ouverture par le système (double-clic / « Ouvrir avec »)
  await B.app.evaluate(({ BrowserWindow }, b64) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.send('marginalia:open-files', [{ name: 'Partage test.marginalia', data: Buffer.from(b64, 'base64') }]);
  }, fileB64);
  await B.page.waitForSelector('[data-testid="receive-preview"]', { timeout: 30000 });
  const p2 = await B.page.textContent('[data-testid="receive-preview"]');
  ok(/Fichier de partage/.test(p2) && /fichiers? joints?/.test(p2) && /déjà chez vous/.test(p2), 'ouverture du fichier : aperçu (livre joint, déjà chez vous)', p2.replace(/\s+/g, ' ').slice(0, 220));
  ok((await B.page.evaluate(() => window.__store.getState().books.length)) === booksBefore, 'le .marginalia n’est pas importé comme livre');
  await shotBoth(B.page, '[data-testid="receive-dialog"]', '06c-recevoir-fichier');
  await closeDialog(B.page);
  // 4b. « Choisir des fichiers… »
  await B.app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, out);
  await B.page.evaluate(() => window.__store.getState().navigate({ name: 'import' }));
  await B.page.click('.imp-drop-actions .btn-primary');
  await B.page.waitForSelector('[data-testid="receive-preview"]', { timeout: 30000 });
  ok(true, '« Choisir des fichiers… » ouvre l’aperçu d’un .marginalia');
  ok((await B.page.evaluate(() => window.__store.getState().books.length)) === booksBefore && !(await B.page.isVisible('[data-testid="import-result"]')), 'rien importé comme livre');
  await closeDialog(B.page);
  // 4c. Glisser-déposer sur la page Importer
  await B.page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'Partage test.marginalia'));
    document.querySelector('[data-testid="import-drop"]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, fileB64);
  await B.page.waitForSelector('[data-testid="receive-preview"]', { timeout: 30000 });
  ok(true, 'glisser-déposer sur la page Importer ouvre l’aperçu');
  await B.page.click('[data-testid="receive-go"]');
  await B.page.waitForSelector('[data-testid="receive-result"]', { timeout: 60000 });
  const fin = await B.page.evaluate(() => {
    const s = window.__store.getState();
    return { books: s.books.length, missing: s.books.filter((b) => b.missing).length, ws: s.workspaces.map((w) => w.name), hl: s.highlights.length };
  });
  ok(fin.books === booksBefore && fin.missing === 0 && fin.ws.length === 1 && fin.hl === 4, 'import du fichier : aucun doublon de livre, extraits rattachés au livre présent', fin);
  ok(/Voir dans la bibliothèque/.test(await B.page.textContent('[data-testid="receive-open"]')), 'résultat d’une sélection : « Voir dans la bibliothèque »');
  await shotBoth(B.page, '[data-testid="receive-dialog"]', '07b-recevoir-resultat-bibliotheque');
  await closeDialog(B.page);

  ok(A.errors.length === 0 && B.errors.length === 0, 'aucune erreur de page', [...A.errors, ...B.errors].slice(0, 3));
} finally {
  await A.app.close().catch(() => {});
  await B.app.close().catch(() => {});
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}
