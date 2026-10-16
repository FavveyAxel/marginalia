// Socrate : crâne chauve en dôme, couronne de boucles grises autour des oreilles, gros sourcils
// broussailleux, le fameux nez camus, sourire bonhomme. Chiton sable, himation blanc cassé jeté sur
// l'épaule gauche, sandales. Ce qui grandit : sa barbe bouclée, courte sous le menton au niveau 0,
// jusqu'à la ceinture et au-delà au niveau 4 (posée sur les genoux quand il est assis).
import type { ReactNode } from 'react';
import type { CharacterDef, DrawArgs } from './types';
import type { Level } from '../Sprite';

const SKIN = '#f1d3b8';
const SKIN_DARK = '#e2b493';
const HAIR = '#ece8df';
const HAIR_SHADE = '#b9b2a4';
const CHITON = '#d4b47c';
const CHITON_SHADE = '#ad8b52';
const HIMATION = '#ebe3cf';
const HIMATION_SHADE = '#c9bea3';

type C = [number, number, number];

/** Nuage bouclé : cercles cernés d'encre puis remplis par-dessus (le contour ne reste qu'à l'extérieur). */
function Cloud({ cs, fill, sw = 2 }: { cs: C[]; fill: string; sw?: number }) {
  return (
    <g>
      {cs.map(([x, y, r], i) => (
        <circle key={'o' + i} cx={x} cy={y} r={r} fill={fill} stroke="currentColor" strokeWidth={sw * 2} />
      ))}
      {cs.map(([x, y, r], i) => (
        <circle key={'f' + i} cx={x} cy={y} r={r} fill={fill} />
      ))}
    </g>
  );
}

/** Petites boucles (« c » plus sombres) dans les cercles d'un nuage. */
function Curls({ cs, color = HAIR_SHADE, w = 1 }: { cs: C[]; color?: string; w?: number }) {
  return (
    <g fill="none" stroke={color} strokeWidth={w} strokeLinecap="round">
      {cs.map(([x, y, r], i) => {
        const s = Math.min(r * 0.42, 3.2);
        const d = i % 2 ? `M${x - s} ${y - s * 0.3} q${s} ${s * 1.5} ${s * 2} 0` : `M${x - s * 0.6} ${y + s * 0.6} q${s * 1.2} ${-s * 1.6} ${s * 1.8} ${s * 0.3}`;
        return <path key={i} d={d} />;
      })}
    </g>
  );
}

const SPEC = {
  /** pointe de la barbe (repère de la tête, avant réduction) */
  tip: [73, 84, 96, 108, 121],
  jaw: [5, 6, 7, 7.8, 8.6],
  top: [7, 9.5, 11, 12.5, 13.5],
  bot: [5, 6, 6.6, 7.2, 7.6],
};

/** Barbe de face : favoris le long de la mâchoire, puis une colonne de boucles jusqu'à la pointe. */
function beardFront(level: Level): C[] {
  const jr = SPEC.jaw[level];
  const cs: C[] = [
    [25.5, 47, jr * 0.8],
    [27, 54, jr],
    [32, 60, jr],
    [40, 64, jr],
    [72.5, 47, jr * 0.8],
    [71, 54, jr],
    [66, 60, jr],
    [58, 64, jr],
  ];
  const T = SPEC.tip[level];
  const y0 = 66;
  const rows = Math.max(1, Math.round((T - y0) / 6.5));
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const r = SPEC.top[level] + (SPEC.bot[level] - SPEC.top[level]) * t;
    const y = y0 + (T - r - y0) * t;
    const w = (1 - t) * (6 + level * 1.4) + 1.5;
    const sway = i % 2 ? 1.6 : -1.6;
    if (i === rows) cs.push([49 + sway * 0.5, y, r]);
    else cs.push([49 - w + sway, y, r], [49 + w + sway, y, r]);
  }
  return cs;
}

