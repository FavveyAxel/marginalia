// ─────────────────────────────────────────────────────────────
// Chiffrement des échanges par QR code (réception depuis le téléphone, envoi vers le téléphone).
//
// Pourquoi : la page du téléphone parle à l'ordinateur en HTTP clair, sur le Wi-Fi. Sur un réseau
// public, ou face à quelqu'un qui connaît le mot de passe du Wi-Fi, tout ce qui passe pourrait être lu.
// Désormais, tout ce qui a du sens (photos, documents, textes, noms de fichiers, titres, devenir des
// envois) voyage chiffré et authentifié.
//
// Clé : 256 bits aléatoires tirés par l'ordinateur à chaque session, placés UNIQUEMENT dans le
// fragment de l'adresse du QR code (« #k=… »). Le navigateur n'envoie jamais le fragment sur le
// réseau : seul celui qui a scanné le code (ou le lit sur l'écran) la connaît.
//
// Algorithme : secretbox de NaCl (XSalsa20-Poly1305), par TweetNaCl.js 1.0.3 (electron/nacl-fast.min.cjs,
// domaine public, audité par Cure53 en 2017 ; fichier nacl-fast.min.js du paquet npm tweetnacl@1.0.3,
// intégrité sha512-6rt+RN7aOi1nGMyC4Xa5DdYiukl2UWCbcJft7YhxReBGQD7OAM8Pbxw6YMo4r2diNEA8FEmu32YOn9rhaiE5yw==,
// copié tel quel : sha256 3ec535c004aeeb225785d8e93fb33bf99f52e399bd7dfc01969b5629baea5131 ; licence dans
// electron/nacl-LICENSE.txt ; copié dans electron/ car le processus principal empaqueté n'a pas de
// node_modules). Pas de crypto.subtle : sur une adresse http locale, la
// page du téléphone n'est pas un « contexte sécurisé » et le navigateur ne la fournit pas
// (Web Cryptography API : « [SecureContext] readonly attribute SubtleCrypto subtle » ;
// crypto.getRandomValues, lui, reste disponible et sert au tirage des identifiants).
//
// Ce même fichier sert des deux côtés : injecté dans les pages du téléphone (avec la bibliothèque,
// sous le nonce CSP, global « mgCrypt ») et chargé par le processus principal (require), pour que les
// deux bouts fabriquent les nonces exactement de la même façon.
//
// Nonces (24 octets, jamais deux fois les mêmes sous une même clé) :
//  - flux (fichier, texte) : identifiant aléatoire du flux (16 octets) | usage (1) | dernier (1) |
//    compteur de bloc (6, gros-boutiste). L'identifiant est tiré par celui qui chiffre (le téléphone
//    pour un envoi, l'ordinateur pour un document à télécharger) ; l'usage sépare le nom (META), les
//    blocs du téléphone (DATA) et ceux de l'ordinateur (SDATA) ; le dernier bloc est marqué, ce qui
//    rend une troncature détectable (construction « STREAM ») ; le compteur empêche de réordonner.
//  - messages (réponses de l'ordinateur, manifeste, vérification de clé) : 24 octets aléatoires,
//    transmis devant le message chiffré.
// Blocs : 1 Mio de clair, soit 1 Mio + 16 octets chiffrés (étiquette Poly1305) ; le dernier est plus
// court (au moins 16 octets : un fichier vide donne un bloc vide, marqué dernier).
//
// Limite (assumée, à connaître) : la page elle-même arrive en HTTP. Un espion qui se contente
// d'écouter ne peut rien lire ; un attaquant ACTIF capable de réécrire la page en transit (usurpation
// ARP…) pourrait y glisser un script qui lit la clé. Seul HTTPS avec un certificat reconnu par le
// téléphone l'empêcherait, ce qui demanderait un service tiers ou une installation sur le téléphone.
// ─────────────────────────────────────────────────────────────
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./nacl-fast.min.cjs'));
  else root.mgCrypt = factory(root.nacl);
})(typeof self !== 'undefined' ? self : this, function (nacl) {
  'use strict';
  var CHUNK = 1048576; // 1 Mio de clair par bloc
  var TAG = 16; // étiquette d'authentification (Poly1305)
  var META = 1; // nom du fichier, nature (téléphone → ordinateur)
  var DATA = 2; // blocs du téléphone
  var SDATA = 0x11; // blocs de l'ordinateur (document à télécharger)
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var REV = {};
  for (var r = 0; r < B64.length; r++) REV[B64.charAt(r)] = r;

  /** Octets → base64url sans remplissage. */
  function b64u(bytes) {
    var out = '';
    var i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64.charAt(n >>> 18) + B64.charAt((n >>> 12) & 63) + B64.charAt((n >>> 6) & 63) + B64.charAt(n & 63);
    }
    var rest = bytes.length - i;
    if (rest === 1) {
      var a = bytes[i] << 16;
      out += B64.charAt(a >>> 18) + B64.charAt((a >>> 12) & 63);
    } else if (rest === 2) {
      var b = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64.charAt(b >>> 18) + B64.charAt((b >>> 12) & 63) + B64.charAt((b >>> 6) & 63);
    }
    return out;
  }

  /** base64url → octets ; null si la chaîne n'en est pas une (caractère étranger, longueur impossible). */
  function unb64u(str) {
    if (typeof str !== 'string' || str.length % 4 === 1) return null;
    var len = Math.floor((str.length * 3) / 4);
    var out = new Uint8Array(len);
    var o = 0;
    var acc = 0;
    var bits = 0;
    for (var i = 0; i < str.length; i++) {
      var v = REV[str.charAt(i)];
      if (v === undefined) return null;
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[o++] = (acc >>> bits) & 255;
      }
    }
    return out;
  }

  var enc = new TextEncoder();
  var dec = new TextDecoder('utf-8', { fatal: true });
  var utf8 = function (s) {
    return enc.encode(String(s));
  };

  /** Nonce d'un bloc de flux (voir l'en-tête). */
  function streamNonce(id, use, last, counter) {
    var n = new Uint8Array(24);
    n.set(id, 0);
    n[16] = use;
    n[17] = last ? 1 : 0;
    // Compteur sur 48 bits (2^48 blocs d'1 Mio : bien au-delà de toute taille acceptée).
    var c = counter;
    for (var i = 23; i >= 18; i--) {
      n[i] = c % 256;
      c = Math.floor(c / 256);
    }
    return n;
  }

  /** Clé lue dans le fragment d'adresse (« #k=… », 43 caractères base64url = 256 bits). */
  function keyFromHash(hash) {
    var m = /(?:^#?|&)k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(String(hash || ''));
    if (!m) return null;
    var k = unb64u(m[1]);
    return k && k.length === 32 ? k : null;
  }

  /** Message chiffré (objet JSON) : base64url(nonce aléatoire | boîte). */
  function seal(key, obj) {
    var nonce = nacl.randomBytes(24);
    var box = nacl.secretbox(utf8(JSON.stringify(obj)), nonce, key);
    var out = new Uint8Array(24 + box.length);
    out.set(nonce, 0);
    out.set(box, 24);
    return b64u(out);
  }

  /** Message ouvert ; null si altéré, tronqué, chiffré avec une autre clé ou illisible. */
  function open(key, str) {
    var raw = unb64u(String(str || '').trim());
    if (!raw || raw.length < 24 + TAG || !key || key.length !== 32) return null;
    var plain = nacl.secretbox.open(raw.subarray(24), raw.subarray(0, 24), key);
    if (!plain) return null;
    try {
      return JSON.parse(dec.decode(plain));
    } catch (e) {
      return null;
    }
  }

  /** Nom et nature d'un envoi, liés à son identifiant de flux (nonce META). */
  function sealMeta(key, id, obj) {
    return b64u(nacl.secretbox(utf8(JSON.stringify(obj)), streamNonce(id, META, true, 0), key));
  }
  function openMeta(key, id, str) {
    var box = unb64u(String(str || ''));
    if (!box || box.length < TAG || box.length > 8192) return null;
    var plain = nacl.secretbox.open(box, streamNonce(id, META, true, 0), key);
    if (!plain) return null;
    try {
      return JSON.parse(dec.decode(plain));
    } catch (e) {
      return null;
    }
  }

  /** Nombre de blocs pour un clair de n octets (au moins un : le fichier vide a son bloc). */
  function frameCount(n) {
    return Math.max(1, Math.ceil(n / CHUNK));
  }
  /** Taille chiffrée d'un clair de n octets. */
  function cipherSize(n) {
    return n + frameCount(n) * TAG;
  }
  /**
   * Découpage d'un corps chiffré de `len` octets : nombre de blocs, taille du dernier.
   * null si aucune découpe n'est possible (dernier bloc plus court que l'étiquette).
   */
  function framesOf(len) {
    var full = CHUNK + TAG;
    if (!(len >= TAG)) return null;
    var whole = Math.floor(len / full);
    var rest = len - whole * full;
    if (rest === 0) return { count: whole, last: full };
    if (rest < TAG) return null;
    return { count: whole + 1, last: rest };
  }

  function sealFrame(key, id, use, index, last, plain) {
    return nacl.secretbox(plain, streamNonce(id, use, last, index), key);
  }
  function openFrame(key, id, use, index, last, box) {
    return nacl.secretbox.open(box, streamNonce(id, use, last, index), key);
  }

  return {
    CHUNK: CHUNK,
    TAG: TAG,
    META: META,
    DATA: DATA,
    SDATA: SDATA,
    b64u: b64u,
    unb64u: unb64u,
    utf8: utf8,
    keyFromHash: keyFromHash,
    seal: seal,
    open: open,
    sealMeta: sealMeta,
    openMeta: openMeta,
    frameCount: frameCount,
    cipherSize: cipherSize,
    framesOf: framesOf,
    sealFrame: sealFrame,
    openFrame: openFrame,
    randomBytes: function (n) {
      return nacl.randomBytes(n);
    },
  };
});
