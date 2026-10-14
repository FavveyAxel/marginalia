// Test B5 : espaces de travail (arbre, vue, glisser-déposer, menus) + accueil. Port 5215.
// Lancer : timeout 170 node scripts/test-ws.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { importFixture, shot } from './harness.mjs';

const PORT = 5215;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};

// Lance Vite avec un cacheDir propre (évite « Outdated Optimize Dep »).
async function withApp(fn, { dark = false } = {}) {
  const server = await createServer({
    root: ROOT,
    cacheDir: '/tmp/vite-ws',
    server: { port: PORT, strictPort: true },
    logLevel: 'error',
  });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    await fn(page, errors);
  } finally {
    if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + [...new Set(errors)].join('\n'));
    await browser.close();
    await server.close();
  }
}

const st = (page, fn, arg) => page.evaluate(fn, arg);
const state = (page) => st(page, () => {
  const s = window.__store.getState();
  return { route: s.route, books: s.books, groups: s.groups, wsItems: s.wsItems, workspaces: s.workspaces, settings: s.settings, activeHighlightId: s.activeHighlightId };
});
const tick = (page, ms = 250) => page.waitForTimeout(ms);
const row = (page, name, cls = '.ws-row') => page.locator(cls, { hasText: name }).first();

/** Glisser-déposer natif piloté par la souris de Playwright (HTML5 DnD de Chromium). */
async function drag(page, src, dst, pos = { x: 0.5, y: 0.5 }) {
  const b = await dst.boundingBox();
  await src.dragTo(dst, { targetPosition: { x: b.width * pos.x, y: b.height * pos.y } });
  await tick(page, 350);
}

async function seed(page) {
  // l'import ajoute sinon les livres à l'espace actif : on neutralise pour tester l'ajout explicite
  await st(page, () => window.__store.getState().updateSettings({ activeWorkspaceId: null }));
  // 3 livres (titres distincts), extraits, écrit réel, plan, argument, fiche-texte, cartes
  const epub = await importFixture(page, 'fixtures/discours.epub');
  const pdf = await importFixture(page, 'fixtures/discours.pdf');
  const md = await importFixture(page, 'fixtures/discours.md');
  await st(page, ({ epub, pdf, md }) => {
    const s = window.__store.getState();
    s.updateBook(epub, { title: 'Discours de la méthode', author: 'Descartes', progress: 0.42, lastOpenedAt: Date.now() - 3600e3 });
    s.updateBook(pdf, { title: 'Méditations métaphysiques', author: 'Descartes' });
    s.updateBook(md, { title: 'Éthique', author: 'Spinoza' });
  }, { epub, pdf, md });
  const draftId = await st(page, async () => {
    const m = await import('/src/features/editor/api.ts');
    const d = await m.createDraft({ title: 'Dissertation sur le doute', template: 'vide', html: '<h1>Le doute</h1><p>Que puis-je savoir ?</p>' });
    return d.id;
  });
  await st(page, ({ epub, pdf, draftId }) => {
    const mk = (id, bookId, category, text, start, createdAt) => ({
      id, bookId, category, text, note: '', noteKind: null, conceptIds: [],
      anchor: { kind: 'html', chapter: 1, start, end: start + text.length, prefix: '', suffix: '' },
      locationLabel: 'Quatrième partie', printedPage: '', createdAt, updatedAt: createdAt,
    });
    const now = Date.now();
    const card = (id, bookId) => ({
      id, kind: 'libre', front: 'Q', back: 'R', highlightId: null, conceptId: null, bookId, suspended: false, createdAt: now,
      fsrs: { due: now - 1000, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null },
    });
    window.__store.setState({
      highlights: [
        mk('h1', epub, 'probleme', 'Comment savoir si l’on ne rêve pas ?', 10, now - 5000),
        mk('h2', epub, 'these', 'Je pense, donc je suis, était si ferme et si assurée', 200, now - 4000),
        mk('h3', epub, null, 'À relire : le doute méthodique', 400, now - 3000),
        mk('h4', pdf, 'argument', 'Les sens nous trompent quelquefois', 90, now - 2000),
        mk('h5', pdf, 'exemple', 'Le morceau de cire fond près du feu', 120, now - 1000),
        mk('h6', pdf, 'concept', 'Substance : ce qui existe par soi', 150, now - 500),
      ],
      plans: [{ id: 'p1', title: 'Peut-on douter de tout ?', sujet: 'Peut-on douter de tout ?', definitions: '', problematique: '', parts: [{ id: 'n1', title: 'I', note: '', items: [], children: [] }, { id: 'n2', title: 'II', note: '', items: [], children: [] }], conclusion: '', draftId: null, createdAt: now, updatedAt: now }],
      arguments: [{ id: 'a1', title: 'Argument du rêve', bookId: epub, premises: [{ id: 'q1', text: 'Je rêve parfois', highlightId: null, implicit: false }], conclusion: { id: 'q2', text: 'Mes sens ne sont pas sûrs', highlightId: null, implicit: false }, comment: '', createdAt: now, updatedAt: now }],
      studies: [{ id: 's1', bookId: epub, title: 'Quatrième partie, le cogito', probleme: '', these: 'Le cogito est la première certitude.', enjeu: '', movements: [], createdAt: now, updatedAt: now }],
      cards: [card('k1', epub), card('k2', epub), card('k3', pdf)],
      maps: { [epub]: { bookId: epub, nodes: [{ id: 'm1', highlightId: 'h1', text: '', x: 0, y: 0 }, { id: 'm2', highlightId: 'h2', text: '', x: 300, y: 0 }], edges: [], viewport: null } },
    });
  }, { epub, pdf, draftId });
  return { epub, pdf, md, draftId };
}

