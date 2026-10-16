// Le compagnon : un petit cerveau qui vit sa vie sur l'interface. Il apparaît de temps en temps sur le
// bord haut d'un encadré (cartes de l'accueil, couvertures, cartes d'espace, listes des réglages), s'y
// promène, s'assoit, lit, réfléchit, somnole, fait coucou, dit parfois une citation, puis s'en va.
// Animation à la manière des jeux 2D : le déplacement est fluide (il glisse en marchant, descend en
// s'asseyant), les poses sont dessinées et changent à leur propre rythme (8 images par seconde pour
// marcher ou saluer, 2 à 4 au repos) ; petits effets de vie : tassement en arrivant et en s'asseyant,
// clignements, demi-tour avant de marcher.
// Bulle : placée autour de lui là où elle ne cache aucun texte ni contrôle de l'interface.
// Musculature : selon le nombre de documents (livres + écrits) ; il fait le costaud quand il gagne un niveau.
// Réglage « Compagnon » (jamais, rarement, parfois, souvent) ; mouvement réduit : ni marche ni animation.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import { Sprite, anchorOf, isSeated, VB_H, VB_W, type Level, type Pose, type View } from './Sprite';
import { quotesBy, HELLO_BY, CONTEXT, FLEX, HELLO, JOKES, PONDER, POKE, BYE, QUOTES, GUITAR, WHISTLE, WRITE, CIGAR, pick, type Ctx } from './lines';
import { ALL_PERCHES, PERCHES, STAY, buildVisit, sceneActs, sceneCount, type Act, type Hop, type Page, type Say } from './scenes';
import { CHARACTERS } from './characters';
import './mascot.css';

export type MascotFreq = 'off' | 'rare' | 'sometimes' | 'often';
export const MASCOT_DEFAULT: MascotFreq = 'sometimes';

// Taille : proportionnelle à la fenêtre (plus petit sur un petit écran, plus grand sur un grand), et
// réduite au besoin pour tenir sur un encadré étroit. Une seule instance : l'échelle est un état du module.
let SCALE = 0.7;
let W = VB_W * SCALE;
let H = VB_H * SCALE;
const MIN_SCALE = 0.5;
function applyScale(k: number) {
  SCALE = k;
  W = VB_W * k;
  H = VB_H * k;
}
/** Échelle pour la fenêtre actuelle et la largeur de l'encadré où il se pose. */
export function scaleFor(perchWidth?: number) {
  const vw = innerWidth;
  const base = vw < 1100 ? 0.6 : vw < 1500 ? 0.7 : vw < 2000 ? 0.78 : 0.86;
  const fit = perchWidth ? (perchWidth - 12) / VB_W : base;
  return Math.max(MIN_SCALE, Math.min(base, fit));
}
/** Vitesse de marche (px/s). */
const SPEED = 42;
/** Rythme des poses (images par seconde). */
const FPS: Partial<Record<Pose, number>> = { walk: 8, jump: 8, wave: 8, sitwave: 8, flex: 6, puff: 10, stand: 2, look: 2, sit: 4, read: 4, think: 3, doze: 2, guitar: 6, whistle: 4, write: 4, cigar: 3 };
/** Rythme d'une pose (une pose nouvelle sans rythme déclaré : 3 images par seconde). */
const fps = (p: Pose) => FPS[p] ?? 3;
/** Vues où il peut se montrer (jamais dans le lecteur, l'éditeur ni les tableaux). */
const ROUTES = new Set(['home', 'library', 'workspace', 'settings', 'revision', 'plans', 'extracts', 'concepts', 'arguments', 'maps', 'history', 'trash', 'help']);

const GAP: Record<Exclude<MascotFreq, 'off'>, [number, number]> = {
  rare: [8 * 60e3, 15 * 60e3],
  sometimes: [2 * 60e3, 5 * 60e3],
  often: [25e3, 70e3],
};
const FIRST: Record<Exclude<MascotFreq, 'off'>, [number, number]> = {
  rare: [90e3, 180e3],
  sometimes: [15e3, 35e3],
  often: [3e3, 8e3],
};
const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);
const randInt = (n: number) => Math.floor(Math.random() * n);
const sec = (a: number, b = a) => (a + Math.random() * (b - a)) * 1000;

/** Niveau de musculature selon le nombre de documents. */
export function levelFor(n: number): Level {
  return n < 5 ? 0 : n < 15 ? 1 : n < 40 ? 2 : n < 100 ? 3 : 4;
}
export const LEVEL_STEPS = [0, 5, 15, 40, 100];

/** Bulle : une phrase, ou une citation (auteur, œuvre) avec éventuellement une petite phrase avant. */
type Bubble = { text: string; author?: string; source?: string; lead?: string };
type Flight = { from: HTMLElement; fx: number; to: HTMLElement; tx: number; t0: number; dur: number };
type Side = 'top' | 'left' | 'right';

interface State {
  visible: boolean;
  perch: HTMLElement | null;
  x: number;
  target: number;
  pose: Pose;
  view: View;
  frame: number;
  frameAcc: number;
  facing: 1 | -1;
  act: Act | null;
  left: number;
  queue: Act[];
  next: number;
  bubble: Bubble | null;
  bubbleUntil: number;
  pendingFlex: boolean;
  /** Ligne d'appui affichée (unités), qui rejoint en douceur celle de la pose. */
  anchor: number;
  /** Effet de tassement en cours (arrivée, assise). */
  squash: { t0: number; dur: number; k: number } | null;
  blinkUntil: number;
  nextBlink: number;
  /** Placement de la bulle (gardé tant qu'il reste libre). */
  bubblePos: { l: number; t: number; side: Side; tail: number; w: number; h: number; key: string; at: number; ml: number; mt: number; wait: boolean } | null;
  /** Bulle demandée (clic) : affichée même sans place libre. */
  bubbleForced: boolean;
  /** Numéro de la phrase en cours : la bulle affichée porte ce numéro une fois que React l'a dessinée. */
  bubbleId: number;
  /** Tests : pas de gestes spontanés (coucou). */
  calm: boolean;
  /** Un coucou spontané a déjà eu lieu pendant cette visite (au plus un). */
  wavedMid: boolean;
  /** Saut en cours d'un encadré à un autre. */
  flight: Flight | null;
  /** Tests : accélération du temps. */
  speed: number;
}

