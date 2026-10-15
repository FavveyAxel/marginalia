// Tests de mise en forme et de mise en page du module Écrire — port 5216.
// Lancer : timeout 600 node scripts/test-editor-format.mjs [--only=format,univ,fixture,shots]
// Chaque .docx enregistré est vérifié : XML bien formé (minidom), schéma OOXML (validateur XSD, aucune
// nouvelle erreur par rapport au fichier d'origine), relu par python-docx, converti en PDF par LibreOffice,
// puis rouvert dans l'éditeur.
import { shot } from './harness.mjs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/editor-format/out');
const SHOTS = 'shots/editor-format';
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);
const PORT = 5216;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-format-'));
const VALIDATOR = '/mnt/skills/public/docx/scripts/office/validate.py';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`);
}
const py = (code, ...a) => execFileSync('python3', ['-I', '-c', code, ...a], { encoding: 'utf8', maxBuffer: 32 << 20 });

// ── Vérifications hors navigateur ─────────────────────────────
const WELLFORMED_PY = `
import sys, zipfile, json
from xml.dom import minidom
z = zipfile.ZipFile(sys.argv[1]); bad = []
for n in z.namelist():
    if n.endswith('.xml') or n.endswith('.rels'):
        try: minidom.parseString(z.read(n))
        except Exception as e: bad.append(n + ': ' + str(e)[:120])
print(json.dumps(bad))
`;
/** minidom + python-docx + validateur XSD + LibreOffice. Renvoie le texte du PDF. */
function validateDocx(file, label, original) {
  const bad = JSON.parse(py(WELLFORMED_PY, file));
  check(`${label} : XML bien formé (minidom, toutes les parties)`, bad.length === 0, bad.join(' | '));
  let pd = '';
  try {
    pd = py('import sys, docx\nd = docx.Document(sys.argv[1])\nprint(len(d.paragraphs))', file).trim();
    check(`${label} : ouvert par python-docx`, Number(pd) > 0, `${pd} paragraphes`);
  } catch (e) {
    check(`${label} : ouvert par python-docx`, false, String(e.stderr || e).slice(-300));
  }
  if (fs.existsSync(VALIDATOR)) {
    const r = spawnSync('python3', [VALIDATOR, file, ...(original ? ['--original', original] : [])], { encoding: 'utf8' });
    const out = (r.stdout + r.stderr).trim();
    const failed = /FAILED/.test(out);
    check(`${label} : schéma OOXML (aucune nouvelle erreur XSD${original ? ' par rapport à l’original' : ''})`, !failed, failed ? out.split('\n').filter((l) => /FAILED|- |word\//.test(l)).slice(0, 6).join(' | ') : 'PASSED');
  } else check(`${label} : schéma OOXML`, true, 'validateur XSD absent : non vérifié');
  // LibreOffice
  const outDir = fs.mkdtempSync(path.join(TMP, 'pdf-'));
  const lo = spawnSync('soffice', [`-env:UserInstallation=file://${TMP}/lo-profile`, '--headless', '--convert-to', 'pdf', '--outdir', outDir, file], { encoding: 'utf8', timeout: 120000 });
  const pdf = path.join(outDir, path.basename(file).replace(/\.docx$/, '.pdf'));
  const okPdf = fs.existsSync(pdf) && fs.statSync(pdf).size > 1000;
  check(`${label} : converti en PDF par LibreOffice`, okPdf, okPdf ? `${fs.statSync(pdf).size} octets` : (lo.stderr || lo.stdout || '').slice(-300));
  if (!okPdf) return { text: '', fonts: '', pdf: null };
  fs.copyFileSync(pdf, path.join(OUT, path.basename(pdf)));
  const text = spawnSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }).stdout ?? '';
  const fonts = spawnSync('pdffonts', [pdf], { encoding: 'utf8' }).stdout ?? '';
  return { text, fonts, pdf };
}

