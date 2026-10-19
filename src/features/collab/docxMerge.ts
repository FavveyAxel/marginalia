// ─────────────────────────────────────────────────────────────
// Réunion d'un écrit modifié de deux côtés, paragraphe par paragraphe (jamais lettre à lettre).
//
// - Blocs : les éléments de premier niveau de <w:body> (paragraphes, tableaux…), copiés à l'octet près ;
//   leur texte (w:t, tabulations, sauts) sert à les comparer. Le <w:sectPr> final reste en place.
// - Fusion à trois : base (l'écrit tel qu'à la fin de la dernière session commune), le mien, le leur.
//   Un passage changé d'un seul côté prend ce côté ; changé des deux côtés à l'identique, une fois ;
//   changé des deux côtés différemment : CONFLIT, montré avec les deux versions (« Garder la mienne »,
//   « Garder celle de … », « Garder les deux »). Sans base connue : la base est ce qui est commun aux deux.
// - Reconstruction : dans le paquet .docx « conteneur » (le mien), le corps est remplacé par les blocs
//   retenus. Un bloc venu de l'autre côté qui renvoie à une partie du paquet (image, lien, note de bas
//   de page, commentaire) n'y aurait pas sa cible : la fusion est alors refusée (le mien reste dans les
//   versions, rien ne se perd).
// ─────────────────────────────────────────────────────────────
import JSZip from 'jszip';
import { diffArrays } from 'diff';

export interface Block {
  xml: string;
  text: string;
}
export interface Parsed {
  zip: JSZip;
  head: string;
  blocks: Block[];
  /** <w:sectPr> final et fin du document. */
  tail: string;
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Texte d'un bloc (comparaison). */
export function blockText(xml: string): string {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<\/w:p>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[1] !== undefined) out += decode(m[1]);
    else if (m[0].startsWith('<w:tab')) out += '\t';
    else if (m[0].startsWith('<w:br')) out += '\n';
    else out += '\u2029';
  }
  return out.replace(/\u2029$/, '');
}

/** Éléments de premier niveau d'un fragment XML (balayage, sans réécriture). */
function topLevel(inner: string): { start: number; end: number; name: string }[] {
  const out: { start: number; end: number; name: string }[] = [];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let depth = 0;
  let start = -1;
  let name = '';
  for (let m = re.exec(inner); m; m = re.exec(inner)) {
    if (!m[2]) continue;
    const closing = m[1] === '/';
    const self = m[4] === '/';
    if (!closing) {
      if (depth === 0) {
        start = m.index;
        name = m[2];
      }
      if (self) {
        if (depth === 0) out.push({ start, end: re.lastIndex, name });
      } else depth++;
    } else {
      depth--;
      if (depth === 0) out.push({ start, end: re.lastIndex, name });
      if (depth < 0) throw new Error('XML déséquilibré');
    }
  }
  return out;
}

export async function parseDocxBlocks(data: ArrayBuffer | Uint8Array): Promise<Parsed> {
  const zip = await JSZip.loadAsync(data);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('document.xml absent');
  const xml = await f.async('string');
  const open = /<w:body(?:\s[^>]*)?>/.exec(xml);
  const close = xml.lastIndexOf('</w:body>');
  if (!open || close < 0) throw new Error('corps absent');
  const bodyStart = open.index + open[0].length;
  const inner = xml.slice(bodyStart, close);
  const els = topLevel(inner);
  const sect = els.length && els[els.length - 1].name === 'w:sectPr' ? els[els.length - 1] : null;
  const blocks = els.filter((e) => e !== sect).map((e) => ({ xml: inner.slice(e.start, e.end), text: blockText(inner.slice(e.start, e.end)) }));
  return { zip, head: xml.slice(0, bodyStart), blocks, tail: (sect ? inner.slice(sect.start) : '') + xml.slice(close) };
}

/** Textes des blocs d'un .docx (base gardée à la fin d'une session). */
export async function docxTexts(data: ArrayBuffer | Uint8Array): Promise<string[]> {
  return (await parseDocxBlocks(data)).blocks.map((b) => b.text);
}

