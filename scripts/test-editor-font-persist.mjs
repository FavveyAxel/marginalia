// Police d'un écrit conservée en quittant l'écrit et en relançant l'app — port 5444.
// Signalement : « la police d'écriture quand je quitte l'app et la relance elle est pas sauvegardée
// comme sélectionnée, elle remet Times New Roman même quand je quitte l'écrit et que je reviens ».
//
// Comme un utilisateur (souris, clavier, barre d'outils) ; on lit la page peinte (styles calculés des
// .superdoc-text-run), l'étiquette du sélecteur de police et le .docx enregistré (styles.xml, document.xml).
//
//  A. Écrit vide (police des nouveaux écrits : Times New Roman) : ⌘A, police, frappe → texte dans la police ;
//     quitter / revenir, recharger l'app : barre et nouveau texte dans la police ; police du document
//     (w:docDefaults) dans le .docx.
//  B. Écrit avec du texte : ⌘A, police, puis frappe par-dessus la sélection (le texte remplacé garde la
//     police), ⌘A, police, Retour arrière (la barre garde la police) ; annuler / rétablir la police.
//  C. Curseur seul dans un écrit vide, nouveau clic, frappe → police gardée ; recharger : idem.
//  D. Écrit « Dissertation » : curseur en fin de texte + police → seul le texte tapé change (le reste du
//     modèle garde sa police) ; quitter / revenir : curseur après ce texte → barre dans la police.
//  E. Favoris et récentes du sélecteur : conservés au rechargement de l'app.
//
// Lancer : timeout 600 node scripts/test-editor-font-persist.mjs
import { withApp } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 5444;
const FONT = 'EB Garamond';
const FONT2 = 'DejaVu Serif';
// liste de base du navigateur (sans liste native des polices) : une police qui y figure
const FAV = 'Georgia';
const TNR = 'Times New Roman';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-font-persist-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'OK   ' : 'ÉCHEC'} ${name}${d ? ' — ' + d.slice(0, 400) : ''}`);
};

await withApp(PORT, async (page) => {
  const runFont = (needle) =>
    page.evaluate((needle) => {
      for (const run of document.querySelectorAll('.superdoc-page .superdoc-text-run')) {
        if (run.dataset.sdProofing === 'original' || getComputedStyle(run).display === 'none') continue;
        if (run.textContent.includes(needle)) return getComputedStyle(run).fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      }
      return null;
    }, needle);
  const tb = (name) => page.locator(`.ed-toolbar [data-tb="${name}"]`).first();
  const label = async () => (await tb('font').innerText()).trim();
  const list = async () => {
    await page.locator('.sidebar .nav-item', { hasText: 'Écrits' }).first().click();
    await page.locator('.ed-card-open').first().waitFor({ timeout: 20000 });
  };
  const waitEditor = async () => {
    await page.waitForSelector('.ed-engine-in .superdoc-page', { timeout: 60000 });
    await sleep(1800);
  };
  const newDraft = async (template) => {
    await list().catch(() => {});
    await page.locator('button:has-text("Nouveau")').first().click();
    await page.locator(`[data-template="${template}"]`).click();
    await waitEditor();
  };
  /** Rouvre l'écrit `title` depuis la liste. */
  const openDraft = async (title) => {
    await list();
    await page.locator('.ed-card', { hasText: title }).first().locator('.ed-card-open').first().click();
    await waitEditor();
  };
  const pickFont = async (name) => {
    await tb('font').click();
    const q = page.locator('.ed-font-search input');
    await q.waitFor({ timeout: 5000 });
    await q.fill(name);
    await sleep(250);
    await q.press('Enter');
    await sleep(400);
  };
  const clickPage = async () => {
    const pg = await page.locator('.superdoc-page').first().boundingBox();
    await page.mouse.click(pg.x + pg.width / 2, pg.y + 120);
    await sleep(300);
  };
  /** Clic juste après la fin du passage, puis Fin (curseur en fin de ligne). */
  const clickAfter = async (needle) => {
    const r = await page.evaluate((needle) => {
      for (const n of document.querySelectorAll('.superdoc-page .superdoc-text-run')) {
        if (!n.textContent.includes(needle)) continue;
        n.scrollIntoView({ block: 'center' });
        const b = n.getBoundingClientRect();
        return { x: b.right - 1, y: (b.top + b.bottom) / 2 };
      }
      return null;
    }, needle);
    if (!r) throw new Error(`passage introuvable : « ${needle} »`);
    await page.mouse.click(r.x, r.y);
    await sleep(300);
    await page.keyboard.press('End');
    await sleep(250);
  };
  const type = async (t) => {
    await page.keyboard.type(t, { delay: 4 });
    await sleep(400);
  };
  const rename = async (title) => {
    const id = await page.evaluate(() => window.__store.getState().drafts.at(-1)?.id);
    await page.evaluate(([id, title]) => window.__store.getState().patch('drafts', id, { title }), [id, title]);
  };
  /** Parties du .docx enregistré de l'écrit `title`. */
  const docxPart = async (title, part) => {
    const b64 = await page.evaluate(async (title) => {
      const { host } = await import('/src/lib/platform.ts');
      const d = window.__store.getState().drafts.find((x) => x.title === title);
      const u = new Uint8Array(await host.readFile(d.id, d.fileName));
      let s = '';
      for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
      return btoa(s);
    }, title);
    const f = path.join(TMP, `${title.replace(/\W+/g, '_')}.docx`);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    return execFileSync('unzip', ['-p', f, part], { encoding: 'utf8' });
  };
  /** Attend l'enregistrement (à la fermeture de l'écrit) : le .docx contient `needle`. */
  const waitSaved = async (title, needle) => {
    for (let i = 0; i < 40; i++) {
      if ((await docxPart(title, 'word/document.xml')).includes(needle)) return true;
      await sleep(250);
    }
    return false;
  };
  const docDefaultFont = (stylesXml) => /<w:rPrDefault>[\s\S]*?<w:rFonts\b[^>]*w:ascii="([^"]+)"/.exec(stylesXml)?.[1] ?? null;
  const reloadApp = async () => {
    await page.reload();
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });
    await sleep(500);
  };

  await page.evaluate(() => window.__store.getState().updateSettings({ newDraftFont: 'Times New Roman' }));

  // ── A. Écrit vide : ⌘A + police (document entier) ──
  await newDraft('vide');
  await rename('Ecrit A');
  await clickPage();
  check('A. écrit vide : barre en Times New Roman (police des nouveaux écrits)', (await label()) === TNR, await label());
  await page.keyboard.press('Control+a');
  await sleep(250);
  await pickFont(FONT);
  check(`A. ⌘A + ${FONT} : la barre affiche ${FONT}`, (await label()) === FONT, await label());
  await type('Premier paragraphe écrit.');
  check(`A. texte tapé ensuite en ${FONT}`, (await runFont('Premier')) === FONT, await runFont('Premier'));
  await page.keyboard.press('Enter');
  await type('Deuxième paragraphe.');
  check(`A. nouveau paragraphe en ${FONT}`, (await runFont('Deuxième')) === FONT, await runFont('Deuxième'));
  // quitter l'écrit tout de suite, revenir
  await openDraft('Ecrit A');
  check(`A. retour : barre ${FONT} (curseur au début)`, (await label()) === FONT, await label());
  check(`A. retour : texte peint en ${FONT}`, (await runFont('Premier')) === FONT && (await runFont('Deuxième')) === FONT);
  await clickAfter('Deuxième');
  await page.keyboard.press('Enter');
  await sleep(250);
  check(`A. retour : nouveau paragraphe, barre ${FONT}`, (await label()) === FONT, await label());
  await type('Troisième ajouté au retour.');
  check(`A. retour : texte tapé en ${FONT}`, (await runFont('Troisième')) === FONT, await runFont('Troisième'));
  await list();
  check('A. écrit enregistré en le quittant', await waitSaved('Ecrit A', 'Troisième'));
  {
    const st = await docxPart('Ecrit A', 'word/styles.xml');
    check(`A. .docx : police du document (w:docDefaults) = ${FONT}`, docDefaultFont(st) === FONT, docDefaultFont(st));
  }
  // relancer l'app
  await reloadApp();
  await openDraft('Ecrit A');
  check(`A. après relance : barre ${FONT}`, (await label()) === FONT, await label());
  await clickAfter('Troisième');
  await page.keyboard.press('Enter');
  await type('Quatrième après relance.');
  check(`A. après relance : texte tapé en ${FONT}`, (await runFont('Quatrième')) === FONT, await runFont('Quatrième'));

  // ── B. Texte existant : ⌘A + police, frappe par-dessus, Retour arrière, annuler ──
  await newDraft('vide');
  await rename('Ecrit B');
  await clickPage();
  await type('Texte initial en Times.');
  await page.keyboard.press('Enter');
  await type('Second paragraphe initial.');
  await page.keyboard.press('Control+a');
  await sleep(250);
  await pickFont(FONT);
  check(`B. ⌘A + ${FONT} : texte peint dans la police`, (await runFont('initial en')) === FONT && (await runFont('Second')) === FONT, `${await runFont('initial en')} / ${await runFont('Second')}`);
  await page.keyboard.press('Control+z');
  await sleep(500);
  check('B. annuler : le texte revient en Times New Roman', (await runFont('initial en')) === TNR && (await runFont('Second')) === TNR, `${await runFont('initial en')} / ${await runFont('Second')}`);
  await page.keyboard.press('Control+End');
  await sleep(250);
  check('B. annuler : la barre revient à Times New Roman', (await label()) === TNR, await label());
  await page.keyboard.press('Control+Shift+z');
  await sleep(500);
  check(`B. rétablir : texte de nouveau en ${FONT}`, (await runFont('initial en')) === FONT && (await runFont('Second')) === FONT, `${await runFont('initial en')} / ${await runFont('Second')}`);
  await page.keyboard.press('Control+a');
  await sleep(250);
  await pickFont(FONT);
  await type('Remplacement');
  check(`B. frappe par-dessus la sélection : texte tapé en ${FONT}`, (await runFont('Remplacement')) === FONT, await runFont('Remplacement'));
  await page.keyboard.press('Control+a');
  await sleep(250);
  await pickFont(FONT2);
  await page.keyboard.press('Backspace');
  await sleep(400);
  check(`B. ⌘A + ${FONT2} + Retour arrière : la barre garde ${FONT2}`, (await label()) === FONT2, await label());
  await type('Après effacement');
  check(`B. texte tapé après effacement en ${FONT2}`, (await runFont('Après effacement')) === FONT2, await runFont('Après effacement'));
  await openDraft('Ecrit B');
  check(`B. retour : barre ${FONT2}`, (await label()) === FONT2, await label());
  check(`B. retour : texte en ${FONT2}`, (await runFont('Après effacement')) === FONT2, await runFont('Après effacement'));

  // ── C. Curseur seul dans un écrit vide ──
  await newDraft('vide');
  await rename('Ecrit C');
  await clickPage();
  await pickFont(FONT);
  await clickPage();
  check(`C. police choisie, nouveau clic dans la page : barre ${FONT}`, (await label()) === FONT, await label());
  await type('Bonjour le monde');
  check(`C. texte tapé en ${FONT}`, (await runFont('Bonjour')) === FONT, await runFont('Bonjour'));
  await list();
  check('C. écrit enregistré en le quittant', await waitSaved('Ecrit C', 'Bonjour'));
  {
    const st = await docxPart('Ecrit C', 'word/styles.xml');
    check(`C. .docx : police du document = ${FONT}`, docDefaultFont(st) === FONT, docDefaultFont(st));
  }
  await reloadApp();
  await openDraft('Ecrit C');
  check(`C. après relance : barre ${FONT}`, (await label()) === FONT, await label());
  await clickAfter('monde');
  await page.keyboard.press('Enter');
  await type('Suite après relance');
  check(`C. après relance : nouveau texte en ${FONT}`, (await runFont('Suite après')) === FONT, await runFont('Suite après'));

  // ── D. Modèle « Dissertation » : curseur en fin de texte ──
  await newDraft('dissertation');
  await rename('Ecrit D');
  check('D. modèle Dissertation : titre en Times New Roman', (await runFont('Introduction')) === TNR, await runFont('Introduction'));
  await clickAfter('Ouverture');
  await pickFont(FONT);
  await type(' Phrase ajoutée');
  check(`D. texte tapé en fin de document en ${FONT}`, (await runFont('Phrase ajoutée')) === FONT, await runFont('Phrase ajoutée'));
  check('D. le reste du modèle garde Times New Roman', (await runFont('Introduction')) === TNR && (await runFont('Conclusion')) === TNR, `${await runFont('Introduction')} / ${await runFont('Conclusion')}`);
  await openDraft('Ecrit D');
  await clickAfter('Phrase ajoutée');
  check(`D. retour : curseur après le texte ajouté, barre ${FONT}`, (await label()) === FONT, await label());
  check('D. retour : le reste du modèle garde Times New Roman', (await runFont('Introduction')) === TNR, await runFont('Introduction'));
  {
    const st = await (async () => {
      await list();
      await waitSaved('Ecrit D', 'Phrase ajoutée');
      return docxPart('Ecrit D', 'word/styles.xml');
    })();
    check('D. .docx : police du document inchangée (Times New Roman)', docDefaultFont(st) === TNR, docDefaultFont(st));
  }

  // ── E. Favoris et récentes ──
  await openDraft('Ecrit D');
  await tb('font').click();
  await page.locator('.ed-font-row').first().waitFor({ timeout: 10000 });
  const row = page.locator(`.ed-font-row[data-font="${FAV}"]`).first();
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await row.locator('.ed-font-star').click();
  await sleep(300);
  await page.keyboard.press('Escape');
  await list();
  await sleep(1200);
  await reloadApp();
  const st = await page.evaluate(() => window.__store.getState().settings);
  check('E. après relance : favori conservé (réglages)', (st.editorFavoriteFonts ?? []).includes(FAV), st.editorFavoriteFonts);
  check(`E. après relance : récentes conservées (${FONT2}, ${FONT})`, (st.editorRecentFonts ?? [])[0] === FONT && (st.editorRecentFonts ?? []).includes(FONT2), st.editorRecentFonts);
  await openDraft('Ecrit D');
  await tb('font').click();
  await page.locator('.ed-font-row').first().waitFor({ timeout: 10000 });
  await sleep(300);
  const groups = await page.evaluate(() => {
    const out = {};
    let g = null;
    for (const el of document.querySelectorAll('.ed-font-list .ed-font-group, .ed-font-list .ed-font-row')) {
      if (el.classList.contains('ed-font-group')) out[(g = el.textContent.replace(/\s*\(\d+\)$/, ''))] = [];
      else if (g) out[g].push(el.dataset.font);
    }
    return out;
  });
  check('E. menu après relance : « Favoris » et « Récentes »', (groups.Favoris ?? []).includes(FAV) && (groups['Récentes'] ?? []).includes(FONT), { Favoris: groups.Favoris, Récentes: groups['Récentes'] });
  await page.keyboard.press('Escape');
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
