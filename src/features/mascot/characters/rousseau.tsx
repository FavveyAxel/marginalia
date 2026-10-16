// Rousseau : d'après le pastel de Quentin de La Tour (1753) et la gravure qui en est tirée. Visage
// ovale rasé de près, yeux sombres et rieurs, sourcils arqués, long nez droit, petit sourire en coin et
// fossettes ; perruque poudrée gris clair (dessus lisse tiré en arrière, boucles roulées sur les oreilles,
// queue nouée d'un ruban noir) ; habit à la française olive-brun (col droit, boutons couverts, poches à
// rabat), veste assortie, cravate blanche ; bas blancs et souliers à boucle. Une brindille de pervenche
// à la boutonnière : il herborisait.
// Ce qui grandit : la perruque — modeste au niveau 0 (une boucle de chaque côté), immense et poudrée au
// niveau 4 (quatre grosses boucles, du volume sur le dessus, longue queue et grand nœud noir).
import type { ReactNode } from 'react';
import type { CharacterDef, DrawArgs } from './types';
import { Cigar, type Expr } from '../Sprite';

type P = [number, number];

const SKIN = '#f2d4bb';
const SKIN_HI = '#fbe8d8';
const SKIN_LO = '#dcae90';
const HAIR = '#5a4232';
const WIG = '#e6e3de';
const WIG_HI = '#faf8f4';
const WIG_LO = '#b8b2aa';
const RIBBON = '#1f1a17';
const COAT = '#857352';
const COAT_HI = '#a08d68';
const COAT_LO = '#5f5137';
const VEST = '#9a8862';
const CRAVAT = '#f7f4ec';
const CRAVAT_LO = '#d6d0c4';
const LEAF = '#6f9a4a';
const FLOWER = '#7d84d6';
const STOCKING = '#f1ece1';
const SHOE = '#2d2420';

