// Marginalia — processus principal Electron.
//
// Données (dossier userData : ~/Library/Application Support/Marginalia sur Mac,
// %APPDATA%\Marginalia sous Windows) :
//   db.json (+ db.json.bak)        base complète, écriture atomique (tmp + fsync + rename), une à la fois
//   library/<id>/<fileName>        fichiers sources des livres et des écrits
//   backups/                       sauvegardes de la base : une par jour (7 jours), avant migration de
//                                  format, avant restauration ou vidage complet ; bases illisibles mises de côté
//   diagnostic.log (+ .1)          journal local (4 Mo au plus par fichier)
//   keystore.json (+ .bak)         seulement si le chiffrement est activé (option) : enveloppes de la clé
//                                  de données (trousseau, mot de passe, clé de secours), jamais la clé en clair
//
// Fichiers ouverts depuis le Finder / le Dock (événement macOS `open-file`), ou depuis l'Explorateur
// de Windows (arguments de lancement, puis événement `second-instance` si l'app tourne déjà) : TOUS les formats acceptés, y compris les .docx, sont transmis au rendu via
// `onOpenFiles` et donc IMPORTÉS COMME LIVRES (bibliothèque). Un .docx ouvert ainsi n'est pas
// ouvert dans l'éditeur ; pour modifier un .docx en place, utiliser « Ouvrir un .docx » dans Écrire.
'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, net, powerMonitor, protocol, safeStorage, screen, session, shell, systemPreferences } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const zipkit = require('./backup.cjs');
const vault = require('./vault.cjs');
const wifiKit = require('./wifi.cjs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const APP_ORIGIN = 'app://marginalia';
const DIST_DIR = path.join(__dirname, '..', 'dist');
const IMAGES = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff'];
const ACCEPTED = ['epub', 'pdf', 'docx', 'md', 'markdown', 'txt', 'html', 'htm', ...IMAGES];
// Fichiers dérivés d'un document image (texte reconnu, copie affichable) : supprimés avec la source.
const DERIVED_FILES = ['ocr.json', 'display.jpg'];

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
// App Livres d'Apple : macOS uniquement. MARGINALIA_APPLE_BOOKS=1 l'active ailleurs pour les tests
// (faux dossiers de Livres sous un HOME temporaire, sqlite3 du système).
const APPLE_BOOKS = IS_MAC || process.env.MARGINALIA_APPLE_BOOKS === '1';
// Hauteur de la barre du haut de l'interface (--titlebar-h) : les boutons de fenêtre de Windows s'y alignent.
const TITLEBAR_H = 52;

app.setName('Marginalia');
if (IS_WIN) app.setAppUserModelId('com.axelbierne.marginalia');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// ── Instance unique ──────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ── Chemins de données ───────────────────────────────────────
const userData = () => app.getPath('userData');
const dbPath = () => path.join(userData(), 'db.json');
const libraryRoot = () => path.join(userData(), 'library');
const backupsDir = () => path.join(userData(), 'backups');

// Noms interdits par Windows (quel que soit le système : une bibliothèque doit pouvoir être copiée d'un PC à un Mac).
const WIN_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
function segmentOk(s) {
  return (
    typeof s === 'string' &&
    s.length > 0 &&
    s !== '.' &&
    s !== '..' &&
    !/[\\\0]/.test(s) &&
    !path.isAbsolute(s) &&
    (!IS_WIN || (!/[<>:"|?*\u0000-\u001f]/.test(s) && !/[. ]$/.test(s) && !WIN_RESERVED.test(s)))
  );
}

/** `child` est-il strictement à l'intérieur de `parent` ? (path.relative : insensible à la casse sous Windows) */
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

/** Nom de fichier proposé dans « Enregistrer sous » : caractères et noms réservés de Windows remplacés. */
function safeDefaultName(name) {
  let base = path.basename(String(name || ''));
  if (!IS_WIN) return base;
  base = base.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (!base) base = 'Sans titre';
  if (WIN_RESERVED.test(base)) base = '_' + base;
  return base;
}

/** library/<id>/<fileName> ; fileName peut contenir des sous-dossiers, jamais de remontée. */
function libraryPath(id, fileName) {
  if (!segmentOk(id) || id.includes('/')) throw new Error('Identifiant invalide');
  const parts = String(fileName).split('/');
  if (!parts.length || !parts.every(segmentOk)) throw new Error('Nom de fichier invalide');
  const full = path.join(libraryRoot(), id, ...parts);
  if (!isInside(full, path.join(libraryRoot(), id))) throw new Error('Chemin invalide');
  return full;
}

async function writeAtomic(target, data) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await fsp.rename(tmp, target);
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw e;
  }
}

const toBuffer = (data) => (Buffer.isBuffer(data) ? data : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data));

// ── Chiffrement des données (option, désactivée par défaut ; voir electron/vault.cjs) ──
// Toutes les lectures acceptent les deux formats (en-tête MGLENC1 ou fichier en clair) ; les écritures
// suivent l'état choisi (sec.ks.enabled). Données verrouillées : la clé n'est pas en mémoire, et toute
// lecture ou écriture de données est refusée (LockedError).
const E2E = process.env.MARGINALIA_E2E === '1';
const sec = {
  ks: null, // keystore.json (null : chiffrement jamais activé, ou désactivé)
  dek: null, // clé de données en mémoire (null : verrouillé, ou pas de chiffrement)
  orphan: false, // données chiffrées trouvées sans fichier de clés
  keychainFailed: false, // le trousseau n'a pas rendu la clé (mise à jour de l'app, accès refusé…)
  pending: null, // clé de secours affichée, pas encore confirmée
  failures: 0,
  nextTryAt: 0,
  lastActivity: Date.now(),
  migration: null, // { to, done, total, running, error }
  locking: false,
  lockedBy: null, // raison du dernier verrouillage pendant la session (null : lancement)
};
const needsKey = () => !!sec.ks && (!!sec.ks.enabled || !!sec.ks.migration);
const isLocked = () => sec.orphan || (needsKey() && !sec.dek);
const writeSealed = () => !!sec.ks && !!sec.ks.enabled;
function encodeOut(buf) {
  if (!writeSealed()) return buf;
  if (!sec.dek) throw new vault.LockedError();
  return vault.seal(sec.dek, buf);
}
function decodeIn(buf) {
  if (!vault.isSealed(buf)) return buf;
  if (!sec.dek) throw new vault.LockedError();
  return vault.open(sec.dek, buf);
}
const asBuffer = (d) => (typeof d === 'string' ? Buffer.from(d, 'utf8') : toBuffer(d));
/** Lit un fichier de données (déchiffré si besoin). */
async function readData(file) {
  return decodeIn(await fsp.readFile(file));
}
/** Écrit un fichier de données (chiffré si le chiffrement est activé), de façon atomique. */
async function writeData(file, data) {
  await writeAtomic(file, encodeOut(asBuffer(data)));
}
// Verrous par fichier : une écriture de l'app et la conversion (chiffrement / déchiffrement) d'un même
// fichier ne se croisent jamais.
const fileLocks = new Map();
function withFileLock(key, fn) {
  const prev = fileLocks.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  fileLocks.set(key, tail);
  tail.then(() => fileLocks.get(key) === tail && fileLocks.delete(key));
  return run;
}

// ── Confiance des appelants IPC ──────────────────────────────
function trusted(event) {
  const url = event.senderFrame ? event.senderFrame.url : '';
  return url.startsWith(APP_ORIGIN + '/') || (DEV_URL && url.startsWith(DEV_URL));
}
// ── Journal de diagnostic (local, dans le dossier de l'app) ──
// diagnostic.log, 4 Mo au plus : au-delà, il devient diagnostic.log.1 (l'ancien .1 est remplacé).
// Chaque ligne est tronquée à 16 Ko ; rien n'est jamais envoyé hors de l'ordinateur.
const DIAG_MAX = 4 * 1024 * 1024;
const DIAG_LINE_MAX = 16 * 1024;
let diagStream = null;
let diagSize = 0;
function diagPart(p) {
  if (typeof p === 'string') return p;
  if (p instanceof Error) return p.stack || p.message;
  try {
    return JSON.stringify(p);
  } catch {
    return String(p);
  }
}
let diagPaused = false;
const diagHeld = [];
function diag(...parts) {
  try {
    let line = `${new Date().toISOString()} ${parts.map(diagPart).join(' ')}`;
    if (line.length > DIAG_LINE_MAX) line = line.slice(0, DIAG_LINE_MAX) + ' …[tronqué]';
    // Chiffrement activé : chaque ligne est chiffrée (elle peut citer un titre ou un passage).
    if (writeSealed() && sec.dek) line = vault.sealLine(sec.dek, line);
    if (diagPaused) diagHeld.push(line);
    else diagWrite(line);
  } catch {
    /* jamais bloquant */
  }
}
function diagWrite(line) {
  try {
    const f = path.join(app.getPath('userData'), 'diagnostic.log');
    if (diagStream && diagSize > DIAG_MAX) {
      diagStream.end();
      diagStream = null;
      try {
        fs.renameSync(f, f + '.1');
      } catch {
        /* déjà déplacé */
      }
    }
    if (!diagStream) {
      try {
        diagSize = fs.statSync(f).size;
        if (diagSize > DIAG_MAX) {
          fs.renameSync(f, f + '.1');
          diagSize = 0;
        }
      } catch {
        diagSize = 0; // pas encore de journal
      }
      fs.mkdirSync(path.dirname(f), { recursive: true });
      diagStream = fs.createWriteStream(f, { flags: 'a' });
      diagStream.on('error', () => (diagStream = null));
    }
    diagStream.write(line + '\n');
    diagSize += Buffer.byteLength(line) + 1;
  } catch {
    /* jamais bloquant */
  }
}
/** Suspend l'écriture du journal (conversion du fichier) ; les lignes sont gardées et écrites ensuite. */
async function pauseDiag() {
  diagPaused = true;
  const st = diagStream;
  diagStream = null;
  if (st) await new Promise((r) => st.end(r));
}
function resumeDiag() {
  diagPaused = false;
  for (const l of diagHeld.splice(0)) diagWrite(l);
}

// Exceptions non gérées du processus principal : consignées, sans fermeture brutale de l'app
// (le comportement par défaut d'Electron affiche une boîte d'erreur et peut laisser l'app à moitié morte).
process.on('uncaughtException', (err) => {
  console.error('Exception non gérée :', err);
  diag('erreur-principale', 'exception', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Promesse rejetée non gérée :', reason);
  diag('erreur-principale', 'promesse', reason instanceof Error ? reason : diagPart(reason));
});

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error('Appelant non autorisé');
    return fn(event, ...args);
  });
}
/** Canal qui touche aux données de l'utilisateur : refusé tant que Marginalia est verrouillé. */
function dataHandle(channel, fn) {
  handle(channel, (event, ...args) => {
    if (isLocked()) throw new vault.LockedError();
    return fn(event, ...args);
  });
}

// ── Avis à l'utilisateur (toasts du rendu) ───────────────────
// File d'attente : un avis émis avant que l'interface soit prête (restauration au démarrage,
// après un rechargement) lui est livré dès qu'elle s'abonne (onNotice).
const pendingNotices = [];
let noticesReady = false;
function notify(message, tone = 'info') {
  diag('avis', tone, message);
  pendingNotices.push({ message, tone });
  deliverNotices();
}
function deliverNotices() {
  if (!noticesReady || !mainWindow || mainWindow.isDestroyed()) return;
  for (const n of pendingNotices.splice(0)) mainWindow.webContents.send('marginalia:notice', n);
}
ipcMain.on('marginalia:notices-ready', (event) => {
  if (!trusted(event)) return;
  noticesReady = true;
  deliverNotices();
});

// ── Base de données ──────────────────────────────────────────
// Sûreté des données :
//  • écriture atomique (fichier temporaire + fsync + rename) ; une seule écriture à la fois, et les
//    demandes en attente sont regroupées (seule la plus récente est écrite) ;
//  • une erreur d'écriture ne bloque jamais les suivantes (la file repart) ;
//  • sauvegardes dans backups/ (voir l'en-tête) ;
//  • au démarrage, une base illisible est mise de côté (backups/corrompue-…) et la dernière
//    sauvegarde valide est restaurée automatiquement ; l'utilisateur est prévenu.
const DAILY_KEEP = 7;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isDbObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-');
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function frDate(ms) {
  try {
    return new Date(ms).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
  } catch {
    return new Date(ms).toISOString();
  }
}
/** Nombre d'éléments d'une base (somme des collections) : sert à repérer un vidage complet. */
function countItems(db) {
  let n = 0;
  for (const v of Object.values(db || {})) if (Array.isArray(v)) n += v.length;
  return n;
}

async function readDbFile(file) {
  let buf;
  try {
    buf = await fsp.readFile(file);
  } catch (e) {
    return { ok: false, missing: !!e && e.code === 'ENOENT', error: e };
  }
  let text;
  try {
    text = decodeIn(buf).toString('utf8');
  } catch (e) {
    // Verrouillé : surtout ne pas prendre la base pour une base endommagée.
    return { ok: false, missing: false, locked: !!e && e.code === 'MG_LOCKED', error: e };
  }
  try {
    const data = JSON.parse(text);
    if (!isDbObject(data)) throw new Error('contenu inattendu');
    return { ok: true, data, text };
  } catch (e) {
    return { ok: false, missing: false, error: e };
  }
}

/** Garde les `keep` éléments les plus récents de backups/ commençant par `prefix` (noms horodatés). */
async function rotateBackups(prefix, keep) {
  const names = (await fsp.readdir(backupsDir()).catch(() => [])).filter((n) => n.startsWith(prefix) && !n.endsWith('.tmp')).sort();
  for (const n of names.slice(0, Math.max(0, names.length - keep))) {
    await fsp.rm(path.join(backupsDir(), n), { recursive: true, force: true }).catch(() => {});
  }
}
async function writeBackup(prefix, text, keep) {
  const file = path.join(backupsDir(), `${prefix}${stamp()}.json`);
  await writeData(file, text);
  await rotateBackups(prefix, keep);
  diag('sauvegarde', path.basename(file));
  return file;
}
/** Sauvegarde quotidienne (une par jour, 7 jours) de la dernière base valide sur le disque. */
let dailyDone = null;
async function dailyBackup(text) {
  const day = localDay();
  if (dailyDone === day) return;
  const file = path.join(backupsDir(), `quotidienne-${day}.json`);
  if (!fs.existsSync(file)) {
    if (text == null) {
      const r = await readDbFile(dbPath());
      if (!r.ok) return;
      text = r.text;
    }
    await writeData(file, text);
    await rotateBackups('quotidienne-', DAILY_KEEP);
    diag('sauvegarde', path.basename(file));
  }
  dailyDone = day;
}

// État de la base chargée (version de format, taille) et chemins .docx externes autorisés.
let loadedVersion = null;
let migrationBackupDone = false;
let lastItemCount = 0;
let savesBlocked = false; // restauration en cours : les écritures de l'ancienne page sont ignorées
const externalAllowed = new Set();
function onDbLoaded(r) {
  loadedVersion = r.data.version ?? null;
  migrationBackupDone = false;
  lastItemCount = countItems(r.data);
  // Écrits liés à un .docx de l'utilisateur (y compris dans la corbeille et l'historique d'annulation).
  for (const m of r.text.matchAll(/"externalPath":("(?:[^"\\]|\\.)*")/g)) {
    try {
      externalAllowed.add(path.resolve(JSON.parse(m[1])));
    } catch {
      /* chaîne illisible */
    }
  }
  dailyBackup(r.text).catch((e) => diag('sauvegarde', 'quotidienne impossible', e && e.message));
}

async function loadDbSafely() {
  savesBlocked = false; // nouvelle page : elle repart de la base du disque
  const main = await readDbFile(dbPath());
  if (main.locked) throw main.error;
  if (main.ok) {
    onDbLoaded(main);
    return main.data;
  }
  if (main.missing && !fs.existsSync(dbPath() + '.bak')) return null; // premier lancement
  if (!main.missing) diag('base', 'illisible', (main.error && main.error.message) || main.error);
  // Candidats : copie .bak, puis sauvegardes du plus récent au plus ancien.
  const candidates = [dbPath() + '.bak'];
  const found = [];
  for (const n of await fsp.readdir(backupsDir()).catch(() => [])) {
    if (!n.endsWith('.json') || n.startsWith('corrompue-')) continue;
    const f = path.join(backupsDir(), n);
    const st = await fsp.stat(f).catch(() => null);
    if (st && st.isFile()) found.push({ f, m: st.mtimeMs });
  }
  candidates.push(...found.sort((a, b) => b.m - a.m).map((x) => x.f));
  // La base illisible n'est jamais effacée : elle est mise de côté pour examen.
  let aside = null;
  if (!main.missing) {
    try {
      await fsp.mkdir(backupsDir(), { recursive: true });
      aside = path.join(backupsDir(), `corrompue-${stamp()}.json`);
      await fsp.rename(dbPath(), aside);
      await rotateBackups('corrompue-', 5);
    } catch (e) {
      diag('base', 'mise de côté impossible', e && e.message);
      aside = null;
    }
  }
  for (const f of candidates) {
    const r = await readDbFile(f);
    if (!r.ok) continue;
    const st = await fsp.stat(f).catch(() => null);
    await writeData(dbPath(), r.text);
    onDbLoaded(r);
    diag('base', 'restauree depuis', path.basename(f), st ? new Date(st.mtimeMs).toISOString() : '');
    if (!main.missing) {
      notify(
        `La base de Marginalia était illisible : la sauvegarde du ${st ? frDate(st.mtimeMs) : 'dernier enregistrement'} a été restaurée automatiquement. ` +
          'Les toutes dernières modifications ont pu être perdues ; la base endommagée est conservée dans le dossier « backups ».',
        'error',
      );
    }
    return r.data;
  }
  if (!main.missing) {
    notify(
      'La base de Marginalia était illisible et aucune sauvegarde valide n’a été trouvée. ' +
        (aside ? 'Elle est conservée dans le dossier « backups » ; ' : '') +
        'Marginalia démarre avec une bibliothèque vide (vos fichiers de livres sont toujours sur le disque).',
      'error',
    );
  }
  return null;
}

