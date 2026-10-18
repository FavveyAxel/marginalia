// Format de partage « .marginalia » : une archive ZIP qui transporte une partie de la bibliothèque
// (un espace de travail entier, ou une liste libre d'éléments) vers une autre Marginalia.
//
//   manifest.json   { format: 'marginalia-share', v: 1, createdAt, appVersion?, title, scope, shareId,
//                     counts, booksIncluded, books: [{ id, sha256, size, title, … }], integrity }
//   data.json       les objets de la base concernés, avec les ids de l'expéditeur (voir ShareData)
//   files/<ownerId>/<fileName>   fichiers joints : .docx des écrits ; fichiers des livres (et texte
//                   reconnu des photos) seulement si on a choisi de joindre les livres
//
// Ce module construit le paquet (buildSharePackage) et le relit en le validant (openSharePackage,
// readSharePackage pour l'aperçu). L'import, qui AJOUTE sans rien écraser, est dans shareMerge.ts.
// Rien ne quitte l'ordinateur ici : on produit et on lit des octets ; le transport est ailleurs.
//
// Ce qui suit un élément partagé (ses dépendances) : le livre (métadonnées) de chaque extrait, les
// concepts des extraits, les extraits cités par les cartes, arguments, plans, cartes de révision et
// écrits (signets `_mglHl_<id>` du .docx), les cartes des mouvements d'une fiche-texte, les cartes
// vers lesquelles mène un portail. Un livre partagé en entier emporte tous ses extraits et sa carte.
// Ne partent jamais : les signets de lecture, la position de lecture, les versions des écrits, le
// chemin d'origine d'un écrit sur le disque, l'état de révision des cartes (elles repartent de zéro),
// les notes privées des écrits (retirées du .docx comme à tout export).
import JSZip from 'jszip';
import { host } from '../../lib/platform';
import { useStore, type State } from '../../lib/store';
import type {
  ArgumentMap,
  ArgumentReconstruction,
  Book,
  BookFormat,
  Concept,
  Draft,
  EssayPlan,
  Highlight,
  PlanNode,
  ReviewCard,
  TextStudy,
  Workspace,
  WorkspaceGroup,
  WorkspaceItem,
} from '../../lib/types';
import { CITE_BOOKMARK_PREFIX, hasPrivateNotes, stripForExport } from '../editor/privateNotes';
import { newFsrs } from '../revision/fsrs';

export const SHARE_FORMAT = 'marginalia-share';
export const SHARE_VERSION = 1;
/** Extension des fichiers de partage. */
export const SHARE_EXTENSION = 'marginalia';

// Limites de lecture : au-delà, le paquet est refusé avant d'être décompressé (archive piégée).
const MAX_PACKAGE_BYTES = 1024 ** 3; // 1 Go compressé
const MAX_UNPACKED_BYTES = 2 * 1024 ** 3; // 2 Go décompressés
const MAX_DATA_BYTES = 200 * 1024 ** 2; // data.json : 200 Mo
const MAX_ENTRIES = 20000;

/** Nom de fichier ou id utilisable comme élément de chemin (ni « .. », ni séparateur, ni chemin absolu). */
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
export const isSafeSegment = (s: unknown): s is string => typeof s === 'string' && SAFE_SEGMENT.test(s) && !s.includes('..');

/** Document de photos : pages dans `pages` (champ ajouté par les documents de photos, facultatif). */
type BookWithPages = Book & { pages?: string[] };

// ── Types publics ────────────────────────────────────────────

/** Ce que l'on partage : un espace entier, ou une liste libre d'ids (livres, extraits, écrits, cartes…). */
export type ShareSelection =
  | { kind: 'workspace'; workspaceId: string }
  /**
   * `ids` : livres (partagés en entier), extraits, concepts, arguments, fiches-texte, plans, écrits, cartes
   * de révision, clés de cartes ; l'id d'un espace y apporte son contenu (sans l'espace ni ses groupes).
   */
  | { kind: 'items'; ids: string[]; title?: string };

export interface ShareCounts {
  books: number;
  /** Livres dont le fichier est joint. */
  booksWithFile: number;
  highlights: number;
  concepts: number;
  maps: number;
  arguments: number;
  studies: number;
  plans: number;
  drafts: number;
  cards: number;
  workspaces: number;
  groups: number;
}

/** Livre décrit dans le manifeste (reconnu chez le destinataire par son empreinte). */
export interface ShareBookEntry {
  id: string;
  /** SHA-256 (hex) du fichier source ; document de photos : de la liste des empreintes des pages. null : fichier illisible chez l'expéditeur. */
  sha256: string | null;
  /** Taille du fichier source (somme des pages pour un document de photos). */
  size: number;
  title: string;
  author: string;
  format: BookFormat;
  /** Fichier joint au paquet. */
  included: boolean;
}

export interface ShareManifest {
  format: typeof SHARE_FORMAT;
  v: number;
  createdAt: number;
  appVersion?: string;
  title: string;
  scope: 'workspace' | 'items';
  /**
   * Identifiant de partage stable : le même pour chaque envoi du même espace (« ws-<id> ») ou de la
   * même liste (« sel-<empreinte des ids> »). Repris dans `shareOrigin` des éléments importés.
   */
  shareId: string;
  counts: ShareCounts;
  booksIncluded: boolean;
  books: ShareBookEntry[];
  /** Empreintes SHA-256 de data.json et de chaque fichier joint : un paquet modifié est refusé. */
  integrity: { data: string; files: Record<string, string> };
}

