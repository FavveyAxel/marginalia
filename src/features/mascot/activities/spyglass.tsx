// Activité « spyglass » : debout, l'air sérieux de l'explorateur. Il scrute l'horizon à la longue-vue
// (en laiton, collée à l'œil droit, poing sur la hanche, balayage lent), puis se penche et inspecte le
// sol à la loupe : à travers la lentille, son œil paraît énorme (et une fourmi passe à ses pieds).
// Cycle de 24 images (3 par seconde) : 0–11 longue-vue, 12–23 loupe.
import type { ActivityDef, EyesKind, MouthKind, PoseDef, Pt, PropArgs, Rig } from './types';

const INK = '#231b11';
const BRASS = '#c9973e';
const BRASS_DK = '#8a5a2e';
const BRASS_HI = '#f0d58a';
const CYCLE = 24;
const phase = (f: number) => f % CYCLE;
const loupe = (f: number) => phase(f) >= 12;
/** Œil droit (repère du visage) : la longue-vue et la loupe s'y placent. */
const EYE: Pt = [59, 43];
/** Balayage lent de la longue-vue (angle en degrés, vers le haut à droite). */
const SCAN = [-24, -24, -18, -12, -8, -8, -8, -12, -18, -22, -24, -24];
const scanAngle = (f: number) => SCAN[phase(f) % 12];

function rig(f: number): Rig {
  const c = phase(f);
  if (!loupe(f)) {
    const a = (scanAngle(f) * Math.PI) / 180;
    const hand: Pt = [EYE[0] + 9 * Math.cos(a), EYE[1] + 9 * Math.sin(a)];
    return {
      arms: [
        // poing sur la hanche
        { a: [21, 54], b: [7, 63], c: [29, 69] },
        { a: [78, 54], b: [90, 60], c: hand },
      ],
      legs: [
        { a: [42, 64], b: [40, 94], c: [37, 121] },
        { a: [57, 64], b: [60, 94], c: [62, 121] },
      ],
      lift: c % 6 < 3 ? 0 : -0.6,
      gaze: [2.2, -0.8],
      feet: 'stand',
      faceHand: 1,
    };
  }
  // penché, une main sur le genou, la loupe devant l'œil
  return {
    arms: [
      { a: [21, 54], b: [13, 76], c: [35, 90] },
      { a: [78, 54], b: [90, 68], c: [67.5, 56] },
    ],
    legs: [
      { a: [42, 64], b: [35, 93], c: [39, 121] },
      { a: [57, 64], b: [64, 93], c: [60, 121] },
    ],
    lift: 2.4,
    gaze: [1.2, 2.6],
    feet: 'stand',
    faceHand: 1,
  };
}

