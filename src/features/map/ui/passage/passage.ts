// 11. Passage du livre → carte : petit bus entre le panneau « Livre à côté » (BookSide) et la carte
// affichée (ArgumentMapView). Sans store : un seul panneau et une seule carte sont montés à la fois.
//
//   Panneau : la barre de sélection enregistre son action « citer » (registerCite) ; « Sur la carte »
//             (clic) ou un glisser (bouton de la barre, ou le texte sélectionné lui-même) passent ici.
//   Carte   : un dépôt (dropPassage) récupère le passage sélectionné (takePassage → l'action citer du
//             moteur, qui calcule l'ancre), puis le menu de catégorie (PassageMenu) le crée et le pose
//             à l'endroit du dépôt grâce au « placeur » enregistré par la carte (usePassagePlacer).
import { useEffect, useRef, type DragEvent as RDragEvent } from 'react';
import type { NewHighlightInput } from '../../../reader/engine';

/** Type de données d'un glisser de passage. */
export const PASSAGE_TYPE = 'text/marginalia-passage';

export interface Pt {
  x: number;
  y: number;
}

/** Passage en attente de classement : texte, livre, point d'écran du menu, point de la carte (dépôt). */
export interface PassageReq {
  input: NewHighlightInput;
  bookId: string;
  screen: Pt;
  /** Position sur la carte (coin haut gauche de la carte à créer) ; absent : place libre au centre de la vue. */
  at?: Pt;
}

let cite: (() => void) | null = null;
let capture: ((input: NewHighlightInput, bookId: string) => void) | null = null;
let lastPointer: Pt = { x: 0, y: 0 };
const listeners = new Set<(r: PassageReq) => void>();
let placer: ((highlightId: string, at?: Pt) => string | null) | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => (lastPointer = { x: e.clientX, y: e.clientY }), true);
}

/** Action « citer » de la barre de sélection affichée (null : barre fermée). */
export function registerCite(fn: (() => void) | null) {
  cite = fn;
}
export const hasPassage = () => !!cite;

export const isPassageDrag = (e: { dataTransfer: DataTransfer | null }) => Array.from(e.dataTransfer?.types ?? []).includes(PASSAGE_TYPE);

/** Rappel du panneau : passage remis par le moteur (clic « Sur la carte », ou capture d'un dépôt). */
export function receivePassage(input: NewHighlightInput, bookId: string) {
  if (capture) return capture(input, bookId);
  emit({ input, bookId, screen: { x: lastPointer.x, y: lastPointer.y + 12 } });
}

/** Lit le passage sélectionné dans le panneau (la sélection est consommée). */
export function takePassage(): { input: NewHighlightInput; bookId: string } | null {
  if (!cite) return null;
  let got: { input: NewHighlightInput; bookId: string } | null = null;
  capture = (input, bookId) => (got = { input, bookId });
  try {
    cite();
  } finally {
    capture = null;
  }
  return got;
}

/**
 * Dépôt sur la carte. La barre de sélection peut mettre un instant à réapparaître après un glisser
 * du texte lui-même (le moteur relit la sélection) : on attend jusqu'à ~½ s.
 */
export function dropPassage(screen: Pt, at: Pt): void {
  const t0 = performance.now();
  const tryTake = () => {
    const p = takePassage();
    if (p) return emit({ ...p, screen, at });
    if (performance.now() - t0 < 600) setTimeout(tryTake, 40);
  };
  tryTake();
}

function emit(r: PassageReq) {
  for (const l of listeners) l(r);
}
export function onPassage(fn: (r: PassageReq) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** La carte affichée enregistre de quoi poser un extrait (à `at`, ou à une place libre au centre de la vue). */
export function usePassagePlacer(fn: (highlightId: string, at?: Pt) => string | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const me = (hid: string, at?: Pt) => ref.current(hid, at);
    placer = me;
    return () => {
      if (placer === me) placer = null;
    };
  }, []);
}
export const placePassage = (highlightId: string, at?: Pt): string | null => (placer ? placer(highlightId, at) : null);
export const hasPlacer = () => !!placer;

/**
 * Glisser du texte sélectionné lui-même (et non du bouton) : le moteur a masqué sa barre au
 * `mousedown` et n'aura pas de `mouseup` (le glisser l'avale). On lui en envoie un : il relit la
 * sélection, la barre réapparaît et réenregistre son action « citer » pour le dépôt.
 */
export function startTextDrag(e: DragEvent | RDragEvent) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !e.dataTransfer) return false;
  e.dataTransfer.setData(PASSAGE_TYPE, '1');
  e.dataTransfer.effectAllowed = 'copy';
  window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  return true;
}
