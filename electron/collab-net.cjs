// ─────────────────────────────────────────────────────────────
// « Travailler à plusieurs » : session en direct sur le réseau local, jusqu'à 6 personnes (hôte compris).
//
// Celui qui ouvre la session est l'HÔTE : son processus principal est le relais (étoile) ; les invités
// ne se parlent qu'à travers lui. Ce module ne transporte que des octets opaques : le contenu des
// messages (mises à jour Yjs des écrits, éléments de l'espace, cartes…) est défini et lu dans le rendu
// (src/features/collab). Le relais ne lit que l'enveloppe (destinataire, expéditeur).
//
// Réseau local d'abord : seules les adresses du réseau local (isLocalAddress de wifi.cjs) sont contactées
// ou acceptées en TCP. Par Internet (réglage, activé par défaut) : le même protocole passe par des flux
// iroh (collab-iroh.cjs) ; l'hôte est trouvé grâce au code, sans serveur à nous. Un invité qui vient par
// Internet suit exactement la même poignée de main et doit être accepté par l'hôte.
//
// Poignée de main : CELLE DU PARTAGE PAR CODE (share-net.cjs), reprise brique par brique (rien de neuf) :
//  1. Découverte : diffusion UDP { mg: 'collab?', v: 1 } sur le port 47804 → { mg: 'collab!', v: 1, id,
//     port, salt } ; ou « adresse:port » saisie (GET /mg-collab/v1/hello).
//  2. Kc = scrypt(code, sel, N = 2^17) → clés d'indice, de preuve et de mélange (codeKeys de share-net).
//  3. POST /open { id, n } → { hs, challenge, eph, hint } ; POST /prove { hs, eph, proof, dev } :
//     preuve HMAC sur la transcription (préfixée « collab » : séparation des usages), prénom, couleur et
//     nom d'appareil CHIFFRÉS ; 5 preuves fausses ferment le CODE (la session continue ; l'hôte peut
//     afficher un nouveau code). Preuve juste → demande en attente : l'hôte ACCEPTE ou refuse.
//  4. GET /link (connexion HTTP « Upgrade ») authentifiée par HMAC de la clé de session : elle attend la
//     décision de l'hôte ; acceptée → la connexion devient un canal chiffré dans les deux sens.
//  Clés du canal : HKDF(X25519(éphémères) ‖ clé de mélange du code, transcription) — sessionKeys de
//  share-net — : il faut le code ET une clé éphémère privée ; écouter le réseau ne suffit jamais.
//  Reconnexion d'un invité coupé : jeton de 32 octets aléatoires remis DANS le canal chiffré ; même
//  construction (défi de l'hôte, X25519 éphémères, preuve HMAC, sessionKeys) avec des clés tirées du
//  jeton par HKDF au lieu du code ; pas de nouvel accord (c'est la même personne), nouvelles clés.
//
// Canal : trames [longueur u32][AES-256-GCM][étiquette 16] ; nonce = sens (4 octets) ‖ compteur u64 ;
// données authentifiées = compteur ‖ sens : ni rejeu, ni réordonnancement, ni trame d'un sens dans
// l'autre. Clair d'une trame : [drapeaux u8][longueur u32][octets][bourrage jusqu'à un multiple de 256 o]
// (la longueur d'une frappe ne se lit pas au volume). Un message (enveloppe JSON + octets) peut couvrir
// plusieurs trames (1 Mo au plus chacune). Trame invalide : connexion coupée.
//
// Ce qu'un observateur du réseau local voit : que des adresses échangent (UDP 47804, TCP 47804), les
// horaires, les volumes (arrondis à 256 octets), l'identifiant de session, le sel, les clés publiques
// éphémères, l'indice de 4 bits. Ce qu'il ne voit pas : le code, les prénoms, couleurs et noms
// d'appareil, le titre de l'espace, le texte, les cartes, rien du contenu. Limites : celles du partage
// par code (share-net.cjs : code de 10^6 possibilités, recherche hors ligne possible par un faux hôte
// actif sur le même Wi-Fi, IPv4 seulement), et l'hôte voit passer tout le contenu (il en fait partie).
// ─────────────────────────────────────────────────────────────
'use strict';

const http = require('node:http');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const { isLocalAddress, lanAddresses } = require('./wifi.cjs');
const share = require('./share-net.cjs');

const H = share.handshake;
const PORT = 47804;
const PREFIX = '/mg-collab/v1/';
const MAX_PEOPLE = 6;
const MIN_PEOPLE = 2;
// ── Permissions des invités (cases cochées par l'hôte, les mêmes pour tous les invités) ──
// Tout le monde voit tout. En plus, chaque case permet :
//  notes    : ajouter des extraits et des notes (extraits, concepts) ;
//  drafts   : modifier les écrits (texte en direct, versions réunies) ;
//  maps     : modifier les cartes ;
//  organize : ajouter, ranger et retirer les éléments de l'espace (livres, groupes, plans, arguments…).
// Appliquées PAR L'HÔTE à chaque message d'un invité (avant de le lire et de le relayer) : un invité
// modifié ne peut pas passer outre. Le rendu de l'invité bloque aussi ces modifications à l'écran.
const PERM_KEYS = ['notes', 'drafts', 'maps', 'organize'];
const ALL_PERMS = { notes: true, drafts: true, maps: true, organize: true };
function cleanPerm(p) {
  if (p === 'read') return { notes: false, drafts: false, maps: false, organize: false };
  if (p === 'annotate') return { notes: true, drafts: false, maps: false, organize: false };
  if (!p || typeof p !== 'object') return { ...ALL_PERMS };
  const out = {};
  for (const k of PERM_KEYS) out[k] = p[k] === true;
  return out;
}
const COL_PERM = { highlight: 'notes', concept: 'notes', draft: 'drafts', map: 'maps', node: 'maps', edge: 'maps', ws: 'organize', group: 'organize', item: 'organize', book: 'organize', plan: 'organize', argument: 'organize', study: 'organize' };
// Toujours permis : curseurs, demandes d'état ou de fichiers, entrée/sortie d'un écrit, réponses.
const ALWAYS = new Set(['cur', 'hi', 'want', 'resync', 'flushed', 'fetch', 'files', 'room-join', 'room-leave']);
/**
 * Message d'un invité (enveloppe JSON + octets, format de src/features/collab/wire.ts) filtré selon ses
 * permissions : le message tel quel, réduit (enregistrements permis seulement), ou null (refusé).
 */
