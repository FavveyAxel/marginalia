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

/** Dossier choisi : fichiers compatibles trouvés, fichiers d'autres formats ignorés, plafond atteint. */
export interface PickedFolder {
  folder: string;
  files: PickedFile[];
  skipped: number;
  truncated: boolean;
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

/** Fichier en attente dans la Boîte de dépôt (dossier synchronisé avec le téléphone). */
export interface InboxFile {
  /** Nom du fichier dans le dossier (sans chemin). */
  name: string;
  size: number;
  /** Date de modification (ms Unix). */
  mtime: number;
  /** Encore dans le nuage (iCloud) : téléchargement demandé, contenu pas encore lisible. */
  pending?: boolean;
  /** Reçu par le Wi-Fi (dossier local de l'app ; effacé une fois traité). Absent : dossier synchronisé. */
  source?: 'wifi';
}

/** Réception par le Wi-Fi : adresses à scanner (la première est la plus probable). */
export interface WifiInfo {
  open: boolean;
  port?: number;
  urls?: { address: string; iface: string; url: string }[];
  /** Fermeture automatique après ce délai sans activité (ms). */
  idleMs?: number;
  count?: number;
}

/** Dernière version publiée (Release GitHub), comparée à celle de l'app. */
export interface UpdateInfo {
  current: string;
  latest: string | null;
  newer: boolean;
  /** Texte de la Release (Markdown) : le récap des nouveautés. */
  notes?: string;
  publishedAt?: string | null;
  /** Page de téléchargement du site (s'ouvre dans le navigateur). */
  downloadUrl?: string;
  error?: string;
}

/** Envoi d'un document vers le téléphone (QR code, réseau local) : chemin inverse de la réception. */
export interface SendToPhoneApi {
  start(files: { name: string; kind: 'pdf' | 'docx' | 'md' | 'txt' | 'html' | 'epub'; label: string; data: ArrayBuffer }[]): Promise<WifiInfo & { path?: string }>;
  stop(): Promise<void>;
  onEvent(cb: (e: { type: 'device'; device: string; at: number } | { type: 'downloaded'; name: string; device: string; at: number } | { type: 'stopped'; reason: string }) => void): () => void;
}

/** Session d'envoi par code (partage entre deux Marginalia sur le même réseau local). */
export interface ShareSendInfo {
  open: true;
  /** Code à 6 chiffres à dicter au destinataire. */
  code: string;
  /** Fin de validité du code (ms depuis 1970) : 10 minutes après l'ouverture. */
  expiresAt: number;
  port: number;
  /** Découverte UDP active (sinon, seule la saisie d'adresse fonctionne). */
  discovery: boolean;
  /** « adresse:port » à saisir chez le destinataire si la diffusion est bloquée. */
  addresses: string[];
  request: null;
}

/** Envoi trouvé avec le code : métadonnées déchiffrées, montrées avant d'accepter. */
export interface ShareFound {
  /** À passer à receive(). */
  id: string;
  meta: Record<string, unknown>;
  size: number;
  from: { address: string; port: number; name: string };
}

export type ShareNetEvent =
  | { side: 'send'; type: 'request'; device: string; address: string; at: number }
  | { side: 'send'; type: 'request-closed'; reason: 'no-answer'; at: number }
  | { side: 'send'; type: 'attempt'; ok: false; remaining: number; at: number }
  | { side: 'send'; type: 'progress'; done: number; total: number }
  | { side: 'send'; type: 'done'; size: number; device: string; at: number }
  | { side: 'send'; type: 'stopped'; reason: 'closed' | 'locked' | 'quit' | 'expired' | 'tries' | 'sent' }
  | { side: 'receive'; type: 'progress'; done: number; total: number }
  | { side: 'receive'; type: 'done'; size: number };

/** Partage direct entre deux ordinateurs (réseau local, code à 6 chiffres) ; app de bureau uniquement. */
export interface ShareNetApi {
  /** Ouvre l'envoi (remplace le précédent) : `meta` (titre, compteurs, taille) est chiffré avant d'être montré. */
  sendStart(bytes: ArrayBuffer | Uint8Array, meta: Record<string, unknown>): Promise<ShareSendInfo>;
  sendStop(): Promise<void>;
  /** Accepte la demande en attente (événement 'request') : le paquet part. false s'il n'y en a pas. */
  sendAccept(): Promise<boolean>;
  /** Refuse la demande en attente ; la session reste ouverte. */
  sendReject(): Promise<boolean>;
  /** Cherche l'envoi (diffusion, ou « adresse:port » saisie) et prouve le code ; erreurs en français. */
  find(code: string, manualAddress?: string): Promise<ShareFound>;
  /** Reçoit le paquet après l'accord de l'émetteur : octets déchiffrés et vérifiés. */
  receive(id: string): Promise<ArrayBuffer>;
  onEvent(cb: (e: ShareNetEvent) => void): () => void;
}

/** Mac : autorisation « Accès complet au disque » (lecture des données de l'app Livres). */
export interface DiskAccessApi {
  status(): Promise<{ status: 'granted' | 'denied' | 'nobooks' }>;
  openSettings(): Promise<boolean>;
  revealApp(): Promise<string>;
  relaunch(): Promise<void>;
}

export interface UpdatesApi {
  version(): Promise<string>;
  check(): Promise<UpdateInfo>;
}

export type WifiEvent =
  | { type: 'received'; name: string; size: number; kind: 'book' | 'image' | 'draft' | 'text'; device: string; at: number }
  | { type: 'device'; device: string; at: number }
  | { type: 'stopped'; reason: 'closed' | 'idle' | 'locked' | 'quit' };

export interface InboxInfo {
  /** Dossier surveillé (chemin absolu ; nom lisible en navigateur). */
  dir: string;
  /** Dossier par défaut (iCloud Drive › Marginalia sur Mac ; OneDrive ou Documents ailleurs). */
  defaultDir: string;
  isDefault: boolean;
  /** Le dossier existe (créé à l'activation). */
  exists: boolean;
  /** Service qui synchronise le dossier, si on le reconnaît. */
  cloud: 'icloud' | 'onedrive' | null;
}

/**
 * Boîte de dépôt : un dossier (iCloud Drive, OneDrive…) où le téléphone dépose des fichiers.
 * L'hôte ne lit que les fichiers de premier niveau de ce dossier ; un fichier traité est déplacé
 * dans le sous-dossier « Traités » (jamais supprimé).
 */
export interface InboxApi {
  info(): Promise<InboxInfo>;
  /** Crée le dossier (et « Traités ») si besoin, puis le surveille. */
  enable(): Promise<InboxInfo>;
  /** Arrête la surveillance (le dossier reste). */
  disable(): Promise<void>;
  /** Sélecteur de dossier natif ; null si annulé. */
  choose(): Promise<InboxInfo | null>;
  /** Revient au dossier par défaut. */
  reset(): Promise<InboxInfo>;
  /** Fichiers en attente (premier niveau, sans fichiers cachés ni « Traités »). */
  list(): Promise<InboxFile[]>;
  read(name: string): Promise<PickedFile>;
  /** Range le fichier dans « Traités » (nom unique en cas de doublon). */
  done(name: string): Promise<void>;
  /** Ouvre le dossier dans le Finder / l'Explorateur. */
  reveal(): Promise<void>;
  /** Ouvre la réception par le Wi-Fi (serveur local, jeton neuf) ; idempotent. */
  wifiStart?(): Promise<WifiInfo>;
  wifiInfo?(): Promise<WifiInfo>;
  /** Ferme la réception par le Wi-Fi. */
  wifiStop?(): Promise<void>;
  /** Devenir d'un envoi (affiché sur le téléphone qui l'a envoyé). */
  wifiReport?(name: string, result: { state: string; label: string }): Promise<void>;
  onWifi?(cb: (e: WifiEvent) => void): () => void;
  /** Le contenu du dossier a changé (regroupé : au plus une fois toutes les 1,5 s). */
  onChange(cb: () => void): () => void;
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
  /** Sélecteur de dossier : son contenu compatible, sous-dossiers compris ; null si annulé. */
  pickFolder?(): Promise<PickedFolder | null>;
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
  /** Boîte de dépôt (dossier partagé avec le téléphone). */
  inbox?: InboxApi;
  /** Version de l'app et vérification des mises à jour (app de bureau). */
  updates?: UpdatesApi;
  sendToPhone?: SendToPhoneApi;
  /** Partage direct avec une autre Marginalia du réseau local (code à 6 chiffres). */
  shareNet?: ShareNetApi;
  /** Tout premier lancement sur cet ordinateur (aucune donnée de Marginalia avant ce lancement). */
  firstRun?(): Promise<boolean>;
  diskAccess?: DiskAccessApi;
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
  /**
   * Commandes de l'éditeur venues du menu Édition natif : 'copy-format' (⌥⌘C / Ctrl+Maj+C) et
   * 'paste-format' (⌥⌘V / Ctrl+Maj+V). Relais du clavier quand la page n'a pas pris la touche ;
   * branché sur le pinceau par src/features/editor/painterMenu.ts.
   */
  onEditorCommand?(cb: (cmd: string) => void): () => void;
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

// Boîte de dépôt simulée (navigateur : développement et tests). Les tests y déposent des
// fichiers avec window.__inbox.add(nom, contenu).
const inboxFiles = new Map<string, { data: ArrayBuffer; mtime: number; wifi?: boolean }>();
const wifiListeners = new Set<(e: WifiEvent) => void>();
let wifiOpen = false;
// Comme l'hôte réel : les fichiers du dossier ne sont listés qu'une fois la boîte activée.
let cloudOn = false;
const wifiDemo = (): WifiInfo =>
  wifiOpen ? { open: true, port: 47800, idleMs: 900000, count: 0, urls: [{ address: '192.168.1.24', iface: 'en0', url: 'http://192.168.1.24:47800/r/Qm9uam91ciBSb3Vzc2VhdQ' }] } : { open: false };
const inboxDone: string[] = [];
const inboxListeners = new Set<() => void>();
let inboxTimer: ReturnType<typeof setTimeout> | null = null;
const inboxChanged = () => {
  if (inboxTimer) clearTimeout(inboxTimer);
  inboxTimer = setTimeout(() => inboxListeners.forEach((cb) => cb()), 300);
};
const browserInboxInfo = (): InboxInfo => ({ dir: 'iCloud Drive/Marginalia', defaultDir: 'iCloud Drive/Marginalia', isDefault: true, exists: true, cloud: 'icloud' });
const browserInbox: InboxApi = {
  async info() {
    return browserInboxInfo();
  },
  async enable() {
    cloudOn = true;
    return browserInboxInfo();
  },
  async disable() {
    cloudOn = false;
  },
  async choose() {
    return null;
  },
  async reset() {
    return browserInboxInfo();
  },
  async list() {
    return [...inboxFiles].filter(([, f]) => f.wifi || cloudOn).map(([name, f]) => ({ name, size: f.data.byteLength, mtime: f.mtime, ...(f.wifi ? { source: 'wifi' as const } : {}) }));
  },
  async read(name) {
    const f = inboxFiles.get(name);
    if (!f) throw new Error('Fichier introuvable');
    return { name, data: f.data.slice(0) };
  },
  async done(name) {
    if (inboxFiles.delete(name)) inboxDone.push(name);
    inboxChanged();
  },
  async reveal() {},
  async wifiStart() {
    wifiOpen = true;
    return wifiDemo();
  },
  async wifiInfo() {
    return wifiDemo();
  },
  async wifiStop() {
    if (!wifiOpen) return;
    wifiOpen = false;
    wifiListeners.forEach((cb) => cb({ type: 'stopped', reason: 'closed' }));
  },
  async wifiReport() {},
  onWifi(cb) {
    wifiListeners.add(cb);
    return () => wifiListeners.delete(cb);
  },
  onChange(cb) {
    inboxListeners.add(cb);
    return () => inboxListeners.delete(cb);
  },
};
if (typeof window !== 'undefined') {
  (window as unknown as { __inbox: unknown }).__inbox = {
    add(name: string, content: string | ArrayBuffer | Uint8Array) {
      const data = typeof content === 'string' ? new TextEncoder().encode(content).buffer : content instanceof Uint8Array ? content.slice().buffer : content;
      inboxFiles.set(name, { data: data as ArrayBuffer, mtime: Date.now() });
      inboxChanged();
    },
    /** Envoi simulé par le Wi-Fi : fichier « reçu » + événements de la fenêtre de réception. */
    wifi(name: string, content: string | ArrayBuffer | Uint8Array, device = 'iPhone') {
      const data = typeof content === 'string' ? new TextEncoder().encode(content).buffer : content instanceof Uint8Array ? content.slice().buffer : content;
      inboxFiles.set(name, { data: data as ArrayBuffer, mtime: Date.now(), wifi: true });
      const ext = name.split('.').pop()!.toLowerCase();
      const kind = ['pdf', 'epub'].includes(ext) ? 'book' : ext === 'docx' ? 'draft' : ['txt', 'md'].includes(ext) ? 'text' : 'image';
      wifiListeners.forEach((cb) => cb({ type: 'device', device, at: Date.now() }));
      wifiListeners.forEach((cb) => cb({ type: 'received', name, size: (data as ArrayBuffer).byteLength, kind, device, at: Date.now() }));
      inboxChanged();
    },
    list: () => [...inboxFiles.keys()],
    done: () => [...inboxDone],
  };
}

const browserHost: HostApi = {
  kind: 'browser',
  inbox: browserInbox,
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
/**
 * Fichiers d'un glisser-déposer, dossiers compris (lus récursivement, comme « Choisir un dossier »).
 * `skipped` : fichiers d'un autre format ; `folders` : nombre de dossiers déposés.
 */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<{ files: PickedFile[]; skipped: number; folders: number }> {
  type Entry = { isFile: boolean; isDirectory: boolean; name: string; file?: (cb: (f: File) => void, err: (e: unknown) => void) => void; createReader?: () => { readEntries: (cb: (e: Entry[]) => void, err: (e: unknown) => void) => void } };
  const entries: Entry[] = [];
  for (const it of Array.from(dt.items ?? [])) {
    const e = (it as unknown as { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.();
    if (e) entries.push(e);
  }
  // Sans l'API des entrées : simple liste de fichiers.
  if (!entries.length) {
    const all = Array.from(dt.files ?? []);
    const files = await filesFromDrop(all);
    return { files, skipped: all.length - files.length, folders: 0 };
  }
  const found: File[] = [];
  let skipped = 0;
  let folders = 0;
  const MAX = 300;
  const readAll = (dir: Entry): Promise<Entry[]> =>
    new Promise((resolve) => {
      const r = dir.createReader!();
      const acc: Entry[] = [];
      const next = () => r.readEntries((batch) => (batch.length ? (acc.push(...batch), next()) : resolve(acc)), () => resolve(acc));
      next();
    });
  const walk = async (e: Entry, depth: number): Promise<void> => {
    if (found.length >= MAX || e.name.startsWith('.') || e.name.startsWith('~$')) return;
    if (e.isDirectory) {
      if (depth > 6 || /^(node_modules|__MACOSX)$|\.(app|photoslibrary)$/i.test(e.name)) return;
      for (const c of (await readAll(e)).sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }))) await walk(c, depth + 1);
      return;
    }
    if (!ACCEPTED_EXTENSIONS.includes(extOf(e.name))) {
      skipped++;
      return;
    }
    const f = await new Promise<File | null>((res) => e.file!((x) => res(x), () => res(null)));
    if (f && f.size) found.push(f);
  };
  for (const e of entries) {
    if (e.isDirectory) folders++;
    await walk(e, 0);
  }
  const files = await Promise.all(found.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
  return { files, skipped, folders };
}

export async function filesFromDrop(list: FileList | File[]): Promise<PickedFile[]> {
  const files = Array.from(list).filter((f) => ACCEPTED_EXTENSIONS.includes(extOf(f.name)));
  return Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}
