// Socrate : crâne chauve en dôme, couronne de boucles grises autour des oreilles, gros sourcils
// broussailleux, le fameux nez camus, sourire bonhomme. Chiton sable, himation blanc cassé jeté sur
// l'épaule gauche, sandales. Ce qui grandit : sa barbe bouclée, courte sous le menton au niveau 0,
// jusqu'à la ceinture et au-delà au niveau 4 (posée sur les genoux quand il est assis).
import type { ReactNode } from 'react';
import type { CharacterDef, DrawArgs } from './types';
import { Cigar, type Expr, type Level } from '../Sprite';

const SKIN = '#f1d3b8';
const SKIN_DARK = '#e2b493';
const HAIR = '#ece8df';
const HAIR_SHADE = '#b9b2a4';
const CHITON = '#d4b47c';
const CHITON_SHADE = '#ad8b52';
const HIMATION = '#ebe3cf';
const HIMATION_SHADE = '#c9bea3';

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

/** Petites boucles (« c » plus sombres) dans les cercles d'un nuage. */
function Curls({ cs, color = HAIR_SHADE, w = 1 }: { cs: C[]; color?: string; w?: number }) {
  return (
    <g fill="none" stroke={color} strokeWidth={w} strokeLinecap="round">
      {cs.map(([x, y, r], i) => {
        const s = Math.min(r * 0.42, 3.2);
        const d = i % 2 ? `M${x - s} ${y - s * 0.3} q${s} ${s * 1.5} ${s * 2} 0` : `M${x - s * 0.6} ${y + s * 0.6} q${s * 1.2} ${-s * 1.6} ${s * 1.8} ${s * 0.3}`;
        return <path key={i} d={d} />;
      })}
    </g>
  );
}

const SPEC = {
  /** pointe de la barbe (repère de la tête, avant réduction) */
  tip: [73, 84, 96, 108, 121],
  jaw: [5, 6, 7, 7.8, 8.6],
  top: [7, 9.5, 11, 12.5, 13.5],
  bot: [5, 6, 6.6, 7.2, 7.6],
};

/** Barbe de face : favoris le long de la mâchoire, puis une colonne de boucles jusqu'à la pointe. */
function beardFront(level: Level): C[] {
  const jr = SPEC.jaw[level];
  const cs: C[] = [
    [25.5, 47, jr * 0.8],
    [27, 54, jr],
    [32, 60, jr],
    [40, 64, jr],
    [72.5, 47, jr * 0.8],
    [71, 54, jr],
    [66, 60, jr],
    [58, 64, jr],
  ];
  const T = SPEC.tip[level];
  const y0 = 66;
  const rows = Math.max(1, Math.round((T - y0) / 6.5));
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const r = SPEC.top[level] + (SPEC.bot[level] - SPEC.top[level]) * t;
    const y = y0 + (T - r - y0) * t;
    const w = (1 - t) * (6 + level * 1.4) + 1.5;
    const sway = i % 2 ? 1.6 : -1.6;
    if (i === rows) cs.push([49 + sway * 0.5, y, r]);
    else cs.push([49 - w + sway, y, r], [49 + w + sway, y, r]);
  }
  return cs;
}

/** Barbe de profil : favori devant l'oreille, menton, puis la barbe tombe vers l'avant et revient sur la poitrine. */
function beardSide(level: Level, seated: boolean): C[] {
  const jr = SPEC.jaw[level];
  const cs: C[] = [
    [64, 44, jr * 0.9],
    [66, 51, jr],
    [73, 54.5, jr],
    [81, 54, jr * 0.95],
    [86.5, 51.5, jr * 0.75],
  ];
  const full = SPEC.tip[level];
  const T = seated ? Math.min(full, 96) : full;
  const xAt = (y: number) => 80 - (y - 58) * 0.26;
  const y0 = 58;
  const rows = Math.max(1, Math.round((T - y0) / 6.5));
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const r = SPEC.top[level] * 0.85 + (SPEC.bot[level] - SPEC.top[level] * 0.85) * t;
    const y = y0 + (T - r - y0) * t;
    const w = (1 - t) * (3 + level) + 1;
    const x = xAt(y) + (i % 2 ? 1.2 : -1.2);
    if (i === rows) cs.push([x, y, r]);
    else cs.push([x - w, y, r], [x + w, y, r]);
  }
  if (seated && full > T) {
    // le reste repose sur les cuisses, étalé vers l'avant et l'arrière
    const extra = full - T;
    const x0 = xAt(T);
    const r = SPEC.bot[level];
    for (let x = x0 - extra * 0.35; x <= x0 + extra * 0.45; x += 5.5) cs.push([x, T - r * 0.6 + Math.abs(x - x0) * 0.06, r]);
  }
  return cs;
}

