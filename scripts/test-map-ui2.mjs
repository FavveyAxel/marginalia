// Test de l'interface de la carte d'argument, 2e lot : 12. zones, 15. signaux de manques,
// 18. export (PNG, SVG, PDF, insertion dans un écrit), 19. versions, 20. notes sur les liens —
// sur la carte d'un livre (thème clair) ET sur une carte libre (thème sombre), captures en
// clair, sombre et sépia. Port 5386. Captures : shots/map-ui2/.
// Lancer : timeout 400 node scripts/test-map-ui2.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5386;
const OUT = path.join(ROOT, 'shots/map-ui2');
fs.mkdirSync(OUT, { recursive: true });
const MOD = 'Meta';

let failures = 0;
let passed = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${msg}${extra ? ` — ${extra}` : ''}`);
  if (ok) passed++;
  else failures++;
};
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('capture:', `shots/map-ui2/${name}`);
};
const wait = (page, ms) => page.waitForTimeout(ms);

const LONG =
  'la puissance de bien juger et distinguer le vrai d’avec le faux, qui est proprement ce qu’on nomme le bon sens ou la raison, est naturellement égale en tous les hommes';
const HL = [
  ['h-these', 'these', LONG, 10],
  ['h-arg1', 'argument', 'ceux qui ne marchent que fort lentement peuvent avancer beaucoup davantage, s’ils suivent toujours le droit chemin', 40],
  ['h-arg2', 'argument', 'ce n’est pas assez d’avoir l’esprit bon, mais le principal est de l’appliquer bien', 30],
  ['h-obj', 'objection', 'chacun pense en être si bien pourvu, que ceux même qui sont les plus difficiles à contenter n’en désirent pas plus', 50],
  ['h-ex', 'exemple', 'les plus grandes âmes sont capables des plus grands vices, aussi bien que des plus grandes vertus', 60],
  ['h-cpt', 'concept', 'ne recevoir jamais aucune chose pour vraie que je ne la connusse évidemment être telle', 70],
  // Non placés (catégorisés) : signalés par le panneau des manques.
  ['h-arg3', 'argument', 'il vaut mieux suivre une route droite que d’errer çà et là', 80],
  ['h-ex2', 'exemple', 'les voyageurs égarés dans une forêt ne doivent pas tournoyer', 90],
];

async function seed(page) {
  return page.evaluate(
    async ({ HL, LONG: _l }) => {
      const s = window.__store.getState();
      const imp = async (name, title, author) => {
        const [b] = await s.importFiles([{ name, data: new TextEncoder().encode(`# ${title}\n\nTexte.`).buffer }], { asBook: true });
        window.__store.getState().updateBook(b.id, { title, author });
        return b.id;
      };
      const bD = await imp('discours.md', 'Discours de la méthode', 'René Descartes');
      const bK = await imp('kant.md', 'D’un prétendu droit de mentir', 'Emmanuel Kant');
      const bC = await imp('constant.md', 'Des réactions politiques', 'Benjamin Constant');
      const now = Date.now();
      const mk = (id, bookId, category, text, off, i) => ({
        id,
        bookId,
        category,
        text,
        note: '',
        noteKind: null,
        conceptIds: [],
        anchor: { kind: 'html', chapter: 0, start: off, end: off + 5, prefix: '', suffix: '' },
        locationLabel: 'Première partie',
        printedPage: String(3 + i),
        createdAt: now + i,
        updatedAt: now + i,
      });
      const hs = HL.map(([id, c, t, off], i) => mk(id, bD, c, t, off, i));
      hs.push(
        mk('hK1', bK, 'these', 'La véracité est un devoir formel de l’homme envers chacun', 10, 20),
        mk('hK2', bK, 'argument', 'Le mensonge nuit toujours à autrui, sinon à un homme du moins à l’humanité', 20, 21),
        mk('hC1', bC, 'these', 'Nul homme n’a droit à la vérité qui nuit à autrui', 40, 22),
        mk('hC2', bC, 'objection', 'Dire la vérité n’est un devoir qu’envers ceux qui ont droit à la vérité', 50, 23),
      );
      const P = { 'h-these': [380, 40], 'h-arg1': [60, 380], 'h-arg2': [400, 400], 'h-obj': [760, 380], 'h-ex': [60, 700], 'h-cpt': [760, 40] };
      const nodes = Object.entries(P).map(([hid, [x, y]]) => ({ id: 'n-' + hid.slice(2), highlightId: hid, text: '', x, y }));
      nodes.push({ id: 'n-idea', highlightId: null, text: 'La raison est partagée, la méthode ne l’est pas.', x: 1120, y: 220 });
      nodes.push({ id: 'n-lone', highlightId: null, text: 'Idée à rattacher plus tard', x: 1120, y: 560 });
      const edges = [
        { id: 'e1', source: 'n-arg1', target: 'n-these', relation: 'soutient', groupId: null, strength: 3 },
        { id: 'e2', source: 'n-arg2', target: 'n-these', relation: 'soutient', groupId: null },
        { id: 'e3', source: 'n-obj', target: 'n-these', relation: 'objecte', groupId: null },
        { id: 'e4', source: 'n-ex', target: 'n-arg1', relation: 'illustre', groupId: null, strength: 1 },
        { id: 'e5', source: 'n-cpt', target: 'n-these', relation: 'precise', groupId: null },
        { id: 'e6', source: 'n-idea', target: 'n-cpt', relation: 'precise', groupId: null },
      ];
      window.__store.setState({ highlights: hs, toasts: [] });
      window.__store.getState().setMap(bD, { bookId: bD, nodes, edges, viewport: null });
      // Carte libre : Kant / Constant.
      const t = Date.now();
      window.__store.getState().setMap('B1', {
        id: 'B1',
        kind: 'board',
        bookId: '',
        bookIds: [bK, bC],
        title: 'liberté : Kant et Constant',
        nodes: [
          { id: 'K1', highlightId: 'hK1', text: '', x: 0, y: 0 },
          { id: 'K2', highlightId: 'hK2', text: '', x: 0, y: 300 },
          { id: 'C1', highlightId: 'hC1', text: '', x: 520, y: 0 },
          { id: 'C2', highlightId: 'hC2', text: '', x: 520, y: 300 },
          { id: 'I1', highlightId: null, text: 'Le cas de l’assassin à la porte', x: 260, y: 600 },
        ],
        edges: [
          { id: 'b1', source: 'K2', target: 'K1', relation: 'soutient', groupId: null },
          { id: 'b2', source: 'C2', target: 'K1', relation: 'objecte', groupId: null },
          { id: 'b3', source: 'I1', target: 'C2', relation: 'illustre', groupId: null },
        ],
        zones: [],
        viewport: null,
        createdAt: t,
        updatedAt: t,
      });
      return bD;
    },
    { HL, LONG },
  );
}

