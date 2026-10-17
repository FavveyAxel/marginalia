// Activité « coffee » : assis au bord de l'encadré, il prend un café. La soucoupe dans la main gauche,
// la tasse dans la droite ; il souffle dessus, la porte à ses lèvres (yeux fermés), la repose avec un
// petit air comblé. Un filet de vapeur s'élève et s'enroule au-dessus de la tasse.
// Cycle de 16 images (3,5 par seconde) : 0–5 tasse sur la soucoupe (il souffle aux images 3–4),
// 6 il la lève, 7–10 il boit, 11 il la redescend, 12–13 l'air ravi, 14–15 au repos.
import type { ActivityDef, EyesKind, MouthKind, PoseDef, Pt, PropArgs, Rig } from './types';

const INK = '#231b11';
const CYCLE = 16;
const phase = (f: number) => f % CYCLE;
const sipping = (f: number) => phase(f) >= 7 && phase(f) <= 10;
const halfway = (f: number) => phase(f) === 6 || phase(f) === 11;
const blowing = (f: number) => phase(f) === 3 || phase(f) === 4;

// Tasse (repère local : fond au centre (0, 0), bord à y = -6) ; l'anse à droite, prise en G.
const G: Pt = [6.6, -3.3];
/** Tasse posée sur la soucoupe (position du fond). */
const LOW: Pt = [51, 66.7];
/** Inclinaison de la tasse quand il boit : le bord gauche vient à la bouche. */
const TILT = -20;
/** Main droite quand il boit (repère du visage), calée pour que l'anse tombe dans la main. */
const SIP_HAND: Pt = [57.6, 51.2];
const HALF_HAND: Pt = [58.5, 60];

function rot([x, y]: Pt, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
}

function rig(f: number): Rig {
  const c = phase(f);
  const swing = Math.floor(f / 4) % 2;
  const legs: Rig['legs'] = [
    { a: [42, 64], b: [40, 74], c: swing ? [36, 96] : [38, 99] },
    { a: [57, 64], b: [59, 74], c: swing ? [61, 99] : [64, 96] },
  ];
  const left = { a: [21, 54] as Pt, b: [17, 76] as Pt, c: [42.6, 67.8] as Pt };
  if (sipping(f))
    return { arms: [left, { a: [78, 54], b: [88, 60], c: SIP_HAND }], legs, lift: 0, gaze: [0, 0], feet: 'hang', faceHand: 1 };
  if (halfway(f))
    return { arms: [left, { a: [78, 54], b: [87, 65], c: HALF_HAND }], legs, lift: 0, gaze: [-0.4, 1.4], feet: 'hang', faceHand: 1 };
  return {
    arms: [left, { a: [78, 54], b: [84, 76], c: [LOW[0] + G[0], LOW[1] + G[1]] }],
    legs,
    lift: 0,
    gaze: c >= 12 && c <= 13 ? [0, 0] : [0.2, 1.9],
    feet: 'hang',
  };
}

/** Petite tasse de porcelaine à liseré rouge. */
function Cup({ o, tilt = 0, full = true }: { o: Pt; tilt?: number; full?: boolean }) {
  return (
    <g transform={`translate(${o[0]} ${o[1]}) rotate(${tilt})`} strokeLinejoin="round" strokeLinecap="round">
      <path d="M4.1 -4.8 C 7.6 -5.6, 8 -1.2, 4 -1.6" fill="none" stroke={INK} strokeWidth={2.4} />
      <path d="M4.1 -4.8 C 7.6 -5.6, 8 -1.2, 4 -1.6" fill="none" stroke="#fbf6ea" strokeWidth={0.9} />
      <path d="M-3 0 Q -4.3 -0.3 -4.1 -1.8 L -4.3 -6 L 4.3 -6 L 4.1 -1.8 Q 4.3 -0.3 3 0 Z" fill="#fbf6ea" stroke={INK} strokeWidth={1.1} />
      <path d="M-4.2 -4.2 L 4.2 -4.2" stroke="#c9553a" strokeWidth={0.9} />
      <path d="M-2.8 -3.2 L -2.6 -1.2" stroke="#fffaf0" strokeWidth={0.7} opacity={0.9} />
      <path d="M1.8 -0.6 Q 3.2 -0.9 3.4 -2.4" fill="none" stroke="#c9b89a" strokeWidth={0.6} opacity={0.8} />
      <ellipse cx={0} cy={-6} rx={4.3} ry={1.15} fill={full ? '#5a3820' : '#fbf6ea'} stroke={INK} strokeWidth={0.9} />
      {full && <ellipse cx={-1.2} cy={-6.2} rx={1.3} ry={0.35} fill="#c98a4b" opacity={0.7} />}
    </g>
  );
}

