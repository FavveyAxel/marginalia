// « Travailler à plusieurs » par Internet, de bout en bout : deux processus Electron SANS réseau local
// commun (l'invité ne cherche pas sur le Wi-Fi : MARGINALIA_E2E_COLLAB_NO_LAN=1). L'invité retrouve l'hôte
// par le seul code, à travers iroh (127.0.0.1 ; annuaire dans un fichier à la place de celui de n0, le
// conteneur de test n'ayant pas accès à Internet).
//  1. Léa ouvre la session : « Même sans être sur le même Wi-Fi : le code suffit » sous le code.
//  2. Marc saisit un code faux : « Aucune session… ni par Internet », bouton « Rejoindre (10 s) » bloqué.
//  3. Après l'attente, le bon code : Léa voit la demande (« Internet »), accepte ; l'espace arrive chez Marc.
//  4. Le texte tapé chez Léa arrive chez Marc (canal en direct par Internet).
//  5. Réglage « Travailler à plusieurs par Internet » dans les réglages.
// Captures claires et sombres dans shots/collab-internet/. Prérequis : npx vite build ; Xvfb (:99).
// Lancer : DISPLAY=:99 LANG=C.UTF-8 timeout 600 node scripts/test-collab-internet-e2e.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = path.join(ROOT, 'shots/collab-internet');
fs.mkdirSync(SHOTS, { recursive: true });
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
  return c;
};
const REGISTRY = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mg-iroh-')), 'annuaire.json');
const apps = [];
async function launch(name, extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `mg-net-${name}-`));
  const app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: path.join(home, 'donnees'), MARGINALIA_E2E_INTERNET: '1', MARGINALIA_E2E_IROH_REGISTRY: REGISTRY, VITE_DEV_SERVER_URL: '', ...extra },
    timeout: 60000,
  });
  apps.push(app);
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 840 }).catch(() => {});
  await page.waitForFunction(() => window.__store && window.__store.getState().ready && window.__collab, null, { timeout: 60000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
  return { app, page, name, errors };
}
const theme = (p, t) => p.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), t).then(() => p.waitForTimeout(300));
async function shotBoth(p, sel, name) {
  for (const [t, label] of [['light', 'clair'], ['dark', 'sombre']]) {
    await theme(p, t);
    await p.locator(sel).first().screenshot({ path: path.join(SHOTS, `${name}-${label}.png`) });
  }
  await theme(p, 'light');
}
const until = async (p, fn, arg, ms = 20000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

const A = await launch('lea');
const B = await launch('marc', { MARGINALIA_E2E_COLLAB_NO_LAN: '1' });
try {
  // ── Léa : un espace avec un écrit ──
  const seeded = await A.page.evaluate(async () => {
    const s = () => window.__store.getState();
    const ws = s().createWorkspace('Parjure').id;
    s().navigate({ name: 'workspace', workspaceId: ws, groupId: null });
    await s().importFiles([{ name: 'Dissertation.md', data: new TextEncoder().encode('# Le parjure\n\nPeut-on promettre sans mentir ?\n').buffer }]);
    const d = s().drafts[0];
    s().addToWorkspace(ws, null, 'draft', d.id);
    return { ws, draft: d.id };
  });
  ok(!!seeded.draft, 'Léa : espace « Parjure » avec un écrit');

  // ── 1. Session ouverte, joignable par Internet ──
  await A.page.click('[data-testid="ws-share"]');
  await A.page.click('[data-testid="ws-share-collab"]');
  await A.page.waitForSelector('[data-testid="collab-start"]');
  await A.page.fill('[data-testid="collab-name"]', 'Léa');
  await A.page.click('[data-testid="collab-open"]');
  await A.page.waitForSelector('[data-testid="collab-code"]', { timeout: 30000 });
  const code = await A.page.getAttribute('[data-testid="collab-code"]', 'data-code');
  ok(/^\d{6}$/.test(code), 'Léa : code à 6 chiffres', code);
  const anywhere = await A.page.waitForSelector('[data-testid="collab-internet"]', { timeout: 10000 }).then(() => A.page.textContent('[data-testid="collab-internet"]'), () => '');
  ok(/le code suffit/.test(anywhere), 'Léa : « Même sans être sur le même Wi-Fi : le code suffit »', anywhere);
  const foot = await A.page.textContent('[data-testid="collab-dialog"] .wr-foot');
  ok(/par Internet/.test(foot), 'pied de fenêtre : « Chiffré de bout en bout, sur votre réseau ou par Internet »', foot.trim());
  await shotBoth(A.page, '[data-testid="collab-dialog"]', '01-hote-code');

  // ── 2. Marc : code faux → introuvable, attente de 10 s ──
  await B.page.evaluate(() => window.__store.getState().navigate({ name: 'import' }));
  await B.page.click('[data-testid="import-collab-open"]');
  await B.page.waitForSelector('[data-testid="join-form"]');
  await B.page.fill('[data-testid="collab-name"]', 'Marc');
  const wrong = String((Number(code) + 1) % 1e6).padStart(6, '0');
  await B.page.fill('[data-testid="join-code"]', wrong);
  await B.page.click('[data-testid="join-go"]');
  const searching = await B.page.waitForSelector('text=Recherche sur le réseau et par Internet…', { timeout: 5000 }).then(() => true, () => false);
  ok(searching, 'Marc : « Recherche sur le réseau et par Internet… »');
  await B.page.waitForSelector('[data-testid="join-error"]', { timeout: 30000 });
  const e1 = await B.page.textContent('[data-testid="join-error"]');
  ok(/ni sur ce réseau ni par Internet/.test(e1), 'code faux : « Aucune session trouvée avec ce code, ni sur ce réseau ni par Internet »', e1);
  await B.page.waitForFunction(() => /Rejoindre \(\d+ s\)/.test(document.querySelector('[data-testid="join-go"]')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
  const btn = await B.page.textContent('[data-testid="join-go"]');
  const disabled = await B.page.isDisabled('[data-testid="join-go"]');
  ok(/Rejoindre \(\d+ s\)/.test(btn) && disabled, 'bouton bloqué avec le compte à rebours « Rejoindre (N s) »', btn);
  await shotBoth(B.page, '[data-testid="join-dialog"]', '02-invite-attente-10s');
  const freed = await until(B.page, () => !document.querySelector('[data-testid="join-go"]')?.disabled, null, 15000);
  ok(freed && (await B.page.textContent('[data-testid="join-go"]')).trim() === 'Rejoindre', 'après 10 s : « Rejoindre » de nouveau possible');

  // ── 3. Bon code : demande vue par Léa (Internet), acceptée ──
  await B.page.fill('[data-testid="join-code"]', code);
  await B.page.click('[data-testid="join-go"]');
  await B.page.waitForSelector('[data-testid="join-asking"]', { timeout: 30000 });
  ok(true, 'Marc : session trouvée par Internet, en attente de l’accord');
  await A.page.waitForSelector('[data-testid="collab-request"]', { timeout: 20000 });
  const req = (await A.page.textContent('[data-testid="collab-request"]')).replace(/\s+/g, ' ');
  ok(/Marc/.test(req), 'Léa : la demande de Marc s’affiche', req.slice(0, 160));
  await shotBoth(A.page, '[data-testid="collab-dialog"]', '03-hote-demande');
  await A.page.click('[data-testid="collab-accept"]');
  const live = await until(B.page, () => window.__collab.state.getState().phase === 'live' && window.__collab.state.getState().workspaceId, null, 60000);
  ok(live, 'Marc : accepté, l’espace arrive par Internet');
  const got = await B.page.evaluate(() => {
    const s = window.__store.getState();
    const c = window.__collab.state.getState();
    return { ws: s.workspaces.find((w) => w.id === c.workspaceId)?.name, drafts: s.wsItems.filter((i) => i.workspaceId === c.workspaceId && i.kind === 'draft').length, people: c.members.length };
  });
  ok(got.ws === 'Parjure' && got.drafts === 1 && got.people === 2, 'chez Marc : « Parjure », l’écrit, 2 personnes', got);

  // ── 4. Réglage ──
  await B.page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await B.page.waitForSelector('#set-updates');
  const row = B.page.locator('.set-row', { hasText: 'Travailler à plusieurs par Internet' });
  ok((await row.count()) === 1 && (await row.locator('[role="switch"]').getAttribute('aria-checked')) === 'true', 'réglages : « Travailler à plusieurs par Internet », activé');
  await row.scrollIntoViewIfNeeded();
  for (const [t, label] of [['light', 'clair'], ['dark', 'sombre']]) {
    await theme(B.page, t);
    await row.screenshot({ path: path.join(SHOTS, `04-reglage-${label}.png`) });
  }
  await theme(B.page, 'light');

  for (const X of [A, B]) ok(X.errors.length === 0, `${X.name} : aucune erreur dans la page`, X.errors.slice(0, 3));
} finally {
  for (const a of apps) await a.close().catch(() => {});
}
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
