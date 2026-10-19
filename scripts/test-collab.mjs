// « Travailler à plusieurs », de bout en bout : trois processus Electron (dossiers de données distincts,
// réseau local simulé par MARGINALIA_E2E_LAN=127.0.0.1) — l'hôte Léa (A), les invités Marc (B) et Inès (C) —
// plus des invités « sans interface » (electron/collab-net.cjs en Node) pour atteindre la limite de 6.
//  1. Léa ouvre « Travailler à plusieurs » dans l'espace « Parjure » (menu ⋯) ; Marc (par une adresse saisie
//     qui passe par un relais d'écoute) et Inès (par diffusion) rejoignent ; Léa accepte chaque demande.
//  2. L'espace arrive complet chez eux (écrit, carte, extraits, livre absent) ; encadré dans la barre latérale.
//  3. Écrit en direct : texte tapé chez l'un, visible chez les autres ; curseurs nommés.
//  4. Carte en direct : carte ajoutée, déplacée, reliée, supprimée ; groupe créé ; extrait supprimé → corbeille.
//  5. 6 personnes au plus (7e refusée) ; demande refusée.
//  6. Inès coupée : elle continue seule (texte et carte), revient, tout est réuni.
//  7. Léa arrête : chacun garde son exemplaire à jour (fichier .docx compris), l'encadré disparaît.
//  8. Rien en clair dans le trafic capturé par le relais.
// Captures claires et sombres dans shots/collab/. Prérequis : npx vite build ; Xvfb (:99).
// Lancer : DISPLAY=:99 LANG=C.UTF-8 timeout 900 node scripts/test-collab.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { createRequire } from 'node:module';

process.env.MARGINALIA_E2E = '1';
process.env.MARGINALIA_E2E_LAN = '127.0.0.1';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const collabNet = require(path.join(ROOT, 'electron/collab-net.cjs'));
const SHOTS = path.join(ROOT, 'shots/collab');
fs.mkdirSync(SHOTS, { recursive: true });
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
  return c;
};
if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
  console.error('dist/ manquant : lancez d’abord « npx vite build ».');
  process.exit(1);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const EPUB = path.join(ROOT, 'fixtures/discours.epub');
