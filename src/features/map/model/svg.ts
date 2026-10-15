// ─────────────────────────────────────────────────────────────
// Export SVG autonome d'une carte (pur : chaîne de caractères, sans DOM ni React Flow).
//
// Dessine, depuis les DONNÉES de la carte : zones (cadres titrés, repliées = bandeau seul),
// liens (courbes de Bézier fléchées, couleur et tirets de la relation, épaisseur selon la
// force, libellé au milieu), cartes (en-tête catégorie · auteur · page, texte coupé en lignes).
// Toujours sur fond clair (couleurs du thème clair, quel que soit le thème de l'app),
// polices sûres (Georgia / Arial), aucune ressource externe : le fichier s'ouvre partout.
//
// API :
//   mapToSvg(map, lk, opts?) → { svg, width, height, counts: { nodes, edges, zones } }
//     opts.sizes   : tailles mesurées des cartes (sinon estimées)
//     opts.title   : titre affiché en haut (défaut : aucun)
//     opts.padding : marge (40)
//   LIGHT_COLORS / resolveColor(name) : teintes claires des variables --cat-* / --rel-*.
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, MapEdge, MapNode, MapZone } from '../../../lib/types';
import { CATEGORY_BY_ID, RELATION_BY_ID } from '../../../lib/categories';
import { locatorOf } from '../../../lib/citation';
import { clean, highlightOf, mapKindOf, nodeText, type MapLookup } from './core';
import { LINE_H, nodeRect, unionRects, wrapText, type Rect, type SizeMap } from './geometry';
import { hiddenNodeIds } from './zones';
import { isCenter } from './center';
import { foldHiddenIds, foldInfo } from './fold';
import { centerNodeSvg, centerRect, foldBadgeSvg } from './svgCenter';

/** Valeurs du thème clair (src/styles/tokens.css). */
export const LIGHT_COLORS: Record<string, string> = {
  '--cat-probleme': '#c8693a',
  '--cat-these': '#d9a21b',
  '--cat-argument': '#3b9a5f',
  '--cat-objection': '#d4556b',
  '--cat-concept': '#3d7be0',
  '--cat-exemple': '#8c63d9',
  '--cat-plain': '#a8935c',
  '--rel-soutient': '#3b9a5f',
  '--rel-objecte': '#d4556b',
  '--rel-oppose': '#8a6a3b',
  '--rel-repond': '#c8693a',
  '--rel-precise': '#3d7be0',
  '--rel-illustre': '#8c63d9',
  '--rel-rattache': '#4f8f9c',
};
const INK = '#1d1a15';
const MUTED = '#6f675a';
const PAPER = '#fbf9f4';
const CARD = '#ffffff';
const POSTIT = '#fff4b8';
const BORDER = '#d9d2c3';
const FONT_TEXT = "Georgia, 'Times New Roman', Times, serif";
const FONT_UI = "Arial, Helvetica, sans-serif";

/** Couleur claire d'un nom de teinte (« --cat-these », « var(--cat-these) », « #abc »). */
export function resolveColor(name: string | undefined, fallback = MUTED): string {
  if (!name) return fallback;
  const v = name.trim().replace(/^var\((--[\w-]+)\)$/, '$1');
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  return LIGHT_COLORS[v] ?? fallback;
}

/** Échappement XML (et retrait des caractères de contrôle interdits en XML 1.0). */
export const xml = (s: string) =>
  String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const r1 = (n: number) => Math.round(n * 10) / 10;

export interface SvgOpts {
  sizes?: SizeMap;
  title?: string;
  padding?: number;
}

export interface SvgResult {
  svg: string;
  width: number;
  height: number;
  counts: { nodes: number; edges: number; zones: number };
}

const ZONE_BAR = 44;

