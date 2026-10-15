// ─────────────────────────────────────────────────────────────
// Export SVG : le centre de la carte (problématique / sujet) et la marque « +N » d'une branche
// repliée (pur, chaînes de caractères ; appelé par svg.ts).
// ─────────────────────────────────────────────────────────────
import type { MapNode } from '../../../lib/types';
import { CENTER_LABEL } from './center';
import { wrapText, type Rect, type SizeMap } from './geometry';

const INK = '#1d1a15';
const PAPER = '#fbf9f4';
const FONT_TEXT = "Georgia, 'Times New Roman', Times, serif";
const FONT_UI = 'Arial, Helvetica, sans-serif';
/** Teintes claires (src/styles/tokens.css) : celles des relations « répond à » et « se rattache à ». */
export const CENTER_COLOR = { question: '#c8693a', subject: '#4f8f9c' } as const;

export const CENTER_SVG_W = 360;
/** Caractères par ligne (Georgia 18 px dans 360 − 56 px). */
const charsFor = (w: number) => Math.max(18, Math.round((w - 56) / 9.6));
const LINE = 25;

const esc = (s: string) =>
  String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Rectangle du centre (taille mesurée si connue, sinon estimée : texte centré en 18 px). */
export function centerRect(n: MapNode, text: string, sizes?: SizeMap): Rect {
  const m = sizes?.[n.id];
  if (m) return { x: n.x, y: n.y, w: m.w, h: m.h };
  const lines = Math.max(1, wrapText(text || ' ', charsFor(CENTER_SVG_W), 6).length);
  return { x: n.x, y: n.y, w: CENTER_SVG_W, h: 66 + lines * LINE };
}

export function centerNodeSvg(n: MapNode, r: Rect, text: string): string {
  const kind = n.kind === 'subject' ? 'subject' : 'question';
  const c = CENTER_COLOR[kind];
  const cx = r.x + r.w / 2;
  const label = CENTER_LABEL[kind].toUpperCase();
  // Espace insécable devant « ? ! : ; » : le point d'interrogation ne reste jamais seul en fin de carte.
  const lines = wrapText((text || '…').replace(/\s+([?!:;»])/g, '\u0001$1'), charsFor(r.w), 6).map((l) => l.replace(/\u0001/g, '\u00a0'));
  const top = r.y + 58;
  const tspans = lines.map((l, i) => `<tspan x="${r1(cx)}" y="${r1(top + i * LINE)}">${esc(l)}</tspan>`).join('');
  const lw = label.length * 8.6 + 12;
  const mark =
    kind === 'question'
      ? `<circle cx="${r1(cx)}" cy="${r1(r.y)}" r="15" fill="${c}"/><text x="${r1(cx)}" y="${r1(r.y + 6.5)}" text-anchor="middle" font-family="${esc(FONT_TEXT)}" font-size="19" font-weight="bold" fill="#fff">?</text>`
      : `<circle cx="${r1(cx)}" cy="${r1(r.y)}" r="11" fill="${PAPER}" stroke="${c}" stroke-width="2"/><circle cx="${r1(cx)}" cy="${r1(r.y)}" r="4.5" fill="${c}"/>`;
  return (
    `<g class="node center" data-id="${esc(n.id)}" data-center="${kind}">` +
    `<rect x="${r1(r.x - 5)}" y="${r1(r.y - 5)}" width="${r1(r.w + 10)}" height="${r1(r.h + 10)}" rx="22" fill="none" stroke="${c}" stroke-opacity="0.28" stroke-width="1"/>` +
    `<rect x="${r1(r.x)}" y="${r1(r.y)}" width="${r1(r.w)}" height="${r1(r.h)}" rx="18" fill="#ffffff" stroke="${c}" stroke-width="1.6"/>` +
    `<line x1="${r1(cx - lw / 2 - 26)}" y1="${r1(r.y + 30)}" x2="${r1(cx - lw / 2 - 6)}" y2="${r1(r.y + 30)}" stroke="${c}" stroke-opacity="0.5"/>` +
    `<line x1="${r1(cx + lw / 2 + 6)}" y1="${r1(r.y + 30)}" x2="${r1(cx + lw / 2 + 26)}" y2="${r1(r.y + 30)}" stroke="${c}" stroke-opacity="0.5"/>` +
    `<text x="${r1(cx)}" y="${r1(r.y + 34)}" text-anchor="middle" font-family="${esc(FONT_UI)}" font-size="10.5" font-weight="bold" letter-spacing="1.6" fill="${c}">${esc(label)}</text>` +
    `<text text-anchor="middle" font-family="${esc(FONT_TEXT)}" font-size="18" fill="${INK}">${tspans}</text>` +
    mark +
    `</g>`
  );
}

/** Marque d'une branche repliée : cartes empilées derrière + pastille « +N » sous la carte. */
export function foldBadgeSvg(r: Rect, count: number): { behind: string; front: string } {
  const behind =
    `<rect x="${r1(r.x + 8)}" y="${r1(r.y + 8)}" width="${r1(r.w)}" height="${r1(r.h)}" rx="10" fill="#f3efe6" stroke="#d9d2c3"/>` +
    `<rect x="${r1(r.x + 4)}" y="${r1(r.y + 4)}" width="${r1(r.w)}" height="${r1(r.h)}" rx="10" fill="#f8f5ef" stroke="#d9d2c3"/>`;
  const t = `+${count}`;
  const w = t.length * 7.5 + 16;
  const x = r.x + r.w / 2 - w / 2;
  const y = r.y + r.h + 4;
  const front =
    `<g class="fold-badge"><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="20" rx="10" fill="${INK}"/>` +
    `<text x="${r1(x + w / 2)}" y="${r1(y + 14)}" text-anchor="middle" font-family="${esc(FONT_UI)}" font-size="11.5" font-weight="bold" fill="#fff">${esc(t)}</text></g>`;
  return { behind, front };
}
