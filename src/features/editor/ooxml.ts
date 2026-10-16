// ─────────────────────────────────────────────────────────────
// Normalisation OOXML de l'export (indépendante du moteur, chaînes + JSZip) :
// SuperDoc 1.47.2 produit dans certains cas des parties XML que Word refuserait
// (research/9 §0). Tout export passe par `normalizeDocx` avant d'être écrit.
//
//  - espaces de noms : préfixes utilisés mais non déclarés (w14 des pieds de page, w15 de
//    numbering.xml…) ajoutés sur la racine ; préfixes inconnus retirés de mc:Ignorable ;
//  - ordre des enfants imposé par le schéma (sectPr, numPr, pPr, tblPr, tcPr, bordures,
//    settings, style, lvl, a:xfrm) ;
//  - attributs non standard retirés (w:authorEmail, attributs internes de w:comment) ;
//  - w:shd sans w:val, w:nsid trop court, w14:paraId ≥ 0x80000000 ;
//  - table des matières : styles TOC1-3 ajoutés s'ils manquent, tabulation des numéros de
//    page ramenée dans la largeur du texte.
// `checkDocxXml` vérifie ensuite que chaque partie est du XML bien formé (navigateur).
// ─────────────────────────────────────────────────────────────
import JSZip from 'jszip';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Espaces de noms connus (préfixes usuels de Word). */
export const KNOWN_NS: Record<string, string> = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  o: 'urn:schemas-microsoft-com:office:office',
  v: 'urn:schemas-microsoft-com:vml',
  w10: 'urn:schemas-microsoft-com:office:word',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  wp14: 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  a14: 'http://schemas.microsoft.com/office/drawing/2010/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  wpg: 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  wpc: 'http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas',
  wpi: 'http://schemas.microsoft.com/office/word/2010/wordprocessingInk',
  wne: 'http://schemas.microsoft.com/office/word/2006/wordml',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  w16: 'http://schemas.microsoft.com/office/word/2018/wordml',
  w16se: 'http://schemas.microsoft.com/office/word/2015/wordml/symex',
  w16cid: 'http://schemas.microsoft.com/office/word/2016/wordml/cid',
  w16cex: 'http://schemas.microsoft.com/office/word/2018/wordml/cex',
  w16du: 'http://schemas.microsoft.com/office/word/2023/wordml/word16du',
  w16sdtdh: 'http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash',
  w16sdtfl: 'http://schemas.microsoft.com/office/word/2024/wordml/sdtformatlock',
  sl: 'http://schemas.openxmlformats.org/schemaLibrary/2006/main',
};

