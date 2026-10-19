// Partage entre deux Marginalia par code à 6 chiffres (electron/share-net.cjs), en Node pur : émetteur et
// destinataire dans le même processus, sur 127.0.0.1. Découverte par diffusion UDP réelle
// (127.255.255.255, adresse de diffusion de la boucle locale, via MARGINALIA_E2E_LAN=127.0.0.1) et par
// adresse saisie. Transfert de 5 Mo identique ; accord de l'émetteur (rien ne part avant ; refus ; délai) ;
// code faux ; 5 essais faux → session fermée ; code expiré ; adresse non locale refusée ; capture de
// TOUT le trafic TCP et UDP du processus : ni le code, ni le titre, ni les compteurs, ni le nom
// d'appareil, ni un octet du paquet en clair.
// Lancer : node scripts/test-share-net.mjs
import path from 'node:path';
import net from 'node:net';
import dgram from 'node:dgram';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

process.env.MARGINALIA_E2E = '1';
process.env.MARGINALIA_E2E_LAN = '127.0.0.1';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const share = require(path.join(ROOT, 'electron/share-net.cjs'));

const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errOf = (p) => p.then(() => null, (e) => e);

// ── Capture du trafic : chaque écriture TCP (client et serveur) et chaque datagramme UDP envoyé ──
const wire = [];
let wireBytes = 0;
const origWrite = net.Socket.prototype.write;
net.Socket.prototype.write = function (chunk, enc, cb) {
  // Connexions TCP seulement (pas la sortie de ce script, quand elle passe par un tube).
  if (chunk != null && this !== process.stdout && this !== process.stderr) {
    const b = Buffer.isBuffer(chunk) ? chunk : typeof chunk === 'string' ? Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8') : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    wire.push(Buffer.from(b));
    wireBytes += b.length;
  }
  return origWrite.call(this, chunk, enc, cb);
};
const udpSent = [];
const origSend = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function (msg, ...rest) {
  const b = Buffer.isBuffer(msg) ? msg : Buffer.from(String(msg));
  wire.push(Buffer.from(b));
  udpSent.push({ data: b.toString('utf8'), to: typeof rest[1] === 'string' ? rest[1] : rest[2] });
  return origSend.call(this, msg, ...rest);
};

// ── Temps de dérivation scrypt (paramètres de production) ──
{
  const salt = crypto.randomBytes(16);
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    await new Promise((res, rej) => crypto.scrypt('123456', salt, 32, share.SCRYPT, (e) => (e ? rej(e) : res())));
    times.push(Math.round(performance.now() - t));
  }
  const med = times.sort((a, b) => a - b)[1];
  ok(med > 100, `scrypt N=2^17 r=8 p=1 : ${med} ms par essai (médiane de ${times.join(', ')}) → 10^6 codes ≈ ${((med * 1e6) / 3600000 / 24).toFixed(1)} jours-cœur`);
}

// ── Fonctions pures ──
ok(share.parseManualAddress('192.168.1.20:47802').port === 47802 && share.parseManualAddress(' 10.0.0.4 ').port === 47802, 'adresse saisie : « ip:port » et « ip » seule');
ok(['', 'abc', '300.1.1.1:5', '1.2.3.4:99999', 'exemple.fr:80'].every((a) => { try { share.parseManualAddress(a); return false; } catch (e) { return e.code === 'address'; } }), 'adresse saisie invalide : refusée');
ok(share.broadcastTargets().includes('127.255.255.255') && share.broadcastTargets().includes('255.255.255.255'), 'diffusion : adresse de l’interface (masque) et 255.255.255.255', share.broadcastTargets());

const payload = crypto.randomBytes(5 * 1024 * 1024);
const META = { title: 'Les Misérables — carnet de Cosette', counts: { notes: 913577, passages: 274911 }, size: payload.length };
const SECRETS = ['Misérables', 'Cosette', '913577', '274911', 'Tablette-de-Jean'];
const sendEvents = [];
const sender = share.createShareSender({ emit: (e) => sendEvents.push(e) });
const receiver = share.createShareReceiver({ deviceName: () => 'Tablette-de-Jean' });
const codes = [];