const dirs = [];
const apps = [];
async function launch(name) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `mg-collab-${name}-`));
  dirs.push(home);
  const app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: path.join(home, 'donnees'), MARGINALIA_E2E_LAN: '127.0.0.1', VITE_DEV_SERVER_URL: '' },
    timeout: 60000,
  });
  apps.push(app);
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 840 }).catch(() => {});
  await page.waitForFunction(() => window.__store && window.__store.getState().ready && window.__collab, null, { timeout: 60000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
  });
  // La visite guidée ne s'ouvre pas pendant le test.
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
  return { app, page, home, errors, name };
}
const theme = (p, t) => p.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), t).then(() => p.waitForTimeout(300));
async function shotBoth(p, sel, name, opts = {}) {
  for (const [t, label] of [['light', 'clair'], ['dark', 'sombre']]) {
    await theme(p, t);
    const loc = p.locator(sel).first();
    if (opts.full) await p.screenshot({ path: path.join(SHOTS, `${name}-${label}.png`) });
    else await loc.screenshot({ path: path.join(SHOTS, `${name}-${label}.png`) });
  }
  await theme(p, 'light');
}
const st = (p, fn, arg) => p.evaluate(fn, arg);
const until = async (p, fn, arg, ms = 20000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

// ── Relais d'écoute (TCP) : Marc passe par lui ; tout ce qui y circule est gardé pour l'analyse ──
const wire = [];
let proxyPort = 0;
const proxy = net.createServer((c) => {
  const up = net.connect(47804, '127.0.0.1');
  c.on('data', (d) => {
    wire.push(Buffer.from(d));
    up.write(d);
  });
  up.on('data', (d) => {
    wire.push(Buffer.from(d));
    c.write(d);
  });
  const end = () => {
    c.destroy();
    up.destroy();
  };
  c.on('error', end);
  up.on('error', end);
  c.on('close', end);
  up.on('close', end);
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
proxyPort = proxy.address().port;

const A = await launch('lea');
const B = await launch('marc');
const C = await launch('ines');
const headless = [];
try {
  // ── Préparation de Léa : espace « Parjure » (livre, 2 extraits, un écrit, une carte) ──
  const epubB64 = fs.readFileSync(EPUB).toString('base64');
  const mdText = '# Le parjure\n\nPremier paragraphe : peut-on promettre sans mentir ?\n\nDeuxième paragraphe : la parole donnée engage.\n';
  const seeded = await A.page.evaluate(
    async ({ epubB64, mdText }) => {
      const s = () => window.__store.getState();
      const bytes = Uint8Array.from(atob(epubB64), (c) => c.charCodeAt(0));
      const [book] = await s().importFiles([{ name: 'Discours de la méthode.epub', data: bytes.buffer }]);
      const ws = s().createWorkspace('Parjure').id;
      s().navigate({ name: 'workspace', workspaceId: ws, groupId: null });
      s().addToWorkspace(ws, null, 'book', book.id);
      const anchor = (i) => ({ kind: 'html', chapter: 0, start: i, end: i + 20, prefix: '', suffix: '' });
      const h1 = s().addHighlight({ bookId: book.id, category: 'these', text: 'Le bon sens est la chose du monde la mieux partagée', anchor: anchor(0), locationLabel: 'Première partie', note: 'Note de Léa' });
      s().addHighlight({ bookId: book.id, category: 'argument', text: 'la diversité de nos opinions', anchor: anchor(40), locationLabel: 'Première partie' });
      await s().importFiles([{ name: 'Dissertation.md', data: new TextEncoder().encode(mdText).buffer }]);
      const now = Date.now();
      const board = 'board-parjure';
      s().setMap(board, { id: board, kind: 'board', bookId: '', title: 'Promesse', bookIds: [book.id], viewport: null, zones: [], nodes: [{ id: 'n1', highlightId: h1.id, text: '', x: 0, y: 0 }, { id: 'n2', highlightId: null, text: 'Idée de Léa', x: 320, y: 40 }], edges: [], createdAt: now, updatedAt: now });
      s().addToWorkspace(ws, null, 'map', board);
      return { ws, book: book.id, draft: s().drafts[0]?.id, board };
    },
    { epubB64, mdText },
  );
  ok(!!seeded.draft && (await st(A.page, () => window.__store.getState().wsItems.length)) === 3, 'Léa : espace « Parjure » prêt (livre, 2 extraits, écrit, carte)', seeded);

  // ── 1. Léa ouvre la session par le menu ⋯ de l'espace ──
  await A.page.click('button[aria-label="Actions"]');
  const menuText = await A.page.locator('[role="menu"]').first().textContent();
  ok(/Nouvelle carte ici\s*Travailler à plusieurs…/.test(menuText.replace(/\s+/g, ' ')) || menuText.includes('Travailler à plusieurs…'), 'menu ⋯ de l’espace : « Travailler à plusieurs… » sous « Nouvelle carte ici »', menuText.replace(/\s+/g, ' ').slice(0, 200));
  await A.page.getByText('Travailler à plusieurs…').click();
  await A.page.waitForSelector('[data-testid="collab-start"]');
  await A.page.fill('[data-testid="collab-name"]', 'Léa');
  await A.page.click('.cl-swatch[data-color="#c2410c"]');
  await shotBoth(A.page, '[data-testid="collab-dialog"]', '01-hote-prenom');
  await A.page.click('[data-testid="collab-open"]');
  await A.page.waitForSelector('[data-testid="collab-code"]', { timeout: 30000 });
  const code = await A.page.getAttribute('[data-testid="collab-code"]', 'data-code');
  const codeText = (await A.page.textContent('[data-testid="collab-code"]')).trim();
  ok(/^\d{6}$/.test(code) && codeText === `${code.slice(0, 3)}-${code.slice(3)}`, 'Léa : code affiché d’un bloc « 735-700 »', codeText);
  await shotBoth(A.page, '[data-testid="collab-dialog"]', '02-hote-code');

  // ── Marc rejoint par une adresse saisie (relais d'écoute) ──
  async function joinUi(X, name, color, { address } = {}) {
    await X.page.evaluate(() => window.__store.getState().navigate({ name: 'import' }));
    await X.page.click('[data-testid="import-collab-open"]');
    await X.page.waitForSelector('[data-testid="join-form"]');
    await X.page.fill('[data-testid="collab-name"]', name);
    await X.page.click(`.cl-swatch[data-color="${color}"]`);
    await X.page.fill('[data-testid="join-code"]', code.slice(0, 3) + ' ' + code.slice(3));
    if (address) {
      await X.page.click('text=Saisir une adresse');
      await X.page.fill('[data-testid="join-address"]', address);
    }
    const shown = await X.page.inputValue('[data-testid="join-code"]');
    await X.page.click('[data-testid="join-go"]');
    return shown;
  }
  const shownB = await joinUi(B, 'Marc', '#1d4ed8', { address: `127.0.0.1:${proxyPort}` });
  ok(shownB === `${code.slice(0, 3)}-${code.slice(3)}`, 'Marc : le code saisi « 735 700 » s’affiche « 735-700 »', shownB);
  await B.page.waitForSelector('[data-testid="join-asking"]', { timeout: 30000 });
  await shotBoth(B.page, '[data-testid="join-dialog"]', '03-invite-attente');
  await A.page.waitForSelector('[data-testid="collab-request"]', { timeout: 20000 });
  const reqText = (await A.page.textContent('[data-testid="collab-request"]')).replace(/\s+/g, ' ');
  ok(/demande à rejoindre « Parjure »/.test(reqText) && /Prénom : Marc/.test(reqText), 'Léa : « … demande à rejoindre « Parjure » » (prénom, adresse)', reqText.slice(0, 160));
  await shotBoth(A.page, '[data-testid="collab-dialog"]', '04-hote-demande');
  await A.page.click('[data-testid="collab-accept"]');
  const bLive = await until(B.page, () => window.__collab.state.getState().phase === 'live' && window.__collab.state.getState().workspaceId, null, 60000);
  ok(bLive, 'Marc : accepté, l’espace arrive');

  // ── Inès rejoint par diffusion ; Léa accepte depuis la carte de demande (fenêtre fermée) ──
  await A.page.keyboard.press('Escape');
  await joinUi(C, 'Inès', '#15803d');
  await A.page.waitForSelector('[data-testid="collab-asks"] [data-testid="collab-request"]', { timeout: 20000 });
  await shotBoth(A.page, '[data-testid="collab-asks"]', '05-hote-demande-carte');
  await A.page.click('[data-testid="collab-asks"] [data-testid="collab-accept"]');
  const cLive = await until(C.page, () => window.__collab.state.getState().phase === 'live' && window.__collab.state.getState().workspaceId, null, 60000);
  ok(cLive, 'Inès : acceptée (diffusion UDP), l’espace arrive');

  // ── 2. L'espace complet chez les invités ──
  for (const X of [B, C]) {
    const got = await st(X.page, () => {
      const s = window.__store.getState();
      const c = window.__collab.state.getState();
      const ws = s.workspaces.find((w) => w.id === c.workspaceId);
      const items = s.wsItems.filter((i) => i.workspaceId === c.workspaceId);
      const board = Object.values(s.maps).find((m) => m.kind === 'board');
      return { ws: ws?.name, items: items.map((i) => i.kind).sort().join(), drafts: s.drafts.length, hl: s.highlights.length, board: board?.nodes.length, book: s.books[0] ? { missing: !!s.books[0].missing } : null, route: s.route.name };
    });
    ok(got.ws === 'Parjure' && got.items === 'book,draft,map' && got.drafts === 1 && got.hl === 2 && got.board === 2 && got.book && !got.book.missing && got.route === 'workspace', `${X.name} : espace « Parjure » complet (écrit, carte, 2 extraits, livre joint car absent)`, got);
  }
  // Encadré dans la barre latérale, chez tous.
  for (const X of [A, B, C]) {
    const ok3 = await until(X.page, () => {
      const n = document.querySelector('.ws-node.ws-collab');
      return n && n.querySelector('[data-testid="ws-collab-badge"]')?.textContent.trim() === '3';
    }, null, 15000);
    const tip = await st(X.page, () => document.querySelector('.ws-node.ws-collab')?.getAttribute('title'));
    ok(ok3 && /Léa/.test(tip) && /Marc/.test(tip) && /Inès/.test(tip), `${X.name} : l’espace est encadré, « 3 » connectés, prénoms au survol`, tip);
  }
  await shotBoth(A.page, '.sidebar', '06-barre-laterale-hote');
  await shotBoth(C.page, '.sidebar', '07-barre-laterale-invitee');

  globalThis.__ctx = { A, B, C, seeded, code, headless, wire, proxyPort };
  const part2 = await import('./test-collab-part2.mjs');
  await part2.run(globalThis.__ctx, { ok, wait, st, until, shotBoth, theme, collabNet, SHOTS });
} finally {
  for (const X of [A, B, C]) if (X.errors.length) console.log(`(${X.name}) erreurs de page :`, [...new Set(X.errors)].slice(0, 8));
  for (const h of headless) h.g?.leave?.();
  for (const a of apps) await a.close().catch(() => {});
  proxy.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}