function permitted(perm, bytes) {
  if (PERM_KEYS.every((k) => perm[k])) return bytes;
  let head, n;
  try {
    n = bytes.readUInt32BE(0);
    if (n > bytes.length - 4 || n > 64 * 1024 * 1024) return null;
    head = JSON.parse(bytes.subarray(4, 4 + n).toString('utf8'));
  } catch {
    return null;
  }
  if (!head || typeof head.t !== 'string') return null;
  const t = head.t;
  if (ALWAYS.has(t)) return bytes;
  if (t === 'y') {
    // Protocole y-websocket : [0 = synchro, 0 = demande d'état | 1 = état | 2 = mise à jour] ou [1 = présence].
    // Sans « écrits » : demander l'état et montrer sa présence, jamais modifier l'écrit.
    if (perm.drafts) return bytes;
    const body = bytes.subarray(4 + n);
    if (body[0] === 1) return bytes;
    if (body[0] === 0 && body[1] === 0) return bytes;
    return null;
  }
  if (t === 'docx') return perm.drafts ? bytes : null;
  if (t === 'recs' && Array.isArray(head.recs)) {
    const recs = head.recs.filter((r) => r && COL_PERM[r.c] && perm[COL_PERM[r.c]]);
    if (!recs.length) return null;
    if (recs.length === head.recs.length) return bytes;
    const h = Buffer.from(JSON.stringify({ ...head, recs }), 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(h.length);
    return Buffer.concat([len, h, bytes.subarray(4 + n)]);
  }
  return null;
}

/** Nombre de places choisi par l'hôte (2 à 6, hôte compris). */
const clampPeople = (n) => Math.min(MAX_PEOPLE, Math.max(MIN_PEOPLE, Math.round(Number(n)) || MAX_PEOPLE));
const MAX_TRIES = 5;
const RETRY_WAIT_MS = 10 * 1000; // après un code faux ou introuvable : 10 s avant d'en essayer un autre
const REQUEST_TTL_MS = 2 * 60 * 1000;
const AWAY_GRACE_MS = 10 * 60 * 1000; // un invité coupé garde sa place 10 minutes
const RETRY_FOR_MS = 10 * 60 * 1000; // l'invité coupé réessaie 10 minutes
const PING_MS = 4000;
const DEAD_MS = 15000;
const FRAME = 1024 * 1024;
const PAD = 256;
const MAX_MESSAGE = 1024 * 1024 * 1024; // 1 Go : de l'hôte vers un invité (paquet initial avec les livres)
const MAX_GUEST_MESSAGE = 256 * 1024 * 1024; // 256 Mo : d'un invité vers l'hôte (un livre ajouté), gardé en mémoire puis relayé
const COLORS = ['#c2410c', '#1d4ed8', '#15803d', '#7e22ce', '#be123c', '#0f766e', '#a16207', '#4338ca'];

const MSG = {
  format: 'Le code doit compter 6 chiffres.',
  notFound: 'Aucune session trouvée avec ce code sur ce réseau. Vérifiez le code et que les deux ordinateurs sont sur le même Wi-Fi ; sinon, saisissez l’adresse affichée par l’hôte.',
  notFoundAnywhere: 'Aucune session trouvée avec ce code, ni sur ce réseau ni par Internet. Vérifiez le code auprès de l’hôte.',
  wait: (s) => `Patientez ${s} s avant d’essayer un autre code.`,
  badCode: (n) => `Code incorrect${n > 0 ? ` (encore ${n} essai${n > 1 ? 's' : ''})` : ''}.`,
  tries: 'Trop d’essais : ce code a été fermé par sécurité. Demandez un nouveau code à l’hôte.',
  full: (n = MAX_PEOPLE) => `Cet espace est complet (${n} personnes au plus) : réessayez quand quelqu’un sera parti, ou demandez à l’hôte d’ouvrir une place.`,
  locked: 'Marginalia est verrouillée sur l’ordinateur de l’hôte.',
  notLocal: 'Cette adresse n’est pas sur le réseau local : Marginalia ne passe jamais par Internet.',
  unreachable: 'L’ordinateur indiqué ne répond pas. Vérifiez l’adresse et que la session est toujours ouverte.',
  rejected: 'L’hôte a refusé votre demande.',
  noAnswer: 'L’hôte n’a pas répondu à temps : relancez la demande avec le code.',
  ticket: 'Cette demande n’est plus valable : relancez la recherche avec le code.',
  impostor: 'Réponse invalide : l’ordinateur trouvé ne connaît pas ce code.',
  closed: 'La session a été fermée par l’hôte.',
  cancelled: 'Demande annulée.',
  gone: 'La session n’existe plus, ou votre place a été libérée.',
};
const err = (code, message) => Object.assign(new Error(message), { code });

const cleanName = (s, d) =>
  String(s || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || d;
const cleanColor = (c, i = 0) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : COLORS[i % COLORS.length]);
const shortId = () => crypto.randomBytes(5).toString('hex');

// ── Clés de reconnexion (jeton aléatoire au lieu du code ; mêmes dérivations HKDF) ──
const tokenKeys = (token, salt) => ({ auth: H.hkdf(token, salt, 'mg-collab v1 resume auth'), mix: H.hkdf(token, salt, 'mg-collab v1 resume mix') });
/** Demande de reprise : preuve du jeton liée à l'invité et à l'heure (voir onResumeOpen). */
const resumeAsk = (tk, mid, ts) => H.hmac(tk.auth, 'resume-ask', Buffer.from(`${mid}|${ts}`, 'utf8'));
const RESUME_SKEW_MS = 15 * 60 * 1000; // horloges des deux ordinateurs

// ─────────────────────────────────────────────────────────────
// Canal chiffré sur une connexion TCP (après « Upgrade »).
// ─────────────────────────────────────────────────────────────
function u64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}
/**
 * @param {import('node:net').Socket} sock
 * @param {{ s2r: Buffer, r2s: Buffer }} keys
 * @param {'host' | 'guest'} role
 * @param {{ onMessage: (head: object, body: Buffer) => void, onClose: (why: string) => void }} h
 */
function makeChannel(sock, keys, role, h, head0) {
  const sendKey = role === 'host' ? keys.s2r : keys.r2s;
  const recvKey = role === 'host' ? keys.r2s : keys.s2r;
  const sendLabel = Buffer.from(role === 'host' ? 'H2G ' : 'G2H ', 'ascii');
  const recvLabel = Buffer.from(role === 'host' ? 'G2H ' : 'H2G ', 'ascii');
  // L'hôte reçoit des invités (plafond plus bas : il garde le message et le relaie à chacun).
  const maxMessage = role === 'host' ? MAX_GUEST_MESSAGE : MAX_MESSAGE;
  let sendSeq = 0;
  let recvSeq = 0;
  let queue = [];
  let queued = 0;
  let parts = [];
  let partsLen = 0;
  let closed = false;
  let lastSeen = Date.now();
  let lastSent = Date.now();
  sock.setNoDelay(true);
  sock.setKeepAlive(true, 5000);
  sock.setTimeout(0);

  const close = (why) => {
    if (closed) return;
    closed = true;
    clearInterval(beat);
    sock.destroy();
    h.onClose(why);
  };
  const writeFrame = (more, payload) => {
    const len = 5 + payload.length;
    const pt = Buffer.alloc(Math.ceil(len / PAD) * PAD);
    pt[0] = more ? 1 : 0;
    pt.writeUInt32BE(payload.length, 1);
    payload.copy(pt, 5);
    const seq = sendSeq++;
    const c = crypto.createCipheriv('aes-256-gcm', sendKey, Buffer.concat([sendLabel, u64(seq)]));
    c.setAAD(Buffer.concat([u64(seq), sendLabel]));
    const ct = Buffer.concat([c.update(pt), c.final()]);
    const lenB = Buffer.alloc(4);
    lenB.writeUInt32BE(ct.length);
    sock.write(Buffer.concat([lenB, ct, c.getAuthTag()]));
    lastSent = Date.now();
  };
  /** Envoie un message : enveloppe JSON + octets (facultatifs). */
  const send = (head, body) => {
    if (closed || sock.destroyed) return false;
    const hj = Buffer.from(JSON.stringify(head), 'utf8');
    const b = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength)) : Buffer.alloc(0);
    const hl = Buffer.alloc(4);
    hl.writeUInt32BE(hj.length);
    const all = Buffer.concat([hl, hj, b]);
    for (let off = 0; off < all.length || off === 0; off += FRAME) {
      const end = Math.min(off + FRAME, all.length);
      writeFrame(end < all.length, all.subarray(off, end));
      if (end >= all.length) break;
    }
    return true;
  };
  const onData = (chunk) => {
    if (closed) return;
    lastSeen = Date.now();
    queue.push(chunk);
    queued += chunk.length;
    try {
      while (queued >= 4) {
        const all = queue.length === 1 ? queue[0] : Buffer.concat(queue, queued);
        queue = [all];
        const n = all.readUInt32BE(0);
        if (n < PAD || n > FRAME + 2 * PAD || n % PAD) throw new Error('trame');
        if (queued < 4 + n + 16) return;
        const ct = all.subarray(4, 4 + n);
        const tag = all.subarray(4 + n, 4 + n + 16);
        const rest = all.subarray(4 + n + 16);
        queue = rest.length ? [rest] : [];
        queued = rest.length;
        const seq = recvSeq++;
        const d = crypto.createDecipheriv('aes-256-gcm', recvKey, Buffer.concat([recvLabel, u64(seq)]));
        d.setAAD(Buffer.concat([u64(seq), recvLabel]));
        d.setAuthTag(tag);
        const pt = Buffer.concat([d.update(ct), d.final()]); // lève si altéré
        const len = pt.readUInt32BE(1);
        if (len > pt.length - 5) throw new Error('longueur');
        parts.push(pt.subarray(5, 5 + len));
        partsLen += len;
        if (partsLen > maxMessage) throw new Error('message trop long');
        if (pt[0] & 1) continue;
        const msg = parts.length === 1 ? parts[0] : Buffer.concat(parts, partsLen);
        parts = [];
        partsLen = 0;
        const hl = msg.readUInt32BE(0);
        if (hl > msg.length - 4 || hl > 65536) throw new Error('enveloppe');
        const head = JSON.parse(msg.subarray(4, 4 + hl).toString('utf8'));
        if (!head || typeof head !== 'object' || typeof head.t !== 'string') throw new Error('enveloppe');
        if (head.t === 'ping') send({ t: 'pong' });
        else if (head.t !== 'pong') h.onMessage(head, msg.subarray(4 + hl));
      }
    } catch (e) {
      close('corrupt');
    }
  };
  sock.on('data', onData);
  sock.on('error', () => close('error'));
  sock.on('end', () => close('closed'));
  sock.on('close', () => close('closed'));
  const beat = setInterval(() => {
    const now = Date.now();
    if (now - lastSeen > DEAD_MS) return close('timeout');
    if (now - lastSent > PING_MS) send({ t: 'ping' });
  }, 1000);
  beat.unref?.();
  // Octets déjà lus avec la réponse « Upgrade » : traités après le retour (l'appelant garde le canal d'abord).
  if (head0 && head0.length) queueMicrotask(() => onData(head0));
  return {
    send,
    close: (why = 'closed') => close(why),
    get closed() {
      return closed;
    },
    /** Envoie puis ferme proprement (au plus tard après 1 s). */
    end: (head) => {
      if (closed) return;
      send(head);
      closed = true;
      clearInterval(beat);
      sock.end();
      setTimeout(() => sock.destroy(), 1000).unref?.();
      h.onClose('ended');
    },
  };
}

