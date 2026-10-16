// Platon : chevelure bouclée gris foncé ceinte d'un bandeau doré, barbe pleine et bien taillée, sourcils
// sévères mais bienveillants, nez droit « grec ». Chiton crème, himation bleu-gris jeté sur l'épaule
// gauche, sandales. Ce qui grandit : ses épaules (« Platon » veut dire « large ») : carrure normale au
// niveau 0, torse fier et épaules plus larges que la tête au niveau 4. Les bras partent sous la draperie
// des épaules (dessinée devant, par `front`).
import type { ReactNode } from 'react';
import type { CharacterDef, DrawArgs } from './types';
import { Cigar, type Expr, type Level } from '../Sprite';

const SKIN = '#eec8a6';
const SKIN_DARK = '#d9a682';
const HAIR = '#655e58';
const HAIR_CURL = '#8f877e';
const BAND = '#d9b04a';
const CHITON = '#efe5cc';
const CHITON_SHADE = '#cfc2a2';
const HIMATION = '#a9b8c6';
const HIMATION_SHADE = '#7f92a6';

/** Demi-largeur ajoutée aux épaules selon le niveau. */
const BROAD: Record<Level, number> = { 0: 0, 1: 3.5, 2: 7, 3: 10, 4: 13 };

type C = [number, number, number];

/** Nuage bouclé : cercles cernés d'encre puis remplis par-dessus (le contour ne reste qu'à l'extérieur). */
function Cloud({ cs, fill, sw = 2 }: { cs: C[]; fill: string; sw?: number }) {
  return (
    <g>
      {cs.map(([x, y, r], i) => (
        <circle key={'o' + i} cx={x} cy={y} r={r} fill={fill} stroke="currentColor" strokeWidth={sw * 2} />
      ))}
      {cs.map(([x, y, r], i) => (
        <circle key={'f' + i} cx={x} cy={y} r={r} fill={fill} />
      ))}
    </g>
  );
}

/** Petites boucles claires dans les cercles d'un nuage. */
function Curls({ cs, color = HAIR_CURL, w = 1 }: { cs: C[]; color?: string; w?: number }) {
  return (
    <g fill="none" stroke={color} strokeWidth={w} strokeLinecap="round">
      {cs.map(([x, y, r], i) => {
        const s = Math.min(r * 0.42, 3);
        const d = i % 2 ? `M${x - s} ${y - s * 0.3} q${s} ${s * 1.5} ${s * 2} 0` : `M${x - s * 0.6} ${y + s * 0.6} q${s * 1.2} ${-s * 1.6} ${s * 1.8} ${s * 0.3}`;
        return <path key={i} d={d} />;
      })}
    </g>
  );
}

/** Bandeau : trait d'encre épais, puis l'or par-dessus. */
function Band({ d, w = 3.6 }: { d: string; w?: number }) {
  return (
    <g fill="none" strokeLinecap="round">
      <path d={d} stroke="currentColor" strokeWidth={w + 2.2} />
      <path d={d} stroke={BAND} strokeWidth={w} />
      <path d={d} stroke="#f6e3a6" strokeWidth={0.9} opacity={0.8} transform="translate(0 -0.8)" />
    </g>
  );
}

function skinGrad(uid: string) {
  const id = `pla-skin-${uid}`;
  return {
    id,
    def: (
      <radialGradient id={id} cx="0.38" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#f9e2cc" />
        <stop offset="0.55" stopColor={SKIN} />
        <stop offset="1" stopColor="#d49e7a" />
      </radialGradient>
    ),
  };
}

