// Test corbeille, journal d'activité, annuler / rétablir. Port 5217.
// Lancer : timeout 170 node scripts/test-trash.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import JSZip from 'jszip';
import { importFixture, shot } from './harness.mjs';

const PORT = 5217;
const CACHE = '/tmp/vite-trash';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let passed = 0;
const ok = (name, cond, extra = '') => {
  assert.ok(cond, `ÉCHEC : ${name} ${extra}`);
  passed++;
  console.log('  ok', name);
};
const same = (name, a, b) => {
  try {
    assert.deepStrictEqual(a, b);
  } catch (e) {
    console.log(String(e.message).slice(0, 3000));
    throw new Error(`ÉCHEC : ${name} (comparaison profonde)`);
  }
  passed++;
  console.log('  ok', name);
};

async function withApp(fn, { dark = false } = {}) {
  const server = await createServer({ root: ROOT, cacheDir: CACHE, server: { port: PORT, strictPort: true }, logLevel: 'error' });
  await server.listen();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  try {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    await fn(page, errors);
  } finally {
    if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + [...new Set(errors)].join('\n'));
    await browser.close();
    await server.close();
  }
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);
const tick = (page, ms = 120) => page.waitForTimeout(ms);
/** Données suivies (tout sauf corbeille, journal, réglages). */
const snap = (page) =>
  ev(page, () => {
    const s = window.__store.getState();
    const pick = ({ books, highlights, concepts, maps, arguments: args, studies, plans, drafts, cards, workspaces, groups, wsItems }) => ({ books, highlights, concepts, maps, arguments: args, studies, plans, drafts, cards, workspaces, groups, wsItems });
    return JSON.parse(JSON.stringify(pick(s)));
  });
const fileB64 = (page, id, name) =>
  ev(
    page,
    async ({ id, name }) => {
      try {
        const m = await import('/src/lib/platform.ts');
        const buf = new Uint8Array(await m.host.readFile(id, name));
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      } catch {
        return null;
      }
    },
    { id, name },
  );

