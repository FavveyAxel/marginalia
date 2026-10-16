// Feuilles + mise en page livre : aucune ligne de texte ne sort de la feuille (bug « des mots sortent
// du cadre » : la première ligne d'une page qui commence entre deux paragraphes se plaçait à droite,
// hors de la feuille). Réglages de l'utilisateur : sans empattement, 19 px, interligne 1,75, 68 ch.
// Port 5418. ROOT=<dossier de l'app> pour tester une autre copie (ex. l'ancienne version).
// Lancer : timeout 600 node scripts/test-reader-sheets-overflow.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { epubLong } from './fixtures-books.mjs';

const ROOT = process.env.ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.env.PORT || 5418);
const SHOTS = process.env.SHOTS || '/home/claude/marginalia/shots/debord-feuilles';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
let passed = 0;
const check = (ok, name, detail) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${name}${!ok && detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : ''}`);
};

async function run(viewport, label) {
  const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-sheets-' + PORT, server: { port: PORT, strictPort: true, hmr: false }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    const buf = await epubLong({ shy: true });
    const b64 = Buffer.from(buf).toString('base64');
    const id = await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [b] = await window.__store.getState().importFiles([{ name: 'traite-long.epub', data: bin.buffer }], { asBook: true });
      return b.id;
    }, b64);
    for (const combo of [
      { fontFamily: 'sans', panel: true },
      { fontFamily: 'sans', panel: false },
      { fontFamily: 'serif', panel: true },
      { fontFamily: 'serif', panel: false },
    ]) {
      await page.evaluate(
        (c) =>
          window.__store.getState().updateSettings({
            theme: 'light', fontSize: 19, lineHeight: 1.75, measure: 68, fontFamily: c.fontFamily,
            readerLayout: 'sheets', bookLayout: true, paperLook: false, pageMarks: 'numbered', showConnectors: true,
          }),
        combo,
      );
      await page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), id);
      await page.waitForFunction(() => !!document.querySelector('.html-doc.is-revealed') && !document.querySelector('.reader-loading'), null, { timeout: 30000 });
      await sleep(800);
      const btn = page.locator('[data-testid=reader-display-btn]');
      const open = (await btn.getAttribute('aria-expanded')) === 'true';
      if (open !== combo.panel) await btn.click();
      await sleep(700);
      const r = await page.evaluate(() => {
        const out = { lines: 0, outside: [], blocks: 0, indented: 0, shouldIndent: 0 };
        for (const col of document.querySelectorAll('.html-col')) {
          const cs = getComputedStyle(col);
          const cr = col.getBoundingClientRect();
          const left = cr.left + parseFloat(cs.paddingLeft) - 1.5;
          const right = cr.right - parseFloat(cs.paddingRight) + 1.5;
          const tw = document.createTreeWalker(col.querySelector('.html-chapter-text') ?? col, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = tw.nextNode())) {
            if (!n.data.trim()) continue;
            const rg = document.createRange();
            rg.selectNodeContents(n);
            for (const b of rg.getClientRects()) {
              if (b.width < 1) continue;
              out.lines++;
              if (b.left < left || b.right > right)
                if (out.outside.length < 6) out.outside.push({ txt: n.data.slice(0, 30), l: Math.round(b.left - left), r: Math.round(b.right - right) });
                else out.outside.push(1);
            }
          }
          for (const m of col.querySelectorAll('.pg-mark.pg-block:not(.pg-chap):not(.pg-start)')) {
            out.blocks++;
            const p = m.closest('p');
            const ind = m.nextElementSibling?.classList.contains('pg-indent') ? m.nextElementSibling : null;
            if (ind && ind.getBoundingClientRect().width > 4) out.indented++;
            // paragraphe précédé d'un autre paragraphe de texte : doit garder l'alinéa
            const prev = p?.previousElementSibling;
            if (p && prev?.tagName === 'P' && !prev.hasAttribute('data-blank') && !p.hasAttribute('data-verse')) out.shouldIndent++;
          }
        }
        return out;
      });
      const name = `${label}, ${combo.fontFamily}, panneau ${combo.panel ? 'ouvert' : 'fermé'}`;
      check(r.lines > 1000, `${name} : livre long chargé (${r.lines} lignes, ${r.blocks} coupures entre paragraphes)`, r.lines);
      check(r.outside.length === 0, `${name} : aucune ligne hors de la feuille`, { n: r.outside.length, ex: r.outside.slice(0, 4) });
      check(r.indented >= Math.min(r.shouldIndent, 1) && r.indented <= r.blocks, `${name} : alinéa gardé après une coupure de feuille (${r.indented}/${r.shouldIndent})`, r);
      if (combo.fontFamily === 'sans' && combo.panel) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.evaluate(() => {
          const m = [...document.querySelectorAll('.pg-mark.pg-block:not(.pg-chap):not(.pg-start)')].find((x) => x.nextElementSibling?.classList.contains('pg-indent')) ?? document.querySelector('.pg-mark.pg-block:not(.pg-chap):not(.pg-start)');
          m?.scrollIntoView({ block: 'center' });
        });
        await sleep(600);
        await page.screenshot({ path: path.join(SHOTS, `${label}.png`) });
      }
    }
  } finally {
    check(errors.length === 0, `${label} : aucune erreur de page`, errors.slice(0, 3));
    await browser.close();
    await server.close();
  }
}

await run({ width: 1440, height: 900 }, 'fenetre-1440');
await run({ width: 1600, height: 1000 }, 'fenetre-1600');
await run({ width: 1180, height: 820 }, 'fenetre-1180');
console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
