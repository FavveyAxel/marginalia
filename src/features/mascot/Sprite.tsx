import { useId, type ReactNode } from 'react';
import type { CharacterDef, DrawArgs } from './characters/types';

// Le compagnon : un petit cerveau sur pattes, dessiné à l'encre. Trois vues : de face, de profil (il
// marche de profil, peut s'asseoir de profil, jambes allongées sur l'encadré) et de dos (il s'en va,
// ou s'assoit face au contenu). Repère : viewBox 100 × 130. Debout, les pieds touchent y = 124 ;
// assis de face ou de dos, l'assise est à y = 70 (les jambes pendent devant) ; assis de profil, à y = 64.
// Musculature (0 à 4, selon le nombre de documents) : membres plus épais, biceps et mollets, cerveau
// un peu plus gros, puis veines rouges en relief et, aux niveaux 3 et 4, une veine qui bat.
// Les sillons ont un léger ombrage (creux) et un reflet (bord), pour que le cerveau se lise en volume.

export type Pose =
  | 'stand'
  | 'look'
  | 'walk'
  | 'jump'
  | 'sit'
  | 'read'
  | 'think'
  | 'wave'
  | 'sitwave'
  | 'doze'
  | 'flex'
  | 'puff'
  | 'guitar'
  | 'whistle'
  | 'write'
  | 'cigar';
export type View = 'front' | 'side' | 'back';
export type Level = 0 | 1 | 2 | 3 | 4;

const SEATED = new Set<Pose>(['sit', 'read', 'think', 'doze', 'sitwave', 'guitar', 'write', 'cigar']);
export const isSeated = (p: Pose) => SEATED.has(p);
/** Vue réellement dessinée : saluer et faire le costaud se font toujours de face, marcher de profil. */
export function viewFor(p: Pose, v: View): View {
  if (p === 'wave' || p === 'flex' || p === 'sitwave' || p === 'look') return 'front';
  if (p === 'jump') return v === 'back' ? 'front' : v;
  if (p === 'walk') return v === 'back' ? 'back' : 'side';
  if (v === 'back' && (p === 'read' || p === 'think' || p === 'guitar' || p === 'whistle' || p === 'write' || p === 'cigar')) return 'front';
  return v;
}
/** Ligne d'appui (unités du viewBox) : sol pour les poses debout, bord de l'encadré pour les poses assises. */
export const anchorOf = (p: Pose, v: View = 'front') => (isSeated(p) ? (viewFor(p, v) === 'side' ? 64 : 70) : 124);
export const VB_W = 100;
export const VB_H = 130;

type Pt = [number, number];
type Limb = { a: Pt; b: Pt; c: Pt };
type Rig = {
  arms: [Limb, Limb];
  legs: [Limb, Limb];
  lift: number;
  gaze: Pt;
  feet: 'stand' | 'hang' | 'flat' | 'none';
  /** Bras passés derrière le cerveau (mains dans le dos, de face). */
  armsBehind?: boolean;
  /** Main posée au visage (cigare aux lèvres) : elle suit le grossissement du cerveau. */
  faceHand?: 0 | 1;
};

// ── Accessoires : repères partagés entre le squelette (où vont les mains) et le dessin ──
type GT = { x: number; y: number; r: number; sx: number; sy: number };
/** Guitare de face : caisse sur les genoux, manche vers le haut à gauche. */
const G_FRONT: GT = { x: 61, y: 68, r: 25, sx: 1.08, sy: 1.08 };
/** Guitare de profil (repère du cerveau, avant levée de 8) : tenue devant lui, manche vers l'avant et le haut. */
const G_SIDE: GT = { x: 62, y: 64, r: -24, sx: -0.95, sy: 0.85 };
function gPt(t: GT, lx: number, ly: number): Pt {
  const x = lx * t.sx;
  const y = ly * t.sy;
  const a = (t.r * Math.PI) / 180;
  return [t.x + x * Math.cos(a) - y * Math.sin(a), t.y + x * Math.sin(a) + y * Math.cos(a)];
}
/** Écriture : nombre de lignes écrites sur la page de droite selon l'image (cycle de 8, la dernière tourne la page). */
const WRITE_LINES = [0, 1, 1, 2, 3, 3, 4, 4];
const writeRowY = (i: number, x: number) => 63 + i * 1.7 - (x - 50) * 0.16;
/** Pointe de la plume, de face. */
function writeNib(f: number): Pt {
  const c = f % 8;
  if (c === 7) return [62, 57];
  const x = 54 + (c % 2 ? 7 : 3);
  return [x, writeRowY(Math.min(WRITE_LINES[c], 4), x) - 0.3];
}
/** Plume de profil (repère du cerveau). */
const writeNibSide = (f: number): Pt => (f % 8 === 7 ? [74, 56] : [71 + (f % 2) * 3, 61.7 - (f % 2) * 1.1]);
/** Cigare : aux lèvres les 4 premières images d'un cycle de 12, puis il redescend et souffle des ronds. */
const CIGAR_CYCLE = 12;
const cigarUp = (f: number) => f % CIGAR_CYCLE < 4;

const W_LIMB = [3.2, 3.8, 4.5, 5.3, 6.2];
// Philosophes : tête réduite (facteur, point fixe en haut du crâne), épaules sur le torse.
const HEAD_K = 0.64;
const HEAD_PIVOT_FRONT: Pt = [49, 4];
const HEAD_PIVOT_SIDE: Pt = [52, 2];
const CH_SHOULDERS_FRONT: [Pt, Pt] = [[37, 47], [61, 47]];
const CH_SHOULDERS_SIDE: [Pt, Pt] = [[47, 47], [52, 47]];
const BICEP = [0, 2.6, 3.6, 4.6, 5.8];
const CALF = [0, 1.6, 2.3, 3, 3.8];
/** Le cerveau lui-même grossit avec le niveau. */
const BRAIN_K = [1, 1.05, 1.1, 1.16, 1.23];
const FILL = ['#f3d7c8', '#f2d0c0', '#f0c8b6', '#eec0ac', '#ecb6a0'];
const INK = '#231b11';
const VEIN = '#a3354b';
const VEIN_HI = '#f6c3c0';

// ── Poses de face (et de dos) ──────────────────────────────

