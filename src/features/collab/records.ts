// ─────────────────────────────────────────────────────────────
// Travailler à plusieurs : réplication en direct des éléments d'un espace partagé (hors texte des écrits,
// qui passe par Yjs : rooms.ts).
//
// - Identifiant commun (gid) : celui de l'élément chez celui qui l'a créé. Un élément reçu par le partage
//   (format « .marginalia », shareMerge.ts) garde `shareOrigin.srcId` : c'est son gid ; un élément créé ici
//   pendant la session reçoit le gid comme id local (s'il est libre). Livre déjà présent chez soi (même
//   SHA-256) : alias de session gid → id local. Une carte de livre a pour gid celui de son livre.
// - Ce qui part : chaque changement local détecté par différence d'instantanés (abonnement au store), en
//   enregistrements { c, g, d | del, tag }. `d` est l'élément traduit en gids. Les cartes partent nœud
//   par nœud et lien par lien (deux personnes déplacent deux cartes à la fois : les deux gagnent).
// - Conflits : dernier qui écrit gagne, par horloge de Lamport (compteur, personne) : tous convergent.
// - Ce qui arrive : appliqué hors de ⌘Z et du journal (applyExternal), sauf les suppressions, placées dans
//   la corbeille de chacun (trashDelete) ; un livre ou un écrit inconnu est demandé à celui qui l'a
//   envoyé (fichier compris), puis créé.
// - Vie privée : chez un invité, les extraits et cartes qu'il avait déjà dans un livre de l'espace (et
//   qui ne viennent pas de la session) ne partent pas, sauf s'il les relie lui-même à un élément partagé.
// ─────────────────────────────────────────────────────────────
import { uid, useStore, type State } from '../../lib/store';
import type {
  ArgumentMap,
  ArgumentReconstruction,
  Book,
  Concept,
  Draft,
  EssayPlan,
  Highlight,
  MapEdge,
  MapNode,
  MapZone,
  PlanNode,
  TextStudy,
  TrashKind,
  WorkspaceGroup,
  WorkspaceItem,
  WorkspaceItemKind,
} from '../../lib/types';

export type Col = 'ws' | 'group' | 'item' | 'book' | 'draft' | 'concept' | 'highlight' | 'study' | 'argument' | 'plan' | 'map' | 'node' | 'edge';
export type Tag = [number, string];
export interface Rec {
  c: Col;
  g: string;
  d?: Record<string, unknown>;
  del?: 1;
  tag: Tag;
  /** Suppression d'un groupe : contenu remonté ('lift') ou emporté ('tree'). */
  mode?: 'lift' | 'tree';
}

const ORDER: Col[] = ['ws', 'group', 'book', 'draft', 'concept', 'highlight', 'study', 'argument', 'plan', 'map', 'node', 'edge', 'item'];
const SEP = '§';
export const keyOf = (c: Col, g: string) => `${c}:${g}`;
export const newer = (a: Tag, b?: Tag | null) => !b || a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 300;

type Any = Record<string, any>;

// ── Champs qui partent, par collection (le reste est propre à chaque ordinateur) ──
const pickKeys = (o: Any, keys: string[]) => {
  const out: Any = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};

export interface Snap {
  c: Col;
  g: string;
  /** Id local (clé de carte pour 'map', « clé§id » pour nœuds et liens). */
  id: string;
  json: string;
  d: Any;
}

export interface RecordSyncOptions {
  /** Espace partagé, ici. */
  workspaceId: string;
  shareId: string;
  me: string;
  /** Envoi d'enregistrements à tous. */
  send(recs: Rec[]): void;
  /** Demande un livre ou un écrit inconnu (fichiers compris) ; résout quand il est créé ici. */
  fetch(c: 'book' | 'draft', g: string, from: string): void;
  /** Avis lisible (« Marc a placé « X » dans la corbeille »). */
  notify?(msg: string): void;
  nameOf?(peer: string): string;
}

/** Réplication des éléments d'un espace partagé. */
export class RecordSync {
  clock = 0;
  tags = new Map<string, Tag>();
  /** Dernière modification connue de chaque élément (ms) : « la dernière gagne » à la réunion. */
  mtimes = new Map<string, number>();
  /** Alias de session : col:gid → id local (livres reconnus par empreinte), et l'inverse. */
  aliasToLocal = new Map<string, string>();
  aliasToGid = new Map<string, string>();
  /** Clés (col:gid) que cet ordinateur garde pour lui (invité : extraits et cartes d'avant la session). */
  privateKeys = new Set<string>();
  base = new Map<string, Snap>();
  private pending: { rec: Rec; from: string }[] = [];
  private fetching = new Set<string>();
  private applying = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsub: (() => void) | null = null;
  private idx = new Map<string, { ref: unknown; map: Map<string, string> }>();
  private stopped = false;

  constructor(readonly o: RecordSyncOptions) {}

