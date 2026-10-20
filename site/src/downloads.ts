// Liens de téléchargement directs : la dernière version publiée sur GitHub (copies à nom fixe créées
// par .github/workflows/release.yml). Le dépôt doit être public pour que ces liens marchent.
// Laisser une URL vide affiche « Bientôt ».
const BASE = 'https://github.com/FavveyAxel/marginalia/releases/latest/download';
export const VERSION = '3.41';

export interface Download {
  id: 'mac-arm64' | 'mac-x64' | 'win-x64' | 'win-arm64';
  os: 'mac' | 'win';
  label: string;
  detail: string;
  url: string;
  size: string;
}

export const DOWNLOADS: Download[] = [
  { id: 'mac-arm64', os: 'mac', label: 'Mac Apple Silicon', detail: 'M1, M2, M3, M4 et suivants', url: `${BASE}/Marginalia-mac-arm64.dmg`, size: '96 Mo' },
  { id: 'mac-x64', os: 'mac', label: 'Mac Intel', detail: 'Mac d’avant 2021', url: `${BASE}/Marginalia-mac-x64.dmg`, size: '104 Mo' },
  { id: 'win-x64', os: 'win', label: 'Windows', detail: 'PC classique, Windows 10 et 11', url: `${BASE}/Marginalia-win-x64-setup.exe`, size: '73 Mo' },
  { id: 'win-arm64', os: 'win', label: 'Windows ARM', detail: 'Surface Pro X / 11, Snapdragon', url: `${BASE}/Marginalia-win-arm64-setup.exe`, size: '69 Mo' },
];
