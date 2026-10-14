// Marginalia — processus principal Electron.
//
// Données (dossier userData, ex. ~/Library/Application Support/Marginalia) :
//   db.json (+ db.json.bak)        base complète, écriture atomique (tmp + rename)
//   library/<id>/<fileName>        fichiers sources des livres et des écrits
//
// Fichiers ouverts depuis le Finder / le Dock (événement macOS `open-file`, ou arguments de
// lancement) : TOUS les formats acceptés, y compris les .docx, sont transmis au rendu via
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

const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const APP_ORIGIN = 'app://marginalia';
const DIST_DIR = path.join(__dirname, '..', 'dist');
const IMAGES = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff'];
const ACCEPTED = ['epub', 'pdf', 'docx', 'md', 'markdown', 'txt', 'html', 'htm', ...IMAGES];
// Fichiers dérivés d'un document image (texte reconnu, copie affichable) : supprimés avec la source.
const DERIVED_FILES = ['ocr.json', 'display.jpg'];

app.setName('Marginalia');

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

function segmentOk(s) {
  return typeof s === 'string' && s.length > 0 && s !== '.' && s !== '..' && !/[\\\0]/.test(s) && !path.isAbsolute(s);
}

/** library/<id>/<fileName> ; fileName peut contenir des sous-dossiers, jamais de remontée. */
function libraryPath(id, fileName) {
  if (!segmentOk(id) || id.includes('/')) throw new Error('Identifiant invalide');
  const parts = String(fileName).split('/');
  if (!parts.length || !parts.every(segmentOk)) throw new Error('Nom de fichier invalide');
  const full = path.join(libraryRoot(), id, ...parts);
  const root = path.join(libraryRoot(), id) + path.sep;
  if (!full.startsWith(root)) throw new Error('Chemin invalide');
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
let diagStream = null;
function diag(...parts) {
  try {
    if (!diagStream) {
      const f = path.join(app.getPath('userData'), 'diagnostic.log');
      try {
        if (fs.statSync(f).size > 4 * 1024 * 1024) fs.renameSync(f, f + '.1'); // rotation simple
      } catch {
        /* pas encore de journal */
      }
      diagStream = fs.createWriteStream(f, { flags: 'a' });
    }
    diagStream.write(`${new Date().toISOString()} ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`);
  } catch {
    /* jamais bloquant */
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error('Appelant non autorisé');
    return fn(event, ...args);
  });
}

// ── Base de données ──────────────────────────────────────────
handle('marginalia:loadDb', async () => {
  for (const file of [dbPath(), dbPath() + '.bak']) {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (e) {
      if (e && e.code !== 'ENOENT') console.warn('db illisible :', file, e.message);
    }
  }
  return null;
});