function Saucer({ x, y }: { x: number; y: number }) {
  return (
    <g strokeLinejoin="round">
      <path d={`M${x - 8.5} ${y} Q ${x} ${y + 4.6} ${x + 8.5} ${y}`} fill="#efe4cc" stroke={INK} strokeWidth={1} />
      <ellipse cx={x} cy={y} rx={8.5} ry={2.1} fill="#fbf6ea" stroke={INK} strokeWidth={1.1} />
      <ellipse cx={x} cy={y - 0.1} rx={4.6} ry={1} fill="none" stroke="#c9553a" strokeWidth={0.6} opacity={0.7} />
    </g>
  );
}

/** Position de la tasse (fond) et inclinaison à l'image f. */
function cupAt(p: PropArgs): { o: Pt; tilt: number } {
  const { frame: f, rig: r, mouth } = p;
  if (sipping(f)) {
    // le bord gauche de la tasse vient juste sous la lèvre
    const rim = rot([-4.3, -6], TILT);
    return { o: [mouth[0] - 0.4 - rim[0], mouth[1] + 0.4 - rim[1]], tilt: TILT };
  }
  if (halfway(f)) {
    const h = r.arms[1].c;
    return { o: [h[0] - G[0], h[1] - G[1]], tilt: -4 };
  }
  return { o: LOW, tilt: 0 };
}

/** Vapeur : trois filets qui montent en s'enroulant et s'effacent ; quand il souffle, ils se couchent. */
function Steam({ top, frame }: { top: Pt; frame: number }) {
  const blow = blowing(frame);
  return (
    <g fill="none" strokeLinecap="round">
      {[0, 1, 2].map((i) => {
        const age = (frame + i * 2) % 6;
        const x0 = top[0] - 1.6 + i * 1.6;
        const y0 = top[1] - 1.2 - age * 1.6;
        const w = (frame + i) % 2 ? 1 : -1;
        const lean = blow ? 2.4 + age * 0.9 : 0;
        const d = `M${x0} ${y0} C ${x0 + 2 * w + lean * 0.3} ${y0 - 2}, ${x0 - 2 * w + lean * 0.6} ${y0 - 3.6}, ${x0 + lean * 0.8} ${y0 - 5.4} S ${x0 + 1.6 * w + lean} ${y0 - 8}, ${x0 - 0.6 * w + lean * 1.2} ${y0 - 9.4}`;
        const o = 0.5 - age * 0.07;
        return (
          <g key={i}>
            <path d={d} stroke="#fffaf0" strokeWidth={2} opacity={o * 0.6} />
            <path d={d} stroke="#8a847b" strokeWidth={0.8} opacity={o} />
          </g>
        );
      })}
    </g>
  );
}

export const pose: PoseDef = {
  seated: true,
  fps: 3.5,
  rig,
  mid: (p) => {
    const { o, tilt } = cupAt(p);
    return (
      <g>
        <Saucer x={LOW[0]} y={LOW[1] + 0.4} />
        <Cup o={o} tilt={tilt} />
      </g>
    );
  },
  over: (p) => {
    if (sipping(p.frame)) return null;
    const { o, tilt } = cupAt(p);
    const top = rot([0, -6], tilt);
    return <Steam top={[o[0] + top[0], o[1] + top[1]]} frame={p.frame} />;
  },
  eyes: (f): EyesKind => (sipping(f) ? 'closed' : phase(f) >= 11 && phase(f) <= 13 ? 'happy' : 'open'),
  mouth: (f): MouthKind => (sipping(f) ? 'flat' : blowing(f) ? 'o' : 'smile'),
};

const r = Math.random;
const sec = (a: number, b: number) => (a + r() * (b - a)) * 1000;

export const activity: ActivityDef = {
  id: 'coffee',
  w: 2,
  acts: () => [
    { pose: 'coffee', ms: sec(4, 6), view: 'front' },
    { pose: 'coffee', ms: sec(5, 8), view: 'front', say: 'act:coffee' },
    { pose: 'coffee', ms: sec(3, 5), view: 'front' },
  ],
  lines: {
    all: [
      'Un petit noir, et le monde redevient lisible.',
      'Je pense, donc je prends un café.',
      'Chaque gorgée est une parenthèse.',
      'Attention, c’est chaud. Comme certaines idées.',
      'Le café, c’est de la lucidité en tasse.',
    ],
    socrate: ['Connais-toi toi-même… mais d’abord, un café.'],
    rousseau: ['Une tisane serait plus naturelle. Enfin…'],
  },
};
