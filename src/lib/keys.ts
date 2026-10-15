// Plateforme et raccourcis clavier : un seul endroit pour « ⌘ sur Mac, Ctrl sur Windows ».
//
// Les raccourcis sont écrits partout en notation Mac (⌘ ⌥ ⌃ ⇧) ; `fmtKeys` les affiche à la
// façon de Windows (« Ctrl+Maj+H ») et `matchKeys` les reconnaît sur la plateforme courante.
//
// Correspondance Windows (et Linux) :
//   ⌘ → Ctrl, ⇧ → Maj, ⌥ seul → Alt.
//   ⌘⌥X → Ctrl+Maj+X : jamais Ctrl+Alt+lettre/chiffre, car Ctrl+Alt = AltGr sur les claviers
//   français (AltGr+0 = @, AltGr+3 = #, AltGr+4 = {, AltGr+E = €…) : la saisie de ces caractères
//   déclencherait le raccourci. Exceptions (conflit avec un raccourci ⌘⇧ existant) dans WIN_OVERRIDES.
//
// Plateforme : `?platform=win|mac|linux` dans l'URL (tests), sinon celle de l'app (preload),
// sinon « mac » dans un navigateur (développement, tests historiques : comportement inchangé).

export type OsKind = 'mac' | 'win' | 'linux';

function detectPlatform(): OsKind {
  try {
    const q = new URLSearchParams(window.location.search).get('platform');
    if (q === 'win' || q === 'mac' || q === 'linux') return q;
  } catch {
    /* pas de fenêtre (tests unitaires) */
  }
  const p = typeof window !== 'undefined' ? window.marginalia?.platform : undefined;
  if (p === 'win32') return 'win';
  if (p === 'linux') return 'linux';
  return 'mac';
}

export const platform: OsKind = detectPlatform();
export const isMac = platform === 'mac';
export const isWindows = platform === 'win';

/** Formulations selon le système (« votre Mac » / « votre ordinateur », Finder / Explorateur). */
export const OS_TEXT = isMac
  ? { yourComputer: 'votre Mac', thisComputer: 'ce Mac', fileManager: 'le Finder', systemName: 'du Mac' }
  : { yourComputer: 'votre ordinateur', thisComputer: 'cet ordinateur', fileManager: 'l’Explorateur de fichiers', systemName: 'du système' };

/** Classe `platform-mac` / `platform-win` / `platform-linux` sur <html> (styles propres à chaque système). */
export function applyPlatformClass(root: HTMLElement = document.documentElement): void {
  root.classList.remove('platform-mac', 'platform-win', 'platform-linux');
  root.classList.add(`platform-${platform}`);
}

/**
 * Touche de commande principale enfoncée : ⌘ sur Mac (Ctrl accepté aussi, comme avant),
 * Ctrl ailleurs — mais pas Ctrl+Alt, qui est AltGr sur les claviers européens.
 */
export function isMod(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return isMac ? e.metaKey || e.ctrlKey : e.ctrlKey && !e.altKey && !e.metaKey;
}

// ── Notation ─────────────────────────────────────────────────
interface Combo {
  cmd: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Touche (une lettre en capitale, un chiffre, une flèche, ↩, ⌫…) ; '' si aucune. */
  key: string;
}

function parse(s: string): Combo {
  const c: Combo = { cmd: false, ctrl: false, alt: false, shift: false, key: '' };
  for (const ch of s) {
    if (ch === '⌘') c.cmd = true;
    else if (ch === '⌃') c.ctrl = true;
    else if (ch === '⌥') c.alt = true;
    else if (ch === '⇧') c.shift = true;
    else c.key += ch;
  }
  c.key = c.key.length === 1 ? c.key.toUpperCase() : c.key;
  return c;
}

/** Forme canonique Mac (⌃⌥⇧⌘ + touche), pour les tables. */
function canon(c: Combo): string {
  return `${c.ctrl ? '⌃' : ''}${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.cmd ? '⌘' : ''}${c.key}`;
}

