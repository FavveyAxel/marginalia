// Glisser-déposer du texte sélectionné dans l'écrit.
//
// SuperDoc peint les pages en DOM ordinaire (spans data-pm-start / data-pm-end) au-dessus d'un
// ProseMirror caché : le glisser-déposer natif de ProseMirror n'y existe pas (le DragDropManager de
// SuperDoc ne gère que les champs, objets et images). Le geste est donc fait ici, aux événements de
// pointeur :
//   appui dans la sélection → (au-delà de 4 px) glisser : fantôme du texte près du pointeur, trait
//   d'insertion à la position du document la plus proche (hitTest de la mise en page), défilement
//   automatique près des bords → relâcher = déplacer (⌥ / Alt : copier ; Ctrl aussi sous Windows) ;
//   relâcher dans la sélection ou Échap = annuler.
//   Appui sans glisser : le clic est rejoué tel quel pour SuperDoc (curseur placé, double-clic…).
// Paragraphes entiers : déplacés avec leur style, entre deux paragraphes (trait horizontal).
// Le déplacement lui-même : engine.moveText (une seule étape d'annulation).
import { useEffect, type MutableRefObject, type RefObject } from 'react';
import type { DocEngine, DragSource, DropTarget } from './engine';
import { isWindows } from '../../lib/keys';
import './drag-painter.css';

const THRESHOLD = 4;
const EDGE = 56;
const MAX_SPEED = 24;

interface Gesture {
  src: DragSource;
  down: PointerEvent;
  started: boolean;
  cancelled: boolean;
  x: number;
  y: number;
  copy: boolean;
  target: DropTarget | null;
}

