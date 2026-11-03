// Vivaldi, « le prêtre roux » (il prete rosso), d'après l'image qu'en garde le XVIIIe siècle : visage
// allongé, nez marqué, yeux vifs ; ses propres cheveux, roux et ondulés, longs jusqu'aux épaules (pas
// de perruque poudrée) ; soutane noire de prêtre vénitien boutonnée de haut en bas, rabat blanc au
// col ; bas noirs et souliers à boucle.
// Ce qui grandit : la chevelure rousse — mi-longue au niveau 0 (elle effleure le cou), très longue et
// volumineuse au niveau 4 (elle tombe bien plus bas que les épaules, en grosses ondulations).
import type { ReactNode } from 'react';
import type { CharacterDef, DrawArgs } from './types';
import { Cigar, type Expr } from '../Sprite';

const SKIN = '#f1d2b8';
const SKIN_HI = '#fae6d6';
const SKIN_LO = '#d9a98a';
const HAIR = '#b9562a';
const HAIR_HI = '#de8445';
const HAIR_LO = '#7c3416';
const BROW = '#8a3c1a';
const CASSOCK = '#35333b';
const CASSOCK_HI = '#57545f';
const CASSOCK_LO = '#1e1d22';
const COLLAR = '#f7f4ec';
const COLLAR_LO = '#d6d0c4';
const STOCKING = '#2a292e';
const SHOE = '#1d1a19';

