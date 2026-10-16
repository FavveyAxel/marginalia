// Le compagnon : un petit cerveau qui vit sa vie sur l'interface. Il apparaît de temps en temps sur le
// bord haut d'un encadré (cartes de l'accueil, couvertures, cartes d'espace, listes des réglages), s'y
// promène, s'assoit les jambes dans le vide, lit, réfléchit, somnole, dit parfois une citation, puis
// s'en va. Il bouge par à-coups (environ 3 images par seconde) ; seule la position suit le défilement
// en continu, pour qu'il reste posé sur son encadré.
// Musculature : selon le nombre de documents (livres + écrits) ; il fait le costaud quand il gagne un niveau.
// Réglage « Compagnon » (désactivé, rarement, parfois, souvent) ; mouvement réduit : pas de marche.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import { Sprite, anchorOf, VB_H, VB_W, type Level, type Pose } from './Sprite';
import { MUTTER, QUOTES, pick } from './quotes';
import './mascot.css';

export type MascotFreq = 'off' | 'rare' | 'sometimes' | 'often';
export const MASCOT_DEFAULT: MascotFreq = 'sometimes';

const TICK = 333;
const SCALE = 0.56;
const W = VB_W * SCALE;
const STEP = 5;
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

/** Niveau de musculature selon le nombre de documents. */
export function levelFor(n: number): Level {
  return n < 5 ? 0 : n < 15 ? 1 : n < 40 ? 2 : n < 100 ? 3 : 4;
}
export const LEVEL_STEPS = [0, 5, 15, 40, 100];

type Bubble = { text: string; author?: string; source?: string };
type Say = 'quote' | 'hello' | 'flex' | 'poke';
type Act = { pose: Pose; frames: number; walkTo?: number; say?: Say; leave?: boolean };

interface State {
  visible: boolean;
  perch: HTMLElement | null;
  x: number;
  target: number;
  pose: Pose;
  frame: number;
  facing: 1 | -1;
  act: Act | null;
  left: number;
  queue: Act[];
  next: number;
  bubble: Bubble | null;
  bubbleUntil: number;
  pendingFlex: boolean;
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

function plan(level: Level, flex: boolean): Act[] {
  const q: Act[] = [{ pose: 'puff', frames: 2 }, { pose: 'stand', frames: 2 }];
  if (flex) q.push({ pose: 'flex', frames: 9, say: 'flex' });
  else if (Math.random() < 0.5) q.push({ pose: 'wave', frames: 5, say: Math.random() < 0.35 ? 'hello' : undefined });
  const n = 2 + randInt(3);
  let quoted = false;
  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.6) q.push({ pose: 'walk', frames: 0, walkTo: Math.random() });
    const r = Math.random();
    if (r < 0.22) q.push({ pose: 'sit', frames: 18 + randInt(24) });
    else if (r < 0.47) q.push({ pose: 'read', frames: 36 + randInt(48) });
    else if (r < 0.67) {
      q.push({ pose: 'think', frames: 12, say: 'quote' }, { pose: 'sit', frames: 14 });
      quoted = true;
    } else if (r < 0.8) q.push({ pose: 'doze', frames: 24 + randInt(30) });
    else if (r < 0.92 || level < 2) {
      q.push({ pose: 'stand', frames: 16, say: 'quote' });
      quoted = true;
    } else q.push({ pose: 'flex', frames: 6 });
  }
  if (!quoted && Math.random() < 0.7) q.push({ pose: 'think', frames: 12, say: 'quote' }, { pose: 'sit', frames: 14 });
  q.push({ pose: 'stand', frames: 2 }, { pose: 'puff', frames: 3, leave: true });
  return q;
}

