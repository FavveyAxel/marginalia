// Personnalisation facultative de l'action « Citer » de la barre de sélection (SelectionToolbar).
// Le panneau « Livre à côté » de la carte d'argument s'en sert pour devenir « Sur la carte » :
// libellé et icône propres, bouton que l'on peut glisser jusqu'à la carte, et enregistrement de
// l'action tant que la barre est affichée (pour qu'un dépôt sur la carte puisse la déclencher).
import { createContext, type DragEvent, type ReactNode } from 'react';

export interface CiteAction {
  label: string;
  title: string;
  icon?: ReactNode;
  testId?: string;
  /** Bouton glissable : début du glisser (le type de données est posé ici). */
  onDragStart?(e: DragEvent<HTMLElement>): void;
  /** La barre enregistre son action « citer » tant qu'elle est affichée (null : retirée). */
  register?(cite: (() => void) | null): void;
}

export const CiteActionCtx = createContext<CiteAction | null>(null);
