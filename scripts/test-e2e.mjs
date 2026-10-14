import { withApp, importFixture, shot } from './harness.mjs';
const routes = [['home'],['library'],['write',{draftId:null}],['extracts'],['concepts',{conceptId:null}],['arguments',{argumentId:null}],['plans',{planId:null}],['revision']];
await withApp(5299, async (page, errors) => {
  for (const [name, extra] of routes) {
    await page.evaluate(([n,e]) => window.__store.getState().navigate({ name: n, ...(e||{}) }), [name, extra]);
    await page.waitForTimeout(700);
    await shot(page, `shots/e2e/route-${name}.png`);
  }
  const epub = await importFixture(page, 'fixtures/discours.epub', { open: true });
  await page.waitForSelector('.html-doc', { timeout: 20000 });
  await page.waitForTimeout(1500);
  // vraie sélection à la souris
  const box = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.html-doc p')].find(p => p.textContent.includes('bon sens est la chose'));
    const r = p.getBoundingClientRect(); return { x: r.left + 4, y: r.top + 8, w: r.width };
  });
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + box.w * 0.6, box.y + 2, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(400);
  console.log('toolbar epub:', await page.locator('.sel-toolbar').count());
  await page.keyboard.press('2');
  await page.waitForTimeout(500);
  console.log('highlights:', await page.evaluate(() => window.__store.getState().highlights.length));
  await shot(page, 'shots/e2e/reader-epub.png');
  const pdf = await importFixture(page, 'fixtures/discours.pdf', { open: true });
  await page.waitForSelector('.textLayer span, .pdf-page', { timeout: 20000 });
  await page.waitForTimeout(2500);
  const pbox = await page.evaluate(() => {
    const s = [...document.querySelectorAll('.textLayer span')].find(s => s.textContent.length > 20 && s.getBoundingClientRect().width > 80 && s.getBoundingClientRect().top > 80);
    const r = s.getBoundingClientRect(); return { x: r.left + 2, y: r.top + r.height / 2, w: r.width };
  });
  await page.mouse.move(pbox.x, pbox.y); await page.mouse.down(); await page.mouse.move(pbox.x + pbox.w * 0.8, pbox.y, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(400);
  console.log('toolbar pdf:', await page.locator('.sel-toolbar').count(), 'sel:', await page.evaluate(() => getSelection().toString().slice(0, 40)));
  await page.keyboard.press('3');
  await page.waitForTimeout(500);
  console.log('highlights:', await page.evaluate(() => window.__store.getState().highlights.length));
  await shot(page, 'shots/e2e/reader-pdf.png');
  await page.evaluate(([a,b]) => window.__store.getState().openBook(a, b), [epub, pdf]);
  await page.waitForTimeout(3000);
  await shot(page, 'shots/e2e/split.png');
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'carte', splitBookId: null }), epub);
  await page.waitForTimeout(1200);
  await shot(page, 'shots/e2e/map.png');
  await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
  await page.waitForTimeout(800);
  await shot(page, 'shots/e2e/home-filled.png');
  console.log('errors:', errors.filter(e => !e.includes('404')).length);
});
