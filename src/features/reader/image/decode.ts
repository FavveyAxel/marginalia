// Décodage des images importées comme documents (photo ou scan d'une page).
// Chromium décode JPEG, PNG, WebP (et GIF, BMP) ; HEIC et TIFF passent par l'hôte quand il sait
// les convertir (app Mac : outil système `sips`), sinon un message clair est affiché.
import { extOf, host, IMAGE_EXTENSIONS } from '../../../lib/platform';

export const isImageName = (name: string) => IMAGE_EXTENSIONS.includes(extOf(name));

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

export class ImageDecodeError extends Error {}

/**
 * Orientation EXIF appliquée (photo de téléphone tenue de travers) : l'image décodée pour l'OCR
 * et la miniature sont dans le même sens que l'<img> affichée (`image-orientation: from-image`),
 * donc les boîtes des mots et les surlignages tombent au bon endroit.
 */
export const ORIENT: ImageBitmapOptions = { imageOrientation: 'from-image' };

/** Type réel d'après les premiers octets (le nom de fichier peut mentir). */
function sniff(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a)) return 'tiff';
  const ftyp = String.fromCharCode(...b.slice(4, 12));
  if (ftyp.startsWith('ftyp') && /heic|heix|hevc|mif1|msf1|heif/.test(ftyp)) return 'heic';
  return null;
}

/**
 * Renvoie une image affichable par le moteur de rendu (Blob), en convertissant au besoin.
 * `converted` : vrai si le Blob vient d'une conversion (à mettre en cache par l'appelant).
 */
export async function displayableBlob(data: ArrayBuffer, name: string): Promise<{ blob: Blob; converted: boolean }> {
  const kind = sniff(new Uint8Array(data, 0, Math.min(32, data.byteLength))) ?? extOf(name);
  const blob = new Blob([data], { type: MIME[kind] ?? MIME[extOf(name)] ?? 'application/octet-stream' });
  if (kind !== 'heic' && kind !== 'tiff') {
    try {
      (await createImageBitmap(blob, ORIENT)).close();
      return { blob, converted: false };
    } catch {
      /* format annoncé mais non décodable : on tente la conversion */
    }
  }
  if (host.convertImage) {
    try {
      const jpeg = await host.convertImage(data, kind === 'tiff' || kind === 'heic' ? kind : extOf(name));
      return { blob: new Blob([jpeg], { type: 'image/jpeg' }), converted: true };
    } catch (e) {
      throw new ImageDecodeError(`Cette image n’a pas pu être convertie (${e instanceof Error ? e.message : String(e)}). Exportez-la en JPEG ou en PNG, puis importez-la de nouveau.`);
    }
  }
  const label = kind === 'heic' ? 'HEIC' : kind === 'tiff' ? 'TIFF' : extOf(name).toUpperCase() || 'inconnu';
  throw new ImageDecodeError(`Le format ${label} ne peut pas être affiché ici. Exportez l’image en JPEG ou en PNG, puis importez-la de nouveau.`);
}

/** Miniature JPEG (≤ 600 px de haut) pour la couverture de la bibliothèque ; null si illisible. */
export async function imageThumbnail(data: ArrayBuffer, name: string): Promise<string | null> {
  try {
    const { blob } = await displayableBlob(data, name);
    const bmp = await createImageBitmap(blob, ORIENT);
    const scale = Math.min(1, 600 / bmp.height, 400 / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  }
}
