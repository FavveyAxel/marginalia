// Retour depuis un écrit : vers l'espace de travail (ou le groupe) d'où il a été ouvert, sinon vers « Écrits ».
// Lancer : timeout 200 node scripts/test-editor-back.mjs   (port 5345)
import { withApp } from './harness.mjs';

let failed = 0, passed = 0;
const ok = (c, m, extra = '') => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}${extra !== '' ? ' — ' + extra : ''}`); c ? passed++ : failed++; };

await withApp(5345, async (page, errors) => {
  const ids = await page.evaluate(async () => {
    const s = () => window.__store.getState();
    s().updateSettings({ tourDone: true });
    const api = await import('/src/features/editor/api.ts');
    const d = await api.createDraft({ title: 'La promesse', html: '<p>Texte.</p>' });
    const d2 = await api.createDraft({ title: 'Brouillon libre', html: '<p>Autre.</p>' });
    const ws = s().createWorkspace('Dissertation').id;
    s().addToWorkspace(ws, null, 'draft', d.id);
    return { d: d.id, d2: d2.id, ws };
  });
  const back = async () => {
    await page.waitForSelector('[data-testid="ed-back"]', { timeout: 30000 });
    const label = (await page.textContent('[data-testid="ed-back"]')).trim();
    await page.click('[data-testid="ed-back"]');
    await page.waitForTimeout(300);
    return { label, route: await page.evaluate(() => window.__store.getState().route) };
  };
  // 1. Depuis l'espace de travail.
  await page.evaluate((ws) => window.__store.getState().navigate({ name: 'workspace', workspaceId: ws, groupId: null }), ids.ws);
  await page.evaluate((d) => window.__store.getState().navigate({ name: 'write', draftId: d }), ids.d);
  let r = await back();
  ok(r.label === 'Dissertation' && r.route.name === 'workspace' && r.route.workspaceId === ids.ws, 'ouvert depuis l’espace : « ‹ Dissertation » ramène à l’espace', JSON.stringify(r));
  // 2. Depuis l'espace, puis passage à un autre écrit : le point de départ est gardé.
  await page.evaluate((d) => window.__store.getState().navigate({ name: 'write', draftId: d }), ids.d);
  await page.waitForSelector('[data-testid="ed-back"]');
  await page.evaluate((d) => window.__store.getState().navigate({ name: 'write', draftId: d }), ids.d2);
  await page.waitForTimeout(400);
  r = await back();
  ok(r.route.name === 'workspace' && r.route.workspaceId === ids.ws, 'd’un écrit à un autre : on revient toujours à l’espace de départ', JSON.stringify(r));
  // 3. Depuis la liste des écrits.
  await page.evaluate(() => window.__store.getState().navigate({ name: 'write', draftId: null }));
  await page.waitForTimeout(200);
  await page.evaluate((d) => window.__store.getState().navigate({ name: 'write', draftId: d }), ids.d);
  r = await back();
  ok(r.label === 'Écrits' && r.route.name === 'write' && r.route.draftId === null, 'ouvert depuis « Écrits » : « ‹ Écrits » ramène à la liste', JSON.stringify(r));
  // 4. Depuis l'accueil (même s'il fait partie d'un espace) : la liste des écrits.
  await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
  await page.evaluate((d) => window.__store.getState().navigate({ name: 'write', draftId: d }), ids.d);
  r = await back();
  ok(r.label === 'Écrits' && r.route.name === 'write', 'ouvert depuis l’accueil : « ‹ Écrits »', JSON.stringify(r));
  ok(errors.length === 0, 'aucune erreur dans la console', errors.slice(0, 2).join(' | '));
});
console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
