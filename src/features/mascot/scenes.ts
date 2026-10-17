// Scènes du compagnon : à chaque visite, une suite d'actions qui a un sens là où il est.
// Accueil : il lit le livre en cours sur « Reprendre », commente la révision du jour, se promène.
// Bibliothèque : il saute de couverture en couverture pour choisir, lit, s'endort sur un livre.
// Espaces : il s'installe sur un document, réagit au nom de l'espace, compare deux documents.
// Les phrases sont choisies au moment où il parle (contexte de l'encadré où il se trouve).
import type { Level, Pose, View } from './Sprite';
import type { Ctx } from './lines';
import type { CharId } from './characters';

export type Page = Ctx['page'];
export type Say = 'quote' | 'joke' | 'ponder' | 'context' | 'hello' | 'flex' | 'poke' | 'bye' | 'guitar' | 'whistle' | 'write' | 'cigar';
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
  // Dans un espace, il peut aussi s'installer sur les boutons de la barre d'actions (au-dessus, il y a de la place).
  workspace: ['.ws-card', '.ws-actions > button'],
  other: ['.set-list', '.home-card', '.ws-card', '.lib-card-cover'],
};
export const ALL_PERCHES = '.home-card, .lib-card-cover, .lib-row:not(.lib-row-head), .ws-card, .ws-actions > button, .set-list';

const r = Math.random;
const sec = (a: number, b = a) => (a + r() * (b - a)) * 1000;
const chance = (p: number) => r() < p;
const oneOf = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
const facing = (): 1 | -1 => (chance(0.5) ? 1 : -1);

// ── Briques ─────────────────────────────────────────────────

const stroll = (to = r()): Act[] => [{ pose: 'walk', ms: 0, walkTo: to }, { pose: 'stand', ms: 350, view: 'front' }];
const look = (ms = 1600): Act => ({ pose: 'look', ms, view: 'front' });
// Assis ou en activité : toujours de face (le profil est réservé aux déplacements).
const sitDown = (pose: Pose, ms: number): Act => ({ pose, ms, view: 'front' });
const think = (say: Say = chance(0.6) ? 'quote' : 'ponder'): Act[] => [
  { pose: 'think', ms: 4200, say, view: 'front' },
  { pose: 'sit', ms: sec(3, 5), view: 'front' },
];
const nap = (): Act[] => [
  sitDown('sit', 1200),
  { pose: 'doze', ms: sec(8, 15), view: 'front' },
  { pose: 'stand', ms: 300, view: 'front' },
  { pose: 'look', ms: 1200, view: 'front', say: chance(0.6) ? 'joke' : undefined },
];
const read = (comment: boolean): Act[] => {
  const v: View = 'front';
  const f = facing();
  const out: Act[] = [{ pose: 'read', ms: sec(3, 5), view: v, facing: f, say: comment ? 'context' : undefined }];
  out.push({ pose: 'read', ms: sec(8, 16), view: v, facing: f });
  if (chance(0.4)) out.push({ pose: 'think', ms: 3800, say: chance(0.5) ? 'ponder' : 'quote', view: 'front' });
  return out;
};
// Passe-temps : guitare, sifflet, écriture d'un livre, cigare de penseur.
const guitar = (): Act[] => {
  const v: View = 'front';
  const f = facing();
  return [
    { pose: 'guitar', ms: sec(3, 4), view: v, facing: f },
    { pose: 'guitar', ms: sec(5, 9), view: v, facing: f, say: 'guitar' },
    { pose: 'guitar', ms: sec(3, 6), view: v, facing: f },
  ];
};
const whistle = (): Act[] => [
  { pose: 'whistle', ms: sec(3, 5), view: 'front', say: chance(0.5) ? 'whistle' : undefined },
  ...stroll(),
  { pose: 'whistle', ms: sec(2, 4), view: 'front' },
];
const write = (): Act[] => {
  const v: View = 'front';
  const f = facing();
  return [
    { pose: 'write', ms: sec(4, 6), view: v, facing: f, say: 'write' },
    { pose: 'write', ms: sec(8, 14), view: v, facing: f },
    ...(chance(0.5) ? [{ pose: 'think' as Pose, ms: 3500, view: 'front' as View, say: 'ponder' as Say }] : []),
  ];
};
const cigar = (): Act[] => {
  const v: View = 'front';
  const f = facing();
  return [
    { pose: 'cigar', ms: sec(4, 6), view: v, facing: f },
    { pose: 'cigar', ms: sec(5, 8), view: v, facing: f, say: chance(0.6) ? 'cigar' : 'quote' },
    { pose: 'cigar', ms: sec(3, 5), view: v, facing: f },
  ];
};

