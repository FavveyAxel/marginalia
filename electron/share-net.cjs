// ─────────────────────────────────────────────────────────────
// Partage entre deux Marginalia par le réseau local, avec un code à 6 chiffres.
//
// L'ordinateur qui envoie ouvre une session (serveur HTTP sur le port 47802, ou un port libre ;
// réponse à la découverte UDP sur le port 47803) et affiche un code. Celui qui reçoit saisit le code :
// il cherche l'envoi sur le réseau local (diffusion UDP, ou adresse « 192.168.1.20:47802 » saisie à la
// main si la diffusion est bloquée), prouve qu'il connaît le code, voit le titre et la taille, puis
// l'expéditeur accepte la demande et le paquet passe, chiffré. Le paquet est opaque pour ce module
// (son format est défini ailleurs, src/features/share) : ici, on transporte des octets.
//
// Réseau local d'abord : seules les adresses du réseau local (privées, lien local, boucle locale ;
// isLocalAddress de wifi.cjs) sont contactées ou acceptées en TCP. Par Internet (réglage, activé par
// défaut) : le même protocole passe par des flux iroh pair à pair (collab-iroh.cjs, usage « share ») ;
// l'envoi est retrouvé grâce au code, sans serveur à nous. Le code ne vaut que deux minutes.
// Ces connexions partent du processus principal (Node), pas du rendu : le blocage des requêtes
// sortantes du rendu (session.webRequest, main.cjs) reste entier.
//
// Protocole (version 1) :
//  1. Découverte. Le destinataire diffuse { mg: 'share?', v: 1 } (UDP 47803) sur l'adresse de diffusion
//     de chaque interface du réseau local et sur 255.255.255.255. Chaque émetteur répond
//     { mg: 'share!', v: 1, id, port, salt } : identifiant de session aléatoire (opaque), port HTTP et
//     sel. Ni le code ni rien qui en dérive ne circule dans la découverte (un HMAC du code serait
//     éprouvé hors ligne en une seconde pour 10^6 codes : il donnerait le code à tout le réseau).
//     Saisie de secours : GET /mg-share/v1/hello sur « adresse:port » donne la même réponse.
//  2. Clé du code. Chaque côté calcule Kc = scrypt(code, sel, N = 2^17, r = 8, p = 1) : 128 Mo de
//     mémoire par essai. Mesuré dans le conteneur de test : 420 à 475 ms avec Node 22 (OpenSSL),
//     ≈ 1 s dans le processus principal d'Electron 33 (BoringSSL) ; calcul asynchrone (fil de travail),
//     l'interface ne gèle pas. Essayer les 10^6 codes hors ligne coûte ≈ 5 jours-cœur avec la
//     meilleure implémentation (≈ 0,43 s par essai), et 128 Mo de mémoire par essai mené en parallèle.
//     De Kc dérivent (HKDF-SHA256) une clé d'indice, une clé de preuve et une clé de mélange.
//  3. Ouverture. POST /open { id, n } → { hs, challenge, eph, hint } : défi aléatoire de 32 octets, clé
//     publique X25519 éphémère de l'émetteur, et un indice de 4 bits (HMAC(clé d'indice, n)). L'indice
//     sert à ne pas présenter de preuve à un AUTRE envoi du même réseau (sinon un destinataire
//     consommerait les essais d'un voisin) ; il ne fait gagner que 4 bits à qui a déjà payé les 10^6
//     scrypt (62 500 codes restent possibles pour 5 essais).
//  4. Preuve. POST /prove { hs, eph, proof, dev } : clé X25519 éphémère du destinataire,
//     proof = HMAC(clé de preuve, transcription : id, sel, défi, deux clés publiques), nom d'appareil
//     chiffré. Comparaison à temps constant ; 5 preuves fausses ferment la session. Preuve juste : la
//     session passe en « demande en attente » (une seule à la fois), l'émetteur voit l'appareil et
//     l'adresse ; la réponse contient les métadonnées (titre, compteurs, taille) CHIFFRÉES.
//  5. Accord. Le paquet ne part qu'après accept() de l'émetteur ; un refus ou 2 minutes sans réponse
//     ferment la demande (le destinataire reçoit « L’envoi a été refusé » / « … n’a pas répondu »).
//  6. Transfert. GET /data (en-tête x-mg-auth = HMAC de la clé de session) : trames AES-256-GCM de
//     1 Mo au plus (compteur dans le nonce, rang, dernière trame et taille totale dans les données
//     authentifiées : ni réordonnancement, ni troncature, ni ajout possibles), lues et vérifiées au fil
//     de l'eau. POST /done (HMAC) confirme la réception ; la session se ferme.
//  Clés de session : HKDF(X25519(éphémères) ‖ clé de mélange du code, transcription). Il faut donc à
//  la fois le code ET une clé éphémère privée : écouter le réseau ne suffit jamais à déchiffrer, même
//  si l'on retrouve le code plus tard.
//
// Ce qu'un observateur du réseau local peut encore voir : que deux adresses échangent (découverte
// UDP, puis connexion HTTP sur 47802), les horaires, la taille approximative du paquet (volume
// chiffré : la dernière trame est complétée à 64 Ko, les petits messages à 256 octets), l'identifiant
// de session aléatoire, le sel, les clés publiques éphémères, l'indice de 4 bits et le nombre
// d'essais (taille et rythme des requêtes). Pas de TLS : le chiffrement est celui décrit ci-dessus.
// Ce qu'il ne peut pas voir : le code, le titre, les compteurs, la taille exacte, le nom des
// appareils, le contenu du paquet. Il ne peut pas non plus le déchiffrer plus tard (clés éphémères).
//
// Limites, honnêtement :
//  - le code est court (10^6 possibilités) ; en ligne, 5 essais par session (risque 5 × 10^-6) ;
//  - un attaquant ACTIF sur le même Wi-Fi qui se fait passer pour l'émetteur (il répond à la
//    découverte) obtient une preuve du destinataire et peut chercher le code hors ligne (≈ 5
//    jours-cœur et 128 Mo par essai en parallèle) ; il devrait le trouver puis s'en servir avant les
//    10 minutes de validité, et AVANT le vrai destinataire, et l'expéditeur doit encore accepter la
//    demande en voyant le nom et l'adresse de l'appareil. Un vrai protocole PAKE (SPAKE2, CPace)
//    supprimerait cette recherche hors ligne ; Node n'en fournit pas sans dépendance native ;
//  - l'émetteur faux est démasqué au déchiffrement des métadonnées (il n'a pas le code), mais la
//    preuve est déjà partie ;
//  - IPv4 seulement ; la diffusion peut être bloquée (Wi-Fi d'école, isolation des clients) : il
//    reste la saisie « adresse:port ».
// ─────────────────────────────────────────────────────────────
'use strict';

