// Onglet « Aide » : comment fonctionne Marginalia et tout ce qu'on peut y faire.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Route as RouteIcon,
  BookA,
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
import { appleBooksAvailable } from '../library/appleBooks';
import { fmtKeys, isMac, OS_TEXT } from '../../lib/keys';
import './help.css';

interface Item {
  title: string;
  text: ReactNode;
  keys?: string[];
  /** Fonction de l'app Livres d'Apple : masquée là où elle n'existe pas (Windows). */
  appleBooks?: boolean;
}
interface Section {
  id: string;
  title: string;
  icon: ReactNode;
  intro: string;
  items: Item[];
  go?: { label: string; route?: Route; run?: () => void };
  /** Mode d'emploi : à quoi ça sert, comment s'en servir pas à pas, un exemple et une astuce. */
  guide?: Guide;
}
interface Guide {
  why: string;
  how: string[];
  example?: string;
  tip?: string;
}

const GUIDES: Record<string, Guide> = {
  demarrer: {
    why: 'Marginalia accompagne tout le travail sur un texte : le lire de près, comprendre comment il raisonne, garder ce qui compte, puis s’en servir pour écrire (explication de texte, dissertation, exposé, fiche).',
    how: [
      'Importez un livre ou un texte (EPUB, PDF, photo d’une page…).',
      'Lisez-le et surlignez les passages importants : chaque passage surligné devient un « extrait ».',
      'Donnez un rôle aux extraits qui comptent (problème, thèse, argument…), rattachez-les à des concepts, reliez-les sur la carte d’argument.',
      'Préparez un plan, révisez avec des cartes de mémorisation, puis écrivez en citant vos extraits.',
    ],
    example: 'Vous étudiez le « Discours de la méthode » : vous importez l’EPUB, surlignez la thèse du cogito, créez le concept « doute », reliez thèse et arguments sur la carte, puis rédigez votre explication en citant vos extraits d’un clic.',
    tip: 'Rien ne vous oblige à tout utiliser : on peut se contenter de lire et surligner, et n’ouvrir les autres outils que le jour où on en a besoin.',
  },
  importer: {
    why: 'Faire entrer dans Marginalia les textes que vous étudiez, sous une forme qu’on peut lire, surligner et citer.',
    how: [
      'Cliquez sur « Importer » (en bas de la barre latérale ou en haut de la Bibliothèque), ou glissez un fichier dans la fenêtre.',
      'Le livre apparaît dans la Bibliothèque avec sa couverture, son titre et son auteur ; cliquez dessus pour l’ouvrir.',
      'Ouvrez « Infos » sur un livre pour préciser l’édition, l’année, le traducteur et le décalage de pages : vos citations seront exactes.',
    ],
    example: 'Une photo de la page 42 d’un livre papier : importez-la, son texte est reconnu et vous pouvez le surligner comme un livre numérique.',
  },
  lire: {
    why: 'Lire confortablement et ne jamais perdre sa place, même entre plusieurs livres.',
    how: [
      'Ouvrez un livre depuis la Bibliothèque ou « Reprendre » sur l’accueil.',
      'Naviguez par le sommaire à gauche ; réglez la présentation, la police et la taille avec « Aa » (mise en page et affichage).',
      'Posez un signet sur un passage à retrouver ; ouvrez un second livre à côté pour comparer.',
    ],
    example: 'Vous comparez Hobbes et Rousseau sur l’état de nature : ouvrez le Léviathan, puis le bouton à deux colonnes pour afficher le Discours sur l’origine de l’inégalité à côté, et posez un signet (⌘D) sur chaque passage clé.',
    tip: 'Le panneau de droite (Extraits, Fiche-texte, Signets) et le sommaire se replient pour lire en plein espace.',
  },
  annoter: {
    why: 'Garder les passages importants et, si vous le souhaitez, noter le rôle de chacun dans le raisonnement de l’auteur. C’est le cœur de l’app : tout ce que vous surlignez se retrouve ensuite dans vos concepts, plans, cartes de révision et écrits.',
    how: [
      'Sélectionnez un passage à la souris : une petite barre apparaît au-dessus.',
      'Pour simplement le marquer : « Surligner » (H). Pour indiquer son rôle : une catégorie (1 à 6). Pour réagir : N, puis écrivez votre note.',
      'Le passage devient un extrait, visible dans le panneau Extraits à droite. Cliquez-le pour y revenir, ajoutez une note, rattachez un concept, changez sa catégorie.',
    ],
    example: '« Je pense, donc je suis » → Thèse (2). La phrase qui explique pourquoi on ne peut douter de soi en train de douter → Argument (3). « Le malin génie » → Exemple (6). Votre remarque « ce n’est pas un raisonnement mais une intuition ? » → Note (N).',
    tip: 'Les catégories : Problème = la question que le texte affronte ; Thèse = la réponse de l’auteur ; Argument = ce qui la justifie ; Thèse adverse = la position qu’il combat ; Concept = une définition ou distinction ; Exemple = un cas concret. Dans le doute, surlignez simplement (H) et classez plus tard.',
  },
  carte: {
    why: 'Voir d’un coup d’œil comment un texte raisonne : quelle thèse, soutenue par quels arguments, contre quelle objection. Indispensable pour une explication de texte ou pour comparer deux auteurs.',
    how: [
      'Dans un livre, passez de « Lecture » à « Carte » (en haut).',
      'Glissez vos extraits depuis le tiroir « À placer » sur la carte ; ajoutez vos propres idées avec « Idée ».',
      'Tirez un lien depuis le bord d’une carte vers une autre : il naît neutre (un simple trait, sans flèche, qui n’affirme rien), de la carte d’où vous tirez vers celle où vous lâchez. Donnez-lui ensuite une nature dans son menu : soutient, objecte à, répond à, précise, illustre ; « Inverser le sens » retourne la flèche.',
      'Réorganisez en déplaçant les cartes ; clic droit sur une carte pour la modifier, la dupliquer ou la supprimer.',
      'Pour une dissertation ou une carte mentale, partez du centre : « Centre » › « Poser la problématique » (une question) ou « Poser le sujet » (un thème), puis rattachez-y vos thèses ; repliez les branches que vous ne travaillez pas.',
    ],
    example: 'Thèse « l’homme est condamné à être libre » ← soutenue par « l’existence précède l’essence » ← illustrée par l’exemple du garçon de café ; objection « déterminismes sociaux » → à laquelle répond « la mauvaise foi ».',
    tip: 'Ne confondez pas avec les « cartes » de la Révision : ici ce sont les cases d’un schéma, là-bas des fiches de mémorisation.',
  },
  concepts: {
    why: 'Construire votre propre lexique philosophique : un concept (liberté, devoir, conscience…) n’a pas le même sens chez Kant, Spinoza ou Sartre. La fiche garde ces sens côte à côte, avec les passages qui les montrent.',
    how: [
      'Ouvrez « Concepts » et créez-en un (« Nouveau concept »), ou chargez les notions du programme avec le menu « … ».',
      'Dans la fiche, ajoutez un « sens » par auteur ou par livre, avec sa définition.',
      'Rattachez des extraits : depuis le panneau Extraits du lecteur, ou depuis la fiche. Ajoutez des liens avec d’autres concepts (à distinguer de, s’oppose à, proche de).',
    ],
    example: 'Liberté — chez Spinoza : comprendre la nécessité qui nous détermine ; chez Sartre : choix absolu sans excuse. Lien : « à distinguer de » libre arbitre.',
    tip: 'Une fiche de concept peut générer des cartes de révision « définition » en un clic.',
  },
  arguments: {
    why: 'Mettre un raisonnement à plat pour le comprendre ou le critiquer : quelles prémisses, quelle conclusion, et surtout ce que l’auteur suppose sans le dire.',
    how: [
      'Ouvrez « Arguments » puis « Nouvel argument ».',
      'Écrivez les prémisses une à une (dans vos mots ou ceux du texte), en les appuyant si besoin sur un extrait ; ajoutez les prémisses implicites.',
      'Écrivez la conclusion ; l’aperçu « Forme standard » se copie pour vos copies.',
    ],
    example: 'P1 : tout ce qui est fait par contrainte n’est pas libre. P2 (implicite) : obéir aux lois est une contrainte. C : donc obéir aux lois n’est pas être libre — c’est P2 que Rousseau conteste.',
  },
  plans: {
    why: 'Préparer une dissertation : poser le sujet et la problématique, organiser les parties, et y ranger d’avance les extraits, concepts et arguments qui serviront.',
    how: [
      'Ouvrez « Plans » puis « Nouveau plan » ; écrivez le sujet et la problématique.',
      'Ajoutez des parties et sous-parties.',
      'Ouvrez « Ressources » et glissez vos extraits, concepts et arguments dans les parties.',
      '« Envoyer vers l’éditeur » crée un écrit avec ces titres et vos citations, prêt à rédiger.',
    ],
    example: '« Peut-on être libre sans lois ? » — I. La liberté comme absence d’entraves (Hobbes) ; II. La loi comme condition de la liberté (Rousseau) ; III. L’autonomie : se donner sa propre loi (Kant).',
  },
  revision: {
    why: 'Retenir durablement définitions, thèses et citations. L’app vous les représente juste avant que vous les oubliiez (répétition espacée) : peu de temps par jour, beaucoup de mémoire à long terme.',
    how: [
      'Ouvrez « Révision » puis « Créer des cartes » : choisissez un type (définition, thèse, texte à trous, citation, carte libre) et la source (vos extraits, vos concepts).',
      'Lancez une session : lisez la question, cherchez la réponse, retournez la carte.',
      'Notez honnêtement si vous saviez : l’app décide quand vous la reverrez.',
    ],
    example: 'Une carte « Définition » : recto « Conatus (Spinoza) », verso « l’effort par lequel chaque chose s’efforce de persévérer dans son être ». Une carte « Texte à trous » : « L’homme est un ___ pour l’homme » (loup — Hobbes).',
    tip: 'Mieux vaut 10 minutes chaque jour qu’une heure la veille : réglez le nombre de nouvelles cartes par jour pour garder un rythme tenable.',
  },
  ecrire: {
    why: 'Rédiger vos dissertations, explications et fiches dans un vrai traitement de texte (compatible Word), sans quitter vos lectures : vos extraits et vos livres restent à portée de main pour citer.',
    how: [
      'Ouvrez « Écrits » puis « Nouveau » (un modèle : vide, dissertation, explication de texte, fiche…) ou ouvrez un .docx existant.',
      'Écrivez ; ouvrez le panneau de droite pour afficher un livre, vos extraits, vos concepts ou un plan, et cliquez « Citer » pour insérer une citation référencée.',
      'Enregistrez (⌘S) ; exportez en Word, PDF, Markdown, page web ou texte.',
    ],
    example: 'Explication de texte sur Descartes : nouveau modèle « Explication de texte », panneau de droite sur « Livre », vous sélectionnez « je pense, donc je suis » et cliquez « Citer » : la citation et sa référence (édition, page) s’insèrent ; ⌘-clic dessus vous ramène au passage.',
    tip: 'Les versions se créent toutes seules : en cas de mauvaise manipulation, ouvrez « Versions » pour comparer et revenir en arrière.',
  },
  espaces: {
    why: 'Rassembler au même endroit tout ce qui sert à un travail précis (un cours, une dissertation, un exposé), sans rien déplacer ni dupliquer.',
    how: [
      'Dans la barre latérale, « + » à côté d’Espaces pour en créer un.',
      'Ajoutez-y des livres, écrits, plans, arguments ou cartes : glisser-déposer, menu « Ajouter à un espace », ou import depuis l’espace.',
      'Organisez en groupes et sous-groupes ; sélectionnez plusieurs éléments pour les déplacer d’un coup.',
    ],
    example: 'Espace « Le liberté » : les livres sur le serment, votre dissertation, le plan, les arguments de Kant sur le mensonge.',
  },
  organiser: {
    why: 'Retrouver n’importe quoi, et ne jamais perdre un travail par erreur.',
    how: [
      '⌘K pour chercher partout (livres, extraits, concepts, signets…).',
      'Historique : voir ce qui a été fait et revenir à l’état d’avant une action.',
      'Corbeille : récupérer un élément supprimé pendant 30 jours.',
    ],
    example: 'Vous cherchez la phrase sur le « malin génie » sans savoir où vous l’avez surlignée : ⌘K, tapez « malin génie », l’extrait apparaît avec son livre ; Entrée vous y amène.',
  },
  apparence: {
    why: 'Travailler longtemps sans fatigue visuelle, en sachant que vos textes restent chez vous.',
    how: ['Choisissez le thème en bas de la barre latérale (automatique, clair, sombre, sépia).', 'Dans Écrire, le menu Affichage (le pourcentage, en haut à droite) règle la teinte de la page et le zoom.'],
    example: 'Le soir : thème Sombre et page « Sombre » dans Écrire ; vos exports PDF restent pourtant noir sur blanc.',
  },
};

