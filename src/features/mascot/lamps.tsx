// Lampes de nuit (thème sombre) : chaque compagnon a une source de lumière de son époque.
//   cerveau  : petite lampe de banquier (abat-jour de verre vert, laiton), cône de lumière chaude ;
//   Socrate  : lanterne de terre cuite ventrue, percée de trous (la lumière en points), toit conique ;
//   Platon   : lanterne cylindrique de bronze à vitres de corne (lumière ambrée), anse en étrier ;
//   Aristote : lanterne de bronze ouvragée, vitres à croisillons, dôme ajouré, fleuron, trois pieds ;
//   Rousseau : lanterne à main du XVIIIe siècle (laiton, vitres, bougie, anneau pour la tenir).
// Repère local de chaque dessin : base au centre (0, 0), le haut vers les y négatifs, bec vers +x.
// Posée (`held` faux) : (x, y) est le point d'appui de la base sur l'encadré ; les lampes à bec sont
// retournées pour que la flamme soit du côté extérieur. Tenue (`held`) : (x, y) est la main ; les
// lanternes pendent à leur anneau, la lampe de banquier est tenue par sa tige.
import type { ReactNode } from 'react';
import type { CharId } from './characters/types';

type Pt = [number, number];
const INK = '#231b11';

type Spec = {
  /** Point de la flamme (repère local), centre de la lueur. */
  flame: Pt;
  /** Point tenu par la main (repère local). */
  grip: Pt;
  /** Échelles posée / tenue. */
  placed: number;
  held: number;
  /** Posée : retournée (bec vers l'extérieur, à gauche). */
  mirror: boolean;
};

const SPECS: Record<CharId, Spec> = {
  brain: { flame: [1.2, -8.6], grip: [-3.6, -6], placed: 1.15, held: 0.9, mirror: true },
  socrate: { flame: [0, -4.6], grip: [0, -16.6], placed: 1, held: 0.9, mirror: false },
  platon: { flame: [0, -5.8], grip: [0, -17.2], placed: 1, held: 0.9, mirror: false },
  aristote: { flame: [0, -6.4], grip: [0, -18.8], placed: 0.95, held: 0.85, mirror: false },
  rousseau: { flame: [0, -6.6], grip: [0, -16.6], placed: 1, held: 0.9, mirror: false },
};

const spec = (c: string | undefined): Spec => SPECS[(c as CharId) in SPECS ? (c as CharId) : 'brain'];

/** Transformation du repère local vers le Sprite. */
function place(s: Spec, x: number, y: number, held: boolean) {
  // Posée, un peu plus grande pour se voir à la taille réelle du compagnon.
  const k = held ? s.held : s.placed * 1.35;
  const m = !held && s.mirror ? -1 : 1;
  const [gx, gy] = held ? s.grip : [0, 0];
  return {
    transform: `translate(${x} ${y}) scale(${m * k} ${k}) translate(${-gx} ${-gy})`,
    at: ([px, py]: Pt): Pt => [x + m * k * (px - gx), y + k * (py - gy)],
  };
}

/** Position de la flamme dans le repère du Sprite (pour centrer la lueur). */
export function lampFlame(char: string | undefined, x: number, y: number, held: boolean): Pt {
  const s = spec(char);
  return place(s, x, y, held).at(s.flame);
}

/** Petite flamme vacillante (base en (0, 0)) : trois silhouettes alternent selon l'image. */
function Flame({ x, y, s = 1, frame }: { x: number; y: number; s?: number; frame: number }) {
  const v = [
    { sx: 1, sy: 1, sk: 0 },
    { sx: 0.9, sy: 1.12, sk: -7 },
    { sx: 1.06, sy: 0.92, sk: 6 },
  ][frame % 3];
  return (
    <g transform={`translate(${x} ${y}) scale(${s * v.sx} ${s * v.sy}) skewX(${v.sk})`}>
      <circle cx={0} cy={-2} r={3} fill="#ffcf7a" opacity={0.35} />
      <path d="M0 0.4 C -2.1 -0.2, -2.1 -2.8, 0 -5.8 C 2.1 -2.8, 2.1 -0.2, 0 0.4 Z" fill="#ff9a3c" stroke="#c4561e" strokeWidth={0.35} />
      <path d="M0 0 C -1.1 -0.4, -1 -1.9, 0 -3.4 C 1 -1.9, 1.1 -0.4, 0 0 Z" fill="#fff1b8" />
    </g>
  );
}