const http = require('node:http');
const dgram = require('node:dgram');
const os = require('node:os');
const crypto = require('node:crypto');
const { isLocalAddress, lanAddresses } = require('./wifi.cjs');

const HTTP_PORT = 47802;
const UDP_PORT = 47803;
const CODE_TTL_MS = 2 * 60 * 1000; // deux minutes (marge pour un réseau lent) : une demande déjà faite va au bout (accord, transfert)
const REQUEST_TTL_MS = 2 * 60 * 1000; // l'émetteur a 2 minutes pour accepter une demande
const TOMB_MS = 2 * 60 * 1000; // après expiration ou trop d'essais : on répond encore « expiré » 2 minutes
const MAX_TRIES = 5;
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 Go
const CHUNK = 1024 * 1024;
const PAD = 64 * 1024; // la dernière trame est complétée à 64 Ko : la taille exacte ne se lit pas au volume
const MAX_META = 16 * 1024;
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const PREFIX = '/mg-share/v1/';
const X25519_SPKI = Buffer.from('302a300506032b656e032100', 'hex');

// Messages montrés à l'utilisateur (le rendu retire le préfixe « Error invoking remote method »).
const MSG = {
  format: 'Le code doit compter 6 chiffres.',
  notFound: 'Aucun envoi trouvé avec ce code sur ce réseau. Vérifiez le code et que les deux ordinateurs sont sur le même Wi-Fi ; sinon, saisissez l’adresse affichée par l’expéditeur.',
  notFoundAnywhere: 'Aucun envoi trouvé avec ce code, ni sur ce réseau ni par Internet. Vérifiez le code (il n’est valable que deux minutes).',
  badCode: (n) => `Code incorrect${n > 0 ? ` (encore ${n} essai${n > 1 ? 's' : ''})` : ''}.`,
  expired: 'Code expiré : demandez un nouveau code à l’expéditeur.',
  tries: 'Trop d’essais : cet envoi a été fermé par sécurité. Demandez un nouveau code à l’expéditeur.',
  busy: 'L’expéditeur examine déjà une autre demande ; réessayez dans un instant.',
  locked: 'Marginalia est verrouillée sur l’ordinateur qui envoie.',
  address: 'Adresse invalide : saisissez par exemple « 192.168.1.20:47802 ».',
  notLocal: 'Cette adresse n’est pas sur le réseau local : Marginalia ne passe jamais par Internet.',
  unreachable: 'L’ordinateur indiqué ne répond pas. Vérifiez l’adresse et que la fenêtre d’envoi est toujours ouverte.',
  rejected: 'L’envoi a été refusé.',
  noAnswer: 'L’expéditeur n’a pas répondu à temps : relancez la recherche avec le code.',
  ticket: 'Cette demande n’est plus valable : relancez la recherche avec le code.',
  interrupted: 'Le transfert a été interrompu. Relancez la réception.',
  corrupt: 'Données altérées pendant le transfert : réception annulée.',
  impostor: 'Réponse invalide : l’ordinateur trouvé ne connaît pas ce code.',
  tooBig: 'Envoi trop volumineux (2 Go au plus).',
  closed: 'L’envoi a été fermé sur l’ordinateur qui envoie.',
  cancelled: 'Réception annulée.',
};
function shareError(code, message, extra) {
  return Object.assign(new Error(message), { code }, extra || {});
}

// ── Briques cryptographiques ──
const b64 = (b) => Buffer.from(b).toString('base64url');
/** base64url → Buffer, longueur exacte exigée ; null si invalide. */
function unb64(s, len) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length > 4 * MAX_META) return null;
  const b = Buffer.from(s, 'base64url');
  return len == null || b.length === len ? b : null;
}
const hkdf = (ikm, salt, info, len = 32) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info), len));
const hmac = (key, ...parts) => {
  const h = crypto.createHmac('sha256', key);
  for (const p of parts) h.update(p);
  return h.digest();
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};
/** Transcription de la poignée de main : chaque élément préfixé de sa longueur. */
function transcript(...parts) {
  const h = crypto.createHash('sha256').update('mg-share v1');
  for (const p of parts) h.update(u32(p.length)).update(p);
  return h.digest();
}

/** Kc = scrypt(code, sel) puis clés d'indice, de preuve et de mélange (asynchrone : fil de travail). */
function codeKeys(code, salt, cost = SCRYPT) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(Buffer.from(code, 'utf8'), salt, 32, cost, (err, kc) => {
      if (err) return reject(err);
      resolve({ hint: hkdf(kc, salt, 'mg-share v1 hint'), auth: hkdf(kc, salt, 'mg-share v1 auth'), mix: hkdf(kc, salt, 'mg-share v1 mix') });
      kc.fill(0);
    });
  });
}
const hintOf = (keys, id, n) => hmac(keys.hint, 'hint', id, n)[0] & 0x0f;

function x25519() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return { privateKey, pub: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32) };
}
function x25519Shared(privateKey, rawPub) {
  const publicKey = crypto.createPublicKey({ key: Buffer.concat([X25519_SPKI, rawPub]), type: 'spki', format: 'der' });
  const shared = crypto.diffieHellman({ privateKey, publicKey });
  // Point de petit ordre (clé publique piégée) : secret nul, refusé.
  if (shared.every((x) => x === 0)) throw new Error('clé publique invalide');
  return shared;
}
/** Clés de session : émetteur → destinataire (métadonnées, paquet), destinataire → émetteur (nom), MAC. */
function sessionKeys(keys, shared, T) {
  const k = hkdf(Buffer.concat([shared, keys.mix]), T, 'mg-share v1 session', 96);
  return { s2r: k.subarray(0, 32), r2s: k.subarray(32, 64), mac: k.subarray(64, 96) };
}
const nonceOf = (label, i) => Buffer.concat([Buffer.from(label, 'ascii'), u64(i)]); // 4 + 8 octets
/** Petit message chiffré : base64url(chiffré ‖ étiquette GCM) ; JSON complété d'espaces à 256 octets
 *  près, pour que la longueur du titre ou du nom ne se devine pas à celle du message. */
