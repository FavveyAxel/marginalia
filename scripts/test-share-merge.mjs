// Partage « .marginalia » (brique 1) : paquet d'un espace (groupes, écrit, carte libre reliée à des
// extraits, carte du livre, fiche-texte et carte de mouvement, plan, argument, concept, carte de révision,
// EPUB avec extraits et notes) → export avec et sans le livre → import dans des bibliothèques neuves
// (contexte navigateur neuf = IndexedDB vide) qui ont, ou non, déjà le livre.
// Vérifie : tout est là, références intactes, aucun doublon de livre, rien d'écrasé, second import =
// nouvelles copies, livre « sans fichier » complété plus tard, notes privées jamais partagées,
// paquets altérés ou piégés refusés avec un message clair et sans rien écrire.
// Lancer : timeout 600 node scripts/test-share-merge.mjs
import { withApp, importFixture } from './harness.mjs';
import JSZip from 'jszip';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EPUB_SHA = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub'))).digest('hex');
let nOk = 0;
let nKo = 0;
const ok = (c, m, extra = '') => {
  if (c) nOk++;
  else nKo++;
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};

// Aides injectées dans chaque page : base64 ⇄ octets, contrôle de toutes les références, instantané.
const PAGE_HELPERS = `
window.__u8tob64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
window.__b64tou8 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
window.__cols = ['books','highlights','concepts','arguments','studies','plans','drafts','cards','workspaces','groups','wsItems'];
window.__snap = () => {
  const s = window.__store.getState();
  const o = {};
  for (const c of window.__cols) o[c] = Object.fromEntries(s[c].map((x) => [x.id, JSON.stringify(x)]));
  o.maps = Object.fromEntries(Object.entries(s.maps).map(([k, m]) => [k, JSON.stringify(m)]));
  return o;
};
window.__counts = () => { const s = window.__store.getState(); const o = {}; for (const c of window.__cols) o[c] = s[c].length; o.maps = Object.keys(s.maps).length; return o; };
window.__checkRefs = () => {
  const s = window.__store.getState();
  const has = (arr) => new Set(arr.map((x) => x.id));
  const B = has(s.books), H = has(s.highlights), C = has(s.concepts), A = has(s.arguments), S = has(s.studies), P = has(s.plans), D = has(s.drafts), W = has(s.workspaces), G = has(s.groups);
  const bad = [];
  for (const h of s.highlights) { if (!B.has(h.bookId)) bad.push('extrait→livre'); for (const c of h.conceptIds) if (!C.has(c)) bad.push('extrait→concept'); }
  for (const c of s.concepts) {
    for (const se of c.senses) { if (se.bookId && !B.has(se.bookId)) bad.push('sens→livre'); for (const x of se.highlightIds) if (!H.has(x)) bad.push('sens→extrait'); }
    for (const l of c.links) if (!C.has(l.conceptId)) bad.push('concept→concept');
  }
  for (const [k, m] of Object.entries(s.maps)) {
    const kind = m.kind ?? 'book';
    if (kind === 'book' && !B.has(k)) bad.push('carte de livre→livre');
    if (kind === 'movement' && (!S.has(m.studyId) || !B.has(m.bookId))) bad.push('carte de mouvement→fiche');
    if (kind !== 'book' && m.id !== k) bad.push('carte : id ≠ clé');
    for (const b of m.bookIds ?? []) if (!B.has(b)) bad.push('carte→livres');
    const nodes = new Set(m.nodes.map((n) => n.id));
    for (const n of m.nodes) {
      if (n.highlightId && !H.has(n.highlightId)) bad.push('nœud→extrait');
      if (n.conceptId && !C.has(n.conceptId)) bad.push('nœud→concept');
      if (n.portal && !s.maps[n.portal]) bad.push('portail');
    }
    for (const e of m.edges) if (!nodes.has(e.source) || !nodes.has(e.target)) bad.push('lien→nœud');
  }
  for (const a of s.arguments) { if (a.bookId && !B.has(a.bookId)) bad.push('argument→livre'); for (const st of [...a.premises, a.conclusion]) if (st.highlightId && !H.has(st.highlightId)) bad.push('argument→extrait'); }
  for (const x of s.studies) if (!B.has(x.bookId)) bad.push('fiche→livre');
  const walk = (nodes) => nodes.forEach((n) => { n.items.forEach((it) => { const r = it.ref; if (r.kind === 'highlight' && !H.has(r.id)) bad.push('plan→extrait'); if (r.kind === 'concept' && !C.has(r.id)) bad.push('plan→concept'); if (r.kind === 'argument' && !A.has(r.id)) bad.push('plan→argument'); }); walk(n.children); });
  for (const p of s.plans) { walk(p.parts); if (p.draftId && !D.has(p.draftId)) bad.push('plan→écrit'); }
  for (const c of s.cards) { if (c.highlightId && !H.has(c.highlightId)) bad.push('carte→extrait'); if (c.conceptId && !C.has(c.conceptId)) bad.push('carte→concept'); if (c.bookId && !B.has(c.bookId)) bad.push('carte→livre'); }
  for (const g of s.groups) { if (!W.has(g.workspaceId)) bad.push('groupe→espace'); if (g.parentId && !G.has(g.parentId)) bad.push('groupe→parent'); }
  const refOk = { book: B, draft: D, plan: P, argument: A, study: S };
  for (const i of s.wsItems) { if (!W.has(i.workspaceId)) bad.push('référence→espace'); if (i.groupId && !G.has(i.groupId)) bad.push('référence→groupe'); if (i.kind === 'map' ? !s.maps[i.refId] : !refOk[i.kind].has(i.refId)) bad.push('référence→' + i.kind); }
  for (const c of window.__cols) if (new Set(s[c].map((x) => x.id)).size !== s[c].length) bad.push('id en double : ' + c);
  return bad;
};
`;

