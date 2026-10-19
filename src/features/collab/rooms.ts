// ─────────────────────────────────────────────────────────────
// Travailler à plusieurs : les écrits en direct (Yjs).
//
// - Une « salle » par écrit (son gid). Le moteur (SuperDoc) reçoit un Y.Doc et un fournisseur y-websocket
//   de SA copie de yjs (yjs.ts) ; le WebSocket de ce fournisseur est remplacé par RelaySocket, qui passe
//   par le canal chiffré de la session. Les messages Yjs (synchronisation, curseurs) sont relayés tels
//   quels : diffusés aux autres extrémités de la salle, ou renvoyés à l'extrémité qui a posé la question.
// - L'hôte coordonne : il garde pour toute la session un Y.Doc « silencieux » par salle ouverte (sans
//   éditeur, sans curseur). La première personne qui ouvre l'écrit « amorce » la salle avec son fichier ;
//   les suivantes s'y synchronisent (jamais deux amorçages : le texte ne serait pas dédoublé). Un invité
//   coupé qui revient retrouve la même histoire Yjs et s'y fond.
// - Fichiers : chaque éditeur enregistre son exemplaire comme d'habitude ; la première personne de la
//   salle envoie en plus son .docx enregistré à ceux qui n'ont pas l'écrit ouvert, qui le rangent dans
//   leur bibliothèque : à l'arrêt, chacun garde un exemplaire à jour.
// ─────────────────────────────────────────────────────────────
import { host } from '../../lib/platform';
import { useStore } from '../../lib/store';
import type { Head } from './wire';
import { yjsKit, type YKit } from './yjs';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CollabBinding {
  mode: 'seed' | 'sync';
  ydoc: Any;
  provider: Any;
  user: { name: string; color: string };
  /** Nom de l'hôte (versions « Avant la reconnexion avec … »). */
  hostName: string;
  /** Après chaque enregistrement réussi de l'éditeur. */
  onSaved(data: ArrayBuffer, words: number): void;
  /** L'éditeur se ferme. */
  release(): void;
  /** La session s'arrête alors que l'écrit est ouvert : il continue seul. */
  onDetach?: () => void;
  detached: boolean;
}

export interface RoomsOptions {
  me(): string;
  isHost: boolean;
  /** Envoi à un participant ('all', 'h' ou id). */
  send(to: string, head: Head, body?: Uint8Array): void;
  user(): { name: string; color: string };
  hostName(): string;
  /** gid → id local d'un écrit ; id local → gid. */
  draftLocal(g: string): string | null;
  draftGid(localId: string): string;
}

let seq = 0;

interface Endpoint {
  id: string;
  room: string;
  /** Y.Doc du fournisseur de cette extrémité (réponse « étape 1 » d'un serveur, voir deliver). */
  doc: () => Any;
  readyState: number;
  replyTo: string | null;
  onopen: ((e?: unknown) => void) | null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null;
  onclose: ((e?: unknown) => void) | null;
}

export class Rooms {
  private kit: YKit | null = null;
  private eps = new Map<string, Endpoint>();
  private linkUp = true;
  /** Hôte : Y.Doc silencieux par salle, et qui y édite (ordre d'arrivée). */
  private silent = new Map<string, { doc: Any; provider: Any }>();
  private editors = new Map<string, string[]>();
  /** Vue de tous : salle → personnes qui y éditent. */
  view: Record<string, string[]> = {};
  private waiting = new Map<string, (mode: 'seed' | 'sync') => void>();
  private bindings = new Map<string, CollabBinding>();
  private prevSaved = new Set<string>();
  private stopped = false;
  onView?: () => void;

  constructor(readonly o: RoomsOptions) {}

  async ready(): Promise<YKit> {
    this.kit ??= await yjsKit();
    return this.kit;
  }

