// Lien neutre (interface) — Vite + Chromium, port 5417 :
//   tirer depuis la poignée du centre dans le vide → nouvelle carte + lien { centre → nouvelle, 'lien' }, sans flèche ;
//   tirer entre deux cartes → 'lien' dans le sens du geste ; menu : « Lien neutre » en tête ;
//   « soutient » → se lit « A soutient B » ; « Inverser le sens » ; ⌘Z une étape par choix ;
//   légende « lien (neutre) » ; clic droit sur un lien → son menu.
// Lancer : timeout 300 node scripts/test-map-lien-ui.mjs        Captures : /home/claude/marginalia/shots/carte-lien/
import assert from 'node:assert/strict';
import { withApp, importFixture, shot } from './harness.mjs';

const OUT = '/home/claude/marginalia/shots/carte-lien';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};
const wait = (page, ms = 250) => page.waitForTimeout(ms);

await withApp(5417, async (page, errors) => {
  const id = await importFixture(page, 'fixtures/discours.md');
  await page.evaluate((id) => {
    const s = window.__store.getState();
    s.setMap(id, {
      bookId: id,
      nodes: [
        { id: 'S', highlightId: null, text: 'Le liberté', x: 420, y: 140, kind: 'subject' },
        { id: 'A', highlightId: null, text: 'Mentir sous serment trahit la parole donnée', x: 160, y: 520 },
        { id: 'B', highlightId: null, text: 'Le serment engage devant les autres', x: 760, y: 520 },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    s.navigate({ name: 'reader', bookId: id, tab: 'carte', splitBookId: null });
  }, id);
  await page.waitForSelector('.react-flow__node[data-id="S"]', { timeout: 15000 });
  await wait(page, 900);
  const mapOf = () => page.evaluate((id) => window.__store.getState().getMap(id), id);
  const box = (nid) => page.locator(`.react-flow__node[data-id="${nid}"]`).boundingBox();

  await page.evaluate(() => window.__store.setState({ toasts: [] }));
  // ═══ 1. Tirer depuis le centre dans le vide ═══
  await page.locator('.react-flow__node[data-id="S"]').hover();
  await wait(page, 200);
  const h = await page.locator('.react-flow__node[data-id="S"] .map-h-r').boundingBox();
  const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 230, from.y + 150, { steps: 16 });
  await wait(page, 120);
  ok('pendant le geste : le trait suit le curseur', (await page.locator('.react-flow__connection-path').count()) === 1);
  await shot(page, `${OUT}/01-trace.png`);
  await page.mouse.up();
  await wait(page, 500);
  let m = await mapOf();
  const fresh = m.nodes.find((n) => !['S', 'A', 'B'].includes(n.id));
  ok('une nouvelle carte idée est créée', m.nodes.length === 4 && !!fresh);
  const e1 = m.edges.find((e) => e.target === fresh.id || e.source === fresh.id);
  ok('lien { source : centre, cible : nouvelle carte, relation : lien }', e1 && e1.source === 'S' && e1.target === fresh.id && e1.relation === 'lien', JSON.stringify(m.edges));
  await page.waitForFunction(() => document.activeElement?.classList.contains('map-idea-input'));
  await wait(page, 150);
  await page.keyboard.type('Un liberté ruine la confiance');
  await page.keyboard.press('Escape');
  await wait(page, 200);
  ok('la nouvelle carte garde son texte', (await mapOf()).nodes.find((n) => n.id === fresh.id).text === 'Un liberté ruine la confiance');
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 300 } });
  await wait(page, 900);
  const g1 = page.locator(`.react-flow__edge[data-id="${e1.id}"] .map-edge`);
  ok('lien neutre : rendu sans pointe de flèche', (await g1.getAttribute('data-relation')) === 'lien' && (await page.locator(`.react-flow__edge[data-id="${e1.id}"] .map-edge-path`).getAttribute('marker-end')) === null);
  const dash = await page.locator(`.react-flow__edge[data-id="${e1.id}"] .map-edge-path`).evaluate((el) => getComputedStyle(el).strokeDasharray);
  ok('lien neutre : trait plein', dash === 'none', dash);
  const dot = await page.locator(`.map-pill[data-edge="${e1.id}"] i`).evaluate((el) => getComputedStyle(el).opacity);
  ok('lien neutre : pas de pastille au repos', dot === '0', dot);
  ok('légende : « lien (neutre) »', (await page.locator('.map-legend').innerText()).includes('lien (neutre)'));
  await shot(page, `${OUT}/02-lien-neutre.png`);

  // ═══ 2. Tirer entre deux cartes existantes ═══
  await page.locator('.react-flow__node[data-id="A"]').hover();
  await wait(page, 200);
  const ha = await page.locator('.react-flow__node[data-id="A"] .map-h-r').boundingBox();
  const bb = await box('B');
  await page.mouse.move(ha.x + ha.width / 2, ha.y + ha.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 14 });
  await page.mouse.up();
  await wait(page, 500);
  m = await mapOf();
  const e2 = m.edges.find((e) => (e.source === 'A' && e.target === 'B') || (e.source === 'B' && e.target === 'A'));
  ok('entre deux cartes : lien neutre A → B (sens du geste)', e2 && e2.source === 'A' && e2.target === 'B' && e2.relation === 'lien', JSON.stringify(m.edges));
  const menu = page.locator('[data-testid=map-edge-menu]');
  ok('le menu du lien s’ouvre', (await menu.count()) === 1);
  const first = menu.locator('.map-menu-rel').first();
  ok('menu : « Lien neutre » en tête, coché', (await first.getAttribute('data-rel')) === 'lien' && (await first.innerText()).includes('Lien neutre') && (await first.locator('svg').count()) === 1);
  ok('menu : « Inverser le sens »', (await menu.locator('[data-act=reverse]').innerText()).includes('Inverser le sens'));
  await page.mouse.move(bb.x + bb.width + 300, bb.y - 200);
  await shot(page, `${OUT}/03-menu-lien.png`);

  // ═══ 3. « soutient » : se lit « A soutient B » ═══
  await menu.locator('[data-rel=soutient]').click();
  await wait(page, 300);
  m = await mapOf();
  let e = m.edges.find((x) => x.id === e2.id);
  ok('« soutient » : sens du geste gardé', e.relation === 'soutient' && e.source === 'A' && e.target === 'B');
  let reading = (await menu.locator('[data-testid=map-edge-reading]').innerText()).replace(/\s+/g, ' ');
  ok('le menu reste ouvert et se lit « A soutient B »', /Mentir sous.*soutient.*Le serment/.test(reading), reading);
  ok('le lien porte une flèche', (await page.locator(`.react-flow__edge[data-id="${e2.id}"] .map-edge-path`).getAttribute('marker-end')) === 'url(#map-arrow-soutient-2)');
  await shot(page, `${OUT}/04-soutient.png`);

  // ═══ 4. Inverser le sens ═══
  await menu.locator('[data-act=reverse]').click();
  await wait(page, 300);
  m = await mapOf();
  e = m.edges.find((x) => x.id === e2.id);
  ok('« Inverser le sens » : B soutient A', e.source === 'B' && e.target === 'A' && e.relation === 'soutient');
  reading = (await menu.locator('[data-testid=map-edge-reading]').innerText()).replace(/\s+/g, ' ');
  ok('lecture mise à jour : « B soutient A »', /Le serment.*soutient.*Mentir sous/.test(reading), reading);
  await shot(page, `${OUT}/05-inverse.png`);

  // ═══ 5. Annuler : une étape par choix ═══
  await page.keyboard.press('Escape');
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 300 } });
  await wait(page, 200);
  await page.keyboard.press(`${MOD}+z`);
  await wait(page, 400);
  e = (await mapOf()).edges.find((x) => x.id === e2.id);
  ok('⌘Z : l’inversion est annulée seule (A soutient B)', e && e.source === 'A' && e.target === 'B' && e.relation === 'soutient', JSON.stringify(e));
  await page.keyboard.press(`${MOD}+z`);
  await wait(page, 400);
  e = (await mapOf()).edges.find((x) => x.id === e2.id);
  ok('⌘Z : puis le choix de relation (retour au lien neutre A → B)', e && e.source === 'A' && e.target === 'B' && e.relation === 'lien', JSON.stringify(e));
  await page.keyboard.press(`${MOD}+z`);
  await wait(page, 400);
  ok('⌘Z : puis la création du lien', !(await mapOf()).edges.some((x) => x.id === e2.id));
  await page.keyboard.press(`${MOD}+Shift+z`);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await wait(page, 400);

  // ═══ 6. Clic droit sur un lien : son menu, avec « Inverser le sens » ═══
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 300 } });
  const pill = await page.locator(`.map-pill[data-edge="${e2.id}"]`).boundingBox();
  await page.mouse.click(pill.x + pill.width / 2, pill.y + pill.height / 2, { button: 'right' });
  await wait(page, 300);
  ok('clic droit sur un lien : menu avec « Inverser le sens »', (await menu.count()) === 1 && (await menu.locator('[data-act=reverse]').count()) === 1);
  await menu.locator('[data-act=reverse]').click();
  await wait(page, 300);
  e = (await mapOf()).edges.find((x) => x.id === e2.id);
  ok('rétablir (⌘⇧Z ×2) puis « Inverser le sens » (menu) : B soutient A', e && e.source === 'B' && e.target === 'A' && e.relation === 'soutient', JSON.stringify(e));
  await page.keyboard.press('Escape');
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 300 } });
  await wait(page, 300);

  // ═══ 7. Légende : « lien (neutre) » seulement quand la carte en a ═══
  await page.evaluate((id) => {
    const s = window.__store.getState();
    const mm = s.getMap(id);
    s.setMap(id, { ...mm, edges: mm.edges.map((x) => ({ ...x, relation: 'soutient' })) });
  }, id);
  await wait(page, 300);
  ok('légende : pas de « lien (neutre) » sans lien neutre', !(await page.locator('.map-legend').innerText()).includes('lien (neutre)'));

  // Thème sombre : capture du lien neutre.
  await page.evaluate((id) => {
    const s = window.__store.getState();
    const mm = s.getMap(id);
    s.setMap(id, { ...mm, edges: mm.edges.map((x) => (x.source === 'S' ? { ...x, relation: 'lien' } : x)) });
    s.updateSettings({ theme: 'dark' });
  }, id);
  await wait(page, 500);
  await shot(page, `${OUT}/06-sombre.png`);
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));

  const real = errors.filter((x) => !/Failed to load resource/.test(x));
  ok('aucune erreur navigateur', real.length === 0, real.join('\n'));
});
console.log(`\n${passed} vérifications réussies`);
