// Captures rapides de la Boîte de réception (bibliothèque + boîte) — port 5294.
import { withApp, importFixture, shot } from './harness.mjs';
await withApp(5294, async (page) => {
  await importFixture(page, 'fixtures/discours.epub');
  await page.evaluate(() => window.__store.getState().updateSettings({ inbox: true }));
  await page.evaluate(() => {
    window.__inbox.add('idée.txt', 'Penser la fatigue comme une forme de connaissance : relire Montaigne sur l’expérience.');
    window.__inbox.add('Conférence.url', '[InternetShortcut]\nURL=https://example.org/conference\n');
  });
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await page.waitForSelector('.lib-inbox-n', { timeout: 30000 });
  await page.waitForTimeout(700);
  await shot(page, 'shots/boite/10-bibliotheque.png');
  await page.click('.lib-inbox-chip');
  await page.waitForSelector('.ib-list');
  await page.waitForTimeout(500);
  await shot(page, 'shots/boite/11-boite.png');
});
