// Captures de l'animation de lecture du texte d'une image (lecteur), clair et sombre.
import { withApp } from './harness.mjs';
import fs from 'node:fs';
const IMG = process.argv[2];
for (const dark of [false, true]) {
  await withApp(5391 + (dark ? 1 : 0), async (page) => {
    const b64 = fs.readFileSync(IMG).toString('base64');
    const id = await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await window.__store.getState().importFiles([{ name: 'page.jpg', data: bin.buffer }]);
      window.__store.getState().openBook(book.id);
      return book.id;
    }, b64);
    await page.waitForSelector('[data-testid="img-ocr-offer"] button', { timeout: 20000 });
    await page.click('[data-testid="img-ocr-offer"] button');
    await page.waitForSelector('[data-testid="ocr-scan"]', { timeout: 10000 });
    for (const [i, t] of [[1, 500], [2, 900], [3, 900]]) {
      await page.waitForTimeout(t);
      await page.screenshot({ path: `shots/ocr-anim/${dark ? 'sombre' : 'clair'}-${i}.png` });
    }
  }, { dark });
}
