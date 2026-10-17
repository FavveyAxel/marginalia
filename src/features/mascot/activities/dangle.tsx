// Pendu à la souris : on l'attrape pour le déposer ailleurs. Il gigote, bras en l'air, jambes qui
// battent, une grimace et une goutte de sueur. Pose seulement (jamais tirée au hasard : w = 0).
import type { ActivityDef, PoseDef, Pt } from './types';

const INK = '#231b11';

export const pose: PoseDef = {
  seated: false,
  fps: 8,
  rig: (f) => {
    const k = f % 4;
    // Tenu par le haut de la tête : bras ballants qui gigotent un peu, jambes qui pédalent dans le vide.
    const armL: Pt = [[10, 88], [7, 84], [11, 90], [8, 86]][k] as Pt;
    const armR: Pt = [[89, 86], [92, 90], [88, 84], [91, 88]][k] as Pt;
    const legL: Pt = [[36, 118], [32, 112], [38, 120], [34, 110]][k] as Pt;
    const legR: Pt = [[63, 110], [66, 119], [61, 112], [68, 118]][k] as Pt;
    return {
      arms: [
        { a: [21, 54], b: [k % 2 ? 11 : 13, 71], c: armL },
        { a: [78, 54], b: [k % 2 ? 88 : 86, 71], c: armR },
      ],
      legs: [
        { a: [42, 64], b: [k % 2 ? 36 : 40, 92], c: legL },
        { a: [57, 64], b: [k % 2 ? 61 : 63, 92], c: legR },
      ],
      lift: 0,
      gaze: [k < 2 ? -1.2 : 1.2, 1.6],
      feet: 'stand',
    };
  },
  freeHands: true,
  eyes: (f) => (f % 6 < 2 ? 'closed' : 'open'),
  mouth: (f) => (f % 6 < 3 ? 'o' : 'flat'),
  // goutte de sueur et petits traits d'agitation
  over: ({ frame }) => {
    const k = frame % 4;
    return (
      <g>
        <path d={`M${74 + (k % 2)} ${14 + k} q 3 5 0 7 q -3 -2 0 -7 Z`} fill="#bfe3f2" stroke={INK} strokeWidth={0.9} strokeLinejoin="round" />
        <g stroke={INK} strokeWidth={1.2} strokeLinecap="round" opacity={0.55}>
          <path d={k % 2 ? 'M2 34 l-5 -2 M3 40 l-6 1' : 'M2 36 l-6 -1 M4 42 l-5 2'} />
          <path d={k % 2 ? 'M97 34 l5 -2 M96 40 l6 1' : 'M96 36 l6 -1 M95 42 l5 2'} />
        </g>
      </g>
    );
  },
};

export const activity: ActivityDef = {
  id: 'dangle',
  w: 0,
  acts: () => [],
  lines: {
    all: [
      'Hé ! Préviens avant de me déménager.',
      'Ouf, la terre ferme. Enfin, le bord ferme.',
      'J’ai le vertige des idées hautes.',
      'Il fallait juste demander, je serais venu à pied.',
      'Bon. Ici, la vue est différente. Pourquoi pas.',
      'Transporté sans mon consentement. Kant aurait des choses à dire.',
      'Atterrissage réussi. Ou presque.',
    ],
    socrate: ['On ne m’avait jamais déplacé ainsi, même à Athènes.', 'Sais-tu seulement pourquoi tu m’as posé ici ?'],
    platon: ['Me voilà sorti de la caverne… par la peau du cou.'],
    aristote: ['Le mouvement suppose un moteur. Ce matin, c’est toi.'],
    rousseau: ['L’homme est né libre, et partout on le transporte.'],
  },
};
