// Mozart : dessin original, d'après l'allure des portraits du XVIIIe siècle (domaine public). Visage jeune
// et rond, rasé, joues roses, yeux vifs et rieurs, sourcils légers, petit nez retroussé ; perruque poudrée
// très blanche, courte, une ou plusieurs boucles roulées sur les oreilles et un catogan (queue repliée en
// boucle, nouée d'un ruban noir) ; habit à la française cramoisi à galons dorés, gilet crème brodé, jabot
// de dentelle blanche ; bas blancs, souliers à boucle.
// Ce qui grandit : la perruque — une petite boucle de chaque côté au niveau 0, trois grosses boucles,
// du volume sur le dessus et un catogan plus épais au niveau 4.
import type { ReactNode } from 'react';
import type { CharacterDef, DrawArgs } from './types';
import { Cigar, type Expr } from '../Sprite';

const SKIN = '#f6dcc6';
const SKIN_HI = '#fdeee2';
const SKIN_LO = '#e0b49a';
const CHEEK = '#ee8a78';
const BROW = '#b89a7a';
const WIG = '#f7f5f1';
const WIG_HI = '#ffffff';
const WIG_LO = '#c9c4bc';
const RIBBON = '#1f1a17';
const COAT = '#b3262e';
const COAT_HI = '#d24a4f';
const COAT_LO = '#7f171d';
const GOLD = '#e0b54a';
const GOLD_LO = '#a77f22';
const VEST = '#f1e6c8';
const VEST_LO = '#d5c59c';
const LACE = '#fbf9f3';
const LACE_LO = '#d9d3c7';
const STOCKING = '#f4f0e6';
const SHOE = '#2a221e';