function bubbleFor(say: Say): Bubble {
  if (say === 'quote') return pick(QUOTES);
  return { text: pick(MUTTER[say]) };
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Mascot({ route }: { route: string }) {
  const freq: MascotFreq = useStore((s) => s.settings.mascot ?? MASCOT_DEFAULT);
  const docs = useStore((s) => s.books.length + s.drafts.length);
  const level = levelFor(docs);
  const [, setTick] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const bub = useRef<HTMLDivElement>(null);
  const prevLevel = useRef(level);
  const st = useRef<State>({
    visible: false,
    perch: null,
    x: 0,
    target: 0,
    pose: 'stand',
    frame: 0,
    facing: 1,
    act: null,
    left: 0,
    queue: [],
    next: 0,
    bubble: null,
    bubbleUntil: 0,
    pendingFlex: false,
  });
  const live = freq !== 'off' && ROUTES.has(route);

  const vanish = (s: State, gap: number) => {
    s.visible = false;
    s.perch = null;
    s.act = null;
    s.queue = [];
    s.bubble = null;
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
        s.queue.unshift({ pose: 'flex', frames: 9, say: 'flex' });
        s.act = null;
      } else {
        s.pendingFlex = true;
        s.next = Math.min(s.next, Date.now() + 4000);
      }
    }
    prevLevel.current = level;
  }, [level]);

  // Horloge à 3 images par seconde.
  useEffect(() => {
    if (!live) return;
    const still = reduced();
    const start = (s: State, a: Act | undefined) => {
      if (!a) return vanish(s, between(GAP[freq as Exclude<MascotFreq, 'off'>]));
      s.act = a;
      s.pose = a.pose;
      s.frame = 0;
      s.left = a.frames;
      if (a.walkTo != null && s.perch) {
        const max = Math.max(0, s.perch.getBoundingClientRect().width - W - 12);
        s.target = 6 + a.walkTo * max;
        if (still) s.x = s.target;
      }
      if (a.say) {
        s.bubble = bubbleFor(a.say);
        s.bubbleUntil = Date.now() + Math.min(12000, 4000 + s.bubble.text.length * 45);
      }
    };
    const tick = () => {
      const s = st.current;
      const now = Date.now();
      if (s.bubble && now > s.bubbleUntil) s.bubble = null;
      if (!s.visible) {
        if (document.hidden || now < s.next) return;
        const el = findPerch(null);
        if (!el) {
          s.next = now + 8000;
          return;
        }
        s.perch = el;
        s.x = 6 + Math.random() * Math.max(0, el.getBoundingClientRect().width - W - 12);
        s.facing = Math.random() < 0.5 ? 1 : -1;
        s.queue = plan(level, s.pendingFlex);
        s.pendingFlex = false;
        s.visible = true;
        start(s, s.queue.shift());
        setTick((t) => t + 1);
        return;
      }
      if (!s.perch || !s.perch.isConnected || !edgeOk(s.perch, false)) {
        vanish(s, 20e3 + Math.random() * 20e3);
        setTick((t) => t + 1);
        return;
      }
      if (!s.act) {
        start(s, s.queue.shift());
        setTick((t) => t + 1);
        return;
      }
      s.frame++;
      let done = false;
      if (s.act.walkTo != null) {
        const dx = s.target - s.x;
        if (Math.abs(dx) <= STEP) {
          s.x = s.target;
          done = true;
        } else {
          s.x += Math.sign(dx) * STEP;
          s.facing = dx > 0 ? 1 : -1;
        }
      } else done = --s.left <= 0;
      if (done) {
        if (s.act.leave) vanish(s, between(GAP[freq as Exclude<MascotFreq, 'off'>]));
        else start(s, s.queue.shift());
      }
      setTick((t) => t + 1);
    };
    const id = window.setInterval(tick, TICK);
    return () => window.clearInterval(id);
  }, [live, freq, level]);

  // Position : suit l'encadré en continu (défilement, survol), indépendamment des à-coups.
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const place = () => {
      raf = requestAnimationFrame(place);
      const s = st.current;
      const w = wrap.current;
      if (!w || !s.visible || !s.perch) return;
      const r = s.perch.getBoundingClientRect();
      const left = Math.round(r.left + s.x);
      const top = Math.round(r.top - anchorOf(s.pose) * SCALE);
      const hidden = r.top < 70 || r.top > innerHeight;
      w.style.transform = `translate(${left}px, ${top}px)`;
      w.style.visibility = hidden ? 'hidden' : 'visible';
      const b = bub.current;
      if (b) {
        const bw = b.offsetWidth;
        const cx = left + W / 2;
        const bl = Math.max(8, Math.min(innerWidth - bw - 8, cx - 28));
        b.style.transform = `translate(${Math.round(bl)}px, ${Math.round(top - b.offsetHeight + 2)}px)`;
        b.style.setProperty('--tail', `${Math.round(Math.max(14, Math.min(bw - 14, cx - bl)))}px`);
        b.style.visibility = hidden ? 'hidden' : 'visible';
      }
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [live]);

  // Accès de test.
  useEffect(() => {
    if (!(import.meta.env.DEV || new URLSearchParams(location.search).has('e2e'))) return;
    (window as any).__mascot = {
      state: () => ({ ...st.current, perch: st.current.perch?.className ?? null, level }),
      appear: () => {
        st.current.next = 0;
        if (st.current.visible) vanish(st.current, 0);
      },
      act: (pose: Pose, frames = 30, say?: Say) => {
        const s = st.current;
        s.queue.unshift({ pose, frames, say });
        s.act = null;
      },
    };
  }, [level]);

  const s = st.current;
  if (!live || !s.visible) return null;
  const halo = document.documentElement.dataset.theme === 'dark' ? '#e9dfcc' : undefined;
  const poke = () => {
    if (s.act?.pose === 'puff') return;
    s.queue.unshift({ pose: 'wave', frames: 5, say: 'quote' });
    if (s.act?.walkTo == null) s.act = null;
  };
  return (
    <div className="mascot-layer" aria-hidden="true">
      <div ref={wrap} className="mascot" style={{ width: W, height: VB_H * SCALE }} onClick={poke}>
        <Sprite pose={s.pose} frame={reduced() ? 0 : s.frame} level={level} facing={s.facing} halo={halo} />
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
