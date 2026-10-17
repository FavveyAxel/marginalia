// Activité « paint » : debout à côté d'un petit chevalet posé sur l'encadré, il peint un paysage.
// Palette dans la main gauche, pinceau dans la droite : il tamponne la toile (ciel, soleil, collines,
// arbre, nuage, fleurs, un oiseau…) et, toutes les 8 images, se redresse pour admirer son œuvre.
// Cycle de 8 images (3 par seconde) : touches aux images 1, 3, 5 ; 6–7 il admire. Le tableau se remplit
// d'une touche à chaque fois (12 touches, complet vers l'image 29) puis il fignole.
import type { ActivityDef, EyesKind, MouthKind, PoseDef, Pt, Rig } from './types';

const INK = '#231b11';
/** Toile : coin haut gauche (repère réel), 24 × 20. */
const CV: Pt = [84, 68];
const CW = 24;
const CH = 20;

type Stroke = { c: string; at: Pt; el: JSX.Element };
const s = (d: string, c: string, w: number) => <path d={d} fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />;
const STROKES: Stroke[] = [
  { c: '#9cc3d5', at: [8, 2.8], el: s('M1.6 2.8 Q 7 1.8 13 3', '#9cc3d5', 2.6) },
  { c: '#9cc3d5', at: [10, 6.2], el: s('M1.8 6.4 Q 9 5.2 15.5 6.6', '#9cc3d5', 2.6) },
  { c: '#e8b84a', at: [18.5, 5], el: <circle cx={18.5} cy={5} r={2.8} fill="#e8b84a" /> },
  { c: '#9cc3d5', at: [15, 9.2], el: s('M1.8 9.4 Q 12 8.4 22.4 9.2', '#9cc3d5', 2.2) },
  { c: '#7fa35a', at: [6, 13], el: <path d="M0.6 15 Q 7 8.6 14.5 13.6 L14.5 19.4 L0.6 19.4 Z" fill="#7fa35a" /> },
  { c: '#5d8443', at: [18, 13], el: <path d="M9 19.4 L9 15.4 Q 16 10.2 23.4 13.8 L23.4 19.4 Z" fill="#5d8443" /> },
  { c: '#d9a441', at: [14, 16.5], el: s('M12.6 19.4 Q 12.4 16.8 15.6 14.6', '#d9a441', 1.4) },
  { c: '#6b4325', at: [5, 12.4], el: s('M5 14 L5 10.6', '#6b4325', 1.1) },
  { c: '#4f7a3a', at: [5, 9.2], el: <circle cx={5} cy={9.2} r={2.3} fill="#4f7a3a" /> },
  { c: '#fffaf0', at: [8, 4.4], el: <ellipse cx={8} cy={4.4} rx={3.2} ry={1.2} fill="#fffaf0" /> },
  { c: '#c9553a', at: [6, 17.6], el: <g fill="#c9553a">{([[3, 17], [6, 18], [9.6, 17.4], [7.6, 16.4]] as Pt[]).map(([x, y]) => <circle key={x} cx={x} cy={y} r={0.65} />)}</g> },
  { c: INK, at: [17, 9.4], el: s('M15.4 9.8 q 0.9 -1 1.8 0 q 0.9 -1 1.8 0', INK, 0.5) },
];
const DABS = [0, 1, 1, 2, 2, 3, 3, 3];
const dab = (f: number) => f % 8 === 1 || f % 8 === 3 || f % 8 === 5;
const admire = (f: number) => f % 8 >= 6;
/** Nombre de touches déjà posées sur la toile à l'image f. */
const painted = (f: number) => Math.min(STROKES.length, Math.floor(f / 8) * 3 + DABS[f % 8]);
/** Touche visée par le pinceau à l'image f. */
function target(f: number): number {
  const n = painted(f);
  if (n >= STROKES.length) return (f * 5) % STROKES.length; // il fignole
  return dab(f) ? n - 1 : n;
}
const real = (p: Pt): Pt => [CV[0] + p[0], CV[1] + p[1]];

