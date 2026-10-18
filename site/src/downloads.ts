// Liens de téléchargement des installeurs : à renseigner une fois l'hébergement choisi
// (dépôt public de versions, Vercel Blob…). Laisser vide affiche « Lien bientôt disponible ».
export const VERSION = '3.22';

export interface Download {
  id: 'mac-arm64' | 'mac-x64' | 'win-x64' | 'win-arm64';
  os: 'mac' | 'win';
  label: string;
  detail: string;
  url: string;
  size: string;
}

export const DOWNLOADS: Download[] = [
  { id: 'mac-arm64', os: 'mac', label: 'Mac Apple Silicon', detail: 'M1, M2, M3, M4 et suivants', url: '', size: '96 Mo' },
  { id: 'mac-x64', os: 'mac', label: 'Mac Intel', detail: 'Mac d’avant 2021', url: '', size: '104 Mo' },
  { id: 'win-x64', os: 'win', label: 'Windows', detail: 'PC classique, Windows 10 et 11', url: '', size: '73 Mo' },
  { id: 'win-arm64', os: 'win', label: 'Windows ARM', detail: 'Surface Pro X / 11, Snapdragon', url: '', size: '69 Mo' },
];
