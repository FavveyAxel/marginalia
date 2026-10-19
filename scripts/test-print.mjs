// Imprimer un écrit : le document envoyé à l'imprimante est exactement celui de l'export PDF.
// En test (MARGINALIA_E2E=1 + MARGINALIA_E2E_PRINT_DIR), l'impression ne montre pas de dialogue : elle
// rend le PDF qu'elle aurait imprimé, comparé ici page par page (texte et image) à l'export PDF.
// Lancer : DISPLAY=:99 timeout 400 node scripts/test-print.mjs   (port 5443 ; captures dans shots/impression/)
import { createServer } from 'vite';
import { _electron as electron } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installHelpers } from './ed-helpers.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/impression');
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail !== '' ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) : ''}`);
};

const HTML = `<h1>Dissertation sur la liberté</h1>
<p>Introduction. Être libre, est-ce faire ce que l'on veut<span data-footnote="Rousseau, Du contrat social, I, 8."></span> ? La question oppose depuis longtemps la liberté naturelle et la liberté civile.</p>
<h2>I. La liberté naturelle</h2>
<blockquote><p>« L'homme est né libre, et partout il est dans les fers. »</p></blockquote>
<p>Les siècles ont changé les chaînes, sans changer la question.</p>
<h2>II. La liberté civile</h2>
<p>Obéir à la loi qu'on s'est prescrite, c'est encore être libre.</p>
<ul><li>premier point</li><li>second point</li></ul>
<h2>Conclusion</h2>
<p>Fin de la dissertation.</p>`;

const PORT = 5443;
const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-impression-'));
const PRINT_DIR = path.join(TMP, 'imprimante');
fs.mkdirSync(PRINT_DIR);
const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', ROOT],
  env: { ...process.env, XDG_CONFIG_HOME: TMP, VITE_DEV_SERVER_URL: `http://localhost:${PORT}/`, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: path.join(TMP, 'userData'), MARGINALIA_E2E_PRINT_DIR: PRINT_DIR },
  timeout: 60000,
});
const pdfPages = (file) => Number(/Pages:\s+(\d+)/.exec(spawnSync('pdfinfo', [file], { encoding: 'utf8' }).stdout)?.[1]);
const pdfSize = (file) => /Page size:\s+([\d.]+ x [\d.]+)/.exec(spawnSync('pdfinfo', [file], { encoding: 'utf8' }).stdout)?.[1];
const pageText = (file, k) => spawnSync('pdftotext', ['-layout', '-f', String(k), '-l', String(k), file, '-'], { encoding: 'utf8' }).stdout;
/** Pages en images (PPM, 50 ppp) : { width, height, data } en RVB. */
function raster(file, prefix) {
  spawnSync('pdftoppm', ['-r', '50', file, prefix]);
  return fs.readdirSync(path.dirname(prefix)).filter((f) => f.startsWith(path.basename(prefix) + '-') && f.endsWith('.ppm')).sort().map((f) => {
    const b = fs.readFileSync(path.join(path.dirname(prefix), f));
    const m = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(b.subarray(0, 40).toString('latin1'));
    return { width: +m[1], height: +m[2], data: b.subarray(m[0].length) };
  });
}
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await page.evaluate(() => { try { window.__store.getState().updateSettings({ tourDone: true }); } catch {} });
  await page.evaluate(async (html) => {
    const d = await (await import('/src/features/editor/api.ts')).createDraft({ title: 'Dissertation liberté', html });
    window.__store.getState().navigate({ name: 'write', draftId: d.id });
  }, HTML);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await installHelpers(page);
  await page.evaluate(() => { window.__h.select('Conclusion', 0, 0); window.__ed.engine().insertPageBreak(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__ed.engine().setPageNumbers('n-of-total'));
  await page.waitForTimeout(1500);
  const editorPages = await page.evaluate(() => document.querySelectorAll('.presentation-editor__pages .superdoc-page').length);

  // Le menu Exporter : « Imprimer… » en tête.
  await page.click('[data-tb="export"]');
  await page.waitForSelector('[data-print]');
  const menu = (await page.locator('.ed-export-menu').innerText()).replace(/\s+/g, ' ');
  check('menu Exporter : « Imprimer… » en premier, puis les exports', /^Imprimer…/.test(menu.trim()) && /Exporter une copie/.test(menu), menu.slice(0, 120));
  await page.locator('.ed-export-menu').screenshot({ path: path.join(OUT, 'menu-exporter.png') });

  // Export PDF tel que le bouton « PDF » le fait (même chemin de code que l'impression).
  const exported = await page.evaluate(async () => {
    const { guardedExport } = await import('/src/features/editor/save.ts');
    const { usedFonts } = await import('/src/features/editor/exporters.ts');
    const { bundledFontFaceCss } = await import('/src/features/editor/exportFonts.ts');
    const { stripForExport } = await import('/src/features/editor/privateNotes.ts');
    const { renderPagesForPrint } = await import('/src/features/editor/pagePrint.ts');
    const g = await guardedExport(window.__ed.engine());
    const fontCss = await bundledFontFaceCss(usedFonts(g.model));
    const r = await renderPagesForPrint((await stripForExport(g.data)).data, { fontCss });
    const buf = new Uint8Array(await window.marginalia.printToPdf(r.html));
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  const pdfA = path.join(OUT, 'export.pdf');
  fs.writeFileSync(pdfA, Buffer.from(exported, 'base64'));

  // Impression par le menu.
  await page.click('[data-print]');
  const t0 = Date.now();
  let printed = null;
  while (Date.now() - t0 < 30000 && !printed) {
    const f = fs.readdirSync(PRINT_DIR).find((x) => x.endsWith('.pdf'));
    if (f) printed = path.join(PRINT_DIR, f);
    else await new Promise((r) => setTimeout(r, 200));
  }
  check('« Imprimer… » envoie un document à l’impression', !!printed);
  const pdfB = path.join(OUT, 'impression.pdf');
  await new Promise((r) => setTimeout(r, 300));
  fs.copyFileSync(printed, pdfB);
  const toasts = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  check('aucun message d’erreur', !/échou|abouti/.test(toasts), toasts);

  const nA = pdfPages(pdfA), nB = pdfPages(pdfB);
  check('impression : autant de pages que l’éditeur et que le PDF', nB === editorPages && nA === nB, `${nB} imprimées / ${nA} PDF / ${editorPages} éditeur`);
  check('impression : même format de page que le PDF (A4)', pdfSize(pdfA) === pdfSize(pdfB) && /^59[45]\.\d* x 84[12]/.test(pdfSize(pdfB)), `${pdfSize(pdfB)} / ${pdfSize(pdfA)}`);
  for (let k = 1; k <= nB; k++) check(`page ${k} : même texte, même disposition que le PDF`, pageText(pdfA, k) === pageText(pdfB, k), pageText(pdfB, k).trim().slice(0, 60));
  const fonts = spawnSync('pdffonts', [pdfB], { encoding: 'utf8' }).stdout;
  check('impression : polices de l’écrit incorporées (pas de police de repli)', /Literata/i.test(fonts), fonts.split('\n').slice(2, 5).join(' ; '));
  const A = raster(pdfA, path.join(OUT, 'export')), B = raster(pdfB, path.join(OUT, 'impression'));
  for (let k = 0; k < Math.min(A.length, B.length); k++) {
    let diff = 0;
    const same = A[k].width === B[k].width && A[k].height === B[k].height;
    if (same) for (let i = 0; i < A[k].data.length; i += 3) if (Math.abs(A[k].data[i] - B[k].data[i]) + Math.abs(A[k].data[i + 1] - B[k].data[i + 1]) + Math.abs(A[k].data[i + 2] - B[k].data[i + 2]) > 30) diff++;
    const pct = same ? (100 * diff) / (A[k].width * A[k].height) : 100;
    check(`page ${k + 1} : image identique au PDF (pixels différents < 0,1 %)`, pct < 0.1, `${pct.toFixed(3)} %`);
  }
} finally {
  await app.close();
  await server.close();
}
console.log(failed ? `\n${failed} échec(s)` : '\nTout est bon.');
process.exit(failed ? 1 : 0);
