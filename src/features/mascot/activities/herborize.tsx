// Activité « herborize » (Rousseau) : les Rêveries du promeneur solitaire. Debout au bord de
// l'encadré, son herbier glissé sous le bras, il se penche et cueille une petite fleur qui pousse sur
// le bord, la lève près de son visage, l'examine à la loupe (l'œil grossi derrière la lentille), puis
// ouvre l'herbier et l'y presse, content. Cycle de 22 images à 3 images/s.
import type { ActivityDef, Limb, PoseDef, PropArgs, Pt, Rig } from './types';

const INK = '#231b11';
const PAPER = '#fbf6ea';
const COVER = '#5f6b3a';
const STEM = '#5b7a3a';
const PETAL = '#8d7fc9'; // pervenche
const PETAL2 = '#f4f0e4'; // pâquerette
const HEART = '#e8b93c';
const BRASS = '#b8892f';

const CYCLE = 22;
type Ph = 'look' | 'reach' | 'raise' | 'loupe' | 'open' | 'press' | 'happy';
function phase(f: number): Ph {
  const c = f % CYCLE;
  if (c < 2) return 'look';
  if (c < 5) return 'reach';
  if (c < 7) return 'raise';
  if (c < 13) return 'loupe';
  if (c < 14) return 'open';
  if (c < 17) return 'press';
  return 'happy';
}
/** La fleur est cueillie à l'image 4 ; elle repousse au début du cycle suivant. */
const picked = (f: number) => f % CYCLE >= 4;

const LEGS: [Limb, Limb] = [
  { a: [42, 64], b: [41, 94], c: [40, 121] },
  { a: [57, 64], b: [58, 94], c: [59, 121] },
];
/** Bras gauche (à l'écran) au repos, le long du corps. */
const TUCK: Limb = { a: [21, 54], b: [20, 68], c: [28, 80] };
/** Œil (à l'écran, à gauche) derrière la loupe. */
const EYE_FACE: Pt = [37, 43];
/** Herbier ouvert tenu devant lui. */
const BOOK: Pt = [40, 77];

function rig(f: number): Rig {
  const ph = phase(f);
  const c = f % CYCLE;
  const lift = ph === 'reach' ? 2.5 : 0;
  let left: Limb = TUCK;
  let right: Limb = { a: [78, 54], b: [79, 68], c: [71, 80] };
  let gaze: Pt = [1.6, 2.2];
  if (ph === 'reach') right = { a: [78, 54], b: [84, 80], c: c === 2 ? [80, 96] : [82, 104 - lift] };
  if (ph === 'raise') {
    right = { a: [78, 54], b: [84, 58], c: c === 5 ? [80, 62] : [74, 44] };
    gaze = [2, -0.4];
  }
  if (ph === 'loupe') {
    right = { a: [78, 54], b: [82, 60], c: [72 + (c % 2 ? 0.6 : 0), 44] };
    left = { a: [21, 54], b: [14, 58], c: [27, 42] };
    gaze = [2.2, -0.2];
  }
  if (ph === 'open' || ph === 'press' || ph === 'happy') {
    left = { a: [21, 54], b: [20, 70], c: [BOOK[0] - 6, BOOK[1] + 1] };
    right =
      ph === 'press'
        ? { a: [78, 54], b: [76, 72], c: [BOOK[0] + 6 + (c % 2 ? 0 : 0.8), BOOK[1] - 2 + (c === 14 ? -4 : 0)] }
        : ph === 'happy'
          ? { a: [78, 54], b: [79, 68], c: [71, 80] }
          : { a: [78, 54], b: [80, 66], c: [70, 62] };
    gaze = ph === 'happy' ? [0, 0.6] : [0, 2.4];
  }
  return { arms: [left, right], legs: LEGS, lift, gaze, feet: 'stand' };
}

