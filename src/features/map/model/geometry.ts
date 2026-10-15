// ─────────────────────────────────────────────────────────────
// Géométrie de la carte d'argument (pur, sans DOM).
//
// Taille d'une carte : largeur fixe (NODE_W, comme .map-node) ; hauteur estimée d'après
// le texte (le rendu React Flow mesure la vraie hauteur, mais les fonctions du modèle,
// l'export SVG et les zones doivent marcher sans lui). Un appelant qui connaît les
// tailles mesurées peut les passer (`sizes`) à toutes les fonctions qui en ont besoin.
// ─────────────────────────────────────────────────────────────
import type { MapNode } from '../../../lib/types';

export const NODE_W = 280;
export const NODE_MIN_H = 64;
/** Caractères par ligne estimés à 14 px dans 280 − 30 px de marge intérieure. */
export const CHARS_PER_LINE = 34;
export const LINE_H = 19;
/** Lignes de texte affichées au plus pour une carte (le reste est tronqué « … »). */
export const MAX_LINES = 8;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Tailles mesurées par l'interface (id → largeur / hauteur), facultatives. */
export type SizeMap = Record<string, { w: number; h: number }>;

/** Découpe un texte en lignes d'au plus `max` caractères (coupure aux espaces, mots longs coupés). */
export function wrapText(text: string, max = CHARS_PER_LINE, maxLines = MAX_LINES): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let w of words) {
    while (w.length > max) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(w.slice(0, max - 1) + '-');
      w = w.slice(max - 1);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    const last = cut[maxLines - 1];
    cut[maxLines - 1] = (last.length > max - 1 ? last.slice(0, max - 1) : last).replace(/[\s,;:.]+$/, '') + '…';
    return cut;
  }
  return lines;
}

/** Hauteur estimée d'une carte qui affiche `lines` lignes (en-tête « Thèse · p. 12 » compris). */
export const heightForLines = (lines: number) => Math.max(NODE_MIN_H, 40 + Math.max(1, lines) * LINE_H + 12);

/** Rectangle d'une carte (taille mesurée si connue, sinon estimée d'après `text`). */
export function nodeRect(n: MapNode, text: string, sizes?: SizeMap): Rect {
  const m = sizes?.[n.id];
  if (m) return { x: n.x, y: n.y, w: m.w, h: m.h };
  const lines = n.collapsed ? Math.min(3, wrapText(text).length) : wrapText(text).length;
  return { x: n.x, y: n.y, w: NODE_W, h: heightForLines(lines) };
}

export function unionRects(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const r of rs) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Centre de `r` contenu dans `z` ? (règle d'appartenance d'une carte à une zone) */
export function centerInside(r: Rect, z: Rect): boolean {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h;
}
