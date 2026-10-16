// Rousseau : l'habit arménien du portrait de Ramsay (1766). Visage doux, rasé de près, mèches brunes
// sous un bonnet de fourrure ; long cafetan prune-brun bordé de fourrure au col et à l'ourlet, ceinture
// nouée (une brindille de pervenche glissée dedans : il herborisait), bas blancs et souliers à boucle.
// Ce qui grandit : le bonnet de fourrure, petit et rond au niveau 0, tour de fourrure énorme au niveau 4.
import type { ReactNode } from 'react';
import type { CharacterDef, DrawArgs } from './types';

type P = [number, number];

const SKIN = '#f2d4bb';
const SKIN_HI = '#fbe8d8';
const SKIN_LO = '#dcae90';
const HAIR = '#4a3326';
const HAIR_HI = '#6e4f3c';
const FUR = '#6e4b30';
const FUR_HI = '#9c7350';
const FUR_LO = '#4e331f';
const BRIM = '#82593a';
const CAP_TOP = '#5d3a4c';
const ROBE = '#6d4a5c';
const ROBE_HI = '#86607a';
const ROBE_LO = '#4f3443';
const TRIM = '#8f6a48';
const TRIM_HI = '#b48c66';
const SASH = '#c9a04e';
const SASH_LO = '#a07a32';
const LEAF = '#6f9a4a';
const FLOWER = '#7d84d6';
const STOCKING = '#f1ece1';
const SHOE = '#2d2420';

// ── Outils de tracé ──────────────────────────────────────────

function subdivide(pts: P[], step: number): P[] {
  const out: P[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let j = 1; j <= n; j++) out.push([+(x0 + ((x1 - x0) * j) / n).toFixed(2), +(y0 + ((y1 - y0) * j) / n).toFixed(2)]);
  }
  return out;
}
/** Contour festonné (fourrure) : arcs d'un point au suivant ; sens horaire = touffes vers l'extérieur. */
function scallop(pts: P[], step: number, k = 0.6, sweep = 1): string {
  const q = subdivide(pts, step);
  let d = '';
  for (let i = 1; i < q.length; i++) {
    const r = Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]) * k;
    d += ` A${r.toFixed(2)} ${r.toFixed(2)} 0 0 ${sweep} ${q[i][0]} ${q[i][1]}`;
  }
  return d;
}
const M = (p: P) => `M${p[0]} ${p[1]}`;
const ink = { stroke: 'currentColor', strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

// ── Bonnet de fourrure ───────────────────────────────────────
// Par niveau : bas du bandeau (il descend sur le front, jusqu'aux sourcils), haut de la calotte (le cadre
// du dessin s'arrête juste au-dessus), demi-largeur de la calotte, et le sommet qui penche.
const CAP = [
  { brim: 22.4, bh: 6.4, bw: 29, top: 10, w: 19, wb: 23, lean: 0, k: 0.6 },
  { brim: 24, bh: 7, bw: 31, top: 6.4, w: 21.5, wb: 25.5, lean: 0.8, k: 0.58 },
  { brim: 26, bh: 7.6, bw: 33, top: 3.6, w: 24.5, wb: 28, lean: 2.2, k: 0.56 },
  { brim: 28.4, bh: 8.4, bw: 37.5, top: 1.8, w: 31, wb: 33, lean: 4, k: 0.53 },
  { brim: 31, bh: 9.4, bw: 42.5, top: 1.4, w: 37, wb: 38, lean: 6, k: 0.51 },
];

/** Calotte en tour : flancs presque droits (un peu renflés), sommet arrondi, qui penche de `lean`. */
function crownPath(cx: number, base: number, top: number, w: number, lean: number, level: number, wb: number, k: number): string {
  const h = base - top;
  const bulge = 0.6 + level * 0.7;
  const r = Math.min(w * 0.8, h * 0.62, 9.5);
  // la tour : base sur le bandeau, flancs qui montent (un peu renflés, la fourrure gonfle), sommet arrondi
  const pts: P[] = [
    [cx - wb + 1.6, base],
    [cx - (w + wb) / 2 - bulge + lean * 0.2, base - h * 0.3],
    [cx - w - bulge * 0.6 + lean * 0.6, base - h * 0.62],
    [cx - w + lean * 0.85, top + r],
    [cx - w * 0.58 + lean, top + r * 0.26],
    [cx + lean, top],
    [cx + w * 0.58 + lean, top + r * 0.26],
    [cx + w + lean * 0.85, top + r],
    [cx + w + bulge * 0.6 + lean * 0.6, base - h * 0.62],
    [cx + (w + wb) / 2 + bulge + lean * 0.2, base - h * 0.3],
    [cx + wb - 1.6, base],
  ];
  // contour lissé (Catmull-Rom → Bézier), puis festonné en petites touffes
  const smooth: P[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let t = 0; t < 1; t += 0.25) {
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      smooth.push([+f(p0[0], p1[0], p2[0], p3[0]).toFixed(2), +f(p0[1], p1[1], p2[1], p3[1]).toFixed(2)]);
    }
  }
  smooth.push(pts[pts.length - 1]);
  return M(smooth[0]) + scallop(smooth, 5 + level * 0.4, k) + ' Z';
}