// ── Ordre des enfants (ISO/IEC 29500-4, wml.xsd transitionnel) ──
// Un même rang = ordre libre entre eux (choix).
const ORDERS: Record<string, string[][]> = {
  'w:sectPr': [
    ['w:headerReference', 'w:footerReference'], ['w:footnotePr'], ['w:endnotePr'], ['w:type'], ['w:pgSz'], ['w:pgMar'], ['w:paperSrc'],
    ['w:pgBorders'], ['w:lnNumType'], ['w:pgNumType'], ['w:cols'], ['w:formProt'], ['w:vAlign'], ['w:noEndnote'], ['w:titlePg'],
    ['w:textDirection'], ['w:bidi'], ['w:rtlGutter'], ['w:docGrid'], ['w:printerSettings'], ['w:sectPrChange'],
  ],
  'w:numPr': [['w:ilvl'], ['w:numId'], ['w:numberingChange'], ['w:ins']],
  'w:pPr': [
    'pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr sectPr pPrChange',
  ][0]
    .split(' ')
    .map((n) => [`w:${n}`]),
  // CT_RPr / CT_ParaRPr : rFonts ajouté après sz (patchStyleElement, moteur) rendrait le style invalide pour Word.
  'w:rPr': (
    'ins del moveFrom moveTo rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish ' +
    'webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath rPrChange'
  )
    .split(' ')
    .map((n) => [`w:${n}`]),
  'w:tblPr': 'tblStyle tblpPr tblOverlap bidiVisual tblStyleRowBandSize tblStyleColBandSize tblW jc tblCellSpacing tblInd tblBorders shd tblLayout tblCellMar tblLook tblCaption tblDescription tblPrChange'
    .split(' ')
    .map((n) => [`w:${n}`]),
  'w:tblBorders': [['w:top'], ['w:start', 'w:left'], ['w:bottom'], ['w:end', 'w:right'], ['w:insideH'], ['w:insideV']],
  'w:tcBorders': [['w:top'], ['w:start', 'w:left'], ['w:bottom'], ['w:end', 'w:right'], ['w:insideH'], ['w:insideV'], ['w:tl2br'], ['w:tr2bl']],
  'w:tcPr': [
    ...'cnfStyle tcW gridSpan hMerge vMerge tcBorders shd noWrap tcMar textDirection tcFitText vAlign hideMark headers'.split(' ').map((n) => [`w:${n}`]),
    ['w:cellIns', 'w:cellDel', 'w:cellMerge'],
    ['w:tcPrChange'],
  ],
  'w:style': 'name aliases basedOn next link autoRedefine hidden uiPriority semiHidden unhideWhenUsed qFormat locked personal personalCompose personalReply rsid pPr rPr tblPr trPr tcPr tblStylePr'
    .split(' ')
    .map((n) => [`w:${n}`]),
  'w:lvl': 'start numFmt lvlRestart pStyle isLgl suff lvlText lvlPicBulletId legacy lvlJc pPr rPr'.split(' ').map((n) => [`w:${n}`]),
  'w:abstractNum': 'nsid multiLevelType tmpl name styleLink numStyleLink lvl'.split(' ').map((n) => [`w:${n}`]),
  'a:xfrm': [['a:off'], ['a:ext']],
  'w:settings': (
    'writeProtection view zoom removePersonalInformation removeDateAndTime doNotDisplayPageBoundaries displayBackgroundShape printPostScriptOverText ' +
    'printFractionalCharacterWidth printFormsData embedTrueTypeFonts embedSystemFonts saveSubsetFonts saveFormsData mirrorMargins alignBordersAndEdges ' +
    'bordersDoNotSurroundHeader bordersDoNotSurroundFooter gutterAtTop hideSpellingErrors hideGrammaticalErrors activeWritingStyle proofState formsDesign ' +
    'attachedTemplate linkStyles stylePaneFormatFilter stylePaneSortMethod documentType mailMerge revisionView trackRevisions doNotTrackMoves ' +
    'doNotTrackFormatting documentProtection autoFormatOverride styleLockTheme styleLockQFSet defaultTabStop autoHyphenation consecutiveHyphenLimit ' +
    'hyphenationZone doNotHyphenateCaps showEnvelope summaryLength clickAndTypeStyle defaultTableStyle evenAndOddHeaders bookFoldRevPrinting ' +
    'bookFoldPrinting bookFoldPrintingSheets drawingGridHorizontalSpacing drawingGridVerticalSpacing displayHorizontalDrawingGridEvery ' +
    'displayVerticalDrawingGridEvery doNotUseMarginsForDrawingGridOrigin drawingGridHorizontalOrigin drawingGridVerticalOrigin doNotShadeFormData ' +
    'noPunctuationKerning characterSpacingControl printTwoOnOne strictFirstAndLastChars noLineBreaksAfter noLineBreaksBefore savePreviewPicture ' +
    'doNotValidateAgainstSchema saveInvalidXml ignoreMixedContent alwaysShowPlaceholderText doNotDemarcateInvalidXml saveXmlDataOnly useXSLTWhenSaving ' +
    'saveThroughXslt showXMLTags alwaysMergeEmptyNamespace updateFields hdrShapeDefaults footnotePr endnotePr compat docVars rsids m:mathPr ' +
    'attachedSchema themeFontLang clrSchemeMapping doNotIncludeSubdocsInStats doNotAutoCompressPictures forceUpgrade captions readModeInkLockDown ' +
    'smartTagType sl:schemaLibrary shapeDefaults doNotEmbedSmartTags decimalSymbol listSeparator'
  )
    .split(' ')
    .map((n) => [n.includes(':') ? n : `w:${n}`]),
};
const RANKS: Record<string, Map<string, number>> = Object.fromEntries(
  Object.entries(ORDERS).map(([k, groups]) => {
    const m = new Map<string, number>();
    groups.forEach((g, i) => g.forEach((n) => m.set(n, i)));
    return [k, m];
  }),
);

// ── Mini-analyseur : arbre des éléments avec leurs positions ──
interface XNode {
  name: string;
  start: number;
  openEnd: number;
  /** début de la balise fermante (= end si auto-fermante) */
  closeStart: number;
  end: number;
  children: XNode[];
  parent: XNode | null;
  dirty: boolean;
  reorder: boolean;
}
const TOKEN_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z_][^\s/>]*(?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?>/g;

function parseTree(xml: string): XNode | null {
  const doc: XNode = { name: '#doc', start: 0, openEnd: 0, closeStart: xml.length, end: xml.length, children: [], parent: null, dirty: false, reorder: false };
  const stack: XNode[] = [doc];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(xml))) {
    const t = m[0];
    if (t[1] === '!' || t[1] === '?') continue;
    if (t[1] === '/') {
      const name = t.slice(2, -1).trim();
      const top = stack.pop();
      if (!top || top.name !== name) return null; // XML incohérent : on ne touche à rien
      top.closeStart = m.index;
      top.end = m.index + t.length;
      continue;
    }
    const name = /^<([^\s/>]+)/.exec(t)![1];
    const parent = stack[stack.length - 1];
    const node: XNode = { name, start: m.index, openEnd: m.index + t.length, closeStart: m.index + t.length, end: m.index + t.length, children: [], parent, dirty: false, reorder: false };
    parent.children.push(node);
    if (!t.endsWith('/>')) stack.push(node);
  }
  return stack.length === 1 ? doc : null;
}

function markDirty(n: XNode) {
  for (let p: XNode | null = n; p && !p.dirty; p = p.parent) p.dirty = true;
}

