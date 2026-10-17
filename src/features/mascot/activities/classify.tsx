// Activité « classify » (Aristote) : assis au bord de l'encadré, il range des fiches. Il prend une
// fiche sur la pile posée sur ses genoux, la lit (regard baissé, bouche neutre), puis la pose sur l'une
// des trois piles alignées sur le bord, à sa gauche et à sa droite ; les piles montent, un petit
// hochement de tête approuve le classement. Cycle de 32 images (8 fiches × 4) à 3 images/s.
import type { ActivityDef, Limb, PoseDef, PropArgs, Pt, Rig } from './types';

const INK = '#231b11';
/** Couleurs des fiches, une par pile (genres, espèces, catégories…). */
const CARD = ['#f4ead3', '#e9dcc0', '#f1e2c8'];
const TAB = ['#c9553a', '#5b7a4a', '#3f6a8a'];

const STEP = 4;
const ORDER = [1, 0, 2, 0, 1, 2, 0, 1];
const CYCLE = ORDER.length * STEP;
const START = [2, 1, 2];
/** Piles sur le bord (assise à y = 70) : centre x ; la pile 0 est à gauche, 1 et 2 à droite. */
const PILE_X = [11, 86, 99];
const CARD_H = 2.4;

/** Hauteur des piles à l'image `f` (fiches déjà posées). */
function piles(f: number): number[] {
  const c = f % CYCLE;
  const n = [...START];
  const done = Math.floor(c / STEP) + (c % STEP === 3 ? 1 : 0);
  for (let k = 0; k < done; k++) n[ORDER[k]]++;
  return n;
}
const sideOf = (pile: number) => (pile === 0 ? 0 : 1);
const LAP: [Pt, Pt] = [
  [44.5, 66.5],
  [54.5, 66.5],
];
const LOOK: [Pt, Pt] = [
  [40, 57],
  [58, 57],
];

const LEGS = (k: number): [Limb, Limb] => [
  { a: [42, 64], b: [40, 74], c: k ? [36, 96] : [38, 99] },
  { a: [57, 64], b: [59, 74], c: k ? [61, 99] : [64, 96] },
];
const REST: [Limb, Limb] = [
  { a: [21, 54], b: [22, 66], c: [37, 67] },
  { a: [78, 54], b: [77, 66], c: [61, 67] },
];

type St = { pile: number; side: 0 | 1; ph: number; hand: Pt };
function state(f: number): St {
  const c = f % CYCLE;
  const pile = ORDER[Math.floor(c / STEP)];
  const side = sideOf(pile) as 0 | 1;
  const ph = c % STEP;
  const n = piles(f)[pile];
  const hand: Pt = ph === 0 ? LAP[side] : ph === 1 ? LOOK[side] : ph === 2 ? [PILE_X[pile] + (side ? -1 : 1), 70 - n * CARD_H - 3] : [PILE_X[pile] + (side ? -4 : 4), 70 - n * CARD_H - 5];
  return { pile, side, ph, hand };
}

function rig(f: number): Rig {
  const s = state(f);
  const arms: [Limb, Limb] = [REST[0], REST[1]];
  const reach = s.ph >= 2;
  arms[s.side] = s.side
    ? { a: [78, 54], b: reach ? [76, 56] : [76, 64], c: s.hand }
    : { a: [21, 54], b: reach ? [22, 56] : [22, 64], c: s.hand };
  return {
    arms,
    legs: LEGS(Math.floor(f / 6) % 2),
    lift: s.ph === 3 && f % 8 === 7 ? 0.9 : 0,
    gaze: s.ph === 1 ? [s.side ? 0.8 : -0.8, 2.2] : s.ph === 2 ? [s.side ? 2 : -2, 1.6] : [0, 2.2],
    feet: 'hang',
  };
}

/** Une fiche vue de chant, posée sur une pile. */
function Flat({ x, y, i, pile }: { x: number; y: number; i: number; pile: number }) {
  return (
    <g>
      <rect x={x - 6 + (i % 2 ? 0.4 : -0.3)} y={y} width={12} height={CARD_H} rx={0.4} fill={CARD[pile]} stroke={INK} strokeWidth={0.7} />
      <rect x={x + 3 + (i % 2 ? 0.4 : -0.3)} y={y + 0.25} width={1.3} height={CARD_H - 0.5} fill={TAB[pile]} />
    </g>
  );
}

/** Les trois piles sur le bord, derrière lui. */
function back({ frame }: PropArgs) {
  const n = piles(frame);
  return (
    <g strokeLinejoin="round">
      {n.map((k, p) => (
        <g key={p}>
          {Array.from({ length: k }, (_, i) => (
            <Flat key={i} x={PILE_X[p]} y={70 - (i + 1) * CARD_H} i={i} pile={p} />
          ))}
        </g>
      ))}
    </g>
  );
}

/** La pile sur ses genoux, et la fiche tenue (de face quand il la lit, à plat quand il la pose). */
function mid({ frame, rig: r }: PropArgs) {
  const s = state(frame);
  const c = frame % CYCLE;
  const left = Math.max(1, 8 - Math.floor(c / STEP));
  const [hx, hy] = r.arms[s.side].c;
  const lap = (
    <g key="lap">
      {Array.from({ length: Math.min(4, left) }, (_, i) => (
        <rect key={i} x={43.5 + (i % 2) * 0.5} y={67.5 - i * 1.5} width={12} height={1.8} rx={0.4} fill={CARD[i % 3]} stroke={INK} strokeWidth={0.7} />
      ))}
    </g>
  );
  let held = null;
  if (s.ph === 1)
    held = (
      <g key="card" transform={`translate(${hx + (s.side ? -2 : 2)} ${hy - 4}) rotate(${s.side ? -8 : 8})`}>
        <rect x={-4} y={-5} width={8} height={10} rx={0.6} fill={CARD[s.pile]} stroke={INK} strokeWidth={0.9} />
        <rect x={1.6} y={-5} width={2.4} height={2} fill={TAB[s.pile]} stroke={INK} strokeWidth={0.5} />
        <path d="M-2.6 -1.4 L2.4 -1.4 M-2.6 0.6 L2.6 0.6 M-2.6 2.6 L1 2.6" stroke={INK} strokeWidth={0.5} opacity={0.6} />
      </g>
    );
  else if (s.ph === 0 || s.ph === 2) held = <Flat key="card" x={hx} y={hy + (s.ph === 2 ? 1.2 : -0.6)} i={0} pile={s.pile} />;
  return (
    <g strokeLinejoin="round">
      {lap}
      {held}
    </g>
  );
}

export const pose: PoseDef = {
  seated: true,
  fps: 3,
  rig,
  back,
  mid,
  eyes: (f) => (state(f).ph === 3 && f % 8 === 7 ? 'happy' : 'open'),
  mouth: (f) => (state(f).ph === 3 ? 'smile' : 'flat'),
};

export const activity: ActivityDef = {
  id: 'classify',
  w: 2,
  chars: ['aristote'],
  acts: () => [
    { pose: 'classify', ms: 4000, view: 'front' },
    { pose: 'classify', ms: 7000, view: 'front', say: 'act:classify' },
    { pose: 'classify', ms: 5000, view: 'front' },
  ],
  lines: {
    aristote: [
      'Genre, espèce, différence : chaque chose à sa place.',
      'Ceci est une substance. Ceci, un accident.',
      'Le tout est plus que la somme de ses fiches.',
      'Avant de juger, classons.',
      'La vertu se tient au milieu… la pile aussi.',
      'Dix catégories, pas une de plus.',
    ],
  },
};