/** Touffes : petits traits d'encre et reflets sur la fourrure. */
function Tufts({ pts, s = 1 }: { pts: P[]; s?: number }) {
  return (
    <g fill="none" strokeLinecap="round">
      {pts.map(([x, y], i) => (
        <g key={i}>
          <path d={`M${x - 1.6 * s} ${y - 1.2 * s} q${1.4 * s} ${2.6 * s} ${3.2 * s} ${0.4 * s}`} stroke={FUR_HI} strokeWidth={1.6} transform="translate(-0.5 -0.9)" />
          <path d={`M${x - 1.6 * s} ${y - 1.2 * s} q${1.4 * s} ${2.6 * s} ${3.2 * s} ${0.4 * s}`} stroke={FUR_LO} strokeWidth={1.4} />
        </g>
      ))}
    </g>
  );
}

/** Touffes réparties en rangées dans la calotte (de la base au sommet, qui penche). */
function crownTufts(cx: number, base: number, top: number, w: number, lean: number): P[] {
  const out: P[] = [];
  const h = base - top;
  const rows = Math.max(1, Math.round(h / 6.6));
  for (let i = 0; i < rows; i++) {
    const y = base - 3.4 - (i * (h - 6.4)) / Math.max(1, rows - 0.5);
    const t = (base - y) / h;
    const half = w * (i === rows - 1 && rows > 1 ? 0.52 : 0.74);
    const n = Math.max(2, Math.round((half * 2) / 8.4));
    for (let j = 0; j < n; j++) out.push([+(cx + lean * t - half + ((j + (i % 2 ? 0.75 : 0.3)) * half * 2) / n).toFixed(1), +y.toFixed(1)]);
  }
  return out;
}

/** Petit sommet de drap, au centre de la calotte. */
function CapTop({ x, y }: { x: number; y: number }) {
  return <path d={`M${x - 5.4} ${y + 3.6} Q${x} ${y - 0.4} ${x + 5.4} ${y + 3.6} Q${x} ${y + 5.8} ${x - 5.4} ${y + 3.6} Z`} fill={CAP_TOP} {...ink} strokeWidth={2} />;
}

