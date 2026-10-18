// ─────────────────────────────────────────────────────────────
// Nouveautés de chaque version, livrées avec l'app (aucun réseau) : la fenêtre « Quoi de neuf »
// s'ouvre au premier lancement d'une nouvelle version et montre les versions pas encore vues.
// Ajouter une entrée EN TÊTE à chaque Release (même texte, en plus court, que la Release GitHub).
// ─────────────────────────────────────────────────────────────

export type NewsIcon = 'phone' | 'notes' | 'update' | 'map' | 'lock' | 'sparkles';
export type NewsAction = 'wifi' | 'inbox' | 'settings' | 'maps';

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
