import { _electron as electron } from 'playwright-core';
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-pinceau-'));
const settle = (page, ms = 350) => page.waitForTimeout(ms);
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env: { ...process.env, DISPLAY: ':99', XDG_CONFIG_HOME: TMP, MARGINALIA_E2E: '1', VITE_DEV_SERVER_URL: '' }, timeout: 90000 });
const key = (code, mods) => app.evaluate(({ BrowserWindow }, { code, mods }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.sendInputEvent({ type: 'keyDown', keyCode: code, modifiers: mods }); wc.sendInputEvent({ type: 'char', keyCode: code, modifiers: mods }); wc.sendInputEvent({ type: 'keyUp', keyCode: code, modifiers: mods }); }, { code, mods });
const DOM = () => {
  const textMap = () => {
    const nodes = [];
    for (const page of document.querySelectorAll('.superdoc-page')) {
      const w = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
      let n; while ((n = w.nextNode())) if (n.parentElement.closest('span[data-pm-start]')) nodes.push(n);
    }
    let txt = ''; const map = [];
    for (const n of nodes) { for (let i = 0; i < n.data.length; i++) map.push([n, i]); txt += n.data; }
    return { txt, map };
  };
  window.__dom = {
    rects(needle, a = 0, b = needle.length) {
      const { txt, map } = textMap(); const i = txt.indexOf(needle); if (i < 0) return [];
      const r = document.createRange(); const s = map[i + a], e = map[i + b - 1];
      r.setStart(s[0], s[1]); r.setEnd(e[0], e[1] + 1);
      return [...r.getClientRects()].filter((x) => x.width > 0).map((x) => ({ left: x.left, right: x.right, top: x.top, bottom: x.bottom }));
    },
    vis(needle, off = 1) {
      const { txt, map } = textMap(); const i = txt.indexOf(needle); if (i < 0) return 'introuvable';
      const s = map[i + off][0].parentElement.closest('span[data-pm-start]');
      const cs = getComputedStyle(s);
      let bg = cs.backgroundColor, el = s;
      for (let k = 0; k < 3 && bg === 'rgba(0, 0, 0, 0)'; k++) { el = el.parentElement; if (!el || el.classList.contains('superdoc-line')) break; bg = getComputedStyle(el).backgroundColor; }
      return { ff: cs.fontFamily.split(',')[0].replace(/"/g, ''), fs: cs.fontSize, fw: cs.fontWeight, st: cs.fontStyle, td: cs.textDecorationLine, col: cs.color, bg };
    },
    text: () => textMap().txt,
  };
};
const h = (page, fn, arg) => page.evaluate(fn, arg);
async function R(page, n, a, b) { const rs = await h(page, ({ n, a, b }) => window.__dom.rects(n, a, b), { n, a, b }); if (!rs.length) throw new Error('rect ' + n); return { a: rs[0], b: rs.at(-1) }; }
const mid = (r) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
async function dbl(page, n) { const r = await R(page, n, 0, n.length); await page.mouse.dblclick(...mid(r.a)); await settle(page, 300); }
async function drag(page, n, a, b) { const r = await R(page, n, a, b); const y1 = (r.a.top + r.a.bottom) / 2, y2 = (r.b.top + r.b.bottom) / 2; await page.mouse.move(r.a.left + 0.5, y1); await page.mouse.down(); await page.mouse.move(r.b.right - 0.5, y2, { steps: 6 }); await page.mouse.up(); await settle(page, 300); }
async function tb(page, k) { await page.click(`.ed-toolbar [data-tb="${k}"]`); await settle(page, 250); }
const vis = (page, n, o = 1) => h(page, ({ n, o }) => window.__dom.vis(n, o), { n, o });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
try {
  const page = await app.firstWindow();
  page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  const b64 = fs.readFileSync(path.join(ROOT, 'fixtures/discours.docx')).toString('base64');
  const id = await h(page, async ({ b64 }) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await window.__store.getState().importFiles([{ name: 'discours.docx', data: bin.buffer }]); return window.__store.getState().drafts.at(-1).id; }, { b64 });
  await h(page, (id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
  await page.waitForSelector('.superdoc-page span[data-pm-start]', { timeout: 60000 });
  await settle(page, 2000);
  await h(page, DOM);
  await drag(page, 'mieux partagée', 0, 14);
  await page.click('.ed-toolbar [data-tb="font"]'); await page.waitForSelector('.ed-font-row', { timeout: 15000 }); await settle(page, 300);
  console.log('font menu focus', await h(page, () => document.activeElement?.tagName + '.' + document.activeElement?.className));
  const fam = await h(page, () => [...document.querySelectorAll('.ed-font-row')].map((r) => r.dataset.font).find((f) => /Serif|Georgia|Liberation/.test(f)));
  console.log('fam', fam);
  await page.fill('.ed-font-search input', fam); await settle(page, 200); await page.click(`.ed-font-row[data-font="${fam}"]`); await settle(page, 300);
  await page.click('.ed-toolbar .ed-size-more'); await settle(page, 200); await page.click('.ed-size-menu [data-size="14"]'); await settle(page, 300);
  await tb(page, 'bold'); await tb(page, 'italic');
  await page.click('.ed-toolbar [data-tb="color"]'); await settle(page, 200); await page.locator('.ed-color-menu .ed-swatch:not(.none)').nth(4).click(); await settle(page, 300);
  await page.click('.ed-toolbar [data-tb="highlight"]'); await settle(page, 200); await page.locator('.ed-color-menu .ed-swatch:not(.none)').nth(0).click(); await settle(page, 300);
  const S = await vis(page, 'mieux partagée', 2);
  console.log('S', JSON.stringify(S));
  await dbl(page, 'partagée');
  await key('C', ['control', 'shift']); await settle(page, 400);
  console.log('toast', await h(page, () => document.querySelector('.toasts')?.textContent));
  await dbl(page, 'diversité');
  await key('V', ['control', 'shift']); await settle(page, 700);
  const D = await vis(page, 'diversité', 2);
  console.log(same(S, D) ? 'SAME' : 'DIFF', 'native Ctrl+Shift+V', JSON.stringify(D));
  console.log('text intact', (await h(page, () => window.__dom.text())).includes('Et ainsi la diversité de nos opinions'));
  await page.screenshot({ path: path.join(ROOT, 'shots/pinceau/probe-electron.png') });
  await dbl(page, 'partagée'); await tb(page, 'painter'); await drag(page, 'opinions', 0, 8); await settle(page, 500);
  const D2 = await vis(page, 'opinions', 2);
  console.log(same(S, D2) ? 'SAME' : 'DIFF', 'button', JSON.stringify(D2));
  await dbl(page, 'partagée'); await tb(page, 'painter'); await dbl(page, 'raisonnables'); await settle(page, 500);
  console.log(same(S, await vis(page, 'raisonnables', 2)) ? 'SAME' : 'DIFF', 'button dbl', JSON.stringify(await vis(page, 'raisonnables', 2)));
} finally { await app.close(); }
