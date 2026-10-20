// « Travailler à plusieurs » : transport du réseau local (electron/collab-net.cjs), en Node pur.
// Hôte + invités dans le même processus, sur 127.0.0.1 (MARGINALIA_E2E_LAN=127.0.0.1) : découverte UDP
// réelle et adresse saisie ; accord de l'hôte ; refus ; relais (à tous, à l'hôte, à un invité) ; 6
// personnes au plus (la 7e est refusée) ; code faux, 5 essais → code fermé puis nouveau code ; invité
// coupé qui revient (jeton, sans nouvel accord) ; départ ; arrêt par l'hôte (« bye ») ; capture de TOUT
// le trafic : ni code, ni prénoms, ni titre, ni contenu en clair.
// Lancer : node scripts/test-collab-net.mjs
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

process.env.MARGINALIA_E2E = '1';
process.env.MARGINALIA_E2E_LAN = '127.0.0.1';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const collab = require(path.join(ROOT, 'electron/collab-net.cjs'));

const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await wait(25);
  }
  return false;
};
const errOf = (p) => p.then(() => null, (e) => e);

// ── Capture : chaque écriture TCP et chaque datagramme UDP ──
const wire = [];
const origWrite = net.Socket.prototype.write;
net.Socket.prototype.write = function (chunk, enc, cb) {
  if (chunk != null && this !== process.stdout && this !== process.stderr) {
    const b = Buffer.isBuffer(chunk) ? chunk : typeof chunk === 'string' ? Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8') : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    wire.push(Buffer.from(b));
  }
  return origWrite.call(this, chunk, enc, cb);
};
const origSend = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function (msg, ...rest) {
  wire.push(Buffer.from(Buffer.isBuffer(msg) ? msg : String(msg)));
  return origSend.call(this, msg, ...rest);
};

const SECRETS = ['Parjure', 'Léa', 'Marc', 'Inès', 'Ordinateur-de-Marc', 'PHRASE-SECRETE-TAPEE', 'contenu-du-paquet-initial'];
const hostEv = [];
const host = collab.createCollabHost({ emit: (e) => hostEv.push(e), awayMs: 4000, waitMs: 0, diag: process.env.DBG ? (...a) => /reprise/.test(a[1]) && console.log('  [hôte]', ...a) : undefined });
const mkGuest = (name) => {
  const ev = [];
  const g = collab.createCollabGuest({ emit: (e) => ev.push(e), diag: name === 'Marc' && process.env.DBG ? (...a) => console.log('  [Marc]', ...a) : undefined, deviceName: () => `Ordinateur-de-${name}`, retryForMs: 30000, waitMs: 0 });
  return { g, ev, name };
};

const st = await host.start({ meta: { title: 'Parjure', shareId: 'ws-abc' }, profile: { name: 'Léa', color: '#c2410c' } });
ok(/^\d{6}$/.test(st.code) && st.port > 0 && st.discovery && st.members.length === 1 && st.members[0].host, 'hôte : session ouverte, code, port, découverte', { port: st.port });
const codes = [st.code];

/** Rejoint : find (diffusion ou adresse) → l'hôte accepte → canal ouvert. */
async function joinAs(x, { manual = false, accept = true } = {}) {
  const found = await x.g.find(codes[codes.length - 1], { manualAddress: manual ? `127.0.0.1:${host.info().port}` : undefined, profile: { name: x.name, color: '#1d4ed8' } });
  const reqEv = await until(() => hostEv.some((e) => e.type === 'request' && e.name === x.name && !e.done));
  const req = hostEv.find((e) => e.type === 'request' && e.name === x.name && !e.done);
  if (req) req.done = true;
  const p = x.g.join(found.ticket);
  await wait(150);
  if (accept) host.accept(req.reqId);
  else host.reject(req.reqId);
  return { found, req, reqEv, res: await p.then((r) => r, (e) => e) };
}

// ── 1. Deux invités : découverte + adresse saisie, accord, roster ──
const marc = mkGuest('Marc');
const ines = mkGuest('Inès');
const j1 = await joinAs(marc);
ok(j1.found.meta.title === 'Parjure' && j1.found.from.host === 'Léa', 'invité : session trouvée par diffusion, titre et prénom de l’hôte déchiffrés', j1.found.from);
ok(j1.req && j1.req.device === 'Ordinateur-de-Marc' && j1.req.name === 'Marc' && j1.req.color === '#1d4ed8', 'hôte : demande (prénom, couleur, appareil)', j1.req);
ok(j1.res && j1.res.you && j1.res.members.length === 2, 'Marc : accepté, bienvenue avec la liste des présents', j1.res);
const j2 = await joinAs(ines, { manual: true });
ok(j2.res && j2.res.you && j2.res.members.length === 3, 'Inès : par adresse saisie, acceptée', j2.res && j2.res.members?.map((m) => m.name));
await until(() => marc.ev.some((e) => e.type === 'members' && e.members.length === 3));
ok(marc.ev.some((e) => e.type === 'members' && e.members.length === 3), 'Marc voit arriver Inès');

