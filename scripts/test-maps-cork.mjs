// Cartes mentales en mode Skeuomorphisme : liège, punaises, liens en fil. Port 5232.
// Lancer : timeout 170 node scripts/test-maps-cork.mjs        Captures : shots/maps-cork/
import assert from 'node:assert/strict';
import { withApp, shot } from './harness.mjs';

const PORT = 5232;
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};

async function run(dark) {
  const tag = dark ? 'sombre' : 'clair';
  await withApp(
    PORT,
    async (page, errors) => {
      const S = (fn, arg) => page.evaluate(fn, arg);
      await page.waitForFunction(() => window.__store && window.__store.getState().ready);
      await S(async () => {
        const { host } = await import('/src/lib/platform.ts');
        const s = window.__store.getState();
        const anchor = (start) => ({ kind: 'html', chapter: 0, start, end: start + 5, prefix: '', suffix: '' });
        const book = (id, title, author) => ({ id, title, author, format: 'md', fileName: 'source.md', originalName: 'x.md', size: 1, addedAt: 1, lastOpenedAt: null, progress: 0, position: null, cover: null, edition: { translator: '', place: 'Paris', publisher: 'Vrin', year: '2000' } });
        const hl = (id, bookId, category, text, start, page) => ({ id, bookId, category, text, note: '', noteKind: null, conceptIds: [], anchor: anchor(start), locationLabel: '', printedPage: page, createdAt: 1, updatedAt: start });
        await host.saveDb({
          books: [book('bK', 'D’un prétendu droit de mentir par humanité', 'Emmanuel Kant'), book('bC', 'Des réactions politiques', 'Benjamin Constant')],
          highlights: [
            hl('hK1', 'bK', 'these', 'La véracité est un devoir formel de l’homme envers chacun', 10, '67'),
            hl('hK2', 'bK', 'argument', 'Le mensonge nuit toujours à autrui, sinon à un homme du moins à l’humanité', 20, '68'),
            hl('hC1', 'bC', 'these', 'Nul homme n’a droit à la vérité qui nuit à autrui', 40, '123'),
            hl('hC2', 'bC', 'exemple', 'L’assassin qui demande si notre ami est réfugié chez nous', 50, '124'),
          ],
          concepts: [],
          maps: {
            mB: {
              id: 'mB', kind: 'board', title: 'Le droit de mentir', bookId: 'bK', bookIds: ['bK', 'bC'],
              nodes: [
                { id: 'T', highlightId: 'hK1', text: '', x: 320, y: 0 },
                { id: 'A', highlightId: 'hK2', text: '', x: 0, y: 260 },
                { id: 'C', highlightId: 'hC1', text: '', x: 660, y: 240 },
                { id: 'E', highlightId: 'hC2', text: '', x: 700, y: 520 },
                { id: 'I', highlightId: null, text: 'Et le mensonge par omission ?', x: 280, y: 520 },
              ],
              edges: [
                { id: 'e1', source: 'A', target: 'T', relation: 'soutient', groupId: null, note: '' },
                { id: 'e2', source: 'C', target: 'T', relation: 'objecte', groupId: null, note: '' },
                { id: 'e3', source: 'E', target: 'C', relation: 'illustre', groupId: null, note: '' },
                { id: 'e4', source: 'I', target: 'A', relation: 'lien', groupId: null, note: '' },
              ],
              viewport: null, createdAt: 1, updatedAt: 1,
            },
          },
          arguments: [], plans: [], drafts: [], cards: [], studies: [], bookmarks: [],
          workspaces: [], groups: [], wsItems: [],
          settings: { ...s.settings, appStyle: 'skeuo' }, trash: [], activity: [],
        });
      });
      await page.reload();
      await page.waitForFunction(() => window.__store && window.__store.getState().ready);
      await S(() => window.__store.getState().navigate({ name: 'board', boardId: 'mB' }));
      await page.waitForSelector('.board-canvas .map-node');
      await page.waitForTimeout(900);

      const info = await S(() => {
        const cv = getComputedStyle(document.querySelector('.board-canvas'));
        const node = document.querySelector('.map-extract');
        const pin = getComputedStyle(node, '::after');
        const lien = document.querySelector('.map-edge.neutral .map-edge-path');
        return {
          border: cv.borderTopWidth,
          bgImg: getComputedStyle(document.querySelector('.board-canvas .map-flow')).backgroundImage,
          pin: pin.content,
          pinBg: pin.backgroundColor,
          rotate: getComputedStyle(node).rotate,
          lien: lien ? getComputedStyle(lien).stroke : null,
          rootBg: getComputedStyle(document.querySelector('.board-canvas .map-root')).backgroundImage,
        };
      });
      ok(`[${tag}] cadre en bois et liège`, info.border === '14px' && info.bgImg.includes('svg'));
      ok(`[${tag}] le fond de carte laisse voir le liège`, info.rootBg === 'none');
      ok(`[${tag}] cartes épinglées (punaise rouge)`, info.pin === '""' && /rgb\((1[6-9]\d|2\d\d), 3\d, 2\d\)/.test(info.pinBg), info.pinBg);
      ok(`[${tag}] cartes légèrement penchées`, info.rotate !== 'none' && info.rotate !== '0deg', info.rotate);
      ok(`[${tag}] le simple lien devient le fil rouge`, /rgb\(1[6-9]\d, 3\d, 2\d\)/.test(info.lien), info.lien);
      await shot(page, `shots/maps-cork/01-carte-${tag}.png`);

      // Décrocher une carte : la punaise disparaît pendant qu'on la déplace, la carte se redresse.
      const n = page.locator('.react-flow__node').filter({ has: page.locator('.map-idea') }).first();
      const b = await n.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 10);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 40, { steps: 8 });
      await page.waitForTimeout(250);
      const drag = await S(() => {
        const el = document.querySelector('.react-flow__node.dragging .map-node');
        return el ? { op: getComputedStyle(el, '::after').opacity, rot: getComputedStyle(el).rotate } : null;
      });
      await page.mouse.up();
      ok(`[${tag}] on décroche la carte en la déplaçant`, drag && Number(drag.op) < 0.2 && (drag.rot === '0deg' || drag.rot === 'none'), JSON.stringify(drag));
      const moved = await S(() => window.__store.getState().maps.mB.nodes.find((x) => x.id === 'I'));
      ok(`[${tag}] la carte est bien déplacée`, moved.x !== 280 || moved.y !== 520);

      // Le liège suit la vue : on fait glisser le fond, sa trame se déplace d'autant ; on zoome, elle grandit.
      const bg = () => S(() => {
        const f = document.querySelector('.board-canvas .map-flow');
        const cs = getComputedStyle(f);
        const t = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
        const vp = { e: t.e, f: t.f, a: t.a };
        return { pos: cs.backgroundPosition.split(',')[0].trim(), size: cs.backgroundSize.split(',')[0].trim(), vp };
      });
      const before = await bg();
      const pane = await page.locator('.board-canvas .react-flow__pane').boundingBox();
      await page.mouse.move(pane.x + pane.width - 120, pane.y + 140);
      await page.mouse.down();
      await page.mouse.move(pane.x + pane.width - 300, pane.y + 220, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      const after = await bg();
      const [bx, by] = after.pos.split(' ').map(parseFloat);
      const m = after.vp;
      ok(`[${tag}] le liège glisse avec la carte`, after.pos !== before.pos && Math.abs(bx - m.e) < 1 && Math.abs(by - m.f) < 1, `${before.pos} → ${after.pos} / vue ${m.e},${m.f}`);
      await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(400);
      const zoomed = await bg();
      const z = zoomed.vp.a;
      ok(`[${tag}] le liège grandit avec le zoom`, Math.abs(parseFloat(zoomed.size) - 180 * z) < 1 && zoomed.size !== before.size, `${zoomed.size} / zoom ${z}`);


      // Style normal : rien de tout cela.
      await S(() => window.__store.getState().updateSettings({ appStyle: 'normal' }));
      await page.waitForTimeout(150);
      const off = await S(() => ({
        border: getComputedStyle(document.querySelector('.board-canvas')).borderTopWidth,
        pin: getComputedStyle(document.querySelector('.map-extract'), '::after').content,
      }));
      ok(`[${tag}] style normal : ni liège ni punaise`, off.border === '0px' && (off.pin === 'none' || off.pin === 'normal'), JSON.stringify(off));

      // Carte vide : le message est posé sur une fiche, lisible sur le liège.
      await S(() => window.__store.getState().updateSettings({ appStyle: 'skeuo' }));
      await S(() => {
        const st = window.__store.getState();
        window.__store.setState({ maps: { ...st.maps, mE: { id: 'mE', kind: 'board', title: 'Nouvelle carte', bookId: '', bookIds: [], nodes: [], edges: [], viewport: null, createdAt: 1, updatedAt: 1 } } });
        st.navigate({ name: 'board', boardId: 'mE' });
      });
      await page.waitForSelector('[data-testid="map-empty"] h3');
      await page.waitForTimeout(500);
      const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const emp = await S(() => {
        const e = document.querySelector('.map-empty .empty');
        return { bg: getComputedStyle(e).backgroundColor, h3: getComputedStyle(e.querySelector('h3')).color, p: getComputedStyle(e.querySelector('p')).color, hint: getComputedStyle(e.querySelector('.map-empty-hint')).color };
      });
      ok(`[${tag}] carte vide : fiche claire, texte sombre`, lum(emp.bg) > 200 && lum(emp.h3) < 90 && lum(emp.p) < 120 && lum(emp.hint) < 150, JSON.stringify(emp));
      await shot(page, `shots/maps-cork/03-vide-${tag}.png`);

      const rem = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
      ok(`[${tag}] aucune erreur navigateur`, rem.length === 0, rem.join('\n'));
    },
    { dark },
  );
}

await run(false);
await run(true);
console.log(`\n${passed} vérifications passées`);
