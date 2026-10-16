// Centre de la carte (problématique / sujet) et branches repliées (Vite + Chromium, port 5398) :
//   modèle pur (arbre de repli, cycles, replier tout, centre ↔ idée, plan / écrit / SVG / lecture guidée,
//   rangement radial) ; interface : carte du centre, pastille « − / +N », masquage des descendantes,
//   persistance au rechargement, annulation, raccourcis ⌥↑ ⌥↓ ⌥⇧↑ ⌥⇧↓, ⌘A, menus, carte vide
//   « Poser la problématique », Tab → lien neutre, Ranger Arbre / Radial, thèmes clair et sombre.
// Lancer : timeout 300 node scripts/test-map-center.mjs        Captures : shots/map-center/
import assert from 'node:assert/strict';
import { withApp, shot } from './harness.mjs';

const PORT = 5398;
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};
const tick = (page, ms = 250) => page.waitForTimeout(ms);

const SEED = async () => {
  const { host } = await import('/src/lib/platform.ts');
  const s = window.__store.getState();
  const anchor = (start) => ({ kind: 'html', chapter: 0, start, end: start + 5, prefix: '', suffix: '' });
  const book = (id, title, author) => ({ id, title, author, format: 'epub', fileName: 'source.epub', originalName: 'x.epub', size: 1, addedAt: 1, lastOpenedAt: null, progress: 0, position: null, cover: null, edition: { translator: '', place: 'Paris', publisher: 'Vrin', year: '2000' } });
  const hl = (id, bookId, category, text, start, page) => ({ id, bookId, category, text, note: '', noteKind: null, conceptIds: [], anchor: anchor(start), locationLabel: '', printedPage: page, createdAt: 1, updatedAt: start });
  const idea = (id, text, x, y, extra = {}) => ({ id, highlightId: null, text, x, y, ...extra });
  const ext = (id, hid, x, y) => ({ id, highlightId: hid, text: '', x, y });
  const edge = (id, source, target, relation) => ({ id, source, target, relation, groupId: null });
  await host.saveDb({
    books: [book('bK', 'D’un prétendu droit de mentir par humanité', 'Emmanuel Kant'), book('bC', 'Des réactions politiques', 'Benjamin Constant')],
    highlights: [
      hl('hK1', 'bK', 'these', 'La véracité est un devoir formel de l’homme envers chacun, quelque grand inconvénient qui puisse en résulter', 10, '67'),
      hl('hC1', 'bC', 'these', 'Dire la vérité n’est un devoir qu’envers ceux qui ont droit à la vérité', 40, '123'),
      hl('hC2', 'bC', 'exemple', 'L’assassin qui demande si notre ami est réfugié chez nous', 50, '124'),
    ],
    concepts: [],
    maps: {
      'board-m': {
        id: 'board-m', kind: 'board', bookId: '', title: 'Le droit de mentir', bookIds: ['bK', 'bC'],
        nodes: [
          idea('Q', 'Peut-on avoir le droit de mentir ?', 330, -330, { kind: 'question' }),
          ext('K', 'hK1', 0, 0),
          ext('C', 'hC1', 720, 0),
          idea('A1', 'Le mensonge ruine la confiance qui fonde tout contrat', -40, 300),
          idea('A2', 'Un droit qui admet l’exception n’est plus un droit', -40, 560),
          ext('E', 'hC2', 720, 300),
        ],
        edges: [
          edge('eKQ', 'K', 'Q', 'repond'),
          edge('eCQ', 'C', 'Q', 'repond'),
          edge('eA1', 'A1', 'K', 'soutient'),
          edge('eA2', 'A2', 'A1', 'soutient'),
          edge('eE', 'E', 'C', 'illustre'),
          edge('eKC', 'K', 'C', 'oppose'),
        ],
        viewport: null, updatedAt: 9,
      },
      'board-v': { id: 'board-v', kind: 'board', bookId: '', title: 'Vide', bookIds: [], nodes: [], edges: [], viewport: null, updatedAt: 3 },
    },
    arguments: [], plans: [], drafts: [], cards: [], studies: [], bookmarks: [],
    workspaces: [], groups: [], wsItems: [],
    settings: { ...s.settings, theme: 'light' }, trash: [], activity: [],
  });
};

