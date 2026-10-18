// Tests du modèle de carte d'argument (src/features/map/model/**).
//   1. Unitaires (node pur, via esbuild) : zones, cartes libres, lecture guidée, signaux, carte → plan,
//      carte → écrit (HTML), mouvements, versions, SVG (XML valide, comptes), ancienne base.
//   2. Navigateur (Vite + Chromium) : actions branchées sur le store (annulation, corbeille, versions),
//      écrit créé (signet de citation), PNG, PDF, base ancienne rechargée.
// Lancer : timeout 300 node scripts/test-map-model.mjs   (UNIT_ONLY=1 : partie 1 seulement)
import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-')), 'model.mjs');
await build({ entryPoints: [path.join(ROOT, 'src/features/map/model/index.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import(out);

let ok = 0;
const t = (name, fn) => {
  fn();
  ok++;
  console.log('ok -', name);
};

// ── Données réalistes : Descartes, Discours de la méthode, IVe partie ──
const book = {
  id: 'bD', title: 'Discours de la méthode', author: 'René Descartes', format: 'epub', fileName: 'source.epub', originalName: 'd.epub',
  size: 1, addedAt: 0, lastOpenedAt: null, progress: 0, position: null, cover: null,
  edition: { translator: '', place: 'Paris', publisher: 'GF Flammarion', year: '2000' },
};
const book2 = { ...book, id: 'bH', title: 'Enquête sur l’entendement humain', author: 'David Hume', edition: { translator: 'A. Leroy', place: 'Paris', publisher: 'Aubier', year: '1947' } };
let seq = 0;
const anchorAt = (start) => ({ kind: 'html', chapter: 3, start, end: start + 10, prefix: '', suffix: '' });
const H = (id, category, text, page, start, bookId = 'bD') => ({
  id, bookId, category, text, note: '', noteKind: null, conceptIds: [], anchor: anchorAt(start ?? seq++ * 10), locationLabel: 'Quatrième partie', printedPage: page ?? '', createdAt: 0, updatedAt: 0,
});
const highlights = [
  H('hP', 'probleme', 'Je ne sais si je dois vous entretenir des premières méditations que j’y ai faites', '37', 100),
  H('hT', 'these', 'Je pense, donc je suis', '38', 300),
  H('hA1', 'argument', 'Je pensai qu’il fallait que je rejetasse comme absolument faux tout ce en quoi je pourrais imaginer le moindre doute', '37', 200),
  H('hA2', 'argument', 'Pendant que je voulais ainsi penser que tout était faux, il fallait nécessairement que moi, qui le pensais, fusse quelque chose', '38', 280),
  H('hE1', 'exemple', 'À cause que nos sens nous trompent quelquefois', '37', 220),
  H('hO1', 'objection', 'Les plus extravagantes suppositions des sceptiques', '38', 310),
  H('hR1', 'argument', 'Toutes les plus extravagantes suppositions des sceptiques n’étaient pas capables de l’ébranler', '38', 320),
  H('hO2', 'objection', 'Il se pourrait que je rêve', '38', 330),
  H('hI1', 'concept', 'Une substance dont toute l’essence ou la nature n’est que de penser', '39', 600),
  H('hU', 'exemple', 'Il y a des hommes qui se méprennent en raisonnant', '37', 240),
  H('hPlain', null, 'Surlignage sans catégorie', '37', 250),
];
const lk = { highlights, books: [book, book2], studies: [] };
const N = (id, highlightId, x, y, text = '') => ({ id, highlightId, text, x, y });
const E = (id, source, target, relation, note) => ({ id, source, target, relation, groupId: null, ...(note ? { note } : {}) });
const baseMap = () => ({
  bookId: 'bD',
  nodes: [
    N('P', 'hP', 400, 0),
    N('T', 'hT', 400, 200),
    N('A1', 'hA1', 100, 420),
    N('A2', 'hA2', 700, 420),
    N('E1', 'hE1', 0, 700),
    N('S1', null, 300, 700, 'Le doute est méthodique, non sceptique'),
    N('O1', 'hO1', 1100, 200),
    N('R1', 'hR1', 1100, 420),
    N('O2', 'hO2', 1500, 200),
    N('I1', 'hI1', 1500, 700),
  ],
  edges: [
    E('eA1', 'A1', 'T', 'soutient', 'Le doute hyperbolique conduit au cogito'),
    E('eA2', 'A2', 'T', 'soutient'),
    E('eE1', 'E1', 'A1', 'illustre'),
    E('eS1', 'S1', 'A1', 'precise'),
    E('eO1', 'O1', 'T', 'objecte'),
    E('eR1', 'R1', 'O1', 'repond'),
  ],
  viewport: { x: 10, y: 20, zoom: 0.8 },
});
let idn = 0;
const idf = () => 'id' + ++idn;

// ── 12. Zones ──
t('zones : création autour de cartes (marge + bandeau), contenu', () => {
  const { map, zone } = M.createZoneAround(baseMap(), ['A1', 'E1', 'S1'], { lookup: lk, id: idf, title: 'Le doute' });
  assert.equal(zone.title, 'Le doute');
  assert.equal(zone.x, 0 - M.ZONE_MARGIN);
  assert.equal(zone.y, 420 - M.ZONE_MARGIN - M.ZONE_HEADER);
  assert.equal(zone.w, 300 + M.NODE_W + 2 * M.ZONE_MARGIN);
  assert.ok(zone.h > 280 + 2 * M.ZONE_MARGIN);
  assert.deepEqual(M.nodesInZone(map, zone.id, lk).sort(), ['A1', 'E1', 'S1']);
  assert.equal(M.zoneOfNode(map, 'E1', lk).id, zone.id);
  assert.equal(M.zoneOfNode(map, 'A2', lk), null);
});
t('zones : déplacer avec le contenu, redimensionner (taille min.), replier / déplier, retirer', () => {
  let { map, zone } = M.createZoneAround(baseMap(), ['A1', 'E1', 'S1'], { lookup: lk, id: idf });
  const moved = M.moveZone(map, zone.id, 50, 100, lk);
  const pos = (m, id) => m.nodes.find((n) => n.id === id);
  assert.deepEqual([pos(moved, 'A1').x, pos(moved, 'A1').y], [150, 520]);
  assert.deepEqual([pos(moved, 'A2').x, pos(moved, 'A2').y], [700, 420], 'carte hors zone immobile');
  assert.equal(moved.zones[0].x, zone.x + 50);
  const small = M.resizeZone(moved, zone.id, { w: 10, h: 10 });
  assert.equal(small.zones[0].w, M.ZONE_MIN_W);
  assert.equal(small.zones[0].h, M.ZONE_MIN_H);
  const col = M.collapseZone(moved, zone.id, lk);
  assert.equal(col.zones[0].collapsed, true);
  assert.deepEqual([...M.hiddenNodeIds(col)].sort(), ['A1', 'E1', 'S1']);
  // Zone repliée déplacée : le contenu (masqué) suit quand même.
  const col2 = M.moveZone(col, zone.id, -50, -100, lk);
  assert.equal(pos(col2, 'A1').x, 100);
  const exp = M.expandZone(col2, zone.id);
  assert.equal(exp.zones[0].collapsed, undefined);
  assert.equal(M.hiddenNodeIds(exp).size, 0);
  assert.equal(M.toggleZone(exp, zone.id, lk).zones[0].collapsed, true);
  assert.equal(M.updateZone(exp, zone.id, { title: 'Doute' }).zones[0].title, 'Doute');
  const rm = M.removeZone(exp, zone.id);
  assert.equal(rm.zones.length, 0);
  assert.equal(rm.nodes.length, 10);
});

// ── 14. Lecture guidée ──
t('lecture guidée : problème → thèse → arguments (précisions, exemples) → objections → réponses → reste', () => {
  const steps = M.guidedReading(baseMap(), lk);
  assert.deepEqual(
    steps.map((s) => `${s.nodeId}:${s.role}`),
    ['P:probleme', 'T:these', 'A1:argument', 'S1:precision', 'E1:exemple', 'A2:argument', 'O1:objection', 'R1:reponse', 'O2:objection', 'I1:reste'],
  );
  const by = Object.fromEntries(steps.map((s) => [s.nodeId, s]));
  assert.deepEqual(by.A1.edgesToHighlight, ['eA1']);
  assert.deepEqual(by.E1.edgesToHighlight, ['eE1']);
  assert.deepEqual(by.R1.edgesToHighlight, ['eR1']);
  assert.deepEqual(by.P.edgesToHighlight, []);
  assert.equal(by.A2.caption, 'Argument 2 : soutient la thèse');
  assert.equal(by.E1.caption, 'Exemple : illustre l’argument 1');
  assert.equal(by.R1.caption, 'Réponse : répond à l’objection 1');
  assert.equal(by.O1.caption, 'Objection 1 : objecte à la thèse');
  assert.equal(by.I1.role, 'reste');
  assert.equal(by.E1.parentId, 'A1');
  assert.equal(by.E1.depth, 2);
});
t('lecture guidée : carte centrale en tête, thèses opposées (carte multi-livres)', () => {
  const m = {
    id: 'board-1', kind: 'board', bookId: '', title: 'Descartes / Hume', bookIds: ['bD', 'bH'], viewport: null,
    nodes: [N('T', 'hT', 0, 0), N('X', null, 600, 0, 'Le moi n’est qu’un faisceau de perceptions'), N('XA', null, 600, 300, 'Je ne me saisis jamais sans une perception'), N('T2', null, 0, 600, 'Autre thèse')],
    edges: [E('o', 'X', 'T', 'oppose'), E('s', 'XA', 'X', 'soutient')],
    centralId: 'T',
  };
  const steps = M.guidedReading(m, lk);
  assert.deepEqual(steps.map((s) => `${s.nodeId}:${s.role}`), ['T:these', 'X:opposition', 'XA:argument', 'T2:reste']);
  assert.equal(steps[1].caption, 'Thèse opposée : s’oppose à la thèse');
});

// ── 15. Signaux de manques ──
t('signaux : thèse sans argument, objection sans réponse, extraits non placés, cartes isolées', () => {
  const g = M.mapGaps(baseMap(), lk);
  assert.deepEqual(g.thesesWithoutArgument, []);
  assert.deepEqual(g.objectionsWithoutAnswer, ['O2']);
  assert.equal(g.unplaced.count, 1);
  assert.deepEqual(g.unplaced.highlightIds, ['hU']);
  assert.deepEqual(g.isolated.sort(), ['I1', 'O2']);
  const m2 = baseMap();
  m2.edges = m2.edges.filter((e) => e.relation !== 'soutient' && e.relation !== 'repond');
  const g2 = M.mapGaps(m2, lk);
  assert.deepEqual(g2.thesesWithoutArgument, ['T']);
  assert.deepEqual(g2.objectionsWithoutAnswer.sort(), ['O1', 'O2']);
  const msgs = M.gapMessages(g2).map((x) => x.text);
  assert.ok(msgs.includes('1 thèse sans argument'), msgs.join(' | '));
  assert.ok(msgs.includes('2 objections sans réponse'));
  assert.ok(msgs.includes('1 extrait catégorisé pas encore sur la carte'));
  assert.equal(M.mapGaps({ bookId: 'bD', nodes: [N('T', 'hT', 0, 0)], edges: [], viewport: null }, lk).isolated.length, 0, 'une seule carte : pas « isolée »');
});

// ── 16. Conversions ──
t('carte → plan : thèse → problématique, arguments → parties, sous-parties, extraits rattachés', () => {
  const p = M.mapToPlan(baseMap(), lk, { id: idf, now: 5 });
  assert.equal(p.sujet, highlights[0].text);
  assert.equal(p.problematique, 'Je pense, donc je suis');
  assert.equal(p.title, 'Plan — Discours de la méthode');
  assert.equal(p.draftId, null);
  assert.equal(p.createdAt, 5);
  const titles = p.parts.map((x) => x.title);
  assert.equal(p.parts.length, 4, titles.join(' | '));
  assert.ok(titles[0].startsWith('Je pensai qu’il fallait'));
  assert.equal(p.parts[0].note, 'Le doute hyperbolique conduit au cogito');
  assert.deepEqual(p.parts[0].items.map((i) => i.ref), [{ kind: 'highlight', id: 'hA1' }]);
  assert.deepEqual(p.parts[0].children.map((c) => c.title), ['Précision : Le doute est méthodique, non sceptique', 'Exemple : À cause que nos sens nous trompent quelquefois']);
  assert.deepEqual(p.parts[0].children[0].items[0].ref, { kind: 'text', text: 'Le doute est méthodique, non sceptique' });
  assert.deepEqual(p.parts[0].children[1].items[0].ref, { kind: 'highlight', id: 'hE1' });
  assert.equal(p.parts[2].title, 'Discussion : objections et réponses');
  assert.equal(p.parts[2].children[0].children[0].items[0].ref.id, 'hR1');
  assert.equal(p.parts[3].title, 'Idées à intégrer');
  assert.deepEqual(p.parts[3].items.map((i) => i.ref.id), ['hI1']);
  for (const part of p.parts) for (const k of ['id', 'title', 'note', 'items', 'children']) assert.ok(k in part, k);
});
t('carte → écrit : HTML attendu (ordre de lecture, citations liées, notes de référence)', () => {
  const { title, html, citedHighlightIds } = M.mapToDraftHtml(baseMap(), lk);
  assert.equal(title, 'Explication — Discours de la méthode');
  assert.deepEqual(citedHighlightIds, ['hP', 'hT', 'hA1', 'hE1', 'hA2', 'hO1', 'hR1', 'hO2', 'hI1']);
  assert.ok(html.startsWith('<h1>Explication — Discours de la méthode</h1>\n<h2>Introduction</h2>'));
  assert.ok(
    html.includes(
      '<blockquote><p><span data-cite-hl="hT">« Je pense, donc je suis »</span><span data-footnote="René Descartes, Discours de la méthode, Paris, GF Flammarion, 2000, p. 38."></span></p></blockquote>',
    ),
    html,
  );
  assert.ok(html.includes('<h3>L’argument 1</h3>\n<p><em>Argument 1 : soutient la thèse.</em></p>'));
  assert.ok(html.includes('<p>Le doute hyperbolique conduit au cogito</p>'));
  assert.ok(html.includes('<p>Le doute est méthodique, non sceptique</p>'), 'idée sans extrait : paragraphe simple');
  const order = ['hP', 'hT', 'hA1', 'hE1', 'hA2', 'hO1', 'hR1', 'hO2', 'hI1'].map((id) => html.indexOf(`data-cite-hl="${id}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const h of ['<h2>Développement</h2>', '<h2>Autres éléments</h2>', '<h2>Conclusion</h2>']) assert.ok(html.includes(h), h);
  // HTML bien formé (balises équilibrées).
  new DOMParser({ onError: (lvl, msg) => { if (lvl !== 'warning') throw new Error(msg); } }).parseFromString(`<div>${html}</div>`, 'text/xml');
});

// ── 13. Cartes libres, 20. notes ──
t('cartes libres : création, placement d’extraits de plusieurs livres, notes de lien', () => {
  const b = M.newBoard('  Descartes et Hume ', { id: () => 'x', now: 7 });
  assert.equal(b.id, 'board-x');
  assert.equal(b.kind, 'board');
  assert.equal(b.title, 'Descartes et Hume');
  assert.equal(M.mapKeyOf(b), 'board-x');
  const hume = H('hH', 'these', 'Le moi n’est qu’un faisceau de perceptions', '343', 10, 'bH');
  const r = M.addHighlightNodes(b, [highlights[1], hume, hume], { id: idf });
  assert.equal(r.nodeIds.length, 2);
  assert.deepEqual(r.map.bookIds.sort(), ['bD', 'bH']);
  assert.equal(M.addHighlightNodes(r.map, [hume], { id: idf }).nodeIds.length, 0, 'pas de doublon');
  const lk2 = { ...lk, highlights: [...highlights, hume] };
  assert.deepEqual(M.mapBookIds(r.map, lk2).sort(), ['bD', 'bH']);
  assert.ok(M.scopeHighlights(r.map, lk2).some((h) => h.bookId === 'bH'));
  assert.deepEqual(M.listBoards({ bD: baseMap(), 'board-x': r.map }).map((m) => m.id), ['board-x']);
  const withNote = M.setEdgeNote(baseMap(), 'eA2', '  pourquoi ce lien ');
  assert.equal(withNote.edges.find((e) => e.id === 'eA2').note, 'pourquoi ce lien');
  assert.equal('note' in M.setEdgeNote(withNote, 'eA2', '').edges.find((e) => e.id === 'eA2'), false);
  const m0 = baseMap();
  assert.equal(M.setEdgeNote(m0, 'nope', 'x'), m0);
});

// ── 17. Mouvements ──
t('carte par mouvement : étendue, extraits proposés, titre', () => {
  const study = {
    id: 'st', bookId: 'bD', title: 'Le cogito', probleme: '', these: '', enjeu: '', createdAt: 0, updatedAt: 0,
    movements: [
      { id: 'm2', anchor: anchorAt(290), startText: '', title: 'La découverte du cogito', role: '' },
      { id: 'm1', anchor: anchorAt(190), startText: '', title: 'Le doute', role: '' },
    ],
  };
  const inM1 = M.highlightsInMovement(study, 'm1', highlights).map((h) => h.id);
  assert.deepEqual(inM1, ['hA1', 'hE1', 'hU', 'hPlain', 'hA2']);
  assert.deepEqual(M.highlightsInMovement(study, 'm1', highlights, { categorizedOnly: true }).map((h) => h.id), ['hA1', 'hE1', 'hU', 'hA2']);
  assert.deepEqual(M.highlightsInMovement(study, 'm2', highlights).map((h) => h.id), ['hT', 'hO1', 'hR1', 'hO2', 'hI1']);
  assert.equal(M.movementTitle(study, 'm1'), 'Le cogito — I. Le doute');
  const map = { id: M.movementMapKey('st', 'm1'), kind: 'movement', bookId: 'bD', studyId: 'st', movementId: 'm1', nodes: [N('a', 'hA1', 0, 0)], edges: [], viewport: null };
  assert.deepEqual(M.movementCandidates(map, study, highlights).map((h) => h.id), ['hE1', 'hU', 'hA2']);
  assert.equal(M.findMovementMap({ [map.id]: map }, 'st', 'm1'), map);
  // Signaux : le périmètre d'une carte de mouvement est le mouvement.
  assert.equal(M.mapGaps(map, { ...lk, studies: [study] }).unplaced.count, 3);
});

// ── 19. Versions ──
t('versions : JSON léger, élagage (20 derniers + nommées), restauration', () => {
  const m = baseMap();
  m.nodes[0].x = 400.4;
  const v = M.makeVersion(m, 'bD', { reason: 'layout', now: 1, id: () => 'v' });
  assert.equal(v.map.viewport, null);
  assert.equal(v.map.nodes[0].x, 400);
  assert.equal(v.name, null);
  const named = M.makeVersion(m, 'bD', { name: 'Avant l’oral', now: 0, id: () => 'named' });
  assert.equal(named.reason, 'manual');
  let all = [named, M.makeVersion(m, 'other', { now: 0, id: () => 'o', reason: 'layout' })];
  for (let i = 0; i < 25; i++) all = M.pruneVersions([M.makeVersion(m, 'bD', { reason: 'layout', now: 100 + i, id: () => 'a' + i }), ...all], 'bD');
  const mine = M.versionsOf(all, 'bD');
  assert.equal(mine.length, 21);
  assert.ok(mine.some((x) => x.id === 'named'));
  assert.equal(mine[0].id, 'a24');
  assert.ok(!mine.some((x) => x.id === 'a4'));
  assert.ok(all.some((x) => x.id === 'o'), 'autres cartes intactes');
  const cur = { ...baseMap(), nodes: [], edges: [], viewport: { x: 1, y: 2, zoom: 1 } };
  const back = M.restoredMap(cur, v);
  assert.equal(back.nodes.length, 10);
  assert.deepEqual(back.viewport, { x: 1, y: 2, zoom: 1 });
  assert.equal(M.versionSummary(v), '10 cartes, 6 liens');
  assert.ok(JSON.stringify(v).length < JSON.stringify({ ...m, pad: 'x'.repeat(10) }).length + 200);
});

// ── 18. SVG ──
const parseXml = (s) => {
  const errs = [];
  const doc = new DOMParser({ onError: (lvl, msg) => lvl !== 'warning' && errs.push(msg) }).parseFromString(s, 'image/svg+xml');
  assert.deepEqual(errs, []);
  return doc;
};
const byClass = (doc, tag, cls) => Array.from(doc.getElementsByTagName(tag)).filter((e) => e.getAttribute('class') === cls);
t('SVG : XML valide, autonome, bons comptes (cartes, liens, zones, flèches)', () => {
  const { map } = M.createZoneAround(baseMap(), ['A1', 'E1', 'S1'], { lookup: lk, id: idf, title: 'Le doute & <la> méthode' });
  map.edges[1].strength = 3;
  const r = M.mapToSvg(map, lk, { title: 'Discours — carte' });
  assert.deepEqual(r.counts, { nodes: 10, edges: 6, zones: 1 });
  const doc = parseXml(r.svg);
  const root = doc.documentElement;
  assert.equal(root.tagName, 'svg');
  assert.equal(root.getAttribute('xmlns'), 'http://www.w3.org/2000/svg');
  assert.equal(Number(root.getAttribute('width')), r.width);
  assert.ok(r.width > 1500 && r.height > 700);
  assert.equal(byClass(doc, 'g', 'node').length, 10);
  assert.equal(byClass(doc, 'g', 'edge').length, 6);
  assert.equal(byClass(doc, 'g', 'zone').length, 1);
  assert.equal(doc.getElementsByTagName('marker').length, 7); // une flèche par relation (dont « se rattache à »)
  assert.ok(!r.svg.includes('var('), 'aucune variable CSS');
  assert.ok(!/href="http|url\(http|@import/.test(r.svg), 'aucune ressource externe');
  assert.ok(r.svg.includes('fill="#fbf9f4"'), 'fond clair');
  assert.ok(r.svg.includes('Le doute &amp; &lt;la&gt; méthode'));
  // Liens : courbes de Bézier fléchées, tirets des relations « objecte », couleur de relation.
  const objecte = byClass(doc, 'g', 'edge').find((g) => g.getAttribute('data-relation') === 'objecte');
  const path0 = objecte.getElementsByTagName('path')[0];
  assert.match(path0.getAttribute('d'), /^M[-\d.]+,[-\d.]+ C/);
  assert.equal(path0.getAttribute('stroke'), '#d4556b');
  assert.ok(path0.getAttribute('stroke-dasharray'));
  assert.equal(path0.getAttribute('marker-end'), 'url(#arrow-objecte)');
  const strong = byClass(doc, 'g', 'edge').find((g) => g.getAttribute('data-id') === 'eA2').getElementsByTagName('path')[0];
  assert.equal(strong.getAttribute('stroke-width'), '3.2');
  // Note d'un lien : infobulle <title>.
  assert.ok(byClass(doc, 'g', 'edge').find((g) => g.getAttribute('data-id') === 'eA1').getElementsByTagName('title').length === 1);
  // Retours à la ligne : texte long → plusieurs tspan.
  const a2 = byClass(doc, 'g', 'node').find((g) => g.getAttribute('data-id') === 'A2');
  assert.ok(a2.getElementsByTagName('tspan').length >= 3);
  assert.ok(a2.textContent.includes('ARGUMENT · P. 38'));
});
t('SVG : zone repliée = bandeau, contenu et liens masqués ; carte vide', () => {
  let { map, zone } = M.createZoneAround(baseMap(), ['A1', 'E1', 'S1'], { lookup: lk, id: idf });
  map = M.collapseZone(map, zone.id, lk);
  const r = M.mapToSvg(map, lk);
  assert.deepEqual(r.counts, { nodes: 7, edges: 3, zones: 1 });
  const doc = parseXml(r.svg);
  assert.ok(byClass(doc, 'g', 'zone')[0].textContent.includes('(3 cartes)'));
  const empty = M.mapToSvg({ bookId: 'bD', nodes: [], edges: [], viewport: null }, lk);
  parseXml(empty.svg);
  assert.ok(empty.width > 0);
});

// ── Compatibilité : carte d'une base ancienne ──
t('ancienne carte (sans kind / id / zones / note / strength) : toutes les fonctions marchent', () => {
  const old = JSON.parse(JSON.stringify({ bookId: 'bD', nodes: baseMap().nodes, edges: baseMap().edges.map(({ note, ...e }) => e), viewport: null }));
  assert.equal(M.mapKeyOf(old), 'bD');
  assert.equal(M.mapKindOf(old), 'book');
  assert.equal(M.guidedReading(old, lk).length, 10);
  assert.equal(M.mapGaps(old, lk).unplaced.count, 1);
  assert.equal(M.mapToPlan(old, lk).parts.length, 4);
  assert.equal(M.mapToSvg(old, lk).counts.zones, 0);
  assert.deepEqual(M.nodesInZone(old, 'z', lk), []);
  assert.equal(M.hiddenNodeIds(old).size, 0);
  assert.equal(M.moveZone(old, 'z', 1, 1), old);
  assert.equal(M.lightMap(old).zones, undefined);
});

// ── Copie de cartes d'une carte à l'autre (panneau « Ajouter » des cartes libres) ──
t('copyNodesFromMap : cartes choisies + liens entre elles seulement, nouveaux ids, provenance, groupes renumérotés', () => {
  const src = baseMap();
  src.edges.push({ id: 'g1', source: 'A1', target: 'T', relation: 'soutient', groupId: 'G' }, { id: 'g2', source: 'A2', target: 'T', relation: 'soutient', groupId: 'G' });
  src.nodes.find((n) => n.id === 'A1').collapsed = true;
  let k = 0;
  const r = M.copyNodesFromMap(src, ['T', 'A1', 'E1', 'O2', 'nope'], { id: () => 'c' + ++k });
  assert.equal(r.nodes.length, 4);
  assert.ok(r.nodes.every((n) => n.id.startsWith('c') && n.from.mapKey === 'bD'));
  const orig = (id) => r.nodes.find((n) => n.from.nodeId === id);
  assert.equal(orig('T').highlightId, 'hT', 'référence à l’extrait d’origine gardée');
  assert.equal(orig('A1').collapsed, undefined);
  assert.deepEqual([orig('A1').x - orig('T').x, orig('A1').y - orig('T').y], [100 - 400, 420 - 200], 'positions relatives');
  // Liens : eA1 (A1→T, avec note), eE1 (E1→A1), g1 (A1→T, groupe dont l'autre lien n'est pas copié → groupId null).
  assert.equal(r.edges.length, 3);
  const e1 = r.edges.find((e) => e.note);
  assert.equal(e1.note, 'Le doute hyperbolique conduit au cogito');
  assert.equal(e1.source, orig('A1').id);
  assert.equal(e1.target, orig('T').id);
  assert.ok(r.edges.every((e) => e.groupId === null));
  assert.ok(r.edges.every((e) => !['eA1', 'eE1', 'g1'].includes(e.id)));
  // Groupe conjoint entièrement copié : renuméroté, pas réutilisé.
  const r2 = M.copyNodesFromMap(src, ['T', 'A1', 'A2'], { id: () => 'd' + ++k });
  const grp = r2.edges.filter((e) => e.groupId);
  assert.equal(grp.length, 2);
  assert.equal(grp[0].groupId, grp[1].groupId);
  assert.notEqual(grp[0].groupId, 'G');
  // Copie d'une copie : la provenance d'origine est conservée.
  const r3 = M.copyNodesFromMap({ ...M.newBoard('B', { id: () => 'x' }), nodes: r.nodes, edges: r.edges }, [r.nodes[0].id], { id: () => 'e' + ++k });
  assert.deepEqual(r3.nodes[0].from, r.nodes[0].from);
});
t('placeBlock / copyIntoMap : bloc posé sans chevauchement, extraits déjà présents non dupliqués, livres de la carte libre', () => {
  const src = baseMap();
  let board = M.newBoard('Comparer', { id: () => 'b1', now: 1 });
  board = M.addHighlightNodes(board, [highlights.find((h) => h.id === 'hT'), H('hX', 'these', 'Hume : nous ne connaissons pas de substance', '12', 5, 'bH')], { id: idf }).map;
  assert.deepEqual(board.bookIds.sort(), ['bD', 'bH']);
  const before = board.nodes.map((n) => M.nodeRect(n, M.nodeText(n, { ...lk, highlights: [...highlights, H('hX', 'these', 'Hume : nous ne connaissons pas de substance', '12', 5, 'bH')] })));
  const { map, nodeIds } = M.copyIntoMap(board, src, ['T', 'A1', 'A2', 'O1'], { id: idf, lookup: lk });
  // T est déjà sur la carte (hT) : pas de doublon, les liens copiés s'y rebranchent.
  assert.equal(map.nodes.filter((n) => n.highlightId === 'hT').length, 1);
  assert.equal(map.nodes.length, 2 + 3);
  assert.equal(nodeIds.length, 4);
  const tId = board.nodes.find((n) => n.highlightId === 'hT').id;
  assert.equal(map.edges.filter((e) => e.target === tId).length, 3, 'A1, A2, O1 → T existant');
  // Aucun chevauchement entre les nouvelles cartes et l'existant.
  const added = map.nodes.slice(2).map((n) => M.nodeRect(n, M.nodeText(n, lk)));
  for (const a of added) for (const b of before) assert.ok(a.x >= b.x + b.w || b.x >= a.x + a.w || a.y >= b.y + b.h || b.y >= a.y + a.h, 'chevauchement');
  // Recopie : rien de neuf (liens identiques ignorés).
  const again = M.copyIntoMap(map, src, ['T', 'A1'], { id: idf, lookup: lk });
  assert.equal(again.map.edges.length, map.edges.length);
  // Position demandée occupée : le bloc descend.
  const pb = M.placeBlock(map, M.copyNodesFromMap(src, ['E1'], { id: idf }), { at: { x: map.nodes[0].x, y: map.nodes[0].y }, lookup: lk });
  const r = M.nodeRect(pb.nodes[0], M.nodeText(pb.nodes[0], lk));
  assert.ok(map.nodes.every((n) => { const b = M.nodeRect(n, M.nodeText(n, lk)); return r.x >= b.x + b.w || b.x >= r.x + r.w || r.y >= b.y + b.h || b.y >= r.y + r.h; }));
  // Carte vide : le bloc garde sa forme, coin à l'origine.
  assert.deepEqual(M.freeSpot(M.newBoard('x', { id: () => 'e' })), { x: 0, y: 0 });
});
t('idées et concepts : cartes neuves, concept référencé, placement groupé', () => {
  const idea = M.ideaNode('  La liberté   suppose la loi ', { x: 10.4, y: 3 }, () => 'i1');
  assert.deepEqual(idea, { id: 'i1', highlightId: null, text: 'La liberté suppose la loi', x: 10, y: 3 });
  const c = M.conceptNode({ id: 'cV', name: 'Véracité', definition: 'Devoir de dire vrai.' }, { x: 0, y: 0 }, () => 'n1');
  assert.equal(c.conceptId, 'cV');
  assert.equal(c.text, 'Véracité — Devoir de dire vrai.');
  const laid = M.placeNewNodes(baseMap(), [idea, c, M.ideaNode('3', { x: 0, y: 0 }, () => 'i3'), M.ideaNode('4', { x: 0, y: 0 }, () => 'i4')], lk);
  assert.equal(new Set(laid.map((n) => `${n.x},${n.y}`)).size, 4);
  assert.ok(laid.every((n) => n.y > 700), 'sous le contenu existant');
});
t('cartes libres : base ancienne sans carte libre ni champs nouveaux → listBoards vide, newBoard autonome', () => {
  const oldMaps = { bD: { bookId: 'bD', nodes: [], edges: [], viewport: null } };
  assert.deepEqual(M.listBoards(oldMaps), []);
  const b = M.newBoard('  ', { id: () => 'z', now: 5 });
  assert.equal(b.id, 'board-z');
  assert.equal(b.title, 'Nouvelle carte');
  assert.equal(b.bookId, '');
  assert.ok(M.isBoard(b) && !M.isBookMap(b));
  assert.deepEqual(M.listBoards({ ...oldMaps, [b.id]: b }).map((x) => x.id), ['board-z']);
  assert.equal(M.mapKeyOf(b), 'board-z');
});

console.log(`\n${ok} tests unitaires réussis`);

if (process.env.UNIT_ONLY) process.exit(0);
await import('./test-map-model-browser.mjs');