const HEAD = 'Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n';
function rawReply(sock, code, obj) {
  if (sock.destroyed) return;
  const body = JSON.stringify(obj);
  const text = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone', 423: 'Locked', 429: 'Too Many Requests', 503: 'Service Unavailable' }[code] || 'Error';
  sock.end(`HTTP/1.1 ${code} ${text}\r\n${HEAD}Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
}

// ─────────────────────────────────────────────────────────────
// Côté hôte
// ─────────────────────────────────────────────────────────────
/**
 * @param {object} o
 * @param {(evt: object) => void} o.emit  request, request-closed, attempt, code-closed, members, message, stopped
 * @param {() => boolean} [o.isLocked]
 * @param {(...a: any[]) => void} [o.diag]
 * @param {number} [o.port]  port TCP préféré (47804 ; 0 = libre)
 * @param {number} [o.udpPort]  port de découverte (47804)
 * @param {(addr: string) => boolean} [o.isLocal]
 * @param {object} [o.scrypt]  tests : coût réduit
 * @param {number} [o.awayMs]  tests : place gardée à un invité coupé
 * @param {ReturnType<import('./collab-iroh.cjs').createInternet>} [o.internet]  collaboration par Internet
 * @param {number} [o.waitMs]  tests : attente imposée après un code faux (10 s)
 */
function createCollabHost(o) {
  const diag = o.diag || (() => {});
  const isLocked = o.isLocked || (() => false);
  const isLocal = o.isLocal || isLocalAddress;
  const awayMs = o.awayMs || AWAY_GRACE_MS;
  let s = null;
  let starting = 0;

  const roster = (cur) => [
    { id: 'h', name: cur.profile.name, color: cur.profile.color, device: H.hostName(), host: true, state: 'live' },
    ...[...cur.members.values()].map((m) => ({ id: m.id, name: m.name, color: m.color, device: m.device, host: false, state: m.link ? 'live' : 'away' })),
  ];
  const people = (cur) => 1 + cur.members.size + [...cur.requests.values()].filter((r) => r.state === 'pending' || r.state === 'accepted').length;
  function pushMembers(cur) {
    const list = roster(cur);
    o.emit({ type: 'members', members: list, max: cur.max, perm: cur.perm });
    for (const m of cur.members.values()) m.link?.send({ t: 'members', members: list, max: cur.max, perm: cur.perm });
  }

  function closeRequest(cur, r, why) {
    if (!cur.requests.has(r.id)) return;
    cur.requests.delete(r.id);
    clearTimeout(r.timer);
    r.state = why;
    for (const w of r.waiters.splice(0)) w(why);
  }

  function offer(cur) {
    return { mg: 'collab!', v: 1, id: H.b64(cur.id), port: cur.port, salt: H.b64(cur.salt) };
  }

  function onUdp(cur, msg, rinfo) {
    if (s !== cur || !isLocal(rinfo.address) || msg.length > 256 || isLocked() || cur.codeState !== 'open') return;
    const now = Date.now();
    if (now - cur.udpWindow > 1000) {
      cur.udpWindow = now;
      cur.udpCount = 0;
    }
    if (++cur.udpCount > 30) return;
    let q;
    try {
      q = JSON.parse(msg.toString('utf8'));
    } catch {
      return;
    }
    if (!q || q.mg !== 'collab?' || q.v !== 1) return;
    cur.udp.send(JSON.stringify(offer(cur)), rinfo.port, rinfo.address, () => {});
  }

  async function onOpen(cur, req, res) {
    const q = await H.readJson(req);
    const n = H.unb64(q && q.n, 16);
    if (!q || q.id !== H.b64(cur.id) || !n) return H.json(res, 400, { error: 'request' });
    const hint = H.hintOf(cur.keys, cur.id, n);
    if (cur.codeState !== 'open') return H.json(res, 200, { state: cur.codeState, hint });
    const now = Date.now();
    for (const [k, h] of cur.handshakes) if (now - h.at > 60000 || cur.handshakes.size >= 32) cur.handshakes.delete(k);
    const hs = crypto.randomBytes(16);
    const challenge = crypto.randomBytes(32);
    const eph = H.x25519();
    cur.handshakes.set(H.b64(hs), { hs, challenge, eph, at: now });
    return H.json(res, 200, { state: 'open', hs: H.b64(hs), challenge: H.b64(challenge), eph: H.b64(eph.pub), hint });
  }

  async function onProve(cur, req, res) {
    const q = await H.readJson(req);
    if (cur.codeState !== 'open') return H.json(res, 429, { error: 'tries' });
    // Après un code faux, la même provenance attend 10 s avant d'essayer encore.
    const from = sourceOf(req.socket);
    const waitUntil = cur.waits.get(from) || 0;
    if (Date.now() < waitUntil) return H.json(res, 429, { error: 'wait', retryIn: Math.ceil((waitUntil - Date.now()) / 1000) });
    const h = q && typeof q.hs === 'string' ? cur.handshakes.get(q.hs) : null;
    const ephR = H.unb64(q && q.eph, 32);
    const proof = H.unb64(q && q.proof, 32);
    if (!h || !ephR || !proof) return H.json(res, 400, { error: 'handshake' });
    cur.handshakes.delete(q.hs);
    const T = H.transcript(Buffer.from('collab'), cur.id, cur.salt, h.challenge, h.eph.pub, ephR);
    const good = H.hmac(cur.keys.auth, 'proof', T);
    if (!crypto.timingSafeEqual(good, proof)) {
      cur.tries++;
      cur.waits.set(from, Date.now() + (o.waitMs ?? RETRY_WAIT_MS));
      if (cur.waits.size > 256) cur.waits.delete(cur.waits.keys().next().value);
      const remaining = MAX_TRIES - cur.tries;
      diag('collab', 'code faux', remaining);
      o.emit({ type: 'attempt', ok: false, remaining, at: Date.now() });
      if (remaining <= 0) {
        cur.codeState = 'tries';
        o.emit({ type: 'code-closed', reason: 'tries' });
        return H.json(res, 429, { error: 'tries' });
      }
      return H.json(res, 403, { error: 'bad-code', remaining });
    }
    let k, dev;
    try {
      k = H.sessionKeys(cur.keys, H.x25519Shared(h.eph.privateKey, ephR), T);
      dev = H.unseal(k.r2s, 'DEVN', q.dev);
    } catch {
      return H.json(res, 400, { error: 'handshake' });
    }
    if (people(cur) >= cur.max) return H.json(res, 409, { error: 'full', max: cur.max });
    const address = req.socket.mgInternet ? 'Internet' : String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const r = {
      id: shortId(),
      hs: q.hs,
      k,
      device: H.cleanDevice(dev && dev.device),
      name: cleanName(dev && dev.name, 'Invité'),
      color: cleanColor(dev && dev.color, cur.members.size + 1),
      address,
      state: 'pending',
      waiters: [],
      timer: null,
    };
    r.timer = setTimeout(() => {
      if (r.state === 'pending') {
        closeRequest(cur, r, 'no-answer');
        o.emit({ type: 'request-closed', reqId: r.id, reason: 'no-answer' });
      }
    }, REQUEST_TTL_MS);
    r.timer.unref?.();
    cur.requests.set(r.id, r);
    diag('collab', 'demande', address);
    r.wasRemoved = cur.removedWho.has(`${address}|${r.device}`);
    o.emit({ type: 'request', reqId: r.id, device: r.device, name: r.name, color: r.color, address, wasRemoved: r.wasRemoved, at: Date.now() });
    return H.json(res, 200, { box: H.seal(k.s2r, 'META', { meta: cur.meta, name: H.hostName(), host: cur.profile.name, people: people(cur) - 1 }) });
  }

  async function onResumeOpen(cur, req, res) {
    const q = await H.readJson(req);
    // L'invité prouve qu'il a son jeton de reconnexion (HMAC horodaté, jamais deux fois le même) avant
    // qu'un défi soit créé : sans jeton, toujours la même réponse (« gone »), et le défi d'un invité
    // coupé ne peut pas être écrasé par quelqu'un d'autre.
    const mid = q && typeof q.mid === 'string' ? q.mid : '';
    const ts = q && Number.isSafeInteger(q.ts) ? q.ts : 0;
    const ask = H.unb64(q && q.ask, 32);
    const gone = () => H.json(res, 410, { error: 'gone' });
    if (!mid || !ask || Math.abs(Date.now() - ts) > RESUME_SKEW_MS) return gone();
    const proves = (tk) => crypto.timingSafeEqual(resumeAsk(tk, mid, ts), ask);
    const m = cur.members.get(mid);
    if (!m) {
      const tk = cur.removed.get(mid);
      return tk && proves(tk) ? H.json(res, 410, { error: 'removed' }) : gone();
    }
    if (!proves(m.tk) || ts <= (m.lastAsk || 0)) return gone();
    m.lastAsk = ts;
    const hs = crypto.randomBytes(16);
    const challenge = crypto.randomBytes(32);
    const eph = H.x25519();
    m.resume = { hs: H.b64(hs), challenge, eph, at: Date.now() };
    return H.json(res, 200, { hs: H.b64(hs), challenge: H.b64(challenge), eph: H.b64(eph.pub) });
  }

  /** Connexion « Upgrade » : canal d'un invité accepté (ou qui revient). */
  async function onLink(cur, req, sock, head) {
    const url = new URL(req.url || '/', 'http://local');
    const hs = url.searchParams.get('hs') || '';
    const mid = url.searchParams.get('mid') || '';
    sock.on('error', () => {});
    if (mid) {
      // Reconnexion : preuve par le jeton, sans nouvel accord.
      const m = cur.members.get(mid);
      const rs = m && m.resume;
      const ephR = H.unb64(String(req.headers['x-mg-eph'] || ''), 32);
      const proof = H.unb64(String(req.headers['x-mg-proof'] || ''), 32);
      if (!m || !rs || rs.hs !== hs || Date.now() - rs.at > 60000 || !ephR || !proof) return rawReply(sock, 410, { error: 'gone' });
      m.resume = null;
      const T = H.transcript(Buffer.from('collab-resume'), cur.rid, cur.rsalt, Buffer.from(mid), rs.challenge, rs.eph.pub, ephR);
      if (!crypto.timingSafeEqual(H.hmac(m.tk.auth, 'resume', T), proof)) {
                return rawReply(sock, 403, { error: 'auth' });
      }
      let k;
      try {
        k = H.sessionKeys(m.tk, H.x25519Shared(rs.eph.privateKey, ephR), T);
      } catch {
        return rawReply(sock, 400, { error: 'handshake' });
      }
      if (m.link) m.link.close('replaced');
      clearTimeout(m.awayTimer);
      return openLink(cur, m, sock, k, head, true);
    }
    const r = [...cur.requests.values()].find((x) => x.hs === hs);
    const auth = H.unb64(String(req.headers['x-mg-auth'] || ''), 32);
    if (!r) return rawReply(sock, 404, { error: 'ticket' });
    if (!auth || !crypto.timingSafeEqual(auth, H.hmac(r.k.mac, 'link', Buffer.from(hs)))) return rawReply(sock, 403, { error: 'auth' });
    const verdict = r.state === 'pending' ? await new Promise((resolve) => r.waiters.push(resolve)) : r.state;
    if (s !== cur) return rawReply(sock, 410, { error: 'closed' });
    if (verdict !== 'accepted') {
      const codeOf = { rejected: 403, 'no-answer': 408, full: 409, closed: 410 };
      return rawReply(sock, codeOf[verdict] || 410, { error: verdict });
    }
    cur.requests.delete(r.id);
    clearTimeout(r.timer);
    const token = crypto.randomBytes(32);
    const m = { id: shortId(), name: r.name, color: r.color, device: r.device, address: r.address, token, tk: tokenKeys(token, cur.rsalt), link: null, awayTimer: null, resume: null };
    cur.members.set(m.id, m);
    return openLink(cur, m, sock, r.k, head, false);
  }

  function openLink(cur, m, sock, k, head, resumed) {
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: mg-collab\r\nConnection: Upgrade\r\n${HEAD}\r\n`);
    const link = makeChannel(
      sock,
      k,
      'host',
      {
        onMessage: (h, body) => {
          if (s !== cur || m.link !== link) return;
          if (h.t === 'app') route(cur, m.id, typeof h.to === 'string' ? h.to : 'h', body);
          else if (h.t === 'leave') {
            link.close('left');
          }
        },
        onClose: (why) => {
          if (m.link !== link) return;
          m.link = null;
          if (s !== cur) return;
          if (why === 'left') {
            cur.members.delete(m.id);
            diag('collab', 'départ', m.id);
          } else {
            diag('collab', 'invité coupé', m.id, why);
            m.awayTimer = setTimeout(() => {
              if (s === cur && !m.link && cur.members.get(m.id) === m) {
                cur.members.delete(m.id);
                pushMembers(cur);
              }
            }, awayMs);
            m.awayTimer.unref?.();
          }
          pushMembers(cur);
        },
      },
      head,
    );
    m.link = link;
    link.send({ t: 'hello', you: m.id, token: m.token.toString('base64url'), rid: cur.rid.toString('base64url'), rsalt: cur.rsalt.toString('base64url'), resumed, meta: cur.meta, members: roster(cur), max: cur.max, perm: cur.perm });
    diag('collab', resumed ? 'invité revenu' : 'invité accepté', m.id);
    pushMembers(cur);
  }

  /** Aiguillage : `to` = 'all' (tous sauf l'expéditeur), 'h' (l'hôte) ou l'id d'un invité. */
  function route(cur, from, to, body) {
    if (from !== 'h') {
      body = permitted(cur.perm, body);
      if (!body) return;
    }
    if (to === 'all' || to === 'h') o.emit({ type: 'message', from, bytes: body });
    for (const m of cur.members.values()) if (m.link && m.id !== from && (to === 'all' || to === m.id)) m.link.send({ t: 'app', from }, body);
  }

  /** Provenance d'une requête : adresse locale, ou identifiant iroh du pair (Internet). */
  const sourceOf = (sock) => (sock.mgInternet ? `iroh:${sock.mgInternet}` : String(sock.remoteAddress || ''));
  const allowed = (sock) => !!sock.mgInternet || isLocal(sock.remoteAddress);

  function handler(req, res) {
    const cur = s;
    if (!cur) return H.json(res, 503, { error: 'closed' });
    if (!allowed(req.socket)) {
      req.resume();
      return H.json(res, 403, { error: 'not-local' });
    }
    if (isLocked()) {
      req.resume();
      return H.json(res, 423, { error: 'locked' });
    }
    let url;
    try {
      url = new URL(req.url || '/', 'http://local');
    } catch {
      return H.json(res, 400, { error: 'request' });
    }
    const route = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : '';
    const run = (fn) =>
      fn(cur, req, res).catch((e) => {
        diag('collab', 'requête', route, e && e.message);
        H.json(res, 400, { error: 'request' });
      });
    if (req.method === 'GET' && route === 'hello') {
      req.resume();
      return H.json(res, 200, offer(cur));
    }
    if (req.method === 'POST' && route === 'open') return void run(onOpen);
    if (req.method === 'POST' && route === 'prove') return void run(onProve);
    if (req.method === 'POST' && route === 'resume') return void run(onResumeOpen);
    req.resume();
    return H.json(res, 404, { error: 'route' });
  }

  function onUpgrade(req, sock, head) {
    const cur = s;
    if (!cur || !allowed(req.socket)) return rawReply(sock, 403, { error: 'not-local' });
    if (isLocked()) return rawReply(sock, 423, { error: 'locked' });
    let url;
    try {
      url = new URL(req.url || '/', 'http://local');
    } catch {
      return rawReply(sock, 400, { error: 'request' });
    }
    if (url.pathname !== PREFIX + 'link' || String(req.headers.upgrade || '').toLowerCase() !== 'mg-collab') return rawReply(sock, 404, { error: 'route' });
    onLink(cur, req, sock, head).catch((e) => {
      diag('collab', 'lien', e && e.message);
      rawReply(sock, 400, { error: 'request' });
    });
  }

  async function newKeys(cur) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const salt = crypto.randomBytes(16);
    const t0 = Date.now();
    const keys = await H.codeKeys(code, salt, o.scrypt || share.SCRYPT);
    diag('collab', 'clé du code', `${Date.now() - t0} ms`);
    return { code, salt, keys };
  }

  /**
   * Ouvre la session (remplace la précédente).
   * @param {{ meta: object, profile: { name: string, color: string }, maxPeople?: number, perm?: string }} p
   */
  async function start({ meta, profile, maxPeople, perm }) {
    stop('replaced');
    const ticket = ++starting;
    const cleanMeta = JSON.parse(JSON.stringify(meta == null ? {} : meta));
    if (Buffer.byteLength(JSON.stringify(cleanMeta)) > 8192) throw err('meta', 'Description de la session trop longue.');
    const { code, salt, keys } = await newKeys(null);
    if (ticket !== starting) throw err('replaced', 'Session remplacée par une autre.');
    const server = http.createServer(handler);
    server.headersTimeout = 20000;
    server.requestTimeout = 0; // les connexions « Upgrade » durent
    server.keepAliveTimeout = 5000;
    const sockets = new Set();
    server.on('connection', (sock) => {
      sockets.add(sock);
      sock.on('close', () => sockets.delete(sock));
    });
    server.on('upgrade', onUpgrade);
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
      await listen(o.port ?? PORT);
    } catch {
      await listen(0);
    }
    const rid = crypto.randomBytes(12);
    const cur = {
      id: rid,
      /** Identité fixe de la session (jetons de reconnexion), même après un nouveau code. */
      rid,
      rsalt: salt,
      code,
      salt,
      keys,
      codeState: 'open',
      tries: 0,
      max: clampPeople(maxPeople ?? MAX_PEOPLE),
      perm: cleanPerm(perm),
      meta: cleanMeta,
      profile: { name: cleanName(profile && profile.name, 'Hôte'), color: cleanColor(profile && profile.color) },
      server,
      sockets,
      port: server.address().port,
      udp: null,
      udpWindow: 0,
      udpCount: 0,
      handshakes: new Map(),
      requests: new Map(),
      members: new Map(),
      removed: new Map(), // id retiré par l'hôte → clés de son jeton : la reconnexion lui est refusée
      removedWho: new Set(), // « adresse|appareil » retirés : une nouvelle demande est signalée
      waits: new Map(), // provenance → fin de l'attente après un code faux
      rv: [], // points d'accès Internet (un par code ; les anciens restent pour les reconnexions)
      internet: false,
    };
    try {
      const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      await new Promise((resolve, reject) => {
        udp.once('error', reject);
        udp.bind(o.udpPort ?? PORT, '0.0.0.0', () => {
          udp.off('error', reject);
          resolve();
        });
      });
      udp.on('error', (e) => diag('collab', 'découverte', e && e.message));
      udp.on('message', (msg, rinfo) => onUdp(cur, msg, rinfo));
      cur.udp = udp;
    } catch (e) {
      diag('collab', 'découverte indisponible', e && e.code);
    }
    if (ticket !== starting) {
      close(cur);
      throw err('replaced', 'Session remplacée par une autre.');
    }
    s = cur;
    diag('collab', 'session ouverte', cur.port);
    await openInternet(cur);
    return info();
  }

  /** Point d'accès Internet pour le code en cours (sans effet si le réglage est coupé ou le module absent). */
  async function openInternet(cur) {
    const net = o.internet;
    if (!net || !net.available()) {
      cur.internet = false;
      return;
    }
    const code = cur.code;
    try {
      const rv = await net.host(code, (sock) => {
        if (s === cur) cur.server.emit('connection', sock);
        else sock.destroy();
      });
      if (s !== cur) return void rv.close();
      cur.rv.push(rv);
      // Le code précédent reste joignable (reconnexion de ceux venus avec lui) ; les plus anciens non.
      while (cur.rv.length > 2) void cur.rv.shift().close();
      cur.internet = cur.code === code;
      diag('collab', 'internet : point d’accès ouvert');
    } catch (e) {
      cur.internet = false;
      diag('collab', 'internet indisponible', e && e.message);
    }
  }

  /** Nouveau code (après « Trop d’essais », ou à la demande) : les personnes présentes restent. */
  async function newCode() {
    const cur = s;
    if (!cur) return info();
    const { code, salt, keys } = await newKeys(cur);
    if (s !== cur) return info();
    // Les jetons de reconnexion restent liés à l'identité de la session (rid, rsalt), qui ne change pas.
    cur.code = code;
    cur.salt = salt;
    cur.keys = keys;
    cur.id = crypto.randomBytes(12);
    cur.tries = 0;
    cur.codeState = 'open';
    cur.handshakes.clear();
    cur.waits.clear();
    cur.internet = false;
    await openInternet(cur);
    return info();
  }

  function info() {
    if (!s) return { open: false };
    return {
      open: true,
      code: s.codeState === 'open' ? s.code : null,
      codeState: s.codeState,
      port: s.port,
      discovery: !!s.udp,
      internet: !!s.internet,
      maxPeople: s.max,
      perm: s.perm,
      addresses: lanAddresses().map((a) => `${a.address}:${s.port}`),
      members: roster(s),
      requests: [...s.requests.values()].filter((r) => r.state === 'pending').map((r) => ({ reqId: r.id, device: r.device, name: r.name, color: r.color, address: r.address, wasRemoved: !!r.wasRemoved })),
    };
  }

  function accept(reqId) {
    const cur = s;
    const r = cur && cur.requests.get(String(reqId));
    if (!r || r.state !== 'pending') return false;
    if (1 + cur.members.size >= cur.max) {
      closeRequest(cur, r, 'full');
      o.emit({ type: 'request-closed', reqId: r.id, reason: 'full' });
      return false;
    }
    // Une couleur par personne : si elle est déjà prise, l'invité reçoit la première couleur libre
    // (il l'apprend par la liste des présents à son arrivée).
    const taken = new Set([cur.profile.color, ...[...cur.members.values()].map((m) => m.color)]);
    if (taken.has(r.color)) r.color = COLORS.find((c) => !taken.has(c)) ?? r.color;
    r.state = 'accepted';
    clearTimeout(r.timer);
    for (const w of r.waiters.splice(0)) w('accepted');
    diag('collab', 'demande acceptée');
    return true;
  }
  function reject(reqId) {
    const cur = s;
    const r = cur && cur.requests.get(String(reqId));
    if (!r || r.state !== 'pending') return false;
    closeRequest(cur, r, 'rejected');
    diag('collab', 'demande refusée');
    return true;
  }

  /**
   * Retirer un invité : son canal est fermé (« removed »), sa place libérée, et son jeton ne permet plus
   * de revenir. Ce qu'il a déjà reçu reste chez lui ; pour revenir, il refait une demande.
   */
  function remove(mid) {
    const cur = s;
    const m = cur && cur.members.get(String(mid));
    if (!m) return false;
    cur.members.delete(m.id);
    cur.removed.set(m.id, m.tk);
    cur.removedWho.add(`${m.address}|${m.device}`);
    clearTimeout(m.awayTimer);
    m.resume = null;
    const link = m.link;
    m.link = null;
    if (link) link.end({ t: 'bye', reason: 'removed' });
    diag('collab', 'invité retiré', m.id);
    pushMembers(cur);
    return true;
  }

  /**
   * Nombre de places (2 à 6, hôte compris), changeable pendant la session : jamais moins que les présents.
   * Les demandes en trop sont refusées (« complet »).
   */
  function setMax(n) {
    const cur = s;
    if (!cur) return info();
    cur.max = Math.max(clampPeople(n), 1 + cur.members.size);
    for (const r of [...cur.requests.values()]) {
      if (r.state === 'pending' && people(cur) > cur.max) {
        closeRequest(cur, r, 'full');
        o.emit({ type: 'request-closed', reqId: r.id, reason: 'full' });
      }
    }
    pushMembers(cur);
    return info();
  }

  /** Permission des invités pour toute la session ; les invités l'apprennent aussitôt. */
  function setPerm(p) {
    const cur = s;
    if (!cur || !p || typeof p !== 'object') return info();
    cur.perm = cleanPerm(p);
    pushMembers(cur);
    return info();
  }

  /** Message de l'hôte (rendu) : à un invité, ou à tous ('all'). */
  function send(to, bytes) {
    const cur = s;
    if (!cur) return false;
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let n = 0;
    for (const m of cur.members.values()) if (m.link && (to === 'all' || to === m.id)) n += m.link.send({ t: 'app', from: 'h' }, body) ? 1 : 0;
    return n;
  }

  function close(cur, reason) {
    if (s === cur) s = null;
    for (const r of [...cur.requests.values()]) closeRequest(cur, r, 'closed');
    for (const m of cur.members.values()) {
      clearTimeout(m.awayTimer);
      if (m.link) m.link.end({ t: 'bye', reason: reason || 'closed' });
    }
    cur.members.clear();
    cur.handshakes.clear();
    try {
      cur.server.close();
    } catch {
      /* déjà fermé */
    }
    setTimeout(() => {
      for (const sock of cur.sockets) sock.destroy();
    }, 1200).unref?.();
    try {
      cur.udp?.close();
    } catch {
      /* déjà fermée */
    }
    for (const rv of cur.rv.splice(0)) void rv.close();
  }

  function stop(reason = 'closed') {
    starting++;
    if (!s) return;
    const cur = s;
    close(cur, reason);
    diag('collab', 'session arrêtée', reason);
    if (reason !== 'replaced') o.emit({ type: 'stopped', reason });
  }

  return { start, stop, info, accept, reject, remove, send, newCode, setMax, setPerm, isOpen: () => !!s };
}

