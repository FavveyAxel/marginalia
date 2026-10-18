// Exporter un écrit sur le téléphone (chemin inverse du QR code) — port 5372.
// Exporter › « PDF » sur le téléphone : fenêtre QR, page servie au téléphone, téléchargement (en-têtes,
// contenu), événements (appareil, téléchargé), jeton faux refusé, fermeture = lien mort et port fermé.
// Lancer : DISPLAY=:99 timeout 240 node scripts/test-electron-send-phone.mjs
import { _electron as electron } from 'playwright-core';
import { createServer } from 'vite';
import http from 'node:http';
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5372;
const SHOTS = path.join(ROOT, 'shots/envoi-telephone');
fs.mkdirSync(SHOTS, { recursive: true });
const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-send-'));
const ok = (c, m, extra = '') => { console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); if (!c) process.exitCode = 1; };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
function get(url, headers = {}) {
  return new Promise((resolve) => {
    http.get(url, { headers }, (res) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(c) })); }).on('error', (e) => resolve({ status: 0, error: e.code }));
  });
}
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
  const port = await page.getAttribute('[data-testid="send-to-phone"]', 'data-port');
  const p = await page.getAttribute('[data-testid="send-to-phone"]', 'data-path');
  ok(Number(port) > 0 && /^\/s\/[A-Za-z0-9_-]{22}$/.test(p), 'envoi ouvert : port et jeton', { port, p });
  const dlg = await page.locator('[data-testid="send-to-phone"]').innerText();
  ok(dlg.includes('Envoyer sur le téléphone') && dlg.includes('Notes de lecture.pdf') && dlg.includes('Rien ne passe par Internet'), 'fenêtre : nom du document, confidentialité', dlg.replace(/\n/g, ' | '));
  await page.screenshot({ path: path.join(SHOTS, '02-fenetre.png') });

  const B = `http://127.0.0.1:${port}${p}`;
  const pg = await get(B, { 'User-Agent': IPHONE });
  const html = pg.buf.toString('utf8');
  ok(pg.status === 200 && html.includes('Votre écrit, sur le téléphone') && html.includes('Notes de lecture.pdf') && !/__[A-Z]+__/.test(html), 'page du téléphone servie, gabarit rempli');
  ok(/default-src 'none'/.test(pg.headers['content-security-policy'] || ''), 'page : CSP stricte');
  await page.waitForSelector('[data-testid="send-to-phone"] .wr-status.is-on', { timeout: 5000 });
  ok((await page.locator('[data-testid="send-to-phone"] .wr-status').innerText()).includes('iPhone connecté'), 'ordinateur : « iPhone connecté »');
  fs.writeFileSync(path.join(SHOTS, 'page.html'), html);

  const f = await get(`${B}/f/0`, { 'User-Agent': IPHONE });
  ok(f.status === 200 && f.headers['content-type'] === 'application/pdf' && f.buf.subarray(0, 5).toString() === '%PDF-', 'téléchargement : un vrai PDF', { type: f.headers['content-type'], size: f.buf.length });
  ok(/attachment/.test(f.headers['content-disposition'] || '') && /Notes%20de%20lecture\.pdf|Notes de lecture\.pdf/.test(f.headers['content-disposition'] || ''), 'Content-Disposition : pièce jointe nommée', f.headers['content-disposition']);
  await page.waitForFunction(() => document.querySelector('[data-testid="send-to-phone"] .wr-status')?.textContent.includes('Téléchargé'), null, { timeout: 5000 });
  ok((await page.locator('[data-testid="send-to-phone"] .wr-status').innerText()).includes('Téléchargé sur l’iPhone'), 'ordinateur : « Téléchargé sur l’iPhone »');
  await page.screenshot({ path: path.join(SHOTS, '03-telecharge.png') });

  ok((await get(`${B}/f/7`)).status === 404, 'fichier inexistant : 404');
  ok((await get(`http://127.0.0.1:${port}/s/AAAAAAAAAAAAAAAAAAAAAA`)).status === 404, 'jeton faux : 404');
  ok((await get(`${B}/state`)).status === 200, 'état : ouvert');

  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="send-to-phone"]', { state: 'detached' });
  await page.waitForTimeout(500);
  const after = await get(`${B}/f/0`);
  ok(after.status !== 200, 'fenêtre fermée : le lien ne sert plus rien', after.status || after.error);

  // Word : nouvelle session, nouveau jeton
  await page.click('[data-tb="export"]');
  await page.click('[data-phone="docx"]');
  await page.waitForSelector('[data-testid="send-to-phone"][data-port]', { timeout: 30000 });
  const p2 = await page.getAttribute('[data-testid="send-to-phone"]', 'data-path');
  const port2 = await page.getAttribute('[data-testid="send-to-phone"]', 'data-port');
  ok(p2 !== p, 'Word : nouveau jeton');
  const w = await get(`http://127.0.0.1:${port2}${p2}/f/0`, { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile' });
  ok(w.status === 200 && w.buf.subarray(0, 2).toString() === 'PK' && /wordprocessingml/.test(w.headers['content-type'] || ''), 'Word : un vrai .docx', w.headers['content-type']);
  await page.click('[data-testid="send-to-phone"] .wr-head button');
} finally { await app.close(); await server.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