/** Contenu de data.json : les objets de la base, ids de l'expéditeur. */
export interface ShareData {
  books: Book[];
  highlights: Highlight[];
  concepts: Concept[];
  /** Clé (chez l'expéditeur) → carte. */
  maps: Record<string, ArgumentMap>;
  arguments: ArgumentReconstruction[];
  studies: TextStudy[];
  plans: EssayPlan[];
  drafts: Draft[];
  cards: ReviewCard[];
  workspaces: Workspace[];
  groups: WorkspaceGroup[];
  wsItems: WorkspaceItem[];
}

export interface ShareSummary {
  title: string;
  scope: 'workspace' | 'items';
  shareId: string;
  counts: ShareCounts;
  booksIncluded: boolean;
  /** Taille du paquet (octets). */
  size: number;
  /** Notes privées retirées des écrits (jamais partagées). */
  privateNotesRemoved: number;
  /** Ce qui n'a pas pu partir, en clair (fichier introuvable…). */
  skipped: string[];
}

/** Aperçu lisible d'un paquet reçu, avant import. */
export interface SharePreview {
  title: string;
  scope: 'workspace' | 'items';
  shareId: string;
  createdAt: number;
  appVersion: string | null;
  counts: ShareCounts;
  booksIncluded: boolean;
  books: {
    id: string;
    title: string;
    author: string;
    size: number;
    /** Fichier joint au paquet. */
    included: boolean;
    /** Même livre déjà dans cette bibliothèque (même empreinte) : ses extraits s'y rattacheront. */
    local: { id: string; title: string; missing: boolean } | null;
  }[];
  /** Livres déjà présents ici (aucun doublon ne sera créé). */
  booksHere: number;
  /** Livres ni présents ici ni joints : ils arriveront sans fichier (extraits lisibles, livre non ouvrable). */
  booksWithoutFile: number;
  /** Des éléments de ce même partage ont déjà été reçus : un nouvel import en crée de nouvelles copies. */
  alreadyReceived: boolean;
  /** Phrase de résumé (« 2 écrits, 1 carte, 14 extraits, 1 livre joint »). */
  sentence: string;
}

export type ShareErrorCode = 'empty' | 'missing' | 'not-share' | 'version' | 'too-big' | 'unsafe' | 'damaged' | 'invalid' | 'not-ready' | 'write';

/** Erreur du partage : `message` est prêt à être montré tel quel. */
export class ShareError extends Error {
  constructor(
    readonly code: ShareErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ShareError';
  }
}

const ERR = {
  notShare: () => new ShareError('not-share', 'Ce fichier n’est pas un partage Marginalia (« .marginalia ») : il ne peut pas être ouvert.'),
  version: () => new ShareError('version', 'Ce partage vient d’une version plus récente de Marginalia : mettez l’application à jour pour l’ouvrir.'),
  tooBig: () => new ShareError('too-big', 'Ce partage est trop volumineux pour être ouvert (plus de 1 Go, ou trop de fichiers).'),
  unsafe: () => new ShareError('unsafe', 'Ce partage contient des noms de fichiers non autorisés (chemin absolu ou « .. ») : il a été refusé.'),
  damaged: () => new ShareError('damaged', 'Ce partage est abîmé ou a été modifié après sa création : il a été refusé, rien n’a été importé.'),
  invalid: () => new ShareError('invalid', 'Le contenu de ce partage est incomplet ou illisible : il a été refusé, rien n’a été importé.'),
};

// ── Empreintes ───────────────────────────────────────────────

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

/** Fichiers source d'un livre : les pages d'un document de photos, sinon son fichier. */
export function bookSourceFiles(b: Book): string[] {
  const pages = (b as BookWithPages).pages;
  return Array.isArray(pages) && pages.length > 1 ? pages : [b.fileName];
}

/** Fichiers dérivés joints avec un livre s'ils existent : texte reconnu des photos (ocr.json, ocr-p2.json…). */
export function bookExtraFiles(b: Book): string[] {
  if (b.format !== 'image') return [];
  const n = bookSourceFiles(b).length;
  return ['ocr.json', ...Array.from({ length: n - 1 }, (_, i) => `ocr-p${i + 2}.json`)];
}

/** Empreinte d'un livre d'après le contenu de ses fichiers source (une page : son SHA-256 ; plusieurs : celui de la liste). */
async function fingerprintOf(datas: ArrayBuffer[]): Promise<{ sha256: string; size: number }> {
  const size = datas.reduce((n, d) => n + d.byteLength, 0);
  if (datas.length === 1) return { sha256: await sha256Hex(datas[0]), size };
  const each = await Promise.all(datas.map((d) => sha256Hex(d)));
  return { sha256: await sha256Hex(each.join('\n')), size };
}

// Empreintes calculées pendant la session (un livre ne change pas de fichier sans changer de nom).
const fpCache = new Map<string, Promise<{ sha256: string; size: number } | null>>();
const fpKey = (b: Book) => `${b.id}|${bookSourceFiles(b).join('/')}|${b.size}`;

/** Empreinte d'un livre de la bibliothèque (lue à la demande, gardée en mémoire) ; null si le fichier est illisible. */
export function bookFingerprint(b: Book): Promise<{ sha256: string; size: number } | null> {
  if (b.missing) return Promise.resolve(b.sourceSha256 ? { sha256: b.sourceSha256, size: b.size } : null);
  const key = fpKey(b);
  let p = fpCache.get(key);
  if (!p) {
    p = (async () => {
      try {
        return await fingerprintOf(await Promise.all(bookSourceFiles(b).map((f) => host.readFile(b.id, f))));
      } catch {
        fpCache.delete(key); // fichier momentanément illisible : on retentera
        return null;
      }
    })();
    fpCache.set(key, p);
  }
  return p;
}

