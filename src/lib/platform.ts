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

export interface AppleBook {
  path: string;
  name: string;
  kind: 'epub' | 'pdf';
  title: string;
  author: string;
  /** null = sans DRM ; sinon le système de protection détecté. */
  drm: string | null;
  /** Encore dans iCloud (téléchargement demandé). */
  pending?: boolean;
}

/** Annotation de Livres, normalisée par le processus principal (dates en ms Unix). */
export interface AppleBooksAnnotation {
  uuid: string;
  type: 'highlight' | 'bookmark' | 'position';
  /** Texte sélectionné (surlignage) ; vide pour un signet ou une position. */
  text: string;
  note: string;
  /** Emplacement EPUB CFI (« epubcfi(/6/14[ch1]!/4/2/10,/1:0,/1:120) »). */
  cfi: string;
  /** ZANNOTATIONSTYLE : 0 souligné, 1 vert, 2 bleu, 3 jaune, 4 rose, 5 violet (null : inconnu). */
  style: number | null;
  underline: boolean;
  created: number | null;
  modified: number | null;
  deleted: boolean;
}

/** Livre de la bibliothèque de Livres et ses annotations. */
export interface AppleBooksAsset {
  assetId: string;
  title: string;
  author: string;
  path: string;
  /** Nom de fichier côté Livres (basename du chemin), comparé à Book.originalName. */
  fileName: string;
  /** Avancement 0–1 selon Livres (null : inconnu). */
  progress: number | null;
  lastOpened: number | null;
  protected: boolean;
  annotations: AppleBooksAnnotation[];
}

export interface AppleBooksAnnotationsResult {
  /** 'denied' : macOS refuse l'accès (message à montrer tel quel). */
  status: 'ok' | 'absent' | 'denied' | 'error';
  message?: string;
  books: AppleBooksAsset[];
}

/** État du chiffrement et du verrouillage (app de bureau). */
export interface SecurityStatus {
  available: boolean;
  platform: string;
  /** Le trousseau du système peut-il protéger la clé (niveau 1) ? */
  system: { ok: boolean; name?: string; reason?: string };
  touchIdAvailable: boolean;
  /** Données chiffrées (ou en cours de chiffrement). */
  encrypted: boolean;
  /** Verrouillage par mot de passe activé. */
  lock: boolean;
  hasPassword: boolean;
  touchId: boolean;
  /** 0 = jamais. */
  autoLockMinutes: number;
  lockOnSleep: boolean;
  locked: boolean;
  /** 'lock' : mot de passe ; 'keychain' : le trousseau n'a pas rendu la clé ; 'orphan' : fichier de clés introuvable. */
  lockReason: 'lock' | 'keychain' | 'orphan' | null;
  /** Verrouillé pendant la session (« menu », « inactivite », « veille »…) ; null au lancement. */
  lockedBy: string | null;
  migration: { to: 'encrypted' | 'plain'; done: number; total: number; running: boolean; error: string | null; finished: boolean } | null;
  recoveryCreatedAt: string | null;
  /** Attente imposée avant un nouvel essai (après plusieurs échecs). */
  waitMs: number;
}

export type SecurityResult = { ok: true } | { ok: false; error: string };
export interface LockOptions {
  password: string;
  touchId: boolean;
  autoLockMinutes: number;
  lockOnSleep: boolean;
}

export interface SecurityApi {
  status(): Promise<SecurityStatus>;
  unlockPassword(password: string): Promise<SecurityResult>;
  unlockRecovery(recoveryKey: string, newPassword?: string): Promise<SecurityResult>;
  unlockTouchId(): Promise<SecurityResult>;
  /** Nouvelle clé de secours (montrée une fois) avant l'activation. */
  prepare(): Promise<{ token: string; recoveryKey: string }>;
  enable(token: string, lock?: LockOptions): Promise<SecurityResult>;
  enableLock(opts: LockOptions): Promise<SecurityResult>;
  disableLock(password: string): Promise<SecurityResult>;
  disable(password?: string): Promise<SecurityResult>;
  resume(): Promise<SecurityResult>;
  changePassword(oldPassword: string, newPassword: string): Promise<SecurityResult>;
  prepareRecovery(password?: string): Promise<({ ok: true; token: string; recoveryKey: string }) | { ok: false; error: string }>;
  commitRecovery(token: string): Promise<SecurityResult>;
  cancelPending(): Promise<SecurityResult>;
  setOptions(opts: Partial<Omit<LockOptions, 'password'>>): Promise<SecurityResult>;
  lockNow(): Promise<SecurityResult>;
  printRecovery(token: string, mode: 'print' | 'pdf'): Promise<{ ok: boolean; path?: string }>;
  activity(): void;
  onChange(cb: (s: SecurityStatus) => void): () => void;
  onAsk(cb: (req: { id: number; kind: string; title: string; message: string }) => Promise<string | null>): () => void;
}

