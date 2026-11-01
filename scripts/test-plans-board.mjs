// Plans en mode Skeuomorphisme : tableau de liège, punaises et fil rouge. Port 5231.
// Lancer : timeout 170 node scripts/test-plans-board.mjs
import assert from 'node:assert/strict';
import { withApp, importFixture, shot } from './harness.mjs';

const PORT = 5231;
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};

async function run(dark) {
  const tag = dark ? 'sombre' : 'clair';
  await withApp(
    PORT,
    async (page, errors) => {
      await page.waitForFunction(() => window.__store && window.__store.getState().ready);
      const bookId = await importFixture(page, 'fixtures/discours.md', { open: false });
      await page.evaluate((bookId) => {
        const mk = (id, category, text, start) => ({
          id, bookId, category, text, note: '', noteKind: null, conceptIds: [],
          anchor: { kind: 'html', chapter: 3, start, end: start + text.length, prefix: '', suffix: '' },
          locationLabel: 'Quatrième partie', printedPage: '61', createdAt: 1000 + start, updatedAt: 1000 + start,
        });
        window.__store.setState({
          highlights: [
            mk('h2', 'these', 'je pense, donc je suis, était si ferme et si assurée', 200),
            mk('h3', 'argument', 'Les sens nous trompent quelquefois', 90),
          ],
          plans: [],
        });
        window.__store.getState().updateSettings({ appStyle: 'skeuo' });
        window.__store.getState().navigate({ name: 'plans', planId: null });
      }, bookId);
      await page.getByRole('button', { name: 'Nouveau plan' }).first().click();
      await page.waitForSelector('.plan-sujet');
      await page.fill('.plan-sujet', 'La liberté est-elle une illusion ?');
      await page.fill('#plan-def', 'Liberté : pouvoir d’agir sans contrainte.\nIllusion : apparence trompeuse.');
      await page.fill('#plan-prob', 'Peut-on se croire libre sans l’être ?');
      await page.getByTestId('add-part').first().click();
      await page.locator('.plan-node-title').first().fill('La liberté semble illusoire');
      await page.getByTestId('add-part').last().click();
      await page.waitForFunction(() => window.__store.getState().plans[0].parts.length === 2);
      await page.locator('.plan-node-title').nth(1).fill('Mais elle se construit');
      await page.locator('.plan-node-note').nth(0).fill('Nos actes sont déterminés.');
      await page.locator('[data-testid="add-sub"]').first().click();
      await page.locator('.plan-node.depth-1 .plan-node-title').first().fill('Le déterminisme');
      const pl = await page.evaluate(() => window.__store.getState().plans[0]);
      await page.locator('[data-rid="h3"]').dragTo(page.locator('[data-nid="' + pl.parts[0].children[0].id + '"]'));
      await page.locator('[data-rid="h2"]').dragTo(page.locator('[data-nid="' + pl.parts[1].id + '"]'));
      await page.fill('#plan-concl', 'La liberté se conquiert plus qu’elle ne se possède.');

      const after = await page.evaluate(() => window.__store.getState().plans[0]);
      ok(`[${tag}] édition intacte (titres, sous-partie, extraits)`,
        after.parts[0].title === 'La liberté semble illusoire' && after.parts[0].children[0].items.length === 1 && after.parts[1].items.length === 1);

      await page.waitForSelector('[data-testid="plan-string"]');
      const pins = await page.locator('.plan-pin').count();
      // sujet + 3 champs + 2 parties
      ok(`[${tag}] une punaise par élément épinglé`, pins === 6, `(${pins})`);
      const geo = await page.evaluate(() => {
        const svg = document.querySelector('.plan-string');
        const s = getComputedStyle(svg);
        const sc = getComputedStyle(document.querySelector('.plan-editor-view .plan-scroll'));
        return { pe: s.pointerEvents, path: svg.querySelector('.plan-string-line').getAttribute('d'), border: sc.borderTopWidth };
      });
      ok(`[${tag}] fil rouge relie les punaises`, (geo.path.match(/Q/g) || []).length === 5);
      ok(`[${tag}] le fil ne capte pas les clics`, geo.pe === 'none');
      ok(`[${tag}] cadre en bois autour du liège`, geo.border === '14px');

      // Le fil suit la page : une partie de plus, une punaise de plus.
      await page.getByTestId('add-part').last().click();
      await page.waitForFunction(() => document.querySelectorAll('.plan-pin').length === 7);
      ok(`[${tag}] le fil suit l’ajout d’une partie`, true);
      const third = await page.evaluate(() => window.__store.getState().plans[0].parts[2].id);
      await page.locator(`[data-nid="${third}"] > .plan-node-head [aria-label="Supprimer"]`).click().catch(() => {});

      await page.evaluate(() => document.querySelector('.plan-scroll').scrollTo(0, 0));
      await page.waitForTimeout(250);
      await shot(page, `shots/plans-board/01-haut-${tag}.png`);
      await page.evaluate(() => document.querySelector('.plan-scroll').scrollTo(0, 99999));
      await page.waitForTimeout(250);
      await shot(page, `shots/plans-board/02-bas-${tag}.png`);

      // Retour au style normal : plus de fil ni de liège.
      await page.evaluate(() => window.__store.getState().updateSettings({ appStyle: 'normal' }));
      await page.waitForFunction(() => !document.querySelector('.plan-string'));
      const border = await page.evaluate(() => getComputedStyle(document.querySelector('.plan-scroll')).borderTopWidth);
      ok(`[${tag}] style normal : pas de liège ni de fil`, border === '0px');

      const rem = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
      ok(`[${tag}] aucune erreur navigateur`, rem.length === 0, rem.join('\n'));
    },
    { dark },
  );
}

await run(false);
await run(true);
console.log(`\n${passed} vérifications passées`);
