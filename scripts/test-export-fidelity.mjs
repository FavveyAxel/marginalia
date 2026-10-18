// Exports fidèles à la mise en page de l'éditeur (sauts de page, numéros de page, notes de bas de page).
// Lancer : timeout 400 node scripts/test-export-fidelity.mjs
//          (avec un écran — DISPLAY=:99 ou xvfb-run -a — la partie Electron imprime le vrai PDF)
// Ports 5441 (navigateur) et 5442 (Electron). Captures dans shots/fidelite/.
import { createServer } from 'vite';
import { chromium, _electron as electron } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installHelpers } from './ed-helpers.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/fidelite');
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail !== '' ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) : ''}`);
};

const HTML = `<h1>Dissertation sur la liberté</h1>
<p>Introduction. Être libre, est-ce faire ce que l'on veut<span data-footnote="Rousseau, Du contrat social, I, 8."></span> ? La question oppose depuis longtemps la liberté naturelle et la liberté civile.</p>
<p></p>
<p>Deuxième paragraphe après une ligne vide.</p>
<h2>I. La liberté naturelle</h2>
<blockquote><p>« L'homme est né libre, et partout il est dans les fers. »</p></blockquote>
<p>Les siècles ont changé les chaînes, sans changer la question.</p>
<h2>II. La liberté civile</h2>
<p>Obéir à la loi qu'on s'est prescrite, c'est encore être libre.</p>
<ul><li>premier point</li><li>second point</li></ul>
<h2>III. L'autonomie</h2>
<p>La liberté n'est pas l'absence de loi.</p>
<h2>Conclusion</h2>
<p>Fin de la dissertation.</p>`;
const BREAKS = ['II. La liberté civile', 'Conclusion'];

/** Ouvre l'écrit, insère les sauts de page et la numérotation ; renvoie les pages de l'éditeur. */
async function prepare(page) {
  await page.evaluate(async (html) => {
    const d = await (await import('/src/features/editor/api.ts')).createDraft({ title: 'Dissertation liberté', html });
    window.__store.getState().navigate({ name: 'write', draftId: d.id });
  }, HTML);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await installHelpers(page);
  for (const t of BREAKS) {
    await page.evaluate((t) => { window.__h.select(t, 0, 0); window.__ed.engine().insertPageBreak(); }, t);
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => window.__ed.engine().setPageNumbers('n-of-total'));
  await page.waitForTimeout(1500);
  return page.evaluate(() =>
    [...document.querySelectorAll('.presentation-editor__pages .superdoc-page')].map((p) => p.innerText.replace(/\s+/g, ' ').trim()),
  );
}

/** Tous les exports, tels que EditorScreen les produit. */
async function exportAll(page) {
  return page.evaluate(async () => {
    const { guardedExport } = await import('/src/features/editor/save.ts');
    const { exportText, usedFonts } = await import('/src/features/editor/exporters.ts');
    const { bundledFontFaceCss } = await import('/src/features/editor/exportFonts.ts');
    const { stripForExport } = await import('/src/features/editor/privateNotes.ts');
    const { renderPagesForPrint } = await import('/src/features/editor/pagePrint.ts');
    const g = await guardedExport(window.__ed.engine());
    const fontCss = await bundledFontFaceCss(usedFonts(g.model));
    const stripped = (await stripForExport(g.data)).data;
    const t0 = performance.now();
    const print = await renderPagesForPrint(stripped, { fontCss });
    const ms = Math.round(performance.now() - t0);
    const web = await renderPagesForPrint(stripped, { fontCss, mode: 'web', title: 'Dissertation liberté' });
    const pagesText = (html) => {
      const d = new DOMParser().parseFromString(html, 'text/html');
      return [...d.querySelectorAll('.mgl-print-pages > .superdoc-page')].map((p) => p.textContent.replace(/\s+/g, ' ').trim());
    };
    const docx = new Uint8Array(stripped);
    let bin = '';
    for (let i = 0; i < docx.length; i += 0x8000) bin += String.fromCharCode(...docx.subarray(i, i + 0x8000));
    return {
      ms,
      print: print.html,
      printPages: pagesText(print.html),
      webPages: pagesText(web.html),
      web: web.html,
      md: exportText(g.model, 'md', 'Dissertation liberté'),
      txt: exportText(g.model, 'txt', 'Dissertation liberté'),
      html: exportText(g.model, 'html', 'Dissertation liberté'),
      docx: btoa(bin),
      leftovers: document.querySelectorAll('.mgl-print-host').length,
    };
  });
}

const startsWith = (pages, k, needle) => (pages[k] ?? '').replace(/^[\s\S]*?(?=\S)/, '').includes(needle) && (pages[k] ?? '').indexOf(needle) < 40;

async function checks(editor, r, label) {
  console.log(`\n── ${label} ──`);
  console.log('pages éditeur :', editor.map((t, i) => `${i + 1}: « ${t.slice(0, 50)}… »`).join('  '));
  check(`${label} : l'éditeur a 3 pages (2 sauts)`, editor.length === 3, editor.length);
  check(`${label} : PDF — autant de pages que l'éditeur`, r.printPages.length === editor.length, `${r.printPages.length} / ${editor.length}`);
  check(`${label} : page web — autant de pages que l'éditeur`, r.webPages.length === editor.length, r.webPages.length);
  for (let k = 0; k < editor.length; k++) {
    const a = editor[k].replace(/\s+/g, '').slice(0, 60), b = (r.printPages[k] ?? '').replace(/\s+/g, '').slice(0, 60);
    check(`${label} : PDF page ${k + 1} commence comme dans l'éditeur`, a === b, `${a} | ${b}`);
  }
  check(`${label} : PDF page 2 commence par « II. La liberté civile »`, startsWith(r.printPages, 1, 'II. La liberté civile'), r.printPages[1]?.slice(0, 60));
  check(`${label} : PDF page 3 commence par « Conclusion »`, startsWith(r.printPages, 2, 'Conclusion'), r.printPages[2]?.slice(0, 60));
  check(`${label} : note de bas de page sur la page 1`, /Rousseau, Du contrat/.test(r.printPages[0] ?? '') && !/Rousseau, Du contrat/.test(r.printPages[2] ?? ''));
  check(`${label} : numéros de page « n / 3 » sur chaque page`, r.printPages.every((t, i) => new RegExp(`\\b${i + 1}\\s*(/|sur|of)\\s*3\\b`).test(t)), r.printPages.map((t) => t.slice(-20)));
  check(`${label} : aucune instance cachée restante`, r.leftovers === 0);
  check(`${label} : mise en page < 5 s`, r.ms < 5000, `${r.ms} ms`);
  check(`${label} : page web — viewport et titre`, /name="viewport"/.test(r.web) && /<title>Dissertation liberté<\/title>/.test(r.web));
  check(`${label} : PDF sans curseur ni calque de sélection`, !/<(div|span)[^>]*class="[^"]*(selection-layer|selection-caret|selection-rect)/.test(r.print.split('<body>')[1] ?? ''));
  // formats texte (reconstruits depuis le modèle)
  check(`${label} : Markdown — 2 sauts de page`, (r.md.match(/page-break-after: always/g) || []).length === 2, (r.md.match(/page-break-after: always/g) || []).length);
  check(`${label} : Markdown — saut juste avant « II. La liberté civile »`, /page-break-after: always;?[^\n]*<\/div>\s*\n+## II\. La liberté civile/.test(r.md));
  check(`${label} : texte — 2 sauts de page (\\f)`, (r.txt.match(/\f/g) || []).length === 2);
  check(`${label} : HTML de secours — 2 séparateurs de page`, (r.html.match(/class="page-break"/g) || []).length === 2);
  // .docx : sauts et champ PAGE
  const zip = await JSZip.loadAsync(Buffer.from(r.docx, 'base64'));
  const doc = await zip.file('word/document.xml').async('string');
  const nBr = (doc.match(/<w:br w:type="page"\s*\/>/g) || []).length + (doc.match(/<w:pageBreakBefore(?! w:val="(0|false)")/g) || []).length;
  check(`${label} : Word — 2 sauts de page`, nBr === 2, nBr);
  const footers = await Promise.all(Object.keys(zip.files).filter((f) => /word\/footer\d*\.xml$/.test(f)).map((f) => zip.file(f).async('string')));
  check(`${label} : Word — champs PAGE / NUMPAGES dans le pied de page`, footers.some((f) => /PAGE/.test(f) && /NUMPAGES/.test(f)));
  return Buffer.from(r.docx, 'base64');
}