/** Notions de l'app, définies en une phrase. */
const GLOSSARY: [string, string][] = [
  ['Extrait', 'Un passage que vous avez surligné dans un livre. Il garde sa place exacte dans le texte, sa catégorie éventuelle, votre note et ses concepts.'],
  ['Surlignage simple', 'Un extrait sans catégorie ni note (touche H) : pour marquer vite, classer plus tard.'],
  ['Catégorie', 'Le rôle d’un extrait dans le raisonnement : Problème, Thèse, Argument, Thèse adverse, Concept, Exemple.'],
  ['Note de marge', 'Votre réaction à un passage (« ma voix ») : reformulation, question, critique, présupposé.'],
  ['Mouvement', 'Le début d’une nouvelle étape du texte (touche M), pour découper un passage en explication de texte.'],
  ['Fiche-texte', 'L’étude d’un passage : problème, thèse, enjeu, mouvements — la base d’une explication de texte.'],
  ['Concept', 'Une notion (liberté, conscience…) avec ses différents sens selon les auteurs et les extraits qui l’illustrent.'],
  ['Argument', 'Un raisonnement reconstruit : prémisses (dont les implicites) et conclusion.'],
  ['Carte d’argument', 'Le schéma d’un livre : des cases (extraits, idées) reliées par des flèches (soutient, objecte…).'],
  ['Carte libre', 'Une carte d’argument rangée dans un espace, sans livre attitré : on y réunit idées, concepts et extraits de plusieurs livres.'],
  ['Carte de révision', 'Une fiche question/réponse pour mémoriser, présentée au bon moment.'],
  ['Plan', 'Sujet, problématique et parties d’une dissertation, garnies d’extraits, concepts et arguments.'],
  ['Écrit', 'Un document que vous rédigez (fichier Word), dans Écrits.'],
  ['Espace de travail', 'Un dossier thématique qui regroupe des éléments sans les dupliquer.'],
  ['Signet', 'Un marque-page nommé dans un livre.'],
];