/**
 * Livre de cette bibliothèque identique à un livre du paquet : même empreinte notée (livre déjà reçu),
 * sinon même taille puis même SHA-256 du fichier (calculé seulement pour les livres de même taille).
 * Un livre avec son fichier est préféré à une entrée « sans fichier ».
 */
export async function findLocalBook(entry: { sha256: string | null; size: number }, books: Book[]): Promise<Book | null> {
  if (!entry.sha256) return null;
  const noted = books.filter((b) => b.sourceSha256 === entry.sha256);
  const withFile = noted.find((b) => !b.missing);
  if (withFile) return withFile;
  for (const b of books) {
    if (b.missing || b.size !== entry.size || noted.includes(b)) continue;
    const fp = await bookFingerprint(b);
    if (fp?.sha256 === entry.sha256) return b;
  }
  return noted[0] ?? null;
}

// ── Écrits : signets de citation et notes privées ────────────

const CITE_RE = new RegExp(`${CITE_BOOKMARK_PREFIX}([A-Za-z0-9_-]+)`, 'g');
/** Préfixe provisoire : protège les signets de citation pendant le retrait des notes privées. */
const CITE_SHIELD = '_mglShHl_';

/** Applique `fn` au XML des parties du .docx (word/*.xml) ; octets d'origine si rien ne change. */
export async function rewriteDocxXml(data: ArrayBuffer, fn: (xml: string) => string): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(data);
  let changed = false;
  for (const f of Object.values(zip.files)) {
    if (f.dir || !/^word\/[^/]+\.xml$/.test(f.name)) continue;
    const xml = await f.async('string');
    const next = fn(xml);
    if (next !== xml) {
      zip.file(f.name, next);
      changed = true;
    }
  }
  if (!changed) return data;
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/** Extraits cités par un écrit (signets `_mglHl_<id>`). */
export async function citedHighlightIds(data: ArrayBuffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(data);
  const ids = new Set<string>();
  for (const f of Object.values(zip.files)) {
    if (f.dir || !/^word\/[^/]+\.xml$/.test(f.name)) continue;
    for (const m of (await f.async('string')).matchAll(CITE_RE)) ids.add(m[1]);
  }
  return [...ids];
}

/** Copie partageable d'un écrit : sans notes privées (ni leurs notes de bas de page), citations gardées. */
async function shareableDocx(data: ArrayBuffer): Promise<{ data: ArrayBuffer; removed: number }> {
  if (!(await hasPrivateNotes(data))) return { data, removed: 0 };
  // stripForExport retire aussi les signets de citation : on les renomme le temps du nettoyage.
  const shielded = await rewriteDocxXml(data, (x) => x.split(CITE_BOOKMARK_PREFIX).join(CITE_SHIELD));
  const stripped = await stripForExport(shielded);
  const back = await rewriteDocxXml(stripped.data, (x) => x.split(CITE_SHIELD).join(CITE_BOOKMARK_PREFIX));
  return { data: back, removed: stripped.removed };
}

// ── Construction du paquet ───────────────────────────────────

/** Ensemble des ids retenus, par collection. */
interface Picked {
  wholeBooks: Set<string>;
  books: Set<string>;
  highlights: Set<string>;
  concepts: Set<string>;
  maps: Set<string>;
  arguments: Set<string>;
  studies: Set<string>;
  plans: Set<string>;
  drafts: Set<string>;
  cards: Set<string>;
}

const emptyPicked = (): Picked => ({
  wholeBooks: new Set(),
  books: new Set(),
  highlights: new Set(),
  concepts: new Set(),
  maps: new Set(),
  arguments: new Set(),
  studies: new Set(),
  plans: new Set(),
  drafts: new Set(),
  cards: new Set(),
});

const sizeOf = (p: Picked) => Object.values(p).reduce((n, s: Set<string>) => n + s.size, 0);

function planRefs(nodes: PlanNode[], out: { kind: string; id: string }[] = []) {
  for (const n of nodes) {
    for (const it of n.items) if (it.ref.kind !== 'text') out.push({ kind: it.ref.kind, id: it.ref.id });
    planRefs(n.children, out);
  }
  return out;
}