// ── Tête ──
// Chevelure de face : une couronne de boucles au-dessus du bandeau, qui descend sur les tempes.
const HAIR_FRONT: C[] = [
  [20, 44, 4.9],
  [19, 37, 5.5],
  [21.5, 29.5, 5.9],
  [27, 24.5, 6.2],
  [34.5, 19, 6.4],
  [43.5, 15.5, 6.4],
  [54.5, 15.5, 6.4],
  [63.5, 19, 6.4],
  [71, 24.5, 6.2],
  [76.5, 29.5, 5.9],
  [79, 37, 5.5],
  [78, 44, 4.9],
  [40, 23, 5.4],
  [49, 21, 5.9],
  [58, 23, 5.4],
];
const BEARD_FRONT: C[] = [
  [24.6, 47.4, 3.8],
  [25.8, 53.6, 5],
  [29.4, 59.4, 6.2],
  [35.6, 64.4, 6.6],
  [42.4, 67.6, 6.8],
  [49, 69, 7],
  [55.6, 67.6, 6.8],
  [62.4, 64.4, 6.6],
  [68.6, 59.4, 6.2],
  [72.2, 53.6, 5],
  [73.4, 47.4, 3.8],
  [43, 61.8, 4.4],
  [49, 62.6, 4.4],
  [55, 61.8, 4.4],
];
const HAIR_SIDE: C[] = [
  [80, 20, 4.8],
  [73, 16.5, 5.6],
  [64.5, 15, 6],
  [56, 16.5, 6.2],
  [48.5, 21, 6.2],
  [44, 27, 6.6],
  [42.5, 35, 6.4],
  [44, 42.5, 6],
  [48.5, 48, 5.4],
  [55, 24, 6],
  [52, 33, 6],
  [64, 22, 5],
];
const BEARD_SIDE: C[] = [
  [64, 42, 4.6],
  [65.6, 49, 5.6],
  [71, 54.4, 6.2],
  [78.4, 56.4, 6.2],
  [85, 53.6, 5.2],
  [72, 48, 4.6],
  [88.4, 49.4, 3.4],
];
const HAIR_BACK: C[] = [
  [20, 46, 5.6],
  [19, 38, 6.2],
  [21.5, 30, 6.6],
  [27, 22.5, 7],
  [35, 19, 6.4],
  [44, 16, 6.4],
  [54, 16, 6.4],
  [63, 19, 6.4],
  [71, 22.5, 7],
  [76.5, 30, 6.6],
  [79, 38, 6.2],
  [78, 46, 5.6],
  [24, 53, 5.6],
  [31, 58, 6],
  [40, 61, 6],
  [49, 62, 6],
  [58, 61, 6],
  [67, 58, 6],
  [74, 53, 5.6],
  [36, 30, 9],
  [49, 28, 10],
  [62, 30, 9],
  [36, 45, 9],
  [49, 44, 10],
  [62, 45, 9],
];

