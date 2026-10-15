// Carte d'argument, interface 11, 13, 14, 16, 17 (Vite + Chromium, port 5387) :
//   11. « Livre à côté » : glisser un passage sélectionné sur la carte (bouton de la barre de sélection
//       et texte lui-même) → menu de catégorie → extrait + carte au point de dépôt ; « Sur la carte » au clic ;
//       carte libre : choix du livre.
//   13. « Comparer avec un autre livre… » (menu de la carte, et depuis un espace) → carte libre à deux colonnes.
//   14. « Présenter » : étapes de guidedReadingOf, clavier, liens soulignés, « Masquer le texte ».
//   16. Plan et écrit créés à partir de la carte (aperçu, version automatique, ouverture).
//   17. Carte d'un mouvement depuis la fiche-texte : extraits du mouvement proposés d'abord, fil d'Ariane, retour.
// Lancer : timeout 400 node scripts/test-map-ui3.mjs        Captures : shots/map-ui3/ (clair, sombre, sépia)
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5387;
const OUT = path.join(ROOT, 'shots/map-ui3');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const shot = async (page, name) => {
  await page.waitForTimeout(400); // fin des animations d’ouverture
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('capture:', `shots/map-ui3/${name}`);
};
const wait = (page, ms) => page.waitForTimeout(ms);

const ROUSSEAU_MD = `# Du contrat social

## Livre I, chapitre 3 : Du droit du plus fort

Le plus fort n'est jamais assez fort pour être toujours le maître, s'il ne transforme sa force en droit et l'obéissance en devoir.

La force est une puissance physique ; je ne vois point quelle moralité peut résulter de ses effets. Céder à la force est un acte de nécessité, non de volonté.

Supposons un moment ce prétendu droit. Je dis qu'il n'en résulte qu'un galimatias inexplicable. Car sitôt que c'est la force qui fait le droit, l'effet change avec la cause.

Convenons donc que force ne fait pas droit, et qu'on n'est obligé d'obéir qu'aux puissances légitimes.
`;
const HOBBES_MD = `# Léviathan

## Chapitre XIII

Les hommes, tant qu'ils vivent sans un pouvoir commun qui les tienne tous en respect, sont dans cette condition qu'on appelle guerre, et cette guerre est guerre de chacun contre chacun.

Dans un tel état, la vie de l'homme est solitaire, besogneuse, pénible, quasi animale et brève.
`;

const anchor = (start, end = start + 5) => ({ kind: 'html', chapter: 0, start, end, prefix: '', suffix: '' });

