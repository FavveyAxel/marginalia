// Test B3 : fiche-texte (panneau) + plans de dissertation. Port 5213.
// Lancer : timeout 170 node scripts/test-plans.mjs
import assert from 'node:assert/strict';
import { withApp, importFixture, shot } from './harness.mjs';

const PORT = 5213;
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};

const hl = (id, bookId, category, text, chapter, start, loc, extra = {}) => ({
  id, bookId, category, text, note: '', noteKind: null, conceptIds: [],
  anchor: { kind: 'html', chapter, start, end: start + text.length, prefix: '', suffix: '' },
  locationLabel: loc, printedPage: '', createdAt: 1000 + start, updatedAt: 1000 + start, ...extra,
});

async function seed(page, bookId) {
  await page.evaluate((bookId) => {
    const s = window.__store;
    const mk = (id, bookId, category, text, chapter, start, loc, extra = {}) => ({
      id, bookId, category, text, note: '', noteKind: null, conceptIds: [],
      anchor: { kind: 'html', chapter, start, end: start + text.length, prefix: '', suffix: '' },
      locationLabel: loc, printedPage: '', createdAt: 1000 + start, updatedAt: 1000 + start, ...extra,
    });
    const highlights = [
      mk('h1', bookId, 'probleme', 'Comment savoir si l’on ne rêve pas ?', 3, 10, 'Quatrième partie', { printedPage: '60' }),
      mk('h2', bookId, 'these', 'je pense, donc je suis, était si ferme et si assurée', 3, 200, 'Quatrième partie', { printedPage: '62' }),
      mk('h3', bookId, 'argument', 'Les sens nous trompent quelquefois', 3, 90, 'Quatrième partie', { printedPage: '61' }),
      mk('h4', bookId, 'exemple', 'Le morceau de cire fond près du feu', 3, 400, 'Quatrième partie'),
      mk('h5', bookId, 'objection', 'Les sceptiques doutent de tout', 2, 20, 'Seconde partie'),
    ];
    const rect = [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }];
    s.setState({
      highlights,
      concepts: [
        { id: 'c1', name: 'Cogito', definition: 'Certitude première de l’existence du sujet pensant.', senses: [], links: [], programme: null, createdAt: 1, updatedAt: 1 },
        { id: 'c2', name: 'Liberté', definition: 'Pouvoir d’agir sans contrainte.', senses: [], links: [], programme: 'notion', createdAt: 2, updatedAt: 2 },
      ],
      arguments: [
        { id: 'a1', title: 'Argument du rêve', bookId, premises: [{ id: 'p1', text: 'Je rêve parfois', highlightId: null, implicit: false }], conclusion: { id: 'cc', text: 'Les sens ne sont pas sûrs', highlightId: null, implicit: false }, comment: '', createdAt: 1, updatedAt: 1 },
      ],
      studies: [{
        id: 's1', bookId, title: 'Quatrième partie, le cogito', probleme: '', these: '', enjeu: '',
        movements: [
          { id: 'm3', anchor: { kind: 'html', chapter: 3, start: 900, end: 920, prefix: '', suffix: '' }, startText: 'Enfin, considérant que toutes les mêmes pensées', title: 'Mouvement 3', role: '' },
          { id: 'm1', anchor: { kind: 'html', chapter: 3, start: 10, end: 30, prefix: '', suffix: '' }, startText: 'Je ne sais si je dois vous entretenir', title: 'Mouvement 1', role: '' },
          { id: 'm2', anchor: { kind: 'html', chapter: 3, start: 400, end: 420, prefix: '', suffix: '' }, startText: 'Mais aussitôt après je pris garde que', title: 'Mouvement 2', role: '' },
        ],
        createdAt: 5, updatedAt: 5,
      }],
    });
  }, bookId);
}

