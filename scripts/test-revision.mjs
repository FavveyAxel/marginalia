// Test B4 : Révision (générateur, plafond par livre, session FSRS, annulation, useDueCount). Port 5214.
// Lancer : timeout 170 node scripts/test-revision.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5214;
const DAY = 86_400_000;
const MIN = 60_000;
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};
const eq = (name, a, b) => {
  assert.deepEqual(a, b, `ÉCHEC : ${name} — obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`);
  passed++;
  console.log('  ok', name);
};

// ── FSRS côté Node (référence indépendante du code de l'app) ──
const f = fsrs();
const toCard = (s) => ({ ...s, due: new Date(s.due), last_review: s.last_review == null ? undefined : new Date(s.last_review) });
const ser = (c) => ({ due: c.due.getTime(), stability: c.stability, difficulty: c.difficulty, elapsed_days: c.elapsed_days, scheduled_days: c.scheduled_days, learning_steps: c.learning_steps, reps: c.reps, lapses: c.lapses, state: c.state, last_review: c.last_review ? c.last_review.getTime() : null });
function fmt(ms) {
  const m = ms / MIN;
  if (m < 1) return '< 1 min';
  if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)} j`;
  if (d < 365) return `${String(Math.round((d / 30.44) * 10) / 10).replace('.', ',')} mois`;
  const y = Math.round((d / 365.25) * 10) / 10;
  return `${String(y).replace('.', ',')} ${y >= 2 ? 'ans' : 'an'}`;
}
const reviewedState = (ageDays) => {
  const t = Date.now() - ageDays * DAY;
  let c = createEmptyCard(t);
  c = f.next(c, t, Rating.Good).card;
  c = f.next(c, t + 11 * MIN, Rating.Good).card;
  return ser(c);
};
const newState = () => ser(createEmptyCard(Date.now()));

// ── Données de test ──
function buildSeed() {
  const book = (id, title, author, year) => ({
    id, title, author, format: 'epub', fileName: 'source.epub', originalName: `${id}.epub`, size: 1, addedAt: 1, lastOpenedAt: null, progress: 0, position: null, cover: null,
    edition: { publisher: 'GF Flammarion', year, translator: '', place: '', pageOffset: 0 },
  });
  const hl = (id, bookId, category, text, loc, page, conceptIds = []) => ({
    id, bookId, category, text, note: '', noteKind: null, conceptIds,
    anchor: { kind: 'html', chapter: 1, start: 0, end: text.length, prefix: '', suffix: '' }, locationLabel: loc, printedPage: page, createdAt: 1000 + Number(id.slice(1)), updatedAt: 1000,
  });
  const books = [book('bA', 'Discours de la méthode', 'René Descartes', '2000'), book('bB', 'Éthique', 'Baruch Spinoza', '2018')];
  const highlights = [
    hl('h1', 'bA', 'concept', 'Le bon sens est la chose du monde la mieux partagée.', 'Première partie', '35', ['c1']),
    hl('h2', 'bA', 'these', 'Je pense, donc je suis, était si ferme et si assurée.', 'Quatrième partie', '62'),
    hl('h3', 'bA', 'argument', 'Les sens nous trompent quelquefois.', 'Quatrième partie', '61'),
    hl('h4', 'bA', 'exemple', 'Le morceau de cire fond près du feu.', 'Seconde méditation', ''),
    hl('h5', 'bB', 'these', 'Les hommes se croient libres parce qu’ils ignorent les causes de leurs actions.', 'Livre I, appendice', '97'),
    hl('h6', 'bB', 'concept', 'Par cause de soi, j’entends ce dont l’essence enveloppe l’existence.', 'Définition 1', '15', ['c2']),
  ];
  const concepts = [
    { id: 'c1', name: 'Cogito', definition: 'Certitude première de l’existence du sujet pensant.', senses: [{ id: 's1', author: 'Descartes', bookId: 'bA', definition: 'La pensée qui s’éprouve elle-même comme existante.', highlightIds: ['h2'] }], links: [], programme: null, createdAt: 1, updatedAt: 1 },
    { id: 'c2', name: 'Liberté', definition: 'Pouvoir d’agir sans contrainte.', senses: [{ id: 's2', author: 'Spinoza', bookId: 'bB', definition: 'Agir par la seule nécessité de sa nature.', highlightIds: [] }], links: [], programme: 'notion', createdAt: 2, updatedAt: 2 },
  ];
  const card = (id, kind, front, back, bookId, fsrsState, extra = {}) => ({
    id, kind, front, back, highlightId: null, conceptId: null, bookId, suspended: false, fsrs: fsrsState, createdAt: 5000 + Number(id.replace(/\D/g, '')), ...extra,
  });
  const cards = [
    // dues (6) : 4 chez Descartes, 2 chez Spinoza
    card('d1', 'definition', 'Définir « sens commun » (selon Descartes)', 'Le bon sens est la chose du monde la mieux partagée.', 'bA', reviewedState(12), { highlightId: 'h1' }),
    card('d2', 'these', 'Quelle est la thèse de Descartes dans le Discours, quatrième partie ?', 'Je pense, donc je suis.', 'bA', reviewedState(11), { highlightId: 'h2' }),
    card('d3', 'libre', 'Quel est le premier principe de la philosophie cartésienne ?', 'Le cogito.', 'bA', reviewedState(10)),
    card('d4', 'definition', 'Définir « cause de soi » (selon Spinoza)', 'Ce dont l’essence enveloppe l’existence.', 'bB', reviewedState(9), { highlightId: 'h6', conceptId: 'c2' }),
    card('d5', 'these', 'Quelle est la thèse de Spinoza sur la liberté ?', 'Les hommes se croient libres par ignorance des causes.', 'bB', reviewedState(8), { highlightId: 'h5' }),
    card('d6', 'libre', 'Qu’appelle-t-on doute hyperbolique ?', 'Le doute étendu à toute connaissance, même mathématique.', 'bA', reviewedState(7)),
    // futures (non dues) pour « prochaine échéance »
    card('f1', 'libre', 'Future 1', 'x', 'bA', reviewedState(1.2)),
    card('f2', 'libre', 'Future 2', 'x', 'bB', reviewedState(1.2)),
    // suspendues (jamais proposées)
    card('x1', 'libre', 'Suspendue due', 'x', 'bA', reviewedState(12), { suspended: true }),
    card('x2', 'libre', 'Suspendue neuve', 'x', 'bA', newState(), { suspended: true }),
  ];
  // 14 nouvelles cartes pour Descartes : de quoi dépasser le plafond (10)
  for (let i = 1; i <= 14; i++) cards.push(card(`n${i}`, 'libre', `Question neuve ${i} (Descartes)`, `Réponse ${i}`, 'bA', newState()));
  return { books, highlights, concepts, cards };
}

async function withServer(fn) {
  const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-rev', server: { port: PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    await fn(browser);
  } finally {
    await browser.close();
    await server.close();
  }
}

async function shot(page, name) {
  await page.evaluate(() => window.__store.setState({ toasts: [] }));
  await page.waitForTimeout(250);
  const out = `shots/revision/${name}.png`;
  fs.mkdirSync(path.dirname(path.resolve(ROOT, out)), { recursive: true });
  await page.screenshot({ path: path.resolve(ROOT, out) });
  console.log('capture:', out);
}

const storeCards = (page) => page.evaluate(() => window.__store.getState().cards);
const badge = async (page) =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('Révision'));
    const c = el && el.querySelector('.count');
    return c ? Number(c.textContent) : 0;
  });
const testid = async (page, id) => Number(await page.locator(`[data-testid=${id}]`).first().innerText());
const stripMd = (s) => s.replace(/\[…\]/g, '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();

/** Attendu indépendant : dues + Σ par livre min(plafond, nouvelles de ce livre) (aucune carte introduite aujourd'hui). */
const expectedCount = (cards, cap) => {
  const end = new Date(); end.setHours(23, 59, 59, 999);
  const live = cards.filter((c) => !c.suspended);
  const due = live.filter((c) => c.fsrs.state !== 0 && c.fsrs.due <= end.getTime()).length;
  const per = {};
  for (const c of live) if (c.fsrs.state === 0) per[c.bookId ?? ''] = (per[c.bookId ?? ''] ?? 0) + 1;
  return { due, fresh: Object.values(per).reduce((a, n) => a + Math.min(cap, n), 0) };
};

async function scenario(browser, theme) {
  const dark = theme === 'dark';
  console.log(`\n── Scénario ${theme} ──`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  const notFound = [];
  page.on('response', (r) => r.status() === 404 && notFound.push(r.url()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
  const seed = buildSeed();
  const S = (n) => `${theme}-${n}`;

  // 0. Aucune carte : état vide
  await page.evaluate((d) => {
    window.__store.setState({ books: d.books, highlights: d.highlights, concepts: d.concepts, cards: [], settings: { ...window.__store.getState().settings, theme: d.theme } });
    window.__store.getState().navigate({ name: 'revision' });
  }, { ...seed, theme: dark ? 'dark' : 'light' });
  await page.waitForSelector('.rev-empty');
  ok('état vide sans carte (explique la création)', (await page.locator('.rev-empty').innerText()).includes('menu d’un extrait'));
  eq('useDueCount = 0 sans carte', await badge(page), 0);
  await page.waitForTimeout(500);
  await shot(page, S('00-vide'));

  // 1. Générateur
  await page.getByRole('tab', { name: 'Créer des cartes' }).click();
  await page.waitForSelector('.rev-create');
  // Définition (livre Descartes) : ligne de l'extrait h1
  await page.locator('.rev-src-row', { hasText: 'Le bon sens est la chose' }).click();
  const defFront = await page.locator('.rev-src.open textarea').first().inputValue();
  eq('définition : recto « Définir « X » (selon Auteur) »', defFront, 'Définir « Cogito » (selon René Descartes)');
  await page.waitForTimeout(300);
  await shot(page, S('02-generateur'));
  await page.locator('.rev-src.open').getByRole('button', { name: 'Créer la carte' }).click();
  let cards = await storeCards(page);
  let c1 = cards.find((c) => c.highlightId === 'h1');
  ok('carte définition créée (liée à l’extrait, au concept et au livre)', c1 && c1.kind === 'definition' && c1.conceptId === 'c1' && c1.bookId === 'bA' && c1.fsrs.state === 0 && c1.fsrs.reps === 0);
  // Définition issue du sens d'un concept
  const senseRow = page.locator('.rev-src', { hasText: 'Sens de « Cogito »' });
  await senseRow.locator('.rev-src-row').click();
  const senseFront = await senseRow.locator('textarea').first().inputValue();
  eq('définition (sens) : « Définir « Cogito » (selon Descartes) »', senseFront, 'Définir « Cogito » (selon Descartes)');
  await senseRow.getByRole('button', { name: 'Créer la carte' }).click();
  // Thèse
  await page.getByRole('tab', { name: 'Thèse', exact: true }).click();
  await page.locator('.rev-src-row', { hasText: 'Je pense, donc je suis' }).click();
  const theseFront = await page.locator('.rev-src.open textarea').first().inputValue();
  eq('thèse : recto avec auteur, titre en italique et lieu', theseFront, 'Quelle est la thèse de René Descartes dans *Discours de la méthode*, Quatrième partie ?');
  await page.locator('.rev-src.open').getByRole('button', { name: 'Créer la carte' }).click();
  // Texte à trous
  await page.getByRole('tab', { name: 'Texte à trous' }).click();
  await page.locator('.rev-src-row', { hasText: 'Les sens nous trompent' }).click();
  ok('trous : « Créer » désactivé sans mot masqué', await page.locator('.rev-src.open').getByRole('button', { name: 'Créer la carte' }).isDisabled());
  await page.locator('.rev-word', { hasText: /^sens$/ }).click();
  await page.locator('.rev-word', { hasText: /^trompent$/ }).click();
  const trousFront = await page.locator('.rev-src.open textarea').first().inputValue();
  const trousBack = await page.locator('.rev-src.open textarea').nth(1).inputValue();
  eq('trous : recto masque les mots choisis', trousFront, 'Les […] nous […] quelquefois.');
  eq('trous : verso met les mots en gras', trousBack, 'Les **sens** nous **trompent** quelquefois.');
  await page.waitForTimeout(300);
  await shot(page, S('03-generateur-trous'));
  await page.locator('.rev-src.open').getByRole('button', { name: 'Créer la carte' }).click();
  // Citation
  await page.getByRole('tab', { name: 'Citation' }).click();
  await page.locator('.rev-src-row', { hasText: 'Le morceau de cire' }).click();
  const citFront = await page.locator('.rev-src.open textarea').first().inputValue();
  ok('citation : « Qui a écrit : … ? »', citFront.startsWith('Qui a écrit : « Le morceau de cire') && citFront.endsWith('» ?'));
  await page.locator('.rev-src.open').getByRole('button', { name: 'Créer la carte' }).click();
  // Concept : sens de Liberté chez Spinoza
  await page.getByRole('button', { name: 'Un concept' }).click();
  await page.locator('select[aria-label=Concept]').selectOption('c2');
  await page.getByRole('tab', { name: 'Définition' }).click();
  await page.locator('.rev-src-row', { hasText: 'Sens de « Liberté » selon Spinoza' }).click();
  await page.locator('.rev-src.open').getByRole('button', { name: 'Créer la carte' }).click();
  // Libre
  await page.getByRole('tab', { name: 'Libre' }).click();
  await page.locator('.rev-free textarea').first().fill('Que signifie « sapere aude » ?');
  await page.locator('.rev-free textarea').nth(1).fill('Ose te servir de ton propre entendement.');
  await page.locator('.rev-free select').selectOption('bA');
  await page.locator('.rev-free').getByRole('button', { name: 'Créer la carte' }).click();
  cards = await storeCards(page);
  eq('7 cartes créées par le générateur (déf., sens, thèse, trous, citation, sens Spinoza, libre)', cards.length, 7);
  eq('types créés', cards.map((c) => c.kind).sort(), ['citation', 'definition', 'definition', 'definition', 'libre', 'these', 'trous']);
  const sp = cards.find((c) => c.bookId === 'bB');
  ok('carte issue du sens Spinoza rattachée au livre et au concept', sp && sp.conceptId === 'c2' && sp.front === 'Définir « Liberté » (selon Spinoza)');

  // 2. Liste des cartes (recherche, suspension, édition, suppression)
  await page.getByRole('tab', { name: /Toutes les cartes/ }).click();
  await page.waitForSelector('.rev-item');
  eq('liste : 7 cartes', await page.locator('.rev-item').count(), 7);
  await page.locator('.rev-search input').fill('cire');
  eq('recherche « cire » : 1 résultat (sans accent sensible)', await page.locator('.rev-item').count(), 1);
  await page.locator('.rev-search input').fill('');
  await page.locator('.rev-item', { hasText: 'sapere aude' }).getByLabel('Suspendre la carte').click();
  ok('suspendre une carte', (await storeCards(page)).find((c) => c.kind === 'libre').suspended === true);
  await page.locator('.rev-item', { hasText: 'sapere aude' }).getByLabel('Reprendre la carte').click();
  await page.locator('.rev-item', { hasText: 'sapere aude' }).getByLabel('Modifier la carte').click();
  await page.locator('.rev-edit textarea').first().fill('Que signifie « sapere aude » chez Kant ?');
  await page.locator('.rev-edit').getByRole('button', { name: 'Enregistrer' }).click();
  ok('éditer une carte', (await storeCards(page)).some((c) => c.front === 'Que signifie « sapere aude » chez Kant ?'));
  await page.waitForTimeout(400);
  await shot(page, S('04-liste'));
  await page.locator('.rev-item', { hasText: 'sapere aude' }).getByLabel('Supprimer la carte').click();
  await page.locator('.rev-item', { hasText: 'sapere aude' }).getByRole('button', { name: 'Supprimer', exact: true }).click();
  eq('supprimer une carte (confirmation en ligne)', (await storeCards(page)).length, 6);

  // 3. Jeu de cartes complet (générées + dues + nouvelles)
  await page.evaluate((cs) => {
    const s = window.__store.getState();
    s.setState?.({});
    window.__store.setState({ cards: [...window.__store.getState().cards, ...cs] });
    window.__jumped = null;
    window.__store.setState({ jumpToHighlight: (id) => { window.__jumped = id; } });
  }, seed.cards);
  cards = await storeCards(page);
  await page.getByRole('tab', { name: 'Aujourd’hui' }).click();
  await page.waitForSelector('.rev-today');
  let cap = await page.evaluate(() => window.__store.getState().settings.newCardsPerBook);
  eq('plafond par défaut', cap, 10);
  let exp = expectedCount(cards, cap);
  eq('compte « à revoir » (dues non suspendues)', await testid(page, 'due'), exp.due);
  eq('compte « nouvelles » (plafond 10 par livre)', await testid(page, 'fresh'), exp.fresh);
  ok('plafond effectif : Descartes a plus de 10 nouvelles mais n’en propose que 10', cards.filter((c) => c.bookId === 'bA' && c.fsrs.state === 0 && !c.suspended).length > 10 && exp.fresh === 10 + 1);
  eq('useDueCount (badge) = dues + nouvelles autorisées', await badge(page), exp.due + exp.fresh);
  // plafond modifiable : 3 par livre
  for (let i = 0; i < 7; i++) await page.getByLabel('Diminuer').click();
  cap = await page.evaluate(() => window.__store.getState().settings.newCardsPerBook);
  eq('stepper de plafond (10 → 3)', cap, 3);
  exp = expectedCount(cards, cap);
  eq('nouvelles avec plafond 3', await testid(page, 'fresh'), exp.fresh);
  eq('badge réactif au plafond', await badge(page), exp.due + exp.fresh);
  ok('plafond 3 → 3 (Descartes) + 1 (Spinoza)', exp.fresh === 4);
  for (let i = 0; i < 7; i++) await page.getByLabel('Augmenter').click();
  exp = expectedCount(cards, 10);
  eq('plafond remis à 10', await badge(page), exp.due + exp.fresh);
  // réactif au store : suspendre une carte due
  await page.evaluate(() => { const s = window.__store.getState(); s.patch('cards', 'd1', { suspended: true }); });
  eq('badge réactif à la suspension', await badge(page), exp.due + exp.fresh - 1);
  await page.evaluate(() => window.__store.getState().patch('cards', 'd1', { suspended: false }));
  eq('badge réactif à la reprise', await badge(page), exp.due + exp.fresh);
  await page.waitForTimeout(500);
  await shot(page, S('01-accueil'));
  // filtre par livre
  await page.locator('select[aria-label="Filtrer par livre"]').selectOption('bB');
  const filt = expectedCount(cards.filter((c) => c.bookId === 'bB'), 10);
  eq('filtre livre : à revoir', await testid(page, 'due'), filt.due);
  eq('filtre livre : nouvelles', await testid(page, 'fresh'), filt.fresh);
  await page.locator('select[aria-label="Filtrer par livre"]').selectOption('');

  const total = exp.due + exp.fresh;

  // 4. Échap quitte la session
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Enter');
  await page.waitForSelector('.rev-card');
  ok('Entrée lance la session', (await page.locator('.rev-count').innerText()).trim() === `1 / ${total}`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.rev-today');
  ok('Échap quitte la session', true);

  // 5. Session complète
  await page.getByRole('button', { name: /Commencer/ }).click();
  await page.waitForSelector('.rev-card');
  const sequence = [];
  let again = false;
  let linkTested = false;
  let undoTested = false;
  let step = 0;
  const readCard = async () => {
    const txt = (await page.locator('.rev-front').innerText()).replace(/\s+/g, ' ').trim();
    const all = await storeCards(page);
    return all.find((c) => stripMd(c.front) === txt);
  };
  while (!(await page.locator('.rev-finish').count())) {
    step++;
    assert.ok(step < 60, 'session sans fin');
    const card = await readCard();
    ok(`carte ${step} reconnue dans le store`, !!card, await page.locator('.rev-front').innerText());
    sequence.push({ id: card.id, isNew: card.fsrs.state === 0, bookId: card.bookId, due: card.fsrs.due });
    ok(`carte ${step} : verso masqué avant la réponse`, (await page.locator('.rev-answer').count()) === 0 && (await page.locator('.rev-grades').count()) === 0);
    if (step === 1) await shot(page, S('05-recto'));
    await page.keyboard.press('Space');
    await page.waitForSelector('.rev-grades');
    // intervalles prévus = ts-fsrs
    const now = Date.now();
    const rec = f.repeat(toCard(card.fsrs), now);
    const expected = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].map((g) => fmt(rec[g].card.due.getTime() - now));
    const shown = await page.locator('.rev-grade-int').allInnerTexts();
    eq(`carte ${step} : intervalles affichés (${expected.join(' / ')})`, shown, expected);
    if (step === 1) {
      await shot(page, S('06-verso'));
      if (card.highlightId) ok('verso : source = référence formatée + page imprimée', /René Descartes, Discours de la méthode, GF Flammarion, 2000, p\. 35/.test(await page.locator('.rev-source').innerText()));
    }
    if (card.highlightId !== undefined && !linkTested && card.id !== 'x' && (await page.locator('.rev-link').count())) {
      await page.locator('.rev-link').click();
      const j = await page.evaluate(() => window.__jumped);
      const stCard = (await storeCards(page)).find((c) => c.id === card.id);
      eq('« Ouvrir le passage » appelle jumpToHighlight', j, stCard.highlightId);
      linkTested = true;
    }
    let key;
    if (step === 1) key = '3';
    else if (step === 2 && !again) key = '1';
    else if (card.fsrs.state === 0) key = '4';
    else key = '3';
    const idx = Number(key) - 1;
    const before = card.fsrs;
    const queueBefore = (await page.locator('.rev-count').innerText()).trim();
    const tRate = Date.now();
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
    const after = (await storeCards(page)).find((c) => c.id === card.id).fsrs;
    const exp1 = ser(f.next(toCard(before), after.last_review, [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy][idx]).card);
    eq(`carte ${step} : état FSRS stocké = ts-fsrs (note ${key})`, { ...after }, { ...exp1 });
    ok(`carte ${step} : last_review ≈ maintenant`, Math.abs(after.last_review - tRate) < 3000);
    ok(`carte ${step} : réps +1`, after.reps === before.reps + 1);
    if (step === 1 && !undoTested) {
      // ⌘Z : restaure l'état et revient sur la carte, réponse affichée
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(60);
      const restored = (await storeCards(page)).find((c) => c.id === card.id).fsrs;
      eq('⌘Z restaure l’état FSRS de la carte', restored, before);
      eq('⌘Z revient à la carte 1', (await page.locator('.rev-count').innerText()).trim(), queueBefore);
      ok('⌘Z : réponse à nouveau affichée', (await page.locator('.rev-grades').count()) === 1);
      undoTested = true;
      await page.keyboard.press('3');
      await page.waitForTimeout(60);
      sequence.pop();
      sequence.push({ id: card.id, isNew: false, bookId: card.bookId, due: card.fsrs.due });
    }
    if (step === 2 && !again) {
      // « À revoir » : la carte revient en fin de file (total + 1) ; ⌘Z retire ce doublon
      const cnt = (await page.locator('.rev-count').innerText()).trim();
      eq('« À revoir » ajoute la carte en fin de file', cnt, `3 / ${total + 1}`);
      await page.keyboard.press('Meta+z');
      await page.waitForTimeout(60);
      eq('⌘Z (Meta) retire la carte ajoutée en fin de file', (await page.locator('.rev-count').innerText()).trim(), `2 / ${total}`);
      eq('⌘Z restaure la carte revue', (await storeCards(page)).find((c) => c.id === card.id).fsrs, before);
      again = true;
      await page.keyboard.press('1');
      await page.waitForTimeout(60);
      eq('« À revoir » à nouveau : file + 1', (await page.locator('.rev-count').innerText()).trim(), `3 / ${total + 1}`);
    }
    await page.waitForTimeout(40);
  }
  // ordre : dues d'abord, puis nouvelles ; livres alternés
  const firstNew = sequence.findIndex((s) => s.isNew);
  ok('ordre : les dues avant les nouvelles', sequence.slice(0, firstNew).every((s) => !s.isNew) && firstNew === exp.due, `firstNew=${firstNew}`);
  const dues = sequence.slice(0, firstNew).map((s) => s.due);
  eq('ordre : dues triées par échéance', dues, [...dues].sort((a, b) => a - b));
  ok('nouvelles : livres alternés (Descartes, Spinoza, Descartes…)', sequence[firstNew].bookId !== sequence[firstNew + 1].bookId, JSON.stringify(sequence.slice(firstNew, firstNew + 3).map((s) => s.bookId)));
  ok('« Ouvrir le passage » testé', linkTested);

  // Fin de session
  await page.waitForSelector('.rev-finish');
  const fin = await page.locator('.rev-finish').innerText();
  ok('fin : score « n / m retenues », durée et prochaine échéance', /\d+\s*\/\s*\d+ retenues/.test(fin) && fin.includes('Durée') && fin.includes('Prochaine échéance'), fin);
  ok('fin : un seul bouton', (await page.locator('.rev-finish button').count()) === 1);
  await page.waitForTimeout(500);
  await shot(page, S('07-fin'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.rev-today');

  // 6. Après la session : plafond par jour respecté, rien à réviser
  cards = await storeCards(page);
  exp = expectedCount(cards.filter((c) => c.fsrs.state === 0), 10);
  const introA = cards.filter((c) => c.bookId === 'bA' && c.fsrs.state !== 0 && c.fsrs.elapsed_days === 0 && c.fsrs.lapses === 0 && c.fsrs.last_review > Date.now() - 3600_000).length;
  ok('10 nouvelles de Descartes introduites aujourd’hui (plafond du jour)', introA >= 10, `introA=${introA}`);
  eq('après la session : aucune nouvelle proposée (plafond du jour atteint)', await testid(page, 'fresh'), 0);
  const dueNow = await testid(page, 'due');
  const dueExp = cards.filter((c) => !c.suspended && c.fsrs.state !== 0 && c.fsrs.due <= new Date().setHours(23, 59, 59, 999)).length;
  eq('après la session : « à revoir » = cartes encore dues aujourd’hui', dueNow, dueExp);
  ok('nouvelles en attente signalées', (await page.locator('.rev-waiting').innerText()).includes('en attente'));
  eq('badge = dues restantes', await badge(page), dueExp);
  ok('série de jours ≥ 1 (aujourd’hui compte)', parseInt(await page.locator('[data-testid=streak]').innerText(), 10) >= 1);
  await page.waitForTimeout(400);
  await shot(page, S('08-accueil-apres'));

  // 7. Rien à réviser aujourd'hui : on reporte les échéances à demain
  await page.evaluate(() => {
    const st = window.__store.getState();
    for (const c of st.cards) if (c.fsrs.state !== 0 && !c.suspended) st.patch('cards', c.id, { fsrs: { ...c.fsrs, due: Date.now() + 2 * 86400000 } });
  });
  await page.waitForSelector('.rev-rest');
  ok('rien à réviser : prochaine échéance indiquée', (await page.locator('.rev-rest').innerText()).includes('Prochaine échéance'));
  eq('badge absent quand rien à réviser', await badge(page), 0);
  await shot(page, S('09-rien-aujourdhui'));

  if (notFound.length) console.log('  (404 hors module Révision :', notFound.join(', '), ')');
  ok('aucune ressource 404 du module Révision', !notFound.some((u) => /revision/.test(u)));
  const real = errors.filter((e) => !/favicon|Outdated Optimize|Failed to load resource/.test(e));
  eq('aucune erreur navigateur', real, []);
  await ctx.close();
}

await withServer(async (browser) => {
  await scenario(browser, 'light');
  await scenario(browser, 'dark');
});
console.log(`\n${passed} vérifications passées`);
