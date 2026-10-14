import { withApp, importFixture } from './harness.mjs';
const ok = (c, m) => { console.log((c ? 'OK   ' : 'ÉCHEC ') + m); if (!c) process.exitCode = 1; };
await withApp(5298, async (page) => {
  const before = await page.evaluate(() => ({ b: window.__store.getState().books.length, d: window.__store.getState().drafts.length }));
  await importFixture(page, 'fixtures/discours.docx', { asBook: false }).catch(() => null);
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({ b: window.__store.getState().books.length, d: window.__store.getState().drafts.length, t: window.__store.getState().drafts.map((x) => x.title) }));
  ok(after.b === before.b, `aucun livre créé (${before.b} → ${after.b})`);
  ok(after.d === before.d + 1, `un écrit créé : ${after.t.join(', ')}`);
  // migration : un ancien .docx « livre », rangé dans un espace
  const id = await importFixture(page, 'fixtures/discours.md');
  const r = await page.evaluate(async (id) => {
    const s = window.__store.getState();
    const buf = await (await fetch('/fixtures/discours.docx').catch(() => null))?.arrayBuffer?.();
    return { hasBuf: !!buf };
  }, id);
  await page.evaluate(async (id) => {
    const s = window.__store.getState();
    s.updateBook(id, { format: 'docx', title: 'Ancien docx' });
    const ws = s.createWorkspace('Test');
    s.addToWorkspace(ws.id, null, 'book', id);
    s.updateSettings({ docxMigrated: false });
  }, id);
  // la source stockée est un .md : on remplace par un vrai docx
  const fs = await import('node:fs');
  const b64 = fs.readFileSync('fixtures/discours.docx').toString('base64');
  await page.evaluate(async ({ id, b64 }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const s = window.__store.getState();
    const b = s.books.find((x) => x.id === id);
    const { host } = await import('/src/lib/platform.ts');
    await host.storeFile(id, b.fileName, bin.buffer);
    const { migrateDocxBooks } = await import('/src/features/library/docxMigration.ts');
    window.__n = await migrateDocxBooks();
  }, { id, b64 });
  const m = await page.evaluate((id) => { const s = window.__store.getState(); return { n: window.__n, book: s.books.some((b) => b.id === id), ws: s.wsItems.map((i) => i.kind), drafts: s.drafts.map((d) => d.title) }; }, id);
  ok(m.n === 1 && !m.book, `migration : livre converti (${m.n})`);
  ok(m.ws.includes('draft') && !m.ws.includes('book'), `place dans l'espace reprise par l'écrit (${m.ws})`);
  ok(m.drafts.includes('Ancien docx'), 'écrit « Ancien docx » présent');
});
await withApp(5299, async (page) => {
  await importFixture(page, 'fixtures/discours.md', { asBook: false });
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => ({ b: window.__store.getState().books.length, d: window.__store.getState().drafts.map((x) => [x.title, x.wordCount]) }));
  ok(st.b === 0 && st.d.length === 1 && st.d[0][1] > 50, `Markdown importé comme écrit : ${JSON.stringify(st.d)}`);
});
