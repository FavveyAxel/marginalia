// Confort visuel de l'éditeur (AFFICHAGE SEULEMENT : le .docx, les exports et l'impression gardent
// les couleurs réelles du document).
//  - teinte de la page : suit le thème (crème / sépia / anthracite) ou forcée (blanc, crème, sépia, sombre) ;
//  - en teinte sombre, les couleurs explicites trop proches du fond (texte noir, surlignage jaune,
//    encadrés clairs, bordures noires) sont remappées à l'écran, sans toucher au document ;
//  - zoom d'affichage mémorisé (« Ajuster à la largeur » par défaut) ;
//  - police des nouveaux écrits (modèle « Vide » et écrits créés sans modèle).
// Préférences locales (localStorage, dans try/catch) : propres à cet ordinateur.
import { useCallback, useEffect, useState, type RefObject } from 'react';
import { isMac } from '../../lib/keys';

// ── Préférences ──────────────────────────────────────────────
const TINT_KEY = 'marginalia.ed.pageTint';
const ZOOM_KEY = 'marginalia.ed.zoom';
const FONT_KEY = 'marginalia.ed.newDraftFont';

const readKey = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeKey = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* stockage indisponible : réglage pour cette session seulement */
  }
};

export type PageTint = 'theme' | 'white' | 'cream' | 'sepia' | 'dark';
/** Teinte réellement peinte. */
export type ResolvedTint = Exclude<PageTint, 'theme'>;
export const PAGE_TINTS: { id: PageTint; label: string; swatch?: string }[] = [
  { id: 'theme', label: 'Suivre le thème' },
  { id: 'white', label: 'Blanc', swatch: '#ffffff' },
  { id: 'cream', label: 'Crème', swatch: '#fbf7ee' },
  { id: 'sepia', label: 'Sépia', swatch: '#f3e9d4' },
  { id: 'dark', label: 'Sombre', swatch: '#2b2a27' },
];
const TINT_IDS = PAGE_TINTS.map((t) => t.id);

export function readPageTint(): PageTint {
  const v = readKey(TINT_KEY) as PageTint | null;
  return v && TINT_IDS.includes(v) ? v : 'theme';
}

/** Teinte suivant le thème affiché (data-theme sur <html> : light | sepia | dark). */
export function resolveTint(t: PageTint): ResolvedTint {
  if (t !== 'theme') return t;
  const th = typeof document !== 'undefined' ? document.documentElement.dataset.theme : 'light';
  return th === 'dark' ? 'dark' : th === 'sepia' ? 'sepia' : 'cream';
}

export type ZoomPref = number | 'fit';
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
/** Bornes du mode « Ajuster à la largeur » (75 % : une page A4 reste entière avec le plan et le panneau
 *  latéral ouverts sur un écran de 1440 px ; au-dessous, la page déborde et défile horizontalement). */
export const FIT_MIN = 75;
export const FIT_MAX = 200;
/** Paliers de ⌘+ / ⌘- (zoom de la page). */
export const ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];

export function readZoomPref(): ZoomPref {
  const v = readKey(ZOOM_KEY);
  if (!v || v === 'fit') return 'fit';
  const n = Number(v);
  return Number.isFinite(n) && n >= ZOOM_MIN && n <= ZOOM_MAX ? n : 'fit';
}
export function writeZoomPref(z: ZoomPref): void {
  writeKey(ZOOM_KEY, String(z));
}
/** Palier suivant (dir = 1) ou précédent (dir = -1) depuis le zoom affiché. */
export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > current + 0.5) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < current - 0.5) ?? ZOOM_MIN;
}

// ── Police des nouveaux écrits ───────────────────────────────
export type NewDraftFont = 'Literata' | 'Times New Roman' | 'Georgia' | 'Arial' | 'system';
/** Police du système, sous un nom que Word connaît sur cette plateforme. */
export const SYSTEM_DOC_FONT = isMac ? 'Helvetica Neue' : 'Segoe UI';
export const NEW_DRAFT_FONTS: { id: NewDraftFont; label: string }[] = [
  { id: 'Literata', label: 'Literata' },
  { id: 'Times New Roman', label: 'Times New Roman' },
  { id: 'Georgia', label: 'Georgia' },
  { id: 'Arial', label: 'Arial' },
  { id: 'system', label: `Police du système (${SYSTEM_DOC_FONT})` },
];
export function readNewDraftFont(): NewDraftFont {
  const v = readKey(FONT_KEY) as NewDraftFont | null;
  return v && NEW_DRAFT_FONTS.some((f) => f.id === v) ? v : 'Literata';
}
export function writeNewDraftFont(f: NewDraftFont): void {
  writeKey(FONT_KEY, f);
}
/** Nom de police écrit dans le .docx (w:rFonts). */
export function newDraftFontName(f: NewDraftFont = readNewDraftFont()): string {
  return f === 'system' ? SYSTEM_DOC_FONT : f;
}