function rigFront(pose: Pose, f: number): Rig {
  const standLegs: [Limb, Limb] = [
    { a: [42, 64], b: [41, 94], c: [40, 121] },
    { a: [57, 64], b: [58, 94], c: [59, 121] },
  ];
  const restArms: [Limb, Limb] = [
    { a: [21, 54], b: [15, 72], c: [15, 89] },
    { a: [78, 54], b: [84, 72], c: [84, 89] },
  ];
  const sitLegs = (k: number): [Limb, Limb] => [
    { a: [42, 64], b: [40, 74], c: k ? [36, 96] : [38, 99] },
    { a: [57, 64], b: [59, 74], c: k ? [61, 99] : [64, 96] },
  ];
  const edgeArms: [Limb, Limb] = [
    { a: [21, 54], b: [13, 62], c: [11, 70] },
    { a: [78, 54], b: [86, 62], c: [88, 70] },
  ];
  switch (pose) {
    case 'walk': // de dos : il s'éloigne en se dandinant
      return {
        arms: Math.floor(f / 2) % 2 ? [{ a: [21, 54], b: [16, 71], c: [18, 87] }, { a: [78, 54], b: [85, 71], c: [86, 85] }] : [{ a: [21, 54], b: [14, 71], c: [13, 85] }, { a: [78, 54], b: [83, 71], c: [81, 87] }],
        legs: Math.floor(f / 2) % 2 ? [{ a: [42, 64], b: [42, 92], c: [42, 121] }, { a: [57, 64], b: [59, 90], c: [58, 116] }] : [{ a: [42, 64], b: [40, 90], c: [41, 116] }, { a: [57, 64], b: [57, 92], c: [57, 121] }],
        lift: f % 2 ? -1 : 0,
        gaze: [0, 0],
        feet: 'stand',
      };
    case 'look': // il regarde autour de lui
      return { arms: restArms, legs: standLegs, lift: f % 2 ? -0.6 : 0, gaze: [[-2, 0], [-2, 0], [0, -0.6], [2, 0], [2, 0], [0, 0.4]][f % 6] as Pt, feet: 'stand' };
    case 'jump': // en l'air : jambes repliées, bras levés
      return {
        arms: [
          { a: [21, 54], b: [10, 42], c: [12, 28] },
          { a: [78, 54], b: [89, 42], c: [87, 28] },
        ],
        legs: [
          { a: [42, 64], b: [32, 80], c: [39, 93] },
          { a: [57, 64], b: [67, 80], c: [60, 93] },
        ],
        lift: 0,
        gaze: [0, -1],
        feet: 'stand',
      };
    case 'wave':
      return { arms: [restArms[0], { a: [78, 54], b: [90, 44], c: f % 2 ? [94, 27] : [86, 25] }], legs: standLegs, lift: 0, gaze: [0, 0], feet: 'stand' };
    case 'flex':
      return {
        arms: [
          { a: [21, 54], b: [6, 52], c: f % 2 ? [10, 34] : [12, 36] },
          { a: [78, 54], b: [93, 52], c: f % 2 ? [89, 34] : [87, 36] },
        ],
        legs: [
          { a: [42, 64], b: [37, 94], c: [33, 121] },
          { a: [57, 64], b: [62, 94], c: [66, 121] },
        ],
        lift: f % 2 ? -1 : 0,
        gaze: [0, -0.6],
        feet: 'stand',
      };
    case 'sit':
      return { arms: edgeArms, legs: sitLegs(f % 2), lift: 0, gaze: [f % 6 < 3 ? -0.8 : 0.8, 0.6], feet: 'hang' };
    case 'read':
      return {
        arms: [
          { a: [21, 54], b: [22, 68], c: [37, 64] },
          { a: [78, 54], b: [77, 68], c: [62, 64] },
        ],
        legs: sitLegs(Math.floor(f / 2) % 2),
        lift: 0,
        gaze: [f % 10 < 5 ? -1.2 : 1.2, 1.8],
        feet: 'hang',
      };
    case 'think':
      return { arms: [edgeArms[0], { a: [78, 54], b: [86, 64], c: [65, 59] }], legs: sitLegs(Math.floor(f / 3) % 2), lift: 0, gaze: [-1.4, -2], feet: 'hang' };
    case 'sitwave': // coucou, assis
      return { arms: [edgeArms[0], { a: [78, 54], b: [91, 46], c: f % 2 ? [95, 29] : [87, 27] }], legs: sitLegs(f % 2), lift: 0, gaze: [0, 0.4], feet: 'hang' };
    case 'doze':
      return { arms: edgeArms, legs: sitLegs(0), lift: f % 4 < 2 ? 0 : 0.6, gaze: [0, 0], feet: 'hang' };
    case 'guitar': {
      // gratte à chaque image, la main gauche tient le manche, un pied bat la mesure
      const strum = f % 2;
      const tap = Math.floor(f / 2) % 2;
      return {
        arms: [
          { a: [21, 54], b: [11, 65], c: gPt(G_FRONT, -37, 0.4) },
          { a: [78, 54], b: [84, 70], c: gPt(G_FRONT, strum ? 0 : 5, strum ? -6.5 : 3.5) },
        ],
        legs: [
          { a: [42, 64], b: [40, 74], c: [38, 99] },
          { a: [57, 64], b: [60, 74], c: tap ? [66, 93] : [64, 97] },
        ],
        lift: 0,
        gaze: [0.6, 1.2],
        feet: 'hang',
      };
    }
    case 'whistle': // il sifflote, les mains dans le dos
      return {
        arms: [
          { a: [21, 54], b: [11, 67], c: [27, 59] },
          { a: [78, 54], b: [88, 67], c: [72, 59] },
        ],
        legs: f % 2 ? [standLegs[0], { a: [57, 64], b: [59, 93], c: [59, 120] }] : standLegs,
        lift: f % 2 ? -0.9 : 0,
        gaze: [1, -1.4],
        feet: 'stand',
        armsBehind: true,
      };
    case 'write': {
      const nib = writeNib(f);
      return {
        arms: [
          { a: [21, 54], b: [22, 70], c: [36, 68] },
          { a: [78, 54], b: [84, 70], c: [nib[0] + 1.8, nib[1] - 2.6] },
        ],
        legs: sitLegs(0),
        lift: 0,
        gaze: [0.8, 2.2],
        feet: 'hang',
      };
    }
    case 'cigar': {
      const up = cigarUp(f);
      return {
        arms: [edgeArms[0], up ? { a: [78, 54], b: [87, 67], c: [57.5, 53.6] } : { a: [78, 54], b: [89, 63], c: [80, 68] }],
        legs: sitLegs(Math.floor(f / 6) % 2),
        lift: 0,
        gaze: [-1.2, 0.9],
        feet: 'hang',
        faceHand: up ? 1 : undefined,
      };
    }
    default:
      return { arms: restArms, legs: standLegs, lift: f % 2 ? -0.8 : 0, gaze: [0, 0], feet: 'stand' };
  }
}

// ── Poses de profil (regard vers la droite ; la vue est retournée pour aller à gauche) ──
// arms[0] / legs[0] : côté éloigné (dessinés derrière) ; arms[1] / legs[1] : côté proche.