const ink = { stroke: 'currentColor', strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

// ── Perruque ─────────────────────────────────────────────────
// Par niveau : haut du dessus (le cadre s'arrête juste au-dessus), demi-largeur du dessus, nombre de
// boucles de chaque côté, taille des boucles, longueur de la queue (repère de la tête), taille du nœud.
const WIGS = [
  { top: 6.4, w: 31, rolls: 1, rx: 7, ry: 4, queue: 64, bow: 0.8 },
  { top: 4, w: 33, rolls: 2, rx: 7.6, ry: 4, queue: 70, bow: 0.95 },
  { top: 1.8, w: 35.5, rolls: 2, rx: 8.6, ry: 4.6, queue: 78, bow: 1.1 },
  { top: 0.2, w: 38.5, rolls: 3, rx: 9.2, ry: 4.6, queue: 88, bow: 1.3 },
  { top: -0.6, w: 42, rolls: 4, rx: 10, ry: 4.8, queue: 100, bow: 1.55 },
];

/** Boucle roulée vue par le bout : un boudin poudré, la spirale sur la face avant. */
function Roll({ x, y, rx, ry, dir = 1 }: { x: number; y: number; rx: number; ry: number; dir?: number }) {
  return (
    <g>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={WIG} {...ink} strokeWidth={2.2} />
      <path d={`M${x - rx * 0.6} ${y - ry * 0.45} Q${x} ${y - ry * 0.85} ${x + rx * 0.6} ${y - ry * 0.45}`} fill="none" stroke={WIG_HI} strokeWidth={1.6} strokeLinecap="round" />
      {/* la spirale, côté visage */}
      <path
        d={`M${x - dir * rx * 0.55} ${y + ry * 0.5} a${ry * 0.55} ${ry * 0.55} 0 1 ${dir > 0 ? 1 : 0} ${dir * ry * 0.3} ${-ry * 0.9} a${ry * 0.3} ${ry * 0.3} 0 1 ${dir > 0 ? 1 : 0} ${-dir * ry * 0.1} ${ry * 0.5}`}
        fill="none"
        stroke={WIG_LO}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </g>
  );
}

/** Pile de boucles d'un côté (de face ou de dos) : de bas en haut, la plus basse au niveau de l'oreille. */
function Rolls({ level, side }: { level: number; side: -1 | 1 }) {
  const w = WIGS[level];
  const out: ReactNode[] = [];
  for (let i = w.rolls - 1; i >= 0; i--) {
    const y = 45 - i * w.ry * 1.75;
    const x = 49 + side * (27.6 + level * 1.4 - i * 0.5);
    out.push(<Roll key={i} x={x} y={y} rx={w.rx} ry={w.ry} dir={-side} />);
  }
  return <g>{out}</g>;
}

/** Dessus lisse, tiré en arrière : de face, le front dégagé, le dessus gonfle avec le niveau. */
function WigTopFront({ level, back }: { level: number; back?: boolean }) {
  const w = WIGS[level];
  const t = w.top;
  const hw = w.w;
  const low = back ? 58 : 42; // de dos, la perruque couvre toute la nuque
  const d = back
    ? `M${49 - hw + 3} ${low} C ${49 - hw - 2} 34, ${49 - hw} ${t + 14}, ${49 - hw * 0.55} ${t + 5} C ${49 - hw * 0.25} ${t}, ${49 + hw * 0.25} ${t}, ${49 + hw * 0.55} ${t + 5} C ${49 + hw} ${t + 14}, ${49 + hw + 2} 34, ${49 + hw - 3} ${low} C ${49 + hw * 0.5} ${low + 6}, ${49 - hw * 0.5} ${low + 6}, ${49 - hw + 3} ${low} Z`
    : `M${49 - hw + 4} ${low} C ${49 - hw - 1} 30, ${49 - hw} ${t + 14}, ${49 - hw * 0.55} ${t + 5} C ${49 - hw * 0.25} ${t}, ${49 + hw * 0.25} ${t}, ${49 + hw * 0.55} ${t + 5} C ${49 + hw} ${t + 14}, ${49 + hw + 1} 30, ${49 + hw - 4} ${low} C 74 34, 72 25, 62 21.4 C 56 19.6, 42 19.6, 36 21.4 C 26 25, 24 34, ${49 - hw + 4} ${low} Z`;
  // mèches tirées en arrière (traits de peigne)
  const combs = back
    ? [`M38 ${t + 8} Q36 30 40 48`, `M49 ${t + 6} L49 50`, `M60 ${t + 8} Q62 30 58 48`]
    : [`M40 20 Q36 ${t + 10} 30 ${t + 9}`, `M49 19.4 Q49 ${t + 8} 49 ${t + 3}`, `M58 20 Q62 ${t + 10} 68 ${t + 9}`];
  return (
    <g>
      <path d={d} fill={WIG} {...ink} strokeWidth={2.8} />
      <path d={`M${49 - hw * 0.5} ${t + 7} Q${49 - hw * 0.2} ${t + 2.6} ${49 + hw * 0.1} ${t + 3}`} fill="none" stroke={WIG_HI} strokeWidth={2.6} strokeLinecap="round" />
      <g fill="none" stroke={WIG_LO} strokeWidth={1.3} strokeLinecap="round">
        {combs.map((c, i) => (
          <path key={i} d={c} />
        ))}
      </g>
    </g>
  );
}

/** Queue nouée d'un ruban noir (de dos et de profil). */
function Queue({ x, y, level, side }: { x: number; y: number; level: number; side?: boolean }) {
  const w = WIGS[level];
  const len = w.queue - y;
  const s = w.bow;
  const qx = side ? x - 3 - level : x;
  return (
    <g>
      <path d={`M${x - 4.4} ${y} Q${qx - 5} ${y + len * 0.6} ${qx - 1.6} ${y + len} Q${qx} ${y + len + 2.4} ${qx + 1.6} ${y + len} Q${qx + 5} ${y + len * 0.6} ${x + 4.4} ${y} Z`} fill={WIG} {...ink} strokeWidth={2.2} />
      <path d={`M${x} ${y + 4} Q${qx + 0.6} ${y + len * 0.6} ${qx} ${y + len - 2}`} fill="none" stroke={WIG_LO} strokeWidth={1.2} strokeLinecap="round" />
      {/* ruban noir, nœud */}
      <g transform={`translate(${x} ${y + 3}) scale(${s})`}>
        <path d="M-1 0 L-8 -4.6 Q-9.6 0 -8 4.6 Z M1 0 L8 -4.6 Q9.6 0 8 4.6 Z" fill={RIBBON} {...ink} strokeWidth={1.2} />
        <path d="M-1 1 L-3.6 10 L-1 9 Z M1 1 L3.6 10 L1 9 Z" fill={RIBBON} {...ink} strokeWidth={1} />
        <rect x={-2} y={-2} width={4} height={4} rx={1} fill={RIBBON} {...ink} strokeWidth={1} />
      </g>
    </g>
  );
}

// ── Tête : visage (pastel de La Tour) et perruque poudrée ───
const FACE_FRONT = 'M49 11 C 66 11, 77 22, 77 38 C 77 52, 71.4 62, 61 66.4 C 55 68.8, 43 68.8, 37 66.4 C 26.6 62, 21 52, 21 38 C 21 22, 32 11, 49 11 Z';
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
  const w = WIGS[level];
  if (view === 'side') {
    const t = Math.max(w.top + 1.4, 1.6);
    const back = 21 - level * 1.6; // la perruque gonfle aussi vers l'arrière
    const dome = `M83 15 C 80 ${t + 3}, 64 ${t}, 48 ${t + 0.4} C ${back + 8} ${t + 1.6}, ${back} ${t + 12}, ${back + 0.4} 32 C ${back + 1} 41, 27 46, 34 47 L 44 45 C 50 40, 57 31, 64 25 C 70 21, 77 19, 83 15 Z`;
    const rolls: ReactNode[] = [];
    for (let i = w.rolls - 1; i >= 0; i--) {
      const y = 38.6 - i * w.ry * 1.75;
      const x0 = 34 - level * 1.6 + i * 0.8;
      const x1 = 56.4 + level * 0.4 - i * 0.6;
      rolls.push(
        <g key={i}>
          <rect x={x0} y={y - w.ry} width={x1 - x0} height={w.ry * 2} rx={w.ry} fill={WIG} {...ink} strokeWidth={2.2} />
          <path d={`M${x0 + 3} ${y - w.ry * 0.45} L${x1 - 4} ${y - w.ry * 0.45}`} stroke={WIG_HI} strokeWidth={1.6} strokeLinecap="round" />
          <path d={`M${x1 - w.ry * 0.9} ${y + w.ry * 0.5} a${w.ry * 0.55} ${w.ry * 0.55} 0 1 1 ${w.ry * 0.3} ${-w.ry * 0.9} a${w.ry * 0.3} ${w.ry * 0.3} 0 1 1 ${-w.ry * 0.1} ${w.ry * 0.5}`} fill="none" stroke={WIG_LO} strokeWidth={1.4} strokeLinecap="round" />
        </g>,
      );
    }
    return (
      <g>
        <Grad id={g} />
        <Queue x={31} y={45} level={level} side />
        <path d={FACE_SIDE} fill={`url(#${g})`} {...ink} strokeWidth={3.2} />
        <path d={dome} fill={WIG} {...ink} strokeWidth={2.8} />
        <path d={`M76 ${t + 5} Q62 ${t + 1.6} 46 ${t + 3}`} fill="none" stroke={WIG_HI} strokeWidth={2.6} strokeLinecap="round" />
        <g fill="none" stroke={WIG_LO} strokeWidth={1.3} strokeLinecap="round">
          <path d={`M74 19 Q60 ${t + 6} 40 ${t + 9}`} />
          <path d={`M66 25 Q52 ${t + 12} ${back + 6} 26`} />
        </g>
        {rolls}
      </g>
    );
  }
  if (view === 'back')
    return (
      <g>
        <path d={FACE_FRONT} fill={SKIN} {...ink} strokeWidth={3.2} />
        <WigTopFront level={level} back />
        <Rolls level={level} side={-1} />
        <Rolls level={level} side={1} />
        <Queue x={49} y={57} level={level} />
      </g>
    );
  return (
    <g>
      <Grad id={g} />
      <path d={FACE_FRONT} fill={`url(#${g})`} {...ink} strokeWidth={3.2} />
      <WigTopFront level={level} />
      <Rolls level={level} side={-1} />
      <Rolls level={level} side={1} />
    </g>
  );
}

