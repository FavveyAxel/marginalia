// « Suivre une chaîne » (Vite + Chromium, port 5400) :
//   modèle (model/chain.ts) : appuis récursifs, objections, réponses, conséquences, cycles,
//   cartes masquées, branches indépendantes, prémisses conjointes, chaîne la plus longue,
//   point fragile, diagnostic en clair, performance sur 600 cartes ;
//   interface : L, clic droit, bouton de la barre, panneau (diagnostic, point fragile, Appuis /
//   Conséquences), recentrage au clic, sortie par Échap et clic dans le vide, estompage (classes,
//   opacité, gris), 300 cartes, aide. Captures clair et sombre : shots/map-chain/.
// Lancer : timeout 300 node scripts/test-map-chain.mjs
import assert from 'node:assert/strict';
import { withApp, shot } from './harness.mjs';

const PORT = 5400;
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};
const tick = (page, ms = 250) => page.waitForTimeout(ms);

// ── Carte de test ──
//   T (thèse) ← A (soutient) ← B (soutient), A ← C (illustre)
//   O objecte à T, R répond à O ; O2 objecte à A (sans réponse)
//   T soutient U (conséquence) ; X, Y sans lien avec T ; X soutient Y
const HL = [
  ['hT', 'these', 'L’homme est condamné à être libre', 10],
  ['hA', 'argument', 'L’existence précède l’essence', 20],
  ['hB', 'argument', 'Il n’y a pas de nature humaine, puisqu’il n’y a pas de Dieu pour la concevoir', 30],
  ['hC', 'exemple', 'Le garçon de café joue à être garçon de café', 40],
  ['hO', 'objection', 'Les déterminismes sociaux pèsent sur nos choix', 50],
  ['hO2', 'objection', 'Une essence humaine se lit dans le corps', 60],
];
const NODES = [
  ['nT', 'hT', 420, 0],
  ['nA', 'hA', 120, 260],
  ['nB', 'hB', -180, 520],
  ['nC', 'hC', 220, 560],
  ['nO', 'hO', 760, 260],
  ['nR', null, 760, 540, 'La mauvaise foi : se cacher derrière le déterminisme'],
  ['nO2', 'hO2', -220, 220],
  ['nU', null, 420, -300, 'Nous sommes responsables de tout'],
  ['nX', null, 1120, 0, 'Une idée sans rapport'],
  ['nY', null, 1120, 300, 'Une autre idée isolée'],
];
const EDGES = [
  ['eAT', 'nA', 'nT', 'soutient'],
  ['eBA', 'nB', 'nA', 'soutient'],
  ['eCA', 'nC', 'nA', 'illustre'],
  ['eOT', 'nO', 'nT', 'objecte'],
  ['eRO', 'nR', 'nO', 'repond'],
  ['eO2A', 'nO2', 'nA', 'objecte'],
  ['eTU', 'nT', 'nU', 'soutient'],
  ['eXY', 'nX', 'nY', 'soutient'],
];

