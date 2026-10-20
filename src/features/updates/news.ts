// ─────────────────────────────────────────────────────────────
// Nouveautés de chaque version, livrées avec l'app (aucun réseau) : la fenêtre « Quoi de neuf »
// s'ouvre au premier lancement d'une nouvelle version et montre les versions pas encore vues.
// Ajouter une entrée EN TÊTE à chaque Release (même texte, en plus court, que la Release GitHub).
// ─────────────────────────────────────────────────────────────

export type NewsIcon = 'phone' | 'notes' | 'update' | 'map' | 'lock' | 'sparkles';
export type NewsAction = 'wifi' | 'inbox' | 'settings' | 'maps' | 'import' | 'tour';

export interface NewsItem {
  icon: NewsIcon;
  title: string;
  text: string;
  action?: { label: string; run: NewsAction };
}

export interface NewsEntry {
  version: string;
  items: NewsItem[];
}

export const NEWS: NewsEntry[] = [
  {
    version: '3.41',
    items: [
      {
        icon: 'notes',
        title: 'Écrire : lignes vides et alignement',
        text: 'Supprimer une ligne vide n’efface plus le texte au-dessus, et centrer une sélection ne change que les lignes choisies.',
      },
    ],
  },
  {
    version: '3.40',
    items: [
      {
        icon: 'lock',
        title: 'Rien ne reste ouvert après une session',
        text: 'Quitter une session à plusieurs, ou recevoir une copie, ferme aussitôt la connexion par Internet.',
      },
    ],
  },
  {
    version: '3.39',
    items: [
      {
        icon: 'update',
        title: 'Windows : ouverture au premier clic',
        text: 'La fenêtre s’affiche à chaque lancement, et l’app se rouvre d’elle-même après une mise à jour.',
      },
      {
        icon: 'sparkles',
        title: 'Code d’envoi : deux minutes',
        text: 'Le code pour envoyer une copie vaut maintenant deux minutes, le temps qu’une connexion lente aboutisse.',
      },
    ],
  },
  {
    version: '3.38',
    items: [
      {
        icon: 'lock',
        title: 'Permissions respectées chez l’invité',
        text: 'Ce que l’hôte n’a pas permis est refusé tout de suite, avec la raison. Les documents de l’espace restent lisibles.',
      },
    ],
  },
  {
    version: '3.37',
    items: [
      {
        icon: 'lock',
        title: 'Ce que les invités peuvent faire',
        text: 'En ouvrant une session à plusieurs, cochez ce que les invités peuvent modifier : extraits et notes, écrits, cartes, rangement de l’espace. Le reste est en lecture seule.',
      },
      {
        icon: 'sparkles',
        title: 'Envoyer une copie par Internet',
        text: 'Le code à 6 chiffres suffit, même loin : de pair à pair, chiffré de bout en bout, valable une minute. Clic droit sur un espace › Partager.',
      },
      {
        icon: 'update',
        title: 'Mises à jour quand vous voulez',
        text: 'Une nouvelle version est proposée, téléchargée si vous le demandez, installée au redémarrage que vous choisissez.',
      },
      {
        icon: 'lock',
        title: 'Connexion par Internet renforcée',
        text: 'Le rendez-vous tiré du code change toutes les 10 minutes. Par Internet, la 3.37 ne se connecte plus aux 3.35 et 3.36 : mettez à jour chaque ordinateur.',
        action: { label: 'Voir le réglage', run: 'settings' },
      },
    ],
  },
  {
    version: '3.36',
    items: [
      {
        icon: 'sparkles',
        title: 'Combien de personnes ?',
        text: 'En ouvrant une session à plusieurs, choisissez de 2 à 6 personnes (vous compris). Le nombre se change pendant la session, sans jamais exclure quelqu’un de présent.',
      },
      {
        icon: 'notes',
        title: '« Copier le code »',
        text: 'Sous le code de la session, un bouton le copie pour l’envoyer par message à quelqu’un qui est loin. Les autres boutons « Copier » de l’app fonctionnent de nouveau.',
      },
    ],
  },
  {
    version: '3.35',
    items: [
      {
        icon: 'sparkles',
        title: 'Travailler à plusieurs, même à distance',
        text: 'Plus besoin d’être sur le même Wi-Fi : le code à 6 chiffres suffit. La connexion se fait de pair à pair, chiffrée de bout en bout, et l’hôte accepte toujours chaque arrivée. Après un code faux, 10 secondes avant d’en essayer un autre.',
        action: { label: 'Voir le réglage', run: 'settings' },
      },
      {
        icon: 'update',
        title: 'Windows : vous choisissez quand redémarrer',
        text: 'La mise à jour se télécharge toute seule, mais ne s’installe plus à la fermeture. « Redémarrer pour mettre à jour » quand vous voulez ; une petite fenêtre montre l’installation en cours.',
      },
      {
        icon: 'notes',
        title: 'Infobulles et curseur',
        text: 'Les infobulles ont le style de l’app, et le curseur devient une main sur tout ce qui se clique.',
      },
    ],
  },
  {
    version: '3.34',
    items: [
      {
        icon: 'update',
        title: 'Windows : Marginalia se rouvre après une mise à jour',
        text: 'Après « Redémarrer pour mettre à jour », Marginalia attend la fin de l’installation puis se rouvre d’elle-même.',
      },
    ],
  },
  {
    version: '3.33',
    items: [
      {
        icon: 'phone',
        title: 'Le code-barres se lit mieux',
        text: 'Quand le fond sombre du livre touche le code-barres, le téléphone repère maintenant les barres, recadre et relit : la plupart des livres de poche passent du premier coup.',
      },
    ],
  },
  {
    version: '3.32',
    items: [
      {
        icon: 'sparkles',
        title: 'Vos livres papier dans Marginalia',
        text: 'Bibliothèque › « Livre papier » : cherchez le titre, l’auteur ou l’ISBN (Google Books et Open Library), ou photographiez le code-barres avec le téléphone. Recopiez des extraits avec leur page, ou prenez la page en photo : Marginalia devine le livre et la page, sur votre ordinateur. Les citations portent la référence de votre édition.',
      },
      {
        icon: 'update',
        title: 'Retour à l’espace de travail, tutoriel plus fluide',
        text: 'Un écrit ouvert depuis un espace ramène à cet espace. Dans le tutoriel, la mise en lumière glisse d’une étape à l’autre.',
      },
    ],
  },
  {
    version: '3.31',
    items: [
      {
        icon: 'map',
        title: 'Garder l’espace après avoir travaillé ensemble, ou non',
        text: 'À la fin d’une session à plusieurs, la personne invitée choisit : garder l’espace reçu, à jour, ou ne pas le garder (il va dans la corbeille, 30 jours). Ce qu’elle avait déjà dans sa bibliothèque reste toujours.',
      },
      {
        icon: 'sparkles',
        title: 'Pointeurs plus fluides dans les livres',
        text: 'Le pointeur des autres suit leur geste sans à-coup, même en fin de ligne et pendant une sélection ; le prénom reste sur le pointeur.',
      },
    ],
  },
  {
    version: '3.30',
    items: [
      {
        icon: 'notes',
        title: 'Imprimer un écrit',
        text: 'Dans Écrire, « Exporter › Imprimer… » envoie l’écrit à l’imprimante exactement comme dans l’export PDF : mêmes pages, sauts de page, notes de bas de page, numéros et polices.',
      },
    ],
  },
  {
    version: '3.29',
    items: [
      {
        icon: 'update',
        title: 'Mises à jour automatiques',
        text: 'Les prochaines versions se téléchargent en arrière-plan : « Redémarrer pour mettre à jour », ou elles s’installent à la fermeture. Chaque version est signée et vérifiée avant l’installation. Réglages › Mises à jour pour choisir « Me demander ».',
        action: { label: 'Réglages', run: 'settings' },
      },
    ],
  },
  {
    version: '3.28',
    items: [
      {
        icon: 'sparkles',
        title: 'Plusieurs photos, un seul document',
        text: 'Cochez des photos dans la Boîte de réception, ou sélectionnez-les dans la bibliothèque, puis « Assembler en un document » : vous choisissez l’ordre et le titre, et le document se lit page par page, avec texte reconnu, extraits et recherche sur toutes les pages.',
        action: { label: 'Voir', run: 'inbox' },
      },
      {
        icon: 'phone',
        title: 'Partager avec un autre Marginalia',
        text: 'Partagez un espace ou une sélection : un fichier « .marginalia » à donner, ou un envoi direct par le Wi-Fi avec un code à 6 chiffres, sans Internet. L’autre personne reçoit une copie, ajoutée sans rien écraser ; les livres ne partent que si vous le choisissez.',
        action: { label: 'Importer', run: 'import' },
      },
      {
        icon: 'map',
        title: 'Travailler à plusieurs, en direct',
        text: 'Dans un espace, « Partager › Travailler ensemble » : jusqu’à 6 personnes sur le même Wi-Fi modifient en direct les écrits et les cartes. Chacun a sa couleur : on voit les pointeurs des autres sur les cartes et dans les livres, et le texte qu’ils sélectionnent. Tout est chiffré et ne passe pas par Internet.',
      },
    ],
  },
  {
    version: '3.27',
    items: [
      {
        icon: 'sparkles',
        title: 'On voit la lecture du texte d’une image',
        text: 'Pendant que Marginalia reconnaît le texte d’une photo ou d’un scan, un faisceau balaie l’image et les lignes s’éclairent à son passage, dans le lecteur comme sur la photo de la Boîte de réception.',
      },
    ],
  },
  {
    version: '3.26',
    items: [
      {
        icon: 'sparkles',
        title: 'Tous les boutons « Importer » mènent à la page Importer',
        text: 'Dans la bibliothèque et sur l’accueil aussi, « Importer » ouvre la page où choisir : fichiers ou dossier de l’ordinateur, QR code du téléphone, dossier synchronisé ou app Livres. ⌘O / Ctrl+O ouvre toujours directement le choix de fichiers.',
        action: { label: 'Voir', run: 'import' },
      },
    ],
  },
  {
    version: '3.25',
    items: [
      {
        icon: 'sparkles',
        title: 'Une visite guidée, par votre compagnon',
        text: 'Votre compagnon présente tous les outils un par un, chacun mis en lumière dans l’interface. Elle démarre d’elle-même pour les nouveaux utilisateurs, et se relance quand vous voulez depuis l’Aide.',
        action: { label: 'Lancer la visite', run: 'tour' },
      },
      {
        icon: 'sparkles',
        title: 'La reconnaissance du texte, quand vous le décidez',
        text: 'Une photo ou un scan s’ouvre tout de suite, sans lancer la lecture de son texte. Un bouton « Reconnaître le texte » la lance quand vous en avez besoin, sur l’image comme dans la Boîte de réception.',
      },
      {
        icon: 'phone',
        title: 'Vos écrits, sur le téléphone',
        text: 'Dans Écrire, « Exporter › Sur le téléphone » affiche un QR code : scannez-le, et votre écrit se télécharge sur l’iPhone ou le téléphone Android, en PDF ou en Word. Par le Wi-Fi, sans rien qui passe par Internet.',
      },
    ],
  },
  {
    version: '3.24',
    items: [
      {
        icon: 'sparkles',
        title: 'Une page « Importer »',
        text: 'Le bouton Importer ouvre une page où glisser des fichiers ou un dossier entier (sous-dossiers compris), choisir sur l’ordinateur, afficher le QR code du téléphone, ou passer par un dossier synchronisé et l’app Livres.',
        action: { label: 'Voir', run: 'import' },
      },
      {
        icon: 'phone',
        title: 'Vous savez où va chaque envoi',
        text: 'Après un envoi par QR code, l’ordinateur et le téléphone disent ce qu’il est devenu : ajouté à la bibliothèque, extrait au bon endroit du livre, ou à valider dans la Boîte de réception. Un bouton y mène directement.',
      },
      {
        icon: 'lock',
        title: 'Sur Mac, l’autorisation de Livres guidée',
        text: 'Après une mise à jour, macOS oublie l’autorisation « Accès complet au disque » donnée à l’ancienne version. Marginalia le détecte et vous guide pas à pas pour la redonner.',
      },
      {
        icon: 'update',
        title: 'Sur Windows, plus d’alerte d’antivirus, et des menus fiables',
        text: 'La liste des polices est lue directement dans les fichiers de polices, sans lancer de programme. Le menu « + » de l’éditeur s’ouvre aussi par sa petite flèche, et les menus ne passent plus sous la barre de titre.',
      },
    ],
  },
  {
    version: '3.23',
    items: [
      {
        icon: 'phone',
        title: 'Recevoir depuis le téléphone, par le Wi-Fi',
        text: 'Scannez un QR code avec votre iPhone ou votre téléphone Android : photos de pages, livres PDF ou EPUB, documents Word et passages copiés arrivent dans la Boîte de réception. Sans compte, sans rien installer, et rien ne passe par Internet.',
        action: { label: 'Essayer', run: 'wifi' },
      },
      {
        icon: 'notes',
        title: 'Toutes vos notes d’un livre, en un geste',
        text: 'Collez les notes copiées depuis l’app Livres ou Google Play Livres : chaque passage retrouvé dans vos livres devient un extrait, au bon endroit, avec votre note.',
      },
      {
        icon: 'update',
        title: 'Nouvelles versions signalées',
        text: 'Au lancement, Marginalia regarde s’il existe une nouvelle version et vous en présente les nouveautés. Aucune donnée n’est envoyée ; vous pouvez désactiver cette vérification dans les Réglages.',
        action: { label: 'Réglages', run: 'settings' },
      },
    ],
  },
];

/** Compare deux versions (« 3.22 », « v3.22.1 ») : < 0, 0, > 0. */
export function compareVersions(a: string, b: string): number {
  const p = (v: string) => String(v || '').replace(/^v/i, '').split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : 0));
  const x = p(a);
  const y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Nouveautés à montrer : versions plus récentes que `seen`, jusqu'à `current` comprise, la plus récente d'abord. */
export function newsSince(seen: string | undefined, current: string, all: NewsEntry[] = NEWS): NewsEntry[] {
  return all
    .filter((e) => compareVersions(e.version, current) <= 0 && (!seen || compareVersions(e.version, seen) > 0))
    .sort((a, b) => compareVersions(b.version, a.version));
}