  // ── Extrémités (faux WebSocket) ──
  private socketClass(room: string, doc: () => Any) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const rooms = this;
    return class RelaySocket implements Endpoint {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      CONNECTING = 0;
      OPEN = 1;
      CLOSING = 2;
      CLOSED = 3;
      binaryType = 'arraybuffer';
      id = `${rooms.o.me()}:${++seq}`;
      room = room;
      doc = doc;
      readyState = 0;
      replyTo: string | null = null;
      onopen: ((e?: unknown) => void) | null = null;
      onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
      onclose: ((e?: unknown) => void) | null = null;
      onerror: ((e?: unknown) => void) | null = null;
      constructor() {
        rooms.eps.set(this.id, this);
        if (rooms.linkUp && !rooms.stopped) setTimeout(() => rooms.open(this), 0);
      }
      send(buf: ArrayBuffer | Uint8Array) {
        rooms.ySend(this, buf instanceof Uint8Array ? buf : new Uint8Array(buf));
      }
      close() {
        rooms.eps.delete(this.id);
        if (this.readyState === 3) return;
        this.readyState = 3;
        setTimeout(() => this.onclose?.({ code: 1000 }), 0);
      }
    };
  }
  private open(ep: Endpoint) {
    if (ep.readyState !== 0 || !this.eps.has(ep.id) || !this.linkUp) return;
    ep.readyState = 1;
    ep.onopen?.();
  }
  private ySend(ep: Endpoint, bytes: Uint8Array) {
    if (ep.readyState !== 1 || this.stopped) return;
    const to = ep.replyTo;
    const head: Head = { t: 'y', r: ep.room, f: ep.id, ...(to ? { to } : {}) };
    if (to) {
      const peer = to.split(':')[0];
      if (peer === this.o.me()) this.deliver(head, bytes);
      else if (this.linkUp) this.o.send(peer, head, bytes);
      return;
    }
    this.deliver(head, bytes);
    if (this.linkUp) this.o.send('all', head, bytes);
  }
  /** Message Yjs reçu (ou local) : aux extrémités de la salle concernées. */
  deliver(head: Head, body: Uint8Array) {
    const r = String(head.r ?? '');
    const f = String(head.f ?? '');
    const to = typeof head.to === 'string' ? head.to : null;
    for (const ep of [...this.eps.values()]) {
      if (ep.room !== r || ep.id === f || ep.readyState !== 1 || (to && ep.id !== to)) continue;
      const prev = ep.replyTo;
      ep.replyTo = f;
      try {
        ep.onmessage?.({ data: body.slice().buffer as ArrayBuffer });
        // Un serveur y-websocket répond à l'« étape 1 » d'un nouveau venu par la sienne : le nouveau venu
        // renvoie alors ce qui lui manque (ses modifications faites hors connexion). Seulement pour une étape 1
        // diffusée (pas pour une réponse adressée : sinon les deux se renverraient la balle sans fin).
        if (!to && body.length > 1 && body[0] === 0 && body[1] === 0) {
          const sv = stateVector(ep.doc());
          if (sv) this.ySend(ep, concat(new Uint8Array([0, 0]), varUint(sv.length), sv));
        }
      } catch (e) {
        console.warn('collab : message Yjs', e);
      } finally {
        ep.replyTo = prev;
      }
    }
  }

  /** Invité : lien coupé (les fournisseurs se reconnecteront d'eux-mêmes) / rétabli. */
  setLink(up: boolean) {
    this.linkUp = up;
    for (const ep of [...this.eps.values()]) {
      if (!up && ep.readyState === 1) {
        ep.readyState = 3;
        this.eps.delete(ep.id);
        setTimeout(() => ep.onclose?.({ code: 1006 }), 0);
      } else if (up && ep.readyState === 0) setTimeout(() => this.open(ep), 0);
    }
  }

  private provider(room: string, doc: Any): Any {
    const { Provider, Awareness } = this.kit!;
    return new Provider('mg-collab://salle', room, doc, { WebSocketPolyfill: this.socketClass(room, () => doc), disableBc: true, awareness: new Awareness(doc), maxBackoffTime: 1500 });
  }

  // ── Coordination (hôte) ──
  private pushView() {
    this.view = Object.fromEntries([...this.editors].filter(([, l]) => l.length));
    this.o.send('all', { t: 'rooms', rooms: this.view });
    this.onView?.();
  }
  /** Hôte : quelqu'un ouvre l'écrit `room`. Renvoie le mode (amorcer ou se synchroniser). */
  async hostJoin(peer: string, room: string): Promise<'seed' | 'sync'> {
    await this.ready();
    let mode: 'seed' | 'sync' = 'sync';
    if (!this.silent.has(room)) {
      const doc = new this.kit!.Doc({ gc: false });
      const provider = this.provider(room, doc);
      provider.awareness.setLocalState(null);
      this.silent.set(room, { doc, provider });
      mode = 'seed';
    }
    const list = this.editors.get(room) ?? [];
    if (!list.includes(peer)) list.push(peer);
    this.editors.set(room, list);
    this.pushView();
    return mode;
  }
  hostLeave(peer: string, room?: string) {
    let changed = false;
    for (const [r, list] of this.editors) {
      if (room && r !== room) continue;
      const i = list.indexOf(peer);
      if (i >= 0) {
        list.splice(i, 1);
        changed = true;
      }
    }
    if (changed) this.pushView();
  }
  /** Hôte : messages de coordination venus d'un participant. */
  async hostHandle(from: string, head: Head) {
    if (head.t === 'room-join' && typeof head.r === 'string') {
      const mode = await this.hostJoin(from, head.r);
      this.o.send(from, { t: 'room-ok', r: head.r, mode });
    } else if (head.t === 'room-leave' && typeof head.r === 'string') this.hostLeave(from, head.r);
  }
  /** Participant : réponse de l'hôte. */
  onRoomOk(head: Head) {
    const w = this.waiting.get(String(head.r));
    if (w) {
      this.waiting.delete(String(head.r));
      w(head.mode === 'seed' ? 'seed' : 'sync');
    }
  }
  setView(v: Record<string, string[]>) {
    this.view = v && typeof v === 'object' ? v : {};
    this.onView?.();
  }
  leader(room: string): string | null {
    return this.view[room]?.[0] ?? null;
  }

  // ── Éditeur ──
  /** L'éditeur ouvre l'écrit `draftId` (id local) : salle, mode, Y.Doc et fournisseur. */
  async bind(draftId: string): Promise<CollabBinding> {
    await this.ready();
    const room = this.o.draftGid(draftId);
    const old = this.bindings.get(room);
    if (old) old.release();
    let mode: 'seed' | 'sync';
    if (this.o.isHost) mode = await this.hostJoin('h', room);
    else {
      mode = await new Promise<'seed' | 'sync'>((resolve, reject) => {
        const t = setTimeout(() => {
          this.waiting.delete(room);
          reject(new Error('L’hôte ne répond pas : l’écrit s’ouvre sans le travail à plusieurs.'));
        }, 8000);
        this.waiting.set(room, (m) => {
          clearTimeout(t);
          resolve(m);
        });
        this.o.send('h', { t: 'room-join', r: room });
      });
    }
    if (this.stopped) throw new Error('La session vient de s’arrêter : l’écrit s’ouvre seul.');
    const ydoc = new this.kit!.Doc({ gc: false });
    const provider = this.provider(room, ydoc);
    const user = this.o.user();
    provider.awareness.setLocalStateField('user', { name: user.name, color: user.color });
    const b: CollabBinding = {
      mode,
      ydoc,
      provider,
      user,
      hostName: this.o.hostName(),
      detached: false,
      onSaved: (data, words) => {
        if (b.detached || this.stopped) return;
        if (this.leader(room) !== this.o.me()) return;
        this.o.send('all', { t: 'docx', g: room, words }, new Uint8Array(data));
      },
      release: () => {
        if (this.bindings.get(room) === b) this.bindings.delete(room);
        if (b.detached) return;
        b.detached = true;
        try {
          provider.destroy();
        } catch {
          /* déjà détruit */
        }
        if (this.stopped) return;
        if (this.o.isHost) this.hostLeave('h', room);
        else this.o.send('h', { t: 'room-leave', r: room });
      },
    };
    this.bindings.set(room, b);
    return b;
  }
  hasEditor(room: string) {
    return this.bindings.has(room);
  }

  /** .docx enregistré par la première personne de la salle : rangé ici si l'écrit n'est pas ouvert. */
  async onDocx(head: Head, body: Uint8Array) {
    const room = String(head.g ?? '');
    if (!room || this.bindings.has(room) || !body.length) return;
    const id = this.o.draftLocal(room);
    const d = id ? useStore.getState().drafts.find((x) => x.id === id) : null;
    if (!d) return;
    const name = d.fileName || 'document.docx';
    if (!this.prevSaved.has(d.id)) {
      // Copie de l'exemplaire d'avant la session (comme l'éditeur le fait à chaque session d'édition).
      try {
        await host.storeFile(d.id, 'document.prev.docx', await host.readFile(d.id, name));
      } catch {
        /* rien à copier */
      }
      this.prevSaved.add(d.id);
    }
    await host.storeFile(d.id, name, body.slice().buffer as ArrayBuffer);
    const words = Number(head.words);
    if (Number.isFinite(words)) useStore.getState().applyExternal((s) => ({ drafts: s.drafts.map((x) => (x.id === d.id ? { ...x, wordCount: words } : x)) }));
  }

  /** Fin de session : chaque écrit ouvert continue seul ; les salles sont fermées. */
  stop() {
    this.stopped = true;
    for (const b of [...this.bindings.values()]) {
      b.detached = true;
      try {
        b.provider.destroy();
      } catch {
        /* déjà détruit */
      }
      b.onDetach?.();
    }
    this.bindings.clear();
    for (const s of this.silent.values()) {
      try {
        s.provider.destroy();
        s.doc.destroy();
      } catch {
        /* déjà détruit */
      }
    }
    this.silent.clear();
    for (const ep of this.eps.values()) ep.readyState = 3;
    this.eps.clear();
    for (const w of this.waiting.values()) w('sync');
    this.waiting.clear();
  }
}

// ── Vecteur d'état Yjs (comme Y.encodeStateVector, que la copie embarquée n'expose pas) ──
function varUint(n: number): Uint8Array {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push(0x80 | (n & 0x7f));
    n = Math.floor(n / 128);
  }
  out.push(n);
  return new Uint8Array(out);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
/** Vecteur d'état encodé (v1) d'un Y.Doc : pour chaque client, l'horloge qui suit sa dernière structure. */
export function stateVector(doc: Any): Uint8Array | null {
  const clients: Map<number, Any[]> | undefined = doc?.store?.clients;
  if (!(clients instanceof Map)) return null;
  const sv: [number, number][] = [];
  for (const [client, structs] of clients) {
    const last = structs[structs.length - 1];
    if (last?.id && typeof last.length === 'number') sv.push([client, last.id.clock + last.length]);
  }
  sv.sort((a, b) => b[0] - a[0]);
  return concat(varUint(sv.length), ...sv.flatMap(([c, k]) => [varUint(c), varUint(k)]));
}