// ── 2. Relais ──
const SECRET = Buffer.from('PHRASE-SECRETE-TAPEE '.repeat(20));
marc.g.send('all', SECRET);
await until(() => ines.ev.some((e) => e.type === 'message') && hostEv.some((e) => e.type === 'message'));
const atInes = ines.ev.find((e) => e.type === 'message');
const atHost = hostEv.find((e) => e.type === 'message');
ok(atInes && Buffer.from(atInes.bytes).equals(SECRET) && atInes.from === j1.res.you, 'Marc → tous : Inès reçoit, expéditeur marqué par l’hôte');
ok(atHost && Buffer.from(atHost.bytes).equals(SECRET) && atHost.from === j1.res.you, 'Marc → tous : l’hôte reçoit');
ok(!marc.ev.some((e) => e.type === 'message'), 'l’expéditeur ne reçoit pas son propre message');
ines.g.send('h', Buffer.from('pour-hote'));
await until(() => hostEv.filter((e) => e.type === 'message').length >= 2);
await wait(100);
ok(!marc.ev.some((e) => e.type === 'message') && hostEv.filter((e) => e.type === 'message').length === 2, 'Inès → hôte seulement');
host.send(j2.res.you, Buffer.from('a-ines'));
await until(() => ines.ev.filter((e) => e.type === 'message').length === 2);
ok(Buffer.from(ines.ev.filter((e) => e.type === 'message')[1].bytes).toString() === 'a-ines' && ines.ev.filter((e) => e.type === 'message')[1].from === 'h' && !marc.ev.some((e) => e.type === 'message'), 'hôte → Inès seulement');
// gros message (paquet initial) : 5 Mo en plusieurs trames
const BIG = crypto.randomBytes(5 * 1024 * 1024);
host.send(j1.res.you, BIG);
await until(() => marc.ev.some((e) => e.type === 'message'), 15000);
ok(Buffer.from(marc.ev.find((e) => e.type === 'message').bytes).equals(BIG), '5 Mo d’un coup (plusieurs trames) arrivent intacts');

// ── 3. Refus, limite de 6 personnes ──
const r1 = mkGuest('Refusé');
const jr = await joinAs(r1, { accept: false });
ok(jr.res instanceof Error && /L’hôte a refusé votre demande/.test(jr.res.message), 'demande refusée : « L’hôte a refusé votre demande. »', jr.res && jr.res.message);
const more = [mkGuest('Paul'), mkGuest('Zoé'), mkGuest('Noé')];
for (const x of more) await joinAs(x);
ok(host.info().members.length === 6, '6 personnes (hôte compris)', host.info().members.map((m) => m.name));
const seventh = mkGuest('Septième');
const e7 = await errOf(seventh.g.find(codes[0], { profile: { name: 'Septième' } }));
ok(e7 && e7.code === 'full' && /complet \(6 personnes au plus\)/.test(e7.message), '7e personne refusée : « Cet espace est complet (6 personnes au plus)… »', e7 && e7.message);
more[2].g.leave();
await until(() => host.info().members.length === 5);
ok(host.info().members.length === 5, 'départ volontaire : la place est libérée');
// Nombre de places choisi par l'hôte : jamais moins que les présents ; les invités l'apprennent.
{
  const i3 = host.setMax(3);
  ok(i3.maxPeople === 5, 'places réduites à 3 avec 5 présents : ramenées à 5 (personne n’est exclu)', i3.maxPeople);
  await until(() => marc.ev.some((e) => e.type === 'members' && e.max === 5));
  ok(marc.ev.some((e) => e.type === 'members' && e.max === 5), 'les invités reçoivent le nombre de places (5)');
  const extra = mkGuest('Sixième');
  const e6 = await errOf(extra.g.find(codes[0], { profile: { name: 'Sixième' } }));
  ok(e6 && e6.code === 'full' && /complet \(5 personnes au plus\)/.test(e6.message), '5 places, 5 présents : la suivante est refusée « complet (5 personnes au plus) »', e6 && e6.message);
  ok(host.setMax(6).maxPeople === 6 && host.setMax(9).maxPeople === 6 && host.setMax(6).maxPeople === 6, 'places remises à 6 (jamais plus de 6)');
}