function head({ view, uid }: DrawArgs): ReactNode {
  const g = skinGrad(uid);
  if (view === 'side') {
    return (
      <g>
        <defs>{g.def}</defs>
        <path d="M45 34 C 44 20, 56 12, 70 12 C 80 12, 86 17, 87.4 24 L 88.6 37.6 C 89.8 39.6, 90.4 42, 89.8 45 C 89.2 49, 86 53, 80 55 C 72 57.5, 62 56, 56 52 C 50 48, 45.5 42, 45 34 Z" fill={`url(#${g.id})`} stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round" />
        {/* rubans du bandeau, noués derrière la tête */}
        <g fill={BAND} stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round">
          <path d="M43 30 C 39 34, 38 39, 36.4 44 L 39.4 44.6 C 40.4 40, 42 35.6, 45 32 Z" />
          <path d="M44 31 C 43 36, 43.6 41, 43 46 L 46 46 C 46.4 41, 46.4 36.4, 46.4 32 Z" />
        </g>
        <Cloud cs={HAIR_SIDE} fill={HAIR} sw={1.1} />
        <Curls cs={HAIR_SIDE} w={0.9} />
        <Band d="M86.4 20.6 Q 66 13.6, 44 29.6" />
        <ellipse cx={58.5} cy={37} rx={4.4} ry={6.2} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
        <path d="M59.6 33.4 Q 56.6 36.6, 59.2 40.6" fill="none" stroke={SKIN_DARK} strokeWidth={1.2} strokeLinecap="round" />
        <Cloud cs={BEARD_SIDE} fill={HAIR} sw={1.1} />
        <Curls cs={BEARD_SIDE.slice(1, 5)} w={0.9} />
      </g>
    );
  }
  if (view === 'back') {
    return (
      <g>
        <defs>{g.def}</defs>
        <Cloud cs={[[23, 60, 5.6], [75, 60, 5.6]]} fill={HAIR} sw={1.1} />
        <ellipse cx={19.5} cy={47} rx={4.4} ry={6.2} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
        <ellipse cx={78.5} cy={47} rx={4.4} ry={6.2} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
        <path d="M24 44 C 21 25, 33 13, 49 13 C 65 13, 77 25, 74 44 C 73 56, 63 63, 49 63 C 35 63, 25 56, 24 44 Z" fill={`url(#${g.id})`} stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round" />
        <Cloud cs={HAIR_BACK} fill={HAIR} sw={1.1} />
        <Curls cs={HAIR_BACK} w={0.9} />
        <Band d="M20.6 31 Q 49 22.4, 77.4 31" />
        {/* nœud et rubans */}
        <g fill={BAND} stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round">
          <path d="M47.6 27.4 C 45 33, 43 39, 41.4 45 L 44.6 45.6 C 46 40, 48 34, 49.6 28 Z" />
          <path d="M50.4 27.4 C 53 33, 55 39, 56.6 45 L 53.4 45.6 C 52 40, 50 34, 48.4 28 Z" />
          <ellipse cx={49} cy={26.6} rx={2.6} ry={2.1} />
        </g>
      </g>
    );
  }
  return (
    <g>
      <defs>{g.def}</defs>
      <ellipse cx={19.5} cy={47} rx={4.4} ry={6.4} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
      <ellipse cx={78.5} cy={47} rx={4.4} ry={6.4} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
      <path d="M20 44 Q 18.4 47, 20.6 50.4 M78 44 Q 79.6 47, 77.4 50.4" fill="none" stroke={SKIN_DARK} strokeWidth={1.2} strokeLinecap="round" />
      <path d="M23.4 45 C 21 26, 33 14, 49 14 C 65 14, 77 26, 74.6 45 C 74 57, 65 66, 49 66 C 33 66, 24 57, 23.4 45 Z" fill={`url(#${g.id})`} stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round" />
      <Cloud cs={HAIR_FRONT} fill={HAIR} sw={1.1} />
      <Curls cs={HAIR_FRONT.slice(0, 12)} w={0.9} />
      <Band d="M22.6 31.4 Q 49 21.6, 75.4 31.4" />
      <Cloud cs={BEARD_FRONT} fill={HAIR} sw={1.1} />
      <Curls cs={BEARD_FRONT.slice(1, 10)} w={0.9} />
    </g>
  );
}

/** Sourcils épais : encre, puis la couleur des cheveux. */
function Brow({ d }: { d: string }) {
  return (
    <g fill="none" strokeLinecap="round">
      <path d={d} stroke="currentColor" strokeWidth={6.2} />
      <path d={d} stroke={HAIR} strokeWidth={4} />
    </g>
  );
}

const LIP = '#b8604f';
const MOUTH = '#4a1c16';
const EYE_W = '#f8f0e2';
const clampG = (g: [number, number]): [number, number] => [Math.max(-1.3, Math.min(1.3, g[0] * 0.55)), Math.max(-0.6, Math.min(0.6, g[1] * 0.35))];

