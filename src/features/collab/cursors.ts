// ─────────────────────────────────────────────────────────────
// Travailler à plusieurs : les pointeurs des autres, en direct, sur les cartes et dans les livres.
//
// Léger (aucun import de la session) : session.ts branche ici son canal chiffré (setCursorBridge) quand
// la session est prête et le retire à la fin. Hors session, ou seul dans la session, rien ne part et
// aucun écouteur ne tourne.
//
// Message éphémère (jamais enregistré, jamais rejoué, jamais mis en file d'attente) :
//   { t: 'cur', k, ts, p?, a?, s?, w?, ask?, bye? }
//   k   contexte partagé : « m:<gid de la carte> » ou « b:<gid du livre> » (identifiants communs de records.ts)
//   ts  horloge de l'expéditeur (performance.now, ms) : le destinataire rejoue le mouvement à sa cadence
//   p   position rattachée au contenu (voir Loc), null = le pointeur a quitté la vue
//   a   ce que la personne fait sur une carte : déplacement (cadre autour du pointeur) ou modification
//   s   sa sélection de texte dans un livre (voir Sel), null = plus de sélection ; jamais le texte lui-même
//   w   où elle lit (« page 12 »), ask = « où êtes-vous ? », bye = elle a quitté ce livre / cette carte
//
// Cadence : au plus un message toutes les SEND_MS (25 par seconde), seulement si la position ou la
// sélection a changé (rien quand rien ne bouge). Une sélection ne s'efface pas avec l'inactivité : elle
// reste affichée tant qu'elle existe chez la personne.
// ─────────────────────────────────────────────────────────────
import { create } from 'zustand';
import { useCollab } from './collabState';

/** Position dans le contenu. Carte : repère de la carte. PDF / photos : page + fraction de la page.
 *  EPUB / HTML : chapitre + caractère sous le pointeur (offset du textContent du chapitre, le même chez
 *  tous) + position dans ce caractère (rx, ry) ; hors du texte, fraction de la largeur du chapitre (mx). */
export type Loc =
  | { x: number; y: number }
  | { u: string; fx: number; fy: number }
  | { u: string; o: number; rx?: number; mx?: number; ry: number };

/** Sélection de texte dans un livre, rattachée au contenu (jamais le texte) :
 *  - EPUB / HTML : chapitre (u = « c<n> ») + offsets [a, b) dans le textContent du chapitre ;
 *  - PDF : page (u = « p<n> ») + offsets [a, b) dans le textContent du calque de texte de la page ;
 *  - photos (texte reconnu) : page + rectangles en fractions de l'image, à plat [x, y, w, h, x, y, w, h…]. */
export type Sel = { u: string; a: number; b: number } | { u: string; r: number[] };
export const MAX_SEL_RECTS = 64;

/** Carte : déplacement (boîte des cartes déplacées, relative au pointeur, unités de la carte ; n : la carte, si une
 *  seule) ou modification (e : la carte). */
export type Act = { m: [number, number, number, number]; n?: string } | { e: string };

export interface Where {
  u: string;
  label: string;
}

export interface Sample {
  t: number;
  loc: Loc | null;
}

export interface Peer {
  id: string;
  ctx: string;
  samples: Sample[];
  /** Décalage d'horloge estimé : instant local de réception − horodatage de l'expéditeur (minimum vu). */
  offset: number;
  lastAt: number;
  act: Act | null;
  where: Where | null;
  /** Sélection de texte en cours (livres), sans fondu d'inactivité : la dernière reçue. */
  sel: Sel | null;
  /** Sélections reçues, horodatées comme les positions : rejouées avec le même retard que le pointeur
   *  (selShown), pour que la teinte et l'étiquette avancent avec lui et non devant lui. */
  sels: { t: number; sel: Sel | null }[];
  /** Sélection d'avant la plus ancienne gardée dans `sels`. */
  selBase: Sel | null;
}

