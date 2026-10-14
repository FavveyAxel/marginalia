// Tests du module Écrire (A3) — port 5203.
// Lancer : timeout 170 node scripts/test-editor.mjs [--only=a,b,…] [--no-shots]
// Étapes : modele (créer, saisir, citation + note, enregistrer, recharger), fixture (aller-retour
// .docx de fixtures/discours.docx vérifié par python-docx), exports (MD/HTML/TXT), g2 (enregistrement
// refusé + texte de secours ; ouverture incomplète sans G1), externe (jamais d'écrasement automatique),
// shots (captures clair et sombre).
import { shot } from './harness.mjs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/editor/out');
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);
const PORT = 5203;

// Variante de harness.withApp avec un cache Vite propre au port : plusieurs agents lancent Vite en
// parallèle sur le même projet, et un cache partagé provoque des « 504 Outdated Optimize Dep ».
async function withApp(port, fn, { width = 1440, height = 900 } = {}) {
  const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${port}`), server: { port, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('response', (r) => r.status() === 404 && errors.push('404 : ' + r.url()));
  try {
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    await fn(page, errors);
  } finally {
    if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + [...new Set(errors)].join('\n'));
    await browser.close();
    await server.close();
  }
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
}
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
const py = (code, ...a) => execFileSync('python3', ['-I', '-c', code, ...a], { encoding: 'utf8' });

// ── Aides navigateur ─────────────────────────────────────────
async function createDraft(page, opts) {
  return page.evaluate(async (o) => {
    const m = await import('/src/features/editor/api.ts');
    const bin = o.b64 ? Uint8Array.from(atob(o.b64), (c) => c.charCodeAt(0)).buffer : undefined;
    const d = await m.createDraft({ title: o.title, template: o.template, html: o.html, docx: bin, externalPath: o.externalPath ?? null });
    return d;
  }, opts);
}
async function openDraft(page, id) {
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(900);
}
async function backToList(page) {
  await page.evaluate(() => window.__store.getState().navigate({ name: 'write', draftId: null }));
  await page.waitForSelector('.ed-list-inner', { timeout: 10000 });
}
async function readLib(page, id, name = 'document.docx') {
  const b64 = await page.evaluate(
    async ({ id, name }) => {
      const { host } = await import('/src/lib/platform.ts');
      try {
        const buf = new Uint8Array(await host.readFile(id, name));
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      } catch {
        return null;
      }
    },
    { id, name },
  );
  return b64 ? Buffer.from(b64, 'base64') : null;
}
async function waitSaved(page, timeout = 15000) {
  await page.waitForFunction(() => document.querySelector('.ed-status')?.dataset.status === 'saved', null, { timeout });
}
/** Lance une action qui déclenche un téléchargement (host.saveBinary navigateur) et l'enregistre. */
async function download(page, action, file) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), action()]);
  const p = path.join(OUT, file);
  await dl.saveAs(p);
  return { path: p, suggested: dl.suggestedFilename() };
}
async function exportVia(page, fmt, file) {
  return download(
    page,
    async () => {
      await page.click('.ed-topbar button[aria-haspopup="menu"]');
      await page.click(`.ed-export-menu [data-fmt="${fmt}"]`);
    },
    file,
  );
}
async function caretAfterHeading(page, headingText) {
  // place le curseur à la fin du paragraphe qui suit le titre (paragraphe vide des modèles)
  await page.evaluate((t) => {
    const e = window.__ed.engine();
    const o = e.outline().find((x) => x.text === t);
    e.goTo(o.pos);
  }, headingText);
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
}

const DOCX_TEXT_PY = `
import sys, zipfile, re, json, docx
d = docx.Document(sys.argv[1])
paras = [(p.style.name, p.text) for p in d.paragraphs]
z = zipfile.ZipFile(sys.argv[1])
def notes(name):
    if name not in z.namelist(): return []
    x = z.read(name).decode('utf8')
    out = []
    for m in re.finditer(r'<w:footnote\\b([^>]*)>(.*?)</w:footnote>', x, re.S):
        if 'w:type=' in m.group(1): continue
        out.append(''.join(re.findall(r'<w:t(?:\\s[^>]*)?>([^<]*)</w:t>', m.group(2))))
    return out
docxml = z.read('word/document.xml').decode('utf8')
sect = re.findall(r'<w:sectPr\\b.*?(?:/>|</w:sectPr>)', docxml, re.S)
print(json.dumps({'paras': paras, 'notes': notes('word/footnotes.xml'), 'refs': docxml.count('<w:footnoteReference'),
  'comments': len(re.findall(r'<w:comment\\b', z.read('word/comments.xml').decode('utf8'))) if 'word/comments.xml' in z.namelist() else 0,
  'pgSz': re.findall(r'<w:pgSz[^>]*>', sect[-1]) if sect else []}, ensure_ascii=False))
`;
const docxInfo = (p) => JSON.parse(py(DOCX_TEXT_PY, p));
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// ═════════════════════════════════════════════════════════════
await withApp(PORT, async (page, errors) => {
  const external = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!/^(http:\/\/localhost|data:|blob:)/.test(u)) external.push(u);
  });
  const fixtureB64 = fs.readFileSync(path.join(ROOT, 'fixtures/discours.docx')).toString('base64');

  // Données de lecture pour le panneau Extraits
  await page.evaluate(() => {
    const s = window.__store.getState();
    const now = Date.now();
    s.insert('books', {
      id: 'bk-desc', title: 'Discours de la méthode', author: 'René Descartes', format: 'epub', fileName: 'source.epub',
      originalName: 'discours.epub', size: 1, addedAt: now, lastOpenedAt: null, progress: 0, position: null, cover: null,
      edition: { publisher: 'GF Flammarion', year: '2000', translator: '', place: 'Paris', pageOffset: 0 },
    });
    s.insert('books', {
      id: 'bk-spin', title: 'Éthique', author: 'Spinoza', format: 'epub', fileName: 'source.epub', originalName: 'ethique.epub', size: 1,
      addedAt: now, lastOpenedAt: null, progress: 0, position: null, cover: null,
      edition: { publisher: 'Seuil', year: '1988', translator: 'B. Pautrat', place: 'Paris', pageOffset: 0 },
    });
    const hl = (id, bookId, text, cat, page, label, t) => ({
      id, bookId, category: cat, text, note: '', noteKind: null, conceptIds: [],
      anchor: { kind: 'html', chapter: 0, start: 0, end: 10, prefix: '', suffix: '' },
      locationLabel: label, printedPage: page, createdAt: now - t, updatedAt: now - t,
    });
    s.insert('highlights', hl('hl-1', 'bk-desc', 'Le bon sens est la chose du monde la mieux partagée', 'these', '45', 'Première partie', 1000));
    s.insert('highlights', hl('hl-2', 'bk-desc', 'Je pense, donc je suis', 'these', '', 'Quatrième partie', 2000));
    s.insert('highlights', hl('hl-3', 'bk-spin', 'Le désir est l’essence même de l’homme', 'concept', '305', 'III, déf. 1', 3000));
    s.insert('highlights', hl('hl-4', 'bk-desc', 'il ne suffit pas d’avoir l’esprit bon, mais le principal est de l’appliquer bien', 'argument', '46', 'Première partie', 4000));
  });

  // ── 1. Modèle → saisie → citation + note → enregistrer → recharger ──
  if (want('modele')) {
    const d = await createDraft(page, { title: 'La conscience', template: 'dissertation' });
    check('modèle : écrit créé dans le store', await page.evaluate((id) => !!window.__store.getState().drafts.find((x) => x.id === id), d.id));
    const initial = await readLib(page, d.id);
    const p0 = path.join(OUT, 'modele-initial.docx');
    fs.writeFileSync(p0, initial);
    const i0 = docxInfo(p0);
    check('modèle : .docx généré (titres, A4)', i0.paras.some((p) => p[0] === 'Heading 1' && p[1] === 'Introduction') && /11906/.test(i0.pgSz.join('')), `${i0.paras.length} paragraphes, ${i0.pgSz}`);

    await openDraft(page, d.id);
    await caretAfterHeading(page, '1. Premier argument');
    await page.keyboard.type('La conscience accompagne toutes mes pensées. MARQUEUR-SAISIE');
    await page.waitForTimeout(400);
    // citation depuis le panneau Extraits (filtre par recherche)
    await page.fill('.ed-extracts input[aria-label="Rechercher dans les extraits"]', 'bon sens');
    await page.waitForTimeout(200);
    const nVisible = await page.locator('.ed-xt').count();
    check('extraits : recherche filtre la liste', nVisible === 1, `${nVisible} résultat(s)`);
    await page.click('.ed-xt[data-hl="hl-1"] .ed-xt-insert');
    await page.waitForTimeout(800);
    await page.keyboard.type('Suite après la citation.');
    await page.waitForTimeout(300);
    // ⌘S
    await page.keyboard.press('Control+s');
    await waitSaved(page);
    const saved = await readLib(page, d.id);
    const p1 = path.join(OUT, 'modele-enregistre.docx');
    fs.writeFileSync(p1, saved);
    const i1 = docxInfo(p1);
    const txt1 = i1.paras.map((p) => p[1]).join('\n');
    check('enregistrer : texte saisi présent', txt1.includes('MARQUEUR-SAISIE'));
    const q = i1.paras.find((p) => p[1].includes('Le bon sens est la chose'));
    check('citation : paragraphe de style Citation', q && /quote|citation/i.test(q[0]), q ? `style « ${q[0]} »` : 'absente');
    check('citation : vraie note de bas de page', i1.refs >= 1 && i1.notes.some((n) => n.includes('René Descartes, Discours de la méthode') && n.includes('p. 45')), JSON.stringify(i1.notes));
    check('citation : texte après la citation', txt1.includes('Suite après la citation.'));
    const prev = await readLib(page, d.id, 'document.prev.docx');
    check('G3 : copie document.prev.docx créée', prev && sha(prev) === sha(initial), prev ? `prev=${sha(prev)} initial=${sha(initial)}` : 'absente');
    const wcStore = await page.evaluate((id) => window.__store.getState().drafts.find((x) => x.id === id).wordCount, d.id);
    check('wordCount mis à jour', wcStore > i0.paras.length, `${wcStore} mots`);

    // modification puis départ immédiat : enregistrement à la fermeture
    await caretAfterHeading(page, '2. Deuxième argument');
    await page.keyboard.type('MARQUEUR-FERMETURE');
    await backToList(page);
    await page.waitForTimeout(2500);
    const closed = await readLib(page, d.id);
    fs.writeFileSync(path.join(OUT, 'modele-fermeture.docx'), closed);
    const ic = docxInfo(path.join(OUT, 'modele-fermeture.docx'));
    check('fermeture : modification enregistrée en quittant', ic.paras.some((p) => p[1].includes('MARQUEUR-FERMETURE')));

    // rechargement complet
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
    await openDraft(page, d.id);
    const after = await page.evaluate(() => {
      const e = window.__ed.engine();
      return { text: e.plainText(), outline: e.outline().length };
    });
    check(
      'recharger : texte, citation et titres retrouvés',
      after.text.includes('MARQUEUR-SAISIE') && after.text.includes('MARQUEUR-FERMETURE') && after.text.includes('Le bon sens') && after.outline >= 11,
      `${after.outline} titres`,
    );
    const fnShown = await page.evaluate(() => document.querySelectorAll('[data-footnote-id], .superdoc-footnote, [class*="footnote"]').length);
    check('recharger : note visible dans la page', fnShown > 0, `${fnShown} élément(s)`);
    // titre éditable
    await page.fill('.ed-title-input', 'La conscience (brouillon)');
    await page.keyboard.press('Enter');
    check('titre éditable', (await page.evaluate((id) => window.__store.getState().drafts.find((x) => x.id === id).title, d.id)) === 'La conscience (brouillon)');
    await backToList(page);
  }

  // ── 2. Fixture : aller-retour .docx ──
  let fixtureDraft = null;
  if (want('fixture') || want('exports')) {
    fixtureDraft = await createDraft(page, { title: 'Discours (fixture)', b64: fixtureB64 });
    const stored = await readLib(page, fixtureDraft.id);
    const ps = path.join(OUT, 'fixture-stockee.docx');
    fs.writeFileSync(ps, stored);
    const is = docxInfo(ps);
    check('G1 : sectPr A4 injecté à l’import', is.pgSz.some((x) => x.includes('11906')), String(is.pgSz));
    await openDraft(page, fixtureDraft.id);
    const wc = await page.evaluate(() => window.__ed.engine().wordCount());
    check('fixture : le moteur affiche tout le texte', wc >= 700, `${wc} mots dans l’éditeur`);
    // modification : fin du premier paragraphe de corps
    await page.evaluate(() => {
      const e = window.__ed.engine();
      const o = e.outline().find((x) => x.text === 'Première partie');
      e.goTo(o.pos);
    });
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.type(' MARQUEUR-EDIT');
    await page.waitForTimeout(400);
    // citation + note dans un document étranger (style Citation absent : BlockText ou mise en forme directe)
    await page.fill('.ed-extracts input[aria-label="Rechercher dans les extraits"]', 'je pense');
    await page.click('.ed-xt[data-hl="hl-2"] .ed-xt-insert');
    await page.waitForTimeout(800);
  }
  if (want('fixture')) {
    const ex = await exportVia(page, 'docx', 'fixture-export.docx');
    check('export .docx : nom proposé', ex.suggested === 'Discours (fixture).docx', ex.suggested);
    const orig = docxInfo(path.join(ROOT, 'fixtures/discours.docx'));
    const got = docxInfo(ex.path);
    const gotText = norm(got.paras.map((p) => p[1]).join(' '));
    const cleaned = norm(gotText.replace('MARQUEUR-EDIT', ''));
    const missing = orig.paras.filter((p) => norm(p[1]) && !cleaned.includes(norm(p[1])));
    const modified = got.paras.find((p) => p[1].includes('MARQUEUR-EDIT'));
    const wc = (ps) => ps.reduce((n, p) => n + p[1].split(/\s+/).filter(Boolean).length, 0);
    check(
      'aller-retour : tout le texte d’origine conservé',
      missing.length === 0,
      `${orig.paras.filter((p) => norm(p[1])).length} § non vides d’origine, ${missing.length} manquant(s) ; mots ${wc(orig.paras)} → ${wc(got.paras)} (+ marqueur et citation)`,
    );
    check('aller-retour : modification présente', !!modified, modified ? '…' + modified[1].slice(60, 120) + '…' : '');
    const q = got.paras.find((p) => p[1].includes('Je pense, donc je suis'));
    check('aller-retour : citation insérée + note', !!q && got.notes.length === orig.notes.length + 1 && got.notes.at(-1).includes('Quatrième partie'), q ? `style « ${q[0]} » ; note « ${got.notes.at(-1)} »` : 'absente');
    const styleKept = ['Title', 'Author', 'Heading 1', 'Heading 2', 'First Paragraph', 'Body Text'].filter((s) => got.paras.some((p) => p[0] === s));
    check('aller-retour : styles conservés', styleKept.length >= 5, styleKept.join(', '));
    check('aller-retour : commentaires conservés', got.comments === orig.comments, `notes ${orig.notes.length}→${got.notes.length}, commentaires ${orig.comments}→${got.comments}`);
    check('aller-retour : format A4', got.pgSz.some((x) => x.includes('11906')), String(got.pgSz));
    // mammoth (lecture indépendante)
    const mm = await import('mammoth');
    const raw = (await mm.default.extractRawText({ path: ex.path })).value;
    check('mammoth relit le fichier exporté', raw.includes('MARQUEUR-EDIT') && orig.paras.every((p) => norm(raw.replace('MARQUEUR-EDIT', '')).includes(norm(p[1]))), `${raw.length} caractères`);
  }

  // ── 3. Exports MD / HTML / TXT (+ PDF : message propre en navigateur) ──
  if (want('exports')) {
    const md = fs.readFileSync((await exportVia(page, 'md', 'fixture.md')).path, 'utf8');
    check('Markdown : titres, texte, modification', /^# Discours de la méthode/m.test(md) && /^## Première partie/m.test(md) && md.includes('MARQUEUR-EDIT'), md.split('\n')[0]);
    check('Markdown : notes [^1]', /\[\^1\]/.test(md) && /^\[\^1\]: /m.test(md));
    const html = fs.readFileSync((await exportVia(page, 'html', 'fixture.html')).path, 'utf8');
    check('HTML : document autonome', html.startsWith('<!doctype html>') && html.includes('<h2>Première partie</h2>') && html.includes('MARQUEUR-EDIT') && html.includes('class="footnotes"'));
    const txt = fs.readFileSync((await exportVia(page, 'txt', 'fixture.txt')).path, 'utf8');
    check('Texte brut : contenu et notes', txt.includes('MARQUEUR-EDIT') && txt.includes('PREMIÈRE PARTIE') && /\nNotes\n/.test(txt) && !/[<>]/.test(txt.slice(0, 500)));
    // PDF en navigateur : erreur attendue → message propre, pas de plantage
    await page.click('.ed-topbar button[aria-haspopup="menu"]');
    await page.click('.ed-export-menu [data-fmt="pdf"]');
    await page.waitForTimeout(1500);
    const toastTxt = await page.evaluate(() => window.__store.getState().toasts?.map((t) => t.message).join(' | ') ?? document.body.innerText);
    check('PDF (navigateur) : message clair', /app Mac/.test(toastTxt), toastTxt.slice(0, 160));
    // HTML d'impression (ce que l'hôte Electron transforme en PDF)
    const printHtml = await page.evaluate(async () => {
      const e = window.__ed.engine();
      const { parseDocx } = await import('/src/features/editor/docx.ts');
      const { toPrintHtml } = await import('/src/features/editor/exporters.ts');
      return toPrintHtml(await parseDocx(await e.exportDocx()), 'Discours');
    });
    fs.writeFileSync(path.join(OUT, 'fixture-impression.html'), printHtml);
    check('PDF : HTML d’impression A4 autonome', printHtml.includes('@page { size: A4') && printHtml.includes('MARQUEUR-EDIT') && !/<link|<script|https?:\/\//.test(printHtml.replace(/http:\/\/www\.w3\.org[^"]*/g, '')));
  }
  if (fixtureDraft) await backToList(page);

  // ── 4. G2 ──
  if (want('g2')) {
    const d = await createDraft(page, { title: 'Garde-fou', html: '<h1>Essai</h1><p>Un deux trois quatre cinq six sept huit neuf dix.</p>' });
    await openDraft(page, d.id);
    await page.evaluate(() => {
      const e = window.__ed.engine();
      e.goTo(e.outline()[0].pos);
    });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.type(' Onze douze.');
    await page.keyboard.press('Control+s');
    await waitSaved(page);
    const before = await readLib(page, d.id);
    // export « vide » simulé (comme SuperDoc sur un sectPr vide)
    await page.evaluate(() => (window.__edTest = { corruptExport: true }));
    await page.keyboard.type(' Treize.');
    await page.keyboard.press('Control+s');
    await page.waitForSelector('[data-guard="g2"]', { timeout: 15000 });
    const banner = await page.textContent('[data-guard="g2"]');
    const afterBlocked = await readLib(page, d.id);
    check('G2 : export vide → enregistrement refusé', sha(afterBlocked) === sha(before), `fichier ${sha(before)} inchangé`);
    check('G2 : message affiché', /pas été modifié/.test(banner) && /0 mot/.test(banner), norm(banner).slice(0, 160));
    if (want('shots')) await shot(page, 'shots/editor/g2-bloque.png');
    const rescue = await download(page, () => page.click('[data-guard="g2"] button:first-of-type'), 'g2-secours.txt');
    const rtxt = fs.readFileSync(rescue.path, 'utf8');
    check('G2 : export de secours contient le texte', rtxt.includes('Onze douze.') && rtxt.includes('Treize.'), rescue.suggested);
    // l'autosave ne doit pas non plus écraser
    await page.evaluate(() => window.__ed.engine().focus());
    await page.keyboard.type(' Quatorze.');
    await page.waitForFunction(() => window.__ed.engine().plainText().includes('Quatorze.'), null, { timeout: 3000 });
    await page.waitForTimeout(2600);
    check('G2 : enregistrement auto également refusé', sha(await readLib(page, d.id)) === sha(before));
    // retour à la normale
    await page.evaluate(() => (window.__edTest = {}));
    await page.click('[data-guard="g2"] .btn-ghost');
    await waitSaved(page);
    const rec = docxInfo((fs.writeFileSync(path.join(OUT, 'g2-repare.docx'), await readLib(page, d.id)), path.join(OUT, 'g2-repare.docx')));
    check('G2 : « Réessayer » enregistre une fois l’export sain', rec.paras.some((p) => p[1].includes('Quatorze.')));
    await backToList(page);

    // Sans G1 : la fixture brute (sectPr vide) — SuperDoc l'affiche vide ; G2 à l'ouverture verrouille
    const raw = await page.evaluate(async (b64) => {
      const { host } = await import('/src/lib/platform.ts');
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
      const id = 'raw-' + Date.now();
      await host.storeFile(id, 'document.docx', bin);
      const now = Date.now();
      window.__store.getState().insert('drafts', { id, title: 'Fixture brute (sans G1)', fileName: 'document.docx', externalPath: null, wordCount: 727, template: null, createdAt: now, updatedAt: now });
      window.__edTest = { skipG1: true };
      return id;
    }, fixtureB64);
    await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), raw);
    await page.waitForFunction(() => document.querySelector('.ed-engine-in') || document.querySelector('.ed-error'), null, { timeout: 60000 });
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => ({
      banner: document.querySelector('.ed-banner')?.textContent ?? '',
      words: window.__ed?.engine()?.wordCount() ?? -1,
      saveDisabled: document.querySelector('.ed-topbar .btn-primary')?.disabled ?? null,
      error: document.querySelector('.ed-error')?.textContent ?? '',
    }));
    if (state.error) check('sans G1 : ouverture refusée proprement', true, norm(state.error).slice(0, 120));
    else check('sans G1 : chargement incomplet détecté, lecture seule', /ouvert qu’en partie/.test(state.banner) && state.saveDisabled === true, `éditeur ${state.words} mots ; ${norm(state.banner).slice(0, 120)}`);
    if (want('shots')) await shot(page, 'shots/editor/g2-ouverture.png');
    const ok = await page.evaluate(async () => (window.__ed ? window.__ed.save(true) : false));
    const rawAfter = await readLib(page, raw);
    check('sans G1 : ⌘S n’écrase pas le fichier', ok === false && sha(rawAfter) === sha(Buffer.from(fixtureB64, 'base64')));
    await page.evaluate(() => (window.__edTest = {}));
    await backToList(page);
  }

  // ── 5. Fichier externe : jamais d'écrasement automatique ──
  if (want('externe')) {
    const id = await page.evaluate(async (b64) => {
      const { host } = await import('/src/lib/platform.ts');
      window.__writes = [];
      host.openDocx = async () => ({ path: '/Users/test/Documents/Discours.docx', name: 'Discours.docx', data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer });
      host.writeExternal = async (p, data) => {
        window.__writes.push({ p, n: data.byteLength });
      };
      const m = await import('/src/features/editor/api.ts');
      const d = await m.openDocxFromDisk();
      return d.id;
    }, fixtureB64);
    const ext = await page.evaluate((id) => window.__store.getState().drafts.find((x) => x.id === id).externalPath, id);
    check('ouvrir un .docx : chemin d’origine retenu', ext === '/Users/test/Documents/Discours.docx');
    await openDraft(page, id);
    await page.evaluate(() => {
      const e = window.__ed.engine();
      e.goTo(e.outline()[0].pos);
    });
    await page.keyboard.press('End');
    await page.keyboard.type(' EXTERNE');
    await page.waitForTimeout(3200); // laisse passer l'enregistrement automatique
    const autoWrites = await page.evaluate(() => window.__writes.length);
    const libHas = docxInfo((fs.writeFileSync(path.join(OUT, 'externe-copie.docx'), await readLib(page, id)), path.join(OUT, 'externe-copie.docx')));
    check('externe : auto-enregistrement dans la bibliothèque seulement', autoWrites === 0 && libHas.paras.some((p) => p[1].includes('EXTERNE')), `${autoWrites} écriture(s) externe(s)`);
    const st = await page.textContent('.ed-status');
    check('externe : état « Modifications non enregistrées »', /non enregistrées/.test(st), st);
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 15000 });
    const w = await page.evaluate(() => window.__writes);
    check('externe : ⌘S réécrit le fichier d’origine', w.length === 1 && w[0].p === '/Users/test/Documents/Discours.docx' && w[0].n > 5000, JSON.stringify(w));
    await waitSaved(page);
    // G2 protège aussi le fichier externe
    await page.evaluate(() => (window.__edTest = { corruptExport: true }));
    await page.keyboard.type(' X');
    await page.keyboard.press('Control+s');
    await page.waitForSelector('[data-guard="g2"]', { timeout: 15000 });
    check('externe : G2 empêche la réécriture', (await page.evaluate(() => window.__writes.length)) === 1);
    await page.evaluate(() => (window.__edTest = {}));
    // réouverture du même chemin : pas de doublon
    await backToList(page);
    const again = await page.evaluate(async () => {
      const m = await import('/src/features/editor/api.ts');
      const d = await m.openDocxFromDisk();
      return { id: d.id, n: window.__store.getState().drafts.filter((x) => x.externalPath === '/Users/test/Documents/Discours.docx').length };
    });
    check('externe : rouvrir le même fichier ne crée pas de doublon', again.id === id && again.n === 1);
  }

  // ── 6. Espace actif ──
  if (want('espace')) {
    const r = await page.evaluate(async () => {
      const s = window.__store.getState();
      const now = Date.now();
      s.insert('workspaces', { id: 'ws-test', name: 'Bac', tint: '--cat-these', order: 0, createdAt: now });
      s.updateSettings({ activeWorkspaceId: 'ws-test' });
      const m = await import('/src/features/editor/api.ts');
      const d = await m.createDraft({ title: 'Dans l’espace', html: '<p>Note <span data-footnote="Une note *en italique*."></span> ici.</p>' });
      const st = window.__store.getState();
      st.updateSettings({ activeWorkspaceId: null });
      return { inWs: st.wsItems.some((i) => i.workspaceId === 'ws-test' && i.kind === 'draft' && i.refId === d.id), id: d.id };
    });
    check('espace actif : écrit ajouté', r.inWs);
    const p = path.join(OUT, 'html-note.docx');
    fs.writeFileSync(p, await readLib(page, r.id));
    const i = docxInfo(p);
    // suppression avec confirmation maison
    await backToList(page);
    await page.click(`[data-draft="${r.id}"] .ed-card-menu`);
    await page.click('.ed-menu .ed-danger');
    await page.waitForSelector('.ed-confirm');
    const q = await page.textContent('.ed-confirm');
    await page.click('.ed-confirm .ed-btn-danger');
    await page.waitForTimeout(400);
    const gone = await page.evaluate((id) => !window.__store.getState().drafts.some((d) => d.id === id), r.id);
    // Corbeille : l'écrit y part, son .docx reste sur le disque jusqu'au vidage (ou 30 jours).
    const inTrash = await page.evaluate((id) => window.__store.getState().trash.some((t) => t.kind === 'draft' && t.refId === id), r.id);
    check('supprimer : confirmation puis suppression (écrit dans la corbeille, .docx conservé)', gone && inTrash && /Supprimer « Dans l’espace »/.test(q) && !!(await readLib(page, r.id)), norm(q).slice(0, 80));
    check('html → .docx : <span data-footnote> devient une vraie note', i.refs === 1 && i.notes[0]?.includes('Une note en italique.'), JSON.stringify(i.notes));
  }

  // ── 7. Captures ──
  if (want('shots')) {
    for (const dark of [false, true]) {
      const suf = dark ? '-sombre' : '-clair';
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await page.evaluate((dark) => window.__store.getState().updateSettings({ theme: dark ? 'dark' : 'light' }), dark);
      await backToList(page);
      await page.waitForTimeout(700);
      await shot(page, `shots/editor/liste${suf}.png`);
      await page.click('.ed-list .topbar .btn-primary');
      await page.waitForTimeout(300);
      await shot(page, `shots/editor/nouveau${suf}.png`);
      await page.keyboard.press('Escape');
      const id = await page.evaluate(() => [...window.__store.getState().drafts].sort((a, b) => b.updatedAt - a.updatedAt).find((d) => d.template === 'dissertation')?.id);
      // chargement à froid (moteur retardé de 2 s) : squelette / page fantôme
      await page.waitForTimeout(600);
      await page.route('**/superdoc.min.js*', async (r) => {
        await new Promise((ok) => setTimeout(ok, 2000));
        await r.continue().catch(() => {});
      });
      await page.reload();
      await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
      await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
      await page.waitForTimeout(700);
      await shot(page, `shots/editor/chargement${suf}.png`);
      await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
      await page.unroute('**/superdoc.min.js*');
      await page.waitForTimeout(1200);
      await page.fill('.ed-extracts input[aria-label="Rechercher dans les extraits"]', '');
      await page.waitForTimeout(200);
      await shot(page, `shots/editor/editeur${suf}.png`);
      await page.click('.ed-topbar button[aria-haspopup="menu"]');
      await page.waitForTimeout(250);
      await shot(page, `shots/editor/export${suf}.png`);
      await page.keyboard.press('Escape');
      await page.click('.ed-count');
      await page.waitForTimeout(200);
      await shot(page, `shots/editor/stats${suf}.png`);
      await page.keyboard.press('Escape');
      await page.click('.ed-topbar [aria-label="Mode concentration"]');
      await page.waitForTimeout(400);
      await shot(page, `shots/editor/concentration${suf}.png`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      check(`concentration : Échap pour sortir (${suf.slice(1)})`, !(await page.$('.ed-focus')));
      await page.click('.ed-style-btn');
      await page.waitForTimeout(200);
      await shot(page, `shots/editor/styles${suf}.png`);
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'system' }));
  }

  check('aucun appel réseau externe (G4)', external.length === 0, external.slice(0, 5).join(' '));
  const relevant = errors.filter((e) => !/404 \(Not Found\)/.test(e));
  check('aucune erreur de page', relevant.length === 0, relevant.slice(0, 3).join(' | '));
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
if (failed.length) {
  console.log('ÉCHECS :\n' + failed.map((f) => `- ${f.name} ${f.detail}`).join('\n'));
  process.exitCode = 1;
}
