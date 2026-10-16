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
  // Lien lâché dans le vide : nouvelle carte, reliée par un lien neutre carte de départ → nouvelle carte.
  const nouvelle = m.nodes.find((n) => n.id !== 'n1');
  if (!(m.nodes.length === 2 && m.edges.length === 1 && m.edges[0].source === 'n1' && m.edges[0].target === nouvelle?.id && m.edges[0].relation === 'lien')) throw new Error('ÉCHEC : lien neutre n1 → nouvelle carte attendu');
  console.log('  ok lien neutre n1 → nouvelle carte');
  // clic ailleurs sans rien écrire : la carte vide doit rester
  await page.mouse.click(900, 600);
  await page.waitForTimeout(300);
  const mid = await page.evaluate((id) => window.__store.getState().getMap(id).nodes.length, id);
  console.log('après clic ailleurs', mid, JSON.stringify(await page.evaluate((id) => window.__store.getState().getMap(id).nodes.map((n) => [n.x, n.y]), id)));
  // déplacer la carte vide par son en-tête
  const nb = await page.evaluate(() => { const ns = [...document.querySelectorAll('.react-flow__node')]; const r = ns[ns.length - 1].querySelector('.map-node-head').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 6 }; });
  await page.mouse.move(nb.x, nb.y); await page.mouse.down(); await page.mouse.move(nb.x + 150, nb.y + 60, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(400);
  await shot(page, 'shots/map/drop-new-card.png');
  const m2 = await page.evaluate((id) => window.__store.getState().getMap(id), id);
  console.log('nœuds', m2.nodes.map((n) => [n.text, n.x, n.y]));
});