function CapFront({ level, back }: { level: number; back?: boolean }) {
  const c = CAP[level];
  const lean = back ? -c.lean : c.lean;
  const by = c.brim; // bas du bandeau
  const bt = by - c.bh; // haut du bandeau
  const bw = c.bw;
  const base = bt + 2.4;
  const crown = crownPath(49, base, c.top, c.w, lean, level, c.wb, c.k);
  const brimTop: P[] = [[49 - bw, bt + 1], [49 - bw * 0.5, bt - 0.6], [49, bt - 1.2], [49 + bw * 0.5, bt - 0.6], [49 + bw, bt + 1]];
  const brimBot: P[] = [[49 + bw + 0.6, by - 1], [49 + bw * 0.5, by + 0.8], [49, by + 1.4], [49 - bw * 0.5, by + 0.8], [49 - bw - 0.6, by - 1]];
  const brim = M(brimTop[0]) + scallop(brimTop, 4.6, 0.6) + ` Q${49 + bw + 3} ${(bt + by) / 2} ${brimBot[0][0]} ${brimBot[0][1]}` + scallop(brimBot, 4.6, 0.6) + ` Q${49 - bw - 3} ${(bt + by) / 2} ${brimTop[0][0]} ${brimTop[0][1]} Z`;
  return (
    <g>
      <path d={crown} fill={FUR} {...ink} strokeWidth={2.8} />
      <path d={`M${49 - c.wb * 0.7} ${base - 2} Q${49 - c.w * 0.8 + lean * 0.5} ${(base + c.top) / 2} ${49 - c.w * 0.45 + lean} ${c.top + 4.6}`} fill="none" stroke={FUR_HI} strokeWidth={2.6} strokeLinecap="round" opacity={0.7} />
      <Tufts pts={crownTufts(49, base, c.top, c.w, lean)} />
      <CapTop x={49 + lean} y={c.top + 0.6} />
      <path d={brim} fill={BRIM} {...ink} strokeWidth={2.8} />
      <Tufts pts={subdivide([[49 - bw + 5, (bt + by) / 2], [49 + bw - 5, (bt + by) / 2]], 6.4)} s={0.9} />
    </g>
  );
}

function CapSide({ level }: { level: number }) {
  const c = CAP[level];
  // De profil : le bandeau suit le crâne, du front (à droite, au-dessus de l'œil) vers la nuque ; la tour penche en arrière.
  const fy = 17.6 + level * 1.1; // bas du bandeau au front
  const ny = fy + 10; // bas du bandeau à la nuque
  const bt = fy - c.bh - 1.6;
  const base = bt + 4;
  const top = Math.max(base - [7, 9.6, 12, 14, 16][level], 2.4);
  const cx = 54.6;
  const lean = -c.lean * 1.3;
  const w = c.w * 0.5 + 18;
  const crown = crownPath(cx, base, top, w, lean, level, w - 2, c.k);
  const tp: P[] = [[20.6, ny - c.bh - 1.6], [36, bt + 4.2], [54, bt + 1.4], [72, bt], [88.6, fy - c.bh]];
  const bot: P[] = [[89.4, fy], [72, fy + 1.4], [54, fy + 4.4], [36, ny + 0.6], [21, ny]];
  const brim = M(tp[0]) + scallop(tp, 4.6, 0.6) + ` Q91.6 ${fy - c.bh / 2} ${bot[0][0]} ${bot[0][1]}` + scallop(bot, 4.6, 0.6) + ` Q18.4 ${ny - c.bh / 2} ${tp[0][0]} ${tp[0][1]} Z`;
  return (
    <g>
      <path d={crown} fill={FUR} {...ink} strokeWidth={2.8} />
      <Tufts pts={crownTufts(cx, base, top, w, lean)} />
      <CapTop x={cx + lean} y={top + 0.6} />
      <path d={brim} fill={BRIM} {...ink} strokeWidth={2.8} />
      <Tufts pts={subdivide([[27, ny - c.bh / 2 - 0.6], [52, fy - c.bh / 2 + 1.2], [83, fy - c.bh / 2]], 6.4)} s={0.9} />
    </g>
  );
}

// ── Tête ─────────────────────────────────────────────────────

