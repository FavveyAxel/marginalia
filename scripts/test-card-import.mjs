// Import de cartes de révision depuis Excel (.xlsx) ou .csv, et modèle à télécharger — port 5326.
// Lecture : modèle généré (aller-retour), classeur openpyxl (sharedStrings, nombre, ligne vide, ligne
// incomplète), classeur LibreOffice, CSV d'Excel français (points-virgules, Windows-1252, guillemets,
// retour à la ligne dans une cellule), CSV sans titres (virgules) ; formats refusés avec un message.
// Interface : Révision › Créer › Libre › Importer : aperçu, livre retrouvé par son titre, livre
// inconnu signalé, création en une fois, ré-import = doublons non recréés, « Annuler » retire tout.
// Lancer : timeout 240 node scripts/test-card-import.mjs [dossier-captures]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5326;
const SHOTS = process.argv[2];
const FX = path.join(ROOT, 'fixtures/cards');
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
};

const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const parse = (file) =>
  page.evaluate(
    async ({ name, b64 }) => {
      const m = await import('/src/features/revision/cardImport.ts');
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
      try {
        return await m.parseCardFile(name, data);
      } catch (e) {
        return { error: e.message };
      }
    },
    { name: path.basename(file), b64: fs.readFileSync(file).toString('base64') },
  );

