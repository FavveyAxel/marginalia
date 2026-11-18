// Renommer un document (workspaces/rename.tsx) — port 5376.
// Lancer : timeout 240 node scripts/test-rename.mjs
// Bibliothèque : clic droit → Renommer (PDF, livre) ; F2 ; Échap et titre vide ne changent rien ;
// espace : clic droit → Renommer sur un livre et sur un écrit ; titres conservés après rechargement.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = path.join(ROOT, 'shots/rename');
const PORT = 5376;
let failures = 0;
const check = (msg, ok, detail = '') => {
  console.log((ok ? 'OK   ' : 'ÉCHEC') + ' ' + msg + (detail ? ' — ' + detail : ''));
  if (!ok) failures++;
};

const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), 'marginalia-vite-' + PORT), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && !(m.location()?.url || '').endsWith('/favicon.ico') && errors.push('console: ' + m.text()));
const S = (fn, arg) => page.evaluate(fn, arg);
const title = (kind, id) => S(([kind, id]) => window.__store.getState()[kind].find((x) => x.id === id)?.title, [kind, id]);
const dialog = () => page.locator('[data-testid="rename-dialog"]');

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  const wsId = await S(() => {
    const now = Date.now();
    const ed = { publisher: '', year: '', translator: '', place: '', pageOffset: 0 };
    const mk = (id, t, format, i) => ({ id, title: t, author: 'Auteur inventé', format, fileName: 'source.' + format, originalName: 'scan_0042.' + format, size: 1000, addedAt: now - i * 1000, lastOpenedAt: null, progress: 0, position: null, cover: null, edition: ed });
    const books = [mk('b1', 'scan_0042', 'pdf', 0), mk('b2', 'Livre sans nom', 'epub', 1), mk('b3', 'Troisième titre', 'epub', 2)];
    const drafts = [{ id: 'd1', title: 'Brouillon', fileName: 'document.docx', externalPath: null, wordCount: 10, template: 'vide', createdAt: now, updatedAt: now }];
    window.__store.setState({ books, drafts, highlights: [], trash: [], wsItems: [], workspaces: [], groups: [] });
    const s = window.__store.getState();
    s.updateSettings({ tourDone: true, mascot: 'off', appStyle: 'normal' });
    const ws = s.createWorkspace('Espace d’essai');
    s.addToWorkspace(ws.id, null, 'book', 'b3');
    s.addToWorkspace(ws.id, null, 'draft', 'd1');
    try { localStorage.setItem('lib.view', 'grid'); } catch {}
    s.navigate({ name: 'library' });
    return ws.id;
  });
  await page.waitForSelector('[data-sel-id="b1"]');
  await page.waitForTimeout(500);

  // ── Bibliothèque : clic droit → Renommer ──
  await page.locator('[data-sel-id="b1"]').click({ button: 'right' });
  await page.waitForSelector('[data-testid="lib-rename"]');
  await page.screenshot({ path: (fs.mkdirSync(SHOTS, { recursive: true }), path.join(SHOTS, 'menu.png')) });
  await page.click('[data-testid="lib-rename"]');
  await dialog().waitFor();
  check('fenêtre « Renommer le PDF », titre actuel présélectionné', (await dialog().locator('h3').innerText()) === 'Renommer le PDF' && (await S(() => { const i = document.querySelector('[data-testid="rename-input"]'); return document.activeElement === i && i.selectionStart === 0 && i.selectionEnd === i.value.length && i.value === 'scan_0042'; })));
  await page.screenshot({ path: path.join(SHOTS, 'fenetre.png') });
  await page.keyboard.type('Cours sur la liberté');
  await page.keyboard.press('Enter');
  await dialog().waitFor({ state: 'detached' });
  check('PDF renommé (Entrée), fichier d’origine inchangé', (await title('books', 'b1')) === 'Cours sur la liberté' && (await S(() => window.__store.getState().books[0].originalName)) === 'scan_0042.pdf');
  check('la carte affiche le nouveau titre', (await page.locator('[data-sel-id="b1"]').innerText()).includes('Cours sur la liberté'));

  // ── F2 ──
  await page.locator('[data-sel-id="b2"]').focus();
  await page.keyboard.press('F2');
  await dialog().waitFor();
  check('F2 : fenêtre « Renommer le livre »', (await dialog().locator('h3').innerText()) === 'Renommer le livre');
  await page.keyboard.type('Autre chose');
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'detached' });
  check('Échap : rien ne change', (await title('books', 'b2')) === 'Livre sans nom');
  await page.locator('[data-sel-id="b2"]').focus();
  await page.keyboard.press('F2');
  await dialog().waitFor();
  await page.fill('[data-testid="rename-input"]', '   ');
  check('titre vide : bouton « Renommer » inactif', await page.locator('[data-testid="rename-save"]').isDisabled());
  await page.fill('[data-testid="rename-input"]', '  Traité de la nature  ');
  await page.click('[data-testid="rename-save"]');
  await dialog().waitFor({ state: 'detached' });
  check('livre renommé (bouton), espaces retirés', (await title('books', 'b2')) === 'Traité de la nature');

  // ── Espace : livre et écrit ──
  await S((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id }), wsId);
  const item = (text) => page.locator('.ws-view [data-sel-id]', { hasText: text }).first();
  await item('Troisième titre').waitFor();
  await item('Troisième titre').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Renommer' }).click();
  await dialog().waitFor();
  await page.keyboard.type('Livre de l’espace');
  await page.keyboard.press('Enter');
  await dialog().waitFor({ state: 'detached' });
  check('espace : livre renommé', (await title('books', 'b3')) === 'Livre de l’espace' && (await item('Livre de l’espace').count()) === 1);
  await item('Brouillon').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Renommer' }).click();
  await dialog().waitFor();
  check('espace : fenêtre « Renommer l’écrit »', (await dialog().locator('h3').innerText()) === 'Renommer l’écrit');
  await page.keyboard.type('Dissertation sur le temps');
  await page.keyboard.press('Enter');
  await dialog().waitFor({ state: 'detached' });
  check('espace : écrit renommé', (await title('drafts', 'd1')) === 'Dissertation sur le temps');

  // ── Rechargement ──
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  check('titres conservés après rechargement', (await title('books', 'b1')) === 'Cours sur la liberté' && (await title('books', 'b2')) === 'Traité de la nature' && (await title('drafts', 'd1')) === 'Dissertation sur le temps');
  check('aucune erreur de page', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.error(e);
  check('déroulement', false, String(e).slice(0, 300));
  await page.screenshot({ path: path.join(SHOTS, 'failure.png') }).catch(() => {});
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon');
process.exit(failures ? 1 : 0);
