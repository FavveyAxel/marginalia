// Texte collé à plusieurs passages (notes de l'app Livres, de Google Play Livres, citations) :
// découpage en blocs, mentions retirées, guillemets ôtés, notes rattachées au passage qui précède.
// Lancer : node scripts/test-inbox-passages.mjs
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = await build({ entryPoints: [path.join(ROOT, 'src/features/inbox/passages.ts')], bundle: true, format: 'esm', write: false, platform: 'node' });
const P = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok', name); };

const LIVRES = `“L’homme est né libre, et partout il est dans les fers.”

Extrait de
Du contrat social
Jean-Jacques Rousseau
Ce document est peut-être protégé par des droits d’auteur.

“Tel se croit le maître des autres, qui ne laisse pas d’être plus esclave qu’eux.”

Le paradoxe du maître : à citer en intro.

“Renoncer à sa liberté c’est renoncer à sa qualité d’homme.”`;

ok('notes de Livres : 3 passages, mentions retirées', () => {
  const b = P.splitBlocks(LIVRES);
  assert.deepEqual(b.map((x) => x.text), [
    'L’homme est né libre, et partout il est dans les fers.',
    'Tel se croit le maître des autres, qui ne laisse pas d’être plus esclave qu’eux.',
    'Le paradoxe du maître : à citer en intro.',
    'Renoncer à sa liberté c’est renoncer à sa qualité d’homme.',
  ]);
  assert.equal(P.hasSeveralPassages(b), true);
  assert.equal(b[0].quoted, true);
  assert.equal(b[2].quoted, false);
});

ok('notes rattachées au passage qui précède ; bloc « Extrait de / titre / auteur » ignoré', () => {
  const b = P.splitBlocks(LIVRES);
  const matched = new Set([0, 1, 3]);
  const { found, rest } = P.pairNotes(b, (i) => (matched.has(i) ? `m${i}` : null));
  assert.deepEqual(found.map((f) => [f.match, f.note]), [
    ['m0', ''],
    ['m1', 'Le paradoxe du maître : à citer en intro.'],
    ['m3', ''],
  ]);
  assert.deepEqual(rest, []);
});

ok('citation non retrouvée : jamais prise pour une note ; sa note reste avec elle dans la boîte', () => {
  const b = P.splitBlocks(LIVRES);
  const { found, rest } = P.pairNotes(b, (i) => (i === 0 ? 'm0' : null));
  assert.equal(found.length, 1);
  assert.deepEqual(rest, ['Tel se croit le maître des autres, qui ne laisse pas d’être plus esclave qu’eux.', 'Le paradoxe du maître : à citer en intro.', 'Renoncer à sa liberté c’est renoncer à sa qualité d’homme.']);
});

const PLAY = `Notes de « Discours de la méthode »
René Descartes

12 mars 2026
Page 34
Le bon sens est la chose du monde la mieux partagée.
Note : la phrase d'ouverture, ironique.

14 mars 2026
Page 47
Je pense, donc je suis.

Page 52
« Il suffit de bien juger pour bien faire, et de juger le mieux qu’on puisse pour faire aussi tout son mieux. »`;

ok('Play Livres : dates, pages, en-tête retirés', () => {
  const b = P.splitBlocks(PLAY);
  assert.deepEqual(b.map((x) => x.text), [
    'René Descartes',
    'Le bon sens est la chose du monde la mieux partagée.',
    "la phrase d'ouverture, ironique.",
    'Je pense, donc je suis.',
    'Il suffit de bien juger pour bien faire, et de juger le mieux qu’on puisse pour faire aussi tout son mieux.',
  ]);
  // « Je pense, donc je suis. » : 5 mots, pas un passage candidat à part entière.
  assert.deepEqual(b.map((x) => x.candidate), [false, true, false, false, true]);
  const { found } = P.pairNotes(b, (i) => (i === 1 || i === 4 ? `m${i}` : null));
  assert.deepEqual(found.map((f) => f.note), ["la phrase d'ouverture, ironique.\n\nJe pense, donc je suis.", '']);
  assert.equal(P.hasSeveralPassages(b), true);
});

ok('un seul passage : traitement ordinaire', () => {
  assert.equal(P.hasSeveralPassages(P.splitBlocks('“L’homme est né libre, et partout il est dans les fers.”\n\nExtrait de\nDu contrat social')), false);
  assert.equal(P.hasSeveralPassages(P.splitBlocks('Une seule phrase assez longue pour être un passage du livre.')), false);
});

ok('guillemets variés ôtés, apostrophes gardées', () => {
  assert.equal(P.unquote('« L’homme est né libre »'), 'L’homme est né libre');
  assert.equal(P.unquote('"Quoted text here."'), 'Quoted text here.');
  assert.equal(P.unquote('“Fin.”.'), 'Fin.');
  assert.equal(P.unquote('l’homme'), 'l’homme');
});

ok('mentions reconnues (fr / en)', () => {
  for (const l of ['Extrait de', 'Excerpt From', 'This material may be protected by copyright.', 'Apple Books', 'Page 12', 'p. xii', '3/14/2026', 'March 14, 2026', '12 mars 2026', 'Location 1234', 'Highlights from Meditations'])
    assert.equal(P.isBoilerplate(l), true, l);
  for (const l of ['Le bon sens est la chose du monde la mieux partagée.', 'Page blanche et liberté de penser : une idée'])
    assert.equal(P.isBoilerplate(l), false, l);
});
console.log(`\n${n} vérifications réussies`);
