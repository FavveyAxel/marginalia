// ─────────────────────────────────────────────────────────────
// Contrat commun des moteurs de lecture v2 (FIGÉ).
// HtmlReader (EPUB/DOCX/MD/TXT/HTML) et PdfReader l'implémentent.
// ─────────────────────────────────────────────────────────────
import type { Anchor, Book, CategoryId, Highlight, Movement, ReaderPosition, Settings, TocItem } from '../../lib/types';

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
  /** « Début de mouvement » choisi dans la barre de sélection. */
  onCreateMovement(input: NewMovementInput): void;
  onHighlightClick(id: string, rect: DOMRect): void;
  /** Clic sur un repère de mouvement dans la marge. */
  onMovementClick(id: string): void;
  onBackgroundClick(): void;
  onReady(): void;
  onError(message: string): void;
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
}