dataHandle('marginalia:loadDb', async () => {
  try {
    return await loadDbSafely();
  } catch (e) {
    diag('base', 'chargement', e);
    throw e;
  }
});

// File d'écriture : une seule écriture à la fois ; seule la demande la plus récente est écrite.
const TEST_SAVE_DELAY = Number(process.env.MARGINALIA_TEST_SAVE_DELAY_MS) || 0;
let saveChain = Promise.resolve();
let saveSeq = 0;
let savedSeq = 0;
let latestSave = null;
let lastSaveError = 0;

async function writeDbNow({ json, meta }) {
  if (TEST_SAVE_DELAY) await sleep(TEST_SAVE_DELAY);
  const target = dbPath();
  const needDaily = dailyDone !== localDay();
  const migrating = loadedVersion != null && meta.version != null && meta.version !== loadedVersion && !migrationBackupDone;
  const wiping = meta.items === 0 && lastItemCount > 0;
  if (needDaily || migrating || wiping) {
    const cur = await readDbFile(target);
    if (cur.ok) {
      if (migrating) await writeBackup(`avant-migration-v${String(loadedVersion).replace(/[^\w.-]/g, '')}-`, cur.text, 5);
      if (wiping) await writeBackup('avant-vidage-', cur.text, 3);
      if (needDaily) await dailyBackup(cur.text);
    }
    if (migrating) migrationBackupDone = true;
  }
  try {
    await fsp.copyFile(target, target + '.bak');
  } catch (e) {
    if (e.code !== 'ENOENT') diag('base', 'copie .bak', e.message);
  }
  await writeData(target, json);
  if (meta.items != null) lastItemCount = meta.items;
}

function queueSave(json, meta) {
  const seq = ++saveSeq;
  latestSave = { json, meta };
  const run = saveChain
    .catch(() => {})
    .then(async () => {
      if (savedSeq >= seq) return; // déjà couvert par une écriture plus récente
      const upTo = saveSeq;
      const job = latestSave;
      try {
        await writeDbNow(job);
      } catch (e) {
        if (Date.now() - lastSaveError > 10000) diag('base', 'ecriture impossible', e && e.message);
        lastSaveError = Date.now();
        throw e;
      }
      savedSeq = Math.max(savedSeq, upTo);
    });
  saveChain = run;
  return run;
}
/** Attend la fin des écritures en cours (au plus `timeout` ms). */
const waitSaves = (timeout = 15000) => Promise.race([saveChain.catch(() => {}), sleep(timeout)]);

dataHandle('marginalia:saveDb', (_e, payload, meta) => {
  if (savesBlocked) {
    diag('base', 'ecriture ignoree (restauration en cours)');
    return undefined;
  }
  if (typeof payload === 'string') {
    if (payload.length < 2 || payload[0] !== '{') throw new Error('Base invalide');
    const m = isDbObject(meta) ? meta : {};
    return queueSave(payload, {
      version: typeof m.version === 'number' || typeof m.version === 'string' ? m.version : null,
      items: Number.isFinite(m.items) ? m.items : null,
    });
  }
  if (!isDbObject(payload)) throw new Error('Base invalide');
  return queueSave(JSON.stringify(payload), { version: payload.version ?? null, items: countItems(payload) });
});

// ── Vidage du rendu (fermeture, export, restauration) ────────
// Le rendu diffère ses écritures (≤ 2 s) : avant de fermer la fenêtre ou de copier la base, on lui
// demande d'écrire tout de suite ce qui attend, puis on attend la file d'écriture.
const flushReady = new Set();
const flushWaiters = new Map();
let flushSeq = 0;
ipcMain.on('marginalia:flush-ready', (event) => {
  if (trusted(event)) flushReady.add(event.sender.id);
});
ipcMain.on('marginalia:flush-done', (_event, id) => {
  const w = flushWaiters.get(id);
  if (w) {
    flushWaiters.delete(id);
    w(true);
  }
});
function flushRenderer(win, timeout = 3000) {
  if (!win || win.isDestroyed()) return Promise.resolve(false);
  const wc = win.webContents;
  if (wc.isDestroyed() || wc.isCrashed() || !flushReady.has(wc.id)) return Promise.resolve(false);
  const id = ++flushSeq;
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      flushWaiters.delete(id);
      diag('base', 'le rendu n’a pas confirmé son dernier enregistrement');
      resolve(false);
    }, timeout);
    flushWaiters.set(id, (v) => {
      clearTimeout(t);
      resolve(v);
    });
    wc.send('marginalia:flush-request', id);
  });
}
async function flushAll() {
  await Promise.all(BrowserWindow.getAllWindows().map((w) => flushRenderer(w)));
  await waitSaves();
}

// ── Confidentialité : chiffrement et verrouillage (options) ──
// Niveau 1 « chiffrement transparent » : la clé de données (DEK) est protégée par le trousseau du
// système (safeStorage : Trousseau sur Mac, DPAPI de la session sous Windows) et débloquée au lancement,
// sans rien demander. Niveau 2 « verrouillage » : la DEK n'est plus rendue par le trousseau seul ; il
// faut le mot de passe (ou la clé de secours ; ou Touch ID si l'utilisateur l'a activé, qui libère alors
// la copie du trousseau). Dans les deux cas, une clé de secours est créée et montrée une seule fois.
const ksPath = () => path.join(userData(), 'keystore.json');
const FAKE_SAFE = E2E && process.env.MARGINALIA_E2E_FAKE_SAFESTORAGE === '1';
const FAKE_TOUCH = E2E && process.env.MARGINALIA_E2E_FAKE_TOUCHID === '1';
const FAKE_KEYCHAIN_FAIL = E2E && process.env.MARGINALIA_E2E_KEYCHAIN_FAIL === '1';
const TEST_AUTOLOCK_MS = E2E ? Number(process.env.MARGINALIA_E2E_AUTOLOCK_MS) || 0 : 0;
const TEST_CRASH_AFTER = E2E ? Number(process.env.MARGINALIA_E2E_MIGRATION_CRASH_AFTER) || 0 : 0;
const AUTOLOCK_CHOICES = [0, 5, 15, 30, 60];
const PASSWORD_MIN = 8;
// Tests uniquement (MARGINALIA_E2E=1) : un « trousseau » simulé, la clé de test étant fixe.
const FAKE_KEY = crypto.createHash('sha256').update('marginalia-e2e-faux-trousseau').digest();

async function readKeystore() {
  for (const f of [ksPath(), ksPath() + '.bak']) {
    try {
      const ks = JSON.parse(await fsp.readFile(f, 'utf8'));
      if (ks && ks.format === 1 && typeof ks.keyId === 'string' && ks.recovery) {
        if (f !== ksPath()) diag('securite', 'fichier de clés principal illisible : copie .bak utilisée');
        return ks;
      }
    } catch {
      /* absent ou illisible : copie suivante */
    }
  }
  return null;
}
async function saveKeystore(ks) {
  ks.updatedAt = new Date().toISOString();
  const text = JSON.stringify(ks, null, 2);
  await writeAtomic(ksPath(), text);
  await writeAtomic(ksPath() + '.bak', text);
}
async function deleteKeystore() {
  await fsp.rm(ksPath(), { force: true });
  await fsp.rm(ksPath() + '.bak', { force: true });
}

const systemName = () => (IS_MAC ? 'le trousseau de macOS' : IS_WIN ? 'votre session Windows (DPAPI)' : 'le trousseau du système');
/**
 * Le trousseau du système peut-il protéger la clé ? (Linux : seulement avec un vrai trousseau.)
 * `probe` = false (affichage de l'état) : sur Mac et Windows, on n'interroge PAS safeStorage —
 * sur Mac, le premier appel ouvre le trousseau (et peut demander une autorisation, ou rester
 * bloqué si le trousseau est verrouillé). Le trousseau n'est consulté qu'au moment de s'en servir.
 */
function systemStore(probe = true) {
  if (FAKE_SAFE) return { ok: true, name: systemName() };
  if (!probe && (IS_MAC || IS_WIN)) return { ok: true, name: systemName() };
  try {
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'Le trousseau du système n’est pas disponible.' };
    if (process.platform === 'linux') {
      const b = safeStorage.getSelectedStorageBackend();
      if (b === 'basic_text' || b === 'unknown') {
        return { ok: false, reason: 'Aucun trousseau sécurisé (GNOME Keyring, KWallet) n’est disponible : la clé ne pourrait pas y être rangée en sûreté.' };
      }
    }
    return { ok: true, name: systemName() };
  } catch (e) {
    return { ok: false, reason: 'Le trousseau du système n’est pas disponible (' + ((e && e.message) || e) + ').' };
  }
}
function systemWrap(dek) {
  if (FAKE_SAFE) return 'fake:' + vault.seal(FAKE_KEY, dek).toString('base64');
  return safeStorage.encryptString(dek.toString('base64')).toString('base64');
}
function systemUnwrap(s) {
  if (FAKE_KEYCHAIN_FAIL) throw new Error('trousseau indisponible (test)');
  if (FAKE_SAFE) {
    if (!String(s).startsWith('fake:')) throw new Error('enveloppe inconnue');
    return vault.open(FAKE_KEY, Buffer.from(String(s).slice(5), 'base64'));
  }
  return Buffer.from(safeStorage.decryptString(Buffer.from(String(s), 'base64')), 'base64');
}
function touchIdAvailable() {
  if (FAKE_TOUCH) return true;
  if (!IS_MAC) return false;
  try {
    return systemPreferences.canPromptTouchID();
  } catch {
    return false;
  }
}

/** Installe la clé de données en mémoire après vérification (empreinte). */
function setDek(dek) {
  if (!sec.ks || vault.keyId(dek) !== sec.ks.keyId) {
    vault.wipe(dek);
    throw new Error('Clé inattendue');
  }
  if (sec.dek && sec.dek !== dek) vault.wipe(sec.dek);
  sec.dek = dek;
  sec.failures = 0;
  sec.nextTryAt = 0;
  sec.keychainFailed = false;
  sec.lockedBy = null;
  sec.lastActivity = Date.now();
  buildMenu();
}

async function initSecurity() {
  sec.ks = await readKeystore();
  if (!sec.ks) {
    // Base chiffrée sans fichier de clés : on ne la prend surtout pas pour une base endommagée.
    try {
      const fh = await fsp.open(dbPath(), 'r');
      const head = Buffer.alloc(64);
      try {
        await fh.read(head, 0, 64, 0);
      } finally {
        await fh.close();
      }
      if (vault.isSealed(head)) {
        sec.orphan = true;
        diag('securite', 'données chiffrées sans fichier de clés (keystore.json)');
      }
    } catch {
      /* pas de base */
    }
    return;
  }
  if (!needsKey()) return;
  if (!sec.ks.lock.enabled && sec.ks.system) {
    try {
      setDek(systemUnwrap(sec.ks.system));
      diag('securite', 'clé débloquée par le trousseau');
    } catch (e) {
      sec.keychainFailed = true;
      diag('securite', 'le trousseau n’a pas rendu la clé', e && e.message);
    }
  } else if (!sec.ks.lock.enabled) sec.keychainFailed = true;
  if (sec.dek && sec.ks.migration) runMigration(sec.ks.migration.to);
}

function securityStatus() {
  const ks = sec.ks;
  const locked = isLocked();
  const m = sec.migration;
  return {
    available: true,
    platform: process.platform,
    // Sans chiffrement actif, l'état ne touche pas au trousseau (aucune invite au lancement).
    system: systemStore(!!(ks && ks.enabled)),
    touchIdAvailable: touchIdAvailable(),
    encrypted: !!ks && !!ks.enabled,
    lock: !!ks && !!ks.lock.enabled,
    hasPassword: !!ks && !!ks.password,
    touchId: !!ks && !!ks.lock.enabled && !!ks.lock.touchId && !!ks.system,
    autoLockMinutes: ks ? ks.lock.autoLockMinutes : 15,
    lockOnSleep: ks ? ks.lock.lockOnSleep !== false : true,
    locked,
    lockReason: !locked ? null : sec.orphan ? 'orphan' : ks.lock.enabled ? 'lock' : 'keychain',
    lockedBy: locked ? sec.lockedBy : null,
    migration: m
      ? { to: m.to, done: m.done, total: m.total, running: m.running, error: m.error, finished: !!m.finished }
      : ks && ks.migration
        ? { to: ks.migration.to, done: 0, total: 0, running: false, error: null, finished: false }
        : null,
    recoveryCreatedAt: ks && ks.recovery ? ks.recovery.createdAt || ks.createdAt || null : null,
    waitMs: Math.max(0, sec.nextTryAt - Date.now()),
  };
}
function broadcastSecurity() {
  const st = securityStatus();
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('marginalia:security-progress', st);
}

// ── Conversion des fichiers (chiffrer / déchiffrer), reprise possible ──
/** Exécute `fn` dans la file d'écriture de la base (aucune écriture de la base en même temps). */
function inSaveChain(fn) {
  const run = saveChain.catch(() => {}).then(fn);
  saveChain = run;
  return run;
}
async function listDataFiles() {
  const out = [{ full: dbPath(), kind: 'base' }, { full: dbPath() + '.bak', kind: 'base' }];
  for (const f of await zipkit.listFiles(backupsDir())) if (!f.rel.endsWith('.tmp')) out.push({ full: f.full, kind: 'base' });
  for (const f of await zipkit.listFiles(libraryRoot())) if (!f.rel.endsWith('.tmp')) out.push({ full: f.full, kind: 'library' });
  const log = path.join(userData(), 'diagnostic.log');
  out.push({ full: log, kind: 'log' }, { full: log + '.1', kind: 'log' });
  return out;
}
/**
 * Un fichier vers le format `to` : écrit à côté (fichier temporaire + fsync), relu et vérifié
 * (empreinte SHA-256 du contenu en clair), dates conservées, puis renommé à la place de l'original.
 * Renvoie true si le fichier a été converti.
 */
async function transformFile(file, to) {
  const st = await fsp.stat(file).catch(() => null);
  if (!st || !st.isFile()) return false;
  const buf = await fsp.readFile(file);
  const sealed = vault.isSealed(buf);
  if ((to === 'encrypted') === sealed) return false;
  const plain = sealed ? vault.open(sec.dek, buf) : buf;
  const out = to === 'encrypted' ? vault.seal(sec.dek, plain) : plain;
  const digest = vault.sha256(plain);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(out);
      await fh.sync();
    } finally {
      await fh.close();
    }
    const back = await fsp.readFile(tmp);
    const check = to === 'encrypted' ? vault.open(sec.dek, back) : back;
    if (!vault.sha256(check).equals(digest)) throw new Error('vérification de la copie convertie échouée');
    await fsp.utimes(tmp, st.atime, st.mtime);
    await fsp.rename(tmp, file);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw new Error(`${path.relative(userData(), file)} : ${(e && e.message) || e}`);
  }
  return true;
}
/** Journal de diagnostic : converti ligne par ligne (il reste lisible pour l'export). */
async function transformLog(file, to) {
  if (!fs.existsSync(file)) return false;
  await pauseDiag();
  try {
    const text = await fsp.readFile(file, 'utf8');
    let changed = false;
    const out = text.split('\n').map((l) => {
      if (!l) return l;
      const sealed = vault.isSealedLine(l);
      if (to === 'encrypted' && !sealed) {
        changed = true;
        return vault.sealLine(sec.dek, l);
      }
      if (to === 'plain' && sealed) {
        changed = true;
        try {
          return vault.openLine(sec.dek, l);
        } catch {
          return '[ligne chiffrée illisible]';
        }
      }
      return l;
    });
    if (changed) await writeAtomic(file, out.join('\n'));
    return changed;
  } finally {
    resumeDiag();
  }
}
function runMigration(to) {
  if (sec.migration && sec.migration.running) return sec.migration.promise;
  const m = { to, done: 0, total: 0, running: true, error: null };
  sec.migration = m;
  let lastSent = 0;
  const progress = (force) => {
    if (!force && Date.now() - lastSent < 120) return;
    lastSent = Date.now();
    broadcastSecurity();
  };
  m.promise = (async () => {
    diag('securite', to === 'encrypted' ? 'chiffrement des fichiers : début' : 'déchiffrement des fichiers : début');
    let converted = 0;
    let clean = false;
    try {
      // Passes successives : un fichier écrit pendant la conversion dans l'ancien format est repris.
      for (let pass = 0; pass < 3; pass++) {
        const files = await listDataFiles();
        m.total = files.length;
        m.done = 0;
        progress(true);
        let changed = 0;
        for (const f of files) {
          if (TEST_CRASH_AFTER && converted >= TEST_CRASH_AFTER) {
            diag('securite', 'arrêt brutal simulé (test)');
            process.exit(70);
          }
          const job = () => (f.kind === 'log' ? transformLog(f.full, to) : transformFile(f.full, to));
          const did = f.kind === 'library' ? await withFileLock(f.full, job) : await inSaveChain(job);
          if (did) {
            changed++;
            converted++;
          }
          m.done++;
          progress(false);
        }
        // Une passe sans aucune conversion vaut vérification : chaque fichier a été relu dans le bon format.
        if (!changed) {
          clean = true;
          break;
        }
      }
      if (!clean) throw new Error('des fichiers ont encore changé pendant la conversion : réessayez');
      if (to === 'plain') {
        await deleteKeystore();
        vault.wipe(sec.dek);
        sec.dek = null;
        sec.ks = null;
      } else {
        sec.ks.migration = null;
        await saveKeystore(sec.ks);
      }
      diag('securite', to === 'encrypted' ? 'chiffrement terminé' : 'déchiffrement terminé', { fichiers: converted });
      m.running = false;
      m.finished = true;
      buildMenu();
      progress(true);
    } catch (e) {
      m.running = false;
      m.error = String((e && e.message) || e);
      diag('securite', 'conversion interrompue', m.error);
      progress(true);
    }
  })();
  return m.promise;
}

