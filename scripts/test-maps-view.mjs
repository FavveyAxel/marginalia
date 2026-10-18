// Vue « Cartes » (Vite + Chromium, port 5397) : onglet sous « Écrits », compte, lieux, filtres, ouverture.
// Lancer : timeout 240 node scripts/test-maps-view.mjs        Captures : shots/maps/
import assert from 'node:assert/strict';
import { withApp, shot } from './harness.mjs';

const PORT = 5397;
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};
const tick = (page, ms = 250) => page.waitForTimeout(ms);

await withApp(PORT, async (page, errors) => {
  const S = (fn, arg) => page.evaluate(fn, arg);
  await S(async () => {
    const { host } = await import('/src/lib/platform.ts');
    const s = window.__store.getState();
    const book = (id, title) => ({ id, title, author: 'A', format: 'epub', fileName: 'source.epub', originalName: 'x.epub', size: 1, addedAt: 1, lastOpenedAt: null, progress: 0, position: null, cover: null });
    const node = (id, x) => ({ id, highlightId: null, text: 'Idée ' + id, x, y: 0 });
    await host.saveDb({
      books: [book('bK', 'Kant'), book('bC', 'Constant'), book('bE', 'Vide')],
      highlights: [], concepts: [],
      maps: {
        bK: { bookId: 'bK', nodes: [node('a', 0), node('b', 400)], edges: [{ id: 'e', source: 'a', target: 'b', relation: 'soutient', groupId: null }], viewport: null, updatedAt: 5 },
        bE: { bookId: 'bE', nodes: [], edges: [], viewport: null },
        'board-1': { id: 'board-1', kind: 'board', bookId: '', title: 'Kant contre Constant', bookIds: [], nodes: [node('x', 0)], edges: [], viewport: null, updatedAt: 9 },
        'board-2': { id: 'board-2', kind: 'board', bookId: '', title: 'Brouillon', bookIds: [], nodes: [], edges: [], viewport: null, updatedAt: 3 },
      },
      arguments: [], plans: [], drafts: [], cards: [], studies: [], bookmarks: [],
      workspaces: [{ id: 'wP', name: 'Liberté', tint: '--cat-these', order: 0, createdAt: 1 }],
      groups: [{ id: 'gS', workspaceId: 'wP', parentId: null, name: 'Sources', order: 0, collapsed: false }],
      wsItems: [
        { id: 'i1', workspaceId: 'wP', groupId: 'gS', kind: 'map', refId: 'board-1', order: 0 },
        { id: 'i2', workspaceId: 'wP', groupId: null, kind: 'book', refId: 'bK', order: 1 },
      ],
      settings: s.settings, trash: [], activity: [],
    });
  });
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });

  const labels = await page.locator('.sidebar .nav-label').allInnerTexts();
  ok('onglet « Cartes » juste sous « Écrits »', labels.indexOf('Cartes') === labels.indexOf('Écrits') + 1, labels.join('|'));
  const nav = page.getByRole('button', { name: 'Cartes', exact: true });
  ok('compte dans la barre latérale (carte vide de livre exclue)', (await nav.locator('.count').innerText()) === '3');
  await nav.click();
  await tick(page, 500);
  ok('vue Cartes ouverte', (await S(() => window.__store.getState().route.name)) === 'maps');
  ok('résumé', (await page.getByTestId('maps-summary').innerText()).includes('3 cartes : 2 libres, 1 de livre'));
  const liberte = page.getByTestId('maps-section-wP');
  ok('section Liberté : la carte libre et la carte du livre rangé', (await liberte.locator('.mv-card').count()) === 2);
  ok('lieu affiché avec le groupe', (await liberte.locator('[data-map-key="board-1"] [data-testid="map-places"]').innerText()).includes('Liberté › Sources'));
  const loose = page.getByTestId('maps-section-none');
  ok('hors espace : « Brouillon », marqué non rangée', (await loose.locator('[data-map-key="board-2"]').innerText()).includes('Non rangée'));
  await shot(page, 'shots/maps/01-par-espace.png');

  await page.getByRole('radio', { name: /^Libres/ }).click();
  ok('filtre « Libres »', (await page.locator('.mv-card[data-kind="book"]').count()) === 0 && (await page.locator('.mv-card').count()) === 2);
  await page.getByRole('radio', { name: 'Récentes' }).click();
  ok('« Récentes » : triées par date', (await page.locator('.mv-card').evaluateAll((els) => els.map((e) => e.dataset.mapKey))).join() === 'board-1,board-2');
  await page.getByRole('radio', { name: /^Toutes/ }).click();
  await page.getByPlaceholder('Rechercher une carte, un livre, un espace').fill('kant');
  ok('recherche', (await page.locator('.mv-card').count()) === 2);
  await page.getByPlaceholder('Rechercher une carte, un livre, un espace').fill('');
  await shot(page, 'shots/maps/02-recentes.png');

  await page.locator('[data-map-key="bK"] .mv-open').click();
  await tick(page, 500);
  let r = await S(() => window.__store.getState().route);
  ok('ouvre la carte du livre', r.name === 'reader' && r.bookId === 'bK' && r.tab === 'carte');
  await nav.click();
  await tick(page, 400);
  await page.locator('[data-map-key="board-1"] .mv-open').click();
  await tick(page, 500);
  r = await S(() => window.__store.getState().route);
  ok('ouvre la carte libre', r.name === 'board' && r.boardId === 'board-1');
  await nav.click();
  await tick(page, 400);
  await page.locator('[data-map-key="board-1"] .mv-place', { hasText: 'Liberté' }).click();
  await tick(page, 400);
  r = await S(() => window.__store.getState().route);
  ok('un clic sur le lieu ouvre l’espace / le groupe', r.name === 'workspace' && r.workspaceId === 'wP' && r.groupId === 'gS');
  await nav.click();
  await page.getByTestId('maps-new').click();
  await tick(page, 400);
  ok('« Nouvelle carte »', (await S(() => window.__store.getState().route.name)) === 'board');
  ok('aucune erreur navigateur', errors.length === 0, errors.join('\n'));
  console.log(`\n${passed} vérifications réussies`);
});
