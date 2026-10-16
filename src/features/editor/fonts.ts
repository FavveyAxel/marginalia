// Polices disponibles pour l'éditeur : toutes les polices installées (queryLocalFonts,
// Chromium ≥ 103 / Electron 33), regroupées par famille ; favoris et récentes mémorisés
// dans les réglages de l'app (db.json). Repli sur une liste de base si l'API est absente, refusée ou trop lente.
// Voir research/10 §1.

import { useStore } from '../../lib/store';

type FontData = { family: string; fullName: string; postscriptName: string; style: string };
type QueryLocalFonts = () => Promise<FontData[]>;

/** Police de lecture de l'app (embarquée), toujours proposée. */
export const APP_FONT = 'Literata';

/** Repli : polices fournies avec macOS (présence non vérifiée sur chaque Mac). */
export const BASE_FONTS = [
  'Times New Roman',
  'Georgia',
  'Garamond',
  'Baskerville',
  'Palatino',
  'Hoefler Text',
  'Iowan Old Style',
  'Charter',
  'Helvetica Neue',
  'Arial',
  'Avenir Next',
  'Gill Sans',
  'Optima',
  'Futura',
  'Menlo',
  'Courier New',
];

/** Polices usuelles des consignes universitaires, mises en tête. */
export const ACADEMIC_FONTS = ['Times New Roman', 'Garamond', 'Georgia', 'Arial'];

const CACHE_KEY = 'marginalia.fonts.v1';
const FAV_KEY = 'marginalia.fonts.favorites';
const RECENT_KEY = 'marginalia.fonts.recent';

const read = <T>(k: string): T | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* stockage indisponible */
  }
};

export interface FontList {
  families: string[];
  /** 'system' : liste réelle de la machine ; 'cache' : dernière liste connue ; 'base' : repli. */
  source: 'system' | 'cache' | 'base';
}

let pending: Promise<FontList> | null = null;

/** Familles de polices installées (une seule requête par session). */
export function listSystemFonts(timeoutMs = 3000): Promise<FontList> {
  pending ??= (async (): Promise<FontList> => {
    const q = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
    const fallback = (): FontList => {
      const c = read<string[]>(CACHE_KEY);
      return c?.length ? { families: c, source: 'cache' } : { families: [...BASE_FONTS].sort(cmp), source: 'base' };
    };
    // 1) Liste native de l'app Mac (fiable, sans permission ni geste utilisateur).
    try {
      const native = await (await import('../../lib/platform')).host.listFonts?.();
      if (native && native.length) {
        const families = [...new Set(native)].sort(cmp);
        write(CACHE_KEY, families);
        return { families, source: 'system' };
      }
    } catch {
      /* repli ci-dessous */
    }
    // 2) API du navigateur (peut exiger un geste utilisateur et une permission).
    if (!q) return fallback();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const faces = await Promise.race([
        q.call(window),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error('timeout')), timeoutMs);
        }),
      ]);
      const families = [...new Set(faces.map((f) => f.family).filter((f) => f && !f.startsWith('.')))].sort(cmp);
      if (!families.length) return fallback();
      write(CACHE_KEY, families);
      return { families, source: 'system' };
    } catch {
      pending = null; // nouvelle tentative à la prochaine ouverture du menu
      return fallback();
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  return pending;
}

const cmp = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' });

// Favoris et récentes : réglages de l'app (db.json, comme les autres réglages : survivent au
// redémarrage, aux sauvegardes et restaurations). Anciennes valeurs du localStorage reprises une fois.
const settings = () => {
  try {
    const s = useStore.getState();
    return s.ready ? s.settings : null;
  } catch {
    return null;
  }
};
const saveSetting = (patch: { editorFavoriteFonts?: string[]; editorRecentFonts?: string[] }) => {
  try {
    if (useStore.getState().ready) useStore.getState().updateSettings(patch);
  } catch {
    /* hors de l'app (tests) : localStorage seul */
  }
};
const clean = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : null);

export function favoriteFonts(): string[] {
  return clean(settings()?.editorFavoriteFonts) ?? clean(read<string[]>(FAV_KEY)) ?? [];
}
export function toggleFavoriteFont(f: string): string[] {
  const cur = favoriteFonts();
  const on = cur.some((x) => x.toLowerCase() === f.toLowerCase());
  const next = on ? cur.filter((x) => x.toLowerCase() !== f.toLowerCase()) : [...cur, f].sort(cmp);
  write(FAV_KEY, next);
  saveSetting({ editorFavoriteFonts: next });
  return next;
}
export function isFavoriteFont(favs: string[], f: string): boolean {
  return favs.some((x) => x.toLowerCase() === f.toLowerCase());
}
export function recentFonts(): string[] {
  return clean(settings()?.editorRecentFonts) ?? clean(read<string[]>(RECENT_KEY)) ?? [];
}
export function pushRecentFont(f: string): string[] {
  const next = [f, ...recentFonts().filter((x) => x.toLowerCase() !== f.toLowerCase())].slice(0, 5);
  write(RECENT_KEY, next);
  saveSetting({ editorRecentFonts: next });
  return next;
}

/** Pile CSS pour l'aperçu d'un nom de police dans sa propre police. */
export function fontStack(family: string): string {
  const f = family.replace(/["\\]/g, '');
  if (f === APP_FONT) return `'Literata Variable', 'Literata', serif`;
  return `"${f}", var(--font-ui)`;
}

const widthCache = new Map<string, boolean>();
/** La police est-elle réellement rendue ici ? (test de largeur ; document.fonts.check n'est pas fiable) */
export function isInstalled(family: string): boolean {
  const f = family.replace(/["']/g, '');
  if (f === APP_FONT) return true;
  const hit = widthCache.get(f);
  if (hit !== undefined) return hit;
  const mk = (stack: string) => {
    const s = document.createElement('span');
    s.style.cssText = `position:absolute;visibility:hidden;left:-9999px;font:72px ${stack};white-space:nowrap`;
    s.textContent = 'mmmmmmmmmmlli WwÉé';
    document.body.appendChild(s);
    const w = s.getBoundingClientRect().width;
    s.remove();
    return w;
  };
  const ok = mk(`"${f}", monospace`) !== mk('monospace') || mk(`"${f}", serif`) !== mk('serif');
  widthCache.set(f, ok);
  return ok;
}

/** Nom de famille seul, sans pile CSS ni guillemets ('"Georgia", sans-serif' → 'Georgia'). */
export function familyName(css: string | null | undefined): string | null {
  if (!css) return null;
  const first = css.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  return first || null;
}
