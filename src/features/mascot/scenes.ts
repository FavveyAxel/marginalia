// Scènes du compagnon : à chaque visite, une suite d'actions qui a un sens là où il est.
// Accueil : il lit le livre en cours sur « Reprendre », commente la révision du jour, se promène.
// Bibliothèque : il saute de couverture en couverture pour choisir, lit, s'endort sur un livre.
// Espaces : il s'installe sur un document, réagit au nom de l'espace, compare deux documents.
// Les phrases sont choisies au moment où il parle (contexte de l'encadré où il se trouve).
import type { Level, Pose, View } from './Sprite';
import type { Ctx } from './lines';

export type Page = Ctx['page'];
export type Say = 'quote' | 'joke' | 'ponder' | 'context' | 'hello' | 'flex' | 'poke' | 'bye';
/** Saut vers un autre encadré : le plus proche, un encadré précis (sélecteur), ou n'importe lequel. */
export type Hop = { near?: boolean; sel?: string };
export type Act = {
  pose: Pose;
  ms: number;
  /** Marche le long du bord, vers une fraction de la largeur (0 : bord gauche, 1 : bord droit). */
  walkTo?: number;
  hop?: Hop;
  say?: Say;
  leave?: boolean;
  view?: View;
  facing?: 1 | -1;
  /** Interne : demi-tour déjà fait avant la marche. */
  turned?: boolean;
};

/** Encadrés où il peut se poser, par page (le premier sélecteur est préféré). */
export const PERCHES: Record<Page, string[]> = {
  home: ['.home-resume-card:not(.home-resume-empty)', '.home-review', '.home-space', '.home-card'],
  library: ['.lib-card-cover', '.lib-row:not(.lib-row-head)'],
  workspace: ['.ws-card'],
  other: ['.set-list', '.home-card', '.ws-card', '.lib-card-cover'],
};
export const ALL_PERCHES = '.home-card, .lib-card-cover, .lib-row:not(.lib-row-head), .ws-card, .set-list';

const r = Math.random;
const sec = (a: number, b = a) => (a + r() * (b - a)) * 1000;
const chance = (p: number) => r() < p;
const oneOf = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
const facing = (): 1 | -1 => (chance(0.5) ? 1 : -1);

// ── Briques ─────────────────────────────────────────────────

const stroll = (to = r()): Act[] => [{ pose: 'walk', ms: 0, walkTo: to }, { pose: 'stand', ms: 350, view: 'front' }];
const look = (ms = 1600): Act => ({ pose: 'look', ms, view: 'front' });
const sitDown = (pose: Pose, ms: number, view?: View): Act => {
  const v = view ?? (chance(0.55) ? 'front' : 'side');
  return { pose, ms, view: v, facing: v === 'side' ? facing() : undefined };
};
const think = (say: Say = chance(0.6) ? 'quote' : 'ponder'): Act[] => [
  { pose: 'think', ms: 4200, say, view: 'front' },
  { pose: 'sit', ms: sec(3, 5), view: 'front' },
];
const nap = (): Act[] => [
  sitDown('sit', 1200, chance(0.3) ? 'back' : undefined),
  { pose: 'doze', ms: sec(8, 15), view: chance(0.5) ? 'front' : 'side', facing: facing() },
  { pose: 'stand', ms: 300, view: 'front' },
  { pose: 'look', ms: 1200, view: 'front', say: chance(0.6) ? 'joke' : undefined },
];
const read = (comment: boolean): Act[] => {
  const v: View = chance(0.6) ? 'front' : 'side';
  const f = facing();
  const out: Act[] = [{ pose: 'read', ms: sec(3, 5), view: v, facing: f, say: comment ? 'context' : undefined }];
  out.push({ pose: 'read', ms: sec(8, 16), view: v, facing: f });
  if (chance(0.4)) out.push({ pose: 'think', ms: 3800, say: chance(0.5) ? 'ponder' : 'quote', view: 'front' });
  return out;
};
const hop = (h: Hop): Act[] => [{ pose: 'jump', ms: 0, hop: h }, { pose: 'stand', ms: 300, view: 'front' }];
const quip = (): Act => ({ pose: 'stand', ms: 4800, say: oneOf<Say>(['joke', 'joke', 'ponder', 'context']), view: 'front' });

// ── Scènes par page ─────────────────────────────────────────

type Scene = { w: number; acts: (level: Level) => Act[] };