const ink = { stroke: 'currentColor', strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

// ── Chevelure ────────────────────────────────────────────────
// Par niveau (repère de la tête) : bas des mèches, écart supplémentaire de chaque côté, amplitude des ondulations.
const HAIRS = [
  { len: 66, w: 0, wave: 1.6 },
  { len: 73, w: 1.6, wave: 2 },
  { len: 81, w: 3.2, wave: 2.4 },
  { len: 90, w: 5, wave: 2.8 },
  { len: 100, w: 7, wave: 3.2 },
];

/** Bas visible de la chevelure, de face (repère de la tête ; les épaules sont vers y = 70). */
const FRONT_LEN = [62, 65, 67, 69, 71];

/** Bord ondulé vertical, de (x, y0) à (x, y1) : une suite de bosses qui s'écartent vers `out` (−1 / 1). */
function wavy(x: number, y0: number, y1: number, amp: number, out: number): string {
  const n = Math.max(2, Math.round((y1 - y0) / 11));
  const step = (y1 - y0) / n;
  let d = '';
  for (let i = 0; i < n; i++) {
    const ya = y0 + step * i;
    d += ` Q${x + out * amp * (i % 2 ? 0.4 : 1.6)} ${ya + step / 2} ${x + out * (i % 2 ? amp * 0.2 : 0)} ${ya + step}`;
  }
  return d;
}

/** Masse arrière (derrière le visage), de face : le volume qui descend sur les épaules. */
function HairBack({ level, back }: { level: number; back?: boolean }) {
  const h = HAIRS[level];
  const L = 19 - h.w;
  const R = 79 + h.w;
  // De face, la chevelure passe derrière les épaules : on n'en voit que le haut (de dos, toute sa longueur).
  const y = back ? h.len : FRONT_LEN[level];
  const d = `M49 4.6 C ${36 - h.w} 4.6, ${L + 2} 14, ${L} 30${wavy(L, 30, y - 4, h.wave, -1)} Q${L + 4} ${y + 2} ${L + 12} ${y - 1} Q49 ${y + (back ? 4 : -10)} ${R - 12} ${y - 1} Q${R - 4} ${y + 2} ${R} ${y - 4}${wavy(R, y - 4, 30, h.wave, 1)} C ${R - 2} 14, ${62 + h.w} 4.6, 49 4.6 Z`;
  return (
    <g>
      <path d={d} fill={HAIR} {...ink} strokeWidth={2.8} />
      {/* mèches : traits ondulés */}
      <g fill="none" stroke={HAIR_LO} strokeWidth={1.3} strokeLinecap="round">
        <path d={`M${L + 4} 36${wavy(L + 4, 36, y - 6, h.wave * 0.6, -1)}`} />
        <path d={`M${R - 4} 36${wavy(R - 4, 36, y - 6, h.wave * 0.6, 1)}`} />
        {back && (
          <>
            <path d={`M38 14${wavy(38, 14, y - 2, h.wave * 0.5, -1)}`} />
            <path d={`M49 10${wavy(49, 10, y + 1, h.wave * 0.5, 1)}`} />
            <path d={`M60 14${wavy(60, 14, y - 2, h.wave * 0.5, 1)}`} />
          </>
        )}
      </g>
      <path d={`M${L + 3} 26 Q${L + 1} 40 ${L + 3} 52`} fill="none" stroke={HAIR_HI} strokeWidth={1.8} strokeLinecap="round" />
    </g>
  );
}

/** Dessus et mèches du devant, de face : raie au milieu, deux bandeaux qui encadrent le front. */
function HairFront({ level }: { level: number }) {
  const h = HAIRS[level];
  const L = 19 - h.w;
  const R = 79 + h.w;
  // bandeaux : du sommet, par-dessus les tempes, jusqu'au bas des joues (sans toucher yeux ni bouche)
  const b = FRONT_LEN[level] - 2;
  const left = `M49 5 C 38 5, 27 10, ${L + 1} 24 C ${L - 1} 34, ${L + 1} 46, ${L + 3} ${b} L ${L + 8} ${b + 1} C 26 50, 25.4 40, 27 32 C 29 24, 36 19, 47.6 18.6 Z`;
  const right = `M49 5 C 60 5, 71 10, ${R - 1} 24 C ${R + 1} 34, ${R - 1} 46, ${R - 3} ${b} L ${R - 8} ${b + 1} C 72 50, 72.6 40, 71 32 C 69 24, 62 19, 50.4 18.6 Z`;
  return (
    <g>
      <path d={left} fill={HAIR} {...ink} strokeWidth={2.6} />
      <path d={right} fill={HAIR} {...ink} strokeWidth={2.6} />
      <g fill="none" stroke={HAIR_LO} strokeWidth={1.3} strokeLinecap="round">
        <path d="M46 10 Q34 13 28 26" />
        <path d="M52 10 Q64 13 70 26" />
        <path d={`M${L + 5} 32 Q${L + 3} 44 ${L + 6} ${b - 3}`} />
        <path d={`M${R - 5} 32 Q${R - 3} 44 ${R - 6} ${b - 3}`} />
      </g>
      <path d="M44 8.6 Q36 10.4 31 17" fill="none" stroke={HAIR_HI} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M54 8.6 Q61 10 65 14" fill="none" stroke={HAIR_HI} strokeWidth={1.6} strokeLinecap="round" />
    </g>
  );
}

// ── Tête ─────────────────────────────────────────────────────
// Visage plus allongé que celui de Rousseau.
const FACE_FRONT = 'M49 10.4 C 64.6 10.4, 74.6 21.6, 74.6 38 C 74.6 53.4, 69 63.6, 60 68.2 C 54.6 70.6, 43.4 70.6, 38 68.2 C 29 63.6, 23.4 53.4, 23.4 38 C 23.4 21.6, 33.4 10.4, 49 10.4 Z';
// De profil : nez marqué, un peu busqué.
const FACE_SIDE =
  'M32 47 C 22 40, 21 24, 33 15 C 45 7, 66 7, 78 12 C 85 15.6, 88 20, 88.6 25 Q 90 27.6 92.4 33 L 94 35.6 C 94.8 37.4, 93.2 38.6, 90.2 38.4 C 90.8 41, 90.4 43.4, 89 45.2 C 89.4 50.6, 86.6 55.6, 80.6 56.8 C 72.6 58.4, 63 58.4, 57 56.4 C 49 55.6, 40 53.6, 32 47 Z';

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
  const g = `vv-skin-${uid}`;
  const h = HAIRS[level];
  if (view === 'side') {
    const back = 20 - h.w * 0.8;
    const y = h.len - 4;
    // dessus : du front vers l'arrière, puis la longue masse qui tombe derrière l'oreille
    const dome = `M84 16.4 C 80 6, 64 2.6, 48 3.4 C ${back + 6} 4.4, ${back - 1} 16, ${back} 30${wavy(back, 30, y, h.wave, -1)} Q${back + 8} ${y + 4} ${back + 16} ${y - 2}${wavy(back + 16, y - 2, 44, h.wave * 0.5, 1)} C 40 44, 44 42, 48 40 C 52 34, 58 26, 66 21 C 72 18, 78 17.6, 84 16.4 Z`;
    return (
      <g>
        <Grad id={g} />
        <path d={FACE_SIDE} fill={`url(#${g})`} {...ink} strokeWidth={3.2} />
        <path d={dome} fill={HAIR} {...ink} strokeWidth={2.8} />
        <path d="M76 10 Q60 5.6 44 8" fill="none" stroke={HAIR_HI} strokeWidth={2.4} strokeLinecap="round" />
        <g fill="none" stroke={HAIR_LO} strokeWidth={1.3} strokeLinecap="round">
          <path d="M74 14.6 Q58 10.6 40 14" />
          <path d={`M${back + 5} 28${wavy(back + 5, 28, y - 4, h.wave * 0.6, -1)}`} />
          <path d={`M${back + 11} 34${wavy(back + 11, 34, y - 6, h.wave * 0.5, 1)}`} />
        </g>
      </g>
    );
  }
  if (view === 'back')
    return (
      <g>
        <path d={FACE_FRONT} fill={SKIN} {...ink} strokeWidth={3.2} />
        <HairBack level={level} back />
      </g>
    );
  return (
    <g>
      <Grad id={g} />
      <HairBack level={level} />
      <path d={FACE_FRONT} fill={`url(#${g})`} {...ink} strokeWidth={3.2} />
      <HairFront level={level} />
    </g>
  );
}

