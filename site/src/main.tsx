import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Sprite, anchorOf, isSeated, VB_H, VB_W, type Pose } from '../../src/features/mascot/Sprite';
import { extraPose } from '../../src/features/mascot/activities';
import { rousseau } from '../../src/features/mascot/characters/rousseau';
import { socrate } from '../../src/features/mascot/characters/socrate';
import { platon } from '../../src/features/mascot/characters/platon';
import { aristote } from '../../src/features/mascot/characters/aristote';
import type { CharacterDef } from '../../src/features/mascot/characters/types';
import { DOWNLOADS, VERSION, type Download } from './downloads';
import './site.css';

// Cadence de chaque pose (images par seconde), comme dans l'app ; activités : leur propre cadence.
const FPS: Partial<Record<string, number>> = { guitar: 6, flex: 6, puff: 10, sitwave: 8, read: 4, wave: 8, write: 4, think: 3, jump: 8, walk: 8, doze: 2 };
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

function Rousseau({ seq, size, className, poke, facing, seat, character = rousseau }: { seq: [Pose, number][]; size: number; className?: string; poke?: boolean; facing?: 1 | -1; seat?: boolean; character?: CharacterDef }) {
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
      <Sprite pose={pose} frame={frame} level={2} character={character} facing={facing} />
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
  ensemble: { side: 'right', inset: 2.5, seq: () => [['wave', 3200], ['think', 5000]] },
  cote: { side: 'right', inset: 2.5, seq: () => [['question', 4500], ['wave', 2500]] },
  photo: { side: 'right', inset: 2.5, seq: () => [['guitar', 7000], ['coffee', 6000]] },
  carte: { side: 'right', inset: 2.5, seq: () => [['classify', 600000]] },
  espaces: { side: 'right', inset: 2, seq: () => [['juggle', 600000]] },
  livres: { side: 'right', inset: 2, seq: () => [['plane', 600000]] },
  qr: { side: 'right', inset: 2.5, seq: () => [['spyglass', 600000]] },
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

/** Système du visiteur ; 'phone' : téléphone ou tablette (l'app s'installe sur un ordinateur). */
function useOs(): 'mac' | 'win' | 'phone' | null {
  const [os, setOs] = useState<'mac' | 'win' | 'phone' | null>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    // iPadOS se présente comme un Mac : on le reconnaît à l'écran tactile.
    const touchMac = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
    if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua) || touchMac) setOs('phone');
    else setOs(/Mac/i.test(ua) ? 'mac' : /Windows/i.test(ua) ? 'win' : null);
  }, []);
  return os;
}