const FACE_FRONT = 'M49 11 C 67 11, 78.6 22, 78.6 38 C 78.6 51, 72.6 60.6, 61.4 64.8 C 55.4 67.2, 42.6 67.2, 36.6 64.8 C 25.4 60.6, 19.4 51, 19.4 38 C 19.4 22, 31 11, 49 11 Z';
const FACE_SIDE =
  'M32 47 C 22 40, 21 24, 33 15 C 45 7, 66 7, 78 12 C 86 16, 89 21, 89 27 L 92 33.4 C 93.2 35.6, 91.8 37.2, 89.4 37.4 C 90.4 40, 90.4 43, 89 45 C 89.6 50, 87 54.6, 81 55.6 C 73 57.2, 63 57.4, 57 55.6 C 49 55, 40 53.6, 32 47 Z';

function Grad({ id }: { id: string }) {
  return (
    <defs>
      <radialGradient id={id} cx="0.38" cy="0.34" r="0.78">
        <stop offset="0" stopColor={SKIN_HI} />
        <stop offset="0.55" stopColor={SKIN} />
        <stop offset="1" stopColor={SKIN_LO} />
      </radialGradient>
    </defs>
  );
}

function head({ view, level, uid }: DrawArgs): ReactNode {
  const g = `rs-skin-${uid}`;
  const c = CAP[level];
  if (view === 'side') {
    const ny = 27.6 + level * 1.1;
    return (
      <g>
        <Grad id={g} />
        <path d={FACE_SIDE} fill={`url(#${g})`} {...ink} strokeWidth={3.2} />
        {/* cheveux bruns sous le bonnet, jusqu'à la nuque */}
        <path d={`M24 ${ny - 2} C 22 ${ny + 10}, 26 ${ny + 18}, 34 50 C 40 52, 46 51, 50 47 C 47 42, 48 36, 56 ${ny + 2} Z`} fill={HAIR} {...ink} strokeWidth={2.4} />
        <path d={`M31 ${ny + 6} q2 5 6 7 M38 ${ny + 4} q1 6 6 9`} fill="none" stroke={HAIR_HI} strokeWidth={1.4} strokeLinecap="round" />
        <ellipse cx={53} cy={35} rx={5.2} ry={7.2} fill={SKIN} {...ink} strokeWidth={2.6} />
        <path d="M54.4 30.6 C 51 31.6, 51 37.6, 54 39" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" opacity={0.7} />
        <CapSide level={level} />
      </g>
    );
  }
  if (view === 'back')
    return (
      <g>
        <path d={FACE_FRONT} fill={SKIN} {...ink} strokeWidth={3.2} />
        <path d="M19.8 30 C 18 44, 24 56, 34 61 C 42 64.4, 56 64.4, 64 61 C 74 56, 80 44, 78.2 30 Z" fill={HAIR} {...ink} strokeWidth={2.6} />
        <path d="M34 40 q2 8 0 16 M44 42 q2 9 1 18 M54 42 q-1 9 0 18 M64 40 q-2 8 0 16" fill="none" stroke={HAIR_HI} strokeWidth={1.4} strokeLinecap="round" />
        <ellipse cx={16} cy={42} rx={4.6} ry={7} fill={SKIN} {...ink} strokeWidth={2.6} />
        <ellipse cx={82.4} cy={42} rx={4.6} ry={7} fill={SKIN} {...ink} strokeWidth={2.6} />
        <CapFront level={level} back />
      </g>
    );
  return (
    <g>
      <Grad id={g} />
      <ellipse cx={19} cy={42.4} rx={5} ry={7.2} fill={SKIN} {...ink} strokeWidth={2.6} />
      <ellipse cx={79} cy={42.4} rx={5} ry={7.2} fill={SKIN} {...ink} strokeWidth={2.6} />
      <path d="M20.6 40 C 19.6 43, 18.6 44, 20 46" fill="none" stroke="currentColor" strokeWidth={1.4} opacity={0.6} strokeLinecap="round" />
      <path d="M77.4 40 C 78.4 43, 79.4 44, 78 46" fill="none" stroke="currentColor" strokeWidth={1.4} opacity={0.6} strokeLinecap="round" />
      <path d={FACE_FRONT} fill={`url(#${g})`} {...ink} strokeWidth={3.2} />
      {/* mèches brunes aux tempes, sous le bandeau */}
      <path d={`M20.4 ${c.brim - 2} C 19.6 ${c.brim + 6}, 21 ${c.brim + 10}, 24.6 37.6 C 26.6 33, 27 ${c.brim + 4}, 30 ${c.brim} Z`} fill={HAIR} {...ink} strokeWidth={2.2} />
      <path d={`M77.6 ${c.brim - 2} C 78.4 ${c.brim + 6}, 77 ${c.brim + 10}, 73.4 37.6 C 71.4 33, 71 ${c.brim + 4}, 68 ${c.brim} Z`} fill={HAIR} {...ink} strokeWidth={2.2} />
      <CapFront level={level} />
    </g>
  );
}

