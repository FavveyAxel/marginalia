// Activité « meditate » (cerveau seulement) : assis en tailleur sur le bord de l'encadré, jambes repliées
// devant lui (genoux écartés, pieds rentrés), mains posées sur les genoux en mudra (pouce et index en
// cercle), yeux fermés, sourire paisible. Il lévite doucement et des ondes calmes s'élargissent autour
// de lui. Cycle de 12 images, à 3 images par seconde.
import type { ActivityDef, PoseDef, PropArgs, Rig } from './types';

const INK = '#231b11';
const CYCLE = 12;
const W_LIMB = [3.2, 3.8, 4.5, 5.3, 6.2];
const CALM = '#7f9c94';

/** Lévitation : 0 → -3 → 0, lentement. */
const bob = (f: number) => -1.5 * (1 - Math.cos((2 * Math.PI * (f % CYCLE)) / CYCLE));
/** Le cerveau est remonté de BASE pour que les jambes repliées sous lui reposent sur le bord (y = 70). */
const BASE = -12;
const lift = (f: number) => BASE + bob(f);

// Genoux (repère du cerveau) ; les mains s'y posent.
const KNEE_L: [number, number] = [9, 78];
const KNEE_R: [number, number] = [90, 78];

function rig(f: number): Rig {
  const breathe = Math.sin((2 * Math.PI * (f % CYCLE)) / CYCLE) * 0.6;
  return {
    arms: [
      { a: [21, 54], b: [4, 62 + breathe], c: [KNEE_L[0] + 1, KNEE_L[1] - 5] },
      { a: [78, 54], b: [95, 62 + breathe], c: [KNEE_R[0] - 1, KNEE_R[1] - 5] },
    ],
    // jambes dessinées à part (en tailleur, devant le cerveau)
    legs: [
      { a: [42, 64], b: [30, 70], c: [17, 71] },
      { a: [57, 64], b: [70, 70], c: [82, 71] },
    ],
    lift: lift(f),
    gaze: [0, 0],
    feet: 'none',
  };
}

/** Jambes en tailleur, vues de face : cuisses vers les genoux écartés, tibias croisés devant, pieds rentrés. */
function Legs({ level }: { level: number }) {
  const w = W_LIMB[level] ?? 4.5;
  const leg = (d: string) => <path d={d} fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />;
  return (
    <g>
      {/* tibia droit (derrière), du genou droit vers le pied gauche */}
      {leg(`M${KNEE_R[0]} ${KNEE_R[1]} Q 72 86, 41 77`)}
      {/* cuisses */}
      {leg(`M38 64 Q 18 68, ${KNEE_L[0]} ${KNEE_L[1]}`)}
      {leg(`M61 64 Q 81 68, ${KNEE_R[0]} ${KNEE_R[1]}`)}
      {/* tibia gauche (devant), du genou gauche vers le pied droit */}
      {leg(`M${KNEE_L[0]} ${KNEE_L[1]} Q 27 86, 58 77`)}
      {/* pieds rentrés, plante vers le haut */}
      <ellipse cx={40} cy={75.5} rx={4.4} ry={2.7} transform="rotate(-18 40 75.5)" fill="currentColor" />
      <ellipse cx={59} cy={75.5} rx={4.4} ry={2.7} transform="rotate(18 59 75.5)" fill="currentColor" />
      {/* genoux arrondis */}
      <circle cx={KNEE_L[0]} cy={KNEE_L[1]} r={w * 0.62} fill="currentColor" />
      <circle cx={KNEE_R[0]} cy={KNEE_R[1]} r={w * 0.62} fill="currentColor" />
    </g>
  );
}

function mid({ level }: PropArgs) {
  return <Legs level={level} />;
}

/** Ombre douce sur le bord, plus petite quand il s'élève ; ondes calmes qui s'élargissent. */
function back({ frame }: PropArgs) {
  const c = frame % CYCLE;
  const up = -bob(frame) / 3; // 0..1
  return (
    <g>
      <ellipse cx={50} cy={72} rx={30 - up * 5} ry={2.4 - up * 0.6} fill={INK} opacity={0.14 - up * 0.05} />
      <g fill="none" stroke={CALM}>
        {[0, 1, 2].map((i) => {
          const age = (c - i * 4 + CYCLE) % CYCLE; // 0..11
          const t = age / CYCLE;
          const r = 40 + t * 26;
          return <ellipse key={i} cx={50} cy={46} rx={r} ry={r * 0.78} strokeWidth={1.4 - t * 0.7} opacity={0.42 * (1 - t) * Math.min(1, age / 1.5 + 0.35)} />;
        })}
      </g>
    </g>
  );
}

/** Mudra : pouce et index forment un petit cercle au-dessus de chaque main. */
function over({ rig: r, frame }: PropArgs) {
  const c = frame % CYCLE;
  const sparkle = c % 4 === 1;
  return (
    <g>
      {r.arms.map((l, i) => {
        const [x, y] = l.c;
        const dx = i ? -1 : 1;
        return (
          <g key={i}>
            <circle cx={x + dx * 2.6} cy={y - 2.8} r={2.1} fill="#fffaf0" stroke={INK} strokeWidth={1.2} />
            <path d={`M${x - dx * 1.4} ${y - 2} l ${-dx * 1.6} -2.6 M${x - dx * 0.2} ${y - 2.6} l ${-dx * 0.8} -3`} stroke={INK} strokeWidth={1.1} strokeLinecap="round" />
          </g>
        );
      })}
      {sparkle && (
        <g fill={CALM} opacity={0.7}>
          <circle cx={14} cy={30} r={1} />
          <circle cx={86} cy={26} r={1.2} />
        </g>
      )}
    </g>
  );
}

export const pose: PoseDef = {
  seated: true,
  fps: 3,
  rig,
  mid,
  back,
  over,
  eyes: () => 'closed',
  mouth: () => 'smirk',
};

export const activity: ActivityDef = {
  id: 'meditate',
  w: 2,
  chars: ['brain'],
  acts: () => [
    { pose: 'meditate', ms: 4000, view: 'front' },
    { pose: 'meditate', ms: 5000, view: 'front', say: 'act:meditate' },
    { pose: 'meditate', ms: 5000, view: 'front' },
  ],
  lines: {
    brain: ['Ommm… je pense, donc je flotte.', 'Vider la tête. Pas simple, pour un cerveau.', 'Inspire… les idées. Expire… les doutes.', 'Ici et maintenant. Surtout ici.'],
  },
};
