import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sprite, anchorOf, VB_H, VB_W, type Pose } from '../../src/features/mascot/Sprite';
import { rousseau } from '../../src/features/mascot/characters/rousseau';
import { DOWNLOADS, VERSION, type Download } from './downloads';
import './site.css';

// Cadence de chaque pose (images par seconde), comme dans l'app.
const FPS: Partial<Record<string, number>> = { sitwave: 8, read: 4, herborize: 4, wave: 8, write: 4, think: 3 };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Rousseau, dessiné et animé par le moteur de l'app. `seq` : poses jouées l'une après l'autre (ms). */
function Rousseau({ seq, size, className }: { seq: [Pose, number][]; size: number; className?: string }) {
  const [i, setI] = useState(0);
  const [frame, setFrame] = useState(0);
  const pose = seq[i % seq.length][0];
  useEffect(() => {
    if (reduced()) return;
    const t = setInterval(() => setFrame((f) => f + 1), 1000 / (FPS[pose] ?? 4));
    return () => clearInterval(t);
  }, [pose]);
  useEffect(() => {
    if (seq.length < 2 || reduced()) return;
    const t = setTimeout(() => { setI((x) => x + 1); setFrame(0); }, seq[i % seq.length][1]);
    return () => clearTimeout(t);
  }, [i, seq]);
  const h = (size * VB_H) / VB_W;
  return (
    <span className={className} style={{ width: size, height: h, ['--anchor' as string]: `${(anchorOf(pose) / VB_H) * h}px` }} aria-hidden="true">
      <Sprite pose={pose} frame={frame} level={2} character={rousseau} />
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

function DownloadButton({ d, main }: { d: Download; main?: boolean }) {
  if (!d.url)
    return (
      <span className={`dl ${main ? 'dl-main' : ''} is-soon`} aria-disabled="true">
        <span className="dl-label"><OsIcon os={d.os} /> {d.label}</span>
        <span className="dl-detail">Lien bientôt disponible</span>
      </span>
    );
  return (
    <a className={`dl ${main ? 'dl-main' : ''}`} href={d.url} download>
      <span className="dl-label"><OsIcon os={d.os} /> Télécharger pour {d.label}</span>
      <span className="dl-detail">{d.detail}, {d.size}</span>
    </a>
  );
}

/** La page annotée du héros : début du Contrat social (1762), surligné comme dans l'app. */
function AnnotatedPage() {
  const [hover, setHover] = useState<string | null>(null);
  const hl = (cat: string, label: string, text: string) => (
    <mark className={`hl hl-${cat}`} data-cat={label} onMouseEnter={() => setHover(label)} onMouseLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(label)} onBlur={() => setHover(null)}>
      {text}
    </mark>
  );
  return (
    <figure className="page" aria-label="Exemple : le début du Contrat social, annoté dans Marginalia">
      <Rousseau className="page-rousseau" size={150} seq={[['sitwave', 2600], ['read', 7000], ['think', 2600], ['read', 6000]]} />
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

const STEPS = [
  {
    title: 'Lire',
    text: 'Ouvrez vos livres et vos cours, EPUB, PDF, Word ou Markdown, et lisez deux textes côte à côte. Surlignez en six catégories : problème, thèse, argument, thèse adverse, concept, exemple.',
    shot: 'lire',
  },
  {
    title: 'Comprendre',
    text: 'Vos surlignages deviennent une fiche du texte, une carte de l’argument et des fiches de concepts. La révision espacée vous les fait revoir au bon moment.',
    shot: 'comprendre',
  },
  {
    title: 'Écrire',
    text: 'Plans de dissertation et traitement de texte au format Word, avec notes de bas de page et citations reliées à leur passage. Export Word, PDF, page web ou Markdown, mise en page comprise.',
    shot: 'ecrire',
  },
];

/** Aperçu : onglets au-dessus d'une grande capture de l'app. */
function Showcase() {
  const [k, setK] = useState(0);
  const s = STEPS[k];
  return (
    <section className="showcase" id="apercu" aria-label="Aperçu de l’app">
      <div className="tabs" role="tablist" aria-label="Étapes du travail">
        {STEPS.map((x, i) => (
          <button key={x.title} role="tab" id={`tab-${x.shot}`} aria-selected={i === k} aria-controls="showcase-panel" className={i === k ? 'is-on' : ''} onClick={() => setK(i)}>
            {x.title}
          </button>
        ))}
      </div>
      <div className="showcase-panel" id="showcase-panel" role="tabpanel" aria-labelledby={`tab-${s.shot}`}>
        <p className="showcase-text">{s.text}</p>
        <div className="shot">
          {STEPS.map((x, i) => (
            <img key={x.shot} src={`/shots/${x.shot}.png`} alt={`Marginalia : ${x.title.toLowerCase()}`} className={i === k ? 'is-on' : ''} loading={i === 0 ? 'eager' : 'lazy'} width={1440} height={900} />
          ))}
        </div>
      </div>
    </section>
  );
}

const MORE = [
  { icon: 'split', title: 'Deux textes côte à côte', text: 'Comparez un auteur et son commentateur, ou le texte et votre cours.' },
  { icon: 'cards', title: 'Révision espacée', text: 'Vos concepts et citations reviennent au bon moment, avant l’oubli.' },
  { icon: 'book', title: 'Le programme de terminale', text: 'Les notions et repères du programme, avec leurs sens selon les auteurs.' },
  { icon: 'phone', title: 'Depuis le téléphone', text: 'Une photo d’une page, un passage copié : ils arrivent dans l’app, prêts à classer.' },
  { icon: 'doc', title: 'Exports fidèles', text: 'Word, PDF, page web : sauts de page, notes et numéros comme à l’écran.' },
  { icon: 'figure', title: 'Un compagnon de travail', text: 'Rousseau, Socrate, Platon ou Aristote lisent, herborisent et vous tiennent compagnie.' },
];

function Pict({ name }: { name: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const d: Record<string, JSX.Element> = {
    split: <><rect x="3" y="5" width="8" height="14" rx="1" {...p} /><rect x="13" y="5" width="8" height="14" rx="1" {...p} /><path d="M5 9h4M5 12h4M15 9h4M15 12h3" {...p} /></>,
    cards: <><rect x="6" y="3.5" width="12" height="15" rx="1.5" {...p} transform="rotate(8 12 11)" /><rect x="5" y="5.5" width="12" height="15" rx="1.5" {...p} /><path d="M8 11h6M8 14h4" {...p} /></>,
    book: <><path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v13" {...p} /></>,
    phone: <><rect x="7" y="2.5" width="10" height="19" rx="2" {...p} /><path d="M10.5 18.5h3" {...p} /><path d="M10 9l2 2 2-2M12 6v5" {...p} /></>,
    doc: <><path d="M6 3h8l4 4v14H6z" {...p} /><path d="M14 3v4h4M9 12h6M9 15h6M9 18h3" {...p} /></>,
    figure: <><circle cx="12" cy="7" r="3.2" {...p} /><path d="M6.5 21c.5-4.5 2.5-7 5.5-7s5 2.5 5.5 7" {...p} /><path d="M8.6 6.2c-1.4-.2-1.8 1.4-.6 2M15.4 6.2c1.4-.2 1.8 1.4.6 2" {...p} /></>,
  };
  return <svg className="pict" viewBox="0 0 24 24" aria-hidden="true">{d[name]}</svg>;
}

function App() {
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
          <a className="top-dl" href="#telecharger">Télécharger</a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-text">
            <h1>Marginalia</h1>
            <p className="lede">Lire, annoter et écrire la philosophie. Une app pour Mac et Windows, gratuite, sans compte&nbsp;: tout reste sur votre ordinateur.</p>
            <div className="hero-dl">
              <DownloadButton d={mine[0]} main />
              <a className="other" href="#telecharger">
                {os === 'win' ? 'Mac, ou autre version de Windows' : os === 'mac' ? 'Mac Intel ou Windows' : 'Toutes les versions'}
              </a>
            </div>
          </div>
          <AnnotatedPage />
        </section>

        <Showcase />

        <section className="more" id="fonctions" aria-labelledby="more-title">
          <h2 id="more-title">Et aussi</h2>
          <ul className="more-grid">
            {MORE.map((m) => (
              <li key={m.title}>
                <Pict name={m.icon} />
                <h3>{m.title}</h3>
                <p>{m.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="private">
          <Rousseau className="private-rousseau" size={150} seq={[['herborize', 9000], ['read', 6000]]} />
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
                        <a className="dl-row-btn" href={d.url} download>
                          Télécharger <span className="dl-size">{d.size}</span>
                        </a>
                      ) : (
                        <span className="dl-row-btn is-soon" aria-disabled="true">Bientôt</span>
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
