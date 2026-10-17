// Activité « juggle » : debout, il jongle avec trois petits livres fermés (cascade au-dessus de la tête,
// mains qui alternent). Cycle de 32 images : 24 de belle jonglerie, puis un raté — un livre monte trop
// haut, retombe et lui cogne la tête (étoiles, yeux fermés) — et il reprend.
import type { ActivityDef, EyesKind, MouthKind, PoseDef, Pt, PropArgs, Rig } from './types';

const INK = '#231b11';
const CYCLE = 32;
/** Images de jonglerie régulière dans le cycle (deux tours complets de 12). */
const GOOD = 24;
/** Lancer toutes les 2 images, main gauche puis droite : chaque livre repart toutes les 6 images. */
const T = 2;

// Mains levées de part et d'autre de la tête ; on lance par l'intérieur, on rattrape par l'extérieur.
const L_THROW: Pt = [14, 9];
const L_CATCH: Pt = [1, 15];
const R_THROW: Pt = [85, 9];
const R_CATCH: Pt = [98, 15];
const HANDS: Record<'L' | 'R', Pt[]> = {
  // phase 0 : lance (intérieur, un peu haut) ; 1 : redescend ; 2 : s'écarte ; 3 : rattrape (extérieur)
  L: [L_THROW, [8, 19], [2, 19], L_CATCH],
  R: [R_THROW, [91, 19], [97, 19], R_CATCH],
};
const handPhase = (f: number, side: 'L' | 'R') => (((f - (side === 'L' ? 0 : T)) % 4) + 4) % 4;

/** Trajet d'un livre lancé d'une main (intérieur) vers l'autre (extérieur), u de 0 à 1. */
function arc(from: Pt, to: Pt, u: number, h = 34): Pt {
  return [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u - 4 * h * u * (1 - u)];
}

/** Position d'un livre en jonglerie régulière à l'image f (b : 0, 1, 2). Renvoie aussi s'il est en main. */
function ballAt(f: number, b: number): { p: Pt; spin: number } {
  // livre b lancé à l'image T·b (mod 12), de la gauche si b est pair, de la droite sinon ; puis il alterne
  const t = (((f - T * b) % 12) + 12) % 12;
  const first = t < 6;
  const startL = b % 2 === 0 ? first : !first;
  const s = t % 6;
  const from = startL ? L_THROW : R_THROW;
  const to = startL ? R_CATCH : L_CATCH;
  const p = arc(from, to, s / 5);
  // en main : posé juste au-dessus de la paume
  if (s === 0 || s === 5) p[1] -= 4;
  return { p, spin: s * (startL ? 62 : -62) };
}

