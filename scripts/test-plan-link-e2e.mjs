// Lien plan ↔ écrit, de bout en bout (vrai éditeur) : créer l'écrit depuis le plan, mots par
// partie, statuts (pastille, touches, tableau), fiches déplacées → sections rangées à l'ouverture,
// partie renommée / ajoutée dans le plan → l'écrit suit, titres changés dans l'écrit → le plan suit,
// navigation (Écrire cette partie, ⌘⌥P, bouton Plan), plan créé depuis les titres, rattacher.
// Lancer : timeout 400 node scripts/test-plan-link-e2e.mjs   (SHOTS=1 : captures dans shots/plan-link/)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withApp } from './harness.mjs';

const PORT = 5241;
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};
const SHOTS = process.env.SHOTS === '1';
if (SHOTS) fs.mkdirSync('shots/plan-link', { recursive: true });
const snap = async (page, name) => SHOTS && page.screenshot({ path: `shots/plan-link/${name}.png` });

const st = (page) => page.evaluate(() => {
  const s = window.__store.getState();
  return { route: s.route, plans: s.plans, drafts: s.drafts };
});
const plan0 = async (page) => (await st(page)).plans.find((p) => p.id === 'pl1');
const waitEditor = async (page) => {
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
};
const heads = (page) => page.evaluate(() => window.__ed.engine().outline().map((o) => `${o.level}:${o.text}`));
const tick = (page, ms = 300) => page.waitForTimeout(ms);