const ink = { stroke: 'currentColor', strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

// ── Perruque ─────────────────────────────────────────────────
// Par niveau : haut du dessus, demi-largeur, boucles de chaque côté, taille des boucles, taille du catogan.
const WIGS = [
  { top: 7.6, w: 30, rolls: 1, rx: 6.2, ry: 3.6, club: 0.8 },
  { top: 5.6, w: 31.5, rolls: 1, rx: 7.2, ry: 4, club: 0.92 },
  { top: 3.6, w: 33.5, rolls: 2, rx: 7.4, ry: 4, club: 1.04 },
  { top: 1.8, w: 35.5, rolls: 2, rx: 8.4, ry: 4.4, club: 1.16 },
  { top: 0, w: 38, rolls: 3, rx: 9, ry: 4.4, club: 1.3 },
];

/** Boucle roulée vue par le bout : boudin poudré, spirale côté visage. */
function Roll({ x, y, rx, ry, dir = 1 }: { x: number; y: number; rx: number; ry: number; dir?: number }) {
  return (
    <g>
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={WIG} {...ink} strokeWidth={2.2} />
      <path d={`M${x - rx * 0.6} ${y - ry * 0.45} Q${x} ${y - ry * 0.85} ${x + rx * 0.6} ${y - ry * 0.45}`} fill="none" stroke={WIG_HI} strokeWidth={1.6} strokeLinecap="round" />
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

/** Boucles d'un côté, de bas en haut, la plus basse au niveau de l'oreille. */
function Rolls({ level, side }: { level: number; side: -1 | 1 }) {
  const w = WIGS[level];
  const out: ReactNode[] = [];
  for (let i = w.rolls - 1; i >= 0; i--) {
    const y = 43 - i * w.ry * 1.75;
    const x = 49 + side * (27 + level * 1.2 - i * 0.5);
    out.push(<Roll key={i} x={x} y={y} rx={w.rx} ry={w.ry} dir={-side} />);
  }
  return <g>{out}</g>;
}

/** Dessus : front dégagé, poudré, avec un léger toupet relevé (plus haut avec le niveau). */
function WigTop({ level, back }: { level: number; back?: boolean }) {
  const w = WIGS[level];
  const t = w.top;
  const hw = w.w;
  const low = back ? 56 : 40;
  const d = back
    ? `M${49 - hw + 3} ${low} C ${49 - hw - 2} 34, ${49 - hw} ${t + 14}, ${49 - hw * 0.55} ${t + 5} C ${49 - hw * 0.25} ${t}, ${49 + hw * 0.25} ${t}, ${49 + hw * 0.55} ${t + 5} C ${49 + hw} ${t + 14}, ${49 + hw + 2} 34, ${49 + hw - 3} ${low} C ${49 + hw * 0.5} ${low + 6}, ${49 - hw * 0.5} ${low + 6}, ${49 - hw + 3} ${low} Z`
    : `M${49 - hw + 4} ${low} C ${49 - hw - 1} 30, ${49 - hw} ${t + 14}, ${49 - hw * 0.55} ${t + 5} C ${49 - hw * 0.25} ${t}, ${49 + hw * 0.25} ${t}, ${49 + hw * 0.55} ${t + 5} C ${49 + hw} ${t + 14}, ${49 + hw + 1} 30, ${49 + hw - 4} ${low} C 73 32, 71 24.4, 62 21 C 56 19, 42 19, 36 21 C 27 24.4, 25 32, ${49 - hw + 4} ${low} Z`;
  // toupet : petite vague au-dessus du front
  const toupee = back ? null : `M38 ${t + 6.4} Q44 ${t - 1.6 - level * 0.4} 50 ${t + 3} Q56 ${t - 1.6 - level * 0.4} 61 ${t + 6.4}`;
  const combs = back
    ? [`M38 ${t + 8} Q36 30 40 46`, `M49 ${t + 6} L49 48`, `M60 ${t + 8} Q62 30 58 46`]
    : [`M40 19.6 Q35 ${t + 11} 29 ${t + 10}`, `M58 19.6 Q63 ${t + 11} 69 ${t + 10}`];
  return (
    <g>
      <path d={d} fill={WIG} {...ink} strokeWidth={2.8} />
      {toupee && <path d={toupee} fill="none" stroke={WIG_LO} strokeWidth={1.4} strokeLinecap="round" />}
      <path d={`M${49 - hw * 0.5} ${t + 7} Q${49 - hw * 0.2} ${t + 2.6} ${49 + hw * 0.1} ${t + 3}`} fill="none" stroke={WIG_HI} strokeWidth={2.6} strokeLinecap="round" />
      <g fill="none" stroke={WIG_LO} strokeWidth={1.3} strokeLinecap="round">
        {combs.map((c, i) => (
          <path key={i} d={c} />
        ))}
      </g>
    </g>
  );
}

/** Catogan : la queue repliée en boucle épaisse, nouée d'un ruban noir (de dos et de profil). */
function Club({ x, y, level }: { x: number; y: number; level: number }) {
  const s = WIGS[level].club;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-5 0 Q-7.6 9 -4.4 15 Q0 18.6 4.4 15 Q7.6 9 5 0 Z" fill={WIG} {...ink} strokeWidth={2.1} />
      <path d="M-2 3 Q-3.2 9 -1.6 13 M2 3 Q3.2 9 1.6 13" fill="none" stroke={WIG_LO} strokeWidth={1.1} strokeLinecap="round" />
      <path d="M-4.6 1 L4.6 1 L4.2 5 L-4.2 5 Z" fill={RIBBON} {...ink} strokeWidth={1.1} />
      <path d="M-1 3 L-8 -1.6 Q-9.4 3 -8 7.4 Z M1 3 L8 -1.6 Q9.4 3 8 7.4 Z" fill={RIBBON} {...ink} strokeWidth={1.1} />
    </g>
  );
}

// ── Tête : visage rond et jeune, perruque blanche ───────────
const FACE_FRONT = 'M49 12 C 66.6 12, 77 23, 77 39 C 77 53, 70.6 62.6, 60.6 66.4 C 54.6 68.4, 43.4 68.4, 37.4 66.4 C 27.4 62.6, 21 53, 21 39 C 21 23, 31.4 12, 49 12 Z';
const FACE_SIDE =
  'M32 47 C 22 40, 21 24, 33 15 C 45 7, 66 7, 78 12 C 85.6 16, 88.6 21, 88.6 27 L 91 32.6 C 92 34.6, 90.6 36.2, 88.6 36.4 C 89.8 39.4, 89.8 42.6, 88.4 44.8 C 89.4 50, 86.6 55, 80.6 56 C 72.6 57.4, 63 57.4, 57 55.6 C 49 55, 40 53.6, 32 47 Z';

function Grad({ id }: { id: string }) {
  return (
    <defs>
      <radialGradient id={id} cx="0.4" cy="0.36" r="0.78">
        <stop offset="0" stopColor={SKIN_HI} />
        <stop offset="0.55" stopColor={SKIN} />
        <stop offset="1" stopColor={SKIN_LO} />
      </radialGradient>
    </defs>
  );
}

function head({ view, level, uid }: DrawArgs): ReactNode {
  const g = `mz-skin-${uid}`;
  const w = WIGS[level];
  if (view === 'side') {
    const t = Math.max(w.top + 1.4, 1.6);
    const back = 22 - level * 1.4;
    const dome = `M83 15 C 80 ${t + 3}, 64 ${t}, 48 ${t + 0.4} C ${back + 8} ${t + 1.6}, ${back} ${t + 12}, ${back + 0.4} 32 C ${back + 1} 40, 27 45, 34 46 L 44 44 C 50 39, 57 31, 64 25 C 70 21, 77 19, 83 15 Z`;
    const rolls: ReactNode[] = [];
    for (let i = w.rolls - 1; i >= 0; i--) {
      const y = 37.6 - i * w.ry * 1.75;
      const x0 = 35 - level * 1.4 + i * 0.8;
      const x1 = 55.4 + level * 0.4 - i * 0.6;
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
        <Club x={back + 2.6} y={45} level={level} />
        <path d={FACE_SIDE} fill={`url(#${g})`} {...ink} strokeWidth={3.2} />
        <path d={dome} fill={WIG} {...ink} strokeWidth={2.8} />
        <path d={`M76 ${t + 5} Q62 ${t + 1.6} 46 ${t + 3}`} fill="none" stroke={WIG_HI} strokeWidth={2.6} strokeLinecap="round" />
        <g fill="none" stroke={WIG_LO} strokeWidth={1.3} strokeLinecap="round">
          <path d={`M74 19 Q60 ${t + 6} 40 ${t + 9}`} />
        </g>
        {rolls}
      </g>
    );
  }
  if (view === 'back')
    return (
      <g>
        <path d={FACE_FRONT} fill={SKIN} {...ink} strokeWidth={3.2} />
        <WigTop level={level} back />
        <Rolls level={level} side={-1} />
        <Rolls level={level} side={1} />
        <Club x={49} y={52} level={level} />
      </g>
    );
  return (
    <g>
      <Grad id={g} />
      <path d={FACE_FRONT} fill={`url(#${g})`} {...ink} strokeWidth={3.2} />
      <WigTop level={level} />
      <Rolls level={level} side={-1} />
      <Rolls level={level} side={1} />
    </g>
  );
}

type FaceArgs = DrawArgs & { expr: Expr };

/** Bouche : petite, rieuse. */
function Mouth({ m, x, y, side, hot }: { m: Expr['mouth']; x: number; y: number; side?: boolean; hot: boolean }) {
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const };
  const w = side ? 2.4 : 3.6;
  switch (m) {
    case 'o':
    case 'puff':
      return <ellipse cx={x + 0.4} cy={y + 0.2} rx={m === 'o' ? 1.9 : 1.4} ry={m === 'o' ? 2.2 : 1.6} fill="#6a2a2a" stroke="currentColor" strokeWidth={1.3} />;
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
      // sourire franc, lèvres entrouvertes
      return (
        <g>
          <path d={`M${x - w} ${y - 1} Q${x} ${y + 3} ${x + w} ${y - 1} Q${x} ${y + 0.6} ${x - w} ${y - 1} Z`} fill="#8a3a36" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
          <path d={`M${x - 1.6} ${y + 3.4} Q${x} ${y + 4} ${x + 1.6} ${y + 3.4}`} fill="none" stroke={SKIN_LO} strokeWidth={1.2} strokeLinecap="round" />
        </g>
      );
  }
}

/** Œil rond et vif, clair, reflet bien visible. */
function EyeFront({ cx, cy, e, gaze }: { cx: number; cy: number; e: Expr['eyes']; gaze: [number, number] }) {
  const lid = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round' as const };
  if (e === 'closed') return <path d={`M${cx - 4.6} ${cy + 0.4} Q${cx} ${cy + 2.8} ${cx + 4.6} ${cy + 0.4}`} {...lid} />;
  if (e === 'happy') return <path d={`M${cx - 4.6} ${cy + 1.4} Q${cx} ${cy - 2.8} ${cx + 4.6} ${cy + 1.4}`} {...lid} />;
  const gx = Math.max(-1.6, Math.min(1.6, gaze[0] * 0.8));
  const gy = Math.max(-0.9, Math.min(0.9, gaze[1] * 0.45));
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={4.4} ry={3.9} fill="#fbf6ee" />
      <circle cx={cx + gx} cy={cy + gy + 0.2} r={2.6} fill="#5a6f8c" />
      <circle cx={cx + gx} cy={cy + gy + 0.2} r={1.25} fill="#141a24" />
      <circle cx={cx + gx + 0.9} cy={cy + gy - 0.8} r={0.8} fill="#fffaf0" />
      {e === 'lidded' && <path d={`M${cx - 4.8} ${cy - 0.2} Q${cx} ${cy - 5.4} ${cx + 4.8} ${cy - 0.2} L${cx + 4.6} ${cy + 0.4} Q${cx} ${cy - 1} ${cx - 4.6} ${cy + 0.4} Z`} fill={SKIN} />}
      <ellipse cx={cx} cy={cy} rx={4.4} ry={3.9} fill="none" stroke="currentColor" strokeWidth={0.9} />
      <path d={e === 'lidded' ? `M${cx - 4.8} ${cy + 0.2} Q${cx} ${cy - 1.2} ${cx + 4.8} ${cy + 0.2}` : `M${cx - 4.8} ${cy - 0.6} Q${cx} ${cy - 5.4} ${cx + 4.8} ${cy - 0.6}`} {...lid} />
    </g>
  );
}

