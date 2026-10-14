// Test B2 : Concepts & Extraits. Lancer : timeout 170 node scripts/test-concepts.mjs
import { withApp, importFixture, shot } from './harness.mjs';

let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'ECHEC ') + m); if (!c) fails++; };

async function run(dark) {
  const sfx = dark ? 'sombre' : 'clair';
  await withApp(5212, async (page) => {
    const bookId = await importFixture(page, 'fixtures/discours.md');
    ok(!!bookId, 'livre injecté');
    const ids = await page.evaluate((bookId) => {
      const s = window.__store.getState();
      const A = (o) => s.addHighlight({ bookId, anchor: { kind: 'html', chapter: 0, start: 0, end: 5, prefix: '', suffix: '' }, locationLabel: 'Seconde partie', ...o });
      const h1 = A({ category: 'concept', text: 'La liberté consiste à agir selon la nécessité de sa propre nature.', printedPage: '42' });
      const h2 = A({ category: 'these', text: 'Je pense, donc je suis : la raison ne se trompe pas quand elle est bien conduite.', note: 'À rapprocher de la conscience de soi.', noteKind: 'reformulation', printedPage: '44' });
      const h3 = A({ category: null, text: '', note: 'Quelle liberté pour celui qui doute ?', noteKind: 'question' });
      const h4 = A({ category: 'exemple', text: 'Le bon sens est la chose du monde la mieux partagée.', printedPage: '3' });
      const lib = s.addConcept('Liberté');
      const rai = s.addConcept('Raison');
      s.toggleHighlightConcept(h4.id, rai.id);
      return { h1: h1.id, h2: h2.id, h3: h3.id, h4: h4.id, lib: lib.id, rai: rai.id };
    }, bookId);

    // ── Liste + fiche
    await page.evaluate((id) => window.__store.getState().navigate({ name: 'concepts', conceptId: id }), ids.lib);
    await page.waitForSelector('.cpt-name');
    ok((await page.inputValue('.cpt-name')) === 'Liberté', 'fiche ouverte, nom éditable');

    // Sens par auteur
    await page.click('text=Ajouter un sens');
    await page.fill('.cpt-sense [aria-label="Auteur du sens"]', 'Spinoza');
    await page.fill('.cpt-sense [aria-label="Définition du sens"]', 'Connaître la nécessité qui nous détermine.');
    await page.waitForTimeout(700);
    let c = await page.evaluate((id) => window.__store.getState().concepts.find((x) => x.id === id), ids.lib);
    ok(c.senses.length === 1 && c.senses[0].author === 'Spinoza' && c.senses[0].definition.startsWith('Connaître'), 'sens par auteur enregistré');
    await page.click('text=Ajouter un sens');
    await page.waitForTimeout(100);
    await page.locator('.cpt-sense').nth(1).locator('[aria-label="Auteur du sens"]').fill('Sartre');
    await page.locator('.cpt-sense').nth(1).locator('[aria-label="Définition du sens"]').fill('Être condamné à choisir.');
    await page.waitForTimeout(700);
    c = await page.evaluate((id) => window.__store.getState().concepts.find((x) => x.id === id), ids.lib);
    ok(c.senses.length === 2, 'second sens (modification)');
    // supprimer le second sens avec confirmation maison
    await page.locator('.cpt-sense').nth(1).locator('[aria-label="Supprimer ce sens"]').click();
    await page.click('[data-action="confirm-delete-sense"]');
    c = await page.evaluate((id) => window.__store.getState().concepts.find((x) => x.id === id), ids.lib);
    ok(c.senses.length === 1, 'suppression d’un sens');

    // Lier un extrait au sens
    await page.click('text=Lier un extrait');
    await page.locator('.cpt-pick').first().click();
    c = await page.evaluate((id) => window.__store.getState().concepts.find((x) => x.id === id), ids.lib);
    ok(c.senses[0].highlightIds.length === 1, 'extrait lié au sens');

    // Distinction réciproque : Liberté se distingue de « Libre arbitre » (nouveau)
    await page.click('text=Ajouter un lien');
    await page.fill('[aria-label="Concept à lier"]', 'Libre arbitre');
    await page.click('[data-action="create-concept"]');
    await page.fill('[aria-label="Note du nouveau lien"]', 'Le libre arbitre suppose l’indétermination.');
    await page.click('[data-action="add-link"]');
    await page.waitForSelector('.cpt-link');
    const la = await page.evaluate(() => window.__store.getState().concepts.find((x) => x.name === 'Libre arbitre')?.id);
    ok(!!la, 'concept « Libre arbitre » créé à la volée');
    await page.evaluate((id) => window.__store.getState().navigate({ name: 'concepts', conceptId: id }), la);
    await page.waitForSelector('.cpt-link[data-own="0"]');
    const recip = await page.textContent('.cpt-link[data-own="0"]');
    ok(recip.includes('Liberté') && recip.includes('indétermination'), 'distinction réciproque côté concept lié');
    await page.evaluate((id) => window.__store.getState().navigate({ name: 'concepts', conceptId: id }), ids.lib);
    await page.waitForSelector('.cpt-name');

    // Mentions : h1 contient « liberté », h3 aussi (note) ; h1 est lié via le sens
    await page.waitForSelector('[data-action="link-mention"]');
    const nBefore = await page.evaluate((id) => window.__store.getState().highlights.filter((h) => h.conceptIds.includes(id)).length, ids.lib);
    await page.locator('[data-action="link-mention"]').first().click();
    const nAfter = await page.evaluate((id) => window.__store.getState().highlights.filter((h) => h.conceptIds.includes(id)).length, ids.lib);
    ok(nAfter === nBefore + 1, 'mention liée au concept');

    // Carte de révision
    await page.fill('[aria-label="Synthèse personnelle"]', 'Pouvoir d’agir par soi-même.');
    await page.waitForTimeout(700);
    await page.click('text=Créer une carte de révision');
    const menuItem = page.locator('.cpt-menu-item', { hasText: 'Selon Spinoza' });
    if (await menuItem.count()) await menuItem.click();
    const card = await page.evaluate(() => window.__store.getState().cards[0]);
    ok(card && card.kind === 'definition' && card.front === 'Définir « Liberté » (selon Spinoza)' && card.back.startsWith('Connaître') && card.fsrs.state === 0 && card.fsrs.due > 0, 'carte de révision (front/back/fsrs)');

    await page.waitForTimeout(500);
    await shot(page, `shots/concepts/fiche-${sfx}.png`);

    // Programme : sans doublon
    await page.evaluate(() => window.__store.getState().navigate({ name: 'concepts', conceptId: null }));
    await page.waitForSelector('.cpt-list');
    await page.click('[aria-label="Plus d’actions"]');
    await page.click('text=Charger le programme de terminale');
    await page.waitForTimeout(200);
    const n1 = await page.evaluate(() => window.__store.getState().concepts.length);
    const prog = await page.evaluate(() => window.__store.getState().concepts.filter((c) => c.programme));
    ok(prog.filter((c) => c.programme === 'notion').length === 17 && prog.filter((c) => c.programme === 'repere').length === 31, 'programme : 17 notions + 31 repères');
    ok(prog.every((c) => c.programme !== 'repere' || c.definition === ''), 'repères sans définition figée');
    await page.click('[aria-label="Plus d’actions"]');
    await page.click('text=Charger le programme de terminale');
    await page.waitForTimeout(200);
    const n2 = await page.evaluate(() => window.__store.getState().concepts.length);
    ok(n1 === n2, `rechargement sans doublon (${n1} = ${n2})`);
    const libs = await page.evaluate(() => window.__store.getState().concepts.filter((c) => /libert/i.test(c.name)).length);
    ok(libs === 1, '« Liberté » existant non dupliqué par la notion « La liberté »');

    // Filtres + recherche sans accents
    await page.click('.cpt-filters >> text=Repères');
    ok((await page.locator('.cpt-row').count()) === 31, 'filtre Repères');
    await page.click('.cpt-filters >> text=Tous');
    await page.fill('[aria-label="Rechercher un concept"]', 'etat');
    ok((await page.locator('.cpt-row', { hasText: 'État' }).count()) === 1, 'recherche insensible aux accents');
    await page.fill('[aria-label="Rechercher un concept"]', '');
    await page.waitForTimeout(500);
    await shot(page, `shots/concepts/liste-${sfx}.png`);

    // Suppression avec confirmation
    await page.evaluate((id) => window.__store.getState().navigate({ name: 'concepts', conceptId: id }), ids.rai);
    await page.waitForSelector('.cpt-name');
    await page.click('text=Supprimer >> nth=0');
    await page.click('[data-action="confirm-delete"]');
    ok(!(await page.evaluate((id) => window.__store.getState().concepts.some((c) => c.id === id), ids.rai)), 'suppression de concept (confirmée)');

    // ── Vue Extraits
    await page.evaluate((id) => window.__store.getState().toggleHighlightConcept(id.h2, id.lib), ids);
    await page.evaluate(() => window.__store.getState().navigate({ name: 'extracts' }));
    await page.waitForSelector('.ax-item');
    const count = () => page.locator('.ax-item').count();
    ok((await count()) === 4, 'extraits : 4 affichés');
    await page.click('.chip[data-cat="concept"]');
    ok((await count()) === 1, 'filtre catégorie Concept');
    await page.click('.chip[data-cat="notes"]');
    ok((await count()) === 2, 'catégories multiples (Concept + Notes)');
    await page.click('text=Effacer les filtres >> nth=0');
    await page.selectOption('[aria-label="Type de note"]', 'question');
    ok((await count()) === 1, 'filtre type de note « question »');
    await page.selectOption('[aria-label="Type de note"]', '');
    await page.selectOption('[aria-label="Concept"]', ids.lib);
    ok((await count()) >= 2, 'filtre concept');
    await page.selectOption('[aria-label="Concept"]', '');
    await page.selectOption('[aria-label="Livre"]', bookId);
    ok((await count()) === 4, 'filtre livre');
    await page.fill('[aria-label="Rechercher dans les extraits"]', 'RAISON');
    ok((await count()) === 1, 'recherche insensible casse/accents');
    await page.fill('[aria-label="Rechercher dans les extraits"]', '');
    await page.click('[data-sort="texte"]');
    ok((await count()) === 4, 'tri ordre du texte');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.locator('.ax-item').first().hover();
    await page.locator('[data-action="copy-citation"]').first().click();
    await page.waitForTimeout(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    ok(clip === null || (clip.startsWith('« ') && clip.includes('p.')), 'citation copiée (format « … » (réf, p. N))');
    await page.click('.ax-main >> nth=0');
    await page.waitForTimeout(200);
    ok((await page.evaluate(() => window.__store.getState().route.name)) === 'reader', 'clic → jumpToHighlight ouvre le lecteur');
    await page.evaluate(() => window.__store.getState().navigate({ name: 'extracts' }));
    await page.waitForSelector('.ax-item');
    await page.waitForTimeout(500);
    await shot(page, `shots/concepts/extraits-${sfx}.png`);
    if (!dark) {
      await page.evaluate(() => window.__store.setState({ highlights: [] }));
      await page.waitForSelector('.empty');
      await shot(page, 'shots/concepts/extraits-vide-clair.png');
      await page.evaluate(() => window.__store.setState({ concepts: [] }));
      await page.evaluate(() => window.__store.getState().navigate({ name: 'concepts', conceptId: null }));
      await page.waitForSelector('.cpt-fullempty');
      await page.waitForTimeout(400);
      await shot(page, 'shots/concepts/concepts-vide-clair.png');
    }
  }, { dark });
}

await run(false);
await run(true);
console.log(fails ? `${fails} ÉCHEC(S)` : 'TOUT PASSE');
process.exit(fails ? 1 : 0);
