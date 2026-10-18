// Partage entre deux Marginalia par code à 6 chiffres, de bout en bout : deux processus Electron (deux
// dossiers de données distincts, donc deux verrous d'instance unique), réseau local simulé par
// MARGINALIA_E2E_LAN=127.0.0.1. L'un appelle window.marginalia.shareNet.sendStart, l'autre find (par
// diffusion UDP) puis receive ; l'émetteur accepte la demande ; empreintes SHA-256 identiques. Puis :
// adresse saisie et refus de l'émetteur ; arrêt de l'envoi ; scrypt mesuré dans Electron (BoringSSL).
// Prérequis : npx vite build ; Xvfb (pgrep Xvfb || (nohup Xvfb :99 -screen 0 1440x900x24 >/dev/null 2>&1 &)).
// Lancer : DISPLAY=:99 timeout 240 node scripts/test-electron-share-net.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
  console.error('dist/ manquant : lancez d’abord « npx vite build ».');
  process.exit(1);
}
const dirs = [];
async function launch(name) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `mg-share-${name}-`));
  dirs.push(home);
  const app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: path.join(home, 'donnees'), MARGINALIA_E2E_LAN: '127.0.0.1', VITE_DEV_SERVER_URL: '' },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await page.evaluate(() => {
    window.__ev = [];
    window.marginalia.shareNet.onEvent((e) => window.__ev.push(e));
  });
  return { app, page, home };
}