// ── Activités (registre) ─────────────────────────────────────
// Chaque activité : une suite d'actions sur place. `chars` : réservée à certains compagnons
// (Socrate qui questionne, Rousseau qui herborise…) ; absente : pour tous. `w` : poids du tirage.
export type Activity = { id: string; w: number; chars?: CharId[]; acts: () => Act[] };
export const ACTIVITIES: Activity[] = [
  { id: 'guitar', w: 2, acts: guitar },
  { id: 'whistle', w: 2, acts: whistle },
  { id: 'write', w: 2, acts: write },
  { id: 'cigar', w: 2, acts: cigar },
];
/** Activités du compagnon (les siennes propres comptent double). */
export function activitiesFor(char: CharId): Activity[] {
  return ACTIVITIES.filter((a) => !a.chars || a.chars.includes(char));
}
function pickActivity(char: CharId, exclude: string[] = []): Activity {
  const list = activitiesFor(char).filter((a) => !exclude.includes(a.id));
  const wt = (a: Activity) => a.w * (a.chars ? 2 : 1);
  let t = r() * list.reduce((n, a) => n + wt(a), 0);
  for (const a of list) if ((t -= wt(a)) < 0) return a;
  return list[0];
}
const pastime = (char: CharId): Act[] => pickActivity(char).acts();

const hop = (h: Hop): Act[] => [{ pose: 'jump', ms: 0, hop: h }, { pose: 'stand', ms: 300, view: 'front' }];
const quip = (): Act => ({ pose: 'stand', ms: 4800, say: oneOf<Say>(['joke', 'joke', 'ponder', 'context']), view: 'front' });

// ── Scènes par page ─────────────────────────────────────────

type Scene = { w: number; acts: (level: Level, char: CharId) => Act[] };

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
    // Passe-temps : il écrit son livre sur la carte des écrits, gratte la guitare sur un espace…
    { w: 2, acts: () => [...hop({ sel: '.home-resume-card ~ .home-resume-card' }), ...stroll(0.2 + r() * 0.6), ...write()] },
    { w: 2, acts: () => [...hop({ sel: '.home-space' }), ...stroll(), ...guitar()] },
    { w: 1, acts: () => [...stroll(), ...(chance(0.5) ? cigar() : whistle())] },
    // Une activité au hasard (y compris celles propres au compagnon).
    { w: 3, acts: (_l, c) => [...stroll(), ...pastime(c)] },
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
    // Un cigare sur une pile de livres, de la guitare entre deux rayons, un air sifflé en flânant.
    { w: 2, acts: () => [...hop({ near: true }), ...cigar()] },
    { w: 1, acts: () => [...hop({ near: true }), ...guitar()] },
    { w: 1, acts: () => [...whistle(), ...hop({ near: true }), look()] },
    { w: 3, acts: (_l, c) => [...hop({ near: true }), ...pastime(c)] },
  ],
  workspace: [
    // Il s'installe sur un document de l'espace et réagit à l'espace.
    { w: 3, acts: () => [...stroll(), { pose: 'sit', ms: 4500, view: 'front', say: 'context' }, ...read(false)] },
    // Il compare deux documents en sautant de l'un à l'autre.
    { w: 2, acts: () => [look(1200), ...hop({ near: true }), look(1200), { pose: 'think', ms: 4200, view: 'front', say: 'ponder' }, { pose: 'sit', ms: sec(3, 6), view: 'front' }] },
    { w: 2, acts: () => [sitDown('sit', sec(3, 5)), ...think()] },
    { w: 1, acts: () => nap() },
    // Il écrit dans l'espace, ou réfléchit au cigare.
    { w: 2, acts: () => [...stroll(), ...write()] },
    { w: 1, acts: () => [...hop({ near: true }), ...(chance(0.5) ? cigar() : guitar())] },
    { w: 3, acts: (_l, c) => [...stroll(), ...pastime(c)] },
  ],
  other: [
    { w: 2, acts: () => [...stroll(), quip()] },
    { w: 2, acts: () => [sitDown('sit', sec(3, 5)), ...think()] },
    { w: 1, acts: () => nap() },
    { w: 2, acts: (_l, c) => pastime(c) },
  ],
};

