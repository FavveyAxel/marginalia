// Réglages de mise en page du lecteur, résolus (défauts + anciennes valeurs).
// Source unique de vérité : le panneau « Mise en page et affichage » (TypographyPopover) et le
// lecteur HTML (racine : data-layout, data-spread, data-page-marks, .book-layout, .paper-look ;
// classe pg-* du document) lisent tous deux readerDisplay().
import { READER_DISPLAY_DEFAULTS, type PagedSpread, type ReaderLayout, type Settings } from '../../lib/types';

/** Façon de marquer les pages dans le texte (hors feuilles) : trait et numéro, numéro seul, aucun. */
export type PageMarkStyle = 'numbered' | 'number' | 'off';

export interface ReaderDisplay {
  layout: ReaderLayout;
  spread: PagedSpread;
  bookLayout: boolean;
  paperLook: boolean;
  /** Repères de page demandés (indépendamment de la présentation). */
  marks: PageMarkStyle;
  /**
   * Classe pg-* du document HTML : « paper » = rendu des feuilles, « paged » = page par page
   * (folio en bas de chaque page), sinon le style des repères du défilement continu.
   */
  pgClass: 'paper' | 'paged' | PageMarkStyle;
}

export function readerDisplay(s: Settings): ReaderDisplay {
  // Défilement continu par défaut, y compris pour qui avait l'ancien réglage « Pages façon papier »
  // (pageMarks 'paper', 3.8) : tant qu'aucune présentation n'est choisie dans le panneau, on lit
  // le texte d'un seul tenant avec « trait et numéro ». Les feuilles = readerLayout 'sheets' seulement.
  const layout: ReaderLayout = s.readerLayout ?? READER_DISPLAY_DEFAULTS.readerLayout;
  const pm = s.pageMarks;
  // Anciennes valeurs : 'paper' et 'rule' (trait seul) se lisent « trait et numéro ».
  const marks: PageMarkStyle = pm === 'off' ? 'off' : pm === 'number' ? 'number' : 'numbered';
  return {
    layout,
    spread: s.pagedSpread ?? READER_DISPLAY_DEFAULTS.pagedSpread,
    bookLayout: s.bookLayout ?? READER_DISPLAY_DEFAULTS.bookLayout,
    paperLook: s.paperLook ?? READER_DISPLAY_DEFAULTS.paperLook,
    marks,
    pgClass: layout === 'sheets' ? 'paper' : marks,
  };
}