/** Barbe de profil : favori devant l'oreille, menton, puis la barbe tombe vers l'avant et revient sur la poitrine. */
function beardSide(level: Level, seated: boolean): C[] {
  const jr = SPEC.jaw[level];
  const cs: C[] = [
    [64, 44, jr * 0.9],
    [66, 51, jr],
    [73, 54.5, jr],
    [81, 54, jr * 0.95],
    [86.5, 51.5, jr * 0.75],
  ];
  const full = SPEC.tip[level];
  const T = seated ? Math.min(full, 96) : full;
  const xAt = (y: number) => 80 - (y - 58) * 0.26;
  const y0 = 58;
  const rows = Math.max(1, Math.round((T - y0) / 6.5));
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const r = SPEC.top[level] * 0.85 + (SPEC.bot[level] - SPEC.top[level] * 0.85) * t;
    const y = y0 + (T - r - y0) * t;
    const w = (1 - t) * (3 + level) + 1;
    const x = xAt(y) + (i % 2 ? 1.2 : -1.2);
    if (i === rows) cs.push([x, y, r]);
    else cs.push([x - w, y, r], [x + w, y, r]);
  }
  if (seated && full > T) {
    // le reste repose sur les cuisses, étalé vers l'avant et l'arrière
    const extra = full - T;
    const x0 = xAt(T);
    const r = SPEC.bot[level];
    for (let x = x0 - extra * 0.35; x <= x0 + extra * 0.45; x += 5.5) cs.push([x, T - r * 0.6 + Math.abs(x - x0) * 0.06, r]);
  }
  return cs;
}

function skinGrad(uid: string) {
  const id = `soc-skin-${uid}`;
  return {
    id,
    def: (
      <radialGradient id={id} cx="0.38" cy="0.28" r="0.8">
        <stop offset="0" stopColor="#fbe8d8" />
        <stop offset="0.55" stopColor={SKIN} />
        <stop offset="1" stopColor="#d9a986" />
      </radialGradient>
    ),
  };
}