// ── Dessins (repère local) ──────────────────────────────────

/** Lampe de banquier : socle et tige de laiton, abat-jour de verre vert, ampoule chaude. */
function Banker({ frame, held }: { frame: number; held: boolean }) {
  const lit = frame % 3 === 1 ? 0.9 : 1;
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      {!held && <path d="M-5.8 -8.8 L 8.2 -8.8 L 11.5 0 L -9 0 Z" fill="#ffd98a" opacity={0.13} />}
      {/* socle */}
      <path d="M-6.2 0 L 6.2 0 L 5 -1.9 L -5 -1.9 Z" fill="#c9a24a" stroke={INK} strokeWidth={0.9} />
      <path d="M-4.4 -1.4 L 4.4 -1.4" stroke="#f3dc93" strokeWidth={0.5} opacity={0.8} />
      {/* tige courbe */}
      <path d="M-3.6 -1.9 L -3.6 -8.4 Q -3.6 -10.2 -1.6 -10.2" fill="none" stroke={INK} strokeWidth={2.3} />
      <path d="M-3.6 -1.9 L -3.6 -8.4 Q -3.6 -10.2 -1.6 -10.2" fill="none" stroke="#d8b65a" strokeWidth={1} />
      {/* abat-jour : demi-cylindre vert, intérieur éclairé */}
      <ellipse cx={1.2} cy={-8.8} rx={6.8} ry={1} fill="#fff1c4" opacity={lit} />
      <path d="M-5.6 -8.8 C -5 -13.2, 7.4 -13.2, 8 -8.8 Z" fill="#2f7a52" stroke={INK} strokeWidth={0.95} />
      <path d="M-3.6 -10.4 C -2.4 -12, 3 -12.3, 5.2 -11.2" fill="none" stroke="#8fd3a6" strokeWidth={0.7} opacity={0.75} />
      <path d="M-5.6 -8.8 L 8 -8.8" stroke="#c9a24a" strokeWidth={0.7} />
      <ellipse cx={1.2} cy={-8.4} rx={1.7} ry={0.8} fill="#fffbe6" opacity={lit} />
      {/* chaînette */}
      <path d="M6 -8.6 L 6 -6.4" stroke="#c9a24a" strokeWidth={0.4} />
      <circle cx={6} cy={-6.1} r={0.45} fill="#c9a24a" stroke={INK} strokeWidth={0.25} />
    </g>
  );
}

/** Anneau de suspension (centre en (0, cy)). */
function Ring({ cy, color }: { cy: number; color: string }) {
  return (
    <>
      <circle cx={0} cy={cy} r={1.5} fill="none" stroke={INK} strokeWidth={1.7} />
      <circle cx={0} cy={cy} r={1.5} fill="none" stroke={color} strokeWidth={0.7} />
    </>
  );
}

/** Socrate : lanterne de terre cuite ventrue, percée de petits trous (la lumière en points),
 * une petite porte cintrée où l'on voit la flamme, toit conique et anneau. */
