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
  /** Base déjà sérialisée (évite un second JSON.stringify et le clonage de tout l'objet). */
  saveDbJson: (json, meta) => ipcRenderer.invoke('marginalia:saveDb', String(json), meta && typeof meta === 'object' ? { version: meta.version, items: meta.items } : undefined),

  /** Avis du processus principal (restauration automatique, sauvegarde exportée…) : affichés en toast. */
  onNotice: (cb) => {
    const handler = (_event, n) => cb({ message: String((n && n.message) || ''), tone: n && n.tone === 'error' ? 'error' : n && n.tone === 'success' ? 'success' : 'info' });
    ipcRenderer.on('marginalia:notice', handler);
    ipcRenderer.send('marginalia:notices-ready');
    return () => ipcRenderer.removeListener('marginalia:notice', handler);
  },
  /** Fermeture, export ou restauration : écrire tout de suite ce qui attend, puis le confirmer. */
  onFlushRequest: (cb) => {
    const handler = async (_event, id) => {
      try {
        await cb();
      } catch {
        /* l'enregistrement a échoué : le processus principal n'attend pas plus */
      }
      ipcRenderer.send('marginalia:flush-done', id);
    };
    ipcRenderer.on('marginalia:flush-request', handler);
    ipcRenderer.send('marginalia:flush-ready');
    return () => ipcRenderer.removeListener('marginalia:flush-request', handler);
  },

  pickFiles: async () => (await ipcRenderer.invoke('marginalia:pickFiles')).map(toFile),
  pickFolder: async () => {
    const r = await ipcRenderer.invoke('marginalia:pickFolder');
    return r ? { folder: r.folder, files: r.files.map(toFile), skipped: r.skipped, truncated: r.truncated } : null;
  },

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
  /** Commandes de l'éditeur depuis le menu Édition : 'copy-format' | 'paste-format' (pinceau). */
  onEditorCommand: (cb) => {
    const handler = (_event, cmd) => cb(String(cmd));
    ipcRenderer.on('marginalia:editor-command', handler);
    return () => ipcRenderer.removeListener('marginalia:editor-command', handler);
  },

  onOpenFiles: (cb) => {
    const handler = (_event, files) => cb(files.map(toFile));
    ipcRenderer.on('marginalia:open-files', handler);
    // Signale au processus principal qu'il peut livrer les fichiers reçus avant l'affichage.
    ipcRenderer.send('marginalia:open-files-ready');
    return () => ipcRenderer.removeListener('marginalia:open-files', handler);
  },
};

// Confidentialité (chiffrement et verrouillage, options du processus principal).
const secOp = (op, args) => ipcRenderer.invoke('marginalia:security', op, args || {});
api.security = {
  status: () => secOp('status'),
  unlockPassword: (password) => secOp('unlockPassword', { password: String(password) }),
  unlockRecovery: (recoveryKey, newPassword) => secOp('unlockRecovery', { recoveryKey: String(recoveryKey), newPassword: newPassword == null ? undefined : String(newPassword) }),
  unlockTouchId: () => secOp('unlockTouchId'),
  prepare: () => secOp('prepare'),
  enable: (token, lock) => secOp('enable', { token, lock: lock || undefined }),
  enableLock: (opts) => secOp('enableLock', opts),
  disableLock: (password) => secOp('disableLock', { password }),
  disable: (password) => secOp('disable', { password }),
  resume: () => secOp('resume'),
  changePassword: (oldPassword, newPassword) => secOp('changePassword', { oldPassword, newPassword }),
  prepareRecovery: (password) => secOp('prepareRecovery', { password }),
  commitRecovery: (token) => secOp('commitRecovery', { token }),
  cancelPending: () => secOp('cancelPending'),
  setOptions: (opts) => secOp('setOptions', opts),
  lockNow: () => secOp('lockNow'),
  printRecovery: (token, mode) => secOp('printRecovery', { token, mode }),
  /** Activité de l'utilisateur (verrouillage après inactivité). */
  activity: () => ipcRenderer.send('marginalia:security-activity'),
  onChange: (cb) => {
    const handler = (_event, st) => cb(st);
    ipcRenderer.on('marginalia:security-progress', handler);
    return () => ipcRenderer.removeListener('marginalia:security-progress', handler);
  },
  /** Questions du processus principal (mot de passe d'une sauvegarde chiffrée à restaurer). */
  onAsk: (cb) => {
    const handler = async (_event, req) => {
      let value = null;
      try {
        value = await cb(req);
      } catch {
        value = null;
      }
      secOp('answer', { id: req.id, value: typeof value === 'string' ? value : null });
    };
    ipcRenderer.on('marginalia:security-ask', handler);
    return () => ipcRenderer.removeListener('marginalia:security-ask', handler);
  },
};

