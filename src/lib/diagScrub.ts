// Journal de diagnostic local (diagnostic.log) : il reste en clair tant que le chiffrement de toute
// l'app n'est pas activé, et il survit au verrouillage d'un espace chiffré. On n'y écrit donc aucun
// contenu de l'utilisateur. Les messages d'erreur peuvent pourtant en citer (V8 : `Unexpected token
// 'S', "SECRET do"... is not valid JSON`) : les fragments entre guillemets de plus de 3 caractères
// sont remplacés par leur longueur, et chaque ligne est bornée. Les lignes de pile (« at fn (fichier:l:c) »)
// sont gardées : noms de fonctions et positions dans le code ne disent rien du contenu.
// Fonctions pures, sans dépendance (testées par scripts/test-diag-scrub.mjs).

const MAX_LINE = 300;
const KEEP_QUOTED = 3; // un fragment de 3 caractères au plus est gardé ('S', 'id'…)

// Lignes de pile V8 (« at fn (url:1:2) », « at url:1:2 », « at JSON.parse (<anonymous>) ») ou Gecko (« fn@url:1:2 »).
const FRAME = /^\s+at\s+\S.*?(?:\([^()\n]*\)|:\d+:\d+)\s*$|^[^\s@"'«`]*@\S+:\d+:\d+$/u;

// Fragments cités : "…" (échappements JSON compris), «…», “…”, „…“, `…` (y compris non refermés en fin
// de ligne : message tronqué), '…' et ‘…’ (seulement hors d'un mot, pour ne pas confondre avec
// l'apostrophe : « l'interface n'a pas… » reste lisible ; une apostrophe suivie d'une lettre peut
// figurer dans le fragment : 'L'été secret').
const QUOTED =
  /"((?:[^"\\\n]|\\.)*)(?:"|$)|«([^»\n]*)(?:»|$)|“([^”\n]*)(?:”|$)|„([^“”\n]*)(?:[“”]|$)|`([^`\n]*)(?:`|$)|(?<![\p{L}\p{N}])'((?:[^'\n]|'(?=\p{L}))*)'(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])‘((?:[^’\n]|’(?=\p{L}))*)’(?![\p{L}\p{N}])/gmu;

const len = (s: string) => [...s].length;

function cap(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join('') + `…[+${chars.length - max} car.]`;
}

function scrubQuotes(line: string): string {
  return line.replace(QUOTED, (m: string, ...groups: unknown[]) => {
    const inner = groups.slice(0, 7).find((g) => typeof g === 'string') as string | undefined;
    const core = inner?.trim() ?? '';
    if (inner === undefined || len(core) <= KEEP_QUOTED) return m;
    const open = m[0];
    const closed = m.length > open.length + inner.length;
    // Espaces intérieurs gardés (« titre » → « [5 car.] ») : seule la longueur du contenu est notée.
    const lead = inner.match(/^\s*/)![0];
    const trail = inner.slice(lead.length).match(/\s*$/)![0];
    return `${open}${lead}[${len(core)} car.]${trail}${closed ? m[m.length - 1] : ''}`;
  });
}

/** Texte d'une valeur quelconque (erreur, chaîne, objet, nombre…), sans jamais lever. */
function toText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input === null || input === undefined) return '';
  if (typeof input === 'function') return '[fonction]';
  if (typeof input === 'object') {
    const o = input as { message?: unknown; stack?: unknown; name?: unknown };
    if (typeof o.message === 'string') {
      if (typeof o.stack === 'string' && o.stack) return o.stack;
      return `${typeof o.name === 'string' && o.name ? o.name : 'Error'}: ${o.message}`;
    }
    try {
      const j = JSON.stringify(input);
      if (typeof j === 'string') return j;
    } catch {
      /* objet circulaire, getter qui lève… */
    }
    try {
      return Object.prototype.toString.call(input);
    } catch {
      return '[objet]';
    }
  }
  try {
    return String(input);
  } catch {
    return '[valeur]';
  }
}

/**
 * Version consignable d'un message d'erreur ou d'une pile : les fragments cités de plus de 3 caractères
 * deviennent leur longueur (`"[42 car.]"`), chaque ligne hors pile est bornée à 300 caractères et le
 * tout à `max`. Accepte n'importe quelle valeur (une Error donne sa pile).
 */
export function scrubDiag(input: unknown, max = 4000): string {
  const text = toText(input);
  const out = text
    .split('\n')
    .map((line) => (FRAME.test(line) ? cap(line, MAX_LINE) : cap(scrubQuotes(line), MAX_LINE)))
    .join('\n');
  return cap(out, max);
}

/** Résumé consignable d'une erreur rattrapée : « Nom: message » nettoyé, sans la pile. */
export function diagError(e: unknown): string {
  const o = e as { message?: unknown; name?: unknown } | null;
  if (o && typeof o === 'object' && typeof o.message === 'string') {
    return scrubDiag(`${typeof o.name === 'string' && o.name ? o.name : 'Error'}: ${o.message}`, MAX_LINE);
  }
  return scrubDiag(e, MAX_LINE);
}