/** Ajoute à `p` tout ce dont les éléments retenus dépendent (point fixe). */
function closeDependencies(s: State, p: Picked, cites: Map<string, string[]>) {
  const hl = new Map(s.highlights.map((h) => [h.id, h]));
  const has = {
    book: new Set(s.books.map((b) => b.id)),
    concept: new Set(s.concepts.map((c) => c.id)),
    argument: new Set(s.arguments.map((a) => a.id)),
    study: new Set(s.studies.map((x) => x.id)),
  };
  const addIf = (set: Set<string>, ok: boolean, id: string | null | undefined) => {
    if (id && ok) set.add(id);
  };
  const hlOfBook = new Map<string, string[]>();
  for (const h of s.highlights) {
    const list = hlOfBook.get(h.bookId);
    if (list) list.push(h.id);
    else hlOfBook.set(h.bookId, [h.id]);
  }
  let before = -1;
  while (before !== sizeOf(p)) {
    before = sizeOf(p);
    for (const id of p.wholeBooks) {
      p.books.add(id);
      for (const h of hlOfBook.get(id) ?? []) p.highlights.add(h);
      if (Object.hasOwn(s.maps, id)) p.maps.add(id);
    }
    for (const id of p.highlights) {
      const h = hl.get(id);
      if (!h) continue;
      addIf(p.books, has.book.has(h.bookId), h.bookId);
      for (const c of h.conceptIds) addIf(p.concepts, has.concept.has(c), c);
    }
    for (const key of p.maps) {
      const m = s.maps[key];
      if (!m) continue;
      const kind = m.kind ?? 'book';
      if (kind === 'book') addIf(p.books, has.book.has(key), key);
      if (kind === 'movement') addIf(p.studies, has.study.has(m.studyId ?? ''), m.studyId);
      addIf(p.books, has.book.has(m.bookId), m.bookId);
      for (const b of m.bookIds ?? []) addIf(p.books, has.book.has(b), b);
      for (const n of m.nodes) {
        addIf(p.highlights, hl.has(n.highlightId ?? ''), n.highlightId);
        addIf(p.concepts, has.concept.has(n.conceptId ?? ''), n.conceptId);
        addIf(p.maps, !!n.portal && Object.hasOwn(s.maps, n.portal), n.portal);
      }
    }
    for (const a of s.arguments) {
      if (!p.arguments.has(a.id)) continue;
      addIf(p.books, has.book.has(a.bookId ?? ''), a.bookId);
      for (const st of [...a.premises, a.conclusion]) addIf(p.highlights, hl.has(st.highlightId ?? ''), st.highlightId);
    }
    for (const x of s.studies) {
      if (!p.studies.has(x.id)) continue;
      addIf(p.books, has.book.has(x.bookId), x.bookId);
      // Les cartes des mouvements font partie de la fiche.
      for (const [k, m] of Object.entries(s.maps)) if (m.kind === 'movement' && m.studyId === x.id) p.maps.add(k);
    }
    for (const pl of s.plans) {
      if (!p.plans.has(pl.id)) continue;
      for (const r of planRefs(pl.parts)) {
        if (r.kind === 'highlight') addIf(p.highlights, hl.has(r.id), r.id);
        if (r.kind === 'concept') addIf(p.concepts, has.concept.has(r.id), r.id);
        if (r.kind === 'argument') addIf(p.arguments, has.argument.has(r.id), r.id);
      }
    }
    for (const id of p.drafts) for (const h of cites.get(id) ?? []) addIf(p.highlights, hl.has(h), h);
    for (const c of s.cards) {
      if (!p.cards.has(c.id)) continue;
      addIf(p.highlights, hl.has(c.highlightId ?? ''), c.highlightId);
      addIf(p.concepts, has.concept.has(c.conceptId ?? ''), c.conceptId);
      addIf(p.books, has.book.has(c.bookId ?? ''), c.bookId);
    }
  }
  // Cartes de révision liées : celles des extraits partagés, des concepts partagés (carte de définition)
  // et des livres partagés en entier, dès que tout ce qu'elles citent part aussi.
  for (const c of s.cards) {
    if (p.cards.has(c.id)) continue;
    const refsOk = (!c.highlightId || p.highlights.has(c.highlightId)) && (!c.conceptId || p.concepts.has(c.conceptId)) && (!c.bookId || p.books.has(c.bookId));
    const linked = (!!c.highlightId && p.highlights.has(c.highlightId)) || (!c.highlightId && !!c.conceptId && p.concepts.has(c.conceptId)) || (!c.highlightId && !c.conceptId && !!c.bookId && p.wholeBooks.has(c.bookId));
    if (refsOk && linked) p.cards.add(c.id);
  }
}

/** Retient les éléments d'un espace (références de ses groupes et sous-groupes). */
function pickWorkspace(s: State, wsId: string, p: Picked) {
  for (const it of s.wsItems) {
    if (it.workspaceId !== wsId) continue;
    pickRef(s, it.kind, it.refId, p);
  }
}

function pickRef(s: State, kind: WorkspaceItem['kind'], id: string, p: Picked) {
  if (kind === 'book' && s.books.some((b) => b.id === id)) p.wholeBooks.add(id);
  else if (kind === 'draft' && s.drafts.some((d) => d.id === id)) p.drafts.add(id);
  else if (kind === 'plan' && s.plans.some((x) => x.id === id)) p.plans.add(id);
  else if (kind === 'argument' && s.arguments.some((x) => x.id === id)) p.arguments.add(id);
  else if (kind === 'study' && s.studies.some((x) => x.id === id)) p.studies.add(id);
  else if (kind === 'map' && Object.hasOwn(s.maps, id)) p.maps.add(id);
}

/** Id quelconque → collection (liste libre). Renvoie false s'il est inconnu. */
function pickAny(s: State, id: string, p: Picked): boolean {
  if (s.books.some((b) => b.id === id)) p.wholeBooks.add(id);
  else if (s.highlights.some((h) => h.id === id)) p.highlights.add(id);
  else if (s.concepts.some((c) => c.id === id)) p.concepts.add(id);
  else if (s.arguments.some((a) => a.id === id)) p.arguments.add(id);
  else if (s.studies.some((x) => x.id === id)) p.studies.add(id);
  else if (s.plans.some((x) => x.id === id)) p.plans.add(id);
  else if (s.drafts.some((d) => d.id === id)) p.drafts.add(id);
  else if (s.cards.some((c) => c.id === id)) p.cards.add(id);
  else if (Object.hasOwn(s.maps, id)) p.maps.add(id);
  else if (s.workspaces.some((w) => w.id === id)) pickWorkspace(s, id, p);
  else return false;
  return true;
}

