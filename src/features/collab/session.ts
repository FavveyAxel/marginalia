// ─────────────────────────────────────────────────────────────
// Travailler à plusieurs : la session (chargée à la demande).
//
//  Hôte  : ouvre la session (code), accepte ou refuse chaque demande, envoie l'état initial à chaque
//          invité (paquet « .marginalia » de l'espace, livres qu'il n'a pas compris), relaie et
//          coordonne les écrits (rooms.ts), arrête la session pour tous.
//  Invité: trouve la session (code), attend l'accord, reçoit l'espace (créé chez lui s'il ne l'a pas),
//          puis tout part et arrive en direct ; coupé, il continue seul et se reconnecte.
//
// Messages (wire.ts), en plus de ceux de rooms.ts ('y', 'room-join', 'room-ok', 'room-leave', 'rooms', 'docx') :
//  invité → hôte : 'hi' { haveWs }, 'want' { books }, 'resync' { tags }, 'flushed',
//                  'fetch' { c: 'prove', items: [{ gid, nonce }] } (défi de possession, voir plus bas)
//  hôte → invité : 'books' { list, proofs }, 'proof' { items: [{ gid, mac }] }, 'state' { tags, keys, recs, rooms } + paquet,
//                  'resync-reply' { tags, recs }, 'stopping'
//  tous         : 'recs' { recs } (éléments de l'espace, records.ts), 'fetch' / 'files' (livre ou écrit inconnu)
// ─────────────────────────────────────────────────────────────
import { host, type CollabEvent, type CollabMember } from '../../lib/platform';
import { flushPendingSave, sealedBookIds, setWriteGuard, useStore, type State } from '../../lib/store';
import type { Book, Draft, WorkspaceItem, WorkspaceItemKind } from '../../lib/types';
import JSZip from 'jszip';
import { bookExtraFiles, bookFingerprint, bookSourceFiles, buildSharePackage, fingerprintOf, findLocalBook, findLocalVideoBook, openSharePackage, safeVideoInfo, sha256Hex, shareableDocx, withoutFile } from '../share/sharePackage';
import { importSharePackage } from '../share/shareMerge';
import { errorMessage } from '../share/shareUi';
import { ALL_PERMS, permText, samePerm, useCollab, type CollabPerm, type CollabProfile } from './collabState';
import { cleanAdopted, keyOf, newer, RecordSync, type AdoptedMeta, type Col, type Rec, type Tag } from './records';
import { Rooms } from './rooms';
import { joinFiles, pack, splitFiles, unpack, type Head } from './wire';
import { reunite } from './reunion';
import { knownMtimes, rememberedAdopted, stopWatch } from './memory';
import { addVersionFromLibrary } from '../editor/versions';
import { onCursorMessage, setCursorBridge } from './cursors';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Session {
  role: 'host' | 'guest';
  me: string;
  profile: CollabProfile;
  workspaceId: string | null;
  shareId: string;
  title: string;
  records: RecordSync | null;
  rooms: Rooms;
  /** Invité : messages arrivés avant que l'espace soit prêt. */
  queue: { from: string; head: Head; body: Uint8Array }[];
  ready: boolean;
  hostName: string;
  flushed: Set<string>;
  fetchTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** Livres et écrits demandés (« c:g ») : seuls ceux-là sont acceptés à leur arrivée (onFiles). */
  asked: Set<string>;
  /** Demandes de livre ou d'écrit reçues avant de l'avoir soi-même (« c:g » → demandeurs) : servies à son arrivée. */
  waitingFetch: Map<string, Set<string>>;
  /** Invité : ce qui était déjà dans la bibliothèque à l'arrivée (« kind:id »), gardé quoi qu'il arrive. */
  before?: Set<string>;
  /** Invité : livres de l'hôte (son id → gid et fiche), d'après sa liste à l'arrivée. */
  hostBooks?: Map<string, { gid: string; meta: AdoptedMeta | null }>;
  /** Invité : livres de l'hôte reconnus ici avec preuve de possession (gid → id local). */
  bookAlias?: [string, string][];
  /** Invité : réponses attendues au défi de possession (voir askProofs). */
  proofWait?: { nonces: Map<string, Uint8Array>; macs: Map<string, string>; left: number; done: () => void };
  /** Hôte : défis de possession reçus de chaque invité pendant la session (limite, voir hostProve). */
  proves?: Map<string, number>;
}

const KEEP_KINDS = ['book', 'draft', 'plan', 'argument', 'study'] as const;
/** Fichiers d'un livre qu'un invité envoie en un message (l'hôte refuse au-delà de 256 Mo). */
const GUEST_FILES_MAX = 240 * 1024 * 1024;
/** Tout ce qui est dans la bibliothèque maintenant, en « kind:id » (cartes : leur clé). */
/**
 * Ce qui appartient à l'invité au début de la session : sa bibliothèque, sauf ce qui vient déjà de ce
 * partage (session précédente). Pris avant toute arrivée : un de ses livres complété pendant la session
 * (et relié au partage à ce moment-là) reste le sien.
 */
function libraryKeys(shareId: string): Set<string> {
  const st = useStore.getState() as unknown as Record<string, { id: string; shareOrigin?: { shareId: string } }[]> & { maps: Record<string, { shareOrigin?: { shareId: string } }> };
  const out = new Set<string>();
  const mine = (x: { shareOrigin?: { shareId: string } } | undefined) => x?.shareOrigin?.shareId !== shareId;
  const col: Record<(typeof KEEP_KINDS)[number], string> = { book: 'books', draft: 'drafts', plan: 'plans', argument: 'arguments', study: 'studies' };
  for (const k of KEEP_KINDS) for (const x of st[col[k]] ?? []) if (mine(x)) out.add(`${k}:${x.id}`);
  for (const [id, m] of Object.entries(st.maps ?? {})) if (mine(m)) out.add(`map:${id}`);
  for (const h of (st as unknown as { highlights: { id: string; shareOrigin?: { shareId: string } }[] }).highlights ?? []) if (mine(h)) out.add(`highlight:${h.id}`);
  return out;
}
/**
 * Ce qu'un invité retirerait en ne gardant pas l'espace : les éléments de l'espace arrivés par ce partage
 * (maintenant ou lors d'une session précédente) ou créés pendant la session, et qui ne servent à aucun
 * autre espace. Ce qu'il avait déjà dans sa bibliothèque (`before`, voir libraryKeys) reste.
 */
function sessionTargets(wsId: string, shareId: string, before: Set<string>): { kind: WorkspaceItemKind | 'highlight'; id: string }[] {
  const st = useStore.getState() as unknown as Record<string, { id: string; shareOrigin?: { shareId: string } }[]> & {
    wsItems: WorkspaceItem[];
    maps: Record<string, { shareOrigin?: { shareId: string } }>;
  };
  const col: Record<string, string> = { book: 'books', draft: 'drafts', plan: 'plans', argument: 'arguments', study: 'studies' };
  const out: { kind: WorkspaceItemKind | 'highlight'; id: string }[] = [];
  for (const it of st.wsItems.filter((i) => i.workspaceId === wsId)) {
    if (st.wsItems.some((o) => o.workspaceId !== wsId && o.kind === it.kind && o.refId === it.refId)) continue;
    const rec = it.kind === 'map' ? st.maps[it.refId] : (st[col[it.kind]] ?? []).find((x) => x.id === it.refId);
    if (!rec) continue;
    if (!before.has(`${it.kind}:${it.refId}`)) out.push({ kind: it.kind, id: it.refId });
  }
  // Livres gardés (ils étaient déjà là) : les extraits arrivés par le partage, ou faits pendant la session, partent ;
  // ceux de l'invité restent.
  const gone = new Set(out.filter((t) => t.kind === 'book').map((t) => t.id));
  const kept = new Set(st.wsItems.filter((i) => i.workspaceId === wsId && i.kind === 'book' && !gone.has(i.refId)).map((i) => i.refId));
  const hls = (st as unknown as { highlights: { id: string; bookId: string; shareOrigin?: { shareId: string } }[] }).highlights ?? [];
  for (const h of hls) if (kept.has(h.bookId) && !before.has(`highlight:${h.id}`)) out.push({ kind: 'highlight', id: h.id });
  return out;
}

let S: Session | null = null;
let installed = false;
const net = () => host.collabNet!;
const toast = (m: string, t: 'info' | 'error' | 'success' = 'info') => useStore.getState().toast(m, t);
const nameOf = (id: string) => useCollab.getState().members.find((m) => m.id === id)?.name ?? (id === 'h' ? (S?.hostName ?? 'L’hôte') : 'Quelqu’un');

