import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Sprite, anchorOf, isSeated, VB_H, VB_W, type Pose } from '../../src/features/mascot/Sprite';
import { extraPose } from '../../src/features/mascot/activities';
import { rousseau } from '../../src/features/mascot/characters/rousseau';
import { DOWNLOADS, VERSION, type Download } from './downloads';
import './site.css';

// Cadence de chaque pose (images par seconde), comme dans l'app ; activités : leur propre cadence.
const FPS: Partial<Record<string, number>> = { puff: 10, sitwave: 8, read: 4, wave: 8, write: 4, think: 3, jump: 8, walk: 8, doze: 2 };
const fpsOf = (p: Pose) => FPS[p] ?? extraPose(p)?.fps ?? 4;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Rousseau, dessiné et animé par le moteur de l'app. `seq` : activités jouées l'une après l'autre (ms).
 * `poke` : un clic le fait sauter puis passer à l'activité suivante.
 */
/** Une pile de livres pour s'asseoir (même repère que le dessin du personnage : 100 × 130, assise vers y = 70). */
function BookSeat() {
  const ink = { stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' as const };
  const book = (x: number, y: number, w: number, h: number, fill: string, band: string) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={1.6} fill={fill} {...ink} />
      <rect x={x + w - 6} y={y + 1.2} width={4.2} height={h - 2.4} fill="#f4ecdc" stroke="none" />
      <line x1={x + 5} y1={y + h / 2} x2={x + w - 10} y2={y + h / 2} stroke={band} strokeWidth={1.4} strokeLinecap="round" />
    </g>
  );
  return (
    <svg className="book-seat" viewBox={`0 0 ${VB_W} ${VB_H}`} aria-hidden="true">
      {book(24, 108, 52, 19, '#6f8a74', '#d9c58f')}
      {book(28, 90, 46, 18, '#9b5f4a', '#e8d6a8')}
      {book(25, 72, 50, 18, '#5f6f93', '#d9c58f')}
    </svg>
  );
}

function Rousseau({ seq, size, className, poke, facing, seat }: { seq: [Pose, number][]; size: number; className?: string; poke?: boolean; facing?: 1 | -1; seat?: boolean }) {
  const [i, setI] = useState(0);
  const [frame, setFrame] = useState(0);
  const [jumping, setJumping] = useState(false);
  const pose: Pose = jumping ? 'jump' : seq[i % seq.length][0];
  const seqKey = JSON.stringify(seq);
  useEffect(() => { setI(0); setFrame(0); }, [seqKey]);
  useEffect(() => {
    if (reduced()) return;
    const t = setInterval(() => setFrame((f) => f + 1), 1000 / fpsOf(pose));
    return () => clearInterval(t);
  }, [pose]);
  useEffect(() => {
    if (seq.length < 2 || reduced() || jumping) return;
    const t = setTimeout(() => { setI((x) => x + 1); setFrame(0); }, seq[i % seq.length][1]);
    return () => clearTimeout(t);
  }, [i, seqKey, jumping]);
  useEffect(() => {
    if (!jumping) return;
    const t = setTimeout(() => { setJumping(false); setI((x) => x + 1); setFrame(0); }, 900);
    return () => clearTimeout(t);
  }, [jumping]);
  const h = (size * VB_H) / VB_W;
  const style = { width: `${size / 16}rem`, height: `${h / 16}rem`, ['--anchor' as string]: `${(anchorOf(pose) / VB_H) * (h / 16)}rem` };
  const sprite = (
    <>
      {seat && isSeated(pose) && <BookSeat />}
      <Sprite pose={pose} frame={frame} level={2} character={rousseau} facing={facing} />
    </>
  );
  // tailles en rem : la mascotte suit l'échelle fluide de la page
  if (poke && !reduced())
    return (
      <button type="button" className={`${className ?? ''} rousseau-poke`} style={style} onClick={() => { setJumping(true); setFrame(0); }} aria-label="Rousseau : cliquez pour qu’il change d’activité">
        {sprite}
      </button>
    );
  return (
    <span className={className} style={style} aria-hidden="true">
      {sprite}
    </span>
  );
}


