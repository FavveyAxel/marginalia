// App Electron hors macOS (Linux suit la branche Windows / « non-Mac ») : menus Fichier / Édition /
// Affichage / Aide sans menu « app », barre de titre superposée, classe platform-linux, Livres
// désactivé, HEIC / TIFF convertis par le décodeur embarqué (app://, CSP, sans réseau), polices,
// fichier passé en argument puis via « second-instance », réseau sortant toujours bloqué.
// Lancer : DISPLAY=:99 timeout 300 node scripts/test-electron-platform.mjs  (après npm run package)
import { _electron as electron } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APP_DIR = path.join(ROOT, 'release/Marginalia-darwin-arm64/Marginalia.app/Contents/Resources/app');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-plat-'));
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};

const JPG = path.join(TMP, 'page.jpg');
const HEIC = path.join(TMP, 'Photo page.heic');
const TIFF = path.join(TMP, 'Scan page.tiff');
spawnSync('python3', ['-I', path.join(ROOT, 'scripts/make-image-fixture.py'), JPG, path.join(TMP, 'v.txt'), '--clean']);
const heicOk = spawnSync('python3', ['-I', path.join(ROOT, 'scripts/make-heic-fixture.py'), JPG, HEIC]).status === 0;
spawnSync('python3', ['-I', '-c', `from PIL import Image; Image.open(${JSON.stringify(JPG)}).save(${JSON.stringify(TIFF)}, compression='tiff_lzw')`]);

