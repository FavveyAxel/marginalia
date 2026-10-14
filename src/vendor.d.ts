// Déclarations des décodeurs d'images embarqués (paquets sans types).

declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  /** Module libheif (WebAssembly inclus dans le fichier : aucun téléchargement). */
  const createLibheif: (opts?: Record<string, unknown>) => unknown;
  export default createLibheif;
}

declare module 'heic-decode/lib.js' {
  interface DecodedHeic {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }
  const makeDecoder: (libheif: unknown) => {
    one(input: { buffer: Uint8Array }): Promise<DecodedHeic>;
  };
  export default makeDecoder;
}

declare module 'utif' {
  interface Ifd {
    width: number;
    height: number;
    [tag: string]: unknown;
  }
  const UTIF: {
    decode(buf: ArrayBuffer): Ifd[];
    decodeImage(buf: ArrayBuffer, ifd: Ifd, ifds?: Ifd[]): void;
    toRGBA8(ifd: Ifd): Uint8Array;
  };
  export default UTIF;
}