try {
  await page.goto(`http://localhost:${PORT}/`, { timeout: 120000 });
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));

  // ── Modèle : aller-retour ──
  const tpl = await page.evaluate(async () => {
    const m = await import('/src/features/revision/cardImport.ts');
    const buf = await m.templateXlsx();
    return { b64: btoa(String.fromCharCode(...new Uint8Array(buf))), parsed: await m.parseCardFile('modele.xlsx', buf) };
  });
  const tplPath = path.join(os.tmpdir(), 'modele-cartes.xlsx');
  fs.writeFileSync(tplPath, Buffer.from(tpl.b64, 'base64'));
  check('modèle : titres reconnus, 2 cartes d’exemple', tpl.parsed.header && tpl.parsed.cards.length === 2, tpl.parsed.cards.map((c) => c.front));
  check('modèle : colonne Livre lue', tpl.parsed.cards[0].book === 'Fondements de la métaphysique des mœurs');
  check('modèle : guillemets et apostrophes typographiques intacts', tpl.parsed.cards[0].back.includes('« Agis'));

  // ── Classeur openpyxl ──
  const ox = await parse(path.join(FX, 'openpyxl.xlsx'));
  check('openpyxl : titres « Questions / Réponses » reconnus', ox.header === true);
  check('openpyxl : 3 cartes (ligne vide sautée)', ox.cards?.length === 3, ox.cards?.map((c) => c.front));
  check('openpyxl : retour à la ligne dans une cellule gardé', ox.cards?.[1]?.back === 'La nécessité d’accomplir une action\npar respect pour la loi.');
  check('openpyxl : nombre lu comme texte', ox.cards?.[2]?.back === '1724');
  check('openpyxl : ligne incomplète signalée (ligne 4)', JSON.stringify(ox.incomplete) === '[4]', ox.incomplete);

  // ── Classeur LibreOffice ──
  const lo = await parse(path.join(FX, 'libreoffice.xlsx'));
  check('LibreOffice : 1 carte', lo.cards?.length === 1 && lo.cards[0].back === 'Le sentiment produit par la loi morale.', lo);

  // ── CSV d'Excel français (Windows-1252, ;) ──
  const fr = await parse(path.join(FX, 'excel-fr-ansi.csv'));
  check('CSV Excel FR : 2 cartes, accents corrects', fr.cards?.length === 2 && fr.cards[1].back === 'Se donner à soi-même sa loi ; "auto-nomos".', fr.cards);
  check('CSV Excel FR : retour à la ligne entre guillemets', fr.cards?.[0]?.back === 'Il est toujours interdit,\nmême pour sauver un ami.', fr.cards?.[0]?.back);

  // ── CSV sans titres ──
  const nt = await parse(path.join(FX, 'sans-titres.csv'));
  check('CSV sans titres : colonnes A et B, 2 cartes', nt.header === false && nt.cards?.length === 2 && nt.cards[1].back === 'Act only on that maxim, universally.', nt);

  // ── Formats refusés ──
  const ods = await page.evaluate(async () => (await import('/src/features/revision/cardImport.ts')).parseCardFile('cartes.ods', new ArrayBuffer(4)).then(() => '', (e) => e.message));
  check('.ods : message clair', /Excel \(\.xlsx\) ou \.csv/.test(ods), ods);
  const pdf = await page.evaluate(async () => (await import('/src/features/revision/cardImport.ts')).parseCardFile('livre.pdf', new ArrayBuffer(4)).then(() => '', (e) => e.message));
  check('.pdf : refusé', /Format non pris en charge/.test(pdf), pdf);

  // ── Interface ──
  const b64 = fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')).toString('base64');
  await page.evaluate(async (b64) => {
    const s = window.__store.getState();
    const [b] = await s.importFiles([{ name: 'k.epub', data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer }]);
    s.updateBook(b.id, { title: 'Fondements de la métaphysique des mœurs', author: 'Emmanuel Kant' });
    s.navigate({ name: 'revision' });
  }, b64);
  await page.waitForTimeout(800);
  await page.click('button[role="tab"]:has-text("Créer des cartes")');
  await page.click('.rev-types button:has-text("Libre")');
  await page.waitForSelector('[data-testid="card-import"]');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cartes-import-1.png') });
  const n0 = await page.evaluate(() => window.__store.getState().cards.length);
  await page.setInputFiles('[data-testid="card-import"] input[type="file"]', path.join(FX, 'openpyxl.xlsx'));
  await page.waitForSelector('[data-testid="card-import-preview"]');
  const txt = await page.textContent('[data-testid="card-import-preview"]');
  check('aperçu : 3 cartes prêtes', /3 cartes prêtes/.test(txt), txt.slice(0, 120));
  check('aperçu : ligne ignorée signalée', /1 ligne ignorée.*ligne 4/.test(txt));
  check('aperçu : livre inconnu signalé', /Livre introuvable.*« Livre inconnu »/.test(txt));
  await page.waitForTimeout(500); // fin de l'apparition de la fenêtre
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cartes-import-2.png') });
  await page.click('[data-act="import-confirm"]');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const s = window.__store.getState();
    return { cards: s.cards.map((c) => ({ front: c.front, bookId: c.bookId, kind: c.kind })), book: s.books[0].id };
  });
  check('3 cartes créées (type Libre)', after.cards.length === n0 + 3 && after.cards.slice(-3).every((c) => c.kind === 'libre'));
  check('livre retrouvé par son titre (sans accents ni majuscules)', after.cards.find((c) => c.front === 'Qu’est-ce qu’une maxime ?')?.bookId === after.book);
  check('livre inconnu : carte sans livre', after.cards.find((c) => c.front === 'Kant est né en ?')?.bookId === null);
  check('message « 3 cartes créées » avec Annuler', await page.locator('text=3 cartes créées').count() > 0 && (await page.locator('.toast button:has-text("Annuler"), button:has-text("Annuler")').count()) > 0);

  // Ré-import : doublons non recréés.
  await page.setInputFiles('[data-testid="card-import"] input[type="file"]', path.join(FX, 'openpyxl.xlsx'));
  await page.waitForSelector('[data-testid="card-import-preview"]');
  const txt2 = await page.textContent('[data-testid="card-import-preview"]');
  check('ré-import : 3 cartes déjà présentes, rien à créer', /3 cartes déjà présentes/.test(txt2) && (await page.isDisabled('[data-act="import-confirm"]')), txt2.slice(0, 160));
  await page.click('.rev-import-actions button:has-text("Annuler")');

  // Import du modèle puis « Annuler » dans le message : tout est retiré.
  // Nom réel du modèle enregistré (accents) : passé en mémoire, Playwright lisant mal les chemins accentués.
  await page.setInputFiles('[data-testid="card-import"] input[type="file"]', { name: 'Modèle cartes de révision.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fs.readFileSync(tplPath) });
  await page.waitForSelector('[data-testid="card-import-preview"]');
  await page.click('[data-act="import-confirm"]');
  await page.waitForTimeout(300);
  const n2 = await page.evaluate(() => window.__store.getState().cards.length);
  await page.locator('button:has-text("Annuler")').last().click();
  await page.waitForTimeout(300);
  const n3 = await page.evaluate(() => window.__store.getState().cards.length);
  check('« Annuler » retire tout l’import', n2 === n0 + 5 && n3 === n0 + 3, `${n0} → ${n2} → ${n3}`);
  check('aucune erreur dans la page', !errors.length, errors.join('\n'));
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `\n${failed} vérification(s) en échec.` : '\nToutes les vérifications sont passées.');
process.exit(failed ? 1 : 0);
