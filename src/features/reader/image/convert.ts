// HEIC / TIFF → JPEG sans l'aide du système (Windows, Linux, navigateur) : décodeur JS/WASM
// embarqué, exécuté dans un Web Worker pour ne pas figer l'interface. Sur Mac, l'app passe
// d'abord par l'outil système `sips` (host.convertImage).

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve(b: ArrayBuffer): void; reject(e: Error): void }>();

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module', name: 'conversion-image' });
  w.onmessage = (ev: MessageEvent<{ id: number; jpeg?: ArrayBuffer; error?: string }>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.jpeg) p.resolve(ev.data.jpeg);
    else p.reject(new Error(ev.data.error || 'conversion impossible'));
  };
  w.onerror = (ev) => {
    const err = new Error(ev.message || 'décodeur indisponible');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker = null;
    w.terminate();
  };
  worker = w;
  return w;
}

/** Convertit une image HEIC ou TIFF en JPEG (qualité 0,92). */
export function convertInRenderer(data: ArrayBuffer, kind: 'heic' | 'tiff'): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    // Copie : l'appelant garde son ArrayBuffer (il est aussi enregistré dans la bibliothèque).
    const copy = data.slice(0);
    getWorker().postMessage({ id, data: copy, kind }, [copy]);
  });
}