/** Sur téléphone : l'app est pour ordinateur ; on propose de s'envoyer le lien. */
function PhoneNote({ compact }: { compact?: boolean }) {
  const [done, setDone] = useState<string | null>(null);
  const send = async () => {
    const url = location.origin + '/#telecharger';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Marginalia', text: 'Marginalia, pour Mac et Windows', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setDone('Lien copié');
    } catch {
      /* partage annulé */
    }
  };
  return (
    <div className={`phone-note${compact ? ' is-compact' : ''}`}>
      <span className="phone-note-os" aria-hidden="true">
        <OsIcon os="mac" />
        <OsIcon os="win" />
      </span>
      <p>
        <strong>Une app pour ordinateur, Mac ou Windows.</strong> Ouvrez cette page sur votre ordinateur pour l’installer ; le téléphone sert ensuite à y envoyer des photos de pages.
      </p>
      <button type="button" className="btn btn-primary" onClick={() => void send()}>
        {done ?? 'M’envoyer le lien'}
      </button>
    </div>
  );
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
    text: 'EPUB, PDF, Word ou Markdown, deux textes côte à côte. Surlignez en six couleurs : problème, thèse, argument, thèse adverse, concept, exemple.',
    shot: 'lire',
  },
  {
    title: 'Comprendre',
    text: 'Vos surlignages dessinent le raisonnement de l’auteur sur une carte, et deviennent des fiches prêtes à réviser.',
    shot: 'comprendre',
  },
  {
    title: 'Écrire',
    text: 'Du plan au texte rédigé, au format Word, avec notes de bas de page. Export Word, PDF, page web ou Markdown.',
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
/**
 * Apparition au défilement, élément par élément : titres, paragraphes, lignes de liste et captures
 * arrivent l'un après l'autre (en cascade quand plusieurs entrent ensemble). Sur téléphone, où une
 * section est haute, chaque paragraphe apparaît ainsi au moment où on l'atteint.
 */
const RV_SEL = 'h2, h3, p, li, .shot-wrap, .photo-card, .pict, .dl-group';
function useReveal() {
  useEffect(() => {
    const all = Array.from(document.querySelectorAll<HTMLElement>('.reveal')).flatMap((sec) => Array.from(sec.querySelectorAll<HTMLElement>(RV_SEL)));
    const set = new Set(all);
    // un élément contenu dans un autre élément animé suit son parent (ex. le titre d'une carte de la grille)
    const els = all.filter((el) => { if (el.closest('details')) return false; for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false; return true; });
    document.querySelectorAll('.reveal').forEach((s) => s.classList.add('rv-on'));
    if (reduced() || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('rv', 'is-in')); return; }
    els.forEach((e) => e.classList.add('rv'));
    const io = new IntersectionObserver((entries) => {
      const fresh = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
      fresh.sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top || x.getBoundingClientRect().left - y.getBoundingClientRect().left);
      fresh.forEach((el, i) => {
        el.style.transitionDelay = `${Math.min(i * 70, 420)}ms`;
        el.classList.add('is-in');
        io.unobserve(el);
        el.addEventListener('transitionend', () => { el.style.transitionDelay = ''; }, { once: true });
      });
    }, { threshold: 0.2, rootMargin: '0px 0px -6% 0px' });
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
      'Photos et scans : texte reconnu sans connexion',
      'Synchronisation avec l’app Livres (Mac)',
      'Depuis le téléphone par QR code, et retour en PDF ou Word',
      'Notes de Livres ou de Play Livres collées : un extrait par passage',
      'Continu ou page par page, deux textes côte à côte',
      'Recherche, signets, reprise là où vous en étiez',
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
      'Cartes libres, avec ou sans livre',
      'Carte d’argument de chaque livre',
      'Arbre, débat, chronologie ou étoile',
      'Un passage du livre glissé sur la carte',
      'Présentation en plein écran, export image ou PDF',
      'Un plan tiré de la carte',
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
      'Plans nourris de vos extraits et arguments',
      'Traitement de texte au format Word',
      'Notes de bas de page et commentaires en marge',
      'Citations reliées à leur passage',
      'Correcteur, mode concentration, versions comparées',
      'Export Word, PDF, page web, Markdown',
    ],
  },
  {
    icon: 'search',
    title: 'Retrouver, ne rien perdre',
    pose: 'herborize' as Pose,
    line: 'Rien ne se perd ici. J’aurais aimé ça pour mes manuscrits.',
    items: [
      'Recherche partout (⌘K)',
      'Historique, et corbeille de 30 jours',
      'Sauvegardes automatiques, et complètes en .zip',
      'Mises à jour installées quand vous le décidez',
      'Thèmes clair, sépia et sombre',
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
    offline: <><path d="M7 18.5h10.5a3.5 3.5 0 0 0 .6-6.95A5.5 5.5 0 0 0 7.6 10 4.25 4.25 0 0 0 7 18.5z" {...p} /><path d="M4 4l16 16" {...p} /></>,
    noacc: <><circle cx="12" cy="8" r="3.2" {...p} /><path d="M6 20c.4-3.8 2.6-6 6-6s5.6 2.2 6 6" {...p} /><path d="M4 4l16 16" {...p} /></>,
    scan: <><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" {...p} /><path d="M8 9.5h8M8 12.5h8M8 15.5h5" {...p} /></>,
    shield: <><path d="M12 3l7 2.8v5.4c0 4.4-2.9 8-7 9.8-4.1-1.8-7-5.4-7-9.8V5.8z" {...p} /><path d="M9 12l2.2 2.2L15.5 10" {...p} /></>,
    link: <><circle cx="6" cy="12" r="2.8" {...p} /><circle cx="18" cy="12" r="2.8" {...p} /><path d="M8.8 12h6.4" {...p} /><path d="M10.5 8.2l1.5-1.6 1.5 1.6M10.5 15.8l1.5 1.6 1.5-1.6" {...p} /></>,
    folder: <><path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" {...p} /><path d="M12 11v5M9.8 13.8L12 16l2.2-2.2" {...p} /></>,
    search: <><circle cx="10.5" cy="10.5" r="6" {...p} /><path d="M15 15l5 5" {...p} /></>,
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

// ── Travailler à plusieurs : la table des philosophes ──
const CREW: { who: string; color: string; character: CharacterDef; seq: [Pose, number][] }[] = [
  { who: 'Socrate', color: '#c2410c', character: socrate, seq: [['question', 5200], ['wave', 2600], ['stand', 1800]] },
  { who: 'Platon', color: '#1d4ed8', character: platon, seq: [['write', 600000]] },
  { who: 'Aristote', color: '#15803d', character: aristote, seq: [['read', 600000]] },
];

/** La collaboration filmée chez Marc (scripts/video-collab.mjs) : lue en boucle, sans son, seulement quand elle est
 *  à l'écran ; mouvement réduit : pas de lecture automatique, l'affiche et les contrôles. */
function TogetherVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [still] = useState(reduced);
  useEffect(() => {
    const v = ref.current;
    if (!v || still || typeof IntersectionObserver !== 'function') return;
    v.muted = true; // lecture automatique permise : vidéo muette
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.25 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [still]);
  return (
    <video
      ref={ref}
      className="together-shot"
      width={1440}
      height={900}
      poster="/captures/ensemble-poster.jpg"
      autoPlay={!still}
      muted
      loop
      playsInline
      preload="metadata"
      controls={still}
      aria-label="Vidéo, vue depuis l’écran de Marc dans l’espace partagé « Parjure » : le pointeur de Léa déplace une carte, entourée de sa couleur, pendant que celui d’Inès bouge aussi ; puis Léa écrit une phrase qui apparaît lettre à lettre, et sélectionne un passage du Discours de la méthode, teinté à sa couleur avec son prénom"
    >
      <source src="/captures/ensemble.webm" type="video/webm" />
      <source src="/captures/ensemble.mp4" type="video/mp4" />
    </video>
  );
}

function Together() {
  return (
    <section className="together reveal" id="ensemble" aria-labelledby="together-title">
      <div className="together-text">
        <h2 id="together-title">À plusieurs, sur le même travail</h2>
        <p>
          Un exposé, un mémoire à deux&nbsp;: «&nbsp;Partager › Travailler ensemble&nbsp;». Les autres tapent le code à six chiffres,
          et l’espace arrive chez eux, livres, écrits et cartes compris.
        </p>
        <p>Chacun a sa couleur. Une phrase tapée chez l’un apparaît aussitôt chez tous.</p>
      </div>
      <div className="together-stage">
        <div className="shot-wrap" data-perch="ensemble">
          <TogetherVideo />
        </div>
        <img className="together-card" src="/captures/ensemble-code.png" alt="La fenêtre « Travailler à plusieurs » : le code 254-506 et « Copier le code », quatre places, et les cases de ce que les invités peuvent modifier" width={640} height={688} loading="lazy" />
        <ul className="crew" aria-label="Trois philosophes travaillent ensemble : l’un discute, l’autre écrit, le troisième lit">
          {CREW.map((c) => (
            <li key={c.who} className="crew-one" style={{ ['--who' as string]: c.color }}>
              <span className="crew-tag" aria-hidden="true">
                <svg viewBox="0 0 12 14" width="12" height="14"><path d="M1 1 L1 12 L4 9 L6.5 13.2 L8.3 12.3 L5.9 8.3 L10.5 8.3 Z" fill="var(--who)" stroke="#fff" strokeWidth="1.1" strokeLinejoin="round" /></svg>
                <span>{c.who}</span>
              </span>
              <Rousseau seq={c.seq} size={92} className="crew-rousseau" character={c.character} seat />
            </li>
          ))}
        </ul>
      </div>
      <ul className="together-points">
        <li>
          <h3>Jusqu’à six, en direct</h3>
          <p>L’hôte accepte chaque arrivée et coche ce que les autres peuvent modifier. Le reste, ils le lisent.</p>
        </li>
        <li>
          <h3>Sans serveur, même à distance</h3>
          <p>Sur le même Wi-Fi ou par Internet, vos ordinateurs se parlent directement, chiffrés de bout en bout. Le point de rencontre change toutes les 10 minutes&nbsp;: vos sessions restent privées.</p>
        </li>
        <li>
          <h3>Chacun garde son exemplaire</h3>
          <p>Après la session, chacun continue de son côté. À la suivante, vous choisissez entre les deux versions d’une phrase.</p>
        </li>
      </ul>
      <p className="together-copy">
        Juste donner une copie&nbsp;? «&nbsp;Envoyer une copie&nbsp;» la transmet avec un code valable deux minutes, ou dans un fichier <span className="nowrap">.marginalia</span>.
      </p>
    </section>
  );
}

const PRIVACY = [
  { icon: 'offline', title: 'Hors ligne, par construction', text: 'Trois connexions seulement, que vous pouvez couper : chercher une mise à jour (téléchargée si vous le voulez), retrouver l’édition d’un livre papier, travailler à plusieurs.' },
  { icon: 'link', title: 'À plusieurs, sans serveur', text: 'Vos ordinateurs se parlent directement, chiffrés de bout en bout. Le point de rencontre change toutes les 10 minutes, et l’hôte accepte chaque arrivée.' },
  { icon: 'noacc', title: 'Ni compte, ni pistage', text: 'Pas d’inscription, pas de publicité, pas de statistiques. Personne ne sait ce que vous lisez.' },
  { icon: 'scan', title: 'Le texte des photos, lu chez vous', text: 'La reconnaissance de texte tourne sur votre ordinateur : vos photos et vos scans ne partent nulle part.' },
  { icon: 'lock', title: 'Chiffré et verrouillé', text: 'En option : données chiffrées (AES-256), mot de passe ou Touch ID, verrouillage à la mise en veille.' },
  { icon: 'folder', title: 'Vos fichiers, vos sauvegardes', text: 'Tout reste dans un dossier de votre ordinateur. Une sauvegarde complète tient dans un .zip.' },
];

/** Confidentialité : ce que l'app garantit (vérifié dans electron/main.cjs, vault.cjs, ocr.ts). */
function Privacy() {
  return (
    <section className="private reveal" id="confidentialite" aria-labelledby="private-title">
      <div className="private-head">
        <p className="eyebrow"><Pict name="lock" /> Confidentialité</p>
        <h2 id="private-title">Rien ne quitte votre ordinateur</h2>
        <p className="private-lede">Marginalia tourne entièrement sur votre ordinateur. Pas de serveur&nbsp;: rien à envoyer, rien à fuiter.</p>
      </div>
      <ul className="private-grid">
        {PRIVACY.map((x) => (
          <li key={x.title}>
            <Pict name={x.icon} />
            <h3>{x.title}</h3>
            <p>{x.text}</p>
          </li>
        ))}
      </ul>
      <p className="private-note">
        Le code de l’app est public&nbsp;: chacun peut <a href="https://github.com/FavveyAxel/marginalia">vérifier ce qu’elle fait</a>.
      </p>
    </section>
  );
}

function App() {
  useReveal();
  const travel = useTravel();
  const os = useOs();
  const phone = os === 'phone';
  const mine = DOWNLOADS.filter((d) => d.os === (os === 'win' ? 'win' : 'mac'));
  // Barre du haut collée en haut : un filet apparaît dès qu'on a défilé.
  const [scrolled, setScrolled] = useState(false);
  const topRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const f = () => {
      setScrolled(window.scrollY > 8);
      topRef.current?.style.setProperty('--top-p', String(Math.min(1, Math.max(0, window.scrollY / 140)).toFixed(3)));
    };
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  return (
    <>
      <header ref={topRef} className={`top${scrolled ? ' is-scrolled' : ''}`}>
        <a className="brand" href="#">
          <img src="/icon.png" alt="" width={28} height={28} /> Marginalia
        </a>
        <nav className="top-nav" aria-label="Sections">
          <a href="#apercu">Aperçu</a>
          <a href="#ensemble">À plusieurs</a>
          <a href="#fonctions">Fonctions</a>
          <a href="#confidentialite">Confidentialité</a>
          <a className="btn btn-primary" href="#telecharger">{phone ? 'Mac et Windows' : 'Télécharger'}</a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-text">
            <h1>Marginalia</h1>
            <p className="lede">Lire, annoter et écrire la philosophie. Une app pour Mac et Windows, gratuite, sans compte&nbsp;: tout reste sur votre ordinateur.</p>
            {phone ? (
              <PhoneNote />
            ) : (
            <div className="hero-dl">
              <DownloadButton d={mine[0]} />
              <div className="hero-dl-links">
                <span className="btn-note">{mine[0].label}, {mine[0].size}</span>
                <a className="other" href="#telecharger">
                  {os === 'win' ? 'Mac, ou autre version de Windows' : os === 'mac' ? 'Mac Intel ou Windows' : 'Toutes les versions'}
                </a>
              </div>
            </div>
            )}
            <p className="hero-trust">
              <Pict name="lock" />
              <span><a href="#confidentialite">La confidentialité d’abord</a>&nbsp;: hors ligne, sans compte, sans serveur.</span>
            </p>
          </div>
          <AnnotatedPage travel={travel} />
        </section>

        <Showcase />

        <Together />

        <section className="cote reveal" aria-labelledby="cote-title">
          <div className="cote-text">
            <h2 id="cote-title">Écrire, le livre ouvert à côté</h2>
            <p>Le livre, vos extraits ou votre plan, ouverts à côté de l’écrit. Une citation reste reliée à sa page&nbsp;: un ⌘-clic vous y ramène.</p>
          </div>
          <div className="shot-wrap" data-perch="cote">
            <img className="cote-shot" src="/captures/cote.png" alt="Une dissertation dans l’éditeur, le Discours de la méthode ouvert à côté" width={1440} height={900} loading="lazy" />
          </div>
        </section>

        <section className="photo reveal" aria-labelledby="photo-title">
          <div className="photo-text">
            <h2 id="photo-title">Une photo, et le texte est là</h2>
            <p>Photo ou scan&nbsp;: Marginalia en reconnaît le texte, sur votre ordinateur, sans connexion. Vous le surlignez comme dans un livre.</p>
            <p>Depuis le téléphone, un QR code suffit. Le passage est retrouvé dans vos livres et ajouté en extrait.</p>
          </div>
          <div className="photo-stack">
            <div className="shot-wrap" data-perch="photo">
              <img className="photo-shot" src="/captures/photo-texte.png" alt="Une photo de page dans Marginalia : un passage surligné, et le texte reconnu ligne par ligne" width={1440} height={900} loading="lazy" />
            </div>
            <img className="photo-card" src="/captures/photo-telephone.png" alt="Une photo reçue du téléphone : le texte lu, le passage retrouvé dans le Discours de la méthode, et les boutons Ajouter comme extrait et Créer un écrit" width={760} height={605} loading="lazy" />
          </div>
        </section>

        <section className="carte reveal" id="carte" aria-labelledby="carte-title">
          <div className="carte-text">
            <h2 id="carte-title">Mettre ses idées à plat</h2>
            <p>Votre problématique au centre, vos idées autour, comme sur un tableau blanc. Reliez, regroupez, repliez. Quand tout est en place, tirez-en un plan.</p>
          </div>
          <div className="shot-wrap" data-perch="carte">
            <img className="carte-shot" src="/captures/carte.png" alt="Une carte mentale libre « Idées pour le mémoire » : la problématique sur le télétravail au centre, quatre branches en couleur et une zone « À faire en mars »" width={1440} height={900} loading="lazy" />
          </div>
        </section>

        <section className="spaces reveal" aria-labelledby="spaces-title">
          <div className="shot-wrap" data-perch="espaces">
            <img className="spaces-shot" src="/captures/espaces.png" alt="Un espace de travail « Dissertation : la liberté », avec ses livres, écrits, plans et cartes rangés en groupes" width={1440} height={900} loading="lazy" />
          </div>
          <div className="spaces-text">
            <h2 id="spaces-title">Un espace par cours, par dissertation</h2>
            <p>Livres, écrits, plans et cartes d’un même travail, réunis et rangés en groupes. Un livre sert à plusieurs espaces sans être copié.</p>
          </div>
        </section>

        <section className="books reveal" aria-labelledby="books-title">
          <div className="books-text">
            <h2 id="books-title">Synchronisé avec l’app Livres</h2>
            <p>Sur Mac, vos EPUB et PDF de Livres arrivent avec vos surlignages, vos notes et vos signets. Chaque couleur devient une catégorie. Rien n’est modifié dans Livres.</p>
            <p className="books-note">Livres achetés avec protection (DRM) exclus.</p>
          </div>
          <div className="shot-wrap books-wrap" data-perch="livres">
          <img className="books-shot" src="/captures/livres.png" alt="La fenêtre Livres d’Apple de Marginalia : choix des livres et correspondance des couleurs" width={560} height={503} loading="lazy" />
          </div>
        </section>

        <section className="qr reveal" id="qr" aria-labelledby="qr-title">
          <div className="qr-stack">
            <div className="shot-wrap" data-perch="qr">
              <img className="qr-shot" src="/captures/qr-app.png" alt="La fenêtre « Recevoir depuis le téléphone » de Marginalia : un QR code, l’iPhone connecté, et pour chaque envoi ce qu’il est devenu" width={1280} height={1152} loading="lazy" />
            </div>
            <img className="qr-phone" src="/captures/qr-telephone.png" alt="La page « Envoyer à l’ordinateur » sur l’iPhone : prendre une photo, choisir des fichiers, coller du texte, et les envois reçus" width={780} height={1688} loading="lazy" />
          </div>
          <div className="qr-text">
            <h2 id="qr-title">Du téléphone à l’ordinateur, par un QR code</h2>
            <p>«&nbsp;Importer&nbsp;» affiche un QR code. Scannez-le avec votre téléphone, sans rien installer, et envoyez une photo de page, un PDF, un EPUB ou vos notes.</p>
            <p>Et dans l’autre sens, un écrit se télécharge sur le téléphone, en PDF ou en Word.</p>
            <p className="qr-note">Par le Wi-Fi de la maison, sans compte&nbsp;: rien ne passe par Internet.</p>
          </div>
        </section>

        <Features travel={travel} />

        <Privacy />

        <section className="download reveal" id="telecharger">
          <h2>Télécharger Marginalia {VERSION}</h2>
          {phone && <PhoneNote compact />}
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
