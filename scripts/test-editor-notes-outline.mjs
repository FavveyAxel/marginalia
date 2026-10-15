// Tests : notes privées (jamais exportées) et plan déplaçable — port 5314.
// Lancer : timeout 400 node scripts/test-editor-notes-outline.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/editor-notes/out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5314;
const SECRET = 'SECRETNOTE';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`);
}
const py = (code, ...a) => execFileSync('python3', ['-I', '-c', code, ...a], { encoding: 'utf8' });
const DOCX_PY = `
import sys, zipfile, re, json
z = zipfile.ZipFile(sys.argv[1])
doc = z.read('word/document.xml').decode('utf8')
fn = z.read('word/footnotes.xml').decode('utf8') if 'word/footnotes.xml' in z.namelist() else ''
txt = lambda x: re.sub(r'<[^>]+>', '', x)
paras = [txt(m) for m in re.findall(r'<w:p[ >].*?</w:p>', doc, re.S)]
refs = re.findall(r'<w:footnoteReference [^>]*w:id="([^"]+)"', doc)
notes = {}
for m in re.finditer(r'<w:footnote [^>]*w:id="([^"]+)"[^>]*>(.*?)</w:footnote>', fn, re.S):
    notes[m.group(1)] = txt(m.group(2)).strip()
import docx
d = docx.Document(sys.argv[1])
print(json.dumps(dict(all=doc + fn, paras=[p for p in paras if p.strip()], refNotes=[notes.get(r, '?') for r in refs], pstyle='w:val="MarginaliaNotePrivee"' in doc, bm='_mglHl_' in doc, pydocx=len(d.paragraphs)), ensure_ascii=False))
`;
const inspectDocx = (file) => JSON.parse(py(DOCX_PY, file));

async function withApp(fn) {
  const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 90000 });
    await fn(page);
  } finally {
    const rel = [...new Set(errors)].filter((e) => !/404 \(Not Found\)/.test(e));
    if (rel.length) console.log('ERREURS NAVIGATEUR:\n' + rel.join('\n'));
    await browser.close();
    await server.close();
  }
}

async function openDraft(page, id) {
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
}
async function readLib(page, id) {
  const b64 = await page.evaluate(async (id) => {
    const { host } = await import('/src/lib/platform.ts');
    const buf = new Uint8Array(await host.readFile(id, 'document.docx'));
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, id);
  return Buffer.from(b64, 'base64');
}
/** Curseur à la fin (ou au début) du texte `needle`. */
async function caret(page, needle, where = 'end') {
  const ok = await page.evaluate(
    ({ needle, where }) => {
      const ed = window.__ed.engine().debugEditor().editor;
      let r = null;
      ed.state.doc.descendants((n, pos) => {
        if (r !== null) return false;
        if (n.isText && n.text.includes(needle)) r = pos + n.text.indexOf(needle) + (where === 'end' ? needle.length : 0);
        return true;
      });
      if (r === null) return false;
      ed.commands.setTextSelection({ from: r, to: r });
      ed.view.focus();
      return true;
    },
    { needle, where },
  );
  if (!ok) throw new Error('introuvable : ' + needle);
  await page.waitForTimeout(150);
}
async function exportVia(page, fmt, file) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    (async () => {
      await page.click('.ed-topbar [data-tb="export"]:has-text("Exporter")');
      await page.click(`.ed-export-menu [data-fmt="${fmt}"]`);
    })(),
  ]);
  const p = path.join(OUT, file);
  await dl.saveAs(p);
  return p;
}
const outlineTexts = (page) => page.evaluate(() => window.__ed.engine().outline().map((o) => o.text));
const statusOf = (page) => page.evaluate(() => document.querySelector('.ed-status')?.dataset.status);

await withApp(async (page) => {
  const external = [];
  page.on('request', (r) => {
    if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) external.push(r.url());
  });
  const html = [
    '<h1>Alpha</h1>',
    '<p>Texte alpha<span data-footnote="Note A"></span> premier.</p>',
    '<h1>Beta</h1>',
    '<p>Texte beta<span data-footnote="Note B"></span> second.</p>',
    '<h2>Beta sous-partie</h2>',
    '<p>Détail beta.</p>',
    '<h1>Gamma</h1>',
    '<p>Texte gamma<span data-footnote="Note C"></span> troisième.</p>',
  ].join('');
  const d = await page.evaluate(async (html) => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Notes et plan', html, externalPath: '/Users/test/Notes et plan.docx' }), html);
  await page.evaluate(() => localStorage.removeItem('marginalia.ed.hidePrivateNotes'));
  await openDraft(page, d.id);

  // ── 1. Insertion : bouton et raccourci ──
  await caret(page, 'premier.');
  await page.click('.ed-toolbar [data-tb="private-note"]');
  await page.waitForTimeout(300);
  await page.keyboard.type(`${SECRET} un, à ne jamais exporter`);
  await page.waitForTimeout(300);
  let st = await page.evaluate(() => ({ s: window.__ed.engine().state().styleId, n: window.__ed.engine().privateNoteCount() }));
  check('bouton « Privée » : note insérée après le paragraphe, curseur dedans', st.s === 'MarginaliaNotePrivee' && st.n === 1, JSON.stringify(st));
  check('bouton actif dans une note', await page.$eval('.ed-toolbar [data-tb="private-note"]', (b) => b.getAttribute('aria-pressed') === 'true'));
  await caret(page, 'second.');
  await page.keyboard.press('Control+Alt+KeyN');
  await page.waitForTimeout(300);
  await page.keyboard.type(`${SECRET} deux avec appel`);
  // note de bas de page appelée DANS la note privée : elle ne doit pas sortir non plus
  await caret(page, 'avec appel');
  const fnOk = await page.evaluate(() => window.__ed.engine().insertFootnote());
  await page.waitForTimeout(300);
  await page.keyboard.type('NOTEDANSPRIVEE');
  await page.waitForTimeout(400);
  st = await page.evaluate(() => ({ n: window.__ed.engine().privateNoteCount(), notes: document.querySelectorAll('.ProseMirror sup.sd-footnote-ref').length }));
  check('⌘⌥N : seconde note privée (et non une note de bas de page en plus)', st.n === 2 && fnOk, JSON.stringify(st));
  await page.waitForTimeout(600);
  const tint = await page.evaluate(() => {
    const f = document.querySelector('.ed-engine .superdoc-fragment[data-style-id="MarginaliaNotePrivee"] > .superdoc-paragraph-shading');
    return f ? getComputedStyle(f).backgroundColor : null;
  });
  check('note visible dans l’éditeur, fond teinté', tint && tint !== 'rgba(0, 0, 0, 0)', tint);
  const tintDark = await page.evaluate(async () => {
    const r = document.documentElement;
    const old = r.dataset.theme;
    const out = {};
    for (const t of ['light', 'sepia', 'dark']) {
      r.dataset.theme = t;
      await new Promise((x) => requestAnimationFrame(x));
      const f = document.querySelector('.ed-engine .superdoc-fragment[data-style-id="MarginaliaNotePrivee"] > .superdoc-paragraph-shading');
      out[t] = getComputedStyle(f).backgroundColor;
    }
    r.dataset.theme = old;
    return out;
  });
  check('teinte adaptée aux thèmes clair / sépia / sombre', new Set(Object.values(tintDark)).size === 3, JSON.stringify(tintDark));
  await page.screenshot({ path: path.join(OUT, '..', 'notes-visibles.png') });
  check('statistiques sans les notes privées', await page.evaluate(() => !/SECRETNOTE/.test(window.__ed.engine().plainText({ privateNotes: false })) && window.__ed.engine().stats().words < window.__ed.engine().wordCount()));

  // attente de l'enregistrement automatique
  await page.waitForFunction(() => document.querySelector('.ed-status')?.dataset.status !== 'saving', null, { timeout: 15000 });
  await page.waitForTimeout(2500);

  // ── 2. Masquer / afficher (affichage seulement) ──
  const before = await statusOf(page);
  await page.click('.ed-toolbar [data-tb="hide-notes"]');
  await page.waitForTimeout(700);
  let painted = await page.evaluate(() => ({ frag: [...document.querySelectorAll('.ed-engine .superdoc-fragment[data-style-id="MarginaliaNotePrivee"]')].filter((f) => getComputedStyle(f).visibility !== 'hidden').length, text: document.querySelector('.ed-engine').textContent.includes('SECRETNOTE') }));
  check('« Masquer les notes privées » : notes retirées de la page (place refermée)', painted.frag === 0 && !painted.text, JSON.stringify(painted));
  check('masquer n’est pas une modification de l’écrit', (await statusOf(page)) === before, `${before} → ${await statusOf(page)}`);
  await page.screenshot({ path: path.join(OUT, '..', 'notes-masquees.png') });
  await page.click('.ed-toolbar [data-tb="hide-notes"]');
  await page.waitForTimeout(700);
  painted = await page.evaluate(() => [...document.querySelectorAll('.ed-engine .superdoc-fragment[data-style-id="MarginaliaNotePrivee"]')].filter((f) => getComputedStyle(f).visibility !== 'hidden').length);
  check('réaffichage', painted >= 2, String(painted));

  // ── 3. Presse-papiers ──
  const clip = await page.evaluate(() => {
    const ed = window.__ed.engine().debugEditor().editor;
    ed.commands.setTextSelection({ from: 1, to: ed.state.doc.content.size - 1 });
    ed.view.focus();
    const dt = new DataTransfer();
    const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true });
    ed.view.dom.dispatchEvent(ev);
    return { plain: dt.getData('text/plain'), html: dt.getData('text/html'), types: [...dt.types] };
  });
  check('copie : notes privées absentes du presse-papiers (texte et HTML)', clip.plain.includes('Texte alpha') && !clip.plain.includes(SECRET) && !clip.html.includes(SECRET), JSON.stringify({ plain: clip.plain.slice(0, 80), types: clip.types }));

  // ── 4. Exports ──
  const docxPath = await exportVia(page, 'docx', 'export.docx');
  const dx = inspectDocx(docxPath);
  check('export Word : aucune note privée, ni leur note de bas de page, ni style appliqué', !dx.all.includes(SECRET) && !dx.all.includes('NOTEDANSPRIVEE') && !dx.pstyle && dx.refNotes.length === 3 && dx.pydocx > 0, JSON.stringify(dx.refNotes));
  for (const [fmt, file] of [['md', 'export.md'], ['html', 'export.html'], ['txt', 'export.txt']]) {
    const p = await exportVia(page, fmt, file);
    const t = fs.readFileSync(p, 'utf8');
    check(`export ${fmt.toUpperCase()} : sans note privée, notes de bas de page 1-3`, !t.includes(SECRET) && !t.includes('NOTEDANSPRIVEE') && t.includes('Texte gamma') && t.includes('Note C') && !/Note C[\s\S]*\b4\b.*Note/.test(t), `${t.length} car.`);
  }
  // PDF (l'hôte du navigateur ne sait pas imprimer : on intercepte le HTML d'impression)
  await page.evaluate(async () => {
    const { host } = await import('/src/lib/platform.ts');
    window.__printed = null;
    host.printToPdf = async (html) => {
      window.__printed = html;
      return new TextEncoder().encode('%PDF-1.4 test').buffer;
    };
  });
  await exportVia(page, 'pdf', 'export.pdf');
  const printed = await page.evaluate(() => window.__printed);
  check('export PDF : HTML imprimé sans note privée', printed && !printed.includes(SECRET) && printed.includes('Texte beta'), printed ? `${printed.length} car.` : 'rien');
  // Enregistrer vers le fichier externe : sans notes ; la bibliothèque les garde
  await page.evaluate(async () => {
    const { host } = await import('/src/lib/platform.ts');
    window.__written = null;
    host.writeExternal = async (p, data) => {
      let s = '';
      const b = new Uint8Array(data);
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      window.__written = { p, b64: btoa(s) };
    };
  });
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.__written, null, { timeout: 20000 });
  const written = await page.evaluate(() => window.__written);
  const extPath = path.join(OUT, 'externe.docx');
  fs.writeFileSync(extPath, Buffer.from(written.b64, 'base64'));
  const ex = inspectDocx(extPath);
  check('« Enregistrer » vers le .docx externe : sans notes privées', !ex.all.includes(SECRET) && !ex.all.includes('NOTEDANSPRIVEE') && ex.refNotes.length === 3, ex.paras.join(' | ').slice(0, 200));
  const libPath = path.join(OUT, 'bibliotheque.docx');
  fs.writeFileSync(libPath, await readLib(page, d.id));
  const lb = inspectDocx(libPath);
  check('copie de la bibliothèque : notes privées conservées', lb.all.includes(SECRET) && lb.pstyle, '');
  // réouverture du fichier externe (inchangé) : la copie de travail garde ses notes
  const reopened = await page.evaluate(async (b64) => {
    const { host } = await import('/src/lib/platform.ts');
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    host.openDocx = async () => ({ path: '/Users/test/Notes et plan.docx', name: 'Notes et plan.docx', data });
    const { openDocxFromDisk } = await import('/src/features/editor/api.ts');
    const dr = await openDocxFromDisk();
    return dr?.id;
  }, written.b64);
  const lb2 = inspectDocx((fs.writeFileSync(libPath, await readLib(page, d.id)), libPath));
  check('réouverture du fichier enregistré : même écrit, notes privées gardées', reopened === d.id && lb2.all.includes(SECRET));
  // texte de secours
  check('texte de secours (plainText) sans note privée', await page.evaluate(() => !window.__ed.engine().plainText({ privateNotes: false }).includes('SECRETNOTE')));
  // nettoyage direct d'un paquet : signets de citation
  const bm = await page.evaluate(async () => {
    const m = await import('/src/features/editor/privateNotes.ts');
    const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:bookmarkStart w:id="7" w:name="_mglHl_abc"/><w:r><w:t>cité</w:t></w:r><w:bookmarkEnd w:id="7"/><w:bookmarkStart w:id="8" w:name="Garde"/><w:bookmarkEnd w:id="8"/></w:p></w:body></w:document>';
    return m.stripDocumentXml(xml).xml;
  });
  check('nettoyage : signets _mglHl_ retirés, autres signets gardés', !bm.includes('_mglHl_') && !bm.includes('w:id="7"') && bm.includes('Garde') && bm.includes('cité'));

  // ── 5. Plan : glisser-déposer d'une section avec ses notes de bas de page ──
  check('panneau Plan : titres 1-3', JSON.stringify(await outlineTexts(page)) === JSON.stringify(['Alpha', 'Beta', 'Beta sous-partie', 'Gamma']), (await outlineTexts(page)).join(', '));
  const rows = page.locator('.ed-ol-row');
  await rows.nth(3).dragTo(rows.nth(0), { targetPosition: { x: 40, y: 3 } });
  await page.waitForTimeout(800);
  let order = await outlineTexts(page);
  check('glisser « Gamma » avant « Alpha » : section entière déplacée', JSON.stringify(order) === JSON.stringify(['Gamma', 'Alpha', 'Beta', 'Beta sous-partie']), order.join(', '));
  const body = await page.evaluate(() => window.__ed.engine().plainText());
  check('contenu de la section déplacé avec le titre', body.indexOf('Texte gamma') < body.indexOf('Alpha') && body.indexOf('Gamma') < body.indexOf('Texte gamma'));
  const sups = await page.evaluate(() => [...document.querySelectorAll('.ed-engine .superdoc-page')].map((p) => p.textContent).join(' '));
  check('numérotation affichée : la note de Gamma devient 1', /1\s*Note C/.test(sups) && /2\s*Note A/.test(sups), sups.replace(/\s+/g, ' ').slice(-160));
  await page.waitForTimeout(2200);
  const mv = inspectDocx(await exportVia(page, 'docx', 'deplace.docx'));
  check('export après déplacement : notes de bas de page conservées, dans le nouvel ordre', JSON.stringify(mv.refNotes) === JSON.stringify(['Note C', 'Note A', 'Note B']), JSON.stringify(mv.refNotes));
  await page.screenshot({ path: path.join(OUT, '..', 'plan-deplace.png') });

  // ── 6. Annulation en une étape ──
  await page.evaluate(() => window.__ed.engine().focus());
  await page.evaluate(() => window.__ed.undo());
  await page.waitForTimeout(600);
  order = await outlineTexts(page);
  check('⌘Z : un seul retour arrière annule tout le déplacement', JSON.stringify(order) === JSON.stringify(['Alpha', 'Beta', 'Beta sous-partie', 'Gamma']) && (await page.evaluate(() => window.__ed.engine().privateNoteCount())) === 2, order.join(', '));
  await page.evaluate(() => window.__ed.redo?.() ?? window.__ed.engine().redo());
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__ed.engine().undo());
  await page.waitForTimeout(400);

  // ── 7. Clavier ──
  await page.locator('.ed-outline-item', { hasText: /^Beta$/ }).focus();
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await page.waitForTimeout(700);
  order = await outlineTexts(page);
  check('⌥⇧↑ sur « Beta » dans le plan : section (avec sa sous-partie) remontée', JSON.stringify(order) === JSON.stringify(['Beta', 'Beta sous-partie', 'Alpha', 'Gamma']), order.join(', '));
  check('le focus suit la section déplacée', await page.evaluate(() => document.activeElement?.textContent === 'Beta'), await page.evaluate(() => document.activeElement?.textContent));
  await caret(page, 'Texte beta', 'end');
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await page.waitForTimeout(700);
  order = await outlineTexts(page);
  check('⌥⇧↓ dans le texte : section du curseur redescendue', JSON.stringify(order) === JSON.stringify(['Alpha', 'Beta', 'Beta sous-partie', 'Gamma']), order.join(', '));
  await caret(page, 'Détail beta', 'end');
  await page.keyboard.press('Alt+Shift+ArrowUp');
  await page.waitForTimeout(500);
  check('sous-partie seule de son niveau : pas de déplacement', JSON.stringify(await outlineTexts(page)) === JSON.stringify(['Alpha', 'Beta', 'Beta sous-partie', 'Gamma']));

  // ── 8. Clic = défilement, titre courant ──
  await page.click('.ed-outline-item:has-text("Gamma")');
  await page.waitForTimeout(600);
  const cur = await page.evaluate(() => document.querySelector('.ed-outline-item[aria-current="location"]')?.textContent);
  check('clic sur un titre : curseur et titre courant', cur === 'Gamma', cur);
  check('aucune requête réseau externe', external.length === 0, external.slice(0, 3).join(', '));
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