export function mapToSvg(map: ArgumentMap, lk: MapLookup, opts: SvgOpts = {}): SvgResult {
  const pad = opts.padding ?? 40;
  // Cartes masquées : zones repliées et branches repliées (la carte s'exporte telle qu'on la voit).
  const hidden = new Set([...hiddenNodeIds(map), ...foldHiddenIds(map)]);
  const folds = foldInfo(map);
  const nodes = map.nodes.filter((n) => !hidden.has(n.id));
  const shown = new Set(nodes.map((n) => n.id));
  const edges = map.edges.filter((e) => shown.has(e.source) && shown.has(e.target));
  const zones = map.zones ?? [];
  const multiBook = mapKindOf(map) === 'board';

  const textOf = new Map(nodes.map((n) => [n.id, nodeText(n, lk)]));
  const rect = new Map<string, Rect>(nodes.map((n) => [n.id, isCenter(n) ? centerRect(n, textOf.get(n.id)!, opts.sizes) : nodeRect(n, textOf.get(n.id)!, opts.sizes)]));
  const zoneRect = (z: MapZone): Rect => (z.collapsed ? { x: z.x, y: z.y, w: z.w, h: ZONE_BAR } : z);
  const bb = unionRects([...rect.values(), ...zones.map(zoneRect)]) ?? { x: 0, y: 0, w: 400, h: 200 };
  const titleH = opts.title ? 48 : 0;
  const width = Math.ceil(bb.w + 2 * pad);
  const height = Math.ceil(bb.h + 2 * pad + titleH);
  const ox = pad - bb.x;
  const oy = pad + titleH - bb.y;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${xml(FONT_TEXT)}">`,
  );
  out.push(`<title>${xml(opts.title || 'Carte d’argument')}</title>`);
  // Flèches : un marqueur par relation (couleur de la relation).
  out.push('<defs>');
  for (const rel of Object.values(RELATION_BY_ID)) {
    out.push(
      `<marker id="arrow-${rel.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${resolveColor(rel.cssVar)}"/></marker>`,
    );
  }
  out.push('</defs>');
  out.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${PAPER}"/>`);
  if (opts.title) out.push(`<text x="${pad}" y="${pad + 8}" font-family="${xml(FONT_UI)}" font-size="20" font-weight="bold" fill="${INK}">${xml(opts.title)}</text>`);
  out.push(`<g transform="translate(${r1(ox)},${r1(oy)})">`);

  // Zones (les plus grandes d'abord, pour que les sous-zones restent visibles).
  out.push('<g class="zones">');
  for (const z of [...zones].sort((a, b) => b.w * b.h - a.w * a.h)) {
    const c = resolveColor(z.color);
    const zr = zoneRect(z);
    const count = z.collapsed ? ` (${(z.hiddenNodeIds ?? []).length} carte${(z.hiddenNodeIds ?? []).length > 1 ? 's' : ''})` : '';
    out.push(
      `<g class="zone" data-id="${xml(z.id)}"><rect x="${r1(zr.x)}" y="${r1(zr.y)}" width="${r1(zr.w)}" height="${r1(zr.h)}" rx="14" fill="${c}" fill-opacity="0.08" stroke="${c}" stroke-opacity="0.55" stroke-width="1.5"${z.collapsed ? '' : ' stroke-dasharray="6 4"'}/>` +
        `<text x="${r1(zr.x + 14)}" y="${r1(zr.y + 26)}" font-family="${xml(FONT_UI)}" font-size="15" font-weight="bold" fill="${c}">${xml(clean(z.title) || 'Zone')}${xml(count)}</text></g>`,
    );
  }
  out.push('</g>');

  // Liens.
  out.push('<g class="edges">');
  for (const e of edges) out.push(edgeSvg(e, rect.get(e.source)!, rect.get(e.target)!));
  out.push('</g>');

  // Cartes.
  out.push('<g class="nodes">');
  for (const n of nodes) {
    const r = rect.get(n.id)!;
    const f = n.folded ? folds.get(n.id) : undefined;
    const badge = f?.count ? foldBadgeSvg(r, f.count) : null;
    if (badge) out.push(badge.behind);
    out.push(isCenter(n) ? centerNodeSvg(n, r, textOf.get(n.id)!) : nodeSvg(n, r, textOf.get(n.id)!, lk, multiBook, n.id === map.centralId));
    if (badge) out.push(badge.front);
  }
  out.push('</g>');

  out.push('</g></svg>');
  return { svg: out.join('\n'), width, height, counts: { nodes: nodes.length, edges: edges.length, zones: zones.length } };
}

function anchors(s: Rect, t: Rect): { p0: [number, number]; p1: [number, number]; c0: [number, number]; c1: [number, number] } {
  const sc = [s.x + s.w / 2, s.y + s.h / 2];
  const tc = [t.x + t.w / 2, t.y + t.h / 2];
  const dx = tc[0] - sc[0];
  const dy = tc[1] - sc[1];
  // Vertical si les cartes sont plutôt l'une au-dessus de l'autre (cas usuel : arguments sous la thèse).
  if (Math.abs(dy) >= Math.abs(dx) * 0.6 && Math.abs(dy) > (s.h + t.h) / 2) {
    const down = dy > 0;
    const p0: [number, number] = [sc[0], down ? s.y + s.h : s.y];
    const p1: [number, number] = [tc[0], down ? t.y : t.y + t.h];
    const k = Math.max(30, Math.abs(p1[1] - p0[1]) / 2);
    return { p0, p1, c0: [p0[0], p0[1] + (down ? k : -k)], c1: [p1[0], p1[1] + (down ? -k : k)] };
  }
  const right = dx > 0;
  const p0: [number, number] = [right ? s.x + s.w : s.x, sc[1]];
  const p1: [number, number] = [right ? t.x : t.x + t.w, tc[1]];
  const k = Math.max(30, Math.abs(p1[0] - p0[0]) / 2);
  return { p0, p1, c0: [p0[0] + (right ? k : -k), p0[1]], c1: [p1[0] + (right ? -k : k), p1[1]] };
}

