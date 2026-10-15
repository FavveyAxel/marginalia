// Reconnaissance du vrai type d'un fichier d'après ses premiers octets : un nom sans extension
// (ou avec une extension trompeuse) ne doit jamais faire lire une photo comme un texte.
import { sniff as sniffImage } from '../features/reader/image/decode';
import type { BookFormat } from './types';

export interface Sniffed {
  format: BookFormat | null;
  /** Extension à donner au fichier stocké (ex. « jpeg », « heic », « pdf »). */
  ext: string | null;
}

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));

export function sniffFile(data: ArrayBuffer): Sniffed {
  const b = new Uint8Array(data, 0, Math.min(4096, data.byteLength));
  const img = sniffImage(b);
  if (img) return { format: 'image', ext: img === 'jpeg' ? 'jpg' : img };
  if (ascii(b, 0, 5) === '%PDF-') return { format: 'pdf', ext: 'pdf' };
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    const head = ascii(b, 0, b.length);
    if (head.includes('mimetypeapplication/epub+zip')) return { format: 'epub', ext: 'epub' };
    if (head.includes('word/') || head.includes('[Content_Types].xml')) return { format: 'docx', ext: 'docx' };
  }
  return { format: null, ext: null };
}

/** Vrai si le début du fichier ressemble à des données binaires (et non à du texte). */
export function looksBinary(data: ArrayBuffer): boolean {
  const b = new Uint8Array(data, 0, Math.min(8192, data.byteLength));
  let odd = 0;
  for (const c of b) {
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) odd++;
  }
  return b.length > 0 && odd / b.length > 0.1;
}
