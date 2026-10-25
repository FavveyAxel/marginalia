// Bibliographie des livres cités (menu Insérer de l'éditeur) — port 5324.
// Citations liées à des extraits de deux livres (+ une deuxième citation du même livre) → « Bibliographie
// des livres cités » : titre « Bibliographie » à la fin, une référence par livre, triée par nom, titre en
// italique, sans doublon ; relancer met à jour (pas de deuxième bibliographie) ; le texte écrit après un
// titre suivant est conservé ; export .docx : titre en italique (w:i) ; sans citation : message.
// Lancer : timeout 240 node scripts/test-editor-biblio.mjs [dossier-captures]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5324;
const SHOTS = process.argv[2];
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function importFixture(page, file) {
  const b64 = fs.readFileSync(path.join(ROOT, file)).toString('base64');
  return page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await window.__store.getState().importFiles([{ name, data: bin.buffer }]);
      return book?.id;
    },
    { name: path.basename(file), b64 },
  );
}
async function openDraft(page, id) {
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(700);
}
const runBiblio = async (page) => {
  await page.click('[data-tb="insert"]');
  await page.waitForSelector('[data-insert="biblio"]');
  await page.click('[data-insert="biblio"]');
  await page.waitForTimeout(600);
};
const bibState = (page) =>
  page.evaluate(() => {
    const ed = window.__ed.engine().debugEditor().editor;
    const paras = [];
    ed.state.doc.forEach((n) => {
      const ital = [];
      n.descendants((t) => {
        if (t.isText && t.marks.some((m) => m.type.name === 'italic')) ital.push(t.text);
      });
      paras.push({ text: n.textContent, style: n.attrs?.paragraphProperties?.styleId ?? null, ital });
    });
    return paras;
  });
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast, [role="status"]')].map((t) => t.textContent).join(' | '));