const K = ({ children }: { children: ReactNode }) => <kbd className="help-kbd">{typeof children === 'string' ? fmtKeys(children) : children}</kbd>;

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
      {
        title: 'Mac et Windows',
        // Fragment (et non chaîne) : texte affiché tel quel, sans conversion des symboles ⌘ ⌥ ⇧.
        text: <>Sur Windows, les raccourcis ⌘ deviennent Ctrl (⌥ devient Alt, ⇧ devient Maj ; ⌘⌥ devient Ctrl+Maj, pour ne pas gêner AltGr) ; la synchro avec Livres n’existe que sur Mac. Cette aide affiche toujours les raccourcis de votre système.</>,
      },
    ],
    go: { label: 'Aller à l’accueil', route: { name: 'home' } },
  },
  {
    id: 'parcours',
    title: 'Parcours complets',
    icon: <RouteIcon size={16} />,
    intro: 'Des exemples de bout en bout, pour voir comment les outils s’enchaînent.',
    items: [
      {
        title: 'Préparer une explication de texte',
        text: '1. Importez le livre et ouvrez le passage étudié. 2. Surlignez : la question (Problème, 1), la réponse de l’auteur (Thèse, 2), ses justifications (Argument, 3), la position qu’il combat (Thèse adverse, 4) ; marquez chaque nouvelle étape du raisonnement avec M. 3. Ouvrez l’onglet Fiche-texte : problème, thèse et enjeu se préparent, les mouvements apparaissent. 4. Passez sur « Carte » pour dessiner le raisonnement (une « Carte du mouvement » par mouvement si le passage est long ; « Livre à côté » pour y glisser les passages oubliés). 5. « Présenter » avec « Masquer le texte » : entraînez-vous à l’oral. 6. Menu « … » de la carte, « Rédiger une explication à partir de la carte » : le brouillon s’ouvre avec vos citations, à développer.',
      },
      {
        title: 'Préparer une dissertation',
        text: '1. Dans Plans, « Nouveau plan » : écrivez le sujet (« Peut-on être libre sans lois ? ») et la problématique. 2. Créez trois parties. 3. Ouvrez « Ressources » et glissez dans chaque partie vos extraits (Hobbes, Rousseau, Kant), vos concepts (liberté, loi, autonomie) et vos arguments reconstruits. 4. « Envoyer vers l’éditeur » : l’écrit est créé avec vos titres et citations. 5. Rédigez en mode concentration (⌘⇧F), puis exportez en Word ou PDF.',
      },
      {
        title: 'Réviser avant un examen',
        text: '1. Dans Concepts, chargez les notions du programme (menu « … »). 2. Pour chaque notion, ajoutez un sens par auteur. 3. Dans Révision, « Créer des cartes » : définitions depuis vos concepts, thèses depuis vos extraits Thèse. 4. Chaque jour, une courte session : l’app vous représente ce que vous êtes sur le point d’oublier.',
      },
    ],
  },
  {
    id: 'importer',
    title: 'Importer des textes',
    icon: <Upload size={16} />,
    intro: 'Livres et documents se rangent dans la Bibliothèque ; les fichiers Word et Markdown deviennent des écrits modifiables.',
    items: [
      { title: 'Formats', text: 'EPUB, PDF, TXT, HTML, et images (JPG, PNG, HEIC…) dont le texte est reconnu automatiquement (OCR, sans connexion). Les .docx et .md vont dans Écrits.' },
      { title: 'Trois façons d’importer', text: `Le bouton Importer, le raccourci, ou glisser des fichiers n’importe où dans la fenêtre. Vous pouvez aussi ouvrir un fichier depuis ${OS_TEXT.fileManager} avec Marginalia.`, keys: ['⌘O'] },
      { appleBooks: true, title: 'Depuis l’app Livres (iCloud)', text: 'Dans la Bibliothèque, « Depuis Livres » liste vos EPUB et PDF de l’app Livres d’Apple. Les livres protégés (DRM) ne peuvent pas être importés. Avec « Synchroniser automatiquement », un livre sans DRM ajouté sur votre iPhone arrive tout seul dans Marginalia.' },
      { appleBooks: true, title: 'Surlignages, signets et position de Livres', text: 'Pour les EPUB sans DRM déjà dans Marginalia, vos surlignages (avec leurs notes), vos signets et l’endroit où vous en êtes dans Livres sont repris automatiquement, marqués « Livres ». Chaque couleur de Livres devient une catégorie (jaune → Thèse, vert → Argument, bleu → Concept, rose → Thèse adverse, violet → Exemple, souligné → Problème), modifiable dans « Depuis Livres » (une couleur peut aussi devenir un « Surlignage simple », sans catégorie, ou une note de marge). La synchro va de Livres vers Marginalia seulement : ce que vous changez ici n’est jamais écrasé, et rien n’est modifié dans Livres.' },
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
      { title: 'Mise en page et affichage', text: 'Tout se règle depuis un seul bouton, « Aa » en haut à droite du lecteur, qui ouvre un panneau en cinq parties (chacune se replie ; le panneau se souvient de ce que vous avez replié). Présentation : « Défilement continu » (par défaut : le texte d’un seul tenant, chaque changement de page marqué d’un trait et de son numéro dans la marge), « Feuilles » (une feuille par page, l’une sous l’autre, folio en bas) ou « Page par page » (une page à la fois, ou deux en vis-à-vis comme un livre ouvert : voir « Page par page »). Typographie : police (serif ou sans), taille, interligne, largeur du texte, connecteurs logiques mis en évidence, avec un aperçu. Livre : « Mise en page livre » (texte justifié et coupé, alinéas sans blanc entre paragraphes, titres centrés, vers au fer à gauche, comme un livre imprimé) et « Aspect papier » (teinte chaude et grain léger d’un vrai papier, sur toute la surface en défilement, sur chaque feuille ou chaque page sinon) ; les deux se combinent avec toutes les présentations. Numéros de page : affichés ou non, « Trait et numéro » ou « Numéro seul » (en feuilles et page par page, chaque page porte en plus son folio en bas). Thème : système, clair, sépia, sombre. Au clavier : Tab passe d’un réglage à l’autre, les flèches changent un choix, Échap ferme.' },
      { title: 'Rechercher dans le livre', text: 'La loupe de la barre du haut cherche dans tout le texte.' },
      { title: 'Deux textes côte à côte', text: 'Le bouton à deux colonnes ouvre un second livre à droite pour comparer deux passages ou deux auteurs.' },
      { title: 'Signets', text: 'Marquez un endroit pour le retrouver : le signet reçoit un nom (titre de section et début de phrase, ou « Page N »), modifiable. Ils sont listés dans l’onglet Signets du panneau de droite, repérés dans la marge, et trouvables avec ⌘K. Clic droit dans le texte : « Ajouter un signet ici ».', keys: ['⌘D', '⌘⌥↓', '⌘⌥↑'] },
      { title: 'Repères de page', text: 'Dans un EPUB (et les documents DOCX, Markdown, texte), un filet pointillé fin marque chaque changement de page, avec son numéro dans une petite pastille en marge ; une petite encoche montre le mot exact quand la page commence au milieu d’un paragraphe. Les numéros sont ceux du livre imprimé quand l’EPUB les donne (y compris en chiffres romains, « xii ») : ce sont aussi ceux des citations (« p. 67 »). Sinon, Marginalia estime une pagination stable (environ 1 800 signes par page, qui ne change pas avec la taille du texte) : l’indicateur le signale au survol, et les citations n’en tiennent pas compte. Réglage « Numéros de page » (bouton « Aa ») : trait et numéro, numéro seul, ou aucun repère. Les repères ne se sélectionnent ni ne se copient.' },
      { title: 'Page par page', text: 'Pour lire comme dans un livre ou une liseuse, choisissez « Page par page » dans « Mise en page et affichage » (bouton « Aa », partie Présentation) : le texte est mis en pages de format livre, avec le titre courant en haut et le numéro de page en bas (celui du livre imprimé quand l’EPUB le donne, « 12–13 » si la page d’écran en couvre deux). Sous « Pages à l’écran » : « Une page », « Deux pages » (livre ouvert) ou « Automatique » (deux pages quand la fenêtre est assez large). La mise en page livre et l’aspect papier s’y appliquent aussi. Chaque chapitre commence sur une nouvelle page. Tournez les pages avec les flèches, Page préc. / Page suiv., Espace (Maj+Espace pour revenir), un clic dans la marge de gauche ou de droite, ou en balayant le pavé tactile. Sélection, surlignages, notes, signets, recherche et « Aller à la page » fonctionnent comme en défilement.', keys: ['←', '→', 'Espace', '⇧Espace'] },
      { title: 'Aller à la page', text: 'Cliquez l’indicateur « p. 12 / 240 » en bas à droite (dans la barre du bas pour un PDF), tapez un numéro, Entrée. Les numéros imprimés sont acceptés : « 45 », « xii », et pour un PDF ses propres numéros de page (la page 17 du fichier peut être la page « 1 » du livre). Depuis ⌘K, tapez « p 45 », « page 45 » ou simplement « 45 » pendant la lecture. Si la page n’existe pas, Marginalia le dit (« Ce livre n’a pas de page 900 — dernière page : 412 »). Après le saut, la pastille « ← p. 12 » ramène à l’endroit quitté.', keys: ['⌘⌥G', '⌘K'] },
      { title: 'Images et scans', text: 'Une photo de page est lue par reconnaissance de texte : vous pouvez sélectionner et surligner son texte comme dans un livre.' },
    ],
    go: { label: 'Ouvrir la bibliothèque', route: { name: 'library' } },
  },
  {
    id: 'annoter',
    title: 'Surligner et annoter',
    icon: <Highlighter size={16} />,
    intro: 'Sélectionnez un passage : une barre apparaît pour le surligner simplement ou le classer selon son rôle dans l’argumentation. Chaque passage surligné devient un extrait.',
    items: [
      { title: 'Surligner sans classer', text: <>Pour simplement marquer un passage, appuyez sur <K>H</K> ou <K>0</K> (ou « Surligner », le premier bouton de la barre) : le passage reçoit un surlignage ocre doux, sans catégorie ni note, et aucune fenêtre ne s’ouvre. Plus tard, dans le panneau Extraits, classez-le d’un clic (les pastilles de couleur sous l’extrait) ou ajoutez-lui une note : sans catégorie, il devient alors une note de marge. Le filtre « Surlignages » les retrouve. Dans la synchro avec Livres, une couleur peut aussi être importée comme « Surlignage simple ».</> },
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
      { title: 'Relier', text: 'Tirez un lien depuis le bord d’une carte vers une autre. Tout nouveau lien est neutre : un trait fin, gris, sans flèche, qui relie sans rien affirmer ; il va de la carte d’où vous tirez vers celle où vous lâchez. Lâcher un lien dans le vide crée une nouvelle carte, reliée de la même façon (Tab aussi crée une carte « enfant » ainsi reliée). Cliquer un lien (ou clic droit) ouvre son menu : « Lien neutre » en tête, puis la nature du lien — soutient, objecte à, répond à, précise, illustre, s’oppose à. Le menu dit alors ce que le lien affirme (« Kant soutient la thèse ») ; si c’est à l’envers, « Inverser le sens » (⇄) retourne la flèche. Chaque choix s’annule par ⌘Z. Le menu permet aussi de regrouper le lien avec d’autres.', keys: ['⌘Z'] },
      { title: 'Clic droit', text: 'Sur une carte : Modifier, Dupliquer, Ouvrir dans le livre, Marquer comme thèse centrale, Supprimer la carte (l’extrait reste dans le livre). Dans le vide : Nouvelle idée ici, Ranger, Tout voir. Sur une sélection : aligner, colorer, supprimer.', keys: ['⌫'] },
      { title: 'Lire la carte', text: 'Chaque carte porte une bande de couleur et son rôle (Thèse, Argument, Problème, Thèse adverse, Concept, Exemple…). La thèse centrale (la première thèse, sauf choix contraire) est plus grande. Vos idées sont des post-it manuscrits ; les extraits gardent la typographie de citation. Un extrait long est replié sur 3 lignes : « Lire la suite » le déplie. Survoler un lien affiche sa relation ; son menu règle sa force (faible, moyen, fort), qui se voit à l’épaisseur du trait.' },
      { title: 'Déplacer et aligner', text: 'Une carte déplacée s’aimante aux bords et aux centres de ses voisines (lignes guides, espacements égaux) ; maintenez ⌘ pour la poser librement. Les cartes recouvertes s’écartent d’elles-mêmes. ⇧ + glisser dans le vide (ou l’outil sélection) encadre plusieurs cartes : une barre au-dessus permet d’aligner, de répartir, de colorer ou de supprimer.' },
      { title: 'Ranger en un clic', text: '« Ranger » propose Arbre (la thèse — ou le centre — en haut), Débat (la thèse à gauche, objections et réponses à droite), Chronologique (ordre du texte ; sur une carte libre, livre par livre) et Radial (le centre au milieu, les branches autour). ⌘Z rétablit la disposition précédente.', keys: ['⌘Z'] },
      {
        title: 'Un centre : problématique ou sujet',
        text: 'Le cœur de la carte peut être une problématique (une question : « Peut-on avoir le droit de mentir ? ») ou un sujet (un thème : « Le mensonge »). Posez-le depuis « Centre » dans la barre, le clic droit dans le vide ou la carte vide ; une idée existante devient centre par son clic droit (« Faire de cette idée la problématique / le sujet »), et inversement. La carte du centre est plus grande, son texte centré ; un « ? » marque la problématique. Les thèses qui y sont reliées « répondent à » la problématique, les idées « se rattachent au » sujet : la carte se lit comme un problème à résoudre ou un thème à explorer. Tab sur le centre crée une nouvelle carte qui lui est reliée par un lien neutre : choisissez « répond à » ou « se rattache à » dans le menu du lien (et inversez le sens pour que la thèse pointe vers le centre). Exemple : au centre « Peut-on avoir le droit de mentir ? » ; Kant répond « la véracité est un devoir formel envers chacun », Constant répond « dire la vérité n’est un devoir qu’envers ceux qui ont droit à la vérité », illustré par l’assassin à la porte. « Ranger › Arbre » met le centre en haut, « Radial » au milieu, ses branches tout autour ; le plan tiré de la carte prend la problématique pour problématique et chaque thèse pour une partie, le sujet pour thème du titre ; « Présenter » commence par lui.',
        keys: ['Tab'],
      },
      {
        title: 'Replier, déplier les branches',
        text: 'Comme dans une carte mentale, une carte qui a des « enfants » (ce qui la soutient, la précise, l’illustre, lui objecte ou lui répond, et ainsi de suite) porte au survol une pastille « − » sur son bord : un clic replie sa branche. Les cartes repliées sont masquées, pas supprimées ; la carte montre « +3 » et une pile de cartes derrière elle — un clic sur « +3 » les fait revenir. Exemple : repliez la branche de Kant pour travailler celle de Constant, puis rouvrez-la. ⌥↑ / ⌥↓ replient ou déplient la carte choisie ; ⌥⇧↑ / ⌥⇧↓ (ou « Centre » › « Tout replier / Tout déplier ») toute la carte, en gardant le centre et sa première couronne. Le repli est enregistré avec la carte et s’annule par ⌘Z ; l’export montre la carte telle qu’on la voit.',
        keys: ['⌥↑', '⌥↓', '⌥⇧↑', '⌥⇧↓'],
      },
      { title: 'Au clavier', text: 'Tab : nouvelle idée qui soutient la carte choisie, placée dessous. Entrée : modifier une idée (sur un extrait : carte sœur) ; ⇧ Entrée : carte sœur. Échap : terminer. Flèches : passer à la carte voisine. Double-clic dans le vide : nouvelle idée. ⇧1 : tout voir ; ⇧2 : zoom sur la sélection. La mini-carte, en bas à droite, se replie.', keys: ['Tab', '↩', '⇧1', '⇧2'] },
      { title: 'Zones', text: 'Sélectionnez des cartes puis « Encadrer dans une zone » (barre de sélection, clic droit ou ⌘G) : un cadre coloré et titré les regroupe (double-clic sur le titre pour le renommer). Glisser le titre déplace la zone avec ses cartes ; la poignée en bas à droite l’agrandit. Une carte glissée dans une zone en fait partie. Replier la zone n’en laisse qu’une étiquette (« Kant · 3 cartes »), ses liens vers le reste de la carte en pointillé ; la supprimer garde les cartes. « Ranger » déplace chaque zone d’un bloc, son contenu tel quel.', keys: ['⌘G'] },
      { title: 'Points à revoir', text: 'La pastille « 3 points à revoir » de la barre signale une thèse sans argument, une objection sans réponse, des extraits classés pas encore placés (bouton « Placer ») ou des cartes isolées. Un clic sur un signal centre la carte concernée ; « Afficher les signaux » les marque d’un point sur la carte.' },
      {
        title: 'Suivre une chaîne',
        text: 'Quand la carte grandit, on ne voit plus ce qui tient quoi. Choisissez une carte puis « Suivre la chaîne » (clic droit, bouton à maillons de la barre, ou L) : seule sa chaîne reste nette — ce qui la soutient, la précise ou l’illustre, et ce qui appuie ces appuis, plus les objections et leurs réponses, dans la couleur de leur relation ; le reste s’estompe. Un petit panneau fait le diagnostic : « 3 appuis indépendants · chaîne la plus longue : 2 · 1 objection sans réponse », et signale un point fragile (« tout repose sur… » : un clic le centre). « Conséquences » suit aussi ce que la carte soutient. Cliquer une autre carte recentre la chaîne sur elle ; Échap ou un clic dans le vide en sort. Exemple : la thèse « l’homme est condamné à être libre » ne repose que sur « l’existence précède l’essence » — si cette idée tombe, tout tombe : c’est elle qu’il faut étayer.',
        keys: ['L', 'Esc'],
      },
      { title: 'Exporter, versions', text: '« Exporter » enregistre la carte en image PNG, SVG ou PDF, toujours sur fond clair, sous le nom de la carte. « Insérer dans un écrit » copie l’image et ouvre l’écrit choisi (ou un nouveau) : collez-la avec ⌘V. « Versions » garde des instantanés : les vôtres (« Créer une version… ») et ceux pris d’office avant un rangement, une conversion ou la suppression de plusieurs cartes ; survolez pour un aperçu, « Restaurer » est annulable.', keys: ['⌘V'] },
      { title: 'Pourquoi ce lien ?', text: 'Dans le menu d’un lien, « Pourquoi ? » note le ressort du rapport (« par analogie », « par l’absurde »…). Un petit crayon sur le lien le signale ; la note s’affiche au survol, sous le nom de la relation, et figure dans l’export.' },

      { title: 'Cartes libres', text: 'Dans un espace, « Nouvelle carte ici » crée une carte qui n’appartient à aucun livre : idées, extraits de plusieurs livres, concepts, et cartes copiées depuis d’autres cartes (avec leurs liens), par le bouton « Ajouter ». Exemple : comparer Kant et Constant sur le mensonge dans l’espace « liberté ». Elle se retrouve avec ⌘K, se transforme en plan ou en écrit, et se supprime vers la corbeille.' },
      { title: 'Toutes vos cartes', text: 'L’onglet « Cartes », sous « Écrits », rassemble toutes les cartes : libres, de livres et de mouvements. On voit combien il y en a, et où chacune est rangée (espace, groupe, livre). « Par espace » les regroupe par espace de travail, « Récentes » par date. Un clic ouvre la carte ; un clic sur un lieu ouvre l’espace ou le livre.' },
      { title: 'Portails entre cartes', text: 'Une carte peut mener à une autre : barre de la carte, « Lien », ou clic droit dans le vide, « Lien vers une autre carte… » (sur une carte libre, aussi « Ajouter » › « Autres cartes » › « Poser un lien vers cette carte »). Le portail montre le titre de la carte visée, sa nature (libre, de livre, de mouvement), son nombre de cartes et une miniature ; « Ouvrir » ou un double-clic y mène, et une pastille « ← Revenir à… » ramène à la carte de départ. « Liée depuis N cartes », dans la barre, liste les cartes qui mènent ici. Un extrait posé sur plusieurs cartes porte un petit « aussi dans 2 cartes » : un clic les liste. Exemple : sur la carte libre « Kant contre Constant », un portail vers la carte du mouvement « II. Le droit de mentir » du livre de Constant ; une fois ce mouvement détaillé, « Revenir à Kant contre Constant ».' },
      { title: 'Livre à côté', text: '« Livre à côté », dans la barre de la carte, ouvre le texte dans un panneau à gauche (⇄ : à droite). Sélectionnez un passage et glissez-le sur la carte — ou glissez le bouton « Sur la carte » de la barre de sélection : un petit menu demande sa catégorie (Entrée : Surlignage ; 1 à 6 : Problème… Exemple), l’extrait est créé dans le livre et la carte posée là où vous l’avez lâchée. Un simple clic sur « Sur la carte » (C) la pose au centre. Sur une carte libre, choisissez d’abord le livre.', keys: ['C'] },
      { title: 'Présenter', text: '« Présenter » parcourt la carte en plein écran dans l’ordre de la lecture guidée : problème, thèse, arguments, objections, réponses. La carte courante est centrée, les liens qui la rattachent sont soulignés, la légende dit son rôle (« Argument 2/4 : soutient la thèse »). ← / → ou Espace pour avancer, Échap pour quitter. « Masquer le texte » (M) ne montre que les rôles : expliquez chaque carte à voix haute, puis cliquez-la pour vérifier.', keys: ['←', '→', 'Esc'] },
      { title: 'Plan, explication', text: 'Menu « … » de la barre : « Créer un plan à partir de la carte » (problème → sujet, thèse → problématique, arguments → parties, objections → discussion) ou « Rédiger une explication à partir de la carte » (un brouillon qui cite chaque extrait avec sa référence en note). Un aperçu annonce le nombre de parties et de citations ; une version de la carte est enregistrée avant, et le plan ou l’écrit s’ouvre aussitôt.' },
      { title: 'Une carte par mouvement', text: 'Dans la fiche-texte, « Carte du mouvement » ouvre la carte propre à ce mouvement (créée au besoin). Son tiroir « À placer » propose d’abord les extraits situés dans le mouvement. En haut de l’onglet Carte, le fil « Du contrat social › II. Réfutation » ramène à la carte du livre, et « Cartes de mouvement » passe de l’une à l’autre.' },
      { title: 'Comparer deux auteurs', text: 'Menu « … » de la carte d’un livre, « Comparer avec un autre livre… » (ou, dans un espace, « Comparer deux livres… » et le clic droit sur un livre) : une carte libre « Hobbes / Rousseau » pose les thèses et arguments de chacun dans sa colonne. Reliez-les : le lien naît neutre ; choisissez « s’oppose à » dans son menu pour marquer l’opposition des deux thèses. Créée depuis un espace, elle y est rangée.' },
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
      { title: 'Mise en forme', text: `Styles (Titre 1-3, Corps, Citation…), toutes les polices installées sur ${OS_TEXT.yourComputer}, couleurs, alignement, listes, tableaux (insérés depuis « + » ; le bouton Tableau apparaît dans la barre quand le curseur est dans un tableau), mise en page (marges, format : bouton page de la barre du haut), zoom. Fenêtre étroite : les outils qui ne tiennent pas sont sous « … ». Modèles : dissertation, explication de texte, fiche, présentation universitaire.` },
      { title: 'Page et zoom', text: 'La page prend la teinte du thème (crème, sépia, anthracite) ou celle choisie dans le menu Affichage (le pourcentage dans la barre du haut, à côté de la mise en page), qui règle aussi le zoom (« Ajuster à la largeur » par défaut) — affichage seulement : le fichier Word, les exports et l’impression gardent les vraies couleurs. Les nouveaux écrits partent en Literata 12, interligne 1,5 (police réglable dans le menu Nouveau).', keys: ['⌘+', '⌘-', '⌘0'] },
      { title: 'Reproduire la mise en forme', text: 'Le pinceau, au début de la barre d’outils, comme dans Word : placez le curseur (ou sélectionnez) dans le texte modèle, cliquez sur le pinceau, puis sélectionnez à la souris le texte à mettre en forme. Police, taille, gras, italique, souligné, barré, capitales, couleur, surlignage, exposant et indice sont repris ; depuis le curseur ou un paragraphe entier, aussi le style du paragraphe, l’alignement, l’interligne, les espacements et les retraits. Double-clic sur le pinceau : il reste actif pour plusieurs passages, jusqu’à Échap. Au clavier : copiez avec ⌥⌘C, appliquez avec ⌥⌘V (sans sélection : au mot sous le curseur). Un seul ⌘Z annule.', keys: ['⌥⌘C', '⌥⌘V'] },
      { title: 'Glisser-déposer le texte', text: 'Sélectionnez des mots, des phrases ou des paragraphes entiers, appuyez dans la sélection et glissez : un trait bleu montre où le texte ira (entre deux paragraphes pour des paragraphes entiers), et la page défile près des bords. Relâchez pour déplacer ; maintenez ⌥ en relâchant pour copier. Relâcher dans la sélection ou Échap annule. La mise en forme, les retours à la ligne, les notes de bas de page et les commentaires suivent le texte ; un seul ⌘Z annule. Exemple : sélectionnez une phrase et glissez-la au début du paragraphe précédent.', keys: ['⌥'] },
      { title: 'Notes', text: 'Notes de bas de page, et notes privées (fond teinté) : visibles pour vous, jamais exportées.', keys: ['⌘⌥F', '⌘⌥N'] },
      { title: 'Commentaires en marge', text: 'Sélectionnez un passage puis « Commenter » : une bulle s’ouvre dans la marge, à hauteur de la ligne (Entrée publie). Répondez, modifiez, marquez « résolu » ou supprimez (annulable) ; le bouton bulle de la barre du haut les affiche ou les masque. Ce sont de vrais commentaires Word : ils restent dans le .docx, mais pas dans les exports PDF, Markdown, web ou texte. Exemple : sélectionnez « une thèse discutable » et notez « À nuancer avec Kant ».', keys: ['⌘⌥M'] },
      { title: 'Citer en écrivant', text: 'Le panneau de droite affiche au choix un Livre (le vrai lecteur : sélectionnez un passage puis « Citer » ou C), vos Extraits, vos Concepts ou un Plan. Une citation garde son lien : ⌘-clic dessus ramène au passage du livre. Le panneau se redimensionne et se met en 50/50.' },
      { title: 'Outils d’écriture', text: `Typographie française automatique (espaces insécables, « guillemets », apostrophes), correcteur orthographique ${isMac ? 'sur le Mac' : 'intégré'} (clic droit sur un mot souligné), rechercher et remplacer, revue de style (phrases longues, répétitions, tics de copie), objectif de mots.`, keys: ['⌘F', '⌘⇧H'] },
      { title: 'Mode concentration', text: 'Bouton ↗ : pendant que vous écrivez, barres, plan et panneaux s’effacent ; ils reviennent quand la souris monte en haut de la fenêtre, ou avec Échap. Son menu propose d’estomper les autres paragraphes et la « machine à écrire », qui garde la ligne en cours au milieu de l’écran.', keys: ['⌘⇧F'] },
      { title: 'Marques de mise en forme', text: 'Bouton ¶ de la barre d’outils, comme dans Word : ¶ en fin de paragraphe (lignes vides comprises), · pour une espace, ° pour une espace insécable, → pour une tabulation, ↵ pour un retour à la ligne, et les sauts de page. Dans la marge, une étiquette indique le style, la police, la taille et l’alignement là où ils changent (survolez-la pour l’interligne, les retraits et les espacements) ; un pointillé souligne un passage dans une autre police ou taille. La carte « Mise en forme » détaille la sélection (« mixte » si elle varie). Affichage seulement : rien ne passe dans le fichier, les exports ni l’impression.', keys: ['⌘8'] },
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
    intro: `Choisissez l’ambiance, et sachez que vos textes ne quittent jamais ${OS_TEXT.yourComputer}.`,
    items: [
      { title: 'Thèmes', text: `Automatique (suit le mode clair/sombre ${OS_TEXT.systemName}), Clair, Sombre ou Sépia, en bas de la barre latérale.` },
      { title: '100 % local', text: `Aucune donnée n’est envoyée sur Internet : l’app bloque toute connexion sortante. La reconnaissance de texte et le correcteur fonctionnent hors ligne.${isMac ? ' La synchro avec Livres passe par iCloud Drive, géré par macOS.' : ''}` },
      { title: 'En cas de problème', text: `Menu Aide${isMac ? '' : ' (touche Alt)'} › « Exporter le journal de diagnostic » : un fichier est copié dans vos Téléchargements pour comprendre un bug.` },
    ],
  },
  {
    id: 'securite',
    title: 'Chiffrement et verrouillage',
    icon: <Shield size={16} />,
    intro: 'Deux options facultatives, désactivées au départ, dans Réglages › Confidentialité et sécurité (app de bureau).',
    guide: {
      why: 'Protéger vos lectures, notes et écrits si quelqu’un met la main sur une copie de vos fichiers (disque retiré, dossier copié, sauvegarde égarée), ou sur votre session ouverte.',
      how: [
        `« Chiffrer mes données sur ce ${isMac ? 'Mac' : 'PC'} » : la clé est rangée dans ${isMac ? 'le trousseau de macOS' : 'votre session Windows'}. Rien à taper ; Marginalia s’ouvre normalement, mais les fichiers copiés hors de votre session sont illisibles.`,
        '« Verrouiller Marginalia » : un mot de passe (ou Touch ID sur un Mac qui en dispose) est demandé à l’ouverture, et Marginalia se verrouille seul après le délai d’inactivité choisi (et, si vous le voulez, à la mise en veille).',
        'À l’activation, une clé de secours de 32 caractères s’affiche une seule fois : copiez-la, imprimez-la ou enregistrez-la en PDF, puis retapez deux de ses groupes pour confirmer.',
        'Mot de passe oublié : sur l’écran de verrouillage, « Utiliser la clé de secours », puis choisissez un nouveau mot de passe.',
      ],
      example: 'Votre Mac part en réparation : avec le chiffrement, le technicien qui copierait le dossier de Marginalia n’obtiendrait que des fichiers illisibles.',
      tip: `Sans mot de passe ni clé de secours, vos données sont définitivement illisibles. Pour protéger tout l’ordinateur, activez aussi ${isMac ? 'FileVault' : 'BitLocker'}.`,
    },
    items: [
      { title: 'Verrouiller maintenant', text: 'Menu Fichier › « Verrouiller maintenant » : vos modifications sont enregistrées, puis Marginalia oublie la clé jusqu’au prochain déverrouillage.', keys: ['⇧⌘L'] },
      { title: 'Ce qui est chiffré', text: 'La base (livres, extraits, notes, cartes, écrits, réglages), les fichiers de la bibliothèque, les sauvegardes automatiques et le journal de diagnostic. Le chiffrement et le déchiffrement se font en arrière-plan et reprennent s’ils sont interrompus.' },
      { title: 'Ce qui reste en clair', text: 'Les exports (Word, PDF, Markdown, page web, images) : ce sont des copies faites pour être partagées. Une sauvegarde complète peut être chiffrée (restaurée avec la clé de secours) ou en clair, au choix.' },
      { title: 'Après une mise à jour', text: isMac ? 'macOS peut demander si Marginalia peut utiliser « Marginalia Safe Storage » : répondez « Toujours autoriser ». Si le trousseau refuse, Marginalia demande la clé de secours, puis la range de nouveau.' : 'Si Windows ne rend plus la clé (session changée, réinstallation), Marginalia demande la clé de secours, puis la range de nouveau.' },
    ],
    go: { label: 'Ouvrir les réglages', route: { name: 'settings' } },
  },
];