function ClayLantern({ frame }: { frame: number }) {
  const clay = '#c8703f';
  const lit = frame % 3 === 1 ? '#ffe7a6' : '#ffd27a';
  const holes: Pt[] = [
    [-3.4, -4], [3.4, -4], [-3.8, -6.4], [3.8, -6.4], [-3.2, -8.8], [3.2, -8.8],
    [-2, -10.4], [0, -10.6], [2, -10.4], [-1.2, -8.9], [1.2, -8.9],
  ];
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      <Ring cy={-15.4} color={clay} />
      {/* corps ventru et toit conique */}
      <path d="M-3.4 -1.4 C -5.6 -4, -5.4 -8.6, -3.4 -10.8 L -1.2 -13.6 L 1.2 -13.6 L 3.4 -10.8 C 5.4 -8.6, 5.6 -4, 3.4 -1.4 Z" fill={clay} stroke={INK} strokeWidth={0.9} />
      <path d="M-3.4 -10.8 Q 0 -10 3.4 -10.8" fill="none" stroke="#8e4522" strokeWidth={0.6} />
      <path d="M2.6 -2.4 C 4.4 -4.6, 4.4 -8, 2.8 -9.8" fill="none" stroke="#8e4522" strokeWidth={0.8} opacity={0.6} />
      <path d="M-3.8 -8.4 C -4.4 -6.6, -4.2 -4.6, -3.4 -3.2" fill="none" stroke="#efb184" strokeWidth={0.5} opacity={0.8} />
      {/* porte cintrée, éclairée, avec la flamme */}
      <path d="M-1.7 -1.8 L -1.7 -6.4 Q 0 -8.6 1.7 -6.4 L 1.7 -1.8 Z" fill={lit} stroke={INK} strokeWidth={0.55} />
      <Flame x={0} y={-2.6} s={0.6} frame={frame} />
      {holes.map(([hx, hy], i) => (
        <circle key={i} cx={hx} cy={hy} r={0.48} fill={lit} stroke="#5a2a12" strokeWidth={0.2} />
      ))}
      {/* pied */}
      <path d="M-3.8 -1.6 L 3.8 -1.6 L 3.4 0 L -3.4 0 Z" fill="#9a4f28" stroke={INK} strokeWidth={0.7} />
      <circle cx={0} cy={-13.9} r={0.7} fill="#9a4f28" stroke={INK} strokeWidth={0.4} />
    </g>
  );
}

/** Platon : lanterne cylindrique de bronze à vitres de corne (lumière ambrée, laiteuse),
 * trois cerclages, couvercle plat et anse en étrier jusqu'à l'anneau. */
function HornLantern({ frame }: { frame: number }) {
  const bronze = '#b5853c';
  const band = (y: number, w: number) => <rect x={-w} y={y - 0.7} width={w * 2} height={1.4} rx={0.4} fill={bronze} stroke={INK} strokeWidth={0.55} />;
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      {/* anse en étrier */}
      <path d="M-3 -11.6 L -0.8 -15 M3 -11.6 L 0.8 -15" stroke={INK} strokeWidth={1.4} />
      <path d="M-3 -11.6 L -0.8 -15 M3 -11.6 L 0.8 -15" stroke={bronze} strokeWidth={0.5} />
      <Ring cy={-16} color={bronze} />
      {/* flamme, vue à travers la corne */}
      <rect x={-3.6} y={-10.6} width={7.2} height={9} fill="#f3b45e" />
      <Flame x={0} y={-3.6} s={0.75} frame={frame} />
      <rect x={-3.6} y={-10.6} width={7.2} height={9} fill="#f6d9a6" opacity={0.42} />
      <path d="M-2.6 -9.6 L -2.6 -3 M2.4 -9.4 L 2.6 -4" stroke="#fff2d4" strokeWidth={0.35} opacity={0.6} />
      <rect x={-3.6} y={-10.6} width={7.2} height={9} fill="none" stroke={INK} strokeWidth={0.6} />
      {band(-6.1, 3.9)}
      {/* couvercle plat, socle */}
      <path d="M-4.6 -10.4 L 4.6 -10.4 L 3.6 -12 L -3.6 -12 Z" fill={bronze} stroke={INK} strokeWidth={0.7} />
      <path d="M-3.2 -11.6 L 2.2 -11.6" stroke="#f3d48e" strokeWidth={0.4} opacity={0.8} />
      <path d="M-4.6 -1.8 L 4.6 -1.8 L 4.6 -0.5 Q 0 0.4 -4.6 -0.5 Z" fill={bronze} stroke={INK} strokeWidth={0.7} />
    </g>
  );
}

