// Pont sécurisé (contextIsolation + sandbox) : expose `window.marginalia`, qui implémente
// exactement HostApi de src/lib/platform.ts. Aucune API Node n'est exposée au rendu.
const { contextBridge, ipcRenderer } = require('electron');

/** Les données binaires reviennent du processus principal en Uint8Array : on rend un ArrayBuffer exact. */
function toArrayBuffer(view) {
  if (view instanceof ArrayBuffer) return view;
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}
const toFile = (f) => ({ name: f.name, data: toArrayBuffer(f.data) });

const api = {
  kind: 'electron',

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
  setTheme: (mode) => ipcRenderer.invoke('marginalia:setTheme', mode),
  printToPdf: async (html) => toArrayBuffer(await ipcRenderer.invoke('marginalia:printToPdf', html)),
  convertImage: async (data, ext) => toArrayBuffer(await ipcRenderer.invoke('marginalia:convertImage', data, ext)),

  onOpenFiles: (cb) => {
    const handler = (_event, files) => cb(files.map(toFile));
    ipcRenderer.on('marginalia:open-files', handler);
    // Signale au processus principal qu'il peut livrer les fichiers reçus avant l'affichage.
    ipcRenderer.send('marginalia:open-files-ready');
    return () => ipcRenderer.removeListener('marginalia:open-files', handler);
  },
};

contextBridge.exposeInMainWorld('marginalia', api);
