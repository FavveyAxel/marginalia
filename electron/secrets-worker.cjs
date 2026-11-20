// Marginalia — processus des secrets (utilityProcess, éphémère).
//
// Pourquoi un processus à part : une chaîne JavaScript ne s'efface pas, et tout ce qui passe par le
// processus principal (messages IPC, tampons de Chromium) y reste jusqu'à ce que la mémoire soit
// réutilisée, c'est-à-dire, en pratique, jusqu'à la fermeture de l'app. Ce processus-ci, lui, MEURT :
// à chaque verrouillage d'un espace (et au verrouillage de l'app), le processus principal le termine,
// et tout ce qu'il a vu disparaît avec lui. Il tient :
//   • les secrets saisis dans l'interface (mot de passe, clé de secours), déposés par le rendu sur un
//     canal direct (MessagePort) que le processus principal a seulement mis en relation : celui-ci ne
//     reçoit que des « poignées » opaques, jamais le secret ;
//   • la clé maîtresse des espaces (SK), tant qu'un espace est déverrouillé ;
//   • le contenu en clair des espaces : capsules et fichiers ouverts ou scellés ici, puis rendus au
//     rendu par le même canal direct. Le processus principal ne voit que du chiffré.
// Le processus principal garde toutes les décisions (quel espace est ouvert, à qui appartient un
// fichier, délais après des essais manqués) : il ne demande ici que des opérations précises. Le rendu,
// lui, ne peut que déposer un secret ou un contenu (et recevoir une poignée), et retirer ce que le
// processus principal a préparé pour lui (poignée de « retrait », transmise par le processus principal).
'use strict';

const crypto = require('node:crypto');
const vault = require('./vault.cjs');
const spacesKit = require('./spaces.cjs');

const parent = process.parentPort;
let sk = null; // clé maîtresse des espaces, tant qu'un espace est ouvert
const deposits = new Map(); // poignée → secret ou contenu déposé par le rendu (chaîne ou octets)
const reveals = new Map(); // poignée → ce que le rendu viendra retirer (chaîne ou octets)
const MAX_HANDLES = 512;

