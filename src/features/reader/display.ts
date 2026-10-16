// Réglages de mise en page du lecteur, résolus (défauts + anciennes valeurs).
// Une seule lecture pour le panneau « Mise en page et affichage » (TypographyPopover) et le
// lecteur HTML (racine : data-layout, .book-layout, .paper-look ; classe pg-* du document).
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
  /** Classe pg-* du document HTML : « paper » = rendu des feuilles (3.8), sinon le style des repères. */
  pgClass: 'paper' | PageMarkStyle;
}

export function readerDisplay(s: Settings): ReaderDisplay {
  // Ancien réglage « Pages façon papier » choisi explicitement (pageMarks: 'paper') : on garde les
  // feuilles tant que la présentation n'a pas été choisie dans le nouveau panneau.
  const layout: ReaderLayout = s.readerLayout ?? (s.pageMarks === 'paper' ? 'sheets' : READER_DISPLAY_DEFAULTS.readerLayout);
  const pm = s.pageMarks;
  const marks: PageMarkStyle = pm === 'off' ? 'off' : pm === 'number' ? 'number' : 'numbered';
  return {
    layout,
    spread: s.pagedSpread ?? READER_DISPLAY_DEFAULTS.pagedSpread,
    bookLayout: s.bookLayout ?? READER_DISPLAY_DEFAULTS.bookLayout,
    paperLook: s.paperLook ?? READER_DISPLAY_DEFAULTS.paperLook,
    marks,
    // Provisoire (contrat) : « Feuilles » = rendu « pages façon papier » existant ; « Page par page »
    // garde pour l'instant les repères du défilement (l'agent « paged » y branchera son rendu).
    pgClass: layout === 'sheets' ? 'paper' : marks,
  };
}
