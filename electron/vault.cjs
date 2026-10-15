// Marginalia — chiffrement local des données (processus principal uniquement).
//
// Format d'un fichier chiffré (« enveloppe ») :
//   MGLENC1\0 (8 octets) | IV (12 octets, aléatoire à chaque écriture) | données AES-256-GCM | étiquette (16 octets)
// L'en-tête sert de données authentifiées : un fichier modifié ou tronqué est refusé. Un fichier qui ne
// commence pas par l'en-tête est lu tel quel (fichier en clair) : les deux formats cohabitent pendant
// une migration, qui peut donc être interrompue et reprise sans rien perdre.
//
// Clés :
//   • DEK : clé de données aléatoire (256 bits), jamais écrite en clair sur le disque ;
//   • « enveloppes » de la DEK dans keystore.json : par le trousseau du système (safeStorage), par le mot
//     de passe (scrypt N=2^17, r=8, p=1, sel aléatoire) et par la clé de secours (160 bits aléatoires,
//     HKDF-SHA-256). Chaque enveloppe est un AES-256-GCM de la DEK.
//   • keyId : empreinte HMAC de la DEK (vérifie qu'une clé déchiffrée est la bonne, reconnaît une archive).
'use strict';

const crypto = require('node:crypto');

const MAGIC = Buffer.from('MGLENC1\0', 'latin1');
const IV_LEN = 12;
const TAG_LEN = 16;
const HEAD_LEN = MAGIC.length + IV_LEN;

/** Paramètres scrypt du mot de passe (≈ 128 Mo de mémoire, quelques dixièmes de seconde). */
const SCRYPT = { N: 2 ** 17, r: 8, p: 1 };
const SCRYPT_MAXMEM = 512 * 1024 * 1024;

class LockedError extends Error {
  constructor(message = 'Marginalia est verrouillé : déverrouillez-le pour accéder à vos données.') {
    super(message);
    this.code = 'MG_LOCKED';
  }
}

function isSealed(buf) {
  return !!buf && buf.length >= HEAD_LEN + TAG_LEN && Buffer.compare(buf.subarray(0, MAGIC.length), MAGIC) === 0;
}

function seal(key, plain) {
  const iv = crypto.randomBytes(IV_LEN);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(MAGIC);
  const body = [c.update(plain), c.final()];
  return Buffer.concat([MAGIC, iv, ...body, c.getAuthTag()]);
}

function open(key, buf) {
  if (!isSealed(buf)) throw new Error('Fichier chiffré invalide');
  const iv = buf.subarray(MAGIC.length, HEAD_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(MAGIC);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(buf.subarray(HEAD_LEN, buf.length - TAG_LEN)), d.final()]);
  } catch {
    const e = new Error('Fichier chiffré illisible (clé différente ou fichier endommagé)');
    e.code = 'MG_BADKEY';
    throw e;
  }
}

// ── Enveloppes de clé ───────────────────────────────────────
const b64 = (b) => Buffer.from(b).toString('base64');
const unb64 = (s) => Buffer.from(String(s || ''), 'base64');

function wrapKey(kek, dek, extra = {}) {
  const iv = crypto.randomBytes(IV_LEN);
  const c = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const ct = Buffer.concat([c.update(dek), c.final()]);
  return { ...extra, iv: b64(iv), ct: b64(ct), tag: b64(c.getAuthTag()) };
}
function unwrapKey(kek, w) {
  const d = crypto.createDecipheriv('aes-256-gcm', kek, unb64(w.iv));
  d.setAuthTag(unb64(w.tag));
  return Buffer.concat([d.update(unb64(w.ct)), d.final()]); // lève si la clé est fausse
}

function keyId(dek) {
  return crypto.createHmac('sha256', dek).update('marginalia:key-id').digest('hex').slice(0, 24);
}

function scryptAsync(password, salt, params) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(String(password).normalize('NFC'), salt, 32, { ...params, maxmem: SCRYPT_MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

async function wrapWithPassword(password, dek) {
  const salt = crypto.randomBytes(16);
  const kek = await scryptAsync(password, salt, SCRYPT);
  try {
    return wrapKey(kek, dek, { kdf: 'scrypt', ...SCRYPT, salt: b64(salt) });
  } finally {
    kek.fill(0);
  }
}
/** DEK protégée par le mot de passe, ou null si le mot de passe est faux. */
async function unwrapWithPassword(password, w) {
  if (!w || w.kdf !== 'scrypt') return null;
  const kek = await scryptAsync(password, unb64(w.salt), { N: w.N, r: w.r, p: w.p });
  try {
    return unwrapKey(kek, w);
  } catch {
    return null;
  } finally {
    kek.fill(0);
  }
}

// ── Clé de secours ──────────────────────────────────────────
// 32 caractères Crockford base32 (160 bits), affichés en 8 groupes de 4 : « 7K3M-QX2P-… ».
// Saisie tolérante : minuscules, espaces, tirets, O → 0, I/L → 1.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function newRecoveryKey() {
  const raw = crypto.randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of raw) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g).join('-');
}
function normalizeRecoveryKey(input) {
  const s = String(input || '')
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
  if (s.length !== 32 || [...s].some((ch) => !B32.includes(ch))) return null;
  return s;
}
function looksLikeRecoveryKey(input) {
  return normalizeRecoveryKey(input) !== null;
}
function recoveryKek(normalized, salt) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(normalized, 'ascii'), salt, Buffer.from('marginalia:recovery'), 32));
}
function wrapWithRecovery(recoveryKey, dek) {
  const n = normalizeRecoveryKey(recoveryKey);
  if (!n) throw new Error('Clé de secours invalide');
  const salt = crypto.randomBytes(16);
  const kek = recoveryKek(n, salt);
  try {
    return wrapKey(kek, dek, { kdf: 'hkdf-sha256', salt: b64(salt) });
  } finally {
    kek.fill(0);
  }
}
function unwrapWithRecovery(recoveryKey, w) {
  const n = normalizeRecoveryKey(recoveryKey);
  if (!n || !w) return null;
  const kek = recoveryKek(n, unb64(w.salt));
  try {
    return unwrapKey(kek, w);
  } catch {
    return null;
  } finally {
    kek.fill(0);
  }
}

// ── Lignes du journal de diagnostic ─────────────────────────
const LINE_PREFIX = 'ENC1:';
const sealLine = (key, line) => LINE_PREFIX + seal(key, Buffer.from(line, 'utf8')).toString('base64');
const isSealedLine = (line) => line.startsWith(LINE_PREFIX);
const openLine = (key, line) => open(key, Buffer.from(line.slice(LINE_PREFIX.length), 'base64')).toString('utf8');

function newDek() {
  return crypto.randomBytes(32);
}
function wipe(buf) {
  if (Buffer.isBuffer(buf)) buf.fill(0);
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();

module.exports = {
  MAGIC,
  LockedError,
  isSealed,
  seal,
  open,
  wrapKey,
  unwrapKey,
  keyId,
  wrapWithPassword,
  unwrapWithPassword,
  newRecoveryKey,
  normalizeRecoveryKey,
  looksLikeRecoveryKey,
  wrapWithRecovery,
  unwrapWithRecovery,
  sealLine,
  openLine,
  isSealedLine,
  newDek,
  wipe,
  sha256,
  b64,
  unb64,
};
