import { useId, type ReactNode } from 'react';

// Le compagnon : un petit cerveau sur pattes, dessiné à l'encre. Trois vues : de face, de profil (il
// marche de profil, peut s'asseoir de profil, jambes allongées sur l'encadré) et de dos (il s'en va,
// ou s'assoit face au contenu). Repère : viewBox 100 × 130. Debout, les pieds touchent y = 124 ;
// assis de face ou de dos, l'assise est à y = 70 (les jambes pendent devant) ; assis de profil, à y = 64.
// Musculature (0 à 4, selon le nombre de documents) : membres plus épais, biceps et mollets, cerveau
// un peu plus gros, puis veines rouges en relief et, aux niveaux 3 et 4, une veine qui bat.
// Les sillons ont un léger ombrage (creux) et un reflet (bord), pour que le cerveau se lise en volume.

export type Pose = 'stand' | 'walk' | 'sit' | 'read' | 'think' | 'wave' | 'sitwave' | 'doze' | 'flex' | 'puff';
export type View = 'front' | 'side' | 'back';
export type Level = 0 | 1 | 2 | 3 | 4;

const SEATED = new Set<Pose>(['sit', 'read', 'think', 'doze', 'sitwave']);
export const isSeated = (p: Pose) => SEATED.has(p);
/** Vue réellement dessinée : saluer et faire le costaud se font toujours de face, marcher de profil. */
export function viewFor(p: Pose, v: View): View {
  if (p === 'wave' || p === 'flex' || p === 'sitwave') return 'front';
  if (p === 'walk') return v === 'back' ? 'back' : 'side';
  if (v === 'back' && (p === 'read' || p === 'think')) return 'front';
  return v;
}
/** Ligne d'appui (unités du viewBox) : sol pour les poses debout, bord de l'encadré pour les poses assises. */
export const anchorOf = (p: Pose, v: View = 'front') => (isSeated(p) ? (viewFor(p, v) === 'side' ? 64 : 70) : 124);
export const VB_W = 100;
export const VB_H = 130;

type Pt = [number, number];
type Limb = { a: Pt; b: Pt; c: Pt };
type Rig = { arms: [Limb, Limb]; legs: [Limb, Limb]; lift: number; gaze: Pt; feet: 'stand' | 'hang' | 'flat' | 'none' };

