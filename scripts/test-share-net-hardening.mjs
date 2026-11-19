// Durcissements du partage par code (electron/share-net.cjs), en Node pur, sur 127.0.0.1 :
//  - l'indice de /open ne sert pas d'oracle : avec le « n » canonique il est toujours le même ;
//    au-delà de 3 « n » libres (anciens destinataires ou attaquant), l'envoi est fermé ;
//  - un en-tête Host qui n'est pas une adresse IP (page web en « DNS rebinding ») est refusé.
// Lancer : node scripts/test-share-net-hardening.mjs
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

process.env.MARGINALIA_E2E = '1';
process.env.MARGINALIA_E2E_LAN = '127.0.0.1';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const share = require(path.join(ROOT, 'electron/share-net.cjs'));
const { hostHeaderOk } = require(path.join(ROOT, 'electron/wifi.cjs'));
const { canonicalN } = share.handshake;

const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + JSON.stringify(extra) : ''));
  if (!c) process.exitCode = 1;
};
const req = (port, method, route, body, host) =>
  new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({ host: '127.0.0.1', port, method, path: `/mg-share/v1/${route}`, headers: { ...(host ? { host } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch {}
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    r.end(data);
  });

ok(hostHeaderOk('192.168.1.10:47801') && hostHeaderOk('127.0.0.1') && hostHeaderOk('[fe80::1%en0]:80'), 'Host : adresses IP admises');
ok(!hostHeaderOk('evil.example:47801') && !hostHeaderOk('localhost') && !hostHeaderOk(''), 'Host : noms de domaine refusés');

const events = [];
const sender = share.createShareSender({ emit: (e) => events.push(e), scrypt: { N: 1024, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } });
const st = await sender.start({ bytes: Buffer.from('contenu'), meta: { title: 't' } });
const hello = await req(st.port, 'GET', 'hello');
ok(hello.status === 200 && hello.json && hello.json.id, 'hello');
const rebind = await req(st.port, 'GET', 'hello', null, 'attacker.example:' + st.port);
ok(rebind.status === 403 || rebind.status === 421, 'Host nom de domaine : refusé', rebind.status);

const id = hello.json.id;
const nc = canonicalN(Buffer.from(id, 'base64url')).toString('base64url');
const hints = new Set();
for (let i = 0; i < 10; i++) {
  const r = await req(st.port, 'POST', 'open', { id, n: nc });
  hints.add(r.json && r.json.hint);
}
ok(hints.size === 1, '« n » canonique : toujours le même indice (4 bits en tout)', [...hints]);
let closedAt = 0;
for (let i = 1; i <= 6; i++) {
  const r = await req(st.port, 'POST', 'open', { id, n: crypto.randomBytes(16).toString('base64url') });
  if (r.status === 429) { closedAt = i; break; }
}
ok(closedAt === 4, '« n » libres : fermé au 4e', closedAt);
ok(events.some((e) => e.type === 'stopped' && e.reason === 'tries'), 'envoi fermé (« tries »)');
sender.stop && sender.stop();
process.exit(process.exitCode || 0);
