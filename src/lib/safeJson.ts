// JSON reçu de l'extérieur (paquet partagé, message d'un pair) : refus d'une imbrication démesurée.
// Un tableau imbriqué des milliers de fois se lit et s'enregistre sans erreur, puis ne peut plus être
// transmis entre les processus de l'app au lancement suivant : la bibliothèque ne se chargeait plus.
export const MAX_JSON_DEPTH = 64;

/** L'imbrication des crochets et accolades du texte JSON reste sous `max` (chaînes ignorées ; linéaire). */
export function jsonDepthOk(text: string, max = MAX_JSON_DEPTH): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++; // antislash : le caractère suivant est échappé
      else if (c === 34) inString = false;
      continue;
    }
    if (c === 34) inString = true;
    else if (c === 123 || c === 91) {
      if (++depth > max) return false;
    } else if (c === 125 || c === 93) depth--;
  }
  return true;
}

/** Même contrôle sur une valeur déjà lue. */
export function valueDepthOk(v: unknown, max = MAX_JSON_DEPTH): boolean {
  const stack: [unknown, number][] = [[v, 1]];
  while (stack.length) {
    const [x, d] = stack.pop()!;
    if (x === null || typeof x !== 'object') continue;
    if (d > max) return false;
    for (const y of Array.isArray(x) ? x : Object.values(x as object)) if (y !== null && typeof y === 'object') stack.push([y, d + 1]);
  }
  return true;
}
