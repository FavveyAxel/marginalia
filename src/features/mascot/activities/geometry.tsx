// Activité « geometry » (Platon) : debout au bord de l'encadré, une baguette à la main, il trace des
// figures dans le sable, à côté de ses pieds : un triangle, puis un cercle, puis le carré et sa
// diagonale (le Ménon). Chaque figure apparaît trait par trait, la pointe de la baguette suit le tracé ;
// une fois finie, il la contemple, satisfait, puis l'efface d'un revers et recommence.
// Cycle de 30 images (3 figures × 10) à 3 images/s.
import type { ActivityDef, Limb, PoseDef, PropArgs, Pt, Rig } from './types';

const INK = '#231b11';
const STICK = '#7a5230';
const SAND = '#d9c79f';

const PER = 10;
const CYCLE = 3 * PER;
/** Images de tracé dans chaque figure (puis contemplation, puis effacement à la dernière). */
const DRAW = 6;

// Figures tracées « à plat » au sol : vues de face, donc écrasées en hauteur (y ≈ 120 à 128).
const TRI: Pt[] = [
  [71, 128],
  [97, 128],
  [85, 117.5],
  [71, 128],
];
const CIRCLE: Pt[] = Array.from({ length: 29 }, (_, i) => {
  const a = Math.PI / 2 + (i / 28) * Math.PI * 2;
  return [84 + 13 * Math.cos(a), 123.6 + 5.4 * Math.sin(a)] as Pt;
});
const SQUARE: Pt[] = [
  [73, 128],
  [95, 128],
  [90, 118.5],
  [78, 118.5],
  [73, 128],
  [90, 118.5], // la diagonale, tracée d'un seul geste à la suite
];
const FIGS = [TRI, CIRCLE, SQUARE];

/** Le début d'une ligne brisée (fraction `t` de sa longueur) et le point atteint. */
function partial(pts: Pt[], t: number): { d: string; tip: Pt } {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let left = Math.max(0, Math.min(1, t)) * seg.reduce((a, b) => a + b, 0);
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  let tip = pts[0];
  for (let i = 0; i < seg.length; i++) {
    if (left <= 0) break;
    const k = Math.min(1, left / seg[i]);
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    tip = [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
    d += ` L${tip[0].toFixed(2)} ${tip[1].toFixed(2)}`;
    left -= seg[i];
  }
  return { d, tip };
}

type St = { fig: number; t: number; tip: Pt; phase: 'draw' | 'admire' | 'wipe' };
function state(f: number): St {
  const c = f % CYCLE;
  const fig = Math.floor(c / PER);
  const i = c % PER;
  if (i < DRAW) {
    const t = (i + 1) / DRAW;
    return { fig, t, tip: partial(FIGS[fig], t).tip, phase: 'draw' };
  }
  if (i < PER - 1) return { fig, t: 1, tip: [68.5, 121.5], phase: 'admire' };
  return { fig, t: 1, tip: [88, 125.5], phase: 'wipe' };
}

const LEGS: [Limb, Limb] = [
  { a: [42, 64], b: [41, 94], c: [40, 121] },
  { a: [57, 64], b: [58, 94], c: [59, 121] },
];
const HIP: Limb = { a: [21, 54], b: [22, 62], c: [36, 71] };

/** Penché : le corps descend un peu ; la main est placée au-dessus de la pointe de la baguette. */
const liftOf = (s: St) => (s.phase === 'admire' ? 0.4 : 1.6);
function handOf(s: St): Pt {
  const lift = liftOf(s);
  const [tx, ty] = s.tip;
  return [63 + (tx - 63) * 0.4, 84 + (ty - 124) * 0.5 - lift];
}

function rig(f: number): Rig {
  const s = state(f);
  const h = handOf(s);
  return {
    arms: [HIP, { a: [78, 54], b: [74 + (h[0] - 70) * 0.3, 66], c: h }],
    legs: LEGS,
    lift: liftOf(s),
    gaze: s.phase === 'admire' ? [1.6, 1.6] : [1.2 + (s.tip[0] - 84) * 0.06, 2.3],
    feet: 'stand',
  };
}

/** La baguette : de la main à la pointe posée au sol (dans le repère du corps, décalé de `lift`). */
function mid({ frame, rig: r }: PropArgs) {
  const s = state(frame);
  const [hx, hy] = r.arms[1].c;
  const tx = s.tip[0];
  const ty = s.tip[1] - r.lift;
  const len = Math.hypot(tx - hx, ty - hy);
  const ux = (tx - hx) / len;
  const uy = (ty - hy) / len;
  const top: Pt = [hx - ux * 5, hy - uy * 5];
  return (
    <g strokeLinecap="round">
      <path d={`M${top[0]} ${top[1]} L${tx} ${ty}`} stroke={INK} strokeWidth={2.3} />
      <path d={`M${top[0]} ${top[1]} L${tx} ${ty}`} stroke={STICK} strokeWidth={1} />
    </g>
  );
}

/** Les figures dans le sable, sur le bord de l'encadré. */
function back({ frame }: PropArgs) {
  const s = state(frame);
  const fig = FIGS[s.fig];
  const { d } = partial(fig, s.t);
  const wipe = s.phase === 'wipe';
  return (
    <g strokeLinecap="round" strokeLinejoin="round" fill="none">
      <ellipse cx={84} cy={124.4} rx={17} ry={7} fill={SAND} opacity={0.32} />
      <g opacity={wipe ? 0.28 : 1}>
        <path d={d} stroke="#fffaf0" strokeWidth={2.6} opacity={0.5} />
        <path d={d} stroke={INK} strokeWidth={1.4} />
      </g>
      {/* contemplation : petits traits d'éclat autour de la figure achevée */}
      {s.phase === 'admire' && frame % PER === DRAW + 1 && (
        <g stroke={INK} strokeWidth={0.9} opacity={0.6}>
          <path d="M70 116.5 L68.5 114.5 M84 115 L84 112.6 M98 116.5 L99.5 114.5" />
        </g>
      )}
      {wipe && <path d="M72 125 Q78 122.5 84 125.5 T96 124.5" stroke={SAND} strokeWidth={3.2} opacity={0.9} />}
    </g>
  );
}

export const pose: PoseDef = {
  seated: false,
  fps: 3,
  rig,
  mid,
  back,
  eyes: (f) => (state(f).phase === 'admire' && (f % PER) % 2 === 1 ? 'happy' : 'open'),
  mouth: (f) => {
    const s = state(f);
    return s.phase === 'admire' ? 'smile' : s.phase === 'wipe' ? 'smirk' : 'flat';
  },
};

export const activity: ActivityDef = {
  id: 'geometry',
  w: 2,
  chars: ['platon'],
  acts: () => [
    { pose: 'geometry', ms: 4000, view: 'front' },
    { pose: 'geometry', ms: 7000, view: 'front', say: 'act:geometry' },
    { pose: 'geometry', ms: 5000, view: 'front' },
  ],
  lines: {
    platon: [
      'Que nul n’entre ici s’il n’est géomètre.',
      'Ce triangle est imparfait… le vrai est ailleurs.',
      'Le double de ce carré ? Suis la diagonale.',
      'Apprendre, c’est se ressouvenir.',
      'Le sable s’efface, l’Idée demeure.',
      'Un cercle parfait, je n’en ai jamais vu. Et toi ?',
    ],
  },
};
