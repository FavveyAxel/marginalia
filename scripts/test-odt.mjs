// Import des documents OpenDocument (.odt, enregistré par LibreOffice : fixtures/temps-libre.odt,
// texte inventé) : l'écrit garde titres, mise en forme, listes, citation, tableau, image, note de bas
// de page, saut de page ; le titre vient des propriétés du document ; il s'ouvre dans l'éditeur.
// Lancer : timeout 300 node scripts/test-odt.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { withApp } from './harness.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};

await withApp(5393, async (page, errors) => {
  const b64 = fs.readFileSync(path.join(ROOT, 'fixtures/temps-libre.odt')).toString('base64');
  const r = await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.__store.getState().importFiles([{ name: 'temps-libre.odt', data: bin.buffer }]);
    const s = window.__store.getState();
    const d = s.drafts[0];
    const { host } = await import('/src/lib/platform.ts');
    const buf = await host.readFile(d.id, d.fileName);
    let bin2 = '';
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < u8.length; i += 0x8000) bin2 += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return { drafts: s.drafts.length, books: s.books.length, title: d.title, words: d.wordCount, id: d.id, docx: btoa(bin2) };
  }, b64);
  ok('un .odt devient un écrit (pas un livre)', r.drafts === 1 && r.books === 0);
  ok('titre : celui des propriétés du document', r.title === 'Le temps libre est-il une liberté ?', r.title);
  ok('mots comptés', r.words > 50, String(r.words));

  const zip = await JSZip.loadAsync(Buffer.from(r.docx, 'base64'));
  const doc = await zip.file('word/document.xml').async('string');
  const notes = await zip.file('word/footnotes.xml').async('string');
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  const text = (x) => x.replace(/<[^>]+>/g, '');
  ok('titres : Heading1 et Heading2', (doc.match(/w:val="Heading1"/g) ?? []).length === 3 && (doc.match(/w:val="Heading2"/g) ?? []).length === 1);
  ok('gras, italique, souligné', /<w:b\/>[^]*?conquis/.test(doc) && /<w:i\/>[^]*?occupé/.test(doc) && /<w:u w:val="single"\/>[^]*?distinguer/.test(doc));
  ok('exposant', /<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t xml:space="preserve">2</.test(doc));
  ok('paragraphe centré', /<w:jc w:val="center"\/><\/w:pPr><w:r><w:t xml:space="preserve">Une phrase centrée/.test(doc));
  ok('note de bas de page', /footnoteReference w:id="1"/.test(doc) && text(notes).includes('Voir l’essai inventé sur le repos, chapitre deux.'));
  ok('espaces et retour à la ligne gardés', /Trois/.test(text(doc)) && /<w:br\/>/.test(doc));
  ok('listes : numérotée et à puces', (doc.match(/w:val="ListParagraph"/g) ?? []).length === 4 && /numFmt w:val="decimal"/.test(await zip.file('word/numbering.xml').async('string')) && /numFmt w:val="bullet"/.test(await zip.file('word/numbering.xml').async('string')));
  ok('citation (style Quotations)', /w:val="Quote"[^]*?Le loisir est une activité/.test(doc));
  ok('tableau, ligne d’en-tête', /<w:tbl>/.test(doc) && /<w:tblHeader\/>/.test(doc) && text(doc).includes('Claire Delorme'));
  ok('image intégrée', /<w:drawing>/.test(doc) && /relationships\/image/.test(rels) && Object.keys(zip.files).some((f) => f.startsWith('word/media/')));
  ok('saut de page avant la conclusion', /<w:br w:type="page"\/>/.test(doc));

  // ouverture dans l'éditeur
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), r.id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const heads = await page.evaluate(() => window.__ed.engine().outline().map((o) => `${o.level}:${o.text}`));
  ok('l’éditeur ouvre l’écrit, avec son plan', heads.join('|') === '1:Introduction|1:I. Le loisir conquis|2:A. La journée de huit heures|1:Conclusion', heads.join('|'));
  ok('tableau et image affichés dans l’éditeur', (await page.locator('.ed-engine-in [class*=table]').count()) >= 1 && (await page.locator('.ed-engine-in img').count()) >= 1 && (await page.evaluate(() => window.__ed.engine().plainText().includes('Claire Delorme'))));
  ok('note affichée', /Voir l’essai inventé/.test(await page.locator('.ed-engine-in').innerText()));
  await page.screenshot({ path: path.join(ROOT, 'shots/odt-editeur.png') });

  // un .odt qui n'est pas un texte : message clair
  const bad = await page.evaluate(async () => {
    const { odtToHtml } = await import('/src/lib/odtImport.ts');
    try {
      await odtToHtml(new TextEncoder().encode('pas un zip').buffer);
      return 'aucune erreur';
    } catch (e) {
      return String(e.message || e);
    }
  });
  ok('fichier abîmé : erreur, pas de plantage', bad !== 'aucune erreur', bad);

  const errs = errors.filter((e) => !/favicon|DevTools|ResizeObserver/.test(e));
  ok('aucune erreur dans la page', errs.length === 0, errs.join('\n'));
});
console.log(`\n${passed} vérifications passées.`);