function skinGrad(uid: string) {
  const id = `soc-skin-${uid}`;
  return {
    id,
    def: (
      <radialGradient id={id} cx="0.38" cy="0.28" r="0.8">
        <stop offset="0" stopColor="#fbe8d8" />
        <stop offset="0.55" stopColor={SKIN} />
        <stop offset="1" stopColor="#d9a986" />
      </radialGradient>
    ),
  };
}

function head({ view, level, seated, uid }: DrawArgs): ReactNode {
  const g = skinGrad(uid);
  if (view === 'side') {
    const fringe: C[] = [
      [55, 27, 3.6],
      [50, 26, 4.2],
      [46.5, 31, 4.6],
      [45.5, 37.5, 4.8],
      [47.5, 44, 4.6],
      [52.5, 48.5, 4.2],
    ];
    return (
      <g>
        <defs>{g.def}</defs>
        <path d="M45 34 C 44 20, 56 12, 70 12 C 81 12, 88 19, 88.5 28 L 88.2 37 C 89.8 39, 90.6 42, 89.8 45 C 89.2 49, 86 53, 80 55 C 72 57.5, 62 56, 56 52 C 50 48, 45.5 42, 45 34 Z" fill={`url(#${g.id})`} stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round" />
        <ellipse cx={63} cy={18} rx={7} ry={3} transform="rotate(-14 63 18)" fill="#fff8ee" opacity={0.6} />
        <g fill="none" stroke={SKIN_DARK} strokeWidth={1.1} strokeLinecap="round">
          <path d="M74 17.5 Q 79 16, 84 18.5" />
          <path d="M75 21 Q 79.5 19.8, 84.5 22" />
        </g>
        <Cloud cs={fringe} fill={HAIR} sw={1.1} />
        <Curls cs={fringe} w={0.8} />
        <ellipse cx={58.5} cy={36} rx={4.4} ry={6.2} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
        <path d="M59.6 32.4 Q 56.6 35.6, 59.2 39.6" fill="none" stroke={SKIN_DARK} strokeWidth={1.2} strokeLinecap="round" />
        <Cloud cs={beardSide(level, seated)} fill={HAIR} sw={1.1} />
        <Curls cs={beardSide(level, seated).slice(1)} w={0.9} />
      </g>
    );
  }
  if (view === 'back') {
    const fringe: C[] = [
      [22, 38, 5],
      [21, 46, 5.4],
      [25, 53, 5.4],
      [31.5, 58, 5.2],
      [39.5, 61, 5],
      [49, 62, 5],
      [58.5, 61, 5],
      [66.5, 58, 5.2],
      [73, 53, 5.4],
      [77, 46, 5.4],
      [76, 38, 5],
    ];
    const side = level >= 1 ? 4 + level * 1.6 : 0;
    return (
      <g>
        <defs>{g.def}</defs>
        {side > 0 && (
          <Cloud
            cs={[
              [22, 60, side],
              [76, 60, side],
              [27, 65, side * 0.9],
              [71, 65, side * 0.9],
            ]}
            fill={HAIR}
            sw={1.1}
          />
        )}
        <ellipse cx={20} cy={45} rx={4.4} ry={6.2} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
        <ellipse cx={78} cy={45} rx={4.4} ry={6.2} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
        <path d="M24 44 C 21 25, 33 13, 49 13 C 65 13, 77 25, 74 44 C 73 56, 63 63, 49 63 C 35 63, 25 56, 24 44 Z" fill={`url(#${g.id})`} stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round" />
        <ellipse cx={42} cy={21} rx={8} ry={3.4} transform="rotate(-16 42 21)" fill="#fff8ee" opacity={0.55} />
        <Cloud cs={fringe} fill={HAIR} sw={1.1} />
        <Curls cs={fringe} w={0.8} />
      </g>
    );
  }
  const fringe: C[] = [
    [27, 27, 3.6],
    [22, 31, 4.6],
    [17.5, 37, 5],
    [16, 44, 5],
    [17.5, 51, 4.6],
    [21.5, 56.5, 4],
  ];
  const fringeR = fringe.map(([x, y, r]) => [98 - x, y, r] as C);
  const beard = beardFront(level);
  return (
    <g>
      <defs>{g.def}</defs>
      <Cloud cs={[...fringe, ...fringeR]} fill={HAIR} sw={1.1} />
      <Curls cs={[...fringe, ...fringeR]} w={0.8} />
      <ellipse cx={19.5} cy={46} rx={4.4} ry={6.4} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
      <ellipse cx={78.5} cy={46} rx={4.4} ry={6.4} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
      <path d="M20 43 Q 18.4 46, 20.6 49.4 M78 43 Q 79.6 46, 77.4 49.4" fill="none" stroke={SKIN_DARK} strokeWidth={1.2} strokeLinecap="round" />
      <path d="M24 46 C 21 26, 33 13, 49 13 C 65 13, 77 26, 74 46 C 73 58, 63 66, 49 66 C 35 66, 25 58, 24 46 Z" fill={`url(#${g.id})`} stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round" />
      <ellipse cx={39} cy={20.5} rx={8} ry={3.4} transform="rotate(-18 39 20.5)" fill="#fff8ee" opacity={0.6} />
      {/* front plissé du penseur */}
      <g fill="none" stroke={SKIN_DARK} strokeWidth={1.1} strokeLinecap="round">
        <path d="M39 24.5 Q 49 21.5, 59 24.5" />
        <path d="M41 28 Q 49 25.6, 57 28" />
      </g>
      {/* pattes d'oie */}
      <g fill="none" stroke={SKIN_DARK} strokeWidth={0.9} strokeLinecap="round">
        <path d="M28.5 41.5 L 26 40.5 M28.4 44 L 25.8 44.4" />
        <path d="M67.5 41.5 L 70 40.5 M67.6 44 L 70.2 44.4" />
      </g>
      <Cloud cs={beard} fill={HAIR} sw={1.1} />
      <Curls cs={beard.slice(8)} w={0.9} />
      <Curls cs={beard.slice(0, 8).filter((_, i) => i % 2)} w={0.8} />
    </g>
  );
}