/** Rangs de tri stables : un enfant inconnu suit l'enfant connu qui le précède. */
function ranks(node: XNode): number[] | null {
  const table = RANKS[node.name];
  if (!table) return null;
  let last = -1;
  return node.children.map((c) => {
    const r = table.get(c.name);
    if (r !== undefined) last = r;
    return last;
  });
}

function emit(xml: string, n: XNode): string {
  if (!n.dirty) return xml.slice(n.start, n.end);
  const open = n.name === '#doc' ? '' : xml.slice(n.start, n.openEnd);
  const close = n.name === '#doc' ? '' : xml.slice(n.closeStart, n.end);
  let inner = '';
  let pos = n.openEnd;
  if (n.reorder) {
    const rk = ranks(n)!;
    const idx = n.children.map((_, i) => i).sort((a, b) => rk[a] - rk[b] || a - b);
    inner = idx.map((i) => emit(xml, n.children[i])).join('');
  } else {
    for (const c of n.children) {
      inner += xml.slice(pos, c.start) + emit(xml, c);
      pos = c.end;
    }
    inner += xml.slice(pos, n.closeStart);
  }
  return open + inner + close;
}

/** Remet les enfants dans l'ordre du schéma ; renvoie la chaîne d'origine si rien ne change. */
export function reorderXml(xml: string): string {
  const doc = parseTree(xml);
  if (!doc) return xml;
  let changed = false;
  const walk = (n: XNode) => {
    const rk = ranks(n);
    if (rk && rk.some((r, i) => i > 0 && r < rk[i - 1])) {
      // contenu mixte (texte entre les enfants) : on ne réordonne pas
      let pos = n.openEnd;
      let mixed = false;
      for (const c of n.children) {
        if (xml.slice(pos, c.start).trim()) mixed = true;
        pos = c.end;
      }
      if (!mixed) {
        n.reorder = true;
        markDirty(n);
        changed = true;
      }
    }
    n.children.forEach(walk);
  };
  walk(doc);
  return changed ? emit(xml, doc) : xml;
}

// ── Espaces de noms ──
const TAG_RE = /<([A-Za-z_][^\s/>]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g;
const ATTR_RE = /\s([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function fixNamespaces(xml: string): string {
  TAG_RE.lastIndex = 0;
  const first = /<([A-Za-z_][^\s/>]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(xml.replace(/^(?:\s*<\?[\s\S]*?\?>|\s*<!--[\s\S]*?-->)*/, (s) => ' '.repeat(s.length)));
  if (!first) return xml;
  const rootStart = first.index;
  const rootTag = first[0];
  const declared = new Set<string>();
  let defaultNs = false;
  for (const a of rootTag.matchAll(ATTR_RE)) {
    if (a[1].startsWith('xmlns:')) declared.add(a[1].slice(6));
    if (a[1] === 'xmlns') defaultNs = true;
  }
  void defaultNs;
  const used = new Set<string>();
  const localDecl = new Set<string>();
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(xml))) {
    const p = m[1].indexOf(':');
    if (p > 0) used.add(m[1].slice(0, p));
    for (const a of m[2].matchAll(ATTR_RE)) {
      const n = a[1];
      if (n.startsWith('xmlns:')) {
        localDecl.add(n.slice(6));
        continue;
      }
      const q = n.indexOf(':');
      if (q > 0 && n !== 'xmlns') used.add(n.slice(0, q));
    }
  }
  used.delete('xml');
  used.delete('xmlns');
  const add: string[] = [];
  for (const p of used) if (!declared.has(p) && KNOWN_NS[p]) add.push(p);
  // mc:Ignorable : chaque préfixe cité doit être déclaré
  let newRoot = rootTag;
  const ign = /\smc:Ignorable\s*=\s*"([^"]*)"/.exec(rootTag);
  if (ign) {
    const keep: string[] = [];
    for (const p of ign[1].split(/\s+/).filter(Boolean)) {
      if (declared.has(p) || add.includes(p)) keep.push(p);
      else if (KNOWN_NS[p]) {
        add.push(p);
        keep.push(p);
      }
    }
    if (keep.join(' ') !== ign[1]) newRoot = newRoot.replace(ign[0], keep.length ? ` mc:Ignorable="${keep.join(' ')}"` : '');
  }
  if (!add.length && newRoot === rootTag) return xml;
  const decl = [...new Set(add)].map((p) => ` xmlns:${p}="${KNOWN_NS[p]}"`).join('');
  newRoot = newRoot.replace(/^(<[^\s/>]+)/, `$1${decl}`);
  return xml.slice(0, rootStart) + newRoot + xml.slice(rootStart + rootTag.length);
}