/** Œil de face, enfoncé sous l'arcade : amande étroite, paupière lourde. */
function EyeFront({ x, y, eyes, g }: { x: number; y: number; eyes: Expr['eyes']; g: [number, number] }) {
  const socket = <ellipse cx={x} cy={y - 0.6} rx={6.6} ry={4.4} fill={SKIN_DARK} opacity={0.5} />;
  if (eyes === 'closed' || eyes === 'happy')
    return (
      <g>
        {socket}
        <path d={eyes === 'closed' ? `M${x - 4.6} ${y} Q ${x} ${y + 2.6}, ${x + 4.6} ${y}` : `M${x - 4.6} ${y + 1.2} Q ${x} ${y - 2.4}, ${x + 4.6} ${y + 1.2}`} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      </g>
    );
  const almond = `M${x - 4.8} ${y} C ${x - 2.4} ${y - 2.6}, ${x + 2.4} ${y - 2.8}, ${x + 4.8} ${y - 0.4} C ${x + 2.6} ${y + 2.4}, ${x - 2.4} ${y + 2.4}, ${x - 4.8} ${y} Z`;
  const lid = eyes === 'lidded';
  return (
    <g>
      {socket}
      <path d={almond} fill={EYE_W} stroke="currentColor" strokeWidth={1} />
      <circle cx={x + g[0]} cy={y + 0.1 + g[1]} r={2} fill="#2e2219" />
      <circle cx={x + g[0] + 0.7} cy={y - 0.6 + g[1]} r={0.55} fill={EYE_W} />
      {lid && <path d={`M${x - 5} ${y + 0.2} C ${x - 2.4} ${y - 3}, ${x + 2.4} ${y - 3.2}, ${x + 5} ${y - 0.2} Z`} fill={SKIN} />}
      <path d={lid ? `M${x - 5} ${y + 0.2} L ${x + 5} ${y - 0.2}` : `M${x - 5.2} ${y + 0.1} C ${x - 2.4} ${y - 2.9}, ${x + 2.4} ${y - 3.1}, ${x + 5.2} ${y - 0.5}`} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
    </g>
  );
}

/** Bouche sérieuse, dans la barbe, sous une moustache drue. */
function MouthFront({ mouth, hot }: { mouth: Expr['mouth']; hot: boolean }) {
  const lower = (w = 3.6) => <path d={`M${48 - w} 53.2 Q 48 56.6, ${48 + w} 53.2 Q 48 54.4, ${48 - w} 53.2 Z`} fill={LIP} stroke="currentColor" strokeWidth={0.9} strokeLinejoin="round" />;
  switch (mouth) {
    case 'o':
    case 'puff':
      return <ellipse cx={48.6} cy={53} rx={mouth === 'o' ? 2 : 1.6} ry={mouth === 'o' ? 2.3 : 1.9} fill={MOUTH} stroke={LIP} strokeWidth={1.6} />;
    case 'sleep':
      return <ellipse cx={48} cy={53} rx={1.6} ry={1.2} fill={MOUTH} stroke="currentColor" strokeWidth={0.6} />;
    case 'flat':
    case 'tongue':
      return (
        <g>
          {lower()}
          <path d="M43.8 52.8 L 52.2 52.8" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          {mouth === 'tongue' && <ellipse cx={52.4} cy={53.4} rx={1.3} ry={1} fill="#d9606a" stroke="currentColor" strokeWidth={0.6} transform="rotate(25 52.4 53.4)" />}
        </g>
      );
    case 'cigar':
      return (
        <g>
          {lower(3)}
          <path d="M44.4 52.8 L 50.4 52.6" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          <Cigar x={50.2} y={52.6} rot={14} len={13} hot={hot} />
        </g>
      );
    case 'smirk':
      return (
        <g>
          {lower(3.2)}
          <path d="M44 53 Q 48.6 53.4, 52.4 51.4" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
        </g>
      );
    default:
      return (
        <g>
          <path d="M43.4 52 Q 48 55.2, 52.6 52 Q 48 53, 43.4 52 Z" fill={MOUTH} stroke="currentColor" strokeWidth={1.1} strokeLinejoin="round" />
          {lower(3.4)}
        </g>
      );
  }
}