export interface CursorBridge {
  send(head: Record<string, unknown> & { t: string }): void;
  /** Identifiant commun d'une carte ou d'un livre de l'espace partagé (null : hors de l'espace). */
  gid(c: 'map' | 'book', localId: string): string | null;
}

export const SEND_MS = 40;
/** Retard de rejeu chez le destinataire (ms) : couvre l'irrégularité d'arrivée de deux à trois paquets.
 *  Le même pour le pointeur (LiveCursors) et la sélection (ReaderSelections). */
export const REPLAY_MS = 110;
export const IDLE_MS = 3500;
const MAX_SAMPLES = 24;
/** Au-delà de cet écart entre deux positions, la personne s'était arrêtée (sinon : simple retard réseau). */
const REST_MS = 250;

let bridge: CursorBridge | null = null;
const peers = new Map<string, Peer>(); // `${peer}|${ctx}`
const listeners = new Map<string, Set<() => void>>();
/** Mes contextes ouverts (pour répondre à « où êtes-vous ? »). */
const mine = new Map<string, { where: Where | null; sel: Sel | null; count: number }>();
/** Pointeurs affichés ici (`${ctx}|${personne}`). Un seul prénom à la fois, et qui ne saute pas : tant que le
 *  pointeur d'une personne est à l'écran, son prénom le suit ; sa sélection ne reprend le prénom (au bout du
 *  passage) qu'une fois le pointeur parti (immobile, sorti de la vue). */
const shownCursors = new Set<string>();
export function cursorShown(ctx: string, id: string): boolean {
  return shownCursors.has(`${ctx}|${id}`);
}
export function setCursorShown(ctx: string, id: string, on: boolean) {
  const k = `${ctx}|${id}`;
  if (on === shownCursors.has(k)) return;
  if (on) shownCursors.add(k);
  else shownCursors.delete(k);
  notify(ctx);
}
/** Compteur de messages envoyés (mesure de cadence par les tests). */
export const sentStats = { n: 0, byCtx: new Map<string, number>() };

function notify(ctx: string) {
  for (const f of listeners.get(ctx) ?? []) f();
}

export function setCursorBridge(b: CursorBridge | null) {
  bridge = b;
  if (!b) {
    const ctxs = new Set([...peers.values()].map((p) => p.ctx));
    peers.clear();
    for (const c of ctxs) notify(c);
  }
  useCursorGate.setState({ on: !!b });
  if (b && othersHere()) for (const [ctx, m] of mine) b.send({ t: 'cur', k: ctx, ts: now(), w: m.where, ask: 1, ...(m.sel ? { s: m.sel } : {}) });
}

const now = () => Math.round(performance.now());

// ── Porte d'entrée : faut-il faire quoi que ce soit ? (session prête et au moins une autre personne) ──
export const useCursorGate = create<{ on: boolean }>(() => ({ on: false }));
export function othersHere(): boolean {
  if (!bridge) return false;
  const c = useCollab.getState();
  return c.phase === 'live' && c.members.filter((m) => m.state === 'live').length > 1;
}
/** Identifiant de contexte partagé (« m:… » / « b:… ») si des pointeurs peuvent circuler, sinon null. */
export function ctxKeyOf(c: 'map' | 'book', localId: string): string | null {
  if (!bridge || !localId) return null;
  const g = bridge.gid(c, localId);
  return g ? `${c === 'map' ? 'm' : 'b'}:${g}` : null;
}

// ── Départ ──
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const r1 = (n: number) => Math.round(n * 10) / 10;
function roundLoc(l: Loc): Loc {
  if ('x' in l) return { x: r1(l.x), y: r1(l.y) };
  if ('fx' in l) return { u: l.u, fx: r4(l.fx), fy: r4(l.fy) };
  const o: Loc = { u: l.u, o: l.o, ry: r4(l.ry) };
  if (l.rx !== undefined) o.rx = r4(l.rx);
  if (l.mx !== undefined) o.mx = r4(l.mx);
  return o;
}