/** Sourcils broussailleux : trait d'encre épais, puis la couleur des cheveux par-dessus. */
function Brow({ d }: { d: string }) {
  return (
    <g fill="none" strokeLinecap="round">
      <path d={d} stroke="currentColor" strokeWidth={6} />
      <path d={d} stroke={HAIR} strokeWidth={3.8} />
    </g>
  );
}

const LIP = '#c9604f';
const MOUTH = '#4a1c16';
const EYE_W = '#fbf4e6';
const clampG = (g: [number, number]): [number, number] => [Math.max(-1.4, Math.min(1.4, g[0] * 0.6)), Math.max(-1, Math.min(1, g[1] * 0.5))];

/** Œil de face, globuleux : globe un peu saillant, paupière lourde, poche dessous. */
function EyeFront({ x, y, eyes, g, flip }: { x: number; y: number; eyes: Expr['eyes']; g: [number, number]; flip: boolean }) {
  const s = flip ? -1 : 1;
  const bag = <path d={`M${x - 4.8} ${y + 4.2} Q ${x} ${y + 7.6}, ${x + 4.8} ${y + 4.2}`} fill="none" stroke={SKIN_DARK} strokeWidth={1.3} strokeLinecap="round" />;
  if (eyes === 'closed')
    return (
      <g>
        <path d={`M${x - 5} ${y + 0.4} Q ${x} ${y + 3.8}, ${x + 5} ${y + 0.4}`} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
        {bag}
      </g>
    );
  if (eyes === 'happy')
    return (
      <g>
        <path d={`M${x - 5} ${y + 2} Q ${x} ${y - 3.2}, ${x + 5} ${y + 2}`} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
        <path d={`M${x - 4} ${y + 4.6} Q ${x} ${y + 6.8}, ${x + 4} ${y + 4.6}`} fill="none" stroke={SKIN_DARK} strokeWidth={1.2} strokeLinecap="round" />
      </g>
    );
  const lid = eyes === 'lidded';
  return (
    <g>
      <ellipse cx={x} cy={y + 0.6} rx={5.1} ry={4.3} fill={EYE_W} stroke="currentColor" strokeWidth={1.2} />
      <circle cx={x + g[0] + s * 0.2} cy={y + 1.1 + g[1]} r={2.3} fill="#3b2a1c" />
      <circle cx={x + g[0] + s * 0.2 + 0.8} cy={y + 0.6 + g[1]} r={0.65} fill={EYE_W} />
      {lid ? (
        <path d={`M${x - 4.9} ${y + 0.8} C ${x - 4.4} ${y - 3.8}, ${x + 4.4} ${y - 3.8}, ${x + 4.9} ${y + 0.8} Z`} fill={SKIN} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
      ) : (
        <g>
          {/* paupière lourde : elle couvre le haut du globe */}
          <path d={`M${x - 4.9} ${y + 0.2} C ${x - 4.4} ${y - 4.4}, ${x + 4.4} ${y - 4.4}, ${x + 4.9} ${y + 0.2} Q ${x} ${y - 1.9}, ${x - 4.9} ${y + 0.2} Z`} fill={SKIN} transform={`translate(${x} ${y}) scale(1.1) translate(${-x} ${-y})`} />
          <path d={`M${x - 5.4} ${y + 0.3} Q ${x} ${y - 2.1}, ${x + 5.4} ${y + 0.3}`} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
          <path d={`M${x - 5.2} ${y - 0.6} C ${x - 4} ${y - 5}, ${x + 4} ${y - 5}, ${x + 5.2} ${y - 0.6}`} fill="none" stroke={SKIN_DARK} strokeWidth={1.1} strokeLinecap="round" />
        </g>
      )}
      {bag}
    </g>
  );
}