const countsOf = (d: ShareData, booksWithFile: number): ShareCounts => ({
  books: d.books.length,
  booksWithFile,
  highlights: d.highlights.length,
  concepts: d.concepts.length,
  maps: Object.keys(d.maps).length,
  arguments: d.arguments.length,
  studies: d.studies.length,
  plans: d.plans.length,
  drafts: d.drafts.length,
  cards: d.cards.length,
  workspaces: d.workspaces.length,
  groups: d.groups.length,
});

/** Titre d'un élément isolé (liste libre d'un seul élément). */
function titleOfId(s: State, id: string): string | null {
  return (
    s.books.find((b) => b.id === id)?.title ??
    s.drafts.find((d) => d.id === id)?.title ??
    s.plans.find((x) => x.id === id)?.title ??
    s.arguments.find((x) => x.id === id)?.title ??
    s.studies.find((x) => x.id === id)?.title ??
    s.concepts.find((c) => c.id === id)?.name ??
    (Object.hasOwn(s.maps, id) ? (s.maps[id].title ?? null) : null)
  );
}

/**
 * Construit le paquet de partage d'une sélection. `includeBooks` : joindre les fichiers des livres
 * (sinon seulement leurs métadonnées et l'empreinte SHA-256 du fichier, pour les reconnaître).
 * Ne modifie rien dans la base.
 */
export async function buildSharePackage(sel: ShareSelection, opts: { includeBooks: boolean }): Promise<{ bytes: Uint8Array; summary: ShareSummary }> {
  const s = useStore.getState();
  const skipped: string[] = [];
  const p = emptyPicked();
  let ws: Workspace | null = null;
  let title: string;
  let shareId: string;
  if (sel.kind === 'workspace') {
    ws = s.workspaces.find((w) => w.id === sel.workspaceId) ?? null;
    if (!ws) throw new ShareError('missing', 'Cet espace de travail n’existe plus : il ne peut pas être partagé.');
    pickWorkspace(s, ws.id, p);
    title = ws.name;
    // Un espace lui-même reçu garde l'identifiant de son partage d'origine.
    shareId = ws.shareOrigin?.shareId ?? `ws-${ws.id}`;
  } else {
    const ids = [...new Set(sel.ids)];
    let unknown = 0;
    for (const id of ids) if (!pickAny(s, id, p)) unknown++;
    if (unknown) skipped.push(unknown === 1 ? '1 élément introuvable' : `${unknown} éléments introuvables`);
    title = sel.title?.trim() || (ids.length === 1 ? titleOfId(s, ids[0]) : null) || `Sélection de ${ids.length} éléments`;
    shareId = `sel-${(await sha256Hex([...ids].sort().join('\n'))).slice(0, 24)}`;
  }
  if (!sizeOf(p) && !(ws && s.groups.some((g) => g.workspaceId === ws!.id))) throw new ShareError('empty', 'Rien à partager : la sélection est vide.');

  // Écrits : leur .docx (sans notes privées) et les extraits qu'ils citent.
  const draftFiles = new Map<string, ArrayBuffer>();
  const cites = new Map<string, string[]>();
  let privateNotesRemoved = 0;
  for (const id of [...p.drafts]) {
    const d = s.drafts.find((x) => x.id === id)!;
    try {
      const shared = await shareableDocx(await host.readFile(d.id, d.fileName));
      privateNotesRemoved += shared.removed;
      draftFiles.set(id, shared.data);
      cites.set(id, await citedHighlightIds(shared.data));
    } catch (e) {
      console.warn('partage : écrit illisible', d.title, e);
      p.drafts.delete(id);
      skipped.push(`Écrit « ${d.title} » : fichier introuvable, non partagé`);
    }
  }

  closeDependencies(s, p, cites);

  // ── data.json ──
  const inSet = <T extends { id: string }>(arr: T[], set: Set<string>) => arr.filter((x) => set.has(x.id));
  const books = inSet(s.books, p.books).map((b) => ({ ...b, position: null, progress: 0, lastOpenedAt: null }));
  const highlights = inSet(s.highlights, p.highlights).map(({ source: _source, ...h }) => h as Highlight);
  const concepts = inSet(s.concepts, p.concepts).map((c) => ({
    ...c,
    links: c.links.filter((l) => p.concepts.has(l.conceptId)),
    senses: c.senses.map((se) => ({ ...se, bookId: se.bookId && p.books.has(se.bookId) ? se.bookId : null, highlightIds: se.highlightIds.filter((h) => p.highlights.has(h)) })),
  }));
  const maps: Record<string, ArgumentMap> = {};
  for (const key of p.maps) {
    const m = s.maps[key];
    if (!m) continue;
    maps[key] = {
      ...m,
      nodes: m.nodes.map((n) => {
        if (!n.from || p.maps.has(n.from.mapKey)) return n;
        const { from: _from, ...rest } = n;
        return rest;
      }),
    };
  }
  const data: ShareData = {
    books,
    highlights,
    concepts,
    maps,
    arguments: inSet(s.arguments, p.arguments),
    studies: inSet(s.studies, p.studies),
    plans: inSet(s.plans, p.plans).map((x) => ({ ...x, draftId: x.draftId && p.drafts.has(x.draftId) ? x.draftId : null })),
    drafts: inSet(s.drafts, p.drafts).map(({ versions: _v, ...d }) => ({ ...d, externalPath: null }) as Draft),
    cards: inSet(s.cards, p.cards).map((c) => ({ ...c, fsrs: newFsrs() })),
    workspaces: ws ? [ws] : [],
    groups: ws ? s.groups.filter((g) => g.workspaceId === ws!.id) : [],
    wsItems: [],
  };
  if (ws) {
    const keep = (it: WorkspaceItem) =>
      it.kind === 'book' ? p.books.has(it.refId) : it.kind === 'map' ? p.maps.has(it.refId) : it.kind === 'draft' ? p.drafts.has(it.refId) : it.kind === 'plan' ? p.plans.has(it.refId) : it.kind === 'argument' ? p.arguments.has(it.refId) : p.studies.has(it.refId);
    data.wsItems = s.wsItems.filter((it) => it.workspaceId === ws!.id && keep(it));
  }

  // ── Fichiers et empreintes ──
  const files: { path: string; data: ArrayBuffer }[] = [];
  const entries: ShareBookEntry[] = [];
  for (const b of books) {
    const entry: ShareBookEntry = { id: b.id, sha256: null, size: b.size, title: b.title, author: b.author, format: b.format, included: false };
    entries.push(entry);
    if (b.missing) {
      // Livre lui-même reçu sans fichier : on transmet l'empreinte notée.
      entry.sha256 = b.sourceSha256 ?? null;
      continue;
    }
    if (!opts.includeBooks) {
      const fp = await bookFingerprint(b);
      if (fp) Object.assign(entry, fp);
      else skipped.push(`Livre « ${b.title} » : fichier introuvable, empreinte non calculée`);
      continue;
    }
    try {
      const names = bookSourceFiles(b);
      const datas = await Promise.all(names.map((f) => host.readFile(b.id, f)));
      Object.assign(entry, await fingerprintOf(datas), { included: true });
      names.forEach((f, i) => files.push({ path: `files/${b.id}/${f}`, data: datas[i] }));
      for (const f of bookExtraFiles(b)) {
        const extra = await host.readFile(b.id, f).catch(() => null);
        if (extra) files.push({ path: `files/${b.id}/${f}`, data: extra });
      }
    } catch (e) {
      console.warn('partage : livre illisible', b.title, e);
      skipped.push(`Livre « ${b.title} » : fichier introuvable, non joint`);
    }
  }
  for (const d of data.drafts) files.push({ path: `files/${d.id}/${d.fileName}`, data: draftFiles.get(d.id)! });

  const dataJson = JSON.stringify(data);
  const integrity: ShareManifest['integrity'] = { data: await sha256Hex(dataJson), files: {} };
  for (const f of files) integrity.files[f.path] = await sha256Hex(f.data);
  const booksWithFile = entries.filter((e) => e.included).length;
  const appVersion = await host.updates?.version().catch(() => undefined);
  const manifest: ShareManifest = {
    format: SHARE_FORMAT,
    v: SHARE_VERSION,
    createdAt: Date.now(),
    ...(appVersion ? { appVersion } : {}),
    title,
    scope: sel.kind,
    shareId,
    counts: countsOf(data, booksWithFile),
    booksIncluded: opts.includeBooks && booksWithFile > 0,
    books: entries,
    integrity,
  };

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2), { createFolders: false });
  zip.file('data.json', dataJson, { createFolders: false });
  for (const f of files) zip.file(f.path, f.data, { binary: true, createFolders: false });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return {
    bytes,
    summary: { title, scope: sel.kind, shareId, counts: manifest.counts, booksIncluded: manifest.booksIncluded, size: bytes.byteLength, privateNotesRemoved, skipped },
  };
}

