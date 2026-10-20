// ─────────────────────────────────────────────────────────────
// « Travailler à plusieurs » par Internet : transport iroh (n0-computer/iroh, QUIC pair à pair).
//
// Ce module ne fait que TRANSPORTER : il fournit des flux d'octets entre l'hôte et un invité, sur
// lesquels collab-net.cjs fait passer exactement le même protocole qu'en réseau local (poignée de main
// par le code, accord de l'hôte, canal AES-256-GCM). Rien n'est lu ici.
//
// Rendez-vous : l'hôte ouvre un « point d'accès » iroh dont la clé est tirée du code à 6 chiffres
// (scrypt, N = 2^17, sel fixe propre à Marginalia). L'invité qui a le même code calcule la même clé
// publique et s'y connecte : l'annuaire public de n0 (DNS / pkarr) donne l'adresse, la connexion est
// directe quand c'est possible (perçage de NAT), sinon elle passe par un relais public de n0 (HTTPS 443).
// Aucun serveur à nous, aucun compte.
//
// Ce qu'un intermédiaire voit : les adresses IP, l'identifiant du point d'accès, les horaires et les
// volumes. Le contenu est chiffré deux fois (TLS de QUIC, puis le canal de collab-net).
// Limites : le code n'a que 10^6 valeurs ; quelqu'un qui calcule les 10^6 clés (coûteux : scrypt) peut
// savoir qu'une session est ouverte et trouver l'adresse IP de l'hôte. Il ne peut pas entrer sans
// l'accord de l'hôte, et 5 codes faux ferment le code (comme en réseau local).
//
// Module natif : electron/native/<mac|win|linux>-<arch>/iroh.node dans l'app empaquetée (récupéré par
// scripts/fetch-iroh.mjs), sinon le paquet @number0/iroh (développement). Absent (Mac Intel, par
// exemple) : pas de collaboration par Internet, le réseau local fonctionne comme avant.
// ─────────────────────────────────────────────────────────────
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { Duplex } = require('node:stream');

// Deux usages, séparés : « collab » (travailler à plusieurs) et « share » (envoyer une copie). Clé et
// protocole (ALPN) différents : un code d'envoi ne mène jamais à une session, ni l'inverse.
const alpnOf = (kind) => Array.from(Buffer.from(`mg-${kind}/1`, 'utf8'));
const saltOf = (kind) => Buffer.from(`marginalia ${kind} internet v1`, 'utf8');
const ALPN = alpnOf('collab');
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const CHUNK = 64 * 1024;

let lib;
let loadError = null;
/** Le module natif iroh, ou null (avec la raison dans loadError). */
function load() {
  if (lib !== undefined) return lib;
  const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform] || process.platform;
  const tries = [path.join(__dirname, 'native', `${os}-${process.arch}`, 'iroh.node'), '@number0/iroh'];
  for (const t of tries) {
    try {
      lib = require(t);
      loadError = null;
      return lib;
    } catch (e) {
      loadError = e;
    }
  }
  lib = null;
  return lib;
}

/** Clé secrète du point d'accès (32 octets) tirée du code. */
function secretFor(code, cost = SCRYPT, kind = 'collab') {
  return new Promise((resolve, reject) => {
    crypto.scrypt(Buffer.from(String(code), 'utf8'), saltOf(kind), 32, cost, (err, k) => (err ? reject(err) : resolve(k)));
  });
}

/**
 * Flux iroh (BiStream) présenté comme un socket : http.Server et makeChannel s'en servent tel quel.
 * `remote` : identifiant iroh du pair (texte).
 */
class IrohSocket extends Duplex {
  constructor(bi, remote) {
    super({ allowHalfOpen: true });
    this.bi = bi;
    this.mgInternet = remote;
    this.remoteAddress = 'internet';
    this.remotePort = 0;
    this.localAddress = 'internet';
    this.encrypted = false;
    this.pumping = false;
    this.wake = null;
  }
  _read() {
    if (this.wake) {
      const w = this.wake;
      this.wake = null;
      w();
    }
    if (this.pumping) return;
    this.pumping = true;
    (async () => {
      try {
        for (;;) {
          const c = await this.bi.recv.read(CHUNK);
          if (this.destroyed) return;
          if (!c || !c.length) {
            this.push(null);
            return;
          }
          if (!this.push(Buffer.from(c))) await new Promise((r) => (this.wake = r));
        }
      } catch (e) {
        if (!this.destroyed) this.push(null);
      }
    })();
  }
  _write(chunk, _enc, cb) {
    (async () => {
      for (let off = 0; off < chunk.length; off += CHUNK) await this.bi.send.writeAll(Array.from(chunk.subarray(off, off + CHUNK)));
    })().then(
      () => cb(),
      (e) => cb(e),
    );
  }
  _final(cb) {
    this.bi.send.finish().then(
      () => cb(),
      () => cb(),
    );
  }
  _destroy(err, cb) {
    this.bi.send.reset(0n).catch(() => {});
    this.bi.recv.stop(0n).catch(() => {});
    cb(err);
  }
  // Ce que http et makeChannel appellent sur un net.Socket : sans objet ici (QUIC s'en charge).
  setNoDelay() {
    return this;
  }
  setKeepAlive() {
    return this;
  }
  setTimeout(_ms, cb) {
    if (cb) this.once('timeout', cb);
    return this;
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
  address() {
    return {};
  }
}

const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(what), { code: 'ETIMEDOUT' })), ms).unref?.())]);