function MouthSide({ mouth, hot }: { mouth: Expr['mouth']; hot: boolean }) {
  const lower = <path d="M85 43.6 C 86 45.8, 88.8 45.8, 89.2 43.6 Z" fill={LIP} stroke="currentColor" strokeWidth={0.9} strokeLinejoin="round" />;
  switch (mouth) {
    case 'o':
    case 'puff':
      return <ellipse cx={88.2} cy={43} rx={1.4} ry={mouth === 'o' ? 2 : 1.6} fill={MOUTH} stroke={LIP} strokeWidth={1.5} />;
    case 'sleep':
      return <ellipse cx={88} cy={43.2} rx={1.1} ry={0.9} fill={MOUTH} />;
    case 'cigar':
      return (
        <g>
          {lower}
          <Cigar x={86.2} y={42.6} rot={6} len={11} hot={hot} />
        </g>
      );
    default:
      return (
        <g>
          {lower}
          <path d={mouth === 'smile' || mouth === 'smirk' ? 'M83 42.4 Q 85.6 43.8, 89.4 43.2' : 'M83 43.2 L 89.4 43.3'} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          {mouth === 'tongue' && <ellipse cx={89.4} cy={44} rx={1.2} ry={1} fill="#d9606a" stroke="currentColor" strokeWidth={0.6} />}
        </g>
      );
  }
}

function face({ view, expr }: DrawArgs & { expr: Expr }): ReactNode {
  const g = clampG(expr.gaze);
  const up = expr.browUp;
  const cigar = expr.mouth === 'cigar';
  if (view === 'side') {
    const open = expr.eyes === 'open' || expr.eyes === 'lidded';
    return (
      <g>
        <ellipse cx={75.6} cy={29.6} rx={5.6} ry={4.4} fill={SKIN_DARK} opacity={0.5} />
        {open ? (
          <g>
            <path d="M71.8 30.8 C 73.6 28.6, 77.6 28.2, 79.6 30.2 C 77.8 32.6, 73.8 32.8, 71.8 30.8 Z" fill={EYE_W} stroke="currentColor" strokeWidth={1} />
            <circle cx={77 + g[0]} cy={30.6 + g[1]} r={1.8} fill="#2e2219" />
            {expr.eyes === 'lidded' && <path d="M71.6 30.9 C 73.6 28.2, 77.8 27.8, 79.8 30.2 Z" fill={SKIN} />}
            <path d={expr.eyes === 'lidded' ? 'M71.4 30.9 L 80 30.2' : 'M71.2 30.6 C 73.4 28, 77.8 27.6, 80.2 30'} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
          </g>
        ) : (
          <path d={expr.eyes === 'closed' ? 'M71.6 30.6 Q 75.6 33, 79.6 30.4' : 'M71.6 31.6 Q 75.6 27.8, 79.6 31.4'} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
        )}
        <Brow d={up ? 'M69.8 23.4 Q 75.4 19.6, 81.4 23' : 'M69.6 26.2 Q 75.6 23.6, 82.2 26.8'} />
        <MouthSide mouth={expr.mouth} hot={expr.hot} />
        {/* nez droit et long, dans le prolongement du front */}
        <path d="M87.2 23.4 L 95.2 38.4 C 95.4 40.2, 93 40.8, 89.4 40.2" fill={SKIN} stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" />
        <path d="M91.2 38.2 Q 92.6 39.4, 91.4 40" fill="none" stroke="currentColor" strokeWidth={0.9} strokeLinecap="round" />
        <path d="M90.6 40.8 C 87 39.8, 82 40, 79.4 43.6 C 82.6 42.2, 86.2 42, 90.2 42 Z" fill={HAIR} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />
      </g>
    );
  }
  return (
    <g>
      <EyeFront x={37.6} y={43.4} eyes={expr.eyes} g={g} />
      <EyeFront x={60.4} y={43.4} eyes={expr.eyes} g={g} />
      <Brow d={up ? 'M30.6 34.6 Q 37 29.6, 44 33.6' : 'M30.4 36.6 Q 37 33.6, 44.2 37.6'} />
      <Brow d="M51.8 37.6 Q 59 33.6, 65.6 36.6" />
      {/* nez droit et long */}
      <path d="M47.2 37.6 C 47.2 41.4, 46.6 44.2, 45.4 46.4" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
      <path d="M50 39 C 50.4 42, 50.8 44.4, 51.4 46" fill="none" stroke={SKIN_DARK} strokeWidth={1.2} strokeLinecap="round" />
      <path d="M44.4 47.2 C 44 49, 45.8 49.6, 46.8 48.8 Q 48 49.8, 49.2 48.8 C 50.2 49.6, 52 49, 51.6 47.2" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx={46.6} cy={48.1} rx={0.8} ry={0.5} fill="currentColor" opacity={0.7} />
      <ellipse cx={49.4} cy={48.1} rx={0.8} ry={0.5} fill="currentColor" opacity={0.7} />
      <MouthFront mouth={expr.mouth} hot={expr.hot} />
      {/* moustache drue, tombante */}
      <path d="M48 49.8 C 44.6 49.2, 40.6 50, 38.6 54 C 41.4 52.2, 44.4 51.6, 47 51.8 Z" fill={HAIR} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />
      {!cigar && <path d="M48 49.8 C 51.4 49.2, 55.4 50, 57.4 54 C 54.6 52.2, 51.6 51.6, 49 51.8 Z" fill={HAIR} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />}
    </g>
  );
}

