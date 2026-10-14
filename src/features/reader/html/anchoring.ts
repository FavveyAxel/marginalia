// Ancrage des surlignages du moteur HTML.
// Règle d'or : toutes les positions sont des offsets dans le textContent du conteneur
// de chapitre (.html-chapter-text). Les décorations (surlignages, connecteurs, résultats
// de recherche) ne font qu'envelopper des nœuds texte existants : elles ne changent
// jamais ce textContent, donc jamais les offsets.
import type { HtmlAnchor } from '../../../lib/types';

export const CONTEXT_LEN = 32;

export interface TextSpan {
  chapter: number;
  start: number;
  end: number;
}

/** Construit un ancrage depuis le texte (pas depuis le DOM décoré). */
export function makeAnchor(text: string, chapter: number, start: number, end: number): HtmlAnchor {
  return {
    kind: 'html',
    chapter,
    start,
    end,
    prefix: text.slice(Math.max(0, start - CONTEXT_LEN), start),
    suffix: text.slice(end, end + CONTEXT_LEN),
  };
}

// ── Repli (casse, accents, apostrophes, espaces) avec table de correspondance ──

export interface Folded {
  text: string;
  /** Pour chaque caractère replié : index de début dans la chaîne d'origine. */
  starts: number[];
  /** Pour chaque caractère replié : index de fin (exclu) dans la chaîne d'origine. */
  ends: number[];
}