function rigSide(pose: Pose, f: number): Rig {
  const hip: Pt = [50, 58];
  const sh: Pt = [50, 51];
  const shFar: Pt = [46, 51];
  if (pose === 'walk') {
    // Cycle de marche en 8 images : chaque pied décrit une ellipse (en avant levé, en arrière posé),
    // les bras balancent à l'opposé, le corps monte au passage des pieds.
    const ph = (f % 8) / 8;
    const leg = (p: number): Limb => {
      const s = Math.sin(2 * Math.PI * p);
      const c = Math.cos(2 * Math.PI * p);
      const up = Math.max(0, c);
      const fx = 50 + 13 * s;
      const fy = 121 - 6 * up;
      return { a: hip, b: [(50 + fx) / 2 + 3 + 4 * up, 90 - 4 * up], c: [fx, fy] };
    };
    const arm = (p: number, a: Pt): Limb => {
      const s = Math.sin(2 * Math.PI * p);
      return { a, b: [a[0] - 4 * s, 70], c: [50 - 12 * s, 86 - Math.abs(s) * 2] };
    };
    const near = ph;
    const far = (ph + 0.5) % 1;
    return {
      legs: [leg(far), leg(near)],
      arms: [arm(near, shFar), arm(far, sh)],
      lift: -1.6 * (1 - Math.abs(Math.sin(2 * Math.PI * ph))),
      gaze: [1, 0],
      feet: 'stand',
    };
  }
  if (pose === 'jump') {
    return {
      legs: [
        { a: hip, b: [41, 74], c: [39, 90] },
        { a: hip, b: [63, 72], c: [61, 88] },
      ],
      arms: [
        { a: shFar, b: [58, 44], c: [69, 33] },
        { a: sh, b: [62, 46], c: [74, 36] },
      ],
      lift: 0,
      gaze: [1.2, -0.8],
      feet: 'stand',
    };
  }
  if (isSeated(pose)) {
    // Assis de profil sur l'encadré (bord à y = 64) : le cerveau remonte de 8 pour laisser voir les
    // jambes allongées devant lui. Les bras, dans le même groupe, sont décalés d'autant vers le bas.
    const L = 8;
    const kick = (pose === 'sit' && f % 2) || ((pose === 'read' || pose === 'guitar') && Math.floor(f / 2) % 2) ? -3 : 0;
    const legs: [Limb, Limb] = [
      { a: [46, 56], b: [52, 64], c: [79, 62] },
      { a: [52, 56], b: [58, 64 + kick / 3], c: [87, 62 + kick] },
    ];
    const restArms: [Limb, Limb] = [
      { a: shFar, b: [40, 56 + L], c: [34, 63 + L] },
      { a: sh, b: [44, 57 + L], c: [38, 63 + L] },
    ];
    const lift = -L + (pose === 'doze' && f % 4 >= 2 ? 0.6 : 0);
    if (pose === 'read')
      return {
        legs,
        arms: [
          { a: shFar, b: [56, 58], c: [71, 50] },
          { a: sh, b: [60, 60], c: [74, 52] },
        ],
        lift: -L,
        gaze: [0.6, 1.8],
        feet: 'flat',
      };
    if (pose === 'think') return { legs, arms: [restArms[0], { a: sh, b: [66, 60], c: [80, 50] }], lift: -L, gaze: [0.4, -2], feet: 'flat' };
    if (pose === 'guitar') {
      const strum = f % 2;
      return {
        legs,
        arms: [
          { a: shFar, b: [64, 66], c: gPt(G_SIDE, -38, 0) },
          { a: sh, b: [50, 68], c: gPt(G_SIDE, strum ? 0 : 5, strum ? -6.5 : 3.5) },
        ],
        lift: -L,
        gaze: [1, 0.8],
        feet: 'flat',
      };
    }
    if (pose === 'write') {
      const nib = writeNibSide(f);
      return {
        legs,
        arms: [
          { a: shFar, b: [54, 64], c: [63, 63] },
          { a: sh, b: [58, 68], c: [nib[0] + 1.6, nib[1] - 2.2] },
        ],
        lift: -L,
        gaze: [0.6, 2],
        feet: 'flat',
      };
    }
    if (pose === 'cigar') {
      const up = cigarUp(f);
      return {
        legs,
        arms: [restArms[0], up ? { a: sh, b: [68, 66], c: [91.5, 43.4] } : { a: sh, b: [54, 68], c: [71, 62] }],
        lift: -L,
        gaze: [0.6, 0.9],
        feet: 'flat',
        faceHand: up ? 1 : undefined,
      };
    }
    return { legs, arms: restArms, lift, gaze: [1, 0.4], feet: 'flat' };
  }
  if (pose === 'whistle') {
    // mains croisées dans le dos (à gauche : il regarde vers la droite), léger balancement
    return {
      legs: [
        { a: hip, b: [47, 90], c: [46, 121] },
        { a: hip, b: [52, 90], c: f % 2 ? [54, 120] : [53, 121] },
      ],
      arms: [
        { a: shFar, b: [42, 68], c: [32, 63] },
        { a: sh, b: [44, 70], c: [34, 65] },
      ],
      lift: f % 2 ? -0.9 : 0,
      gaze: [0.8, -1.4],
      feet: 'stand',
    };
  }
  return {
    legs: [
      { a: hip, b: [47, 90], c: [46, 121] },
      { a: hip, b: [52, 90], c: [53, 121] },
    ],
    arms: [
      { a: shFar, b: [46, 70], c: [46, 87] },
      { a: sh, b: [52, 70], c: [52, 88] },
    ],
    lift: f % 2 ? -0.8 : 0,
    gaze: [1, 0],
    feet: 'stand',
  };
}

