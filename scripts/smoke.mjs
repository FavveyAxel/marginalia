import { withApp, importFixture, shot } from './harness.mjs';
await withApp(5199, async (page) => {
  await importFixture(page, 'fixtures/discours.epub');
  await shot(page, 'shots/smoke.png');
});