  // ── Identifiants communs ──
  private gidLocal(c: Col, localId: string, item?: Any): string {
    const a = this.aliasToGid.get(`${c}:${localId}`);
    if (a) return a;
    return item?.shareOrigin?.srcId ?? localId;
  }
  gidOfBook = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const b = useStore.getState().books.find((x) => x.id === id);
    return this.gidLocal('book', id, b);
  };
  /** Index gid → id local d'une collection (recalculé quand le tableau change). */
  private index(c: Col, s: State = useStore.getState()): Map<string, string> {
    const arr: unknown =
      c === 'map' ? s.maps : c === 'ws' ? s.workspaces : c === 'group' ? s.groups : c === 'item' ? s.wsItems : c === 'book' ? s.books : c === 'draft' ? s.drafts : c === 'concept' ? s.concepts : c === 'highlight' ? s.highlights : c === 'study' ? s.studies : c === 'argument' ? s.arguments : s.plans;
    const hit = this.idx.get(c);
    if (hit && hit.ref === arr) return hit.map;
    const map = new Map<string, string>();
    if (c === 'map') {
      for (const [k, m] of Object.entries(s.maps)) map.set(this.mapGid(k, m), k);
    } else {
      // Un même gid deux fois (paquet importé deux fois) : la copie de ce partage d'abord, sinon la première.
      for (const x of arr as Any[]) {
        const g = this.gidLocal(c, x.id, x);
        const prev = map.get(g);
        if (!prev || (x.shareOrigin?.shareId === this.o.shareId && !(arr as Any[]).find((y) => y.id === prev)?.shareOrigin)) map.set(g, x.id);
      }
    }
    for (const [k, v] of this.aliasToLocal) if (k.startsWith(c + ':')) map.set(k.slice(c.length + 1), v);
    this.idx.set(c, { ref: arr, map });
    return map;
  }
  local(c: Col, g: string | null | undefined, s?: State): string | null {
    if (!g) return null;
    return this.index(c, s).get(g) ?? null;
  }
  mapGid(key: string, m: ArgumentMap): string {
    const kind = m.kind ?? 'book';
    if (kind === 'book' && !m.shareOrigin) return this.gidOfBook(key) ?? key;
    return m.shareOrigin?.srcId ?? key;
  }
  addAlias(c: Col, g: string, localId: string) {
    this.aliasToLocal.set(`${c}:${g}`, localId);
    this.aliasToGid.set(`${c}:${localId}`, g);
    this.idx.delete(c);
    if (c === 'book') this.idx.delete('map');
  }

  // ── Périmètre : ce qui appartient à l'espace partagé ──
  private scope(s: State) {
    const W = this.o.workspaceId;
    const items = s.wsItems.filter((i) => i.workspaceId === W);
    const groups = s.groups.filter((g) => g.workspaceId === W);
    const books = new Set<string>();
    const wholeBooks = new Set<string>();
    const drafts = new Set<string>();
    const plans = new Set<string>();
    const args = new Set<string>();
    const studies = new Set<string>();
    const maps = new Set<string>();
    for (const it of items) {
      if (it.kind === 'book') wholeBooks.add(it.refId);
      else if (it.kind === 'draft') drafts.add(it.refId);
      else if (it.kind === 'plan') plans.add(it.refId);
      else if (it.kind === 'argument') args.add(it.refId);
      else if (it.kind === 'study') studies.add(it.refId);
      else if (it.kind === 'map') maps.add(it.refId);
    }
    for (const b of wholeBooks) {
      books.add(b);
      if (s.maps[b]) maps.add(b);
    }
    for (const id of studies) {
      const st = s.studies.find((x) => x.id === id);
      if (st) books.add(st.bookId);
      for (const [k, m] of Object.entries(s.maps)) if (m.kind === 'movement' && m.studyId === id) maps.add(k);
    }
    for (const p of s.plans) if (plans.has(p.id) && p.draftId) drafts.add(p.draftId);
    const hlNeeded = new Set<string>();
    const conceptNeeded = new Set<string>();
    const planRefs = (nodes: PlanNode[]) => {
      for (const n of nodes) {
        for (const it of n.items) {
          if (it.ref.kind === 'highlight') hlNeeded.add(it.ref.id);
          else if (it.ref.kind === 'concept') conceptNeeded.add(it.ref.id);
          else if (it.ref.kind === 'argument') args.add(it.ref.id);
        }
        planRefs(n.children);
      }
    };
    for (const p of s.plans) if (plans.has(p.id)) planRefs(p.parts);
    // Portails d'un niveau : la carte vers laquelle mène une carte partagée.
    for (const k of [...maps]) for (const n of s.maps[k]?.nodes ?? []) if (n.portal && s.maps[n.portal]) maps.add(n.portal);
    for (const k of maps) {
      const m = s.maps[k];
      if (!m) continue;
      if ((m.kind ?? 'book') === 'book') books.add(k);
      if (m.bookId) books.add(m.bookId);
      for (const b of m.bookIds ?? []) books.add(b);
      for (const n of m.nodes) {
        if (n.highlightId) hlNeeded.add(n.highlightId);
        if (n.conceptId) conceptNeeded.add(n.conceptId);
      }
    }
    for (const a of s.arguments) {
      if (!args.has(a.id)) continue;
      if (a.bookId) books.add(a.bookId);
      for (const st of [...a.premises, a.conclusion]) if (st.highlightId) hlNeeded.add(st.highlightId);
    }
    const highlights = s.highlights.filter((h) => {
      if (hlNeeded.has(h.id)) return true;
      if (!wholeBooks.has(h.bookId)) return false;
      return !this.privateKeys.has(keyOf('highlight', this.gidLocal('highlight', h.id, h)));
    });
    for (const h of highlights) {
      books.add(h.bookId);
      for (const c of h.conceptIds) conceptNeeded.add(c);
    }
    const okMap = (k: string) => {
      const m = s.maps[k];
      if (!m) return false;
      return !this.privateKeys.has(keyOf('map', this.mapGid(k, m)));
    };
    return {
      groups,
      items,
      books: s.books.filter((b) => books.has(b.id)),
      drafts: s.drafts.filter((d) => drafts.has(d.id)),
      concepts: s.concepts.filter((c) => conceptNeeded.has(c.id)),
      highlights,
      studies: s.studies.filter((x) => studies.has(x.id)),
      arguments: s.arguments.filter((a) => args.has(a.id)),
      plans: s.plans.filter((p) => plans.has(p.id)),
      maps: [...maps].filter(okMap),
    };
  }

  // ── Traduction id local → gid (départ) ──
  private refOut(c: Col, id: string | null | undefined): string | null {
    if (!id) return null;
    if (c === 'map') {
      const m = useStore.getState().maps[id];
      return m ? this.mapGid(id, m) : id;
    }
    const s = useStore.getState();
    const arr: Any[] = c === 'book' ? s.books : c === 'draft' ? s.drafts : c === 'concept' ? s.concepts : c === 'highlight' ? s.highlights : c === 'study' ? s.studies : c === 'argument' ? s.arguments : c === 'plan' ? s.plans : c === 'group' ? s.groups : [];
    return this.gidLocal(c, id, arr.find((x) => x.id === id));
  }
  private planOut(nodes: PlanNode[]): Any[] {
    return nodes.map((n) => ({
      id: n.id,
      title: n.title,
      note: n.note,
      items: n.items.map((it) => ({ id: it.id, ref: it.ref.kind === 'text' ? it.ref : { kind: it.ref.kind, id: this.refOut(it.ref.kind === 'highlight' ? 'highlight' : it.ref.kind === 'concept' ? 'concept' : 'argument', it.ref.id) } })),
      children: this.planOut(n.children),
    }));
  }
  private nodeOut(n: MapNode): Any {
    const out: Any = { ...n, highlightId: this.refOut('highlight', n.highlightId) };
    if (n.conceptId) out.conceptId = this.refOut('concept', n.conceptId);
    if (n.portal) out.portal = this.refOut('map', n.portal);
    if (n.from) out.from = { mapKey: this.refOut('map', n.from.mapKey), nodeId: n.from.nodeId };
    return out;
  }
  private itemRefCol(kind: WorkspaceItemKind): Col {
    return kind === 'book' ? 'book' : kind === 'draft' ? 'draft' : kind === 'plan' ? 'plan' : kind === 'argument' ? 'argument' : kind === 'study' ? 'study' : 'map';
  }

  /** Instantané du périmètre en enregistrements traduits. */
  snapshot(s: State = useStore.getState()): Map<string, Snap> {
    const out = new Map<string, Snap>();
    const sc = this.scope(s);
    const put = (c: Col, id: string, g: string, d: Any) => out.set(keyOf(c, g), { c, g, id, d, json: JSON.stringify(d) });
    const ws = s.workspaces.find((w) => w.id === this.o.workspaceId);
    if (ws) put('ws', ws.id, this.o.shareId, { name: ws.name, tint: ws.tint });
    for (const g of sc.groups) put('group', g.id, this.gidLocal('group', g.id, g), { name: g.name, order: g.order, parentId: this.refOut('group', g.parentId) });
    for (const it of sc.items) put('item', it.id, this.gidLocal('item', it.id, it), { kind: it.kind, refId: this.refOut(this.itemRefCol(it.kind), it.refId), groupId: this.refOut('group', it.groupId), order: it.order });
    for (const b of sc.books) put('book', b.id, this.gidLocal('book', b.id, b), { ...pickKeys(b, ['title', 'author', 'edition']) });
    for (const d of sc.drafts) put('draft', d.id, this.gidLocal('draft', d.id, d), pickKeys(d, ['title', 'wordGoal', 'template']));
    for (const c of sc.concepts)
      put('concept', c.id, this.gidLocal('concept', c.id, c), {
        ...pickKeys(c, ['name', 'definition', 'programme', 'createdAt']),
        senses: c.senses.map((se) => ({ ...se, bookId: this.refOut('book', se.bookId), highlightIds: se.highlightIds.map((h) => this.refOut('highlight', h)) })),
        links: c.links.map((l) => ({ ...l, conceptId: this.refOut('concept', l.conceptId) })),
      });
    for (const h of sc.highlights)
      put('highlight', h.id, this.gidLocal('highlight', h.id, h), {
        ...pickKeys(h, ['category', 'plain', 'text', 'note', 'noteKind', 'anchor', 'locationLabel', 'printedPage', 'createdAt']),
        bookId: this.refOut('book', h.bookId),
        conceptIds: h.conceptIds.map((c) => this.refOut('concept', c)),
      });
    for (const x of sc.studies) put('study', x.id, this.gidLocal('study', x.id, x), { ...pickKeys(x, ['title', 'probleme', 'these', 'enjeu', 'movements', 'createdAt']), bookId: this.refOut('book', x.bookId) });
    for (const a of sc.arguments) {
      const step = (st: Any) => ({ ...st, highlightId: this.refOut('highlight', st.highlightId) });
      put('argument', a.id, this.gidLocal('argument', a.id, a), { ...pickKeys(a, ['title', 'comment', 'createdAt']), bookId: this.refOut('book', a.bookId), premises: a.premises.map(step), conclusion: step(a.conclusion) });
    }
    for (const p of sc.plans) put('plan', p.id, this.gidLocal('plan', p.id, p), { ...pickKeys(p, ['title', 'sujet', 'definitions', 'problematique', 'conclusion', 'createdAt']), parts: this.planOut(p.parts), draftId: this.refOut('draft', p.draftId) });
    for (const k of sc.maps) {
      const m = s.maps[k];
      const g = this.mapGid(k, m);
      put('map', k, g, {
        ...pickKeys(m, ['kind', 'title', 'movementId', 'zones', 'centralId', 'createdAt']),
        bookId: m.bookId ? this.refOut('book', m.bookId) : '',
        bookIds: (m.bookIds ?? []).map((b) => this.refOut('book', b)),
        studyId: m.studyId ? this.refOut('study', m.studyId) : undefined,
      });
      for (const n of m.nodes) put('node', `${k}${SEP}${n.id}`, `${g}${SEP}${n.id}`, this.nodeOut(n));
      for (const e of m.edges) put('edge', `${k}${SEP}${e.id}`, `${g}${SEP}${e.id}`, { ...e });
    }
    return out;
  }

  // ── Démarrage, arrêt, différences locales ──
  start() {
    this.base = this.snapshot();
    this.unsub = useStore.subscribe((s, prev) => {
      if (this.stopped || this.applying) return;
      if (s.wsItems === prev.wsItems && s.groups === prev.groups && s.workspaces === prev.workspaces && s.highlights === prev.highlights && s.maps === prev.maps && s.concepts === prev.concepts && s.drafts === prev.drafts && s.plans === prev.plans && s.arguments === prev.arguments && s.studies === prev.studies && s.books === prev.books)
        return;
      if (!this.timer) this.timer = setTimeout(() => this.diffNow(), 60);
    });
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsub?.();
  }
  private tick(): Tag {
    return [++this.clock, this.o.me];
  }
  /** Envoie tout de suite les changements locaux en attente. */
  diffNow() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped) return;
    const next = this.snapshot();
    const recs: Rec[] = [];
    const s = useStore.getState();
    for (const [k, v] of next) {
      const prev = this.base.get(k);
      if (prev && prev.json === v.json) continue;
      const tag = this.tick();
      this.tags.set(k, tag);
      this.mtimes.set(k, Date.now());
      recs.push({ c: v.c, g: v.g, d: v.d, tag });
    }
    for (const [k, v] of this.base) {
      if (next.has(k)) continue;
      // Sorti du périmètre sans être supprimé (ex. : livre retiré de l'espace) : rien ne part, sauf pour
      // une référence de l'espace, un groupe, un nœud ou un lien (leur disparition est la modification).
      if (!this.gone(v, s)) continue;
      const tag = this.tick();
      this.tags.set(k, tag);
      this.mtimes.set(k, Date.now());
      const r: Rec = { c: v.c, g: v.g, del: 1, tag };
      if (v.c === 'group') r.mode = (s.trash.find((t) => t.kind === 'group' && t.refId === v.id)?.mode as 'lift' | 'tree') ?? 'lift';
      recs.push(r);
    }
    this.base = next;
    if (recs.length) this.o.send(sortRecs(recs));
  }
  private gone(v: Snap, s: State): boolean {
    switch (v.c) {
      case 'item':
      case 'node':
      case 'edge':
      case 'group':
        return true;
      case 'map':
        return !s.maps[v.id];
      case 'book':
        return false; // jamais supprimé chez les autres : un livre reste dans chaque bibliothèque
      case 'ws':
        return !s.workspaces.some((w) => w.id === v.id);
      default: {
        const col = { draft: s.drafts, concept: s.concepts, highlight: s.highlights, study: s.studies, argument: s.arguments, plan: s.plans }[v.c] as Any[];
        return !col.some((x) => x.id === v.id);
      }
    }
  }

  // ── Arrivée ──
  /** Réunion : applique ces enregistrements quelles que soient les étiquettes (choix déjà faits). */
  force(recs: Rec[], from: string) {
    for (const r of recs) this.tags.delete(keyOf(r.c, r.g));
    this.receive(recs, from);
  }
  /** Nouvelles étiquettes pour des enregistrements à envoyer (ils gagneront partout). */
  stamp(recs: Rec[]): Rec[] {
    return recs.map((r) => {
      const tag = this.tick();
      this.tags.set(keyOf(r.c, r.g), tag);
      this.mtimes.set(keyOf(r.c, r.g), Date.now());
      return { ...r, tag };
    });
  }
  /** Applique des enregistrements reçus (dernier qui écrit gagne). */
  receive(recs: Rec[], from: string) {
    if (this.stopped) return;
    this.diffNow();
    for (const r of recs) if (Array.isArray(r.tag)) this.clock = Math.max(this.clock, Number(r.tag[0]) || 0);
    this.applying++;
    try {
      for (const rec of sortRecs(recs)) this.applyOne(rec, from);
      this.retryPending();
    } finally {
      this.applying--;
    }
    this.base = this.snapshot();
  }
  retryPending() {
    for (let progress = true; progress && this.pending.length; ) {
      progress = false;
      const list = this.pending;
      this.pending = [];
      for (const p of sortRecs(list.map((x) => x.rec)).map((rec) => list.find((x) => x.rec === rec)!)) if (this.applyOne(p.rec, p.from)) progress = true;
    }
  }
  /** Après création d'un livre ou d'un écrit demandé : on reprend ce qui l'attendait. */
  resume() {
    this.applying++;
    try {
      this.retryPending();
    } finally {
      this.applying--;
    }
    this.base = this.snapshot();
  }

  private applyOne(rec: Rec, from: string): boolean {
    const k = keyOf(rec.c, rec.g);
    if (!ORDER.includes(rec.c) || !isStr(rec.g) || !Array.isArray(rec.tag)) return true;
    if (!newer(rec.tag, this.tags.get(k))) return true;
    const st = rec.del ? this.applyDel(rec, from) : this.applyPut(rec, from);
    if (st === 'wait') {
      if (!this.pending.some((p) => p.rec === rec)) this.pending.push({ rec, from });
      return false;
    }
    this.tags.set(k, rec.tag);
    this.mtimes.set(k, Date.now());
    return true;
  }

  /** gid → id local ; `need` reçoit ce qui manque. */
  private inn(c: Col, g: unknown, need: string[]): string | null {
    if (g == null || g === '') return null;
    if (!isStr(g)) return null;
    const l = this.local(c, g);
    if (!l) need.push(keyOf(c, g));
    return l;
  }

  private applyPut(rec: Rec, from: string): 'ok' | 'wait' {
    const d = (rec.d ?? {}) as Any;
    const s = useStore.getState();
    const need: string[] = [];
    const set = (patch: Partial<State>) => s.applyExternal(() => patch);
    const W = this.o.workspaceId;
    const newId = (c: Col, g: string, taken: (id: string) => boolean) => (taken(g) ? uid() : g);
    const originIf = (id: string, g: string) => (id === g ? {} : { shareOrigin: { shareId: this.o.shareId, srcId: g } });
    switch (rec.c) {
      case 'ws': {
        if (!s.workspaces.some((w) => w.id === W)) return 'ok';
        const name = typeof d.name === 'string' && d.name.trim() ? d.name.slice(0, 200) : undefined;
        const tint = typeof d.tint === 'string' && /^--[a-z0-9-]{1,40}$/i.test(d.tint) ? d.tint : undefined;
        set({ workspaces: s.workspaces.map((w) => (w.id === W ? { ...w, ...(name ? { name } : {}), ...(tint ? { tint } : {}) } : w)) });
        return 'ok';
      }
      case 'group': {
        const parentId = d.parentId ? this.inn('group', d.parentId, need) : null;
        if (need.length) return 'wait';
        const cur = this.local('group', rec.g);
        const base = { name: String(d.name ?? 'Groupe').slice(0, 200), order: Number(d.order) || 0, parentId, workspaceId: W };
        if (cur) set({ groups: s.groups.map((x) => (x.id === cur ? { ...x, ...base } : x)) });
        else {
          const id = newId('group', rec.g, (x) => s.groups.some((y) => y.id === x));
          const g: WorkspaceGroup = { id, collapsed: false, ...base, ...originIf(id, rec.g) };
          set({ groups: [...s.groups, g] });
        }
        return 'ok';
      }
      case 'item': {
        const kind = d.kind as WorkspaceItemKind;
        if (!['book', 'draft', 'plan', 'argument', 'study', 'map'].includes(kind)) return 'ok';
        const refCol = this.itemRefCol(kind);
        const refId = this.inn(refCol, d.refId, need);
        const groupId = d.groupId ? this.inn('group', d.groupId, need) : null;
        if (need.length) {
          if (refCol === 'book' || refCol === 'draft') this.askFetch(refCol, String(d.refId), from);
          return 'wait';
        }
        const cur = this.local('item', rec.g);
        const base = { workspaceId: W, kind, refId: refId!, groupId, order: Number(d.order) || 0 };
        if (cur) set({ wsItems: s.wsItems.map((x) => (x.id === cur ? { ...x, ...base } : x)) });
        else {
          // Déjà là (même élément ajouté des deux côtés) : on garde une seule référence.
          if (s.wsItems.some((x) => x.workspaceId === W && x.kind === kind && x.refId === refId)) return 'ok';
          const id = newId('item', rec.g, (x) => s.wsItems.some((y) => y.id === x));
          const it: WorkspaceItem = { id, ...base, ...originIf(id, rec.g) };
          set({ wsItems: [...s.wsItems, it] });
        }
        return 'ok';
      }
      case 'book': {
        const cur = this.local('book', rec.g);
        if (!cur) {
          this.askFetch('book', rec.g, from);
          return 'wait';
        }
        const patch: Partial<Book> = {};
        if (typeof d.title === 'string') patch.title = d.title.slice(0, 500);
        if (typeof d.author === 'string') patch.author = d.author.slice(0, 500);
        if (d.edition && typeof d.edition === 'object') patch.edition = { ...(s.books.find((b) => b.id === cur)?.edition ?? ({} as Book['edition'])), ...pickKeys(d.edition, ['publisher', 'year', 'translator', 'place', 'pageOffset']) };
        set({ books: s.books.map((b) => (b.id === cur ? { ...b, ...patch } : b)) });
        return 'ok';
      }
      case 'draft': {
        const cur = this.local('draft', rec.g);
        if (!cur) {
          this.askFetch('draft', rec.g, from);
          return 'wait';
        }
        const patch: Partial<Draft> = {};
        if (typeof d.title === 'string' && d.title.trim()) patch.title = d.title.slice(0, 300);
        if (typeof d.wordGoal === 'number') patch.wordGoal = d.wordGoal;
        set({ drafts: s.drafts.map((x) => (x.id === cur ? { ...x, ...patch } : x)) });
        return 'ok';
      }
      case 'concept': {
        const senses = (Array.isArray(d.senses) ? d.senses : []).map((se: Any) => ({
          id: String(se.id ?? uid()),
          author: String(se.author ?? ''),
          definition: String(se.definition ?? ''),
          bookId: se.bookId ? this.local('book', se.bookId) : null,
          highlightIds: (Array.isArray(se.highlightIds) ? se.highlightIds : []).map((h: unknown) => this.local('highlight', h as string)).filter(Boolean) as string[],
        }));
        const links = (Array.isArray(d.links) ? d.links : []).map((l: Any) => ({ ...l, conceptId: this.local('concept', l.conceptId) })).filter((l: Any) => l.conceptId) as Concept['links'];
        const base = { name: String(d.name ?? 'Concept').slice(0, 300), definition: String(d.definition ?? ''), programme: d.programme === 'notion' || d.programme === 'repere' ? d.programme : null, senses, links, updatedAt: Date.now() };
        const cur = this.local('concept', rec.g);
        if (cur) set({ concepts: s.concepts.map((x) => (x.id === cur ? { ...x, ...base } : x)) });
        else {
          const id = newId('concept', rec.g, (x) => s.concepts.some((y) => y.id === x));
          const c: Concept = { id, createdAt: Number(d.createdAt) || Date.now(), ...base, ...originIf(id, rec.g) };
          set({ concepts: [...s.concepts, c] });
        }
        return 'ok';
      }
      case 'highlight': {
        const bookId = this.inn('book', d.bookId, need);
        const conceptIds = (Array.isArray(d.conceptIds) ? d.conceptIds : []).map((c: unknown) => this.inn('concept', c, need));
        if (need.length) {
          if (!bookId && isStr(d.bookId)) this.askFetch('book', d.bookId, from);
          return 'wait';
        }
        const a = d.anchor as Any;
        if (!a || (a.kind !== 'html' && a.kind !== 'pdf')) return 'ok';
        const base = {
          bookId: bookId!,
          category: typeof d.category === 'string' ? d.category : null,
          text: String(d.text ?? ''),
          note: String(d.note ?? ''),
          noteKind: typeof d.noteKind === 'string' ? d.noteKind : null,
          conceptIds: conceptIds as string[],
          anchor: a,
          locationLabel: String(d.locationLabel ?? ''),
          printedPage: String(d.printedPage ?? ''),
          updatedAt: Date.now(),
        } as Partial<Highlight>;
        const cur = this.local('highlight', rec.g);
        if (cur)
          set({
            highlights: s.highlights.map((x) => {
              if (x.id !== cur) return x;
              const n = { ...x, ...base } as Highlight;
              if (d.plain) n.plain = true;
              else delete n.plain;
              return n;
            }),
          });
        else {
          const id = newId('highlight', rec.g, (x) => s.highlights.some((y) => y.id === x));
          const h = { id, createdAt: Number(d.createdAt) || Date.now(), ...base, ...(d.plain ? { plain: true } : {}), ...originIf(id, rec.g) } as Highlight;
          set({ highlights: [...s.highlights, h] });
        }
        return 'ok';
      }
      case 'study': {
        const bookId = this.inn('book', d.bookId, need);
        if (need.length) return 'wait';
        const base = { bookId: bookId!, title: String(d.title ?? ''), probleme: String(d.probleme ?? ''), these: String(d.these ?? ''), enjeu: String(d.enjeu ?? ''), movements: Array.isArray(d.movements) ? d.movements : [], updatedAt: Date.now() };
        const cur = this.local('study', rec.g);
        if (cur) set({ studies: s.studies.map((x) => (x.id === cur ? { ...x, ...base } : x)) });
        else {
          const id = newId('study', rec.g, (x) => s.studies.some((y) => y.id === x));
          set({ studies: [...s.studies, { id, createdAt: Number(d.createdAt) || Date.now(), ...base, ...originIf(id, rec.g) } as TextStudy] });
        }
        return 'ok';
      }
      case 'argument': {
        const bookId = d.bookId ? this.inn('book', d.bookId, need) : null;
        const step = (x: Any) => ({ id: String(x?.id ?? uid()), text: String(x?.text ?? ''), implicit: !!x?.implicit, highlightId: x?.highlightId ? this.inn('highlight', x.highlightId, need) : null });
        const premises = (Array.isArray(d.premises) ? d.premises : []).map(step);
        const conclusion = step(d.conclusion);
        if (need.length) return 'wait';
        const base = { title: String(d.title ?? ''), comment: String(d.comment ?? ''), bookId, premises, conclusion, updatedAt: Date.now() };
        const cur = this.local('argument', rec.g);
        if (cur) set({ arguments: s.arguments.map((x) => (x.id === cur ? { ...x, ...base } : x)) });
        else {
          const id = newId('argument', rec.g, (x) => s.arguments.some((y) => y.id === x));
          set({ arguments: [...s.arguments, { id, createdAt: Number(d.createdAt) || Date.now(), ...base, ...originIf(id, rec.g) } as ArgumentReconstruction] });
        }
        return 'ok';
      }
      case 'plan': {
        const nodes = (list: unknown): PlanNode[] =>
          (Array.isArray(list) ? list : []).map((n: Any) => ({
            id: String(n.id ?? uid()),
            title: String(n.title ?? ''),
            note: String(n.note ?? ''),
            items: (Array.isArray(n.items) ? n.items : []).flatMap((it: Any): PlanNode['items'] => {
              const ref = it?.ref;
              if (!ref) return [];
              if (ref.kind === 'text') return [{ id: String(it.id ?? uid()), ref: { kind: 'text' as const, text: String(ref.text ?? '') } }];
              const c: Col = ref.kind === 'highlight' ? 'highlight' : ref.kind === 'concept' ? 'concept' : 'argument';
              const l = this.inn(c, ref.id, need);
              return l ? [{ id: String(it.id ?? uid()), ref: { kind: ref.kind as 'highlight' | 'concept' | 'argument', id: l } }] : [];
            }),
            children: nodes(n.children),
          }));
        const parts = nodes(d.parts);
        const draftId = d.draftId ? this.local('draft', d.draftId) : null;
        if (need.length) return 'wait';
        const base = { title: String(d.title ?? ''), sujet: String(d.sujet ?? ''), definitions: String(d.definitions ?? ''), problematique: String(d.problematique ?? ''), conclusion: String(d.conclusion ?? ''), parts, draftId, updatedAt: Date.now() };
        const cur = this.local('plan', rec.g);
        if (cur) set({ plans: s.plans.map((x) => (x.id === cur ? { ...x, ...base } : x)) });
        else {
          const id = newId('plan', rec.g, (x) => s.plans.some((y) => y.id === x));
          set({ plans: [...s.plans, { id, createdAt: Number(d.createdAt) || Date.now(), ...base, ...originIf(id, rec.g) } as EssayPlan] });
        }
        return 'ok';
      }
      case 'map': {
        const kind = d.kind === 'board' || d.kind === 'movement' ? d.kind : 'book';
        const bookIds = (Array.isArray(d.bookIds) ? d.bookIds : []).map((b: unknown) => this.local('book', b as string)).filter(Boolean) as string[];
        const zones: MapZone[] | undefined = Array.isArray(d.zones) ? d.zones.filter((z: Any) => z && typeof z === 'object').map((z: Any) => ({ ...z, color: typeof z.color === 'string' && /^(--[a-z0-9-]{1,40}|#[0-9a-f]{3,8})$/i.test(z.color) ? z.color : '--cat-these' }) as MapZone) : undefined;
        const cur = this.local('map', rec.g);
        if (cur) {
          const m = s.maps[cur];
          set({ maps: { ...s.maps, [cur]: { ...m, ...(typeof d.title === 'string' && m.kind === 'board' ? { title: d.title } : {}), ...(zones ? { zones } : {}), ...(typeof d.centralId === 'string' ? { centralId: d.centralId } : {}), bookIds: m.kind === 'board' ? bookIds : m.bookIds, updatedAt: Date.now() } } });
          return 'ok';
        }
        let key: string;
        let bookId = '';
        let studyId: string | undefined;
        if (kind === 'book') {
          const b = this.inn('book', rec.g, need);
          if (need.length) {
            this.askFetch('book', rec.g, from);
            return 'wait';
          }
          key = b!;
          bookId = b!;
          if (s.maps[key]) return 'ok';
        } else if (kind === 'movement') {
          studyId = this.inn('study', d.studyId, need) ?? undefined;
          bookId = this.inn('book', d.bookId, need) ?? '';
          if (need.length) return 'wait';
          key = `mv-${studyId}-${String(d.movementId ?? uid())}`;
        } else key = s.maps[rec.g] ? `board-${uid()}` : rec.g;
        const now = Date.now();
        const m: ArgumentMap = {
          ...(kind === 'book' ? {} : { id: key, kind }),
          bookId,
          nodes: [],
          edges: [],
          viewport: null,
          ...(typeof d.title === 'string' ? { title: d.title } : {}),
          ...(kind !== 'book' ? { bookIds } : {}),
          ...(studyId ? { studyId, movementId: String(d.movementId ?? '') } : {}),
          ...(zones ? { zones } : {}),
          createdAt: Number(d.createdAt) || now,
          updatedAt: now,
          ...(key === rec.g || kind === 'book' ? {} : { shareOrigin: { shareId: this.o.shareId, srcId: rec.g } }),
        };
        set({ maps: { ...s.maps, [key]: m } });
        return 'ok';
      }
      case 'node':
      case 'edge': {
        const at = rec.g.lastIndexOf(SEP);
        if (at <= 0) return 'ok';
        const mapG = rec.g.slice(0, at);
        const subId = rec.g.slice(at + SEP.length);
        const key = this.inn('map', mapG, need);
        if (rec.c === 'node') {
          const hl = d.highlightId ? this.inn('highlight', d.highlightId, need) : null;
          const co = d.conceptId ? this.inn('concept', d.conceptId, need) : null;
          if (need.length) return 'wait';
          const m = s.maps[key!];
          const node: MapNode = { ...(d as unknown as MapNode), id: subId, highlightId: hl, text: String(d.text ?? ''), x: Number(d.x) || 0, y: Number(d.y) || 0 };
          if (co) node.conceptId = co;
          else delete node.conceptId;
          const portal = d.portal ? this.local('map', d.portal as string) : null;
          if (portal) node.portal = portal;
          else delete node.portal;
          const fromKey = d.from && typeof d.from === 'object' ? this.local('map', (d.from as Any).mapKey) : null;
          if (fromKey) node.from = { mapKey: fromKey, nodeId: String((d.from as Any).nodeId ?? '') };
          else delete node.from;
          if (node.color !== undefined && !(typeof node.color === 'string' && /^(--[a-z0-9-]{1,40}|#[0-9a-f]{3,8})$/i.test(node.color))) delete node.color;
          const exists = m.nodes.some((n) => n.id === subId);
          set({ maps: { ...s.maps, [key!]: { ...m, nodes: exists ? m.nodes.map((n) => (n.id === subId ? node : n)) : [...m.nodes, node], updatedAt: Date.now() } } });
        } else {
          if (need.length) return 'wait';
          const m = s.maps[key!];
          const e: MapEdge = { ...(d as unknown as MapEdge), id: subId };
          const exists = m.edges.some((x) => x.id === subId);
          set({ maps: { ...s.maps, [key!]: { ...m, edges: exists ? m.edges.map((x) => (x.id === subId ? e : x)) : [...m.edges, e], updatedAt: Date.now() } } });
        }
        return 'ok';
      }
    }
    return 'ok';
  }

  private applyDel(rec: Rec, from: string): 'ok' | 'wait' {
    const s = useStore.getState();
    const who = this.o.nameOf?.(from) ?? 'Quelqu’un';
    const trash = (kind: TrashKind, id: string, mode?: 'lift' | 'tree') => {
      const e = s.trashDelete(kind, id, { silent: true, ...(mode ? { mode } : {}) });
      if (e && kind !== 'highlight') this.o.notify?.(`${who} a placé « ${e.title} » dans la corbeille`);
      else if (e) this.o.notify?.(`${who} a placé un extrait dans la corbeille`);
    };
    switch (rec.c) {
      case 'item': {
        const id = this.local('item', rec.g);
        if (id) s.applyExternal((cur) => ({ wsItems: cur.wsItems.filter((x) => x.id !== id) }));
        return 'ok';
      }
      case 'group': {
        const id = this.local('group', rec.g);
        if (id) trash('group', id, rec.mode === 'tree' ? 'tree' : 'lift');
        return 'ok';
      }
      case 'node':
      case 'edge': {
        const at = rec.g.lastIndexOf(SEP);
        const key = at > 0 ? this.local('map', rec.g.slice(0, at)) : null;
        const sub = rec.g.slice(at + SEP.length);
        if (!key || !s.maps[key]) return 'ok';
        s.applyExternal((cur) => {
          const m = cur.maps[key];
          if (!m) return null;
          return { maps: { ...cur.maps, [key]: rec.c === 'node' ? { ...m, nodes: m.nodes.filter((n) => n.id !== sub), edges: m.edges.filter((e) => e.source !== sub && e.target !== sub) } : { ...m, edges: m.edges.filter((e) => e.id !== sub) } } };
        });
        return 'ok';
      }
      case 'map': {
        const key = this.local('map', rec.g);
        const m = key ? s.maps[key] : null;
        if (key && m && (m.kind === 'board' || m.kind === 'movement')) trash('map', key);
        return 'ok';
      }
      case 'ws': {
        if (s.workspaces.some((w) => w.id === this.o.workspaceId)) trash('workspace', this.o.workspaceId);
        return 'ok';
      }
      case 'book':
        return 'ok';
      default: {
        const id = this.local(rec.c, rec.g);
        if (id) trash(rec.c as TrashKind, id);
        return 'ok';
      }
    }
  }

  private askFetch(c: 'book' | 'draft', g: string, from: string) {
    const k = keyOf(c, g);
    if (this.fetching.has(k)) return;
    this.fetching.add(k);
    this.o.fetch(c, g, from);
  }
  fetchDone(c: Col, g: string) {
    this.fetching.delete(keyOf(c, g));
  }

  // ── Resynchronisation (invité revenu) ──
  /** Enregistrement courant d'une clé (ou suppression si l'élément n'existe plus ici). */
  current(k: string): Rec | null {
    const tag = this.tags.get(k);
    if (!tag) return null;
    const snap = this.base.get(k);
    const [c, ...rest] = k.split(':');
    if (snap) return { c: snap.c, g: snap.g, d: snap.d, tag };
    return { c: c as Col, g: rest.join(':'), del: 1, tag };
  }
  /** Ce que l'autre n'a pas (ou a en plus ancien), d'après ses étiquettes. */
  newerThan(theirs: Map<string, Tag>): Rec[] {
    this.diffNow();
    const out: Rec[] = [];
    for (const [k, tag] of this.tags) if (newer(tag, theirs.get(k))) {
      const r = this.current(k);
      if (r) out.push(r);
    }
    return sortRecs(out);
  }
}

export function sortRecs(recs: Rec[]): Rec[] {
  const rank = (r: Rec) => (r.del ? 100 + (ORDER.length - ORDER.indexOf(r.c)) : ORDER.indexOf(r.c));
  return [...recs].sort((a, b) => rank(a) - rank(b));
}
