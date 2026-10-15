import type { CategoryId, NoteKind, RelationId } from './types';

export interface CategoryDef {
  id: CategoryId;
  label: string;
  /** Raccourci clavier quand une sélection est active. */
  key: string;
  cssVar: string;
  description: string;
}

/** Ordre canonique (celui de la méthode : problème → thèse → arguments…). */
export const CATEGORIES: CategoryDef[] = [
  { id: 'probleme', label: 'Problème', key: '1', cssVar: '--cat-probleme', description: 'La question que le texte affronte' },
  { id: 'these', label: 'Thèse', key: '2', cssVar: '--cat-these', description: 'Ce que l’auteur affirme' },
  { id: 'argument', label: 'Argument', key: '3', cssVar: '--cat-argument', description: 'Ce qui soutient la thèse' },
  { id: 'objection', label: 'Thèse adverse', key: '4', cssVar: '--cat-objection', description: 'Objection ou position que le texte discute' },
  { id: 'concept', label: 'Concept', key: '5', cssVar: '--cat-concept', description: 'Définition ou distinction' },
  { id: 'exemple', label: 'Exemple', key: '6', cssVar: '--cat-exemple', description: 'Illustration, cas concret' },
];

export const CATEGORY_BY_ID: Record<CategoryId, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryDef>;

/** Surlignage simple : ni catégorie ni note (Highlight.plain). */
export const PLAIN_DEF = {
  id: 'plain' as const,
  label: 'Surlignage',
  key: 'h',
  cssVar: '--cat-plain',
  description: 'Juste surligner, sans catégorie',
};

type CatLike = { category: CategoryId | null; plain?: boolean };
/** Un extrait sans catégorie est soit un surlignage simple, soit une note de marge. */
export const isPlain = (h: CatLike): boolean => h.category === null && h.plain === true;
/** Clé de classement : catégorie, 'plain' (surlignage) ou 'note' (note de marge). */
export type ExtractKind = CategoryId | 'plain' | 'note';
export const kindOf = (h: CatLike): ExtractKind => h.category ?? (h.plain ? 'plain' : 'note');
/** Libellé court : catégorie, « Surlignage » ou « Note de marge ». */
export const kindLabel = (h: CatLike): string => (h.category ? CATEGORY_BY_ID[h.category].label : h.plain ? PLAIN_DEF.label : 'Note de marge');
/** Variable CSS de couleur (pastille, filet) : catégorie, surlignage ou gris des notes. */
export const kindColor = (h: CatLike): string => (h.category ? `var(--cat-${h.category})` : h.plain ? 'var(--cat-plain)' : 'var(--muted)');
/** Classe CSS du surlignage dans le texte. */
export const hlClass = (h: CatLike): string => (h.category ? `hl-${h.category}` : h.plain ? 'hl-plain' : 'hl-note');

export const hlBg = (id: CategoryId) => `var(--hl-${id})`;
export const catColor = (id: CategoryId) => `var(--cat-${id})`;

export interface NoteKindDef {
  id: NoteKind;
  label: string;
  description: string;
}

/** Notes « ma voix » : séparées de ce que dit le texte. */
export const NOTE_KINDS: NoteKindDef[] = [
  { id: 'reformulation', label: 'Reformulation', description: 'Je redis l’idée avec mes mots' },
  { id: 'question', label: 'Question', description: 'Ce que je ne comprends pas encore' },
  { id: 'critique', label: 'Ma critique', description: 'Mon objection, ma réserve' },
  { id: 'presuppose', label: 'Présupposé', description: 'Ce que le texte admet sans le dire' },
];

export const NOTE_KIND_BY_ID: Record<NoteKind, NoteKindDef> = Object.fromEntries(
  NOTE_KINDS.map((n) => [n.id, n]),
) as Record<NoteKind, NoteKindDef>;

export interface RelationDef {
  id: RelationId;
  label: string;
  dashed: boolean;
  cssVar: string;
}

export const RELATIONS: RelationDef[] = [
  { id: 'soutient', label: 'soutient', dashed: false, cssVar: '--rel-soutient' },
  { id: 'objecte', label: 'objecte à', dashed: true, cssVar: '--rel-objecte' },
  { id: 'repond', label: 'répond à', dashed: false, cssVar: '--rel-repond' },
  { id: 'precise', label: 'précise', dashed: false, cssVar: '--rel-precise' },
  { id: 'illustre', label: 'illustre', dashed: true, cssVar: '--rel-illustre' },
];

export const RELATION_BY_ID: Record<RelationId, RelationDef> = Object.fromEntries(
  RELATIONS.map((r) => [r.id, r]),
) as Record<RelationId, RelationDef>;

/** Connecteurs logiques à mettre en évidence (minuscules, sans ponctuation). */
export const CONNECTORS = [
  'donc', 'ainsi', 'par conséquent', 'c’est pourquoi', "c'est pourquoi", 'en effet', 'car', 'puisque', 'parce que',
  'mais', 'or', 'cependant', 'pourtant', 'toutefois', 'néanmoins', 'au contraire', 'en revanche', 'certes',
  'd’abord', "d'abord", 'ensuite', 'enfin', 'de plus', 'en outre', 'd’ailleurs', "d'ailleurs", 'si bien que',
  'de sorte que', 'bien que', 'quoique', 'non seulement', 'c’est-à-dire', "c'est-à-dire", 'autrement dit', 'par exemple',
];