const SPACE_RE = /[\s     ]/;
const APOS_RE = /[’‘ʼ′`]/;
const MARKS_RE = /\p{M}+/gu;

/**
 * Replie une chaîne pour la recherche : minuscules, sans diacritiques, apostrophes
 * typographiques → ', ligatures œ/æ développées, espaces fusionnées (collapse = true).
 */
export function fold(s: string, collapse = true): Folded {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let lastSpace = false;
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    const ch = s.slice(i, i + len);
    let f: string;
    if (SPACE_RE.test(ch)) f = ' ';
    else if (APOS_RE.test(ch)) f = "'";
    else {
      f = ch.normalize('NFKD').replace(MARKS_RE, '').toLowerCase();
      if (f === 'œ') f = 'oe';
      else if (f === 'æ') f = 'ae';
      if (SPACE_RE.test(f)) f = ' ';
    }
    if (f === ' ' && collapse) {
      if (lastSpace) {
        ends[ends.length - 1] = i + len;
        i += len;
        continue;
      }
      lastSpace = true;
    } else if (f.length) lastSpace = false;
    for (let k = 0; k < f.length; k++) {
      text += f[k];
      starts.push(i);
      ends.push(i + len);
    }
    i += len;
  }
  return { text, starts, ends };
}

/** Toutes les occurrences de `needle` dans `hay` (max `cap`). */
export function allIndexes(hay: string, needle: string, cap = 2000): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i >= 0 && out.length < cap) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

interface Candidate {
  chapter: number;
  pos: number;
}

/** Choisit l'occurrence la plus proche de l'ancrage d'origine (même chapitre d'abord). */
function nearest(cands: Candidate[], a: HtmlAnchor): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = Infinity;
  for (const c of cands) {
    const score = Math.abs(c.chapter - a.chapter) * 1e12 + Math.abs(c.pos - a.start);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function findEverywhere(texts: string[], needle: string): Candidate[] {
  const out: Candidate[] = [];
  if (!needle) return out;
  texts.forEach((t, chapter) => {
    for (const pos of allIndexes(t, needle)) out.push({ chapter, pos });
  });
  return out;
}

export type ResolveMethod = 'exact' | 'context' | 'offsets' | 'partial-context' | 'quote' | 'fuzzy';

/**
 * Ré-ancre un passage dans les textes des chapitres.
 * Ordre de confiance décroissante :
 *  1. texte et contexte identiques aux offsets enregistrés ;
 *  2. citation complète prefix + text + suffix (la plus proche) ;
 *  3. texte identique aux offsets (contexte modifié) ;
 *  4. prefix + text ou text + suffix (le plus proche) ;
 *  5. text seul (le plus proche des offsets) ;
 *  6. text replié (casse, accents, espaces) le plus proche.
 * Renvoie null si rien ne correspond : mieux vaut ne pas afficher qu'afficher au mauvais endroit.
 */
export function resolveAnchor(texts: string[], a: HtmlAnchor, quote: string): (TextSpan & { method: ResolveMethod }) | null {
  const t0 = texts[a.chapter];
  if (!quote) {
    if (t0 != null && a.start >= 0 && a.start < a.end && a.end <= t0.length) return { chapter: a.chapter, start: a.start, end: a.end, method: 'offsets' };
    return null;
  }
  const L = quote.length;
  const atOffsets = t0 != null && a.start >= 0 && t0.slice(a.start, a.start + L) === quote;
  if (atOffsets) {
    const pre = t0.slice(Math.max(0, a.start - a.prefix.length), a.start);
    const suf = t0.slice(a.start + L, a.start + L + a.suffix.length);
    if (pre === a.prefix && suf === a.suffix) return { chapter: a.chapter, start: a.start, end: a.start + L, method: 'exact' };
  }
  // 2. Citation complète
  if (a.prefix || a.suffix) {
    const c = nearest(findEverywhere(texts, a.prefix + quote + a.suffix), a);
    if (c) return { chapter: c.chapter, start: c.pos + a.prefix.length, end: c.pos + a.prefix.length + L, method: 'context' };
  }
  // 3. Texte inchangé aux offsets
  if (atOffsets) return { chapter: a.chapter, start: a.start, end: a.start + L, method: 'offsets' };
  // 4. Contexte partiel
  const partial: Candidate[] = [];
  if (a.prefix) for (const c of findEverywhere(texts, a.prefix + quote)) partial.push({ chapter: c.chapter, pos: c.pos + a.prefix.length });
  if (a.suffix) partial.push(...findEverywhere(texts, quote + a.suffix));
  const p = nearest(partial, a);
  if (p) return { chapter: p.chapter, start: p.pos, end: p.pos + L, method: 'partial-context' };
  // 5. Texte seul
  const q = nearest(findEverywhere(texts, quote), a);
  if (q) return { chapter: q.chapter, start: q.pos, end: q.pos + L, method: 'quote' };
  // 6. Repli tolérant (espaces, apostrophes, casse, accents)
  // Seuil de 8 caractères : en dessous, un repli trop tolérant risque de viser un autre passage.
  const fq = fold(quote).text.trim();
  if (fq.length >= 8) {
    const cands: (Candidate & { end: number })[] = [];
    texts.forEach((t, chapter) => {
      const f = fold(t);
      for (const pos of allIndexes(f.text, fq, 200)) cands.push({ chapter, pos: f.starts[pos], end: f.ends[pos + fq.length - 1] });
    });
    const best = nearest(cands, a) as (Candidate & { end: number }) | null;
    if (best) return { chapter: best.chapter, start: best.pos, end: best.end, method: 'fuzzy' };
  }
  return null;
}

// ── Passage offsets ↔ DOM ─────────────────────────────────────

/** Offset (dans le textContent de root) d'un point de frontière DOM. */
export function offsetOf(root: Node, node: Node, offset: number): number {
  if (!root.contains(node)) return -1;
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** Nœud texte + offset local pour un offset de textContent. */
export function locate(root: Node, offset: number, bias: 'start' | 'end'): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let last: Text | null = null;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    const len = t.data.length;
    if (offset < pos + len || (bias === 'end' && offset === pos + len && len > 0)) return { node: t, offset: Math.max(0, offset - pos) };
    pos += len;
    last = t;
  }
  if (last && offset >= pos) return { node: last, offset: last.data.length };
  return null;
}

export function rangeFor(root: Node, start: number, end: number): Range | null {
  const a = locate(root, start, 'start');
  const b = locate(root, end, 'end');
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  return r;
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HGROUP', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL', 'CAPTION',
]);

export const isBlockEl = (n: Node | null): boolean => !!n && n.nodeType === 1 && BLOCK_TAGS.has((n as Element).tagName.toUpperCase());

/**
 * Nœud texte qu'il ne faut pas envelopper : blanc entre deux blocs (sinon une boîte inline
 * vide, avec bordure, créerait une ligne fantôme) ou texte SVG.
 */
function skipForWrap(t: Text): boolean {
  const parent = t.parentNode as Element | null;
  if (!parent) return true;
  if (parent.namespaceURI && parent.namespaceURI !== 'http://www.w3.org/1999/xhtml') return true;
  if (!/^\s*$/.test(t.data)) return false;
  if (!isBlockEl(parent) && parent.nodeType === 1 && !(parent as Element).classList.contains('html-chapter-text')) return false;
  const prev = t.previousSibling;
  const next = t.nextSibling;
  return !prev || !next || isBlockEl(prev) || isBlockEl(next);
}

/**
 * Enveloppe [start, end) du textContent de root dans des éléments créés par make().
 * Un élément par morceau de nœud texte : gère les passages qui traversent les balises.
 * Le textContent de root est inchangé.
 */
export function wrapOffsets(root: Node, start: number, end: number, make: () => HTMLElement): HTMLElement[] {
  if (end <= start) return [];
  const parts: { node: Text; s: number; e: number }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    const len = t.data.length;
    const a = pos;
    const b = pos + len;
    pos = b;
    if (b <= start) continue;
    if (a >= end) break;
    const s = Math.max(start, a) - a;
    const e = Math.min(end, b) - a;
    if (e > s && !skipForWrap(t)) parts.push({ node: t, s, e });
  }
  const out: HTMLElement[] = [];
  for (const { node, s, e } of parts) {
    let target = node;
    if (e < target.data.length) target.splitText(e);
    if (s > 0) target = target.splitText(s);
    const el = make();
    target.parentNode!.insertBefore(el, target);
    el.appendChild(target);
    out.push(el);
  }
  return out;
}

/** Retire des éléments enveloppants en gardant leur contenu. */
export function unwrapAll(els: Iterable<Element>): Set<Node> {
  const parents = new Set<Node>();
  for (const el of Array.from(els)) {
    const p = el.parentNode;
    if (!p) continue;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
    parents.add(p);
  }
  return parents;
}