function face({ view, expr }: FaceArgs): ReactNode {
  const brow = { fill: 'none', stroke: BROW, strokeWidth: 2.1, strokeLinecap: 'round' as const };
  if (view === 'side') {
    const gx = Math.max(-0.6, Math.min(1.2, expr.gaze[0] * 0.6));
    const gy = Math.max(-0.8, Math.min(0.8, expr.gaze[1] * 0.4));
    const lid = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round' as const };
    return (
      <g>
        {expr.eyes === 'closed' ? (
          <path d="M72 30.6 Q75.6 33 79 30.6" {...lid} />
        ) : expr.eyes === 'happy' ? (
          <path d="M72 31.6 Q75.6 27.4 79 31.6" {...lid} />
        ) : (
          <g>
            <ellipse cx={76} cy={30.4} rx={3.4} ry={3.2} fill="#fbf6ee" />
            <circle cx={77 + gx} cy={30.6 + gy} r={2.1} fill="#5a6f8c" />
            <circle cx={77.4 + gx} cy={30.6 + gy} r={1} fill="#141a24" />
            <circle cx={77.9 + gx} cy={29.6 + gy} r={0.6} fill="#fffaf0" />
            {expr.eyes === 'lidded' && <path d="M72.4 30.4 Q76 25.8 79.8 30 L79.6 30.6 Q76 29.4 72.6 30.8 Z" fill={SKIN} />}
            <ellipse cx={76} cy={30.4} rx={3.4} ry={3.2} fill="none" stroke="currentColor" strokeWidth={0.9} />
            <path d={expr.eyes === 'lidded' ? 'M72.2 30.8 Q76 29.4 80 30.4' : 'M72.4 29.8 Q76 25.8 79.8 29.4'} {...lid} />
          </g>
        )}
        <path d={expr.browUp ? 'M71.4 24.6 Q75.6 21.4 80.4 23.6' : 'M71.4 25.6 Q75.6 22.8 80.4 24.6'} {...brow} />
        {/* petit nez retroussé */}
        <path d="M88.6 36.4 C 87.4 37.6, 86 37.4, 85.4 36.2" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
        <ellipse cx={80.4} cy={40.6} rx={3} ry={1.6} fill={CHEEK} opacity={0.32} />
        <Mouth m={expr.mouth} x={85.4} y={42.6} side hot={expr.hot} />
      </g>
    );
  }
  return (
    <g>
      <EyeFront cx={37.4} cy={42.6} e={expr.eyes} gaze={expr.gaze} />
      <EyeFront cx={58.6} cy={42.6} e={expr.eyes} gaze={expr.gaze} />
      {/* sourcils légers, blond cendré, un peu relevés (air espiègle) */}
      <path d={expr.browUp ? 'M31.4 35 Q36.6 30 42.6 33.2' : 'M31.4 36 Q36.8 32.2 42.6 34.2'} {...brow} />
      <path d={expr.browUp ? 'M53.4 33.2 Q59.4 30 64.6 35' : 'M53.4 34.2 Q59.2 32.2 64.6 36'} {...brow} />
      {/* petit nez retroussé */}
      <path d="M49.6 39.4 Q50.6 44.6 50.2 47" fill="none" stroke={SKIN_LO} strokeWidth={1.6} strokeLinecap="round" />
      <path d="M46 48.4 Q47.6 50.2 49.4 49.4 Q51.2 50.2 52.6 48.4" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      {/* joues roses */}
      <ellipse cx={30} cy={50.6} rx={4} ry={2.2} fill={CHEEK} opacity={0.34} />
      <ellipse cx={66} cy={50.6} rx={4} ry={2.2} fill={CHEEK} opacity={0.34} />
      <Mouth m={expr.mouth} x={48.8} y={54.6} hot={expr.hot} />
      {/* fossette au menton, menton rond */}
      <path d="M45 62 Q48.8 63.6 52.6 62" fill="none" stroke={SKIN_LO} strokeWidth={1.3} strokeLinecap="round" />
    </g>
  );
}

