// ─────────────────────────────────────────────────────────────
// Visite guidée : le compagnon choisi (cerveau, Socrate, Platon, Aristote, Rousseau) présente les
// outils un par un. Chaque étape ouvre la vue concernée et met en lumière son entrée dans
// l'interface ; « Suivant » / « Précédent » (← →, Entrée), « Passer » (Échap) arrête la visite.
// Lancée d'elle-même au tout premier lancement (nouvel utilisateur), sinon depuis l'Aide.
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { filesOpenedThisSession, useStore } from '../../lib/store';
import { host } from '../../lib/platform';
import { fmtKeys } from '../../lib/keys';
import type { Route } from '../../lib/types';
import { Sprite, type Pose } from '../mascot/Sprite';
import { extraPose } from '../mascot/activities';
import { CHARACTERS } from '../mascot/characters';
import { levelFor } from '../mascot/Mascot';
import './tour.css';

export interface TourStep {
  id: string;
  title: string;
  text: string;
  pose: Pose;
  /** Vue à ouvrir pour cette étape. */
  route?: Route;
  /** Élément mis en lumière (premier trouvé) ; absent ou introuvable : carte au centre. */
  target?: string[];
}

const nav = (label: string) => `.sidebar .nav-item[aria-label="${label}"]`;

export const TOUR: TourStep[] = [
  {
    id: 'bienvenue',
    title: 'Bienvenue dans Marginalia',
    text: 'Je vais vous montrer, en deux minutes, tout ce que l’app sait faire : lire, annoter, organiser sa pensée et écrire. Vous pouvez passer à tout moment.',
    pose: 'wave',
    route: { name: 'home' },
  },
  {
    id: 'bibliotheque',
    title: 'La bibliothèque',
    text: 'Tous vos textes : EPUB, PDF, Word, et même des photos de pages dont vous pouvez faire reconnaître le texte. Ouvrez un livre pour le lire, surligner en six couleurs et annoter dans la marge.',
    pose: 'read',
    route: { name: 'library' },
    target: [nav('Bibliothèque')],
  },
  {
    id: 'importer',
    title: 'Importer',
    text: 'Glissez des fichiers ou un dossier entier, ou envoyez depuis votre téléphone en scannant un QR code. Sur Mac, vos livres de l’app Livres peuvent aussi arriver ici.',
    pose: 'plane',
    route: { name: 'import' },
    target: ['.import-btn', '.rail-import'],
  },
  {
    id: 'extraits',
    title: 'Les extraits',
    text: 'Chaque passage surligné devient un extrait : problème, thèse, argument, thèse adverse, concept ou exemple. Retrouvez-les tous ici, filtrés par livre, catégorie ou concept, prêts à citer avec la page.',
    pose: 'paint',
    route: { name: 'extracts' },
    target: [nav('Extraits')],
  },
  {
    id: 'concepts',
    title: 'Les concepts',
    text: 'Votre lexique personnel : le sens d’un mot selon chaque auteur, les distinctions utiles, et les notions du programme prêtes à relier à vos lectures.',
    pose: 'question',
    route: { name: 'concepts', conceptId: null },
    target: [nav('Concepts')],
  },
  {
    id: 'arguments',
    title: 'Les arguments',
    text: 'Reconstruisez un raisonnement pas à pas : prémisses, implicites, conclusion. Idéal pour comprendre un texte difficile ou préparer une objection.',
    pose: 'think',
    route: { name: 'arguments', argumentId: null },
    target: [nav('Arguments')],
  },
  {
    id: 'cartes',
    title: 'Les cartes',
    text: 'Organisez votre pensée : la problématique au centre, vos idées et vos extraits autour, reliés entre eux. Une carte peut suivre un livre, ou rester libre, sans livre du tout.',
    pose: 'geometry',
    route: { name: 'maps' },
    target: [nav('Cartes')],
  },
  {
    id: 'plans',
    title: 'Les plans',
    text: 'Bâtissez le plan d’une dissertation à partir de vos extraits et de vos arguments, puis envoyez-le vers l’éditeur : titres et citations y sont déjà.',
    pose: 'classify',
    route: { name: 'plans', planId: null },
    target: [nav('Plans')],
  },
  {
    id: 'ecrits',
    title: 'Les écrits',
    text: 'Un traitement de texte au format Word, avec le livre ouvert à côté : chaque citation reste reliée à sa page. Notes de bas de page, versions, mode concentration, export Word ou PDF.',
    pose: 'write',
    route: { name: 'write', draftId: null },
    target: [nav('Écrits')],
  },
  {
    id: 'revision',
    title: 'La révision',
    text: 'Définitions, thèses, citations et textes à trous reviennent au bon moment, juste avant que vous les oubliiez.',
    pose: 'juggle',
    route: { name: 'revision' },
    target: [nav('Révision')],
  },
  {
    id: 'espaces',
    title: 'Les espaces de travail',
    text: 'Un espace par cours ou par dissertation : livres, écrits, cartes, plans et fiches rangés ensemble, en groupes. Créez-en un avec le « + ».',
    pose: 'herborize',
    route: { name: 'home' },
    target: ['.sidebar .ws-head', '.sidebar .ws-add'],
  },
  {
    id: 'recherche',
    title: 'Tout retrouver',
    text: fmtKeys('⌘K cherche partout : livres, extraits, concepts, plans, écrits, signets. Tapez quelques mots, Entrée vous y amène.'),
    pose: 'spyglass',
    target: [nav('Rechercher')],
  },
  {
    id: 'outils',
    title: 'Les outils du bas',
    text: 'L’historique pour revenir en arrière, la corbeille (30 jours), les réglages (confidentialité, chiffrement, compagnon) et l’aide, où vous pourrez relancer cette visite.',
    pose: 'coffee',
    target: ['.sidebar .sidebar-foot'],
  },
  {
    id: 'apparence',
    title: 'Clair, sépia ou sombre',
    text: 'Choisissez l’apparence qui repose vos yeux. Tout reste sur votre ordinateur : pas de compte, rien n’est envoyé.',
    pose: 'doze',
    target: ['.sidebar .appearance'],
  },
  {
    id: 'fin',
    title: 'À vous de jouer',
    text: 'Commencez par importer un premier texte. Je passerai de temps en temps sur l’interface ; cette visite reste dans l’Aide si vous voulez la revoir.',
    pose: 'wave',
    route: { name: 'home' },
  },
];