// ─────────────────────────────────────────────────────────────
// Côté invité
// ─────────────────────────────────────────────────────────────
/**
 * @param {object} [o]
 * @param {(evt: object) => void} o.emit  link { state: connected | reconnecting | closed, reason }, hello, members, message
 * @param {(...a: any[]) => void} [o.diag]
 * @param {number} [o.udpPort]
 * @param {() => string[]} [o.targets]
 * @param {number} [o.discoverMs]
 * @param {object} [o.scrypt]
 * @param {number} [o.retryForMs]
 * @param {ReturnType<import('./collab-iroh.cjs').createInternet>} [o.internet]  collaboration par Internet
 * @param {number} [o.waitMs]  tests : attente après un code faux ou introuvable
 */
function createCollabGuest(o) {
  const diag = o.diag || (() => {});
  const tickets = new Map();
  const active = new Set();
  let generation = 0;
  let cur = null; // { address, port, via, id, salt, mid, token, link, state, retryTimer, until, blockedUntil }
  let waitUntil = 0; // après un code faux ou introuvable : pas de nouvel essai avant cette heure

  /**
   * Options de http.request vers l'hôte : TCP sur le réseau local, ou flux iroh (`via`, Internet).
   * @param {{ address: string, port: number, via?: { stream: () => Promise<import('node:stream').Duplex> } }} t
   */
  async function target(t, extra) {
    if (t.via) {
      const sock = await t.via.stream();
      return { ...extra, createConnection: () => sock };
    }
    if (!isLocalAddress(t.address)) throw err('not-local', MSG.notLocal);
    return { ...extra, host: t.address, port: t.port, agent: false };
  }

  async function call(method, t, path, { body, timeout = 10000 } = {}) {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const opts = await target(t, { path: PREFIX + path, method, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {} });
    return new Promise((resolve, reject) => {
      const req = http.request(opts, (res) => {
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
      });
      active.add(req);
      req.setTimeout(timeout, () => req.destroy(Object.assign(new Error('délai'), { code: 'ETIMEDOUT' })));
      req.on('error', (e) => {
        active.delete(req);
        reject(e);
      });
      req.end(payload || undefined);
    });
  }

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
      sock.destroy = finish;
      active.add(sock);
      sock.on('error', () => finish());
      sock.on('message', (msg, rinfo) => {
        if (!isLocalAddress(rinfo.address) || msg.length > 512) return;
        let r;
        try {
          r = JSON.parse(msg.toString('utf8'));
        } catch {
          return;
        }
        const id = H.unb64(r && r.id, 12);
        const salt = H.unb64(r && r.salt, 16);
        if (!r || r.mg !== 'collab!' || r.v !== 1 || !id || !salt || !Number.isInteger(r.port) || r.port <= 0 || r.port > 65535) return;
        found.set(`${rinfo.address}|${r.id}`, { address: rinfo.address, port: r.port, id, salt });
      });
      sock.bind(0, () => {
        try {
          sock.setBroadcast(true);
        } catch {
          /* saisie d'adresse possible */
        }
        const targets = o.targets ? o.targets() : share.broadcastTargets();
        const ask = Buffer.from(JSON.stringify({ mg: 'collab?', v: 1 }));
        const send = () => {
          if (done) return;
          for (const t of targets) sock.send(ask, o.udpPort ?? PORT, t, () => {});
        };
        send();
        timers.push(setTimeout(send, 400), setTimeout(send, 1000), setTimeout(finish, o.discoverMs ?? 2000));
      });
    });
  }

  /**
   * Cherche la session, prouve le code, envoie prénom / couleur / appareil (chiffrés). L'hôte voit la demande.
   * @returns {Promise<{ ticket: string, meta: object, from: { address: string, port: number, name: string, host: string }, people: number }>}
   */
  async function find(code, opts = {}) {
    const left = waitUntil - Date.now();
    if (left > 0) throw Object.assign(err('wait', MSG.wait(Math.ceil(left / 1000))), { retryIn: Math.ceil(left / 1000) });
    try {
      return await findNow(code, opts);
    } catch (e) {
      // Code faux, ou personne avec ce code : 10 s avant le prochain essai.
      if (e && ['bad-code', 'not-found', 'impostor', 'wait'].includes(e.code)) {
        const ms = e.code === 'wait' && e.retryIn ? e.retryIn * 1000 : o.waitMs ?? RETRY_WAIT_MS;
        waitUntil = Math.max(waitUntil, Date.now() + ms);
        e.retryIn = Math.ceil(ms / 1000);
      }
      throw e;
    }
  }

  /** Temps restant avant de pouvoir essayer un autre code (secondes, 0 : tout de suite). */
  const waitLeft = () => Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));

  /** Par Internet : point d'accès du code ; offre comme celle de la découverte locale, ou null. */
  async function internetOffer(code) {
    const net = o.internet;
    if (!net || !net.available()) return null;
    let via;
    try {
      via = await net.dial(code);
    } catch (e) {
      diag('collab', 'internet', e && e.message);
      return null;
    }
    if (!via) return null;
    try {
      const r = await call('GET', { via }, 'hello', { timeout: 8000 });
      const id = H.unb64(r.json && r.json.id, 12);
      const salt = H.unb64(r.json && r.json.salt, 16);
      if (r.status === 423) return { error: err('locked', MSG.locked) };
      if (r.status !== 200 || !id || !salt) return null;
      return { address: 'Internet', port: 0, via, id, salt, code };
    } catch (e) {
      diag('collab', 'internet : bonjour', e && (e.code || e.message));
      via.close();
      return null;
    }
  }

  async function findNow(code, { manualAddress, profile } = {}) {
    code = String(code ?? '').replace(/[\s-]/g, '');
    if (!/^\d{6}$/.test(code)) throw err('format', MSG.format);
    const gen = generation;
    let offers;
    let viaInternet = false;
    if (manualAddress) {
      let address, port;
      try {
        ({ address, port } = share.parseManualAddress(manualAddress));
      } catch (e) {
        throw e;
      }
      if (/:\d+\s*$/.test(String(manualAddress)) === false) port = PORT;
      if (!isLocalAddress(address)) throw err('not-local', MSG.notLocal);
      let r;
      try {
        r = await call('GET', { address, port }, 'hello', { timeout: 5000 });
      } catch (e) {
        if (e.code === 'not-local') throw e;
        throw err('unreachable', MSG.unreachable);
      }
      const id = H.unb64(r.json && r.json.id, 12);
      const salt = H.unb64(r.json && r.json.salt, 16);
      if (r.status === 423) throw err('locked', MSG.locked);
      if (r.status !== 200 || !id || !salt) throw err('unreachable', MSG.unreachable);
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
    if (gen !== generation) throw err('cancelled', MSG.cancelled);
    if (!offers.length) throw err('not-found', viaInternet ? MSG.notFoundAnywhere : MSG.notFound);
    const keyCache = new Map();
    const keysFor = (salt) => {
      const k = H.b64(salt);
      if (!keyCache.has(k)) keyCache.set(k, H.codeKeys(code, salt, o.scrypt || share.SCRYPT));
      return keyCache.get(k);
    };
    const opened = await Promise.all(
      offers.map(async (of) => {
        try {
          const keys = await keysFor(of.salt);
          const n = crypto.randomBytes(16);
          const r = await call('POST', of, 'open', { body: { id: H.b64(of.id), n: H.b64(n) } });
          if (r.status === 423) return { of, error: err('locked', MSG.locked) };
          if (r.status !== 200 || !r.json) return null;
          if (r.json.hint !== H.hintOf(keys, of.id, n)) return manualAddress ? { of, error: err('bad-code', MSG.badCode(0)) } : null;
          if (r.json.state === 'tries') return { of, error: err('tries', MSG.tries) };
          return { of, keys, open: r.json };
        } catch (e) {
          diag('collab', 'ouverture', of.address, e && e.message);
          return null;
        }
      }),
    );
    let lastErr = null;
    const rank = { impostor: 1, full: 2, locked: 3, wait: 4, 'bad-code': 4, tries: 5 };
    const keep = (e) => {
      if (!lastErr || (rank[e.code] || 0) >= (rank[lastErr.code] || 0)) lastErr = e;
    };
    for (const x of opened) {
      if (!x) continue;
      if (x.error) {
        keep(x.error);
        continue;
      }
      if (gen !== generation) throw err('cancelled', MSG.cancelled);
      const { of, keys, open } = x;
      const hs = typeof open.hs === 'string' ? open.hs : '';
      const challenge = H.unb64(open.challenge, 32);
      const ephS = H.unb64(open.eph, 32);
      if (!hs || !challenge || !ephS) continue;
      const eph = H.x25519();
      let k, proof;
      try {
        const T = H.transcript(Buffer.from('collab'), of.id, of.salt, challenge, ephS, eph.pub);
        k = H.sessionKeys(keys, H.x25519Shared(eph.privateKey, ephS), T);
        proof = H.hmac(keys.auth, 'proof', T);
      } catch {
        continue;
      }
      const dev = { device: H.cleanDevice(o.deviceName ? o.deviceName() : H.hostName()), name: cleanName(profile && profile.name, 'Invité'), color: cleanColor(profile && profile.color) };
      let r;
      try {
        r = await call('POST', of, 'prove', { body: { hs, eph: H.b64(eph.pub), proof: H.b64(proof), dev: H.seal(k.r2s, 'DEVN', dev) } });
      } catch (e) {
        diag('collab', 'preuve', e && e.message);
        continue;
      }
      const e2 = r.json && r.json.error;
      if (r.status === 403 && e2 === 'bad-code') keep(err('bad-code', MSG.badCode(Number(r.json.remaining) || 0)));
      else if (r.status === 429 && e2 === 'wait') keep(Object.assign(err('wait', MSG.wait(Number(r.json.retryIn) || 10)), { retryIn: Number(r.json.retryIn) || 10 }));
      else if (r.status === 429) keep(err('tries', MSG.tries));
      else if (r.status === 409 && e2 === 'full') keep(err('full', MSG.full(Number(r.json.max) || MAX_PEOPLE)));
      else if (r.status === 423) keep(err('locked', MSG.locked));
      else if (r.status === 200 && r.json && r.json.box) {
        let box;
        try {
          box = H.unseal(k.s2r, 'META', r.json.box);
        } catch {
          keep(err('impostor', MSG.impostor));
          continue;
        }
        const ticket = H.b64(crypto.randomBytes(12));
        tickets.clear();
        tickets.set(ticket, { address: of.address, port: of.port, via: of.via || null, code: of.code || null, id: of.id, salt: of.salt, hs, k, at: Date.now() });
        waitUntil = 0;
        return { ticket, meta: box.meta ?? {}, people: Number(box.people) || 1, from: { address: of.address, port: of.port, internet: !!of.via, name: H.cleanDevice(box.name), host: cleanName(box.host, 'Hôte') } };
      }
    }
    throw lastErr || err('not-found', MSG.notFound);
  }

  /** Connexion « Upgrade » vers l'hôte ; résout avec le socket et les octets déjà lus. */
  async function upgrade(t, path, headers, timeout) {
    const opts = await target(t, { path: PREFIX + path, method: 'GET', headers: { ...headers, Connection: 'Upgrade', Upgrade: 'mg-collab' } });
    return new Promise((resolve, reject) => {
      const req = http.request(opts);
      active.add(req);
      let settled = false;
      const done = (fn, v) => {
        if (settled) return;
        settled = true;
        active.delete(req);
        fn(v);
      };
      req.setTimeout(timeout, () => req.destroy(Object.assign(new Error('délai'), { code: 'ETIMEDOUT' })));
      req.on('upgrade', (res, sock, head) => {
        req.setTimeout(0);
        done(resolve, { sock, head });
      });
      req.on('response', (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.length < 16 && chunks.push(c));
        res.on('end', () => {
          let e = '';
          try {
            e = JSON.parse(Buffer.concat(chunks).toString('utf8')).error;
          } catch {
            /* sans détail */
          }
          done(reject, Object.assign(new Error(e || 'refus'), { code: e || 'closed', status: res.statusCode }));
        });
      });
      req.on('error', (e) => done(reject, e));
      req.end();
    });
  }

  function attach(sock, head, k) {
    const c = cur;
    const link = makeChannel(
      sock,
      k,
      'guest',
      {
        onMessage: (h, body) => {
          if (cur !== c || c.link !== link) return;
          if (h.t === 'hello') {
            c.mid = h.you;
            c.token = Buffer.from(String(h.token || ''), 'base64url');
            const rid = H.unb64(h.rid, 12);
            const rsalt = H.unb64(h.rsalt, 16);
            if (rid && rsalt) {
              c.id = rid;
              c.salt = rsalt;
            }
            c.state = 'live';
            o.emit({ type: 'hello', you: h.you, resumed: !!h.resumed, meta: h.meta, members: h.members, max: h.max, perm: h.perm });
            o.emit({ type: 'link', state: 'connected' });
            c.onHello?.(h);
          } else if (h.t === 'members') o.emit({ type: 'members', members: h.members, max: h.max, perm: h.perm });
          else if (h.t === 'app') o.emit({ type: 'message', from: typeof h.from === 'string' ? h.from : 'h', bytes: body });
          else if (h.t === 'bye') {
            c.byeReason = String(h.reason || 'closed');
          }
        },
        onClose: (why) => {
          if (cur !== c || c.link !== link) return;
          c.link = null;
          if (c.byeReason || why === 'ended') return end(c, c.byeReason === 'quit' || c.byeReason === 'closed' ? 'host-stopped' : c.byeReason || 'host-stopped');
          if (c.leaving) return end(c, 'left');
          if (!c.mid) return end(c, 'closed');
          diag('collab', 'lien perdu', why);
          if (c.via) c.viaDead = true;
          c.state = 'reconnecting';
          c.until = Date.now() + (o.retryForMs || RETRY_FOR_MS);
          o.emit({ type: 'link', state: 'reconnecting', reason: why });
          scheduleRetry(c, 800);
        },
      },
      head,
    );
    c.link = link;
  }

  function end(c, reason) {
    if (cur !== c) return;
    clearTimeout(c.retryTimer);
    cur = null;
    if (c.link) c.link.close('closed');
    if (c.via) setTimeout(() => c.via.close(), 1500).unref?.();
    o.emit({ type: 'link', state: 'closed', reason });
  }

  function scheduleRetry(c, ms) {
    clearTimeout(c.retryTimer);
    c.retryTimer = setTimeout(() => void retry(c), ms);
    c.retryTimer.unref?.();
  }

  async function retry(c) {
    if (cur !== c || c.link) return;
    if (Date.now() > c.until) return end(c, 'gone');
    if (c.blockedUntil && Date.now() < c.blockedUntil) return scheduleRetry(c, c.blockedUntil - Date.now() + 50);
    try {
      const tk = tokenKeys(c.token, c.salt);
      const ts = Math.max(Date.now(), (c.lastAsk || 0) + 1);
      c.lastAsk = ts;
      const r = await call('POST', c, 'resume', { body: { mid: c.mid, ts, ask: H.b64(resumeAsk(tk, c.mid, ts)) }, timeout: 4000 });
      if (cur !== c) return;
      if (r.status === 410 && r.json && r.json.error === 'removed') return end(c, 'removed');
      if (r.status === 410 || r.status === 503) return end(c, 'gone');
      if (r.status !== 200 || !r.json) throw new Error('reprise ' + r.status);
      const challenge = H.unb64(r.json.challenge, 32);
      const ephS = H.unb64(r.json.eph, 32);
      if (!challenge || !ephS || typeof r.json.hs !== 'string') throw new Error('reprise');
      const eph = H.x25519();
      const T = H.transcript(Buffer.from('collab-resume'), c.id, c.salt, Buffer.from(c.mid), challenge, ephS, eph.pub);
      const k = H.sessionKeys(tk, H.x25519Shared(eph.privateKey, ephS), T);
      const proof = H.hmac(tk.auth, 'resume', T);
      if (c.via && c.code && c.viaDead) {
        // Connexion Internet perdue : on retrouve l'hôte par le code d'origine (son point d'accès reste ouvert).
        const via = await o.internet.dial(c.code);
        if (!via) throw new Error('hôte introuvable');
        c.via = via;
        c.viaDead = false;
      }
      const { sock, head } = await upgrade(c, `link?hs=${encodeURIComponent(r.json.hs)}&mid=${encodeURIComponent(c.mid)}`, { 'x-mg-eph': H.b64(eph.pub), 'x-mg-proof': H.b64(proof) }, 8000);
      if (cur !== c) return sock.destroy();
      attach(sock, head, k);
    } catch (e) {
      if (cur !== c) return;
      if (e && (e.code === 'gone' || e.status === 410)) return end(c, 'gone');
      if (c.via) c.viaDead = true;
      diag('collab', 'reconnexion', e && (e.code || e.message));
      scheduleRetry(c, 2000);
    }
  }

  /**
   * Après find() : attend l'accord de l'hôte puis ouvre le canal. Résout au message de bienvenue.
   * @returns {Promise<{ you: string, meta: object, members: object[] }>}
   */
  function join(ticketId) {
    const t = tickets.get(String(ticketId));
    if (!t) return Promise.reject(err('ticket', MSG.ticket));
    tickets.delete(String(ticketId));
    leave();
    const c = { address: t.address, port: t.port, via: t.via, code: t.code, viaDead: false, id: t.id, salt: t.salt, mid: null, token: null, link: null, state: 'joining', retryTimer: null, until: 0, blockedUntil: 0, leaving: false, byeReason: null, onHello: null };
    cur = c;
    return new Promise((resolve, reject) => {
      c.onHello = (h) => {
        c.onHello = null;
        resolve({ you: h.you, meta: h.meta, members: h.members, max: h.max, perm: h.perm });
      };
      upgrade(t, `link?hs=${encodeURIComponent(t.hs)}`, { 'x-mg-auth': H.b64(H.hmac(t.k.mac, 'link', Buffer.from(t.hs))) }, REQUEST_TTL_MS + 30000)
        .then(({ sock, head }) => {
          if (cur !== c) {
            sock.destroy();
            return reject(err('cancelled', MSG.cancelled));
          }
          attach(sock, head, t.k);
          setTimeout(() => {
            if (c.onHello) {
              c.onHello = null;
              end(c, 'closed');
              reject(err('closed', MSG.closed));
            }
          }, 15000).unref?.();
        })
        .catch((e) => {
          diag('collab', 'lien refusé', e && (e.code || e.message));
          if (cur === c) cur = null;
          const map = { rejected: ['rejected', MSG.rejected], 'no-answer': ['no-answer', MSG.noAnswer], full: ['full', MSG.full()], ticket: ['ticket', MSG.ticket], locked: ['locked', MSG.locked] };
          const [code, m] = map[e && e.code] || (e && e.code === 'ECONNREFUSED' ? ['closed', MSG.closed] : e && e.code === 'cancelled' ? ['cancelled', MSG.cancelled] : ['closed', MSG.closed]);
          reject(err(code, m));
        });
    });
  }

  function send(to, bytes) {
    const c = cur;
    if (!c || !c.link) return false;
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return c.link.send({ t: 'app', to: typeof to === 'string' ? to : 'all' }, body);
  }

  /** Quitter la session (l'hôte libère la place). */
  function leave() {
    generation++;
    const c = cur;
    for (const r of [...active]) {
      try {
        r.destroy(err('cancelled', MSG.cancelled));
      } catch {
        /* déjà fermé */
      }
    }
    active.clear();
    if (!c) return;
    c.leaving = true;
    if (c.link) c.link.end({ t: 'leave' });
    else end(c, 'left');
  }

  /** Tests seulement : coupe le lien sans prévenir et empêche la reconnexion pendant `ms`. */
  function cut(ms) {
    const c = cur;
    if (!c || !c.link) return false;
    c.blockedUntil = Date.now() + Math.max(0, Number(ms) || 0);
    c.link.close('cut');
    return true;
  }

  return { find, join, send, leave, cut, waitLeft, state: () => (cur ? { state: cur.state, mid: cur.mid, connected: !!cur.link } : { state: 'none' }) };
}

module.exports = { createCollabHost, createCollabGuest, PORT, MAX_PEOPLE, MIN_PEOPLE, MSG, COLORS, permitted };