type FaceArgs = DrawArgs & { expr: Expr };

/** Bouche : fine, mobile, un sourire vif. */
function Mouth({ m, x, y, side, hot }: { m: Expr['mouth']; x: number; y: number; side?: boolean; hot: boolean }) {
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const };
  const w = side ? 2.4 : 3.6;
  switch (m) {
    case 'o':
    case 'puff':
      return <ellipse cx={x + 0.4} cy={y + 0.2} rx={m === 'o' ? 1.8 : 1.4} ry={m === 'o' ? 2.2 : 1.6} fill="#6a2a2a" stroke="currentColor" strokeWidth={1.3} />;
    case 'sleep':
      return <ellipse cx={x} cy={y + 0.4} rx={1.3} ry={0.9} fill="#6a2a2a" stroke="currentColor" strokeWidth={1} />;
    case 'flat':
      return <path d={`M${x - w} ${y + 0.2} Q${x} ${y + 0.6} ${x + w} ${y + 0.2}`} {...line} />;
    case 'tongue':
      return (
        <g>
          <path d={`M${x - w} ${y} Q${x} ${y + 1.2} ${x + w} ${y - 0.4}`} {...line} />
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
      return <path d={`M${x - w} ${y - 0.8} Q${x} ${y + 2.2} ${x + w} ${y - 0.8}`} {...line} />;
  }
}

/** Œil vif : rond, brun clair, une belle étincelle. */
function EyeFront({ cx, cy, e, gaze }: { cx: number; cy: number; e: Expr['eyes']; gaze: [number, number] }) {
  const lid = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round' as const };
  if (e === 'closed') return <path d={`M${cx - 4.8} ${cy + 0.4} Q${cx} ${cy + 2.8} ${cx + 4.8} ${cy + 0.4}`} {...lid} />;
  if (e === 'happy') return <path d={`M${cx - 4.8} ${cy + 1.4} Q${cx} ${cy - 2.8} ${cx + 4.8} ${cy + 1.4}`} {...lid} />;
  const gx = Math.max(-1.8, Math.min(1.8, gaze[0] * 0.8));
  const gy = Math.max(-1, Math.min(1, gaze[1] * 0.5));
  const eye = `M${cx - 5} ${cy} Q${cx} ${cy - 4.8} ${cx + 5} ${cy} Q${cx} ${cy + 4} ${cx - 5} ${cy} Z`;
  return (
    <g>
      <path d={eye} fill="#fbf4ea" />
      <circle cx={cx + gx} cy={cy + gy} r={2.8} fill="#6b3a1c" />
      <circle cx={cx + gx} cy={cy + gy} r={1.3} fill="#140c08" />
      <circle cx={cx + gx + 1} cy={cy - 1 + gy} r={0.85} fill="#fffaf0" />
      {e === 'lidded' && <path d={`M${cx - 5.2} ${cy} Q${cx} ${cy - 5.2} ${cx + 5.2} ${cy} L${cx + 5} ${cy + 0.4} Q${cx} ${cy - 0.8} ${cx - 5} ${cy + 0.4} Z`} fill={SKIN} />}
      <path d={eye} fill="none" stroke="currentColor" strokeWidth={0.9} strokeLinejoin="round" />
      <path d={e === 'lidded' ? `M${cx - 5.4} ${cy + 0.2} Q${cx} ${cy - 0.8} ${cx + 5.4} ${cy + 0.2}` : `M${cx - 5.4} ${cy} Q${cx} ${cy - 5.2} ${cx + 5.4} ${cy}`} {...lid} />
    </g>
  );
}

