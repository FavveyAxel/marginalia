// Correcteur orthographique français (nspell + dictionary-fr, Web Worker) — port 5312.
// Lancer : timeout 600 node scripts/test-editor-spell.mjs
// Vérifie : faute soulignée, apostrophes / traits d'union / URL / MAJUSCULES non signalés,
// suggestion appliquée, « Ignorer », « Ajouter au dictionnaire » (persistant), interrupteur,
// correcteur natif coupé ; mesure les temps de chargement et de vérification.
import { shot } from './harness.mjs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5312;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
}

const TEXT1 =
  'Aujourd’hui, l’homme qu’il voit est libre ; jusqu’à présent c’est l’œuvre d’autrui. ' +
  'La philosofie de Kant, la phénoménologie de Husserl et l’épochè, Merleau-Ponty et Ricœur. ' +
  'Va-t-en, dit-il, peut-être. Voir https://exemple.fr/pagge-inexistantte ou ecrire@exempple.fr, l’UNESCO en 2024 et le XVIIe siècle. ' +
  'Le mot consience est fautif.';
const TEXT2 = 'Un mot inventé : brouzouf. Aujourd\'hui l\'homme (apostrophe droite).';

async function underlined(page) {
  return page.evaluate(() => {
    const p = window.__ed.engine().presentation();
    const ed = p.editor;
    const slices = p.proofingManager?.getPaintSlices() ?? [];
    const words = slices.map((s) => ed.state.doc.textBetween(s.pmFrom, s.pmTo));
    const dom = Array.from(document.querySelectorAll('.ed-engine .sd-proofing-spelling')).map((e) => e.textContent);
    return { words, dom };
  });
}

/** Rectangle (écran) d'un mot souligné dans les pages peintes. */
async function wordRect(page, word) {
  return page.evaluate((w) => {
    const els = Array.from(document.querySelectorAll('.ed-engine .sd-proofing-spelling'));
    const el = els.find((e) => e.textContent === w) ?? els.find((e) => e.textContent?.includes(w));
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, word);
}

async function rightClickWord(page, word) {
  const r = await wordRect(page, word);
  if (!r) return false;
  await page.waitForTimeout(150);
  const r2 = await wordRect(page, word);
  await page.mouse.click(r2.x, r2.y, { button: 'right' });
  await page.waitForSelector('.ed-spell-menu', { timeout: 5000 }).catch(() => null);
  await page.waitForFunction(() => !document.querySelector('.ed-spell-menu')?.textContent?.includes('Recherche'), null, { timeout: 10000 }).catch(() => null);
  return !!(await page.$('.ed-spell-menu'));
}

/** Curseur loin des mots testés (le mot sous le curseur n'est jamais souligné). */
async function caretToEnd(page) {
  await page.evaluate(() => {
    const ed = window.__ed.engine().presentation().editor;
    const end = ed.state.doc.content.size - 1;
    ed.commands.setTextSelection({ from: end, to: end });
  });
}

const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), // HMR et surveillance coupés : d'autres modules peuvent être modifiés pendant le test.
  server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