// Permission des invités (choisie par l'hôte) : ce qu'un invité n'a pas le droit de modifier ne part pas
// de chez lui (l'hôte le refuse aussi de son côté, electron/collab-net.cjs).
const COL_PERM: Partial<Record<string, keyof CollabPerm>> = { highlight: 'notes', concept: 'notes', draft: 'drafts', map: 'maps', node: 'maps', edge: 'maps', ws: 'organize', group: 'organize', item: 'organize', book: 'organize', plan: 'organize', argument: 'organize', study: 'organize' };
const ALWAYS_OUT = new Set(['cur', 'hi', 'want', 'resync', 'flushed', 'fetch', 'files', 'room-join', 'room-leave']);
/** Ce que l'invité tentait sans la permission de l'hôte : message affiché, l'écriture n'a pas lieu. */
const BLOCKED: Record<keyof CollabPerm, string> = {
  notes: 'L’hôte ne vous a pas permis d’ajouter des extraits ou des notes dans cet espace.',
  drafts: 'L’hôte ne vous a pas permis de modifier les écrits de cet espace.',
  maps: 'L’hôte ne vous a pas permis de modifier les cartes de cet espace.',
  organize: 'L’hôte ne vous a pas permis d’ajouter ou de ranger des éléments dans cet espace.',
};
const SCOPE_COLS = ['workspaces', 'groups', 'wsItems', 'books', 'drafts', 'highlights', 'concepts', 'studies', 'arguments', 'plans', 'maps'] as const;
let lastBlocked = { msg: '', at: 0 };
/**
 * Invité à qui l'hôte n'a pas tout permis : une modification de l'espace partagé qui ne serait pas
 * transmise (l'hôte la refuse, electron/collab-net.cjs) est refusée ici aussi, avec un message, au lieu
 * de rester chez lui seul sans qu'il le sache.
 */
function guestWriteGuard(prev: State, next: State): boolean {
  const s = S;
  if (!s || s.role !== 'guest' || !s.ready || !s.records || s.records.applyingRemote) return false;
  const perm = useCollab.getState().perm;
  if (samePerm(perm, ALL_PERMS)) return false;
  if (SCOPE_COLS.every((c) => prev[c] === next[c])) return false;
  const bad = s.records.forbidden(prev, next, (c) => {
    const k = COL_PERM[c];
    return !k || perm[k];
  });
  if (!bad) return false;
  const msg = BLOCKED[COL_PERM[bad]!];
  const now = Date.now();
  if (msg !== lastBlocked.msg || now - lastBlocked.at > 2500) queueMicrotask(() => toast(msg, 'info'));
  lastBlocked = { msg, at: now };
  return true;
}

function allowedOut(head: Head, body?: Uint8Array): Head | null {
  const s = S;
  const perm = useCollab.getState().perm;
  if (!s || s.role !== 'guest' || samePerm(perm, ALL_PERMS)) return head;
  if (ALWAYS_OUT.has(head.t)) return head;
  if (head.t === 'y') return perm.drafts || (body && (body[0] === 1 || (body[0] === 0 && body[1] === 0))) ? head : null;
  if (head.t === 'docx') return perm.drafts ? head : null;
  if (head.t === 'recs' && Array.isArray(head.recs)) {
    const recs = (head.recs as Rec[]).filter((r) => COL_PERM[r.c] && perm[COL_PERM[r.c]!]);
    return recs.length ? { ...head, recs } : null;
  }
  return null;
}

function send(to: string, head0: Head, body?: Uint8Array) {
  const head = allowedOut(head0, body);
  if (!head) return;
  void net()
    .send(to, pack(head, body))
    .catch((e) => console.warn('collab : envoi', e));
}

/** Identifiant de partage d'un espace (le même que le partage par copie). */
export function shareIdOf(wsId: string): string {
  const ws = useStore.getState().workspaces.find((w) => w.id === wsId);
  return ws?.shareOrigin?.shareId ?? `ws-${wsId}`;
}
/** Espace local correspondant à un identifiant de partage (déjà reçu, ou le mien). */
export function workspaceForShare(shareId: string): string | null {
  const s = useStore.getState();
  return s.workspaces.find((w) => w.shareOrigin?.shareId === shareId)?.id ?? s.workspaces.find((w) => `ws-${w.id}` === shareId)?.id ?? null;
}

/** Réglage « Collaborer par Internet » appliqué au processus principal (avant d'ouvrir ou de chercher). */
export async function applyInternet() {
  await host.collabNet
    ?.internet?.(useStore.getState().settings.collabInternet !== false)
    .catch(() => undefined);
}

function install() {
  if (installed || !host.collabNet) return;
  installed = true;
  net().onEvent((e) => void onEvent(e));
}

function makeRooms(role: 'host' | 'guest'): Rooms {
  const rooms = new Rooms({
    me: () => S?.me ?? (role === 'host' ? 'h' : '?'),
    isHost: role === 'host',
    send,
    user: () => S!.profile,
    hostName: () => S?.hostName ?? 'l’hôte',
    // Écrit reçu (.docx) : seulement un écrit de l'espace partagé, jamais le reste de la bibliothèque.
    draftLocal: (g) => S?.records?.sharedLocal('draft', g) ?? null,
    draftGid: (id) => {
      const d = useStore.getState().drafts.find((x) => x.id === id);
      return d?.shareOrigin?.srcId ?? id;
    },
  });
  rooms.onView = () => useCollab.setState({ rooms: { ...rooms.view } });
  return rooms;
}

function makeRecords(s: Session, workspaceId: string): RecordSync {
  return new RecordSync({
    workspaceId,
    shareId: s.shareId,
    me: s.me,
    send: (recs) => send('all', { t: 'recs', recs }),
    fetch: (c, g, from) => askFetch(c, g, from),
    notify: (m) => toast(m, 'info'),
    nameOf,
  });
}