// Lecture détaillée (python-docx + XML) d'un .docx enregistré
const INSPECT_PY = `
import sys, zipfile, re, json, docx
from docx.shared import Pt, Cm
path = sys.argv[1]
d = docx.Document(path)
z = zipfile.ZipFile(path)
X = {n: z.read(n).decode('utf8') for n in z.namelist() if n.endswith('.xml') or n.endswith('.rels')}
doc = X['word/document.xml']; sty = X.get('word/styles.xml',''); num = X.get('word/numbering.xml','')
def para_xml(needle):
    for m in re.finditer(r'<w:p[ >].*?</w:p>', doc, re.S):
        if needle in re.sub(r'<[^>]+>', '', m.group(0)): return m.group(0)
    return ''
def style_xml(sid):
    m = re.search(r'<w:style [^>]*w:styleId="%s".*?</w:style>' % sid, sty, re.S)
    return m.group(0) if m else ''
out = {}
out['paras'] = [(p.style.name, p.text) for p in d.paragraphs]
# python-docx : mise en forme des runs d'un passage
def runs_of(needle):
    for p in d.paragraphs:
        if needle in p.text:
            return p, [dict(text=r.text, font=r.font.name, size=r.font.size.pt if r.font.size else None, color=str(r.font.color.rgb) if r.font.color and r.font.color.type else None, bold=r.bold, italic=r.italic, sc=r.font.small_caps, sup=r.font.superscript) for r in p.runs]
    return None, []
for key in sys.argv[2:]:
    p, runs = runs_of(key)
    out['runs:' + key] = runs
    if p is not None:
        pf = p.paragraph_format
        out['pf:' + key] = dict(style=p.style.name, align=str(pf.alignment), line=pf.line_spacing, first=pf.first_line_indent.cm if pf.first_line_indent is not None else None, before=pf.space_before.pt if pf.space_before is not None else None, after=pf.space_after.pt if pf.space_after is not None else None)
    out['xml:' + key] = para_xml(key)[:1500]
N = d.styles['Normal']
out['normal'] = dict(font=N.font.name, size=N.font.size.pt if N.font.size else None, line=N.paragraph_format.line_spacing, align=str(N.paragraph_format.alignment), first=N.paragraph_format.first_line_indent.cm if N.paragraph_format.first_line_indent is not None else None)
out['normalXml'] = style_xml('Normal')
out['footnoteStyle'] = style_xml('FootnoteText')
s0 = d.sections[0]
out['section'] = dict(orient=str(s0.orientation), w=s0.page_width.cm, h=s0.page_height.cm, top=s0.top_margin.cm, bottom=s0.bottom_margin.cm, left=s0.left_margin.cm, right=s0.right_margin.cm, titlePg=s0.different_first_page_header_footer)
out['footerXml'] = ' '.join(v for k, v in X.items() if re.match(r'word/footer\\d+\\.xml', k))
out['footerDefaultText'] = s0.footer.paragraphs[0].text if s0.footer.paragraphs else ''
out['tables'] = [dict(rows=len(t.rows), cols=len(t.columns)) for t in d.tables]
out['tblXml'] = (re.search(r'<w:tbl>.*?</w:tbl>', doc, re.S) or [''])[0][:3000] if '<w:tbl>' in doc else ''
out['images'] = len(d.inline_shapes)
out['media'] = [n for n in z.namelist() if n.startswith('word/media/')]
out['rels'] = X.get('word/_rels/document.xml.rels','')
out['sectPr'] = re.findall(r'<w:sectPr\\b.*?</w:sectPr>', doc, re.S)[-1] if '<w:sectPr' in doc else ''
out['pageBreaks'] = len(re.findall(r'<w:br w:type="page"\\s*/>', doc))
out['toc'] = 'TOC \\\\o' in doc or 'TOC \\\\\\\\o' in doc or bool(re.search(r'instrText[^>]*>[^<]*TOC ', doc))
out['tocParas'] = [re.sub(r'<[^>]+>', '', m.group(0)) for m in re.finditer(r'<w:p[ >](?:(?!</w:p>).)*?<w:pStyle w:val="TOC\\d".*?</w:p>', doc, re.S)][:6]
out['tocStyles'] = [s for s in ['TOC1','TOC2','TOC3'] if style_xml(s)]
out['numbering'] = re.findall(r'<w:lvlText w:val="([^"]*)"', num)
out['hasNumPr'] = re.findall(r'<w:numPr>.*?</w:numPr>', doc, re.S)[:6]
out['hyperlinks'] = re.findall(r'<w:hyperlink [^>]*>', doc)
out['headings'] = [dict(style=p.style.name, text=p.text, bold=[r.bold for r in p.runs], color=[str(r.font.color.rgb) if r.font.color and r.font.color.type else None for r in p.runs]) for p in d.paragraphs if p.style.name.startswith('Heading')]
print(json.dumps(out, ensure_ascii=False))
`;
const inspect = (file, ...needles) => JSON.parse(py(INSPECT_PY, file, ...needles));

