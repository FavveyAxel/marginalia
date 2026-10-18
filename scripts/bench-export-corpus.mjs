// Banc d'essai : chaque .docx d'un dossier est ouvert comme écrit, puis exporté dans tous les formats ;
// on compare les pages de l'éditeur à celles du PDF (impression réelle d'Electron) et de la page web,
// on compte les sauts de page en Markdown / texte, et on vérifie que le .docx réexporté se pagine
// comme l'original (même moteur de rendu : LibreOffice).
// Lancer : DISPLAY=:99 node scripts/bench-export-corpus.mjs <dossier> [--quick] [--out shots/corpus]
//   --quick : sans LibreOffice ni comparaison page à page (robustesse sur de gros lots)
import { createServer } from 'vite';
import { _electron as electron } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const DIR = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'fixtures');
const QUICK = args.includes('--quick');
const OUT = path.resolve(ROOT, args[args.indexOf('--out') + 1] && args.includes('--out') ? args[args.indexOf('--out') + 1] : 'shots/corpus');
fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(DIR).filter((f) => /\.docx$/i.test(f)).sort();
const PORT = 5450 + Math.floor(Math.random() * 40);

const sh = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: 'utf8', timeout: 120000, ...o });
const pdfPages = (f) => Number(/Pages:\s+(\d+)/.exec(sh('pdfinfo', [f]).stdout)?.[1] ?? NaN);
const pdfText = (f, k) => sh('pdftotext', ['-f', String(k), '-l', String(k), f, '-']).stdout.replace(/\s+/g, '');
function loPages(docx, tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-'));
  sh('soffice', [`-env:UserInstallation=file:///tmp/lo-profile-${PORT}`, '--headless', '--convert-to', 'pdf', '--outdir', d, docx], { timeout: 180000 });
  const pdf = path.join(d, path.basename(docx).replace(/\.docx$/i, '.pdf'));
  const n = fs.existsSync(pdf) ? pdfPages(pdf) : NaN;
  if (tag && fs.existsSync(pdf)) fs.copyFileSync(pdf, path.join(OUT, tag));
  return n;
}
async function sourceBreaks(buf) {
  const zip = await JSZip.loadAsync(buf);
  const doc = (await zip.file('word/document.xml')?.async('string')) ?? '';
  return {
    br: (doc.match(/<w:br\b[^>]*w:type="page"/g) || []).length,
    before: (doc.match(/<w:pageBreakBefore(?![^>]*w:val="(0|false|off)")/g) || []).length,
    sect: (doc.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g) || []).filter((s) => !/w:type w:val="continuous"/.test(s)).length - 1,
  };
}

const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-corpus-'));
let app = null, page = null;
const errors = [];
async function launch() {
  app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env: { ...process.env, XDG_CONFIG_HOME: TMP, VITE_DEV_SERVER_URL: `http://localhost:${PORT}/` }, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
}