const SCENES: Record<Page, Scene[]> = {
  home: [
    // Il rejoint « Reprendre » et lit le livre en cours, en le commentant.
    { w: 4, acts: () => [...hop({ sel: '.home-resume-card:not(.home-resume-empty)' }), ...stroll(0.15 + r() * 0.6), ...read(true)] },
    // La révision du jour : commentaire, puis sieste ou réflexion.
    { w: 2, acts: () => [...hop({ sel: '.home-review' }), ...stroll(0.3 + r() * 0.5), { pose: 'sit', ms: 4500, view: 'front', say: 'context' }, ...(chance(0.5) ? nap() : think())] },
    // Promenade d'un bout à l'autre, coup d'œil, petite phrase.
    { w: 2, acts: () => [...stroll(0.92), look(), ...stroll(0.08), quip()] },
    { w: 2, acts: () => [sitDown('sit', sec(3, 5)), ...think()] },
    { w: 1, acts: () => [...hop({ near: true }), look(), ...(chance(0.5) ? nap() : [quip()])] },
  ],
  library: [
    // Il cherche quoi lire : saute de couverture en couverture, regarde, puis s'installe et lit.
    {
      w: 4,
      acts: () => {
        const out: Act[] = [];
        const n = 1 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) out.push(...hop({ near: true }), look(1000 + r() * 800));
        return [...out, ...read(true)];
      },
    },
    { w: 2, acts: () => [{ pose: 'sit', ms: 3500, view: 'front', say: 'context' }, ...nap()] },
    { w: 2, acts: () => read(true) },
    { w: 1, acts: () => [...hop({ near: true }), quip(), ...hop({ near: true }), sitDown('sit', sec(4, 7))] },
  ],
  workspace: [
    // Il s'installe sur un document de l'espace et réagit à l'espace.
    { w: 3, acts: () => [...stroll(), { pose: 'sit', ms: 4500, view: 'front', say: 'context' }, ...read(false)] },
    // Il compare deux documents en sautant de l'un à l'autre.
    { w: 2, acts: () => [look(1200), ...hop({ near: true }), look(1200), { pose: 'think', ms: 4200, view: 'front', say: 'ponder' }, { pose: 'sit', ms: sec(3, 6), view: 'front' }] },
    { w: 2, acts: () => [sitDown('sit', sec(3, 5)), ...think()] },
    { w: 1, acts: () => nap() },
  ],
  other: [
    { w: 2, acts: () => [...stroll(), quip()] },
    { w: 2, acts: () => [sitDown('sit', sec(3, 5)), ...think()] },
    { w: 1, acts: () => nap() },
  ],
};

function pickScene(page: Page): Scene {
  const list = SCENES[page];
  let t = r() * list.reduce((n, s) => n + s.w, 0);
  for (const s of list) if ((t -= s.w) < 0) return s;
  return list[0];
}

/** Une visite complète : arrivée, 2 ou 3 scènes, éventuellement un au revoir, départ. */
export function buildVisit(page: Page, level: Level, flex: boolean, scenes = 2 + (chance(0.4) ? 1 : 0)): Act[] {
  const q: Act[] = [{ pose: 'puff', ms: 300 }, { pose: 'stand', ms: 450, view: 'front' }];
  if (flex) q.push({ pose: 'flex', ms: 2600, say: 'flex' });
  else if (chance(0.45)) q.push({ pose: 'wave', ms: 1400, say: chance(0.5) ? 'hello' : undefined });
  else q.push(look(1200));
  for (let i = 0; i < scenes; i++) {
    q.push(...pickScene(page).acts(level));
    if (level >= 2 && chance(0.15)) q.push({ pose: 'flex', ms: 1800 });
  }
  if (chance(0.35)) q.push({ pose: 'wave', ms: 1600, say: 'bye' });
  // Il s'en va : demi-tour, quelques pas de dos, puis un petit nuage.
  q.push({ pose: 'stand', ms: 300, view: 'back' }, { pose: 'walk', ms: 700, view: 'back' }, { pose: 'puff', ms: 300, leave: true });
  return q;
}

/** Une scène précise (tests, démonstration). */
export function sceneActs(page: Page, index: number, level: Level): Act[] {
  return SCENES[page][index % SCENES[page].length].acts(level);
}
export const sceneCount = (page: Page) => SCENES[page].length;