/** Le visage : yeux vifs, sourcils roux et mobiles, long nez marqué, bouche fine. */
function face({ view, expr }: FaceArgs): ReactNode {
  const brow = { fill: 'none', stroke: BROW, strokeWidth: 2.6, strokeLinecap: 'round' as const };
  if (view === 'side') {
    const gx = Math.max(-0.6, Math.min(1.2, expr.gaze[0] * 0.6));
    const gy = Math.max(-0.8, Math.min(0.8, expr.gaze[1] * 0.4));
    const lid = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round' as const };
    return (
      <g>
        {expr.eyes === 'closed' ? (
          <path d="M71.6 30.6 Q75.4 33 79.2 30.6" {...lid} />
        ) : expr.eyes === 'happy' ? (
          <path d="M71.6 31.6 Q75.4 27.6 79.2 31.6" {...lid} />
        ) : (
          <g>
            <path d="M72.4 31 Q76.4 26.6 80 30.4 Q77.6 33.8 72.4 31 Z" fill="#fbf4ea" />
            <circle cx={77.2 + gx} cy={30.6 + gy} r={2.2} fill="#6b3a1c" />
            <circle cx={77.6 + gx} cy={30.6 + gy} r={1} fill="#140c08" />
            <circle cx={78.1 + gx} cy={29.6 + gy} r={0.65} fill="#fffaf0" />
            {expr.eyes === 'lidded' && <path d="M72.2 31 Q76.4 26.2 80.2 30.4 L80 30.8 Q76 29.6 72.4 31.2 Z" fill={SKIN} />}
            <path d="M72.4 31 Q76.4 26.6 80 30.4 Q77.6 33.8 72.4 31 Z" fill="none" stroke="currentColor" strokeWidth={0.9} strokeLinejoin="round" />
            <path d={expr.eyes === 'lidded' ? 'M72 31.2 Q76 29.6 80.4 30.8' : 'M72 31 Q76.4 26.2 80.4 30.6'} {...lid} />
          </g>
        )}
        <path d={expr.browUp ? 'M70.6 24.6 Q75.6 20.4 81 23.6' : 'M70.6 25.8 Q75.6 22.6 81 24.8'} {...brow} />
        {/* narine */}
        <path d="M90 38.4 C 88.2 39.2, 86.6 38.6, 86.2 37.2" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
        <Mouth m={expr.mouth} x={85.6} y={43} side hot={expr.hot} />
        <path d="M84 49.6 Q86 51 88 50" fill="none" stroke={SKIN_LO} strokeWidth={1.3} strokeLinecap="round" />
      </g>
    );
  }
  return (
    <g>
      <EyeFront cx={37.6} cy={42.2} e={expr.eyes} gaze={expr.gaze} />
      <EyeFront cx={59} cy={42.2} e={expr.eyes} gaze={expr.gaze} />
      {/* sourcils roux, arqués, l'air vif (le gauche un peu plus haut) */}
      <path d={expr.browUp ? 'M30.8 34.2 Q36.6 28.6 43.4 32.6' : 'M30.8 35.4 Q36.8 30.8 43.4 33.6'} {...brow} />
      <path d={expr.browUp ? 'M53.4 32.6 Q60 28.6 66 34' : 'M53.4 33.6 Q60 31 66 35.2'} {...brow} />
      {/* long nez marqué */}
      <path d="M50.6 36.6 Q52.4 43 51.6 49.4" fill="none" stroke={SKIN_LO} strokeWidth={2} strokeLinecap="round" />
      <path d="M44.6 49.6 Q46.4 52.6 48.8 51.4 Q51.4 52.8 53.2 49.6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M46.6 38 L45.8 47.6" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" opacity={0.4} />
      <ellipse cx={29.8} cy={51} rx={3.4} ry={1.7} fill="#e8795f" opacity={0.26} />
      <ellipse cx={66.6} cy={51} rx={3.4} ry={1.7} fill="#e8795f" opacity={0.26} />
      <Mouth m={expr.mouth} x={48.8} y={55.6} hot={expr.hot} />
      {/* menton allongé */}
      <path d="M44.6 63.4 Q48.8 65 53 63.4" fill="none" stroke={SKIN_LO} strokeWidth={1.4} strokeLinecap="round" />
    </g>
  );
}

