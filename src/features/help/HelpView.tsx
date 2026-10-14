// Onglet « Aide » : comment fonctionne Marginalia et tout ce qu'on peut y faire.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Brain,
  FilePen,
  FolderTree,
  Highlighter,
  Keyboard,
  Lightbulb,
  ListTree,
  Network,
  Palette,
  Search,
  Shield,
  Sigma,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { useStore } from '../../lib/store';
import type { Route } from '../../lib/types';
import { importViaDialog } from '../../App';
import './help.css';

interface Item {
  title: string;
  text: ReactNode;
  keys?: string[];
}
interface Section {
  id: string;
  title: string;
  icon: ReactNode;
  intro: string;
  items: Item[];
  go?: { label: string; route?: Route; run?: () => void };
}

const K = ({ children }: { children: ReactNode }) => <kbd className="help-kbd">{children}</kbd>;

const SECTIONS: Section[] = [
  {
    id: 'demarrer',
    title: 'Premiers pas',
    icon: <Sparkles size={16} />,
    intro:
      'Marginalia sert à lire, étudier et écrire sur des textes, surtout de philosophie. Le parcours type : importer un texte, le lire en surlignant, organiser ce que vous en tirez (concepts, arguments, plans), puis écrire.',
    items: [
      { title: 'Le parcours en 4 temps', text: 'Importer → Lire et surligner → Étudier (concepts, arguments, carte, révision, plans) → Écrire. Chaque étape nourrit la suivante : un extrait surligné se retrouve dans vos concepts, vos plans, vos cartes de révision et peut être cité dans vos écrits.' },
      { title: 'La barre latérale', text: 'Accueil, Bibliothèque et Écrits en haut ; les outils d’étude (Extraits, Concepts, Arguments, Plans, Révision) ; vos Espaces de travail ; en bas Historique, Corbeille, Aide, Apparence et le bouton Importer. Repliez-la en une fine colonne d’icônes pour gagner de la place (bouton en haut de la barre).', keys: ['⌃⌘S'] },
      { title: 'Tout retrouver', text: 'La recherche globale trouve livres, extraits, concepts, arguments, plans, écrits et signets.', keys: ['⌘K'] },
      { title: 'Annuler presque tout', text: 'Les actions (suppression, déplacement, modification) s’annulent et se rétablissent partout dans l’app.', keys: ['⌘Z', '⌘⇧Z'] },
    ],
    go: { label: 'Aller à l’accueil', route: { name: 'home' } },
  },
  {
    id: 'importer',
    title: 'Importer des textes',
    icon: <Upload size={16} />,
    intro: 'Livres et documents se rangent dans la Bibliothèque ; les fichiers Word et Markdown deviennent des écrits modifiables.',
    items: [
      { title: 'Formats', text: 'EPUB, PDF, TXT, HTML, et images (JPG, PNG, HEIC…) dont le texte est reconnu automatiquement (OCR, sans connexion). Les .docx et .md vont dans Écrits.' },
      { title: 'Trois façons d’importer', text: 'Le bouton Importer, le raccourci, ou glisser des fichiers n’importe où dans la fenêtre. Vous pouvez aussi ouvrir un fichier depuis le Finder avec Marginalia.', keys: ['⌘O'] },
      { title: 'Depuis l’app Livres (iCloud)', text: 'Dans la Bibliothèque, « Depuis Livres » liste vos EPUB et PDF de l’app Livres d’Apple. Les livres protégés (DRM) ne peuvent pas être importés. Avec « Synchroniser automatiquement », un livre sans DRM ajouté sur votre iPhone arrive tout seul dans Marginalia.' },
      { title: 'Importer dans un espace', text: 'Importer ou glisser un fichier depuis un espace de travail le range directement dans cet espace (et le groupe ouvert). Depuis la Bibliothèque, il n’est rangé nulle part.' },
    ],
    go: { label: 'Importer un fichier', run: () => void importViaDialog() },
  },
  {
    id: 'lire',
    title: 'Lire',
    icon: <BookOpen size={16} />,
    intro: 'Le lecteur garde votre position, s’adapte à vos réglages et permet de lire deux textes côte à côte.',
    items: [
      { title: 'Sommaire et progression', text: 'Le panneau de gauche affiche le sommaire, le chapitre en cours et votre progression. La position de lecture est mémorisée : « Reprendre » sur l’accueil vous ramène où vous en étiez.' },
      { title: 'Réglages de lecture', text: 'Taille, interligne, largeur de colonne et police (serif ou sans) se règlent avec le bouton « T » de la barre du haut. Les connecteurs logiques peuvent être mis en évidence.' },
      { title: 'Rechercher dans le livre', text: 'La loupe de la barre du haut cherche dans tout le texte.' },
      { title: 'Deux textes côte à côte', text: 'Le bouton à deux colonnes ouvre un second livre à droite pour comparer deux passages ou deux auteurs.' },
      { title: 'Signets', text: 'Marquez un endroit pour le retrouver : le signet reçoit un nom (titre de section et début de phrase, ou « Page N »), modifiable. Ils sont listés dans l’onglet Signets du panneau de droite, repérés dans la marge, et trouvables avec ⌘K. Clic droit dans le texte : « Ajouter un signet ici ».', keys: ['⌘D', '⌘⌥↓', '⌘⌥↑'] },
      { title: 'Images et scans', text: 'Une photo de page est lue par reconnaissance de texte : vous pouvez sélectionner et surligner son texte comme dans un livre.' },
    ],
    go: { label: 'Ouvrir la bibliothèque', route: { name: 'library' } },
  },
  {
    id: 'annoter',
    title: 'Surligner et annoter',
    icon: <Highlighter size={16} />,
    intro: 'Sélectionnez un passage : une barre apparaît pour le classer selon son rôle dans l’argumentation. Chaque passage classé devient un extrait.',
    items: [
      { title: 'Les catégories', text: <>Problème <K>1</K>, Thèse <K>2</K>, Argument <K>3</K>, Thèse adverse <K>4</K>, Concept <K>5</K>, Exemple <K>6</K>. <K>N</K> ajoute une note de marge (« ma voix »), <K>M</K> marque le début d’un mouvement du texte.</> },
      { title: 'Le panneau Extraits', text: 'À droite du lecteur, les extraits du livre dans l’ordre du texte ou par date. Cliquer un extrait ramène au passage ; on peut y ajouter une note, des concepts, ou le copier comme citation avec auteur, édition et page.' },
      { title: 'Fiche-texte (explication de texte)', text: 'L’onglet Fiche-texte guide l’étude d’un passage : problème, thèse, enjeu, et découpage en mouvements.' },
      { title: 'Tous les extraits', text: 'La vue Extraits rassemble les passages de tous vos livres, filtrables par livre, catégorie ou concept.' },
      { title: 'Citations prêtes à coller', text: 'Chaque extrait se copie comme une citation correctement référencée (auteur, titre, édition, page). Renseignez l’édition et le décalage de pages dans « Infos » d’un livre.' },
    ],
    go: { label: 'Voir mes extraits', route: { name: 'extracts' } },
  },
  {
    id: 'carte',
    title: 'Carte d’argument',
    icon: <Network size={16} />,
    intro: 'Dans un livre, l’onglet « Carte » permet de dessiner la structure du raisonnement avec vos extraits et vos idées.',
    items: [
      { title: 'Placer des cartes', text: 'Glissez les extraits du tiroir « À placer » sur la carte, ou ajoutez une idée à vous. Les cartes se déplacent librement.' },
      { title: 'Relier', text: 'Tirez un lien depuis le bord d’une carte vers une autre : soutient, objecte à, répond à, précise, illustre. Lâcher un lien dans le vide crée une nouvelle carte reliée. Cliquer un lien change sa relation ou le regroupe avec d’autres.' },
      { title: 'Clic droit', text: 'Sur une carte : Modifier, Dupliquer, Ouvrir dans le livre, Supprimer la carte (l’extrait reste dans le livre). Dans le vide : Nouvelle idée ici. Sélectionnez plusieurs cartes pour les supprimer ensemble.', keys: ['⌫'] },
    ],
  },
  {
    id: 'concepts',
    title: 'Concepts',
    icon: <Lightbulb size={16} />,
    intro: 'Un lexique personnel : chaque concept a une fiche avec ses sens selon les auteurs, les extraits où il apparaît et ses liens avec d’autres concepts.',
    items: [
      { title: 'Fiche de concept', text: 'Définitions par auteur (« sens »), distinctions, extraits rattachés, liens avec d’autres concepts (à distinguer de, s’oppose à, proche de). Une fiche peut aussi produire des cartes de révision et s’exporte en Markdown.' },
      { title: 'Programme', text: 'Le menu « … » charge les notions et repères du programme de philosophie.' },
      { title: 'Rattacher des extraits', text: 'Depuis le panneau Extraits du lecteur ou depuis la fiche du concept.' },
      { title: 'Sélection multiple', text: '⌘-clic, ⇧-clic ou « Sélectionner », puis Supprimer (annulable).', keys: ['⌘A', '⌘⌫'] },
    ],
    go: { label: 'Ouvrir les concepts', route: { name: 'concepts', conceptId: null } },
  },
  {
    id: 'arguments',
    title: 'Arguments',
    icon: <Sigma size={16} />,
    intro: 'Reconstruisez un raisonnement en forme standard : prémisses, prémisses implicites (ce que l’auteur suppose sans le dire) et conclusion.',
    items: [
      { title: 'Reconstruire', text: 'Chaque prémisse peut s’appuyer sur un extrait. L’aperçu en forme standard se copie pour vos copies et dissertations.' },
      { title: 'Réutiliser', text: 'Les arguments se glissent dans vos plans de dissertation.' },
    ],
    go: { label: 'Ouvrir les arguments', route: { name: 'arguments', argumentId: null } },
  },
  {
    id: 'plans',
    title: 'Plans de dissertation',
    icon: <ListTree size={16} />,
    intro: 'Un plan réunit le sujet, la problématique et des parties où vous glissez extraits, concepts et arguments.',
    items: [
      { title: 'Construire', text: 'Parties et sous-parties ; le panneau Ressources propose vos extraits, concepts et arguments à glisser dedans.' },
      { title: 'Passer à l’écriture', text: '« Envoyer vers l’éditeur » crée un écrit structuré à partir du plan, avec les citations.' },
    ],
    go: { label: 'Ouvrir les plans', route: { name: 'plans', planId: null } },
  },
  {
    id: 'revision',
    title: 'Révision',
    icon: <Brain size={16} />,
    intro: 'Des cartes de mémorisation tirées de vos lectures, présentées au bon moment (répétition espacée).',
    items: [
      { title: 'Types de cartes', text: 'Définition (concepts), Thèse d’un auteur, Texte à trous, Citation (retrouver l’auteur et l’œuvre), carte libre.' },
      { title: 'Sessions', text: 'Notez chaque réponse ; l’app calcule la prochaine échéance. Le nombre de nouvelles cartes par livre et par jour se règle.' },
    ],
    go: { label: 'Ouvrir la révision', route: { name: 'revision' } },
  },
  {
    id: 'ecrire',
    title: 'Écrire',
    icon: <FilePen size={16} />,
    intro: 'Un traitement de texte complet, qui ouvre et enregistre des fichiers Word (.docx), pensé pour la dissertation et l’explication de texte.',
    items: [
      { title: 'Mise en forme', text: 'Styles (Titre 1-3, Corps, Citation…), toutes les polices installées sur votre Mac, couleurs, alignement, listes, tableaux, mise en page (marges, format), zoom. Modèles : dissertation, explication de texte, fiche, présentation universitaire.' },
      { title: 'Notes', text: 'Notes de bas de page, et notes privées (fond teinté) : visibles pour vous, jamais exportées.', keys: ['⌘⌥F', '⌘⌥N'] },
      { title: 'Citer en écrivant', text: 'Le panneau de droite affiche au choix un Livre (le vrai lecteur : sélectionnez un passage puis « Citer » ou C), vos Extraits, vos Concepts ou un Plan. Une citation garde son lien : ⌘-clic dessus ramène au passage du livre. Le panneau se redimensionne et se met en 50/50.' },
      { title: 'Outils d’écriture', text: 'Typographie française automatique (espaces insécables, « guillemets », apostrophes), correcteur orthographique sur le Mac (clic droit sur un mot souligné), rechercher et remplacer, revue de style (phrases longues, répétitions, tics de copie), objectif de mots.', keys: ['⌘F', '⌘⇧H'] },
      { title: 'Plan déplaçable', text: 'Le plan à gauche liste vos titres : glissez une section pour la déplacer avec son contenu et ses notes.', keys: ['⌥⇧↑', '⌥⇧↓'] },
      { title: 'Versions', text: 'Des versions sont créées automatiquement pendant que vous écrivez ; créez-en une nommée quand vous voulez. Comparez mot à mot avec le texte actuel et restaurez (annulable).', keys: ['⌘⌥S'] },
      { title: 'Enregistrer et exporter', text: 'Un .docx ouvert depuis le disque est réenregistré à sa place. Export Word, PDF, Markdown, page web ou texte.', keys: ['⌘S'] },
    ],
    go: { label: 'Ouvrir mes écrits', route: { name: 'write', draftId: null } },
  },
  {
    id: 'espaces',
    title: 'Espaces de travail',
    icon: <FolderTree size={16} />,
    intro: 'Un espace regroupe ce qui sert à un même travail (un cours, un exposé, une dissertation) : livres, écrits, plans, arguments, cartes. Un élément peut figurer dans plusieurs espaces sans être dupliqué.',
    items: [
      { title: 'Groupes et sous-groupes', text: 'Organisez un espace en groupes, renommez, colorez, et glissez-déposez les éléments entre groupes, dans la vue ou dans la barre latérale.' },
      { title: 'Sélection multiple', text: 'Sélectionnez plusieurs éléments pour les déplacer vers un groupe ou un autre espace, en faire un nouveau groupe, les retirer de l’espace (ils restent dans la bibliothèque) ou les supprimer.', keys: ['⌘-clic', '⇧-clic', '⌘A'] },
    ],
  },
  {
    id: 'organiser',
    title: 'Organiser, historique et corbeille',
    icon: <Search size={16} />,
    intro: 'Tout se range, se retrouve et se récupère.',
    items: [
      { title: 'Bibliothèque', text: 'Recherche, tri (récents, titre, auteur, ajout), filtres par format, affichage grille ou liste. Sélection multiple pour supprimer, ranger dans un espace ou exporter les notes.' },
      { title: 'Historique', text: 'Le journal de tout ce qui a été fait, avec « Revenir à l’état d’avant » sur chaque action.' },
      { title: 'Corbeille', text: 'Ce qui est supprimé y reste 30 jours, avec ce qui en dépendait (extraits, signets…), et se restaure exactement à sa place.' },
    ],
    go: { label: 'Voir l’historique', route: { name: 'history' } },
  },
  {
    id: 'apparence',
    title: 'Apparence et confidentialité',
    icon: <Palette size={16} />,
    intro: 'Choisissez l’ambiance, et sachez que vos textes ne quittent jamais votre Mac.',
    items: [
      { title: 'Thèmes', text: 'Automatique (suit le mode clair/sombre du Mac), Clair, Sombre ou Sépia, en bas de la barre latérale.' },
      { title: '100 % local', text: 'Aucune donnée n’est envoyée sur Internet : l’app bloque toute connexion sortante. La reconnaissance de texte et le correcteur fonctionnent hors ligne. La synchro avec Livres passe par iCloud Drive, géré par macOS.' },
      { title: 'En cas de problème', text: 'Menu Aide › « Exporter le journal de diagnostic » : un fichier est copié dans vos Téléchargements pour comprendre un bug.' },
    ],
  },
];

