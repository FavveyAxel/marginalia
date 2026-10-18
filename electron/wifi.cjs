// ─────────────────────────────────────────────────────────────
// Réception par le Wi-Fi : le téléphone envoie des fichiers, des photos ou du texte à Marginalia,
// directement par le réseau local, sans compte ni Internet.
//
// Sécurité (l'app bloque toujours toute connexion SORTANTE ; ceci n'accepte que des connexions
// ENTRANTES, et seulement pendant que la fenêtre « Recevoir depuis le téléphone » est ouverte) :
//  - le serveur n'existe que pendant une session ; il s'arrête à la fermeture de la fenêtre,
//    au verrouillage de l'app et après IDLE_MS sans activité ;
//  - chaque session a un jeton aléatoire de 128 bits, transmis par le QR code (adresse
//    http://<ip>:<port>/r/<jeton>) ; sans lui, tout est refusé (404), sans dire pourquoi ;
//  - seules les adresses du réseau local sont acceptées (privées, lien local, boucle locale) ;
//  - types de fichiers limités (livres, images, Word, texte) ; taille limitée ; nombre d'envois
//    limité par session ; le nom envoyé ne sert qu'à l'extension et à un titre nettoyé ;
//  - le fichier est écrit en « .part » caché puis renommé : la boîte ne voit que des fichiers
//    complets ;
//  - la page servie n'a ni script externe ni ressource tierce (CSP stricte avec nonce) ;
//  - tout ce qui a du sens est chiffré de bout en bout (voir electron/wifi-crypto.cjs) : clé de
//    256 bits par session, transmise seulement dans le fragment de l'adresse du QR code (« #k=… »,
//    jamais envoyé sur le réseau) ; le téléphone chiffre chaque fichier par blocs et son nom, le
//    serveur refuse tout bloc invalide et déchiffre au fil de l'eau ; ses réponses (devenir des
//    envois, titres) sont chiffrées. Sans la clé, on ne peut ni lire ni envoyer quoi que ce soit.
// ─────────────────────────────────────────────────────────────
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const W = require('./wifi-crypto.cjs');

const IDLE_MS = 15 * 60 * 1000;
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 200;
const PREFERRED_PORT = 47800;
const BOOK_EXT = ['epub', 'pdf'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff', 'gif', 'bmp', 'avif'];
const DOC_EXT = ['docx', 'txt', 'md', 'markdown'];
const ACCEPT_EXT = new Set([...BOOK_EXT, ...IMAGE_EXT, ...DOC_EXT]);

/** Adresse du réseau local (IPv4 privée, lien local, boucle locale ; IPv6 ULA / lien local). */
function isLocalAddress(addr) {
  if (!addr) return false;
  let a = String(addr).toLowerCase();
  if (a.startsWith('::ffff:')) a = a.slice(7);
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [b0, b1] = [Number(m[1]), Number(m[2])];
    return b0 === 10 || b0 === 127 || (b0 === 172 && b1 >= 16 && b1 <= 31) || (b0 === 192 && b1 === 168) || (b0 === 169 && b1 === 254);
  }
  return a === '::1' || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a);
}

// Interfaces virtuelles (machines virtuelles, conteneurs, VPN, AirDrop) : jamais proposées.
const VIRTUAL_IFACE = /^(vEthernet|VirtualBox|VMware|vmnet|vboxnet|docker|br-|veth|virbr|utun|tun|tap|awdl|llw|bridge|ham|zt|tailscale|wg)/i;
// Interfaces habituelles du Wi-Fi ou de l'Ethernet : proposées en premier.
const PREFERRED_IFACE = /^(en0|en1|wlan|wlp|wl|Wi-?Fi|WLAN|Ethernet|eth|enp|eno)/i;