let saveChain = Promise.resolve();
handle('marginalia:saveDb', (_e, db) => {
  // Sérialise les écritures pour que tmp + rename ne se chevauchent jamais.
  saveChain = saveChain.then(async () => {
    const json = JSON.stringify(db);
    const target = dbPath();
    try {
      await fsp.copyFile(target, target + '.bak');
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('sauvegarde .bak :', e.message);
    }
    await writeAtomic(target, json);
  });
  return saveChain;
});

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
  while (dir.startsWith(stop)) {
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
// Conversion en JPEG par l'outil système macOS `sips` (aucun module natif). Fichiers temporaires
// dans le dossier temporaire de l'utilisateur, supprimés aussitôt.
handle('marginalia:convertImage', async (_e, data, ext) => {
  if (process.platform !== 'darwin') throw new Error('Conversion disponible sur macOS uniquement');
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
    defaultPath: path.join(app.getPath('documents'), path.basename(String(defaultName))),
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
  return { path: file, name: picked.name, data: picked.data };
});

/** Réécrit un .docx déjà présent sur le disque (jamais de création) après copie .bak. */
handle('marginalia:writeExternal', async (_e, target, data) => {
  if (typeof target !== 'string' || !path.isAbsolute(target) || path.extname(target).toLowerCase() !== '.docx') {
    throw new Error('Seuls les fichiers .docx existants peuvent être réécrits');
  }
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
};

// Polices installées : liste native de macOS (NSFontManager via JavaScript for Automation),
// repli sur system_profiler. Aucun accès réseau ; résultat mis en cache pour la session.
let fontCache = null;
// ── Fenêtre : déplacement par la barre du haut, sans zone « app-region » CSS ──
// Sur macOS, les zones de glissement CSS sont recalculées à chaque changement de mise en page
// (sélection de texte, barres flottantes) et peuvent provoquer des saccades ou un « zoom »
// involontaire de la fenêtre. On déplace donc la fenêtre nous-mêmes.
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
  let action = 'Maximize';
  if (process.platform === 'darwin') {
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
// Thème natif (menus, fond de fenêtre) aligné sur le choix de l'utilisateur.
handle('marginalia:setTheme', async (e, mode) => {
  nativeTheme.themeSource = mode === 'dark' ? 'dark' : mode === 'system' ? 'system' : 'light';
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#121110' : '#efebe3');
});

handle('marginalia:diag', async (_e, ...parts) => diag('renderer', ...parts));

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
        if (m && process.platform === 'darwin') {
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
  if (booksWatchers) return true;
  booksWatchers = [];
  const notify = () => {
    clearTimeout(booksTimer);
    booksTimer = setTimeout(() => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('marginalia:appleBooksChanged');
    }, 2500);
  };
  for (const base of BOOKS_DIRS()) {
    try {
      booksWatchers.push(fs.watch(base, { persistent: false }, notify));
    } catch {
      /* dossier absent ou non autorisé */
    }
  }
  return booksWatchers.length > 0;
});
handle('marginalia:appleBooksRead', async (_e, p) => {
  const allowed = BOOKS_DIRS().some((d) => path.resolve(p).startsWith(d + path.sep));
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

handle('marginalia:listFonts', async () => {
  if (fontCache) return fontCache;
  const { execFile } = require('child_process');
  const run = (cmd, args, timeout) =>
    new Promise((resolve) => execFile(cmd, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (err, out) => resolve(err ? '' : String(out))));
  let families = [];
  if (process.platform === 'darwin') {
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
    defaultPath: path.join(app.getPath('documents'), path.basename(String(defaultName))),
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

// ── Fichiers ouverts depuis le Finder ────────────────────────
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

app.on('second-instance', (_e, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  queueOpen(argv.slice(1));
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

function createWindow() {
  rendererReady = false;
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    title: 'Marginalia',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121110' : '#efebe3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  mainWindow = win;
  watchWindow(win);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    rendererReady = false;
  });
  // Un rechargement ou une nouvelle page repasse par onOpenFiles : on réarme.
  win.webContents.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) rendererReady = false;
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
  else win.loadURL(`${APP_ORIGIN}/index.html`);
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
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.normalize(path.join(DIST_DIR, rel));
      if (file !== DIST_DIR && !file.startsWith(DIST_DIR + path.sep)) return new Response('Interdit', { status: 403 });
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

// ── Menus (français) ─────────────────────────────────────────
// Pas d'accélérateurs ⌘O / ⌘K / ⌘F / ⌘S : ils appartiennent à l'application (rendu).
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [];
  if (isMac) {
    template.push({
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
    });
  }
  template.push(
    {
      label: 'Fichier',
      submenu: [{ role: 'close', label: 'Fermer la fenêtre' }, ...(isMac ? [] : [{ role: 'quit', label: 'Quitter' }])],
    },
    {
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
    },
    {
      label: 'Présentation',
      submenu: [
        { role: 'resetZoom', label: 'Taille réelle' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        ...(DEV_URL ? [{ type: 'separator' }, { role: 'reload', label: 'Recharger' }, { role: 'toggleDevTools', label: 'Outils de développement' }] : []),
      ],
    },
    {
      label: 'Fenêtre',
      submenu: [
        { role: 'minimize', label: 'Placer dans le Dock' },
        { role: 'zoom', label: 'Zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: 'Tout ramener au premier plan' }] : []),
      ],
    },
    {
      role: 'help',
      label: 'Aide',
      submenu: [
        {
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
        },
      ],
    },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Cycle de vie ─────────────────────────────────────────────
app.whenReady().then(() => {
  app.setAboutPanelOptions({ applicationName: 'Marginalia', copyright: '© Axel Bierne' });
  registerAppProtocol();
  // Confidentialité : l'app fonctionne entièrement hors ligne. Toute requête réseau sortante
  // (http, https, ws, wss, ftp) est bloquée ; seuls le protocole app://, file:, data: et blob: passent.
  // En développement, le serveur Vite local reste autorisé.
  const devUrl = process.env.VITE_DEV_SERVER_URL || '';
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const local = /^(app|file|data|blob|devtools|chrome-extension):/i.test(u) || (devUrl && (u.startsWith(devUrl.replace(/\/$/, '')) || /^wss?:\/\/localhost/.test(u)));
    cb({ cancel: !local });
  });
  // Seule la lecture des polices installées (pour l'éditeur) est accordée ; caméra, micro, géolocalisation… jamais.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'local-fonts' || perm === 'localFonts'));
  buildMenu();
  // Fichiers passés en argument au lancement (hors macOS `open-file`).
  const argvFiles = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-'));
  createWindow();
  queueOpen(argvFiles);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
