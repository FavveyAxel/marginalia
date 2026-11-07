// Cartes-documents sur une carte libre : onglet « Documents » du panneau Ajouter, cartes écrit /
// livre / vidéo / image / plan affichées d'après l'original, ouverture, original supprimé, glisser
// depuis la barre latérale, pas de doublon, annulation.
// Lancer : timeout 300 node scripts/test-map-docs.mjs   (SHOTS=1 : captures dans shots/map-docs/)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withApp } from './harness.mjs';

const PORT = 5387;
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};
const tick = (page, ms = 300) => page.waitForTimeout(ms);
const SHOTS = process.env.SHOTS === '1';
if (SHOTS) fs.mkdirSync('shots/map-docs', { recursive: true });

// Petite image (PNG 2×2) pour la carte « image ».
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEIGBkZGRgYGAAeEwQBi3ZRUAAAAABJRU5ErkJggg==';

for (const theme of ['dark', 'light']) {
  await withApp(
    PORT,
    async (page, errors) => {
      const S = (fn, arg) => page.evaluate(fn, arg);
      await S(async (png) => {
        const { host } = await import('/src/lib/platform.ts');
        const s = window.__store.getState();
        const book = (id, title, author, extra = {}) => ({ id, title, author, format: 'epub', fileName: 'source.epub', originalName: 'essai.epub', size: 1, addedAt: 1, lastOpenedAt: null, progress: 0.16, position: null, cover: null, edition: { translator: '', place: '', publisher: '', year: '' }, ...extra });
        await host.saveDb({
          books: [
            book('bE', 'Essai sur le repos', 'Claire Delorme'),
            book('bV', 'Pourquoi on s’ennuie le dimanche', 'Pensée vive', { format: 'video', fileName: '', video: { provider: 'youtube', id: 'abc', url: 'https://www.youtube.com/watch?v=abc', duration: 2530, position: 754 } }),
            book('bI', 'Affiche de 1936', '', { format: 'image', fileName: 'page-1.png', cover: png }),
          ],
          highlights: [],
          concepts: [],
          maps: { board1: { kind: 'board', title: 'Le temps libre', bookIds: [], nodes: [{ id: 'I', highlightId: null, text: 'Le loisir est-il libre ?', x: 0, y: 0 }], edges: [], viewport: null } },
          arguments: [],
          plans: [{ id: 'p1', title: 'Plan du temps libre', sujet: 'Le temps libre est-il une liberté ?', definitions: '', problematique: '', parts: [{ id: 'a', title: 'Le loisir conquis', note: '', items: [], children: [], status: 'done' }, { id: 'b', title: 'Le loisir occupé', note: '', items: [], children: [] }], conclusion: '', draftId: null, createdAt: 1, updatedAt: 1 }],
          drafts: [{ id: 'd1', title: 'Le temps libre (brouillon)', fileName: 'x', externalPath: null, wordCount: 2610, template: null, createdAt: 1, updatedAt: 5, outline: [{ level: 1, text: 'Le temps libre', words: 0 }, { level: 2, text: 'I. Le loisir conquis', words: 900 }, { level: 3, text: 'A. La journée de huit heures', words: 400 }] }],
          cards: [], studies: [], bookmarks: [],
          workspaces: [{ id: 'w1', name: 'Mémoire', tint: '--cat-these', order: 0, createdAt: 1 }],
          groups: [],
          wsItems: [
            { id: 'iE', workspaceId: 'w1', groupId: null, kind: 'book', refId: 'bE', order: 0 },
            { id: 'iP', workspaceId: 'w1', groupId: null, kind: 'plan', refId: 'p1', order: 1 },
            { id: 'iM', workspaceId: 'w1', groupId: null, kind: 'map', refId: 'board1', order: 2 },
          ],
          settings: { ...s.settings, theme: undefined },
          trash: [],
          activity: [],
        });
      }, PNG);
      await page.reload();
      await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
      await S(() => window.__store.getState().navigate({ name: 'board', boardId: 'board1' }));
      await page.waitForSelector('.react-flow__node');
      const docs = () => S(() => window.__store.getState().maps.board1.nodes.filter((n) => n.doc).map((n) => `${n.doc.kind}:${n.doc.id}`));

      // ── 1. Panneau Ajouter › Documents ──
      await page.getByRole('button', { name: /Ajouter/ }).first().click();
      await page.waitForSelector('[data-testid="board-add"]');
      await page.getByRole('tab', { name: /Documents/ }).click();
      ok(`[${theme}] onglet Documents : écrits, livres, vidéos, images, plans`, (await page.locator('.board-add-doc').count()) === 5);
      await page.locator('.board-add-chips .chip', { hasText: 'Vidéos' }).click();
      ok(`[${theme}] filtre Vidéos`, (await page.locator('.board-add-doc').count()) === 1);
      await page.locator('.board-add-chips .chip', { hasText: 'Tous' }).click();
      for (const k of ['draft:d1', 'book:bE', 'book:bV', 'book:bI', 'plan:p1']) await page.locator(`.board-add-doc[data-doc="${k}"] input`).check();
      await page.click('[data-testid="board-add-confirm"]');
      await tick(page, 500);
      ok(`[${theme}] cinq cartes-documents posées`, (await docs()).length === 5, (await docs()).join());
      ok(`[${theme}] cases « Déjà sur la carte »`, (await page.locator('.board-add-doc.disabled').count()) === 5);
      await page.locator('[data-testid="board-add"] button[aria-label="Fermer"]').click();
      await S(() => document.querySelector('.react-flow__controls-fitview')?.click());
      await tick(page, 600);

      // ── 2. Affichage d'après l'original ──
      const card = (k) => page.locator(`[data-testid="doc-node"][data-doc="${k}"]`);
      ok(`[${theme}] écrit : titre, titres de l’écrit, mots`, (await card('draft:d1').innerText()).includes('I. Le loisir conquis') && /2\s?610 mots/.test(await card('draft:d1').innerText()));
      ok(`[${theme}] livre : couverture, auteur, avancement`, (await card('book:bE').locator('.lib-cover').count()) === 1 && /Claire Delorme/.test(await card('book:bE').innerText()) && /16 % lu/.test(await card('book:bE').innerText()));
      ok(`[${theme}] vidéo : miniature, durée, où l’on en est`, (await card('book:bV').locator('[data-testid="video-thumb"]').count()) === 1 && /13 min sur 42 min/.test(await card('book:bV').innerText()));
      ok(`[${theme}] image : l’image elle-même`, (await card('book:bI').locator('img.map-doc-image').count()) === 1);
      ok(`[${theme}] plan : parties et avancement`, /2 parties · 1 sur 4 terminée/.test(await card('plan:p1').innerText()), await card('plan:p1').innerText());
      // l'original change : la carte suit
      await S(() => window.__store.getState().patch('drafts', 'd1', { title: 'Le temps libre (v2)', wordCount: 3100 }));
      await tick(page);
      ok(`[${theme}] titre et mots suivent l’original`, /Le temps libre \(v2\)/.test(await card('draft:d1').innerText()) && /3\s?100 mots/.test(await card('draft:d1').innerText()));
      if (SHOTS) {
        await S(() => window.__store.getState().updateSettings({ appStyle: 'skeuo' }));
        await S(() => { const vp = document.querySelector('.react-flow__controls-fitview'); vp?.click(); });
        await tick(page, 700);
        await page.screenshot({ path: `shots/map-docs/01-liege-${theme}.png` });
        await S(() => window.__store.getState().updateSettings({ appStyle: 'normal' }));
      }

      // ── 3. Ouvrir ──
      await card('plan:p1').locator('[data-act="doc-open"]').click();
      await page.waitForFunction(() => window.__store.getState().route.name === 'plans');
      ok(`[${theme}] « Ouvrir » : le plan`, (await S(() => window.__store.getState().route.planId)) === 'p1');
      await S(() => window.__store.getState().navigate({ name: 'board', boardId: 'board1' }));
      await page.waitForSelector('[data-testid="doc-node"]');
      await card('book:bE').dblclick();
      await page.waitForFunction(() => window.__store.getState().route.name === 'reader');
      ok(`[${theme}] double-clic : le livre`, (await S(() => window.__store.getState().route.bookId)) === 'bE');
      await S(() => window.__store.getState().navigate({ name: 'board', boardId: 'board1' }));
      await page.waitForSelector('[data-testid="doc-node"]');

      // ── 4. Original supprimé : la carte le signale ──
      await S(() => window.__store.getState().remove('drafts', 'd1'));
      await tick(page);
      ok(`[${theme}] écrit supprimé : « Document supprimé »`, (await card('draft:d1').getAttribute('class')).includes('missing') && /Document supprimé/.test(await card('draft:d1').innerText()));
      ok(`[${theme}] la carte reste sur la carte`, (await docs()).includes('draft:d1'));

      // ── 5. Glisser depuis la barre latérale (document, puis plan déjà posé, puis carte → portail) ──
      await S(() => {
        const m = window.__store.getState().maps.board1;
        window.__store.setState({ maps: { ...window.__store.getState().maps, board1: { ...m, nodes: m.nodes.filter((n) => !(n.doc && n.doc.id === 'bE')) } } });
      });
      await tick(page);
      const pane = page.locator('.react-flow__pane');
      await page.locator('.ws-row-item', { hasText: 'Essai sur le repos' }).first().dragTo(pane, { targetPosition: { x: 200, y: 200 } });
      await tick(page, 500);
      ok(`[${theme}] livre glissé depuis la barre latérale : carte-document`, (await docs()).includes('book:bE'));
      const before = (await docs()).length;
      await page.locator('.ws-row-item', { hasText: 'Plan du temps libre' }).first().dragTo(pane, { targetPosition: { x: 260, y: 260 } });
      await tick(page, 400);
      ok(`[${theme}] plan déjà posé : pas de doublon`, (await docs()).length === before);

      // ── 6. Annulation ──
      const n0 = (await docs()).length;
      await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('Meta+z');
      await tick(page, 400);
      ok(`[${theme}] ⌘Z : la dernière carte posée est retirée`, (await docs()).length === n0 - 1, (await docs()).join());

      const bad = errors.filter((e) => !/favicon|ResizeObserver|DevTools|youtube|ERR_|net::/.test(e));
      ok(`[${theme}] aucune erreur dans la page`, bad.length === 0, bad.join('\n'));
    },
    { dark: theme === 'dark' },
  );
}

console.log(`\n${passed} vérifications passées.`);