function pickScene(page: Page): Scene {
  const list = SCENES[page];
  let t = r() * list.reduce((n, s) => n + s.w, 0);
  for (const s of list) if ((t -= s.w) < 0) return s;
  return list[0];
}

/** Durée des visites (réglage, 0 à 4) : facteur appliqué au nombre de scènes et aux activités calmes. */
export const STAY = [0.4, 0.7, 1, 1.7, 3];
export const STAY_LABELS = ['Très courte', 'Courte', 'Normale', 'Longue', 'Très longue'];
/** Durée approximative d'une visite, pour l'affichage. */
export const STAY_HINT = ['environ 30 secondes', 'environ 45 secondes', 'environ une minute et demie', 'près de 4 minutes', 'environ 7 minutes'];
const POSES_CALMES = new Set<Pose>(['sit', 'read', 'doze', 'guitar', 'write', 'cigar', 'whistle']);

/** Une visite complète : arrivée, des scènes (plus ou moins selon la durée choisie), au revoir, départ. */
export function buildVisit(page: Page, level: Level, flex: boolean, stay = 1, char: CharId = 'brain', scenes = Math.max(1, Math.min(7, Math.round((2 + (chance(0.4) ? 1 : 0)) * stay)))): Act[] {
  const q: Act[] = [{ pose: 'puff', ms: 300 }, { pose: 'stand', ms: 450, view: 'front' }];
  if (flex) q.push({ pose: 'flex', ms: 2600, say: 'flex' });
  // Coucou à l'arrivée (et au départ) seulement ; entre les deux, très rarement.
  else q.push({ pose: 'wave', ms: 1500, say: chance(0.5) ? 'hello' : undefined });
  for (let i = 0; i < scenes; i++) {
    q.push(...pickScene(page).acts(level, char));
    if (level >= 2 && chance(0.15)) q.push({ pose: 'flex', ms: 1800 });
  }
  // Activités calmes plus ou moins longues selon la durée choisie (les gestes et la parole ne changent pas).
  // Activités calmes (lire, fumer, jouer, écrire, somnoler…) : longues, pour qu'on ait le temps de les voir.
  const k = 2.5 * Math.max(0.6, Math.min(2, stay));
  for (const a of q) if (POSES_CALMES.has(a.pose) && a.ms > 2500) a.ms = Math.round(a.ms * k);
  q.push({ pose: 'wave', ms: 1600, say: chance(0.5) ? 'bye' : undefined });
  // Il s'en va : demi-tour, quelques pas de dos, puis un petit nuage.
  q.push({ pose: 'stand', ms: 300, view: 'back' }, { pose: 'walk', ms: 700, view: 'back' }, { pose: 'puff', ms: 300, leave: true });
  return q;
}

/** Une scène précise (tests, démonstration). */
export function sceneActs(page: Page, index: number, level: Level, char: CharId = 'brain'): Act[] {
  return SCENES[page][index % SCENES[page].length].acts(level, char);
}
/** Une activité précise (tests, démonstration) ; null si elle n'existe pas pour ce compagnon. */
export function activityActs(id: string, char: CharId = 'brain'): Act[] | null {
  const a = activitiesFor(char).find((x) => x.id === id);
  return a ? a.acts() : null;
}
export const sceneCount = (page: Page) => SCENES[page].length;