function ShoeDefs() {
  return (
    <defs>
      <radialGradient id="mozart-shoe-buckle" cx="0.52" cy="0.34" r="0.5">
        <stop offset="0" stopColor="#f6dc8a" />
        <stop offset="0.32" stopColor={GOLD} />
        <stop offset="0.36" stopColor={SHOE} />
        <stop offset="1" stopColor={SHOE} />
      </radialGradient>
    </defs>
  );
}

// ── Corps : habit cramoisi à galons dorés ────────────────────

function Button({ x, y, r = 1.5 }: { x: number; y: number; r?: number }) {
  return <circle cx={x} cy={y} r={r} fill={GOLD} stroke="currentColor" strokeWidth={0.9} />;
}

/** Jabot de dentelle : deux volants festonnés sous le col. */
function Jabot({ x = 49, side }: { x?: number; side?: boolean }) {
  if (side)
    return (
      <g>
        <path d="M52.4 40.6 Q57.4 43.6 56.6 47.4 Q58.8 49.6 56.6 52.4 Q58.4 55 55.4 57 Q53 53.6 51.6 47.4 Z" fill={LACE} {...ink} strokeWidth={1.3} />
        <path d="M54 45 Q55.6 46.6 55 48.4 M54.4 51 Q56 52.8 55 54.6" fill="none" stroke={LACE_LO} strokeWidth={0.9} strokeLinecap="round" />
      </g>
    );
  const scallop = (y: number, w: number) => `M${x - w} ${y} q${w / 3} 2.4 ${(w * 2) / 3} 0 q${w / 3} 2.4 ${(w * 2) / 3} 0 q${w / 3} 2.4 ${(w * 2) / 3} 0`;
  return (
    <g>
      <path d={`M${x - 5} 40.4 L${x + 5} 40.4 L${x + 4.4} 45 Q${x} 46.4 ${x - 4.4} 45 Z`} fill={LACE} {...ink} strokeWidth={1.4} />
      <path d={`M${x - 4.6} 45 Q${x - 6.4} 50 ${x - 4} 54.6 Q${x} 56.4 ${x + 4} 54.6 Q${x + 6.4} 50 ${x + 4.6} 45 Z`} fill={LACE} {...ink} strokeWidth={1.3} />
      <path d={`M${x - 3.6} 51 Q${x - 4.8} 55 ${x - 2.6} 58.4 Q${x} 59.6 ${x + 2.6} 58.4 Q${x + 4.8} 55 ${x + 3.6} 51 Z`} fill={LACE} {...ink} strokeWidth={1.2} />
      <g fill="none" stroke={LACE_LO} strokeWidth={0.8} strokeLinecap="round">
        <path d={scallop(49, 3.4)} />
        <path d={scallop(55.2, 2.6)} />
      </g>
    </g>
  );
}

