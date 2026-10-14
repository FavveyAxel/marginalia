// ─────────────────────────────────────────────────────────────
// Pont vers l'hôte (FIGÉ).
// Dans Electron, `window.marginalia` est exposé par electron/preload.cjs.
// Dans un navigateur (tests, dev), on retombe sur IndexedDB + <input type=file>.
// ─────────────────────────────────────────────────────────────
import type { Database } from './types';

export interface PickedFile {
  name: string;
  data: ArrayBuffer;
}

export interface HostApi {
  /** Base complète, ou null au premier lancement. */
  loadDb(): Promise<Database | null>;
  /** Écriture atomique de la base. */
  saveDb(db: Database): Promise<void>;
  /** Ouvre le sélecteur de fichiers natif (multi-sélection, formats acceptés). */
  pickFiles(): Promise<PickedFile[]>;
  /** Copie le fichier source dans la bibliothèque de l'app. */
  storeFile(bookId: string, fileName: string, data: ArrayBuffer): Promise<void>;
  readFile(bookId: string, fileName: string): Promise<ArrayBuffer>;
  deleteFile(bookId: string, fileName: string): Promise<void>;
  /** Boîte « Enregistrer sous » ; renvoie false si annulé. */
  saveText(defaultName: string, content: string): Promise<boolean>;
  /** Ouvre un .docx existant (sélecteur natif). `path` = chemin disque (null en navigateur). */
  openDocx(): Promise<{ path: string | null; name: string; data: ArrayBuffer } | null>;
  /** Réécrit un fichier externe (copie .bak préalable). Refusé hors Electron. */
  writeExternal(path: string, data: ArrayBuffer): Promise<void>;
  /** « Enregistrer sous » binaire ; renvoie le chemin choisi (ou un nom en navigateur), null si annulé. */
  saveBinary(defaultName: string, data: ArrayBuffer, format: ExportFormat): Promise<string | null>;
  /** Rend du HTML autonome en PDF (A4) et renvoie les octets. */
  printToPdf(html: string): Promise<ArrayBuffer>;
  /** Fichiers ouverts depuis le Finder / le Dock pendant que l'app tourne. */
  onOpenFiles(cb: (files: PickedFile[]) => void): () => void;
  /** 'electron' ou 'browser'. */
  kind: 'electron' | 'browser';
  /**
   * Convertit en JPEG une image que le moteur de rendu ne sait pas décoder (HEIC, TIFF).
   * Facultatif : fourni par l'app Mac (outil système `sips`), absent dans un navigateur.
   */
  convertImage?(data: ArrayBuffer, ext: string): Promise<ArrayBuffer>;
}

export type ExportFormat = 'docx' | 'pdf' | 'md' | 'html' | 'txt';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
};

/** Images importées comme documents (photo ou scan d'une page : texte reconnu par OCR). */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff'];

export const ACCEPTED_EXTENSIONS = ['epub', 'pdf', 'docx', 'md', 'markdown', 'txt', 'html', 'htm', ...IMAGE_EXTENSIONS];

declare global {
  interface Window {
    marginalia?: HostApi;
  }
}

// ── Fallback navigateur ──────────────────────────────────────
const DB_NAME = 'marginalia';
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}
async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDel(store: string, key: string): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const browserHost: HostApi = {
  kind: 'browser',
  async loadDb() {
    return (await idbGet<Database>('kv', 'db')) ?? null;
  },
  async saveDb(db) {
    await idbPut('kv', 'db', JSON.parse(JSON.stringify(db)));
  },
  pickFiles() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = ACCEPTED_EXTENSIONS.map((e) => '.' + e).join(',');
      input.onchange = async () => {
        const files = Array.from(input.files ?? []);
        resolve(await Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() }))));
      };
      input.click();
    });
  },
  async storeFile(bookId, fileName, data) {
    await idbPut('files', `${bookId}/${fileName}`, data);
  },
  async readFile(bookId, fileName) {
    const data = await idbGet<ArrayBuffer>('files', `${bookId}/${fileName}`);
    if (!data) throw new Error('Fichier introuvable');
    return data;
  },
  async deleteFile(bookId, fileName) {
    await idbDel('files', `${bookId}/${fileName}`);
  },
  async saveText(defaultName, content) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return true;
  },
  openDocx() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.docx';
      input.onchange = async () => {
        const f = input.files?.[0];
        resolve(f ? { path: null, name: f.name, data: await f.arrayBuffer() } : null);
      };
      input.click();
    });
  },
  async writeExternal() {
    throw new Error('Écriture directe indisponible hors de l’app Mac');
  },
  async saveBinary(defaultName, data, format) {
    const blob = new Blob([data], { type: EXPORT_MIME[format] });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return defaultName;
  },
  async printToPdf() {
    throw new Error('Export PDF disponible dans l’app Mac uniquement');
  },
  onOpenFiles() {
    return () => {};
  },
};

export const host: HostApi = typeof window !== 'undefined' && window.marginalia ? window.marginalia : browserHost;

/** Convertit des File (glisser-déposer) en PickedFile. */
export async function filesFromDrop(list: FileList | File[]): Promise<PickedFile[]> {
  const files = Array.from(list).filter((f) => ACCEPTED_EXTENSIONS.includes(extOf(f.name)));
  return Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}