type FaceArgs = DrawArgs & { expr: Expr };

/** Bouche : petite, lèvres closes, sourire doux. */
function Mouth({ m, x, y, side, hot }: { m: Expr['mouth']; x: number; y: number; side?: boolean; hot: boolean }) {
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const };
  const w = side ? 2.4 : 3.4;
  switch (m) {
    case 'o':
    case 'puff':
      return <ellipse cx={x + 0.4} cy={y + 0.2} rx={m === 'o' ? 1.8 : 1.4} ry={m === 'o' ? 2.1 : 1.6} fill="#6a2a2a" stroke="currentColor" strokeWidth={1.3} />;
    case 'sleep':
      return <ellipse cx={x} cy={y + 0.4} rx={1.3} ry={0.9} fill="#6a2a2a" stroke="currentColor" strokeWidth={1} />;
    case 'flat':
      return <path d={`M${x - w} ${y + 0.2} Q${x} ${y + 0.8} ${x + w} ${y + 0.2}`} {...line} />;
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
      return <path d={`M${x - w} ${y + 0.4} Q${x} ${y + 1.4} ${x + w + 0.4} ${y - 1.4}`} {...line} />;
    default:
      return (
        <g>
          <path d={`M${x - w} ${y - 0.6} Q${x} ${y + 1.8} ${x + w} ${y - 0.6}`} {...line} />
          <path d={`M${x - 1.6} ${y + 2.6} Q${x} ${y + 3.3} ${x + 1.6} ${y + 2.6}`} fill="none" stroke={SKIN_LO} strokeWidth={1.3} strokeLinecap="round" />
        </g>
      );
  }
}

