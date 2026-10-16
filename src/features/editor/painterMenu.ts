// Menu Édition natif → pinceau de mise en forme.
// « Copier la mise en forme » (⌥⌘C / Ctrl+Maj+C) et « Coller la mise en forme » (⌥⌘V / Ctrl+Maj+V)
// envoient 'copy-format' / 'paste-format' (electron/main.cjs, canal 'marginalia:editor-command').
// Ces éléments ne se déclenchent que si la page n'a pas consommé la touche (le pinceau l'intercepte
// d'abord quand le curseur est dans le texte) : on les relaie par le même événement que la palette de
// commandes (requestFormatPainter), écouté par useFormatPainter quand l'éditeur est ouvert.
import { host } from '../../lib/platform';
import { requestFormatPainter } from './painterEvents';

export const EDITOR_COMMANDS = { 'copy-format': 'copy', 'paste-format': 'paste' } as const;

/** Abonne le pinceau aux commandes du menu ; renvoie la fonction de désabonnement (no-op en navigateur). */
export function bindPainterMenu(): () => void {
  const off = host.onEditorCommand?.((cmd) => {
    const what = EDITOR_COMMANDS[cmd as keyof typeof EDITOR_COMMANDS];
    if (what) requestFormatPainter(what);
  });
  return off ?? (() => {});
}
