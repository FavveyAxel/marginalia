// « Travailler à plusieurs » : un invité, même avec toutes les permissions, n'atteint rien hors de l'espace
// partagé (deux processus Electron, réseau local simulé 127.0.0.1) — Léa (hôte, A), Marc (invité, B).
// Marc écrit ses messages à la main en visant l'identifiant d'un écrit PRIVÉ de Léa (supposé deviné) :
// modification, entrée dans l'espace par un élément ou un plan forgé, suppression, capture d'un groupe
// d'un autre espace, demande de fichiers, salle d'édition. Rien ne doit changer ni sortir.
// Arrivée (preuve de possession) : l'espace de Léa contient un livre « sans fichier » dont l'empreinte est
// celle d'un livre PRIVÉ de Marc (hôte qui liste une empreinte sans avoir le fichier) : Marc ne doit ni le
// reconnaître (alias), ni envoyer sa fiche privée, ni servir son fichier. Le livre que les deux ont vraiment
// est reconnu sans doublon, et le titre personnel de Marc ne part pas.
// Prérequis : npx vite build ; Xvfb. Lancer : xvfb-run -a node scripts/test-collab-scope.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

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
    // Importé hors de la vue de l'espace (sinon l'import le rangerait dans l'espace ouvert).
    s().navigate({ name: 'home' });
    await new Promise((r) => setTimeout(r, 300));
    s().updateSettings({ activeWorkspaceId: null });
    await s().importFiles([{ name: 'Journal.md', data: new TextEncoder().encode('# Journal intime\n\nSECRET-DE-LEA\n').buffer }]);
    const secret = s().drafts.find((d) => d.id !== shared).id;
    if (s().wsItems.some((i) => i.refId === secret)) throw new Error('préparation : l’écrit privé est dans un espace');
    const other = s().createWorkspace('Privé').id;
    const before = new Set(s().groups.map((g) => g.id));
    s().createGroup(other, null, 'Groupe privé');
    const grp = s().groups.find((g) => !before.has(g.id))?.id ?? null;
    s().navigate({ name: 'workspace', workspaceId: ws, groupId: null });
    return { ws, book: book.id, shared, secret, secretTitle: s().drafts.find((d) => d.id === secret).title, other, grp };
  }, EPUB);
  ok(!!seeded.secret && seeded.secret !== seeded.shared, 'Léa : un écrit privé hors de l’espace partagé', seeded.secretTitle);

  // ── Arrivée : hôte qui annonce l'empreinte d'un livre privé de Marc sans en avoir le fichier ──
  const HTMLBUF = fs.readFileSync(path.join(ROOT, 'fixtures/discours.html'));
  const HTMLSHA = crypto.createHash('sha256').update(HTMLBUF).digest('hex');
  const bait = await A.page.evaluate(({ ws, sha, size }) => {
    const s = () => window.__store.getState();
    const id = 'appat-lea';
    s().applyExternal((cur) => ({ books: [{ id, title: 'Appât', author: '', format: 'html', fileName: 'source.html', originalName: 'appat.html', size, addedAt: Date.now(), lastOpenedAt: null, progress: 0, position: null, cover: null, edition: { publisher: '', year: '', translator: '', place: '', pageOffset: 0 }, missing: true, sourceSha256: sha }, ...cur.books] }));
    s().addToWorkspace(ws, null, 'book', id);
    return { id, sharedTitle: s().books.find((b) => b.id === s().wsItems.find((i) => i.workspaceId === ws && i.kind === 'book' && i.refId !== id).refId).title };
  }, { ws: seeded.ws, sha: HTMLSHA, size: HTMLBUF.length });
  const marc0 = await B.page.evaluate(async ({ html, epub }) => {
    const s = () => window.__store.getState();
    s().navigate({ name: 'home' });
    const bin = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer;
    const [priv] = await s().importFiles([{ name: 'marc-secret.html', data: bin(html) }]);
    s().patch('books', priv.id, { title: 'TITRE-PRIVE-DE-MARC' });
    const [same] = await s().importFiles([{ name: 'mon-discours-perso.epub', data: bin(epub) }]);
    s().patch('books', same.id, { title: 'TITRE-PERSO-MARC' });
    return { priv: priv.id, same: same.id, count: s().books.length, privOriginal: s().books.find((b) => b.id === priv.id).originalName, inWs: s().wsItems.length };
  }, { html: HTMLBUF.toString('base64'), epub: EPUB });
  // Léa capte tout ce que les invités lui envoient.
  await A.page.evaluate(() => {
    window.__fromGuests = [];
    window.marginalia.collabNet.onEvent((e) => {
      if (e.type !== 'message') return;
      const u = new Uint8Array(e.bytes);
      const n = new DataView(u.buffer, u.byteOffset).getUint32(0);
      try { window.__fromGuests.push({ from: e.from, head: JSON.parse(new TextDecoder().decode(u.subarray(4, 4 + n))), bodyLen: u.length - 4 - n }); } catch {}
    });
  });

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

  // Arrivée : vérifications (preuve de possession).
  await wait(1500);
  const arr = await B.page.evaluate(({ priv, same }) => {
    const s = window.__store.getState();
    const ws = window.__collab.state.getState().workspaceId;
    const items = s.wsItems.filter((i) => i.workspaceId === ws && i.kind === 'book').map((i) => i.refId);
    const appat = s.books.filter((b) => b.title === 'Appât');
    return { count: s.books.length, items, privInWs: items.includes(priv), sameInWs: items.includes(same), sameTitle: s.books.find((b) => b.id === same)?.title, appat: appat.map((b) => ({ id: b.id, missing: !!b.missing, inWs: items.includes(b.id) })) };
  }, marc0);
  const sent = await A.page.evaluate(() => window.__fromGuests);
  const wantMsg = sent.find((m) => m.head.t === 'want');
  const proveMsg = sent.find((m) => m.head.t === 'fetch' && m.head.c === 'prove');
  ok(!!wantMsg && wantMsg.head.books.includes(bait.id), 'arrivée : le livre annoncé sans fichier par l’hôte est demandé (« want »), pas reconnu chez Marc', wantMsg?.head);
  ok(!!proveMsg && proveMsg.head.items.some((i) => i.gid === bait.id) && proveMsg.head.items.length === 2, 'arrivée : défi de possession envoyé pour tous les livres de l’hôte (ce que Marc possède n’y paraît pas)', proveMsg?.head.items.map((i) => i.gid));
  ok(!arr.privInWs && arr.appat.length === 1 && arr.appat[0].missing && arr.appat[0].inWs, 'arrivée : le livre privé de Marc reste hors de l’espace ; une copie distincte « sans fichier » y est rangée', arr);
  ok(arr.sameInWs && arr.count === marc0.count + 1 && arr.sameTitle === 'TITRE-PERSO-MARC', 'arrivée : le livre que tous deux possèdent est reconnu (aucun doublon), Marc garde son titre', arr);
  // Léa demande ensuite le fichier du livre « appât » à Marc.
  const marcId = await A.page.evaluate(() => window.__collab.state.getState().members.find((m) => !m.host).id);
  await A.page.evaluate(async ({ to, g }) => {
    const enc = new TextEncoder().encode(JSON.stringify({ t: 'fetch', c: 'book', g }));
    const out = new Uint8Array(4 + enc.length);
    new DataView(out.buffer).setUint32(0, enc.length);
    out.set(enc, 4);
    await window.marginalia.collabNet.send(to, out);
  }, { to: marcId, g: bait.id });
  await wait(3000);
  const sent2 = await A.page.evaluate(() => window.__fromGuests);
  const baitFiles = sent2.filter((m) => m.head.t === 'files' && m.head.g === bait.id);
  ok(baitFiles.every((m) => m.bodyLen === 0 && m.head.rec?.missing === true), 'arrivée : « fetch » du livre appât — Marc ne renvoie pas son fichier', baitFiles.map((m) => ({ len: m.bodyLen, title: m.head.rec?.title })));
  const all2 = JSON.stringify(sent2.map((m) => m.head));
  ok(!all2.includes('TITRE-PRIVE-DE-MARC') && !all2.includes(marc0.privOriginal) && !all2.includes('TITRE-PERSO-MARC') && !all2.includes('mon-discours-perso'), 'arrivée : ni la fiche du livre privé, ni le titre personnel du livre commun ne partent chez Léa', { privé: all2.includes('TITRE-PRIVE-DE-MARC'), perso: all2.includes('TITRE-PERSO-MARC') });
  ok((await A.page.evaluate((t) => window.__store.getState().books.some((b) => b.title === t), bait.sharedTitle)) && !(await A.page.evaluate(() => window.__store.getState().books.some((b) => /MARC/.test(b.title)))), 'arrivée : chez Léa, le livre partagé garde son titre', bait.sharedTitle);

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

  // ── 7. Livre PRIVÉ de Léa, et Marc qui en a vraiment le fichier (preuve de possession) ──
  // Marc envoie le fichier complet et son empreinte : Léa reconnaît son livre (pas de doublon), mais ce qui
  // revient à Marc est SA fiche (titre, nom de fichier), jamais le titre ni le nom de fichier privés de Léa.
  const PDFBUF = fs.readFileSync(path.join(ROOT, 'fixtures/discours.pdf'));
  const PDFSHA = crypto.createHash('sha256').update(PDFBUF).digest('hex');
  const priv = await A.page.evaluate(async (b64) => {
    const s = () => window.__store.getState();
    const back = window.__collab.state.getState().workspaceId;
    s().navigate({ name: 'home' });
    await new Promise((r) => setTimeout(r, 300));
    s().updateSettings({ activeWorkspaceId: null });
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const [b] = await s().importFiles([{ name: 'Copie perso de Léa.pdf', data: bytes.buffer }]);
    s().patch('books', b.id, { title: 'TITRE-PRIVE-DE-LEA' });
    s().navigate({ name: 'workspace', workspaceId: back, groupId: null });
    const st = s();
    return { id: b.id, originalName: st.books.find((x) => x.id === b.id).originalName, inWs: st.wsItems.some((i) => i.refId === b.id), count: st.books.length };
  }, PDFBUF.toString('base64'));
  ok(!priv.inWs, '7. préparation : livre privé de Léa hors de tout espace', priv.originalName);
  // Marc capte ce qu'il reçoit.
  await B.page.evaluate(() => {
    window.__got = [];
    window.marginalia.collabNet.onEvent((e) => {
      if (e.type !== 'message') return;
      const u = new Uint8Array(e.bytes);
      const n = new DataView(u.buffer, u.byteOffset).getUint32(0);
      try { window.__got.push({ head: JSON.parse(new TextDecoder().decode(u.subarray(4, 4 + n))), bodyLen: u.length - 4 - n }); } catch {}
    });
  });
  // Un extrait sur un livre inconnu de Léa : elle demande le livre à Marc…
  const anchor = { kind: 'pdf', page: 1, rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] };
  await raw({ t: 'recs', recs: [{ c: 'highlight', g: 'hl-preuve', tag: T(7), d: { bookId: 'X-PREUVE', text: 'extrait de Marc', note: '', conceptIds: [], anchor } }] }, 'h');
  await wait(1500);
  // … qui répond avec le fichier complet et son empreinte.
  await B.page.evaluate(async ({ head, b64 }) => {
    const body = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const enc = new TextEncoder().encode(JSON.stringify(head));
    const out = new Uint8Array(4 + enc.length + body.length);
    new DataView(out.buffer).setUint32(0, enc.length);
    out.set(enc, 4);
    out.set(body, 4 + enc.length);
    await window.marginalia.collabNet.send('h', out);
  }, { head: { t: 'files', c: 'book', g: 'X-PREUVE', rec: { title: 'Titre de Marc', author: 'Descartes', format: 'pdf', fileName: 'source.pdf', originalName: 'marc.pdf', size: PDFBUF.length, sha256: PDFSHA }, list: [{ name: 'source.pdf', len: PDFBUF.length }] }, b64: PDFBUF.toString('base64') });
  await wait(2500);
  const st7 = await A.page.evaluate((id) => {
    const s = window.__store.getState();
    return { count: s.books.length, title: s.books.find((b) => b.id === id)?.title, marc: s.books.some((b) => b.title === 'Titre de Marc'), hl: s.highlights.find((h) => h.text === 'extrait de Marc')?.bookId ?? null };
  }, priv.id);
  ok(st7.count === priv.count && !st7.marc && st7.title === 'TITRE-PRIVE-DE-LEA', '7. fichier prouvé : Léa reconnaît son livre, aucun doublon, son titre ne change pas', st7);
  await B.page.evaluate(() => (window.__got = []));
  await raw({ t: 'fetch', c: 'book', g: 'X-PREUVE' }, 'h');
  await until(B.page, () => window.__got.some((g) => g.head.t === 'files' && g.head.g === 'X-PREUVE'), null, 10000);
  const back7 = await B.page.evaluate(() => window.__got.filter((g) => g.head.t === 'files' && g.head.g === 'X-PREUVE').map((g) => g.head.rec)[0] ?? null);
  const str7 = JSON.stringify(back7 ?? {});
  ok(!!back7 && back7.title === 'Titre de Marc' && back7.originalName === 'marc.pdf' && !str7.includes('TITRE-PRIVE-DE-LEA') && !str7.includes(priv.originalName) && !back7.cover, '7. ce que Marc reçoit ensuite est sa propre fiche, pas celle (privée) de Léa', back7 ? { title: back7.title, originalName: back7.originalName, cover: !!back7.cover } : null);

  for (const X of [A, B]) ok(X.errors.length === 0, `${X.name} : aucune erreur de page`, X.errors.slice(0, 3));
} finally {
  for (const a of apps) await a.close().catch(() => {});
}
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