await withApp(PORT, async (page, errors) => {
  await page.evaluate(() => {
    const n = (id, title, note = '', children = []) => ({ id, title, note, items: [], children });
    window.__store.setState({
      plans: [
        {
          id: 'pl1',
          title: 'Le temps libre est-il une liberté ?',
          sujet: 'Le temps libre est-il une liberté ?',
          definitions: 'Temps libre : temps soustrait au travail.',
          problematique: 'Le temps libre nous appartient-il vraiment ?',
          parts: [
            n('a', 'Le loisir conquis', 'Une limite posée au travail.', [n('a1', 'La journée de huit heures'), n('a2', 'Le dimanche', 'Un temps choisi pour soi')]),
            n('b', 'Le loisir occupé', '', [n('b1', 'L’industrie du divertissement')]),
          ],
          conclusion: 'Le temps libre se conquiert deux fois.',
          draftId: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    window.__store.getState().navigate({ name: 'plans', planId: 'pl1' });
  });
  await page.waitForSelector('[data-testid="plan-send"]');

  // ── 1. Créer l'écrit depuis le plan : il reste rattaché ──
  await page.click('[data-testid="plan-send"]');
  await page.waitForFunction(() => window.__store.getState().plans[0].draftId);
  let p = await plan0(page);
  ok('écrit créé et rattaché au plan', !!p.draftId);
  await page.waitForSelector('[data-testid="plan-open-draft"]');
  ok('« Ouvrir l’écrit » remplace « Créer l’écrit »', (await page.locator('[data-testid="plan-send"]').count()) === 0);
  ok('ligne « Lié à l’écrit »', (await page.locator('[data-testid="plan-linked"]').count()) === 1);

  await page.click('[data-testid="plan-open-draft"]');
  await waitEditor(page);
  await page.waitForFunction(() => (window.__store.getState().drafts[0].outline ?? []).length >= 7, null, { timeout: 8000 });
  let s = await st(page);
  ok('titres de l’écrit relevés (draft.outline)', s.drafts[0].outline.map((h) => h.text).join('|').includes('B. Le dimanche'), JSON.stringify(s.drafts[0].outline));
  const dim = s.drafts[0].outline.find((h) => h.text === 'B. Le dimanche');
  ok('mots propres à une section', dim.words === 5, String(dim.words));
  await page.waitForSelector('.ed-ol-st');
  ok('panneau Plan de l’écrit : statut de chaque partie', (await page.locator('.ed-ol-st').count()) >= 7);
  ok('panneau Plan de l’écrit : mots par partie', (await page.locator('.ed-ol-words').count()) >= 7);
  ok('bouton « Plan » dans la barre de l’écrit', (await page.locator('[data-testid="ed-open-plan"]').count()) === 1);
  await snap(page, '01-ecrit-plan-lie');

  // ── 2. Bouton Plan → plan, mots par partie ──
  await page.click('[data-testid="ed-open-plan"]');
  await page.waitForSelector('.plan-node');
  ok('le bouton Plan ouvre le plan rattaché', (await st(page)).route.planId === 'pl1');
  const metaA2 = await page.locator('.plan-node[data-nid="a2"] .st-meter-n').first().innerText();
  ok('mots écrits affichés sur la partie', /5/.test(metaA2), metaA2);
  ok('barre d’avancement', (await page.locator('[data-testid="plan-progress"]').count()) === 1);

  // ── 3. Statut : pastille, objectif ──
  await page.locator('.plan-node[data-nid="a"] > .plan-node-head .st-pill').click();
  await page.locator('.st-menu').getByRole('menuitemradio', { name: /À relire/ }).click();
  ok('pastille : statut « À relire »', (await plan0(page)).parts[0].status === 'review');
  await page.locator('.plan-node[data-nid="a2"] > .plan-node-head .st-pill').click();
  await page.fill('.st-menu .st-goal input', '1200');
  await page.keyboard.press('Enter');
  await tick(page);
  ok('objectif de mots d’une partie', (await plan0(page)).parts[0].children[1].goal === 1200);
  ok('jauge mots / objectif', /5 \/ 1\s?200/.test(await page.locator('.plan-node[data-nid="a2"] .st-meter-n').first().innerText()));
  await snap(page, '02-plan-statuts');

  // ── 4. Fiches : touches 1-4, glisser = nouvel ordre (l'écrit suivra) ──
  await page.click('[data-testid="plan-view-fiches"]');
  await page.waitForSelector('[data-testid="plan-fiches"]');
  ok('vue Fiches : une fiche par sous-partie, intro et conclusion', (await page.locator('[data-testid="pv-card"]').count()) === 5);
  await page.locator('[data-testid="pv-card"][data-key="a1"]').focus();
  await page.keyboard.press('4');
  ok('touche 4 sur une fiche : « Terminé »', (await plan0(page)).parts[0].children[0].status === 'done');
  const src = page.locator('[data-testid="pv-card"][data-key="a2"]');
  const dst = page.locator('[data-testid="pv-card"][data-key="a1"]');
  const db = await dst.boundingBox();
  await src.dragTo(dst, { targetPosition: { x: 8, y: db.height / 2 } });
  await tick(page, 400);
  p = await plan0(page);
  ok('fiche glissée : nouvel ordre du plan', p.parts[0].children.map((c) => c.id).join() === 'a2,a1', p.parts[0].children.map((c) => c.id).join());
  ok('… l’écrit suivra (pendingOrder)', p.pendingOrder === true);
  ok('message « l’écrit suivra »', /prochaine ouverture/.test(await page.locator('[data-testid="plan-linked"]').innerText()));
  await snap(page, '03-fiches');

  // ── 5. Tableau : glisser vers une colonne = statut ──
  await page.click('[data-testid="plan-view-tableau"]');
  await page.waitForSelector('[data-testid="plan-tableau"]');
  const card = page.locator('[data-testid="plan-tableau"] [data-testid="pv-card"][data-key="b1"]');
  const col = page.locator('.pv-col[data-status="review"]');
  await card.dragTo(col);
  await tick(page, 400);
  ok('tableau : fiche glissée dans « À relire »', (await plan0(page)).parts[1].children[0].status === 'review');
  ok('tableau : l’ordre du plan ne bouge pas', (await plan0(page)).parts[1].children[0].id === 'b1');
  await snap(page, '04-tableau');

  // ── 6. Renommer et ajouter dans le plan ──
  await page.click('[data-testid="plan-view-plan"]');
  await page.waitForSelector('.plan-node[data-nid="b"]');
  await page.locator('.plan-node[data-nid="b"] > .plan-node-head .plan-node-title').first().fill('Le loisir capturé');
  await tick(page);
  p = await plan0(page);
  ok('partie renommée dans le plan : renommage en attente pour l’écrit', p.pendingRenames?.b === 'II. Le loisir occupé', JSON.stringify(p.pendingRenames));
  await page.locator('.plan-node[data-nid="b"] > .plan-node-foot [data-testid="add-sub"]').first().click();
  await page.keyboard.type('Le temps en miettes');
  await tick(page);
  const newId = (await plan0(page)).parts[1].children[1].id;
  await page.waitForSelector(`.plan-node[data-nid="${newId}"] .plan-missing`);
  ok('nouvelle sous-partie : « pas encore dans l’écrit »', true);

  // ── 7. Ouvrir l'écrit : ordre et renommage appliqués, une étape d'annulation ──
  await page.click('[data-testid="plan-open-draft"]');
  await waitEditor(page);
  await tick(page, 600);
  let h = await heads(page);
  const iA2 = h.indexOf('3:B. Le dimanche');
  const iA1 = h.indexOf('3:A. La journée de huit heures');
  ok('sections rangées comme le plan', iA2 >= 0 && iA1 > iA2, h.join(' | '));
  ok('titre renommé comme dans le plan (numérotation gardée)', h.includes('2:II. Le loisir capturé'), h.join(' | '));
  p = await plan0(page);
  ok('drapeaux effacés après application', !p.pendingOrder && !p.pendingRenames);
  ok('texte de la section déplacé avec son titre', await page.evaluate(() => {
    const t = window.__ed.engine().plainText();
    return t.indexOf('Un temps choisi pour soi') > t.indexOf('B. Le dimanche') && t.indexOf('Un temps choisi pour soi') < t.indexOf('A. La journée');
  }));
  // une seule étape d'annulation pour tout le rangement
  await page.evaluate(() => window.__ed.engine().undo());
  await tick(page, 200);
  h = await heads(page);
  ok('⌘Z : le rangement est défait d’un coup', h.indexOf('3:A. La journée de huit heures') < h.indexOf('3:B. Le dimanche'), h.join(' | '));
  await page.evaluate(() => window.__ed.engine().redo());
  await tick(page, 200);
  h = await heads(page);
  ok('⌘⇧Z : rangement rétabli', h.indexOf('3:B. Le dimanche') < h.indexOf('3:A. La journée de huit heures'));
  await tick(page, 1200);
  p = await plan0(page);
  ok('le plan garde son ordre et son titre après le relevé suivant', p.parts[0].children[0].id === 'a2' && p.parts[1].title === 'Le loisir capturé', JSON.stringify(p.parts.map((x) => [x.title, x.children.map((c) => c.title)])));

  // ── 8. « Ajouter dans l'écrit » : le titre est créé au bon endroit ──
  await page.click('[data-testid="ed-open-plan"]');
  await page.waitForSelector(`.plan-node[data-nid="${newId}"] [data-testid="plan-write"]`);
  await page.locator(`.plan-node[data-nid="${newId}"] [data-testid="plan-write"]`).first().click();
  await waitEditor(page);
  await page.waitForFunction(() => window.__ed.engine().outline().some((o) => o.text === 'B. Le temps en miettes'), null, { timeout: 8000 });
  h = await heads(page);
  ok('titre créé après la sous-partie précédente, au niveau des sous-parties', h.indexOf('3:B. Le temps en miettes') === h.indexOf("3:A. L’industrie du divertissement") + 1, h.join(' | '));
  ok('la route ne garde pas l’insertion (pas de doublon)', !(await st(page)).route.insert);
  await tick(page, 1300);
  p = await plan0(page);
  ok('la sous-partie est désormais retrouvée dans l’écrit', p.parts[1].children.length === 2 && p.parts[1].children[1].id === newId);

  // ── 9. L'écrit change : le plan suit ──
  await page.evaluate(async () => {
    const e = window.__ed.engine();
    const norm = (t) => t.replace(/^\S+\.\s+/, '').toLowerCase();
    e.renameHeading('A. La journée de huit heures', 'B. La journée de travail', norm);
    await e.insertHeading(2, 'III. Le loisir retrouvé', 'II. Le loisir capturé', 'Conclusion', norm);
  });
  await page.evaluate(() => window.__ed && document.querySelector('.ProseMirror')?.dispatchEvent(new Event('input')));
  await page.waitForFunction(() => window.__store.getState().plans[0].parts.length === 3, null, { timeout: 8000 });
  p = await plan0(page);
  ok('titre ajouté dans l’écrit → nouvelle partie du plan', p.parts[2].title === 'Le loisir retrouvé');
  ok('titre renommé dans l’écrit → partie renommée dans le plan', p.parts[0].children[1].title === 'La journée de travail' && p.parts[0].children[1].id === 'a1');
  ok('statut gardé', p.parts[0].children[1].status === 'done');

  // ── 10. ⌘⌥P et « Écrire cette partie » ──
  await page.evaluate(() => window.__h?.select?.('Le dimanche'));
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+KeyP' : 'Control+Alt+KeyP');
  await page.waitForFunction(() => window.__store.getState().route.name === 'plans');
  ok('⌘⌥P : de l’écrit au plan', (await st(page)).route.planId === 'pl1');
  await page.waitForSelector('.plan-node[data-nid="b"] > .plan-node-meta [data-testid="plan-write"]');
  await page.locator('.plan-node[data-nid="b"] > .plan-node-meta [data-testid="plan-write"]').first().click();
  await waitEditor(page);
  ok('« Écrire cette partie » : écrit ouvert à ce titre', (await st(page)).route.at === 'II. Le loisir capturé');
  const caretOk = await page.evaluate(() => {
    const e = window.__ed.engine();
    const o = e.outline().find((x) => x.text === 'II. Le loisir capturé');
    return Math.abs(e.state().pos - o.pos) < 6;
  });
  ok('… curseur sur le titre de la partie', caretOk);

  // ── 11. Écrit sans plan : « Créer le plan depuis les titres » ──
  const d2 = await page.evaluate(async () => {
    const api = await import('/src/features/editor/api.ts');
    const d = await api.createDraft({ title: 'Brouillon libre', html: '<h1>Brouillon libre</h1><h2>Première idée</h2><p>Un deux trois.</p><h3>Un détail</h3><p>Quatre.</p><h2>Seconde idée</h2><p>Cinq six.</p>' });
    window.__store.getState().navigate({ name: 'write', draftId: d.id });
    return d.id;
  });
  await waitEditor(page);
  await page.waitForFunction((id) => (window.__store.getState().drafts.find((d) => d.id === id)?.outline ?? []).length === 4, d2, { timeout: 8000 });
  await page.click('[data-testid="ed-plan-menu"]');
  await page.click('[data-testid="ed-plan-from-headings"]');
  s = await st(page);
  const p2 = s.plans.find((x) => x.draftId === d2);
  ok('plan créé depuis les titres de l’écrit', p2 && p2.parts.map((x) => x.title).join() === 'Première idée,Seconde idée' && p2.parts[0].children[0].title === 'Un détail', JSON.stringify(p2?.parts));
  await page.waitForSelector('[data-testid="ed-open-plan"]');
  ok('le bouton devient « Plan » (ouvrir)', true);

  // ── 12. Rattacher un plan existant à un écrit ──
  await page.evaluate(() => {
    window.__store.setState({ plans: [...window.__store.getState().plans, { id: 'pl3', title: 'Autre plan', sujet: 'Autre plan', definitions: '', problematique: '', parts: [{ id: 'x', title: 'Seconde idée', note: '', items: [], children: [] }], conclusion: '', draftId: null, createdAt: 3, updatedAt: 3 }] });
    window.__store.getState().patch('plans', window.__store.getState().plans.find((p) => p.title === 'Brouillon libre').id, { draftId: null });
    window.__store.getState().navigate({ name: 'plans', planId: 'pl3' });
  });
  await page.click('[data-testid="plan-attach"]');
  await page.locator('.plan-attach-menu button', { hasText: 'Brouillon libre' }).click();
  await tick(page);
  const p3 = (await st(page)).plans.find((x) => x.id === 'pl3');
  ok('plan rattaché : il suit les titres de l’écrit (partie retrouvée, autres ajoutées)', p3.draftId === d2 && p3.parts.map((x) => x.title).join() === 'Première idée,Seconde idée' && p3.parts[1].id === 'x', JSON.stringify(p3.parts.map((x) => x.title)));

  // ── 13. Listes : étiquettes du lien ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'write', draftId: null }));
  await page.waitForSelector('[data-testid="draft-plan-tag"]');
  ok('liste des écrits : étiquette « Plan »', (await page.locator('[data-testid="draft-plan-tag"]').count()) === 2);
  await page.evaluate(() => window.__store.getState().navigate({ name: 'plans', planId: null }));
  await page.waitForSelector('[data-testid="plan-draft-tag"]');
  ok('liste des plans : « Lié à … »', (await page.locator('[data-testid="plan-draft-tag"]').count()) === 2);

  const bad = errors.filter((e) => !/favicon|ResizeObserver|Download the React DevTools/.test(e));
  ok('aucune erreur dans la page', bad.length === 0, bad.join('\n'));
}, { dark: true });

console.log(`\n${passed} vérifications passées.`);
