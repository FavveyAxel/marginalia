// Tests unitaires du cœur du correcteur (node pur) : node scripts/test-spell-core.mjs
import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const nspell = require('nspell');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')), 'core.mjs');
await build({ entryPoints: [path.join(ROOT, 'src/features/editor/spell/core.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const C = await import(out);
const dir = path.join(ROOT, 'node_modules/dictionary-fr');
const sp = nspell({ aff: fs.readFileSync(path.join(dir, 'index.aff')), dic: fs.readFileSync(path.join(dir, 'index.dic')) });

const fresh = () => new C.Checker(sp);
const flagged = (text, ignoreProper = true, ck = fresh()) => ck.checkText(text, { ignoreProper }).map((m) => m.word);
let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('ok -', name); };

t('noms propres en milieu de phrase ignorés (Marvel, Captain America, Call of Duty, Postman)', () => {
  const txt = 'Il lit les comics de Marvel avec Captain America, joue à Call of Duty et utilise Postman.';
  assert.deepEqual(flagged(txt), []);
  const off = flagged(txt, false);
  for (const w of ['Marvel', 'Captain', 'Postman']) assert.ok(off.includes(w), `${w} devrait être signalé quand l'option est coupée : ${off}`);
  assert.ok(off.includes('of'));
});
t('« philosofie » en milieu de phrase et « Philosofie » en début de phrase restent signalés', () => {
  assert.deepEqual(flagged('Elle aime la philosofie ancienne.'), ['philosofie']);
  assert.deepEqual(flagged('Philosofie ancienne et moderne.'), ['Philosofie']);
  assert.deepEqual(flagged('Il dit. « Philosofie ! » Puis il part.'), ['Philosofie']);
});
t('début de phrase : inconnu mais vu en milieu de phrase ailleurs dans le document → ignoré', () => {
  const ck = fresh();
  const [a, b] = ck.checkMany(['Postman l’avait pressenti.', 'On teste avec Postman chaque jour.'], { ignoreProper: true });
  assert.deepEqual(a, []);
  assert.deepEqual(b, []);
  // sans forme en milieu de phrase : signalé
  assert.deepEqual(flagged('Postman l’avait pressenti.'), ['Postman']);
  // option coupée : signalé
  assert.deepEqual(fresh().checkMany(['Postman l’avait pressenti.', 'On teste avec Postman.'], { ignoreProper: false })[0].map((m) => m.word), ['Postman']);
});
t('séquences capitalisées en début de phrase', () => {
  assert.deepEqual(flagged('Captain America arrive. Call of Duty sort demain.'), []);
  assert.deepEqual(flagged('Marvel Studios annonce.'), []);
});
t('débuts de phrase : après . ! ? … + espace, guillemet ouvrant, tiret de dialogue, début de paragraphe', () => {
  const s = C.isSentenceStart;
  assert.ok(s('Bonjour', 0));
  assert.ok(s('Fin. Marvel', 5));
  assert.ok(s('Quoi ? Marvel', 7));
  assert.ok(s('Quoi… Marvel', 6));
  assert.ok(s('Il dit. « Marvel', 10));
  assert.ok(s('— Marvel', 2));
  assert.ok(!s('Il lit Marvel', 7));
  assert.ok(!s('Il dit : « Marvel', 12));
  assert.ok(!s('Voir M. Dupont', 8));
  assert.ok(!s('par J. K. Rowling', 5));
  assert.ok(!s('fin.Marvel', 4));
});
t('élision devant nom propre : « d’Artagnan », « l’Amérique »', () => {
  assert.deepEqual(flagged('Le cheval d’Artagnan galope vers l’Amérique.'), []);
});
t('mot de liaison étranger isolé reste signalé', () => {
  assert.ok(flagged('Un mot of dans la phrase.').includes('of'));
});
t('non-régression : apostrophes, traits d’union, URL, sigles, chiffres', () => {
  const txt = 'Aujourd’hui l’homme qu’il voit, dit-il, va-t-en voir https://exemple.fr/pagge-inexistantte ou ecrire@exempple.fr, l’UNESCO en 2024 et le XVIIe siècle.';
  assert.deepEqual(flagged(txt), []);
  assert.deepEqual(flagged(txt, false), []);
  assert.deepEqual(flagged('Merleau-Ponty et Jean-Paul lisent.'), []);
  assert.deepEqual(flagged('Le mot consience est fautif.'), ['consience']);
});
t('« Ajouter au dictionnaire » avec la casse', () => {
  const ck = fresh();
  assert.deepEqual(flagged('Zorblax arrive.', false, ck), ['Zorblax']);
  ck.add('Zorblax');
  assert.deepEqual(flagged('Zorblax arrive. Puis zorblax part.', false, ck), ['zorblax']);
  assert.deepEqual(flagged('Il voit Zorblax.', false, ck), []);
  const ck2 = fresh();
  ck2.add('brouzouf');
  assert.deepEqual(flagged('Brouzouf arrive. Un brouzouf.', false, ck2), []);
});
console.log(`\n${ok} tests réussis`);
