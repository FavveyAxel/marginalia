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
/** Texte d'un .docx (identifiant de style…) placé dans une expression régulière : rendu littéral. */
const rx = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const KNOWN_NS: Record<string, string> = {
  // docProps/core.xml
  cp: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  dcmitype: 'http://purl.org/dc/dcmitype/',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
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
// ── Recherches en temps linéaire (documents reçus) ──
// Les expressions de la forme /<tag\b[^>]*…[\s\S]*?<\/tag>/ retentent toute la suite du texte à chaque
// début possible : sur un .docx reçu fait de « <w:style w:styleId="X" » répétés sans « > », le coût
// devenait quadratique, voire cubique (32 k caractères : 5 s, onglet figé). Les fonctions ci-dessous
// rendent exactement les mêmes correspondances que les anciennes expressions (même découpage, même
// choix entre alternatives), mais à partir de listes de positions calculées une fois par indexOf et
// interrogées par dichotomie : plus aucun parcours ne recommence depuis chaque début.

const SPACE_RE = /\s/;
/** Même ensemble que \s (ASCII d'abord, sans expression pour les cas courants). */
const isSpace = (c: string) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || ((c > '~' || c === '\v' || c === '\f') && SPACE_RE.test(c));
const isWord = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_';
const isLetter = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

/** Indice du premier élément ≥ x d'une liste croissante (list.length si aucun). */
function lowerBound(list: readonly number[], x: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
/** Premier élément ≥ x, ou -1. */
const nextIn = (list: readonly number[], x: number) => {
  const k = lowerBound(list, x);
  return k < list.length ? list[k] : -1;
};

interface TagMatch {
  /** fin du nom (premier blanc, « / » ou « > » après lui) */
  nameEnd: number;
  /** fin de la suite d'attributs reconnus */
  attrsEnd: number;
  /** fin de la balise (après « > ») */
  end: number;
}

/** Positions des motifs d'une chaîne XML, calculées à la demande puis réutilisées. */
class XmlIndex {
  private lists = new Map<string, number[]>();
  private derived = new Map<string, unknown>();
  /** Suites d'attributs déjà lues : position → fin de balise (null : pas de balise). */
  readonly attrRuns = new Map<number, Omit<TagMatch, 'nameEnd'> | null>();
  constructor(readonly s: string) {}

  /** Positions croissantes de `needle`, chevauchements compris (comme des indexOf successifs). */
  all(needle: string): number[] {
    let l = this.lists.get(needle);
    if (!l) {
      l = [];
      for (let i = this.s.indexOf(needle); i >= 0; i = this.s.indexOf(needle, i + 1)) l.push(i);
      this.lists.set(needle, l);
    }
    return l;
  }
  /** Comme s.indexOf(needle, from). */
  next(needle: string, from: number): number {
    return nextIn(this.all(needle), from);
  }
  /** Valeur dérivée (liste filtrée…), calculée une fois. */
  cached<T>(key: string, make: () => T): T {
    if (!this.derived.has(key)) this.derived.set(key, make());
    return this.derived.get(key) as T;
  }
  /** Débuts de `open` (« <w:style »…) suivis d'une limite de mot, comme /<w:style\b/. */
  starts(open: string): number[] {
    return this.cached(`starts:${open}`, () => this.all(open).filter((i) => !isWord(this.s.charAt(i + open.length))));
  }
  /** Débuts de `open` suivis d'un blanc, de « / » ou de « > », comme /<w:b(?=[\s/>])/. */
  tagStarts(open: string): number[] {
    return this.cached(`tag:${open}`, () =>
      this.all(open).filter((i) => {
        const c = this.s.charAt(i + open.length);
        return c === '/' || c === '>' || isSpace(c);
      }),
    );
  }
  /** Occurrences de `needle` précédées d'un blanc (le \s des expressions « \sw:val= »). */
  spaced(needle: string): number[] {
    return this.cached(`sp:${needle}`, () => this.all(needle).filter((v) => isSpace(this.s.charAt(v - 1))));
  }
  /** Premier blanc, « / » ou « > » à partir de `from` (fin d'un nom de balise), ou -1. */
  nameStop(from: number): number {
    const l = this.cached('stops', () => {
      const out: number[] = [];
      for (let i = 0; i < this.s.length; i++) {
        const c = this.s[i];
        if (c === '/' || c === '>' || isSpace(c)) out.push(i);
      }
      return out;
    });
    return nextIn(l, from);
  }
  /**
   * Première balise `open` (limite de mot, ou « [\s/>] » si `tagEnd`) entière dans [from, to) : même
   * résultat que /<open\b[^>]*\/?>/ appliquée à s.slice(from, to).
   */
  firstTag(open: string, from = 0, to = this.s.length, tagEnd = false): [number, number] | null {
    const st = tagEnd ? this.tagStarts(open) : this.starts(open);
    const i = nextIn(st, from);
    if (i < 0 || i + open.length > to) return null;
    const g = this.next('>', i + open.length);
    // la première balise déborde : les suivantes aussi (leur « > » est le même ou plus loin)
    if (g < 0 || g + 1 > to) return null;
    return [i, g + 1];
  }
  /** Premier bloc open…close (le plus court) dans [from, to) : /<open>[\s\S]*?<close>/ sur la tranche. */
  block(open: string, close: string, from = 0, to = this.s.length): [number, number] | null {
    const i = this.next(open, from);
    if (i < 0 || i + open.length > to) return null;
    const j = this.next(close, i + open.length);
    if (j < 0 || j + close.length > to) return null;
    return [i, j + close.length];
  }
  /** attrsOf de la balise [start, end), mémorisé. */
  attrs(r: [number, number] | null): Record<string, string> {
    if (!r) return {};
    return this.cached(`attrs:${r[0]}:${r[1]}`, () => attrsOf(this.s.slice(r[0], r[1])));
  }

  /**
   * Élément <w:style> dont w:styleId vaut `id` : même résultat que
   * /<w:style\b[^>]*\sw:styleId="ID"[^>]*?(?:\/>|>[\s\S]*?<\/w:style>)/.
   */
  styleEl(id: string): [number, number] | null {
    return this.cached(`style:${id}`, () => {
      const needle = `w:styleId="${id}"`;
      const vs = this.spaced(needle);
      for (const i of this.starts('<w:style')) {
        const v = nextIn(vs, i + 9);
        if (v < 0) break; // plus aucun attribut après ce début, ni après les suivants
        const g0 = this.next('>', i + 8);
        if (g0 >= 0 && g0 < v) continue; // l'attribut n'est pas dans cette balise ouvrante
        const g = this.next('>', v + needle.length);
        if (g < 0) continue;
        if (this.s.charAt(g - 1) === '/') return [i, g + 1] as [number, number];
        const j = this.next('</w:style>', g + 1);
        if (j >= 0) return [i, j + 10] as [number, number];
      }
      return null;
    });
  }
  /** /<w:style\b[^>]*\sw:styleId="ID"/ (ou sans le blanc si `spaced` est faux) trouve-t-elle quelque chose ? */
  hasStyleOpen(id: string, spaced: boolean): boolean {
    const needle = `w:styleId="${id}"`;
    const vs = spaced ? this.spaced(needle) : this.all(needle);
    for (const i of this.starts('<w:style')) {
      const v = nextIn(vs, i + (spaced ? 9 : 8));
      if (v < 0) return false;
      const g0 = this.next('>', i + 8);
      if (g0 < 0 || g0 >= v) return true;
    }
    return false;
  }
  /** Premier /<w:basedOn\s+w:val="([^"]+)"/ dans [from, to) : la valeur, ou null. */
  basedOn(from: number, to: number): string | null {
    const cands = this.cached('basedOn', () => {
      const out: { p: number; v: number; q: number }[] = [];
      for (const p of this.all('<w:basedOn')) {
        let i = p + 10;
        if (!isSpace(this.s.charAt(i))) continue;
        while (isSpace(this.s.charAt(i))) i++;
        if (!this.s.startsWith('w:val="', i)) continue;
        const q = this.next('"', i + 7);
        if (q > i + 7) out.push({ p, v: i + 7, q });
      }
      return out;
    });
    const ps = this.cached('basedOnP', () => cands.map((c) => c.p));
    const c = cands[lowerBound(ps, from)];
    // les fins croissent avec les débuts : si la première déborde de l'élément, les suivantes aussi
    return c && c.q + 1 <= to ? this.s.slice(c.v, c.q) : null;
  }
}

/** Index de la dernière chaîne vue : les lectures de styles successives (dialogue, barre d'outils) le réutilisent. */
let lastIndex: XmlIndex | null = null;
function xmlIndex(s: string): XmlIndex {
  if (!lastIndex || lastIndex.s !== s) lastIndex = new XmlIndex(s);
  return lastIndex;
}

/**
 * Balise ouvrante (ou fermante si `slash`) commençant en p, selon la grammaire
 * <\/?[A-Za-z_][^\s/>]*(?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*\/?> — sans retour arrière : chaque
 * étape est déterministe, et la suite d'attributs lue depuis une position est mémorisée (des débuts
 * différents qui y retombent ne la relisent pas).
 */
function matchTag(x: XmlIndex, p: number, slash: boolean): TagMatch | null {
  const s = x.s;
  let q = p + 1;
  if (slash && s.charAt(q) === '/') q++;
  const c = s.charAt(q);
  if (!(isLetter(c) || c === '_')) return null;
  const nameEnd = x.nameStop(q + 1);
  if (nameEnd < 0) return null;
  const seen: number[] = [];
  let pos = nameEnd;
  let res: Omit<TagMatch, 'nameEnd'> | null | undefined;
  for (;;) {
    res = x.attrRuns.get(pos);
    if (res !== undefined) break;
    seen.push(pos);
    const n = attrAt(x, pos);
    if (n >= 0) {
      pos = n;
      continue;
    }
    // \s*\/?>
    let i = pos;
    while (isSpace(s.charAt(i))) i++;
    if (s.charAt(i) === '/') i++;
    res = s.charAt(i) === '>' ? { attrsEnd: pos, end: i + 1 } : null;
    break;
  }
  for (const v of seen) x.attrRuns.set(v, res);
  return res ? { nameEnd, ...res } : null;
}
/** Un attribut \s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*') en `pos` : sa fin, ou -1. */
function attrAt(x: XmlIndex, pos: number): number {
  const s = x.s;
  let i = pos;
  if (!isSpace(s.charAt(i))) return -1;
  while (isSpace(s.charAt(i))) i++;
  const n0 = i;
  for (let c = s.charAt(i); c !== '' && c !== '=' && c !== '/' && c !== '>' && !isSpace(c); c = s.charAt(++i));
  if (i === n0) return -1;
  while (isSpace(s.charAt(i))) i++;
  if (s.charAt(i) !== '=') return -1;
  i++;
  while (isSpace(s.charAt(i))) i++;
  const quote = s.charAt(i);
  if (quote !== '"' && quote !== "'") return -1;
  const k = x.next(quote, i + 1);
  return k < 0 ? -1 : k + 1;
}

/**
 * Jeton suivant (commentaire, CDATA, instruction, déclaration ou balise) à partir de `from` : même
 * découpage que l'expression globale
 * /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z_]…\/?>/g.
 */
function nextToken(x: XmlIndex, from: number): [number, number] | null {
  const s = x.s;
  for (let p = x.next('<', from); p >= 0; p = x.next('<', p + 1)) {
    const c1 = s.charAt(p + 1);
    let end = -1;
    if (c1 === '!') {
      let k = -1;
      if (s.startsWith('<!--', p)) k = x.next('-->', p + 4);
      else if (s.startsWith('<![CDATA[', p)) k = x.next(']]>', p + 9);
      if (k >= 0) end = k + 3;
      else {
        // commentaire ou CDATA non fermé : l'alternative <![^>]*> le prend jusqu'au premier « > »
        const g = x.next('>', p + 2);
        if (g >= 0) end = g + 1;
      }
    } else if (c1 === '?') {
      const k = x.next('?>', p + 2);
      if (k >= 0) end = k + 2;
    } else end = matchTag(x, p, true)?.end ?? -1;
    if (end >= 0) return [p, end];
  }
  return null;
}

function parseTree(xml: string): XNode | null {
  const doc: XNode = { name: '#doc', start: 0, openEnd: 0, closeStart: xml.length, end: xml.length, children: [], parent: null, dirty: false, reorder: false };
  const stack: XNode[] = [doc];
  const x = xmlIndex(xml);
  for (let tk = nextToken(x, 0); tk; tk = nextToken(x, tk[1])) {
    const [start, stop] = tk;
    const c1 = xml.charAt(start + 1);
    if (c1 === '!' || c1 === '?') continue;
    const t = xml.slice(start, stop);
    if (c1 === '/') {
      const name = t.slice(2, -1).trim();
      const top = stack.pop();
      if (!top || top.name !== name) return null; // XML incohérent : on ne touche à rien
      top.closeStart = start;
      top.end = stop;
      continue;
    }
    const name = /^<([^\s/>]+)/.exec(t)![1];
    const parent = stack[stack.length - 1];
    const node: XNode = { name, start, openEnd: stop, closeStart: stop, end: stop, children: [], parent, dirty: false, reorder: false };
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
const ATTR_RE = /\s([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function fixNamespaces(xml: string): string {
  // Racine : première balise après les instructions et commentaires de tête (même grammaire que l'ancienne
  // expression, parcourue par matchTag : linéaire même sur « <w:sectPr<w:sectPr… » sans fin).
  const blank = xml.replace(/^(?:\s*<\?[\s\S]*?\?>|\s*<!--[\s\S]*?-->)*/, (s) => ' '.repeat(s.length));
  const bx = blank === xml ? xmlIndex(xml) : new XmlIndex(blank);
  let first: TagMatch | null = null;
  let rootStart = -1;
  for (const p of bx.all('<')) {
    first = matchTag(bx, p, false);
    if (first) {
      rootStart = p;
      break;
    }
  }
  if (!first) return xml;
  const rootTag = blank.slice(rootStart, first.end);
  const declared = new Set<string>();
  let defaultNs = false;
  for (const a of rootTag.matchAll(ATTR_RE)) {
    if (a[1].startsWith('xmlns:')) declared.add(a[1].slice(6));
    if (a[1] === 'xmlns') defaultNs = true;
  }
  void defaultNs;
  const used = new Set<string>();
  const localDecl = new Set<string>();
  // Toutes les balises ouvrantes, dans l'ordre de l'ancienne expression globale (y compris celles des commentaires).
  const x = xmlIndex(xml);
  for (let p = x.next('<', 0); p >= 0; ) {
    const m = matchTag(x, p, false);
    if (!m) {
      p = x.next('<', p + 1);
      continue;
    }
    const name = xml.slice(p + 1, m.nameEnd);
    const pi = name.indexOf(':');
    if (pi > 0) used.add(name.slice(0, pi));
    for (const a of xml.slice(m.nameEnd, m.attrsEnd).matchAll(ATTR_RE)) {
      const n = a[1];
      if (n.startsWith('xmlns:')) {
        localDecl.add(n.slice(6));
        continue;
      }
      const q = n.indexOf(':');
      if (q > 0 && n !== 'xmlns') used.add(n.slice(0, q));
    }
    p = x.next('<', m.end);
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
  // attributs de la racine liés au même espace de noms sous deux préfixes (ex. mc:Ignorable et
  // ve:Ignorable, ve = markup-compatibility dans les vieux .docx) : doublon interdit en XML
  {
    const nsOf = new Map<string, string>();
    for (const a of rootTag.matchAll(ATTR_RE)) if (a[1].startsWith('xmlns:')) nsOf.set(a[1].slice(6), a[2] ?? a[3] ?? '');
    const seen = new Set<string>();
    for (const a of [...newRoot.matchAll(ATTR_RE)]) {
      const n = a[1];
      const q = n.indexOf(':');
      if (n.startsWith('xmlns') || q < 0) continue;
      const key = `${nsOf.get(n.slice(0, q)) ?? n.slice(0, q)}|${n.slice(q + 1)}`;
      if (seen.has(key)) newRoot = newRoot.replace(a[0], '');
      else seen.add(key);
    }
  }
  if (!add.length && newRoot === rootTag) return xml;
  const decl = [...new Set(add)].map((p) => ` xmlns:${p}="${KNOWN_NS[p]}"`).join('');
  newRoot = newRoot.replace(/^(<[^\s/>]+)/, `$1${decl}`);
  return xml.slice(0, rootStart) + newRoot + xml.slice(rootStart + rootTag.length);
}

// ── Attributs ──
/**
 * Remplace chaque balise ouvrante `open` (limite de mot) jusqu'à son premier « > » : même résultat que
 * s.replace(/<open\b([^>]*)>/g, fn), sans relire la suite du texte à chaque début quand « > » manque.
 */
function replaceOpenTags(s: string, open: string, fn: (all: string, attrs: string) => string): string {
  const x = new XmlIndex(s);
  let out = '';
  let last = 0;
  for (const i of x.starts(open)) {
    if (i < last) continue;
    const g = x.next('>', i + open.length);
    if (g < 0) break; // plus aucun « > » : ni cette balise ni les suivantes ne se ferment
    out += s.slice(last, i) + fn(s.slice(i, g + 1), s.slice(i + open.length, g));
    last = g + 1;
  }
  return last ? out + s.slice(last) : s;
}

/** Fin du run de marque de commentaire en p (ancienne REF_RUN), ou -1. */
function annotationRunEnd(x: XmlIndex, p: number): number {
  const s = x.s;
  if (!s.startsWith('<w:r>', p)) return -1;
  let q = p + 5;
  if (s.startsWith('<w:rPr>', q)) {
    // (?:(?!<\/w:rPr>).)* : jusqu'au premier </w:rPr>, sans franchir de fin de ligne
    const c = x.next('</w:rPr>', q + 7);
    if (c < 0) return -1;
    const nl = Math.min(...['\n', '\r', ' ', ' '].map((t) => x.next(t, q + 7)).filter((n) => n >= 0), Infinity);
    if (nl < c) return -1;
    q = c + 8;
  }
  if (!s.startsWith('<w:annotationRef', q)) return -1;
  q += 16;
  while (isSpace(s.charAt(q))) q++;
  return s.startsWith('/></w:r>', q) ? q + 8 : -1;
}

const COMMENT_ATTRS = new Set(['w:id', 'w:author', 'w:date', 'w:initials']);
export function fixAttributes(xml: string): string {
  let out = xml.replace(/\sw:authorEmail\s*=\s*"[^"]*"/g, '');
  // w:comment : uniquement les attributs du schéma (SuperDoc ajoute internalId, email, trackedChange…)
  out = replaceOpenTags(out, '<w:comment', (all, attrs) => {
    // (attributs internes parfois écrits sous un préfixe lié à l'espace w, ex. custom:internalId)
    const kept = [...attrs.matchAll(ATTR_RE)].filter((a) => COMMENT_ATTRS.has(a[1]) || a[1] === 'xmlns' || a[1].startsWith('xmlns:'));
    const selfClose = /\/\s*$/.test(attrs);
    return `<w:comment${kept.map((a) => a[0]).join('')}${selfClose ? '/' : ''}>`;
  });
  // w:annotationRef : un seul par paragraphe de commentaire (SuperDoc en rajoute un à chaque
  // aller-retour : réimporté comme contenu, puis réécrit). Même découpage que
  // /(REF_RUN)(?:\s*REF_RUN)+/g, en une passe.
  if (out.includes('<w:annotationRef')) {
    const x = new XmlIndex(out);
    let res = '';
    let last = 0;
    for (const p of x.all('<w:r>')) {
      if (p < last) continue;
      const e1 = annotationRunEnd(x, p);
      if (e1 < 0) continue;
      let e = e1;
      for (;;) {
        let q = e;
        while (isSpace(out.charAt(q))) q++;
        const e2 = annotationRunEnd(x, q);
        if (e2 < 0) break;
        e = e2;
      }
      if (e === e1) continue;
      res += out.slice(last, e1);
      last = e;
    }
    if (last) out = res + out.slice(last);
  }
  // w:shd exige w:val (ancienne /<w:shd\b(?![^>]*\sw:val=)([^>]*?)(\/?)>/g)
  {
    const x = new XmlIndex(out);
    const vals = x.spaced('w:val=');
    let res = '';
    let last = 0;
    for (const i of x.starts('<w:shd')) {
      if (i < last) continue;
      const g = x.next('>', i + 6);
      if (g < 0) break;
      const v = nextIn(vals, i + 7);
      if (v >= 0 && v < g) continue; // w:val déjà présent dans la balise
      res += out.slice(last, i) + '<w:shd w:val="clear"' + out.slice(i + 6, g) + '>';
      last = g + 1;
    }
    if (last) out = res + out.slice(last);
  }
  // Images flottantes (wp:anchor) : attributs obligatoires manquants, positions vides
  out = replaceOpenTags(out, '<wp:anchor', (all, attrs) => {
    const need: [string, string][] = [['simplePos', '0'], ['relativeHeight', '0'], ['behindDoc', '0'], ['locked', '0'], ['layoutInCell', '1'], ['allowOverlap', '1']];
    const add = need.filter(([k]) => !new RegExp(`\\s${k}\\s*=`).test(attrs)).map(([k, v]) => ` ${k}="${v}"`).join('');
    return add ? `<wp:anchor${add}${attrs}>` : all;
  });
  // wrapText manquant (ancienne /<wp:(wrapSquare|wrapTight|wrapThrough)\b(?![^>]*\swrapText=)/g)
  {
    const x = new XmlIndex(out);
    const wt = x.spaced('wrapText=');
    const hits = ['wrapSquare', 'wrapTight', 'wrapThrough'].flatMap((n) => x.starts(`<wp:${n}`).map((i) => [i, i + 4 + n.length] as const)).sort((a, b) => a[0] - b[0]);
    let res = '';
    let last = 0;
    for (const [i, nameEnd] of hits) {
      const g = x.next('>', nameEnd);
      const v = nextIn(wt, nameEnd + 1);
      if (v >= 0 && (g < 0 || v < g)) continue;
      res += out.slice(last, nameEnd) + ' wrapText="bothSides"';
      last = nameEnd;
    }
    if (last) out = res + out.slice(last);
  }
  // positions vides (ancienne /<wp:(positionH|positionV)\b([^>]*?)\s*\/>/g)
  {
    const x = new XmlIndex(out);
    const hits = ['positionH', 'positionV'].flatMap((n) => x.starts(`<wp:${n}`).map((i) => [i, n] as const)).sort((a, b) => a[0] - b[0]);
    let res = '';
    let last = 0;
    for (const [i, name] of hits) {
      if (i < last) continue;
      const nameEnd = i + 4 + name.length;
      const g = x.next('>', nameEnd);
      if (g < 0) break;
      if (out.charAt(g - 1) !== '/' || g - 1 < nameEnd) continue;
      let e = g - 1;
      while (e > nameEnd && isSpace(out.charAt(e - 1))) e--;
      res += out.slice(last, i) + `<wp:${name}${out.slice(nameEnd, e)}><wp:posOffset>0</wp:posOffset></wp:${name}>`;
      last = g + 1;
    }
    if (last) out = res + out.slice(last);
  }
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
    const taken = new Set<number>(); // valeurs déjà attribuées (un Set : pas de parcours de map à chaque essai)
    for (const v of all) {
      if (v < limit && v > 0) continue;
      let nv = (v & (limit - 1)) || 1;
      while (all.has(nv) || taken.has(nv)) nv = (nv + 1) % limit || 1;
      map.set(v, nv);
      taken.add(nv);
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
    const used = new RegExp(`<w:(?:pStyle|rStyle)\\s+w:val="${rx(id)}"`).test(docXml);
    if (!used) continue;
    if (xmlIndex(out).hasStyleOpen(id, false)) continue;
    out = out.replace(/<\/w:styles>\s*$/, `${TOC_STYLES[id]}</w:styles>`);
  }
  return out;
}

/** Largeur du texte (twips) d'après le dernier sectPr du corps. */
export function textWidth(docXml: string): number | null {
  // Dernier sectPr, trouvé par indexOf (même découpage que /<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, mais
  // en temps linéaire : pas d'expression à retour arrière sur un document reçu).
  let s: string | undefined;
  for (let pos = 0; ; ) {
    const i = docXml.indexOf('<w:sectPr', pos);
    if (i < 0) break;
    if (/\w/.test(docXml.charAt(i + 9))) {
      pos = i + 9;
      continue;
    }
    const j = docXml.indexOf('</w:sectPr>', i);
    if (j < 0) break;
    s = docXml.slice(i, j + 11);
    pos = j + 11;
  }
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
  // Blocs <w:pPr>…</w:pPr> dont le style est TOC1-9 : même découpage que
  // /<w:pPr>(?:(?!<\/w:pPr>)[\s\S])*?<w:pStyle\s+w:val="TOC\d"[\s\S]*?<\/w:pPr>/g, sans retenter la
  // suite du document depuis chaque <w:pPr> (cubique sur « <w:pPr><w:pStyle w:val="TOC1"/> » répété).
  const x = new XmlIndex(docXml);
  const tocs = [...docXml.matchAll(/<w:pStyle\s+w:val="TOC\d"/g)].map((m) => m.index);
  let out = '';
  let last = 0;
  for (const i of x.all('<w:pPr>')) {
    if (i < last) continue;
    const c = x.next('</w:pPr>', i + 7);
    const t = nextIn(tocs, i + 7);
    if (c < 0 || t < 0) break;
    if (t > c) continue; // le style TOC est après la fin de ce pPr
    out += docXml.slice(last, i) + fixTabPositions(docXml.slice(i, c + 8), tw);
    last = c + 8;
  }
  return out + docXml.slice(last);
}

/** Positions de tabulation > tw ramenées à tw : /(<w:tab\b[^>]*\sw:pos=")(\d+)(")/g, en une passe. */
function fixTabPositions(ppr: string, tw: number): string {
  const x = new XmlIndex(ppr);
  // attributs w:pos="chiffres" valides (précédés d'un blanc), avec la fin de leurs chiffres
  const cands: { v: number; d: number }[] = [];
  for (const v of x.spaced('w:pos="')) {
    let d = v + 7;
    while (ppr.charAt(d) >= '0' && ppr.charAt(d) <= '9') d++;
    if (d > v + 7 && ppr.charAt(d) === '"') cands.push({ v, d });
  }
  const vs = cands.map((c) => c.v);
  let out = '';
  let last = 0;
  for (const i of x.starts('<w:tab')) {
    if (i < last) continue;
    const g = x.next('>', i + 6);
    // [^>]* gourmand : le dernier attribut valide avant le premier « > »
    const k = lowerBound(vs, g < 0 ? Infinity : g) - 1;
    if (k < 0 || vs[k] < i + 7) continue;
    const { v, d } = cands[k];
    const n = ppr.slice(v + 7, d);
    out += ppr.slice(last, v + 7) + (Number(n) > tw ? String(tw) : n);
    last = d;
  }
  return out + ppr.slice(last);
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
  for (const xml of xmls) {
    // balises <w:rFonts …> (ancienne /<w:rFonts\b[^>]*>/g), sans relire la suite à chaque début
    const x = new XmlIndex(xml);
    let last = 0;
    for (const i of x.starts('<w:rFonts')) {
      if (i < last) continue;
      const g = x.next('>', i + 9);
      if (g < 0) break;
      for (const a of xml.slice(i, g + 1).matchAll(/\sw:(?:ascii|hAnsi)="([^"]+)"/g)) set.add(a[1].replace(/&amp;/g, '&'));
      last = g + 1;
    }
  }
  return [...set];
}

/** Valeurs de /<w:font\b[^>]*\sw:name="([^"]+)"/g, en une passe (même choix : dernier w:name de la balise). */
function fontNames(fontXml: string): string[] {
  const x = new XmlIndex(fontXml);
  const cands: { v: number; q: number }[] = [];
  for (const v of x.spaced('w:name="')) {
    const q = x.next('"', v + 8);
    if (q > v + 8) cands.push({ v, q });
  }
  const vs = cands.map((c) => c.v);
  const out: string[] = [];
  let last = 0;
  for (const i of x.starts('<w:font')) {
    if (i < last) continue;
    const g = x.next('>', i + 7);
    const k = lowerBound(vs, g < 0 ? Infinity : g) - 1;
    if (k < 0 || vs[k] < i + 8) continue;
    out.push(fontXml.slice(cands[k].v + 8, cands[k].q));
    last = cands[k].q + 1;
  }
  return out;
}

/**
 * Ajoute à fontTable.xml les polices employées qui n'y figurent pas, avec leur famille (roman, swiss…) :
 * un Word où elles manquent les remplace alors par une police de même genre. Chaîne inchangée sinon.
 */
export function completeFontTable(fontXml: string, fonts: string[]): string {
  const have = new Set(fontNames(fontXml).map((n) => n.replace(/&amp;/g, '&')));
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

// ── Champs (PAGE, NUMPAGES…) écrits dans un seul run ──
// Word met chaque fldChar / instrText dans son propre run ; certains générateurs (docx-js, outils
// de conversion) les regroupent dans un seul run avec du texte. Le moteur d'édition ne reconnaît
// alors pas le champ (« Page  / » au lieu de « Page 3 / 12 ») : on redécoupe ces runs à l'ouverture.
// Découpage identique aux anciennes expressions
//   RUN_RE   /<w:r(\s[^>]*)?>((?:(?!<w:r[\s>])[\s\S])*?)<\/w:r>/g
//   CHILD_RE /<(w:[A-Za-z]+)\b[^>]*\/>|<(w:[A-Za-z]+)\b[^>]*>[\s\S]*?<\/\2>/g
// mais en une passe (elles relisaient la suite du document à chaque « <w:r » sans fin).
function childElements(rest: string): string[] {
  const x = new XmlIndex(rest);
  // balises fermantes </w:nom> par nom
  const closes = new Map<string, number[]>();
  for (const p of x.all('</w:')) {
    let q = p + 4;
    while (isLetter(rest.charAt(q))) q++;
    if (q === p + 4 || rest.charAt(q) !== '>') continue;
    const n = rest.slice(p + 4, q);
    const l = closes.get(n);
    if (l) l.push(p);
    else closes.set(n, [p]);
  }
  const kids: string[] = [];
  for (let p = x.next('<', 0); p >= 0; ) {
    let end = -1;
    if (rest.startsWith('<w:', p)) {
      let q = p + 3;
      while (isLetter(rest.charAt(q))) q++;
      const g = q > p + 3 && !isWord(rest.charAt(q)) ? x.next('>', q) : -1;
      if (g >= 0) {
        if (rest.charAt(g - 1) === '/' && g - 1 >= q) end = g + 1;
        else {
          const name = rest.slice(p + 3, q);
          const j = nextIn(closes.get(name) ?? [], g + 1);
          if (j >= 0) end = j + name.length + 5;
        }
      }
    }
    if (end >= 0) {
      kids.push(rest.slice(p, end));
      p = x.next('<', end);
    } else p = x.next('<', p + 1);
  }
  return kids;
}
export function splitFieldRuns(xml: string): string {
  if (!/<w:(fldChar|instrText)\b/.test(xml)) return xml;
  const x = new XmlIndex(xml);
  // débuts <w:r suivis d'un blanc ou de « > » (le motif interdit à l'intérieur d'un run)
  const runStarts = x.all('<w:r').filter((i) => {
    const c = xml.charAt(i + 4);
    return c === '>' || isSpace(c);
  });
  let out = '';
  let last = 0;
  for (const i of runStarts) {
    if (i < last) continue;
    let attrs: string | undefined;
    let openEnd = i + 5;
    if (xml.charAt(i + 4) !== '>') {
      const g = x.next('>', i + 4);
      if (g < 0) break;
      attrs = xml.slice(i + 4, g);
      openEnd = g + 1;
    }
    const c = x.next('</w:r>', openEnd);
    if (c < 0) break;
    const b = nextIn(runStarts, openEnd);
    if (b >= 0 && b < c) continue; // un autre run commence avant </w:r>
    const whole = xml.slice(i, c + 6);
    out += xml.slice(last, i) + splitRun(whole, attrs, xml.slice(openEnd, c));
    last = c + 6;
  }
  return out + xml.slice(last);
}
function splitRun(whole: string, attrs: string | undefined, inner: string): string {
  if (!/<w:(fldChar|instrText)\b/.test(inner)) return whole;
  const rPr = /^\s*(<w:rPr\s*\/>|<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>)/.exec(inner)?.[1] ?? '';
  const rest = rPr ? inner.slice(inner.indexOf(rPr) + rPr.length) : inner;
  const kids = childElements(rest);
  if (kids.length < 2 || kids.join('').replace(/\s+/g, '') !== rest.replace(/\s+/g, '')) return whole;
  return kids.map((k) => `<w:r${attrs ?? ''}>${rPr}${k}</w:r>`).join('');
}

/** Prépare un .docx à l'ouverture dans l'éditeur. Renvoie les octets d'origine si rien n'est à faire. */
export async function prepareDocxForEditor(data: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const zip = await JSZip.loadAsync(data);
    let changed = false;
    for (const n of Object.keys(zip.files)) {
      if (zip.files[n].dir || !/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n)) continue;
      const x = await zip.file(n)!.async('string');
      const y = splitFieldRuns(x);
      if (y !== x) {
        zip.file(n, y);
        changed = true;
      }
    }
    return changed ? await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', mimeType: DOCX_MIME }) : data;
  } catch {
    return data;
  }
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
  // propriétés du document (SuperDoc y écrit dcterms:created sans déclarer dcterms ni xsi)
  const core = zip.file('docProps/core.xml');
  if (core) {
    const x = await core.async('string');
    const y = fixNamespaces(x);
    if (y !== x) {
      parts.set('docProps/core.xml', y);
      orig.set('docProps/core.xml', x);
    }
  }
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
  // occurrences de /<tag\b[^>]*?(?:\/>|>[\s\S]*?<\/tag>)/g, trouvées en une passe
  const x = new XmlIndex(inner);
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let out = '';
  let last = 0;
  let had = false;
  for (const i of x.starts(open)) {
    if (i < last) continue;
    const g = x.next('>', i + open.length);
    if (g < 0) break;
    let end = -1;
    if (inner.charAt(g - 1) === '/' && g - 1 >= i + open.length) end = g + 1;
    else {
      const j = x.next(close, g + 1);
      if (j >= 0) end = j + close.length;
    }
    if (end < 0) continue;
    out += inner.slice(last, i) + (el ?? '');
    last = end;
    had = true;
  }
  if (had) return out + inner.slice(last);
  return el ? inner + el : inner;
}
/** Texte de /<open\b[^>]*\/?>/.exec(s)?.[0], en temps linéaire. */
function firstTagText(s: string, open: string): string | undefined {
  const r = new XmlIndex(s).firstTag(open);
  return r ? s.slice(r[0], r[1]) : undefined;
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
  // /<tag>([\s\S]*?)<\/tag>|<tag\/>/ : le plus à gauche des deux, sans relire la suite à chaque <tag>
  const getBlock = (tag: string): [string, string | undefined] | null => {
    const x = new XmlIndex(s);
    const o = `<${tag}>`;
    const c = `</${tag}>`;
    const e = `<${tag}/>`;
    const i1 = x.next(o, 0);
    const j1 = i1 >= 0 ? x.next(c, i1 + o.length) : -1;
    const i2 = x.next(e, 0);
    if (j1 >= 0 && (i2 < 0 || i1 < i2)) return [s.slice(i1, j1 + c.length), s.slice(i1 + o.length, j1)];
    return i2 >= 0 ? [e, undefined] : null;
  };
  // pPr
  const needP = patch.lineSpacing !== undefined || patch.align || patch.firstLine !== undefined || patch.before !== undefined || patch.after !== undefined;
  if (needP) {
    const b = getBlock('w:pPr');
    let inner = b?.[1] ?? '';
    if (patch.lineSpacing !== undefined || patch.before !== undefined || patch.after !== undefined) {
      const cur = attrsOf(firstTagText(inner, '<w:spacing'));
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
      const cur = attrsOf(firstTagText(inner, '<w:ind'));
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
    let el = xmlIndex(out).styleEl(id);
    if (!el) {
      const def = defs[id];
      if (!def) continue;
      out = out.replace(/<\/w:styles>\s*$/, `${def}</w:styles>`);
      el = xmlIndex(out).styleEl(id);
    }
    if (el) out = out.slice(0, el[0]) + patchStyleElement(out.slice(el[0], el[1]), patch) + out.slice(el[1]);
  }
  return reorderXml(out);
}

/** Ajoute des styles (définitions XML complètes) s'ils manquent. */
export function ensureStylesXml(stylesXml: string, defs: Record<string, string>): string {
  let out = stylesXml;
  for (const [id, def] of Object.entries(defs)) {
    if (xmlIndex(out).hasStyleOpen(id, true)) continue;
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
  // Tout est lu dans les bornes de l'élément, sur l'index de styles.xml (pas de tranche relue à chaque appel).
  const x = xmlIndex(stylesXml);
  const st = x.styleEl(id);
  if (!st) return { exists: false };
  const [a, b] = st;
  const rf = x.attrs(x.firstTag('<w:rFonts', a, b));
  const sz = x.attrs(x.firstTag('<w:sz', a, b))['w:val'];
  const ppr = x.block('<w:pPr>', '</w:pPr>', a, b);
  const sp = ppr ? x.attrs(x.firstTag('<w:spacing', ppr[0], ppr[1])) : {};
  const ind = x.attrs(x.firstTag('<w:ind', a, b));
  const jc = x.attrs(x.firstTag('<w:jc', a, b))['w:val'];
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
  const x = xmlIndex(stylesXml);
  const def = defaultParagraphStyle(stylesXml);
  const seen = new Set<string>();
  let cur: string | null = id ?? def;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const p = readStyleProps(stylesXml, cur);
    if (!p.exists) break;
    fill(p);
    const st = x.styleEl(cur)!;
    cur = x.basedOn(st[0], st[1]) ?? (cur !== def ? def : null);
  }
  const dd = x.block('<w:docDefaults>', '</w:docDefaults>');
  if (dd) {
    const rf = x.attrs(x.firstTag('<w:rFonts', dd[0], dd[1]));
    const sz = x.attrs(x.firstTag('<w:sz', dd[0], dd[1]))['w:val'];
    const pd = x.block('<w:pPrDefault>', '</w:pPrDefault>', dd[0], dd[1]);
    const sp = pd ? x.attrs(x.firstTag('<w:spacing', pd[0], pd[1])) : {};
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
  const x = xmlIndex(stylesXml);
  // lecture d'un bloc rPr [a, b) de styles.xml (bornes plutôt que tranche : rien n'est relu d'un style à l'autre)
  const tagText = (r: [number, number] | null) => (r ? stylesXml.slice(r[0], r[1]) : undefined);
  const read = (r: [number, number] | null) => {
    // sans bloc : bornes vides, aucune balise trouvée (les clés restent créées comme avant, à undefined)
    const [a, b] = r ?? [0, 0];
    out.bold ??= onOff(tagText(x.firstTag('<w:b', a, b, true)));
    out.italic ??= onOff(tagText(x.firstTag('<w:i', a, b, true)));
    const sz = x.attrs(x.firstTag('<w:sz', a, b))['w:val'];
    if (out.fontSize === undefined && sz) out.fontSize = Number(sz) / 2;
    const rf = x.attrs(x.firstTag('<w:rFonts', a, b));
    out.fontFamily ??= rf['w:ascii'] || rf['w:hAnsi'] || undefined;
    const c = x.attrs(x.firstTag('<w:color', a, b))['w:val'];
    if (out.color === undefined && c) out.color = c.toUpperCase();
  };
  const def = defaultParagraphStyle(stylesXml);
  const seen = new Set<string>();
  let cur: string | null = id ?? def;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const st = x.styleEl(cur);
    if (!st) break;
    read(x.block('<w:rPr>', '</w:rPr>', st[0], st[1]));
    cur = x.basedOn(st[0], st[1]) ?? (cur !== def ? def : null);
  }
  const dd = x.block('<w:rPrDefault>', '</w:rPrDefault>');
  if (dd) read(dd);
  return out;
}

/** Identifiant du style de paragraphe par défaut (w:default="1"), « Normal » le plus souvent. */
export function defaultParagraphStyle(stylesXml: string): string | null {
  // Même résultat que
  // /<w:style\b(?=[^>]*\sw:type="paragraph")(?=[^>]*\sw:default="(?:1|true|on)")[^>]*\sw:styleId="([^"]+)"/,
  // calculé une fois par chaîne à partir des positions des attributs.
  const x = xmlIndex(stylesXml);
  return x.cached('defaultStyle', () => {
    const types = x.spaced('w:type="paragraph"');
    const defs = ['1', 'true', 'on'].flatMap((v) => x.spaced(`w:default="${v}"`)).sort((a, b) => a - b);
    const ids: { v: number; q: number }[] = [];
    for (const v of x.spaced('w:styleId="')) {
      const q = x.next('"', v + 11);
      if (q > v + 11) ids.push({ v, q });
    }
    const vs = ids.map((c) => c.v);
    for (const i of x.starts('<w:style')) {
      const g = x.next('>', i + 8);
      const lim = g < 0 ? Infinity : g;
      const inTag = (list: number[]) => {
        const v = nextIn(list, i + 9);
        return v >= 0 && v < lim;
      };
      if (!inTag(types) || !inTag(defs)) continue;
      // [^>]* gourmand : le dernier w:styleId valide de la balise
      const k = lowerBound(vs, lim) - 1;
      if (k >= 0 && vs[k] >= i + 9) return stylesXml.slice(ids[k].v + 11, ids[k].q);
    }
    return /w:styleId="Normal"/.test(stylesXml) ? 'Normal' : null;
  });
}

/** Lit word/styles.xml d'un paquet. */
export async function readStylesXml(data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  return (await zip.file('word/styles.xml')?.async('string')) ?? '';
}

/** Remplace toute police de thème (asciiTheme…) de styles.xml par `font` (styles et docDefaults). */
export function replaceThemeFonts(stylesXml: string, font: string): string {
  const el = mkEl('w:rFonts', { 'w:ascii': font, 'w:hAnsi': font, 'w:eastAsia': font, 'w:cs': font });
  // Même découpage que /<w:rFonts\b[^>]*\b(?:asciiTheme|hAnsiTheme)\s*=[^>]*?\/?>(?:<\/w:rFonts>)?/g, en une passe.
  const x = new XmlIndex(stylesXml);
  // attributs de thème (précédés d'une limite de mot, suivis de \s*=) : position du « = »
  const eqs: { v: number; e: number }[] = [];
  for (const v of [...x.all('asciiTheme'), ...x.all('hAnsiTheme')].sort((a, b) => a - b)) {
    if (isWord(stylesXml.charAt(v - 1))) continue;
    let e = v + 10;
    while (isSpace(stylesXml.charAt(e))) e++;
    if (stylesXml.charAt(e) === '=') eqs.push({ v, e });
  }
  const vs = eqs.map((c) => c.v);
  let out = '';
  let last = 0;
  for (const i of x.starts('<w:rFonts')) {
    if (i < last) continue;
    const g = x.next('>', i + 9);
    if (g < 0) break;
    const k = lowerBound(vs, i + 9);
    if (k >= eqs.length || eqs[k].e >= g) continue; // pas d'attribut de thème dans cette balise
    const end = stylesXml.startsWith('</w:rFonts>', g + 1) ? g + 12 : g + 1;
    out += stylesXml.slice(last, i) + el;
    last = end;
  }
  return out + stylesXml.slice(last);
}

/**
 * Police du document (w:docDefaults/w:rPrDefault/w:rFonts) remplacée par `font` dans styles.xml : les
 * polices de thème de cet élément sont retirées (elles l'emporteraient dans Word). Crée les éléments manquants.
 */
export function setDocDefaultFontXml(stylesXml: string, font: string): string {
  const rf = mkEl('w:rFonts', { 'w:ascii': font, 'w:hAnsi': font, 'w:eastAsia': font, 'w:cs': font });
  const withRPr = (rPr: string): string => {
    // <w:rPr/> ou <w:rPr>…</w:rPr> ; w:rFonts est le premier enfant de w:rPr (ordre du schéma)
    const inner = /^<w:rPr\s*\/>$/.test(rPr) ? '' : rPr.replace(/^<w:rPr>/, '').replace(/<\/w:rPr>$/, '');
    return `<w:rPr>${rf}${inner.replace(/<w:rFonts\b[^>]*?(?:\/>|>[\s\S]*?<\/w:rFonts>)/, '')}</w:rPr>`;
  };
  const dd = /<w:docDefaults\s*\/>|<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(stylesXml);
  if (!dd) return stylesXml.replace(/(<w:styles\b[^>]*>)/, (m) => `${m}<w:docDefaults><w:rPrDefault><w:rPr>${rf}</w:rPr></w:rPrDefault></w:docDefaults>`);
  let block = dd[0].replace(/^<w:docDefaults\s*\/>$/, '<w:docDefaults></w:docDefaults>');
  const rd = /<w:rPrDefault\s*\/>|<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/.exec(block);
  if (!rd) block = block.replace('<w:docDefaults>', `<w:docDefaults><w:rPrDefault><w:rPr>${rf}</w:rPr></w:rPrDefault>`);
  else {
    const rPr = /<w:rPr\s*\/>|<w:rPr>[\s\S]*?<\/w:rPr>/.exec(rd[0]);
    const next = rPr ? rd[0].replace(rPr[0], () => withRPr(rPr[0])) : `<w:rPrDefault><w:rPr>${rf}</w:rPr></w:rPrDefault>`;
    block = block.replace(rd[0], () => next);
  }
  return stylesXml.replace(dd[0], () => block);
}