async function seed(page) {
  await ev(page, () => window.__store.getState().updateSettings({ activeWorkspaceId: null }));
  const epub = await importFixture(page, 'fixtures/discours.epub');
  const md = await importFixture(page, 'fixtures/discours.md');
  const docx = fs.readFileSync(path.join(ROOT, 'fixtures/discours.docx')).toString('base64');
  await ev(
    page,
    async ({ epub, md, docx }) => {
      const S = () => window.__store.getState();
      const m = await import('/src/lib/platform.ts');
      const bin = Uint8Array.from(atob(docx), (c) => c.charCodeAt(0));
      await m.host.storeFile('d1', 'document.docx', bin.buffer);
      const now = Date.now();
      const mk = (id, bookId, category, text, start, conceptIds = []) => ({
        id, bookId, category, text, note: '', noteKind: null, conceptIds,
        anchor: { kind: 'html', chapter: 1, start, end: start + text.length, prefix: 'av', suffix: 'ap' },
        locationLabel: 'Première partie', printedPage: '', createdAt: now, updatedAt: now,
      });
      const fsrs = { due: now, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0, last_review: null };
      const card = (id, extra) => ({ id, kind: 'libre', front: 'Q ' + id, back: 'R', highlightId: null, conceptId: null, bookId: null, suspended: false, createdAt: now, fsrs, ...extra });
      window.__store.setState({
        highlights: [
          mk('h1', epub, 'probleme', 'Le bon sens est la chose du monde la mieux partagée', 10, ['c1']),
          mk('h2', epub, 'these', 'Je pense, donc je suis', 200, ['c1', 'c2']),
          mk('h3', epub, null, 'À relire : le doute', 400),
          mk('h4', md, 'argument', 'Les sens nous trompent', 90, ['c2']),
          mk('h5', md, 'exemple', 'Le morceau de cire', 120),
        ],
        concepts: [
          { id: 'c1', name: 'Bon sens', definition: 'Faculté de bien juger', senses: [{ id: 'se1', author: 'Descartes', bookId: epub, definition: 'raison', highlightIds: ['h1', 'h4'] }], links: [{ conceptId: 'c2', kind: 'distingue', note: '' }], programme: null, createdAt: now, updatedAt: now },
          { id: 'c2', name: 'Pensée', definition: '', senses: [{ id: 'se2', author: 'Descartes', bookId: md, definition: '', highlightIds: ['h2', 'h5'] }], links: [{ conceptId: 'c1', kind: 'oppose', note: 'x' }], programme: 'notion', createdAt: now, updatedAt: now },
        ],
        arguments: [
          { id: 'a1', title: 'Cogito', bookId: epub, premises: [{ id: 'p1', text: 'Je doute', highlightId: 'h1', implicit: false }, { id: 'p2', text: 'Douter c’est penser', highlightId: 'h4', implicit: true }], conclusion: { id: 'p3', text: 'Je suis', highlightId: 'h2', implicit: false }, comment: '', createdAt: now, updatedAt: now },
        ],
        studies: [{ id: 's1', bookId: epub, title: 'Le cogito', probleme: 'P', these: 'T', enjeu: 'E', movements: [{ id: 'mv1', anchor: { kind: 'html', chapter: 1, start: 200, end: 210, prefix: '', suffix: '' }, startText: 'Je pense', title: 'M1', role: 'pose la thèse' }], createdAt: now, updatedAt: now }],
        plans: [
          {
            id: 'pl1', title: 'Peut-on douter de tout ?', sujet: 'Peut-on douter de tout ?', definitions: '', problematique: '', conclusion: '', draftId: 'd1', createdAt: now, updatedAt: now,
            parts: [
              { id: 'n1', title: 'I', note: '', items: [{ id: 'i1', ref: { kind: 'highlight', id: 'h1' } }, { id: 'i2', ref: { kind: 'text', text: 'transition' } }, { id: 'i3', ref: { kind: 'concept', id: 'c1' } }, { id: 'i4', ref: { kind: 'highlight', id: 'h4' } }], children: [{ id: 'n11', title: 'a', note: '', items: [{ id: 'i5', ref: { kind: 'highlight', id: 'h2' } }, { id: 'i6', ref: { kind: 'argument', id: 'a1' } }], children: [] }] },
            ],
          },
        ],
        drafts: [{ id: 'd1', title: 'Dissertation', fileName: 'document.docx', externalPath: null, wordCount: 10, template: 'vide', createdAt: now, updatedAt: now }],
        cards: [card('k1', { highlightId: 'h1', bookId: epub }), card('k2', { bookId: epub }), card('k3', { conceptId: 'c1' }), card('k4', { highlightId: 'h4', bookId: md }), card('k5', {})],
        maps: {
          [epub]: { bookId: epub, nodes: [{ id: 'm1', highlightId: 'h1', text: '', x: 0, y: 0 }, { id: 'm2', highlightId: 'h2', text: '', x: 300, y: 0 }, { id: 'm3', highlightId: null, text: 'Idée', x: 0, y: 200 }], edges: [{ id: 'e1', source: 'm1', target: 'm2', relation: 'soutient', groupId: null }, { id: 'e2', source: 'm3', target: 'm2', relation: 'precise', groupId: null }], viewport: { x: 0, y: 0, zoom: 1 } },
          [md]: { bookId: md, nodes: [{ id: 'm4', highlightId: 'h4', text: '', x: 0, y: 0 }, { id: 'm5', highlightId: 'h5', text: '', x: 10, y: 0 }], edges: [{ id: 'e3', source: 'm4', target: 'm5', relation: 'illustre', groupId: 'g' }], viewport: null },
        },
      });
      const ws = S().createWorkspace('Bac blanc');
      const g = S().createGroup(ws.id, null, 'Sources');
      const sub = S().createGroup(ws.id, g.id, 'Descartes');
      S().addToWorkspace(ws.id, null, 'draft', 'd1');
      S().addToWorkspace(ws.id, g.id, 'book', md);
      S().addToWorkspace(ws.id, sub.id, 'book', epub);
      S().addToWorkspace(ws.id, sub.id, 'map', epub);
      S().addToWorkspace(ws.id, g.id, 'study', 's1');
      S().addToWorkspace(ws.id, null, 'plan', 'pl1');
      S().addToWorkspace(ws.id, sub.id, 'argument', 'a1');
      const ws2 = S().createWorkspace('Lectures');
      S().addToWorkspace(ws2.id, null, 'book', epub);
    },
    { epub, md, docx },
  );
  await tick(page, 200);
  const ids = await ev(page, () => {
    const s = window.__store.getState();
    return { ws: s.workspaces[0].id, ws2: s.workspaces[1].id, g: s.groups[0].id, sub: s.groups[1].id };
  });
  return { epub, md, ...ids };
}

