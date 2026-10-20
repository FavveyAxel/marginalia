// Capture du site (section « À plusieurs, sur le même travail ») : la fenêtre « Travailler à plusieurs »
// de l'hôte, session ouverte : code, « Copier », nombre de personnes, cases des permissions, chiffrement.
// Données de démonstration uniquement (espace « Exposé : la liberté », hôte « Léa »).
// Sortie : site/public/captures/ensemble-code.png (brouillon dans shots/site/).
// Prérequis : npx vite build ; Xvfb (:99). Lancer : DISPLAY=:99 LANG=C.UTF-8 timeout 300 node scripts/capture-site-ensemble.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WORK = path.join(ROOT, 'shots/site');
const OUT = path.join(ROOT, 'site/public/captures/ensemble-code.png');
fs.mkdirSync(WORK, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-capture-'));
const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--force-device-scale-factor=2', ROOT],
  // Internet permis : le pied de la fenêtre dit « sur votre réseau ou par Internet », comme chez l'utilisateur.
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_INTERNET: '1', MARGINALIA_E2E_USER_DATA: path.join(home, 'donnees'), MARGINALIA_E2E_LAN: '127.0.0.1', VITE_DEV_SERVER_URL: '' },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
  await page.waitForFunction(() => window.__store && window.__store.getState().ready && window.__collab, null, { timeout: 60000 });
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off', theme: 'light', collabInternet: true }));
  await page.evaluate(() => {
    const s = window.__store.getState();
    const ws = s.createWorkspace('Exposé : la liberté').id;
    s.navigate({ name: 'workspace', workspaceId: ws, groupId: null });
  });
  await page.click('[data-testid="ws-share"]');
  await page.click('[data-testid="ws-share-collab"]');
  await page.waitForSelector('[data-testid="collab-start"]');
  await page.fill('[data-testid="collab-name"]', 'Léa');
  // Choix montrés : 4 personnes ; extraits et écrits permis, cartes et rangement non.
  await page.locator('[data-testid="collab-places"] [role="radio"]', { hasText: '4' }).first().click().catch(() => {});
  for (const [k, on] of [['notes', true], ['drafts', true], ['maps', false], ['organize', false]]) {
    const box = page.locator(`[data-testid="collab-perms"] [data-perm="${k}"]`);
    if (on) await box.check();
    else await box.uncheck();
  }
  await page.click('[data-testid="collab-open"]');
  await page.waitForSelector('[data-testid="collab-code"]', { timeout: 60000 });
  await page.waitForFunction(() => window.__collab.state.getState().internet === true, null, { timeout: 30000 }).catch(() => console.log('(internet non actif : pied de fenêtre « réseau local »)'));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(800);
  const raw = path.join(WORK, 'ensemble-code.png');
  await page.locator('[data-testid="collab-dialog"]').screenshot({ path: raw });
  execFileSync('python3', ['-c', `from PIL import Image; im=Image.open('${raw}'); w=1280; im=im.resize((w, round(im.height*w/im.width)), Image.LANCZOS) if im.width>w else im; im.save('${OUT}', optimize=True); print(im.size)`], { stdio: 'inherit' });
  const text = (await page.textContent('[data-testid="collab-dialog"]')).replace(/\s+/g, ' ');
  console.log('texte :', text.slice(0, 400));
} finally {
  await app.close();
  fs.rmSync(home, { recursive: true, force: true });
}
