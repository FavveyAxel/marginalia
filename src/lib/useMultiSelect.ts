// Sélection multiple « à la Finder », partagée par les vues de liste (Bibliothèque, Écrits, Espaces…).
//
//   const sel = useMultiSelect(ids);              // ids : ordre AFFICHÉ (mémoïsé)
//   onClick={(e) => sel.click(id, e) || ouvrir()} // ⌘-clic / ⇧-clic consommés, sinon false
//   sel.selectAll(); sel.clear(); sel.has(id); sel.size; sel.ids
//
//   const lasso = useLasso({ container: ref, sel });   // rectangle de sélection dans le vide
//   <div ref={ref} onMouseDown={lasso.onMouseDown}>…</div>{lasso.box && <LassoBox box={lasso.box} />}
//
// Les éléments sélectionnables portent l'attribut data-sel-id="<id>" (utilisé par le lasso).
import { createElement, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';

export interface ClickMods {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}

export interface MultiSelect {
  /** Ensemble sélectionné (ne pas muter). */
  selected: ReadonlySet<string>;
  /** Identifiants sélectionnés, dans l'ordre affiché. */
  ids: string[];
  size: number;
  has(id: string): boolean;
  /**
   * Clic sur un élément. ⌘ (ou Ctrl) : ajoute / retire. ⇧ : plage depuis l'ancre.
   * `toggle: true` (mode « Sélectionner ») : un clic simple ajoute / retire.
   * Renvoie true si le clic a été traité par la sélection (sinon : comportement normal, ouvrir).
   */
  click(id: string, e: ClickMods, opts?: { toggle?: boolean }): boolean;
  toggle(id: string): void;
  /** Remplace la sélection. */
  set(ids: Iterable<string>): void;
  selectAll(): void;
  clear(): void;
}

export function useMultiSelect(order: readonly string[]): MultiSelect {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const orderRef = useRef(order);
  orderRef.current = order;
  const selRef = useRef(selected);
  selRef.current = selected;
  /** Ancre des ⇧-clics et sélection « de base » au moment où l'ancre a été posée. */
  const anchor = useRef<string | null>(null);
  const base = useRef<ReadonlySet<string>>(new Set());

  // Ce qui disparaît de l'affichage (filtre, recherche, suppression) quitte la sélection.
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const vis = new Set(order);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (vis.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    if (anchor.current && !order.includes(anchor.current)) anchor.current = null;
  }, [order]);

  const commit = useCallback((next: ReadonlySet<string>) => {
    selRef.current = next;
    setSelected(next);
  }, []);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(selRef.current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      anchor.current = id;
      // Un ⇧-clic suivant part de cet élément et conserve ce qui était déjà choisi.
      base.current = new Set(next);
      commit(next);
    },
    [commit],
  );

  const click = useCallback(
    (id: string, e: ClickMods, opts?: { toggle?: boolean }) => {
      const add = !!(e.metaKey || e.ctrlKey);
      if (e.shiftKey) {
        const ord = orderRef.current;
        const a = anchor.current && ord.includes(anchor.current) ? anchor.current : null;
        if (!a) {
          anchor.current = id;
          base.current = add || opts?.toggle ? new Set(selRef.current) : new Set();
          commit(new Set([...base.current, id]));
          return true;
        }
        const i = ord.indexOf(a);
        const j = ord.indexOf(id);
        const range = ord.slice(Math.min(i, j), Math.max(i, j) + 1);
        commit(new Set([...base.current, ...range]));
        return true;
      }
      if (add || opts?.toggle) {
        toggle(id);
        return true;
      }
      return false;
    },
    [commit, toggle],
  );

  const set = useCallback(
    (ids: Iterable<string>) => {
      const next = new Set(ids);
      base.current = next;
      commit(next);
    },
    [commit],
  );
  const selectAll = useCallback(() => {
    set(orderRef.current);
    // Après ⌘A, un ⇧-clic redéfinit une plage depuis le premier élément (comme le Finder).
    anchor.current = orderRef.current[0] ?? null;
    base.current = new Set();
  }, [set]);
  const clear = useCallback(() => {
    anchor.current = null;
    if (selRef.current.size) set([]);
    else base.current = new Set();
  }, [set]);

  const ids = useMemo(() => order.filter((id) => selected.has(id)), [order, selected]);

  return useMemo(
    () => ({ selected, ids, size: selected.size, has: (id: string) => selected.has(id), click, toggle, set, selectAll, clear }),
    [selected, ids, click, toggle, set, selectAll, clear],
  );
}

