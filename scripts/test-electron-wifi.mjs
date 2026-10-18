// Réception par le Wi-Fi (window.marginalia.inbox.wifi*) : ouverture d'une session, page servie au
// téléphone (CSP, nonce), envois de fichiers et de texte, refus (jeton faux, en-tête manquant, type,
// taille, nom dangereux), lecture et effacement par la boîte, fermeture (jeton périmé, port fermé),
// verrou de l'app. Le « téléphone » est simulé par des requêtes HTTP depuis ce script (127.0.0.1).
// Lancer : DISPLAY=:99 timeout 180 node scripts/test-electron-wifi.mjs  (ou xvfb-run -a node …)
import { _electron as electron } from 'playwright-core';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const wifi = require(path.join(ROOT, 'electron/wifi.cjs'));
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-wifi-'));
const INBOX = path.join(HOME, 'Documents/Marginalia');
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};

// ── Fonctions pures ──
ok(['192.168.1.4', '10.0.0.2', '172.16.5.1', '172.31.255.1', '127.0.0.1', '::ffff:192.168.0.9', '::1', 'fe80::1', 'fd12::4', '169.254.1.1'].every(wifi.isLocalAddress), 'adresses locales acceptées');
ok(!['8.8.8.8', '172.32.0.1', '100.64.0.1', '1.2.3.4', '::ffff:8.8.8.8', '2001:db8::1', '', undefined].some(wifi.isLocalAddress), 'adresses publiques refusées');
const lan = wifi.lanAddresses({
  lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  docker0: [{ family: 'IPv4', address: '172.17.0.1', internal: false }],
  'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.0.1', internal: false }],
  utun3: [{ family: 'IPv4', address: '10.8.0.2', internal: false }],
  en5: [{ family: 'IPv4', address: '10.0.0.7', internal: false }],
  en0: [{ family: 'IPv4', address: '192.168.1.24', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
});
ok(lan.map((x) => x.address).join() === '192.168.1.24,10.0.0.7', 'interfaces : Wi-Fi d’abord, virtuelles et VPN écartées', lan);
ok(wifi.cleanName('../../etc/passwd.pdf', 'x').base === 'passwd' && wifi.cleanName('..\\..\\a.pdf', 'x').base === 'a', 'nom : chemins retirés');
ok(wifi.cleanName('.cache.epub', 'x').base === 'cache' && wifi.cleanName('~$x.docx', 'x').base === 'x', 'nom : pas de point ni ~$ initial');
ok(wifi.cleanName('a<b>:c|d?.pdf', 'x').base === 'a b c d', 'nom : caractères réservés remplacés');