/** Adresses IPv4 du réseau local de l'ordinateur, la plus probable d'abord. */
function lanAddresses(nets) {
  // Tests seulement : réseau local simulé (le conteneur de test n'a pas de Wi-Fi).
  if (!nets && process.env.MARGINALIA_E2E === '1' && process.env.MARGINALIA_E2E_LAN) return [{ address: process.env.MARGINALIA_E2E_LAN, iface: 'en0' }];
  nets = nets || os.networkInterfaces();
  const out = [];
  for (const [iface, list] of Object.entries(nets || {})) {
    if (VIRTUAL_IFACE.test(iface)) continue;
    for (const n of list || []) {
      const v4 = n.family === 'IPv4' || n.family === 4;
      if (!v4 || n.internal || !isLocalAddress(n.address) || n.address.startsWith('169.254.')) continue;
      out.push({ address: n.address, iface });
    }
  }
  const rank = (x) => (PREFERRED_IFACE.test(x.iface) ? 0 : 1) + (x.address.startsWith('192.168.') ? 0 : 0.5);
  return out.sort((a, b) => rank(a) - rank(b));
}

const extOf = (name) => {
  const m = /\.([a-z0-9]{1,10})$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
};

/** Nom propre et sûr : pas de chemin, pas de caractère de contrôle ni réservé, pas de point initial. */
function cleanName(raw, fallback) {
  let n = String(raw || '').normalize('NFC');
  n = n.split(/[\\/]/).pop() || '';
  n = n.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/^[.\s~$]+/, '');
  const ext = extOf(n);
  let base = (ext ? n.slice(0, -(ext.length + 1)) : n).trim();
  if (base.length > 100) base = base.slice(0, 100).trim();
  if (!base) base = fallback;
  return { base, ext };
}

/** « Photo du 18 oct. à 14 h 32 », pour les photos prises sur le moment (IMG_1234, image…). */
function stamp(d = new Date()) {
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
}

// Bibliothèque de chiffrement et fonctions communes, injectées dans les pages du téléphone (sous le
// nonce CSP : aucun script externe, rien d'Internet). Lues une fois.
let pageCrypto = null;
function cryptoScript() {
  if (pageCrypto == null) {
    const nacl = fs.readFileSync(path.join(__dirname, 'nacl-fast.min.cjs'), 'utf8');
    const own = fs.readFileSync(path.join(__dirname, 'wifi-crypto.cjs'), 'utf8');
    pageCrypto = `${nacl}\n${own}`.replace(/<\/script/gi, '<\\/script');
  }
  return pageCrypto;
}

/** Remplit un gabarit de page (fonctions de remplacement : aucun motif « $& » interprété). */
function fill(html, values) {
  let out = html;
  for (const [k, v] of Object.entries(values)) out = out.split(`__${k}__`).join(v);
  return out;
}

const kindOf = (ext) => (BOOK_EXT.includes(ext) ? 'book' : IMAGE_EXT.includes(ext) ? 'image' : ext === 'docx' ? 'draft' : 'text');

/**
 * @param {object} o
 * @param {() => string} o.dir dossier de réception (créé au besoin)
 * @param {(names: string[]) => boolean} o.taken  nom déjà pris ailleurs (boîte de dépôt)
 * @param {() => boolean} o.isLocked app verrouillée : tout est refusé
 * @param {(evt: object) => void} o.emit événements pour l'interface (reçu, appareil, arrêt)
 * @param {string} o.pagePath page HTML servie au téléphone
 * @param {(...a: any[]) => void} [o.diag]
 */
