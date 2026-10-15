// La barre d'outils (centrée en bas) chevaucherait-elle la mini-carte (en bas à droite) ?
// Cas d'une vue étroite (carte libre à côté de la barre latérale) ou d'une barre enrichie par
// d'autres fonctionnalités : la vue ajoute alors la classe `map-narrow`, qui remonte la mini-carte.
import { useEffect, useState, type RefObject } from 'react';

const MINI_W = 200; // mini-carte + marge droite

export function useBarOverlap(root: RefObject<HTMLElement | null>): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const check = () => {
      const bar = el.querySelector<HTMLElement>('.map-bar');
      if (!bar) return;
      const w = el.clientWidth;
      setOver(w / 2 + bar.offsetWidth / 2 + 8 > w - MINI_W);
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const watchBar = () => {
      const bar = el.querySelector<HTMLElement>('.map-bar');
      if (bar) ro.observe(bar);
    };
    watchBar();
    // La barre peut apparaître après coup (carte vide → carte remplie).
    const mo = new MutationObserver(() => {
      watchBar();
      check();
    });
    mo.observe(el, { childList: true, subtree: true });
    check();
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [root]);
  return over;
}