/** Émetteur d'un contexte (une carte, un livre ouvert). */
export class Publisher {
  private pending: Loc | null | undefined = undefined;
  /** Instant du mouvement en attente (horodatage envoyé : celui du geste, pas de l'envoi). */
  private pendingAt = 0;
  private act: Act | null = null;
  private actDirty = false;
  private lastJson = '';
  private lastSent = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private where: Where | null = null;
  private sel: Sel | null = null;
  private selDirty = false;
  private closed = false;

  constructor(readonly ctx: string) {
    const m = mine.get(ctx);
    if (m) m.count++;
    else mine.set(ctx, { where: null, sel: null, count: 1 });
    if (othersHere()) bridge?.send({ t: 'cur', k: ctx, ts: now(), ask: 1 });
  }

  /** Le pointeur bouge (ou quitte la vue : null). `at` : instant du geste (event.timeStamp). */
  move(loc: Loc | null, at?: number) {
    if (this.closed || !othersHere()) return;
    this.pending = loc ? roundLoc(loc) : null;
    const t = now();
    this.pendingAt = at !== undefined && at > 0 && at <= t + 1 && at > t - 1000 ? Math.round(at) : t;
    this.schedule();
  }
  setAct(a: Act | null) {
    if (this.closed) return;
    const j = JSON.stringify(a);
    if (j === JSON.stringify(this.act)) return;
    this.act = a;
    this.actDirty = true;
    if (othersHere()) this.schedule();
  }
  /** Ma sélection de texte change (null : plus de sélection). Envoyée à la cadence des pointeurs. */
  setSel(s: Sel | null) {
    if (this.closed) return;
    if (JSON.stringify(s) === JSON.stringify(this.sel)) return;
    this.sel = s;
    const m = mine.get(this.ctx);
    if (m) m.sel = s;
    this.selDirty = true;
    if (othersHere()) this.schedule();
  }
  setWhere(w: Where | null) {
    if (this.closed || (w?.u === this.where?.u && w?.label === this.where?.label)) return;
    this.where = w;
    const m = mine.get(this.ctx);
    if (m) m.where = w;
    if (othersHere()) bridge?.send({ t: 'cur', k: this.ctx, ts: now(), w });
  }
  private schedule() {
    if (this.timer) return;
    const wait = Math.max(0, this.lastSent + SEND_MS - performance.now());
    if (wait === 0) this.flush();
    else this.timer = setTimeout(() => this.flush(), wait);
  }
  private flush() {
    this.timer = null;
    if (this.closed || !bridge) return;
    const head: Record<string, unknown> & { t: string } = { t: 'cur', k: this.ctx, ts: now() };
    let any = false;
    if (this.pending !== undefined) {
      const j = JSON.stringify(this.pending);
      if (j !== this.lastJson) {
        head.p = this.pending;
        head.ts = this.pendingAt;
        this.lastJson = j;
        any = true;
      }
      this.pending = undefined;
    }
    if (this.actDirty) {
      head.a = this.act;
      this.actDirty = false;
      any = true;
    }
    if (this.selDirty) {
      head.s = this.sel;
      this.selDirty = false;
      any = true;
    }
    if (!any) return;
    this.lastSent = performance.now();
    sentStats.n++;
    sentStats.byCtx.set(this.ctx, (sentStats.byCtx.get(this.ctx) ?? 0) + 1);
    bridge.send(head);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    const m = mine.get(this.ctx);
    if (m && --m.count <= 0) mine.delete(this.ctx);
    if (bridge && othersHere()) bridge.send({ t: 'cur', k: this.ctx, ts: now(), bye: 1 });
  }
}

