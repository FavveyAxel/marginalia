// Vidéos dans Electron (dist/ requis : npx vite build), avec un FAUX serveur local des plateformes
// (MARGINALIA_E2E_VIDEO_BASE ; jamais le vrai réseau) :
//  1. Bibliothèque › « Vidéo » : lien collé → titre, chaîne et miniature passés par le processus
//     principal → ajout ; transcription (sous-titres) récupérée et rangée sur le disque, avec la vidéo ;
//  2. la page de l'app reste coupée d'Internet : une requête de la fenêtre elle-même vers un lecteur est bloquée ;
//  3. réglage « Vidéos en ligne » désactivé : plus aucune requête vers le serveur.
// Lancer : (pgrep Xvfb || Xvfb :99 -screen 0 1600x1000x24 &) ; DISPLAY=:99 LANG=C.UTF-8 timeout 300 node scripts/test-electron-videos.mjs
import { _electron as electron } from 'playwright-core';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let nOk = 0;
const ok = (c, m, extra = '') => {
  if (c) nOk++;
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
  console.error('dist/ manquant : lancez d’abord « npx vite build ».');
  process.exit(1);
}

// Miniature : un petit JPEG valide (1×1).
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const requests = [];
const server = http.createServer((rq, res) => {
  const u = new URL(rq.url, 'http://x');
  requests.push(`${rq.method} ${u.pathname}`);
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (o) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)));
  if (u.pathname === '/yt/oembed') return json({ title: 'Une histoire de la liberté', author_name: 'Chaîne de test', thumbnail_url: `${base}/img/t.jpg` });
  if (u.pathname === '/img/t.jpg') return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(JPEG);
  if (u.pathname === '/yt/youtubei/v1/player') {
    rq.resume();
    return rq.on('end', () => json({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: `${base}/yt/api/timedtext?v=AbCdEfGhIjK&lang=fr`, languageCode: 'fr' }] } }, videoDetails: { lengthSeconds: '900' } }));
  }
  if (u.pathname === '/yt/api/timedtext')
    return json({ events: ['On croit souvent que la liberté se mesure au nombre de choix.', 'Mais un choix immense peut aussi paralyser.', 'Les philosophes ont posé la question autrement.'].map((t, i) => ({ tStartMs: i * 4000, dDurationMs: 3800, segs: [{ utf8: t }] })) });
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-videos-'));
const DATA = path.join(HOME, 'donnees');
const env = {
  ...process.env,
  HOME,
  XDG_CONFIG_HOME: path.join(HOME, '.config'),
  VITE_DEV_SERVER_URL: '',
  LANG: 'C.UTF-8',
  MARGINALIA_E2E: '1',
  MARGINALIA_E2E_USER_DATA: DATA,
  MARGINALIA_E2E_VIDEO_BASE: BASE,
};
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env, timeout: 60000 });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const st = (fn, a) => page.evaluate(fn, a);

try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await st(() => {
    window.__store.getState().updateSettings({ tourDone: true, mascot: 'off', lastSeenVersion: '99.0.0', updateCheck: false });
    window.__store.getState().navigate({ name: 'library' });
  });

  // ── 1. Ajout par l'interface ──
  await page.getByTestId('video-add').click();
  await page.fill('[data-testid="video-link"]', 'https://www.youtube.com/watch?v=AbCdEfGhIjK');
  await page.waitForFunction(() => document.querySelector('[data-testid="video-title"]')?.value === 'Une histoire de la liberté', null, { timeout: 15000 });
  ok(true, 'titre et chaîne récupérés par le processus principal');
  ok((await page.locator('.va-thumb img').count()) === 1, 'miniature affichée');
  await page.getByTestId('video-add-confirm').click();
  await page.waitForFunction(() => window.__store.getState().books.some((b) => b.format === 'video' && b.video?.transcript), null, { timeout: 20000 });
  const vb = await st(() => window.__store.getState().books.find((b) => b.format === 'video'));
  ok(vb.author === 'Chaîne de test' && vb.cover?.startsWith('data:image/') && vb.video.duration === 900, 'vidéo ajoutée : chaîne, miniature, durée', { author: vb.author, d: vb.video.duration });
  await page.waitForTimeout(1500); // écriture sur le disque
  const onDisk = (() => {
    const hits = [];
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name === 'transcript.json') hits.push(p);
      }
    };
    walk(DATA);
    return hits;
  })();
  ok(onDisk.length === 1 && onDisk[0].includes(vb.id), 'transcription rangée sur le disque, dans le dossier de la vidéo', onDisk);
  ok(requests.includes('POST /yt/youtubei/v1/player') && requests.includes('GET /yt/api/timedtext'), 'sous-titres demandés au faux serveur', requests);

  // ── 2. La page de l'app reste coupée d'Internet ──
  const blocked = await st(async () => {
    try {
      await fetch('https://www.youtube-nocookie.com/embed/AbCdEfGhIjK', { mode: 'no-cors' });
      return false;
    } catch {
      return true;
    }
  });
  ok(blocked, 'une requête de la fenêtre de l’app vers un lecteur est bloquée (seul le cadre du lecteur passe)');

  // ── 3. Réglage désactivé ──
  await st(() => window.__store.getState().updateSettings({ videoOnline: false }));
  await page.waitForTimeout(400);
  requests.length = 0;
  const off = await st(() => window.marginalia.video.meta('youtube', 'AbCdEfGhIjK'));
  const offTr = await st(() => window.marginalia.video.transcript('youtube', 'AbCdEfGhIjK', 'fr'));
  ok(off.off === true && offTr.off === true && requests.length === 0, 'désactivé : aucune requête vers les plateformes', { off, requests });
  await st((id) => window.__store.getState().openBook(id), vb.id);
  await page.waitForSelector('[data-testid="video-player-off"]');
  ok((await page.locator('[data-testid="video-frame"]').count()) === 0, 'désactivé : la page de la vidéo ne charge pas le lecteur');
  ok(errors.length === 0, 'aucune erreur dans la page', errors.slice(0, 3));
} finally {
  await app.close().catch(() => {});
  server.close();
}
console.log(`\n${nOk} vérifications passées`);