interface TourState {
  active: boolean;
  step: number;
}
export const useTour = create<TourState>(() => ({ active: false, step: 0 }));

/** Lance la visite (depuis l'Aide, « Quoi de neuf »…). */
export function startTour() {
  useTour.setState({ active: true, step: 0 });
}

function endTour() {
  useTour.setState({ active: false, step: 0 });
  useStore.getState().updateSettings({ tourDone: true });
}

/** Au tout premier lancement sur cet ordinateur : la visite démarre d'elle-même. */
export function useAutoTour() {
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    if (!ready || useStore.getState().settings.tourDone || !host.firstRun) return;
    let alive = true;
    let unsub: (() => void) | null = null;
    // Ouvert avec un fichier (double-clic sur un livre) : on ne l'interrompt pas ; la visite démarre
    // quand il revient à l'accueil.
    const atHome = () => useStore.getState().route.name === 'home' && !filesOpenedThisSession();
    const go = () => alive && !useStore.getState().settings.tourDone && !useTour.getState().active && startTour();
    void host.firstRun().then((first) => {
      if (!alive || !first || useStore.getState().settings.tourDone) return;
      setTimeout(() => {
        if (!alive) return;
        if (atHome()) return go();
        // Au retour à l'accueil, après un court instant : seulement s'il y est toujours (repassé par
        // l'accueil pour ouvrir aussitôt autre chose, il n'est pas ramené en arrière) ; sinon au retour suivant.
        const wait = () => {
          unsub = useStore.subscribe((s, prev) => {
            if (s.route.name === 'home' && prev.route.name !== 'home') {
              unsub?.();
              unsub = null;
              setTimeout(() => {
                if (!alive) return;
                if (useStore.getState().route.name === 'home') go();
                else wait();
              }, 600);
            }
          });
        };
        wait();
      }, 1500);
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [ready]);
}

// Images par seconde des poses de base (les activités ont les leurs).
const FPS: Partial<Record<Pose, number>> = { wave: 8, read: 4, think: 3, write: 4, doze: 2, stand: 2, sit: 4 };
const fpsOf = (p: Pose) => FPS[p] ?? extraPose(p)?.fps ?? 4;

function useFrames(pose: Pose) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setFrame((f) => f + 1), 1000 / fpsOf(pose));
    return () => clearInterval(id);
  }, [pose]);
  return frame;
}

type Box = { x: number; y: number; w: number; h: number };
const PAD = 6;

function findTarget(sel?: string[]): HTMLElement | null {
  for (const s of sel ?? []) {
    const el = document.querySelector<HTMLElement>(s);
    if (el && el.getClientRects().length) return el;
  }
  return null;
}

export function TourLayer() {
  useAutoTour();
  const active = useTour((s) => s.active);
  if (!active) return null;
  return <TourOverlay />;
}

