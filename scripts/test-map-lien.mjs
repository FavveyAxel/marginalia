// Lien neutre « lien » (n'affirme rien, sans flèche, dans le sens du geste) — port 5416.
//   1. Unitaires (node pur, via esbuild) : arbre de repli (la cible est l'enfant de la source ; replier
//      le centre masque les cartes tirées de lui), sens inverse toléré, relations d'argument inchangées,
//      chaîne (ni appui ni objection, voisines « liées »), signaux, rangements Arbre / Radial / Débat,
//      lecture guidée, carte → plan, SVG (pas de flèche), centre (relation par défaut), reverseEdgeIn.
//   2. Navigateur (Vite + Chromium) : reverseEdge(key, edgeId) branché sur le store, une étape d'annulation.
// Lancer : timeout 300 node scripts/test-map-lien.mjs   (UNIT_ONLY=1 : partie 1 seulement)
import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ml-')), 'lien.mjs');
await build({
  stdin: {
    contents: [
      "export * from './src/features/map/model/index.ts';",
      "export * from './src/features/map/model/chain.ts';",
      "export { layoutMap } from './src/features/map/ui/layouts.ts';",
      "export { RELATION_BY_ID } from './src/lib/categories.ts';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'error',
});
const M = await import(out);

let ok = 0;
const t = (name, fn) => {
  fn();
  ok++;
  console.log('ok -', name);
};

// ── Carte de l'enregistrement : « Sujet : Le liberté », trois liens tirés du centre ──
const lk = { highlights: [], books: [], studies: [] };
const N = (id, text, x, y, extra = {}) => ({ id, highlightId: null, text, x, y, ...extra });
const E = (id, source, target, relation, extra = {}) => ({ id, source, target, relation, groupId: null, ...extra });
const simple = () => ({
  id: 'board-p', kind: 'board', bookId: '', title: 'Le liberté', bookIds: [],
  nodes: [
    N('S', 'Le liberté', 400, 0, { kind: 'subject' }),
    N('A', 'Trahir sa parole, c’est se trahir soi-même', 0, 300),
    N('B', 'Le serment engage devant les autres', 400, 300),
    N('C', 'Peut-on se liberté par fidélité ?', 800, 300),
  ],
  edges: [E('eA', 'S', 'A', 'lien'), E('eB', 'S', 'B', 'lien'), E('eC', 'S', 'C', 'lien')],
  viewport: null,
});
// Variante plus riche : argument sous A, lien tiré de A, lien tiré VERS le centre.
const rich = () => {
  const m = simple();
  m.nodes.push(N('D', 'La parole donnée fonde la confiance', 0, 600), N('F', 'Ulysse et les sirènes', 300, 600), N('X', 'Le mensonge', 1200, 300));
  m.edges.push(E('eD', 'D', 'A', 'soutient'), E('eF', 'A', 'F', 'lien'), E('eX', 'X', 'S', 'lien'));
  return m;
};

// ═══ Types et libellés ═══
t('RELATION_BY_ID.lien : « lien », variable --rel-lien', () => {
  assert.equal(M.RELATION_BY_ID.lien.label, 'lien');
  assert.equal(M.RELATION_BY_ID.lien.cssVar, '--rel-lien');
  assert.equal(M.LIGHT_COLORS['--rel-lien'], '#958c7d');
});

// ═══ Repli ═══
t('repli : les trois cartes tirées du centre sont ses enfants', () => {
  const tree = M.foldTree(simple());
  assert.deepEqual(tree.roots, ['S']);
  for (const id of ['A', 'B', 'C']) assert.equal(tree.parent.get(id), 'S');
  assert.deepEqual(M.descendants(tree, 'S').sort(), ['A', 'B', 'C']);
});
t('replier le centre masque les trois cartes ; déplier les rend', () => {
  const m = M.toggleFold(simple(), 'S');
  assert.deepEqual([...M.foldHiddenIds(m)].sort(), ['A', 'B', 'C']);
  assert.deepEqual(M.foldInfo(m).get('S'), { count: 3, folded: true });
  assert.equal(M.foldHiddenIds(M.toggleFold(m, 'S')).size, 0);
});
t('repli : sans centre, la carte de départ reste racine (A → B neutre : B enfant de A)', () => {
  const m = { nodes: [N('A', 'a', 0, 300), N('B', 'b', 0, 0)], edges: [E('e', 'A', 'B', 'lien')] };
  const tree = M.foldTree(m);
  assert.deepEqual(tree.roots, ['A']);
  assert.equal(tree.parent.get('B'), 'A');
});
t('repli : argument sous une carte liée, lien tiré d’une carte liée, lien tiré VERS le centre', () => {
  const tree = M.foldTree(rich());
  assert.equal(tree.parent.get('D'), 'A'); // D soutient A : D enfant de A (inchangé)
  assert.equal(tree.parent.get('F'), 'A'); // tiré de A
  assert.equal(tree.parent.get('X'), 'S'); // X → S : le centre est déjà racine, le lien vaut dans l'autre sens
  assert.deepEqual(tree.roots, ['S']);
  assert.deepEqual(tree.children.get('A'), ['D', 'F']); // arguments d'abord
  assert.deepEqual([...M.foldHiddenIds(M.toggleFold(rich(), 'A'))].sort(), ['D', 'F']);
});
t('repli : relations d’argument inchangées (A soutient T ⇒ A enfant de T), « s’oppose à » sans filiation', () => {
  const m = { nodes: [N('T', 't', 0, 0), N('A', 'a', 0, 300), N('O', 'o', 400, 0)], edges: [E('e1', 'A', 'T', 'soutient'), E('e2', 'O', 'T', 'oppose')] };
  const tree = M.foldTree(m);
  assert.equal(tree.parent.get('A'), 'T');
  assert.equal(tree.parent.has('O'), false);
});
t('repli : un cycle de liens neutres ne boucle pas', () => {
  const m = { nodes: [N('A', 'a', 0, 0), N('B', 'b', 0, 300), N('C', 'c', 300, 300)], edges: [E('1', 'A', 'B', 'lien'), E('2', 'B', 'C', 'lien'), E('3', 'C', 'A', 'lien')] };
  const tree = M.foldTree(m);
  assert.equal(tree.parent.size, 2);
  assert.equal(tree.roots.length, 1);
});

// ═══ Centre ═══
t('centre : un lien tracé est neutre par défaut ; Tab garde la relation du centre', () => {
  assert.equal(M.NEUTRAL_RELATION, 'lien');
  assert.equal(M.newLinkRelation(), 'lien');
  assert.equal(M.relationToward(simple(), 'S'), 'rattache');
  assert.equal(M.relationToward(simple(), 'A'), null);
});
t('centre : faire du sujet une problématique (ou une idée) laisse les liens neutres tels quels', () => {
  const m = rich();
  m.edges.push(E('eY', 'Y', 'S', 'rattache'));
  m.nodes.push(N('Y', 'y', 600, 600));
  const q = M.setNodeCenter(m, 'S', 'question');
  assert.deepEqual(q.edges.filter((e) => e.relation === 'lien').map((e) => e.id).sort(), ['eA', 'eB', 'eC', 'eF', 'eX']);
  assert.equal(q.edges.find((e) => e.id === 'eY').relation, 'repond');
  const idea = M.setNodeCenter(q, 'S', null);
  assert.equal(idea.edges.find((e) => e.id === 'eY').relation, 'soutient');
  assert.equal(idea.edges.filter((e) => e.relation === 'lien').length, 5);
});

// ═══ Chaîne ═══
t('chaîne : un lien neutre n’est ni appui ni objection ; voisines « liées » à part', () => {
  const c = M.computeChain(rich(), 'A');
  assert.deepEqual(c.supports, ['D']);
  assert.deepEqual(c.objections, []);
  assert.deepEqual(c.linked.sort(), ['F', 'S']);
  assert.deepEqual(c.linkedEdges.sort(), ['eA', 'eF']);
  assert.equal(c.role.F, undefined);
  assert.equal(c.edges.includes('eF'), false);
  assert.equal(c.diagnosis.supportCount, 1);
  const s = M.computeChain(rich(), 'S', { consequences: true });
  assert.deepEqual(s.supports, []);
  assert.deepEqual(s.consequences, []);
  assert.deepEqual(s.linked.sort(), ['A', 'B', 'C', 'X']);
  assert.ok(M.chainSummary(s.diagnosis).includes('aucun appui'));
  // Cartes masquées : ignorées
  assert.deepEqual(M.computeChain(rich(), 'S', { hidden: new Set(['B']) }).linked.sort(), ['A', 'C', 'X']);
});

// ═══ Signaux ═══
t('signaux : un lien neutre ne compte pas comme argument, mais la carte n’est pas isolée', () => {
  const m = { bookId: '', kind: 'board', bookIds: [], nodes: [N('T', 't', 0, 0), N('A', 'a', 0, 300), N('Z', 'z', 600, 0)], edges: [E('e', 'A', 'T', 'lien')], centralId: 'T', viewport: null };
  const g = M.mapGaps(m, lk);
  assert.deepEqual(g.thesesWithoutArgument, ['T']);
  assert.deepEqual(g.isolated, ['Z']);
});

// ═══ Rangements ═══
const lnodes = (m) => m.nodes.map((n) => ({ id: n.id, w: 240, h: 80, category: null, idea: true, textRank: null }));
const ledges = (m) => m.edges.map((e) => ({ source: e.source, target: e.target, relation: e.relation }));
t('Ranger › Arbre : le centre en haut, les cartes tirées dessous, F sous A', () => {
  const m = rich();
  const p = M.layoutMap('arbre', lnodes(m), ledges(m), 'S', { x: 0, y: 0 });
  for (const id of ['A', 'B', 'C', 'X']) assert.ok(p.get(id).y > p.get('S').y, id);
  assert.ok(p.get('F').y > p.get('A').y && p.get('D').y > p.get('A').y);
  assert.equal(p.get('A').y, p.get('B').y);
});
t('Ranger › Arbre sans centre : A → B neutre met A au-dessus de B', () => {
  const m = { nodes: [N('A', 'a', 0, 300), N('B', 'b', 0, 0)], edges: [E('e', 'A', 'B', 'lien')] };
  const p = M.layoutMap('arbre', lnodes(m), ledges(m), null, { x: 0, y: 0 });
  assert.ok(p.get('B').y > p.get('A').y);
});
t('Ranger › Radial : le centre au milieu, ses trois cartes tout autour (comme « se rattache à »)', () => {
  const m = simple();
  const p = M.layoutMap('radial', lnodes(m), ledges(m), 'S', { x: 0, y: 0 });
  const c = (id) => ({ x: p.get(id).x + 120, y: p.get(id).y + 40 });
  const d = ['A', 'B', 'C'].map((id) => Math.hypot(c(id).x - c('S').x, c(id).y - c('S').y));
  assert.ok(d.every((x) => x > 100), JSON.stringify(d));
  // Même rangement que la carte mentale « se rattache à » équivalente (A → S, B → S, C → S).
  const r = simple();
  r.edges = r.edges.map((e) => ({ ...e, source: e.target, target: e.source, relation: 'rattache' }));
  assert.deepEqual([...M.layoutMap('radial', lnodes(r), ledges(r), 'S', { x: 0, y: 0 })], [...p]);
  // Le centre est à l'intérieur de l'enveloppe des trois cartes.
  const xs = ['A', 'B', 'C'].map((id) => c(id).x);
  assert.ok(c('S').x > Math.min(...xs) && c('S').x < Math.max(...xs));
});
t('Ranger › Débat : le centre à gauche, les cartes tirées à droite', () => {
  const m = simple();
  const p = M.layoutMap('debat', lnodes(m), ledges(m), 'S', { x: 0, y: 0 });
  for (const id of ['A', 'B', 'C']) assert.ok(p.get(id).x > p.get('S').x, id);
});

// ═══ Lecture guidée, plan, écrit ═══
t('lecture guidée : les cartes tirées du sujet en thèses « liées au sujet », puis l’idée liée', () => {
  const steps = M.guidedReading(rich(), lk);
  const by = Object.fromEntries(steps.map((s) => [s.nodeId, s]));
  assert.equal(steps[0].nodeId, 'S');
  assert.equal(by.A.role, 'these');
  assert.equal(by.A.parentId, 'S');
  assert.equal(by.A.caption, 'Thèse 1 : liée au sujet');
  assert.equal(by.D.role, 'argument');
  assert.equal(by.F.role, 'liee');
  assert.equal(by.F.parentId, 'A');
  assert.equal(by.F.caption, 'Idée liée à la thèse');
  assert.equal(by.X.role, 'these');
  assert.equal(M.GUIDED_ROLE_LABEL.liee, 'Idée liée');
  assert.equal(steps.length, 7);
});
t('lecture guidée : « se rattache au sujet » (et non « à le sujet »)', () => {
  const m = simple();
  m.edges = m.edges.map((e) => ({ ...e, source: e.target, target: e.source, relation: 'rattache' }));
  assert.equal(M.guidedReading(m, lk)[1].caption, 'Thèse 1 : se rattache au sujet');
});
t('carte → plan : les cartes tirées du sujet sont les parties, l’idée liée une sous-partie', () => {
  const plan = M.mapToPlan(rich(), lk, { id: (() => { let i = 0; return () => 'p' + ++i; })(), now: 1 });
  assert.equal(plan.sujet, 'Le liberté');
  assert.equal(plan.title, 'Plan — Le liberté');
  const titles = plan.parts.map((p) => p.title);
  assert.deepEqual(titles.slice(0, 4), ['Trahir sa parole, c’est se trahir soi-même', 'Le serment engage devant les autres', 'Peut-on se liberté par fidélité ?', 'Le mensonge']);
  const a = plan.parts[0];
  assert.deepEqual(a.children.map((c) => c.title), ['La parole donnée fonde la confiance', 'Ulysse et les sirènes']);
  assert.equal(plan.parts.some((p) => p.title === 'Idées à intégrer'), false);
});
t('carte → plan : idée liée à une carte restante → « Idées à intégrer »', () => {
  const m = { bookId: '', kind: 'board', bookIds: [], nodes: [N('A', 'a', 0, 0), N('B', 'b', 0, 300)], edges: [E('e', 'A', 'B', 'lien')], viewport: null };
  const plan = M.mapToPlan(m, lk, { now: 1 });
  const rest = plan.parts.find((p) => p.title === 'Idées à intégrer');
  assert.equal(rest.items.length, 2);
});
t('carte → écrit : l’idée liée apparaît dans le développement', () => {
  const { html } = M.mapToDraftHtml(rich(), lk);
  assert.ok(html.includes('Idée liée à la thèse'));
  assert.ok(html.indexOf('Ulysse et les sirènes') > html.indexOf('Trahir sa parole'));
});

// ═══ SVG ═══
t('SVG : lien neutre gris, sans flèche ni libellé ; les autres liens gardent leur flèche', () => {
  const { svg } = M.mapToSvg(rich(), lk);
  new DOMParser({ onError: (lvl, msg) => { if (lvl !== 'warning') throw new Error(msg); } }).parseFromString(svg, 'image/svg+xml');
  assert.equal(svg.includes('id="arrow-lien"'), false);
  assert.ok(svg.includes('id="arrow-soutient"'));
  const lienEdges = svg.split('\n').filter((l) => l.includes('data-relation="lien"'));
  assert.equal(lienEdges.length, 5);
  for (const l of lienEdges) {
    assert.equal(l.includes('marker-end'), false);
    assert.ok(l.includes('stroke="#958c7d"'));
    assert.equal(l.includes('>lien<'), false);
  }
  const sout = svg.split('\n').find((l) => l.includes('data-relation="soutient"'));
  assert.ok(sout.includes('marker-end="url(#arrow-soutient)"'));
  // Replié : les cartes tirées du centre disparaissent de l'export.
  const folded = M.mapToSvg(M.toggleFold(simple(), 'S'), lk);
  assert.equal(folded.counts.nodes, 1);
  assert.ok(folded.svg.includes('>+3<'));
});
t('SVG : note sur un lien neutre affichée', () => {
  const m = simple();
  m.edges[0].note = 'par contraste';
  assert.ok(M.mapToSvg(m, lk).svg.includes('par contraste'));
});

// ═══ Inverser le sens ═══
t('reverseEdgeIn : source ↔ cible, relation et note gardées, groupe quitté', () => {
  const m = simple();
  m.edges[0] = { ...m.edges[0], note: 'n', groupId: 'g1', strength: 3 };
  const r = M.reverseEdgeIn(m, 'eA');
  assert.deepEqual(r.edges[0], { id: 'eA', source: 'A', target: 'S', relation: 'lien', groupId: null, note: 'n', strength: 3 });
  assert.equal(r.edges[1], m.edges[1]);
  assert.equal(M.reverseEdgeIn(m, 'nope'), m);
  // Lien inverse déjà présent : rien ne change.
  const dup = { ...m, edges: [...m.edges, E('eA2', 'A', 'S', 'lien')] };
  assert.equal(M.reverseEdgeIn(dup, 'eA'), dup);
  // Inversé deux fois : identique (hors groupe).
  assert.deepEqual(M.reverseEdgeIn(M.reverseEdgeIn(m, 'eB'), 'eB'), m);
  // Après inversion, le repli suit : A → S neutre, le centre reste racine, A reste son enfant.
  assert.equal(M.foldTree(M.reverseEdgeIn(simple(), 'eA')).parent.get('A'), 'S');
});

console.log(`\n${ok} tests unitaires OK`);
if (process.env.UNIT_ONLY) process.exit(0);

// ═══ 2. Navigateur : reverseEdge branché sur le store ═══
const { withApp } = await import('./harness.mjs');
await withApp(5416, async (page, errors) => {
  const res = await page.evaluate(async (map) => {
    const A = await import('/src/features/map/model/actions.ts');
    const s = () => window.__store.getState();
    s().setMap('board-p', map);
    await new Promise((r) => setTimeout(r, 30));
    const r = {};
    r.changed = A.reverseEdge('board-p', 'eA');
    await new Promise((r) => setTimeout(r, 30));
    const e = () => s().maps['board-p'].edges.find((x) => x.id === 'eA');
    r.after = [e().source, e().target];
    r.missing = A.reverseEdge('board-p', 'nope');
    s().undo();
    await new Promise((r) => setTimeout(r, 30));
    r.undone = [e().source, e().target];
    r.mapStill = !!s().maps['board-p'];
    s().redo();
    await new Promise((r) => setTimeout(r, 30));
    r.redone = [e().source, e().target];
    return r;
  }, simple());
  assert.equal(res.changed, true);
  assert.deepEqual(res.after, ['A', 'S']);
  assert.equal(res.missing, false);
  assert.deepEqual(res.undone, ['S', 'A'], 'une annulation rend le sens d’origine (sans défaire la création de la carte)');
  assert.equal(res.mapStill, true);
  assert.deepEqual(res.redone, ['A', 'S']);
  ok++;
  console.log('ok - reverseEdge : inverse, ⌘Z rend le sens d’origine en une étape, rétablir');
  assert.deepEqual(errors, []);
});
console.log(`\n${ok} tests OK`);