// ── Lecture et validation ────────────────────────────────────

/** Paquet ouvert et validé : manifeste, données, fichiers joints (chemin → octets). */
export interface OpenedShare {
  manifest: ShareManifest;
  data: ShareData;
  files: Map<string, Uint8Array>;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isId = (x: unknown): x is string => isStr(x) && x.length > 0 && x.length <= 200;
const isOptId = (x: unknown) => x == null || isId(x);
const FORMATS: BookFormat[] = ['epub', 'pdf', 'docx', 'md', 'txt', 'html', 'image'];

/** Nom d'entrée de l'archive acceptable : manifest.json, data.json ou files/<id>/<fichier>. */
function safeEntryName(name: string, dir: boolean): boolean {
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') || /^[a-z]:/i.test(name)) return false;
  const parts = name.replace(/\/$/, '').split('/');
  if (parts.some((x) => x === '' || x === '.' || x === '..')) return false;
  if (dir) return parts[0] === 'files' && parts.length <= 2 && parts.slice(1).every(isSafeSegment);
  if (parts.length === 1) return name === 'manifest.json' || name === 'data.json';
  return parts.length === 3 && parts[0] === 'files' && isSafeSegment(parts[1]) && isSafeSegment(parts[2]);
}

/** Vérifie la forme de data.json ; renvoie les données complétées (collections absentes : vides). */
function validateData(raw: unknown): ShareData | null {
  if (!isObj(raw)) return null;
  const arr = (k: string) => (raw[k] === undefined ? [] : Array.isArray(raw[k]) ? (raw[k] as unknown[]) : null);
  const cols = ['books', 'highlights', 'concepts', 'arguments', 'studies', 'plans', 'drafts', 'cards', 'workspaces', 'groups', 'wsItems'] as const;
  const out: Record<string, unknown[]> = {};
  for (const k of cols) {
    const a = arr(k);
    if (!a || !a.every((x) => isObj(x) && isId(x.id))) return null;
    if (new Set(a.map((x) => (x as { id: string }).id)).size !== a.length) return null;
    out[k] = a;
  }
  const maps = raw.maps === undefined ? {} : raw.maps;
  if (!isObj(maps)) return null;
  for (const [k, m] of Object.entries(maps)) if (!isId(k) || !isObj(m) || !Array.isArray(m.nodes) || !Array.isArray(m.edges) || !m.nodes.every((n) => isObj(n) && isId(n.id))) return null;
  const ok =
    (out.books as Record<string, unknown>[]).every(
      (b) => isStr(b.title) && isStr(b.author) && FORMATS.includes(b.format as BookFormat) && isSafeSegment(b.fileName) && isNum(b.size) && (b.pages === undefined || (Array.isArray(b.pages) && b.pages.every(isSafeSegment))),
    ) &&
    (out.highlights as Record<string, unknown>[]).every((h) => isId(h.bookId) && isStr(h.text) && isObj(h.anchor) && (h.anchor.kind === 'html' || h.anchor.kind === 'pdf') && Array.isArray(h.conceptIds)) &&
    (out.concepts as Record<string, unknown>[]).every((c) => isStr(c.name) && Array.isArray(c.senses) && Array.isArray(c.links)) &&
    (out.arguments as Record<string, unknown>[]).every((a) => Array.isArray(a.premises) && isObj(a.conclusion) && isOptId(a.bookId)) &&
    (out.studies as Record<string, unknown>[]).every((x) => isId(x.bookId) && Array.isArray(x.movements)) &&
    (out.plans as Record<string, unknown>[]).every((x) => Array.isArray(x.parts)) &&
    (out.drafts as Record<string, unknown>[]).every((d) => isStr(d.title) && isSafeSegment(d.fileName)) &&
    (out.cards as Record<string, unknown>[]).every((c) => isStr(c.front) && isStr(c.back) && isOptId(c.highlightId) && isOptId(c.conceptId) && isOptId(c.bookId)) &&
    (out.workspaces as Record<string, unknown>[]).every((w) => isStr(w.name)) &&
    (out.groups as Record<string, unknown>[]).every((g) => isId(g.workspaceId) && isOptId(g.parentId) && isStr(g.name)) &&
    (out.wsItems as Record<string, unknown>[]).every((i) => isId(i.workspaceId) && isOptId(i.groupId) && isId(i.refId) && isStr(i.kind));
  if (!ok || out.workspaces.length > 1) return null;
  return { ...(out as unknown as Omit<ShareData, 'maps'>), maps: maps as Record<string, ArgumentMap> };
}

function validateManifest(m: Record<string, unknown>): m is Record<string, unknown> & ShareManifest {
  return (
    isStr(m.title) &&
    (m.scope === 'workspace' || m.scope === 'items') &&
    isId(m.shareId) &&
    isNum(m.createdAt) &&
    isObj(m.counts) &&
    Array.isArray(m.books) &&
    m.books.every((b) => isObj(b) && isId(b.id) && (b.sha256 === null || (isStr(b.sha256) && /^[0-9a-f]{64}$/.test(b.sha256))) && isNum(b.size) && isStr(b.title) && typeof b.included === 'boolean') &&
    isObj(m.integrity) &&
    isStr(m.integrity.data) &&
    isObj(m.integrity.files) &&
    Object.values(m.integrity.files).every(isStr)
  );
}

/**
 * Ouvre et valide un paquet : format et version, taille, noms de fichiers sûrs, intégrité (empreintes
 * du manifeste), forme des données. Lève une ShareError au message lisible sinon.
 */
export async function openSharePackage(bytes: Uint8Array | ArrayBuffer): Promise<OpenedShare> {
  if (bytes.byteLength > MAX_PACKAGE_BYTES) throw ERR.tooBig();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    // Pas une archive, ou archive tronquée / altérée (somme de contrôle fausse).
    const head = bytes instanceof Uint8Array ? bytes.subarray(0, 2) : new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
    throw head[0] === 0x50 && head[1] === 0x4b ? ERR.damaged() : ERR.notShare();
  }
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ENTRIES) throw ERR.tooBig();
  let unpacked = 0;
  for (const e of entries) {
    // JSZip retire « ../ » en tête des noms mais garde l'original : c'est lui qu'on juge.
    if (!safeEntryName(e.unsafeOriginalName ?? e.name, e.dir) || (e.unsafeOriginalName && e.unsafeOriginalName !== e.name)) throw ERR.unsafe();
    // Taille annoncée (interne à JSZip) : refus avant de décompresser une archive piégée.
    unpacked += Number((e as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0);
  }
  if (unpacked > MAX_UNPACKED_BYTES) throw ERR.tooBig();
  const manifestFile = zip.file('manifest.json');
  const dataFile = zip.file('data.json');
  if (!manifestFile) throw ERR.notShare();
  let raw: unknown;
  try {
    raw = JSON.parse(await manifestFile.async('string'));
  } catch (e) {
    throw /crc|corrupt|invalid/i.test(String(e)) ? ERR.damaged() : ERR.notShare();
  }
  if (!isObj(raw) || raw.format !== SHARE_FORMAT || !isNum(raw.v)) throw ERR.notShare();
  if (raw.v > SHARE_VERSION) throw ERR.version();
  if (raw.v !== SHARE_VERSION) throw ERR.notShare();
  if (!validateManifest(raw) || !dataFile) throw ERR.invalid();
  const manifest = raw as ShareManifest;

  // data.json : empreinte puis forme.
  let dataBytes: Uint8Array;
  try {
    dataBytes = await dataFile.async('uint8array');
  } catch {
    throw ERR.damaged();
  }
  if (dataBytes.byteLength > MAX_DATA_BYTES) throw ERR.tooBig();
  if ((await sha256Hex(dataBytes)) !== manifest.integrity.data) throw ERR.damaged();
  let data: ShareData | null;
  try {
    data = validateData(JSON.parse(new TextDecoder().decode(dataBytes)));
  } catch {
    data = null;
  }
  if (!data) throw ERR.invalid();

  // Fichiers joints : exactement ceux du manifeste, chacun avec son empreinte, chacun rattaché à un livre joint ou à un écrit.
  const listed = new Set(Object.keys(manifest.integrity.files));
  const files = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.dir || !e.name.startsWith('files/')) continue;
    if (!listed.has(e.name)) throw ERR.damaged();
    let b: Uint8Array;
    try {
      b = await e.async('uint8array');
    } catch {
      throw ERR.damaged();
    }
    if ((await sha256Hex(b)) !== manifest.integrity.files[e.name]) throw ERR.damaged();
    files.set(e.name, b);
  }
  if (files.size !== listed.size) throw ERR.damaged();

  // Cohérence : chaque livre de data.json est décrit dans le manifeste ; un livre « joint » a tous ses fichiers ;
  // chaque écrit a son .docx ; les références de premier niveau visent des éléments du paquet.
  const entryOf = new Map(manifest.books.map((b) => [b.id, b]));
  const bookIds = new Set(data.books.map((b) => b.id));
  if (entryOf.size !== bookIds.size || ![...bookIds].every((id) => entryOf.has(id))) throw ERR.invalid();
  for (const b of data.books) if (entryOf.get(b.id)!.included && !bookSourceFiles(b).every((f) => files.has(`files/${b.id}/${f}`))) throw ERR.invalid();
  for (const d of data.drafts) if (!files.has(`files/${d.id}/${d.fileName}`)) throw ERR.invalid();
  const owners = new Set([...data.books.filter((b) => entryOf.get(b.id)!.included).map((b) => b.id), ...data.drafts.map((d) => d.id)]);
  for (const path of files.keys()) if (!owners.has(path.split('/')[1])) throw ERR.invalid();
  if (!data.highlights.every((h) => bookIds.has(h.bookId)) || !data.studies.every((x) => bookIds.has(x.bookId))) throw ERR.invalid();
  return { manifest, data, files };
}

