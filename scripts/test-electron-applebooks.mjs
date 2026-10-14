// Import / synchro depuis l'app Livres : faux dossier iCloud de Livres (HOME temporaire).
// L'app Livres n'existe que sur macOS : hors Mac, MARGINALIA_APPLE_BOOKS=1 active ces fonctions pour le test
// (sans ce drapeau, elles sont absentes : voir scripts/test-electron-platform.mjs).
import { _electron as electron } from 'playwright-core';
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'; import { execFileSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APP_DIR = path.join(ROOT, 'release/Marginalia-darwin-arm64/Marginalia.app/Contents/Resources/app');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-books-'));
const BOOKS = path.join(HOME, 'Library/Mobile Documents/iCloud~com~apple~iBooks/Documents');
fs.mkdirSync(BOOKS, { recursive: true });
const pkg = (name) => { const d = path.join(BOOKS, name); fs.mkdirSync(d); execFileSync('unzip', ['-q', path.join(ROOT, 'fixtures/discours.epub'), '-d', d]); return d; };
pkg('Discours paquet.epub');
fs.writeFileSync(path.join(pkg('Protégé.epub'), 'META-INF/sinf.xml'), '<fairplay/>');
fs.copyFileSync(path.join(ROOT, 'fixtures/discours.pdf'), path.join(BOOKS, 'Un PDF.pdf'));
fs.writeFileSync(path.join(BOOKS, '.Pas encore là.epub.icloud'), '');
const ok = (c, m) => { console.log((c ? 'OK   ' : 'ÉCHEC ') + m); if (!c) process.exitCode = 1; };
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', APP_DIR], env: { ...process.env, HOME, XDG_CONFIG_HOME: path.join(HOME, '.config'), VITE_DEV_SERVER_URL: '', MARGINALIA_APPLE_BOOKS: '1' }, timeout: 60000 });
try {
  const page = await app.firstWindow();
  const scan = await page.evaluate(() => window.marginalia.appleBooksScan());
  ok(scan.length === (process.platform === 'darwin' ? 4 : 3), `scan : ${scan.length} livres (${scan.map((b) => b.name + (b.drm ? '[DRM ' + b.drm + ']' : '') + (b.pending ? '[icloud]' : '')).join(', ')})`);
  ok(scan.find((b) => b.name === 'Protégé.epub')?.drm === 'Apple', 'DRM Apple détecté');
  ok(scan.find((b) => b.name === 'Discours paquet.epub')?.title && !scan.find((b) => b.name === 'Discours paquet.epub').drm, 'paquet EPUB lisible, titre lu dans l’OPF');
  await page.evaluate(() => window.marginalia.appleBooksRead(window.marginalia && 'x')).then(() => ok(false, 'chemin hors Livres refusé'), () => ok(true, 'chemin hors Livres refusé'));
  await page.locator('.nav-item', { hasText: 'Bibliothèque' }).first().click();
  await page.getByRole('button', { name: /Récupérer mes livres|Depuis Livres/ }).first().click();
  await page.waitForSelector('.lib-books-list li');
  await page.screenshot({ path: path.join(ROOT, 'shots/applebooks-dialog.png') });
  ok((await page.locator('.lib-books-list li.off').count()) === (process.platform === 'darwin' ? 2 : 1), 'DRM et iCloud non sélectionnables');
  await page.getByRole('button', { name: /Importer 2 livres/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.lib-root [data-book-id], .lib-card, .lib-row').length >= 2, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const n = await page.evaluate(() => JSON.parse(JSON.stringify(window.__store?.getState?.().books?.length ?? -1)));
  const settingsDb = JSON.parse(fs.readFileSync(execFileSync('bash', ['-c', `find "${HOME}/.config" -name 'db.json' | head -1`]).toString().trim() || '/dev/null', 'utf8') || '{}');
  ok(true, `livres dans le store : ${n}`);
  // Nouveau livre « arrivé de l'iPhone » : la synchro auto l'importe.
  pkg('Arrivé de l’iPhone.epub');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(ROOT, 'shots/applebooks-after-sync.png') });
  const titles = await page.evaluate(() => [...document.querySelectorAll('.lib-page')].map((e) => e.textContent).join(' '));
  const count = (await page.evaluate(() => document.body.innerText.match(/Discours/g)?.length ?? 0));
  ok(count >= 3, `synchro auto : nouveau livre importé (${count} occurrences de « Discours »)`);
  void settingsDb; void titles;
} finally { await app.close(); }
