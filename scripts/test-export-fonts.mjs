// Exports d'un écrit fidèles à sa typographie (polices, tailles, styles, mise en forme des runs) —
// port 5401 (navigateur), 5402 (Electron).
// Lancer : timeout 400 node scripts/test-export-fonts.mjs
//          (partie Electron : avec un écran, ex. DISPLAY=:99 ou xvfb-run -a ; sinon sautée)
// Vérifie : .docx (styles.xml docDefaults / Normal / Heading1, rPr du run, fontTable, ordre du rPr),
// modèle parseDocx (polices, tailles, thème, styles basedOn, jc, retraits, interligne, format de page,
// couleur, surlignage, barré, petites capitales, exposant), HTML d'impression et page web (familles,
// tailles, @font-face des polices fournies), puis le PDF réel d'Electron : polices incorporées
// (pdffonts), format de page (pdfinfo) et rendu PNG (pdftoppm) dans shots/export-fonts/.
import { createServer } from 'vite';
import { chromium, _electron as electron } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/export-fonts');
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${detail !== '' ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) : ''}`);
};
const noProxyNoise = (m) => !/favicon|ERR_TUNNEL|ERR_CONNECTION|net::/.test(m);

// ── Fixture .docx « à la main » : thème, chaîne basedOn, style de caractères, runs mis en forme, Lettre US ──
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
async function fixtureDocx() {
  const z = new JSZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`);
  z.file('word/theme/theme1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T"><a:themeElements><a:fontScheme name="F"><a:majorFont><a:latin typeface="Cambria"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
  z.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Corps"><w:name w:val="Corps perso"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="both"/><w:ind w:firstLine="567"/><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Accent"><w:name w:val="Accent perso"/><w:rPr><w:rFonts w:ascii="Literata" w:hAnsi="Literata"/><w:i/></w:rPr></w:style>
</w:styles>`);
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Titre au thème</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Sous-titre hérité</w:t></w:r></w:p>
<w:p><w:r><w:t>Texte au thème mineur.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Corps"/></w:pPr><w:r><w:t xml:space="preserve">Corps Garamond avec </w:t></w:r><w:r><w:rPr><w:rStyle w:val="Accent"/></w:rPr><w:t>accent</w:t></w:r><w:r><w:t xml:space="preserve">, </w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:strike/><w:smallCaps/><w:color w:val="FF0000"/><w:sz w:val="18"/><w:highlight w:val="yellow"/></w:rPr><w:t>code barré</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>e</w:t></w:r><w:r><w:t xml:space="preserve"> fin.</w:t></w:r></w:p>
<w:p><w:pPr><w:jc w:val="center"/><w:ind w:left="720" w:hanging="360"/><w:spacing w:before="120" w:line="300" w:lineRule="exact"/></w:pPr><w:r><w:t>Paragraphe centré direct.</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`);
  return z.generateAsync({ type: 'nodebuffer' });
}

/** Écrit de test, ouvert dans l'éditeur : Normal Arial 11, Titre 1 Georgia 20, « spécial » en Literata 14 rouge. */
async function prepareDraft(page) {
  const draft = await page.evaluate(async () =>
    (await import('/src/features/editor/api.ts')).createDraft({
      title: 'Polices',
      html: '<h1>Un titre de partie</h1><p>Premier paragraphe avec un mot spécial ici, et une suite assez longue pour courir sur deux lignes de la page imprimée.</p><blockquote><p>Une citation en retrait.</p></blockquote><p>Second paragraphe.<span data-footnote="Une note de bas de page."></span></p>',
    }),
  );
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), draft.id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__ed.engine().modifyStyle('body', { fontFamily: 'Arial', fontSize: 11 }));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__ed.engine().modifyStyle('h1', { fontFamily: 'Georgia', fontSize: 20 }));
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const ed = window.__ed.engine().debugEditor().editor;
    let pos = -1;
    ed.state.doc.descendants((n, p) => {
      if (pos < 0 && n.isText && n.text.includes('spécial')) pos = p + n.text.indexOf('spécial');
    });
    ed.commands.setTextSelection({ from: pos, to: pos + 'spécial'.length });
    const e = window.__ed.engine();
    e.setFontFamily('Literata');
    e.setFontSize(14);
    e.setColor('#c00000');
  });
  await page.waitForTimeout(500);
}

