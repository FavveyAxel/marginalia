// Aristote : cheveux courts bouclés gris-brun (le front qui se dégarnit), barbe courte et nette,
// sourcils pensifs ; chiton ocre et himation terre cuite, sandales. Ce qui grandit : l'étui de cuir
// qu'il porte au dos (sangle en travers de la poitrine) et sa pile de rouleaux de papyrus — un ou deux
// rouleaux qui dépassent de l'épaule au niveau 0, une colonne branlante plus haute que lui au niveau 4.
import type { ReactNode } from 'react';
import type { CharacterDef, DrawArgs } from './types';
import { Cigar, type Expr, type Level } from '../Sprite';

type P = [number, number];

const SKIN = '#ecc6a0';
const SKIN_HI = '#f8e0c6';
const SKIN_LO = '#d6a17a';
const HAIR = '#8c7765';
const HAIR_HI = '#b9a996';
const HAIR_LO = '#5f4d3f';
const CHITON = '#ecc98a';
const CHITON_LO = '#d6ac66';
const HIMATION = '#c4643c';
const HIMATION_LO = '#9f4a2a';
const LEATHER = '#8a5634';
const LEATHER_LO = '#663c22';
const PAPYRUS = '#f3e6c4';
const PAPYRUS_LO = '#dcc89a';
const TIE = '#b8332b';

/** Contour festonné (boucles, barbe) : arcs d'un point au suivant ; sens horaire = bosses vers l'extérieur. */
function scallop(pts: P[], sweep = 1, k = 0.62, step = 0): string {
  if (step) pts = subdivide(pts, step);
  let d = '';
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const r = Math.hypot(x1 - x0, y1 - y0) * k;
    d += ` A${r.toFixed(2)} ${r.toFixed(2)} 0 0 ${sweep} ${x1} ${y1}`;
  }
  return d;
}
/** Points intermédiaires : des boucles plus petites et régulières (cheveux courts). */
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
const M = (p: P) => `M${p[0]} ${p[1]}`;
const L = (pts: P[]) => pts.map((p) => ` L${p[0]} ${p[1]}`).join('');

// ── Rouleaux ─────────────────────────────────────────────────
// Repère local : ouverture de l'étui en (0, 0), axe de l'étui vers le haut (−y), étui vers le bas.
type Scroll = { dx: number; h: number; a: number; tie?: boolean };
const SCROLLS: Scroll[][] = [
  [
    { dx: -2.2, h: 9, a: -5, tie: true },
    { dx: 2.4, h: 6.5, a: 6 },
  ],
  [
    { dx: -3.6, h: 13, a: -7, tie: true },
    { dx: 0.6, h: 10.5, a: 1 },
    { dx: 4, h: 7.5, a: 9 },
  ],
  [
    { dx: -4.4, h: 17, a: -8 },
    { dx: -0.8, h: 21, a: -1, tie: true },
    { dx: 3, h: 15, a: 5 },
    { dx: 5.2, h: 10, a: 12 },
  ],
  [
    { dx: -5, h: 23, a: -9, tie: true },
    { dx: -2, h: 29, a: -3 },
    { dx: 1.6, h: 26, a: 2, tie: true },
    { dx: 4.6, h: 20, a: 7 },
    { dx: 6, h: 13, a: 14 },
    { dx: -5.6, h: 14, a: -16 },
  ],
  [
    { dx: -5.6, h: 27, a: -10, tie: true },
    { dx: -2.6, h: 33, a: -4 },
    { dx: 0.8, h: 37, a: 0, tie: true },
    { dx: 4, h: 30, a: 5 },
    { dx: 6.2, h: 22, a: 11, tie: true },
    { dx: 6.8, h: 15, a: 18 },
    { dx: -6.4, h: 18, a: -18 },
  ],
];

