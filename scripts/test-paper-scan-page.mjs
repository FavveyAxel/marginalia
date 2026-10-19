// Page « Scanner un livre » servie au téléphone (electron/wifi-scan.html, par electron/wifi.cjs), dans
// Chromium en taille de téléphone : clé vérifiée, lecture d'un code-barres EAN-13 DESSINÉ (photo choisie
// → lecteur ZXing servi par l'app, sans Internet), résultat de lecture injecté, ISBN tapé ; l'ISBN part
// CHIFFRÉ (aucun chiffre de l'ISBN en clair dans tout le trafic, relevé par un relais), l'ordinateur le
// reçoit (événement « isbn ») et son devenir revient au téléphone. Code non-ISBN refusé sans envoi.
// Captures claires et sombres : shots/papier/.
// Lancer : timeout 180 node scripts/test-paper-scan-page.mjs
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { captureProxy, leaks } from './qr-telephone.mjs';

process.env.MARGINALIA_E2E = '1';
process.env.MARGINALIA_E2E_LAN = '127.0.0.1';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const wifi = require(path.join(ROOT, 'electron/wifi.cjs'));
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

/** Barres d'un EAN-13 (95 modules : 1 = barre). */
function ean13Bits(code) {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const d = code.split('').map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + '101';
}

