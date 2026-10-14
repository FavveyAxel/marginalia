// ─────────────────────────────────────────────────────────────
// Marginalia — modèle de données v2 (FIGÉ : ne pas modifier sans l'intégrateur)
// ─────────────────────────────────────────────────────────────

export type BookFormat = 'epub' | 'pdf' | 'docx' | 'md' | 'txt' | 'html';

/** Catégories de surlignage (ce que le passage FAIT dans le texte). */
export type CategoryId = 'probleme' | 'these' | 'argument' | 'objection' | 'concept' | 'exemple';

/** Type de note personnelle (« ma voix »), distincte des catégories du texte. */
export type NoteKind = 'reformulation' | 'question' | 'critique' | 'presuppose';

/** Relations de la carte d'argument. */
export type RelationId = 'soutient' | 'objecte' | 'precise' | 'illustre' | 'repond';

/** Édition de référence d'un document (pour les citations). */
export interface Edition {
  /** Éditeur (ex. « GF Flammarion »). */
  publisher: string;
  /** Année de l'édition utilisée. */
  year: string;
  /** Traducteur, s'il y a lieu. */
  translator: string;
  /** Lieu d'édition (facultatif). */
  place: string;
  /**
   * PDF : décalage entre numéro de page du fichier et page imprimée
   * (page imprimée = page PDF + pageOffset). 0 par défaut.
   */
  pageOffset: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  /** Nom du fichier stocké dans la bibliothèque de l'app (ex. « source.epub »). */
  fileName: string;
  /** Nom d'origine du fichier importé. */
  originalName: string;
  size: number;
  addedAt: number;
  lastOpenedAt: number | null;
  progress: number;
  position: ReaderPosition | null;
  cover: string | null;
  edition: Edition;
}

export type ReaderPosition =
  | { kind: 'html'; chapter: number; scroll: number }
  | { kind: 'pdf'; page: number; offset: number };

/**
 * Ancrage HTML (EPUB, DOCX, MD, TXT, HTML) : offsets de caractères dans le textContent
 * du conteneur de chapitre + 32 caractères de contexte pour ré-ancrer.
 */
export interface HtmlAnchor {
  kind: 'html';
  chapter: number;
  start: number;
  end: number;
  prefix: string;
  suffix: string;
}

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfAnchor {
  kind: 'pdf';
  /** Page du fichier, 1-indexée. */
  page: number;
  rects: NormRect[];
}

export type Anchor = HtmlAnchor | PdfAnchor;

/**
 * Annotation ancrée dans un texte.
 * - category non nulle : surlignage d'un passage selon sa fonction dans le texte ;
 * - category nulle : note de marge pure (« ma voix ») ancrée sur un passage.
 */
export interface Highlight {
  id: string;
  bookId: string;
  category: CategoryId | null;
  text: string;
  /** Note personnelle. */
  note: string;
  /** Type de la note personnelle (null = note simple). */
  noteKind: NoteKind | null;
  conceptIds: string[];
  anchor: Anchor;
  /** Libellé de localisation lisible : « Seconde partie » ou « p. 42 ». */
  locationLabel: string;
  /**
   * Page imprimée de l'édition de référence (texte libre, ex. « 42 » ou « 42-43 »).
   * Proposée automatiquement (page-list EPUB, page PDF + décalage), corrigeable.
   */
  printedPage: string;
  createdAt: number;
  updatedAt: number;
}

/** Un sens d'un concept, propre à un auteur / un livre. */
export interface ConceptSense {
  id: string;
  /** Auteur (texte libre) — ex. « Spinoza ». */
  author: string;
  bookId: string | null;
  definition: string;
  highlightIds: string[];
}

/** Distinction ou opposition entre deux concepts (ex. légal / légitime). */
export interface ConceptLink {
  conceptId: string;
  kind: 'distingue' | 'oppose' | 'proche';
  note: string;
}

export interface Concept {
  id: string;
  name: string;
  /** Synthèse personnelle générale. */
  definition: string;
  senses: ConceptSense[];
  links: ConceptLink[];
  /** Notion ou repère du programme de terminale. */
  programme: 'notion' | 'repere' | null;
  createdAt: number;
  updatedAt: number;
}

export interface MapNode {
  id: string;
  highlightId: string | null;
  text: string;
  x: number;
  y: number;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  relation: RelationId;
  /**
   * Co-prémisses : les arêtes qui partagent la même cible et le même groupId
   * forment un argument conjoint (prémisses qui ne valent qu'ensemble).
   */
  groupId: string | null;
}

export interface ArgumentMap {
  bookId: string;
  nodes: MapNode[];
  edges: MapEdge[];
  viewport: { x: number; y: number; zoom: number } | null;
}

/** Reconstruction d'argument en forme standard : P1, P2… ⇒ C. */
export interface ArgumentStep {
  id: string;
  text: string;
  /** Extrait source éventuel. */
  highlightId: string | null;
  /** Prémisse implicite (reconstruite, absente du texte). */
  implicit: boolean;
}

export interface ArgumentReconstruction {
  id: string;
  title: string;
  bookId: string | null;
  premises: ArgumentStep[];
  conclusion: ArgumentStep;
  /** Commentaire : validité, prémisse contestable, objection… */
  comment: string;
  createdAt: number;
  updatedAt: number;
}

/** Mouvement d'un texte étudié (explication de texte). */
export interface Movement {
  id: string;
  /** Début du mouvement dans le texte. */
  anchor: Anchor;
  /** Premiers mots du mouvement (aperçu). */
  startText: string;
  title: string;
  /** Rôle du mouvement dans l'argumentation (ex. « pose la thèse », « répond à l'objection »). */
  role: string;
}

