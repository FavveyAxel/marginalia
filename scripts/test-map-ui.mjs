// Test de la carte d'argument : rendu et manipulation (rôles, liens, fond, animations,
// repli, aimantation, rangements, sélection groupée, clavier, mini-carte) + carte libre
// multi-livres fournie en prop. Port 5381. Captures dans shots/map-ui/ (clair, sombre, sépia).
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5381;
const OUT = path.join(ROOT, 'shots/map-ui');
fs.mkdirSync(OUT, { recursive: true });
const MOD = 'Meta'; // navigateur sans hôte Electron : plateforme « mac », ⌘ = Meta

let failures = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('capture:', `shots/map-ui/${name}`);
};
const wait = (page, ms) => page.waitForTimeout(ms);

const LONG =
  'la puissance de bien juger et distinguer le vrai d’avec le faux, qui est proprement ce qu’on nomme le bon sens ou la raison, est naturellement égale en tous les hommes ; et ainsi que la diversité de nos opinions ne vient pas de ce que les uns sont plus raisonnables que les autres, mais seulement de ce que nous conduisons nos pensées par diverses voies, et ne considérons pas les mêmes choses';
const HL = [
  // id, category, plain, text, chapter offset
  ['h-these', 'these', false, LONG, 10],
  ['h-arg1', 'argument', false, 'ceux qui ne marchent que fort lentement peuvent avancer beaucoup davantage, s’ils suivent toujours le droit chemin', 40],
  ['h-arg2', 'argument', false, 'ce n’est pas assez d’avoir l’esprit bon, mais le principal est de l’appliquer bien', 30],
  ['h-pb', 'probleme', false, 'D’où vient que nos opinions divergent, si la raison est égale en tous ?', 5],
  ['h-obj', 'objection', false, 'chacun pense en être si bien pourvu, que ceux même qui sont les plus difficiles à contenter n’en désirent pas plus', 50],
  ['h-cpt', 'concept', false, 'ne recevoir jamais aucune chose pour vraie que je ne la connusse évidemment être telle', 70],
  ['h-ex', 'exemple', false, 'les plus grandes âmes sont capables des plus grands vices, aussi bien que des plus grandes vertus', 60],
  ['h-plain', null, true, 'Je demeurais tout le jour enfermé seul dans un poêle', 80],
  ['h-note', null, false, 'Le doute méthodique commence ici.', 90],
];

async function seedBook(page) {
  const bookId = await page.evaluate(async () => {
    const md = '# Discours\n\nTexte de test.';
    const [b] = await window.__store.getState().importFiles([{ name: 'discours.md', data: new TextEncoder().encode(md).buffer }], { asBook: true });
    window.__store.getState().updateBook(b.id, { title: 'Discours de la méthode', author: 'René Descartes' });
    return b.id;
  });
  await page.evaluate(
    ({ bookId, HL }) => {
      const now = Date.now();
      const hs = HL.map(([id, category, plain, text, off], i) => ({
        id,
        bookId,
        category,
        plain: plain || undefined,
        text,
        note: '',
        noteKind: null,
        conceptIds: [],
        anchor: { kind: 'html', chapter: 0, start: off, end: off + 5, prefix: '', suffix: '' },
        locationLabel: 'Première partie',
        printedPage: String(3 + i),
        createdAt: now + i,
        updatedAt: now + i,
      }));
      const P = { 'h-these': [380, 40], 'h-arg1': [60, 380], 'h-arg2': [400, 400], 'h-pb': [60, 40], 'h-obj': [740, 380], 'h-cpt': [740, 40], 'h-ex': [60, 640], 'h-plain': [400, 660], 'h-note': [740, 660] };
      const nodes = hs.map((h) => ({ id: 'n-' + h.id.slice(2), highlightId: h.id, text: '', x: P[h.id][0], y: P[h.id][1] }));
      nodes.push({ id: 'n-idea', highlightId: null, text: 'La raison est partagée, la méthode ne l’est pas.', x: 1080, y: 220 });
      const edges = [
        { id: 'e1', source: 'n-arg1', target: 'n-these', relation: 'soutient', groupId: null, strength: 3 },
        { id: 'e2', source: 'n-arg2', target: 'n-these', relation: 'soutient', groupId: null },
        { id: 'e3', source: 'n-obj', target: 'n-these', relation: 'objecte', groupId: null },
        { id: 'e4', source: 'n-ex', target: 'n-arg1', relation: 'illustre', groupId: null, strength: 1 },
        { id: 'e5', source: 'n-cpt', target: 'n-these', relation: 'precise', groupId: null },
        { id: 'e6', source: 'n-idea', target: 'n-obj', relation: 'repond', groupId: null },
      ];
      window.__store.setState({ highlights: hs, toasts: [] });
      window.__store.getState().setMap(bookId, { bookId, nodes, edges, viewport: null });
    },
    { bookId, HL },
  );
  return bookId;
}

