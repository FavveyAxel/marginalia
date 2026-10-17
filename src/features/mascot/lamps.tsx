// Lampes de nuit (thème sombre) : chaque compagnon a une source de lumière de son époque.
//   cerveau  : petite lampe de banquier (abat-jour de verre vert, laiton), cône de lumière chaude ;
//   Socrate  : lampe à huile grecque en terre cuite (lychnos), flamme au bec ;
//   Platon   : lampe à vernis noir, frise et rosette rouges, sur un petit pied, anse en anneau ;
//   Aristote : lampe de bronze posée sur un petit trépied (lampadarion) ;
//   Rousseau : lanterne à main du XVIIIe siècle (laiton, vitres, bougie, anneau pour la tenir).
// Repère local de chaque dessin : base au centre (0, 0), le haut vers les y négatifs, bec vers +x.
// Posée (`held` faux) : (x, y) est le point d'appui de la base sur l'encadré ; les lampes à bec sont
// retournées pour que la flamme soit du côté extérieur. Tenue (`held`) : (x, y) est la main ; la
// lanterne pend à son anneau, les lampes à huile reposent à plat sur la paume.
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
  socrate: { flame: [8.9, -4.4], grip: [-0.5, 1.4], placed: 1.3, held: 1.05, mirror: true },
  platon: { flame: [10.2, -5.2], grip: [0, 1.5], placed: 1.25, held: 1, mirror: true },
  aristote: { flame: [6.9, -15.1], grip: [0, -7.5], placed: 0.95, held: 0.8, mirror: true },
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

/** Lychnos de terre cuite : corps rond, anse en boucle, bec allongé ; la flamme au bec. */
function Lychnos({ frame }: { frame: number }) {
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      {/* anse */}
      <path d="M-5.4 -3.6 C -9.2 -5.6, -9.8 -0.9, -5.6 -1.5" fill="none" stroke={INK} strokeWidth={2.4} />
      <path d="M-5.4 -3.6 C -9.2 -5.6, -9.8 -0.9, -5.6 -1.5" fill="none" stroke="#c8703f" strokeWidth={1} />
      {/* bec */}
      <path d="M3 -4.2 L 8.6 -4.1 C 10.2 -4, 10.2 -1.9, 8.6 -1.9 L 3 -1.4 Z" fill="#c8703f" stroke={INK} strokeWidth={0.9} />
      {/* corps */}
      <ellipse cx={-0.5} cy={-2.5} rx={5.8} ry={2.6} fill="#c8703f" stroke={INK} strokeWidth={0.95} />
      <path d="M-5.6 -2 C -4 0.1, 3 0.1, 4.8 -1.8" fill="none" stroke="#8e4522" strokeWidth={0.9} opacity={0.7} />
      <ellipse cx={-0.5} cy={-4} rx={3.2} ry={0.9} fill="#b05e33" stroke={INK} strokeWidth={0.5} />
      <ellipse cx={-0.5} cy={-4} rx={0.9} ry={0.35} fill={INK} />
      <path d="M-4 -3.4 C -3 -4.4, -1.6 -4.8, 0 -4.9" fill="none" stroke="#efb184" strokeWidth={0.5} opacity={0.9} />
      <ellipse cx={8.6} cy={-3.9} rx={0.8} ry={0.3} fill={INK} />
      <Flame x={8.9} y={-4} s={0.82} frame={frame} />
    </g>
  );
}

