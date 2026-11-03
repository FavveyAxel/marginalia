// Activité « harp » : assis au bord de l'encadré, il joue d'une harpe posée à côté de lui, à droite
// pour nous, debout sur le même bord (colonne dorée, console courbe, table d'harmonie en bois clair,
// cordes tendues). Les deux mains pincent les cordes en alternance ; la corde pincée vibre (trait
// ondulé, qui s'amortit) ; des notes s'envolent au-dessus de la console.
// Cycle de 8 images (5 par seconde) : la main droite pince aux images paires, la gauche aux impaires.
import type { ActivityDef, EyesKind, MouthKind, PoseDef, Pt, PropArgs, Rig } from './types';
import { RisingNotes } from './notes';

const INK = '#231b11';
const GOLD = '#d9a441';
const GOLD_LO = '#a37422';
const WOOD = '#c9925a';
const WOOD_LO = '#8f5d31';
const STRING = '#8a6238';
const CYCLE = 8;

// Harpe (repère du Sprite, assis : assise à y = 70) : pied posé sur le bord, à droite.
const BASE_Y = 71.5;
/** Colonne (à droite, presque verticale). */
const COL_X = 95;
const COL_TOP = 18;
/** Table d'harmonie : du pied (en bas à gauche) vers le haut de la console (en haut à gauche). */
const SB_BOT: Pt = [80, BASE_Y - 1];
const SB_TOP: Pt = [66, 30];
/** Cordes : du bas de la console (courbe) jusqu'à la table d'harmonie ; abscisses des cordes. */
const STRINGS = [70, 73.5, 77, 80.5, 84, 87.5, 91];

/** Hauteur de la console (bas de la courbe) à l'abscisse x. */
const neckY = (x: number) => {
  const u = (x - SB_TOP[0]) / (COL_X - SB_TOP[0]);
  return SB_TOP[1] - 6 + Math.sin(u * Math.PI) * -5 + u * 0;
};
/** Hauteur de la table d'harmonie à l'abscisse x. */
const boardY = (x: number) => SB_TOP[1] + ((x - SB_TOP[0]) / (SB_BOT[0] - SB_TOP[0])) * (SB_BOT[1] - SB_TOP[1]);

/** Corde pincée par chaque main à l'image f (indices), et quelle main pince. */
function pluck(f: number): { l: number; r: number; who: 'l' | 'r' } {
  const c = f % CYCLE;
  const lSeq = [3, 2, 4, 3, 2, 4, 3, 2];
  const rSeq = [5, 6, 5, 6, 6, 5, 6, 5];
  return { l: lSeq[c], r: rSeq[c], who: c % 2 ? 'l' : 'r' };
}
/** Point de la corde i à une fraction t de sa longueur (0 : en haut). */
function onString(i: number, t: number): Pt {
  const x = STRINGS[i];
  const top = neckY(x) + 4;
  const bot = Math.min(boardY(x) - 1, BASE_Y - 4);
  return [x, top + (bot - top) * t];
}

function rig(f: number): Rig {
  const { l, r, who } = pluck(f);
  const hl0 = onString(l, 0.84);
  const hr0 = onString(r, 0.42);
  // la main qui pince est tirée un peu vers l'extérieur de la corde
  const hl: Pt = who === 'l' ? [hl0[0] - 2.4, hl0[1] + 0.6] : [hl0[0] - 0.6, hl0[1]];
  const hr: Pt = who === 'r' ? [hr0[0] + 2.4, hr0[1] + 0.6] : [hr0[0] + 0.6, hr0[1]];
  const swing = Math.floor(f / 4) % 2;
  return {
    arms: [
      { a: [21, 54], b: [40, 80], c: hl },
      { a: [78, 54], b: [92, 52], c: hr },
    ],
    legs: [
      { a: [42, 64], b: [40, 74], c: swing ? [36, 97] : [38, 99] },
      { a: [57, 64], b: [59, 74], c: swing ? [61, 99] : [62, 97] },
    ],
    lift: 0,
    gaze: [2.2, 0.8],
    feet: 'hang',
  };
}