await withApp(
  PORT,
  async (page, errors) => {
    const S = (fn, arg) => page.evaluate(fn, arg);
    await S(SEED);
    await page.reload();
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    const mapOf = (k = 'board-m') => S((k) => window.__store.getState().maps[k], k);

    // ═══ 1. Modèle pur ═══
    const model = await S(async () => {
      const M = await import('/src/features/map/model/index.ts');
      const { layoutMap } = await import('/src/features/map/ui/layouts.ts');
      const s = window.__store.getState();
      const lk = { highlights: s.highlights, books: s.books, studies: s.studies };
      const m = s.maps['board-m'];
      const tree = M.foldTree(m);
      const out = {};
      out.roots = tree.roots;
      out.parentA2 = tree.parent.get('A2');
      out.parentK = tree.parent.get('K');
      out.descK = M.descendants(tree, 'K').sort();
      out.descQ = M.descendants(tree, 'Q').length;
      out.infoK = M.foldInfo(m).get('K');
      out.noInfoA2 = !M.foldInfo(m).has('A2');
      // Cycle sans sommet : chaque carte reste atteignable, sans boucle infinie.
      const cyc = { nodes: [{ id: 'a', highlightId: null, text: '', x: 0, y: 0 }, { id: 'b', highlightId: null, text: '', x: 0, y: 100 }, { id: 'c', highlightId: null, text: '', x: 0, y: 200 }], edges: [{ id: '1', source: 'a', target: 'b', relation: 'soutient', groupId: null }, { id: '2', source: 'b', target: 'c', relation: 'soutient', groupId: null }, { id: '3', source: 'c', target: 'a', relation: 'soutient', groupId: null }] };
      const ct = M.foldTree(cyc);
      out.cycle = { roots: ct.roots, desc: M.descendants(ct, ct.roots[0]).length };
      const cycF = M.setFolded(cyc, ct.roots[0], true);
      out.cycleHidden = [...M.foldHiddenIds(cycF)].sort();
      // Repli d'une branche, tout replier, tout déplier, déplier jusqu'à une carte.
      const f1 = M.toggleFold(m, 'K');
      out.hiddenK = [...M.foldHiddenIds(f1)].sort();
      const fa = M.foldAll(m);
      out.foldAll = fa.nodes.filter((n) => n.folded).map((n) => n.id).sort();
      out.foldAllHidden = [...M.foldHiddenIds(fa)].sort();
      out.unfoldAll = M.unfoldAll(fa).nodes.some((n) => n.folded);
      const deep = M.setFolded(M.setFolded(m, 'K', true), 'A1', true);
      out.unfoldTo = M.unfoldTo(deep, 'A2').nodes.filter((n) => n.folded).map((n) => n.id);
      // Centre.
      out.center = M.mapCenter(m)?.id;
      out.relQ = M.relationToward(m, 'Q');
      out.relK = M.relationToward(m, 'K');
      const toSubj = M.setNodeCenter(m, 'Q', 'subject');
      out.subjRels = toSubj.edges.filter((e) => e.target === 'Q').map((e) => e.relation);
      const toIdea = M.setNodeCenter(m, 'Q', null);
      out.ideaRels = toIdea.edges.filter((e) => e.target === 'Q').map((e) => e.relation);
      out.ideaKind = toIdea.nodes.find((n) => n.id === 'Q').kind ?? null;
      const back = M.setNodeCenter(toIdea, 'Q', 'question');
      out.backRels = back.edges.filter((e) => e.target === 'Q').map((e) => e.relation);
      out.noExtractCenter = M.setNodeCenter(m, 'K', 'question') === m;
      // Lecture guidée, plan, écrit.
      const steps = M.guidedReading(m, lk);
      out.steps = steps.map((st) => `${st.role}:${st.nodeId}`);
      out.cap1 = steps[1]?.caption;
      const plan = M.mapToPlan(m, lk);
      out.plan = { title: plan.title, problematique: plan.problematique, sujet: plan.sujet, parts: plan.parts.map((p) => ({ t: p.title, kids: p.children.map((c) => c.title) })) };
      const subjMap = { ...M.setNodeCenter(m, 'Q', 'subject'), nodes: M.setNodeCenter(m, 'Q', 'subject').nodes.map((n) => (n.id === 'Q' ? { ...n, text: 'Le mensonge' } : n)) };
      const plan2 = M.mapToPlan(subjMap, lk);
      out.plan2 = { title: plan2.title, sujet: plan2.sujet };
      const draft = M.mapToDraftHtml(m, lk);
      out.draft = draft.html;
      out.draft2Title = M.mapToDraftHtml(subjMap, lk).title;
      // Export SVG : le centre, la branche repliée (descendantes absentes, « +2 »).
      const svg = M.mapToSvg(M.setFolded(m, 'K', true), lk).svg;
      out.svg = { center: svg.includes('data-center="question"') && svg.includes('PROBLÉMATIQUE'), badge: svg.includes('>+2<'), noA1: !svg.includes('data-id="A1"'), noA2: !svg.includes('data-id="A2"'), rattache: M.mapToSvg(subjMap, lk).svg.includes('se rattache à') };
      // Rangement radial : pas de chevauchement, le centre au milieu.
      const size = (id) => (id === 'Q' ? { w: 380, h: 150 } : { w: 280, h: 140 });
      const lnodes = m.nodes.map((n) => ({ id: n.id, ...size(n.id), category: null, idea: !n.highlightId, textRank: null }));
      const pos = layoutMap('radial', lnodes, m.edges, 'Q', { x: 0, y: 0 });
      const boxes = lnodes.map((n) => ({ id: n.id, ...pos.get(n.id), w: n.w, h: n.h }));
      out.radialOverlap = boxes.some((a, i) => boxes.some((b, j) => i < j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
      const xs = boxes.flatMap((b) => [b.x, b.x + b.w]);
      const ys = boxes.flatMap((b) => [b.y, b.y + b.h]);
      const q = boxes.find((b) => b.id === 'Q');
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      out.radialCenter = { dx: Math.abs(q.x + q.w / 2 - cx), dy: Math.abs(q.y + q.h / 2 - cy), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      out.kcSides = Math.sign(pos.get('K').x - q.x) !== Math.sign(pos.get('C').x - q.x);
      const tpos = layoutMap('arbre', lnodes, m.edges, 'Q', { x: 0, y: 0 });
      out.treeTop = Math.min(...[...tpos.values()].map((p) => p.y)) === tpos.get('Q').y && [...tpos.entries()].every(([id, p]) => id === 'Q' || p.y > tpos.get('Q').y);
      return out;
    });
    ok('arbre : le centre est la racine, A2 → A1, K → Q', model.roots[0] === 'Q' && model.parentA2 === 'A1' && model.parentK === 'Q', JSON.stringify(model.roots));
    ok('descendantes de K : A1, A2 (s’oppose à ne crée pas de filiation)', model.descK.join() === 'A1,A2' && model.descQ === 5, JSON.stringify(model.descK));
    ok('foldInfo : K a 2 descendantes, A2 aucune', model.infoK.count === 2 && model.infoK.folded === false && model.noInfoA2);
    ok('cycle sans sommet : une racine, les deux autres dessous, repli sans boucle', model.cycle.roots.length === 1 && model.cycle.desc === 2 && model.cycleHidden.length === 2, JSON.stringify(model.cycle));
    ok('replier K masque A1 et A2', model.hiddenK.join() === 'A1,A2');
    ok('tout replier : K, A1 et C repliés (pas le centre), première couronne visible', model.foldAll.join() === 'A1,C,K' && model.foldAllHidden.join() === 'A1,A2,E', JSON.stringify(model));
    ok('tout déplier', model.unfoldAll === false);
    ok('déplier jusqu’à A2 ouvre K et A1', model.unfoldTo.length === 0, JSON.stringify(model.unfoldTo));
    ok('centre : Q ; un lien vers lui « répond à »', model.center === 'Q' && model.relQ === 'repond' && model.relK === null);
    ok('problématique → sujet : « se rattache à » ; → idée : « soutient » ; retour : « répond à »', model.subjRels.every((r) => r === 'rattache') && model.ideaRels.every((r) => r === 'soutient') && model.ideaKind === null && model.backRels.every((r) => r === 'repond'));
    ok('un extrait ne devient pas un centre', model.noExtractCenter);
    ok('lecture guidée : la problématique d’abord, puis les thèses qui y répondent', model.steps[0] === 'problematique:Q' && model.steps[1] === 'these:K' && model.steps.includes('these:C') && /répond à la problématique/.test(model.cap1), JSON.stringify(model.steps) + model.cap1);
    ok('plan : problématique = la question, une partie par thèse, arguments en sous-parties', model.plan.problematique === 'Peut-on avoir le droit de mentir ?' && model.plan.parts.length >= 2 && model.plan.parts[0].kids.length === 1 && /Le mensonge ruine/.test(model.plan.parts[0].kids[0]), JSON.stringify(model.plan));
    ok('plan d’un sujet : le sujet et le titre portent le thème', model.plan2.sujet.startsWith('Le mensonge') && model.plan2.title === 'Plan — Le mensonge', JSON.stringify(model.plan2));
    ok('écrit : la problématique en tête de l’introduction, les thèses en parties', model.draft.indexOf('<strong>Peut-on avoir le droit de mentir ?</strong>') > model.draft.indexOf('<h2>Introduction</h2>') && model.draft.indexOf('<h3>La thèse') > model.draft.indexOf('<h2>Développement</h2>') && model.draft2Title === 'Explication — Le mensonge', model.draft.slice(0, 600));
    ok('SVG : centre dessiné, branche repliée « +2 », descendantes absentes, « se rattache à »', Object.values(model.svg).every(Boolean), JSON.stringify(model.svg));
    ok('Radial : aucun chevauchement, le centre au milieu, Kant et Constant de part et d’autre', !model.radialOverlap && model.radialCenter.dx < model.radialCenter.w * 0.12 && model.radialCenter.dy < model.radialCenter.h * 0.12 && model.kcSides, JSON.stringify(model.radialCenter));
    ok('Arbre : le centre en haut', model.treeTop);

    // ═══ 2. Interface : la carte et son centre ═══
    await S(() => window.__store.getState().navigate({ name: 'board', boardId: 'board-m' }));
    await page.waitForSelector('[data-testid=map-root] .react-flow__node');
    await tick(page, 900);
    const center = page.locator('.react-flow__node[data-id="Q"] .map-center');
    ok('le centre est rendu (problématique, « ? », texte)', (await center.count()) === 1 && (await center.locator('.map-center-label').innerText()).toLowerCase().includes('problématique') && (await center.locator('.map-center-mark').innerText()) === '?' && (await center.locator('.map-center-text').innerText()).includes('droit de mentir'));
    const font = await center.locator('.map-center-text').evaluate((el) => ({ f: getComputedStyle(el).fontFamily, s: parseFloat(getComputedStyle(el).fontSize), a: getComputedStyle(el).textAlign }));
    ok('texte du centre : serif de lecture, grand, centré', font.s >= 20 && font.a === 'center' && !/caveat/i.test(font.f), JSON.stringify(font));
    const w = await center.evaluate((el) => el.getBoundingClientRect().width);
    const wK = await page.locator('.react-flow__node[data-id="K"] .map-node').evaluate((el) => el.getBoundingClientRect().width);
    ok('le centre est plus large que les autres cartes, pas de « thèse centrale » d’office', w > wK * 1.25 && (await page.locator('.map-node.central').count()) === 0, `${w} / ${wK}`);
    ok('légende : « répond à »', (await page.locator('.map-legend').innerText()).includes('répond à'));
    await shot(page, 'shots/map-center/01-probleme-clair.png');

    // ═══ 3. Replier une branche (pastille) ═══
    const visible = async () => (await page.locator('.react-flow__node').evaluateAll((els) => els.filter((e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none').map((e) => e.dataset.id))).sort().join();
    ok('toutes les cartes visibles au départ', (await visible()) === 'A1,A2,C,E,K,Q', await visible());
    await page.locator('.react-flow__node[data-id="K"]').hover();
    await tick(page, 200);
    const tog = page.locator('.react-flow__node[data-id="K"] .map-fold');
    ok('pastille « − » au survol de K', (await tog.count()) === 1 && (await tog.getAttribute('aria-expanded')) === 'true');
    ok('pas de pastille sur une feuille (A2)', (await page.locator('.react-flow__node[data-id="A2"] .map-fold').count()) === 0);
    await tog.click();
    await tick(page, 400);
    let m = await mapOf();
    ok('K replié dans les données', m.nodes.find((n) => n.id === 'K').folded === true);
    ok('A1 et A2 masqués (et leurs liens), pas supprimés', (await visible()) === 'C,E,K,Q' && m.nodes.length === 6 && (await page.locator('.react-flow__edge[data-id="eA1"]').count()) === 0, await visible());
    ok('K montre « +2 » et des cartes empilées', (await tog.innerText()).trim() === '+2' && (await page.locator('.react-flow__node[data-id="K"].map-folded').count()) === 1);
    await shot(page, 'shots/map-center/02-branche-repliee.png');

    // Annulation, puis rétablissement.
    await page.mouse.click(1300, 820);
    await page.keyboard.press('Meta+z');
    await tick(page, 400);
    m = await mapOf();
    ok('⌘Z déplie la branche', !m.nodes.find((n) => n.id === 'K').folded && (await visible()) === 'A1,A2,C,E,K,Q', await visible());
    await page.keyboard.press('Meta+Shift+z');
    await tick(page, 400);
    m = await mapOf();
    ok('⌘⇧Z la replie de nouveau', m.nodes.find((n) => n.id === 'K').folded === true);

    // ⌘A : seulement les cartes visibles ; le lasso n'atteint pas les cartes masquées.
    await page.mouse.click(1300, 820);
    await page.keyboard.press('Meta+a');
    await tick(page, 200);
    const sel = await page.locator('.react-flow__node.selected').evaluateAll((els) => els.map((e) => e.dataset.id).sort().join());
    ok('⌘A ne sélectionne que les cartes visibles', sel === 'C,E,K,Q', sel);
    await page.keyboard.press('Escape');

    // Persistance au rechargement.
    await tick(page, 1500);
    await page.reload();
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    await S(() => window.__store.getState().navigate({ name: 'board', boardId: 'board-m' }));
    await page.waitForSelector('[data-testid=map-root] .react-flow__node');
    await tick(page, 900);
    ok('le repli survit au rechargement', (await visible()) === 'C,E,K,Q' && (await page.locator('.react-flow__node[data-id="K"] .map-fold').innerText()).trim() === '+2', await visible());

    // ═══ 4. Clavier ═══
    await page.locator('.react-flow__node[data-id="K"]').click();
    await tick(page, 150);
    await page.keyboard.press('Alt+ArrowDown');
    await tick(page, 300);
    ok('⌥↓ déplie la branche choisie', !(await mapOf()).nodes.find((n) => n.id === 'K').folded && (await visible()) === 'A1,A2,C,E,K,Q');
    await page.keyboard.press('Alt+ArrowUp');
    await tick(page, 300);
    ok('⌥↑ la replie', (await mapOf()).nodes.find((n) => n.id === 'K').folded === true);
    await page.keyboard.press('Alt+ArrowDown');
    await tick(page, 200);
    await page.keyboard.press('Alt+Shift+ArrowUp');
    await tick(page, 600);
    ok('⌥⇧↑ : tout replier (le centre et sa couronne restent)', (await visible()) === 'C,K,Q', await visible());
    await shot(page, 'shots/map-center/03-tout-replie.png');
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await tick(page, 600);
    ok('⌥⇧↓ : tout déplier', (await visible()) === 'A1,A2,C,E,K,Q' && !(await mapOf()).nodes.some((n) => n.folded));

    // Menu « Centre » de la barre : Tout replier.
    await page.locator('[data-act="center"]').click();
    await tick(page, 200);
    const barMenu = await page.locator('[role="menu"]').innerText();
    ok('menu « Centre » : aller à la problématique, en faire un sujet, tout replier / déplier', /Aller à la problématique/.test(barMenu) && /En faire un sujet/.test(barMenu) && /Tout replier/.test(barMenu) && /Tout déplier/.test(barMenu), barMenu);
    await shot(page, 'shots/map-center/04-menu-centre.png');
    await page.getByRole('menuitem', { name: /Tout replier/ }).click();
    await tick(page, 500);
    ok('« Tout replier » depuis la barre', (await visible()) === 'C,K,Q');
    await page.mouse.click(1000, 120);
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await tick(page, 400);

    // ═══ 5. Menu d'une carte : centre ↔ idée, replier la branche ═══
    await page.locator('.react-flow__node[data-id="A1"]').click({ button: 'right' });
    await tick(page, 200);
    const nodeMenu = await page.locator('[role="menu"]').innerText();
    ok('menu d’une idée : replier la branche, en faire la problématique / le sujet', /Replier la branche/.test(nodeMenu) && /Faire de cette idée la problématique/.test(nodeMenu) && /Faire de cette idée le sujet/.test(nodeMenu), nodeMenu);
    await page.keyboard.press('Escape');
    await tick(page, 150);
    await page.locator('.react-flow__node[data-id="Q"]').click({ button: 'right' });
    await tick(page, 200);
    await page.getByRole('menuitem', { name: /En faire le sujet/ }).click();
    await tick(page, 400);
    m = await mapOf();
    ok('la problématique devient un sujet, ses liens « se rattache à »', m.nodes.find((n) => n.id === 'Q').kind === 'subject' && m.edges.filter((e) => e.target === 'Q').every((e) => e.relation === 'rattache') && (await page.locator('.react-flow__node[data-id="Q"] .map-center[data-center="subject"]').count()) === 1);
    ok('légende : « se rattache à »', (await page.locator('.map-legend').innerText()).includes('se rattache à'));
    await page.locator('.react-flow__node[data-id="Q"] .map-center').dblclick();
    await tick(page, 200);
    await page.locator('.map-center-input').fill('Le mensonge');
    await page.keyboard.press('Enter');
    await tick(page, 300);
    ok('édition du centre (Entrée termine)', (await mapOf()).nodes.find((n) => n.id === 'Q').text === 'Le mensonge', JSON.stringify((await mapOf()).nodes.find((n) => n.id === 'Q')) + (await page.locator('.map-center-input').count()));
    await shot(page, 'shots/map-center/05-sujet-clair.png');

    // Ranger : Radial, puis Arbre.
    await page.locator('[data-act="organise"]').click();
    await tick(page, 200);
    ok('« Radial » dans Ranger', (await page.locator('[data-layout="radial"]').count()) === 1);
    await page.locator('[data-layout="radial"]').click();
    await tick(page, 1200);
    const rects = await page.locator('.react-flow__node').evaluateAll((els) => els.map((e) => ({ id: e.dataset.id, ...JSON.parse(JSON.stringify(e.getBoundingClientRect())) })));
    const overlap = rects.some((a, i) => rects.some((b, j) => i < j && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height));
    const q = rects.find((r) => r.id === 'Q');
    const minX = Math.min(...rects.map((r) => r.x));
    const maxX = Math.max(...rects.map((r) => r.x + r.width));
    ok('Radial : sans chevauchement, le sujet au milieu', !overlap && Math.abs(q.x + q.width / 2 - (minX + maxX) / 2) < (maxX - minX) * 0.15, JSON.stringify(rects));
    await shot(page, 'shots/map-center/06-radial-clair.png');
    await page.locator('[data-act="organise"]').click();
    await page.locator('[data-layout="arbre"]').click();
    await tick(page, 1200);
    const ys = await page.locator('.react-flow__node').evaluateAll((els) => els.map((e) => ({ id: e.dataset.id, y: e.getBoundingClientRect().y })));
    ok('Arbre : le centre en haut', ys.every((r) => r.id === 'Q' || r.y > ys.find((x) => x.id === 'Q').y));
    await shot(page, 'shots/map-center/07-arbre-clair.png');

    // ═══ 6. Thème sombre ═══
    await S(() => window.__store.getState().updateSettings({ theme: 'dark' }));
    await page.locator('[data-act="organise"]').click();
    await page.locator('[data-layout="radial"]').click();
    await tick(page, 1200);
    await page.locator('.react-flow__node[data-id="C"]').hover();
    await page.locator('.react-flow__node[data-id="C"] .map-fold').click();
    await tick(page, 500);
    await shot(page, 'shots/map-center/08-radial-sombre.png');
    const contrast = await page.locator('.react-flow__node[data-id="Q"] .map-center-text').evaluate((el) => {
      const c = getComputedStyle(el).color.match(/\d+(\.\d+)?/g).map(Number);
      return (c[0] + c[1] + c[2]) / 3;
    });
    ok('sombre : texte du centre clair', contrast > 180, String(contrast));
    await S(() => window.__store.getState().updateSettings({ theme: 'light' }));

    // ═══ 7. Carte vide : poser la problématique, Tab → lien neutre ═══
    await S(() => window.__store.getState().navigate({ name: 'board', boardId: 'board-v' }));
    await page.waitForSelector('[data-testid=map-empty]');
    await tick(page, 400);
    ok('carte vide : « Poser la problématique » et « Poser le sujet »', (await page.locator('[data-act="pose-question"]').count()) === 1 && (await page.locator('[data-act="pose-subject"]').count()) === 1);
    await shot(page, 'shots/map-center/09-carte-vide.png');
    await page.locator('[data-act="pose-question"]').click();
    await tick(page, 400);
    ok('le centre est créé, en édition', (await page.locator('.map-center-input').count()) === 1);
    await page.keyboard.type('Peut-on avoir le droit de mentir ?');
    await page.keyboard.press('Tab');
    await tick(page, 500);
    m = await mapOf('board-v');
    const qn = m.nodes.find((n) => n.kind === 'question');
    const child = m.edges.find((e) => e.source === qn?.id);
    ok('Tab : nouvelle carte reliée à la problématique par un lien neutre (centre → carte)', qn?.text === 'Peut-on avoir le droit de mentir ?' && !!child && child.relation === 'lien', JSON.stringify(m));
    await page.keyboard.type('Non : la véracité est un devoir absolu');
    await page.keyboard.press('Escape');
    await tick(page, 300);
    m = await mapOf('board-v');
    ok('la thèse écrite est enregistrée', m.nodes.some((n) => n.text === 'Non : la véracité est un devoir absolu'), JSON.stringify(m.nodes.map((n) => n.text)));
    await page.mouse.click(700, 760, { button: 'right' });
    await tick(page, 200);
    const pane = await page.locator('[role="menu"]').innerText();
    ok('menu du vide : plus de « Poser… » quand un centre existe', !/Poser la problématique/.test(pane), pane);
    await page.keyboard.press('Escape');
    await shot(page, 'shots/map-center/10-nouvelle-problematique.png');

    // Aide.
    await S(() => window.__store.getState().navigate({ name: 'help' }));
    await tick(page, 500);
    const help = await page.locator('body').innerText();
    ok('aide : centre (problématique ou sujet) et replier / déplier', /Un centre : problématique ou sujet/.test(help) && /Replier, déplier/.test(help), '');

    // (Les polices servies hors du dossier, en 403 dans un worktree, ne comptent pas.)
    const real = errors.filter((e) => !/Failed to load resource/.test(e));
    ok('aucune erreur navigateur', real.length === 0, real.join('\n'));
  },
  { width: 1440, height: 900 },
);
console.log(`\n${passed} vérifications réussies`);