/** Grand œil sombre en amande (portrait de Ramsay), paupière lourde, regard doux et un peu triste. */
function EyeFront({ cx, cy, e, gaze, flip }: { cx: number; cy: number; e: Expr['eyes']; gaze: [number, number]; flip: number }) {
  const lid = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round' as const };
  const o = -flip; // coin extérieur : -1 à gauche de l'image, +1 à droite
  if (e === 'closed') return <path d={`M${cx - 5} ${cy + 0.4} Q${cx} ${cy + 2.8} ${cx + 5} ${cy + 0.4}`} {...lid} />;
  if (e === 'happy') return <path d={`M${cx - 5} ${cy + 1.4} Q${cx} ${cy - 2.6} ${cx + 5} ${cy + 1.4}`} {...lid} />;
  const gx = Math.max(-1.8, Math.min(1.8, gaze[0] * 0.8));
  const gy = Math.max(-0.9, Math.min(0.9, gaze[1] * 0.45));
  // amande : coin intérieur plus haut, coin extérieur qui tombe un peu (air mélancolique)
  const xi = cx - 5.4 * o;
  const xo = cx + 5.6 * o;
  const almond = `M${xi} ${cy - 0.4} Q${cx - 0.6 * o} ${cy - 4.2} ${xo} ${cy + 0.6} Q${cx + 0.4 * o} ${cy + 3.6} ${xi} ${cy - 0.4} Z`;
  return (
    <g transform={`translate(${cx} ${cy}) scale(1.14) translate(${-cx} ${-cy})`}>
      <path d={almond} fill="#fbf4ea" />
      <circle cx={cx + gx} cy={cy + 0.1 + gy} r={2.7} fill="#3a2418" />
      <circle cx={cx + gx} cy={cy + 0.1 + gy} r={1.3} fill="#140c08" />
      <circle cx={cx + gx + 0.9} cy={cy - 0.9 + gy} r={0.75} fill="#fffaf0" />
      {e === 'lidded' && <path d={`M${xi - 0.3 * o} ${cy - 0.5} Q${cx - 0.6 * o} ${cy - 4.6} ${xo + 0.3 * o} ${cy + 0.6} L${xo} ${cy + 0.8} Q${cx} ${cy - 0.2} ${xi} ${cy} Z`} fill={SKIN} />}
      <path d={almond} fill="none" stroke="currentColor" strokeWidth={0.9} strokeLinejoin="round" />
      <path d={e === 'lidded' ? `M${xi - 0.4 * o} ${cy - 0.1} Q${cx} ${cy - 0.6} ${xo + 0.6 * o} ${cy + 0.9}` : `M${xi - 0.4 * o} ${cy - 0.4} Q${cx - 0.6 * o} ${cy - 4.6} ${xo + 0.6 * o} ${cy + 0.9}`} {...lid} />
      {/* pli de la paupière */}
      <path d={`M${cx - 3.6 * o} ${cy - 4.4} Q${cx + 0.6 * o} ${cy - 6} ${cx + 4.6 * o} ${cy - 3}`} fill="none" stroke={SKIN_LO} strokeWidth={1.2} strokeLinecap="round" />
    </g>
  );
}