// ── Verrouillage ─────────────────────────────────────────────
async function lockNow(reason) {
  if (!sec.ks || !sec.ks.lock.enabled || !sec.dek || sec.locking) return false;
  if (sec.migration && sec.migration.running) return false; // reprise après la conversion
  sec.locking = true;
  try {
    // Les modifications en attente sont écrites (chiffrées) avant d'oublier la clé.
    await flushAll();
    await waitSaves();
    await Promise.all([...fileLocks.values()]);
    wifiReceiver.stop('locked');
    vault.wipe(sec.dek);
    sec.dek = null;
    sec.lockedBy = reason;
    diag('securite', 'verrouillage', reason);
    buildMenu();
    // La page repart de zéro : plus aucune donnée dans la mémoire du rendu.
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.reload();
    return true;
  } finally {
    sec.locking = false;
  }
}
function autoLockMs() {
  if (!sec.ks || !sec.ks.lock.enabled || !sec.ks.lock.autoLockMinutes) return 0;
  return TEST_AUTOLOCK_MS || sec.ks.lock.autoLockMinutes * 60000;
}
function startAutoLock() {
  setInterval(
    () => {
      const ms = autoLockMs();
      if (ms && sec.dek && Date.now() - sec.lastActivity >= ms) lockNow('inactivite').catch((e) => diag('securite', 'verrouillage', e && e.message));
    },
    TEST_AUTOLOCK_MS ? 250 : 5000,
  ).unref?.();
  const onSleep = (why) => {
    if (sec.ks && sec.ks.lock.enabled && sec.ks.lock.lockOnSleep !== false) lockNow(why).catch((e) => diag('securite', 'verrouillage', e && e.message));
  };
  powerMonitor.on('suspend', () => onSleep('veille'));
  powerMonitor.on('lock-screen', () => onSleep('ecran-verrouille'));
}
ipcMain.on('marginalia:security-activity', (event) => {
  if (trusted(event)) sec.lastActivity = Date.now();
});
function lockMenuItem() {
  const on = !!sec.ks && sec.ks.lock.enabled && !!sec.dek;
  return { label: 'Verrouiller maintenant', accelerator: 'CmdOrCtrl+Shift+L', enabled: on, click: () => lockNow('menu').catch((e) => diag('securite', 'verrouillage', e && e.message)) };
}

// ── Questions posées à l'interface (mot de passe d'une archive chiffrée) ──
const asks = new Map();
let askSeq = 0;
function askRenderer(payload) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!win) return Promise.resolve(null);
  const id = ++askSeq;
  return new Promise((resolve) => {
    asks.set(id, resolve);
    win.webContents.send('marginalia:security-ask', { id, ...payload });
    win.once('closed', () => asks.has(id) && (asks.delete(id), resolve(null)));
  });
}

// ── Opérations (canal « marginalia:security ») ───────────────
const fail = (error) => ({ ok: false, error });
function checkNewPassword(pw) {
  if (typeof pw !== 'string' || [...pw].length < PASSWORD_MIN) throw new Error(`Le mot de passe doit compter au moins ${PASSWORD_MIN} caractères.`);
  if (pw.length > 1024) throw new Error('Mot de passe trop long.');
}
const validDelay = (v, dflt) => (AUTOLOCK_CHOICES.includes(Number(v)) ? Number(v) : dflt);
function requireUnlocked() {
  if (isLocked()) throw new vault.LockedError();
}
/** Délai croissant après trois échecs (1 s, 2 s, 4 s… 30 s au plus). */
function attemptWait() {
  return Math.max(0, sec.nextTryAt - Date.now());
}
function noteFailure() {
  sec.failures++;
  if (sec.failures >= 3) sec.nextTryAt = Date.now() + Math.min(30000, 1000 * 2 ** (sec.failures - 3));
  diag('securite', 'déverrouillage refusé', { essais: sec.failures });
}
/** Vérifie le mot de passe actuel (sans changer l'état). */
async function passwordOk(pw) {
  if (!sec.ks || !sec.ks.password) return false;
  const wait = attemptWait();
  if (wait) await sleep(wait);
  const dek = await vault.unwrapWithPassword(String(pw || ''), sec.ks.password);
  const good = !!dek && vault.keyId(dek) === sec.ks.keyId;
  vault.wipe(dek);
  if (!good) noteFailure();
  else {
    sec.failures = 0;
    sec.nextTryAt = 0;
  }
  return good;
}
function takePending(token, kind) {
  const p = sec.pending;
  if (!p || p.token !== token || p.kind !== kind || p.expires < Date.now()) throw new Error('Cette clé de secours a expiré : recommencez.');
  sec.pending = null;
  return p;
}
function newPending(kind, dek) {
  if (sec.pending && sec.pending.dek && sec.pending.dek !== sec.dek) vault.wipe(sec.pending.dek);
  sec.pending = { kind, token: crypto.randomBytes(16).toString('hex'), recoveryKey: vault.newRecoveryKey(), dek, expires: Date.now() + 60 * 60000 };
  return { token: sec.pending.token, recoveryKey: sec.pending.recoveryKey };
}
const lockOptions = (o, prev) => ({
  enabled: true,
  touchId: !!o.touchId && touchIdAvailable() && systemStore().ok,
  autoLockMinutes: validDelay(o.autoLockMinutes, prev ? prev.autoLockMinutes : 15),
  lockOnSleep: o.lockOnSleep !== false,
});