function head({ view, level, seated, uid }: DrawArgs): ReactNode {
  const g = skinGrad(uid);
  if (view === 'side') {
    const fringe: C[] = [
      [55, 27, 3.6],
      [50, 26, 4.2],
      [46.5, 31, 4.6],
      [45.5, 37.5, 4.8],
      [47.5, 44, 4.6],
      [52.5, 48.5, 4.2],
    ];
    return (
      <g>
        <defs>{g.def}</defs>
        <path d="M45 34 C 44 20, 56 12, 70 12 C 81 12, 88 19, 88.5 28 L 88.2 37 C 89.8 39, 90.6 42, 89.8 45 C 89.2 49, 86 53, 80 55 C 72 57.5, 62 56, 56 52 C 50 48, 45.5 42, 45 34 Z" fill={`url(#${g.id})`} stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round" />
        <ellipse cx={63} cy={18} rx={7} ry={3} transform="rotate(-14 63 18)" fill="#fff8ee" opacity={0.6} />
        <g fill="none" stroke={SKIN_DARK} strokeWidth={1.1} strokeLinecap="round">
          <path d="M74 17.5 Q 79 16, 84 18.5" />
          <path d="M75 21 Q 79.5 19.8, 84.5 22" />
        </g>
        <Cloud cs={fringe} fill={HAIR} sw={1.1} />
        <Curls cs={fringe} w={0.8} />
        <ellipse cx={58.5} cy={36} rx={4.4} ry={6.2} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
        <path d="M59.6 32.4 Q 56.6 35.6, 59.2 39.6" fill="none" stroke={SKIN_DARK} strokeWidth={1.2} strokeLinecap="round" />
        <Cloud cs={beardSide(level, seated)} fill={HAIR} sw={1.1} />
        <Curls cs={beardSide(level, seated).slice(1)} w={0.9} />
      </g>
    );
  }
  if (view === 'back') {
    const fringe: C[] = [
      [22, 38, 5],
      [21, 46, 5.4],
      [25, 53, 5.4],
      [31.5, 58, 5.2],
      [39.5, 61, 5],
      [49, 62, 5],
      [58.5, 61, 5],
      [66.5, 58, 5.2],
      [73, 53, 5.4],
      [77, 46, 5.4],
      [76, 38, 5],
    ];
    const side = level >= 1 ? 4 + level * 1.6 : 0;
    return (
      <g>
        <defs>{g.def}</defs>
        {side > 0 && (
          <Cloud
            cs={[
              [22, 60, side],
              [76, 60, side],
              [27, 65, side * 0.9],
              [71, 65, side * 0.9],
            ]}
            fill={HAIR}
            sw={1.1}
          />
        )}
        <ellipse cx={20} cy={45} rx={4.4} ry={6.2} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
        <ellipse cx={78} cy={45} rx={4.4} ry={6.2} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
        <path d="M24 44 C 21 25, 33 13, 49 13 C 65 13, 77 25, 74 44 C 73 56, 63 63, 49 63 C 35 63, 25 56, 24 44 Z" fill={`url(#${g.id})`} stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round" />
        <ellipse cx={42} cy={21} rx={8} ry={3.4} transform="rotate(-16 42 21)" fill="#fff8ee" opacity={0.55} />
        <Cloud cs={fringe} fill={HAIR} sw={1.1} />
        <Curls cs={fringe} w={0.8} />
      </g>
    );
  }
  const fringe: C[] = [
    [27, 27, 3.6],
    [22, 31, 4.6],
    [17.5, 37, 5],
    [16, 44, 5],
    [17.5, 51, 4.6],
    [21.5, 56.5, 4],
  ];
  const fringeR = fringe.map(([x, y, r]) => [98 - x, y, r] as C);
  const beard = beardFront(level);
  return (
    <g>
      <defs>{g.def}</defs>
      <Cloud cs={[...fringe, ...fringeR]} fill={HAIR} sw={1.1} />
      <Curls cs={[...fringe, ...fringeR]} w={0.8} />
      <ellipse cx={19.5} cy={46} rx={4.4} ry={6.4} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
      <ellipse cx={78.5} cy={46} rx={4.4} ry={6.4} fill={SKIN} stroke="currentColor" strokeWidth={1.8} />
      <path d="M20 43 Q 18.4 46, 20.6 49.4 M78 43 Q 79.6 46, 77.4 49.4" fill="none" stroke={SKIN_DARK} strokeWidth={1.2} strokeLinecap="round" />
      <path d="M24 46 C 21 26, 33 13, 49 13 C 65 13, 77 26, 74 46 C 73 58, 63 66, 49 66 C 35 66, 25 58, 24 46 Z" fill={`url(#${g.id})`} stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round" />
      <ellipse cx={39} cy={20.5} rx={8} ry={3.4} transform="rotate(-18 39 20.5)" fill="#fff8ee" opacity={0.6} />
      {/* front plissé du penseur */}
      <g fill="none" stroke={SKIN_DARK} strokeWidth={1.1} strokeLinecap="round">
        <path d="M39 24.5 Q 49 21.5, 59 24.5" />
        <path d="M41 28 Q 49 25.6, 57 28" />
      </g>
      {/* pattes d'oie */}
      <g fill="none" stroke={SKIN_DARK} strokeWidth={0.9} strokeLinecap="round">
        <path d="M28.5 41.5 L 26 40.5 M28.4 44 L 25.8 44.4" />
        <path d="M67.5 41.5 L 70 40.5 M67.6 44 L 70.2 44.4" />
      </g>
      <Cloud cs={beard} fill={HAIR} sw={1.1} />
      <Curls cs={beard.slice(8)} w={0.9} />
      <Curls cs={beard.slice(0, 8).filter((_, i) => i % 2)} w={0.8} />
    </g>
  );
}

/** Sourcils broussailleux : trait d'encre épais, puis la couleur des cheveux par-dessus. */
function Brow({ d }: { d: string }) {
  return (
    <g fill="none" strokeLinecap="round">
      <path d={d} stroke="currentColor" strokeWidth={5.2} />
      <path d={d} stroke={HAIR} strokeWidth={3} />
    </g>
  );
}