// Enveloppe createDraftImpl (impl.ts réel, transformé par Vite) : enregistre l'appel ; mode piloté par window.__draftMode.
const WRAP = `
export async function createDraftImpl(o){
  window.__sent = o;
  if (window.__draftMode === 'ko') throw new Error('indisponible');
  if (window.__draftMode === 'real') return __realCreateDraftImpl(o);
  const d={id:'d-test',title:o.title,fileName:'x',externalPath:null,wordCount:0,template:o.template??null,createdAt:1,updatedAt:1};
  window.__store.setState({drafts:[...window.__store.getState().drafts,d]}); return d;
}`;

async function run(dark) {
  const tag = dark ? 'sombre' : 'clair';
  await withApp(PORT, async (page, errors) => {
    // Court-circuite l'éditeur (impl.ts) : enregistre ce qui est transmis.
    await page.route('**/features/editor/impl.ts*', async (r) => {
      const res = await r.fetch();
      let body = await res.text();
      body = body.replace('export async function createDraftImpl(', 'async function __realCreateDraftImpl(') + WRAP;
      await r.fulfill({ response: res, body });
    });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const bookId = await importFixture(page, 'fixtures/discours.md', { open: false });
    ok(`[${tag}] livre importé`, !!bookId);
    await page.evaluate(() => window.__store.getState().updateBook(window.__store.getState().books[0].id, { title: 'Discours de la méthode', author: 'René Descartes', edition: { publisher: 'GF Flammarion', year: '2000', translator: '', place: '', pageOffset: 0 } }));
    await seed(page, bookId);

    // ═══ A. Fiche-texte (banc dédié) ═══
    const theme = dark ? 'dark' : 'light';
    await page.evaluate(() => { const s = window.__store.getState(); window.__saved = { studies: s.studies }; });
    const storeState = await page.evaluate(() => { const s = window.__store.getState(); return { books: s.books, highlights: s.highlights, studies: s.studies }; });
    await page.goto(`http://localhost:${PORT}/scripts/plans-harness.html?theme=${theme}`);
    await page.waitForFunction(() => window.__store);
    await page.evaluate((st) => window.__store.setState({ ...st, studies: [] }), storeState);
    await page.waitForSelector('.study-empty');
    ok(`[${tag}] fiche : état vide explique M`, (await page.locator('.study-empty').innerText()).includes('M'));
    await shot(page, `shots/plans/01-fiche-vide-${tag}.png`);
    await page.evaluate((st) => window.__store.setState({ studies: st.studies }), storeState);
    await page.waitForSelector('.study-move');
    const titles = await page.locator('.study-move-title').evaluateAll((els) => els.map((e) => e.value));
    ok(`[${tag}] mouvements dans l'ordre du texte`, (await page.locator('.study-move').evaluateAll((els) => els.map((e) => e.dataset.mid))).join() === 'm1,m2,m3', titles.join());
    // édition
    await page.fill('#study-probleme', 'Comment échapper au doute ?');
    await page.fill('#study-these', 'Le cogito résiste à tout doute.');
    await page.fill('#study-enjeu', 'Fonder la connaissance.');
    let st = await page.evaluate(() => window.__store.getState().studies[0]);
    ok(`[${tag}] sauvegarde auto problème/thèse/enjeu`, st.probleme === 'Comment échapper au doute ?' && st.these.startsWith('Le cogito') && st.enjeu === 'Fonder la connaissance.');
    // Remplir depuis les extraits
    await page.fill('#study-these', '');
    await page.click('[data-field="these"] .study-fill');
    ok(`[${tag}] propose les extraits de la catégorie Thèse`, (await page.locator('[data-testid="pick-these"] .study-pick-item').count()) === 1);
    await page.click('[data-testid="pick-these"] .study-pick-item');
    st = await page.evaluate(() => window.__store.getState().studies[0]);
    ok(`[${tag}] remplir depuis extrait`, st.these.includes('je pense, donc je suis'));
    await page.fill('#study-these', 'Le cogito résiste à tout doute.');
    // titre + rôle + suggestions
    await page.fill('[data-mid="m1"] .study-move-title', 'Poser le doute');
    await page.focus('[data-mid="m1"] .study-role-input');
    ok(`[${tag}] suggestions de rôle`, (await page.locator('.study-suggest .menu-item').count()) === 7);
    await page.locator('.study-suggest .menu-item', { hasText: 'pose le problème' }).dispatchEvent('mousedown');
    await page.fill('[data-mid="m2"] .study-role-input', 'argumente');
    await page.fill('[data-mid="m3"] .study-role-input', 'conclut');
    await page.fill('[data-mid="m3"] .study-move-title', 'Retour au monde');
    st = await page.evaluate(() => window.__store.getState().studies[0]);
    ok(`[${tag}] titre et rôle enregistrés`, st.movements.find((m) => m.id === 'm1').title === 'Poser le doute' && st.movements.find((m) => m.id === 'm1').role === 'pose le problème');
    const plan = await page.locator('[data-testid="study-plan"] li').allInnerTexts();
    ok(`[${tag}] plan généré (3 lignes, I. II. III.)`, plan.length === 3 && plan[0].startsWith('I.') && plan[0].includes('Poser le doute') && plan[0].includes('(pose le problème)') && plan[0].includes('« Je ne sais si') && plan[2].startsWith('III.'), plan.join(' | '));
    await page.evaluate(() => document.querySelector('.study-panel').scrollTo(0, 0));
    await shot(page, `shots/plans/02-fiche-${tag}.png`);
    // copie
    await page.getByRole('button', { name: 'Copier le plan' }).click();
    await page.waitForFunction(() => window.__store.getState().toasts.some((t) => t.message.includes('copié') || t.message.includes('copier')));
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    const copied = await page.evaluate(() => window.__store.getState().toasts.map((t) => t.message).join('|'));
    ok(`[${tag}] copie du plan (toast)`, copied.includes('Plan copié'), copied);
    if (clip !== null) ok(`[${tag}] presse-papiers contient le plan`, clip.includes('I. Poser le doute (pose le problème)') && clip.includes('III. Retour au monde (conclut)'), clip);
    // aller au début d'un mouvement
    await page.click('[data-mid="m2"] .study-move-start');
    const goto = await page.evaluate(() => window.__goto);
    ok(`[${tag}] clic mouvement -> onGoTo(anchor)`, goto.length === 1 && goto[0].chapter === 3 && goto[0].start === 400);
    // supprimer un mouvement (confirmation)
    await page.hover('[data-mid="m2"]');
    await page.click('[data-mid="m2"] .study-move-del');
    await page.getByRole('button', { name: 'Supprimer', exact: true }).first().click();
    ok(`[${tag}] suppression d'un mouvement`, (await page.evaluate(() => window.__store.getState().studies[0].movements.length)) === 2);
    await page.evaluate((st) => window.__store.setState({ studies: st.studies }), storeState);  // remet 3 mouvements vierges
    // Envoyer vers l'éditeur (le banc n'a pas le stub : route déjà posée sur le contexte)
    await page.evaluate(() => { window.__store.getState().patch('studies', 's1', { probleme: 'Comment échapper au doute ?', these: 'Le cogito résiste.', enjeu: 'Fonder la connaissance.' }); });
    await page.getByRole('button', { name: /Envoyer vers l’éditeur/ }).click();
    await page.waitForFunction(() => window.__sent);
    const sentS = await page.evaluate(() => window.__sent);
    ok(`[${tag}] fiche -> createDraft (modèle explication, h1/problème/thèse/enjeu/3 h2)`, sentS.template === 'explication' && sentS.html.includes('<h1>Quatrième partie, le cogito</h1>') && /Problème\.<\/strong> Comment/.test(sentS.html) && sentS.html.includes('Enjeu') && (sentS.html.match(/<h2>/g) || []).length === 3, sentS.html);
    const route = await page.evaluate(() => window.__store.getState().route);
    ok(`[${tag}] navigation vers write`, route.name === 'write' && route.draftId === 'd-test');

    // ═══ B. Plans (app complète) ═══
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready);
    await page.evaluate(() => { document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; });
    let bid = await page.evaluate(() => window.__store.getState().books[0]?.id);
    if (!bid) bid = await importFixture(page, 'fixtures/discours.md', { open: false });
    await page.evaluate(() => window.__store.getState().updateBook(window.__store.getState().books[0].id, { title: 'Discours de la méthode', author: 'René Descartes', edition: { publisher: 'GF Flammarion', year: '2000', translator: '', place: '', pageOffset: 0 } }));
    ok(`[${tag}] livre disponible`, !!bid);
    await seed(page, bid);
    await page.evaluate(() => { window.__store.setState({ studies: [], drafts: [], plans: [] }); window.__store.getState().navigate({ name: 'plans', planId: null }); });
    await page.waitForSelector('.plan-empty');
    ok(`[${tag}] liste vide : état vide`, (await page.locator('.plan-empty h3').innerText()).includes('Aucun plan'));
    await shot(page, `shots/plans/03-liste-vide-${tag}.png`);
    await page.getByRole('button', { name: 'Nouveau plan' }).first().click();
    await page.waitForSelector('.plan-sujet');
    ok(`[${tag}] nouveau plan créé et ouvert`, (await page.evaluate(() => window.__store.getState().plans.length)) === 1);
    await page.fill('.plan-sujet', 'La liberté est-elle une illusion ?');
    await page.fill('#plan-def', 'Liberté : pouvoir d’agir sans contrainte.\nIllusion : apparence trompeuse.');
    await page.fill('#plan-prob', 'Peut-on se croire libre sans l’être ?');
    await page.fill('#plan-concl', 'La liberté se conquiert plus qu’elle ne se possède.');
    // parties
    await page.getByTestId('add-part').first().click();
    await page.fill('[data-nid] .plan-node-title >> nth=0', 'La liberté semble illusoire');
    await page.getByTestId('add-part').last().click();
    await page.waitForFunction(() => window.__store.getState().plans[0].parts.length === 2);
    await page.locator('.plan-node-title').nth(1).fill('Mais elle se construit');
    await page.locator('.plan-node-note').nth(0).fill('Nos actes sont déterminés.');
    // sous-parties
    await page.locator('[data-testid="add-sub"]').first().click();
    await page.locator('.plan-node.depth-1 .plan-node-title').first().fill('Le déterminisme');
    await page.locator('[data-testid="add-sub"]').first().click(); // 1ère partie (dépôt cible)
    let pl = await page.evaluate(() => window.__store.getState().plans[0]);
    ok(`[${tag}] 2 parties, sous-parties`, pl.parts.length === 2 && pl.parts[0].children.length === 2 && pl.parts[0].children[0].title === 'Le déterminisme');
    ok(`[${tag}] sujet / définitions / problématique enregistrés`, pl.sujet.startsWith('La liberté') && pl.definitions.includes('Illusion') && pl.problematique.startsWith('Peut-on'));
    await page.locator('.plan-node.depth-1 .plan-node-title').nth(1).fill('La nécessité des désirs');
    // réordonner : descendre la 1re sous-partie
    await page.locator('[data-nid="' + pl.parts[0].children[0].id + '"] > .plan-node-head [aria-label="Descendre"]').click();
    pl = await page.evaluate(() => window.__store.getState().plans[0]);
    ok(`[${tag}] réordonner (descendre)`, pl.parts[0].children[1].title === 'Le déterminisme');
    // glisser-déposer d'extraits et concept
    await page.waitForSelector('.plan-res-item');
    const target0 = '[data-nid="' + pl.parts[0].children[1].id + '"]';
    await page.locator('[data-rid="h3"]').dragTo(page.locator(target0));
    await page.locator('[data-rid="h2"]').dragTo(page.locator('[data-nid="' + pl.parts[1].id + '"]'));
    await page.locator('[data-tab="concept"]').click();
    await page.locator('[data-rid="c1"]').dragTo(page.locator('[data-nid="' + pl.parts[1].id + '"]'));
    await page.locator('[data-tab="argument"]').click();
    await page.locator('[data-rid="a1"]').dragTo(page.locator(target0));
    pl = await page.evaluate(() => window.__store.getState().plans[0]);
    const kinds = (n) => n.items.map((i) => i.ref.kind + ':' + (i.ref.id ?? '')).join();
    ok(`[${tag}] dépôt extrait + argument (sous-partie)`, kinds(pl.parts[0].children[1]) === 'highlight:h3,argument:a1', kinds(pl.parts[0].children[1]));
    ok(`[${tag}] dépôt extrait + concept (partie II)`, kinds(pl.parts[1]) === 'highlight:h2,concept:c1', kinds(pl.parts[1]));
    // bouton + (cible = partie sélectionnée), recherche, filtre
    await page.locator('[data-tab="highlight"]').click();
    await page.fill('.plan-res-search input', 'cire');
    ok(`[${tag}] recherche ressources`, (await page.locator('.plan-res-item').count()) === 1);
    await page.locator('[data-nid="' + pl.parts[1].id + '"] > .plan-node-head .plan-node-title').click();
    await page.locator('[data-rid="h4"] .plan-res-add').click();
    pl = await page.evaluate(() => window.__store.getState().plans[0]);
    ok(`[${tag}] bouton + ajoute à la partie ciblée`, pl.parts[1].items.length === 3 && pl.parts[1].items[2].ref.id === 'h4');
    await page.fill('.plan-res-search input', 'zzzz');
    ok(`[${tag}] ressources : aucun résultat`, (await page.locator('.plan-res-empty').innerText()).includes('Aucun résultat'));
    await page.fill('.plan-res-search input', '');
    // texte libre
    await page.locator('[data-nid="' + pl.parts[0].id + '"] > .plan-node-foot .plan-link').first().click();
    await page.keyboard.type('Transition vers la partie II');
    await page.keyboard.press('Enter');
    pl = await page.evaluate(() => window.__store.getState().plans[0]);
    ok(`[${tag}] texte libre`, pl.parts[0].items.some((i) => i.ref.kind === 'text' && i.ref.text.startsWith('Transition')));
    // retirer un élément
    const before = pl.parts[1].items.length;
    await page.locator('[data-iid="' + pl.parts[1].items[2].id + '"]').hover();
    await page.locator('[data-iid="' + pl.parts[1].items[2].id + '"] .plan-item-x').click();
    pl = await page.evaluate(() => window.__store.getState().plans[0]);
    ok(`[${tag}] retrait d'un élément`, pl.parts[1].items.length === before - 1);
    await page.mouse.move(5, 5);
    await page.evaluate(() => document.querySelector('.plan-scroll').scrollTo(0, 0));
    await shot(page, `shots/plans/04-editeur-${tag}.png`);
    // survol de dépôt (capture pendant glisser)
    await page.locator('[data-tab="highlight"]').click();
    const src = page.locator('[data-rid="h1"]');
    const dst = page.locator('[data-nid="' + pl.parts[0].children[0].id + '"]');
    const sb = await src.boundingBox(); const db = await dst.boundingBox();
    await page.mouse.move(sb.x + 40, sb.y + 12);
    await page.mouse.down();
    await page.mouse.move(db.x + 60, db.y + 40, { steps: 8 });
    ok(`[${tag}] retour visuel au survol de dépôt`, (await page.locator('.plan-node.over').count()) >= 1);
    await shot(page, `shots/plans/05-depot-survol-${tag}.png`);
    await page.mouse.up();

    // ── Envoyer vers l'éditeur : échec propre, puis succès ──
    await page.evaluate(() => { window.__draftMode = 'ko'; });
    await page.evaluate(() => (window.__store.setState({ toasts: [] })));
    await page.getByTestId('plan-send').click();
    await page.waitForFunction(() => window.__store.getState().toasts.some((t) => t.tone === 'error'));
    ok(`[${tag}] échec createDraft : toast d'erreur, plan intact`, (await page.evaluate(() => window.__store.getState().plans[0].draftId)) === null);
    await page.evaluate(() => { window.__draftMode = 'stub'; });
    await page.evaluate(() => { window.__sent = null; window.__store.setState({ toasts: [] }); });
    await page.getByTestId('plan-send').click();
    await page.waitForFunction(() => window.__sent);
    const sent = await page.evaluate(() => window.__sent);
    const h = sent.html;
    ok(`[${tag}] HTML : h1 sujet, introduction, h2/h3, conclusion`, h.includes('<h1>La liberté est-elle une illusion ?</h1>') && h.includes('<h2>Introduction</h2>') && h.includes('<h2>I. La liberté semble illusoire</h2>') && h.includes('<h3>A. ') && h.includes('<h2>II. Mais elle se construit</h2>') && h.includes('<h2>Conclusion</h2>'), h);
    ok(`[${tag}] HTML : citation en blockquote + note de bas de page`, h.includes('<blockquote><p>Les sens nous trompent quelquefois<span data-footnote="René Descartes, Discours de la méthode, GF Flammarion, 2000, p. 61."></span>'), h);
    ok(`[${tag}] HTML : idée directrice, concept, texte libre`, h.includes('Nos actes sont déterminés.') && h.includes('Concept : Cogito.') && h.includes('Transition vers la partie II'));
    ok(`[${tag}] modèle dissertation + titre`, sent.template === 'dissertation' && sent.title === 'La liberté est-elle une illusion ?');
    pl = await page.evaluate(() => window.__store.getState().plans[0]);
    ok(`[${tag}] draftId mémorisé`, pl.draftId === 'd-test');
    await page.waitForSelector('.toasts >> text=Ouvrir l’écrit').catch(() => {});
    await page.waitForSelector('.plan-editor-view [data-testid="plan-send"]');
    ok(`[${tag}] bouton « Ouvrir l’écrit » proposé`, (await page.getByRole('button', { name: 'Ouvrir l’écrit' }).count()) >= 1);
    await shot(page, `shots/plans/06-apres-envoi-${tag}.png`);
    // Sonde informative : createDraft réel (module Éditeur) avec le HTML du plan (non bloquant).
    const real = await page.evaluate(async (html) => {
      window.__draftMode = 'real';
      try { const m = await import('/src/features/editor/api.ts'); const d = await m.createDraft({ title: 'Sonde', template: 'dissertation', html }); return 'ok ' + d.id; }
      catch (e) { return 'échec : ' + (e && e.message); } finally { window.__draftMode = 'stub'; }
    }, h);
    console.log(`  info [${tag}] createDraft réel :`, real);

    // ── Liste, recherche, suppression ──
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await page.waitForSelector('.plan-card');
    ok(`[${tag}] liste : carte du plan`, (await page.locator('.plan-card-title').first().innerText()).includes('La liberté'));
    await shot(page, `shots/plans/07-liste-${tag}.png`);
    await page.fill('.plan-list-inner .plan-search-input', 'xyz');
    ok(`[${tag}] recherche de plans : aucun résultat`, (await page.locator('.plan-empty h3').innerText()).includes('Aucun résultat'));
    await page.fill('.plan-list-inner .plan-search-input', 'liberté');
    await page.locator('.plan-card').click();
    await page.waitForSelector('.plan-sujet');
    await page.getByLabel('Supprimer le plan').click();
    ok(`[${tag}] confirmation maison (pas de dialogue natif)`, (await page.getByTestId('plan-del-yes').count()) === 1);
    await page.getByTestId('plan-del-yes').click();
    ok(`[${tag}] plan supprimé`, (await page.evaluate(() => window.__store.getState().plans.length)) === 0);
    const rem = errors.filter((e) => !/Failed to load resource|indisponible|PlanEditor.tsx:96|createDraft|impl.ts:93/.test(e));
    ok(`[${tag}] aucune erreur navigateur`, rem.length === 0, rem.join('\n'));
  }, { dark });
}

await run(false);
await run(true);
console.log(`\n${passed} vérifications passées`);
