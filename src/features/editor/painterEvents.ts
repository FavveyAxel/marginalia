// « Reproduire la mise en forme » depuis la palette de commandes (sans charger l'éditeur).
export const FORMAT_PAINTER_EVENT = 'marginalia:format-painter';
export type PainterRequest = 'copy' | 'paste';

export function requestFormatPainter(what: PainterRequest): void {
  window.dispatchEvent(new CustomEvent<PainterRequest>(FORMAT_PAINTER_EVENT, { detail: what }));
}
