// « Travailler à plusieurs » : permissions des invités, choisies par l'hôte pour toute la session
// (deux processus Electron, réseau local simulé 127.0.0.1) — Léa (hôte, A), Marc (invité, B).
//  1. Aucune case cochée : chez Marc, l'écrit en direct est en lecture seule, la carte aussi ; ce qu'il
//     change (extrait, élément de l'espace) n'arrive pas chez Léa.
//  2. « Ajouter des extraits et des notes » : ses extraits arrivent ; ses autres changements, non.
//  3. « Modifier les cartes » sans « Modifier les écrits » : carte modifiable, écrit en lecture seule.
//  4. Tout coché : tout arrive.
//  5. Un invité qui contourne son interface (message envoyé à la main) est filtré par l'hôte.
// Prérequis : npx vite build ; Xvfb (:99). Lancer : DISPLAY=:99 LANG=C.UTF-8 timeout 600 node scripts/test-collab-perms.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = path.join(ROOT, 'shots/collab-perms');
fs.mkdirSync(SHOTS, { recursive: true });
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
  return c;
};
const EPUB = fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')).toString('base64');
const apps = [];
async function launch(name) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `mg-perm-${name}-`));
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
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { app, page, name, errors };
}
const until = (p, fn, arg, ms = 20000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const A = await launch('lea');
const B = await launch('marc');
try {
  // ── Léa : espace « Parjure » (livre, écrit, carte) ──
  const seeded = await A.page.evaluate(async (b64) => {
    const s = () => window.__store.getState();
    const ws = s().createWorkspace('Parjure').id;
    s().navigate({ name: 'workspace', workspaceId: ws, groupId: null });
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const [book] = await s().importFiles([{ name: 'Discours de la méthode.epub', data: bytes.buffer }]);
    s().addToWorkspace(ws, null, 'book', book.id);
    await s().importFiles([{ name: 'Dissertation.md', data: new TextEncoder().encode('# Le parjure\n\nPeut-on promettre sans mentir ?\n').buffer }]);
    s().addToWorkspace(ws, null, 'draft', s().drafts[0].id);
    const now = Date.now();
    s().setMap('board-p', { id: 'board-p', kind: 'board', bookId: '', title: 'Promesse', bookIds: [book.id], viewport: null, zones: [], nodes: [{ id: 'n1', highlightId: null, text: 'Idée de Léa', x: 0, y: 0 }], edges: [], createdAt: now, updatedAt: now });
    s().addToWorkspace(ws, null, 'map', 'board-p');
    return { ws, book: book.id };
  }, EPUB);

  // ── Session « Lire » ouverte par l'interface ──
  await A.page.click('[data-testid="ws-share"]');
  await A.page.click('[data-testid="ws-share-collab"]');
  await A.page.waitForSelector('[data-testid="collab-start"]');
  await A.page.fill('[data-testid="collab-name"]', 'Léa');
  for (const k of ['notes', 'drafts', 'maps', 'organize']) await A.page.locator(`[data-testid="collab-perms"] [data-perm="${k}"]`).uncheck();
  await A.page.locator('[data-testid="collab-dialog"]').screenshot({ path: path.join(SHOTS, '01-ouverture-permission.png') });
  await A.page.click('[data-testid="collab-open"]');
  await A.page.waitForSelector('[data-testid="collab-code"]', { timeout: 30000 });
  const code = await A.page.getAttribute('[data-testid="collab-code"]', 'data-code');
  ok(!(await A.page.isChecked('[data-testid="collab-perms"] [data-perm="drafts"]')), 'Léa : aucune case cochée, la session reste sur ce choix');
  const found = await B.page.evaluate((code) => window.__collab.session().then((m) => m.guestFind(code, undefined, { name: 'Marc', color: '#1d4ed8' })), code);
  const joining = B.page.evaluate((t) => window.__collab.session().then((m) => m.guestJoin(t, { name: 'Marc', color: '#1d4ed8' }, 'Léa')), found.ticket);
  await A.page.waitForSelector('[data-testid="collab-request"]', { timeout: 20000 });
  const ask = (await A.page.textContent('[data-testid="collab-request"]')).replace(/\s+/g, ' ');
  ok(/Pourra tout lire, sans rien modifier/.test(ask), 'demande : « Pourra tout lire, sans rien modifier »', ask.slice(0, 140));
  await A.page.locator('[data-testid="collab-dialog"]').screenshot({ path: path.join(SHOTS, '02-demande.png') });
  await A.page.click('[data-testid="collab-accept"]');
  await joining;
  await until(B.page, () => window.__collab.state.getState().phase === 'live', null, 60000);
  ok(JSON.stringify(await B.page.evaluate(() => window.__collab.state.getState().perm)) === JSON.stringify({ notes: false, drafts: false, maps: false, organize: false }), 'Marc : aucune permission reçue (lecture seule)');

  // Écrit en direct : lecture seule chez Marc.
  const draftB = await B.page.evaluate(() => window.__store.getState().drafts.find((d) => d.title === 'Le parjure')?.id);
  await B.page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), draftB);
  await B.page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('[data-testid="ed-live"]'), null, { timeout: 60000 });
  await wait(1200);
  const live = await B.page.textContent('[data-testid="ed-live"]');
  const editable = await B.page.evaluate(() => window.__ed.engine().debugEditor().editor.isEditable);
  ok(/lecture seule/.test(live) && editable === false && !!(await B.page.$('.ed-live-readonly')), 'Marc : écrit en direct en lecture seule (« En direct · lecture seule »)', { live, editable });
  await B.page.screenshot({ path: path.join(SHOTS, '03-ecrit-lecture-seule.png') });
  // Carte : lecture seule.
  await B.page.evaluate(() => {
    const s = window.__store.getState();
    const id = Object.keys(s.maps).find((k) => s.maps[k].title === 'Promesse');
    s.navigate({ name: 'board', boardId: id });
  });
  const roMap = await until(B.page, () => !!document.querySelector('[data-testid="map-readonly"]'), null, 20000);
  ok(roMap && !(await B.page.$('.map-bar')), 'Marc : carte en lecture seule, sans barre d’outils', roMap);
  await B.page.screenshot({ path: path.join(SHOTS, '04-carte-lecture-seule.png') });

  // Ce que Marc change n'arrive pas chez Léa.
  const tryChange = (tag) =>
    B.page.evaluate((tag) => {
      const s = window.__store.getState();
      const ws = window.__collab.state.getState().workspaceId;
      const book = s.books.find((b) => /Discours/.test(b.title));
      s.addHighlight({ bookId: book.id, category: 'these', text: `Extrait ${tag}`, anchor: { kind: 'html', chapter: 0, start: 0, end: 10, prefix: '', suffix: '' }, locationLabel: 'I' });
      s.createGroup(ws, null, `Groupe ${tag}`);
    }, tag);
  const atLea = (tag) =>
    A.page.evaluate((tag) => {
      const s = window.__store.getState();
      return { hl: s.highlights.some((h) => h.text === `Extrait ${tag}`), group: s.groups.some((g) => g.name === `Groupe ${tag}`) };
    }, tag);
  await tryChange('lire');
  await wait(3000);
  let r = await atLea('lire');
  ok(!r.hl && !r.group, 'lecture seule : l’extrait et le groupe de Marc n’arrivent pas chez Léa', r);
  const atMarc = (tag) =>
    B.page.evaluate((tag) => {
      const s = window.__store.getState();
      return { hl: s.highlights.some((h) => h.text === `Extrait ${tag}`), group: s.groups.some((g) => g.name === `Groupe ${tag}`) };
    }, tag);
  let m = await atMarc('lire');
  ok(!m.hl && !m.group, 'lecture seule : chez Marc non plus rien ne change (refusé avant de s’appliquer, pas de version à lui seul)', m);
  ok((await B.page.textContent('body')).includes('L’hôte ne vous a pas permis'), 'Marc : un message lui dit que l’hôte ne l’a pas permis');
  const routeB = await B.page.evaluate(() => window.__store.getState().route);
  await B.page.evaluate(() => window.__store.getState().navigate({ name: 'workspace', workspaceId: window.__collab.state.getState().workspaceId, groupId: null }));
  ok(await until(B.page, () => !!document.querySelector('[data-testid="ws-locked"]') && !!document.querySelector('.ws-actions .btn[data-locked]')), 'Marc : espace marqué « Rangement : choix de l’hôte », commandes verrouillées');
  const cur = await B.page.evaluate(() => [getComputedStyle(document.querySelector('.ws-actions .btn[data-locked]')).cursor, document.querySelector('.ws-actions .btn[data-locked]').getAttribute('title')]);
  ok(cur[0] === 'not-allowed' && /pas permis/.test(cur[1] || ''), 'Marc : curseur « interdit » et infobulle sur « Ajouter… »', cur);
  // Les documents restent lisibles : rien d'autre que les commandes de rangement n'est verrouillé.
  await B.page.waitForTimeout(900);
  const cards = await B.page.evaluate(() => [...document.querySelectorAll('.ws-scroll [data-sel-id]')].map((e) => [getComputedStyle(e).opacity, getComputedStyle(e).cursor]));
  ok(cards.length >= 3 && cards.every(([o, c]) => Number(o) === 1 && c !== 'not-allowed'), 'Marc : livres, écrits et cartes de l’espace restent ouvrables (ni grisés ni bloqués)', cards);
  await B.page.screenshot({ path: path.join(SHOTS, '04b-espace-verrouille.png') });
  await B.page.evaluate((r) => window.__store.getState().navigate(r), routeB);

  // ── 2. « Ajouter des extraits et des notes » ──
  await A.page.locator('[data-testid="collab-perms"] [data-perm="notes"]').check();
  await until(B.page, () => window.__collab.state.getState().perm.notes);
  ok((await B.page.textContent('body')).includes('a changé ce que vous pouvez faire'), 'Marc : prévenu du changement de permission');
  await tryChange('annoter');
  await until(A.page, () => window.__store.getState().highlights.some((h) => h.text === 'Extrait annoter'));
  await wait(1500);
  r = await atLea('annoter');
  ok(r.hl && !r.group, '« extraits et notes » : l’extrait arrive, le groupe non', r);
  m = await atMarc('annoter');
  ok(m.hl && !m.group, '« extraits et notes » : chez Marc aussi, l’extrait est là, le groupe refusé', m);
  ok(await until(B.page, () => !!document.querySelector('[data-testid="map-readonly"]')), '« extraits et notes » : la carte reste en lecture seule');

  // ── 3. « Modifier les cartes » ──
  await A.page.locator('[data-testid="collab-perms"] [data-perm="maps"]').check();
  ok(await until(B.page, () => !document.querySelector('[data-testid="map-readonly"]') && !!document.querySelector('.map-bar')), '« Modifier les cartes » : la carte devient modifiable chez Marc');
  await B.page.evaluate(() => {
    const s = window.__store.getState();
    const id = Object.keys(s.maps).find((k) => s.maps[k].title === 'Promesse');
    s.setMap(id, { ...s.maps[id], nodes: [...s.maps[id].nodes, { id: 'n-marc', highlightId: null, text: 'Idée de Marc', x: 300, y: 0 }] });
  });
  ok(await until(A.page, () => Object.values(window.__store.getState().maps).some((m) => m.nodes.some((n) => n.text === 'Idée de Marc'))), '« Modifier les cartes » : la carte de Marc arrive chez Léa');
  ok((await B.page.evaluate(() => window.__collab.state.getState().perm.drafts)) === false, '… et les écrits restent en lecture seule');

  // ── 4. Tout coché ──
  for (const k of ['drafts', 'organize']) await A.page.locator(`[data-testid="collab-perms"] [data-perm="${k}"]`).check();
  await until(B.page, () => Object.values(window.__collab.state.getState().perm).every(Boolean));
  await tryChange('modifier');
  r = { hl: await until(A.page, () => window.__store.getState().highlights.some((h) => h.text === 'Extrait modifier')), group: await until(A.page, () => window.__store.getState().groups.some((g) => g.name === 'Groupe modifier')) };
  ok(r.hl && r.group, 'tout coché : tout arrive chez Léa', r);
  await A.page.locator('[data-testid="collab-dialog"]').screenshot({ path: path.join(SHOTS, '05-tout-coche.png') });

  // ── 5. Contournement : Marc envoie à la main un groupe alors qu'il est repassé en lecture seule ──
  for (const k of ['notes', 'drafts', 'maps', 'organize']) await A.page.locator(`[data-testid="collab-perms"] [data-perm="${k}"]`).uncheck();
  await until(B.page, () => !Object.values(window.__collab.state.getState().perm).some(Boolean));
  await B.page.evaluate(async () => {
    const enc = new TextEncoder().encode(JSON.stringify({ t: 'recs', recs: [{ c: 'group', g: 'pirate', d: { name: 'Groupe pirate', parent: null, order: 9 }, tag: [999999, 'zz'] }] }));
    const out = new Uint8Array(4 + enc.length);
    new DataView(out.buffer).setUint32(0, enc.length);
    out.set(enc, 4);
    await window.marginalia.collabNet.send('all', out);
  });
  await wait(2500);
  ok(!(await A.page.evaluate(() => window.__store.getState().groups.some((g) => g.name === 'Groupe pirate'))), 'un message envoyé à la main par un invité en lecture seule est refusé par l’hôte');

  for (const X of [A, B]) ok(X.errors.length === 0, `${X.name} : aucune erreur de page`, X.errors.slice(0, 3));
} finally {
  for (const a of apps) await a.close().catch(() => {});
}
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