/** Pointeurs en direct (cursors.ts) : même canal chiffré, seulement pour les cartes et livres de l'espace. */
function plugCursors(s: Session) {
  setCursorBridge({
    send: (head) => {
      if (S === s) send('all', head);
    },
    gid: (c, id) => {
      const r = s.records;
      if (S !== s || !r) return null;
      if (c === 'map') {
        const m = useStore.getState().maps[id];
        if (!m) return null;
        const g = r.mapGid(id, m);
        return r.base.has(keyOf('map', g)) ? g : null;
      }
      const g = r.gidOfBook(id);
      return g && r.base.has(keyOf('book', g)) ? g : null;
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Hôte
// ─────────────────────────────────────────────────────────────
export async function startHost(workspaceId: string, profile: CollabProfile, maxPeople = 6, perm: CollabPerm = ALL_PERMS): Promise<void> {
  install();
  if (S) await stopSession();
  const ws = useStore.getState().workspaces.find((w) => w.id === workspaceId);
  if (!ws) throw new Error('Cet espace n’existe plus.');
  useCollab.setState({ phase: 'starting', role: 'host', workspaceId, error: null });
  const shareId = shareIdOf(workspaceId);
  const s: Session = { role: 'host', me: 'h', profile, workspaceId, shareId, title: ws.name, records: null, rooms: makeRooms('host'), queue: [], ready: true, hostName: profile.name, flushed: new Set(), fetchTimers: new Map(), waitingFetch: new Map(), asked: new Set() };
  S = s;
  try {
    await s.rooms.ready(); // moteur Yjs prêt avant la première demande
    await applyInternet();
    const info = await net().hostStart({ title: ws.name, shareId }, { ...profile, maxPeople, perm });
    if (S !== s) return;
    stopWatch(shareId);
    s.records = makeRecords(s, workspaceId);
    for (const [k, t] of Object.entries(await knownMtimes(shareId))) s.records.mtimes.set(k, t);
    // Livres adoptés grâce au fichier d'un invité (onFiles) lors d'une session précédente : c'est toujours
    // la fiche de cet invité qui circule, jamais la nôtre (avant : gardée en mémoire seulement, perdue au
    // redémarrage de la session).
    for (const [id, meta] of await rememberedAdopted(shareId)) if (useStore.getState().books.some((b) => b.id === id)) s.records.adopted.set(id, meta);
    s.records.start();
    plugCursors(s);
    useCollab.setState({ phase: 'live', role: 'host', me: 'h', workspaceId, shareId, title: ws.name, members: info.members ?? [], requests: [], code: info.code ?? null, codeState: info.codeState ?? 'open', addresses: info.addresses ?? [], internet: !!info.internet, maxPeople: info.maxPeople ?? maxPeople, perm: info.perm ?? perm });
  } catch (e) {
    if (S === s) S = null;
    useCollab.setState({ phase: 'idle', role: null, workspaceId: null, error: errorMessage(e) });
    throw e;
  }
}

export async function acceptRequest(reqId: string) {
  const ok = await net().hostAccept(reqId);
  useCollab.setState((st) => ({ requests: st.requests.filter((r) => r.reqId !== reqId) }));
  if (!ok) toast('Cette demande n’est plus valable (ou l’espace est complet).', 'error');
}
export async function rejectRequest(reqId: string) {
  await net().hostReject(reqId);
  useCollab.setState((st) => ({ requests: st.requests.filter((r) => r.reqId !== reqId) }));
}
/** Hôte : retirer une personne de la session. Ce qu'elle a déjà reçu reste chez elle. */
export async function removeMember(memberId: string) {
  const m = useCollab.getState().members.find((x) => x.id === memberId && !x.host);
  if (!m) return false;
  const ok = await net().hostRemove(memberId);
  if (ok) toast(`${m.name} ne fait plus partie de la session`, 'info');
  else toast(`${m.name} n’est déjà plus dans la session.`, 'info');
  return ok;
}
/** Hôte : nombre de places de la session (2 à 6), jamais moins que les présents. */
/** Hôte : ce que les invités peuvent faire (une permission pour toute la session). */
export async function setPerm(p: CollabPerm) {
  const info = await net().hostSetPerm?.(p);
  if (info?.perm) useCollab.setState({ perm: info.perm });
}

export async function setMaxPeople(n: number) {
  const info = await net().hostSetMax?.(n);
  if (info?.maxPeople) useCollab.setState({ maxPeople: info.maxPeople });
}

export async function newCode() {
  await applyInternet();
  const info = await net().hostNewCode();
  useCollab.setState({ code: info.code ?? null, codeState: info.codeState ?? 'open', internet: !!info.internet });
}

/** Hôte : l'état initial demandé par un invité. */
async function hostSendBooks(to: string) {
  const s = S!;
  const st = useStore.getState();
  // Tous les livres du périmètre (rangés dans l'espace, ou cités par une carte, un argument, une fiche) :
  // ce sont ceux du paquet ; chacun peut ainsi être reconnu chez l'invité avec preuve de possession.
  const list: { id: string; gid: string; sha256: string | null; size: number; title: string; author: string; edition: Book['edition'] }[] = [];
  for (const b of st.books) {
    if (!s.records!.inScope('book', b.id)) continue;
    const fp = await bookFingerprint(b);
    // La fiche qui circule pour un livre adopté est celle du pair, pas la nôtre (records.ts, adopted).
    const pub = s.records!.adopted.get(b.id);
    list.push({ id: b.id, gid: s.records!.gidOfBook(b.id) ?? b.id, sha256: fp?.sha256 ?? null, size: fp?.size ?? b.size, title: pub ? pub.title : b.title, author: pub ? pub.author : b.author, edition: (pub ? pub.edition : b.edition) as Book['edition'] });
  }
  // proofs : cet hôte répond au défi de possession (un hôte ≤ 3.59 ne l'annonce pas, voir guestOnBooks).
  send(to, { t: 'books', list, proofs: 1 });
}

// ─────────────────────────────────────────────────────────────
// Preuve de possession à l'arrivée (défi–réponse)
//
// Reconnaître « le même livre » chez l'invité d'après la seule empreinte annoncée par l'hôte permettait à
// un hôte malveillant de lister des empreintes sans avoir les fichiers, d'apprendre par la réponse 'want'
// lesquels l'invité possède, de recevoir leur fiche privée puis de se faire envoyer les fichiers. Désormais
// l'invité envoie, pour chaque livre de la liste qui a une empreinte (qu'il l'ait ou non : la demande ne
// dit rien de sa bibliothèque), un nombre aléatoire de 32 octets ; l'hôte répond SHA-256(nombre ‖ fichiers
// source dans l'ordre de bookSourceFiles), calculé sur SON fichier. L'invité refait le calcul sur le sien :
// seul celui qui a le fichier peut répondre, et la réponse ne sert qu'une fois (nombre neuf à chaque fois).
//
// Transport : le défi part dans un message 'fetch' { c: 'prove', items }. Le relais de l'hôte
// (electron/collab-net.cjs, permitted) jette tout type de message d'invité qui n'est pas dans ALWAYS dès
// que l'invité n'a pas toutes les permissions : un type 'prove' n'arriverait pas, et l'arrivée attendrait
// pour rien. 'fetch' y est toujours permis, et un hôte ≤ 3.59 l'ignore sans rien faire (onFetch : c ni
// 'book' ni 'draft'). La réponse 'proof' va de l'hôte à l'invité (jamais filtrée) ; un invité l'ignore si
// elle vient d'un autre invité (HOST_ONLY).
// ─────────────────────────────────────────────────────────────
const PROVE_ITEMS = 500; // éléments par défi
const PROVE_MSGS = 4; // défis envoyés par un invité à l'arrivée (2 000 livres)
const PROVE_PER_PEER = 12; // défis acceptés de chaque invité par session (il peut revenir plusieurs fois)
const PROOF_WAIT = 8000;
const HEX64 = /^[0-9a-f]{64}$/;

const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
function fromB64(v: unknown): Uint8Array | null {
  if (typeof v !== 'string' || v.length > 64) return null;
  try {
    return Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** SHA-256 (hex) du nombre suivi des fichiers source du livre ; null si le livre n'a pas (ou plus) son fichier. */
async function possessionMac(b: Book, nonce: Uint8Array): Promise<string | null> {
  if (b.missing || withoutFile(b.format)) return null;
  const names = bookSourceFiles(b);
  if (!names.length || names.some((n) => !n)) return null;
  let datas: ArrayBuffer[];
  try {
    datas = await Promise.all(names.map((n) => host.readFile(b.id, n)));
  } catch {
    return null;
  }
  const all = new Uint8Array(nonce.length + datas.reduce((n, d) => n + d.byteLength, 0));
  all.set(nonce, 0);
  let off = nonce.length;
  for (const d of datas) {
    all.set(new Uint8Array(d), off);
    off += d.byteLength;
  }
  return sha256Hex(all);
}

/**
 * Hôte : réponse à un défi. Seulement pour les livres atteignables par un message reçu (ceux du partage,
 * comme onFetch) : rien n'est dit, pas même « inconnu », d'un autre livre de la bibliothèque. Un défi au-delà
 * de la limite est ignoré (sans réponse : l'invité télécharge alors une copie, rien de plus).
 */
async function hostProve(from: string, head: Head) {
  const s = S;
  if (!s || s.role !== 'host' || !s.records || !Array.isArray(head.items)) return;
  const proves = (s.proves ??= new Map());
  const n = proves.get(from) ?? 0;
  if (n >= PROVE_PER_PEER) return;
  proves.set(from, n + 1);
  const books = useStore.getState().books;
  const items: { gid: string; mac: string }[] = [];
  const done = new Set<string>();
  for (const it of (head.items as Any[]).slice(0, PROVE_ITEMS)) {
    const gid = it && typeof it.gid === 'string' ? it.gid : null;
    const nonce = fromB64(it?.nonce);
    if (!gid || done.has(gid) || !nonce || nonce.length !== 32) continue;
    done.add(gid);
    const id = s.records.sharedLocal('book', gid);
    const b = id ? books.find((x) => x.id === id) : null;
    const mac = b ? await possessionMac(b, nonce) : null;
    if (S !== s) return;
    if (mac) items.push({ gid, mac });
  }
  send(from, { t: 'proof', items });
}

/**
 * Invité : défi pour ces livres de l'hôte, puis attente des réponses (PROOF_WAIT au plus, pour tous les
 * défis). Rend les nombres envoyés et les réponses reçues (gid → mac), à vérifier par l'appelant.
 */
async function askProofs(s: Session, gids: string[]): Promise<{ nonces: Map<string, Uint8Array>; macs: Map<string, string> }> {
  const nonces = new Map<string, Uint8Array>();
  for (const g of gids) if (!nonces.has(g) && nonces.size < PROVE_ITEMS * PROVE_MSGS) nonces.set(g, crypto.getRandomValues(new Uint8Array(32)));
  const macs = new Map<string, string>();
  if (!nonces.size) return { nonces, macs };
  const all = [...nonces];
  const chunks: [string, Uint8Array][][] = [];
  for (let i = 0; i < all.length; i += PROVE_ITEMS) chunks.push(all.slice(i, i + PROVE_ITEMS));
  await new Promise<void>((resolve) => {
    const w = { nonces, macs, left: chunks.length, done: () => {} };
    const timer = setTimeout(() => w.done(), PROOF_WAIT);
    w.done = () => {
      clearTimeout(timer);
      if (s.proofWait === w) s.proofWait = undefined;
      resolve();
    };
    s.proofWait = w;
    for (const c of chunks) send('h', { t: 'fetch', c: 'prove', items: c.map(([gid, n]) => ({ gid, nonce: toB64(n) })) });
  });
  return { nonces, macs };
}

/** Invité : une réponse de l'hôte au défi (une par défi envoyé). */
function onProof(head: Head) {
  const w = S?.proofWait;
  if (!w) return;
  for (const it of (Array.isArray(head.items) ? head.items : []).slice(0, PROVE_ITEMS) as Any[]) {
    const gid = it && typeof it.gid === 'string' ? it.gid : null;
    if (gid && w.nonces.has(gid) && !w.macs.has(gid) && typeof it.mac === 'string' && HEX64.test(it.mac)) w.macs.set(gid, it.mac);
  }
  if (--w.left <= 0) w.done();
}
async function hostSendState(to: string, want: string[]) {
  const s = S!;
  s.records!.diffNow();
  // Espace encore vide : rien à empaqueter, l'invité crée un espace vide (avant : il restait « en arrivée »).
  const empty = !useStore.getState().wsItems.some((i) => i.workspaceId === s.workspaceId) && !useStore.getState().groups.some((g) => g.workspaceId === s.workspaceId);
  const { bytes } = empty ? { bytes: new Uint8Array(0) } : await buildSharePackage({ kind: 'workspace', workspaceId: s.workspaceId! }, { includeBooks: false, includeBookIds: want });
  const snap = s.records!.snapshot();
  const recs: Rec[] = [...snap.entries()].map(([k, v]) => ({ c: v.c, g: v.g, d: v.d, tag: s.records!.tags.get(k) ?? ([0, 'h'] as Tag) }));
  send(to, { t: 'state', title: s.title, ...(empty ? { empty: true } : {}), tags: [...s.records!.tags], keys: [...snap.keys()], recs, rooms: s.rooms.view, mtimes: Object.fromEntries(s.records!.mtimes) }, bytes);
}

// ─────────────────────────────────────────────────────────────
// Invité
// ─────────────────────────────────────────────────────────────
export async function guestFind(code: string, manualAddress: string | undefined, profile: CollabProfile) {
  install();
  await applyInternet();
  return net().find(code, manualAddress, profile);
}

/** Secondes avant de pouvoir essayer un autre code (0 : tout de suite). */
export async function guestWaitLeft(): Promise<number> {
  return (await net().waitLeft?.().catch(() => 0)) ?? 0;
}

/** Collaboration par Internet possible sur cet ordinateur (module présent) et permise (réglage) ? */
export async function internetState(): Promise<{ supported: boolean; enabled: boolean }> {
  if (!host.collabNet?.internet) return { supported: false, enabled: false };
  return host.collabNet.internet().catch(() => ({ supported: false, enabled: false }));
}

export async function guestJoin(ticket: string, profile: CollabProfile, hostName: string): Promise<void> {
  install();
  if (S) await stopSession();
  useCollab.setState({ phase: 'joining', role: 'guest', error: null, progress: 'En attente de l’accord de l’hôte…' });
  setWriteGuard(guestWriteGuard);
  const s: Session = { role: 'guest', me: '?', profile, workspaceId: null, shareId: '', title: '', records: null, rooms: makeRooms('guest'), queue: [], ready: false, hostName, flushed: new Set(), fetchTimers: new Map(), waitingFetch: new Map(), asked: new Set() };
  S = s;
  try {
    await s.rooms.ready();
    const r = await net().join(ticket);
    if (S !== s) return;
    s.me = r.you;
    // Couleur déjà prise chez l'hôte : on prend celle qu'il nous a attribuée (curseurs, encadré).
    const mine = (r.members as { id: string; color?: string }[]).find((m) => m.id === r.you);
    if (mine?.color && mine.color !== s.profile.color) {
      s.profile = { ...s.profile, color: mine.color };
      useStore.getState().toast('Votre couleur était déjà prise : vous en avez une autre pour cette session.', 'info');
    }
    s.shareId = String(r.meta.shareId ?? '');
    s.title = String(r.meta.title ?? 'Espace partagé');
    const haveWs = workspaceForShare(s.shareId);
    useCollab.setState({ me: r.you, members: r.members, maxPeople: r.max ?? 6, perm: r.perm ?? ALL_PERMS, shareId: s.shareId, title: s.title, progress: 'Réception de l’espace…' });
    send('h', { t: 'hi', haveWs: !!haveWs });
  } catch (e) {
    if (S === s) S = null;
    useCollab.setState({ phase: 'idle', role: null, progress: null, error: errorMessage(e) });
    throw e;
  }
}

/**
 * Invité : liste des livres de l'hôte → ceux qui manquent ici. Un livre n'est reconnu dans la bibliothèque
 * (alias, pas de téléchargement) que si l'hôte a prouvé qu'il en a le fichier (défi ci-dessus) ; jamais un
 * livre d'un espace chiffré (il serait rangé aussi dans l'espace partagé, donc en clair). Sans preuve
 * (hôte ≤ 3.59, pas de réponse à temps, réponse fausse) : demandé comme un livre inconnu, une copie
 * distincte arrive.
 */
async function guestOnBooks(head: Head) {
  const s = S!;
  const entries = ((Array.isArray(head.list) ? head.list : []) as Any[]).filter((e) => e && typeof e === 'object').slice(0, 5000);
  s.hostBooks = new Map(entries.map((e) => [String(e.id), { gid: String(e.gid), meta: cleanAdopted(e) }]));
  const shaOf = (e: Any) => (typeof e.sha256 === 'string' && HEX64.test(e.sha256) ? (e.sha256 as string) : null);
  // Défi pour TOUS les livres qui ont une empreinte (pas seulement ceux qu'on a), et attente identique dans
  // tous les cas : ni la demande ni son délai ne disent ce que contient la bibliothèque.
  const { nonces, macs } = head.proofs ? await askProofs(s, entries.filter(shaOf).map((e) => String(e.gid))) : { nonces: new Map<string, Uint8Array>(), macs: new Map<string, string>() };
  if (S !== s) return;
  const st = useStore.getState();
  const sealed = sealedBookIds(st);
  // Seulement des livres avec leur fichier (la réponse se vérifie sur le fichier), hors espaces chiffrés.
  const open = st.books.filter((b) => !sealed.has(b.id) && !b.missing);
  const want: string[] = [];
  const alias: [string, string][] = [];
  for (const e of entries) {
    const g = String(e.gid);
    const sha = shaOf(e);
    const mac = macs.get(g);
    const nonce = nonces.get(g);
    let local: Book | null = null;
    if (sha && mac && nonce) {
      const cand = await findLocalBook({ sha256: sha, size: Number(e.size) || 0 }, open);
      if (cand && (await possessionMac(cand, nonce)) === mac) local = cand;
    }
    if (local) alias.push([g, local.id]);
    else want.push(String(e.id));
  }
  if (S !== s) return;
  s.bookAlias = alias;
  send('h', { t: 'want', books: want });
}

/**
 * Invité, premier arrivée : le paquet de l'hôte est importé (importSharePackage), qui rattache à un livre de
 * la bibliothèque tout livre du paquet de même empreinte. Ce rattachement n'est permis que si l'hôte a
 * prouvé qu'il a le fichier : par le défi (alias ci-dessus), ou en le joignant au paquet (son empreinte y
 * est vérifiée, openSharePackage). Pour les autres (livre « sans fichier » chez l'hôte, empreinte inventée),
 * l'empreinte est retirée du manifeste avant l'import : le livre arrive comme une copie distincte « sans
 * fichier », et le nôtre reste hors de l'espace. Rend le paquet à importer, et les livres rattachés (gid
 * de l'hôte → id local, fiche de l'hôte) : c'est sa fiche qui circulera pour eux, jamais la nôtre.
 */
async function guardPackage(s: Session, body: Uint8Array): Promise<{ bytes: Uint8Array; attached: Map<string, { gid: string; meta: AdoptedMeta | null }> }> {
  const attached = new Map<string, { gid: string; meta: AdoptedMeta | null }>();
  const pkg = await openSharePackage(body);
  const st = useStore.getState();
  const sealed = sealedBookIds(st);
  const openBooks = st.books.filter((b) => !sealed.has(b.id)); // comme importSharePackage
  const proven = new Map(s.bookAlias ?? []);
  const srcOf = new Map(pkg.data.books.map((b) => [b.id, b]));
  const manifest = JSON.parse(JSON.stringify(pkg.manifest)) as typeof pkg.manifest;
  let changed = false;
  for (const e of manifest.books) {
    const src = srcOf.get(e.id) as Any;
    if (!e.sha256 || !src || withoutFile(src.format)) continue;
    const local = await findLocalBook(e, openBooks);
    if (!local) continue;
    const g = s.hostBooks?.get(e.id)?.gid ?? (typeof src.shareOrigin?.srcId === 'string' ? src.shareOrigin.srcId : e.id);
    if (e.included || proven.get(g) === local.id) {
      attached.set(local.id, { gid: g, meta: cleanAdopted(src) ?? s.hostBooks?.get(e.id)?.meta ?? null });
    } else {
      e.sha256 = null;
      changed = true;
    }
  }
  if (!changed) return { bytes: body, attached };
  // Le manifeste n'est pas couvert par les empreintes du paquet (il les porte) : on le réécrit seul.
  const zip = await JSZip.loadAsync(body);
  zip.file('manifest.json', JSON.stringify(manifest), { createFolders: false });
  return { bytes: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 1 } }), attached };
}

/** Invité : état initial reçu (paquet + éléments). */
async function guestOnState(head: Head, body: Uint8Array) {
  const s = S!;
  const st0 = useStore.getState();
  s.before = libraryKeys(s.shareId);
  let wsId = workspaceForShare(s.shareId);
  const alias: [string, string][] = s.bookAlias ?? [];
  useCollab.setState({ progress: 'Ajout à votre bibliothèque…' });
  const had = !!wsId;
  // Livres de la bibliothèque rattachés par l'import du paquet (voir guardPackage).
  let attached = new Map<string, { gid: string; meta: AdoptedMeta | null }>();
  if (!wsId && head.empty) {
    // Espace partagé encore vide : on le crée ici, relié à la session.
    const ws = useStore.getState().createWorkspace(String(head.title ?? s.title ?? 'Espace partagé').slice(0, 120));
    useStore.getState().patch('workspaces', ws.id, { shareOrigin: { shareId: s.shareId, srcId: s.shareId.replace(/^ws-/, '') } });
    wsId = ws.id;
  } else if (!wsId) {
    const guarded = await guardPackage(s, body);
    attached = guarded.attached;
    const res = await importSharePackage(guarded.bytes);
    wsId = res.workspace?.id ?? null;
  }
  if (!wsId) throw new Error('L’espace partagé n’a pas pu être créé ici.');
  s.workspaceId = wsId;
  const rec = makeRecords(s, wsId);
  // Livres adoptés lors d'une session précédente : leur fiche reste celle du pair (memory.ts).
  stopWatch(s.shareId);
  for (const [id, meta] of await rememberedAdopted(s.shareId)) if (useStore.getState().books.some((b) => b.id === id)) rec.adopted.set(id, meta);
  for (const [g, l] of alias) {
    rec.addAlias('book', g, l);
    // Livre de la bibliothèque reconnu avec preuve, encore hors de l'espace (espace déjà là) : il rejoint la
    // session avec la fiche de l'hôte, ce qu'on y avait fait reste privé (adoptBook). Déjà dans l'espace :
    // c'est déjà le livre partagé, rien ne change.
    if (!attached.has(l) && !rec.inScope('book', l)) {
      const meta = [...(s.hostBooks?.values() ?? [])].find((h) => h.gid === g)?.meta;
      rec.adoptBook(l, meta ?? undefined);
    }
  }
  // Rattachés par l'import : ils n'étaient dans aucun espace partagé, c'étaient des livres privés.
  for (const [l, a] of attached) {
    rec.addAlias('book', a.gid, l);
    if (a.meta) rec.adopted.set(l, a.meta);
  }
  const hostKeys = new Set<string>(Array.isArray(head.keys) ? (head.keys as string[]) : []);
  // Vie privée : ce qui était déjà ici dans les livres de l'espace (et qui ne vient pas de l'hôte) reste ici.
  const mine = rec.snapshot();
  for (const [k, v] of mine) if (!hostKeys.has(k) && (v.c === 'highlight' || v.c === 'map')) rec.privateKeys.add(k);
  for (const [k, t] of (Array.isArray(head.tags) ? head.tags : []) as [string, Tag][]) rec.tags.set(k, t);
  rec.clock = Math.max(0, ...[...rec.tags.values()].map((t) => t[0]));
  for (const [k, t] of Object.entries(await knownMtimes(s.shareId))) rec.mtimes.set(k, t);
  s.records = rec;
  rec.start();
  if (had && !head.empty && st0.workspaces.some((w) => w.id === wsId)) {
    // L'espace était déjà là : réunion de ce que chacun a fait entre-temps (reunion.ts).
    useCollab.setState({ progress: 'Réunion de ce que chacun a fait…' });
    const r = await reunite({ records: rec, shareId: s.shareId, hostRecs: (Array.isArray(head.recs) ? head.recs : []) as Rec[], hostMtimes: (head.mtimes as Record<string, number>) ?? {}, pkg: body, hostName: s.hostName });
    if (r.mine.length) send('all', { t: 'recs', recs: r.mine });
    for (const d of r.docx) send('all', { t: 'docx', g: d.g, words: d.words, merged: true, by: s.profile.name }, new Uint8Array(d.data));
    for (const m of r.messages) toast(m, 'info');
    if (r.mine.length || r.docx.length) toast(`Réuni avec ${s.hostName} : une version « Avant la reconnexion avec ${s.hostName} » garde chaque écrit d’avant.`, 'success');
  }
  void hostKeys;
  s.rooms.setView((head.rooms as Record<string, string[]>) ?? {});
  s.ready = true;
  plugCursors(s);
  useCollab.setState({ phase: 'live', workspaceId: wsId, progress: null });
  for (const q of s.queue.splice(0)) await onMessage(q.from, q.head, q.body);
  useStore.getState().navigate({ name: 'workspace', workspaceId: wsId, groupId: null });
  toast(`Vous travaillez à plusieurs dans « ${s.title} »`, 'success');
}

// ─────────────────────────────────────────────────────────────
// Livres et écrits inconnus : demandés à celui qui en parle, fichiers compris
// ─────────────────────────────────────────────────────────────
function askFetch(c: 'book' | 'draft', g: string, from: string) {
  const s = S;
  if (!s) return;
  const to = from && from !== s.me ? from : 'h';
  const k = keyOf(c, g);
  s.asked.add(k);
  send(to, { t: 'fetch', c, g });
  clearTimeout(s.fetchTimers.get(k));
  // Sans réponse (il est parti ?) : on demande à l'hôte, qui répond dès qu'il l'a lui-même ; puis, toujours
  // rien, on oublie la demande et on la refait (l'élément attend encore : nouvelle demande, à tous).
  s.fetchTimers.set(
    k,
    setTimeout(() => {
      if (S !== s) return;
      if (to !== 'h' && s.role === 'guest') send('h', { t: 'fetch', c, g });
      s.fetchTimers.set(
        k,
        setTimeout(() => {
          if (S !== s || !s.records || s.records.sharedLocal(c, g)) return;
          send('all', { t: 'fetch', c, g });
          s.records.fetchDone(c, g);
          s.fetchTimers.set(
            k,
            setTimeout(() => {
              if (S !== s || !s.records || s.records.sharedLocal(c, g)) return;
              s.records.fetchDone(c, g);
              s.records.resume(); // refait les demandes de ce qui attend encore
            }, 20000),
          );
        }, 12000),
      );
    }, 8000),
  );
}

/** Une demande arrivée avant l'élément : servie quand il arrive (onFiles). */
function waitFor(c: 'book' | 'draft', g: string, from: string) {
  const s = S;
  if (!s) return;
  const k = keyOf(c, g);
  const set = s.waitingFetch.get(k) ?? new Set<string>();
  set.add(from);
  s.waitingFetch.set(k, set);
}

async function onFetch(from: string, head: Head) {
  const s = S;
  const c = head.c === 'draft' ? 'draft' : head.c === 'book' ? 'book' : null;
  const g = String(head.g ?? '');
  if (!s?.records || !c || !g) return;
  // Seulement ce qui fait partie de l'espace partagé (records.ts, shared) : un livre ou un écrit du reste
  // de la bibliothèque n'est jamais envoyé, même demandé par son identifiant.
  if (s.records.local(c, g) && !s.records.sharedLocal(c, g)) return;
  const id = s.records.sharedLocal(c, g);
  const st = useStore.getState();
  if (c === 'book') {
    const b = st.books.find((x) => x.id === id);
    if (!b) {
      if (s.role === 'host' && from !== 'h') waitFor(c, g, from); // pas encore arrivé chez l'hôte : servi à son arrivée
      return;
    }
    const paper = b.format === 'paper' || b.format === 'video'; // sans fichier
    const names = paper || b.missing ? [] : [...bookSourceFiles(b), ...bookExtraFiles(b)];
    const files: { name: string; data: ArrayBuffer }[] = [];
    for (const n of names) {
      const data = await host.readFile(b.id, n).catch(() => null);
      if (data) files.push({ name: n, data });
    }
    // Sans son fichier (livre « sans fichier », ou fichier illisible) : on envoie quand même ses métadonnées ;
    // chez l'autre, il arrive « sans fichier », avec ses extraits, et se complète en important le même livre.
    // Invité : l'hôte refuse un message de plus de 256 Mo (electron/collab-net.cjs) ; un livre plus gros
    // part « sans fichier », comme ci-dessous.
    const tooBig = s.role === 'guest' && files.reduce((n, f) => n + f.data.byteLength, 0) > GUEST_FILES_MAX;
    const missing = !paper && (tooBig || !!b.missing || !files.some((f) => f.name === b.fileName));
    const fp = missing ? null : await bookFingerprint(b);
    const sha256 = fp?.sha256 ?? b.sourceSha256 ?? null;
    const { list, body } = joinFiles(missing ? [] : files);
    // Livre papier : aucun fichier, seulement ses métadonnées et sa couverture.
    // Livre de la bibliothèque reconnu grâce au fichier d'un pair : c'est SA fiche qui circule (titre,
    // nom de fichier, couverture), jamais la nôtre.
    const pub = s.records.adopted.get(b.id);
    const meta = { title: pub ? pub.title : b.title, author: pub ? pub.author : b.author, format: b.format, fileName: b.fileName, originalName: pub ? pub.originalName || b.fileName : b.originalName, size: b.size, edition: pub ? (pub.edition ?? { publisher: '', year: '', translator: '', place: '', pageOffset: 0 }) : b.edition, cover: pub ? pub.cover : b.cover, pages: missing ? undefined : b.pages, sha256, ...(missing ? { missing: true } : {}), ...(b.format === 'paper' ? { paper: true, isbn: b.isbn ?? '' } : {}), ...(b.format === 'video' && b.video ? { video: { provider: b.video.provider, id: b.video.id, url: b.video.url, duration: b.video.duration, chapters: b.video.chapters } } : {}) };
    send(from, { t: 'files', c, g, rec: meta, list }, body);
  } else {
    const d = st.drafts.find((x) => x.id === id);
    if (!d) {
      if (s.role === 'host' && from !== 'h') waitFor(c, g, from);
      return;
    }
    const raw = await host.readFile(d.id, d.fileName).catch(() => null);
    if (!raw) return;
    const shared = (await shareableDocx(raw)).data; // jamais les notes privées
    const { list, body } = joinFiles([{ name: d.fileName, data: shared }]);
    send(from, { t: 'files', c, g, rec: { title: d.title, fileName: d.fileName, template: d.template, wordCount: d.wordCount, wordGoal: d.wordGoal }, list }, body);
  }
}

/**
 * Livre de l'invité reconnu comme le livre partagé (même empreinte), éventuellement complété par le fichier
 * reçu : il reste à lui s'il ne garde pas l'espace en partant, même ajouté à sa bibliothèque pendant la
 * session (il ne venait pas du partage).
 */
function keepAsMine(s: Session, b: Book) {
  if (b.shareOrigin?.shareId !== s.shareId) s.before?.add(`book:${b.id}`);
}

const SAFE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
async function onFiles(head: Head, body: Uint8Array) {
  const s = S;
  const c = head.c === 'draft' ? 'draft' : head.c === 'book' ? 'book' : null;
  const g = String(head.g ?? '');
  const meta = (head.rec ?? {}) as Any;
  const files = splitFiles(head.list, body);
  if (!s?.records || !c || !g || !files || !files.every((f) => SAFE.test(f.name) && !f.name.includes('..'))) return;
  // Seulement ce qu'on a demandé : personne ne peut glisser un livre ou un écrit dans la bibliothèque.
  if (!s.asked.has(keyOf(c, g))) return;
  clearTimeout(s.fetchTimers.get(keyOf(c, g)));
  // Déjà là ET partagé (un écrit privé de même gid ne compte pas : une copie distincte est créée).
  const here = s.records.sharedLocal(c, g);
  if (here) {
    s.records.fetchDone(c, g);
    s.records.resume();
    serveWaiting(c, g);
    return;
  }
  const st = useStore.getState();
  const free = (id: string) => !st.books.some((b) => b.id === id) && !st.drafts.some((d) => d.id === id);
  const id = free(g) && SAFE.test(g) ? g : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const origin = id === g ? {} : { shareOrigin: { shareId: s.shareId, srcId: g } };
  if (c === 'book') {
    const video = meta.format === 'video';
    const videoInfo = video ? safeVideoInfo(meta.video) : null;
    const paper = meta.format === 'paper' || video; // sans fichier
    const missing = !paper && (meta.missing === true || !files.length);
    // Déjà là (même empreinte) : alias, aucun doublon. Livre local « sans fichier » et fichier reçu : on le
    // complète (au lieu d'en créer un second).
    const sha = typeof meta.sha256 === 'string' ? meta.sha256 : null;
    // Preuve de possession : le pair a envoyé le fichier, et son empreinte est bien celle annoncée.
    let proven = false;
    if (!missing && sha) {
      const names = bookSourceFiles({ format: meta.format, fileName: String(meta.fileName ?? files[0]?.name ?? ''), pages: meta.pages } as unknown as Book);
      // splitFiles rend déjà des ArrayBuffer (copies) : les traiter comme des Uint8Array (.buffer
      // indéfini) faisait échouer onFiles pour TOUT livre reçu avec son fichier.
      const datas = names.map((n) => files.find((f) => f.name === n)?.data);
      const fp = names.length && datas.every((d): d is ArrayBuffer => d instanceof ArrayBuffer) ? await fingerprintOf(datas as ArrayBuffer[]).catch(() => null) : null;
      proven = !!fp && fp.sha256 === sha;
    }
    // 1. Parmi les livres déjà partagés dans cette session (ou reçus par ce partage).
    const mine = st.books.filter((b) => s.records!.inScope('book', b.id) || b.shareOrigin?.shareId === s.shareId);
    let local = video ? findLocalVideoBook({ video: meta.video }, mine) : sha ? await findLocalBook({ sha256: sha, size: Number(meta.size) || 0 }, mine) : null;
    if (!local && sha) local = mine.find((b) => b.missing && b.sourceSha256 === sha) ?? null;
    // 2. Dans le reste de la bibliothèque, seulement si le pair PROUVE qu'il a le fichier : annoncer une
    //    empreinte ne suffit pas (elle servait à savoir ce que l'autre possède, puis à se le faire
    //    envoyer). Jamais un livre d'un espace chiffré. Ce que l'on avait fait sur ce livre reste privé,
    //    et son titre, son nom de fichier et sa couverture ne repartent pas (voir adoptBook).
    let adoptedNow = false;
    if (!local && proven) {
      const sealed = sealedBookIds(st);
      const others = st.books.filter((b) => !sealed.has(b.id) && !mine.includes(b));
      local = (await findLocalBook({ sha256: sha!, size: Number(meta.size) || 0 }, others)) ?? others.find((b) => b.missing && b.sourceSha256 === sha) ?? null;
      adoptedNow = !!local;
    }
    // Fichier reçu pour compléter un livre « sans fichier » : son empreinte doit être celle annoncée.
    if (local && local.missing && !missing && !proven) local = null;
    const theirs = { title: String(meta.title ?? 'Sans titre').slice(0, 500), author: String(meta.author ?? '').slice(0, 500), originalName: String(meta.originalName ?? '').slice(0, 300), cover: typeof meta.cover === 'string' && /^data:image\/(png|jpe?g|webp|gif|avif);base64,/.test(meta.cover) ? meta.cover : null, edition: meta.edition && typeof meta.edition === 'object' ? meta.edition : null };
    if (local && local.missing && !missing) {
      for (const f of files) await host.storeFile(local.id, f.name, f.data);
      const fileName = SAFE.test(String(meta.fileName)) ? String(meta.fileName) : files[0]?.name ?? local.fileName;
      const target = local.id;
      useStore.getState().applyExternal((cur) => ({
        books: cur.books.map((b) => {
          if (b.id !== target) return b;
          const { missing: _m, ...rest } = b;
          return { ...rest, fileName, ...(Array.isArray(meta.pages) && meta.pages.every((p: unknown) => typeof p === 'string' && SAFE.test(p)) ? { pages: meta.pages } : {}), ...(!b.cover && typeof meta.cover === 'string' && /^data:image\/(png|jpe?g|webp|gif|avif);base64,/.test(meta.cover) ? { cover: meta.cover } : {}) };
        }),
      }));
      s.records.adoptBook(target, adoptedNow ? theirs : undefined);
      s.records.addAlias('book', g, target);
      keepAsMine(s, local);
    } else if (local) {
      s.records.adoptBook(local.id, adoptedNow ? theirs : undefined);
      s.records.addAlias('book', g, local.id);
      keepAsMine(s, local);
    } else {
      if (!paper && !missing) for (const f of files) await host.storeFile(id, f.name, f.data);
      const now = Date.now();
      const fileName = paper ? '' : SAFE.test(String(meta.fileName)) ? String(meta.fileName) : files[0]?.name ?? 'source.bin';
      const book: Book = {
        id,
        title: String(meta.title ?? 'Sans titre').slice(0, 500),
        author: String(meta.author ?? '').slice(0, 500),
        format: video && !videoInfo ? 'txt' : ['epub', 'pdf', 'docx', 'md', 'txt', 'html', 'image', 'paper', 'video'].includes(meta.format) ? meta.format : 'txt',
        ...(meta.format === 'paper' ? { paper: true as const, ...(typeof meta.isbn === 'string' && /^97[89]\d{10}$/.test(meta.isbn) ? { isbn: meta.isbn } : {}) } : {}),
        ...(videoInfo ? { video: videoInfo } : {}),
        fileName,
        originalName: String(meta.originalName ?? fileName),
        size: Number(meta.size) || files.reduce((n, f) => n + f.data.byteLength, 0),
        addedAt: now,
        lastOpenedAt: null,
        progress: 0,
        position: null,
        cover: typeof meta.cover === 'string' && /^data:image\/(png|jpe?g|webp|gif|avif);base64,/.test(meta.cover) ? meta.cover : null,
        edition: { publisher: '', year: '', translator: '', place: '', pageOffset: 0, ...(meta.edition && typeof meta.edition === 'object' ? meta.edition : {}) },
        ...(Array.isArray(meta.pages) && meta.pages.every((p: unknown) => typeof p === 'string' && SAFE.test(p)) ? { pages: meta.pages } : {}),
        ...(typeof meta.sha256 === 'string' ? { sourceSha256: meta.sha256 } : {}),
        ...(missing ? { missing: true } : {}),
        ...origin,
      };
      useStore.getState().applyExternal((cur) => ({ books: [book, ...cur.books] }));
      if (id !== g) s.records.addAlias('book', g, id);
    }
  } else {
    const f = files[0];
    if (!f) return;
    const fileName = SAFE.test(String(meta.fileName)) ? String(meta.fileName) : 'document.docx';
    await host.storeFile(id, fileName, f.data);
    const now = Date.now();
    const d: Draft = { id, title: String(meta.title ?? 'Sans titre').slice(0, 300), fileName, externalPath: null, wordCount: Number(meta.wordCount) || 0, template: null, createdAt: now, updatedAt: now, ...(typeof meta.wordGoal === 'number' ? { wordGoal: meta.wordGoal } : {}), ...origin };
    useStore.getState().applyExternal((cur) => ({ drafts: [...cur.drafts, d] }));
    if (id !== g) s.records.addAlias('draft', g, id);
  }
  // Reçu à notre demande : atteignable par les messages suivants (référence d'un élément d'espace, d'un plan…).
  s.records.markShared(c, g);
  s.records.fetchDone(c, g);
  s.records.resume();
  serveWaiting(c, g);
}

/** Hôte : ceux qui avaient demandé cet élément avant qu'il arrive ici. */
function serveWaiting(c: 'book' | 'draft', g: string) {
  const s = S;
  if (!s) return;
  const k = keyOf(c, g);
  const waiting = s.waitingFetch.get(k);
  if (!waiting) return;
  s.waitingFetch.delete(k);
  for (const who of waiting) void onFetch(who, { t: 'fetch', c, g } as Head);
}

/** Écrit réuni par un participant qui revient : version d'avant, puis le fichier réuni. */
async function onMergedDocx(from: string, head: Head, body: Uint8Array) {
  const s = S!;
  const g = String(head.g ?? '');
  const id = s.records?.sharedLocal('draft', g);
  const d = id ? useStore.getState().drafts.find((x) => x.id === id) : null;
  if (!d) return;
  if (s.role === 'host' && (s.rooms.view[g]?.length ?? 0) > 0) {
    send(from, { t: 'docx-busy', g, title: d.title });
    return;
  }
  if (s.rooms.hasEditor(g)) return;
  await addVersionFromLibrary(d.id, { kind: 'manual', name: `Avant la reconnexion avec ${String(head.by ?? nameOf(from))}`, force: true }).catch((e) => console.warn('version', e));
  await host.storeFile(d.id, d.fileName, body.slice().buffer as ArrayBuffer);
  const words = Number(head.words);
  if (Number.isFinite(words)) useStore.getState().applyExternal((st) => ({ drafts: st.drafts.map((x) => (x.id === d.id ? { ...x, wordCount: words } : x)) }));
  // La salle Yjs gardée par l'hôte repart de ce fichier au prochain ouvrant.
  if (s.role === 'host') s.rooms.dropRoom(g);
}

// ─────────────────────────────────────────────────────────────
// Messages et événements
// ─────────────────────────────────────────────────────────────
const HOST_ONLY = new Set(['books', 'proof', 'state', 'rooms', 'room-ok', 'resync-reply', 'stopping', 'docx-busy']);
async function onMessage(from: string, head: Head, body: Uint8Array) {
  const s = S;
  if (!s) return;
  // Pointeurs : éphémères, jamais mis en attente (perdus avant que l'espace soit prêt).
  if (head.t === 'cur') {
    if (s.ready) onCursorMessage(from, head);
    return;
  }
  // Messages que seul l'hôte envoie (état, livres, salles, arrêt…) : ignorés s'ils viennent d'un autre
  // invité (le relais de l'hôte transmet les messages d'un invité à un autre), ou si l'on est l'hôte.
  if (HOST_ONLY.has(head.t) && !(s.role === 'guest' && from === 'h')) return;
  // Invité : tant que l'espace n'est pas prêt, seuls les messages d'arrivée passent ; le reste attend.
  if (!s.ready && !['books', 'proof', 'state', 'stopping', 'rooms', 'room-ok'].includes(head.t)) {
    s.queue.push({ from, head, body: body.slice() });
    return;
  }
  try {
    switch (head.t) {
      case 'recs':
        if (Array.isArray(head.recs)) s.records?.receive(head.recs as Rec[], from);
        break;
      case 'y':
        s.rooms.deliver(head, body);
        break;
      case 'room-join':
      case 'room-leave':
        if (s.role !== 'host') break;
        // Salle d'un écrit qui est ici mais hors de l'espace partagé : refusée (un écrit encore inconnu ici,
        // tout juste créé par un invité, reste permis : la salle ne contient que ce que les invités y mettent).
        if (head.t === 'room-join' && typeof head.r === 'string' && s.records?.local('draft', head.r) && !s.records.sharedLocal('draft', head.r)) break;
        await s.rooms.hostHandle(from, head);
        break;
      case 'room-ok':
        s.rooms.onRoomOk(head);
        break;
      case 'rooms':
        s.rooms.setView(head.rooms as Record<string, string[]>);
        break;
      case 'docx':
        if (head.merged) await onMergedDocx(from, head, body);
        else await s.rooms.onDocx(head, body);
        break;
      case 'docx-busy':
        toast(`« ${String(head.title ?? 'Un écrit')} » est ouvert chez quelqu’un : votre version réunie est gardée dans ses versions ici.`, 'info');
        break;
      case 'fetch':
        // Défi de possession (voir hostProve) : porté par 'fetch', toujours permis par le relais.
        if (head.c === 'prove') await hostProve(from, head);
        else await onFetch(from, head);
        break;
      case 'prove':
        // Même défi sous son propre nom (relais qui le laisserait passer) : traité de la même façon.
        await hostProve(from, head);
        break;
      case 'proof':
        onProof(head);
        break;
      case 'files':
        await onFiles(head, body);
        break;
      // ── hôte ──
      case 'hi':
        if (s.role === 'host') await hostSendBooks(from);
        break;
      case 'want':
        if (s.role === 'host') await hostSendState(from, Array.isArray(head.books) ? (head.books as string[]) : []);
        break;
      case 'resync':
        if (s.role === 'host' && s.records) {
          const theirs = new Map<string, Tag>(Array.isArray(head.tags) ? (head.tags as [string, Tag][]) : []);
          send(from, { t: 'resync-reply', tags: [...s.records.tags], recs: s.records.newerThan(theirs), rooms: s.rooms.view });
        }
        break;
      case 'flushed':
        s.flushed.add(from);
        break;
      // ── invité ──
      case 'books':
        await guestOnBooks(head);
        break;
      case 'state':
        await guestOnState(head, body);
        break;
      case 'resync-reply':
        if (s.records) {
          if (Array.isArray(head.recs)) s.records.receive(head.recs as Rec[], 'h');
          s.rooms.setView((head.rooms as Record<string, string[]>) ?? {});
          const theirs = new Map<string, Tag>(Array.isArray(head.tags) ? (head.tags as [string, Tag][]) : []);
          const mine = s.records.newerThan(theirs);
          if (mine.length) send('all', { t: 'recs', recs: mine });
        }
        break;
      case 'stopping':
        // L'hôte arrête : on enregistre tout (les écrits ouverts envoient leur dernier état), puis on le dit.
        useCollab.setState({ phase: 'stopping' });
        await flushPendingSave().catch(() => undefined);
        send('h', { t: 'flushed' });
        break;
    }
  } catch (e) {
    console.error('collab', head.t, e);
    if (head.t === 'state') {
      toast(`L’espace partagé n’a pas pu être reçu : ${errorMessage(e)}`, 'error');
      void stopSession();
    }
  }
}

async function onEvent(e: CollabEvent) {
  const s = S;
  if (e.type === 'message') {
    const m = unpack(e.bytes);
    if (m) await onMessage(e.from, m.head, m.body);
    return;
  }
  if (!s) return;
  if (e.side === 'host' && s.role === 'host') {
    if (e.type === 'request') {
      useCollab.setState((st) => ({ requests: [...st.requests.filter((r) => r.reqId !== e.reqId), { reqId: e.reqId, device: e.device, name: e.name, color: e.color, address: e.address, wasRemoved: !!e.wasRemoved }] }));
    } else if (e.type === 'request-closed') {
      useCollab.setState((st) => ({ requests: st.requests.filter((r) => r.reqId !== e.reqId) }));
    } else if (e.type === 'members') {
      const before = useCollab.getState().members;
      useCollab.setState({ members: e.members, ...(e.max ? { maxPeople: e.max } : {}), ...(e.perm ? { perm: e.perm } : {}) });
      for (const m of before) if (!m.host && !e.members.some((x) => x.id === m.id)) s.rooms.hostLeave(m.id);
      for (const m of e.members) {
        const was = before.find((x) => x.id === m.id);
        if (!was && !m.host) toast(`${m.name} a rejoint « ${s.title} »`, 'success');
        else if (was && was.state === 'live' && m.state === 'away') toast(`${m.name} a perdu la connexion : sa place est gardée`, 'info');
      }
    } else if (e.type === 'code-closed') {
      useCollab.setState({ codeState: 'tries', code: null });
    } else if (e.type === 'stopped' && e.reason !== 'closed') {
      endLocal('stopped');
    }
  } else if (e.side === 'guest' && s.role === 'guest') {
    if (e.type === 'members') {
      const was = useCollab.getState().perm;
      useCollab.setState({ members: e.members, ...(e.max ? { maxPeople: e.max } : {}), ...(e.perm ? { perm: e.perm } : {}) });
      if (e.perm && !samePerm(e.perm, was)) toast(`${s.hostName} a changé ce que vous pouvez faire : ${permText(e.perm)}.`, 'info');
    }
    else if (e.type === 'hello' && e.resumed) {
      s.rooms.setLink(true);
      useCollab.setState({ phase: 'live', members: e.members, ...(e.max ? { maxPeople: e.max } : {}), ...(e.perm ? { perm: e.perm } : {}) });
      if (s.records) send('h', { t: 'resync', tags: [...s.records.tags] });
      toast('Connexion rétablie : vos modifications sont réunies', 'success');
    } else if (e.type === 'link' && e.state === 'reconnecting') {
      s.rooms.setLink(false);
      useCollab.setState({ phase: 'reconnecting' });
      toast('Connexion perdue : vous continuez seul, Marginalia se reconnecte…', 'info');
    } else if (e.type === 'link' && e.state === 'closed') {
      const why =
        e.reason === 'host-stopped'
          ? `${s.hostName} a arrêté le partage : votre exemplaire est à jour.`
          : e.reason === 'removed'
            ? `${s.hostName} vous a retiré de la session. Votre exemplaire reste chez vous, il n’est plus partagé.`
            : e.reason === 'left'
              ? null
              : 'La session est terminée : votre exemplaire reste chez vous.';
      endLocal(e.reason ?? 'closed');
      if (why) toast(why, 'info');
    }
  }
}

/** Fin de la session ici : chacun garde son exemplaire ; les écrits ouverts continuent seuls. */
function endLocal(_reason: string) {
  const s = S;
  if (!s) return;
  S = null;
  setWriteGuard(null);
  setCursorBridge(null);
  try {
    s.records?.diffNow();
  } catch {
    /* rien */
  }
  s.records?.stop();
  s.rooms.stop();
  for (const t of s.fetchTimers.values()) clearTimeout(t);
  void import('./reunion').then((m) => m.rememberSession(s.shareId, s.workspaceId, s.records, s.role === 'host' ? null : s.hostName)).catch(() => undefined);
  // Invité : garder l'espace reçu, ou non (il n'avait peut-être besoin de travailler ensemble qu'une fois).
  const ws = s.role === 'guest' && s.ready && s.workspaceId ? useStore.getState().workspaces.find((w) => w.id === s.workspaceId) : undefined;
  const afterSession = ws && s.before ? { workspaceId: ws.id, name: ws.name, hostName: s.hostName, targets: sessionTargets(ws.id, s.shareId, s.before) } : null;
  useCollab.setState({ afterSession, role: null, phase: 'idle', workspaceId: null, shareId: null, me: null, members: [], requests: [], code: null, progress: null, rooms: {}, maxPeople: 6, perm: ALL_PERMS });
}

/** « Arrêter le partage » (hôte : pour tous, après le dernier enregistrement de chacun) ou « Quitter » (invité). */
export async function stopSession(): Promise<void> {
  const s = S;
  if (!s) return;
  if (s.role === 'host') {
    useCollab.setState({ phase: 'stopping' });
    const live = useCollab.getState().members.filter((m) => !m.host && m.state === 'live').map((m) => m.id);
    s.flushed.clear();
    if (live.length) {
      send('all', { t: 'stopping' });
      const t0 = Date.now();
      while (Date.now() - t0 < 4000 && !live.every((id) => s.flushed.has(id))) await new Promise((r) => setTimeout(r, 60));
      // Derniers .docx en route vers l'hôte : un court délai.
      await new Promise((r) => setTimeout(r, 300));
    }
    await flushPendingSave().catch(() => undefined);
    endLocal('closed');
    await net().hostStop();
  } else {
    await flushPendingSave().catch(() => undefined);
    endLocal('left');
    await net().leave();
  }
}

/** L'éditeur ouvre un écrit : lien Yjs s'il appartient à l'espace partagé en cours (sinon null). */
export async function bindDraft(draftId: string) {
  const s = S;
  if (!s || !s.ready || !s.workspaceId) return null;
  const st = useStore.getState();
  const inWs = st.wsItems.some((i) => i.workspaceId === s.workspaceId && i.kind === 'draft' && i.refId === draftId);
  if (!inWs) return null;
  return s.rooms.bind(draftId);
}

export const currentMembers = (): CollabMember[] => useCollab.getState().members;

// Au chargement de l'interface : une session laissée ouverte par une page précédente est fermée.
export async function closeStale() {
  if (!host.collabNet || S) return;
  const info = await host.collabNet.hostInfo().catch(() => null);
  if (info?.open) await host.collabNet.hostStop();
}

export { newer };
export type { Col };

/** Fin de session (invité) : ne pas garder l'espace reçu. Tout va dans la corbeille (30 jours, annulable). */
export function dropSharedWorkspace(): number {
  const a = useCollab.getState().afterSession;
  useCollab.setState({ afterSession: null });
  if (!a) return 0;
  const st = useStore.getState();
  // On quitte l'écran s'il montre l'espace ou l'un de ses éléments (écrit, livre, carte…).
  const ids = new Set([a.workspaceId, ...a.targets.map((t) => t.id)]);
  if (Object.values(st.route as Record<string, unknown>).some((v) => typeof v === 'string' && ids.has(v))) st.navigate({ name: 'home' });
  const entries = st.trashDeleteMixed([...a.targets, { kind: 'workspace', id: a.workspaceId }]);
  return entries.length;
}