/** Livre fermé, vu de face : couverture colorée, tranche de pages crème, dos plus sombre. */
function ClosedBook({ x, y, rot, color, dark }: { x: number; y: number; rot: number; color: string; dark: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(1.2)`} strokeLinejoin="round">
      <rect x={-5} y={-4} width={10} height={8} rx={0.9} fill={color} stroke={INK} strokeWidth={1.1} />
      <rect x={-5} y={-4} width={2.2} height={8} rx={0.6} fill={dark} stroke={INK} strokeWidth={0.6} />
      <path d="M4.4 -3.2 L5.9 -2.6 L5.9 3.4 L4.4 3.6 Z" fill="#fbf6ea" stroke={INK} strokeWidth={0.6} />
      <path d="M-1.2 -1.4 L3 -1.4 M-1.2 0.3 L2.2 0.3" stroke="#fffaf0" strokeWidth={0.6} opacity={0.8} strokeLinecap="round" />
      <path d="M-2.2 -3.2 L3.6 -3.2" stroke="#fffaf0" strokeWidth={0.5} opacity={0.45} strokeLinecap="round" />
    </g>
  );
}

const BOOKS = [
  { color: '#c9553a', dark: '#8f3524' },
  { color: '#3f6e8c', dark: '#284a60' },
  { color: '#d9a441', dark: '#9c7121' },
];

/** Raté (images 24 à 31 du cycle) : position de chaque livre, ou « sur la tête ». */
type Slot = { p: Pt; spin: number } | 'head';
function missBalls(c: number, head: Pt): Slot[] {
  const k = c - GOOD; // 0..7
  // livre 0 (rouge) : lancé de travers, trop haut, retombe sur le crâne
  const A: Slot[] = [
    { p: L_THROW, spin: 0 },
    { p: [30, -16], spin: 120 },
    { p: [44, -28], spin: 250 },
    { p: [50, -12], spin: 340 },
    'head',
    'head',
    'head',
    { p: [head[0] + 3, head[1] - 12], spin: 30 },
  ];
  // livre 1 (bleu) : rattrapé à droite, puis gardé en main droite
  const B: Slot = k < 1 ? ballAt(c, 1) : { p: [0, 0], spin: 0 };
  // livre 2 (jaune) : vole jusqu'à la main gauche (image 27), puis gardé
  const C: Slot = k < 3 ? ballAt(c, 2) : { p: [0, 0], spin: 0 };
  return [A[k], B, C];
}

/** Mains pendant le raté. */
function missHands(k: number): [Pt, Pt] {
  if (k <= 2) return [HANDS.L[handPhase(k, 'L')], k >= 1 ? [93, 17] : HANDS.R[handPhase(k, 'R')]];
  if (k === 3) return [L_CATCH, [93, 17]];
  if (k <= 6) return [[6, 36], [93, 36]]; // sonné : les bras retombent un peu, un livre dans chaque main
  return [[8, 22], [91, 22]];
}

function handsAt(f: number): [Pt, Pt] {
  const c = f % CYCLE;
  if (c >= GOOD) return missHands(c - GOOD);
  return [HANDS.L[handPhase(c, 'L')], HANDS.R[handPhase(c, 'R')]];
}

const elbow = (h: Pt, side: 0 | 1): Pt => (side ? [Math.max(h[0], 84) + 8, h[1] + 20] : [Math.min(h[0], 16) - 8, h[1] + 20]);

function rig(f: number): Rig {
  const c = f % CYCLE;
  const [hl, hr] = handsAt(f);
  const dazed = c >= GOOD + 4 && c <= GOOD + 6;
  const bonk = c === GOOD + 4;
  return {
    arms: [
      { a: [21, 54], b: elbow(hl, 0), c: hl },
      { a: [78, 54], b: elbow(hr, 1), c: hr },
    ],
    legs: dazed
      ? [
          { a: [42, 64], b: [39, 94], c: [36, 121] },
          { a: [57, 64], b: [60, 94], c: [63, 121] },
        ]
      : [
          { a: [42, 64], b: [41, 94], c: [39, 121] },
          { a: [57, 64], b: [58, 94], c: [60, 121] },
        ],
    // petit rebond à chaque lancer ; tassé sous le choc
    lift: bonk ? 1.6 : c < GOOD && c % 2 === 0 ? -0.7 : 0,
    gaze: c >= GOOD + 1 && c <= GOOD + 3 ? [0, -2.4] : dazed ? [0, 0] : [((c % 4) - 1.5) * 0.9, -2.2],
    feet: 'stand',
  };
}

/** Étoiles qui tournent autour de la tête après le choc. */
function Stars({ head, k }: { head: Pt; k: number }) {
  const n = k === 3 ? 3 : 2;
  const o = k === 3 ? 0.55 : 1;
  return (
    <g opacity={o}>
      {Array.from({ length: n + 1 }, (_, i) => {
        const a = (k * 70 + i * (360 / (n + 1))) * (Math.PI / 180);
        const x = head[0] + Math.cos(a) * 22;
        const y = head[1] + 3 + Math.sin(a) * 6;
        const s = 1.25 + 0.3 * Math.sin(a);
        return (
          <path
            key={i}
            transform={`translate(${x} ${y}) scale(${s})`}
            d="M0 -3.4 L0.95 -1 L3.4 -0.9 L1.4 0.6 L2.1 3 L0 1.6 L-2.1 3 L-1.4 0.6 L-3.4 -0.9 L-0.95 -1 Z"
            fill="#f1c24c"
            stroke={INK}
            strokeWidth={0.8}
            strokeLinejoin="round"
          />
        );
      })}
      {k === 0 && <path d={`M${head[0] - 9} ${head[1] - 6} L${head[0] - 13} ${head[1] - 10} M${head[0] + 9} ${head[1] - 6} L${head[0] + 13} ${head[1] - 10} M${head[0]} ${head[1] - 12} L${head[0]} ${head[1] - 16}`} stroke={INK} strokeWidth={1.1} strokeLinecap="round" />}
    </g>
  );
}

function over({ frame, rig: r, onFace }: PropArgs) {
  const c = frame % CYCLE;
  const head = onFace([49, 5]);
  const [hl, hr] = [r.arms[0].c, r.arms[1].c];
  let slots: Slot[];
  if (c < GOOD) slots = [0, 1, 2].map((b) => ballAt(c, b));
  else {
    slots = missBalls(c, head);
    const k = c - GOOD;
    // livres gardés en main pendant le raté (au-dessus de la main)
    if (k >= 1) slots[1] = { p: [hr[0], hr[1] - 4], spin: -8 };
    if (k >= 3) slots[2] = { p: [hl[0], hl[1] - 4], spin: 8 };
  }
  const k = c - GOOD;
  return (
    <g>
      {slots.map((s, i) => {
        const b = BOOKS[i];
        if (s === 'head') return <ClosedBook key={i} x={head[0] + 2} y={head[1] - 3.2} rot={k === 4 ? -14 : k === 5 ? -8 : -4} color={b.color} dark={b.dark} />;
        return <ClosedBook key={i} x={s.p[0]} y={s.p[1]} rot={s.spin} color={b.color} dark={b.dark} />;
      })}
      {k >= 4 && k <= 7 && <Stars head={head} k={k - 4} />}
    </g>
  );
}

const eyes = (f: number): EyesKind => {
  const k = (f % CYCLE) - GOOD;
  if (k === 4 || k === 5) return 'closed';
  if (k === 6) return 'lidded';
  return 'open';
};
const mouth = (f: number): MouthKind => {
  const k = (f % CYCLE) - GOOD;
  if (k === 2 || k === 3) return 'o';
  if (k >= 4 && k <= 6) return 'flat';
  if (k === 7) return 'smirk';
  return 'smile';
};

export const pose: PoseDef = { seated: false, fps: 7, rig, over, eyes, mouth };

export const activity: ActivityDef = {
  id: 'juggle',
  w: 2,
  acts: () => [
    { pose: 'juggle', ms: 3500, view: 'front' },
    { pose: 'juggle', ms: 4500, view: 'front', say: 'act:juggle' },
    { pose: 'juggle', ms: 3500, view: 'front' },
  ],
  lines: {
    all: ['Trois livres, zéro chute… presque.', 'Lire en l’air, ça compte ?', 'Le savoir, ça retombe toujours.', 'Équilibre précaire, pensée légère.', 'Aïe. Une idée m’est tombée dessus.'],
  },
};