function edgeSvg(e: MapEdge, s: Rect, t: Rect): string {
  const rel = RELATION_BY_ID[e.relation] ?? RELATION_BY_ID.soutient;
  const c = resolveColor(rel.cssVar);
  const { p0, p1, c0, c1 } = anchors(s, t);
  const w = e.strength === 3 ? 3.2 : e.strength === 1 ? 1.2 : 2;
  const d = `M${r1(p0[0])},${r1(p0[1])} C${r1(c0[0])},${r1(c0[1])} ${r1(c1[0])},${r1(c1[1])} ${r1(p1[0])},${r1(p1[1])}`;
  // Milieu de la courbe (t = 0,5).
  const mx = (p0[0] + 3 * c0[0] + 3 * c1[0] + p1[0]) / 8;
  const my = (p0[1] + 3 * c0[1] + 3 * c1[1] + p1[1]) / 8;
  const label = rel.label;
  const lw = label.length * 6.4 + 14;
  const noteText = e.note?.trim() ?? '';
  const note = noteText ? `<title>${xml(noteText)}</title>` : '';
  // Note du lien (« par analogie »…) : en italique sous le nom de la relation.
  const shown = noteText.length > 60 ? noteText.slice(0, 59).trimEnd() + '…' : noteText;
  const nw = shown.length * 5.9 + 16;
  const noteSvg = shown
    ? `<rect class="edge-note" x="${r1(mx - nw / 2)}" y="${r1(my + 12)}" width="${r1(nw)}" height="18" rx="9" fill="${PAPER}" fill-opacity="0.92"/>` +
      `<text x="${r1(mx)}" y="${r1(my + 25)}" text-anchor="middle" font-size="11.5" font-style="italic" fill="${MUTED}">${xml(shown)}</text>`
    : '';
  return (
    `<g class="edge" data-id="${xml(e.id)}" data-relation="${rel.id}">${note}` +
    `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}"${rel.dashed ? ' stroke-dasharray="7 5"' : ''} marker-end="url(#arrow-${rel.id})"/>` +
    `<rect x="${r1(mx - lw / 2)}" y="${r1(my - 10)}" width="${r1(lw)}" height="20" rx="10" fill="${CARD}" stroke="${c}" stroke-width="1"/>` +
    `<text x="${r1(mx)}" y="${r1(my + 4)}" text-anchor="middle" font-family="${xml(FONT_UI)}" font-size="11" fill="${c}">${xml(label)}${noteText ? ' ✎' : ''}</text>${noteSvg}</g>`
  );
}

function nodeSvg(n: MapNode, r: Rect, text: string, lk: MapLookup, multiBook: boolean, central: boolean): string {
  const h = highlightOf(n, lk);
  const cat = h?.category ? CATEGORY_BY_ID[h.category] : null;
  const accent = cat ? resolveColor(cat.cssVar) : h ? resolveColor('--cat-plain') : resolveColor(n.color, '#c9a227');
  const fill = h ? CARD : n.color ? tint(resolveColor(n.color)) : POSTIT;
  const book = h ? lk.books.find((b) => b.id === h.bookId) : null;
  const head = [cat ? cat.label : h ? 'Extrait' : 'Idée', multiBook && book ? book.author || book.title : '', h ? locatorOf(h) : ''].filter(Boolean).join(' · ');
  const maxLines = n.collapsed ? 3 : undefined;
  const lines = wrapText(text, undefined, maxLines);
  const tx = r.x + 16;
  let y = r.y + 44;
  const tspans = lines.map((l, i) => `<tspan x="${r1(tx)}" y="${r1(y + i * LINE_H)}">${xml(l)}</tspan>`).join('');
  y += lines.length * LINE_H;
  return (
    `<g class="node" data-id="${xml(n.id)}"${h ? ` data-highlight="${xml(h.id)}"` : ''}>` +
    `<rect x="${r1(r.x)}" y="${r1(r.y)}" width="${r1(r.w)}" height="${r1(r.h)}" rx="10" fill="${fill}" stroke="${central ? INK : BORDER}" stroke-width="${central ? 2 : 1}"/>` +
    `<rect x="${r1(r.x)}" y="${r1(r.y + 8)}" width="4" height="${r1(Math.max(0, r.h - 16))}" rx="2" fill="${accent}"/>` +
    `<text x="${r1(tx)}" y="${r1(r.y + 24)}" font-family="${xml(FONT_UI)}" font-size="11" font-weight="bold" letter-spacing="0.4" fill="${accent}">${xml(head.toUpperCase())}</text>` +
    `<text font-size="14" fill="${INK}">${tspans}</text></g>`
  );
}

/** Teinte très claire (fond d'une idée colorée). */
function tint(hex: string): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m.slice(0, 6);
  const v = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  if (v.some((x) => Number.isNaN(x))) return POSTIT;
  return '#' + v.map((x) => Math.round(x + (255 - x) * 0.85).toString(16).padStart(2, '0')).join('');
}
