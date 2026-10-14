// ─────────────────────────────────────────────────────────────
// Libellés lisibles du journal : titres d'objets, résumés de changements,
// regroupement des entrées. Pur (reçoit les données en argument).
// ─────────────────────────────────────────────────────────────
import { CATEGORY_BY_ID, NOTE_KIND_BY_ID } from '../../lib/categories';
import type {
  ActivityAction,
  ActivityEntry,
  ActivityKind,
  CategoryId,
  ItemChange,
  NoteKind,
  TrackedCollection,
  TrashKind,
} from '../../lib/types';
import { changedFields, composeChanges, deepEqual, type Data } from './engine';

export const KIND_LABEL: Record<ActivityKind, string> = {
  book: 'Livre',
  highlight: 'Extrait',
  concept: 'Concept',
  argument: 'Argument',
  study: 'Fiche-texte',
  plan: 'Plan',
  draft: 'Écrit',
  card: 'Carte de révision',
  workspace: 'Espace',
  group: 'Groupe',
  map: 'Carte d’argument',
  wsItem: 'Rangement dans un espace',
  file: 'Fichier',
};

/** Pluriels (« 3 extraits »). */
export const KIND_PLURAL: Record<ActivityKind, string> = {
  book: 'livres',
  highlight: 'extraits',
  concept: 'concepts',
  argument: 'arguments',
  study: 'fiches-texte',
  plan: 'plans',
  draft: 'écrits',
  card: 'cartes de révision',
  workspace: 'espaces',
  group: 'groupes',
  map: 'cartes d’argument',
  wsItem: 'rangements dans les espaces',
  file: 'fichiers',
};
const FEMININE = new Set<ActivityKind>(['study', 'card', 'map']);

export const COL_KIND: Record<TrackedCollection, ActivityKind> = {
  books: 'book',
  highlights: 'highlight',
  concepts: 'concept',
  maps: 'map',
  arguments: 'argument',
  studies: 'study',
  plans: 'plan',
  drafts: 'draft',
  cards: 'card',
  workspaces: 'workspace',
  groups: 'group',
  wsItems: 'wsItem',
};
export const KIND_COL: Record<TrashKind, TrackedCollection> = {
  book: 'books',
  highlight: 'highlights',
  concept: 'concepts',
  argument: 'arguments',
  study: 'studies',
  plan: 'plans',
  draft: 'drafts',
  card: 'cards',
  workspace: 'workspaces',
  group: 'groups',
};
export const TRASHABLE = new Set<ActivityKind>(Object.keys(KIND_COL) as TrashKind[]);

export const plural = (n: number, kind: ActivityKind) => `${n} ${n > 1 ? KIND_PLURAL[kind] : KIND_LABEL[kind].toLowerCase()}`;