// ── 1. Découverte UDP + transfert de 5 Mo, avec accord de l'émetteur ──
{
  const st = await sender.start({ bytes: payload, meta: META });
  codes.push(st.code);
  ok(/^\d{6}$/.test(st.code) && st.expiresAt - Date.now() > 9.5 * 60000 && st.expiresAt - Date.now() <= 10 * 60000, 'envoi ouvert : code à 6 chiffres, valable 10 minutes', { code: st.code, port: st.port });
  ok(st.port === share.HTTP_PORT && st.discovery === true, 'ports : HTTP 47802, découverte UDP 47803 active', st);
  ok(st.addresses.includes(`127.0.0.1:${st.port}`), 'adresse à saisir en secours affichée', st.addresses);

  const t0 = Date.now();
  const found = await receiver.findShare(st.code.slice(0, 3) + ' ' + st.code.slice(3));
  ok(found.meta.title === META.title && found.meta.counts.notes === 913577 && found.size === payload.length, 'trouvé par diffusion UDP : métadonnées lues avant acceptation', { ms: Date.now() - t0, from: found.from });
  ok(udpSent.some((u) => u.to === '127.255.255.255'), 'la requête est partie en diffusion (127.255.255.255)');
  const req = sendEvents.find((e) => e.type === 'request');
  ok(req && req.device === 'Tablette-de-Jean' && req.address === '127.0.0.1', 'émetteur : demande en attente (appareil déclaré, adresse)', req);
  ok(sender.info().request && sender.info().request.state === 'pending', 'émetteur : demande « en attente »');

  const progress = [];
  const before = wireBytes;
  const p = receiver.receiveShare(found.id, { onProgress: (d, t) => progress.push([d, t]) });
  await wait(700);
  ok(wireBytes - before < 4096 && !sendEvents.some((e) => e.type === 'progress') && progress.length === 0, 'rien ne part tant que l’émetteur n’a pas accepté', { octets: wireBytes - before });
  ok(sender.accept() === true, 'émetteur : accept()');
  const got = await p;
  ok(Buffer.isBuffer(got) && got.length === payload.length && got.equals(payload), '5 Mo reçus, identiques octet pour octet', { ms: Date.now() - t0 });
  ok(progress.length >= 2 && progress.at(-1)[0] === payload.length, 'destinataire : progression jusqu’à 100 %', progress.length);
  await wait(200);
  ok(sendEvents.some((e) => e.type === 'progress' && e.done === payload.length) && sendEvents.some((e) => e.type === 'done'), 'émetteur : progression et « terminé »');
  ok(sendEvents.some((e) => e.type === 'stopped' && e.reason === 'sent') && !sender.isOpen(), 'session fermée après le transfert réussi');
  const again = await errOf(receiver.findShare(st.code));
  ok(again && again.code === 'not-found', 'après le transfert, le code ne mène plus à rien', again && again.message);
}

// ── 2. Adresse saisie (diffusion bloquée) + refus de l'émetteur ──
{
  sendEvents.length = 0;
  const st = await sender.start({ bytes: payload.subarray(0, 300000), meta: META });
  codes.push(st.code);
  const found = await receiver.findShare(st.code, { manualAddress: `127.0.0.1:${st.port}` });
  ok(found.from.address === '127.0.0.1' && found.from.port === st.port && found.meta.counts.passages === 274911, 'trouvé par adresse saisie « 127.0.0.1:port »');
  const before = wireBytes;
  const p = errOf(receiver.receiveShare(found.id));
  await wait(300);
  ok(sender.reject() === true, 'émetteur : reject()');
  const e = await p;
  ok(e && e.code === 'rejected' && e.message === 'L’envoi a été refusé.', 'refus : « L’envoi a été refusé. »', e && e.message);
  ok(wireBytes - before < 4096, 'refus : aucun octet du paquet envoyé', wireBytes - before);
  ok(sender.isOpen(), 'refus : la demande est fermée, la session reste ouverte');
  // Une nouvelle demande après le refus est possible ; une seconde demande simultanée est refusée.
  const f2 = await receiver.findShare(st.code, { manualAddress: `127.0.0.1:${st.port}` });
  const busy = await errOf(receiver.findShare(st.code, { manualAddress: `127.0.0.1:${st.port}` }));
  ok(f2.id && busy && busy.code === 'busy', 'une seule demande à la fois (« examine déjà une autre demande »)', busy && busy.message);
  sender.stop();
  ok(sendEvents.some((x) => x.type === 'stopped' && x.reason === 'closed'), 'stop() : événement « arrêté »');
  const dead = await errOf(receiver.receiveShare(f2.id));
  ok(dead && dead.code === 'closed' && dead.message.startsWith('L’envoi a été fermé'), 'après stop(), la demande ne donne rien', dead && dead.message);
}