// ── Couleurs ─────────────────────────────────────────────────
type RGB = [number, number, number];

function parseColor(s: string): RGB | null {
  const m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined) {
      const a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
      if (a < 0.05) return null; // transparent
    }
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  const h = s.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (h) {
    const x = h[1].length === 3 ? h[1].replace(/./g, (c) => c + c) : h[1];
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
  }
  return null;
}
const hex = (c: RGB) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
function lum([r, g, b]: RGB): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: RGB, b: RGB): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function toHsl([r, g, b]: RGB): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}
function fromHsl([h, s, l]: [number, number, number]): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Couleur de texte (ou de trait) lisible sur une page sombre : les gris et le noir prennent l'encre de
 * la page ; une couleur garde sa teinte, éclaircie jusqu'au contraste voulu. null : inchangée.
 */
export function adaptInk(c: RGB, bg: RGB, fg: RGB, min = 3): RGB | null {
  if (contrast(c, bg) >= min) return null;
  const [h, s, l] = toHsl(c);
  if (s < 0.18) return fg;
  let L = Math.max(l, 1 - l, 0.6);
  let out = fromHsl([h, Math.min(s, 0.75), L]);
  while (contrast(out, bg) < 4.5 && L < 0.92) {
    L += 0.04;
    out = fromHsl([h, Math.min(s, 0.75), L]);
  }
  return out;
}
/** Fond (surlignage, trame, cellule) sur page sombre : les fonds clairs sont assombris en gardant leur teinte. */
export function adaptFill(c: RGB, bg: RGB): RGB | null {
  if (lum(c) < 0.3) return null;
  const [, s] = toHsl(c);
  return mix(bg, c, s < 0.15 ? 0.1 : 0.27);
}

// ── Remappage des couleurs peintes (teinte sombre) ───────────
const FG_VAR = '--mgl-fg';
const BG_VAR = '--mgl-bg';
const BORDER_VARS = ['--mgl-bt', '--mgl-br', '--mgl-bb', '--mgl-bl'] as const;
const BORDER_PROPS = ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor'] as const;
const SKIP = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'svg', 'image']);

/** Pose une variable seulement si elle change (évite de relancer l'observateur pour rien). */
function setVar(st: CSSStyleDeclaration, name: string, v: string) {
  if (st.getPropertyValue(name) !== v) st.setProperty(name, v);
}

function readVar(el: Element, name: string): RGB | null {
  return parseColor(getComputedStyle(el).getPropertyValue(name).trim());
}

/** Annule les remappages (retour à une teinte claire). */
function clearAll(root: Element) {
  root.querySelectorAll<HTMLElement>('[data-mgl-fg],[data-mgl-bg],[data-mgl-bd]').forEach((el) => {
    el.style.removeProperty(FG_VAR);
    el.style.removeProperty(BG_VAR);
    for (const v of BORDER_VARS) el.style.removeProperty(v);
    el.removeAttribute('data-mgl-fg');
    el.removeAttribute('data-mgl-bg');
    el.removeAttribute('data-mgl-bd');
  });
}

/**
 * Remappe un élément peint. Les valeurs d'origine viennent du style en ligne posé par SuperDoc ;
 * le remplacement passe par des variables CSS (règles !important de editor.css), si bien qu'un
 * nouveau rendu du moteur (style réécrit) est simplement retraité.
 */
