// Activité « question » (Socrate) : la maïeutique. Debout, penché vers son interlocuteur, il lève
// l'index comme pour poser une question, l'autre main sur la hanche ; un grand « ? » tracé à l'encre
// flotte au-dessus de sa tête (et de petits « ? » surgissent). Puis un temps de réflexion : la main
// lisse la barbe, bouche neutre, le regard en l'air. Cycle de 18 images à 3 images/s.
import type { ActivityDef, Limb, PoseDef, PropArgs, Pt, Rig } from './types';

const INK = '#231b11';
const PAPER = '#fffaf0';
const SKIN: Record<string, string> = { socrate: '#f1d3b8', platon: '#f0d0b2', aristote: '#eecdaf', rousseau: '#f2d4bb', brain: '#f1d3b8' };

const CYCLE = 18;
/** Images où il pose la question (index levé) ; le reste : il réfléchit, la main à la barbe. */
const ASK_END = 11;
const asking = (f: number) => f % CYCLE < ASK_END;

const LEGS: [Limb, Limb] = [
  { a: [42, 64], b: [41, 94], c: [40, 121] },
  { a: [57, 64], b: [58, 94], c: [59, 121] },
];
/** Main gauche (à l'écran) posée sur la hanche, coude en dehors. */
const HIP: Limb = { a: [21, 54], b: [22, 62], c: [36, 71] };

function rig(f: number): Rig {
  const c = f % CYCLE;
  if (c < ASK_END) {
    // Il lève l'index (montée en deux images), puis l'agite doucement en parlant.
    const wag = c >= 2 && c % 2 ? 1.2 : 0;
    const hand: Pt = c === 0 ? [78, 46] : c === 1 ? [81, 31] : [82.5 + wag, 23];
    return {
      arms: [HIP, { a: [78, 54], b: c === 0 ? [80, 58] : [79, 44], c: hand }],
      legs: LEGS,
      lift: c % 4 === 3 ? -0.6 : 0,
      gaze: [1.2, -0.4],
      feet: 'stand',
    };
  }
  // Réflexion : la main droite (à l'écran) au menton, dans la barbe ; regard vers le haut.
  return {
    arms: [HIP, { a: [78, 54], b: [72, 56], c: [55, 61 + (c % 2 ? 0.8 : 0)] }],
    legs: LEGS,
    lift: 0,
    gaze: [-1.3, -1.8],
    feet: 'stand',
    faceHand: 1,
  };
}

/** Point d'interrogation manuscrit, cerné de papier pour rester lisible sur la tête. */
function QMark({ x, y, s, o = 1, rot = 0 }: { x: number; y: number; s: number; o?: number; rot?: number }) {
  const d = 'M-3.3 -3.4 C -3.6 -7.9, 3.8 -8.4, 3.5 -3.9 C 3.3 -1.1, 0.1 -0.9, 0.2 2.6';
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`} opacity={o} strokeLinecap="round" strokeLinejoin="round" fill="none">
      <path d={d} stroke={PAPER} strokeWidth={4} opacity={0.85} />
      <circle cx={0.25} cy={5.6} r={1.9} fill={PAPER} opacity={0.85} />
      <path d={d} stroke={INK} strokeWidth={1.8} />
      <circle cx={0.25} cy={5.6} r={1.15} fill={INK} />
    </g>
  );
}

function over({ frame, rig: r, char }: PropArgs) {
  const c = frame % CYCLE;
  const out = [];
  if (c < ASK_END) {
    // L'index dressé, au-dessus du poing.
    const [hx, hy] = r.arms[1].c;
    const skin = SKIN[char] ?? SKIN.socrate;
    if (c >= 1)
      out.push(
        <g key="finger" strokeLinecap="round" fill="none">
          <path d={`M${hx - 0.6} ${hy - 1.5} L${hx - 0.9} ${hy - 7.2}`} stroke="currentColor" strokeWidth={3.5} />
          <path d={`M${hx - 0.6} ${hy - 1.5} L${hx - 0.9} ${hy - 7.2}`} stroke={skin} strokeWidth={1.6} />
        </g>,
      );
    // Le grand « ? » : il apparaît, puis flotte en battant doucement.
    if (c >= 2) {
      const bob = [0, -1.2, -1.8, -1.2][c % 4];
      const pulse = c === 2 ? 0.75 : 1 + (c % 2 ? 0.05 : 0);
      out.push(<QMark key="q" x={64} y={-12 + bob} s={1.25 * pulse} rot={8} />);
    }
    // De petits « ? » qui surgissent et s'effacent.
    if (c === 5 || c === 6) out.push(<QMark key="q2" x={80} y={-4 - (c - 5) * 3} s={0.6} o={c === 5 ? 1 : 0.55} rot={14} />);
    if (c === 8 || c === 9) out.push(<QMark key="q3" x={45} y={-13 - (c - 8) * 3} s={0.55} o={c === 8 ? 1 : 0.55} rot={-10} />);
  } else {
    // Bulles de pensée, et le « ? » qui pâlit, en suspens.
    const k = c - ASK_END;
    out.push(<QMark key="q" x={64} y={-13} s={1.1} o={0.35} rot={8} />);
    out.push(
      <g key="dots" fill="currentColor" opacity={0.7}>
        {[0, 1, 2].slice(0, Math.min(3, (k % 4) + 1)).map((i) => (
          <circle key={i} cx={74 + i * 5} cy={6 - i * 3} r={1.4 + i * 0.4} />
        ))}
      </g>,
    );
  }
  return <g>{out}</g>;
}

export const pose: PoseDef = {
  seated: false,
  fps: 3,
  rig,
  over,
  eyes: (f) => (f % CYCLE === CYCLE - 1 ? 'happy' : 'open'),
  mouth: (f) => {
    const c = f % CYCLE;
    if (!asking(f)) return 'flat';
    return c >= 2 && c % 3 === 0 ? 'o' : c >= 2 ? 'smirk' : 'smile';
  },
};

export const activity: ActivityDef = {
  id: 'question',
  w: 2,
  chars: ['socrate'],
  acts: () => [
    { pose: 'question', ms: 3500, view: 'front' },
    { pose: 'question', ms: 6000, view: 'front', say: 'act:question' },
    { pose: 'question', ms: 4500, view: 'front' },
  ],
  lines: {
    socrate: [
      'Et toi, qu’entends-tu au juste par « savoir » ?',
      'Je ne sais qu’une chose : que je ne sais rien.',
      'Une question de plus, et la réponse viendra d’elle-même.',
      'Je n’enseigne rien : j’aide les idées à naître.',
      'Une vie sans examen vaut-elle d’être vécue ?',
      'Définissons d’abord les mots, veux-tu ?',
    ],
  },
};