function edgeOk(el: HTMLElement, strict: boolean) {
  const r = el.getBoundingClientRect();
  if (r.width < VB_W * MIN_SCALE + 12 || r.height < 24) return false;
  if (r.top < 90 || r.top > innerHeight - 40 || r.left < 0 || r.right > innerWidth) return false;
  if (!strict) return true;
  // Pas sous une fenêtre ou un menu : le haut de l'encadré doit être visible à l'écran.
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 4);
  return !!hit && el.contains(hit);
}

const pageOf = (route: string): Page => (route === 'home' || route === 'library' || route === 'workspace' ? route : 'other');

/** Encadrés visibles où se poser sur cette page. */
function perches(page: Page, avoid: HTMLElement | null = null) {
  const sel = PERCHES[page].join(', ');
  const found = [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => el !== avoid && edgeOk(el, true));
  return found.length || page === 'other' ? found : [...document.querySelectorAll<HTMLElement>(ALL_PERCHES)].filter((el) => el !== avoid && edgeOk(el, true));
}

/** Encadré d'arrivée et place sur son bord : parmi quelques encadrés tirés au hasard, celui où sa
 *  silhouette cache le moins de choses. */
function findPerch(page: Page): { el: HTMLElement; x: number } | null {
  const all = perches(page).sort(() => Math.random() - 0.5).slice(0, 8);
  let best: { el: HTMLElement; x: number; covered: number } | null = null;
  for (const el of all) {
    const rw = el.getBoundingClientRect().width;
    const k = scaleFor(rw);
    const spot = bestX(el, k, 6 + Math.random() * Math.max(0, rw - VB_W * k - 12));
    if (!best || spot.covered < best.covered) best = { el, ...spot };
    if (spot.covered === 0) break;
  }
  // Aucune place où il ne cache rien : il ne vient pas (il réessaiera plus tard).
  return best && best.covered === 0 ? best : null;
}

/** Place libre sur le bord d'un encadré (sa silhouette n'y cache rien), ou null s'il n'y en a pas. */
function freeSpot(el: HTMLElement, prefer?: number): { el: HTMLElement; x: number } | null {
  const rw = el.getBoundingClientRect().width;
  const k = scaleFor(rw);
  const spot = bestX(el, k, prefer ?? 6 + Math.random() * Math.max(0, rw - VB_W * k - 12));
  return spot.covered === 0 ? { el, x: spot.x } : null;
}

/** Cible d'un saut : un encadré précis, ou l'un des plus proches ; toujours avec une place libre. */
function hopTarget(page: Page, from: HTMLElement, h: Hop): { el: HTMLElement; x: number } | null {
  if (h.sel) {
    const el = [...document.querySelectorAll<HTMLElement>(h.sel)].find((e) => edgeOk(e, true)) ?? null;
    return el && el !== from ? freeSpot(el) : null;
  }
  const fr = from.getBoundingClientRect();
  const c = (q: DOMRect) => [q.left + q.width / 2, q.top] as const;
  const [fx, fy] = c(fr);
  const all = perches(page, from)
    .map((el) => {
      const [x, y] = c(el.getBoundingClientRect());
      return { el, d: Math.hypot(x - fx, (y - fy) * 1.4) };
    })
    .sort((a, b) => a.d - b.d);
  const pool = h.near ? all.filter((o) => o.d < 900).slice(0, 6) : all.sort(() => Math.random() - 0.5).slice(0, 8);
  // les plus proches d'abord, avec un peu de hasard entre voisins
  pool.sort((a, b) => a.d * (0.8 + Math.random() * 0.4) - b.d * (0.8 + Math.random() * 0.4));
  for (const o of pool) {
    const spot = freeSpot(o.el);
    if (spot) return spot;
  }
  return null;
}

/** Contexte de la phrase : la page, l'heure, la bibliothèque, et ce sur quoi il est assis. */
function ctxFor(page: Page, perch: HTMLElement | null, level: Level, workspaceId?: string): Ctx {
  const st = useStore.getState();
  const frac = (p: number) => Math.max(0, Math.min(1, !p ? 0 : p > 1 ? p / 100 : p));
  const c: Ctx = { page, hour: new Date().getHours(), books: st.books.length, drafts: st.drafts.length, level };
  const byTitle = (t?: string | null) => (t ? st.books.find((b) => b.title === t.trim()) : undefined);
  let book = undefined as (typeof st.books)[number] | undefined;
  if (perch) {
    const lib = perch.closest<HTMLElement>('.lib-card, .lib-row');
    if (lib?.dataset.selId) book = st.books.find((b) => b.id === lib.dataset.selId);
    if (!book && perch.matches('.home-resume-card')) book = byTitle(perch.querySelector('.home-resume-title')?.textContent);
    if (!book && perch.matches('.ws-card')) book = byTitle(perch.querySelector('.ws-card-title')?.textContent);
    const sp = perch.closest('.home-space');
    const spName = sp?.querySelector('.home-space-name')?.textContent;
    if (spName) c.space = { name: spName, items: Number(/(\d+)\s*élément/.exec(sp!.textContent ?? '')?.[1] ?? 0) };
  }
  if (!book && page === 'home') {
    const t = document.querySelector('.home-resume-card:not(.home-resume-empty) .home-resume-title')?.textContent;
    book = byTitle(t);
  }
  if (book) c.book = { title: book.title, author: book.author || '', progress: frac(book.progress) };
  if (!c.space && page === 'workspace' && workspaceId) {
    const ws = st.workspaces.find((w) => w.id === workspaceId);
    if (ws) c.space = { name: ws.name, items: st.wsItems.filter((i) => i.workspaceId === workspaceId).length };
  }
  const due = document.querySelector('.home-review-n')?.textContent;
  if (due != null && /^\d+$/.test(due.trim())) c.due = Number(due);
  return c;
}