function adaptEl(el: HTMLElement, bg: RGB, fg: RGB) {
  if (SKIP.has(el.tagName) || el.classList.contains('superdoc-page') || el.closest('[data-style-id="MarginaliaNotePrivee"]')) return;
  const st = el.style;
  // Texte
  const c = st.color ? parseColor(st.color) : null;
  const ink = c ? adaptInk(c, bg, fg) : null;
  if (ink) {
    setVar(st, FG_VAR, hex(ink));
    el.setAttribute('data-mgl-fg', '');
  } else if (el.hasAttribute('data-mgl-fg')) {
    st.removeProperty(FG_VAR);
    el.removeAttribute('data-mgl-fg');
  }
  // Fond (surlignage, trame de paragraphe, cellule)
  const b = st.backgroundColor ? parseColor(st.backgroundColor) : null;
  const fill = b ? adaptFill(b, bg) : null;
  if (fill) {
    setVar(st, BG_VAR, hex(fill));
    el.setAttribute('data-mgl-bg', '');
  } else if (el.hasAttribute('data-mgl-bg')) {
    st.removeProperty(BG_VAR);
    el.removeAttribute('data-mgl-bg');
  }
  // Bordures (encadrés, tableaux, filets) : on remplace les quatre côtés ensemble.
  if (st.borderStyle || st.borderTopStyle || st.borderLeftStyle || st.borderBottomStyle || st.borderRightStyle) {
    let any = false;
    const vals = BORDER_PROPS.map((p) => {
      const o = st[p] ? parseColor(st[p]) : null;
      if (!o) return st[p] || 'currentcolor';
      const a = adaptInk(o, bg, mix(fg, bg, 0.35), 1.8);
      if (a) any = true;
      return a ? hex(a) : st[p];
    });
    if (any) {
      BORDER_VARS.forEach((v, i) => setVar(st, v, vals[i]));
      el.setAttribute('data-mgl-bd', '');
    } else if (el.hasAttribute('data-mgl-bd')) {
      for (const v of BORDER_VARS) st.removeProperty(v);
      el.removeAttribute('data-mgl-bd');
    }
  }
}

/** Traite les pages peintes de `host` (toutes, ou seulement les éléments donnés). */
function adaptTree(host: HTMLElement, els?: Iterable<HTMLElement>) {
  const bg = readVar(host, '--ed-page-bg');
  const fg = readVar(host, '--ed-page-fg');
  if (!bg || !fg) return;
  const list = els ?? host.querySelectorAll<HTMLElement>('.superdoc-page [style]');
  for (const el of list) if (el.isConnected) adaptEl(el, bg, fg);
}

/**
 * Teinte de page : attribut `data-ed-tint` sur l'hôte du moteur, réglage mémorisé, et remappage
 * des couleurs en teinte sombre (suivi des repeints de SuperDoc et des changements de thème).
 */
export function usePageTint(hostRef: RefObject<HTMLElement>, ready: boolean): [PageTint, (t: PageTint) => void, ResolvedTint] {
  const [tint, setTintState] = useState<PageTint>(readPageTint);
  const [resolved, setResolved] = useState<ResolvedTint>(() => resolveTint(readPageTint()));

  // Thème de l'app → teinte affichée
  useEffect(() => {
    const upd = () => {
      const r = resolveTint(tint);
      // attribut posé tout de suite (avant la prochaine image), le remappage suit avec l'état
      hostRef.current?.setAttribute('data-ed-tint', r);
      setResolved(r);
    };
    upd();
    const mo = new MutationObserver(upd);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, [tint, hostRef]);

  // Attribut + remappage
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.setAttribute('data-ed-tint', resolved);
    if (!ready) return;
    if (resolved !== 'dark') {
      clearAll(host);
      return;
    }
    adaptTree(host);
    const pending = new Set<HTMLElement>();
    let frame = 0;
    const flush = () => {
      frame = 0;
      const els = [...pending];
      pending.clear();
      adaptTree(host, els);
    };
    const add = (el: Node) => {
      if (!(el instanceof HTMLElement) || !el.closest('.superdoc-page')) return;
      if (el.hasAttribute('style')) pending.add(el);
      el.querySelectorAll<HTMLElement>('[style]').forEach((x) => pending.add(x));
    };
    const mo = new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === 'attributes') {
          const el = r.target as HTMLElement;
          // nos propres variables : ignorées si la couleur d'origine n'a pas changé
          if (el.closest?.('.superdoc-page')) pending.add(el);
        } else r.addedNodes.forEach(add);
      }
      if (pending.size && !frame) frame = requestAnimationFrame(flush);
    });
    mo.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [hostRef, resolved, ready]);

  const setTint = useCallback((t: PageTint) => {
    writeKey(TINT_KEY, t);
    setTintState(t);
  }, []);
  return [tint, setTint, resolved];
}