export function useTextDrag({
  engineRef,
  hostRef,
  enabled,
  blockedRef,
  onDone,
}: {
  engineRef: MutableRefObject<DocEngine | null>;
  hostRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  /** Pinceau armé : le geste est laissé à la sélection ordinaire. */
  blockedRef: MutableRefObject<boolean>;
  onDone: () => void;
}) {
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !enabled) return;
    const scroller = host.closest('.ed-scroll') as HTMLElement | null;
    let g: Gesture | null = null;
    let replaying = false;
    let lastUp = { t: 0, x: 0, y: 0 };
    let ghost: HTMLDivElement | null = null;
    let caret: HTMLDivElement | null = null;
    let raf = 0;
    let swallowClick = 0;

    const isCopy = (e: { altKey: boolean; ctrlKey: boolean }) => e.altKey || (isWindows && e.ctrlKey);

    const visuals = () => {
      if (ghost) return;
      ghost = document.createElement('div');
      ghost.className = 'ed-drag-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      const txt = document.createElement('span');
      txt.className = 'ed-drag-ghost-text';
      const t = (g?.src.text ?? '').replace(/\s+/g, ' ').trim();
      txt.textContent = t.length > 90 ? `${t.slice(0, 88)}…` : t;
      const badge = document.createElement('span');
      badge.className = 'ed-drag-ghost-plus';
      badge.textContent = '+';
      ghost.append(txt, badge);
      caret = document.createElement('div');
      caret.className = 'ed-drop-caret';
      caret.setAttribute('aria-hidden', 'true');
      document.body.append(ghost, caret);
      document.documentElement.classList.add('ed-text-dragging');
    };
    const clearVisuals = () => {
      ghost?.remove();
      caret?.remove();
      ghost = caret = null;
      document.documentElement.classList.remove('ed-text-dragging', 'ed-text-drag-copy');
      cancelAnimationFrame(raf);
      raf = 0;
    };

    /** Point de dépôt sous (x, y), indicateur, fantôme, curseur « + ». */
    const update = () => {
      if (!g || !g.started) return;
      const eng = engineRef.current;
      document.documentElement.classList.toggle('ed-text-drag-copy', g.copy);
      if (ghost) {
        ghost.style.transform = `translate(${Math.round(g.x + 14)}px, ${Math.round(g.y + 16)}px)`;
        ghost.classList.toggle('copy', g.copy);
      }
      const inScroller = (() => {
        const r = scroller?.getBoundingClientRect();
        return !r || (g.x >= r.left && g.x <= r.right && g.y >= r.top - 2 && g.y <= r.bottom + 2);
      })();
      const pos = eng && inScroller ? eng.posAtPoint(g.x, Math.max(g.y, (scroller?.getBoundingClientRect().top ?? 0) + 1)) : null;
      g.target = eng && pos !== null ? eng.dropTarget(g.src, pos) : null;
      const r = g.target?.rect;
      if (caret) {
        if (!r) caret.style.display = 'none';
        else {
          caret.style.display = '';
          caret.classList.toggle('block', g.target!.block);
          caret.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px)`;
          if (g.target!.block) {
            caret.style.width = `${Math.round(r.width)}px`;
            caret.style.height = '';
          } else {
            caret.style.width = '';
            caret.style.height = `${Math.round(r.height)}px`;
          }
        }
      }
    };

    /** Défilement automatique près du haut / du bas de la zone de l'écrit. */
    const autoScroll = () => {
      raf = 0;
      if (!g || !g.started || !scroller) return;
      const r = scroller.getBoundingClientRect();
      let v = 0;
      if (g.y < r.top + EDGE) v = -MAX_SPEED * Math.min(1, (r.top + EDGE - g.y) / EDGE);
      else if (g.y > r.bottom - EDGE) v = MAX_SPEED * Math.min(1, (g.y - (r.bottom - EDGE)) / EDGE);
      if (!v) return;
      const before = scroller.scrollTop;
      scroller.scrollTop = before + v;
      if (scroller.scrollTop !== before) update();
      raf = requestAnimationFrame(autoScroll);
    };

    const end = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onCancel);
      clearVisuals();
      g = null;
    };

    /** Clic sans glisser dans la sélection : rejoué pour SuperDoc (curseur, double-clic, lien…). */
    const replayClick = (down: PointerEvent, up: PointerEvent) => {
      const init = (e: PointerEvent, buttons: number): PointerEventInit => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        button: 0,
        buttons,
        pointerId: down.pointerId,
        pointerType: down.pointerType,
        isPrimary: true,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        detail: 1,
      });
      const t = down.target as Element | null;
      if (!t?.isConnected) return;
      replaying = true;
      try {
        t.dispatchEvent(new PointerEvent('pointerdown', init(down, 1)));
        t.dispatchEvent(new PointerEvent('pointerup', init(up, 0)));
      } finally {
        replaying = false;
      }
    };

    const onDown = (ev: PointerEvent) => {
      if (replaying || g) return;
      // (⌘ / Ctrl-clic : lien citation → extrait ; ⇧-clic : étendre la sélection)
      if (ev.button !== 0 || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.pointerType === 'touch') return;
      if (blockedRef.current) return;
      // 2e clic rapproché (double / triple clic) : à SuperDoc
      if (performance.now() - lastUp.t < 450 && Math.hypot(ev.clientX - lastUp.x, ev.clientY - lastUp.y) < 6) return;
      const t = ev.target as HTMLElement | null;
      if (!t?.closest?.('.superdoc-page') || t.closest('img, a, [data-drag-source-kind], [draggable="true"]')) return;
      const eng = engineRef.current;
      if (!eng) return;
      const rects = eng.selectionRects();
      if (!rects.some((r) => ev.clientX >= r.left - 1 && ev.clientX <= r.right + 1 && ev.clientY >= r.top - 1 && ev.clientY <= r.bottom + 1)) return;
      const src = eng.dragSource();
      if (!src) return;
      // Le geste est à nous : SuperDoc ne voit pas cet appui (sinon il replierait la sélection).
      ev.preventDefault();
      ev.stopPropagation();
      g = { src, down: ev, started: false, cancelled: false, x: ev.clientX, y: ev.clientY, copy: isCopy(ev), target: null };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('keyup', onKey, true);
      window.addEventListener('blur', onCancel);
    };

    const onMove = (ev: PointerEvent) => {
      if (!g) return;
      ev.preventDefault();
      ev.stopPropagation();
      g.x = ev.clientX;
      g.y = ev.clientY;
      g.copy = isCopy(ev);
      if (g.cancelled) return;
      if (!g.started) {
        if (Math.hypot(ev.clientX - g.down.clientX, ev.clientY - g.down.clientY) < THRESHOLD) return;
        g.started = true;
        visuals();
      }
      update();
      if (!raf) raf = requestAnimationFrame(autoScroll);
    };

    const onUp = (ev: PointerEvent) => {
      if (!g) return;
      const cur = g;
      ev.preventDefault();
      ev.stopPropagation();
      lastUp = { t: performance.now(), x: ev.clientX, y: ev.clientY };
      if (!cur.started) {
        end();
        if (!cur.cancelled) replayClick(cur.down, ev);
        return;
      }
      cur.x = ev.clientX;
      cur.y = ev.clientY;
      cur.copy = isCopy(ev);
      if (!cur.cancelled) update();
      const target = cur.cancelled ? null : cur.target;
      end();
      // le « click » qui suit le relâcher n'est pas un clic dans le document
      swallowClick = performance.now();
      const eng = engineRef.current;
      if (eng && target) {
        if (eng.moveText(cur.src, target, cur.copy)) onDone();
      } else eng?.focus();
    };

    const onCancel = () => {
      if (!g) return;
      if (g.started) {
        // appui toujours en cours : la suite du geste est ignorée jusqu'au relâcher
        g.cancelled = true;
        clearVisuals();
        if (!document.hasFocus()) end();
      } else end();
    };

    const onKey = (ev: KeyboardEvent) => {
      if (!g) return;
      if (ev.type === 'keydown' && ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        if (g.started) {
          g.cancelled = true;
          clearVisuals();
        } else end();
        return;
      }
      if (ev.key === 'Alt' || ev.key === 'Control') {
        // ⌥ pressé / relâché pendant le glisser : bascule déplacer ↔ copier sans bouger la souris
        g.copy = isCopy(ev);
        if (ev.key === 'Alt') ev.preventDefault();
        if (g.started && !g.cancelled) update();
      }
    };

    const onClick = (ev: MouseEvent) => {
      if (swallowClick && performance.now() - swallowClick < 400) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      swallowClick = 0;
    };

    host.addEventListener('pointerdown', onDown, true);
    window.addEventListener('click', onClick, true);
    return () => {
      host.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('click', onClick, true);
      end();
    };
  }, [engineRef, hostRef, enabled, blockedRef, onDone]);
}
