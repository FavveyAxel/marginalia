// Photo sans extension : reconnue comme image à l'import, et réparation d'un ancien import « TXT ».
import fs from 'node:fs';
import { withApp } from './harness.mjs';
const ok = (c, m) => { console.log((c ? 'OK   ' : 'ÉCHEC ') + m); if (!c) process.exitCode = 1; };
const b64 = fs.readFileSync('fixtures/cover.png').toString('base64');
await withApp(5396, async (page) => {
  const r = await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const [b] = await window.__store.getState().importFiles([{ name: 'IMG_3747', data: bin.buffer }]);
    return b && { format: b.format, fileName: b.fileName };
  }, b64);
  ok(r?.format === 'image' && r.fileName === 'source.png', `import sans extension → ${JSON.stringify(r)}`);
  const bad = await page.evaluate(async () => {
    const data = new Uint8Array(2000).map((_, i) => (i * 7) % 256);
    const res = await window.__store.getState().importFiles([{ name: 'bizarre.xyz', data: data.buffer }]);
    return res.length;
  });
  ok(bad === 0, 'fichier binaire inconnu refusé (pas de « livre » illisible)');
  // Ancien import cassé : livre « txt » qui contient une image.
  const id = await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const s = window.__store.getState();
    const { host } = await import('/src/lib/platform.ts');
    const id = 'broken1';
    await host.storeFile(id, 'source.txt', bin.buffer);
    s.insert?.('books', { id, title: 'IMG 3747', author: '', format: 'txt', fileName: 'source.txt', originalName: 'IMG_3747', size: bin.length, addedAt: Date.now(), lastOpenedAt: null, progress: 0, position: null, cover: null, edition: { publisher: '', year: '', translator: '', place: '', pageOffset: 0 } });
    if (!s.insert) window.__store.setState((st) => ({ books: [...st.books, { id, title: 'IMG 3747', author: '', format: 'txt', fileName: 'source.txt', originalName: 'IMG_3747', size: bin.length, addedAt: Date.now(), lastOpenedAt: null, progress: 0, position: null, cover: null, edition: { publisher: '', year: '', translator: '', place: '', pageOffset: 0 } }] }));
    const { repairMisdetectedBooks } = await import('/src/features/library/formatRepair.ts');
    await repairMisdetectedBooks();
    const b = window.__store.getState().books.find((x) => x.id === id);
    return { format: b.format, fileName: b.fileName, cover: !!b.cover };
  }, b64);
  ok(id.format === 'image' && id.fileName === 'source.png' && id.cover, `ancien import réparé → ${JSON.stringify(id)}`);
  await page.evaluate(() => window.__store.getState().openBook('broken1'));
  await page.waitForTimeout(2500);
  ok(await page.evaluate(() => !!document.querySelector('.img-reader, [class*="image-reader"], img')), 'le livre réparé s’ouvre dans le lecteur d’images');
});