// ── Attributs ──
const COMMENT_ATTRS = new Set(['w:id', 'w:author', 'w:date', 'w:initials']);
export function fixAttributes(xml: string): string {
  let out = xml.replace(/\sw:authorEmail\s*=\s*"[^"]*"/g, '');
  // w:comment : uniquement les attributs du schéma (SuperDoc ajoute internalId, email, trackedChange…)
  out = out.replace(/<w:comment\b([^>]*)>/g, (all, attrs: string) => {
    // (attributs internes parfois écrits sous un préfixe lié à l'espace w, ex. custom:internalId)
    const kept = [...attrs.matchAll(ATTR_RE)].filter((a) => COMMENT_ATTRS.has(a[1]) || a[1] === 'xmlns' || a[1].startsWith('xmlns:'));
    const selfClose = /\/\s*$/.test(attrs);
    return `<w:comment${kept.map((a) => a[0]).join('')}${selfClose ? '/' : ''}>`;
  });
  // w:annotationRef : un seul par paragraphe de commentaire (SuperDoc en rajoute un à chaque
  // aller-retour : réimporté comme contenu, puis réécrit)
  if (out.includes('<w:annotationRef')) {
    const REF_RUN = /<w:r>(?:<w:rPr>(?:(?!<\/w:rPr>).)*<\/w:rPr>)?<w:annotationRef\s*\/><\/w:r>/;
    const dup = new RegExp(`(${REF_RUN.source})(?:\\s*${REF_RUN.source})+`, 'g');
    out = out.replace(dup, '$1');
  }
  // w:shd exige w:val
  out = out.replace(/<w:shd\b(?![^>]*\sw:val=)([^>]*?)(\/?)>/g, '<w:shd w:val="clear"$1$2>');
  // Images flottantes (wp:anchor) : attributs obligatoires manquants, positions vides
  out = out.replace(/<wp:anchor\b([^>]*)>/g, (all, attrs: string) => {
    const need: [string, string][] = [['simplePos', '0'], ['relativeHeight', '0'], ['behindDoc', '0'], ['locked', '0'], ['layoutInCell', '1'], ['allowOverlap', '1']];
    const add = need.filter(([k]) => !new RegExp(`\\s${k}\\s*=`).test(attrs)).map(([k, v]) => ` ${k}="${v}"`).join('');
    return add ? `<wp:anchor${add}${attrs}>` : all;
  });
  out = out.replace(/<wp:(wrapSquare|wrapTight|wrapThrough)\b(?![^>]*\swrapText=)/g, '<wp:$1 wrapText="bothSides"');
  out = out.replace(/<wp:(positionH|positionV)\b([^>]*?)\s*\/>/g, '<wp:$1$2><wp:posOffset>0</wp:posOffset></wp:$1>');
  // w:nsid : 8 chiffres hexadécimaux
  out = out.replace(/(<w:nsid\s+w:val=")([0-9A-Fa-f]{1,7})(")/g, (_a, p: string, v: string, s: string) => p + v.toUpperCase().padStart(8, '0') + s);
  return out;
}

/** paraId / textId < 0x80000000, durableId < 0x7FFFFFFF ; correspondance conservée entre parties. */
function fixIds(parts: Map<string, string>): void {
  const PARA = /(\s(?:w14:paraId|w15:paraId|w15:paraIdParent|w16cid:paraId)\s*=\s*")([0-9A-Fa-f]{1,8})(")/g;
  const TEXT = /(\sw14:textId\s*=\s*")([0-9A-Fa-f]{1,8})(")/g;
  const DUR = /(\s(?:w16cid:durableId|w16cex:durableId)\s*=\s*")([0-9A-Fa-f]{1,8})(")/g;
  const remap = (re: RegExp, limit: number, skip?: (name: string) => boolean) => {
    const all = new Set<number>();
    for (const [n, x] of parts) if (!skip?.(n)) for (const m of x.matchAll(re)) all.add(parseInt(m[2], 16));
    const map = new Map<number, number>();
    for (const v of all) {
      if (v < limit && v > 0) continue;
      let nv = (v & (limit - 1)) || 1;
      while (all.has(nv) || [...map.values()].includes(nv)) nv = (nv + 1) % limit || 1;
      map.set(v, nv);
    }
    if (!map.size) return;
    for (const [n, x] of parts) {
      if (skip?.(n)) continue;
      parts.set(
        n,
        x.replace(re, (all0, a: string, v: string, b: string) => {
          const nv = map.get(parseInt(v, 16));
          return nv === undefined ? all0 : a + nv.toString(16).toUpperCase().padStart(8, '0') + b;
        }),
      );
    }
  };
  remap(PARA, 0x80000000);
  remap(TEXT, 0x80000000);
  // numbering.xml : durableId décimal (non traité ici, laissé tel quel)
  remap(DUR, 0x7fffffff, (n) => n === 'word/numbering.xml');
}

// ── Table des matières ──
const TOC_STYLES: Record<string, string> = {
  TOCHeading:
    '<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>',
  TOC1: '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:before="120" w:after="60"/><w:ind w:left="0" w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>',
  TOC2: '<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="60"/><w:ind w:left="284" w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>',
  TOC3: '<w:style w:type="paragraph" w:styleId="TOC3"><w:name w:val="toc 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="60"/><w:ind w:left="567" w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>',
  Hyperlink:
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="1F4E9A"/><w:u w:val="single"/></w:rPr></w:style>',
  Caption:
    '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="35"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:spacing w:before="60" w:after="200"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:iCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>',
};
export function styleDefinition(id: string): string | null {
  return TOC_STYLES[id] ?? null;
}

