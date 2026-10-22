// Ranger un document dans un espace en le glissant depuis son onglet (Écrire, Bibliothèque, Cartes, Plans)
// sur un groupe ou un espace de la barre latérale. Sélection multiple : toute la sélection part. Pas de
// doublon si le document est déjà dans l'espace (il est déplacé). Port 5297.
// Lancer : timeout 200 node scripts/test-ws-dragin.mjs [dossier-captures]
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { importFixture } from './harness.mjs';

const PORT = 5297;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = process.argv[2];
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};

const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-dragin', server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const tick = (ms = 300) => page.waitForTimeout(ms);
const items = () => page.evaluate(() => window.__store.getState().wsItems.map((i) => ({ kind: i.kind, refId: i.refId, groupId: i.groupId, workspaceId: i.workspaceId })));
const row = (name) => page.locator('.ws-row', { hasText: name }).first();

/** Glisser à la souris (HTML5 DnD de Chromium), avec une capture pendant le survol de la cible. */
async function drag(src, dst, shot) {
  const a = await src.boundingBox();
  const b = await dst.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  const steps = 18;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / steps, a.y + a.height / 2 + ((b.y + b.height / 2 - a.y - a.height / 2) * i) / steps);
    await page.waitForTimeout(20);
  }
  await tick(150);
  if (SHOTS && shot) await page.screenshot({ path: path.join(SHOTS, shot) });
  await page.mouse.up();
  await tick(400);
}

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off', activeWorkspaceId: null }));
  const bookA = await importFixture(page, 'fixtures/discours.epub');
  const bookB = await importFixture(page, 'fixtures/discours.md');
  const ids = await page.evaluate(async ({ bookA, bookB }) => {
    const s = () => window.__store.getState();
    s().updateBook(bookA, { title: 'Discours de la méthode', author: 'Descartes' });
    s().updateBook(bookB, { title: 'Éthique', author: 'Spinoza' });
    const m = await import('/src/features/editor/api.ts');
    const d = await m.createDraft({ title: 'Le parjure chez Kant', template: 'vide', html: '<p>Promettre, c’est s’engager.</p>' });
    const now = Date.now();
    s().setMap('board-x', { id: 'board-x', kind: 'board', bookId: '', title: 'Promesse et serment', bookIds: [], viewport: null, zones: [], nodes: [{ id: 'n1', highlightId: null, text: 'Serment', x: 0, y: 0 }], edges: [], createdAt: now, updatedAt: now });
    window.__store.setState((st) => ({ plans: [...st.plans, { id: 'p1', title: 'Le parjure', sujet: 'Le parjure est-il toujours une faute ?', definitions: '', problematique: '', parts: [], conclusion: '', draftId: null, createdAt: now, updatedAt: now }] }));
    const ws = s().createWorkspace('Mémoire').id;
    const g = s().createGroup(ws, null, 'Parjure').id;
    s().createGroup(ws, null, 'Sources');
    return { ws, g, draft: d.id };
  }, { bookA, bookB });
  await tick(500);
  ok('le groupe « Parjure » est visible dans la barre latérale', await row('Parjure').isVisible());

  // ── Écrire ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'write', draftId: null }));
  await page.locator('.ed-card').first().waitFor();
  await drag(page.locator('.ed-card').first(), row('Parjure'), 'glisser-ecrit.png');
  let it = await items();
  ok('Écrire : l’écrit est rangé dans « Parjure »', it.some((x) => x.kind === 'draft' && x.refId === ids.draft && x.groupId === ids.g), JSON.stringify(it));
  ok('message de confirmation', (await page.locator('text=Rangé dans « Parjure »').count()) > 0);

  // ── Bibliothèque : deux livres sélectionnés partent ensemble ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await page.locator('.lib-card').nth(1).waitFor();
  await page.locator('.lib-card').nth(0).click({ modifiers: ['Meta'] });
  await page.locator('.lib-card').nth(1).click({ modifiers: ['Meta'] });
  await tick();
  await drag(page.locator('.lib-card').nth(0), row('Parjure'), 'glisser-livres.png');
  it = await items();
  ok('Bibliothèque : les deux livres sélectionnés sont rangés', [bookA, bookB].every((b) => it.some((x) => x.kind === 'book' && x.refId === b && x.groupId === ids.g)), JSON.stringify(it));

  // ── Cartes ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'maps' }));
  await page.locator('.mv-card[data-kind="board"]').first().waitFor();
  await drag(page.locator('.mv-card[data-kind="board"]').first(), row('Parjure'), 'glisser-carte.png');
  it = await items();
  ok('Cartes : la carte libre est rangée', it.some((x) => x.kind === 'map' && x.refId === 'board-x' && x.groupId === ids.g));

  // ── Plans ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'plans' }));
  await page.locator('.plan-card').first().waitFor();
  await drag(page.locator('.plan-card').first(), row('Parjure'));
  it = await items();
  ok('Plans : le plan est rangé', it.some((x) => x.kind === 'plan' && x.refId === 'p1' && x.groupId === ids.g));

  // ── Déjà dans l'espace : déplacé, pas dupliqué ──
  await page.evaluate(() => window.__store.getState().navigate({ name: 'write', draftId: null }));
  await page.locator('.ed-card').first().waitFor();
  await drag(page.locator('.ed-card').first(), row('Sources'));
  it = await items();
  const drafts = it.filter((x) => x.kind === 'draft' && x.workspaceId === ids.ws);
  ok('écrit glissé sur un autre groupe : déplacé, sans doublon', drafts.length === 1 && drafts[0].groupId !== ids.g, JSON.stringify(drafts));

  // ── Sur l'espace lui-même : à sa racine ──
  await drag(page.locator('.ed-card').first(), page.locator('.ws-row-ws', { hasText: 'Mémoire' }).first());
  it = await items();
  ok('écrit glissé sur l’espace : rangé à la racine', it.filter((x) => x.kind === 'draft').every((x) => x.groupId === null));

  // ── La vue de l'espace montre les documents rangés ──
  await page.evaluate(({ ws, g }) => window.__store.getState().navigate({ name: 'workspace', workspaceId: ws, groupId: g }), ids);
  await tick(800);
  ok('vue du groupe : livres, carte et plan présents', (await page.locator('.ws-card').count()) === 4, String(await page.locator('.ws-card').count()));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'parjure.png') });
  ok('aucune erreur dans la page', !errors.length, errors.join('\n'));
  console.log(`\n${passed} vérifications passées.`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(0);