function overFace({ view, pose, level }: DrawArgs): ReactNode {
  const brow = { fill: 'none', stroke: HAIR, strokeWidth: 2.2, strokeLinecap: 'round' as const };
  if (view === 'side')
    return (
      <g>
        {pose !== 'cigar' && level < 3 && <path d="M71 23.6 Q75.4 21.8 80 23.4" {...brow} />}
        <path d="M89.4 37.4 C 87.8 38, 86.2 37.6, 85.4 36.6" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" opacity={0.6} />
      </g>
    );
  return (
    <g>
      {pose !== 'cigar' && level < 4 && (
        // sourcils doux (au niveau 4, le bonnet les a avalés), un peu relevés au milieu
        <g>
          <path d="M31.4 34.4 Q36.6 31.6 42 33" {...brow} />
          <path d="M54 33 Q59.4 31.6 64.6 34.4" {...brow} />
        </g>
      )}
      <path d="M47.2 45.6 Q49.8 48.2 47.6 49.4" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" opacity={0.7} />
      {/* menton rond, rasé de près */}
      <path d="M44.6 60.6 Q48.6 62.4 52.6 60.6" fill="none" stroke={SKIN_LO} strokeWidth={1.5} strokeLinecap="round" />
    </g>
  );
}

// ── Corps ────────────────────────────────────────────────────

/** Ourlet de fourrure : une bande festonnée entre deux lignes (de gauche à droite). */
function furBand(top: P[], bot: P[]): string {
  return M(top[0]) + scallop(top, 4.4, 0.6, 0) + ` L${bot[bot.length - 1][0]} ${bot[bot.length - 1][1]}` + scallop([...bot].reverse(), 4.4, 0.6, 1) + ' Z';
}

