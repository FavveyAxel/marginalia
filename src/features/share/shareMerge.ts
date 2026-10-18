// Import d'un partage « .marginalia » (format : sharePackage.ts). Tout ce qui arrive est AJOUTÉ :
// rien de la bibliothèque n'est écrasé ni modifié. Seule exception, qui n'enlève rien : un livre reçu
// plus tôt « sans fichier » (missing) est complété quand un partage joint enfin son fichier.
//
// - Ids : chaque élément reçoit un nouvel id (uid) et toutes les références suivent (extrait → livre et
//   concepts, carte → livres, extraits, concepts, portails, fiche-texte ; argument, plan, carte de
//   révision, sens d'un concept, références et groupes de l'espace, signets de citation des .docx).
//   Les ids internes à un objet (cartes et liens d'une carte, mouvements d'une fiche, nœuds d'un plan)
//   sont gardés : ils ne valent qu'à l'intérieur de leur objet.
// - Livres : reconnus par l'empreinte SHA-256 du fichier source (taille comparée d'abord). Déjà là :
//   aucun doublon, les extraits et cartes se rattachent au livre local. Absent et non joint : une entrée
//   `missing: true` (métadonnées seules) garde les extraits lisibles avec leur texte.
// - Carte d'un livre déjà présent qui a déjà sa carte : la carte reçue devient une carte libre
//   (« Carte de « Titre » (reçue) ») au lieu de remplacer la carte locale.
// - Espace : un nouvel espace (« Nom (reçu) » si le nom existe déjà), même teinte, mêmes groupes.
//   Concept de même nom qu'un concept local : « Nom (reçu) » (jamais fusionné en silence).
// - Écriture : fichiers d'abord (host.storeFile), puis la base en UNE opération (applyExternal, une
//   entrée « import » au journal). En cas d'échec, les fichiers écrits sont retirés et la base n'a rien reçu.
// - Le même paquet importé deux fois : nouvelles copies (nouveaux ids, « Nom (reçu 2) »), sans doublon
//   de livre ni rien de cassé. readSharePackage(…).alreadyReceived permet à l'interface de prévenir avant.
// - Chaque élément créé garde `shareOrigin` { shareId, srcId } (voir types.ts) pour une future synchronisation.
import { host } from '../../lib/platform';
import { EMPTY_EDITION, uid, useStore } from '../../lib/store';
import type {
  ArgumentMap,
  ArgumentReconstruction,
  ArgumentStep,
  Book,
  CategoryId,
  Concept,
  Draft,
  EssayPlan,
  Highlight,
  MapNode,
  NoteKind,
  PlanNode,
  RelationId,
  ReviewCard,
  ShareOrigin,
  TextStudy,
  Workspace,
  WorkspaceGroup,
  WorkspaceItem,
  WorkspaceItemKind,
} from '../../lib/types';
import { CITE_BOOKMARK_PREFIX } from '../editor/privateNotes';
import { newFsrs } from '../revision/fsrs';
import { alreadyReceived, bookExtraFiles, bookSourceFiles, describeCounts, findLocalBook, openSharePackage, rewriteDocxXml, ShareError, type ShareCounts } from './sharePackage';

export interface ShareImportOptions {
  /** Avancement de l'écriture des fichiers reçus. */
  onProgress?: (done: number, total: number) => void;
}

