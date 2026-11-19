// Espaces chiffrés : ce qui appartient à un espace, et comment la base se partage entre le fichier
// commun et la « capsule » de chaque espace (scellée par le processus principal, electron/spaces.cjs).
//
// Appartient à un espace chiffré ce qui n'est QUE dans cet espace : ses groupes et ses rangements, les
// écrits, plans, cartes, reconstructions et fiches qui n'y sont rangés nulle part ailleurs, les livres
// qui ne sont que là (avec leurs extraits, notes, signets, carte, fiches), les concepts qui ne servent
// qu'à ce contenu, et les traces qui en parlent (corbeille, journal, versions de cartes, cartes de
// révision). Un livre aussi rangé dans un autre espace reste commun.
//
// Verrouillé, ce contenu n'est pas dans la mémoire de l'interface : la recherche, la révision et le
// journal ne peuvent pas le montrer. Fonctions pures : tout se teste sans l'app.
import type { ArgumentMap, Database, PlanNode } from './types';

export interface Capsule {
  v: 1;
  wsId: string;
  books: Database['books'];
  highlights: Database['highlights'];
  concepts: Database['concepts'];
  maps: Database['maps'];
  arguments: Database['arguments'];
  studies: Database['studies'];
  plans: Database['plans'];
  drafts: Database['drafts'];
  cards: Database['cards'];
  groups: Database['groups'];
  wsItems: Database['wsItems'];
  bookmarks: Database['bookmarks'];
  trash: Database['trash'];
  activity: Database['activity'];
  mapVersions: NonNullable<Database['mapVersions']>;
}

const ARRAYS = ['books', 'highlights', 'concepts', 'arguments', 'studies', 'plans', 'drafts', 'cards', 'groups', 'wsItems', 'bookmarks', 'trash', 'activity', 'mapVersions'] as const;

const planRefs = (nodes: PlanNode[], out: { highlight: Set<string>; concept: Set<string>; argument: Set<string> }) => {
  for (const n of nodes ?? []) {
    for (const it of n.items ?? []) {
      const r = it.ref;
      if (r.kind === 'highlight' || r.kind === 'concept' || r.kind === 'argument') out[r.kind].add(r.id);
    }
    planRefs(n.children ?? [], out);
  }
};
const mapBooks = (key: string, m: ArgumentMap): string[] => {
  const out: string[] = [];
  if ((m.kind ?? 'book') === 'book') out.push(key);
  if (m.bookId) out.push(m.bookId);
  for (const b of m.bookIds ?? []) out.push(b);
  return out;
};
/** Mentionne l'espace (rangement ou groupe de cet espace) : entrée de corbeille ou de journal. */
const mentions = (changes: unknown, wsId: string): boolean =>
  Array.isArray(changes) &&
  changes.some((c) => [c?.before, c?.after].some((x) => x && typeof x === 'object' && ((x as { workspaceId?: unknown }).workspaceId === wsId || (x as { id?: unknown }).id === wsId)));

