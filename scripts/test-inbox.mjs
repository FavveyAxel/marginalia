// Test de la Boîte de réception (dossier simulé du navigateur : window.__inbox) — port 5293.
// Lancer : timeout 400 node scripts/test-inbox.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withApp, importFixture, shot } from './harness.mjs';
import { xhtml, zipEpub } from './fixtures-books.mjs';

const PORT = 5293;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'marg-inbox-'));
const SHOTS = 'shots/boite';
let failed = 0;
let passed = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${extra !== '' ? ' — ' + extra : ''}`);
  if (cond) passed++;
  else failed++;
};

const IMG = path.join(TMP, 'page.jpg');
const gen = spawnSync('python3', ['-I', path.join(ROOT, 'scripts/make-image-fixture.py'), IMG, path.join(TMP, 'page.txt')], { encoding: 'utf8' });
if (gen.status !== 0) throw new Error('fixture : ' + gen.stderr);

const DESCARTES = 'Le bon sens est la chose du monde la mieux partagée ; car chacun pense en être si bien pourvu, que ceux même qui sont les plus difficiles à contenter en toute autre chose n’ont point coutume d’en désirer plus qu’ils en ont.';

const drop = (page, name, content) =>
  page.evaluate(({ name, content, b64 }) => window.__inbox.add(name, b64 ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : content), {
    name,
    content: typeof content === 'string' ? content : null,
    b64: typeof content === 'string' ? null : Buffer.from(content).toString('base64'),
  });
const state = (page) => page.evaluate(() => ({ done: window.__inbox.done(), left: window.__inbox.list() }));
const waitDone = (page, name, timeout = 20000) => page.waitForFunction((n) => window.__inbox.done().includes(n), name, { timeout }).then(() => true, () => false);

await withApp(PORT, async (page, errors) => {
  const st = (fn) => page.evaluate(fn);
  const discours = await importFixture(page, 'fixtures/discours.epub');
  ok(!!discours, 'livre de test importé (discours.epub)');

  // Désactivée par défaut : pas d'entrée dans la barre latérale.
  ok(!(await page.$('.nav-item[aria-label="Boîte de réception"]')), 'boîte désactivée par défaut (pas d’entrée dans la barre latérale)');
  await st(() => window.__store.getState().navigate({ name: 'settings' }));
  await page.waitForSelector('#set-inbox');
  await shot(page, `${SHOTS}/01-reglages-off.png`);
  await page.click('button[aria-label="Recevoir depuis le téléphone"]');
  await page.waitForSelector('.set-inbox-dir');
  ok((await page.textContent('.set-inbox-dir')).includes('iCloud Drive › Marginalia'), 'réglage activé : dossier affiché');
  await page.locator('#set-inbox').scrollIntoViewIfNeeded();
  await shot(page, `${SHOTS}/02-reglages-on.png`);
  ok(!!(await page.$('.inbox-btn')), 'bouton de la boîte à côté d’« Importer »');
  ok(!(await page.$('.nav-item[aria-label="Boîte de réception"]')), 'boîte vide : pas d’entrée dans la barre latérale');

  // 1. Livre : rangé seul.
  const nBooks0 = await st(() => window.__store.getState().books.length);
  const epub = await zipEpub('Essai reçu', { 'ch1.xhtml': xhtml('Un', '<h1>Chapitre un</h1><p>Texte d’un livre envoyé depuis le téléphone.</p>') }, xhtml('Sommaire', '<nav epub:type="toc"><ol><li><a href="ch1.xhtml">Chapitre un</a></li></ol></nav>'), { author: 'Anonyme' });
  await drop(page, 'Essai reçu.epub', new Uint8Array(epub));
  ok(await waitDone(page, 'Essai reçu.epub'), 'EPUB rangé dans « Traités »');
  ok((await st(() => window.__store.getState().books.length)) === nBooks0 + 1, 'EPUB ajouté à la bibliothèque sans passer par la boîte');

  // 2. Texte retrouvé sans ambiguïté : extrait ajouté seul.
  const nH0 = await st(() => window.__store.getState().highlights.length);
  await drop(page, 'citation.txt', 'Le bon sens est la chose du monde la mieux partagée ; car chacun pense en être si bien pourvu, que ceux même qui sont les plus difficiles à contenter');
  ok(await waitDone(page, 'citation.txt', 30000), 'texte retrouvé : fichier rangé');
  const h = await st(() => window.__store.getState().highlights.at(-1));
  ok((await st(() => window.__store.getState().highlights.length)) === nH0 + 1 && h.bookId === discours && h.text.startsWith('Le bon sens'), 'extrait créé dans le bon livre', h && `${h.locationLabel} : « ${h.text.slice(0, 40)}… »`);

  // 3. Texte inconnu : attend dans la boîte.
  await drop(page, 'idée.txt', 'Penser la fatigue comme une forme de connaissance : relire Montaigne sur l’expérience, et comparer avec ce que dit Bergson de la durée.');
  // 4. Page web, lien, fichier inconnu.
  await drop(page, 'Article.html', '<html><head><title>Qu’est-ce que les Lumières ?</title></head><body><p>Sapere aude.</p></body></html>');
  await drop(page, 'Conférence.url', '[InternetShortcut]\nURL=https://example.org/conference\n');
  await drop(page, 'Archive.zip', new Uint8Array([80, 75, 3, 4, 0, 0]));
  // 5. Photo de page (OCR).
  await drop(page, 'IMG_0412.jpg', new Uint8Array(fs.readFileSync(IMG)));

  await st(() => window.__store.getState().navigate({ name: 'library' }));
  const alertDot = await page.waitForSelector('.nav-item[aria-label="Bibliothèque"] .nav-alert', { timeout: 30000 }).then(() => true, () => false);
  ok(alertDot, 'pastille « ! » à côté de « Bibliothèque »');
  ok(!(await page.$('.ib-banner')), 'pas de bandeau dans la bibliothèque');
  ok(!!(await page.$('.nav-item[aria-label="Boîte de réception"]')), 'éléments en attente : entrée dans la barre latérale');
  ok(!!(await page.$('.inbox-btn .inbox-badge')), 'pastille sur le bouton de la boîte');
  await shot(page, `${SHOTS}/06-bandeau-barre.png`);
  await st(() => window.__store.getState().navigate({ name: 'home' }));
  await page.waitForSelector('.home-hello');
  ok(!(await page.$('.ib-banner')), 'pas de bandeau sur l’accueil');
  await page.click('.inbox-btn');
  await page.waitForSelector('.ib-card[data-name="idée.txt"] .ib-note', { timeout: 30000 });
  ok((await page.textContent('.ib-card[data-name="idée.txt"] .ib-note')).includes('introuvable'), 'texte inconnu : « Passage introuvable »');
  await page.waitForSelector('.ib-card[data-name="Article.html"] .btn-primary');
  ok((await page.textContent('.ib-card[data-name="Article.html"] .ib-title')) === 'Qu’est-ce que les Lumières ?', 'page web : titre lu dans la page');
  await page.waitForSelector('.ib-card[data-name="Conférence.url"] a.btn');
  ok((await page.getAttribute('.ib-card[data-name="Conférence.url"] a.btn', 'href')) === 'https://example.org/conference', 'lien : adresse lue');
  ok((await page.textContent('.ib-card[data-name="Archive.zip"]')).includes('ne sait pas ouvrir'), 'fichier inconnu : message clair');

  const t0 = Date.now();
  const photoMatched = await page.waitForSelector('.ib-card[data-name="IMG_0412.jpg"] .ib-match', { timeout: 120000 }).then(() => true, () => false);
  ok(photoMatched, 'photo : texte lu et passage retrouvé', `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (photoMatched) ok((await page.textContent('.ib-card[data-name="IMG_0412.jpg"] .ib-match-book')).includes('Discours'), 'photo : bon livre proposé', (await page.textContent('.ib-card[data-name="IMG_0412.jpg"] .ib-match-where')) ?? '');
  await page.evaluate(() => document.querySelector('.ib-scroll').scrollTo(0, 0));
  await shot(page, `${SHOTS}/03-boite.png`);
  await page.locator('.ib-card[data-name="IMG_0412.jpg"]').scrollIntoViewIfNeeded();
  await shot(page, `${SHOTS}/04-photo.png`);

  // Photo : raccourcir le texte au passage voulu, chercher, ajouter.
  await page.fill('.ib-card[data-name="IMG_0412.jpg"] textarea', DESCARTES);
  await page.click('.ib-card[data-name="IMG_0412.jpg"] button:has-text("Chercher ce texte")');
  await page.waitForSelector('.ib-card[data-name="IMG_0412.jpg"] .ib-match', { timeout: 20000 });
  const nH1 = await st(() => window.__store.getState().highlights.length);
  await page.click('.ib-card[data-name="IMG_0412.jpg"] .ib-match-add');
  ok(await waitDone(page, 'IMG_0412.jpg'), 'photo : extrait ajouté puis fichier rangé');
  const h2 = await st(() => window.__store.getState().highlights.at(-1));
  ok((await st(() => window.__store.getState().highlights.length)) === nH1 + 1 && h2.text.includes('bon sens'), 'photo : extrait correspondant au passage choisi', h2 && `« ${h2.text.slice(0, 50)}… »`);

  // Texte inconnu → écrit.
  const nD0 = await st(() => window.__store.getState().drafts.length);
  await page.click('.ib-card[data-name="idée.txt"] button:has-text("Créer un écrit")');
  ok(await waitDone(page, 'idée.txt'), 'texte inconnu : écrit créé, fichier rangé');
  ok((await st(() => window.__store.getState().drafts.length)) === nD0 + 1, 'nouvel écrit dans la liste');

  // Page web → bibliothèque.
  const nB1 = await st(() => window.__store.getState().books.length);
  await page.click('.ib-card[data-name="Article.html"] .btn-primary');
  ok(await waitDone(page, 'Article.html'), 'page web ajoutée à la bibliothèque');
  ok((await st(() => window.__store.getState().books.length)) === nB1 + 1, 'page web : nouveau document');

  // Retirer.
  await page.click('.ib-card[data-name="Archive.zip"] .ib-dismiss');
  ok(await waitDone(page, 'Archive.zip'), 'retirer : fichier rangé sans rien créer');
  const left = (await state(page)).left;
  ok(left.length === 1 && left[0] === 'Conférence.url', 'reste seulement le lien', left.join(', '));
  ok((await page.textContent('.nav-item[aria-label="Boîte de réception"] .count')) === '1' && (await page.textContent('.inbox-badge')) === '1', 'compteurs à jour (barre et pastille)');
  await st(() => window.__store.getState().updateSettings({ sidebarCollapsed: true }));
  await page.waitForTimeout(400);
  await shot(page, `${SHOTS}/07-barre-repliee.png`);
  ok(!!(await page.$('.inbox-btn.rail')) && !!(await page.$('.foot-item[aria-label="Corbeille"]')), 'barre repliée : outils et boîte en icônes');
  await st(() => window.__store.getState().updateSettings({ sidebarCollapsed: false }));
  await shot(page, `${SHOTS}/05-apres.png`);

  // Désactivation : l'entrée disparaît.
  await st(() => window.__store.getState().updateSettings({ inbox: false }));
  await page.waitForFunction(() => !document.querySelector('.nav-item[aria-label="Boîte de réception"]') && !document.querySelector('.inbox-btn'));
  ok(true, 'désactivée : entrée et bouton retirés');
  await page.click('.foot-item[aria-label="Corbeille"]');
  ok((await page.textContent('.page-title')) === 'Corbeille', 'icône du bas : Corbeille s’ouvre');
  ok(errors.length === 0, 'aucune erreur dans la console', errors.slice(0, 3).join(' | '));
});

console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