// ── Application ───────────────────────────────────────────────
async function withApp(fn) {
  const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  // Electron accorde local-fonts sans invite (research/10) ; Chromium de test : autorisation explicite.
  await ctx.grantPermissions(['local-fonts'], { origin: `http://localhost:${PORT}` });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 90000 });
    await fn(page, errors);
  } finally {
    const relevant = [...new Set(errors)].filter((e) => !/404 \(Not Found\)/.test(e));
    if (relevant.length) console.log('ERREURS NAVIGATEUR:\n' + relevant.join('\n'));
    await browser.close();
    await server.close();
  }
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
  await page.waitForTimeout(1000);
}
async function backToList(page) {
  await page.evaluate(() => window.__store.getState().navigate({ name: 'write', draftId: null }));
  await page.waitForSelector('.ed-list-inner', { timeout: 15000 });
  await page.waitForTimeout(1500);
}
async function waitSaved(page, timeout = 20000) {
  await page.waitForFunction(() => document.querySelector('.ed-status')?.dataset.status === 'saved', null, { timeout });
}
async function idle(page) {
  await page.waitForFunction(() => !document.querySelector('[aria-label="Mise en page en cours"]'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
}
/** Sélectionne `needle` dans le document (n-ième occurrence) ; `caret` : 'start' | 'end' | null. */
async function sel(page, needle, caret = null, nth = 0) {
  const ok = await page.evaluate(
    ({ needle, caret, nth }) => {
      const ed = window.__ed.engine().debugEditor().editor;
      let res = null;
      let k = 0;
      ed.state.doc.descendants((n, pos) => {
        if (res) return false;
        if (n.isText) {
          let i = -1;
          while ((i = n.text.indexOf(needle, i + 1)) >= 0) {
            if (k++ === nth) {
              res = { from: pos + i, to: pos + i + needle.length };
              break;
            }
          }
        }
        return true;
      });
      if (!res) return false;
      const r = caret === 'start' ? { from: res.from, to: res.from } : caret === 'end' ? { from: res.to, to: res.to } : res;
      ed.commands.setTextSelection(r);
      ed.view.focus();
      return true;
    },
    { needle, caret, nth },
  );
  if (!ok) throw new Error('texte introuvable : ' + needle);
  await page.waitForTimeout(150);
}
const state = (page) => page.evaluate(() => window.__ed.engine().state());
async function menu(page, tb, item) {
  await page.click(tb === 'zoom' || tb === 'page' ? `.ed-topbar [data-tb="${tb}"]` : `.ed-toolbar [data-tb="${tb}"]`);
  await page.waitForTimeout(150);
  await page.click(item);
  await page.waitForTimeout(250);
}

// ═════════════════════════════════════════════════════════════
await withApp(async (page) => {
  const external = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!/^(http:\/\/localhost|data:|blob:)/.test(u)) external.push(u);
  });

  // ── 1. Mise en forme complète sur un écrit, puis enregistrement et contrôles ──
  if (want('format')) {
    const html = [
      '<h1>Introduction</h1>',
      '<p>Le bon sens est la chose du monde la mieux partagée.</p>',
      '<p>Deuxième paragraphe du texte, à justifier.</p>',
      '<p>Point un</p><p>Point deux</p><p>Point trois</p>',
      '<h1>Développement</h1>',
      '<p>Texte de la partie avec un lien vers Descartes.</p>',
      '<p>Paragraphe avant le tableau.</p>',
      '<h2>Sous-partie</h2>',
      '<p>Dernier paragraphe.</p>',
    ].join('');
    const d = await page.evaluate(async (html) => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Mise en forme', html }), html);
    const initial = await readLib(page, d.id);
    const p0 = path.join(OUT, 'format-initial.docx');
    fs.writeFileSync(p0, initial);
    await openDraft(page, d.id);

    // Liste des polices du système (queryLocalFonts)
    await sel(page, 'bon sens');
    await page.click('.ed-toolbar [data-tb="font"]');
    await page.waitForSelector('.ed-font-row', { timeout: 10000 });
    const nFonts = await page.locator('.ed-font-row').count();
    const foot = await page.textContent('.ed-font-foot');
    check('polices : liste des polices installées (queryLocalFonts)', nFonts > 20 && !/Liste de base/.test(foot), `${nFonts} lignes`);
    const preview = await page.evaluate(() => {
      const el = document.querySelector('.ed-font-row[data-font="DejaVu Serif"] .ed-font-preview');
      return el ? getComputedStyle(el).fontFamily : null;
    });
    check('polices : aperçu de chaque nom dans sa police', /DejaVu Serif/.test(preview ?? ''), preview);
    await page.fill('.ed-font-search input', 'latin modern rom');
    await page.waitForTimeout(150);
    const found = await page.locator('.ed-font-row').allTextContents();
    check('polices : recherche', found.some((t) => t.includes('Latin Modern Roman')), found.slice(0, 4).join(' / '));
    await page.click('.ed-font-row[data-font="Latin Modern Roman"]');
    await page.waitForTimeout(250);
    // favori
    await page.click('.ed-toolbar [data-tb="font"]');
    await page.waitForTimeout(200);
    await page.hover('.ed-font-row[data-font="Caladea"]');
    await page.click('.ed-font-row[data-font="Caladea"] .ed-font-star');
    const favs = await page.evaluate(() => [...document.querySelectorAll('.ed-font-group')].map((g) => g.textContent));
    const recents = await page.evaluate(() => JSON.parse(localStorage.getItem('marginalia.fonts.recent') || '[]'));
    check('polices : favoris et récentes', favs.some((g) => /Favoris/.test(g)) && recents[0] === 'Latin Modern Roman', `${favs.join(', ')} ; récentes ${recents.join(', ')}`);
    await page.keyboard.press('Escape');

    // taille 14 (saisie) puis ⌘⇧> / ⌘⇧< (retour à 14)
    await sel(page, 'bon sens');
    await page.fill('.ed-toolbar [data-tb="size"]', '14');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await sel(page, 'bon sens');
    await page.keyboard.press('Control+Shift+Period');
    await page.waitForTimeout(150);
    const bigger = (await state(page)).fontSize;
    await page.keyboard.press('Control+Shift+Comma');
    await page.waitForTimeout(150);
    let st = await state(page);
    check('taille : saisie 14 pt et raccourcis plus grand / plus petit', st.fontSize === 14 && bigger === 16, `après ⌘⇧> : ${bigger} ; ensuite ${st.fontSize}`);
    check('reflet dans la barre : police et taille de la sélection', (await page.inputValue('.ed-toolbar [data-tb="size"]')) === '14' && (await page.textContent('.ed-toolbar [data-tb="font"]')).includes('Latin Modern Roman'));
    // couleur, surlignage
    await menu(page, 'color', '.ed-color-menu [data-color="#7A1F1F"]');
    await sel(page, 'bon sens');
    await menu(page, 'highlight', '.ed-color-menu [data-color="#FFF2A8"]');
    // petites capitales + exposant sur « Le »
    await sel(page, 'chose');
    await menu(page, 'chars', '.ed-chars-menu [data-mark="smallCaps"]');
    await sel(page, 'monde');
    await page.keyboard.press('Control+Period');
    await page.waitForTimeout(150);
    st = await state(page);
    check('exposant (⌘.)', st.superscript);
    await sel(page, 'partagée');
    await page.keyboard.press('Control+Shift+X');
    await page.waitForTimeout(150);
    check('barré (⌘⇧X)', (await state(page)).strike);
    // effacer la mise en forme d'un passage d'un titre : le style du paragraphe reste
    await sel(page, 'Développement');
    await page.keyboard.press('Control+b');
    await menu(page, 'color', '.ed-color-menu [data-color="#1F4E9A"]');
    await sel(page, 'Développement');
    await page.keyboard.press('Control+Backslash');
    await page.waitForTimeout(200);
    st = await state(page);
    check('effacer la mise en forme : caractères nettoyés, style de paragraphe conservé', st.color === null && st.style === 'h1', `couleur ${st.color}, style ${st.style}`);

    // paragraphe : justifié, interligne 1,5, alinéa, espacement
    await sel(page, 'Deuxième paragraphe', 'start');
    await menu(page, 'align', '.ed-align-menu [data-align="justify"]');
    await menu(page, 'spacing', '.ed-spacing-menu [data-line="1.5"]');
    await menu(page, 'spacing', '.ed-spacing-menu [data-action="alinea"]');
    await page.click('.ed-toolbar [data-tb="spacing"]');
    await page.fill('.ed-spacing-menu [data-field="space-after"]', '9');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    st = await state(page);
    check('paragraphe : justifié, interligne 1,5, alinéa 1,25 cm, 9 pt après', st.align === 'justify' && st.lineHeight === 1.5 && st.firstLine === 709 && st.spaceAfter === 180, JSON.stringify({ a: st.align, l: st.lineHeight, f: st.firstLine, s: st.spaceAfter }));
    check('reflet dans la barre : icône d’alignement', (await page.getAttribute('.ed-toolbar [data-tb="align"] svg', 'class'))?.includes('justify'));

    // liste multiniveau 1. / 1.1.
    await sel(page, 'Point un', 'start');
    await page.evaluate(() => {
      const ed = window.__ed.engine().debugEditor().editor;
      const s = ed.state.selection.from;
      let to = s;
      ed.state.doc.descendants((n, pos) => {
        if (n.isText && n.text.includes('Point trois')) to = pos + n.text.length;
        return true;
      });
      ed.commands.setTextSelection({ from: s, to });
    });
    await menu(page, 'lists', '.ed-lists-menu [data-list="outline"]');
    await sel(page, 'Point deux', 'start');
    await menu(page, 'lists', '.ed-lists-menu [data-list="level+"]');
    st = await state(page);
    check('liste multiniveau : numérotée, niveau 2', st.list === 'ordered' && st.listLevel === 1, `${st.list} niveau ${st.listLevel}`);

    // lien (⌘⇧K, l'app garde ⌘K pour la palette)
    await sel(page, 'Descartes');
    await page.keyboard.press('Control+Shift+K');
    await page.waitForSelector('.ed-link-editor', { timeout: 5000 });
    const paletteOpen = await page.evaluate(() => window.__store.getState().commandOpen);
    await page.fill('.ed-link-editor [data-field="href"]', 'fr.wikipedia.org/wiki/René_Descartes');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await sel(page, 'Descartes', 'start');
    await page.keyboard.press('ArrowRight');
    st = await state(page);
    check('lien : ⌘⇧K, adresse complétée en https://', st.link === 'https://fr.wikipedia.org/wiki/René_Descartes' && !paletteOpen, `${st.link} ; palette ouverte : ${paletteOpen}`);

    // tableau 3 colonnes × 2 lignes, + ligne, fusion
    await sel(page, 'avant le tableau.', 'end');
    // Barre de mise en forme sur une seule ligne (1440 px) ; mise en page et zoom dans la barre du haut,
    // après la concentration ; bouton Tableau seulement le curseur dans un tableau (insertion par « + »).
    const bar = await page.evaluate(() => {
      const tb = document.querySelector('.ed-toolbar');
      const tops = new Set([...tb.querySelectorAll(':scope > .ed-tb-group')].map((g) => Math.round(g.getBoundingClientRect().top)));
      const top = [...document.querySelectorAll('.ed-topbar > *')];
      const i = (sel) => top.findIndex((el) => el.matches(sel) || !!el.querySelector(sel));
      return { rows: tops.size, more: !!tb.querySelector('[data-tb="more"]'), inTb: !!tb.querySelector('[data-tb="page"], [data-tb="zoom"]'), order: [i('[data-focus-toggle]'), i('[data-tb="page"]'), i('[data-tb="zoom"]'), top.findIndex((el) => /Exporter/.test(el.textContent || ''))] };
    });
    check('barre de mise en forme : une ligne, rien sous « … » (1440 px)', bar.rows === 1 && !bar.more, JSON.stringify(bar));
    check('mise en page et zoom : barre du haut, entre concentration et Exporter', !bar.inTb && bar.order.every((n, k) => n >= 0 && (k === 0 || n > bar.order[k - 1])), JSON.stringify(bar.order));
    check('tableau : pas de bouton Tableau hors d’un tableau', (await page.locator('.ed-toolbar [data-tb="table"]').count()) === 0);
    // Fenêtre étroite (1000 px, minimum de la fenêtre) : groupes rangés sous « … », toujours une ligne
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.waitForTimeout(500);
    const narrow = await page.evaluate(() => {
      const tb = document.querySelector('.ed-toolbar');
      const top = document.querySelector('.ed-topbar');
      return { rows: new Set([...tb.querySelectorAll(':scope > .ed-tb-group')].map((g) => Math.round(g.getBoundingClientRect().top))).size, collapsed: tb.dataset.collapsed ?? '', topOverflow: top.scrollWidth - top.clientWidth };
    });
    await page.click('.ed-toolbar [data-tb="more"]');
    const inMore = await page.locator('.ed-tb-overflow [data-tb="undo"], .ed-tb-overflow [data-tb="insert"]').count();
    await page.keyboard.press('Escape');
    check('fenêtre étroite : une ligne, groupes sous « … », barre du haut sans débordement', narrow.rows === 1 && narrow.collapsed.includes('history') && inMore === 2 && narrow.topOverflow <= 0, JSON.stringify({ ...narrow, inMore }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    await sel(page, 'avant le tableau.', 'end');
    await page.click('.ed-toolbar [data-tb="insert"]');
    await page.hover('.ed-insert-menu [data-grid="2x3"]');
    await page.click('.ed-insert-menu [data-grid="2x3"]');
    await page.waitForTimeout(400);
    st = await state(page);
    check('tableau : inséré, menu Tableau activé', st.inTable && !(await page.isDisabled('.ed-toolbar [data-tb="table"]')));
    await menu(page, 'table', '.ed-table-menu [data-table="rowAfter"]');
    await page.evaluate(() => {
      const ed = window.__ed.engine().debugEditor().editor;
      const cells = [];
      ed.state.doc.descendants((n, p) => {
        if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') cells.push(p);
        return true;
      });
      ed.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
    });
    await menu(page, 'table', '.ed-table-menu [data-table="merge"]');
    await page.keyboard.type('Cellule fusionnée');

    // image depuis un fichier
    await sel(page, 'Dernier paragraphe.', 'end');
    await page.setInputFiles('.ed-toolbar [data-input="image"]', path.join(ROOT, 'fixtures/cover.png'));
    await page.waitForTimeout(800);

    // saut de page (⌘↩) avant la sous-partie
    await sel(page, 'Paragraphe avant le tableau.', 'end');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(300);

    // caractères spéciaux
    await sel(page, 'Dernier paragraphe.', 'end');
    await page.click('.ed-toolbar [data-tb="insert"]');
    await page.click('.ed-insert-menu [data-char="Guillemet ouvrant et espace insécable"]');
    await page.keyboard.type('cogito'); // le menu reste ouvert pour enchaîner les caractères
    await page.click('.ed-insert-menu [data-char="Espace insécable et guillemet fermant"]');
    await page.keyboard.press('Escape');

    // Mise en page : marges étroites, paysage, numéros « Page X / Y », page de garde
    await page.click('.ed-topbar [data-tb="page"]');
    await page.waitForSelector('.ed-page-setup');
    await page.click('.ed-page-setup [data-margins="narrow"]');
    await idle(page);
    await page.click('.ed-page-setup [data-orientation="landscape"]');
    await idle(page);
    await page.click('.ed-page-setup [data-numbers="n-of-total"]');
    await idle(page);
    await page.check('.ed-page-setup [data-field="title-page"]');
    await idle(page);
    const ps = await page.evaluate(() => window.__ed.engine().pageSetup());
    check('mise en page : marges, orientation, numéros, page de garde (relus dans l’éditeur)', ps.orientation === 'landscape' && ps.margins.left === 1.27 && ps.pageNumbers === 'n-of-total' && ps.titlePage, JSON.stringify(ps));
    const stray = await page.evaluate(() => [...document.body.children].filter((c) => c.getBoundingClientRect().top < 2 && c.getBoundingClientRect().height > 10 && getComputedStyle(c).visibility !== 'hidden' && !c.matches('#root, .app, script')).length);
    check('mise en page : l’éditeur du pied de page n’apparaît pas dans l’interface', stray === 0, `${stray} élément(s) visible(s)`);
    await page.keyboard.press('Escape');

    // ⌘Z annule une opération de mise en page (instantané)
    await page.click('.ed-topbar [data-tb="page"]');
    await page.click('.ed-page-setup [data-margins="wide"]');
    await idle(page);
    await page.keyboard.press('Escape');
    await sel(page, 'Dernier', 'start');
    await page.keyboard.press('Control+z');
    await idle(page);
    await page.waitForTimeout(800);
    const psUndo = await page.evaluate(() => window.__ed.engine().pageSetup());
    check('⌘Z : la dernière modification de mise en page est annulée', psUndo.margins.left === 1.27 && psUndo.pageNumbers === 'n-of-total', JSON.stringify(psUndo.margins));

    // Table des matières (avant le premier titre)
    await sel(page, 'Introduction', 'start');
    await menu(page, 'insert', '.ed-insert-menu [data-insert="toc"]');
    await page.waitForTimeout(1500);
    check('table des matières : insérée', (await page.evaluate(() => window.__ed.engine().tocCount())) === 1);

    // Modifier le style « Corps » : police, taille, interligne, justification, alinéa
    await sel(page, 'Dernier paragraphe', 'start');
    await menu(page, 'style', '.ed-style-menu [data-action="modify-style"]');
    await page.waitForSelector('.ed-style-editor');
    await page.selectOption('.ed-style-editor select', 'body');
    await page.click('.ed-style-editor [data-tb="font"]');
    await page.fill('.ed-font-search input', 'DejaVu Serif');
    await page.click('.ed-font-row[data-font="DejaVu Serif"]');
    await page.fill('.ed-style-editor [data-field="style-size"]', '11,5');
    await page.keyboard.press('Enter');
    await page.click('.ed-style-editor [data-line="2"]');
    await page.click('.ed-style-editor [data-align="both"]');
    await page.fill('.ed-style-editor [data-field="style-indent"]', '1,25');
    await page.keyboard.press('Enter');
    await page.click('.ed-style-editor [data-action="apply-style"]');
    await idle(page);
    await page.waitForTimeout(1200);
    const bodyProps = await page.evaluate(() => window.__ed.engine().styleProps('body'));
    check('modifier le style Corps : appliqué et relu après réouverture', bodyProps.fontFamily === 'DejaVu Serif' && bodyProps.fontSize === 11.5 && bodyProps.lineSpacing === 2 && bodyProps.align === 'both' && bodyProps.firstLine === 709, JSON.stringify(bodyProps));
    const cursorKept = await page.evaluate(() => window.__ed.engine().state().pos);
    check('modifier le style : position du curseur conservée', cursorKept > 10, `pos ${cursorKept}`);
    // la mise à jour de la table des matières garde des numéros de page
    await menu(page, 'insert', '.ed-insert-menu [data-insert="toc"]');
    await page.waitForTimeout(1500);

    // Zoom de la page (75–200 %)
    await menu(page, 'zoom', '.ed-zoom-menu [data-zoom="150"]');
    await page.waitForTimeout(400);
    const z150 = await page.evaluate(() => window.__ed.engine().zoom());
    const z150label = await page.textContent('.ed-topbar [data-tb="zoom"]');
    await menu(page, 'zoom', '.ed-zoom-menu [data-zoom="fit"]');
    await page.waitForTimeout(400);
    check('zoom : 150 % puis ajusté à la fenêtre', z150 === 150 && /150/.test(z150label) && (await page.evaluate(() => window.__ed.engine().zoom())) !== 150, `${z150} ; « ${z150label} »`);

    // Enregistrer
    await page.keyboard.press('Control+s');
    await waitSaved(page, 30000);
    const saved = await readLib(page, d.id);
    const p1 = path.join(OUT, 'format-enregistre.docx');
    fs.writeFileSync(p1, saved);
    const pdf = validateDocx(p1, 'mise en forme', p0);
    const I = inspect(p1, 'bon sens', 'Deuxième paragraphe', 'Point deux', 'Descartes', 'Développement');
    const bs = I['runs:bon sens'].find((r) => r.text.includes('bon sens')) ?? {};
    const bsx = I['xml:bon sens'];
    check('docx : police non standard écrite (rFonts Latin Modern Roman) et relue par python-docx', bs.font === 'Latin Modern Roman' && /w:ascii="Latin Modern Roman"/.test(bsx), JSON.stringify(bs));
    check('docx : taille 14 pt (w:sz 28)', bs.size === 14 && /<w:sz w:val="28"/.test(bsx));
    check('docx : couleur du texte (w:color 7A1F1F)', bs.color === '7A1F1F' && /<w:color w:val="7A1F1F"/i.test(bsx));
    check('docx : surlignage (w:shd FFF2A8)', /<w:shd [^>]*w:fill="FFF2A8"/i.test(bsx), (bsx.match(/<w:shd[^>]*>|<w:highlight[^>]*>/) ?? [''])[0]);
    check('docx : petites capitales, exposant, barré', /<w:smallCaps/.test(bsx) && /<w:vertAlign w:val="superscript"/.test(bsx) && /<w:strike/.test(bsx));
    const dpf = I['pf:Deuxième paragraphe'] ?? {};
    const dx = I['xml:Deuxième paragraphe'];
    check('docx : justifié (w:jc both), interligne 1,5 (w:line 360), alinéa (w:firstLine 709), 9 pt après', /<w:jc w:val="both"/.test(dx) && /w:line="360"/.test(dx) && /w:firstLine="709"/.test(dx) && /w:after="180"/.test(dx) && dpf.align?.includes('JUSTIFY') && Math.abs(dpf.first - 1.25) < 0.01, JSON.stringify(dpf));
    check('docx : liste multiniveau (ilvl 1, numérotation %1.%2.)', /<w:ilvl w:val="1"/.test(I['xml:Point deux']) && I.numbering.includes('%1.%2.'), I.numbering.join(' '));
    check('docx : ordre ilvl puis numId dans numPr', I.hasNumPr.every((x) => x.indexOf('ilvl') < x.indexOf('numId')), I.hasNumPr[0]);
    const hDev = I.headings.find((h) => h.text === 'Développement');
    check('docx : effacer la mise en forme a gardé Heading1 et retiré gras et couleur', hDev?.style === 'Heading 1' && hDev.bold.every((b) => !b) && hDev.color.every((c) => !c), JSON.stringify(hDev));
    check('docx : lien hypertexte (relation externe)', I.hyperlinks.length >= 1 && /Target="https:\/\/fr\.wikipedia\.org\/wiki\/Ren[^"]*Descartes"[^>]*TargetMode="External"|TargetMode="External"[^>]*Target="https:\/\/fr\.wikipedia/.test(I.rels));
    const tbl = I.tables[0] ?? {};
    check('docx : tableau 3 colonnes, 3 lignes, bordures, fusion', tbl.cols === 3 && tbl.rows === 3 && /<w:tblBorders>/.test(I.tblXml) && /<w:gridSpan w:val="2"/.test(I.tblXml), JSON.stringify(I.tables));
    check('docx : image en ligne (w:drawing + word/media)', I.images >= 1 && I.media.length >= 1, `${I.images} image(s), ${I.media.join(', ')}`);
    check('docx : saut de page', I.pageBreaks >= 1);
    check('docx : guillemets et espaces insécables', I.paras.some(([, t]) => t.includes('«\u00a0cogito\u00a0»')));
    const sp = I.section;
    check('docx : marges étroites et paysage (pgSz orient, pgMar 720)', sp.orient.includes('LANDSCAPE') && Math.abs(sp.left - 1.27) < 0.02 && /w:orient="landscape"/.test(I.sectPr) && /w:left="720"/.test(I.sectPr), JSON.stringify(sp));
    check('docx : sectPr dans l’ordre du schéma (références avant pgSz, titlePg après)', /^<w:sectPr[^>]*>\s*(<w:(header|footer)Reference[^>]*\/>\s*)+<w:pgSz/.test(I.sectPr) && I.sectPr.indexOf('titlePg') > I.sectPr.indexOf('pgMar'), I.sectPr.slice(0, 220));
    check('docx : numéros de page « Page X / Y » (champs PAGE et NUMPAGES) et page de garde (titlePg)', / PAGE/.test(I.footerXml) && / NUMPAGES/.test(I.footerXml) && sp.titlePg === true && /w:type="first"/.test(I.sectPr), I.footerDefaultText);
    check('docx : table des matières (champ TOC, styles TOC1-3, numéros de page non nuls)', I.toc && I.tocStyles.length >= 1 && I.tocParas.length >= 2 && I.tocParas.every((t) => /[1-9]\d*$/.test(t.trim())), I.tocParas.join(' ¶ ').slice(0, 300));
    check('docx : style Corps modifié dans styles.xml (police, taille, interligne, justification, alinéa)', /w:ascii="DejaVu Serif"/.test(I.normalXml) && /<w:sz w:val="23"/.test(I.normalXml) && /w:line="480"/.test(I.normalXml) && /<w:jc w:val="both"/.test(I.normalXml) && /w:firstLine="709"/.test(I.normalXml) && I.normal.font === 'DejaVu Serif' && I.normal.size === 11.5 && I.normal.line === 2, JSON.stringify(I.normal));
    check('LibreOffice : polices et numéros de page dans le PDF', /LatinModernRoman|Latin Modern|LMRoman/i.test(pdf.fonts) && /DejaVuSerif/i.test(pdf.fonts) && /Page 2 \/ \d/.test(pdf.text) && !/Page 1 \/ \d/.test(pdf.text), (pdf.fonts.match(/^\S+/gm) ?? []).slice(2, 8).join(' '));

    // Réouverture : la relecture du .docx par l'éditeur
    await backToList(page);
    await openDraft(page, d.id);
    await sel(page, 'bon sens');
    const r = await state(page);
    const ps2 = await page.evaluate(() => window.__ed.engine().pageSetup());
    const sp2 = await page.evaluate(() => window.__ed.engine().styleProps('body'));
    const toc2 = await page.evaluate(() => window.__ed.engine().tocCount());
    check('réouverture : police, taille, couleur, surlignage relus', r.fontFamily === 'Latin Modern Roman' && r.fontSize === 14 && /7A1F1F/i.test(r.color ?? '') && /FFF2A8/i.test(r.highlight ?? ''), JSON.stringify({ f: r.fontFamily, s: r.fontSize, c: r.color, h: r.highlight }));
    await sel(page, 'Deuxième paragraphe', 'start');
    const r2 = await state(page);
    check('réouverture : paragraphe justifié, 1,5, alinéa', r2.align === 'justify' && r2.lineHeight === 1.5 && r2.firstLine === 709);
    check('réouverture : style Corps, mise en page, table des matières', sp2.fontFamily === 'DejaVu Serif' && ps2.orientation === 'landscape' && ps2.pageNumbers === 'n-of-total' && ps2.titlePage && toc2 === 1, JSON.stringify({ sp2: sp2.fontFamily, ps2, toc2 }));
    await sel(page, 'Cellule fusionnée');
    check('réouverture : tableau', (await state(page)).inTable);
    // Ré-export après réouverture (aller-retour SuperDoc → .docx → SuperDoc → .docx)
    const again = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await window.__ed.engine().exportDocx()))));
    const p2 = path.join(OUT, 'format-reexport.docx');
    fs.writeFileSync(p2, again);
    validateDocx(p2, 'ré-export après réouverture', p0);
    await backToList(page);
  }

  // ── 2. Modèle « Présentation universitaire » ──
  if (want('univ')) {
    await backToList(page);
    await page.click('.ed-list .topbar .btn-primary');
    await page.click('.ed-tpl-menu [data-template="universitaire"]');
    await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const id = await page.evaluate(() => window.__store.getState().route.draftId);
    const created = await readLib(page, id);
    const p0 = path.join(OUT, 'universitaire-cree.docx');
    fs.writeFileSync(p0, created);
    validateDocx(p0, 'modèle universitaire (généré)');
    const I0 = inspect(p0, 'Titre du devoir', 'Accroche');
    check('modèle universitaire : Times New Roman 12, justifié, interligne 1,5, alinéa', I0.normal.font === 'Times New Roman' && I0.normal.size === 12 && I0.normal.line === 1.5 && I0.normal.align.includes('JUSTIFY') && Math.abs(I0.normal.first - 1.25) < 0.01, JSON.stringify(I0.normal));
    check('modèle universitaire : notes en 10 pt', /<w:sz w:val="20"/.test(I0.footnoteStyle));
    check('modèle universitaire : A4, marges 2,5 cm, page de garde sans numéro, pages numérotées', Math.abs(I0.section.w - 21) < 0.05 && Math.abs(I0.section.left - 2.5) < 0.01 && I0.section.titlePg && / PAGE /.test(I0.footerXml) && I0.paras[0][0] === 'Title', JSON.stringify(I0.section));
    const ps = await page.evaluate(() => window.__ed.engine().pageSetup());
    check('modèle universitaire : relu par l’éditeur', ps.titlePage && ps.pageNumbers === 'n' && ps.margins.left === 2.5, JSON.stringify(ps));
    // une modification, puis enregistrement (export SuperDoc)
    await sel(page, 'Titre du devoir');
    await page.keyboard.type('La conscience est-elle connaissance de soi ?');
    await page.keyboard.press('Control+s');
    await waitSaved(page, 30000);
    const p1 = path.join(OUT, 'universitaire-enregistre.docx');
    fs.writeFileSync(p1, await readLib(page, id));
    const pdf = validateDocx(p1, 'modèle universitaire (enregistré)', p0);
    const I1 = inspect(p1, 'Accroche');
    check('modèle universitaire enregistré : styles et pied conservés', I1.normal.font === 'Times New Roman' && I1.section.titlePg && / PAGE/.test(I1.footerXml), JSON.stringify(I1.normal));
    const pages = pdf.text.split('\f');
    check('LibreOffice : page de garde sans numéro, page 2 numérotée', pages.length >= 2 && !/^\s*1\s*$/m.test(pages[0]) && /^\s*2\s*$/m.test(pages[1]), `${pages.length} pages`);
    if (want('shots')) {
      for (const dark of [false, true]) {
        await page.evaluate((dark) => window.__store.getState().updateSettings({ theme: dark ? 'dark' : 'light' }), dark);
        await page.waitForTimeout(500);
        await shot(page, `${SHOTS}/modele-universitaire-${dark ? 'sombre' : 'clair'}.png`);
      }
      await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));
    }
    await backToList(page);
  }

  // ── 3. Document externe (fixture pandoc) : présentation universitaire en un geste ──
  if (want('fixture')) {
    const b64 = fs.readFileSync(path.join(ROOT, 'fixtures/discours.docx')).toString('base64');
    const d = await page.evaluate(async (b64) => {
      const m = await import('/src/features/editor/api.ts');
      return m.createDraft({ title: 'Discours (présentation)', docx: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer });
    }, b64);
    const p0 = path.join(OUT, 'fixture-stockee.docx');
    fs.writeFileSync(p0, await readLib(page, d.id));
    await openDraft(page, d.id);
    const words0 = await page.evaluate(() => window.__ed.engine().wordCount());
    await page.click('.ed-topbar [data-tb="page"]');
    await page.click('.ed-page-setup [data-action="academic"]');
    await idle(page);
    await page.waitForTimeout(1500);
    const sp = await page.evaluate(() => window.__ed.engine().styleProps('body'));
    const ps = await page.evaluate(() => window.__ed.engine().pageSetup());
    check('fixture : présentation universitaire appliquée', sp.fontFamily === 'Times New Roman' && sp.lineSpacing === 1.5 && ps.pageNumbers !== 'none' && ps.titlePage, JSON.stringify({ sp, ps }));
    // ⌘Z puis réapplication
    await sel(page, 'bon sens', 'start');
    await page.keyboard.press('Control+z');
    await idle(page);
    await page.waitForTimeout(1200);
    const spUndo = await page.evaluate(() => window.__ed.engine().styleProps('body'));
    check('fixture : ⌘Z rétablit la présentation d’origine', spUndo.fontFamily !== 'Times New Roman' || spUndo.lineSpacing !== 1.5, JSON.stringify(spUndo));
    await page.click('.ed-topbar [data-tb="page"]');
    await page.click('.ed-page-setup [data-action="academic"]');
    await idle(page);
    await page.waitForTimeout(1200);
    // Titre 1 → modifier le style Titre 1 (style existant dans la fixture)
    await sel(page, 'Seconde partie', 'start');
    await page.keyboard.press('Control+Alt+Digit2');
    await page.waitForTimeout(300);
    check('raccourci ⌘⌥2 : Titre 2', (await state(page)).style === 'h2');
    await page.keyboard.press('Control+Alt+Digit1');
    await page.waitForTimeout(300);
    const words1 = await page.evaluate(() => window.__ed.engine().wordCount());
    check('fixture : aucun mot perdu par les réouvertures', words1 === words0, `${words0} → ${words1}`);
    await page.keyboard.press('Control+s');
    await waitSaved(page, 30000);
    const p1 = path.join(OUT, 'fixture-universitaire.docx');
    fs.writeFileSync(p1, await readLib(page, d.id));
    validateDocx(p1, 'fixture + présentation universitaire', p0);
    const I = inspect(p1, 'bon sens');
    check('fixture : Normal en Times New Roman 12, 1,5, justifié, alinéa (python-docx)', I.normal.font === 'Times New Roman' && I.normal.size === 12 && I.normal.line === 1.5 && I.normal.align.includes('JUSTIFY') && Math.abs((I.normal.first ?? 0) - 1.25) < 0.01, JSON.stringify(I.normal));
    const fpdf = spawnSync('pdffonts', [path.join(OUT, 'fixture-universitaire.pdf')], { encoding: 'utf8' }).stdout ?? '';
    check('fixture : tout le texte en Times New Roman (équivalent LibreOffice : Liberation Serif)', /LiberationSerif/.test(fpdf) && !/Carlito|Caladea/.test(fpdf), (fpdf.match(/^\S+/gm) ?? []).slice(2).join(' '));
    check('fixture : marges 2,5 cm, pied numéroté, page de garde', Math.abs(I.section.left - 2.5) < 0.02 && / PAGE/.test(I.footerXml) && I.section.titlePg, JSON.stringify(I.section));
    await backToList(page);
  }

  // ── 4. Captures (clair et sombre) ──
  if (want('shots')) {
    const html = '<h1>Introduction</h1><p>Le bon sens est la chose du monde la mieux partagée : car chacun pense en être si bien pourvu, que ceux même qui sont les plus difficiles à contenter en toute autre chose n’ont point coutume d’en désirer plus qu’ils en ont.</p><p>En quoi il n’est pas vraisemblable que tous se trompent.</p><h2>Le tableau des facultés</h2><p>Avant le tableau.</p>';
    const d = await page.evaluate(async (html) => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Discours de la méthode', html }), html);
    await openDraft(page, d.id);
    await sel(page, 'Avant le tableau.', 'end');
    await page.evaluate(() => window.__ed.engine().insertTable(3, 3));
    for (const dark of [false, true]) {
      const suf = dark ? '-sombre' : '-clair';
      await page.evaluate((dark) => window.__store.getState().updateSettings({ theme: dark ? 'dark' : 'light' }), dark);
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await page.waitForTimeout(500);
      await sel(page, 'bon sens est la chose');
      await page.mouse.move(5, 5);
      await page.waitForTimeout(400);
      await shot(page, `${SHOTS}/barre${suf}.png`);
      const open = async (tb, name, after) => {
        await sel(page, 'bon sens est la chose');
        await page.click(tb === 'page' ? '.ed-topbar [data-tb="page"]' : `.ed-toolbar [data-tb="${tb}"]`);
        await page.waitForTimeout(450);
        if (after) await after();
        await shot(page, `${SHOTS}/${name}${suf}.png`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      };
      await open('font', 'menu-police');
      await page.click('.ed-toolbar .ed-size-more');
      await page.waitForTimeout(300);
      await shot(page, `${SHOTS}/menu-taille${suf}.png`);
      await page.keyboard.press('Escape');
      await open('color', 'menu-couleur');
      await open('highlight', 'menu-surlignage');
      await open('spacing', 'menu-interligne');
      await open('style', 'menu-style');
      await open('chars', 'menu-caracteres');
      await open('insert', 'menu-inserer', () => page.hover('.ed-insert-menu [data-grid="3x4"]'));
      await open('page', 'mise-en-page');
      await sel(page, 'bon sens', 'start');
      await menu(page, 'style', '.ed-style-menu [data-action="modify-style"]');
      await page.waitForTimeout(400);
      await shot(page, `${SHOTS}/modifier-style${suf}.png`);
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        const ed = window.__ed.engine().debugEditor().editor;
        let cell = null;
        ed.state.doc.descendants((n, p) => {
          if (!cell && n.type.name === 'tableCell') cell = p + 2;
          return true;
        });
        ed.commands.setTextSelection({ from: cell, to: cell });
        ed.view.focus();
      });
      await page.waitForTimeout(300);
      await page.click('.ed-toolbar [data-tb="table"]');
      await page.waitForTimeout(400);
      await shot(page, `${SHOTS}/tableau${suf}.png`);
      await page.keyboard.press('Escape');
      await sel(page, 'bon sens');
      await page.keyboard.press('Control+Shift+K');
      await page.waitForTimeout(400);
      await shot(page, `${SHOTS}/lien${suf}.png`);
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'sepia' }));
    await page.emulateMedia({ colorScheme: 'light' });
    await sel(page, 'bon sens est la chose');
    await page.waitForTimeout(400);
    await shot(page, `${SHOTS}/barre-sepia.png`);
    await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'system' }));
  }

  check('aucun appel réseau externe (G4)', external.length === 0, external.slice(0, 5).join(' '));
});

fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
if (failed.length) {
  console.log('ÉCHECS :\n' + failed.map((f) => `- ${f.name} ${f.detail}`).join('\n'));
  process.exitCode = 1;
}