/** Brindille de pervenche glissée dans la ceinture. */
function Sprig({ x, y, flip = 1 }: { x: number; y: number; flip?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip} 1)`}>
      <path d="M0 2 Q-0.6 -4 -2.6 -9" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M0 2 Q-0.6 -4 -2.6 -9" fill="none" stroke={LEAF} strokeWidth={1} strokeLinecap="round" />
      <ellipse cx={-3.4} cy={-4.4} rx={2.2} ry={1.1} transform="rotate(-30 -3.4 -4.4)" fill={LEAF} stroke="currentColor" strokeWidth={0.9} />
      <ellipse cx={1.4} cy={-6.4} rx={2.2} ry={1.1} transform="rotate(30 1.4 -6.4)" fill={LEAF} stroke="currentColor" strokeWidth={0.9} />
      <g transform="translate(-2.8 -10)">
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx={0} cy={-1.5} rx={1.1} ry={1.6} transform={`rotate(${a})`} fill={FLOWER} stroke="currentColor" strokeWidth={0.6} />
        ))}
        <circle cx={0} cy={0} r={0.7} fill="#f4e7a8" />
      </g>
    </g>
  );
}

function ShoeDefs() {
  // souliers sombres à boucle d'argent (dégradé à id fixe : partout identique ; à défaut, couleur unie)
  return (
    <defs>
      <radialGradient id="rousseau-shoe-buckle" cx="0.52" cy="0.34" r="0.5">
        <stop offset="0" stopColor="#e9e4d4" />
        <stop offset="0.32" stopColor="#c8c1ad" />
        <stop offset="0.36" stopColor={SHOE} />
        <stop offset="1" stopColor={SHOE} />
      </radialGradient>
    </defs>
  );
}

function body({ view, seated, pose }: DrawArgs): ReactNode {
  const jump = pose === 'jump';
  if (view === 'side') {
    // Assis : Sprite remonte le haut du corps de 8 ; les cuisses partent vers (49, 64) de ce repère.
    const robe = seated
      ? 'M43 45.6 Q39.6 56 40.6 68 Q44 75.6 56 75.2 L75.6 73 Q78 70 76.4 66 L59.6 63.6 Q59 54 56.4 45.4 Q50 42.4 43 45.6 Z'
      : jump
        ? 'M43 45.6 Q39.6 56 41 63 Q36 76 32.6 85 Q49 90 67.4 82.6 Q62 72 58.6 62 Q59 54 56.4 45.4 Q50 42.4 43 45.6 Z'
        : 'M43 45.6 Q39.6 56 41 63 Q38 82 37 100 Q50 103 63 100 Q61.6 80 58.6 62 Q59 54 56.4 45.4 Q50 42.4 43 45.6 Z';
    const hem = seated
      ? furBand([[56, 74.6], [66, 73.6], [75.8, 72.6]], [[56.4, 70.6], [66, 69.8], [75.2, 68.2]])
      : jump
        ? furBand([[32.8, 84.6], [49, 89.4], [67.2, 82.2]], [[34.8, 80.4], [49, 85], [65.2, 78.2]])
        : furBand([[37, 100], [50, 103], [63, 100]], [[37.4, 95.6], [50, 98.4], [62.6, 95.6]]);
    return (
      <g>
        <ShoeDefs />
        <path d="M45 34 L45.5 46 L53.5 46 L53 34 Z" fill={SKIN} {...ink} strokeWidth={1.8} />
        <path d={robe} fill={ROBE} {...ink} strokeWidth={2} />
        <path d={seated ? 'M44 66 Q56 70 72 69.6' : jump ? 'M45 66 Q43 76 41 84 M53 65 Q55 76 58 84' : 'M45 66 Q43 82 42 96 M53 65 Q55 82 56 97'} fill="none" stroke={ROBE_LO} strokeWidth={1.2} strokeLinecap="round" />
        <path d={hem} fill={TRIM} {...ink} strokeWidth={1.6} />
        {/* ceinture nouée, pans dans le dos */}
        <path d={`M41 ${seated ? 60 : 58.4} Q50 ${seated ? 61.6 : 60} 59 ${seated ? 60 : 58.4} L59.4 ${seated ? 64 : 62.6} Q50 ${seated ? 65.6 : 64.2} 40.8 ${seated ? 64 : 62.6} Z`} fill={SASH} {...ink} strokeWidth={1.6} />
        {!seated && <path d="M41.6 62 Q38.6 67 39.6 72 L42.6 71.4 Q42 67 43.6 63 Z" fill={SASH} {...ink} strokeWidth={1.4} />}
        <Sprig x={57} y={seated ? 61 : 59.4} />
        {/* col de fourrure */}
        <path d={furBand([[42, 45.4], [49.6, 42.6], [57, 45.4]], [[42.6, 49.4], [49.6, 47], [56.6, 49.6]])} fill={TRIM} {...ink} strokeWidth={1.6} />
      </g>
    );
  }
  const back = view === 'back';
  const hemY = seated ? 84 : jump ? 88 : 101;
  const spread = jump ? 5 : seated ? 1 : 0;
  const lx = 30.6 - spread;
  const rx = 68.4 + spread;
  const robe = `M42.6 43 Q49 46 55.4 43 L60.6 44.6 Q64.8 46.4 64 52 L62.4 60.6 Q${66 + spread} ${hemY - 18} ${rx} ${hemY} Q49.5 ${hemY + 3.4} ${lx} ${hemY} Q${33 - spread} ${hemY - 18} 36.6 60.6 L35 52 Q34.2 46.4 38.4 44.6 Z`;
  const hem = furBand(
    [[lx - 0.4, hemY], [49.5, hemY + 3.4], [rx + 0.4, hemY]],
    [[lx + 0.6, hemY - 4.6], [49.5, hemY - 1.4], [rx - 0.6, hemY - 4.6]],
  );
  return (
    <g>
      <ShoeDefs />
      <path d="M44.6 36 L44.6 46 L53.4 46 L53.4 36 Z" fill={SKIN} {...ink} strokeWidth={1.8} />
      <path d={robe} fill={ROBE} {...ink} strokeWidth={2} />
      {/* plis, et le pan croisé du cafetan */}
      <g fill="none" stroke={ROBE_LO} strokeWidth={1.2} strokeLinecap="round">
        <path d={`M41 66 Q39 ${hemY - 14} 37.6 ${hemY - 5} M58 66 Q60 ${hemY - 14} 61.4 ${hemY - 5}`} />
        {!back && <path d={`M51.2 64 Q53 ${hemY - 16} 52.4 ${hemY - 2}`} stroke="currentColor" strokeWidth={1.4} />}
        {back && <path d={`M49.5 64 L49.5 ${hemY - 2}`} />}
      </g>
      <path d="M40 47 Q38.6 53 39.6 58" fill="none" stroke={ROBE_HI} strokeWidth={1.4} strokeLinecap="round" />
      <path d={hem} fill={TRIM} {...ink} strokeWidth={1.6} />
      {/* ceinture */}
      <path d="M36.2 57.4 Q49.5 60.4 62.8 57.4 L62.6 62.6 Q49.5 65.6 36.4 62.6 Z" fill={SASH} {...ink} strokeWidth={1.6} />
      <path d="M38 60.2 Q49.5 63 61.2 60.2" fill="none" stroke={SASH_LO} strokeWidth={0.9} />
      {back ? (
        <g>
          <path d="M47 61 Q45.6 67 44.6 72 L47.6 72.4 Q48.6 67 49.6 62 Z M50.6 62 Q52 67 53.6 71.6 L56.4 70.6 Q54 66 52.4 61 Z" fill={SASH} {...ink} strokeWidth={1.3} />
          <ellipse cx={49.6} cy={61.4} rx={2.6} ry={2.2} fill={SASH} {...ink} strokeWidth={1.3} />
        </g>
      ) : (
        <g>
          <path d="M59 61.6 Q60.6 67 59.6 73 L62.6 73.4 Q63.6 67 61.6 61.2 Z" fill={SASH} {...ink} strokeWidth={1.3} />
          <ellipse cx={60.2} cy={60.4} rx={2.6} ry={2.2} fill={SASH} {...ink} strokeWidth={1.3} />
          <Sprig x={41.6} y={59.6} flip={-1} />
        </g>
      )}
      {/* col de fourrure */}
      <path d={furBand([[37, 45.6], [43, 43.6], [49, 46], [55, 43.6], [61, 45.6]], [[38.4, 49.4], [44, 48.4], [49, 51.6], [54, 48.4], [59.6, 49.4]])} fill={TRIM} {...ink} strokeWidth={1.6} />
      <path d="M41 46.4 q1.4 1.4 3 0.6 M52 47 q1.4 1.4 3 0.4" fill="none" stroke={TRIM_HI} strokeWidth={1.1} strokeLinecap="round" />
    </g>
  );
}

export const rousseau: CharacterDef = {
  id: 'rousseau',
  name: 'Rousseau',
  grows: 'son bonnet de fourrure',
  skin: SKIN,
  limbs: { arm: ROBE, leg: STOCKING, shoe: `url(#rousseau-shoe-buckle) ${SHOE}` },
  head,
  overFace,
  body,
};