const path = (l: Limb) => `M${l.a[0]} ${l.a[1]} Q${l.b[0]} ${l.b[1]} ${l.c[0]} ${l.c[1]}`;
const mid = (p: Pt, q: Pt, t = 0.5): Pt => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const angle = (p: Pt, q: Pt) => (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;

function Bulge({ p, q, r, t = 0.45 }: { p: Pt; q: Pt; r: number; t?: number }) {
  if (!r) return null;
  const [x, y] = mid(p, q, t);
  return <ellipse cx={x} cy={y} rx={r * 1.7} ry={r} transform={`rotate(${angle(p, q)} ${x} ${y})`} fill="currentColor" />;
}

// ── Cerveau ─────────────────────────────────────────────────
// Face et dos : dessinés dans le repère du croquis d'origine (≈ 116..508 × 96..420), échelle 0,19.
const BRAIN =
  'M138 300 C 108 270, 116 214, 156 196 C 158 150, 204 122, 246 134 C 266 100, 324 96, 348 122 C 386 104, 440 122, 448 164 C 490 172, 508 220, 490 254 C 516 284, 506 336, 468 350 C 462 388, 424 408, 388 396 C 370 418, 336 420, 316 404 C 300 418, 264 420, 246 402 C 210 412, 168 394, 164 360 C 136 356, 124 324, 138 300 Z';
const SULCI_FRONT = [
  'M312 104 C 302 136, 324 158, 306 188 C 294 208, 314 224, 304 246',
  'M268 122 C 258 140, 280 150, 270 170',
  'M176 192 C 192 176, 214 186, 206 206 C 200 222, 222 230, 238 220',
  'M140 266 C 158 254, 176 268, 170 286',
  'M182 356 C 198 342, 216 356, 234 346',
  'M356 122 C 366 140, 344 150, 354 170',
  'M448 192 C 432 176, 410 186, 418 206 C 424 222, 402 230, 386 220',
  'M484 266 C 466 254, 448 268, 454 286',
  'M442 356 C 426 342, 408 356, 390 346',
];
const SULCI_BACK = [
  'M312 100 C 302 150, 322 210, 306 280 C 298 330, 316 370, 312 410',
  'M244 146 C 232 176, 258 192, 244 224',
  'M380 146 C 392 176, 366 192, 380 224',
  'M168 252 C 192 240, 206 264, 232 254',
  'M456 252 C 432 240, 418 264, 392 254',
  'M196 340 C 216 326, 236 344, 260 334',
  'M428 340 C 408 326, 388 344, 364 334',
];
const VEINS_FRONT: { d: string; from: Level }[] = [
  { d: 'M170 252 C 184 236, 200 252, 214 236 C 226 222, 244 232, 252 218', from: 2 },
  { d: 'M372 196 C 388 210, 404 196, 420 212 C 432 224, 450 218, 462 232', from: 2 },
  { d: 'M136 330 C 152 336, 158 352, 176 352', from: 3 },
  { d: 'M486 290 C 470 306, 484 320, 470 336', from: 3 },
  { d: 'M236 150 C 246 168, 264 168, 270 186 C 274 196, 286 196, 292 206', from: 4 },
  { d: 'M330 140 C 344 156, 362 150, 372 168', from: 4 },
];
const VEINS_BACK: { d: string; from: Level }[] = [
  { d: 'M196 200 C 210 186, 226 200, 240 186', from: 2 },
  { d: 'M428 200 C 414 186, 398 200, 384 186', from: 2 },
  { d: 'M150 300 C 170 310, 186 296, 206 306', from: 3 },
  { d: 'M474 300 C 454 310, 438 296, 418 306', from: 3 },
  { d: 'M262 130 C 270 150, 286 150, 290 170', from: 4 },
  { d: 'M240 380 C 256 368, 272 382, 288 372', from: 4 },
];
// Veine du front, en Y, qui bat (niveaux 3 et 4).
const FOREHEAD = 'M306 236 C 302 222, 310 210, 304 196 M304 214 C 294 206, 288 194, 292 182 M306 222 C 318 214, 322 202, 320 190';

// Profil : directement en unités du viewBox (avant du cerveau à droite).
const BRAIN_SIDE = 'M16 38 C 12 24, 22 10, 38 8 C 52 2, 70 4, 80 12 C 90 18, 94 30, 90 40 C 92 48, 86 56, 76 56 C 70 62, 58 62, 52 56 C 46 60, 36 58, 32 54 C 24 56, 16 50, 16 38 Z';
const CEREBELLUM = 'M22 48 C 16 58, 28 66, 40 58 C 38 54, 32 50, 22 48 Z';
const SULCI_SIDE = ['M54 9 C 50 19, 58 27, 52 38', 'M42 49 C 50 45, 60 47, 70 43', 'M30 17 C 36 23, 29 30, 37 35', 'M70 13 C 65 21, 74 25, 69 32'];
const VEINS_SIDE: { d: string; from: Level }[] = [
  { d: 'M24 28 C 30 23, 35 31, 42 25', from: 2 },
  { d: 'M59 17 C 64 23, 70 17, 76 23', from: 2 },
  { d: 'M19 40 C 23 44, 22 48, 28 50', from: 3 },
  { d: 'M44 13 C 48 19, 44 25, 49 30', from: 4 },
  { d: 'M60 50 C 64 54, 70 51, 75 53', from: 4 },
];
const FOREHEAD_SIDE = 'M85 26 C 83 21, 87 17, 85 12 M85 19 C 81 17, 81 13, 83 10';

/** Sillons : un creux ombré sous le trait d'encre, un reflet clair au-dessus. */
function Grooves({ list, ink, shade, hi }: { list: string[]; ink: number; shade: number; hi: number }) {
  return (
    <g fill="none" strokeLinecap="round">
      <g stroke="#9c5a48" strokeWidth={shade} opacity={0.2} transform={`translate(${shade * 0.12} ${shade * 0.24})`}>
        {list.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g stroke="#fff3ea" strokeWidth={hi} opacity={0.75} transform={`translate(${-hi * 0.6} ${-hi * 1.1})`}>
        {list.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g stroke="currentColor" strokeWidth={ink} opacity={0.82}>
        {list.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </g>
  );
}

function Veins({ list, level, w, hi, extra, pulse }: { list: { d: string; from: Level }[]; level: Level; w: number; hi: number; extra?: string; pulse: boolean }) {
  const shown = list.filter((v) => level >= v.from).map((v) => v.d);
  if (extra && level >= 3) shown.push(extra);
  return (
    <g fill="none" strokeLinecap="round">
      {shown.map((d, i) => (
        <g key={i}>
          <path d={d} stroke={VEIN} strokeWidth={d === extra && pulse ? w * 1.35 : level >= 4 ? w * 1.15 : w} />
          <path d={d} stroke={VEIN_HI} strokeWidth={hi} opacity={0.9} transform={`translate(${-hi * 0.55} ${-hi * 0.85})`} />
        </g>
      ))}
    </g>
  );
}

// ── Sprite ──────────────────────────────────────────────────

export function Sprite({
  pose,
  frame,
  level,
  view = 'front',
  facing = 1,
  title,
  halo,
  blink: blinkProp,
  character,
}: {
  pose: Pose;
  frame: number;
  level: Level;
  view?: View;
  facing?: 1 | -1;
  title?: string;
  halo?: string;
  /** Clignement imposé (l'animation le déclenche) ; à défaut, de temps en temps selon l'image. */
  blink?: boolean;
  /** Un philosophe à la place du cerveau (même corps, mêmes poses ; seul son attribut grandit). */
  character?: CharacterDef;
}) {
  const uid = useId().replace(/:/g, '');
  if (pose === 'puff') return <Puff frame={frame} />;
  const v = viewFor(pose, view);
  const side = v === 'side';
  const r = side ? rigSide(pose, frame) : rigFront(pose, frame);
  const ch = character && character.id !== 'brain' ? character : undefined;
  // Philosophes : la tête ne grossit pas et les membres ne se musclent pas ; c'est leur attribut qui grandit.
  const k = ch ? 1 : BRAIN_K[level];
  const muscle: Level = ch ? 0 : level;
  if (!side) r.arms = r.arms.map((l, i) => ({ ...l, a: [l.a[0] + (i ? 1 : -1) * (k - 1) * 30, l.a[1]] as Pt })) as [Limb, Limb];
  // De dos et assis : les jambes pendent de l'autre côté de l'encadré, on ne les voit pas.
  if (v === 'back' && isSeated(pose)) r.feet = 'none';
  const pivot: Pt = side ? [52, 58] : [49, 63];
  // Philosophes : la tête (dessinée dans le repère du cerveau) est réduite et posée sur un torse.
  const hp: Pt = side ? HEAD_PIVOT_SIDE : HEAD_PIVOT_FRONT;
  /** Point du visage (repère du cerveau) → position réelle (cerveau grossi, ou tête de philosophe réduite). */
  const onFace = (p: Pt): Pt =>
    ch ? [hp[0] + (p[0] - hp[0]) * HEAD_K, hp[1] + (p[1] - hp[1]) * HEAD_K] : [pivot[0] + (p[0] - pivot[0]) * k, pivot[1] + (p[1] - pivot[1]) * k];
  if (ch) {
    // Épaules sur le torse ; la main qui touche le menton (réfléchir) suit le visage.
    const sh = side ? CH_SHOULDERS_SIDE : CH_SHOULDERS_FRONT;
    r.arms = r.arms.map((l, i) => ({ ...l, a: sh[i] })) as [Limb, Limb];
    if (pose === 'think') r.arms[1] = { ...r.arms[1], c: onFace(r.arms[1].c), b: side ? [62, 54] : [70, 54] };
  }
  if (r.faceHand !== undefined) {
    const arm = r.arms[r.faceHand];
    r.arms[r.faceHand] = { ...arm, c: onFace(arm.c) };
  }
  const mouth = onFace(side ? [86, 42.5] : [48, 52]);
  const lw = W_LIMB[muscle];
  const blink = pose === 'doze' || (blinkProp ?? (pose !== 'read' && pose !== 'write' && frame % 17 === 16));
  const pulse = level >= 3 && frame % 2 === 0;
  const fill = ch?.skin ?? FILL[level];
  const flip = side && facing === -1 ? `translate(${VB_W} 0) scale(-1 1)` : undefined;
  const grad = `mascot-vol-${uid}`;
  const fid = `mascot-halo-${uid}`;

  /** Membre plein (philosophes) : contour d'encre, puis la couleur du vêtement ou de la peau. */
  const tubes = (ls: Limb[], width: number, color: string) => (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      {ls.map((l, i) => (
        <path key={'o' + i} d={path(l)} stroke="currentColor" strokeWidth={width + 2.4} />
      ))}
      {ls.map((l, i) => (
        <path key={'i' + i} d={path(l)} stroke={color} strokeWidth={width} />
      ))}
    </g>
  );
  const limbsCh = ch?.limbs;
  const limbs = (ls: Limb[], width: number) =>
    limbsCh ? (width === lw ? tubes(ls, 5, limbsCh.leg) : tubes(ls, 4.4, limbsCh.arm)) : (
    <g fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {ls.map((l, i) => (
        <path key={i} d={path(l)} />
      ))}
    </g>
  );
  const feet = (ls: Limb[]) =>
    ls.map((l, i) => {
      const [x, y] = l.c;
      if (limbsCh) {
        // Pieds chaussés (sandales, souliers), cernés d'encre.
        const sh = { fill: limbsCh.shoe, stroke: 'currentColor', strokeWidth: 1.4 };
        if (r.feet === 'hang') return <ellipse key={i} cx={x + (i ? 1.5 : -1.5)} cy={y + 1.5} rx={4.2} ry={3.4} {...sh} />;
        if (r.feet === 'flat') return <ellipse key={i} cx={x + 1} cy={y - 3} rx={2.9} ry={4.6} {...sh} />;
        if (side) return <ellipse key={i} cx={x + 3.5} cy={y + 0.5} rx={5.8} ry={3} {...sh} />;
        const out = i === 0 ? -1 : 1;
        return <ellipse key={i} cx={x + out * 2.5} cy={y + 0.8} rx={5.2} ry={2.9} {...sh} />;
      }
      if (r.feet === 'hang') return <ellipse key={i} cx={x + (i ? 1.5 : -1.5)} cy={y + 1} rx={3.8} ry={3.2} fill="currentColor" />;
      if (r.feet === 'flat') return <ellipse key={i} cx={x + 1} cy={y - 3} rx={2.6} ry={4.4} fill="currentColor" />;
      if (side) return <ellipse key={i} cx={x + 3.5} cy={y + 0.5} rx={5.6} ry={2.8} fill="currentColor" />;
      const out = i === 0 ? -1 : 1;
      return <path key={i} d={`M${x - (out < 0 ? 8 : 1)} ${y + 3} Q${x + out * 3} ${y - 3} ${x + (out < 0 ? 1 : 8)} ${y + 3} Z`} fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />;
    });
  const hands = (ls: Limb[]) =>
    ls.map((l, i) =>
      limbsCh ? (
        <circle key={i} cx={l.c[0]} cy={l.c[1]} r={2.9} fill={ch?.skin ?? '#f1d3b8'} stroke="currentColor" strokeWidth={1.3} />
      ) : (
        <circle key={i} cx={l.c[0]} cy={l.c[1]} r={2.6 + muscle * 0.25} fill="currentColor" />
      ),
    );
  const biceps = (ls: Limb[]) => ls.map((l, i) => <Bulge key={i} p={l.a} q={l.b} r={BICEP[muscle]} t={0.55} />);
  const calves = (ls: Limb[]) => ls.map((l, i) => <Bulge key={i} p={l.b} q={l.c} r={CALF[muscle]} t={r.feet === 'stand' ? 0.3 : 0.35} />);

  const args: DrawArgs = { view: v, level, frame, pose, seated: isSeated(pose), uid };
  let brain: ReactNode;
  if (ch) {
    brain = ch.head(args);
  } else if (side) {
    brain = (
      <g>
        <path d={CEREBELLUM} fill={fill} stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" />
        <path d="M24 53 C 28 57, 33 57, 37 55" fill="none" stroke="currentColor" strokeWidth={0.9} opacity={0.6} strokeLinecap="round" />
        <path d={BRAIN_SIDE} fill={`url(#${grad})`} stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round" />
        <Grooves list={SULCI_SIDE} ink={1.35} shade={4} hi={1.1} />
        <Veins list={VEINS_SIDE} level={level} w={2} hi={0.7} extra={FOREHEAD_SIDE} pulse={pulse} />
      </g>
    );
  } else {
    const back = v === 'back';
    brain = (
      <g transform="translate(-10 -12.2) scale(0.19)">
        {back && <ellipse cx={312} cy={402} rx={74} ry={30} fill={fill} stroke="currentColor" strokeWidth={12} />}
        <path d={BRAIN} fill={`url(#${grad})`} stroke="currentColor" strokeWidth={13} strokeLinejoin="round" />
        <Grooves list={back ? SULCI_BACK : SULCI_FRONT} ink={7.5} shade={22} hi={6} />
        <Veins list={back ? VEINS_BACK : VEINS_FRONT} level={level} w={11} hi={3.5} extra={back ? undefined : FOREHEAD} pulse={pulse} />
      </g>
    );
  }

  const face = v === 'back' ? null : side ? (
    <SideFace pose={pose} blink={blink} gaze={r.gaze} frame={frame} fill={fill} />
  ) : (
    <FrontFace pose={pose} blink={blink} gaze={r.gaze} frame={frame} fill={fill} />
  );
  const behind = !side && !!r.armsBehind;
  const nearArms = side ? [r.arms[1]] : r.arms;

  return (
    <svg className="mascot-svg" width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ color: INK }} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <defs>
        <filter id={fid} x="-10%" y="-10%" width="120%" height="120%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="1.6" result="d" />
          <feFlood floodColor={halo || 'transparent'} />
          <feComposite in2="d" operator="in" result="h" />
          <feMerge>
            <feMergeNode in="h" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* volume : plus clair en haut à gauche, plus soutenu en bas à droite */}
        <radialGradient id={grad} cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fbe7dc" />
          <stop offset="0.55" stopColor={fill} />
          <stop offset="1" stopColor="#d99f8a" />
        </radialGradient>
      </defs>
      <g transform={flip} filter={halo ? `url(#${fid})` : undefined}>
        {/* jambes, et le bras éloigné (profil), derrière le cerveau */}
        {r.feet !== 'none' && (
          <g>
            {limbs(r.legs, lw)}
            {calves(r.legs)}
            {feet(r.legs)}
          </g>
        )}
        <g transform={`translate(0 ${r.lift})`}>
          {(side || behind) && (
            <g>
              {limbs(behind ? r.arms : [r.arms[0]], lw * 0.92)}
              {biceps(behind ? r.arms : [r.arms[0]])}
              {hands(behind ? r.arms : [r.arms[0]])}
            </g>
          )}
          {ch?.body?.(args)}
          <g transform={ch ? `translate(${hp[0]} ${hp[1]}) scale(${HEAD_K}) translate(${-hp[0]} ${-hp[1]})` : `translate(${pivot[0]} ${pivot[1]}) scale(${k}) translate(${-pivot[0]} ${-pivot[1]})`}>
            {brain}
            {face}
            {ch?.overFace && v !== 'back' && ch.overFace(args)}
          </g>
          {pose === 'guitar' && <Guitar t={side ? G_SIDE : G_FRONT} />}
          {pose === 'guitar' && side && hands([r.arms[0]])}
          {pose === 'write' && (side ? <SideNotebook frame={frame} /> : <Notebook frame={frame} />)}
          {!behind && (
            <g>
              {limbs(nearArms, lw * 0.92)}
              {biceps(nearArms)}
            </g>
          )}
          {pose === 'read' && (side ? <SideBook frame={frame} /> : <Book frame={frame} />)}
          {pose === 'write' && <Quill nib={side ? writeNibSide(frame) : writeNib(frame)} rot={side ? -128 : -42} />}
          {!behind && hands(nearArms)}
          {pose === 'cigar' && !cigarUp(frame) && <LoweredCigar hand={r.arms[1].c} side={side} frame={frame} />}
          {pose === 'guitar' && <GuitarNotes frame={frame} side={side} />}
          {pose === 'whistle' && <WhistleNotes frame={frame} mouth={mouth} side={side} />}
          {pose === 'cigar' && <SmokeRings frame={frame} mouth={mouth} side={side} />}
          {ch?.front?.(args)}
        </g>
        {pose === 'think' && (
          <g fill="currentColor" opacity={0.7}>
            {[0, 1, 2].slice(0, Math.min(3, (frame % 4) + 1)).map((i) => (
              <circle key={i} cx={74 + i * 6} cy={side ? 4 - i * 2 : 12 - i * 3} r={1.5 + i * 0.4} />
            ))}
          </g>
        )}
        {pose === 'doze' && (
          <text x={frame % 4 < 2 ? 74 : 78} y={side ? (frame % 4 < 2 ? 10 : 4) : frame % 4 < 2 ? 18 : 12} fontSize={frame % 4 < 2 ? 10 : 13} fill="currentColor" opacity={0.75} fontStyle="italic" fontFamily="var(--font-read), serif">
            z
          </text>
        )}
      </g>
    </svg>
  );
}

type FaceProps = { pose: Pose; blink: boolean; gaze: Pt; frame: number; fill: string };

/** Yeux de face : ouverts, fermés, plissés de plaisir (guitare) ou mi-clos (cigare). */
function FrontFace({ pose, blink, gaze, frame, fill }: FaceProps) {
  const happy = pose === 'guitar' && frame % 12 >= 6;
  const lidded = pose === 'cigar';
  const cig = frame % CIGAR_CYCLE;
  return (
    <g>
      {blink ? (
        <g fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
          <path d="M32 44 Q37 47.5 42 44" />
          <path d="M54 44 Q59 47.5 64 44" />
        </g>
      ) : happy ? (
        <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <path d="M32 45.5 Q37 39.5 42 45.5" />
          <path d="M54 45.5 Q59 39.5 64 45.5" />
        </g>
      ) : (
        <g>
          <ellipse cx={37} cy={43} rx={5.6} ry={6} fill="#fffaf0" stroke="currentColor" strokeWidth={1.3} />
          <ellipse cx={59} cy={43} rx={5.6} ry={6} fill="#fffaf0" stroke="currentColor" strokeWidth={1.3} />
          <circle cx={38 + gaze[0]} cy={44 + gaze[1]} r={2.4} fill={INK} />
          <circle cx={58 + gaze[0]} cy={44 + gaze[1]} r={2.4} fill={INK} />
          <circle cx={38.8 + gaze[0]} cy={43 + gaze[1]} r={0.75} fill="#fffaf0" />
          <circle cx={58.8 + gaze[0]} cy={43 + gaze[1]} r={0.75} fill="#fffaf0" />
          {lidded && (
            <g stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round">
              <path d="M31.4 43.4 A5.6 6 0 0 1 42.6 43.4 Z" fill={fill} />
              <path d="M53.4 43.4 A5.6 6 0 0 1 64.6 43.4 Z" fill={fill} />
            </g>
          )}
        </g>
      )}
      {lidded && (
        // le sourcil du philosophe : l'un haussé, l'autre posé
        <g fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
          <path d="M31 34.5 Q36.5 29 43 33" />
          <path d="M53.5 36.4 Q59 35.2 64.5 36.8" />
        </g>
      )}
      {pose === 'doze' ? (
        <ellipse cx={48} cy={52} rx={1.6} ry={1.2} fill={INK} />
      ) : pose === 'think' ? (
        <path d="M45 52.5 Q48 51 51 52.5" fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" />
      ) : pose === 'whistle' ? (
        // lèvres en « o » pour siffler
        <ellipse cx={48.6} cy={52.6} rx={1.9} ry={2.2} fill="#5a1f1a" stroke={INK} strokeWidth={1.3} />
      ) : pose === 'write' ? (
        <g>
          <path d="M44.5 51.6 Q48 53.8 51.6 51.4" fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" />
          {[2, 3, 5, 6].includes(frame % 8) && <ellipse cx={51.9} cy={52.5} rx={1.3} ry={1.1} fill="#d9606a" stroke={INK} strokeWidth={0.6} transform="rotate(25 51.9 52.5)" />}
        </g>
      ) : pose === 'cigar' ? (
        cigarUp(frame) ? (
          <g>
            <path d="M44.8 52.2 Q47.6 53.4 50.6 52.5" fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" />
            <Cigar x={50.2} y={52.6} rot={14} len={13} hot={cig % 2 === 1} />
          </g>
        ) : [4, 6, 8].includes(cig) ? (
          <ellipse cx={49} cy={52.4} rx={1.3} ry={1.5} fill="#5a1f1a" stroke={INK} strokeWidth={1.1} />
        ) : (
          <path d="M44.5 52 Q48.5 54.2 52.2 50.8" fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" />
        )
      ) : (
        <g>
          <path d="M44 50 C 45.8 54.5, 50.2 54.5, 52 50 Z" fill={INK} stroke={INK} strokeWidth={1} strokeLinejoin="round" />
          <path d="M45.8 52.4 C 47 53.5, 49 53.5, 50.2 52.4" fill="none" stroke="#c9553a" strokeWidth={1} strokeLinecap="round" />
        </g>
      )}
      <ellipse cx={30} cy={51} rx={3} ry={1.5} fill="#e8795f" opacity={0.3} />
      <ellipse cx={66} cy={51} rx={3} ry={1.5} fill="#e8795f" opacity={0.3} />
    </g>
  );
}

function SideFace({ pose, blink, gaze, frame, fill }: FaceProps) {
  const happy = pose === 'guitar' && frame % 12 >= 6;
  const lidded = pose === 'cigar';
  const cig = frame % CIGAR_CYCLE;
  return (
    <g>
      {blink ? (
        <path d="M71 32 Q75 35 79 32" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      ) : happy ? (
        <path d="M71 32.5 Q75 27 79 32.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      ) : (
        <g>
          <ellipse cx={75} cy={30} rx={4.4} ry={5.6} fill="#fffaf0" stroke="currentColor" strokeWidth={1.3} />
          <circle cx={76.2 + gaze[0]} cy={31 + gaze[1]} r={2.2} fill={INK} />
          <circle cx={76.9 + gaze[0]} cy={30 + gaze[1]} r={0.7} fill="#fffaf0" />
          {lidded && <path d="M70.6 30.4 A4.4 5.6 0 0 1 79.4 30.4 Z" fill={fill} stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />}
        </g>
      )}
      {lidded && <path d="M70.5 21.6 Q75 17.6 80.2 20.6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />}
      {pose === 'doze' ? (
        <ellipse cx={85} cy={43} rx={1.3} ry={1} fill={INK} />
      ) : pose === 'think' ? (
        <path d="M81 43 Q84 42 87 43.5" fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" />
      ) : pose === 'whistle' ? (
        <ellipse cx={87.6} cy={42.4} rx={1.5} ry={2} fill="#5a1f1a" stroke={INK} strokeWidth={1.2} />
      ) : pose === 'write' ? (
        <g>
          <path d="M80.8 42.4 Q83.8 44.2 87 42" fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" />
          {[2, 3, 5, 6].includes(frame % 8) && <ellipse cx={87.3} cy={42.9} rx={1.2} ry={1} fill="#d9606a" stroke={INK} strokeWidth={0.6} />}
        </g>
      ) : pose === 'cigar' ? (
        cigarUp(frame) ? (
          <g>
            <path d="M81 42.4 Q83.8 43.6 86.6 42.6" fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" />
            <Cigar x={86.2} y={42.6} rot={6} len={11} hot={cig % 2 === 1} />
          </g>
        ) : [4, 6, 8].includes(cig) ? (
          <ellipse cx={86.6} cy={42.4} rx={1.2} ry={1.5} fill="#5a1f1a" stroke={INK} strokeWidth={1.1} />
        ) : (
          <path d="M81 42.2 Q84.5 44.4 87.6 41.4" fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" />
        )
      ) : (
        <path d="M80 41 C 81.5 45.5, 86 45.5, 88 40.5 Z" fill={INK} stroke={INK} strokeWidth={1} strokeLinejoin="round" />
      )}
      <ellipse cx={71} cy={40} rx={3} ry={1.5} fill="#e8795f" opacity={0.3} />
    </g>
  );
}

function Book({ frame }: { frame: number }) {
  const turning = frame % 12 === 11;
  return (
    <g strokeLinejoin="round">
      <path d="M33 56 L49.5 59 L66 56 L66 70 L49.5 73 L33 70 Z" fill="#c9553a" stroke="currentColor" strokeWidth={1.2} />
      <path d="M35 55 Q42 54.5 49.5 58 L49.5 70.5 Q42 67.5 35 68.5 Z" fill="#fbf6ea" stroke="currentColor" strokeWidth={0.9} />
      <path d="M64 55 Q57 54.5 49.5 58 L49.5 70.5 Q57 67.5 64 68.5 Z" fill="#fbf6ea" stroke="currentColor" strokeWidth={0.9} />
      <g stroke="currentColor" strokeWidth={0.6} opacity={0.45}>
        <path d="M38 59 L46 60.5 M38 61.5 L46 63 M38 64 L45 65.2" />
        <path d="M53 60.5 L61 59 M53 63 L61 61.5 M53 65.2 L59 64" />
      </g>
      {turning && <path d="M49.5 58 Q55 49 62 52 Q57 55 49.5 66 Z" fill="#fffdf6" stroke="currentColor" strokeWidth={0.9} />}
    </g>
  );
}

/** Livre vu de profil : ouvert en V devant lui, couverture rouge dessous. */
function SideBook({ frame }: { frame: number }) {
  const turning = frame % 12 === 11;
  return (
    <g strokeLinejoin="round">
      <path d="M68 50 L76 54 L86 44 L88 46 L76 57 L66 52 Z" fill="#c9553a" stroke="currentColor" strokeWidth={1} />
      <path d="M68 49 L76 53 L76 40 Z" fill="#fbf6ea" stroke="currentColor" strokeWidth={0.9} />
      <path d="M76 53 L86 43 L79 37 L76 40 Z" fill="#fbf6ea" stroke="currentColor" strokeWidth={0.9} />
      {turning && <path d="M76 52 L74 36 L70 40 Z" fill="#fffdf6" stroke="currentColor" strokeWidth={0.8} />}
    </g>
  );
}

// ── Accessoires ─────────────────────────────────────────────

/** Guitare folk, dessinée caisse à droite et manche vers la gauche, puis placée par `t`. */
function Guitar({ t }: { t: GT }) {
  const body =
    'M-13.8 0 C -13.8 -5, -10.5 -7, -7 -7 C -4.2 -7, -3 -5.4, -1.4 -5.4 C 0.2 -5.4, 1 -9.2, 5.2 -9.2 C 10.8 -9.2, 14.2 -5, 14.2 0 C 14.2 5, 10.8 9.2, 5.2 9.2 C 1 9.2, 0.2 5.4, -1.4 5.4 C -3 5.4, -4.2 7, -7 7 C -10.5 7, -13.8 5, -13.8 0 Z';
  return (
    <g transform={`translate(${t.x} ${t.y}) rotate(${t.r}) scale(${t.sx} ${t.sy})`} strokeLinejoin="round">
      <path d="M-12 -1.9 L-45 -1.5 L-45 1.5 L-12 1.9 Z" fill="#6b4325" stroke={INK} strokeWidth={1.2} />
      <g stroke="#ecdcb8" strokeWidth={0.5} opacity={0.85}>
        {[-17, -22, -27, -32, -37, -41.5].map((x) => (
          <path key={x} d={`M${x} -1.5 L${x} 1.5`} />
        ))}
      </g>
      <path d="M-45 -2.3 L-53.5 -3.4 Q-55 0 -53.5 3.4 L-45 2.3 Z" fill="#5a3820" stroke={INK} strokeWidth={1.2} />
      <g fill="#ecdcb8" stroke={INK} strokeWidth={0.45}>
        <circle cx={-48} cy={-3.6} r={1} />
        <circle cx={-51.5} cy={-4.1} r={1} />
        <circle cx={-48} cy={3.6} r={1} />
        <circle cx={-51.5} cy={4.1} r={1} />
      </g>
      <path d={body} fill="#c98a4b" stroke={INK} strokeWidth={1.5} />
      <ellipse cx={6} cy={-4} rx={5} ry={2.4} fill="#e3ad72" opacity={0.75} />
      <circle cx={-3} cy={0} r={4.1} fill="none" stroke="#8a5a2e" strokeWidth={0.7} />
      <circle cx={-3} cy={0} r={3} fill="#3a2614" stroke={INK} strokeWidth={0.8} />
      <rect x={6.6} y={-3.6} width={2.2} height={7.2} rx={0.7} fill={INK} />
      <g stroke="#f6edd6" strokeWidth={0.4}>
        <path d="M7.6 -1.1 L-45 -0.8" />
        <path d="M7.6 1.1 L-45 0.8" />
      </g>
    </g>
  );
}

/** Note de musique (croche, ou deux croches liées), cernée de clair pour se lire sur le cerveau. */
function Note({ x, y, s, o, two }: { x: number; y: number; s: number; o: number; two?: boolean }) {
  const glyph = (
    <g>
      <ellipse cx={0} cy={0} rx={2.3} ry={1.7} transform="rotate(-22)" />
      <path d="M1.9 -0.6 L1.9 -8.2" fill="none" />
      {two ? (
        <g>
          <ellipse cx={5.4} cy={-1.4} rx={2.3} ry={1.7} transform="rotate(-22 5.4 -1.4)" />
          <path d="M7.3 -2 L7.3 -9.6" fill="none" />
          <path d="M1.9 -8.2 L7.3 -9.6" fill="none" strokeWidth={1.8} />
        </g>
      ) : (
        <path d="M1.9 -8.2 C 4.6 -7.2, 5.6 -5.2, 4.2 -2.8" fill="none" />
      )}
    </g>
  );
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={o} strokeLinecap="round" strokeLinejoin="round">
      <g fill="#fffaf0" stroke="#fffaf0" strokeWidth={2.6} opacity={0.85}>
        {glyph}
      </g>
      <g fill="currentColor" stroke="currentColor" strokeWidth={1.1}>
        {glyph}
      </g>
    </g>
  );
}

/** Guitare : trois notes s'élèvent tour à tour au-dessus de lui (cycle de 6 images). */
function GuitarNotes({ frame, side }: { frame: number; side: boolean }) {
  return (
    <g>
      {[0, 1, 2].map((i) => {
        const age = (((frame - 2 * i) % 6) + 6) % 6;
        if (age > 3) return null;
        const x = (side ? [88, 94, 91] : [83, 90, 86])[i] + age * (side ? -0.6 : 1);
        const y = (side ? 34 : 32) - age * 7;
        return <Note key={i} x={x} y={y} s={0.85 + age * 0.08} o={1 - age * 0.2} two={i === 1} />;
      })}
    </g>
  );
}

/** Sifflet : deux notes sortent de la bouche et montent en s'écartant (cycle de 6 images). */
function WhistleNotes({ frame, mouth, side }: { frame: number; mouth: Pt; side: boolean }) {
  const PATH: Pt[] = side
    ? [
        [5, -1],
        [7, -7],
        [7, -13],
        [5, -19],
      ]
    : [
        [9, 0],
        [17, -4],
        [23, -11],
        [27, -19],
      ];
  return (
    <g>
      {[0, 3].map((b, i) => {
        const age = (((frame - b) % 6) + 6) % 6;
        if (age > 3) return null;
        const s = 0.7 + age * 0.1;
        const x = Math.min(mouth[0] + PATH[age][0], 99 - 5 * s);
        return <Note key={i} x={x} y={mouth[1] + PATH[age][1]} s={s} o={1 - age * 0.18} two={i === 1 && age > 0} />;
      })}
    </g>
  );
}

/** Cigare : bout de bouche à x = 0, braise et cendre à x = len. */
function Cigar({ x, y, rot, len = 12, hot }: { x: number; y: number; rot: number; len?: number; hot?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} strokeLinejoin="round">
      {hot && <circle cx={len - 1.4} cy={0} r={2.8} fill="#ffb070" opacity={0.4} />}
      <rect x={0} y={-1.3} width={len - 2.4} height={2.6} rx={1.1} fill="#7a4a2a" stroke={INK} strokeWidth={0.7} />
      <rect x={2.2} y={-1.3} width={1.4} height={2.6} fill="#d9a441" stroke={INK} strokeWidth={0.4} />
      <rect x={len - 2.8} y={-1.15} width={1.3} height={2.3} fill={hot ? '#ffa060' : '#e8795f'} />
      <rect x={len - 1.6} y={-1.2} width={1.7} height={2.4} rx={0.8} fill="#a39d94" stroke={INK} strokeWidth={0.5} />
    </g>
  );
}

