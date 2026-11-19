// Attaques réseau sur les serveurs locaux de Marginalia (partage par code, « travailler à plusieurs »,
// réception du téléphone), en Node pur sur 127.0.0.1 : un appareil hostile du même réseau envoie des
// requêtes mal formées, trop grosses, des remontées de dossier, des octets au hasard, ouvre des centaines
// de connexions muettes et inonde la découverte UDP. Après chaque salve : le serveur répond toujours, n'a
// rien livré, aucune exception n'a échappé, et la mémoire n'a pas gonflé.
// Lancer : node scripts/test-net-fuzz.mjs
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

process.env.MARGINALIA_E2E = '1';
process.env.MARGINALIA_E2E_LAN = '127.0.0.1';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const share = require(path.join(ROOT, 'electron/share-net.cjs'));
const collab = require(path.join(ROOT, 'electron/collab-net.cjs'));
const wifi = require(path.join(ROOT, 'electron/wifi.cjs'));

const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const uncaught = [];
process.on('uncaughtException', (e) => uncaught.push(String(e && e.stack || e).slice(0, 300)));
process.on('unhandledRejection', (e) => uncaught.push('rejet: ' + String(e && e.stack || e).slice(0, 300)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const req = (port, { method = 'GET', path: p = '/', headers = {}, body = null, timeout = 4000 } = {}) =>
  new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers, timeout }, (res) => {
      const parts = [];
      let n = 0;
      res.on('data', (c) => { n += c.length; if (parts.length < 64) parts.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, bytes: n, text: Buffer.concat(parts).toString('utf8').slice(0, 4000) }));
      res.on('error', () => resolve({ status: res.statusCode, bytes: n, text: '' }));
    });
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, text: 'délai' }); });
    r.on('error', (e) => resolve({ status: 0, text: String(e.code || e.message) }));
    if (body != null) r.write(body);
    r.end();
  });
const raw = (port, bytes, ms = 600) =>
  new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    let got = Buffer.alloc(0);
    s.on('connect', () => s.write(bytes));
    s.on('data', (c) => (got = Buffer.concat([got, c]).subarray(0, 4096)));
    const done = () => { s.destroy(); resolve(got.toString('latin1')); };
    s.on('error', done);
    s.on('close', done);
    setTimeout(done, ms);
  });

