// Marginalia — espaces chiffrés (processus principal uniquement).
//
// Un espace de travail peut être chiffré à part du reste : son contenu (écrits, plans, cartes, groupes,
// livres, extraits et notes qui ne sont que dans cet espace) n'existe alors en clair que pendant qu'il
// est déverrouillé. Verrouillé, il n'est ni dans la mémoire de l'interface, ni lisible sur le disque,
// même quand Marginalia est ouverte.
//
// Clés :
//   • SK : clé maîtresse des espaces (256 bits, aléatoire), jamais écrite en clair. Un seul mot de passe,
//     commun à tous les espaces chiffrés, la protège (scrypt, comme le verrouillage de l'app), ainsi
//     qu'une clé de secours et, sur Mac, Touch ID (trousseau du système). Enveloppes dans spaces.json.
//   • clé d'un espace = HKDF-SHA-256(SK, « marginalia:space: » + id de l'espace) : le contenu d'un espace
//     ne s'ouvre pas avec la clé d'un autre, et un fichier ne peut pas être déplacé d'un espace à l'autre.
//
// Sur le disque :
//   • la « capsule » d'un espace : ses données (JSON compressé) chiffrées, rangées DANS la base
//     (db.json › sealedSpaces › id), écrite d'un seul tenant avec le reste : sauvegardes, restauration et
//     chiffrement global de l'app s'appliquent sans rien changer ;
//   • ses fichiers (library/<id>/…) : MGLSPC2\0 (8) | marque de l'espace (8) | IV (12) | AES-256-GCM |
//     étiquette (16). L'en-tête (avec la marque) ET l'emplacement du fichier (« id/nom ») sont
//     authentifiés : un fichier scellé ne peut pas être mis à la place d'un autre. Les fichiers écrits
//     par la 3.59 (MGLSPC1, sans l'emplacement) restent lisibles.
'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const vault = require('./vault.cjs');

const MAGIC = Buffer.from('MGLSPC1\0', 'latin1');
const MAGIC2 = Buffer.from('MGLSPC2\0', 'latin1'); // fichiers : emplacement authentifié
const MARK_LEN = 8;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEAD_LEN = MAGIC.length + MARK_LEN + IV_LEN;
const MAX_CAPSULE = 1024 * 1024 * 1024; // 1 Go décompressé

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const isSpaceId = (id) => typeof id === 'string' && SAFE_ID.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);

function spaceKey(sk, wsId) {
  return Buffer.from(crypto.hkdfSync('sha256', sk, Buffer.alloc(0), Buffer.from('marginalia:space:' + wsId, 'utf8'), 32));
}
/** Marque publique d'un espace dans l'en-tête de ses fichiers (ne révèle ni la clé ni l'id). */
function markOf(sk, wsId) {
  return crypto.createHmac('sha256', sk).update('marginalia:space-mark:' + wsId).digest().subarray(0, MARK_LEN);
}

const hasMagic = (buf, m) => !!buf && buf.length >= HEAD_LEN + TAG_LEN && Buffer.compare(buf.subarray(0, m.length), m) === 0;
function isSealed(buf) {
  return hasMagic(buf, MAGIC) || hasMagic(buf, MAGIC2);
}
const markIn = (buf) => buf.subarray(MAGIC.length, MAGIC.length + MARK_LEN);

/** `ctx` (fichiers : « id/nom ») : authentifié avec l'en-tête, format MGLSPC2 ; absent : MGLSPC1 (capsules). */
function seal(sk, wsId, plain, ctx) {
  const key = spaceKey(sk, wsId);
  try {
    const head = Buffer.concat([ctx === undefined ? MAGIC : MAGIC2, markOf(sk, wsId)]);
    const iv = crypto.randomBytes(IV_LEN);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
    c.setAAD(ctx === undefined ? head : Buffer.concat([head, Buffer.from(String(ctx), 'utf8')]));
    const body = [c.update(plain), c.final()];
    return Buffer.concat([head, iv, ...body, c.getAuthTag()]);
  } finally {
    key.fill(0);
  }
}