const RECOVERY_HTML = (key) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Clé de secours Marginalia</title>
<style>
  @page { size: A4; margin: 22mm; }
  body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1d1a15; }
  h1 { font-family: Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 30px; margin: 0 0 6px; }
  .sub { color: #4a443a; font-size: 13px; margin: 0 0 28px; }
  .key { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 24px; letter-spacing: 0.06em; padding: 22px 24px; border: 1.5px solid #1d1a15; border-radius: 12px; text-align: center; }
  ul { font-size: 13px; line-height: 1.6; color: #4a443a; padding-left: 18px; margin-top: 28px; }
  .date { margin-top: 36px; font-size: 12px; color: #7a7266; }
</style></head><body>
<h1>Clé de secours — Marginalia</h1>
<p class="sub">Elle permet de retrouver vos données si vous oubliez votre mot de passe ou si cet ordinateur ne rend plus la clé.</p>
<div class="key">${key}</div>
<ul>
  <li>Rangez cette feuille en lieu sûr, loin de l’ordinateur (et ne la photographiez pas).</li>
  <li>Toute personne qui la possède, avec une copie de vos fichiers, peut lire vos données.</li>
  <li>Sans mot de passe ni clé de secours, vos données sont définitivement illisibles.</li>
</ul>
<p class="date">Créée le ${frDate(Date.now())}</p>
</body></html>`;

async function renderRecoveryPdf(html) {
  const win = new BrowserWindow({ show: false, width: 794, height: 1123, webPreferences: { offscreen: true, javascript: false, sandbox: true, contextIsolation: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

const securityOps = {
  status: async () => securityStatus(),

  async unlockPassword({ password }) {
    if (!sec.ks || !sec.ks.password || !isLocked()) return fail('Rien à déverrouiller.');
    const wait = attemptWait();
    if (wait) await sleep(wait);
    const dek = await vault.unwrapWithPassword(String(password || ''), sec.ks.password);
    if (!dek || vault.keyId(dek) !== sec.ks.keyId) {
      vault.wipe(dek);
      noteFailure();
      return fail('Mot de passe incorrect.');
    }
    setDek(dek);
    diag('securite', 'déverrouillé (mot de passe)');
    if (sec.ks.migration) runMigration(sec.ks.migration.to);
    return { ok: true };
  },

  async unlockRecovery({ recoveryKey, newPassword }) {
    if (!sec.ks || !isLocked()) return fail('Rien à déverrouiller.');
    const wait = attemptWait();
    if (wait) await sleep(wait);
    if (!vault.looksLikeRecoveryKey(recoveryKey)) return fail('Ce n’est pas une clé de secours : 32 caractères, en 8 groupes de 4.');
    const dek = vault.unwrapWithRecovery(recoveryKey, sec.ks.recovery);
    if (!dek || vault.keyId(dek) !== sec.ks.keyId) {
      vault.wipe(dek);
      noteFailure();
      return fail('Clé de secours incorrecte.');
    }
    if (sec.ks.lock.enabled) {
      try {
        checkNewPassword(newPassword);
      } catch (e) {
        vault.wipe(dek);
        return fail(e.message);
      }
      sec.ks.password = await vault.wrapWithPassword(newPassword, dek);
    }
    // Le trousseau n'avait pas rendu la clé (mise à jour de l'app…) : on l'y range de nouveau.
    if ((!sec.ks.lock.enabled || sec.ks.lock.touchId) && systemStore().ok) {
      try {
        sec.ks.system = systemWrap(dek);
      } catch (e) {
        diag('securite', 'trousseau', e && e.message);
      }
    }
    await saveKeystore(sec.ks);
    setDek(dek);
    diag('securite', 'déverrouillé (clé de secours)');
    if (sec.ks.migration) runMigration(sec.ks.migration.to);
    return { ok: true };
  },

  async unlockTouchId() {
    if (!sec.ks || !isLocked() || !sec.ks.lock.touchId || !sec.ks.system) return fail('Touch ID n’est pas activé.');
    try {
      if (!FAKE_TOUCH) {
        if (!touchIdAvailable()) return fail('Touch ID n’est pas disponible.');
        await systemPreferences.promptTouchID('déverrouiller Marginalia');
      }
    } catch {
      return fail('Touch ID n’a pas reconnu l’empreinte (ou a été annulé).');
    }
    try {
      setDek(systemUnwrap(sec.ks.system));
    } catch (e) {
      diag('securite', 'trousseau', e && e.message);
      return fail('Le trousseau n’a pas rendu la clé : utilisez votre mot de passe.');
    }
    diag('securite', 'déverrouillé (Touch ID)');
    if (sec.ks.migration) runMigration(sec.ks.migration.to);
    return { ok: true };
  },

  /** Nouvelle clé de données et clé de secours, montrées avant l'activation (rien n'est encore écrit). */
  async prepare() {
    if (sec.ks) throw new Error('Le chiffrement est déjà activé.');
    return newPending('enable', vault.newDek());
  },

  /** Active le chiffrement (et le verrouillage si `lock` est fourni), puis chiffre tous les fichiers. */
  async enable({ token, lock }) {
    if (sec.ks) throw new Error('Le chiffrement est déjà activé.');
    if (isLocked()) throw new vault.LockedError();
    const sys = systemStore();
    if (!lock && !sys.ok) throw new Error(sys.reason);
    if (lock) checkNewPassword(lock.password);
    const p = takePending(token, 'enable');
    const lk = lock ? lockOptions(lock) : { enabled: false, touchId: false, autoLockMinutes: 15, lockOnSleep: true };
    const now = new Date().toISOString();
    const ks = {
      format: 1,
      keyId: vault.keyId(p.dek),
      enabled: true,
      migration: { to: 'encrypted', startedAt: now },
      system: !lock || lk.touchId ? systemWrap(p.dek) : null,
      recovery: { ...vault.wrapWithRecovery(p.recoveryKey, p.dek), createdAt: now },
      password: lock ? await vault.wrapWithPassword(lock.password, p.dek) : null,
      lock: lk,
      createdAt: now,
    };
    // Ce qui attend est écrit, puis une copie de la base est mise de côté avant la conversion.
    await flushAll();
    await inSaveChain(async () => {
      const cur = await readDbFile(dbPath());
      if (cur.ok) await writeBackup('avant-chiffrement-', cur.text, 3);
    });
    await saveKeystore(ks);
    sec.ks = ks;
    sec.dek = p.dek;
    sec.lastActivity = Date.now();
    diag('securite', 'chiffrement activé', { verrouillage: !!lock, touchId: lk.touchId });
    buildMenu();
    runMigration('encrypted');
    return { ok: true };
  },

  /** Données déjà chiffrées : ajoute le mot de passe (la clé de secours actuelle reste valable). */
  async enableLock(o) {
    requireUnlocked();
    if (!sec.ks || !sec.ks.enabled) throw new Error('Activez d’abord le chiffrement.');
    if (sec.ks.lock.enabled) throw new Error('Le verrouillage est déjà activé.');
    checkNewPassword(o.password);
    sec.ks.password = await vault.wrapWithPassword(o.password, sec.dek);
    sec.ks.lock = lockOptions(o, sec.ks.lock);
    // Sans Touch ID, la copie du trousseau disparaît : le mot de passe devient indispensable.
    sec.ks.system = sec.ks.lock.touchId ? sec.ks.system || systemWrap(sec.dek) : null;
    await saveKeystore(sec.ks);
    sec.lastActivity = Date.now();
    diag('securite', 'verrouillage activé', { touchId: sec.ks.lock.touchId });
    buildMenu();
    return { ok: true };
  },

  async disableLock({ password }) {
    requireUnlocked();
    if (!sec.ks || !sec.ks.lock.enabled) return { ok: true };
    const sys = systemStore();
    if (!sys.ok) return fail(sys.reason + ' Désactivez plutôt le chiffrement.');
    if (!(await passwordOk(password))) return fail('Mot de passe incorrect.');
    sec.ks.system = systemWrap(sec.dek);
    sec.ks.password = null;
    sec.ks.lock = { ...sec.ks.lock, enabled: false, touchId: false };
    await saveKeystore(sec.ks);
    diag('securite', 'verrouillage désactivé');
    buildMenu();
    return { ok: true };
  },

  /** Déchiffre tout et retire le fichier de clés (quand tout est vérifié en clair). */
  async disable({ password }) {
    requireUnlocked();
    if (!sec.ks) return { ok: true };
    if (sec.ks.lock.enabled && !(await passwordOk(password))) return fail('Mot de passe incorrect.');
    await flushAll();
    await inSaveChain(async () => {
      const cur = await readDbFile(dbPath());
      if (cur.ok) await writeBackup('avant-dechiffrement-', cur.text, 3);
    });
    // Copie dans le trousseau si possible : une conversion interrompue reprend sans rien demander.
    if (!sec.ks.system && systemStore().ok) sec.ks.system = systemWrap(sec.dek);
    sec.ks.enabled = false;
    sec.ks.lock = { ...sec.ks.lock, enabled: false, touchId: false };
    sec.ks.migration = { to: 'plain', startedAt: new Date().toISOString() };
    await saveKeystore(sec.ks);
    diag('securite', 'chiffrement désactivé : déchiffrement des fichiers');
    buildMenu();
    runMigration('plain');
    return { ok: true };
  },

  async resume() {
    requireUnlocked();
    if (sec.ks && sec.ks.migration) runMigration(sec.ks.migration.to);
    return { ok: true };
  },

  async changePassword({ oldPassword, newPassword }) {
    requireUnlocked();
    if (!sec.ks || !sec.ks.password) throw new Error('Aucun mot de passe à changer.');
    checkNewPassword(newPassword);
    if (!(await passwordOk(oldPassword))) return fail('Mot de passe actuel incorrect.');
    sec.ks.password = await vault.wrapWithPassword(newPassword, sec.dek);
    await saveKeystore(sec.ks);
    diag('securite', 'mot de passe changé');
    return { ok: true };
  },

  /** Nouvelle clé de secours (l'ancienne reste valable jusqu'à la confirmation). */
  async prepareRecovery({ password }) {
    requireUnlocked();
    if (!sec.ks) throw new Error('Le chiffrement n’est pas activé.');
    if (sec.ks.lock.enabled && !(await passwordOk(password))) return fail('Mot de passe incorrect.');
    return { ok: true, ...newPending('recovery', sec.dek) };
  },
  async commitRecovery({ token }) {
    requireUnlocked();
    const p = takePending(token, 'recovery');
    sec.ks.recovery = { ...vault.wrapWithRecovery(p.recoveryKey, sec.dek), createdAt: new Date().toISOString() };
    await saveKeystore(sec.ks);
    diag('securite', 'nouvelle clé de secours');
    return { ok: true };
  },
  async cancelPending() {
    if (sec.pending && sec.pending.dek && sec.pending.dek !== sec.dek) vault.wipe(sec.pending.dek);
    sec.pending = null;
    return { ok: true };
  },

  async setOptions(o) {
    requireUnlocked();
    if (!sec.ks || !sec.ks.lock.enabled) throw new Error('Le verrouillage n’est pas activé.');
    if (o.autoLockMinutes !== undefined) sec.ks.lock.autoLockMinutes = validDelay(o.autoLockMinutes, sec.ks.lock.autoLockMinutes);
    if (o.lockOnSleep !== undefined) sec.ks.lock.lockOnSleep = !!o.lockOnSleep;
    if (o.touchId !== undefined) {
      if (o.touchId) {
        if (!touchIdAvailable() || !systemStore().ok) return fail('Touch ID n’est pas disponible sur cet ordinateur.');
        sec.ks.system = systemWrap(sec.dek);
        sec.ks.lock.touchId = true;
      } else {
        sec.ks.system = null;
        sec.ks.lock.touchId = false;
      }
    }
    await saveKeystore(sec.ks);
    sec.lastActivity = Date.now();
    return { ok: true };
  },

  async lockNow() {
    return { ok: await lockNow('demande') };
  },

  /** Clé de secours en attente : impression (dialogue du système) ou PDF à enregistrer. */
  async printRecovery({ token, mode }) {
    const p = sec.pending;
    if (!p || p.token !== token) throw new Error('Cette clé de secours a expiré : recommencez.');
    const html = RECOVERY_HTML(p.recoveryKey);
    if (mode === 'print') {
      const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
      try {
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        const ok = await new Promise((resolve) => win.webContents.print({ silent: false, printBackground: true }, (success) => resolve(success)));
        return { ok };
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
    }
    const pdf = await renderRecoveryPdf(html);
    const r = await dialog.showSaveDialog(parentWindow(), {
      title: 'Enregistrer la clé de secours',
      defaultPath: path.join(app.getPath('documents'), 'Marginalia - clé de secours.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false };
    await writeAtomic(r.filePath, pdf);
    return { ok: true, path: r.filePath };
  },

  async answer({ id, value }) {
    const resolve = asks.get(id);
    if (resolve) {
      asks.delete(id);
      resolve(typeof value === 'string' ? value : null);
    }
    return { ok: true };
  },
};
handle('marginalia:security', async (_e, op, args) => {
  const fn = Object.prototype.hasOwnProperty.call(securityOps, op) ? securityOps[op] : null;
  if (!fn) throw new Error('Opération inconnue');
  const r = await fn(args && typeof args === 'object' ? args : {});
  if (op !== 'status' && op !== 'answer') setImmediate(broadcastSecurity);
  return r;
});

// ── Bibliothèque de fichiers ─────────────────────────────────
dataHandle('marginalia:storeFile', async (_e, id, fileName, data) => {
  const file = libraryPath(id, fileName);
  await withFileLock(file, () => writeData(file, toBuffer(data)));
});
dataHandle('marginalia:readFile', async (_e, id, fileName) => {
  const buf = await readData(libraryPath(id, fileName));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
});
dataHandle('marginalia:deleteFile', async (_e, id, fileName) => {
  const file = libraryPath(id, fileName);
  await withFileLock(file, () => fsp.rm(file, { force: true }));
  if (/^source\./.test(String(fileName))) {
    for (const d of DERIVED_FILES) {
      const f = libraryPath(id, d);
      await withFileLock(f, () => fsp.rm(f, { force: true })).catch(() => {});
    }
  }
  // Remonte et retire les dossiers vides jusqu'à library/<id> inclus.
  const stop = path.join(libraryRoot(), id);
  let dir = path.dirname(file);
  while (dir === stop || isInside(dir, stop)) {
    try {
      await fsp.rmdir(dir);
    } catch {
      break;
    }
    if (dir === stop) break;
    dir = path.dirname(dir);
  }
});

// ── Images que Chromium ne décode pas (HEIC, TIFF) ───────────
// macOS : conversion en JPEG par l'outil système `sips` (aucun module natif). Fichiers temporaires
// dans le dossier temporaire de l'utilisateur, supprimés aussitôt.
// Windows / Linux : le preload n'expose pas cette fonction ; le rendu décode HEIC et TIFF avec un
// décodeur JS/WASM embarqué dans l'app (src/features/reader/image/convert.worker.ts).
dataHandle('marginalia:convertImage', async (_e, data, ext) => {
  if (!IS_MAC) throw new Error('Conversion par sips disponible sur macOS uniquement');
  const safeExt = String(ext).toLowerCase();
  if (!IMAGES.includes(safeExt)) throw new Error('Format d’image non pris en charge');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marginalia-img-'));
  const src = path.join(dir, `source.${safeExt}`);
  const out = path.join(dir, 'converti.jpg');
  try {
    await fsp.writeFile(src, toBuffer(data));
    await new Promise((resolve, reject) => {
      require('node:child_process').execFile(
        '/usr/bin/sips',
        ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', src, '--out', out],
        { timeout: 60000 },
        (err) => (err ? reject(new Error('Conversion impossible : ' + err.message)) : resolve()),
      );
    });
    const buf = await fsp.readFile(out);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ── Dialogues ────────────────────────────────────────────────
function parentWindow() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || undefined;
}

async function readPicked(file) {
  const buf = await fsp.readFile(file);
  return { name: path.basename(file), data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
}

dataHandle('marginalia:pickFiles', async () => {
  const r = await dialog.showOpenDialog(parentWindow(), {
    title: 'Importer des documents',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Documents et images', extensions: ACCEPTED },
      { name: 'Tous les fichiers', extensions: ['*'] },
    ],
  });
  if (r.canceled) return [];
  return Promise.all(r.filePaths.map(readPicked));
});

dataHandle('marginalia:saveText', async (_e, defaultName, content) => {
  const ext = path.extname(String(defaultName)).slice(1).toLowerCase() || 'md';
  const r = await dialog.showSaveDialog(parentWindow(), {
    defaultPath: path.join(app.getPath('documents'), safeDefaultName(defaultName)),
    filters: [
      { name: ext === 'md' ? 'Markdown' : ext.toUpperCase(), extensions: [ext] },
      { name: 'Texte', extensions: ['txt'] },
    ],
  });
  if (r.canceled || !r.filePath) return false;
  await writeAtomic(r.filePath, Buffer.from(String(content), 'utf8'));
  return true;
});

dataHandle('marginalia:openDocx', async () => {
  const r = await dialog.showOpenDialog(parentWindow(), {
    title: 'Ouvrir un document Word',
    properties: ['openFile'],
    filters: [{ name: 'Document Word', extensions: ['docx'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const picked = await readPicked(file);
  externalAllowed.add(path.resolve(file));
  return { path: file, name: picked.name, data: picked.data };
});

/**
 * Réécrit un .docx déjà présent sur le disque (jamais de création) après copie .bak.
 * Seuls les fichiers choisis par l'utilisateur (« Ouvrir un .docx », cette session ou une précédente :
 * chemins liés présents dans la base au démarrage) peuvent être réécrits.
 */
dataHandle('marginalia:writeExternal', async (_e, target, data) => {
  if (typeof target !== 'string' || !path.isAbsolute(target) || path.extname(target).toLowerCase() !== '.docx') {
    throw new Error('Seuls les fichiers .docx existants peuvent être réécrits');
  }
  if (!externalAllowed.has(path.resolve(target))) throw new Error('Ce fichier n’a pas été ouvert dans Marginalia');
  const st = await fsp.stat(target); // lève ENOENT si le fichier n'existe pas
  if (!st.isFile()) throw new Error('Ce chemin n’est pas un fichier');
  await fsp.copyFile(target, target + '.bak');
  await writeAtomic(target, toBuffer(data));
});

const SAVE_FILTERS = {
  docx: { name: 'Document Word', extensions: ['docx'] },
  pdf: { name: 'PDF', extensions: ['pdf'] },
  md: { name: 'Markdown', extensions: ['md'] },
  html: { name: 'Page web', extensions: ['html'] },
  txt: { name: 'Texte', extensions: ['txt'] },
  png: { name: 'Image PNG', extensions: ['png'] },
  svg: { name: 'Image SVG', extensions: ['svg'] },
};

// Polices installées : liste native de macOS (NSFontManager via JavaScript for Automation),
// repli sur system_profiler ; Windows : PowerShell (familles GDI+, repli sur le registre) ;
// Linux : fc-list. Aucun accès réseau ; résultat mis en cache pour la session.
let fontCache = null;
// ── Fenêtre : déplacement par la barre du haut, sans zone « app-region » CSS ──
// Sur macOS, les zones de glissement CSS sont recalculées à chaque changement de mise en page
// (sélection de texte, barres flottantes) et peuvent provoquer des saccades ou un « zoom »
// involontaire de la fenêtre. On déplace donc la fenêtre nous-mêmes.
// Sous Windows, les barres du haut utilisent -webkit-app-region: drag (classe .platform-win) :
// accrochage aux bords, double-clic et menu système natifs ; ce déplacement en JS n'y sert plus.
let dragTimer = null;
function stopDrag() {
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
}
handle('marginalia:windowDragStart', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isFullScreen()) return;
  stopDrag();
  const start = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  diag('fenetre', 'drag-start', { cursor: start, bounds: win.getBounds(), max: win.isMaximized() });
  const dx = start.x - wx;
  const dy = start.y - wy;
  const t0 = Date.now();
  dragTimer = setInterval(() => {
    if (win.isDestroyed() || Date.now() - t0 > 20000) return stopDrag();
    const p = screen.getCursorScreenPoint();
    win.setPosition(Math.round(p.x - dx), Math.round(p.y - dy));
  }, 8);
});
handle('marginalia:windowDragEnd', async () => stopDrag());
handle('marginalia:windowDoubleClick', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isFullScreen()) return;
  let action = 'Maximize'; // Windows / Linux : agrandir ou restaurer
  if (IS_MAC) {
    try {
      action = systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string') || 'Maximize';
    } catch {
      action = 'Maximize';
    }
  }
  diag('fenetre', 'double-clic barre', { action, max: win.isMaximized(), bounds: win.getBounds() });
  if (action === 'Minimize') win.minimize();
  else if (action === 'None') return;
  else if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
// Thème natif (menus, fond de fenêtre) aligné sur le choix de l'utilisateur. Hors macOS, les
// boutons de fenêtre (titleBarOverlay) prennent les couleurs du thème affiché (clair, sombre, sépia).
const HEX = /^#[0-9a-f]{6}$/i;
function overlayFor(dark) {
  return { color: dark ? '#121110' : '#efebe3', symbolColor: dark ? '#c4bcae' : '#4a443a', height: TITLEBAR_H };
}
handle('marginalia:setTheme', async (e, mode, titleBar) => {
  nativeTheme.themeSource = mode === 'dark' ? 'dark' : mode === 'system' ? 'system' : 'light';
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return;
  const bg = titleBar && HEX.test(titleBar.color) ? titleBar.color : nativeTheme.shouldUseDarkColors ? '#121110' : '#efebe3';
  win.setBackgroundColor(bg);
  if (!IS_MAC && typeof win.setTitleBarOverlay === 'function') {
    const o = overlayFor(nativeTheme.shouldUseDarkColors);
    if (titleBar && HEX.test(titleBar.color)) o.color = titleBar.color;
    if (titleBar && HEX.test(titleBar.symbolColor)) o.symbolColor = titleBar.symbolColor;
    try {
      win.setTitleBarOverlay(o);
    } catch (err) {
      diag('fenetre', 'titleBarOverlay', err && err.message);
    }
  }
});

// Journal depuis le rendu : 120 lignes par minute au plus (une boucle d'erreurs ne remplit pas le disque).
let rendererDiagWindow = 0;
let rendererDiagCount = 0;
handle('marginalia:diag', async (_e, ...parts) => {
  const now = Date.now();
  if (now - rendererDiagWindow > 60000) {
    if (rendererDiagCount > 120) diag('renderer', `… ${rendererDiagCount - 120} lignes ignorées (limite de débit)`);
    rendererDiagWindow = now;
    rendererDiagCount = 0;
  }
  if (++rendererDiagCount > 120) return;
  diag('renderer', ...parts.slice(0, 8));
});

// ── Import depuis l'app Livres d'Apple (EPUB et PDF sans DRM) ──
// Les EPUB de Livres sont des « paquets » (dossiers *.epub). On les lit en local, on écarte ceux
// protégés (FairPlay : META-INF/sinf.xml ; Adobe : rights.xml ; encryption.xml hors polices),
// puis on les rezippe au format EPUB standard (mimetype en premier, non compressé).
const BOOKS_DIRS = () => [
  path.join(os.homedir(), 'Library/Mobile Documents/iCloud~com~apple~iBooks/Documents'),
  path.join(os.homedir(), 'Library/Containers/com.apple.BKAgentService/Data/Documents/iBooks/Books'),
];
const FONT_OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'];
function decodeXml(t) {
  return String(t || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .trim();
}
async function epubPackageInfo(dir) {
  const meta = path.join(dir, 'META-INF');
  const exists = async (f) => !!(await fsp.stat(f).catch(() => null));
  let drm = null;
  if (await exists(path.join(meta, 'sinf.xml'))) drm = 'Apple';
  else if (await exists(path.join(meta, 'rights.xml'))) drm = 'Adobe';
  else {
    const enc = await fsp.readFile(path.join(meta, 'encryption.xml'), 'utf8').catch(() => null);
    if (enc) {
      const algos = [...enc.matchAll(/Algorithm="([^"]+)"/g)].map((m) => m[1]);
      if (/EncryptedKey/.test(enc) || algos.some((a) => !FONT_OBFUSCATION.includes(a))) drm = 'inconnu';
    }
  }
  let title = '';
  let author = '';
  try {
    const container = await fsp.readFile(path.join(meta, 'container.xml'), 'utf8');
    const opfRel = (container.match(/full-path="([^"]+)"/) || [])[1];
    if (opfRel) {
      const opf = await fsp.readFile(path.join(dir, opfRel), 'utf8');
      title = decodeXml((opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/) || [])[1]);
      author = decodeXml((opf.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/) || [])[1]);
    }
  } catch {
    /* métadonnées absentes : on garde le nom du dossier */
  }
  return { drm, title, author };
}
dataHandle('marginalia:appleBooksScan', async () => {
  if (!APPLE_BOOKS) return [];
  const out = [];
  for (const base of BOOKS_DIRS()) {
    let entries = [];
    try {
      entries = await fsp.readdir(base, { withFileTypes: true });
    } catch {
      continue; // dossier absent ou non autorisé
    }
    for (const e of entries) {
      const full = path.join(base, e.name);
      const lower = e.name.toLowerCase();
      if (e.name.startsWith('.')) {
        // Livre resté dans iCloud (« .Titre.epub.icloud ») : on demande son téléchargement ;
        // la surveillance du dossier relancera la synchro quand il sera arrivé.
        const m = e.name.match(/^\.(.+\.(epub|pdf))\.icloud$/i);
        if (m && IS_MAC) {
          const real = path.join(base, m[1]);
          require('child_process').execFile('/usr/bin/brctl', ['download', real], { timeout: 30000 }, () => {});
          out.push({ path: real, name: m[1], kind: m[2].toLowerCase(), title: m[1].replace(/\.(epub|pdf)$/i, ''), author: '', drm: null, pending: true });
        }
        continue;
      }
      if (lower.endsWith('.epub')) {
        if (e.isDirectory()) {
          const info = await epubPackageInfo(full);
          out.push({ path: full, name: e.name, kind: 'epub', title: info.title || e.name.replace(/\.epub$/i, ''), author: info.author, drm: info.drm });
        } else {
          out.push({ path: full, name: e.name, kind: 'epub', title: e.name.replace(/\.epub$/i, ''), author: '', drm: null });
        }
      } else if (lower.endsWith('.pdf') && e.isFile()) {
        out.push({ path: full, name: e.name, kind: 'pdf', title: e.name.replace(/\.pdf$/i, ''), author: '', drm: null });
      }
    }
  }
  const seen = new Set();
  return out
    .sort((a, b) => Number(!!a.pending) - Number(!!b.pending)) // un exemplaire présent l'emporte sur un fantôme iCloud
    .filter((b) => (seen.has(b.name) ? false : seen.add(b.name)))
    .sort((a, b) => a.title.localeCompare(b.title, 'fr'));
});
// Surveillance des dossiers de Livres : un livre ajouté sur l'iPhone arrive par iCloud,
// et l'app est prévenue (sans réseau de son côté : c'est macOS qui synchronise).
let booksWatchers = null;
let booksTimer = null;
dataHandle('marginalia:appleBooksWatch', async () => {
  if (!APPLE_BOOKS) return false;
  if (booksWatchers) return true;
  booksWatchers = [];
  const notify = () => {
    clearTimeout(booksTimer);
    booksTimer = setTimeout(() => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('marginalia:appleBooksChanged');
    }, 2500);
  };
  // Dossier des annotations (AEAnnotation) : surlignages, notes, signets et position reçus par iCloud.
  for (const base of [...BOOKS_DIRS(), AE_DIR()]) {
    try {
      booksWatchers.push(fs.watch(base, { persistent: false }, notify));
    } catch {
      /* dossier absent ou non autorisé */
    }
  }
  return booksWatchers.length > 0;
});
dataHandle('marginalia:appleBooksRead', async (_e, p) => {
  if (!APPLE_BOOKS) throw new Error('App Livres indisponible sur ce système');
  const allowed = typeof p === 'string' && BOOKS_DIRS().some((d) => isInside(path.resolve(p), d));
  if (!allowed) throw new Error('Chemin non autorisé');
  const st = await fsp.stat(p);
  if (!st.isDirectory()) {
    const buf = await fsp.readFile(p);
    return { name: path.basename(p), data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }
  const info = await epubPackageInfo(p);
  if (info.drm) throw new Error(`Livre protégé (DRM ${info.drm})`);
  const { execFile } = require('child_process');
  const tmp = path.join(os.tmpdir(), `marginalia-book-${crypto.randomBytes(6).toString('hex')}.epub`);
  const zip = (args) =>
    new Promise((resolve, reject) =>
      execFile('/usr/bin/zip', args, { cwd: p, timeout: 120000, maxBuffer: 16 * 1024 * 1024 }, (err) => (err ? reject(err) : resolve())),
    );
  try {
    await zip(['-X0', '-q', tmp, 'mimetype']);
    await zip(['-rX9', '-q', tmp, '.', '-x', 'mimetype', '-x', '.*', '-x', '*/.*', '-x', 'iTunesMetadata*.plist']);
    const buf = await fsp.readFile(tmp);
    return { name: path.basename(p), data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  } finally {
    fsp.unlink(tmp).catch(() => {});
  }
});

// ── Annotations de Livres (surlignages, notes, signets, position) ──
// Lecture seule des bases de Livres : on copie la base (+ -wal, -shm) dans un dossier temporaire,
// puis on l'interroge avec l'outil système sqlite3 (aucun module natif). L'original n'est jamais
// ouvert par sqlite3, donc jamais modifié. Schéma non documenté par Apple : colonnes vérifiées
// (PRAGMA table_info), valeurs inconnues ignorées, écarts consignés dans le journal de diagnostic.
const IBOOKSX_DOCS = () => path.join(os.homedir(), 'Library/Containers/com.apple.iBooksX/Data/Documents');
const AE_DIR = () => path.join(IBOOKSX_DOCS(), 'AEAnnotation');
const BK_DIR = () => path.join(IBOOKSX_DOCS(), 'BKLibrary');
const APPLE_EPOCH_S = 978307200; // 1er janvier 2001, en secondes Unix
const BOOKS_DENIED =
  'macOS refuse l’accès aux données de Livres. Autorisez Marginalia dans Réglages système › Confidentialité et sécurité › Accès complet au disque (ou acceptez la demande d’accès aux données d’autres apps), puis relancez la synchronisation.';
let sqliteBinCache = null;
function sqliteBin() {
  if (sqliteBinCache) return sqliteBinCache;
  const candidates = IS_MAC ? ['/usr/bin/sqlite3'] : ['/usr/bin/sqlite3', '/usr/local/bin/sqlite3', '/bin/sqlite3'];
  sqliteBinCache = candidates.find((c) => fs.existsSync(c)) || 'sqlite3';
  return sqliteBinCache;
}
const isDenied = (e) => !!e && (e.code === 'EPERM' || e.code === 'EACCES');
/** Base la plus récente d'un dossier (« AEAnnotation_v10312011_1727_local.sqlite »…). */
async function newestDb(dir, prefix) {
  const names = await fsp.readdir(dir); // ENOENT / EPERM remontent à l'appelant
  let best = null;
  for (const n of names) {
    if (!n.startsWith(prefix) || !n.endsWith('.sqlite')) continue;
    const st = await fsp.stat(path.join(dir, n)).catch(() => null);
    if (st && st.isFile() && (!best || st.mtimeMs > best.mtime)) best = { file: path.join(dir, n), mtime: st.mtimeMs };
  }
  return best ? best.file : null;
}
/** Copie la base et ses fichiers -wal / -shm (même nom de base) dans `tmp`. */
async function snapshotDb(file, tmp) {
  const dst = path.join(tmp, path.basename(file));
  await fsp.copyFile(file, dst);
  for (const ext of ['-wal', '-shm']) await fsp.copyFile(file + ext, dst + ext).catch(() => {});
  return dst;
}
function sqlJson(db, sql) {
  const { execFile } = require('child_process');
  const run = (args) =>
    new Promise((resolve, reject) =>
      execFile(sqliteBin(), args, { timeout: 60000, maxBuffer: 128 * 1024 * 1024 }, (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message).trim())) : resolve(String(out)))),
    );
  // -readonly d'abord ; sur la COPIE seulement, nouvel essai sans (WAL sans -shm, vieux sqlite3).
  return run(['-readonly', '-json', db, sql])
    .catch(() => run(['-json', db, sql]))
    .then((out) => (out.trim() ? JSON.parse(out) : []));
}
async function tableColumns(db, table) {
  const rows = await sqlJson(db, `PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => String(r.name).toUpperCase()));
}
/** SELECT des colonnes voulues ; une colonne absente vaut NULL (et c'est noté au diagnostic). */
function selectCols(cols, wanted, table) {
  const missing = wanted.filter((c) => !cols.has(c));
  if (missing.length) diag('livres', 'colonnes absentes', table, missing);
  return wanted.map((c) => (cols.has(c) ? c : `NULL AS ${c}`)).join(', ');
}
const appleDate = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.round((v + APPLE_EPOCH_S) * 1000) : null);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