const trashLen = (page) => ev(page, () => window.__store.getState().trash.length);
const lastTrash = (page) => ev(page, () => window.__store.getState().trash[0].id);
const restore = (page, id) => ev(page, (id) => window.__store.getState().restoreFromTrash(id, { silent: true }), id);

async function deleteRestore(page, name, del, arg, check) {
  const before = await snap(page);
  const n0 = await trashLen(page);
  await ev(page, del, arg);
  await tick(page);
  ok(`${name} : placé dans la corbeille`, (await trashLen(page)) === n0 + 1);
  if (check) await check(await snap(page));
  const r = await restore(page, await lastTrash(page));
  ok(`${name} : restauré`, r.ok, r.message);
  await tick(page);
  same(`${name} : état identique après restauration`, await snap(page), before);
  ok(`${name} : entrée retirée de la corbeille`, (await trashLen(page)) === n0);
}

const press = async (page, keys) => {
  await page.keyboard.press(keys);
  await tick(page, 150);
};
const toasts = (page) => ev(page, () => window.__store.getState().toasts.map((t) => t.message + (t.action ? ' [' + t.action.label + ']' : '')));
const clearToasts = (page) => ev(page, () => window.__store.setState({ toasts: [] }));
const activity = (page) => ev(page, () => window.__store.getState().activity);