function ShoeDefs() {
  return (
    <defs>
      <radialGradient id="vivaldi-shoe-buckle" cx="0.52" cy="0.34" r="0.5">
        <stop offset="0" stopColor="#ece6d2" />
        <stop offset="0.32" stopColor="#c9bf9f" />
        <stop offset="0.36" stopColor={SHOE} />
        <stop offset="1" stopColor={SHOE} />
      </radialGradient>
    </defs>
  );
}

// ── Corps : soutane noire, rabat blanc ───────────────────────

function Button({ x, y, r = 0.95 }: { x: number; y: number; r?: number }) {
  return <circle cx={x} cy={y} r={r} fill={CASSOCK_HI} stroke="currentColor" strokeWidth={0.7} />;
}

/** Rabat blanc : deux petites bandes sous le col. */
function Rabat({ x = 49, side }: { x?: number; side?: boolean }) {
  if (side)
    return (
      <g>
        <path d="M44.6 41.4 L53.4 40.6 L54 43.6 L45.2 44.4 Z" fill={COLLAR} {...ink} strokeWidth={1.3} />
        <path d="M52 43.6 L55.8 43.2 L56.4 50.4 L53 50.8 Z" fill={COLLAR} {...ink} strokeWidth={1.2} />
      </g>
    );
  return (
    <g>
      <path d={`M${x - 6.4} 41.4 Q${x} 44.2 ${x + 6.4} 41.4 L${x + 6.8} 44.4 Q${x} 47.2 ${x - 6.8} 44.4 Z`} fill={COLLAR} {...ink} strokeWidth={1.3} />
      <path d={`M${x - 3.2} 45.6 L${x - 0.3} 45.6 L${x - 0.5} 52.6 L${x - 3.6} 52.2 Z`} fill={COLLAR} {...ink} strokeWidth={1.2} />
      <path d={`M${x + 0.3} 45.6 L${x + 3.2} 45.6 L${x + 3.6} 52.2 L${x + 0.5} 52.6 Z`} fill={COLLAR} {...ink} strokeWidth={1.2} />
      <path d={`M${x - 2} 47.6 L${x - 2.1} 51 M${x + 2} 47.6 L${x + 2.1} 51`} fill="none" stroke={COLLAR_LO} strokeWidth={0.8} strokeLinecap="round" />
    </g>
  );
}

