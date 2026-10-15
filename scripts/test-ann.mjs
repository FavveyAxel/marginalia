// Test A5 (Annotations & navigation). Port 5205. Lancer : timeout 170 node scripts/test-ann.mjs
import assert from 'node:assert/strict';
import { withApp, importFixture, shot } from './harness.mjs';

const PORT = 5205;
const results = [];
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const P1 = 'Le bon sens est la chose du monde la mieux partagée';
const P2 = 'la diversité de nos opinions ne vient pas de ce que les uns sont plus raisonnables que les autres';
const P3 = 'Le premier était de ne recevoir jamais aucune chose pour vraie que je ne la connusse évidemment être telle';
const P4 = 'diviser chacune des difficultés que j’examinerais, en autant de parcelles qu’il se pourrait';
const P5 = 'Et remarquant que cette vérité : je pense, donc je suis, était si ferme et si assurée, que toutes les plus extravagantes suppositions des sceptiques n’étaient pas capables de l’ébranler';
const P6 = 'je pouvais feindre que je n’avais aucun corps, et qu’il n’y avait aucun monde ni aucun lieu où je fusse';
const P7 = 'On objectera peut-être que le doute lui-même suppose un langage et une tradition que la méthode prétend suspendre.';
const P8 = 'je connus de là que j’étais une substance dont toute l’essence ou la nature n’est que de penser';
const P9 = 'J’ai été nourri aux lettres dès mon enfance, et parce qu’on me persuadait que par leur moyen on pouvait acquérir une connaissance claire et assurée';
const P10 = 'ne comprendre rien de plus en mes jugements que ce qui se présenterait si clairement et si distinctement à mon esprit';

/** Injecte livre (avec édition), extraits et concepts. Renvoie les ids. */
async function seed(page, bookId, withHighlights = true) {
  return page.evaluate(
    ({ bookId, withHighlights, texts }) => {
      const S = window.__store;
      const now = Date.now();
      const html = (chapter, start, text) => ({ kind: 'html', chapter, start, end: start + text.length, prefix: '', suffix: '' });
      S.getState().updateBook(bookId, {
        title: 'Discours de la méthode',
        author: 'René Descartes',
        edition: { publisher: 'GF Flammarion', year: '2000', translator: '', place: '', pageOffset: 0 },
      });
      const cpt = (id, name) => ({ id, name, definition: '', senses: [], links: [], programme: null, createdAt: now, updatedAt: now });
      S.setState({ concepts: [cpt('c-cogito', 'Cogito'), cpt('c-evidence', 'Évidence')] });
      if (!withHighlights) return {};
      const H = (n, category, text, o) => ({
        id: 'h' + n,
        bookId,
        category,
        text,
        note: '',
        noteKind: null,
        conceptIds: [],
        anchor: html(o.ch, o.start, text),
        locationLabel: o.loc,
        printedPage: o.page ?? '',
        createdAt: now - (11 - n) * 3600_000,
        updatedAt: now - (11 - n) * 3600_000,
        ...(o.extra ?? {}),
      });
      const hs = [
        H(1, 'probleme', texts[0], { ch: 0, start: 10, loc: 'Première partie', page: '35' }),
        H(2, 'these', texts[1], { ch: 0, start: 400, loc: 'Première partie', page: '35', extra: { note: 'Autrement dit : le désaccord ne vient pas d’une inégalité de raison mais de l’usage qu’on en fait.', noteKind: 'reformulation' } }),
        H(3, 'argument', texts[8], { ch: 0, start: 900, loc: 'Des études', page: '36', extra: { conceptIds: ['c-evidence'] } }),
        H(4, 'concept', texts[2], { ch: 1, start: 300, loc: 'Seconde partie', page: '47', extra: { conceptIds: ['c-evidence'], note: 'La règle d’évidence : ne rien admettre que de clair et distinct.', noteKind: null } }),
        H(5, 'argument', texts[3], { ch: 1, start: 800, loc: 'Seconde partie', page: '47' }),
        H(6, 'exemple', texts[9], { ch: 1, start: 1200, loc: 'Seconde partie', page: '48' }),
        H(7, 'these', texts[4], { ch: 2, start: 400, loc: 'Quatrième partie', page: '62', extra: { conceptIds: ['c-cogito'], note: 'Pourquoi « donc » : est-ce une inférence ou une intuition ?', noteKind: 'question' } }),
        H(8, 'objection', texts[6], { ch: 2, start: 900, loc: 'Quatrième partie', page: '62', extra: { note: 'Présuppose que le langage est neutre.', noteKind: 'presuppose' } }),
        H(9, null, texts[5], { ch: 2, start: 1100, loc: 'Quatrième partie', page: '62', extra: { note: 'Je ne suis pas sûr que « feindre » suffise à fonder une existence : critique à développer.', noteKind: 'critique' } }),
        H(10, null, texts[7], { ch: 2, start: 1500, loc: 'Quatrième partie', page: '63', extra: { conceptIds: ['c-cogito'], note: 'Une substance, vraiment ? Le saut est rapide.', noteKind: 'question' } }),
      ];
      S.setState({ highlights: hs });
      return {};
    },
    { bookId, withHighlights, texts: [P1, P2, P3, P4, P5, P6, P7, P8, P9, P10] },
  );
}