/** Bouche de face : lèvres épaisses (la lèvre inférieure charnue), sous la moustache. */
function MouthFront({ mouth, hot }: { mouth: Expr['mouth']; hot: boolean }) {
  const lower = (y: number, w = 4.4) => <path d={`M${48 - w} ${y} Q 48 ${y + 4.4}, ${48 + w} ${y} Q 48 ${y + 1.6}, ${48 - w} ${y} Z`} fill={LIP} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />;
  switch (mouth) {
    case 'o':
    case 'puff':
      return <ellipse cx={48.6} cy={52.8} rx={mouth === 'o' ? 2.2 : 1.7} ry={mouth === 'o' ? 2.5 : 2} fill={MOUTH} stroke={LIP} strokeWidth={1.8} />;
    case 'sleep':
      return (
        <g>
          <ellipse cx={48} cy={52.6} rx={1.8} ry={1.3} fill={MOUTH} />
          {lower(53.4, 3.4)}
        </g>
      );
    case 'flat':
    case 'tongue':
      return (
        <g>
          <path d="M43.4 51.8 Q 48 52.8, 52.6 51.8" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
          {lower(52.4, 4)}
          {mouth === 'tongue' && <ellipse cx={52.6} cy={52.6} rx={1.4} ry={1.1} fill="#d9606a" stroke="currentColor" strokeWidth={0.6} transform="rotate(25 52.6 52.6)" />}
        </g>
      );
    case 'cigar':
      return (
        <g>
          <path d="M44 51.8 Q 47.6 52.8, 50.6 52.4" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
          {lower(52.6, 3.8)}
          <Cigar x={50.2} y={52.6} rot={14} len={13} hot={hot} />
        </g>
      );
    case 'smirk':
      return (
        <g>
          <path d="M44 52.4 Q 48.6 54, 52.8 50.6" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
          <path d="M44.6 53 Q 48.4 56.6, 51.6 53 Q 48.4 54.4, 44.6 53 Z" fill={LIP} stroke="currentColor" strokeWidth={0.9} strokeLinejoin="round" />
        </g>
      );
    default:
      // sourire bonhomme
      return (
        <g>
          <path d="M42 50.6 Q 48 55.6, 54 50.6 Q 48 51.8, 42 50.6 Z" fill={MOUTH} stroke="currentColor" strokeWidth={1.1} strokeLinejoin="round" />
          <path d="M43.4 52.2 Q 48 59, 52.6 52.2 Q 48 55, 43.4 52.2 Z" fill={LIP} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />
          <path d="M46 55.6 Q 48 56.6, 50 55.6" fill="none" stroke="#e3a090" strokeWidth={0.8} strokeLinecap="round" />
        </g>
      );
  }
}

