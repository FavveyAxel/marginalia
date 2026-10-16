// ─────────────────────────────────────────────────────────────
// Marginalia — modèle de données v2 (FIGÉ : ne pas modifier sans l'intégrateur)
// ─────────────────────────────────────────────────────────────

export type BookFormat = 'epub' | 'pdf' | 'docx' | 'md' | 'txt' | 'html' | 'image';

/** Catégories de surlignage (ce que le passage FAIT dans le texte). */
export type CategoryId = 'probleme' | 'these' | 'argument' | 'objection' | 'concept' | 'exemple';

/** Type de note personnelle (« ma voix »), distincte des catégories du texte. */
export type NoteKind = 'reformulation' | 'question' | 'critique' | 'presuppose';

/** Relations de la carte d'argument. */
export type RelationId = 'soutient' | 'objecte' | 'precise' | 'illustre' | 'repond' | 'oppose' | 'rattache';

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
  /** `offset` (facultatif) : caractère à placer en haut à la réouverture (position venue de Livres). */
  | { kind: 'html'; chapter: number; scroll: number; offset?: number }
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
 * Provenance d'un extrait ou d'un signet synchronisé depuis une autre app (Livres d'Apple).
 * Les valeurs « telles que synchronisées » permettent de savoir ce que l'utilisateur a changé
 * dans Marginalia (catégorie, note, libellé) : ces changements ne sont jamais écrasés.
 */
export interface ExternalSource {
  app: 'livres';
  /** Identifiant de l'annotation dans Livres. */
  uuid: string;
  /** Date de modification dans Livres (ms) à la dernière synchro. */
  modified: number;
  /** Catégorie posée par la dernière synchro. */
  category?: CategoryId | null;
  /** Surlignage simple posé par la dernière synchro. */
  plain?: boolean;
  /** Note de Livres à la dernière synchro. */
  note?: string;
  /** Texte sélectionné dans Livres à la dernière synchro. */
  text?: string;
  /** Libellé posé par la dernière synchro (signets). */
  label?: string;
}

/** Couleurs de surlignage de Livres. */
export type AppleBooksColor = 'jaune' | 'vert' | 'bleu' | 'rose' | 'violet' | 'souligne';
/** Destination d'une couleur de Livres : une catégorie, une note de marge, ou rien (non importé). */
export type AppleBooksColorTarget = CategoryId | 'note' | 'plain' | 'skip';

/** Dernier résultat de synchro des annotations de Livres. */
export interface AppleBooksSyncReport {
  at: number;
  /** Totaux d'éléments liés à Livres après la synchro. */
  highlights: number;
  bookmarks: number;
  positions: number;
  /** Changements de cette synchro. */
  created: number;
  updated: number;
  removed: number;
  /** Passages introuvables (ignorés). */
  notFound: number;
  /** Message d'erreur (accès refusé…). */
  error?: string;
}

/** Teintes proposées pour un signet (null : teinte par défaut). */
export type BookmarkColor = 'rouge' | 'orange' | 'jaune' | 'vert' | 'bleu' | 'violet';

/**
 * Signet : un endroit d'un livre à retrouver rapidement.
 * `position` suffit pour y revenir ; `anchor` + `excerpt` (début du paragraphe, ~40 caractères)
 * gardent le retour exact quand la mise en page change (police, largeur, zoom).
 */
export interface Bookmark {
  id: string;
  bookId: string;
  position: ReaderPosition;
  /** Début du passage marqué (HTML : offsets dans le chapitre ; PDF : ligne de la page). */
  anchor?: Anchor;
  /** Premiers caractères du passage marqué. */
  excerpt?: string;
  /** Avancement dans le livre (0–1) : repère sur la barre de progression. */
  progress?: number;
  /** Chapitre / section ou page lisible (« Chapitre II », « p. 42 »). */
  locationLabel?: string;
  label: string;
  note?: string;
  color?: BookmarkColor | null;
  createdAt: number;
  /** Signet venu de Livres (synchro). */
  source?: ExternalSource;
}

/**
 * Annotation ancrée dans un texte.
 * - category non nulle : surlignage d'un passage selon sa fonction dans le texte ;
 * - category nulle et plain vrai : surlignage simple (aucune catégorie, aucune note) ;
 * - category nulle sinon : note de marge pure (« ma voix ») ancrée sur un passage.
 */
export interface Highlight {
  id: string;
  bookId: string;
  category: CategoryId | null;
  /**
   * Surlignage simple : sans catégorie ni note. Absent = note de marge (extraits existants).
   * Le store retire ce drapeau dès qu'une catégorie, une note ou un type de note est posé.
   */
  plain?: boolean;
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
  /** Extrait venu de Livres (synchro). */
  source?: ExternalSource;
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
  /** Carte repliée (affichage compact). Absent : dépliée. */
  collapsed?: boolean;
  /** Teinte d'une carte « idée » (variable CSS --cat-* / --rel-*). Absent : jaune post-it. */
  color?: string;
  /** Carte « concept » (cartes libres) : concept d'origine ; `text` en garde le nom et la définition. */
  conceptId?: string;
  /** Carte copiée depuis une autre carte : clé de la carte et id de la carte d'origine. */
  from?: { mapKey: string; nodeId: string };
  /**
   * Centre de la carte (facultatif) : 'question' = problématique (« Peut-on avoir le droit de mentir ? »),
   * 'subject' = sujet, thème à explorer (« Le mensonge »). Texte dans `text`. Absent : carte ordinaire.
   */
  kind?: 'question' | 'subject';
  /** Branche repliée (carte mentale) : ses descendantes sont masquées, pas supprimées. Voir model/fold.ts. */
  folded?: boolean;
  /** Portail : clé (dans `maps`) de la carte vers laquelle cette carte mène. Absent : carte ordinaire. */
  portal?: string;
}

/** Force d'un lien (1 faible, 2 normal, 3 fort). Absent : normal. */
export type EdgeStrength = 1 | 2 | 3;

/** Zone (cadre titré) qui regroupe des cartes. */
export interface MapZone {
  id: string;
  title: string;
  /** Nom de teinte (variable CSS --cat-* / --rel-*, ou couleur hex). */
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Zone repliée : ses cartes sont masquées (voir hiddenNodeIds). */
  collapsed?: boolean;
  /** Cartes masquées par le repli (ids). */
  hiddenNodeIds?: string[];
}

/** Instantané d'une carte (versions). Stocké hors du journal d'annulation. */
export interface MapVersion {
  id: string;
  /** Clé de la carte dans `maps`. */
  mapKey: string;
  createdAt: number;
  /** Nom donné par l'utilisateur (null : instantané automatique, élagué). */
  name: string | null;
  /** Raison d'un instantané automatique. */
  reason: 'manual' | 'layout' | 'convert' | 'delete-many' | 'restore';
  /** Copie de la carte (sans viewport). */
  map: ArgumentMap;
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
  /** Force du lien (absent : normale). */
  strength?: EdgeStrength;
  /** Note libre sur le lien (« pourquoi ce lien »). */
  note?: string;
}

/**
 * Carte d'argument. Rangées dans `Database.maps` :
 *  - carte d'un livre (historique) : clé = bookId, `kind` absent ou 'book' ;
 *  - carte libre multi-livres (« comparer deux auteurs ») : clé = `id`, kind 'board',
 *    `bookIds` = livres dont elle cite des extraits, `bookId` = '' ;
 *  - carte d'un mouvement de fiche-texte : clé = `id`, kind 'movement', `bookId` = livre,
 *    `studyId` + `movementId`.
 * Tous les nouveaux champs sont facultatifs : une base ancienne reste valable telle quelle.
 */
export interface ArgumentMap {
  bookId: string;
  nodes: MapNode[];
  edges: MapEdge[];
  viewport: { x: number; y: number; zoom: number } | null;
  /** Clé dans `maps` quand elle diffère de bookId (cartes libres, cartes de mouvement). */
  id?: string;
  kind?: 'book' | 'board' | 'movement';
  title?: string;
  bookIds?: string[];
  studyId?: string;
  movementId?: string;
  zones?: MapZone[];
  /** Carte marquée « thèse centrale » (absent : la première thèse posée). */
  centralId?: string;
  createdAt?: number;
  updatedAt?: number;
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

/**
 * Version enregistrée d'un écrit (instantané .docx).
 * kind : 'auto' (toutes les ~10 min d'écriture), 'close' (fermeture), 'restore' (avant une restauration),
 * 'replace' (avant « Tout remplacer »), 'manual' (« Créer une version… », toujours nommée).
 */
export interface DraftVersion {
  id: string;
  /** Chemin relatif au dossier de l'écrit (versions/<horodatage>-<id>.docx). */
  fileName: string;
  createdAt: number;
  /** Nom donné par l'utilisateur (null : version automatique, élaguée avec le temps). */
  name: string | null;
  kind: 'auto' | 'close' | 'restore' | 'replace' | 'manual';
  wordCount: number;
  /** Empreinte du texte (évite deux versions identiques à la suite). */
  hash?: string;
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
  /** Objectif de mots (facultatif, réglable depuis l'éditeur). */
  wordGoal?: number;
  template: 'vide' | 'dissertation' | 'explication' | 'fiche' | null;
  /** Historique de versions (copies .docx dans versions/ du dossier de l'écrit), du plus ancien au plus récent. */
  versions?: DraftVersion[];
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

/** Présentation du lecteur HTML (attribut data-layout de la racine du lecteur). */
export type ReaderLayout = 'scroll' | 'sheets' | 'paged';
/** Page par page : nombre de pages à l'écran. */
export type PagedSpread = 'single' | 'double' | 'auto';

/** Défauts des réglages de mise en page du lecteur (champs optionnels de Settings). */
export const READER_DISPLAY_DEFAULTS = {
  readerLayout: 'scroll' as ReaderLayout,
  pagedSpread: 'auto' as PagedSpread,
  bookLayout: false,
  paperLook: false,
};

export interface Settings {
  theme: ThemeId;
  fontSize: number;
  lineHeight: number;
  measure: number;
  fontFamily: 'serif' | 'sans';
  showToc: boolean;
  showExtracts: boolean;
  /** Contenu du panneau droit du lecteur. */
  rightPanel: 'extraits' | 'etude' | 'signets';
  /** Mettre en évidence les connecteurs logiques dans le texte. */
  showConnectors: boolean;
  /** Espace de travail actif (null = tous). */
  activeWorkspaceId: string | null;
  /** Nombre maximal de nouvelles cartes par jour et par livre (révision). */
  newCardsPerBook: number;
  /** Synchroniser automatiquement les EPUB/PDF sans DRM de l'app Livres (iCloud). */
  appleBooksSync?: boolean;
  /** Livres de l'app Livres déjà traités (importés ou écartés), par nom de fichier. */
  appleBooksSeen?: string[];
  /** Synchro des annotations de Livres (absent : suit appleBooksSync). */
  appleBooksAnnotations?: { highlights?: boolean; bookmarks?: boolean; position?: boolean };
  /** Couleur de Livres → catégorie (absent : correspondance par défaut). */
  appleBooksColorMap?: Partial<Record<AppleBooksColor, AppleBooksColorTarget>>;
  /** Annotations de Livres déjà importées (uuid) : une suppression dans Marginalia n'est pas défaite. */
  appleBooksKnown?: string[];
  /** Dernier résultat de synchro des annotations. */
  appleBooksLastSync?: AppleBooksSyncReport;
  /** Anciens .docx importés comme livres déjà convertis en écrits. */
  docxMigrated?: boolean;
  /** Barre latérale repliée en rail d'icônes. */
  sidebarCollapsed?: boolean;
  /**
   * Repères de page dans le texte (EPUB…) : trait et numéro, numéro seul (« number »), ou aucun.
   * Valeurs anciennes « paper » (pages façon papier de la 3.8) et « rule » (trait seul) : lues comme
   * « trait et numéro » en défilement continu ; les feuilles sont désormais readerLayout « sheets ».
   * Lecture résolue : readerDisplay() (features/reader/display.ts).
   */
  pageMarks?: 'paper' | 'numbered' | 'number' | 'rule' | 'off';
  // ── Panneau « Mise en page et affichage » (contrat commun ; défauts dans READER_DISPLAY_DEFAULTS) ──
  /** Présentation du texte : défilement continu (défaut), feuilles (pages façon papier), page par page. */
  readerLayout?: ReaderLayout;
  /** Page par page : une page, deux pages en vis-à-vis, ou selon la largeur (défaut). */
  pagedSpread?: PagedSpread;
  /** Mise en page livre (EPUB, DOCX, MD, TXT) : justifié, césure, alinéas sans blanc entre paragraphes,
   *  titres de livre (classe .book-layout sur la racine du lecteur, book-layout.css). Défaut : non. */
  bookLayout?: boolean;
  /** Aspect papier (classe .paper-look sur la racine du lecteur). Défaut : non. */
  paperLook?: boolean;
  /** Éditeur : marques de mise en forme (¶, espaces, police et style des paragraphes), affichage seulement. */
  showFormatMarks?: boolean;
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
  /** Signets (bases antérieures : absent, complété par un tableau vide au chargement). */
  bookmarks: Bookmark[];
  settings: Settings;
  /** Corbeille : éléments supprimés et tout ce qui a été retiré avec eux (30 jours). */
  trash: TrashEntry[];
  /** Journal d'activité, du plus récent au plus ancien (plafonné). */
  activity: ActivityEntry[];
  /** Instantanés des cartes d'argument (bases antérieures : absent). Hors du journal et de ⌘Z. */
  mapVersions?: MapVersion[];
}

// ── Corbeille, journal d'activité, annuler / rétablir ─────────

/** Collections suivies par le journal et l'annulation (`maps` est indexée par bookId). */
export type TrackedCollection = CollectionName | 'maps';

/**
 * Changement d'un élément d'une collection : état avant / après (null = absent).
 * `prevId` / `index` : position de l'élément avant le changement, pour le remettre à sa place.
 */
export interface ItemChange {
  col: TrackedCollection | 'trash';
  id: string;
  before: unknown;
  after: unknown;
  prevId?: string | null;
  index?: number;
}

/** 'map' : carte libre ou carte de mouvement (clé de `maps`) ; les cartes de livre partent avec leur livre. */
export type TrashKind = 'book' | 'highlight' | 'concept' | 'argument' | 'study' | 'plan' | 'draft' | 'card' | 'workspace' | 'group' | 'map';

export interface TrashEntry {
  id: string;
  kind: TrashKind;
  /** Id de l'élément supprimé. */
  refId: string;
  title: string;
  /** Ce qui a été retiré avec l'élément (« Avec 12 extraits et la carte d'argument »). */
  detail: string;
  /** Livre de rattachement éventuel (extrait, fiche-texte, carte de révision…). */
  bookId: string | null;
  deletedAt: number;
  /** Suppression d'un groupe : 'lift' (le contenu remonte) ou 'tree' (le contenu part avec lui). */
  mode?: 'lift' | 'tree';
  /** Tout ce que la suppression a retiré ou modifié, pour une restauration exacte. */
  changes: ItemChange[];
  /** Fichiers effacés du disque seulement au vidage ou à l'expiration. */
  files: { ownerId: string; fileName: string }[];
}

export type ActivityAction = 'create' | 'update' | 'delete' | 'restore' | 'import' | 'export' | 'revert' | 'purge';
export type ActivityKind = TrashKind | 'map' | 'wsItem' | 'bookmark' | 'file';

export interface ActivityEntry {
  id: string;
  /** Dernière modification regroupée dans l'entrée. */
  at: number;
  /** Première modification regroupée dans l'entrée. */
  startedAt: number;
  action: ActivityAction;
  kind: ActivityKind;
  /** Élément concerné (le premier si plusieurs). */
  refId: string | null;
  /** Éléments concernés quand l'entrée en regroupe plusieurs (« 3 extraits ajoutés »). */
  refIds?: string[];
  bookId: string | null;
  title: string;
  summary: string;
  /** Changements pour « Revenir à l'état d'avant » (absents si non réversible ou trop ancien). */
  changes?: ItemChange[];
  /** Entrée de corbeille créée par une suppression. */
  trashId?: string;
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
  | 'wsItems'
  | 'bookmarks';

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
  /** Carte libre (clé dans `maps`, kind 'board'). */
  | { name: 'board'; boardId: string }
  | { name: 'write'; draftId: string | null }
  /** Toutes les cartes (libres, de livres, de mouvements) et où elles sont rangées. */
  | { name: 'maps' }
  | { name: 'trash' }
  | { name: 'history' }
  | { name: 'help' }
  /** Réglages (confidentialité et sécurité). */
  | { name: 'settings' };