/** Pinceau : la main le tient, les poils pointent vers `deg`. */
const BRUSH_DEG = -24;
const BRUSH_LEN = 13;
function brushTip(f: number): Pt {
  const t = real(STROKES[target(f)].at);
  return dab(f) ? t : [t[0] - 2.6, t[1] - 1.6];
}

function rig(f: number): Rig {
  const legs: Rig['legs'] = [
    { a: [42, 64], b: [40, 94], c: [37, 121] },
    { a: [57, 64], b: [59, 94], c: [61, 121] },
  ];
  const palette = { a: [21, 54] as Pt, b: [7, 62] as Pt, c: [15, 76] as Pt };
  if (admire(f)) {
    // il se redresse, pinceau levé, et contemple
    return {
      arms: [palette, { a: [78, 54], b: [90, 72], c: [83, 86] }],
      legs: [legs[0], { a: [57, 64], b: [61, 94], c: [64, 121] }],
      lift: -1.2,
      gaze: [2.2, 0.6],
      feet: 'stand',
    };
  }
  const a = (BRUSH_DEG * Math.PI) / 180;
  const tip = brushTip(f);
  const hand: Pt = [tip[0] - BRUSH_LEN * Math.cos(a), tip[1] - BRUSH_LEN * Math.sin(a)];
  return {
    arms: [palette, { a: [78, 54], b: [(78 + hand[0]) / 2 + 9, (54 + hand[1]) / 2 + 2], c: hand }],
    legs,
    lift: f % 2 ? -0.4 : 0,
    gaze: [2.4, 1.6],
    feet: 'stand',
  };
}

function Easel({ n }: { n: number }) {
  const [x, y] = CV;
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      {/* pied arrière, mât, pieds avant */}
      <path d={`M${x + 12} ${y - 2} L${x + 13} ${y + 55}`} stroke={INK} strokeWidth={2.6} />
      <path d={`M${x + 12} ${y - 2} L${x + 13} ${y + 55}`} stroke="#8a5a2e" strokeWidth={1.2} />
      {[
        [x + 8, x - 1.5],
        [x + 16, x + 25.5],
      ].map(([a, b]) => (
        <g key={a}>
          <path d={`M${a} ${y - 5} L${b} ${y + 56}`} stroke={INK} strokeWidth={3.2} />
          <path d={`M${a} ${y - 5} L${b} ${y + 56}`} stroke="#b07a45" strokeWidth={1.6} />
        </g>
      ))}
      <path d={`M${x + 12} ${y - 8} L${x + 12} ${y + 1}`} stroke={INK} strokeWidth={3} />
      <path d={`M${x + 12} ${y - 8} L${x + 12} ${y + 1}`} stroke="#b07a45" strokeWidth={1.5} />
      {/* toile */}
      <rect x={x - 0.6} y={y - 0.6} width={CW + 1.2} height={CH + 1.2} rx={0.6} fill="#e6d5b4" stroke={INK} strokeWidth={1.3} />
      <rect x={x} y={y} width={CW} height={CH} fill="#fbf6ea" />
      <g transform={`translate(${x} ${y})`} opacity={0.95}>
        {STROKES.slice(0, n).map((st, i) => (
          <g key={i}>{st.el}</g>
        ))}
      </g>
      {/* traverse et pince */}
      <rect x={x - 2.4} y={y + CH + 0.4} width={CW + 4.8} height={2.6} rx={0.6} fill="#b07a45" stroke={INK} strokeWidth={1.1} />
      <rect x={x + 10.4} y={y - 2.4} width={3.2} height={2.6} rx={0.5} fill="#8a5a2e" stroke={INK} strokeWidth={0.9} />
    </g>
  );
}