function Harp({ frame }: { frame: number }) {
  const { l, r, who } = pluck(frame);
  const plucked = who === 'l' ? l : r;
  // amplitude de la vibration (la corde de l'image précédente vibre encore un peu)
  const prev = pluck(frame - 1);
  const prevString = prev.who === 'l' ? prev.l : prev.r;
  const neckPath = `M${SB_TOP[0] - 2} ${SB_TOP[1] - 1} C ${SB_TOP[0] + 6} ${SB_TOP[1] - 14}, ${COL_X - 12} ${COL_TOP - 4}, ${COL_X + 1} ${COL_TOP + 1}`;
  const wave = (i: number, amp: number) => {
    const [x, y0] = onString(i, 0);
    const [, y1] = onString(i, 1);
    const n = 6;
    const h = (y1 - y0) / n;
    let d = `M${x} ${y0}`;
    for (let k = 0; k < n; k++) d += ` q ${(k % 2 ? -1 : 1) * amp} ${h / 2} 0 ${h}`;
    return d;
  };
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      {/* colonne */}
      <path d={`M${COL_X - 1.6} ${COL_TOP + 2} L ${COL_X - 1.6} ${BASE_Y - 2} L ${COL_X + 1.6} ${BASE_Y - 2} L ${COL_X + 1.6} ${COL_TOP + 2} Z`} fill={GOLD} stroke={INK} strokeWidth={1.1} />
      <path d={`M${COL_X - 0.4} ${COL_TOP + 6} L ${COL_X - 0.4} ${BASE_Y - 6}`} stroke="#f6dc8e" strokeWidth={0.7} opacity={0.8} />
      <circle cx={COL_X} cy={COL_TOP} r={2.4} fill={GOLD} stroke={INK} strokeWidth={1} />
      {/* cordes */}
      {STRINGS.map((x, i) => {
        if (i === plucked) return <path key={i} d={wave(i, 1.3)} fill="none" stroke="#d65a3a" strokeWidth={0.9} />;
        if (i === prevString) return <path key={i} d={wave(i, 0.55)} fill="none" stroke={STRING} strokeWidth={0.75} />;
        const [, y0] = onString(i, 0);
        const [, y1] = onString(i, 1);
        return <path key={i} d={`M${x} ${y0} L ${x} ${y1}`} stroke={i % 3 === 0 ? '#b8452a' : STRING} strokeWidth={0.7} />;
      })}
      {/* ombre des cordes (pour qu'elles se lisent sur fond clair) */}
      {STRINGS.map((x, i) => {
        const [, y0] = onString(i, 0);
        const [, y1] = onString(i, 1);
        return <path key={'s' + i} d={`M${x + 0.5} ${y0} L ${x + 0.5} ${y1}`} stroke={INK} strokeWidth={0.25} opacity={0.35} />;
      })}
      {/* table d'harmonie */}
      <path d={`M${SB_TOP[0] - 3} ${SB_TOP[1] - 1} L ${SB_BOT[0] - 4} ${SB_BOT[1]} L ${SB_BOT[0] + 2} ${SB_BOT[1]} L ${SB_TOP[0] + 2} ${SB_TOP[1] + 1} Z`} fill={WOOD} stroke={INK} strokeWidth={1.1} />
      <path d={`M${SB_TOP[0] + 0.4} ${SB_TOP[1] + 4} L ${SB_BOT[0] - 1} ${SB_BOT[1] - 4}`} stroke={WOOD_LO} strokeWidth={0.6} opacity={0.8} />
      {/* console (courbe en S) */}
      <path d={neckPath} fill="none" stroke={INK} strokeWidth={4.4} />
      <path d={neckPath} fill="none" stroke={GOLD} strokeWidth={2.6} />
      <path d={neckPath} fill="none" stroke="#f6dc8e" strokeWidth={0.6} opacity={0.7} transform="translate(0 -0.6)" />
      {/* socle */}
      <path d={`M${SB_BOT[0] - 6} ${BASE_Y} L ${COL_X + 3} ${BASE_Y} L ${COL_X + 2} ${BASE_Y - 3} L ${SB_BOT[0] - 5} ${BASE_Y - 3} Z`} fill={GOLD_LO} stroke={INK} strokeWidth={1} />
    </g>
  );
}

export const pose: PoseDef = {
  seated: true,
  fps: 5,
  rig,
  back: ({ frame }: PropArgs) => <Harp frame={frame} />,
  over: ({ frame }: PropArgs) => (
    <RisingNotes
      frame={frame}
      from={[
        [78, 38],
        [86, 32],
        [72, 42],
      ]}
      drift={0.8}
    />
  ),
  eyes: (f): EyesKind => (Math.floor(f / CYCLE) % 2 ? 'lidded' : 'open'),
  mouth: (f): MouthKind => (f % CYCLE === 5 ? 'o' : 'smile'),
};

export const activity: ActivityDef = {
  id: 'harp',
  w: 2,
  acts: () => [
    { pose: 'harp', ms: 3500, view: 'front' },
    { pose: 'harp', ms: 5500, view: 'front', say: 'act:harp' },
    { pose: 'harp', ms: 4000, view: 'front' },
  ],
  lines: {
    all: ['Quelques arpèges pour aérer la page.', 'Une harpe, c’est une étagère de cordes.', 'Chut, j’accorde mes idées.', 'Pincer une corde, souligner une phrase : même geste.'],
  },
};