function seal(key, label, obj) {
  const c = crypto.createCipheriv('aes-256-gcm', key, nonceOf(label, 0));
  c.setAAD(Buffer.from(label));
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  const padded = Buffer.alloc(Math.ceil((raw.length + 1) / 256) * 256, 0x20);
  raw.copy(padded);
  const ct = Buffer.concat([c.update(padded), c.final()]);
  return b64(Buffer.concat([ct, c.getAuthTag()]));
}
function unseal(key, label, s) {
  const b = unb64(s);
  if (!b || b.length < 17) throw new Error('boîte invalide');
  const d = crypto.createDecipheriv('aes-256-gcm', key, nonceOf(label, 0));
  d.setAAD(Buffer.from(label));
  d.setAuthTag(b.subarray(-16));
  return JSON.parse(Buffer.concat([d.update(b.subarray(0, -16)), d.final()]).toString('utf8'));
}
/** Trame du paquet : [longueur u32][chiffré][étiquette 16]. */
function sealFrame(key, i, final, total, pt) {
  const c = crypto.createCipheriv('aes-256-gcm', key, nonceOf('DATA', i));
  c.setAAD(Buffer.concat([u64(i), Buffer.from([final ? 1 : 0]), u64(total)]));
  const ct = Buffer.concat([c.update(pt), c.final()]);
  return Buffer.concat([u32(ct.length), ct, c.getAuthTag()]);
}

