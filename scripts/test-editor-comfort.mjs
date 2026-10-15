// Confort visuel de l'éditeur — port 5371.
// Lancer : timeout 300 node scripts/test-editor-comfort.mjs
// Teinte de page par thème (crème / sépia / sombre) et option « Blanc » ; couleurs remappées à l'écran
// en teinte sombre (texte noir, surlignage, bordures ; images intactes) ; export .docx inchangé quelle
// que soit la teinte ; zoom « Ajuster à la largeur » (bornes, recalcul au redimensionnement, mémorisé,
// ⌘+ / ⌘- / ⌘0) ; nouvel écrit en Literata 12 / 1,5 (w:rFonts, w:sz 24, w:line 360) et réglage
// « Police des nouveaux écrits » ; sélection et barre d'insertion visibles. Captures : shots/editor-comfort/.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/editor-comfort');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5371;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
}
async function shot(page, name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p });
  console.log('capture:', path.relative(ROOT, p));
}
/** Lit des parties d'un .docx (python zipfile). */
function docxParts(file, parts = ['word/document.xml', 'word/styles.xml']) {
  const out = execFileSync('python3', ['-I', '-c', 'import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({n: z.read(n).decode("utf-8") for n in sys.argv[2:] if n in z.namelist()}))', file, ...parts], { maxBuffer: 64 << 20 });
  return JSON.parse(out.toString());
}
async function readLib(page, id, name = 'document.docx') {
  const b64 = await page.evaluate(
    async ({ id, name }) => {
      const { host } = await import('/src/lib/platform.ts');
      const buf = new Uint8Array(await host.readFile(id, name));
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { id, name },
  );
  return Buffer.from(b64, 'base64');
}
async function openDraft(page, id) {
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(900);
}
async function setTheme(page, theme) {
  await page.evaluate((theme) => window.__store.getState().updateSettings({ theme }), theme);
  await page.waitForTimeout(400);
}
async function sel(page, needle, caret = null) {
  const ok = await page.evaluate(
    ({ needle, caret }) => {
      const ed = window.__ed.engine().debugEditor().editor;
      let res = null;
      ed.state.doc.descendants((n, pos) => {
        if (res) return false;
        if (n.isText) {
          const i = n.text.indexOf(needle);
          if (i >= 0) res = { from: pos + i, to: pos + i + needle.length };
        }
        return true;
      });
      if (!res) return false;
      const r = caret === 'start' ? { from: res.from, to: res.from } : caret === 'end' ? { from: res.to, to: res.to } : res;
      ed.commands.setTextSelection(r);
      ed.view.focus();
      return true;
    },
    { needle, caret },
  );
  if (!ok) throw new Error('texte introuvable : ' + needle);
  await page.waitForTimeout(200);
}
async function exportVia(page, file) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    (async () => {
      await page.click('.ed-topbar button:has-text("Exporter")');
      await page.click('.ed-export-menu [data-fmt="docx"]');
    })(),
  ]);
  const p = path.join(OUT, file);
  await dl.saveAs(p);
  return p;
}
/** Couleurs peintes : page, texte automatique, runs repérés par leur texte. */
const painted = (page) =>
  page.evaluate(() => {
    const host = document.querySelector('.ed-engine');
    const pg = document.querySelector('.superdoc-page');
    const run = (t) => [...document.querySelectorAll('.superdoc-page .superdoc-text-run')].find((r) => r.textContent.includes(t));
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const info = (t) => {
      const r = run(t);
      const c = cs(r);
      return r ? { color: c.color, bg: c.backgroundColor, mapped: r.hasAttribute('data-mgl-fg'), font: c.fontFamily } : null;
    };
    const img = document.querySelector('.superdoc-page img');
    const cellBorders = [...document.querySelectorAll('.superdoc-page [style*="border"]')].filter((e) => !e.classList.contains('superdoc-page')).map((e) => getComputedStyle(e).borderTopColor);
    return {
      tint: host?.getAttribute('data-ed-tint'),
      pageBg: cs(pg).backgroundColor,
      auto: info('Texte automatique'),
      black: info('Noir explicite'),
      red: info('Rouge vif'),
      navy: info('Bleu nuit'),
      hl: info('Surligné jaune'),
      img: img ? { filter: cs(img).filter, mapped: img.hasAttribute('data-mgl-bg') || img.hasAttribute('data-mgl-fg'), w: img.getBoundingClientRect().width } : null,
      borders: cellBorders.slice(0, 6),
      remapped: document.querySelectorAll('[data-mgl-fg],[data-mgl-bg],[data-mgl-bd]').length,
    };
  });
const rgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
function lum(c) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(c);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a, b) => {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const server = await createServer({
  root: ROOT,
  cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`),
  server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').slice(0, 600)));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()));
page.on('response', (r) => r.status() >= 400 && errors.push(r.status() + ' : ' + r.url()));

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await setTheme(page, 'light');

  // ── Nouvel écrit (modèle « Vide ») : Literata 12 / 1,5 ──
  const vide = await page.evaluate(async () => (await import('/src/features/editor/impl.ts')).createFromTemplateImpl('vide'));
  const vf = path.join(OUT, 'nouvel-ecrit.docx');
  fs.writeFileSync(vf, await readLib(page, vide.id));
  const vx = docxParts(vf);
  check('nouvel écrit : w:rFonts Literata', /<w:rFonts w:ascii="Literata" w:hAnsi="Literata"/.test(vx['word/styles.xml']));
  check('nouvel écrit : 12 pt (w:sz 24)', /<w:rPrDefault><w:rPr>[^]*?<w:sz w:val="24"\/>/.test(vx['word/styles.xml']));
  check('nouvel écrit : interligne 1,5 (w:line 360) et 6 pt après', /<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360"/.test(vx['word/styles.xml']));
  const ftx = docxParts(vf, ['word/fontTable.xml'])['word/fontTable.xml'] ?? '';
  check('nouvel écrit : table des polices (Literata, famille serif, repli Georgia)', /<w:font w:name="Literata"><w:altName w:val="Georgia"\/>[^]*?<w:family w:val="roman"\/>/.test(ftx));
  const diss = await page.evaluate(async () => (await import('/src/features/editor/impl.ts')).createFromTemplateImpl('universitaire'));
  const df = path.join(OUT, 'universitaire.docx');
  fs.writeFileSync(df, await readLib(page, diss.id));
  check('modèle universitaire : garde Times New Roman', /w:ascii="Times New Roman"/.test(docxParts(df)['word/styles.xml']) && !/Literata/.test(docxParts(df)['word/styles.xml']));

  await openDraft(page, vide.id);
  check('zoom par défaut : « Ajuster à la largeur »', (await page.evaluate(() => window.__ed.engine().debugEditor().superdoc.getZoomState().mode)) === 'fit-width');

  // Contenu de test : texte automatique, couleurs explicites, surlignage, tableau, image.
  await page.evaluate(async () => {
    const e = window.__ed.engine();
    e.focus();
    e.insertText('Texte automatique du corps, assez long pour remplir une ligne entière de la page et montrer la police.');
    e.appendParagraph('Noir explicite. Rouge vif. Bleu nuit. Surligné jaune.');
    e.appendParagraph('Dernier paragraphe du document, après le tableau et l’image.');
  });
  await page.waitForTimeout(300);
  for (const [t, c] of [
    ['Noir explicite', '#000000'],
    ['Rouge vif', '#c00000'],
    ['Bleu nuit', '#1f3864'],
  ]) {
    await sel(page, t);
    await page.evaluate((c) => window.__ed.engine().setColor(c), c);
  }
  await sel(page, 'Surligné jaune');
  await page.evaluate(() => window.__ed.engine().setHighlight('#ffff00'));
  await sel(page, 'Dernier paragraphe', 'start');
  await page.evaluate(() => window.__ed.engine().insertTable(2, 3));
  await page.waitForTimeout(300);
  await sel(page, 'Dernier paragraphe', 'start');
  const pngOk = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 120;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 240, 0);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.5, '#3d6fe0');
    gr.addColorStop(1, '#000000');
    g.fillStyle = gr;
    g.fillRect(0, 0, 240, 120);
    g.fillStyle = '#d33';
    g.fillRect(90, 30, 60, 60);
    return window.__ed.engine().insertImage(c.toDataURL('image/png'), 240, 120, 'dégradé');
  });
  check('image de test insérée', pngOk);
  await page.waitForTimeout(800);

  // Police : Literata réellement chargée et utilisée par les pages peintes
  const font = await page.evaluate(async () => {
    await document.fonts.ready;
    const r = [...document.querySelectorAll('.superdoc-page .superdoc-text-run')].find((x) => x.textContent.includes('Texte automatique'));
    return { family: r ? getComputedStyle(r).fontFamily : '', loaded: [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Literata' && f.status === 'loaded'), size: r ? getComputedStyle(r).fontSize : '' };
  });
  check('pages peintes en Literata (police embarquée chargée), 16 px = 12 pt', /Literata/.test(font.family) && font.loaded && font.size === '16px', JSON.stringify(font));

  // ── Teinte par thème ──
  const want = { light: ['cream', 'rgb(251, 247, 238)'], sepia: ['sepia', 'rgb(244, 234, 213)'], dark: ['dark', 'rgb(42, 41, 38)'] };
  const names = { light: 'clair.png', sepia: 'sepia.png', dark: 'sombre.png' };
  let darkInfo = null;
  for (const th of ['light', 'sepia', 'dark']) {
    await setTheme(page, th);
    await page.waitForTimeout(300);
    const p = await painted(page);
    check(`thème ${th} : page ${want[th][0]}`, p.tint === want[th][0] && p.pageBg === want[th][1], `${p.tint} ${p.pageBg}`);
    check(`thème ${th} : texte automatique lisible`, contrast(p.auto.color, p.pageBg) >= 7, `${p.auto.color} (${contrast(p.auto.color, p.pageBg).toFixed(1)}:1)`);
    for (const k of ['black', 'red', 'navy']) check(`thème ${th} : texte ${k} lisible`, contrast(p[k].color, p.pageBg) >= 3, `${p[k].color} (${contrast(p[k].color, p.pageBg).toFixed(1)}:1)`);
    if (th === 'dark') darkInfo = p;
    await sel(page, 'Texte automatique', 'end');
    await page.mouse.move(5, 5);
    await page.evaluate(() => document.querySelector('.ed-scroll').scrollTo(0, 0));
    await page.waitForTimeout(250);
    await shot(page, names[th]);
  }
  const p = darkInfo;
  check('sombre : noir explicite remappé à l’écran', p.black.mapped && lum(p.black.color) > 0.5, p.black.color);
  check('sombre : rouge garde sa teinte', rgb(p.red.color)[0] > rgb(p.red.color)[1] + 60, p.red.color);
  check('sombre : surlignage assombri, texte lisible dessus', lum(p.hl.bg) < 0.3 && contrast(p.hl.color, p.hl.bg) >= 4.5, `${p.hl.bg} / ${p.hl.color}`);
  check('sombre : bordures du tableau visibles', p.borders.length > 0 && p.borders.every((b) => contrast(b, p.pageBg) >= 1.8), p.borders.join(' '));
  check('sombre : image non inversée ni remappée', p.img && (p.img.filter === 'none' || !p.img.filter) && !p.img.mapped, JSON.stringify(p.img));

  // Export pendant la teinte sombre
  const exDark = await exportVia(page, 'export-sombre.docx');

  // ── Option « Blanc » (thème sombre conservé) ──
  await page.click('.ed-toolbar [data-tb="zoom"]');
  await page.waitForSelector('.ed-view-menu [data-tint="white"]');
  await page.screenshot({ path: path.join(OUT, 'menu-affichage.png') });
  await page.click('.ed-view-menu [data-tint="white"]');
  await page.waitForTimeout(400);
  const w = await painted(page);
  check('option Blanc : page blanche en thème sombre', w.tint === 'white' && w.pageBg === 'rgb(255, 255, 255)', `${w.tint} ${w.pageBg}`);
  check('option Blanc : couleurs réelles (noir explicite noir, aucun remappage)', w.black.color === 'rgb(0, 0, 0)' && w.remapped === 0, `${w.black.color}, ${w.remapped} remappé(s)`);
  check('option Blanc mémorisée', (await page.evaluate(() => localStorage.getItem('marginalia.ed.pageTint'))) === 'white');
  await sel(page, 'Texte automatique', 'end');
  await page.evaluate(() => document.querySelector('.ed-scroll').scrollTo(0, 0));
  await page.waitForTimeout(250);
  await shot(page, 'blanc.png');
  const exWhite = await exportVia(page, 'export-blanc.docx');

  // ── Export .docx inchangé ──
  const a = docxParts(exDark);
  const b = docxParts(exWhite);
  // identifiants d'image (wp:docPr / pic:cNvPr) tirés au hasard à chaque export : neutralisés
  const norm = (x) => x.replace(/(<(?:wp:docPr|pic:cNvPr) id=")\d+"/g, '$1N"');
  check('export Word identique quelle que soit la teinte (document.xml, styles.xml)', norm(a['word/document.xml']) === norm(b['word/document.xml']) && a['word/styles.xml'] === b['word/styles.xml']);
  const dx = a['word/document.xml'];
  check('export Word : couleurs réelles du document (000000, C00000, 1F3864, surlignage jaune)', /w:color w:val="000000"/i.test(dx) && /w:color w:val="C00000"/i.test(dx) && /w:color w:val="1F3864"/i.test(dx) && /w:(highlight w:val="yellow"|shd [^>]*w:fill="FFFF00")/i.test(dx));
  check('export Word : aucune couleur d’affichage (2A2926, E2DCCF, FBF7EE)', !/2A2926|E2DCCF|FBF7EE|F4EAD5/i.test(dx + a['word/styles.xml']));
  check('export Word : table des polices conservée', /w:name="Literata"/.test(docxParts(exDark, ['word/fontTable.xml'])['word/fontTable.xml'] ?? ''));
  check('export Word : police Literata', /w:ascii="Literata"/.test(a['word/styles.xml'] + dx));
  // Impression / PDF : HTML d'impression sans couleur de teinte
  const print = await page.evaluate(async () => {
    const { parseDocx } = await import('/src/features/editor/docx.ts');
    const { toPrintHtml } = await import('/src/features/editor/exporters.ts');
    return toPrintHtml(await parseDocx(await window.__ed.engine().exportDocx()), 'x');
  });
  check('impression : aucune couleur de teinte', !/2a2926|e2dccf|fbf7ee|f4ead5/i.test(print));

  // Retour à « Suivre le thème », sombre : sélection et barre d'insertion
  await page.click('.ed-toolbar [data-tb="zoom"]');
  await page.click('.ed-view-menu [data-tint="theme"]');
  await page.waitForTimeout(400);
  check('Suivre le thème : sombre', (await painted(page)).tint === 'dark');
  await sel(page, 'automatique du corps');
  await page.waitForTimeout(300);
  const selInfo = await page.evaluate(() => {
    const r = document.querySelector('.presentation-editor__selection-rect');
    return r ? getComputedStyle(r).backgroundColor : null;
  });
  check('sélection : couleur adoucie de la teinte sombre', selInfo === 'rgba(132, 160, 220, 0.26)', String(selInfo));
  await page.evaluate(() => document.querySelector('.ed-scroll').scrollTo(0, 0));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  await shot(page, 'selection-sombre.png');
  await setTheme(page, 'light');
  await sel(page, 'automatique du corps');
  await page.waitForTimeout(300);
  check('sélection : couleur adoucie de la teinte crème', (await page.evaluate(() => getComputedStyle(document.querySelector('.presentation-editor__selection-rect')).backgroundColor)) === 'rgba(86, 116, 178, 0.17)');
  await shot(page, 'selection.png');
  await sel(page, 'Rouge vif', 'end');
  await page.waitForTimeout(250);
  const caret = await page.evaluate(() => {
    const c = document.querySelector('.presentation-editor__selection-caret');
    if (!c) return null;
    const s = getComputedStyle(c);
    const r = c.getBoundingClientRect();
    return { bg: s.backgroundColor, w: r.width, h: r.height, op: s.opacity };
  });
  check('barre d’insertion visible (jaune-orangé, 2 px)', caret && /rgb\(236, 155, 0\)/.test(caret.bg) && caret.h > 8 && Number(caret.op) > 0.5, JSON.stringify(caret));
  const cl = await page.evaluate(() => {
    const c = document.querySelector('.presentation-editor__selection-caret');
    const z = c.getBoundingClientRect();
    return { x: z.left + z.width / 2, y: z.top + z.height / 2 };
  });
  await page.screenshot({ path: path.join(OUT, 'curseur.png'), clip: { x: cl.x - 120, y: cl.y - 40, width: 240, height: 80 } });

  // ── Décorations sur page sombre : note privée, recherche, correcteur ──
  await setTheme(page, 'dark');
  await sel(page, 'tableau et l’image.', 'end');
  await page.evaluate(() => window.__ed.engine().togglePrivateNote());
  await page.waitForTimeout(300);
  await page.keyboard.type('Note privée : vérifier cette référence.');
  await page.waitForTimeout(500);
  const pn = await page.evaluate(() => {
    const f = [...document.querySelectorAll('.superdoc-fragment[data-style-id="MarginaliaNotePrivee"]')].pop();
    const sh = f?.querySelector('.superdoc-paragraph-shading');
    const r = f?.querySelector('.superdoc-text-run');
    return f ? { bg: sh ? getComputedStyle(sh).backgroundColor : null, ink: r ? getComputedStyle(r).color : null } : null;
  });
  check('note privée lisible sur page sombre', pn && pn.bg && contrast(pn.ink, pn.bg) >= 4.5 && lum(pn.bg) < 0.1, JSON.stringify(pn));
  await page.evaluate(() => window.__ed.engine().focus());
  await page.keyboard.press('Control+f');
  await page.waitForSelector('[data-find="query"]');
  await page.fill('[data-find="query"]', 'corps');
  await page.waitForTimeout(500);
  const fm = await page.evaluate(() => {
    const m = document.querySelector('.superdoc-text-run.ProseMirror-active-search-match, .superdoc-text-run.ProseMirror-search-match');
    return m ? { bg: getComputedStyle(m).backgroundColor, color: getComputedStyle(m).color } : null;
  });
  check('recherche : occurrence visible et lisible sur page sombre', fm && /rgba/.test(fm.bg), JSON.stringify(fm));
  await page.evaluate(() => document.querySelector('.ed-scroll').scrollTo(0, 0));
  await page.waitForTimeout(200);
  await shot(page, 'decorations-sombre.png');
  await page.keyboard.press('Escape');
  await setTheme(page, 'light');
  await page.waitForTimeout(200);
  await shot(page, 'decorations-clair.png');

  // ── Zoom : ajuster à la largeur ──
  const fit1 = await page.evaluate(() => ({ z: window.__ed.engine().zoom(), w: document.querySelector('.superdoc-page').getBoundingClientRect().width, avail: document.querySelector('.ed-scroll').clientWidth, label: document.querySelector('.ed-tb-zoom .ed-tb-menu-text')?.textContent }));
  check('ajuster à la largeur : bornes 75–200 %', fit1.z >= 75 && fit1.z <= 200, JSON.stringify(fit1));
  check('ajuster à la largeur : la page tient dans la largeur disponible', (fit1.z === 75 || fit1.w <= fit1.avail) && (fit1.z === 75 || fit1.z === 200 || fit1.w >= fit1.avail - 80), JSON.stringify(fit1));
  await page.setViewportSize({ width: 1900, height: 1000 });
  await page.waitForTimeout(900);
  const fit2 = await page.evaluate(() => ({ z: window.__ed.engine().zoom(), w: document.querySelector('.superdoc-page').getBoundingClientRect().width, avail: document.querySelector('.ed-scroll').clientWidth, label: document.querySelector('.ed-tb-zoom .ed-tb-menu-text')?.textContent }));
  check('redimensionnement : zoom recalculé (plus large → plus grand)', fit2.z > fit1.z && fit2.label === `${fit2.z} %`, `${fit1.z} → ${fit2.z} (${fit2.label})`);
  await page.click('[aria-label*="panneau"], .ed-topbar [title*="anneau"]').catch(() => {});
  await page.waitForTimeout(900);
  const fit3 = await page.evaluate(() => ({ z: window.__ed.engine().zoom(), avail: document.querySelector('.ed-scroll').clientWidth }));
  check('panneau latéral basculé : zoom recalculé', fit3.avail === fit2.avail || fit3.z !== fit2.z, `${fit2.avail}px/${fit2.z} → ${fit3.avail}px/${fit3.z}`);
  await page.click('[aria-label*="panneau"], .ed-topbar [title*="anneau"]').catch(() => {});
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(900);
  await sel(page, 'Rouge vif', 'end');
  const docBefore = await page.evaluate(() => window.__ed.engine().state().fontSize);

  // Valeur fixe, mémorisée
  await page.click('.ed-toolbar [data-tb="zoom"]');
  await page.click('.ed-view-menu [data-zoom="125"]');
  await page.waitForTimeout(500);
  check('zoom 125 % mémorisé', (await page.evaluate(() => [window.__ed.engine().zoom(), localStorage.getItem('marginalia.ed.zoom')])).join() === '125,125');
  // Raccourcis (le texte a le focus)
  await sel(page, 'Rouge vif', 'end');
  await page.keyboard.press('Control+=');
  await page.waitForTimeout(400);
  const zPlus = await page.evaluate(() => window.__ed.engine().zoom());
  check('⌘+ : zoom de la page augmente', zPlus === 150, String(zPlus));
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  await page.waitForTimeout(400);
  const zMinus = await page.evaluate(() => window.__ed.engine().zoom());
  check('⌘- : zoom de la page diminue', zMinus === 110, String(zMinus));
  const docAfter = await page.evaluate(() => window.__ed.engine().state().fontSize);
  check('la taille du document ne change pas', docAfter === docBefore && docBefore === 12, `${docBefore} → ${docAfter}`);
  // reprise après réouverture
  await page.evaluate(() => window.__store.getState().navigate({ name: 'write', draftId: null }));
  await page.waitForTimeout(800);
  await openDraft(page, vide.id);
  check('zoom mémorisé à la réouverture', (await page.evaluate(() => window.__ed.engine().zoom())) === 110);
  await sel(page, 'Rouge vif', 'end');
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(600);
  const z0 = await page.evaluate(() => [window.__ed.engine().debugEditor().superdoc.getZoomState().mode, localStorage.getItem('marginalia.ed.zoom')]);
  check('⌘0 : retour à « Ajuster à la largeur »', z0.join() === 'fit-width,fit', z0.join());
  // hors du texte : le raccourci n'est pas intercepté
  await page.evaluate(() => document.activeElement?.blur());
  await page.focus('.ed-title-input');
  const passed = await page.evaluate(() => {
    const ev = new KeyboardEvent('keydown', { key: '=', code: 'Equal', ctrlKey: true, bubbles: true, cancelable: true });
    document.querySelector('.ed-title-input').dispatchEvent(ev);
    return !ev.defaultPrevented;
  });
  check('⌘+ hors du texte : laissé au zoom de l’interface', passed);

  // ── Réglage « Police des nouveaux écrits » ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'write', draftId: null }));
  await page.waitForSelector('.ed-list-inner', { timeout: 15000 });
  await page.click('.ed-list button:has-text("Nouveau")');
  await page.waitForSelector('[data-new-font]');
  check('menu Nouveau : Literata par défaut', (await page.inputValue('[data-new-font]')) === 'Literata');
  await page.screenshot({ path: path.join(OUT, 'nouveau-police.png') });
  await page.selectOption('[data-new-font]', 'Georgia');
  check('police des nouveaux écrits mémorisée', (await page.evaluate(() => localStorage.getItem('marginalia.ed.newDraftFont'))) === 'Georgia');
  const geo = await page.evaluate(async () => (await import('/src/features/editor/impl.ts')).createFromTemplateImpl('vide'));
  const gf = path.join(OUT, 'nouvel-ecrit-georgia.docx');
  fs.writeFileSync(gf, await readLib(page, geo.id));
  check('nouvel écrit en Georgia', /w:ascii="Georgia"/.test(docxParts(gf)['word/styles.xml']));
  const md = await page.evaluate(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Importé', html: '<p>Sans modèle</p>' }));
  const mf = path.join(OUT, 'sans-modele.docx');
  fs.writeFileSync(mf, await readLib(page, md.id));
  check('écrit créé sans modèle : police choisie', /w:ascii="Georgia"/.test(docxParts(mf)['word/styles.xml']));
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('marginalia.ed.newDraftFont', 'Literata'));

  check('aucune erreur dans la page', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  console.error(e);
  check('exécution sans exception', false, String(e).slice(0, 300));
  await shot(page, 'erreur.png').catch(() => {});
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