/** Lampe attique à vernis noir : petit pied, frise ondée et rosette rouges, anse en anneau. */
function BlackGlaze({ frame }: { frame: number }) {
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      {/* anse en anneau */}
      <circle cx={-6.6} cy={-4.8} r={1.7} fill="none" stroke="#e9dfcc" strokeOpacity={0.35} strokeWidth={2} />
      <circle cx={-6.6} cy={-4.8} r={1.7} fill="none" stroke="#1d1815" strokeWidth={1.2} />
      {/* pied */}
      <path d="M-3.2 0 L 3.2 0 L 2 -1.7 L -2 -1.7 Z" fill="#1d1815" stroke={INK} strokeWidth={0.7} />
      <path d="M-3 -0.35 L 3 -0.35" stroke="#b9472e" strokeWidth={0.45} />
      {/* bec */}
      <path d="M3.6 -5.4 L 10 -5.2 C 11.6 -5.1, 11.6 -3, 10 -3 L 3.8 -2.6 Z" fill="#221c18" stroke={INK} strokeWidth={0.8} />
      {/* corps */}
      <ellipse cx={0} cy={-3.7} rx={6} ry={2.4} fill="#221c18" stroke={INK} strokeWidth={0.9} />
      <path d="M-5.2 -3 q 0.9 -0.8 1.75 0 t 1.75 0 t 1.75 0 t 1.75 0 t 1.75 0 t 1.75 0" fill="none" stroke="#c8553a" strokeWidth={0.55} />
      {/* disque supérieur et rosette rouge */}
      <ellipse cx={0} cy={-5.2} rx={3.4} ry={0.95} fill="#2c2520" stroke={INK} strokeWidth={0.5} />
      {[-2.2, -1.1, 0, 1.1, 2.2].map((dx) => (
        <circle key={dx} cx={dx} cy={-5.2 + Math.abs(dx) * 0.08} r={0.32} fill="#d0613f" />
      ))}
      <ellipse cx={0} cy={-5.2} rx={0.7} ry={0.28} fill="#0d0b0a" />
      {/* reflet du vernis */}
      <path d="M-4.4 -4.6 C -3.4 -5.6, -1.6 -5.9, 0.2 -6" fill="none" stroke="#fffaf0" strokeWidth={0.5} opacity={0.55} />
      <path d="M5.2 -4.8 L 9.4 -4.7" stroke="#fffaf0" strokeWidth={0.4} opacity={0.4} />
      <ellipse cx={10.1} cy={-4.6} rx={0.75} ry={0.28} fill="#0d0b0a" />
      <Flame x={10.2} y={-4.7} s={0.82} frame={frame} />
    </g>
  );
}

/** Lampe de bronze sur un petit trépied (lampadarion) : pieds griffus, fût à nœud, coupelle. */
function Lampadarion({ frame }: { frame: number }) {
  const bronze = '#b8893f';
  const leg = (d: string) => (
    <>
      <path d={d} fill="none" stroke={INK} strokeWidth={2.1} />
      <path d={d} fill="none" stroke={bronze} strokeWidth={0.9} />
    </>
  );
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      {/* trépied */}
      {leg('M0 -4.4 Q -3.6 -3 -5 -0.4')}
      {leg('M0 -4.4 Q 3.6 -3 5 -0.4')}
      {leg('M0 -4.4 L 0 -0.6')}
      {[-5.2, 0, 5.2].map((fx) => (
        <ellipse key={fx} cx={fx} cy={-0.5} rx={1.1} ry={0.55} fill={bronze} stroke={INK} strokeWidth={0.6} />
      ))}
      {/* fût, nœud, coupelle */}
      {leg('M0 -4.4 L 0 -12.2')}
      <ellipse cx={0} cy={-4.6} rx={1.5} ry={0.7} fill={bronze} stroke={INK} strokeWidth={0.6} />
      <ellipse cx={0} cy={-8.6} rx={1.2} ry={0.65} fill={bronze} stroke={INK} strokeWidth={0.6} />
      <path d="M-3.6 -12.3 Q 0 -11.2 3.6 -12.3 L 3.2 -12.9 L -3.2 -12.9 Z" fill="#9c7030" stroke={INK} strokeWidth={0.7} />
      {/* lampe : anse en croissant, corps, bec à volutes */}
      <path d="M-3.4 -14.4 C -6.2 -15.6, -6.2 -18.2, -4.2 -19.2 C -4.9 -17.6, -4.2 -16.2, -2.4 -15.4" fill={bronze} stroke={INK} strokeWidth={0.7} />
      <path d="M2.6 -15.6 L 6.8 -15.1 C 8.2 -15, 8.2 -13.2, 6.8 -13.2 L 2.6 -13.2 Z" fill={bronze} stroke={INK} strokeWidth={0.75} />
      <circle cx={3.6} cy={-15.5} r={0.55} fill="none" stroke={INK} strokeWidth={0.4} />
      <ellipse cx={0} cy={-14.2} rx={4} ry={1.7} fill={bronze} stroke={INK} strokeWidth={0.85} />
      <path d="M-3.2 -13.4 C -1.6 -12.6, 1.8 -12.6, 3.4 -13.6" fill="none" stroke="#6e9a7e" strokeWidth={0.6} opacity={0.8} />
      <path d="M-2.8 -15 C -1.6 -15.7, 0.6 -15.8, 1.6 -15.6" fill="none" stroke="#f3d48e" strokeWidth={0.5} opacity={0.9} />
      <path d="M0.6 -11.2 L 0.6 -4.8" stroke="#f3d48e" strokeWidth={0.35} opacity={0.6} />
      <ellipse cx={6.9} cy={-14.4} rx={0.7} ry={0.28} fill={INK} />
      <Flame x={6.9} y={-14.5} s={0.78} frame={frame} />
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
  if (c === 'socrate') body = <Lychnos frame={frame} />;
  else if (c === 'platon') body = <BlackGlaze frame={frame} />;
  else if (c === 'aristote') body = <Lampadarion frame={frame} />;
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