/** Le visage du portrait de Ramsay : ovale rasé, grands yeux sombres, sourcils arqués, long nez droit, petite bouche close. */
function face({ view, expr }: FaceArgs): ReactNode {
  const brow = { fill: 'none', stroke: HAIR, strokeWidth: 2.4, strokeLinecap: 'round' as const };
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
            <path d="M72.4 31 Q76.6 26.8 80 30.2 Q78 33.6 72.4 31 Z" fill="#fbf4ea" />
            <circle cx={77.2 + gx} cy={30.6 + gy} r={2.2} fill="#3a2418" />
            <circle cx={77.6 + gx} cy={30.6 + gy} r={1} fill="#140c08" />
            <circle cx={78 + gx} cy={29.6 + gy} r={0.6} fill="#fffaf0" />
            {expr.eyes === 'lidded' && <path d="M72.2 31 Q76.6 26.4 80.2 30.2 L80 30.6 Q76 29.6 72.4 31.2 Z" fill={SKIN} />}
            <path d="M72.4 31 Q76.6 26.8 80 30.2 Q78 33.6 72.4 31 Z" fill="none" stroke="currentColor" strokeWidth={0.9} strokeLinejoin="round" />
            <path d={expr.eyes === 'lidded' ? 'M72 31.2 Q76 29.6 80.4 30.6' : 'M72 31 Q76.6 26.4 80.4 30.4'} {...lid} />
          </g>
        )}
        <path d={expr.browUp ? 'M71 25.4 Q75.6 21.6 80.6 24.2' : 'M71 26.2 Q75.6 23.2 80.6 25.2'} {...brow} />
        <path d="M89.2 37.6 C 87.6 38.4, 86.2 38, 85.6 36.8" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
        <Mouth m={expr.mouth} x={85.6} y={42.4} side hot={expr.hot} />
        <path d="M84 49 Q86 50.4 88 49.4" fill="none" stroke={SKIN_LO} strokeWidth={1.3} strokeLinecap="round" />
      </g>
    );
  }
  return (
    <g>
      <EyeFront cx={37.2} cy={42.6} e={expr.eyes} gaze={expr.gaze} flip={1} />
      <EyeFront cx={58.8} cy={42.6} e={expr.eyes} gaze={expr.gaze} flip={-1} />
      {/* sourcils arqués, fins, un peu relevés au milieu */}
      <path d={expr.browUp ? 'M30.6 35.4 Q36 29.4 43 33.4' : 'M30.6 36.6 Q36.4 32 43 34.6'} {...brow} />
      <path d="M53 34.6 Q59.6 32 65.4 36.6" {...brow} />
      {/* long nez droit */}
      <path d="M50.4 37.6 L51.2 48.2" fill="none" stroke={SKIN_LO} strokeWidth={1.8} strokeLinecap="round" />
      <path d="M45 48.8 Q46.6 51.2 48.6 50.4 Q50.8 51.4 52.4 49" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      <path d="M46.4 39 L45.6 47" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" opacity={0.45} />
      <ellipse cx={29.6} cy={51} rx={3.4} ry={1.7} fill="#e8795f" opacity={0.22} />
      <ellipse cx={66.4} cy={51} rx={3.4} ry={1.7} fill="#e8795f" opacity={0.22} />
      <Mouth m={expr.mouth} x={48.6} y={54.2} hot={expr.hot} />
      {/* fossettes et pommettes rieuses (l'air un peu narquois du pastel) */}
      {(expr.mouth === 'smile' || expr.mouth === 'smirk') && <path d="M42.6 52 q-1.2 1.6 0 3.2 M54.6 52 q1.2 1.6 0 3.2" fill="none" stroke={SKIN_LO} strokeWidth={1.4} strokeLinecap="round" />}
      {expr.eyes === 'open' && <path d="M33.4 47.6 Q37.2 49 41 47.4 M55 47.4 Q58.8 49 62.6 47.6" fill="none" stroke={SKIN_LO} strokeWidth={1.3} strokeLinecap="round" />}
      {/* menton rond, rasé de près */}
      <path d="M44.6 61.4 Q48.6 63 52.6 61.4" fill="none" stroke={SKIN_LO} strokeWidth={1.4} strokeLinecap="round" />
    </g>
  );
}

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