/** Exporte comme le menu Exporter (garde-fou, notes privées retirées), renvoie docx, modèle et HTML. */
async function exportAll(page) {
  return page.evaluate(async () => {
    const { guardedExport } = await import('/src/features/editor/save.ts');
    const { stripForExport } = await import('/src/features/editor/privateNotes.ts');
    const { toPrintHtml, toHtml, usedFonts } = await import('/src/features/editor/exporters.ts');
    const { bundledFontFaceCss } = await import('/src/features/editor/exportFonts.ts');
    const g = await guardedExport(window.__ed.engine());
    const docx = new Uint8Array((await stripForExport(g.data)).data);
    let bin = '';
    for (let i = 0; i < docx.length; i += 0x8000) bin += String.fromCharCode(...docx.subarray(i, i + 0x8000));
    const fontCss = await bundledFontFaceCss(usedFonts(g.model));
    return {
      ok: g.ok,
      docx: btoa(bin),
      model: JSON.parse(JSON.stringify({ typo: g.model.typo, blocks: g.model.blocks })),
      used: usedFonts(g.model),
      print: toPrintHtml(g.model, 'Polices', { fontCss }),
      html: toHtml(g.model, 'Polices', { fontCss }),
    };
  });
}

const styleEl = (xml, id) => new RegExp(`<w:style\\b[^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`).exec(xml)?.[0] ?? '';
const rFont = (s) => /<w:rFonts\b[^>]*w:ascii="([^"]+)"/.exec(s)?.[1];
const sz = (s) => /<w:sz\b[^>]*w:val="(\d+)"/.exec(s)?.[1];
/** Règle CSS (dernière occurrence) d'un sélecteur dans un HTML. */
const rule = (html, sel) => {
  const all = [...html.matchAll(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'g'))];
  return all.length ? all[all.length - 1][1] : '';
};
const strip64 = (h) => h.replace(/base64,[A-Za-z0-9+/=]+/g, 'base64,…');

