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
//  invité → hôte : 'hi' { haveWs }, 'want' { books }, 'resync' { tags }, 'flushed'
//  hôte → invité : 'books' { list }, 'state' { tags, keys, recs, rooms, booksAlias } + paquet, 'resync-reply' { tags, recs }, 'stopping'
//  tous         : 'recs' { recs } (éléments de l'espace, records.ts), 'fetch' / 'files' (livre ou écrit inconnu)
// ─────────────────────────────────────────────────────────────
import { host, type CollabEvent, type CollabMember } from '../../lib/platform';
import { flushPendingSave, useStore } from '../../lib/store';
import type { Book, Draft } from '../../lib/types';
import { bookExtraFiles, bookFingerprint, bookSourceFiles, buildSharePackage, findLocalBook, shareableDocx } from '../share/sharePackage';
import { importSharePackage } from '../share/shareMerge';
import { errorMessage } from '../share/shareUi';
import { useCollab, type CollabProfile } from './collabState';
import { keyOf, newer, RecordSync, type Col, type Rec, type Tag } from './records';
import { Rooms } from './rooms';
import { joinFiles, pack, splitFiles, unpack, type Head } from './wire';
import { reunite } from './reunion';
import { knownMtimes, stopWatch } from './memory';
import { addVersionFromLibrary } from '../editor/versions';

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
}

let S: Session | null = null;
let installed = false;
const net = () => host.collabNet!;
const toast = (m: string, t: 'info' | 'error' | 'success' = 'info') => useStore.getState().toast(m, t);
const nameOf = (id: string) => useCollab.getState().members.find((m) => m.id === id)?.name ?? (id === 'h' ? (S?.hostName ?? 'L’hôte') : 'Quelqu’un');