function Palette({ h }: { h: Pt }) {
  const [x, y] = [h[0] - 1, h[1] + 1.5];
  return (
    <g strokeLinejoin="round">
      <path
        d={`M${x - 9} ${y} C ${x - 9.5} ${y - 5}, ${x - 2} ${y - 6.4}, ${x + 4} ${y - 5.4} C ${x + 9} ${y - 4.6}, ${x + 10.4} ${y - 1}, ${x + 8} ${y + 1.4} C ${x + 6} ${y + 3}, ${x + 4.4} ${y + 2.2}, ${x + 3.6} ${y + 4} C ${x + 2.6} ${y + 6.2}, ${x - 8.4} ${y + 5.8}, ${x - 9} ${y} Z`}
        fill="#d9b27c"
        stroke={INK}
        strokeWidth={1.2}
      />
      <path d={`M${x - 7} ${y - 2.6} Q ${x - 3} ${y - 4.8} ${x + 3} ${y - 4.2}`} fill="none" stroke="#f3dcb0" strokeWidth={0.8} strokeLinecap="round" />
      {(
        [
          [-6, 0.4, '#9cc3d5'],
          [-3.2, -2.6, '#e8b84a'],
          [0.6, -3, '#7fa35a'],
          [4.6, -2.4, '#c9553a'],
          [6.6, -0.2, '#fffaf0'],
          [-4.6, 3.4, '#5d8443'],
        ] as [number, number, string][]
      ).map(([dx, dy, c]) => (
        <ellipse key={c} cx={x + dx} cy={y + dy} rx={1.4} ry={1} fill={c} stroke={INK} strokeWidth={0.5} />
      ))}
    </g>
  );
}

function Brush({ hand, deg, color }: { hand: Pt; deg: number; color: string }) {
  return (
    <g transform={`translate(${hand[0]} ${hand[1]}) rotate(${deg})`} strokeLinecap="round" strokeLinejoin="round">
      <path d="M-4 0 L8.6 0" stroke={INK} strokeWidth={2.4} />
      <path d="M-4 0 L8.6 0" stroke="#7a2e22" strokeWidth={1.1} />
      <rect x={8.4} y={-1} width={2.2} height={2} fill="#a39d94" stroke={INK} strokeWidth={0.5} />
      <path d={`M10.6 -1 Q 12.4 -0.9 ${BRUSH_LEN} 0 Q 12.4 0.9 10.6 1 Z`} fill={color} stroke={INK} strokeWidth={0.6} />
    </g>
  );
}

export const pose: PoseDef = {
  seated: false,
  fps: 3,
  rig,
  back: ({ frame }) => <Easel n={painted(frame)} />,
  mid: ({ frame, rig: r }) => {
    const hand = r.arms[1].c;
    const col = STROKES[target(frame)].c;
    return (
      <g>
        <Palette h={r.arms[0].c} />
        <Brush hand={hand} deg={admire(frame) ? -70 : BRUSH_DEG} color={col === INK ? '#3a3229' : col} />
      </g>
    );
  },
  eyes: (f): EyesKind => (admire(f) ? 'happy' : 'open'),
  mouth: (f): MouthKind => (admire(f) ? 'smile' : f % 8 === 3 || f % 8 === 4 ? 'tongue' : 'flat'),
};

const r = Math.random;
const sec = (a: number, b: number) => (a + r() * (b - a)) * 1000;

export const activity: ActivityDef = {
  id: 'paint',
  w: 2,
  // une seule action : le tableau se remplit tout du long (l'image repart de 0 à chaque action)
  acts: () => [{ pose: 'paint', ms: sec(6, 8), view: 'front', say: 'act:paint' }],
  lines: {
    all: [
      'Je ne peins pas ce que je vois, je peins ce que je lis.',
      'Un peu de bleu, beaucoup de doute.',
      'L’art imite la nature. La nature a du travail.',
      'Encore une touche… et c’est un chef-d’œuvre.',
      'Le soleil en haut à droite : audacieux, non ?',
    ],
    platon: ['Une copie de copie… mais quelle copie !'],
    rousseau: ['La nature, rien que la nature.'],
  },
};
