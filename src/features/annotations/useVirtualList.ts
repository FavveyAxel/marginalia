// Liste virtualisée à hauteurs variables : seules les lignes proches de la zone visible sont
// montées. Pourquoi : un livre peut porter des centaines d'extraits (synchro Livres) ; des
// centaines de cartes montées font du panneau la plus grosse partie du DOM *rendu* (les chapitres
// hors écran sont en content-visibility), et chaque sélection dans le texte payait ce DOM
// (tests de position de la souris sur ~1 600 calques, synchronisation de la sélection,
// accessibilité de macOS) : gel de plusieurs secondes entre le relâchement et la barre.
//
// Hauteurs : estimées, puis mesurées (ResizeObserver) et mémorisées par clé. Les espaces des lignes
// non montées sont des marges internes du conteneur ; l'ancrage du défilement du navigateur garde
// la carte visible en place quand une estimation est corrigée au-dessus d'elle.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';

export interface VirtualWindow {
  /** Indices [start, end) des lignes à monter. */
  start: number;
  end: number;
  /** Style du conteneur interne (marges qui remplacent les lignes non montées). */
  style: CSSProperties;
  /** Ref à poser sur chaque ligne montée (mesure de sa hauteur). */
  measure: (el: HTMLElement | null) => void;
  /** Haut et bas d'une ligne, en px depuis le haut du conteneur interne. */
  span: (i: number) => { top: number; bottom: number } | null;
}

interface Options<T> {
  keyOf: (item: T) => string;
  estimate: (item: T, width: number) => number;
  gap: number;
  /** Marge de rendu au-dessus et au-dessous de la zone visible (px). */
  overscan?: number;
  /** Attribut de la ligne qui porte sa clé (data-…). */
  keyAttr: string;
  /** Jusqu'à ce nombre de lignes, tout est monté (liste courte : rien à gagner, recherche ⌘F intacte). */
  minItems?: number;
}

export function useVirtualList<T>(scrollRef: RefObject<HTMLElement>, items: T[], opts: Options<T>): VirtualWindow {
  const { keyOf, estimate, gap, overscan = 700, keyAttr, minItems = 60 } = opts;
  const heights = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);
  const [view, setView] = useState({ top: 0, height: 900, width: 300 });

  // Zone visible : suivie au défilement (une fois par image) et au redimensionnement.
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const next = { top: sc.scrollTop, height: sc.clientHeight || 900, width: sc.clientWidth || 300 };
      setView((v) => (v.top === next.top && v.height === next.height && v.width === next.width ? v : next));
    };
    read();
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(sc);
    return () => {
      sc.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef]);

  // Mesure des lignes montées : une seule instance d'observateur.
  const bump = useRef(0);
  const ro = useMemo(
    () =>
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            let changed = false;
            for (const e of entries) {
              const el = e.target as HTMLElement;
              const key = el.getAttribute(keyAttr);
              if (!key || !el.isConnected) continue;
              const h = e.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
              if (!h) continue;
              const prev = heights.current.get(key);
              if (prev === undefined || Math.abs(prev - h) > 0.5) {
                heights.current.set(key, h);
                changed = true;
              }
            }
            if (changed && !bump.current)
              bump.current = requestAnimationFrame(() => {
                bump.current = 0;
                setVersion((v) => v + 1);
              });
          }),
    [keyAttr],
  );
  // Pas de disconnect au démontage (StrictMode rejoue les effets sans rappeler les refs) :
  // l'observateur et ses cibles sont libérés avec le composant.
  useEffect(
    () => () => {
      if (bump.current) cancelAnimationFrame(bump.current);
      bump.current = 0;
    },
    [ro],
  );
  const observed = useRef(new Set<HTMLElement>());
  const measure = useCallback(
    (el: HTMLElement | null) => {
      if (!ro) return;
      // Nettoyage des lignes démontées (le ref reçoit null sans l'élément).
      for (const x of observed.current)
        if (!x.isConnected) {
          ro.unobserve(x);
          observed.current.delete(x);
        }
      if (el && !observed.current.has(el)) {
        observed.current.add(el);
        ro.observe(el);
      }
    },
    [ro],
  );

  // Positions cumulées (O(n), sans lecture du DOM).
  const width = Math.round(view.width / 8) * 8; // estimations stables aux petits redimensionnements
  const tops = useMemo(() => {
    const t = new Float64Array(items.length + 1);
    for (let i = 0; i < items.length; i++) {
      const h = heights.current.get(keyOf(items[i])) ?? estimate(items[i], width);
      t[i + 1] = t[i] + h + (i < items.length - 1 ? gap : 0);
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, version, width, gap]);

  const n = items.length;
  const all = n <= minItems;
  const bottomOf = (i: number) => tops[i + 1] - (i < n - 1 ? gap : 0);
  const lo = view.top - overscan;
  const hi = view.top + view.height + overscan;
  // Première ligne dont le bas dépasse `lo` (recherche dichotomique), puis jusqu'à `hi`.
  let a = 0;
  let b = n;
  while (a < b) {
    const m = (a + b) >> 1;
    if (bottomOf(m) < lo) a = m + 1;
    else b = m;
  }
  const start = all ? 0 : Math.min(a, n);
  let end = all ? n : start;
  while (end < n && tops[end] <= hi) end++;
  const total = n ? tops[n] : 0;
  const padTop = n ? tops[start] : 0;
  const padBottom = n && end > start ? total - bottomOf(end - 1) : Math.max(0, total - padTop);

  const span = useCallback((i: number) => (i < 0 || i >= n ? null : { top: tops[i], bottom: tops[i + 1] - (i < n - 1 ? gap : 0) }), [tops, n, gap]);

  return { start, end, style: { paddingTop: padTop, paddingBottom: padBottom }, measure, span };
}
