// Limite de décompression pour toutes les archives lues par JSZip (EPUB, DOCX, ODT, paquets .marginalia).
// JSZip décompresse une entrée entière en mémoire, et la taille qu'une archive annonce pour ses entrées
// peut mentir : une « bombe » de quelques Mo (EPUB reçu du téléphone, brouillon d'un collaborateur)
// se déploie en centaines de Go et fait tomber la fenêtre. Ici, chaque lecture d'entrée compte les
// octets réellement produits et s'arrête net au-delà de MAX_ZIP_ENTRY_BYTES.
import JSZip from 'jszip';

export const MAX_ZIP_ENTRY_BYTES = 512 * 1024 ** 2; // 512 Mo décompressés par entrée

export class ZipTooBigError extends Error {
  constructor() {
    super('Archive trop volumineuse une fois décompressée (fichier piégé ou endommagé).');
    this.name = 'ZipTooBigError';
  }
}

type Helper = {
  on(evt: 'data', fn: (chunk: { length?: number; byteLength?: number }) => void): Helper;
  accumulate(cb?: (meta: unknown) => void): Promise<unknown>;
  pause(): Helper;
  _worker?: { error?: (e: Error) => void };
};
type ZipObjectProto = {
  async: (this: ZipObjectProto & { dir?: boolean }, type: string, onUpdate?: (meta: unknown) => void) => Promise<unknown>;
  internalStream: (this: unknown, type: string) => Helper;
  __mgCapped?: boolean;
};

let installed = false;
let limit = MAX_ZIP_ENTRY_BYTES;

/** Installe la limite (une fois, au démarrage) sur le prototype des entrées JSZip ; `max` : tests. */
export function installZipLimits(max = MAX_ZIP_ENTRY_BYTES): void {
  limit = max;
  if (installed) return;
  installed = true;
  let proto: ZipObjectProto;
  try {
    proto = Object.getPrototypeOf(new JSZip().file('a', '').file('a')) as ZipObjectProto;
  } catch {
    return;
  }
  if (!proto || typeof proto.internalStream !== 'function' || proto.__mgCapped) return;
  proto.__mgCapped = true;
  proto.async = function cappedAsync(type, onUpdate) {
    let helper: Helper;
    try {
      helper = this.internalStream(type);
    } catch (e) {
      return Promise.reject(e);
    }
    return new Promise((resolve, reject) => {
      let n = 0;
      let stopped = false;
      helper.on('data', (chunk) => {
        if (stopped) return;
        n += Number(chunk?.byteLength ?? chunk?.length ?? 0);
        if (n > limit) {
          stopped = true;
          const err = new ZipTooBigError();
          reject(err);
          try {
            helper.pause();
            helper._worker?.error?.(err);
          } catch {
            /* déjà arrêté */
          }
        }
      });
      helper.accumulate(onUpdate).then(resolve, reject);
    });
  };
}

installZipLimits();