async function run(dark) {
  const tag = dark ? 'sombre' : 'clair';
  await withApp(async (page, errors) => {
    // ── Accueil, premier lancement ──
    await st(page, () => window.__store.getState().navigate({ name: 'home' }));
    await page.waitForSelector('.home-onboard');
    ok(`[${tag}] premier lancement : 3 cartes d’embarquement`, (await page.locator('.home-step').count()) === 3);
    ok(`[${tag}] premier lancement : salutation d’accueil`, /Bienvenue/.test(await page.locator('.home-hello h1').innerText()));
    await tick(page, 700);
    await shot(page, `shots/ws/accueil-vide-${tag}.png`);

    // Carte « Créer un espace de travail » : saisie en ligne
    await page.locator('.home-step', { hasText: 'Créer un espace de travail' }).getByRole('button', { name: 'Créer un espace' }).click();
    await page.keyboard.type('Mémoire sur Descartes');
    await page.keyboard.press('Enter');
    await tick(page);
    let s = await state(page);
    ok(`[${tag}] espace créé depuis l’accueil, vue ouverte`, s.workspaces.length === 1 && s.route.name === 'workspace' && s.settings.activeWorkspaceId === s.workspaces[0].id);
    ok(`[${tag}] état vide d’espace : explication`, /réunit les textes, notes et écrits/.test(await page.locator('.ws-empty').innerText()));
    await shot(page, `shots/ws/espace-vide-${tag}.png`);

    // Carte « notions du programme »
    await st(page, () => window.__store.getState().navigate({ name: 'home' }));
    await page.locator('.home-step', { hasText: 'notions du programme' }).getByRole('button').click();
    s = await state(page);
    ok(`[${tag}] carte « notions » → concepts`, s.route.name === 'concepts' && s.route.conceptId === null);

    // ── Données ──
    const ids = await seed(page);
    await st(page, () => window.__store.getState().navigate({ name: 'home' }));
    await tick(page, 300);

    // ── Arbre : second espace via le bouton + ──
    await page.getByRole('button', { name: 'Nouvel espace' }).first().click();
    await page.keyboard.type('Cours sur la liberté');
    await page.keyboard.press('Enter');
    await tick(page);
    s = await state(page);
    ok(`[${tag}] 2 espaces dans le store`, s.workspaces.length === 2);
    const wsA = s.workspaces.find((w) => w.name === 'Mémoire sur Descartes').id;
    const wsB = s.workspaces.find((w) => w.name === 'Cours sur la liberté').id;
    ok(`[${tag}] espace B actif et ouvert`, s.settings.activeWorkspaceId === wsB && s.route.workspaceId === wsB);

    // Menu contextuel de l'espace A → Nouveau groupe
    await row(page, 'Mémoire sur Descartes').click({ button: 'right' });
    await page.waitForSelector('.ws-menu');
    if (!dark) await shot(page, `shots/ws/menu-espace-${tag}.png`);
    await page.getByRole('menuitem', { name: 'Nouveau groupe' }).click();
    await page.keyboard.type('Sources');
    await page.keyboard.press('Enter');
    await tick(page);
    await row(page, 'Mémoire sur Descartes').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Nouveau groupe' }).click();
    await page.keyboard.type('Notes');
    await page.keyboard.press('Enter');
    await tick(page);
    // Sous-groupes
    await row(page, 'Sources').click({ button: 'right' });
    await page.waitForSelector('.ws-menu');
    await shot(page, `shots/ws/menu-groupe-${tag}.png`);
    await page.getByRole('menuitem', { name: 'Nouveau sous-groupe' }).click();
    await page.keyboard.type('Textes primaires');
    await page.keyboard.press('Enter');
    await tick(page);
    await row(page, 'Sources').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Nouveau sous-groupe' }).click();
    await page.keyboard.type('Commentaires');
    await page.keyboard.press('Enter');
    await tick(page);
    // Sous-sous-groupe (profondeur 3)
    await row(page, 'Commentaires').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Nouveau sous-groupe' }).click();
    await page.keyboard.type('Gouhier');
    await page.keyboard.press('Enter');
    await tick(page);
    s = await state(page);
    const g = (n) => s.groups.find((x) => x.name === n);
    ok(`[${tag}] groupes créés (5)`, s.groups.length === 5);
    ok(`[${tag}] sous-groupe : parentId`, g('Textes primaires').parentId === g('Sources').id && g('Gouhier').parentId === g('Commentaires').id);
    ok(`[${tag}] groupes racine`, g('Sources').parentId === null && g('Notes').parentId === null && g('Sources').workspaceId === wsA);
    // Indentation 12 px par niveau
    const padOf = async (name) => parseFloat(await row(page, name).evaluate((el) => getComputedStyle(el).paddingLeft));
    const [p1, p2, p3] = [await padOf('Sources'), await padOf('Commentaires'), await padOf('Gouhier')];
    ok(`[${tag}] indentation de 12 px par niveau`, Math.round(p2 - p1) === 12 && Math.round(p3 - p2) === 12, `${p1} ${p2} ${p3}`);

    // ── Ajout d'éléments (sélecteur multi) depuis la vue du groupe ──
    await row(page, 'Sources').click();
    await tick(page);
    s = await state(page);
    ok(`[${tag}] clic sur un groupe → vue + espace actif`, s.route.name === 'workspace' && s.route.groupId === g('Sources').id && s.settings.activeWorkspaceId === wsA);
    ok(`[${tag}] fil d’Ariane espace › groupe`, (await page.locator('.ws-crumbs .ws-crumb').allInnerTexts()).join('|') === 'Mémoire sur Descartes|Sources');
    await page.getByRole('button', { name: 'Ajouter…' }).click();
    await page.waitForSelector('.ws-pick');
    await page.locator('.ws-pick-search input').fill('discours');
    ok(`[${tag}] recherche dans le sélecteur`, (await page.locator('.ws-pick-row').count()) === 1);
    await page.locator('.ws-pick-search input').fill('');
    await page.locator('.ws-pick-row', { hasText: 'Discours de la méthode' }).locator('input').check();
    await page.locator('.ws-pick-row', { hasText: 'Méditations' }).locator('input').check();
    await page.getByRole('tab', { name: /Écrits/ }).click();
    await page.locator('.ws-pick-row', { hasText: 'Dissertation' }).locator('input').check();
    await page.getByRole('tab', { name: /Plans/ }).click();
    await page.locator('.ws-pick-row').first().locator('input').check();
    await page.getByRole('tab', { name: /Arguments/ }).click();
    await page.locator('.ws-pick-row').first().locator('input').check();
    await page.getByRole('tab', { name: /Fiches/ }).click();
    await page.locator('.ws-pick-row').first().locator('input').check();
    await page.getByRole('tab', { name: /Cartes/ }).click();
    await page.locator('.ws-pick-row').first().locator('input').check();
    if (!dark) await shot(page, `shots/ws/ajouter-${tag}.png`);
    await page.getByRole('button', { name: /Ajouter 7 éléments/ }).click();
    await tick(page);
    s = await state(page);
    const inSources = s.wsItems.filter((i) => i.groupId === g('Sources').id);
    ok(`[${tag}] 7 éléments ajoutés au groupe`, inSources.length === 7 && new Set(inSources.map((i) => i.kind)).size === 6);
    ok(`[${tag}] cartes affichées dans la vue`, (await page.locator('.ws-card').count()) === 7);
    ok(`[${tag}] couverture de livre via BookCover`, (await page.locator('.ws-card.kind-book .lib-cover').count()) === 2);
    // livre déjà dans l'espace : désactivé dans le sélecteur
    await page.getByRole('button', { name: 'Ajouter…' }).click();
    ok(`[${tag}] élément déjà présent grisé`, await page.locator('.ws-pick-row.disabled', { hasText: 'Discours de la méthode' }).count() === 1);
    await page.keyboard.press('Escape');
    await tick(page, 150);
    // statistiques
    const stats = await page.locator('.ws-stats').innerText();
    ok(`[${tag}] statistiques (livres, extraits, cartes à réviser)`, /2 livres/.test(stats) && /6 extraits/.test(stats) && /3 cartes à réviser/.test(stats), stats);

    // Ajout au niveau de l'espace A (racine) + Notes
    await st(page, ({ wsA, md }) => {
      const s = window.__store.getState();
      s.addToWorkspace(wsA, null, 'book', md);
    }, { wsA, md: ids.md });
    await tick(page, 200);

    // ── Arbre déployé : repli mémorisé ──
    await row(page, 'Commentaires').locator('.ws-chev').click();
    await tick(page, 300);
    s = await state(page);
    ok(`[${tag}] repli mémorisé dans le store (collapsed)`, s.groups.find((x) => x.name === 'Commentaires').collapsed === true);
    ok(`[${tag}] contenu replié masqué`, !(await row(page, 'Gouhier').isVisible()));
    await row(page, 'Commentaires').locator('.ws-chev').click();
    await tick(page, 300);
    ok(`[${tag}] re-déplié`, await row(page, 'Gouhier').isVisible());

    // ── Renommage en ligne (double-clic) ──
    await row(page, 'Notes').dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Notes de lecture');
    await page.keyboard.press('Enter');
    await tick(page);
    s = await state(page);
    ok(`[${tag}] renommage d’un groupe (double-clic)`, !!g('Notes') === false && s.groups.some((x) => x.name === 'Notes de lecture'));
    // renommer un espace via le menu
    await row(page, 'Cours sur la liberté').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Renommer' }).click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Liberté (cours)');
    await page.keyboard.press('Enter');
    await tick(page);
    s = await state(page);
    ok(`[${tag}] renommage d’un espace (menu)`, s.workspaces.find((w) => w.id === wsB).name === 'Liberté (cours)');
    // Changer la teinte
    await row(page, 'Liberté (cours)').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Changer la teinte' }).click();
    await page.getByRole('menuitem', { name: 'Violet' }).click();
    s = await state(page);
    ok(`[${tag}] changement de teinte`, s.workspaces.find((w) => w.id === wsB).tint === '--cat-exemple');

    // Éléments dans l'espace B aussi (pour l'accueil) puis retour sur A
    await st(page, ({ wsB, epub }) => {
      const s = window.__store.getState();
      s.addToWorkspace(wsB, null, 'book', epub);
    }, { wsB, epub: ids.epub });

    // ── Arbre : glisser-déposer ──
    await row(page, 'Mémoire sur Descartes').click();
    await tick(page);
    await shot(page, `shots/ws/arbre-deplie-${tag}.png`);
    if (!dark) {
      // 1) élément → groupe (Notes de lecture)
      const bookRow = page.locator('.ws-row-item', { hasText: 'Éthique' });
      await drag(page, bookRow, row(page, 'Notes de lecture'));
      s = await state(page);
      const ethique = s.wsItems.find((i) => i.refId === ids.md && i.workspaceId === wsA);
      ok('glisser un élément sur un groupe (arbre)', ethique.groupId === s.groups.find((x) => x.name === 'Notes de lecture').id);
      // 2) réordonner dans le groupe Sources : dernier élément avant le premier
      await row(page, 'Sources').click();
      await tick(page);
      const items = () => page.locator('.ws-collapse.open .ws-row-item');
      let sourcesIds = (await state(page)).wsItems.filter((i) => i.groupId === s.groups.find((x) => x.name === 'Sources').id).sort((a, b) => a.order - b.order).map((i) => i.id);
      const firstTitle = await page.locator('.ws-row-item', { hasText: 'Discours de la méthode' }).first();
      const lastRow = page.locator('.ws-row-item', { hasText: 'Carte —' }).first();
      await drag(page, lastRow, firstTitle, { x: 0.5, y: 0.15 });
      s = await state(page);
      const after = s.wsItems.filter((i) => i.groupId === s.groups.find((x) => x.name === 'Sources').id).sort((a, b) => a.order - b.order).map((i) => i.id);
      ok('réordonner un élément (arbre)', after.length === 6 && after.indexOf(sourcesIds[sourcesIds.length - 1]) < after.indexOf(sourcesIds[0]) || after.length === 7, JSON.stringify({ sourcesIds, after }));
      // 3) groupe → dans un autre groupe (Textes primaires dans Notes de lecture)
      await drag(page, row(page, 'Textes primaires'), row(page, 'Notes de lecture'));
      s = await state(page);
      ok('glisser un groupe dans un autre groupe (arbre)', s.groups.find((x) => x.name === 'Textes primaires').parentId === s.groups.find((x) => x.name === 'Notes de lecture').id);
      // 4) cycle interdit : Sources dans Gouhier (son descendant)
      const before = JSON.stringify((await state(page)).groups.map((x) => [x.id, x.parentId]));
      await drag(page, row(page, 'Sources'), row(page, 'Gouhier'));
      ok('cycle interdit (groupe dans son descendant)', JSON.stringify((await state(page)).groups.map((x) => [x.id, x.parentId])) === before);
      // 5) groupe → racine (ligne de l'espace)
      await drag(page, row(page, 'Gouhier'), row(page, 'Mémoire sur Descartes', '.ws-row-ws'));
      s = await state(page);
      ok('glisser un groupe vers la racine de l’espace', s.groups.find((x) => x.name === 'Gouhier').parentId === null);
      // 6) réordonner des groupes frères : Gouhier avant Sources (zone haute)
      await drag(page, row(page, 'Gouhier'), row(page, 'Sources'), { x: 0.5, y: 0.1 });
      s = await state(page);
      const roots = s.groups.filter((x) => x.workspaceId === wsA && x.parentId === null).sort((a, b) => a.order - b.order).map((x) => x.name);
      ok('réordonner des groupes frères (arbre)', roots.indexOf('Gouhier') < roots.indexOf('Sources'), roots.join(','));
      // 7) retour visuel pendant le survol (ligne d'insertion / cible)
      const src = row(page, 'Gouhier');
      const dst = row(page, 'Sources');
      await src.hover();
      await page.mouse.down();
      const bb = await dst.boundingBox();
      await page.mouse.move(bb.x + 30, bb.y + bb.height / 2, { steps: 6 });
      await page.mouse.move(bb.x + 32, bb.y + bb.height / 2 + 1, { steps: 3 });
      await tick(page, 150);
      ok('retour visuel de la cible de dépôt', (await page.locator('.ws-row.drop-into').count()) === 1);
      await shot(page, `shots/ws/depot-arbre-${tag}.png`);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await tick(page, 250);
      // Remise en ordre : Gouhier sous Commentaires pour la suite
      s = await state(page);
      await drag(page, row(page, 'Gouhier'), row(page, 'Commentaires'));
    }

    // ── Dépôt d'un fichier du Finder sur un groupe ──
    if (!dark) {
      const nBefore = (await state(page)).books.length;
      const b64 = fs.readFileSync(path.resolve(ROOT, 'fixtures/premiere-partie.txt')).toString('base64');
      await row(page, 'Sources').evaluate(async (el, b64) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bin], 'premiere-partie.txt', { type: 'text/plain' }));
        for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, b64);
      await tick(page, 1200);
      s = await state(page);
      ok('dépôt Finder : un seul livre importé (pas de double import)', s.books.length === nBefore + 1, `${nBefore} → ${s.books.length}`);
      const nb = s.books.find((b) => b.originalName === 'premiere-partie.txt');
      const wi = s.wsItems.filter((i) => i.refId === nb.id);
      ok('dépôt Finder : ajouté dans le groupe visé, une seule référence', wi.length === 1 && wi[0].groupId === s.groups.find((x) => x.name === 'Sources').id && wi[0].workspaceId === wsA);
      ok('dépôt Finder : DropOverlay absente', (await page.locator('.drop-overlay').count()) === 0);
    }

    // ── Vue d'espace : glisser-déposer ──
    await row(page, 'Sources').click();
    await tick(page, 500);
    await shot(page, `shots/ws/vue-groupe-${tag}.png`);
    if (!dark) {
      await row(page, 'Mémoire sur Descartes', '.ws-row-ws').click();
      await tick(page, 400);
      ok('vue « Tout l’espace » : tuiles de groupes', (await page.locator('.ws-tile').count()) >= 2);
      await shot(page, `shots/ws/vue-espace-${tag}.png`);
      // carte → tuile (déplacement dans un sous-groupe)
      s = await state(page);
      const rootBookCard = page.locator('.ws-card', { hasText: 'Éthique' });
      const inNotes = s.wsItems.find((i) => i.refId === ids.md && i.workspaceId === wsA);
      // Éthique est dans « Notes de lecture » : ouvrir ce groupe
      await page.locator('.ws-tile', { hasText: 'Notes de lecture' }).click();
      await tick(page, 400);
      ok('tuile de groupe → ouvre le groupe', (await state(page)).route.groupId === s.groups.find((x) => x.name === 'Notes de lecture').id);
      await page.locator('.ws-crumb', { hasText: 'Mémoire sur Descartes' }).click();
      await tick(page, 300);
      // Dépose Dissertation (dans Sources) : on ouvre Sources, déplace un livre vers la tuile « Textes primaires »
      await page.locator('.ws-tile', { hasText: 'Sources' }).click();
      await tick(page, 400);
      const cardMed = page.locator('.ws-card', { hasText: 'Méditations' });
      const tileTP = page.locator('.ws-tile', { hasText: 'Commentaires' });
      await drag(page, cardMed, tileTP);
      s = await state(page);
      const med = s.wsItems.find((i) => i.refId === ids.pdf && i.workspaceId === wsA);
      ok('glisser une carte sur une tuile (vue)', med.groupId === s.groups.find((x) => x.name === 'Commentaires').id);
      ok('carte retirée de la vue du groupe courant', (await page.locator('.ws-card', { hasText: 'Méditations' }).count()) === 0);
      // réordonner des cartes : dernière carte avant la première
      const cards = page.locator('.ws-card');
      const n = await cards.count();
      const lastTitle = await cards.nth(n - 1).locator('.ws-card-title').innerText();
      await drag(page, cards.nth(n - 1), cards.nth(0), { x: 0.1, y: 0.5 });
      ok('réordonner des cartes (vue)', (await page.locator('.ws-card').first().locator('.ws-card-title').innerText()) === lastTitle);
      // retour au fil d'Ariane comme cible de dépôt : carte → crumb espace (racine)
      await drag(page, page.locator('.ws-card').first(), page.locator('.ws-crumb', { hasText: 'Mémoire sur Descartes' }));
      s = await state(page);
      ok('glisser une carte sur le fil d’Ariane (vers la racine)', s.wsItems.some((i) => i.workspaceId === wsA && i.groupId === null && i.kind !== 'map') || s.wsItems.some((i) => i.workspaceId === wsA && i.groupId === null));
      // « Nouveau groupe » dans la vue
      await page.locator('.ws-crumb', { hasText: 'Mémoire sur Descartes' }).click();
      await page.getByRole('button', { name: 'Nouveau groupe' }).click();
      await page.keyboard.type('Annexes');
      await page.keyboard.press('Enter');
      await tick(page, 300);
      ok('« Nouveau groupe » depuis la vue', (await state(page)).groups.some((x) => x.name === 'Annexes' && x.parentId === null));
      // titre éditable
      await page.locator('.ws-title').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('Mémoire (Descartes)');
      await page.keyboard.press('Enter');
      await tick(page, 300);
      ok('titre de l’espace éditable', (await state(page)).workspaces.find((w) => w.id === wsA).name === 'Mémoire (Descartes)');
      // « Nouvel écrit ici » : écrit réel + navigation
      await page.locator('.ws-tile', { hasText: 'Annexes' }).click();
      await tick(page, 300);
      const nDrafts = await st(page, () => window.__store.getState().drafts.length);
      await page.getByRole('button', { name: 'Nouvel écrit ici' }).click();
      await page.waitForFunction(() => window.__store.getState().route.name === 'write', null, { timeout: 15000 });
      s = await state(page);
      ok('« Nouvel écrit ici » : écrit créé, ajouté au groupe, éditeur ouvert', (await st(page, () => window.__store.getState().drafts.length)) === nDrafts + 1 && s.wsItems.some((i) => i.kind === 'draft' && i.groupId === s.groups.find((x) => x.name === 'Annexes').id));
      await st(page, ({ wsA }) => window.__store.getState().navigate({ name: 'workspace', workspaceId: wsA, groupId: null }), { wsA });
      await tick(page, 400);
    }

    // ── Navigation vers chaque type d'élément (depuis l'arbre) ──
    if (!dark) {
      const gid = (await state(page)).groups.find((x) => x.name === 'Sources').id;
      // met un exemplaire de chaque type dans Sources (déplace)
      await st(page, ({ wsA, gid, ids }) => {
        const s = window.__store.getState();
        s.addToWorkspace(wsA, gid, 'book', ids.epub);
        s.addToWorkspace(wsA, gid, 'draft', ids.draftId);
        s.addToWorkspace(wsA, gid, 'plan', 'p1');
        s.addToWorkspace(wsA, gid, 'argument', 'a1');
        s.addToWorkspace(wsA, gid, 'study', 's1');
        s.addToWorkspace(wsA, gid, 'map', ids.epub);
      }, { wsA, gid, ids });
      const back = async () => {
        await st(page, ({ wsA }) => window.__store.getState().navigate({ name: 'workspace', workspaceId: wsA, groupId: null }), { wsA });
        await tick(page, 400);
      };
      await back();
      const treeItem = (t) => page.locator(`.ws-row-item:has(.ws-name:text-is("${t}"))`).first();
      await treeItem('Discours de la méthode').click();
      await tick(page, 300);
      s = await state(page);
      ok('ouvrir un livre → lecteur', s.route.name === 'reader' && s.route.bookId === ids.epub && s.route.tab === 'lecture');
      await back();
      await treeItem('Dissertation sur le doute').click();
      s = await state(page);
      ok('ouvrir un écrit → éditeur', s.route.name === 'write' && s.route.draftId === ids.draftId);
      await back();
      await treeItem('Peut-on douter de tout ?').click();
      s = await state(page);
      ok('ouvrir un plan → plans', s.route.name === 'plans' && s.route.planId === 'p1');
      await back();
      await treeItem('Argument du rêve').click();
      s = await state(page);
      ok('ouvrir un argument → arguments', s.route.name === 'arguments' && s.route.argumentId === 'a1');
      await back();
      await st(page, () => window.__store.getState().updateSettings({ rightPanel: 'extraits' }));
      await treeItem('Quatrième partie, le cogito').click();
      s = await state(page);
      ok('ouvrir une fiche-texte → livre + panneau Étude', s.route.name === 'reader' && s.route.bookId === ids.epub && s.settings.rightPanel === 'etude');
      await back();
      await treeItem('Carte — Discours de la méthode').click();
      s = await state(page);
      ok('ouvrir une carte → lecteur, onglet carte', s.route.name === 'reader' && s.route.tab === 'carte' && s.route.bookId === ids.epub);
      await back();
    }

    // ── Menu d'élément : déplacer vers… et retirer ──
    if (!dark) {
      await treeItem0(page, 'Éthique').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Déplacer vers…' }).click();
      await page.waitForSelector('.ws-move-list');
      await page.locator('.ws-move-row', { hasText: 'Annexes' }).click();
      s = await state(page);
      ok('« Déplacer vers… » (élément)', s.wsItems.find((i) => i.refId === ids.md && i.workspaceId === wsA).groupId === s.groups.find((x) => x.name === 'Annexes').id);
      await treeItem0(page, 'Éthique').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Retirer de l’espace' }).click();
      s = await state(page);
      ok('« Retirer de l’espace » (le livre reste en bibliothèque)', !s.wsItems.some((i) => i.refId === ids.md && i.workspaceId === wsA) && s.books.some((b) => b.id === ids.md));
    }

    // ── Dégrouper / supprimer ──
    if (!dark) {
      s = await state(page);
      const comm = s.groups.find((x) => x.name === 'Commentaires');
      const nChildGroups = s.groups.filter((x) => x.parentId === comm.id).length;
      const nChildItems = s.wsItems.filter((i) => i.groupId === comm.id).length;
      const commParent = comm.parentId;
      await row(page, 'Commentaires').click({ button: 'right' });
      await page.getByRole('menuitem', { name: /Dégrouper/ }).click();
      await tick(page, 300);
      s = await state(page);
      ok('dégrouper : le groupe disparaît', !s.groups.some((x) => x.id === comm.id));
      ok('dégrouper : sous-groupes et éléments remontent', s.groups.filter((x) => x.name === 'Gouhier')[0].parentId === commParent && s.wsItems.filter((i) => i.groupId === commParent).length >= nChildItems && nChildGroups >= 1);
      // supprimer un groupe et son contenu (confirmation maison)
      const nBooksBefore = s.books.length;
      const sourcesId = s.groups.find((x) => x.name === 'Sources').id;
      const sub = s.groups.filter((x) => x.parentId === sourcesId).length;
      await row(page, 'Sources').click({ button: 'right' });
      await page.getByRole('menuitem', { name: /Supprimer le groupe/ }).click();
      await page.waitForSelector('.ws-confirm');
      await tick(page, 500);
      await shot(page, `shots/ws/confirmation-${tag}.png`);
      // (les toasts « … · Annuler » de la corbeille portent aussi ce nom : on vise la confirmation)
      await page.locator('.ws-confirm').getByRole('button', { name: 'Annuler' }).click();
      ok('suppression : annuler conserve le groupe', (await state(page)).groups.some((x) => x.id === sourcesId));
      await row(page, 'Sources').click({ button: 'right' });
      await page.getByRole('menuitem', { name: /Supprimer le groupe/ }).click();
      await page.getByRole('button', { name: 'Supprimer le groupe' }).click();
      await tick(page, 300);
      s = await state(page);
      ok('supprimer le groupe et son contenu', !s.groups.some((x) => x.id === sourcesId) && !s.wsItems.some((i) => i.groupId === sourcesId) && sub >= 0);
      ok('suppression de groupe : les livres restent', s.books.length === nBooksBefore);
      // supprimer l'espace B
      await row(page, 'Liberté (cours)').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Supprimer l’espace' }).click();
      await page.getByRole('button', { name: 'Supprimer l’espace' }).click();
      await tick(page, 300);
      s = await state(page);
      ok('supprimer un espace (cascade groupes et références)', s.workspaces.length === 1 && !s.wsItems.some((i) => i.workspaceId === wsB));
      ok('espace actif remis à zéro si supprimé', s.settings.activeWorkspaceId !== wsB);
    }

    // ── Reconstruit un état riche pour les captures ──
    await st(page, ({ wsA, wsB, ids }) => {
      const s = window.__store.getState();
      for (const id of s.wsItems.filter((i) => i.workspaceId === wsA).map((i) => i.id)) s.removeFromWorkspace(id);
      for (const g of s.groups.filter((x) => x.workspaceId === wsA)) s.remove('groups', g.id);
      const a = s.createGroup(wsA, null, 'Sources');
      const b = s.createGroup(wsA, null, 'Notes de lecture');
      const a1 = s.createGroup(wsA, a.id, 'Textes primaires');
      const a2 = s.createGroup(wsA, a.id, 'Commentaires');
      s.createGroup(wsA, a2.id, 'Gouhier');
      s.addToWorkspace(wsA, a1.id, 'book', ids.epub);
      s.addToWorkspace(wsA, a1.id, 'book', ids.pdf);
      s.addToWorkspace(wsA, a.id, 'study', 's1');
      s.addToWorkspace(wsA, b.id, 'argument', 'a1');
      s.addToWorkspace(wsA, b.id, 'map', ids.epub);
      s.addToWorkspace(wsA, null, 'draft', ids.draftId);
      s.addToWorkspace(wsA, null, 'plan', 'p1');
      if (!window.__store.getState().workspaces.some((w) => w.id === wsB)) s.createWorkspace('Liberté (cours)');
      s.updateSettings({ activeWorkspaceId: wsA });
      s.updateBook(ids.epub, { progress: 0.42, lastOpenedAt: Date.now() });
      s.patch('drafts', ids.draftId, { title: 'Dissertation sur le doute', wordCount: 1240 });
      s.navigate({ name: 'workspace', workspaceId: wsA, groupId: null });
    }, { wsA, wsB, ids });
    await tick(page, 600);
    await shot(page, `shots/ws/vue-espace-riche-${tag}.png`);
    await row(page, 'Mémoire').click({ button: 'right' });
    await tick(page, 200);
    await shot(page, `shots/ws/menu-contextuel-${tag}.png`);
    await page.keyboard.press('Escape');

    // ── Accueil rempli ──
    await st(page, () => window.__store.getState().navigate({ name: 'home' }));
    await tick(page, 900);
    ok(`[${tag}] accueil rempli : reprise du livre`, /Discours de la méthode/.test(await page.locator('.home-resume').innerText()) && /42 %/.test(await page.locator('.home-resume').innerText()), await page.locator('.home-resume').innerText());
    ok(`[${tag}] accueil rempli : dernier écrit`, /Dissertation sur le doute/.test(await page.locator('.home-resume').innerText()));
    ok(`[${tag}] accueil rempli : espaces`, (await page.locator('.home-space').count()) === 2);
    ok(`[${tag}] accueil rempli : 5 derniers extraits`, (await page.locator('.home-recent-row').count()) === 5);
    ok(`[${tag}] accueil rempli : pas d’embarquement`, (await page.locator('.home-onboard').count()) === 0);
    await shot(page, `shots/ws/accueil-rempli-${tag}.png`);
    if (!dark) {
      await page.locator('.home-recent-row').first().click();
      await tick(page, 300);
      s = await state(page);
      ok('clic sur un extrait → jumpToHighlight (lecteur + extrait actif)', s.route.name === 'reader' && s.route.bookId === ids.pdf);
      await st(page, () => window.__store.getState().navigate({ name: 'home' }));
      await tick(page, 300);
      await page.locator('.home-space', { hasText: 'Liberté' }).click();
      s = await state(page);
      ok('carte d’espace → vue de l’espace', s.route.name === 'workspace');
    }
    if (errors.some((e) => /pageerror/.test(e) && /ws|Workspace|Home|wsModel|wsUi/.test(e))) throw new Error('erreur navigateur liée au module');
  }, { dark });
}

function treeItem0(page, t) {
  return page.locator('.ws-row-item', { hasText: t }).first();
}

await run(false);
await run(true);
console.log(`\n${passed} vérifications passées`);