dataHandle('marginalia:appleBooksAnnotations', async () => {
  if (!APPLE_BOOKS) return { status: 'absent', message: 'L’app Livres n’existe que sur Mac.', books: [] };
  let aeFile = null;
  let bkFile = null;
  try {
    aeFile = await newestDb(AE_DIR(), 'AEAnnotation');
    bkFile = await newestDb(BK_DIR(), 'BKLibrary').catch((e) => {
      if (isDenied(e)) throw e;
      return null;
    });
  } catch (e) {
    if (isDenied(e)) return { status: 'denied', message: BOOKS_DENIED, books: [] };
    if (e && e.code === 'ENOENT') return { status: 'absent', message: 'Aucune donnée de Livres sur ce Mac.', books: [] };
    diag('livres', 'lecture du dossier', e && e.message);
    return { status: 'error', message: String((e && e.message) || e), books: [] };
  }
  if (!aeFile) return { status: 'absent', message: 'Aucune donnée d’annotation de Livres sur ce Mac.', books: [] };
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'marginalia-livres-'));
  try {
    let ae;
    let bk = null;
    try {
      ae = await snapshotDb(aeFile, tmp);
      if (bkFile) bk = await snapshotDb(bkFile, tmp).catch((e) => (isDenied(e) ? Promise.reject(e) : null));
    } catch (e) {
      if (isDenied(e)) return { status: 'denied', message: BOOKS_DENIED, books: [] };
      throw e;
    }
    // Annotations
    const aCols = await tableColumns(ae, 'ZAEANNOTATION');
    if (!aCols.has('ZANNOTATIONASSETID') || !aCols.has('ZANNOTATIONLOCATION')) {
      diag('livres', 'schéma inattendu (ZAEANNOTATION)', [...aCols]);
      return { status: 'error', message: 'Format des données de Livres non reconnu (version de Livres trop récente ?).', books: [] };
    }
    const A = ['ZANNOTATIONASSETID', 'ZANNOTATIONUUID', 'ZANNOTATIONSELECTEDTEXT', 'ZANNOTATIONREPRESENTATIVETEXT', 'ZANNOTATIONNOTE', 'ZANNOTATIONLOCATION', 'ZANNOTATIONSTYLE', 'ZANNOTATIONISUNDERLINE', 'ZANNOTATIONTYPE', 'ZANNOTATIONDELETED', 'ZANNOTATIONCREATIONDATE', 'ZANNOTATIONMODIFICATIONDATE'];
    const rows = await sqlJson(ae, `SELECT ${selectCols(aCols, A, 'ZAEANNOTATION')} FROM ZAEANNOTATION WHERE ZANNOTATIONASSETID IS NOT NULL`);
    const byAsset = new Map();
    const unknownTypes = new Set();
    for (const r of rows) {
      const text = str(r.ZANNOTATIONSELECTEDTEXT);
      const t = Number(r.ZANNOTATIONTYPE);
      let type = null;
      if (t === 2) type = 'highlight';
      else if (t === 1) type = text.trim() ? 'highlight' : 'bookmark';
      else if (t === 3) type = 'position';
      else if (text.trim()) type = 'highlight';
      else unknownTypes.add(r.ZANNOTATIONTYPE);
      const cfi = str(r.ZANNOTATIONLOCATION);
      if (!type || !cfi.startsWith('epubcfi(')) continue;
      const uuid = str(r.ZANNOTATIONUUID) || `${r.ZANNOTATIONASSETID}|${cfi}|${type}`;
      const style = Number.isInteger(r.ZANNOTATIONSTYLE) ? r.ZANNOTATIONSTYLE : null;
      const created = appleDate(r.ZANNOTATIONCREATIONDATE);
      const a = {
        uuid,
        type,
        text,
        note: str(r.ZANNOTATIONNOTE),
        cfi,
        style,
        underline: Number(r.ZANNOTATIONISUNDERLINE) === 1,
        created,
        modified: appleDate(r.ZANNOTATIONMODIFICATIONDATE) || created,
        deleted: Number(r.ZANNOTATIONDELETED) === 1,
      };
      const key = str(r.ZANNOTATIONASSETID);
      if (!byAsset.has(key)) byAsset.set(key, []);
      byAsset.get(key).push(a);
    }
    if (unknownTypes.size) diag('livres', 'types d’annotation ignorés', [...unknownTypes]);
    // Bibliothèque de Livres : titre, auteur, chemin, progression, protection.
    const assets = new Map();
    if (bk) {
      const bCols = await tableColumns(bk, 'ZBKLIBRARYASSET');
      if (bCols.has('ZASSETID')) {
        const B = ['ZASSETID', 'ZTITLE', 'ZAUTHOR', 'ZPATH', 'ZREADINGPROGRESS', 'ZLASTOPENDATE', 'ZISPROTECTED', 'ZDRMS'];
        for (const r of await sqlJson(bk, `SELECT ${selectCols(bCols, B, 'ZBKLIBRARYASSET')} FROM ZBKLIBRARYASSET`)) assets.set(str(r.ZASSETID), r);
      } else diag('livres', 'schéma inattendu (ZBKLIBRARYASSET)', [...bCols]);
    }
    const books = [];
    for (const id of new Set([...assets.keys(), ...byAsset.keys()])) {
      const r = assets.get(id) || {};
      const p = str(r.ZPATH);
      let prot = Number(r.ZISPROTECTED) === 1 || (r.ZDRMS != null && r.ZDRMS !== 0 && r.ZDRMS !== '');
      // Paquet EPUB présent sur le disque : la détection de DRM de l'import fait foi aussi.
      if (!prot && p && p.toLowerCase().endsWith('.epub')) {
        const st = await fsp.stat(p).catch(() => null);
        if (st && st.isDirectory()) prot = !!(await epubPackageInfo(p)).drm;
      }
      const prog = typeof r.ZREADINGPROGRESS === 'number' && r.ZREADINGPROGRESS >= 0 && r.ZREADINGPROGRESS <= 1 ? r.ZREADINGPROGRESS : null;
      books.push({
        assetId: id,
        title: str(r.ZTITLE),
        author: str(r.ZAUTHOR),
        path: p,
        fileName: p ? path.basename(p) : '',
        progress: prog,
        lastOpened: appleDate(r.ZLASTOPENDATE),
        protected: prot,
        annotations: byAsset.get(id) || [],
      });
    }
    return { status: 'ok', books };
  } catch (e) {
    diag('livres', 'lecture des annotations', e && e.message);
    if (isDenied(e)) return { status: 'denied', message: BOOKS_DENIED, books: [] };
    return { status: 'error', message: String((e && e.message) || e), books: [] };
  } finally {
    fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// ── Boîte de dépôt (dossier synchronisé avec le téléphone) ──
// Un dossier d'iCloud Drive (Mac), de OneDrive ou de Documents (ailleurs) où le téléphone dépose
// des fichiers. Le processus principal seul connaît le chemin : le rendu ne désigne un fichier que
// par son nom, vérifié ici (nom simple, fichier ordinaire de premier niveau). Un fichier traité est
// rangé dans « Traités », jamais supprimé.
const INBOX_DONE_DIR = 'Traités';
const INBOX_MAX_BYTES = 200 * 1024 * 1024;
const INBOX_IGNORED = new Set(['.ds_store', 'desktop.ini', 'thumbs.db']);
const inboxConfigPath = () => path.join(userData(), 'inbox.json');
const ICLOUD_DRIVE = () => path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs');
function oneDriveDir() {
  const d = process.env.OneDrive;
  if (!d || !path.isAbsolute(d)) return null;
  try {
    return fs.statSync(d).isDirectory() ? path.resolve(d) : null;
  } catch {
    return null;
  }
}
function inboxDefaultDir() {
  // Tests uniquement (MARGINALIA_E2E=1) : dossier par défaut imposé.
  if (E2E && process.env.MARGINALIA_INBOX_DIR) return path.resolve(process.env.MARGINALIA_INBOX_DIR);
  if (IS_MAC) return path.join(ICLOUD_DRIVE(), 'Marginalia');
  if (IS_WIN) {
    const od = oneDriveDir();
    if (od) return path.join(od, 'Marginalia');
  }
  return path.join(app.getPath('documents'), 'Marginalia');
}
const sameOrInside = (p, base) => path.relative(base, p) === '' || isInside(p, base);
function inboxCloud(dir) {
  if (sameOrInside(dir, ICLOUD_DRIVE())) return 'icloud';
  const od = oneDriveDir();
  if (od && sameOrInside(dir, od)) return 'onedrive';
  return null;
}
let inboxDirCache = null;
function inboxDir() {
  if (inboxDirCache) return inboxDirCache;
  let dir = null;
  try {
    const cfg = JSON.parse(fs.readFileSync(inboxConfigPath(), 'utf8'));
    if (cfg && typeof cfg.dir === 'string' && path.isAbsolute(cfg.dir)) dir = path.resolve(cfg.dir);
  } catch {
    /* pas encore de choix : dossier par défaut */
  }
  inboxDirCache = dir || inboxDefaultDir();
  return inboxDirCache;
}
async function setInboxDir(dir) {
  // null : retour au dossier par défaut (on n'enregistre pas de chemin, il suit la machine).
  await writeAtomic(inboxConfigPath(), JSON.stringify(dir ? { dir } : {}));
  inboxDirCache = null;
}
async function inboxInfo() {
  const dir = inboxDir();
  const defaultDir = inboxDefaultDir();
  const st = await fsp.stat(dir).catch(() => null);
  return { dir, defaultDir, isDefault: path.relative(defaultDir, dir) === '', exists: !!(st && st.isDirectory()), cloud: inboxCloud(dir) };
}

let inboxWatcher = null;
let inboxTimer = null;
// Dossier synchronisé activé (réglage « Boîte de dépôt ») : sinon seuls les envois par le Wi-Fi sont lus.
let inboxCloudOn = false;
// Réception par le Wi-Fi : dossier local, dans les données de l'app (jamais synchronisé). Un fichier
// traité y est effacé (son contenu est dans la bibliothèque ou la base), pas rangé dans « Traités ».
const wifiDir = () => path.join(userData(), 'wifi-recus');
function inboxBroadcast() {
  clearTimeout(inboxTimer);
  inboxTimer = setTimeout(() => {
    inboxTimer = null;
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('marginalia:inboxChanged');
  }, 1500);
}
function stopInboxWatch() {
  clearTimeout(inboxTimer);
  inboxTimer = null;
  if (inboxWatcher) {
    try {
      inboxWatcher.close();
    } catch {
      /* déjà fermé */
    }
  }
  inboxWatcher = null;
}
async function startInboxWatch() {
  const dir = inboxDir();
  try {
    await fsp.mkdir(path.join(dir, INBOX_DONE_DIR), { recursive: true });
  } catch (e) {
    throw new Error(`Impossible de créer le dossier de la Boîte de dépôt (${(e && e.code) || (e && e.message) || e}).`);
  }
  if (inboxWatcher) return;
  try {
    const w = fs.watch(dir, { persistent: false }, inboxBroadcast);
    // Dossier supprimé ou démonté : on arrête sans faire tomber l'app (enable() la relancera).
    w.on('error', (e) => {
      diag('boîte de dépôt', 'surveillance', e && e.message);
      if (inboxWatcher === w) stopInboxWatch();
    });
    inboxWatcher = w;
  } catch (e) {
    throw new Error(`Impossible de surveiller le dossier de la Boîte de dépôt (${(e && e.code) || (e && e.message) || e}).`);
  }
}
/** Changement de dossier : la surveillance suit si elle était active. */
async function switchInboxDir(dir) {
  const watching = !!inboxWatcher;
  stopInboxWatch();
  await setInboxDir(dir);
  if (watching) await startInboxWatch();
  return inboxInfo();
}
function inboxSkipped(name) {
  return !name || name.startsWith('.') || name.startsWith('~$') || name === INBOX_DONE_DIR || INBOX_IGNORED.has(name.toLowerCase());
}
/** Fichier désigné par le rendu : nom simple, fichier ordinaire (pas un lien) de premier niveau, reçu
 * par le Wi-Fi (cherché d'abord) ou dans le dossier synchronisé. */
async function inboxFile(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\\\0]/.test(name) || path.basename(name) !== name) {
    throw new Error('Nom de fichier invalide.');
  }
  for (const [dir, wifi] of [[wifiDir(), true], [inboxDir(), false]]) {
    if (!wifi && !inboxCloudOn) continue;
    const full = path.join(dir, name);
    if (!isInside(full, dir) || path.dirname(full) !== path.resolve(dir)) throw new Error('Nom de fichier invalide.');
    const st = await fsp.lstat(full).catch(() => null);
    if (!st) continue;
    if (!st.isFile()) throw new Error(`« ${name} » n'est pas un fichier.`);
    return { full, st, wifi };
  }
  throw new Error(`« ${name} » n'est plus dans la Boîte de dépôt.`);
}
const fsReason = (e) => (e && e.code === 'EACCES') || (e && e.code === 'EPERM') ? 'accès refusé' : (e && e.code) || (e && e.message) || String(e);