const SECRET = 'CONTENU-SECRET-' + crypto.randomBytes(8).toString('hex');
const SCRYPT = { N: 1024, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// ── Cibles ──
const sender = share.createShareSender({ emit: () => {}, scrypt: SCRYPT });
console.log('     démarrage des serveurs…');
const sh = await sender.start({ bytes: Buffer.from(SECRET.repeat(2000)), meta: { title: 'Titre-' + SECRET } });
const host = collab.createCollabHost({ emit: () => {}, awayMs: 4000, waitMs: 0, scrypt: SCRYPT });
const co = await host.start({ meta: { title: 'Espace-' + SECRET, shareId: 'ws-fuzz' }, profile: { name: 'Léa', color: '#c2410c' } });
const wifiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-fuzz-wifi-'));
const receiver = wifi.createReceiver({ dir: () => wifiDir, taken: () => false, isLocked: () => false, pagePath: path.join(ROOT, 'electron/wifi-page.html'), scanPagePath: path.join(ROOT, 'electron/wifi-scan.html'), emit: () => {} });
const wf = await receiver.start();
const wfPort = wf.port ?? Number(new URL(wf.urls[0].url).port);
const targets = [
  { name: 'partage', port: sh.port, prefix: '/mg-share/v1/', alive: () => req(sh.port, { path: '/mg-share/v1/hello' }) },
  { name: 'collaboration', port: co.port, prefix: '/mg-collab/v1/', alive: () => req(co.port, { path: '/mg-collab/v1/hello' }) },
  { name: 'téléphone', port: wfPort, prefix: '/r/', alive: () => req(wfPort, { path: '/' }) },
];
for (const t of targets) ok((await t.alive()).status > 0, `${t.name} : serveur ouvert (port ${t.port})`);
const mem0 = process.memoryUsage().rss;
const leaked = (text) => String(text || '').includes(SECRET);

for (const t of targets) {
  let leak = 0;
  let served = 0;
  // 1. Remontées de dossier et routes inventées.
  for (const p of ['../../../../etc/passwd', '..%2f..%2f..%2fetc%2fpasswd', '%2e%2e/%2e%2e/package.json', 'data', 'data?hs=x', 'done', 'link?hs=' + 'A'.repeat(64), '\\..\\..\\windows\\win.ini', 'hello/../../x', '%00', 'file:///etc/passwd', 'x'.repeat(9000)]) {
    for (const m of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const r = await req(t.port, { method: m, path: t.prefix + p, headers: m === 'POST' ? { 'content-type': 'application/json' } : {}, body: m === 'POST' ? '{}' : null });
      if (leaked(r.text) || /root:|"name"\s*:\s*"marginalia"/.test(r.text)) leak++;
      if (r.status === 200 && r.bytes > 20000) served++;
    }
  }
  ok(leak === 0 && served === 0, `${t.name} : remontées de dossier et routes inventées, rien de livré`, { leak, served });

  // 2. JSON mal formé, piégé, trop gros.
  const bodies = ['', '{', 'null', '[]', '"x"', '{"__proto__":{"polluted":1}}', '{"constructor":{"prototype":{"polluted":1}}}', JSON.stringify({ id: { $gt: '' }, n: [1, 2] }), JSON.stringify({ id: 'A'.repeat(7000), n: 'B'.repeat(900) }), '['.repeat(5000), '{"a":'.repeat(2000), 'x'.repeat(200000), crypto.randomBytes(4096).toString('latin1')];
  let crashed = 0;
  for (const route of ['open', 'prove', 'done', 'link', 'resume', 'upload', 'isbn', 'text']) {
    for (const b of bodies) {
      const r = await req(t.port, { method: 'POST', path: t.prefix + route, headers: { 'content-type': 'application/json' }, body: b });
      if (leaked(r.text)) leak++;
      if (r.status >= 500 && r.status !== 503) crashed++;
    }
  }
  ok(leak === 0 && crashed === 0 && {}.polluted === undefined, `${t.name} : JSON mal formé, piégé (__proto__) ou trop gros, refusé sans erreur interne`, { leak, crashed });

  // 3. Octets au hasard, requêtes HTTP tordues, en-têtes géants.
  const junk = [crypto.randomBytes(2048), Buffer.from('GET / HTTP/9.9\r\n\r\n'), Buffer.from('GET ' + '/a'.repeat(40000) + ' HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n'), Buffer.from('POST ' + t.prefix + 'open HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 99999999999\r\n\r\n{'), Buffer.from('POST ' + t.prefix + 'open HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\nContent-Length: 4\r\n\r\n0\r\n\r\nGET ' + t.prefix + 'data HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n'), Buffer.from('GET ' + t.prefix + 'hello HTTP/1.1\r\nHost: 127.0.0.1\r\n' + 'X-A: b\r\n'.repeat(5000) + '\r\n'), Buffer.from('GET ' + t.prefix + 'link HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: mg-collab\r\n\r\n' + crypto.randomBytes(512).toString('latin1'), 'latin1')];
  for (const j of junk) if (leaked(await raw(t.port, j))) leak++;
  ok(leak === 0, `${t.name} : octets au hasard, HTTP tordu, en-têtes géants, requêtes imbriquées : rien de livré`);
  ok((await t.alive()).status > 0, `${t.name} : répond toujours après les salves`);

  // 4. Centaines de connexions muettes (épuisement des descripteurs) : plafonnées par appareil.
  const socks = [];
  let refused = 0;
  for (let i = 0; i < 400; i++) {
    const s = net.connect(t.port, '127.0.0.1');
    s.on('error', () => {});
    s.on('close', () => refused++);
    s.write('GET ' + t.prefix + 'hello HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Lent: ');
    socks.push(s);
  }
  await wait(1200);
  const open = socks.filter((s) => !s.destroyed).length;
  ok(open <= 30, `${t.name} : 400 connexions muettes d’un même appareil, ${open} gardées, ${refused} fermées aussitôt`);
  for (const s of socks) s.destroy();
  await wait(300);
  ok((await t.alive()).status > 0, `${t.name} : répond toujours une fois les connexions muettes fermées`);
}

// 5. Inondation de la découverte UDP (partage et collaboration).
{
  const u = dgram.createSocket('udp4');
  const msgs = [Buffer.from('{"mg":"share?","v":1}'), Buffer.from('{"mg":"collab?","v":1}'), crypto.randomBytes(200), Buffer.from('{'.repeat(250)), Buffer.alloc(60000, 0x41), Buffer.from('{"mg":"share?","v":1,"__proto__":{"x":1}}')];
  for (const port of [share.UDP_PORT, collab.UDP_PORT, sh.udpPort, co.udpPort].filter((p) => Number.isInteger(p))) for (let i = 0; i < 3000; i++) u.send(msgs[i % msgs.length], port, '127.0.0.1', () => {});
  await wait(1500);
  u.close();
  for (const t of targets) ok((await t.alive()).status > 0, `${t.name} : répond toujours après 3 000 datagrammes UDP hostiles`);
}

const grown = Math.round((process.memoryUsage().rss - mem0) / 1048576);
ok(grown < 300, `mémoire : +${grown} Mo après toutes les salves`);
ok(uncaught.length === 0, 'aucune exception non rattrapée dans les serveurs', uncaught.slice(0, 3));
ok(fs.readdirSync(wifiDir).length === 0, 'réception du téléphone : aucun fichier écrit sans la clé du QR code', fs.readdirSync(wifiDir));
sender.stop?.(); host.stop?.(); receiver.stop?.();
fs.rmSync(wifiDir, { recursive: true, force: true });
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
setTimeout(() => process.exit(process.exitCode || 0), 300);
