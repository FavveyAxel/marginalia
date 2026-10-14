// Conversion HEIC / TIFF → JPEG dans un Web Worker (Windows, Linux, navigateur).
// Décodeurs embarqués dans l'app (aucun téléchargement) : libheif compilé en WebAssembly
// (paquet libheif-js, binaire inclus dans le fichier) et UTIF.js pour le TIFF. Encodage JPEG
// par OffscreenCanvas (encodeur du moteur de rendu).
import createLibheif from 'libheif-js/libheif-wasm/libheif-bundle.mjs';
import makeHeicDecoder from 'heic-decode/lib.js';
import UTIF from 'utif';

interface Request {
  id: number;
  data: ArrayBuffer;
  kind: 'heic' | 'tiff';
}

let heic: ReturnType<typeof makeHeicDecoder> | null = null;

async function decodeHeic(data: ArrayBuffer): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  if (!heic) heic = makeHeicDecoder(createLibheif());
  const r = await heic.one({ buffer: new Uint8Array(data) });
  return { width: r.width, height: r.height, rgba: new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.byteLength) };
}

function decodeTiff(data: ArrayBuffer): { width: number; height: number; rgba: Uint8ClampedArray } {
  const ifds = UTIF.decode(data);
  // Première page : la plus grande image (certains TIFF commencent par une vignette).
  let best = ifds[0];
  for (const ifd of ifds) {
    UTIF.decodeImage(data, ifd, ifds);
    if (ifd.width * ifd.height > (best.width ?? 0) * (best.height ?? 0)) best = ifd;
  }
  if (!best || !best.width || !best.height) throw new Error('TIFF sans image lisible');
  const rgba = UTIF.toRGBA8(best);
  return { width: best.width, height: best.height, rgba: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, best.width * best.height * 4) };
}

self.onmessage = async (ev: MessageEvent<Request>) => {
  const { id, data, kind } = ev.data;
  try {
    const img = kind === 'heic' ? await decodeHeic(data) : decodeTiff(data);
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponible');
    ctx.fillStyle = '#ffffff'; // transparence éventuelle du TIFF : fond blanc (le JPEG n'a pas d'alpha)
    ctx.fillRect(0, 0, img.width, img.height);
    const tmp = new OffscreenCanvas(img.width, img.height);
    tmp.getContext('2d')!.putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
    ctx.drawImage(tmp, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    const jpeg = await blob.arrayBuffer();
    (self as unknown as Worker).postMessage({ id, jpeg }, [jpeg]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