const W_LIMB = [3.2, 3.8, 4.5, 5.3, 6.2];
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
  if (isSeated(pose)) {
    // Assis de profil sur l'encadré (bord à y = 64) : le cerveau remonte de 8 pour laisser voir les
    // jambes allongées devant lui. Les bras, dans le même groupe, sont décalés d'autant vers le bas.
    const L = 8;
    const kick = (pose === 'sit' && f % 2) || (pose === 'read' && Math.floor(f / 2) % 2) ? -3 : 0;
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
    return { legs, arms: restArms, lift, gaze: [1, 0.4], feet: 'flat' };
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
}) {
  const uid = useId().replace(/:/g, '');
  if (pose === 'puff') return <Puff frame={frame} />;
  const v = viewFor(pose, view);
  const side = v === 'side';
  const r = side ? rigSide(pose, frame) : rigFront(pose, frame);
  const k = BRAIN_K[level];
  if (!side) r.arms = r.arms.map((l, i) => ({ ...l, a: [l.a[0] + (i ? 1 : -1) * (k - 1) * 30, l.a[1]] as Pt })) as [Limb, Limb];
  // De dos et assis : les jambes pendent de l'autre côté de l'encadré, on ne les voit pas.
  if (v === 'back' && isSeated(pose)) r.feet = 'none';
  const lw = W_LIMB[level];
  const blink = pose === 'doze' || (blinkProp ?? (pose !== 'read' && frame % 17 === 16));
  const pulse = level >= 3 && frame % 2 === 0;
  const fill = FILL[level];
  const flip = side && facing === -1 ? `translate(${VB_W} 0) scale(-1 1)` : undefined;
  const grad = `mascot-vol-${uid}`;
  const fid = `mascot-halo-${uid}`;
  const pivot: Pt = side ? [52, 58] : [49, 63];

  const limbs = (ls: Limb[], width: number) => (
    <g fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {ls.map((l, i) => (
        <path key={i} d={path(l)} />
      ))}
    </g>
  );
  const feet = (ls: Limb[]) =>
    ls.map((l, i) => {
      const [x, y] = l.c;
      if (r.feet === 'hang') return <ellipse key={i} cx={x + (i ? 1.5 : -1.5)} cy={y + 1} rx={3.8} ry={3.2} fill="currentColor" />;
      if (r.feet === 'flat') return <ellipse key={i} cx={x + 1} cy={y - 3} rx={2.6} ry={4.4} fill="currentColor" />;
      if (side) return <ellipse key={i} cx={x + 3.5} cy={y + 0.5} rx={5.6} ry={2.8} fill="currentColor" />;
      const out = i === 0 ? -1 : 1;
      return <path key={i} d={`M${x - (out < 0 ? 8 : 1)} ${y + 3} Q${x + out * 3} ${y - 3} ${x + (out < 0 ? 1 : 8)} ${y + 3} Z`} fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />;
    });
  const hands = (ls: Limb[]) => ls.map((l, i) => <circle key={i} cx={l.c[0]} cy={l.c[1]} r={2.6 + level * 0.25} fill="currentColor" />);
  const biceps = (ls: Limb[]) => ls.map((l, i) => <Bulge key={i} p={l.a} q={l.b} r={BICEP[level]} t={0.55} />);
  const calves = (ls: Limb[]) => ls.map((l, i) => <Bulge key={i} p={l.b} q={l.c} r={CALF[level]} t={r.feet === 'stand' ? 0.3 : 0.35} />);

  let brain: ReactNode;
  if (side) {
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
    <SideFace pose={pose} blink={blink} gaze={r.gaze} />
  ) : (
    <FrontFace pose={pose} blink={blink} gaze={r.gaze} />
  );

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
          {side && (
            <g>
              {limbs([r.arms[0]], lw * 0.92)}
              {biceps([r.arms[0]])}
              {hands([r.arms[0]])}
            </g>
          )}
          <g transform={`translate(${pivot[0]} ${pivot[1]}) scale(${k}) translate(${-pivot[0]} ${-pivot[1]})`}>
            {brain}
            {face}
          </g>
          {limbs(side ? [r.arms[1]] : r.arms, lw * 0.92)}
          {biceps(side ? [r.arms[1]] : r.arms)}
          {pose === 'read' && (side ? <SideBook frame={frame} /> : <Book frame={frame} />)}
          {hands(side ? [r.arms[1]] : r.arms)}
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

function FrontFace({ pose, blink, gaze }: { pose: Pose; blink: boolean; gaze: Pt }) {
  return (
    <g>
      {blink ? (
        <g fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
          <path d="M32 44 Q37 47.5 42 44" />
          <path d="M54 44 Q59 47.5 64 44" />
        </g>
      ) : (
        <g>
          <ellipse cx={37} cy={43} rx={5.6} ry={6} fill="#fffaf0" stroke="currentColor" strokeWidth={1.3} />
          <ellipse cx={59} cy={43} rx={5.6} ry={6} fill="#fffaf0" stroke="currentColor" strokeWidth={1.3} />
          <circle cx={38 + gaze[0]} cy={44 + gaze[1]} r={2.4} fill={INK} />
          <circle cx={58 + gaze[0]} cy={44 + gaze[1]} r={2.4} fill={INK} />
          <circle cx={38.8 + gaze[0]} cy={43 + gaze[1]} r={0.75} fill="#fffaf0" />
          <circle cx={58.8 + gaze[0]} cy={43 + gaze[1]} r={0.75} fill="#fffaf0" />
        </g>
      )}
      {pose === 'doze' ? (
        <ellipse cx={48} cy={52} rx={1.6} ry={1.2} fill={INK} />
      ) : pose === 'think' ? (
        <path d="M45 52.5 Q48 51 51 52.5" fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" />
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

function SideFace({ pose, blink, gaze }: { pose: Pose; blink: boolean; gaze: Pt }) {
  return (
    <g>
      {blink ? (
        <path d="M71 32 Q75 35 79 32" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      ) : (
        <g>
          <ellipse cx={75} cy={30} rx={4.4} ry={5.6} fill="#fffaf0" stroke="currentColor" strokeWidth={1.3} />
          <circle cx={76.2 + gaze[0]} cy={31 + gaze[1]} r={2.2} fill={INK} />
          <circle cx={76.9 + gaze[0]} cy={30 + gaze[1]} r={0.7} fill="#fffaf0" />
        </g>
      )}
      {pose === 'doze' ? (
        <ellipse cx={85} cy={43} rx={1.3} ry={1} fill={INK} />
      ) : pose === 'think' ? (
        <path d="M81 43 Q84 42 87 43.5" fill="none" stroke={INK} strokeWidth={1.3} strokeLinecap="round" />
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