async function browserPart() {
  const PORT = 5441;
  const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    const editor = await prepare(page);
    const r = await exportAll(page);
    const docx = await checks(editor, r, 'Navigateur');
    fs.writeFileSync(path.join(OUT, 'dissertation.docx'), docx);
    fs.writeFileSync(path.join(OUT, 'dissertation.md'), r.md);
    fs.writeFileSync(path.join(OUT, 'dissertation-web.html'), r.web);
    // Word (rendu LibreOffice) : mêmes pages ?
    const lo = spawnSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', OUT, path.join(OUT, 'dissertation.docx')], { encoding: 'utf8', timeout: 120000 });
    if (lo.status === 0) {
      const p = path.join(OUT, 'dissertation.pdf');
      const n = Number(/Pages:\s+(\d+)/.exec(spawnSync('pdfinfo', [p], { encoding: 'utf8' }).stdout)?.[1]);
      check('Word (rendu LibreOffice) : 3 pages', n === 3, n);
      const t2 = spawnSync('pdftotext', ['-f', '2', '-l', '2', '-layout', p, '-'], { encoding: 'utf8' }).stdout.trim();
      check('Word (rendu LibreOffice) : page 2 commence par « II. La liberté civile »', t2.startsWith('II. La liberté civile'), t2.slice(0, 40));
      spawnSync('pdftoppm', ['-png', '-r', '50', p, path.join(OUT, 'word')]);
    } else console.log('— LibreOffice indisponible : rendu Word non vérifié');
    check('Navigateur : aucune erreur de page', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
    await server.close();
  }
}

