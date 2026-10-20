// Rendez-vous par Internet (electron/collab-iroh.cjs) : l'identifiant publié dépend du code ET d'une
// fenêtre de temps. Une table « code → identifiant » ne vaut donc que pour une fenêtre (avant, avec un sel
// fixe, une seule table servait pour toujours).
// Vérifie, avec une horloge simulée et des fenêtres courtes : même code, fenêtres différentes → clés
// différentes ; clé v1 (sel fixe) introuvable ; l'invité trouve l'hôte dans la fenêtre en cours ;
// horloges décalées d'une fenêtre : trouvé, de deux fenêtres : introuvable ; après rotation, l'hôte est
// toujours joignable et un invité déjà connecté par l'ancienne fenêtre continue ; l'ancienne fenêtre
// n'est plus publiée ; code expiré (refuseNew) : plus rien de publié ; un client « mg-collab/1 » (Marginalia
// 3.35, 3.36) ne se connecte pas.
// Lancer : node scripts/test-iroh-epochs.mjs
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const iroh = require(path.join(ROOT, 'electron/collab-iroh.cjs'));

const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await wait(25);
  }
  return false;
};

const COST = { N: 1024, r: 8, p: 1 };
const EP = 1000; // fenêtre de 1 s (horloge simulée)
const registry = new Map();
let hostT = 50 * EP + 100;
let guestT = hostT;
const mk = (now) => iroh.createInternet({ local: true, registry, scrypt: COST, dialMs: 2500, now, epochMs: EP });

// ── Clés ──
const code = '482913';
const k0 = await iroh.secretFor(code, COST, 'collab', 50);
const k1 = await iroh.secretFor(code, COST, 'collab', 51);
const kShare = await iroh.secretFor(code, COST, 'share', 50);
ok(!k0.equals(k1), 'même code, fenêtres différentes : clés différentes');
ok(!k0.equals(kShare), 'même code et fenêtre, envoi ≠ collaboration');
const v1 = await new Promise((res, rej) => crypto.scrypt(Buffer.from(code), Buffer.from('marginalia collab internet v1'), 32, COST, (e, k) => (e ? rej(e) : res(k))));
ok(!v1.equals(k0) && !v1.equals(k1), 'clé de l’ancien protocole (sel fixe) différente');
ok(iroh.epochOf(Date.now()) === Math.floor(Date.now() / iroh.EPOCH_MS) && iroh.EPOCH_MS === 600000, 'fenêtre réelle : 10 minutes');

// ── Hôte ──
const hostNet = mk(() => hostT);
ok(hostNet.supported(), 'module iroh chargé', hostNet.loadError && hostNet.loadError.message);
const got = [];
const rv = await hostNet.host(code, (sock) => {
  got.push(sock);
  sock.on('data', (d) => sock.write(Buffer.concat([Buffer.from('écho:'), d])));
});
ok(await until(() => rv.epochs().length === 3), 'hôte : fenêtre en cours et ses deux voisines publiées', rv.epochs());
ok(registry.size === 3, 'annuaire : 3 identifiants', registry.size);

const roundTrip = async (via, msg) => {
  const s = await via.stream();
  const answer = new Promise((res) => s.once('data', (d) => res(d.toString())));
  s.write(msg);
  const r = await Promise.race([answer, wait(3000).then(() => null)]);
  return { s, r };
};

// ── Invité dans la même fenêtre ──
const g1 = mk(() => guestT);
const via1 = await g1.dial(code);
ok(!!via1, 'invité : trouvé dans la fenêtre en cours');
const a = via1 ? await roundTrip(via1, 'bonjour') : { r: null };
ok(a.r === 'écho:bonjour', 'échange dans les deux sens', a.r);
const wrong = await mk(() => guestT).dial('000001');
ok(wrong === null, 'code faux : introuvable');

// ── Horloges décalées ──
guestT = hostT - EP;
ok(!!(await mk(() => guestT).dial(code)), 'horloge de l’invité en retard d’une fenêtre : trouvé');
guestT = hostT + EP;
ok(!!(await mk(() => guestT).dial(code)), 'horloge de l’invité en avance d’une fenêtre : trouvé');
guestT = hostT + 2 * EP;
ok((await mk(() => guestT).dial(code)) === null, 'décalage de deux fenêtres : introuvable');

// ── Rotation ──
const oldIds = new Set(registry.keys());
hostT += 3 * EP;
guestT = hostT;
ok(await until(() => rv.epochs().join() === [53, 54, 52].join() || rv.epochs().sort().join() === '52,53,54'), 'rotation : nouvelles fenêtres publiées', rv.epochs());
ok(await until(() => [...registry.keys()].every((k) => !oldIds.has(k))), 'anciennes fenêtres retirées de l’annuaire', { restant: [...registry.keys()].filter((k) => oldIds.has(k)).length });
const via2 = await mk(() => guestT).dial(code);
ok(!!via2, 'après rotation : nouvel invité trouvé');
const b = via2 ? await roundTrip(via2, 'deux') : { r: null };
ok(b.r === 'écho:deux', 'après rotation : échange', b.r);
const c = await roundTrip(via1, 'toujours');
ok(c.r === 'écho:toujours', 'invité connecté par l’ancienne fenêtre : la connexion continue', c.r);

// ── Point d'accès invité : fermé quand il ne sert plus ──
{
  const gi = iroh.createInternet({ local: true, registry, scrypt: COST, dialMs: 2500, now: () => guestT, epochMs: EP, guestIdleMs: 700 });
  ok((await gi.dial('000002')) === null && gi.guestOpen(), 'invité : point d’accès ouvert pour chercher');
  await wait(1500);
  ok(!gi.guestOpen(), 'invité : code introuvable, point d’accès refermé tout seul (rien ne reste ouvert)');
  const via = await gi.dial(code);
  const { s: sock, r } = await roundTrip(via, 'garde');
  await wait(1500);
  ok(r === 'écho:garde' && gi.guestOpen(), 'invité : flux ouvert, le point d’accès reste');
  sock.destroy();
  via.close();
  await wait(1700);
  ok(!gi.guestOpen(), 'invité : session quittée, point d’accès refermé');
  await gi.shutdown();
}

// ── Ancien protocole (v1) ──
{
  const L = require('@number0/iroh');
  const b1 = L.Endpoint.builder();
  L.presetMinimal(b1);
  b1.bindAddr('127.0.0.1:0');
  const ep = await b1.bind();
  const target = registry.values().next().value;
  let err = null;
  try {
    await Promise.race([ep.connect(target, Array.from(Buffer.from('mg-collab/1'))), wait(3000).then(() => Promise.reject(new Error('délai')))]);
  } catch (e) {
    err = e;
  }
  ok(!!err, 'client « mg-collab/1 » (3.35, 3.36) : connexion refusée', err && String(err.message).slice(0, 80));
  await ep.close().catch(() => {});
}

// ── Code expiré ──
rv.refuseNew();
ok(registry.size === 0, 'code expiré : plus rien de publié', registry.size);
const late = await mk(() => guestT).dial(code);
ok(late === null, 'code expiré : introuvable');
const d = await roundTrip(via1, 'fin');
ok(d.r === 'écho:fin', 'code expiré : les connexions en cours continuent', d.r);

await rv.close();
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
process.exit(process.exitCode || 0);