// ── Corps : habit à la française ─────────────────────────────

function Button({ x, y, r = 1.5 }: { x: number; y: number; r?: number }) {
  return <circle cx={x} cy={y} r={r} fill={COAT_HI} stroke="currentColor" strokeWidth={0.9} />;
}

/** Cravate blanche et jabot, au cou. */
function Cravat({ x = 49, side }: { x?: number; side?: boolean }) {
  return side ? (
    <path d="M52.4 40.6 Q56.6 44 55.6 47.6 Q57.6 50 55 53 Q53 50.6 51.6 47.6 Z" fill={CRAVAT} {...ink} strokeWidth={1.3} />
  ) : (
    <g>
      <path d={`M${x - 5} 40.4 L${x + 5} 40.4 L${x + 4.4} 45.4 Q${x} 47 ${x - 4.4} 45.4 Z`} fill={CRAVAT} {...ink} strokeWidth={1.4} />
      <path d={`M${x - 3} 45.4 Q${x - 4.4} 49 ${x - 2.2} 51.6 Q${x} 53.2 ${x + 2.2} 51.6 Q${x + 4.4} 49 ${x + 3} 45.4 Z`} fill={CRAVAT} {...ink} strokeWidth={1.3} />
      <path d={`M${x} 46.4 L${x} 51.4 M${x - 2} 47.4 Q${x - 2.4} 49.4 ${x - 1.4} 50.6`} fill="none" stroke={CRAVAT_LO} strokeWidth={0.9} strokeLinecap="round" />
    </g>
  );
}