function TourOverlay() {
  const i = useTour((s) => s.step);
  const step = TOUR[i];
  const last = i === TOUR.length - 1;
  const [box, setBox] = useState<Box | null>(null);
  /** Étape pour laquelle la zone a été mesurée : la carte attend la mesure de la nouvelle étape. */
  const [measuredFor, setMeasuredFor] = useState<string | null>(null);
  const [card, setCard] = useState<{ left: number; top: number } | null>(null);
  const [tick, setTick] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const charId = useStore((s) => s.settings.mascotCharacter ?? 'brain');
  const docs = useStore((s) => s.books.length + s.drafts.length);
  const frame = useFrames(step.pose);
  const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';

  const go = useCallback((n: number) => useTour.setState({ step: Math.max(0, Math.min(TOUR.length - 1, n)) }), []);
  const next = useCallback(() => (last ? endTour() : go(i + 1)), [last, go, i]);
  const prev = useCallback(() => go(i - 1), [go, i]);

  // Ouvre la vue de l'étape.
  useEffect(() => {
    if (!step.route) return;
    const cur = useStore.getState().route;
    if (cur.name !== step.route.name) useStore.getState().navigate(step.route);
  }, [step]);

  // Mesure de l'élément mis en lumière (après rendu de la vue), et à chaque redimensionnement.
  // La zone de l'étape précédente reste affichée pendant que la nouvelle vue se met en place : elle
  // glisse ensuite de l'ancienne cible à la nouvelle (transition CSS), sans repartir du haut de l'écran.
  // Une cible pas encore posée (taille nulle, vue en cours d'ouverture) est ignorée jusqu'à la mesure suivante.
  const measure = useCallback(() => {
    setTick((t) => t + 1);
    const el = findTarget(step.target);
    if (!el) {
      if (!step.target) {
        setBox(null);
        setMeasuredFor(step.id);
      }
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const nb = { x: r.left - PAD, y: r.top - PAD, w: r.width + 2 * PAD, h: r.height + 2 * PAD };
    setBox((b) => (b && Math.abs(b.x - nb.x) < 0.5 && Math.abs(b.y - nb.y) < 0.5 && Math.abs(b.w - nb.w) < 0.5 && Math.abs(b.h - nb.h) < 0.5 ? b : nb));
    setMeasuredFor(step.id);
  }, [step]);
  useEffect(() => {
    const ts = [0, 60, 160, 350, 700].map((ms) => setTimeout(measure, ms));
    // Cible introuvable après coup (vue sans cet élément) : voile plein plutôt qu'une zone périmée.
    const giveUp = setTimeout(() => {
      if (!findTarget(step.target)) {
        setBox(null);
        setMeasuredFor(step.id);
      }
    }, 900);
    window.addEventListener('resize', measure);
    return () => {
      ts.forEach(clearTimeout);
      clearTimeout(giveUp);
      window.removeEventListener('resize', measure);
    };
  }, [measure, step]);
  const placed = measuredFor === step.id;

  // Place la carte à côté de la zone (à droite de la barre latérale, sinon dessous / dessus), dans l'écran.
  useLayoutEffect(() => {
    const c = cardRef.current;
    if (!c || !placed) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = c.offsetWidth;
    const h = c.offsetHeight;
    let left: number;
    let top: number;
    if (!box) {
      left = (vw - w) / 2;
      top = (vh - h) / 2;
    } else if (box.x + box.w + 24 + w <= vw - 16) {
      left = box.x + box.w + 24;
      top = box.y + box.h / 2 - h / 2;
    } else if (box.y + box.h + 16 + h <= vh - 16) {
      left = box.x + box.w / 2 - w / 2;
      top = box.y + box.h + 16;
    } else {
      left = box.x + box.w / 2 - w / 2;
      top = box.y - 16 - h;
    }
    setCard({ left: Math.max(16, Math.min(vw - w - 16, left)), top: Math.max(16, Math.min(vh - h - 16, top)) });
  }, [box, i, tick, placed]);

  // Clavier : → / Entrée suivant, ← précédent, Échap passer. Focus sur « Suivant ».
  useEffect(() => {
    nextBtn.current?.focus({ preventScroll: true });
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endTour();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [next, prev, i]);

  return createPortal(
    <div className="tour" data-testid="tour" data-step={step.id}>
      {/* Voile : un trou autour de la zone mise en lumière (ou voile plein). Les clics ne passent pas. */}
      {box ? (
        <div className="tour-hole" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} aria-hidden="true" />
      ) : (
        <div className="tour-veil" aria-hidden="true" />
      )}
      <div className="tour-block" aria-hidden="true" />
      <div
        ref={cardRef}
        className={`tour-card ${card && placed ? 'is-placed' : ''}`}
        style={card && placed ? { left: card.left, top: card.top } : { left: -9999, top: 0 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        key={step.id}
      >
        <div className="tour-mascot" aria-hidden="true">
          <Sprite pose={step.pose} frame={frame} level={levelFor(docs)} character={CHARACTERS[charId]} halo={dark ? '#e9dfcc' : undefined} night={dark} />
        </div>
        <div className="tour-body">
          <p className="tour-count">
            {i + 1} / {TOUR.length}
          </p>
          <h2 id="tour-title">{step.title}</h2>
          <p id="tour-text">{step.text}</p>
          <div className="tour-dots" aria-hidden="true">
            {TOUR.map((s, k) => (
              <span key={s.id} className={k === i ? 'on' : k < i ? 'done' : ''} />
            ))}
          </div>
          <div className="tour-actions">
            {!last && (
              <button className="btn btn-ghost btn-sm tour-skip" onClick={endTour}>
                Passer le tutoriel
              </button>
            )}
            <span className="spacer" />
            {i > 0 && (
              <button className="btn btn-sm" onClick={prev}>
                Précédent
              </button>
            )}
            <button ref={nextBtn} className="btn btn-primary btn-sm" onClick={next} data-testid="tour-next">
              {last ? 'Terminer' : i === 0 ? 'Commencer' : 'Suivant'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