/** Pages de l'éditeur (son DOM n'en garde qu'une fenêtre : on fait défiler pour toutes les lire). */
const editorPages = () => page.evaluate(async () => {
  const pagesEl = document.querySelector('.presentation-editor__pages');
  if (!pagesEl) return [];
  const s = [...document.querySelectorAll('*')].find((e) => e.contains(pagesEl) && e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
  const out = new Map();
  const grab = () => { for (const p of pagesEl.querySelectorAll('.superdoc-page')) out.set(Number(p.dataset.pageIndex), [...p.children].filter((c) => !/page-(header|footer)/.test(c.className)).map((c) => c.innerText).join('').replace(/\s+/g, '')); };
  if (!s) { grab(); } else {
    for (let y = 0; y <= s.scrollHeight + 600; y += 700) { s.scrollTop = y; await new Promise((r) => setTimeout(r, 90)); grab(); }
    s.scrollTop = 0;
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
});

async function waitLayout() {
  let last = '', since = Date.now();
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const sig = await page.evaluate(() => { const p = document.querySelector('.presentation-editor__pages'); return p ? `${p.scrollHeight}` : ''; });
    if (sig && sig !== last) { last = sig; since = Date.now(); } else if (sig && Date.now() - since > 1200) return;
    await page.waitForTimeout(200);
  }
}

const results = [];
await launch();
for (const f of files) {
  const r = { file: f };
  const t0 = Date.now();
  try {
    const buf = fs.readFileSync(path.join(DIR, f));
    r.src = await sourceBreaks(buf);
    await page.evaluate(async (b64) => {
      window.__store.getState().navigate({ name: 'home' });
      await new Promise((res) => setTimeout(res, 200));
      const docx = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
      const d = await (await import('/src/features/editor/api.ts')).createDraft({ title: 'Corpus', docx });
      window.__store.getState().navigate({ name: 'write', draftId: d.id });
    }, buf.toString('base64'));
    await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in .superdoc-page'), null, { timeout: 60000 });
    await waitLayout();
    const ed = await editorPages();
    r.editor = ed.length;
    const ex = await page.evaluate(async () => {
      const { guardedExport } = await import('/src/features/editor/save.ts');
      const { exportText, usedFonts, toPrintHtml } = await import('/src/features/editor/exporters.ts');
      const { bundledFontFaceCss } = await import('/src/features/editor/exportFonts.ts');
      const { stripForExport } = await import('/src/features/editor/privateNotes.ts');
      const { renderPagesForPrint } = await import('/src/features/editor/pagePrint.ts');
      const g = await guardedExport(window.__ed.engine());
      const fontCss = await bundledFontFaceCss(usedFonts(g.model));
      const stripped = (await stripForExport(g.data)).data;
      const t0 = performance.now();
      let print = null, fallback = null;
      try { print = await renderPagesForPrint(stripped, { fontCss }); } catch (e) { fallback = String(e?.message ?? e); }
      const ms = Math.round(performance.now() - t0);
      const html = print ? print.html : toPrintHtml(g.model, 'Corpus', { fontCss });
      const pdf = new Uint8Array(await window.marginalia.printToPdf(html));
      const enc = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
      const md = exportText(g.model, 'md', 'Corpus');
      const txt = exportText(g.model, 'txt', 'Corpus');
      return { ms, fallback, pages: print?.pages ?? null, pdf: enc(pdf), docx: enc(new Uint8Array(stripped)),
        mdBreaks: (md.match(/page-break-after: always/g) || []).length, txtBreaks: (txt.match(/\f/g) || []).length,
        modelBreaks: g.model.blocks.filter((b) => b.pageBreak).length, mdLen: md.length };
    });
    Object.assign(r, { layoutMs: ex.ms, fallback: ex.fallback, printPages: ex.pages, mdBreaks: ex.mdBreaks, txtBreaks: ex.txtBreaks, modelBreaks: ex.modelBreaks });
    const base = f.replace(/\.docx$/i, '');
    const pdfPath = path.join(OUT, `${base}.pdf`);
    fs.writeFileSync(pdfPath, Buffer.from(ex.pdf, 'base64'));
    r.pdf = pdfPages(pdfPath);
    {
      let same = 0; const diffs = [];
      for (let k = 1; k <= Math.min(r.pdf, ed.length); k++) {
        // le PDF contient le début du corps de la page de l'éditeur (en-tête et pied mis à part)
        const t = pdfText(pdfPath, k), e = (ed[k - 1] ?? '').slice(0, 30);
        if (t.slice(0, 160).includes(e)) same++; else if (diffs.length < 3) diffs.push({ k, pdf: t.slice(0, 30), ed: e });
      }
      r.samePages = same; r.diffs = diffs;
    }
    if (!QUICK) {
      const exDocx = path.join(OUT, `${base}.export.docx`);
      fs.writeFileSync(exDocx, Buffer.from(ex.docx, 'base64'));
      r.loOriginal = loPages(path.join(DIR, f), `${base}.lo-orig.pdf`);
      r.loExport = loPages(exDocx, `${base}.lo-export.pdf`);
      sh('pdftoppm', ['-png', '-r', '30', '-l', '6', pdfPath, path.join(OUT, `${base}.pdf`)]);
    }
  } catch (e) {
    r.error = String(e?.message ?? e).split('\n')[0].slice(0, 200);
    try { await app.close(); } catch {}
    await launch();
  }
  r.s = Math.round((Date.now() - t0) / 100) / 10;
  r.ok = !r.error && r.pdf === r.editor && (r.printPages === r.editor) && r.samePages === r.pdf;
  results.push(r);
  console.log(`${r.ok ? 'OK   ' : 'ÉCART'} ${f.padEnd(48).slice(0, 48)} éd.${r.editor ?? '-'} pdf${r.pdf ?? '-'}${r.fallback ? ' (repli: ' + r.fallback + ')' : ''} pages=${r.samePages}/${r.pdf}${QUICK ? '' : ` LO orig${r.loOriginal}/export${r.loExport}`} md${r.mdBreaks} txt${r.txtBreaks} src${r.src ? r.src.br + r.src.before + Math.max(0, r.src.sect) : '-'} ${r.layoutMs ?? '-'}ms ${r.s}s${r.error ? ' ERREUR ' + r.error : ''}${r.diffs?.length ? ' ' + JSON.stringify(r.diffs) : ''}`);
}
fs.writeFileSync(path.join(OUT, 'resultats.json'), JSON.stringify(results, null, 1));
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} fidèles ; erreurs de page : ${errors.length}`);
if (errors.length) console.log([...new Set(errors)].slice(0, 10).join('\n'));
await app.close();
await server.close();
process.exit(0);