dataHandle('marginalia:inboxInfo', () => inboxInfo());
dataHandle('marginalia:inboxEnable', async () => {
  await startInboxWatch();
  inboxCloudOn = true;
  return inboxInfo();
});
dataHandle('marginalia:inboxDisable', async () => {
  inboxCloudOn = false;
  stopInboxWatch();
});
dataHandle('marginalia:inboxChoose', async () => {
  const current = inboxDir();
  const r = await dialog.showOpenDialog(parentWindow(), {
    title: 'Choisir le dossier de la Boîte de dépôt',
    defaultPath: fs.existsSync(current) ? current : path.dirname(current),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const dir = path.resolve(r.filePaths[0]);
  if (dir === path.resolve(userData()) || isInside(dir, userData()) || isInside(userData(), dir)) {
    throw new Error('Choisissez un dossier en dehors des données de Marginalia.');
  }
  return switchInboxDir(dir);
});
dataHandle('marginalia:inboxReset', () => switchInboxDir(null));
// Téléchargements iCloud demandés (une fois par fichier et par minute au plus).
const inboxAsked = new Map();
function inboxDownload(full) {
  const t = inboxAsked.get(full) || 0;
  if (Date.now() - t < 60000) return;
  inboxAsked.set(full, Date.now());
  require('child_process').execFile('/usr/bin/brctl', ['download', full], { timeout: 120000 }, (err) => {
    if (err) diag('boite', 'téléchargement iCloud', path.basename(full), String(err.message || err));
  });
}
// Un fichier qui arrive d'iCloud ne change pas toujours le dossier (pas d'avis de fs.watch) :
// tant que quelque chose est en attente, on prévient l'interface toutes les 4 s pour qu'elle relise.
let inboxRecheck = null;
function inboxRecheckSoon() {
  if (inboxRecheck || !inboxWatcher) return;
  inboxRecheck = setTimeout(() => {
    inboxRecheck = null;
    if (!inboxWatcher) return;
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('marginalia:inboxChanged');
  }, 4000);
}
/** Fichiers complets reçus par le Wi-Fi (les envois en cours sont des « .part-… » cachés). */
async function wifiList() {
  let entries = [];
  try {
    entries = await fsp.readdir(wifiDir(), { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || inboxSkipped(e.name)) continue;
    const st = await fsp.stat(path.join(wifiDir(), e.name)).catch(() => null);
    if (st && st.isFile()) out.push({ name: e.name, size: st.size, mtime: st.mtimeMs, source: 'wifi' });
  }
  return out;
}
dataHandle('marginalia:inboxList', async () => {
  const wifi = await wifiList();
  if (!inboxCloudOn) return wifi.sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name, 'fr'));
  const dir = inboxDir();
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (!(e && e.code === 'ENOENT')) throw new Error(`Lecture de la Boîte de dépôt impossible (${fsReason(e)}).`);
  }
  const now = Date.now();
  const files = [...wifi];
  const pending = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    // Fichier resté dans iCloud (« .Nom.pdf.icloud ») : on demande son téléchargement ;
    // la surveillance du dossier préviendra l'interface quand il sera arrivé.
    const m = e.name.match(/^\.(.+)\.icloud$/);
    if (m && e.isFile()) {
      if (inboxSkipped(m[1]) || /[/\\]/.test(m[1])) continue;
      if (IS_MAC) inboxDownload(path.join(dir, m[1]));
      const st = await fsp.stat(full).catch(() => null);
      pending.push({ name: m[1], size: 0, mtime: st ? st.mtimeMs : now, pending: true });
      continue;
    }
    if (inboxSkipped(e.name) || !e.isFile()) continue;
    const st = await fsp.stat(full).catch(() => null);
    if (!st || !st.isFile()) continue;
    // Copie en cours (fichier vide tout juste créé) : on attend le prochain passage.
    if (st.size === 0 && now - st.mtimeMs < 3000) continue;
    // macOS récent : un fichier iCloud pas encore téléchargé garde son vrai nom mais n'occupe
    // aucun bloc sur le disque (fichier « sans données »). On demande son téléchargement et on
    // le signale en attente ; une nouvelle lecture du dossier est programmée.
    if (IS_MAC && st.size > 0 && st.blocks === 0) {
      inboxDownload(full);
      pending.push({ name: e.name, size: st.size, mtime: st.mtimeMs, pending: true });
      continue;
    }
    files.push({ name: e.name, size: st.size, mtime: st.mtimeMs });
  }
  if (pending.length) inboxRecheckSoon();
  const present = new Set(files.map((f) => f.name));
  return [...files, ...pending.filter((p) => !present.has(p.name))].sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name, 'fr'));
});
dataHandle('marginalia:inboxRead', async (_e, name) => {
  const { full, st } = await inboxFile(name);
  if (st.size > INBOX_MAX_BYTES) throw new Error(`« ${name} » est trop volumineux (plus de 200 Mo).`);
  let buf;
  try {
    buf = await fsp.readFile(full);
  } catch (e) {
    throw new Error(`Lecture de « ${name} » impossible (${fsReason(e)}).`);
  }
  return { name, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
});
dataHandle('marginalia:inboxDone', async (_e, name) => {
  const { full, wifi } = await inboxFile(name);
  if (wifi) {
    try {
      await fsp.rm(full, { force: true });
    } catch (e) {
      throw new Error(`Impossible de retirer « ${name} » (${fsReason(e)}).`);
    }
    return;
  }
  const doneDir = path.join(inboxDir(), INBOX_DONE_DIR);
  try {
    await fsp.mkdir(doneDir, { recursive: true });
    // Nom déjà pris dans « Traités » : « nom (2).ext », « nom (3).ext »…
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    let target = path.join(doneDir, name);
    for (let n = 2; await fsp.lstat(target).then(() => true, () => false); n++) target = path.join(doneDir, `${base} (${n})${ext}`);
    try {
      await fsp.rename(full, target);
    } catch (e) {
      if (!e || e.code !== 'EXDEV') throw e;
      await fsp.copyFile(full, target, fs.constants.COPYFILE_EXCL);
      await fsp.unlink(full);
    }
  } catch (e) {
    throw new Error(`Impossible de ranger « ${name} » dans « ${INBOX_DONE_DIR} » (${fsReason(e)}).`);
  }
});
dataHandle('marginalia:inboxReveal', async () => {
  const dir = inboxDir();
  try {
    await fsp.mkdir(path.join(dir, INBOX_DONE_DIR), { recursive: true });
  } catch (e) {
    throw new Error(`Impossible de créer le dossier de la Boîte de dépôt (${fsReason(e)}).`);
  }
  const err = await shell.openPath(dir);
  if (err) throw new Error(`Impossible d'ouvrir le dossier : ${err}`);
});

// ── Mises à jour : la dernière Release publiée sur GitHub ──
// Une seule requête (lecture publique, sans cookie ni identifiant, sans aucune donnée de
// l'utilisateur), faite à la demande du rendu : au lancement si le réglage « Vérifier les mises
// à jour » est actif, ou par le bouton des réglages. Rien n'est téléchargé ni installé : l'app
// propose seulement d'ouvrir la page de téléchargement du site.
// Requête faite par Node (processus principal) : le blocage réseau de la session ne la voit pas ;
// c'est la seule connexion sortante de l'app.
const UPDATE_URL = (E2E && process.env.MARGINALIA_UPDATE_URL) || 'https://api.github.com/repos/FavveyAxel/marginalia/releases/latest';
const DOWNLOAD_PAGE = 'https://marginalia-bice.vercel.app/#telecharger';
const appVersion = () => (E2E && process.env.MARGINALIA_APP_VERSION) || app.getVersion();
/** Compare deux versions « 3.22 », « v3.22.1 » : < 0, 0, > 0. */
function compareVersions(a, b) {
  const p = (v) => String(v || '').replace(/^v/i, '').split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : NaN));
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const m = Number.isNaN(x[i] ?? 0) ? 0 : x[i] ?? 0;
    const n = Number.isNaN(y[i] ?? 0) ? 0 : y[i] ?? 0;
    if (m !== n) return m - n;
  }
  return 0;
}
function fetchJson(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? require('node:https') : require('node:http');
    const req = mod.get(url, { headers: { 'User-Agent': 'Marginalia', Accept: 'application/vnd.github+json' }, timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      let n = 0;
      res.on('data', (c) => {
        n += c.length;
        if (n > 1024 * 1024) req.destroy(new Error('réponse trop longue'));
        else chunks.push(c);
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
  });
}
handle('marginalia:appVersion', () => appVersion());
handle('marginalia:checkUpdate', async () => {
  const current = appVersion();
  // Tests de bout en bout : jamais de réseau, sauf vers le faux serveur fourni.
  if (E2E && !process.env.MARGINALIA_UPDATE_URL) return { current, latest: null, newer: false };
  try {
    const r = await fetchJson(UPDATE_URL);
    const latest = String((r && r.tag_name) || '').replace(/^v/i, '');
    if (!latest || r.draft || r.prerelease) return { current, latest: null, newer: false };
    const notes = typeof r.body === 'string' ? r.body.slice(0, 20000) : '';
    const newer = compareVersions(latest, current) > 0;
    diag('maj', 'vérification', { current, latest, newer });
    return { current, latest, newer, notes, publishedAt: r.published_at || null, downloadUrl: DOWNLOAD_PAGE };
  } catch (e) {
    diag('maj', 'vérification impossible', e && e.message);
    return { current, latest: null, newer: false, error: 'Impossible de joindre GitHub (pas de connexion ?).' };
  }
});

// ── Réception par le Wi-Fi (voir electron/wifi.cjs) ──
const wifiReceiver = wifiKit.createReceiver({
  dir: wifiDir,
  // Nom déjà présent dans le dossier synchronisé : la boîte les mélange, on évite les doublons de nom.
  taken: (name) => inboxCloudOn && fs.existsSync(path.join(inboxDir(), name)),
  isLocked: () => isLocked(),
  pagePath: path.join(__dirname, 'wifi-page.html'),
  diag: (...a) => diag(...a),
  emit: (evt) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      w.webContents.send('marginalia:wifi', evt);
      if (evt.type === 'received') w.webContents.send('marginalia:inboxChanged');
    }
  },
});
dataHandle('marginalia:wifiStart', async () => {
  try {
    return await wifiReceiver.start();
  } catch (e) {
    diag('wifi', 'ouverture', e && e.message);
    throw new Error(`Impossible d'ouvrir la réception par le Wi-Fi (${(e && e.code) || (e && e.message) || e}).`);
  }
});
dataHandle('marginalia:wifiInfo', () => wifiReceiver.info());
handle('marginalia:wifiStop', () => wifiReceiver.stop('closed'));

// Windows : familles vues par GDI+ (polices de la machine et de l'utilisateur), repli sur les clés
// de registre « Fonts » (HKLM et HKCU) dont on retire le type et les noms de style. Sans module natif.
const WIN_FONT_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$names = @()
try {
  Add-Type -AssemblyName System.Drawing
  $names = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
} catch {}
if (-not $names -or $names.Count -eq 0) {
  foreach ($k in 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', 'HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts') {
    $p = Get-ItemProperty -Path $k
    if ($p) { $names += $p.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { 'reg:' + $_.Name } }
  }
}
ConvertTo-Json -Compress -InputObject @($names)
`;
const FONT_STYLE_WORDS = /\s+(Regular|Bold|Italic|Oblique|Light|Thin|Medium|Semibold|SemiBold|Semilight|SemiLight|Demibold|ExtraBold|Extra Bold|ExtraLight|Extra Light|UltraLight|Condensed|Cond|Narrow|BdIt|Bd|It)\b.*$/i;
async function windowsFontFamilies(run) {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(WIN_FONT_SCRIPT, 'utf16le').toString('base64');
  let raw = [];
  try {
    raw = JSON.parse((await run(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], 30000)).replace(/^\uFEFF/, '').trim() || '[]');
  } catch {
    raw = [];
  }
  const set = new Set();
  for (const n of Array.isArray(raw) ? raw : []) {
    if (typeof n !== 'string') continue;
    if (!n.startsWith('reg:')) {
      set.add(n.trim());
      continue;
    }
    // « Cambria & Cambria Math (TrueType) », « Segoe UI Bold Italic (TrueType) »
    for (const part of n.slice(4).replace(/\s*\((TrueType|OpenType|Type 1|VGA res)\)\s*$/i, '').split(' & ')) {
      const fam = part.replace(FONT_STYLE_WORDS, '').trim();
      if (fam) set.add(fam);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

handle('marginalia:listFonts', async () => {
  if (fontCache) return fontCache;
  const { execFile } = require('child_process');
  const run = (cmd, args, timeout) =>
    new Promise((resolve) => execFile(cmd, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (err, out) => resolve(err ? '' : String(out))));
  let families = [];
  if (IS_MAC) {
    const jxa = "ObjC.import('AppKit'); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))";
    try { families = JSON.parse((await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', jxa], 15000)) || '[]'); } catch { families = []; }
    if (!families.length) {
      try {
        const data = JSON.parse((await run('/usr/sbin/system_profiler', ['SPFontsDataType', '-json'], 60000)) || '{}');
        const set = new Set();
        for (const f of data.SPFontsDataType || []) for (const t of f.typefaces || []) if (t.family) set.add(t.family);
        families = [...set];
      } catch { families = []; }
    }
  } else if (IS_WIN) {
    families = await windowsFontFamilies(run);
  } else {
    const out = await run('fc-list', [':', 'family'], 15000);
    families = [...new Set(out.split('\n').map((l) => l.split(',')[0].trim()).filter(Boolean))];
  }
  families = [...new Set(families.filter((f) => typeof f === 'string' && f && !f.startsWith('.')))];
  if (families.length) fontCache = families;
  return families;
});

dataHandle('marginalia:saveBinary', async (_e, defaultName, data, format) => {
  const filter = SAVE_FILTERS[format] || SAVE_FILTERS.txt;
  const r = await dialog.showSaveDialog(parentWindow(), {
    defaultPath: path.join(app.getPath('documents'), safeDefaultName(defaultName)),
    filters: [filter],
  });
  if (r.canceled || !r.filePath) return null;
  await writeAtomic(r.filePath, toBuffer(data));
  return r.filePath;
});

// ── HTML → PDF (A4) ──────────────────────────────────────────
// Le document n'exécute aucun script (CSP script-src 'none', injectée ici) ; JavaScript reste activé
// dans la fenêtre pour que le processus principal puisse attendre le chargement des polices
// (document.fonts.ready) avant d'imprimer : sans cela, une police embarquée (Literata en data:)
// pourrait ne pas être encore décodée et le PDF partirait avec la police de repli.
const PRINT_CSP = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'">`;
function withPrintCsp(html) {
  const s = String(html);
  const m = /<head\b[^>]*>/i.exec(s);
  return m ? s.slice(0, m.index + m[0].length) + PRINT_CSP + s.slice(m.index + m[0].length) : PRINT_CSP + s;
}

dataHandle('marginalia:printToPdf', async (_e, html) => {
  const tmpFile = path.join(os.tmpdir(), `marginalia-print-${crypto.randomBytes(8).toString('hex')}.html`);
  await fsp.writeFile(tmpFile, withPrintCsp(html), 'utf8');
  const partition = `print-${crypto.randomBytes(6).toString('hex')}`; // session éphémère (en mémoire)
  const ses = session.fromPartition(partition);
  const fileUrl = pathToFileURL(tmpFile).toString();
  // Aucun réseau : seuls le document lui-même et les data:/blob: sont autorisés.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    cb({ cancel: !(u === fileUrl || u.startsWith('data:') || u.startsWith('blob:')) });
  });
  const win = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: {
      offscreen: true,
      javascript: true, // scripts du document bloqués par la CSP ; sert à attendre les polices
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      session: ses,
    },
  });
  try {
    win.webContents.on('will-navigate', (ev) => ev.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await win.loadURL(fileUrl);
    // Polices (data:) chargées et décodées avant l'impression ; plafond de 5 s par sécurité.
    await Promise.race([
      win.webContents.executeJavaScript('document.fonts.ready.then(() => document.fonts.status)', true).catch(() => null),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    await new Promise((r) => setTimeout(r, 150)); // laisse les images data: se décoder
    // preferCSSPageSize : le format du document (@page size) l'emporte ; A4 sinon.
    // Pages de l'éditeur (export « tel qu'à l'écran ») : chaque page porte déjà ses marges → aucune marge ajoutée.
    const fullBleed = /class="mgl-print-pages"/.test(html);
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, ...(fullBleed ? { margins: { top: 0, bottom: 0, left: 0, right: 0 } } : {}) });
    return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fsp.rm(tmpFile, { force: true }).catch(() => {});
    ses.clearStorageData().catch(() => {});
  }
});

// ── Fichiers ouverts depuis le Finder ou l'Explorateur ───────
let mainWindow = null;
let rendererReady = false;
const pendingOpen = [];

const isAccepted = (f) => ACCEPTED.includes(path.extname(f).slice(1).toLowerCase());

async function deliverOpenFiles() {
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady || !pendingOpen.length) return;
  const paths = pendingOpen.splice(0, pendingOpen.length);
  const files = [];
  for (const p of paths) {
    try {
      files.push(await readPicked(p));
    } catch (e) {
      console.warn('Lecture impossible :', p, e.message);
    }
  }
  if (files.length) mainWindow.webContents.send('marginalia:open-files', files);
}

function queueOpen(paths) {
  const ok = paths.filter((p) => typeof p === 'string' && isAccepted(p) && fs.existsSync(p));
  if (!ok.length) return;
  pendingOpen.push(...ok);
  if (app.isReady() && !mainWindow) createWindow();
  deliverOpenFiles();
}

ipcMain.on('marginalia:open-files-ready', (event) => {
  if (!trusted(event)) return;
  rendererReady = true;
  deliverOpenFiles();
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueOpen([filePath]);
});

// Windows / Linux : double-clic sur un fichier alors que l'app tourne → nouvelle instance refusée
// (instance unique) ; ses arguments arrivent ici. queueOpen ne garde que les fichiers acceptés
// existants (les options ajoutées par Chromium sont ignorées).
app.on('second-instance', (_e, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  queueOpen(argv.slice(1).filter((a) => !a.startsWith('-')));
});

// ── Fenêtre ──────────────────────────────────────────────────
function isExternal(url) {
  return /^(https?|mailto):/i.test(url);
}

