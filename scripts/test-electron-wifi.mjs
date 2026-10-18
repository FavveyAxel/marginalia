// Réception par le Wi-Fi (window.marginalia.inbox.wifi*) : ouverture d'une session, page servie au
// téléphone (CSP, nonce, bibliothèque de chiffrement embarquée), envois chiffrés de fichiers et de
// texte, refus (jeton faux, en-tête manquant, type, taille, nom dangereux, bloc altéré, troncature,
// mauvaise clé, rejeu, ancien envoi en clair), lecture et effacement par la boîte, fermeture (jeton
// périmé, port fermé), verrou de l'app. Le « téléphone » est simulé par des requêtes HTTP depuis ce
// script (127.0.0.1), chiffrées avec TweetNaCl (scripts/qr-telephone.mjs), à travers un relais qui
// garde tout le trafic : on vérifie qu'aucun octet de fichier, aucun nom ni titre n'y passe en clair.
// Lancer : DISPLAY=:99 timeout 180 node scripts/test-electron-wifi.mjs  (ou xvfb-run -a node …)
import { _electron as electron } from 'playwright-core';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { keyOf, upload, encryptBody, open, req, captureProxy, leaks, nacl, CHUNK } from './qr-telephone.mjs';

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

const env = { ...process.env, HOME, XDG_CONFIG_HOME: path.join(HOME, '.config'), VITE_DEV_SERVER_URL: '', MARGINALIA_E2E: '1', MARGINALIA_E2E_LAN: '192.168.1.24', MARGINALIA_INBOX_DIR: INBOX };
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env, timeout: 60000 });
let relay = null;
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window.marginalia && window.marginalia.inbox), null, { timeout: 30000 });
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  const WDIR = path.join(userData, 'wifi-recus');

  await page.evaluate(() => {
    window.__inboxPaused = true; // l'interface ne traite pas les fichiers : on teste la couche du dessous
    window.__wifi = [];
    window.__changes = 0;
    window.marginalia.inbox.onWifi((e) => window.__wifi.push(e));
    window.marginalia.inbox.onChange(() => window.__changes++);
  });
  const info = await page.evaluate(() => window.marginalia.inbox.wifiStart());
  ok(info.open && info.port > 0 && /^\/r\/[A-Za-z0-9_-]{22}$/.test(info.path), 'session ouverte : port et jeton de 128 bits', { port: info.port, path: info.path });
  ok(Array.isArray(info.urls) && info.urls.length === 1 && info.urls.every((u) => u.url.startsWith(`http://192.168.1.24:${info.port}${info.path}#k=`)), 'adresses à scanner : jeton dans le chemin, clé dans le fragment', info.urls.map((u) => u.url.replace(/#k=.*/, '#k=…')));
  const K = keyOf(info.urls[0].url);
  ok(K && K.length === 32 && !info.path.includes(Buffer.from(K).toString('base64url')), 'clé de 256 bits, seulement dans le fragment (jamais dans le chemin)');
  const again = await page.evaluate(() => window.marginalia.inbox.wifiStart());
  ok(again.path === info.path && again.urls[0].url === info.urls[0].url, 'ouverture idempotente (même jeton, même clé pendant la session)');
  // Tout le trafic du « téléphone » passe par un relais qui le garde (ce qu'un voisin du Wi-Fi verrait).
  relay = await captureProxy(() => info.port);
  const B = `http://127.0.0.1:${relay.port}${info.path}`;

  // Page du téléphone
  const pg = await req('GET', B, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148' } });
  ok(pg.status === 200 && /Envoyer à l’ordinateur/.test(pg.body), 'page servie');
  const csp = pg.headers['content-security-policy'] || '';
  const nonce = /nonce-([^']+)'/.exec(csp)?.[1];
  ok(!!nonce && pg.body.includes(`nonce="${nonce}"`) && !/__[A-Z]+__/.test(pg.body) && /default-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp), 'CSP stricte avec nonce, sans gabarit restant');
  ok(pg.headers['cache-control'] === 'no-store' && pg.headers['x-frame-options'] === 'DENY', 'pas de cache, pas d’intégration');
  ok(!/https?:\/\/(?!local)/.test(pg.body.replace(/http:\/\/www\.w3\.org[^"']*/g, '').replace(/<http:\/\/unlicense\.org>/g, '')) && !/<script[^>]+src=/.test(pg.body), 'aucune ressource externe dans la page');
  const scripts = [...pg.body.matchAll(/<script nonce="([^"]+)">/g)].map((m) => m[1]);
  ok(scripts.length === 2 && scripts.every((n) => n === nonce) && pg.body.includes('secretbox') && pg.body.includes('mgCrypt'), 'bibliothèque de chiffrement embarquée sous le nonce CSP', scripts.length);
  const check = /data-check="([A-Za-z0-9_-]+)"/.exec(pg.body)?.[1];
  const hello = open(K, check);
  ok(hello && hello.c === os.hostname().replace(/\.local$/i, '').slice(0, 60) && !pg.body.includes(`>${hello.c}<`), 'nom de l’ordinateur chiffré dans la page (sert à vérifier la clé)', hello);
  ok(open(nacl.randomBytes(32), check) === null, 'avec une autre clé, la vérification échoue');
  await page.waitForTimeout(200);
  ok((await page.evaluate(() => window.__wifi)).some((e) => e.type === 'device' && e.device === 'iPhone'), 'interface prévenue : iPhone connecté');

  // Refus
  ok((await req('GET', `http://127.0.0.1:${info.port}/r/AAAAAAAAAAAAAAAAAAAAAA`)).status === 404, 'jeton faux : 404');
  ok((await req('GET', `http://127.0.0.1:${info.port}/`)).status === 404, 'racine : 404');
  const noHdr = await upload(B, K, { name: 'a.pdf', bytes: Buffer.from('%PDF-1.4'), headers: { 'X-Marginalia': '' } });
  ok(noHdr.status === 403, 'envoi sans en-tête X-Marginalia : refusé (autre page web)', noHdr.status);
  const H = { 'X-Marginalia': '1', 'Content-Type': 'application/octet-stream' };
  ok((await req('POST', `${B}/file?name=a.pdf`, { body: '%PDF-1.4', headers: H })).status === 404 && (await req('POST', `${B}/text`, { body: 'abc', headers: H })).status === 404, 'ancien envoi en clair (/file, /text) : n’existe plus');
  const exe = await upload(B, K, { name: 'virus.exe', bytes: Buffer.from('MZ') });
  ok(exe.status === 415 && /pas accepté/.test(exe.json?.error || '') && !exe.body.includes('accepté'), 'type refusé (.exe), réponse chiffrée', exe.status);
  const bigId = nacl.randomBytes(16);
  const big = await new Promise((resolve) => {
    const m = Buffer.from(nacl.secretbox(Buffer.from(JSON.stringify({ t: 'file', n: 'gros.pdf' })), (() => { const n = Buffer.alloc(24); Buffer.from(bigId).copy(n); n[16] = 1; n[17] = 1; return n; })(), K)).toString('base64url');
    const r = http.request(`${B}/up?id=${Buffer.from(bigId).toString('base64url')}&m=${m}`, { method: 'POST', headers: { ...H, 'Content-Length': String(300 * 1024 * 1024) } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', () => resolve(0));
    r.write('%PDF');
    setTimeout(() => r.destroy(), 1500);
  });
  ok(big === 413, 'trop volumineux (annoncé 300 Mo) : 413 sans tout lire', big);
  ok((await upload(B, K, { text: '   ' })).status === 400, 'texte vide refusé');

  // Envois
  // « Photo » de 2,5 Mio (trois blocs) : contenu pseudo-aléatoire reconnaissable dans le trafic.
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(Math.round(2.5 * CHUNK))]);
  const r1 = await upload(B, K, { name: 'IMG_1234.JPG', bytes: jpg });
  const n1 = r1.json?.name;
  ok(r1.status === 200 && /^Photo du \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\.jpg$/i.test(n1 || '') && fs.readFileSync(path.join(WDIR, n1)).equals(jpg), 'photo (3 blocs) reçue, déchiffrée, nommée par la date, contenu intact', n1);
  ok(r1.body && !r1.body.includes('Photo du') && open(nacl.randomBytes(32), r1.body) === null, 'réponse d’envoi chiffrée (le nom donné n’y est pas en clair)');
  const r2 = await upload(B, K, { name: '../../Du contrat social.epub', bytes: Buffer.from('PK..epub') });
  const n2 = r2.json?.name;
  ok(r2.status === 200 && n2 === 'Du contrat social.epub' && fs.existsSync(path.join(WDIR, n2)) && !fs.existsSync(path.join(userData, '..', 'Du contrat social.epub')), 'nom avec chemin : rangé dans le dossier de réception seulement', n2);
  const r3 = await upload(B, K, { name: 'Du contrat social.epub', bytes: Buffer.from('PK..2') });
  ok(r3.json?.name === 'Du contrat social (2).epub', 'même nom : suffixe (2)');
  const text = '“L’homme est né libre, et partout il est dans les fers.”\n\nMa note : à citer.';
  const r4 = await upload(B, K, { text });
  const n4 = r4.json?.name;
  ok(r4.status === 200 && /^Texte du .+\.txt$/.test(n4 || '') && fs.readFileSync(path.join(WDIR, n4), 'utf8') === text, 'texte reçu en UTF-8', n4);

  // Altérations : rien n'est écrit, rien n'est annoncé à l'interface.
  const before = fs.readdirSync(WDIR).length;
  const pdf = crypto.randomBytes(2 * CHUNK + 1234);
  const tid = nacl.randomBytes(16);
  const good = encryptBody(K, tid, pdf);
  const flipped = Buffer.from(good);
  flipped[CHUNK + 16 + 500] ^= 1; // un bit du 2e bloc
  const t1 = await upload(B, K, { name: 'Altéré.pdf', id: tid, body: flipped });
  ok(t1.status === 400 && /altéré/.test(t1.json?.error || ''), 'bloc altéré (un bit) : refusé', t1.json);
  const t2id = nacl.randomBytes(16);
  const full = encryptBody(K, t2id, pdf);
  const t2 = await upload(B, K, { name: 'Tronqué.pdf', id: t2id, body: full.subarray(0, 2 * (CHUNK + 16)) });
  ok(t2.status === 400, 'dernier bloc retiré (troncature) : refusé', t2.status);
  const t3id = nacl.randomBytes(16);
  const f3 = encryptBody(K, t3id, pdf);
  const swapped = Buffer.concat([f3.subarray(CHUNK + 16, 2 * (CHUNK + 16)), f3.subarray(0, CHUNK + 16), f3.subarray(2 * (CHUNK + 16))]);
  ok((await upload(B, K, { name: 'Désordre.pdf', id: t3id, body: swapped })).status === 400, 'blocs intervertis : refusé');
  const t4id = nacl.randomBytes(16);
  ok((await upload(B, K, { name: 'Greffe.pdf', id: t4id, body: encryptBody(K, nacl.randomBytes(16), pdf) })).status === 400, 'blocs d’un autre envoi (autre identifiant) : refusés');
  const wrong = nacl.randomBytes(32);
  const t5 = await upload(B, wrong, { name: 'Mauvaise clé.pdf', bytes: pdf });
  ok(t5.status === 400 && open(wrong, t5.body) === null, 'mauvaise clé : refusé (et la réponse ne lui est pas lisible)', t5.status);
  const replay = await req('POST', `${B}/up?id=${r2.idTxt}&m=${r2.m}`, { body: r2.sent, headers: H });
  ok(replay.status === 409, 'envoi rejoué (même identifiant) : refusé', replay.status);
  const badMeta = await req('POST', `${B}/up?id=${Buffer.from(nacl.randomBytes(16)).toString('base64url')}&m=${t1.m}`, { body: good, headers: H });
  ok(badMeta.status === 400, 'nom chiffré d’un autre envoi : refusé', badMeta.status);
  ok(fs.readdirSync(WDIR).length === before, 'altérations : aucun fichier écrit');
  ok(!fs.readdirSync(WDIR).some((f) => f.startsWith('.part')), 'aucun fichier partiel laissé');
  await page.waitForTimeout(300);
  const evs = await page.evaluate(() => window.__wifi.filter((e) => e.type === 'received'));
  ok(evs.length === 4 && evs[0].kind === 'image' && evs[1].kind === 'book' && evs[3].kind === 'text', 'interface prévenue de chaque envoi (et seulement des bons), avec sa nature', evs.map((e) => e.kind));
  ok((await page.evaluate(() => window.__changes)) >= 4, 'boîte prévenue (avis de changement)');

  // Devenir d'un envoi, demandé par le téléphone avec l'identifiant opaque de son envoi
  const res0 = await req('GET', `${B}/result?id=${r1.idTxt}`);
  ok(res0.status === 200 && open(K, res0.body)?.state === 'working', 'résultat : « en cours » tant que l’app n’a rien dit');
  const LABEL = 'Ajouté à la bibliothèque : « Essai sur l’entendement humain »';
  await page.evaluate(([n, l]) => window.marginalia.inbox.wifiReport(n, { state: 'library', label: l }), [n1, LABEL]);
  const res1raw = await req('GET', `${B}/result?id=${r1.idTxt}`);
  const res1 = open(K, res1raw.body);
  ok(res1?.state === 'library' && res1.label === LABEL && !res1raw.body.includes('bibliothèque'), 'résultat renvoyé au téléphone, chiffré', res1);
  // (demande directe, hors relais : elle porte volontairement le nom en clair)
  ok((await req('GET', `http://127.0.0.1:${info.port}${info.path}/result?name=${encodeURIComponent(n1)}`)).status === 404, 'résultat demandé par le nom (ancien protocole) : refusé');
  ok((await req('GET', `${B}/result?id=${t1.idTxt}`)).status === 404, 'résultat d’un envoi refusé : inconnu');
  await page.evaluate(() => window.marginalia.inbox.wifiReport('autre.pdf', { state: 'library', label: 'x' }));
  ok((await req('GET', `${B}/result?id=${Buffer.from(nacl.randomBytes(16)).toString('base64url')}`)).status === 404, 'l’app ne peut pas inventer un envoi');

  // Ce qu'un voisin du Wi-Fi a vu passer
  const seen = relay.traffic();
  const mid = (b) => b.subarray(Math.floor(b.length / 2), Math.floor(b.length / 2) + 32);
  const found = leaks(seen, ['IMG_1234', 'Du contrat social', 'L’homme est né libre', 'Ma note', 'Essai sur l’entendement', LABEL, n1, 'Photo du', 'Du contrat social (2)', 'Texte du', 'Altéré', 'Mauvaise clé', 'virus.exe', os.hostname(), mid(jpg), jpg.subarray(4, 36), jpg.subarray(-32), mid(pdf)]);
  ok(seen.length > 5 * CHUNK && found.length === 0, 'trafic capturé : aucun octet de fichier, aucun nom, texte ni titre en clair', { octets: seen.length, trouvés: found });
  ok(!seen.includes(Buffer.from(Buffer.from(K).toString('base64url'))), 'trafic capturé : la clé n’y passe jamais');
  ok(leaks(Buffer.concat([seen, jpg, Buffer.from(encodeURIComponent(LABEL))]), [mid(jpg), LABEL]).length === 2, 'contrôle du détecteur : du clair glissé dans le trafic est bien trouvé');

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
  const closed = await req('GET', `http://127.0.0.1:${info.port}${info.path}`);
  ok(closed.status === 0, 'port fermé après « Fermer »', closed.error);
  ok((await page.evaluate(() => window.marginalia.inbox.wifiInfo())).open === false, 'info : fermée');
  const info2 = await page.evaluate(() => window.marginalia.inbox.wifiStart());
  ok(info2.path !== info.path && keyOf(info2.urls[0].url) && !Buffer.from(keyOf(info2.urls[0].url)).equals(Buffer.from(K)), 'nouvelle session : nouveau jeton, nouvelle clé');
  const old = await req('GET', `http://127.0.0.1:${info2.port}${info.path}`);
  ok(old.status === 404, 'ancien code : refusé', old.status);
  ok((await req('GET', `http://127.0.0.1:${info2.port}${info2.path}/state`)).status === 200, 'nouveau code : accepté');
  const oldKey = await upload(`http://127.0.0.1:${info2.port}${info2.path}`, K, { name: 'Vieux.pdf', bytes: Buffer.from('%PDF') });
  ok(oldKey.status === 400, 'clé de l’ancienne session : refusée', oldKey.status);
  await page.evaluate(() => window.marginalia.inbox.wifiStop());
} finally {
  await relay?.close();
  await app.close();
  fs.rmSync(HOME, { recursive: true, force: true });
}