const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').slice(0, 500)));

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
  const kant = await importFixture(page, 'fixtures/discours.epub');
  const ricoeur = await importFixture(page, 'fixtures/discours.pdf');
  check('deux livres importés', !!kant && !!ricoeur && kant !== ricoeur, `${kant} ${ricoeur}`);
  await page.evaluate(({ kant, ricoeur }) => {
    const s = window.__store.getState();
    s.updateBook(kant, { title: 'Fondements de la métaphysique des mœurs', author: 'Emmanuel Kant', edition: { publisher: 'Le Livre de Poche', year: '1993', translator: 'Victor Delbos', place: 'Paris', pageOffset: 0 } });
    s.updateBook(ricoeur, { title: 'Soi-même comme un autre', author: 'Paul Ricœur', edition: { publisher: 'Seuil', year: '1990', translator: '', place: 'Paris', pageOffset: 0 } });
    const now = Date.now();
    const mk = (id, bookId, text, page) => ({
      id, bookId, category: 'these', text, note: '', noteKind: null, conceptIds: [],
      anchor: { kind: 'html', chapter: 1, start: 0, end: text.length, prefix: '', suffix: '' },
      locationLabel: '', printedPage: page, createdAt: now, updatedAt: now,
    });
    window.__store.setState((st) => ({ highlights: [...st.highlights, mk('hk1', kant, 'Agis uniquement d’après la maxime…', '94'), mk('hk2', kant, 'La fausse promesse se détruit elle-même.', '96'), mk('hr1', ricoeur, 'Tenir sa promesse, c’est se maintenir.', '148')] }));
  }, { kant, ricoeur });

  const draft = await page.evaluate(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Le parjure', template: 'vide', html: '<p>Introduction.</p>' }));
  await openDraft(page, draft.id);

  // Sans citation : message, rien d'inséré.
  await runBiblio(page);
  const before = await bibState(page);
  check('sans citation liée : rien n’est inséré', !before.some((p) => p.text === 'Bibliographie'));
  check('sans citation liée : message', /Aucune citation liée/.test(await toasts(page)), await toasts(page));

  // Trois citations liées (Ricœur, Kant, Kant).
  await page.evaluate(async () => {
    const { tagInsertedCitation } = await import('/src/features/editor/citeLink.ts');
    const { formatFootnote } = await import('/src/lib/citation.ts');
    const s = window.__store.getState();
    const e = window.__ed.engine();
    for (const id of ['hr1', 'hk1', 'hk2']) {
      const h = s.highlights.find((x) => x.id === id);
      const b = s.books.find((x) => x.id === h.bookId);
      e.appendParagraph('');
      const ed = e.debugEditor().editor;
      ed.commands.setTextSelection(ed.state.doc.content.size - 1);
      const q = `« ${h.text} »`;
      e.insertCitation(q, formatFootnote(h, b));
      tagInsertedCitation(e, h.id, q);
    }
  });
  const nCites = await page.evaluate(async () => (await import('/src/features/editor/citeLink.ts')).citationRanges(window.__ed.engine()).length);
  check('trois citations liées dans l’écrit', nCites === 3, String(nCites));

  await runBiblio(page);
  let paras = await bibState(page);
  let at = paras.findIndex((p) => p.text === 'Bibliographie');
  let entries = paras.slice(at + 1).filter((p) => p.text.trim());
  check('titre « Bibliographie » ajouté en Titre 1', at >= 0 && /Heading1|Titre1/.test(paras[at].style ?? ''), paras[at]?.style);
  check('une référence par livre (pas de doublon pour Kant)', entries.length === 2, JSON.stringify(entries.map((e) => e.text)));
  check('triée par nom : Kant avant Ricœur', entries[0]?.text.startsWith('Emmanuel Kant') && entries[1]?.text.startsWith('Paul Ricœur'));
  check(
    'référence complète (traducteur, lieu, éditeur, année)',
    entries[0]?.text === 'Emmanuel Kant, Fondements de la métaphysique des mœurs, trad. Victor Delbos, Paris, Le Livre de Poche, 1993.',
    entries[0]?.text,
  );
  check('titre du livre en italique', entries[0]?.ital.join('') === 'Fondements de la métaphysique des mœurs' && entries[1]?.ital.join('') === 'Soi-même comme un autre', JSON.stringify(entries.map((e) => e.ital)));
  check('message de confirmation', /Bibliographie ajoutée à la fin : 2 livres/.test(await toasts(page)), await toasts(page));
  if (SHOTS) {
    await page.evaluate(() => document.querySelector('.ed-engine-in')?.closest('[class*="scroll"]')?.scrollTo?.(0, 1e6));
    await page.waitForTimeout(400);
  }

  // Annexe écrite après la bibliographie, puis édition de Ricœur modifiée → mise à jour.
  await page.evaluate(() => {
    const e = window.__ed.engine();
    const ed = e.debugEditor().editor;
    const S = ed.state.schema;
    const h = S.nodes.paragraph.create({ paragraphProperties: { styleId: 'Heading1' } }, S.nodes.run.create({}, S.text('Annexe')));
    const p = S.nodes.paragraph.create({ paragraphProperties: {} }, S.nodes.run.create({}, S.text('Texte de l’annexe.')));
    ed.view.dispatch(ed.state.tr.insert(ed.state.doc.content.size, [h, p]));
  });
  await page.evaluate((id) => window.__store.getState().updateBook(id, { edition: { publisher: 'Points', year: '2015', translator: '', place: 'Paris', pageOffset: 0 } }), ricoeur);
  await runBiblio(page);
  paras = await bibState(page);
  const heads = paras.filter((p) => p.text === 'Bibliographie').length;
  at = paras.findIndex((p) => p.text === 'Bibliographie');
  const annex = paras.findIndex((p) => p.text === 'Annexe');
  entries = paras.slice(at + 1, annex).filter((p) => p.text.trim());
  check('relancer : une seule bibliographie', heads === 1, String(heads));
  check('relancer : références à jour', entries[1]?.text === 'Paul Ricœur, Soi-même comme un autre, Paris, Points, 2015.', entries[1]?.text);
  check('relancer : l’annexe après est conservée', annex > at && paras[annex + 1]?.text === 'Texte de l’annexe.');
  check('message « mise à jour »', /Bibliographie mise à jour/.test(await toasts(page)), await toasts(page));

  // Export .docx : italique conservé.
  const buf = await page.evaluate(async () => Array.from(new Uint8Array(await window.__ed.engine().exportDocx())));
  const xml = await (await JSZip.loadAsync(Buffer.from(buf))).file('word/document.xml').async('string');
  const iTitle = /<w:rPr>(?:(?!<\/w:rPr>).)*<w:i ?\/>(?:(?!<\/w:rPr>).)*<\/w:rPr><w:t[^>]*>Soi-même comme un autre<\/w:t>/s.test(xml);
  check('export Word : bibliographie présente, titre en italique', xml.includes('Bibliographie') && iTitle, iTitle ? '' : xml.slice(Math.max(0, xml.indexOf('Soi-même comme') - 600), xml.indexOf('Soi-même comme') + 60));
  if (SHOTS) {
    await page.evaluate(() => {
      const e = window.__ed.engine();
      const o = e.outline().find((x) => x.text === 'Bibliographie');
      if (o) e.goTo(o.pos);
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, 'bibliographie.png') });
  }
  check('aucune erreur dans la page', !errors.length, errors.join('\n'));
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `\n${failed} vérification(s) en échec.` : '\nToutes les vérifications sont passées.');
process.exit(failed ? 1 : 0);