/** Fiche-texte (explication) : problème, thèse, enjeu, mouvements. */
export interface TextStudy {
  id: string;
  bookId: string;
  /** Intitulé du passage étudié (ex. « Quatrième partie, le cogito »). */
  title: string;
  probleme: string;
  these: string;
  enjeu: string;
  movements: Movement[];
  createdAt: number;
  updatedAt: number;
}

/** Élément déposé dans un plan de dissertation. */
export type PlanItemRef =
  | { kind: 'highlight'; id: string }
  | { kind: 'concept'; id: string }
  | { kind: 'argument'; id: string }
  | { kind: 'text'; text: string };

export interface PlanNode {
  id: string;
  title: string;
  /** Idée directrice / phrase de transition. */
  note: string;
  items: { id: string; ref: PlanItemRef }[];
  children: PlanNode[];
}

/** Plan de dissertation. */
export interface EssayPlan {
  id: string;
  title: string;
  sujet: string;
  /** Définition des termes du sujet. */
  definitions: string;
  problematique: string;
  parts: PlanNode[];
  conclusion: string;
  /** Brouillon (Draft) généré depuis ce plan, le cas échéant. */
  draftId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Document écrit dans l'éditeur (.docx natif). */
export interface Draft {
  id: string;
  title: string;
  /** Fichier .docx dans la bibliothèque de l'app (drafts/<id>/document.docx). */
  fileName: string;
  /** Chemin d'origine sur le disque si ouvert depuis un .docx externe (Enregistrer y réécrit). */
  externalPath: string | null;
  wordCount: number;
  template: 'vide' | 'dissertation' | 'explication' | 'fiche' | null;
  createdAt: number;
  updatedAt: number;
}

/** Carte de révision (répétition espacée FSRS). */
export interface ReviewCard {
  id: string;
  kind: 'definition' | 'these' | 'trous' | 'citation' | 'libre';
  front: string;
  back: string;
  highlightId: string | null;
  conceptId: string | null;
  bookId: string | null;
  suspended: boolean;
  /** État FSRS (sérialisé depuis ts-fsrs, dates en ms). */
  fsrs: {
    due: number;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    scheduled_days: number;
    learning_steps: number;
    reps: number;
    lapses: number;
    state: number;
    last_review: number | null;
  };
  createdAt: number;
}

/** Espace de travail : regroupe des éléments dans des groupes et sous-groupes. */
export interface Workspace {
  id: string;
  name: string;
  /** Teinte (nom d'une variable --cat-* ou --rel-*) pour la pastille. */
  tint: string;
  order: number;
  createdAt: number;
}

export interface WorkspaceGroup {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  order: number;
  collapsed: boolean;
}

export type WorkspaceItemKind = 'book' | 'draft' | 'plan' | 'argument' | 'study' | 'map';

/** Référence d'un élément dans un espace (un livre peut figurer dans plusieurs espaces). */
export interface WorkspaceItem {
  id: string;
  workspaceId: string;
  groupId: string | null;
  kind: WorkspaceItemKind;
  /** Id de l'élément (bookId, draftId, planId, argumentId, studyId ; pour 'map' : bookId). */
  refId: string;
  order: number;
}

export type ThemeId = 'system' | 'light' | 'sepia' | 'dark';

export interface Settings {
  theme: ThemeId;
  fontSize: number;
  lineHeight: number;
  measure: number;
  fontFamily: 'serif' | 'sans';
  showToc: boolean;
  showExtracts: boolean;
  /** Contenu du panneau droit du lecteur. */
  rightPanel: 'extraits' | 'etude';
  /** Mettre en évidence les connecteurs logiques dans le texte. */
  showConnectors: boolean;
  /** Espace de travail actif (null = tous). */
  activeWorkspaceId: string | null;
  /** Nombre maximal de nouvelles cartes par jour et par livre (révision). */
  newCardsPerBook: number;
}

export interface Database {
  version: 2;
  books: Book[];
  highlights: Highlight[];
  concepts: Concept[];
  maps: Record<string, ArgumentMap>;
  arguments: ArgumentReconstruction[];
  studies: TextStudy[];
  plans: EssayPlan[];
  drafts: Draft[];
  cards: ReviewCard[];
  workspaces: Workspace[];
  groups: WorkspaceGroup[];
  wsItems: WorkspaceItem[];
  settings: Settings;
}

/** Collections gérées par les actions génériques du store. */
export type CollectionName =
  | 'books'
  | 'highlights'
  | 'concepts'
  | 'arguments'
  | 'studies'
  | 'plans'
  | 'drafts'
  | 'cards'
  | 'workspaces'
  | 'groups'
  | 'wsItems';

export interface TocItem {
  id: string;
  label: string;
  depth: number;
  target: { kind: 'html'; chapter: number; fragment?: string } | { kind: 'pdf'; page: number };
}

/** Vue de premier niveau. */
export type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'workspace'; workspaceId: string; groupId: string | null }
  | {
      name: 'reader';
      bookId: string;
      tab: 'lecture' | 'carte';
      /** Second document affiché côte à côte (lecture). */
      splitBookId: string | null;
    }
  | { name: 'concepts'; conceptId: string | null }
  | { name: 'extracts' }
  | { name: 'arguments'; argumentId: string | null }
  | { name: 'revision' }
  | { name: 'plans'; planId: string | null }
  | { name: 'write'; draftId: string | null };