/** Nom d'appareil lisible et sûr (sans caractère de contrôle, 60 caractères au plus). */
const cleanDevice = (s) =>
  String(s || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'Ordinateur';
const hostName = () => cleanDevice(os.hostname().replace(/\.local$/i, ''));

/** Adresses de diffusion des interfaces du réseau local (adresse | ~masque), plus 255.255.255.255. */
function broadcastTargets(nets = os.networkInterfaces()) {
  const out = new Set();
  for (const { address } of lanAddresses()) {
    let mask = null;
    for (const list of Object.values(nets || {})) for (const n of list || []) if (n.address === address && n.netmask) mask = n.netmask;
    const a = address.split('.').map(Number);
    const m = (mask || '255.255.255.0').split('.').map(Number);
    if (a.length === 4 && m.length === 4) out.add(a.map((x, i) => (x | (~m[i] & 255)) & 255).join('.'));
  }
  out.add('255.255.255.255');
  return [...out];
}

/** « 192.168.1.20:47802 » ou « 192.168.1.20 » → { address, port } ; erreur claire sinon. */
function parseManualAddress(s) {
  const m = /^\s*(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?\s*$/.exec(String(s || ''));
  if (!m || m[1].split('.').some((x) => Number(x) > 255)) throw shareError('address', MSG.address);
  const port = m[2] ? Number(m[2]) : HTTP_PORT;
  if (!(port > 0 && port < 65536)) throw shareError('address', MSG.address);
  return { address: m[1], port };
}

const HEAD = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function json(res, code, obj) {
  if (res.headersSent || res.destroyed) return;
  const body = JSON.stringify(obj);
  res.writeHead(code, { ...HEAD, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
/** Corps JSON d'une requête (8 Ko au plus). */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > 8192) {
        reject(new Error('trop gros'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────
// Côté qui envoie
// ─────────────────────────────────────────────────────────────
/**
 * @param {object} o
 * @param {(evt: object) => void} o.emit  request (demande en attente), attempt (code faux), progress,
 *   done, stopped { reason: closed | replaced | locked | quit | expired | tries | sent }
 * @param {() => boolean} [o.isLocked] app verrouillée : tout est refusé
 * @param {(...a: any[]) => void} [o.diag]
 * @param {number} [o.port]  port HTTP préféré (47802 ; 0 = libre)
 * @param {number} [o.udpPort]  port de découverte (47803)
 * @param {number} [o.ttlMs]  validité du code (tests : raccourcie)
 * @param {number} [o.requestTtlMs]  délai d'accord de l'émetteur (tests)
 * @param {(addr: string) => boolean} [o.isLocal]  tests : filtre d'adresse imposé
 * @param {ReturnType<import('./collab-iroh.cjs').createInternet>} [o.internet]  envoi par Internet (pair à pair)
 */
function createShareSender(o) {
  const diag = o.diag || (() => {});
  const isLocked = o.isLocked || (() => false);
  const isLocal = o.isLocal || isLocalAddress;
  const ttlMs = o.ttlMs || CODE_TTL_MS;
  const requestTtlMs = o.requestTtlMs || REQUEST_TTL_MS;
  let s = null;

  function touchProgress(cur, done, force) {
    const now = Date.now();
    if (!force && now - cur.lastProgress < 150) return;
    cur.lastProgress = now;
    o.emit({ type: 'progress', done, total: cur.size });
  }

  /** Ferme la demande en cours (refus, délai, fin de session) : la requête /data en attente est servie. */
  function closeRequest(cur, why) {
    const r = cur.request;
    if (!r) return;
    cur.request = null;
    clearTimeout(r.timer);
    cur.closed.set(r.hs, why);
    for (const w of r.waiters.splice(0)) w(why);
  }

  /** Fin de session avec « pierre tombale » : on répond encore expiré / trop d'essais, sans le paquet. */
  function end(cur, reason) {
    if (s !== cur || cur.state !== 'open') return;
    cur.state = reason;
    cur.bytes = null;
    clearTimeout(cur.expireTimer);
    closeRequest(cur, reason);
    cur.handshakes.clear();
    diag('partage', 'envoi fermé', reason);
    o.emit({ type: 'stopped', reason });
    cur.tombTimer = setTimeout(() => close(cur), TOMB_MS);
    cur.tombTimer.unref?.();
  }

  function close(cur) {
    if (s === cur) s = null;
    clearTimeout(cur.expireTimer);
    clearTimeout(cur.tombTimer);
    closeRequest(cur, 'closed');
    cur.bytes = null;
    cur.handshakes.clear();
    try {
      cur.server.close();
    } catch {
      /* déjà fermé */
    }
    for (const sock of cur.sockets) sock.destroy();
    try {
      cur.udp?.close();
    } catch {
      /* déjà fermée */
    }
    if (cur.rv) void cur.rv.close();
    cur.rv = null;
  }

  function offer(cur) {
    return { mg: 'share!', v: 1, id: b64(cur.id), port: cur.port, salt: b64(cur.salt) };
  }

  function onUdp(cur, msg, rinfo) {
    if (s !== cur || !isLocal(rinfo.address) || msg.length > 256 || isLocked() || cur.expiredPending) return;
    const now = Date.now();
    if (now - cur.udpWindow > 1000) {
      cur.udpWindow = now;
      cur.udpCount = 0;
    }
    if (++cur.udpCount > 30) return; // pas d'amplification : 30 réponses par seconde au plus
    let q;
    try {
      q = JSON.parse(msg.toString('utf8'));
    } catch {
      return;
    }
    if (!q || q.mg !== 'share?' || q.v !== 1) return;
    cur.udp.send(JSON.stringify(offer(cur)), rinfo.port, rinfo.address, () => {});
  }

  async function onOpen(cur, req, res) {
    const q = await readJson(req);
    const n = unb64(q && q.n, 16);
    if (!q || q.id !== b64(cur.id) || !n) return json(res, 400, { error: 'request' });
    const hint = hintOf(cur.keys, cur.id, n);
    if (cur.state !== 'open' || cur.expiredPending) return json(res, 200, { state: cur.state !== 'open' ? cur.state : 'expired', hint });
    // Poignées de main en attente : 32 au plus, 60 secondes chacune.
    const now = Date.now();
    for (const [k, h] of cur.handshakes) if (now - h.at > 60000 || cur.handshakes.size >= 32) cur.handshakes.delete(k);
    const hs = crypto.randomBytes(16);
    const challenge = crypto.randomBytes(32);
    const eph = x25519();
    cur.handshakes.set(b64(hs), { hs, challenge, eph, at: now });
    return json(res, 200, { state: 'open', hs: b64(hs), challenge: b64(challenge), eph: b64(eph.pub), hint });
  }

  async function onProve(cur, req, res) {
    const q = await readJson(req);
    if (cur.state === 'expired' || cur.expiredPending) return json(res, 410, { error: 'expired' });
    if (cur.state !== 'open') return json(res, 429, { error: 'tries' });
    const h = q && typeof q.hs === 'string' ? cur.handshakes.get(q.hs) : null;
    const ephR = unb64(q && q.eph, 32);
    const proof = unb64(q && q.proof, 32);
    if (!h || !ephR || !proof) return json(res, 400, { error: 'handshake' });
    cur.handshakes.delete(q.hs); // un défi ne sert qu'une fois
    const T = transcript(cur.id, cur.salt, h.challenge, h.eph.pub, ephR);
    const good = hmac(cur.keys.auth, 'proof', T);
    if (!crypto.timingSafeEqual(good, proof)) {
      cur.tries++;
      const remaining = MAX_TRIES - cur.tries;
      diag('partage', 'code faux', remaining);
      o.emit({ type: 'attempt', ok: false, remaining, at: Date.now() });
      if (remaining <= 0) {
        json(res, 429, { error: 'tries' });
        return end(cur, 'tries');
      }
      return json(res, 403, { error: 'bad-code', remaining });
    }
    if (cur.request) return json(res, 409, { error: 'busy' }); // une seule demande à la fois
    let k, device;
    try {
      k = sessionKeys(cur.keys, x25519Shared(h.eph.privateKey, ephR), T);
      device = cleanDevice(unseal(k.r2s, 'DEVN', q.dev));
    } catch {
      return json(res, 400, { error: 'handshake' });
    }
    const address = req.socket.mgInternet ? 'Internet' : String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const r = { hs: q.hs, k, device, address, state: 'pending', waiters: [], timer: null };
    r.timer = setTimeout(() => {
      if (cur.request === r && r.state === 'pending') {
        closeRequest(cur, 'no-answer');
        o.emit({ type: 'request-closed', reason: 'no-answer', at: Date.now() });
        if (cur.expiredPending) end(cur, 'expired'); // code déjà expiré : plus personne ne peut venir
      }
    }, requestTtlMs);
    r.timer.unref?.();
    cur.request = r;
    diag('partage', 'demande', address);
    o.emit({ type: 'request', device, address, at: Date.now() });
    return json(res, 200, { box: seal(k.s2r, 'META', { meta: cur.meta, size: cur.size, name: hostName() }) });
  }

  /** Attente de l'accord de l'émetteur (la requête /data reste ouverte jusqu'à la décision). */
  function decision(cur, r) {
    if (r.state !== 'pending') return Promise.resolve(r.state);
    return new Promise((resolve) => r.waiters.push(resolve));
  }

  async function onData(cur, req, res, url) {
    const hs = url.searchParams.get('hs') || '';
    const r = cur.request && cur.request.hs === hs ? cur.request : null;
    const auth = unb64(String(req.headers['x-mg-auth'] || ''), 32);
    if (!r) {
      const why = cur.closed.get(hs) || (cur.state !== 'open' ? cur.state : cur.expiredPending ? 'expired' : 'ticket');
      const codeOf = { rejected: 403, 'no-answer': 408, expired: 410, tries: 429 };
      return json(res, codeOf[why] || 404, { error: why });
    }
    if (!auth || !crypto.timingSafeEqual(auth, hmac(r.k.mac, 'data', Buffer.from(hs)))) return json(res, 403, { error: 'auth' });
    req.socket.setTimeout(requestTtlMs + 30000);
    const verdict = await decision(cur, r);
    if (verdict !== 'accepted' || cur.request !== r) {
      const codeOf = { rejected: 403, 'no-answer': 408, expired: 410, tries: 429 };
      return json(res, codeOf[verdict] || 410, { error: verdict === 'accepted' ? 'closed' : verdict });
    }
    if (r.state === 'sending') return json(res, 409, { error: 'busy' });
    r.state = 'sending';
    req.socket.setTimeout(60000);
    const bytes = cur.bytes;
    const total = bytes.length;
    res.writeHead(200, { ...HEAD, 'Content-Type': 'application/octet-stream' });
    let gone = false;
    res.on('close', () => (gone = true));
    const drain = () =>
      new Promise((resolve) => {
        const done = () => {
          res.off('drain', done);
          res.off('close', done);
          resolve();
        };
        res.on('drain', done);
        res.on('close', done);
      });
    let off = 0;
    let i = 0;
    touchProgress(cur, 0, true);
    while (off < total && !gone && s === cur && cur.bytes) {
      const endAt = Math.min(off + CHUNK, total);
      let pt = bytes.subarray(off, endAt);
      // Dernière trame : complétée de zéros jusqu'au multiple de 64 Ko (la taille vraie est dans les données authentifiées).
      if (endAt === total && pt.length % PAD) pt = Buffer.concat([pt, Buffer.alloc(PAD - (pt.length % PAD))]);
      const frame = sealFrame(r.k.s2r, i, endAt === total, total, pt);
      off = endAt;
      i++;
      if (!res.write(frame)) await drain();
      touchProgress(cur, off, off === total);
    }
    const ok = off === total && !gone;
    if (ok) res.end();
    else res.destroy();
    if (cur.request === r) r.state = 'accepted'; // échec : le destinataire peut réessayer
    // Code expiré pendant le transfert : on attend l'accusé de réception (30 s au plus), puis on ferme.
    if (cur.expiredPending) {
      if (ok) setTimeout(() => end(cur, 'expired'), 30000).unref?.();
      else end(cur, 'expired');
    }
  }

  async function onDone(cur, req, res) {
    const q = await readJson(req);
    const r = cur.request;
    const mac = unb64(q && q.mac, 32);
    if (!r || q.hs !== r.hs || !mac || !crypto.timingSafeEqual(mac, hmac(r.k.mac, 'done', Buffer.from(r.hs)))) return json(res, 403, { error: 'auth' });
    json(res, 200, { ok: true });
    diag('partage', 'envoi reçu', cur.size);
    o.emit({ type: 'done', size: cur.size, device: r.device, at: Date.now() });
    stop('sent');
  }

  function handler(req, res) {
    const cur = s;
    if (!cur) return json(res, 503, { error: 'closed' });
    // Réseau local, ou flux iroh (Internet, pair à pair).
    if (!req.socket.mgInternet && !isLocal(req.socket.remoteAddress)) {
      req.resume();
      return json(res, 403, { error: 'not-local' });
    }
    if (isLocked()) {
      req.resume();
      return json(res, 423, { error: 'locked' });
    }
    let url;
    try {
      url = new URL(req.url || '/', 'http://local');
    } catch {
      return json(res, 400, { error: 'request' });
    }
    const route = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : '';
    const run = (fn) =>
      fn(cur, req, res, url).catch((e) => {
        diag('partage', 'requête', route, e && e.message);
        json(res, 400, { error: 'request' });
      });
    if (req.method === 'GET' && route === 'hello') {
      req.resume();
      return json(res, 200, offer(cur));
    }
    if (req.method === 'POST' && route === 'open') return void run(onOpen);
    if (req.method === 'POST' && route === 'prove') return void run(onProve);
    if (req.method === 'GET' && route === 'data') {
      req.resume();
      return void run(onData);
    }
    if (req.method === 'POST' && route === 'done') return void run(onDone);
    req.resume();
    return json(res, 404, { error: 'route' });
  }

  /**
   * Ouvre une session d'envoi (remplace la précédente).
   * @param {{ bytes: Buffer | Uint8Array, meta: object }} p
   * @returns {Promise<{ code: string, expiresAt: number, port: number, discovery: boolean, addresses: string[] }>}
   */
  let starting = 0;
  async function start({ bytes, meta }) {
    stop('replaced');
    const ticket = ++starting;
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (!data.length) throw shareError('empty', 'Rien à envoyer.');
    if (data.length > MAX_BYTES) throw shareError('too-big', MSG.tooBig);
    const cleanMeta = JSON.parse(JSON.stringify(meta == null ? {} : meta));
    if (Buffer.byteLength(JSON.stringify(cleanMeta)) > MAX_META) throw shareError('meta', 'Description de l’envoi trop longue.');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const salt = crypto.randomBytes(16);
    const t0 = Date.now();
    const keys = await codeKeys(code, salt, o.scrypt || SCRYPT);
    diag('partage', 'clé du code', `${Date.now() - t0} ms`);
    if (ticket !== starting) throw shareError('replaced', 'Envoi remplacé par un autre.');
    const server = http.createServer(handler);
    server.headersTimeout = 20000;
    server.requestTimeout = 30000;
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
      await listen(o.port ?? HTTP_PORT);
    } catch {
      await listen(0);
    }
    const cur = {
      id: crypto.randomBytes(12),
      code,
      salt,
      keys,
      bytes: data,
      size: data.length,
      meta: cleanMeta,
      expiresAt: Date.now() + ttlMs,
      tries: 0,
      state: 'open',
      server,
      sockets,
      port: server.address().port,
      udp: null,
      udpWindow: 0,
      udpCount: 0,
      handshakes: new Map(),
      request: null,
      closed: new Map(),
      lastProgress: 0,
      expireTimer: null,
      tombTimer: null,
      expiredPending: false,
      rv: null, // point d'accès Internet (iroh)
    };
    // Découverte : port UDP partagé (plusieurs Marginalia sur une machine) ; sans lui, saisie manuelle.
    try {
      const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      await new Promise((resolve, reject) => {
        udp.once('error', reject);
        udp.bind(o.udpPort ?? UDP_PORT, '0.0.0.0', () => {
          udp.off('error', reject);
          resolve();
        });
      });
      udp.on('error', (e) => diag('partage', 'découverte', e && e.message));
      udp.on('message', (msg, rinfo) => onUdp(cur, msg, rinfo));
      cur.udp = udp;
    } catch (e) {
      diag('partage', 'découverte indisponible', e && e.code);
    }
    // Code expiré : plus personne de nouveau ; une demande déjà faite (en attente d'accord, acceptée, en
    // cours d'envoi) va au bout.
    cur.expireTimer = setTimeout(() => {
      if (cur.request) {
        cur.expiredPending = true;
        cur.handshakes.clear();
        cur.rv?.refuseNew();
        o.emit({ type: 'code-expired', at: Date.now() });
      } else end(cur, 'expired');
    }, ttlMs);
    cur.expireTimer.unref?.();
    if (ticket !== starting) {
      close(cur);
      throw shareError('replaced', 'Envoi remplacé par un autre.');
    }
    s = cur;
    diag('partage', 'envoi ouvert', cur.port, data.length);
    if (o.internet && o.internet.available()) {
      try {
        const rv = await o.internet.host(
          code,
          (sock) => {
            if (s === cur && cur.state === 'open') cur.server.emit('connection', sock);
            else sock.destroy();
          },
          'share',
        );
        if (s !== cur) void rv.close();
        else cur.rv = rv;
      } catch (e) {
        diag('partage', 'internet indisponible', e && e.message);
      }
    }
    return info();
  }

  function info() {
    if (!s || s.state !== 'open') return { open: false };
    return {
      open: true,
      code: s.code,
      expiresAt: s.expiresAt,
      port: s.port,
      discovery: !!s.udp,
      internet: !!s.rv,
      codeOpen: !s.expiredPending,
      addresses: lanAddresses().map((a) => `${a.address}:${s.port}`),
      request: s.request ? { device: s.request.device, address: s.request.address, state: s.request.state } : null,
    };
  }

  /** L'émetteur accepte la demande en attente : le paquet part dès que le destinataire le demande. */
  function accept() {
    const r = s && s.state === 'open' ? s.request : null;
    if (!r || r.state !== 'pending') return false;
    r.state = 'accepted';
    clearTimeout(r.timer);
    for (const w of r.waiters.splice(0)) w('accepted');
    diag('partage', 'demande acceptée');
    return true;
  }
  /** Refus : la demande est fermée (la session reste ouverte pour un autre essai). */
  function reject() {
    const r = s ? s.request : null;
    if (!r || r.state === 'sending') return false;
    const cur = s;
    closeRequest(cur, 'rejected');
    diag('partage', 'demande refusée');
    if (cur.expiredPending) end(cur, 'expired');
    return true;
  }

  function stop(reason = 'closed') {
    starting++; // une ouverture en cours (calcul de la clé du code) est abandonnée
    if (!s) return;
    const cur = s;
    const wasOpen = cur.state === 'open';
    close(cur);
    diag('partage', 'envoi arrêté', reason);
    if (wasOpen && reason !== 'replaced') o.emit({ type: 'stopped', reason });
  }

  return { start, stop, info, accept, reject, isOpen: () => !!s && s.state === 'open' };
}

// ─────────────────────────────────────────────────────────────
// Côté qui reçoit
// ─────────────────────────────────────────────────────────────
/**
 * @param {object} [o]
 * @param {() => string} [o.deviceName]  nom montré à l'émetteur (chiffré) ; nom de l'ordinateur par défaut
 * @param {(...a: any[]) => void} [o.diag]
 * @param {number} [o.udpPort]  port de découverte (47803)
 * @param {() => string[]} [o.targets]  tests : adresses de diffusion imposées
 * @param {number} [o.discoverMs]  durée d'écoute des réponses (2 s)
 * @param {ReturnType<import('./collab-iroh.cjs').createInternet>} [o.internet]  réception par Internet (pair à pair)
 */
function createShareReceiver(o = {}) {
  const diag = o.diag || (() => {});
  const tickets = new Map(); // id → { address, port, via, hs, k, size, meta, name, at }
  const active = new Set(); // requêtes et sockets en cours (annulation)
  let generation = 0;

  /**
   * Options de http.request vers l'émetteur : TCP sur le réseau local, ou flux iroh (`via`, Internet).
   * @param {{ address: string, port: number, via?: { stream: () => Promise<import('node:stream').Duplex> } }} t
   */
  async function target(t, extra) {
    if (t.via) {
      const sock = await t.via.stream();
      return { ...extra, createConnection: () => sock };
    }
    if (!isLocalAddress(t.address)) throw shareError('not-local', MSG.notLocal);
    return { ...extra, host: t.address, port: t.port, agent: false };
  }

  /** Requête HTTP vers l'émetteur ; { status, json } ou erreur réseau. */
  async function call(method, t, path, { body, headers = {}, timeout = 10000 } = {}) {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const opts = await target(t, { path: PREFIX + path, method, headers: { ...headers, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) } });
    return new Promise((resolve, reject) => {
      const req = http.request(
        opts,
        (res) => {
          const chunks = [];
          let n = 0;
          res.on('data', (c) => {
            n += c.length;
            if (n > 65536) req.destroy(new Error('réponse trop longue'));
            else chunks.push(c);
          });
          res.on('end', () => {
            active.delete(req);
            let j = null;
            try {
              j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
              /* pas du JSON */
            }
            resolve({ status: res.statusCode, json: j });
          });
          res.on('error', reject);
        },
      );
      active.add(req);
      req.setTimeout(timeout, () => req.destroy(Object.assign(new Error('délai'), { code: 'ETIMEDOUT' })));
      req.on('error', (e) => {
        active.delete(req);
        reject(e);
      });
      req.end(payload || undefined);
    });
  }

  /** Diffusion UDP : offres { address, port, id, salt } des émetteurs du réseau local. */
  function discover() {
    return new Promise((resolve) => {
      const found = new Map();
      const sock = dgram.createSocket({ type: 'udp4' });
      const timers = [];
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        active.delete(sock);
        try {
          sock.close();
        } catch {
          /* déjà fermée */
        }
        resolve([...found.values()]);
      };
      sock.destroy = finish; // annulation (cancel)
      active.add(sock);
      sock.on('error', (e) => {
        diag('partage', 'diffusion', e && e.code);
        finish();
      });
      sock.on('message', (msg, rinfo) => {
        if (!isLocalAddress(rinfo.address) || msg.length > 512) return;
        let r;
        try {
          r = JSON.parse(msg.toString('utf8'));
        } catch {
          return;
        }
        const id = unb64(r && r.id, 12);
        const salt = unb64(r && r.salt, 16);
        if (!r || r.mg !== 'share!' || r.v !== 1 || !id || !salt || !Number.isInteger(r.port) || r.port <= 0 || r.port > 65535) return;
        found.set(`${rinfo.address}|${r.id}`, { address: rinfo.address, port: r.port, id, salt });
      });
      sock.bind(0, () => {
        try {
          sock.setBroadcast(true);
        } catch {
          /* tant pis : la saisie d'adresse reste possible */
        }
        const targets = o.targets ? o.targets() : broadcastTargets();
        const ask = Buffer.from(JSON.stringify({ mg: 'share?', v: 1 }));
        const send = () => {
          if (done) return;
          for (const t of targets) {
            sock.send(ask, o.udpPort ?? UDP_PORT, t, () => {});
          }
        };
        send();
        timers.push(setTimeout(send, 400), setTimeout(send, 1000), setTimeout(finish, o.discoverMs ?? 2000));
      });
    });
  }

  /**
   * Cherche l'envoi correspondant au code, prouve le code et lit les métadonnées (chiffrées).
   * L'émetteur voit alors une demande en attente (nom de cet appareil, adresse).
   * @returns {Promise<{ id: string, meta: object, size: number, from: { address: string, port: number, name: string } }>}
   */
  async function findShare(code, { manualAddress } = {}) {
    code = String(code ?? '').replace(/[\s-]/g, '');
    if (!/^\d{6}$/.test(code)) throw shareError('format', MSG.format);
    const gen = generation;
    let offers;
    let viaInternet = false;
    if (manualAddress) {
      const { address, port } = parseManualAddress(manualAddress);
      if (!isLocalAddress(address)) throw shareError('not-local', MSG.notLocal);
      let r;
      try {
        r = await call('GET', { address, port }, 'hello', { timeout: 5000 });
      } catch (e) {
        if (e.code === 'not-local') throw e;
        throw shareError('unreachable', MSG.unreachable);
      }
      const id = unb64(r.json && r.json.id, 12);
      const salt = unb64(r.json && r.json.salt, 16);
      if (r.status === 423) throw shareError('locked', MSG.locked);
      if (r.status !== 200 || !id || !salt) throw shareError('unreachable', MSG.unreachable);
      offers = [{ address, port, id, salt }];
    } else {
      // Réseau local et Internet en même temps ; le réseau local a la priorité.
      const far = o.internet && o.internet.available() ? internetOffer(code) : null;
      offers = await discover();
      if (!offers.length && far) {
        const of = await far;
        viaInternet = true;
        if (of && of.error) throw of.error;
        if (of) offers = [of];
      } else if (far) void far.then((of) => of && of.via && of.via.close());
    }
    if (gen !== generation) throw shareError('cancelled', MSG.cancelled);
    if (!offers.length) throw shareError('not-found', viaInternet ? MSG.notFoundAnywhere : MSG.notFound);

    const keyCache = new Map();
    const keysFor = (salt) => {
      const k = b64(salt);
      if (!keyCache.has(k)) keyCache.set(k, codeKeys(code, salt, o.scrypt || SCRYPT));
      return keyCache.get(k);
    };
    // Ouverture auprès de chaque offre ; l'indice écarte les envois d'autres personnes sans y user d'essai.
    const opened = await Promise.all(
      offers.map(async (of) => {
        try {
          const keys = await keysFor(of.salt);
          const n = crypto.randomBytes(16);
          const r = await call('POST', of, 'open', { body: { id: b64(of.id), n: b64(n) } });
          if (r.status === 423) return { of, error: shareError('locked', MSG.locked) };
          if (r.status !== 200 || !r.json) return null;
          // Indice différent : un autre envoi, ou un code faux (adresse saisie : on le dit tout de suite).
          if (r.json.hint !== hintOf(keys, of.id, n)) return manualAddress ? { of, error: shareError('bad-code', MSG.badCode(0)) } : null;
          if (r.json.state === 'expired') return { of, error: shareError('expired', MSG.expired) };
          if (r.json.state === 'tries') return { of, error: shareError('tries', MSG.tries) };
          return { of, keys, open: r.json };
        } catch (e) {
          diag('partage', 'ouverture', of.address, e && e.message);
          return null;
        }
      }),
    );
    let lastErr = null;
    const rank = { impostor: 1, busy: 2, locked: 3, 'bad-code': 4, tries: 5, expired: 6 };
    const keep = (e) => {
      if (!lastErr || (rank[e.code] || 0) >= (rank[lastErr.code] || 0)) lastErr = e;
    };
    for (const x of opened) {
      if (!x) continue;
      if (x.error) {
        keep(x.error);
        continue;
      }
      if (gen !== generation) throw shareError('cancelled', MSG.cancelled);
      const { of, keys, open } = x;
      const hs = typeof open.hs === 'string' ? open.hs : '';
      const challenge = unb64(open.challenge, 32);
      const ephS = unb64(open.eph, 32);
      if (!hs || !challenge || !ephS) continue;
      const eph = x25519();
      let k, proof;
      try {
        const T = transcript(of.id, of.salt, challenge, ephS, eph.pub);
        k = sessionKeys(keys, x25519Shared(eph.privateKey, ephS), T);
        proof = hmac(keys.auth, 'proof', T);
      } catch {
        continue;
      }
      const deviceName = cleanDevice(o.deviceName ? o.deviceName() : hostName());
      let r;
      try {
        r = await call('POST', of, 'prove', { body: { hs, eph: b64(eph.pub), proof: b64(proof), dev: seal(k.r2s, 'DEVN', deviceName) } });
      } catch (e) {
        diag('partage', 'preuve', e && e.message);
        continue;
      }
      const err = r.json && r.json.error;
      if (r.status === 403 && err === 'bad-code') keep(shareError('bad-code', MSG.badCode(Number(r.json.remaining) || 0), { remaining: Number(r.json.remaining) || 0 }));
      else if (r.status === 429) keep(shareError('tries', MSG.tries));
      else if (r.status === 410) keep(shareError('expired', MSG.expired));
      else if (r.status === 409) keep(shareError('busy', MSG.busy));
      else if (r.status === 423) keep(shareError('locked', MSG.locked));
      else if (r.status === 200 && r.json && r.json.box) {
        let box;
        try {
          box = unseal(k.s2r, 'META', r.json.box);
        } catch {
          keep(shareError('impostor', MSG.impostor)); // il n'a pas le code : rien n'est accepté de lui
          continue;
        }
        if (!(Number.isInteger(box.size) && box.size > 0)) {
          keep(shareError('impostor', MSG.impostor));
          continue;
        }
        if (box.size > MAX_BYTES) throw shareError('too-big', MSG.tooBig);
        const id = b64(crypto.randomBytes(12));
        for (const [tid, t] of tickets) if (Date.now() - t.at > CODE_TTL_MS + REQUEST_TTL_MS) tickets.delete(tid);
        const from = { address: of.address, port: of.port, internet: !!of.via, name: cleanDevice(box.name) };
        tickets.set(id, { address: of.address, port: of.port, via: of.via || null, hs, k, size: box.size, meta: box.meta, from, at: Date.now() });
        diag('partage', 'envoi trouvé', of.address, box.size);
        return { id, meta: box.meta ?? {}, size: box.size, from };
      }
    }
    throw lastErr || shareError('not-found', MSG.notFound);
  }

  /**
   * Reçoit le paquet (après l'accord de l'émetteur) : octets déchiffrés et vérifiés trame par trame.
   * @param {string} id  identifiant rendu par findShare
   * @param {{ onProgress?: (done: number, total: number) => void }} [p]
   * @returns {Promise<Buffer>}
   */
  async function receiveShare(id, { onProgress } = {}) {
    const t = tickets.get(String(id));
    if (!t) throw shareError('ticket', MSG.ticket);
    const auth = b64(hmac(t.k.mac, 'data', Buffer.from(t.hs)));
    let opts;
    try {
      opts = await target(t, { path: `${PREFIX}data?hs=${encodeURIComponent(t.hs)}`, method: 'GET', headers: { 'x-mg-auth': auth } });
    } catch (e) {
      throw e && e.code === 'not-local' ? e : shareError('interrupted', MSG.interrupted);
    }
    return new Promise((resolve, reject) => {
      const out = Buffer.allocUnsafe(t.size);
      let got = 0;
      let index = 0;
      let finalSeen = false;
      let queue = [];
      let queued = 0;
      let settled = false;
      let lastProgress = 0;
      const fail = (e) => {
        if (settled) return;
        settled = true;
        active.delete(req);
        req.destroy();
        reject(e);
      };
      const take = (n) => {
        const all = queue.length === 1 ? queue[0] : Buffer.concat(queue, queued);
        const head = all.subarray(0, n);
        const rest = all.subarray(n);
        queue = rest.length ? [rest] : [];
        queued = rest.length;
        return head;
      };
      const pump = () => {
        while (queued >= 4) {
          const peek = queue[0].length >= 4 ? queue[0] : Buffer.concat(queue, queued);
          const len = peek.readUInt32BE(0);
          if (len > CHUNK || len === 0 || finalSeen) throw shareError('corrupt', MSG.corrupt);
          if (queued < 4 + len + 16) return;
          const frame = take(4 + len + 16);
          // Trames pleines (1 Mo) puis une dernière, complétée à 64 Ko au plus.
          const final = got + len >= t.size;
          if ((!final && len !== CHUNK) || (final && len - (t.size - got) >= PAD)) throw shareError('corrupt', MSG.corrupt);
          const d = crypto.createDecipheriv('aes-256-gcm', t.k.s2r, nonceOf('DATA', index));
          d.setAAD(Buffer.concat([u64(index), Buffer.from([final ? 1 : 0]), u64(t.size)]));
          d.setAuthTag(frame.subarray(4 + len));
          const pt = Buffer.concat([d.update(frame.subarray(4, 4 + len)), d.final()]); // lève si altéré
          const useful = Math.min(pt.length, t.size - got);
          pt.copy(out, got, 0, useful);
          got += useful;
          index++;
          finalSeen = final;
          const now = Date.now();
          if (onProgress && (final || now - lastProgress > 150)) {
            lastProgress = now;
            onProgress(got, t.size);
          }
        }
      };
      const req = http.request(opts, (res) => {
        if (res.statusCode !== 200) {
          const chunks = [];
          res.on('data', (c) => chunks.length < 64 && chunks.push(c));
          res.on('end', () => {
            let err = '';
            try {
              err = JSON.parse(Buffer.concat(chunks).toString('utf8')).error;
            } catch {
              /* sans détail */
            }
            if (err !== 'busy') tickets.delete(String(id));
            const map = { rejected: ['rejected', MSG.rejected], 'no-answer': ['no-answer', MSG.noAnswer], expired: ['expired', MSG.expired], tries: ['tries', MSG.tries], busy: ['busy', MSG.busy], locked: ['locked', MSG.locked] };
            const [c, m] = map[err] || (res.statusCode === 423 ? map.locked : ['closed', MSG.closed]);
            fail(shareError(c, m));
          });
          return;
        }
        // Accord donné : l'émetteur envoie ; au-delà de 60 s sans octet, transfert interrompu.
        accepted = true;
        req.setTimeout(60000);
        res.on('data', (c) => {
          if (settled) return;
          queue.push(c);
          queued += c.length;
          try {
            pump();
          } catch (e) {
            fail(e.code === 'corrupt' ? e : shareError('corrupt', MSG.corrupt));
          }
        });
        res.on('error', () => fail(shareError('interrupted', MSG.interrupted)));
        res.on('end', async () => {
          if (settled) return;
          if (!finalSeen || got !== t.size || queued) return fail(shareError(finalSeen ? 'corrupt' : 'interrupted', finalSeen ? MSG.corrupt : MSG.interrupted));
          settled = true;
          active.delete(req);
          tickets.delete(String(id));
          // Accusé de réception (l'émetteur ferme la session) ; son échec ne change rien aux octets reçus.
          try {
            await call('POST', t, 'done', { body: { hs: t.hs, mac: b64(hmac(t.k.mac, 'done', Buffer.from(t.hs))) }, timeout: 5000 });
          } catch (e) {
            diag('partage', 'accusé', e && e.message);
          }
          // Copie reçue : plus rien d'iroh ne reste ouvert.
          if (t.via)
            setTimeout(() => {
              t.via.close();
              void o.internet?.releaseGuest?.();
            }, 1500).unref?.();
          resolve(out);
        });
      });
      active.add(req);
      // En attente de l'accord : jusqu'à 2 minutes et demie sans réponse ; ensuite, 60 s sans octet.
      let accepted = false;
      req.setTimeout(REQUEST_TTL_MS + 30000, () => fail(accepted ? shareError('interrupted', MSG.interrupted) : shareError('no-answer', MSG.noAnswer)));
      req.on('error', (e) => {
        if (e && e.code === 'ECONNREFUSED') return fail(shareError('closed', MSG.closed)); // fenêtre d'envoi fermée
        fail(e && e.code && MSG[e.code] ? e : shareError('interrupted', MSG.interrupted));
      });
      req.end();
    });
  }

  /** Par Internet : point d'accès du code d'envoi ; offre comme celle de la découverte locale, ou null. */
  async function internetOffer(code) {
    let via;
    try {
      via = await o.internet.dial(code, 'share');
    } catch (e) {
      diag('partage', 'internet', e && e.message);
      return null;
    }
    if (!via) return null;
    try {
      const r = await call('GET', { via }, 'hello', { timeout: 8000 });
      const id = unb64(r.json && r.json.id, 12);
      const salt = unb64(r.json && r.json.salt, 16);
      if (r.status === 423) return { error: shareError('locked', MSG.locked) };
      if (r.status !== 200 || !id || !salt) return null;
      return { address: 'Internet', port: 0, via, id, salt };
    } catch (e) {
      diag('partage', 'internet : bonjour', e && (e.code || e.message));
      via.close();
      return null;
    }
  }

  /** Annule recherches et réceptions en cours, oublie les demandes (verrouillage, fermeture). */
  function cancel(reason = 'cancelled') {
    generation++;
    for (const r of [...active]) {
      try {
        r.destroy(shareError('cancelled', MSG.cancelled));
      } catch {
        /* déjà fermé */
      }
    }
    active.clear();
    tickets.clear();
    diag('partage', 'réception annulée', reason);
  }

  return { findShare, receiveShare, cancel };
}

module.exports = {
  createShareSender,
  createShareReceiver,
  parseManualAddress,
  broadcastTargets,
  HTTP_PORT,
  UDP_PORT,
  MAX_BYTES,
  SCRYPT,
  MSG,
  // Briques de la poignée de main, reprises telles quelles par le travail à plusieurs (collab-net.cjs).
  handshake: { b64, unb64, hkdf, hmac, u32, u64, transcript, codeKeys, hintOf, x25519, x25519Shared, sessionKeys, seal, unseal, cleanDevice, hostName, json, readJson },
};