export interface ShareImportResult {
  title: string;
  shareId: string;
  /** Espace créé (partage d'un espace), sinon null. */
  workspace: { id: string; name: string } | null;
  /** Éléments créés (`books` : nouvelles entrées de livre, avec ou sans fichier). */
  created: ShareCounts;
  /** Livres déjà présents : rien de créé, extraits et cartes rattachés au livre local. */
  attachedBooks: { id: string; title: string; missing: boolean }[];
  /** Livres créés sans fichier (`missing: true`) : extraits lisibles, livre non ouvrable. */
  missingBooks: { id: string; title: string }[];
  /** Livres reçus plus tôt sans fichier, complétés par le fichier joint à ce partage. */
  completedBooks: { id: string; title: string }[];
  /** Noms changés pour ne rien confondre avec l'existant. */
  renamed: { kind: 'workspace' | 'concept'; from: string; to: string }[];
  /** Cartes de livre rangées comme cartes libres (le livre local avait déjà sa carte). */
  bookMapsAsBoards: number;
  /** Des éléments de ce partage étaient déjà là avant cet import (nouvelles copies créées). */
  alreadyReceived: boolean;
  /** Résumé lisible (« 1 écrit, 1 carte et 12 extraits »). */
  sentence: string;
}


// ── Garde-fous sur les valeurs reçues ────────────────────────
// Teintes et couleurs finissent dans des styles (`var(${tint})`) : seules une variable CSS ou une
// couleur hex passent (une valeur piégée pourrait sinon charger une adresse distante).
const SAFE_VAR = /^--[a-z0-9-]{1,40}$/i;
const SAFE_COLOR = /^(--[a-z0-9-]{1,40}|#[0-9a-f]{3,8})$/i;
const CATEGORIES: CategoryId[] = ['probleme', 'these', 'argument', 'objection', 'concept', 'exemple'];
const NOTE_KINDS: NoteKind[] = ['reformulation', 'question', 'critique', 'presuppose'];
const RELATIONS: RelationId[] = ['soutient', 'objecte', 'precise', 'illustre', 'repond', 'oppose', 'rattache', 'lien'];
const WS_KINDS: WorkspaceItemKind[] = ['book', 'draft', 'plan', 'argument', 'study', 'map'];

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isId = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200;
const str = (x: unknown, d = '') => (typeof x === 'string' ? x : d);
const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter(isId) : []);
/** Couverture : image intégrée seulement (jamais une adresse à charger). */
const safeCover = (x: unknown): string | null => (typeof x === 'string' && /^data:image\/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/.test(x) ? x : null);
const validOrigin = (x: unknown): ShareOrigin | null => (isObj(x) && isId(x.shareId) && isId(x.srcId) ? { shareId: x.shareId, srcId: x.srcId } : null);
const toBuffer = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** « Nom », sinon « Nom (reçu) », « Nom (reçu 2) »… (comparaison sans casse). */
function uniqueName(name: string, taken: Set<string>): string {
  const norm = (x: string) => x.trim().toLowerCase();
  let out = name;
  for (let i = 1; taken.has(norm(out)); i++) out = i === 1 ? `${name} (reçu)` : `${name} (reçu ${i})`;
  taken.add(norm(out));
  return out;
}

/**
 * Importe un paquet de partage. Valide d'abord tout le paquet (rien n'est écrit s'il est refusé),
 * puis ajoute les éléments avec de nouveaux ids. Lève une ShareError au message lisible en cas de refus.
 */
