// Tests unitaires des règles de style (node pur) : node scripts/test-style-rules.mjs
import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sr-')), 'rules.mjs');
await build({ entryPoints: [path.join(ROOT, 'src/features/editor/styleRules.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const R = await import(out);

const of = (fs_, cat) => fs_.filter((f) => f.cat === cat);
let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('ok -', name); };

t('phrase de 41 mots signalée, 40 non', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => 'mot' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + ((i * 7) % 26))).join(' ') + '.';
  assert.equal(of(R.analyze([mk(41)]), 'long').length, 1);
  assert.equal(of(R.analyze([mk(40)]), 'long').length, 0);
  assert.match(of(R.analyze([mk(41)]), 'long')[0].msg, /41 mots/);
});
t('abréviations et décimaux ne coupent pas les phrases', () => {
  const s = R.splitSentences('Cf. Kant, p. 12. Voici 3.5 points. Fin ?');
  assert.equal(s.length, 3);
});
t('répétition à moins de 30 mots', () => {
  const f = of(R.analyze(['La liberté suppose une règle. Sans règle, la liberté se perd.']), 'repeat');
  const words = f.map((x) => x.text.toLowerCase());
  assert.ok(words.includes('liberté') && words.includes('règle'), words.join());
});
t('lemmatisation simple : liberté / libertés', () => {
  const f = of(R.analyze(['La liberté est précieuse, les libertés aussi.']), 'repeat');
  assert.equal(f.length, 1);
});
t('mots-outils ignorés', () => {
  assert.equal(of(R.analyze(['Il est dans la maison et il est dans le jardin avec une amie et une sœur.']), 'repeat').length, 0);
});
t('pas de répétition au-delà de 30 mots', () => {
  const filler = Array.from({ length: 35 }, (_, i) => 'zorg' + 'abcdefghij'[i % 10] + (i % 7) + 'x').join(' ');
  assert.equal(of(R.analyze([`Le bonheur ${filler} le bonheur.`]), 'repeat').length, 0);
});
t('répétition entre paragraphes', () => {
  assert.equal(of(R.analyze(['Le bonheur est un but.', 'Le bonheur est aussi un moyen.']), 'repeat').length >= 1, true);
});
t('adverbes : seuil de 2 par paragraphe, noms en -ment exclus', () => {
  assert.equal(of(R.analyze(['Il est vraiment content.']), 'adverb').length, 0);
  assert.equal(of(R.analyze(['Il parle vraiment et absolument sans doute.']), 'adverb').length, 2);
  assert.equal(of(R.analyze(['Le moment du jugement et le gouvernement du sentiment.']), 'adverb').length, 0);
});
t('tics de copie', () => {
  const txt = 'De nos jours, on peut dire que la liberté est tout à fait relative. Il est important de noter que c’est bien évidemment faux. Depuis la nuit des temps.';
  const f = of(R.analyze([txt]), 'tic').map((x) => x.text.toLowerCase());
  for (const k of ['de nos jours', 'on peut dire que', 'tout à fait', 'il est important de noter que', 'bien évidemment', 'depuis la nuit des temps']) assert.ok(f.includes(k), k + ' absent : ' + f.join('|'));
});
t('« En effet » répété en tête de phrase (3 fois)', () => {
  const p = ['En effet, a. En effet, b. Autre chose. En effet, c.'];
  assert.equal(of(R.analyze(p), 'tic').filter((x) => /en effet/i.test(x.text)).length, 3);
  assert.equal(of(R.analyze(['En effet, a. En effet, b.']), 'tic').length, 0);
});
t('connecteurs absents dans un long paragraphe', () => {
  const long = Array.from({ length: 90 }, (_, i) => 'terme' + 'abcdefghij'[i % 10] + (i % 9)).join(' ') + '.';
  assert.equal(of(R.analyze([long]), 'connector').length, 1);
  assert.equal(of(R.analyze([long + ' Donc voilà.']), 'connector').length, 0);
  assert.equal(of(R.analyze(['Court paragraphe sans rien.']), 'connector').length, 0);
});
t('« je pense que » et variantes, désactivable', () => {
  const f = of(R.analyze(['Je pense que la vérité existe. À mon avis, c’est faux. J’estime que oui.']), 'jepense');
  assert.equal(f.length, 3);
  assert.equal(of(R.analyze(['Je pense que oui.'], { firstPerson: false }), 'jepense').length, 0);
});
t('offsets cohérents avec le texte (apostrophes typographiques)', () => {
  const p = 'L’homme, de nos jours, ne pense pas.';
  const f = R.analyze([p]).find((x) => x.cat === 'tic');
  assert.equal(p.slice(f.from, f.to), f.text);
  assert.equal(f.text, 'de nos jours');
});
t('performance : 20 000 mots', () => {
  const para = 'La raison humaine cherche la vérité ; cependant elle se trompe souvent et rarement elle doute. '.repeat(8);
  const ps = Array.from({ length: 150 }, () => para);
  const t0 = performance.now();
  R.analyze(ps);
  const ms = performance.now() - t0;
  console.log('   ', Math.round(ms), 'ms pour', ps.join(' ').split(/\s+/).length, 'mots');
  assert.ok(ms < 1500);
});
console.log(`\n${ok} tests passés`);