/** Remplace l'enregistrement et l'impression PDF de l'hôte navigateur (fichiers capturés). */
async function stubHost(page) {
  await page.evaluate(async () => {
    const { host } = await import('/src/lib/platform.ts');
    window.__saved = [];
    window.__printed = [];
    host.saveBinary = async (name, data, format) => {
      window.__saved.push({ name, format, data });
      return '/tmp/' + name;
    };
    host.printToPdf = async (html) => {
      window.__printed.push(html);
      // PDF minimal : le vrai rendu est fait par Electron (printToPdf) ; on vérifie le HTML transmis.
      return new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n').buffer;
    };
  });
}

const getMap = (page, key) => page.evaluate((k) => window.__store.getState().maps[k] ?? window.__store.getState().getMap(k), key);
const box = (page, sel) => page.locator(sel).boundingBox();
const nodeBox = (page, id) => box(page, `.react-flow__node[data-id="${id}"]`);
const members = (page, key, zid) =>
  page.evaluate(
    async ({ key, zid }) => {
      const M = await import('/src/features/map/model/index.ts');
      const s = window.__store.getState();
      return M.nodesInZone(s.maps[key] ?? s.getMap(key), zid, { highlights: s.highlights, books: s.books });
    },
    { key, zid },
  );

async function drag(page, from, to, steps = 16) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) * 0.3, from.y + (to.y - from.y) * 0.3, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}
const headOf = async (page, id) => {
  const b = await nodeBox(page, id);
  return { x: b.x + b.width / 2, y: b.y + 14 };
};

async function setTheme(page, theme) {
  await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme === 'sepia' ? 'light' : theme);
  await page.evaluate((t) => {
    if (t === 'sepia') document.documentElement.dataset.theme = 'sepia';
  }, theme);
  await wait(page, 150);
}

async function openBook(page, bookId) {
  await page.evaluate((bookId) => window.__store.setState({ route: { name: 'reader', bookId, tab: 'carte', splitBookId: null } }), bookId);
  await page.waitForSelector('[data-testid=map-root] .react-flow__node');
  await wait(page, 700);
  if (await page.locator('[data-testid=map-drawer]').count()) await page.locator('[data-testid=map-drawer] header .icon-btn').click();
  await page.locator('[data-act=fit]').click();
  await wait(page, 600);
}

