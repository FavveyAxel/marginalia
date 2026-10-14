// Popover maison (menus, confirmations) pour le module Écrire.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFloating } from '../../components/ui';

export interface PopState {
  anchor: DOMRect | null;
  anchorEl: HTMLElement | null;
}

export function usePop() {
  const [st, setSt] = useState<PopState>({ anchor: null, anchorEl: null });
  return {
    anchor: st.anchor,
    anchorEl: st.anchorEl,
    isOpen: !!st.anchor,
    toggle: (el: HTMLElement) => setSt((s) => (s.anchor ? { anchor: null, anchorEl: null } : { anchor: el.getBoundingClientRect(), anchorEl: el })),
    open: (el: HTMLElement) => setSt({ anchor: el.getBoundingClientRect(), anchorEl: el }),
    close: () => setSt({ anchor: null, anchorEl: null }),
  };
}

export function Popover({
  pop,
  children,
  prefer = 'below',
  className = '',
  label,
}: {
  pop: ReturnType<typeof usePop>;
  children: ReactNode;
  prefer?: 'above' | 'below';
  className?: string;
  label?: string;
}) {
  const [setFloat, style] = useFloating(pop.anchor, prefer);
  const local = useRef<HTMLDivElement | null>(null);
  const { close, anchorEl } = pop;
  useEffect(() => {
    if (!pop.anchor) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (local.current?.contains(t)) return;
      if (anchorEl && anchorEl.contains(t)) return; // le bouton d'ancrage gère lui-même la bascule
      close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [pop.anchor, anchorEl, close]);
  if (!pop.anchor) return null;
  return createPortal(
    <div
      ref={(el) => {
        local.current = el;
        setFloat(el);
      }}
      role="dialog"
      aria-label={label}
      className={`floating ed-pop ${className}`}
      style={style}
    >
      {children}
    </div>,
    document.body,
  );
}
