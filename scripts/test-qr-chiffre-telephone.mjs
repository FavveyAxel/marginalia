// Échanges par QR code chiffrés, vus du téléphone : les deux pages (electron/wifi-page.html,
// electron/wifi-send.html) ouvertes dans Chromium en taille téléphone (390 × 844), sur une adresse
// http qui n'est PAS un contexte sécurisé (nom « marginalia-test.lan » dirigé vers 127.0.0.1 : comme
// http://192.168.x.y, crypto.subtle n'y existe pas). Vrai aller-retour à travers les pages : envoi
// d'une photo, d'une grosse image (plusieurs blocs) et d'un texte ; téléchargement de deux PDF (le
// second sur plusieurs blocs). Tout passe par un relais qui garde le trafic (rien en clair) et qui
// sait l'altérer (bloc modifié en chemin : refusé des deux côtés). Lien sans fragment ou mauvaise
// clé : message, et aucune requête. Serveurs : electron/wifi.cjs tel quel, dans Node (sans Electron).
// Lancer : timeout 180 node scripts/test-qr-chiffre-telephone.mjs        Captures : shots/qr-chiffre/
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { keyOf, captureProxy, leaks, nacl, CHUNK } from './qr-telephone.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = path.join(ROOT, 'shots/qr-chiffre');
fs.mkdirSync(SHOTS, { recursive: true });
process.env.MARGINALIA_E2E = '1';
process.env.MARGINALIA_E2E_LAN = '192.168.1.24';
const require = createRequire(import.meta.url);
const wifi = require(path.join(ROOT, 'electron/wifi.cjs'));
const HOST = 'marginalia-test.lan';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
let failed = 0;
let passed = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (c) passed++;
  else failed++;
};
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  console.log('capture: shots/qr-chiffre/' + name);
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-qr-'));
const events = [];
const receiver = wifi.createReceiver({ dir: () => path.join(TMP, 'recus'), taken: () => false, isLocked: () => false, emit: (e) => events.push(e), pagePath: path.join(ROOT, 'electron/wifi-page.html') });
const sender = wifi.createSender({ isLocked: () => false, emit: (e) => events.push(e), pagePath: path.join(ROOT, 'electron/wifi-send.html') });
const rInfo = await receiver.start();
const PDF1 = fs.readFileSync(path.join(ROOT, 'fixtures/discours.pdf'));
const PDF2 = Buffer.concat([PDF1, crypto.randomBytes(Math.round(2.3 * CHUNK))]); // trois blocs
const N1 = 'Explication — Descartes, Discours.pdf';
const N2 = 'Annexes de la dissertation.pdf';
const sInfo = await sender.start([
  { name: N1, kind: 'pdf', mime: 'application/pdf', label: 'PDF', data: PDF1 },
  { name: N2, kind: 'pdf', mime: 'application/pdf', label: 'PDF', data: PDF2 },
]);
const relayR = await captureProxy(() => rInfo.port);
const relayS = await captureProxy(() => sInfo.port);
const KR = keyOf(rInfo.urls[0].url);
const KS = keyOf(sInfo.urls[0].url);
const urlR = (frag) => `http://${HOST}:${relayR.port}${rInfo.path}${frag}`;
const urlS = (frag) => `http://${HOST}:${relayS.port}${sInfo.path}${frag}`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  // Système de fichiers en UTF-8, comme sur un téléphone : sans cela (LANG vide dans le conteneur),
  // Chromium remplace tout nom accentué par « download », même avec Content-Disposition.
  env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
  args: ['--no-sandbox', '--no-proxy-server', `--host-resolver-rules=MAP ${HOST} 127.0.0.1`],
});
const phone = () => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE, acceptDownloads: true, locale: 'fr-FR' });
const errors = [];
/** Page neuve ; garde les requêtes qu'elle fait (pour vérifier que rien ne part sans clé). */
async function open(ctx, url) {
  const page = await ctx.newPage();
  const reqs = [];
  page.on('request', (r) => reqs.push(`${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  await page.goto(url);
  return { page, reqs };
}

try {
  // ── Contexte non sécurisé : la règle qui impose une bibliothèque embarquée ──
  {
    const ctx = await phone();
    const { page } = await open(ctx, urlR(`#k=${Buffer.from(KR).toString('base64url')}`));
    const env = await page.evaluate(() => ({ secure: window.isSecureContext, subtle: typeof (window.crypto && window.crypto.subtle), grv: typeof window.crypto.getRandomValues, nacl: typeof window.nacl, mg: typeof window.mgCrypt }));
    ok(env.secure === false && env.subtle === 'undefined' && env.grv === 'function', 'adresse http locale : pas un contexte sécurisé, crypto.subtle absent, getRandomValues présent', env);
    ok(env.nacl === 'object' && env.mg === 'object', 'bibliothèque embarquée chargée sous la CSP (nonce)', env);
    await ctx.close();
  }

  // ── Lien incomplet ou mauvaise clé : message, et aucune requête ──
  for (const [label, frag, url, shotName] of [
    ['réception, sans fragment', '', urlR, '01-reception-sans-cle.png'],
    ['réception, mauvaise clé', `#k=${Buffer.from(nacl.randomBytes(32)).toString('base64url')}`, urlR, '02-reception-mauvaise-cle.png'],
    ['envoi, sans fragment', '', urlS, '07-envoi-sans-cle.png'],
    ['envoi, mauvaise clé', `#k=${Buffer.from(nacl.randomBytes(32)).toString('base64url')}`, urlS, null],
  ]) {
    const ctx = await phone();
    const { page, reqs } = await open(ctx, url(frag));
    await page.waitForTimeout(800);
    const msg = await page.locator('#nokey').innerText().catch(() => '');
    const shown = await page.locator('#nokey').isVisible();
    ok(shown && msg.includes('Ce lien est incomplet : scannez le QR code affiché par Marginalia.'), `${label} : message clair`, msg.split('\n')[0]);
    ok(reqs.length === 1 && reqs[0].startsWith('GET /'), `${label} : rien d’autre n’est demandé ni envoyé`, reqs);
    if (url === urlR) {
      await page.setInputFiles('#camera', { name: 'IMG_0001.JPG', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff]) }).catch(() => {});
      await page.waitForTimeout(400);
      ok(reqs.length === 1, `${label} : une photo choisie quand même ne part pas`, reqs);
    } else ok((await page.locator('#files li').count()) === 0, `${label} : aucune liste de documents`);
    if (shotName) await shot(page, shotName);
    await ctx.close();
  }

  // ── Réception : vrai envoi depuis la page ──
  const ctx = await phone();
  const { page, reqs } = await open(ctx, urlR(`#k=${Buffer.from(KR).toString('base64url')}`));
  await page.waitForTimeout(300);
  ok(!(await page.locator('#nokey').isVisible()) && (await page.locator('#computer').innerText()) === os.hostname().replace(/\.local$/i, '').slice(0, 60), 'bonne clé : nom de l’ordinateur déchiffré et affiché');
  ok((await page.evaluate(() => location.hash)) === '', 'la clé est retirée de la barre d’adresse');
  await shot(page, '03-reception-ouverte.png');
  const PHOTO = fs.readFileSync(path.join(ROOT, 'fixtures/cover.png'));
  const PNAME = 'Page 42 du Discours, annotée.png';
  await page.setInputFiles('#camera', { name: PNAME, mimeType: 'image/png', buffer: PHOTO });
  await page.waitForSelector('.li.ok', { timeout: 15000 });
  const got1 = events.find((e) => e.type === 'received');
  ok(got1 && got1.name === PNAME && fs.readFileSync(path.join(TMP, 'recus', PNAME)).equals(PHOTO), 'photo envoyée par la page : reçue, déchiffrée, identique', got1?.name);
  const LABEL = 'Extrait ajouté à « Discours de la méthode », p. 42';
  receiver.report(PNAME, { state: 'extract', label: LABEL });
  await page.waitForSelector('.li-res.done', { timeout: 10000 });
  ok((await page.locator('.li-res.done').innerText()) === 'Extrait ajouté à « Discours de la méthode », p. 42', 'devenir de l’envoi : libellé déchiffré par la page');
  ok(reqs.some((r) => /^GET \/r\/[^/]+\/result\?id=[A-Za-z0-9_-]{22}$/.test(r)) && !reqs.some((r) => /name=|Page|Discours/.test(r)), 'devenir demandé par identifiant opaque, jamais par le nom', reqs.filter((r) => r.includes('result'))[0]);
  // Grosse image : trois blocs d'1 Mio.
  const BIG = Buffer.concat([PHOTO, crypto.randomBytes(Math.round(2.4 * CHUNK))]);
  await page.setInputFiles('#files', { name: 'Tableau noir, cours du 12.png', mimeType: 'image/png', buffer: BIG });
  await page.waitForFunction(() => document.querySelectorAll('.li.ok').length === 2, null, { timeout: 30000 });
  ok(fs.readFileSync(path.join(TMP, 'recus', 'Tableau noir, cours du 12.png')).equals(BIG), 'grosse image (3 blocs) : reçue intacte');
  // Texte collé
  const TEXT = '“Je pense, donc je suis.”\n\nÀ relier à la Méditation seconde : le cogito comme premier principe.';
  await page.click('#text-toggle');
  await page.fill('#text', TEXT);
  await page.click('#text-send');
  await page.waitForFunction(() => document.querySelectorAll('.li.ok').length === 3, null, { timeout: 15000 });
  const txt = events.filter((e) => e.type === 'received').at(-1);
  ok(txt.kind === 'text' && fs.readFileSync(path.join(TMP, 'recus', txt.name), 'utf8') === TEXT, 'texte collé : reçu en UTF-8', txt.name);
  await shot(page, '04-reception-envoyes.png');
  // Bloc altéré en chemin : l'ordinateur refuse, la page le dit (réponse chiffrée, lue par la page).
  let flipped = false;
  relayR.alter = (d, dir) => {
    if (dir === 'up' && !flipped && d.length > 20000) {
      d[d.length >> 1] ^= 1;
      flipped = true;
    }
    return d;
  };
  const before = fs.readdirSync(path.join(TMP, 'recus')).length;
  await page.setInputFiles('#files', { name: 'Altéré en chemin.png', mimeType: 'image/png', buffer: BIG });
  await page.waitForSelector('.li.err', { timeout: 30000 });
  relayR.alter = null;
  const errTxt = await page.locator('.li.err .li-err').innerText();
  ok(flipped && /altéré en chemin/.test(errTxt) && fs.readdirSync(path.join(TMP, 'recus')).length === before, 'bloc modifié par le réseau : refusé, rien d’écrit, message sur le téléphone', errTxt);
  await shot(page, '05-reception-bloc-altere.png');
  // Rechargement : la clé est gardée pour l'onglet.
  await page.reload();
  await page.waitForTimeout(300);
  ok(!(await page.locator('#nokey').isVisible()), 'rechargement de la page : la clé est gardée pour cet onglet');
  const seenR = relayR.traffic();
  const foundR = leaks(seenR, [PNAME, 'Page 42', 'Tableau noir', 'Je pense, donc je suis', 'Méditation seconde', 'Discours de la méthode', LABEL, 'Altéré en chemin', PHOTO.subarray(PHOTO.length >> 1, (PHOTO.length >> 1) + 32), PHOTO.subarray(16, 48), BIG.subarray(BIG.length - 40)]);
  ok(seenR.length > 5 * CHUNK && foundR.length === 0, 'réception : trafic capturé sans aucun clair (octets, noms, texte, libellés)', { octets: seenR.length, trouvés: foundR });
  await ctx.close();

  // ── Envoi au téléphone : téléchargement réel par la page ──
  const ctx2 = await phone();
  const s = await open(ctx2, urlS(`#k=${Buffer.from(KS).toString('base64url')}`));
  await s.page.waitForSelector('#files li', { timeout: 10000 });
  const items = await s.page.$$eval('#files li strong', (xs) => xs.map((x) => x.textContent));
  ok(items.join('|') === `${N1}|${N2}`, 'liste des documents : déchiffrée depuis le manifeste', items);
  ok((await s.page.locator('#how').innerText()).includes('Fichiers › Téléchargements'), 'aide iPhone : « Fichiers › Téléchargements »');
  await shot(s.page, '06-envoi-liste.png');
  for (const [i, name, data] of [[0, N1, PDF1], [1, N2, PDF2]]) {
    const dl = s.page.waitForEvent('download', { timeout: 20000 });
    await s.page.locator(`a[data-i="${i}"]`).tap();
    const d = await dl;
    const out = path.join(TMP, `dl-${i}.pdf`);
    await d.saveAs(out);
    ok(d.suggestedFilename() === name && fs.readFileSync(out).equals(data) && d.url().startsWith('blob:'), `PDF ${i + 1} : téléchargé par un lien blob:, nom et contenu exacts`, { nom: d.suggestedFilename(), octets: data.length });
  }
  await s.page.waitForTimeout(800);
  ok((await s.page.locator('a[data-i="0"]').innerText()).startsWith('Téléchargé ✓'), 'bouton : « Téléchargé ✓ (toucher pour recommencer) »');
  ok(events.filter((e) => e.type === 'downloaded').length === 2, 'ordinateur prévenu des deux téléchargements');
  ok(!s.reqs.some((r) => /Explication|Annexes|Descartes/.test(r)), 'aucune requête ne porte un nom de document', s.reqs);
  await shot(s.page, '08-envoi-telecharge.png');
  // Document altéré en chemin : la page refuse de l'enregistrer.
  const ctx3 = await phone();
  const s3 = await open(ctx3, urlS(`#k=${Buffer.from(KS).toString('base64url')}`));
  await s3.page.waitForSelector('#files li');
  let flippedDown = false;
  relayS.alter = (d, dir) => {
    if (dir === 'down' && !flippedDown && d.length > 20000) {
      d[d.length >> 1] ^= 1;
      flippedDown = true;
    }
    return d;
  };
  let downloads = 0;
  s3.page.on('download', () => downloads++);
  await s3.page.locator('a[data-i="1"]').tap();
  await s3.page.waitForSelector('.f-err', { timeout: 20000 });
  relayS.alter = null;
  const ferr = await s3.page.locator('.f-err').innerText();
  ok(flippedDown && /altéré en chemin/.test(ferr) && downloads === 0, 'document modifié par le réseau : refusé, rien d’enregistré', ferr);
  await shot(s3.page, '09-envoi-document-altere.png');
  await ctx3.close();
  const seenS = relayS.traffic();
  const foundS = leaks(seenS, [N1, N2, 'Explication', 'Annexes de la', PDF1.subarray(0, 32), PDF1.subarray(PDF1.length >> 1, (PDF1.length >> 1) + 32), PDF2.subarray(PDF2.length - 40)]);
  ok(seenS.length > 2 * CHUNK && foundS.length === 0, 'envoi : trafic capturé sans aucun clair (octets, noms)', { octets: seenS.length, trouvés: foundS });
  // (seule erreur attendue : le refus 400 du bloc altéré, voulu plus haut)
  const unexpected = errors.filter((e) => !/status of 400/.test(e));
  ok(unexpected.length === 0 && errors.length === 1, 'aucune erreur dans les pages (hors le refus voulu)', errors.slice(0, 3).join(' | '));
  await ctx2.close();
} finally {
  await browser.close();
  receiver.stop();
  sender.stop();
  await relayR.close();
  await relayS.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
