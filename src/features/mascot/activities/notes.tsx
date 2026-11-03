// Notes de musique génériques (croche, ou deux croches liées) pour les activités d'instruments,
// cernées de clair pour se lire sur n'importe quel fond — même style que celles de la guitare.
import type { Pt } from './types';

export function Note({ x, y, s, o, two }: { x: number; y: number; s: number; o: number; two?: boolean }) {
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
      <g fill="#231b11" stroke="#231b11" strokeWidth={1.1}>
        {glyph}
      </g>
    </g>
  );
}

/** Trois notes qui montent tour à tour depuis des points de départ (cycle de 6 images), en dérivant. */
export function RisingNotes({ frame, from, drift = 1 }: { frame: number; from: Pt[]; drift?: number }) {
  return (
    <g>
      {from.map(([x0, y0], i) => {
        const age = (((frame - 2 * i) % 6) + 6) % 6;
        if (age > 3) return null;
        return <Note key={i} x={x0 + age * drift * (i % 2 ? -0.8 : 1)} y={y0 - age * 6.5} s={0.8 + age * 0.08} o={1 - age * 0.22} two={i === 1} />;
      })}
    </g>
  );
}
