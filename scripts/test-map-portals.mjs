// Portails entre cartes (Vite + Chromium, port 5399) : carte « portail » (titre vivant, nature,
// nombre de cartes, miniature, « Carte introuvable »), Ouvrir / double-clic vers carte libre, carte de
// livre et carte de mouvement, pastille « ← Revenir à… », rétroliens « Liée depuis N cartes »,
// badge « aussi dans N cartes » des extraits, création (barre « Lien », clic droit, panneau Ajouter),
// changement de cible, export SVG.
// Lancer : timeout 300 node scripts/test-map-portals.mjs        Captures : shots/portals/
import assert from 'node:assert/strict';
import { withApp, shot } from './harness.mjs';

const PORT = 5399;
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
    const anchor = (start) => ({ kind: 'html', chapter: 0, start, end: start + 5, prefix: '', suffix: '' });
    const book = (id, title, author) => ({ id, title, author, format: 'epub', fileName: 'source.epub', originalName: 'x.epub', size: 1, addedAt: 1, lastOpenedAt: null, progress: 0, position: null, cover: null });
    const hl = (id, bookId, category, text, start) => ({ id, bookId, category, text, note: '', noteKind: null, conceptIds: [], anchor: anchor(start), locationLabel: '', printedPage: '12', createdAt: 1, updatedAt: start });
    const idea = (id, text, x, y) => ({ id, highlightId: null, text, x, y });
    await host.saveDb({
      books: [book('bK', 'D’un prétendu droit de mentir', 'Emmanuel Kant'), book('bC', 'Des réactions politiques', 'Benjamin Constant')],
      highlights: [
        hl('hK1', 'bK', 'these', 'La véracité est un devoir formel de l’homme envers chacun', 10),
        hl('hC1', 'bC', 'these', 'Nul homme n’a droit à la vérité qui nuit à autrui', 120),
      ],
      concepts: [],
      studies: [
        { id: 'st1', bookId: 'bC', title: 'Le droit de mentir', probleme: '', these: '', enjeu: '', createdAt: 1, updatedAt: 1, movements: [
          { id: 'm1', anchor: anchor(0), startText: '', title: 'Le principe', role: '' },
          { id: 'm2', anchor: anchor(100), startText: '', title: 'Le droit de mentir', role: '' },
        ] },
      ],
      maps: {
        bK: {
          bookId: 'bK',
          nodes: [{ id: 'T', highlightId: 'hK1', text: '', x: 0, y: 0 }, { id: 'P1', highlightId: null, text: 'ancien titre', x: 380, y: 0, portal: 'board-1' }],
          edges: [],
          viewport: null,
        },
        'board-1': {
          id: 'board-1', kind: 'board', bookId: '', title: 'Kant contre Constant', bookIds: ['bK'],
          nodes: [
            { id: 'K', highlightId: 'hK1', text: '', x: 0, y: 0 },
            { id: 'P2', highlightId: null, text: '', x: 380, y: 0, portal: 'mv-st1-m2' },
            { id: 'P3', highlightId: null, text: 'Carte effacée', x: 380, y: 260, portal: 'board-gone' },
            idea('I', 'Le mensonge comme devoir de prudence ?', 0, 260),
          ],
          edges: [{ id: 'e1', source: 'I', target: 'K', relation: 'objecte', groupId: null }],
          viewport: null, updatedAt: 9,
        },
        'mv-st1-m2': {
          id: 'mv-st1-m2', kind: 'movement', bookId: 'bC', studyId: 'st1', movementId: 'm2', title: 'Le droit de mentir — II. Le droit de mentir',
          nodes: [{ id: 'C', highlightId: 'hC1', text: '', x: 0, y: 0 }], edges: [], zones: [], viewport: null,
        },
        'board-2': { id: 'board-2', kind: 'board', bookId: '', title: 'Brouillon', bookIds: [], nodes: [], edges: [], viewport: null, updatedAt: 3 },
      },
      arguments: [], plans: [], drafts: [], cards: [], bookmarks: [],
      workspaces: [], groups: [], wsItems: [],
      settings: { ...s.settings, theme: 'light' }, trash: [], activity: [],
    });
  });
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  const route = () => S(() => window.__store.getState().route);
  const maps = () => S(() => window.__store.getState().maps);
  const go = async (r) => {
    await S((r) => window.__store.getState().navigate(r), r);
    await page.waitForSelector('[data-testid=map-root] .react-flow__node', { timeout: 15000 });
    await tick(page, 500);
  };

  // ── 1. Rendu sur la carte libre ──
  await go({ name: 'board', boardId: 'board-1' });
  const portals = page.locator('[data-testid=portal-node]');
  ok('un portail et un portail cassé rendus', (await portals.count()) === 2 && (await page.locator('.map-portal.missing').count()) === 1);
  const p2 = page.locator('.map-portal[data-portal="mv-st1-m2"]');
  ok('titre vivant de la carte de mouvement', (await p2.getByTestId('portal-title').innerText()) === 'II. Le droit de mentir');
  ok('nature, livre, nombre de cartes', (await p2.innerText()).includes('CARTE DE MOUVEMENT') || (await p2.innerText()).toLowerCase().includes('carte de mouvement'));
  ok('livre et compte', (await p2.innerText()).includes('Des réactions politiques') && (await p2.innerText()).includes('1 carte'));
  ok('miniature', (await p2.locator('.map-portal-thumb svg').count()) === 1);
  ok('cible supprimée : « Carte introuvable »', (await page.locator('.map-portal[data-portal="board-gone"]').innerText()).includes('Carte introuvable'));
  ok('rétroliens : « Liée depuis 1 carte »', (await page.getByTestId('map-backlinks').innerText()).includes('1 carte'));
  ok('badge « aussi dans 1 carte » sur l’extrait réutilisé', (await page.locator('.react-flow__node[data-id="K"] [data-testid=reuse-badge]').innerText()) === 'aussi dans 1 carte');
  ok('pas de pastille de retour sans saut', (await page.getByTestId('portal-back').count()) === 0);
  await page.locator('.react-flow__node[data-id="P2"]').click();
  await tick(page);
  await shot(page, 'shots/portals/01-carte-libre.png');

  // ── 2. Ouvrir → carte de mouvement ; pastille « Revenir » ──
  await p2.locator('[data-act=portal-open]').click();
  await page.waitForSelector('[data-testid=crumb-movement]', { timeout: 15000 });
  await tick(page, 500);
  let r = await route();
  ok('Ouvrir : onglet Carte du livre du mouvement', r.name === 'reader' && r.bookId === 'bC' && r.tab === 'carte');
  ok('… sur la carte du mouvement', (await page.getByTestId('crumb-movement').innerText()).includes('Le droit de mentir'));
  const back = page.getByTestId('portal-back');
  ok('pastille « ← Revenir à Kant contre Constant »', (await back.innerText()).includes('Kant contre Constant'));
  await shot(page, 'shots/portals/02-revenir.png');
  await back.click();
  await page.waitForSelector('.map-portal', { timeout: 15000 });
  await tick(page, 400);
  r = await route();
  ok('retour à la carte libre', r.name === 'board' && r.boardId === 'board-1');
  ok('pile vidée : plus de pastille', (await page.getByTestId('portal-back').count()) === 0);

  // ── 3. Badge « aussi dans » → carte du livre ; double-clic sur un portail ──
  await page.locator('.react-flow__node[data-id="K"] [data-testid=reuse-badge]').click();
  await tick(page);
  const item = page.locator('[role=menu] [role=menuitem]', { hasText: 'D’un prétendu droit de mentir' });
  ok('popover : la carte du livre de Kant', (await item.count()) === 1);
  await shot(page, 'shots/portals/03-aussi-dans.png');
  await item.click();
  await page.waitForSelector('.react-flow__node[data-id="P1"]', { timeout: 15000 });
  await tick(page, 400);
  r = await route();
  ok('ouvre l’onglet Carte du livre', r.name === 'reader' && r.bookId === 'bK' && r.tab === 'carte');
  ok('portail de la carte du livre : titre vivant (pas le texte mémorisé)', (await page.locator('.react-flow__node[data-id="P1"] [data-testid=portal-title]').innerText()) === 'Kant contre Constant');
  await page.locator('.react-flow__node[data-id="P1"] .map-portal').dblclick();
  await page.waitForSelector('[data-testid=board-title]', { timeout: 15000 });
  await tick(page, 400);
  r = await route();
  ok('double-clic : vers la carte libre', r.name === 'board' && r.boardId === 'board-1');
  ok('pastille : revenir à la carte du livre', (await page.getByTestId('portal-back').innerText()).includes('D’un prétendu droit de mentir'));

  // ── 4. Rétroliens cliquables ──
  await page.getByTestId('map-backlinks').click();
  await tick(page);
  const bl = page.locator('[role=menu] [role=menuitem]');
  ok('liste des cartes qui mènent ici', (await bl.count()) === 1 && (await bl.first().innerText()).includes('D’un prétendu droit de mentir'));
  await page.keyboard.press('Escape');

  // ── 5. Titre vivant : renommer la cible ──
  await S(() => import('/src/features/map/model/actions.ts').then((A) => A.renameMap('board-1', 'Kant face à Constant')));
  await go({ name: 'reader', bookId: 'bK', tab: 'carte', splitBookId: null });
  ok('le portail suit le renommage', (await page.locator('.react-flow__node[data-id="P1"] [data-testid=portal-title]').innerText()) === 'Kant face à Constant');

  // ── 6. Création : barre « Lien » (sélecteur avec recherche) ──
  await S(() => window.__store.getState().navigate({ name: 'board', boardId: 'board-2' }));
  await page.waitForSelector('[data-testid=map-root]');
  await tick(page, 400);
  await page.locator('[data-act=portal-link]').click();
  await tick(page);
  const picker = page.getByTestId('portal-picker');
  ok('sélecteur ouvert, toutes les autres cartes', (await picker.locator('[data-map]').count()) === 3);
  await picker.getByPlaceholder('Rechercher une carte').fill('face a');
  ok('recherche', (await picker.locator('[data-map]').count()) === 1);
  await shot(page, 'shots/portals/04-selecteur.png');
  await page.keyboard.press('Enter');
  await tick(page, 400);
  let m2 = (await maps())['board-2'];
  ok('portail posé (Entrée)', m2.nodes.length === 1 && m2.nodes[0].portal === 'board-1' && m2.nodes[0].text === 'Kant face à Constant');
  ok('rendu sur la carte', (await page.locator('[data-testid=portal-node]').count()) === 1);

  // ── 7. Clic droit dans le vide ──
  const pane = page.locator('.react-flow__pane');
  const box = await pane.boundingBox();
  await page.mouse.click(box.x + 200, box.y + box.height - 220, { button: 'right' });
  await tick(page);
  await page.locator('[role=menu] [role=menuitem]', { hasText: 'Lien vers une autre carte…' }).click();
  await tick(page);
  await page.getByTestId('portal-picker').locator('[data-map="bK"]').click();
  await tick(page, 400);
  m2 = (await maps())['board-2'];
  ok('clic droit : portail vers la carte du livre', m2.nodes.length === 2 && m2.nodes.some((n) => n.portal === 'bK'));

  // ── 8. Panneau Ajouter › Autres cartes › « Poser un lien vers cette carte » ──
  await page.getByTestId('board-add-toggle').click();
  await tick(page);
  await page.getByRole('tab', { name: /Autres cartes/ }).click();
  await tick(page);
  const row = page.locator('.board-add-mapitem[data-map="mv-st1-m2"]');
  ok('chaque carte propose « Poser un lien vers cette carte »', (await page.locator('.board-add-mapitem [data-act=add-portal]').count()) === 3);
  await shot(page, 'shots/portals/05-panneau-ajouter.png');
  await row.locator('[data-act=add-portal]').click();
  await tick(page, 400);
  m2 = (await maps())['board-2'];
  ok('panneau Ajouter : portail vers la carte de mouvement', m2.nodes.length === 3 && m2.nodes.some((n) => n.portal === 'mv-st1-m2'));
  ok('rétroliens de board-1 : 2 cartes', (await S(() => import('/src/features/map/model/portals.ts').then((P) => P.backlinksOf(window.__store.getState().maps, 'board-1').length))) === 2);
  await page.getByTestId('board-add-toggle').click();

  // ── 9. Changer de cible (clic droit sur le portail) ──
  const first = m2.nodes.find((n) => n.portal === 'bK');
  await page.locator(`.react-flow__node[data-id="${first.id}"]`).click({ button: 'right' });
  await tick(page);
  await page.locator('[role=menu] [role=menuitem]', { hasText: 'Changer de carte…' }).click();
  await tick(page);
  await page.getByTestId('portal-picker').locator('[data-map="mv-st1-m2"]').click();
  await tick(page, 300);
  m2 = (await maps())['board-2'];
  ok('cible changée', m2.nodes.find((n) => n.id === first.id).portal === 'mv-st1-m2');

  // ── 10. Export SVG ──
  const svg = await S(() => import('/src/features/map/model/actions.ts').then((A) => A.exportSvg('board-1').svg));
  ok('SVG : portails dessinés avec le titre de la cible', svg.includes('class="node portal"') && svg.includes('II. Le droit de mentir') && svg.includes('PORTAIL · CARTE DE MOUVEMENT'));
  ok('SVG : portail cassé', svg.includes('Carte introuvable'));
  const png = await S(() => import('/src/features/map/model/actions.ts').then((A) => A.exportPng('board-1', 1)).then((b) => b.byteLength));
  ok('PNG exporté', png > 1000);

  // ── 11. Cible supprimée en cours de route ──
  await S(() => import('/src/features/map/model/actions.ts').then((A) => A.deleteMap('board-2')));
  await go({ name: 'board', boardId: 'board-1' });
  ok('rétroliens mis à jour après suppression', (await page.getByTestId('map-backlinks').innerText()).includes('1 carte'));

  // ── 12. Captures en thème sombre ──
  await S(() => window.__store.getState().updateSettings({ theme: 'dark' }));
  await tick(page, 400);
  await shot(page, 'shots/portals/06-sombre.png');
  await page.locator('.react-flow__node[data-id="K"] [data-testid=reuse-badge]').click();
  await tick(page);
  await shot(page, 'shots/portals/07-sombre-aussi-dans.png');
  await page.keyboard.press('Escape');
  await page.locator('.map-portal[data-portal="mv-st1-m2"] [data-act=portal-open]').click();
  await page.waitForSelector('[data-testid=portal-back]', { timeout: 15000 });
  await tick(page, 400);
  await shot(page, 'shots/portals/08-sombre-revenir.png');
  await page.locator('[data-act=portal-link]').click();
  await tick(page);
  await shot(page, 'shots/portals/09-sombre-selecteur.png');
  await page.keyboard.press('Escape');

  const real = errors.filter((e) => !/source\.epub|ENOENT|Failed to load resource|livre introuvable|fichier/i.test(e));
  ok('aucune erreur navigateur', real.length === 0, real.join('\n'));
  console.log(`\n${passed} vérifications réussies`);
});