const SHORTCUTS: [string, string][] = [
  ['⌘K', 'Rechercher partout'],
  ['⌘O', 'Importer'],
  ['⌘Z / ⌘⇧Z', 'Annuler / rétablir'],
  ['1 – 6', 'Classer la sélection (Problème… Exemple)'],
  ['N / M', 'Note de marge / début de mouvement'],
  ['⌘D', 'Ajouter un signet'],
  ['⌘⌥↓ / ⌘⌥↑', 'Signet suivant / précédent'],
  ['⌘F / ⌘⇧H', 'Rechercher / remplacer (Écrire)'],
  ['⌘⌥F', 'Note de bas de page'],
  ['⌘⌥N', 'Note privée'],
  ['⌘⌥S', 'Créer une version'],
  ['⌥⇧↑ / ⌥⇧↓', 'Déplacer une section du plan'],
  ['⌘S', 'Enregistrer l’écrit'],
  ['⌘A', 'Tout sélectionner (listes)'],
  ['Échap', 'Fermer / désélectionner'],
  ['⌃⌘S', 'Replier / afficher la barre latérale'],
  ['⌘?', 'Ouvrir cette aide'],
];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const textOf = (n: ReactNode): string => (typeof n === 'string' ? n : Array.isArray(n) ? n.map(textOf).join(' ') : n && typeof n === 'object' && 'props' in n ? textOf((n as { props: { children?: ReactNode } }).props.children) : '');