/** Petite fleur : tige, feuille, corolle (pervenche ou pâquerette). */
function Flower({ x, y, h, kind, rot = 0, s = 1 }: { x: number; y: number; h: number; kind: 0 | 1; rot?: number; s?: number }) {
  const petal = kind ? PETAL2 : PETAL;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M0 0 Q1 ${-h / 2} 0 ${-h}`} fill="none" stroke={INK} strokeWidth={1.7} />
      <path d={`M0 0 Q1 ${-h / 2} 0 ${-h}`} fill="none" stroke={STEM} strokeWidth={0.7} />
      <path d={`M0.4 ${-h * 0.4} q3 -1.6 4 -3.6 q-3 0 -4 2.4 Z`} fill={STEM} stroke={INK} strokeWidth={0.6} />
      <g transform={`translate(0 ${-h})`}>
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx={0} cy={-1.7} rx={1.15} ry={1.8} transform={`rotate(${a})`} fill={petal} stroke={INK} strokeWidth={0.6} />
        ))}
        <circle r={0.95} fill={HEART} stroke={INK} strokeWidth={0.5} />
      </g>
    </g>
  );
}

/** Touffe d'herbe sur le bord. */
const Tuft = ({ x }: { x: number }) => (
  <path d={`M${x - 3} 124 Q${x - 2.4} 120 ${x - 3.6} 117.5 M${x} 124 Q${x} 119 ${x + 0.6} 116.5 M${x + 3} 124 Q${x + 2.6} 120.5 ${x + 4} 118.5`} fill="none" stroke={INK} strokeWidth={0.9} strokeLinecap="round" />
);

/** Les fleurs et l'herbe du bord. */
function back({ frame }: PropArgs) {
  return (
    <g strokeLinejoin="round">
      <Tuft x={73} />
      <Flower x={77} y={124} h={8} kind={1} rot={-8} />
      {!picked(frame) && <Flower x={82.5} y={124} h={13} kind={0} rot={3} />}
      <Tuft x={89} />
      <Flower x={93} y={124} h={9} kind={1} rot={10} />
    </g>
  );
}

/** Herbier : fermé, qui dépasse de la poche de l'habit ; puis ouvert, tenu devant lui (sous les mains). */
function mid({ frame }: PropArgs) {
  const ph = phase(frame);
  if (ph !== 'open' && ph !== 'press' && ph !== 'happy')
    return (
      <g strokeLinejoin="round">
        <g transform="rotate(-8 40 70)">
          <rect x={36.6} y={60.5} width={7.4} height={10} rx={0.8} fill={COVER} stroke={INK} strokeWidth={1} />
          <path d="M36.8 60.5 L36.8 70" stroke={INK} strokeWidth={1.5} />
          <rect x={38.6} y={62.4} width={3.8} height={2.2} rx={0.4} fill={PAPER} stroke={INK} strokeWidth={0.45} />
        </g>
        {/* le rabat de la poche, par-dessus */}
        <path d="M36 68.6 L44 68 L44.2 71.4 L36.4 72 Z" fill="#857352" stroke={INK} strokeWidth={1.3} />
      </g>
    );
  const [x, y] = BOOK;
  const pressed = ph === 'happy' || (ph === 'press' && frame % CYCLE >= 15);
  return (
    <g strokeLinejoin="round">
      <path d={`M${x - 10} ${y - 5} L${x} ${y - 3} L${x + 10} ${y - 5} L${x + 10} ${y + 5} L${x} ${y + 7} L${x - 10} ${y + 5} Z`} fill={COVER} stroke="currentColor" strokeWidth={1.1} />
      <path d={`M${x - 9} ${y - 6} Q${x - 4.5} ${y - 6.3} ${x} ${y - 4} L${x} ${y + 5.6} Q${x - 4.5} ${y + 3.6} ${x - 9} ${y + 4.2} Z`} fill={PAPER} stroke="currentColor" strokeWidth={0.8} />
      <path d={`M${x + 9} ${y - 6} Q${x + 4.5} ${y - 6.3} ${x} ${y - 4} L${x} ${y + 5.6} Q${x + 4.5} ${y + 3.6} ${x + 9} ${y + 4.2} Z`} fill={PAPER} stroke="currentColor" strokeWidth={0.8} />
      {/* une fleur déjà pressée à gauche, l'étiquette */}
      <g opacity={0.8}>
        <Flower x={x - 5} y={y + 2.5} h={6} kind={1} rot={-30} s={0.8} />
        <path d={`M${x - 8} ${y + 3.6} L${x - 3} ${y + 3.2}`} stroke={INK} strokeWidth={0.45} />
      </g>
      {pressed && <Flower x={x + 3.5} y={y + 3} h={8} kind={0} rot={28} s={0.85} />}
    </g>
  );
}

/** La fleur cueillie, la loupe (au bout de son cordon) et l'œil grossi. */
function over({ frame, rig: r, onFace }: PropArgs) {
  const ph = phase(frame);
  const c = frame % CYCLE;
  const out = [];
  const [rx, ry] = r.arms[1].c;
  // Fleur tenue dans la main droite (à l'écran), de la cueillette jusqu'au pressage.
  if (c >= 4 && (ph === 'reach' || ph === 'raise' || ph === 'loupe' || ph === 'open' || (ph === 'press' && c < 15)))
    out.push(<Flower key="fl" x={rx - 0.5} y={ry + 1.5} h={11} kind={0} rot={ph === 'press' ? 40 : ph === 'open' ? 20 : -6} />);
  // Loupe : pendue au cordon sur la poitrine, ou levée devant l'œil.
  const neck: Pt = [48, 44];
  if (ph === 'loupe') {
    const eye = onFace(EYE_FACE);
    const gx = r.gaze[0] * 0.75;
    const gy = r.gaze[1] * 0.75;
    const [hx, hy] = r.arms[0].c;
    out.push(
      <g key="lp" strokeLinecap="round">
        <path d={`M${neck[0]} ${neck[1]} Q${neck[0] - 8} ${neck[1] + 6} ${hx} ${hy}`} fill="none" stroke={INK} strokeWidth={0.5} opacity={0.6} />
        <path d={`M${hx} ${hy} L${eye[0] - 2.4} ${eye[1] + 4.6}`} stroke={INK} strokeWidth={2.6} />
        <path d={`M${hx} ${hy} L${eye[0] - 2.4} ${eye[1] + 4.6}`} stroke="#6b4325" strokeWidth={1.3} />
        {/* l'œil grossi par la lentille */}
        <circle cx={eye[0]} cy={eye[1]} r={5.6} fill="#fffaf0" />
        <circle cx={eye[0] + gx * 1.4} cy={eye[1] + gy * 1.4} r={2.9} fill={INK} />
        <circle cx={eye[0] + gx * 1.4 + 1} cy={eye[1] + gy * 1.4 - 1.1} r={0.95} fill="#fffaf0" />
        <circle cx={eye[0]} cy={eye[1]} r={5.6} fill="#cfe3ea" opacity={0.25} />
        <path d={`M${eye[0] - 3.6} ${eye[1] - 1.6} A4 4 0 0 1 ${eye[0] - 1} ${eye[1] - 4}`} fill="none" stroke="#fffaf0" strokeWidth={1} opacity={0.9} />
        <circle cx={eye[0]} cy={eye[1]} r={5.6} fill="none" stroke={INK} strokeWidth={2.2} />
        <circle cx={eye[0]} cy={eye[1]} r={5.6} fill="none" stroke={BRASS} strokeWidth={1} />
      </g>,
    );
  } else {
    const lp: Pt = [46.5, 57];
    out.push(
      <g key="lp">
        <path d={`M${neck[0] - 3} ${neck[1]} Q${lp[0] - 2} ${lp[1] - 6} ${lp[0]} ${lp[1] - 2.6} M${neck[0] + 3} ${neck[1]} Q${lp[0] + 2} ${lp[1] - 6} ${lp[0]} ${lp[1] - 2.6}`} fill="none" stroke={INK} strokeWidth={0.5} opacity={0.6} />
        <circle cx={lp[0]} cy={lp[1]} r={2.4} fill="#e4eff2" stroke={INK} strokeWidth={1.3} />
        <circle cx={lp[0]} cy={lp[1]} r={2.4} fill="none" stroke={BRASS} strokeWidth={0.6} />
        <path d={`M${lp[0]} ${lp[1] + 2.4} L${lp[0] + 0.4} ${lp[1] + 6}`} stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
      </g>,
    );
  }
  return <g>{out}</g>;
}

export const pose: PoseDef = {
  seated: false,
  fps: 3,
  rig,
  back,
  mid,
  over,
  eyes: (f) => (phase(f) === 'happy' ? 'happy' : 'open'),
  mouth: (f) => {
    const ph = phase(f);
    return ph === 'loupe' ? (f % CYCLE === 10 ? 'o' : 'flat') : ph === 'press' ? 'smirk' : 'smile';
  },
};

export const activity: ActivityDef = {
  id: 'herborize',
  w: 2,
  chars: ['rousseau'],
  acts: () => [
    { pose: 'herborize', ms: 4000, view: 'front' },
    { pose: 'herborize', ms: 7000, view: 'front', say: 'act:herborize' },
    { pose: 'herborize', ms: 5000, view: 'front' },
  ],
  lines: {
    rousseau: [
      'Ah, de la pervenche !',
      'Une fleur ne ment jamais.',
      'Herboriser : rêver avec les mains.',
      'Loin des livres, la nature est mon maître.',
      'Seul, mais si bien accompagné de mes plantes.',
      'Encore une pour l’herbier, et je rentre… peut-être.',
    ],
  },
};