function body({ view, seated, pose }: DrawArgs): ReactNode {
  const jump = pose === 'jump';
  if (view === 'side') {
    const robe = seated
      ? 'M43.4 44.6 Q40 55 40.4 66 Q42 75 54 75 L72 73.4 Q74.6 70.6 73 67 L59.6 64 Q59.6 54 56.8 45 Q50 42 43.4 44.6 Z'
      : jump
        ? 'M43.4 44.6 Q40 55 41 62 Q36 74 33 86 Q46 89 52 84 L58.8 66 Q59.6 54 56.8 45 Q50 42 43.4 44.6 Z'
        : 'M43.4 44.6 Q40 55 40.6 64 Q38.6 82 37.6 100 Q48 102.6 58 100 Q58.6 82 58.8 66 Q59.6 54 56.8 45 Q50 42 43.4 44.6 Z';
    const front = seated ? [] : jump ? [48, 53, 58, 63] : [48, 53, 58, 63, 68, 73, 78, 83, 88, 93];
    return (
      <g>
        <ShoeDefs />
        <path d="M45 34 L45.5 46 L53.5 46 L53 34 Z" fill={SKIN} {...ink} strokeWidth={1.8} />
        <path d={robe} fill={CASSOCK} {...ink} strokeWidth={2} />
        <g fill="none" stroke={CASSOCK_LO} strokeWidth={1.2} strokeLinecap="round">
          {seated ? <path d="M44 66 Q56 70 71 69" /> : <path d="M45 66 Q43.6 82 42.4 98 M51 70 Q51 84 50.6 99" />}
        </g>
        <path d="M44.6 47 Q43.4 53 44.2 60" fill="none" stroke={CASSOCK_HI} strokeWidth={1.4} strokeLinecap="round" />
        {/* boutons sur le devant, de haut en bas */}
        {(seated ? [48, 52.6, 57.2, 61.8] : front).map((y) => (
          <Button key={y} x={57.6 - Math.max(0, y - 66) * 0.035} y={y} />
        ))}
        <Rabat side />
      </g>
    );
  }
  const back = view === 'back';
  const hemY = seated ? 80 : jump ? 88 : 101;
  const spread = jump ? 6 : seated ? 1 : 1.5;
  const lx = 31 - spread;
  const rx = 68 + spread;
  const robe = `M42.6 42.6 Q49 45.6 55.4 42.6 L60.6 44.4 Q64.8 46.2 64 52 L62.6 60.6 Q${65 + spread} ${hemY - 18} ${rx} ${hemY} Q49.5 ${hemY + 3} ${lx} ${hemY} Q${34 - spread} ${hemY - 18} 36.4 60.6 L35 52 Q34.2 46.2 38.4 44.4 Z`;
  return (
    <g>
      <ShoeDefs />
      <path d="M44.6 36 L44.6 46 L53.4 46 L53.4 36 Z" fill={SKIN} {...ink} strokeWidth={1.8} />
      <path d={robe} fill={CASSOCK} {...ink} strokeWidth={2} />
      <g fill="none" stroke={CASSOCK_LO} strokeWidth={1.2} strokeLinecap="round">
        <path d={`M42.6 66 Q40.6 ${hemY - 12} 37.4 ${hemY - 1}`} />
        <path d={`M56.4 66 Q58.4 ${hemY - 12} 61.6 ${hemY - 1}`} />
      </g>
      {back ? (
        <g>
          <path d="M42 45.4 Q49.5 43.4 57 45.4 L56.6 48.4 Q49.5 46.6 42.4 48.4 Z" fill={CASSOCK} {...ink} strokeWidth={1.4} />
          <path d={`M49.5 50 L49.5 ${hemY - 2}`} fill="none" stroke={CASSOCK_LO} strokeWidth={1.2} strokeLinecap="round" />
        </g>
      ) : (
        <g>
          {/* fermeture au milieu : une longue rangée de petits boutons */}
          <path d={`M49.5 47 L49.5 ${hemY + 1.6}`} fill="none" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" />
          {Array.from({ length: Math.floor((hemY - 52) / 4.2) + 1 }, (_, i) => 52 + i * 4.2).map((y) => (
            <Button key={y} x={51.4} y={y} />
          ))}
          <path d="M38.4 47 Q37.4 53 38.4 58" fill="none" stroke={CASSOCK_HI} strokeWidth={1.4} strokeLinecap="round" />
          <path d="M60.6 47 Q61.6 53 60.6 58" fill="none" stroke={CASSOCK_HI} strokeWidth={1} strokeLinecap="round" opacity={0.6} />
          <Rabat />
        </g>
      )}
    </g>
  );
}

export const vivaldi: CharacterDef = {
  id: 'vivaldi',
  name: 'Vivaldi',
  grows: 'sa chevelure rousse',
  skin: SKIN,
  limbs: { arm: CASSOCK, leg: STOCKING, shoe: `url(#vivaldi-shoe-buckle) ${SHOE}` },
  head,
  face,
  body,
};
