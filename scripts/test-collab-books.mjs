// « Travailler à plusieurs » : livres ajoutés PENDANT la session (trois processus Electron, réseau local
// simulé 127.0.0.1) — l'hôte Léa (A), les invités Marc (B) et Inès (C).
//  1. Marc importe un livre dans l'espace partagé : Léa et Inès le reçoivent, fichier compris.
//  2. Marc ajoute un livre « sans fichier » (avec un extrait) : il arrive chez les autres « sans fichier »,
//     avec son extrait (avant : rien n'arrivait, tout restait en attente).
//  3. Inès a déjà ce livre « sans fichier » ; Marc ajoute le vrai fichier : le livre d'Inès est complété,
//     pas de doublon.
//  4. Un espace encore vide partagé : l'invité arrive (avant : il restait bloqué « en arrivée »).
// Prérequis : npx vite build ; Xvfb (:99). Lancer : DISPLAY=:99 LANG=C.UTF-8 timeout 600 node scripts/test-collab-books.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
  return c;
};
const EPUB = fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')).toString('base64');
const PDF = fs.readFileSync(path.join(ROOT, 'fixtures/discours.pdf')).toString('base64');
const apps = [];
async function launch(name) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `mg-books-${name}-`));
  const app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: path.join(home, 'donnees'), MARGINALIA_E2E_LAN: '127.0.0.1', VITE_DEV_SERVER_URL: '' },
    timeout: 60000,
  });
  apps.push(app);
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready && window.__collab, null, { timeout: 60000 });
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
  return { app, page, name };
}
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const books = (X) => X.page.evaluate(() => window.__store.getState().books.map((b) => ({ id: b.id, title: b.title, missing: !!b.missing, sha: b.sourceSha256 || null, fileName: b.fileName })));

