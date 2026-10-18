// Noms de polices lus dans les fichiers (electron/fontnames.cjs, utilisé sous Windows à la place de
// PowerShell) : comparaison avec fc-list sur les polices de la machine, collections .ttc, fichiers
// illisibles, dossiers de Windows. Lancer : node scripts/test-fontnames.mjs
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fn = require(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../electron/fontnames.cjs'));
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};

const dirs = new Set();
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ttf|otf|ttc|otc)$/i.test(e.name)) { dirs.add(d); files.push(p); } } };
walk('/usr/share/fonts');
const t0 = Date.now();
const fams = await fn.familiesInDirs([...dirs]);
const ms = Date.now() - t0;
const fc = new Set(execFileSync('fc-list', [':', 'family']).toString().split('\n').flatMap((l) => l.split(',').map((x) => x.trim())).filter(Boolean));
const known = fams.filter((f) => fc.has(f));
ok(fams.length > 20 && known.length / fams.length > 0.97, `familles lues dans ${files.length} fichiers, conformes à fc-list`, `${known.length}/${fams.length} en ${ms} ms`);
ok(new Set(fams).size === fams.length, 'pas de doublon');
const ttc = files.find((f) => /\.ttc$/i.test(f));
if (ttc) ok((await fn.familiesOfFile(ttc)).length >= 2, 'collection .ttc : une famille par police', path.basename(ttc));
ok((await fn.familiesOfFile('/etc/hostname')).length === 0 && (await fn.familiesOfFile('/nexiste/pas.ttf')).length === 0, 'fichier non police ou absent : ignoré sans erreur');
const trunc = path.join(fs.mkdtempSync('/tmp/fn-'), 'coupee.ttf');
fs.writeFileSync(trunc, fs.readFileSync(files[0]).subarray(0, 40));
ok((await fn.familiesOfFile(trunc)).length === 0, 'fichier tronqué : ignoré');
const wd = fn.windowsFontDirs({ WINDIR: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' });
ok(wd.length === 2 && wd[0].endsWith('Fonts') && wd[1].includes(path.join('Microsoft', 'Windows', 'Fonts')), 'Windows : polices du système et de l’utilisateur', wd);
const src = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../electron/main.cjs'), 'utf8');
ok(!/powershell/i.test(src.replace(/pas de PowerShell[^\n]*/gi, '')), 'plus aucun appel à PowerShell dans l’app');