// ── 2 bis. Taille quelconque (dernière trame complétée), et paquet altéré en route ──
{
  const odd = crypto.randomBytes(1536 * 1024 + 7);
  const st = await sender.start({ bytes: odd, meta: { title: 'impair' } });
  codes.push(st.code);
  const f = await receiver.findShare(st.code, { manualAddress: `127.0.0.1:${st.port}` });
  sender.accept();
  const got = await receiver.receiveShare(f.id);
  ok(got.length === odd.length && got.equals(odd), 'taille quelconque (1,5 Mo + 7 octets) : identique, bourrage retiré');

  // Relais qui inverse un bit au 50 000e octet de chaque réponse (seule celle du paquet est assez longue).
  const st2 = await sender.start({ bytes: odd, meta: { title: 'altéré' } });
  codes.push(st2.code);
  const relay = net.createServer((c) => {
    const up = net.connect(st2.port, '127.0.0.1');
    let n = 0;
    c.on('data', (d) => up.write(d));
    up.on('data', (d) => {
      const b = Buffer.from(d);
      if (n <= 50000 && n + b.length > 50000) b[50000 - n] ^= 1;
      n += b.length;
      c.write(b);
    });
    c.on('close', () => up.destroy());
    up.on('close', () => c.destroy());
    c.on('error', () => {});
    up.on('error', () => {});
  });
  await new Promise((r) => relay.listen(0, '127.0.0.1', r));
  const f2 = await receiver.findShare(st2.code, { manualAddress: `127.0.0.1:${relay.address().port}` });
  sender.accept();
  const e = await errOf(receiver.receiveShare(f2.id));
  ok(e && e.code === 'corrupt' && e.message.startsWith('Données altérées'), 'un bit altéré en route : réception refusée', e && e.message);
  relay.close();
  sender.stop();
}

// ── 3. Délai de l'accord (2 minutes, raccourci ici) ──
{
  const quick = share.createShareSender({ emit: () => {}, requestTtlMs: 600 });
  const st = await quick.start({ bytes: Buffer.from('court'), meta: { title: 'x' } });
  codes.push(st.code);
  const f = await receiver.findShare(st.code, { manualAddress: `127.0.0.1:${st.port}` });
  const e = await errOf(receiver.receiveShare(f.id));
  ok(e && e.code === 'no-answer' && /n’a pas répondu/.test(e.message), 'sans réponse de l’émetteur : demande fermée', e && e.message);
  quick.stop();
}