function createReceiver(o) {
  let s = null; // session : { server, token, port, sockets, timer, count, devices }
  const diag = o.diag || (() => {});

  function touch() {
    if (!s) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => stop('idle'), IDLE_MS);
    s.timer.unref?.();
  }

  async function uniqueName(base, ext) {
    const dir = o.dir();
    for (let i = 1; i < 1000; i++) {
      const name = `${base}${i > 1 ? ` (${i})` : ''}${ext ? '.' + ext : ''}`;
      const exists = await fsp.lstat(path.join(dir, name)).then(() => true, () => false);
      if (!exists && !o.taken(name)) return name;
    }
    return `${base} ${crypto.randomBytes(3).toString('hex')}${ext ? '.' + ext : ''}`;
  }

  function deviceOf(req) {
    const ua = String(req.headers['user-agent'] || '');
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return 'iPad';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Téléphone Android' : 'Tablette Android';
    return 'Appareil';
  }

  const send = (res, code, body, type = 'text/plain; charset=utf-8', extra = {}) => {
    if (res.headersSent) return;
    res.writeHead(code, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      ...extra,
    });
    res.end(body);
  };
  // Réponses chiffrées avec la clé de la session (seul le code HTTP reste lisible).
  const json = (res, code, obj, key = s && s.key) => send(res, code, key ? W.seal(key, obj) : '', 'text/plain; charset=utf-8');

  function page(res) {
    const nonce = crypto.randomBytes(16).toString('base64');
    let html;
    try {
      html = fs.readFileSync(o.pagePath, 'utf8');
    } catch (e) {
      diag('wifi', 'page introuvable', e && e.message);
      return send(res, 500, 'Page indisponible.');
    }
    const host = os.hostname().replace(/\.local$/i, '').slice(0, 60);
    // Icône de l'app, intégrée à la page (aucune requête de plus ; la CSP n'autorise que data:).
    let icon = '';
    try {
      icon = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'wifi-icon.png')).toString('base64');
    } catch {
      /* page sans icône */
    }
    // Le nom de l'ordinateur arrive chiffré : il sert aussi à vérifier la clé dès l'ouverture de la
    // page (mauvaise clé ou lien sans fragment : message, et rien n'est envoyé).
    html = fill(html, { ICON: icon, NONCE: nonce, CHECK: W.seal(s.key, { c: host }), CRYPTO: cryptoScript() });
    send(res, 200, html, 'text/html; charset=utf-8', {
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src blob: data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
    });
  }

  /**
   * Déchiffre le corps (blocs du téléphone, voir wifi-crypto.cjs) au fil de l'eau : chaque bloc est
   * authentifié avant d'être écrit ; le premier bloc altéré, réordonné, rejoué d'un autre envoi ou
   * chiffré avec une autre clé arrête tout. Le découpage vient de la longueur annoncée, et le dernier
   * bloc doit être marqué comme tel (une troncature ne passe pas).
   */
  function decryptStream(key, id, plan) {
    const full = W.CHUNK + W.TAG;
    let pending = [];
    let have = 0;
    let index = 0;
    const refused = () => Object.assign(new Error('Envoi refusé : le contenu a été altéré en chemin, ou ne vient pas de la page de ce QR code.'), { code: 400 });
    return new Transform({
      transform(chunk, _enc, cb) {
        pending.push(chunk);
        have += chunk.length;
        while (index < plan.count) {
          const isLast = index === plan.count - 1;
          const need = isLast ? plan.last : full;
          if (have < need) break;
          const buf = pending.length === 1 ? pending[0] : Buffer.concat(pending, have);
          const box = buf.subarray(0, need);
          const rest = buf.subarray(need);
          pending = rest.length ? [rest] : [];
          have = rest.length;
          const plain = W.openFrame(key, id, W.DATA, index, isLast, box);
          if (!plain) return cb(refused());
          index++;
          if (plain.length) this.push(Buffer.from(plain.buffer, plain.byteOffset, plain.length));
        }
        if (index >= plan.count && have > 0) return cb(refused());
        cb();
      },
      flush(cb) {
        if (index !== plan.count || have) return cb(Object.assign(new Error('Envoi incomplet.'), { code: 400 }));
        cb();
      },
    });
  }

  /** Déchiffre le corps de la requête dans un fichier caché (« .part »), qui sera renommé ensuite. */
  function receiveBody(req, limit, key, id) {
    return new Promise((resolve, reject) => {
      const len = Number(req.headers['content-length']);
      if (!Number.isFinite(len) || len <= 0) return reject(Object.assign(new Error('Fichier vide.'), { code: 400 }));
      if (len > W.cipherSize(limit)) return reject(Object.assign(new Error('Fichier trop volumineux.'), { code: 413 }));
      const plan = W.framesOf(len);
      if (!plan) return reject(Object.assign(new Error('Envoi invalide.'), { code: 400 }));
      const dir = o.dir();
      const tmp = path.join(dir, `.part-${crypto.randomBytes(8).toString('hex')}`);
      fs.mkdirSync(dir, { recursive: true });
      const out = fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 });
      const dec = decryptStream(key, id, plan);
      let n = 0;
      let size = 0;
      let failed = false;
      const fail = (err) => {
        if (failed) return;
        failed = true;
        req.unpipe(dec);
        dec.unpipe(out);
        dec.destroy();
        out.destroy();
        req.resume(); // le reste du corps est lu et jeté (sinon la connexion reste bloquée)
        fsp.rm(tmp, { force: true }).catch(() => {});
        reject(err);
      };
      req.on('data', (chunk) => {
        n += chunk.length;
        if (n > len) fail(Object.assign(new Error('Fichier trop volumineux.'), { code: 413 }));
        else touch();
      });
      dec.on('data', (plain) => {
        size += plain.length;
        if (size > limit) fail(Object.assign(new Error('Fichier trop volumineux.'), { code: 413 }));
      });
      req.on('aborted', () => fail(Object.assign(new Error('Envoi interrompu.'), { code: 400 })));
      req.on('error', fail);
      dec.on('error', (e) => fail(e && e.code ? e : Object.assign(new Error('Envoi invalide.'), { code: 400, cause: e })));
      out.on('error', (e) => fail(Object.assign(new Error('Écriture impossible.'), { code: 500, cause: e })));
      out.on('finish', () => {
        if (failed) return;
        if (n !== len) return fail(Object.assign(new Error('Envoi incomplet.'), { code: 400 }));
        if (!size) return fail(Object.assign(new Error('Fichier vide.'), { code: 400 }));
        resolve({ tmp, size });
      });
      req.pipe(dec).pipe(out);
    });
  }

  /**
   * Un envoi du téléphone : POST …/up?id=<identifiant du flux>&m=<nom et nature, chiffrés>, corps =
   * blocs chiffrés. L'identifiant (16 octets aléatoires tirés par le téléphone) n'a pas de sens en
   * lui-même ; il ne sert qu'une fois par session (un envoi rejoué est refusé).
   */
  async function onFile(req, res, url) {
    const cur = s;
    // Réponse chiffrée avec la clé de CETTE session (même si elle a été fermée ou remplacée entre-temps).
    const reply = (code, obj) => json(res, code, obj, cur.key);
    if (cur.count >= MAX_FILES) return reply(429, { error: 'Trop d’envois pour cette session : rouvrez la fenêtre sur l’ordinateur.' });
    const idTxt = String(url.searchParams.get('id') || '');
    const id = /^[A-Za-z0-9_-]{22}$/.test(idTxt) ? W.unb64u(idTxt) : null;
    if (!id || id.length !== 16) return reply(400, { error: 'Envoi invalide.' });
    if (cur.ids.has(idTxt)) return reply(409, { error: 'Cet envoi a déjà été reçu.' });
    const meta = W.openMeta(cur.key, id, url.searchParams.get('m'));
    if (!meta || (meta.t !== 'file' && meta.t !== 'text')) return reply(400, { error: 'Envoi refusé : il ne vient pas de la page de ce QR code.' });
    cur.ids.set(idTxt, null); // réservé dès maintenant : un double de cette requête est refusé
    const isText = meta.t === 'text';
    let base, ext;
    if (isText) {
      base = `Texte du ${stamp()}`;
      ext = 'txt';
    } else {
      ({ base, ext } = cleanName(typeof meta.n === 'string' ? meta.n : '', `Envoi du ${stamp()}`));
      if (!ACCEPT_EXT.has(ext)) return reply(415, { error: 'Ce type de fichier n’est pas accepté (livres PDF ou EPUB, photos, documents Word, texte).' });
      // Photo prise sur le moment : IMG_1234, image, photo… → nom daté, plus parlant dans la boîte.
      if (IMAGE_EXT.includes(ext) && /^(img|image|photo|pxl|dsc|capture|screenshot)?[\s_-]*\d*$/i.test(base)) base = `Photo du ${stamp()}`;
    }
    let got;
    try {
      got = await receiveBody(req, isText ? MAX_TEXT_BYTES : MAX_FILE_BYTES, cur.key, id);
    } catch (e) {
      return reply(e.code && e.code >= 400 ? e.code : 400, { error: e.message || 'Envoi impossible.' });
    }
    if (s !== cur || o.isLocked()) {
      await fsp.rm(got.tmp, { force: true }).catch(() => {});
      return reply(410, { error: 'La réception a été fermée sur l’ordinateur.' });
    }
    if (isText) {
      // Texte : UTF-8 attendu (la page l'envoie ainsi) ; vide ou espaces seuls refusés.
      const t = await fsp.readFile(got.tmp, 'utf8').catch(() => '');
      if (!t.trim()) {
        await fsp.rm(got.tmp, { force: true }).catch(() => {});
        return reply(400, { error: 'Le texte est vide.' });
      }
    }
    const name = await uniqueName(base, ext);
    try {
      await fsp.rename(got.tmp, path.join(o.dir(), name));
    } catch (e) {
      await fsp.rm(got.tmp, { force: true }).catch(() => {});
      diag('wifi', 'renommage', e && e.message);
      return reply(500, { error: 'Enregistrement impossible sur l’ordinateur.' });
    }
    if (s !== cur) {
      await fsp.rm(path.join(o.dir(), name), { force: true }).catch(() => {});
      return reply(410, { error: 'La réception a été fermée sur l’ordinateur.' });
    }
    cur.count++;
    cur.names.add(name);
    cur.ids.set(idTxt, name);
    touch();
    o.emit({ type: 'received', name, size: got.size, kind: kindOf(ext), device: deviceOf(req), at: Date.now() });
    return reply(200, { ok: true, name });
  }

  function handler(req, res) {
    if (!s) return send(res, 503, 'Fermé.');
    // Réseau local uniquement.
    if (!isLocalAddress(req.socket.remoteAddress)) {
      req.resume();
      return send(res, 403, 'Interdit.');
    }
    let url;
    try {
      url = new URL(req.url || '/', 'http://local');
    } catch {
      return send(res, 400, 'Requête invalide.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const okToken = parts[0] === 'r' && parts[1] && parts[1].length === s.token.length && crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(s.token));
    if (!okToken) {
      req.resume();
      return send(res, 404, 'Ce lien n’est plus valable. Sur l’ordinateur, ouvrez « Recevoir depuis le téléphone » et scannez le nouveau code.');
    }
    if (o.isLocked()) {
      req.resume();
      return json(res, 423, { error: 'Marginalia est verrouillée sur l’ordinateur.' });
    }
    const action = parts[2] || '';
    if (req.method === 'GET' && !action) {
      touch();
      const dev = deviceOf(req);
      const key = `${req.socket.remoteAddress}|${dev}`;
      if (!s.devices.has(key)) {
        s.devices.add(key);
        o.emit({ type: 'device', device: dev, at: Date.now() });
      }
      return page(res);
    }
    if (req.method === 'GET' && action === 'state') return json(res, 200, { open: true });
    // Devenir d'un envoi de cette session (« Ajouté à la bibliothèque… ») : le téléphone le demande
    // par l'identifiant opaque de son envoi (jamais par le nom), et la réponse est chiffrée.
    if (req.method === 'GET' && action === 'result') {
      const name = s.ids.get(String(url.searchParams.get('id') || ''));
      if (!name || !s.names.has(name)) return json(res, 404, { error: 'Envoi inconnu.' });
      touch();
      return json(res, 200, s.results.get(name) || { state: 'working' });
    }
    if (req.method === 'POST' && action === 'up' && parts.length === 3) {
      // Contre les envois provoqués par une autre page web : en-tête personnalisé exigé (force
      // une requête « préliminaire » CORS qu'on ne satisfait jamais pour une autre origine).
      if (req.headers['x-marginalia'] !== '1') {
        req.resume();
        return json(res, 403, { error: 'Interdit.' });
      }
      void onFile(req, res, url).catch((e) => {
        diag('wifi', 'réception', e && e.message);
        json(res, 500, { error: 'Envoi impossible.' });
      });
      return;
    }
    req.resume();
    return send(res, 404, 'Introuvable.');
  }

  async function start() {
    if (s) return info();
    await fsp.mkdir(o.dir(), { recursive: true });
    const token = crypto.randomBytes(16).toString('base64url');
    const key = crypto.randomBytes(32); // clé de chiffrement de la session (seulement dans le QR code)
    const server = http.createServer(handler);
    server.requestTimeout = 30 * 60 * 1000; // gros fichier sur un Wi-Fi lent
    server.headersTimeout = 20000;
    server.keepAliveTimeout = 5000;
    const sockets = new Set();
    server.on('connection', (sock) => {
      sockets.add(sock);
      sock.on('close', () => sockets.delete(sock));
    });
    const listen = (port) =>
      new Promise((resolve, reject) => {
        const onErr = (e) => {
          server.off('listening', onOk);
          reject(e);
        };
        const onOk = () => {
          server.off('error', onErr);
          resolve();
        };
        server.once('error', onErr);
        server.once('listening', onOk);
        server.listen(port, '0.0.0.0');
      });
    try {
      await listen(PREFERRED_PORT);
    } catch {
      await listen(0);
    }
    s = { server, token, key, port: server.address().port, sockets, timer: null, count: 0, devices: new Set(), names: new Set(), ids: new Map(), results: new Map() };
    touch();
    diag('wifi', 'réception ouverte', s.port);
    return info();
  }

  function info() {
    if (!s) return { open: false };
    // La clé voyage dans le fragment (« #k=… ») : le navigateur du téléphone ne l'envoie jamais.
    const urls = lanAddresses().map((a) => ({ ...a, url: `http://${a.address}:${s.port}/r/${s.token}#k=${W.b64u(s.key)}` }));
    return { open: true, port: s.port, path: `/r/${s.token}`, urls, idleMs: IDLE_MS, count: s.count };
  }

  function stop(reason = 'closed') {
    if (!s) return;
    const cur = s;
    s = null;
    clearTimeout(cur.timer);
    try {
      cur.server.close();
    } catch {
      /* déjà fermé */
    }
    for (const sock of cur.sockets) sock.destroy();
    diag('wifi', 'réception fermée', reason);
    o.emit({ type: 'stopped', reason });
  }

  /** Devenir d'un envoi, donné par l'interface (seulement pour les envois de la session en cours). */
  function report(name, result) {
    if (!s || !s.names.has(String(name)) || !result) return;
    const state = String(result.state || '').slice(0, 20);
    const label = String(result.label || '').slice(0, 300);
    s.results.set(String(name), { state, label });
  }

  return { start, stop, info, report, isOpen: () => !!s };
}

// ─────────────────────────────────────────────────────────────
// Envoi vers le téléphone (le chemin inverse) : un document exporté (PDF, Word…) est proposé au
// téléchargement le temps que la fenêtre « Envoyer sur le téléphone » est ouverte. Mêmes garde-fous :
// jeton de session, réseau local seulement, page sans ressource externe, fichiers en mémoire seulement.
// Chiffré de bout en bout comme la réception : la page ne contient aucun nom de fichier ; elle demande
// un manifeste chiffré (…/m), puis le document chiffré par blocs (…/f/<n>), le déchiffre elle-même et
// le propose à l'enregistrement (lien « download » vers un blob:). Aucun nom ne passe en clair, pas
// même dans un en-tête Content-Disposition.
// ─────────────────────────────────────────────────────────────
const SEND_PORT = 47801;

/**
 * @param {object} o
 * @param {() => boolean} o.isLocked
 * @param {(evt: object) => void} o.emit  appareil connecté, document téléchargé, arrêt
 * @param {string} o.pagePath page HTML servie au téléphone
 * @param {(...a: any[]) => void} [o.diag]
 */
function createSender(o) {
  let s = null; // { server, token, port, sockets, timer, files, devices }
  const diag = o.diag || (() => {});
  const touch = () => {
    if (!s) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => stop('idle'), IDLE_MS);
    s.timer.unref?.();
  };
  const deviceOf = (req) => {
    const ua = String(req.headers['user-agent'] || '');
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return 'iPad';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Téléphone Android' : 'Tablette Android';
    return 'Appareil';
  };
  const head = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
  const text = (res, code, body) => {
    res.writeHead(code, { ...head, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(body);
  };
  /** Réponse chiffrée avec la clé de la session. */
  const sealed = (res, code, obj) => {
    res.writeHead(code, { ...head, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(W.seal(s.key, obj));
  };

  function page(res) {
    const nonce = crypto.randomBytes(16).toString('base64');
    let html;
    try {
      html = fs.readFileSync(o.pagePath, 'utf8');
    } catch (e) {
      diag('wifi', 'page d’envoi introuvable', e && e.message);
      return text(res, 500, 'Page indisponible.');
    }
    let icon = '';
    try {
      icon = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'wifi-icon.png')).toString('base64');
    } catch {
      /* sans icône */
    }
    // Aucun nom de fichier dans la page : la liste arrive chiffrée (manifeste), comme le nom de
    // l'ordinateur, qui sert aussi à vérifier la clé dès l'ouverture.
    const host = os.hostname().replace(/\.local$/i, '').slice(0, 60);
    html = fill(html, { ICON: icon, NONCE: nonce, CHECK: W.seal(s.key, { c: host }), CRYPTO: cryptoScript() });
    res.writeHead(200, {
      ...head,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
    });
    res.end(html);
  }

  function handler(req, res) {
    if (!s) return text(res, 503, 'Fermé.');
    if (!isLocalAddress(req.socket.remoteAddress)) {
      req.resume();
      return text(res, 403, 'Interdit.');
    }
    let url;
    try {
      url = new URL(req.url || '/', 'http://local');
    } catch {
      return text(res, 400, 'Requête invalide.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const okToken = parts[0] === 's' && parts[1] && parts[1].length === s.token.length && crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(s.token));
    req.resume();
    if (!okToken || req.method !== 'GET') return text(res, 404, 'Ce lien n’est plus valable. Sur l’ordinateur, rouvrez « Envoyer sur le téléphone » et scannez le nouveau code.');
    if (o.isLocked()) return text(res, 423, 'Marginalia est verrouillée sur l’ordinateur.');
    touch();
    if (parts.length === 2) {
      const dev = deviceOf(req);
      const key = `${req.socket.remoteAddress}|${dev}`;
      if (!s.devices.has(key)) {
        s.devices.add(key);
        o.emit({ type: 'device', device: dev, at: Date.now() });
      }
      return page(res);
    }
    if (parts[2] === 'state' && parts.length === 3) {
      res.writeHead(200, { ...head, 'Content-Type': 'application/json' });
      return res.end('{"open":true}');
    }
    // Manifeste : noms, natures, tailles, et l'identifiant de flux de chaque document (chiffré).
    if (parts[2] === 'm' && parts.length === 3) {
      return sealed(res, 200, {
        files: s.files.map((f, i) => ({ i, name: f.name, kind: f.kind, label: f.label, mime: f.mime, size: f.data.length, sid: W.b64u(f.sid) })),
      });
    }
    if (parts[2] === 'f' && parts.length === 4 && /^\d+$/.test(parts[3])) {
      const f = s.files[Number(parts[3])];
      if (!f) return text(res, 404, 'Introuvable.');
      return sendFile(req, res, f, s.key);
    }
    return text(res, 404, 'Introuvable.');
  }

  /**
   * Document chiffré par blocs d'1 Mio (nonce : identifiant du flux, usage SDATA, dernier, compteur),
   * au fil de l'eau en respectant la cadence du réseau. Les blocs d'un même document sont toujours les
   * mêmes (même clair, même nonce) : un nouveau téléchargement ne réutilise jamais un nonce pour un
   * autre contenu.
   */
  function sendFile(req, res, f, key) {
    const data = f.data;
    const count = W.frameCount(data.length);
    res.writeHead(200, { ...head, 'Content-Type': 'application/octet-stream', 'Content-Length': W.cipherSize(data.length) });
    let i = 0;
    const pump = () => {
      while (i < count && !res.destroyed) {
        const last = i === count - 1;
        const box = W.sealFrame(key, f.sid, W.SDATA, i, last, data.subarray(i * W.CHUNK, Math.min(data.length, (i + 1) * W.CHUNK)));
        i++;
        const more = res.write(Buffer.from(box.buffer, box.byteOffset, box.length));
        if (last) return res.end();
        if (!more) return res.once('drain', pump);
      }
    };
    res.on('finish', () => o.emit({ type: 'downloaded', name: f.name, device: deviceOf(req), at: Date.now() }));
    pump();
  }

  /** files : [{ name, mime, kind, label, data: Buffer }] ; remplace la session en cours. */
  async function start(files) {
    stop('replaced');
    const token = crypto.randomBytes(16).toString('base64url');
    const key = crypto.randomBytes(32); // clé de la session (seulement dans le QR code)
    // Un identifiant de flux par document (nonces de ses blocs).
    files = files.map((f) => ({ ...f, sid: crypto.randomBytes(16) }));
    const server = http.createServer(handler);
    server.headersTimeout = 20000;
    server.keepAliveTimeout = 5000;
    const sockets = new Set();
    server.on('connection', (sock) => {
      sockets.add(sock);
      sock.on('close', () => sockets.delete(sock));
    });
    const listen = (port) =>
      new Promise((resolve, reject) => {
        const onErr = (e) => {
          server.off('listening', onOk);
          reject(e);
        };
        const onOk = () => {
          server.off('error', onErr);
          resolve();
        };
        server.once('error', onErr);
        server.once('listening', onOk);
        server.listen(port, '0.0.0.0');
      });
    try {
      await listen(SEND_PORT);
    } catch {
      await listen(0);
    }
    s = { server, token, key, port: server.address().port, sockets, timer: null, files, devices: new Set(), base: `/s/${token}` };
    touch();
    diag('wifi', 'envoi ouvert', files.map((f) => f.name).join(', '));
    return info();
  }
  function info() {
    if (!s) return { open: false };
    // La clé voyage dans le fragment (« #k=… ») : le navigateur du téléphone ne l'envoie jamais.
    const k = W.b64u(s.key);
    return { open: true, port: s.port, path: s.base, urls: lanAddresses().map((a) => ({ ...a, url: `http://${a.address}:${s.port}${s.base}#k=${k}` })), idleMs: IDLE_MS };
  }
  function stop(reason = 'closed') {
    if (!s) return;
    const cur = s;
    s = null;
    clearTimeout(cur.timer);
    try {
      cur.server.close();
    } catch {
      /* déjà fermé */
    }
    for (const sock of cur.sockets) sock.destroy();
    cur.files.length = 0;
    if (reason !== 'replaced') o.emit({ type: 'stopped', reason });
  }
  return { start, stop, info, isOpen: () => !!s };
}

module.exports = { createReceiver, createSender, isLocalAddress, lanAddresses, cleanName, ACCEPT_EXT };