// ── 4. Code faux ; 5 essais → code fermé ; nouveau code ──
const wrongs = mkGuest('Intrus');
const wrong = String((Number(codes[0]) + 1) % 1e6).padStart(6, '0');
const ew = await errOf(wrongs.g.find(wrong, { manualAddress: `127.0.0.1:${host.info().port}` }));
ok(ew && ew.code === 'bad-code', 'code faux (adresse saisie) : « Code incorrect »', ew && ew.message);
// Attente de 10 s entre deux codes (comportement par défaut de l'invité) : le second essai est refusé tout de suite.
{
  const impatient = collab.createCollabGuest({ emit: () => {}, deviceName: () => 'Impatient' });
  const w1 = await errOf(impatient.find(wrong, { manualAddress: `127.0.0.1:${host.info().port}` }));
  const t0 = Date.now();
  const w2 = await errOf(impatient.find(codes[0], { manualAddress: `127.0.0.1:${host.info().port}` }));
  ok(w1 && w1.code === 'bad-code' && w2 && w2.code === 'wait' && Date.now() - t0 < 200 && w2.retryIn >= 9 && /Patientez \d+ s avant d’essayer un autre code/.test(w2.message), 'code faux → 10 s d’attente avant un autre code (refus immédiat, sans contacter l’hôte)', [w1 && w1.message, w2 && w2.message, w2 && w2.retryIn]);
  ok(impatient.waitLeft() >= 9, 'temps restant exposé (waitLeft)', impatient.waitLeft());
  impatient.leave();
}
// Les preuves fausses : on rejoue la poignée de main avec un mauvais code via la diffusion (indice différent :
// ignoré sans essai), puis par adresse : l'indice 4 bits peut coïncider ; on force 5 preuves fausses par codes voisins.
let tries = 0;
for (let i = 2; i < 400 && host.info().codeState === 'open'; i++) {
  const c = String((Number(codes[0]) + i) % 1e6).padStart(6, '0');
  const e = await errOf(wrongs.g.find(c, { manualAddress: `127.0.0.1:${host.info().port}` }));
  if (e && (e.code === 'bad-code' || e.code === 'tries')) tries++;
}
ok(host.info().codeState === 'tries' && hostEv.some((e) => e.type === 'code-closed'), '5 preuves fausses : le code est fermé (la session continue)', { tries, attempts: hostEv.filter((e) => e.type === 'attempt').length });
const etries = await errOf(mkGuest('X').g.find(codes[0], { manualAddress: `127.0.0.1:${host.info().port}` }));
ok(etries && etries.code === 'tries', 'même le bon code est refusé ensuite (« Trop d’essais »)', etries && etries.message);
ok(host.info().members.length === 5, 'les présents restent');
const nc = await host.newCode();
codes.push(nc.code);
ok(/^\d{6}$/.test(nc.code) && nc.code !== codes[0] && nc.codeState === 'open', 'nouveau code');

// ── 5. Invité coupé : il continue, revient seul (jeton), sans nouvel accord ──
const before = hostEv.filter((e) => e.type === 'request').length;
marc.g.cut(1500);
await until(() => marc.ev.some((e) => e.type === 'link' && e.state === 'reconnecting'));
ok(marc.ev.some((e) => e.type === 'link' && e.state === 'reconnecting'), 'Marc coupé : « reconnexion… »');
await until(() => host.info().members.some((m) => m.name === 'Marc' && m.state === 'away'));
ok(host.info().members.some((m) => m.name === 'Marc' && m.state === 'away'), 'hôte : Marc « absent », sa place gardée');
const evCount = marc.ev.filter((e) => e.type === 'hello').length;
await until(() => marc.ev.filter((e) => e.type === 'hello').length > evCount, 10000);
ok(marc.ev.some((e) => e.type === 'hello' && e.resumed) && marc.ev.filter((e) => e.type === 'link').pop().state === 'connected', 'Marc revient (après le nouveau code aussi) : même place, canal neuf');
ok(hostEv.filter((e) => e.type === 'request').length === before, 'aucune nouvelle demande à l’hôte pour une reconnexion');
marc.g.send('h', Buffer.from('de-retour'));
await until(() => hostEv.some((e) => e.type === 'message' && Buffer.from(e.bytes).toString() === 'de-retour'));
ok(hostEv.some((e) => e.type === 'message' && Buffer.from(e.bytes).toString() === 'de-retour'), 'Marc envoie de nouveau');

// ── 6. Invité absent trop longtemps : place libérée ; il ne peut plus revenir ──
more[0].g.cut(60000);
await until(() => !host.info().members.some((m) => m.name === 'Paul'), 8000);
ok(!host.info().members.some((m) => m.name === 'Paul'), 'absent au-delà du délai : place libérée');