// Diagnostic du redimensionnement : chaque changement de taille ou d'état de la fenêtre est consigné
// (journal local, jamais envoyé), avec la cause probable côté interface (voir src/lib/diagnostics.ts).
function watchWindow(win) {
  const state = (ev, extra) => {
    if (win.isDestroyed()) return;
    let wa = null;
    try { wa = screen.getDisplayMatching(win.getBounds()).workArea; } catch { /* écran inconnu */ }
    diag('fenetre', ev, { bounds: win.getBounds(), normal: win.getNormalBounds(), max: win.isMaximized(), full: win.isFullScreen(), simpleFull: win.isSimpleFullScreen?.(), zoom: win.webContents.getZoomFactor(), workArea: wa, ...extra });
  };
  let lastResize = 0;
  win.on('resize', () => {
    const now = Date.now();
    if (now - lastResize > 250) state('resize');
    lastResize = now;
  });
  win.on('will-resize', (_e, nb, det) => state('will-resize', { newBounds: nb, edge: det && det.edge }));
  for (const ev of ['resized', 'moved', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore', 'minimize', 'show', 'hide', 'swipe', 'rotate-gesture'])
    win.on(ev, () => state(ev));
  win.webContents.on('zoom-changed', (_e, dir) => state('zoom-changed', { dir }));
  win.webContents.on('unresponsive', () => state('renderer-ne-repond-plus'));
  win.webContents.on('responsive', () => state('renderer-repond'));
  win.webContents.on('render-process-gone', (_e, d) => state('renderer-perdu', d));
  win.once('ready-to-show', () => state('demarrage', { version: app.getVersion(), os: process.getSystemVersion?.() }));
}

/** Barre de titre : pastilles intégrées sur Mac ; boutons de fenêtre superposés (couleurs du thème) ailleurs. */
function titleBarOptions() {
  if (IS_MAC) return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } };
  return { titleBarStyle: 'hidden', titleBarOverlay: overlayFor(nativeTheme.shouldUseDarkColors), autoHideMenuBar: true };
}

function createWindow() {
  rendererReady = false;
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    title: 'Marginalia',
    ...titleBarOptions(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121110' : '#efebe3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Correcteur natif de Chromium : macOS uniquement (API du système). Ailleurs, il téléchargerait
      // des dictionnaires Hunspell sur Internet ; l'éditeur a son propre correcteur hors ligne.
      spellcheck: IS_MAC,
      // Lu par le preload : fonctions propres à macOS (app Livres).
      additionalArguments: APPLE_BOOKS ? ['--mg-apple-books=1'] : [],
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
    },
  });
  mainWindow = win;
  const wcId = win.webContents.id;
  watchWindow(win);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    rendererReady = false;
    noticesReady = false;
    flushReady.delete(wcId);
  });
  // Un rechargement ou une nouvelle page repasse par onOpenFiles : on réarme.
  win.webContents.on('did-start-navigation', (_e, _url, inPlace, isMainFrame) => {
    if (isMainFrame) rendererReady = false;
    if (isMainFrame && !inPlace) {
      noticesReady = false;
      flushReady.delete(wcId);
    }
  });

  // Fermeture : le rendu écrit d'abord ses modifications en attente, puis on attend la file d'écriture.
  let closeReady = false;
  win.on('close', (event) => {
    if (closeReady || quitReady) return; // quitter : déjà vidé dans before-quit
    event.preventDefault();
    if (win.__mgClosing) return;
    win.__mgClosing = true;
    flushRenderer(win)
      .then(() => waitSaves())
      .catch((e) => diag('base', 'fermeture', e && e.message))
      .finally(() => {
        closeReady = true;
        if (!win.isDestroyed()) win.close();
      });
  });

  // Plantage du rendu : la base est sur le disque ; on propose de recharger la fenêtre.
  win.webContents.on('render-process-gone', async (_e, details) => {
    flushReady.delete(wcId);
    noticesReady = false;
    if (win.isDestroyed() || appQuitting || details.reason === 'clean-exit') return;
    if (win.__mgReloadAfterKill) {
      win.__mgReloadAfterKill = false;
      diag('fenetre', 'rechargement apres blocage');
      win.webContents.reload();
      return;
    }
    diag('fenetre', 'plantage du rendu', details);
    const r = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Marginalia',
      message: 'La fenêtre de Marginalia s’est arrêtée de manière inattendue.',
      detail:
        'Vos données enregistrées sont intactes sur le disque. Rechargez la fenêtre pour reprendre ' +
        '(seules les modifications des toutes dernières secondes ont pu être perdues).',
      buttons: ['Recharger', 'Fermer la fenêtre'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (win.isDestroyed()) return;
    diag('fenetre', 'plantage : choix', r.response === 0 ? 'recharger' : 'fermer');
    if (r.response === 0) {
      win.webContents.reload();
      notify('La fenêtre a été rechargée après un incident. Vos données sont intactes.', 'info');
    } else {
      closeReady = true;
      win.destroy();
    }
  });
  // Interface figée : attendre ou recharger (la boîte se ferme seule si l'interface repart).
  let hang = null;
  win.webContents.on('unresponsive', async () => {
    if (hang || appQuitting || win.isDestroyed()) return;
    hang = new AbortController();
    const r = await dialog
      .showMessageBox(win, {
        type: 'warning',
        title: 'Marginalia',
        message: 'Marginalia ne répond plus.',
        detail: 'Vous pouvez attendre ou recharger la fenêtre. Vos données enregistrées sont sur le disque.',
        buttons: ['Attendre', 'Recharger la fenêtre'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        signal: hang.signal,
      })
      .catch(() => ({ response: 0 }));
    hang = null;
    if (r.response !== 1 || win.isDestroyed()) return;
    diag('fenetre', 'blocage : rechargement demande');
    win.__mgReloadAfterKill = true;
    win.webContents.forcefullyCrashRenderer();
  });
  win.webContents.on('responsive', () => {
    if (hang) hang.abort();
  });

  // Navigation bloquée ; les liens externes s'ouvrent dans le navigateur.
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    if (isExternal(url)) shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  // Tests de bout en bout (MARGINALIA_E2E=1) : le rendu expose son store (window.__store).
  else win.loadURL(`${APP_ORIGIN}/index.html${process.env.MARGINALIA_E2E === '1' ? '?e2e=1' : ''}`);
  return win;
}

// ── Protocole app:// (sert dist/) ────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.gz': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ftl': 'text/plain; charset=utf-8',
};

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'marginalia') return new Response('Introuvable', { status: 404 });
      let rel = decodeURIComponent(url.pathname);
      if (rel.includes('\0')) return new Response('Interdit', { status: 403 });
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.normalize(path.join(DIST_DIR, rel));
      if (!isInside(file, DIST_DIR)) return new Response('Interdit', { status: 403 });
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat || !stat.isFile()) return new Response('Introuvable', { status: 404 });
      const res = await net.fetch(pathToFileURL(file).toString(), { bypassCustomProtocolHandlers: true });
      const headers = new Headers(res.headers);
      const type = MIME[path.extname(file).toLowerCase()];
      if (type) headers.set('Content-Type', type);
      return new Response(res.body, { status: res.status, headers });
    } catch (e) {
      console.error('app://', request.url, e);
      return new Response('Erreur', { status: 500 });
    }
  });
}

// ── Sauvegarde complète (.zip) et restauration ───────────────
// Contenu : manifest.json, db.json (instantané pris dans la file d'écriture) et library/**.
// macOS : outils système `zip` et `ditto` (ZIP64, gros volumes) ; ailleurs : écriture et lecture
// intégrées (electron/backup.cjs). MARGINALIA_SYSTEM_ZIP=1 force les outils système (tests Linux).
const SYSTEM_ZIP = IS_MAC || process.env.MARGINALIA_SYSTEM_ZIP === '1';
let backupBusy = false;
function execTool(cmd, args, cwd) {
  return new Promise((resolve, reject) =>
    require('node:child_process').execFile(cmd, args, { cwd, timeout: 30 * 60000, maxBuffer: 16 * 1024 * 1024 }, (err, _out, errOut) =>
      err ? reject(new Error(String(errOut || err.message).trim())) : resolve(),
    ),
  );
}
const zipBin = () => (IS_MAC ? '/usr/bin/zip' : 'zip');