const SHORTCUTS_ALL: [string, string][] = [
  ['⌘K', 'Rechercher partout'],
  ['⇧⌘L', 'Verrouiller Marginalia (si le verrouillage est activé)'],
  ['⌘O', 'Importer'],
  ['⌘Z / ⌘⇧Z', 'Annuler / rétablir'],
  ['H / 0', 'Surligner la sélection, sans catégorie'],
  ['1 – 6', 'Classer la sélection (Problème… Exemple)'],
  ['N / M', 'Note de marge / début de mouvement'],
  ['⌘D', 'Ajouter un signet'],
  ['⌘⌥↓ / ⌘⌥↑', 'Signet suivant / précédent'],
  ['⌘⌥G', 'Aller à la page… (lecteur)'],
  ['← / → · Espace / ⇧Espace', 'Page précédente / suivante (lecture page par page)'],
  ['⌘F / ⌘⇧H', 'Rechercher / remplacer (Écrire)'],
  ['⌘+ / ⌘- / ⌘0', 'Zoom de la page / ajuster à la largeur (Écrire)'],
  ['⌘⌥F', 'Note de bas de page'],
  ['⌘⌥N', 'Note privée'],
  ['⌘⌥M', 'Commenter la sélection (Écrire)'],
  ['⌘⌥S', 'Créer une version'],
  ['⌘⇧F', 'Mode concentration (Écrire)'],
  ['⌘8', 'Marques de mise en forme ¶ (Écrire)'],
  ['⌥⌘C / ⌥⌘V', 'Copier / coller la mise en forme (Écrire)'],
  ['⌥ en déposant', 'Copier le texte glissé au lieu de le déplacer (Écrire)'],
  ['⌥⇧↑ / ⌥⇧↓', 'Déplacer une section du plan ; Carte : tout replier / déplier'],
  ['⌥↑ / ⌥↓', 'Carte : replier / déplier la branche choisie'],
  ['⌘S', 'Enregistrer l’écrit'],
  ['⌘A', 'Tout sélectionner (listes)'],
  ['L', 'Suivre la chaîne de la carte choisie (Carte)'],
  ['Échap', 'Fermer / désélectionner'],
  ['⌃⌘S', 'Replier / afficher la barre latérale'],
  ['⌘?', 'Ouvrir cette aide'],
];
const SHORTCUTS: [string, string][] = SHORTCUTS_ALL.map(([k, v]) => [fmtKeys(k), v]);

