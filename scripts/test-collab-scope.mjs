// « Travailler à plusieurs » : un invité, même avec toutes les permissions, n'atteint rien hors de l'espace
// partagé (deux processus Electron, réseau local simulé 127.0.0.1) — Léa (hôte, A), Marc (invité, B).
// Marc écrit ses messages à la main en visant l'identifiant d'un écrit PRIVÉ de Léa (supposé deviné) :
// modification, entrée dans l'espace par un élément ou un plan forgé, suppression, capture d'un groupe
// d'un autre espace, demande de fichiers, salle d'édition. Rien ne doit changer ni sortir.
// Prérequis : npx vite build ; Xvfb. Lancer : xvfb-run -a node scripts/test-collab-scope.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = path.join(ROOT, 'shots/collab-scope');
fs.mkdirSync(SHOTS, { recursive: true });
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
  return c;
};
const EPUB = fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')).toString('base64');
const apps = [];
async function launch(name) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `mg-scope-${name}-`));
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
  // ── Léa : espace partagé « Parjure » (livre, écrit) ET des éléments privés hors de cet espace ──
  const seeded = await A.page.evaluate(async (b64) => {
    const s = () => window.__store.getState();
    const ws = s().createWorkspace('Parjure').id;
    s().navigate({ name: 'workspace', workspaceId: ws, groupId: null });
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const [book] = await s().importFiles([{ name: 'Discours de la méthode.epub', data: bytes.buffer }]);
    s().addToWorkspace(ws, null, 'book', book.id);
    await s().importFiles([{ name: 'Dissertation.md', data: new TextEncoder().encode('# Le parjure\n\nPeut-on promettre sans mentir ?\n').buffer }]);
    const shared = s().drafts.find((d) => /parjure|Dissertation/i.test(d.title)).id;
    s().addToWorkspace(ws, null, 'draft', shared);
    // Privé : un écrit hors de tout espace, et un autre espace avec un groupe.
    await s().importFiles([{ name: 'Journal.md', data: new TextEncoder().encode('# Journal intime\n\nSECRET-DE-LEA\n').buffer }]);
    const secret = s().drafts.find((d) => d.id !== shared).id;
    const other = s().createWorkspace('Privé').id;
    const before = new Set(s().groups.map((g) => g.id));
    s().createGroup(other, null, 'Groupe privé');
    const grp = s().groups.find((g) => !before.has(g.id))?.id ?? null;
    return { ws, book: book.id, shared, secret, secretTitle: s().drafts.find((d) => d.id === secret).title, other, grp };
  }, EPUB);
  ok(!!seeded.secret && seeded.secret !== seeded.shared, 'Léa : un écrit privé hors de l’espace partagé', seeded.secretTitle);

  await A.page.click('[data-testid="ws-share"]');
  await A.page.click('[data-testid="ws-share-collab"]');
  await A.page.waitForSelector('[data-testid="collab-start"]');
  await A.page.fill('[data-testid="collab-name"]', 'Léa');
  for (const k of ['notes', 'drafts', 'maps', 'organize']) await A.page.locator(`[data-testid="collab-perms"] [data-perm="${k}"]`).check();
  await A.page.click('[data-testid="collab-open"]');
  await A.page.waitForSelector('[data-testid="collab-code"]', { timeout: 30000 });
  const code = await A.page.getAttribute('[data-testid="collab-code"]', 'data-code');
  const found = await B.page.evaluate((code) => window.__collab.session().then((m) => m.guestFind(code, undefined, { name: 'Marc', color: '#1d4ed8' })), code);
  const joining = B.page.evaluate((t) => window.__collab.session().then((m) => m.guestJoin(t, { name: 'Marc', color: '#1d4ed8' }, 'Léa')), found.ticket);
  await A.page.waitForSelector('[data-testid="collab-request"]', { timeout: 20000 });
  await A.page.click('[data-testid="collab-accept"]');
  await joining;
  await until(B.page, () => window.__collab.state.getState().phase === 'live', null, 60000);
  ok(JSON.stringify(await B.page.evaluate(() => window.__collab.state.getState().perm)) === JSON.stringify({ notes: true, drafts: true, maps: true, organize: true }), 'Marc : toutes les permissions (cas le plus favorable à l’attaquant)');
  ok(!(await B.page.evaluate((t) => window.__store.getState().drafts.some((d) => d.title === t), seeded.secretTitle)), 'Marc n’a pas reçu l’écrit privé');

  // Marc, invité malveillant, connaît (on le suppose) les identifiants privés de Léa et écrit ses messages à la main.
  const raw = (head, to = 'all') =>
    B.page.evaluate(async ({ head, to }) => {
      const enc = new TextEncoder().encode(JSON.stringify(head));
      const out = new Uint8Array(4 + enc.length);
      new DataView(out.buffer).setUint32(0, enc.length);
      out.set(enc, 4);
      await window.marginalia.collabNet.send(to, out);
    }, { head, to });
  const T = (n) => [9000000 + n, 'zz'];
  const snap = () =>
    A.page.evaluate(({ ws, secret, grp }) => {
      const s = window.__store.getState();
      const d = s.drafts.find((x) => x.id === secret);
      return {
        title: d ? d.title : null,
        inWs: s.wsItems.some((i) => i.workspaceId === ws && i.refId === secret),
        trashed: !d,
        grpWs: grp ? s.groups.find((g) => g.id === grp)?.workspaceId ?? null : null,
        grpName: grp ? s.groups.find((g) => g.id === grp)?.name ?? null : null,
        plans: s.plans.map((p) => ({ title: p.title, draftId: p.draftId })),
        nodeDocs: Object.values(s.maps).flatMap((m) => m.nodes.map((n) => n.doc?.id).filter(Boolean)),
      };
    }, seeded);
  const before = await snap();

  // 1. Modifier l'écrit privé (même gid).
  await raw({ t: 'recs', recs: [{ c: 'draft', g: seeded.secret, d: { title: 'PIRATÉ' }, tag: T(1) }] });
  // 2. Le faire entrer dans l'espace partagé par un élément d'espace qui le référence.
  await raw({ t: 'recs', recs: [{ c: 'item', g: 'item-pirate', d: { kind: 'draft', refId: seeded.secret, groupId: null, order: 5 }, tag: T(2) }] });
  // 3. Le rattacher à un plan (plan.draftId entre dans le périmètre).
  await raw({ t: 'recs', recs: [{ c: 'plan', g: 'plan-pirate', d: { title: 'Plan pirate', parts: [], draftId: seeded.secret }, tag: T(3) }, { c: 'item', g: 'item-plan-pirate', d: { kind: 'plan', refId: 'plan-pirate', groupId: null, order: 6 }, tag: T(4) }] });
  // 4. Le supprimer.
  await raw({ t: 'recs', recs: [{ c: 'draft', g: seeded.secret, del: 1, tag: T(5) }] });
  // 5. Capturer le groupe d'un autre espace.
  if (seeded.grp) await raw({ t: 'recs', recs: [{ c: 'group', g: seeded.grp, d: { name: 'Groupe capturé', parentId: null, order: 1 }, tag: T(6) }] });
  // 6. Demander ses fichiers, et rejoindre sa salle d'édition.
  await raw({ t: 'fetch', c: 'draft', g: seeded.secret }, 'h');
  await raw({ t: 'room-join', r: seeded.secret }, 'h');
  await wait(6000);

  const after = await snap();
  ok(after.title === before.title, '1. écrit privé : titre inchangé', after.title);
  ok(!after.inWs, '2. écrit privé : pas entré dans l’espace partagé par un élément forgé');
  ok(after.plans.every((p) => p.draftId !== seeded.secret), '3. aucun plan reçu ne pointe vers l’écrit privé', after.plans);
  ok(!after.trashed, '4. écrit privé : pas supprimé');
  if (seeded.grp) ok(after.grpWs === seeded.other && after.grpName !== 'Groupe capturé', '5. groupe d’un autre espace : ni déplacé ni renommé', [after.grpWs, after.grpName]);
  const leaked = await B.page.evaluate((t) => {
    const s = window.__store.getState();
    return s.drafts.some((d) => d.title === t) || JSON.stringify(s.drafts).includes('SECRET-DE-LEA');
  }, seeded.secretTitle);
  ok(!leaked, '6. Marc n’a toujours pas l’écrit privé (fichiers et salle refusés)');
  const scopeLeak = await A.page.evaluate(({ secret }) => {
    const c = window.__collab.state.getState();
    return JSON.stringify(c).includes(secret);
  }, seeded);
  ok(!scopeLeak, 'l’état de la session de Léa ne mentionne pas l’écrit privé');
  // La session marche toujours : un vrai changement de Marc arrive.
  await B.page.evaluate(() => {
    const s = window.__store.getState();
    const ws = window.__collab.state.getState().workspaceId;
    s.createGroup(ws, null, 'Groupe légitime');
  });
  ok(await until(A.page, () => window.__store.getState().groups.some((g) => g.name === 'Groupe légitime')), 'un changement légitime de Marc arrive toujours chez Léa');

  for (const X of [A, B]) ok(X.errors.length === 0, `${X.name} : aucune erreur de page`, X.errors.slice(0, 3));
} finally {
  for (const a of apps) await a.close().catch(() => {});
}
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
