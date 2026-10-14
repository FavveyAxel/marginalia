// Primitives partagées (FIGÉ)
import { useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { CategoryId } from '../lib/types';
import { catColor } from '../lib/categories';
import { fmtKeys } from '../lib/keys';

export function CategoryDot({ id, size = 9 }: { id: CategoryId; size?: number }) {
  return <span className="cat-dot" style={{ background: catColor(id), width: size, height: size }} />;
}

/** Touche ou raccourci (notation Mac ; affiché « Ctrl+… » sous Windows, voir lib/keys). */
export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{typeof children === 'string' ? fmtKeys(children) : children}</span>;
}

/**
 * Calcule la position (fixed) d'un élément flottant de taille (w,h) ancré à `rect`.
 * Place au-dessus si possible, sinon en dessous ; reste dans la fenêtre.
 */
export function placeFloating(
  rect: { left: number; top: number; width: number; height: number; bottom: number },
  w: number,
  h: number,
  prefer: 'above' | 'below' = 'above',
  gap = 8,
): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(8, Math.min(vw - w - 8, left));
  const above = rect.top - h - gap;
  const below = rect.bottom + gap;
  let top = prefer === 'above' ? (above >= 8 ? above : below) : below + h <= vh - 8 ? below : above;
  top = Math.max(8, Math.min(vh - h - 8, top));
  return { left, top };
}

/** Mesure un élément après rendu pour le positionner via placeFloating. */
export function useFloating(
  anchor: DOMRect | null,
  prefer: 'above' | 'below' = 'above',
): [(el: HTMLElement | null) => void, CSSProperties] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden', left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!el || !anchor) return;
    // Taille de mise en page (offsetWidth) : la boîte mesurée pendant l'animation d'apparition
    // (légère mise à l'échelle) est plus petite, et l'élément débordait du bord de la fenêtre.
    const r = el.getBoundingClientRect();
    setStyle(placeFloating(anchor, el.offsetWidth || r.width, el.offsetHeight || r.height, prefer));
  }, [el, anchor?.left, anchor?.top, anchor?.width, anchor?.height, prefer]);
  return [setEl, style];
}

export function relativeTime(ts: number | null): string {
  if (!ts) return 'Jamais ouvert';
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'À l’instant';
  if (d < 3600) return `Il y a ${Math.floor(d / 60)} min`;
  if (d < 86400) return `Il y a ${Math.floor(d / 3600)} h`;
  if (d < 86400 * 7) return `Il y a ${Math.floor(d / 86400)} j`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Squelette de chargement (lignes grises animées). */
export function Skeleton({ lines = 3, width, height }: { lines?: number; width?: number | string; height?: number }) {
  if (height) return <div className="skeleton" style={{ width: width ?? '100%', height }} />;
  return (
    <div style={{ width: width ?? '100%' }}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton skeleton-line" style={{ width: i === lines - 1 ? '62%' : '100%' }} />
      ))}
    </div>
  );
}

/** Chargement d'une page de lecture : titre + paragraphes fantômes. */
export function PageSkeleton() {
  return (
    <div style={{ maxWidth: 620, margin: '72px auto', padding: '0 32px', width: '100%' }} className="anim-fade">
      <div className="skeleton" style={{ height: 34, width: '55%', marginBottom: 32 }} />
      <Skeleton lines={5} />
      <div style={{ height: 18 }} />
      <Skeleton lines={6} />
      <div style={{ height: 18 }} />
      <Skeleton lines={4} />
    </div>
  );
}