// ── Un seul Rousseau qui accompagne la lecture de la page ────────────
// Il se pose sur des « perchoirs » (éléments [data-perch]) et va de l'un à l'autre en sautant (ou en
// marchant si c'est à la même hauteur) quand on fait défiler. Sur les captures, il reste debout sur le
// bord haut ; il ne s'assoit que sur la marge de la page annotée et sur sa pile de livres de présentateur.
type Bus = { tab: number; group: number; at: string | null };
const bus: Bus = { tab: 0, group: 0, at: null };
const busListeners = new Set<() => void>();
const setBus = (patch: Partial<Bus>) => {
  let changed = false;
  for (const k of Object.keys(patch) as (keyof Bus)[]) if (bus[k] !== patch[k]) { (bus as Record<string, unknown>)[k] = patch[k]; changed = true; }
  if (changed) busListeners.forEach((f) => f());
};
function useBus(): Bus {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((x) => x + 1); busListeners.add(f); return () => { busListeners.delete(f); }; }, []);
  return bus;
}
/** Le voyage n'a lieu que sur un écran assez large, et si le système ne demande pas moins de mouvement. */
function useTravel() {
  const q = () => typeof matchMedia === 'function' && matchMedia('(min-width: 901px)').matches && !reduced();
  const [on, setOn] = useState(q);
  useEffect(() => {
    const m = matchMedia('(min-width: 901px)');
    const f = () => setOn(q());
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return on;
}

const TAB_POSES: Pose[] = ['spyglass', 'geometry', 'paint'];
type PerchDef = { side: 'left' | 'right' | 'slot'; inset: number; seat?: boolean; seq: (b: Bus) => [Pose, number][] };
const PERCHES: Record<string, PerchDef> = {
  hero: { side: 'right', inset: 2, seq: () => HERO_SEQ },
  apercu: { side: 'right', inset: 3, seq: (b) => [[TAB_POSES[b.tab] ?? 'wave', 600000]] },
  cote: { side: 'right', inset: 2.5, seq: () => [['question', 4500], ['wave', 2500]] },
  espaces: { side: 'left', inset: 2, seq: () => [['juggle', 600000]] },
  livres: { side: 'right', inset: 2, seq: () => [['plane', 600000]] },
  fonctions: { side: 'slot', inset: 0, seat: true, seq: (b) => [[MORE[b.group]?.pose ?? 'read', 600000]] },
  telecharger: { side: 'right', inset: 1, seq: () => [['wave', 3000], ['whistle', 5000]] },
};

function Traveler() {
  const b = useBus();
  const [at, setAt] = useState('hero');
  const [trip, setTrip] = useState<null | { how: 'jump' | 'walk' | 'tele'; facing: 1 | -1; x: number; y: number; phase?: 'out' | 'in' }>(null);
  const [i, setI] = useState(0);
  const [frame, setFrame] = useState(0);
  const [poke, setPoke] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const fly = useRef<HTMLDivElement>(null);
  const perched = useRef<HTMLSpanElement>(null);
  const def = PERCHES[at];
  const seq = def.seq(b);
  const seqKey = at + JSON.stringify(seq);
  const pose: Pose = trip ? (trip.how === 'tele' ? 'puff' : trip.how) : poke ? 'jump' : seq[i % seq.length][0];
  const W = ROUSSEAU_SIZE, H = (ROUSSEAU_SIZE * VB_H) / VB_W;
  const atRef = useRef(at);
  atRef.current = at;
  const tripRef = useRef(false);
  tripRef.current = !!trip;

  useEffect(() => { setI(0); setFrame(0); }, [seqKey]);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => f + 1), 1000 / fpsOf(pose));
    return () => clearInterval(t);
  }, [pose]);
  useEffect(() => {
    if (trip || seq.length < 2 || poke) return;
    const t = setTimeout(() => { setI((x) => x + 1); setFrame(0); }, seq[i % seq.length][1]);
    return () => clearTimeout(t);
  }, [i, seqKey, trip, poke]);
  useEffect(() => {
    if (!poke) return;
    const t = setTimeout(() => { setPoke(false); setI((x) => x + 1); setFrame(0); }, 800);
    return () => clearTimeout(t);
  }, [poke]);
  useEffect(() => { setBus({ at: trip ? null : at }); }, [at, trip]);
  // posé : rendu DANS l'encadré (il défile avec lui, sans retard)
  useEffect(() => { setHost(document.querySelector<HTMLElement>(`[data-perch="${at}"]`)); }, [at]);

  useEffect(() => {
    const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const spot = (name: string) => {
      const el = document.querySelector<HTMLElement>(`[data-perch="${name}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const R = rem(), w = (W / 16) * R, h = (H / 16) * R, d = PERCHES[name];
      if (d.side === 'slot') return { x: r.left + (r.width - w) / 2, y: r.top + r.height - h };
      return { x: d.side === 'right' ? r.right - d.inset * R - w : r.left + d.inset * R, y: r.top - (anchorOf('jump') / VB_H) * h };
    };
    const order = Object.keys(PERCHES);
    const rectOf = (n: string) => document.querySelector<HTMLElement>(`[data-perch="${n}"]`)?.getBoundingClientRect() ?? null;
    let pending: string | null = null, pendingSince = 0, raf = 0;
    let travel: null | { from: { x: number; y: number }; to: string; t0: number; dur: number; how: 'jump' | 'walk' | 'tele'; arc: number; phase: 'out' | 'in' } = null;
    const choose = (now: number) => {
      const vh = window.innerHeight;
      const cur = rectOf(atRef.current);
      // on reste tant que l'encadré actuel est bien à l'écran
      const curOk = cur && cur.top > vh * 0.06 && cur.top < vh * 0.7;
      if (curOk) { pending = null; return null; }
      let best: string | null = null, bestD = Infinity;
      for (const n of order) {
        const r = rectOf(n);
        if (!r || r.top < vh * 0.08 || r.top > vh * 0.62) continue;
        const d = Math.abs(r.top - vh * 0.3);
        if (d < bestD) { bestD = d; best = n; }
      }
      if (!best || best === atRef.current) { pending = null; return null; }
      if (pending !== best) { pending = best; pendingSince = now; return null; }
      return now - pendingSince > 120 ? best : null; // choix stable un instant avant de partir
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!travel) {
        const next = tripRef.current ? null : choose(now);
        if (next) {
          const fromR = perched.current?.getBoundingClientRect();
          const to = spot(next);
          if (fromR && to) {
            const dx = to.x - fromR.left, dy = to.y - fromR.top;
            // loin : il se téléporte (nuage de fumée au départ, puis à l'arrivée) ; sinon il saute, ou marche à même hauteur
            const how = Math.abs(dy) > window.innerHeight * 0.5 ? 'tele' : Math.abs(dy) > 50 ? 'jump' : 'walk';
            const dur = how === 'tele' ? 600 : Math.min(600, Math.max(350, Math.hypot(dx, dy) * 0.55));
            travel = { from: { x: fromR.left, y: fromR.top }, to: next, t0: now, dur, how, arc: Math.min(140, 50 + Math.abs(dy) * 0.08), phase: 'out' };
            setTrip({ how, facing: dx >= 0 ? 1 : -1, x: fromR.left, y: fromR.top, phase: 'out' });
            setFrame(0);
          } else {
            setAt(next);
          }
        }
        return;
      }
      const to = spot(travel.to);
      if (!to) return;
      const t = Math.min(1, (now - travel.t0) / travel.dur);
      let x: number, y: number;
      if (travel.how === 'tele') {
        // première moitié : nuage à l'endroit quitté ; seconde moitié : nuage à l'arrivée
        if (t >= 0.5 && travel.phase === 'out') { travel.phase = 'in'; setTrip((tr) => (tr ? { ...tr, phase: 'in' } : tr)); setFrame(0); }
        ({ x, y } = travel.phase === 'out' ? travel.from : to);
      } else {
        const e = 1 - Math.pow(1 - t, 3);
        x = travel.from.x + (to.x - travel.from.x) * e;
        y = travel.from.y + (to.y - travel.from.y) * e;
        if (travel.how === 'jump') y -= travel.arc * 4 * t * (1 - t);
      }
      if (fly.current) fly.current.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      if (t >= 1) { const dest = travel.to; travel = null; setAt(dest); setTrip(null); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sprite = (facing: 1 | -1) => (
    <>
      {def.seat && !trip && isSeated(pose) && <BookSeat />}
      <Sprite pose={pose} frame={frame} level={2} character={rousseau} facing={facing} />
    </>
  );
  const size = { width: `${W / 16}rem`, height: `${H / 16}rem` };
  const place: React.CSSProperties =
    def.side === 'slot'
      ? { left: 0, bottom: 0 }
      : { top: `${-((anchorOf(pose) / VB_H) * H) / 16}rem`, [def.side]: `${def.inset}rem` };
  return (
    <>
      {trip && (
        <div className="traveler" ref={fly} style={{ ...size, transform: `translate3d(${trip.x}px, ${trip.y}px, 0)` }} aria-hidden="true">
          <div className="traveler-hit">{sprite(trip.facing)}</div>
        </div>
      )}
      {!trip && host &&
        createPortal(
          <span ref={perched} className="perched traveler-hit" style={{ ...size, ...place }} aria-hidden="true">
            {sprite(1)}
          </span>,
          host,
        )}
    </>
  );
}

function useOs(): 'mac' | 'win' | null {
  const [os, setOs] = useState<'mac' | 'win' | null>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    setOs(/Mac/i.test(ua) && !/iPhone|iPad/i.test(ua) ? 'mac' : /Windows/i.test(ua) ? 'win' : null);
  }, []);
  return os;
}

/** Pictogrammes neutres : un portable (Mac) et un écran de bureau (Windows). */
/**
 * Logo du système s'il a été déposé dans site/public/logos/ (apple.svg, windows.svg) ; à défaut, le
 * pictogramme neutre ci-dessous.
 */
function OsIcon({ os }: { os: 'mac' | 'win' }) {
  const [logoOk, setLogoOk] = useState(true);
  if (logoOk)
    return (
      <img className="os-icon os-logo" src={`/logos/${os === 'mac' ? 'apple' : 'windows'}.svg`} alt="" aria-hidden="true" onError={() => setLogoOk(false)} />
    );
  return os === 'mac' ? (
    <svg className="os-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <rect x="4.5" y="5" width="15" height="10.5" rx="1.4" />
      <path d="M2.5 18.5h19l-1.2-2h-16.6z" />
    </svg>
  ) : (
    <svg className="os-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="12.5" rx="1.4" />
      <path d="M9.5 20.5h5M12 16.5v4" />
    </svg>
  );
}

function DownloadButton({ d }: { d: Download }) {
  if (!d.url)
    return (
      <span className="btn btn-lg btn-quiet" aria-disabled="true">
        <OsIcon os={d.os} /> {d.label} : bientôt
      </span>
    );
  return (
    <a className="btn btn-lg btn-primary" href={d.url}>
      <OsIcon os={d.os} /> Télécharger pour {d.os === 'mac' ? 'Mac' : 'Windows'}
    </a>
  );
}

/** La page annotée du héros : début du Contrat social (1762), surligné comme dans l'app. */
function AnnotatedPage({ travel }: { travel: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  let order = 0;
  const hl = (cat: string, label: string, text: string) => (
    <mark style={{ ['--i' as string]: order++ }} className={`hl hl-${cat}`} data-cat={label} onMouseEnter={() => setHover(label)} onMouseLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(label)} onBlur={() => setHover(null)}>
      {text}
    </mark>
  );
  return (
    <figure className="page" data-perch="hero" aria-label="Exemple : le début du Contrat social, annoté dans Marginalia">
      {!travel && <Rousseau className="page-rousseau" size={ROUSSEAU_SIZE} seq={HERO_SEQ} />}
      <div className="page-body">
        <p className="page-ref">Rousseau, <cite>Du contrat social</cite>, I, 1</p>
        <p>
          {hl('these', 'Thèse', 'L’homme est né libre, et partout il est dans les fers.')}{' '}
          {hl('exemple', 'Exemple', 'Tel se croit le maître des autres, qui ne laisse pas d’être plus esclave qu’eux.')}{' '}
          Comment ce changement s’est-il fait ? Je l’ignore. {hl('probleme', 'Problème', 'Qu’est-ce qui peut le rendre légitime ?')} Je crois pouvoir résoudre cette question.
        </p>
        <p>
          Si je ne considérais que la force, et l’effet qui en dérive, je dirais :{' '}
          {hl('objection', 'Thèse adverse', 'Tant qu’un peuple est contraint d’obéir et qu’il obéit, il fait bien ;')}{' '}
          sitôt qu’il peut secouer le joug, et qu’il le secoue, il fait encore mieux.
        </p>
      </div>
      <aside className="margin" aria-label="Notes en marge">
        <p className="note n1">Fait ou droit ? Il ne demande pas comment, mais de quel droit.</p>
        <p className="note n2">Le droit du plus fort : réfuté au chapitre III.</p>
      </aside>
      <figcaption className="page-legend" aria-live="polite">
        {hover ? <span>{hover}</span> : <span className="muted">Survolez un passage surligné</span>}
      </figcaption>
    </figure>
  );
}

/** Une seule taille pour Rousseau sur tout le site (unités du dessin, converties en rem). */
const ROUSSEAU_SIZE = 108;

const HERO_SEQ: [Pose, number][] = [['wave', 2600], ['read', 6500], ['spyglass', 4500], ['juggle', 5500], ['think', 3200], ['coffee', 6000]];

const STEPS = [
  {
    title: 'Lire',
    text: 'Ouvrez vos livres et vos cours, EPUB, PDF, Word ou Markdown, et lisez deux textes côte à côte. Surlignez en six catégories : problème, thèse, argument, thèse adverse, concept, exemple.',
    shot: 'lire',
  },
  {
    title: 'Organiser sa pensée',
    text: 'Une carte pour organiser votre pensée : posez la problématique au centre, puis reliez-y thèses, arguments et objections tirés de vos lectures, même de plusieurs livres. Vos surlignages deviennent aussi une fiche du texte et des fiches de concepts.',
    shot: 'comprendre',
  },
  {
    title: 'Écrire',
    text: 'Plans de dissertation et traitement de texte au format Word, avec notes de bas de page et citations reliées à leur passage. Export Word, PDF, page web ou Markdown, mise en page comprise.',
    shot: 'ecrire',
  },
];

/** Aperçu : onglets au-dessus d'une grande capture de l'app. */
const AUTO_MS = 7000;
function Showcase() {
  const [k, setK] = useState(0);
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLElement>(null);
  // défilement automatique des onglets quand l'aperçu est à l'écran ; un clic l'arrête
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!auto || !visible || reduced()) return;
    const t = setTimeout(() => setK((x) => (x + 1) % STEPS.length), AUTO_MS);
    return () => clearTimeout(t);
  }, [k, auto, visible]);
  useEffect(() => { setBus({ tab: k }); }, [k]);
  const s = STEPS[k];
  const playing = auto && visible && !reduced();
  return (
    <section className="showcase reveal" id="apercu" aria-label="Aperçu de l’app" ref={ref}>
      <div className="showcase-head">
      <div className="tabs" role="tablist" aria-label="Étapes du travail">
        {STEPS.map((x, i) => (
          <button key={x.title} role="tab" id={`tab-${x.shot}`} aria-selected={i === k} aria-controls="showcase-panel" className={i === k ? 'is-on' : ''} onClick={() => { setK(i); setAuto(false); }}>
            {x.title}
            {i === k && playing && <span className="tab-progress" key={k} style={{ animationDuration: `${AUTO_MS}ms` }} aria-hidden="true" />}
          </button>
        ))}
      </div>
      </div>
      <div className="showcase-panel" id="showcase-panel" role="tabpanel" aria-labelledby={`tab-${s.shot}`}>
        <p className="showcase-text" key={s.shot}>{s.text}</p>
        <div className="shot-perch" data-perch="apercu">
        <div className="shot">
          {STEPS.map((x, i) => (
            <img key={x.shot} src={`/captures/${x.shot}.png`} alt={`Marginalia : ${x.title.toLowerCase()}`} className={i === k ? 'is-on' : ''} loading={i === 0 ? 'eager' : 'lazy'} width={1440} height={900} />
          ))}
        </div>
        </div>
      </div>
    </section>
  );
}

/** Apparition douce des blocs marqués .reveal quand ils entrent à l'écran (une seule fois). */
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.reveal'));
    if (reduced() || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('is-in')); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

const MORE: { icon: string; title: string; pose: Pose; line: string; items: string[] }[] = [
  {
    icon: 'book',
    title: 'Importer et lire',
    pose: 'read' as Pose,
    line: 'Ouvrez vos livres, et même une photo de page : je lis tout.',
    items: [
      'EPUB, PDF, Word, Markdown, texte, HTML',
      'Photos et scans : texte reconnu, sans connexion',
      'Synchronisation avec l’app Livres d’Apple (Mac)',
      'Depuis le téléphone : photo d’une page ou passage copié',
      'Défilement continu ou page par page, comme un livre',
      'Deux textes côte à côte',
      'Recherche, signets, aller à la page imprimée',
      'Reprise là où vous en étiez',
    ],
  },
  {
    icon: 'mark',
    title: 'Surligner et étudier',
    pose: 'paint' as Pose,
    line: 'Six couleurs pour six rôles : la thèse, l’objection, l’exemple…',
    items: [
      'Six catégories : problème, thèse, argument, thèse adverse, concept, exemple',
      'Notes sur chaque extrait',
      'Fiche-texte : problème, thèse, enjeu, mouvements',
      'Tous vos extraits, filtrés par livre, catégorie ou concept',
      'Citations prêtes à coller, avec auteur, édition et page',
    ],
  },
  {
    icon: 'map',
    title: 'Cartes pour organiser sa pensée',
    pose: 'geometry' as Pose,
    line: 'Mettez la question au centre et rangez vos idées autour.',
    items: [
      'Carte d’argument de chaque livre, cartes libres sur plusieurs livres',
      'Problématique ou sujet au centre, branches repliables',
      'Rangement en arbre, débat, chronologie ou étoile',
      'Zones, liens nommés, points à revoir signalés',
      'Le livre à côté : glissez un passage sur la carte',
      'Comparer deux auteurs, une carte par mouvement',
      'Présentation en plein écran, export image ou PDF',
      'Un plan ou une explication tirés de la carte',
    ],
  },
  {
    icon: 'cards',
    title: 'Concepts, arguments, révision',
    pose: 'question' as Pose,
    line: 'Ce qu’on revoit au bon moment ne s’oublie plus.',
    items: [
      'Lexique personnel : sens selon les auteurs, distinctions',
      'Notions et repères du programme de terminale',
      'Arguments reconstruits : prémisses, implicites, conclusion',
      'Révision espacée : définitions, thèses, textes à trous, citations',
    ],
  },
  {
    icon: 'doc',
    title: 'Plans et écriture',
    pose: 'write' as Pose,
    line: 'Le livre ouvert à côté, la plume à la main.',
    items: [
      'Plans de dissertation nourris de vos extraits et arguments',
      'Traitement de texte au format Word (.docx)',
      'Notes de bas de page, notes privées, commentaires en marge',
      'Le livre, les extraits ou le plan ouverts à côté de l’écrit',
      'Citer en écrivant : chaque citation reste reliée à son passage',
      'Correcteur orthographique, pinceau, plan déplaçable',
      'Mode concentration et machine à écrire',
      'Versions comparées mot à mot',
      'Export Word, PDF, page web, Markdown, mise en page comprise',
    ],
  },
  {
    icon: 'lock',
    title: 'Organiser et protéger',
    pose: 'herborize' as Pose,
    line: 'Tout reste chez vous. J’y tiens : moi, j’herborisais loin du monde.',
    items: [
      'Espaces de travail par cours ou dissertation, avec groupes',
      'Historique : revenir à l’état d’avant chaque action',
      'Corbeille de 30 jours',
      'Thèmes clair, sépia et sombre',
      'Tout en local ; chiffrement et verrouillage (mot de passe ou Touch ID) en option',
      'Un compagnon : Rousseau, Socrate, Platon, Aristote ou le cerveau',
    ],
  },
];

function Pict({ name }: { name: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const d: Record<string, JSX.Element> = {
    split: <><rect x="3" y="5" width="8" height="14" rx="1" {...p} /><rect x="13" y="5" width="8" height="14" rx="1" {...p} /><path d="M5 9h4M5 12h4M15 9h4M15 12h3" {...p} /></>,
    cards: <><rect x="6" y="3.5" width="12" height="15" rx="1.5" {...p} transform="rotate(8 12 11)" /><rect x="5" y="5.5" width="12" height="15" rx="1.5" {...p} /><path d="M8 11h6M8 14h4" {...p} /></>,
    book: <><path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v13" {...p} /></>,
    phone: <><rect x="7" y="2.5" width="10" height="19" rx="2" {...p} /><path d="M10.5 18.5h3" {...p} /><path d="M10 9l2 2 2-2M12 6v5" {...p} /></>,
    mark: <><path d="M4 20h16" {...p} /><path d="M14.5 4.5l5 5L10 19H5v-5z" {...p} /><path d="M12.5 6.5l5 5" {...p} /></>,
    map: <><circle cx="12" cy="12" r="2.6" {...p} /><circle cx="4.5" cy="6" r="1.8" {...p} /><circle cx="19.5" cy="6" r="1.8" {...p} /><circle cx="5" cy="18.5" r="1.8" {...p} /><circle cx="19" cy="18.5" r="1.8" {...p} /><path d="M6 7.2l4 3M18 7.2l-4 3M6.4 17.3l3.6-3.4M17.6 17.3L14 13.9" {...p} /></>,
    lock: <><rect x="5" y="10.5" width="14" height="10" rx="1.6" {...p} /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5" {...p} /></>,
    doc: <><path d="M6 3h8l4 4v14H6z" {...p} /><path d="M14 3v4h4M9 12h6M9 15h6M9 18h3" {...p} /></>,
    figure: <><circle cx="12" cy="7" r="3.2" {...p} /><path d="M6.5 21c.5-4.5 2.5-7 5.5-7s5 2.5 5.5 7" {...p} /><path d="M8.6 6.2c-1.4-.2-1.8 1.4-.6 2M15.4 6.2c1.4-.2 1.8 1.4.6 2" {...p} /></>,
  };
  return <svg className="pict" viewBox="0 0 24 24" aria-hidden="true">{d[name]}</svg>;
}

/** Toutes les fonctions, présentées par Rousseau : il change d'activité selon le groupe lu ou survolé. */
function Features({ travel }: { travel: boolean }) {
  const [row, setRow] = useState(0);
  const [side, setSide] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const refs = useRef<(HTMLElement | null)[]>([]);
  // rangée lue : la dernière dont le haut a passé le tiers de l'écran
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const line = window.innerHeight * 0.38;
      let r = 0;
      refs.current.forEach((el, i) => { if (el && el.getBoundingClientRect().top < line) r = Math.max(r, Math.floor(i / 2)); });
      setRow(r);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);
  // les deux groupes de la rangée, à tour de rôle
  useEffect(() => { setSide(0); }, [row]);
  useEffect(() => {
    if (hover !== null) return;
    const t = setTimeout(() => setSide((x) => 1 - x), 5500);
    return () => clearTimeout(t);
  }, [side, row, hover]);
  const active = Math.min(MORE.length - 1, row * 2 + side);
  const k = hover ?? active;
  const m = MORE[k];
  const b = useBus();
  useEffect(() => { setBus({ group: k }); }, [k]);
  const here = !travel || b.at === 'fonctions';
  return (
    <section className="more reveal" id="fonctions" aria-labelledby="more-title">
      <h2 id="more-title">Toutes les fonctions</h2>
      <div className="more-layout">
        <aside className="presenter" aria-hidden="true">
          <div className="presenter-inner">
            <p className={`bubble ${here ? '' : 'is-away'}`} key={k}>{m.line}</p>
            {travel ? (
              <div className="presenter-slot" data-perch="fonctions" style={{ width: `${ROUSSEAU_SIZE / 16}rem`, height: `${((ROUSSEAU_SIZE * VB_H) / VB_W) / 16}rem` }} />
            ) : (
              <Rousseau className="presenter-rousseau" size={ROUSSEAU_SIZE} seat seq={[[m.pose, 600000]]} />
            )}
          </div>
        </aside>
        <div className="more-grid">
          {MORE.map((g, i) => (
            <section
              key={g.title}
              ref={(el) => { refs.current[i] = el; }}
              className={`more-group ${i === k ? 'is-on' : ''}`}
              aria-label={g.title}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <Pict name={g.icon} />
              <h3>{g.title}</h3>
              <ul>
                {g.items.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

function App() {
  useReveal();
  const travel = useTravel();
  const os = useOs();
  const mine = DOWNLOADS.filter((d) => d.os === (os ?? 'mac'));
  return (
    <>
      <header className="top">
        <a className="brand" href="#">
          <img src="/icon.png" alt="" width={28} height={28} /> Marginalia
        </a>
        <nav className="top-nav" aria-label="Sections">
          <a href="#apercu">Aperçu</a>
          <a href="#fonctions">Fonctions</a>
          <a className="btn btn-primary" href="#telecharger">Télécharger</a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-text">
            <h1>Marginalia</h1>
            <p className="lede">Lire, annoter et écrire la philosophie. Une app pour Mac et Windows, gratuite, sans compte&nbsp;: tout reste sur votre ordinateur.</p>
            <div className="hero-dl">
              <DownloadButton d={mine[0]} />
              <div className="hero-dl-links">
                <span className="btn-note">{mine[0].label}, {mine[0].size}</span>
                <a className="other" href="#telecharger">
                  {os === 'win' ? 'Mac, ou autre version de Windows' : os === 'mac' ? 'Mac Intel ou Windows' : 'Toutes les versions'}
                </a>
              </div>
            </div>
          </div>
          <AnnotatedPage travel={travel} />
        </section>

        <Showcase />

        <section className="cote reveal" aria-labelledby="cote-title">
          <div className="cote-text">
            <h2 id="cote-title">Écrire, le livre ouvert à côté</h2>
            <p>
              Pendant que vous écrivez, ouvrez à côté le vrai livre, vos extraits, vos concepts ou votre plan. Sélectionnez un passage et
              citez-le : la citation reste reliée à sa page, et un ⌘-clic dessus vous y ramène.
            </p>
            <p>Le partage de l’écran se règle à la souris, ou d’un clic en deux moitiés égales.</p>
          </div>
          <div className="shot-wrap" data-perch="cote">
            <img className="cote-shot" src="/captures/cote.png" alt="Une dissertation dans l’éditeur, le Discours de la méthode ouvert à côté" width={1440} height={900} loading="lazy" />
          </div>
        </section>

        <section className="spaces reveal" aria-labelledby="spaces-title">
          <div className="shot-wrap" data-perch="espaces">
            <img className="spaces-shot" src="/captures/espaces.png" alt="Un espace de travail « Dissertation : la liberté », avec ses livres, écrits, plans et cartes rangés en groupes" width={1440} height={900} loading="lazy" />
          </div>
          <div className="spaces-text">
            <h2 id="spaces-title">Un espace par cours, par dissertation</h2>
            <p>
              Réunissez dans un espace de travail tout ce qui sert à un même travail : livres, écrits, plans, arguments, cartes et
              fiches. Rangez-les en groupes et sous-groupes, par glisser-déposer.
            </p>
            <p>Un même livre peut servir à plusieurs espaces sans être copié, et chaque espace affiche où vous en êtes : livres, extraits, cartes à réviser.</p>
          </div>
        </section>

        <section className="books reveal" aria-labelledby="books-title">
          <div className="books-text">
            <h2 id="books-title">Synchronisé avec l’app Livres</h2>
            <p>
              Sur Mac, vos EPUB et PDF de l’app Livres d’Apple arrivent dans Marginalia avec vos surlignages, vos notes, vos signets et
              l’endroit où vous en êtes. Chaque couleur de Livres devient une catégorie : le jaune une thèse, le vert un argument…
            </p>
            <p>Un livre ajouté sur votre iPhone ou votre iPad arrive tout seul. Rien n’est jamais modifié dans Livres.</p>
            <p className="books-note">Livres achetés avec protection (DRM) exclus.</p>
          </div>
          <div className="shot-wrap books-wrap" data-perch="livres">
          <img className="books-shot" src="/captures/livres.png" alt="La fenêtre Livres d’Apple de Marginalia : choix des livres et correspondance des couleurs" width={560} height={503} loading="lazy" />
          </div>
        </section>

        <Features travel={travel} />

        <section className="private reveal">
          <div>
            <h2>Rien ne quitte votre ordinateur</h2>
            <p>
              Pas de compte, pas de serveur, pas de publicité. Vos livres, vos notes et vos écrits restent dans le dossier de l’app ;
              l’app bloque toute connexion sortante. En option&nbsp;: chiffrement des données et verrouillage par mot de passe ou Touch ID.
            </p>
          </div>
        </section>

        <section className="download" id="telecharger">
          <h2>Télécharger Marginalia {VERSION}</h2>
          <div className="dl-groups" data-perch="telecharger">
            {(['mac', 'win'] as const).map((g) => (
              <div className={`dl-group ${os === g ? 'is-mine' : ''}`} key={g}>
                <h3>
                  <OsIcon os={g} /> {g === 'mac' ? 'Mac' : 'Windows'}
                  {os === g && <span className="mine">Votre ordinateur</span>}
                </h3>
                <ul className="dl-list">
                  {DOWNLOADS.filter((d) => d.os === g).map((d) => (
                    <li key={d.id}>
                      <span className="dl-row-text">
                        <span className="dl-row-name">{d.label}</span>
                        <span className="dl-row-detail">{d.detail}</span>
                      </span>
                      {d.url ? (
                        <a className="btn btn-primary" href={d.url}>
                          Télécharger <span className="dl-size">{d.size}</span>
                        </a>
                      ) : (
                        <span className="btn btn-quiet" aria-disabled="true">Bientôt</span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="which">
                  {g === 'mac'
                    ? 'Lequel choisir ? Menu Pomme › À propos de ce Mac : « Puce Apple M… » pour Apple Silicon, « Processeur Intel » pour Intel.'
                    : 'Lequel choisir ? Presque tous les PC sont « Windows ». Prenez « Windows ARM » seulement si Paramètres › Système › Informations système indique un processeur Snapdragon ou ARM.'}
                </p>
              </div>
            ))}
          </div>
          <details className="install">
            <summary>Premier lancement : l’app n’est pas signée</summary>
            <p>
              Marginalia n’a pas de certificat Apple ou Microsoft (payants) : le système demande une confirmation la première fois.
            </p>
            <p>
              <strong>Mac.</strong> Glissez Marginalia dans Applications, puis clic droit sur l’app › Ouvrir › Ouvrir. Sur macOS 15 et
              suivants : Réglages Système › Confidentialité et sécurité › Ouvrir quand même.
            </p>
            <p>
              <strong>Windows.</strong> Si « Windows a protégé votre ordinateur » s’affiche : Informations complémentaires › Exécuter quand
              même.
            </p>
          </details>
        </section>
      </main>

      {travel && <Traveler />}
      <footer className="foot">
        <p>Marginalia {VERSION}. Fait pour les élèves de terminale, les étudiants et tous les lecteurs de philosophie.</p>
      </footer>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
