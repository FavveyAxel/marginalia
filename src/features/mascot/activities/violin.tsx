// Activité « violin » : debout, il joue du violon. L'instrument est calé sous le menton, côté gauche
// du personnage (à droite pour nous) ; la main gauche tient le manche, près de la volute ; la droite
// tire l'archet, qui va et vient d'une image à l'autre en frottant les cordes près du chevalet.
// Le violon et la main du manche suivent le visage (cerveau grossi, tête de philosophe réduite) ;
// l'archet part de la main droite et passe toujours sur les cordes, quelle que soit la taille.
// Cycle de 8 images (7 par seconde) : tirer (0–3), pousser (4–7) ; notes à chaque changement d'archet.
import type { ActivityDef, EyesKind, MouthKind, PoseDef, Pt, PropArgs, Rig } from './types';
import { RisingNotes } from './notes';

const INK = '#231b11';
const VARNISH = '#b4642a';
const VARNISH_HI = '#d98a45';
const VARNISH_LO = '#7a3f17';
const CYCLE = 8;
/** Grossissement de la caisse : le violon doit se lire d'un coup d'œil. */
const K = 1.55;

// Repère du visage (celui du cerveau, de face) : le violon sous le menton, à droite pour nous.
/** Centre de la caisse. */
const BODY: Pt = [62, 62];
/** Main gauche sur le manche (près de la volute). */
const NECK_HAND: Pt = [85, 45];
/** Angle de l'instrument (caisse → volute). */
const ANGLE = Math.atan2(NECK_HAND[1] - BODY[1], NECK_HAND[0] - BODY[0]);

/** Main de l'archet : va et vient (tiré : vers l'extérieur, poussé : vers les cordes). */
function bowHand(f: number): Pt {
  const c = f % CYCLE;
  const u = c < 4 ? c / 3 : (7 - c) / 3; // 0 → 1 → 0
  return [44 - u * 22, 66 + u * 4];
}

function rig(f: number): Rig {
  const h = bowHand(f);
  const c = f % CYCLE;
  return {
    arms: [
      { a: [21, 54], b: [h[0] - 6, 78], c: h },
      // main du manche : repère du visage (faceHand), coude bien levé
      { a: [78, 54], b: [92, 60], c: NECK_HAND },
    ],
    legs: [
      { a: [42, 64], b: [40, 94], c: [37, 121] },
      { a: [57, 64], b: [59, 94], c: [62, 121] },
    ],
    // léger balancement avec l'archet
    lift: c === 3 || c === 7 ? -0.8 : 0,
    gaze: [1.4, 1],
    feet: 'stand',
    faceHand: 1,
  };
}

/** Violon dans le repère du visage, converti point par point (il suit la tête). */
function Violin({ onFace }: { onFace: (p: Pt) => Pt }) {
  const o = onFace(BODY);
  const p1 = onFace([BODY[0] + 10, BODY[1]]);
  // Têtes de compagnons réduites : le violon garde une taille d'instrument (il se règle sur le corps).
  const s = Math.max(Math.hypot(p1[0] - o[0], p1[1] - o[1]) / 10, 0.92);
  const deg = (ANGLE * 180) / Math.PI;
  // repère local : caisse centrée en 0, volute vers +x
  const len = Math.hypot(NECK_HAND[0] - BODY[0], NECK_HAND[1] - BODY[1]);
  return (
    <g transform={`translate(${o[0]} ${o[1]}) rotate(${deg}) scale(${s})`} strokeLinejoin="round" strokeLinecap="round">
      {/* manche, touche et volute */}
      <rect x={12} y={-1.6} width={len - 12} height={3.2} rx={1} fill="#2a211b" stroke={INK} strokeWidth={0.9} />
      <path d={`M${len - 1} -2.2 Q ${len + 3.4} -3.6 ${len + 3.6} 0 Q ${len + 3.4} 3.4 ${len - 1} 2.2 Z`} fill={VARNISH} stroke={INK} strokeWidth={0.9} />
      <circle cx={len + 1.8} cy={0} r={0.9} fill={VARNISH_LO} />
      <g transform={`scale(${K})`}>
      {/* caisse : deux lobes et la taille fine */}
      <path
        d="M-12 0 C -12 -6.2, -8.6 -7.6, -5.6 -6.4 C -3.6 -5.6, -2.6 -4.2, -0.6 -4.4 C 1.6 -4.6, 2.8 -6.6, 5.6 -6.2 C 8.6 -5.8, 9.2 -2.6, 9.2 0 C 9.2 2.6, 8.6 5.8, 5.6 6.2 C 2.8 6.6, 1.6 4.6, -0.6 4.4 C -2.6 4.2, -3.6 5.6, -5.6 6.4 C -8.6 7.6, -12 6.2, -12 0 Z"
        fill={VARNISH}
        stroke={INK}
        strokeWidth={1.1}
      />
      <path d="M-10 -3.6 C -8.6 -5.4, -6.6 -5.4, -5.6 -5" fill="none" stroke={VARNISH_HI} strokeWidth={0.9} opacity={0.8} />
      {/* ouïes */}
      <path d="M-3.4 -3 q 0.8 1.4 0 3 q -0.8 1.4 0 3" fill="none" stroke={INK} strokeWidth={0.6} transform="rotate(90 -3.4 0)" />
      <path d="M-1.6 2.6 q 1 -1.2 2.2 0" fill="none" stroke={INK} strokeWidth={0.6} />
      <path d="M-1.6 -2.6 q 1 1.2 2.2 0" fill="none" stroke={INK} strokeWidth={0.6} />
      {/* touche sur la caisse, chevalet, cordier */}
      <rect x={-1} y={-1.3} width={8} height={2.6} rx={0.6} fill="#2a211b" />
      <path d="M-3.2 -2.4 L -3.2 2.4" stroke="#e9d3a6" strokeWidth={1} />
      <path d="M-11.2 -1.2 L -6.4 -1.6 L -6.4 1.6 L -11.2 1.2 Z" fill="#2a211b" />
      {/* mentonnière */}
      <ellipse cx={-10.6} cy={-3.4} rx={2.4} ry={1.4} fill="#2a211b" />
      </g>
      {/* cordes */}
      {[-1.3, -0.45, 0.45, 1.3].map((y) => (
        <path key={y} d={`M${-9 * K} ${y} L ${len} ${y * 0.5}`} stroke="#efe6d2" strokeWidth={0.28} />
      ))}
    </g>
  );
}

