// Correctif de l'éditeur (superdoc, version figée dans package.json) appliqué après chaque installation
// (« postinstall ») : une ligne qui se termine par un saut de ligne manuel (Maj+Entrée) n'est plus
// justifiée. superdoc imite Word, qui étire cette ligne jusqu'au bord droit : les mots « partent à droite
// de la page » avec de grands blancs. Marginalia fait comme un navigateur (et comme l'option de Word
// « Ne pas développer les espaces sur une ligne se terminant par Maj+Entrée »).
// Sans effet si le correctif est déjà là ; échoue si superdoc a changé (à revoir à chaque mise à jour).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DIR = path.join(ROOT, 'node_modules', 'superdoc', 'dist', 'chunks');
const MARK = 'mgLineEndsWithBreak';
const HELPER = `var ${MARK} = (block, line) => {
	const runs = block?.runs;
	if (!runs || !line || line.toRun == null) return false;
	const isBr = (r) => !!r && (r.kind === "lineBreak" || r.kind === "break" && r.breakType === "line");
	if (isBr(runs[line.toRun])) return true;
	const cur = runs[line.toRun];
	return !!cur && line.toChar >= getRunCharacterLength(cur) && isBr(runs[line.toRun + 1]);
};
`;
const EDITS = [
  ['var getJustifyAdjustment = ', HELPER + 'var getJustifyAdjustment = '],
  ['\t\tparagraphEndsWithLineBreak: paragraphEndsWithLineBreak ?? derivedEndsWithLineBreak,\n\t\tskipJustifyOverride\n', `\t\tparagraphEndsWithLineBreak: paragraphEndsWithLineBreak ?? derivedEndsWithLineBreak,\n\t\tskipJustifyOverride: skipJustifyOverride || ${MARK}(block, line)\n`],
  ['skipJustifyOverride: (resolvedLine?.skipJustify ?? false) || hasMultipleExplicitPositionedSegments', `skipJustifyOverride: (resolvedLine?.skipJustify ?? false) || hasMultipleExplicitPositionedSegments || ${MARK}(block, line)`],
  ['skipJustifyOverride: skipJustify || hasMultipleExplicitPositionedSegments', `skipJustifyOverride: skipJustify || hasMultipleExplicitPositionedSegments || ${MARK}(block, line)`],
];

if (!fs.existsSync(DIR)) {
  console.log('patch-superdoc : superdoc absent, rien à faire.');
  process.exit(0);
}
const files = fs.readdirSync(DIR).filter((f) => /^src-.*\.(es\.js|cjs)$/.test(f));
let changed = 0;
for (const f of files) {
  const p = path.join(DIR, f);
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes('var getJustifyAdjustment = ')) continue;
  if (s.includes(MARK)) continue;
  for (const [a, b] of EDITS) {
    if (s.split(a).length !== 2) {
      console.error(`patch-superdoc : motif introuvable dans ${f} (superdoc a changé ?) : ${a.slice(0, 60)}`);
      process.exit(1);
    }
    s = s.replace(a, b);
  }
  fs.writeFileSync(p, s);
  changed++;
}
// Build minifiée chargée par l'app (src/features/editor/engine.ts : superdoc.min.js) : mêmes trois endroits,
// noms raccourcis ; l'aide est ajoutée en tête du fichier.
const MIN = path.join(ROOT, 'node_modules', 'superdoc', 'dist', 'superdoc.min.js');
const MIN_HELPER = `globalThis.__mgBrEnd=function(b,l){var r=b&&b.runs;if(!r||!l||l.toRun==null)return!1;var br=function(x){return!!x&&(x.kind==="lineBreak"||x.kind==="break"&&x.breakType==="line")};if(br(r[l.toRun]))return!0;var c=r[l.toRun];return!!c&&l.toChar>=(typeof c.text==="string"?c.text.length:1)&&br(r[l.toRun+1])};\n`;
const MIN_EDITS = [
  ['skipJustifyOverride:(a?.skipJustify??!1)||c})', 'skipJustifyOverride:(a?.skipJustify??!1)||c||globalThis.__mgBrEnd(e,t)})'],
  ['skipJustifyOverride:i||A});w&&(', 'skipJustifyOverride:i||A||globalThis.__mgBrEnd(e,t)});w&&('],
  ['paragraphEndsWithLineBreak:i??f,skipJustifyOverride:s}))', 'paragraphEndsWithLineBreak:i??f,skipJustifyOverride:s||globalThis.__mgBrEnd(e,t)}))'],
];
if (fs.existsSync(MIN)) {
  let m = fs.readFileSync(MIN, 'utf8');
  if (!m.includes('__mgBrEnd')) {
    for (const [a, b] of MIN_EDITS) {
      if (m.split(a).length !== 2) {
        console.error(`patch-superdoc : motif introuvable dans superdoc.min.js (superdoc a changé ?) : ${a}`);
        process.exit(1);
      }
      m = m.replace(a, b);
    }
    fs.writeFileSync(MIN, MIN_HELPER + m);
    changed++;
  }
}
console.log(`patch-superdoc : justification des lignes terminées par Maj+Entrée corrigée (${changed} fichier(s)).`);