function MouthSide({ mouth, hot }: { mouth: Expr['mouth']; hot: boolean }) {
  const lower = <path d="M84.4 43.2 C 85.6 46.4, 89.4 46.2, 89.6 43.2 Z" fill={LIP} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />;
  switch (mouth) {
    case 'o':
    case 'puff':
      return <ellipse cx={88.4} cy={42.8} rx={1.5} ry={mouth === 'o' ? 2.1 : 1.7} fill={MOUTH} stroke={LIP} strokeWidth={1.6} />;
    case 'sleep':
      return (
        <g>
          <ellipse cx={88} cy={43} rx={1.2} ry={1} fill={MOUTH} />
          {lower}
        </g>
      );
    case 'flat':
    case 'tongue':
      return (
        <g>
          {lower}
          <path d="M82.6 43 L 89.6 43.2" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
          {mouth === 'tongue' && <ellipse cx={89.6} cy={43.8} rx={1.2} ry={1} fill="#d9606a" stroke="currentColor" strokeWidth={0.6} />}
        </g>
      );
    case 'cigar':
      return (
        <g>
          {lower}
          <path d="M82.6 43 L 87 43" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
          <Cigar x={86.2} y={42.6} rot={6} len={11} hot={hot} />
        </g>
      );
    case 'smirk':
      return (
        <g>
          {lower}
          <path d="M82.4 42 Q 85 43.6, 89.6 43" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
        </g>
      );
    default:
      return (
        <g>
          <path d="M81.8 41.6 Q 84.6 45, 89.8 42.8 L 89.6 43.6 Q 85 46.6, 81.8 41.6 Z" fill={MOUTH} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />
          <path d="M84.6 44.2 C 85.8 47, 89.2 46.8, 89.6 43.8 Z" fill={LIP} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />
        </g>
      );
  }
}

