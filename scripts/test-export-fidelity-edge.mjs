// Exports PDF fidèles, cas limites (Electron réel) : long document (pages hors de la fenêtre virtuelle),
// image, tableau, paysage, Lettre US, page de garde, thème sombre. Lancer : DISPLAY=:99 timeout 500 node scripts/test-export-fidelity-edge.mjs
import { createServer } from 'vite';
import { _electron as electron } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installHelpers } from './ed-helpers.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/fidelite/edge');
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const check = (n, ok, d = '') => { if (!ok) failed++; console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${n}${d !== '' ? ' — ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 240) : ''}`); };

// petite image PNG rouge 40×20
const PNG = 'data:image/png;base64,' + Buffer.from(spawnSync('python3', ['-c', `
from PIL import Image; import io,sys
b=io.BytesIO(); Image.new('RGB',(400,200),(200,40,40)).save(b,'PNG'); sys.stdout.buffer.write(b.getvalue())`]).stdout).toString('base64');

const para = (i) => `<p>Paragraphe ${i}. ${'Le serment engage la parole devant témoins, et le liberté la reprend. '.repeat(6)}</p>`;
const LONG = `<h1>Long document</h1>${Array.from({ length: 60 }, (_, i) => (i % 12 === 0 ? `<h2>Partie ${i / 12 + 1}</h2>` : '') + para(i + 1)).join('')}
<p>Image ci-dessous.</p><p>ICI-IMAGE</p>
<table><tr><th>Col A</th><th>Col B</th></tr><tr><td>cellule 1</td><td>cellule 2</td></tr></table><p>FIN-DU-DOCUMENT</p>`;

const PORT = 5446;
const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-edge-'));
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env: { ...process.env, XDG_CONFIG_HOME: TMP, VITE_DEV_SERVER_URL: `http://localhost:${PORT}/` }, timeout: 60000 });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await page.evaluate(async (html) => {
    const d = await (await import('/src/features/editor/api.ts')).createDraft({ title: 'Long', html });
    window.__store.getState().navigate({ name: 'write', draftId: d.id });
  }, LONG);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await installHelpers(page);
  await page.evaluate(() => { window.__h.select('Partie 3', 0, 0); window.__ed.engine().insertPageBreak(); });
  await page.waitForTimeout(400);
  console.log('image insérée', await page.evaluate((src) => { window.__h.select('ICI-IMAGE', 0, 9); return window.__ed.engine().insertImage(src, 400, 200, 'rouge'); }, PNG));
  await page.waitForTimeout(500);

  // pages de l'éditeur : son DOM n'en garde qu'une fenêtre ; on fait défiler pour toutes les lire
  const editorPages = () => page.evaluate(async () => {
    const out = new Map();
    const sc = document.querySelector('.presentation-editor__pages')?.closest('[class*="scroll"]') ?? document.scrollingElement;
    const scrollers = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
    const s = scrollers.find((e) => e.contains(document.querySelector('.presentation-editor__pages'))) ?? sc;
    for (let y = 0; y <= s.scrollHeight; y += 600) {
      s.scrollTop = y;
      await new Promise((r) => setTimeout(r, 120));
      for (const p of document.querySelectorAll('.presentation-editor__pages .superdoc-page')) {
        const i = Number(p.dataset.pageIndex ?? p.getAttribute('data-page-index') ?? NaN);
        const key = Number.isNaN(i) ? Math.round((p.getBoundingClientRect().top + s.scrollTop) / 100) : i;
        out.set(key, p.innerText.replace(/\s+/g, ''));
      }
    }
    s.scrollTop = 0;
    return [...out.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  });
  async function pdfOf(label) {
    await page.waitForTimeout(2000);
    const ed = await editorPages();
    const r = await page.evaluate(async () => {
      const { guardedExport } = await import('/src/features/editor/save.ts');
      const { usedFonts } = await import('/src/features/editor/exporters.ts');
      const { bundledFontFaceCss } = await import('/src/features/editor/exportFonts.ts');
      const { stripForExport } = await import('/src/features/editor/privateNotes.ts');
      const { renderPagesForPrint } = await import('/src/features/editor/pagePrint.ts');
      const g = await guardedExport(window.__ed.engine());
      const t0 = performance.now();
      const p = await renderPagesForPrint((await stripForExport(g.data)).data, { fontCss: await bundledFontFaceCss(usedFonts(g.model)) });
      const ms = Math.round(performance.now() - t0);
      const buf = new Uint8Array(await window.marginalia.printToPdf(p.html));
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { ms, pages: p.pages, b64: btoa(bin), imgs: (p.html.match(/<img[^>]+src="data:image/g) || []).length, blobs: (p.html.match(/src="blob:/g) || []).length };
    });
    const f = path.join(OUT, `${label}.pdf`);
    fs.writeFileSync(f, Buffer.from(r.b64, 'base64'));
    const info = spawnSync('pdfinfo', [f], { encoding: 'utf8' }).stdout;
    const n = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
    const size = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info);
    let same = 0;
    for (let k = 1; k <= n; k++) {
      const t = spawnSync('pdftotext', ['-f', String(k), '-l', String(k), f, '-'], { encoding: 'utf8' }).stdout.replace(/\s+/g, '');
      if (ed[k - 1] && t.slice(0, 40) === ed[k - 1].slice(0, 40)) same++;
      else if (k <= 2) console.log('   p' + k, JSON.stringify(t.slice(0, 40)), '≠', JSON.stringify((ed[k - 1] ?? '').slice(0, 40)));
    }
    spawnSync('pdftoppm', ['-png', '-r', '40', '-f', '1', '-l', '4', f, path.join(OUT, label)]);
    console.log(`\n── ${label} : éditeur ${ed.length} p., PDF ${n} p., ${r.ms} ms, ${size?.[1]}×${size?.[2]} pt`);
    check(`${label} : même nombre de pages`, n === ed.length, `${n} / ${ed.length}`);
    check(`${label} : chaque page commence comme dans l'éditeur`, same === n, `${same}/${n}`);
    return { n, ed, r, size, f };
  }

  const a = await pdfOf('long');
  check('long : > 10 pages', a.n > 10, a.n);
  check('long : mise en page < 8 s', a.r.ms < 8000, `${a.r.ms} ms`);
  check('long : image incorporée (data:), aucun blob:', a.r.imgs >= 1 && a.r.blobs === 0, a.r);
  const all = spawnSync('pdftotext', [a.f, '-'], { encoding: 'utf8' }).stdout;
  check('long : tableau et fin du document présents', /cellule 2/.test(all) && /FIN-DU-DOCUMENT/.test(all));
  check('long : saut avant « Partie 3 » respecté', a.ed.some((t) => t.startsWith('Partie3')));

  await page.evaluate(() => window.__ed.engine().setOrientation('landscape'));
  const b = await pdfOf('paysage');
  check('paysage : page plus large que haute', b.size && +b.size[1] > +b.size[2], b.size?.slice(1));

  await page.evaluate(() => window.__ed.engine().setOrientation('portrait'));
  await page.evaluate(() => window.__ed.engine().setPageSize({ width: 21.59, height: 27.94 }));
  await page.waitForTimeout(500);
  const ps = await page.evaluate(() => window.__ed.engine().pageSetup());
  console.log('pageSetup', JSON.stringify(ps));
  const c = await pdfOf('lettre');
  check('lettre : 612 × 792 pt', c.size && Math.abs(c.size[1] - 612) < 3 && Math.abs(c.size[2] - 792) < 3, c.size?.slice(1));

  await page.evaluate(async () => { const e = window.__ed.engine(); await e.setPageNumbers('n'); await e.setTitlePage(true); });
  const d = await pdfOf('garde');
  const p1 = spawnSync('pdftotext', ['-f', '1', '-l', '1', d.f, '-'], { encoding: 'utf8' }).stdout.trim();
  const p2 = spawnSync('pdftotext', ['-f', '2', '-l', '2', d.f, '-'], { encoding: 'utf8' }).stdout.trim();
  check('page de garde : pas de numéro sur la page 1, « 2 » sur la page 2', !/\n1$/.test(p1) && /\b2$/.test(p2), [p1.slice(-12), p2.slice(-12)]);

  // thème sombre de l'app : le PDF reste blanc / noir
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.documentElement.classList.add('dark'); });
  const e = await pdfOf('sombre');
  spawnSync('pdftoppm', ['-png', '-r', '20', '-f', '1', '-l', '1', e.f, path.join(OUT, 'sombre-px')]);
  const px = spawnSync('python3', ['-c', `from PIL import Image; im=Image.open('${path.join(OUT, 'sombre-px-01.png').replace(/-01/, (m) => fs.existsSync(path.join(OUT, 'sombre-px-01.png')) ? m : '-1')}').convert('L'); print(sum(im.getdata())/len(im.getdata()))`], { encoding: 'utf8' });
  check('thème sombre : fond du PDF clair', Number(px.stdout) > 200, px.stdout.trim() || px.stderr.slice(0, 200));
  // parcours réel : menu Exporter → PDF (dialogue d'enregistrement simulé dans le processus principal)
  const saved = path.join(OUT, 'via-menu.pdf');
  fs.rmSync(saved, { force: true });
  await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, saved);
  await page.click('.ed-topbar [data-tb="export"]');
  await page.click('.ed-export-menu [data-fmt="pdf"]');
  for (let i = 0; i < 60 && !fs.existsSync(saved); i++) await page.waitForTimeout(500);
  await page.waitForTimeout(500);
  const nMenu = Number(/Pages:\s+(\d+)/.exec(spawnSync('pdfinfo', [saved], { encoding: 'utf8' }).stdout)?.[1]);
  check('menu Exporter → PDF : même nombre de pages que l’éditeur', nMenu === e.ed.length, `${nMenu} / ${e.ed.length}`);
  check('aucune erreur de page', errors.length === 0, errors.join(' | '));
} finally {
  await app.close();
  await server.close();
}
console.log(failed ? `\n${failed} échec(s)` : '\nTout est bon.');
process.exit(failed ? 1 : 0);
