// Mode concentration de l'éditeur : réglages (menu du bouton ↗), interface qui s'efface pendant la
// frappe, paragraphes estompés autour du paragraphe du curseur, défilement « machine à écrire ».
//
// Les pages sont peintes par SuperDoc (PresentationEditor) depuis un ProseMirror caché : chaque
// fragment peint (.superdoc-fragment…) porte data-pm-start / data-pm-end, positions du document.
// Le paragraphe courant est relié aux fragments par recouvrement de ces positions, réappliqué à
// chaque transaction et à chaque nouvelle peinture (MutationObserver, avant l'affichage).
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { ChevronDown, Maximize2 } from 'lucide-react';
import { Kbd } from '../../components/ui';
import { fmtKeys, isMod } from '../../lib/keys';
import type { DocEngine } from './engine';
import { Popover, usePop } from './Popover';
import './focus.css';

const DIM_KEY = 'marginalia.ed.focusDim';
const TYPEWRITER_KEY = 'marginalia.ed.typewriter';

const read = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};
const write = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    /* indisponible */
  }
};

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** Cible clavier dans le texte du document (pas un champ de l'interface). */
function inDocument(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && typeof el.closest === 'function' && !!el.closest('.ProseMirror');
}

/** Touche qui écrit ou déplace le curseur (pas un raccourci, pas une touche de modification seule). */
function isTypingKey(e: KeyboardEvent): boolean {
  if (isMod(e)) return e.key.toLowerCase() === 'v' || e.key.toLowerCase() === 'x';
  if (e.key.length === 1 || e.key === 'Process' || e.key === 'Dead') return true;
  return ['Enter', 'Backspace', 'Delete', 'Tab'].includes(e.key);
}
function movesCaret(e: KeyboardEvent): boolean {
  return isTypingKey(e) || /^(Arrow|Page|Home|End)/.test(e.key);
}

// ── Réglages persistants ─────────────────────────────────────
export interface FocusPrefs {
  dim: boolean;
  typewriter: boolean;
  setDim: (v: boolean) => void;
  setTypewriter: (v: boolean) => void;
}

export function useFocusPrefs(): FocusPrefs {
  const [dim, setDimState] = useState(() => read(DIM_KEY, true));
  const [typewriter, setTwState] = useState(() => read(TYPEWRITER_KEY, false));
  const setDim = useCallback((v: boolean) => {
    write(DIM_KEY, v);
    setDimState(v);
  }, []);
  const setTypewriter = useCallback((v: boolean) => {
    write(TYPEWRITER_KEY, v);
    setTwState(v);
  }, []);
  return { dim, typewriter, setDim, setTypewriter };
}

// ── Interface qui s'efface pendant la frappe ─────────────────
/** Éléments d'interface effacés pendant la frappe (CSS : .ed-chrome-off). */
const CHROME = '.ed-topbar, .ed-toolbar-row, .ed-outline, .ed-side, .ed-style, .ed-versions, .ver-compare, .ed-count, .wg-group, .cm-col, .ed-mk-reveal, .ed-mk-reveal-chip';
/** Zone du haut de la fenêtre qui rappelle l'interface. */
const TOP_ZONE = 90;
/** Bords gauche / droit / bas de la fenêtre. */
const EDGE = 28;
const BOTTOM_ZONE = 64;
/** Déplacement minimal de la souris (depuis la dernière frappe) avant de rappeler l'interface. */
const MOVE_THRESHOLD = 14;

/**
 * En mode concentration : `hidden` passe à vrai à la frappe dans le texte ; l'interface revient
 * (souris vers le haut, les bords ou la zone d'un élément, clic hors de la page, Échap).
 */
export function useChromeAutoHide(rootRef: MutableRefObject<HTMLElement | null>, active: boolean) {
  const [hidden, setHidden] = useState(false);
  const hiddenRef = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    if (!hiddenRef.current) return;
    hiddenRef.current = false;
    setHidden(false);
  }, []);

  useEffect(() => {
    if (!active) {
      hiddenRef.current = false;
      setHidden(false);
      return;
    }
    const hide = () => {
      anchor.current = last.current;
      if (hiddenRef.current) return;
      hiddenRef.current = true;
      setHidden(true);
    };
    const inChromeZone = (x: number, y: number) => {
      if (y < TOP_ZONE || y > window.innerHeight - BOTTOM_ZONE || x < EDGE || x > window.innerWidth - EDGE) return true;
      const root = rootRef.current;
      if (!root) return false;
      for (const el of root.querySelectorAll<HTMLElement>(CHROME)) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) return true;
      }
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && hiddenRef.current) {
        // Échap rappelle l'interface (un second Échap quitte le mode concentration)
        e.preventDefault();
        e.stopImmediatePropagation();
        show();
        return;
      }
      if (inDocument(e.target) && isTypingKey(e)) hide();
    };
    const onMove = (e: PointerEvent) => {
      last.current = { x: e.clientX, y: e.clientY };
      if (!hiddenRef.current) return;
      const a = anchor.current;
      if (a && Math.hypot(e.clientX - a.x, e.clientY - a.y) < MOVE_THRESHOLD) return;
      if (inChromeZone(e.clientX, e.clientY)) show();
    };
    const onDown = (e: PointerEvent) => {
      if (!hiddenRef.current) return;
      const t = e.target as HTMLElement | null;
      // clic dans la marge (hors des pages) ou dans la zone d'un élément effacé
      if (!t?.closest?.('.superdoc-page')) show();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [active, rootRef, show]);

  return { hidden: active && hidden, show };
}

