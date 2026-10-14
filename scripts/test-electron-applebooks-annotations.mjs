// Synchro des annotations de Livres (surlignages, notes, signets, position) — app empaquetée.
// HOME temporaire : faux dossier iCloud de Livres + fausses bases AEAnnotation / BKLibrary
// créées avec le CLI sqlite3 selon le schéma de Livres. Lancer (Linux, Xvfb sur :99) :
//   DISPLAY=:99 node scripts/test-electron-applebooks-annotations.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APP_DIR = path.join(ROOT, 'release/Marginalia-darwin-arm64/Marginalia.app/Contents/Resources/app');
const OUT = path.join(ROOT, 'shots/applebooks-annotations');
fs.mkdirSync(OUT, { recursive: true });
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-livres-ann-'));
const BOOKS = path.join(HOME, 'Library/Mobile Documents/iCloud~com~apple~iBooks/Documents');
const DOCS = path.join(HOME, 'Library/Containers/com.apple.iBooksX/Data/Documents');
const AE = path.join(DOCS, 'AEAnnotation/AEAnnotation_v10312011_1727_local.sqlite');
const BK = path.join(DOCS, 'BKLibrary/BKLibrary-1-091020131601.sqlite');
fs.mkdirSync(BOOKS, { recursive: true });
fs.mkdirSync(path.dirname(AE), { recursive: true });
fs.mkdirSync(path.dirname(BK), { recursive: true });
const EPUB = path.join(ROOT, 'fixtures/discours.epub');
const pkg = (name) => {
  const d = path.join(BOOKS, name);
  fs.mkdirSync(d);
  execFileSync('unzip', ['-q', EPUB, '-d', d]);
  return d;
};
const DISC = pkg('Discours paquet.epub');