/** Sections affichées : sans les fonctions de l'app Livres là où elle n'existe pas. */
const visibleSections = (): Section[] => {
  if (appleBooksAvailable()) return SECTIONS;
  return SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => !i.appleBooks) }));
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const textOf = (n: ReactNode): string => (typeof n === 'string' ? n : Array.isArray(n) ? n.map(textOf).join(' ') : n && typeof n === 'object' && 'props' in n ? textOf((n as { props: { children?: ReactNode } }).props.children) : '');

export function HelpView() {
  const navigate = useStore((s) => s.navigate);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(SECTIONS[0].id);
  const scroller = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => {
    const words = fold(q.trim()).split(/\s+/).filter(Boolean);
    const all = visibleSections();
    if (!words.length) return all;
    return all.map((s) => {
      const hit = (t: string) => words.every((w) => fold(t).includes(w));
      const g = GUIDES[s.id];
      if (hit(s.title + ' ' + s.intro + (g ? ` ${g.why} ${g.how.join(' ')} ${g.example ?? ''} ${g.tip ?? ''}` : ''))) return s;
      const items = s.items.filter((i) => hit(`${i.title} ${textOf(i.text)} ${(i.keys ?? []).map(fmtKeys).join(' ')}`));
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
          <input placeholder={`Chercher dans l’aide (ex. « citer », « signet », « ${isMac ? 'iCloud' : 'export'} »)`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Chercher dans l’aide" />
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
          <button className={`help-index-item ${active === 'lexique' ? 'active' : ''}`} onClick={() => goTo('lexique')}>
            <BookA size={16} />
            <span>Lexique</span>
          </button>
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
                {GUIDES[s.id] && !q.trim() && (
                  <div className="help-guide">
                    <div className="help-guide-col">
                      <h3>À quoi ça sert</h3>
                      <p>{fmtKeys(GUIDES[s.id].why)}</p>
                      {GUIDES[s.id].example && (
                        <p className="help-example">
                          <strong>Exemple — </strong>
                          {GUIDES[s.id].example}
                        </p>
                      )}
                    </div>
                    <div className="help-guide-col">
                      <h3>Comment s’en servir</h3>
                      <ol>
                        {GUIDES[s.id].how.map((h) => (
                          <li key={h}>{fmtKeys(h)}</li>
                        ))}
                      </ol>
                    </div>
                    {GUIDES[s.id].tip && <p className="help-tip">💡 {fmtKeys(GUIDES[s.id].tip!)}</p>}
                  </div>
                )}
                {GUIDES[s.id] && !q.trim() && <h3 className="help-sub">Ce que vous pouvez faire</h3>}
                <div className="help-items">
                  {s.items.map((it) => (
                    <div key={it.title} className="help-item">
                      <h3>{it.title}</h3>
                      {typeof it.text === 'string' && /^1\. /.test(it.text) ? (
                        <ol className="help-steps">
                          {it.text
                            .split(/\s*\d+\. /)
                            .filter(Boolean)
                            .map((step) => (
                              <li key={step}>{fmtKeys(step)}</li>
                            ))}
                        </ol>
                      ) : (
                        <p>{typeof it.text === 'string' ? fmtKeys(it.text) : it.text}</p>
                      )}
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
            {(() => {
              const words = fold(q.trim()).split(/\s+/).filter(Boolean);
              const rows = GLOSSARY.filter(([t, d]) => words.every((w) => fold(`${t} ${d}`).includes(w)));
              if (!rows.length) return null;
              return (
                <section id="help-lexique" className="help-section">
                  <h2>
                    <span className="help-icon">
                      <BookA size={16} />
                    </span>
                    Lexique de l’app
                  </h2>
                  <p className="help-intro">Les mots de Marginalia, en une phrase chacun.</p>
                  <dl className="help-glossary">
                    {rows.map(([t, d]) => (
                      <div key={t}>
                        <dt>{t}</dt>
                        <dd>{d}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              );
            })()}
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
                  <Shield size={13} /> Marginalia fonctionne entièrement sur {OS_TEXT.yourComputer}. <Bookmark size={13} /> Astuce : {fmtKeys('⌘K')} trouve aussi vos signets.
                </p>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