const events = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-scan-'));
const rx = wifi.createReceiver({
  dir: () => dir,
  taken: () => false,
  isLocked: () => false,
  emit: (e) => events.push(e),
  pagePath: path.join(ROOT, 'electron/wifi-page.html'),
  scanPagePath: path.join(ROOT, 'electron/wifi-scan.html'),
});
const info = await rx.start();
const relay = await captureProxy(() => info.port);
const key = info.urls[0].url.split('#')[1];
const URL_ = `http://127.0.0.1:${relay.port}${info.path}/scan#${key}`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  for (const dark of [false, true]) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: dark ? 'dark' : 'light',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
    await page.goto(URL_);
    await page.waitForSelector('h1');
    const head = await page.evaluate(() => ({ h1: document.querySelector('h1').textContent, computer: document.getElementById('computer').textContent, closed: document.body.classList.contains('is-closed'), hash: location.hash, zx: typeof window.ZXing?.MultiFormatReader }));
    ok(head.h1 === 'Scanner un livre' && head.computer === os.hostname().replace(/\.local$/i, '').slice(0, 60) && !head.closed && head.hash === '' && head.zx === 'function', `${dark ? '[sombre] ' : ''}page ouverte : clé vérifiée, retirée de l’adresse, lecteur ZXing chargé depuis l’app`, head);
    if (dark) {
      await page.evaluate(() => window.mgScanInject('9782080706881'));
      await page.waitForSelector('.li.ok');
      await page.screenshot({ path: path.join(SHOTS, '14-telephone-scan-sombre.png') });
      console.log('capture: shots/papier/14-telephone-scan-sombre.png');
      ok(errors.length === 0, '[sombre] aucune erreur', errors);
      await ctx.close();
      continue;
    }
    relay.reset();
    const before = events.length;

    // 1. Photo d'un code-barres EAN-13 dessiné : lue sur le téléphone par ZXing (pas de BarcodeDetector ici).
    const png = await page.evaluate((bits) => {
      const m = 4;
      const c = document.createElement('canvas');
      c.width = (bits.length + 22) * m;
      c.height = 260;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#000';
      for (let i = 0; i < bits.length; i++) if (bits[i] === '1') g.fillRect((i + 11) * m, 20, m, 200);
      return c.toDataURL('image/png').split(',')[1];
    }, ean13Bits('9782080706881'));
    const detector = await page.evaluate(() => 'BarcodeDetector' in window);
    await page.setInputFiles('#shot', { name: 'code.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await page.waitForSelector('.li.ok', { timeout: 15000 });
    ok(true, `code-barres photographié lu sur le téléphone (${detector ? 'BarcodeDetector' : 'ZXing servi par l’app'})`);
    await page.waitForTimeout(300);
    const ev = events.slice(before).find((e) => e.type === 'isbn');
    ok(ev && ev.isbn === '9782080706881' && ev.device === 'iPhone' && /^isbn:/.test(ev.name), 'ordinateur : ISBN reçu (événement « isbn »)', ev);
    ok(fs.readdirSync(dir).length === 0, 'rien n’est écrit dans la boîte de réception (seul un ISBN)');


    // 2. Devenir renvoyé au téléphone, chiffré.
    rx.report(ev.name, { state: 'waiting', label: 'Du contrat social — GF Flammarion, 2001 : à confirmer sur l’ordinateur' });
    await page.waitForFunction(() => /à confirmer sur l’ordinateur/.test(document.querySelector('.li-res')?.textContent || ''), null, { timeout: 8000 });
    ok(true, 'téléphone : « … à confirmer sur l’ordinateur »');
    rx.report(ev.name, { state: 'library', label: 'Ajouté à la bibliothèque : « Du contrat social »' });
    await page.waitForFunction(() => /Ajouté à la bibliothèque/.test(document.querySelector('.li-res')?.textContent || ''), null, { timeout: 8000 });
    ok(await page.evaluate(() => document.querySelector('.li-res').className.includes('done')), 'téléphone : « Ajouté à la bibliothèque »');

    // 3. Résultat de lecture injecté (comme venu de la caméra en direct) : ISBN-10.
    await page.evaluate(() => window.mgScanInject('2-07-032870-8'));
    await page.waitForTimeout(800);
    const second = events.filter((e) => e.type === 'isbn').pop();
    ok(second && second.isbn === '9782070328703', 'résultat injecté (ISBN-10) : envoyé, converti en ISBN-13 par l’ordinateur', second?.isbn);

    // 4. Code d'un produit (pas un livre) : refusé sur le téléphone, rien ne part.
    const n0 = events.length;
    await page.evaluate(() => window.mgScanInject('4006381333931'));
    await page.waitForTimeout(500);
    ok(events.length === n0 && /n’est pas celui d’un livre/.test(await page.locator('#status').innerText()), 'code-barres d’un produit : refusé sur le téléphone, aucun envoi');

    // 5. ISBN tapé.
    await page.click('#isbn-toggle');
    await page.fill('#isbn', '978 2 08 127523 3');
    ok((await page.isDisabled('#isbn-send')) && /pas un ISBN valide/.test(await page.locator('#isbn-hint').innerText()), 'ISBN tapé à la clé fausse : bouton désactivé, explication');
    await page.fill('#isbn', '978-2-08-127523-2');
    await page.click('#isbn-send');
    await page.waitForTimeout(800);
    ok(events.filter((e) => e.type === 'isbn').pop()?.isbn === '9782081275232', 'ISBN tapé : envoyé');

    // 6. Chiffrement : aucun ISBN en clair dans le trafic (dans un sens comme dans l'autre).
    // 1b. Photo réaliste : dos de livre sombre, étiquette blanche, le fond touche presque la dernière barre
    //     (marge claire trop étroite pour une lecture directe), photo floue et bruitée en 1512 × 2016.
    const n1 = events.length;
    const real = await page.evaluate((bits) => {
      const c = document.createElement('canvas');
      c.width = 1512; c.height = 2016;
      const g = c.getContext('2d');
      g.fillStyle = '#2a2e36'; g.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * c.width, Math.random() * c.height, 3, 3); }
      g.fillStyle = '#f2f2ee'; g.fillRect(250, 980, 0, 0);
      const m = 6.2, x0 = 470, top = 930;
      g.fillStyle = '#f3f3ef'; g.fillRect(410, top - 15, x0 + bits.length * m + 3 - 410, 360);
      g.fillStyle = '#16161a';
      for (let i = 0; i < bits.length; i++) if (bits[i] === '1') g.fillRect(x0 + i * m, top, m, i < 3 || (i > 44 && i < 50) || i > 91 ? 175 : 160);
      g.font = '60px sans-serif'; g.fillText('9 782350 000121', 430, top + 230);
      const out = document.createElement('canvas'); out.width = c.width; out.height = c.height;
      const o = out.getContext('2d'); o.filter = 'blur(1.4px)'; o.drawImage(c, 0, 0);
      return out.toDataURL('image/jpeg', 0.82).split(',')[1];
    }, ean13Bits('9782350000121'));
    await page.setInputFiles('#shot', { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(real, 'base64') });
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && !events.slice(n1).some((e) => e.type === 'isbn')) await page.waitForTimeout(200);
    const ev2 = events.slice(n1).find((e) => e.type === 'isbn');
    ok(ev2 && ev2.isbn === '9782350000121', 'photo réaliste (fond sombre collé aux barres, flou) : code-barres retrouvé, recadré et lu', ev2 ? ev2.isbn : await page.locator('#status').innerText());

    const traffic = relay.traffic();
    const found = leaks(traffic, ['9782350000121', '9782080706881', '9782070328703', '9782081275232', '978-2-08-127523-2', 'Du contrat social', 'isbn']);
    ok(traffic.length > 2000 && found.length === 0, 'ISBN et titres jamais en clair sur le réseau (corps, adresses, réponses)', found);
    ok(errors.length === 0, 'aucune erreur (CSP comprise)', errors);
    await page.screenshot({ path: path.join(SHOTS, '13-telephone-scan-clair.png') });
    console.log('capture: shots/papier/13-telephone-scan-clair.png');
    await ctx.close();
  }

  // Lien sans clé : rien ne peut partir.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(URL_.split('#')[0]);
  ok(await p.evaluate(() => document.getElementById('nokey').classList.contains('show') && typeof window.mgScanInject === 'undefined'), 'lien sans clé : message, aucune action branchée');
  await ctx.close();
} catch (e) {
  console.error(e);
  ok(false, 'exception : ' + (e && e.message));
} finally {
  await browser.close();
  await relay.close();
  rx.stop('closed');
  console.log(`\n${nOk} OK, ${nKo} échec(s)`);
}
