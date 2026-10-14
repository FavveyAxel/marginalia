// Test : sélection multiple dans la Bibliothèque (grille + liste) et dans la liste des Écrits.
// ⌘-clic, ⇧-clic, ⌘A, Échap, clic dans le vide, lasso, mode « Sélectionner », menu contextuel groupé,
// ajout groupé à un espace, suppression groupée (confirmation, un seul toast, « Annuler » qui restaure tout, ⌘Z).
// Usage : timeout 170 node scripts/test-multiselect-library.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5321;
const SHOTS = path.join(ROOT, 'shots', 'multiselect');
let failures = 0;
const check = (ok, msg) => {
  console.log((ok ? 'OK   ' : 'ÉCHEC') + ' ' + msg);
  if (!ok) failures++;
};
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(250); // fin des animations (cases à cocher, barre)
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  console.log('capture:', path.join('shots/multiselect', name + '.png'));
};

const server = await createServer({
  root: ROOT,
  cacheDir: path.join(os.tmpdir(), 'marginalia-vite-' + PORT),
  server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

const S = (fn, arg) => page.evaluate(fn, arg);
const selCount = () => page.locator('.lib-card.selected, .lib-row.selected, .ed-card.selected').count();
const selIds = () => S(() => [...document.querySelectorAll('[data-sel-id][aria-selected="true"]')].map((e) => e.dataset.selId));
const card = (id) => page.locator(`[data-sel-id="${id}"]`);
const lastToast = () => page.locator('.toast').last();

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });

  // ── Données ──
  await S(() => {
    const now = Date.now();
    const ed = { publisher: '', year: '', translator: '', place: '', pageOffset: 0 };
    const titles = ['Discours de la méthode', 'Méditations', 'Éthique', 'Critique de la raison pure', 'Le Banquet', 'Phédon', 'Les Passions de l’âme', 'Lettre à Ménécée'];
    const authors = ['Descartes', 'Descartes', 'Spinoza', 'Kant', 'Platon', 'Platon', 'Descartes', 'Épicure'];
    const books = titles.map((t, i) => ({
      id: 'b' + (i + 1), title: t, author: authors[i], format: i % 3 === 1 ? 'pdf' : 'epub', fileName: 'source.epub', originalName: t + '.epub',
      size: 1000, addedAt: now - i * 1000, lastOpenedAt: null, progress: 0.1 * i, position: null, cover: null, edition: ed,
    }));
    const hl = (id, bookId) => ({ id, bookId, category: 'these', text: 'Extrait ' + id, note: '', conceptIds: [], noteKind: null, printedPage: '',
      anchor: { kind: 'html', chapter: 0, start: 0, end: 5, prefix: '', suffix: '' }, locationLabel: '', createdAt: now, updatedAt: now });
    const drafts = ['Dissertation : le doute', 'Explication — Méditation II', 'Fiche : Spinoza', 'Brouillon'].map((t, i) => ({
      id: 'd' + (i + 1), title: t, fileName: 'document.docx', externalPath: null, wordCount: 100 * (i + 1), template: 'vide', createdAt: now, updatedAt: now - i * 1000,
    }));
    window.__store.setState({ books, highlights: [hl('h1', 'b2'), hl('h2', 'b2')], drafts, trash: [], wsItems: [], workspaces: [], groups: [] });
    const s = window.__store.getState();
    const ws = s.createWorkspace('Terminale — Le sujet');
    s.createGroup(ws.id, null, 'Chapitre 1');
    s.createWorkspace('Dissertation : la raison');
    s.navigate({ name: 'library' });
    try { localStorage.setItem('lib.view', 'grid'); } catch {}
  });
  await page.waitForSelector('.lib-card[data-sel-id="b8"]');
  await page.waitForTimeout(600);

  // ── ⌘-clic ──
  await card('b1').click({ modifiers: ['Meta'] });
  await card('b3').click({ modifiers: ['Meta'] });
  check((await selIds()).join() === 'b1,b3', '⌘-clic ajoute b1 puis b3');
  check((await page.locator('.msel-bar').count()) === 1 && (await page.locator('.msel-count').innerText()).includes('2'), 'barre d’actions « 2 livres sélectionnés »');
  check(await S(() => window.__store.getState().route.name === 'library'), '⌘-clic n’ouvre pas le livre');
  await card('b3').click({ modifiers: ['Meta'] });
  check((await selIds()).join() === 'b1', '⌘-clic sur un élément sélectionné le retire');
  await card('b3').click({ modifiers: ['Meta'] });

  // ── ⇧-clic : plage depuis l'ancre (b3) en gardant b1 ──
  await card('b6').click({ modifiers: ['Shift'] });
  check((await selIds()).join() === 'b1,b3,b4,b5,b6', '⇧-clic : plage b3→b6 (b1 conservé)');
  await card('b4').click({ modifiers: ['Shift'] });
  check((await selIds()).join() === 'b1,b3,b4', '⇧-clic plus près de l’ancre : la plage se réduit');
  await shot(page, '01-grille-selection');

  // ── Échap / ⌘A ──
  await page.keyboard.press('Escape');
  check((await selCount()) === 0 && (await page.locator('.msel-bar').count()) === 0, 'Échap vide la sélection et masque la barre');
  await page.keyboard.press('Meta+a');
  check((await selCount()) === 8, '⌘A sélectionne les 8 livres visibles');
  await page.keyboard.press('Escape');
  // ⌘A avec un filtre de recherche : seulement ce qui est visible
  await page.fill('.lib-search-input', 'descartes');
  await page.locator('.lib-title').click(); // le champ perd le focus (clic dans le vide)
  await page.keyboard.press('Meta+a');
  check((await selIds()).join() === 'b1,b2,b7', '⌘A avec recherche « descartes » : 3 livres visibles seulement');
  await page.fill('.lib-search-input', '');
  await page.waitForTimeout(100);
  check((await selIds()).join() === 'b1,b2,b7', 'la sélection survit à l’effacement de la recherche');
  // ⌘A dans le champ de recherche reste un ⌘A de texte
  await page.locator('.lib-search-input').focus();
  await page.keyboard.press('Escape');

  // ── Clic dans le vide ──
  await page.keyboard.press('Meta+a');
  await page.locator('.lib-title').click();
  // focus encore dans la recherche ? on clique dans le vide sous la grille
  const grid = await page.locator('.lib-grid').boundingBox();
  await page.mouse.click(grid.x + grid.width - 30, grid.y - 12);
  check((await selCount()) === 0, 'clic dans le vide vide la sélection');

  // ── Lasso ──
  await card('b8').scrollIntoViewIfNeeded();
  const r7 = await card('b7').boundingBox();
  const r8 = await card('b8').boundingBox();
  const sx = r8.x + r8.width + 60; // case vide à droite du dernier livre
  await page.mouse.move(sx, r8.y + 40);
  await page.mouse.down();
  await page.mouse.move(sx - 80, r8.y + 60, { steps: 4 });
  await page.mouse.move(r7.x + 20, r7.y + 120, { steps: 8 });
  check((await page.locator('.msel-lasso').count()) === 1, 'rectangle de lasso visible pendant le tracé');
  await shot(page, '02-lasso');
  await page.mouse.up();
  check((await selIds()).join() === 'b7,b8', 'lasso : b7 et b8 sélectionnés');
  await page.keyboard.press('Escape');
  await page.locator('.lib-scroll').evaluate((el) => (el.scrollTop = 0));

  // ── Mode « Sélectionner » (cases à cocher, clic simple = cocher) ──
  await page.getByRole('button', { name: 'Sélectionner', exact: true }).click();
  check((await page.locator('.lib-card .msel-check').count()) === 8, 'mode Sélectionner : 8 cases à cocher');
  await card('b2').click();
  await card('b4').click();
  check((await selIds()).join() === 'b2,b4' && (await S(() => window.__store.getState().route.name)) === 'library', 'mode Sélectionner : clic simple coche sans ouvrir');
  await card('b5').locator('.msel-check').click();
  check((await selIds()).join() === 'b2,b4,b5', 'clic sur la case à cocher');
  await shot(page, '03-mode-selectionner');
  await page.getByRole('button', { name: 'Terminé' }).click();
  check((await selCount()) === 0 && (await page.locator('.lib-card .msel-check').count()) === 0, '« Terminé » quitte le mode et vide la sélection');

  // ── Clic simple hors mode : ouvre ──
  await card('b8').click();
  check(await S(() => window.__store.getState().route.name === 'reader' && window.__store.getState().route.bookId === 'b8'), 'clic simple hors mode : ouvre le livre');
  await S(() => window.__store.getState().navigate({ name: 'library' }));
  await page.waitForSelector('.lib-card[data-sel-id="b1"]');
  errors.length = 0; // le lecteur ne trouve pas le fichier fictif : erreurs attendues

  // ── Ajout groupé à un espace (choix du groupe) ──
  await card('b1').click({ modifiers: ['Meta'] });
  await card('b3').click({ modifiers: ['Meta'] });
  await page.locator('.msel-bar').getByRole('button', { name: /Ajouter à un espace/ }).click();
  await page.waitForSelector('.ws-modal');
  await page.waitForTimeout(350);
  await shot(page, '04-ajout-espace');
  await page.locator('.ws-modal .ws-move-row', { hasText: 'Chapitre 1' }).click();
  const added = await S(() => {
    const s = window.__store.getState();
    const g = s.groups.find((x) => x.name === 'Chapitre 1');
    return s.wsItems.filter((i) => i.kind === 'book' && i.groupId === g.id).map((i) => i.refId).sort().join();
  });
  check(added === 'b1,b3', 'b1 et b3 ajoutés au groupe « Chapitre 1 »');
  check((await lastToast().innerText()).includes('2 livres ajoutés'), 'toast « 2 livres ajoutés à … »');
  await page.keyboard.press('Escape');

  // ── Menu contextuel sur la sélection ──
  await card('b1').click({ modifiers: ['Meta'] });
  await card('b4').click({ modifiers: ['Meta'] });
  await card('b4').click({ button: 'right' });
  check((await page.locator('.ws-menu .menu-item', { hasText: 'Supprimer 2 livres' }).count()) === 1, 'clic droit sur un élément sélectionné : menu pour toute la sélection');
  await page.waitForTimeout(250);
  await shot(page, '05-menu-contextuel');
  await page.keyboard.press('Escape');
  check((await page.locator('.ws-menu').count()) === 0 && (await selCount()) === 2, 'Échap ferme le menu sans vider la sélection');
  await card('b6').click({ button: 'right' });
  check((await page.locator('.lib-menu').count()) === 1 && (await selCount()) === 0, 'clic droit hors sélection : menu simple, sélection vidée');
  await page.keyboard.press('Escape');

  // ── Suppression groupée avec extraits : confirmation, un seul toast, Annuler restaure tout ──
  const before = await S(() => {
    const s = window.__store.getState();
    return { books: s.books.length, hl: s.highlights.length, ws: s.wsItems.length, trash: s.trash.length };
  });
  for (const id of ['b2', 'b3', 'b5']) await card(id).click({ modifiers: ['Meta'] });
  await page.locator('.msel-bar').getByRole('button', { name: 'Supprimer' }).click();
  check((await page.locator('.lib-dialog', { hasText: 'Supprimer 3 documents' }).count()) === 1, 'confirmation au pluriel (2 extraits rattachés)');
  await page.waitForTimeout(350);
  await shot(page, '06-confirmation');
  await page.locator('.lib-dialog .btn-danger').click();
  const mid = await S(() => {
    const s = window.__store.getState();
    return { books: s.books.length, hl: s.highlights.length, ws: s.wsItems.length, trash: s.trash.length, toasts: s.toasts.map((t) => t.message) };
  });
  check(mid.books === before.books - 3 && mid.hl === 0 && mid.trash === before.trash + 3, 'suppression : 3 livres et leurs extraits dans la corbeille (3 entrées)');
  check(mid.toasts.filter((t) => /corbeille/.test(t)).length === 1 && mid.toasts.some((t) => t === '3 livres placés dans la corbeille'), 'un seul toast « 3 livres placés dans la corbeille »');
  check((await selCount()) === 0, 'sélection vidée après suppression');
  await shot(page, '07-toast-annuler');
  await page.locator('.toast', { hasText: '3 livres placés' }).locator('.toast-action').click();
  await page.waitForTimeout(100);
  const after = await S(() => {
    const s = window.__store.getState();
    const g = s.groups.find((x) => x.name === 'Chapitre 1');
    return { books: s.books.length, hl: s.highlights.length, ws: s.wsItems.length, trash: s.trash.length, b3InGroup: s.wsItems.some((i) => i.refId === 'b3' && i.groupId === g.id), toasts: s.toasts.map((t) => t.message) };
  });
  check(after.books === before.books && after.hl === before.hl && after.ws === before.ws && after.trash === before.trash, '« Annuler » restaure les 3 livres, leurs extraits et leurs références d’espace');
  check(after.b3InGroup, 'b3 revient dans le groupe « Chapitre 1 »');
  check(after.toasts.includes('3 livres restaurés'), 'toast « 3 livres restaurés »');
  const order = await S(() => window.__store.getState().books.map((b) => b.id).join());
  check(order === 'b1,b2,b3,b4,b5,b6,b7,b8', 'ordre d’origine des livres retrouvé');

  // ── Suppression sans extrait : directe ; ⌘Z annule tout d'un coup ──
  await card('b7').click({ modifiers: ['Meta'] });
  await card('b8').click({ modifiers: ['Meta'] });
  await page.locator('.msel-bar').getByRole('button', { name: 'Supprimer' }).click();
  check((await page.locator('.lib-dialog').count()) === 0 && (await S(() => window.__store.getState().books.length)) === 6, 'sans extrait : pas de confirmation, suppression directe');
  await page.waitForTimeout(50);
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(150);
  check((await S(() => window.__store.getState().books.length)) === 8, '⌘Z : un seul pas d’annulation restaure les 2 livres');

  // ── Liste ──
  await page.getByRole('button', { name: 'Liste' }).click();
  await page.waitForSelector('.lib-row[data-sel-id="b1"]');
  await card('b2').click({ modifiers: ['Meta'] });
  await card('b5').click({ modifiers: ['Shift'] });
  check((await selIds()).join() === 'b2,b3,b4,b5', 'liste : ⌘-clic puis ⇧-clic');
  check((await page.locator('.lib-row[aria-selected="true"]').count()) === 4, 'liste : aria-selected sur les lignes');
  await card('b5').focus();
  await page.keyboard.press('Space');
  check((await selIds()).join() === 'b2,b3,b4', 'Espace sur l’élément focalisé : bascule la sélection');
  await shot(page, '08-liste');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Grille' }).click();

  // ── Écrits ──
  await S(() => window.__store.getState().navigate({ name: 'write', draftId: null }));
  await page.waitForSelector('.ed-card[data-sel-id="d4"]');
  await page.waitForTimeout(500);
  await card('d1').locator('.ed-card-open').click({ modifiers: ['Meta'] });
  await card('d3').locator('.ed-card-open').click({ modifiers: ['Meta'] });
  check((await selIds()).join() === 'd1,d3' && (await S(() => window.__store.getState().route.draftId)) === null, 'Écrits : ⌘-clic sélectionne sans ouvrir');
  await card('d4').locator('.ed-card-open').click({ modifiers: ['Shift'] });
  check((await selIds()).join() === 'd1,d3,d4', 'Écrits : ⇧-clic');
  await shot(page, '09-ecrits');
  await page.locator('.msel-bar').getByRole('button', { name: /Ajouter à un espace/ }).click();
  await page.locator('.ws-modal .ws-move-row', { hasText: 'Dissertation : la raison' }).click();
  const wsDrafts = await S(() => {
    const s = window.__store.getState();
    const w = s.workspaces.find((x) => x.name === 'Dissertation : la raison');
    return s.wsItems.filter((i) => i.workspaceId === w.id && i.kind === 'draft').map((i) => i.refId).sort().join();
  });
  check(wsDrafts === 'd1,d3,d4', 'Écrits : 3 écrits ajoutés à l’espace');
  await page.keyboard.press('Meta+a');
  check((await selCount()) === 4, 'Écrits : ⌘A');
  await page.locator('.msel-bar').getByRole('button', { name: 'Supprimer' }).click();
  const dmid = await S(() => ({ n: window.__store.getState().drafts.length, ws: window.__store.getState().wsItems.filter((i) => i.kind === 'draft').length }));
  check(dmid.n === 0 && dmid.ws === 0, 'Écrits : 4 écrits dans la corbeille');
  check((await lastToast().innerText()).includes('4 écrits placés dans la corbeille'), 'Écrits : un seul toast « 4 écrits placés dans la corbeille »');
  await shot(page, '10-ecrits-supprimes');
  await lastToast().locator('.toast-action').click();
  await page.waitForTimeout(100);
  const dafter = await S(() => ({ ids: window.__store.getState().drafts.map((d) => d.id).join(), ws: window.__store.getState().wsItems.filter((i) => i.kind === 'draft').length }));
  check(dafter.ids === 'd1,d2,d3,d4' && dafter.ws === 3, 'Écrits : « Annuler » restaure les 4 écrits et leurs références d’espace');
  // Mode Sélectionner dans les Écrits
  await page.getByRole('button', { name: 'Sélectionner', exact: true }).click();
  await card('d2').locator('.ed-card-open').click();
  check((await selIds()).join() === 'd2' && (await S(() => window.__store.getState().route.draftId)) === null, 'Écrits, mode Sélectionner : clic simple coche');
  await shot(page, '11-ecrits-mode');
  await page.keyboard.press('Escape');
  check((await selCount()) === 0 && (await page.locator('.ed-card .msel-check').count()) === 0, 'Écrits : Échap quitte le mode');

  // ── Thème sombre ──
  await S(() => window.__store.getState().updateSettings({ theme: 'dark' }));
  await S(() => window.__store.getState().navigate({ name: 'library' }));
  await page.waitForSelector('.lib-card[data-sel-id="b1"]');
  await page.waitForTimeout(500);
  await card('b1').click({ modifiers: ['Meta'] });
  await card('b2').click({ modifiers: ['Meta'] });
  await shot(page, '12-sombre');
} catch (e) {
  console.error(e);
  failures++;
} finally {
  if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + errors.join('\n'));
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} échec(s)` : '\nTout est vert.');
process.exit(failures || errors.length ? 1 : 0);