/** Phrase de résumé : « 2 écrits, 1 carte, 14 extraits et 1 livre (joint) ». */
export function describeCounts(c: ShareCounts, booksIncluded: boolean): string {
  const bits: string[] = [];
  const n = (k: number, one: string, many: string) => k && bits.push(`${k} ${k > 1 ? many : one}`);
  n(c.drafts, 'écrit', 'écrits');
  n(c.maps, 'carte', 'cartes');
  n(c.plans, 'plan', 'plans');
  n(c.arguments, 'argument', 'arguments');
  n(c.studies, 'fiche-texte', 'fiches-texte');
  n(c.highlights, 'extrait', 'extraits');
  n(c.concepts, 'concept', 'concepts');
  n(c.cards, 'carte de révision', 'cartes de révision');
  if (c.books) bits.push(`${c.books} ${c.books > 1 ? 'livres' : 'livre'} (${booksIncluded ? (c.booksWithFile === c.books ? 'fichiers joints' : `${c.booksWithFile} joint${c.booksWithFile > 1 ? 's' : ''}`) : 'sans les fichiers'})`);
  if (!bits.length) return 'Aucun élément';
  return bits.length > 1 ? `${bits.slice(0, -1).join(', ')} et ${bits[bits.length - 1]}` : bits[0];
}

