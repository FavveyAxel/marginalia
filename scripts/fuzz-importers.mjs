// Fuzz des importateurs de fichiers de Marginalia (robustesse / sécurité), en Node pur.
//
// But : trouver des entrées qui font planter un importateur (exception brute TypeError / RangeError…),
// le bloquent (plusieurs secondes sur un petit fichier), lui font consommer une mémoire sans borne, ou
// lui font rendre une sortie dangereuse (nom de fichier en forme de chemin, pollution de prototype,
// champ réservé accepté tel quel).
//
// Cibles (celles qui tournent sans DOM) :
//   share      src/features/share : openSharePackage, readSharePackage, importSharePackage (.marginalia)
//   backup     electron/backup.cjs : readZipEntries, extractZip (vérifié sur le disque), safeEntryName
//   updater    electron/updater.cjs : verifyManifest
//   vault      electron/vault.cjs : open, openLine, unwrapWith*
//   spaces     electron/spaces.cjs : open, openCapsule, ownerOf, unlock
//   fonts      electron/fontnames.cjs : familiesOfFile
//   wifi       electron/wifi-crypto.cjs : unb64u, open, openMeta, openFrame, framesOf, keyFromHash
//   net        electron/share-net.cjs (poignée de main), electron/video-net.cjs, electron/books-net.cjs
//   ooxml      src/features/editor/ooxml.ts + docx.ts (fonctions sur le XML, sans DOM), src/lib/sniff.ts
//   scaling    temps de quelques fonctions à trois tailles (comportement quadratique)
//
// Lancer : npx tsx scripts/fuzz-importers.mjs [itérations] [graine] [cible,cible…]
//   itérations : facteur d'échelle (défaut 1 : moins de 3 minutes) ; graine : entier (défaut 20261119).
// Le tirage est déterministe (PRNG à graine). Code de sortie 0 si aucun plantage, blocage ni
// acceptation dangereuse ; 1 sinon (chaque trouvaille est décrite avec l'entrée qui la provoque).
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const SCALE = Math.max(0.01, Number(process.argv[2]) || 1);
const SEED = Number(process.argv[3]) || 20261119;
const ONLY = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
const SLOW_MS = 5000; // au-delà, une entrée de petite taille est comptée comme un blocage

// zlib.inflateRaw est observé AVANT le chargement de backup.cjs (qui le « promisifie » au chargement) :
// on note la plus grosse sortie produite, pour voir une décompression sans plafond.
const inflateSeen = { max: 0, capped: true };
{
  const orig = zlib.inflateRaw;
  zlib.inflateRaw = function (buf, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts;
      opts = undefined;
    }
    if (!opts || !opts.maxOutputLength) inflateSeen.capped = false;
    return orig.call(zlib, buf, opts || {}, (err, out) => {
      if (out && out.length > inflateSeen.max) inflateSeen.max = out.length;
      cb(err, out);
    });
  };
}

// ── PRNG déterministe ───────────────────────────────────────
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(SEED);
const int = (n) => Math.floor(rnd() * n);
const pick = (a) => a[int(a.length)];
const chance = (p) => rnd() < p;
const rbytes = (n) => {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = int(256);
  return b;
};
const BOUNDS = [0, 1, 2, 0x7f, 0x80, 0xff, 0x100, 0x7fff, 0x8000, 0xffff, 0x10000, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff];
/** Mutation d'octets : inversions, valeurs limites, troncature, insertion, duplication de tranche. */
function mutateBytes(src, n = 1 + int(4)) {
  let b = Buffer.from(src);
  for (let k = 0; k < n && b.length; k++) {
    const at = int(b.length);
    switch (int(9)) {
      case 0:
        b[at] ^= 1 << int(8);
        break;
      case 1:
        b[at] = pick([0, 0xff, 0x7f, 0x80, int(256)]);
        break;
      case 2:
        if (at + 4 <= b.length) b.writeUInt32LE(pick(BOUNDS) >>> 0, at);
        break;
      case 3:
        if (at + 2 <= b.length) b.writeUInt16LE(pick(BOUNDS) & 0xffff, at);
        break;
      case 4:
        b = b.subarray(0, at);
        break;
      case 5:
        b = Buffer.concat([b.subarray(0, at), rbytes(1 + int(16)), b.subarray(at)]);
        break;
      case 6: {
        const len = 1 + int(Math.min(64, b.length - at));
        b = Buffer.concat([b.subarray(0, at), b.subarray(at, at + len), b.subarray(at)]);
        break;
      }
      case 7: {
        const len = 1 + int(Math.min(32, b.length - at));
        b = Buffer.concat([b.subarray(0, at), b.subarray(at + len)]);
        break;
      }
      default:
        b.fill(pick([0, 0xff, 0x41]), at, Math.min(b.length, at + 1 + int(32)));
    }
  }
  return b;
}

// ── Compte rendu ────────────────────────────────────────────
const reports = [];
function makeReport(name) {
  const r = { name, iterations: 0, rejects: 0, accepts: 0, crashes: 0, hangs: 0, unsafe: 0, slowest: { ms: 0, what: '' }, findings: new Map(), notes: [] };
  reports.push(r);
  return r;
}
/** Trouvaille (dédoublonnée par clé) : `kind` = crash | hang | unsafe | memory. */
function finding(r, kind, key, detail) {
  if (kind === 'crash') r.crashes++;
  else if (kind === 'hang') r.hangs++;
  else if (kind === 'memory') r.memory = (r.memory || 0) + 1;
  else r.unsafe++;
  const k = `${kind}: ${key}`;
  const f = r.findings.get(k);
  if (f) f.count++;
  else r.findings.set(k, { count: 1, detail });
}
const RAW = (e) => e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError || e instanceof SyntaxError || e instanceof URIError;
const head = (e) =>
  String((e && e.stack) || e)
    .split('\n')
    .slice(0, 4)
    .map((l) => l.trim().replace(ROOT + '/', ''))
    .join(' | ')
    .slice(0, 420);
const show = (x) => {
  let s;
  try {
    s = typeof x === 'string' ? x : Buffer.isBuffer(x) ? 'hex:' + x.subarray(0, 48).toString('hex') + (x.length > 48 ? `…(${x.length} o)` : '') : JSON.stringify(x);
  } catch {
    s = String(x);
  }
  s = String(s);
  return s.length > 260 ? s.slice(0, 260) + `…(${s.length} car.)` : s;
};
/**
 * Exécute un cas. `isClean(e)` : l'erreur est un refus propre. `check(result)` : chaîne décrivant une
 * sortie dangereuse, ou null. Une erreur brute (TypeError, RangeError…) ou non reconnue = plantage.
 */
async function runCase(r, what, fn, { isClean = () => false, check = null, slowMs = SLOW_MS } = {}) {
  r.iterations++;
  const t0 = performance.now();
  let out;
  let err = null;
  try {
    out = await fn();
  } catch (e) {
    err = e;
  }
  const ms = performance.now() - t0;
  if (ms > r.slowest.ms) r.slowest = { ms, what: show(typeof what === 'function' ? what() : what) };
  if (ms > slowMs) finding(r, 'hang', `${Math.round(ms / 1000)} s`, `${Math.round(ms)} ms — entrée : ${show(typeof what === 'function' ? what() : what)}`);
  if (err) {
    if (!RAW(err) && isClean(err)) r.rejects++;
    else finding(r, 'crash', head(err).split(' | ').slice(0, 2).join(' | '), `entrée : ${show(typeof what === 'function' ? what() : what)} — ${head(err)}`);
    return { err, ms };
  }
  r.accepts++;
  if (check) {
    let bad = null;
    try {
      bad = await check(out);
    } catch (e) {
      bad = 'le contrôle de la sortie a levé : ' + head(e);
    }
    if (bad) finding(r, 'unsafe', bad.split(' — ')[0], `${bad} — entrée : ${show(typeof what === 'function' ? what() : what)}`);
  }
  return { out, ms };
}
const want = (name) => !ONLY || ONLY.has(name);
const iters = (n) => Math.max(1, Math.round(n * SCALE));
const TMP = isMainThread ? fs.mkdtempSync(path.join(os.tmpdir(), 'mg-fuzz-')) : os.tmpdir();
process.on('exit', () => {
  try {
    if (isMainThread) fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* rien */
  }
});
const uncaught = [];
process.on('uncaughtException', (e) => uncaught.push(head(e)));
process.on('unhandledRejection', (e) => uncaught.push('rejet non géré : ' + head(e)));

// ── Valeurs hostiles ────────────────────────────────────────
/** Nombre écrit tel quel dans le JSON (1e999 → Infinity à la lecture, -0, entiers hors bornes…). */
const rawNum = (txt) => `@@RAW:${txt}@@`;
const unraw = (json) => json.replace(/"@@RAW:([^"@]+)@@"/g, '$1');
const ownProto = (v) => JSON.parse(`{"__proto__":${JSON.stringify(v)}}`);
const deep = (n, leaf = 1) => {
  let x = leaf;
  for (let i = 0; i < n; i++) x = chance(0.5) ? [x] : { a: x };
  return x;
};
const EVIL_STRINGS = [
  '',
  ' ',
  '..',
  '../x',
  '../../../../etc/passwd',
  'a/b',
  'a\\b',
  '/etc/passwd',
  'C:\\Windows\\x',
  'C:x',
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'hasOwnProperty',
  'x'.repeat(10000),
  'é'.repeat(300),
  '<img src=x onerror=alert(1)>',
  '<script>alert(1)</script>',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'url(http://127.0.0.1/x)',
  '\u0000',
  'a\u0000b',
  '\u202e\u200b',
  '\ud800',
  'CON',
  'a.',
  '.hidden',
  '-rf',
  '%2e%2e%2f',
  'x\ny',
];
const evilValue = () => {
  switch (int(16)) {
    case 0:
      return null;
    case 1:
      return pick([true, false]);
    case 2:
      return pick([0, -1, 1, 0.5, -0.5, 2 ** 31, 2 ** 53, -(2 ** 53), 1e21, 1e-9]);
    case 3:
      return rawNum(pick(['1e999', '-1e999', '-0', '1E400', '9007199254740993', '0.0000000000000000000000001']));
    case 4:
    case 5:
    case 6:
      return pick(EVIL_STRINGS);
    case 7:
      return [];
    case 8:
      return [null, 1, 'a', {}, []];
    case 9:
      return {};
    case 10:
      return ownProto({ polluted: true });
    case 11:
      return { constructor: { prototype: { polluted: true } }, prototype: { polluted: true } };
    case 12:
      return deep(pick([5, 50, 2000]));
    case 13:
      return { length: 1e9, toString: 1, valueOf: null, then: 1 };
    case 14:
      return Array.from({ length: pick([3, 300]) }, () => pick(EVIL_STRINGS));
    default:
      return pick(EVIL_STRINGS) + pick(EVIL_STRINGS);
  }
};
/** Tous les chemins d'un JSON (conteneurs et feuilles). */
function pathsOf(x, base = [], out = []) {
  out.push(base);
  if (x && typeof x === 'object') for (const k of Object.keys(x)) pathsOf(x[k], [...base, k], out);
  return out;
}
const getAt = (x, p) => p.reduce((o, k) => (o == null ? o : o[k]), x);
function setAt(x, p, v) {
  if (!p.length) return v;
  const parent = getAt(x, p.slice(0, -1));
  if (parent && typeof parent === 'object') parent[p[p.length - 1]] = v;
  return x;
}
/** Mutation d'un JSON : remplacer, supprimer, dupliquer, ajouter une clé réservée, échanger deux valeurs. */
function mutateJson(obj, log) {
  let o = structuredClone(obj);
  const n = 1 + int(3);
  for (let i = 0; i < n; i++) {
    const paths = pathsOf(o);
    const p = pick(paths);
    const parent = p.length ? getAt(o, p.slice(0, -1)) : null;
    const key = p[p.length - 1];
    switch (int(8)) {
      case 0:
      case 1:
      case 2: {
        const v = evilValue();
        log.push(`${p.join('.') || '(racine)'} = ${show(v)}`);
        o = setAt(o, p, v);
        break;
      }
      case 3:
        if (parent) {
          log.push(`suppression de ${p.join('.')}`);
          if (Array.isArray(parent)) parent.splice(Number(key), 1);
          else delete parent[key];
        }
        break;
      case 4:
        if (Array.isArray(parent)) {
          log.push(`doublon de ${p.join('.')}`);
          parent.push(structuredClone(parent[key]));
        }
        break;
      case 5: {
        const t = getAt(o, p);
        if (t && typeof t === 'object' && !Array.isArray(t)) {
          const k = pick(['__proto__', 'constructor', 'prototype', 'encrypted', 'missing', 'externalPath', 'readingSync', 'toString']);
          const v = evilValue();
          log.push(`${p.join('.')}.${k} = ${show(v)}`);
          Object.defineProperty(t, k, { value: v, enumerable: true, writable: true, configurable: true });
        }
        break;
      }
      case 6: {
        const q = pick(paths);
        if (p.length && q.length) {
          log.push(`${p.join('.')} ⇄ ${q.join('.')}`);
          const a = structuredClone(getAt(o, p));
          const b = structuredClone(getAt(o, q));
          setAt(o, p, b);
          setAt(o, q, a);
        }
        break;
      }
      default: {
        const t = getAt(o, p);
        if (typeof t === 'string') {
          const v = t + pick(EVIL_STRINGS);
          log.push(`${p.join('.')} += …`);
          setAt(o, p, v);
        } else if (typeof t === 'number') {
          const v = pick([-t, t + 0.5, -1, 2 ** 53, rawNum('1e999')]);
          log.push(`${p.join('.')} = ${show(v)}`);
          setAt(o, p, v);
        }
      }
    }
  }
  return o;
}

// ── Écrivain ZIP brut (toutes les incohérences possibles) ───
/**
 * entries : [{ name (chaîne ou Buffer), data, method (0|8), flags, crc, csize, usize, ext (attributs
 * externes), localName, extra (champ supplémentaire du répertoire central), at (position annoncée),
 * madeBy }] ; opts : { count, cdSize, cdOff, comment, prefix, zip64 (fin ZIP64 avec ces valeurs) }.
 */
