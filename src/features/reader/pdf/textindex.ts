// Utilitaires purs du moteur PDF : normalisation du texte (recherche, sélection),
// fusion des rectangles par ligne.

export interface TextIndex {
  /** Texte brut aux espaces normalisés (casse et accents conservés), césures recollées. */
  clean: string;
  /** Texte replié : minuscules, sans accents, ligatures dépliées. */
  norm: string;
  /** Pour chaque caractère de `norm`, l'indice dans `clean`. */
  normToClean: Int32Array;
  /** Pour chaque caractère de `clean`, l'indice dans le texte brut d'origine. */
  cleanToRaw: Int32Array;
}

const foldCache = new Map<string, string>();

/** Replie un caractère : accents retirés, minuscule, ligatures et typographie unifiées. */
function fold(ch: string): string {
  let r = foldCache.get(ch);
  if (r === undefined) {
    r = ch
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .replace(/[’‘ʼ`´]/g, "'")
      .replace(/[‐-―−]/g, '-');
    foldCache.set(ch, r);
  }
  return r;
}

const SPACE = /\s/;
const LETTER = /\p{L}/u;
// Césure typographique : « - » en fin de ligne (retour à la ligne présent) suivi d'une minuscule.
const HYPHEN_BREAK = /[ \t]*\n\s*(?=\p{Ll})/uy;

/**
 * Construit l'index d'un texte brut. Les retours à la ligne ('\n') doivent avoir été
 * insérés par l'appelant aux fins de lignes ; les césures « philoso-\nphie » sont recollées.
 */
export function buildIndex(raw: string): TextIndex {
  const clean: string[] = [];
  const c2r: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '­') continue;
    if (ch === '-' && i > 0 && LETTER.test(raw[i - 1])) {
      HYPHEN_BREAK.lastIndex = i + 1;
      if (HYPHEN_BREAK.test(raw)) {
        i = HYPHEN_BREAK.lastIndex - 1;
        continue;
      }
    }
    if (SPACE.test(ch)) {
      pendingSpace = clean.length > 0;
      continue;
    }
    if (pendingSpace) {
      clean.push(' ');
      c2r.push(i);
      pendingSpace = false;
    }
    clean.push(ch);
    c2r.push(i);
  }
  const cleanStr = clean.join('');
  const norm: string[] = [];
  const n2c: number[] = [];
  for (let j = 0; j < cleanStr.length; j++) {
    const f = fold(cleanStr[j]);
    for (let k = 0; k < f.length; k++) {
      norm.push(f[k]);
      n2c.push(j);
    }
  }
  return { clean: cleanStr, norm: norm.join(''), normToClean: Int32Array.from(n2c), cleanToRaw: Int32Array.from(c2r) };
}

/** Requête repliée de la même façon que le texte. */
export function normalizeQuery(q: string): string {
  return buildIndex(q).norm.trim();
}

export function findAll(index: TextIndex, qNorm: string, max = 1000): number[] {
  const out: number[] = [];
  if (!qNorm) return out;
  let from = 0;
  while (out.length < max) {
    const i = index.norm.indexOf(qNorm, from);
    if (i < 0) break;
    out.push(i);
    from = i + qNorm.length;
  }
  return out;
}

/** Étendue d'une occurrence (indices dans `norm`) dans `clean` et dans le texte brut. */
export function spanOf(index: TextIndex, ns: number, nlen: number) {
  const cleanStart = index.normToClean[ns];
  const cleanEnd = index.normToClean[ns + nlen - 1] + 1;
  return {
    cleanStart,
    cleanEnd,
    rawStart: index.cleanToRaw[cleanStart],
    rawEnd: index.cleanToRaw[cleanEnd - 1] + 1,
  };
}

/** Extrait d'environ 120 caractères autour d'une occurrence. */
export function makeSnippet(clean: string, cs: number, ce: number) {
  let a = Math.max(0, cs - 50);
  let b = Math.min(clean.length, ce + 70);
  if (a > 0) {
    const sp = clean.indexOf(' ', a);
    if (sp >= 0 && sp < cs) a = sp + 1;
  }
  if (b < clean.length) {
    const sp = clean.lastIndexOf(' ', b);
    if (sp > ce) b = sp;
  }
  const prefix = a > 0 ? '…' : '';
  const suffix = b < clean.length ? '…' : '';
  return { snippet: prefix + clean.slice(a, b) + suffix, matchStart: prefix.length + (cs - a), matchLength: ce - cs };
}

// ── Géométrie ──

export interface Px {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Fusionne des rectangles de texte par ligne (et sépare les colonnes éloignées). */
export function mergeLineRects(rects: Px[]): Px[] {
  const rs = rects
    .filter((r) => r.right - r.left > 0.5 && r.bottom - r.top > 0.5)
    .sort((a, b) => a.top + a.bottom - (b.top + b.bottom) || a.left - b.left);
  const lines: Px[][] = [];
  let lineTop = 0;
  let lineBottom = 0;
  for (const r of rs) {
    const last = lines[lines.length - 1];
    if (last) {
      const overlap = Math.min(lineBottom, r.bottom) - Math.max(lineTop, r.top);
      if (overlap > 0.5 * Math.min(lineBottom - lineTop, r.bottom - r.top)) {
        last.push(r);
        lineTop = Math.min(lineTop, r.top);
        lineBottom = Math.max(lineBottom, r.bottom);
        continue;
      }
    }
    lines.push([r]);
    lineTop = r.top;
    lineBottom = r.bottom;
  }
  const out: Px[] = [];
  for (const line of lines) {
    const top = Math.min(...line.map((r) => r.top));
    const bottom = Math.max(...line.map((r) => r.bottom));
    const tol = 0.8 * (bottom - top);
    line.sort((a, b) => a.left - b.left);
    let cur = { left: line[0].left, right: line[0].right };
    for (let i = 1; i < line.length; i++) {
      const r = line[i];
      if (r.left <= cur.right + tol) cur.right = Math.max(cur.right, r.right);
      else {
        out.push({ ...cur, top, bottom });
        cur = { left: r.left, right: r.right };
      }
    }
    out.push({ ...cur, top, bottom });
  }
  return out;
}

export function unionPx(rects: Px[]): Px | null {
  if (!rects.length) return null;
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
}

export function toNorm(r: Px, page: { left: number; top: number; width: number; height: number }) {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  const x = c((r.left - page.left) / page.width);
  const y = c((r.top - page.top) / page.height);
  const x2 = c((r.right - page.left) / page.width);
  const y2 = c((r.bottom - page.top) / page.height);
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return { x: round(x), y: round(y), w: round(x2 - x), h: round(y2 - y) };
}

// ── Lecture du calque de texte dans le DOM ──

export interface DomSeg {
  node: Text;
  /** Décalage de ce nœud dans le texte brut. */
  start: number;
}

/** Texte brut d'un calque de texte (nœuds texte + '\n' pour chaque <br>) avec la table des nœuds. */
export function collectDomText(layer: Element): { raw: string; segs: DomSeg[] } {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let raw = '';
  const segs: DomSeg[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n.nodeType === 3) {
      const t = n as Text;
      if (!t.data) continue;
      segs.push({ node: t, start: raw.length });
      raw += t.data;
    } else if ((n as Element).tagName === 'BR') raw += '\n';
  }
  return { raw, segs };
}

/** Rectangles (px client) couvrant [a, b[ du texte brut. */
export function rawSpanRects(segs: DomSeg[], a: number, b: number): Px[] {
  const out: Px[] = [];
  for (const s of segs) {
    const len = s.node.data.length;
    const from = Math.max(a, s.start) - s.start;
    const to = Math.min(b, s.start + len) - s.start;
    if (to <= from) continue;
    const r = document.createRange();
    r.setStart(s.node, from);
    r.setEnd(s.node, to);
    for (const q of Array.from(r.getClientRects())) out.push({ left: q.left, top: q.top, right: q.right, bottom: q.bottom });
  }
  return out;
}