/** Archet : de la main (hausse) jusqu'au-delà des cordes, en passant près du chevalet. */
function Bow({ hand, contact }: { hand: Pt; contact: Pt }) {
  const dx = contact[0] - hand[0];
  const dy = contact[1] - hand[1];
  const d = Math.hypot(dx, dy) || 1;
  const L = Math.max(d + 16, 40);
  const ux = dx / d;
  const uy = dy / d;
  const start: Pt = [hand[0] - ux * 3, hand[1] - uy * 3];
  const tip: Pt = [hand[0] + ux * L, hand[1] + uy * L];
  // la mèche, légèrement sous la baguette
  const nx = -uy * 1.3;
  const ny = ux * 1.3;
  return (
    <g strokeLinecap="round">
      <path d={`M${start[0] + nx} ${start[1] + ny} L ${tip[0] + nx * 0.4} ${tip[1] + ny * 0.4}`} stroke="#f3ead6" strokeWidth={1} />
      <path d={`M${start[0]} ${start[1]} L ${tip[0]} ${tip[1]}`} stroke={INK} strokeWidth={1.6} />
      <path d={`M${start[0]} ${start[1]} L ${start[0] + nx * 1.6} ${start[1] + ny * 1.6}`} stroke={INK} strokeWidth={2.2} />
      <circle cx={start[0]} cy={start[1]} r={1} fill="#d9a441" stroke={INK} strokeWidth={0.5} />
    </g>
  );
}

export const pose: PoseDef = {
  seated: false,
  fps: 7,
  rig,
  mid: ({ onFace }: PropArgs) => <Violin onFace={onFace} />,
  over: ({ frame, rig: r, onFace }: PropArgs) => {
    // point de frottement : sur les cordes, entre le chevalet et la touche
    const contact = onFace([BODY[0] - 1, BODY[1] - 0.6]);
    const c = frame % CYCLE;
    return (
      <g>
        <Bow hand={r.arms[0].c} contact={contact} />
        <RisingNotes
          frame={frame}
          from={[
            [Math.min(92, contact[0] + 16), contact[1] - 14],
            [Math.min(94, contact[0] + 22), contact[1] - 6],
            [Math.min(90, contact[0] + 12), contact[1] - 20],
          ]}
          drift={c < 4 ? 1 : -1}
        />
      </g>
    );
  },
  eyes: (f): EyesKind => (Math.floor(f / CYCLE) % 2 ? 'happy' : 'lidded'),
  mouth: (f): MouthKind => (f % CYCLE === 4 ? 'o' : 'smile'),
};

export const activity: ActivityDef = {
  id: 'violin',
  w: 2,
  acts: () => [
    { pose: 'violin', ms: 3200, view: 'front' },
    { pose: 'violin', ms: 5500, view: 'front', say: 'act:violin' },
    { pose: 'violin', ms: 3800, view: 'front' },
  ],
  lines: {
    all: ['Un petit air, entre deux chapitres.', 'Tout est question de tension… des cordes comme des idées.', 'Pardon pour le grincement, c’était une note de bas de page.', 'L’archet va, l’archet vient, la pensée aussi.'],
    vivaldi: ['Quatre cordes, quatre saisons, une seule page.', 'Un allegro pour réveiller tes extraits !'],
  },
};
