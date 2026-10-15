// ─────────────────────────────────────────────────────────────
// DocEngine : seule frontière avec SuperDoc 1.47.2 (AGPL-3.0, branche legacy).
// Remplacer le moteur (ex. eigenpal) ne doit toucher que ce fichier.
//
// Chargement : la build ES de `superdoc` importe `yjs` et `@hocuspocus/provider`
// (dépendances pairs non installées : .npmrc legacy-peer-deps), ce qui casse Vite.
// On charge donc la build autonome IIFE `superdoc.min.js` (copiée telle quelle comme
// asset par Vite via `?url`) dans une balise <script>, à la demande.
// G4 : télémétrie coupée, aucune police distante, aucun service de correction.
//
// Commandes utilisées : voir research/9 (chaque appel y est vérifié : XML écrit, relu).
// Tout export passe par `normalizeDocx` (ooxml.ts) : espaces de noms, ordre du schéma…
// Les opérations que SuperDoc n'annule pas (mise en page, modification d'un style) prennent
// un instantané : `restore(snapshot)` rouvre la version précédente.
// ─────────────────────────────────────────────────────────────
import superdocUrl from '../../../node_modules/superdoc/dist/superdoc.min.js?url';
// CSS du moteur : chargé seulement avec ce module (chunk paresseux), dans `@layer superdoc`
// (priorité inférieure aux styles de l'app) ; il ne déclare que des classes préfixées et
// des variables --sd-* (vérifié).
import 'superdoc/style.layered.css';
import { countWords } from './docx';
import {
  defaultParagraphStyle,
  effectiveStyleProps,
  ensureStylesXml,
  normalizeDocx,
  patchStylesXml,
  readStylesXml,
  replaceThemeFonts,
  styleDefinition,
  transformStyles,
  type StylePatch,
} from './ooxml';
import { familyName } from './fonts';
import { PRIVATE_STYLE_DEF, PRIVATE_STYLE_ID, VIEW_META, inPrivateNote, privateParagraphs, setNotesHidden, stripClipboard, textblocksOf, togglePrivateNote } from './privateNotes';
import { moveSection as moveSectionOp, stepSection, type LevelOf } from './outlineMove';
import { FIT_MAX, FIT_MIN, ZOOM_MAX, ZOOM_MIN, readZoomPref, type ZoomPref } from './view';

export type ParaStyle = 'title' | 'h1' | 'h2' | 'h3' | 'body' | 'quote' | 'caption';
export type MarkName = 'bold' | 'italic' | 'underline' | 'strike' | 'superscript' | 'subscript' | 'smallCaps';
export type Align = 'left' | 'center' | 'right' | 'justify';
export type PageNumbers = 'none' | 'n' | 'n-of-total';
export type TableOp = 'rowBefore' | 'rowAfter' | 'colBefore' | 'colAfter' | 'deleteRow' | 'deleteCol' | 'merge' | 'split' | 'headerRow' | 'deleteTable';

export interface OutlineItem {
  level: 1 | 2 | 3;
  text: string;
  pos: number;
}

export interface EngineState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  smallCaps: boolean;
  /** Police du texte sélectionné (famille), null si inconnue. */
  fontFamily: string | null;
  /** Taille en points. */
  fontSize: number | null;
  color: string | null;
  highlight: string | null;
  align: Align;
  /** Interligne multiple (1,5…), null si exact / inconnu. */
  lineHeight: number | null;
  /** Espacements avant / après (twips). */
  spaceBefore: number;
  spaceAfter: number;
  /** Retraits (twips). */
  indentLeft: number;
  firstLine: number;
  style: ParaStyle | 'other';
  styleId: string | null;
  list: 'bullet' | 'ordered' | null;
  listLevel: number;
  inTable: boolean;
  link: string | null;
  /** Sélection vide (curseur). */
  empty: boolean;
  /** Position du curseur (pour surligner le titre courant du plan). */
  pos: number;
}

export interface EngineStats {
  words: number;
  chars: number;
  charsNoSpaces: number;
}

export interface PageSetup {
  /** Dimensions en cm (orientées). */
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
  /** Marges en cm. */
  margins: { top: number; right: number; bottom: number; left: number };
  titlePage: boolean;
  pageNumbers: PageNumbers;
}

export interface DocEngine {
  /** Exporte le document courant en .docx (OOXML natif, normalisé). */
  exportDocx(): Promise<ArrayBuffer>;
  /** Texte brut du corps, paragraphes séparés par des sauts de ligne (secours, G2). */
  plainText(opts?: { privateNotes?: boolean }): string;
  wordCount(): number;
  stats(): EngineStats;
  outline(): OutlineItem[];
  state(): EngineState;
  // ── Caractères ──
  toggleMark(m: MarkName): void;
  setFontFamily(family: string): void;
  /** Taille en points. */
  setFontSize(pt: number): void;
  /** Taille suivante / précédente de l'échelle usuelle. */
  stepFontSize(dir: 1 | -1): void;
  setColor(hex: string | null): void;
  setHighlight(hex: string | null): void;
  /** Efface la mise en forme des caractères (le style de paragraphe est conservé). */
  clearInlineFormatting(): void;
  // ── Paragraphes ──
  setParagraphStyle(s: ParaStyle): Promise<void>;
  setAlign(a: Align): void;
  setLineHeight(v: number): void;
  /** Espacements avant / après (twips). */
  setParagraphSpacing(v: { before?: number; after?: number }): void;
  /** Retraits (twips). */
  setIndent(v: { left?: number; firstLine?: number }): void;
  changeIndent(dir: 1 | -1): void;
  toggleList(kind: 'bullet' | 'ordered'): void;
  /** Liste numérotée hiérarchique 1. / 1.1. / 1.1.1. */
  outlineList(): void;
  listLevel(dir: 1 | -1): boolean;
  // ── Styles ──
  /** Propriétés effectives d'un style (préremplissage du dialogue). */
  styleProps(s: ParaStyle): StylePatch;
  /** Modifie un style pour tout le document (export → styles.xml → réouverture). Renvoie l'instantané précédent. */
  modifyStyle(s: ParaStyle, patch: StylePatch): Promise<ArrayBuffer>;
  // ── Insertion ──
  insertFootnote(): boolean;
  /** Insère `quote` en paragraphe de style Citation suivi d'une note portant `note`. */
  insertCitation(quote: string, note: string): boolean;
  insertText(text: string): void;
  insertPageBreak(): void;
  insertTable(rows: number, cols: number): boolean;
  tableOp(op: TableOp): boolean;
  /** Image en ligne (data URI) ; largeur ramenée à celle du texte. */
  insertImage(src: string, width: number, height: number, alt: string): boolean;
  setLink(href: string, text?: string): boolean;
  unsetLink(): void;
  /** Table des matières avant le paragraphe du curseur (numéros de page calculés ensuite). */
  insertToc(): Promise<boolean>;
  /** Met à jour les tables des matières (entrées puis numéros de page) ; renvoie leur nombre. */
  updateToc(): Promise<number>;
  tocCount(): number;
  // ── Mise en page (non annulable par ⌘Z : instantané renvoyé) ──
  pageSetup(): PageSetup;
  setPageSize(size: { width: number; height: number }): Promise<ArrayBuffer>;
  setOrientation(o: 'portrait' | 'landscape'): Promise<ArrayBuffer>;
  setMargins(m: { top: number; right: number; bottom: number; left: number }): Promise<ArrayBuffer>;
  setPageNumbers(mode: PageNumbers): Promise<ArrayBuffer>;
  setTitlePage(on: boolean): Promise<ArrayBuffer>;
  /** Présentation universitaire (styles, marges, numéros, page de garde) ; renvoie l'instantané d'avant. */
  applyAcademicLayout(): Promise<ArrayBuffer>;
  /** Rouvre un instantané (annulation d'une opération non annulable). */
  restore(snapshot: ArrayBuffer): Promise<void>;
  // ── Vue ──
  zoom(): number;
  setZoom(z: number | 'fit'): void;
  /** Rectangle (coordonnées écran) de la sélection, pour la barre flottante. */
  selectionRect(): DOMRect | null;
  /** Mode concentration (focus.tsx) : positions du ou des blocs de premier niveau qui contiennent la sélection. */
  caretBlockRange(): { from: number; to: number } | null;
  /** Mode concentration (focus.tsx) : rectangle (coordonnées écran) du curseur, ou null. */
  caretCoords(): { top: number; bottom: number } | null;
  /** Insère des paragraphes de corps (texte brut) à la fin du document — tests et outils. */
  appendParagraph(text: string): void;
  undo(): void;
  redo(): void;
  goTo(pos: number): void;
  /** Lecture seule (garde-fou G2 à l'ouverture). */
  setEditable(on: boolean): void;
  focus(): void;
  destroy(): void;
  /** Développement / tests uniquement : éditeur brut du moteur. */
  debugEditor(): unknown;
  // ── Notes privées (privateNotes.ts) et plan déplaçable (outlineMove.ts) ──
  /** Insère une note privée, transforme la sélection en note, ou repasse la note du curseur en texte. */
  togglePrivateNote(): Promise<'inserted' | 'converted' | 'reverted' | null>;
  inPrivateNote(): boolean;
  privateNoteCount(): number;
  /** Masque / affiche les notes privées (affichage seulement : pas une modification de l'écrit). */
  setPrivateNotesHidden(hidden: boolean): void;
  /** Évènement `copy` : retire les notes privées des données copiées. */
  stripCopy(ev: ClipboardEvent): boolean;
  /** Déplace la section dont le titre est en `from` vers `target` (début du titre visé, ou fin). Une étape d'annulation. */
  moveSection(from: number, target: number): boolean;
  /** Monte / descend la section (titre en `pos`, ou celle du curseur) d'un rang parmi ses sœurs. */
  stepSection(dir: -1 | 1, pos?: number): boolean;
  /** Fin de document (cible « après le dernier titre »). */
  docEnd(): number;
  /** Correcteur orthographique (config `proofing` de SuperDoc, voir spell/) ; null le coupe. Réappliqué après réouverture. */
  setProofing(cfg: object | null): void;
  /** Éditeur de présentation de SuperDoc (correcteur : hitTest, proofingManager, editor). */
  presentation(): unknown;
  // ── Commentaires Word (comments.tsx) : w:comments, conservés à l'export .docx ──
  /** Fils ancrés dans le corps (racines puis réponses), dans l'ordre du document. */
  listComments(): DocComment[];
  /** Passage sélectionné (positions et texte), ou null si la sélection est vide. */
  selectionRange(): { from: number; to: number; quote: string } | null;
  /** Commente le passage [from, to] ; renvoie l'identifiant du commentaire. */
  addComment(range: { from: number; to: number }, text: string): string | null;
  replyComment(parentId: string, text: string): string | null;
  editComment(id: string, text: string): boolean;
  setCommentResolved(id: string, resolved: boolean): boolean;
  /** Supprime le fil (racine et réponses) ; renvoie de quoi l'annuler. */
  deleteComment(id: string): CommentSnapshot | null;
  restoreComment(snap: CommentSnapshot): boolean;
  /** Rectangles (coordonnées de la fenêtre) du passage [from, to], d'après la mise en page. */
  rangeRects(from: number, to: number): { left: number; top: number; right: number; bottom: number }[];
  /** Place le curseur dans le passage (sans défiler). */
  caretTo(pos: number): void;
}