// ── Fusion à trois ───────────────────────────────────────────
export type Chunk =
  | { kind: 'same'; blocks: Block[] }
  | { kind: 'conflict'; base: string[]; mine: Block[]; theirs: Block[] };

/** Correspondances base → autre (indices des éléments communs, dans l'ordre). */
function matches(base: string[], other: string[]): Map<number, number> {
  const out = new Map<number, number>();
  let i = 0;
  let j = 0;
  for (const part of diffArrays(base, other)) {
    const n = part.count ?? part.value.length;
    if (part.added) j += n;
    else if (part.removed) i += n;
    else {
      for (let k = 0; k < n; k++) out.set(i + k, j + k);
      i += n;
      j += n;
    }
  }
  return out;
}

const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Fusion à trois des blocs. `base` null : base inconnue (la partie commune des deux sert de base).
 * Renvoie les morceaux dans l'ordre : identiques ou en conflit.
 */
export function merge3(base: string[] | null, mine: Block[], theirs: Block[]): Chunk[] {
  const M = mine.map((b) => b.text);
  const T = theirs.map((b) => b.text);
  let B = base;
  if (!B) {
    // Base inconnue : ce que les deux ont en commun.
    B = [];
    for (const part of diffArrays(M, T)) if (!part.added && !part.removed) B.push(...part.value);
  }
  const bm = matches(B, M);
  const bt = matches(B, T);
  const out: Chunk[] = [];
  const push = (blocks: Block[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.kind === 'same') last.blocks.push(...blocks);
    else out.push({ kind: 'same', blocks: [...blocks] });
  };
  let i = 0;
  let j = 0;
  let k = 0;
  const flush = (bi: number, mj: number, tk: number) => {
    const b = B!.slice(i, bi);
    const m = mine.slice(j, mj);
    const t = theirs.slice(k, tk);
    const mt = m.map((x) => x.text);
    const tt = t.map((x) => x.text);
    if (eq(mt, b)) push(t);
    else if (eq(tt, b)) push(m);
    else if (eq(mt, tt)) push(m);
    else out.push({ kind: 'conflict', base: b, mine: m, theirs: t });
  };
  for (let bi = 0; bi < B.length; bi++) {
    const mj = bm.get(bi);
    const tk = bt.get(bi);
    if (mj === undefined || tk === undefined || mj < j || tk < k) continue;
    flush(bi, mj, tk);
    push([mine[mj]]);
    i = bi + 1;
    j = mj + 1;
    k = tk + 1;
  }
  flush(B.length, mine.length, theirs.length);
  return out;
}

export type Choice = 'mine' | 'theirs' | 'both';

/** Le bloc renvoie-t-il à une autre partie du paquet (image, lien, note, commentaire) ? */
const REF = /\br:(?:id|embed|link|pict)=|<w:(?:footnoteReference|endnoteReference|commentReference|commentRangeStart|commentRangeEnd)\b/;

/**
 * Reconstruit le .docx fusionné dans le paquet `container` (le mien). Renvoie null si un bloc venu de
 * l'autre côté renvoie à une partie du paquet qu'il n'a pas.
 */
export async function buildMerged(container: Parsed, chunks: Chunk[], choices: Choice[]): Promise<ArrayBuffer | null> {
  const mineXml = new Set(container.blocks.map((b) => b.xml));
  const blocks: Block[] = [];
  let c = 0;
  for (const ch of chunks) {
    if (ch.kind === 'same') blocks.push(...ch.blocks);
    else {
      const pick = choices[c++] ?? 'both';
      if (pick === 'mine' || pick === 'both') blocks.push(...ch.mine);
      if (pick === 'theirs' || pick === 'both') blocks.push(...ch.theirs);
    }
  }
  if (blocks.some((b) => !mineXml.has(b.xml) && REF.test(b.xml))) return null;
  const xml = container.head + blocks.map((b) => b.xml).join('') + container.tail;
  container.zip.file('word/document.xml', xml);
  return container.zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