function overFace({ view, pose }: DrawArgs): ReactNode {
  const cigar = pose === 'cigar';
  if (view === 'side') {
    return (
      <g>
        <Brow d={cigar ? 'M70.5 21.6 Q75 17.6 80.2 20.6' : 'M70.5 22.4 Q75.5 19.2 81 21.8'} />
        {/* nez camus : court, rond, retroussé */}
        <path d="M87.6 28.6 C 90.4 30.6, 95.4 34.4, 94.8 37.6 C 94.3 40.2, 91 40.6, 88.6 39.4" fill={SKIN} stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" />
        <ellipse cx={91.3} cy={38.5} rx={1.1} ry={0.7} fill="currentColor" opacity={0.75} />
        <ellipse cx={92.6} cy={34.4} rx={1.2} ry={0.8} fill="#fff8ee" opacity={0.7} />
        <path d="M90 39.8 C 86.5 38.8, 81.6 39, 78.6 42 C 81.6 40.9, 85.2 40.7, 89 40.6 Z" fill={HAIR} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />
      </g>
    );
  }
  return (
    <g>
      {cigar ? (
        <g>
          <Brow d="M31 34.5 Q36.5 29 43 33" />
          <Brow d="M53.5 36.4 Q59 35.2 64.5 36.8" />
        </g>
      ) : (
        <g>
          <Brow d="M30.5 35 Q36 31 43 33.2" />
          <Brow d="M55 33.2 Q62 31 67.5 35" />
        </g>
      )}
      {/* nez camus vu de face : une boule large, narines visibles */}
      <ellipse cx={48} cy={46.4} rx={4.6} ry={3} fill={SKIN} stroke="currentColor" strokeWidth={1.5} />
      <ellipse cx={46.3} cy={47.6} rx={0.9} ry={0.6} fill="currentColor" opacity={0.75} />
      <ellipse cx={49.7} cy={47.6} rx={0.9} ry={0.6} fill="currentColor" opacity={0.75} />
      <ellipse cx={46.6} cy={45.2} rx={1.3} ry={0.7} fill="#fff8ee" opacity={0.75} />
      {/* moustache : deux mèches qui encadrent la bouche */}
      <path d="M48 49.3 C 45 48.3, 41.2 48.6, 38.6 52.4 C 41.2 50.8, 44 50.2, 46.2 50 Z" fill={HAIR} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />
      {!cigar && <path d="M48 49.3 C 51 48.3, 54.8 48.6, 57.4 52.4 C 54.8 50.8, 52 50.2, 49.8 50 Z" fill={HAIR} stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />}
    </g>
  );
}

const fold = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' as const, opacity: 0.5 };