function body({ view, seated, pose }: DrawArgs): ReactNode {
  const jump = pose === 'jump';
  if (view === 'side') {
    // Assis : Sprite remonte le haut du corps de 8 ; les cuisses partent vers (49, 64) de ce repère.
    const coat = seated
      ? 'M43.4 44.6 Q40 55 40.4 66 Q42 75 54 75 L71 73.4 Q73.6 70.6 72 67 L59.6 64 Q59.6 54 56.8 45 Q50 42 43.4 44.6 Z'
      : jump
        ? 'M43.4 44.6 Q40 55 41 62 Q36 72 32.6 82 Q46 84.6 50 80 L58.8 66 Q59.6 54 56.8 45 Q50 42 43.4 44.6 Z'
        : 'M43.4 44.6 Q40 55 41 62 Q38.4 76 36 91 Q47 93.6 52 90 Q55 76 58.8 66 Q59.6 54 56.8 45 Q50 42 43.4 44.6 Z';
    return (
      <g>
        <ShoeDefs />
        <path d="M45 34 L45.5 46 L53.5 46 L53 34 Z" fill={SKIN} {...ink} strokeWidth={1.8} />
        {!seated && <path d={jump ? 'M50 66 L58.6 64 Q62 72 60 80 L52 78 Z' : 'M50.6 64 L58.8 64 Q60.6 76 59.4 90 L52 90 Z'} fill={COAT_LO} {...ink} strokeWidth={1.6} />}
        <path d={coat} fill={COAT} {...ink} strokeWidth={2} />
        {/* pans de l'habit, plis, poche à rabat */}
        <g fill="none" stroke={COAT_LO} strokeWidth={1.2} strokeLinecap="round">
          {seated ? <path d="M44 66 Q56 70 70 69" /> : <path d="M44.6 66 Q42.6 78 40.6 89 M48 66 Q47.6 78 46.6 90" />}
        </g>
        <path d={seated ? 'M48 62.6 L56.6 62.6 L56 65.4 L48.4 65.4 Z' : 'M47 64 L56 64 L55.4 67 L47.4 67 Z'} fill={COAT} {...ink} strokeWidth={1.2} />
        {/* boutons sur le devant */}
        {[49, 53.4, 57.8, 62].map((y) => (
          <Button key={y} x={57.2 + (y - 49) * 0.06} y={y} r={1.3} />
        ))}
        <Cravat side />
        {/* col droit */}
        <path d="M43.6 41.6 L52.6 40.6 L53.8 45.6 L44.6 46.6 Z" fill={COAT} {...ink} strokeWidth={1.6} />
        <Sprig x={56} y={52.6} />
      </g>
    );
  }
  const back = view === 'back';
  const hemY = seated ? 80 : jump ? 84 : 92;
  const spread = jump ? 5 : seated ? 1 : 0;
  const lx = 31.6 - spread;
  const rx = 67.4 + spread;
  const coat = `M42.6 42.6 Q49 45.6 55.4 42.6 L60.6 44.4 Q64.8 46.2 64 52 L62.6 60.6 Q${65 + spread} ${hemY - 16} ${rx} ${hemY} Q${back ? 49.5 : 56} ${hemY + 2.6} ${back ? lx : 52} ${back ? hemY : hemY - 1} ${back ? '' : `L47 ${hemY - 1} Q43 ${hemY + 2.6} ${lx} ${hemY}`} Q${34 - spread} ${hemY - 16} 36.4 60.6 L35 52 Q34.2 46.2 38.4 44.4 Z`;
  return (
    <g>
      <ShoeDefs />
      <path d="M44.6 36 L44.6 46 L53.4 46 L53.4 36 Z" fill={SKIN} {...ink} strokeWidth={1.8} />
      <path d={coat} fill={COAT} {...ink} strokeWidth={2} />
      {back ? (
        <g>
          {/* fente du dos, plis des basques, deux boutons à la taille */}
          <path d={`M49.5 66 L49.5 ${hemY + 1.6}`} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          <path d={`M43 66 Q41.6 ${hemY - 10} 40 ${hemY - 1} M56 66 Q57.4 ${hemY - 10} 59 ${hemY - 1}`} fill="none" stroke={COAT_LO} strokeWidth={1.2} strokeLinecap="round" />
          <Button x={45.6} y={62.6} />
          <Button x={53.4} y={62.6} />
          <path d="M42 46 Q49.5 44 57 46 L56.4 49 Q49.5 47.2 42.6 49 Z" fill={COAT} {...ink} strokeWidth={1.4} />
        </g>
      ) : (
        <g>
          {/* veste assortie, au milieu, boutonnée */}
          <path d={`M44.6 46.6 L54.4 46.6 L53.8 66 L51.6 ${hemY - 18} L47.4 ${hemY - 18} L45.2 66 Z`} fill={VEST} {...ink} strokeWidth={1.4} />
          {[52.6, 56.6, 60.6, 64.6].map((y) => (
            <circle key={y} cx={49.5} cy={y} r={0.9} fill={COAT_HI} stroke="currentColor" strokeWidth={0.7} />
          ))}
          {/* boutons couverts sur le bord de l'habit */}
          {[50, 55, 60, 65].map((y) => (
            <Button key={y} x={42.4 - (y - 50) * 0.05} y={y} />
          ))}
          {/* poches à rabat */}
          <path d="M36 68.6 L44 68 L44.2 71.4 L36.4 72 Z" fill={COAT} {...ink} strokeWidth={1.3} />
          <path d="M55 68 L63 68.6 L62.6 72 L54.8 71.4 Z" fill={COAT} {...ink} strokeWidth={1.3} />
          <path d={`M40 74 Q38.6 ${hemY - 8} 37 ${hemY - 1.6} M59 74 Q60.4 ${hemY - 8} 62 ${hemY - 1.6}`} fill="none" stroke={COAT_LO} strokeWidth={1.2} strokeLinecap="round" />
          <path d="M38.4 47 Q37.4 53 38.4 58" fill="none" stroke={COAT_HI} strokeWidth={1.4} strokeLinecap="round" />
          <Cravat />
          {/* col droit */}
          <path d="M42.6 41.6 Q49 44.4 55.4 41.6 L56.6 45.4 L53.6 46.8 Q49 48 44.4 46.8 L41.4 45.4 Z" fill="none" stroke="currentColor" strokeWidth={0} />
          <path d="M41.2 42.2 L44.6 46.6 M57 42.2 L53.6 46.6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          <Sprig x={57.6} y={52} />
        </g>
      )}
    </g>
  );
}

export const rousseau: CharacterDef = {
  id: 'rousseau',
  name: 'Rousseau',
  grows: 'sa perruque',
  skin: SKIN,
  limbs: { arm: COAT, leg: STOCKING, shoe: `url(#rousseau-shoe-buckle) ${SHOE}` },
  head,
  face,
  body,
};
