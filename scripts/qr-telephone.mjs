// « Téléphone » des tests de l'échange par QR code (réception et envoi) : parle le protocole chiffré
// avec TweetNaCl directement (electron/nacl-fast.min.cjs, la bibliothèque des pages), SANS passer par
// electron/wifi-crypto.cjs : si l'ordinateur et la page se trompaient de la même façon (nonce, marque
// du dernier bloc…), ces tests le verraient. Fournit aussi un relais TCP qui garde tout le trafic,
// pour vérifier que rien d'intelligible ne passe sur le réseau.
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
export const nacl = require(path.join(ROOT, 'electron/nacl-fast.min.cjs'));
export const CHUNK = 1048576;

/** Clé lue dans le fragment de l'adresse du QR code (« #k=… »). */
export function keyOf(url) {
  const m = /#k=([A-Za-z0-9_-]{43})$/.exec(String(url));
  return m ? new Uint8Array(Buffer.from(m[1], 'base64url')) : null;
}

/** Nonce de flux : identifiant (16) | usage (1) | dernier (1) | compteur (6, gros-boutiste). */
export function nonce(id, use, last, counter) {
  const n = Buffer.alloc(24);
  Buffer.from(id).copy(n, 0);
  n[16] = use;
  n[17] = last ? 1 : 0;
  n.writeUIntBE(counter, 18, 6);
  return new Uint8Array(n);
}

/** Corps chiffré d'un envoi : blocs d'1 Mio, le dernier marqué (usage 2 = blocs du téléphone). */
export function encryptBody(key, id, bytes, use = 2) {
  const buf = Buffer.from(bytes);
  const count = Math.max(1, Math.ceil(buf.length / CHUNK));
  const out = [];
  for (let i = 0; i < count; i++) out.push(Buffer.from(nacl.secretbox(new Uint8Array(buf.subarray(i * CHUNK, (i + 1) * CHUNK)), nonce(id, use, i === count - 1, i), key)));
  return Buffer.concat(out);
}

/** Nom et nature de l'envoi, chiffrés (usage 1, bloc 0 marqué dernier). */
export function sealMeta(key, id, obj) {
  return Buffer.from(nacl.secretbox(new Uint8Array(Buffer.from(JSON.stringify(obj))), nonce(id, 1, true, 0), key)).toString('base64url');
}

/** Réponse de l'ordinateur : base64url(nonce | boîte) → objet, ou null. */
export function open(key, text) {
  try {
    const raw = Buffer.from(String(text).trim(), 'base64url');
    if (raw.length < 40) return null;
    const p = nacl.secretbox.open(new Uint8Array(raw.subarray(24)), new Uint8Array(raw.subarray(0, 24)), key);
    return p ? JSON.parse(Buffer.from(p).toString('utf8')) : null;
  } catch {
    return null;
  }
}

/** Document téléchargé : blocs chiffrés par l'ordinateur (usage 0x11) → clair, ou null si un bloc est refusé. */
export function decryptDownload(key, sid, buf) {
  const full = CHUNK + 16;
  const count = Math.max(1, Math.ceil(buf.length / full));
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = nacl.secretbox.open(new Uint8Array(buf.subarray(i * full, (i + 1) * full)), nonce(sid, 0x11, i === count - 1, i), key);
    if (!p) return null;
    out.push(Buffer.from(p));
  }
  return Buffer.concat(out);
}

/** Requête HTTP simple : { status, headers, body (texte), buf }. */
export function req(method, url, { body, headers = {} } = {}) {
  return new Promise((resolve) => {
    const r = http.request(url, { method, headers: { ...(body != null ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buf.toString('utf8'), buf });
      });
    });
    r.on('error', (e) => resolve({ status: 0, error: e.code || e.message }));
    if (body != null) r.write(body);
    r.end();
  });
}

/**
 * Envoi chiffré, comme la page : POST …/up?id=…&m=…, corps en blocs. Options : `meta` (au lieu de
 * { t, n }), `body` (corps déjà fabriqué, pour les altérations), `id` (identifiant imposé).
 */
export async function upload(base, key, { name, text, bytes, meta, body, id, headers } = {}) {
  id = id || nacl.randomBytes(16);
  const plain = text != null ? Buffer.from(text, 'utf8') : Buffer.from(bytes || []);
  const m = meta ? sealMeta(key, id, meta) : sealMeta(key, id, text != null ? { t: 'text' } : { t: 'file', n: name });
  const b = body || encryptBody(key, id, plain);
  const r = await req('POST', `${base}/up?id=${Buffer.from(id).toString('base64url')}&m=${m}`, {
    body: b,
    headers: { 'X-Marginalia': '1', 'Content-Type': 'application/octet-stream', ...(headers || {}) },
  });
  return { ...r, id, idTxt: Buffer.from(id).toString('base64url'), m, json: open(key, r.body), sent: b };
}

/**
 * Relais TCP (127.0.0.1:<port> → 127.0.0.1:<cible>) qui garde une copie de tout le trafic, dans les
 * deux sens : ce qu'un voisin du Wi-Fi verrait passer. `relay.alter = (octets, sens) => octets`
 * permet en plus de les modifier au passage (sens « up » : vers l'ordinateur, « down » : vers le
 * téléphone), comme le ferait un attaquant sur le réseau.
 */
export async function captureProxy(target) {
  const seen = [];
  const sockets = new Set();
  const self = { alter: null };
  const server = net.createServer((c) => {
    const up = net.connect(target(), '127.0.0.1');
    sockets.add(c);
    sockets.add(up);
    c.on('data', (d) => {
      if (self.alter) d = self.alter(Buffer.from(d), 'up');
      seen.push(Buffer.from(d));
      up.write(d);
    });
    up.on('data', (d) => {
      if (self.alter) d = self.alter(Buffer.from(d), 'down');
      seen.push(Buffer.from(d));
      c.write(d);
    });
    const end = () => {
      c.destroy();
      up.destroy();
    };
    c.on('close', end);
    up.on('close', end);
    c.on('error', end);
    up.on('error', end);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return Object.assign(self, {
    port: server.address().port,
    traffic: () => Buffer.concat(seen),
    reset: () => (seen.length = 0),
    close: () => {
      for (const s of sockets) s.destroy();
      return new Promise((r) => server.close(r));
    },
  });
}

/** Le trafic contient-il ce texte (UTF-8, et aussi encodé pour une adresse) ou ces octets (6 au moins) ? */
export function leaks(traffic, needles) {
  const found = [];
  for (const n of needles) {
    // Une aiguille trop courte se trouverait par hasard dans des Mo d'octets chiffrés.
    if (n == null || n.length < 6) continue;
    if (typeof n === 'string') {
      const forms = [n, encodeURIComponent(n), n.normalize('NFD')];
      if (forms.some((f) => traffic.includes(Buffer.from(f, 'utf8')))) found.push(n);
    } else if (traffic.includes(n)) found.push(`<${n.length} octets>`);
  }
  return found;
}