// ── Corps ──
const fold = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' as const, opacity: 0.5 };
const ink = { stroke: 'currentColor', strokeWidth: 2.1, strokeLinejoin: 'round' as const };

function body({ view, seated, pose, level }: DrawArgs): ReactNode {
  const S = BROAD[level];
  const jump = pose === 'jump';
  if (view === 'side') {
    const fx = 60.5 + S * 0.42; // poitrine bombée
    const bx = 42 - S * 0.3;
    const hem = jump ? 80 : 88;
    const neck = <path d="M49 31 C 49.6 36, 48.6 40, 48 45 L 57.6 45 C 57.8 40, 58.6 36, 60 31 Z" fill={SKIN} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />;
    const torso = `M${bx + 2} ${41.5 - S * 0.12} C 51 ${39.5 - S * 0.15}, ${fx - 2} ${41 - S * 0.1}, ${fx} ${48} C ${fx + 1} 54, ${fx - S * 0.3 - 1} 58, 60`;
    if (seated) {
      return (
        <g>
          {neck}
          <path d={`${torso} 58 C 64 60, 68 62, 68.5 66 L 68 71.5 L ${bx - 1.5} 71.5 C ${bx - 2.5} 64, ${bx - 2} 47, ${bx + 2} ${41.5 - S * 0.12} Z`} fill={CHITON} {...ink} />
          <path d={`M${bx + 3} 60 C 52 61, 62 61, 68.4 65.6 L 67.8 71.5 L ${bx - 1.5} 71.5 C ${bx - 2} 67, ${bx - 1} 63, ${bx + 3} 60 Z`} fill={HIMATION} {...ink} />
          <path d={`M${bx + 2} 66 Q 55 66.4, 66 68.6`} {...fold} />
          {S > 0 && <path d={`M${fx - 4} 47 Q ${fx - 2} 52, ${fx - 5} 55`} {...fold} />}
        </g>
      );
    }
    return (
      <g>
        {neck}
        <path d={`${torso} 63 L 62 ${hem} Q 51 ${hem + 2.6}, 40 ${hem} L 41.4 64 C ${bx - 2} 56, ${bx - 2} 47, ${bx + 2} ${41.5 - S * 0.12} Z`} fill={CHITON} {...ink} />
        {/* himation enroulé autour des hanches */}
        <path d={`M${bx - 0.4} 58 C 50 59.6, 56 60, 60.6 59.4 L 61.6 ${hem - 2.6} Q 51 ${hem - 0.2}, 40.2 ${hem - 2.6} L 41.4 64 C ${bx - 1} 62, ${bx - 1} 60, ${bx - 0.4} 58 Z`} fill={HIMATION} {...ink} />
        <path d={`M45.4 62 C 45 70, 45.6 ${hem - 12}, 45 ${hem - 4}`} {...fold} />
        <path d={`M53.4 62 C 53 70, 54 ${hem - 10}, 53.6 ${hem - 2}`} {...fold} />
        {S > 0 && <path d={`M${fx - 4} 47 Q ${fx - 2} 52, ${fx - 5} 55`} {...fold} />}
      </g>
    );
  }
  const back = view === 'back';
  const flipX = back ? 'translate(98 0) scale(-1 1)' : undefined;
  const hem = seated ? 77 : jump ? 80 : 88;
  const L = 33.6 - S;
  const R = 64.4 + S;
  const top = 43.2 - S * 0.12;
  const neck = <path d="M43.5 36 L 43.5 45 L 54.5 45 L 54.5 36 Z" fill={SKIN} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />;
  // torse en V : épaules larges, taille aux hanches
  const upper = `M${39 - S * 0.4} ${top} Q 49 ${top - 2.4}, ${59 + S * 0.4} ${top} C ${R - 1} ${top + 0.2}, ${R + 0.4} ${top + 3}, ${R} 50 C ${R - 0.6 - S * 0.25} 55, 61.4 59, 60.6 64`;
  const lowerLeft = `L 37.4 64 C 36.6 59, ${L + 0.6 + S * 0.25} 55, ${L} 50 C ${L - 0.4} ${top + 3}, ${L + 1} ${top + 0.2}, ${39 - S * 0.4} ${top} Z`;
  const skirt = seated ? ` C 64 66, 66 70, 66.4 ${hem} Q 49 ${hem + 3}, 31.6 ${hem} C 32 70, 34 66, 37.4 64 ` : ` L 64.6 ${hem} Q 49 ${hem + 3}, 33.4 ${hem} L 37.4 64 `;
  return (
    <g>
      {neck}
      <path d={upper + skirt + lowerLeft.replace(/^L 37.4 64 /, 'L 37.4 64 ')} fill={CHITON} {...ink} />
      {/* poitrine (le torse se bombe avec le niveau) */}
      {!back && level > 0 && (
        <g {...fold}>
          <path d={`M${43 - S * 0.5} ${51 + S * 0.1} Q ${46 - S * 0.1} ${54 + S * 0.15}, 49 ${52 + S * 0.1}`} />
        </g>
      )}
      <g transform={flipX}>
        {!back && <path d="M41 44 Q 45 47.5, 49 46" fill="none" stroke={CHITON_SHADE} strokeWidth={1.2} strokeLinecap="round" />}
        <path
          d={
            seated
              ? `M51 ${top - 0.4} C 56 ${top - 1.4}, ${R - 1} ${top - 0.6}, ${R} 48.4 C ${R + 0.2} 52, ${R - 3 - S * 0.3} 58, 62 62 C 65 66, 66.6 70, 66.6 ${hem - 2} Q 49 ${hem + 1}, 32.2 ${hem - 2} C 32.6 71, 34.6 67, 37.4 64.4 C 42 58, 47 51, 51 ${top - 0.4} Z`
              : `M51 ${top - 0.4} C 56 ${top - 1.4}, ${R - 1} ${top - 0.6}, ${R} 48.4 C ${R + 0.2} 52, ${R - 3 - S * 0.3} 58, 61.2 64 L 65 ${hem - 2.6} Q 49 ${hem + 0.4}, 33 ${hem - 2.6} L 36.2 70 C 41 61, 46.5 52, 51 ${top - 0.4} Z`
          }
          fill={HIMATION}
          {...ink}
        />
        <path d={`M${56 + S * 0.3} 46 C 51.6 54, 46 61, 40.4 68`} {...fold} />
        <path d={`M${60 + S * 0.6} 50.6 C 57 59, 52 66, 46.4 72`} {...fold} />
        {seated ? (
          <path d="M38 73 Q 49 75, 61 73" {...fold} />
        ) : (
          <g>
            <path d={`M55.6 70 C 56.4 75, 56.6 ${hem - 8}, 57.6 ${hem - 3.4}`} {...fold} />
            <path d={`M47.4 74 C 47 78, 46.4 ${hem - 6}, 45.6 ${hem - 2.6}`} {...fold} />
          </g>
        )}
      </g>
      {!seated && <path d={`M35.4 ${hem - 0.2} Q 49 ${hem + 2.4}, 62.8 ${hem - 0.2}`} stroke={CHITON_SHADE} strokeWidth={1} fill="none" opacity={0.8} />}
    </g>
  );
}