function rawZip(entries, opts = {}) {
  const parts = [];
  let offset = 0;
  const push = (b) => {
    parts.push(b);
    offset += b.length;
  };
  if (opts.prefix) push(opts.prefix);
  const cd = [];
  for (const e of entries) {
    const name = Buffer.isBuffer(e.name) ? e.name : Buffer.from(e.name, 'utf8');
    const lname = e.localName !== undefined ? (Buffer.isBuffer(e.localName) ? e.localName : Buffer.from(e.localName, 'utf8')) : name;
    const data = e.data || Buffer.alloc(0);
    const method = e.method ?? 0;
    const body = e.body ?? (method === 8 ? zlib.deflateRawSync(data) : data);
    const crc = e.crc ?? zlib.crc32(data) >>> 0;
    const csize = e.csize ?? body.length;
    const usize = e.usize ?? data.length;
    const flags = e.flags ?? 0x0800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(Math.min(csize, 0xffffffff) >>> 0, 18);
    local.writeUInt32LE(Math.min(usize, 0xffffffff) >>> 0, 22);
    local.writeUInt16LE(lname.length, 26);
    const at = offset;
    push(local);
    push(lname);
    push(body);
    cd.push({ name, method, crc, csize, usize, flags, at: e.at ?? at, ext: e.ext ?? (0o100644 << 16) >>> 0, extra: e.extra || Buffer.alloc(0), madeBy: e.madeBy ?? 0x0314 });
  }
  const cdStart = offset;
  for (const c of cd) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(c.madeBy, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(c.flags, 8);
    h.writeUInt16LE(c.method, 10);
    h.writeUInt32LE(c.crc >>> 0, 16);
    h.writeUInt32LE(Math.min(c.csize, 0xffffffff) >>> 0, 20);
    h.writeUInt32LE(Math.min(c.usize, 0xffffffff) >>> 0, 24);
    h.writeUInt16LE(c.name.length, 28);
    h.writeUInt16LE(c.extra.length, 30);
    h.writeUInt32LE(c.ext >>> 0, 38);
    h.writeUInt32LE(Math.min(c.at, 0xffffffff) >>> 0, 42);
    push(h);
    push(c.name);
    push(c.extra);
  }
  const cdSize = offset - cdStart;
  if (opts.zip64) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0);
    z.writeBigUInt64LE(44n, 4);
    z.writeBigUInt64LE(BigInt(opts.zip64.count ?? cd.length), 24);
    z.writeBigUInt64LE(BigInt(opts.zip64.count ?? cd.length), 32);
    z.writeBigUInt64LE(BigInt(opts.zip64.cdSize ?? cdSize), 40);
    z.writeBigUInt64LE(BigInt(opts.zip64.cdOff ?? cdStart), 48);
    const zAt = offset;
    push(z);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeBigUInt64LE(BigInt(opts.zip64.locOff ?? zAt), 8);
    loc.writeUInt32LE(1, 16);
    push(loc);
  }
  const comment = opts.comment || Buffer.alloc(0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE((opts.count ?? (opts.zip64 ? 0xffff : cd.length)) & 0xffff, 8);
  end.writeUInt16LE((opts.count ?? (opts.zip64 ? 0xffff : cd.length)) & 0xffff, 10);
  end.writeUInt32LE((opts.cdSize ?? (opts.zip64 ? 0xffffffff : cdSize)) >>> 0, 12);
  end.writeUInt32LE((opts.cdOff ?? (opts.zip64 ? 0xffffffff : cdStart)) >>> 0, 16);
  end.writeUInt16LE(comment.length, 20);
  push(end);
  push(comment);
  return Buffer.concat(parts);
}
/** Champ supplémentaire ZIP64 (0x0001) avec les valeurs données (BigInt ou nombres). */
function zip64Extra(...vals) {
  const b = Buffer.alloc(4 + 8 * vals.length);
  b.writeUInt16LE(1, 0);
  b.writeUInt16LE(8 * vals.length, 2);
  vals.forEach((v, i) => b.writeBigUInt64LE(BigInt(v), 4 + 8 * i));
  return b;
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ═════════════════════════════════════════════════════════════
// 1. Paquets de partage « .marginalia »
// ═════════════════════════════════════════════════════════════
async function fuzzShare() {
  const R = makeReport('share  openSharePackage / readSharePackage / importSharePackage');
  const sp = await import('../src/features/share/sharePackage.ts');
  const sm = await import('../src/features/share/shareMerge.ts');
  const { useStore, separateUndoStep } = await import('../src/lib/store.ts');
  const { host } = await import('../src/lib/platform.ts');
  const { ShareError, openSharePackage, readSharePackage } = sp;

  // Hôte factice : aucune écriture réelle ; les fichiers « enregistrés » sont notés pour le contrôle.
  const stored = [];
  for (const k of Object.keys(host)) if (typeof host[k] === 'function') host[k] = async () => undefined;
  host.storeFile = async (ownerId, fileName, data) => {
    stored.push({ ownerId, fileName, size: data?.byteLength });
  };
  host.deleteFile = async () => undefined;
  host.readFile = async () => {
    throw new Error('absent');
  };
  useStore.setState({ ready: true });
  const COLS = ['books', 'highlights', 'concepts', 'arguments', 'studies', 'plans', 'drafts', 'cards', 'workspaces', 'groups', 'wsItems'];
  const blank = { ...Object.fromEntries(COLS.map((c) => [c, []])), maps: {}, activity: [] };
  const reset = () => {
    try {
      useStore.setState(structuredClone(blank));
      separateUndoStep();
    } catch {
      /* déjà signalé par checkImported */
    }
    stored.length = 0;
  };

  // ── Paquet valide de référence (toutes les collections, tous les genres de livre) ──
  const docx = Buffer.from(
    await new JSZip()
      .file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
      .file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:bookmarkStart w:id="1" w:name="_mglHl_h1"/><w:r><w:t>Texte</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p></w:body></w:document>')
      .generateAsync({ type: 'uint8array' }),
  );
  const epub = Buffer.from('PK\x03\x04 faux epub pour le fuzz ' + 'x'.repeat(200));
  const pg1 = Buffer.from('page-1');
  const pg2 = Buffer.from('page-2');
  const ed = { publisher: 'GF', year: '2000', translator: '', place: 'Paris', pageOffset: 0 };
  const now = 1760000000000;
  const baseBook = (id, format, fileName, extra = {}) => ({ id, title: 'Titre ' + id, author: 'Auteur', format, fileName, originalName: fileName, size: 10, addedAt: now, lastOpenedAt: null, progress: 0, position: null, cover: null, edition: { ...ed }, ...extra });
  const anchor = { kind: 'html', chapter: 1, start: 10, end: 20, prefix: 'av', suffix: 'ap' };
  const BASE_DATA = {
    books: [
      baseBook('b1', 'epub', 'livre.epub', { size: epub.length }),
      baseBook('b2', 'paper', '', { paper: true, isbn: '9782080712345', size: 0 }),
      baseBook('b3', 'video', '', { size: 0, video: { provider: 'youtube', id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration: 120, chapters: [{ s: 0, t: 'Début' }] } }),
      baseBook('b4', 'txt', 'notes.txt', { size: 1234 }),
      baseBook('b5', 'image', 'page-1.jpg', { pages: ['page-1.jpg', 'page-2.jpg'], size: pg1.length + pg2.length }),
    ],
    highlights: [
      { id: 'h1', bookId: 'b1', category: 'these', text: 'Le bon sens', note: 'note', noteKind: 'question', conceptIds: ['c1'], anchor: { ...anchor }, locationLabel: 'I', printedPage: '3', createdAt: now, updatedAt: now },
      { id: 'h2', bookId: 'b2', category: null, text: 'Papier', note: '', noteKind: null, conceptIds: [], anchor: { kind: 'pdf', page: 3, rects: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.02 }] }, locationLabel: 'p. 3', printedPage: '3', createdAt: now, updatedAt: now },
    ],
    concepts: [
      { id: 'c1', name: 'Bon sens', definition: 'def', senses: [{ id: 's1', author: 'Descartes', bookId: 'b1', definition: 'd', highlightIds: ['h1'] }], links: [{ conceptId: 'c2', kind: 'proche', note: '' }], programme: 'notion', createdAt: now, updatedAt: now },
      { id: 'c2', name: 'Raison', definition: '', senses: [], links: [], programme: null, createdAt: now, updatedAt: now },
    ],
    maps: {
      b1: { bookId: 'b1', nodes: [{ id: 'n1', highlightId: 'h1', text: 't', x: 0, y: 0, color: '#ff0000', conceptId: 'c1', portal: 'board-x' }, { id: 'n2', highlightId: null, text: 'u', x: 10, y: 10, from: { mapKey: 'board-x', nodeId: 'm1' } }], edges: [{ id: 'e1', source: 'n1', target: 'n2', relation: 'soutient', groupId: null }], viewport: { x: 0, y: 0, zoom: 1 }, zones: [{ id: 'z1', title: 'Zone', color: '--cat-these', x: 0, y: 0, w: 100, h: 100 }] },
      'board-x': { id: 'board-x', kind: 'board', title: 'Carte libre', bookId: '', bookIds: ['b1'], nodes: [{ id: 'm1', highlightId: 'h2', text: 'v', x: 1, y: 2 }], edges: [], viewport: null, createdAt: now, updatedAt: now },
      'mv-st1-mv1': { id: 'mv-st1-mv1', kind: 'movement', bookId: 'b1', studyId: 'st1', movementId: 'mv1', nodes: [], edges: [], viewport: null },
    },
    arguments: [{ id: 'a1', title: 'Arg', bookId: 'b1', premises: [{ id: 'p1', text: 'P', highlightId: 'h1', implicit: false }], conclusion: { id: 'k1', text: 'C', highlightId: null, implicit: false }, comment: '', createdAt: now, updatedAt: now }],
    studies: [{ id: 'st1', bookId: 'b1', title: 'Fiche', probleme: 'p', these: 't', enjeu: 'e', movements: [{ id: 'mv1', anchor: { ...anchor }, startText: 'Le bon', title: 'M1', role: 'r' }], createdAt: now, updatedAt: now }],
    plans: [{ id: 'pl1', title: 'Plan', sujet: 's', definitions: '', problematique: '', parts: [{ id: 'pn1', title: 'I', note: '', items: [{ id: 'i1', ref: { kind: 'highlight', id: 'h1' } }, { id: 'i2', ref: { kind: 'text', text: 'libre' } }], children: [{ id: 'pn2', title: 'A', note: '', items: [], children: [] }] }], conclusion: '', draftId: 'd1', createdAt: now, updatedAt: now }],
    drafts: [{ id: 'd1', title: 'Écrit', fileName: 'ecrit.docx', externalPath: null, wordCount: 1, template: null, createdAt: now, updatedAt: now }],
    cards: [{ id: 'k1', kind: 'definition', front: 'Q', back: 'R', highlightId: 'h1', conceptId: 'c1', bookId: 'b1', suspended: false, fsrs: {}, createdAt: now }],
    workspaces: [{ id: 'w1', name: 'Espace', tint: '--cat-these', order: 0, createdAt: now }],
    groups: [{ id: 'g1', workspaceId: 'w1', parentId: null, name: 'Groupe', order: 0, collapsed: false }],
    wsItems: [
      { id: 'wi1', workspaceId: 'w1', groupId: 'g1', kind: 'book', refId: 'b1', order: 0 },
      { id: 'wi2', workspaceId: 'w1', groupId: null, kind: 'draft', refId: 'd1', order: 1 },
    ],
  };
  const BASE_FILES = { 'files/b1/livre.epub': epub, 'files/b5/page-1.jpg': pg1, 'files/b5/page-2.jpg': pg2, 'files/d1/ecrit.docx': docx };
  const BASE_MANIFEST = {
    format: 'marginalia-share',
    v: 1,
    createdAt: now,
    appVersion: '3.60.0',
    title: 'Espace',
    scope: 'workspace',
    shareId: 'ws-w1',
    counts: { books: 5, booksWithFile: 2, highlights: 2, concepts: 2, maps: 3, arguments: 1, studies: 1, plans: 1, drafts: 1, cards: 1, workspaces: 1, groups: 1 },
    booksIncluded: true,
    books: [
      { id: 'b1', sha256: sha256(epub), size: epub.length, title: 'Titre b1', author: 'Auteur', format: 'epub', included: true },
      { id: 'b2', sha256: null, size: 0, title: 'Titre b2', author: 'Auteur', format: 'paper', included: false },
      { id: 'b3', sha256: null, size: 0, title: 'Titre b3', author: 'Auteur', format: 'video', included: false },
      { id: 'b4', sha256: 'a'.repeat(64), size: 1234, title: 'Titre b4', author: 'Auteur', format: 'txt', included: false },
      { id: 'b5', sha256: sha256(sha256(pg1) + '\n' + sha256(pg2)), size: pg1.length + pg2.length, title: 'Titre b5', author: 'Auteur', format: 'image', included: true },
    ],
    integrity: { data: '', files: {} },
  };
  /** Assemble un paquet ; `fix` : recalcule les empreintes (sinon le paquet est refusé dès l'intégrité). */
  async function pack({ manifest = BASE_MANIFEST, data = BASE_DATA, files = BASE_FILES, fix = true, extraEntries = null, manifestText = null, dataText = null } = {}) {
    const dataJson = dataText ?? unraw(JSON.stringify(data));
    let m = manifest;
    if (fix && m && typeof m === 'object' && !Array.isArray(m)) {
      m = { ...m };
      if (!m.integrity || typeof m.integrity !== 'object' || Array.isArray(m.integrity)) m.integrity = {};
      else m.integrity = { ...m.integrity };
      if (typeof m.integrity.data !== 'string' || m.integrity.data === '') m.integrity.data = sha256(Buffer.from(dataJson, 'utf8'));
      if (!m.integrity.files || typeof m.integrity.files !== 'object' || !Object.keys(m.integrity.files).length) m.integrity.files = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha256(v)]));
    }
    const zip = new JSZip();
    zip.file('manifest.json', manifestText ?? unraw(JSON.stringify(m)), { createFolders: false });
    zip.file('data.json', dataJson, { createFolders: false });
    for (const [k, v] of Object.entries(files)) zip.file(k, v, { binary: true, createFolders: false });
    for (const [k, v] of Object.entries(extraEntries || {})) zip.file(k, v, { binary: true, createFolders: false });
    return Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
  }

  // ── Contrôles de la sortie ──
  const SAFE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
  const safeSeg = (s) => typeof s === 'string' && SAFE.test(s) && !s.includes('..') && !['__proto__', 'constructor', 'prototype'].includes(s);
  const protoKeys = () => Object.getOwnPropertyNames(Object.prototype).length + Object.getOwnPropertyNames(Array.prototype).length;
  const protoBase = protoKeys();
  const polluted = () => ({}).polluted !== undefined || protoKeys() !== protoBase;
  function checkOpened(o) {
    if (polluted()) return 'pollution de prototype après openSharePackage';
    for (const k of o.files.keys()) {
      const p = k.split('/');
      if (p.length !== 3 || p[0] !== 'files' || !safeSeg(p[1]) || !safeSeg(p[2])) return `nom de fichier dangereux accepté — ${show(k)}`;
    }
    for (const b of o.data.books) if (b.fileName !== '' && !safeSeg(b.fileName)) return `book.fileName dangereux accepté — ${show(b.fileName)}`;
    for (const b of o.data.books) if (Array.isArray(b.pages) && !b.pages.every(safeSeg)) return `book.pages dangereux accepté — ${show(b.pages)}`;
    for (const d of o.data.drafts) if (!safeSeg(d.fileName)) return `draft.fileName dangereux accepté — ${show(d.fileName)}`;
    return null;
  }
  // Forme de référence : type attendu de chaque champ, relevé sur l'import du paquet valide.
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const shape = new Map(); // « collection.chemin » → Set(types)
  const walk = (col, x, p, visit, depth = 0) => {
    if (depth > 200) return;
    visit(`${col}${p}`, x);
    if (Array.isArray(x)) for (const y of x) walk(col, y, p + '[]', visit, depth + 1);
    else if (x && typeof x === 'object') for (const k of Object.keys(x)) walk(col, x[k], `${p}.${k}`, visit, depth + 1);
  };
  const snapshot = () => {
    const s = useStore.getState();
    return { ...Object.fromEntries(COLS.map((c) => [c, s[c]])), maps: Object.values(s.maps) };
  };
  const learn = () => {
    const snap = snapshot();
    for (const [col, arr] of Object.entries(snap)) for (const x of arr) walk(col, x, '', (k, v) => (shape.get(k) ?? shape.set(k, new Set()).get(k)).add(typeOf(v)));
  };
  // Champs réservés qu'un paquet ne doit jamais pouvoir poser.
  const RESERVED_FLAGS = { workspaces: ['encrypted'], books: ['readingSync', 'position'], drafts: ['externalPath', 'versions'], highlights: ['source', 'photo'] };
  const typeWarn = new Map();
  function checkImported() {
    if (polluted()) return 'pollution de prototype après importSharePackage';
    for (const w of stored) if (!safeSeg(w.ownerId) || !safeSeg(w.fileName)) return `host.storeFile avec un nom dangereux — ${show(w)}`;
    const snap = snapshot();
    for (const [col, flags] of Object.entries(RESERVED_FLAGS))
      for (const x of snap[col])
        for (const f of flags) {
          const v = x[f];
          if (v !== undefined && v !== null && v !== false && !(Array.isArray(v) && !v.length)) return `champ réservé ${col}.${f} repris du paquet — valeur ${show(v)}`;
        }
    for (const [col, arr] of Object.entries(snap))
      for (const x of arr)
        walk(col, x, '', (k, v) => {
          const ok = shape.get(k);
          const t = typeOf(v);
          if (ok && !ok.has(t) && !(t === 'null' && /Ids?$/.test(k))) {
            const key = `${k} : ${t} au lieu de ${[...ok].join('|')}`;
            typeWarn.set(key, (typeWarn.get(key) || 0) + 1);
          }
        });
    // La base importée doit rester enregistrable (db.json = JSON.stringify de l'état).
    try {
      JSON.stringify(snap);
    } catch (e) {
      return `la base importée n’est plus sérialisable (l’enregistrement de db.json lèverait) — ${head(e).split(' | ')[0]}`;
    }
    // Et rester modifiable : suppression des éléments reçus, journal des changements vidé tout de suite.
    try {
      useStore.setState(structuredClone(blank));
      separateUndoStep();
    } catch (e) {
      return `le journal des changements lève dès qu’on touche à l’élément importé — ${head(e)}`;
    }
    return null;
  }
  const clean = (e) => e instanceof ShareError;
  /** Import complet, puis vidage du journal des changements (sinon son erreur éventuelle part dans un minuteur). */
  const doImport = async (bytes) => {
    const res = await sm.importSharePackage(bytes);
    separateUndoStep();
    return res;
  };

  // Paquet valide : doit passer (sinon le fuzz ne teste rien).
  reset();
  const valid = await pack();
  {
    const r = await runCase(R, 'paquet valide', async () => {
      await readSharePackage(valid);
      return doImport(valid);
    });
    if (r.err) {
      finding(R, 'crash', 'le paquet valide de référence est refusé', head(r.err));
      return;
    }
    learn();
  }

  // (a) Mutations JSON de data.json et du manifeste, empreintes recalculées.
  const nJson = iters(2600);
  for (let i = 0; i < nJson; i++) {
    const log = [];
    const which = int(10);
    let manifest = BASE_MANIFEST;
    let data = BASE_DATA;
    if (which < 6) data = mutateJson(BASE_DATA, log);
    else if (which < 9) manifest = mutateJson(BASE_MANIFEST, log);
    else {
      data = mutateJson(BASE_DATA, log);
      manifest = mutateJson(BASE_MANIFEST, log);
    }
    let bytes;
    try {
      bytes = await pack({ manifest, data, fix: !chance(0.05) });
    } catch {
      continue; // mutation non sérialisable (cycle impossible ici, profondeur extrême)
    }
    reset();
    const what = () => `${which < 6 ? 'data.json' : which < 9 ? 'manifest.json' : 'data+manifest'} : ${log.join(' ; ')}`;
    const o = await runCase(R, what, () => openSharePackage(bytes), { isClean: clean, check: checkOpened });
    if (o.err) continue;
    await runCase(R, () => 'readSharePackage — ' + what(), () => readSharePackage(bytes), { isClean: clean });
    await runCase(R, () => 'importSharePackage — ' + what(), () => doImport(bytes), { isClean: clean, check: checkImported });
  }

  // (b) Niveau ZIP : noms d'entrées hostiles, doublons, fichiers manquants, empreintes fausses.
  const EVIL_NAMES = ['../evil', 'files/../evil', 'files/b1/../../evil', '/abs', 'C:/x', 'files\\b1\\x', 'files/b1/a/b', 'files//x', 'files/b1/', 'files/__proto__/x', 'files/b1/__proto__', 'files/constructor/prototype', 'files/b1/x\u0000y', 'files/b1/..', 'files/b1/.', 'FILES/b1/x', 'manifest.json/', 'data.json/x', 'files/b1/' + 'a'.repeat(300), 'files/b1/-x', 'files/b1/.x', 'files/b1/x..y', 'Manifest.json', 'files/b9/x', 'files/d1/autre.docx', 'files/b2/x', '__proto__', 'files'];
  const nZip = iters(500);
  for (let i = 0; i < nZip; i++) {
    const kind = int(7);
    let bytes;
    let what;
    if (kind === 0) {
      const n = pick(EVIL_NAMES);
      const listed = chance(0.7);
      const files = { ...BASE_FILES };
      const extra = listed ? null : { [n]: Buffer.from('x') };
      if (listed) files[n] = Buffer.from('x');
      what = `entrée ${listed ? 'listée' : 'non listée'} nommée ${show(n)}`;
      bytes = await pack({ files, extraEntries: extra });
    } else if (kind === 1) {
      const drop = pick(Object.keys(BASE_FILES));
      const files = { ...BASE_FILES };
      delete files[drop];
      const keepListed = chance(0.5);
      what = `fichier ${drop} absent (${keepListed ? 'toujours listé' : 'retiré du manifeste'})`;
      bytes = await pack({ files, manifest: keepListed ? { ...BASE_MANIFEST, integrity: { data: '', files: Object.fromEntries(Object.entries(BASE_FILES).map(([k, v]) => [k, sha256(v)])) } } : BASE_MANIFEST });
    } else if (kind === 2) {
      const k = pick(Object.keys(BASE_FILES));
      what = `empreinte fausse pour ${k}`;
      bytes = await pack({ manifest: { ...BASE_MANIFEST, integrity: { data: '', files: { ...Object.fromEntries(Object.entries(BASE_FILES).map(([kk, v]) => [kk, sha256(v)])), [k]: pick(['0'.repeat(64), '', 'x', sha256(Buffer.from('autre'))]) } } } });
    } else if (kind === 3) {
      what = 'octets du paquet valide mutés';
      bytes = mutateBytes(valid);
      what += ` (${bytes.length} o, sha ${sha256(bytes).slice(0, 12)})`;
    } else if (kind === 4) {
      // Archive brute : doublons, tailles annoncées fausses, nom local ≠ nom du répertoire central.
      const dataJson = Buffer.from(JSON.stringify(BASE_DATA));
      const m = { ...BASE_MANIFEST, integrity: { data: sha256(dataJson), files: Object.fromEntries(Object.entries(BASE_FILES).map(([k, v]) => [k, sha256(v)])) } };
      const ents = [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(m)), method: 8 }, { name: 'data.json', data: dataJson, method: 8 }, ...Object.entries(BASE_FILES).map(([k, v]) => ({ name: k, data: v, method: pick([0, 8]) }))];
      const t = int(6);
      const victim = pick(ents);
      if (t === 0) ents.push({ ...victim, data: Buffer.from('{"autre":1}') });
      else if (t === 1) victim.usize = pick([0, 1, 0xffffffff, 2 ** 31]);
      else if (t === 2) victim.csize = pick([0, 1, 0xffffffff]);
      else if (t === 3) victim.localName = pick(EVIL_NAMES);
      else if (t === 4) victim.crc = 0xdeadbeef;
      else victim.at = pick([0, 5, 0xffffffff]);
      what = `archive brute, variante ${t} sur ${victim.name}`;
      bytes = rawZip(ents, chance(0.2) ? { count: pick([0, 1, 0xffff]) } : {});
    } else if (kind === 5) {
      const t = pick(['[]', 'null', '"x"', '1', '{', '', '{"__proto__":{"polluted":true}}', '[' .repeat(5000) + ']'.repeat(5000), '{"format":"marginalia-share","v":1e999}', '{"format":"marginalia-share","v":2}', '{"format":"marginalia-share","v":0.5}', '\ufeff{}', 'x'.repeat(70000)]);
      const onData = chance(0.5);
      what = `${onData ? 'data.json' : 'manifest.json'} = ${show(t)}`;
      bytes = await pack(onData ? { dataText: t } : { manifestText: t });
    } else {
      const junk = pick([Buffer.alloc(0), Buffer.from('PK'), Buffer.from('PK\x03\x04'), Buffer.from('PK\x05\x06' + '\0'.repeat(18)), rbytes(1 + int(400)), Buffer.from('{"format":"marginalia-share"}')]);
      what = `pas une archive : ${show(junk)}`;
      bytes = junk;
    }
    reset();
    const o = await runCase(R, what, () => openSharePackage(bytes), { isClean: clean, check: checkOpened });
    if (o.err) continue;
    await runCase(R, () => 'importSharePackage — ' + what, () => doImport(bytes), { isClean: clean, check: checkImported });
  }

  // (c) Cas dirigés.
  const directed = [];
  const D = (name, over) => directed.push([name, over]);
  const withData = (fn) => {
    const d = structuredClone(BASE_DATA);
    fn(d);
    return d;
  };
  {
    // Imbrication écrite en texte (JSON.stringify ne descend pas aussi profond).
    const d = withData((x) => (x.plans[0].parts = '@@PARTS@@'));
    const nest = (n) => '{"id":"x","title":"","note":"","items":[],"children":['.repeat(n) + ']}'.repeat(n);
    for (const n of [3000, 20000]) D(`plan imbriqué sur ${n} niveaux`, { dataText: JSON.stringify(d).replace('"@@PARTS@@"', '[' + nest(n) + ']') });
    const dm = withData((x) => (x.maps.b1.nodes[0].deep = '@@DEEP@@'));
    D('nœud de carte avec un champ imbriqué sur 20 000 niveaux', { dataText: JSON.stringify(dm).replace('"@@DEEP@@"', '['.repeat(20000) + ']'.repeat(20000)) });
  }
  D('data.json : tableau imbriqué sur 200 000 niveaux', { dataText: '{"books":' + '['.repeat(200000) + ']'.repeat(200000) + '}' });
  D('espace reçu marqué « encrypted »', { data: withData((d) => (d.workspaces[0].encrypted = true)) });
  D('mouvements d’une fiche : [null, 1, "x"]', { data: withData((d) => (d.studies[0].movements = [null, 1, 'x'])) });
  D('édition d’un livre : champs objets', { data: withData((d) => (d.books[0].edition = { publisher: { a: 1 }, year: ['x'], pageOffset: 'NaN' })) });
  D('titre de 5 Mo', { data: withData((d) => (d.books[0].title = 'T'.repeat(5 * 1024 * 1024))) });
  D('10 000 extraits au même id de livre', {
    data: withData((d) => {
      d.highlights = Array.from({ length: 10000 }, (_, i) => ({ ...d.highlights[0], id: 'h' + i }));
    }),
  });
  for (const [name, over] of directed) {
    let bytes;
    try {
      bytes = await pack(over);
    } catch (e) {
      R.notes.push(`cas dirigé « ${name} » non construit : ${head(e)}`);
      continue;
    }
    reset();
    const o = await runCase(R, name, () => openSharePackage(bytes), { isClean: clean, check: checkOpened });
    if (o.err) continue;
    await runCase(R, 'readSharePackage — ' + name, () => readSharePackage(bytes), { isClean: clean });
    await runCase(R, 'importSharePackage — ' + name, () => doImport(bytes), { isClean: clean, check: checkImported });
  }

  // (d) Coût en fonction du nombre de livres papier (recherche du livre local : quadratique ?).
  const times = [];
  for (const n of [1000, 2000, 4000]) {
    const d = structuredClone(BASE_DATA);
    d.books = Array.from({ length: n }, (_, i) => baseBook('p' + i, 'paper', '', { paper: true, size: 0, title: 'Livre ' + i }));
    Object.assign(d, { highlights: [], concepts: [], maps: {}, arguments: [], studies: [], plans: [], drafts: [], cards: [], workspaces: [], groups: [], wsItems: [] });
    const m = { ...BASE_MANIFEST, scope: 'items', books: d.books.map((b) => ({ id: b.id, sha256: null, size: 0, title: b.title, author: '', format: 'paper', included: false })) };
    const bytes = await pack({ data: d, manifest: m, files: {} });
    reset();
    const t0 = performance.now();
    await readSharePackage(bytes).catch(() => null);
    const tRead = performance.now() - t0;
    const t1 = performance.now();
    await sm.importSharePackage(bytes).catch(() => null);
    times.push({ n, kb: Math.round(bytes.length / 1024), read: Math.round(tRead), imp: Math.round(performance.now() - t1) });
  }
  reset();
  R.notes.push('coût selon le nombre de livres papier : ' + times.map((t) => `${t.n} livres (${t.kb} Ko) → aperçu ${t.read} ms, import ${t.imp} ms`).join(' ; '));
  const growth = times[2].imp / Math.max(1, times[1].imp);
  if (growth > 3.2 && times[2].imp > 1500) finding(R, 'hang', 'import quadratique en nombre de livres papier', `×${growth.toFixed(1)} quand le nombre de livres double (${times.map((t) => `${t.n}: ${t.imp} ms`).join(', ')}) : un paquet de 100 000 livres papier (quelques centaines de Ko) bloque la fenêtre pendant des minutes`);
  if (typeWarn.size) {
    const top = [...typeWarn.entries()].sort((a, b) => b[1] - a[1]);
    R.notes.push(`champs importés avec un type inattendu (repris tels quels du paquet, ${top.length} chemins) : ` + top.slice(0, 40).map(([k, n]) => `${k} (${n}×)`).join(' ; '));
    R.typeWarn = top;
  }
}