/** Échelle du visage (cerveau grossi ou tête de philosophe réduite). */
function faceScale(onFace: PropArgs['onFace']): number {
  const a = onFace([0, 0]);
  const b = onFace([1, 0]);
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Longue-vue en laiton à trois tirages, dessinée le long de l'axe x (oculaire en 0). */
function Spyglass({ at, deg }: { at: Pt; deg: number }) {
  const seg = (x0: number, x1: number, hw: number, fill: string) => <rect x={x0} y={-hw} width={x1 - x0} height={hw * 2} rx={0.5} fill={fill} stroke={INK} strokeWidth={1} />;
  return (
    <g transform={`translate(${at[0]} ${at[1]}) rotate(${deg}) scale(1.15)`} strokeLinejoin="round">
      {seg(24, 26, 3.4, BRASS)}
      {seg(15, 24.4, 2.9, BRASS)}
      <rect x={16.6} y={-2.9} width={5.4} height={5.8} fill="#6b4325" stroke={INK} strokeWidth={0.7} />
      <path d="M17.6 -2.9 L18.6 2.9 M19.4 -2.9 L20.4 2.9 M21.2 -2.9 L22 2.9" stroke="#3a2614" strokeWidth={0.4} opacity={0.7} />
      {seg(8.4, 15.2, 2.3, BRASS)}
      {seg(2.6, 8.6, 1.8, BRASS)}
      {seg(0, 2.8, 1.4, BRASS_DK)}
      <path d="M3.2 -1 L8 -1 M9 -1.5 L14.6 -1.5 M23 -2.3 L25.6 -2.6" stroke={BRASS_HI} strokeWidth={0.6} opacity={0.9} strokeLinecap="round" />
      <ellipse cx={26} cy={0} rx={0.9} ry={3} fill="#3c4a52" stroke={INK} strokeWidth={0.7} />
      <path d="M26.1 -1.8 L26.1 -0.6" stroke="#dff0f4" strokeWidth={0.5} strokeLinecap="round" />
    </g>
  );
}

/** Petite fourmi qui trottine au sol (repère réel). */
function Ant({ x, y, step }: { x: number; y: number; step: number }) {
  const s = step % 2 ? 1 : -1;
  return (
    <g fill={INK} stroke={INK} strokeLinecap="round">
      <g strokeWidth={0.45}>
        <path d={`M${x - 1} ${y - 1} L${x - 2 + s * 0.6} ${y + 0.4} M${x} ${y - 1} L${x - s * 0.6} ${y + 0.4} M${x + 1} ${y - 1} L${x + 2 + s * 0.6} ${y + 0.4}`} />
        <path d={`M${x + 2.6} ${y - 2.2} Q ${x + 3.6} ${y - 3.8} ${x + 4.4} ${y - 3.4}`} fill="none" />
      </g>
      <ellipse cx={x - 2.2} cy={y - 1.4} rx={1.4} ry={1} />
      <ellipse cx={x} cy={y - 1.2} rx={0.8} ry={0.6} />
      <ellipse cx={x + 1.6} cy={y - 1.5} rx={1} ry={0.85} />
    </g>
  );
}

export const pose: PoseDef = {
  seated: false,
  fps: 3,
  rig,
  mid: ({ frame, rig: r, onFace }) => {
    const hand = r.arms[1].c;
    if (!loupe(frame)) {
      const e = onFace(EYE);
      const deg = (Math.atan2(hand[1] - e[1], hand[0] - e[0]) * 180) / Math.PI;
      const a = (deg * Math.PI) / 180;
      return <Spyglass at={[e[0] + 1.2 * Math.cos(a), e[1] + 1.2 * Math.sin(a)]} deg={deg} />;
    }
    // manche de la loupe, de la lentille jusqu'à la main
    const s = faceScale(onFace);
    const lc = onFace([EYE[0], EYE[1] + 1]);
    const rr = 8 * s;
    const d = Math.hypot(hand[0] - lc[0], hand[1] - lc[1]);
    const u: Pt = [(hand[0] - lc[0]) / d, (hand[1] - lc[1]) / d];
    const p0: Pt = [lc[0] + u[0] * rr, lc[1] + u[1] * rr];
    const p1: Pt = [hand[0] + u[0] * 2.6, hand[1] + u[1] * 2.6];
    return (
      <g strokeLinecap="round">
        <path d={`M${p0[0]} ${p0[1]} L${p1[0]} ${p1[1]}`} stroke={INK} strokeWidth={3.6} />
        <path d={`M${p0[0]} ${p0[1]} L${p1[0]} ${p1[1]}`} stroke="#6b4325" strokeWidth={2} />
        <path d={`M${p0[0] + u[0] * 0.8} ${p0[1] + u[1] * 0.8} L${p0[0] + u[0] * 2.2} ${p0[1] + u[1] * 2.2}`} stroke={BRASS} strokeWidth={2.6} />
      </g>
    );
  },
  over: ({ frame, onFace }) => {
    if (!loupe(frame)) return null;
    const c = phase(frame);
    const s = faceScale(onFace);
    const [x, y] = onFace([EYE[0], EYE[1] + 1]);
    const rr = 8 * s;
    // l'œil grossi regarde la fourmi, en bas à droite
    const look: Pt = [0.18 * rr + (c % 4 < 2 ? 0 : 0.06 * rr), 0.3 * rr];
    return (
      <g>
        <Ant x={66 + (c - 12) * 1.1} y={124} step={c} />
        <circle cx={x} cy={y} r={rr} fill="#eaf4f2" />
        <ellipse cx={x} cy={y + 0.04 * rr} rx={rr * 0.8} ry={rr * 0.86} fill="#fffaf0" stroke={INK} strokeWidth={1.1} />
        <circle cx={x + look[0]} cy={y + look[1]} r={rr * 0.42} fill="#6b4a35" stroke={INK} strokeWidth={0.8} />
        <circle cx={x + look[0]} cy={y + look[1]} r={rr * 0.22} fill={INK} />
        <circle cx={x + look[0] - rr * 0.14} cy={y + look[1] - rr * 0.16} r={rr * 0.1} fill="#fffaf0" />
        {/* reflet du verre et monture en laiton */}
        <circle cx={x} cy={y} r={rr} fill="#cfe6ea" opacity={0.18} />
        <path d={`M${x - rr * 0.62} ${y - rr * 0.18} A ${rr * 0.66} ${rr * 0.66} 0 0 1 ${x - rr * 0.1} ${y - rr * 0.66}`} fill="none" stroke="#ffffff" strokeWidth={1} opacity={0.8} strokeLinecap="round" />
        <circle cx={x} cy={y} r={rr} fill="none" stroke={INK} strokeWidth={3} />
        <circle cx={x} cy={y} r={rr} fill="none" stroke={BRASS} strokeWidth={1.4} />
        <circle cx={x} cy={y} r={rr} fill="none" stroke={BRASS_HI} strokeWidth={0.4} strokeDasharray="2 3" opacity={0.8} />
      </g>
    );
  },
  eyes: (): EyesKind => 'open',
  mouth: (f): MouthKind => {
    const c = phase(f);
    if (!loupe(f)) return 'flat';
    return c >= 15 && c <= 19 ? 'o' : c >= 21 ? 'smirk' : 'flat';
  },
};

const r = Math.random;
const sec = (a: number, b: number) => (a + r() * (b - a)) * 1000;

export const activity: ActivityDef = {
  id: 'spyglass',
  w: 2,
  acts: () => [
    { pose: 'spyglass', ms: sec(4, 6), view: 'front', say: 'act:spyglass' },
    { pose: 'spyglass', ms: sec(3.5, 5), view: 'front' },
  ],
  lines: {
    all: [
      'Terre en vue ! Ah non, c’est une marge.',
      'Voir loin, puis voir près : toute la méthode.',
      'Rien n’échappe à l’œil du lecteur attentif.',
      'Une fourmi. Elle aussi cherche un sens.',
      'L’horizon recule à mesure qu’on avance.',
    ],
    aristote: ['Observer d’abord, classer ensuite.'],
    platon: ['Ce que je vois n’est qu’une ombre… agrandie.'],
  },
};
