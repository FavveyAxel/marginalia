// Calque de texte transparent et sélectionnable posé sur l'image (même principe que pdf.js) :
// un <span> par mot reconnu, placé sur la boîte du mot, la largeur ajustée par scaleX.
// Les positions sont en % de l'image et la taille de police suit la variable CSS --img-k
// (pixels affichés par pixel d'image) : le zoom ne reconstruit jamais le calque.
import type { NormRect } from '../../../lib/types';
import { buildIndex, type TextIndex } from '../pdf/textindex';
import type { OcrData, OcrWord } from './ocr';

export interface FlatWord extends OcrWord {
  i: number;
  line: number;
  para: number;
}

export interface WordModel {
  words: FlatWord[];
  /** Texte brut : mots séparés par une espace, lignes par '\n'. */
  raw: string;
  /** Début de chaque mot dans `raw`. */
  starts: number[];
  index: TextIndex;
}

export function wordModel(ocr: OcrData | null): WordModel {
  const words: FlatWord[] = [];
  let line = 0;
  ocr?.paras.forEach((p, para) =>
    p.lines.forEach((l) => {
      l.words.forEach((w) => words.push({ ...w, i: words.length, line, para }));
      line++;
    }),
  );
  let raw = '';
  const starts: number[] = [];
  words.forEach((w, k) => {
    if (k > 0) raw += words[k - 1].line === w.line ? ' ' : '\n';
    starts.push(raw.length);
    raw += w.t;
  });
  return { words, raw, starts, index: buildIndex(raw) };
}

let measureCtx: CanvasRenderingContext2D | null = null;
const FONT = 'sans-serif';
function textWidth(t: string, px: number): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return t.length * px * 0.5;
  measureCtx.font = `${px}px ${FONT}`;
  return measureCtx.measureText(t).width;
}

const pct = (v: number) => `${Math.round(v * 1000000) / 10000}%`;

/** Construit le calque (détaché) pour une image de `natW` × `natH` pixels. */
export function buildTextLayer(model: WordModel, natW: number, natH: number): HTMLDivElement {
  const layer = document.createElement('div');
  layer.className = 'img-text';
  // Hauteur de police par ligne : médiane des hauteurs de mots (les accents et jambages varient).
  const byLine = new Map<number, number[]>();
  for (const w of model.words) (byLine.get(w.line) ?? byLine.set(w.line, []).get(w.line)!).push(w.h * natH);
  const lineFs = new Map<number, number>();
  byLine.forEach((hs, l) => {
    const s = [...hs].sort((a, b) => a - b);
    lineFs.set(l, s[Math.floor(s.length / 2)] * 0.92);
  });
  const frag = document.createDocumentFragment();
  model.words.forEach((w, k) => {
    const next = model.words[k + 1];
    const endOfLine = !next || next.line !== w.line;
    const fs = Math.max(4, lineFs.get(w.line) ?? w.h * natH);
    const span = document.createElement('span');
    span.dataset.i = String(w.i);
    span.textContent = endOfLine ? w.t : w.t + ' ';
    const natural = textWidth(w.t, fs);
    const sx = natural > 0 ? (w.w * natW) / natural : 1;
    // Centrage vertical de la boîte de police (line-height 1) sur la boîte du mot.
    const top = w.y * natH + (w.h * natH - fs) / 2;
    span.style.left = pct(w.x);
    span.style.top = pct(top / natH);
    span.style.fontSize = `calc(var(--img-k) * ${Math.round(fs * 100) / 100}px)`;
    span.style.transform = `scaleX(${Math.round(sx * 10000) / 10000})`;
    frag.append(span);
    if (endOfLine) frag.append(document.createElement('br'));
  });
  const end = document.createElement('div');
  end.className = 'endOfContent';
  frag.append(end);
  layer.append(frag);
  return layer;
}

interface Point {
  i: number;
  off: number;
}

/** Mot et position dans le mot d'une extrémité de sélection (null hors du calque). */
function pointToWord(layer: Element, model: WordModel, node: Node, offset: number, isEnd: boolean): Point | null {
  const el = node.nodeType === 3 ? node.parentElement : (node as Element);
  if (!el || !layer.contains(el)) return null;
  const span = el.closest<HTMLElement>('[data-i]');
  if (span && layer.contains(span)) {
    const i = Number(span.dataset.i);
    const len = model.words[i]?.t.length ?? 0;
    if (node.nodeType === 3) return { i, off: Math.min(offset, len) };
    return { i, off: offset === 0 ? 0 : len };
  }
  if (el !== layer) return null;
  const kids = layer.childNodes;
  if (!isEnd) {
    for (let k = offset; k < kids.length; k++) {
      const c = kids[k] as HTMLElement;
      if (c.nodeType === 1 && c.dataset?.i) return { i: Number(c.dataset.i), off: 0 };
    }
  } else {
    for (let k = Math.min(offset, kids.length) - 1; k >= 0; k--) {
      const c = kids[k] as HTMLElement;
      if (c.nodeType === 1 && c.dataset?.i) {
        const i = Number(c.dataset.i);
        return { i, off: model.words[i].t.length };
      }
    }
  }
  return null;
}