/** Ajoute à styles.xml les styles référencés par le document mais absents (TOC1-3, Hyperlink, Caption). */
export function addMissingStyles(stylesXml: string, docXml: string): string {
  let out = stylesXml;
  for (const id of Object.keys(TOC_STYLES)) {
    const used = new RegExp(`<w:(?:pStyle|rStyle)\\s+w:val="${id}"`).test(docXml);
    if (!used) continue;
    if (new RegExp(`<w:style\\b[^>]*w:styleId="${id}"`).test(out)) continue;
    out = out.replace(/<\/w:styles>\s*$/, `${TOC_STYLES[id]}</w:styles>`);
  }
  return out;
}

/** Largeur du texte (twips) d'après le dernier sectPr du corps. */
export function textWidth(docXml: string): number | null {
  const all = docXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g);
  const s = all?.[all.length - 1];
  if (!s) return null;
  const w = Number(/<w:pgSz\b[^>]*\sw:w="(\d+)"/.exec(s)?.[1]);
  const l = Number(/<w:pgMar\b[^>]*\sw:left="(-?\d+)"/.exec(s)?.[1] ?? 0);
  const r = Number(/<w:pgMar\b[^>]*\sw:right="(-?\d+)"/.exec(s)?.[1] ?? 0);
  const g = Number(/<w:pgMar\b[^>]*\sw:gutter="(-?\d+)"/.exec(s)?.[1] ?? 0);
  return w > 0 ? w - l - r - g : null;
}

/** Tabulations des lignes de table des matières ramenées dans la largeur du texte. */
export function fixTocTabs(docXml: string): string {
  const tw = textWidth(docXml);
  if (!tw || !/<w:pStyle\s+w:val="TOC\d"/.test(docXml)) return docXml;
  return docXml.replace(/<w:pPr>(?:(?!<\/w:pPr>)[\s\S])*?<w:pStyle\s+w:val="TOC\d"[\s\S]*?<\/w:pPr>/g, (ppr) =>
    ppr.replace(/(<w:tab\b[^>]*\sw:pos=")(\d+)(")/g, (all, a: string, v: string, b: string) => (Number(v) > tw ? `${a}${tw}${b}` : all)),
  );
}

// ── Table des polices ──
const SANS_FONT = /sans|arial|helvetica|verdana|tahoma|calibri|segoe|avenir|futura|gill|optima|grotesk|\binter\b|roboto|lato|frutiger|myriad|trebuchet|gothic|franklin|aptos|candara|corbel/i;
const MONO_FONT = /mono|courier|consolas|menlo|monaco|\bcode\b|typewriter/i;
const SCRIPT_FONT = /caveat|script|brush|handwrit|comic/i;
/** Remplaçantes déclarées (w:altName) des polices fournies avec l'app. */
const FONT_ALT: Record<string, string> = { Literata: 'Georgia', 'Instrument Serif': 'Georgia', Caveat: 'Comic Sans MS' };

/** Polices nommées (w:ascii / w:hAnsi) dans des parties XML. */
export function referencedFonts(xmls: string[]): string[] {
  const set = new Set<string>();
  for (const x of xmls) for (const m of x.matchAll(/<w:rFonts\b[^>]*>/g)) for (const a of m[0].matchAll(/\sw:(?:ascii|hAnsi)="([^"]+)"/g)) set.add(a[1].replace(/&amp;/g, '&'));
  return [...set];
}

/**
 * Ajoute à fontTable.xml les polices employées qui n'y figurent pas, avec leur famille (roman, swiss…) :
 * un Word où elles manquent les remplace alors par une police de même genre. Chaîne inchangée sinon.
 */