export async function importSharePackage(bytes: Uint8Array | ArrayBuffer, opts: ShareImportOptions = {}): Promise<ShareImportResult> {
  const { manifest, data, files } = await openSharePackage(bytes);
  const s0 = useStore.getState();
  if (!s0.ready) throw new ShareError('not-ready', 'La bibliothèque n’est pas encore chargée : réessayez dans un instant.');
  const now = Date.now();
  const shareId = manifest.shareId;
  // Provenance : celle d'origine si l'élément avait lui-même été reçu, sinon ce partage.
  const origin = (x: { shareOrigin?: unknown }, srcId: string): ShareOrigin => validOrigin(x.shareOrigin) ?? { shareId, srcId };
  const wasReceived = alreadyReceived(s0, shareId);
  const writes: { ownerId: string; fileName: string; data: ArrayBuffer }[] = [];
  const fileOf = (ownerId: string, name: string) => files.get(`files/${ownerId}/${name}`);

  // ── 1. Livres : rattachés au livre local, complétés, ou créés ──
  const bookId = new Map<string, string>();
  const entryOf = new Map(manifest.books.map((b) => [b.id, b]));
  const newBooks: Book[] = [];
  const completions = new Map<string, Partial<Book>>();
  const attachedBooks: ShareImportResult['attachedBooks'] = [];
  const missingBooks: ShareImportResult['missingBooks'] = [];
  const completedBooks: ShareImportResult['completedBooks'] = [];
  const titleOfBook = new Map<string, string>();
  for (const src of data.books) {
    const e = entryOf.get(src.id)!;
    const local = await findLocalBook(e, s0.books);
    const fileNames = [...bookSourceFiles(src), ...bookExtraFiles(src)];
    if (local) {
      bookId.set(src.id, local.id);
      titleOfBook.set(local.id, local.title);
      if (local.missing && e.included && !completions.has(local.id)) {
        for (const f of fileNames) {
          const b = fileOf(src.id, f);
          if (b) writes.push({ ownerId: local.id, fileName: f, data: toBuffer(b) });
        }
        const pages = (src as Book & { pages?: string[] }).pages;
        completions.set(local.id, { fileName: src.fileName, size: e.size, format: src.format, ...(Array.isArray(pages) ? { pages } : {}), ...(local.cover ? {} : { cover: safeCover(src.cover) }) } as Partial<Book>);
        completedBooks.push({ id: local.id, title: local.title });
      } else if (!completions.has(local.id) && !attachedBooks.some((a) => a.id === local.id)) {
        attachedBooks.push({ id: local.id, title: local.title, missing: !!local.missing });
      }
      continue;
    }
    const id = uid();
    bookId.set(src.id, id);
    const { missing: _m, shareOrigin: _o, sourceSha256: _h, ...rest } = src;
    const book: Book = {
      ...rest,
      id,
      title: str(src.title, 'Sans titre'),
      author: str(src.author),
      originalName: str(src.originalName, src.fileName),
      cover: safeCover(src.cover),
      edition: { ...EMPTY_EDITION, ...(isObj(src.edition) ? src.edition : {}) },
      addedAt: now,
      lastOpenedAt: null,
      progress: 0,
      position: null,
      size: e.size,
      ...(e.sha256 ? { sourceSha256: e.sha256 } : {}),
      shareOrigin: origin(src, src.id),
    };
    if (e.included) {
      for (const f of fileNames) {
        const b = fileOf(src.id, f);
        if (b) writes.push({ ownerId: id, fileName: f, data: toBuffer(b) });
      }
    } else {
      book.missing = true;
      missingBooks.push({ id, title: book.title });
    }
    titleOfBook.set(id, book.title);
    newBooks.push(book);
  }
  const newBookIds = new Set(newBooks.map((b) => b.id));

  // ── 2. Nouveaux ids pour tout le reste ──
  const remap = <T extends { id: string }>(arr: T[]) => new Map(arr.map((x) => [x.id, uid()]));
  const hlId = remap(data.highlights);
  const conceptId = remap(data.concepts);
  const argId = remap(data.arguments);
  const studyId = remap(data.studies);
  const planId = remap(data.plans);
  const draftId = remap(data.drafts);
  const srcWs = data.workspaces[0] ?? null;
  const wsId = srcWs ? uid() : null;
  const groupId = remap(srcWs ? data.groups.filter((g) => g.workspaceId === srcWs.id) : []);
  const pick = (m: Map<string, string>, x: unknown): string | null => (isId(x) ? (m.get(x) ?? null) : null);

  // Clés des cartes. Carte de livre : clé = id du livre (nouveau, ou local s'il n'a pas déjà sa carte) ;
  // sinon carte libre. Carte de mouvement : clé `mv-<fiche>-<mouvement>` (comme movementMapKey).
  const mapKey = new Map<string, string>();
  const asBoard = new Set<string>();
  const usedKeys = new Set<string>();
  for (const [k, m] of Object.entries(data.maps)) {
    const kind = m.kind ?? 'book';
    let key: string | null = null;
    if (kind === 'book') {
      const target = bookId.get(k) ?? pick(bookId, m.bookId);
      if (!target) continue; // carte d'un livre absent du paquet : ignorée
      if (newBookIds.has(target) || (!Object.hasOwn(s0.maps, target) && !usedKeys.has(target))) key = target;
    } else if (kind === 'movement') {
      const st = pick(studyId, m.studyId);
      if (st && isId(m.movementId) && /^[A-Za-z0-9_-]+$/.test(m.movementId)) key = `mv-${st}-${m.movementId}`;
    }
    if (!key || usedKeys.has(key)) {
      key = `board-${uid()}`;
      if (kind !== 'board') asBoard.add(k);
    }
    usedKeys.add(key);
    mapKey.set(k, key);
  }

  // ── 3. Objets, références remappées ──
  const highlights: Highlight[] = data.highlights.map((h) => {
    const { source: _s, shareOrigin: _o, ...rest } = h;
    const category = CATEGORIES.includes(h.category as CategoryId) ? h.category : null;
    return {
      ...rest,
      id: hlId.get(h.id)!,
      bookId: bookId.get(h.bookId)!,
      category,
      text: str(h.text),
      note: str(h.note),
      noteKind: NOTE_KINDS.includes(h.noteKind as NoteKind) ? h.noteKind : null,
      conceptIds: ids(h.conceptIds).map((c) => conceptId.get(c)).filter(isId),
      locationLabel: str(h.locationLabel),
      printedPage: str(h.printedPage),
      createdAt: num(h.createdAt, now),
      updatedAt: num(h.updatedAt, now),
      shareOrigin: origin(h, h.id),
    };
  });

  const renamed: ShareImportResult['renamed'] = [];
  const conceptNames = new Set(s0.concepts.map((c) => c.name.trim().toLowerCase()));
  const concepts: Concept[] = data.concepts.map((c) => {
    const name = uniqueName(str(c.name, 'Concept').trim() || 'Concept', conceptNames);
    if (name !== c.name) renamed.push({ kind: 'concept', from: c.name, to: name });
    return {
      ...c,
      id: conceptId.get(c.id)!,
      name,
      definition: str(c.definition),
      senses: (Array.isArray(c.senses) ? c.senses : []).filter(isObj).map((se) => ({
        ...se,
        id: isId(se.id) ? se.id : uid(),
        author: str(se.author),
        definition: str(se.definition),
        bookId: pick(bookId, se.bookId),
        highlightIds: ids(se.highlightIds).map((x) => hlId.get(x)).filter(isId),
      })),
      links: (Array.isArray(c.links) ? c.links : []).filter((l) => isObj(l) && conceptId.has(l.conceptId)).map((l) => ({ ...l, conceptId: conceptId.get(l.conceptId)! })),
      programme: c.programme === 'notion' || c.programme === 'repere' ? c.programme : null,
      createdAt: num(c.createdAt, now),
      updatedAt: num(c.updatedAt, now),
      shareOrigin: origin(c, c.id),
    };
  });

  const maps: Record<string, ArgumentMap> = {};
  for (const [k, m] of Object.entries(data.maps)) {
    const key = mapKey.get(k);
    if (!key) continue;
    const kind = m.kind ?? 'book';
    const nodes: MapNode[] = m.nodes.map((n) => {
      const out: MapNode = { ...n, highlightId: pick(hlId, n.highlightId), text: str(n.text) };
      const c = pick(conceptId, n.conceptId);
      if (c) out.conceptId = c;
      else delete out.conceptId;
      const portal = pick(mapKey, n.portal);
      if (portal) out.portal = portal;
      else delete out.portal;
      const from = isObj(n.from) ? pick(mapKey, n.from.mapKey) : null;
      if (from) out.from = { mapKey: from, nodeId: str(n.from!.nodeId) };
      else delete out.from;
      if (out.color !== undefined && !(typeof out.color === 'string' && SAFE_COLOR.test(out.color))) delete out.color;
      return out;
    });
    const edges = m.edges.filter(isObj).map((e) => ({ ...e, relation: RELATIONS.includes(e.relation) ? e.relation : 'lien' }));
    const zones = Array.isArray(m.zones) ? m.zones.filter(isObj).map((z) => ({ ...z, title: str(z.title), color: typeof z.color === 'string' && SAFE_COLOR.test(z.color) ? z.color : '--cat-these' })) : undefined;
    const base = { ...m, nodes, edges, ...(zones ? { zones } : {}), shareOrigin: origin(m, k) };
    if (key.startsWith('board-')) {
      const { studyId: _s, movementId: _mv, ...rest } = base;
      const books = [...new Set([...ids(m.bookIds), ...(isId(m.bookId) ? [m.bookId] : []), ...(kind === 'book' ? [k] : [])].map((b) => bookId.get(b)).filter(isId))];
      const fromBook = kind === 'book' ? titleOfBook.get(bookId.get(k) ?? pick(bookId, m.bookId) ?? '') : null;
      maps[key] = {
        ...rest,
        id: key,
        kind: 'board',
        bookId: '',
        bookIds: books,
        title: fromBook != null ? `Carte de « ${fromBook} » (reçue)` : str(m.title, 'Carte reçue'),
        createdAt: num(m.createdAt, now),
        updatedAt: num(m.updatedAt, now),
      };
    } else if (kind === 'movement') {
      maps[key] = { ...base, id: key, bookId: pick(bookId, m.bookId) ?? '', studyId: pick(studyId, m.studyId)!, bookIds: ids(m.bookIds).map((b) => bookId.get(b)).filter(isId) };
    } else {
      const { id: _id, ...rest } = base;
      maps[key] = { ...rest, ...(m.id !== undefined ? { id: key } : {}), bookId: key, ...(m.bookIds ? { bookIds: ids(m.bookIds).map((b) => bookId.get(b)).filter(isId) } : {}) };
    }
  }

  const step = (st: ArgumentStep): ArgumentStep => ({ ...st, id: isId(st?.id) ? st.id : uid(), text: str(st?.text), highlightId: pick(hlId, st?.highlightId), implicit: !!st?.implicit });
  const args: ArgumentReconstruction[] = data.arguments.map((a) => ({
    ...a,
    id: argId.get(a.id)!,
    title: str(a.title),
    bookId: pick(bookId, a.bookId),
    premises: a.premises.filter(isObj).map((p) => step(p as unknown as ArgumentStep)),
    conclusion: step(a.conclusion),
    comment: str(a.comment),
    createdAt: num(a.createdAt, now),
    updatedAt: num(a.updatedAt, now),
    shareOrigin: origin(a, a.id),
  }));

  const studies: TextStudy[] = data.studies.map((x) => ({ ...x, id: studyId.get(x.id)!, bookId: bookId.get(x.bookId)!, shareOrigin: origin(x, x.id) }));

  const planNodes = (nodes: unknown): PlanNode[] =>
    (Array.isArray(nodes) ? nodes : []).filter(isObj).map((n) => ({
      ...(n as unknown as PlanNode),
      id: isId(n.id) ? n.id : uid(),
      title: str(n.title),
      note: str(n.note),
      items: (Array.isArray(n.items) ? n.items : []).filter((it) => isObj(it) && isObj(it.ref)).flatMap((it): PlanNode['items'] => {
        const ref = it.ref as PlanNode['items'][number]['ref'];
        const itemId = isId(it.id) ? it.id : uid();
        if (ref.kind === 'text') return [{ id: itemId, ref: { kind: 'text' as const, text: str(ref.text) } }];
        const m = ref.kind === 'highlight' ? hlId : ref.kind === 'concept' ? conceptId : ref.kind === 'argument' ? argId : null;
        const target = m ? pick(m, ref.id) : null;
        return target ? [{ id: itemId, ref: { kind: ref.kind, id: target } }] : [];
      }),
      children: planNodes(n.children),
    }));
  const plans: EssayPlan[] = data.plans.map((x) => ({ ...x, id: planId.get(x.id)!, title: str(x.title), parts: planNodes(x.parts), draftId: pick(draftId, x.draftId), createdAt: num(x.createdAt, now), updatedAt: num(x.updatedAt, now), shareOrigin: origin(x, x.id) }));

  // Écrits : nouveau .docx dont les signets de citation pointent vers les extraits remappés.
  const citeRe = new RegExp(`${CITE_BOOKMARK_PREFIX}([A-Za-z0-9_-]+)`, 'g');
  const drafts: Draft[] = [];
  for (const d of data.drafts) {
    const id = draftId.get(d.id)!;
    const { versions: _v, shareOrigin: _o, ...rest } = d;
    let docx = toBuffer(fileOf(d.id, d.fileName)!);
    try {
      docx = await rewriteDocxXml(docx, (xml) => xml.replace(citeRe, (all, h: string) => (hlId.has(h) ? CITE_BOOKMARK_PREFIX + hlId.get(h) : all)));
    } catch (e) {
      // .docx illisible par JSZip : gardé tel quel (l'éditeur dira ce qu'il en est).
      console.warn('partage : citations non remappées', d.title, e);
    }
    writes.push({ ownerId: id, fileName: d.fileName, data: docx });
    drafts.push({ ...rest, id, title: str(d.title, 'Sans titre'), externalPath: null, wordCount: num(d.wordCount, 0), createdAt: num(d.createdAt, now), updatedAt: num(d.updatedAt, now), shareOrigin: origin(d, d.id) });
  }

  // Cartes de révision : une carte dont une référence n'a pas suivi est laissée de côté ; l'état de révision repart de zéro.
  const cards: ReviewCard[] = [];
  for (const c of data.cards) {
    const h = pick(hlId, c.highlightId);
    const co = pick(conceptId, c.conceptId);
    const b = pick(bookId, c.bookId);
    if ((c.highlightId && !h) || (c.conceptId && !co) || (c.bookId && !b)) continue;
    const kind = ['definition', 'these', 'trous', 'citation', 'libre'].includes(c.kind) ? c.kind : 'libre';
    cards.push({ ...c, id: uid(), kind, front: str(c.front), back: str(c.back), highlightId: h, conceptId: co, bookId: b, suspended: !!c.suspended, fsrs: newFsrs(now), createdAt: now, shareOrigin: origin(c, c.id) });
  }

  // Espace, groupes, références.
  let workspace: Workspace | null = null;
  const groups: WorkspaceGroup[] = [];
  const wsItems: WorkspaceItem[] = [];
  if (srcWs && wsId) {
    const name = uniqueName(str(srcWs.name, 'Espace reçu').trim() || 'Espace reçu', new Set(s0.workspaces.map((w) => w.name.trim().toLowerCase())));
    if (name !== srcWs.name) renamed.push({ kind: 'workspace', from: srcWs.name, to: name });
    workspace = {
      ...srcWs,
      id: wsId,
      name,
      tint: typeof srcWs.tint === 'string' && SAFE_VAR.test(srcWs.tint) ? srcWs.tint : '--cat-these',
      order: s0.workspaces.length,
      createdAt: now,
      shareOrigin: origin(srcWs, srcWs.id),
    };
    for (const g of data.groups) {
      const id = groupId.get(g.id);
      if (!id) continue;
      groups.push({ ...g, id, workspaceId: wsId, parentId: pick(groupId, g.parentId), name: str(g.name, 'Groupe'), order: num(g.order, 0), collapsed: !!g.collapsed, shareOrigin: origin(g, g.id) });
    }
    const refMap: Record<WorkspaceItemKind, Map<string, string>> = { book: bookId, map: mapKey, draft: draftId, plan: planId, argument: argId, study: studyId };
    const seen = new Set<string>();
    for (const it of data.wsItems) {
      if (it.workspaceId !== srcWs.id || !WS_KINDS.includes(it.kind)) continue;
      const ref = pick(refMap[it.kind], it.refId);
      if (!ref || seen.has(it.kind + ':' + ref)) continue;
      seen.add(it.kind + ':' + ref);
      wsItems.push({ ...it, id: uid(), workspaceId: wsId, groupId: pick(groupId, it.groupId), kind: it.kind, refId: ref, order: num(it.order, 0), shareOrigin: origin(it, it.id) });
    }
  }

  // ── 4. Fichiers d'abord ──
  const written: { ownerId: string; fileName: string }[] = [];
  const rollback = async () => {
    for (const f of written.reverse()) await host.deleteFile(f.ownerId, f.fileName).catch(() => undefined);
  };
  try {
    for (let i = 0; i < writes.length; i++) {
      const w = writes[i];
      written.push({ ownerId: w.ownerId, fileName: w.fileName });
      await host.storeFile(w.ownerId, w.fileName, w.data);
      opts.onProgress?.(i + 1, writes.length);
    }
  } catch (e) {
    console.error('partage : écriture des fichiers', e);
    await rollback();
    throw new ShareError('write', 'Les fichiers reçus n’ont pas pu être enregistrés : rien n’a été importé.');
  }

  // ── 5. Puis la base, en une seule opération ──
  const created: ShareCounts = {
    books: newBooks.length,
    booksWithFile: newBooks.filter((b) => !b.missing).length,
    highlights: highlights.length,
    concepts: concepts.length,
    maps: Object.keys(maps).length,
    arguments: args.length,
    studies: studies.length,
    plans: plans.length,
    drafts: drafts.length,
    cards: cards.length,
    workspaces: workspace ? 1 : 0,
    groups: groups.length,
  };
  const sentence = describeCounts({ ...created, books: created.books + completedBooks.length, booksWithFile: created.booksWithFile + completedBooks.length }, created.booksWithFile + completedBooks.length > 0);
  const applyAll = useStore.getState().applyExternal;
  try {
    applyAll(
      (cur) => {
        // L'état a pu changer pendant l'écriture des fichiers : aucune clé ne doit déjà exister.
        if (Object.keys(maps).some((k) => Object.hasOwn(cur.maps, k))) throw new Error('clé de carte déjà prise');
        const books = completions.size
          ? cur.books.map((b) => {
              const patch = completions.get(b.id);
              if (!patch) return b;
              const { missing: _m, ...rest } = b;
              return { ...rest, ...patch };
            })
          : cur.books;
        return {
          books: [...newBooks, ...books],
          highlights: [...cur.highlights, ...highlights],
          concepts: [...cur.concepts, ...concepts],
          maps: { ...cur.maps, ...maps },
          arguments: [...cur.arguments, ...args],
          studies: [...cur.studies, ...studies],
          plans: [...cur.plans, ...plans],
          drafts: [...cur.drafts, ...drafts],
          cards: [...cur.cards, ...cards],
          workspaces: workspace ? [...cur.workspaces, workspace] : cur.workspaces,
          groups: [...cur.groups, ...groups],
          wsItems: [...cur.wsItems, ...wsItems],
        };
      },
      { action: 'import', kind: 'file', refId: null, bookId: null, title: workspace?.name ?? manifest.title, summary: `Partage reçu : ${sentence}` },
    );
  } catch (e) {
    console.error('partage : écriture dans la base', e);
    await rollback();
    throw new ShareError('write', 'Le partage n’a pas pu être ajouté à la bibliothèque : rien n’a été importé.');
  }

  return {
    title: manifest.title,
    shareId,
    workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
    created,
    attachedBooks,
    missingBooks,
    completedBooks,
    renamed,
    bookMapsAsBoards: [...asBoard].filter((k) => (data.maps[k].kind ?? 'book') === 'book').length,
    alreadyReceived: wasReceived,
    sentence,
  };
}
