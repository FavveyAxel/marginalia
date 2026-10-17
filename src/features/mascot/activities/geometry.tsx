// Activité « geometry » : À FAIRE (gabarit vide, jamais tirée tant que w = 0).
import type { ActivityDef, PoseDef } from './types';

export const pose: PoseDef = {
  seated: true,
  rig: () => ({
    arms: [
      { a: [21, 54], b: [13, 62], c: [11, 70] },
      { a: [78, 54], b: [86, 62], c: [88, 70] },
    ],
    legs: [
      { a: [42, 64], b: [40, 74], c: [38, 99] },
      { a: [57, 64], b: [59, 74], c: [64, 96] },
    ],
    lift: 0,
    gaze: [0, 0],
    feet: 'hang',
  }),
};

export const activity: ActivityDef = { id: 'geometry', w: 0, acts: () => [{ pose: 'geometry', ms: 6000, view: 'front' }] };
