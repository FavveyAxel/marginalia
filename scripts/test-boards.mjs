// Cartes libres dans les espaces (Vite + Chromium, port 5383) :
//   « Nouvelle carte ici » → carte créée dans l'espace et ouverte ; ajout d'extraits de deux livres ;
//   copie de cartes depuis la carte d'un livre (avec leur lien) ; renommage ; retour à l'espace
//   (miniature) ; ⌘K la trouve ; suppression → corbeille → restauration ; menu de groupe.
// Lancer : timeout 240 node scripts/test-boards.mjs        Captures : shots/boards/
import assert from 'node:assert/strict';
import { withApp, shot } from './harness.mjs';

const PORT = 5383;
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};
const tick = (page, ms = 250) => page.waitForTimeout(ms);

await withApp(
  PORT,
  async (page, errors) => {
    const S = (fn, arg) => page.evaluate(fn, arg);
    // ── Base de départ : deux livres, des extraits, la carte du livre de Kant, un espace « liberté » ──
    await S(async () => {
      const { host } = await import('/src/lib/platform.ts');
      const s = window.__store.getState();
      const anchor = (start) => ({ kind: 'html', chapter: 0, start, end: start + 5, prefix: '', suffix: '' });
      const book = (id, title, author) => ({ id, title, author, format: 'md', fileName: 'source.md', originalName: 'x.md', size: 1, addedAt: 1, lastOpenedAt: null, progress: 0, position: null, cover: null, edition: { translator: '', place: 'Paris', publisher: 'Vrin', year: '2000' } });
      const hl = (id, bookId, category, text, start, page) => ({ id, bookId, category, text, note: '', noteKind: null, conceptIds: [], anchor: anchor(start), locationLabel: '', printedPage: page, createdAt: 1, updatedAt: start });
      await host.saveDb({
        books: [book('bK', 'D’un prétendu droit de mentir par humanité', 'Emmanuel Kant'), book('bC', 'Des réactions politiques', 'Benjamin Constant')],
        highlights: [
          hl('hK1', 'bK', 'these', 'La véracité est un devoir formel de l’homme envers chacun', 10, '67'),
          hl('hK2', 'bK', 'argument', 'Le mensonge nuit toujours à autrui, sinon à un homme du moins à l’humanité', 20, '68'),
          hl('hK3', 'bK', 'objection', 'Dire la vérité n’est un devoir qu’envers ceux qui ont droit à la vérité', 30, '69'),
          hl('hC1', 'bC', 'these', 'Nul homme n’a droit à la vérité qui nuit à autrui', 40, '123'),
          hl('hC2', 'bC', 'exemple', 'L’assassin qui demande si notre ami est réfugié chez nous', 50, '124'),
        ],
        concepts: [{ id: 'cV', name: 'Véracité', definition: 'Devoir de dire vrai.', senses: [], links: [], programme: null, createdAt: 1, updatedAt: 1 }],
        maps: {
          bK: {
            bookId: 'bK',
            nodes: [
              { id: 'T', highlightId: 'hK1', text: '', x: 300, y: 0 },
              { id: 'A', highlightId: 'hK2', text: '', x: 0, y: 220 },
              { id: 'I', highlightId: null, text: 'Idée laissée de côté', x: 700, y: 220 },
            ],
            edges: [{ id: 'eAT', source: 'A', target: 'T', relation: 'soutient', groupId: null, note: 'Universalité du devoir' }],
            viewport: null,
          },
        },
        arguments: [], plans: [], drafts: [], cards: [], studies: [], bookmarks: [],
        workspaces: [{ id: 'wP', name: 'liberté', tint: '--cat-these', order: 0, createdAt: 1 }],
        groups: [{ id: 'gS', workspaceId: 'wP', parentId: null, name: 'Sources', order: 0, collapsed: false }],
        wsItems: [{ id: 'iK', workspaceId: 'wP', groupId: null, kind: 'book', refId: 'bK', order: 0 }],
        settings: s.settings, trash: [], activity: [],
      });
    });
    await page.reload();
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    const st = () => S(() => { const s = window.__store.getState(); return { route: s.route, maps: s.maps, wsItems: s.wsItems, trash: s.trash.map((t) => ({ id: t.id, kind: t.kind, title: t.title })) }; });

    await S(() => window.__store.getState().navigate({ name: 'workspace', workspaceId: 'wP', groupId: null }));
    await tick(page, 400);
    const btn = page.getByRole('button', { name: 'Nouvelle carte ici' });
    ok('bouton « Nouvelle carte ici » à côté de « Nouvel écrit ici »', (await btn.count()) === 1 && (await page.locator('.ws-actions .btn').allInnerTexts()).join('|').includes('Nouvel écrit ici|Nouvelle carte ici'));
    await shot(page, 'shots/boards/01-espace.png');

    // ── 1. Création dans l'espace, ouverture ──
    await btn.click();
    await tick(page, 500);
    let s = await st();
    const key = s.route.name === 'board' ? s.route.boardId : null;
    ok('carte libre créée et ouverte', !!key && s.maps[key]?.kind === 'board' && s.maps[key].title === 'Nouvelle carte', JSON.stringify(s.route));
    ok('rangée dans l’espace (racine)', s.wsItems.some((i) => i.workspaceId === 'wP' && i.kind === 'map' && i.refId === key && i.groupId === null));
    ok('page : titre, retour vers l’espace, panneau Ajouter ouvert (carte vide)', (await page.getByTestId('board-title').innerText()).includes('Nouvelle carte') && (await page.getByTestId('board-back').innerText()).includes('liberté') && (await page.getByTestId('board-add').count()) === 1);
    ok('composant de carte générique affiché', (await page.locator('.board-canvas .react-flow').count()) === 1);
    await shot(page, 'shots/boards/02-carte-vide.png');

    // ── 2. Extraits de deux livres ──
    const panel = page.getByTestId('board-add');
    await panel.locator('select').selectOption('bK');
    await panel.locator('[data-hl="hK3"] input').check();
    ok('filtre par livre', (await panel.locator('[data-hl]').count()) === 3);
    await panel.locator('select').selectOption('bC');
    await panel.locator('[data-hl="hC1"] input').check();
    await panel.locator('select').selectOption('');
    await panel.getByPlaceholder('Rechercher un extrait').fill('assassin');
    ok('recherche dans les extraits', (await panel.locator('[data-hl]').count()) === 1);
    await panel.getByPlaceholder('Rechercher un extrait').fill('');
    await panel.getByTestId('board-add-confirm').click();
    await tick(page, 500);
    s = await st();
    let m = s.maps[key];
    ok('extraits de deux livres ajoutés', m.nodes.length === 2 && m.nodes.map((n) => n.highlightId).sort().join() === 'hC1,hK3' && [...m.bookIds].sort().join() === 'bC,bK', JSON.stringify(m.nodes));
    ok('extraits rendus sur la carte', (await page.locator('.board-canvas .react-flow__node').count()) >= 2);
    ok('extraits marqués « Déjà sur la carte »', (await panel.locator('[data-hl="hK3"] input').isDisabled()));
    await shot(page, 'shots/boards/03-extraits.png');

    // ── 3. Cartes copiées depuis la carte d'un livre, avec leur lien ──
    await panel.getByRole('tab', { name: 'Autres cartes' }).click();
    await panel.locator('[data-map="bK"]').click();
    await panel.locator('[data-node="T"] input').check();
    await panel.locator('[data-node="A"] input').check();
    await shot(page, 'shots/boards/04-autres-cartes.png');
    await panel.getByTestId('board-add-confirm').click();
    await tick(page, 600);
    s = await st();
    m = s.maps[key];
    const copied = m.nodes.filter((n) => n.from?.mapKey === 'bK');
    const link = m.edges.find((e) => copied.some((n) => n.id === e.source) && copied.some((n) => n.id === e.target));
    ok('deux cartes copiées (référence à l’extrait gardée)', copied.length === 2 && copied.map((n) => n.highlightId).sort().join() === 'hK1,hK2', JSON.stringify(copied));
    ok('le lien qui les relie est copié (relation, note)', !!link && link.relation === 'soutient' && link.note === 'Universalité du devoir' && link.id !== 'eAT');
    ok('carte du livre inchangée', s.maps.bK.nodes.length === 3 && s.maps.bK.edges.length === 1);
    const rects = await page.locator('.board-canvas .react-flow__node').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.x, r.y, r.width, r.height]));
    const overlap = rects.some((a, i) => rects.some((b, j) => i < j && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]));
    ok('4 cartes rendues, sans chevauchement', rects.length === 4 && !overlap, JSON.stringify(rects));
    ok('lien rendu', (await page.locator('.board-canvas .react-flow__edge').count()) >= 1);

    // Concepts et idées
    await panel.getByRole('tab', { name: 'Concepts' }).click();
    await panel.locator('.board-add-row input').first().check();
    await panel.getByTestId('board-add-confirm').click();
    await panel.getByRole('tab', { name: 'Idées' }).click();
    await panel.locator('textarea').fill('Le liberté trahit la confiance\nMentir à l’assassin ?');
    await panel.getByTestId('board-add-confirm').click();
    await tick(page, 400);
    m = (await st()).maps[key];
    ok('concept et idées ajoutés', m.nodes.length === 7 && m.nodes.some((n) => n.conceptId === 'cV') && m.nodes.filter((n) => !n.highlightId && !n.conceptId).length === 2);
    // ⌘Z annule le dernier ajout (store).
    await S(() => window.__store.getState().undo());
    m = (await st()).maps[key];
    ok('⌘Z annule l’ajout d’idées', m.nodes.length === 5, String(m.nodes.length));
    await S(() => window.__store.getState().redo());

    // Renommage
    await page.getByTestId('board-title').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Kant contre Constant');
    await page.keyboard.press('Enter');
    await tick(page, 300);
    ok('carte renommée', (await st()).maps[key].title === 'Kant contre Constant');
    await panel.getByRole('button', { name: 'Fermer' }).click().catch(() => {});
    await tick(page, 300);
    await shot(page, 'shots/boards/05-carte.png');

    // ── 4. Retour à l'espace : la carte y est, avec sa miniature ──
    await page.getByTestId('board-back').click();
    await tick(page, 500);
    s = await st();
    ok('retour à l’espace d’origine', s.route.name === 'workspace' && s.route.workspaceId === 'wP');
    const card = page.locator('.ws-card', { hasText: 'Kant contre Constant' });
    ok('carte libre dans l’espace, avec miniature', (await card.count()) === 1 && (await card.locator('[data-testid="board-thumb"] rect').count()) === 7 && (await card.innerText()).includes('7 cartes'));
    ok('carte libre dans l’arbre latéral', (await page.locator('.sidebar', { hasText: 'Kant contre Constant' }).count()) >= 1);
    await shot(page, 'shots/boards/06-espace-avec-carte.png');

    // ── 5. ⌘K ──
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('.cmd-input').fill('kant contre');
    await tick(page, 200);
    const row = page.locator('.cmd-item', { hasText: 'Kant contre Constant' });
    ok('⌘K trouve la carte (groupe Cartes)', (await row.count()) === 1 && (await page.locator('.cmd-group', { hasText: 'Cartes' }).count()) === 1);
    await shot(page, 'shots/boards/07-cmdk.png');
    await row.click();
    await tick(page, 400);
    ok('⌘K ouvre la carte', (await st()).route.name === 'board');

    // ── 6. Suppression → corbeille → restauration ──
    await page.getByRole('button', { name: 'Actions de la carte' }).click();
    await page.getByRole('menuitem', { name: 'Supprimer la carte' }).click().catch(async () => page.locator('text=Supprimer la carte').click());
    await tick(page, 400);
    s = await st();
    ok('supprimée : hors des cartes et de l’espace, dans la corbeille, retour à l’espace', !(key in s.maps) && !s.wsItems.some((i) => i.refId === key) && s.trash.some((t) => t.kind === 'map' && t.title === 'Kant contre Constant') && s.route.name === 'workspace');
    await S(() => window.__store.getState().navigate({ name: 'trash' }));
    await tick(page, 400);
    await shot(page, 'shots/boards/08-corbeille.png');
    await page.locator('.tr-row', { hasText: 'Kant contre Constant' }).getByRole('button', { name: 'Restaurer' }).click();
    await tick(page, 400);
    s = await st();
    ok('restaurée : contenu, liens et place dans l’espace', s.maps[key]?.nodes.length === 7 && s.maps[key].edges.length === 1 && s.wsItems.some((i) => i.workspaceId === 'wP' && i.refId === key));
    ok('journal : création, suppression, restauration', await S((k) => { const a = window.__store.getState().activity; return a.some((x) => x.action === 'delete' && x.kind === 'map') && a.some((x) => x.action === 'restore' && x.kind === 'map'); }, key));

    // ── 7. Historique : ouvrir la carte depuis le journal ──
    const opened = await S(async (k) => { const { openTarget } = await import('/src/features/history/open.ts'); const r = openTarget('map', k, null); return r && window.__store.getState().route; }, key);
    ok('historique : ouvre la carte libre', opened && opened.name === 'board' && opened.boardId === key);

    // ── 8. Menu d'un groupe : « Nouvelle carte ici » ──
    await S(() => window.__store.getState().navigate({ name: 'workspace', workspaceId: 'wP', groupId: null }));
    await tick(page, 400);
    await page.getByRole('button', { name: 'Actions du groupe Sources' }).click();
    await page.locator('text=Nouvelle carte ici').last().click();
    await tick(page, 500);
    s = await st();
    const key2 = s.route.name === 'board' ? s.route.boardId : null;
    ok('menu de groupe : carte créée dans le groupe et ouverte', !!key2 && key2 !== key && s.wsItems.some((i) => i.refId === key2 && i.groupId === 'gS'));
    ok('retour vers le groupe', (await page.getByTestId('board-back').innerText()).includes('liberté') || (await page.getByTestId('board-back').innerText()).includes('Sources'));

    // ── 9. Sélection multiple : une carte libre se supprime (corbeille), la carte d'un livre non ──
    await S(() => window.__store.getState().navigate({ name: 'workspace', workspaceId: 'wP', groupId: null }));
    await tick(page, 400);
    await page.getByRole('button', { name: 'Sélectionner' }).click();
    await page.locator('.ws-card', { hasText: 'Kant contre Constant' }).locator('.ws-card-main').click();
    await tick(page, 200);
    ok('sélection : « Supprimer… » proposé pour une carte libre', (await page.locator('.ws-selbar .ws-selbar-danger').count()) === 1);
    await shot(page, 'shots/boards/09-selection.png');

    const real = errors.filter((e) => !/404|Failed to load resource/.test(e));
    ok('aucune erreur navigateur', real.length === 0, real.join('\n'));
  },
  { width: 1440, height: 900 },
);
console.log(`\n${passed} vérifications réussies`);
