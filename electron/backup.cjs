// Marginalia — archives .zip des sauvegardes complètes (base + fichiers de la bibliothèque).
//
// Lecteur et écrivain ZIP minimaux, sans dépendance (le processus principal empaqueté n'a pas de
// node_modules) : compression « deflate » de zlib, CRC-32 en JS, noms en UTF-8. Pas de ZIP64 :
// au-delà de 4 Go, l'écriture échoue avec un message clair (sur Mac, l'outil système `zip`, qui gère
// ZIP64, est utilisé à la place ; voir main.cjs).
// L'extraction refuse tout nom absolu, toute remontée (« .. »), les liens symboliques et les noms
// réservés : rien ne peut sortir du dossier de destination.
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const deflateRaw = promisify(zlib.deflateRaw);
const inflateRaw = promisify(zlib.inflateRaw);

// ── CRC-32 ──────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf, prev = 0) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf, prev) >>> 0; // Node ≥ 22.2
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const LIMIT = 0xffffffff;

/** Nom d'entrée sûr : relatif, séparateurs « / », sans « . » ni « .. », sans caractère de contrôle. */
function safeEntryName(name) {
  if (typeof name !== 'string' || !name || name.length > 1024) return null;
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n) || /[\u0000-\u001f]/.test(n)) return null;
  const parts = n.split('/').filter((p, i, a) => !(p === '' && i === a.length - 1)); // « dossier/ » final toléré
  if (!parts.length || parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  return parts.join('/');
}

/**
 * Écrit une archive. `entries` : [{ name, file }] (fichier sur le disque) ou [{ name, data }] (Buffer).
 * Écriture dans `outFile` directement (l'appelant écrit dans un fichier temporaire puis renomme).
 */
async function writeZip(outFile, entries) {
  const fh = await fsp.open(outFile, 'w');
  const central = [];
  let offset = 0;
  const write = async (buf) => {
    await fh.write(buf, 0, buf.length, offset);
    offset += buf.length;
    if (offset > LIMIT) throw new Error('Sauvegarde trop volumineuse pour une archive .zip simple (plus de 4 Go).');
  };
  try {
    for (const e of entries) {
      const name = safeEntryName(e.name);
      if (!name) throw new Error(`Nom de fichier refusé dans l’archive : ${e.name}`);
      const raw = e.data ? Buffer.from(e.data) : await fsp.readFile(e.file);
      if (raw.length >= LIMIT) throw new Error(`Fichier trop volumineux pour l’archive : ${name}`);
      const crc = crc32(raw);
      let method = 8;
      let body = await deflateRaw(raw, { level: 6 });
      if (body.length >= raw.length) {
        method = 0;
        body = raw;
      }
      const nameBuf = Buffer.from(name, 'utf8');
      const { time, date } = dosDateTime(e.mtime instanceof Date ? e.mtime : new Date());
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6); // noms en UTF-8
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);
      const at = offset;
      await write(local);
      await write(nameBuf);
      await write(body);
      central.push({ nameBuf, method, time, date, crc, csize: body.length, usize: raw.length, at });
    }
    const cdStart = offset;
    for (const c of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(0x0314, 4); // Unix, 2.0
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(c.method, 10);
      h.writeUInt16LE(c.time, 12);
      h.writeUInt16LE(c.date, 14);
      h.writeUInt32LE(c.crc, 16);
      h.writeUInt32LE(c.csize, 20);
      h.writeUInt32LE(c.usize, 24);
      h.writeUInt16LE(c.nameBuf.length, 28);
      h.writeUInt32LE(((0o100644 << 16) >>> 0), 38);
      h.writeUInt32LE(c.at, 42);
      await write(h);
      await write(c.nameBuf);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - cdStart, 12);
    end.writeUInt32LE(cdStart, 16);
    if (central.length > 0xffff) throw new Error('Trop de fichiers pour une archive .zip simple.');
    await write(end);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/** Table des entrées d'une archive (répertoire central). */