async function exportFullBackup() {
  if (backupBusy) return;
  if (isLocked()) throw new Error('Déverrouillez Marginalia avant d’exporter une sauvegarde.');
  // Chiffrement activé : archive chiffrée (par défaut) ou en clair, au choix, avec avertissement.
  let encrypted = false;
  if (sec.ks) {
    if (sec.ks.migration || (sec.migration && sec.migration.running)) {
      throw new Error('Le chiffrement (ou le déchiffrement) de vos données est en cours : réessayez quand il sera terminé.');
    }
    const c = await dialog.showMessageBox(parentWindow(), {
      type: 'question',
      title: 'Exporter une sauvegarde complète',
      message: 'Exporter la sauvegarde chiffrée ou en clair ?',
      detail:
        'Chiffrée (recommandé) : l’archive ne peut être restaurée qu’avec votre clé de secours' +
        (sec.ks.password ? ' ou votre mot de passe actuel' : '') +
        '. Sans eux, elle est définitivement illisible.\n\n' +
        'En clair : toute personne qui accède à l’archive peut lire vos livres, extraits, notes et écrits.',
      buttons: ['Chiffrée (recommandé)', 'En clair…', 'Annuler'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (c.response === 2) return;
    if (c.response === 1) {
      const w = await dialog.showMessageBox(parentWindow(), {
        type: 'warning',
        title: 'Exporter une sauvegarde en clair',
        message: 'Exporter vos données sans chiffrement ?',
        detail: 'L’archive contiendra vos livres, extraits, notes et écrits lisibles par n’importe qui. Rangez-la en lieu sûr (disque chiffré, coffre).',
        buttons: ['Exporter en clair', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (w.response !== 0) return;
    } else encrypted = true;
  }
  const r = await dialog.showSaveDialog(parentWindow(), {
    title: 'Exporter une sauvegarde complète',
    defaultPath: path.join(app.getPath('documents'), `Marginalia-sauvegarde-${localDay()}${encrypted ? '-chiffree' : ''}.zip`),
    filters: [{ name: 'Archive ZIP', extensions: ['zip'] }],
  });
  if (r.canceled || !r.filePath) return;
  let dest = path.resolve(r.filePath);
  if (path.extname(dest).toLowerCase() !== '.zip') dest += '.zip';
  if (dest === userData() || isInside(dest, userData())) throw new Error('Choisissez un dossier en dehors des données de Marginalia.');
  backupBusy = true;
  const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'marginalia-export-'));
  const tmpZip = `${dest}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await flushAll();
    // Instantané cohérent de la base : lu dans la file d'écriture (aucune écriture en même temps).
    let dbText = null;
    const snap = saveChain.catch(() => {}).then(async () => {
      const cur = await readDbFile(dbPath());
      dbText = cur.ok ? cur.text : null;
    });
    saveChain = snap;
    await snap;
    if (!dbText) throw new Error('La base actuelle est introuvable ou illisible : rien à exporter.');
    const files = (await zipkit.listFiles(libraryRoot(), 'library')).filter((f) => !f.rel.endsWith('.tmp'));
    const info = { app: 'Marginalia', format: 1, version: app.getVersion(), createdAt: new Date().toISOString(), files: files.length, encrypted };
    // Archive chiffrée : la clé de données y est rangée sous ses enveloppes « clé de secours » et
    // « mot de passe » (jamais celle du trousseau, propre à cet ordinateur).
    if (encrypted) Object.assign(info, { keyId: sec.ks.keyId, keys: { recovery: sec.ks.recovery, password: sec.ks.password || null } });
    const manifest = JSON.stringify(info, null, 2);
    if (sec.ks) {
      // Chiffrement activé : archive écrite ici (fichiers lus un à un, déchiffrés en mémoire pour
      // une archive en clair ; aucun fichier en clair sur le disque).
      const dek = sec.dek;
      await zipkit.writeZip(tmpZip, [
        { name: 'manifest.json', data: Buffer.from(manifest, 'utf8') },
        { name: 'db.json', data: encrypted ? vault.seal(dek, Buffer.from(dbText, 'utf8')) : Buffer.from(dbText, 'utf8') },
        ...files.map((f) => ({
          name: f.rel,
          read: async () => {
            const buf = await fsp.readFile(f.full);
            if (encrypted) return vault.isSealed(buf) ? buf : vault.seal(dek, buf);
            return vault.isSealed(buf) ? vault.open(dek, buf) : buf;
          },
        })),
      ]);
    } else if (SYSTEM_ZIP) {
      await fsp.writeFile(path.join(staging, 'manifest.json'), manifest);
      await fsp.writeFile(path.join(staging, 'db.json'), dbText);
      await execTool(zipBin(), ['-q', '-X', tmpZip, 'manifest.json', 'db.json'], staging);
      if (files.length) await execTool(zipBin(), ['-r', '-q', '-X', '-y', tmpZip, 'library', '-x', '*.tmp'], userData());
    } else {
      await zipkit.writeZip(tmpZip, [
        { name: 'manifest.json', data: Buffer.from(manifest, 'utf8') },
        { name: 'db.json', data: Buffer.from(dbText, 'utf8') },
        ...files.map((f) => ({ name: f.rel, file: f.full })),
      ]);
    }
    await fsp.rename(tmpZip, dest);
    diag('sauvegarde', 'export complet', { fichiers: files.length, taille: (await fsp.stat(dest)).size, chiffree: encrypted });
    notify(
      `Sauvegarde complète${encrypted ? ' chiffrée' : ''} enregistrée : « ${path.basename(dest)} » (${files.length} fichier${files.length > 1 ? 's' : ''}).`,
      'success',
    );
    shell.showItemInFolder(dest);
  } finally {
    backupBusy = false;
    fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    fsp.rm(tmpZip, { force: true }).catch(() => {});
  }
}

/**
 * Clé de données d'une archive chiffrée : celle de cette installation si c'est la même, sinon
 * demandée à l'utilisateur (clé de secours, ou mot de passe en vigueur lors de l'export).
 */
async function archiveKeyFor(manifest) {
  if (sec.dek && sec.ks && manifest.keyId === sec.ks.keyId) return sec.dek;
  const keys = manifest.keys || {};
  for (let attempt = 0; attempt < 5; attempt++) {
    const v = await askRenderer({
      kind: 'archive-secret',
      title: 'Sauvegarde chiffrée',
      message:
        (attempt ? 'Clé de secours ou mot de passe incorrect. ' : '') +
        'Cette sauvegarde est chiffrée. Saisissez sa clé de secours' +
        (keys.password ? ', ou le mot de passe de Marginalia au moment où elle a été créée.' : '.'),
    });
    if (v == null || v === '') throw new Error('Restauration annulée : la sauvegarde chiffrée n’a pas pu être ouverte.');
    let dek = vault.looksLikeRecoveryKey(v) ? vault.unwrapWithRecovery(v, keys.recovery) : null;
    if (!dek && keys.password) dek = await vault.unwrapWithPassword(v, keys.password);
    if (dek && vault.keyId(dek) === manifest.keyId) return dek;
  }
  throw new Error('Clé de secours ou mot de passe incorrect : restauration abandonnée.');
}
/** Contenu en clair d'un fichier d'archive (chiffré avec `key`, ou déjà en clair). */
function openArchived(buf, key) {
  if (!vault.isSealed(buf)) return buf;
  if (!key) throw new Error('Cette archive contient des fichiers chiffrés avec une clé inconnue.');
  return vault.open(key, buf);
}

/** Dossier d'une archive extraite qui contient db.json (racine, ou unique sous-dossier). */
async function findBackupRoot(dir) {
  if (fs.existsSync(path.join(dir, 'db.json'))) return dir;
  const subs = (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name !== '__MACOSX');
  if (subs.length === 1 && fs.existsSync(path.join(dir, subs[0].name, 'db.json'))) return path.join(dir, subs[0].name);
  return null;
}

async function restoreFullBackup() {
  if (backupBusy) return;
  const win = parentWindow();
  const pick = await dialog.showOpenDialog(win, {
    title: 'Restaurer une sauvegarde',
    properties: ['openFile'],
    filters: [{ name: 'Sauvegarde Marginalia', extensions: ['zip', 'json'] }],
  });
  if (pick.canceled || !pick.filePaths[0]) return;
  if (isLocked()) throw new Error('Déverrouillez Marginalia avant de restaurer une sauvegarde.');
  if (sec.ks && (sec.ks.migration || (sec.migration && sec.migration.running))) {
    throw new Error('Le chiffrement (ou le déchiffrement) de vos données est en cours : réessayez quand il sera terminé.');
  }
  const src = pick.filePaths[0];
  const isJson = path.extname(src).toLowerCase() === '.json';
  const ok = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Restaurer une sauvegarde',
    message: `Remplacer vos données actuelles par la sauvegarde « ${path.basename(src)} » ?`,
    detail:
      (isJson
        ? 'Livres, écrits, extraits, cartes et réglages seront remplacés par ceux de la sauvegarde (les fichiers des livres restent en place). '
        : 'Toute la bibliothèque (livres, écrits, extraits, cartes, réglages et fichiers) sera remplacée par celle de la sauvegarde. ') +
      'L’état actuel est d’abord mis de côté dans le dossier « backups » de Marginalia.',
    buttons: ['Restaurer', 'Annuler'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (ok.response !== 0) return;
  backupBusy = true;
  const staging = path.join(userData(), `restauration-${crypto.randomBytes(6).toString('hex')}`);
  const aside = path.join(backupsDir(), `avant-restauration-${stamp()}`);
  const moved = []; // [de, vers] pour revenir en arrière en cas d'échec
  let archiveKey = null;
  try {
    // 1. Lire et vérifier la sauvegarde AVANT de toucher aux données actuelles.
    let dbText;
    let newLibrary = null;
    if (isJson) {
      const r = await readDbFile(src);
      if (!r.ok && r.error && r.error.code === 'MG_BADKEY') throw new Error('Ce fichier est chiffré avec une autre clé que celle de cette installation.');
      if (!r.ok) throw new Error('Ce fichier n’est pas une base Marginalia valide.');
      dbText = r.text;
    } else {
      await fsp.mkdir(staging, { recursive: true });
      if (SYSTEM_ZIP) {
        // Outils système : les noms et les liens sont d'abord vérifiés sur la table de l'archive
        // (sauf ZIP64, que seul l'outil système lit ; l'arbre extrait est de toute façon revérifié).
        const entries = await zipkit.readZipEntries(src).catch((e) => (/ZIP64/.test(e.message) ? [] : Promise.reject(e)));
        for (const en of entries) {
          if (!zipkit.safeEntryName(en.name) || en.isLink) throw new Error(`Archive refusée : chemin interdit (${en.name})`);
        }
      }
      if (IS_MAC) await execTool('/usr/bin/ditto', ['-x', '-k', src, staging], staging);
      else if (SYSTEM_ZIP) await execTool('unzip', ['-q', src, '-d', staging, '-x', '__MACOSX/*'], staging);
      else await zipkit.extractZip(src, staging, (name) => !name.startsWith('__MACOSX/'));
      await zipkit.assertPlainTree(staging);
      const root = await findBackupRoot(staging);
      if (!root) throw new Error('Cette archive ne contient pas de sauvegarde Marginalia valide (db.json absent ou illisible).');
      let manifest = null;
      try {
        manifest = JSON.parse(await fsp.readFile(path.join(root, 'manifest.json'), 'utf8'));
      } catch {
        manifest = null; // anciennes archives, ou archive faite à la main
      }
      // Archive chiffrée : sa clé (la même que celle-ci, ou demandée) ; sinon la clé actuelle pour
      // d'éventuels fichiers chiffrés.
      archiveKey = manifest && manifest.encrypted ? await archiveKeyFor(manifest) : sec.dek;
      try {
        const text = openArchived(await fsp.readFile(path.join(root, 'db.json')), archiveKey).toString('utf8');
        if (!isDbObject(JSON.parse(text))) throw new Error('contenu inattendu');
        dbText = text;
      } catch (e) {
        throw new Error('Cette archive ne contient pas de sauvegarde Marginalia valide (db.json absent ou illisible).');
      }
      newLibrary = path.join(root, 'library');
      if (!fs.existsSync(newLibrary)) await fsp.mkdir(newLibrary, { recursive: true });
      // Fichiers remis au format de cette installation (chiffrés avec sa clé, ou en clair).
      for (const f of await zipkit.listFiles(newLibrary)) {
        const buf = await fsp.readFile(f.full);
        const plain = openArchived(buf, archiveKey);
        const out = encodeOut(plain);
        if (out !== buf) await writeAtomic(f.full, out);
      }
    }
    // 2. Le rendu écrit ce qui attend, puis plus aucune écriture de l'ancienne page n'est acceptée.
    await flushAll();
    savesBlocked = true;
    await waitSaves();
    // 3. État actuel mis de côté (renommages : instantané, sans copie).
    await fsp.mkdir(aside, { recursive: true });
    const move = async (from, to) => {
      if (!fs.existsSync(from)) return;
      await fsp.rename(from, to);
      moved.push([from, to]);
    };
    await move(dbPath(), path.join(aside, 'db.json'));
    await move(dbPath() + '.bak', path.join(aside, 'db.json.bak'));
    if (newLibrary) await move(libraryRoot(), path.join(aside, 'library'));
    // 4. Mise en place de la sauvegarde.
    if (newLibrary) await move(newLibrary, libraryRoot());
    await writeData(dbPath(), dbText);
    await rotateBackups('avant-restauration-', 2);
    diag('sauvegarde', 'restauration', path.basename(src));
    noticesReady = false; // l'avis est pour la page rechargée, pas pour l'ancienne
    notify(`Sauvegarde « ${path.basename(src)} » restaurée. L’état précédent est conservé dans le dossier « backups ».`, 'success');
  } catch (e) {
    // Retour à l'état d'avant, dans l'ordre inverse.
    for (const [from, to] of moved.reverse()) await fsp.rename(to, from).catch((err) => diag('sauvegarde', 'retour arriere', err && err.message));
    if (moved.length) await fsp.rm(aside, { recursive: true, force: true }).catch(() => {});
    savesBlocked = false;
    throw e;
  } finally {
    backupBusy = false;
    if (archiveKey && archiveKey !== sec.dek) vault.wipe(archiveKey);
    fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  // 5. L'interface repart de la base restaurée.
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.reload();
}

function backupAction(label, fn) {
  return {
    label,
    click: () =>
      Promise.resolve()
        .then(() => {
          if (isLocked()) throw new Error('Déverrouillez Marginalia d’abord.');
          return fn();
        })
        .catch((e) => {
          diag('sauvegarde', label, e && e.message);
          dialog.showErrorBox(label.replace(/…$/, ''), String((e && e.message) || e));
        }),
  };
}
const exportBackupItem = backupAction('Exporter une sauvegarde complète…', exportFullBackup);
const restoreBackupItem = backupAction('Restaurer une sauvegarde…', restoreFullBackup);

// ── Menus (français) ─────────────────────────────────────────
// Pas d'accélérateurs ⌘O / ⌘K / ⌘F / ⌘S actifs : ils appartiennent à l'application (rendu).
// Les raccourcis affichés dans les menus Windows sont donc décoratifs (registerAccelerator: false).
function sendMenuCommand(cmd) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send('marginalia:menu', cmd);
}

const exportDiagnosticItem = {
  label: 'Exporter le journal de diagnostic',
  click: async () => {
    try {
      const src = path.join(app.getPath('userData'), 'diagnostic.log');
      const dst = path.join(app.getPath('downloads'), 'Marginalia-diagnostic.log');
      if (diagStream) await new Promise((r) => diagStream.write('', r));
      // Lignes chiffrées (chiffrement activé) : remises en clair pour l'export, qui est un geste explicite.
      const text = await fsp.readFile(src, 'utf8');
      if (text.includes('ENC1:')) {
        const out = text.split('\n').map((l) => {
          if (!vault.isSealedLine(l)) return l;
          if (!sec.dek) return '[ligne chiffrée : déverrouillez Marginalia pour l’exporter]';
          try {
            return vault.openLine(sec.dek, l);
          } catch {
            return '[ligne chiffrée illisible]';
          }
        });
        await fsp.writeFile(dst, out.join('\n'));
      } else await fsp.copyFile(src, dst);
      shell.showItemInFolder(dst);
    } catch (e) {
      dialog.showErrorBox('Journal de diagnostic', 'Aucun journal à exporter pour l’instant.');
    }
  },
};

// Commandes de l'éditeur venues du menu (canal distinct de 'marginalia:menu') : le rendu les reçoit
// par host.onEditorCommand (src/features/editor/painterMenu.ts → pinceau de mise en forme).
function sendEditorCommand(cmd, win) {
  const w = win && !win.isDestroyed() ? win : BrowserWindow.getFocusedWindow() || mainWindow;
  if (w && !w.isDestroyed()) w.webContents.send('marginalia:editor-command', cmd);
}

/**
 * Raccourcis du pinceau de mise en forme (« Reproduire la mise en forme ») et de « Coller sans le style ».
 *   Mac : ⌥⌘C / ⌥⌘V ; « Coller sans le style » garde ⌥⇧⌘V (celui de macOS, sans conflit).
 *   Windows / Linux : Ctrl+Maj+C / Ctrl+Maj+V (⌘⌥ → Ctrl+Maj, voir src/lib/keys.ts). Le rôle
 *   pasteAndMatchStyle afficherait sinon Ctrl+Maj+V lui aussi (accélérateur par défaut d'Electron) :
 *   « Coller sans le style » passe à Ctrl+Maj+Alt+V. Dans un champ de saisie hors du document,
 *   Ctrl+Maj+V reste le « coller en texte brut » de Chromium (la page le traite, le menu n'est pas appelé).
 * Ordre de traitement d'une touche dans Electron : la page d'abord (le pinceau l'intercepte en phase de
 * capture et appelle preventDefault quand le curseur est dans le texte), puis l'accélérateur du menu
 * seulement si la page ne l'a pas consommée. Les éléments ci-dessous sont donc le relais quand la touche
 * n'a pas été prise par la page (focus sur la barre d'outils, ou si macOS donne la main au menu d'abord) :
 * jamais les deux à la fois.
 */
const PAINTER_ACCELERATORS = {
  darwin: { copy: 'Alt+Command+C', paste: 'Alt+Command+V', plain: 'Alt+Shift+Command+V' },
  other: { copy: 'Ctrl+Shift+C', paste: 'Ctrl+Shift+V', plain: 'Ctrl+Shift+Alt+V' },
};

function editMenuTemplate(platform = process.platform) {
  const k = platform === 'darwin' ? PAINTER_ACCELERATORS.darwin : PAINTER_ACCELERATORS.other;
  return {
    label: 'Édition',
    submenu: [
      { role: 'undo', label: 'Annuler' },
      { role: 'redo', label: 'Rétablir' },
      { type: 'separator' },
      { role: 'cut', label: 'Couper' },
      { role: 'copy', label: 'Copier' },
      { role: 'paste', label: 'Coller' },
      { role: 'pasteAndMatchStyle', label: 'Coller sans le style', accelerator: k.plain, ...(platform !== 'darwin' && { registerAccelerator: true }) },
      { role: 'delete', label: 'Supprimer' },
      { role: 'selectAll', label: 'Tout sélectionner' },
      { type: 'separator' },
      { id: 'copy-format', label: 'Copier la mise en forme', accelerator: k.copy, click: (_i, win) => sendEditorCommand('copy-format', win) },
      { id: 'paste-format', label: 'Coller la mise en forme', accelerator: k.paste, click: (_i, win) => sendEditorCommand('paste-format', win) },
    ],
  };
}

const devItems = () => (DEV_URL ? [{ type: 'separator' }, { role: 'reload', label: 'Recharger' }, { role: 'toggleDevTools', label: 'Outils de développement' }] : []);

function macMenuTemplate() {
  return [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'À propos de Marginalia' },
        { type: 'separator' },
        { role: 'services', label: 'Services' },
        { type: 'separator' },
        { role: 'hide', label: 'Masquer Marginalia' },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { role: 'unhide', label: 'Tout afficher' },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter Marginalia' },
      ],
    },
    { label: 'Fichier', submenu: [exportBackupItem, restoreBackupItem, { type: 'separator' }, lockMenuItem(), { type: 'separator' }, { role: 'close', label: 'Fermer la fenêtre' }] },
    editMenuTemplate(),
    {
      label: 'Présentation',
      submenu: [
        { role: 'resetZoom', label: 'Taille réelle' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        ...devItems(),
      ],
    },
    {
      label: 'Fenêtre',
      submenu: [
        { role: 'minimize', label: 'Placer dans le Dock' },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Tout ramener au premier plan' },
      ],
    },
    { role: 'help', label: 'Aide', submenu: [exportDiagnosticItem] },
  ];
}

/** Windows (et Linux) : pas de menu « app » ; la barre de menus est masquée (Alt l'affiche, voir le rendu). */
function otherMenuTemplate() {
  return [
    {
      label: '&Fichier',
      submenu: [
        { label: 'Importer…', accelerator: 'Ctrl+O', registerAccelerator: false, click: () => sendMenuCommand('import') },
        { type: 'separator' },
        exportBackupItem,
        restoreBackupItem,
        { type: 'separator' },
        lockMenuItem(),
        { type: 'separator' },
        { role: 'quit', label: 'Quitter', accelerator: 'Alt+F4' },
      ],
    },
    editMenuTemplate(),
    {
      label: '&Affichage',
      submenu: [
        { role: 'resetZoom', label: 'Taille réelle' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        ...devItems(),
      ],
    },
    {
      label: 'Ai&de',
      submenu: [
        { label: 'Aide de Marginalia', accelerator: 'F1', registerAccelerator: false, click: () => sendMenuCommand('help') },
        { type: 'separator' },
        exportDiagnosticItem,
        { type: 'separator' },
        {
          label: 'À propos de Marginalia',
          click: () =>
            dialog.showMessageBox(parentWindow(), {
              type: 'info',
              title: 'À propos de Marginalia',
              message: `Marginalia ${app.getVersion()}`,
              detail: 'Lire et étudier des textes philosophiques.\nTout reste sur cet ordinateur.\n© Axel Bierne',
              buttons: ['OK'],
            }),
        },
      ],
    },
  ];
}

// Tests (MARGINALIA_E2E=1) : le gabarit du menu Édition, pour vérifier la branche macOS depuis Linux.
if (E2E) globalThis.__marginaliaEditMenuTemplate = editMenuTemplate;

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(IS_MAC ? macMenuTemplate() : otherMenuTemplate()));
}

// Windows : la barre de menus est cachée avec la barre de titre ; Alt seul (ou F10) l'ouvre sous
// forme de menu contextuel en haut à gauche de la fenêtre.
handle('marginalia:popupMenu', async (e) => {
  if (IS_MAC) return;
  const win = BrowserWindow.fromWebContents(e.sender);
  const menu = Menu.getApplicationMenu();
  if (win && menu) menu.popup({ window: win, x: 8, y: TITLEBAR_H - 8 });
});

// ── Cycle de vie ─────────────────────────────────────────────
app.whenReady().then(async () => {
  // Chiffrement (option) : clé débloquée par le trousseau, ou écran de verrouillage dans la fenêtre.
  await initSecurity().catch((e) => diag('securite', 'initialisation', e));
  app.setAboutPanelOptions({ applicationName: 'Marginalia', copyright: '© Axel Bierne' });
  registerAppProtocol();
  // Confidentialité : l'app fonctionne entièrement hors ligne. Toute requête réseau sortante
  // (http, https, ws, wss, ftp) est bloquée ; seuls le protocole app://, file:, data: et blob: passent.
  // En développement, le serveur Vite local reste autorisé.
  const devUrl = process.env.VITE_DEV_SERVER_URL || '';
  let blockedLogged = 0;
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const local = /^(app|file|data|blob|devtools|chrome-extension):/i.test(u) || (devUrl && (u.startsWith(devUrl.replace(/\/$/, '')) || /^wss?:\/\/localhost/.test(u)));
    if (!local && blockedLogged++ < 50) {
      let host = '';
      try {
        host = new URL(u).host;
      } catch {
        host = u.slice(0, 60);
      }
      diag('reseau-bloque', details.resourceType || '', host); // hôte seulement : jamais l'adresse complète
    }
    cb({ cancel: !local });
  });
  // Seule la lecture des polices installées (pour l'éditeur) est accordée ; caméra, micro, géolocalisation… jamais.
  if (!IS_MAC) {
    // Aucun téléchargement de dictionnaire (Hunspell) hors macOS.
    session.defaultSession.setSpellCheckerEnabled(false);
    session.defaultSession.setSpellCheckerDictionaryDownloadURL('file:///nonexistent/');
  }
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'local-fonts' || perm === 'localFonts'));
  buildMenu();
  cleanStaleTemp().catch((e) => diag('nettoyage', e && e.message));
  startAutoLock();
  // Fichiers passés en argument au lancement (Windows, Linux : double-clic dans l'Explorateur ;
  // macOS passe par `open-file`).
  const argvFiles = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-'));
  createWindow();
  queueOpen(argvFiles);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit(); // Windows / Linux : fermer la dernière fenêtre quitte l'app
});

// Toute fenêtre ou vue créée (fenêtre principale, impression PDF) : pas de <webview>, pas de
// nouvelle fenêtre, pas de navigation hors de la page chargée par le processus principal.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (mainWindow && !mainWindow.isDestroyed() && contents === mainWindow.webContents) return; // géré dans createWindow
    if (url !== contents.getURL()) event.preventDefault();
  });
});

// Quitter : chaque fenêtre écrit d'abord ses modifications en attente, puis on attend la dernière
// écriture de la base (au plus quelques secondes : une fenêtre figée ne bloque pas la fermeture).
let appQuitting = false;
let quitReady = false;
app.on('before-quit', (event) => {
  wifiReceiver.stop('quit');
  if (quitReady) return;
  event.preventDefault();
  if (appQuitting) return;
  appQuitting = true;
  flushAll()
    .catch((e) => diag('base', 'fermeture', e && e.message))
    .finally(() => {
      diag('app', 'fermeture');
      quitReady = true;
      app.quit();
    });
});

/** Fichiers temporaires laissés par une session interrompue (marginalia-* du dossier temporaire, *.tmp, restaurations). */
async function cleanStaleTemp() {
  const old = Date.now() - 60 * 60 * 1000; // une heure : jamais ceux d'une opération en cours
  let n = 0;
  const sweep = async (dir, match) => {
    for (const name of await fsp.readdir(dir).catch(() => [])) {
      if (!match(name)) continue;
      const f = path.join(dir, name);
      const st = await fsp.lstat(f).catch(() => null);
      if (!st || st.isSymbolicLink() || st.mtimeMs > old) continue;
      await fsp.rm(f, { recursive: true, force: true }).then(() => n++, () => {});
    }
  };
  await sweep(os.tmpdir(), (name) => name.startsWith('marginalia-'));
  await sweep(userData(), (name) => (name.startsWith('db.json.') && name.endsWith('.tmp')) || name.startsWith('restauration-'));
  await sweep(backupsDir(), (name) => name.endsWith('.tmp'));
  // Copies de travail d'une écriture ou d'une conversion (chiffrement) interrompue, dans la bibliothèque.
  for (const f of await zipkit.listFiles(libraryRoot()).catch(() => [])) {
    if (!f.rel.endsWith('.tmp')) continue;
    const st = await fsp.lstat(f.full).catch(() => null);
    if (st && st.isFile() && st.mtimeMs <= old) await fsp.rm(f.full, { force: true }).then(() => n++, () => {});
  }
  if (n) diag('nettoyage', `${n} fichier(s) temporaire(s) supprimé(s)`);
}