const clip = (s: string, n = 72) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};
const strip = (s: string) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/[*_`#>{}]/g, '');

/** Titre lisible d'un élément (tel qu'il est, ou tel qu'il était). */
export function titleOf(col: TrackedCollection, item: any, d: Partial<Data>): string {
  if (!item) return 'Sans titre';
  switch (col) {
    case 'books':
      return item.title || item.originalName || 'Document sans titre';
    case 'highlights':
      return clip(item.text) || 'Extrait';
    case 'concepts':
      return item.name || 'Concept sans nom';
    case 'arguments':
      return item.title?.trim() || 'Argument sans titre';
    case 'studies':
      return item.title?.trim() || 'Fiche-texte';
    case 'plans':
      return item.title?.trim() || clip(item.sujet) || 'Plan sans titre';
    case 'drafts':
      return item.title || 'Écrit sans titre';
    case 'cards':
      return clip(strip(item.front)) || 'Carte de révision';
    case 'workspaces':
    case 'groups':
      return item.name || 'Sans nom';
    case 'maps': {
      const b = d.books?.find((x) => x.id === item.bookId);
      return b ? b.title : 'Carte d’argument';
    }
    case 'wsItems': {
      const colOf: Record<string, TrackedCollection> = { book: 'books', map: 'books', draft: 'drafts', plan: 'plans', argument: 'arguments', study: 'studies' };
      const c = colOf[item.kind];
      const ref = c ? ((d as any)[c] as any[] | undefined)?.find((x) => x.id === item.refId) : null;
      return ref ? titleOf(c, ref, d) : KIND_LABEL.wsItem;
    }
  }
}

/** Livre de rattachement d'un élément (pour le filtre « livre »). */
export function bookIdOf(col: TrackedCollection, item: any, d: Partial<Data>): string | null {
  if (!item) return null;
  switch (col) {
    case 'books':
      return item.id;
    case 'highlights':
    case 'studies':
    case 'maps':
    case 'cards':
    case 'arguments':
      return item.bookId ?? null;
    case 'wsItems':
      return item.kind === 'book' || item.kind === 'map' ? item.refId : null;
    default:
      return null;
  }
  void d;
}

const catLabel = (c: CategoryId | null) => (c ? CATEGORY_BY_ID[c]?.label ?? c : 'Note de marge');
const noteKindLabel = (k: NoteKind | null) => (k ? NOTE_KIND_BY_ID[k]?.label ?? k : 'Note simple');

const FIELD_LABEL: Record<string, string> = {
  title: 'titre',
  name: 'nom',
  author: 'auteur',
  edition: 'édition de référence',
  cover: 'couverture',
  note: 'note',
  text: 'texte',
  definition: 'définition',
  senses: 'sens',
  links: 'liens',
  programme: 'programme',
  premises: 'prémisses',
  conclusion: 'conclusion',
  comment: 'commentaire',
  probleme: 'problème',
  these: 'thèse',
  enjeu: 'enjeu',
  movements: 'mouvements',
  sujet: 'sujet',
  definitions: 'définitions',
  problematique: 'problématique',
  parts: 'parties',
  draftId: 'écrit lié',
  front: 'recto',
  back: 'verso',
  suspended: 'suspension',
  nodes: 'idées',
  edges: 'relations',
  tint: 'couleur',
  groupId: 'groupe',
  parentId: 'groupe parent',
  order: 'ordre',
  template: 'modèle',
  externalPath: 'fichier lié',
  anchor: 'passage',
  locationLabel: 'emplacement',
  bookId: 'livre',
  createdAt: 'date de création',
  kind: 'type',
  highlightId: 'extrait lié',
  conceptId: 'concept lié',
  workspaceId: 'espace',
  fileName: 'fichier',
  format: 'format',
  size: 'taille',
};

const ucfirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const arrow = (a: string, b: string) => `${a || '(vide)'} → ${b || '(vide)'}`;

/** Résumé d'une modification : « Catégorie : Thèse → Argument », « Note modifiée »… */
export function describeUpdate(col: TrackedCollection, before: any, after: any, d: Partial<Data>): string {
  const f = changedFields(col, before, after);
  if (!f.length) return 'Aucun changement';
  const parts: string[] = [];
  const other: string[] = [];
  for (const k of f) {
    const a = before[k];
    const b = after[k];
    if (col === 'highlights' && k === 'category') parts.push(`Catégorie : ${arrow(catLabel(a), catLabel(b))}`);
    else if (col === 'highlights' && k === 'noteKind') parts.push(`Type de note : ${arrow(noteKindLabel(a), noteKindLabel(b))}`);
    else if (col === 'highlights' && k === 'printedPage') parts.push(`Page imprimée : ${arrow(a, b)}`);
    else if (k === 'conceptIds') {
      const added = (b as string[]).filter((x) => !(a as string[]).includes(x));
      const removed = (a as string[]).filter((x) => !(b as string[]).includes(x));
      const name = (id: string) => d.concepts?.find((c) => c.id === id)?.name ?? 'concept';
      if (added.length) parts.push(`Concept « ${added.map(name).join(', ')} » associé`);
      if (removed.length) parts.push(`Concept « ${removed.map(name).join(', ')} » retiré`);
    } else if (k === 'note' || k === 'definition' || k === 'comment') {
      const label = ucfirst(FIELD_LABEL[k]);
      parts.push(!String(a ?? '').trim() ? `${label} ajoutée` : !String(b ?? '').trim() ? `${label} effacée` : `${label} modifiée`);
    } else if ((k === 'title' || k === 'name' || k === 'author') && typeof a === 'string' && typeof b === 'string' && a.length < 80 && b.length < 80) {
      parts.push(`${ucfirst(FIELD_LABEL[k])} : ${arrow(a, b)}`);
    } else if (col === 'maps' && (k === 'nodes' || k === 'edges')) {
      const na = (a as unknown[]).length;
      const nb = (b as unknown[]).length;
      const what = k === 'nodes' ? ['idée', 'idées'] : ['relation', 'relations'];
      if (nb > na) parts.push(`${nb - na} ${nb - na > 1 ? what[1] : what[0]} ${nb - na > 1 ? 'ajoutées' : 'ajoutée'}`);
      else if (nb < na) parts.push(`${na - nb} ${na - nb > 1 ? what[1] : what[0]} ${na - nb > 1 ? 'retirées' : 'retirée'}`);
      else parts.push(k === 'nodes' ? 'Idées déplacées ou modifiées' : 'Relations modifiées');
    } else if (k === 'suspended') parts.push(b ? 'Carte suspendue' : 'Carte réactivée');
    else other.push(FIELD_LABEL[k] ?? k);
  }
  if (other.length) parts.push(`${other.length > 1 ? 'Modifications' : 'Modification'} : ${other.join(', ')}`);
  const uniq = [...new Set(parts)];
  return uniq.length > 3 ? `${uniq.slice(0, 2).join(' ; ')} ; et ${uniq.length - 2} autres changements` : uniq.join(' ; ');
}

function describeCreate(col: TrackedCollection, item: any, d: Partial<Data>): string {
  const kind = COL_KIND[col];
  if (col === 'highlights') return item.category ? `Extrait ajouté (${catLabel(item.category)})` : 'Note de marge ajoutée';
  if (col === 'wsItems') {
    const ws = d.workspaces?.find((w) => w.id === item.workspaceId);
    return ws ? `Ajouté à l’espace « ${ws.name} »` : 'Ajouté à un espace';
  }
  return `${KIND_LABEL[kind]} créé${FEMININE.has(kind) ? 'e' : ''}`;
}

export interface Meta {
  action: ActivityAction | 'undo' | 'redo';
  kind?: ActivityKind;
  refId?: string | null;
  title?: string;
  bookId?: string | null;
  summary?: string;
  trashId?: string;
  /** false : la transaction n'entre pas dans la pile d'annulation. */
  undoable?: boolean;
}

type NewEntry = Omit<ActivityEntry, 'id' | 'at' | 'startedAt'>;

/** Entrées de journal pour une transaction (changements fusionnés + contexte éventuel). */
export function buildEntries(changes: ItemChange[], meta: Meta | null, d: Partial<Data>): NewEntry[] {
  if (meta && (meta.action === 'delete' || meta.action === 'restore' || meta.action === 'revert' || meta.action === 'purge')) {
    return [
      {
        action: meta.action,
        kind: meta.kind ?? 'file',
        refId: meta.refId ?? null,
        bookId: meta.bookId ?? null,
        title: meta.title ?? '',
        summary: meta.summary ?? '',
        trashId: meta.trashId,
        changes: meta.action === 'revert' ? changes : undefined,
      },
    ];
  }
  const out: NewEntry[] = [];
  const data = changes.filter((c) => c.col !== 'trash') as (ItemChange & { col: TrackedCollection })[];
  if (meta?.action === 'import') {
    for (const c of data)
      if (c.col === 'books' && c.before == null && c.after) {
        const b = c.after as any;
        out.push({ action: 'import', kind: 'book', refId: b.id, bookId: b.id, title: b.title, summary: `Importé depuis « ${b.originalName} »` });
      }
    if (out.length) return out;
  }
  // Créations : regroupées par nature et par livre.
  const created = new Map<string, (ItemChange & { col: TrackedCollection })[]>();
  for (const c of data)
    if (c.before == null && c.after != null) {
      // Références d'espace : regroupées par espace (« 3 éléments ajoutés à l'espace »).
      const k = c.col + '|' + (c.col === 'wsItems' ? 'ws:' + (c.after as any).workspaceId : (bookIdOf(c.col, c.after, d) ?? ''));
      created.set(k, [...(created.get(k) ?? []), c]);
    }
  for (const list of created.values()) {
    const col = list[0].col;
    const kind = COL_KIND[col];
    const bookId = bookIdOf(col, list[0].after, d);
    const book = bookId ? d.books?.find((b) => b.id === bookId) : null;
    const many = list.length > 1;
    const isMap = col === 'maps';
    if (col === 'wsItems' && many) {
      const ws = d.workspaces?.find((w) => w.id === (list[0].after as any).workspaceId);
      out.push({ action: 'create', kind, refId: list[0].id, refIds: list.map((c) => c.id), bookId: null, title: ws?.name ?? 'Espace', summary: `${list.length} éléments ajoutés à l’espace`, changes: list });
      continue;
    }
    out.push({
      action: 'create',
      kind,
      refId: list[0].id,
      refIds: many ? list.map((c) => c.id) : undefined,
      bookId,
      title: many ? (book?.title ?? clip(list.map((c) => titleOf(col, c.after, d)).join(', '))) : titleOf(col, list[0].after, d),
      summary: many ? `${plural(list.length, kind)} ajouté${FEMININE.has(kind) ? 'e' : ''}s` : isMap ? 'Carte d’argument commencée' : describeCreate(col, list[0].after, d),
      // Les créations d'éléments sans corbeille (références d'espace, carte) se défont par les changements.
      changes: TRASHABLE.has(kind) ? undefined : list,
    });
  }
  // Opérations groupées sur les références d'un espace (sélection multiple) : une seule entrée
  // « 43 éléments retirés de l'espace », « 12 éléments déplacés dans « Lectures » ».
  const bulk = new Set<ItemChange>();
  const wsRemoved = new Map<string, ItemChange[]>();
  const wsMoved = new Map<string, ItemChange[]>();
  for (const c of data) {
    if (c.col !== 'wsItems' || c.before == null) continue;
    const b = c.before as any;
    if (c.after == null) wsRemoved.set(b.workspaceId, [...(wsRemoved.get(b.workspaceId) ?? []), c]);
    else {
      const a = c.after as any;
      if (a.groupId !== b.groupId || a.workspaceId !== b.workspaceId) {
        const k = `${a.workspaceId}|${a.groupId}`;
        wsMoved.set(k, [...(wsMoved.get(k) ?? []), c]);
      }
    }
  }
  for (const list of wsRemoved.values()) {
    if (list.length < 2) continue;
    const ws = d.workspaces?.find((w) => w.id === (list[0].before as any).workspaceId);
    list.forEach((c) => bulk.add(c));
    out.push({ action: 'delete', kind: 'wsItem', refId: list[0].id, refIds: list.map((c) => c.id), bookId: null, title: ws?.name ?? 'Espace', summary: `${list.length} éléments retirés de l’espace`, changes: list });
  }
  for (const list of wsMoved.values()) {
    if (list.length < 2) continue;
    const a = list[0].after as any;
    const ws = d.workspaces?.find((w) => w.id === a.workspaceId);
    const g = d.groups?.find((x) => x.id === a.groupId);
    // Les renumérotations de la même transaction (champ `order`) suivent le déplacement.
    list.forEach((c) => bulk.add(c));
    out.push({
      action: 'update',
      kind: 'wsItem',
      refId: list[0].id,
      refIds: list.map((c) => c.id),
      bookId: null,
      title: ws?.name ?? 'Espace',
      summary: g ? `${list.length} éléments déplacés dans « ${g.name} »` : `${list.length} éléments déplacés à la racine de l’espace`,
      changes: list,
    });
  }
  // Modifications et retraits hors corbeille.
  for (const c of data) {
    if (c.before == null || bulk.has(c)) continue;
    const kind = COL_KIND[c.col];
    if (c.after == null) {
      const ws = c.col === 'wsItems' ? d.workspaces?.find((w) => w.id === (c.before as any).workspaceId) : null;
      out.push({
        action: 'delete',
        kind,
        refId: c.id,
        bookId: bookIdOf(c.col, c.before, d),
        title: titleOf(c.col, c.before, d),
        summary: c.col === 'wsItems' ? (ws ? `Retiré de l’espace « ${ws.name} »` : 'Retiré de l’espace') : 'Supprimé',
        changes: [c],
      });
      continue;
    }
    const fields = changedFields(c.col, c.before, c.after);
    // Simple réordonnancement : annulable, mais sans bruit dans le journal.
    if (!fields.length || fields.every((f) => f === 'order')) continue;
    let summary = describeUpdate(c.col, c.before, c.after, d);
    if (c.col === 'wsItems' && fields.includes('groupId')) {
      const g = d.groups?.find((x) => x.id === (c.after as any).groupId);
      summary = g ? `Déplacé dans « ${g.name} »` : 'Déplacé à la racine de l’espace';
    }
    out.push({ action: 'update', kind, refId: c.id, bookId: bookIdOf(c.col, c.after, d), title: titleOf(c.col, c.after, d), summary, changes: [c] });
  }
  return out;
}

/** Libellé court d'une entrée pour « Annulé : … ». */
export function labelOf(e: Pick<ActivityEntry, 'action' | 'title' | 'kind' | 'refIds'>): string {
  const t = e.refIds && e.refIds.length > 1 ? plural(e.refIds.length, e.kind) : `« ${e.title} »`;
  // Opérations groupées sur les références d'un espace (sélection multiple).
  if (e.kind === 'wsItem' && e.refIds && e.refIds.length > 1) {
    if (e.action === 'delete') return `retrait de ${e.refIds.length} éléments de l’espace`;
    if (e.action === 'update') return `déplacement de ${e.refIds.length} éléments`;
  }
  switch (e.action) {
    case 'create':
      return `ajout de ${t}`;
    case 'update':
      return `modification de ${t}`;
    case 'delete':
      return `suppression de ${t}`;
    case 'restore':
      return `restauration de ${t}`;
    case 'import':
      return `import de ${t}`;
    case 'revert':
      return `retour en arrière sur ${t}`;
    default:
      return t;
  }
}

const UPDATE_WINDOW = 2 * 60_000;
const CREATE_WINDOW = 5 * 60_000;
export const ACTIVITY_MAX = 5000;
export const ACTIVITY_DAYS = 90;
/** Seules les entrées récentes gardent de quoi « revenir à l'état d'avant » (db.json léger). */
export const ACTIVITY_REVERSIBLE = 300;

/**
 * Modifications conservées au journal : seulement l'id et les champs changés (pas la couverture
 * d'un livre dont on a corrigé l'auteur, ni tout un plan pour un titre). Suffit pour revenir en
 * arrière, car l'application inverse ne touche qu'aux champs présents de part et d'autre.
 */
export function slimChanges(list: ItemChange[] | undefined): ItemChange[] | undefined {
  if (!list) return list;
  const isRec = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  return list.map((c) => {
    if (c.col === 'trash' || !isRec(c.before) || !isRec(c.after)) return c;
    const fields = changedFields(c.col, c.before, c.after);
    const pick = (o: Record<string, unknown>) => {
      const r: Record<string, unknown> = {};
      if ('id' in o) r.id = o.id;
      for (const k of fields) if (k in o) r[k] = o[k];
      return r;
    };
    return { ...c, before: pick(c.before), after: pick(c.after) };
  });
}

/** Ajoute des entrées au journal en regroupant les modifications rapides d'un même objet. */
export function mergeActivity(list: ActivityEntry[], entries: NewEntry[], now: number, d: Partial<Data>, uid: () => string): ActivityEntry[] {
  let out = list.slice();
  for (const full of entries) {
    const e: NewEntry = full.changes ? { ...full, changes: slimChanges(full.changes) } : full;
    const near = out.slice(0, 8);
    if (e.action === 'update' && e.changes?.length === 1) {
      // Même objet, mêmes champs (la frappe d'une note), peu de temps après : une seule entrée.
      const nc = e.changes[0] as ItemChange & { col: TrackedCollection };
      const fieldsOf = (c: ItemChange) => changedFields(c.col as TrackedCollection, c.before, c.after).sort().join(',');
      const i = near.findIndex(
        (x) => x.action === 'update' && x.kind === e.kind && x.refId === e.refId && now - x.at < UPDATE_WINDOW && x.changes?.length === 1 && fieldsOf(x.changes[0]) === fieldsOf(nc),
      );
      if (i >= 0) {
        const prev = out[i];
        const merged = composeChanges([...(prev.changes ?? []), ...e.changes]);
        out.splice(i, 1);
        if (!merged.length || deepEqual(merged[0].before, merged[0].after)) continue; // revenu au point de départ
        const c = merged[0] as ItemChange & { col: TrackedCollection };
        out.unshift({ ...prev, at: now, title: e.title, changes: merged, summary: describeUpdate(c.col, c.before, c.after, d) });
        continue;
      }
    }
    if (e.action === 'create' && (e.kind === 'highlight' || e.kind === 'card') && !e.changes) {
      const i = near.findIndex((x) => x.action === 'create' && x.kind === e.kind && x.bookId === e.bookId && now - x.at < CREATE_WINDOW && !x.changes);
      if (i >= 0) {
        const prev = out[i];
        const ids = [...(prev.refIds ?? (prev.refId ? [prev.refId] : [])), ...(e.refIds ?? (e.refId ? [e.refId] : []))];
        const book = e.bookId ? d.books?.find((b) => b.id === e.bookId) : null;
        out.splice(i, 1);
        out.unshift({
          ...prev,
          at: now,
          refIds: ids,
          title: book?.title ?? KIND_LABEL[e.kind],
          summary: `${plural(ids.length, e.kind)} ajouté${FEMININE.has(e.kind) ? 'e' : ''}s`,
        });
        continue;
      }
    }
    out.unshift({ ...e, id: uid(), at: now, startedAt: now });
  }
  return pruneActivity(out, now);
}

export function pruneActivity(list: ActivityEntry[], now: number): ActivityEntry[] {
  const limit = now - ACTIVITY_DAYS * 86_400_000;
  let out = list.filter((e) => e.at >= limit);
  if (out.length > ACTIVITY_MAX) out = out.slice(0, ACTIVITY_MAX);
  let touched = false;
  const res = out.map((e, i) => {
    if (i < ACTIVITY_REVERSIBLE || !e.changes) return e;
    touched = true;
    const { changes: _drop, ...rest } = e;
    return rest;
  });
  return touched || out.length !== list.length ? res : list;
}
