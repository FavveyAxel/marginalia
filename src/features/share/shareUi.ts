// État et outils de l'interface du partage : quelle fenêtre est ouverte (Partager, Recevoir), et
// quelques aides communes. Les fenêtres elles-mêmes : ShareDialog.tsx, ReceiveDialog.tsx (montées par ShareHost.tsx).
import { create } from 'zustand';
import type { ShareSelection } from './sharePackage';

export interface ReceiveSource {
  /** Un fichier « .marginalia » déjà en main (ouvert, glissé, choisi) : aperçu direct, sans code. */
  file?: { name: string; data: ArrayBuffer | Uint8Array };
}

interface ShareUiState {
  send: ShareSelection | null;
  receive: ReceiveSource | null;
  /** Nonce : une même fenêtre rouverte repart de zéro. */
  nonce: number;
  openSend(sel: ShareSelection): void;
  openReceive(src?: ReceiveSource): void;
  closeSend(): void;
  closeReceive(): void;
}

export const useShareUi = create<ShareUiState>((set) => ({
  send: null,
  receive: null,
  nonce: 0,
  openSend: (sel) => set((s) => ({ send: sel, nonce: s.nonce + 1 })),
  openReceive: (src = {}) => set((s) => ({ receive: src, nonce: s.nonce + 1 })),
  closeSend: () => set({ send: null }),
  closeReceive: () => set({ receive: null }),
}));

/** Ouvre la fenêtre « Partager » (espace entier, ou liste d'éléments). */
export const openShareDialog = (sel: ShareSelection) => useShareUi.getState().openSend(sel);
/** Ouvre la fenêtre « Recevoir » (avec un fichier .marginalia, ou pour saisir un code). */
export const openReceiveDialog = (src?: ReceiveSource) => useShareUi.getState().openReceive(src);

/** Partage par le réseau local disponible ? (app de bureau seulement.) */
export const shareNetAvailable = () => typeof window !== 'undefined' && !!window.marginalia?.shareNet;

/** « 12 Ko », « 3,4 Mo », « 1,2 Go ». */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1).replace('.', ',')} Mo`;
  return `${(bytes / 1073741824).toFixed(1).replace('.', ',')} Go`;
}

/** Message d'une erreur, sans le préfixe ajouté par Electron aux erreurs venant du processus principal. */
export function errorMessage(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/** Nom de fichier sûr pour l'enregistrement, d'après le titre. */
export function fileNameFor(title: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return base || 'Partage Marginalia';
}

/** Ce qui accompagne l'envoi par le réseau (chiffré, montré au destinataire avant d'accepter) : 16 Ko au plus. */
export interface WireMeta {
  title: string;
  scope: 'workspace' | 'items';
  shareId: string;
  sentence: string;
  counts: Record<string, number>;
  booksIncluded: boolean;
  size: number;
  /** `format` : 'paper' pour un livre papier (sans fichier, jamais compté « à importer »). */
  books: { title: string; size: number; included: boolean; sha256: string | null; format?: string }[];
}

/** Secours quand les deux ordinateurs n'ont pas de Wi-Fi commun (le partage reste sur le réseau local). */
export function hotspotHint(platform?: string): string {
  const name = platform === 'win32' ? 'Point d’accès mobile' : platform === 'darwin' ? 'Partage de connexion' : 'point d’accès Wi-Fi';
  const where = platform === 'win32' || platform === 'darwin' ? `(${platform === 'win32' ? 'Windows' : 'Mac'} : ${name})` : `(${name})`;
  return `Pas de Wi-Fi commun ? Créez un point d’accès sur cet ordinateur ${where} ou utilisez le partage de connexion d’un téléphone, et connectez-y l’autre ordinateur.`;
}
