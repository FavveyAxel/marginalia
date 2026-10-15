// ─────────────────────────────────────────────────────────────
// Contrat commun des moteurs de lecture v2 (FIGÉ).
// HtmlReader (EPUB/DOCX/MD/TXT/HTML) et PdfReader l'implémentent.
// ─────────────────────────────────────────────────────────────
import type { Anchor, Book, Bookmark, CategoryId, Highlight, Movement, ReaderPosition, Settings, TocItem } from '../../lib/types';
import type { PageRequest, PageStatus } from './pages';

export interface SearchHit {
  id: string;
  snippet: string;
  matchStart: number;
  matchLength: number;
  locationLabel: string;
  payload: unknown;
}

export interface NewHighlightInput {
  anchor: Anchor;
  text: string;
  locationLabel: string;
  /** null = note de marge pure (« ma voix »). */
  category: CategoryId | null;
  /** Surlignage simple (sans catégorie ni note) : category vaut null. */
  plain?: boolean;
  /**
   * Page imprimée proposée : PDF → String(page + book.edition.pageOffset) ;
   * EPUB avec page-list → numéro de la page en cours ; sinon ''.
   */
  printedPage: string;
}

export interface NewMovementInput {
  anchor: Anchor;
  /** Premiers mots du passage sélectionné (≤ 80 car.). */
  text: string;
  locationLabel: string;
}

/** Endroit à marquer d'un signet, proposé par le moteur (haut de la fenêtre, sélection, clic droit). */
export interface BookmarkPoint {
  position: ReaderPosition;
  anchor?: Anchor;
  /** Premiers caractères du passage (≈ 40). */
  excerpt: string;
  progress: number;
  /** Chapitre / section ou page (« Chapitre II », « p. 42 »). */
  locationLabel: string;
  /** Libellé proposé : « Section — début de la phrase… » ou « Page 42 ». */
  label: string;
}

export interface EngineProps {
  book: Book;
  data: ArrayBuffer;
  highlights: Highlight[];
  /** Débuts de mouvements à signaler dans la marge (fiches-texte du livre). */
  movements: Movement[];
  activeHighlightId: string | null;
  settings: Settings;
  initialPosition: ReaderPosition | null;
  onToc(items: TocItem[]): void;
  onPosition(pos: ReaderPosition, progress: number, locationLabel: string): void;
  /** Création depuis la barre de sélection. `withNote` : ouvrir l'éditeur de note. */
  onCreateHighlight(input: NewHighlightInput, withNote: boolean): Highlight;
  /**
   * Facultatif : « Citer dans l'écrit » (lecteur ouvert dans le panneau de l'éditeur).
   * Absent : la barre de sélection n'affiche pas l'action. `input.category` vaut null.
   */
  onCite?(input: NewHighlightInput): void;
  /** « Début de mouvement » choisi dans la barre de sélection. */
  onCreateMovement(input: NewMovementInput): void;
  onHighlightClick(id: string, rect: DOMRect): void;
  /** Clic sur un repère de mouvement dans la marge. */
  onMovementClick(id: string): void;
  onBackgroundClick(): void;
  onReady(): void;
  onError(message: string): void;
  /** Signets du livre : repères discrets dans la marge (HTML) ou sur la page (PDF). */
  bookmarks?: Bookmark[];
  /** Clic sur le repère d'un signet. */
  onBookmarkClick?(id: string, rect: DOMRect): void;
  /** « Ajouter un signet ici » (barre de sélection, clic droit). */
  onAddBookmark?(point: BookmarkPoint, rect: DOMRect | null): void;
  /** Page en cours (« p. 12 / 240 ») ; null si le document n'a pas de pages repérées. */
  onPage?(status: PageStatus | null): void;
  /** « Aller à la page » demandé (⌘⌥G, ⌘K) : le PDF ouvre le champ de sa barre de zoom ou y va. */
  pageRequest?: PageRequest;
}

export interface EngineHandle {
  goTo(target: TocItem['target']): void;
  goToHighlight(h: Highlight): void;
  /** Aller au début d'un mouvement. */
  goToAnchor(anchor: Anchor): void;
  getHighlightRect(id: string): DOMRect | null;
  search(query: string): Promise<SearchHit[]>;
  goToSearchHit(hit: SearchHit): void;
  clearSearch(): void;
  /** Endroit lu (haut de la fenêtre), pour un nouveau signet. Absent : signets non pris en charge. */
  bookmarkPoint?(): BookmarkPoint | null;
  /** Retour exact au signet (défilement + bref surlignage du paragraphe). */
  goToBookmark?(b: Bookmark): void;
  /** Signet situé à l'endroit lu (haut de la fenêtre), s'il y en a un. */
  bookmarkAtView?(list: Bookmark[]): string | null;
  /** Rectangle du repère d'un signet à l'écran (pour y ancrer le popover). */
  getBookmarkRect?(id: string): DOMRect | null;
  /** « Aller à la page » (libellé imprimé, romain, ou page estimée) : null si fait, sinon le message d'erreur. */
  goToPage?(query: string): string | null;
  /** Page en cours, à la demande. */
  pageStatus?(): PageStatus | null;
}