async function electronPart() {
  if (!process.env.DISPLAY) {
    console.log('\n— partie Electron sautée (pas d’écran : lancer avec DISPLAY=:99 ou xvfb-run -a)');
    return;
  }
  const PORT = 5442;
  const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
  await server.listen();
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-fidelite-'));
  const app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, XDG_CONFIG_HOME: TMP, VITE_DEV_SERVER_URL: `http://localhost:${PORT}/` },
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    const editor = await prepare(page);
    const r = await exportAll(page);
    await checks(editor, r, 'Electron');
    const pdf = await page.evaluate(async (html) => {
      const buf = new Uint8Array(await window.marginalia.printToPdf(html));
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(bin);
    }, r.print);
    const p = path.join(OUT, 'dissertation-electron.pdf');
    fs.writeFileSync(p, Buffer.from(pdf, 'base64'));
    const info = spawnSync('pdfinfo', [p], { encoding: 'utf8' }).stdout;
    const n = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
    check('PDF Electron : autant de pages que l’éditeur', n === editor.length, `${n} / ${editor.length}`);
    check('PDF Electron : format A4 (595 × 842 pt ± 2)', (() => { const m = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info); return m && Math.abs(m[1] - 595) < 2 && Math.abs(m[2] - 842) < 2; })(), /Page size:.*/.exec(info)?.[0]);
    for (let k = 1; k <= n; k++) {
      const t = spawnSync('pdftotext', ['-f', String(k), '-l', String(k), p, '-'], { encoding: 'utf8' }).stdout.replace(/\s+/g, ' ').trim();
      check(`PDF Electron : page ${k} = page ${k} de l'éditeur`, t.slice(0, 30) === editor[k - 1].slice(0, 30), `${t.slice(0, 30)} | ${editor[k - 1].slice(0, 30)}`);
      check(`PDF Electron : page ${k} porte « ${k} / 3 »`, new RegExp(`\\b${k}\\s*/\\s*3\\b`).test(t), t.slice(-30));
    }
    const fonts = spawnSync('pdffonts', [p], { encoding: 'utf8' }).stdout;
    check('PDF Electron : polices incorporées', /\byes\b/.test(fonts), fonts.split('\n').slice(2).join(' ; '));
    spawnSync('pdftoppm', ['-png', '-r', '60', p, path.join(OUT, 'pdf')]);
    console.log('captures :', path.relative(ROOT, OUT) + '/pdf-*.png');
  } finally {
    await app.close();
    await server.close();
  }
}

await browserPart();
await electronPart();
console.log(failed ? `\n${failed} échec(s)` : '\nTout est bon.');
process.exit(failed ? 1 : 0);