const nodeBox = (page, id) => page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
const getMap = (page, bookId) => page.evaluate((b) => window.__store.getState().getMap(b), bookId);
const nodeOf = (m, id) => m.nodes.find((n) => n.id === id);

async function drag(page, from, to, { steps = 14, hold } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (hold) await page.keyboard.down(hold);
  await page.mouse.move(from.x + (to.x - from.x) * 0.3, from.y + (to.y - from.y) * 0.3, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps });
}

async function openBookMap(page, bookId, theme) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme === 'sepia' ? 'light' : theme);
  if (theme === 'sepia') await page.evaluate(() => (document.documentElement.dataset.theme = 'sepia'));
  await page.evaluate((bookId) => window.__store.setState({ route: { name: 'reader', bookId, tab: 'carte', splitBookId: null } }), bookId);
  await page.waitForSelector('[data-testid=map-root] .react-flow__node');
  await wait(page, 700);
}

async function main() {
  const server = await createServer({
    root: ROOT,
    cacheDir: path.join(os.tmpdir(), 'marginalia-vite-5381'),
    server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
    logLevel: 'error',
  });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    // ═══ Partie A : carte d'un livre, thème clair, toutes les interactions ═══
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
      const bookId = await seedBook(page);
      await openBookMap(page, bookId, 'light');
      // Fermer le tiroir pour libérer la vue.
      if (await page.locator('[data-testid=map-drawer]').count()) await page.locator('[data-testid=map-drawer] header .icon-btn').click();
      await page.locator('[data-act=fit]').click();
      await wait(page, 600);

      // 1. Rôles
      const cats = await page.locator('.map-node-cat').allInnerTexts();
      const want = ['Thèse centrale', 'Argument', 'Problème', 'Thèse adverse', 'Concept', 'Exemple', 'Surlignage', 'Note', 'Idée'];
      check(want.every((w) => cats.some((c) => c.toLowerCase() === w.toLowerCase())), '1. étiquettes de rôle', cats.join(', '));
      const centralW = (await nodeBox(page, 'n-these')).width;
      const argW = (await nodeBox(page, 'n-arg1')).width;
      check(centralW > argW, '1. thèse centrale plus grande (1re thèse par défaut)', `${centralW} > ${argW}`);
      const fonts = await page.evaluate(() => ({
        idea: getComputedStyle(document.querySelector('.map-idea-text')).fontFamily,
        quote: getComputedStyle(document.querySelector('.map-extract .map-node-text')).fontFamily,
        caveat: document.fonts.check('20px Caveat'),
      }));
      check(/Caveat/.test(fonts.idea) && fonts.caveat, '1. idée en police manuscrite embarquée (Caveat)', fonts.idea);
      check(!/Caveat/.test(fonts.quote), '1. extrait en typographie de citation', fonts.quote);
      // Marquer comme thèse centrale (clic droit)
      await page.locator('.react-flow__node[data-id="n-arg2"]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Marquer comme thèse centrale' }).click();
      await wait(page, 300);
      check((await getMap(page, bookId)).centralId === 'n-arg2' && (await page.locator('.react-flow__node[data-id="n-arg2"] .map-node.central').count()) === 1, '1. « Marquer comme thèse centrale »');
      await page.locator('.react-flow__node[data-id="n-arg2"]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Ne plus marquer comme thèse centrale' }).click();
      await wait(page, 400);
      await page.locator('[data-act=fit]').click();
      await wait(page, 600);
      await page.mouse.click(5, 5);
      await shot(page, 'light-1-carte.png');

      // 2. Liens : épaisseur selon la force, nom au survol
      const sw = await page.evaluate(() =>
        Object.fromEntries(['e1', 'e2', 'e4'].map((id) => [id, parseFloat(getComputedStyle(document.querySelector(`.react-flow__edge[data-id="${id}"] .map-edge-path`) ?? document.querySelector(`[data-id="${id}"] .map-edge-path`)).strokeWidth)])),
      );
      check(sw.e1 > sw.e2 && sw.e2 > sw.e4, '2. épaisseur fort > moyen > faible', JSON.stringify(sw));
      check(!(await page.locator('.map-pill[data-edge="e2"]').evaluate((el) => el.classList.contains('show'))), '2. nom de relation caché hors survol');
      const pill = await page.locator('.map-pill[data-edge="e2"]').boundingBox();
      await page.mouse.move(pill.x + pill.width / 2, pill.y + pill.height / 2);
      await wait(page, 350);
      const pillShown = await page.locator('.map-pill[data-edge="e2"]').evaluate((el) => el.classList.contains('show') && getComputedStyle(el.querySelector('.map-pill-label')).opacity !== '0');
      check(pillShown, '2. nom de la relation au survol, au milieu du lien');
      await shot(page, 'light-2-survol-lien.png');
      // Menu du lien : force
      await page.locator('.map-pill[data-edge="e2"]').click();
      await page.waitForSelector('[data-testid=map-edge-menu]');
      await page.locator('[data-testid=map-edge-menu] [data-strength="3"]').click();
      check((await getMap(page, bookId)).edges.find((e) => e.id === 'e2').strength === 3, '2. force choisie dans le menu du lien');
      await shot(page, 'light-3-menu-lien.png');
      await page.keyboard.press('Escape');
      await page.mouse.move(5, 300);

      // 3. Fond et ombres
      const bg = await page.evaluate(() => ({
        dots: document.querySelectorAll('.react-flow__background circle, .react-flow__background pattern').length,
        shadow: getComputedStyle(document.querySelector('.map-extract')).boxShadow,
      }));
      check(bg.dots > 0 && bg.shadow !== 'none', '3. grille de points et ombres légères', bg.shadow.slice(0, 60));

      // 5. Repli d'un extrait long (thèse)
      const thesis = page.locator('.react-flow__node[data-id="n-these"] .map-node');
      check(await thesis.evaluate((el) => el.classList.contains('long') && el.classList.contains('collapsed')), '5. extrait long replié par défaut (3 lignes)');
      const h0 = (await nodeBox(page, 'n-these')).height;
      await page.locator('.react-flow__node[data-id="n-these"] [data-act=toggle-collapse]').click();
      await wait(page, 450);
      const h1 = (await nodeBox(page, 'n-these')).height;
      check(h1 > h0 + 20 && nodeOf(await getMap(page, bookId), 'n-these').collapsed === false, '5. déplié au clic, état mémorisé', `${h0} → ${h1}`);
      await page.locator('.react-flow__node[data-id="n-these"] [data-act=toggle-collapse]').click();
      await wait(page, 450);

      // 4. Animation : soulèvement à la saisie + 6. aimantation
      const tgt = await nodeBox(page, 'n-cpt');
      const src = await nodeBox(page, 'n-note');
      const grab = { x: src.x + 30, y: src.y + 14 };
      // Viser x aligné à gauche sur n-cpt avec 3 px d'écart → aimanté
      const z = await page.evaluate(() => window.__rfZoom ?? null);
      await drag(page, grab, { x: grab.x + (tgt.x - src.x) + 3, y: grab.y - 150 });
      await wait(page, 120);
      const lift = await page.evaluate(() => {
        const n = document.querySelector('.react-flow__node.dragging .map-node');
        return n ? getComputedStyle(n).transform : null;
      });
      const guides = await page.locator('.map-guide-line').count();
      await shot(page, 'light-4-glisser-guides.png');
      await page.mouse.up();
      await wait(page, 700);
      check(!!lift && lift !== 'none', '4. carte soulevée pendant la saisie', lift ?? '');
      check(guides > 0, '6. lignes guides pendant le glisser', String(guides));
      let m = await getMap(page, bookId);
      check(nodeOf(m, 'n-note').x === nodeOf(m, 'n-cpt').x, '6. aimantation : bord gauche aligné', `${nodeOf(m, 'n-note').x} / ${nodeOf(m, 'n-cpt').x}`);
      // Sans aimantation avec ⌘ (Ctrl)
      const src2 = await nodeBox(page, 'n-note');
      const tgt2 = await nodeBox(page, 'n-cpt');
      const g2 = { x: src2.x + 30, y: src2.y + 14 };
      await drag(page, g2, { x: g2.x + 4, y: g2.y + 40 }, { hold: MOD });
      const guides2 = await page.locator('.map-guide-line').count();
      await page.mouse.up();
      await page.keyboard.up(MOD);
      await wait(page, 600);
      m = await getMap(page, bookId);
      check(guides2 === 0 && nodeOf(m, 'n-note').x !== nodeOf(m, 'n-cpt').x, '6. ⌘ pendant le glisser : pas d’aimantation', `${nodeOf(m, 'n-note').x} / ${nodeOf(m, 'n-cpt').x} (${tgt2.x})`);

      // 4. Collisions : poser une carte sur une autre → la voisine s'écarte
      const before = nodeOf(await getMap(page, bookId), 'n-plain');
      const a = await nodeBox(page, 'n-ex');
      const b = await nodeBox(page, 'n-plain');
      const ga = { x: a.x + 30, y: a.y + 12 };
      await drag(page, ga, { x: ga.x + (b.x - a.x) + 40, y: ga.y + (b.y - a.y) + 10 }, { hold: MOD });
      await page.mouse.up();
      await page.keyboard.up(MOD);
      await wait(page, 120);
      const gliding = await page.locator('.react-flow__node.map-glide').count();
      await wait(page, 700);
      m = await getMap(page, bookId);
      const after = nodeOf(m, 'n-plain');
      const ex = nodeOf(m, 'n-ex');
      const ab = await nodeBox(page, 'n-ex');
      const bb = await nodeBox(page, 'n-plain');
      const overlap = !(ab.x + ab.width <= bb.x || bb.x + bb.width <= ab.x || ab.y + ab.height <= bb.y || bb.y + bb.height <= ab.y);
      check((after.x !== before.x || after.y !== before.y) && !overlap, '4. la voisine s’écarte (plus de chevauchement)', `${before.x},${before.y} → ${after.x},${after.y}`);
      check(gliding > 0, '4. écartement animé (glissement)', String(gliding));
      void ex;

      // 4. Nouveau lien : tracé progressif
      const sA = await nodeBox(page, 'n-pb');
      const sB = await nodeBox(page, 'n-cpt');
      await page.locator('.react-flow__node[data-id="n-pb"]').hover();
      const handle = await page.locator('.react-flow__node[data-id="n-pb"] .map-h-r').boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(sB.x + sB.width / 2, sB.y + sB.height / 2, { steps: 12 });
      await page.mouse.up();
      await wait(page, 60);
      const freshCount = await page.locator('.map-edge.fresh').count();
      check(freshCount === 1, '4. un nouveau lien se dessine progressivement');
      await page.keyboard.press('Escape');
      await wait(page, 800);
      check((await page.locator('.map-edge.fresh').count()) === 0, '4. tracé terminé');
      void sA;

      // 7. Rangements + annulation en une étape
      for (const kind of ['arbre', 'debat', 'chrono']) {
        const pre = (await getMap(page, bookId)).nodes.map((n) => [n.id, n.x, n.y]);
        await page.locator('[data-act=organise]').click();
        await page.locator(`[data-layout=${kind}]`).click();
        await wait(page, 120);
        const anim = await page.locator('.react-flow__node.map-glide').count();
        await wait(page, 800);
        const post = (await getMap(page, bookId)).nodes;
        const moved = post.filter((n) => {
          const p = pre.find((x) => x[0] === n.id);
          return p && (p[1] !== n.x || p[2] !== n.y);
        }).length;
        check(moved > 0 && anim > 0, `7. Ranger « ${kind} » : cartes déplacées avec transition`, `${moved} déplacées`);
        // pas de chevauchement
        const boxes = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect()).map((r) => [r.x, r.y, r.width, r.height]));
        let ov = 0;
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const [x1, y1, w1, h1] = boxes[i];
            const [x2, y2, w2, h2] = boxes[j];
            if (x1 < x2 + w2 - 1 && x2 < x1 + w1 - 1 && y1 < y2 + h2 - 1 && y2 < y1 + h1 - 1) ov++;
          }
        check(ov === 0, `7. « ${kind} » sans chevauchement`, String(ov));
        await page.evaluate(() => window.__store.setState({ toasts: [] }));
        await shot(page, `light-5-range-${kind}.png`);
        if (kind === 'arbre') {
          if (kind === 'arbre') {
            await page.locator('.react-flow__pane').click({ position: { x: 3, y: 3 } });
            await page.keyboard.press(`${MOD}+z`);
            await wait(page, 400);
            const undone = (await getMap(page, bookId)).nodes.map((n) => [n.id, n.x, n.y]);
            check(JSON.stringify(undone) === JSON.stringify(pre), '7. ⌘Z annule le rangement en une étape');
            await page.keyboard.press(`${MOD}+Shift+z`);
            await wait(page, 400);
          }
        }
      }
      // Rangement chronologique : ordre du texte respecté (problème, thèse, argument 2, argument 1…)
      m = await getMap(page, bookId);
      const order = ['n-pb', 'n-these', 'n-arg2', 'n-arg1', 'n-obj', 'n-ex', 'n-cpt'].map((id) => nodeOf(m, id));
      const mono = order.every((n, i) => i === 0 || n.y > order[i - 1].y || (n.y === order[i - 1].y && n.x > order[i - 1].x) || n.x > order[i - 1].x);
      check(mono, '7. « Chronologique » suit l’ordre du texte');

      // 8. Sélection au rectangle (⇧ + glisser dans le vide) et barre flottante
      await page.locator('[data-act=fit]').click();
      await wait(page, 600);
      const all = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((n) => ({ id: n.dataset.id, r: n.getBoundingClientRect().toJSON() })));
      const targets = all.filter((n) => ['n-pb', 'n-these', 'n-arg2'].includes(n.id));
      const minX = Math.min(...targets.map((t) => t.r.x)) - 12;
      const minY = Math.min(...targets.map((t) => t.r.y)) - 12;
      const maxX = Math.max(...targets.map((t) => t.r.x + t.r.width)) + 12;
      const maxY = Math.max(...targets.map((t) => t.r.y + t.r.height)) + 12;
      // On encadre une zone qui touche ces cartes (sélection partielle) : on part d'un coin vide.
      await page.keyboard.down('Shift');
      await page.mouse.move(minX - 30, minY - 30);
      await page.mouse.down();
      await page.mouse.move((minX + maxX) / 2, (minY + maxY) / 2, { steps: 10 });
      await page.mouse.move(maxX, maxY, { steps: 10 });
      await shot(page, 'light-6-rectangle.png');
      await page.mouse.up();
      await page.keyboard.up('Shift');
      await wait(page, 300);
      const selCount = await page.locator('.react-flow__node.selected').count();
      check(selCount >= 2, '8. sélection au rectangle (⇧ + glisser)', String(selCount));
      check(await page.locator('[data-testid=map-selbar]').isVisible(), '8. barre flottante au-dessus de la sélection');
      await shot(page, 'light-7-selection.png');
      await page.locator('[data-testid=map-selbar] [data-align=left]').click();
      await wait(page, 700);
      m = await getMap(page, bookId);
      const selIds = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.dataset.id));
      const xs = new Set(selIds.map((id) => nodeOf(m, id).x));
      check(xs.size === 1, '8. aligner à gauche', [...xs].join(','));
      // Outil sélection (sans ⇧)
      await page.locator('.react-flow__pane').click({ position: { x: 3, y: 3 } });
      await page.locator('[data-act=select-tool]').click();
      check((await page.locator('.map-root.map-selecttool').count()) === 1, '8. outil sélection actif');
      await page.locator('[data-act=select-tool]').click();
      // Clic droit sur la sélection : actions groupées
      await page.keyboard.press(`${MOD}+a`);
      await wait(page, 200);
      await page.locator('.react-flow__node[data-id="n-idea"]').click({ button: 'right' });
      const groupMenu = await page.locator('[role=menu]').innerText();
      check(/Aligner/.test(groupMenu) && /Supprimer les \d+ cartes/.test(groupMenu) && /Couleur/.test(groupMenu), '8. menu clic droit groupé', groupMenu.replace(/\n/g, ' | ').slice(0, 120));
      await page.keyboard.press('Escape');
      // Colorer les idées depuis la barre
      await page.locator('[data-testid=map-selbar] [data-color="--cat-concept"]').click();
      await wait(page, 200);
      check(nodeOf(await getMap(page, bookId), 'n-idea').color === '--cat-concept', '8. colorer les idées de la sélection');
      await page.keyboard.press('Escape');
      await wait(page, 200);

      // 9. Clavier
      await page.locator('.react-flow__node[data-id="n-these"]').click();
      await wait(page, 150);
      const n0 = (await getMap(page, bookId)).nodes.length;
      await page.keyboard.press('Tab');
      await wait(page, 300);
      m = await getMap(page, bookId);
      const child = m.nodes[m.nodes.length - 1];
      const childEdge = m.edges.find((e) => e.source === child.id);
      check(m.nodes.length === n0 + 1 && childEdge?.target === 'n-these' && childEdge.relation === 'soutient' && child.y > nodeOf(m, 'n-these').y, '9. Tab : carte enfant reliée (soutient), dessous');
      check((await page.locator('.map-idea-input').count()) === 1, '9. la nouvelle carte est en édition');
      await page.keyboard.type('Une raison commune');
      await page.keyboard.press('Escape');
      await wait(page, 200);
      check(nodeOf(await getMap(page, bookId), child.id).text === 'Une raison commune' && (await page.locator('.map-idea-input').count()) === 0, '9. Échap sort de l’édition (texte gardé)');
      await page.keyboard.press('Enter');
      await wait(page, 200);
      check((await page.locator('.map-idea-input').count()) === 1, '9. Entrée sur une idée : édition');
      await page.keyboard.press('Escape');
      await wait(page, 150);
      await page.keyboard.press('Shift+Enter');
      await wait(page, 300);
      m = await getMap(page, bookId);
      const sib = m.nodes[m.nodes.length - 1];
      const sibEdge = m.edges.find((e) => e.source === sib.id);
      check(sib.id !== child.id && sibEdge?.target === 'n-these', '9. carte sœur (même parent)');
      await page.keyboard.press('Escape');
      await wait(page, 150);
      // Entrée sur un extrait : carte sœur
      await page.locator('[data-act=fit]').click();
      await wait(page, 600);
      await page.locator('.react-flow__node[data-id="n-arg1"]').click();
      await wait(page, 100);
      const nA = (await getMap(page, bookId)).nodes.length;
      await page.keyboard.press('Enter');
      await wait(page, 300);
      m = await getMap(page, bookId);
      check(m.nodes.length === nA + 1 && m.edges.some((e) => e.source === m.nodes[m.nodes.length - 1].id && e.target === 'n-these'), '9. Entrée sur un extrait : carte sœur reliée au même parent');
      await page.keyboard.press('Escape');
      await wait(page, 150);
      // Flèches
      await page.locator('[data-act=fit]').click();
      await wait(page, 600);
      await page.locator('.react-flow__node[data-id="n-these"]').click();
      await wait(page, 100);
      const tb = await nodeBox(page, 'n-these');
      const rights = (await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((n) => ({ id: n.dataset.id, r: n.getBoundingClientRect().toJSON() })))).filter((n) => n.r.x > tb.x + tb.width / 2);
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => !document.querySelector('.react-flow__node[data-id="n-these"]').classList.contains('selected'), null, { timeout: 1500 }).catch(() => {});
      const selAfter = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.dataset.id));
      check(selAfter.length === 1 && selAfter[0] !== 'n-these' && (rights.length === 0 || rights.some((r) => r.id === selAfter[0])), '9. flèche → carte voisine dans cette direction', selAfter.join());
      // ⌫ supprime
      const nB = (await getMap(page, bookId)).nodes.length;
      await page.keyboard.press('Backspace');
      await wait(page, 200);
      check((await getMap(page, bookId)).nodes.length === nB - 1, '9. ⌫ supprime la carte');
      await page.keyboard.press(`${MOD}+z`);
      await wait(page, 300);
      // Double-clic dans le vide
      const nC = (await getMap(page, bookId)).nodes.length;
      const vp = await page.locator('.react-flow__pane').boundingBox();
      let spot = null;
      for (const [fx, fy] of [[0.9, 0.12], [0.5, 0.08], [0.95, 0.5], [0.4, 0.85]]) {
        const p = { x: vp.x + vp.width * fx, y: vp.y + vp.height * fy };
        const hit = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.react-flow__node, .map-bar, .react-flow__panel, .react-flow__edge, button'), p);
        if (!hit) {
          spot = p;
          break;
        }
      }
      await page.mouse.dblclick(spot.x, spot.y);
      await wait(page, 300);
      check((await getMap(page, bookId)).nodes.length === nC + 1 && (await page.locator('.map-idea-input').count()) === 1, '9. double-clic dans le vide : nouvelle idée');
      await page.keyboard.type('Pourquoi une méthode ?');
      await page.keyboard.press('Escape');
      await wait(page, 200);

      // 10. Mini-carte, zoom sur la sélection, tout voir
      check(await page.locator('.map-minimap').isVisible(), '10. mini-carte visible');
      await page.locator('[data-act=minimap]').click();
      await wait(page, 200);
      check((await page.locator('.map-minimap').count()) === 0, '10. mini-carte repliable');
      await page.locator('[data-act=minimap]').click();
      await wait(page, 200);
      const vpOf = () => page.evaluate(() => document.querySelector('.react-flow__viewport').style.transform);
      await page.locator('.react-flow__node[data-id="n-cpt"]').click();
      const v0 = await vpOf();
      await page.locator('[data-act=zoom-selection]').click();
      await wait(page, 600);
      const v1 = await vpOf();
      check(v0 !== v1, '10. zoom sur la sélection (bouton)');
      await page.keyboard.press('Shift+Digit1');
      await page.waitForFunction((v) => document.querySelector('.react-flow__viewport').style.transform !== v, v1, { timeout: 2000 }).catch(() => {});
      await wait(page, 600);
      const v2 = await vpOf();
      check(v2 !== v1, '10. tout voir (⇧1)');
      await page.keyboard.press('Shift+Digit2');
      await page.waitForFunction((v) => document.querySelector('.react-flow__viewport').style.transform !== v, v2, { timeout: 2000 }).catch(() => {});
      await wait(page, 600);
      check((await vpOf()) !== v2, '10. zoom sur la sélection (⇧2)');
      await page.locator('[data-act=fit]').click();
      await wait(page, 600);
      await page.mouse.click(5, 5);
      await page.evaluate(() => window.__store.setState({ toasts: [] }));
      await shot(page, 'light-8-final.png');

      // 4. prefers-reduced-motion : pas d'animation de tracé
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const sC = await nodeBox(page, 'n-arg2');
      await page.locator('.react-flow__node[data-id="n-ex"]').hover();
      const hd = await page.locator('.react-flow__node[data-id="n-ex"] .map-h-r').boundingBox();
      await page.mouse.move(hd.x + hd.width / 2, hd.y + hd.height / 2);
      await page.mouse.down();
      await page.mouse.move(sC.x + sC.width / 2, sC.y + sC.height / 2, { steps: 10 });
      await page.mouse.up();
      await wait(page, 50);
      check((await page.locator('.map-edge.fresh').count()) === 0, '4. prefers-reduced-motion respecté');
      await page.keyboard.press('Escape');

      check(errors.length === 0, 'aucune erreur navigateur (carte de livre)', errors.join(' | '));
      await ctx.close();
    }

    // ═══ Partie B : captures en sombre et sépia (carte de livre) ═══
    for (const theme of ['dark', 'sepia']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme === 'dark' ? 'dark' : 'light' });
      const page = await ctx.newPage();
      await page.goto(`http://localhost:${PORT}/`);
      await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
      const bookId = await seedBook(page);
      await openBookMap(page, bookId, theme);
      if (await page.locator('[data-testid=map-drawer]').count()) await page.locator('[data-testid=map-drawer] header .icon-btn').click();
      await page.evaluate(() => window.__store.setState({ toasts: [] }));
      await page.locator('[data-act=fit]').click();
      await wait(page, 700);
      await page.mouse.click(5, 5);
      await shot(page, `${theme}-1-carte.png`);
      const pill = await page.locator('.map-pill[data-edge="e3"]').boundingBox();
      await page.mouse.move(pill.x + pill.width / 2, pill.y + pill.height / 2);
      await page.locator('.react-flow__node[data-id="n-cpt"]').click({ modifiers: [MOD] });
      await page.locator('.react-flow__node[data-id="n-idea"]').click({ modifiers: [MOD] });
      await page.mouse.move(pill.x + pill.width / 2, pill.y + pill.height / 2);
      await wait(page, 300);
      await shot(page, `${theme}-2-selection-survol.png`);
      const dot = await page.evaluate(() => getComputedStyle(document.querySelector('.map-root')).getPropertyValue('--map-dot'));
      check(!!dot.trim(), `[${theme}] grille teintée selon le thème`, dot.trim());
      await ctx.close();
    }

    // ═══ Partie C : carte libre (source board en prop), extraits de deux livres ═══
    for (const theme of ['light', 'dark', 'sepia']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      await page.goto(`http://localhost:${PORT}/scripts/map-harness.html?theme=${theme}`);
      await page.waitForFunction(() => window.__store && window.__setBoard);
      await page.evaluate(() => {
        const now = Date.now();
        const books = [
          { id: 'b-desc', title: 'Discours de la méthode', author: 'René Descartes' },
          { id: 'b-pasc', title: 'Pensées', author: 'Blaise Pascal' },
        ].map((b) => ({ ...b, format: 'md', fileName: 'x.md', originalName: 'x.md', size: 1, addedAt: now, lastOpenedAt: null, progress: 0, position: null, cover: null, edition: { publisher: '', year: '', translator: '', place: '', pageOffset: 0 } }));
        const mk = (id, bookId, category, text, start) => ({ id, bookId, category, text, note: '', noteKind: null, conceptIds: [], anchor: { kind: 'html', chapter: 0, start, end: start + 4, prefix: '', suffix: '' }, locationLabel: '', printedPage: String(start), createdAt: now, updatedAt: now });
        const hs = [
          mk('d1', 'b-desc', 'these', 'Le bon sens est la chose du monde la mieux partagée.', 1),
          mk('d2', 'b-desc', 'argument', 'Je pense, donc je suis.', 40),
          mk('p1', 'b-pasc', 'these', 'Le cœur a ses raisons que la raison ne connaît point.', 277),
          mk('p2', 'b-pasc', 'objection', 'Nous connaissons la vérité non seulement par la raison, mais encore par le cœur.', 110),
          mk('p3', 'b-pasc', 'exemple', 'L’homme n’est qu’un roseau, le plus faible de la nature ; mais c’est un roseau pensant.', 347),
        ];
        window.__store.setState({ books, highlights: hs });
        window.__setBoard({
          id: 'board-test',
          kind: 'board',
          title: 'Raison et cœur',
          bookId: '',
          bookIds: ['b-desc', 'b-pasc'],
          nodes: [
            { id: 'a', highlightId: 'd1', text: '', x: 0, y: 0 },
            { id: 'b', highlightId: 'd2', text: '', x: 0, y: 260 },
            { id: 'c', highlightId: 'p1', text: '', x: 460, y: 0 },
            { id: 'd', highlightId: 'p2', text: '', x: 460, y: 260 },
            { id: 'e', highlightId: 'p3', text: '', x: 900, y: 260 },
            { id: 'f', highlightId: null, text: 'Deux rationalités : démontrer ou sentir ?', x: 230, y: -230 },
          ],
          edges: [
            { id: 'x1', source: 'b', target: 'a', relation: 'soutient', groupId: null },
            { id: 'x2', source: 'c', target: 'a', relation: 'oppose', groupId: null, strength: 3 },
            { id: 'x3', source: 'd', target: 'c', relation: 'soutient', groupId: null },
            { id: 'x4', source: 'e', target: 'd', relation: 'illustre', groupId: null, strength: 1 },
            { id: 'x5', source: 'f', target: 'a', relation: 'precise', groupId: null },
          ],
          viewport: null,
        });
      });
      await page.waitForSelector('.react-flow__node');
      await wait(page, 900);
      const tags = await page.locator('.map-node-book').allInnerTexts();
      check(tags.includes('Descartes') && tags.includes('Pascal'), `[board ${theme}] nom court de l’auteur sur chaque extrait`, tags.join(', '));
      check((await page.locator('.react-flow__node').count()) === 6, `[board ${theme}] 6 cartes affichées depuis la prop`);
      if (theme === 'light') {
        // Écriture via set() : déplacer une carte
        const writes0 = await page.evaluate(() => window.__writes);
        const bx = await nodeBox(page, 'e');
        await drag(page, { x: bx.x + 30, y: bx.y + 12 }, { x: bx.x + 90, y: bx.y + 80 }, { hold: MOD });
        await page.mouse.up();
        await page.keyboard.up(MOD);
        await wait(page, 600);
        const nb = await page.evaluate(() => window.__board().nodes.find((n) => n.id === 'e'));
        check((await page.evaluate(() => window.__writes)) > writes0 && nb.x !== 900, '[board] écriture par set() (déplacement)', `${nb.x},${nb.y}`);
        // Chronologique multi-livres : par livre puis ordre du texte
        await page.locator('[data-act=organise]').click();
        await page.locator('[data-layout=chrono]').click();
        await wait(page, 900);
        const ns = await page.evaluate(() => window.__board().nodes);
        const pos = (id) => ns.find((n) => n.id === id);
        const seq = ['a', 'b', 'd', 'c', 'e'].map(pos); // Descartes (1, 40) puis Pascal (110, 277, 347)
        const ok = seq.every((n, i) => i === 0 || n.y > seq[i - 1].y || n.x > seq[i - 1].x);
        check(ok, '[board] « Chronologique » : par livre puis ordre du texte', seq.map((n) => `${n.id}:${n.x},${n.y}`).join(' '));
        // Nouvelle idée via double-clic : écrite dans la carte libre
        await page.locator('[data-act=fit]').click();
        await wait(page, 600);
        const n0 = await page.evaluate(() => window.__board().nodes.length);
        await page.locator('[data-act=idea]').click();
        await page.waitForSelector('.map-idea-input');
        await page.keyboard.type('Une idée sur la carte libre');
        await page.keyboard.press('Escape');
        await wait(page, 200);
        const ns2 = await page.evaluate(() => window.__board().nodes);
        check(ns2.length === n0 + 1 && ns2.some((n) => n.text === 'Une idée sur la carte libre'), '[board] nouvelle idée enregistrée par set()');
        await page.locator('[data-act=fit]').click();
        await wait(page, 600);
      }
      await page.mouse.click(5, 5);
      await shot(page, `board-${theme}.png`);
      check(errors.length === 0, `[board ${theme}] aucune erreur`, errors.join(' | '));
      await ctx.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nTOUT PASSE');
  process.exit(failures ? 1 : 0);
}
main();