async function scenario(page) {
  // ── Migration d'une base sans corbeille ni journal ──
  await ev(page, async () => {
    const req = indexedDB.open('marginalia', 1);
    const db = await new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const old = { version: 2, books: [], highlights: [{ id: 'old1', bookId: 'b0', category: 'these', text: 'Ancien', note: '', anchor: { kind: 'html', chapter: 0, start: 0, end: 6, prefix: '', suffix: '' }, locationLabel: '', createdAt: 1, updatedAt: 1 }], concepts: [], maps: {}, arguments: [], studies: [], plans: [], drafts: [], cards: [], workspaces: [], groups: [], wsItems: [], settings: { theme: 'light' } };
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(old, 'db');
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  });
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready);
  const mig = await ev(page, () => {
    const s = window.__store.getState();
    return { trash: s.trash, activity: s.activity, hl: s.highlights.length };
  });
  ok('migration : base sans corbeille ni journal → collections vides', Array.isArray(mig.trash) && mig.trash.length === 0 && Array.isArray(mig.activity) && mig.hl === 1);
  await ev(page, () => window.__store.setState({ highlights: [], toasts: [] }));
  await tick(page, 600);
  const persisted = await ev(page, async () => {
    const m = await import('/src/lib/platform.ts');
    const db = await m.host.loadDb();
    return { trash: Array.isArray(db.trash), activity: Array.isArray(db.activity) };
  });
  ok('migration : trash et activity écrits dans la base', persisted.trash && persisted.activity);

  // ── Données de test ──
  const ids = await seed(page);
  const { epub, md } = ids;
  const epubFile = await ev(page, (id) => window.__store.getState().books.find((b) => b.id === id).fileName, epub);
  const epubBytes = await fileB64(page, epub, epubFile);
  ok('livre : fichier présent au départ', !!epubBytes);
  const imp = (await activity(page)).find((e) => e.action === 'import' && e.refId === epub);
  ok('journal : import consigné', !!imp && imp.summary === 'Importé depuis « discours.epub »', JSON.stringify(imp));
  const original = await snap(page);

  // 1. Livre avec extraits, carte, fiche-texte, cartes de révision, présence dans deux espaces
  await deleteRestore(page, 'livre', (id) => window.__store.getState().removeBook(id), epub, async (s) => {
    ok('livre : livre, extraits, fiche, carte, cartes de révision retirés', !s.books.some((b) => b.id === epub) && !s.highlights.some((h) => h.bookId === epub) && !s.studies.length && !s.maps[epub] && !s.cards.some((c) => c.bookId === epub || c.highlightId === 'h1'));
    ok('livre : références retirées (plan, argument, concept, espaces)', JSON.stringify(s.plans).indexOf('"h1"') < 0 && s.arguments[0].premises[0].highlightId === null && s.arguments[0].conclusion.highlightId === null && !s.concepts[0].senses[0].highlightIds.includes('h1') && !s.wsItems.some((i) => i.refId === epub || i.refId === 's1'));
    ok('livre : fichier toujours sur le disque', (await fileB64(page, epub, epubFile)) === epubBytes);
  });
  const tEntry = (await activity(page)).find((e) => e.action === 'delete' && e.kind === 'book');
  ok('journal : suppression du livre consignée avec son détail', !!tEntry && /3 extraits/.test(tEntry.summary) && /carte d’argument/.test(tEntry.summary), tEntry?.summary);

  // 2. Extrait seul (concept, argument, plan, carte d'argument + arête, carte de révision)
  await deleteRestore(page, 'extrait seul', () => window.__store.getState().removeHighlight('h4'), null, async (s) => {
    ok('extrait : nœud et arête de carte retirés, carte de révision retirée', !s.maps[md].nodes.some((n) => n.id === 'm4') && !s.maps[md].edges.length && !s.cards.some((c) => c.id === 'k4'));
  });

  // 3. Concept lié (liens, extraits, carte de révision, plan)
  await deleteRestore(page, 'concept lié', () => window.__store.getState().removeConcept('c1'), null, async (s) => {
    ok('concept : liens, mentions, carte et plan nettoyés', !s.concepts[0].links.some((l) => l.conceptId === 'c1') && !s.highlights.some((h) => h.conceptIds.includes('c1')) && !s.cards.some((c) => c.id === 'k3') && JSON.stringify(s.plans).indexOf('"c1"') < 0);
  });

  // 4. Écrit (.docx conservé et lisible)
  const docBefore = await fileB64(page, 'd1', 'document.docx');
  await deleteRestore(page, 'écrit', () => window.__store.getState().removeDraft('d1'), null, async (s) => {
    ok('écrit : plan détaché, référence d’espace retirée, .docx conservé', s.plans[0].draftId === null && !s.wsItems.some((i) => i.refId === 'd1') && (await fileB64(page, 'd1', 'document.docx')) === docBefore);
  });
  const docAfter = await fileB64(page, 'd1', 'document.docx');
  const zip = await JSZip.loadAsync(Buffer.from(docAfter, 'base64'));
  const xml = await zip.file('word/document.xml')?.async('string');
  ok('écrit : .docx toujours lisible après restauration', docAfter === docBefore && !!xml && xml.length > 200);

  // 5. Groupe d'espace (dégroupé : le contenu remonte) et suppression avec son contenu
  await deleteRestore(page, 'groupe (contenu remonté)', (g) => window.__store.getState().removeGroup(g), ids.g, async (s) => {
    ok('groupe : sous-groupe et éléments remontés', s.groups.find((x) => x.id === ids.sub).parentId === null && !s.wsItems.some((i) => i.groupId === ids.g));
  });
  await deleteRestore(page, 'groupe et son contenu', async (g) => (await import('/src/features/workspaces/wsModel.ts')).deleteGroupCascade(g), ids.g, async (s) => {
    ok('groupe : sous-groupes et références retirés', !s.groups.length || !s.groups.some((x) => x.id === ids.g || x.id === ids.sub));
  });
  // 6. Espace, argument, fiche-texte, plan, carte de révision (remove générique)
  await deleteRestore(page, 'espace', (w) => window.__store.getState().removeWorkspace(w), ids.ws);
  await deleteRestore(page, 'argument', () => window.__store.getState().remove('arguments', 'a1'), null);
  await deleteRestore(page, 'fiche-texte', () => window.__store.getState().remove('studies', 's1'), null);
  await deleteRestore(page, 'plan', () => window.__store.getState().remove('plans', 'pl1'), null);
  await deleteRestore(page, 'carte de révision', () => window.__store.getState().remove('cards', 'k5'), null);

  // 7. Ordre des restaurations : extrait puis son livre
  await ev(page, () => window.__store.getState().removeHighlight('h1'));
  const eHl = await lastTrash(page);
  await ev(page, (id) => window.__store.getState().removeBook(id), epub);
  const eBook = await lastTrash(page);
  const refused = await restore(page, eHl);
  ok('dépendance : extrait d’un livre en corbeille refusé, message clair', !refused.ok && /Restaurez d’abord le livre « Discours de la méthode »/.test(refused.message), refused.message);
  ok('dépendance : refus sans effet', (await trashLen(page)) === 2);
  await restore(page, eBook);
  await restore(page, eHl);
  same('dépendance : livre puis extrait restaurés → état d’origine', await snap(page), original);

  // 8. Croisement : livre en corbeille, puis concept ; restauration dans l'autre ordre
  await ev(page, (id) => window.__store.getState().removeBook(id), epub);
  const e1 = await lastTrash(page);
  await ev(page, () => window.__store.getState().removeConcept('c2'));
  const e2 = await lastTrash(page);
  await restore(page, e1);
  const mid = await snap(page);
  ok('croisement : le livre revient sans référence au concept encore en corbeille', !mid.highlights.some((h) => h.conceptIds.includes('c2')) && !mid.concepts[0].links.some((l) => l.conceptId === 'c2'));
  await restore(page, e2);
  same('croisement : concept restauré ensuite → état d’origine', await snap(page), original);

  // 9. Toast « Annuler »
  await clearToasts(page);
  await ev(page, () => window.__store.getState().removeHighlight('h2'));
  const t1 = await toasts(page);
  ok('toast : « Extrait placé dans la corbeille » avec Annuler', t1.includes('Extrait placé dans la corbeille [Annuler]'), JSON.stringify(t1));
  await ev(page, () => window.__store.getState().toasts.find((t) => t.action)?.action.run());
  await tick(page);
  same('toast : Annuler remet tout en place', await snap(page), original);
  // les modules qui annoncent « … supprimé » ne doublent pas le toast de la corbeille
  await clearToasts(page);
  await ev(page, () => {
    const s = window.__store.getState();
    s.remove('cards', 'k5');
    s.toast('Carte supprimée');
  });
  ok('toast : pas de doublon « Carte supprimée »', (await toasts(page)).length === 1, JSON.stringify(await toasts(page)));
  await restore(page, await lastTrash(page));

  // 10. ⌘Z / ⇧⌘Z
  await ev(page, () => window.__store.getState().navigate({ name: 'home' }));
  await tick(page, 300);
  await page.mouse.click(700, 40);
  await clearToasts(page);
  await ev(page, () => window.__store.getState().removeConcept('c2'));
  await tick(page);
  await press(page, 'Meta+z');
  same('⌘Z : la suppression du concept est annulée', await snap(page), original);
  ok('⌘Z : toast « Annulé : suppression de « Pensée » »', (await toasts(page)).some((t) => t.startsWith('Annulé : suppression de « Pensée »')), JSON.stringify(await toasts(page)));
  ok('⌘Z : le toast « placé dans la corbeille · Annuler », devenu caduc, est retiré', !(await toasts(page)).some((t) => /placé dans la corbeille/.test(t)), JSON.stringify(await toasts(page)));
  ok('⌘Z : l’entrée de corbeille disparaît aussi', !(await ev(page, () => window.__store.getState().trash.some((t) => t.refId === 'c2'))));
  await press(page, 'Meta+Shift+z');
  ok('⇧⌘Z : rétablit la suppression', !(await ev(page, () => window.__store.getState().concepts.some((c) => c.id === 'c2'))) && (await ev(page, () => window.__store.getState().trash.some((t) => t.refId === 'c2'))));
  await press(page, 'Meta+z');
  same('⌘Z à nouveau : état d’origine', await snap(page), original);
  // modification simple
  await ev(page, () => window.__store.getState().setCategoryOf('h2', 'argument'));
  await tick(page);
  await press(page, 'Meta+z');
  ok('⌘Z : changement de catégorie annulé', (await ev(page, () => window.__store.getState().highlights.find((h) => h.id === 'h2').category)) === 'these');
  // un module qui gère lui-même ⌘Z (séance de révision) garde la main, même écouté après l'app
  await ev(page, () => window.__store.getState().setCategoryOf('h2', 'objection'));
  await tick(page);
  await ev(page, () => {
    window.__ownZ = (e) => (e.metaKey && e.key.toLowerCase() === 'z' ? e.preventDefault() : null);
    window.addEventListener('keydown', window.__ownZ);
  });
  await press(page, 'Meta+z');
  ok('⌘Z géré par un module (preventDefault) : pas d’annulation globale', (await ev(page, () => window.__store.getState().highlights.find((h) => h.id === 'h2').category)) === 'objection');
  await ev(page, () => window.removeEventListener('keydown', window.__ownZ));
  await press(page, 'Meta+z');
  ok('⌘Z ensuite : annulé normalement', (await ev(page, () => window.__store.getState().highlights.find((h) => h.id === 'h2').category)) === 'these');
  // dans un champ de saisie : ⌘Z reste au champ
  await ev(page, () => window.__store.getState().navigate({ name: 'trash' }));
  await ev(page, () => window.__store.getState().removeHighlight('h3'));
  await page.waitForSelector('.tr-search input');
  await page.fill('.tr-search input', 'abc');
  await page.focus('.tr-search input');
  await press(page, 'Meta+z');
  ok('⌘Z dans un champ : aucune annulation globale', !(await ev(page, () => window.__store.getState().highlights.some((h) => h.id === 'h3'))));
  await page.fill('.tr-search input', '');
  await restore(page, await lastTrash(page));
  same('retour à l’état d’origine', await snap(page), original);

  // 11. Journal
  await ev(page, () => window.__store.setState({ activity: [] }));
  await ev(page, (epub) => {
    const s = window.__store.getState();
    s.addHighlight({ bookId: epub, category: 'these', text: 'Nouvel extrait de test', anchor: { kind: 'html', chapter: 2, start: 5, end: 27, prefix: '', suffix: '' }, locationLabel: 'Seconde partie' });
  }, epub);
  await tick(page);
  const hNew = await ev(page, () => window.__store.getState().highlights.find((h) => h.text === 'Nouvel extrait de test').id);
  await ev(page, (id) => window.__store.getState().setCategoryOf(id, 'argument'), hNew);
  await tick(page);
  for (const t of ['L', 'La c', 'La certitude', 'La certitude vient', 'La certitude vient du doute.']) {
    await ev(page, ({ id, t }) => window.__store.getState().updateHighlight(id, { note: t }), { id: hNew, t });
    await tick(page, 60);
  }
  for (let k = 0; k < 3; k++)
    await ev(page, ({ md, k }) => window.__store.getState().addHighlight({ bookId: md, category: 'exemple', text: 'Exemple ' + k, anchor: { kind: 'html', chapter: 1, start: 500 + k * 20, end: 510 + k * 20, prefix: '', suffix: '' }, locationLabel: '' }), { md, k });
  await tick(page);
  let log = await activity(page);
  const cat = log.find((e) => e.action === 'update' && /Catégorie/.test(e.summary));
  ok('journal : « Catégorie : Thèse → Argument »', cat && cat.summary === 'Catégorie : Thèse → Argument' && cat.kind === 'highlight' && cat.bookId === epub, JSON.stringify(cat?.summary));
  const notes = log.filter((e) => e.action === 'update' && /Note/.test(e.summary));
  ok('journal : frappe d’une note regroupée en une entrée', notes.length === 1 && notes[0].summary === 'Note ajoutée', JSON.stringify(notes.map((n) => n.summary)));
  const three = log.find((e) => e.action === 'create' && e.bookId === md);
  ok('journal : « 3 extraits ajoutés »', three && three.summary === '3 extraits ajoutés' && three.refIds.length === 3, JSON.stringify(three));
  const created = log.find((e) => e.action === 'create' && e.refId === hNew);
  ok('journal : création de l’extrait (titre lisible)', created && created.title === 'Nouvel extrait de test' && /Extrait ajouté \(Thèse\)/.test(created.summary), JSON.stringify(created));
  // revenir à l'état d'avant (catégorie) même après la note
  const rv = await ev(page, (id) => window.__store.getState().revertActivity(id), cat.id);
  await tick(page);
  const hNow = await ev(page, (id) => window.__store.getState().highlights.find((h) => h.id === id), hNew);
  ok('journal : « revenir à l’état d’avant » sur la catégorie (la note est conservée)', rv.ok && hNow.category === 'these' && hNow.note === 'La certitude vient du doute.', JSON.stringify(rv));
  log = await activity(page);
  ok('journal : le retour en arrière est consigné', log[0].action === 'revert' && /Catégorie/.test(log[0].summary), log[0].summary);
  // revenir avant une suppression = restaurer
  await ev(page, (id) => window.__store.getState().removeHighlight(id), hNew);
  await tick(page);
  log = await activity(page);
  const del = log.find((e) => e.action === 'delete' && e.refId === hNew);
  ok('journal : suppression avec lien vers la corbeille', del && !!del.trashId);
  await ev(page, (id) => window.__store.getState().revertActivity(id), del.id);
  await tick(page);
  ok('journal : « revenir à l’état d’avant » une suppression la restaure', await ev(page, (id) => window.__store.getState().highlights.some((h) => h.id === id), hNew));
  // revenir avant une création = la mettre à la corbeille
  await ev(page, (id) => window.__store.getState().revertActivity(id), three.id);
  await tick(page);
  ok('journal : défaire « 3 extraits ajoutés » les met à la corbeille', (await ev(page, (md) => window.__store.getState().highlights.filter((h) => h.bookId === md && /^Exemple/.test(h.text)).length, md)) === 0 && (await ev(page, () => window.__store.getState().trash.filter((t) => /^Exemple/.test(t.title)).length)) === 3);
  // export consigné
  await ev(page, () => window.__store.getState().toast('Notes exportées', 'success'));
  await tick(page);
  ok('journal : export consigné', (await activity(page)).some((e) => e.action === 'export' && e.summary === 'Notes exportées'));
  // clic sur une entrée → ouvre l'objet
  await ev(page, () => window.__store.getState().navigate({ name: 'history' }));
  await page.waitForSelector('.hi-item');
  await page.locator('.hi-item[data-kind="concept"] .hi-title, .hi-item .hi-title').first();
  // plafonnement
  const capped = await ev(page, async () => {
    const m = await import('/src/features/history/describe.ts');
    const now = Date.now();
    const many = Array.from({ length: 5200 }, (_, i) => ({ id: 'x' + i, at: now - i * 1000, startedAt: now - i * 1000, action: 'update', kind: 'highlight', refId: 'r', bookId: null, title: 't', summary: 's', changes: [{ col: 'highlights', id: 'r', before: {}, after: {} }] }));
    many.push({ id: 'old', at: now - 100 * 86400000, startedAt: 0, action: 'update', kind: 'book', refId: null, bookId: null, title: 'vieux', summary: '' });
    const out = m.pruneActivity(many, now);
    return { n: out.length, withChanges: out.filter((e) => e.changes).length, old: out.some((e) => e.id === 'old') };
  });
  ok('journal : plafonné (5 000 entrées, 90 jours, changements gardés sur les 300 dernières)', capped.n === 5000 && capped.withChanges === 300 && !capped.old, JSON.stringify(capped));

  // 12. Vider la corbeille → fichiers supprimés
  await ev(page, () => window.__store.setState({ trash: [] }));
  await ev(page, (md) => window.__store.getState().removeBook(md), md);
  await ev(page, () => window.__store.getState().removeDraft('d1'));
  const mdFile = await ev(page, (md) => window.__store.getState().trash.find((t) => t.refId === md).files[0].fileName, md);
  ok('vider : fichiers encore présents avant le vidage', !!(await fileB64(page, md, mdFile)) && !!(await fileB64(page, 'd1', 'document.docx')));
  const nPurged = await ev(page, () => window.__store.getState().purgeTrash());
  ok('vider : corbeille vide, fichiers du livre et du .docx supprimés', nPurged === 2 && (await trashLen(page)) === 0 && !(await fileB64(page, md, mdFile)) && !(await fileB64(page, 'd1', 'document.docx')));
  ok('vider : consigné au journal', (await activity(page))[0].action === 'purge' && (await activity(page))[0].summary === 'Corbeille vidée');
  ok('vider : plus rien à annuler qui ferait revenir un élément effacé', !(await ev(page, () => window.__store.getState().undo())) && !(await ev(page, () => window.__store.getState().books.some((b) => b.title === 'discours'))));

  // 13. Expiration : 30 jours (horloge simulée)
  await ev(page, (id) => window.__store.getState().removeBook(id), epub);
  await ev(page, () => {
    window.__realNow = Date.now;
    const real = window.__realNow;
    window.__shift = (d) => (Date.now = () => real() + d * 86400000);
  });
  await ev(page, () => window.__shift(29));
  ok('expiration : à 29 jours, rien n’est effacé', (await ev(page, () => window.__store.getState().purgeExpiredTrash())) === 0 && !!(await fileB64(page, epub, epubFile)));
  await ev(page, () => window.__shift(31));
  ok('expiration : à 31 jours, l’élément et son fichier sont effacés', (await ev(page, () => window.__store.getState().purgeExpiredTrash())) === 1 && (await trashLen(page)) === 0 && !(await fileB64(page, epub, epubFile)));
  await ev(page, () => (Date.now = window.__realNow));
  // au démarrage
  const pdf = await importFixture(page, 'fixtures/discours.pdf');
  const pdfFile = await ev(page, (id) => window.__store.getState().books.find((b) => b.id === id).fileName, pdf);
  await ev(page, (id) => window.__store.getState().removeBook(id), pdf);
  await ev(page, () => window.__store.setState((s) => ({ trash: s.trash.map((t) => ({ ...t, deletedAt: Date.now() - 31 * 86400000 })) })));
  await tick(page, 700);
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready);
  let gone = false;
  for (let k = 0; k < 40 && !gone; k++) {
    await tick(page, 150);
    gone = (await trashLen(page)) === 0 && !(await fileB64(page, pdf, pdfFile));
  }
  ok('expiration : purge au démarrage (entrée et fichier)', gone);
  ok('expiration : purge consignée au journal', (await activity(page)).some((e) => e.action === 'purge' && /30 jours/.test(e.summary)));
}

