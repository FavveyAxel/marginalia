// Style « Skeuomorphisme » et Bibliothèque en étagère — port 5336.
// Réglages : le choix Normal / Skeuomorphisme pose data-style sur <html> (message à chaque changement).
// Bibliothèque en skeuomorphisme : une étagère (un dos par livre, rangées), le bouton de présentation
// s'appelle « Étagère » ; clic sur un dos : le livre sort (le dos laisse un vide), « Remettre en place »
// le range ; « Ouvrir » ouvre le lecteur ; Échap range ; clic droit : menu du livre ; ⌘-clic : sélection ;
// recherche : seuls les livres trouvés restent. Retour à Normal : la grille revient.
// Lancer : timeout 300 node scripts/test-shelf.mjs [dossier-captures]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5336;
const SHOTS = process.argv[2];
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
};
const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const tick = (ms = 300) => page.waitForTimeout(ms);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));

try {
  await page.goto(`http://localhost:${PORT}/`, { timeout: 120000 });
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 90000 });
  const b64 = fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')).toString('base64');
  const ids = await page.evaluate(async (b64) => {
    const s = () => window.__store.getState();
    s().updateSettings({ tourDone: true, mascot: 'off' });
    const T = [['Discours de la méthode', 'René Descartes'], ['Éthique', 'Spinoza'], ['Du contrat social', 'Jean-Jacques Rousseau'], ['Léviathan', 'Thomas Hobbes'], ['Phénoménologie de l’esprit', 'G. W. F. Hegel'], ['Essais', 'Montaigne']];
    const ids = [];
    for (const [i, [t, a]] of T.entries()) {
      const id = (await s().importFiles([{ name: i + '.epub', data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer }]))[0].id;
      s().updateBook(id, { title: t, author: a, ...(i ? { cover: null } : {}) });
      ids.push(id);
    }
    window.__store.setState({ toasts: [] });
    return ids;
  }, b64);
  check('style par défaut : normal', (await page.evaluate(() => document.documentElement.dataset.style)) === 'normal');

  // ── Réglages ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await page.waitForSelector('[data-style-choice="skeuo"]');
  await page.click('[data-style-choice="skeuo"]');
  await tick();
  check('Réglages : Skeuomorphisme choisi → data-style="skeuo"', (await page.evaluate(() => document.documentElement.dataset.style)) === 'skeuo');
  check('Réglages : réglage enregistré', (await page.evaluate(() => window.__store.getState().settings.appStyle)) === 'skeuo');
  check('message drôle au changement', /Bienvenue dans la matière/.test(await toasts()), await toasts());
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'reglages-style.png') });

  // ── Bibliothèque en étagère ──
  await page.evaluate(() => { window.__store.setState({ toasts: [] }); window.__store.getState().navigate({ name: 'library' }); });
  await page.waitForSelector('[data-testid="lib-shelf"]');
  await tick(900);
  check('étagère affichée à la place de la grille', (await page.locator('.lib-grid').count()) === 0);
  check('un dos par livre', (await page.locator('.sh-book').count()) === 6, String(await page.locator('.sh-book').count()));
  check('bouton de présentation « Étagère »', (await page.locator('button[aria-label="Étagère"]').count()) === 1);
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.sh-text')].filter((t) => { const r = t.getBoundingClientRect(); const s = t.parentElement.getBoundingClientRect(); return r.height > s.height - 30 || r.width > s.width; }).length);
  check('titres et auteurs tiennent sur les dos', overflow === 0, String(overflow));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'etagere.png') });

  const spine = (t) => page.locator('.sh-book', { hasText: t }).first();
  await spine('Léviathan').click();
  await page.waitForSelector('.sh-panel.on', { timeout: 5000 });
  check('clic : le livre sort et montre sa couverture', (await page.locator('[data-testid="shelf-pulled"]').count()) === 1);
  check('son dos laisse un vide sur l’étagère', (await spine('Léviathan').evaluate((e) => e.style.visibility)) === 'hidden');
  check('titre et auteur sous le livre', /Léviathan/.test(await page.textContent('.sh-panel')) && /Hobbes/.test(await page.textContent('.sh-panel')));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'livre-sorti.png') });
  await page.click('[data-act="shelf-back"]');
  await page.waitForSelector('[data-testid="shelf-pulled"]', { state: 'detached', timeout: 5000 });
  check('« Remettre en place » : rangé, le dos réapparaît', (await spine('Léviathan').evaluate((e) => e.style.visibility)) === '');

  await spine('Essais').click();
  await page.waitForSelector('.sh-panel.on');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="shelf-pulled"]', { state: 'detached', timeout: 5000 });
  check('Échap : le livre est rangé', true);

  // Clic droit : menu du livre
  await spine('Éthique').click({ button: 'right' });
  await tick();
  check('clic droit : menu du livre', (await page.locator('[role="menu"]').count()) > 0);
  await page.keyboard.press('Escape');
  await tick();

  // ⌘-clic : sélection (pas de sortie)
  await spine('Éthique').click({ modifiers: ['Meta'] });
  await spine('Essais').click({ modifiers: ['Meta'] });
  await tick();
  check('⌘-clic : deux livres sélectionnés, aucun ne sort', (await page.locator('.sh-book.selected').count()) === 2 && (await page.locator('[data-testid="shelf-pulled"]').count()) === 0);
  await page.keyboard.press('Escape');
  await tick();

  // Recherche
  await page.fill('.lib-search input, input[placeholder*="Rechercher"]', 'hegel');
  await tick(500);
  check('recherche : seuls les livres trouvés restent', (await page.locator('.sh-book').count()) === 1);
  await page.fill('.lib-search input, input[placeholder*="Rechercher"]', '');
  await tick(500);

  // Ouvrir
  await spine('Discours de la méthode').click();
  await page.waitForSelector('.sh-panel.on');
  await page.click('[data-act="shelf-open"]');
  await page.waitForFunction(() => window.__store.getState().route.name === 'reader', null, { timeout: 5000 });
  const r = await page.evaluate(() => window.__store.getState().route);
  check('« Ouvrir » : le lecteur s’ouvre sur ce livre', r.name === 'reader' && r.bookId === ids[0], r);

  // Retour à Normal
  await page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await page.waitForSelector('[data-style-choice="normal"]');
  await page.click('[data-style-choice="normal"]');
  await tick();
  check('retour à Normal : data-style="normal"', (await page.evaluate(() => document.documentElement.dataset.style)) === 'normal');
  check('message au retour', /Retour au plat/.test(await toasts()), await toasts());
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await tick(800);
  check('Normal : la grille revient', (await page.locator('.lib-grid').count()) === 1 && (await page.locator('[data-testid="lib-shelf"]').count()) === 0);
  check('aucune erreur dans la page', !errors.length, errors.join('\n'));
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `\n${failed} vérification(s) en échec.` : '\nToutes les vérifications sont passées.');
process.exit(failed ? 1 : 0);