export function completeFontTable(fontXml: string, fonts: string[]): string {
  const have = new Set([...fontXml.matchAll(/<w:font\b[^>]*\sw:name="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')));
  const add = fonts.filter((f) => f && !have.has(f));
  if (!add.length || !/<\/w:fonts>\s*$/.test(fontXml)) return fontXml;
  const el = add
    .map((f) => {
      const fam = MONO_FONT.test(f) ? 'modern' : SCRIPT_FONT.test(f) ? 'script' : SANS_FONT.test(f) ? 'swiss' : 'roman';
      const alt = FONT_ALT[f];
      return `<w:font w:name="${escAttr(f)}">${alt ? `<w:altName w:val="${alt}"/>` : ''}<w:charset w:val="00"/><w:family w:val="${fam}"/><w:pitch w:val="${fam === 'modern' ? 'fixed' : 'variable'}"/></w:font>`;
    })
    .join('');
  return fontXml.replace(/<\/w:fonts>\s*$/, `${el}</w:fonts>`);
}

// ── Point d'entrée ──
const XML_PART = /^(word\/(?:[^/]+|_rels\/[^/]+)\.(?:xml|rels)|\[Content_Types\]\.xml|docProps\/[^/]+\.xml|_rels\/\.rels|customXml\/[^/]+\.xml)$/;

/** Normalise un .docx exporté. Renvoie les octets d'origine si rien n'est à corriger. */
export async function normalizeDocx(data: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(data);
  const parts = new Map<string, string>();
  for (const n of Object.keys(zip.files)) if (!zip.files[n].dir && /^word\/[^/]+\.xml$/.test(n)) parts.set(n, await zip.file(n)!.async('string'));
  const orig = new Map(parts);
  for (const [n, x] of parts) parts.set(n, fixAttributes(x));
  fixIds(parts);
  const doc = parts.get('word/document.xml');
  if (doc) {
    parts.set('word/document.xml', fixTocTabs(doc));
    const st = parts.get('word/styles.xml');
    if (st) parts.set('word/styles.xml', addMissingStyles(st, doc + [...parts].filter(([k]) => /footer|header/.test(k)).map(([, v]) => v).join('')));
  }
  const ft = parts.get('word/fontTable.xml');
  if (ft) {
    const used = referencedFonts([...parts].filter(([k]) => /^word\/(document|styles|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(k)).map(([, v]) => v));
    parts.set('word/fontTable.xml', completeFontTable(ft, used));
  }
  for (const [n, x] of parts) parts.set(n, fixNamespaces(reorderXml(x)));
  let changed = false;
  for (const [n, x] of parts) {
    if (x !== orig.get(n)) {
      zip.file(n, x);
      changed = true;
    }
  }
  if (!changed) return data;
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', mimeType: DOCX_MIME });
}

/** Parties XML mal formées (vide = tout est lisible). Navigateur uniquement (DOMParser). */
export async function checkDocxXml(data: ArrayBuffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(data);
  const bad: string[] = [];
  for (const n of Object.keys(zip.files)) {
    if (zip.files[n].dir || !XML_PART.test(n)) continue;
    const x = await zip.file(n)!.async('string');
    const d = new DOMParser().parseFromString(x, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) bad.push(n);
  }
  return bad;
}

// ── Modifier un style (styles.xml) ──
export interface StylePatch {
  /** Nom de police (famille). */
  fontFamily?: string;
  /** Taille en points. */
  fontSize?: number;
  /** Interligne multiple (1, 1.15, 1.5, 2…). */
  lineSpacing?: number;
  align?: 'left' | 'center' | 'right' | 'both';
  /** Alinéa (retrait de 1re ligne) en twips ; 0 = aucun. */
  firstLine?: number;
  /** Espacements avant / après en twips. */
  before?: number;
  after?: number;
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Remplace (ou ajoute) l'élément `tag` dans le conteneur `inner` (contenu de pPr / rPr). */
function setChild(inner: string, tag: string, el: string | null): string {
  const re = new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`, 'g');
  const had = re.test(inner);
  re.lastIndex = 0;
  if (had) return inner.replace(re, () => el ?? '');
  return el ? inner + el : inner;
}
function attrsOf(el: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!el) return out;
  for (const a of el.matchAll(ATTR_RE)) out[a[1]] = a[2] ?? a[3] ?? '';
  return out;
}
function mkEl(tag: string, attrs: Record<string, string | number | undefined>): string {
  const s = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${escAttr(String(v))}"`)
    .join('');
  return `<${tag}${s}/>`;
}

/** Applique `patch` à un élément <w:style> (chaîne) ; l'ordre des enfants est corrigé ensuite par reorderXml. */
export function patchStyleElement(styleXml: string, patch: StylePatch): string {
  const selfClosing = /^<w:style\b[^>]*\/>$/.test(styleXml);
  let s = selfClosing ? styleXml.replace(/\/>$/, '></w:style>') : styleXml;
  const getBlock = (tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>|<${tag}/>`).exec(s);
  // pPr
  const needP = patch.lineSpacing !== undefined || patch.align || patch.firstLine !== undefined || patch.before !== undefined || patch.after !== undefined;
  if (needP) {
    const b = getBlock('w:pPr');
    let inner = b?.[1] ?? '';
    if (patch.lineSpacing !== undefined || patch.before !== undefined || patch.after !== undefined) {
      const cur = attrsOf(/<w:spacing\b[^>]*\/?>/.exec(inner)?.[0]);
      if (patch.lineSpacing !== undefined) {
        cur['w:line'] = String(Math.round(patch.lineSpacing * 240));
        cur['w:lineRule'] = 'auto';
      }
      if (patch.before !== undefined) {
        cur['w:before'] = String(Math.round(patch.before));
        delete cur['w:beforeLines'];
        delete cur['w:beforeAutospacing'];
      }
      if (patch.after !== undefined) {
        cur['w:after'] = String(Math.round(patch.after));
        delete cur['w:afterLines'];
        delete cur['w:afterAutospacing'];
      }
      inner = setChild(inner, 'w:spacing', mkEl('w:spacing', cur));
    }
    if (patch.firstLine !== undefined) {
      const cur = attrsOf(/<w:ind\b[^>]*\/?>/.exec(inner)?.[0]);
      delete cur['w:hanging'];
      delete cur['w:hangingChars'];
      delete cur['w:firstLineChars'];
      cur['w:firstLine'] = String(Math.max(0, Math.round(patch.firstLine)));
      inner = setChild(inner, 'w:ind', mkEl('w:ind', cur));
    }
    if (patch.align) inner = setChild(inner, 'w:jc', mkEl('w:jc', { 'w:val': patch.align }));
    const block = `<w:pPr>${inner}</w:pPr>`;
    s = b ? s.replace(b[0], () => block) : s.replace(/<\/w:style>$/, () => block + '</w:style>');
  }
  if (patch.fontFamily || patch.fontSize) {
    const b = getBlock('w:rPr');
    let inner = b?.[1] ?? '';
    if (patch.fontFamily) {
      const f = patch.fontFamily;
      // attributs de thème retirés : dans Word, le thème l'emporterait sur w:ascii
      inner = setChild(inner, 'w:rFonts', mkEl('w:rFonts', { 'w:ascii': f, 'w:hAnsi': f, 'w:eastAsia': f, 'w:cs': f }));
    }
    if (patch.fontSize) {
      const hp = Math.round(patch.fontSize * 2);
      inner = setChild(inner, 'w:sz', mkEl('w:sz', { 'w:val': hp }));
      inner = setChild(inner, 'w:szCs', mkEl('w:szCs', { 'w:val': hp }));
    }
    const block = `<w:rPr>${inner}</w:rPr>`;
    s = b ? s.replace(b[0], () => block) : s.replace(/<\/w:style>$/, () => block + '</w:style>');
  }
  return s;
}

/**
 * Modifie les styles `ids` dans styles.xml (ajoute d'abord ceux qui manquent si une définition
 * est fournie). Les styles inconnus sans définition sont ignorés.
 */
export function patchStylesXml(stylesXml: string, ids: string[], patch: StylePatch, defs: Record<string, string> = {}): string {
  let out = stylesXml;
  for (const id of ids) {
    const re = new RegExp(`<w:style\\b[^>]*\\sw:styleId="${id}"[^>]*?(?:/>|>[\\s\\S]*?</w:style>)`);
    if (!re.test(out)) {
      const def = defs[id];
      if (!def) continue;
      out = out.replace(/<\/w:styles>\s*$/, `${def}</w:styles>`);
    }
    out = out.replace(re, (st) => patchStyleElement(st, patch));
  }
  return reorderXml(out);
}

/** Ajoute des styles (définitions XML complètes) s'ils manquent. */
export function ensureStylesXml(stylesXml: string, defs: Record<string, string>): string {
  let out = stylesXml;
  for (const [id, def] of Object.entries(defs)) {
    if (new RegExp(`<w:style\\b[^>]*\\sw:styleId="${id}"`).test(out)) continue;
    out = out.replace(/<\/w:styles>\s*$/, `${def}</w:styles>`);
  }
  return out;
}

/** Applique `fn` à word/styles.xml d'un paquet .docx. */
export async function transformStyles(data: ArrayBuffer, fn: (stylesXml: string) => string): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(data);
  const f = zip.file('word/styles.xml');
  if (!f) throw new Error('styles.xml absent');
  const x = await f.async('string');
  const y = fn(x);
  if (y === x) return data;
  zip.file('word/styles.xml', y);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', mimeType: DOCX_MIME });
}

/** Lit les propriétés effectives (simples) d'un style, pour préremplir le dialogue « Modifier le style ». */
export function readStyleProps(stylesXml: string, id: string): StylePatch & { exists: boolean } {
  const st = new RegExp(`<w:style\\b[^>]*\\sw:styleId="${id}"[^>]*?(?:/>|>[\\s\\S]*?</w:style>)`).exec(stylesXml)?.[0];
  if (!st) return { exists: false };
  const rf = attrsOf(/<w:rFonts\b[^>]*\/?>/.exec(st)?.[0]);
  const sz = attrsOf(/<w:sz\b[^>]*\/?>/.exec(st)?.[0])['w:val'];
  const sp = attrsOf(/<w:spacing\b[^>]*\/?>/.exec(/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(st)?.[0] ?? '')?.[0]);
  const ind = attrsOf(/<w:ind\b[^>]*\/?>/.exec(st)?.[0]);
  const jc = attrsOf(/<w:jc\b[^>]*\/?>/.exec(st)?.[0])['w:val'];
  return {
    exists: true,
    fontFamily: rf['w:ascii'] || rf['w:hAnsi'] || undefined,
    fontSize: sz ? Number(sz) / 2 : undefined,
    lineSpacing: sp['w:line'] && (sp['w:lineRule'] ?? 'auto') === 'auto' ? Number(sp['w:line']) / 240 : undefined,
    before: sp['w:before'] ? Number(sp['w:before']) : undefined,
    after: sp['w:after'] ? Number(sp['w:after']) : undefined,
    firstLine: ind['w:firstLine'] ? Number(ind['w:firstLine']) : undefined,
    align: (jc as StylePatch['align']) || undefined,
  };
}

/** Propriétés effectives d'un style : chaîne basedOn puis docDefaults (valeurs simples). */
export function effectiveStyleProps(stylesXml: string, id: string | null): StylePatch {
  const out: StylePatch = {};
  const fill = (p: StylePatch) => {
    for (const k of Object.keys(p) as (keyof StylePatch)[]) if (out[k] === undefined && p[k] !== undefined) (out as Record<string, unknown>)[k] = p[k];
  };
  const seen = new Set<string>();
  let cur: string | null = id ?? defaultParagraphStyle(stylesXml);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const p = readStyleProps(stylesXml, cur);
    if (!p.exists) break;
    fill(p);
    const st = new RegExp(`<w:style\\b[^>]*\\sw:styleId="${cur}"[^>]*?(?:/>|>[\\s\\S]*?</w:style>)`).exec(stylesXml)?.[0] ?? '';
    cur = /<w:basedOn\s+w:val="([^"]+)"/.exec(st)?.[1] ?? (cur !== defaultParagraphStyle(stylesXml) ? defaultParagraphStyle(stylesXml) : null);
  }
  const dd = /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(stylesXml)?.[0];
  if (dd) {
    const rf = attrsOf(/<w:rFonts\b[^>]*\/?>/.exec(dd)?.[0]);
    const sz = attrsOf(/<w:sz\b[^>]*\/?>/.exec(dd)?.[0])['w:val'];
    const sp = attrsOf(/<w:spacing\b[^>]*\/?>/.exec(/<w:pPrDefault>[\s\S]*?<\/w:pPrDefault>/.exec(dd)?.[0] ?? '')?.[0]);
    fill({
      fontFamily: rf['w:ascii'] || rf['w:hAnsi'] || undefined,
      fontSize: sz ? Number(sz) / 2 : undefined,
      lineSpacing: sp['w:line'] && (sp['w:lineRule'] ?? 'auto') === 'auto' ? Number(sp['w:line']) / 240 : undefined,
      before: sp['w:before'] ? Number(sp['w:before']) : undefined,
      after: sp['w:after'] ? Number(sp['w:after']) : undefined,
    });
  }
  return out;
}

/** Mise en forme des caractères d'un style de paragraphe (chaîne basedOn puis docDefaults) : gras, italique,
 *  taille (pt), police, couleur (hex sans #). Sert à reconnaître la mise en forme directe qui ne fait que
 *  répéter le style (héritée d'un titre par Entrée, par exemple). */
export function styleRunProps(stylesXml: string, id: string | null): { bold?: boolean; italic?: boolean; fontSize?: number; fontFamily?: string; color?: string } {
  const out: { bold?: boolean; italic?: boolean; fontSize?: number; fontFamily?: string; color?: string } = {};
  const onOff = (el: string | undefined) => {
    if (!el) return undefined;
    const v = attrsOf(el)['w:val'];
    return !(v === '0' || v === 'false' || v === 'off');
  };
  const read = (rPr: string) => {
    out.bold ??= onOff(/<w:b(?=[\s/>])[^>]*\/?>/.exec(rPr)?.[0]);
    out.italic ??= onOff(/<w:i(?=[\s/>])[^>]*\/?>/.exec(rPr)?.[0]);
    const sz = attrsOf(/<w:sz\b[^>]*\/?>/.exec(rPr)?.[0])['w:val'];
    if (out.fontSize === undefined && sz) out.fontSize = Number(sz) / 2;
    const rf = attrsOf(/<w:rFonts\b[^>]*\/?>/.exec(rPr)?.[0]);
    out.fontFamily ??= rf['w:ascii'] || rf['w:hAnsi'] || undefined;
    const c = attrsOf(/<w:color\b[^>]*\/?>/.exec(rPr)?.[0])['w:val'];
    if (out.color === undefined && c) out.color = c.toUpperCase();
  };
  const seen = new Set<string>();
  let cur: string | null = id ?? defaultParagraphStyle(stylesXml);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const st = new RegExp(`<w:style\\b[^>]*\\sw:styleId="${cur}"[^>]*?(?:/>|>[\\s\\S]*?</w:style>)`).exec(stylesXml)?.[0];
    if (!st) break;
    read(/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(st)?.[0] ?? '');
    cur = /<w:basedOn\s+w:val="([^"]+)"/.exec(st)?.[1] ?? (cur !== defaultParagraphStyle(stylesXml) ? defaultParagraphStyle(stylesXml) : null);
  }
  const dd = /<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/.exec(stylesXml)?.[0];
  if (dd) read(dd);
  return out;
}

/** Identifiant du style de paragraphe par défaut (w:default="1"), « Normal » le plus souvent. */
export function defaultParagraphStyle(stylesXml: string): string | null {
  const m = /<w:style\b(?=[^>]*\sw:type="paragraph")(?=[^>]*\sw:default="(?:1|true|on)")[^>]*\sw:styleId="([^"]+)"/.exec(stylesXml);
  return m?.[1] ?? (/w:styleId="Normal"/.test(stylesXml) ? 'Normal' : null);
}

/** Lit word/styles.xml d'un paquet. */
export async function readStylesXml(data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  return (await zip.file('word/styles.xml')?.async('string')) ?? '';
}

/** Remplace toute police de thème (asciiTheme…) de styles.xml par `font` (styles et docDefaults). */
export function replaceThemeFonts(stylesXml: string, font: string): string {
  const el = mkEl('w:rFonts', { 'w:ascii': font, 'w:hAnsi': font, 'w:eastAsia': font, 'w:cs': font });
  return stylesXml.replace(/<w:rFonts\b[^>]*\b(?:asciiTheme|hAnsiTheme)\s*=[^>]*?\/?>(?:<\/w:rFonts>)?/g, el);
}