export interface HostApi {
  /** Chiffrement et verrouillage des données (app de bureau uniquement ; absent en navigateur). */
  security?: SecurityApi;
  /** Base complète, ou null au premier lancement. */
  loadDb(): Promise<Database | null>;
  /** Écriture atomique de la base. */
  saveDb(db: Database): Promise<void>;
  /**
   * Même chose avec la base déjà sérialisée (app de bureau) ; `meta` sert aux sauvegardes de secours
   * (version de format : copie avant migration ; nombre d'éléments : copie avant un vidage complet).
   */
  saveDbJson?(json: string, meta: { version: number; items: number }): Promise<void>;
  /** Avis du processus principal (base restaurée automatiquement, sauvegarde exportée…). */
  onNotice?(cb: (n: { message: string; tone: 'info' | 'error' | 'success' }) => void): () => void;
  /** Fermeture de la fenêtre, export ou restauration : écrire immédiatement ce qui attend. */
  onFlushRequest?(cb: () => Promise<void>): () => void;
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
  saveBinary(defaultName: string, data: ArrayBuffer, format: SaveFormat): Promise<string | null>;
  /** Journal de diagnostic local (app de bureau). */
  diag?(...parts: unknown[]): Promise<void>;
  /** Familles de polices installées sur l'ordinateur (app de bureau uniquement). */
  listFonts?(): Promise<string[]>;
  /** Livres de l'app Livres d'Apple (iCloud et local) : EPUB et PDF, avec leur statut DRM. Mac uniquement (absent ailleurs). */
  appleBooksScan?(): Promise<AppleBook[]>;
  /** Lit un livre de l'app Livres (les EPUB « paquets » sont rezippés) ; refuse les livres protégés. */
  appleBooksRead?(path: string): Promise<PickedFile>;
  /** Surveille les dossiers de Livres ; renvoie false si aucun n'est accessible. */
  appleBooksWatch?(): Promise<boolean>;
  onAppleBooksChanged?(cb: () => void): () => void;
  /** Surlignages, notes, signets et positions de Livres (lecture seule, copie de la base). */
  appleBooksAnnotations?(): Promise<AppleBooksAnnotationsResult>;
  /** Déplacement de la fenêtre par la barre du haut (app de bureau). */
  windowDragStart?(): Promise<void>;
  windowDragEnd?(): Promise<void>;
  /** Double-clic sur la barre du haut : agrandir / réduire (selon les réglages de macOS sur Mac). */
  windowDoubleClick?(): Promise<void>;
  /**
   * Aligne le thème natif (menus, fond de fenêtre) : 'system' | 'light' | 'dark'.
   * `titleBar` : couleurs des boutons de fenêtre de Windows (fond et symboles, #rrggbb) d'après le thème affiché.
   */
  setTheme?(mode: 'system' | 'light' | 'dark', titleBar?: { color: string; symbolColor: string }): Promise<void>;
  /** Rend du HTML autonome en PDF (A4) et renvoie les octets. */
  printToPdf(html: string): Promise<ArrayBuffer>;
  /** Commandes des menus natifs (Windows : 'import', 'help'). */
  onMenuCommand?(cb: (cmd: string) => void): () => void;
  /** Windows : ouvre la barre de menus (cachée) sous forme de menu contextuel (Alt seul, F10). */
  popupMenu?(): Promise<void>;
  /** Fichiers ouverts depuis le Finder / le Dock (ou l'Explorateur de Windows) pendant que l'app tourne. */
  onOpenFiles(cb: (files: PickedFile[]) => void): () => void;
  /** 'electron' ou 'browser'. */
  kind: 'electron' | 'browser';
  /** Système de l'app Electron (process.platform : 'darwin', 'win32', 'linux') ; absent en navigateur. */
  platform?: string;
  /**
   * Convertit en JPEG une image que le moteur de rendu ne sait pas décoder (HEIC, TIFF).
   * Facultatif : fourni par l'app Mac (outil système `sips`), absent ailleurs (décodeur JS intégré, voir
   * src/features/reader/image/convert.ts).
   */
  convertImage?(data: ArrayBuffer, ext: string): Promise<ArrayBuffer>;
}

export type ExportFormat = 'docx' | 'pdf' | 'md' | 'html' | 'txt';
/** Formats d'« Enregistrer sous » binaire (exports de l'éditeur + images de la carte). */
export type SaveFormat = ExportFormat | 'png' | 'svg';

export const EXPORT_MIME: Record<SaveFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  png: 'image/png',
  svg: 'image/svg+xml',
};

/** Images importées comme documents (photo ou scan d'une page : texte reconnu par OCR). */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff', 'gif', 'bmp', 'avif'];

/** Fichiers dérivés d'un document image, rangés à côté de la source (supprimés avec elle). */
export const DERIVED_FILES = ['ocr.json', 'display.jpg'];

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
    // Comme l'app de bureau : les fichiers dérivés d'une image (texte reconnu, copie affichable) partent avec la source.
    if (fileName.startsWith('source.')) for (const d of DERIVED_FILES) await idbDel('files', `${bookId}/${d}`).catch(() => undefined);
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
    throw new Error('Écriture directe disponible dans l’app de bureau uniquement');
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
    throw new Error('Export PDF disponible dans l’app de bureau uniquement');
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
