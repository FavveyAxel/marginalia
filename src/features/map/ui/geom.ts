// Géométrie de manipulation (sans React) : aimantation, guides, collisions, voisinage.

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Guide {
  /** 'line' : alignement (bord ou centre) ; 'gap' : espacement égal (segment à extrémités). */
  kind: 'line' | 'gap';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

const overlapsY = (a: Box, b: Box) => a.y < b.y + b.h && b.y < a.y + a.h;
const overlapsX = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w;

interface Cand {
  d: number;
  guides: (m: Box) => Guide[];
}

/**
 * Aimante `m` (carte saisie) sur les autres : bords et centres alignés, espacements égaux.
 * `th` : distance d'attraction en unités de la carte. Renvoie le décalage à appliquer et les guides.
 */
export function snapBox(m: Box, others: Box[], th: number): SnapResult {
  const xs = (b: Box) => [b.x, b.x + b.w / 2, b.x + b.w];
  const ys = (b: Box) => [b.y, b.y + b.h / 2, b.y + b.h];
  let bestX: Cand | null = null;
  let bestY: Cand | null = null;
  const tryX = (c: Cand) => {
    if (Math.abs(c.d) <= th && (!bestX || Math.abs(c.d) < Math.abs(bestX.d) - 0.01)) bestX = c;
  };
  const tryY = (c: Cand) => {
    if (Math.abs(c.d) <= th && (!bestY || Math.abs(c.d) < Math.abs(bestY.d) - 0.01)) bestY = c;
  };

  // Alignements
  for (const o of others) {
    xs(m).forEach((mv) =>
      xs(o).forEach((ov) =>
        tryX({
          d: ov - mv,
          guides: (s) => {
            const lo = Math.min(s.y, o.y);
            const hi = Math.max(s.y + s.h, o.y + o.h);
            return [{ kind: 'line', x1: ov, y1: lo - 10, x2: ov, y2: hi + 10 }];
          },
        }),
      ),
    );
    ys(m).forEach((mv) =>
      ys(o).forEach((ov) =>
        tryY({
          d: ov - mv,
          guides: (s) => {
            const lo = Math.min(s.x, o.x);
            const hi = Math.max(s.x + s.w, o.x + o.w);
            return [{ kind: 'line', x1: lo - 10, y1: ov, x2: hi + 10, y2: ov }];
          },
        }),
      ),
    );
  }

  // Espacements égaux, horizontalement (voisins dont la bande verticale recoupe la carte)
  const row = others.filter((o) => overlapsY(o, m));
  const left = row.filter((o) => o.x + o.w <= m.x + th).sort((a, b) => b.x + b.w - (a.x + a.w));
  const right = row.filter((o) => o.x >= m.x + m.w - th).sort((a, b) => a.x - b.x);
  const midY = (a: Box, b: Box) => (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2;
  const hGap = (a: Box, b: Box): Guide => ({ kind: 'gap', x1: a.x + a.w, y1: midY(a, b), x2: b.x, y2: midY(a, b) });
  if (left[0] && right[0]) {
    const L = left[0];
    const R = right[0];
    const x = (L.x + L.w + R.x - m.w) / 2;
    tryX({ d: x - m.x, guides: (s) => [hGap(L, s), hGap(s, R)] });
  }
  if (left[0]) {
    const L = left[0];
    const LL = row.filter((o) => o !== L && o.x + o.w <= L.x + 1 && overlapsY(o, L)).sort((a, b) => b.x + b.w - (a.x + a.w))[0];
    if (LL) {
      const g = L.x - (LL.x + LL.w);
      if (g > 0) tryX({ d: L.x + L.w + g - m.x, guides: (s) => [hGap(LL, L), hGap(L, s)] });
    }
  }
  if (right[0]) {
    const R = right[0];
    const RR = row.filter((o) => o !== R && o.x >= R.x + R.w - 1 && overlapsY(o, R)).sort((a, b) => a.x - b.x)[0];
    if (RR) {
      const g = RR.x - (R.x + R.w);
      if (g > 0) tryX({ d: R.x - g - m.w - m.x, guides: (s) => [hGap(s, R), hGap(R, RR)] });
    }
  }
  // … et verticalement
  const col = others.filter((o) => overlapsX(o, m));
  const above = col.filter((o) => o.y + o.h <= m.y + th).sort((a, b) => b.y + b.h - (a.y + a.h));
  const below = col.filter((o) => o.y >= m.y + m.h - th).sort((a, b) => a.y - b.y);
  const midX = (a: Box, b: Box) => (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2;
  const vGap = (a: Box, b: Box): Guide => ({ kind: 'gap', x1: midX(a, b), y1: a.y + a.h, x2: midX(a, b), y2: b.y });
  if (above[0] && below[0]) {
    const A = above[0];
    const B = below[0];
    const y = (A.y + A.h + B.y - m.h) / 2;
    tryY({ d: y - m.y, guides: (s) => [vGap(A, s), vGap(s, B)] });
  }
  if (above[0]) {
    const A = above[0];
    const AA = col.filter((o) => o !== A && o.y + o.h <= A.y + 1 && overlapsX(o, A)).sort((a, b) => b.y + b.h - (a.y + a.h))[0];
    if (AA) {
      const g = A.y - (AA.y + AA.h);
      if (g > 0) tryY({ d: A.y + A.h + g - m.y, guides: (s) => [vGap(AA, A), vGap(A, s)] });
    }
  }

  const bx = bestX as Cand | null;
  const by = bestY as Cand | null;
  const dx = bx ? bx.d : 0;
  const dy = by ? by.d : 0;
  const snapped: Box = { ...m, x: m.x + dx, y: m.y + dy };
  const guides = [...(bx ? bx.guides(snapped) : []), ...(by ? by.guides(snapped) : [])];
  return { dx, dy, guides };
}

/**
 * Résolution douce des chevauchements : les cartes `fixed` (celles qu'on vient de poser)
 * ne bougent pas, leurs voisines s'écartent le long de l'axe le plus court.
 * Renvoie uniquement les positions modifiées.
 */
export function resolveCollisions(boxes: Box[], fixed: Set<string>, margin = 20, maxIter = 40): Map<string, Pt> {
  const bs = boxes.map((b) => ({ ...b }));
  const moved = new Set<string>();
  // Seules les cartes posées, et celles qu'elles poussent de proche en proche, bougent :
  // deux voisines qui se chevauchaient déjà avant le geste restent telles quelles.
  const active = new Set(fixed);
  for (let it = 0; it < maxIter; it++) {
    let any = false;
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i];
        const b = bs[j];
        if (!active.has(a.id) && !active.has(b.id)) continue;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + margin;
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + margin;
        if (ox <= 0 || oy <= 0) continue;
        const fa = fixed.has(a.id);
        const fb = fixed.has(b.id);
        if (fa && fb) continue;
        any = true;
        const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
        const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        // Axe de moindre déplacement ; sens : du centre de a vers celui de b.
        const horiz = ox < oy;
        const push = horiz ? ox : oy;
        const sgn = horiz ? (cb.x >= ca.x ? 1 : -1) : cb.y >= ca.y ? 1 : -1;
        const aa = active.has(a.id);
        const ab = active.has(b.id);
        const [ka, kb] = fa || (aa && !ab) ? [0, 1] : fb || (ab && !aa) ? [1, 0] : [0.5, 0.5];
        if (horiz) {
          a.x -= sgn * push * ka;
          b.x += sgn * push * kb;
        } else {
          a.y -= sgn * push * ka;
          b.y += sgn * push * kb;
        }
        if (ka) {
          moved.add(a.id);
          active.add(a.id);
        }
        if (kb) {
          moved.add(b.id);
          active.add(b.id);
        }
      }
    }
    if (!any) break;
  }
  const out = new Map<string, Pt>();
  for (const b of bs) if (moved.has(b.id)) out.set(b.id, { x: Math.round(b.x), y: Math.round(b.y) });
  return out;
}

