// Pont sécurisé (contextIsolation + sandbox) : expose `window.marginalia`, qui implémente
// exactement HostApi de src/lib/platform.ts. Aucune API Node n'est exposée au rendu.
const { contextBridge, ipcRenderer } = require('electron');

/** Les données binaires reviennent du processus principal en Uint8Array : on rend un ArrayBuffer exact. */
function toArrayBuffer(view) {
  if (view instanceof ArrayBuffer) return view;
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}
const toFile = (f) => ({ name: f.name, data: toArrayBuffer(f.data) });

// ── Canal direct avec le processus des secrets (electron/secrets-worker.cjs) ──
// Mots de passe, clés de secours et contenu en clair des espaces chiffrés ne passent PAS par le processus
// principal (qui vit aussi longtemps que l'app, et où une chaîne ne s'efface pas) : ils sont déposés ici,
// sur un MessagePort relié au processus des secrets, qui rend une poignée opaque ; c'est elle qu'on envoie
// au processus principal. Dans l'autre sens, le processus principal rend une poignée de retrait, et le
// contenu est retiré ici, par le même canal. Le monde de la page ne voit ni le canal ni les poignées.
let secPort = null;
let secGen = 0;
let secSeq = 0;
const secWait = new Map();
let portWaiter = null;
ipcRenderer.on('marginalia:secrets-port', (e, gen) => {
  const port = e.ports && e.ports[0];
  if (!port) return;
  if (secPort) {
    try {
      secPort.close();
    } catch {
      /* déjà fermé */
    }
    for (const w of secWait.values()) w.reject(new Error('Saisie expirée : recommencez.'));
    secWait.clear();
  }
  secPort = port;
  secGen = gen;
  port.onmessage = (m) => {
    const d = m.data || {};
    const w = secWait.get(d.id);
    if (!w) return;
    secWait.delete(d.id);
    if (d.ok) w.resolve(d.v);
    else w.reject(new Error(String(d.error || 'Saisie expirée : recommencez.')));
  };
  if (portWaiter && portWaiter.gen === gen) portWaiter.resolve();
});
let portChain = Promise.resolve();
function ensurePort() {
  const run = portChain
    .catch(() => {})
    .then(async () => {
      const gen = await ipcRenderer.invoke('marginalia:secrets-port', secPort ? secGen : 0);
      if (secPort && secGen === gen) return;
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Canal des secrets indisponible.')), 10000);
        portWaiter = {
          gen,
          resolve: () => {
            clearTimeout(t);
            portWaiter = null;
            resolve();
          },
        };
        if (secPort && secGen === gen) portWaiter.resolve();
      });
    });
  portChain = run;
  return run;
}
function portCall(op, payload) {
  return new Promise((resolve, reject) => {
    const id = ++secSeq;
    const t = setTimeout(() => {
      if (secWait.delete(id)) reject(new Error('Saisie expirée : recommencez.'));
    }, 60000);
    secWait.set(id, {
      resolve: (v) => (clearTimeout(t), resolve(v)),
      reject: (e) => (clearTimeout(t), reject(e)),
    });
    secPort.postMessage({ id, op, ...payload });
  });
}
/** Dépose un secret (ou un contenu) dans le processus des secrets ; rend la poignée à envoyer au processus principal. */
async function deposit(v) {
  if (v === undefined || v === null) return undefined;
  await ensurePort();
  // Octets : copie exacte (un message copierait tout l'ArrayBuffer sous une vue).
  const payload = typeof v === 'string' ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : ArrayBuffer.isView(v) ? new Uint8Array(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) : String(v);
  return { h: await portCall('deposit', { v: payload }) };
}
const isRef = (r) => !!r && typeof r === 'object' && !ArrayBuffer.isView(r) && !(r instanceof ArrayBuffer) && typeof r.h === 'string';
/** Retire ce que le processus principal a fait préparer (poignée de retrait). */
async function reveal(ref) {
  if (!secPort || secGen !== ref.gen) await ensurePort();
  if (secGen !== ref.gen) throw new Error('Saisie expirée : recommencez.');
  return portCall('reveal', { h: ref.h });
}
const textOf = (v) => (typeof v === 'string' ? v : new TextDecoder().decode(v));
async function withCapsule(r) {
  if (r && r.ok && isRef(r.capsule)) r.capsule = textOf(await reveal(r.capsule));
  return r;
}
async function withRecovery(r) {
  if (r && r.ok && isRef(r.recoveryKey)) r.recoveryKey = textOf(await reveal(r.recoveryKey));
  return r;
}
const depositText = (v) => (typeof v === 'string' ? deposit(v) : Promise.resolve(undefined));

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
  // `extra` : capsules en clair des espaces chiffrés déverrouillés qui ont changé ({ spaces, drop }).
  // Les capsules en clair sont déposées dans le processus des secrets (scellées là-bas) : le processus
  // principal ne reçoit que leurs poignées.
  saveDbJson: async (json, meta, extra) => {
    let ex;
    if (extra && typeof extra === 'object') {
      const spaces = {};
      for (const [id, capsule] of Object.entries(extra.spaces || {})) spaces[id] = await deposit(String(capsule));
      ex = { spaces, drop: Array.isArray(extra.drop) ? extra.drop : [] };
    }
    return ipcRenderer.invoke('marginalia:saveDb', String(json), meta && typeof meta === 'object' ? { version: meta.version, items: meta.items } : undefined, ex);
  },

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

  // Fichier d'un espace chiffré ouvert : contenu déposé dans (ou retiré du) processus des secrets.
  storeFile: async (bookId, fileName, data) => {
    const sealed = await ipcRenderer.invoke('marginalia:fileSealed', bookId);
    return ipcRenderer.invoke('marginalia:storeFile', bookId, fileName, sealed ? await deposit(data) : data);
  },
  readFile: async (bookId, fileName) => {
    const r = await ipcRenderer.invoke('marginalia:readFile', bookId, fileName);
    return toArrayBuffer(isRef(r) ? await reveal(r) : r);
  },
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
  printDocument: (html) => ipcRenderer.invoke('marginalia:printDocument', String(html)),

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
// Espaces chiffrés (voir electron/spaces.cjs) : mot de passe commun, verrouillage par espace.
const spaceOp = (op, args) => ipcRenderer.invoke('marginalia:spaces', op, args || {});
// Les secrets ne vont pas au processus principal : déposés dans le processus des secrets (voir plus haut).
api.spaces = {
  status: () => spaceOp('status'),
  setup: async (password) => withRecovery(await spaceOp('setup', { password: await deposit(String(password)) })),
  unlock: async (wsId, secret) => withCapsule(await spaceOp('unlock', { wsId, secret: await deposit(String(secret)) })),
  unlockTouchId: async (wsId) => withCapsule(await spaceOp('unlock', { wsId, touchId: true })),
  /** Rendu neuf : reprend le contenu d'un espace resté ouvert pendant le verrouillage d'un autre. */
  reopen: async (wsId) => withCapsule(await spaceOp('reopen', { wsId })),
  // `route` : où reprendre dans le rendu neuf qui remplace celui-ci après le verrouillage.
  lock: (wsId, route) => spaceOp('lock', { wsId, route: route && typeof route === 'object' ? route : undefined }),
  lockAll: (route, only) => spaceOp('lockAll', { route: route && typeof route === 'object' ? route : undefined, only: Array.isArray(only) ? only.map(String) : undefined }),
  open: async (wsId, secret) => spaceOp('open', secret === undefined ? { wsId } : { wsId, secret: await deposit(String(secret)) }),
  verify: async (secret) => spaceOp('verify', { secret: await deposit(String(secret)) }),
  changePassword: async (current, password) => spaceOp('changePassword', { current: await deposit(String(current)), password: await deposit(String(password)) }),
  newRecoveryKey: async (secret) => withRecovery(await spaceOp('newRecoveryKey', { secret: await deposit(String(secret)) })),
  setTouchId: async (on, secret) => spaceOp('setTouchId', { on, secret: await depositText(secret) }),
};
api.security = {
  status: () => secOp('status'),
  unlockPassword: async (password) => secOp('unlockPassword', { password: await deposit(String(password)) }),
  unlockRecovery: async (recoveryKey, newPassword) => secOp('unlockRecovery', { recoveryKey: await deposit(String(recoveryKey)), newPassword: newPassword == null ? undefined : await deposit(String(newPassword)) }),
  unlockTouchId: () => secOp('unlockTouchId'),
  prepare: () => secOp('prepare'),
  enable: async (token, lock) => secOp('enable', { token, lock: lock ? { ...lock, password: await depositText(lock.password) } : undefined }),
  enableLock: async (opts) => secOp('enableLock', { ...(opts || {}), password: await depositText(opts && opts.password) }),
  disableLock: async (password) => secOp('disableLock', { password: await depositText(password) }),
  disable: async (password) => secOp('disable', { password: await depositText(password) }),
  resume: () => secOp('resume'),
  changePassword: async (oldPassword, newPassword) => secOp('changePassword', { oldPassword: await depositText(oldPassword), newPassword: await depositText(newPassword) }),
  prepareRecovery: async (password) => secOp('prepareRecovery', { password: await depositText(password) }),
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
  hostSetMax: (n) => ipcRenderer.invoke('marginalia:collabHostSetMax', Number(n)),
  hostSetPerm: (p) => ipcRenderer.invoke('marginalia:collabHostSetPerm', p && typeof p === 'object' ? { notes: !!p.notes, drafts: !!p.drafts, maps: !!p.maps, organize: !!p.organize } : null),
  find: (code, manualAddress, profile) => ipcRenderer.invoke('marginalia:collabFind', String(code), manualAddress ? String(manualAddress) : undefined, profile),
  internet: (on) => ipcRenderer.invoke('marginalia:collabInternet', typeof on === 'boolean' ? on : undefined),
  waitLeft: () => ipcRenderer.invoke('marginalia:collabWaitLeft'),
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
// Livres papier : recherche d'éditions par le processus principal (Google Books, Open Library).
api.paper = {
  setOnline: (on) => ipcRenderer.invoke('marginalia:paperOnline', on !== false),
  search: (q) => ipcRenderer.invoke('marginalia:paperSearch', String(q || '')),
  isbn: (isbn) => ipcRenderer.invoke('marginalia:paperIsbn', String(isbn || '')),
  cover: (url) => ipcRenderer.invoke('marginalia:paperCover', String(url || '')),
};
// Vidéos : titre, miniature et sous-titres par le processus principal (YouTube, Vimeo, Dailymotion).
api.video = {
  setOnline: (on) => ipcRenderer.invoke('marginalia:videoOnline', on !== false),
  meta: (provider, id) => ipcRenderer.invoke('marginalia:videoMeta', String(provider || ''), String(id || '')),
  transcript: (provider, id, lang) => ipcRenderer.invoke('marginalia:videoTranscript', String(provider || ''), String(id || ''), String(lang || 'fr')),
  thumb: (url) => ipcRenderer.invoke('marginalia:videoThumb', String(url || '')),
};
api.updates = {
  version: () => ipcRenderer.invoke('marginalia:appVersion'),
  check: () => ipcRenderer.invoke('marginalia:checkUpdate'),
  // Mise à jour automatique : le processus principal ne télécharge que le fichier du manifeste signé
  // qu'il a lui-même vérifié (le rendu ne transmet aucune adresse).
  support: () => ipcRenderer.invoke('marginalia:updateSupport'),
  state: () => ipcRenderer.invoke('marginalia:updateState'),
  download: () => ipcRenderer.invoke('marginalia:updateDownload'),
  cancel: (discard) => ipcRenderer.invoke('marginalia:updateCancel', !!discard),
  install: () => ipcRenderer.invoke('marginalia:updateInstall'),
  setInstallOnQuit: (on) => ipcRenderer.invoke('marginalia:updateInstallOnQuit', !!on),
  onEvent: (cb) => {
    const handler = (_e, evt) => cb(evt);
    ipcRenderer.on('marginalia:updateEvent', handler);
    return () => ipcRenderer.removeListener('marginalia:updateEvent', handler);
  },
};
contextBridge.exposeInMainWorld('marginalia', api);
