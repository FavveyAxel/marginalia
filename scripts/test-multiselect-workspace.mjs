// Sélection multiple dans les espaces (vue d'espace + arbre latéral) : ⌘/⇧-clic, ⌘A, Échap, clic dans le vide,
// mode « Sélectionner », barre d'actions, retrait groupé + Annuler / ⌘Z, déplacement groupé, glisser-déposer multiple
// (vue et arbre) avec badge, nouveau groupe avec la sélection, menu contextuel, suppression groupée.
// Lancer : timeout 240 node scripts/test-multiselect-workspace.mjs
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const PORT = 5322;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = path.join(ROOT, 'shots/ws-multiselect');
fs.mkdirSync(SHOTS, { recursive: true });
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};

const server = await createServer({
  root: ROOT,
  cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`),
  // HMR et surveillance coupés : d'autres modules peuvent être modifiés pendant le test.
  server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Trace de l'aperçu de glissement (badge « N »).
await ctx.addInitScript(() => {
  const orig = DataTransfer.prototype.setDragImage;
  DataTransfer.prototype.setDragImage = function (el, x, y) {
    window.__dragBadge = el?.querySelector?.('.ws-drag-badge')?.textContent ?? null;
    return orig.call(this, el, x, y);
  };
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

const st = (fn, arg) => page.evaluate(fn, arg);
const tick = (ms = 200) => page.waitForTimeout(ms);
const shot = async (name) => {
  await page.screenshot({ path: path.join(SHOTS, name) });
  console.log('capture:', `shots/ws-multiselect/${name}`);
};
const card = (title) => page.locator('.ws-card', { hasText: title }).first();
const cardMain = (title) => card(title).locator('.ws-card-main');
const nSel = () => page.locator('.ws-card.selected').count();
const barText = () => page.locator('.ws-selbar-count').innerText().catch(() => '');
const wsItemsOf = (wsName) =>
  st((n) => {
    const s = window.__store.getState();
    const w = s.workspaces.find((x) => x.name === n);
    return s.wsItems.filter((i) => i.workspaceId === w.id).map((i) => ({ ...i }));
  }, wsName);
const groupId = (name) => st((n) => window.__store.getState().groups.find((g) => g.name === n)?.id ?? null, name);
const titleOfItem = (id) =>
  st((id) => {
    const s = window.__store.getState();
    const it = s.wsItems.find((i) => i.id === id);
    return s.books.find((b) => b.id === it?.refId)?.title ?? s.plans.find((p) => p.id === it?.refId)?.title;
  }, id);
const undoCount = () => st(async () => (await import('/src/lib/store.ts')).undoInfo().undo.length);
const meta = { modifiers: ['Meta'] };
const shift = { modifiers: ['Shift'] };

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });

  // ── Données : espace « liberté » (9 livres + 1 plan à la racine), groupes ; espace « Mémoire » ──
  await st(() => {
    const now = Date.now();
    const book = (i) => ({
      id: 'b' + i, title: `Livre ${i}`, author: 'Auteur ' + i, format: 'epub', fileName: 'source.epub', originalName: `l${i}.epub`,
      size: 10, addedAt: now - i * 1000, lastOpenedAt: null, progress: 0, position: null, cover: null,
      edition: { publisher: '', year: '', translator: '', place: '', pageOffset: 0 },
    });
    const books = Array.from({ length: 9 }, (_, i) => book(i + 1));
    const ws = [
      { id: 'wP', name: 'liberté', tint: '--cat-these', order: 0, createdAt: now },
      { id: 'wM', name: 'Mémoire', tint: '--cat-concept', order: 1, createdAt: now },
    ];
    const groups = [
      { id: 'gL', workspaceId: 'wP', parentId: null, name: 'Lectures', order: 0, collapsed: false },
      { id: 'gT', workspaceId: 'wP', parentId: null, name: 'À trier', order: 1, collapsed: false },
      { id: 'gM', workspaceId: 'wM', parentId: null, name: 'Sources', order: 0, collapsed: false },
    ];
    const wsItems = books.map((b, i) => ({ id: 'i' + (i + 1), workspaceId: 'wP', groupId: null, kind: 'book', refId: b.id, order: i }));
    wsItems.push({ id: 'i10', workspaceId: 'wP', groupId: null, kind: 'plan', refId: 'p1', order: 9 });
    // Livre 9 déjà présent dans « Mémoire » (doublon à ne pas recréer lors d'un déplacement vers cet espace).
    wsItems.push({ id: 'm9', workspaceId: 'wM', groupId: null, kind: 'book', refId: 'b9', order: 0 });
    const plans = [{ id: 'p1', title: 'Plan du liberté', sujet: 'Le liberté', definitions: '', problematique: '', parts: [], conclusion: '', draftId: null, createdAt: now, updatedAt: now }];
    window.__store.setState({ books, workspaces: ws, groups, wsItems, plans });
    window.__store.getState().updateSettings({ activeWorkspaceId: 'wP' });
    window.__store.getState().navigate({ name: 'workspace', workspaceId: 'wP', groupId: null });
  });
  await page.waitForSelector('.ws-card');
  await tick(500);
  ok('10 cartes à la racine de « liberté »', (await page.locator('.ws-card').count()) === 10);

  // ── Clic simple : ouvre toujours (aucune sélection) ──
  // (vérifié plus bas sur le plan ; ici on teste d'abord les gestes de sélection)

  // ── ⌘-clic, ⇧-clic ──
  await cardMain('Livre 1').click(meta);
  ok('⌘-clic : 1 sélectionné, barre affichée', (await nSel()) === 1 && /1 sélectionné/.test(await barText()));
  ok('aria-selected sur la carte', (await card('Livre 1').getAttribute('aria-selected')) === 'true');
  await cardMain('Livre 3').click(meta);
  await cardMain('Livre 6').click(shift);
  ok('⇧-clic : plage 3→6 ajoutée (5 sélectionnés)', (await nSel()) === 5 && /5 sélectionnés/.test(await barText()), String(await nSel()));
  ok('Livre 2 hors plage', (await card('Livre 2').getAttribute('aria-selected')) === 'false');
  await cardMain('Livre 4').click(meta);
  ok('⌘-clic sur un sélectionné : retiré (4)', (await nSel()) === 4);
  await shot('1-selection-cmd-shift.png');

  await page.keyboard.press('Escape');
  await tick();
  ok('Échap : sélection vidée, barre masquée', (await nSel()) === 0 && (await page.locator('.ws-selbar').count()) === 0);

  await page.locator('.ws-title').hover();
  await page.keyboard.press('Meta+a');
  await tick();
  ok('⌘A : tout le niveau affiché (10)', (await nSel()) === 10);
  // Clic dans le vide (zone sous les cartes)
  const box = await page.locator('.ws-scroll').boundingBox();
  await page.mouse.click(box.x + box.width - 30, box.y + box.height - 20);
  await tick();
  ok('clic dans le vide : sélection vidée', (await nSel()) === 0);

  // Lasso (rectangle) depuis le vide
  const g1 = await card('Livre 1').boundingBox();
  const g2 = await card('Livre 2').boundingBox();
  await page.mouse.move(g1.x - 6, g1.y - 8);
  await page.mouse.down();
  await page.mouse.move(g2.x + g2.width / 2, g2.y + 40, { steps: 6 });
  await page.mouse.up();
  await tick();
  ok('lasso : 2 cartes', (await nSel()) === 2, String(await nSel()));
  await page.keyboard.press('Escape');

  // ── Retrait groupé + Annuler (toast) ──
  const before = await wsItemsOf('liberté');
  await cardMain('Livre 2').click(meta);
  await cardMain('Livre 5').click(meta);
  await cardMain('Livre 7').click(meta);
  const u0 = await undoCount();
  await page.locator('.ws-selbar').getByRole('button', { name: 'Retirer de l’espace' }).click();
  await tick(300);
  let items = await wsItemsOf('liberté');
  ok('retrait groupé : 3 références retirées', items.length === before.length - 3);
  ok('les livres restent dans la bibliothèque', (await st(() => window.__store.getState().books.length)) === 9);
  ok('un seul pas d’annulation', (await undoCount()) === u0 + 1);
  const toast = page.locator('.toast', { hasText: '3 éléments retirés' });
  ok('toast « 3 éléments retirés de l’espace — Annuler »', (await toast.count()) === 1 && (await toast.locator('.toast-action').innerText()) === 'Annuler');
  const act = await st(() => window.__store.getState().activity[0]);
  ok('journal : une seule entrée groupée', act.summary === '3 éléments retirés de l’espace' && act.refIds?.length === 3, JSON.stringify(act.summary));
  ok('barre masquée après le retrait', (await page.locator('.ws-selbar').count()) === 0);
  await shot('2-retrait-toast.png');
  await toast.locator('.toast-action').click();
  await tick(300);
  items = await wsItemsOf('liberté');
  const sameOrder = JSON.stringify(items.map((i) => [i.id, i.order, i.groupId])) === JSON.stringify(before.map((i) => [i.id, i.order, i.groupId]));
  ok('Annuler : les 3 reviennent à leur place exacte', items.length === before.length && sameOrder);

  // Retrait + ⌘Z
  await cardMain('Livre 8').click(meta);
  await cardMain('Livre 9').click(meta);
  await page.locator('.ws-selbar').getByRole('button', { name: 'Retirer de l’espace' }).click();
  await tick(200);
  ok('retrait de 2', (await wsItemsOf('liberté')).length === before.length - 2);
  await page.locator('.ws-title').hover();
  await page.keyboard.press('Meta+z');
  await tick(400);
  ok('⌘Z : un seul pas restaure les 2', (await wsItemsOf('liberté')).length === before.length);

  // ── Déplacement groupé vers un groupe (barre → Déplacer vers… → Lectures) ──
  await cardMain('Livre 1').click(meta);
  await cardMain('Livre 3').click(meta);
  await page.locator('.ws-selbar').getByRole('button', { name: 'Déplacer vers…' }).click();
  await tick();
  await shot('3-deplacer-menu.png');
  await page.locator('.ws-menu').getByRole('menuitem', { name: 'Lectures' }).click();
  await tick(300);
  const gL = await groupId('Lectures');
  items = await wsItemsOf('liberté');
  ok('déplacement groupé : Livre 1 et 3 dans « Lectures »', items.filter((i) => i.groupId === gL).map((i) => i.refId).sort().join() === 'b1,b3');
  ok('toast de déplacement', (await page.locator('.toast', { hasText: '2 livres déplacés vers « Lectures »' }).count()) === 1);
  ok('journal : « 2 éléments déplacés dans « Lectures » »', (await st(() => window.__store.getState().activity[0].summary)) === '2 éléments déplacés dans « Lectures »');
  const u1 = await undoCount();
  await page.locator('.ws-title').hover();
  await page.keyboard.press('Meta+z');
  await tick(400);
  items = await wsItemsOf('liberté');
  ok('⌘Z : déplacement défait d’un coup', items.filter((i) => i.groupId === gL).length === 0 && (await undoCount()) === u1 - 1);

  // ── Glisser-déposer multiple dans la vue (vers la tuile « À trier ») ──
  await cardMain('Livre 2').click(meta);
  await cardMain('Livre 4').click(meta);
  await cardMain('Livre 6').click(meta);
  const tile = page.locator('.ws-tile', { hasText: 'À trier' }).first();
  const tb = await tile.boundingBox();
  await card('Livre 4').dragTo(tile, { targetPosition: { x: tb.width / 2, y: tb.height / 2 } });
  await tick(400);
  const gT = await groupId('À trier');
  items = await wsItemsOf('liberté');
  ok('glisser multiple : les 3 suivent dans « À trier »', items.filter((i) => i.groupId === gT).map((i) => i.refId).sort().join() === 'b2,b4,b6');
  ok('ordre conservé (2, 4, 6)', items.filter((i) => i.groupId === gT).sort((a, b) => a.order - b.order).map((i) => i.refId).join() === 'b2,b4,b6');
  ok('aperçu de glissement : badge « 3 »', (await st(() => window.__dragBadge)) === '3');
  await page.keyboard.press('Escape');

  // ── Nouveau groupe avec la sélection ──
  await cardMain('Livre 7').click(meta);
  await cardMain('Livre 8').click(meta);
  await page.locator('.ws-selbar').getByRole('button', { name: 'Nouveau groupe' }).click();
  await tick(250);
  ok('nouveau groupe : saisie du nom ouverte', (await page.locator('.ws-tile input').count()) === 1);
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('Chapitre 1');
  await page.keyboard.press('Enter');
  await tick(300);
  const gC = await groupId('Chapitre 1');
  items = await wsItemsOf('liberté');
  ok('groupe « Chapitre 1 » créé avec Livre 7 et 8', !!gC && items.filter((i) => i.groupId === gC).map((i) => i.refId).sort().join() === 'b7,b8');
  await shot('4-nouveau-groupe.png');

  // ── Menu contextuel sur un élément sélectionné ──
  await cardMain('Livre 1').click(meta);
  await cardMain('Livre 3').click(meta);
  await card('Livre 3').click({ button: 'right' });
  await tick();
  ok('clic droit sur la sélection : menu de la sélection', (await page.locator('.ws-menu[aria-label="Menu de la sélection (2)"]').count()) === 1);
  ok('menu : « Nouveau groupe avec la sélection » et « Retirer 2 éléments »', (await page.locator('.ws-menu').getByRole('menuitem', { name: 'Nouveau groupe avec la sélection' }).count()) === 1 && (await page.locator('.ws-menu').getByRole('menuitem', { name: /Retirer 2 éléments/ }).count()) === 1);
  await shot('5-menu-contextuel.png');
  // Vers un autre espace (sous-menu) : Livre 1 et 3 vers « Mémoire » (racine)
  await page.locator('.ws-menu').getByRole('menuitem', { name: 'Déplacer vers' }).click();
  await page.locator('.ws-menu').getByRole('menuitem', { name: 'Vers un autre espace' }).click();
  await page.locator('.ws-menu').getByRole('menuitem', { name: 'Mémoire' }).click();
  await page.locator('.ws-menu').getByRole('menuitem', { name: 'Mémoire (racine)' }).click();
  await tick(300);
  const mem = await wsItemsOf('Mémoire');
  ok('vers un autre espace : Livre 1 et 3 dans « Mémoire »', mem.map((i) => i.refId).sort().join() === 'b1,b3,b9');
  ok('… et sortis de « liberté »', (await wsItemsOf('liberté')).every((i) => i.refId !== 'b1' && i.refId !== 'b3'));

  // ── Mode « Sélectionner » (cases à cocher) ──
  await page.getByRole('button', { name: 'Sélectionner' }).click();
  await tick();
  ok('mode Sélectionner : cases visibles', (await page.locator('.ws-check-box').count()) === (await page.locator('.ws-card').count()));
  await cardMain('Livre 5').click();
  await cardMain('Livre 9').click();
  const r0 = await st(() => window.__store.getState().route.name);
  ok('mode Sélectionner : clic simple coche sans ouvrir', (await nSel()) === 2 && r0 === 'workspace');
  await shot('6-mode-selectionner.png');

  // ── Suppression groupée (corbeille) + ⌘Z ──
  const trash0 = await st(() => window.__store.getState().trash.length);
  await page.locator('.ws-selbar').getByRole('button', { name: 'Supprimer…' }).click();
  await tick();
  ok('confirmation au pluriel', (await page.locator('[role="dialog"] h3').innerText()) === 'Supprimer 2 livres ?');
  await shot('7-confirmation-suppression.png');
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Supprimer 2 livres' }).click();
  await tick(300);
  ok('2 livres dans la corbeille', (await st(() => window.__store.getState().trash.length)) === trash0 + 2 && (await st(() => window.__store.getState().books.length)) === 7);
  ok('toast « 2 livres placés dans la corbeille »', (await page.locator('.toast', { hasText: '2 livres placés dans la corbeille' }).count()) === 1);
  await page.getByRole('button', { name: 'Terminer' }).click();
  await page.locator('.ws-title').hover();
  await page.keyboard.press('Meta+z');
  await tick(400);
  ok('⌘Z : les 2 livres reviennent d’un coup', (await st(() => window.__store.getState().books.length)) === 9 && (await st(() => window.__store.getState().trash.length)) === trash0);

  // ── Clic simple : ouvre (sans sélection) ──
  await cardMain('Plan du liberté').click();
  await tick(300);
  ok('clic simple : ouvre l’élément', (await st(() => window.__store.getState().route.name)) === 'plans');
  await st(() => window.__store.getState().navigate({ name: 'workspace', workspaceId: 'wP', groupId: null }));
  await tick(300);

  // ── Arbre latéral : ⌘/⇧-clic, glisser multiple vers un groupe ──
  const trow = (t) => page.locator('.ws-tree .ws-row-item', { hasText: t }).first();
  await trow('Livre 5').click(meta);
  await trow('Livre 9').click(shift);
  const treeSel = await page.locator('.ws-tree .ws-row-item.selected').count();
  // Racine de « liberté » à ce stade : Livre 5, Livre 9, Plan → plage 5→9 = 2 éléments.
  ok('arbre : ⌘-clic puis ⇧-clic (plage 5→9 à la racine)', treeSel === 2, String(treeSel));
  ok('arbre : barre de sélection', /2 sélectionnés/.test(await barText()));
  ok('arbre : aria-selected', (await trow('Livre 5').getAttribute('aria-selected')) === 'true');
  await shot('8-arbre-selection.png');
  const lect = page.locator('.ws-tree .ws-row-group', { hasText: 'Lectures' }).first();
  await trow('Livre 9').dragTo(lect);
  await tick(400);
  items = await wsItemsOf('liberté');
  const inL = items.filter((i) => i.groupId === gL).map((i) => i.refId).sort().join();
  ok('arbre : glisser multiple vers « Lectures »', inL === 'b5,b9', inL);
  ok('arbre : badge « 2 »', (await st(() => window.__dragBadge)) === '2');
  await page.keyboard.press('Escape');
  // ⌘A dans l'arbre (focus sur une ligne de l'espace)
  await trow('Livre 5').focus();
  await page.keyboard.press('Meta+a');
  await tick();
  const visible = await page.locator('.ws-tree .ws-collapse.open .ws-row-item[data-ws-id="wP"]').count();
  ok('arbre : ⌘A sélectionne les éléments visibles de l’espace', (await page.locator('.ws-tree .ws-row-item.selected').count()) === visible && visible > 3, String(visible));
  await page.keyboard.press('Escape');
  ok('arbre : Échap vide', (await page.locator('.ws-tree .ws-row-item.selected').count()) === 0);
  await shot('9-fin.png');

  const real = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
  ok('aucune erreur navigateur', real.length === 0, real.join('\n'));
  console.log(`\n${passed} vérifications passées.`);
} catch (e) {
  await shot('echec.png').catch(() => {});
  if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + [...new Set(errors)].join('\n'));
  throw e;
} finally {
  await browser.close();
  await server.close();
}