async function browserPart() {
  const PORT = 5401;
  const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-' + PORT, server: { port: PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const errors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && noProxyNoise(m.text()) && errors.push('console: ' + m.text()));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });

    // ── 1. Écrit modifié dans l'éditeur ──
    await prepareDraft(page);
    const r = await exportAll(page);
    check('export accepté par le garde-fou', r.ok);
    const z = await JSZip.loadAsync(Buffer.from(r.docx, 'base64'));
    const styles = await z.file('word/styles.xml').async('string');
    const doc = await z.file('word/document.xml').async('string');
    const ft = (await z.file('word/fontTable.xml')?.async('string')) ?? '';
    const normal = styleEl(styles, 'Normal');
    check('.docx : style Normal en Arial 11', rFont(normal) === 'Arial' && sz(normal) === '22', normal.slice(0, 300));
    const h1 = styleEl(styles, 'Heading1');
    check('.docx : Titre 1 en Georgia 20', rFont(h1) === 'Georgia' && sz(h1) === '40', h1.slice(0, 400));
    const h1rpr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(h1)?.[1] ?? '';
    check('.docx : rPr du style dans l’ordre du schéma (rFonts avant b et sz)', h1rpr.indexOf('<w:rFonts') < h1rpr.indexOf('<w:b') && h1rpr.indexOf('<w:rFonts') < h1rpr.indexOf('<w:sz'), h1rpr);
    const dd = /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(styles)?.[0] ?? '';
    check('.docx : docDefaults gardent la police du nouvel écrit (Literata 12)', rFont(dd) === 'Literata' && sz(dd) === '24', dd.slice(0, 200));
    const runM = /<w:r>(?:(?!<w:r>)[\s\S])*?spécial/.exec(doc)?.[0] ?? '';
    check('.docx : le run « spécial » garde Literata 14 et sa couleur', rFont(runM) === 'Literata' && sz(runM) === '28' && /<w:color w:val="C00000"/i.test(runM), runM);
    check('.docx : table des polices complétée (Arial, Georgia, Literata)', ['Arial', 'Georgia', 'Literata'].every((f) => ft.includes(`w:name="${f}"`)) && /w:name="Arial"[\s\S]*?w:family w:val="swiss"/.test(ft), ft.slice(0, 200));

    // modèle
    const t = r.model.typo;
    check('modèle : base Arial 11, interligne 1,5', t?.base.font === 'Arial' && t.base.size === 11 && t.base.line === 1.5, t?.base);
    check('modèle : genre h1 = Georgia 20 gras', t?.kinds.h1?.font === 'Georgia' && t.kinds.h1.size === 20 && t.kinds.h1.b === true, t?.kinds.h1);
    check('modèle : notes en 10 pt', t?.kinds.note?.size === 10, t?.kinds.note);
    check('modèle : page A4, marges 2,5 cm', t?.page && Math.round(t.page.width) === 595 && Math.round(t.page.height) === 842 && Math.round(t.page.left) === 71, t?.page);
    const run = r.model.blocks.flatMap((b) => b.inlines).find((i) => i.t === 'text' && i.text === 'spécial');
    check('modèle : run « spécial » = Literata 14 #c00000', run?.font === 'Literata' && run.size === 14 && run.color === '#c00000', run);
    check('modèle : polices employées', JSON.stringify(r.used.sort()) === JSON.stringify(['Arial', 'Georgia', 'Literata']), r.used);

    // HTML d'impression (PDF)
    const pr = r.print;
    fs.writeFileSync(path.join(OUT, 'impression.html'), pr);
    check('PDF (HTML) : corps en Arial 11 pt', /font-family: 'Arial', 'Helvetica Neue', sans-serif; font-size: 11pt/.test(rule(pr, 'body')), rule(pr, 'body'));
    check('PDF (HTML) : paragraphes en Arial 11 pt, justifiés', /'Arial'/.test(rule(pr, 'p')) && /font-size: 11pt/.test(rule(pr, 'p')) && /text-align: justify/.test(rule(pr, 'p')), rule(pr, 'p'));
    check('PDF (HTML) : titres de partie en Georgia 20 pt gras', /'Georgia'/.test(rule(pr, 'h1:not(.title)')) && /font-size: 20pt/.test(rule(pr, 'h1:not(.title)')) && /font-weight: bold/.test(rule(pr, 'h1:not(.title)')), rule(pr, 'h1:not(.title)'));
    check('PDF (HTML) : run en Literata 14 pt, rouge', /<span style="font-family: 'Literata', 'Georgia', 'Times New Roman', 'Times', serif; font-size: 14pt; color: #c00000">spécial<\/span>/.test(pr), /<span[^>]*>spécial/.exec(pr)?.[0]);
    check('PDF (HTML) : citation en retrait (style Quote)', /margin-left: 42.55pt/.test(rule(pr, 'blockquote p')), rule(pr, 'blockquote p'));
    check('PDF (HTML) : notes en 10 pt', /font-size: 10pt/.test(rule(pr, '.footnotes li')));
    check('PDF (HTML) : format et marges du document', /@page \{ size: A4; margin: 70.85pt 70.85pt 70.85pt 70.85pt; \}/.test(pr));
    check('PDF (HTML) : Literata fournie en @font-face (data:, woff2), sans Arial ni Georgia', (pr.match(/@font-face \{ font-family: 'Literata'/g) ?? []).length === 4 && /url\(data:font\/woff2;base64,d09GM/.test(pr) && !/font-family: 'Arial'; font-style/.test(pr));
    check('PDF (HTML) : plus de Times New Roman imposé au corps', !/font-family: 'Times New Roman'/.test(rule(pr, 'body')));

    // Page web
    const html = r.html;
    fs.writeFileSync(path.join(OUT, 'page.html'), html);
    check('HTML : colonne en Arial, taille proportionnelle (11/12 de 1,125 rem)', /font-family: 'Arial'/.test(rule(html, 'main')) && /--b: 1.031rem/.test(rule(html, 'main')), rule(html, 'main'));
    check('HTML : titres en Georgia, ×20/11 de la base', /'Georgia'/.test(rule(html, 'h1:not(.title)')) && /calc\(var\(--b\) \* 1.818\)/.test(rule(html, 'h1:not(.title)')), rule(html, 'h1:not(.title)'));
    check('HTML : run en Literata, 14/11 em', /<span style="font-family: 'Literata'[^"]*; font-size: 1.273em; color: #c00000">spécial/.test(html), /<span[^>]*>spécial/.exec(html)?.[0]);
    check('HTML : Literata embarquée (page autonome)', (html.match(/@font-face \{ font-family: 'Literata'/g) ?? []).length === 4);
    check('HTML : taille raisonnable (< 400 Ko)', html.length < 400_000, `${Math.round(html.length / 1024)} Ko`);
    // rendu : la page web utilise vraiment Literata pour le run
    const pg = await (await browser.newContext()).newPage();
    await pg.setContent(html);
    await pg.evaluate(() => document.fonts.ready);
    const rendered = await pg.evaluate(() => {
      const span = [...document.querySelectorAll('span')].find((s) => s.textContent === 'spécial');
      return { family: getComputedStyle(span).fontFamily, loaded: document.fonts.check(`14px Literata`), p: getComputedStyle(document.querySelector('main p')).fontFamily };
    });
    check('HTML rendu : run en Literata chargée, paragraphe en Arial', rendered.loaded && /^'?Literata/.test(rendered.family.replace(/"/g, "'")) && /Arial/.test(rendered.p), rendered);
    await pg.screenshot({ path: path.join(OUT, 'page-web.png') });
    await pg.close();

    // ── 2. Fixture : thème, basedOn, style de caractères, runs mis en forme, Lettre US ──
    const fx = (await fixtureDocx()).toString('base64');
    const m = await page.evaluate(async (b64) => {
      const { parseDocx } = await import('/src/features/editor/docx.ts');
      const { toPrintHtml, toMarkdown, toText } = await import('/src/features/editor/exporters.ts');
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const model = await parseDocx(bin.buffer);
      return { model: JSON.parse(JSON.stringify({ typo: model.typo, blocks: model.blocks })), print: toPrintHtml(model, 'F'), md: toMarkdown(model), txt: toText(model), words: model.bodyWords };
    }, fx);
    const ft2 = m.model.typo;
    const [b0, b1, b2, b3, b4] = m.model.blocks;
    check('fixture : docDefaults au thème mineur (Calibri 11)', ft2.base.font === 'Calibri' && ft2.base.size === 11, ft2.base);
    check('fixture : Titre 1 au thème majeur (Cambria 16, couleur)', b0.kind === 'h1' && b0.fmt.font === 'Cambria' && b0.fmt.size === 16 && b0.fmt.color === '#2f5496', b0.fmt);
    check('fixture : Titre 2 hérite de Titre 1 (basedOn) avec sa taille', b1.kind === 'h2' && b1.fmt.font === 'Cambria' && b1.fmt.size === 13 && b1.fmt.before === 12, b1.fmt);
    check('fixture : paragraphe sans style = Normal (Calibri, interligne 259/240)', b2.fmt.font === 'Calibri' && Math.abs(b2.fmt.line - 259 / 240) < 1e-9 && b2.fmt.after === 8, b2.fmt);
    check('fixture : style perso (Garamond 12, justifié, alinéa 1 cm, 1,5)', b3.fmt.font === 'Garamond' && b3.fmt.size === 12 && b3.fmt.align === 'justify' && Math.abs(b3.fmt.firstLine - 28.35) < 0.01 && b3.fmt.line === 1.5, b3.fmt);
    const acc = b3.inlines.find((i) => i.text === 'accent');
    check('fixture : style de caractères (Literata italique)', acc?.font === 'Literata' && acc.i === true, acc);
    const code = b3.inlines.find((i) => i.text === 'code barré');
    check('fixture : run Courier New 9, rouge, surligné, barré, petites capitales', code?.font === 'Courier New' && code.size === 9 && code.color === '#ff0000' && code.hl === '#ffff00' && code.s === true && code.sc === true, code);
    check('fixture : exposant', b3.inlines.find((i) => i.text === 'e')?.va === 'super');
    check('fixture : mise en forme directe (centré, retrait suspendu, interligne exact 15 pt)', b4.fmt.align === 'center' && b4.fmt.indLeft === 36 && b4.fmt.firstLine === -18 && b4.fmt.line === 15 && b4.fmt.lineRule === 'exact' && b4.fmt.before === 6, b4.fmt);
    check('fixture : format Lettre US et marges', ft2.page.width === 612 && ft2.page.height === 792 && ft2.page.left === 54 && ft2.page.top === 72, ft2.page);
    const p2 = m.print;
    fs.writeFileSync(path.join(OUT, 'fixture-impression.html'), p2);
    check('fixture PDF : @page Lettre US', /@page \{ size: letter; margin: 72pt 54pt 72pt 54pt; \}/.test(p2));
    check('fixture PDF : Calibri avec repli sans empattement', /font-family: 'Calibri', 'Helvetica Neue', 'Arial', sans-serif/.test(rule(p2, 'body')), rule(p2, 'body'));
    check('fixture PDF : bloc Garamond (style perso) en ligne', /<p style="font-family: 'Garamond', 'Times New Roman', 'Times', 'Georgia', serif; font-size: 12pt; text-align: justify; text-indent: 28.35pt; line-height: 1.725">/.test(p2), /<p style="[^"]*Garamond[^"]*">/.exec(p2)?.[0]);
    check('fixture PDF : run Courier (monospace, 9 pt, couleur, surlignage, barré, petites capitales)', /<span style="font-family: 'Courier New', 'Menlo', 'Consolas', monospace; font-size: 9pt; text-decoration: line-through; color: #ff0000; background-color: #ffff00; font-variant: small-caps">code barré<\/span>/.test(p2), /<span[^>]*>code barré/.exec(p2)?.[0]);
    check('fixture PDF : run du style de caractères (Literata, italique)', /<em><span style="font-family: 'Literata'[^"]*">accent<\/span><\/em>/.test(p2), /<em>.{0,120}accent/.exec(p2)?.[0]);
    check('fixture PDF : exposant', /<span style="vertical-align: super; font-size: 0.65em">e<\/span>/.test(p2));
    check('fixture PDF : bloc centré, retrait suspendu, interligne exact', /<p style="text-align: center; text-indent: -18pt; margin-left: 36pt; margin-top: 6pt; line-height: 15pt">/.test(p2), /<p style="[^"]*center[^"]*">/.exec(p2)?.[0]);
    check('fixture : Markdown et texte inchangés par la typographie', m.md.includes('# Titre au thème') && m.md.includes('Corps Garamond avec *accent*, code barréefin.'.replace('barréefin', 'barrée fin')) && m.txt.includes('Paragraphe centré direct.'), m.md);
    check('fixture : comptage de mots inchangé', m.words === 19, m.words);
    return { docxPath: null };
  } finally {
    if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + errors.join('\n'));
    check('aucune erreur de page', errors.length === 0, errors.join(' | '));
    await browser.close();
    await server.close();
  }
}

async function electronPart() {
  if (!process.env.DISPLAY) {
    console.log('— partie Electron sautée (pas d’écran : lancer avec DISPLAY=:99 ou xvfb-run -a)');
    return;
  }
  const PORT = 5402;
  const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
  await server.listen();
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-expfonts-'));
  const app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, XDG_CONFIG_HOME: TMP, VITE_DEV_SERVER_URL: `http://localhost:${PORT}/` },
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    await prepareDraft(page);
    const r = await exportAll(page);
    const pdf = await page.evaluate(async (html) => {
      const buf = new Uint8Array(await window.marginalia.printToPdf(html));
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(bin);
    }, r.print);
    const pdfPath = path.join(OUT, 'export.pdf');
    fs.writeFileSync(pdfPath, Buffer.from(pdf, 'base64'));
    const fonts = spawnSync('pdffonts', [pdfPath], { encoding: 'utf8' }).stdout;
    console.log(fonts.trim().split('\n').map((l) => '     ' + l).join('\n'));
    check('PDF Electron : Literata incorporée (police fournie, run « spécial »)', /Literata.*\byes\b/i.test(fonts), fonts);
    check('PDF Electron : corps sans empattement (Arial ou son équivalent installé)', /(Arial|Liberation ?Sans|Helvetica|DejaVuSans|Arimo)/i.test(fonts));
    // Georgia (titre) n'est pas installée ici : remplacée par une serif grasse ; le corps n'est plus en Times.
    check('PDF Electron : plus de Times New Roman (ni son équivalent) au corps du texte', !/(TimesNewRoman|LiberationSerif|Tinos)(?!-Bold)\b/i.test(fonts), fonts);
    const info = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8' }).stdout;
    check('PDF Electron : page A4', /Page size:.*pts \(A4\)/.test(info), /Page size:.*/.exec(info)?.[0]);
    spawnSync('pdftoppm', ['-png', '-r', '80', '-f', '1', '-l', '1', pdfPath, path.join(OUT, 'export-p')]);
    console.log('capture :', path.relative(ROOT, path.join(OUT, 'export-p-1.png')));

    // Fixture Lettre US : le format du document l'emporte sur l'A4 par défaut
    const fx = (await fixtureDocx()).toString('base64');
    const pdf2 = await page.evaluate(async (b64) => {
      const { parseDocx } = await import('/src/features/editor/docx.ts');
      const { toPrintHtml, usedFonts } = await import('/src/features/editor/exporters.ts');
      const { bundledFontFaceCss } = await import('/src/features/editor/exportFonts.ts');
      const model = await parseDocx(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
      const buf = new Uint8Array(await window.marginalia.printToPdf(toPrintHtml(model, 'F', { fontCss: await bundledFontFaceCss(usedFonts(model)) })));
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(bin);
    }, fx);
    const p2 = path.join(OUT, 'fixture.pdf');
    fs.writeFileSync(p2, Buffer.from(pdf2, 'base64'));
    const info2 = spawnSync('pdfinfo', [p2], { encoding: 'utf8' }).stdout;
    check('PDF Electron : format Lettre US du document respecté', /Page size:\s+612 x 792/.test(info2), /Page size:.*/.exec(info2)?.[0]);
    check('PDF Electron : Literata incorporée dans la fixture (style de caractères)', /Literata.*\byes\b/i.test(spawnSync('pdffonts', [p2], { encoding: 'utf8' }).stdout));
    spawnSync('pdftoppm', ['-png', '-r', '80', '-f', '1', '-l', '1', p2, path.join(OUT, 'fixture-p')]);
  } finally {
    await app.close();
    await server.close();
  }
}

await browserPart();
await electronPart();
console.log(failed ? `\n${failed} échec(s)` : '\nTout est OK');
process.exit(failed ? 1 : 0);
