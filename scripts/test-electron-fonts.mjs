// Polices dans la VRAIE app Electron (build dist/) : liste des polices installées (IPC natif), favoris
// du sélecteur, police choisie conservée en quittant l'écrit et en relançant l'app, « Police des
// nouveaux écrits » conservée. Comme un utilisateur : souris, clavier, barre d'outils ; on lit la page
// peinte (styles calculés des .superdoc-text-run), l'étiquette de la barre et le .docx sur disque.
//
//  1. Favori : l'étoile met la police dans « Favoris » (en tête) SANS la retirer de son groupe
//     (Récentes / Toutes les polices) ; retirer l'étoile la remet comme avant ; persiste au redémarrage.
//  2. Police choisie : « Tout sélectionner » + police → texte ET paragraphes vides (barre d'outils et
//     texte tapé ensuite) ; curseur dans un mot + police → le mot ; quitter l'écrit tout de suite puis
//     rouvrir, quitter l'app tout de suite puis relancer : même police à l'écran, dans la barre, dans le .docx.
//  3. « Police des nouveaux écrits » : conservée au redémarrage (réglages de l'app).
//  4. Police du document : écrit vide, « Tout sélectionner » + police, frappe, ⌘Q immédiat, relance → barre,
//     texte et w:docDefaults dans la police ; nouveau paragraphe dans la police ; récentes conservées.
//
// Lancer (après `npx vite build`) : DISPLAY=:99 timeout 600 node scripts/test-electron-fonts.mjs
// APP_DIR : dossier de l'app (défaut : ce dépôt). SHOTS : captures (défaut /home/claude/marginalia/shots/polices).
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APP_DIR = path.resolve(process.env.APP_DIR || ROOT);
const EXE = fs.existsSync(path.join(APP_DIR, 'node_modules/electron/dist/electron'))
  ? path.join(APP_DIR, 'node_modules/electron/dist/electron')
  : path.join(ROOT, 'node_modules/electron/dist/electron');