/** Valide un paquet reçu et en donne un aperçu lisible (rien n'est importé). */
export async function readSharePackage(bytes: Uint8Array | ArrayBuffer): Promise<SharePreview> {
  const { manifest, data } = await openSharePackage(bytes);
  const s = useStore.getState();
  const books: SharePreview['books'] = [];
  for (const e of manifest.books) {
    const local = await findLocalBook(e, s.books);
    books.push({ id: e.id, title: e.title, author: e.author ?? '', size: e.size, included: e.included, local: local ? { id: local.id, title: local.title, missing: !!local.missing } : null });
  }
  const counts = countsOf(data, manifest.books.filter((b) => b.included).length);
  return {
    title: manifest.title,
    scope: manifest.scope,
    shareId: manifest.shareId,
    createdAt: manifest.createdAt,
    appVersion: manifest.appVersion ?? null,
    counts,
    booksIncluded: manifest.booksIncluded,
    books,
    booksHere: books.filter((b) => b.local && !b.local.missing).length,
    booksWithoutFile: books.filter((b) => !b.included && (!b.local || b.local.missing)).length,
    alreadyReceived: alreadyReceived(s, manifest.shareId),
    sentence: describeCounts(counts, manifest.booksIncluded),
  };
}

/** Des éléments de ce partage sont-ils déjà dans la bibliothèque ? */
export function alreadyReceived(s: State, shareId: string): boolean {
  const hit = (x: { shareOrigin?: { shareId: string } }) => x.shareOrigin?.shareId === shareId;
  return (
    s.workspaces.some(hit) ||
    s.books.some(hit) ||
    s.highlights.some(hit) ||
    s.drafts.some(hit) ||
    s.concepts.some(hit) ||
    s.plans.some(hit) ||
    s.arguments.some(hit) ||
    s.studies.some(hit) ||
    s.cards.some(hit) ||
    Object.values(s.maps).some(hit)
  );
}