function OneScroll({ s, w = 4.6 }: { s: Scroll; w?: number }) {
  const r = w / 2;
  return (
    <g transform={`translate(${s.dx} 0) rotate(${s.a})`}>
      <rect x={-r} y={-s.h} width={w} height={s.h + 8} fill={PAPYRUS} stroke="currentColor" strokeWidth={1.2} />
      <path d={`M${r - 1} ${-s.h + 1.6} L${r - 1} 6`} stroke={PAPYRUS_LO} strokeWidth={1.1} />
      {s.tie && <rect x={-r - 0.3} y={-s.h * 0.5 - 1} width={w + 0.6} height={2} fill={TIE} stroke="currentColor" strokeWidth={0.7} />}
      <ellipse cx={0} cy={-s.h} rx={r} ry={1.25} fill={PAPYRUS} stroke="currentColor" strokeWidth={1.2} />
      <ellipse cx={0} cy={-s.h} rx={r * 0.5} ry={0.6} fill="none" stroke="currentColor" strokeWidth={0.7} />
    </g>
  );
}

/** Étui de cuir et ses rouleaux (repère local). `len` : longueur visible de l'étui. */
function ScrollCase({ level, len = 24 }: { level: Level; len?: number }) {
  const list = SCROLLS[level];
  const top = Math.max(...list.map((s) => s.h));
  return (
    <g strokeLinejoin="round">
      <ellipse cx={0} cy={0} rx={7} ry={2.4} fill={LEATHER_LO} stroke="currentColor" strokeWidth={1.4} />
      {list.map((s, i) => (
        <OneScroll key={i} s={s} />
      ))}
      {level === 4 && (
        // le rouleau posé en travers au sommet, en équilibre précaire
        <g transform={`translate(-1 ${-top - 2.6}) rotate(-24)`}>
          <rect x={-9} y={-2.2} width={18} height={4.4} fill={PAPYRUS} stroke="currentColor" strokeWidth={1.2} />
          <rect x={-1} y={-2.5} width={2} height={5} fill={TIE} stroke="currentColor" strokeWidth={0.7} />
          <ellipse cx={9} cy={0} rx={1.2} ry={2.2} fill={PAPYRUS} stroke="currentColor" strokeWidth={1.2} />
          <ellipse cx={9} cy={0} rx={0.6} ry={1.1} fill="none" stroke="currentColor" strokeWidth={0.7} />
        </g>
      )}
      {level >= 2 && (
        // une ficelle rouge qui tient la botte
        <path d={`M-7.4 ${-5.5} Q0 ${-3.6} 7.6 ${-6.4}`} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" />
      )}
      {level >= 2 && <path d={`M-7.4 ${-5.5} Q0 ${-3.6} 7.6 ${-6.4}`} fill="none" stroke={TIE} strokeWidth={1.3} strokeLinecap="round" />}
      <path d={`M-7 0 L-7 ${len - 3} Q-7 ${len} -4 ${len} L4 ${len} Q7 ${len} 7 ${len - 3} L7 0 A7 2.4 0 0 1 -7 0 Z`} fill={LEATHER} stroke="currentColor" strokeWidth={1.6} />
      <path d={`M-7 3.2 A7 2.4 0 0 0 7 3.2`} fill="none" stroke={LEATHER_LO} strokeWidth={1.6} />
      <path d={`M-4.6 6 L-4.6 ${len - 3}`} fill="none" stroke="#a8724a" strokeWidth={1.2} strokeLinecap="round" />
      <path d={`M-7 ${len * 0.62} A7 2.4 0 0 0 7 ${len * 0.62}`} fill="none" stroke="currentColor" strokeWidth={0.8} strokeDasharray="1.2 1.2" opacity={0.7} />
    </g>
  );
}

// ── Tête ─────────────────────────────────────────────────────

const FACE_FRONT = 'M49 10 C 67 10, 79 21, 79 38 C 79 52, 72 61, 61 65 C 55 67.5, 43 67.5, 37 65 C 26 61, 19 52, 19 38 C 19 21, 31 10, 49 10 Z';
const FACE_SIDE =
  'M32 47 C 22 39, 21 21, 33 11 C 45 2, 66 2, 78 9 C 86 14, 89 21, 89 27 L 92.5 33.5 C 93.6 35.6, 92.2 37.2, 89.6 37.4 C 90.6 40, 90.6 43, 89.2 45 C 89.2 50, 86 55, 80 56.5 C 72 58.5, 62 58.5, 56 56.5 C 48 56, 40 54, 32 47 Z';