// ── Lasso (rectangle de sélection) ──────────────────────────

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Cibles qui ne démarrent jamais un lasso (éléments, commandes, champs). */
const NO_LASSO = '[data-sel-id], button, input, select, textarea, a, label, [role="button"], [role="menu"], [role="dialog"], [data-no-lasso]';

/**
 * Rectangle de sélection tracé à la souris dans la zone vide de `container`.
 * Un clic simple dans le vide (sans glisser, sans modificateur) vide la sélection.
 * ⌘ ou ⇧ enfoncé au départ : le rectangle s'ajoute à la sélection existante.
 */
export function useLasso({ container, sel, disabled }: { container: RefObject<HTMLElement>; sel: MultiSelect; disabled?: boolean }) {
  const [box, setBox] = useState<Box | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const onMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (disabled || e.button !== 0) return;
      const target = e.target as Element;
      if (!(target instanceof Element) || target.closest(NO_LASSO)) return;
      const root = container.current;
      if (!root || !root.contains(target)) return;
      // Pas de sélection de texte pendant le tracé ; un champ de recherche actif perd le focus (⌘A redevient global).
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) active.blur();
      const additive = e.metaKey || e.ctrlKey || e.shiftKey;
      const start = { x: e.clientX, y: e.clientY };
      const baseSel = additive ? new Set(selRef.current.selected) : new Set<string>();
      let dragging = false;

      const move = (ev: MouseEvent) => {
        if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
        dragging = true;
        const b: Box = {
          left: Math.min(start.x, ev.clientX),
          top: Math.min(start.y, ev.clientY),
          width: Math.abs(ev.clientX - start.x),
          height: Math.abs(ev.clientY - start.y),
        };
        setBox(b);
        const hits = new Set(baseSel);
        root.querySelectorAll<HTMLElement>('[data-sel-id]').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right >= b.left && r.left <= b.left + b.width && r.bottom >= b.top && r.top <= b.top + b.height) hits.add(el.dataset.selId!);
        });
        const cur = selRef.current.selected;
        if (hits.size !== cur.size || [...hits].some((id) => !cur.has(id))) selRef.current.set(hits);
      };
      const up = () => {
        stop();
        if (!dragging && !additive) selRef.current.clear();
      };
      const stop = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        window.removeEventListener('blur', stop);
        cleanup.current = null;
        setBox(null);
      };
      cleanup.current?.();
      cleanup.current = stop;
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      window.addEventListener('blur', stop);
    },
    [container, disabled],
  );

  return { box, onMouseDown };
}

/** Rectangle visuel du lasso (position fixe ; style .msel-lasso, défini par la vue). */
export function LassoBox({ box, className = 'msel-lasso' }: { box: Box; className?: string }) {
  return createElement('div', { className, 'aria-hidden': true, style: { position: 'fixed', ...box } });
}

// ── Raccourcis clavier ─────────────────────────────────────

/** Une saisie, une modale ou un menu a la main : les raccourcis de sélection ne s'appliquent pas. */
function busy(t: EventTarget | null): boolean {
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLElement && (t.isContentEditable || t.closest('[contenteditable="true"], [role="textbox"]'))) return true;
  return !!document.querySelector('[role="dialog"], [role="menu"], [aria-modal="true"]');
}

/** ⌘A : tout sélectionner (ce qui est visible) ; Échap : tout désélectionner. */
export function useSelectionKeys(sel: MultiSelect, { enabled = true, onEscape }: { enabled?: boolean; onEscape?: () => void } = {}) {
  const ref = useRef({ sel, onEscape });
  ref.current = { sel, onEscape };
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || busy(e.target)) return;
      const { sel, onEscape } = ref.current;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        sel.selectAll();
      } else if (e.key === 'Escape') {
        if (!sel.size && !onEscape) return;
        e.preventDefault();
        sel.clear();
        onEscape?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
