import { useId } from 'react';

// Le compagnon : un petit cerveau sur pattes, dessiné à l'encre (couleur du texte : currentColor), qui
// suit le thème. Repère : viewBox 100 × 130. Debout, les pieds touchent y = 124 ; assis, l'assise est
// à y = 70 (le bord de l'encadré), les jambes pendent devant.
// La musculature (0 à 4) suit le nombre de documents : membres plus épais, biceps et mollets, puis
// veines sur le cerveau (rouges, en relief), et une veine du front qui bat au niveau 4.

export type Pose = 'stand' | 'walk' | 'sit' | 'read' | 'think' | 'wave' | 'doze' | 'flex' | 'puff';
export type Level = 0 | 1 | 2 | 3 | 4;

/** Ligne d'appui (unités du viewBox) : sol pour les poses debout, bord de l'encadré pour les poses assises. */
export const anchorOf = (p: Pose) => (p === 'sit' || p === 'read' || p === 'think' || p === 'doze' ? 70 : 124);
export const VB_W = 100;
export const VB_H = 130;

type Pt = [number, number];
type Limb = { a: Pt; b: Pt; c: Pt };
type Rig = { arms: [Limb, Limb]; legs: [Limb, Limb]; lift: number; gaze: Pt; feet: 'stand' | 'hang' };

const W_LIMB = [3.2, 3.8, 4.5, 5.3, 6.2];
const BICEP = [0, 2.6, 3.6, 4.6, 5.8];
const CALF = [0, 1.6, 2.3, 3, 3.8];
/** Le cerveau lui-même grossit avec le niveau (mise à l'échelle depuis le bas du cerveau). */
const BRAIN_K = [1, 1.05, 1.1, 1.16, 1.23];

function rig(pose: Pose, f: number): Rig {
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
    case 'walk':
      return f % 2
        ? {
            arms: [
              { a: [21, 54], b: [17, 72], c: [21, 87] },
              { a: [78, 54], b: [82, 72], c: [78, 87] },
            ],
            legs: [
              { a: [42, 64], b: [44, 92], c: [47, 119] },
              { a: [57, 64], b: [55, 90], c: [52, 117] },
            ],
            lift: -2,
            gaze: [1.2, 0],
            feet: 'stand',
          }
        : {
            arms: [
              { a: [21, 54], b: [13, 71], c: [10, 86] },
              { a: [78, 54], b: [86, 71], c: [89, 86] },
            ],
            legs: [
              { a: [42, 64], b: [37, 93], c: [31, 121] },
              { a: [57, 64], b: [62, 93], c: [68, 121] },
            ],
            lift: 0,
            gaze: [1.2, 0],
            feet: 'stand',
          };
    case 'wave':
      return {
        arms: [restArms[0], { a: [78, 54], b: [90, 44], c: f % 2 ? [94, 27] : [86, 25] }],
        legs: standLegs,
        lift: 0,
        gaze: [0, 0],
        feet: 'stand',
      };
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
        legs: sitLegs(f % 8 === 0 ? 1 : 0),
        lift: 0,
        gaze: [f % 10 < 5 ? -1.2 : 1.2, 1.8],
        feet: 'hang',
      };
    case 'think':
      return {
        arms: [edgeArms[0], { a: [78, 54], b: [86, 64], c: [65, 59] }],
        legs: sitLegs(0),
        lift: 0,
        gaze: [-1.4, -2],
        feet: 'hang',
      };
    case 'doze':
      return { arms: edgeArms, legs: sitLegs(0), lift: f % 4 < 2 ? 0 : 0.6, gaze: [0, 0], feet: 'hang' };
    default:
      return { arms: restArms, legs: standLegs, lift: f % 6 === 3 ? -1 : 0, gaze: [0, 0], feet: 'stand' };
  }
}

