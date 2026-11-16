// Mode concentration de l'éditeur : réglages (menu du bouton ↗), interface qui s'efface pendant la
// frappe, paragraphes estompés autour du paragraphe du curseur, « machine à écrire » (la ligne du
// curseur reste au milieu ; chariot : le point de frappe ne bouge pas, la page glisse ; sons de frappe).
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
import { createTypeSounds, type TypeSounds } from './typeSounds';
import { Popover, usePop } from './Popover';
import './focus.css';

const DIM_KEY = 'marginalia.ed.focusDim';
const TYPEWRITER_KEY = 'marginalia.ed.typewriter';
const CARRIAGE_KEY = 'marginalia.ed.twCarriage';
const SOUNDS_KEY = 'marginalia.ed.twSounds';
const VOLUME_KEY = 'marginalia.ed.twVolume';
const VOLUME_DEFAULT = 0.5;
/** Raccourci de la machine à écrire. */
export const TYPEWRITER_KEYS = '⌘⇧T';

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

const readVolume = () => {
  try {
    const v = localStorage.getItem(VOLUME_KEY);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : VOLUME_DEFAULT;
  } catch {
    return VOLUME_DEFAULT;
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
  /** Machine à écrire : le point de frappe reste au milieu, la page glisse de gauche à droite. */
  carriage: boolean;
  /** Machine à écrire : sons de frappe. */
  sounds: boolean;
  /** Volume des sons, de 0 à 1. */
  volume: number;
  setDim: (v: boolean) => void;
  setTypewriter: (v: boolean) => void;
  setCarriage: (v: boolean) => void;
  setSounds: (v: boolean) => void;
  setVolume: (v: number) => void;
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
  const [carriage, setCarriageState] = useState(() => read(CARRIAGE_KEY, true));
  const [sounds, setSoundsState] = useState(() => read(SOUNDS_KEY, true));
  const [volume, setVolumeState] = useState(readVolume);
  const setCarriage = useCallback((v: boolean) => {
    write(CARRIAGE_KEY, v);
    setCarriageState(v);
  }, []);
  const setSounds = useCallback((v: boolean) => {
    write(SOUNDS_KEY, v);
    setSoundsState(v);
  }, []);
  const setVolume = useCallback((v: number) => {
    const n = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem(VOLUME_KEY, String(n));
    } catch {
      /* indisponible */
    }
    setVolumeState(n);
  }, []);
  return { dim, typewriter, carriage, sounds, volume, setDim, setTypewriter, setCarriage, setSounds, setVolume };
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
 *
 * `carriage` : le curseur se tient aussi au milieu de la largeur, comme le point de frappe d'une
 * machine ; la page glisse à chaque caractère et revient d'un trait en fin de ligne. Espace ajouté
 * à gauche et à droite (--ed-tw-side), défilement horizontal piloté d'ici (classe ed-tw-x).
 */
export function useTypewriter(hostRef: MutableRefObject<HTMLElement | null>, engine: () => DocEngine | null, active: boolean, carriage = false) {
  useEffect(() => {
    const host = hostRef.current;
    const scroller = host?.closest<HTMLElement>('.ed-scroll');
    if (!host || !scroller || !active) return;

    // Chariot : la zone d'écriture s'étend sous le plan et le panneau latéral (marges négatives,
    // --ed-tw-l / --ed-tw-r) : le point de frappe est au milieu de l'éditeur et la page glisse sur
    // toute sa largeur. Par-dessus : le repère du point de frappe et un fondu vers les bords.
    const center = scroller.parentElement;
    const bodyEl = scroller.closest<HTMLElement>('.ed-body');
    const stage = carriage && center ? document.createElement('div') : null;
    const guide = stage ? document.createElement('div') : null;
    if (stage && guide && center) {
      stage.className = 'ed-tw-stage';
      stage.setAttribute('aria-hidden', 'true');
      guide.className = 'ed-tw-guide';
      stage.appendChild(guide);
      center.appendChild(stage);
    }
    let lineBottom = 14;
    const placeGuide = () => {
      if (!stage || !guide) return;
      stage.style.top = `${scroller.offsetTop}px`;
      stage.style.height = `${scroller.clientHeight}px`;
      guide.style.top = `${Math.round(scroller.clientHeight * TW_RATIO + lineBottom + 3)}px`;
    };

    // Espace haut et bas : la première et la dernière ligne peuvent atteindre le milieu.
    let padTop = 0;
    let padSide = 0;
    /** Espace de côté en plus, quand la page déborde de la colonne (zoom fort, fenêtre étroite). */
    let extra = 0;
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
      if (carriage) {
        // Espace à gauche et à droite : le début et la fin de chaque ligne peuvent atteindre le milieu.
        // Le moteur garde la largeur de la colonne centrale (zoom « ajuster » inchangé).
        const cr = center?.getBoundingClientRect();
        const br = bodyEl?.getBoundingClientRect();
        const l = cr && br ? Math.max(0, Math.round(cr.left - br.left)) : 0;
        const r = cr && br ? Math.max(0, Math.round(br.right - cr.right)) : 0;
        center?.style.setProperty('--ed-tw-l', `${l}px`);
        center?.style.setProperty('--ed-tw-r', `${r}px`);
        scroller.style.setProperty('--ed-tw-w', `${Math.round(cr?.width ?? scroller.clientWidth)}px`);
        const side = Math.round(scroller.clientWidth / 2) + extra;
        scroller.style.setProperty('--ed-tw-side', `${side}px`);
        // au repos, la page reste où elle était
        const neutral = side - l;
        scroller.scrollLeft += neutral - padSide;
        padSide = neutral;
        placeGuide();
      }
    };
    const basePad = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    padTop = basePad;
    scroller.classList.add('ed-tw');
    if (carriage) scroller.classList.add('ed-tw-x');
    setPads();
    const ro = new ResizeObserver(() => setPads());
    ro.observe(scroller);
    if (carriage && center) ro.observe(center);

    let raf = 0;
    let destY = scroller.scrollTop;
    let destX = scroller.scrollLeft;
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    let lastY = -1;
    let lastX = -1;
    let slowUntil = 0;
    const step = () => {
      const y = scroller.scrollTop;
      const x = scroller.scrollLeft;
      // défilement venu d'ailleurs (barre de défilement, recherche, plan…) : on lui laisse la main
      if ((lastY >= 0 && Math.abs(y - lastY) > 2) || (lastX >= 0 && Math.abs(x - lastX) > 2)) {
        raf = 0;
        return;
      }
      const dy = destY - y;
      const dx = carriage ? destX - x : 0;
      if (Math.abs(dy) < 0.75 && Math.abs(dx) < 0.75) {
        scroller.scrollTop = destY;
        if (carriage) scroller.scrollLeft = destX;
        raf = 0;
        return;
      }
      scroller.scrollTop = y + dy * 0.2;
      lastY = scroller.scrollTop;
      if (carriage) {
        // chaque caractère : la page suit la frappe sans traîner ; changement de ligne : le
        // chariot revient d'un trait, plus posément
        scroller.scrollLeft = x + dx * (performance.now() < slowUntil ? 0.2 : 0.52);
        lastX = scroller.scrollLeft;
      }
      raf = requestAnimationFrame(step);
    };
    const recenter = () => {
      const c = engine()?.caretCoords();
      if (!c) return;
      const sr = scroller.getBoundingClientRect();
      const y = scroller.scrollTop;
      const maxY = scroller.scrollHeight - scroller.clientHeight;
      const nextY = Math.max(0, Math.min(maxY, y + (c.top + c.bottom) / 2 - (sr.top + scroller.clientHeight * TW_RATIO)));
      let moveX = false;
      let nextX = destX;
      if (carriage && c.left !== null) {
        const off = c.left - (sr.left + scroller.clientWidth / 2);
        // la page déborde de la colonne : on élargit l'espace de côté pour que le curseur atteigne le milieu
        const short = Math.max(-(scroller.scrollLeft + off), scroller.scrollLeft + off - (scroller.scrollWidth - scroller.clientWidth));
        if (short > 0 && extra < 6000) {
          extra += Math.ceil(short) + 80;
          setPads();
        }
        const x = scroller.scrollLeft;
        const maxX = scroller.scrollWidth - scroller.clientWidth;
        nextX = Math.max(0, Math.min(maxX, x + off));
        moveX = Math.abs(nextX - x) >= 1;
        const lb = (c.bottom - c.top) / 2;
        if (Math.abs(lb - lineBottom) > 1) {
          lineBottom = lb;
          placeGuide();
        }
      }
      const moveY = Math.abs(nextY - y) >= 2;
      if (!moveY && !moveX) return;
      if (moveY && carriage && Math.abs(nextY - destY) >= 2) slowUntil = performance.now() + 500;
      destY = moveY ? nextY : y;
      if (carriage) destX = moveX ? nextX : scroller.scrollLeft;
      if (reducedMotion()) {
        stop();
        scroller.scrollTop = destY;
        if (carriage) scroller.scrollLeft = destX;
      } else if (!raf) {
        lastY = lastX = -1;
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
    // Frappe : la lettre qui vient d'être tapée arrive grossie puis se pose, comme un caractère
    // qui marque le papier. Calque posé sur la lettre peinte (le texte n'est pas touché), dans la
    // zone qui défile : il suit la page pendant que le chariot glisse.
    let strikeRaf = 0;
    type HighlightSet = Set<Range>;
    const highlights = (CSS as unknown as { highlights?: Map<string, HighlightSet> }).highlights;
    const HighlightCtor = (window as unknown as { Highlight?: new () => HighlightSet }).Highlight;
    const struck: HighlightSet = highlights && HighlightCtor ? new HighlightCtor() : new Set<Range>();
    if (highlights && HighlightCtor) highlights.set('ed-tw-struck', struck);
    const strike = (want: string): boolean => {
      const c = engine()?.caretCoords();
      const point = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint;
      if (!c || c.left === null || !point) return false;
      const at = point.call(document, c.left - 2, (c.top + c.bottom) / 2);
      const node = at?.startContainer;
      if (!at || !node || node.nodeType !== Node.TEXT_NODE || !host.contains(node)) return false;
      const data = (node as Text).data;
      // la lettre dont le bord droit touche le curseur
      let box: DOMRect | null = null;
      let ch = '';
      let idx = -1;
      for (const i of [at.startOffset - 1, at.startOffset]) {
        if (i < 0 || i >= data.length) continue;
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + 1);
        const b = r.getBoundingClientRect();
        if (b.width > 0 && Math.abs(b.right - c.left) < 3) {
          box = b;
          ch = data[i];
          idx = i;
          break;
        }
      }
      const parent = node.parentElement;
      if (!box || ch !== want || !parent) return false;
      const cs = getComputedStyle(parent);
      const el = document.createElement('span');
      el.className = 'ed-tw-strike';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = ch;
      el.style.font = cs.font;
      el.style.lineHeight = 'normal';
      el.style.color = cs.color;
      el.style.letterSpacing = cs.letterSpacing;
      scroller.appendChild(el);
      // même taille que la lettre peinte, quel que soit le zoom ; puis en gras, le temps de la frappe
      const k = box.width / (el.offsetWidth || box.width);
      el.style.fontWeight = '700';
      const sr = scroller.getBoundingClientRect();
      el.style.left = `${box.left + box.width / 2 - sr.left + scroller.scrollLeft - el.offsetWidth / 2}px`;
      el.style.top = `${box.top + box.height / 2 - sr.top + scroller.scrollTop - el.offsetHeight / 2}px`;
      (window as unknown as { __twStrikes?: string[] }).__twStrikes?.push(ch);
      // la lettre peinte s'efface le temps de l'animation : on ne voit que celle qui frappe
      const hide = highlights ? document.createRange() : null;
      if (hide && highlights) {
        hide.setStart(node, idx);
        hide.setEnd(node, idx + 1);
        struck.add(hide);
      }
      // comme une frappe : la lettre arrive grasse et grossie, se resserre, puis laisse la lettre peinte
      const anim = el.animate([{ transform: `scale(${k * 1.35})` }, { transform: `scale(${k})` }], { duration: 90, easing: 'linear' });
      anim.onfinish = anim.oncancel = () => {
        el.remove();
        if (hide) struck.delete(hide);
      };
      return true;
    };
    /** Attend que la lettre soit peinte devant le curseur (quelques images après la frappe). */
    const strikeSoon = (want: string) => {
      if (reducedMotion()) return;
      cancelAnimationFrame(strikeRaf);
      let tries = 0;
      const wait = () => {
        if (!strike(want) && ++tries < 14) strikeRaf = requestAnimationFrame(wait);
      };
      strikeRaf = requestAnimationFrame(wait);
    };
    const onKey = (e: KeyboardEvent) => {
      if (inDocument(e.target) && movesCaret(e)) {
        schedule();
        if (e.key.length === 1 && e.key !== ' ' && !isMod(e)) strikeSoon(e.key);
      } else followUntil = 0; // autre commande (recherche…) : son défilement n'est pas contrarié
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
      cancelAnimationFrame(strikeRaf);
      scroller.querySelectorAll('.ed-tw-strike').forEach((x) => x.remove());
      highlights?.delete('ed-tw-struck');
      stage?.remove();
      center?.style.removeProperty('--ed-tw-l');
      center?.style.removeProperty('--ed-tw-r');
      const top = scroller.scrollTop;
      scroller.classList.remove('ed-tw', 'ed-tw-x');
      for (const v of ['--ed-tw-top', '--ed-tw-bottom', '--ed-tw-side', '--ed-tw-w']) scroller.style.removeProperty(v);
      scroller.scrollTop = Math.max(0, top - (padTop - basePad));
      if (carriage) scroller.scrollLeft = 0;
    };
  }, [active, carriage, hostRef, engine]);
}

// ── Machine à écrire : sons de frappe ────────────────────────
/**
 * Un son par frappe dans le texte : touche, espace, retour arrière, retour chariot (Entrée). Quand
 * la frappe fait passer le curseur à la ligne suivante, la clochette tinte puis le chariot revient.
 */
export function useTypeSounds(hostRef: MutableRefObject<HTMLElement | null>, engine: () => DocEngine | null, active: boolean, volume: number) {
  const sounds = useRef<TypeSounds | null>(null);
  const vol = useRef(volume);
  vol.current = volume;

  useEffect(() => {
    sounds.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    const scroller = hostRef.current?.closest<HTMLElement>('.ed-scroll');
    if (!scroller || !active) return;
    const snd = createTypeSounds(vol.current);
    if (!snd) return;
    sounds.current = snd;
    /** Position du curseur dans la page (insensible au défilement). */
    const caretY = () => {
      const c = engine()?.caretCoords();
      return c ? { y: c.top - scroller.getBoundingClientRect().top + scroller.scrollTop, h: c.bottom - c.top } : null;
    };
    // Fin de ligne : d'une frappe à l'autre, le curseur est descendu d'une ligne. `line` est la
    // dernière position relevée pendant la frappe en cours ; toute autre action l'oublie.
    let line: { y: number; h: number } | null = null;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const look = () => {
      const now = caretY();
      if (line && now && now.y - line.y >= line.h * 0.6) {
        snd.play('bell');
        snd.play('return', 0.16);
      }
      line = now;
    };
    const forget = () => {
      timers.forEach(clearTimeout);
      line = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!inDocument(e.target)) return;
      const char = !isMod(e) && !e.altKey && (e.key.length === 1 || e.key === 'Dead' || e.key === 'Process');
      if (!char && e.key !== 'Tab') {
        if (['Shift', 'CapsLock', 'Control', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return;
        forget();
        if (isMod(e) || e.altKey) return;
        if (e.key === 'Enter') snd.play('return');
        else if (e.key === 'Backspace' || e.key === 'Delete') snd.play('back');
        return;
      }
      snd.play(e.key === ' ' || e.key === 'Tab' ? 'space' : 'key');
      // relevé avant cette frappe (effet des précédentes), puis après la repeinture de celle-ci
      look();
      timers.forEach(clearTimeout);
      timers = [setTimeout(look, 60), setTimeout(look, 160)];
    };
    scroller.addEventListener('pointerdown', forget);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      scroller.removeEventListener('pointerdown', forget);
      timers.forEach(clearTimeout);
      sounds.current = null;
      snd.dispose();
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
          <Kbd>{TYPEWRITER_KEYS}</Kbd>
        </label>
        {prefs.typewriter && (
          <div className="ed-focus-sub">
            <label className="ed-spell-check">
              <input type="checkbox" checked={prefs.carriage} onChange={(e) => prefs.setCarriage(e.target.checked)} data-focus-opt="carriage" />
              <span className="ed-focus-opt-label">
                Chariot
                <small>La page glisse sous le point de frappe</small>
              </span>
            </label>
            <label className="ed-spell-check">
              <input type="checkbox" checked={prefs.sounds} onChange={(e) => prefs.setSounds(e.target.checked)} data-focus-opt="sounds" />
              <span className="ed-focus-opt-label">
                Sons de frappe
                <small>Touches, clochette, retour chariot</small>
              </span>
            </label>
            {prefs.sounds && (
              <label className="ed-focus-volume">
                <span>Volume</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round(prefs.volume * 100)}
                  onChange={(e) => prefs.setVolume(Number(e.target.value) / 100)}
                  aria-label="Volume des sons de frappe"
                  data-focus-opt="volume"
                />
                <output>{Math.round(prefs.volume * 100)} %</output>
              </label>
            )}
          </div>
        )}
      </Popover>
    </span>
  );
}
