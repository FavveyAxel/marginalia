import { withApp, shot } from './harness.mjs';
await withApp(5297, async (page) => {
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
  await page.waitForTimeout(600);
  await shot(page, 'shots/appearance/home-dark.png');
});