/** Aristote : lanterne de bronze plus ouvragée, sur trois petits pieds ; vitres à croisillons,
 * colonnettes, couvercle en dôme ajouré, fleuron et anneau. */
function DomeLantern({ frame }: { frame: number }) {
  const bronze = '#a87a35';
  const post = (x: number) => (
    <>
      <path d={`M${x} -10.6 L ${x} -2.4`} stroke={INK} strokeWidth={1.9} />
      <path d={`M${x} -10.6 L ${x} -2.4`} stroke={bronze} strokeWidth={0.8} />
    </>
  );
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      <Ring cy={-17.6} color={bronze} />
      {/* vitres et flamme */}
      <rect x={-4.2} y={-10.6} width={8.4} height={8.2} fill="#ffdd96" opacity={0.7} />
      <Flame x={0} y={-4.4} s={0.7} frame={frame} />
      <path d="M-4.2 -10.6 L 4.2 -2.4 M4.2 -10.6 L -4.2 -2.4" stroke="#6b4a1e" strokeWidth={0.3} opacity={0.4} />
      <rect x={-4.2} y={-10.6} width={8.4} height={8.2} fill="none" stroke={INK} strokeWidth={0.6} />
      {post(-4.2)}
      {post(4.2)}
      {/* dôme ajouré, fleuron */}
      <path d="M-5.2 -10.4 C -5.2 -15, 5.2 -15, 5.2 -10.4 Z" fill={bronze} stroke={INK} strokeWidth={0.8} />
      <path d="M-5.4 -10.4 L 5.4 -10.4" stroke={INK} strokeWidth={1.3} />
      <path d="M-5.2 -10.4 L 5.2 -10.4" stroke="#d6aa5c" strokeWidth={0.6} />
      {[-2.6, 0, 2.6].map((dx) => (
        <ellipse key={dx} cx={dx} cy={-12.1 - (dx ? 0 : 0.5)} rx={0.5} ry={0.75} fill="#ffd27a" stroke={INK} strokeWidth={0.25} />
      ))}
      <path d="M-3.6 -12.4 C -2.6 -13.8, -0.6 -14.2, 0.8 -14" fill="none" stroke="#f3d48e" strokeWidth={0.45} opacity={0.85} />
      <path d="M0 -14.2 L 0 -15" stroke={INK} strokeWidth={1.2} />
      <circle cx={0} cy={-15.4} r={0.85} fill="#6e9a7e" stroke={INK} strokeWidth={0.45} />
      {/* socle mouluré et trois pieds */}
      <path d="M-5 -2.4 L 5 -2.4 L 4.2 -1 L -4.2 -1 Z" fill={bronze} stroke={INK} strokeWidth={0.7} />
      <path d="M-4.4 -1.7 L 4.4 -1.7" stroke="#6e9a7e" strokeWidth={0.4} opacity={0.8} />
      {[-3.4, 0, 3.4].map((fx) => (
        <ellipse key={fx} cx={fx} cy={-0.5} rx={0.9} ry={0.55} fill={bronze} stroke={INK} strokeWidth={0.5} />
      ))}
    </g>
  );
}

