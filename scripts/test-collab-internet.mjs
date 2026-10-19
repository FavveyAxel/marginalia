// « Travailler à plusieurs » par Internet : le même protocole que collab-net.cjs sur des flux iroh
// (electron/collab-iroh.cjs), en Node pur, sans réseau local commun : la découverte locale ne trouve
// rien, l'invité retrouve l'hôte par le seul code (annuaire en mémoire à la place de celui de n0, iroh
// en 127.0.0.1 sans relais : le conteneur de test n'a pas accès à Internet).
// Vérifie : rejoindre avec le code à 6 chiffres ; accord de l'hôte ; messages dans les deux sens ;
// 5 Mo d'un coup ; coupure puis reconnexion (nouveau flux iroh) ; nouveau code (l'ancien point d'accès
// sert encore aux reconnexions) ; code faux → introuvable puis 10 s d'attente ; rien de lisible dans
// ce qui part sur les flux iroh (ni code, ni prénoms, ni titre, ni contenu) ; réglage coupé → local seul.
// Lancer : node scripts/test-collab-internet.mjs
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

process.env.MARGINALIA_E2E = '1';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
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

// Tout ce qui part sur un flux iroh (avant le chiffrement QUIC) : doit déjà être illisible.
const wire = [];
const origWrite = iroh.IrohSocket.prototype._write;
iroh.IrohSocket.prototype._write = function (chunk, enc, cb) {
  wire.push(Buffer.from(chunk));
  return origWrite.call(this, chunk, enc, cb);
};

const registry = new Map();
const COST = { N: 1024, r: 8, p: 1 };
const mkNet = () => iroh.createInternet({ local: true, registry, scrypt: COST, dialMs: 3000 });
const hostNet = mkNet();
ok(hostNet.supported(), 'module iroh chargé', hostNet.loadError && hostNet.loadError.message);

const hostEv = [];
const host = collab.createCollabHost({ emit: (e) => hostEv.push(e), port: 0, udpPort: 47900 + Math.floor(Math.random() * 50), awayMs: 8000, waitMs: 0, scrypt: COST, internet: hostNet });
const mkGuest = (name, extra = {}) => {
  const ev = [];
  const net = mkNet();
  const g = collab.createCollabGuest({ emit: (e) => ev.push(e), deviceName: () => `Ordinateur-de-${name}`, targets: () => [], discoverMs: 300, scrypt: COST, retryForMs: 30000, internet: net, ...extra });
  return { g, ev, name, net };
};

const st = await host.start({ meta: { title: 'Parjure', shareId: 'ws-abc' }, profile: { name: 'Léa', color: '#c2410c' } });
ok(st.open && /^\d{6}$/.test(st.code) && st.internet === true, 'session ouverte avec un code à 6 chiffres, joignable par Internet', { code: st.code, internet: st.internet });

// ── 1. Rejoindre par Internet avec le code ──
const marc = mkGuest('Marc');
const t0 = Date.now();
const found = await marc.g.find(st.code, { profile: { name: 'Marc', color: '#1d4ed8' } });
ok(found && found.from.internet === true && found.from.address === 'Internet' && found.meta.title === 'Parjure', 'invité : session trouvée par Internet grâce au code', { from: found && found.from, ms: Date.now() - t0 });
await until(() => hostEv.some((e) => e.type === 'request'));
const req = hostEv.find((e) => e.type === 'request');
ok(req && req.name === 'Marc' && req.address === 'Internet', 'hôte : demande « Marc », venue d’Internet', req);
const joining = marc.g.join(found.ticket);
host.accept(req.reqId);
const hello = await joining;
ok(hello && hello.you && hello.members.length === 2, 'accepté : canal chiffré ouvert, 2 personnes', hello && hello.members.map((m) => m.name));

// ── 2. Messages ──
host.send('all', Buffer.from('bonjour-de-lea'));
await until(() => marc.ev.some((e) => e.type === 'message'));
ok(Buffer.from(marc.ev.find((e) => e.type === 'message').bytes).toString() === 'bonjour-de-lea', 'hôte → invité');
marc.g.send('h', Buffer.from('reponse-de-marc'));
await until(() => hostEv.some((e) => e.type === 'message'));
ok(Buffer.from(hostEv.find((e) => e.type === 'message').bytes).toString() === 'reponse-de-marc', 'invité → hôte');
const BIG = Buffer.concat([Buffer.from('contenu-du-paquet-initial'), crypto.randomBytes(5 * 1024 * 1024)]);
const tBig = Date.now();
host.send(hello.you, BIG);
await until(() => marc.ev.filter((e) => e.type === 'message').length === 2, 60000);
const got = marc.ev.filter((e) => e.type === 'message')[1];
ok(got && Buffer.from(got.bytes).equals(BIG), '5 Mo d’un coup arrivent intacts', `${Date.now() - tBig} ms`);

