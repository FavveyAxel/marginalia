// Activité « plane » : debout, il plie une feuille en avion de papier (feuille → coins rabattus → pliée
// en deux → avion), vise, lance ; l'avion plane vers la droite en ondulant, loin hors du sprite, rapetisse
// et s'efface ; il le suit des yeux, ravi. Cycle de 24 images.
import type { ActivityDef, EyesKind, Limb, MouthKind, PoseDef, Pt, PropArgs, Rig } from './types';

const INK = '#231b11';
const PAPER = '#fbf6ea';
const PAPER_SHADE = '#e6dcc6';
const CYCLE = 24;
/** Première et dernière image de vol libre. */
const FLY0 = 8;
const FLY1 = 19;

const stand: [Limb, Limb] = [
  { a: [42, 64], b: [41, 94], c: [40, 121] },
  { a: [57, 64], b: [58, 94], c: [59, 121] },
];
const lunge: [Limb, Limb] = [
  { a: [42, 64], b: [39, 94], c: [36, 121] },
  { a: [57, 64], b: [62, 93], c: [66, 121] },
];
const rest = (side: 0 | 1): Limb => (side ? { a: [78, 54], b: [84, 72], c: [84, 89] } : { a: [21, 54], b: [15, 72], c: [15, 89] });
const hip = (side: 0 | 1): Limb => (side ? { a: [78, 54], b: [96, 64], c: [84, 76] } : { a: [21, 54], b: [3, 64], c: [15, 76] });

/** Position de l'avion en vol (image f du cycle, de FLY0 - 1 à FLY1). */
function flight(c: number): { p: Pt; s: number; o: number; rot: number } {
  const t = c - (FLY0 - 1);
  const x = 108 + t * 13;
  const y = 42 - t * 1.2 + 12 * Math.sin(t * 0.85);
  const s = Math.max(0.45, 1 - t * 0.045);
  const o = c <= 15 ? 1 : Math.max(0, 1 - (c - 15) * 0.22);
  const rot = 9 * Math.cos(t * 0.85) - 2;
  return { p: [x, y], s, o, rot };
}

function rig(f: number): Rig {
  const c = f % CYCLE;
  let arms: [Limb, Limb];
  let legs = stand;
  let gaze: Pt = [0, 1.8];
  let lift = 0;
  if (c <= 2 || c === 23) {
    // feuille tenue devant lui, il plie
    const k = c === 2 ? 3 : 0;
    arms = [
      { a: [21, 54], b: [20, 72], c: [35 + k, 64] },
      { a: [78, 54], b: [80, 72], c: [63 - k, 64] },
    ];
    lift = c === 1 ? -0.5 : 0;
  } else if (c === 3) {
    // dernier pli : l'avion se forme entre ses mains
    arms = [
      { a: [21, 54], b: [22, 72], c: [42, 64] },
      { a: [78, 54], b: [76, 72], c: [58, 62] },
    ];
  } else if (c === 4) {
    // il l'admire
    arms = [rest(0), { a: [78, 54], b: [88, 66], c: [74, 46] }];
    gaze = [1.6, -0.6];
  } else if (c === 5 || c === 6) {
    // il vise : bras armé en arrière, au-dessus de l'épaule
    arms = [{ a: [21, 54], b: [10, 62], c: [6, 50] }, c === 5 ? { a: [78, 54], b: [100, 46], c: [95, 26] } : { a: [78, 54], b: [102, 42], c: [93, 20] }];
    gaze = [2.2, -0.4];
    legs = lunge;
    lift = c === 6 ? 0.8 : 0;
  } else if (c === 7) {
    // il lance : bras tendu vers la droite
    arms = [{ a: [21, 54], b: [12, 66], c: [10, 58] }, { a: [78, 54], b: [93, 48], c: [106, 44] }];
    gaze = [2.4, -0.2];
    legs = lunge;
    lift = -0.6;
  } else if (c <= 13) {
    // il le suit des yeux, le bras encore tendu, puis il le montre du doigt
    const fl = flight(Math.min(c, FLY1));
    const gy = Math.max(-1.6, Math.min(1.2, (fl.p[1] - 40) / 14));
    arms = [rest(0), c === 8 ? { a: [78, 54], b: [94, 58], c: [102, 60] } : { a: [78, 54], b: [92, 52], c: [100, 42] }];
    gaze = [2.6, gy];
    legs = c === 8 ? lunge : stand;
  } else {
    // mains sur les hanches, content de lui
    const fl = flight(Math.min(c, FLY1));
    arms = [hip(0), hip(1)];
    gaze = c <= FLY1 ? [2.6, Math.max(-1.6, Math.min(1.2, (fl.p[1] - 40) / 14))] : [0.6, -0.4];
    lift = c % 2 ? -0.6 : 0;
  }
  return { arms, legs, lift, gaze, feet: 'stand' };
}