/** Exporte via le menu et renvoie { name, format, size, head, text? } du fichier capturé. */
async function exportVia(page, kind) {
  const before = await page.evaluate(() => window.__saved.length);
  await page.locator('[data-act=export]').click();
  await page.waitForSelector('[data-testid=map-export-menu]');
  await page.locator(`[data-testid=map-export-menu] [data-export=${kind}]`).click();
  await page.waitForFunction((n) => window.__saved.length > n, before, { timeout: 15000 });
  return page.evaluate(async () => {
    const f = window.__saved[window.__saved.length - 1];
    const u = new Uint8Array(f.data);
    const out = { name: f.name, format: f.format, size: u.byteLength, head: Array.from(u.slice(0, 8)) };
    if (f.format === 'svg') {
      const text = new TextDecoder().decode(u);
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      out.parsed = !doc.querySelector('parsererror') && doc.documentElement.tagName === 'svg';
      out.text = text;
    }
    if (f.format === 'png') {
      // Pixel du coin haut gauche : fond clair, quel que soit le thème.
      const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      out.corner = Array.from(ctx.getImageData(3, 3, 1, 1).data);
      out.dims = [bmp.width, bmp.height];
    }
    return out;
  });
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function main() {
  const server = await createServer({
    root: ROOT,
    cacheDir: path.join(os.tmpdir(), 'marginalia-vite-5386'),
    server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
    logLevel: 'error',
  });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    const bookId = await seed(page);
    await stubHost(page);

    // ═══ A. Carte d'un livre, thème clair ═══
    await setTheme(page, 'light');
    await openBook(page, bookId);

    // ── 12. Zones ──
    await page.mouse.click(...Object.values(await headOf(page, 'n-arg1')));
    await page.keyboard.down(MOD);
    await page.mouse.click(...Object.values(await headOf(page, 'n-arg2')));
    await page.keyboard.up(MOD);
    await wait(page, 300);
    check((await page.locator('[data-testid=map-selbar] [data-act=frame-zone]').count()) === 1, '12. barre de sélection : « Encadrer dans une zone »');
    await page.locator('[data-testid=map-selbar] [data-act=frame-zone]').click();
    await wait(page, 300);
    let m = await getMap(page, bookId);
    const zid = m.zones?.[0]?.id;
    check(m.zones?.length === 1, '12. zone créée autour de la sélection');
    check(await page.locator('.map-zone-input').evaluate((el) => el === document.activeElement), '12. titre de la nouvelle zone en édition');
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.type('Arguments de la méthode');
    await page.keyboard.press('Enter');
    await wait(page, 200);
    m = await getMap(page, bookId);
    check(m.zones[0].title === 'Arguments de la méthode', '12. titre édité en place', m.zones[0].title);
    check((await members(page, bookId, zid)).sort().join() === 'n-arg1,n-arg2', '12. la zone contient les deux cartes');
    const zstyle = await page.evaluate(() => {
      const layer = document.querySelector('.map-zones');
      const zone = document.querySelector('.map-zone');
      const r = zone.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 10, r.top + r.height / 2);
      return { z: getComputedStyle(layer).zIndex, radius: getComputedStyle(zone).borderTopLeftRadius, hit: hit?.className?.baseVal ?? hit?.className ?? '' };
    });
    check(zstyle.z === '-1' && parseFloat(zstyle.radius) >= 12, '12. zone dessinée sous les cartes, coins arrondis', JSON.stringify(zstyle));
    check(/react-flow__pane/.test(zstyle.hit), '12. le corps de la zone laisse passer les clics (fond de carte)', zstyle.hit);
    // Encadrer depuis le clic droit (une seule carte) : entrée présente.
    await page.locator('.react-flow__node[data-id="n-cpt"]').click({ button: 'right' });
    check((await page.getByRole('menuitem', { name: 'Encadrer dans une zone' }).count()) === 1, '12. clic droit : « Encadrer dans une zone »');
    await page.keyboard.press('Escape');
    await page.mouse.click(960, 660);
    await wait(page, 200);
    await shot(page, 'light-1-zone.png');

    // Déplacer la zone : son contenu suit.
    const zoom = await page.evaluate(() => {
      const t = document.querySelector('.react-flow__viewport').style.transform;
      return parseFloat(/scale\(([\d.]+)\)/.exec(t)?.[1] ?? '1');
    });
    let m0 = await getMap(page, bookId);
    let hb = await box(page, `.map-zone[data-zone="${zid}"] .map-zone-head`);
    await drag(page, { x: hb.x + hb.width - 140, y: hb.y + hb.height / 2 }, { x: hb.x + hb.width - 140 + 90, y: hb.y + hb.height / 2 + 60 });
    await wait(page, 300);
    m = await getMap(page, bookId);
    const dzx = m.zones[0].x - m0.zones[0].x;
    const dnx = m.nodes.find((n) => n.id === 'n-arg1').x - m0.nodes.find((n) => n.id === 'n-arg1').x;
    const dny = m.nodes.find((n) => n.id === 'n-arg2').y - m0.nodes.find((n) => n.id === 'n-arg2').y;
    const dzy = m.zones[0].y - m0.zones[0].y;
    check(Math.abs(dzx - 90 / zoom) < 3 && dnx === dzx && dny === dzy && m.nodes.find((n) => n.id === 'n-these').x === m0.nodes.find((n) => n.id === 'n-these').x, '12. glisser la zone déplace son contenu (et lui seul)', `zone +${dzx},${dzy} ; carte +${dnx},${dny}`);
    // Redimensionner.
    const rb = await box(page, `.map-zone[data-zone="${zid}"] [data-act=zone-resize]`);
    await drag(page, { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 }, { x: rb.x + rb.width / 2 + 40, y: rb.y + rb.height / 2 + 50 });
    await wait(page, 250);
    const m1 = await getMap(page, bookId);
    check(m1.zones[0].w > m.zones[0].w + 30 / zoom && m1.zones[0].h > m.zones[0].h + 40 / zoom, '12. poignée : redimensionner', `${m.zones[0].w}×${m.zones[0].h} → ${m1.zones[0].w}×${m1.zones[0].h}`);
    // Glisser une carte dans la zone, puis hors de la zone.
    const zr = await box(page, `.map-zone[data-zone="${zid}"]`);
    const exH = await headOf(page, 'n-ex');
    const exB = await nodeBox(page, 'n-ex');
    const into = { x: zr.x + zr.width - exB.width / 2 - 30, y: zr.y + zr.height - exB.height / 2 - 20 + 14 - exB.height / 2 + 14 };
    await page.mouse.move(exH.x, exH.y);
    await page.mouse.down();
    await page.mouse.move(exH.x + 20, exH.y - 20, { steps: 3 });
    await page.mouse.move(into.x, into.y, { steps: 16 });
    await wait(page, 120);
    const lit = await page.locator(`.map-zone[data-zone="${zid}"].drop`).count();
    await page.mouse.up();
    await wait(page, 400);
    check(lit === 1, '12. pendant le glisser, la zone visée s’éclaire');
    check((await members(page, bookId, zid)).includes('n-ex'), '12. carte glissée dans la zone : elle en fait partie');
    const exH2 = await headOf(page, 'n-ex');
    await drag(page, exH2, { x: exH2.x, y: zr.y + zr.height + 160 });
    await wait(page, 400);
    check(!(await members(page, bookId, zid)).includes('n-ex'), '12. carte glissée hors de la zone : elle n’en fait plus partie');
    // Replier / déplier.
    await page.locator(`.map-zone[data-zone="${zid}"] .map-zone-head`).hover();
    await page.locator(`.map-zone[data-zone="${zid}"] [data-act=zone-collapse]`).click();
    await wait(page, 350);
    m = await getMap(page, bookId);
    const hiddenCount = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].filter((n) => n.style.visibility === 'hidden' || n.offsetParent === null).length);
    const shownArg1 = await page.locator('.react-flow__node[data-id="n-arg1"]').count();
    const chip = await page.locator(`.map-zone[data-zone="${zid}"] [data-testid=zone-count]`).innerText().catch(() => '');
    check(m.zones[0].collapsed && m.zones[0].hiddenNodeIds.length === 2 && (shownArg1 === 0 || hiddenCount >= 2), '12. zone repliée : cartes masquées', `${shownArg1} / ${hiddenCount}`);
    check(/2 cartes/.test(chip), '12. étiquette compacte avec le nombre de cartes', chip);
    check((await page.locator('.react-flow__edge[data-id="e1"]').count()) === 0, '12. liens des cartes masquées cachés');
    {
      const proxies = await page.locator('[data-testid=zone-proxy-links] line').count();
      check(proxies >= 1, '12. liens sortants suggérés depuis l’étiquette repliée', `${proxies} trait(s)`);
    }
    await shot(page, 'light-2-zone-repliee.png');
    await page.locator(`.map-zone[data-zone="${zid}"] [data-act=zone-expand]`).click();
    await wait(page, 350);
    m = await getMap(page, bookId);
    check(!m.zones[0].collapsed && (await page.locator('.react-flow__node[data-id="n-arg1"]').isVisible()), '12. zone dépliée');
    // Couleur.
    await page.locator(`.map-zone[data-zone="${zid}"] .map-zone-head`).hover();
    await page.locator(`.map-zone[data-zone="${zid}"] [data-act=zone-color]`).click();
    await page.getByRole('menuitem', { name: 'Bleu' }).click();
    check((await getMap(page, bookId)).zones[0].color === '--cat-concept', '12. couleur de la zone (palette douce)');
    // Rangement : la zone est rangée comme un bloc, son contenu garde sa disposition.
    m0 = await getMap(page, bookId);
    const rel0 = m0.nodes.find((n) => n.id === 'n-arg2').x - m0.nodes.find((n) => n.id === 'n-arg1').x;
    const off0 = m0.nodes.find((n) => n.id === 'n-arg1').x - m0.zones[0].x;
    await page.locator('[data-act=organise]').click();
    await page.locator('[data-layout=arbre]').click();
    await wait(page, 900);
    m = await getMap(page, bookId);
    const rel1 = m.nodes.find((n) => n.id === 'n-arg2').x - m.nodes.find((n) => n.id === 'n-arg1').x;
    const off1 = m.nodes.find((n) => n.id === 'n-arg1').x - m.zones[0].x;
    check(rel0 === rel1 && off0 === off1 && (await members(page, bookId, zid)).sort().join() === 'n-arg1,n-arg2', '12. rangement automatique : la zone reste un bloc avec son contenu');
    let vers = await page.evaluate((k) => (window.__store.getState().mapVersions ?? []).filter((v) => v.mapKey === k), bookId);
    check(vers.some((v) => v.reason === 'layout'), '19. instantané automatique avant le rangement');
    await shot(page, 'light-3-rangement-zone.png');
    // Supprimer la zone (les cartes restent), annulable.
    await page.locator(`.map-zone[data-zone="${zid}"] .map-zone-head`).click({ button: 'right', position: { x: 60, y: 18 } });
    await page.getByRole('menuitem', { name: /Supprimer la zone/ }).click();
    await wait(page, 200);
    m = await getMap(page, bookId);
    check(!m.zones?.length && m.nodes.length === 8, '12. supprimer la zone sans supprimer les cartes');
    await page.evaluate(() => window.__store.getState().undo());
    await wait(page, 250);
    check((await getMap(page, bookId)).zones?.length === 1, '12. suppression de la zone annulable (⌘Z)');

    // ── 20. Notes sur les liens ──
    await page.locator('[data-act=fit]').click();
    await wait(page, 600);
    await page.locator('.map-pill[data-edge="e2"]').click();
    await page.waitForSelector('[data-testid=map-edge-menu]');
    check((await page.locator('[data-testid=edge-note]').count()) === 1, '20. menu du lien : champ « Pourquoi ? »');
    await page.locator('[data-testid=edge-note]').fill('par analogie avec le voyageur');
    await shot(page, 'light-4-menu-note.png');
    await page.locator('[data-testid=edge-note]').press('Enter');
    await wait(page, 150);
    check((await getMap(page, bookId)).edges.find((e) => e.id === 'e2').note === 'par analogie avec le voyageur', '20. note enregistrée');
    await page.keyboard.press('Escape');
    await page.mouse.move(5, 400);
    await wait(page, 300);
    check((await page.locator('.map-pill[data-edge="e2"] .map-pill-mark').count()) === 1 && (await page.locator('.map-pill[data-edge="e1"] .map-pill-mark').count()) === 0, '20. petite marque sur le lien annoté');
    const pb = await box(page, '.map-pill[data-edge="e2"]');
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await wait(page, 400);
    const noteShown = await page.locator('.map-pill[data-edge="e2"]').evaluate((el) => {
      const n = el.querySelector('.map-pill-note');
      const l = el.querySelector('.map-pill-label');
      return !!n && el.classList.contains('show') && getComputedStyle(l).opacity !== '0' && n.getBoundingClientRect().top > l.getBoundingClientRect().top && n.textContent;
    });
    check(noteShown === 'par analogie avec le voyageur', '20. au survol : la note sous le nom de la relation', String(noteShown));
    await shot(page, 'light-5-note-survol.png');
    await page.mouse.move(5, 400);

    // ── 15. Signaux de manques ──
    const model = await page.evaluate(async (k) => {
      const M = await import('/src/features/map/model/index.ts');
      const s = window.__store.getState();
      return M.mapGaps(s.maps[k], { highlights: s.highlights, books: s.books, studies: s.studies });
    }, bookId);
    const pillText = await page.locator('[data-act=gaps]').innerText();
    check(model.total > 0 && pillText.includes(`${model.total} points à revoir`), '15. pastille « N points à revoir » dans la barre', pillText);
    await page.locator('[data-act=gaps]').click();
    await page.waitForSelector('[data-testid=map-gaps-panel]');
    const groups = await page.locator('[data-testid=map-gaps-panel] .map-gap-group').evaluateAll((els) => els.map((e) => e.dataset.gap));
    check(groups.includes('objection') && groups.includes('unplaced') && groups.includes('isolated'), '15. panneau : objection sans réponse, extraits non placés, cartes isolées', groups.join(','));
    await wait(page, 450);
    await shot(page, 'light-6-signaux.png');
    await page.locator('[data-testid=map-gaps-panel] .map-gap-item[data-node="n-lone"]').click();
    await wait(page, 700);
    const focus = await page.evaluate(() => {
      const n = document.querySelector('.react-flow__node[data-id="n-lone"]');
      const r = n.getBoundingClientRect();
      const root = document.querySelector('[data-testid=map-root]').getBoundingClientRect();
      return { sel: n.classList.contains('selected'), flash: n.classList.contains('map-flash'), cx: r.left + r.width / 2 - root.left, cy: r.top + r.height / 2 - root.top, w: root.width, h: root.height };
    });
    check(focus.sel && focus.flash && focus.cx > 200 && focus.cx < focus.w - 340 && Math.abs(focus.cy - focus.h / 2) < 60, '15. clic sur un signal : carte centrée et mise en évidence', JSON.stringify(focus));
    await page.locator('[data-act=gap-marks]').check();
    await wait(page, 200);
    check((await page.locator('.react-flow__node.map-gap[data-id="n-lone"]').count()) === 1 && (await page.locator('.react-flow__node.map-gap-objection[data-id="n-obj"]').count()) === 1, '15. « Afficher les signaux » : marques sur les cartes');
    await shot(page, 'light-7-signaux-marques.png');
    const nBefore = (await getMap(page, bookId)).nodes.length;
    await page.locator('[data-testid=map-gaps-panel] [data-act=gap-place][data-hl="h-arg3"]').click();
    await wait(page, 500);
    m = await getMap(page, bookId);
    check(m.nodes.length === nBefore + 1 && m.nodes.some((n) => n.highlightId === 'h-arg3'), '15. « Placer » ajoute l’extrait sur la carte');
    await page.locator('[data-act=gaps]').click();
    await wait(page, 200);

    // ── 18. Export ──
    const png = await exportVia(page, 'png');
    check(png.name === 'Discours de la méthode.png' && png.size > 5000 && PNG_SIG.every((b, i) => png.head[i] === b), '18. PNG : nom = titre, en-tête PNG, non vide', `${png.name} ${png.size} o ${png.dims}`);
    check(png.corner[0] > 240 && png.corner[1] > 240 && png.corner[2] > 230, '18. PNG sur fond clair', png.corner.join(','));
    const svg = await exportVia(page, 'svg');
    check(svg.parsed && svg.name.endsWith('.svg') && svg.size > 2000, '18. SVG parsable, non vide', `${svg.size} o`);
    check(svg.text.includes('par analogie avec le voyageur') && svg.text.includes('class="zone"'), '18. SVG : note du lien et zone incluses');
    fs.writeFileSync(path.join(OUT, 'export-livre.svg'), svg.text);
    const pdf = await exportVia(page, 'pdf');
    const printed = await page.evaluate(() => window.__printed[window.__printed.length - 1]);
    check(pdf.name === 'Discours de la méthode.pdf' && String.fromCharCode(...pdf.head.slice(0, 5)) === '%PDF-' && printed.includes('<svg') && printed.includes('@page{size:A4'), '18. PDF : HTML A4 avec la carte transmis à l’impression, en-tête %PDF', pdf.name);
    // Insérer dans un écrit (nouvel écrit).
    await page.locator('[data-act=export]').click();
    await page.locator('[data-export=draft]').click();
    await page.waitForSelector('[data-testid=map-insert-dialog]');
    await wait(page, 450);
    await shot(page, 'light-8-inserer.png');
    const drafts0 = await page.evaluate(() => window.__store.getState().drafts.length);
    await page.locator('[data-act=insert-new]').click();
    await page.waitForFunction(() => window.__store.getState().route.name === 'write', null, { timeout: 20000 });
    const ins = await page.evaluate(async () => {
      const s = window.__store.getState();
      let types = [];
      try {
        const items = await navigator.clipboard.read();
        types = items.flatMap((i) => i.types);
      } catch (e) {
        types = ['erreur: ' + e.message];
      }
      return { drafts: s.drafts.length, route: s.route, title: s.drafts.find((d) => d.id === s.route.draftId)?.title, types, toast: s.toasts.map((t) => t.message).join(' | ') };
    });
    check(ins.drafts === drafts0 + 1 && ins.title === 'Carte — Discours de la méthode', '18. « Insérer dans un écrit » : nouvel écrit créé et ouvert', ins.title);
    check(ins.types.includes('image/png') && /collez/.test(ins.toast), '18. image de la carte dans le presse-papiers, consigne affichée', ins.types.join(','));
    await openBook(page, bookId);

    // ── 19. Versions ──
    await page.locator('[data-act=versions]').click();
    await page.waitForSelector('[data-testid=map-versions-panel]');
    await page.locator('[data-testid=version-name]').fill('Avant le tri');
    await page.locator('[data-act=version-create]').click();
    await wait(page, 200);
    vers = await page.evaluate((k) => (window.__store.getState().mapVersions ?? []).filter((v) => v.mapKey === k), bookId);
    const named = vers.find((v) => v.name === 'Avant le tri');
    check(!!named && (await page.locator(`[data-version="${named.id}"]`).innerText()).includes('Avant le tri'), '19. « Créer une version » (nommée) listée');
    const items = await page.locator('.map-ver').allInnerTexts();
    check(items.some((t) => /Avant le rangement automatique/.test(t) && /Automatique/.test(t)) && items.some((t) => /cartes/.test(t) && /(instant|min)/.test(t)), '19. instantanés auto et nommés, date relative, nombre de cartes', items[0]?.replace(/\n/g, ' '));
    await page.locator(`[data-version="${named.id}"]`).hover();
    await wait(page, 250);
    check((await page.locator('[data-testid=version-preview] img').count()) === 1, '19. aperçu miniature au survol');
    await shot(page, 'light-9-versions.png');
    // Suppression multiple → instantané automatique.
    await page.mouse.move(400, 860);
    await page.mouse.click(...Object.values(await headOf(page, 'n-lone')));
    await page.keyboard.press('Shift+ArrowRight'); // une modification après la version nommée
    await wait(page, 150);
    await page.keyboard.down(MOD);
    await page.mouse.click(...Object.values(await headOf(page, 'n-idea')));
    await page.keyboard.up(MOD);
    await page.keyboard.press('Backspace');
    await wait(page, 300);
    m = await getMap(page, bookId);
    vers = await page.evaluate((k) => (window.__store.getState().mapVersions ?? []).filter((v) => v.mapKey === k), bookId);
    check(!m.nodes.some((n) => n.id === 'n-lone') && vers.some((v) => v.reason === 'delete-many'), '19. instantané automatique avant une suppression multiple');
    // Restaurer la version nommée, puis Annuler.
    await page.locator(`[data-version="${named.id}"]`).hover();
    await page.locator(`[data-version="${named.id}"] [data-act=version-restore]`).click();
    await wait(page, 300);
    m = await getMap(page, bookId);
    check(m.nodes.some((n) => n.id === 'n-lone') && m.nodes.some((n) => n.id === 'n-idea'), '19. Restaurer : la carte revient à la version');
    await page.locator('.toast button', { hasText: 'Annuler' }).first().click();
    await wait(page, 300);
    m = await getMap(page, bookId);
    check(!m.nodes.some((n) => n.id === 'n-lone'), '19. restauration annulable (toast « Annuler »)');
    const nv = (await page.evaluate((k) => (window.__store.getState().mapVersions ?? []).filter((v) => v.mapKey === k), bookId)).length;
    await page.locator(`[data-version="${named.id}"]`).hover();
    await page.locator(`[data-version="${named.id}"] [data-act=version-delete]`).click();
    await wait(page, 200);
    vers = await page.evaluate((k) => (window.__store.getState().mapVersions ?? []).filter((v) => v.mapKey === k), bookId);
    check(vers.length === nv - 1 && !vers.some((v) => v.id === named.id), '19. Supprimer une version');
    await page.locator('[data-act=versions]').click();

    // ═══ B. Carte libre, thème sombre ═══
    await setTheme(page, 'dark');
    await page.evaluate(() => window.__store.getState().navigate({ name: 'board', boardId: 'B1' }));
    await page.waitForSelector('.board-canvas .react-flow__node');
    await wait(page, 700);
    if (await page.locator('[data-testid=board-add]').count()) await page.locator('[data-testid=board-add-toggle]').click();
    await page.locator('[data-act=fit]').click();
    await wait(page, 600);
    // Zone par clic droit sur une sélection.
    await page.mouse.click(...Object.values(await headOf(page, 'K1')));
    await page.keyboard.down(MOD);
    await page.mouse.click(...Object.values(await headOf(page, 'K2')));
    await page.keyboard.up(MOD);
    await page.locator('.react-flow__node[data-id="K2"]').click({ button: 'right', position: { x: 60, y: 14 } });
    await page.getByRole('menuitem', { name: 'Encadrer dans une zone' }).click();
    await wait(page, 250);
    await page.keyboard.type('Kant');
    await page.keyboard.press('Enter');
    let b = await getMap(page, 'B1');
    const kz = b.zones?.[0];
    check(kz?.title === 'Kant' && (await members(page, 'B1', kz.id)).sort().join() === 'K1,K2', '12. carte libre : zone par clic droit, nommée');
    // Seconde zone au clavier (⌘G).
    await page.mouse.click(...Object.values(await headOf(page, 'C1')));
    await page.keyboard.down(MOD);
    await page.mouse.click(...Object.values(await headOf(page, 'C2')));
    await page.keyboard.up(MOD);
    await page.keyboard.press(`${MOD}+g`);
    await wait(page, 250);
    await page.keyboard.type('Constant');
    await page.keyboard.press('Enter');
    b = await getMap(page, 'B1');
    check(b.zones?.length === 2 && b.zones[1].title === 'Constant' && b.zones[1].color !== b.zones[0].color, '12. ⌘G : seconde zone, autre teinte');
    await page.mouse.click(960, 660);
    // Note de lien sur la carte libre.
    await page.locator('.map-pill[data-edge="b2"]').click();
    await page.waitForSelector('[data-testid=map-edge-menu]');
    await page.locator('[data-testid=map-edge-menu] .map-note-sugg .chip', { hasText: 'par l’absurde' }).click();
    await wait(page, 150);
    check((await getMap(page, 'B1')).edges.find((e) => e.id === 'b2').note === 'par l’absurde', '20. carte libre : note choisie parmi les suggestions');
    await page.keyboard.press('Escape');
    await page.mouse.move(5, 400);
    await wait(page, 250);
    await shot(page, 'dark-1-carte-libre-zones.png');
    const pb2 = await box(page, '.map-pill[data-edge="b2"]');
    await page.mouse.move(pb2.x + pb2.width / 2, pb2.y + pb2.height / 2);
    await wait(page, 400);
    await shot(page, 'dark-2-note-survol.png');
    await page.mouse.move(5, 400);
    // Signaux : pastille (extraits de Kant/Constant tous placés ; I1 relié) → selon le modèle.
    const gm = await page.evaluate(async () => {
      const M = await import('/src/features/map/model/index.ts');
      const s = window.__store.getState();
      return M.mapGaps(s.maps.B1, { highlights: s.highlights, books: s.books, studies: s.studies }).total;
    });
    const pill2 = (await page.locator('[data-act=gaps]').count()) ? await page.locator('[data-act=gaps]').innerText() : '';
    check(gm === 0 ? pill2 === '' : pill2.includes(`${gm} point`), '15. carte libre : pastille cohérente avec le modèle', `${gm} / « ${pill2} »`);
    if (gm) {
      await page.locator('[data-act=gaps]').click();
      await wait(page, 250);
      await wait(page, 450);
    await shot(page, 'dark-3-signaux.png');
      await page.locator('[data-act=gaps]').click();
    }
    // Export depuis le thème sombre : fond clair.
    const png2 = await exportVia(page, 'png');
    check(png2.name === 'liberté  Kant et Constant.png' || png2.name === 'liberté Kant et Constant.png', '18. carte libre : nom de fichier = titre', png2.name);
    check(PNG_SIG.every((v, i) => png2.head[i] === v) && png2.corner[0] > 240 && png2.corner[2] > 230, '18. PNG en thème sombre : fond clair', png2.corner.join(','));
    const svg2 = await exportVia(page, 'svg');
    check(svg2.parsed && svg2.text.includes('fill="#fbf9f4"') && svg2.text.includes('par l’absurde') && (svg2.text.match(/class="zone"/g) ?? []).length === 2, '18. SVG en thème sombre : fond clair, 2 zones, note');
    fs.writeFileSync(path.join(OUT, 'export-carte-libre.svg'), svg2.text);
    const pdf2 = await exportVia(page, 'pdf');
    check(String.fromCharCode(...pdf2.head.slice(0, 5)) === '%PDF-' && pdf2.size > 20, '18. carte libre : PDF');
    // Insérer dans un écrit existant.
    await page.locator('[data-act=export]').click();
    await page.locator('[data-export=draft]').click();
    await page.waitForSelector('[data-testid=map-insert-dialog]');
    await wait(page, 200);
    await shot(page, 'dark-4-inserer.png');
    const anyDraft = await page.evaluate(() => window.__store.getState().drafts[0]?.id);
    await page.locator(`[data-testid=map-insert-dialog] [data-draft="${anyDraft}"]`).click();
    await page.waitForFunction(() => window.__store.getState().route.name === 'write', null, { timeout: 20000 });
    check((await page.evaluate(() => window.__store.getState().route.draftId)) === anyDraft, '18. « Insérer dans un écrit » : écrit existant ouvert');
    await page.evaluate(() => window.__store.getState().navigate({ name: 'board', boardId: 'B1' }));
    await page.waitForSelector('.board-canvas .react-flow__node');
    await wait(page, 600);
    // Versions de la carte libre.
    await page.locator('[data-act=versions]').click();
    await page.locator('[data-testid=version-name]').fill('Deux camps');
    await page.locator('[data-act=version-create]').click();
    await wait(page, 150);
    await page.locator('.map-zone-head').first().click({ button: 'right', position: { x: 50, y: 16 } });
    await page.getByRole('menuitem', { name: /Supprimer la zone/ }).click();
    await wait(page, 200);
    check((await getMap(page, 'B1')).zones.length === 1, '19. carte libre : modification (zone retirée)');
    const v2 = await page.evaluate(() => window.__store.getState().mapVersions.find((v) => v.mapKey === 'B1' && v.name === 'Deux camps').id);
    await page.locator(`[data-version="${v2}"]`).hover();
    await page.locator(`[data-version="${v2}"]`).hover();
    await wait(page, 250);
    await shot(page, 'dark-5-versions.png');
    await page.locator(`[data-version="${v2}"] [data-act=version-restore]`).click();
    await wait(page, 300);
    b = await getMap(page, 'B1');
    check(b.zones.length === 2 && b.edges.find((e) => e.id === 'b2').note === 'par l’absurde', '19. carte libre : version restaurée (zones et note)');
    await page.locator('[data-act=versions]').click();
    // Replier une zone en sombre (capture).
    const kzid = b.zones.find((z) => z.title === 'Kant').id;
    await page.locator(`.map-zone[data-zone="${kzid}"] .map-zone-head`).hover();
    await page.locator(`.map-zone[data-zone="${kzid}"] [data-act=zone-collapse]`).click();
    await wait(page, 300);
    await page.mouse.move(5, 400);
    await shot(page, 'dark-6-zone-repliee.png');
    await page.locator(`.map-zone[data-zone="${kzid}"] [data-act=zone-expand]`).click();

    // ═══ C. Sépia : carte du livre ═══
    await setTheme(page, 'sepia');
    await openBook(page, bookId);
    await page.mouse.move(5, 400);
    await shot(page, 'sepia-1-zone.png');
    await page.locator('[data-act=gaps]').click();
    await wait(page, 250);
    await shot(page, 'sepia-2-signaux.png');
    await page.locator('[data-act=gaps]').click();
    await page.locator('[data-act=export]').click();
    await wait(page, 200);
    await shot(page, 'sepia-3-export.png');
    await page.keyboard.press('Escape');
    const pb3 = await box(page, '.map-pill[data-edge="e2"]');
    await page.mouse.move(pb3.x + pb3.width / 2, pb3.y + pb3.height / 2);
    await wait(page, 400);
    await shot(page, 'sepia-4-note.png');

    check(errors.length === 0, 'aucune erreur dans la console', errors.join(' | '));
    await ctx.close();
  } finally {
    await browser.close();
    await server.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures} échec(s)`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
