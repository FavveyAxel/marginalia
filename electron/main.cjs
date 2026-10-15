// Marginalia — processus principal Electron.
//
// Données (dossier userData : ~/Library/Application Support/Marginalia sur Mac,
// %APPDATA%\Marginalia sous Windows) :
//   db.json (+ db.json.bak)        base complète, écriture atomique (tmp + fsync + rename), une à la fois
//   library/<id>/<fileName>        fichiers sources des livres et des écrits
//   backups/                       sauvegardes de la base : une par jour (7 jours), avant migration de
//                                  format, avant restauration ou vidage complet ; bases illisibles mises de côté
//   diagnostic.log (+ .1)          journal local (4 Mo au plus par fichier)
//
// Fichiers ouverts depuis le Finder / le Dock (événement macOS `open-file`), ou depuis l'Explorateur
// de Windows (arguments de lancement, puis événement `second-instance` si l'app tourne déjà) : TOUS les formats acceptés, y compris les .docx, sont transmis au rendu via
// `onOpenFiles` et donc IMPORTÉS COMME LIVRES (bibliothèque). Un .docx ouvert ainsi n'est pas
// ouvert dans l'éditeur ; pour modifier un .docx en place, utiliser « Ouvrir un .docx » dans Écrire.
'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, net, protocol, screen, session, shell, systemPreferences } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const zipkit = require('./backup.cjs');

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
function diag(...parts) {
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
    let line = `${new Date().toISOString()} ${parts.map(diagPart).join(' ')}`;
    if (line.length > DIAG_LINE_MAX) line = line.slice(0, DIAG_LINE_MAX) + ' …[tronqué]';
    diagStream.write(line + '\n');
    diagSize += Buffer.byteLength(line) + 1;
  } catch {
    /* jamais bloquant */
  }
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
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (e) {
    return { ok: false, missing: !!e && e.code === 'ENOENT', error: e };
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
  await writeAtomic(file, text);
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
    await writeAtomic(file, text);
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
    await writeAtomic(dbPath(), r.text);
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

handle('marginalia:loadDb', async () => {
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
  await writeAtomic(target, json);
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

handle('marginalia:saveDb', (_e, payload, meta) => {
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

// ── Bibliothèque de fichiers ─────────────────────────────────
handle('marginalia:storeFile', async (_e, id, fileName, data) => {
  await writeAtomic(libraryPath(id, fileName), toBuffer(data));
});
handle('marginalia:readFile', async (_e, id, fileName) => {
  const buf = await fsp.readFile(libraryPath(id, fileName));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
});
handle('marginalia:deleteFile', async (_e, id, fileName) => {
  const file = libraryPath(id, fileName);
  await fsp.rm(file, { force: true });
  if (/^source\./.test(String(fileName))) {
    for (const d of DERIVED_FILES) await fsp.rm(libraryPath(id, d), { force: true }).catch(() => {});
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
handle('marginalia:convertImage', async (_e, data, ext) => {
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

handle('marginalia:pickFiles', async () => {
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

handle('marginalia:saveText', async (_e, defaultName, content) => {
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

handle('marginalia:openDocx', async () => {
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
handle('marginalia:writeExternal', async (_e, target, data) => {
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
handle('marginalia:appleBooksScan', async () => {
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
handle('marginalia:appleBooksWatch', async () => {
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
handle('marginalia:appleBooksRead', async (_e, p) => {
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

handle('marginalia:appleBooksAnnotations', async () => {
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

handle('marginalia:saveBinary', async (_e, defaultName, data, format) => {
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
handle('marginalia:printToPdf', async (_e, html) => {
  const tmpFile = path.join(os.tmpdir(), `marginalia-print-${crypto.randomBytes(8).toString('hex')}.html`);
  await fsp.writeFile(tmpFile, String(html), 'utf8');
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
      javascript: false,
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
    await new Promise((r) => setTimeout(r, 150)); // laisse les images data: se décoder
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
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
  const r = await dialog.showSaveDialog(parentWindow(), {
    title: 'Exporter une sauvegarde complète',
    defaultPath: path.join(app.getPath('documents'), `Marginalia-sauvegarde-${localDay()}.zip`),
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
    const manifest = JSON.stringify({ app: 'Marginalia', format: 1, version: app.getVersion(), createdAt: new Date().toISOString(), files: files.length }, null, 2);
    if (SYSTEM_ZIP) {
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
    diag('sauvegarde', 'export complet', { fichiers: files.length, taille: (await fsp.stat(dest)).size });
    notify(`Sauvegarde complète enregistrée : « ${path.basename(dest)} » (${files.length} fichier${files.length > 1 ? 's' : ''}).`, 'success');
    shell.showItemInFolder(dest);
  } finally {
    backupBusy = false;
    fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    fsp.rm(tmpZip, { force: true }).catch(() => {});
  }
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
  try {
    // 1. Lire et vérifier la sauvegarde AVANT de toucher aux données actuelles.
    let dbText;
    let newLibrary = null;
    if (isJson) {
      const r = await readDbFile(src);
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
      const r = root && (await readDbFile(path.join(root, 'db.json')));
      if (!r || !r.ok) throw new Error('Cette archive ne contient pas de sauvegarde Marginalia valide (db.json absent ou illisible).');
      dbText = r.text;
      newLibrary = path.join(root, 'library');
      if (!fs.existsSync(newLibrary)) await fsp.mkdir(newLibrary, { recursive: true });
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
    await writeAtomic(dbPath(), dbText);
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
    fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  // 5. L'interface repart de la base restaurée.
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.reload();
}

function backupAction(label, fn) {
  return {
    label,
    click: () =>
      fn().catch((e) => {
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
      await fsp.copyFile(src, dst);
      shell.showItemInFolder(dst);
    } catch (e) {
      dialog.showErrorBox('Journal de diagnostic', 'Aucun journal à exporter pour l’instant.');
    }
  },
};

const editMenu = {
  label: 'Édition',
  submenu: [
    { role: 'undo', label: 'Annuler' },
    { role: 'redo', label: 'Rétablir' },
    { type: 'separator' },
    { role: 'cut', label: 'Couper' },
    { role: 'copy', label: 'Copier' },
    { role: 'paste', label: 'Coller' },
    { role: 'pasteAndMatchStyle', label: 'Coller sans le style' },
    { role: 'delete', label: 'Supprimer' },
    { role: 'selectAll', label: 'Tout sélectionner' },
  ],
};

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
    { label: 'Fichier', submenu: [exportBackupItem, restoreBackupItem, { type: 'separator' }, { role: 'close', label: 'Fermer la fenêtre' }] },
    editMenu,
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
        { role: 'quit', label: 'Quitter', accelerator: 'Alt+F4' },
      ],
    },
    editMenu,
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
app.whenReady().then(() => {
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
  if (n) diag('nettoyage', `${n} fichier(s) temporaire(s) supprimé(s)`);
}