// ── Paragraphes estompés ─────────────────────────────────────
const FRAGMENTS = '.superdoc-page [data-layout-fragment-id][data-pm-start]';

/**
 * Garde à pleine opacité les fragments peints du bloc qui contient le curseur (les autres sont
 * estompés sous .ed-dim). Recalculé à chaque transaction (`tick`) et à chaque repeinture.
 */
export function useParagraphDim(hostRef: MutableRefObject<HTMLElement | null>, engine: () => DocEngine | null, active: boolean, tick: unknown) {
  const apply = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Le bloc courant est désigné par une feuille de style (sélecteur sur data-pm-start) plutôt que
    // par une classe posée sur les éléments : SuperDoc repeint les fragments à chaque frappe, et
    // une classe disparaissait le temps d'une image, d'où un clignotement à chaque caractère.
    // Un sélecteur d'attribut s'applique aussitôt aux fragments repeints, sans transition.
    const sheet = document.createElement('style');
    sheet.dataset.edDim = '';
    document.head.appendChild(sheet);
    let last = '';
    const write = (css: string) => {
      if (css !== last) sheet.textContent = last = css;
    };
    if (!active) {
      apply.current = () => {};
      sheet.remove();
      return;
    }
    apply.current = () => {
      const range = engine()?.caretBlockRange() ?? null;
      const starts = new Set<string>();
      if (range) {
        for (const el of host.querySelectorAll<HTMLElement>(FRAGMENTS)) {
          if (el.closest('.superdoc-page-header, .superdoc-page-footer')) continue;
          const story = el.dataset.layoutStory;
          const s = Number(el.dataset.pmStart);
          const e = Number(el.dataset.pmEnd);
          if ((!story || story === 'body') && Number.isFinite(s) && Number.isFinite(e) && s < range.to && Math.max(e, s + 1) > range.from) starts.add(String(s));
        }
      }
      write(
        [...starts]
          .map((v) => `.ed-dim .superdoc-page [data-layout-fragment-id][data-pm-start="${v}"]:not([data-layout-fragment-id] *){opacity:1;transition:none}`)
          .join('\n'),
      );
    };
    apply.current();
    const mo = new MutationObserver(() => apply.current());
    mo.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-pm-start', 'data-pm-end'] });
    return () => {
      mo.disconnect();
      sheet.remove();
    };
  }, [active, hostRef, engine]);

  useEffect(() => {
    if (active) apply.current();
  }, [active, tick]);
}

