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
//  - la page servie n'a ni script externe ni ressource tierce (CSP stricte avec nonce).
// ─────────────────────────────────────────────────────────────
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

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
function lanAddresses(nets = os.networkInterfaces()) {
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
  const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');

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
    html = html.replace(/__NONCE__/g, nonce).replace(/__COMPUTER__/g, host.replace(/[<>&"']/g, ''));
    send(res, 200, html, 'text/html; charset=utf-8', {
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src blob: data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
    });
  }

  /** Écrit le corps de la requête dans un fichier caché, puis le renomme. */
  function receiveBody(req, limit) {
    return new Promise((resolve, reject) => {
      const len = Number(req.headers['content-length']);
      if (!Number.isFinite(len) || len <= 0) return reject(Object.assign(new Error('Fichier vide.'), { code: 400 }));
      if (len > limit) return reject(Object.assign(new Error('Fichier trop volumineux.'), { code: 413 }));
      const dir = o.dir();
      const tmp = path.join(dir, `.part-${crypto.randomBytes(8).toString('hex')}`);
      fs.mkdirSync(dir, { recursive: true });
      const out = fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 });
      let n = 0;
      let failed = false;
      const fail = (err) => {
        if (failed) return;
        failed = true;
        req.unpipe(out);
        out.destroy();
        fsp.rm(tmp, { force: true }).catch(() => {});
        reject(err);
      };
      req.on('data', (chunk) => {
        n += chunk.length;
        if (n > limit || n > len) fail(Object.assign(new Error('Fichier trop volumineux.'), { code: 413 }));
        else touch();
      });
      req.on('aborted', () => fail(Object.assign(new Error('Envoi interrompu.'), { code: 400 })));
      req.on('error', fail);
      out.on('error', (e) => fail(Object.assign(new Error('Écriture impossible.'), { code: 500, cause: e })));
      out.on('finish', () => {
        if (failed) return;
        if (n !== len) return fail(Object.assign(new Error('Envoi incomplet.'), { code: 400 }));
        resolve({ tmp, size: n });
      });
      req.pipe(out);
    });
  }

  async function onFile(req, res, url, isText) {
    const cur = s;
    if (cur.count >= MAX_FILES) return json(res, 429, { error: 'Trop d’envois pour cette session : rouvrez la fenêtre sur l’ordinateur.' });
    let base, ext;
    if (isText) {
      base = `Texte du ${stamp()}`;
      ext = 'txt';
    } else {
      ({ base, ext } = cleanName(url.searchParams.get('name'), `Envoi du ${stamp()}`));
      if (!ACCEPT_EXT.has(ext)) return json(res, 415, { error: 'Ce type de fichier n’est pas accepté (livres PDF ou EPUB, photos, documents Word, texte).' });
      // Photo prise sur le moment : IMG_1234, image, photo… → nom daté, plus parlant dans la boîte.
      if (IMAGE_EXT.includes(ext) && /^(img|image|photo|pxl|dsc|capture|screenshot)?[\s_-]*\d*$/i.test(base)) base = `Photo du ${stamp()}`;
    }
    let got;
    try {
      got = await receiveBody(req, isText ? MAX_TEXT_BYTES : MAX_FILE_BYTES);
    } catch (e) {
      return json(res, e.code && e.code >= 400 ? e.code : 400, { error: e.message || 'Envoi impossible.' });
    }
    if (s !== cur || o.isLocked()) {
      await fsp.rm(got.tmp, { force: true }).catch(() => {});
      return json(res, 410, { error: 'La réception a été fermée sur l’ordinateur.' });
    }
    if (isText) {
      // Texte : UTF-8 attendu (la page l'envoie ainsi) ; vide ou espaces seuls refusés.
      const t = await fsp.readFile(got.tmp, 'utf8').catch(() => '');
      if (!t.trim()) {
        await fsp.rm(got.tmp, { force: true }).catch(() => {});
        return json(res, 400, { error: 'Le texte est vide.' });
      }
    }
    const name = await uniqueName(base, ext);
    try {
      await fsp.rename(got.tmp, path.join(o.dir(), name));
    } catch (e) {
      await fsp.rm(got.tmp, { force: true }).catch(() => {});
      diag('wifi', 'renommage', e && e.message);
      return json(res, 500, { error: 'Enregistrement impossible sur l’ordinateur.' });
    }
    if (s !== cur) {
      await fsp.rm(path.join(o.dir(), name), { force: true }).catch(() => {});
      return json(res, 410, { error: 'La réception a été fermée sur l’ordinateur.' });
    }
    cur.count++;
    touch();
    o.emit({ type: 'received', name, size: got.size, kind: kindOf(ext), device: deviceOf(req), at: Date.now() });
    return json(res, 200, { ok: true, name });
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
    if (req.method === 'POST' && (action === 'file' || action === 'text') && parts.length === 3) {
      // Contre les envois provoqués par une autre page web : en-tête personnalisé exigé (force
      // une requête « préliminaire » CORS qu'on ne satisfait jamais pour une autre origine).
      if (req.headers['x-marginalia'] !== '1') {
        req.resume();
        return json(res, 403, { error: 'Interdit.' });
      }
      void onFile(req, res, url, action === 'text').catch((e) => {
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
    s = { server, token, port: server.address().port, sockets, timer: null, count: 0, devices: new Set() };
    touch();
    diag('wifi', 'réception ouverte', s.port);
    return info();
  }

  function info() {
    if (!s) return { open: false };
    const urls = lanAddresses().map((a) => ({ ...a, url: `http://${a.address}:${s.port}/r/${s.token}` }));
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

  return { start, stop, info, isOpen: () => !!s };
}

module.exports = { createReceiver, isLocalAddress, lanAddresses, cleanName, ACCEPT_EXT };