/** Cigare tenu bas, à la main : un filet de fumée monte de la braise. */
function LoweredCigar({ hand, side, frame }: { hand: Pt; side: boolean; frame: number }) {
  const rot = side ? -24 : -14;
  const len = 12;
  const x = hand[0] - (side ? 2 : 3);
  const y = hand[1] + 0.4;
  const a = (rot * Math.PI) / 180;
  const tx = x + len * Math.cos(a);
  const ty = y + len * Math.sin(a);
  const w = frame % 2 ? 1 : -1;
  return (
    <g>
      <path
        d={`M${tx} ${ty - 1.5} C ${tx - 2.5 * w} ${ty - 4.5}, ${tx + 2.5 * w} ${ty - 7}, ${tx} ${ty - 10} S ${tx - 2 * w} ${ty - 14}, ${tx + 0.6 * w} ${ty - 17}`}
        fill="none"
        stroke="#8a847b"
        strokeWidth={0.9}
        strokeLinecap="round"
        opacity={0.55}
      />
      <Cigar x={x} y={y} rot={rot} len={len} />
    </g>
  );
}

/** Ronds de fumée : soufflés aux images 4, 6 et 8 du cycle, ils montent en s'élargissant puis s'effacent. */
function SmokeRings({ frame, mouth, side }: { frame: number; mouth: Pt; side: boolean }) {
  const c = frame % CIGAR_CYCLE;
  const PATH: Pt[] = side
    ? [
        [6, -3],
        [8, -7],
        [9, -11],
        [9, -16],
        [8, -21],
        [7, -26],
        [6, -31],
        [5, -36],
      ]
    : [
        [9, 1],
        [15, -1],
        [20, -5],
        [25, -10],
        [29, -17],
        [32, -25],
        [34, -34],
        [35, -43],
      ];
  return (
    <g fill="none">
      {[4, 6, 8].map((b) => {
        const age = (c - b + CIGAR_CYCLE) % CIGAR_CYCLE;
        if (age > 7) return null;
        const rx = 2.2 + age * 0.75;
        const ry = rx * 0.55;
        const x = Math.min(mouth[0] + PATH[age][0], 99.5 - rx);
        const y = mouth[1] + PATH[age][1];
        const o = 0.95 - age * 0.1;
        return (
          <g key={b}>
            <ellipse cx={x} cy={y} rx={rx} ry={ry} stroke="#fffaf0" strokeWidth={2.8} opacity={0.6 * o} />
            <ellipse cx={x} cy={y} rx={rx} ry={ry} stroke="#77716a" strokeWidth={1.3} opacity={o} />
          </g>
        );
      })}
    </g>
  );
}