function body({ view, seated, pose }: DrawArgs): ReactNode {
  const jump = pose === 'jump';
  if (view === 'side') {
    const coat = seated
      ? 'M43.4 44.6 Q40 55 40.4 66 Q42 75 54 75 L71 73.4 Q73.6 70.6 72 67 L59.6 64 Q59.6 54 56.8 45 Q50 42 43.4 44.6 Z'
      : jump
        ? 'M43.4 44.6 Q40 55 41 62 Q36 72 32.6 82 Q46 84.6 50 80 L58.8 66 Q59.6 54 56.8 45 Q50 42 43.4 44.6 Z'
        : 'M43.4 44.6 Q40 55 41 62 Q38.4 76 36 91 Q47 93.6 52 90 Q55 76 58.8 66 Q59.6 54 56.8 45 Q50 42 43.4 44.6 Z';
    return (
      <g>
        <ShoeDefs />
        <path d="M45 34 L45.5 46 L53.5 46 L53 34 Z" fill={SKIN} {...ink} strokeWidth={1.8} />
        {!seated && <path d={jump ? 'M50 66 L58.6 64 Q62 72 60 80 L52 78 Z' : 'M50.6 64 L58.8 64 Q60.6 76 59.4 90 L52 90 Z'} fill={VEST} {...ink} strokeWidth={1.6} />}
        <path d={coat} fill={COAT} {...ink} strokeWidth={2} />
        {/* galon doré le long du bord de l'habit */}
        <path d={seated ? 'M56.8 45.6 Q59.2 54 59.4 63.6' : 'M56.8 45.6 Q59.2 54 58.6 65.6 Q55.2 76 52.4 89'} fill="none" stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" />
        <g fill="none" stroke={COAT_LO} strokeWidth={1.2} strokeLinecap="round">
          {seated ? <path d="M44 66 Q56 70 70 69" /> : <path d="M44.6 66 Q42.6 78 40.6 89 M48 66 Q47.6 78 46.6 90" />}
        </g>
        <path d={seated ? 'M47.6 62.4 L56.6 62.4 L56 65.6 L48 65.6 Z' : 'M46.6 63.8 L56 63.8 L55.4 67.2 L47 67.2 Z'} fill={COAT} {...ink} strokeWidth={1.2} />
        <path d={seated ? 'M48.4 64 L55.8 64' : 'M47.4 65.6 L55.2 65.6'} stroke={GOLD} strokeWidth={1} strokeLinecap="round" />
        {[49, 53.4, 57.8, 62].map((y) => (
          <Button key={y} x={57.2 + (y - 49) * 0.06} y={y} r={1.3} />
        ))}
        <Jabot side />
        <path d="M43.6 41.6 L52.6 40.6 L53.8 45.6 L44.6 46.6 Z" fill={COAT} {...ink} strokeWidth={1.6} />
        <path d="M44.4 44.6 L53.4 43.8" stroke={GOLD} strokeWidth={1} strokeLinecap="round" />
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
          <path d={`M49.5 66 L49.5 ${hemY + 1.6}`} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          <path d={`M43 66 Q41.6 ${hemY - 10} 40 ${hemY - 1} M56 66 Q57.4 ${hemY - 10} 59 ${hemY - 1}`} fill="none" stroke={COAT_LO} strokeWidth={1.2} strokeLinecap="round" />
          <Button x={45.6} y={62.6} />
          <Button x={53.4} y={62.6} />
          <path d={`M${lx + 1.4} ${hemY - 1.4} Q49.5 ${hemY + 3} ${rx - 1.4} ${hemY - 1.4}`} fill="none" stroke={GOLD} strokeWidth={1.4} strokeLinecap="round" />
          <path d="M42 46 Q49.5 44 57 46 L56.4 49 Q49.5 47.2 42.6 49 Z" fill={COAT} {...ink} strokeWidth={1.4} />
        </g>
      ) : (
        <g>
          {/* gilet crème brodé, boutonné */}
          <path d={`M44.6 46.6 L54.4 46.6 L53.8 66 L51.6 ${hemY - 18} L47.4 ${hemY - 18} L45.2 66 Z`} fill={VEST} {...ink} strokeWidth={1.4} />
          <path d={`M46.4 60 Q49.5 62.4 52.6 60 M46.8 ${hemY - 21} Q49.5 ${hemY - 19} 52.2 ${hemY - 21}`} fill="none" stroke={VEST_LO} strokeWidth={1} strokeLinecap="round" />
          {[52.6, 56.6, 60.6, 64.6].map((y) => (
            <circle key={y} cx={49.5} cy={y} r={0.9} fill={GOLD} stroke="currentColor" strokeWidth={0.7} />
          ))}
          {/* galons dorés le long des bords de l'habit */}
          <path d={`M43.2 46.4 Q41.6 56 42.6 66 Q42 ${hemY - 12} ${lx + 2} ${hemY - 1}`} fill="none" stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" />
          <path d={`M55.8 46.4 Q57.4 56 56.4 66 Q57 ${hemY - 12} ${rx - 2} ${hemY - 1}`} fill="none" stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" />
          {[50, 55, 60, 65].map((y) => (
            <Button key={y} x={41.2 - (y - 50) * 0.05} y={y} r={1.2} />
          ))}
          {/* poches à rabat galonnées */}
          <path d="M36 68.6 L44 68 L44.2 71.4 L36.4 72 Z" fill={COAT} {...ink} strokeWidth={1.3} />
          <path d="M55 68 L63 68.6 L62.6 72 L54.8 71.4 Z" fill={COAT} {...ink} strokeWidth={1.3} />
          <path d="M36.6 71 L43.8 70.4 M55.2 70.4 L62.4 71" stroke={GOLD} strokeWidth={0.9} strokeLinecap="round" />
          <path d="M38.4 47 Q37.4 53 38.4 58" fill="none" stroke={COAT_HI} strokeWidth={1.4} strokeLinecap="round" />
          <Jabot />
          <path d="M41.2 42.2 L44.6 46.6 M57 42.2 L53.6 46.6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
        </g>
      )}
    </g>
  );
}

export const mozart: CharacterDef = {
  id: 'mozart',
  name: 'Mozart',
  grows: 'sa perruque',
  skin: SKIN,
  limbs: { arm: COAT, leg: STOCKING, shoe: `url(#mozart-shoe-buckle) ${SHOE}` },
  head,
  face,
  body,
};
