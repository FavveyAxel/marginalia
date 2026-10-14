import { withApp, importFixture, shot } from './harness.mjs';
await withApp(5296, async (page) => {
  const id = await importFixture(page, 'fixtures/discours.md');
  await page.evaluate((id) => {
    const s = window.__store.getState();
    s.setMap(id, { bookId: id, nodes: [{ id: 'n1', highlightId: null, text: 'Je test', x: 100, y: 120 }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
    s.navigate({ name: 'reader', bookId: id, tab: 'carte', splitBookId: null });
  }, id);
  await page.waitForSelector('.react-flow__node', { timeout: 15000 });
  await page.waitForTimeout(800);
  const h = await page.evaluate(() => {
    const hs = [...document.querySelectorAll('.react-flow__node .react-flow__handle')];
    const r = hs[hs.length - 1].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(h.x, h.y); await page.mouse.down();
  await page.mouse.move(h.x + 200, h.y + 180, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(500);
  const m = await page.evaluate((id) => window.__store.getState().getMap(id), id);
  console.log('nœuds', m.nodes.length, 'liens', m.edges.length, JSON.stringify(m.edges));
  await page.keyboard.type('Nouvelle idée');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await shot(page, 'shots/map/drop-new-card.png');
  const m2 = await page.evaluate((id) => window.__store.getState().getMap(id), id);
  console.log('textes', m2.nodes.map((n) => n.text));
});