/** Œil de profil : globe saillant (on le voit dépasser), paupière lourde, poche dessous. */
function EyeSide({ eyes, g }: { eyes: Expr['eyes']; g: [number, number] }) {
  const bag = <path d="M71.6 33.8 Q 75 36.4, 78.6 33.6" fill="none" stroke={SKIN_DARK} strokeWidth={1.2} strokeLinecap="round" />;
  if (eyes === 'closed')
    return (
      <g>
        <path d="M71.4 30.6 Q 75 33.6, 79 30.4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
        {bag}
      </g>
    );
  if (eyes === 'happy')
    return (
      <g>
        <path d="M71.4 32 Q 75 27, 79 31.6" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
        {bag}
      </g>
    );
  return (
    <g>
      <path d="M72 30.6 C 72 27.4, 79.6 27, 80 30.6 C 79.6 33.6, 72 34, 72 30.6 Z" fill={EYE_W} stroke="currentColor" strokeWidth={1.2} />
      <circle cx={77.4 + g[0] * 0.6} cy={31 + g[1]} r={2.3} fill="#3b2a1c" />
      <circle cx={78.1 + g[0] * 0.6} cy={30.2 + g[1]} r={0.65} fill={EYE_W} />
      {eyes === 'lidded' ? (
        <path d="M71.6 30.8 C 72 26.6, 80 26.4, 80.4 30.8 Z" fill={SKIN} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
      ) : (
        <g>
          <path d="M71.8 30.4 C 72.2 26.4, 79.8 26, 80.2 30 Q 76 28.6, 71.8 30.4 Z" fill={SKIN} />
          <path d="M71.6 30.4 Q 76 28.6, 80.6 30" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
          <path d="M71.2 29.4 C 72.4 25.6, 79 25.2, 80.8 28.8" fill="none" stroke={SKIN_DARK} strokeWidth={1.1} strokeLinecap="round" />
        </g>
      )}
      {bag}
    </g>
  );
}

function face({ view, expr }: DrawArgs & { expr: Expr }): ReactNode {
  const g = clampG(expr.gaze);
  const up = expr.browUp;
  const cigar = expr.mouth === 'cigar';
  if (view === 'side') {
    return (
      <g>
        <EyeSide eyes={expr.eyes} g={g} />
        <Brow d={up ? 'M70.4 22.2 Q75.4 17.4 81 20.8' : 'M70.4 23.6 Q75.6 20.4 81.2 22.8'} />
        <MouthSide mouth={expr.mouth} hot={expr.hot} />
        {/* nez camus : court, rond, retroussé */}
        <path d="M87.6 28.6 C 89.6 30.4, 92.6 31.4, 95.4 33.8 C 97.6 35.8, 96.6 40.2, 93.2 40.4 C 91.4 40.6, 89.8 40.2, 88.6 39.4" fill={SKIN} stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" />
        <path d="M90 35.8 Q 88.4 38.2, 90.8 39.6" fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" />
        <ellipse cx={91.8} cy={39} rx={1.2} ry={0.7} fill="currentColor" opacity={0.75} />
        <ellipse cx={94} cy={35.2} rx={1.3} ry={0.8} fill="#fff8ee" opacity={0.7} />
        <path d="M90 40.2 C 86.5 39.2, 81.6 39.4, 79.6 42.4 C 82.6 41.4, 85.6 41.2, 89.2 41.2 Z" fill={HAIR} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />
        <ellipse cx={71} cy={40} rx={3} ry={1.6} fill="#e8795f" opacity={0.28} />
      </g>
    );
  }
  return (
    <g>
      <ellipse cx={28.6} cy={51} rx={3.4} ry={1.8} fill="#e8795f" opacity={0.28} />
      <ellipse cx={67.4} cy={51} rx={3.4} ry={1.8} fill="#e8795f" opacity={0.28} />
      <EyeFront x={35.4} y={42} eyes={expr.eyes} g={g} flip={false} />
      <EyeFront x={60.6} y={42} eyes={expr.eyes} g={g} flip />
      <Brow d={up ? 'M29 33 Q35.6 26 42.4 31' : 'M28.6 34.6 Q34.6 29.2 42 31.6'} />
      <Brow d={up ? 'M54 34.8 Q60.6 33.6 67 35.6' : 'M54 31.6 Q61.4 29.2 67.4 34.6'} />
      <MouthFront mouth={expr.mouth} hot={expr.hot} />
      {/* nez camus vu de face : large boule retroussée, narines bien visibles */}
      <path d="M46.2 38.6 Q 45.6 41.6, 44.4 43.4 M49.8 38.6 Q 50.4 41.6, 51.6 43.4" fill="none" stroke={SKIN_DARK} strokeWidth={1.1} strokeLinecap="round" />
      <path d="M41.4 47.4 C 40.6 44.6, 43.4 43, 45.4 44 C 46.4 42, 49.6 42, 50.6 44 C 52.6 43, 55.4 44.6, 54.6 47.4 C 54 49.8, 51 50.4, 48 49.8 C 45 50.4, 42 49.8, 41.4 47.4 Z" fill={SKIN} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      <ellipse cx={45.8} cy={48} rx={1.4} ry={0.85} fill="currentColor" opacity={0.8} />
      <ellipse cx={50.2} cy={48} rx={1.4} ry={0.85} fill="currentColor" opacity={0.8} />
      <ellipse cx={47} cy={45.2} rx={1.5} ry={0.8} fill="#fff8ee" opacity={0.75} />
      <path d="M41.4 47.6 Q 42.6 46.4, 43.6 47.8 M54.6 47.6 Q 53.4 46.4, 52.4 47.8" fill="none" stroke="currentColor" strokeWidth={0.9} strokeLinecap="round" />
      {/* moustache : deux mèches qui encadrent la bouche */}
      <path d="M46.6 49.6 C 44 49, 40.6 49.4, 38.2 53.4 C 40.6 51.6, 43 50.8, 45.6 50.6 Z" fill={HAIR} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />
      {!cigar && <path d="M49.4 49.6 C 52 49, 55.4 49.4, 57.8 53.4 C 55.4 51.6, 53 50.8, 50.4 50.6 Z" fill={HAIR} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />}
    </g>
  );
}