const setup = async (page) => page.evaluate(PAGE_HELPERS);
const share = (page, fn, arg) => page.evaluate(fn, arg);
const unzip = (b64) => JSZip.loadAsync(Buffer.from(b64, 'base64'));
const sameSnap = (before, after) => {
  const lost = [];
  for (const [col, items] of Object.entries(before)) for (const [id, json] of Object.entries(items)) if (after[col][id] !== json) lost.push(`${col}:${id}`);
  return lost;
};

// Importe un paquet ; renvoie le résultat, ou l'erreur (code + message).
const importPkg = (page, b64) =>
  page.evaluate(async (b64) => {
    const m = await import('/src/features/share/shareMerge.ts');
    try {
      return { ok: true, res: await m.importSharePackage(window.__b64tou8(b64)) };
    } catch (e) {
      return { ok: false, code: e.code, message: e.message };
    }
  }, b64);
const previewPkg = (page, b64) =>
  page.evaluate(async (b64) => {
    const m = await import('/src/features/share/sharePackage.ts');
    try {
      return { ok: true, res: await m.readSharePackage(window.__b64tou8(b64)) };
    } catch (e) {
      return { ok: false, code: e.code, message: e.message };
    }
  }, b64);
const readFileB64 = (page, ownerId, name) =>
  page.evaluate(
    async ({ ownerId, name }) => {
      const { host } = await import('/src/lib/platform.ts');
      const d = await host.readFile(ownerId, name).catch(() => null);
      return d ? window.__u8tob64(new Uint8Array(d)) : null;
    },
    { ownerId, name },
  );
const docXml = async (b64) => (await (await JSZip.loadAsync(Buffer.from(b64, 'base64'))).file('word/document.xml').async('string'));