const HAIR_FRONT =
  M([17, 43]) +
  scallop([[17, 43], [15.6, 32.6], [17.4, 22.6], [23, 15], [31.4, 9.4], [40.6, 6.6], [49.6, 5.8], [58.6, 6.6], [67.8, 9.4], [76.2, 15], [81.8, 22.6], [83.4, 32.6], [81.6, 43]], 1, 0.6, 5) +
  L([[78.4, 42]]) +
  scallop([[78.4, 42], [76.8, 33], [73.6, 26.4], [68, 24.8], [62, 20], [55.4, 16.8], [49.6, 17.2], [43.8, 16.8], [37.2, 20], [31.2, 24.8], [25.6, 26.4], [22.4, 33], [20.8, 42]], 1, 0.6, 4) +
  ' Z';
const HAIR_BACK =
  M([16.5, 46]) +
  scallop([[16.5, 46], [15.6, 32.6], [17.4, 22.6], [23, 15], [31.4, 9.4], [40.6, 6.6], [49.6, 5.8], [58.6, 6.6], [67.8, 9.4], [76.2, 15], [81.8, 22.6], [83.4, 32.6], [82, 46]], 1, 0.6, 5) +
  scallop([[82, 46], [77, 54], [68.5, 58.5], [58.5, 61], [49, 61.6], [39.5, 61], [29.5, 58.5], [21.5, 54], [16.5, 46]], 1, 0.6, 4.6) +
  ' Z';
const HAIR_SIDE =
  M([44, 51]) +
  scallop([[44, 51], [35, 49.6], [27.4, 43], [23.6, 33], [24.2, 22], [29.4, 13], [37.8, 7.2], [48.4, 4.6], [56.4, 4.4]], 1, 0.6, 5) +
  scallop([[56.4, 4.4], [60.6, 9.6], [63, 16.4], [62.4, 23.4], [59.6, 29.6], [58.4, 36.5], [52.5, 44.5], [44, 51]], 1, 0.6, 4) +
  ' Z';
const BEARD_FRONT =
  M([21, 41]) +
  scallop([[21, 41], [20, 50.5], [24, 59], [31, 65.5], [40, 69.6], [49, 70.8], [58, 69.6], [67, 65.5], [74, 59], [78, 50.5], [77, 41]], 1, 0.6, 4.4) +
  ' C 74 46, 72.5 52, 66.5 56 C 61 58.6, 56 57.4, 53 58 C 51 59.8, 45 59.8, 43 58 C 40 57.4, 35 58.6, 29.5 56 C 23.5 52, 22.5 46, 21 41 Z';
const BEARD_SIDE =
  M([58.6, 37]) +
  scallop([[58.6, 37], [58.4, 46], [62.6, 53], [70, 58], [78.4, 59.4], [85.6, 57], [89.8, 52], [90.4, 46.8]], 1, 0.6, 4.4) +
  ' C 88 47.8, 84 47.6, 80.5 47.2 C 75 46.8, 69 44.6, 65 40.5 C 62.5 38, 61 36, 58.6 37 Z';

/** Petites boucles (traits d'encre) sur la chevelure. */
const CURLS_FRONT = ['M20.6 25 q2.6 -2.4 5 0.2', 'M28.6 15.6 q3 -2.4 5.4 0.2', 'M40.6 11.2 q3 -2.2 5.4 0.4', 'M53.4 11.2 q3 -2.2 5.4 0.4', 'M66 15.6 q3 -2.4 5.4 0.2', 'M74.6 25 q2.6 -2.4 5 0.2', 'M18.2 35 q2.4 -2.2 4.4 0.4', 'M77.6 35 q2.4 -2.2 4.4 0.4'];
const CURLS_BACK = [...CURLS_FRONT, 'M26 34 q3 -2.4 5.6 0.2', 'M42 30 q3 -2.4 5.6 0.2', 'M58 34 q3 -2.4 5.6 0.2', 'M34 46 q3 -2.4 5.6 0.2', 'M52 48 q3 -2.4 5.6 0.2', 'M68 44 q3 -2.4 5.6 0.2', 'M48 20 q3 -2.4 5.6 0.2', 'M30 22 q3 -2.4 5.6 0.2', 'M64 22 q3 -2.4 5.6 0.2'];
const CURLS_SIDE = ['M32.6 15 q3 -2.4 5.4 0.4', 'M45 9.6 q3 -2.4 5.4 0.4', 'M28 27 q3 -2.4 5.4 0.4', 'M40 21 q3 -2.4 5.4 0.4', 'M52 15 q2.6 -2 5 0.4', 'M31 38 q3 -2.4 5.4 0.4', 'M40 32 q3 -2.4 5.4 0.4', 'M38 45 q3 -2 5 0.4'];