// ── Machine à écrire ─────────────────────────────────────────
/** Hauteur (part de la zone visible) où se tient la ligne du curseur. */
const TW_RATIO = 0.45;

/**
 * La ligne du curseur se tient vers 45 % de la hauteur visible : recentrage doux à chaque frappe
 * (ou déplacement au clavier). Le défilement manuel n'est pas contrarié : le recentrage reprend à
 * la frappe suivante. Espace ajouté en haut et en bas (variables --ed-tw-top / --ed-tw-bottom).
 */
export function useTypewriter(hostRef: MutableRefObject<HTMLElement | null>, engine: () => DocEngine | null, active: boolean) {
  useEffect(() => {
    const host = hostRef.current;
    const scroller = host?.closest<HTMLElement>('.ed-scroll');
    if (!host || !scroller || !active) return;

    // Espace haut et bas : la première et la dernière ligne peuvent atteindre le milieu.
    let padTop = 0;
    const setPads = () => {
      const h = scroller.clientHeight;
      const top = Math.max(40, Math.round(h * TW_RATIO - 48));
      const bottom = Math.max(72, Math.round(h * (1 - TW_RATIO)));
      const delta = top - padTop;
      scroller.style.setProperty('--ed-tw-top', `${top}px`);
      scroller.style.setProperty('--ed-tw-bottom', `${bottom}px`);
      // la vue ne saute pas quand l'espace du haut change
      if (delta) scroller.scrollTop += delta;
      padTop = top;
    };
    const basePad = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    padTop = basePad;
    scroller.classList.add('ed-tw');
    setPads();
    const ro = new ResizeObserver(() => setPads());
    ro.observe(scroller);

    let raf = 0;
    let dest = scroller.scrollTop;
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    let lastSet = -1;
    const step = () => {
      const cur = scroller.scrollTop;
      // défilement venu d'ailleurs (barre de défilement, recherche, plan…) : on lui laisse la main
      if (lastSet >= 0 && Math.abs(cur - lastSet) > 2) {
        raf = 0;
        return;
      }
      const d = dest - cur;
      if (Math.abs(d) < 0.75) {
        scroller.scrollTop = dest;
        raf = 0;
        return;
      }
      scroller.scrollTop = cur + d * 0.2;
      lastSet = scroller.scrollTop;
      raf = requestAnimationFrame(step);
    };
    const recenter = () => {
      const c = engine()?.caretCoords();
      if (!c) return;
      const sr = scroller.getBoundingClientRect();
      const target = sr.top + scroller.clientHeight * TW_RATIO;
      const d = (c.top + c.bottom) / 2 - target;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const base = raf ? dest : scroller.scrollTop;
      const next = Math.max(0, Math.min(max, base + d));
      if (Math.abs(next - scroller.scrollTop) < 2) return;
      dest = next;
      if (reducedMotion()) {
        stop();
        scroller.scrollTop = dest;
      } else if (!raf) {
        lastSet = -1;
        raf = requestAnimationFrame(step);
      }
    };
    // La repeinture suit la frappe de quelques images : recentrage à l'image suivante, puis vérifié.
    let timers: ReturnType<typeof setTimeout>[] = [];
    // Après une frappe, le moteur peut lui-même ramener le curseur à l'écran (défilement de
    // quelques images) : on le laisse finir puis on recentre, pendant une courte fenêtre.
    let followUntil = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timers.forEach(clearTimeout);
      followUntil = performance.now() + 600;
      requestAnimationFrame(recenter);
      timers = [setTimeout(recenter, 70), setTimeout(recenter, 200), setTimeout(recenter, 420)];
    };
    const onKey = (e: KeyboardEvent) => {
      if (inDocument(e.target) && movesCaret(e)) schedule();
      else followUntil = 0; // autre commande (recherche…) : son défilement n'est pas contrarié
    };
    const onScroll = () => {
      if (raf || performance.now() > followUntil) return;
      clearTimeout(settle);
      settle = setTimeout(recenter, 90);
    };
    // défilement manuel : on s'efface jusqu'à la prochaine frappe
    const cancel = () => {
      timers.forEach(clearTimeout);
      clearTimeout(settle);
      followUntil = 0;
      stop();
    };
    window.addEventListener('keydown', onKey, true);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('wheel', cancel, { passive: true });
    scroller.addEventListener('touchstart', cancel, { passive: true });
    scroller.addEventListener('pointerdown', cancel);
    // activé pendant l'écriture (raccourci) : recentrage tout de suite ; depuis le menu : à la frappe
    if (inDocument(document.activeElement)) schedule();
    return () => {
      cancel();
      ro.disconnect();
      window.removeEventListener('keydown', onKey, true);
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('wheel', cancel);
      scroller.removeEventListener('touchstart', cancel);
      scroller.removeEventListener('pointerdown', cancel);
      const top = scroller.scrollTop;
      scroller.classList.remove('ed-tw');
      scroller.style.removeProperty('--ed-tw-top');
      scroller.style.removeProperty('--ed-tw-bottom');
      scroller.scrollTop = Math.max(0, top - (padTop - basePad));
    };
  }, [active, hostRef, engine]);
}

