// ─────────────────────────────────────────────────────────────
// Noms de famille des polices installées, lus directement dans les fichiers (TrueType, OpenType,
// collections .ttc/.otc) : table « name » de chaque police. Aucun programme externe (pas de
// PowerShell, que les antivirus surveillent) : seulement des lectures de fichiers.
//
// Nom retenu : la famille « héritée » (nameID 1), celle des listes de polices de Windows et de GDI,
// que Chromium accepte dans font-family (« Arial Black », « Segoe UI Semibold »…). Anglais
// (Windows, 0x409) de préférence, sinon une autre langue Windows, sinon le nom Macintosh.
// ─────────────────────────────────────────────────────────────
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const FONT_EXT = new Set(['.ttf', '.otf', '.ttc', '.otc']);
const MAX_FONTS_PER_COLLECTION = 64;

async function readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return bytesRead === len ? buf : buf.subarray(0, bytesRead);
}

const MAC_ROMAN_HIGH =
  'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
function decodeMacRoman(buf) {
  let s = '';
  for (const b of buf) s += b < 128 ? String.fromCharCode(b) : MAC_ROMAN_HIGH[b - 128];
  return s;
}
function decodeUtf16be(buf) {
  let s = '';
  for (let i = 0; i + 1 < buf.length; i += 2) s += String.fromCharCode(buf.readUInt16BE(i));
  return s;
}

/** Famille (nameID 1) d'une police commençant à `offset` dans le fichier ; null si illisible. */
async function familyAt(fh, offset) {
  const head = await readAt(fh, offset, 12);
  if (head.length < 12) return null;
  const tag = head.readUInt32BE(0);
  // 0x00010000 (TrueType), 'OTTO' (CFF), 'true' (TrueType Apple)
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null;
  const numTables = head.readUInt16BE(4);
  if (!numTables || numTables > 512) return null;
  const dir = await readAt(fh, offset + 12, numTables * 16);
  let nameOff = -1;
  let nameLen = 0;
  for (let i = 0; i + 16 <= dir.length; i += 16) {
    if (dir.toString('latin1', i, i + 4) === 'name') {
      nameOff = dir.readUInt32BE(i + 8);
      nameLen = dir.readUInt32BE(i + 12);
      break;
    }
  }
  if (nameOff < 0 || nameLen < 6 || nameLen > 4 * 1024 * 1024) return null;
  const t = await readAt(fh, nameOff, nameLen);
  if (t.length < 6) return null;
  const count = t.readUInt16BE(2);
  const strOff = t.readUInt16BE(4);
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > t.length) break;
    const platform = t.readUInt16BE(r);
    const encoding = t.readUInt16BE(r + 2);
    const lang = t.readUInt16BE(r + 4);
    const nameId = t.readUInt16BE(r + 6);
    const len = t.readUInt16BE(r + 8);
    const off = t.readUInt16BE(r + 10);
    if (nameId !== 1) continue;
    const start = strOff + off;
    if (start + len > t.length) continue;
    const raw = t.subarray(start, start + len);
    let score;
    let value;
    if (platform === 3 && (encoding === 1 || encoding === 0 || encoding === 10)) {
      value = decodeUtf16be(raw);
      score = lang === 0x409 ? 3 : 2;
    } else if (platform === 0) {
      value = decodeUtf16be(raw);
      score = 1;
    } else if (platform === 1 && encoding === 0) {
      value = decodeMacRoman(raw);
      score = 0.5;
    } else continue;
    value = value.replace(/\0/g, '').trim();
    if (value && score > bestScore) {
      best = value;
      bestScore = score;
    }
  }
  return best;
}

/** Familles d'un fichier de police (plusieurs pour une collection .ttc). */
async function familiesOfFile(file) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const head = await readAt(fh, 0, 12);
    if (head.length < 12) return [];
    if (head.toString('latin1', 0, 4) === 'ttcf') {
      const n = Math.min(head.readUInt32BE(8), MAX_FONTS_PER_COLLECTION);
      const offs = await readAt(fh, 12, n * 4);
      const out = [];
      for (let i = 0; i + 4 <= offs.length; i += 4) {
        const f = await familyAt(fh, offs.readUInt32BE(i));
        if (f) out.push(f);
      }
      return out;
    }
    const f = await familyAt(fh, 0);
    return f ? [f] : [];
  } catch {
    return [];
  } finally {
    await fh?.close().catch(() => {});
  }
}

/** Familles de toutes les polices des dossiers donnés (premier niveau), sans doublon. */
async function familiesInDirs(dirs) {
  const files = [];
  for (const d of dirs) {
    if (!d) continue;
    const names = await fsp.readdir(d).catch(() => []);
    for (const n of names) if (FONT_EXT.has(path.extname(n).toLowerCase())) files.push(path.join(d, n));
  }
  const set = new Set();
  // Par petits lots : des centaines de fichiers, quelques Ko lus dans chacun.
  for (let i = 0; i < files.length; i += 32) {
    const batch = await Promise.all(files.slice(i, i + 32).map(familiesOfFile));
    for (const fams of batch) for (const f of fams) if (!f.startsWith('.')) set.add(f);
  }
  return [...set];
}

/** Dossiers de polices de Windows : système, puis polices installées pour l'utilisateur seul. */
function windowsFontDirs(env = process.env) {
  const win = env.WINDIR || env.SystemRoot || 'C:\\Windows';
  const dirs = [path.join(win, 'Fonts')];
  if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
  return dirs;
}

module.exports = { familiesOfFile, familiesInDirs, windowsFontDirs };