let failed = 0;
const ok = (c, m, d = '') => {
  if (!c) failed++;
  console.log(`${c ? 'OK   ' : 'ÉCHEC'} ${m}${d !== '' ? ' — ' + (typeof d === 'string' ? d : JSON.stringify(d)) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('capture:', path.relative(ROOT, path.join(OUT, name)));
};

// ── CFI fabriqués à partir du vrai contenu ──
const xhtml = (f) => execFileSync('unzip', ['-p', EPUB, `EPUB/text/${f}`]).toString('utf8');
const paraText = (f, start) => {
  const m = [...xhtml(f).matchAll(/<p>([\s\S]*?)<\/p>/g)].map((x) => x[1]).find((t) => t.startsWith(start));
  if (!m) throw new Error('paragraphe introuvable : ' + start);
  return m;
};
const SPINE = { 'ch001.xhtml': '/6/8[ch001_xhtml]', 'ch002.xhtml': '/6/10[ch002_xhtml]', 'ch003.xhtml': '/6/12[ch003_xhtml]' };
/** Plage CFI (forme de Livres : chemin commun + /1:a,/1:b) pour `needle` dans le paragraphe. */
const cfiRange = (f, elPath, paraStart, needle) => {
  const t = paraText(f, paraStart);
  const a = t.indexOf(needle);
  if (a < 0) throw new Error('passage introuvable : ' + needle);
  return `epubcfi(${SPINE[f]}!${elPath},/1:${a},/1:${a + needle.length})`;
};
const cfiPoint = (f, elPath) => `epubcfi(${SPINE[f]}!${elPath}/1:0)`;

// ── Bases de Livres ──
const appleS = (ms) => ms / 1000 - 978307200;
const T0 = Date.now() - 3600_000; // annotations créées il y a une heure
const sq = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const sqlite = (db, sql) => execFileSync('sqlite3', [db, sql]);
sqlite(
  AE,
  `PRAGMA journal_mode=WAL;
   CREATE TABLE ZAEANNOTATION (Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, Z_OPT INTEGER, ZANNOTATIONDELETED INTEGER, ZANNOTATIONISUNDERLINE INTEGER, ZANNOTATIONSTYLE INTEGER, ZANNOTATIONTYPE INTEGER, ZPLLOCATIONRANGEEND INTEGER, ZPLLOCATIONRANGESTART INTEGER, ZANNOTATIONCREATIONDATE TIMESTAMP, ZANNOTATIONMODIFICATIONDATE TIMESTAMP, ZANNOTATIONASSETID VARCHAR, ZANNOTATIONLOCATION VARCHAR, ZANNOTATIONNOTE VARCHAR, ZANNOTATIONREPRESENTATIVETEXT VARCHAR, ZANNOTATIONSELECTEDTEXT VARCHAR, ZANNOTATIONUUID VARCHAR, ZFUTUREPROOFING1 VARCHAR);`,
);
sqlite(
  BK,
  `CREATE TABLE ZBKLIBRARYASSET (Z_PK INTEGER PRIMARY KEY, ZASSETID VARCHAR, ZTITLE VARCHAR, ZAUTHOR VARCHAR, ZPATH VARCHAR, ZREADINGPROGRESS FLOAT, ZLASTOPENDATE TIMESTAMP, ZISPROTECTED INTEGER, ZSORTTITLE VARCHAR);`,
);
const asset = (id, title, author, p, prot, progress, lastOpen) =>
  sqlite(BK, `INSERT INTO ZBKLIBRARYASSET (ZASSETID,ZTITLE,ZAUTHOR,ZPATH,ZREADINGPROGRESS,ZLASTOPENDATE,ZISPROTECTED) VALUES (${sq(id)},${sq(title)},${sq(author)},${sq(p)},${progress},${lastOpen == null ? 'NULL' : appleS(lastOpen)},${prot});`);
asset('ASSET-DISC', 'Discours de la méthode', 'René Descartes', DISC, 0, 0.82, T0);
asset('ASSET-PROT', 'Discours protégé', 'René Descartes', path.join(BOOKS, 'Protégé.epub'), 1, 0.5, T0);
asset('ASSET-UNK', 'Livre inconnu', 'Personne', path.join(BOOKS, 'Inconnu.epub'), 0, 0.3, T0);
const ann = (o) =>
  sqlite(
    AE,
    `INSERT INTO ZAEANNOTATION (ZANNOTATIONASSETID,ZANNOTATIONUUID,ZANNOTATIONTYPE,ZANNOTATIONSTYLE,ZANNOTATIONISUNDERLINE,ZANNOTATIONDELETED,ZANNOTATIONLOCATION,ZANNOTATIONSELECTEDTEXT,ZANNOTATIONNOTE,ZANNOTATIONCREATIONDATE,ZANNOTATIONMODIFICATIONDATE) VALUES (${sq(o.asset ?? 'ASSET-DISC')},${sq(o.uuid)},${o.type ?? 2},${o.style ?? 3},${o.underline ? 1 : 0},${o.deleted ? 1 : 0},${sq(o.cfi)},${sq(o.text ?? null)},${sq(o.note ?? null)},${appleS(o.created ?? T0)},${appleS(o.modified ?? T0)});`,
  );
const upd = (uuid, set, modified) => sqlite(AE, `UPDATE ZAEANNOTATION SET ${set}, ZANNOTATIONMODIFICATIONDATE=${appleS(modified)} WHERE ZANNOTATIONUUID=${sq(uuid)};`);

const P_SEC = 'Le second, de diviser chacune des difficultés';
const P_BON = 'Le bon sens est la chose du monde la mieux partagée';
const P_DOUTE = 'le doute lui-même suppose un langage';
const P_CAR = 'Car je me trouvais embarrassé de tant de doutes';
const P_JE = 'Je ne sais si je dois vous entretenir';
const P_DIV = 'mais seulement de ce que nous conduisons nos pensées';
const H = {
  sec: { uuid: 'H-SEC', style: 3, text: P_SEC, note: 'Diviser pour résoudre', cfi: cfiRange('ch002.xhtml', '/4/2[seconde-partie]/8[les-quatre-préceptes]/6', 'Le second', P_SEC) },
  bon: { uuid: 'H-BON', style: 1, text: P_BON, cfi: cfiRange('ch001.xhtml', '/4/2[première-partie]/4', 'Le bon sens', P_BON) },
  doute: { uuid: 'H-DOUTE', style: 2, text: P_DOUTE, cfi: cfiRange('ch003.xhtml', '/4/2/8/2', 'On objectera', P_DOUTE) },
  car: { uuid: 'H-CAR', style: 4, text: P_CAR, note: 'Le doute naît des études', cfi: cfiRange('ch001.xhtml', '/4/2/10/6', 'Car je me trouvais', P_CAR) },
  je: { uuid: 'H-JE', style: 0, underline: true, text: P_JE, cfi: cfiRange('ch003.xhtml', '/4/2/4', 'Je ne sais si', P_JE) },
  // CFI décalé (autre édition) mais texte juste : retrouvé par le texte dans le chapitre.
  div: { uuid: 'H-DIV', style: 5, text: P_DIV, cfi: 'epubcfi(/6/8[ch001_xhtml]!/4/2/6,/1:0,/1:30)' },
  // Introuvable : jamais ancré au hasard.
  ghost: { uuid: 'H-GHOST', style: 3, text: 'Phrase qui n’existe nulle part dans ce livre, vraiment nulle part.', cfi: 'epubcfi(/6/10[ch002_xhtml]!/4/2/4,/1:0,/1:40)' },
  // Supprimé dans Livres : ignoré.
  dead: { uuid: 'H-DEAD', style: 3, deleted: true, text: 'Le troisième, de conduire par ordre mes pensées', cfi: cfiRange('ch002.xhtml', '/4/2/8/8', 'Le troisième', 'Le troisième, de conduire par ordre mes pensées') },
};
for (const h of Object.values(H)) ann(h);
ann({ uuid: 'B-1', type: 1, style: 0, cfi: cfiPoint('ch002.xhtml', '/4/2/8/4') });
const POS_DATE = Date.now() - 600_000; // lu dans Livres il y a 10 minutes
ann({ uuid: 'P-1', type: 3, style: 0, cfi: cfiPoint('ch003.xhtml', '/4/2/10'), modified: POS_DATE });
// Livre protégé (présent sous le même nom dans Marginalia) et livre absent de Marginalia : ignorés.
ann({ asset: 'ASSET-PROT', uuid: 'H-PROT', style: 3, text: P_BON, cfi: cfiRange('ch001.xhtml', '/4/2/4', 'Le bon sens', P_BON) });
ann({ asset: 'ASSET-UNK', uuid: 'H-UNK', style: 3, text: P_BON, cfi: cfiRange('ch001.xhtml', '/4/2/4', 'Le bon sens', P_BON) });

const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', APP_DIR],
  // Livres : macOS uniquement ; drapeau de test explicite pour l'exercer sous Linux.
  env: { ...process.env, MARGINALIA_E2E: '1', HOME, XDG_CONFIG_HOME: path.join(HOME, '.config'), VITE_DEV_SERVER_URL: '', MARGINALIA_APPLE_BOOKS: '1' },
  timeout: 60000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => window.__store?.getState().ready, null, { timeout: 60000 });
  const st = (fn, arg) => page.evaluate(fn, arg);

  // Lecture brute par le processus principal
  const raw = await st(() => window.marginalia.appleBooksAnnotations());
  const disc = raw.books.find((b) => b.assetId === 'ASSET-DISC');
  ok(raw.status === 'ok' && raw.books.length === 3, 'lecture des bases (copie, sqlite3 -readonly -json)', `${raw.status}, ${raw.books.length} livres`);
  ok(disc?.fileName === 'Discours paquet.epub' && disc.annotations.length === 10 && Math.abs(disc.lastOpened - T0) < 2000, 'livre Livres : nom de fichier, annotations, date', `${disc?.fileName}, ${disc?.annotations.length}`);
  ok(disc?.annotations.find((a) => a.uuid === 'H-JE')?.underline && disc.annotations.find((a) => a.uuid === 'B-1')?.type === 'bookmark' && disc.annotations.find((a) => a.uuid === 'P-1')?.type === 'position', 'types normalisés (surlignage, signet, position, souligné)');
  ok(raw.books.find((b) => b.assetId === 'ASSET-PROT')?.protected === true, 'livre protégé repéré');

  // Livre « protégé » présent dans Marginalia sous le même nom (copie sans DRM) : ses annotations sont ignorées.
  const b64 = fs.readFileSync(EPUB).toString('base64');
  await st(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await window.__store.getState().importFiles([{ name: 'Protégé.epub', data: bin.buffer }], { toWorkspace: false });
  }, b64);

  // Import du livre par la fenêtre « Depuis Livres » : la synchro (livres + annotations) s'active.
  await page.locator('.nav-item', { hasText: 'Bibliothèque' }).first().click();
  await page.getByRole('button', { name: /Récupérer mes livres|Depuis Livres/ }).first().click();
  await page.waitForSelector('.lib-books-list li');
  await page.waitForSelector('[data-testid="livres-sync-now"]');
  ok((await page.locator('[data-testid="livres-color-jaune"]').inputValue()) === 'these' && (await page.locator('[data-testid="livres-color-souligne"]').inputValue()) === 'probleme', 'correspondance par défaut (jaune → Thèse, souligné → Problème)');
  await shot(page, '1-fenetre-livres.png');
  await page.getByRole('button', { name: /Importer 1 livre/ }).click();
  await page.waitForFunction(() => window.__store.getState().highlights.filter((h) => h.source?.app === 'livres').length >= 6, null, { timeout: 60000 }).catch(() => {});
  await sleep(1500);

  const state = () =>
    st(() => {
      const s = window.__store.getState();
      const book = s.books.find((b) => b.originalName === 'Discours paquet.epub');
      const prot = s.books.find((b) => b.originalName === 'Protégé.epub');
      return {
        bookId: book?.id,
        book: book && { position: book.position, progress: book.progress, lastOpenedAt: book.lastOpenedAt },
        hl: s.highlights.filter((h) => h.bookId === book?.id).map((h) => ({ id: h.id, uuid: h.source?.uuid ?? null, category: h.category, note: h.note, text: h.text, chapter: h.anchor.chapter, start: h.anchor.start, end: h.anchor.end })),
        protHl: s.highlights.filter((h) => h.bookId === prot?.id).length,
        bm: s.bookmarks.filter((b) => b.bookId === book?.id).map((b) => ({ id: b.id, uuid: b.source?.uuid ?? null, label: b.label, excerpt: b.excerpt, chapter: b.position.chapter })),
        report: s.settings.appleBooksLastSync,
        syncLog: s.activity.filter((a) => /^Synchro Livres/.test(a.summary)).map((a) => a.summary),
        anyLog: s.activity.length,
        chapters: null,
      };
    });
  let s1 = await state();
  const byUuid = (s, u) => s.hl.find((h) => h.uuid === u);
  ok(s1.hl.length === 6, 'surlignages importés (6 ; supprimé et introuvable ignorés)', s1.hl.map((h) => h.uuid).join(', '));
  ok(byUuid(s1, 'H-SEC')?.category === 'these' && byUuid(s1, 'H-SEC')?.note === 'Diviser pour résoudre', 'jaune → Thèse, note de Livres dans la note de l’extrait');
  ok(byUuid(s1, 'H-BON')?.category === 'argument' && byUuid(s1, 'H-DOUTE')?.category === 'concept' && byUuid(s1, 'H-CAR')?.category === 'objection' && byUuid(s1, 'H-JE')?.category === 'probleme' && byUuid(s1, 'H-DIV')?.category === 'exemple', 'couleurs → catégories (vert, bleu, rose, souligné, violet)');
  ok(Object.entries({ 'H-SEC': P_SEC, 'H-BON': P_BON, 'H-DOUTE': P_DOUTE, 'H-CAR': P_CAR, 'H-JE': P_JE, 'H-DIV': P_DIV }).every(([u, t]) => byUuid(s1, u)?.text === t), 'texte des extraits = passage exact du livre');
  ok(!s1.hl.some((h) => h.uuid === 'H-GHOST' || h.uuid === 'H-DEAD'), 'passage introuvable et surlignage supprimé : non importés');
  ok(s1.protHl === 0, 'livre protégé (DRM) ignoré');
  ok(s1.report?.notFound === 1 && s1.report.highlights === 6 && s1.report.bookmarks === 1 && s1.report.positions === 1, 'rapport : 6 surlignages, 1 signet, 1 position — 1 introuvable', s1.report);
  ok(s1.bm.length === 1 && s1.bm[0].uuid === 'B-1' && /^Le premier était/.test(s1.bm[0].excerpt), 'signet importé à l’endroit marqué', s1.bm[0]);
  ok(s1.book?.position?.kind === 'html' && s1.book.position.chapter === byUuid(s1, 'H-JE')?.chapter && s1.book.position.scroll > 0.3 && s1.book.progress > 0.75 && Math.abs(s1.book.lastOpenedAt - POS_DATE) < 2000, 'position de lecture de Livres appliquée (chapitre IV, « Puis, examinant… »)', s1.book);
  ok(s1.syncLog.length === 1 && /6 surlignages, 1 signet/.test(s1.syncLog[0]), 'journal : une seule entrée groupée', s1.syncLog);
  await shot(page, '2-apres-synchro.png');
  await page.keyboard.press('Escape');

  // Accueil : « Reprendre » reflète la position synchronisée.
  await page.locator('.nav-item', { hasText: 'Accueil' }).first().click();
  await sleep(600);
  const resume = await page.locator('.home-resume-card').first().innerText().catch(() => '');
  ok(/Discours/.test(resume) && /(8\d|9\d) % lu/.test(resume), 'Accueil : « Reprendre » avec la progression de Livres', resume.replace(/\s+/g, ' '));
  await shot(page, '3-accueil-reprendre.png');

  // ⌘Z ne défait pas la synchro.
  await st(() => window.__store.getState().undo());
  ok((await state()).hl.length === 6, '⌘Z ne touche pas aux extraits synchronisés');

  // Idempotence : deuxième synchro = aucun changement.
  await page.locator('.nav-item', { hasText: 'Bibliothèque' }).first().click();
  await page.getByRole('button', { name: /Depuis Livres/ }).first().click();
  await page.locator('[data-testid="livres-sync-now"]').click();
  await page.waitForFunction((at) => (window.__store.getState().settings.appleBooksLastSync?.at ?? 0) > at, s1.report.at, { timeout: 30000 });
  let s2 = await state();
  ok(s2.report.created === 0 && s2.report.updated === 0 && s2.report.removed === 0 && s2.hl.length === 6 && s2.bm.length === 1 && s2.syncLog.length === 1, 'idempotence : 2e synchro = 0 changement', s2.report);
  ok(JSON.stringify(s2.hl) === JSON.stringify(s1.hl), 'extraits identiques après la 2e synchro');
  await shot(page, '4-synchro-a-jour.png');
  await page.keyboard.press('Escape');

  // Ouverture du livre : les passages s'affichent surlignés au bon endroit, à la position de Livres.
  await st((id) => window.__store.getState().openBook(id), s1.bookId);
  await page.waitForSelector('.html-doc.is-revealed', { timeout: 30000 });
  await sleep(1200);
  const marks = await st((ids) => ids.map((id) => [...document.querySelectorAll(`[data-hl-id="${id}"]`)].map((e) => e.textContent).join('')), s1.hl.map((h) => h.id));
  ok(s1.hl.every((h, i) => marks[i] === h.text), 'chaque extrait est surligné sur son passage exact dans le lecteur', marks.map((m) => m.slice(0, 20)));
  const visible = () =>
    st(() => {
      const sc = document.querySelector('.html-scroll');
      const r = sc.getBoundingClientRect();
      return [...document.querySelectorAll('.html-chapter-text p')]
        .filter((p) => {
          const b = p.getBoundingClientRect();
          return b.bottom > r.top && b.top < r.bottom;
        })
        .map((p) => p.textContent.slice(0, 30));
    });
  const top = await visible();
  // Dernier paragraphe du livre : il ne peut pas monter tout en haut, il doit être à l'écran.
  ok(top.some((t) => /^Puis, examinant/.test(t)), 'le lecteur s’ouvre à la position de Livres (« Puis, examinant… » à l’écran)', top);
  await shot(page, '5a-ouverture-position-livres.png');
  await page.locator(`[data-hl-id="${byUuid(s1, 'H-SEC').id}"]`).first().scrollIntoViewIfNeeded();
  await sleep(500);
  await shot(page, '5-lecteur-surlignages.png');
  // Indicateur « Livres » dans le panneau des extraits
  const badges = await page.locator('.ann-card .src-livres').count();
  ok(badges === 6, 'indicateur « Livres » sur les extraits venus de Livres', badges);

  // Changements dans Marginalia (à respecter) puis dans Livres (détectés par la surveillance du dossier).
  const now = Date.now();
  await st(({ car, doute, bon }) => {
    const s = window.__store.getState();
    s.updateHighlight(car, { category: 'exemple' }); // catégorie changée à la main
    s.updateHighlight(doute, { note: 'Ma note à moi' }); // note écrite dans Marginalia
    const c = s.addConcept('Bon sens');
    s.toggleHighlightConcept(bon, c.id); // extrait enrichi
  }, { car: byUuid(s1, 'H-CAR').id, doute: byUuid(s1, 'H-DOUTE').id, bon: byUuid(s1, 'H-BON').id });
  // Ferme le livre : la position de Livres ne doit pas passer devant une lecture plus récente.
  await st(() => window.__store.getState().navigate({ name: 'library' }));
  await sleep(400);
  const pre = (await state()).book;
  const lastOpen = pre.lastOpenedAt;
  upd('H-SEC', `ZANNOTATIONNOTE='Diviser chaque difficulté'`, now); // note modifiée
  upd('H-CAR', `ZANNOTATIONNOTE='Note changée dans Livres', ZANNOTATIONSTYLE=3`, now); // couleur + note
  upd('H-DOUTE', `ZANNOTATIONNOTE='Note Livres modifiée'`, now);
  upd('H-JE', 'ZANNOTATIONDELETED=1', now); // supprimé, non enrichi → retiré
  upd('H-BON', 'ZANNOTATIONDELETED=1', now); // supprimé mais enrichi → conservé, détaché
  upd('P-1', `ZANNOTATIONLOCATION='${cfiPoint('ch001.xhtml', '/4/2/4')}'`, lastOpen - 60_000); // plus ancien que Marginalia
  ann({ uuid: 'H-NEW', style: 1, text: 'Le troisième, de conduire par ordre mes pensées', cfi: cfiRange('ch002.xhtml', '/4/2/8/8', 'Le troisième', 'Le troisième, de conduire par ordre mes pensées'), created: now, modified: now });
  await page.waitForFunction(() => window.__store.getState().highlights.some((h) => h.source?.uuid === 'H-NEW'), null, { timeout: 30000 }).catch(() => {});
  await sleep(800);
  const s3 = await state();
  ok(!!byUuid(s3, 'H-NEW'), 'surveillance du dossier AEAnnotation : nouveauté de Livres importée sans action');
  ok(byUuid(s3, 'H-SEC')?.note === 'Diviser chaque difficulté', 'note modifiée dans Livres → mise à jour');
  ok(byUuid(s3, 'H-CAR')?.category === 'exemple' && byUuid(s3, 'H-CAR')?.note === 'Note changée dans Livres', 'catégorie changée à la main conservée, note de Livres mise à jour', byUuid(s3, 'H-CAR'));
  ok(byUuid(s3, 'H-DOUTE')?.note === 'Ma note à moi', 'note écrite dans Marginalia jamais écrasée');
  ok(!s3.hl.some((h) => h.text === P_JE), 'supprimé dans Livres (non enrichi) → retiré');
  const bon = s3.hl.find((h) => h.text === P_BON);
  ok(bon && bon.uuid === null, 'supprimé dans Livres mais enrichi (concept) → conservé et détaché');
  ok(JSON.stringify(s3.book.position) === JSON.stringify(pre.position) && s3.book.lastOpenedAt === lastOpen, 'position non appliquée : Marginalia plus récent que Livres');
  ok(s3.syncLog.length === 2, 'journal : une entrée groupée par synchro avec changements', s3.syncLog);
  ok(s3.report.notFound === 1, 'rapport toujours : 1 passage introuvable', s3.report);

  // Livre ouvert : jamais déplacé ; toast « Reprendre » si Livres est plus loin et plus récent.
  await st((id) => window.__store.getState().openBook(id), s1.bookId);
  await page.waitForSelector('.html-doc.is-revealed', { timeout: 30000 });
  await sleep(1500);
  await st(() => document.querySelector('.html-scroll').scrollTo({ top: 0 }));
  await sleep(1800);
  const before = (await state()).book;
  upd('P-1', `ZANNOTATIONLOCATION='${cfiPoint('ch003.xhtml', '/4/2/10')}'`, Date.now() + 120_000);
  await page.waitForSelector('.toast-action', { timeout: 20000 }).catch(() => {});
  const toast = await page.locator('.toast', { hasText: 'Reprendre' }).first().innerText().catch(() => '');
  ok(/Livres/.test(toast), 'livre ouvert : toast « Reprendre là où vous étiez dans Livres »', toast.replace(/\s+/g, ' '));
  const mid = (await state()).book;
  ok(mid.position.chapter === before.position.chapter && Math.abs(mid.position.scroll - before.position.scroll) < 0.01, 'livre ouvert : pas déplacé par la synchro');
  await shot(page, '6-toast-reprendre.png');
  await page.locator('.toast-action', { hasText: 'Reprendre' }).first().click();
  await sleep(2500);
  const top2 = await visible();
  ok(top2.some((t) => /^Puis, examinant/.test(t)), '« Reprendre » amène à l’endroit lu dans Livres', top2);
  await shot(page, '7-apres-reprendre.png');

  // Panneau des signets : indicateur « Livres ».
  await st(() => window.__store.getState().updateSettings({ rightPanel: 'signets', showExtracts: true }));
  await sleep(600);
  ok((await page.locator('.bm-row-where .src-livres').count()) === 1, 'indicateur « Livres » sur le signet');
  await shot(page, '8-signets.png');

  ok(!errors.length, 'aucune erreur dans la page', errors.join(' | '));
} finally {
  await app.close();
}
// Jamais d'écriture dans les données de Livres : aucun fichier de Marginalia dans les dossiers de Livres.
const leftovers = execFileSync('bash', ['-c', `ls -a "${path.dirname(AE)}" "${path.dirname(BK)}"`]).toString();
ok(!/marginalia/i.test(leftovers), 'aucun fichier ajouté dans les dossiers de Livres', leftovers.replace(/\s+/g, ' '));
fs.rmSync(HOME, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