/** Avion de papier vu de profil, nez vers la droite (repère local, environ 22 × 9). */
function Plane({ x, y, s, rot, o = 1 }: { x: number; y: number; s: number; rot: number; o?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`} opacity={o} strokeLinejoin="round" strokeLinecap="round">
      {/* aile éloignée */}
      <path d="M11 0 L-10 -6.5 L-6 -1 Z" fill={PAPER_SHADE} stroke={INK} strokeWidth={0.9} />
      {/* quille */}
      <path d="M11 0 L-6 -0.6 L-9 3.6 Z" fill={PAPER_SHADE} stroke={INK} strokeWidth={0.9} />
      {/* aile proche */}
      <path d="M11 0 L-11 -3 L-6 -0.6 Z" fill={PAPER} stroke={INK} strokeWidth={1} />
      <path d="M9 -0.4 L-8 -2.6" stroke={INK} strokeWidth={0.4} opacity={0.5} />
    </g>
  );
}

/** Feuille tenue à deux mains, au fil des plis (image c du cycle). */
function Sheet({ c, hl, hr }: { c: number; hl: Pt; hr: Pt }) {
  const cx = (hl[0] + hr[0]) / 2;
  const top = hl[1] - 12;
  const bot = hl[1] + 7;
  const lines = (x0: number, x1: number) => (
    <g stroke={INK} strokeWidth={0.5} opacity={0.4} strokeLinecap="round">
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M${x0} ${top + 6 + i * 2.6} L${x1 - (i === 2 ? 3 : 0)} ${top + 6 + i * 2.6}`} />
      ))}
    </g>
  );
  if (c === 0 || c === 23) {
    // feuille à plat (une page griffonnée)
    const w = c === 23 ? 0.7 : 1;
    return (
      <g transform={`translate(${cx} 0) scale(${w} 1) translate(${-cx} 0)`} strokeLinejoin="round">
        <rect x={cx - 13} y={top} width={26} height={bot - top} rx={0.6} fill={PAPER} stroke={INK} strokeWidth={1} />
        {lines(cx - 9, cx + 9)}
      </g>
    );
  }
  if (c === 1) {
    // coins du haut rabattus vers le milieu
    return (
      <g strokeLinejoin="round">
        <path d={`M${cx - 13} ${top + 12} L${cx} ${top - 1} L${cx + 13} ${top + 12} L${cx + 13} ${bot} L${cx - 13} ${bot} Z`} fill={PAPER} stroke={INK} strokeWidth={1} />
        <path d={`M${cx - 13} ${top + 12} L${cx} ${top - 1} L${cx} ${top + 12} Z M${cx + 13} ${top + 12} L${cx} ${top - 1} L${cx} ${top + 12} Z`} fill={PAPER_SHADE} stroke={INK} strokeWidth={0.8} />
        {lines(cx - 8, cx + 8)}
      </g>
    );
  }
  if (c === 2) {
    // pliée en deux : un long triangle
    return (
      <g strokeLinejoin="round">
        <path d={`M${cx} ${top - 3} L${cx + 9} ${bot} L${cx - 7} ${bot} Z`} fill={PAPER} stroke={INK} strokeWidth={1} />
        <path d={`M${cx} ${top - 2} L${cx + 1.5} ${bot} `} stroke={INK} strokeWidth={0.6} opacity={0.6} />
      </g>
    );
  }
  return null;
}

function over({ frame, rig: r }: PropArgs) {
  const c = frame % CYCLE;
  const hl = r.arms[0].c;
  const hr = r.arms[1].c;
  if (c <= 2 || c === 23) return <Sheet c={c} hl={hl} hr={hr} />;
  if (c === 3) return <Plane x={(hl[0] + hr[0]) / 2 + 1} y={hr[1] - 2} s={1.4} rot={-8} />;
  if (c >= 4 && c <= 6) return <Plane x={hr[0] + 6} y={hr[1] - 2} s={1.4} rot={c === 4 ? -6 : -14} />;
  if (c >= FLY0 - 1 && c <= FLY1) {
    const { p, s, o, rot } = flight(c);
    // petit sillage pointillé derrière lui, les premières images
    const trail = c <= FLY0 + 3 ? (
      <path d={`M${p[0] - 20 * s} ${p[1] + 1} q -8 ${c % 2 ? -3 : 3} -16 0`} fill="none" stroke={INK} strokeWidth={0.8} strokeDasharray="1.6 2.4" opacity={0.45} strokeLinecap="round" />
    ) : null;
    return (
      <g>
        {trail}
        <Plane x={p[0]} y={p[1]} s={s * 1.6} rot={rot} o={o} />
      </g>
    );
  }
  return null;
}

const eyes = (f: number): EyesKind => {
  const c = f % CYCLE;
  if (c === 4) return 'happy';
  if (c >= 14 && c <= 22) return c > FLY1 ? 'happy' : c % 3 === 2 ? 'happy' : 'open';
  return 'open';
};
const mouth = (f: number): MouthKind => {
  const c = f % CYCLE;
  if (c <= 3 || c === 23) return 'tongue';
  if (c === 5 || c === 6) return 'flat';
  if (c === 7 || c === 8) return 'o';
  return 'smile';
};

export const pose: PoseDef = { seated: false, fps: 6, rig, over, eyes, mouth };

export const activity: ActivityDef = {
  id: 'plane',
  w: 2,
  acts: () => [
    { pose: 'plane', ms: 4000, view: 'front' },
    { pose: 'plane', ms: 4000, view: 'front', say: 'act:plane' },
    { pose: 'plane', ms: 4000, view: 'front' },
  ],
  lines: {
    all: ['Une page de moins, une idée en vol.', 'Les idées, ça plane.', 'Vise haut, pense loin.', 'Il reviendra… ou pas.', 'Mon brouillon prend son envol.'],
  },
};