// ═════════════════════════════════════════════════════════════
// 2. Archives .zip des sauvegardes (electron/backup.cjs)
// ═════════════════════════════════════════════════════════════
/** Fichiers et liens sous `dir` (chemins absolus). */
function listTree(dir, out = []) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of ents) {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) listTree(full, out);
    else out.push({ full, link: d.isSymbolicLink() });
  }
  return out;
}
/** Extraction dans un processus à part : code 0 = fait, 3 = refus (erreur JS), autre = processus tombé. */
const CHILD_EXTRACT = `
const [backupPath, zip, dest] = process.argv.slice(1);
require(backupPath).extractZip(zip, dest).then(
  (written) => process.stdout.write(JSON.stringify({ written })),
  (e) => { process.stdout.write(JSON.stringify({ error: String(e && e.message), raw: e instanceof RangeError || e instanceof TypeError, stack: String(e && e.stack) })); process.exitCode = 3; },
);`;
async function fuzzBackup() {
  const R = makeReport('backup readZipEntries / extractZip / safeEntryName');
  const backup = require(path.join(ROOT, 'electron/backup.cjs'));
  const jail = path.join(TMP, 'jail');
  fs.mkdirSync(jail, { recursive: true });
  const zipFile = path.join(jail, 'in.zip');
  let nDest = 0;
  const clean = (e) => e instanceof Error; // toute Error non brute (message du module, zlib, système de fichiers)
  /** Lit puis extrait `bytes` ; contrôle sur le disque que rien n'est écrit hors du dossier de destination. */
  async function tryZip(what, bytes, { expectReject = false } = {}) {
    fs.writeFileSync(zipFile, bytes);
    const dest = path.join(jail, 'dest' + nDest++);
    inflateSeen.max = 0;
    const rss0 = process.memoryUsage().rss;
    let declared = 0;
    let aborted = null;
    const res = await runCase(
      R,
      what,
      async () => {
        const entries = await backup.readZipEntries(zipFile);
        declared = entries.reduce((n, e) => n + (Number.isFinite(e.usize) ? e.usize : 0), 0);
        // Taille ou position hors des entiers 32 bits signés : l'extraction peut faire tomber tout le
        // processus (assertion native de fs.read) ; elle est donc tentée dans un processus à part.
        if (entries.some((e) => ![e.csize, e.at].every((v) => Number.isSafeInteger(v) && v <= 0x7fffffff))) {
          const r = spawnSync(process.execPath, ['-e', CHILD_EXTRACT, path.join(ROOT, 'electron/backup.cjs'), zipFile, dest], { encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 20 });
          if (r.signal || (r.status !== 0 && r.status !== 3)) {
            const big = entries.find((e) => ![e.csize, e.at].every((v) => Number.isSafeInteger(v) && v <= 0x7fffffff));
            aborted = `le processus entier tombe (${r.signal || 'code ' + r.status}) : ${String(r.stderr).split('\n').filter((l) => /Assertion|at |Error|FATAL/.test(l)).slice(0, 4).map((l) => l.trim()).join(' | ').slice(0, 300)} — csize ${big.csize}, position ${big.at}`;
            throw new Error('processus tombé');
          }
          const out = JSON.parse(r.stdout || '{}');
          if (out.error) {
            const e = out.raw ? new RangeError(out.error) : new Error(out.error);
            e.stack = out.stack;
            throw e;
          }
          return out.written || [];
        }
        return backup.extractZip(zipFile, dest);
      },
      {
        isClean: clean,
        check: (written) => {
          for (const w of written) {
            if (backup.safeEntryName(w) !== w) return `nom écrit non canonique — ${show(w)}`;
            if (!fs.existsSync(path.join(dest, ...w.split('/')))) return `fichier annoncé écrit mais absent — ${show(w)}`;
          }
          return expectReject ? 'archive hostile acceptée — ' + show(written) : null;
        },
      },
    );
    if (aborted) finding(R, 'crash', 'ARRÊT DU PROCESSUS (assertion native) à l’extraction', `${aborted} — entrée : ${show(typeof what === 'function' ? what() : what)}`);
    // Sur le disque : rien hors de `dest`, aucun lien.
    for (const f of listTree(jail)) {
      if (f.full === zipFile) continue;
      if (f.link) finding(R, 'unsafe', 'lien symbolique créé à l’extraction', `${f.full} — entrée : ${show(typeof what === 'function' ? what() : what)}`);
      if (!f.full.startsWith(dest + path.sep)) {
        finding(R, 'unsafe', 'fichier écrit HORS du dossier de destination', `${f.full} — entrée : ${show(typeof what === 'function' ? what() : what)}`);
        fs.rmSync(f.full, { force: true });
      }
    }
    for (const stray of ['mg-fuzz-evil', 'evil']) {
      const p = path.join(TMP, stray);
      if (fs.existsSync(p)) {
        finding(R, 'unsafe', 'fichier écrit HORS du dossier de destination', `${p} — entrée : ${show(typeof what === 'function' ? what() : what)}`);
        fs.rmSync(p, { recursive: true, force: true });
      }
    }
    if (inflateSeen.max > 8 * 1024 * 1024 && inflateSeen.max > 4 * declared) finding(R, 'memory', 'décompression sans plafond (bombe)', `${(inflateSeen.max / 1048576).toFixed(0)} Mo produits pour ${declared} octets annoncés (archive de ${bytes.length} octets) — entrée : ${show(typeof what === 'function' ? what() : what)}`);
    const grown = process.memoryUsage().rss - rss0;
    if (grown > 600 * 1024 * 1024) finding(R, 'memory', 'mémoire : plus de 600 Mo pour une petite archive', `+${(grown / 1048576).toFixed(0)} Mo — entrée : ${show(typeof what === 'function' ? what() : what)}`);
    fs.rmSync(dest, { recursive: true, force: true });
    return res;
  }

  // Archive valide de référence, écrite par le module lui-même.
  const validFile = path.join(jail, 'valid.zip');
  await backup.writeZip(validFile, [
    { name: 'db.json', data: Buffer.from(JSON.stringify({ version: 2, books: [] })) },
    { name: 'library/b1/livre.epub', data: Buffer.from('contenu '.repeat(200)) },
    { name: 'library/b1/cover.png', data: rbytes(300) },
    { name: 'vide.txt', data: Buffer.alloc(0) },
  ]);
  const valid = fs.readFileSync(validFile);
  fs.rmSync(validFile);
  {
    const r = await tryZip('archive valide', valid);
    if (r.err || r.out.length !== 4) finding(R, 'crash', 'l’archive valide de référence est refusée', show(r.err ? head(r.err) : r.out));
  }

  // (a) Octets mutés.
  for (let i = 0, n = iters(1500); i < n; i++) {
    const b = mutateBytes(valid);
    await tryZip(() => `archive valide mutée (${b.length} o) base64:${b.toString('base64').slice(0, 200)}`, b);
  }
  // (b) Octets au hasard, avec ou sans signature de fin.
  for (let i = 0, n = iters(300); i < n; i++) {
    let b = rbytes(int(600));
    if (chance(0.7)) {
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      for (let k = 4; k < 22; k++) end[k] = chance(0.5) ? 0 : int(256);
      if (chance(0.5)) end.writeUInt32LE(pick(BOUNDS) >>> 0, pick([12, 16]));
      if (chance(0.3)) end.writeUInt16LE(0xffff, 10);
      b = Buffer.concat([b, end, chance(0.3) ? rbytes(int(40)) : Buffer.alloc(0)]);
    }
    await tryZip(() => `octets au hasard base64:${b.toString('base64').slice(0, 200)}`, b);
  }
  // (c) Noms hostiles : jamais d'écriture hors de la destination.
  const abs = path.join(TMP, 'mg-fuzz-evil');
  const NAMES = [
    '../evil', '../../evil', 'a/../../evil', 'a/b/../../../evil', '/abs-evil', abs, '//srv/share/evil', 'C:\\evil', 'C:evil', 'c:/evil', '..\\evil', 'a\\..\\..\\evil', '\\evil', '\\\\srv\\share\\evil',
    'a/./b', 'a//b', './a', 'a/.', 'a/..', '.', '..', '...', ' ', '', 'a\u0000b', '\u0000', 'a\nb', 'a\u001fb', 'a/', 'a\\', '/', '\\',
    'x'.repeat(1024), 'x'.repeat(1025), 'd/'.repeat(300) + 'f', 'x'.repeat(300), 'CON', 'NUL.txt', 'a:b', 'a/C:/b', 'a.', 'a ', '~/evil', '$HOME/evil', '%2e%2e/evil', '．．/evil', '..\u2215evil', 'a/\u202e/b',
    Buffer.from([0x2e, 0x2e, 0x2f, 0x65]), Buffer.from([0xc0, 0xae, 0xc0, 0xae, 0x2f, 0x65]), Buffer.from([0x2e, 0x2e, 0xc0, 0xaf, 0x65]), Buffer.from([0xff, 0xfe, 0x2f, 0x2e, 0x2e]), Buffer.from([0x2e, 0x2e, 0x5c, 0x65]),
  ];
  for (const name of NAMES) {
    for (const flags of [0x0800, 0]) {
      const ents = [{ name: 'ok.txt', data: Buffer.from('ok') }, { name, data: Buffer.from('evil'), flags, method: pick([0, 8]) }];
      await tryZip(`nom d’entrée ${show(Buffer.isBuffer(name) ? name : JSON.stringify(name))} (${flags ? 'UTF-8' : 'latin1'})`, rawZip(ents));
      // Nom sûr dans le répertoire central, hostile dans l'en-tête local (seul le premier doit compter).
      await tryZip(`nom local ${show(Buffer.isBuffer(name) ? name : JSON.stringify(name))} ≠ nom central`, rawZip([{ name: 'sur.txt', localName: name, data: Buffer.from('evil'), flags }]));
    }
  }
  // (d) Liens symboliques (bits de mode), entrées chiffrées, méthodes inconnues.
  for (const ext of [0o120777 << 16, (0o120000 << 16) | 0x10, 0o120644 << 16]) for (const madeBy of [0x0314, 0x0014, 0x1314]) await tryZip(`lien symbolique (ext ${(ext >>> 0).toString(16)}, madeBy ${madeBy.toString(16)})`, rawZip([{ name: 'lien', data: Buffer.from('/etc/passwd'), ext: ext >>> 0, madeBy }]), { expectReject: true });
  await tryZip('entrée chiffrée', rawZip([{ name: 'a', data: Buffer.from('x'), flags: 0x0801 }]), { expectReject: true });
  for (const m of [1, 9, 12, 14, 93, 99, 0xffff]) await tryZip(`méthode ${m}`, rawZip([{ name: 'a', data: Buffer.from('x'), method: m, body: Buffer.from('x') }]), { expectReject: true });
  // (e) Tailles et positions mensongères, ZIP64, compteurs.
  const one = (over, opts) => rawZip([{ name: 'a.txt', data: Buffer.from('bonjour '.repeat(50)), method: 8, ...over }], opts);
  const SIZES = [0, 1, 0x7fffffff, 0x80000000, 0xfffffffe];
  for (const v of SIZES) {
    await tryZip(`taille compressée annoncée ${v}`, one({ csize: v }));
    await tryZip(`taille décompressée annoncée ${v}`, one({ usize: v }));
    await tryZip(`position annoncée ${v}`, one({ at: v }));
    await tryZip(`fin : nombre d’entrées ${v & 0xffff}`, one({}, { count: v & 0xffff }));
    await tryZip(`fin : taille du répertoire ${v}`, one({}, { cdSize: v }));
    await tryZip(`fin : position du répertoire ${v}`, one({}, { cdOff: v }));
  }
  const BIG = [0n, 1n, 2n ** 31n, 2n ** 32n, 2n ** 40n, 2n ** 53n - 1n, 2n ** 53n, 2n ** 63n, 2n ** 64n - 1n];
  for (const v of BIG) {
    await tryZip(`ZIP64 : taille compressée ${v}`, one({ csize: 0xffffffff, extra: zip64Extra(v) }));
    await tryZip(`ZIP64 : taille décompressée ${v}`, one({ usize: 0xffffffff, extra: zip64Extra(v) }));
    await tryZip(`ZIP64 : position ${v}`, one({ at: 0xffffffff, extra: zip64Extra(v) }));
    await tryZip(`ZIP64 : les trois ${v}`, one({ usize: 0xffffffff, csize: 0xffffffff, at: 0xffffffff, extra: zip64Extra(v, v, v) }));
    await tryZip(`fin ZIP64 : nombre ${v}`, one({}, { zip64: { count: v } }));
    await tryZip(`fin ZIP64 : taille du répertoire ${v}`, one({}, { zip64: { cdSize: v } }));
    await tryZip(`fin ZIP64 : position du répertoire ${v}`, one({}, { zip64: { cdOff: v } }));
    await tryZip(`fin ZIP64 : position du localisateur ${v}`, one({}, { zip64: { locOff: v } }));
  }
  await tryZip('ZIP64 : champ supplémentaire tronqué', one({ usize: 0xffffffff, extra: Buffer.from([1, 0, 8, 0, 1, 2]) }));
  await tryZip('ZIP64 : champ supplémentaire de longueur 0xffff', one({ usize: 0xffffffff, extra: Buffer.from([1, 0, 0xff, 0xff]) }));
  // Entrées qui se recouvrent, doublons, fichier et dossier du même nom.
  {
    const data = Buffer.from('recouvrement '.repeat(30));
    await tryZip('deux entrées sur le même en-tête local', rawZip([{ name: 'a', data }, { name: 'b', data, at: 0 }]));
    await tryZip('doublon de nom', rawZip([{ name: 'a', data }, { name: 'a', data: Buffer.from('second') }]));
    await tryZip('fichier puis dossier du même nom', rawZip([{ name: 'a', data }, { name: 'a/b', data }]));
    await tryZip('dossier puis fichier du même nom', rawZip([{ name: 'a/b', data }, { name: 'a', data }]));
    await tryZip('répertoire central qui pointe sur lui-même', rawZip([{ name: 'a', data, at: data.length + 31 }]));
    await tryZip('commentaire contenant une fausse fin', rawZip([{ name: 'a', data }], { comment: rawZip([{ name: '../evil', data }]) }));
    await tryZip('10 000 entrées vides', rawZip(Array.from({ length: 10000 }, (_, i) => ({ name: 'f' + i }))));
  }
  // (f) Bombe : 96 Mo de zéros compressés (≈ 93 Ko), taille annoncée 10 octets.
  {
    const body = zlib.deflateRawSync(Buffer.alloc(96 * 1024 * 1024), { level: 9 });
    await tryZip('bombe : 96 Mo annoncés 10 octets', rawZip([{ name: 'bombe.bin', data: Buffer.alloc(0), body, method: 8, csize: body.length, usize: 10, crc: 0 }]));
  }
  // (g) safeEntryName : sémantique Windows (lettre de lecteur ailleurs qu'en tête, flux « a:b »…).
  const winRoot = 'C:\\dest';
  const winBad = new Set();
  const winEscape = new Set();
  const segs = ['a', '..', '.', '', 'C:', 'c:', 'D:', 'a:b', 'CON', 'NUL', 'a.', 'a ', '\\', '/', '..\\', 'x\u0000', ' ', 'é', '...', '~', 'aux.txt', '\\\\?\\C:', 'a\tb'];
  for (let i = 0, n = iters(20000); i < n; i++) {
    const name = Array.from({ length: 1 + int(4) }, () => pick(segs)).join(pick(['/', '\\', '/', '']));
    R.iterations++;
    let safe;
    try {
      safe = backup.safeEntryName(name);
    } catch (e) {
      finding(R, 'crash', 'safeEntryName lève', `${show(JSON.stringify(name))} — ${head(e)}`);
      continue;
    }
    if (safe === null) {
      R.rejects++;
      continue;
    }
    R.accepts++;
    const posix = path.posix.resolve('/dest', ...safe.split('/'));
    if (!posix.startsWith('/dest/')) finding(R, 'unsafe', 'safeEntryName accepte un nom qui sort du dossier (POSIX)', show(JSON.stringify(name)));
    const win = path.win32.resolve(winRoot, ...safe.split('/'));
    // Sous Windows, « a:b » désigne un autre lecteur : safeEntryName le laisse passer, et seul le contrôle
    // startsWith d'extractZip (rejoué ici) l'arrête. Noté, non compté comme trouvaille tant qu'il tient.
    if (!win.toLowerCase().startsWith(winRoot.toLowerCase() + '\\')) winEscape.add(`${JSON.stringify(name)} → ${win}`);
    if (safe.split('/').some((p) => /:/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))) winBad.add(safe);
  }
  for (const v of [null, undefined, 1, {}, [], ['a'], Buffer.from('a')]) {
    R.iterations++;
    try {
      if (backup.safeEntryName(v) !== null) finding(R, 'unsafe', 'safeEntryName accepte une valeur qui n’est pas une chaîne', show(v));
      else R.rejects++;
    } catch (e) {
      finding(R, 'crash', 'safeEntryName lève', `${show(v)} — ${head(e)}`);
    }
  }
  if (winBad.size) R.notes.push(`safeEntryName accepte des noms spéciaux sous Windows (flux « a:b », lecteur relatif « C: » hors tête, CON/NUL, point ou espace final) : ${[...winBad].slice(0, 8).map((x) => JSON.stringify(x)).join(', ')} — bloqués ensuite par le contrôle startsWith d’extractZip pour les sorties de dossier, mais pas les flux ni les périphériques`);
  if (winEscape.size) R.notes.push(`safeEntryName seul laisse passer ${winEscape.size} noms qui, sous Windows, désignent un autre lecteur (ex. ${[...winEscape][0]}) : rattrapés seulement par le contrôle startsWith d’extractZip`);
  R.notes.push(`zlib.inflateRaw appelé ${inflateSeen.capped ? 'avec' : 'SANS'} maxOutputLength`);
}