const fold = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' as const, opacity: 0.5 };

function body({ view, seated, pose }: DrawArgs): ReactNode {
  // en l'air (saut), la tunique remonte pour laisser voir les jambes repliées
  const jump = pose === 'jump';
  const ink = { stroke: 'currentColor', strokeWidth: 2.1, strokeLinejoin: 'round' as const };
  if (view === 'side') {
    const neck = <path d="M49 31 C 49.6 36, 48.6 40, 48 45 L 57.6 45 C 57.8 40, 58.6 36, 60 31 Z" fill={SKIN} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />;
    const hem = jump ? 80 : 88;
    if (seated) {
      return (
        <g>
          {neck}
          {/* chiton : torse, puis le giron posé sur les cuisses */}
          <path d="M44 41.5 C 51 39.5, 58.5 41.5, 60.5 47.5 C 62 53, 59 56, 60 58 C 64 60, 68 62, 68.5 66 L 68 71.5 L 40.5 71.5 C 39.5 64, 40 47, 44 41.5 Z" fill={CHITON} {...ink} />
          {/* himation : sur l'épaule, puis enroulé sur le giron */}
          <path d="M43.6 41.7 C 49 40, 54.5 41, 57 44.5 C 56 51, 56.5 56, 59.5 58.5 C 64 60.5, 67.5 62.5, 68.2 66 L 67.6 71.5 L 40.5 71.5 C 39.6 63, 40 47, 43.6 41.7 Z" fill={HIMATION} {...ink} />
          <path d="M56.4 45 C 55.4 51, 56 56.4, 59.6 58.6" {...fold} />
          <path d="M45 60 Q 54 62, 66 65" {...fold} />
          <path d="M44 66 Q 54 67.4, 65 69" {...fold} />
        </g>
      );
    }
    return (
      <g>
        {neck}
        <path d={`M44 41.5 C 51 39.5, 58.5 41.5, 60.5 47.5 C 62 53, 60 57, 60.5 63 L 62 ${hem} Q 51 ${hem + 2.6}, 40 ${hem} L 41.4 64 C 40 56, 40 47, 44 41.5 Z`} fill={CHITON} {...ink} />
        <path d={`M43.6 41.7 C 49 40, 54.5 41, 57 44.5 C 56 51, 57 57, 60.6 61.5 L 61.6 ${hem - 2.6} Q 51 ${hem - 0.2}, 40.2 ${hem - 2.6} L 41.5 64 C 40 56, 40 47, 43.6 41.7 Z`} fill={HIMATION} {...ink} />
        <path d="M56.4 45 C 55.4 51, 56.6 57, 60 61.6" {...fold} />
        <path d={`M46 47 C 45 56, 45.5 ${hem - 18}, 45 ${hem - 4}`} {...fold} />
        <path d={`M53 62 C 52.5 70, 54 ${hem - 10}, 53.5 ${hem - 2}`} {...fold} />
      </g>
    );
  }
  const back = view === 'back';
  // De dos, l'himation passe sur l'épaule gauche, donc à gauche à l'écran.
  const flipX = back ? 'translate(98 0) scale(-1 1)' : undefined;
  const neck = <path d="M43.5 36 L 43.5 45 L 54.5 45 L 54.5 36 Z" fill={SKIN} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />;
  const hem = seated ? 77 : jump ? 80 : 88;
  return (
    <g>
      {neck}
      <path
        d={
          seated
            ? `M38 43.5 Q 49 41, 60 43.5 C 63.8 44.6, 64.6 48.6, 63.4 52 L 61 62 C 64 66, 66 70, 66.4 ${hem} Q 49 ${hem + 3}, 31.6 ${hem} C 32 70, 34 66, 37 62 L 34.6 52 C 33.4 48.6, 34.2 44.6, 38 43.5 Z`
            : `M38 43.5 Q 49 41, 60 43.5 C 63.8 44.6, 64.6 48.6, 63.4 52 L 60.4 64 L 64.6 ${hem} Q 49 ${hem + 3}, 33.4 ${hem} L 37.6 64 L 34.6 52 C 33.4 48.6, 34.2 44.6, 38 43.5 Z`
        }
        fill={CHITON}
        {...ink}
      />
      <g transform={flipX}>
        {/* encolure du chiton (côté découvert) */}
        {!back && <path d="M41 44 Q 45 47.5, 49 46" fill="none" stroke={CHITON_SHADE} strokeWidth={1.2} strokeLinecap="round" />}
        <path
          d={
            seated
              ? `M51 43 C 56 42, 62.6 43.4, 64.2 48.4 C 64.6 52, 62.5 58, 62 62 C 65 66, 66.6 70, 66.6 ${hem - 2} Q 49 ${hem + 1}, 32.2 ${hem - 2} C 32.6 71, 34.6 67, 37.4 64.4 C 42 58, 47 51, 51 43 Z`
              : `M51 43 C 56 42, 62.6 43.4, 64.2 48.4 C 64.6 52, 62.5 58, 61.2 64 L 65 ${hem - 2.6} Q 49 ${hem + 0.4}, 33 ${hem - 2.6} L 36.2 70 C 41 61, 46.5 52, 51 43 Z`
          }
          fill={HIMATION}
          {...ink}
        />
        <path d="M55.6 46 C 51.6 54, 46 61, 40.4 68" {...fold} />
        <path d="M60.4 50.6 C 57 59, 52 66, 46.4 72" {...fold} />
        {seated ? (
          <path d="M38 73 Q 49 75, 61 73" {...fold} />
        ) : (
          <g>
            <path d="M55.6 70 C 56.4 75, 56.6 80, 57.6 84.6" {...fold} />
            <path d="M47.4 74 C 47 78, 46.4 82, 45.6 85.4" {...fold} />
          </g>
        )}
      </g>
      {/* ourlet du chiton qui dépasse */}
      <path d={seated ? '' : `M35.4 ${hem - 0.2} Q 49 ${hem + 2.4}, 62.8 ${hem - 0.2}`} stroke={CHITON_SHADE} strokeWidth={1} fill="none" opacity={0.8} />
    </g>
  );
}

export const socrate: CharacterDef = {
  id: 'socrate',
  name: 'Socrate',
  grows: 'sa barbe',
  skin: SKIN,
  limbs: { arm: SKIN, leg: SKIN, shoe: '#8a5a36' },
  body,
  head,
  face,
};