// ── Arrivée ──
const num = (x: unknown, lo: number, hi: number): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : null);
const unit = (x: unknown): string | null => (typeof x === 'string' && /^[pc]\d{1,6}$/.test(x) ? x : null);
function readLoc(p: unknown): Loc | null | undefined {
  if (p === null) return null;
  if (!p || typeof p !== 'object') return undefined;
  const o = p as Record<string, unknown>;
  if ('x' in o) {
    const x = num(o.x, -1e7, 1e7);
    const y = num(o.y, -1e7, 1e7);
    return x === null || y === null ? undefined : { x, y };
  }
  const u = unit(o.u);
  if (!u) return undefined;
  if ('fx' in o) {
    const fx = num(o.fx, -1, 2);
    const fy = num(o.fy, -1, 2);
    return fx === null || fy === null ? undefined : { u, fx, fy };
  }
  const off = num(o.o, 0, 1e9);
  const ry = num(o.ry, -50, 50);
  if (off === null || ry === null) return undefined;
  const out: Loc = { u, o: Math.floor(off), ry };
  if (o.rx !== undefined) {
    const rx = num(o.rx, -50, 50);
    if (rx === null) return undefined;
    out.rx = rx;
  } else {
    const mx = num(o.mx, -1, 2);
    if (mx === null) return undefined;
    out.mx = mx;
  }
  return out;
}
function readAct(a: unknown): Act | null | undefined {
  if (a === null) return null;
  if (!a || typeof a !== 'object') return undefined;
  const o = a as Record<string, unknown>;
  if (Array.isArray(o.m) && o.m.length === 4 && o.m.every((v) => num(v, -1e6, 1e6) !== null)) {
    const m = { m: o.m.map(Number) as [number, number, number, number] };
    return typeof o.n === 'string' && o.n.length > 0 && o.n.length <= 200 ? { ...m, n: o.n } : m;
  }
  if (typeof o.e === 'string' && o.e.length > 0 && o.e.length <= 200) return { e: o.e };
  return undefined;
}
function readSel(s: unknown): Sel | null | undefined {
  if (s === null) return null;
  if (!s || typeof s !== 'object') return undefined;
  const o = s as Record<string, unknown>;
  const u = unit(o.u);
  if (!u) return undefined;
  if (Array.isArray(o.r)) {
    if (u[0] !== 'p' || !o.r.length || o.r.length % 4 || o.r.length > MAX_SEL_RECTS * 4) return undefined;
    if (!o.r.every((v) => num(v, -0.01, 1.01) !== null)) return undefined;
    return { u, r: o.r.map(Number) };
  }
  const a = num(o.a, 0, 1e9);
  const b = num(o.b, 0, 1e9);
  if (a === null || b === null || b <= a || b - a > 2e6) return undefined;
  return { u, a: Math.floor(a), b: Math.floor(b) };
}
function readWhere(w: unknown): Where | null | undefined {
  if (w === null) return null;
  if (!w || typeof w !== 'object') return undefined;
  const o = w as Record<string, unknown>;
  const u = unit(o.u);
  if (!u || typeof o.label !== 'string') return undefined;
  return { u, label: o.label.slice(0, 60) };
}