async function screens(page, tag) {
  // Base propre : les captures montrent un usage réaliste, pas les restes du scénario.
  await ev(page, () => window.__store.setState({ books: [], highlights: [], concepts: [], maps: {}, arguments: [], studies: [], plans: [], drafts: [], cards: [], workspaces: [], groups: [], wsItems: [], trash: [], activity: [], toasts: [] }));
  await tick(page, 100);
  await ev(page, () => window.__store.setState({ activity: [] }));
  const ids = await seed(page);
  await ev(page, (ids) => {
    const s = window.__store.getState();
    s.removeHighlight('h4');
    s.removeConcept('c2');
    s.remove('plans', 'pl1');
    s.removeBook(ids.epub);
    s.removeGroup(ids.g);
    s.setCategoryOf('h5', 'objection');
    s.updateHighlight('h5', { note: 'Le corps est mieux connu par l’esprit' });
    s.setState?.({});
  }, ids);
  await ev(page, () => window.__store.setState((s) => ({ trash: s.trash.map((t, i) => (i === s.trash.length - 1 ? { ...t, deletedAt: Date.now() - 28.2 * 86400000 } : i === 2 ? { ...t, deletedAt: Date.now() - 86400000 * 1.2 } : t)), toasts: [] })));
  await ev(page, () => window.__store.getState().navigate({ name: 'trash' }));
  await page.waitForSelector('.tr-row');
  await tick(page, 700);
  await shot(page, `shots/trash/corbeille-${tag}.png`);
  await page.locator('.tr-by button', { hasText: 'Par type' }).click();
  await tick(page, 400);
  await shot(page, `shots/trash/corbeille-par-type-${tag}.png`);
  await page.locator('.tr-by button', { hasText: 'Par date' }).click();
  await page.click('.tr-empty-btn');
  await tick(page, 300);
  await shot(page, `shots/trash/vider-${tag}.png`);
  await page.keyboard.press('Escape');
  await page.locator('.tr-row .tr-del').first().click();
  await tick(page, 250);
  await shot(page, `shots/trash/supprimer-${tag}.png`);
  ok(`corbeille (${tag}) : confirmation maison en ligne`, (await page.locator('.tr-confirm-q').textContent()) === 'Supprimer définitivement ?');
  await page.locator('.tr-row .btn-ghost', { hasText: 'Garder' }).click();
  await ev(page, () => window.__store.getState().navigate({ name: 'history' }));
  await page.waitForSelector('.hi-item');
  await tick(page, 700);
  await page.locator('.hi-item').nth(1).hover();
  await shot(page, `shots/trash/historique-${tag}.png`);
  await ev(page, () => window.__store.getState().navigate({ name: 'extracts' }));
  await tick(page, 400);
  await ev(page, () => window.__store.getState().removeHighlight('h5'));
  await tick(page, 300);
  await shot(page, `shots/trash/toast-annuler-${tag}.png`);
  await page.mouse.click(700, 40);
  await press(page, 'Meta+z');
  await tick(page, 200);
  await shot(page, `shots/trash/toast-annule-${tag}.png`);
  await ev(page, () => window.__store.setState({ trash: [], activity: [] }));
  await ev(page, () => window.__store.getState().navigate({ name: 'trash' }));
  await tick(page, 500);
  await shot(page, `shots/trash/corbeille-vide-${tag}.png`);
  await ev(page, () => window.__store.getState().navigate({ name: 'history' }));
  await tick(page, 500);
  await shot(page, `shots/trash/historique-vide-${tag}.png`);
}

const real = (errors) => errors.filter((e) => !/Failed to load resource: the server responded with a status of 404/.test(e));

async function main() {
  fs.rmSync(CACHE, { recursive: true, force: true });
  await withApp(async (page, errors) => {
    await scenario(page);
    await screens(page, 'clair');
    ok('aucune erreur navigateur (clair, hors 404 de ressource préexistant)', !real(errors).length, real(errors).join('\n'));
  });
  await withApp(
    async (page, errors) => {
      await screens(page, 'sombre');
      ok('aucune erreur navigateur (sombre, hors 404 de ressource préexistant)', !real(errors).length, real(errors).join('\n'));
    },
    { dark: true },
  );
}

main()
  .then(() => console.log(`\n${passed} vérifications réussies`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