/** Requête HTTP simple : { status, headers, body }. */
function req(method, url, { body, headers = {} } = {}) {
  return new Promise((resolve) => {
    const r = http.request(url, { method, headers: { ...(body != null ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', (e) => resolve({ status: 0, error: e.code || e.message }));
    if (body != null) r.write(body);
    r.end();
  });
}

const env = { ...process.env, HOME, XDG_CONFIG_HOME: path.join(HOME, '.config'), VITE_DEV_SERVER_URL: '', MARGINALIA_E2E: '1', MARGINALIA_INBOX_DIR: INBOX };
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window.marginalia && window.marginalia.inbox), null, { timeout: 30000 });
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  const WDIR = path.join(userData, 'wifi-recus');

  await page.evaluate(() => {
    window.__wifi = [];
    window.__changes = 0;
    window.marginalia.inbox.onWifi((e) => window.__wifi.push(e));
    window.marginalia.inbox.onChange(() => window.__changes++);
  });
  const info = await page.evaluate(() => window.marginalia.inbox.wifiStart());
  ok(info.open && info.port > 0 && /^\/r\/[A-Za-z0-9_-]{22}$/.test(info.path), 'session ouverte : port et jeton de 128 bits', { port: info.port, path: info.path });
  ok(Array.isArray(info.urls) && info.urls.every((u) => u.url.endsWith(info.path) && u.url.startsWith('http://')), 'adresses à scanner', info.urls);
  const again = await page.evaluate(() => window.marginalia.inbox.wifiStart());
  ok(again.path === info.path, 'ouverture idempotente (même jeton pendant la session)');
  const B = `http://127.0.0.1:${info.port}${info.path}`;

  // Page du téléphone
  const pg = await req('GET', B, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148' } });
  ok(pg.status === 200 && /Envoyer à l’ordinateur/.test(pg.body), 'page servie');
  const csp = pg.headers['content-security-policy'] || '';
  const nonce = /nonce-([^']+)'/.exec(csp)?.[1];
  ok(!!nonce && pg.body.includes(`nonce="${nonce}"`) && !pg.body.includes('__NONCE__') && /default-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp), 'CSP stricte avec nonce, sans gabarit restant');
  ok(pg.headers['cache-control'] === 'no-store' && pg.headers['x-frame-options'] === 'DENY', 'pas de cache, pas d’intégration');
  ok(!/https?:\/\/(?!local)/.test(pg.body.replace(/http:\/\/www\.w3\.org[^"']*/g, '')), 'aucune ressource externe dans la page');
  await page.waitForTimeout(200);
  ok((await page.evaluate(() => window.__wifi)).some((e) => e.type === 'device' && e.device === 'iPhone'), 'interface prévenue : iPhone connecté');

  // Refus
  ok((await req('GET', `http://127.0.0.1:${info.port}/r/AAAAAAAAAAAAAAAAAAAAAA`)).status === 404, 'jeton faux : 404');
  ok((await req('GET', `http://127.0.0.1:${info.port}/`)).status === 404, 'racine : 404');
  ok((await req('POST', `${B}/file?name=a.pdf`, { body: '%PDF-1.4' })).status === 403, 'envoi sans en-tête X-Marginalia : refusé (autre page web)');
  const H = { 'X-Marginalia': '1', 'Content-Type': 'application/octet-stream' };
  const exe = await req('POST', `${B}/file?name=virus.exe`, { body: 'MZ', headers: H });
  ok(exe.status === 415 && /pas accepté/.test(exe.body), 'type refusé (.exe)');
  const big = await new Promise((resolve) => {
    const r = http.request(`${B}/file?name=gros.pdf`, { method: 'POST', headers: { ...H, 'Content-Length': String(300 * 1024 * 1024) } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', () => resolve(0));
    r.write('%PDF');
    setTimeout(() => r.destroy(), 1500);
  });
  ok(big === 413, 'trop volumineux (annoncé 300 Mo) : 413 sans tout lire', big);
  ok((await req('POST', `${B}/text`, { body: '   ', headers: H })).status === 400, 'texte vide refusé');

  // Envois
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const r1 = await req('POST', `${B}/file?name=${encodeURIComponent('IMG_1234.JPG')}`, { body: jpg, headers: H });
  const n1 = JSON.parse(r1.body).name;
  ok(r1.status === 200 && /^Photo du \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\.jpg$/i.test(n1) && fs.readFileSync(path.join(WDIR, n1)).equals(jpg), 'photo reçue, nommée par la date, contenu intact', n1);
  const r2 = await req('POST', `${B}/file?name=${encodeURIComponent('../../Du contrat social.epub')}`, { body: 'PK..epub', headers: H });
  const n2 = JSON.parse(r2.body).name;
  ok(r2.status === 200 && n2 === 'Du contrat social.epub' && fs.existsSync(path.join(WDIR, n2)) && !fs.existsSync(path.join(userData, '..', 'Du contrat social.epub')), 'nom avec chemin : rangé dans le dossier de réception seulement', n2);
  const r3 = await req('POST', `${B}/file?name=${encodeURIComponent('Du contrat social.epub')}`, { body: 'PK..2', headers: H });
  ok(JSON.parse(r3.body).name === 'Du contrat social (2).epub', 'même nom : suffixe (2)');
  const text = '“L’homme est né libre, et partout il est dans les fers.”\n\nMa note : à citer.';
  const r4 = await req('POST', `${B}/text`, { body: text, headers: { ...H, 'Content-Type': 'text/plain; charset=utf-8' } });
  const n4 = JSON.parse(r4.body).name;
  ok(r4.status === 200 && /^Texte du .+\.txt$/.test(n4) && fs.readFileSync(path.join(WDIR, n4), 'utf8') === text, 'texte reçu en UTF-8', n4);
  ok(!fs.readdirSync(WDIR).some((f) => f.startsWith('.part')), 'aucun fichier partiel laissé');
  await page.waitForTimeout(300);
  const evs = await page.evaluate(() => window.__wifi.filter((e) => e.type === 'received'));
  ok(evs.length === 4 && evs[0].kind === 'image' && evs[1].kind === 'book' && evs[3].kind === 'text', 'interface prévenue de chaque envoi, avec sa nature', evs.map((e) => e.kind));
  ok((await page.evaluate(() => window.__changes)) >= 4, 'boîte prévenue (avis de changement)');

  // La boîte lit les envois (dossier synchronisé non activé)
  const list = await page.evaluate(() => window.marginalia.inbox.list());
  ok(list.length === 4 && list.every((f) => f.source === 'wifi'), 'boîte : les 4 envois, marqués Wi-Fi', list.map((f) => f.name));
  fs.mkdirSync(INBOX, { recursive: true });
  fs.writeFileSync(path.join(INBOX, 'Dossier.pdf'), '%PDF');
  ok((await page.evaluate(() => window.marginalia.inbox.list())).length === 4, 'dossier synchronisé non activé : pas lu');
  await page.evaluate(() => window.marginalia.inbox.enable());
  const both = await page.evaluate(() => window.marginalia.inbox.list());
  ok(both.length === 5 && both.find((f) => f.name === 'Dossier.pdf' && !f.source), 'dossier activé : les deux sources');
  const read = await page.evaluate(async (n) => { const f = await window.marginalia.inbox.read(n); return new TextDecoder().decode(f.data); }, n4);
  ok(read === text, 'lecture d’un envoi');
  await page.evaluate((n) => window.marginalia.inbox.done(n), n4);
  ok(!fs.existsSync(path.join(WDIR, n4)) && !fs.existsSync(path.join(WDIR, 'Traités')), 'envoi traité : effacé (pas de copie dans « Traités »)');
  await page.evaluate(() => window.marginalia.inbox.done('Dossier.pdf'));
  ok(fs.existsSync(path.join(INBOX, 'Traités', 'Dossier.pdf')), 'fichier du dossier synchronisé : toujours rangé dans « Traités »');
  const bad = await page.evaluate(() => window.marginalia.inbox.read('../db.json').then(() => 'lu', (e) => String(e.message || e)));
  ok(/invalide/.test(bad), 'nom dangereux refusé par la boîte', bad);

  // Fermeture
  await page.evaluate(() => window.marginalia.inbox.wifiStop());
  await page.waitForTimeout(200);
  ok((await page.evaluate(() => window.__wifi.at(-1))).type === 'stopped', 'interface prévenue de la fermeture');
  const closed = await req('GET', B);
  ok(closed.status === 0, 'port fermé après « Fermer »', closed.error);
  ok((await page.evaluate(() => window.marginalia.inbox.wifiInfo())).open === false, 'info : fermée');
  const info2 = await page.evaluate(() => window.marginalia.inbox.wifiStart());
  ok(info2.path !== info.path, 'nouvelle session : nouveau jeton');
  const old = await req('GET', `http://127.0.0.1:${info2.port}${info.path}`);
  ok(old.status === 404, 'ancien code : refusé', old.status);
  ok((await req('GET', `http://127.0.0.1:${info2.port}${info2.path}/state`)).status === 200, 'nouveau code : accepté');
  await page.evaluate(() => window.marginalia.inbox.wifiStop());
} finally {
  await app.close();
  fs.rmSync(HOME, { recursive: true, force: true });
}