function Curls({ list }: { list: string[] }) {
  return (
    <g fill="none" strokeLinecap="round">
      <g stroke={HAIR_HI} strokeWidth={1.6} transform="translate(-0.4 -0.9)">
        {list.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g stroke={HAIR_LO} strokeWidth={1.4}>
        {list.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </g>
  );
}

function Grad({ id }: { id: string }) {
  return (
    <defs>
      <radialGradient id={id} cx="0.38" cy="0.32" r="0.78">
        <stop offset="0" stopColor={SKIN_HI} />
        <stop offset="0.55" stopColor={SKIN} />
        <stop offset="1" stopColor={SKIN_LO} />
      </radialGradient>
    </defs>
  );
}

function head({ view, uid }: DrawArgs): ReactNode {
  const g = `ar-skin-${uid}`;
  const ink = { stroke: 'currentColor', strokeLinejoin: 'round' as const };
  if (view === 'side')
    return (
      <g>
        <Grad id={g} />
        <path d={FACE_SIDE} fill={`url(#${g})`} {...ink} strokeWidth={3.2} />
        <path d={HAIR_SIDE} fill={HAIR} {...ink} strokeWidth={2.8} />
        <Curls list={CURLS_SIDE} />
        <g>
          <ellipse cx={52} cy={33} rx={5.4} ry={7.6} fill={SKIN} {...ink} strokeWidth={2.6} />
          <path d="M53.5 28.5 C 50 29.5, 50 36, 53 37.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" opacity={0.7} />
        </g>
        <path d={BEARD_SIDE} fill={HAIR} {...ink} strokeWidth={2.6} />
        <path d="M66 50 q3 -2 5.4 0.4 M76 54 q3 -2 5.4 0.4" fill="none" stroke={HAIR_LO} strokeWidth={1.3} strokeLinecap="round" />
      </g>
    );
  if (view === 'back')
    return (
      <g>
        <path d={FACE_FRONT} fill={SKIN} {...ink} strokeWidth={3.2} />
        <path d={HAIR_BACK} fill={HAIR} {...ink} strokeWidth={2.8} />
        <Curls list={CURLS_BACK} />
        <ellipse cx={15.6} cy={41} rx={4.6} ry={7} fill={SKIN} {...ink} strokeWidth={2.6} />
        <ellipse cx={83} cy={41} rx={4.6} ry={7} fill={SKIN} {...ink} strokeWidth={2.6} />
      </g>
    );
  return (
    <g>
      <Grad id={g} />
      <ellipse cx={18.6} cy={42} rx={5} ry={7.4} fill={SKIN} {...ink} strokeWidth={2.6} />
      <ellipse cx={79.6} cy={42} rx={5} ry={7.4} fill={SKIN} {...ink} strokeWidth={2.6} />
      <path d={FACE_FRONT} fill={`url(#${g})`} {...ink} strokeWidth={3.2} />
      <path d={BEARD_FRONT} fill={HAIR} {...ink} strokeWidth={2.6} />
      <path d="M31 62 q3 -2 5.4 0.6 M45 66 q3 -2 5.4 0.4 M60 62.6 q3 -2 5.4 -0.2" fill="none" stroke={HAIR_LO} strokeWidth={1.3} strokeLinecap="round" />
      <path d={HAIR_FRONT} fill={HAIR} {...ink} strokeWidth={2.8} />
      <Curls list={CURLS_FRONT} />
      {/* rides du front, le penseur */}
      <path d="M40 27.5 Q49 25.6 58 27.5" fill="none" stroke={SKIN_LO} strokeWidth={1.4} strokeLinecap="round" />
    </g>
  );
}

type FaceArgs = DrawArgs & { expr: Expr };

/** Bouche (repère de la tête) : lèvres fines, au milieu de la barbe. */
function Mouth({ m, x, y, side, hot }: { m: Expr['mouth']; x: number; y: number; side?: boolean; hot: boolean }) {
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const };
  const w = side ? 2.6 : 3.8;
  switch (m) {
    case 'o':
    case 'puff':
      return <ellipse cx={x + 0.4} cy={y + 0.4} rx={m === 'o' ? 1.9 : 1.5} ry={m === 'o' ? 2.2 : 1.7} fill="#5a1f1a" stroke="currentColor" strokeWidth={1.3} />;
    case 'sleep':
      return <ellipse cx={x} cy={y + 0.4} rx={1.4} ry={1} fill="#5a1f1a" stroke="currentColor" strokeWidth={1} />;
    case 'flat':
      return <path d={`M${x - w} ${y} L${x + w} ${y}`} {...line} />;
    case 'tongue':
      return (
        <g>
          <path d={`M${x - w} ${y} Q${x} ${y + 1} ${x + w} ${y - 0.4}`} {...line} />
          <ellipse cx={x + w - 0.2} cy={y + 0.8} rx={1.3} ry={1.1} fill="#d9606a" stroke="currentColor" strokeWidth={0.7} />
        </g>
      );
    case 'cigar':
      return (
        <g>
          <path d={`M${x - w} ${y} Q${x - 0.6} ${y + 0.8} ${x + 1.6} ${y + 0.2}`} {...line} />
          {side ? <Cigar x={86.2} y={42.6} rot={6} len={11} hot={hot} /> : <Cigar x={50.2} y={52.6} rot={14} len={13} hot={hot} />}
        </g>
      );
    case 'smirk':
      return <path d={`M${x - w} ${y + 0.4} Q${x} ${y + 1.4} ${x + w + 0.4} ${y - 1.6}`} {...line} />;
    default:
      return <path d={`M${x - w} ${y - 0.4} Q${x} ${y + 2.2} ${x + w} ${y - 0.4}`} {...line} />;
  }
}

/** Œil d'Aristote de face : petit, enfoncé sous l'arcade, paupière lourde. */
function EyeFront({ cx, cy, e, gaze, flip }: { cx: number; cy: number; e: Expr['eyes']; gaze: [number, number]; flip: number }) {
  const lid = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const };
  // creux de l'orbite
  const socket = <path d={`M${cx - 6} ${cy - 1} Q${cx} ${cy - 5.4} ${cx + 6} ${cy - 1}`} fill="none" stroke={SKIN_LO} strokeWidth={2.4} strokeLinecap="round" opacity={0.75} />;
  if (e === 'closed') return <g>{socket}<path d={`M${cx - 4.4} ${cy} Q${cx} ${cy + 2.2} ${cx + 4.4} ${cy}`} {...lid} /></g>;
  if (e === 'happy') return <g>{socket}<path d={`M${cx - 4.4} ${cy + 1} Q${cx} ${cy - 2.4} ${cx + 4.4} ${cy + 1}`} {...lid} /></g>;
  const gx = Math.max(-1.6, Math.min(1.6, gaze[0] * 0.7));
  const gy = Math.max(-0.8, Math.min(0.8, gaze[1] * 0.4));
  const almond = `M${cx - 4.6} ${cy + 0.2} Q${cx - 0.6 * flip} ${cy - 3.2} ${cx + 4.6} ${cy - 0.2} Q${cx + 0.4 * flip} ${cy + 2.4} ${cx - 4.6} ${cy + 0.2} Z`;
  return (
    <g>
      {socket}
      <path d={almond} fill="#fbf3e6" />
      <circle cx={cx + gx} cy={cy + 0.1 + gy} r={1.9} fill="#2e2118" />
      <circle cx={cx + gx + 0.6} cy={cy - 0.5 + gy} r={0.55} fill="#fffaf0" />
      {e === 'lidded' && <path d={`M${cx - 4.8} ${cy + 0.3} Q${cx} ${cy - 3.6} ${cx + 4.8} ${cy - 0.1} L${cx + 4.6} ${cy + 0.2} Q${cx} ${cy - 0.4} ${cx - 4.6} ${cy + 0.6} Z`} fill={SKIN} />}
      <path d={almond} fill="none" stroke="currentColor" strokeWidth={0.9} strokeLinejoin="round" />
      <path d={e === 'lidded' ? `M${cx - 4.8} ${cy + 0.6} Q${cx} ${cy - 0.6} ${cx + 4.8} ${cy + 0.2}` : `M${cx - 4.8} ${cy + 0.2} Q${cx - 0.6 * flip} ${cy - 3.4} ${cx + 4.8} ${cy - 0.3}`} {...lid} />
    </g>
  );
}

