// Partie navigateur de test-map-model.mjs (Vite + Chromium, port 5384) : actions du modèle de
// carte branchées sur le store, écrit créé, PNG, PDF, base ancienne. Lancée par test-map-model.mjs.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import JSZip from 'jszip';

const PORT = 5384;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('ok -', name);
};

const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-map-model', server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
const ev = (fn, arg) => page.evaluate(fn, arg);
const ready = () => page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });

// Rendu PDF : la fenêtre d'impression d'Electron n'existe pas ici ; on imprime le même HTML avec Chromium.
const printer = await ctx.newPage();
await page.exposeFunction('__printHtml', async (html) => {
  assert.ok(!/<script/i.test(html), 'HTML d’impression sans script');
  await printer.setContent(html, { waitUntil: 'load' });
  return (await printer.pdf({ format: 'A4', printBackground: true })).toString('base64');
});

try {
  await page.goto(`http://localhost:${PORT}/`);
  await ready();

  // ── Base ancienne (avant zones, cartes libres, versions) : rechargée telle quelle ──
  const OLD_MAP = {
    bookId: 'bD',
    nodes: [
      { id: 'T', highlightId: 'hT', text: '', x: 400, y: 200 },
      { id: 'A1', highlightId: 'hA1', text: '', x: 100, y: 420 },
      { id: 'O1', highlightId: 'hO1', text: '', x: 900, y: 200 },
      { id: 'I', highlightId: null, text: 'Idée libre', x: 1300, y: 600 },
    ],
    edges: [
      { id: 'e1', source: 'A1', target: 'T', relation: 'soutient', groupId: null },
      { id: 'e2', source: 'O1', target: 'T', relation: 'objecte' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  await ev(async (OLD_MAP) => {
    const { host } = await import('/src/lib/platform.ts');
    const s = window.__store.getState();
    const anchor = (start) => ({ kind: 'html', chapter: 0, start, end: start + 5, prefix: '', suffix: '' });
    const book = (id, title, author) => ({ id, title, author, format: 'md', fileName: 'source.md', originalName: 'x.md', size: 1, addedAt: 1, lastOpenedAt: null, progress: 0, position: null, cover: null, edition: { translator: '', place: 'Paris', publisher: 'GF Flammarion', year: '2000' } });
    const hl = (id, bookId, category, text, start, page) => ({ id, bookId, category, text, note: '', noteKind: null, conceptIds: [], anchor: anchor(start), locationLabel: 'IV', printedPage: page, createdAt: 1, updatedAt: 1 });
    const old = {
      books: [book('bD', 'Discours de la méthode', 'René Descartes'), book('bH', 'Enquête', 'David Hume')],
      highlights: [
        hl('hT', 'bD', 'these', 'Je pense, donc je suis', 300, '38'),
        hl('hA1', 'bD', 'argument', 'Je rejetai comme absolument faux tout ce en quoi je pouvais imaginer le moindre doute', 200, '37'),
        hl('hO1', 'bD', 'objection', 'Les suppositions des sceptiques', 310, '38'),
        hl('hE', 'bD', 'exemple', 'Nos sens nous trompent quelquefois', 220, '37'),
        hl('hH', 'bH', 'these', 'Le moi n’est qu’un faisceau de perceptions', 10, '343'),
      ],
      concepts: [], maps: { bD: OLD_MAP }, arguments: [], plans: [], drafts: [], cards: [], workspaces: [], groups: [], wsItems: [], bookmarks: [],
      studies: [
        { id: 'st', bookId: 'bD', title: 'Le cogito', probleme: '', these: '', enjeu: '', createdAt: 1, updatedAt: 1, movements: [
          { id: 'm1', anchor: anchor(190), startText: '', title: 'Le doute', role: '' },
          { id: 'm2', anchor: anchor(290), startText: '', title: 'Le cogito', role: '' },
        ] },
      ],
      settings: s.settings, trash: [], activity: [],
    };
    await host.saveDb(old);
  }, OLD_MAP);
  await page.reload();
  await ready();
  const after = await ev(() => {
    const s = window.__store.getState();
    return { map: s.maps.bD, versions: s.mapVersions, books: s.books.length };
  });
  ok('base ancienne : carte de livre intacte, versions vides', after.books === 2 && after.map.nodes.length === 4 && Array.isArray(after.versions) && after.versions.length === 0);
  ok('base ancienne : groupId complété, rien d’autre ajouté', after.map.edges[1].groupId === null && after.map.kind === undefined && after.map.zones === undefined);

  await ev(async () => {
    window.__A = await import('/src/features/map/model/actions.ts');
  });
  const g = await ev(async () => { const A = window.__A; const s = () => window.__store.getState();return { steps: A.guidedReadingOf('bD').map((x) => x.nodeId + ':' + x.role), gaps: A.gapsOf('bD').messages.map((m) => m.text) };});
  ok('lecture guidée depuis le store (carte ancienne)', g.steps.join() === 'T:these,A1:argument,O1:objection,I:reste', g.steps.join());
  ok('signaux depuis le store', g.gaps.includes('1 objection sans réponse') && g.gaps.includes('1 extrait catégorisé pas encore sur la carte') && g.gaps.includes('1 carte isolée (sans lien)'), g.gaps.join(' | '));

  // ── 12. Zones via le store : annulables ──
  const z = await ev(async () => { const A = window.__A; const s = () => window.__store.getState();
    const id = A.addZone('bD', ['T', 'A1'], { title: 'Cœur' });
    const n1 = s().maps.bD.zones.length;
    A.moveZoneBy('bD', id, 40, 0);
    const x1 = s().maps.bD.nodes.find((n) => n.id === 'A1').x;
    A.setZoneCollapsed('bD', id, true);
    const hidden = s().maps.bD.zones[0].hiddenNodeIds;
    A.setZoneCollapsed('bD', id, false);
    await new Promise((r) => setTimeout(r, 1700));
    A.deleteZone('bD', id);
    const n2 = (s().maps.bD.zones || []).length;
    s().undo();
    return { id, n1, x1, hidden, n2, n3: (s().maps.bD.zones || []).length };
  });
  ok('zones : créer, déplacer avec contenu, replier, retirer, ⌘Z', z.n1 === 1 && z.x1 === 140 && z.hidden.sort().join() === 'A1,T' && z.n2 === 0 && z.n3 === 1, JSON.stringify(z));

  // ── 20. Notes de lien ──
  const note = await ev(async () => { const A = window.__A; const s = () => window.__store.getState();
    await new Promise((r) => setTimeout(r, 1600));
    A.setEdgeNoteOf('bD', 'e1', 'Le doute mène au cogito');
    const n = s().maps.bD.edges.find((e) => e.id === 'e1').note;
    s().undo();
    return { n, back: s().maps.bD.edges.find((e) => e.id === 'e1').note ?? null };
  });
  ok('note de lien enregistrée puis annulée', note.n === 'Le doute mène au cogito' && note.back === null);

  // ── 13. Cartes libres : création, liste, renommage, corbeille, restauration ──
  const b = await ev(async () => { const A = window.__A; const s = () => window.__store.getState();
    const key = A.createBoard('Descartes / Hume', ['bD']);
    const ids = A.placeHighlights(key, ['hT', 'hH', 'hT']);
    A.renameMap(key, 'Le sujet : Descartes contre Hume');
    const m = s().maps[key];
    const list = A.boards().map((x) => x.id);
    const book = A.deleteMap('bD');
    const entry = A.deleteMap(key);
    const gone = !(key in s().maps);
    const trashed = A.trashedMaps().map((t) => t.title);
    const r = A.restoreMap(entry.id);
    const back = s().maps[key];
    await new Promise((r) => setTimeout(r, 100));
    return { key, ids: ids.length, title: m.title, bookIds: m.bookIds, list, book, gone, trashed, r, back: back && back.nodes.length, act: s().activity.slice(0, 6).map((a) => a.action + ':' + a.kind + ':' + a.title) };
  });
  ok('carte libre créée et listée', b.key.startsWith('board-') && b.list.includes(b.key) && b.ids === 2 && b.bookIds.sort().join() === 'bD,bH', JSON.stringify(b));
  ok('carte libre renommée', b.title === 'Le sujet : Descartes contre Hume');
  ok('carte de livre : pas de corbeille directe', b.book === null);
  ok('carte libre → corbeille → restaurée', b.gone && b.trashed.includes('Le sujet : Descartes contre Hume') && b.r.ok && b.back === 2, JSON.stringify(b.r));
  ok('journal : suppression et restauration de la carte libre', b.act.some((x) => x.startsWith('delete:map:Le sujet')) && b.act.some((x) => x.startsWith('restore:map:Le sujet')), b.act.join(' | '));

  // ── 17. Carte de mouvement ──
  const mv = await ev(async () => { const A = window.__A; const s = () => window.__store.getState();
    const k1 = A.openMovementMap('st', 'm1');
    const k2 = A.openMovementMap('st', 'm1');
    const cands = A.candidatesOf(k1).map((h) => h.id);
    A.placeHighlights(k1, cands);
    const left = A.candidatesOf(k1).length;
    const list = A.movementMaps('st');
    const bad = A.openMovementMap('st', 'nope');
    // Supprimer la fiche emporte la carte du mouvement ; la restaurer la ramène.
    const e = s().trashDelete('study', 'st');
    const gone = !(k1 in s().maps);
    s().restoreFromTrash(e.id);
    return { k1, same: k1 === k2, cands, left, list, bad, gone, back: s().maps[k1]?.nodes.length, title: s().maps[k1]?.title };
  });
  ok('carte de mouvement : idempotente, extraits du mouvement proposés', mv.same && mv.cands.join() === 'hA1,hE' && mv.left === 0 && mv.bad === null, JSON.stringify(mv));
  ok('carte de mouvement listée pour la fiche', mv.list.length === 2 && mv.list[0].key === mv.k1 && mv.list[1].key === null && mv.title === 'Le cogito — I. Le doute');
  ok('carte de mouvement suit sa fiche dans la corbeille', mv.gone && mv.back === 2);

  // ── 19. Versions ──
  const v = await ev(async () => { const A = window.__A; const s = () => window.__store.getState();
    const named = A.saveVersion('bD', 'Avant l’oral');
    const same = A.autoSnapshot('bD', 'layout'); // identique à la version nommée : rien
    A.updateMap('bD', (m) => ({ ...m, nodes: m.nodes.map((n) => ({ ...n, y: n.y + 10 })) }));
    const lay = A.beforeAutoLayout('bD');
    const dup = A.autoSnapshot('bD', 'layout');
    A.updateMap('bD', (m) => ({ ...m, nodes: m.nodes.map((n) => ({ ...n, x: n.x + 500 })) }));
    A.deleteNodes('bD', ['I', 'O1']);
    const afterDel = s().maps.bD.nodes.length;
    const reasons = A.versions('bD').map((x) => x.reason);
    const okR = A.restoreVersion(named.id);
    const restored = s().maps.bD.nodes.map((n) => n.id + '@' + n.x).join();
    // Toast « Annuler » de la restauration.
    const t = s().toasts.find((x) => x.action && x.action.label === 'Annuler');
    t.action.run();
    const undone = s().maps.bD.nodes.length;
    // ⌘Z après une nouvelle restauration.
    await new Promise((r) => setTimeout(r, 1600));
    A.restoreVersion(named.id);
    const n2 = s().maps.bD.nodes.length;
    s().undo();
    const n3 = s().maps.bD.nodes.length;
    for (let i = 0; i < 25; i++) { A.updateMap('bD', (m) => ({ ...m, nodes: m.nodes.map((n) => ({ ...n, y: n.y + 1 })) })); A.autoSnapshot('bD', 'layout'); }
    const all = A.versions('bD');
    A.renameVersion(all[0].id, 'Gardée');
    A.deleteVersion(all[1].id);
    const final = A.versions('bD');
    return { same, lay: !!lay, dup, afterDel, reasons, okR, restored, undone, n2, n3, total: all.length, named: all.filter((x) => x.name).length, final: final.length, kept: final.some((x) => x.name === 'Gardée'), viewport: s().maps.bD.viewport };
  });
  ok('versions : instantané nommé, auto avant rangement (sans doublon), avant suppression multiple', v.same === null && v.lay && v.dup === null && v.afterDel === 2 && v.reasons.join() === 'delete-many,layout,manual', JSON.stringify(v));
  ok('versions : restauration, Annuler du toast, ⌘Z', v.okR && v.restored === 'T@440,A1@140,O1@900,I@1300' && v.undone === 2 && v.n2 === 4 && v.n3 === 2, JSON.stringify(v));
  ok('versions : élagage à 20 automatiques + nommées', v.total === 21 && v.named === 1 && v.final === 20 && v.kept, JSON.stringify(v));

  // ── 16. Conversions ──
  const c = await ev(async () => { const A = window.__A; const s = () => window.__store.getState();
    A.restoreVersion(A.versions('bD').find((x) => x.name === 'Avant l’oral').id);
    const planId = A.convertToPlan('bD');
    const p = s().plans.find((x) => x.id === planId);
    const draftId = await A.convertToDraft('bD');
    const d = s().drafts.find((x) => x.id === draftId);
    return { planId, prob: p.problematique, parts: p.parts.map((x) => x.title), draftId, title: d && d.title, file: d && d.fileName, convert: A.versions('bD').filter((x) => x.reason === 'convert').length };
  });
  ok('carte → plan enregistré (format des plans)', c.prob === 'Je pense, donc je suis' && c.parts[0].startsWith('Je rejetai') && c.parts.includes('Discussion : objections et réponses'), JSON.stringify(c));
  ok('carte → écrit créé, instantané « convert »', c.title === 'Explication — Discours de la méthode' && c.convert >= 1, JSON.stringify(c));
  const b64 = await ev(async ({ id, name }) => {
    const { host } = await import('/src/lib/platform.ts');
    const buf = new Uint8Array(await host.readFile(id, name));
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, { id: c.draftId, name: c.file });
  const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
  const doc = await zip.file('word/document.xml').async('string');
  const notes = (await zip.file('word/footnotes.xml')?.async('string')) ?? '';
  ok('écrit : citation liée à l’extrait (signet _mglHl_)', doc.includes('w:name="_mglHl_hT"') && doc.includes('w:name="_mglHl_hA1"'));
  ok('écrit : référence en note de bas de page', notes.includes('René Descartes, Discours de la méthode, Paris, GF Flammarion, 2000, p. 38.'));
  ok('écrit : ordre de la lecture guidée', doc.indexOf('Je pense, donc je suis') < doc.indexOf('Je rejetai') && doc.indexOf('Je rejetai') < doc.indexOf('Les suppositions des sceptiques'));

  // ── 18. Exports : SVG, PNG ×2, PDF ──
  const ex = await ev(async () => { const A = window.__A; const s = () => window.__store.getState();
    const r = A.exportSvg('bD');
    const png = new Uint8Array(await A.exportPng('bD'));
    const dv = new DataView(png.buffer);
    const { host } = await import('/src/lib/platform.ts');
    host.printToPdf = async (html) => { const b = atob(await window.__printHtml(html)); return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer; };
    const pdf = new Uint8Array(await A.exportPdf('bD'));
    const parsed = new DOMParser().parseFromString(r.svg, 'image/svg+xml');
    return {
      w: r.width, h: r.height, counts: r.counts, xmlErr: parsed.getElementsByTagName('parsererror').length,
      pngLen: png.length, sig: Array.from(png.slice(0, 8)), pw: dv.getUint32(16), ph: dv.getUint32(20),
      pdfLen: pdf.length, pdfHead: String.fromCharCode(...pdf.slice(0, 5)),
      dark: document.documentElement.dataset.theme || '',
    };
  });
  ok('SVG depuis le store : XML valide, comptes', ex.xmlErr === 0 && ex.counts.nodes === 4 && ex.counts.edges === 2, JSON.stringify(ex.counts));
  ok('PNG : en-tête PNG, ×2', ex.pngLen > 1000 && ex.sig.join() === '137,80,78,71,13,10,26,10' && ex.pw === ex.w * 2 && ex.ph === ex.h * 2, JSON.stringify(ex));
  ok('PDF : en-tête %PDF-, taille > 0', ex.pdfLen > 1000 && ex.pdfHead === '%PDF-', JSON.stringify(ex));
  // Le PNG est clair même si l'app est en thème sombre : pixel du coin = fond papier.
  const corner = await ev(async () => { const A = window.__A; const s = () => window.__store.getState();
    const png = await A.exportPng('bD', 1);
    const img = await createImageBitmap(new Blob([png], { type: 'image/png' }));
    const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(2, 2, 1, 1).data);
  });
  ok('PNG sur fond clair (app en thème sombre)', corner[0] > 240 && corner[1] > 240 && corner[2] > 230, corner.join());

  // 404 d'une ressource : préexistant (voir test-trash.mjs).
  const real = errors.filter((e) => !/favicon|ResizeObserver|Failed to load resource: the server responded with a status of 404/.test(e));
  ok('aucune erreur navigateur (hors 404 de ressource préexistant)', real.length === 0, real.join('\n'));
} finally {
  if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + [...new Set(errors)].join('\n'));
  await browser.close();
  await server.close();
}
console.log(`\n${passed} tests navigateur réussis`);