const SHOTS = process.env.SHOTS || '/home/claude/marginalia/shots/polices';
fs.mkdirSync(SHOTS, { recursive: true });
if (!fs.existsSync(path.join(APP_DIR, 'dist/index.html'))) {
  console.error(`dist/ absent dans ${APP_DIR} : lancer d'abord « npx vite build ».`);
  process.exit(2);
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-polices-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${d ? ' — ' + d.slice(0, 500) : ''}`);
};

// polices présentes dans le conteneur
const FONT_A = 'EB Garamond';
const FONT_B = 'DejaVu Sans';
const FONT_FAV = 'Liberation Serif';

let app;
let page;
async function launch() {
  const env = { ...process.env, HOME: TMP, XDG_CONFIG_HOME: path.join(TMP, '.config'), VITE_DEV_SERVER_URL: '', MARGINALIA_E2E: '1' };
  delete env.MARGINALIA_APPLE_BOOKS;
  app = await electron.launch({ executablePath: EXE, args: ['--no-sandbox', APP_DIR], env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
}
/** Quitter comme ⌘Q (before-quit : enregistrements en attente écrits d'abord). */
async function quit() {
  const exited = new Promise((r) => app.process().once('exit', r));
  await app.evaluate(({ app: a }) => a.quit()).catch(() => {});
  await exited;
}

// ── Page peinte ──
const runFont = (needle) =>
  page.evaluate((needle) => {
    for (const run of document.querySelectorAll('.superdoc-page .superdoc-text-run')) {
      if (run.dataset.sdProofing === 'original' || getComputedStyle(run).display === 'none') continue;
      if (run.textContent.includes(needle)) return getComputedStyle(run).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    }
    return null;
  }, needle);
const rectOf = (needle, a, b) =>
  page.evaluate(
    ([needle, a, b]) => {
      for (const n of document.querySelectorAll('.superdoc-page .superdoc-text-run')) {
        if (n.dataset.sdProofing === 'original' || getComputedStyle(n).display === 'none') continue;
        const t = n.firstChild?.nodeType === 3 ? n.firstChild : [...n.childNodes].find((x) => x.nodeType === 3 || x.firstChild?.nodeType === 3);
        const tn = t?.nodeType === 3 ? t : t?.firstChild;
        const i = tn?.data.indexOf(needle) ?? -1;
        if (i < 0) continue;
        n.scrollIntoView({ block: 'center' });
        const r = document.createRange();
        r.setStart(tn, i + a);
        r.setEnd(tn, i + b);
        const x = r.getBoundingClientRect();
        return { left: x.left, right: x.right, top: x.top, bottom: x.bottom };
      }
      return null;
    },
    [needle, a, b],
  );
/** Clic entre les caractères `i-1` et `i` du passage. */
async function caretAt(needle, i) {
  const r = await rectOf(needle, i, i + 1);
  if (!r) throw new Error(`passage introuvable : « ${needle} »`);
  await page.mouse.click(r.left + 0.3, (r.top + r.bottom) / 2);
  await sleep(350);
}
/** Clic dans le paragraphe vide qui suit le passage (ligne suivante). */
async function clickLineBelow(needle) {
  const r = await rectOf(needle, 0, 1);
  const h = r.bottom - r.top;
  await page.mouse.click(r.left + 2, r.bottom + h * 1.0);
  await sleep(350);
}
const tb = (name) => page.locator(`.ed-toolbar [data-tb="${name}"]`).first();
const fontLabel = async () => (await tb('font').innerText()).trim();
async function pickFont(name) {
  await tb('font').click();
  const q = page.locator('.ed-font-search input');
  await q.waitFor({ timeout: 5000 });
  await q.fill(name);
  await sleep(250);
  await q.press('Enter');
  await sleep(300);
}
async function openFontMenu() {
  await tb('font').click();
  await page.locator('.ed-font-row').first().waitFor({ timeout: 10000 });
  await sleep(300);
}
/** Groupes du menu des polices et polices de chaque groupe. */
const menuGroups = () =>
  page.evaluate(() => {
    const out = {};
    let g = null;
    for (const el of document.querySelectorAll('.ed-font-list .ed-font-group, .ed-font-list .ed-font-row')) {
      if (el.classList.contains('ed-font-group')) out[(g = el.textContent.replace(/\s*\(\d+\)$/, ''))] = [];
      else if (g) out[g].push({ font: el.dataset.font, star: el.querySelector('.ed-font-star')?.getAttribute('aria-pressed') === 'true' });
    }
    return out;
  });
const inGroup = (groups, g, f) => (groups[g] ?? []).some((r) => r.font === f);
async function star(group, font) {
  const row = page.locator(`.ed-font-row[data-key="${group}-${font}"]`).first();
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await row.locator('.ed-font-star').click();
  await sleep(350);
}
const list = async () => {
  await page.locator('.sidebar .nav-item', { hasText: 'Écrits' }).first().click();
  await page.locator('.ed-card-open').first().waitFor({ timeout: 20000 });
};
const openDraft = async () => {
  await page.locator('.ed-card-open').first().click();
  await page.waitForSelector('.ed-engine-in .superdoc-page', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('.superdoc-page .superdoc-text-run'), null, { timeout: 30000 });
  await sleep(1800);
};
/** w:rFonts ascii du .docx enregistré (bibliothèque) : runs (ou police du document) et marques de paragraphe. */
function docxFonts() {
  const lib = path.join(TMP, '.config/Marginalia/library');
  const dir = fs.readdirSync(lib).find((d) => fs.existsSync(path.join(lib, d, 'document.docx')));
  const xml = execFileSync('unzip', ['-p', path.join(lib, dir, 'document.docx'), 'word/document.xml'], { encoding: 'utf8' });
  // police du document (w:docDefaults) : celle des runs sans w:rFonts
  const styles = execFileSync('unzip', ['-p', path.join(lib, dir, 'document.docx'), 'word/styles.xml'], { encoding: 'utf8' });
  const docFont = /<w:rPrDefault>[\s\S]*?<w:rFonts\b[^>]*w:ascii="([^"]+)"/.exec(styles)?.[1] ?? null;
  const paras = (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map((p) => ({
    text: (p.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''),
    mark: /<w:pPr>[\s\S]*?<w:rPr>[\s\S]*?w:ascii="([^"]+)"/.exec(p)?.[1] ?? null,
    runs: (p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) ?? []).map((r) => ({
      text: (r.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''),
      font: /<w:rFonts [^>]*w:ascii="([^"]+)"/.exec(r)?.[1] ?? null,
    })),
  }));
  return {
    /** Police effective du run : w:rFonts du run, sinon police du document. */
    fontOf: (needle) => {
      const r = paras.flatMap((p) => p.runs).find((r) => r.text.includes(needle));
      return r ? r.font ?? docFont : null;
    },
    docFont,
    emptyMarks: paras.filter((p) => !p.text).map((p) => p.mark),
  };
}

const P1 = 'Premier paragraphe du texte.';
const P2 = 'Second chapitre ici.';
try {
  await launch();
  const fonts = await page.evaluate(() => window.marginalia.listFonts());
  check('polices installées listées par l’hôte (IPC natif)', fonts.length > 5 && fonts.includes(FONT_A) && fonts.includes(FONT_FAV), `${fonts.length} polices`);

  // ── Écrit « Vide » : deux paragraphes séparés par un paragraphe vide ──
  await list().catch(() => {});
  await page.locator('button:has-text("Nouveau")').first().click();
  await page.locator('[data-template="vide"]').click();
  await page.waitForSelector('.ed-engine-in .superdoc-page', { timeout: 60000 });
  await sleep(1500);
  const pg = await page.locator('.superdoc-page').first().boundingBox();
  await page.mouse.click(pg.x + pg.width / 2, pg.y + 120);
  await sleep(300);
  await page.keyboard.type(P1, { delay: 2 });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type(P2, { delay: 2 });
  await sleep(600);

  // ── 2a. Tout sélectionner + police ──
  await page.keyboard.press('Control+a');
  await sleep(250);
  await pickFont(FONT_A);
  check(`« Tout sélectionner » + ${FONT_A} : texte peint dans la police`, (await runFont('Premier')) === FONT_A && (await runFont('Second')) === FONT_A, `${await runFont('Premier')} / ${await runFont('Second')}`);
  await clickLineBelow('Premier');
  check(`paragraphe vide : la barre affiche ${FONT_A} (et non la police par défaut)`, (await fontLabel()) === FONT_A, await fontLabel());
  await page.keyboard.type('Ajout', { delay: 5 });
  await sleep(400);
  check(`paragraphe vide : le texte tapé est en ${FONT_A}`, (await runFont('Ajout')) === FONT_A, await runFont('Ajout'));

  // ── 2b. Curseur dans un mot + police : le mot (comme Word) ──
  await caretAt('Second', 3);
  await pickFont(FONT_B);
  check(`curseur dans « Second » + ${FONT_B} : le mot change`, (await runFont('Second')) === FONT_B && (await runFont('chapitre')) === FONT_A, `${await runFont('Second')} / ${await runFont('chapitre')}`);
  check(`curseur dans « Second » : barre ${FONT_B}`, (await fontLabel()) === FONT_B, await fontLabel());

  // ── Quitter l'écrit TOUT DE SUITE puis rouvrir ──
  await list();
  await openDraft();
  await caretAt('Premier', 3);
  check(`réouverture : barre ${FONT_A} dans « Premier »`, (await fontLabel()) === FONT_A, await fontLabel());
  await caretAt('Second', 3);
  check(`réouverture : barre ${FONT_B} dans « Second »`, (await fontLabel()) === FONT_B, await fontLabel());
  check('réouverture : texte peint dans les polices choisies', (await runFont('Premier')) === FONT_A && (await runFont('Second')) === FONT_B && (await runFont('Ajout')) === FONT_A);
  {
    const d = docxFonts();
    check('.docx : runs dans les polices choisies (w:rFonts, ou police du document)', d.fontOf('Premier') === FONT_A && d.fontOf('Second') === FONT_B && d.fontOf('Ajout') === FONT_A, { Premier: d.fontOf('Premier'), Second: d.fontOf('Second'), Ajout: d.fontOf('Ajout') });
  }

  // ── 1. Favoris ──
  await openFontMenu();
  let g = await menuGroups();
  check('menu : pas de groupe « Favoris » au départ', !g.Favoris, Object.keys(g));
  check(`menu : ${FONT_A} dans « Récentes »`, inGroup(g, 'Récentes', FONT_A));
  await star('Toutes les polices', FONT_FAV);
  check('l’étoile ne ferme pas le menu', (await page.locator('.ed-font-menu').count()) === 1);
  g = await menuGroups();
  check(`favori ${FONT_FAV} : dans « Favoris » en tête`, Object.keys(g)[0] === 'Favoris' && inGroup(g, 'Favoris', FONT_FAV), Object.keys(g));
  check(`favori ${FONT_FAV} : toujours dans « Toutes les polices », étoile pleine`, (g['Toutes les polices'] ?? []).some((r) => r.font === FONT_FAV && r.star));
  await star('Récentes', FONT_A);
  g = await menuGroups();
  check(`favori ${FONT_A} (depuis Récentes) : dans « Favoris » ET toujours dans « Récentes »`, inGroup(g, 'Favoris', FONT_A) && inGroup(g, 'Récentes', FONT_A), g.Favoris);
  await page.locator('.ed-font-list').evaluate((el) => (el.scrollTop = 0));
  await sleep(200);
  await page.screenshot({ path: path.join(SHOTS, 'favoris.png') });
  await star('Favoris', FONT_A);
  g = await menuGroups();
  check(`retirer l’étoile de ${FONT_A} : sort de « Favoris », reste dans « Récentes »`, !inGroup(g, 'Favoris', FONT_A) && inGroup(g, 'Récentes', FONT_A) && inGroup(g, 'Favoris', FONT_FAV));
  await star('Récentes', FONT_A);
  await page.keyboard.press('Escape');
  await sleep(200);

  // ── 3. Police des nouveaux écrits ──
  await list();
  await page.locator('button:has-text("Nouveau")').first().click();
  await page.locator('[data-new-font]').selectOption('Georgia');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(200);
  check('« Police des nouveaux écrits » enregistrée dans les réglages', (await page.evaluate(() => window.__store.getState().settings.newDraftFont)) === 'Georgia');

  // ── Changement juste avant de quitter l'app (⌘Q immédiat) ──
  await openDraft();
  await caretAt('chapitre', 4);
  await pickFont(FONT_FAV);
  await quit();
  check('app quittée sans attendre l’enregistrement automatique', true);

  // ── Relance avec le même dossier de données ──
  await launch();
  const st = await page.evaluate(() => window.__store.getState().settings);
  check('relance : favoris dans les réglages (db.json)', JSON.stringify(st.editorFavoriteFonts) === JSON.stringify([FONT_A, FONT_FAV].sort((a, b) => a.localeCompare(b, 'fr'))), st.editorFavoriteFonts);
  await list();
  await page.locator('button:has-text("Nouveau")').first().click();
  check('relance : « Police des nouveaux écrits » = Georgia', (await page.locator('[data-new-font]').inputValue()) === 'Georgia');
  await page.keyboard.press('Escape');
  await sleep(200);
  await openDraft();
  check('relance : « chapitre » (changé juste avant ⌘Q) peint en ' + FONT_FAV, (await runFont('chapitre')) === FONT_FAV, await runFont('chapitre'));
  check('relance : « Premier » peint en ' + FONT_A, (await runFont('Premier')) === FONT_A, await runFont('Premier'));
  await caretAt('Premier', 3);
  check(`relance : barre ${FONT_A} dans « Premier »`, (await fontLabel()) === FONT_A, await fontLabel());
  await page.screenshot({ path: path.join(SHOTS, 'reouverture.png') });
  await caretAt('Second', 3);
  check(`relance : barre ${FONT_B} dans « Second »`, (await fontLabel()) === FONT_B, await fontLabel());
  {
    const d = docxFonts();
    check('relance : .docx avec les polices choisies', d.fontOf('Premier') === FONT_A && d.fontOf('Second') === FONT_B && d.fontOf('chapitre') === FONT_FAV, { Premier: d.fontOf('Premier'), Second: d.fontOf('Second'), chapitre: d.fontOf('chapitre') });
  }
  await openFontMenu();
  g = await menuGroups();
  check('relance : groupe « Favoris » avec les deux favoris', inGroup(g, 'Favoris', FONT_A) && inGroup(g, 'Favoris', FONT_FAV), g.Favoris);
  await page.keyboard.press('Escape');
  // nouvel écrit « Vide » : police des nouveaux écrits
  await list();
  await page.locator('button:has-text("Nouveau")').first().click();
  await page.locator('[data-template="vide"]').click();
  await page.waitForSelector('.ed-engine-in .superdoc-page', { timeout: 60000 });
  await sleep(1500);
  check('nouvel écrit « Vide » : barre en Georgia', (await fontLabel()) === 'Georgia', await fontLabel());

  // ── 4. Police du document : écrit vide, ⌘A + police, frappe, ⌘Q immédiat, relance ──
  // (signalement : « elle remet Times New Roman quand je quitte l'app et la relance »)
  const DOC = 'Police du document';
  await page.evaluate((t) => {
    const s = window.__store.getState();
    s.patch('drafts', s.drafts.at(-1).id, { title: t });
  }, DOC);
  const pg2 = await page.locator('.superdoc-page').first().boundingBox();
  await page.mouse.click(pg2.x + pg2.width / 2, pg2.y + 120);
  await sleep(300);
  await page.keyboard.press('Control+a');
  await sleep(250);
  await pickFont(FONT_A);
  check(`écrit vide, ⌘A + ${FONT_A} : barre ${FONT_A}`, (await fontLabel()) === FONT_A, await fontLabel());
  await page.keyboard.type('Ligne de la police du document.', { delay: 2 });
  await sleep(400);
  check(`écrit vide : texte tapé en ${FONT_A}`, (await runFont('Ligne de la')) === FONT_A, await runFont('Ligne de la'));
  await quit();
  await launch();
  await list();
  await page.locator('.ed-card', { hasText: DOC }).first().locator('.ed-card-open').click();
  await page.waitForSelector('.ed-engine-in .superdoc-page', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('.superdoc-page .superdoc-text-run'), null, { timeout: 30000 });
  await sleep(1800);
  check(`relance : barre ${FONT_A} (curseur au début de l’écrit)`, (await fontLabel()) === FONT_A, await fontLabel());
  check(`relance : texte peint en ${FONT_A}`, (await runFont('Ligne de la')) === FONT_A, await runFont('Ligne de la'));
  {
    const id = await page.evaluate((t) => window.__store.getState().drafts.find((d) => d.title === t)?.id, DOC);
    const f = path.join(TMP, '.config/Marginalia/library', id, 'document.docx');
    const st = execFileSync('unzip', ['-p', f, 'word/styles.xml'], { encoding: 'utf8' });
    const dd = /<w:rPrDefault>[\s\S]*?<w:rFonts\b[^>]*w:ascii="([^"]+)"/.exec(st)?.[1] ?? null;
    check(`relance : police du document (w:docDefaults) = ${FONT_A}`, dd === FONT_A, dd);
  }
  await caretAt('Ligne', 2);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Suite après relance', { delay: 2 });
  await sleep(400);
  check(`relance : nouveau paragraphe tapé en ${FONT_A}`, (await runFont('Suite après')) === FONT_A, await runFont('Suite après'));
  const rec = await page.evaluate(() => window.__store.getState().settings.editorRecentFonts);
  check(`relance : polices récentes conservées (${FONT_A} en tête)`, rec?.[0] === FONT_A && rec.includes(FONT_FAV), rec);
} catch (e) {
  check('déroulement', false, String(e?.stack || e).slice(0, 800));
  await page?.screenshot({ path: path.join(SHOTS, 'echec.png') }).catch(() => {});
} finally {
  await app?.close().catch(() => {});
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