// ── 3. Coupure puis reconnexion (nouveau flux, sans nouvel accord) ──
marc.g.cut(300);
await until(() => marc.ev.some((e) => e.type === 'link' && e.state === 'reconnecting'));
const back = await until(() => marc.ev.filter((e) => e.type === 'link' && e.state === 'connected').length >= 2, 20000);
ok(back && hostEv.filter((e) => e.type === 'request').length === 1, 'coupure : l’invité revient tout seul, sans nouvelle demande');
marc.g.send('h', Buffer.from('apres-coupure'));
await until(() => hostEv.filter((e) => e.type === 'message').length === 2);
ok(Buffer.from(hostEv.filter((e) => e.type === 'message')[1].bytes).toString() === 'apres-coupure', 'après la reconnexion : les messages passent');

// ── 4. Code faux : introuvable, puis 10 s d'attente ──
const intrus = mkGuest('Intrus');
const wrong = String((Number(st.code) + 1) % 1e6).padStart(6, '0');
const tw = Date.now();
const e1 = await errOf(intrus.g.find(wrong, { profile: { name: 'Intrus' } }));
ok(e1 && e1.code === 'not-found' && /ni sur ce réseau ni par Internet/.test(e1.message), 'code faux : « Aucune session trouvée… ni par Internet »', [e1 && e1.message, Date.now() - tw]);
const e2 = await errOf(intrus.g.find(st.code, { profile: { name: 'Intrus' } }));
ok(e2 && e2.code === 'wait' && e2.retryIn >= 9 && /Patientez/.test(e2.message), 'essai suivant aussitôt : « Patientez … s avant d’essayer un autre code »', e2 && e2.message);
ok(hostEv.filter((e) => e.type === 'request').length === 1, 'l’hôte n’a rien reçu de l’intrus');

// ── 5. Nouveau code : on rejoint avec le nouveau ; l'ancien point d'accès reste pour les reconnexions ──
const st2 = await host.newCode();
ok(st2.code && st2.code !== st.code && st2.internet === true, 'nouveau code, joignable par Internet', st2.code);
const ines = mkGuest('Inès');
const f2 = await ines.g.find(st2.code, { profile: { name: 'Inès', color: '#15803d' } });
await until(() => hostEv.filter((e) => e.type === 'request').length === 2);
const req2 = hostEv.filter((e) => e.type === 'request')[1];
const j2 = ines.g.join(f2.ticket);
host.accept(req2.reqId);
const h2 = await j2;
ok(h2 && h2.members.length === 3, 'Inès rejoint avec le nouveau code : 3 personnes', h2 && h2.members.map((m) => m.name));
marc.g.cut(300);
const back2 = await until(() => marc.ev.filter((e) => e.type === 'link' && e.state === 'connected').length >= 3, 20000);
ok(back2, 'après un nouveau code, Marc (venu avec l’ancien) se reconnecte encore');

// ── 6. Rien de lisible sur les flux iroh ──
const all = Buffer.concat(wire);
const SECRETS = ['Parjure', 'Léa', 'Marc', 'Inès', 'Ordinateur-de-Marc', 'bonjour-de-lea', 'reponse-de-marc', 'contenu-du-paquet-initial', st.code, st2.code];
const seen = SECRETS.filter((x) => all.includes(Buffer.from(x, 'utf8')));
ok(all.length > 5_000_000 && seen.length === 0, 'flux iroh : ni code, ni prénoms, ni titre, ni contenu en clair', { octets: all.length, vus: seen });

// ── 7. Réglage coupé : plus de point d'accès Internet ──
hostNet.setEnabled(false);
const st3 = await host.newCode();
ok(st3.internet === false, 'réglage coupé : nouveau code sans point d’accès Internet', st3.internet);
const late = mkGuest('Tard');
const e3 = await errOf(late.g.find(st3.code, { profile: { name: 'Tard' } }));
ok(e3 && e3.code === 'not-found', 'réglage coupé : introuvable par Internet', e3 && e3.message);

// ── Fin ──
ines.g.leave();
marc.g.leave();
host.stop('closed');
await wait(300);
for (const x of [marc, ines, intrus, late]) await x.net.shutdown();
await hostNet.shutdown();
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
process.exit(process.exitCode || 0);