/** Ligne manuscrite (petit zigzag d'encre) le long d'une rangée du carnet. */
function scribble(x0: number, x1: number, row: (x: number) => number) {
  let d = `M${x0} ${row(x0)}`;
  let j = 0;
  for (let x = x0 + 1.1; x < x1; x += 1.1, j++) d += ` L${x.toFixed(1)} ${(row(x) + (j % 2 ? 0.45 : -0.45)).toFixed(2)}`;
  return d;
}
const notebookRow = (i: number) => (x: number) => 64.8 + i * 1.75 - Math.abs(x - 50) * 0.17;

/** Carnet ouvert sur ses genoux, de face : la page de droite se remplit, puis on tourne la page. */
function Notebook({ frame }: { frame: number }) {
  const c = frame % 8;
  const n = WRITE_LINES[c];
  const nib = writeNib(frame);
  return (
    <g strokeLinejoin="round">
      <path d="M50.6 75 L51.6 82 L50.4 80.6 L49.2 82 L49.4 75 Z" fill="#c9553a" stroke={INK} strokeWidth={0.6} />
      <path d="M32 61 L50 64 L68 61 L68 74.5 L50 77.5 L32 74.5 Z" fill="#6b4a35" stroke="currentColor" strokeWidth={1.2} />
      <path d="M34 60 Q42 59.5 50 63 L50 75.5 Q42 72.5 34 73.5 Z" fill="#fbf6ea" stroke="currentColor" strokeWidth={0.9} />
      <path d="M66 60 Q58 59.5 50 63 L50 75.5 Q58 72.5 66 73.5 Z" fill="#fbf6ea" stroke="currentColor" strokeWidth={0.9} />
      <g fill="none" stroke="currentColor" strokeWidth={0.55} opacity={0.72} strokeLinecap="round">
        {[0, 1, 2, 3].map((i) => (
          <path key={'l' + i} d={scribble(37, i === 3 ? 43 : 47.5, notebookRow(i))} />
        ))}
        {Array.from({ length: n }, (_, i) => (
          <path key={'r' + i} d={scribble(52.5, i % 2 ? 61 : 63, notebookRow(i))} />
        ))}
        {c < 7 && n < 5 && nib[0] > 53.5 && <path d={scribble(52.5, nib[0], notebookRow(n))} />}
      </g>
      {c === 7 && <path d="M50 63 Q56 51.5 63.5 54.5 Q57 58 50 70.5 Z" fill="#fffdf6" stroke="currentColor" strokeWidth={0.9} />}
    </g>
  );
}