/** Ce qui appartient en propre à l'espace `wsId` (voir l'en-tête). */
export function spaceScope(db: Database, wsId: string): Capsule {
  const wsItems = db.wsItems.filter((i) => i.workspaceId === wsId);
  const groups = db.groups.filter((g) => g.workspaceId === wsId);
  // « Ailleurs » = dans un espace NON chiffré. Les rangements d'un autre espace chiffré ne comptent pas :
  // verrouillé, il est invisible, et l'appartenance ne doit pas dépendre de ce qui est déverrouillé
  // (sinon un contenu scellé reviendrait en clair dès que deux espaces chiffrés sont ouverts ensemble).
  const sealed = new Set(db.workspaces.filter((w) => w.encrypted).map((w) => w.id));
  const plainItems = db.wsItems.filter((i) => i.workspaceId !== wsId && !sealed.has(i.workspaceId));
  const elsewhere = new Set(plainItems.map((i) => `${i.kind}:${i.refId}`));
  const mine = (kind: string) => new Set(wsItems.filter((i) => i.kind === kind && !elsewhere.has(`${kind}:${i.refId}`)).map((i) => i.refId));

  const plans = mine('plan');
  const drafts = mine('draft');
  const args = mine('argument');
  const studies = mine('study');
  const maps = mine('map');
  const books = mine('book');
  // L'écrit d'un plan de l'espace le suit, s'il n'est rangé nulle part ailleurs.
  for (const p of db.plans) if (plans.has(p.id) && p.draftId && !elsewhere.has(`draft:${p.draftId}`) && !db.plans.some((q) => q.id !== p.id && !plans.has(q.id) && q.draftId === p.draftId)) drafts.add(p.draftId);

  // Un livre dont dépend un élément rangé dans un autre espace reste commun.
  const neededElsewhere = new Set<string>();
  for (const i of plainItems) {
    if (i.kind === 'study') {
      const st = db.studies.find((x) => x.id === i.refId);
      if (st) neededElsewhere.add(st.bookId);
    } else if (i.kind === 'argument') {
      const a = db.arguments.find((x) => x.id === i.refId);
      if (a?.bookId) neededElsewhere.add(a.bookId);
    } else if (i.kind === 'map') {
      const m = db.maps[i.refId];
      if (m) for (const b of mapBooks(i.refId, m)) neededElsewhere.add(b);
    }
  }
  for (const b of [...books]) if (neededElsewhere.has(b)) books.delete(b);

  // Ce qui part avec un livre de l'espace : sa carte, ses fiches et reconstructions non rangées ailleurs.
  for (const b of books) if (db.maps[b]) maps.add(b);
  for (const s of db.studies) if (books.has(s.bookId) && !elsewhere.has(`study:${s.id}`)) studies.add(s.id);
  for (const a of db.arguments) if (a.bookId && books.has(a.bookId) && !elsewhere.has(`argument:${a.id}`)) args.add(a.id);
  for (const [k, m] of Object.entries(db.maps)) if (m.kind === 'movement' && m.studyId && studies.has(m.studyId) && !elsewhere.has(`map:${k}`)) maps.add(k);

  const highlights = new Set(db.highlights.filter((h) => books.has(h.bookId)).map((h) => h.id));

  // Concepts : ceux que le contenu de l'espace utilise et que rien d'autre n'utilise.
  const used = new Set<string>();
  const usedOutside = new Set<string>();
  for (const h of db.highlights) for (const c of h.conceptIds ?? []) (highlights.has(h.id) ? used : usedOutside).add(c);
  for (const [k, m] of Object.entries(db.maps)) for (const n of m.nodes ?? []) if (n.conceptId) (maps.has(k) ? used : usedOutside).add(n.conceptId);
  for (const p of db.plans) {
    const r = { highlight: new Set<string>(), concept: new Set<string>(), argument: new Set<string>() };
    planRefs(p.parts, r);
    for (const c of r.concept) (plans.has(p.id) ? used : usedOutside).add(c);
  }
  const concepts = new Set<string>();
  for (const c of db.concepts) {
    const senseBooks = (c.senses ?? []).map((s) => s.bookId).filter((b): b is string => !!b);
    const inSpace = used.has(c.id) || senseBooks.some((b) => books.has(b));
    if (!inSpace || usedOutside.has(c.id) || senseBooks.some((b) => !books.has(b))) continue;
    if ((c.links ?? []).some((l) => usedOutside.has(l.conceptId))) continue;
    concepts.add(c.id);
  }

  const cards = new Set(db.cards.filter((c) => (c.bookId && books.has(c.bookId)) || (c.highlightId && highlights.has(c.highlightId)) || (c.conceptId && concepts.has(c.conceptId))).map((c) => c.id));
  const owned = new Set<string>([...plans, ...drafts, ...args, ...studies, ...maps, ...books, ...highlights, ...concepts, ...cards, ...wsItems.map((i) => i.id), ...groups.map((g) => g.id)]);
  const about = (e: { refId?: string | null; refIds?: string[]; bookId?: string | null; changes?: unknown }) =>
    (!!e.refId && owned.has(e.refId)) || (e.refIds ?? []).some((r) => owned.has(r)) || (!!e.bookId && books.has(e.bookId)) || mentions(e.changes, wsId);

  const mapsOut: Database['maps'] = {};
  for (const k of maps) if (db.maps[k]) mapsOut[k] = db.maps[k];
  return {
    v: 1,
    wsId,
    books: db.books.filter((b) => books.has(b.id)),
    highlights: db.highlights.filter((h) => highlights.has(h.id)),
    concepts: db.concepts.filter((c) => concepts.has(c.id)),
    maps: mapsOut,
    arguments: db.arguments.filter((a) => args.has(a.id)),
    studies: db.studies.filter((s) => studies.has(s.id)),
    plans: db.plans.filter((p) => plans.has(p.id)),
    drafts: db.drafts.filter((d) => drafts.has(d.id)),
    cards: db.cards.filter((c) => cards.has(c.id)),
    groups,
    wsItems,
    bookmarks: db.bookmarks.filter((b) => books.has(b.bookId)),
    trash: db.trash.filter(about),
    activity: db.activity.filter(about),
    mapVersions: (db.mapVersions ?? []).filter((v) => maps.has(v.mapKey)),
  };
}