// ═════════════════════════════════════════════════════════════
// 3. Manifeste des mises à jour (electron/updater.cjs)
// ═════════════════════════════════════════════════════════════
async function fuzzUpdater() {
  const R = makeReport('updater verifyManifest');
  const up = require(path.join(ROOT, 'electron/updater.cjs'));
  const realKey = require(path.join(ROOT, 'electron/update-key.cjs'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const sign = (bytes) => crypto.sign(null, Buffer.from(bytes), privateKey).toString('base64');
  const base = {
    version: '9.9.9',
    files: Object.fromEntries(up.PLATFORM_KEYS.map((k) => [k, { name: k.startsWith('mac') ? 'Marginalia-9.9.9.dmg' : 'Marginalia-9.9.9-setup.exe', sha256: 'ab'.repeat(32), size: 1000 }])),
    minMacOS: '12.0',
  };
  const baseBytes = Buffer.from(JSON.stringify(base));
  const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
  /** Un manifeste accepté doit respecter tous les invariants, quel que soit ce qui était signé. */
  const checkOk = (signed) => (res) => {
    if (!res || typeof res !== 'object' || typeof res.ok !== 'boolean') return `résultat mal formé — ${show(res)}`;
    if (!res.ok) return typeof res.code === 'string' && typeof res.reason === 'string' ? null : `refus sans code ni raison — ${show(res)}`;
    if (!signed) return 'manifeste accepté SANS signature valide';
    const m = res.manifest;
    if (!/^\d+(\.\d+){0,3}$/.test(m.version)) return `version acceptée — ${show(m.version)}`;
    if (Object.getPrototypeOf(m.files) !== Object.prototype) return 'files : prototype modifié';
    for (const [k, f] of Object.entries(m.files)) {
      if (!up.PLATFORM_KEYS.includes(k)) return `clé de plateforme acceptée — ${show(k)}`;
      if (typeof f.name !== 'string' || !NAME.test(f.name) || f.name.includes('..') && /[\\/]/.test(f.name)) return `nom de fichier accepté — ${show(f.name)}`;
      if (!/^[0-9a-f]{64}$/.test(f.sha256)) return `sha256 accepté — ${show(f.sha256)}`;
      if (!Number.isSafeInteger(f.size) || f.size <= 0 || f.size > up.MAX_UPDATE_SIZE) return `taille acceptée — ${show(f.size)}`;
      if (Object.keys(f).length !== 3) return `champ en trop repris — ${show(f)}`;
    }
    if (m.minMacOS !== null && !/^\d+(\.\d+){0,2}$/.test(m.minMacOS)) return `minMacOS accepté — ${show(m.minMacOS)}`;
    if (({}).polluted !== undefined) return 'pollution de prototype';
    return null;
  };
  // Référence.
  const ref = up.verifyManifest(baseBytes, sign(baseBytes), pem, { current: '1.0.0' });
  if (!ref.ok) finding(R, 'crash', 'le manifeste valide de référence est refusé', show(ref));
  // (a) Contenu muté, correctement signé par une clé de test : seuls les invariants comptent.
  for (let i = 0, n = iters(6000); i < n; i++) {
    const log = [];
    let bytes;
    if (chance(0.8)) {
      try {
        bytes = Buffer.from(unraw(JSON.stringify(mutateJson(base, log))));
      } catch {
        continue;
      }
    } else bytes = mutateBytes(baseBytes);
    const opts = pick([{ current: '1.0.0' }, {}, undefined, { current: '9.9.9' }, { current: '1.0.0', expectedVersion: '9.9.9' }, { current: pick(EVIL_STRINGS) }, { expectedVersion: pick(EVIL_STRINGS) }]);
    await runCase(R, () => `manifeste signé : ${log.join(' ; ') || 'octets mutés ' + show(bytes)} — options ${show(opts)}`, () => up.verifyManifest(bytes, sign(bytes), pem, opts), { check: checkOk(true) });
  }
  // (b) Signature mutée ou absente, clé réelle de l'application : jamais accepté.
  const goodSig = sign(baseBytes);
  for (let i = 0, n = iters(6000); i < n; i++) {
    const t = int(8);
    let bytes = baseBytes;
    let sig = goodSig;
    let key = pem;
    if (t === 0) sig = mutateBytes(Buffer.from(goodSig, 'base64')).toString('base64');
    else if (t === 1) sig = rbytes(pick([0, 1, 63, 64, 65, 128])).toString('base64');
    else if (t === 2) sig = pick([null, undefined, '', ' ', 0, 1, {}, [], 'A'.repeat(88), 'A'.repeat(86) + '==', '=' + goodSig, goodSig + '\n', goodSig + 'A', goodSig.replace(/\+/g, '-').replace(/\//g, '_'), '\u0000' + goodSig, goodSig.slice(0, 44) + ' ' + goodSig.slice(44), Buffer.from(goodSig)]);
    else if (t === 3) bytes = mutateBytes(baseBytes);
    else if (t === 4) key = realKey; // bonne signature, mais par une autre clé que celle de l'application
    else if (t === 5) key = pick([null, undefined, '', 'x', pem.slice(0, 40), {}, 0, pem.replace('PUBLIC', 'PRIVATE'), realKey + pem]);
    else if (t === 6) bytes = pick([null, undefined, '', 'x', 0, {}, [], new Uint8Array(0), JSON.stringify(base), Buffer.alloc(up.MAX_MANIFEST_SIZE + 1, 0x20)]);
    else {
      bytes = rbytes(int(300));
      sig = rbytes(64).toString('base64');
      key = realKey;
    }
    // Reste valide : mêmes octets (chaîne ou Uint8Array comprises), même signature une fois décodée, même clé.
    const sameBytes = (typeof bytes === 'string' || bytes instanceof Uint8Array) && Buffer.from(bytes).equals(baseBytes);
    const sigTxt = sig == null ? '' : String(sig).trim();
    const sameSig = /^[A-Za-z0-9+/]+={0,2}$/.test(sigTxt) && Buffer.from(sigTxt, 'base64').equals(Buffer.from(goodSig, 'base64'));
    const stillValid = key === pem && sameBytes && sameSig;
    await runCase(R, () => `variante ${t} : octets ${show(bytes)} — signature ${show(sig)} — clé ${show(key).slice(0, 60)}`, () => up.verifyManifest(bytes, sig, key, { current: '1.0.0' }), {
      check: (res) => (res && res.ok && !stillValid ? 'manifeste accepté SANS signature valide' : checkOk(true)(res)),
    });
  }
  // (c) Options hostiles.
  for (const opts of [undefined, {}, { current: null }, { current: {} }, { current: 1 }, { current: [] }, { expectedVersion: {} }, { current: 'x'.repeat(100000) }, { current: '1.' .repeat(50000) }])
    await runCase(R, `options ${show(opts)}`, () => up.verifyManifest(baseBytes, goodSig, pem, opts), { check: checkOk(true) });
  for (const [a, b] of [['1.0', null], [null, null], [{}, []], ['1'.repeat(400), '1'], ['1e5', '100000'], ['v1', '1'], ['1.-1', '1'], ['١', '1'], ['1.0.0.0.0.0', '1']]) await runCase(R, `compareVersions(${show(a)}, ${show(b)})`, () => up.compareVersions(a, b), { check: (v) => (typeof v === 'number' && !Number.isNaN(v) ? null : `résultat ${show(v)}`) });
  for (let i = 0, n = iters(300); i < n; i++) {
    const m = mutateJson({ files: base.files }, []);
    const k = pick([...up.PLATFORM_KEYS, '__proto__', 'constructor', '', null]);
    await runCase(R, () => `selectFile(${show(m)}, ${show(k)})`, () => up.selectFile(m, k));
  }
}

// ═════════════════════════════════════════════════════════════
// 4. Coffre et espaces chiffrés (electron/vault.cjs, electron/spaces.cjs)
// ═════════════════════════════════════════════════════════════
async function fuzzVault() {
  const R = makeReport('vault  open / openLine / unwrapWithPassword / unwrapWithRecovery');
  const vault = require(path.join(ROOT, 'electron/vault.cjs'));
  const key = crypto.createHash('sha256').update('clé de fuzz').digest();
  const plain = Buffer.from('contenu secret '.repeat(20));
  const sealed = vault.seal(key, plain);
  const cleanOpen = (e) => e.message === 'Fichier chiffré invalide' || e.code === 'MG_BADKEY';
  const neverData = (orig) => (out) => (Buffer.isBuffer(out) && out.equals(orig) ? null : `données rendues pour un fichier altéré — ${show(out)}`);
  for (let i = 0, n = iters(20000); i < n; i++) {
    const t = int(5);
    let b;
    if (t === 0) b = rbytes(int(200));
    else if (t === 1) b = Buffer.concat([vault.MAGIC, rbytes(int(200))]);
    else if (t === 2) b = mutateBytes(sealed);
    else if (t === 3) b = sealed.subarray(0, int(sealed.length + 1));
    else b = Buffer.concat([sealed, rbytes(1 + int(8))]);
    const same = b.equals(sealed);
    await runCase(R, () => `open : ${show(b)}`, () => vault.open(key, b), { isClean: cleanOpen, check: same ? null : () => 'fichier altéré ACCEPTÉ (authentification contournée)' });
  }
  await runCase(R, 'open : fichier intact', () => vault.open(key, sealed), { check: neverData(plain) });
  for (const b of [Buffer.alloc(0), vault.MAGIC, Buffer.concat([vault.MAGIC, Buffer.alloc(12 + 16)]), Buffer.concat([vault.MAGIC, Buffer.alloc(12 + 15)]), new Uint8Array(sealed), null, undefined])
    await runCase(R, `open : ${show(b)}`, () => vault.open(key, b), { isClean: cleanOpen, check: (o) => (b && Buffer.from(b).equals(sealed) && Buffer.from(o).equals(plain) ? null : 'accepté') });
  // Lignes du journal.
  const line = vault.sealLine(key, 'ligne de journal');
  for (let i = 0, n = iters(3000); i < n; i++) {
    const l = chance(0.5) ? 'ENC1:' + mutateBytes(Buffer.from(line.slice(5), 'base64')).toString('base64') : 'ENC1:' + pick(['', '!', '====', 'AAAA', rbytes(int(80)).toString('base64'), rbytes(40).toString('hex'), line.slice(5, 20)]);
    await runCase(R, () => `openLine : ${show(l)}`, () => vault.openLine(key, l), { isClean: cleanOpen, check: (o) => (l === line && o === 'ligne de journal' ? null : 'ligne altérée ACCEPTÉE') });
  }
  // Enveloppes de clé lues dans keystore.json (fichier modifiable sur le disque).
  const rk = vault.newRecoveryKey();
  const wRec = vault.wrapWithRecovery(rk, key);
  for (let i = 0, n = iters(4000); i < n; i++) {
    const log = [];
    const w = JSON.parse(unraw(JSON.stringify(mutateJson(wRec, log))));
    await runCase(R, () => `unwrapWithRecovery : ${log.join(' ; ')}`, () => vault.unwrapWithRecovery(rk, w), { check: (o) => (o === null || (Buffer.isBuffer(o) && o.equals(key)) ? null : `clé rendue pour une enveloppe altérée — ${show(o)}`) });
  }
  for (const s of [null, undefined, '', 0, {}, [], 'O0O0-IL1L-' + 'A'.repeat(24), rk.toLowerCase(), ' ' + rk + '\n', rk.replace(/-/g, ''), 'É'.repeat(32), '\ud800'.repeat(32), 'ı'.repeat(32), 'ſ'.repeat(32)])
    await runCase(R, `normalizeRecoveryKey(${show(s)})`, () => vault.normalizeRecoveryKey(s), { check: (o) => (o === null || /^[0-9A-HJKMNP-TV-Z]{32}$/.test(o) ? null : `clé normalisée hors alphabet — ${show(o)}`) });
  // Mot de passe : paramètres scrypt hostiles (les valides coûtent 128 Mo et ~0,3 s : peu d'essais).
  const wPw = { kdf: 'scrypt', N: 2 ** 17, r: 8, p: 1, salt: rbytes(16).toString('base64'), iv: rbytes(12).toString('base64'), ct: rbytes(32).toString('base64'), tag: rbytes(16).toString('base64') };
  let heavy = 0;
  for (let i = 0, n = iters(1500); i < n; i++) {
    const log = [];
    const w = JSON.parse(unraw(JSON.stringify(mutateJson(wPw, log))));
    const costly = w && w.kdf === 'scrypt' && Number.isInteger(w.N) && w.N >= 2 ** 17;
    if (costly && heavy++ > 6) continue;
    await runCase(R, () => `unwrapWithPassword : ${log.join(' ; ')}`, () => vault.unwrapWithPassword('mot de passe', w), { check: (o) => (o === null ? null : `clé rendue pour une enveloppe au hasard — ${show(o)}`) });
  }
  for (const [N, p] of [[2 ** 18, 1], [2 ** 19, 1], [2 ** 20, 1], [2 ** 17, 4], [2 ** 18, 4], [2 ** 20, 4]])
    await runCase(R, `unwrapWithPassword : N=2^${Math.log2(N)}, p=${p} (accepté par le contrôle des paramètres)`, () => vault.unwrapWithPassword('mot de passe', { ...wPw, N, p }), { check: (o) => (o === null ? null : 'clé rendue') });
}

async function fuzzSpaces() {
  const R = makeReport('spaces open / openCapsule / ownerOf / unlock / isSpaceId');
  const spaces = require(path.join(ROOT, 'electron/spaces.cjs'));
  const vault = require(path.join(ROOT, 'electron/vault.cjs'));
  const sk = crypto.createHash('sha256').update('sk de fuzz').digest();
  const plain = Buffer.from('fichier d’espace '.repeat(20));
  const sealed = spaces.seal(sk, 'ws1', plain);
  const capsule = spaces.sealCapsule(sk, 'ws1', JSON.stringify({ drafts: [1, 2, 3] }));
  const cleanOpen = (e) => e.message === 'Fichier d’espace chiffré invalide' || e.code === 'MG_BADKEY';
  for (let i = 0, n = iters(20000); i < n; i++) {
    const t = int(6);
    let b;
    if (t === 0) b = rbytes(int(200));
    else if (t === 1) b = Buffer.concat([spaces.MAGIC, rbytes(int(200))]);
    else if (t === 2) b = mutateBytes(sealed);
    else if (t === 3) b = sealed.subarray(0, int(sealed.length + 1));
    else if (t === 4) b = Buffer.concat([sealed.subarray(0, 16), rbytes(12 + 16 + int(64))]); // bonne marque, reste au hasard
    else b = Buffer.concat([sealed, rbytes(1 + int(8))]);
    const same = b.equals(sealed);
    const ws = chance(0.9) ? 'ws1' : pick(['ws2', '', '__proto__', 'x'.repeat(5000)]);
    await runCase(R, () => `open(${show(ws)}) : ${show(b)}`, () => spaces.open(sk, ws, b), { isClean: cleanOpen, check: same && ws === 'ws1' ? null : () => 'fichier altéré ACCEPTÉ (authentification contournée)' });
    await runCase(R, () => `ownerOf : ${show(b)}`, () => spaces.ownerOf(sk, b, ['ws0', 'ws1', '__proto__']), { check: (o) => (o === null || (o === 'ws1' && b.length >= 16 && b.subarray(0, 16).equals(sealed.subarray(0, 16))) ? null : `propriétaire rendu — ${show(o)}`) });
  }
  const cleanCapsule = (e) => cleanOpen(e) || /^Z_|ERR_BUFFER_TOO_LARGE/.test(String(e.code));
  for (let i = 0, n = iters(4000); i < n; i++) {
    const t = int(4);
    const c = t === 0 ? mutateBytes(Buffer.from(capsule, 'base64')).toString('base64') : t === 1 ? rbytes(int(120)).toString('base64') : t === 2 ? pick([null, undefined, '', 0, {}, [], '!!!', capsule.slice(0, 20), capsule + capsule, capsule.replace(/A/g, '-')]) : Buffer.concat([spaces.MAGIC, rbytes(int(120))]).toString('base64');
    await runCase(R, () => `openCapsule : ${show(c)}`, () => spaces.openCapsule(sk, 'ws1', c), { isClean: cleanCapsule, check: (o) => (o === '{"drafts":[1,2,3]}' && Buffer.from(String(c), 'base64').equals(Buffer.from(capsule, 'base64')) ? null : 'capsule altérée ACCEPTÉE') });
  }
  // Capsule authentique mais qui se décompresse en 1 Go + 1 : plafond MAX_CAPSULE tenu ?
  {
    const bomb = spaces.seal(sk, 'ws1', zlib.deflateRawSync(Buffer.alloc(64 * 1024 * 1024)));
    await runCase(R, 'openCapsule : 64 Mo décompressés (authentique)', () => spaces.openCapsule(sk, 'ws1', bomb.toString('base64')).length, { isClean: cleanCapsule });
  }
  for (const id of [...EVIL_STRINGS, null, undefined, 1, {}, [], ['a'], 'a'.repeat(121), 'a'.repeat(122), 'ok-id_1.2']) {
    R.iterations++;
    let ok;
    try {
      ok = spaces.isSpaceId(id);
    } catch (e) {
      finding(R, 'crash', 'isSpaceId lève', `${show(id)} — ${head(e)}`);
      continue;
    }
    if (!ok) R.rejects++;
    else {
      R.accepts++;
      if (typeof id !== 'string' || /[\\/\0]|\.\./.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) finding(R, 'unsafe', 'isSpaceId accepte un id dangereux', show(id));
      else if (/\.$/.test(id)) R.notes.push(`isSpaceId accepte ${JSON.stringify(id)} (point final : dossier ambigu sous Windows)`);
    }
  }
  // Fichier de clés (spaces.json) muté : jamais de clé rendue, jamais d'exception.
  const ksBase = { v: 1, keyId: vault.keyId(sk), createdAt: 'x', password: { kdf: 'scrypt', N: 2 ** 17, r: 8, p: 1, salt: rbytes(16).toString('base64'), iv: rbytes(12).toString('base64'), ct: rbytes(32).toString('base64'), tag: rbytes(16).toString('base64') }, recovery: vault.wrapWithRecovery(vault.newRecoveryKey(), sk), system: null };
  let heavy = 0;
  for (let i = 0, n = iters(1500); i < n; i++) {
    const log = [];
    const ks = JSON.parse(unraw(JSON.stringify(mutateJson(ksBase, log))));
    const secret = chance(0.5) ? vault.newRecoveryKey() : pick(['mot de passe', '', 'x'.repeat(10000), null, 1, {}]);
    const costly = ks && ks.password && ks.password.kdf === 'scrypt' && Number.isInteger(ks.password.N) && ks.password.N >= 2 ** 17 && typeof secret === 'string' && secret;
    if (costly && heavy++ > 6) continue;
    await runCase(R, () => `unlock : ${log.join(' ; ')} — secret ${show(secret)}`, () => spaces.unlock(ks, secret), { check: (o) => (o === null ? null : `clé rendue — ${show(o)}`) });
  }
}

// ═════════════════════════════════════════════════════════════
// 5. Noms de polices (electron/fontnames.cjs)
// ═════════════════════════════════════════════════════════════
async function fuzzFonts() {
  const R = makeReport('fonts  familiesOfFile');
  const fonts = require(path.join(ROOT, 'electron/fontnames.cjs'));
  const file = path.join(TMP, 'f.ttf');
  /** Police minimale valide : une table « name » avec les enregistrements donnés. */
  function makeFont(records, { numTables = 1, tag = 0x00010000, nameLen = null, strOff = null, count = null } = {}) {
    const strings = Buffer.concat(records.map((r) => r.raw));
    const t = Buffer.alloc(6 + records.length * 12);
    t.writeUInt16BE(count ?? records.length, 2);
    t.writeUInt16BE(strOff ?? t.length, 4);
    let off = 0;
    records.forEach((r, i) => {
      const p = 6 + i * 12;
      t.writeUInt16BE(r.platform, p);
      t.writeUInt16BE(r.encoding, p + 2);
      t.writeUInt16BE(r.lang, p + 4);
      t.writeUInt16BE(r.nameId, p + 6);
      t.writeUInt16BE(r.len ?? r.raw.length, p + 8);
      t.writeUInt16BE(r.off ?? off, p + 10);
      off += r.raw.length;
    });
    const name = Buffer.concat([t, strings]);
    const h = Buffer.alloc(12 + 16);
    h.writeUInt32BE(tag, 0);
    h.writeUInt16BE(numTables, 4);
    h.write('name', 12, 'latin1');
    h.writeUInt32BE(h.length, 12 + 8);
    h.writeUInt32BE(nameLen ?? name.length, 12 + 12);
    return Buffer.concat([h, name]);
  }
  const u16 = (s) => Buffer.from(s, 'utf16le').swap16();
  const valid = makeFont([{ platform: 3, encoding: 1, lang: 0x409, nameId: 1, raw: u16('Fuzz Sans') }, { platform: 1, encoding: 0, lang: 0, nameId: 1, raw: Buffer.from('Fuzz Sans') }]);
  const real = fs.readFileSync(path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf'));
  const check = (out) => {
    if (!Array.isArray(out) || !out.every((x) => typeof x === 'string')) return `résultat mal formé — ${show(out)}`;
    if (out.length > 64) return `plus de 64 familles — ${out.length}`;
    return null;
  };
  const odd = new Map();
  const go = async (what, bytes) => {
    fs.writeFileSync(file, bytes);
    const r = await runCase(R, what, () => fonts.familiesOfFile(file), { check });
    for (const f of r.out || []) {
      const k = f.length > 200 ? 'nom de plus de 200 caractères' : /[\u0000-\u001f\u007f]/.test(f) ? 'caractère de contrôle dans le nom' : /["'\;{}<>]/.test(f) ? 'guillemet, « ; », accolade ou chevron dans le nom' : null;
      if (k && !odd.has(k)) odd.set(k, show(JSON.stringify(f)));
    }
  };
  fs.writeFileSync(file, valid);
  const ref = await fonts.familiesOfFile(file);
  if (ref[0] !== 'Fuzz Sans') finding(R, 'crash', 'la police valide de référence n’est pas lue', show(ref));
  for (let i = 0, n = iters(3000); i < n; i++) {
    const t = int(5);
    const b = t === 0 ? rbytes(int(400)) : t === 1 ? mutateBytes(valid) : t === 2 ? mutateBytes(real.subarray(0, 4096)) : t === 3 ? Buffer.concat([Buffer.from('ttcf'), rbytes(4), Buffer.from([0, 0, 0, pick([0, 1, 64, 255])]), rbytes(int(300))]) : Buffer.concat([pick([Buffer.from([0, 1, 0, 0]), Buffer.from('OTTO'), Buffer.from('true')]), rbytes(int(300))]);
    await go(() => `police : ${show(b)}`, b);
  }
  // Cas dirigés : noms hostiles, tables géantes, collection qui pointe sur elle-même.
  await go('nom de 65 534 octets', makeFont([{ platform: 3, encoding: 1, lang: 0x409, nameId: 1, raw: u16('A'.repeat(32767)) }]));
  await go('nom avec guillemets et point-virgule', makeFont([{ platform: 3, encoding: 1, lang: 0x409, nameId: 1, raw: u16('x"; } body { background: url(http://127.0.0.1/x) } "') }]));
  await go('nom avec caractères de contrôle', makeFont([{ platform: 3, encoding: 1, lang: 0x409, nameId: 1, raw: u16('a\nb\u001b[31m\u202e') }]));
  await go('MacRoman : octets hauts', makeFont([{ platform: 1, encoding: 0, lang: 0, nameId: 1, raw: Buffer.from(Array.from({ length: 128 }, (_, i) => 128 + i)) }]));
  await go('65 535 enregistrements annoncés', makeFont([{ platform: 3, encoding: 1, lang: 0x409, nameId: 1, raw: u16('A') }], { count: 0xffff }));
  await go('table name annoncée 4 Mo', makeFont([{ platform: 3, encoding: 1, lang: 0x409, nameId: 1, raw: u16('A') }], { nameLen: 4 * 1024 * 1024 }));
  await go('512 tables annoncées', makeFont([{ platform: 3, encoding: 1, lang: 0x409, nameId: 1, raw: u16('A') }], { numTables: 512 }));
  {
    const ttc = Buffer.alloc(12 + 64 * 4);
    ttc.write('ttcf', 0, 'latin1');
    ttc.writeUInt32BE(0xffffffff, 8);
    for (let i = 0; i < 64; i++) ttc.writeUInt32BE(pick([0, 12, 0xffffffff, 0x7fffffff]), 12 + i * 4);
    await go('collection de 2^32-1 polices, positions hostiles', ttc);
    const self = Buffer.concat([ttc.subarray(0, 12), Buffer.alloc(64 * 4)]);
    await go('collection dont chaque police est la collection elle-même', self);
  }
  await go('fichier vide', Buffer.alloc(0));
  await runCase(R, 'fichier absent', () => fonts.familiesOfFile(path.join(TMP, 'absent.ttf')), { check });
  await runCase(R, 'dossier à la place du fichier', () => fonts.familiesOfFile(TMP), { check });
  if (odd.size) R.notes.push('noms rendus tels quels (à échapper avant tout usage dans du CSS ou du HTML) : ' + [...odd.entries()].map(([k, v]) => `${k} ${v}`).join(' ; '));
}

// ═════════════════════════════════════════════════════════════
// 6. Chiffrement des échanges par QR code (electron/wifi-crypto.cjs)
// ═════════════════════════════════════════════════════════════
async function fuzzWifi() {
  const R = makeReport('wifi   unb64u / open / openMeta / openFrame / framesOf / keyFromHash');
  const mg = require(path.join(ROOT, 'electron/wifi-crypto.cjs'));
  const key = new Uint8Array(crypto.createHash('sha256').update('wifi').digest());
  const id = new Uint8Array(16).fill(7);
  const msg = mg.seal(key, { ok: true, name: 'a.jpg' });
  const meta = mg.sealMeta(key, id, { name: 'a.jpg', kind: 'image' });
  const frame = mg.sealFrame(key, id, mg.DATA, 0, true, new Uint8Array(100).fill(1));
  const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const rstr = (n, alpha = b64) => Array.from({ length: n }, () => alpha[int(alpha.length)]).join('');
  const mutStr = (s) => {
    const a = [...s];
    for (let k = 0, n = 1 + int(3); k < n; k++) {
      const at = int(a.length + 1);
      const t = int(4);
      if (t === 0) a[at] = pick([...b64, '=', '+', '/', ' ', '\u0000', 'é']);
      else if (t === 1) a.splice(at, 1 + int(4));
      else if (t === 2) a.splice(at, 0, rstr(1 + int(5)));
      else a.length = at;
    }
    return a.join('');
  };
  for (let i = 0, n = iters(15000); i < n; i++) {
    const t = int(6);
    if (t === 0) {
      const s = chance(0.5) ? rstr(int(120)) : pick([null, undefined, 0, {}, [], '=', 'A', 'AA', 'AAA', 'AAAA=', '+/+/', ' AAAA', 'A'.repeat(100001), rstr(int(40), b64 + '=+/ \n')]);
      await runCase(R, () => `unb64u(${show(s)})`, () => mg.unb64u(s), { check: (o) => (o === null || (o instanceof Uint8Array && typeof s === 'string' && o.length === Math.floor((s.length * 3) / 4)) ? null : `résultat ${show(o)}`) });
    } else if (t === 1) {
      const s = chance(0.7) ? mutStr(msg) : pick([null, undefined, '', 0, {}, rstr(int(200)), msg + msg, ' ' + msg + '\n']);
      const intact = typeof s === 'string' && s.trim() === msg;
      await runCase(R, () => `open(${show(s)})`, () => mg.open(key, s), { check: (o) => (o === null || intact ? null : `message altéré ACCEPTÉ — ${show(o)}`) });
    } else if (t === 2) {
      const s = chance(0.7) ? mutStr(meta) : pick([null, undefined, '', rstr(int(200)), rstr(12000)]);
      // L'identifiant de flux fait toujours 16 octets chez l'appelant (wifi.cjs : 22 caractères base64url).
      const idd = chance(0.9) ? id : pick([new Uint8Array(16), new Uint8Array(16).fill(255)]);
      await runCase(R, () => `openMeta(id ${idd.length} o, ${show(s)})`, () => mg.openMeta(key, idd, s), { check: (o) => (o === null || (s === meta && idd === id) ? null : `méta altérée ACCEPTÉE — ${show(o)}`) });
    } else if (t === 3) {
      const box = chance(0.6) ? new Uint8Array(mutateBytes(Buffer.from(frame))) : new Uint8Array(rbytes(int(64)));
      const idx = pick([0, 0, 0, 1, -1, 2 ** 48, 2 ** 53, 0.5, NaN]);
      const last = chance(0.8);
      const same = Buffer.from(box).equals(Buffer.from(frame)) && idx === 0 && last;
      await runCase(R, () => `openFrame(index ${idx}, dernier ${last}, ${show(Buffer.from(box))})`, () => mg.openFrame(key, id, pick([mg.DATA, mg.DATA, mg.META, mg.SDATA, 0, 255]), idx, last, box), { check: (o) => (o === null || o === false || same ? null : (Buffer.from(o).equals(Buffer.alloc(100, 1)) ? 'bloc rejoué sous un autre nonce ACCEPTÉ' : `bloc altéré ACCEPTÉ — ${show(Buffer.from(o))}`)) });
    } else if (t === 4) {
      // Longueur : nombre fini (wifi.cjs écarte le reste avant l'appel), jusqu'à la limite d'un envoi.
      const len = pick([0, 1, 15, 16, 17, 1048576 + 16, 1048576 + 17, 1048576 + 31, 1048576 + 32, 2 * (1048576 + 16), -1, int(5e6), int(2 ** 32), 2 ** 31, 2 ** 32 - 1]);
      await runCase(R, () => `framesOf(${show(len)})`, () => mg.framesOf(len), {
        check: (o) => {
          if (o === null) return null;
          if (!Number.isInteger(o.count) || o.count < 1 || o.last < 16 || o.last > 1048576 + 16 || (o.count - 1) * (1048576 + 16) + o.last !== len) return `découpage incohérent pour ${len} — ${show(o)}`;
          return null;
        },
      });
    } else {
      const h = pick(['', '#k=' + rstr(43), '#k=' + rstr(42), '#k=' + rstr(44), 'k=' + rstr(43) + '&x=1', '#x=1&k=' + rstr(43), '#k=' + rstr(43) + '#k=' + rstr(43), null, undefined, {}, '#k=' + 'é'.repeat(43), '#' + 'k='.repeat(50000), '#k=' + rstr(43) + '%00']);
      await runCase(R, () => `keyFromHash(${show(h)})`, () => mg.keyFromHash(h), { check: (o) => (o === null || (o instanceof Uint8Array && o.length === 32) ? null : `clé mal formée — ${show(o)}`) });
    }
  }
}

// ═════════════════════════════════════════════════════════════
// 7. Analyseurs des modules réseau (réponses et messages reçus)
// ═════════════════════════════════════════════════════════════
async function fuzzNet() {
  const R = makeReport('net    share-net (poignée de main) / video-net / books-net');
  process.env.MARGINALIA_E2E = process.env.MARGINALIA_E2E || '1';
  let share, video, books;
  try {
    share = require(path.join(ROOT, 'electron/share-net.cjs'));
  } catch (e) {
    R.notes.push('share-net.cjs non chargé en Node : ' + head(e));
  }
  try {
    video = require(path.join(ROOT, 'electron/video-net.cjs'));
  } catch (e) {
    R.notes.push('video-net.cjs non chargé en Node : ' + head(e));
  }
  try {
    books = require(path.join(ROOT, 'electron/books-net.cjs'));
  } catch (e) {
    R.notes.push('books-net.cjs non chargé en Node : ' + head(e));
  }
  const anyErr = (e) => e instanceof Error;
  if (share) {
    const hs = share.handshake;
    const key = crypto.randomBytes(32);
    const good = hs.seal(key, 'LBL', { a: 1 });
    for (let i = 0, n = iters(4000); i < n; i++) {
      const s = chance(0.6) ? mutateBytes(Buffer.from(good, 'base64')).toString('base64') : pick([null, undefined, '', 0, {}, [], '!!!', rbytes(int(64)).toString('base64'), good.slice(0, 10), good.replace(/[+/]/g, '_')]);
      const same = typeof s === 'string' && Buffer.from(s, 'base64').equals(Buffer.from(good, 'base64'));
      await runCase(R, () => `handshake.unseal(${show(s)})`, () => hs.unseal(key, pick(['LBL', 'LBL', 'AUTRE']), s), { isClean: (e) => anyErr(e) && !RAW(e), check: (o) => (same ? null : `boîte altérée ACCEPTÉE — ${show(o)}`) });
    }
    for (let i = 0, n = iters(3000); i < n; i++) {
      const s = pick(['192.168.1.2', '192.168.1.2:8080', '256.1.1.1', '1.2.3.4:0', '1.2.3.4:65536', '1.2.3.4:99999', ' 1.2.3.4 ', '1.2.3.4\n', '1.2.3', '::1', 'localhost', null, undefined, {}, [], '1.2.3.4:' + '9'.repeat(5), '0.0.0.0', '01.02.03.04', '1.2.3.4:080', '１.2.3.4', pick(EVIL_STRINGS), '1.'.repeat(int(50000)) + 'x']);
      await runCase(R, () => `parseManualAddress(${show(s)})`, () => share.parseManualAddress(s), { isClean: (e) => e.code === 'address' || /adresse/i.test(e.message || ''), check: (o) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(o.address) && o.address.split('.').every((x) => Number(x) <= 255) && Number.isInteger(o.port) && o.port > 0 && o.port < 65536 ? null : `adresse acceptée — ${show(o)}`) });
    }
    for (const v of [...EVIL_STRINGS, null, undefined, 1, {}, [], 'a\u0000<b>\u007f', ' \t\n ']) await runCase(R, `cleanDevice(${show(v)})`, () => hs.cleanDevice(v), { check: (o) => (typeof o === 'string' && o.length > 0 && o.length <= 60 && !/[\u0000-\u001f\u007f<>]/.test(o) ? null : `nom d’appareil — ${show(o)}`) });
    for (const v of [null, undefined, '', '!!', 'AAAA', 0, {}, [], 'A'.repeat(100000)]) await runCase(R, `unb64(${show(v)})`, () => hs.unb64(v), { isClean: (e) => anyErr(e) && !RAW(e) });
  }
  if (video) {
    const jsonCap = { events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Bonjour' }] }, { tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: ' à tous' }] }] };
    const xmlCap = '<timedtext><body><p t="0" d="1000">Bonjour &amp; bienvenue</p><p t="1000" d="500"><s>à</s> tous</p></body></timedtext>';
    const checkCues = (o) => (Array.isArray(o) && o.every((c) => c && typeof c.t === 'string' && Number.isFinite(c.s) && c.s >= 0 && (c.d === undefined || (Number.isFinite(c.d) && c.d >= 0))) ? null : `sous-titres mal formés — ${show(o)}`);
    for (let i = 0, n = iters(4000); i < n; i++) {
      const log = [];
      const t = int(4);
      let body;
      try {
        body = t === 0 ? unraw(JSON.stringify(mutateJson(jsonCap, log))) : t === 1 ? mutateBytes(Buffer.from(xmlCap)).toString('utf8') : t === 2 ? pick(['{', '{}', '{"events":null}', '{"events":[null]}', '{"events":[1,"a",[]]}', '{"events":[{"segs":[null,1,{"utf8":1}]}]}', 'null', '[]', '', ' ', null, undefined, 0, {}, '<p t="1">x', '<p>'.repeat(2000), 'WEBVTT\n\n00:00.000 --> 00:01.000\nx', '<text start="1e999" dur="-1">x</text>', '<p t="99999999999999999999999">x</p>']) : xmlCap.replace('Bonjour', pick(EVIL_STRINGS));
      } catch {
        continue;
      }
      await runCase(R, () => `parseCaptions(${show(body)})`, () => video.parseCaptions(body), { check: checkCues });
    }
    for (let i = 0, n = iters(3000); i < n; i++) {
      const lines = Array.from({ length: int(12) }, () => pick(['0:00 Introduction', '1:23 - Partie', '12:34:56 Fin', 'Titre – 2:00', '(3:00) x', '99:99 y', '0:00', ':', '0:00 ' + pick(EVIL_STRINGS).slice(0, 100), ' '.repeat(int(150)) + '1:00' + ' '.repeat(int(150)), '-'.repeat(int(150)) + '0:00', '0:00 ' + '- '.repeat(70), 'a'.repeat(159) + ' 1:0', '1:00'.repeat(39)]));
      const d = chance(0.9) ? lines.join(pick(['\n', '\r\n'])) : pick([null, undefined, 0, {}, [], '\n'.repeat(100000)]);
      await runCase(R, () => `parseChapters(${show(d)})`, () => video.parseChapters(d), { check: (o) => (Array.isArray(o) && o.every((c) => Number.isFinite(c.s) && c.s >= 0 && typeof c.t === 'string' && c.t.length <= 140) ? null : `chapitres mal formés — ${show(o)}`) });
    }
    for (let i = 0, n = iters(1500); i < n; i++) {
      const obj = pick(['{"a":1}', '{"a":"}"}', '{"a":"\\""}', '{', '{{{{', '{"a":{"b":{}}}', '{}'.repeat(3), '{"__proto__":{"polluted":1}}', '{'.repeat(int(5000)), '{' + '"'.repeat(int(9)), '{"a":"' + '\\'.repeat(int(9)) + '"}']);
      const html = pick(['', 'var ', 'ytInitialPlayerResponse', 'x ytInitialPlayerResponse = ', 'ytInitialPlayerResponse ytInitialPlayerResponse = ']) + obj + pick(['', ';</script>', '}']);
      await runCase(R, () => `playerResponseFromPage(${show(html)})`, () => video.playerResponseFromPage(html), { check: () => (({}).polluted !== undefined ? 'pollution de prototype' : null) });
    }
    for (let i = 0, n = iters(500); i < n; i++) {
      const tr = mutateJson([{ baseUrl: 'https://x/y', languageCode: 'fr', kind: 'asr' }, { baseUrl: 'https://x/z', languageCode: 'en' }], []);
      await runCase(R, () => `pickTrack(${show(tr)})`, () => video.pickTrack(tr, pick(['fr', '', null, undefined, {}])));
    }
    for (const u of ['https://i.ytimg.com/vi/x/hq.jpg', 'http://i.ytimg.com/x', 'https://i.ytimg.com.evil.tld/x', 'https://evil.tld/i.ytimg.com', 'https://i.ytimg.com@evil.tld/', 'https://s1.dmcdn.net.evil.tld/', 'https://s1.dmcdn.net/x', 'javascript:alert(1)', 'file:///etc/passwd', 'https://I.YTIMG.COM./x', null, undefined, {}, '', 'https://i.ytimg.com\\@evil.tld/', 'https://evil.tld#@i.ytimg.com/', 'https://evil.tld\\.i.ytimg.com/'])
      await runCase(R, `thumbAllowed(${show(u)})`, () => video.thumbAllowed(u, false), {
        check: (ok) => {
          if (!ok) return null;
          const h = new URL(u).hostname;
          return h === 'i.ytimg.com' || h === 'i.vimeocdn.com' || /^s\d\.dmcdn\.net$/.test(h) || h === 'www.dailymotion.com' ? null : `adresse de vignette acceptée — ${show(u)}`;
        },
      });
  }
  if (books) {
    const g = { items: [{ volumeInfo: { title: 'T', subtitle: 'S', authors: ['A'], publisher: 'P', publishedDate: '2000-01-01', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9782080712345' }], imageLinks: { thumbnail: 'http://books.google.com/x' }, language: 'fr', pageCount: 10 } }] };
    const ol = { docs: [{ title: 'T', author_name: ['A'], publisher: ['P'], first_publish_year: 2000, isbn: ['9782080712345'], cover_i: 12, language: ['fre'] }] };
    const fns = Object.entries(books).filter(([k, f]) => typeof f === 'function' && /^from/.test(k));
    for (let i = 0, n = iters(4000); i < n; i++) {
      const [name, fn] = pick(fns);
      const log = [];
      const src = /google/i.test(name) ? g : ol;
      const input = chance(0.9) ? JSON.parse(unraw(JSON.stringify(mutateJson(src, log))).replace(/1e999|-1e999|1E400/g, '0')) : pick([null, undefined, 0, '', [], {}]);
      await runCase(R, () => `${name}(${show(input)})`, () => fn(input, '9782080712345'), { check: () => (({}).polluted !== undefined ? 'pollution de prototype' : null) });
    }
    for (let i = 0, n = iters(3000); i < n; i++) {
      const s = pick(['9782080712345', '978-2-08-071234-5', '2080712342', '208071234X', 'x'.repeat(100000), '9'.repeat(13), '', '９７８２０８０７１２３４５', '978 2 08 071234 5', pick(EVIL_STRINGS), rbytes(13).toString('latin1')]);
      for (const f of ['normalizeIsbn', 'cleanIsbn', 'isValidIsbn10', 'isValidIsbn13', 'isbn10to13', 'isbn13to10']) if (typeof books[f] === 'function') await runCase(R, () => `${f}(${show(s)})`, () => books[f](s), { check: (o) => (f === 'normalizeIsbn' && o != null && !/^97[89]\d{10}$/.test(String(o)) ? `ISBN normalisé — ${show(o)}` : null) });
    }
    for (const u of ['https://books.google.com/x', 'http://books.google.com/x', 'https://covers.openlibrary.org/b/id/1-L.jpg', 'https://covers.openlibrary.org.evil.tld/x', 'https://evil.tld/covers.openlibrary.org', 'javascript:alert(1)', 'file:///etc/passwd', 'https://books.google.com@evil.tld/', null, undefined, {}, '', 'http://127.0.0.1/x', 'http://169.254.169.254/latest', 'https://books.google.com\\@evil.tld/'])
      for (const f of ['coverUrlAllowed', 'coverRedirectAllowed'])
        if (typeof books[f] === 'function')
          await runCase(R, `${f}(${show(u)})`, () => books[f](u), {
            check: (ok) => {
              if (!ok) return null;
              const x = new URL(u);
              return x.protocol === 'https:' && /(^|\.)(google\.com|googleusercontent\.com|openlibrary\.org|archive\.org|bnf\.fr|gstatic\.com)$/.test(x.hostname) ? null : `adresse de couverture acceptée — ${show(u)}`;
            },
          });
  }
}

// ═════════════════════════════════════════════════════════════
// 8. Fonctions de texte (expressions régulières) : plantage, blocage, coût quadratique
// ═════════════════════════════════════════════════════════════
// Chaque appel tourne dans un fil d'exécution à part (ce même script, relancé en « worker ») : une
// expression régulière qui s'emballe ne peut pas être interrompue autrement.
const STYLES_HEAD = '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="X"><w:name w:val="x"/><w:basedOn w:val="Normal"/>';
const DOC_HEAD = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:annotationRef/></w:r></w:p>';
const DOC_TAIL = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1417" w:right="1417"/></w:sectPr></w:body></w:document>';
/** Fonctions sondées : nom → [module, appel(mod, s)]. */
const TEXT_FNS = {
  'ooxml.reorderXml': ['src/features/editor/ooxml.ts', (m, s) => m.reorderXml(s)],
  'ooxml.fixNamespaces': ['src/features/editor/ooxml.ts', (m, s) => m.fixNamespaces(s)],
  'ooxml.fixAttributes': ['src/features/editor/ooxml.ts', (m, s) => m.fixAttributes(s)],
  'ooxml.addMissingStyles': ['src/features/editor/ooxml.ts', (m, s) => m.addMissingStyles(s, s)],
  'ooxml.textWidth': ['src/features/editor/ooxml.ts', (m, s) => m.textWidth(s)],
  'ooxml.fixTocTabs': ['src/features/editor/ooxml.ts', (m, s) => m.fixTocTabs(s)],
  'ooxml.referencedFonts': ['src/features/editor/ooxml.ts', (m, s) => m.referencedFonts([s])],
  'ooxml.completeFontTable': ['src/features/editor/ooxml.ts', (m, s) => m.completeFontTable(s, ['Arial', 'X'])],
  'ooxml.splitFieldRuns': ['src/features/editor/ooxml.ts', (m, s) => m.splitFieldRuns(s)],
  'ooxml.patchStylesXml': ['src/features/editor/ooxml.ts', (m, s) => m.patchStylesXml(s, ['X', 'Normal', 'Absent'], { bold: true, fontSize: 12, fontFamily: 'Arial', before: 10 })],
  'ooxml.ensureStylesXml': ['src/features/editor/ooxml.ts', (m, s) => m.ensureStylesXml(s, { Y: '<w:style w:styleId="Y"/>' })],
  'ooxml.readStyleProps': ['src/features/editor/ooxml.ts', (m, s) => m.readStyleProps(s, 'X')],
  'ooxml.effectiveStyleProps': ['src/features/editor/ooxml.ts', (m, s) => m.effectiveStyleProps(s, null) && m.effectiveStyleProps(s, 'X')],
  'ooxml.styleRunProps': ['src/features/editor/ooxml.ts', (m, s) => m.styleRunProps(s, null) && m.styleRunProps(s, 'X')],
  'ooxml.defaultParagraphStyle': ['src/features/editor/ooxml.ts', (m, s) => m.defaultParagraphStyle(s)],
  'ooxml.replaceThemeFonts': ['src/features/editor/ooxml.ts', (m, s) => m.replaceThemeFonts(s, 'Arial')],
  'ooxml.setDocDefaultFontXml': ['src/features/editor/ooxml.ts', (m, s) => m.setDocDefaultFontXml(s, 'Arial')],
  'docx.fixSectPrXml': ['src/features/editor/docx.ts', (m, s) => m.fixSectPrXml(s)],
  'docx.countWords': ['src/features/editor/docx.ts', (m, s) => m.countWords(s)],
  'privateNotes.stripDocumentXml': ['src/features/editor/privateNotes.ts', (m, s) => m.stripDocumentXml(s)],
  'parse.stripFrontMatter': ['src/features/reader/html/parse.ts', (m, s) => m.stripFrontMatter(s)],
  'parse.resolvePath': ['src/features/reader/html/parse.ts', (m, s) => m.resolvePath('OEBPS/a/b.xhtml', s)],
  'metadata.prettifyFileName': ['src/features/library/metadata.ts', (m, s) => m.prettifyFileName(s)],
  'passages.splitBlocks': ['src/features/inbox/passages.ts', (m, s) => m.splitBlocks(s)],
  'passages.unquote': ['src/features/inbox/passages.ts', (m, s) => m.unquote(s)],
  'passages.isBoilerplate': ['src/features/inbox/passages.ts', (m, s) => m.isBoilerplate(s)],
  'paperGuess.foldWords': ['src/features/inbox/paperGuess.ts', (m, s) => m.foldWords(s)],
  'paperGuess.headerScore': ['src/features/inbox/paperGuess.ts', (m, s) => m.headerScore(s, { title: s.slice(0, 2000), author: 'Descartes' })],
  'video-net.parseCaptions': ['electron/video-net.cjs', (m, s) => m.parseCaptions(s)],
  'video-net.parseChapters': ['electron/video-net.cjs', (m, s) => m.parseChapters(s)],
  'video-net.playerResponseFromPage': ['electron/video-net.cjs', (m, s) => m.playerResponseFromPage('ytInitialPlayerResponse = ' + s)],
  'share-net.cleanDevice': ['electron/share-net.cjs', (m, s) => m.handshake.cleanDevice(s)],
  'books-net.cleanIsbn': ['electron/books-net.cjs', (m, s) => m.cleanIsbn(s)],
  'vault.normalizeRecoveryKey': ['electron/vault.cjs', (m, s) => m.normalizeRecoveryKey(s)],
  'sharePackage.findLocalPaperBook': ['src/features/share/sharePackage.ts', (m, s) => m.findLocalPaperBook({ title: s, author: s, edition: { publisher: s, year: s } }, [{ format: 'paper', title: s, author: '', edition: { publisher: '', year: '' } }])],
};
/** Gabarits : [nom, préfixe, suffixe]. Le fragment répété est placé entre les deux. */
const TEMPLATES = [
  ['nu', '', ''],
  ['document', DOC_HEAD, DOC_TAIL],
  ['document sans fin', DOC_HEAD, ''],
  ['styles', STYLES_HEAD, '</w:style></w:styles>'],
  ['styles sans fin', STYLES_HEAD, ''],
  ['en-tête md', '---\n', '\n--'],
];
const FRAGMENTS = [
  '<w:r>', '<w:r ', '</w:r>', '<w:r><w:t>a</w:t>', '<w:r><w:rPr>', '<w:r><w:rPr><w:b/></w:rPr><w:annotationRef/></w:r>', '<w:r><w:rPr>x', '<w:r><w:fldChar/><w:t>',
  '<w:pPr>', '<w:pPr><w:pStyle w:val="TOC1"/>', '<w:pStyle w:val="TOC1"', '<w:tab w:pos="99999"', '<w:sectPr', '<w:sectPr>', '<w:sectPr/>', '<w:footnotePr>', '<w:headerReference w:id="1"/>',
  '<w:style w:styleId="X"', '<w:style w:type="paragraph" w:styleId="X">', '<w:style ', '<w:basedOn w:val="X"/>', '<w:rPr>', '<w:pPr><w:spacing ', '<w:docDefaults>', '<w:rFonts w:ascii="A" ', '<w:rFonts ', '<w:font w:name="A"',
  '<w:comment w:id="1" ', '<w:comment ', '<w:shd ', '<w:shd w:fill="a" ', '<wp:anchor ', '<wp:anchor a="b" ', '<wp:positionH ', '<wp:wrapSquare ', '<w:nsid w:val="1"',
  '<a ', '<a b="c" ', ' b="c"', ' b=', ' b = "', '<a b="c"', '<a:b xmlns:a="x">', '<a>', '</a>', '<a/>', '<', '>', '"', "'", '=', '/', '&amp;', '&', '<!--', '<!-- -->', '<?', '<?x ?>', '<![CDATA[', ']]>',
  ' ', '\n', '\r\n', '\t', 'a', 'a ', 'a\n', 'a\n\n', '-', '---\n', '--- \n', '\n---', '+++\n', '« a » ', '"a" ', '“a” ', '> a\n', '- a\n', '1. a\n', 'p. 12\n', '12 janvier 2020\n', '0:00 a\n', '1:00 - ', 'é', 'é', ' ', '_', '.', '../', './', '%2e', '#', '?', ':', '{', '}', '{"a":', '\\', '\\"', '<p>', '<p t="1">', '<p t="1">a</p>', '<text start="1">', '9', '978-', 'O', 'I-', '\u0000', '😀', '\ud800',
];
const MB = 1024 * 1024;

if (!isMainThread) {
  // ── Côté « worker » : exécute les appels demandés et rend leur durée ──
  const mods = new Map();
  parentPort.on('message', async (job) => {
    const [modPath, call] = TEXT_FNS[job.fn];
    let ms = 0;
    let err = null;
    try {
      let mod = mods.get(modPath);
      if (!mod) {
        const full = path.join(ROOT, modPath);
        mod = modPath.endsWith('.cjs') ? require(full) : await import(full);
        mods.set(modPath, mod);
      }
      const input = job.text ?? job.pre + job.frag.repeat(Math.max(1, Math.round(job.size / job.frag.length))) + job.post;
      const t0 = performance.now();
      await call(mod, input);
      ms = performance.now() - t0;
    } catch (e) {
      err = { raw: RAW(e), head: head(e) };
    }
    parentPort.postMessage({ id: job.id, ms, err });
  });
}

async function fuzzText() {
  const R = makeReport('text   fonctions de texte des importateurs (ooxml, docx, md, boîte de réception, réseau)');
  let worker = null;
  let seq = 0;
  const spawn = () => {
    worker = new Worker(new URL(import.meta.url), { argv: process.argv.slice(2) });
    worker.on('error', () => {});
  };
  /** Un appel dans le fil à part ; au-delà de `limit` ms, le fil est tué : { timeout: true }. */
  const call = (job, limit = 8000) =>
    new Promise((resolve) => {
      if (!worker) spawn();
      const id = ++seq;
      const w = worker;
      const done = (v) => {
        clearTimeout(timer);
        w.off('message', onMsg);
        w.off('exit', onExit);
        resolve(v);
      };
      const timer = setTimeout(() => {
        w.off('exit', onExit);
        w.terminate();
        if (worker === w) worker = null;
        done({ timeout: true, ms: limit });
      }, limit);
      const onMsg = (m) => m.id === id && done(m);
      const onExit = () => {
        if (worker === w) worker = null;
        done({ timeout: true, ms: limit, died: true });
      };
      w.on('message', onMsg);
      w.on('exit', onExit);
      w.postMessage({ ...job, id });
    });
  // Passe 1 (toutes les combinaisons, 4 k puis 16 k caractères) : on retient, par fonction, la
  // combinaison dont le temps croît le plus vite. Passe 2 : elle seule est rejouée à 64 k, avec un délai.
  const [S1, S2, S3] = [4000, 16000, 64000];
  const LIMIT = 8000;
  const describe = (fn, tname, frag, size) => `${fn} sur gabarit « ${tname} » + ${JSON.stringify(frag)} × ${Math.round(size / frag.length)} (${size} car.)`;
  for (const fn of Object.keys(TEXT_FNS)) {
    const isXml = /ooxml|docx|privateNotes|video-net/.test(fn);
    let best = null;
    let suspects = 0;
    let dead = false;
    for (const [tname, pre, post] of TEMPLATES) {
      if (dead) break;
      if (!isXml && tname !== 'nu' && tname !== 'en-tête md') continue;
      if (isXml && tname === 'en-tête md') continue;
      for (const frag of FRAGMENTS) {
        const times = [];
        for (const size of [S1, S2]) {
          const r = await call({ fn, pre, post, frag, size }, LIMIT);
          R.iterations++;
          if (r.timeout) {
            finding(R, 'hang', `${fn} : plus de ${LIMIT / 1000} s sur ${size / 1000} k caractères`, `${describe(fn, tname, frag, size)} — durée précédente : ${times.map((t) => t.toFixed(0) + ' ms').join(', ') || 'aucune'}`);
            dead = true;
            break;
          }
          if (r.err) {
            if (r.err.raw) finding(R, 'crash', `${fn} : ${r.err.head.split(' | ')[0]}`, `${describe(fn, tname, frag, size)} — ${r.err.head}`);
            else R.rejects++;
            break;
          }
          R.accepts++;
          times.push(r.ms);
          if (r.ms > R.slowest.ms) R.slowest = { ms: r.ms, what: describe(fn, tname, frag, size) };
        }
        if (dead) break;
        if (times.length < 2) continue;
        const ratio = times[1] / Math.max(times[0], 0.05);
        if (times[1] > 6 && ratio > 9) {
          suspects++;
          const score = times[1] * ratio;
          if (!best || score > best.score) best = { tname, pre, post, frag, times, score };
        }
      }
    }
    if (!best || dead) continue;
    const r = await call({ fn, pre: best.pre, post: best.post, frag: best.frag, size: S3 }, LIMIT);
    R.iterations++;
    const t12 = `${S1 / 1000} k car. → ${best.times[0].toFixed(0)} ms, ${S2 / 1000} k → ${best.times[1].toFixed(0)} ms`;
    if (r.timeout) {
      const exp = Math.log(best.times[1] / Math.max(best.times[0], 0.05)) / Math.log(4);
      finding(R, 'hang', `${fn} : plus de ${LIMIT / 1000} s sur 64 k caractères (exposant ≈ ${exp.toFixed(1)})`, `gabarit « ${best.tname} » + ${JSON.stringify(best.frag)} répété : ${t12}, ${S3 / 1000} k → plus de ${LIMIT / 1000} s (fil tué) ; ${suspects} fragment(s) en cause`);
    } else if (!r.err) {
      if (r.ms > R.slowest.ms) R.slowest = { ms: r.ms, what: describe(fn, best.tname, best.frag, S3) };
      const exp = Math.log(Math.max(r.ms, 0.05) / Math.max(best.times[1], 0.05)) / Math.log(4);
      if (r.ms > 100 && exp > 1.6) {
        const at1MB = (r.ms * (MB / S3) ** exp) / 1000;
        finding(R, 'hang', `${fn} : coût sur-linéaire (exposant ≈ ${exp.toFixed(1)})`, `gabarit « ${best.tname} » + ${JSON.stringify(best.frag)} répété : ${t12}, ${S3 / 1000} k → ${r.ms.toFixed(0)} ms ; extrapolé à 1 Mo : ${at1MB > 3600 ? (at1MB / 3600).toFixed(1) + ' h' : at1MB.toFixed(0) + ' s'} ; ${suspects} fragment(s) en cause`);
      }
    }
  }
  if (worker) await worker.terminate();

  // Identifiants de style lus dans le fichier puis injectés dans une expression régulière.
  const { effectiveStyleProps, styleRunProps, readStyleProps } = await import('../src/features/editor/ooxml.ts');
  for (const evil of ['(', '[', '\\', '*', 'a{2,1}', '(?<n>', ')', 'X|Normal', '.*', '$', 'a+)+', '(a+)+$', 'X"[^>]*>(?:[^<]|<)*', '(?:(?:a*)*)*b']) {
    const styles = `${STYLES_HEAD.replace('w:val="Normal"/>', `w:val="${evil}"/>`)}</w:style><w:style w:type="paragraph" w:styleId="${evil}"><w:name w:val="e"/><w:basedOn w:val="${evil}x"/></w:style></w:styles>`;
    await runCase(R, `effectiveStyleProps : basedOn = ${JSON.stringify(evil)}`, () => effectiveStyleProps(styles, 'X'));
    await runCase(R, `styleRunProps : basedOn = ${JSON.stringify(evil)}`, () => styleRunProps(styles, 'X'));
    await runCase(R, `readStyleProps : id = ${JSON.stringify(evil)}`, () => readStyleProps(styles, evil));
  }
}

const TARGETS = { share: fuzzShare, backup: fuzzBackup, updater: fuzzUpdater, vault: fuzzVault, spaces: fuzzSpaces, fonts: fuzzFonts, wifi: fuzzWifi, net: fuzzNet, text: fuzzText };

// ═════════════════════════════════════════════════════════════
async function main() {
  const t0 = performance.now();
  for (const [name, fn] of Object.entries(TARGETS)) {
    if (!want(name)) continue;
    rnd = mulberry32(SEED ^ [...name].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7));
    const before = reports.length;
    const t = performance.now();
    try {
      await fn();
    } catch (e) {
      const r = makeReport(`${name}  (cible interrompue)`);
      finding(r, 'crash', 'la cible elle-même a levé', head(e));
    }
    for (const r of reports.slice(before)) r.ms = performance.now() - t;
  }
  let bad = 0;
  console.log(`\n══ Fuzz des importateurs — graine ${SEED}, échelle ${SCALE} ══`);
  for (const r of reports) {
    const n = r.crashes + r.hangs + r.unsafe;
    bad += n;
    console.log(`\n${n ? 'ÉCHEC' : 'OK   '} ${r.name}`);
    console.log(`      itérations ${r.iterations} · refus propres ${r.rejects} · acceptés ${r.accepts} · plantages ${r.crashes} · blocages ${r.hangs} · sorties dangereuses ${r.unsafe}`);
    console.log(`      entrée la plus lente : ${r.slowest.ms.toFixed(0)} ms — ${r.slowest.what}`);
    for (const [k, f] of r.findings) console.log(`      ✗ ${k}  (${f.count}×)\n          ${f.detail}`);
    for (const n2 of r.notes) console.log(`      · ${n2}`);
  }
  if (uncaught.length) {
    bad += uncaught.length;
    console.log(`\nÉCHEC exceptions échappées (hors de tout appel) : ${uncaught.length}`);
    for (const u of [...new Set(uncaught)].slice(0, 10)) console.log('      ✗ ' + u);
  }
  console.log(`\n${bad ? `ÉCHEC : ${bad} trouvaille(s)` : 'OK : aucun plantage, blocage ni sortie dangereuse'} — ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(bad ? 1 : 0);
}
if (isMainThread) main();