const A = await launch('lea');
const B = await launch('marc');
const C = await launch('ines');
try {
  // ── Session : Léa ouvre « Parjure », Marc et Inès rejoignent ──
  const ws = await A.page.evaluate(async () => {
    const s = () => window.__store.getState();
    const id = s().createWorkspace('Parjure').id;
    s().navigate({ name: 'workspace', workspaceId: id, groupId: null });
    await s().importFiles([{ name: 'Dissertation.md', data: new TextEncoder().encode('# Le parjure\n\nPeut-on promettre ?\n').buffer }]);
    s().addToWorkspace(id, null, 'draft', s().drafts[0].id);
    return id;
  });
  await A.page.evaluate((ws) => window.__collab.session().then((m) => m.startHost(ws, { name: 'Léa', color: '#c2410c' })), ws);
  const code = await A.page.evaluate(() => window.__collab.state.getState().code);
  for (const [X, name, color] of [[B, 'Marc', '#1d4ed8'], [C, 'Inès', '#15803d']]) {
    const found = await X.page.evaluate(({ code, name, color }) => window.__collab.session().then((m) => m.guestFind(code, undefined, { name, color })), { code, name, color });
    const joining = X.page.evaluate(({ t, name, color }) => window.__collab.session().then((m) => m.guestJoin(t, { name, color }, 'Léa')), { t: found.ticket, name, color });
    await until(A.page, () => window.__collab.state.getState().requests.length > 0);
    await A.page.evaluate(() => window.__collab.session().then((m) => m.acceptRequest(window.__collab.state.getState().requests[0].reqId)));
    await joining;
    const live = await until(X.page, () => window.__collab.state.getState().phase === 'live' && window.__collab.state.getState().workspaceId, null, 60000);
    ok(live, `${name} : dans la session`, await X.page.evaluate(() => window.__collab.state.getState().phase));
  }
  ok((await A.page.evaluate(() => window.__collab.state.getState().members.length)) === 3, 'session à trois : Léa, Marc, Inès');
  const wsOf = (X) => X.page.evaluate(() => window.__collab.state.getState().workspaceId);

  // ── 1. Marc importe un livre dans l'espace ──
  const wsB = await wsOf(B);
  await B.page.evaluate(
    async ({ b64, ws }) => {
      const s = () => window.__store.getState();
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await s().importFiles([{ name: 'Discours de la méthode.epub', data: bytes.buffer }]);
      s().addToWorkspace(ws, null, 'book', book.id);
    },
    { b64: EPUB, ws: wsB },
  );
  for (const X of [A, C]) {
    const got = await until(X.page, () => window.__store.getState().books.some((b) => /Discours/.test(b.title) && !b.missing));
    const bs = await books(X);
    const file = got ? await X.page.evaluate((id) => window.marginalia.readFile(id, window.__store.getState().books.find((b) => b.id === id).fileName).then((d) => d.byteLength), bs.find((b) => /Discours/.test(b.title)).id) : 0;
    ok(got && file > 1000, `${X.name} : livre ajouté par Marc reçu, fichier compris`, { livres: bs.length, octets: file });
  }

  // ── 2. Marc ajoute un livre « sans fichier », avec un extrait ──
  await B.page.evaluate(
    async ({ b64, ws }) => {
      const s = () => window.__store.getState();
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await s().importFiles([{ name: 'Traité.pdf', data: bytes.buffer }]);
      // Le fichier a disparu : le livre est « sans fichier ».
      s().applyExternal((cur) => ({ books: cur.books.map((b) => (b.id === book.id ? { ...b, title: 'Traité sans fichier', missing: true } : b)) }));
      s().addToWorkspace(ws, null, 'book', book.id);
      s().addHighlight({ bookId: book.id, category: 'these', text: 'Extrait du livre sans fichier', anchor: { kind: 'pdf', page: 1, rects: [], start: 0, end: 10 }, locationLabel: 'p. 1' });
    },
    { b64: PDF, ws: wsB },
  );
  for (const X of [A, C]) {
    const got = await until(X.page, () => {
      const s = window.__store.getState();
      const b = s.books.find((x) => x.title === 'Traité sans fichier');
      return b && b.missing && s.highlights.some((h) => h.bookId === b.id && h.text === 'Extrait du livre sans fichier');
    });
    ok(got, `${X.name} : livre « sans fichier » de Marc reçu « sans fichier », avec son extrait`);
  }

  // ── 3. Inès a déjà le livre « sans fichier » ; Marc ajoute le vrai : complété, pas de doublon ──
  const ART = fs.readFileSync(path.join(ROOT, 'fixtures/discours.html')).toString('base64');
  const sha = await C.page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const { sha256Hex } = await import('/src/features/share/sharePackage.ts').catch(() => ({}));
    const hex = sha256Hex ? await sha256Hex(bytes.buffer) : [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
    const s = window.__store.getState();
    const id = 'ines-attente';
    s.applyExternal((cur) => ({ books: [{ id, title: 'Livre attendu par Inès', author: '', format: 'html', fileName: 'source.html', originalName: 'x.html', size: bytes.byteLength, addedAt: Date.now(), lastOpenedAt: null, progress: 0, position: null, cover: null, edition: { publisher: '', year: '', translator: '', place: '', pageOffset: 0 }, missing: true, sourceSha256: hex }, ...cur.books] }));
    return hex;
  }, ART);
  const beforeC = (await books(C)).length;
  await B.page.evaluate(
    async ({ b64, ws }) => {
      const s = () => window.__store.getState();
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await s().importFiles([{ name: 'Autre.html', data: bytes.buffer }]);
      s().addToWorkspace(ws, null, 'book', book.id);
    },
    { b64: ART, ws: wsB },
  );
  const completed = await until(C.page, () => {
    const b = window.__store.getState().books.find((x) => x.id === 'ines-attente');
    return b && !b.missing;
  });
  const afterC = await books(C);
  ok(completed && afterC.length === beforeC && afterC.filter((b) => b.sha === sha || b.id === 'ines-attente').length === 1, 'Inès : son livre « sans fichier » est complété par celui de Marc, sans doublon', { avant: beforeC, après: afterC.length, sha: sha.slice(0, 8) });
  const inWs = await C.page.evaluate(() => {
    const s = window.__store.getState();
    const ws = window.__collab.state.getState().workspaceId;
    return s.wsItems.some((i) => i.workspaceId === ws && i.kind === 'book' && i.refId === 'ines-attente');
  });
  ok(inWs, 'Inès : c’est son livre complété qui est rangé dans l’espace partagé');

  // ── 4. Espace encore vide partagé : l'invité arrive quand même (avant : bloqué « en arrivée ») ──
  await B.page.evaluate(() => window.__collab.session().then((m) => m.stopSession()));
  await C.page.evaluate(() => window.__collab.session().then((m) => m.stopSession()));
  // En quittant : les livres reçus pendant la session font partie de ce qu'Inès peut ne pas garder ;
  // son propre livre (complété) reste à elle.
  const after = await C.page.evaluate(() => {
    const a = window.__collab.state.getState().afterSession;
    const s = window.__store.getState();
    return a ? a.targets.filter((t) => t.kind === 'book').map((t) => s.books.find((b) => b.id === t.id)?.title ?? t.id) : null;
  });
  ok(after && after.includes('Discours de la méthode') && after.includes('Traité sans fichier') && !after.includes('Livre attendu par Inès'), 'Inès quitte : les livres reçus en session sont proposés au retrait, pas le sien', after);
  await C.page.evaluate(() => window.__collab.session().then((m) => m.dropSharedWorkspace()));
  const left = await C.page.evaluate(() => window.__store.getState().books.map((b) => b.title));
  ok(!left.includes('Traité sans fichier') && !left.includes('Discours de la méthode') && left.includes('Livre attendu par Inès'), '« Ne pas garder » : les livres reçus partent à la corbeille, le sien reste', left);
  await A.page.evaluate(() => window.__collab.session().then((m) => m.stopSession()));
  await A.page.waitForTimeout(1500);
  await B.page.evaluate(() => window.__collab.state.setState({ afterSession: null }));
  const empty = await A.page.evaluate(() => window.__store.getState().createWorkspace('Vide pour l’instant').id);
  await A.page.evaluate((ws) => window.__collab.session().then((m) => m.startHost(ws, { name: 'Léa', color: '#c2410c' })), empty);
  const code2 = await A.page.evaluate(() => window.__collab.state.getState().code);
  const f2 = await B.page.evaluate((code) => window.__collab.session().then((m) => m.guestFind(code, undefined, { name: 'Marc', color: '#1d4ed8' })), code2);
  const j2 = B.page.evaluate((t) => window.__collab.session().then((m) => m.guestJoin(t, { name: 'Marc', color: '#1d4ed8' }, 'Léa')), f2.ticket);
  await until(A.page, () => window.__collab.state.getState().requests.length > 0);
  await A.page.evaluate(() => window.__collab.session().then((m) => m.acceptRequest(window.__collab.state.getState().requests[0].reqId)));
  await j2;
  const live2 = await until(B.page, () => window.__collab.state.getState().phase === 'live', null, 30000);
  const wsName = await B.page.evaluate(() => { const c = window.__collab.state.getState(); return window.__store.getState().workspaces.find((w) => w.id === c.workspaceId)?.name; });
  ok(live2 && wsName === 'Vide pour l’instant', 'espace vide partagé : Marc arrive, l’espace (vide) est créé chez lui', { live: live2, wsName });
  await A.page.evaluate(async () => {
    const s = () => window.__store.getState();
    const ws = window.__collab.state.getState().workspaceId;
    await s().importFiles([{ name: 'Premier.md', data: new TextEncoder().encode('# Premier écrit\n\nTexte.\n').buffer }]);
    s().addToWorkspace(ws, null, 'draft', s().drafts.find((d) => d.title === 'Premier écrit').id);
  });
  ok(await until(B.page, () => { const c = window.__collab.state.getState(); return window.__store.getState().wsItems.some((i) => i.workspaceId === c.workspaceId && i.kind === 'draft'); }), 'puis l’écrit ajouté par Léa arrive chez Marc');
} finally {
  for (const a of apps) await a.close().catch(() => {});
}
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
