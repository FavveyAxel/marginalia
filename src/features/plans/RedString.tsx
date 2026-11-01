// Mode Skeuomorphisme : punaises et fil rouge du tableau de liège des Plans.
// Le fil relie, dans l'ordre de la dissertation, le sujet, les définitions, la problématique,
// chaque partie puis la conclusion. Pur décor : aucun clic, recalculé quand la page bouge.
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

const PINNED = '.plan-sujet, .plan-field, .plan-nodes > .plan-node';

interface Pin {
  x: number;
  y: number;
}

export function RedString({ docRef }: { docRef: RefObject<HTMLDivElement | null> }) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const raf = useRef(0);

  useLayoutEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    const measure = () => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        const box = doc.getBoundingClientRect();
        const els = Array.from(doc.querySelectorAll<HTMLElement>(PINNED));
        const next = els.map((el, i) => {
          const r = el.getBoundingClientRect();
          // Punaise dans le coin haut gauche : le fil longe la marge et ne barre jamais le texte.
          return { x: Math.round(r.left - box.left + 11 + (i % 2) * 3), y: Math.round(r.top - box.top + 11) };
        });
        setPins((prev) =>
          prev.length === next.length && prev.every((p, i) => p.x === next[i].x && p.y === next[i].y) ? prev : next,
        );
        setSize((s) => (s.w === box.width && s.h === box.height ? s : { w: box.width, h: box.height }));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(doc);
    const mo = new MutationObserver(measure);
    mo.observe(doc, { childList: true, subtree: true });
    doc.addEventListener('input', measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf.current);
      ro.disconnect();
      mo.disconnect();
      doc.removeEventListener('input', measure);
      window.removeEventListener('resize', measure);
    };
  }, [docRef]);

  if (pins.length === 0) return null;
  let d = `M ${pins[0].x} ${pins[0].y}`;
  for (let i = 1; i < pins.length; i++) {
    const a = pins[i - 1];
    const b = pins[i];
    // Le fil, un peu lâche, s'écarte dans le liège entre deux punaises.
    const slack = Math.min(34, 12 + (b.y - a.y) * 0.05) * (i % 2 ? 1 : 0.7);
    d += ` Q ${Math.min(a.x, b.x) - slack} ${(a.y + b.y) / 2} ${b.x} ${b.y}`;
  }

  return (
    <svg className="plan-string" width={size.w} height={size.h} aria-hidden="true" data-testid="plan-string">
      <path className="plan-string-shadow" d={d} />
      <path className="plan-string-line" d={d} />
      {pins.map((p, i) => (
        <g key={i} className="plan-pin" transform={`translate(${p.x} ${p.y})`}>
          <ellipse cx="2.5" cy="4" rx="6" ry="4" className="plan-pin-shadow" />
          <circle r="6.5" className="plan-pin-head" />
          <circle cx="-2" cy="-2.2" r="2" className="plan-pin-glint" />
        </g>
      ))}
    </svg>
  );
}
