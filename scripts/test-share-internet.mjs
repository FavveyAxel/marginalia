// « Envoyer une copie » par Internet : le protocole de share-net.cjs sur des flux iroh (pair à pair),
// sans réseau local commun (la découverte locale ne trouve rien). iroh en 127.0.0.1 avec un annuaire en
// mémoire (le conteneur de test n'a pas accès à Internet).
// Vérifie : envoi trouvé par le seul code ; accord ; 3 Mo reçus intacts ; code valable 2 minutes (ici
// raccourci) : une demande faite avant l'expiration va au bout, personne d'autre ne peut venir ensuite ;
// code sans demande : expiré ; un code d'envoi ne mène pas à une session « travailler à plusieurs » ;
// rien de lisible sur les flux iroh.
// Lancer : node scripts/test-share-internet.mjs
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const share = require(path.join(ROOT, 'electron/share-net.cjs'));
const collab = require(path.join(ROOT, 'electron/collab-net.cjs'));
const iroh = require(path.join(ROOT, 'electron/collab-iroh.cjs'));

const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await wait(25);
  }
  return false;
};
const errOf = (p) => p.then(() => null, (e) => e);

const wire = [];
const origWrite = iroh.IrohSocket.prototype._write;
iroh.IrohSocket.prototype._write = function (chunk, enc, cb) {
  wire.push(Buffer.from(chunk));
  return origWrite.call(this, chunk, enc, cb);
};

const registry = new Map();
const COST = { N: 1024, r: 8, p: 1 };
const nets = [];
const mkNet = () => {
  const n = iroh.createInternet({ local: true, registry, scrypt: COST, dialMs: 3000 });
  nets.push(n);
  return n;
};
const mkReceiver = (name) => {
  const net = mkNet();
  return Object.assign(share.createShareReceiver({ deviceName: () => name, targets: () => [], discoverMs: 300, scrypt: COST, internet: net }), { net });
};

// ── 1. Envoi trouvé par le code, accepté, reçu intact ──
const ev = [];
const BYTES = Buffer.concat([Buffer.from('contenu-secret-du-paquet'), crypto.randomBytes(3 * 1024 * 1024)]);
const sender = share.createShareSender({ emit: (e) => ev.push(e), port: 0, udpPort: 47950 + Math.floor(Math.random() * 40), scrypt: COST, internet: mkNet() });
const st = await sender.start({ bytes: BYTES, meta: { title: 'Parjure-titre-secret' } });
ok(st.open && st.internet === true && st.expiresAt - Date.now() > 115000 && st.expiresAt - Date.now() <= 120000, 'envoi ouvert : joignable par Internet, code valable 2 minutes', { internet: st.internet });
const marc = mkReceiver('Ordinateur-de-Marc');
const found = await marc.findShare(st.code);
ok(found.from.internet === true && found.meta.title === 'Parjure-titre-secret' && found.size === BYTES.length, 'destinataire : envoi trouvé par Internet grâce au code', found.from);
await until(() => ev.some((e) => e.type === 'request'));
ok(ev.find((e) => e.type === 'request').address === 'Internet', 'émetteur : demande venue d’Internet');
const got = marc.receiveShare(found.id);
sender.accept();
const bytes = await got;
ok(Buffer.from(bytes).equals(BYTES), '3 Mo reçus intacts');
{
  const t0 = Date.now();
  while (marc.net.guestOpen() && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 50));
  ok(!marc.net.guestOpen(), 'copie reçue : le point d’accès Internet du destinataire est fermé aussitôt');
}
await until(() => ev.some((e) => e.type === 'done'));
ok(ev.some((e) => e.type === 'done'), 'émetteur : « envoyé »');

// ── 2. Code expiré pendant une demande : elle va au bout ; personne d'autre ensuite ──
const ev2 = [];
const s2 = share.createShareSender({ emit: (e) => ev2.push(e), port: 0, udpPort: 47950 + Math.floor(Math.random() * 40), scrypt: COST, ttlMs: 2500, internet: mkNet() });
const st2 = await s2.start({ bytes: BYTES, meta: { title: 'Deuxième' } });
const ines = mkReceiver('Inès');
const f2 = await ines.findShare(st2.code);
await until(() => ev2.some((e) => e.type === 'code-expired'), 6000);
ok(ev2.some((e) => e.type === 'code-expired') && s2.isOpen(), 'une minute passée pendant la demande : code fermé, demande gardée');
const late = mkReceiver('Retardataire');
const eLate = await errOf(late.findShare(st2.code));
ok(eLate && ['expired', 'not-found'].includes(eLate.code), 'après l’expiration : personne d’autre ne trouve l’envoi', eLate && eLate.message);
const g2 = ines.receiveShare(f2.id);
s2.accept();
ok(Buffer.from(await g2).equals(BYTES), 'la demande faite avant l’expiration est acceptée et reçue');

// ── 3. Code sans demande : expiré ──
const ev3 = [];
const s3 = share.createShareSender({ emit: (e) => ev3.push(e), port: 0, udpPort: 47950 + Math.floor(Math.random() * 40), scrypt: COST, ttlMs: 800, internet: mkNet() });
const st3 = await s3.start({ bytes: Buffer.from('court'), meta: { title: 'Trois' } });
await until(() => ev3.some((e) => e.type === 'stopped'), 4000);
ok(ev3.some((e) => e.type === 'stopped' && e.reason === 'expired'), 'code sans demande : expiré au bout du délai');
const e3 = await errOf(mkReceiver('Paul').findShare(st3.code));
ok(e3 && ['expired', 'not-found'].includes(e3.code), 'code expiré : introuvable', e3 && e3.message);

// ── 4. Un code d'envoi ne mène pas à une session « travailler à plusieurs » (et inversement) ──
const s4 = share.createShareSender({ emit: () => {}, port: 0, udpPort: 47950 + Math.floor(Math.random() * 40), scrypt: COST, internet: mkNet() });
const st4 = await s4.start({ bytes: Buffer.from('x'), meta: { title: 'Quatre' } });
const g = collab.createCollabGuest({ emit: () => {}, targets: () => [], discoverMs: 300, scrypt: COST, waitMs: 0, internet: mkNet() });
const e4 = await errOf(g.find(st4.code, { profile: { name: 'X' } }));
ok(e4 && e4.code === 'not-found', 'code d’envoi saisi dans « Rejoindre » : aucune session', e4 && e4.code);
s4.stop();

// ── 5. Rien de lisible sur les flux iroh ──
const all = Buffer.concat(wire);
const seen = ['contenu-secret-du-paquet', 'Parjure-titre-secret', 'Ordinateur-de-Marc', st.code].filter((x) => all.includes(Buffer.from(x)));
ok(all.length > 3_000_000 && seen.length === 0, 'flux iroh : ni code, ni titre, ni nom d’appareil, ni contenu en clair', { octets: all.length, vus: seen });

sender.stop();
s2.stop();
await wait(300);
for (const n of nets) await n.shutdown();
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
process.exit(process.exitCode || 0);