async function seed(page) {
  return page.evaluate(
    async ({ R, H, A }) => {
      const s = () => window.__store.getState();
      const imp = async (name, md) => (await s().importFiles([{ name, data: new TextEncoder().encode(md).buffer }], { asBook: true }))[0].id;
      const r = await imp('contrat.md', R);
      const h = await imp('leviathan.md', H);
      s().updateBook(r, { title: 'Du contrat social', author: 'Jean-Jacques Rousseau' });
      s().updateBook(h, { title: 'Léviathan', author: 'Thomas Hobbes' });
      const now = Date.now();
      const hl = (id, bookId, category, text, start, plain) => ({ id, bookId, category, plain: plain || undefined, text, note: '', noteKind: null, conceptIds: [], anchor: A[start], locationLabel: 'Livre I, 3', printedPage: String(10 + start / 10), createdAt: now + start, updatedAt: now + start });
      const hs = [
        hl('r-pb', r, 'probleme', 'La force peut-elle fonder un droit ?', 5),
        hl('r-th', r, 'these', 'Force ne fait pas droit, et on n’est obligé d’obéir qu’aux puissances légitimes.', 10),
        hl('r-a1', r, 'argument', 'Céder à la force est un acte de nécessité, non de volonté.', 40),
        hl('r-a2', r, 'argument', 'Sitôt que c’est la force qui fait le droit, l’effet change avec la cause.', 80),
        hl('r-ob', r, 'objection', 'Le plus fort transforme sa force en droit et l’obéissance en devoir.', 120),
        hl('r-ex', r, 'exemple', 'Un brigand me surprend au coin d’un bois.', 150),
        hl('r-pl', r, null, 'un galimatias inexplicable', 200, true),
        hl('h-th', h, 'these', 'Sans pouvoir commun, la condition des hommes est la guerre de chacun contre chacun.', 10),
        hl('h-a1', h, 'argument', 'La vie de l’homme est solitaire, besogneuse, pénible, quasi animale et brève.', 40),
        hl('h-a2', h, 'argument', 'Égaux par nature, les hommes ont les mêmes espérances et se défient les uns des autres.', 80),
      ];
      window.__store.setState({ highlights: hs, toasts: [] });
      s().setMap(r, {
        bookId: r,
        nodes: [
          { id: 'n-pb', highlightId: 'r-pb', text: '', x: 0, y: 0 },
          { id: 'n-th', highlightId: 'r-th', text: '', x: 380, y: 0 },
          { id: 'n-a1', highlightId: 'r-a1', text: '', x: 160, y: 300 },
          { id: 'n-a2', highlightId: 'r-a2', text: '', x: 520, y: 300 },
          { id: 'n-ob', highlightId: 'r-ob', text: '', x: 880, y: 300 },
          { id: 'n-rep', highlightId: null, text: 'La force produit l’obéissance, non l’obligation.', x: 880, y: 580 },
        ],
        edges: [
          { id: 'e1', source: 'n-a1', target: 'n-th', relation: 'soutient', groupId: null },
          { id: 'e2', source: 'n-a2', target: 'n-th', relation: 'soutient', groupId: null, strength: 3 },
          { id: 'e3', source: 'n-ob', target: 'n-th', relation: 'objecte', groupId: null },
          { id: 'e4', source: 'n-rep', target: 'n-ob', relation: 'repond', groupId: null },
        ],
        viewport: null,
      });
      s().setMap(h, { bookId: h, nodes: [{ id: 'hn1', highlightId: 'h-th', text: '', x: 0, y: 0 }, { id: 'hn2', highlightId: 'h-a1', text: '', x: 0, y: 260 }], edges: [{ id: 'he', source: 'hn2', target: 'hn1', relation: 'soutient', groupId: null }], viewport: null });
      const st = { id: 'st1', bookId: r, title: 'Du droit du plus fort', probleme: '', these: '', enjeu: '', movements: [
        { id: 'mv1', anchor: A[0], startText: 'Le plus fort n’est jamais assez fort', title: 'La force ne fonde pas le droit', role: '' },
        { id: 'mv2', anchor: A[100], startText: 'Supposons un moment ce prétendu droit', title: 'Réfutation par l’absurde', role: '' },
      ], createdAt: now, updatedAt: now };
      s().insert('studies', st);
      return { r, h };
    },
    { R: ROUSSEAU_MD, H: HOBBES_MD, A: Object.fromEntries([0, 5, 10, 40, 80, 100, 120, 150, 200].map((k) => [k, anchor(k)])) },
  );
}

async function setTheme(page, theme) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme === 'sepia' ? 'light' : theme);
  await page.evaluate((t) => {
    if (t === 'sepia') document.documentElement.dataset.theme = 'sepia';
  }, theme);
}
async function openMap(page, bookId) {
  await page.evaluate((bookId) => window.__store.setState({ route: { name: 'reader', bookId, tab: 'carte', splitBookId: null } }), bookId);
  await page.waitForSelector('[data-testid=map-root] .react-flow__node');
  await wait(page, 700);
}
const mapOf = (page, key) => page.evaluate((k) => window.__store.getState().getMap(k), key);
/** Point d'écran → coordonnées de la carte (d'après la transformation du viewport). */
const toFlow = (page, pt) =>
  page.evaluate((pt) => {
    const root = document.querySelector('[data-testid=map-root] .react-flow');
    const r = root.getBoundingClientRect();
    const t = new DOMMatrix(getComputedStyle(root.querySelector('.react-flow__viewport')).transform);
    return { x: (pt.x - r.left - t.e) / t.a, y: (pt.y - r.top - t.f) / t.a };
  }, pt);
const zoomOf = (page) => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('[data-testid=map-root] .react-flow__viewport')).transform).a);