const external = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('response', (r) => r.status() >= 400 && errors.push(r.status() + ' : ' + r.url()));
page.on('worker', (w) => { console.log('  [worker]', w.url()); w.on('console', (m) => console.log('  [worker console]', m.text())); });
page.on('requestfailed', (r) => errors.push('échec : ' + r.url()));
page.on('framenavigated', (f) => f === page.mainFrame() && console.log('  [navigation]', f.url()));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
  if (/correcteur/.test(m.text())) console.log('  [console]', m.text());
});
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith(`http://localhost:${PORT}`) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
});
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await page.evaluate(() => {
    localStorage.removeItem('marginalia.ed.spell.personal');
    localStorage.removeItem('marginalia.ed.spellcheck');
  });

  const draft = await page.evaluate(
    async ({ t1, t2 }) => {
      const m = await import('/src/features/editor/api.ts');
      return m.createDraft({ title: 'Correcteur', html: `<p>${t1}</p><p>${t2}</p>` });
    },
    { t1: TEXT1, t2: TEXT2 },
  );
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), draft.id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  const tOpen = Date.now();
  await caretToEnd(page);

  // ── 1. Chargement et soulignement ──
  const okLoad = await page
    .waitForFunction(() => document.querySelectorAll('.ed-engine .sd-proofing-spelling').length >= 3, null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  const tUnderline = Date.now() - tOpen;
  const timings = await page.evaluate(() => ({ ...window.__spell?.client?.timings }));
  check('Dictionnaire chargé dans le Web Worker, fautes soulignées', okLoad, `premier soulignement ${tUnderline} ms après ouverture ; worker prêt en ${timings.readyMs} ms (lecture ${timings.fetchMs} ms, analyse nspell ${timings.parseMs} ms)`);

  let u = await underlined(page);
  console.log('  soulignés :', JSON.stringify(u.words));
  check('« philosofie », « consience », « brouzouf » soulignés', ['philosofie', 'consience', 'brouzouf'].every((w) => u.words.includes(w)), u.words.join(', '));
  const falsePos = u.words.filter((w) => !['philosofie', 'consience', 'brouzouf'].includes(w));
  check('Aucun faux positif (apostrophes ’ et \', traits d’union, URL, courriel, MAJUSCULES, chiffres, lexique de philosophie)', falsePos.length === 0, falsePos.join(', ') || 'aucun');
  check('Soulignement ondulé peint sur la page', u.dom.length >= 3 && (await page.evaluate(() => getComputedStyle(document.querySelector('.ed-engine .sd-proofing-spelling')).textDecorationStyle)) === 'wavy', `${u.dom.length} décorations`);
  const spellAttr = await page.evaluate(() => window.__ed.engine().presentation().editor.view.dom.getAttribute('spellcheck'));
  check('Correcteur natif de Chromium coupé (spellcheck=false)', spellAttr === 'false', `spellcheck=${spellAttr}`);
  await shot(page, 'shots/editor-spell/1-souligne.png');

  // ── 2. Suggestion appliquée ──
  const opened = await rightClickWord(page, 'philosofie');
  const sugg = await page.$$eval('.ed-spell-menu [data-spell-sugg]', (els) => els.map((e) => e.dataset.spellSugg));
  check('Clic droit : menu de suggestions (5 au plus)', opened && sugg.length > 0 && sugg.length <= 5, sugg.join(', '));
  await shot(page, 'shots/editor-spell/2-menu.png');
  const sugT = await page.evaluate(() => window.__spell.client.timings.lastSuggestMs);
  console.log(`  suggestions calculées en ${sugT} ms`);
  if (sugg.includes('philosophie')) await page.click('.ed-spell-menu [data-spell-sugg="philosophie"]');
  await page.waitForTimeout(300);
  const txt = await page.evaluate(() => window.__ed.engine().plainText());
  check('Suggestion « philosophie » appliquée dans le texte', txt.includes('La philosophie de Kant') && !txt.includes('philosofie'), txt.slice(0, 120));
  await caretToEnd(page);
  await page.waitForTimeout(1200);
  u = await underlined(page);
  check('Le mot corrigé n’est plus souligné, les fautes suivantes restent bien placées', JSON.stringify(u.words) === JSON.stringify(['consience', 'brouzouf']), JSON.stringify(u.words));
  // saisie au début du document : les soulignements des paragraphes suivants suivent le texte
  await page.evaluate(() => {
    const ed = window.__ed.engine().presentation().editor;
    let first = -1;
    ed.state.doc.descendants((n, p) => {
      if (first < 0 && n.isText) first = p;
      return first < 0;
    });
    ed.view.dispatch(ed.state.tr.insertText('Incipit. ', first));
  });
  await caretToEnd(page);
  await page.waitForTimeout(1200);
  u = await underlined(page);
  check('Après une saisie en tête : soulignements recalés', JSON.stringify(u.words) === JSON.stringify(['consience', 'brouzouf']) && JSON.stringify(u.dom) === JSON.stringify(['consience', 'brouzouf']), JSON.stringify(u));

  // ── 3. Ajouter au dictionnaire (persistant) ──
  await rightClickWord(page, 'brouzouf');
  await page.click('.ed-spell-menu [data-spell-action="add"]');
  await page.waitForTimeout(300);
  const personal = await page.evaluate(() => JSON.parse(localStorage.getItem('marginalia.ed.spell.personal') ?? '[]'));
  u = await underlined(page);
  check('« Ajouter au dictionnaire » : mot enregistré (localStorage) et plus souligné', personal.includes('brouzouf') && !u.words.includes('brouzouf'), JSON.stringify(personal));
  // nouveau paragraphe : le worker ne doit plus le signaler ; une autre faute, si
  await page.evaluate(() => window.__ed.engine().appendParagraph('Encore brouzouf, et une erreure nouvelle.'));
  await caretToEnd(page);
  const okNew = await page
    .waitForFunction(() => {
      const p = window.__ed.engine().presentation();
      return (p.proofingManager?.getPaintSlices() ?? []).some((s) => p.editor.state.doc.textBetween(s.pmFrom, s.pmTo) === 'erreure');
    }, null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  u = await underlined(page);
  check('Vérification incrémentale : nouveau paragraphe vérifié, mot ajouté ignoré', okNew && !u.words.includes('brouzouf'), u.words.join(', '));
  const checkT = await page.evaluate(() => ({ ms: window.__spell.client.timings.lastCheckMs, n: window.__spell.client.timings.lastCheckSegments }));
  console.log(`  dernière vérification incrémentale : ${checkT.n} paragraphe(s) en ${checkT.ms} ms`);

  // ── 4. Ignorer ──
  await rightClickWord(page, 'consience');
  await page.click('.ed-spell-menu [data-spell-action="ignore"]');
  await page.waitForTimeout(300);
  u = await underlined(page);
  check('« Ignorer » retire le soulignement', !u.words.includes('consience'), u.words.join(', '));

  // ── 5. Interrupteur ──
  await page.click('[data-spell-toggle]');
  await page.waitForTimeout(400);
  const off = await page.evaluate(() => ({
    n: document.querySelectorAll('.ed-engine .sd-proofing-spelling').length,
    attr: window.__ed.engine().presentation().editor.view.dom.getAttribute('spellcheck'),
    pref: localStorage.getItem('marginalia.ed.spellcheck'),
  }));
  check('Interrupteur désactivé : plus de soulignement, correcteur natif rendu', off.n === 0 && off.attr === 'true' && off.pref === '0', JSON.stringify(off));
  await page.click('[data-spell-toggle]');
  await caretToEnd(page);
  const backOn = await page
    .waitForFunction(() => document.querySelectorAll('.ed-engine .sd-proofing-spelling').length > 0, null, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check('Interrupteur réactivé : soulignement revenu', backOn);

  // ── 5 bis. Noms propres ──
  const PROPRES = ['Marvel', 'Captain', 'America', 'Call', 'Duty', 'Postman'];
  await page.evaluate(() => window.__ed.engine().appendParagraph('Chez Marvel, Captain America s’illustre ; on joue à Call of Duty avec Postman. Postman l’avait pressenti, mais l’ortografe reste fautive.'));
  await caretToEnd(page);
  await page
    .waitForFunction(() => {
      const p = window.__ed.engine().presentation();
      return (p.proofingManager?.getPaintSlices() ?? []).some((s) => p.editor.state.doc.textBetween(s.pmFrom, s.pmTo) === 'ortografe');
    }, null, { timeout: 8000 })
    .catch(() => null);
  u = await underlined(page);
  check('Noms propres (Marvel, Captain America, Call of Duty, Postman) non soulignés, « ortografe » souligné', u.words.includes('ortografe') && !u.words.some((w) => PROPRES.includes(w) || w === 'of'), u.words.join(', '));
  await shot(page, 'shots/editor-spell/4-noms-propres.png');

  // Option « Ignorer les noms propres » : popover par clic droit sur l'icône
  await page.click('[data-spell-toggle]', { button: 'right' });
  await page.waitForSelector('[data-spell-opt="proper"]', { timeout: 5000 });
  const defaults = await page.evaluate(() => ({ en: document.querySelector('[data-spell-opt="enabled"]').checked, pr: document.querySelector('[data-spell-opt="proper"]').checked }));
  check('Popover du correcteur : deux cases cochées par défaut', defaults.en && defaults.pr, JSON.stringify(defaults));
  await page.click('[data-spell-opt="proper"]');
  await page.keyboard.press('Escape');
  await caretToEnd(page);
  const offOk = await page
    .waitForFunction((names) => {
      const p = window.__ed.engine().presentation();
      const w = (p.proofingManager?.getPaintSlices() ?? []).map((s) => p.editor.state.doc.textBetween(s.pmFrom, s.pmTo));
      return names.every((n) => w.includes(n));
    }, ['Marvel', 'Captain', 'Postman'], { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  u = await underlined(page);
  const pref = await page.evaluate(() => localStorage.getItem('marginalia.ed.spell.proper'));
  check('Option désactivée : les noms propres sont soulignés (comportement antérieur), préférence persistée', offOk && pref === '0', u.words.join(', ') + ' / pref=' + pref);
  await shot(page, 'shots/editor-spell/5-noms-propres-options-off.png');
  await page.click('[data-spell-toggle]', { button: 'right' });
  await page.waitForSelector('[data-spell-opt="proper"]', { timeout: 5000 });
  await page.click('[data-spell-opt="proper"]');
  await page.keyboard.press('Escape');
  await caretToEnd(page);
  const onOk = await page
    .waitForFunction(() => {
      const p = window.__ed.engine().presentation();
      const w = (p.proofingManager?.getPaintSlices() ?? []).map((s) => p.editor.state.doc.textBetween(s.pmFrom, s.pmTo));
      return !w.includes('Marvel') && w.includes('ortografe');
    }, null, { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check('Option réactivée : noms propres de nouveau ignorés', onOk && (await page.evaluate(() => localStorage.getItem('marginalia.ed.spell.proper'))) === '1');

  // ── 6. Débit du worker (document long) ──
  const perf = await page.evaluate(async () => {
    const c = window.__spell.client;
    const para = 'La conscience de soi, selon Hegel, n’est pas une donnée immédiate : elle se conquiert dans la reconnaissance, par la lutte et le travail, aujourd’hui comme hier.';
    const segs = Array.from({ length: 500 }, (_, i) => ({ id: 's' + i, text: para + ' ' + i }));
    const t0 = performance.now();
    await c.check(segs);
    const wall = performance.now() - t0;
    return { wall: Math.round(wall), worker: c.timings.lastCheckMs, words: para.split(/\s+/).length * 500 };
  });
  console.log(`  500 paragraphes (${perf.words} mots) : ${perf.worker} ms dans le worker, ${perf.wall} ms aller-retour`);
  check('Vérification d’un long document < 2 s', perf.wall < 2000, `${perf.wall} ms`);

  // ── 7. Frappe non bloquée pendant le chargement ? (thread principal libre) ──
  check('Aucune requête réseau externe', external.length === 0, external.slice(0, 3).join(' '));
  await shot(page, 'shots/editor-spell/3-final.png');
} catch (e) {
  console.error(e);
  check('Exécution du test', false, String(e));
} finally {
  if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + [...new Set(errors)].join('\n'));
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