// ── 4. Code faux ; 5 essais faux → session fermée (coût scrypt réduit pour ce test seulement) ──
{
  const LOW = { N: 1024, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  const ev = [];
  const s4 = share.createShareSender({ emit: (e) => ev.push(e), scrypt: LOW });
  const r4 = share.createShareReceiver({ scrypt: LOW });
  const st = await s4.start({ bytes: crypto.randomBytes(1000), meta: { title: 't' } });
  codes.push(st.code);
  const manualAddress = `127.0.0.1:${st.port}`;
  const wrong = String((Number(st.code) + 1) % 1000000).padStart(6, '0');
  const w = await errOf(r4.findShare(wrong, { manualAddress }));
  ok(w && w.code === 'bad-code' && /^Code incorrect/.test(w.message), 'code faux refusé', w && w.message);
  ok(!ev.some((e) => e.type === 'request' || e.type === 'progress' || e.type === 'done'), 'code faux : aucune demande chez l’émetteur, aucun octet du paquet envoyé', ev.map((e) => e.type));
  // Codes faux dont l'indice de 4 bits correspond : la preuve est présentée et comptée.
  const seen = [];
  for (let c = 0; c < 1000000 && !seen.includes('tries'); c++) {
    const guess = String(c).padStart(6, '0');
    if (guess === st.code) continue;
    const e = await errOf(r4.findShare(guess, { manualAddress }));
    if (e && e.remaining !== undefined) seen.push(`reste ${e.remaining}`);
    if (e && e.code === 'tries') seen.push('tries');
    if (!e) throw new Error('un code faux a été accepté');
  }
  ok(seen.join() === 'reste 4,reste 3,reste 2,reste 1,tries', '5 preuves fausses comptées puis session fermée', seen);
  ok(ev.filter((e) => e.type === 'attempt').length === 5 && ev.some((e) => e.type === 'stopped' && e.reason === 'tries'), 'émetteur : 5 essais signalés, arrêt « tries »');
  const right = await errOf(r4.findShare(st.code, { manualAddress }));
  ok(right && right.code === 'tries' && right.message.startsWith('Trop d’essais'), 'même le bon code : « Trop d’essais »', right && right.message);
  s4.stop();
}

// ── 5. Code expiré (validité raccourcie), trouvé par diffusion ──
{
  const ev = [];
  const s5 = share.createShareSender({ emit: (e) => ev.push(e), ttlMs: 1200 });
  const st = await s5.start({ bytes: crypto.randomBytes(1000), meta: { title: 't' } });
  codes.push(st.code);
  await wait(1500);
  ok(ev.some((e) => e.type === 'stopped' && e.reason === 'expired') && !s5.isOpen(), 'émetteur : code expiré, session arrêtée');
  const e = await errOf(receiver.findShare(st.code));
  ok(e && e.code === 'expired' && e.message.startsWith('Code expiré'), 'destinataire : « Code expiré »', e && e.message);
  const e2 = await errOf(receiver.findShare(st.code, { manualAddress: `127.0.0.1:${st.port}` }));
  ok(e2 && e2.code === 'expired', 'adresse saisie : « Code expiré » aussi');
  s5.stop();
}

// ── 6. Adresses non locales ──
{
  const e = await errOf(receiver.findShare('123456', { manualAddress: '8.8.8.8:47802' }));
  ok(e && e.code === 'not-local' && /pas sur le réseau local/.test(e.message), 'destinataire : adresse publique refusée sans connexion', e && e.message);
  // L'émetteur refuse une connexion qui ne vient pas du réseau local (filtre imposé : 127.0.0.1 vue comme publique).
  const s6 = share.createShareSender({ emit: () => {}, isLocal: () => false });
  const st = await s6.start({ bytes: Buffer.from('x'), meta: {} });
  codes.push(st.code);
  const status = await new Promise((res) => http.get(`http://127.0.0.1:${st.port}/mg-share/v1/hello`, (r) => { r.resume(); res(r.statusCode); }).on('error', () => res(0)));
  ok(status === 403, 'émetteur : requête HTTP d’une adresse non locale refusée (403)', status);
  const e2 = await errOf(receiver.findShare(st.code));
  ok(e2 && e2.code === 'not-found' && e2.message.startsWith('Aucun envoi trouvé avec ce code sur ce réseau'), 'émetteur : découverte ignorée pour une adresse non locale', e2 && e2.message);
  s6.stop();
  const bad = await errOf(receiver.findShare('12a456'));
  ok(bad && bad.code === 'format', 'code mal formé : « 6 chiffres »', bad && bad.message);
}

// ── 7. Aucun secret en clair dans le trafic capturé ──
{
  const all = Buffer.concat(wire);
  ok(all.length > payload.length, 'trafic capturé (TCP + UDP)', `${(all.length / 1048576).toFixed(1)} Mo, ${wire.length} écritures, ${udpSent.length} datagrammes`);
  ok(['POST /mg-share/v1/prove', 'GET /mg-share/v1/data', '"box":"', '"proof":"', '"dev":"'].every((x) => all.includes(Buffer.from(x))), 'la capture contient bien les requêtes du destinataire et les réponses de l’émetteur');
  ok(codes.every((c) => !all.includes(Buffer.from(c))), 'aucun des codes en clair sur le réseau', codes);
  const hits = SECRETS.filter((x) => all.includes(Buffer.from(x, 'utf8')) || all.includes(Buffer.from(x, 'latin1')) || all.includes(Buffer.from(JSON.stringify(x).slice(1, -1))));
  ok(hits.length === 0, 'ni titre, ni compteurs, ni nom d’appareil en clair', hits);
  let leaks = 0;
  for (let i = 0; i < 400; i++) {
    const at = i === 0 ? 0 : i === 1 ? payload.length - 32 : crypto.randomInt(0, payload.length - 32);
    if (all.includes(payload.subarray(at, at + 32))) leaks++;
  }
  ok(leaks === 0, 'aucun extrait du paquet (400 fenêtres de 32 octets) en clair', leaks);
  const udpText = udpSent.map((u) => u.data);
  ok(udpText.every((t) => { const j = JSON.parse(t); return Object.keys(j).every((k) => ['mg', 'v', 'id', 'port', 'salt'].includes(k)); }), 'UDP : seulement mg, v, id opaque, port et sel', udpText.slice(0, 2));
}

net.Socket.prototype.write = origWrite;
dgram.Socket.prototype.send = origSend;
receiver.cancel();
console.log(process.exitCode ? 'Des tests ont échoué.' : 'Tous les tests sont passés.');
setTimeout(() => process.exit(), 100);