// Boîte de dépôt : le chemin du dossier reste dans le processus principal ; le rendu ne donne que des noms.
api.inbox = {
  info: () => ipcRenderer.invoke('marginalia:inboxInfo'),
  enable: () => ipcRenderer.invoke('marginalia:inboxEnable'),
  disable: () => ipcRenderer.invoke('marginalia:inboxDisable'),
  choose: () => ipcRenderer.invoke('marginalia:inboxChoose'),
  reset: () => ipcRenderer.invoke('marginalia:inboxReset'),
  list: () => ipcRenderer.invoke('marginalia:inboxList'),
  read: async (name) => toFile(await ipcRenderer.invoke('marginalia:inboxRead', String(name))),
  done: (name) => ipcRenderer.invoke('marginalia:inboxDone', String(name)),
  reveal: () => ipcRenderer.invoke('marginalia:inboxReveal'),
  wifiStart: () => ipcRenderer.invoke('marginalia:wifiStart'),
  wifiInfo: () => ipcRenderer.invoke('marginalia:wifiInfo'),
  wifiStop: () => ipcRenderer.invoke('marginalia:wifiStop'),
  wifiReport: (name, result) => ipcRenderer.invoke('marginalia:wifiReport', String(name), { state: String(result && result.state), label: String(result && result.label) }),
  onWifi: (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on('marginalia:wifi', handler);
    return () => ipcRenderer.removeListener('marginalia:wifi', handler);
  },
  onChange: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('marginalia:inboxChanged', handler);
    return () => ipcRenderer.removeListener('marginalia:inboxChanged', handler);
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

api.diskAccess = {
  status: () => ipcRenderer.invoke('marginalia:diskAccess'),
  openSettings: () => ipcRenderer.invoke('marginalia:openDiskAccessSettings'),
  revealApp: () => ipcRenderer.invoke('marginalia:revealApp'),
  relaunch: () => ipcRenderer.invoke('marginalia:relaunch'),
};
api.sendToPhone = {
  start: (files) => ipcRenderer.invoke('marginalia:sendStart', files),
  stop: () => ipcRenderer.invoke('marginalia:sendStop'),
  onEvent: (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on('marginalia:send', handler);
    return () => ipcRenderer.removeListener('marginalia:send', handler);
  },
};
// Partage entre deux Marginalia par code à 6 chiffres (réseau local) : octets opaques, chiffrés.
api.shareNet = {
  sendStart: (bytes, meta) => ipcRenderer.invoke('marginalia:shareSendStart', bytes, meta),
  sendStop: () => ipcRenderer.invoke('marginalia:shareSendStop'),
  sendAccept: () => ipcRenderer.invoke('marginalia:shareSendAccept'),
  sendReject: () => ipcRenderer.invoke('marginalia:shareSendReject'),
  find: (code, manualAddress) => ipcRenderer.invoke('marginalia:shareFind', String(code), manualAddress ? String(manualAddress) : undefined),
  receive: async (id) => toArrayBuffer(await ipcRenderer.invoke('marginalia:shareReceive', String(id))),
  onEvent: (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on('marginalia:share', handler);
    return () => ipcRenderer.removeListener('marginalia:share', handler);
  },
};
// ── Travailler à plusieurs (réseau local) : session en direct, octets opaques relayés par l'hôte ──
api.collabNet = {
  hostStart: (meta, profile) => ipcRenderer.invoke('marginalia:collabHostStart', meta, profile),
  hostStop: () => ipcRenderer.invoke('marginalia:collabHostStop'),
  hostInfo: () => ipcRenderer.invoke('marginalia:collabHostInfo'),
  hostAccept: (reqId) => ipcRenderer.invoke('marginalia:collabHostAccept', String(reqId)),
  hostReject: (reqId) => ipcRenderer.invoke('marginalia:collabHostReject', String(reqId)),
  hostRemove: (memberId) => ipcRenderer.invoke('marginalia:collabHostRemove', String(memberId)),
  hostNewCode: () => ipcRenderer.invoke('marginalia:collabHostNewCode'),
  find: (code, manualAddress, profile) => ipcRenderer.invoke('marginalia:collabFind', String(code), manualAddress ? String(manualAddress) : undefined, profile),
  join: (ticket) => ipcRenderer.invoke('marginalia:collabJoin', String(ticket)),
  leave: () => ipcRenderer.invoke('marginalia:collabLeave'),
  send: (to, bytes) => ipcRenderer.invoke('marginalia:collabSend', String(to), bytes),
  cut: (ms) => ipcRenderer.invoke('marginalia:collabCut', Number(ms) || 0),
  onEvent: (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on('marginalia:collab', handler);
    return () => ipcRenderer.removeListener('marginalia:collab', handler);
  },
};
api.firstRun = () => ipcRenderer.invoke('marginalia:firstRun');
api.updates = {
  version: () => ipcRenderer.invoke('marginalia:appVersion'),
  check: () => ipcRenderer.invoke('marginalia:checkUpdate'),
};
contextBridge.exposeInMainWorld('marginalia', api);
