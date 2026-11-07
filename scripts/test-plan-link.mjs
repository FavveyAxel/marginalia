// Tests unitaires du lien plan ↔ écrit (src/features/plans/planLink.ts), node pur via esbuild.
// Lancer : node scripts/test-plan-link.mjs
import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pl-')), 'pl.mjs');
await build({ entryPoints: [path.join(ROOT, 'src/features/plans/planLink.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const L = await import(out);

let ok = 0;
const t = (name, fn) => {
  fn();
  ok++;
  console.log('ok -', name);
};

const node = (id, title, children = [], extra = {}) => ({ id, title, note: '', items: [], children, ...extra });
const plan = (parts, extra = {}) => ({ id: 'p', title: 'T', sujet: 'Sujet', definitions: '', problematique: '', parts, conclusion: '', draftId: 'd', createdAt: 0, updatedAt: 0, ...extra });
const H = (level, text, words = 10) => ({ level, text, words });

// Écrit généré par le plan : h1 = sujet, h2 = parties (I., II.), h3 = sous-parties (A., B.).
const base = () =>
  plan([
    node('a', 'Le loisir conquis', [node('a1', 'La journée de huit heures'), node('a2', 'Le dimanche')]),
    node('b', 'Le loisir occupé', [node('b1', 'L’industrie du divertissement')]),
  ]);
const outline = () => [
  H(1, 'Le temps libre est-il une liberté ?', 0),
  H(2, 'Introduction', 300),
  H(2, 'I. Le loisir conquis', 50),
  H(3, 'A. La journée de huit heures', 400),
  H(3, 'B. Le dimanche', 200),
  H(2, 'II. Le loisir occupé', 20),
  H(3, "A. L'industrie du divertissement", 500),
  H(2, 'Conclusion', 100),
];

t('normTitle : sans numérotation, apostrophes ni ponctuation finale', () => {
  assert.equal(L.normTitle('II. Le loisir occupé.'), 'le loisir occupé');
  assert.equal(L.normTitle('A) L’industrie'), "l'industrie");
  assert.equal(L.normTitle('1.2 Le temps'), 'le temps');
  assert.equal(L.stripLabel('IV. Vers la fin'), 'Vers la fin');
  assert.equal(L.stripLabel('Il était une fois'), 'Il était une fois', 'un mot commençant par I n’est pas une numérotation');
});

t('niveaux : h1 seul en tête = titre du document', () => {
  assert.deepEqual(L.levelsOf(outline()), { start: 1, part: 2, sub: 3 });
  assert.deepEqual(L.levelsOf([H(1, 'Partie un'), H(2, 'a'), H(1, 'Partie deux')]), { start: 0, part: 1, sub: 2 });
});

t('correspondance par titre et mots par partie (sous-parties comprises)', () => {
  const m = L.matchPlan(base(), outline());
  assert.equal(m.byKey.get('intro'), 1);
  assert.equal(m.byKey.get('a'), 2);
  assert.equal(m.byKey.get('b1'), 6);
  assert.equal(m.byKey.get('conclusion'), 7);
  const w = L.wordsByKey(m);
  assert.equal(w.get('a'), 650);
  assert.equal(w.get('a2'), 200);
  assert.equal(w.get('b'), 520);
  assert.deepEqual(m.extra, []);
});

t('plan identique à l’écrit : rien à synchroniser', () => {
  assert.equal(L.syncPlanFromDraft(base(), outline()), null);
});

t('titre renommé dans l’écrit : la partie est retrouvée à sa place et renommée', () => {
  const o = outline();
  o[4] = H(3, 'B. Un dimanche à soi', 200);
  const parts = L.syncPlanFromDraft(base(), o);
  assert.equal(parts[0].children[1].id, 'a2');
  assert.equal(parts[0].children[1].title, 'Un dimanche à soi');
});

t('sections réordonnées dans l’écrit : le plan suit (parties et sous-parties)', () => {
  const o = outline();
  const reordered = [o[0], o[1], o[5], o[6], o[2], o[4], o[3], o[7]];
  const parts = L.syncPlanFromDraft(base(), reordered);
  assert.deepEqual(parts.map((p) => p.id), ['b', 'a']);
  assert.deepEqual(parts[1].children.map((c) => c.id), ['a2', 'a1']);
});

t('sous-partie déplacée vers une autre partie dans l’écrit', () => {
  const o = outline();
  const moved = [o[0], o[1], o[2], o[3], o[5], o[4], o[6], o[7]];
  const parts = L.syncPlanFromDraft(base(), moved);
  assert.deepEqual(parts[0].children.map((c) => c.id), ['a1']);
  assert.deepEqual(parts[1].children.map((c) => c.id), ['a2', 'b1']);
});

t('titre ajouté dans l’écrit : nouvelle partie dans le plan, au bon endroit', () => {
  const o = outline();
  o.splice(7, 0, H(2, 'III. Le loisir retrouvé', 40));
  o.splice(5, 0, H(3, 'C. Les congés payés', 80));
  const parts = L.syncPlanFromDraft(base(), o);
  assert.deepEqual(parts.map((p) => p.title), ['Le loisir conquis', 'Le loisir occupé', 'Le loisir retrouvé']);
  assert.equal(parts[0].children[2].title, 'Les congés payés');
});

t('partie du plan absente de l’écrit : gardée à sa place, signalée avec son voisin', () => {
  const p = base();
  p.parts.splice(1, 0, node('n', 'Une partie à écrire'));
  assert.equal(L.syncPlanFromDraft(p, outline()), null);
  const miss = L.missingEntries(p, outline());
  assert.deepEqual(miss.get('n'), { level: 2, after: 'I. Le loisir conquis', before: 'II. Le loisir occupé' });
  assert.equal(miss.size, 1);
});

t('sous-partie absente : créée après la sous-partie précédente', () => {
  const p = base();
  p.parts[1].children.push(node('b2', 'Le temps en miettes'));
  const miss = L.missingEntries(p, outline());
  assert.deepEqual(miss.get('b2'), { level: 3, after: "A. L'industrie du divertissement", before: 'Conclusion' });
});

t('contenu (notes, extraits, statut) gardé quand l’écrit réordonne', () => {
  const p = base();
  p.parts[0] = { ...p.parts[0], note: 'Idée', status: 'review', items: [{ id: 'i', ref: { kind: 'text', text: 'x' } }] };
  const o = outline();
  const parts = L.syncPlanFromDraft(p, [o[0], o[1], o[5], o[6], o[2], o[3], o[4], o[7]]);
  assert.equal(parts[1].note, 'Idée');
  assert.equal(parts[1].status, 'review');
  assert.equal(parts[1].items.length, 1);
});

t('pendingOrder : l’écrit ne réordonne pas le plan avant d’avoir suivi', () => {
  const o = outline();
  assert.equal(L.syncPlanFromDraft({ ...base(), pendingOrder: true }, [o[0], o[1], o[5], o[6], o[2], o[3], o[4], o[7]]), null);
});

t('ordre voulu pour l’écrit d’après le plan', () => {
  const p = base();
  p.parts.reverse();
  p.parts[1].children.reverse();
  assert.deepEqual(L.desiredOrder(p, outline()), [
    { text: 'Introduction', subs: [] },
    { text: 'II. Le loisir occupé', subs: ["A. L'industrie du divertissement"] },
    { text: 'I. Le loisir conquis', subs: ['B. Le dimanche', 'A. La journée de huit heures'] },
    { text: 'Conclusion', subs: [] },
  ]);
});

t('plan depuis les titres d’un écrit', () => {
  const parts = L.partsFromOutline(outline());
  assert.deepEqual(parts.map((p) => p.title), ['Le loisir conquis', 'Le loisir occupé']);
  assert.deepEqual(parts[0].children.map((c) => c.title), ['La journée de huit heures', 'Le dimanche']);
});

t('statuts et objectifs', () => {
  const p = base();
  p.parts[0].status = 'done';
  p.parts[0].children[0].goal = 1200;
  p.parts[0].children[1].goal = 800;
  p.parts[1].goal = 1500;
  p.introProgress = { status: 'review', goal: 500 };
  assert.deepEqual(L.statusCounts(p), { todo: 5, draft: 0, review: 1, done: 1 });
  assert.equal(L.totalGoal(p), 500 + 2000 + 1500);
});

console.log(`\n${ok} vérifications passées.`);