/** Carnet de profil, posé à plat sur les cuisses (repère du cerveau). */
function SideNotebook({ frame }: { frame: number }) {
  const c = frame % 8;
  const n = WRITE_LINES[c];
  return (
    <g strokeLinejoin="round">
      <path d="M81.6 63.6 L82.8 69.6 L81.6 68.6 L80.6 69.8 L80.4 63.8 Z" fill="#c9553a" stroke={INK} strokeWidth={0.5} />
      <path d="M57.5 65.6 L83 63.2 L83.6 64.8 L58 67.2 Z" fill="#6b4a35" stroke="currentColor" strokeWidth={0.8} />
      <path d="M58 65.2 L70 63.6 L82.6 63 L80.6 58.4 L70 62.2 L60 59.2 Z" fill="#fbf6ea" stroke="currentColor" strokeWidth={0.8} />
      <g stroke="currentColor" strokeWidth={0.5} opacity={0.7} strokeLinecap="round">
        {Array.from({ length: n }, (_, i) => (
          <path key={i} d={`M${71.5 + i * 2.2} ${62 - i * 0.85} L${73 + i * 2.2} ${61.6 - i * 0.85}`} />
        ))}
      </g>
      {c === 7 && <path d="M70 62.6 L66.5 54.5 L72.5 55.4 Z" fill="#fffdf6" stroke="currentColor" strokeWidth={0.8} />}
    </g>
  );
}