/** Commentaire Word (w:comment) : racine d'un fil (passage commenté) ou réponse. */
export interface DocComment {
  id: string;
  /** Racine du fil (null pour une racine). */
  parentId: string | null;
  text: string;
  author: string;
  /** Écrit dans Marginalia (auteur affiché « Vous »). */
  mine: boolean;
  createdAt: number | null;
  resolved: boolean;
  /** Passage commenté (positions du document ; celles de la racine pour une réponse). */
  from: number;
  to: number;
  quote: string;
}

/** De quoi remettre un fil supprimé (« Annuler »). */
export interface CommentSnapshot {
  id: string;
  from: number;
  to: number;
  quote: string;
  resolved: boolean;
  /** Réponse seule (le passage reste commenté par la racine). */
  reply: boolean;
  /** Entrées du moteur (racine et réponses), copiées telles quelles. */
  entries: unknown[];
}

export interface EngineOptions {
  /** Le contenu a changé (corps ou note). */
  onChange?: () => void;
  /** Sélection / mise en forme courante changée. */
  onSelection?: () => void;
  /** Le document vient d'être rouvert (modification de style, annulation de mise en page). */
  onReload?: () => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

let loading: Promise<Any> | null = null;
// Fuite de SuperDoc : son peintre (DomPainter) pose sur window des écouteurs scroll/resize
// (`() => this.updateVirtualWindow()`) qu'il ne retire pas quand le document est détruit. Chaque
// ouverture d'écrit gardait ainsi en mémoire tout l'éditeur précédent (DOM des pages compris).
// On repère ces écouteurs à leur source et on les retire à la destruction du moteur.
const painterListeners = new Set<[string, EventListenerOrEventListenerObject]>();
let liveEngines = 0;
let listenerTrackerInstalled = false;
function installListenerTracker() {
  if (listenerTrackerInstalled) return;
  listenerTrackerInstalled = true;
  const add = window.addEventListener as (this: Window, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => void;
  window.addEventListener = function (this: Window, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (listener && (type === 'scroll' || type === 'resize') && typeof listener === 'function' && Function.prototype.toString.call(listener).includes('updateVirtualWindow'))
      painterListeners.add([type, listener]);
    return add.call(this, type, listener, options);
  } as typeof window.addEventListener;
}
/** Retire les écouteurs de peintre restants (seulement si aucun autre moteur n'est ouvert). */
function releasePainterListeners() {
  if (liveEngines > 1) return;
  for (const [type, l] of painterListeners) window.removeEventListener(type as 'scroll', l);
  painterListeners.clear();
}

function loadSuperDoc(): Promise<Any> {
  const w = window as Any;
  if (w.SuperDoc) return Promise.resolve(w.SuperDoc);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = superdocUrl;
    s.async = true;
    s.dataset.marginalia = 'superdoc';
    s.onload = () => (w.SuperDoc ? resolve(w.SuperDoc) : reject(new Error('SuperDoc introuvable après chargement')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Impossible de charger le moteur d’édition'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Auteur des commentaires créés dans Marginalia (w:author dans Word). */
export const COMMENT_AUTHOR = 'Marginalia';

const QUOTE_IDS = ['Quote', 'BlockText', 'IntenseQuote', 'Citation'];
const QUOTE_NAMES = ['quote', 'block text', 'intense quote', 'citation'];
const BODY_IDS = ['Normal', 'BodyText', 'FirstParagraph', 'Compact', 'Corpsdetexte'];

/** Échelle des tailles (points). */
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72];

const IN = 2.54; // cm par pouce
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Définitions ajoutées si le document n'a pas le style demandé. */
const STYLE_DEFS: Record<string, string> = {
  Title:
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="360"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>',
  Quote:
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/><w:pPr><w:spacing w:before="120" w:after="200"/><w:ind w:left="851" w:right="567" w:firstLine="0"/></w:pPr><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>',
  Heading1:
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="480" w:after="120"/><w:ind w:firstLine="0"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>',
  Heading2:
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:ind w:firstLine="0"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>',
  Heading3:
    '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:ind w:firstLine="0"/><w:jc w:val="left"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:bCs/><w:i/><w:iCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>',
  Normal: '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>',
  FootnoteText:
    '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>',
};
const styleDef = (id: string) => STYLE_DEFS[id] ?? styleDefinition(id);

/** Ouvre `data` (.docx) dans `host`. Rejette si le moteur ne devient pas prêt. */
export async function openDocEngine(host: HTMLElement, data: ArrayBuffer, opts: EngineOptions = {}): Promise<DocEngine> {
  const SuperDoc = await loadSuperDoc();
  installListenerTracker();
  let destroyed = false;
  let ready = false;
  // Les transactions de normalisation qui suivent l'ouverture ne sont pas des modifications ;
  // mais une saisie de l'utilisateur pendant cette fenêtre doit compter (sinon elle ne serait
  // jamais enregistrée). Le ProseMirror caché de SuperDoc vit hors de `host` : écoute globale.
  let touched = false;
  /** Transactions d'affichage (notes privées masquées) : ne comptent pas comme modifications. */
  let silent = 0;
  const onUserInput = (e: Event) => {
    const t = e.target as Element | null;
    if (t && typeof t.closest === 'function' && t.closest('.ProseMirror')) touched = true;
  };
  const INPUT_EVENTS = ['beforeinput', 'paste', 'drop', 'cut'] as const;
  for (const ev of INPUT_EVENTS) document.addEventListener(ev, onUserInput, true);
  const live = () => !destroyed && (ready || touched);
  /** Copie de styles.xml (pour les valeurs héritées des styles et le dialogue « Modifier le style »). */
  let stylesXml = await readStylesXml(data).catch(() => '');
  // Zoom d'affichage mémorisé (view.ts) : « Ajuster à la largeur » par défaut, bornes 75–200 %.
  let zoomValue: ZoomPref = readZoomPref();

  const create = (buf: ArrayBuffer): Promise<Any> => {
    const file = new File([buf], 'document.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Le document met trop de temps à s’ouvrir')), 45000);
      let inst: Any = null;
      try {
        inst = new SuperDoc({
          selector: host,
          document: file,
          documentMode: 'editing',
          telemetry: { enabled: false },
          proofing: { enabled: false },
          disablePiniaDevtools: true,
          disableContextMenu: true,
          rulers: false,
          // Commentaires Word : l'interface de SuperDoc (barre latérale, bulles flottantes, menu
          // près de la sélection) est coupée — elle décalait la page. Les données restent gérées par
          // le moteur (converter.comments, API documentaire `doc.comments`, w:comments à l'export) ;
          // l'interface est celle de comments.tsx.
          modules: { comments: false },
          user: { name: COMMENT_AUTHOR, email: '' },
          zoom:
            zoomValue === 'fit'
              ? { mode: 'fit-width', fitWidth: { min: FIT_MIN, max: FIT_MAX, padding: 32 } }
              : { mode: 'manual', initial: zoomValue, fitWidth: { min: FIT_MIN, max: FIT_MAX, padding: 32 } },
          onReady: () => {
            clearTimeout(timer);
            // les transactions de normalisation qui suivent l'ouverture ne comptent pas comme modifications
            setTimeout(() => (ready = true), 600);
            resolve(inst);
          },
          onEditorUpdate: () => {
            if (live() && !silent) opts.onChange?.();
          },
          onTransaction: (p: Any) => {
            if (!live()) return;
            // couvre aussi les éditeurs de notes (sessions de saisie de note de bas de page)
            if (p?.transaction?.docChanged && !silent && !p.transaction.getMeta?.(VIEW_META)) opts.onChange?.();
            opts.onSelection?.();
          },
          onContentError: (p: Any) => {
            clearTimeout(timer);
            reject(p?.error instanceof Error ? p.error : new Error('Document illisible'));
          },
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  };
  const waitPainted = () =>
    new Promise<void>((resolve) => {
      // Attendre que la première page soit peinte (sinon l'interface montrerait une zone vide
      // entre la fin du squelette et l'apparition de la page). Borné : 4 s.
      const t0 = performance.now();
      const tick = () => {
        if (host.querySelector('.superdoc-page') || performance.now() - t0 > 4000) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });

  let sd: Any = await create(data).catch((e) => {
    for (const ev of INPUT_EVENTS) document.removeEventListener(ev, onUserInput, true);
    throw e;
  });
  liveEngines++;
  let counted = true;
  await waitPainted();

  /** Éditeur du corps (pas la session de note éventuellement active). */
  const body = (): Any => {
    const docs = sd.superdocStore?.documents;
    const e = docs?.[0]?.getEditor?.() ?? sd.activeEditor;
    return e;
  };
  const pres = (): Any => {
    const docs = sd.superdocStore?.documents;
    return docs?.[0]?.getPresentationEditor?.() ?? body()?.presentationEditor ?? null;
  };
  const body_ = () => body();
  // Correcteur (spell/) : configuration conservée pour la réappliquer après une réouverture ;
  // le correcteur natif de Chromium est coupé quand le nôtre est actif (pas de double soulignement).
  let proofingCfg: Any = null;
  const applyProofing = () => {
    try {
      body()?.view?.dom?.setAttribute('spellcheck', proofingCfg?.enabled ? 'false' : 'true');
      pres()?.updateProofingConfig?.(proofingCfg ?? { enabled: false });
      // SuperDoc 1.47 ne recale que les fautes des paragraphes modifiés : celles des paragraphes
      // suivants restaient décalées après une insertion. On étend la zone modifiée jusqu'à la fin
      // (le fournisseur de spell/ répond depuis son cache pour les paragraphes inchangés).
      // De même, les spans découpés pour peindre une faute gardent leurs positions d'origine hors de
      // portée du recalage du peintre : on les recolle avant le rendu (qui suit la transaction).
      const mgr = pres()?.proofingManager;
      if (mgr && !mgr.__mgPatched) {
        const orig = mgr.onDocumentChanged.bind(mgr);
        mgr.onDocumentChanged = (doc: Any, ranges: { from: number; to: number }[], mapping: Any) => {
          for (const s of Array.from(host.querySelectorAll('[data-sd-proofing-split]'))) s.remove();
          for (const o of Array.from(host.querySelectorAll<HTMLElement>('[data-sd-proofing="original"]'))) {
            o.style.display = '';
            if (!o.style.cssText) o.removeAttribute('style');
            o.removeAttribute('data-sd-proofing');
            for (const k of ['start', 'end']) {
              const v = o.getAttribute(`data-sd-orig-pm-${k}`);
              if (v) o.setAttribute(`data-pm-${k}`, v);
              o.removeAttribute(`data-sd-orig-pm-${k}`);
            }
          }
          return orig(doc, ranges.length ? [{ from: Math.min(...ranges.map((r) => r.from)), to: doc.content.size }] : ranges, mapping);
        };
        mgr.__mgPatched = true;
      }
    } catch (e) {
      console.warn('correcteur', e);
    }
  };
  const changed = () => {
    touched = true;
    if (!destroyed) opts.onChange?.();
  };

  // ── Styles disponibles dans le document ──
  const styleMap = (): Map<string, string> => {
    const out = new Map<string, string>();
    const ls: Any[] = body()?.converter?.linkedStyles ?? [];
    for (const s of ls) if (s?.type === 'paragraph' && s.id) out.set(String(s.id), String(s.definition?.attrs?.name ?? s.id).toLowerCase());
    return out;
  };
  const resolveStyleId = (s: ParaStyle): string | null => {
    const map = styleMap();
    if (s === 'body') return null;
    if (s === 'quote') {
      for (const id of QUOTE_IDS) if (map.has(id)) return id;
      for (const [id, name] of map) if (QUOTE_NAMES.includes(name)) return id;
      return null; // pas de style Citation : mise en forme directe
    }
    if (s === 'title') {
      if (map.has('Title')) return 'Title';
      for (const [id, name] of map) if (name === 'title' || name === 'titre') return id;
      return 'Title';
    }
    if (s === 'caption') {
      if (map.has('Caption')) return 'Caption';
      for (const [id, name] of map) if (name === 'caption' || name === 'légende') return id;
      return 'Caption';
    }
    const n = s === 'h1' ? 1 : s === 'h2' ? 2 : 3;
    if (map.has(`Heading${n}`)) return `Heading${n}`;
    for (const [id, name] of map) if (name === `heading ${n}` || name === `titre ${n}`) return id;
    return `Heading${n}`;
  };
  /** Styles à modifier pour « Corps » : tous les styles de corps présents (Normal, BodyText…). */
  const styleIdsFor = (s: ParaStyle): string[] => {
    if (s === 'body') {
      const map = styleMap();
      const ids = BODY_IDS.filter((id) => map.has(id) || new RegExp(`w:styleId="${id}"`).test(stylesXml));
      const def = defaultParagraphStyle(stylesXml);
      if (def && !ids.includes(def)) ids.unshift(def);
      return ids.length ? ids : ['Normal'];
    }
    if (s === 'quote') return [resolveStyleId('quote') ?? 'Quote'];
    return [resolveStyleId(s)!];
  };
  const kindOfStyle = (styleId: string | null | undefined, pp: Any): ParaStyle | 'other' => {
    if (!styleId) return pp?.indent?.left && pp?.indent?.right ? 'quote' : 'body';
    const m = styleId.match(/^(?:Heading|Titre)(\d)$/);
    const name = styleMap().get(styleId) ?? '';
    const nm = name.match(/^(?:heading|titre) (\d)$/);
    const lvl = m ? Number(m[1]) : nm ? Number(nm[1]) : 0;
    if (lvl === 1) return 'h1';
    if (lvl === 2) return 'h2';
    if (lvl === 3) return 'h3';
    if (lvl > 3) return 'other';
    if (styleId === 'Title' || name === 'title' || name === 'titre') return 'title';
    if (styleId === 'Caption' || name === 'caption' || name === 'légende') return 'caption';
    if (QUOTE_IDS.includes(styleId) || QUOTE_NAMES.includes(name)) return 'quote';
    if (/^(Normal|BodyText|FirstParagraph|Compact|Corpsdetexte)$/.test(styleId) || /^(normal|body text|first paragraph)$/.test(name)) return 'body';
    return 'other';
  };

  /** Profondeur du paragraphe englobant la sélection. */
  const paraDepth = ($pos: Any): number => {
    for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'paragraph') return d;
    return -1;
  };
  /** Paragraphes de la sélection (au moins celui du curseur). */
  const selectedParagraphs = (ed: Any): { node: Any; pos: number }[] => {
    const out: { node: Any; pos: number }[] = [];
    const { from, to, $from } = ed.state.selection;
    ed.state.doc.nodesBetween(from, Math.max(to, from), (n: Any, pos: number) => {
      if (n.type.name === 'paragraph') {
        out.push({ node: n, pos });
        return false;
      }
      return true;
    });
    if (!out.length) {
      const d = paraDepth($from);
      if (d > 0) out.push({ node: $from.node(d), pos: $from.before(d) });
    }
    return out;
  };
  const blockTargets = (ed: Any) =>
    selectedParagraphs(ed)
      .map((p) => p.node.attrs.sdBlockId)
      .filter(Boolean)
      .map((nodeId: string) => ({ kind: 'block', nodeType: 'paragraph', nodeId }));

  /** Cible « sélection » de l'API documentaire (segments de texte de la sélection courante). */
  const selectionTarget = (ed: Any): Any | null => {
    const cur = ed.doc.selection.current({});
    const sg: Any[] = cur?.target?.segments ?? [];
    if (cur?.empty || !sg.length) return null;
    const a = sg[0];
    const b = sg[sg.length - 1];
    return { kind: 'selection', start: { kind: 'text', blockId: a.blockId, offset: a.range.start }, end: { kind: 'text', blockId: b.blockId, offset: b.range.end } };
  };

  /** Marques des nœuds texte touchés par la sélection (le curseur : texte qui précède). */
  const marksAtSelection = (ed: Any): Any[] => {
    const { from, to, empty } = ed.state.selection;
    const out: Any[] = [];
    const a = empty ? Math.max(0, from - 1) : from;
    const b = empty ? Math.min(ed.state.doc.content.size, from + 1) : to;
    ed.state.doc.nodesBetween(a, b, (n: Any) => {
      if (n.isText) out.push(...n.marks);
      return true;
    });
    return out;
  };

  /** Ramène le curseur à l'intérieur d'un run (sinon la note serait hors <w:r>, OOXML invalide). */
  const caretIntoRun = (ed: Any) => {
    const { state } = ed;
    const $h = state.selection.$head;
    if ($h.parent.type.name === 'run') return;
    let target = -1;
    if ($h.nodeBefore?.type.name === 'run' && $h.nodeBefore.content.size > 0) target = $h.pos - 1;
    else if ($h.nodeAfter?.type.name === 'run') target = $h.pos + 1;
    else {
      // paragraphe sans run : on y crée un run vide n'est pas possible (texte requis) → fin du texte le plus proche
      state.doc.nodesBetween(Math.max(0, $h.pos - 200), $h.pos, (n: Any, p: Any) => {
        if (n.isText) target = p + n.nodeSize;
        return true;
      });
    }
    if (target >= 0) ed.commands.setTextSelection({ from: target, to: target });
  };

  const textblocks = (): string[] => {
    const out: string[] = [];
    body()?.state.doc.descendants((n: Any) => {
      if (n.isTextblock) {
        out.push(n.textContent);
        return false;
      }
      return true;
    });
    return out;
  };

  const exportRaw = async (): Promise<ArrayBuffer> => {
    const blob: Blob = await sd.export({ exportType: ['docx'], commentsType: 'external', triggerDownload: false });
    return blob.arrayBuffer();
  };
  const exportDocx = async (): Promise<ArrayBuffer> => normalizeDocx(await exportRaw());

  /** Rouvre `buf` dans le même hôte en gardant la position du curseur et le défilement. */
  const reload = async (buf: ArrayBuffer) => {
    const ed = body();
    const pos = ed?.state.selection.from ?? 1;
    const scroller = host.closest('.ed-scroll') as HTMLElement | null;
    const top = scroller?.scrollTop ?? 0;
    host.classList.add('ed-reloading');
    ready = false;
    touched = false;
    try {
      sd.destroy();
    } catch (e) {
      console.warn(e);
    }
    host.innerHTML = '';
    dropStray();
    sd = await create(buf);
    await waitPainted();
    if (proofingCfg) applyProofing();
    stylesXml = await readStylesXml(buf).catch(() => stylesXml);
    if (zoomValue !== 'fit') engine.setZoom(zoomValue);
    const e2 = body();
    try {
      const p = Math.max(1, Math.min(pos, e2.state.doc.content.size - 1));
      e2.commands.setTextSelection({ from: p, to: p });
    } catch {
      /* position hors texte */
    }
    if (scroller) scroller.scrollTop = top;
    host.classList.remove('ed-reloading');
    opts.onReload?.();
    changed();
  };

  /** Applique une transformation de paquet, rouvre, renvoie l'instantané d'avant. */
  const transformDoc = async (fn: (d: ArrayBuffer) => Promise<ArrayBuffer>): Promise<ArrayBuffer> => {
    const before = await exportDocx();
    const after = await fn(before);
    await reload(after);
    return before;
  };

  // ── Sections (unités : pouces dans l'API documentaire) ──
  const sections = (): Any[] => body()?.doc.sections.list({}).items ?? [];
  const sectionsOp = async (fn: (target: Any, item: Any) => void): Promise<ArrayBuffer> => {
    const before = await exportDocx();
    for (const it of sections()) fn(it.address, it);
    changed();
    return before;
  };
  const explicitFooter = (variant: 'default' | 'first'): string | null => {
    const items: Any[] = body()?.doc.headerFooters.list({}).items ?? [];
    const it = items.find((i) => i.sectionIndex === 0 && i.kind === 'footer' && i.variant === variant && i.isExplicit);
    return it?.refId ?? null;
  };
  const footerText = (refId: string): string => {
    try {
      const kids = new Set(Array.from(document.body.children));
      const fe = pres()?.ensureHeaderFooterEditor?.('footer', refId);
      for (const el of Array.from(document.body.children)) if (!kids.has(el)) stray.add(el as HTMLElement);
      hideStray();
      return fe?.state?.doc?.textContent ?? '';
    } catch {
      return '';
    }
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** Éléments que SuperDoc ajoute à <body> (éditeurs de pied de page). */
  const stray = new Set<HTMLElement>();
  const hideStray = () => {
    for (const el of stray) {
      el.style.setProperty('left', '-20000px', 'important');
      el.style.setProperty('top', '0', 'important');
      el.style.setProperty('position', 'fixed', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      el.setAttribute('aria-hidden', 'true');
    }
  };
  const dropStray = () => {
    for (const el of stray) el.remove();
    stray.clear();
    releasePainterListeners();
  };

  /** Niveau de titre (1 à 3) d'un paragraphe (plan déplaçable). */
  const levelOf: LevelOf = (n: Any) => {
    const pp = n.attrs?.paragraphProperties;
    const k = kindOfStyle(pp?.styleId, pp);
    return k === 'h1' ? 1 : k === 'h2' ? 2 : k === 'h3' ? 3 : 0;
  };

  // ── Commentaires Word ──
  // Données : converter.comments (entrées du moteur, écrites dans comments.xml à l'export) et,
  // dans le texte, la marque `commentMark` (fil ouvert) ou les nœuds commentRangeStart/End (fil
  // résolu). Opérations : API documentaire `doc.comments` (research : create / patch / delete).
  /** Fils supprimés (pour ⌘Z dans le texte, qui remet la marque mais pas l'entrée du moteur). */
  const deletedComments = new Map<string, Any[]>();
  const commentStore = (ed: Any): Any[] => {
    const c = ed?.converter;
    if (!c) return [];
    if (!Array.isArray(c.comments)) c.comments = [];
    return c.comments;
  };
  /** Positions des passages commentés : identifiant (commentId et importedId) → [from, to]. */
  const commentAnchors = (doc: Any): Map<string, { from: number; to: number }> => {
    const out = new Map<string, { from: number; to: number }>();
    const open = new Map<string, number>();
    const put = (ids: (string | null | undefined)[], from: number, to: number) => {
      for (const id of ids) {
        if (!id) continue;
        const cur = out.get(id);
        out.set(id, cur ? { from: Math.min(cur.from, from), to: Math.max(cur.to, to) } : { from, to });
      }
    };
    doc.descendants((n: Any, pos: number) => {
      if (n.isText) {
        for (const m of n.marks) if (m.type.name === 'commentMark') put([m.attrs.commentId, m.attrs.importedId], pos, pos + n.nodeSize);
        return false;
      }
      const name = n.type.name;
      if (name === 'commentRangeStart') {
        const id = String(n.attrs['w:id'] ?? n.attrs.commentId ?? '');
        if (id) open.set(id, pos + n.nodeSize);
      } else if (name === 'commentRangeEnd') {
        const id = String(n.attrs['w:id'] ?? n.attrs.commentId ?? '');
        const s = open.get(id);
        if (id && s !== undefined && !out.has(id)) put([id], s, pos);
      }
      return true;
    });
    return out;
  };
  /** Texte d'une entrée importée, paragraphe par paragraphe (« \n » entre deux paragraphes). */
  const entryText = (e: Any): string => {
    const paras: Any[] = Array.isArray(e?.elements) ? e.elements : [];
    if (paras.length < 2) return '';
    const flat = (v: Any): string => {
      if (!v || typeof v !== 'object') return '';
      if (Array.isArray(v)) return v.map(flat).join('');
      if (v.type === 'text' && typeof v.text === 'string') return v.text;
      return flat(v.content);
    };
    return paras
      .map((p) => flat(p))
      .join('\n')
      .replace(/^\n+|\n+$/g, '');
  };
  /** Racine et réponses (dans l'ordre du moteur). */
  const commentTree = (store: Any[], rootId: string): Any[] => {
    const ids = new Set([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of store) if (e.parentCommentId && ids.has(e.parentCommentId) && !ids.has(e.commentId)) (ids.add(e.commentId), (grew = true));
    }
    return store.filter((e) => ids.has(e.commentId) || (e.importedId && ids.has(e.importedId)));
  };
  /** Sélection posée sur [from, to] → cible de l'API documentaire. */
  const rangeTarget = (ed: Any, from: number, to: number): Any | null => {
    ed.commands.setTextSelection({ from, to });
    return selectionTarget(ed);
  };

  const engine: DocEngine = {
    exportDocx,
    plainText(o) {
      if (o?.privateNotes === false) {
        const d = body()?.state.doc;
        return d ? textblocksOf(d, false).join('\n') : '';
      }
      return textblocks().join('\n');
    },
    wordCount() {
      // notes privées comprises : G2 compare avec le .docx de la bibliothèque, qui les garde
      return countWords(textblocks().join('\n'));
    },
    stats() {
      // statistiques affichées : sans les notes privées (texte réellement exporté)
      const d = body()?.state.doc;
      const t = d ? textblocksOf(d, false).join('\n') : '';
      return { words: countWords(t), chars: t.replace(/\n/g, '').length, charsNoSpaces: t.replace(/\s/g, '').length };
    },
    outline() {
      const out: OutlineItem[] = [];
      body()?.state.doc.descendants((n: Any, pos: number) => {
        if (n.type.name === 'paragraph') {
          const pp = n.attrs.paragraphProperties;
          const k = kindOfStyle(pp?.styleId, pp);
          const text = n.textContent.trim();
          if (text && (k === 'h1' || k === 'h2' || k === 'h3')) out.push({ level: Number(k[1]) as 1 | 2 | 3, text, pos });
          return false;
        }
        if (n.type.name === 'tableOfContents') return false;
        return true;
      });
      return out;
    },
    state() {
      const ed = body();
      const st: EngineState = {
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        superscript: false,
        subscript: false,
        smallCaps: false,
        fontFamily: null,
        fontSize: null,
        color: null,
        highlight: null,
        align: 'left',
        lineHeight: null,
        spaceBefore: 0,
        spaceAfter: 0,
        indentLeft: 0,
        firstLine: 0,
        style: 'body',
        styleId: null,
        list: null,
        listLevel: 0,
        inTable: false,
        link: null,
        empty: true,
        pos: 0,
      };
      if (!ed) return st;
      const { selection } = ed.state;
      st.pos = selection.from;
      st.empty = selection.empty;
      let af: Any[] = [];
      try {
        af = SuperDoc.getActiveFormatting(ed) ?? [];
      } catch {
        af = [];
      }
      const get = (n: string) => af.find((x) => x.name === n)?.attrs;
      st.bold = !!get('bold') && get('bold').value !== false;
      st.italic = !!get('italic') && get('italic').value !== false;
      st.underline = !!get('underline') && get('underline').underlineType !== 'none';
      st.strike = !!get('strike') && get('strike').value !== false;
      const rp = get('runProperties')?.runProperties ?? {};
      const va = rp.vertAlign ?? get('vertAlign')?.vertAlign;
      st.superscript = va === 'superscript';
      st.subscript = va === 'subscript';
      st.smallCaps = !!rp.smallCaps;
      st.fontFamily = familyName(get('fontFamily')?.fontFamily);
      const fs = get('fontSize')?.fontSize;
      st.fontSize = fs ? parseFloat(String(fs)) || null : null;
      st.color = get('color')?.color ?? null;
      st.highlight = get('highlight')?.color ?? null;
      const linkMark = marksAtSelection(ed).find((m: Any) => m.type.name === 'link');
      st.link = linkMark?.attrs?.href ?? null;
      // valeurs héritées des marques résolues (styles) si rien d'explicite
      if (!st.fontFamily || !st.fontSize) {
        const ts = (selection.$from.marks() as Any[]).find((m) => m.type.name === 'textStyle')?.attrs;
        st.fontFamily ??= familyName(ts?.fontFamily);
        if (!st.fontSize && ts?.fontSize) st.fontSize = parseFloat(String(ts.fontSize)) || null;
      }
      const d = paraDepth(selection.$from);
      if (d > 0) {
        const p = selection.$from.node(d);
        const pp = p.attrs.paragraphProperties ?? {};
        st.styleId = pp.styleId ?? null;
        st.style = kindOfStyle(pp.styleId, pp);
        const eff = effectiveStyleProps(stylesXml, pp.styleId ?? null);
        const np = pp.numberingProperties;
        if (np) {
          st.listLevel = Number(np.ilvl ?? 0);
          const listType = p.attrs.listRendering?.numberingType ?? p.attrs.listRendering?.markerType;
          st.list = /bullet/i.test(String(listType ?? '')) ? 'bullet' : 'ordered';
          if (!listType) {
            const txt = String(p.attrs.listRendering?.markerText ?? '');
            st.list = /^[\d\w]+[.)]?$/.test(txt) ? 'ordered' : 'bullet';
          }
        }
        const jc = pp.justification ?? eff.align;
        st.align = jc === 'both' || jc === 'justify' ? 'justify' : jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left';
        const sp = pp.spacing ?? {};
        if (sp.line != null && (sp.lineRule ?? 'auto') === 'auto') st.lineHeight = Math.round((Number(sp.line) / 240) * 100) / 100;
        else if (sp.line == null) st.lineHeight = eff.lineSpacing ?? 1;
        st.spaceBefore = Number(sp.before ?? eff.before ?? 0);
        st.spaceAfter = Number(sp.after ?? eff.after ?? 0);
        const ind = pp.indent ?? {};
        st.indentLeft = Number(ind.left ?? 0);
        st.firstLine = ind.firstLine != null ? Number(ind.firstLine) : ind.hanging != null ? -Number(ind.hanging) : Number(eff.firstLine ?? 0);
        if (!st.fontFamily) st.fontFamily = eff.fontFamily ?? null;
        if (!st.fontSize) st.fontSize = eff.fontSize ?? null;
      }
      // (sélection de cellules : $from est entre les cellules, hors paragraphe)
      for (let k = selection.$from.depth; k > 0; k--) if (selection.$from.node(k).type.name === 'table') st.inTable = true;
      return st;
    },

    // ── Caractères ──
    toggleMark(m) {
      touched = true;
      const ed = body();
      if (!ed) return;
      if (m === 'bold') ed.commands.toggleBold();
      else if (m === 'italic') ed.commands.toggleItalic();
      else if (m === 'underline') ed.commands.toggleUnderline();
      else if (m === 'strike') ed.commands.toggleStrike();
      else {
        const st = engine.state();
        const target = selectionTarget(ed);
        if (!target) return;
        if (m === 'smallCaps') ed.doc.format.smallCaps({ target, value: !st.smallCaps });
        else {
          const on = m === 'superscript' ? st.superscript : st.subscript;
          ed.doc.format.vertAlign({ target, value: on ? 'baseline' : m });
        }
        changed();
      }
      ed.view.focus();
    },
    setFontFamily(family) {
      touched = true;
      const ed = body();
      if (!ed) return;
      ed.commands.setFontFamily(family);
      ed.view.focus();
    },
    setFontSize(pt) {
      touched = true;
      const ed = body();
      if (!ed) return;
      const v = Math.min(400, Math.max(1, Math.round(pt * 2) / 2));
      ed.commands.setFontSize(`${v}pt`);
      ed.view.focus();
    },
    stepFontSize(dir) {
      const cur = engine.state().fontSize ?? 12;
      const next = dir > 0 ? FONT_SIZES.find((s) => s > cur + 0.01) ?? Math.min(400, cur + 8) : [...FONT_SIZES].reverse().find((s) => s < cur - 0.01) ?? Math.max(1, cur - 1);
      engine.setFontSize(next);
    },
    setColor(hex) {
      touched = true;
      const ed = body();
      if (!ed) return;
      if (hex) ed.commands.setColor(hex);
      else ed.commands.unsetColor();
      ed.view.focus();
    },
    setHighlight(hex) {
      touched = true;
      const ed = body();
      if (!ed) return;
      if (hex) ed.commands.setHighlight(hex);
      else ed.commands.unsetHighlight();
      ed.view.focus();
    },
    clearInlineFormatting() {
      touched = true;
      const ed = body();
      if (!ed) return;
      // NB : commands.clearFormat retire aussi le style de paragraphe (research/9 §1.1) : jamais utilisé.
      let ok = false;
      try {
        const target = selectionTarget(ed);
        if (target) {
          const r = ed.doc.format.apply({
            target,
            inline: { bold: null, italic: null, underline: null, strike: null, color: null, fontFamily: null, fontSize: null, highlight: null, vertAlign: null, smallCaps: null, caps: null },
          });
          ok = r?.success !== false;
        }
      } catch (e) {
        console.warn(e);
      }
      if (!ok) ed.commands.unsetAllMarks();
      changed();
      ed.view.focus();
    },

    // ── Paragraphes ──
    async setParagraphStyle(s) {
      touched = true;
      let ed = body();
      if (!ed) return;
      let styleId = resolveStyleId(s);
      // Style absent du document (Titre, Légende, Titre N d'un fichier externe) : on l'ajoute d'abord.
      if (styleId && !styleMap().has(styleId)) {
        const def = styleDef(styleId);
        if (def) {
          await transformDoc((d) => transformStyles(d, (x) => ensureStylesXml(x, { [styleId!]: def })));
          ed = body();
          styleId = resolveStyleId(s);
        }
      }
      // NB : commands.setStyleById efface gras / italique du paragraphe (constaté) ;
      // on ne change donc que l'identifiant de style du ou des paragraphes sélectionnés.
      let tr = ed.state.tr;
      for (const { node: n, pos } of selectedParagraphs(ed)) {
        const pp = { ...(n.attrs.paragraphProperties ?? {}) };
        if (styleId) pp.styleId = styleId;
        else delete pp.styleId;
        if (s === 'quote' && !styleId) pp.indent = { ...(pp.indent ?? {}), left: 851, right: 567 };
        else if (pp.indent && !n.attrs.paragraphProperties?.styleId && s !== 'quote') {
          // retour au corps depuis une citation en mise en forme directe
          const { left, right, ...rest } = pp.indent;
          if (left === 851 && right === 567) pp.indent = Object.keys(rest).length ? rest : undefined;
        }
        if (s !== 'body' && pp.numberingProperties && s !== 'quote') delete pp.numberingProperties;
        tr = tr.setNodeMarkup(pos, undefined, { ...n.attrs, paragraphProperties: pp });
      }
      if (tr.docChanged) ed.view.dispatch(tr);
      ed.view.focus();
    },
    setAlign(a) {
      touched = true;
      const ed = body();
      if (!ed) return;
      ed.commands.setTextAlign(a);
      ed.view.focus();
    },
    setLineHeight(v) {
      touched = true;
      const ed = body();
      if (!ed) return;
      ed.commands.setLineHeight(v);
      ed.view.focus();
    },
    setParagraphSpacing(v) {
      touched = true;
      const ed = body();
      if (!ed) return;
      for (const target of blockTargets(ed)) ed.doc.format.paragraph.setSpacing({ target, ...v });
      changed();
      ed.view.focus();
    },
    setIndent(v) {
      touched = true;
      const ed = body();
      if (!ed) return;
      for (const target of blockTargets(ed)) {
        const args: Any = { target };
        if (v.left !== undefined) args.left = Math.max(0, Math.round(v.left));
        if (v.firstLine !== undefined) {
          if (v.firstLine >= 0) args.firstLine = Math.round(v.firstLine);
          else args.hanging = Math.round(-v.firstLine);
        }
        ed.doc.format.paragraph.setIndentation(args);
      }
      changed();
      ed.view.focus();
    },
    changeIndent(dir) {
      touched = true;
      const ed = body();
      if (!ed) return;
      const st = engine.state();
      if (st.list) {
        engine.listLevel(dir);
        return;
      }
      engine.setIndent({ left: Math.max(0, st.indentLeft + dir * 709), firstLine: st.firstLine });
    },
    toggleList(kind) {
      touched = true;
      const ed = body();
      if (!ed) return;
      if (kind === 'bullet') ed.commands.toggleBulletList();
      else ed.commands.toggleOrderedList();
      ed.view.focus();
    },
    outlineList() {
      touched = true;
      const ed = body();
      if (!ed) return;
      const st = engine.state();
      if (st.list !== 'ordered') ed.commands.toggleOrderedList();
      // niveaux 2 et 3 : 1.1. et 1.1.1. (research/9 §1.3 : lists.setLevelText)
      try {
        const para = selectedParagraphs(ed)[0];
        const paraId = para?.node.attrs.paraId;
        const lists: Any[] = ed.doc.lists.list({}).items ?? [];
        const item = lists.find((x) => x.address?.nodeId === paraId)?.address;
        if (!item) throw new Error('élément de liste introuvable');
        ed.doc.lists.setLevelText({ target: item, level: 0, text: '%1.' });
        ed.doc.lists.setLevelText({ target: item, level: 1, text: '%1.%2.' });
        ed.doc.lists.setLevelText({ target: item, level: 2, text: '%1.%2.%3.' });
      } catch (e) {
        console.warn('numérotation hiérarchique', e);
      }
      changed();
      ed.view.focus();
    },
    listLevel(dir) {
      touched = true;
      const ed = body();
      if (!ed) return false;
      const ok = dir > 0 ? ed.commands.increaseListIndent() : ed.commands.decreaseListIndent();
      ed.view.focus();
      return !!ok;
    },

    // ── Styles ──
    styleProps(s) {
      const ids = styleIdsFor(s);
      return effectiveStyleProps(stylesXml, ids.includes('Normal') && s === 'body' ? 'Normal' : ids[0]);
    },
    async modifyStyle(s, patch) {
      touched = true;
      const ids = styleIdsFor(s);
      const defs: Record<string, string> = {};
      for (const id of ids) {
        const d = styleDef(id);
        if (d) defs[id] = d;
      }
      return transformDoc((d) => transformStyles(d, (x) => patchStylesXml(x, ids, patch, defs)));
    },

    // ── Insertion ──
    insertFootnote() {
      touched = true;
      const ed = body();
      if (!ed) return false;
      caretIntoRun(ed);
      try {
        return !!ed.commands.insertFootnote();
      } catch (e) {
        console.error(e);
        return false;
      }
    },
    insertCitation(quote, note) {
      touched = true;
      const ed = body();
      if (!ed) return false;
      const S = ed.state.schema;
      const { state } = ed;
      const $from = state.selection.$from;
      const d = paraDepth($from);
      const styleId = resolveStyleId('quote');
      const quotePP: Any = styleId ? { styleId } : { indent: { left: 851, right: 567 } };
      const quotePara = S.nodes.paragraph.create({ paragraphProperties: quotePP }, S.nodes.run.create({}, S.text(quote)));
      const after = S.nodes.paragraph.create({ paragraphProperties: {} });
      let insertAt: number;
      let tr = state.tr;
      if (d > 0 && $from.node(d).content.size === 0) {
        // paragraphe vide : on le remplace
        const start = $from.before(d);
        tr = tr.replaceWith(start, $from.after(d), [quotePara, after]);
        insertAt = start;
      } else {
        insertAt = d > 0 ? $from.after(d) : state.doc.content.size;
        tr = tr.insert(insertAt, [quotePara, after]);
      }
      ed.view.dispatch(tr);
      // curseur à la fin du texte cité, dans le run
      let end = -1;
      ed.state.doc.nodesBetween(insertAt, insertAt + quotePara.nodeSize, (n: Any, p: number) => {
        if (n.isText) end = p + n.nodeSize;
        return true;
      });
      if (end < 0) return false;
      ed.commands.setTextSelection({ from: end, to: end });
      let ok = true;
      try {
        const res = ed.doc.footnotes.insert({ type: 'footnote', content: note });
        ok = !!res?.success;
      } catch (e) {
        console.error(e);
        ok = false;
      }
      // curseur dans le paragraphe vide qui suit, pour continuer à écrire
      const $q = ed.state.doc.resolve(Math.min(ed.state.doc.content.size, end));
      const qd = paraDepth($q);
      if (qd > 0) {
        const next = $q.after(qd) + 1;
        if (next <= ed.state.doc.content.size) ed.commands.setTextSelection({ from: next, to: next });
      }
      ed.view.focus();
      return ok;
    },
    insertText(text) {
      touched = true;
      const ed = body();
      if (!ed) return;
      // Transaction directe : insertContent(chaîne) passe par l'analyse HTML, qui change les
      // espaces insécables (U+00A0, U+202F) en espaces ordinaires.
      caretIntoRun(ed);
      if (ed.state.selection.$from.parent.type.name === 'run') ed.view.dispatch(ed.state.tr.insertText(text));
      else ed.commands.insertContent({ type: 'text', text });
      ed.view.focus();
    },
    insertPageBreak() {
      touched = true;
      const ed = body();
      if (!ed) return;
      ed.commands.insertPageBreak();
      ed.view.focus();
    },
    insertTable(rows, cols) {
      touched = true;
      const ed = body();
      if (!ed) return false;
      const ok = !!ed.commands.insertTable({ rows, cols, withHeaderRow: false });
      if (!ok) return false;
      // SuperDoc n'écrit pas de bordures par défaut : tableau invisible dans Word. Bordures fines.
      try {
        const $f = ed.state.selection.$from;
        let tbl: Any = null;
        for (let k = $f.depth; k > 0; k--) if ($f.node(k).type.name === 'table') tbl = $f.node(k);
        const nodeId = tbl?.attrs?.sdBlockId ?? tbl?.attrs?.paraId;
        if (nodeId) ed.doc.tables.applyBorderPreset({ target: { kind: 'block', nodeType: 'table', nodeId }, preset: 'all', size: 4, color: '000000' });
      } catch (e) {
        console.warn('bordures du tableau', e);
      }
      changed();
      ed.view.focus();
      return true;
    },
    tableOp(op) {
      touched = true;
      const ed = body();
      if (!ed) return false;
      const c = ed.commands;
      const ok =
        op === 'rowBefore'
          ? c.addRowBefore()
          : op === 'rowAfter'
            ? c.addRowAfter()
            : op === 'colBefore'
              ? c.addColumnBefore()
              : op === 'colAfter'
                ? c.addColumnAfter()
                : op === 'deleteRow'
                  ? c.deleteRow()
                  : op === 'deleteCol'
                    ? c.deleteColumn()
                    : op === 'merge'
                      ? c.mergeCells()
                      : op === 'split'
                        ? c.splitCell()
                        : op === 'headerRow'
                          ? c.toggleHeaderRow()
                          : c.deleteTable();
      ed.view.focus();
      return !!ok;
    },
    insertImage(src, width, height, alt) {
      touched = true;
      const ed = body();
      if (!ed) return false;
      // largeur du texte en px (96 px par pouce) d'après la première section
      const sec = sections()[0];
      const maxW = sec ? (sec.pageSetup.width - sec.margins.left - sec.margins.right) * 96 : 600;
      const k = width > maxW ? maxW / width : 1;
      const ok = !!ed.commands.setImage({ src, alt, size: { width: Math.round(width * k), height: Math.round(height * k) } });
      ed.view.focus();
      return ok;
    },
    setLink(href, text) {
      touched = true;
      const ed = body();
      if (!ed) return false;
      const { empty, from } = ed.state.selection;
      if (empty) {
        const label = text || href;
        ed.commands.insertContent(label);
        ed.commands.setTextSelection({ from, to: from + label.length });
      }
      const ok = !!ed.commands.setLink({ href });
      const to = ed.state.selection.to;
      ed.commands.setTextSelection({ from: to, to });
      ed.view.focus();
      return ok;
    },
    unsetLink() {
      touched = true;
      const ed = body();
      if (!ed) return;
      // étend la sélection au lien entier si le curseur y est seulement posé
      const { empty, from } = ed.state.selection;
      if (empty) {
        const $p = ed.state.doc.resolve(from);
        let start = from;
        let end = from;
        ed.state.doc.nodesBetween($p.start(), $p.end(), (n: Any, pos: number) => {
          if (n.isText && n.marks.some((m: Any) => m.type.name === 'link') && pos <= from && pos + n.nodeSize >= from) {
            start = pos;
            end = pos + n.nodeSize;
          }
          return true;
        });
        ed.commands.setTextSelection({ from: start, to: end });
      }
      ed.commands.unsetLink();
      ed.view.focus();
    },
    async insertToc() {
      touched = true;
      const ed = body();
      if (!ed) return false;
      let ok = false;
      const para = selectedParagraphs(ed)[0];
      const nodeId = para?.node.attrs.sdBlockId;
      try {
        if (nodeId) ok = !!ed.doc.create.tableOfContents({ at: { kind: 'before', target: { kind: 'block', nodeType: 'paragraph', nodeId } } })?.success;
      } catch (e) {
        console.warn(e);
      }
      if (!ok) {
        try {
          ok = !!ed.commands.insertTableOfContents();
        } catch (e) {
          console.warn(e);
        }
      }
      if (!ok) {
        try {
          ok = !!ed.doc.create.tableOfContents({ at: { kind: 'documentStart' } })?.success;
        } catch (e) {
          console.error(e);
        }
      }
      if (ok) await engine.updateToc();
      changed();
      ed.view.focus();
      return ok;
    },
    async updateToc() {
      touched = true;
      const ed = body();
      if (!ed) return 0;
      const list = (): Any[] => ed.doc.toc.list({}).items ?? [];
      let n = 0;
      for (const it of list()) {
        try {
          ed.doc.toc.update({ target: it.address, mode: 'all' });
          n++;
        } catch (e) {
          console.warn(e);
        }
      }
      // numéros de page : calculés d'après la mise en page, une fois celle-ci recalculée
      await sleep(500);
      for (const it of list()) {
        try {
          ed.doc.toc.update({ target: it.address, mode: 'pageNumbers' });
        } catch (e) {
          console.warn(e);
        }
      }
      if (n) changed();
      return n;
    },
    tocCount() {
      try {
        return body()?.doc.toc.list({}).total ?? 0;
      } catch {
        return 0;
      }
    },

    // ── Mise en page ──
    pageSetup() {
      const s = sections()[0];
      const def: PageSetup = { width: 21, height: 29.7, orientation: 'portrait', margins: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 }, titlePage: false, pageNumbers: 'none' };
      if (!s) return def;
      const ref = explicitFooter('default');
      let pageNumbers: PageNumbers = 'none';
      if (ref) {
        const t = footerText(ref);
        pageNumbers = /\//.test(t) ? 'n-of-total' : 'n';
      }
      return {
        width: r2(s.pageSetup.width * IN),
        height: r2(s.pageSetup.height * IN),
        orientation: s.pageSetup.orientation === 'landscape' || s.pageSetup.width > s.pageSetup.height ? 'landscape' : 'portrait',
        margins: { top: r2(s.margins.top * IN), right: r2(s.margins.right * IN), bottom: r2(s.margins.bottom * IN), left: r2(s.margins.left * IN) },
        titlePage: !!s.titlePage,
        pageNumbers,
      };
    },
    setPageSize(size) {
      const land = engine.pageSetup().orientation === 'landscape';
      const w = (land ? Math.max(size.width, size.height) : Math.min(size.width, size.height)) / IN;
      const h = (land ? Math.min(size.width, size.height) : Math.max(size.width, size.height)) / IN;
      return sectionsOp((target) => body().doc.sections.setPageSetup({ target, width: w, height: h }));
    },
    setOrientation(o) {
      return sectionsOp((target) => body().doc.sections.setPageSetup({ target, orientation: o }));
    },
    setMargins(m) {
      return sectionsOp((target) => body().doc.sections.setPageMargins({ target, top: m.top / IN, right: m.right / IN, bottom: m.bottom / IN, left: m.left / IN }));
    },
    async setPageNumbers(mode) {
      const before = await exportDocx();
      const d = body().doc;
      const secs = sections();
      const old = explicitFooter('default');
      if (old) {
        for (const s of secs) {
          try {
            d.sections.clearHeaderFooterRef({ target: s.address, kind: 'footer', variant: 'default' });
          } catch (e) {
            console.warn(e);
          }
        }
        try {
          d.headerFooters.parts.delete({ target: { kind: 'headerFooterPart', refId: old } });
        } catch {
          /* partie conservée (sans effet) */
        }
      }
      if (mode !== 'none') {
        const f = d.headerFooters.parts.create({ kind: 'footer' });
        for (const s of secs) d.sections.setHeaderFooterRef({ target: s.address, kind: 'footer', variant: 'default', refId: f.refId });
        await sleep(400);
        const kids = new Set(Array.from(document.body.children));
        const fe = pres()?.ensureHeaderFooterEditor?.('footer', f.refId);
        // SuperDoc crée l'éditeur du pied dans <body> faute d'hôte (avertissement « No editorHost ») :
        // on le sort de l'écran (il reste nécessaire à l'export) et on le retire à la fermeture.
        for (const el of Array.from(document.body.children)) if (!kids.has(el)) stray.add(el as HTMLElement);
        hideStray();
        if (!fe) throw new Error('Pied de page indisponible');
        if (mode === 'n-of-total') {
          fe.commands.insertContent('Page ');
          fe.commands.addAutoPageNumber();
          fe.commands.insertContent(' / ');
          fe.commands.addTotalPageCount();
        } else fe.commands.addAutoPageNumber();
        fe.commands.setTextAlign('center');
        try {
          pres()?.exitActiveStorySurface?.();
        } catch {
          /* pas de session active */
        }
      }
      changed();
      return before;
    },
    async setTitlePage(on) {
      const before = await exportDocx();
      const d = body().doc;
      const s0 = sections()[0];
      if (!s0) return before;
      d.sections.setTitlePage({ target: s0.address, enabled: on });
      // pied de 1re page vide explicite (sinon certains logiciels reprennent le pied courant)
      if (on && !explicitFooter('first')) {
        const f = d.headerFooters.parts.create({ kind: 'footer' });
        d.sections.setHeaderFooterRef({ target: s0.address, kind: 'footer', variant: 'first', refId: f.refId });
      }
      changed();
      return before;
    },
    async applyAcademicLayout() {
      touched = true;
      const before = await exportDocx();
      const TNR = 'Times New Roman';
      const body = styleIdsFor('body');
      const quote = resolveStyleId('quote') ?? 'Quote';
      const defs: Record<string, string> = {};
      for (const id of [...body, quote, 'FootnoteText']) {
        const d = styleDef(id);
        if (d) defs[id] = d;
      }
      const after = await transformStyles(before, (x) => {
        let y = patchStylesXml(x, body, { fontFamily: TNR, fontSize: 12, lineSpacing: 1.5, align: 'both', firstLine: 709 }, defs);
        y = patchStylesXml(y, ['FootnoteText'], { fontFamily: TNR, fontSize: 10, lineSpacing: 1, align: 'both', firstLine: 0 }, defs);
        y = patchStylesXml(y, [quote], { fontSize: 10, lineSpacing: 1, firstLine: 0 }, defs);
        // titres, légendes, sommaire : pas d'alinéa hérité du corps (styles existants seulement)
        y = patchStylesXml(y, ['Title', 'Subtitle', 'Heading1', 'Heading2', 'Heading3', 'Caption', 'TOC1', 'TOC2', 'TOC3', 'ListParagraph'], { firstLine: 0 }, {});
        // titres : même police que le corps (les styles de Word ou de pandoc utilisent souvent la police du thème)
        y = patchStylesXml(y, ['Title', 'Subtitle', 'Heading1', 'Heading2', 'Heading3', 'Heading4', 'Caption'], { fontFamily: TNR }, {});
        return replaceThemeFonts(y, TNR);
      });
      await reload(after);
      for (const it of sections()) body_().doc.sections.setPageMargins({ target: it.address, top: 2.5 / IN, right: 2.5 / IN, bottom: 2.5 / IN, left: 2.5 / IN });
      if (engine.pageSetup().pageNumbers === 'none') await engine.setPageNumbers('n');
      if (!engine.pageSetup().titlePage) await engine.setTitlePage(true);
      changed();
      return before;
    },
    async restore(snapshot) {
      await reload(snapshot);
    },

    // ── Vue ──
    zoom() {
      try {
        return Number(sd.getZoomState?.()?.value ?? sd.getZoom?.() ?? 100);
      } catch {
        return 100;
      }
    },
    setZoom(z) {
      zoomValue = z;
      try {
        if (z === 'fit') sd.setZoomMode?.('fit-width');
        else sd.setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)));
      } catch (e) {
        console.warn(e);
      }
    },
    selectionRect() {
      const ed = body();
      if (!ed || ed.state.selection.empty) return null;
      try {
        const rects: Any[] = pres()?.getSelectionRects?.() ?? [];
        if (!rects.length) return null;
        // coordonnées déjà exprimées dans la fenêtre (vérifié contre les spans peints)
        const r0 = rects[0];
        const same = rects.filter((r) => r.pageIndex === r0.pageIndex);
        const left = Math.min(...same.map((r) => r.left));
        const right = Math.max(...same.map((r) => r.right));
        const top = Math.min(...same.map((r) => r.top));
        const bottom = Math.max(...same.map((r) => r.bottom));
        return new DOMRect(left, top, right - left, bottom - top);
      } catch {
        return null;
      }
    },
    caretBlockRange() {
      const ed = body();
      const sel = ed?.state?.selection;
      if (!sel) return null;
      try {
        const { $from, $to } = sel;
        if ($from.depth < 1 || $to.depth < 1) return null;
        return { from: $from.before(1), to: $to.after(1) };
      } catch {
        return null;
      }
    },
    caretCoords() {
      const ed = body();
      const sel = ed?.state?.selection;
      if (!sel) return null;
      try {
        // coordonnées des pages peintes (déjà dans la fenêtre), pas du ProseMirror caché
        const c: Any = pres()?.coordsAtPos?.(sel.head);
        if (!c || !Number.isFinite(c.top) || !Number.isFinite(c.bottom)) return null;
        return { top: c.top, bottom: c.bottom };
      } catch {
        return null;
      }
    },
    appendParagraph(text) {
      touched = true;
      const ed = body();
      if (!ed) return;
      const S = ed.state.schema;
      const p = S.nodes.paragraph.create({ paragraphProperties: {} }, text ? S.nodes.run.create({}, S.text(text)) : null);
      ed.view.dispatch(ed.state.tr.insert(ed.state.doc.content.size, p));
    },
    undo() {
      touched = true;
      body()?.commands.undo();
    },
    redo() {
      touched = true;
      body()?.commands.redo();
    },
    goTo(pos) {
      const ed = body();
      if (!ed) return;
      const inside = Math.min(pos + 2, ed.state.doc.content.size);
      try {
        ed.commands.setTextSelection({ from: inside, to: inside });
      } catch {
        /* position hors texte */
      }
      const pe = pres();
      if (pe?.scrollToPositionAsync) pe.scrollToPositionAsync(inside, { block: 'start', behavior: 'smooth' });
      else if (pe?.scrollToPosition) pe.scrollToPosition(inside, { block: 'start', behavior: 'smooth' });
      ed.view.focus();
    },
    setEditable(on) {
      try {
        sd.setDocumentMode(on ? 'editing' : 'viewing');
      } catch (e) {
        console.warn(e);
      }
    },
    focus() {
      body()?.view?.focus();
    },
    destroy() {
      destroyed = true;
      for (const ev of INPUT_EVENTS) document.removeEventListener(ev, onUserInput, true);
      try {
        sd.destroy();
      } catch (e) {
        console.warn(e);
      }
      dropStray();
      if (counted) liveEngines--;
      counted = false;
    },
    debugEditor() {
      return { editor: body(), superdoc: sd, stylesXml };
    },

    // ── Notes privées ──
    async togglePrivateNote() {
      touched = true;
      let ed = body();
      if (!ed) return null;
      if (!inPrivateNote(ed.state) && !styleMap().has(PRIVATE_STYLE_ID)) {
        // document venu d'ailleurs : style ajouté d'abord (réouverture, curseur conservé)
        await transformDoc((d) => transformStyles(d, (x) => ensureStylesXml(x, { [PRIVATE_STYLE_ID]: PRIVATE_STYLE_DEF })));
        ed = body();
      }
      const r = togglePrivateNote(ed);
      ed.view.focus();
      return r;
    },
    inPrivateNote() {
      const ed = body();
      return !!ed && inPrivateNote(ed.state);
    },
    privateNoteCount() {
      const ed = body();
      return ed ? privateParagraphs(ed.state.doc).length : 0;
    },
    setPrivateNotesHidden(hidden) {
      const ed = body();
      if (!ed) return;
      silent++;
      try {
        setNotesHidden(ed, hidden);
      } finally {
        silent--;
      }
    },
    stripCopy(ev) {
      const ed = body();
      return !!ed && stripClipboard(ed, ev);
    },

    // ── Plan déplaçable ──
    moveSection(from, target) {
      const ed = body();
      if (!ed) return false;
      touched = true;
      return moveSectionOp(ed, levelOf, from, target) !== null;
    },
    stepSection(dir, pos) {
      const ed = body();
      if (!ed) return false;
      touched = true;
      return stepSection(ed, levelOf, pos ?? ed.state.selection.from, dir, pos !== undefined) !== null;
    },
    docEnd() {
      return body()?.state.doc.content.size ?? 0;
    },
    setProofing(cfg) {
      proofingCfg = cfg;
      applyProofing();
    },
    presentation() {
      return pres();
    },

    // ── Commentaires Word ──
    listComments() {
      const ed = body();
      if (!ed?.doc?.comments) return [];
      const doc = ed.state.doc;
      const anchors = commentAnchors(doc);
      const store = commentStore(ed);
      // ⌘Z dans le texte après une suppression : la marque revient, l'entrée du moteur non → on la remet.
      for (const [id, entries] of deletedComments) {
        if (!anchors.has(id)) continue;
        for (const en of entries) if (!store.some((x) => x.commentId === en.commentId)) store.push({ ...en });
        deletedComments.delete(id);
      }
      let items: Any[] = [];
      try {
        items = ed.doc.comments.list({ includeResolved: true }).items ?? [];
      } catch (e) {
        console.warn('commentaires', e);
        return [];
      }
      const byId = new Map<string, Any>();
      for (const it of items) byId.set(String(it.id ?? it.commentId), it);
      const rootOf = (it: Any): Any => {
        let cur = it;
        const seen = new Set<string>();
        while (cur?.parentCommentId && byId.has(cur.parentCommentId) && !seen.has(cur.parentCommentId)) {
          seen.add(cur.parentCommentId);
          cur = byId.get(cur.parentCommentId);
        }
        return cur;
      };
      const entries = new Map<string, Any>();
      for (const en of store) entries.set(String(en.commentId), en);
      const commentText = (it: Any): string => {
        const t = String(it.text ?? '');
        if (t.includes('\n')) return t;
        const multi = entryText(entries.get(String(it.id ?? it.commentId)));
        return multi && multi.replace(/\n/g, '') === t.replace(/\n/g, '') ? multi : t;
      };
      const out: DocComment[] = [];
      for (const it of items) {
        if (it.trackedChange) continue;
        const id = String(it.id ?? it.commentId);
        const root = rootOf(it);
        const rid = String(root.id ?? root.commentId);
        const a = anchors.get(rid) ?? (root.importedId ? anchors.get(String(root.importedId)) : undefined);
        if (!a) continue; // fil sans passage dans le corps (en-tête, note, ou annulé par ⌘Z)
        const author = String(it.creatorName ?? '').trim();
        out.push({
          id,
          parentId: root === it ? null : String(it.parentCommentId),
          text: commentText(it),
          author: author || 'Auteur inconnu',
          mine: !author || author === COMMENT_AUTHOR,
          createdAt: typeof it.createdTime === 'number' ? it.createdTime : null,
          resolved: (root.status ?? it.status) === 'resolved',
          from: a.from,
          to: a.to,
          quote: doc.textBetween(a.from, a.to, ' ', ' '),
        });
      }
      out.sort((x, y) => x.from - y.from || (x.parentId ? 1 : 0) - (y.parentId ? 1 : 0) || (x.createdAt ?? 0) - (y.createdAt ?? 0));
      return out;
    },
    selectionRange() {
      const ed = body();
      const sel = ed?.state.selection;
      if (!sel || sel.empty) return null;
      const quote = ed.state.doc.textBetween(sel.from, sel.to, ' ', ' ');
      if (!quote.trim()) return null;
      return { from: sel.from, to: sel.to, quote };
    },
    addComment(range, text) {
      const ed = body();
      const t = text.trim();
      if (!ed?.doc?.comments || !t) return null;
      touched = true;
      try {
        const max = ed.state.doc.content.size;
        const target = rangeTarget(ed, Math.max(0, Math.min(range.from, max)), Math.max(0, Math.min(range.to, max)));
        if (!target) return null;
        const r = ed.doc.comments.create({ target, text: t });
        if (!r?.success) return null;
        // curseur à la fin du passage (la sélection ne reste pas affichée sous la bulle)
        const end = Math.min(range.to, ed.state.doc.content.size);
        ed.commands.setTextSelection({ from: end, to: end });
        changed();
        return String(r.id);
      } catch (e) {
        console.error('commentaire', e);
        return null;
      }
    },
    replyComment(parentId, text) {
      const ed = body();
      const t = text.trim();
      if (!ed?.doc?.comments || !t) return null;
      touched = true;
      try {
        const r = ed.doc.comments.create({ parentCommentId: parentId, text: t });
        if (!r?.success) return null;
        changed();
        return String(r.id);
      } catch (e) {
        console.error('réponse', e);
        return null;
      }
    },
    editComment(id, text) {
      const ed = body();
      const t = text.trim();
      if (!ed?.doc?.comments || !t) return false;
      touched = true;
      try {
        const r = ed.doc.comments.patch({ commentId: id, text: t });
        changed();
        return r?.success !== false;
      } catch (e) {
        console.error('commentaire', e);
        return false;
      }
    },
    setCommentResolved(id, resolved) {
      const ed = body();
      if (!ed?.doc?.comments) return false;
      touched = true;
      try {
        const r = ed.doc.comments.patch({ commentId: id, status: resolved ? 'resolved' : 'active' });
        changed();
        return r?.success !== false;
      } catch (e) {
        console.error('commentaire', e);
        return false;
      }
    },
    deleteComment(id) {
      const ed = body();
      if (!ed?.doc?.comments) return null;
      const doc = ed.state.doc;
      const a = commentAnchors(doc).get(id);
      const store = commentStore(ed);
      const entries = commentTree(store, id).map((e) => JSON.parse(JSON.stringify(e)));
      const reply = !!entries.find((e: Any) => e.commentId === id)?.parentCommentId;
      let resolved = false;
      try {
        resolved = ed.doc.comments.get({ commentId: id })?.status === 'resolved';
      } catch {
        /* inconnu */
      }
      touched = true;
      try {
        const r = ed.doc.comments.delete({ commentId: id });
        if (r?.success === false) return null;
      } catch (e) {
        console.error('commentaire', e);
        return null;
      }
      // entrées encore présentes (réponses orphelines) : retirées aussi
      const gone = new Set(entries.map((e: Any) => e.commentId));
      const left = store.filter((e) => !gone.has(e.commentId));
      if (left.length !== store.length) store.splice(0, store.length, ...left);
      if (!reply) deletedComments.set(id, entries);
      changed();
      return { id, from: a?.from ?? 0, to: a?.to ?? 0, quote: a ? doc.textBetween(a.from, a.to, ' ', ' ') : '', resolved, reply, entries };
    },
    restoreComment(snap) {
      const ed = body();
      if (!ed) return false;
      const doc = ed.state.doc;
      const entries = snap.entries as Any[];
      if (!snap.reply && !commentAnchors(doc).has(snap.id)) {
        // passage : à sa place si le texte n'a pas bougé, sinon l'occurrence la plus proche
        let from = -1;
        if (snap.to > snap.from && snap.to <= doc.content.size && doc.textBetween(snap.from, snap.to, ' ', ' ') === snap.quote) from = snap.from;
        else if (snap.quote) {
          const hits: number[] = [];
          doc.descendants((n: Any, pos: number) => {
            if (!n.isTextblock) return true;
            const txt = doc.textBetween(pos + 1, pos + n.nodeSize - 1, ' ', ' ');
            let i = txt.indexOf(snap.quote);
            while (i >= 0) {
              // position du caractère i dans le bloc (texte d'un seul tenant en général)
              let acc = 0;
              let found = -1;
              n.descendants((c: Any, p: number) => {
                if (found >= 0) return false;
                if (c.isText) {
                  if (i < acc + c.text.length) found = pos + 1 + p + (i - acc);
                  acc += c.text.length;
                }
                return true;
              });
              if (found >= 0) hits.push(found);
              i = txt.indexOf(snap.quote, i + 1);
            }
            return false;
          });
          hits.sort((x, y) => Math.abs(x - snap.from) - Math.abs(y - snap.from));
          from = hits[0] ?? -1;
        }
        const mark = ed.state.schema.marks.commentMark;
        if (from < 0 || !mark) return false;
        const to = Math.min(doc.content.size, from + (snap.to - snap.from));
        const root = entries.find((e) => e.commentId === snap.id) ?? {};
        touched = true;
        ed.view.dispatch(ed.state.tr.addMark(from, to, mark.create({ commentId: snap.id, importedId: root.importedId ?? null, internal: false, trackedChange: false })));
      }
      const store = commentStore(ed);
      for (const en of entries) if (!store.some((x) => x.commentId === en.commentId)) store.push({ ...en });
      deletedComments.delete(snap.id);
      if (snap.resolved && !snap.reply) {
        try {
          ed.doc.comments.patch({ commentId: snap.id, status: 'resolved' });
        } catch {
          /* reste ouvert */
        }
      }
      changed();
      return true;
    },
    rangeRects(from, to) {
      try {
        // bornes ramenées au texte : posées entre deux runs (passage d'un fil résolu, entre
        // commentRangeStart/End), elles donneraient des rectangles de lignes entières
        const ed = body();
        if (ed) {
          let a = -1;
          let b = -1;
          ed.state.doc.nodesBetween(from, to, (n: Any, pos: number) => {
            if (!n.isText) return true;
            const s = Math.max(from, pos);
            const e = Math.min(to, pos + n.nodeSize);
            if (e > s) {
              if (a < 0) a = s;
              b = e;
            }
            return false;
          });
          if (a >= 0 && b > a) {
            from = a;
            to = b;
          }
        }
        const rects: Any[] = pres()?.getRangeRects?.(from, to) ?? [];
        return rects.filter((r) => Number.isFinite(r?.top) && Number.isFinite(r?.left)).map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
      } catch {
        return [];
      }
    },
    caretTo(pos) {
      const ed = body();
      if (!ed) return;
      const p = Math.max(1, Math.min(pos, ed.state.doc.content.size - 1));
      try {
        ed.commands.setTextSelection({ from: p, to: p });
      } catch {
        /* position hors texte */
      }
    },
  };
  return engine;
}