const A = await launch('envoi');
const B = await launch('reception');
try {
  ok(A.app !== B.app && (await A.page.evaluate(() => typeof window.marginalia.shareNet?.sendStart)) === 'function' && (await B.page.evaluate(() => typeof window.marginalia.shareNet?.find)) === 'function', 'deux instances lancées, api.shareNet exposée');
  ok((await A.page.evaluate(() => Object.keys(window.marginalia.shareNet).sort().join())) === 'find,onEvent,receive,sendAccept,sendReject,sendStart,sendStop', 'api.shareNet : sendStart, sendStop, sendAccept, sendReject, find, receive, onEvent');

  // ── 1. Découverte UDP, accord, 5 Mo ──
  const SIZE = 5 * 1024 * 1024;
  const sent = await A.page.evaluate(async (size) => {
    // Octets pseudo-aléatoires déterministes (xorshift), empreinte SHA-256.
    const b = new Uint8Array(size);
    let x = 0x9e3779b9;
    for (let i = 0; i < size; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      b[i] = x & 255;
    }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (v) => v.toString(16).padStart(2, '0')).join('');
    const info = await window.marginalia.shareNet.sendStart(b, { title: 'Carnet de lecture', counts: { notes: 12, passages: 34 }, size });
    return { info, hash };
  }, SIZE);
  ok(/^\d{6}$/.test(sent.info.code) && sent.info.port > 0 && sent.info.discovery, 'émetteur : code et port', { code: sent.info.code, port: sent.info.port, addresses: sent.info.addresses });
  // scrypt dans le processus principal d'Electron (BoringSSL) : temps consigné dans le journal local.
  await A.page.waitForTimeout(300);
  const log = fs.readFileSync(path.join(A.home, 'donnees/diagnostic.log'), 'utf8');
  const ms = Number((/clé du code[^\n]*?(\d+) ms/.exec(log) || [])[1]);
  ok(ms > 50, `scrypt N=2^17 dans Electron : ${ms} ms (journal de diagnostic)`);

  const t0 = Date.now();
  const found = await B.page.evaluate((code) => window.marginalia.shareNet.find(code), sent.info.code);
  ok(found.meta.title === 'Carnet de lecture' && found.meta.counts.passages === 34 && found.size === SIZE && found.from.address === '127.0.0.1', 'destinataire : trouvé par diffusion, métadonnées avant acceptation', { ms: Date.now() - t0, from: found.from });
  await A.page.waitForFunction(() => window.__ev.some((e) => e.side === 'send' && e.type === 'request'), null, { timeout: 10000 });
  const req = await A.page.evaluate(() => window.__ev.find((e) => e.type === 'request'));
  ok(req.address === '127.0.0.1' && typeof req.device === 'string' && req.device.length > 0, 'émetteur : événement « demande » (appareil, adresse)', req);

  await B.page.evaluate((id) => {
    window.__recv = window.marginalia.shareNet.receive(id).then(
      async (buf) => ({ size: buf.byteLength, hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)), (v) => v.toString(16).padStart(2, '0')).join('') }),
      (e) => ({ error: String(e && e.message) }),
    );
  }, found.id);
  await A.page.waitForTimeout(500);
  ok(!(await A.page.evaluate(() => window.__ev.some((e) => e.type === 'progress'))), 'rien n’est envoyé avant l’accord');
  ok((await A.page.evaluate(() => window.marginalia.shareNet.sendAccept())) === true, 'émetteur : sendAccept()');
  const got = await B.page.evaluate(() => window.__recv);
  ok(got.size === SIZE && got.hash === sent.hash, '5 Mo reçus par l’autre Marginalia : SHA-256 identique', { ms: Date.now() - t0, hash: got.hash && got.hash.slice(0, 16), error: got.error });
  await A.page.waitForFunction(() => window.__ev.some((e) => e.type === 'stopped'), null, { timeout: 5000 });
  const evA = await A.page.evaluate(() => window.__ev.map((e) => e.type + (e.reason ? ':' + e.reason : '')));
  const evB = await B.page.evaluate(() => window.__ev.map((e) => e.side + ':' + e.type));
  ok(evA.includes('progress') && evA.includes('done') && evA.includes('stopped:sent'), 'émetteur : progression, terminé, arrêté', [...new Set(evA)]);
  ok(evB.includes('receive:progress') && evB.includes('receive:done'), 'destinataire : progression et terminé', [...new Set(evB)]);

  // ── 2. Adresse saisie + refus ──
  const s2 = await A.page.evaluate(() => window.marginalia.shareNet.sendStart(new TextEncoder().encode('petit paquet'), { title: 'Refusé' }));
  const f2 = await B.page.evaluate(([code, addr]) => window.marginalia.shareNet.find(code, addr), [s2.code, `127.0.0.1:${s2.port}`]);
  ok(f2.meta.title === 'Refusé', 'destinataire : trouvé par adresse saisie « 127.0.0.1:port »');
  await B.page.evaluate((id) => {
    window.__recv2 = window.marginalia.shareNet.receive(id).then(() => 'reçu', (e) => String(e && e.message));
  }, f2.id);
  await A.page.waitForTimeout(300);
  ok((await A.page.evaluate(() => window.marginalia.shareNet.sendReject())) === true, 'émetteur : sendReject()');
  const r2 = await B.page.evaluate(() => window.__recv2);
  ok(/L’envoi a été refusé\./.test(r2), 'destinataire : « L’envoi a été refusé. »', r2);

  // ── 3. Code faux, puis arrêt de l'envoi ──
  const wrong = String((Number(s2.code) + 1) % 1000000).padStart(6, '0');
  const r3 = await B.page.evaluate(([code, addr]) => window.marginalia.shareNet.find(code, addr).then(() => 'trouvé', (e) => String(e && e.message)), [wrong, `127.0.0.1:${s2.port}`]);
  ok(/Code incorrect/.test(r3), 'code faux : « Code incorrect »', r3);
  await A.page.evaluate(() => window.marginalia.shareNet.sendStop());
  const r4 = await B.page.evaluate((code) => window.marginalia.shareNet.find(code).then(() => 'trouvé', (e) => String(e && e.message)), s2.code);
  ok(/Aucun envoi trouvé avec ce code sur ce réseau/.test(r4), 'après sendStop : « Aucun envoi trouvé… »', r4);
  ok((await A.page.evaluate(() => window.__ev.filter((e) => e.type === 'stopped').map((e) => e.reason))).includes('closed'), 'émetteur : arrêté (closed)');
} finally {
  await A.app.close().catch(() => {});
  await B.app.close().catch(() => {});
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}