async function seed(page) {
  await page.evaluate(
    async ({ HL, NODES, EDGES }) => {
      const { host } = await import('/src/lib/platform.ts');
      const s = window.__store.getState();
      const anchor = (start) => ({ kind: 'html', chapter: 0, start, end: start + 5, prefix: '', suffix: '' });
      const book = { id: 'bS', title: 'L’existentialisme est un humanisme', author: 'Jean-Paul Sartre', format: 'epub', fileName: 'source.epub', originalName: 'sartre.epub', size: 1, addedAt: 1, lastOpenedAt: null, progress: 0, position: null, cover: null, edition: { translator: '', place: 'Paris', publisher: 'Nagel', year: '1946' } };
      const highlights = HL.map(([id, category, text, start], i) => ({ id, bookId: 'bS', category, text, note: '', noteKind: null, conceptIds: [], anchor: anchor(start), locationLabel: '', printedPage: String(20 + i), createdAt: 1 + i, updatedAt: 1 + i }));
      const nodes = NODES.map(([id, hid, x, y, text]) => ({ id, highlightId: hid, text: text ?? '', x, y }));
      const edges = EDGES.map(([id, source, target, relation]) => ({ id, source, target, relation, groupId: null }));
      // Carte libre de 300 cartes (performance).
      const big = { id: 'BIG', bookId: '', kind: 'board', title: 'Grande carte', bookIds: [], nodes: [], edges: [], viewport: null };
      for (let i = 0; i < 300; i++) big.nodes.push({ id: `g${i}`, highlightId: null, text: `Idée ${i}`, x: (i % 20) * 320, y: Math.floor(i / 20) * 200 });
      for (let i = 1; i < 300; i++) big.edges.push({ id: `ge${i}`, source: `g${i}`, target: `g${Math.floor((i - 1) / 2)}`, relation: i % 7 === 0 ? 'objecte' : 'soutient', groupId: null });
      await host.saveDb({
        books: [book],
        highlights,
        concepts: [],
        maps: { bS: { bookId: 'bS', nodes, edges, viewport: null }, BIG: big },
        arguments: [], plans: [], drafts: [], cards: [], studies: [], bookmarks: [],
        workspaces: [], groups: [], wsItems: [],
        settings: s.settings, trash: [], activity: [],
      });
    },
    { HL, NODES, EDGES },
  );
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
}

async function openMap(page, theme) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);
  await page.evaluate(() => window.__store.setState({ route: { name: 'reader', bookId: 'bS', tab: 'carte', splitBookId: null } }));
  await page.waitForSelector('[data-testid=map-root] .react-flow__node');
  await tick(page, 700);
  if (await page.locator('[data-testid=map-drawer] header .icon-btn').count()) await page.locator('[data-testid=map-drawer] header .icon-btn').click();
  await page.locator('[data-act=fit]').click();
  await tick(page, 600);
}

const node = (page, id) => page.locator(`.react-flow__node[data-id="${id}"]`);
/** État visible : 'on' (net) ou 'off' (estompé) pour chaque carte et chaque lien (après la transition). */
const classes = async (page) => {
  await page.waitForTimeout(380);
  return page.evaluate(() => {
    const out = {};
    const st = (el) => (parseFloat(getComputedStyle(el).opacity) > 0.5 ? 'on' : 'off');
    for (const el of document.querySelectorAll('.react-flow__node')) out[el.dataset.id] = st(el);
    for (const el of document.querySelectorAll('.react-flow__edge')) out['edge:' + el.getAttribute('data-testid').replace('rf__edge-', '')] = st(el);
    return out;
  });
};
const has = (cls, id, c) => cls[id] === (c === 'chain-off' ? 'off' : 'on');
async function clickNode(page, id) {
  const b = await node(page, id).boundingBox();
  await page.mouse.click(b.x + 30, b.y + 14);
  await tick(page, 150);
}

