// ⌘Z global : ne jamais voler l'annulation d'un champ de saisie ou de l'éditeur de texte.
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);

export function isTextEditingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLInputElement) return TEXT_INPUTS.has(t.type || 'text');
  if ((t as HTMLElement).isContentEditable) return true;
  return !!t.closest('[contenteditable=""], [contenteditable="true"], [role="textbox"], .ProseMirror, .superdoc');
}
