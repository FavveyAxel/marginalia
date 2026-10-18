// Exporter un écrit sur le téléphone (chemin inverse du QR code) — port 5372 (ou PORT=…).
// Exporter › « PDF » sur le téléphone : fenêtre QR (clé dans le fragment), page servie au téléphone
// (sans aucun nom de fichier), manifeste et document chiffrés, déchiffrés ici comme le ferait la page
// (TweetNaCl, scripts/qr-telephone.mjs), événements (appareil, téléchargé), jeton faux refusé,
// fermeture = lien mort et port fermé ; tout le trafic passe par un relais qui le garde : aucun octet
// du document ni son nom n'y passent en clair.
// Lancer : DISPLAY=:99 timeout 240 node scripts/test-electron-send-phone.mjs
import { _electron as electron } from 'playwright-core';
import { createServer } from 'vite';
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
import { keyOf, open, decryptDownload, req, captureProxy, leaks, nacl } from './qr-telephone.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.env.PORT || 5372);
const SHOTS = path.join(ROOT, 'shots/envoi-telephone');
fs.mkdirSync(SHOTS, { recursive: true });
const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-send-'));
const ok = (c, m, extra = '') => { console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); if (!c) process.exitCode = 1; };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const get = (url, headers = {}) => req('GET', url, { headers });
let port = 0;
const relay = await captureProxy(() => port);
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env: { ...process.env, HOME: TMP, XDG_CONFIG_HOME: TMP, MARGINALIA_E2E: '1', MARGINALIA_E2E_LAN: '192.168.1.24', VITE_DEV_SERVER_URL: `http://localhost:${PORT}/` }, timeout: 60000 });
try {
  const page = await app.firstWindow();
  await page.setViewportSize?.({ width: 1280, height: 820 });
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  const d = await page.evaluate(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Notes de lecture', html: '<h1>Notes de lecture</h1><p>Un premier paragraphe, pour vérifier l’export.</p>' }));
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), d.id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(800);

  await page.click('[data-tb="export"]');
  await page.waitForSelector('[data-phone="pdf"]');
  const menu = await page.locator('.ed-export-menu').innerText();
  ok(menu.includes('Sur le téléphone') && menu.includes('PDF, à lire ou à imprimer') && menu.includes('Word, à continuer ailleurs'), 'menu Exporter : section « Sur le téléphone »');
  await page.screenshot({ path: path.join(SHOTS, '01-menu.png') });
  await page.click('[data-phone="pdf"]');
  await page.waitForSelector('[data-testid="send-to-phone"][data-port]', { timeout: 30000 });
  port = Number(await page.getAttribute('[data-testid="send-to-phone"]', 'data-port'));
  const p = await page.getAttribute('[data-testid="send-to-phone"]', 'data-path');
  ok(port > 0 && /^\/s\/[A-Za-z0-9_-]{22}$/.test(p), 'envoi ouvert : port et jeton', { port, p });
  const qrUrl = await page.getAttribute('[data-testid="send-to-phone"] .wr-addr', 'title');
  const K = keyOf(qrUrl);
  ok(K && K.length === 32 && qrUrl.startsWith(`http://192.168.1.24:${port}${p}#k=`) && !(await page.locator('.wr-addr').innerText()).includes('#'), 'QR code : clé de 256 bits dans le fragment, adresse affichée sans elle');
  const dlg = await page.locator('[data-testid="send-to-phone"]').innerText();
  ok(dlg.includes('Envoyer sur le téléphone') && dlg.includes('Notes de lecture.pdf') && dlg.includes('Rien ne passe par Internet'), 'fenêtre : nom du document, confidentialité', dlg.replace(/\n/g, ' | '));
  await page.screenshot({ path: path.join(SHOTS, '02-fenetre.png') });

  const B = `http://127.0.0.1:${relay.port}${p}`;
  const pg = await get(B, { 'User-Agent': IPHONE });
  const html = pg.body;
  ok(pg.status === 200 && html.includes('Votre écrit, sur le téléphone') && !html.includes('Notes de lecture') && !/__[A-Z]+__/.test(html) && open(K, /data-check="([^"]+)"/.exec(html)?.[1])?.c, 'page du téléphone servie, gabarit rempli, aucun nom de fichier dedans');
  ok(/default-src 'none'/.test(pg.headers['content-security-policy'] || ''), 'page : CSP stricte');
  await page.waitForSelector('[data-testid="send-to-phone"] .wr-status.is-on', { timeout: 5000 });
  ok((await page.locator('[data-testid="send-to-phone"] .wr-status').innerText()).includes('iPhone connecté'), 'ordinateur : « iPhone connecté »');
  fs.writeFileSync(path.join(SHOTS, 'page.html'), html);

  const m = await get(`${B}/m`, { 'User-Agent': IPHONE });
  const man = open(K, m.body);
  const f0 = man?.files?.[0];
  ok(m.status === 200 && f0?.name === 'Notes de lecture.pdf' && f0.mime === 'application/pdf' && f0.sid && !m.body.includes('Notes'), 'manifeste chiffré : nom, type, identifiant du flux', f0 && { name: f0.name, size: f0.size });
  ok(open(nacl.randomBytes(32), m.body) === null, 'manifeste illisible avec une autre clé');

  const f = await get(`${B}/f/0`, { 'User-Agent': IPHONE });
  const pdf = f.status === 200 ? decryptDownload(K, Buffer.from(f0.sid, 'base64url'), f.buf) : null;
  ok(pdf && pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length === f0.size && f.headers['content-type'] === 'application/octet-stream', 'téléchargement : un vrai PDF une fois déchiffré', { type: f.headers['content-type'], size: f.buf.length });
  ok(!f.headers['content-disposition'] && !f.buf.subarray(0, 5).equals(Buffer.from('%PDF-')), 'document chiffré, sans nom dans les en-têtes (pas de Content-Disposition)');
  const alt = Buffer.from(f.buf);
  alt[alt.length >> 1] ^= 1;
  ok(decryptDownload(K, Buffer.from(f0.sid, 'base64url'), alt) === null && decryptDownload(nacl.randomBytes(32), Buffer.from(f0.sid, 'base64url'), f.buf) === null, 'document altéré ou mauvaise clé : refusé au déchiffrement');
  await page.waitForFunction(() => document.querySelector('[data-testid="send-to-phone"] .wr-status')?.textContent.includes('Téléchargé'), null, { timeout: 5000 });
  ok((await page.locator('[data-testid="send-to-phone"] .wr-status').innerText()).includes('Téléchargé sur l’iPhone'), 'ordinateur : « Téléchargé sur l’iPhone »');
  await page.screenshot({ path: path.join(SHOTS, '03-telecharge.png') });

  ok((await get(`${B}/f/7`)).status === 404, 'fichier inexistant : 404');
  ok((await get(`http://127.0.0.1:${port}/s/AAAAAAAAAAAAAAAAAAAAAA`)).status === 404, 'jeton faux : 404');
  ok((await get(`${B}/state`)).status === 200, 'état : ouvert');
  const seen = relay.traffic();
  const found = leaks(seen, ['Notes de lecture', 'premier paragraphe', os.hostname(), pdf.subarray(pdf.length >> 1, (pdf.length >> 1) + 32), pdf.subarray(0, 32)]);
  ok(found.length === 0, 'trafic capturé : ni le nom ni aucun octet du document en clair', { octets: seen.length, trouvés: found });

  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="send-to-phone"]', { state: 'detached' });
  await page.waitForTimeout(500);
  const after = await get(`http://127.0.0.1:${port}${p}/f/0`);
  ok(after.status !== 200, 'fenêtre fermée : le lien ne sert plus rien', after.status || after.error);

  // Word : nouvelle session, nouveau jeton, nouvelle clé
  await page.click('[data-tb="export"]');
  await page.click('[data-phone="docx"]');
  await page.waitForSelector('[data-testid="send-to-phone"][data-port]', { timeout: 30000 });
  const p2 = await page.getAttribute('[data-testid="send-to-phone"]', 'data-path');
  const port2 = await page.getAttribute('[data-testid="send-to-phone"]', 'data-port');
  const K2 = keyOf(await page.getAttribute('[data-testid="send-to-phone"] .wr-addr', 'title'));
  ok(p2 !== p && K2 && !Buffer.from(K2).equals(Buffer.from(K)), 'Word : nouveau jeton, nouvelle clé');
  const m2 = open(K2, (await get(`http://127.0.0.1:${port2}${p2}/m`)).body);
  const w = await get(`http://127.0.0.1:${port2}${p2}/f/0`, { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile' });
  const docx = m2 ? decryptDownload(K2, Buffer.from(m2.files[0].sid, 'base64url'), w.buf) : null;
  ok(w.status === 200 && docx && docx.subarray(0, 2).toString() === 'PK' && /wordprocessingml/.test(m2.files[0].mime), 'Word : un vrai .docx une fois déchiffré', m2?.files?.[0]?.mime);
  await page.click('[data-testid="send-to-phone"] .wr-head button');
} finally { await relay.close(); await app.close(); await server.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