// ── 6b. Retirer une personne : canal fermé « removed », place libérée, pas de retour par le jeton ──
const zoe = more[1];
const zoeId = host.info().members.find((m) => m.name === 'Zoé').id;
const nBefore = host.info().members.length;
ok(host.remove(zoeId) === true, 'hôte : retirer Zoé');
await until(() => zoe.ev.some((e) => e.type === 'link' && e.state === 'closed'));
ok(zoe.ev.some((e) => e.type === 'link' && e.state === 'closed' && e.reason === 'removed'), 'Zoé : la session se ferme avec « removed »', zoe.ev.filter((e) => e.type === 'link'));
ok(host.info().members.length === nBefore - 1 && !host.info().members.some((m) => m.name === 'Zoé'), 'sa place est libérée');
await until(() => marc.ev.some((e) => e.type === 'members' && !e.members.some((m) => m.name === 'Zoé')));
ok(marc.ev.filter((e) => e.type === 'members').pop().members.every((m) => m.name !== 'Zoé'), 'les autres voient la place libérée');
ok(host.remove(zoeId) === false && host.remove('h') === false, 'retirer deux fois, ou l’hôte : sans effet');
const zoeMsgs = zoe.ev.filter((e) => e.type === 'message').length;
marc.g.send('all', Buffer.from('apres-retrait'));
await until(() => ines.ev.some((e) => e.type === 'message' && Buffer.from(e.bytes).toString() === 'apres-retrait'));
await wait(200);
ok(zoe.ev.filter((e) => e.type === 'message').length === zoeMsgs, 'Zoé ne reçoit plus rien');
// Elle redemande : l'hôte voit qu'elle a été retirée tout à l'heure.
const jz = await joinAs(zoe, { accept: false });
ok(jz.req && jz.req.wasRemoved === true, 'nouvelle demande de Zoé : signalée « retirée tout à l’heure »', jz.req);
// Retirée pendant une coupure : sa reconnexion par jeton est refusée (« removed »).
const leon = mkGuest('Léon');
const jl = await joinAs(leon);
ok(jl.res && jl.res.you && !jl.req.wasRemoved, 'Léon rejoint (demande ordinaire)');
leon.g.cut(2500);
await until(() => host.info().members.some((m) => m.name === 'Léon' && m.state === 'away'));
ok(host.remove(jl.res.you) === true, 'hôte : retirer Léon pendant sa coupure');
await until(() => leon.ev.some((e) => e.type === 'link' && e.state === 'closed'), 15000);
ok(leon.ev.some((e) => e.type === 'link' && e.state === 'closed' && e.reason === 'removed') && !leon.ev.some((e) => e.type === 'hello' && e.resumed), 'Léon : reconnexion refusée, fin « removed »', leon.ev.filter((e) => e.type === 'link'));

// ── 7. Arrêt par l'hôte : tous reçoivent la fin ──
host.stop('closed');
await until(() => [marc, ines].every((x) => x.ev.some((e) => e.type === 'link' && e.state === 'closed')));
ok([marc, ines].every((x) => x.ev.some((e) => e.type === 'link' && e.state === 'closed' && e.reason === 'host-stopped')), 'arrêt par l’hôte : chaque invité reçoit « session arrêtée par l’hôte »', marc.ev.filter((e) => e.type === 'link'));
ok(hostEv.some((e) => e.type === 'stopped'), 'hôte : arrêtée');
const eAfter = await errOf(mkGuest('Tard').g.find(codes[1]));
ok(eAfter && eAfter.code === 'not-found', 'après l’arrêt : session introuvable', eAfter && eAfter.message);

// ── 8. Rien en clair ──
const all = Buffer.concat(wire);
ok(all.includes(Buffer.from('POST /mg-collab/v1/prove')) && all.includes(Buffer.from('mg-collab')), 'la capture contient bien la poignée de main', { octets: all.length });
ok(codes.every((c) => !all.includes(Buffer.from(c))), 'aucun code en clair', codes);
const hits = SECRETS.filter((x) => all.includes(Buffer.from(x)));
ok(hits.length === 0, 'ni prénoms, ni titre, ni appareil, ni texte en clair', hits);
let leaks = 0;
for (let i = 0; i < 300; i++) {
  const off = Math.floor((i / 300) * (BIG.length - 32));
  if (all.includes(BIG.subarray(off, off + 32))) leaks++;
}
ok(leaks === 0, 'aucun morceau des 5 Mo en clair', leaks);
process.exit(process.exitCode || 0);
