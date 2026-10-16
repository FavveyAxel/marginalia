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
import { MUTTER, QUOTES, pick } from './quotes';
import './mascot.css';

export type MascotFreq = 'off' | 'rare' | 'sometimes' | 'often';
export const MASCOT_DEFAULT: MascotFreq = 'sometimes';

const SCALE = 0.7;
const W = VB_W * SCALE;
const H = VB_H * SCALE;
/** Vitesse de marche (px/s). */
const SPEED = 42;
/** Rythme des poses (images par seconde). */
const FPS: Record<Pose, number> = { walk: 8, wave: 8, sitwave: 8, flex: 6, puff: 10, stand: 2, sit: 4, read: 4, think: 3, doze: 2 };
const PERCHES = '.home-card, .lib-card-cover, .ws-card, .set-list';
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

type Bubble = { text: string; author?: string; source?: string };
type Say = 'quote' | 'hello' | 'flex' | 'poke';
type Act = { pose: Pose; ms: number; walkTo?: number; say?: Say; leave?: boolean; view?: View; facing?: 1 | -1; turned?: boolean };
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
  /** Tests : pas de gestes spontanés (coucou). */
  calm: boolean;
}

function edgeOk(el: HTMLElement, strict: boolean) {
  const r = el.getBoundingClientRect();
  if (r.width < W + 12 || r.height < 24) return false;
  if (r.top < 90 || r.top > innerHeight - 40 || r.left < 0 || r.right > innerWidth) return false;
  if (!strict) return true;
  // Pas sous une fenêtre ou un menu : le haut de l'encadré doit être visible à l'écran.
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 4);
  return !!hit && el.contains(hit);
}

function findPerch(avoid: HTMLElement | null) {
  const all = [...document.querySelectorAll<HTMLElement>(PERCHES)].filter((el) => el !== avoid && edgeOk(el, true));
  return all.length ? all[randInt(all.length)] : null;
}

/** Vue d'une pose assise : de face le plus souvent, parfois de profil, ou de dos (il regarde le contenu). */
function seatView(pose: Pose): Pick<Act, 'view' | 'facing'> {
  const r = Math.random();
  const facing = Math.random() < 0.5 ? 1 : -1;
  if (pose === 'sit' || pose === 'doze') return r < 0.45 ? { view: 'front' } : r < 0.8 ? { view: 'side', facing } : { view: 'back' };
  return r < 0.6 ? { view: 'front' } : { view: 'side', facing };
}

function plan(level: Level, flex: boolean): Act[] {
  const q: Act[] = [{ pose: 'puff', ms: 300 }, { pose: 'stand', ms: 500, view: 'front' }];
  if (flex) q.push({ pose: 'flex', ms: 2600, say: 'flex' });
  else if (Math.random() < 0.5) q.push({ pose: 'wave', ms: 1400, say: Math.random() < 0.35 ? 'hello' : undefined });
  const n = 2 + randInt(3);
  let quoted = false;
  const seat = (a: Act) => q.push({ ...a, ...seatView(a.pose) });
  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.65) q.push({ pose: 'walk', ms: 0, walkTo: Math.random() }, { pose: 'stand', ms: 400, view: 'front' });
    const r = Math.random();
    if (r < 0.22) seat({ pose: 'sit', ms: sec(6, 14) });
    else if (r < 0.47) seat({ pose: 'read', ms: sec(12, 28) });
    else if (r < 0.67) {
      q.push({ pose: 'think', ms: 4000, say: 'quote', view: 'front' }, { pose: 'sit', ms: 4500, view: 'front' });
      quoted = true;
    } else if (r < 0.8) seat({ pose: 'doze', ms: sec(8, 18) });
    else if (r < 0.92 || level < 2) {
      q.push({ pose: 'stand', ms: 5500, say: 'quote', view: 'front' });
      quoted = true;
    } else q.push({ pose: 'flex', ms: 1800 });
  }
  if (!quoted && Math.random() < 0.7) q.push({ pose: 'think', ms: 4000, say: 'quote', view: 'front' }, { pose: 'sit', ms: 4500, view: 'front' });
  // Il s'en va : demi-tour, quelques pas de dos, puis un petit nuage.
  q.push({ pose: 'stand', ms: 300, view: 'back' }, { pose: 'walk', ms: 700, view: 'back' }, { pose: 'puff', ms: 300, leave: true });
  return q;
}

