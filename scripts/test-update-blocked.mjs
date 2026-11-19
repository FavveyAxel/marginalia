// Mise à jour automatique quand un autre programme tient ou retire le fichier (antivirus sous Windows) :
// un blocage passager (EBUSY, EPERM) est réessayé ; un blocage durable ou un fichier disparu donne un
// message qui nomme la cause et renvoie vers le site. Aucun contournement : l'antivirus garde le dernier mot.
// Lancer : node scripts/test-update-blocked.mjs
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const updater = createRequire(import.meta.url)(path.join(ROOT, 'electron/updater.cjs'));
const fsp = fs.promises;
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const busy = (code) => Object.assign(new Error(code), { code });

// 1. retryBusy : passager → réussi ; durable → l'erreur remonte ; autre erreur → pas de nouvel essai.
let n = 0;
ok((await updater.retryBusy(async () => { if (n++ < 3) throw busy('EBUSY'); return 'fait'; }, [5, 5, 5, 5])) === 'fait' && n === 4, 'fichier tenu trois fois puis libéré : réussi au 4e essai');
n = 0;
const e1 = await updater.retryBusy(async () => { n++; throw busy('EPERM'); }, [5, 5]).catch((e) => e);
ok(e1.code === 'EPERM' && n === 3, 'fichier tenu pour de bon : abandon après les essais prévus', n);
n = 0;
const e2 = await updater.retryBusy(async () => { n++; throw busy('ENOSPC'); }, [5, 5]).catch((e) => e);
ok(e2.code === 'ENOSPC' && n === 1, 'autre erreur (disque plein) : pas réessayée');

// 2. Téléchargement réel sur 127.0.0.1, avec un « antivirus » simulé sur fs.promises.rename.
const data = crypto.randomBytes(300000);
const sha256 = crypto.createHash('sha256').update(data).digest('hex');
const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-length': data.length }); s.end(data); }).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const url = `http://127.0.0.1:${srv.address().port}/Marginalia-win-x64-setup.exe`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-upd-'));
const dl = (name) => updater.downloadFile({ url, dest: path.join(dir, name), size: data.length, sha256, allowUrl: () => true });
const realRename = fsp.rename;
let calls = 0;
fsp.rename = async (a, b) => { if (calls++ < 2) throw busy('EBUSY'); return realRename(a, b); };
const r1 = await dl('a.exe').catch((e) => e);
ok(r1 && r1.file && fs.readFileSync(r1.file).equals(data) && calls === 3, 'analyse passagère du fichier (renommage refusé deux fois) : téléchargement réussi quand même', r1 && r1.message);
fsp.rename = async () => { throw busy('EPERM'); };
const t0 = Date.now();
const r2 = await dl('b.exe').catch((e) => e);
ok(r2 instanceof updater.UpdateError && r2.code === 'antivirus' && /antivirus/.test(r2.message) && /site/.test(r2.message), `blocage durable : erreur « antivirus », message qui renvoie vers le site (${Math.round((Date.now() - t0) / 100) / 10} s d’essais)`, r2 && r2.message);
ok(!fs.existsSync(path.join(dir, 'b.exe')), 'blocage durable : aucun fichier « prêt à installer » laissé');
fsp.rename = realRename;
// Fichier retiré juste après l'écriture (quarantaine).
const realStat = fsp.stat;
fsp.stat = async (f, ...a) => { if (String(f).endsWith('c.exe.part') && fs.existsSync(f) && fs.statSync(f).size === data.length) { fs.rmSync(f); } return realStat(f, ...a); };
const r3 = await dl('c.exe').catch((e) => e);
fsp.stat = realStat;
ok(r3 instanceof updater.UpdateError && r3.code === 'antivirus' && /disparu/.test(r3.message), 'fichier mis en quarantaine aussitôt écrit : erreur « antivirus », message clair', r3 && r3.message);
ok((await updater.verifyFile(path.join(dir, 'a.exe'), { size: data.length, sha256 })) === true && (await updater.verifyFile(path.join(dir, 'absent.exe'), { size: data.length, sha256 })) === false, 'vérification avant installation : fichier présent accepté, fichier retiré refusé');
srv.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
