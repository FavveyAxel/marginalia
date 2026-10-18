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
    version: '3.28',
    items: [
      {
        icon: 'sparkles',
        title: 'Plusieurs photos, un seul document',
        text: 'Cochez des photos dans la Boîte de réception, ou sélectionnez-les dans la bibliothèque, puis « Assembler en un document » : vous choisissez l’ordre et le titre, et le document se lit page par page, avec texte reconnu, extraits et recherche sur toutes les pages.',
        action: { label: 'Voir', run: 'inbox' },
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