/** `ctx` : emplacement attendu du fichier ; exigé pour un MGLSPC2, ignoré pour un MGLSPC1 (3.59). */
function open(sk, wsId, buf, ctx) {
  if (!isSealed(buf)) throw new Error('Fichier d’espace chiffré invalide');
  const v2 = hasMagic(buf, MAGIC2);
  const bad = () => {
    const e = new Error('Fichier d’espace chiffré illisible (autre espace, autre clé ou fichier endommagé)');
    e.code = 'MG_BADKEY';
    return e;
  };
  if (!crypto.timingSafeEqual(markIn(buf), markOf(sk, wsId))) throw bad();
  const key = spaceKey(sk, wsId);
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(MAGIC.length + MARK_LEN, HEAD_LEN), { authTagLength: TAG_LEN });
    const head = buf.subarray(0, MAGIC.length + MARK_LEN);
    d.setAAD(v2 ? Buffer.concat([head, Buffer.from(String(ctx === undefined ? '' : ctx), 'utf8')]) : head);
    d.setAuthTag(buf.subarray(buf.length - TAG_LEN));
    return Buffer.concat([d.update(buf.subarray(HEAD_LEN, buf.length - TAG_LEN)), d.final()]);
  } catch {
    throw bad();
  } finally {
    key.fill(0);
  }
}

/** Espace auquel appartient un fichier scellé, parmi `wsIds` (null : aucun). */
function ownerOf(sk, buf, wsIds) {
  if (!isSealed(buf)) return null;
  const m = markIn(buf);
  for (const id of wsIds) if (crypto.timingSafeEqual(m, markOf(sk, id))) return id;
  return null;
}

// ── Capsule d'un espace (dans la base) ──
function sealCapsule(sk, wsId, json) {
  return seal(sk, wsId, zlib.deflateRawSync(Buffer.from(String(json), 'utf8'), { level: 6 })).toString('base64');
}
function openCapsule(sk, wsId, b64) {
  const plain = open(sk, wsId, Buffer.from(String(b64 || ''), 'base64'));
  return zlib.inflateRawSync(plain, { maxOutputLength: MAX_CAPSULE }).toString('utf8');
}

// ── Fichier de clés (spaces.json) ──
async function createKeystore(password) {
  const sk = crypto.randomBytes(32);
  const recoveryKey = vault.newRecoveryKey();
  const ks = {
    v: 1,
    keyId: vault.keyId(sk),
    createdAt: new Date().toISOString(),
    password: await vault.wrapWithPassword(password, sk),
    recovery: vault.wrapWithRecovery(recoveryKey, sk),
    system: null, // Touch ID : SK protégée par le trousseau du système (posée par main.cjs)
  };
  return { ks, sk, recoveryKey };
}
const validKeystore = (ks) => !!ks && ks.v === 1 && typeof ks.keyId === 'string' && !!ks.password && ks.password.kdf === 'scrypt' && !!ks.recovery;

/** SK rendue par le mot de passe ou la clé de secours ; null sinon. */
async function unlock(ks, secret) {
  if (!validKeystore(ks) || typeof secret !== 'string' || !secret) return null;
  let sk = null;
  if (vault.looksLikeRecoveryKey(secret)) sk = vault.unwrapWithRecovery(secret, ks.recovery);
  if (!sk) sk = await vault.unwrapWithPassword(secret, ks.password);
  if (!sk) return null;
  if (sk.length !== 32 || vault.keyId(sk) !== ks.keyId) {
    sk.fill(0);
    return null;
  }
  return sk;
}
async function rewrapPassword(ks, sk, password) {
  return { ...ks, password: await vault.wrapWithPassword(password, sk) };
}
function rewrapRecovery(ks, sk) {
  const recoveryKey = vault.newRecoveryKey();
  return { ks: { ...ks, recovery: vault.wrapWithRecovery(recoveryKey, sk) }, recoveryKey };
}

const isLegacyFile = (buf) => hasMagic(buf, MAGIC);
module.exports = { MAGIC, MAGIC2, isLegacyFile, isSpaceId, isSealed, seal, open, ownerOf, sealCapsule, openCapsule, createKeystore, validKeystore, unlock, rewrapPassword, rewrapRecovery, spaceKey, markOf };