function bubbleFor(say: Say, ctx: Ctx, who?: string): Bubble {
  // Un philosophe cite surtout ses propres œuvres (une fois sur deux), et salue à sa manière.
  const own = who ? quotesBy(who) : [];
  const quote = () => (own.length && Math.random() < 0.5 ? pick(own) : pick(QUOTES));
  switch (say) {
    case 'quote':
      return quote();
    case 'poke':
      return { ...quote(), lead: pick(POKE) };
    case 'joke':
      return { text: pick(JOKES) };
    case 'ponder':
      return { text: pick(PONDER) };
    case 'hello':
      return { text: pick(who && HELLO_BY[who] && Math.random() < 0.6 ? HELLO_BY[who] : HELLO) };
    case 'flex':
      return { text: pick(FLEX) };
    case 'bye':
      return { text: pick(BYE) };
    case 'guitar':
      return { text: pick(GUITAR) };
    case 'whistle':
      return { text: pick(WHISTLE) };
    case 'write':
      return { text: pick(WRITE) };
    case 'cigar':
      return { text: pick(CIGAR) };
    case 'context': {
      const fns = [...CONTEXT].sort(() => Math.random() - 0.5);
      for (const f of fns) {
        const t = f(ctx);
        if (t) return { text: t };
      }
      return { text: pick(JOKES) };
    }
  }
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Bulle : où se mettre sans rien cacher ───────────────────
// On relève les rectangles de ce qu'il ne faut pas cacher autour du personnage (lignes de texte,
// boutons, champs, images ; les grandes cartes comptent moins : couvrir leur fond ne cache rien), puis
// on mesure ce que chaque emplacement possible recouvre.

type Box = { l: number; t: number; r: number; b: number; w: number };
const CONTROL = 'button, a, input, textarea, select, img, svg, canvas, video, [role="button"], [contenteditable="true"]';

/** Marge au-delà de laquelle un élément loin de la zone est écarté avec tout son contenu (un contenu
 *  qui déborde de sa boîte de plus de cette marge est rare ; un élément sans taille est toujours parcouru). */
const PRUNE = 32;

function obstacles(zone: Box): Box[] {
  const out: Box[] = [];
  const hit = (q: DOMRect) => q.width > 1 && q.height > 1 && q.right > zone.l && q.left < zone.r && q.bottom > zone.t && q.top < zone.b;
  const far = (q: DOMRect) =>
    q.width > 0 && q.height > 0 && (q.right < zone.l - PRUNE || q.left > zone.r + PRUNE || q.bottom < zone.t - PRUNE || q.top > zone.b + PRUNE);
  // Un seul parcours, élagué : ce qui est loin de la zone (une couverture à l'autre bout de la
  // bibliothèque) est écarté d'un coup avec tout son contenu, au lieu de mesurer chacun de ses textes.
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = n as Element;
      if (el.classList.contains('mascot-layer') || far(el.getBoundingClientRect())) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Node | null;
  const rg = document.createRange();
  while ((n = tw.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) {
      if (!n.textContent?.trim()) continue;
      const pe = n.parentElement;
      if (!pe || !hit(pe.getBoundingClientRect())) continue;
      rg.selectNodeContents(n);
      for (const q of rg.getClientRects()) if (hit(q)) out.push({ l: q.left - 3, t: q.top - 3, r: q.right + 3, b: q.bottom + 3, w: 1 });
      continue;
    }
    const el = n as Element;
    // Contrôles (le dessin d'une icône compte en entier, pas ses morceaux).
    if (!el.matches(CONTROL) || (el instanceof SVGElement && !(el instanceof SVGSVGElement))) continue;
    const q = el.getBoundingClientRect();
    if (!hit(q)) continue;
    const big = q.width * q.height > 30000;
    out.push({ l: q.left - 3, t: q.top - 3, r: q.right + 3, b: q.bottom + 3, w: big ? 0.02 : 1 });
  }
  return out;
}

// Les obstacles sont relevés pour une zone élargie et gardés 700 ms (ou jusqu'au prochain défilement) :
// pendant qu'il marche, la bulle se replace sans reparcourir la page à chaque image.
let obsCache: { zone: Box; obs: Box[]; at: number } | null = null;
export const forgetObstacles = () => {
  obsCache = null;
};
function nearObstacles(zone: Box): Box[] {
  const now = performance.now();
  const c = obsCache;
  if (c && now - c.at < 700 && c.zone.l <= zone.l && c.zone.t <= zone.t && c.zone.r >= zone.r && c.zone.b >= zone.b) return c.obs;
  const big = { l: zone.l - 160, t: zone.t - 80, r: zone.r + 160, b: zone.b + 80, w: 0 };
  obsCache = { zone: big, obs: obstacles(big), at: now };
  return obsCache.obs;
}

/** Surface recouverte (pondérée) par un rectangle de bulle. */
function cover(obs: Box[], l: number, t: number, w: number, h: number) {
  if (l < 6 || t < 52 || l + w > innerWidth - 6 || t + h > innerHeight - 6) return 1e9;
  let a = 0;
  for (const o of obs) {
    const x = Math.min(l + w, o.r) - Math.max(l, o.l);
    const y = Math.min(t + h, o.b) - Math.max(t, o.t);
    if (x > 0 && y > 0) a += x * y * o.w;
  }
  return a;
}

/** Surface recouverte (pondérée), sans contrainte d'écran. */
function overlap(obs: Box[], l: number, t: number, w: number, h: number) {
  let a = 0;
  for (const o of obs) {
    const x = Math.min(l + w, o.r) - Math.max(l, o.l);
    const y = Math.min(t + h, o.b) - Math.max(t, o.t);
    if (x > 0 && y > 0) a += x * y * o.w;
  }
  return a;
}

/** Où se mettre le long du bord d'un encadré pour que sa silhouette (debout, la plus haute) ne cache
 *  rien au-dessus : on essaie les positions tous les 10 px et on garde la plus libre, la plus proche
 *  de `prefer`. Renvoie l'abscisse (depuis le bord gauche de l'encadré) et ce qui reste caché. */
function bestX(perch: HTMLElement, k: number, prefer: number): { x: number; covered: number } {
  const r = perch.getBoundingClientRect();
  const w = VB_W * k;
  const h = 124 * k;
  const max = Math.max(6, r.width - w - 6);
  // seuls le texte et les petits contrôles comptent : couvrir le fond vide d'une carte ne cache rien
  // (l'encadré lui-même et son contenu ne comptent pas : ils sont sous ses pieds)
  const inside = (o: Box) => o.l >= r.left - 4 && o.r <= r.right + 4 && o.t >= r.top - 4 && o.b <= r.bottom + 4;
  const obs = nearObstacles({ l: r.left, t: r.top - h, r: r.right, b: r.top, w: 0 }).filter((o) => o.w === 1 && !inside(o) && o.b > r.top - h && o.t < r.top - 1);
  let best = { x: Math.max(6, Math.min(prefer, max)), covered: Infinity, cost: Infinity };
  const step = Math.max(10, (max - 6) / 60);
  for (let x = 6; x <= max + 0.1; x += step) {
    // silhouette : le cerveau (large) en haut, le corps plus étroit en bas
    const a =
      overlap(obs, r.left + x + w * 0.1, r.top - h + 3 * k, w * 0.8, 66 * k) + overlap(obs, r.left + x + w * 0.25, r.top - h + 66 * k, w * 0.5, h - 66 * k - 2);
    const cost = a * 20 + Math.abs(x - prefer) * 0.5;
    if (cost < best.cost) best = { x, covered: a, cost };
  }
  return { x: best.x, covered: best.covered };
}

type Spot = { l: number; t: number; side: Side; tail: number };
const BUBBLE_WIDTHS = [260, 340, 210];

/** L'emplacement le plus proche du personnage qui cache le moins de choses : au-dessus (à plusieurs
 *  hauteurs, en glissant de gauche à droite), puis à sa droite et à sa gauche. */
function placeBubble(left: number, top: number, headTop: number, bw: number, bh: number): Spot & { covered: number; cost: number } {
  const cx = left + W / 2;
  const obs = nearObstacles({ l: left - bw - 40, t: headTop - bh - 200, r: left + W + bw + 40, b: top + H + 40, w: 0 });
  const cands: (Spot & { dist: number })[] = [];
  for (const lift of [8, 30, 56, 86, 120, 160]) {
    const t = headTop - bh - lift;
    for (let tail = 26; tail <= bw - 14; tail += 16) cands.push({ l: cx - tail, t, side: 'top', tail, dist: lift + Math.abs(tail - 30) * 0.35 });
  }
  for (let dy = -bh + 16; dy <= 44; dy += 6) {
    const t = headTop + dy;
    const tail = Math.max(14, Math.min(bh - 14, headTop + 16 - t));
    for (const dx of [4, 22, 44]) {
      cands.push({ l: left + W + dx, t, side: 'left', tail, dist: 24 + dx * 0.6 + Math.abs(dy) * 0.5 });
      cands.push({ l: left - bw - dx, t, side: 'right', tail, dist: 28 + dx * 0.6 + Math.abs(dy) * 0.5 });
    }
  }
  let best: (Spot & { covered: number; cost: number }) | null = null;
  let bestCost = Infinity;
  for (const c of cands) {
    const a = cover(obs, c.l, c.t, bw, bh);
    const cost = a * 20 + c.dist * 3;
    if (cost < bestCost) {
      bestCost = cost;
      best = { l: c.l, t: c.t, side: c.side, tail: c.tail, covered: a, cost };
    }
  }
  return best!;
}

/** Ce que recouvre un emplacement déjà choisi (pour savoir s'il faut en changer). */
function coverAt(left: number, top: number, bw: number, bh: number, l: number, t: number) {
  const headTop = top + 4 * SCALE;
  return cover(nearObstacles({ l: left - bw - 40, t: headTop - bh - 200, r: left + W + bw + 40, b: top + H + 40, w: 0 }), l, t, bw, bh);
}

// Dernières valeurs écrites dans les styles : on n'écrit que ce qui change (une écriture identique peut
// quand même invalider le style).
const written = new WeakMap<HTMLElement, Record<string, string>>();
function put(el: HTMLElement, k: string, v: string) {
  let m = written.get(el);
  if (!m) written.set(el, (m = {}));
  if (m[k] === v) return;
  m[k] = v;
  if (k.startsWith('--')) el.style.setProperty(k, v);
  else (el.style as any)[k] = v;
}

export function Mascot({ route, workspaceId }: { route: string; workspaceId?: string }) {
  const freq: MascotFreq = useStore((s) => s.settings.mascot ?? MASCOT_DEFAULT);
  const docs = useStore((s) => s.books.length + s.drafts.length);
  const stay = useStore((s) => s.settings.mascotStay ?? 2);
  const stayRef = useRef(stay);
  stayRef.current = stay;
  const silent = useStore((s) => !!s.settings.mascotSilent);
  const charId = useStore((s) => s.settings.mascotCharacter ?? 'brain');
  const charRef = useRef(charId);
  charRef.current = charId;
  const silentRef = useRef(silent);
  silentRef.current = silent;
  const level = levelFor(docs);
  const [, setTick] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const bub = useRef<HTMLDivElement>(null);
  const prevLevel = useRef(level);
  const wakeRef = useRef<() => void>(() => {});
  const st = useRef<State>({
    visible: false,
    perch: null,
    x: 0,
    target: 0,
    pose: 'stand',
    view: 'front',
    frame: 0,
    frameAcc: 0,
    facing: 1,
    act: null,
    left: 0,
    queue: [],
    next: 0,
    bubble: null,
    bubbleUntil: 0,
    pendingFlex: false,
    anchor: 124,
    squash: null,
    blinkUntil: 0,
    nextBlink: 0,
    bubblePos: null,
    bubbleForced: false,
    bubbleId: 0,
    calm: false,
    wavedMid: false,
    flight: null,
    speed: 1,
  });
  const live = freq !== 'off' && ROUTES.has(route);
  const page = pageOf(route);

  const vanish = (s: State, gap: number) => {
    s.visible = false;
    s.perch = null;
    s.act = null;
    s.queue = [];
    s.bubble = null;
    s.bubblePos = null;
    s.flight = null;
    s.next = Date.now() + gap;
  };

  // Nouvelle vue ou nouveau réglage : il disparaît et repassera plus tard.
  useEffect(() => {
    if (freq === 'off') return vanish(st.current, 0);
    vanish(st.current, between(FIRST[freq]));
    setTick((t) => t + 1);
    wakeRef.current();
  }, [route, freq]);

  // Parole coupée dans les réglages : la bulle en cours disparaît.
  useEffect(() => {
    if (!silent) return;
    st.current.bubble = null;
    st.current.bubblePos = null;
    setTick((t) => t + 1);
  }, [silent]);

  // Il gagne un niveau : il vient le montrer.
  useEffect(() => {
    const s = st.current;
    if (level > prevLevel.current) {
      if (s.visible) {
        s.queue.unshift({ pose: 'flex', ms: 2600, say: 'flex' });
        s.act = null;
      } else {
        s.pendingFlex = true;
        s.next = Math.min(s.next, Date.now() + 4000);
      }
      wakeRef.current();
    }
    prevLevel.current = level;
  }, [level]);

  // Boucle d'animation : logique, rythme des poses, position, bulle.
  useEffect(() => {
    if (!live) return;
    const still = reduced();
    let raf = 0;
    let last = performance.now();
    let lastCheck = 0;
    const redraw = () => setTick((t) => t + 1);

    const start = (s: State, a: Act | undefined) => {
      if (!a) return vanish(s, between(GAP[freq as Exclude<MascotFreq, 'off'>]));
      // Saut : on choisit l'encadré d'arrivée ; s'il n'y en a pas (ou qu'il y est déjà), on passe.
      if (a.hop) {
        const spot = s.perch ? hopTarget(page, s.perch, a.hop) : null;
        if (!spot || !s.perch) return start(s, s.queue.shift());
        const to = spot.el;
        const tr = to.getBoundingClientRect();
        const fr = s.perch.getBoundingClientRect();
        const tx = spot.x;
        const dx = tr.left + tx - (fr.left + s.x);
        const dy = tr.top - fr.top;
        const dist = Math.hypot(dx, dy);
        const now0 = performance.now();
        if (still) {
          s.perch = to;
          s.x = tx;
          return start(s, s.queue.shift());
        }
        s.flight = { from: s.perch, fx: s.x, to, tx, t0: now0 + 160, dur: Math.min(950, 380 + dist * 0.45) / s.speed };
        s.squash = { t0: now0, dur: 180, k: 0.14 };
        s.bubble = null;
        s.bubblePos = null;
        a = { ...a, view: Math.abs(dx) > 40 ? 'side' : 'front', facing: dx >= 0 ? 1 : -1 };
      }
      if (a.walkTo != null && s.perch) {
        const max = Math.max(0, s.perch.getBoundingClientRect().width - W - 12);
        s.target = bestX(s.perch, SCALE, 6 + a.walkTo * max).x;
        const dir: 1 | -1 = s.target >= s.x ? 1 : -1;
        if (still) s.x = s.target;
        // Avant de marcher : il se tourne d'abord vers où il va.
        if (!a.turned && !still && (s.view !== 'side' || s.facing !== dir)) {
          s.queue.unshift({ ...a, turned: true });
          a = { pose: 'stand', ms: 260, view: 'side', facing: dir };
        } else s.facing = dir;
      }
      // Encadré mince (ligne de liste) : assis de face, ses jambes cacheraient la ligne ; il s'assoit de
      // profil, jambes allongées sur le bord.
      if (isSeated(a.pose) && s.perch && s.perch.getBoundingClientRect().height < 70 && a.pose !== 'sitwave' && (a.view ?? 'front') !== 'side')
        a = { ...a, view: 'side', facing: a.facing ?? (Math.random() < 0.5 ? 1 : -1) };
      if (a.pose === 'sitwave' && s.perch && s.perch.getBoundingClientRect().height < 70) a = { ...a, pose: 'wave' };
      const wasSeated = isSeated(s.pose);
      s.act = a;
      s.pose = a.pose;
      s.view = a.view ?? (a.pose === 'walk' ? 'side' : 'front');
      if (a.facing) s.facing = a.facing;
      s.frame = 0;
      s.frameAcc = 0;
      s.left = a.ms;
      const now = performance.now();
      if (!still && isSeated(a.pose) && !wasSeated) s.squash = { t0: now, dur: 260, k: 0.1 };
      if (!still && a.pose === 'stand' && s.anchor < 100) s.squash = { t0: now, dur: 220, k: -0.06 };
      // Réglage « sans bulles » : il fait ses gestes, mais ne dit rien.
      if (a.say && !silentRef.current) {
        s.bubble = bubbleFor(a.say, ctxFor(page, s.perch, level, workspaceId), charRef.current === 'brain' ? undefined : CHARACTERS[charRef.current].name);
        s.bubbleId++;
        s.bubbleForced = a.say === 'poke';
        s.bubbleUntil = Date.now() + Math.min(13000, 4000 + (s.bubble.text.length + (s.bubble.lead?.length ?? 0)) * 45);
        s.bubblePos = null;
      }
    };

    const logic = (s: State, dt: number, now: number) => {
      let changed = false;
      if (s.bubble && Date.now() > s.bubbleUntil) {
        s.bubble = null;
        s.bubblePos = null;
        changed = true;
      }
      if (!s.visible) {
        if (now - lastCheck < 400) return changed;
        lastCheck = now;
        if (document.hidden || Date.now() < s.next) return changed;
        const found = findPerch(page);
        const el = found?.el;
        if (!el) {
          s.next = Date.now() + 8000;
          return changed;
        }
        s.perch = el;
        applyScale(scaleFor(el.getBoundingClientRect().width));
        s.x = found!.x;
        s.facing = Math.random() < 0.5 ? 1 : -1;
        s.wavedMid = false;
        s.queue = buildVisit(page, level, s.pendingFlex, STAY[stayRef.current] ?? 1);
        s.pendingFlex = false;
        s.visible = true;
        s.pose = 'puff';
        s.anchor = 124;
        start(s, s.queue.shift());
        s.squash = still ? null : { t0: now + 300, dur: 300, k: 0.12 };
        return true;
      }
      if (now - lastCheck > 250) {
        lastCheck = now;
        if (!s.perch || !s.perch.isConnected || !edgeOk(s.perch, false)) {
          vanish(s, 20e3 + Math.random() * 20e3);
          return true;
        }
      }
      if (!s.act) {
        start(s, s.queue.shift());
        return true;
      }
      // Rythme propre à la pose.
      if (!still) {
        s.frameAcc += dt;
        const step = 1000 / fps(s.pose);
        while (s.frameAcc >= step) {
          s.frameAcc -= step;
          s.frame++;
          changed = true;
        }
      }
      // Clignements (aucun en mouvement réduit : pas de rendu pour rien).
      if (!still && now > s.nextBlink) {
        s.blinkUntil = now + 140;
        s.nextBlink = now + 2500 + Math.random() * 4000;
        changed = true;
      } else if (!still && s.blinkUntil && now > s.blinkUntil) {
        s.blinkUntil = 0;
        changed = true;
      }
      // De temps en temps, il fait coucou depuis son perchoir, puis reprend ce qu'il faisait.
      if (!still && !s.calm && !s.wavedMid && isSeated(s.act.pose) && s.act.pose !== 'sitwave' && s.left > 2500 && Math.random() < (dt / 1000) * 0.004) {
        s.wavedMid = true;
        s.queue.unshift({ ...s.act, ms: s.left });
        start(s, { pose: 'sitwave', ms: 1200 + Math.random() * 600, view: 'front', say: Math.random() < 0.25 ? 'hello' : undefined });
        return true;
      }
      let done = false;
      if (s.flight) {
        if (now >= s.flight.t0 + s.flight.dur) {
          s.perch = s.flight.to;
          const tw = s.perch.getBoundingClientRect().width;
          applyScale(scaleFor(tw));
          s.x = Math.max(6, Math.min(s.flight.tx, tw - W - 6));
          s.flight = null;
          s.squash = { t0: now, dur: 280, k: 0.13 };
          done = true;
        }
      } else if (s.act.walkTo != null) {
        const dx = s.target - s.x;
        const stepPx = (SPEED * dt) / 1000;
        if (Math.abs(dx) <= stepPx) {
          s.x = s.target;
          done = true;
        } else s.x += Math.sign(dx) * stepPx;
      } else {
        s.left -= dt;
        done = s.left <= 0;
      }
      if (done) {
        if (s.act.leave) vanish(s, between(GAP[freq as Exclude<MascotFreq, 'off'>]));
        else start(s, s.queue.shift());
        changed = true;
      }
      return changed;
    };

    // Hauteurs de la bulle : mesurées une fois par forme et par phrase.
    let heights: { bubble: Bubble; el: HTMLElement; h: Map<number, number> } | null = null;
    const lastPerch = { el: null as HTMLElement | null, top: 0, left: 0 };
    let burstUntil = 0;
    const bubbleHeight = (b: HTMLElement, bubble: Bubble, w: number) => {
      if (!heights || heights.bubble !== bubble || heights.el !== b) heights = { bubble, el: b, h: new Map() };
      let h = heights.h.get(w);
      if (h == null) {
        put(b, 'width', `${w}px`);
        h = b.offsetHeight;
        heights.h.set(w, h);
      }
      return h;
    };

    const place = (s: State, dt: number, now: number) => {
      const w = wrap.current;
      if (!w || !s.visible || !s.perch) return;
      const r = s.perch.getBoundingClientRect();
      // L'encadré bouge (cartes qui arrivent en glissant, mise en page qui change) : on le suit image
      // par image le temps qu'il se stabilise, au lieu d'attendre le prochain réveil.
      if (lastPerch.el === s.perch && (Math.abs(r.top - lastPerch.top) > 0.5 || Math.abs(r.left - lastPerch.left) > 0.5)) burstUntil = Math.max(burstUntil, now + 300);
      lastPerch.el = s.perch;
      lastPerch.top = r.top;
      lastPerch.left = r.left;
      const target = anchorOf(s.pose, s.view);
      s.anchor = still ? target : s.anchor + (target - s.anchor) * Math.min(1, dt / 70);
      if (Math.abs(target - s.anchor) < 0.3) s.anchor = target;
      let left = r.left + s.x;
      let top = r.top - s.anchor * SCALE;
      let hidden = r.top < 70 || r.top > innerHeight;
      // En plein saut : une parabole entre les deux bords (ils peuvent bouger si la page défile).
      const f = s.flight;
      if (f) {
        const a = f.from.getBoundingClientRect();
        const b = f.to.getBoundingClientRect();
        const t = Math.max(0, Math.min(1, (now - f.t0) / f.dur));
        const x0 = a.left + f.fx;
        const y0 = a.top;
        const x1 = b.left + f.tx;
        const y1 = b.top;
        const apex = 34 + Math.hypot(x1 - x0, y1 - y0) * 0.18 + Math.max(0, y0 - y1) * 0.3;
        left = x0 + (x1 - x0) * t;
        top = y0 + (y1 - y0) * t - apex * 4 * t * (1 - t) - 124 * SCALE;
        s.anchor = 124;
        hidden = Math.min(a.top, b.top) < 70 && t < 0.02;
      }
      put(w, 'transform', `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`);
      put(w, 'visibility', hidden ? 'hidden' : 'visible');
      // Tassement : écrasé puis rebond, depuis la ligne d'appui.
      const bd = body.current;
      if (bd) {
        let sx = 1;
        let sy = 1;
        if (s.squash) {
          const t = (now - s.squash.t0) / s.squash.dur;
          if (t >= 1) s.squash = null;
          else if (t > 0) {
            const e = Math.sin(Math.PI * t) * s.squash.k;
            sy = 1 - e;
            sx = 1 + e * 0.6;
          }
        }
        put(bd, 'transformOrigin', `50% ${((target / VB_H) * 100).toFixed(1)}%`);
        put(bd, 'transform', sx === 1 && sy === 1 ? '' : `scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`);
      }
      const b = bub.current;
      if (!b) return;
      if (!s.bubble) {
        // Phrase finie : la bulle reste dans le DOM jusqu'au prochain rendu de React ; on la cache tout de suite.
        put(b, 'visibility', 'hidden');
        return;
      }
      // React n'a pas encore dessiné la nouvelle phrase : la bulle montre encore l'ancienne (ou rien) ;
      // on ne la mesure ni ne l'affiche avant (la boucle reste active tant que la bulle n'est pas placée).
      if (b.dataset.id !== String(s.bubbleId)) {
        put(b, 'visibility', 'hidden');
        return;
      }
      // La bulle se place par rapport à sa position de repos (assis ou debout), pas à la hauteur de
      // passage pendant qu'il s'assoit ou se relève : sinon, placée trop haut, elle descend avec lui
      // sur ce qu'elle devait éviter.
      const rest = f ? top : r.top - target * SCALE;
      const headTop = rest + 4 * SCALE;
      const key = `${Math.round(left / 6)},${Math.round(rest / 6)},${s.bubble?.text.length ?? 0}`;
      let p = s.bubblePos;
      // La bulle suit le personnage ; on revérifie ce qu'elle cache quand il bouge ou que la page défile
      // (au plus tous les 100 ms ; toutes les 500 ms tant qu'elle attend une place libre).
      if (p) {
        p.l += left - p.ml;
        p.t += rest - p.mt;
        p.ml = left;
        p.mt = rest;
      }
      // Il a bougé : revérification au plus tous les 100 ms, ou tout de suite si, en le suivant, la bulle
      // se met à cacher quelque chose (calcul rapide sur les obstacles déjà relevés).
      const moved = !!p && p.key !== key;
      if (!p || (moved && (now - p.at > 100 || (!p.wait && coverAt(left, rest, p.w, p.h, p.l, p.t) > 0))) || now - p.at > (p.wait ? 500 : 800)) {
        // Trois formes possibles (normale, large et basse, étroite et haute) : on garde la meilleure.
        let best: (ReturnType<typeof placeBubble> & { w: number; h: number }) | null = null;
        for (const w of BUBBLE_WIDTHS) {
          const h = bubbleHeight(b, s.bubble, w);
          const c = placeBubble(left, rest, headTop, w, h);
          if (!best || c.cost < best.cost) best = { ...c, w, h };
          if (c.covered === 0 && w === BUBBLE_WIDTHS[0]) break;
        }
        const keepCover = p && !p.wait ? coverAt(left, rest, p.w, p.h, p.l, p.t) : Infinity;
        if (!p || keepCover > best!.covered) {
          // Rien de libre : une citation dite de lui-même attend une meilleure place (il bouge, la page
          // défile) ; une réponse à un clic s'affiche quand même, au moins mauvais endroit.
          const wait = best!.covered > 0 && !s.bubbleForced;
          p = s.bubblePos = { l: best!.l, t: best!.t, side: best!.side, tail: best!.tail, w: best!.w, h: best!.h, key, at: now, ml: left, mt: rest, wait };
        } else {
          p.key = key;
          p.at = now;
          // L'emplacement gardé cache désormais quelque chose (il a bougé) : même règle d'attente.
          p.wait = keepCover > 0 && !s.bubbleForced;
        }
        put(b, 'width', `${p.w}px`);
      }
      const q = s.bubblePos!;
      if (b.dataset.side !== q.side) b.dataset.side = q.side;
      put(b, 'transform', `translate(${q.l.toFixed(1)}px, ${q.t.toFixed(1)}px)`);
      put(b, '--tail', `${Math.round(Math.max(14, Math.min((q.side === 'top' ? q.w : q.h) - 14, q.tail)))}px`);
      put(b, 'visibility', hidden || q.wait ? 'hidden' : 'visible');
    };

    // Ordonnancement économe : rien quand la fenêtre est cachée ; une vérification par seconde entre
    // deux visites ; au repos (assis, lecture, sieste), un réveil au rythme de la pose (au plus toutes
    // les 250 ms) et à chaque défilement ; 60 images par seconde seulement quand il bouge (marche, saut,
    // atterrissage, changement de hauteur).
    let timer = 0;
    const busy = (s: State, now: number) =>
      !!s.flight || s.act?.walkTo != null || !!s.squash || Math.abs(s.anchor - anchorOf(s.pose, s.view)) > 0.3 || now < burstUntil || (!!s.bubble && !s.bubblePos);
    const step = (now: number) => {
      const s = st.current;
      const dt = Math.min(1000, now - last) * s.speed;
      last = now;
      if (logic(s, dt, now)) redraw();
      place(s, dt, now);
    };
    const schedule = (now: number) => {
      const s = st.current;
      clearTimeout(timer);
      if (document.hidden) return; // reprise sur visibilitychange
      if (!s.visible) {
        timer = window.setTimeout(() => frame(performance.now()), 1000);
        return;
      }
      if (busy(s, now)) {
        raf = requestAnimationFrame(frame);
        return;
      }
      const toFrame = 1000 / fps(s.pose) / s.speed - s.frameAcc / s.speed;
      const wait = Math.max(16, Math.min(250, toFrame, s.blinkUntil ? s.blinkUntil - now : 250));
      timer = window.setTimeout(() => frame(performance.now()), wait);
    };
    const frame = (now: number) => {
      raf = 0;
      step(now);
      schedule(now);
    };
    const kick = (e?: Event) => {
      burstUntil = performance.now() + 350;
      forgetObstacles();
      const s0 = st.current;
      if (e?.type === 'resize' && s0.visible && s0.perch && !s0.flight) {
        const pw = s0.perch.getBoundingClientRect().width;
        const k = scaleFor(pw);
        if (k !== SCALE) {
          applyScale(k);
          s0.x = Math.max(6, Math.min(s0.x, pw - W - 6));
          s0.bubblePos = null;
          redraw();
        }
      }
      if (!raf && st.current.visible && !document.hidden) {
        clearTimeout(timer);
        raf = requestAnimationFrame(frame);
      }
    };
    const onVisibility = () => {
      // Une image demandée avant de passer en arrière-plan reste en attente : on l'annule, sinon deux
      // boucles tourneraient en parallèle (et l'une survivrait au démontage).
      cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(timer);
      if (!document.hidden) {
        last = performance.now();
        frame(last);
      }
    };
    window.addEventListener('scroll', kick, { capture: true, passive: true });
    window.addEventListener('resize', kick, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    // Les tests et le clic peuvent changer la file d'actions : on se réveille tout de suite.
    wakeRef.current = () => {
      if (!raf && !document.hidden) {
        clearTimeout(timer);
        raf = requestAnimationFrame(frame);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener('scroll', kick, { capture: true });
      window.removeEventListener('resize', kick);
      document.removeEventListener('visibilitychange', onVisibility);
      wakeRef.current = () => {};
    };
  }, [live, freq, level]);

  // Accès de test.
  useEffect(() => {
    if (!(import.meta.env.DEV || new URLSearchParams(location.search).has('e2e'))) return;
    (window as any).__mascot = {
      state: () => {
        const s = st.current;
        const anchorUnits = anchorOf(s.pose, s.view);
        return { ...s, perch: s.perch?.className ?? null, flight: !!s.flight, level, anchorUnits, vbH: VB_H, scale: SCALE, settled: !s.flight && s.pose !== 'puff' && Math.abs(s.anchor - anchorUnits) < 0.5 };
      },
      speed: (k = 1) => {
        st.current.speed = k;
      },
      perchEl: () => st.current.perch,
      calm: (on = true) => {
        st.current.calm = on;
      },
      bubbleInfo: () => {
        const b = document.querySelector<HTMLElement>('.mascot-bubble');
        const m = document.querySelector<HTMLElement>('.mascot');
        if (!b || !m) return null;
        const r = b.getBoundingClientRect();
        const mr = m.getBoundingClientRect();
        const obs = obstacles({ l: r.left - 50, t: r.top - 50, r: r.right + 50, b: r.bottom + 50, w: 0 }).filter((o) => o.r > r.left && o.l < r.right && o.b > r.top && o.t < r.bottom);
        return { rect: [r.left, r.top, r.width, r.height], pos: st.current.bubblePos, mascotTop: mr.top, anchor: st.current.anchor, cover: cover(obs, r.left, r.top, r.width, r.height), obs };
      },
      hush: () => {
        st.current.bubble = null;
        st.current.bubblePos = null;
        const b = document.querySelector<HTMLElement>('.mascot-bubble');
        if (b) put(b, 'visibility', 'hidden');
        wakeRef.current();
      },
      appear: () => {
        st.current.next = 0;
        if (st.current.visible) vanish(st.current, 0);
        wakeRef.current();
      },
      /** Pose une action en tête de file (durée en ms) ; marche : vers walkTo (0..1) ou au hasard. */
      act: (pose: Pose, ms = 10000, say?: Say, view?: View, facing?: 1 | -1, walkTo?: number) => {
        const s = st.current;
        s.queue.unshift({ pose, ms, say, view, facing, walkTo: pose === 'walk' && view !== 'back' ? (walkTo ?? Math.random()) : undefined });
        s.act = null;
        wakeRef.current();
      },
      /** Joue une scène de la page (index), puis reprend la visite. */
      scene: (index: number) => {
        const s = st.current;
        s.queue.unshift(...sceneActs(pageOf(route), index, level));
        s.act = null;
        wakeRef.current();
      },
      page: () => pageOf(route),
      /** Durée moyenne d'une visite (ms, sans compter la marche) pour un cran du réglage. */
      visitMs: (idx: number, n = 200) => {
        let t = 0;
        for (let i = 0; i < n; i++) t += buildVisit(pageOf(route), level, false, STAY[idx]).reduce((a, x) => a + x.ms, 0);
        return t / n;
      },
      spotInfo: (el: HTMLElement) => {
        const rw = el.getBoundingClientRect().width;
        const k = scaleFor(rw);
        const r = el.getBoundingClientRect();
        const h = 124 * k;
        // (l'encadré lui-même et son contenu ne comptent pas : ils sont sous ses pieds)
  const inside = (o: Box) => o.l >= r.left - 4 && o.r <= r.right + 4 && o.t >= r.top - 4 && o.b <= r.bottom + 4;
  const obs = nearObstacles({ l: r.left, t: r.top - h, r: r.right, b: r.top, w: 0 }).filter((o) => o.w === 1 && !inside(o) && o.b > r.top - h && o.t < r.top - 1);
        return { k, spot: bestX(el, k, 6), obs, edge: edgeOk(el, true) };
      },
      freePerches: () => perches(pageOf(route)).filter((el) => freeSpot(el)).length,
      sceneCount: () => sceneCount(pageOf(route)),
      /** Place le personnage sur un encadré donné, à une abscisse donnée (px depuis le bord gauche). */
      perchOn: (el: HTMLElement, x: number) => {
        const s = st.current;
        s.perch = el;
        s.x = x;
        s.bubblePos = null;
        wakeRef.current();
      },
    };
  }, [level, route]);

  const s = st.current;
  if (!live || !s.visible) return null;
  const halo = document.documentElement.dataset.theme === 'dark' ? '#e9dfcc' : undefined;
  const poke = () => {
    if (s.act?.pose === 'puff') return;
    s.queue.unshift({ pose: isSeated(s.pose) ? 'sitwave' : 'wave', ms: 1500, say: 'poke', view: 'front' });
    if (s.act?.walkTo == null) s.act = null;
    wakeRef.current();
  };
  const still = reduced();
  return (
    <div className="mascot-layer" aria-hidden="true">
      <div ref={wrap} className="mascot" data-character={charId} style={{ width: W, height: H }} onClick={poke}>
        <div ref={body} className="mascot-body">
          <Sprite pose={s.pose} frame={still ? 0 : s.frame} level={level} view={s.view} facing={s.facing} halo={halo} blink={!still && s.blinkUntil > 0} character={CHARACTERS[charId]} />
        </div>
      </div>
      {s.bubble && (
        <div ref={bub} className="mascot-bubble" data-id={s.bubbleId}>
          {s.bubble.lead && <p className="mascot-lead">{s.bubble.lead}</p>}
          <p>{s.bubble.author ? `« ${s.bubble.text} »` : s.bubble.text}</p>
          {s.bubble.author && (
            <span className="mascot-cite">
              {s.bubble.author}
              {s.bubble.source && <i>, {s.bubble.source}</i>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