/** Première place libre pour une carte `w×h`, en partant de `at` et en glissant selon `step`. */
export function freeSpot(at: Pt, w: number, h: number, boxes: Box[], step: Pt, margin = 24): Pt {
  const p = { ...at };
  for (let i = 0; i < 40; i++) {
    const hit = boxes.some((b) => p.x < b.x + b.w + margin && b.x < p.x + w + margin && p.y < b.y + b.h + margin && b.y < p.y + h + margin);
    if (!hit) return { x: Math.round(p.x), y: Math.round(p.y) };
    p.x += step.x;
    p.y += step.y;
  }
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Carte voisine dans une direction (flèches du clavier) : la plus proche dans un cône de ±60°. */
export function neighborIn(from: Box, boxes: Box[], dir: 'up' | 'down' | 'left' | 'right'): string | null {
  const c = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const v = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[dir];
  let best: { id: string; score: number } | null = null;
  for (const b of boxes) {
    if (b.id === from.id) continue;
    const d = { x: b.x + b.w / 2 - c.x, y: b.y + b.h / 2 - c.y };
    const along = d.x * v.x + d.y * v.y;
    if (along <= 1) continue;
    const across = Math.abs(d.x * v.y - d.y * v.x);
    if (across > along * 1.8) continue;
    const score = along + across * 2;
    if (!best || score < best.score) best = { id: b.id, score };
  }
  return best?.id ?? null;
}

export function bounds(boxes: Box[]): { x: number; y: number; w: number; h: number } | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

export type AlignKind = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'hspread' | 'vspread';

/** Aligne ou répartit des cartes ; renvoie les nouvelles positions. */
export function alignBoxes(boxes: Box[], kind: AlignKind): Map<string, Pt> {
  const out = new Map<string, Pt>();
  const bb = bounds(boxes);
  if (!bb || boxes.length < 2) return out;
  const set = (b: Box, x: number, y: number) => out.set(b.id, { x: Math.round(x), y: Math.round(y) });
  switch (kind) {
    case 'left':
      boxes.forEach((b) => set(b, bb.x, b.y));
      break;
    case 'center':
      boxes.forEach((b) => set(b, bb.x + bb.w / 2 - b.w / 2, b.y));
      break;
    case 'right':
      boxes.forEach((b) => set(b, bb.x + bb.w - b.w, b.y));
      break;
    case 'top':
      boxes.forEach((b) => set(b, b.x, bb.y));
      break;
    case 'middle':
      boxes.forEach((b) => set(b, b.x, bb.y + bb.h / 2 - b.h / 2));
      break;
    case 'bottom':
      boxes.forEach((b) => set(b, b.x, bb.y + bb.h - b.h));
      break;
    case 'hspread': {
      const s = [...boxes].sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2));
      const total = s.reduce((a, b) => a + b.w, 0);
      // Si les cartes se chevauchent, on impose un écart minimal.
      const gap = Math.max(24, (bb.w - total) / (s.length - 1));
      let x = s[0].x;
      s.forEach((b) => {
        set(b, x, b.y);
        x += b.w + gap;
      });
      break;
    }
    case 'vspread': {
      const s = [...boxes].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
      const total = s.reduce((a, b) => a + b.h, 0);
      const gap = Math.max(24, (bb.h - total) / (s.length - 1));
      let y = s[0].y;
      s.forEach((b) => {
        set(b, b.x, y);
        y += b.h + gap;
      });
      break;
    }
  }
  // Alignées sur une même colonne (ou ligne), des cartes peuvent se recouvrir :
  // on les écarte le long de l'autre axe, dans leur ordre actuel.
  const GAP = 24;
  if (kind === 'left' || kind === 'center' || kind === 'right') {
    const s = [...boxes].sort((a, b) => a.y - b.y);
    let bottom = -Infinity;
    for (const b of s) {
      const p = out.get(b.id)!;
      if (p.y < bottom + GAP) p.y = Math.round(bottom + GAP);
      bottom = p.y + b.h;
    }
  } else if (kind === 'top' || kind === 'middle' || kind === 'bottom') {
    const s = [...boxes].sort((a, b) => a.x - b.x);
    let right = -Infinity;
    for (const b of s) {
      const p = out.get(b.id)!;
      if (p.x < right + GAP) p.x = Math.round(right + GAP);
      right = p.x + b.w;
    }
  }
  return out;
}

/** Place libre la plus proche de `at` (recherche en anneaux), pour une carte w × h. */
export function nearestFree(at: Pt, w: number, h: number, boxes: Box[], margin = 24, stepPx = 40): Pt {
  const free = (x: number, y: number) => !boxes.some((b) => x < b.x + b.w + margin && b.x < x + w + margin && y < b.y + b.h + margin && b.y < y + h + margin);
  if (free(at.x, at.y)) return { x: Math.round(at.x), y: Math.round(at.y) };
  for (let r = 1; r <= 30; r++) {
    let best: Pt | null = null;
    let bd = Infinity;
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const x = at.x + i * stepPx;
        const y = at.y + j * stepPx;
        const d = Math.hypot(i * stepPx, j * stepPx * 1.4);
        if (d < bd && free(x, y)) {
          bd = d;
          best = { x, y };
        }
      }
    if (best) return { x: Math.round(best.x), y: Math.round(best.y) };
  }
  return { x: Math.round(at.x), y: Math.round(at.y) };
}