// ── Bouton ↗ et menu des réglages ────────────────────────────
export function FocusButton({ focusMode, setFocusMode, prefs }: { focusMode: boolean; setFocusMode: (v: boolean) => void; prefs: FocusPrefs }) {
  const pop = usePop();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const openMenu = () => {
    if (wrapRef.current) pop.toggle(wrapRef.current);
  };
  return (
    <span ref={wrapRef} className="ed-spell-group ed-focus-group">
      <button
        className={`icon-btn ${focusMode ? 'active' : ''}`}
        onClick={() => setFocusMode(!focusMode)}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu();
        }}
        title={fmtKeys(focusMode ? 'Quitter le mode concentration (⌘⇧F)' : 'Mode concentration (⌘⇧F)')}
        aria-label="Mode concentration"
        aria-pressed={focusMode}
        data-focus-toggle
      >
        <Maximize2 size={15} />
      </button>
      <button className="icon-btn ed-spell-caret" onClick={openMenu} title="Réglages de la concentration" aria-label="Réglages de la concentration" aria-haspopup="dialog" data-focus-options>
        <ChevronDown size={12} />
      </button>
      <Popover pop={pop} label="Réglages de la concentration" className="ed-spell-options ed-focus-options">
        <div className="ed-pop-title">Concentration</div>
        <label className="ed-spell-check">
          <input type="checkbox" checked={focusMode} onChange={(e) => setFocusMode(e.target.checked)} data-focus-opt="focus" />
          <span className="ed-focus-opt-label">Mode concentration</span>
          <Kbd>⌘⇧F</Kbd>
        </label>
        <label className="ed-spell-check">
          <input type="checkbox" checked={prefs.dim} onChange={(e) => prefs.setDim(e.target.checked)} data-focus-opt="dim" />
          <span className="ed-focus-opt-label">
            Estomper les autres paragraphes
            <small>En mode concentration</small>
          </span>
        </label>
        <label className="ed-spell-check">
          <input type="checkbox" checked={prefs.typewriter} onChange={(e) => prefs.setTypewriter(e.target.checked)} data-focus-opt="typewriter" />
          <span className="ed-focus-opt-label">
            Machine à écrire
            <small>La ligne en cours reste au milieu</small>
          </span>
        </label>
      </Popover>
    </span>
  );
}