function body({ view, seated, pose }: DrawArgs): ReactNode {
  // en l'air (saut), la tunique remonte pour laisser voir les jambes repliées
  const jump = pose === 'jump';
  const ink = { stroke: 'currentColor', strokeWidth: 2.1, strokeLinejoin: 'round' as const };
  if (view === 'side') {
    const neck = <path d="M49 31 C 49.6 36, 48.6 40, 48 45 L 57.6 45 C 57.8 40, 58.6 36, 60 31 Z" fill={SKIN} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />;
    const hem = jump ? 80 : 88;
    if (seated) {
      return (
        <g>
          {neck}
          {/* chiton : torse, puis le giron posé sur les cuisses */}
          <path d="M44 41.5 C 51 39.5, 58.5 41.5, 60.5 47.5 C 62 53, 59 56, 60 58 C 64 60, 68 62, 68.5 66 L 68 71.5 L 40.5 71.5 C 39.5 64, 40 47, 44 41.5 Z" fill={CHITON} {...ink} />
          {/* himation : sur l'épaule, puis enroulé sur le giron */}
          <path d="M43.6 41.7 C 49 40, 54.5 41, 57 44.5 C 56 51, 56.5 56, 59.5 58.5 C 64 60.5, 67.5 62.5, 68.2 66 L 67.6 71.5 L 40.5 71.5 C 39.6 63, 40 47, 43.6 41.7 Z" fill={HIMATION} {...ink} />
          <path d="M56.4 45 C 55.4 51, 56 56.4, 59.6 58.6" {...fold} />
          <path d="M45 60 Q 54 62, 66 65" {...fold} />
          <path d="M44 66 Q 54 67.4, 65 69" {...fold} />
        </g>
      );
    }
    return (
      <g>
        {neck}
        <path d={`M44 41.5 C 51 39.5, 58.5 41.5, 60.5 47.5 C 62 53, 60 57, 60.5 63 L 62 ${hem} Q 51 ${hem + 2.6}, 40 ${hem} L 41.4 64 C 40 56, 40 47, 44 41.5 Z`} fill={CHITON} {...ink} />
        <path d={`M43.6 41.7 C 49 40, 54.5 41, 57 44.5 C 56 51, 57 57, 60.6 61.5 L 61.6 ${hem - 2.6} Q 51 ${hem - 0.2}, 40.2 ${hem - 2.6} L 41.5 64 C 40 56, 40 47, 43.6 41.7 Z`} fill={HIMATION} {...ink} />
        <path d="M56.4 45 C 55.4 51, 56.6 57, 60 61.6" {...fold} />
        <path d={`M46 47 C 45 56, 45.5 ${hem - 18}, 45 ${hem - 4}`} {...fold} />
        <path d={`M53 62 C 52.5 70, 54 ${hem - 10}, 53.5 ${hem - 2}`} {...fold} />
      </g>
    );
  }
  const back = view === 'back';
  // De dos, l'himation passe sur l'épaule gauche, donc à gauche à l'écran.
  const flipX = back ? 'translate(98 0) scale(-1 1)' : undefined;
  const neck = <path d="M43.5 36 L 43.5 45 L 54.5 45 L 54.5 36 Z" fill={SKIN} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />;
  const hem = seated ? 77 : jump ? 80 : 88;
  return (
    <g>
      {neck}
      <path
        d={
          seated
            ? `M38 43.5 Q 49 41, 60 43.5 C 63.8 44.6, 64.6 48.6, 63.4 52 L 61 62 C 64 66, 66 70, 66.4 ${hem} Q 49 ${hem + 3}, 31.6 ${hem} C 32 70, 34 66, 37 62 L 34.6 52 C 33.4 48.6, 34.2 44.6, 38 43.5 Z`
            : `M38 43.5 Q 49 41, 60 43.5 C 63.8 44.6, 64.6 48.6, 63.4 52 L 60.4 64 L 64.6 ${hem} Q 49 ${hem + 3}, 33.4 ${hem} L 37.6 64 L 34.6 52 C 33.4 48.6, 34.2 44.6, 38 43.5 Z`
        }
        fill={CHITON}
        {...ink}
      />
      <g transform={flipX}>
        {/* encolure du chiton (côté découvert) */}
        {!back && <path d="M41 44 Q 45 47.5, 49 46" fill="none" stroke={CHITON_SHADE} strokeWidth={1.2} strokeLinecap="round" />}
        <path
          d={
            seated
              ? `M51 43 C 56 42, 62.6 43.4, 64.2 48.4 C 64.6 52, 62.5 58, 62 62 C 65 66, 66.6 70, 66.6 ${hem - 2} Q 49 ${hem + 1}, 32.2 ${hem - 2} C 32.6 71, 34.6 67, 37.4 64.4 C 42 58, 47 51, 51 43 Z`
              : `M51 43 C 56 42, 62.6 43.4, 64.2 48.4 C 64.6 52, 62.5 58, 61.2 64 L 65 ${hem - 2.6} Q 49 ${hem + 0.4}, 33 ${hem - 2.6} L 36.2 70 C 41 61, 46.5 52, 51 43 Z`
          }
          fill={HIMATION}
          {...ink}
        />
        <path d="M55.6 46 C 51.6 54, 46 61, 40.4 68" {...fold} />
        <path d="M60.4 50.6 C 57 59, 52 66, 46.4 72" {...fold} />
        {seated ? (
          <path d="M38 73 Q 49 75, 61 73" {...fold} />
        ) : (
          <g>
            <path d="M55.6 70 C 56.4 75, 56.6 80, 57.6 84.6" {...fold} />
            <path d="M47.4 74 C 47 78, 46.4 82, 45.6 85.4" {...fold} />
          </g>
        )}
      </g>
      {/* ourlet du chiton qui dépasse */}
      <path d={seated ? '' : `M35.4 ${hem - 0.2} Q 49 ${hem + 2.4}, 62.8 ${hem - 0.2}`} stroke={CHITON_SHADE} strokeWidth={1} fill="none" opacity={0.8} />
    </g>
  );
}

export const socrate: CharacterDef = {
  id: 'socrate',
  name: 'Socrate',
  grows: 'sa barbe',
  skin: SKIN,
  limbs: { arm: SKIN, leg: SKIN, shoe: '#8a5a36' },
  body,
  head,
  overFace,
};
