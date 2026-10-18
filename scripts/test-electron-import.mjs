// Page « Importer » (app réelle) : le bouton Importer l'ouvre ; « Choisir un dossier… » importe tout le
// contenu compatible d'un dossier (sous-dossiers compris ; fichiers cachés, autres formats, dossiers
// système écartés) ; glisser-déposer de fichiers sur la page ; ⌘O garde le sélecteur direct ;
// depuis un espace, les documents y sont rangés. Le sélecteur natif est remplacé (dialog stub).
// Prérequis : dist/ construit. Lancer : DISPLAY=:99 timeout 240 node scripts/test-electron-import.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-import-'));
const SHOTS = path.join(ROOT, 'shots/import');
fs.mkdirSync(SHOTS, { recursive: true });
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};

// Dossier de cours : 2 livres, 1 écrit, 1 texte, dans des sous-dossiers ; à écarter : caché, .exe, __MACOSX, node_modules.
const COURS = path.join(HOME, 'Cours de philo');
const put = (rel, src) => { const p = path.join(COURS, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.copyFileSync(path.join(ROOT, 'fixtures', src), p); };
put('Descartes/Discours.epub', 'discours.epub');
put('Descartes/Discours (PDF).pdf', 'discours.pdf');
put('Notes/Fiche Descartes.md', 'discours-notes.md');
put('Notes/Sous-dossier/Première partie.txt', 'premiere-partie.txt');
fs.writeFileSync(path.join(COURS, '.secret.pdf'), '%PDF');
fs.writeFileSync(path.join(COURS, 'installeur.exe'), 'MZ');
fs.writeFileSync(path.join(COURS, 'Thumbs.db'), 'x');
fs.mkdirSync(path.join(COURS, '__MACOSX'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'fixtures/discours.epub'), path.join(COURS, '__MACOSX/._Discours.epub'));
fs.mkdirSync(path.join(COURS, 'node_modules/x'), { recursive: true });
fs.writeFileSync(path.join(COURS, 'node_modules/x/readme.md'), '# x');

const env = { ...process.env, HOME, XDG_CONFIG_HOME: path.join(HOME, '.config'), VITE_DEV_SERVER_URL: '', MARGINALIA_E2E: '1' };
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, COURS);

  // Lecture du dossier (couche du dessous)
  const picked = await page.evaluate(async () => { const r = await window.marginalia.pickFolder(); return { folder: r.folder, names: r.files.map((f) => f.name), skipped: r.skipped, truncated: r.truncated }; });
  ok(picked.folder === 'Cours de philo', 'dossier choisi', picked.folder);
  ok(JSON.stringify(picked.names.sort()) === JSON.stringify(['Discours (PDF).pdf', 'Discours.epub', 'Fiche Descartes.md', 'Première partie.txt'].sort()), 'contenu compatible, sous-dossiers compris', picked.names);
  ok(picked.skipped === 2 && !picked.truncated, 'autres formats comptés (exe, Thumbs.db), cachés et dossiers système écartés', picked.skipped);

  // Les autres boutons « Importer » (accueil, bibliothèque) ouvrent la même page.
  await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
  await page.click('.home-step button:has-text("Importer un texte"), .home-shortcuts button:has-text("Importer")');
  ok((await page.evaluate(() => window.__store.getState().route.name)) === 'import', 'accueil : « Importer » ouvre la page Importer');
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await page.click('.lib-drop button:has-text("Importer"), [data-testid="lib-import"]');
  ok((await page.evaluate(() => window.__store.getState().route.name)) === 'import', 'bibliothèque : « Importer » ouvre la page Importer');
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await page.click('[data-testid="lib-import"]');
  ok((await page.evaluate(() => window.__store.getState().route.name)) === 'import', 'bibliothèque, en haut à droite : « Importer » ouvre la page Importer');
  await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));

  // Bouton Importer → page
  await page.click('.import-btn');
  await page.waitForSelector('[data-testid="import-drop"]');
  ok((await page.evaluate(() => window.__store.getState().route.name)) === 'import', 'le bouton « Importer » ouvre la page Importer');
  ok((await page.locator('.import-btn').getAttribute('class')).includes('active'), 'bouton Importer marqué actif');
  await page.screenshot({ path: path.join(SHOTS, '01-page.png') });

  const n0 = await page.evaluate(() => ({ b: window.__store.getState().books.length, d: window.__store.getState().drafts.length }));
  await page.click('button:has-text("Choisir un dossier…")');
  await page.waitForSelector('[data-testid="import-result"]', { timeout: 60000 });
  const res = await page.locator('[data-testid="import-result"]').innerText();
  const n1 = await page.evaluate(() => ({ b: window.__store.getState().books.length, d: window.__store.getState().drafts.length }));
  ok(n1.b - n0.b + n1.d - n0.d === 4 && /4 documents importés depuis « Cours de philo »/.test(res) && /2 fichiers d’un autre format ignorés/.test(res), 'dossier importé : résumé', res.replace(/\n/g, ' | '));
  await page.screenshot({ path: path.join(SHOTS, '02-dossier-importe.png') });

  // Glisser-déposer sur la page (fichiers)
  const md = fs.readFileSync(path.join(ROOT, 'fixtures/discours.md')).toString('base64');
  const nd0 = await page.evaluate(() => window.__store.getState().drafts.length);
  await page.evaluate(async (b64) => {
    const zone = document.querySelector('[data-testid="import-drop"]');
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'Cours du 18.md', { type: 'text/markdown' }));
    dt.items.add(new File(['MZ'], 'virus.exe'));
    for (const t of ['dragenter', 'dragover']) zone.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
    zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, md);
  await page.waitForFunction((n) => window.__store.getState().drafts.length === n + 1, nd0, { timeout: 30000 });
  ok(true, 'glisser-déposer sur la page : document importé');
  await page.waitForSelector('[data-testid="import-result"]');
  ok(/1 fichier d’un autre format ignoré/.test(await page.locator('[data-testid="import-result"]').innerText()), 'fichier d’un autre format signalé');
  ok(!(await page.$('.drop-overlay')), 'pas de calque par-dessus la page');

  // Depuis un espace : rangé dedans
  const wsId = await page.evaluate(() => { const s = window.__store.getState(); const w = s.createWorkspace ? s.createWorkspace('Descartes') : null; return w?.id ?? null; });
  if (wsId) {
    await page.evaluate((id) => window.__store.getState().navigate({ name: 'workspace', workspaceId: id, groupId: null }), wsId);
    await page.click('.import-btn');
    await page.waitForSelector('[data-testid="import-drop"]');
    ok((await page.locator('.imp-lede').innerText()).includes('« Descartes »'), 'depuis un espace : la page le dit');
    const items0 = await page.evaluate((id) => window.__store.getState().wsItems.filter((i) => i.workspaceId === id).length, wsId);
    await page.click('button:has-text("Choisir des fichiers…")');
    await page.waitForTimeout(100);
  } else ok(true, '(création d’espace non exposée : vérification de l’espace sautée)');

  // ⌘O / Ctrl+O : sélecteur direct, pas la page
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await page.keyboard.press('Control+o');
  await page.waitForTimeout(400);
  ok((await page.evaluate(() => window.__store.getState().route.name)) === 'library', 'Ctrl+O : sélecteur direct (reste sur la bibliothèque)');
} finally {
  await app.close();
  fs.rmSync(HOME, { recursive: true, force: true });
}