/** Lanterne à main : socle et chapeau de laiton, vitres éclairées, bougie, anneau pour la tenir. */
function Lantern({ frame }: { frame: number }) {
  const brass = '#c49a45';
  const post = (x: number) => (
    <>
      <path d={`M${x} -10.2 L ${x} -1.6`} stroke={INK} strokeWidth={1.8} />
      <path d={`M${x} -10.2 L ${x} -1.6`} stroke={brass} strokeWidth={0.7} />
    </>
  );
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      {/* anneau */}
      <circle cx={0} cy={-15.1} r={1.6} fill="none" stroke={INK} strokeWidth={1.7} />
      <circle cx={0} cy={-15.1} r={1.6} fill="none" stroke={brass} strokeWidth={0.7} />
      {/* vitres, éclairées de l'intérieur */}
      <rect x={-3.8} y={-10.2} width={7.6} height={8.6} fill="#ffe2a0" opacity={0.6} />
      <rect x={-3.8} y={-10.2} width={7.6} height={8.6} fill="none" stroke={INK} strokeWidth={0.6} />
      <path d="M-2.8 -9.2 L -2.8 -4" stroke="#fffaf0" strokeWidth={0.5} opacity={0.7} />
      {/* bougie */}
      <rect x={-0.9} y={-5.8} width={1.8} height={4.2} rx={0.3} fill="#f7f0dc" stroke={INK} strokeWidth={0.4} />
      <Flame x={0} y={-5.9} s={0.62} frame={frame} />
      {post(-3.8)}
      {post(3.8)}
      <path d="M-3.8 -6 L 3.8 -6" stroke={INK} strokeWidth={0.35} opacity={0.5} />
      {/* socle */}
      <path d="M-4.6 -1.7 L 4.6 -1.7 L 4.2 0 L -4.2 0 Z" fill="#3b3530" stroke={INK} strokeWidth={0.7} />
      <path d="M-4.6 -1.7 L 4.6 -1.7" stroke={brass} strokeWidth={0.6} />
      {/* chapeau ajouré */}
      <path d="M-4.6 -10.1 L 4.6 -10.1 L 2.3 -12.6 L -2.3 -12.6 Z" fill={brass} stroke={INK} strokeWidth={0.75} />
      <path d="M-1.6 -11 L -1.6 -11.8 M0 -11 L 0 -11.8 M1.6 -11 L 1.6 -11.8" stroke={INK} strokeWidth={0.5} />
      <path d="M-1.3 -12.6 L 1.3 -12.6 L 0.6 -13.6 L -0.6 -13.6 Z" fill="#3b3530" stroke={INK} strokeWidth={0.55} />
      <path d="M-3.6 -10.4 L -2 -12.2" stroke="#f3dc93" strokeWidth={0.4} opacity={0.8} />
    </g>
  );
}

/** La lampe du compagnon, posée (base en (x, y)) ou tenue (main en (x, y)). */
export function Lamp({ char, frame, x, y, held, uid: _uid }: { char?: string; frame: number; x: number; y: number; held: boolean; uid: string }) {
  const s = spec(char);
  const c = (char as CharId) in SPECS ? (char as CharId) : 'brain';
  let body: ReactNode;
  if (c === 'socrate') body = <ClayLantern frame={frame} />;
  else if (c === 'platon') body = <HornLantern frame={frame} />;
  else if (c === 'aristote') body = <DomeLantern frame={frame} />;
  else if (c === 'rousseau') body = <Lantern frame={frame} />;
  else body = <Banker frame={frame} held={held} />;
  return <g transform={place(s, x, y, held).transform}>{body}</g>;
}

/** Lueur chaude, douce, centrée sur la flamme ; à dessiner derrière le compagnon. */
export function LampGlow({ char, frame, x, y, held, uid }: { char?: string; frame: number; x: number; y: number; held: boolean; uid: string }) {
  const [fx, fy] = lampFlame(char, x, y, held);
  const id = `mascot-lamp-${uid}`;
  const r = 26 + [0, 1.2, -0.8][frame % 3];
  return (
    <g pointerEvents="none">
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor="#ffcf7a" stopOpacity={0.4} />
          <stop offset="0.35" stopColor="#ffb85c" stopOpacity={0.16} />
          <stop offset="1" stopColor="#ffb85c" stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={fx} cy={fy} r={r} fill={`url(#${id})`} />
    </g>
  );
}