/** Le visage du buste de Lysippe : yeux petits et enfoncés, sourcils lourds, nez droit, lèvres fines, moustache. */
function face({ view, expr }: FaceArgs): ReactNode {
  const brow = { fill: 'none', stroke: HAIR_LO, strokeWidth: 3, strokeLinecap: 'round' as const };
  if (view === 'side') {
    const gx = Math.max(-0.6, Math.min(1.2, expr.gaze[0] * 0.6));
    const gy = Math.max(-0.8, Math.min(0.8, expr.gaze[1] * 0.4));
    const lid = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const };
    return (
      <g>
        <path d="M70.6 27.2 Q76 24.6 81.6 27" fill="none" stroke={SKIN_LO} strokeWidth={2.4} strokeLinecap="round" opacity={0.75} />
        {expr.eyes === 'closed' ? (
          <path d="M72.6 30.4 Q75.8 32.4 79 30.4" {...lid} />
        ) : expr.eyes === 'happy' ? (
          <path d="M72.6 31.2 Q75.8 28 79 31.2" {...lid} />
        ) : (
          <g>
            <path d="M73 30.6 Q76.6 27.8 79.6 30 Q77.6 32.6 73 30.6 Z" fill="#fbf3e6" stroke="currentColor" strokeWidth={0.9} strokeLinejoin="round" />
            <circle cx={77.4 + gx} cy={30.4 + gy} r={1.6} fill="#2e2118" />
            {expr.eyes === 'lidded' && <path d="M72.8 30.6 Q76.6 27.4 79.8 30 L79.6 30.4 Q76 29.6 73 30.8 Z" fill={SKIN} />}
            <path d={expr.eyes === 'lidded' ? 'M72.6 30.8 Q76 29.4 80 30.2' : 'M72.6 30.6 Q76.6 27.4 80 29.8'} {...lid} />
          </g>
        )}
        <path d={expr.browUp ? 'M70 24.6 Q75.4 20.4 81.6 23.8' : 'M70 26 Q75.6 23.4 82 25.4'} {...brow} />
        {/* nez droit : l'arête rejoint le front, une narine */}
        <path d="M89.4 37.6 C 88 38.4, 86.4 38, 85.8 36.8" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
        {/* moustache tombante */}
        <path d="M81.6 40.8 C 84 39.6, 87.6 39.4, 90.4 40.2 C 89.6 41.6, 87 41.6, 85 41.4 C 83.6 41.6, 82.4 41.8, 81.6 40.8 Z" fill={HAIR} stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
        <Mouth m={expr.mouth} x={85.2} y={43} side hot={expr.hot} />
      </g>
    );
  }
  return (
    <g>
      <EyeFront cx={37.4} cy={42.6} e={expr.eyes} gaze={expr.gaze} flip={1} />
      <EyeFront cx={58.6} cy={42.6} e={expr.eyes} gaze={expr.gaze} flip={-1} />
      {/* sourcils lourds, un peu froncés au milieu (le penseur) */}
      <path d={expr.browUp ? 'M30.6 35.6 Q36 30.2 43.4 34.6' : 'M30.4 37.2 Q36.4 34.2 43.6 36.4'} {...brow} />
      <path d="M52.4 36.4 Q59.6 34.2 65.6 37.2" {...brow} />
      {/* nez droit, long, ombre d'un côté */}
      <path d="M46 38.6 L45.2 47.6" fill="none" stroke={SKIN_LO} strokeWidth={1.8} strokeLinecap="round" />
      <path d="M44.2 48.4 Q45.4 50.4 48 49.8 Q50.6 50.4 51.8 48.4" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      <path d="M50.6 39.4 L51.4 46.6" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" opacity={0.55} />
      {/* moustache */}
      <path d="M39.6 54.6 C 41 51, 45 50.6, 48 51.4 C 51 50.6, 55 51, 56.4 54.6 C 54 53, 51 52.6, 48 53 C 45 52.6, 42 53, 39.6 54.6 Z" fill={HAIR} stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
      <Mouth m={expr.mouth} x={48} y={55.4} hot={expr.hot} />
      {expr.mouth === 'smile' || expr.mouth === 'flat' ? <path d="M46 57.6 Q48 58.4 50 57.6" fill="none" stroke={SKIN_LO} strokeWidth={1.3} strokeLinecap="round" /> : null}
    </g>
  );
}