function send(to: string, head: Head, body?: Uint8Array) {
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
    draftLocal: (g) => S?.records?.local('draft', g) ?? null,
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

// ─────────────────────────────────────────────────────────────
// Hôte
// ─────────────────────────────────────────────────────────────
export async function startHost(workspaceId: string, profile: CollabProfile): Promise<void> {
  install();
  if (S) await stopSession();
  const ws = useStore.getState().workspaces.find((w) => w.id === workspaceId);
  if (!ws) throw new Error('Cet espace n’existe plus.');
  useCollab.setState({ phase: 'starting', role: 'host', workspaceId, error: null });
  const shareId = shareIdOf(workspaceId);
  const s: Session = { role: 'host', me: 'h', profile, workspaceId, shareId, title: ws.name, records: null, rooms: makeRooms('host'), queue: [], ready: true, hostName: profile.name, flushed: new Set(), fetchTimers: new Map() };
  S = s;
  try {
    await s.rooms.ready(); // moteur Yjs prêt avant la première demande
    const info = await net().hostStart({ title: ws.name, shareId }, profile);
    if (S !== s) return;
    stopWatch(shareId);
    s.records = makeRecords(s, workspaceId);
    for (const [k, t] of Object.entries(await knownMtimes(shareId))) s.records.mtimes.set(k, t);
    s.records.start();
    useCollab.setState({ phase: 'live', role: 'host', me: 'h', workspaceId, shareId, title: ws.name, members: info.members ?? [], requests: [], code: info.code ?? null, codeState: info.codeState ?? 'open', addresses: info.addresses ?? [] });
  } catch (e) {
    if (S === s) S = null;
    useCollab.setState({ phase: 'idle', role: null, workspaceId: null, error: errorMessage(e) });
    throw e;
  }
}

export async function acceptRequest(reqId: string) {
  const ok = await net().hostAccept(reqId);
  useCollab.setState((st) => ({ requests: st.requests.filter((r) => r.reqId !== reqId) }));
  if (!ok) toast('Cette demande n’est plus valable (ou l’espace accueille déjà 6 personnes).', 'error');
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
export async function newCode() {
  const info = await net().hostNewCode();
  useCollab.setState({ code: info.code ?? null, codeState: info.codeState ?? 'open' });
}

/** Hôte : l'état initial demandé par un invité. */
async function hostSendBooks(to: string) {
  const s = S!;
  const st = useStore.getState();
  const ids = new Set(st.wsItems.filter((i) => i.workspaceId === s.workspaceId && i.kind === 'book').map((i) => i.refId));
  const list: { id: string; gid: string; sha256: string | null; size: number; title: string }[] = [];
  for (const b of st.books) {
    if (!ids.has(b.id)) continue;
    const fp = await bookFingerprint(b);
    list.push({ id: b.id, gid: s.records!.gidOfBook(b.id) ?? b.id, sha256: fp?.sha256 ?? null, size: fp?.size ?? b.size, title: b.title });
  }
  send(to, { t: 'books', list });
}
async function hostSendState(to: string, want: string[]) {
  const s = S!;
  s.records!.diffNow();
  const { bytes } = await buildSharePackage({ kind: 'workspace', workspaceId: s.workspaceId! }, { includeBooks: false, includeBookIds: want });
  const snap = s.records!.snapshot();
  const recs: Rec[] = [...snap.entries()].map(([k, v]) => ({ c: v.c, g: v.g, d: v.d, tag: s.records!.tags.get(k) ?? ([0, 'h'] as Tag) }));
  send(to, { t: 'state', title: s.title, tags: [...s.records!.tags], keys: [...snap.keys()], recs, rooms: s.rooms.view, mtimes: Object.fromEntries(s.records!.mtimes) }, bytes);
}

// ─────────────────────────────────────────────────────────────
// Invité
// ─────────────────────────────────────────────────────────────
export async function guestFind(code: string, manualAddress: string | undefined, profile: CollabProfile) {
  install();
  return net().find(code, manualAddress, profile);
}

export async function guestJoin(ticket: string, profile: CollabProfile, hostName: string): Promise<void> {
  install();
  if (S) await stopSession();
  useCollab.setState({ phase: 'joining', role: 'guest', error: null, progress: 'En attente de l’accord de l’hôte…' });
  const s: Session = { role: 'guest', me: '?', profile, workspaceId: null, shareId: '', title: '', records: null, rooms: makeRooms('guest'), queue: [], ready: false, hostName, flushed: new Set(), fetchTimers: new Map() };
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
    useCollab.setState({ me: r.you, members: r.members, shareId: s.shareId, title: s.title, progress: 'Réception de l’espace…' });
    send('h', { t: 'hi', haveWs: !!haveWs });
  } catch (e) {
    if (S === s) S = null;
    useCollab.setState({ phase: 'idle', role: null, progress: null, error: errorMessage(e) });
    throw e;
  }
}

/** Invité : liste des livres de l'hôte → ceux qui manquent ici. */
async function guestOnBooks(head: Head) {
  const s = S!;
  const books = useStore.getState().books;
  const want: string[] = [];
  const alias: [string, string][] = [];
  for (const e of (Array.isArray(head.list) ? head.list : []) as Any[]) {
    const local = await findLocalBook({ sha256: typeof e.sha256 === 'string' ? e.sha256 : null, size: Number(e.size) || 0 }, books);
    if (local && !local.missing) alias.push([String(e.gid), local.id]);
    else want.push(String(e.id));
  }
  (s as Any).bookAlias = alias;
  send('h', { t: 'want', books: want });
}

/** Invité : état initial reçu (paquet + éléments). */
async function guestOnState(head: Head, body: Uint8Array) {
  const s = S!;
  const st0 = useStore.getState();
  let wsId = workspaceForShare(s.shareId);
  const alias: [string, string][] = (s as Any).bookAlias ?? [];
  useCollab.setState({ progress: 'Ajout à votre bibliothèque…' });
  const had = !!wsId;
  if (!wsId) {
    const res = await importSharePackage(body);
    wsId = res.workspace?.id ?? null;
  }
  if (!wsId) throw new Error('L’espace partagé n’a pas pu être créé ici.');
  s.workspaceId = wsId;
  const rec = makeRecords(s, wsId);
  for (const [g, l] of alias) rec.addAlias('book', g, l);
  const hostKeys = new Set<string>(Array.isArray(head.keys) ? (head.keys as string[]) : []);
  // Vie privée : ce qui était déjà ici dans les livres de l'espace (et qui ne vient pas de l'hôte) reste ici.
  const mine = rec.snapshot();
  for (const [k, v] of mine) if (!hostKeys.has(k) && (v.c === 'highlight' || v.c === 'map')) rec.privateKeys.add(k);
  for (const [k, t] of (Array.isArray(head.tags) ? head.tags : []) as [string, Tag][]) rec.tags.set(k, t);
  rec.clock = Math.max(0, ...[...rec.tags.values()].map((t) => t[0]));
  stopWatch(s.shareId);
  for (const [k, t] of Object.entries(await knownMtimes(s.shareId))) rec.mtimes.set(k, t);
  s.records = rec;
  rec.start();
  if (had && st0.workspaces.some((w) => w.id === wsId)) {
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
  send(to, { t: 'fetch', c, g });
  const k = keyOf(c, g);
  clearTimeout(s.fetchTimers.get(k));
  // Sans réponse (il est parti ?) : on demande à l'hôte.
  s.fetchTimers.set(
    k,
    setTimeout(() => {
      if (S === s && to !== 'h' && s.role === 'guest') send('h', { t: 'fetch', c, g });
    }, 8000),
  );
}

async function onFetch(from: string, head: Head) {
  const s = S;
  const c = head.c === 'draft' ? 'draft' : head.c === 'book' ? 'book' : null;
  const g = String(head.g ?? '');
  if (!s?.records || !c || !g) return;
  const id = s.records.local(c, g);
  const st = useStore.getState();
  if (c === 'book') {
    const b = st.books.find((x) => x.id === id);
    if (!b || b.missing) return;
    const names = [...bookSourceFiles(b), ...bookExtraFiles(b)];
    const files: { name: string; data: ArrayBuffer }[] = [];
    for (const n of names) {
      const data = await host.readFile(b.id, n).catch(() => null);
      if (data) files.push({ name: n, data });
    }
    const fp = await bookFingerprint(b);
    const { list, body } = joinFiles(files);
    const meta = { title: b.title, author: b.author, format: b.format, fileName: b.fileName, originalName: b.originalName, size: b.size, edition: b.edition, cover: b.cover, pages: b.pages, sha256: fp?.sha256 ?? null };
    send(from, { t: 'files', c, g, rec: meta, list }, body);
  } else {
    const d = st.drafts.find((x) => x.id === id);
    if (!d) return;
    const raw = await host.readFile(d.id, d.fileName).catch(() => null);
    if (!raw) return;
    const shared = (await shareableDocx(raw)).data; // jamais les notes privées
    const { list, body } = joinFiles([{ name: d.fileName, data: shared }]);
    send(from, { t: 'files', c, g, rec: { title: d.title, fileName: d.fileName, template: d.template, wordCount: d.wordCount, wordGoal: d.wordGoal }, list }, body);
  }
}

const SAFE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
async function onFiles(head: Head, body: Uint8Array) {
  const s = S;
  const c = head.c === 'draft' ? 'draft' : head.c === 'book' ? 'book' : null;
  const g = String(head.g ?? '');
  const meta = (head.rec ?? {}) as Any;
  const files = splitFiles(head.list, body);
  if (!s?.records || !c || !g || !files || !files.every((f) => SAFE.test(f.name) && !f.name.includes('..'))) return;
  clearTimeout(s.fetchTimers.get(keyOf(c, g)));
  if (s.records.local(c, g)) {
    s.records.fetchDone(c, g);
    s.records.resume();
    return;
  }
  const st = useStore.getState();
  const free = (id: string) => !st.books.some((b) => b.id === id) && !st.drafts.some((d) => d.id === id);
  const id = free(g) && SAFE.test(g) ? g : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const origin = id === g ? {} : { shareOrigin: { shareId: s.shareId, srcId: g } };
  if (c === 'book') {
    // Déjà là (même empreinte) : alias, aucun doublon.
    const local = typeof meta.sha256 === 'string' ? await findLocalBook({ sha256: meta.sha256, size: Number(meta.size) || 0 }, st.books) : null;
    if (local && !local.missing) s.records.addAlias('book', g, local.id);
    else {
      for (const f of files) await host.storeFile(id, f.name, f.data);
      const now = Date.now();
      const fileName = SAFE.test(String(meta.fileName)) ? String(meta.fileName) : files[0]?.name ?? 'source.bin';
      const book: Book = {
        id,
        title: String(meta.title ?? 'Sans titre').slice(0, 500),
        author: String(meta.author ?? '').slice(0, 500),
        format: ['epub', 'pdf', 'docx', 'md', 'txt', 'html', 'image'].includes(meta.format) ? meta.format : 'txt',
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
        ...origin,
      };
      useStore.getState().applyExternal((cur) => ({ books: [book, ...cur.books] }));
    }
  } else {
    const f = files[0];
    if (!f) return;
    const fileName = SAFE.test(String(meta.fileName)) ? String(meta.fileName) : 'document.docx';
    await host.storeFile(id, fileName, f.data);
    const now = Date.now();
    const d: Draft = { id, title: String(meta.title ?? 'Sans titre').slice(0, 300), fileName, externalPath: null, wordCount: Number(meta.wordCount) || 0, template: null, createdAt: now, updatedAt: now, ...(typeof meta.wordGoal === 'number' ? { wordGoal: meta.wordGoal } : {}), ...origin };
    useStore.getState().applyExternal((cur) => ({ drafts: [...cur.drafts, d] }));
  }
  s.records.fetchDone(c, g);
  s.records.resume();
}

/** Écrit réuni par un participant qui revient : version d'avant, puis le fichier réuni. */
async function onMergedDocx(from: string, head: Head, body: Uint8Array) {
  const s = S!;
  const g = String(head.g ?? '');
  const id = s.records?.local('draft', g);
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
async function onMessage(from: string, head: Head, body: Uint8Array) {
  const s = S;
  if (!s) return;
  // Invité : tant que l'espace n'est pas prêt, seuls les messages d'arrivée passent ; le reste attend.
  if (!s.ready && !['books', 'state', 'stopping', 'rooms', 'room-ok'].includes(head.t)) {
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
        if (s.role === 'host') await s.rooms.hostHandle(from, head);
        break;
      case 'room-ok':
        s.rooms.onRoomOk(head);
        break;
      case 'rooms':
        if (s.role === 'guest') s.rooms.setView(head.rooms as Record<string, string[]>);
        break;
      case 'docx':
        if (head.merged) await onMergedDocx(from, head, body);
        else await s.rooms.onDocx(head, body);
        break;
      case 'docx-busy':
        toast(`« ${String(head.title ?? 'Un écrit')} » est ouvert chez quelqu’un : votre version réunie est gardée dans ses versions ici.`, 'info');
        break;
      case 'fetch':
        await onFetch(from, head);
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
      useCollab.setState({ members: e.members });
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
    if (e.type === 'members') useCollab.setState({ members: e.members });
    else if (e.type === 'hello' && e.resumed) {
      s.rooms.setLink(true);
      useCollab.setState({ phase: 'live', members: e.members });
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
  try {
    s.records?.diffNow();
  } catch {
    /* rien */
  }
  s.records?.stop();
  s.rooms.stop();
  for (const t of s.fetchTimers.values()) clearTimeout(t);
  void import('./reunion').then((m) => m.rememberSession(s.shareId, s.workspaceId, s.records, s.role === 'host' ? null : s.hostName)).catch(() => undefined);
  useCollab.setState({ role: null, phase: 'idle', workspaceId: null, shareId: null, me: null, members: [], requests: [], code: null, progress: null, rooms: {} });
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