// ═════════════════════════════════════════════════════════════
// Bibliothèque A : l'expéditeur
// ═════════════════════════════════════════════════════════════
const A = {};
await withApp(5401, async (page, errors) => {
  await setup(page);
  const epub = await importFixture(page, 'fixtures/discours.epub', { open: true });
  await page.waitForSelector('.html-doc [data-chapter]', { timeout: 30000 });
  await page.waitForTimeout(1200);
  // Ancres réelles (offsets dans le texte du chapitre) pour trois passages.
  const anchors = await page.evaluate((needles) => {
    const out = {};
    for (const n of needles) {
      for (const el of document.querySelectorAll('.html-doc [data-chapter]')) {
        const t = el.textContent;
        const i = t.indexOf(n);
        if (i < 0) continue;
        out[n] = { kind: 'html', chapter: Number(el.getAttribute('data-chapter')), start: i, end: i + n.length, prefix: t.slice(Math.max(0, i - 32), i), suffix: t.slice(i + n.length, i + n.length + 32) };
        break;
      }
    }
    return out;
  }, ['Le bon sens est la chose du monde la mieux partagée', 'la diversité de nos opinions', 'Les plus grandes âmes sont capables des plus grands vices']);
  ok(Object.keys(anchors).length === 3, 'A : trois passages repérés dans l’EPUB', Object.keys(anchors).length);

  Object.assign(
    A,
    await page.evaluate(
      async ({ epub, anchors }) => {
        const s = () => window.__store.getState();
        const [n1, n2, n3] = Object.keys(anchors);
        const h1 = s().addHighlight({ bookId: epub, category: 'these', text: n1, anchor: anchors[n1], locationLabel: 'Première partie', note: 'Ma note sur le bon sens' }).id;
        const h2 = s().addHighlight({ bookId: epub, category: 'argument', text: n2, anchor: anchors[n2], locationLabel: 'Première partie' }).id;
        const h3 = s().addHighlight({ bookId: epub, category: null, text: n3, anchor: anchors[n3], locationLabel: 'Première partie', note: 'Une note de marge' }).id;
        const c = s().addConcept('Raison', 'Pouvoir de bien juger').id;
        s().toggleHighlightConcept(h1, c);
        s().updateConcept(c, { senses: [{ id: 'se1', author: 'Descartes', bookId: epub, definition: 'Le bon sens', highlightIds: [h1] }] });
        const { newFsrs } = await import('/src/features/revision/fsrs.ts');
        const card = { id: 'cardA1', kind: 'citation', front: 'Qui a dit ?', back: 'Descartes', highlightId: h1, conceptId: null, bookId: epub, suspended: false, fsrs: { ...newFsrs(), reps: 7, state: 2 }, createdAt: Date.now() };
        s().insert('cards', card);
        const ws = s().createWorkspace('Philosophie').id;
        const tint = s().workspaces.find((w) => w.id === ws).tint;
        const g1 = s().createGroup(ws, null, 'Cours').id;
        const g2 = s().createGroup(ws, g1, 'Sources').id;
        s().addToWorkspace(ws, g2, 'book', epub);
        const { createDraft } = await import('/src/features/editor/api.ts');
        const d = await createDraft({ title: 'Dissertation sur le bon sens', html: `<p>Introduction : le bon sens est-il partagé ?</p><p><span data-cite-hl="${h1}">« Le bon sens est la chose du monde la mieux partagée »</span></p>` });
        const other = await createDraft({ title: 'Brouillon hors espace', html: '<p>Ne doit pas partir.</p>' });
        s().addToWorkspace(ws, g1, 'draft', d.id);
        const now = Date.now();
        const board = 'board-testA';
        s().setMap(board, {
          id: board, kind: 'board', bookId: '', title: 'Comparer', bookIds: [epub], viewport: null, zones: [{ id: 'z1', title: 'Zone', color: '--cat-these', x: 0, y: 0, w: 600, h: 300 }],
          nodes: [
            { id: 'n1', highlightId: h1, text: '', x: 0, y: 0 },
            { id: 'n2', highlightId: h2, text: '', x: 300, y: 0 },
            { id: 'n3', highlightId: null, text: 'Idée libre', x: 0, y: 200, color: '--cat-exemple' },
            { id: 'n4', highlightId: null, conceptId: c, text: 'Raison — pouvoir de bien juger', x: 300, y: 200 },
          ],
          edges: [{ id: 'e1', source: 'n1', target: 'n2', relation: 'soutient', groupId: null }, { id: 'e2', source: 'n3', target: 'n1', relation: 'illustre', groupId: null }],
          createdAt: now, updatedAt: now,
        });
        s().addToWorkspace(ws, null, 'map', board);
        s().setMap(epub, { bookId: epub, nodes: [{ id: 'm1', highlightId: h3, text: '', x: 0, y: 0 }], edges: [], viewport: null });
        const plan = { id: 'planA', title: 'Plan du bon sens', sujet: 'Le bon sens', definitions: '', problematique: '', parts: [{ id: 'p1', title: 'I', note: '', items: [{ id: 'i1', ref: { kind: 'highlight', id: h2 } }, { id: 'i2', ref: { kind: 'concept', id: c } }, { id: 'i3', ref: { kind: 'text', text: 'Transition' } }], children: [] }], conclusion: '', draftId: d.id, createdAt: now, updatedAt: now };
        s().insert('plans', plan);
        s().addToWorkspace(ws, g1, 'plan', plan.id);
        const arg = { id: 'argA', title: 'Argument du bon sens', bookId: epub, premises: [{ id: 'a1', text: 'P1', highlightId: h1, implicit: false }], conclusion: { id: 'a2', text: 'C', highlightId: null, implicit: false }, comment: '', createdAt: now, updatedAt: now };
        s().insert('arguments', arg);
        s().addToWorkspace(ws, null, 'argument', arg.id);
        const study = { id: 'studyA', bookId: epub, title: 'Première partie', probleme: '', these: '', enjeu: '', movements: [{ id: 'mv1', anchor: anchors[n1], startText: 'Le bon sens', title: 'I', role: 'pose la thèse' }], createdAt: now, updatedAt: now };
        s().insert('studies', study);
        s().addToWorkspace(ws, g1, 'study', study.id);
        const mvKey = `mv-${study.id}-mv1`;
        s().setMap(mvKey, { id: mvKey, kind: 'movement', bookId: epub, studyId: study.id, movementId: 'mv1', nodes: [{ id: 'q1', highlightId: h1, text: '', x: 0, y: 0 }], edges: [], viewport: null, createdAt: now, updatedAt: now });
        return { epub, h1, h2, h3, c, ws, tint, g1, g2, draft: d.id, otherDraft: other.id, board, plan: plan.id, arg: arg.id, study: study.id, mvKey };
      },
      { epub, anchors },
    ),
  );

  // Note privée glissée dans l'écrit (style « MarginaliaNotePrivee ») : elle ne doit jamais partir.
  {
    const zip = await JSZip.loadAsync(Buffer.from(await readFileB64(page, A.draft, 'document.docx'), 'base64'));
    const xml = await zip.file('word/document.xml').async('string');
    const priv = '<w:p><w:pPr><w:pStyle w:val="MarginaliaNotePrivee"/></w:pPr><w:r><w:t>SECRET PRIVÉ DE A</w:t></w:r></w:p>';
    zip.file('word/document.xml', xml.replace('<w:body>', '<w:body>' + priv));
    const b64 = (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
    await page.evaluate(async ({ id, b64 }) => (await import('/src/lib/platform.ts')).host.storeFile(id, 'document.docx', window.__b64tou8(b64).buffer), { id: A.draft, b64 });
  }
  const aXml = await docXml(await readFileB64(page, A.draft, 'document.docx'));
  ok(aXml.includes(`_mglHl_${A.h1}`) && aXml.includes('SECRET PRIVÉ'), 'A : l’écrit cite l’extrait (signet _mglHl_) et contient une note privée');

  const before = await page.evaluate(() => window.__snap());
  const built = await page.evaluate(
    async ({ ws, board }) => {
      const m = await import('/src/features/share/sharePackage.ts');
      const out = {};
      for (const [k, sel, includeBooks] of [
        ['without', { kind: 'workspace', workspaceId: ws }, false],
        ['with', { kind: 'workspace', workspaceId: ws }, true],
        ['items', { kind: 'items', ids: [board] }, false],
      ]) {
        const r = await m.buildSharePackage(sel, { includeBooks });
        out[k] = { b64: window.__u8tob64(r.bytes), summary: r.summary };
      }
      try {
        await m.buildSharePackage({ kind: 'items', ids: ['inconnu'] }, { includeBooks: false });
        out.empty = 'pas d’erreur';
      } catch (e) {
        out.empty = e.message;
      }
      out.preview = await m.readSharePackage(window.__b64tou8(out.without.b64));
      return out;
    },
    { ws: A.ws, board: A.board },
  );
  A.pkg = { without: built.without.b64, with: built.with.b64, items: built.items.b64 };
  const sm = built.without.summary;
  ok(
    sm.counts.drafts === 1 && sm.counts.maps === 3 && sm.counts.highlights === 3 && sm.counts.concepts === 1 && sm.counts.books === 1 && sm.counts.cards === 1 && sm.counts.groups === 2 && sm.counts.plans === 1 && sm.counts.arguments === 1 && sm.counts.studies === 1,
    'export d’un espace : écrit, 3 cartes (libre, du livre, du mouvement), 3 extraits, concept, livre, carte de révision, 2 groupes, plan, argument, fiche',
    sm.counts,
  );
  ok(sm.counts.booksWithFile === 0 && !sm.booksIncluded && built.with.summary.counts.booksWithFile === 1 && built.with.summary.booksIncluded, 'livre joint seulement avec « joindre les livres »');
  ok(sm.privateNotesRemoved === 1, 'note privée retirée de l’écrit partagé', sm.privateNotesRemoved);
  ok(built.with.summary.size > built.without.summary.size + 15000, 'le paquet avec le livre est plus lourd (fichier EPUB joint)', [built.without.summary.size, built.with.summary.size]);
  ok(/Rien à partager/.test(built.empty), 'sélection vide : message clair', built.empty);
  ok(built.preview.booksHere === 1 && built.preview.books[0].local?.id === A.epub && !built.preview.alreadyReceived, 'aperçu chez l’expéditeur : le livre est reconnu « déjà présent »', built.preview.books);
  ok(sameSnap(before, await page.evaluate(() => window.__snap())).length === 0, 'A : construire les paquets ne modifie rien');
  const isc = built.items.summary.counts;
  ok(isc.maps === 1 && isc.highlights === 2 && isc.concepts === 1 && isc.books === 1 && isc.drafts === 0 && isc.workspaces === 0, 'liste libre (une carte) : ses 2 extraits, son concept et le livre suivent', isc);

  // Contenu du paquet, lu hors de l'app.
  const zw = await unzip(A.pkg.with);
  const zo = await unzip(A.pkg.without);
  const names = Object.keys(zw.files).sort();
  const manifest = JSON.parse(await zw.file('manifest.json').async('string'));
  const data = JSON.parse(await zw.file('data.json').async('string'));
  ok(names.includes('manifest.json') && names.includes('data.json') && names.includes(`files/${A.epub}/source.epub`) && names.includes(`files/${A.draft}/document.docx`), 'archive : manifest.json, data.json, files/<id>/<fichier>', names);
  ok(!Object.keys(zo.files).some((n) => n.endsWith('.epub')) && Object.keys(zo.files).includes(`files/${A.draft}/document.docx`), 'sans les livres : l’EPUB n’est pas joint, l’écrit si');
  ok(manifest.format === 'marginalia-share' && manifest.v === 1 && manifest.scope === 'workspace' && manifest.title === 'Philosophie' && manifest.shareId === `ws-${A.ws}`, 'manifeste : format, version, portée, titre, identifiant de partage stable', [manifest.format, manifest.v, manifest.shareId]);
  ok(manifest.books[0].sha256 === EPUB_SHA && manifest.books[0].size === fs.statSync(path.join(ROOT, 'fixtures/discours.epub')).size, 'manifeste : empreinte SHA-256 et taille du fichier source exactes');
  ok(JSON.parse(await zo.file('manifest.json').async('string')).books[0].sha256 === EPUB_SHA, 'sans les livres : l’empreinte est quand même dans le manifeste');
  ok(!data.drafts.some((d) => d.id === A.otherDraft) && data.drafts.every((d) => d.externalPath === null && !d.versions), 'écrit hors espace non partagé ; ni chemin sur le disque, ni versions');
  ok(data.books.every((b) => b.position === null && b.lastOpenedAt === null) && data.cards.every((c) => c.fsrs.reps === 0), 'ni position de lecture, ni état de révision');
  const sharedXml = await docXml((await zw.file(`files/${A.draft}/document.docx`).async('nodebuffer')).toString('base64'));
  ok(!sharedXml.includes('SECRET PRIVÉ') && sharedXml.includes(`_mglHl_${A.h1}`), 'écrit partagé : note privée retirée, citation liée gardée');
  ok((await docXml(await readFileB64(page, A.draft, 'document.docx'))).includes('SECRET PRIVÉ'), 'A : l’écrit d’origine garde sa note privée');
  ok(!errors.some((e) => e.startsWith('pageerror')), 'A : aucune erreur de page', errors.filter((e) => e.startsWith('pageerror')));
});

// ── Paquets altérés ou piégés (fabriqués ici) ──
const tampered = {};
{
  const buf = Buffer.from(A.pkg.with, 'base64');
  const flip = Buffer.from(buf);
  const at = flip.indexOf(Buffer.from('source.epub')) + 400; // en plein dans les données compressées de l'EPUB
  flip[at] ^= 0xff;
  tampered['octet modifié dans l’archive'] = { b64: flip.toString('base64'), code: 'damaged' };
  const z1 = await unzip(A.pkg.without);
  const d1 = JSON.parse(await z1.file('data.json').async('string'));
  d1.highlights[0].text = 'Texte falsifié';
  z1.file('data.json', JSON.stringify(d1));
  tampered['data.json réécrit (empreinte fausse)'] = { b64: (await z1.generateAsync({ type: 'nodebuffer' })).toString('base64'), code: 'damaged' };
  const z2 = await unzip(A.pkg.without);
  z2.file('../../evil.txt', 'x');
  tampered['nom avec « .. »'] = { b64: (await z2.generateAsync({ type: 'nodebuffer' })).toString('base64'), code: 'unsafe' };
  const z3 = await unzip(A.pkg.without);
  z3.file('/etc/evil', 'x');
  tampered['chemin absolu'] = { b64: (await z3.generateAsync({ type: 'nodebuffer' })).toString('base64'), code: 'unsafe' };
  const z4 = await unzip(A.pkg.without);
  const m4 = JSON.parse(await z4.file('manifest.json').async('string'));
  z4.file('manifest.json', JSON.stringify({ ...m4, v: 2 }));
  tampered['version future'] = { b64: (await z4.generateAsync({ type: 'nodebuffer' })).toString('base64'), code: 'version' };
  const z5 = await unzip(A.pkg.without);
  z5.file('manifest.json', JSON.stringify({ ...m4, format: 'autre-chose' }));
  tampered['autre format'] = { b64: (await z5.generateAsync({ type: 'nodebuffer' })).toString('base64'), code: 'not-share' };
  tampered['pas une archive'] = { b64: Buffer.from('Ceci n’est pas un partage.').toString('base64'), code: 'not-share' };
  const z6 = await unzip(A.pkg.without);
  z6.file(`files/${A.draft}/extra.bin`, 'x');
  tampered['fichier en trop, absent du manifeste'] = { b64: (await z6.generateAsync({ type: 'nodebuffer' })).toString('base64'), code: 'damaged' };
}

// ═════════════════════════════════════════════════════════════
// Bibliothèque B : le destinataire (trois bibliothèques neuves)
// ═════════════════════════════════════════════════════════════
await withApp(5402, async (page, errors) => {
  await setup(page);
  // ── B1 : possède déjà le livre (autre id), a ses propres éléments, dont un espace et un concept de même nom ──
  const bEpub = await importFixture(page, 'fixtures/discours.epub');
  const B = await page.evaluate(async (bEpub) => {
    const s = () => window.__store.getState();
    const h = s().addHighlight({ bookId: bEpub, category: 'exemple', text: 'Passage de B', anchor: { kind: 'html', chapter: 0, start: 0, end: 5, prefix: '', suffix: '' }, locationLabel: '', note: 'Note de B' }).id;
    const c = s().addConcept('Raison', 'Définition de B').id;
    const ws = s().createWorkspace('Philosophie').id;
    s().addToWorkspace(ws, null, 'book', bEpub);
    s().setMap(bEpub, { bookId: bEpub, nodes: [{ id: 'b1', highlightId: h, text: '', x: 0, y: 0 }], edges: [], viewport: null });
    const { createDraft } = await import('/src/features/editor/api.ts');
    const d = await createDraft({ title: 'Mon texte', html: '<p>Texte de B.</p>' });
    return { h, c, ws, draft: d.id };
  }, bEpub);
  const snap0 = await page.evaluate(() => window.__snap());

  const pv = await previewPkg(page, A.pkg.without);
  ok(pv.ok && pv.res.title === 'Philosophie' && pv.res.counts.drafts === 1 && pv.res.counts.highlights === 3 && !pv.res.booksIncluded, 'B1 : aperçu lisible (titre, écrits, extraits, livres non joints)', pv.res?.sentence ?? pv.message);
  ok(pv.res?.booksHere === 1 && pv.res.books[0].local?.id === bEpub && pv.res.booksWithoutFile === 0 && !pv.res.alreadyReceived, 'B1 : aperçu — le livre est déjà ici (même empreinte)', pv.res?.books);
  ok(typeof pv.res?.sentence === 'string' && pv.res.sentence.includes('1 écrit') && pv.res.sentence.includes('3 extraits'), 'B1 : phrase de résumé', pv.res?.sentence);

  const r1 = await importPkg(page, A.pkg.without);
  ok(r1.ok, 'B1 : import du paquet sans livre', r1.message);
  const res1 = r1.res;
  const st1 = await page.evaluate(() => {
    const s = window.__store.getState();
    return { books: s.books, highlights: s.highlights, concepts: s.concepts, maps: s.maps, arguments: s.arguments, studies: s.studies, plans: s.plans, drafts: s.drafts, cards: s.cards, workspaces: s.workspaces, groups: s.groups, wsItems: s.wsItems, activity: s.activity.slice(0, 3) };
  });
  ok(st1.books.length === 1 && res1.created.books === 0 && res1.attachedBooks.length === 1 && res1.attachedBooks[0].id === bEpub, 'B1 : aucun doublon de livre, rattaché au livre local', res1.attachedBooks);
  const ws1 = st1.workspaces.find((w) => w.id === res1.workspace?.id);
  ok(ws1 && ws1.name === 'Philosophie (reçu)' && ws1.tint === A.tint && ws1.shareOrigin?.srcId === A.ws && ws1.shareOrigin?.shareId === `ws-${A.ws}`, 'B1 : nouvel espace « Philosophie (reçu) », même teinte, provenance notée', ws1 && [ws1.name, ws1.tint, ws1.shareOrigin]);
  const newHl = st1.highlights.filter((h) => h.shareOrigin);
  const bySrc = Object.fromEntries(newHl.map((h) => [h.shareOrigin.srcId, h]));
  ok(newHl.length === 3 && newHl.every((h) => h.bookId === bEpub) && ![A.h1, A.h2, A.h3].some((id) => st1.highlights.some((h) => h.id === id)), 'B1 : 3 extraits ajoutés, nouveaux ids, rattachés au livre de B');
  ok(bySrc[A.h1]?.note === 'Ma note sur le bon sens' && bySrc[A.h3]?.note === 'Une note de marge' && bySrc[A.h1]?.text.startsWith('Le bon sens'), 'B1 : textes et notes des extraits intacts');
  const newConcept = st1.concepts.find((c) => c.shareOrigin?.srcId === A.c);
  ok(newConcept?.name === 'Raison (reçu)' && st1.concepts.find((c) => c.id === B.c)?.definition === 'Définition de B', 'B1 : concept de même nom gardé à part (« Raison (reçu) »), celui de B intact', newConcept?.name);
  ok(bySrc[A.h1]?.conceptIds.length === 1 && bySrc[A.h1].conceptIds[0] === newConcept?.id, 'B1 : extrait → concept remappé');
  ok(newConcept?.senses[0]?.bookId === bEpub && newConcept.senses[0].highlightIds[0] === bySrc[A.h1]?.id, 'B1 : sens du concept → livre local et extrait remappé');
  const groups = st1.groups.filter((g) => g.workspaceId === ws1?.id);
  const gCours = groups.find((g) => g.name === 'Cours');
  const gSrc = groups.find((g) => g.name === 'Sources');
  ok(groups.length === 2 && gCours?.parentId === null && gSrc?.parentId === gCours?.id, 'B1 : mêmes groupes et sous-groupe');
  const items = st1.wsItems.filter((i) => i.workspaceId === ws1?.id);
  const kinds = items.map((i) => i.kind).sort().join(',');
  ok(kinds === 'argument,book,draft,map,plan,study' && items.find((i) => i.kind === 'book')?.refId === bEpub && items.find((i) => i.kind === 'book')?.groupId === gSrc?.id, 'B1 : références de l’espace (livre local dans « Sources », écrit, carte, plan, argument, fiche)', kinds);
  const board = Object.values(st1.maps).find((m) => m.shareOrigin?.srcId === A.board);
  ok(board && board.kind === 'board' && board.id !== A.board && items.some((i) => i.kind === 'map' && i.refId === board.id), 'B1 : carte libre importée sous une nouvelle clé, rangée dans l’espace');
  const bn = Object.fromEntries((board?.nodes ?? []).map((n) => [n.id, n]));
  ok(bn.n1?.highlightId === bySrc[A.h1]?.id && bn.n2?.highlightId === bySrc[A.h2]?.id && bn.n4?.conceptId === newConcept?.id && bn.n3?.text === 'Idée libre' && board.edges.length === 2 && JSON.stringify(board.bookIds) === JSON.stringify([bEpub]), 'B1 : carte libre → extraits, concept, liens et livre remappés');
  ok(st1.maps[bEpub]?.nodes.length === 1 && st1.maps[bEpub].nodes[0].highlightId === B.h, 'B1 : la carte du livre de B n’est pas remplacée');
  const asBoard = Object.values(st1.maps).find((m) => m.shareOrigin?.srcId === A.epub);
  ok(asBoard?.kind === 'board' && asBoard.title === 'Carte de « Discours de la méthode » (reçue)' && asBoard.nodes[0].highlightId === bySrc[A.h3]?.id && res1.bookMapsAsBoards === 1, 'B1 : la carte du livre reçue devient une carte libre « (reçue) »', asBoard?.title);
  const study = st1.studies.find((x) => x.shareOrigin?.srcId === A.study);
  const mv = Object.entries(st1.maps).find(([, m]) => m.shareOrigin?.srcId === A.mvKey);
  ok(study?.bookId === bEpub && mv && mv[0] === `mv-${study.id}-mv1` && mv[1].studyId === study.id && mv[1].movementId === 'mv1' && mv[1].nodes[0].highlightId === bySrc[A.h1]?.id, 'B1 : fiche-texte et carte de son mouvement remappées', mv?.[0]);
  const plan = st1.plans.find((p) => p.shareOrigin?.srcId === A.plan);
  const draft = st1.drafts.find((d) => d.shareOrigin?.srcId === A.draft);
  const pItems = plan?.parts[0].items ?? [];
  ok(pItems.length === 3 && pItems[0].ref.id === bySrc[A.h2]?.id && pItems[1].ref.id === newConcept?.id && pItems[2].ref.text === 'Transition' && plan.draftId === draft?.id, 'B1 : plan → extrait, concept, texte et écrit remappés');
  const arg = st1.arguments.find((a) => a.shareOrigin?.srcId === A.arg);
  ok(arg?.bookId === bEpub && arg.premises[0].highlightId === bySrc[A.h1]?.id, 'B1 : argument → livre et extrait remappés');
  const card = st1.cards.find((c) => c.shareOrigin?.srcId === 'cardA1');
  ok(card?.highlightId === bySrc[A.h1]?.id && card.bookId === bEpub && card.fsrs.reps === 0, 'B1 : carte de révision remappée, révision repartie de zéro');
  ok(draft && draft.title === 'Dissertation sur le bon sens' && draft.externalPath === null, 'B1 : écrit importé');
  const bDoc = await readFileB64(page, draft?.id, 'document.docx');
  const bXml = bDoc ? await docXml(bDoc) : '';
  ok(bXml.includes('Introduction : le bon sens') && bXml.includes(`_mglHl_${bySrc[A.h1]?.id}`) && !bXml.includes(`_mglHl_${A.h1}`) && !bXml.includes('SECRET'), 'B1 : .docx de l’écrit présent, citation reliée au nouvel extrait, sans note privée');
  ok(st1.activity[0]?.action === 'import' && /^Partage reçu/.test(st1.activity[0].summary), 'B1 : une entrée « import » au journal', st1.activity[0]?.summary);
  ok(sameSnap(snap0, await page.evaluate(() => window.__snap())).length === 0, 'B1 : rien d’écrasé ni modifié dans la bibliothèque de B');
  const bad1 = await page.evaluate(() => window.__checkRefs());
  ok(bad1.length === 0, 'B1 : toutes les références de la bibliothèque sont valides', bad1);

  // Second import du même paquet : nouvelles copies, sans casser.
  const snap1 = await page.evaluate(() => window.__snap());
  const pv2 = await previewPkg(page, A.pkg.without);
  ok(pv2.res?.alreadyReceived === true, 'B1 : l’aperçu signale un partage déjà reçu');
  const r2 = await importPkg(page, A.pkg.without);
  const c2 = await page.evaluate(() => window.__counts());
  ok(r2.ok && r2.res.alreadyReceived && r2.res.workspace?.name === 'Philosophie (reçu 2)' && c2.books === 1 && c2.highlights === 7 && c2.drafts === 3, 'B1 : second import = nouvelles copies (« Philosophie (reçu 2) »), toujours un seul livre', [r2.res?.workspace?.name, c2]);
  ok(r2.res?.renamed.some((x) => x.kind === 'concept' && x.to === 'Raison (reçu 2)'), 'B1 : second concept « Raison (reçu 2) »');
  ok(sameSnap(snap1, await page.evaluate(() => window.__snap())).length === 0, 'B1 : le premier import n’est pas touché par le second');
  ok((await page.evaluate(() => window.__checkRefs())).length === 0, 'B1 : références valides après le second import');

  // Paquets altérés : refusés, rien d'écrit.
  const cBefore = await page.evaluate(() => window.__counts());
  for (const [label, t] of Object.entries(tampered)) {
    const r = await importPkg(page, t.b64);
    const p = await previewPkg(page, t.b64);
    ok(!r.ok && r.code === t.code && !p.ok && p.code === t.code && /[’«]|refusé|Marginalia/.test(r.message), `refusé (${label}) : « ${r.message} »`, r.ok ? 'importé !' : r.code);
  }
  ok(JSON.stringify(await page.evaluate(() => window.__counts())) === JSON.stringify(cBefore), 'paquets refusés : la base n’a rien reçu');

  // Persistance : après rechargement, tout est encore là.
  await page.evaluate(async () => (await import('/src/lib/store.ts')).flushPendingSave());
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
  await setup(page);
  ok(JSON.stringify(await page.evaluate(() => window.__counts())) === JSON.stringify(cBefore), 'B1 : import enregistré (identique après rechargement)');

  // ── B2 : bibliothèque neuve sans le livre ──
  const ctx2 = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await p2.goto(page.url().replace(/\?.*$/, ''));
  await p2.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
  await setup(p2);
  ok((await p2.evaluate(() => window.__counts())).books === 0, 'B2 : contexte neuf, bibliothèque vide');
  const pv3 = await previewPkg(p2, A.pkg.without);
  ok(pv3.res?.booksHere === 0 && pv3.res.booksWithoutFile === 1 && pv3.res.books[0].local === null, 'B2 : aperçu — livre absent et non joint');
  const r3 = await importPkg(p2, A.pkg.without);
  const s3 = await p2.evaluate(() => ({ books: window.__store.getState().books, hls: window.__store.getState().highlights }));
  ok(r3.ok && s3.books.length === 1 && s3.books[0].missing === true && s3.books[0].sourceSha256 === EPUB_SHA && r3.res.missingBooks.length === 1, 'B2 : livre créé « sans fichier » (missing), empreinte notée', s3.books[0] && [s3.books[0].missing, s3.books[0].title]);
  ok(s3.hls.length === 3 && s3.hls.every((h) => h.bookId === s3.books[0].id && h.text.length > 10), 'B2 : extraits lisibles avec leur texte');
  ok((await p2.evaluate(() => window.__checkRefs())).length === 0, 'B2 : références valides');
  const r3b = await importPkg(p2, A.pkg.without);
  ok(r3b.ok && (await p2.evaluate(() => window.__store.getState().books.length)) === 1 && r3b.res.attachedBooks[0]?.missing === true, 'B2 : réimport sans livre → rattaché à l’entrée « sans fichier », pas de doublon');
  const r4 = await importPkg(p2, A.pkg.with);
  const s4 = await p2.evaluate(() => window.__store.getState().books);
  ok(r4.ok && s4.length === 1 && !s4[0].missing && r4.res.completedBooks.length === 1 && r4.res.created.books === 0, 'B2 : le paquet avec le livre complète l’entrée « sans fichier » (aucun doublon)', r4.message ?? s4.map((b) => b.missing));
  const f4 = await readFileB64(p2, s4[0].id, s4[0].fileName);
  ok(f4 && crypto.createHash('sha256').update(Buffer.from(f4, 'base64')).digest('hex') === EPUB_SHA, 'B2 : fichier du livre enregistré, identique à l’original');
  // Lecture : le livre s'ouvre et les extraits reçus y sont marqués.
  const hlIds = await p2.evaluate(() => window.__store.getState().highlights.map((h) => h.id));
  await p2.evaluate((id) => window.__store.getState().openBook(id), s4[0].id);
  await p2.waitForSelector('.html-doc [data-chapter]', { timeout: 30000 });
  const marked = await p2
    .waitForFunction((ids) => ids.some((id) => document.querySelector(`[data-hl-id="${id}"]`)), hlIds, { timeout: 15000 })
    .then(() => true, () => false);
  ok(marked, 'B2 : le livre complété s’ouvre et les extraits reçus y sont marqués');
  ok((await p2.evaluate(() => window.__checkRefs())).length === 0, 'B2 : références valides après complément');
  await ctx2.close();

  // ── B3 : bibliothèque neuve, paquet avec le livre, puis une carte seule (liste libre) ──
  const ctx3 = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await p3.goto(page.url().replace(/\?.*$/, ''));
  await p3.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
  await setup(p3);
  const r5 = await importPkg(p3, A.pkg.with);
  const s5 = await p3.evaluate(() => window.__store.getState().books);
  ok(r5.ok && s5.length === 1 && !s5[0].missing && r5.res.created.booksWithFile === 1 && s5[0].title === 'Discours de la méthode', 'B3 : livre joint créé avec son fichier');
  const r6 = await importPkg(p3, A.pkg.items);
  const s6 = await p3.evaluate(() => ({ books: window.__store.getState().books.length, ws: window.__store.getState().workspaces.length, maps: Object.values(window.__store.getState().maps).filter((m) => m.kind === 'board').length }));
  ok(r6.ok && s6.books === 1 && r6.res.workspace === null && r6.res.created.maps === 1 && r6.res.created.highlights === 2 && r6.res.attachedBooks.length === 1, 'B3 : liste libre (une carte) importée sans espace, rattachée au livre reçu', s6);
  ok((await p3.evaluate(() => window.__checkRefs())).length === 0, 'B3 : références valides');
  await ctx3.close();
  ok(!errors.some((e) => e.startsWith('pageerror')), 'B : aucune erreur de page', errors.filter((e) => e.startsWith('pageerror')));
});

console.log(`\n${nOk} OK, ${nKo} ÉCHEC`);
