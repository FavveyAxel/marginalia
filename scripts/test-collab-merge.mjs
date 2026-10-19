// Réunion paragraphe par paragraphe (src/features/collab/docxMerge.ts), en Node : fusion à trois des blocs
// d'un .docx, conflits (jamais lettre à lettre), reconstruction du paquet, refus si un bloc renvoie à une
// partie absente. Lancer : node scripts/test-collab-merge.mjs
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { build } from 'esbuild';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mg-merge-')), 'm.mjs');
await build({ entryPoints: [path.join(ROOT, 'src/features/collab/docxMerge.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const M = await import(out);
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const p = (t, extra = '') => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">${t}</w:t></w:r>${extra}</w:p>`;
async function docx(paras) {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`);
  return z.generateAsync({ type: 'arraybuffer' });
}
const texts = async (d) => M.docxTexts(d);

const base = ['Introduction.', 'Premier argument.', 'Deuxième argument.', 'Conclusion.'];
// 1. Changements de part et d'autre, sur des paragraphes différents : tout est gardé, sans conflit.
{
  const mine = await docx([p('Introduction.'), p('Premier argument, précisé par moi.'), p('Deuxième argument.'), p('Conclusion.')]);
  const theirs = await docx([p('Introduction.'), p('Premier argument.'), p('Deuxième argument.'), p('Troisième argument de Léa.'), p('Conclusion.')]);
  const A = await M.parseDocxBlocks(mine);
  const B = await M.parseDocxBlocks(theirs);
  const ch = M.merge3(base, A.blocks, B.blocks);
  ok(!ch.some((c) => c.kind === 'conflict'), 'paragraphes différents modifiés des deux côtés : aucun conflit');
  const r = await M.buildMerged(A, ch, []);
  ok(JSON.stringify(await texts(r)) === JSON.stringify(['Introduction.', 'Premier argument, précisé par moi.', 'Deuxième argument.', 'Troisième argument de Léa.', 'Conclusion.']), 'résultat : les deux modifications', await texts(r));
}
// 2. Même paragraphe modifié des deux côtés : conflit, avec les deux versions entières.
{
  const mine = await docx([p('Introduction.'), p('Premier argument : ma version.'), p('Deuxième argument.'), p('Conclusion.')]);
  const theirs = await docx([p('Introduction.'), p('Premier argument : la version de Léa.'), p('Deuxième argument.'), p('Conclusion revue par Léa.')]);
  const A = await M.parseDocxBlocks(mine);
  const B = await M.parseDocxBlocks(theirs);
  const ch = M.merge3(base, A.blocks, B.blocks);
  const conf = ch.filter((c) => c.kind === 'conflict');
  ok(conf.length === 1 && conf[0].mine[0].text === 'Premier argument : ma version.' && conf[0].theirs[0].text === 'Premier argument : la version de Léa.', 'même paragraphe des deux côtés : un conflit, les deux versions entières (rien de mélangé)', conf.map((c) => [c.mine.map((b) => b.text), c.theirs.map((b) => b.text)]));
  const pick = async (choice) => texts(await M.buildMerged(await M.parseDocxBlocks(mine), M.merge3(base, (await M.parseDocxBlocks(mine)).blocks, B.blocks), [choice]));
  ok((await pick('mine'))[1] === 'Premier argument : ma version.' && (await pick('mine'))[3] === 'Conclusion revue par Léa.', '« Garder la mienne » (et la conclusion de Léa, changée d’un seul côté)');
  ok((await pick('theirs'))[1] === 'Premier argument : la version de Léa.', '« Garder celle de Léa »');
  const both = await pick('both');
  ok(both[1] === 'Premier argument : ma version.' && both[2] === 'Premier argument : la version de Léa.' && both.length === 5, '« Garder les deux » : les deux paragraphes, l’un après l’autre', both);
}
// 3. Sans base connue : la partie commune sert de base.
{
  const mine = await docx([p('A.'), p('B mien.'), p('C.')]);
  const theirs = await docx([p('A.'), p('B leur.'), p('C.'), p('D.')]);
  const ch = M.merge3(null, (await M.parseDocxBlocks(mine)).blocks, (await M.parseDocxBlocks(theirs)).blocks);
  ok(ch.filter((c) => c.kind === 'conflict').length === 1, 'sans base : seuls les passages qui diffèrent sont proposés au choix', ch.map((c) => c.kind));
}
// 4. Bloc de l'autre côté avec une image (r:embed) : fusion refusée.
{
  const mine = await docx([p('Introduction.'), p('Premier argument.'), p('Deuxième argument.'), p('Conclusion.'), p('Ajout.')]);
  const theirs = await docx([p('Introduction.'), p('Premier argument.'), p('Image', '<w:r><w:drawing><a:blip xmlns:a="x" r:embed="rId9"/></w:drawing></w:r>'), p('Deuxième argument.'), p('Conclusion.')]);
  const A = await M.parseDocxBlocks(mine);
  const r = await M.buildMerged(A, M.merge3(base, A.blocks, (await M.parseDocxBlocks(theirs)).blocks), []);
  ok(r === null, 'bloc avec image venu de l’autre côté : fusion refusée (rien de cassé)');
}
// 5. Octets des blocs gardés tels quels ; sectPr en place.
{
  const raw = p('Gras', '<w:r><w:rPr><w:b/></w:rPr><w:t>!</w:t></w:r>');
  const d = await docx([raw, p('Fin.')]);
  const A = await M.parseDocxBlocks(d);
  ok(A.blocks[0].xml === raw && A.blocks[0].text === 'Gras!' && /<w:sectPr>/.test(A.tail), 'blocs copiés à l’octet près, texte lu, <w:sectPr> à part');
}
