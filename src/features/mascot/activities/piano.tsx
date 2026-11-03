// Activité « piano » : assis au bord de l'encadré, un petit piano droit posé sur les genoux (piano
// jouet en bois verni, clavier vers lui). Les mains alternent sur les touches — une touche s'enfonce
// sous chaque main posée —, le corps se balance au rythme, des notes s'envolent de part et d'autre.
// Cycle de 8 images (6 par seconde) : la main gauche joue aux images paires, la droite aux impaires ;
// de temps en temps les deux mains plaquent un accord (images 6 et 7), yeux plissés de plaisir.
import type { ActivityDef, EyesKind, MouthKind, PoseDef, Pt, PropArgs, Rig } from './types';
import { RisingNotes } from './notes';

const INK = '#231b11';
const WOOD = '#7a4a2e';
const WOOD_HI = '#9c6440';
const WOOD_LO = '#55311d';
const IVORY = '#fbf6ea';
const CYCLE = 8;

// Clavier (sur les genoux) : de x 24 à 76, touches blanches de y 60 à 65.
const KEY_L = 24;
const KEY_R = 76;
const KEY_TOP = 60;
const KEY_BOT = 65.4;
const N_WHITE = 13;
const KW = (KEY_R - KEY_L) / N_WHITE;

/** Touche (indice) sous chaque main à l'image f, et si la main est posée. */
function handsAt(f: number): { l: number; r: number; lDown: boolean; rDown: boolean } {
  const c = f % CYCLE;
  const chord = c === 6 || c === 7;
  const lKeys = [1, 3, 2, 4, 1, 3, 2, 2];
  const rKeys = [8, 10, 9, 11, 10, 8, 9, 9];
  return { l: lKeys[c], r: rKeys[c], lDown: chord ? c === 6 : c % 2 === 0, rDown: chord ? c === 6 : c % 2 === 1 };
}
const keyX = (i: number) => KEY_L + (i + 0.5) * KW;

function rig(f: number): Rig {
  const { l, r, lDown, rDown } = handsAt(f);
  const sway = Math.floor(f / 2) % 2 ? 0.8 : -0.8;
  const hl: Pt = [keyX(l), lDown ? 61.6 : 57.4];
  const hr: Pt = [keyX(r), rDown ? 61.6 : 57.4];
  const swing = Math.floor(f / 4) % 2;
  return {
    arms: [
      { a: [21, 54], b: [14 + sway, 64], c: hl },
      { a: [78, 54], b: [86 + sway, 64], c: hr },
    ],
    legs: [
      { a: [42, 64], b: [40, 74], c: swing ? [37, 97] : [38, 99] },
      { a: [57, 64], b: [59, 74], c: swing ? [62, 99] : [63, 97] },
    ],
    lift: f % 2 ? -0.6 : 0,
    gaze: [sway * 0.6, 1.8],
    feet: 'hang',
  };
}

/** Petit piano droit vu de face, posé sur les genoux : caisse vernie, clavier, pupitre. */
function Piano({ frame }: { frame: number }) {
  const { l, r, lDown, rDown } = handsAt(frame);
  const pressed = new Set<number>([...(lDown ? [l] : []), ...(rDown ? [r] : [])]);
  const whites = Array.from({ length: N_WHITE }, (_, i) => i);
  // touches noires : motif 2-3 de l'octave (pas après mi et si)
  const blacks = whites.filter((i) => i < N_WHITE - 1 && ![2, 6, 9].includes(i % 7));
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      {/* caisse (sous le clavier, sur les cuisses) */}
      <path d={`M${KEY_L - 3} ${KEY_BOT} L${KEY_R + 3} ${KEY_BOT} L${KEY_R + 2} 79 Q50 81 ${KEY_L - 2} 79 Z`} fill={WOOD} stroke={INK} strokeWidth={1.3} />
      <path d={`M${KEY_L + 1} 70 L${KEY_R - 1} 70`} stroke={WOOD_HI} strokeWidth={1} opacity={0.7} />
      <path d={`M${KEY_L} 76.6 Q50 78.4 ${KEY_R} 76.6`} fill="none" stroke={WOOD_LO} strokeWidth={0.9} />
      {/* petits pieds dorés */}
      <circle cx={KEY_L + 2} cy={79.6} r={1.3} fill="#d9a441" stroke={INK} strokeWidth={0.7} />
      <circle cx={KEY_R - 2} cy={79.6} r={1.3} fill="#d9a441" stroke={INK} strokeWidth={0.7} />
      {/* joue-clavier (rebord en bois sous les touches) */}
      <rect x={KEY_L - 3} y={KEY_TOP - 1.6} width={KEY_R - KEY_L + 6} height={KEY_BOT - KEY_TOP + 2.4} rx={1.2} fill={WOOD_LO} stroke={INK} strokeWidth={1.2} />
      {/* touches blanches */}
      {whites.map((i) => (
        <rect key={i} x={KEY_L + i * KW} y={KEY_TOP + (pressed.has(i) ? 0.7 : 0)} width={KW} height={KEY_BOT - KEY_TOP - (pressed.has(i) ? 0.4 : 0)} fill={pressed.has(i) ? '#e7dcc5' : IVORY} stroke={INK} strokeWidth={0.55} />
      ))}
      {/* touches noires */}
      {blacks.map((i) => (
        <rect key={'b' + i} x={KEY_L + (i + 1) * KW - KW * 0.32} y={KEY_TOP} width={KW * 0.64} height={(KEY_BOT - KEY_TOP) * 0.58} rx={0.3} fill="#2a211b" stroke={INK} strokeWidth={0.4} />
      ))}
    </g>
  );
}

export const pose: PoseDef = {
  seated: true,
  fps: 6,
  rig,
  mid: ({ frame }: PropArgs) => <Piano frame={frame} />,
  over: ({ frame }: PropArgs) => (
    <RisingNotes
      frame={frame}
      from={[
        [16, 54],
        [84, 50],
        [12, 46],
      ]}
      drift={1.2}
    />
  ),
  eyes: (f): EyesKind => (f % CYCLE >= 6 ? 'happy' : f % 17 === 16 ? 'closed' : 'open'),
  mouth: (f): MouthKind => (f % CYCLE === 6 ? 'o' : 'smile'),
};

export const activity: ActivityDef = {
  id: 'piano',
  w: 2,
  acts: () => [
    { pose: 'piano', ms: 3500, view: 'front' },
    { pose: 'piano', ms: 5500, view: 'front', say: 'act:piano' },
    { pose: 'piano', ms: 4000, view: 'front' },
  ],
  lines: {
    all: ['Un petit air pour accompagner ta lecture.', 'Do, ré, mi… fa, sol, la, lis !', 'Je joue en sourdine, promis.', 'Les touches noires, ce sont les notes en marge.'],
    mozart: ['Un menuet en passant ? J’en ai toujours un d’avance.', 'Ce clavier est minuscule, mais l’idée est grande.'],
  },
};