// ── Corps ────────────────────────────────────────────────────

const ink = { stroke: 'currentColor', strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

function Neck({ side }: { side?: boolean }) {
  return side ? <path d="M45 34 L45.5 46 L53.5 46 L53 34 Z" fill={SKIN} {...ink} strokeWidth={1.8} /> : <path d="M44.6 36 L44.6 46 L53.4 46 L53.4 36 Z" fill={SKIN} {...ink} strokeWidth={1.8} />;
}

/** Sangle de l'étui, en travers de la poitrine. */
function Strap({ d }: { d: string }) {
  return (
    <g fill="none" strokeLinecap="round">
      <path d={d} stroke="currentColor" strokeWidth={4.4} />
      <path d={d} stroke={LEATHER} strokeWidth={2.4} />
    </g>
  );
}

function body({ view, level, seated, pose }: DrawArgs): ReactNode {
  const jump = pose === 'jump';
  if (view === 'side') {
    // Assis : Sprite remonte le haut du corps de 8 ; les cuisses partent vers (49, 64) de ce repère.
    const hem = seated
      ? 'M42.6 47 Q40 56 41 68 Q46 74.5 58 74 L74 72.5 Q76.5 70 75 66.5 L59 63.5 Q58.5 54 56.6 46.6'
      : jump
        ? 'M42.6 47 Q40 56 41.5 62 Q37 74 34 82 Q49 87 66 80 Q61 72 58 62 Q58.5 54 56.6 46.6'
        : 'M42.6 47 Q40 56 41.5 62 Q39 76 38.5 90 Q50 93 61.5 90 Q60.5 76 58 62 Q58.5 54 56.6 46.6';
    return (
      <g>
        <g transform="translate(35.5 45) rotate(-15)">
          <ScrollCase level={level} len={23} />
        </g>
        <Neck side />
        <path d={`${hem} Q50 42.6 42.6 47 Z`} fill={CHITON} {...ink} strokeWidth={2} />
        {/* himation : drapé sur l'épaule (au dos), enroulé autour des hanches */}
        <path
          d={
            seated
              ? 'M42.6 47.2 Q40 56 41 68 Q46 74.5 58 74 L74 72.5 Q76.5 70 75 66.5 L59 63.5 Q56 60 51 57 Q46 52 45 46.6 Z'
              : jump
                ? 'M42.6 47.2 Q40 56 41.5 62 Q37 74 34 82 Q49 87 66 80 Q61 72 58 62 Q55 59 51 57 Q46 52 45 46.6 Z'
                : 'M42.6 47.2 Q40 56 41.5 62 Q39.5 75 39.4 86.5 Q50 89.6 60.8 86.5 Q60 74 58 62 Q55 59 51 57 Q46 52 45 46.6 Z'
          }
          fill={HIMATION}
          {...ink}
          strokeWidth={2}
        />
        <g fill="none" stroke={HIMATION_LO} strokeWidth={1.2}>
          {seated ? <path d="M48 64 Q58 69 70 69 M46 59 Q50 66 47 72" /> : <path d="M45 66 Q47 76 45 86 M52 63 Q55 74 54 87 M42.6 58 Q48 62 56.6 62" />}
        </g>
        <Strap d="M47.6 45.6 Q53 52 56.2 58.8" />
      </g>
    );
  }
  const back = view === 'back';
  const hemY = seated ? 80 : jump ? 84 : 91;
  const hemX = seated ? 33 : jump ? 30 : 32;
  const tunic = `M43 43.4 Q49 46.6 55 43.4 L60.6 44.8 Q64.6 46.6 63.8 52 L62 60.5 Q${66 + (jump ? 3 : 0)} ${hemY - 14} ${100 - hemX} ${hemY} Q49.5 ${hemY + 3} ${hemX} ${hemY} Q${33 - (jump ? 3 : 0)} ${hemY - 14} 36.6 60.5 L34.6 52 Q33.6 46.6 37.4 44.8 Z`;
  // himation : de face, sur l'épaule gauche (à droite de l'image), en diagonale jusqu'à la hanche, puis jusqu'aux genoux
  const hy = hemY - 5;
  const him = back
    ? `M43 43.4 L37.4 44.8 Q33.6 46.6 34.6 52 L36.6 60.5 Q${33 - (jump ? 3 : 0)} ${hy - 13} ${hemX + 1} ${hy} Q49.5 ${hy + 3} ${99 - hemX} ${hy} Q${66 + (jump ? 3 : 0)} ${hy - 13} 62 60.5 Q54 59.6 48 54 Q44 49 43 43.4 Z`
    : `M55 43.4 L60.6 44.8 Q64.6 46.6 63.8 52 L62 60.5 Q${66 + (jump ? 3 : 0)} ${hy - 13} ${99 - hemX} ${hy} Q49.5 ${hy + 3} ${hemX + 1} ${hy} Q${33 - (jump ? 3 : 0)} ${hy - 13} 36.6 60.5 Q45 59.6 51 54 Q55 49 55 43.4 Z`;
  const folds = back
    ? `M38 66 Q41 ${hy - 10} 39.5 ${hy - 1} M46 63 Q48 ${hy - 8} 47 ${hy} M56 61.6 Q57 ${hy - 10} 58 ${hy}`
    : `M61 66 Q58 ${hy - 10} 59.5 ${hy - 1} M53 63 Q51 ${hy - 8} 52 ${hy} M43 61.6 Q42 ${hy - 10} 41 ${hy}`;
  return (
    <g>
      {!back && (
        <g transform="translate(31.5 47) rotate(-17)">
          <ScrollCase level={level} />
        </g>
      )}
      <Neck />
      <path d={tunic} fill={CHITON} {...ink} strokeWidth={2} />
      <path d={back ? 'M45 47 Q49 49.6 53 47' : 'M44.6 46 Q49 49 53.4 46'} fill="none" stroke={CHITON_LO} strokeWidth={1.3} strokeLinecap="round" />
      <path d={him} fill={HIMATION} {...ink} strokeWidth={2} />
      <path d={back ? 'M44.2 45 Q45 52 49 55.4 Q55 60.4 61.2 61.6' : 'M53.8 45 Q53 52 49 55.4 Q43 60.4 36.8 61.6'} fill="none" stroke={HIMATION_LO} strokeWidth={1.6} strokeLinecap="round" />
      <path d={folds} fill="none" stroke={HIMATION_LO} strokeWidth={1.2} strokeLinecap="round" />
      {/* sangle de l'étui, de l'épaule droite (à gauche de l'image) à la hanche gauche */}
      {back ? <Strap d="M59 45.2 Q50 54 41 63" /> : <Strap d="M39.6 45.2 Q49 54 58.6 63" />}
      {!back && <rect x={47} y={52} width={4.4} height={3.4} rx={0.8} fill="#d9b25a" stroke="currentColor" strokeWidth={1} transform="rotate(45 49.2 53.7)" />}
    </g>
  );
}

/** De dos, l'étui est ce qu'on voit en premier : il passe devant la nuque. */
function front({ view, level }: DrawArgs): ReactNode {
  if (view !== 'back') return null;
  return (
    <g transform="translate(56 45) rotate(14)">
      <ScrollCase level={level} len={22} />
    </g>
  );
}

export const aristote: CharacterDef = {
  id: 'aristote',
  name: 'Aristote',
  grows: 'sa pile de rouleaux',
  skin: SKIN,
  limbs: { arm: SKIN, leg: SKIN, shoe: '#8a5a36' },
  head,
  face,
  body,
  front,
};
