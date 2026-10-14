// Pont sécurisé (contextIsolation + sandbox) : expose `window.marginalia`, qui implémente
// exactement HostApi de src/lib/platform.ts. Aucune API Node n'est exposée au rendu.
const { contextBridge, ipcRenderer } = require('electron');

/** Les données binaires reviennent du processus principal en Uint8Array : on rend un ArrayBuffer exact. */
function toArrayBuffer(view) {
  if (view instanceof ArrayBuffer) return view;
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}
const toFile = (f) => ({ name: f.name, data: toArrayBuffer(f.data) });

// Fonctions propres à macOS (app Livres, conversion d'images par `sips`) : le processus principal
// passe `--mg-apple-books=1` quand elles sont disponibles (macOS, ou drapeau de test explicite).
const argFlag = (name) => process.argv.some((a) => a === `--${name}=1`);
const appleBooks = argFlag('mg-apple-books');
const nativeImageConvert = process.platform === 'darwin';

const api = {
  kind: 'electron',
  platform: process.platform,

  loadDb: () => ipcRenderer.invoke('marginalia:loadDb'),
  saveDb: (db) => ipcRenderer.invoke('marginalia:saveDb', db),

  pickFiles: async () => (await ipcRenderer.invoke('marginalia:pickFiles')).map(toFile),

  storeFile: (bookId, fileName, data) => ipcRenderer.invoke('marginalia:storeFile', bookId, fileName, data),
  readFile: async (bookId, fileName) => toArrayBuffer(await ipcRenderer.invoke('marginalia:readFile', bookId, fileName)),
  deleteFile: (bookId, fileName) => ipcRenderer.invoke('marginalia:deleteFile', bookId, fileName),

  saveText: (defaultName, content) => ipcRenderer.invoke('marginalia:saveText', defaultName, content),

  openDocx: async () => {
    const r = await ipcRenderer.invoke('marginalia:openDocx');
    return r ? { path: r.path, name: r.name, data: toArrayBuffer(r.data) } : null;
  },
  writeExternal: (path, data) => ipcRenderer.invoke('marginalia:writeExternal', path, data),

  saveBinary: (defaultName, data, format) => ipcRenderer.invoke('marginalia:saveBinary', defaultName, data, format),
  diag: (...parts) => ipcRenderer.invoke('marginalia:diag', ...parts),
  listFonts: () => ipcRenderer.invoke('marginalia:listFonts'),
  windowDragStart: () => ipcRenderer.invoke('marginalia:windowDragStart'),
  windowDragEnd: () => ipcRenderer.invoke('marginalia:windowDragEnd'),
  windowDoubleClick: () => ipcRenderer.invoke('marginalia:windowDoubleClick'),
  setTheme: (mode, titleBar) => ipcRenderer.invoke('marginalia:setTheme', mode, titleBar),
  printToPdf: async (html) => toArrayBuffer(await ipcRenderer.invoke('marginalia:printToPdf', html)),

  /** Commandes des menus natifs (Windows : Fichier › Importer, Aide). */
  onMenuCommand: (cb) => {
    const handler = (_event, cmd) => cb(String(cmd));
    ipcRenderer.on('marginalia:menu', handler);
    return () => ipcRenderer.removeListener('marginalia:menu', handler);
  },
  popupMenu: () => ipcRenderer.invoke('marginalia:popupMenu'),

  onOpenFiles: (cb) => {
    const handler = (_event, files) => cb(files.map(toFile));
    ipcRenderer.on('marginalia:open-files', handler);
    // Signale au processus principal qu'il peut livrer les fichiers reçus avant l'affichage.
    ipcRenderer.send('marginalia:open-files-ready');
    return () => ipcRenderer.removeListener('marginalia:open-files', handler);
  },
};

if (appleBooks) {
  Object.assign(api, {
    appleBooksScan: () => ipcRenderer.invoke('marginalia:appleBooksScan'),
    appleBooksRead: async (p) => {
      const r = await ipcRenderer.invoke('marginalia:appleBooksRead', p);
      return { name: r.name, data: toArrayBuffer(r.data) };
    },
    appleBooksWatch: () => ipcRenderer.invoke('marginalia:appleBooksWatch'),
    appleBooksAnnotations: () => ipcRenderer.invoke('marginalia:appleBooksAnnotations'),
    onAppleBooksChanged: (cb) => {
      const handler = () => cb();
      ipcRenderer.on('marginalia:appleBooksChanged', handler);
      return () => ipcRenderer.removeListener('marginalia:appleBooksChanged', handler);
    },
  });
}
if (nativeImageConvert) {
  // Hors macOS, HEIC et TIFF sont décodés dans le rendu (décodeur JS/WASM embarqué).
  api.convertImage = async (data, ext) => toArrayBuffer(await ipcRenderer.invoke('marginalia:convertImage', data, ext));
}

contextBridge.exposeInMainWorld('marginalia', api);