/** Draperie des épaules, devant la racine des bras : manche du chiton d'un côté, pan de l'himation de l'autre. */
function front({ view, level }: DrawArgs): ReactNode {
  const S = BROAD[level];
  if (view === 'side') {
    const rx = 6 + S * 0.45;
    const cx = 51.5;
    const outline = `M${cx - rx} 48.4 C ${cx - rx} ${42.4 - S * 0.12}, ${cx + rx} ${42 - S * 0.12}, ${cx + rx} 48.4 C ${cx + rx * 0.7} 53.4, ${cx - rx * 0.7} 53.6, ${cx - rx} 48.4`;
    return (
      <g>
        <path d={outline + ' Z'} fill={HIMATION} />
        <path d={`M${cx + rx} 48.4 C ${cx + rx * 0.7} 53.4, ${cx - rx * 0.7} 53.6, ${cx - rx} 48.4`} fill="none" {...ink} strokeWidth={1.9} strokeLinecap="round" />
        <path d={`M${cx - rx * 0.6} 46 Q ${cx} 49.4, ${cx + rx * 0.6} 46`} {...fold} />
      </g>
    );
  }
  const back = view === 'back';
  const top = 43.2 - S * 0.12;
  const L = 33.6 - S;
  // côté gauche à l'écran (de face) : manche du chiton ; côté droit : himation
  const sleeve = (fill: string, mirror: boolean) => {
    // contour d'encre sur le dessus de l'épaule et l'ourlet (d'où sort le bras), pas du côté du cou
    const edge = `M${42 - S * 0.3} ${top + 0.6} C ${L + 2} ${top - 0.6}, ${L - 1.6} ${top + 2.6}, ${L - 1.2} 49.6 C ${L - 0.8} 53, ${L + 3} 54.6, ${L + 6.4 + S * 0.2} 53.8 C ${40 + S * 0.05} 53, 42 51.4, 43 49`;
    return (
      <g transform={mirror ? 'translate(98 0) scale(-1 1)' : undefined}>
        <path d={edge + ` C 44 47, 43 ${top + 2}, ${42 - S * 0.3} ${top + 0.6} Z`} fill={fill} />
        <path d={edge} fill="none" {...ink} strokeWidth={1.9} strokeLinecap="round" />
        <path d={`M${L + 2} 50.6 Q ${L + 5} 52.6, ${L + 8 + S * 0.2} 51.6`} {...fold} />
      </g>
    );
  };
  return (
    <g>
      {sleeve(back ? HIMATION : CHITON, false)}
      {sleeve(back ? CHITON : HIMATION, true)}
    </g>
  );
}

export const platon: CharacterDef = {
  id: 'platon',
  name: 'Platon',
  grows: 'ses épaules',
  skin: SKIN,
  limbs: { arm: SKIN, leg: SKIN, shoe: '#7a4e2e' },
  body,
  head,
  face,
  front,
};