async function run(dark) {
  const tag = dark ? 'sombre' : 'clair';
  await withApp(
    PORT,
    async (page, errors) => {
      const bookId = await importFixture(page, 'fixtures/discours.md', { open: false });
      assert.ok(bookId, 'livre importé');
      await seed(page, bookId, false);

      // ── 1. Panneau Extraits : vide ──
      await page.evaluate((id) => window.__store.getState().openBook(id), bookId);
      await page.waitForSelector('.reader-side-body');
      await page.waitForSelector('.ann-empty');
      ok(`[${tag}] état vide : légende 6 catégories + H + N + M`, (await page.locator('.ann-legend li').count()) === 9);
      ok(`[${tag}] état vide : touches 1-6, H, N, M`, (await page.locator('.ann-legend .kbd').allTextContents()).join('') === '123456HNM');
      await shot(page, `shots/ann/01-extraits-vide-${tag}.png`);

      // ── 2. Rempli ──
      await seed(page, bookId, true);
      await page.waitForSelector('.ann-card');
      ok(`[${tag}] 10 cartes`, (await page.locator('.ann-card').count()) === 10);
      ok(`[${tag}] compteur « 10 extraits »`, (await page.locator('.ann-count').innerText()).includes('10'));
      const order = await page.locator('.ann-card').evaluateAll((els) => els.map((e) => e.dataset.hid));
      ok(`[${tag}] ordre du texte`, order.join(',') === 'h1,h2,h3,h4,h5,h6,h7,h8,h9,h10', order.join(','));
      ok(`[${tag}] note « ma voix » : Note · Question`, (await page.locator('[data-hid="h10"] .ann-card-cat').innerText()).toLowerCase().includes('note · question'));
      ok(`[${tag}] page imprimée affichée`, (await page.locator('[data-hid="h7"] .ann-card-loc').innerText()).includes('p. 62'));
      ok(`[${tag}] puces de concepts`, (await page.locator('[data-hid="h7"] .ann-concept').innerText()) === 'Cogito');
      await shot(page, `shots/ann/02-extraits-rempli-${tag}.png`);

      // tri récents
      await page.click('.ann-sort button:has-text("Récents")');
      const rec = await page.locator('.ann-card').evaluateAll((els) => els.map((e) => e.dataset.hid));
      ok(`[${tag}] tri récents`, rec[0] === 'h10' && rec[9] === 'h1', rec.join(','));
      await page.click('.ann-sort button:has-text("Texte")');

      // ── 3. Filtré ──
      await page.click('.ann-chip[data-filter="these"]');
      await page.click('.ann-chip[data-filter="note"]');
      const f = await page.locator('.ann-card').evaluateAll((els) => els.map((e) => e.dataset.hid));
      ok(`[${tag}] filtre multi (Thèse + Notes)`, f.join(',') === 'h2,h7,h9,h10', f.join(','));
      ok(`[${tag}] compteur filtré « 4 sur 10 »`, /4\s+sur 10/.test(await page.locator('.ann-count').innerText()));
      await shot(page, `shots/ann/03-extraits-filtre-${tag}.png`);
      await page.fill('.ann-search-input', 'DONC');
      ok(`[${tag}] recherche (insensible casse)`, (await page.locator('.ann-card').count()) === 1);
      await page.fill('.ann-search-input', 'evidence');
      await page.click('.ann-chip[data-filter="these"]');
      await page.click('.ann-chip[data-filter="note"]');
      ok(`[${tag}] recherche sans accent → concept « Évidence »`, (await page.locator('.ann-card').count()) === 2);
      await page.fill('.ann-search-input', '');

      // ── 4. Actif + clic ──
      await page.locator('[data-hid="h8"]').click();
      let st = await page.evaluate(() => window.__store.getState().activeHighlightId);
      ok(`[${tag}] clic carte → activeHighlightId`, st === 'h8', String(st));
      ok(`[${tag}] carte active mise en évidence`, await page.locator('[data-hid="h8"].active').count() === 1);
      await page.locator('[data-hid="h4"]').click();
      await sleep(600);
      await page.locator('[data-hid="h4"]').hover();
      await shot(page, `shots/ann/04-extraits-actif-${tag}.png`);
      // défilement vers la carte active
      await page.evaluate(() => {
        window.__store.getState().setActiveHighlight(null);
        document.querySelector('.ann-list').scrollTop = 0;
      });
      await page.evaluate(() => window.__store.getState().setActiveHighlight('h10'));
      await sleep(700);
      const vis = await page.evaluate(() => {
        const c = document.querySelector('[data-hid="h10"]').getBoundingClientRect();
        const l = document.querySelector('.ann-list').getBoundingClientRect();
        return c.top >= l.top - 1 && c.bottom <= l.bottom + 1;
      });
      ok(`[${tag}] carte active défilée dans la vue`, vis);

      // actions : carte, copie, suppression
      await page.evaluate(() => {
        window.__copied = null;
        navigator.clipboard.writeText = async (t) => {
          window.__copied = t;
        };
      });
      await page.locator('[data-hid="h6"]').hover();
      await page.locator('[data-hid="h6"] button[title="Copier la citation"]').click();
      const copied = await page.evaluate(() => window.__copied);
      ok(`[${tag}] copier la citation (formatCitation)`, copied && copied.startsWith('« ne comprendre rien') && copied.includes('René Descartes, Discours de la méthode, GF Flammarion, 2000, p. 48'), copied ?? 'null');
      await page.locator('[data-hid="h6"] button[title="Ajouter à la carte d’argument"]').click();
      const nodes = await page.evaluate((id) => window.__store.getState().maps[id]?.nodes.map((n) => n.highlightId), bookId);
      ok(`[${tag}] ajouter à la carte`, nodes && nodes.includes('h6'), JSON.stringify(nodes));
      await page.locator('[data-hid="h5"]').hover();
      await page.locator('[data-hid="h5"] button[title="Supprimer"]').click();
      ok(`[${tag}] supprimer (+ toast Annuler)`, (await page.evaluate(() => window.__store.getState().highlights.length)) === 9 && (await page.evaluate(() => window.__store.getState().toasts.some((t) => t.action?.label === 'Annuler'))));
      await page.evaluate(() => window.__store.getState().toasts.find((t) => t.action)?.action.run());
      ok(`[${tag}] annuler la suppression`, (await page.evaluate(() => window.__store.getState().highlights.length)) === 10);

      // ── 5. Palette ⌘K ──
      await page.evaluate(() => {
        const S = window.__store.getState();
        S.navigate({ name: 'home' });
      });
      await page.keyboard.press('Control+k');
      await page.waitForSelector('.cmd-modal');
      ok(`[${tag}] ⌘K ouvre la palette`, true);
      ok(`[${tag}] palette vide : actions (10)`, (await page.locator('.cmd-group:has-text("Actions") ~ div .cmd-item').count()) >= 10 || (await page.locator('.cmd-item').count()) >= 10);
      await shot(page, `shots/ann/10-palette-vide-${tag}.png`);
      await page.fill('.cmd-input', 'evidence');
      await sleep(100);
      const groups = await page.locator('.cmd-group').allTextContents();
      ok(`[${tag}] palette requête « evidence » (sans accent) : Concepts + Extraits`, groups.includes('Concepts') && groups.includes('Extraits'), groups.join('|'));
      await shot(page, `shots/ann/11-palette-requete-${tag}.png`);
      await page.fill('.cmd-input', 'e');
      const nExtr = await page.locator('.cmd-group:text-is("Extraits")').evaluate((g) => {
        let n = 1;
        let el = g.parentElement.nextElementSibling;
        while (el && !el.querySelector('.cmd-group')) {
          n++;
          el = el.nextElementSibling;
        }
        return n;
      });
      ok(`[${tag}] 6 résultats max par groupe`, nExtr === 6, String(nExtr));
      await page.fill('.cmd-input', 'cogito');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await sleep(150);
      let route = await page.evaluate(() => window.__store.getState().route);
      ok(`[${tag}] ↑↓ + Entrée sur un extrait`, route.name === 'reader' || route.name === 'concepts', JSON.stringify(route));
      await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
      await page.keyboard.press('Control+k');
      await page.fill('.cmd-input', 'nouvel esp');
      await page.keyboard.press('Enter');
      await sleep(150);
      const ws = await page.evaluate(() => ({ route: window.__store.getState().route, n: window.__store.getState().workspaces.length }));
      ok(`[${tag}] Nouvel espace de travail`, ws.n === 1 && ws.route.name === 'workspace' && ws.route.groupId === null, JSON.stringify(ws));
      await page.keyboard.press('Control+k');
      await page.fill('.cmd-input', 'nouvel ecrit');
      await page.keyboard.press('Enter');
      route = await page.evaluate(() => window.__store.getState().route);
      ok(`[${tag}] Nouvel écrit`, route.name === 'write' && route.draftId === null);
      await page.keyboard.press('Control+k');
      await page.fill('.cmd-input', 'zzzzqq');
      ok(`[${tag}] aucun résultat`, (await page.locator('.cmd-none').count()) === 1);
      await page.keyboard.press('Escape');
      ok(`[${tag}] Échap ferme la palette`, (await page.locator('.cmd-modal').count()) === 0);
      await page.keyboard.press('Control+k');
      await page.fill('.cmd-input', 'basculer');
      const before = await page.evaluate(() => document.documentElement.dataset.theme);
      await page.keyboard.press('Enter');
      await sleep(150);
      const after = await page.evaluate(() => document.documentElement.dataset.theme);
      ok(`[${tag}] basculer clair/sombre`, before !== after, `${before} → ${after}`);
      await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), 'system');

      // ── 6–9. Banc : popover, sommaire, recherche, typographie ──
      const book = await page.evaluate((id) => window.__store.getState().books.find((b) => b.id === id), bookId);
      await page.goto(`http://localhost:${PORT}/scripts/ann-harness.html`);
      await page.waitForFunction(() => window.__ann && window.__store);
      await page.evaluate((b) => window.__store.setState({ books: [b] }), book);
      await seed(page, bookId, true);

      // Popover
      await page.evaluate(() => window.__ann.render({ c: 'popover', highlightId: 'h5' }));
      await page.waitForSelector('.ann-pop');
      await sleep(200);
      const cursorBox = await page.locator('.ann-pop').boundingBox();
      ok(`[${tag}] popover ~360 px`, Math.abs(cursorBox.width - 360) < 2, String(cursorBox.width));
      ok(`[${tag}] note vide → textarea focalisée`, await page.evaluate(() => document.activeElement?.classList.contains('ann-note-area')));
      await shot(page, `shots/ann/05-popover-${tag}.png`);
      // catégorie
      await page.click('.ann-cat-btn[data-cat="concept"]');
      let h = await page.evaluate(() => window.__store.getState().highlights.find((x) => x.id === 'h5'));
      ok(`[${tag}] changer la catégorie`, h.category === 'concept');
      await page.click('.ann-cat-btn[data-cat="none"]');
      h = await page.evaluate(() => window.__store.getState().highlights.find((x) => x.id === 'h5'));
      ok(`[${tag}] « Note seule » → category null`, h.category === null);
      await page.click('.ann-cat-btn[data-cat="concept"]');
      // note + type
      await page.fill('.ann-note-area', 'Une règle de méthode : diviser pour mieux résoudre, mais au risque de perdre le tout.\nÀ confronter à Spinoza.');
      await sleep(900);
      h = await page.evaluate(() => window.__store.getState().highlights.find((x) => x.id === 'h5'));
      ok(`[${tag}] note enregistrée (auto)`, h.note.startsWith('Une règle de méthode'), h.note.slice(0, 30));
      const taH = await page.locator('.ann-note-area').evaluate((e) => e.clientHeight);
      ok(`[${tag}] textarea auto-dimensionnée`, taH > 56, String(taH));
      await page.click('.ann-kind[data-kind="critique"]');
      h = await page.evaluate(() => window.__store.getState().highlights.find((x) => x.id === 'h5'));
      ok(`[${tag}] type de note enregistré`, h.noteKind === 'critique');
      // page
      await page.fill('.ann-page-input', '49-50');
      h = await page.evaluate(() => window.__store.getState().highlights.find((x) => x.id === 'h5'));
      ok(`[${tag}] page imprimée modifiée`, h.printedPage === '49-50');
      // concepts : suggestion insensible aux accents
      await page.click('.ann-concept-input');
      await page.fill('.ann-concept-input', 'evid');
      const sug = await page.locator('.ann-suggest-item').allTextContents();
      ok(`[${tag}] suggestion sans accent (« evid » → Évidence)`, sug[0] === 'Évidence' && sug.length === 2, sug.join('|'));
      await page.locator('.ann-suggest-item').first().click();
      h = await page.evaluate(() => window.__store.getState().highlights.find((x) => x.id === 'h5'));
      ok(`[${tag}] concept existant lié`, h.conceptIds.includes('c-evidence'));
      await page.fill('.ann-concept-input', 'Doute méthodique');
      const create = await page.locator('.ann-suggest-item[data-create]').innerText();
      ok(`[${tag}] « Créer « x » » proposé`, create.includes('Créer « Doute méthodique »'), create);
      await shot(page, `shots/ann/06-popover-concept-${tag}.png`);
      await page.keyboard.press('Enter');
      const sc = await page.evaluate(() => {
        const s = window.__store.getState();
        const c = s.concepts.find((x) => x.name === 'Doute méthodique');
        return { c: !!c, linked: !!c && s.highlights.find((x) => x.id === 'h5').conceptIds.includes(c.id), n: s.concepts.length };
      });
      ok(`[${tag}] concept créé et lié`, sc.c && sc.linked && sc.n === 3, JSON.stringify(sc));
      await sleep(150);
      ok(`[${tag}] puces de concepts dans le popover`, (await page.locator('.ann-concept-chip').count()) === 2);
      await page.locator('.ann-concept-chip', { hasText: 'Évidence' }).locator('.ann-concept-x').click();
      h = await page.evaluate(() => window.__store.getState().highlights.find((x) => x.id === 'h5'));
      ok(`[${tag}] retirer un concept`, !h.conceptIds.includes('c-evidence') && h.conceptIds.length === 1);
      await page.click('.ann-pop-label');
      await shot(page, `shots/ann/07-popover-complet-${tag}.png`);
      // carte de révision
      await page.click('button:has-text("Créer une carte de révision")');
      let cards = await page.evaluate(() => window.__store.getState().cards);
      ok(`[${tag}] carte de révision créée (concept → definition)`, cards.length === 1 && cards[0].kind === 'definition' && cards[0].highlightId === 'h5' && cards[0].bookId, JSON.stringify(cards[0]?.kind));
      ok(`[${tag}] carte : fsrs initial`, cards[0].fsrs.state === 0 && cards[0].fsrs.reps === 0 && cards[0].fsrs.last_review === null && typeof cards[0].fsrs.due === 'number' && cards[0].suspended === false);
      ok(`[${tag}] carte : verso = texte + référence`, cards[0].back.includes('diviser chacune') && cards[0].back.includes('René Descartes') && cards[0].back.includes('p. 49-50'), cards[0].back.slice(-80));
      await page.click('button:has-text("Créer une carte de révision")');
      ok(`[${tag}] pas de doublon de carte`, (await page.evaluate(() => window.__store.getState().cards.length)) === 1);
      // copie
      await page.evaluate(() => {
        window.__copied = null;
        navigator.clipboard.writeText = async (t) => {
          window.__copied = t;
        };
      });
      await page.click('button:has-text("Copier la citation")');
      const cp = await page.evaluate(() => window.__copied);
      ok(`[${tag}] popover : citation copiée`, cp && cp.includes('p. 49-50') && cp.endsWith(').'), cp ?? 'null');
      await page.click('button:has-text("Ajouter à la carte")');
      ok(`[${tag}] popover : ajouté à la carte`, (await page.evaluate((id) => window.__store.getState().maps[id]?.nodes.some((n) => n.highlightId === 'h5'), bookId)) === true);
      // fermeture
      await page.click('.ann-pop-quote');
      await page.click('.ann-pop');
      ok(`[${tag}] clic dedans ne ferme pas`, (await page.evaluate(() => window.__ann.closed)) === 0);
      await page.keyboard.press('Escape');
      await sleep(50);
      ok(`[${tag}] Échap ferme`, (await page.evaluate(() => window.__ann.closed)) === 1);
      await page.evaluate(() => window.__ann.render({ c: 'popover', highlightId: 'h1' }));
      await page.waitForSelector('.ann-pop');
      await sleep(100);
      await page.mouse.click(60, 400);
      await sleep(50);
      ok(`[${tag}] clic extérieur ferme`, (await page.evaluate(() => window.__ann.closed)) === 1);
      // citation → carte kind citation + suppression
      await page.evaluate(() => window.__ann.render({ c: 'popover', highlightId: 'h6' }));
      await page.waitForSelector('.ann-pop');
      await page.click('button:has-text("Créer une carte de révision")');
      cards = await page.evaluate(() => window.__store.getState().cards);
      ok(`[${tag}] catégorie exemple → carte « citation »`, cards.length === 2 && cards[1].kind === 'citation');
      await page.click('.ann-pop-del');
      const left = await page.evaluate(() => window.__store.getState().highlights.some((x) => x.id === 'h6'));
      ok(`[${tag}] supprimer depuis le popover`, !left && (await page.evaluate(() => window.__ann.closed)) === 1);
      // note simple (category null) existante : état « ma voix »
      await page.evaluate(() => window.__ann.render({ c: 'popover', highlightId: 'h9' }));
      await page.waitForSelector('.ann-pop');
      await sleep(150);
      ok(`[${tag}] note existante : pas de focus forcé`, !(await page.evaluate(() => document.activeElement?.classList.contains('ann-note-area'))));
      await shot(page, `shots/ann/08-popover-note-seule-${tag}.png`);
      await page.evaluate(() => window.__ann.render({ c: 'none' }));

      // Sommaire
      const items = [
        { id: 't1', label: 'Première partie', depth: 0, target: { kind: 'html', chapter: 0 } },
        { id: 't2', label: 'Des études', depth: 1, target: { kind: 'html', chapter: 0, fragment: 'etudes' } },
        { id: 't3', label: 'Seconde partie', depth: 0, target: { kind: 'html', chapter: 1 } },
        { id: 't4', label: 'Les quatre préceptes', depth: 1, target: { kind: 'html', chapter: 1, fragment: 'preceptes' } },
        { id: 't5', label: 'Premier précepte : l’évidence, ou comment ne rien recevoir pour vrai qui ne soit connu comme tel', depth: 2, target: { kind: 'html', chapter: 1 } },
        { id: 't6', label: 'Quatrième partie', depth: 0, target: { kind: 'html', chapter: 2 } },
      ];
      await page.evaluate((items) => window.__ann.render({ c: 'toc', items, currentLabel: 'Les quatre préceptes', progress: 0.42 }), items);
      await page.waitForSelector('.toc-panel');
      ok(`[${tag}] sommaire : élément courant`, (await page.locator('.toc-item.current').innerText()) === 'Les quatre préceptes');
      ok(`[${tag}] sommaire : 42 %`, (await page.locator('.toc-pct').innerText()) === '42 %');
      ok(`[${tag}] sommaire : indentation`, (await page.locator('.toc-item.d1').first().evaluate((e) => parseInt(getComputedStyle(e).paddingLeft))) > (await page.locator('.toc-item.d0').first().evaluate((e) => parseInt(getComputedStyle(e).paddingLeft))));
      await page.click('.toc-item:has-text("Seconde partie")');
      ok(`[${tag}] sommaire : onSelect`, (await page.evaluate(() => window.__ann.selected)) === 't3');
      await shot(page, `shots/ann/12-sommaire-${tag}.png`);
      await page.evaluate(() => window.__ann.render({ c: 'toc', items: [], currentLabel: '', progress: 0 }));
      ok(`[${tag}] sommaire : état vide`, (await page.locator('.toc-empty').count()) === 1);
      await shot(page, `shots/ann/13-sommaire-vide-${tag}.png`);

      // Recherche
      await page.evaluate(() => {
        window.__ann.log.length = 0;
        window.__ann.render({ c: 'search' });
      });
      await page.waitForSelector('.search-bar-input');
      ok(`[${tag}] recherche : champ auto-focalisé`, await page.evaluate(() => document.activeElement?.classList.contains('search-bar-input')));
      await page.keyboard.type('bon sens');
      await sleep(100);
      ok(`[${tag}] recherche différée (pas encore lancée à 100 ms)`, !(await page.evaluate(() => window.__ann.log.some((l) => l.startsWith('search:')))));
      await sleep(400);
      ok(`[${tag}] recherche lancée`, await page.evaluate(() => window.__ann.log.includes('search:bon sens')));
      ok(`[${tag}] compteur « 1 / 2 »`, (await page.locator('.search-bar-count').innerText()) === '1 / 2');
      await page.keyboard.press('Enter');
      ok(`[${tag}] Entrée → suivant`, (await page.locator('.search-bar-count').innerText()) === '2 / 2' && (await page.evaluate(() => window.__ann.log.at(-1))) === 'go:h6');
      await page.keyboard.press('Shift+Enter');
      ok(`[${tag}] Maj+Entrée → précédent`, (await page.locator('.search-bar-count').innerText()) === '1 / 2' && (await page.evaluate(() => window.__ann.log.at(-1))) === 'go:h0');
      ok(`[${tag}] correspondance en gras`, (await page.locator('.search-bar-hit strong').first().innerText()) === 'bon sens');
      await shot(page, `shots/ann/14-recherche-${tag}.png`);
      await page.click('.search-bar-hit >> nth=1');
      ok(`[${tag}] clic sur un résultat`, (await page.locator('.search-bar-count').innerText()) === '2 / 2');
      await page.keyboard.press('Escape');
      await sleep(50);
      ok(`[${tag}] Échap : clearSearch + fermeture`, (await page.evaluate(() => window.__ann.closed)) === 1 && (await page.evaluate(() => window.__ann.log.includes('clear'))));
      await page.evaluate(() => window.__ann.render({ c: 'search-null' }));
      await page.waitForSelector('.search-bar-input');
      await page.keyboard.type('sens');
      await sleep(450);
      ok(`[${tag}] engine null géré`, (await page.locator('.search-bar-note').count()) === 1);
      await shot(page, `shots/ann/15-recherche-sans-moteur-${tag}.png`);
      await page.evaluate(() => window.__ann.render({ c: 'none' }));

      // Typographie
      await page.evaluate(() => window.__ann.render({ c: 'typo' }));
      await page.waitForSelector('.typo-pop');
      await sleep(150);
      await shot(page, `shots/ann/16-typographie-${tag}.png`);
      await page.click('.typo-pop [data-theme-id="sepia"]');
      await page.click('.typo-pop button:text-is("Sans")');
      await page.focus('#typo-size');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.focus('#typo-lh');
      await page.keyboard.press('ArrowRight');
      await page.focus('#typo-measure');
      await page.keyboard.press('ArrowLeft');
      await page.click('.typo-switch');
      const s = await page.evaluate(() => window.__store.getState().settings);
      ok(`[${tag}] typographie : thème/police/taille/interligne/largeur/connecteurs`, s.theme === 'sepia' && s.fontFamily === 'sans' && s.fontSize === 21 && s.lineHeight === 1.7 && s.measure === 64 && s.showConnectors === true, JSON.stringify(s));
      ok(`[${tag}] typographie : thème appliqué en direct`, (await page.evaluate(() => document.documentElement.dataset.theme)) === 'sepia');
      await sleep(250);
      await shot(page, `shots/ann/17-typographie-sepia-${tag}.png`);
      await page.click('.typo-pop [data-theme-id="dark"]');
      await shot(page, `shots/ann/18-typographie-sombre-${tag}.png`);
      await page.click('.typo-pop [data-theme-id="system"]');
      await page.click('.typo-pop');
      ok(`[${tag}] typographie : clic dedans ne ferme pas`, (await page.evaluate(() => window.__ann.closed)) === 0);
      await page.mouse.click(300, 600);
      await sleep(50);
      ok(`[${tag}] typographie : clic extérieur ferme`, (await page.evaluate(() => window.__ann.closed)) === 1);
      await page.evaluate(() => window.__ann.render({ c: 'typo' }));
      await page.waitForSelector('.typo-pop');
      await sleep(50);
      await page.keyboard.press('Escape');
      ok(`[${tag}] typographie : Échap ferme`, (await page.evaluate(() => window.__ann.closed)) === 1);

      const real = errors.filter((e) => !/status of 404/.test(e));
      ok(`[${tag}] aucune erreur navigateur (hors 404 de ressource)`, real.length === 0, real.join(' | ').slice(0, 300));
    },
    { dark },
  );
}

await run(false);
await run(true);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
if (failed.length) {
  console.log('ÉCHECS:\n' + failed.map((f) => ' - ' + f.name).join('\n'));
  process.exit(1);
}