/** Sélectionne `needle` dans le livre à côté et attend la barre de sélection. */
async function selectInSide(page, needle) {
  await page.waitForSelector('.map-bookside .html-doc', { timeout: 15000 });
  await page.waitForFunction((n) => document.querySelector('.map-bookside .html-doc')?.textContent.includes(n), needle, { timeout: 15000 });
  await wait(page, 300);
  const pt = await page.evaluate((needle) => {
    const root = document.querySelector('.map-bookside .html-doc');
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.textContent.indexOf(needle);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + needle.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        const b = r.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }
    }
    return null;
  }, needle);
  await page.waitForSelector('[data-testid=sel-to-map]', { timeout: 5000 });
  return pt;
}

async function dragTo(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
}

async function main() {
  const server = await createServer({
    root: ROOT,
    cacheDir: path.join(os.tmpdir(), 'marginalia-vite-5387'),
    server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
    logLevel: 'error',
  });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/favicon|ResizeObserver/.test(m.text()) && errors.push('console: ' + m.text()));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    const { r, h } = await seed(page);
    await setTheme(page, 'light');

    // ═══ 11. Livre à côté : glisser un passage ═══
    await openMap(page, r);
    await page.click('[data-act=book-side]');
    await page.waitForSelector('[data-testid=map-bookside]');
    check(await page.locator('.map-stage.book-left [data-testid=map-bookside]').count() === 1, '11. « Livre à côté » ouvre le texte à gauche de la carte');
    const NEEDLE = 'Céder à la force est un acte de nécessité';
    await selectInSide(page, NEEDLE);
    const btn = await page.locator('[data-testid=sel-to-map]').boundingBox();
    const mapBox = await page.locator('.map-stage-map').boundingBox();
    const drop = { x: Math.round(mapBox.x + mapBox.width * 0.62), y: Math.round(mapBox.y + mapBox.height * 0.78) };
    const before = (await mapOf(page, r)).nodes.length;
    const flowDrop = await toFlow(page, drop);
    await dragTo(page, { x: btn.x + btn.width / 2, y: btn.y + btn.height / 2 }, drop);
    await page.waitForSelector('[data-testid=passage-menu]', { timeout: 3000 }).catch(() => null);
    check(await page.locator('[data-testid=passage-menu]').count() === 1, '11. dépôt du passage → menu de catégorie');
    await wait(page, 300);
    await shot(page, '11-depot-menu-clair.png');
    await page.keyboard.press('3');
    await wait(page, 500);
    let m = await mapOf(page, r);
    const hls = await page.evaluate(() => window.__store.getState().highlights);
    const created = hls.find((x) => x.text.startsWith(NEEDLE) && !x.id.startsWith('r-'));
    const node = created && m.nodes.find((n) => n.highlightId === created.id);
    check(!!created && created.category === 'argument' && created.bookId === r, '11. extrait créé dans le livre, catégorie choisie au dépôt (Argument)', created ? `${created.category} « ${created.text.slice(0, 40)}… »` : 'absent');
    check(m.nodes.length === before + 1 && !!node, '11. carte créée sur la carte du livre');
    if (node) {
      const box = await page.locator(`.react-flow__node[data-id="${node.id}"]`).boundingBox();
      const z = await zoomOf(page);
      const cx = box.x + box.width / 2;
      check(Math.abs(cx - drop.x) < 16 && Math.abs(box.y - (drop.y - 40 * z)) < 16, '11. carte posée à l’endroit du dépôt (écran)', `centre ${Math.round(cx)},${Math.round(box.y)} vs ${drop.x},${Math.round(drop.y - 40 * z)}`);
      check(Math.abs(node.x - (flowDrop.x - 140)) <= 4 && Math.abs(node.y - (flowDrop.y - 40)) <= 4, '11. carte posée à l’endroit du dépôt (carte)', `${node.x},${node.y} vs ${Math.round(flowDrop.x - 140)},${Math.round(flowDrop.y - 40)}`);
      check(await page.locator(`.react-flow__node.selected[data-id="${node.id}"]`).count() === 1, '11. la nouvelle carte est sélectionnée');
    }

    // Glisser le texte sélectionné lui-même
    const NEEDLE2 = 'force ne fait pas droit';
    const p2 = await selectInSide(page, NEEDLE2);
    const drop2 = { x: Math.round(mapBox.x + mapBox.width * 0.35), y: Math.round(mapBox.y + mapBox.height * 0.82) };
    await dragTo(page, p2, drop2);
    await page.waitForSelector('[data-testid=passage-menu]', { timeout: 3000 }).catch(() => null);
    check(await page.locator('[data-testid=passage-menu]').count() === 1, '11. glisser le texte sélectionné lui-même → menu');
    await page.keyboard.press('Enter'); // Surlignage par défaut
    await wait(page, 400);
    let hl2 = (await page.evaluate(() => window.__store.getState().highlights)).find((x) => x.text.includes(NEEDLE2) && x.bookId);
    m = await mapOf(page, r);
    check(!!hl2 && hl2.plain === true && hl2.category === null && m.nodes.some((n) => n.highlightId === hl2.id), '11. Entrée : « Surlignage » par défaut, carte créée');

    // Clic sur « Sur la carte » : menu, puis carte au centre de la vue
    const NEEDLE3 = 'galimatias inexplicable';
    await selectInSide(page, NEEDLE3);
    await page.click('[data-testid=sel-to-map]');
    await page.waitForSelector('[data-testid=passage-menu]', { timeout: 3000 }).catch(() => null);
    check(await page.locator('[data-testid=passage-menu]').count() === 1, '11. « Sur la carte » (clic) → menu');
    await page.keyboard.press('2');
    await wait(page, 400);
    const hl3 = (await page.evaluate(() => window.__store.getState().highlights)).find((x) => x.text === NEEDLE3 && x.category === 'these');
    m = await mapOf(page, r);
    check(!!hl3 && m.nodes.some((n) => n.highlightId === hl3.id), '11. « Sur la carte » : Thèse créée et posée');
    await page.click('[data-testid=bookside-swap]');
    await wait(page, 300);
    check(await page.locator('.map-stage.book-right [data-testid=map-bookside]').count() === 1, '11. le livre passe à droite');
    await shot(page, '11-livre-a-cote-clair.png');
    await page.click('[data-testid=bookside-close]');

    // Carte libre : choix du livre
    const bk = await page.evaluate(async () => {
      const a = await import('/src/features/map/model/actions.ts');
      const key = a.createBoard('Brouillon libre');
      window.__store.getState().navigate({ name: 'board', boardId: key });
      return key;
    });
    await page.waitForSelector('[data-testid=map-root]');
    await page.click('[data-act=book-side]');
    await page.waitForSelector('.map-bookside .ed-bookpick-item');
    check(true, '11. carte libre : « Livre à côté » propose de choisir le livre');
    await page.click(`.map-bookside .ed-bookpick-item[data-book="${h}"]`);
    await selectInSide(page, 'guerre de chacun contre chacun');
    await page.click('[data-testid=sel-to-map]');
    await page.waitForSelector('[data-testid=passage-menu]');
    await page.keyboard.press('2');
    await wait(page, 400);
    const bm = await mapOf(page, bk);
    check(bm.nodes.length === 1 && (bm.bookIds ?? []).includes(h), '11. carte libre : passage du livre choisi posé, livre ajouté à la carte', JSON.stringify(bm.bookIds));

    // ═══ 13. Comparer deux auteurs ═══
    await openMap(page, h);
    await page.click('[data-act=map-more]');
    await page.click('[data-testid=map-more-menu] [data-item=compare]');
    await page.waitForSelector('[data-testid=compare-dialog]');
    await page.click(`[data-testid=compare-dialog] .cmp-item[data-book="${r}"]`);
    await shot(page, '13-comparer-dialogue-clair.png');
    await page.click('[data-testid=compare-create]');
    await page.waitForSelector('[data-testid=board-title]');
    await wait(page, 800);
    let route = await page.evaluate(() => window.__store.getState().route);
    const cmp = await mapOf(page, route.boardId);
    const title = await page.textContent('[data-testid=board-title]');
    check(route.name === 'board' && /Hobbes \/ Rousseau/.test(title), '13. carte de comparaison ouverte, titre « Hobbes / Rousseau »', title);
    const hlsAll = Object.fromEntries((await page.evaluate(() => window.__store.getState().highlights)).map((x) => [x.id, x]));
    const hlBook = Object.fromEntries(Object.values(hlsAll).map((x) => [x.id, x.bookId]));
    const colH = cmp.nodes.filter((n) => hlBook[n.highlightId] === h);
    const colR = cmp.nodes.filter((n) => hlBook[n.highlightId] === r);
    const xs = (l) => [...new Set(l.map((n) => n.x))];
    const expCol = (b) => Object.values(hlsAll).filter((x) => x.bookId === b && (x.category === 'these' || x.category === 'argument')).length;
    check(colH.length === expCol(h) && colR.length === expCol(r) && colH.length >= 3, '13. thèses et arguments des deux livres', `Hobbes ${colH.length}, Rousseau ${colR.length}`);
    check(xs(colH).length === 1 && xs(colR).length === 1 && xs(colH)[0] < xs(colR)[0], '13. une colonne par livre (Hobbes à gauche, Rousseau à droite)', `${xs(colH)} | ${xs(colR)}`);
    check((cmp.zones ?? []).length === 2 && cmp.zones.map((z) => z.title).join(',') === 'Hobbes,Rousseau', '13. une zone titrée par colonne', (cmp.zones ?? []).map((z) => z.title).join(','));
    check(cmp.edges.some((e) => e.relation === 'soutient'), '13. les liens de la carte du livre sont repris');
    await shot(page, '13-comparaison-clair.png');
    // Relier deux livres : « s’oppose à » proposé
    const hTh = colH.find((n) => n.highlightId === 'h-th');
    const rTh = colR.find((n) => n.highlightId === 'r-th');
    await page.evaluate(() => (document.querySelector('[data-act=fit]')?.click()));
    await wait(page, 600);
    const a = await page.locator(`.react-flow__node[data-id="${hTh.id}"] .map-h-r`).boundingBox();
    const b = await page.locator(`.react-flow__node[data-id="${rTh.id}"]`).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
    await wait(page, 400);
    const cmp2 = await mapOf(page, route.boardId);
    check(cmp2.edges.some((e) => e.source === hTh.id && e.target === rTh.id && e.relation === 'oppose'), '13. relier deux livres : « s’oppose à » par défaut');
    await page.keyboard.press('Escape');

    // Depuis un espace
    const ws = await page.evaluate((h) => {
      const s = window.__store.getState();
      const w = s.createWorkspace('Philosophie politique');
      s.addToWorkspace(w.id, null, 'book', h);
      s.navigate({ name: 'workspace', workspaceId: w.id, groupId: null });
      return w.id;
    }, h);
    await page.waitForSelector('[data-testid=ws-compare]');
    await page.click('[data-testid=ws-compare]');
    await page.click(`[data-testid=compare-dialog] .cmp-item[data-book="${r}"]`);
    await page.click(`[data-testid=compare-dialog] .cmp-item[data-book="${h}"]`);
    await page.click('[data-testid=compare-create]');
    await page.waitForSelector('[data-testid=board-title]');
    route = await page.evaluate(() => window.__store.getState().route);
    const inWs = await page.evaluate(({ ws, key }) => window.__store.getState().wsItems.some((i) => i.workspaceId === ws && i.kind === 'map' && i.refId === key), { ws, key: route.boardId });
    check(inWs && /Rousseau \/ Hobbes/.test(await page.textContent('[data-testid=board-title]')), '13. depuis un espace : carte « Rousseau / Hobbes » rangée dans l’espace');

    // ═══ 14. Présenter ═══
    await openMap(page, r);
    const steps = await page.evaluate(async (k) => (await import('/src/features/map/model/actions.ts')).guidedReadingOf(k), r);
    const ROLE = { probleme: 'Problème', these: 'Thèse', argument: 'Argument', 'sous-argument': 'Sous-argument', exemple: 'Exemple', precision: 'Précision', opposition: 'Thèse opposée', objection: 'Objection', reponse: 'Réponse', reste: 'Idée restante' };
    const labelAt = (i) => {
      const s = steps[i];
      const all = steps.filter((x) => x.role === s.role);
      const k = steps.slice(0, i + 1).filter((x) => x.role === s.role).length;
      return all.length > 1 ? `${ROLE[s.role]} ${k}/${all.length}` : ROLE[s.role];
    };
    await page.click('[data-act=present]');
    await page.waitForSelector('[data-testid=present]');
    await wait(page, 900);
    const count = async () => (await page.textContent('[data-testid=pres-count]')).replace(/\s+/g, ' ').trim();
    check((await count()) === `1 / ${steps.length}`, '14. présentation : étape 1', await count());
    check((await page.textContent('[data-testid=pres-role]')) === 'Problème', '14. légende « Problème »');
    check(await page.locator(`.pres-root .react-flow__node.pres-cur[data-id="${steps[0].nodeId}"]`).count() === 1, '14. carte courante mise en valeur');
    await page.keyboard.press('ArrowRight');
    await wait(page, 300);
    check((await page.textContent('[data-testid=pres-role]')) === labelAt(1) && labelAt(1).startsWith('Thèse') && (await count()) === `2 / ${steps.length}`, `14. → : « ${labelAt(1)} », étape 2`);
    await page.keyboard.press(' ');
    await wait(page, 700);
    const s3 = steps[2];
    check((await page.textContent('[data-testid=pres-role]')) === labelAt(2) && /^Argument 1\//.test(labelAt(2)), `14. Espace : « ${labelAt(2)} »`, await page.textContent('[data-testid=pres-role]'));
    const lit = await page.locator('.pres-root .react-flow__edge.pres-edge-lit').count();
    console.log('   (liens rendus :', await page.locator('.pres-root .react-flow__edge').count(), ', viewport :', await page.evaluate(() => document.querySelector('.pres-root .react-flow__viewport').style.transform), ')');
    check(lit === s3.edgesToHighlight.length && lit > 0, '14. liens de l’étape soulignés', `${lit} / ${s3.edgesToHighlight.length}`);
    check(await page.locator('.pres-root .react-flow__node.pres-future').count() === steps.length - 3, '14. les cartes suivantes sont estompées');
    const center = await page.locator(`.pres-root .react-flow__node[data-id="${s3.nodeId}"]`).boundingBox();
    check(Math.abs(center.x + center.width / 2 - 720) < 60, '14. carte courante centrée', `${Math.round(center.x + center.width / 2)}`);
    await shot(page, '14-presenter-clair.png');
    await page.keyboard.press('ArrowLeft');
    await wait(page, 200);
    check((await count()) === `2 / ${steps.length}`, '14. ← : étape précédente');
    const w1 = await page.evaluate(() => parseFloat(document.querySelector('[data-testid=pres-progress]').style.width));
    check(w1 > 0 && w1 < 100, '14. barre de progression', `${w1.toFixed(0)} %`);
    await page.click('[data-testid=pres-hide]');
    await wait(page, 300);
    const masks = await page.locator('[data-testid=pres-mask]').count();
    check(masks === steps.length, '14. « Masquer le texte » : chaque carte n’affiche que son rôle', `${masks}`);
    await page.locator(`.pres-root .react-flow__node[data-id="${steps[1].nodeId}"]`).click();
    await wait(page, 200);
    check(await page.locator(`.pres-root .react-flow__node[data-id="${steps[1].nodeId}"] [data-testid=pres-mask]`).count() === 0 && (await page.locator('[data-testid=pres-mask]').count()) === steps.length - 1, '14. clic : la carte se révèle');
    await shot(page, '14-masquer-clair.png');
    await page.keyboard.press('Escape');
    await wait(page, 200);
    check(await page.locator('[data-testid=present]').count() === 0, '14. Échap quitte la présentation');

    // ═══ 16. Conversions ═══
    const vBefore = await page.evaluate(async (k) => (await import('/src/features/map/model/actions.ts')).versions(k).length, r);
    const expPlan = await page.evaluate(async (k) => {
      const a = await import('/src/features/map/model/actions.ts');
      const c = await import('/src/features/map/model/convert.ts');
      const p = c.mapToPlan(a.readMap(k), a.lookup());
      return { parts: p.parts.length };
    }, r);
    await page.click('[data-act=map-more]');
    await page.click('[data-testid=map-more-menu] [data-item=plan]');
    await page.waitForSelector('[data-testid=convert-dialog]');
    const prev = await page.textContent('[data-testid=convert-preview]');
    check(prev.includes(`${expPlan.parts} parties`) && /citations?/.test(prev), '16. aperçu : nombre de parties et de citations', prev.replace(/\s+/g, ' '));
    await shot(page, '16-plan-dialogue-clair.png');
    await page.click('[data-testid=convert-go]');
    await wait(page, 600);
    route = await page.evaluate(() => window.__store.getState().route);
    const plan = await page.evaluate((id) => window.__store.getState().plans.find((p) => p.id === id), route.planId);
    check(route.name === 'plans' && !!plan && plan.parts.length === expPlan.parts && plan.title.startsWith('Plan — '), '16. plan créé et ouvert', plan?.title);
    check(!!plan && plan.problematique.includes('Force ne fait pas droit') && plan.sujet.includes('La force peut-elle'), '16. plan : problématique = thèse, sujet = problème');
    const vs = await page.evaluate(async (k) => (await import('/src/features/map/model/actions.ts')).versions(k), r);
    check(vs.length === vBefore + 1 && vs[0].reason === 'convert', '16. version automatique avant la conversion');
    await openMap(page, r);
    await page.click('[data-act=map-more]');
    await page.click('[data-testid=map-more-menu] [data-item=draft]');
    await page.waitForSelector('[data-testid=convert-dialog]');
    await page.fill('[data-testid=convert-title]', 'Explication — Du droit du plus fort');
    await page.click('[data-testid=convert-go]');
    await page.waitForFunction(() => window.__store.getState().route.name === 'write', null, { timeout: 15000 });
    route = await page.evaluate(() => window.__store.getState().route);
    const draft = await page.evaluate((id) => window.__store.getState().drafts.find((d) => d.id === id), route.draftId);
    check(!!draft && draft.title === 'Explication — Du droit du plus fort', '16. écrit créé et ouvert', draft?.title);
    await page.waitForFunction(() => document.body.innerText.includes('Céder à la force est un acte de nécessité'), null, { timeout: 15000 }).catch(() => null);
    check(await page.evaluate(() => document.body.innerText.includes('Céder à la force est un acte de nécessité')), '16. l’écrit cite les extraits de la carte');

    // ═══ 17. Carte d'un mouvement ═══
    await page.evaluate((bookId) => {
      const s = window.__store.getState();
      s.updateSettings({ showExtracts: true, rightPanel: 'etude' });
      s.navigate({ name: 'reader', bookId, tab: 'lecture', splitBookId: null });
    }, r);
    await page.waitForSelector('.study-move[data-mid="mv2"] [data-testid=movement-map]');
    await page.click('.study-move[data-mid="mv2"] [data-testid=movement-map]');
    await page.waitForSelector('[data-testid=crumb-movement]');
    await wait(page, 600);
    route = await page.evaluate(() => window.__store.getState().route);
    const crumb = await page.textContent('[data-testid=crumb-movement]');
    check(route.tab === 'carte' && /^II\. Réfutation/.test(crumb), '17. « Carte du mouvement » ouvre sa carte, fil d’Ariane « Livre › II. … »', crumb);
    const mvMap = await page.evaluate(() => Object.values(window.__store.getState().maps).find((m) => m.kind === 'movement' && m.movementId === 'mv2'));
    check(!!mvMap && mvMap.studyId === 'st1', '17. carte de mouvement créée par le modèle');
    const drawerOpen = await page.locator('[data-testid=map-drawer]').count();
    if (!drawerOpen) await page.click('[data-testid=map-drawer-open]');
    await page.waitForSelector('[data-testid=drawer-priority]');
    const prio = await page.$$eval('.map-drawer-item', (els) => els.map((e) => ({ id: e.dataset.hl, p: e.dataset.prio === '1' })));
    const firstIds = prio.filter((x) => x.p).map((x) => x.id);
    const lastPrio = prio.map((x) => x.p).lastIndexOf(true);
    const firstOther = prio.map((x) => x.p).indexOf(false);
    check(['r-ob', 'r-ex', 'r-pl'].every((id) => firstIds.includes(id)) && !firstIds.some((id) => ['r-pb', 'r-th', 'r-a1'].includes(id)) && (firstOther < 0 || lastPrio < firstOther), '17. « À placer » : extraits du mouvement en premier', prio.map((x) => x.id + (x.p ? '*' : '')).join(' '));
    const cand = prio.filter((x) => x.p).length;
    check(new RegExp(`${cand} extraits? du mouvement à placer`).test(await page.textContent('[data-testid=movement-to-place]')), '17. compteur des extraits du mouvement', `${cand}`);
    await shot(page, '17-mouvement-clair.png');
    await page.click('[data-testid=movement-picker]');
    check(await page.locator('.map-strip-menu [data-movement=mv1]').count() === 1 && (await page.locator('.map-strip-menu [data-movement=mv2]').count()) === 1, '17. sélecteur des cartes de mouvement');
    await page.keyboard.press('Escape');
    await page.click('[data-testid=crumb-book]');
    await wait(page, 500);
    check(await page.locator('[data-testid=crumb-movement]').count() === 0 && (await page.locator('.react-flow__node[data-id="n-th"]').count()) === 1, '17. retour à la carte du livre');

    // ═══ Captures sombre / sépia ═══
    for (const theme of ['dark', 'sepia']) {
      await setTheme(page, theme);
      await openMap(page, r);
      await page.click('[data-act=book-side]');
      await selectInSide(page, 'puissance physique');
      await page.click('[data-testid=sel-to-map]');
      await page.waitForSelector('[data-testid=passage-menu]');
      await wait(page, 300);
      await shot(page, `11-livre-a-cote-${theme}.png`);
      await page.keyboard.press('Escape');
      await page.click('[data-testid=bookside-close]');
      await page.click('[data-act=present]');
      await page.waitForSelector('[data-testid=present]');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await wait(page, 900);
      await shot(page, `14-presenter-${theme}.png`);
      await page.click('[data-testid=pres-hide]');
      await wait(page, 300);
      await shot(page, `14-masquer-${theme}.png`);
      await page.keyboard.press('Escape');
      await page.click('[data-act=map-more]');
      await page.click('[data-testid=map-more-menu] [data-item=plan]');
      await page.waitForSelector('[data-testid=convert-dialog]');
      await shot(page, `16-plan-dialogue-${theme}.png`);
      await page.keyboard.press('Escape');
      await page.click('[data-act=map-more]');
      await page.click('[data-testid=map-more-menu] [data-item=compare]');
      await page.waitForSelector('[data-testid=compare-dialog]');
      await page.click(`[data-testid=compare-dialog] .cmp-item[data-book="${h}"]`);
      await shot(page, `13-comparer-dialogue-${theme}.png`);
      await page.keyboard.press('Escape');
      await page.evaluate(async () => {
        const mv = await import('/src/features/map/ui/movement/movement.ts');
        mv.goToMovementMap('st1', 'mv2');
      });
      await page.waitForSelector('[data-testid=crumb-movement]');
      await wait(page, 600);
      if (!(await page.locator('[data-testid=map-drawer]').count())) await page.click('[data-testid=map-drawer-open]');
      await wait(page, 300);
      await shot(page, `17-mouvement-${theme}.png`);
      await page.click('[data-testid=crumb-book]');
      const cmpKey = await page.evaluate(() => Object.values(window.__store.getState().maps).find((m) => m.kind === 'board' && m.title === 'Hobbes / Rousseau')?.id);
      await page.evaluate((k) => window.__store.getState().navigate({ name: 'board', boardId: k }), cmpKey);
      await page.waitForSelector('[data-testid=map-root] .react-flow__node');
      await page.evaluate(() => document.querySelector('[data-act=fit]')?.click());
      await wait(page, 700);
      await shot(page, `13-comparaison-${theme}.png`);
      await page.evaluate(() => delete document.documentElement.dataset.theme);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const real = errors.filter((e) => !/Failed to load resource/.test(e));
  if (real.length) {
    console.log('ERREURS NAVIGATEUR:\n' + real.join('\n'));
    failures += real.length;
  }
  console.log(failures ? `\n${failures} échec(s)` : '\nTout est bon.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