/**
 * @param {object} [o]
 * @param {(...a: any[]) => void} [o.diag]
 * @param {object} [o.scrypt]  tests : coût réduit
 * @param {boolean} [o.local]  tests : sans annuaire ni relais (127.0.0.1)
 * @param {Map<string, any>} [o.registry]  tests : annuaire en mémoire (identifiant → EndpointAddr) à la place de celui de n0
 * @param {string} [o.registryFile]  tests de bout en bout : annuaire dans un fichier JSON partagé par les processus
 * @param {number} [o.dialMs]
 */
function createInternet(o = {}) {
  const diag = o.diag || (() => {});
  let enabled = true;

  async function bind(secret, kind = 'collab') {
    const L = load();
    const b = L.Endpoint.builder();
    if (o.local) {
      L.presetMinimal(b);
      b.bindAddr('127.0.0.1:0');
    } else L.presetN0(b);
    if (secret) b.secretKey(Array.from(secret));
    b.alpns([alpnOf(kind)]);
    return b.bind();
  }
  const closeEp = (ep) => withTimeout(ep.close(), 3000, 'fermeture').catch(() => {});

  /**
   * Hôte : ouvre le point d'accès du code ; chaque flux entrant est remis à `onSocket`.
   * `refuseNew()` : plus de nouvelles connexions (code expiré), celles en cours continuent.
   * @returns {Promise<{ id: string, addr: () => any, refuseNew: () => void, close: () => Promise<void> }>}
   */
  async function host(code, onSocket, kind = 'collab') {
    const secret = await secretFor(code, o.scrypt, kind);
    const ep = await bind(secret, kind);
    secret.fill(0);
    if (o.registry) o.registry.set(ep.id().toString(), ep.addr());
    if (o.registryFile) fileRegistry(ep.id().toString(), ep.addr().directAddresses());
    let closed = false;
    let refusing = false;
    const conns = new Set();
    (async () => {
      while (!closed) {
        let inc;
        try {
          inc = await ep.acceptNext();
        } catch {
          break;
        }
        if (!inc) break;
        if (refusing) {
          inc.refuse().catch(() => {});
          continue;
        }
        (async () => {
          try {
            const conn = await (await inc.accept()).connect();
            conns.add(conn);
            const remote = conn.remoteId().toString();
            diag(kind === 'share' ? 'partage' : 'collab', 'internet : pair connecté', remote.slice(0, 10));
            for (;;) {
              const bi = await conn.acceptBi();
              onSocket(new IrohSocket(bi, remote));
            }
          } catch {
            /* connexion terminée */
          }
        })();
      }
    })();
    return {
      id: ep.id().toString(),
      addr: () => ep.addr(),
      refuseNew: () => {
        refusing = true;
        if (o.registry) o.registry.delete(ep.id().toString());
      },
      close: async () => {
        closed = true;
        if (o.registry) o.registry.delete(ep.id().toString());
        await closeEp(ep);
      },
    };
  }

  /** Annuaire de test partagé entre processus : lecture, ou ajout d'une entrée. */
  function fileRegistry(id, addrs) {
    const fs = require('node:fs');
    let all = {};
    try {
      all = JSON.parse(fs.readFileSync(o.registryFile, 'utf8'));
    } catch {
      /* vide */
    }
    if (id) {
      all[id] = addrs;
      fs.writeFileSync(o.registryFile, JSON.stringify(all));
    }
    return all;
  }

  let guestEp = null;
  /** Invité : se connecte au point d'accès du code. Résout avec de quoi ouvrir des flux, ou null (personne). */
  async function dial(code, kind = 'collab') {
    const L = load();
    const secret = await secretFor(code, o.scrypt, kind);
    const id = L.SecretKey.fromBytes(Array.from(secret)).public();
    secret.fill(0);
    if (!guestEp || guestEp.isClosed()) guestEp = await bind(null);
    let target;
    if (o.registry) target = o.registry.get(id.toString());
    else if (o.registryFile) {
      const addrs = fileRegistry()[id.toString()];
      target = addrs ? new L.EndpointAddr(id, null, addrs) : null;
    } else target = new L.EndpointAddr(id);
    if (!target) return null;
    let conn;
    try {
      conn = await withTimeout(guestEp.connect(target, alpnOf(kind)), o.dialMs ?? 12000, 'personne');
    } catch (e) {
      diag('collab', 'internet : introuvable', e && (e.code || e.message));
      return null;
    }
    const remote = conn.remoteId().toString();
    return {
      remote,
      stream: async () => new IrohSocket(await withTimeout(conn.openBi(), 10000, 'flux'), remote),
      close: () => {
        try {
          conn.close(0n, []);
        } catch {
          /* déjà fermée */
        }
      },
    };
  }

  return {
    /** Le module natif est-il là, et la collaboration par Internet permise (réglage) ? */
    available: () => enabled && !!load(),
    supported: () => !!load(),
    reason: () => (load() ? null : 'Collaboration par Internet indisponible sur cet ordinateur.'),
    setEnabled: (v) => {
      enabled = !!v;
    },
    host,
    dial,
    async shutdown() {
      if (guestEp) await closeEp(guestEp);
      guestEp = null;
    },
    get loadError() {
      return loadError;
    },
  };
}

module.exports = { createInternet, secretFor, IrohSocket, ALPN };
