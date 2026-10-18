// Mises à jour (Release GitHub simulée par un serveur local) et « Quoi de neuf » :
//  1. nouvel utilisateur en 3.22, Release 3.23 publiée : pas de « Quoi de neuf », annonce de la 3.23
//     (récap, lien vers la page de téléchargement du site) ; « Plus tard » l'écarte pour de bon ;
//  2. relance en 3.23 (mise à jour faite) : « Quoi de neuf » une fois, puis plus jamais ; pas d'annonce ;
//  3. réglage désactivé : aucune requête ; la requête ne transporte aucune donnée.
// MARGINALIA_UPDATE_URL et MARGINALIA_APP_VERSION ne sont lus qu'avec MARGINALIA_E2E=1.
// Prérequis : dist/ construit (npx vite build). Lancer : DISPLAY=:99 timeout 240 node scripts/test-electron-updates.mjs
import { _electron as electron } from 'playwright-core';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-maj-'));
const SHOTS = path.join(ROOT, 'shots/maj');
fs.mkdirSync(SHOTS, { recursive: true });
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};

const NOTES = `## Nouveautés

- **Recevoir depuis le téléphone, par le Wi-Fi** : scannez un QR code, et photos, livres et passages arrivent dans la Boîte de réception.
- Toutes vos notes d’un livre de l’app Livres en un geste.
- Vérification des nouvelles versions au lancement (désactivable).

[Voir sur le site](https://marginalia-bice.vercel.app)`;
const hits = [];
const server = http.createServer((req, res) => {
  const body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    hits.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(body).length });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tag_name: 'v3.23', name: 'Marginalia 3.23', draft: false, prerelease: false, body: NOTES, published_at: '2026-10-20T10:00:00Z', html_url: 'https://github.com/x/y/releases/tag/v3.23' }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const UPDATE_URL = `http://127.0.0.1:${server.address().port}/repos/FavveyAxel/marginalia/releases/latest`;

async function launch(version, extra = {}) {
  const env = { ...process.env, HOME, XDG_CONFIG_HOME: path.join(HOME, '.config'), VITE_DEV_SERVER_URL: '', MARGINALIA_E2E: '1', MARGINALIA_UPDATE_URL: UPDATE_URL, MARGINALIA_APP_VERSION: version, ...extra };
  const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  return { app, page };
}
const settings = (page) => page.evaluate(() => window.__store.getState().settings);

try {
  // ── 1. Nouvel utilisateur en 3.22 ──
  let { app, page } = await launch('3.22');
  await page.waitForTimeout(1500);
  ok(!(await page.$('[data-testid="whats-new"]')), 'nouvel utilisateur : pas de « Quoi de neuf »');
  ok((await settings(page)).lastSeenVersion === '3.22', 'version vue enregistrée sans fenêtre');
  await page.waitForSelector('[data-testid="update-banner"]', { timeout: 15000 });
  const banner = await page.locator('[data-testid="update-banner"]').innerText();
  ok(banner.includes('Marginalia 3.23 est disponible') && banner.includes('Recevoir depuis le téléphone, par le Wi-Fi : scannez'), 'annonce : version et premier point du récap', banner.replace(/\n/g, ' | '));
  ok((await page.locator('[data-testid="update-banner"] a.btn-primary').getAttribute('href')) === 'https://marginalia-bice.vercel.app/#telecharger', 'Télécharger : page du site (pas GitHub)');
  await page.screenshot({ path: path.join(SHOTS, '01-annonce.png') });
  ok(hits.length === 1 && hits[0].method === 'GET' && hits[0].body === 0 && !hits[0].headers.cookie && hits[0].headers['user-agent'] === 'Marginalia', 'une seule requête GET, sans corps ni cookie', hits.map((h) => h.method + ' ' + h.url));
  ok(Object.keys(hits[0].headers).sort().join() === 'accept,connection,host,user-agent', 'en-têtes : rien d’autre que le strict nécessaire', Object.keys(hits[0].headers));

  await page.click('[data-testid="update-banner"] button:has-text("Voir les nouveautés")');
  await page.waitForSelector('[data-testid="release-notes"]');
  const notes = await page.locator('[data-testid="release-notes"]').innerText();
  ok(notes.includes('Vous avez la version 3.22') && notes.includes('Recevoir depuis le téléphone, par le Wi-Fi') && notes.includes('20 octobre 2026'), 'récap de la Release (Markdown rendu, date)');
  ok((await page.locator('.up-notes a').getAttribute('target')) === '_blank', 'liens du récap : ouverts dans le navigateur');
  await page.screenshot({ path: path.join(SHOTS, '02-recap.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="release-notes"]', { state: 'detached' });
  await page.click('[data-testid="update-banner"] .up-banner-close');
  ok((await settings(page)).updateDismissed === '3.23', '« Plus tard » : version écartée');
  await page.waitForTimeout(800);
  await app.close();

  ({ app, page } = await launch('3.22'));
  await page.waitForTimeout(6000);
  ok(!(await page.$('[data-testid="update-banner"]')), 'relance : la version écartée n’est plus annoncée');
  // Recherche manuelle (réglages) : la version reste proposée.
  await page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await page.waitForSelector('#set-updates');
  await page.locator('#set-updates').scrollIntoViewIfNeeded();
  await page.click('button:has-text("Rechercher maintenant")');
  await page.waitForSelector('button:has-text("Voir la version 3.23")');
  ok(true, 'réglages : « Rechercher maintenant » trouve la 3.23');
  await page.screenshot({ path: path.join(SHOTS, '03-reglages.png') });
  await app.close();

  // ── 2. Mise à jour faite : 3.23 ──
  // Un utilisateur qui a des données (livre) : « Quoi de neuf » attendu.
  ({ app, page } = await launch('3.23'));
  await page.waitForSelector('[data-testid="whats-new"]', { timeout: 15000 });
  const wn = await page.locator('[data-testid="whats-new"]').innerText();
  ok(wn.includes('Marginalia 3.23') && wn.includes('Recevoir depuis le téléphone, par le Wi-Fi') && wn.includes('Toutes vos notes'), '« Quoi de neuf » au premier lancement de la 3.23');
  await page.screenshot({ path: path.join(SHOTS, '04-quoi-de-neuf.png') });
  await page.click('[data-testid="whats-new"] button:has-text("Essayer")');
  await page.waitForSelector('[data-testid="wifi-receive"]');
  ok((await page.evaluate(() => window.__store.getState().route.name)) === 'inbox', '« Essayer » : ouvre la réception par le Wi-Fi');
  await page.keyboard.press('Escape');
  ok((await settings(page)).lastSeenVersion === '3.23', 'nouveautés marquées vues');
  await page.waitForTimeout(6000);
  ok(!(await page.$('[data-testid="update-banner"]')), 'à jour : pas d’annonce');
  await app.close();
  ({ app, page } = await launch('3.23'));
  await page.waitForTimeout(2500);
  ok(!(await page.$('[data-testid="whats-new"]')), 'relance : « Quoi de neuf » ne revient pas');

  // ── 3. Réglage désactivé : aucune requête ──
  await page.evaluate(() => window.__store.getState().updateSettings({ updateCheck: false }));
  await page.waitForTimeout(800);
  await app.close();
  const before = hits.length;
  ({ app, page } = await launch('3.22'));
  await page.waitForTimeout(7000);
  ok(hits.length === before && !(await page.$('[data-testid="update-banner"]')), 'vérification désactivée : aucune requête, aucune annonce', hits.length - before);
  await app.close();
} finally {
  server.close();
  fs.rmSync(HOME, { recursive: true, force: true });
}