/** La base sans ce que contient la capsule (tableaux inchangés rendus tels quels : même référence). */
export function withoutCapsule(db: Database, c: Capsule): Database {
  const out = { ...db } as Database;
  const rec = out as unknown as Record<string, unknown>;
  for (const k of ARRAYS) {
    const list = c[k] as { id: string }[];
    if (!list.length) continue;
    const gone = new Set<unknown>(list);
    const ids = new Set(list.map((x) => x.id));
    const cur = (db as unknown as Record<string, { id: string }[] | undefined>)[k] ?? [];
    rec[k] = cur.filter((x) => !gone.has(x) && !ids.has(x.id));
  }
  const keys = Object.keys(c.maps);
  if (keys.length) {
    const maps = { ...db.maps };
    for (const k of keys) delete maps[k];
    out.maps = maps;
  }
  return out;
}

/**
 * Base à écrire : `main` (sans le contenu des espaces chiffrés déverrouillés) et une capsule par espace.
 * Les espaces sont traités dans l'ordre : un élément n'entre que dans une capsule.
 */
export function splitDb(db: Database, wsIds: string[]): { main: Database; capsules: Record<string, Capsule> } {
  let main = db;
  const capsules: Record<string, Capsule> = {};
  for (const id of wsIds) {
    const c = spaceScope(main, id);
    capsules[id] = c;
    main = withoutCapsule(main, c);
  }
  return { main, capsules };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Capsule lue (JSON) : forme vérifiée, tableaux manquants complétés ; null si ce n'en est pas une. */
export function parseCapsule(json: string, wsId: string): Capsule | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(raw) || raw.v !== 1 || raw.wsId !== wsId) return null;
  const out = { v: 1, wsId, maps: {} } as unknown as Capsule;
  const rec = out as unknown as Record<string, unknown>;
  for (const k of ARRAYS) {
    const v = raw[k];
    rec[k] = Array.isArray(v) ? v.filter((x) => isObj(x) && typeof x.id === 'string') : [];
  }
  if (isObj(raw.maps)) {
    const maps: Database['maps'] = {};
    for (const [k, m] of Object.entries(raw.maps)) if (isObj(m) && Array.isArray(m.nodes) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') maps[k] = m as unknown as ArgumentMap;
    out.maps = maps;
  }
  // Rien d'étranger : ce qui est rangé dans un espace l'est dans celui-ci.
  out.wsItems = out.wsItems.filter((i) => i.workspaceId === wsId);
  out.groups = out.groups.filter((g) => g.workspaceId === wsId);
  return out;
}

/** La base avec le contenu d'une capsule (déverrouillage). Un même id : la capsule l'emporte. */
export function mergeCapsule(db: Database, c: Capsule): Database {
  const out = { ...db } as Database;
  const rec = out as unknown as Record<string, unknown>;
  for (const k of ARRAYS) {
    const list = c[k] as { id: string }[];
    if (!list.length) continue;
    const ids = new Set(list.map((x) => x.id));
    const cur = ((db as unknown as Record<string, { id: string }[] | undefined>)[k] ?? []).filter((x) => !ids.has(x.id));
    rec[k] = k === 'activity' ? [...cur, ...list].sort((a, b) => ((b as unknown as { at: number }).at ?? 0) - ((a as unknown as { at: number }).at ?? 0)) : [...cur, ...list];
  }
  if (Object.keys(c.maps).length) out.maps = { ...db.maps, ...c.maps };
  return out;
}

/** Nombre d'éléments visibles d'une capsule (résumé dans l'interface). */
export const capsuleCount = (c: Capsule): number => c.books.length + c.drafts.length + c.plans.length + c.arguments.length + c.studies.length + Object.keys(c.maps).length;