export function HelpView() {
  const navigate = useStore((s) => s.navigate);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(SECTIONS[0].id);
  const scroller = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => {
    const words = fold(q.trim()).split(/\s+/).filter(Boolean);
    if (!words.length) return SECTIONS;
    return SECTIONS.map((s) => {
      const hit = (t: string) => words.every((w) => fold(t).includes(w));
      if (hit(s.title + ' ' + s.intro)) return s;
      const items = s.items.filter((i) => hit(`${i.title} ${textOf(i.text)} ${(i.keys ?? []).join(' ')}`));
      return items.length ? { ...s, items } : null;
    }).filter((s): s is Section => !!s);
  }, [q]);

  // Section courante d'après le défilement.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActive(vis.target.id.replace(/^help-/, ''));
      },
      { root, rootMargin: '0px 0px -70% 0px' },
    );
    root.querySelectorAll('.help-section').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  const goTo = (id: string) => {
    setActive(id);
    document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="help-root">
      <header className="topbar">
        <label className="help-search">
          <Search size={14} />
          <input placeholder="Chercher dans l’aide (ex. « citer », « signet », « iCloud »)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Chercher dans l’aide" />
          {q && (
            <button className="icon-btn sm" onClick={() => setQ('')} aria-label="Effacer">
              <X size={13} />
            </button>
          )}
        </label>
        <span className="spacer" />
      </header>
      <div className="help-body">
        <nav className="help-index" aria-label="Sommaire de l’aide">
          {sections.map((s) => (
            <button key={s.id} className={`help-index-item ${active === s.id ? 'active' : ''}`} onClick={() => goTo(s.id)}>
              {s.icon}
              <span>{s.title}</span>
            </button>
          ))}
          <button className={`help-index-item ${active === 'raccourcis' ? 'active' : ''}`} onClick={() => goTo('raccourcis')}>
            <Keyboard size={16} />
            <span>Raccourcis clavier</span>
          </button>
        </nav>
        <div className="help-scroll" ref={scroller}>
          <div className="help-page anim-view">
            <h1 className="page-title">Aide</h1>
            <p className="help-lead">Comment fonctionne Marginalia, et tout ce que vous pouvez y faire.</p>
            {sections.length === 0 && <p className="muted">Rien ne correspond à « {q} ».</p>}
            {sections.map((s) => (
              <section key={s.id} id={`help-${s.id}`} className="help-section">
                <h2>
                  <span className="help-icon">{s.icon}</span>
                  {s.title}
                </h2>
                <p className="help-intro">{s.intro}</p>
                <div className="help-items">
                  {s.items.map((it) => (
                    <div key={it.title} className="help-item">
                      <h3>{it.title}</h3>
                      <p>{it.text}</p>
                      {it.keys && (
                        <div className="help-keys">
                          {it.keys.map((k) => (
                            <K key={k}>{k}</K>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {s.go && (
                  <button className="btn btn-sm help-go" onClick={() => (s.go!.run ? s.go!.run() : s.go!.route && navigate(s.go!.route))}>
                    {s.go.label} <ArrowRight size={13} />
                  </button>
                )}
              </section>
            ))}
            {!q.trim() && (
              <section id="help-raccourcis" className="help-section">
                <h2>
                  <span className="help-icon">
                    <Keyboard size={16} />
                  </span>
                  Raccourcis clavier
                </h2>
                <table className="help-table">
                  <tbody>
                    {SHORTCUTS.map(([k, v]) => (
                      <tr key={k}>
                        <td>
                          <K>{k}</K>
                        </td>
                        <td>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="help-foot">
                  <Shield size={13} /> Marginalia fonctionne entièrement sur votre Mac. <Bookmark size={13} /> Astuce : ⌘K trouve aussi vos signets.
                </p>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