async function readZipEntries(zipFile) {
  const fh = await fsp.open(zipFile, 'r');
  try {
    const { size } = await fh.stat();
    if (size < 22) throw new Error('Archive .zip invalide');
    const tail = Math.min(size, 0xffff + 22);
    const buf = Buffer.alloc(tail);
    await fh.read(buf, 0, tail, size - tail);
    let eocd = -1;
    for (let i = tail - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Archive .zip invalide (fin introuvable)');
    const count = buf.readUInt16LE(eocd + 10);
    const cdSize = buf.readUInt32LE(eocd + 12);
    const cdOff = buf.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === LIMIT || cdOff === LIMIT) throw new Error('Archive ZIP64 non prise en charge ici');
    if (cdOff + cdSize > size) throw new Error('Archive .zip tronquée');
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOff);
    const out = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Archive .zip invalide (répertoire central)');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const crc = cd.readUInt32LE(p + 16);
      const csize = cd.readUInt32LE(p + 20);
      const usize = cd.readUInt32LE(p + 24);
      const nLen = cd.readUInt16LE(p + 28);
      const xLen = cd.readUInt16LE(p + 30);
      const cLen = cd.readUInt16LE(p + 32);
      const ext = cd.readUInt32LE(p + 38);
      const at = cd.readUInt32LE(p + 42);
      const name = cd.slice(p + 46, p + 46 + nLen).toString(flags & 0x0800 ? 'utf8' : 'latin1');
      const mode = (ext >>> 16) & 0o170000;
      out.push({ name, method, crc, csize, usize, at, flags, isDir: name.endsWith('/'), isLink: mode === 0o120000 });
      p += 46 + nLen + xLen + cLen;
    }
    return out;
  } finally {
    await fh.close();
  }
}

/**
 * Extrait les entrées acceptées par `accept(name)` dans `destDir` (créé). Refuse l'archive entière
 * au premier nom dangereux ou lien symbolique. Renvoie la liste des fichiers écrits (noms relatifs).
 */
async function extractZip(zipFile, destDir, accept = () => true) {
  const entries = await readZipEntries(zipFile);
  const root = path.resolve(destDir);
  await fsp.mkdir(root, { recursive: true });
  const fh = await fsp.open(zipFile, 'r');
  const written = [];
  try {
    for (const e of entries) {
      const name = safeEntryName(e.name);
      if (!name) throw new Error(`Archive refusée : chemin interdit (${e.name})`);
      if (e.isLink) throw new Error(`Archive refusée : lien symbolique (${e.name})`);
      if (e.isDir || !accept(name)) continue;
      if (e.flags & 0x1) throw new Error('Archive chiffrée non prise en charge');
      const target = path.resolve(root, ...name.split('/'));
      if (!target.startsWith(root + path.sep)) throw new Error(`Archive refusée : chemin interdit (${e.name})`);
      const head = Buffer.alloc(30);
      await fh.read(head, 0, 30, e.at);
      if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('Archive .zip invalide (en-tête local)');
      const start = e.at + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      const body = Buffer.alloc(e.csize);
      await fh.read(body, 0, e.csize, start);
      let data;
      if (e.method === 0) data = body;
      else if (e.method === 8) data = await inflateRaw(body);
      else throw new Error(`Méthode de compression non prise en charge (${e.method})`);
      if (data.length !== e.usize || crc32(data) !== e.crc) throw new Error(`Archive endommagée : ${name}`);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, data);
      written.push(name);
    }
  } finally {
    await fh.close();
  }
  return written;
}

/** Fichiers ordinaires d'un dossier, récursivement (noms relatifs « a/b.c ») ; les liens sont ignorés. */
async function listFiles(dir, prefix = '') {
  const out = [];
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e && e.code === 'ENOENT') return out;
    throw e;
  }
  for (const d of entries) {
    const rel = prefix ? `${prefix}/${d.name}` : d.name;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...(await listFiles(full, rel)));
    else if (d.isFile()) out.push({ rel, full });
  }
  return out;
}

/** Vérifie qu'un dossier extrait ne contient ni lien symbolique ni rien d'autre que des fichiers et dossiers. */
async function assertPlainTree(dir) {
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    const st = await fsp.lstat(full);
    if (st.isSymbolicLink()) throw new Error(`Archive refusée : lien symbolique (${d.name})`);
    if (st.isDirectory()) await assertPlainTree(full);
    else if (!st.isFile()) throw new Error(`Archive refusée : élément inattendu (${d.name})`);
  }
}

module.exports = { crc32, writeZip, readZipEntries, extractZip, listFiles, assertPlainTree, safeEntryName };