/** Plume d'oie : pointe en `nib`, barbes vers `rot` degrés. */
function Quill({ nib, rot }: { nib: Pt; rot: number }) {
  return (
    <g transform={`translate(${nib[0]} ${nib[1]}) rotate(${rot})`} strokeLinejoin="round" strokeLinecap="round">
      <path d="M6 0 C 8 -3.8, 15 -4.8, 21.5 -1.3 C 22.6 -0.3, 22.6 0.4, 21.6 0.9 C 15 3.6, 9 3.1, 6 0 Z" fill="#fbf6ea" stroke={INK} strokeWidth={0.85} />
      <path d="M10 -0.3 L12.4 -3 M14 -0.3 L16.4 -3.3 M10 0.3 L12 2.5 M14 0.3 L16.2 2.7" stroke={INK} strokeWidth={0.4} opacity={0.6} />
      <path d="M2.5 0 L21 0" stroke={INK} strokeWidth={0.8} />
      <path d="M0 0 L3 -0.9 L3 0.9 Z" fill={INK} stroke={INK} strokeWidth={0.4} />
    </g>
  );
}

function Puff({ frame }: { frame: number }) {
  const s = [0.55, 1, 0.75][frame % 3];
  const o = [0.9, 0.7, 0.35][frame % 3];
  return (
    <svg className="mascot-svg" width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} aria-hidden="true">
      <g transform={`translate(50 96) scale(${s})`} fill="none" stroke="currentColor" strokeWidth={2.4} opacity={o} strokeLinecap="round">
        <path d="M-26 8 C -34 -6, -18 -20, -8 -12 C -6 -28, 14 -28, 14 -12 C 26 -20, 38 -2, 26 8 C 30 20, 10 26, 2 18 C -6 28, -30 22, -26 8 Z" fill="var(--bg-panel)" />
        <path d="M-40 -18 L-46 -24 M42 -16 L48 -22 M-38 22 L-45 27 M40 24 L46 30" />
      </g>
    </svg>
  );
}