function bubbleFor(say: Say): Bubble {
  if (say === 'quote' || say === 'poke') return pick(QUOTES);
  return { text: pick(MUTTER[say]) };
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Bulle : où se mettre sans rien cacher ───────────────────
// On relève les rectangles de ce qu'il ne faut pas cacher autour du personnage (lignes de texte,
// boutons, champs, images ; les grandes cartes comptent moins : couvrir leur fond ne cache rien), puis
// on mesure ce que chaque emplacement possible recouvre.

type Box = { l: number; t: number; r: number; b: number; w: number };
const CONTROL = 'button, a, input, textarea, select, img, svg, canvas, video, [role="button"], [contenteditable="true"]';

function obstacles(zone: Box): Box[] {
  const out: Box[] = [];
  const hit = (q: DOMRect) => q.width > 1 && q.height > 1 && q.right > zone.l && q.left < zone.r && q.bottom > zone.t && q.top < zone.b;
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  const rg = document.createRange();
  while ((n = tw.nextNode())) {
    if (!n.textContent?.trim()) continue;
    const pe = n.parentElement;
    if (!pe || pe.closest('.mascot-layer') || !hit(pe.getBoundingClientRect())) continue;
    rg.selectNodeContents(n);
    for (const q of rg.getClientRects()) if (hit(q)) out.push({ l: q.left - 3, t: q.top - 3, r: q.right + 3, b: q.bottom + 3, w: 1 });
  }
  for (const el of document.querySelectorAll(CONTROL)) {
    if (el.closest('.mascot-layer') || el.closest('svg') !== el && el.closest('svg')) continue;
    const q = el.getBoundingClientRect();
    if (!hit(q)) continue;
    const big = q.width * q.height > 30000;
    out.push({ l: q.left - 3, t: q.top - 3, r: q.right + 3, b: q.bottom + 3, w: big ? 0.02 : 1 });
  }
  return out;
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

type Spot = { l: number; t: number; side: Side; tail: number };
const BUBBLE_WIDTHS = [260, 340, 210];

/** L'emplacement le plus proche du personnage qui cache le moins de choses : au-dessus (à plusieurs
 *  hauteurs, en glissant de gauche à droite), puis à sa droite et à sa gauche. */
function placeBubble(left: number, top: number, headTop: number, bw: number, bh: number): Spot & { covered: number; cost: number } {
  const cx = left + W / 2;
  const obs = obstacles({ l: left - bw - 40, t: headTop - bh - 200, r: left + W + bw + 40, b: top + H + 40, w: 0 });
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
  return cover(obstacles({ l: left - bw - 40, t: headTop - bh - 200, r: left + W + bw + 40, b: top + H + 40, w: 0 }), l, t, bw, bh);
}

export function Mascot({ route }: { route: string }) {
  const freq: MascotFreq = useStore((s) => s.settings.mascot ?? MASCOT_DEFAULT);
  const docs = useStore((s) => s.books.length + s.drafts.length);
  const level = levelFor(docs);
  const [, setTick] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const bub = useRef<HTMLDivElement>(null);
  const prevLevel = useRef(level);
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
    calm: false,
  });
  const live = freq !== 'off' && ROUTES.has(route);

  const vanish = (s: State, gap: number) => {
    s.visible = false;
    s.perch = null;
    s.act = null;
    s.queue = [];
    s.bubble = null;
    s.bubblePos = null;
    s.next = Date.now() + gap;
  };

  // Nouvelle vue ou nouveau réglage : il disparaît et repassera plus tard.
  useEffect(() => {
    if (freq === 'off') return vanish(st.current, 0);
    vanish(st.current, between(FIRST[freq]));
    setTick((t) => t + 1);
  }, [route, freq]);

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
      if (a.walkTo != null && s.perch) {
        const max = Math.max(0, s.perch.getBoundingClientRect().width - W - 12);
        s.target = 6 + a.walkTo * max;
        const dir: 1 | -1 = s.target >= s.x ? 1 : -1;
        if (still) s.x = s.target;
        // Avant de marcher : il se tourne d'abord vers où il va.
        if (!a.turned && !still && (s.view !== 'side' || s.facing !== dir)) {
          s.queue.unshift({ ...a, turned: true });
          a = { pose: 'stand', ms: 260, view: 'side', facing: dir };
        } else s.facing = dir;
      }
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
      if (a.say) {
        s.bubble = bubbleFor(a.say);
        s.bubbleForced = a.say === 'poke';
        s.bubbleUntil = Date.now() + Math.min(12000, 4000 + s.bubble.text.length * 45);
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
        const el = findPerch(null);
        if (!el) {
          s.next = Date.now() + 8000;
          return changed;
        }
        s.perch = el;
        s.x = 6 + Math.random() * Math.max(0, el.getBoundingClientRect().width - W - 12);
        s.facing = Math.random() < 0.5 ? 1 : -1;
        s.queue = plan(level, s.pendingFlex);
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
        const step = 1000 / FPS[s.pose];
        while (s.frameAcc >= step) {
          s.frameAcc -= step;
          s.frame++;
          changed = true;
        }
      }
      // Clignements.
      if (now > s.nextBlink) {
        s.blinkUntil = now + 140;
        s.nextBlink = now + 2500 + Math.random() * 4000;
        changed = true;
      } else if (s.blinkUntil && now > s.blinkUntil) {
        s.blinkUntil = 0;
        changed = true;
      }
      // De temps en temps, il fait coucou depuis son perchoir, puis reprend ce qu'il faisait.
      if (!still && !s.calm && isSeated(s.act.pose) && s.act.pose !== 'sitwave' && s.left > 2500 && Math.random() < (dt / 1000) * 0.09) {
        s.queue.unshift({ ...s.act, ms: s.left });
        start(s, { pose: 'sitwave', ms: 1200 + Math.random() * 600, view: 'front', say: Math.random() < 0.25 ? 'hello' : undefined });
        return true;
      }
      let done = false;
      if (s.act.walkTo != null) {
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

    const place = (s: State, dt: number, now: number) => {
      const w = wrap.current;
      if (!w || !s.visible || !s.perch) return;
      const r = s.perch.getBoundingClientRect();
      const target = anchorOf(s.pose, s.view);
      s.anchor = still ? target : s.anchor + (target - s.anchor) * Math.min(1, dt / 70);
      if (Math.abs(target - s.anchor) < 0.3) s.anchor = target;
      const left = r.left + s.x;
      const top = r.top - s.anchor * SCALE;
      const hidden = r.top < 70 || r.top > innerHeight;
      w.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
      w.style.visibility = hidden ? 'hidden' : 'visible';
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
        bd.style.transformOrigin = `50% ${((target / VB_H) * 100).toFixed(1)}%`;
        bd.style.transform = sx === 1 && sy === 1 ? '' : `scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
      }
      const b = bub.current;
      if (!b) return;
      const headTop = top + 4 * SCALE;
      const key = `${Math.round(left / 6)},${Math.round(top / 6)},${s.bubble?.text.length ?? 0}`;
      let p = s.bubblePos;
      // La bulle suit le personnage ; on revérifie ce qu'elle cache quand il bouge ou que la page défile
      // (au plus tous les 100 ms ; toutes les 500 ms tant qu'elle attend une place libre).
      if (p) {
        p.l += left - p.ml;
        p.t += top - p.mt;
        p.ml = left;
        p.mt = top;
      }
      if (!p || (p.key !== key && now - p.at > 100) || (p.wait && now - p.at > 500)) {
        // Trois formes possibles (normale, large et basse, étroite et haute) : on garde la meilleure.
        let best: (ReturnType<typeof placeBubble> & { w: number; h: number }) | null = null;
        for (const w of BUBBLE_WIDTHS) {
          b.style.width = `${w}px`;
          const h = b.offsetHeight;
          const c = placeBubble(left, top, headTop, w, h);
          if (!best || c.cost < best.cost) best = { ...c, w, h };
          if (c.covered === 0 && w === BUBBLE_WIDTHS[0]) break;
        }
        const keepCover = p && !p.wait ? coverAt(left, top, p.w, p.h, p.l, p.t) : Infinity;
        if (!p || keepCover > best!.covered) {
          // Rien de libre : une citation dite de lui-même attend une meilleure place (il bouge, la page
          // défile) ; une réponse à un clic s'affiche quand même, au moins mauvais endroit.
          const wait = best!.covered > 0 && !s.bubbleForced;
          p = s.bubblePos = { l: best!.l, t: best!.t, side: best!.side, tail: best!.tail, w: best!.w, h: best!.h, key, at: now, ml: left, mt: top, wait };
        } else {
          p.key = key;
          p.at = now;
          // L'emplacement gardé cache désormais quelque chose (il a bougé) : même règle d'attente.
          p.wait = keepCover > 0 && !s.bubbleForced;
        }
        b.style.width = `${p.w}px`;
      }
      const q = s.bubblePos!;
      b.dataset.side = q.side;
      b.style.transform = `translate(${q.l.toFixed(1)}px, ${q.t.toFixed(1)}px)`;
      b.style.setProperty('--tail', `${Math.round(Math.max(14, Math.min((q.side === 'top' ? q.w : q.h) - 14, q.tail)))}px`);
      b.style.visibility = hidden || q.wait ? 'hidden' : 'visible';
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(100, now - last);
      last = now;
      const s = st.current;
      if (logic(s, dt, now)) redraw();
      place(s, dt, now);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live, freq, level]);

  // Accès de test.
  useEffect(() => {
    if (!(import.meta.env.DEV || new URLSearchParams(location.search).has('e2e'))) return;
    (window as any).__mascot = {
      state: () => ({ ...st.current, perch: st.current.perch?.className ?? null, perchEl: undefined, level }),
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
      },
      appear: () => {
        st.current.next = 0;
        if (st.current.visible) vanish(st.current, 0);
      },
      /** Pose une action en tête de file (durée en ms) ; marche : vers walkTo (0..1) ou au hasard. */
      act: (pose: Pose, ms = 10000, say?: Say, view?: View, facing?: 1 | -1, walkTo?: number) => {
        const s = st.current;
        s.queue.unshift({ pose, ms, say, view, facing, walkTo: pose === 'walk' && view !== 'back' ? (walkTo ?? Math.random()) : undefined });
        s.act = null;
      },
      /** Place le personnage sur un encadré donné, à une abscisse donnée (px depuis le bord gauche). */
      perchOn: (el: HTMLElement, x: number) => {
        const s = st.current;
        s.perch = el;
        s.x = x;
        s.bubblePos = null;
      },
    };
  }, [level]);

  const s = st.current;
  if (!live || !s.visible) return null;
  const halo = document.documentElement.dataset.theme === 'dark' ? '#e9dfcc' : undefined;
  const poke = () => {
    if (s.act?.pose === 'puff') return;
    s.queue.unshift({ pose: isSeated(s.pose) ? 'sitwave' : 'wave', ms: 1500, say: 'poke', view: 'front' });
    if (s.act?.walkTo == null) s.act = null;
  };
  const still = reduced();
  return (
    <div className="mascot-layer" aria-hidden="true">
      <div ref={wrap} className="mascot" style={{ width: W, height: H }} onClick={poke}>
        <div ref={body} className="mascot-body">
          <Sprite pose={s.pose} frame={still ? 0 : s.frame} level={level} view={s.view} facing={s.facing} halo={halo} blink={!still && s.blinkUntil > 0} />
        </div>
      </div>
      {s.bubble && (
        <div ref={bub} className="mascot-bubble">
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