/** Raccourcis Mac qui prennent une autre combinaison sous Windows (conflits). Forme canonique → combinaison Windows. */
const WIN_OVERRIDES: Record<string, Combo> = {
  // ⌃⌘S (barre latérale) : Ctrl+Maj+S sert déjà à « Créer une version » (⌘⌥S).
  '⌃⌘S': { cmd: false, ctrl: true, alt: false, shift: true, key: 'B' },
  // ⌘⌥F (note de bas de page) : Ctrl+Maj+F est le mode concentration (⌘⇧F).
  '⌥⌘F': { cmd: false, ctrl: true, alt: false, shift: true, key: 'N' },
  // ⌘⌥N (note privée) : Ctrl+Maj+N est pris par la note de bas de page ci-dessus.
  '⌥⌘N': { cmd: false, ctrl: true, alt: false, shift: true, key: 'P' },
  // ⌘[ (revenir) : « [ » demande AltGr sur un clavier français ; Alt+← est l'usage de Windows.
  '⌘[': { cmd: false, ctrl: false, alt: true, shift: false, key: '←' },
  // ⌘8 (marques de mise en forme ¶) : Ctrl+Maj+8, comme Word sous Windows…
  '⌘8': { cmd: false, ctrl: true, alt: false, shift: true, key: '8' },
  // …d'où la liste à puces (⌘⇧8) sur Ctrl+Maj+9 (Ctrl+Maj+L, celui de Word, verrouille l'app).
  '⇧⌘8': { cmd: false, ctrl: true, alt: false, shift: true, key: '9' },
  // ⌘⇧H (remplacer) : Ctrl+H, comme Word sous Windows.
  '⇧⌘H': { cmd: false, ctrl: true, alt: false, shift: false, key: 'H' },
  // ⌘? (aide) : F1 sous Windows (Ctrl+? reste accepté).
  '⇧⌘?': { cmd: false, ctrl: false, alt: false, shift: false, key: 'F1' },
  '⌘?': { cmd: false, ctrl: false, alt: false, shift: false, key: 'F1' },
};

/** Combinaison réellement attendue sur cette plateforme (sous Windows : `ctrl` = touche Ctrl). */
function forPlatform(c: Combo): Combo {
  if (isMac) return c;
  const o = WIN_OVERRIDES[canon(c)];
  if (o) return o;
  const ctrl = c.cmd || c.ctrl;
  // ⌘⌥ → Ctrl+Maj (voir l'en-tête : pas de Ctrl+Alt).
  if (c.cmd && c.alt && !c.shift) return { cmd: false, ctrl: true, alt: false, shift: true, key: c.key };
  return { cmd: false, ctrl, alt: c.alt, shift: c.shift, key: c.key };
}

const WIN_KEY_NAMES: Record<string, string> = {
  '↩': 'Entrée',
  '⌫': 'Suppr',
  '⌦': 'Suppr',
  '⎋': 'Échap',
};

function winLabel(c: Combo): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push('Ctrl');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Maj');
  if (c.key) parts.push(WIN_KEY_NAMES[c.key] ?? c.key);
  return parts.join('+');
}

/**
 * Libellé d'un raccourci (ou d'un texte qui en contient) pour la plateforme courante.
 * Mac : inchangé. Windows : « ⌘⇧H » → « Ctrl+Maj+H », « (⌘K) » → « (Ctrl+K) », « ⌘-clic » → « Ctrl+clic ».
 */
export function fmtKeys(text: string): string {
  if (isMac || !text) return text;
  return text.replace(/([⌃⌥⇧⌘]+)(-clic|[^\s)])?/g, (_m, mods: string, rest: string | undefined) => {
    if (rest === '-clic') return `${winLabel(forPlatform(parse(mods)))}+clic`;
    return winLabel(forPlatform(parse(mods + (rest ?? ''))));
  });
}

function keyMatches(key: string, e: KeyboardEvent): boolean {
  if (/^[A-Z]$/.test(key)) return e.code === `Key${key}`;
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` || e.code === `Numpad${key}`;
  switch (key) {
    case '↑':
      return e.key === 'ArrowUp';
    case '↓':
      return e.key === 'ArrowDown';
    case '←':
      return e.key === 'ArrowLeft';
    case '→':
      return e.key === 'ArrowRight';
    case '↩':
      return e.key === 'Enter';
    case '⌫':
    case '⌦':
      return e.key === 'Backspace' || e.key === 'Delete';
    case '':
      return true;
    default:
      return e.key === key || e.key.toUpperCase() === key;
  }
}

/**
 * L'événement correspond-il au raccourci `macCombo` (notation Mac, ex. '⌘⌥S', '⌃⌘S', '⌘D') ?
 * Mac : ⌘ accepte aussi Ctrl (comportement historique), sauf avec ⌃ explicite (⌃⌘ = les deux).
 * Windows / Linux : traduction ci-dessus, modificateurs exacts.
 */
export function matchKeys(e: KeyboardEvent, macCombo: string): boolean {
  const c = forPlatform(parse(macCombo));
  if (!keyMatches(c.key, e)) return false;
  if (e.altKey !== c.alt || e.shiftKey !== c.shift) return false;
  if (isMac) {
    if (c.cmd && c.ctrl) return e.metaKey && e.ctrlKey;
    if (c.cmd) return e.metaKey || e.ctrlKey;
    return e.metaKey === false && e.ctrlKey === c.ctrl;
  }
  return !e.metaKey && e.ctrlKey === c.ctrl;
}

