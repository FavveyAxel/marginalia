// Banc de test : lance Vite (dev) sur un port, ouvre Chromium, fournit des helpers.
// Usage : import { withApp, importFixture, shot } from './harness.mjs'
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export async function withApp(port, fn, { width = 1440, height = 900, dark = false } = {}) {
  const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-' + port, server: { port, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  try {
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
    await fn(page, errors);
  } finally {
    if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + errors.join('\n'));
    await browser.close();
    await server.close();
  }
}

/** Importe un fichier de fixtures/ via le store et renvoie l'id du livre. */
export async function importFixture(page, file, { open = false, asBook = true } = {}) {
  const abs = path.resolve(ROOT, file);
  const b64 = fs.readFileSync(abs).toString('base64');
  return page.evaluate(
    async ({ name, b64, open, asBook }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await window.__store.getState().importFiles([{ name, data: bin.buffer }], { asBook: !!asBook });
      if (open && book) window.__store.getState().openBook(book.id);
      return book?.id;
    },
    { name: path.basename(abs), b64, open, asBook },
  );
}

export async function shot(page, out) {
  fs.mkdirSync(path.dirname(path.resolve(ROOT, out)), { recursive: true });
  await page.screenshot({ path: path.resolve(ROOT, out) });
  console.log('capture:', out);
}

/** Sélectionne le texte `needle` dans le premier nœud texte qui le contient (dans `rootSelector`). */
export async function selectText(page, needle, rootSelector = 'body') {
  return page.evaluate(
    ({ needle, rootSelector }) => {
      const root = document.querySelector(rootSelector);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const i = n.textContent.indexOf(needle);
        if (i >= 0) {
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + needle.length);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          const rect = r.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
      }
      return null;
    },
    { needle, rootSelector },
  );
}