const newHandle = () => crypto.randomBytes(18).toString('base64url');
const isBytes = (v) => v instanceof Uint8Array;
const asBuffer = (v) => (Buffer.isBuffer(v) ? v : isBytes(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : v instanceof ArrayBuffer ? Buffer.from(v) : Buffer.from(String(v == null ? '' : v), 'utf8'));
const wipe = (v) => {
  if (isBytes(v)) v.fill(0);
};
/**
 * Octets à envoyer (au processus principal ou au rendu) : copie EXACTE, dans un ArrayBuffer à elle.
 * Un message copie tout l'ArrayBuffer sous un Buffer, et les petits Buffer de Node partagent une réserve
 * de 8 Ko (où voisinent clé maîtresse, mot de passe, contenu…) : envoyer le Buffer lui-même enverrait
 * toute la réserve. L'original est effacé.
 */
function exact(b) {
  const u = new Uint8Array(b.byteLength);
  u.set(b);
  wipe(b);
  return u;
}
function expired() {
  const e = new Error('Saisie expirée : recommencez.');
  e.code = 'MG_EXPIRED';
  return e;
}
function take(map, h) {
  if (typeof h !== 'string' || !map.has(h)) throw expired();
  const v = map.get(h);
  map.delete(h);
  return v;
}
function peek(map, h) {
  if (typeof h !== 'string' || !map.has(h)) throw expired();
  return map.get(h);
}
const takeText = (h) => {
  const v = take(deposits, h);
  if (typeof v === 'string') return v;
  const s = asBuffer(v).toString('utf8');
  wipe(v);
  return s;
};
const takeBytes = (h) => {
  const v = take(deposits, h);
  return typeof v === 'string' ? Buffer.from(v, 'utf8') : asBuffer(v);
};
function putReveal(v) {
  if (reveals.size >= MAX_HANDLES) throw new Error('Trop de contenus en attente.');
  const h = newHandle();
  reveals.set(h, v);
  return h;
}
function needSk() {
  if (!sk) {
    const e = new Error('Cet espace est verrouillé : déverrouillez-le pour accéder à son contenu.');
    e.code = 'MG_SPACE_LOCKED';
    throw e;
  }
  return sk;
}
function keepSk(k) {
  if (sk && sk !== k) sk.fill(0);
  sk = k;
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const listOf = (set) => [...set];
const ctxOf = (c) => (typeof c === 'string' ? c : undefined);

function checkNew(pw) {
  try {
    vault.checkNewPassword(pw);
    return null;
  } catch (e) {
    return e.message;
  }
}

// ── Opérations demandées par le processus principal ──
const ops = {
  forget() {
    if (sk) sk.fill(0);
    sk = null;
    return true;
  },
  counts() {
    return { deposits: deposits.size, reveals: reveals.size, sk: !!sk };
  },
  // Vérification d'un nouveau mot de passe (longueur), sans le consommer.
  checkNew({ h }) {
    const v = peek(deposits, h);
    const err = checkNew(typeof v === 'string' ? v : asBuffer(v).toString('utf8'));
    return err ? { ok: false, error: err } : { ok: true };
  },
  // Fin d'une opération : ce qu'elle n'a pas consommé est jeté.
  drop({ hs }) {
    for (const h of Array.isArray(hs) ? hs : []) {
      const v = deposits.get(h);
      deposits.delete(h);
      wipe(v);
    }
    return true;
  },

  // ── Espaces chiffrés : clé maîtresse ──
  async spUnlock({ h, ks }) {
    const k = await spacesKit.unlock(ks, takeText(h));
    if (!k) return { ok: false };
    keepSk(k);
    return { ok: true };
  },
  async spVerify({ h, ks }) {
    const k = await spacesKit.unlock(ks, takeText(h));
    if (!k) return { ok: false };
    k.fill(0);
    return { ok: true };
  },
  async spSetup({ h }) {
    const pw = takeText(h);
    const err = checkNew(pw);
    if (err) return { ok: false, error: err };
    const made = await spacesKit.createKeystore(pw);
    keepSk(made.sk);
    return { ok: true, ks: made.ks, rh: putReveal(made.recoveryKey) };
  },
  async spChangePassword({ h, hNew, ks }) {
    const k = await spacesKit.unlock(ks, takeText(h));
    if (!k) return { ok: false };
    try {
      return { ok: true, ks: await spacesKit.rewrapPassword(ks, k, takeText(hNew)) };
    } finally {
      if (k !== sk) k.fill(0);
    }
  },
  async spNewRecovery({ h, ks }) {
    const k = await spacesKit.unlock(ks, takeText(h));
    if (!k) return { ok: false };
    try {
      const r = spacesKit.rewrapRecovery(ks, k);
      return { ok: true, ks: r.ks, rh: putReveal(r.recoveryKey) };
    } finally {
      if (k !== sk) k.fill(0);
    }
  },
  /** Touch ID (macOS) : la clé doit passer par le trousseau du système, que seul le processus principal atteint. */
  async spExport({ h, ks }) {
    if (h === undefined) return { ok: true, sk: exact(Buffer.from(needSk())) };
    const k = await spacesKit.unlock(ks, takeText(h));
    return k ? { ok: true, sk: exact(k) } : { ok: false };
  },
  spAdopt({ sk: k }) {
    const b = Buffer.from(asBuffer(k));
    wipe(k);
    if (b.length !== 32) throw new Error('Clé inattendue');
    keepSk(b);
    return true;
  },

  // ── Capsules ──
  spOpenCapsule({ wsId, blob }) {
    const bytes = spacesKit.openCapsuleBytes(needSk(), wsId, blob);
    const json = bytes.toString('utf8');
    const parsed = JSON.parse(json); // lève : capsule illisible
    const hash = sha256(bytes);
    bytes.fill(0);
    return { hash, ids: listOf(spacesKit.capsuleIds(parsed)), fileIds: listOf(spacesKit.capsuleFileOwners(parsed)), rh: putReveal(json) };
  },
  spSealCapsule({ wsId, h }) {
    const k = needSk();
    const bytes = takeBytes(h);
    try {
      const capsule = JSON.parse(bytes.toString('utf8'));
      if (!capsule || typeof capsule !== 'object' || Array.isArray(capsule)) throw new Error('Espace invalide');
      return { hash: sha256(bytes), blob: spacesKit.sealCapsule(k, wsId, bytes), ids: listOf(spacesKit.capsuleIds(capsule)), fileIds: listOf(spacesKit.capsuleFileOwners(capsule)) };
    } finally {
      bytes.fill(0);
    }
  },

  // ── Fichiers d'un espace ──
  spOwnerOf({ head, wsIds }) {
    return spacesKit.ownerOf(needSk(), asBuffer(head), Array.isArray(wsIds) ? wsIds : []);
  },
  /** Fichier ouvert pour le rendu (retrait par poignée) ; `toMain` : fichier qui QUITTE l'espace (redevient commun). */
  spOpenFile({ wsId, buf, ctx, toMain }) {
    const plain = spacesKit.open(needSk(), wsId, asBuffer(buf), ctxOf(ctx));
    if (toMain) return exact(plain);
    return { rh: putReveal(plain) };
  },
  /** Scelle un contenu déposé par le rendu (`h`) ou confié par le processus principal (`buf` : contenu qui ENTRE dans l'espace). */
  spSealFile({ wsId, h, buf, ctx }) {
    const plain = h !== undefined ? takeBytes(h) : asBuffer(buf);
    try {
      return exact(spacesKit.seal(needSk(), wsId, plain, ctxOf(ctx)));
    } finally {
      plain.fill(0);
    }
  },
  spTransferFile({ from, to, buf, ctx }) {
    const k = needSk();
    const plain = spacesKit.open(k, from, asBuffer(buf), ctxOf(ctx));
    try {
      return exact(spacesKit.seal(k, to, plain, ctxOf(ctx)));
    } finally {
      plain.fill(0);
    }
  },
  /** Contenu déposé pour un fichier qui n'appartient finalement à aucun espace (commun). */
  spTake({ h }) {
    return exact(takeBytes(h));
  },

  // ── Verrouillage de l'app (vault.cjs) ──
  async vUnwrap({ h, w, recovery, idOnly }) {
    const s = takeText(h);
    let k = null;
    if (recovery) {
      if (!vault.looksLikeRecoveryKey(s)) return { ok: false, notRecovery: true };
      k = vault.unwrapWithRecovery(s, w);
    } else k = await vault.unwrapWithPassword(s, w);
    if (!k) return { ok: false };
    const keyId = vault.keyId(k);
    if (idOnly) {
      k.fill(0);
      return { ok: true, keyId };
    }
    return { ok: true, keyId, key: exact(k) };
  },
  async vWrap({ h, key }) {
    const pw = takeText(h);
    const err = checkNew(pw);
    if (err) return { ok: false, error: err };
    const k = Buffer.from(asBuffer(key));
    wipe(key);
    try {
      return { ok: true, envelope: await vault.wrapWithPassword(pw, k) };
    } finally {
      k.fill(0);
    }
  },
};

// ── Canal direct avec le rendu : dépôt et retrait seulement ──
function serveRenderer(port) {
  port.on('message', (e) => {
    const m = e.data || {};
    const reply = (r) => {
      try {
        port.postMessage({ id: m.id, ...r });
      } catch {
        /* rendu parti */
      }
    };
    try {
      if (m.op === 'deposit') {
        if (deposits.size >= MAX_HANDLES) throw new Error('Trop de saisies en attente.');
        const v = m.v;
        if (typeof v !== 'string' && !isBytes(v) && !(v instanceof ArrayBuffer)) throw new Error('Saisie invalide');
        const h = newHandle();
        deposits.set(h, v instanceof ArrayBuffer ? new Uint8Array(v) : v);
        // Le processus principal ne termine pas ce processus tant qu'une saisie attend d'être utilisée
        // (prévenu AVANT que le rendu ait la poignée, donc avant qu'il puisse s'en servir).
        parent.postMessage({ evt: 'deposits', deposits: deposits.size });
        reply({ ok: true, v: h });
      } else if (m.op === 'reveal') {
        const v = take(reveals, m.h);
        reply({ ok: true, v: typeof v === 'string' ? v : exact(v) });
        parent.postMessage({ evt: 'reveals', reveals: reveals.size });
      } else throw new Error('Opération inconnue');
    } catch (err) {
      reply({ ok: false, error: String((err && err.message) || err) });
    }
  });
  port.start();
}

// ── Passage de la clé maîtresse au processus suivant (un espace se verrouille, d'autres restent ouverts) ──
// Les deux processus des secrets se parlent directement : la clé ne passe pas par le processus principal.
function handoffOut(port) {
  return new Promise((resolve) => {
    port.on('message', () => {
      if (sk) sk.fill(0);
      sk = null;
      resolve(true);
    });
    port.start();
    port.postMessage({ sk: sk ? new Uint8Array(sk) : null });
  });
}
function handoffIn(port) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('passage de la clé : délai dépassé')), 10000);
    port.on('message', (e) => {
      clearTimeout(t);
      const k = e.data && e.data.sk;
      if (k && k.length === 32) keepSk(Buffer.from(k));
      wipe(k);
      port.postMessage({ ok: true });
      resolve(!!sk);
    });
    port.start();
  });
}

parent.on('message', async (e) => {
  const m = e.data || {};
  if (m.op === 'port') {
    if (e.ports && e.ports[0]) serveRenderer(e.ports[0]);
    return;
  }
  const reply = (r) => parent.postMessage({ id: m.id, reveals: reveals.size, deposits: deposits.size, ...r });
  try {
    let r;
    if (m.op === 'handoffOut') r = await handoffOut(e.ports[0]);
    else if (m.op === 'handoffIn') r = await handoffIn(e.ports[0]);
    else {
      const fn = Object.prototype.hasOwnProperty.call(ops, m.op) ? ops[m.op] : null;
      if (!fn) throw new Error('Opération inconnue');
      r = await fn(m.args && typeof m.args === 'object' ? m.args : {});
    }
    reply({ ok: true, r });
  } catch (err) {
    reply({ ok: false, error: String((err && err.message) || err), code: err && err.code });
  }
});