export interface ImageSelection {
  first: number;
  last: number;
  text: string;
  rects: NormRect[];
}

/** Rectangles d'une suite de mots (fragments compris) : un rectangle par portion de ligne. */
export function rectsForWords(model: WordModel, a: Point, b: Point): NormRect[] {
  const out: NormRect[] = [];
  let cur: { x0: number; y0: number; x1: number; y1: number; line: number } | null = null;
  for (let i = a.i; i <= b.i; i++) {
    const w = model.words[i];
    const len = Math.max(1, w.t.length);
    const s = i === a.i ? a.off : 0;
    const e = i === b.i ? b.off : len;
    if (e <= s) continue;
    const x0 = w.x + (w.w * s) / len;
    const x1 = w.x + (w.w * e) / len;
    const y0 = w.y;
    const y1 = w.y + w.h;
    // Fusion avec le mot précédent de la même ligne s'ils se recouvrent verticalement
    // (une ligne inclinée donne quelques rectangles en escalier plutôt qu'un pavé trop haut).
    if (cur && cur.line === w.line) {
      const overlap = Math.min(cur.y1, y1) - Math.max(cur.y0, y0);
      if (overlap > 0.6 * Math.min(cur.y1 - cur.y0, y1 - y0)) {
        cur.x1 = Math.max(cur.x1, x1);
        cur.y0 = Math.min(cur.y0, y0);
        cur.y1 = Math.max(cur.y1, y1);
        continue;
      }
    }
    if (cur) out.push(toRect(cur));
    cur = { x0, y0, x1, y1, line: w.line };
  }
  if (cur) out.push(toRect(cur));
  return out;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
function toRect(c: { x0: number; y0: number; x1: number; y1: number }): NormRect {
  // Léger débord vertical : le surlignage couvre accents et jambages.
  const pad = (c.y1 - c.y0) * 0.12;
  const y = Math.max(0, c.y0 - pad);
  return { x: r4(Math.max(0, c.x0)), y: r4(y), w: r4(Math.min(1, c.x1) - Math.max(0, c.x0)), h: r4(Math.min(1, c.y1 + pad) - y) };
}

/** Texte d'une suite de mots : lignes jointes par une espace, césures de fin de ligne recollées. */
export function textForWords(model: WordModel, a: Point, b: Point): string {
  let out = '';
  for (let i = a.i; i <= b.i; i++) {
    const w = model.words[i];
    const t = w.t.slice(i === a.i ? a.off : 0, i === b.i ? b.off : undefined);
    if (!t) continue;
    if (out) {
      const prev = model.words[i - 1];
      if (prev && prev.line !== w.line && /[a-zà-ÿ]-$/i.test(out) && /^[a-zà-ÿ]/.test(t)) out = out.slice(0, -1);
      else out += ' ';
    }
    out += t;
  }
  return out.trim();
}

/** Lit la sélection courante si elle porte sur le calque `layer`. */
export function readImageSelection(layer: Element, model: WordModel): ImageSelection | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!layer.contains(r.commonAncestorContainer) && r.commonAncestorContainer !== layer) return null;
  const a = pointToWord(layer, model, r.startContainer, r.startOffset, false);
  const b = pointToWord(layer, model, r.endContainer, r.endOffset, true);
  if (!a || !b || b.i < a.i || (a.i === b.i && b.off <= a.off)) return null;
  // Une extrémité en fin de mot (ou au début du suivant) ne doit pas créer de fragment vide.
  const start = a.off >= model.words[a.i].t.length && a.i < b.i ? { i: a.i + 1, off: 0 } : a;
  const end = b.off === 0 && b.i > start.i ? { i: b.i - 1, off: model.words[b.i - 1].t.length } : b;
  const text = textForWords(model, start, end);
  const rects = rectsForWords(model, start, end);
  if (!text || !rects.length) return null;
  return { first: start.i, last: end.i, text, rects };
}

/** Mots dont le centre tombe dans le rectangle (annotation par zone). */
export function wordsInRect(model: WordModel, r: NormRect): FlatWord[] {
  return model.words.filter((w) => {
    const cx = w.x + w.w / 2;
    const cy = w.y + w.h / 2;
    return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
  });
}

/** Mot contenant l'indice `raw` du texte brut. */
export function wordAtRaw(model: WordModel, raw: number): number {
  let lo = 0;
  let hi = model.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (model.starts[mid] <= raw) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