const path = (l: Limb) => `M${l.a[0]} ${l.a[1]} Q${l.b[0]} ${l.b[1]} ${l.c[0]} ${l.c[1]}`;
const mid = (p: Pt, q: Pt, t = 0.5): Pt => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const angle = (p: Pt, q: Pt) => (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;

function Bulge({ p, q, r, t = 0.45 }: { p: Pt; q: Pt; r: number; t?: number }) {
  if (!r) return null;
  const [x, y] = mid(p, q, t);
  return <ellipse cx={x} cy={y} rx={r * 1.7} ry={r} transform={`rotate(${angle(p, q)} ${x} ${y})`} fill="currentColor" />;
}

// Cerveau : dessiné dans le repère du croquis d'origine (≈ 116..508 × 96..420), ramené ici à l'échelle 0,19.
const BRAIN =
  'M138 300 C 108 270, 116 214, 156 196 C 158 150, 204 122, 246 134 C 266 100, 324 96, 348 122 C 386 104, 440 122, 448 164 C 490 172, 508 220, 490 254 C 516 284, 506 336, 468 350 C 462 388, 424 408, 388 396 C 370 418, 336 420, 316 404 C 300 418, 264 420, 246 402 C 210 412, 168 394, 164 360 C 136 356, 124 324, 138 300 Z';
const SULCI = [
  // scissure entre les hémisphères
  'M312 104 C 302 136, 324 158, 306 188 C 294 208, 314 224, 304 246',
  // hémisphère gauche
  'M268 120 C 258 140, 280 150, 270 168 C 262 184, 280 196, 274 214',
  'M226 136 C 242 148, 234 168, 254 176',
  'M176 190 C 190 174, 214 184, 206 204 C 200 222, 224 230, 238 220',
  'M196 248 C 214 238, 230 254, 248 244',
  'M138 262 C 158 250, 176 266, 170 284 C 166 298, 184 306, 198 296',
  'M150 332 C 170 322, 186 332, 202 322',
  'M178 356 C 196 340, 214 356, 232 346 C 246 338, 258 352, 272 344',
  // hémisphère droit
  'M356 120 C 366 140, 344 150, 354 168 C 362 184, 344 196, 350 214',
  'M398 136 C 382 148, 390 168, 370 176',
  'M448 190 C 434 174, 410 184, 418 204 C 424 222, 400 230, 386 220',
  'M428 248 C 410 238, 394 254, 376 244',
  'M486 262 C 466 250, 448 266, 454 284 C 458 298, 440 306, 426 296',
  'M474 332 C 454 322, 438 332, 422 322',
  'M446 356 C 428 340, 410 356, 392 346 C 378 338, 366 352, 352 344',
  // sous la bouche
  'M288 384 C 300 394, 324 394, 336 384',
];
const VEINS: { d: string; from: Level }[] = [
  { d: 'M170 252 C 184 236, 200 252, 214 236 C 226 222, 244 232, 252 218', from: 2 },
  { d: 'M372 196 C 388 210, 404 196, 420 212 C 432 224, 450 218, 462 232', from: 2 },
  { d: 'M136 330 C 152 336, 158 352, 176 352', from: 3 },
  { d: 'M486 290 C 470 306, 484 320, 470 336', from: 3 },
  { d: 'M236 150 C 246 168, 264 168, 270 186 C 274 196, 286 196, 292 206', from: 4 },
  { d: 'M330 140 C 344 156, 362 150, 372 168', from: 4 },
];
// Veine du front, en Y, qui bat (niveau 3+).
const FOREHEAD = 'M306 236 C 302 222, 310 210, 304 196 M304 214 C 294 206, 288 194, 292 182 M306 222 C 318 214, 322 202, 320 190';

export function Sprite({ pose, frame, level, facing = 1, title, halo }: { pose: Pose; frame: number; level: Level; facing?: 1 | -1; title?: string; halo?: string }) {
  const fid = 'mascot-halo-' + useId().replace(/:/g, '');
  if (pose === 'puff') return <Puff frame={frame} />;
  // Encre fixe (le personnage reste lisible quel que soit le thème ; halo clair en thème sombre).
  const r = rig(pose, frame);
  const k = BRAIN_K[level];
  // Épaules écartées d'autant que le cerveau a grossi.
  r.arms = r.arms.map((l, i) => ({ ...l, a: [l.a[0] + (i ? 1 : -1) * (k - 1) * 30, l.a[1]] as Pt })) as [Limb, Limb];
  const lw = W_LIMB[level];
  const seated = r.feet === 'hang';
  const blink = pose === 'doze' || (pose !== 'read' && frame % 17 === 16);
  const pulse = level >= 3 && frame % 2 === 0;
  const brainFill = ['#f3d7c8', '#f2d0c0', '#f0c8b6', '#eec0ac', '#ecb6a0'][level];
  const flip = facing === -1 ? `translate(${VB_W} 0) scale(-1 1)` : undefined;
  return (
    <svg className="mascot-svg" width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ color: '#231b11' }} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
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
      </defs>
      <g transform={flip} filter={halo ? `url(#${fid})` : undefined}>
        {/* bras et jambes derrière le cerveau */}
        <g fill="none" stroke="currentColor" strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round">
          {r.legs.map((l, i) => (
            <path key={'l' + i} d={path(l)} />
          ))}
        </g>
        {r.legs.map((l, i) => (
          <Bulge key={'c' + i} p={l.b} q={l.c} r={CALF[level]} t={seated ? 0.35 : 0.3} />
        ))}
        {r.legs.map((l, i) => {
          const out = i === 0 ? -1 : 1;
          const [x, y] = l.c;
          return seated ? (
            <ellipse key={'f' + i} cx={x + out * 1.5} cy={y + 1} rx={3.8} ry={3.2} fill="currentColor" />
          ) : (
            <path key={'f' + i} d={`M${x - (out < 0 ? 8 : 1)} ${y + 3} Q${x + out * 3} ${y - 3} ${x + (out < 0 ? 1 : 8)} ${y + 3} Z`} fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
          );
        })}

        <g transform={`translate(0 ${r.lift})`}>
          <g transform={`translate(49 63) scale(${k}) translate(-49 -63)`}>
          <g transform="translate(-10 -12.2) scale(0.19)">
            <path d={BRAIN} fill={brainFill} stroke="currentColor" strokeWidth={13} strokeLinejoin="round" />
            <g fill="none" stroke="currentColor" strokeWidth={7.5} strokeLinecap="round" opacity={0.85}>
              {SULCI.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
            <g fill="none" strokeLinecap="round">
              {VEINS.filter((v) => level >= v.from).map((v, i) => (
                <g key={i}>
                  <path d={v.d} stroke="#a3354b" strokeWidth={level >= 4 ? 13 : 11} />
                  <path d={v.d} stroke="#f6c3c0" strokeWidth={3.5} opacity={0.9} transform="translate(-2 -3)" />
                </g>
              ))}
              {level >= 3 && (
                <g>
                  <path d={FOREHEAD} stroke="#a3354b" strokeWidth={pulse ? 15 : 11} />
                  <path d={FOREHEAD} stroke="#f6c3c0" strokeWidth={3.5} transform="translate(-2 -3)" />
                </g>
              )}
            </g>
          </g>

          {/* visage */}
          {blink ? (
            <g fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
              <path d="M32 44 Q37 47.5 42 44" />
              <path d="M54 44 Q59 47.5 64 44" />
            </g>
          ) : (
            <g>
              <ellipse cx={37} cy={43} rx={5.6} ry={6} fill="#fffaf0" stroke="currentColor" strokeWidth={1.3} />
              <ellipse cx={59} cy={43} rx={5.6} ry={6} fill="#fffaf0" stroke="currentColor" strokeWidth={1.3} />
              <circle cx={37 + 1 + r.gaze[0]} cy={44 + r.gaze[1]} r={2.4} fill="#231b11" />
              <circle cx={59 - 1 + r.gaze[0]} cy={44 + r.gaze[1]} r={2.4} fill="#231b11" />
              <circle cx={37.8 + 1 + r.gaze[0]} cy={43 + r.gaze[1]} r={0.75} fill="#fffaf0" />
              <circle cx={59.8 - 1 + r.gaze[0]} cy={43 + r.gaze[1]} r={0.75} fill="#fffaf0" />
            </g>
          )}
          {pose === 'doze' ? (
            <ellipse cx={48} cy={52} rx={1.6} ry={1.2} fill="#231b11" />
          ) : pose === 'think' ? (
            <path d="M45 52.5 Q48 51 51 52.5" fill="none" stroke="#231b11" strokeWidth={1.3} strokeLinecap="round" />
          ) : (
            <g>
              <path d="M44 50 C 45.8 54.5, 50.2 54.5, 52 50 Z" fill="#231b11" stroke="#231b11" strokeWidth={1} strokeLinejoin="round" />
              <path d="M45.8 52.4 C 47 53.5, 49 53.5, 50.2 52.4" fill="none" stroke="#c9553a" strokeWidth={1} strokeLinecap="round" />
            </g>
          )}
          <ellipse cx={30} cy={51} rx={3} ry={1.5} fill="#e8795f" opacity={0.3} />
          <ellipse cx={66} cy={51} rx={3} ry={1.5} fill="#e8795f" opacity={0.3} />
          </g>

          {/* bras devant */}
          <g fill="none" stroke="currentColor" strokeWidth={lw * 0.92} strokeLinecap="round" strokeLinejoin="round">
            {r.arms.map((l, i) => (
              <path key={'a' + i} d={path(l)} />
            ))}
          </g>
          {r.arms.map((l, i) => (
            <Bulge key={'b' + i} p={l.a} q={l.b} r={BICEP[level]} t={0.55} />
          ))}
          {pose === 'read' && <Book frame={frame} />}
          {r.arms.map((l, i) => (
            <circle key={'h' + i} cx={l.c[0]} cy={l.c[1]} r={2.6 + level * 0.25} fill="currentColor" />
          ))}
        </g>

        {pose === 'think' && (
          <g fill="currentColor" opacity={0.7}>
            {[0, 1, 2].slice(0, (frame % 4) + 1 > 3 ? 3 : (frame % 4) + 1).map((i) => (
              <circle key={i} cx={74 + i * 6} cy={12 - i * 3} r={1.5 + i * 0.4} />
            ))}
          </g>
        )}
        {pose === 'doze' && (
          <text x={frame % 4 < 2 ? 74 : 78} y={frame % 4 < 2 ? 18 : 12} fontSize={frame % 4 < 2 ? 10 : 13} fill="currentColor" opacity={0.75} fontStyle="italic" fontFamily="var(--font-read), serif">
            z
          </text>
        )}
      </g>
    </svg>
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
