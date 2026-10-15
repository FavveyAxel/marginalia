// Contexte partagé entre la vue de carte, ses nœuds et ses arêtes.
import { createContext, useContext } from 'react';
import type { EdgeStrength, Highlight, RelationId } from '../../../lib/types';

export const NODE_W = 280;
export const NODE_H = 190;
/** Largeur de la thèse centrale (un peu plus grande). */
export const CENTRAL_W = 320;

export interface MapUiCtx {
  editingId: string | null;
  setEditingId(id: string | null): void;
  setIdeaText(id: string, text: string): void;
  /** Fin de l'édition d'une idée par Tab : enregistre puis crée une carte « enfant ». */
  editTab(id: string, text: string): void;
  /** Bascule repliée / dépliée d'un extrait long (état mémorisé). */
  setCollapsed(id: string, collapsed: boolean): void;
  openEdge(id: string, x: number, y: number): void;
  hoverEdge(id: string | null): void;
  jump(highlightId: string): void;
  /** Clé de la carte affichée (portails, badge « aussi dans N cartes »). */
  mapKey?: string;
}
export const MapCtx = createContext<MapUiCtx | null>(null);
export const useMapCtx = () => useContext(MapCtx) as MapUiCtx;

export interface ExtractData extends Record<string, unknown> {
  highlight: Highlight | null;
  central: boolean;
  /** Valeur mémorisée (absent : repli automatique si le texte dépasse 3 lignes). */
  collapsed: boolean | undefined;
  /** Nom court du livre (cartes libres multi-livres) ; absent sur la carte d'un livre. */
  book?: string;
}
export interface IdeaData extends Record<string, unknown> {
  text: string;
  central: boolean;
  /** Variable CSS de teinte (absent : jaune post-it). */
  color: string | undefined;
}
export interface RelEdgeData extends Record<string, unknown> {
  relation: RelationId;
  strength: EdgeStrength;
  /** Sources des arêtes du même faisceau (vide si arête isolée). */
  groupSources: string[];
  lead: boolean;
  /** Survolé : le nom de la relation s'affiche au milieu du lien. */
  hover: boolean;
  /** Lien qui vient d'être créé : il se dessine progressivement. */
  fresh: boolean;
  /** « Pourquoi ? » : note du lien (affichée au survol, sous le nom de la relation). */
  note?: string;
}

/** L'utilisateur préfère moins d'animations. */
export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Teintes proposées pour les idées (post-it). `undefined` = jaune. */
export const IDEA_COLORS: { id: string | undefined; label: string }[] = [
  { id: undefined, label: 'Jaune' },
  { id: '--cat-probleme', label: 'Orange' },
  { id: '--cat-objection', label: 'Rose' },
  { id: '--cat-exemple', label: 'Violet' },
  { id: '--cat-concept', label: 'Bleu' },
  { id: '--cat-argument', label: 'Vert' },
];

/** Étiquette de rôle affichée en haut d'une carte. */
export function roleLabel(h: { category: string | null; plain?: boolean } | null): string {
  if (!h) return 'Idée';
  switch (h.category) {
    case 'these':
      return 'Thèse';
    case 'argument':
      return 'Argument';
    case 'probleme':
      return 'Problème';
    case 'objection':
      return 'Thèse adverse';
    case 'concept':
      return 'Concept';
    case 'exemple':
      return 'Exemple';
    default:
      return h.plain ? 'Surlignage' : 'Note';
  }
}