await withApp(PORT, async (page, errors) => {
  // ═══ 1. Modèle ═══
  const model = await page.evaluate(async ({ NODES, EDGES }) => {
    const M = await import('/src/features/map/model/chain.ts');
    const mk = (edges, n = null) => {
      const ids = n ?? [...new Set(edges.flatMap(([, s, t]) => [s, t]))];
      return { nodes: ids.map((id) => ({ id, highlightId: null, text: id, x: 0, y: 0 })), edges: edges.map(([id, source, target, relation, groupId]) => ({ id, source, target, relation, groupId: groupId ?? null })) };
    };
    const base = { nodes: NODES.map(([id]) => ({ id, highlightId: null, text: id, x: 0, y: 0 })), edges: EDGES.map(([id, source, target, relation]) => ({ id, source, target, relation, groupId: null })) };
    const sort = (a) => [...a].sort().join(',');
    const r = {};
    const c1 = M.computeChain(base, 'nT');
    r.base = { supports: sort(c1.supports), objections: sort(c1.objections), replies: sort(c1.replies), cons: c1.consequences.length, edges: sort(c1.edges), depth: c1.depth, d: c1.diagnosis, sum: M.chainSummary(c1.diagnosis).join(' · '), roleX: c1.role.nX ?? null };
    const c1u = M.computeChain(base, 'nT', { consequences: true });
    r.up = { cons: sort(c1u.consequences), depthU: c1u.depth.nU, hasEdge: c1u.edges.includes('eTU'), sum: M.chainSummary(c1u.diagnosis, { consequences: true }).join(' · ') };
    // Cartes masquées : A masquée → plus d'appuis ; T masquée → pas de chaîne.
    const ch = M.computeChain(base, 'nT', { hidden: new Set(['nA']) });
    r.hidden = { supports: ch.supports.length, edges: sort(ch.edges), nullRoot: M.computeChain(base, 'nT', { hidden: new Set(['nT']) }) === null, missing: M.computeChain(base, 'nope') === null };
    // Trois appuis indépendants, l'un appuyé à son tour : l'exemple de l'énoncé.
    const c3 = M.computeChain(mk([['1', 'A', 'T', 'soutient'], ['2', 'B', 'T', 'precise'], ['3', 'C', 'T', 'illustre'], ['4', 'D', 'A', 'soutient'], ['5', 'O', 'T', 'objecte']]), 'T');
    r.three = { d: c3.diagnosis, sum: M.chainSummary(c3.diagnosis).join(' · ') };
    // Losange : deux appuis qui reposent tous deux sur C → C est le point fragile.
    const c4 = M.computeChain(mk([['1', 'A', 'T', 'soutient'], ['2', 'B', 'T', 'soutient'], ['3', 'C', 'A', 'soutient'], ['4', 'C', 'B', 'soutient']]), 'T');
    r.diamond = { fragile: c4.diagnosis.fragile, branches: c4.diagnosis.branches, longest: c4.diagnosis.longest };
    // Chaîne linéaire : tous fragiles, le plus proche de la thèse d'abord.
    const c5 = M.computeChain(mk([['1', 'A', 'T', 'soutient'], ['2', 'B', 'A', 'soutient'], ['3', 'C', 'B', 'soutient']]), 'T');
    r.linear = { fragile: c5.diagnosis.fragile, longest: c5.diagnosis.longest, depthC: c5.depth.C };
    // Cycles : A ⇄ B, et T soutient A qui soutient T.
    const c6 = M.computeChain(mk([['1', 'A', 'T', 'soutient'], ['2', 'B', 'A', 'soutient'], ['3', 'A', 'B', 'soutient'], ['4', 'C', 'T', 'soutient']]), 'T');
    r.cycle = { supports: sort(c6.supports), fragile: c6.diagnosis.fragile, longest: c6.diagnosis.longest, edges: sort(c6.edges) };
    const c7 = M.computeChain(mk([['1', 'A', 'T', 'soutient'], ['2', 'T', 'A', 'soutient']]), 'T', { consequences: true });
    r.selfCycle = { supports: sort(c7.supports), cons: c7.consequences.length, fragile: c7.diagnosis.fragile, longest: c7.diagnosis.longest };
    // Boucle d'appuis sans appui extérieur, rattachée à T par A.
    const c8 = M.computeChain(mk([['1', 'A', 'T', 'soutient'], ['2', 'B', 'A', 'soutient'], ['3', 'C', 'B', 'soutient'], ['4', 'B', 'C', 'soutient']]), 'T');
    r.loopBase = { fragile: c8.diagnosis.fragile };
    // Prémisses conjointes : une seule branche.
    const c9 = M.computeChain(mk([['1', 'A', 'T', 'soutient', 'g'], ['2', 'B', 'T', 'soutient', 'g']]), 'T');
    r.joint = { branches: c9.diagnosis.branches, direct: c9.diagnosis.direct, fragile: c9.diagnosis.fragile, sum: M.chainSummary(c9.diagnosis).join(' · ') };
    // Rien : aucun appui ; objections toutes répondues.
    const c10 = M.computeChain(mk([['1', 'O', 'T', 'objecte'], ['2', 'R', 'O', 'repond']]), 'T');
    r.none = M.chainSummary(c10.diagnosis).join(' · ');
    // Performance : 600 cartes, 1200 liens, avec des cycles.
    const N = 600;
    const edges = [];
    for (let i = 1; i < N; i++) edges.push([`e${i}`, `n${i}`, `n${Math.floor((i - 1) / 3)}`, i % 5 === 0 ? 'objecte' : i % 11 === 0 ? 'repond' : 'soutient']);
    for (let i = 0; i < N; i++) edges.push([`f${i}`, `n${(i * 7) % N}`, `n${(i * 13 + 5) % N}`, 'soutient']);
    const big = mk(edges);
    const t0 = performance.now();
    const cb = M.computeChain(big, 'n0', { consequences: true });
    r.perf = { ms: performance.now() - t0, supports: cb.supports.length };
    return r;
  }, { NODES, EDGES });

  ok('modèle : appuis récursifs (soutient, illustre)', model.base.supports === 'nA,nB,nC', model.base.supports);
  ok('modèle : objections contre la thèse et contre un appui', model.base.objections === 'nO,nO2', model.base.objections);
  ok('modèle : réponses aux objections', model.base.replies === 'nR');
  ok('modèle : sans conséquences par défaut, cartes étrangères hors chaîne', model.base.cons === 0 && model.base.roleX === null);
  ok('modèle : liens de la chaîne', model.base.edges === 'eAT,eBA,eCA,eO2A,eOT,eRO', model.base.edges);
  ok('modèle : profondeurs', model.base.depth.nT === 0 && model.base.depth.nA === 1 && model.base.depth.nB === 2 && model.base.depth.nO === 1 && model.base.depth.nR === 2 && model.base.depth.nO2 === 2, JSON.stringify(model.base.depth));
  ok('modèle : diagnostic (1 branche, chaîne 2, O2 sans réponse, A fragile)', model.base.d.branches === 1 && model.base.d.longest === 2 && model.base.d.unanswered.join() === 'nO2' && model.base.d.fragile.join() === 'nA', JSON.stringify(model.base.d));
  ok('modèle : diagnostic en clair', model.base.sum === '1 seul appui direct · chaîne la plus longue : 2 · 1 objection sans réponse', model.base.sum);
  ok('modèle : conséquences en remontant (profondeur négative)', model.up.cons === 'nU' && model.up.depthU === -1 && model.up.hasEdge && model.up.sum.endsWith('soutient 1 idée'), JSON.stringify(model.up));
  ok('modèle : cartes masquées ignorées', model.hidden.supports === 0 && model.hidden.edges === 'eOT,eRO' && model.hidden.nullRoot && model.hidden.missing, JSON.stringify(model.hidden));
  ok('modèle : « 3 appuis indépendants · chaîne la plus longue : 2 · 1 objection sans réponse »', model.three.sum === '3 appuis indépendants · chaîne la plus longue : 2 · 1 objection sans réponse' && model.three.d.fragile.length === 0, model.three.sum);
  ok('modèle : losange → point fragile commun', model.diamond.fragile.join() === 'C' && model.diamond.branches === 2 && model.diamond.longest === 2, JSON.stringify(model.diamond));
  ok('modèle : chaîne linéaire → fragiles du plus proche au plus lointain', model.linear.fragile.join() === 'A,B,C' && model.linear.longest === 3 && model.linear.depthC === 3, JSON.stringify(model.linear));
  ok('modèle : cycle A ⇄ B toléré', model.cycle.supports === 'A,B,C' && model.cycle.fragile.length === 0 && model.cycle.longest === 2 && model.cycle.edges === '1,2,3,4', JSON.stringify(model.cycle));
  ok('modèle : boucle avec la thèse (T soutient A qui soutient T)', model.selfCycle.supports === 'A' && model.selfCycle.cons === 0 && model.selfCycle.fragile.join() === 'A' && model.selfCycle.longest === 1, JSON.stringify(model.selfCycle));
  ok('modèle : boucle d’appuis comme base (A puis B, seul accès à la boucle)', model.loopBase.fragile.join() === 'A,B', JSON.stringify(model.loopBase));
  ok('modèle : prémisses conjointes = une branche', model.joint.branches === 1 && model.joint.direct === 2 && model.joint.fragile.length === 0 && model.joint.sum.startsWith('1 appui (prémisses conjointes)'), JSON.stringify(model.joint));
  ok('modèle : aucun appui, objection répondue', model.none === 'aucun appui · 1 objection, répondue', model.none);
  ok('modèle : 600 cartes en moins de 60 ms', model.perf.ms < 60 && model.perf.supports > 100, JSON.stringify(model.perf));

  // ═══ 2. Interface (clair) ═══
  await seed(page);
  await openMap(page, 'light');
  ok('carte ouverte, mode inactif', (await page.locator('[data-testid=map-root] > [data-testid=map-chain]').count()) === 0 && (await page.getByTestId('map-chain').count()) === 0);
  ok('bouton de la barre désactivé sans carte choisie', await page.locator('[data-act=chain]').isDisabled());

  // L sur la thèse
  await clickNode(page, 'nT');
  await page.keyboard.press('l');
  await tick(page, 450);
  let cls = await classes(page);
  ok('L : mode actif', (await page.locator('[data-testid=map-root] > [data-testid=map-chain]').count()) === 1);
  ok('cartes de la chaîne nettes (rôles)', has(cls, 'nT', 'chain-root') && has(cls, 'nA', 'chain-support') && has(cls, 'nB', 'chain-support') && has(cls, 'nC', 'chain-support') && has(cls, 'nO', 'chain-objection') && has(cls, 'nO2', 'chain-objection') && has(cls, 'nR', 'chain-reply'), JSON.stringify(cls));
  ok('autres cartes estompées (U, X, Y)', has(cls, 'nX', 'chain-off') && has(cls, 'nY', 'chain-off') && has(cls, 'nU', 'chain-off'));
  ok('liens : chaîne soulignée, autres estompés', has(cls, 'edge:eAT', 'chain-edge') && has(cls, 'edge:eRO', 'chain-edge') && has(cls, 'edge:eXY', 'chain-off') && has(cls, 'edge:eTU', 'chain-off'));
  const look = await page.evaluate(() => {
    const st = (id) => getComputedStyle(document.querySelector(`.react-flow__node[data-id="${id}"]`));
    const ed = (id) => getComputedStyle(document.querySelector(`[data-testid="rf__edge-${id}"]`));
    return { xo: st('nX').opacity, xf: st('nX').filter, to: st('nT').opacity, tf: st('nT').filter, eo: ed('eXY').opacity, ec: ed('eAT').opacity, tr: st('nX').transitionProperty };
  });
  ok('estompage : opacité 0,18 + gris, chaîne intacte, transition', Math.abs(parseFloat(look.xo) - 0.18) < 0.01 && look.xf.includes('grayscale') && look.to === '1' && look.tf === 'none' && parseFloat(look.eo) < 0.2 && look.ec === '1' && look.tr.includes('opacity'), JSON.stringify(look));
  const panel = page.getByTestId('map-chain');
  const ring = await page.evaluate(() => ({ root: getComputedStyle(document.querySelector('.react-flow__node[data-id="nT"] .map-node')).boxShadow, sheet: document.querySelector('[data-testid=map-chain] style').textContent }));
  ok('carte suivie cerclée, feuille de style générée', /rgb/.test(ring.root) && ring.sheet.includes('data-id="nT"') && ring.sheet.includes('rf__edge-eAT') && !ring.sheet.includes('"nX"'), JSON.stringify(ring).slice(0, 300));
  ok('panneau « Chaîne de : … »', (await panel.innerText()).includes('Chaîne de') && (await page.getByTestId('map-chain-root').innerText()).includes('L’homme est condamné à être libre'));
  const diag = await page.getByTestId('map-chain-diag').innerText();
  ok('diagnostic en clair dans le panneau', diag.replace(/\s+/g, ' ').includes('1 seul appui direct · chaîne la plus longue : 2 · 1 objection sans réponse'), diag);
  const frag = page.locator('[data-act=chain-fragile]');
  ok('point fragile signalé', (await frag.count()) === 1 && (await frag.innerText()).includes('Point fragile : tout repose sur') && (await frag.innerText()).includes('L’existence précède l’essence'));
  ok('« Quitter (Échap) » affiché', (await panel.locator('[data-act=chain-quit]').innerText()).replace(/\s+/g, ' ').includes('Quitter Échap'));
  await shot(page, 'shots/map-chain/01-chaine-clair.png');

  // Clic sur le point fragile : la carte est centrée et choisie, la chaîne reste la même.
  await page.mouse.move(10, 10);
  await frag.click();
  await tick(page, 600);
  const centered = await page.evaluate(() => {
    const r = document.querySelector('.react-flow__node[data-id="nA"]').getBoundingClientRect();
    const w = document.querySelector('[data-testid=map-root]').getBoundingClientRect();
    return { dx: Math.abs(r.x + r.width / 2 - (w.x + w.width / 2)), dy: Math.abs(r.y + r.height / 2 - (w.y + w.height / 2)), sel: document.querySelector('.react-flow__node[data-id="nA"]').classList.contains('selected') };
  });
  ok('clic sur le point fragile : carte centrée et choisie', centered.dx < 40 && centered.dy < 40 && centered.sel, JSON.stringify(centered));
  ok('… la chaîne suivie ne change pas', (await page.getByTestId('map-chain-root').innerText()).includes('condamné'));

  // Conséquences
  await panel.locator('[data-act=chain-up]').click();
  await tick(page, 350);
  cls = await classes(page);
  ok('« Conséquences » : U rejoint la chaîne', has(cls, 'nU', 'chain-consequence') && has(cls, 'edge:eTU', 'chain-edge') && has(cls, 'nX', 'chain-off'));
  ok('diagnostic : « soutient 1 idée »', (await page.getByTestId('map-chain-diag').innerText()).includes('soutient 1 idée'));
  await page.locator('[data-act=fit]').click();
  await tick(page, 600);
  await shot(page, 'shots/map-chain/02-consequences-clair.png');
  await panel.locator('[data-act=chain-down]').click();
  await tick(page, 200);

  // Clic sur une autre carte : la chaîne se recentre.
  await clickNode(page, 'nA');
  await tick(page, 350);
  cls = await classes(page);
  ok('clic sur une autre carte : chaîne recentrée', (await page.getByTestId('map-chain-root').innerText()).includes('L’existence précède') && has(cls, 'nA', 'chain-root') && has(cls, 'nT', 'chain-off') && has(cls, 'nB', 'chain-support') && has(cls, 'nO2', 'chain-objection'), JSON.stringify(cls));
  ok('diagnostic recalculé (2 appuis indépendants)', (await page.getByTestId('map-chain-diag').innerText()).includes('2 appuis indépendants'));
  ok('pas de point fragile', (await page.locator('[data-act=chain-fragile]').count()) === 0);

  // Échap
  await page.keyboard.press('Escape');
  await tick(page, 400);
  cls = await classes(page);
  ok('Échap : mode quitté, tout redevient net', (await page.locator('[data-testid=map-root] > [data-testid=map-chain]').count()) === 0 && (await page.getByTestId('map-chain').count()) === 0 && Object.values(cls).every((c) => c === 'on'), JSON.stringify(cls));
  ok('… la carte reste choisie', await node(page, 'nA').evaluate((e) => e.classList.contains('selected')));
  const back = await node(page, 'nX').evaluate((e) => getComputedStyle(e).opacity);
  ok('… opacité revenue', back === '1', back);

  // L deux fois : bascule
  await page.keyboard.press('l');
  await tick(page, 200);
  ok('L : actif', (await page.locator('[data-testid=map-root] > [data-testid=map-chain]').count()) === 1);
  await page.keyboard.press('l');
  await tick(page, 200);
  ok('L encore : quitté', (await page.locator('[data-testid=map-root] > [data-testid=map-chain]').count()) === 0);

  // Clic droit → « Suivre la chaîne »
  const bO = await node(page, 'nO').boundingBox();
  await page.mouse.click(bO.x + 40, bO.y + 16, { button: 'right' });
  await tick(page, 250);
  const item = page.getByRole('menuitem', { name: /Suivre la chaîne/ });
  ok('clic droit : « Suivre la chaîne » (L)', (await item.count()) === 1 && (await item.innerText()).includes('L'));
  await item.click();
  await tick(page, 350);
  cls = await classes(page);
  ok('chaîne d’une objection : la réponse l’attaque, la thèse visée reste hors chaîne', has(cls, 'nO', 'chain-root') && has(cls, 'nR', 'chain-objection') && has(cls, 'nT', 'chain-off'), JSON.stringify(cls));
  ok('diagnostic « aucun appui · 1 objection sans réponse »', (await page.getByTestId('map-chain-diag').innerText()).replace(/\s+/g, ' ').includes('aucun appui · 1 objection sans réponse'));
  // Clic droit sur la carte suivie : « Quitter la chaîne »
  await page.mouse.click(bO.x + 40, bO.y + 16, { button: 'right' });
  await tick(page, 250);
  ok('clic droit sur la carte suivie : « Quitter la chaîne »', (await page.getByRole('menuitem', { name: /Quitter la chaîne/ }).count()) === 1);
  await page.keyboard.press('Escape');
  await tick(page, 200);

  // Clic dans le vide : sortie
  const root = await page.getByTestId('map-root').boundingBox();
  await page.mouse.click(root.x + root.width - 260, root.y + root.height - 160);
  await tick(page, 350);
  ok('clic dans le vide : mode quitté', (await page.locator('[data-testid=map-root] > [data-testid=map-chain]').count()) === 0);

  // Bouton de la barre
  await clickNode(page, 'nT');
  ok('bouton de la barre actif avec une carte choisie', !(await page.locator('[data-act=chain]').isDisabled()));
  await page.locator('[data-act=chain]').click();
  await tick(page, 300);
  ok('bouton de la barre : mode actif', (await page.locator('[data-testid=map-root] > [data-testid=map-chain]').count()) === 1 && (await page.locator('[data-act=chain]').getAttribute('aria-pressed')) === 'true');
  await page.getByTestId('map-chain').locator('[data-act=chain-quit]').click();
  await tick(page, 300);
  ok('« Quitter » : mode quitté', (await page.locator('[data-testid=map-root] > [data-testid=map-chain]').count()) === 0);

  // Carte masquée par une zone repliée : ignorée.
  await page.evaluate(() => {
    const s = window.__store.getState();
    const m = s.getMap('bS');
    s.setMap('bS', { ...m, zones: [{ id: 'z1', title: 'Exemples', color: '--cat-exemple', x: 180, y: 520, w: 340, h: 200, collapsed: true, hiddenNodeIds: ['nC'] }] });
  });
  await tick(page, 300);
  await clickNode(page, 'nT');
  await page.keyboard.press('l');
  await tick(page, 300);
  cls = await classes(page);
  const chainNow = await page.evaluate(async () => {
    const M = await import('/src/features/map/model/chain.ts');
    const { hiddenNodeIds } = await import('/src/features/map/model/zones.ts');
    const m = window.__store.getState().getMap('bS');
    return M.computeChain(m, 'nT', { hidden: hiddenNodeIds(m) }).supports.sort().join();
  });
  ok('carte d’une zone repliée ignorée', chainNow === 'nA,nB' && !has(cls, 'nC', 'chain-support'), chainNow + ' ' + cls.nC);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const s = window.__store.getState();
    const { zones: _z, ...m } = s.getMap('bS');
    s.setMap('bS', m);
  });
  await tick(page, 300);

  // Supprimer la carte suivie : sortie du mode.
  await clickNode(page, 'nY');
  await page.keyboard.press('l');
  await tick(page, 250);
  ok('chaîne de Y', (await page.locator('[data-testid=map-root] > [data-testid=map-chain]').count()) === 1);
  await page.evaluate(() => {
    const s = window.__store.getState();
    const m = s.getMap('bS');
    s.setMap('bS', { ...m, nodes: m.nodes.filter((n) => n.id !== 'nY'), edges: m.edges.filter((e) => e.target !== 'nY' && e.source !== 'nY') });
  });
  await tick(page, 300);
  ok('carte suivie supprimée : mode quitté', (await page.locator('[data-testid=map-root] > [data-testid=map-chain]').count()) === 0 && (await page.getByTestId('map-chain').count()) === 0);

  // ═══ 3. Grande carte (300 cartes) ═══
  await page.evaluate(() => window.__store.getState().navigate({ name: 'board', boardId: 'BIG' }));
  await page.waitForSelector('[data-testid=map-root] .react-flow__node');
  await tick(page, 900);
  await page.locator('[data-act=fit]').click();
  await tick(page, 500);
  const b3 = await node(page, 'g3').boundingBox();
  await page.mouse.click(b3.x + b3.width / 2, b3.y + 6);
  await tick(page, 200);
  // Premier passage (mise en route : couches, compilation), puis mesure.
  await page.keyboard.press('l');
  await tick(page, 500);
  await page.keyboard.press('Escape');
  await tick(page, 500);
  // Chronométrage : appui sur L → mode posé et styles recalculés → première image peinte.
  await page.evaluate(() => {
    window.__chainT = {};
    window.addEventListener('keydown', () => (window.__chainT.t0 = performance.now()), { capture: true, once: true });
    const root = document.querySelector('[data-testid=map-root]');
    const mo = new MutationObserver(() => {
      if (window.__chainT.cls || !root.querySelector(':scope > [data-testid=map-chain]')) return;
      getComputedStyle(document.querySelector('.react-flow__node[data-id="g250"]')).opacity; // force le calcul des styles
      window.__chainT.cls = performance.now();
      requestAnimationFrame(() => setTimeout(() => (window.__chainT.paint = performance.now())));
      mo.disconnect();
    });
    mo.observe(root, { childList: true });
  });
  await page.keyboard.press('l');
  await page.waitForFunction(() => window.__chainT.paint);
  const T = await page.evaluate(() => ({ cls: window.__chainT.cls - window.__chainT.t0, paint: window.__chainT.paint - window.__chainT.t0 }));
  const dt = T.cls;
  console.log('    chronométrage 300 cartes :', JSON.stringify(T));
  cls = await classes(page);
  const on = Object.entries(cls).filter(([k, c]) => !k.startsWith('edge:') && c === 'on').length;
  const off = Object.entries(cls).filter(([k, c]) => !k.startsWith('edge:') && c === 'off').length;
  ok(`300 cartes : styles de la chaîne posés en ${Math.round(dt)} ms (< 200), image en ${Math.round(T.paint)} ms (< 700, rendu logiciel)`, dt < 200 && T.paint < 700 && on > 5 && off > 200, `on=${on} off=${off}`);
  await tick(page, 400);
  await shot(page, 'shots/map-chain/03-grande-carte.png');
  await page.keyboard.press('Escape');
  await tick(page, 200);

  // ═══ 4. Aide ═══
  await page.evaluate(() => window.__store.getState().navigate({ name: 'help' }));
  await tick(page, 500);
  const helpText = await page.locator('body').innerText();
  ok('aide : « Suivre une chaîne », exemple et raccourci', helpText.includes('Suivre une chaîne') && helpText.includes('tout repose sur') && helpText.includes('Suivre la chaîne de la carte choisie'));

  ok('aucune erreur navigateur', errors.filter((e) => !/404|Failed to load resource/.test(e)).length === 0, errors.join(' | '));
});

// ═══ 5. Sombre ═══
await withApp(
  PORT,
  async (page, errors) => {
    await seed(page);
    await openMap(page, 'dark');
    await clickNode(page, 'nT');
    await page.keyboard.press('l');
    await tick(page, 500);
    ok('[sombre] mode actif', (await page.locator('[data-testid=map-root] > [data-testid=map-chain]').count()) === 1);
    const bg = await page.getByTestId('map-chain').evaluate((e) => getComputedStyle(e).backgroundColor);
    const r = bg.startsWith('color(srgb') ? parseFloat(bg.slice(11)) * 255 : Number(bg.match(/\d+/)?.[0] ?? 255);
    ok('[sombre] panneau sur fond sombre', r < 60, bg);
    await page.mouse.move(5, 5);
    await shot(page, 'shots/map-chain/04-chaine-sombre.png');
    ok('[sombre] aucune erreur navigateur', errors.filter((e) => !/404|Failed to load resource/.test(e)).length === 0, errors.join(' | '));
  },
  { dark: true },
);

console.log(`\n${passed} vérifications réussies.`);
