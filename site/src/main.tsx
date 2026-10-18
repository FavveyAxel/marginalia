import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sprite, anchorOf, VB_H, VB_W, type Pose } from '../../src/features/mascot/Sprite';
import { extraPose } from '../../src/features/mascot/activities';
import { rousseau } from '../../src/features/mascot/characters/rousseau';
import { DOWNLOADS, VERSION, type Download } from './downloads';
import './site.css';

// Cadence de chaque pose (images par seconde), comme dans l'app ; activités : leur propre cadence.
const FPS: Partial<Record<string, number>> = { sitwave: 8, read: 4, wave: 8, write: 4, think: 3, jump: 8, walk: 8, doze: 2 };
const fpsOf = (p: Pose) => FPS[p] ?? extraPose(p)?.fps ?? 4;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Rousseau, dessiné et animé par le moteur de l'app. `seq` : activités jouées l'une après l'autre (ms).
 * `poke` : un clic le fait sauter puis passer à l'activité suivante.
 */
function Rousseau({ seq, size, className, poke, facing }: { seq: [Pose, number][]; size: number; className?: string; poke?: boolean; facing?: 1 | -1 }) {
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
  const sprite = <Sprite pose={pose} frame={frame} level={2} character={rousseau} facing={facing} />;
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

function useOs(): 'mac' | 'win' | null {
  const [os, setOs] = useState<'mac' | 'win' | null>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    setOs(/Mac/i.test(ua) && !/iPhone|iPad/i.test(ua) ? 'mac' : /Windows/i.test(ua) ? 'win' : null);
  }, []);
  return os;
}

/** Pictogrammes neutres : un portable (Mac) et un écran de bureau (Windows). */
function OsIcon({ os }: { os: 'mac' | 'win' }) {
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
function AnnotatedPage() {
  const [hover, setHover] = useState<string | null>(null);
  let order = 0;
  const hl = (cat: string, label: string, text: string) => (
    <mark style={{ ['--i' as string]: order++ }} className={`hl hl-${cat}`} data-cat={label} onMouseEnter={() => setHover(label)} onMouseLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(label)} onBlur={() => setHover(null)}>
      {text}
    </mark>
  );
  return (
    <figure className="page" aria-label="Exemple : le début du Contrat social, annoté dans Marginalia">
      <Rousseau className="page-rousseau" size={150} poke seq={HERO_SEQ} />
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

const HERO_SEQ: [Pose, number][] = [['sitwave', 2600], ['read', 6500], ['write', 5500], ['question', 4000], ['coffee', 6000], ['spyglass', 4500], ['juggle', 5000], ['think', 3000]];
const TAB_SEQS: [Pose, number][][] = [[['read', 60000]], [['classify', 60000]], [['write', 60000]]];

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
      <Rousseau className="showcase-rousseau" size={92} seq={TAB_SEQS[k]} />
      </div>
      <div className="showcase-panel" id="showcase-panel" role="tabpanel" aria-labelledby={`tab-${s.shot}`}>
        <p className="showcase-text" key={s.shot}>{s.text}</p>
        <div className="shot">
          {STEPS.map((x, i) => (
            <img key={x.shot} src={`/captures/${x.shot}.png`} alt={`Marginalia : ${x.title.toLowerCase()}`} className={i === k ? 'is-on' : ''} loading={i === 0 ? 'eager' : 'lazy'} width={1440} height={900} />
          ))}
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

const MORE: { icon: string; title: string; items: string[] }[] = [
  {
    icon: 'book',
    title: 'Importer et lire',
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

function App() {
  useReveal();
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
          <AnnotatedPage />
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
          <div className="shot-wrap">
            <img className="cote-shot" src="/captures/cote.png" alt="Une dissertation dans l’éditeur, le Discours de la méthode ouvert à côté" width={1440} height={900} loading="lazy" />
            <Rousseau className="cote-rousseau" size={100} seq={[['write', 8000], ['read', 6000]]} />
          </div>
        </section>

        <section className="spaces reveal" aria-labelledby="spaces-title">
          <div className="shot-wrap">
            <img className="spaces-shot" src="/captures/espaces.png" alt="Un espace de travail « Dissertation : la liberté », avec ses livres, écrits, plans et cartes rangés en groupes" width={1440} height={900} loading="lazy" />
            <Rousseau className="spaces-rousseau" size={110} seq={[['juggle', 7000], ['classify', 6000]]} />
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
          <div className="shot-wrap books-wrap">
          <Rousseau className="books-rousseau" size={100} seq={[['plane', 6500], ['read', 5000]]} />
          <img className="books-shot" src="/captures/livres.png" alt="La fenêtre Livres d’Apple de Marginalia : choix des livres et correspondance des couleurs" width={560} height={503} loading="lazy" />
          </div>
        </section>

        <section className="more reveal" id="fonctions" aria-labelledby="more-title">
          <h2 id="more-title">Toutes les fonctions</h2>
          <div className="more-grid">
            {MORE.map((m) => (
              <section key={m.title} className="more-group" aria-label={m.title}>
                <Pict name={m.icon} />
                <h3>{m.title}</h3>
                <ul>
                  {m.items.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>

        <section className="private reveal">
          <Rousseau className="private-rousseau" size={150} seq={[['herborize', 9000], ['meditate', 7000]]} />
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
          <div className="dl-groups">
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

      <div className="walker" aria-hidden="true">
        <Rousseau className="walker-rousseau" size={70} seq={[['walk', 60000]]} />
      </div>
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