const env = { ...process.env, HOME: TMP, XDG_CONFIG_HOME: path.join(TMP, '.config'), VITE_DEV_SERVER_URL: '', MARGINALIA_E2E: '1' };
delete env.MARGINALIA_APPLE_BOOKS;
const exe = path.join(ROOT, 'node_modules/electron/dist/electron');
const app = await electron.launch({ executablePath: exe, args: ['--no-sandbox', APP_DIR, path.join(ROOT, 'fixtures/discours.epub')], env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  // Le livre passé en argument est importé puis ouvert de façon asynchrone : on attend qu'il le soit,
  // sinon son ouverture tardive interfère avec la suite (navigation vers l'accueil).
  await page.waitForFunction(() => window.__store.getState().route.name === 'reader', null, { timeout: 60000 });

  // Fenêtre et menus
  const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => ({ label: i.label, sub: i.submenu ? i.submenu.items.map((s) => s.label) : [] })));
  ok(JSON.stringify(menu.map((m) => m.label.replace('&', ''))) === JSON.stringify(['Fichier', 'Édition', 'Affichage', 'Aide']), 'menus non-Mac : Fichier, Édition, Affichage, Aide (pas de menu « app »)', menu.map((m) => m.label));
  ok(menu[0].sub.includes('Importer…') && menu[0].sub.includes('Quitter'), 'Fichier : Importer…, Quitter', menu[0].sub);
  ok(menu[3].sub.includes('Exporter le journal de diagnostic') && menu[3].sub.includes('Aide de Marginalia'), 'Aide : aide + journal de diagnostic', menu[3].sub);
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[3].submenu.items.find((i) => i.label === 'Aide de Marginalia').click());
  await page.waitForFunction(() => window.__store.getState().route.name === 'help', null, { timeout: 5000 }).catch(() => {});
  ok((await page.evaluate(() => window.__store.getState().route.name)) === 'help', 'menu Aide › Aide de Marginalia ouvre l’onglet Aide');
  const winInfo = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { autoHide: w.isMenuBarAutoHide(), overlay: typeof w.setTitleBarOverlay === 'function' };
  });
  ok(winInfo.autoHide, 'barre de menus masquée (Alt l’affiche)', winInfo);
  ok(await page.evaluate(() => document.documentElement.classList.contains('platform-linux')), 'classe platform-linux sur <html>');
  const plat = await page.evaluate(() => ({ p: window.marginalia.platform, books: typeof window.marginalia.appleBooksScan, conv: typeof window.marginalia.convertImage, menu: typeof window.marginalia.popupMenu }));
  ok(plat.p === 'linux' && plat.books === 'undefined' && plat.conv === 'undefined' && plat.menu === 'function', 'preload : plateforme exposée, Livres et sips absents', plat);
  await page.evaluate(() => window.marginalia.setTheme('dark', { color: '#121110', symbolColor: '#c4bcae' }));
  ok(true, 'setTheme avec couleurs des boutons de fenêtre sans erreur');
  await page.evaluate(() => window.marginalia.setTheme('light', { color: '#efebe3', symbolColor: '#4a443a' }));
  // Raccourcis : Ctrl (pas Meta)
  await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
  await page.waitForSelector('.sidebar .nav-item .kbd', { timeout: 10000 });
  ok((await page.textContent('.sidebar .nav-item .kbd')) === 'Ctrl+K', 'libellé « Ctrl+K » dans l’app');
  const reserve = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.main .topbar')).paddingRight));
  ok(reserve >= 100, `barre du haut : réserve à droite pour les boutons de fenêtre (${reserve} px)`);
  await page.screenshot({ path: path.join(ROOT, 'shots/windows/electron-linux-accueil.png') });

  // Fichier passé en argument au lancement
  await page.waitForFunction(() => window.__store.getState().books.some((b) => /Discours/i.test(b.title)), null, { timeout: 30000 }).catch(() => {});
  ok(await page.evaluate(() => window.__store.getState().books.some((b) => /Discours/i.test(b.title))), 'fichier passé en argument importé (double-clic dans l’Explorateur)');

  // Livres désactivé : handlers inertes, bouton absent
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await page.waitForTimeout(500);
  ok((await page.getByText('Depuis Livres').count()) === 0, '« Depuis Livres » absent hors Mac');

  // Polices (fc-list sous Linux ; PowerShell sous Windows)
  const fonts = await page.evaluate(() => window.marginalia.listFonts());
  ok(Array.isArray(fonts) && fonts.length > 0, `polices installées listées (${fonts.length})`);

  // HEIC / TIFF : décodeur embarqué dans le rendu (app://, CSP, worker)
  for (const [file, label, enabled] of [[HEIC, 'HEIC', heicOk], [TIFF, 'TIFF', true]]) {
    if (!enabled) {
      console.log('(HEIC non fabriqué : ffmpeg/libx265 absents)');
      continue;
    }
    const b64 = fs.readFileSync(file).toString('base64');
    const id = await page.evaluate(async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await window.__store.getState().importFiles([{ name, data: bin.buffer }], { asBook: true });
      window.__store.getState().openBook(book.id);
      return book.id;
    }, { name: path.basename(file), b64 });
    const w = await page
      .waitForFunction(() => document.querySelector('img.img-picture')?.naturalWidth || false, null, { timeout: 60000 })
      .then((h) => h.jsonValue())
      .catch(() => 0);
    ok(w >= 1000, `${label} affiché dans l’app (conversion JS/WASM, largeur ${w})`);
    const disp = await page.evaluate(async (id) => {
      try {
        return (await window.marginalia.readFile(id, 'display.jpg')).byteLength;
      } catch {
        return 0;
      }
    }, id);
    ok(disp > 10000, `${label} : copie JPEG enregistrée (display.jpg, ${disp} o)`);
    await page.screenshot({ path: path.join(ROOT, `shots/windows/electron-${label.toLowerCase()}.png`) });
  }

  // Réseau sortant bloqué
  const net = await page.evaluate(() => fetch('https://example.com/').then(() => 'ouvert', () => 'bloqué'));
  ok(net === 'bloqué', 'réseau sortant bloqué');

  // Seconde instance (double-clic sur un autre fichier pendant que l'app tourne)
  const before = await page.evaluate(() => window.__store.getState().books.length + window.__store.getState().drafts.length);
  const second = spawnSync(exe, ['--no-sandbox', APP_DIR, path.join(ROOT, 'fixtures/discours.md')], { env, timeout: 30000 });
  ok(second.status === 0 || second.status === null, 'seconde instance refusée (instance unique)', second.status);
  await page.waitForFunction((n) => window.__store.getState().books.length + window.__store.getState().drafts.length > n, before, { timeout: 15000 }).catch(() => {});
  const after = await page.evaluate(() => window.__store.getState().books.length + window.__store.getState().drafts.length);
  ok(after > before, `fichier reçu par « second-instance » importé (${before} → ${after})`);
} finally {
  await app.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