/** Message « cur » reçu (session.ts). */
export function onCursorMessage(from: string, head: Record<string, unknown>) {
  const ctx = typeof head.k === 'string' && /^[mb]:.{1,300}$/.test(head.k) ? head.k : null;
  const ts = num(head.ts, 0, 1e12);
  if (!ctx || ts === null || !bridge) return;
  const key = `${from}|${ctx}`;
  if (head.bye) {
    if (peers.delete(key)) notify(ctx);
    return;
  }
  const t0 = performance.now();
  let p = peers.get(key);
  if (!p) {
    p = { id: from, ctx, samples: [], offset: t0 - ts, lastAt: 0, act: null, where: null, sel: null, sels: [], selBase: null };
    peers.set(key, p);
  }
  // Horloge de l'expéditeur repartie de zéro (page rechargée) : on oublie l'historique.
  const last = p.samples[p.samples.length - 1];
  const lastSel = p.sels[p.sels.length - 1];
  if ((last && ts < last.t - 1000) || (lastSel && ts < lastSel.t - 1000)) {
    p.samples = [];
    p.selBase = p.sel;
    p.sels = [];
    p.offset = t0 - ts;
  }
  p.offset = Math.min(p.offset, t0 - ts);
  if (head.w !== undefined) {
    const w = readWhere(head.w);
    if (w !== undefined) p.where = w;
  }
  if (head.a !== undefined) {
    const a = readAct(head.a);
    if (a !== undefined) p.act = a;
  }
  if (head.s !== undefined) {
    const sl = readSel(head.s);
    if (sl !== undefined) {
      p.sel = sl;
      p.sels.push({ t: ts, sel: sl });
      if (p.sels.length > MAX_SAMPLES) p.selBase = p.sels.splice(0, p.sels.length - MAX_SAMPLES).pop()!.sel;
    }
  }
  if (head.p !== undefined) {
    const loc = readLoc(head.p);
    if (loc !== undefined) {
      const prev = p.samples[p.samples.length - 1];
      // Reprise après un arrêt : le pointeur était immobile jusqu'à juste avant ce point.
      if (prev && prev.loc && loc && ts - prev.t > REST_MS) p.samples.push({ t: ts - SEND_MS, loc: prev.loc });
      p.samples.push({ t: ts, loc });
      if (p.samples.length > MAX_SAMPLES) p.samples.splice(0, p.samples.length - MAX_SAMPLES);
      p.lastAt = t0;
      if (!loc) p.act = p.act && 'e' in p.act ? p.act : null;
    }
  } else if (head.a !== undefined) p.lastAt = Math.max(p.lastAt, t0);
  if (head.ask && mine.has(ctx)) {
    const m = mine.get(ctx)!;
    bridge.send({ t: 'cur', k: ctx, ts: now(), w: m.where, ...(m.sel ? { s: m.sel } : {}) });
  }
  notify(ctx);
}

/** Sélection à montrer maintenant : celle qui était en cours chez la personne il y a REPLAY_MS, comme son
 *  pointeur (sans retard en mouvement réduit). `later` : une sélection plus récente attend son tour. */
export function selShown(p: Peer, now: number, still: boolean): { sel: Sel | null; later: boolean } {
  if (still || !p.sels.length) return { sel: p.sel, later: false };
  const rt = now - p.offset - REPLAY_MS;
  let i = p.sels.length - 1;
  while (i >= 0 && p.sels[i].t > rt) i--;
  return { sel: i >= 0 ? p.sels[i].sel : p.selBase, later: i < p.sels.length - 1 };
}

/** Personnes présentes dans un contexte (copie). */
export function peersIn(ctx: string): Peer[] {
  const out: Peer[] = [];
  for (const p of peers.values()) if (p.ctx === ctx) out.push(p);
  return out;
}
export function subscribe(ctx: string, f: () => void): () => void {
  let s = listeners.get(ctx);
  if (!s) listeners.set(ctx, (s = new Set()));
  s.add(f);
  return () => {
    s!.delete(f);
    if (!s!.size) listeners.delete(ctx);
  };
}

// Une personne partie de la session : ses pointeurs disparaissent.
useCollab.subscribe((s, prev) => {
  if (s.members === prev.members) return;
  const live = new Set(s.members.filter((m) => m.state === 'live').map((m) => m.id));
  for (const [k, p] of peers)
    if (!live.has(p.id)) {
      peers.delete(k);
      notify(p.ctx);
    }
});

// Tests (MARGINALIA_E2E) : mesure de cadence et état.
if (typeof window !== 'undefined' && new URLSearchParams(location.search).has('e2e')) {
  (window as unknown as { __cursors?: unknown }).__cursors = { sentStats, peers, peersIn, othersHere, mine };
}
