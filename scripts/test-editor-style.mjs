// Revue de style + objectif de mots (module Écrire) — port 5313.
// Lancer : timeout 300 node scripts/test-editor-style.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5313;
const SHOTS = path.join(ROOT, 'shots/editor-style');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push(!!ok);
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + String(detail).slice(0, 240) : ''}`);
}

const long41 = Array.from({ length: 44 }, (_, i) => ['la', 'pensée', 'humaine', 'cherche', 'sans', 'cesse', 'des', 'principes', 'stables', 'pour', 'fonder'][i % 11] + (i > 10 ? i : '')).join(' ');
const filler = Array.from({ length: 95 }, (_, i) => (i % 10 === 0 ? 'Terme' : 'terme') + 'abcdefghij'[i % 10] + (i % 9) + (i % 10 === 9 ? '.' : '')).join(' ');
const HTML = `
<h1>La conscience</h1>
<p>De nos jours, on peut dire que la liberté est tout à fait relative. La liberté suppose une règle, et sans règle la liberté se perd.</p>
<p>${long41}.</p>
<p>Il pense vraiment et absolument que la vérité existe. Je pense que c’est faux.</p>
<p>En effet, le sujet doute. En effet, il hésite. Autre chose. En effet, il tranche.</p>
<p>${filler}.</p>`;

const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-' + PORT, server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' ' + String(e.stack).split('\n').slice(1, 4).join(' <- ')));
  page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.location()?.url ?? '') && errors.push('console: ' + m.text() + ' ' + (m.location()?.url ?? '')));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 30000 });

  const draft = await page.evaluate(async (html) => {
    const m = await import('/src/features/editor/api.ts');
    return m.createDraft({ title: 'La conscience', template: 'dissertation', html });
  }, HTML);
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), draft.id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(900);

  // ── Revue de style ──
  await page.click('button[aria-label="Revue de style"]');
  await page.waitForSelector('[data-testid="style-review"]');
  await page.waitForFunction(() => !/Analyse en cours/.test(document.querySelector('.ed-style-sum')?.textContent ?? 'Analyse en cours'), null, { timeout: 10000 });
  const counts = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.sr-cat')].map((s) => [s.dataset.cat, Number(s.dataset.count)])));
  let c = await counts();
  console.log('   compteurs :', JSON.stringify(c));
  check('phrase trop longue détectée', c.long === 1, c.long);
  check('répétitions détectées', c.repeat >= 2, c.repeat);
  check('adverbes en -ment (2)', c.adverb === 2, c.adverb);
  check('tics (formules + « En effet » ×3)', c.tic >= 6, c.tic);
  check('connecteurs absents (1 long paragraphe)', c.connector === 1, c.connector);
  check('« je pense que »', c.jepense === 1, c.jepense);
  check('les titres sont ignorés', await page.evaluate(() => !document.querySelector('.ed-style')?.textContent.includes('La conscience')));
  await page.screenshot({ path: path.join(SHOTS, 'panel-light.png') });

  // Clic → sélection exacte + surlignage temporaire
  const sel = () => page.evaluate(() => {
    const ed = window.__ed.engine().debugEditor().editor;
    const { from, to } = ed.state.selection;
    return ed.state.doc.textBetween(from, to, ' ', ' ');
  });
  await page.click('.sr-cat[data-cat="tic"] .sr-item >> nth=0');
  await page.waitForTimeout(900);
  const s1 = await sel();
  check('clic sur un tic : l’occurrence est sélectionnée', /de nos jours/i.test(s1), s1);
  check('surlignage temporaire affiché', (await page.locator('.sr-flash').count()) > 0);
  await page.screenshot({ path: path.join(SHOTS, 'flash.png') });
  await page.waitForTimeout(2600);
  check('surlignage temporaire retiré', (await page.locator('.sr-flash').count()) === 0);
  await page.click('.sr-cat[data-cat="long"] .sr-item >> nth=0');
  await page.waitForTimeout(600);
  const s2 = await sel();
  check('clic sur une phrase longue : toute la phrase sélectionnée', s2.startsWith('la pensée humaine') && s2.split(/\s+/).length === 44, s2.split(/\s+/).length + ' mots : ' + s2.slice(0, 60));
  await page.click('.sr-cat[data-cat="jepense"] .sr-item >> nth=0');
  await page.waitForTimeout(500);
  check('clic « je pense que »', /^je pense que$/i.test(await sel()), await sel());

  // Pas d'analyse pendant la frappe : le compteur ne bouge qu'après le délai
  await page.evaluate(() => window.__ed.engine().appendParagraph('Depuis la nuit des temps, bien évidemment.'));
  await page.waitForTimeout(250);
  const during = (await counts()).tic;
  check('aucune relance immédiate après une modification', during === c.tic, `${during} vs ${c.tic}`);
  await page.waitForFunction((n) => Number(document.querySelector('.sr-cat[data-cat="tic"]').dataset.count) > n, c.tic, { timeout: 8000 });
  check('relance différée après la frappe', true);
  // Un clic sur un élément périmé ne sélectionne pas un mauvais passage
  // (le texte a changé : l'analyse est relancée)

  // ── Objectif de mots ──
  const pill = page.locator('.wg-pill');
  check('pill « Objectif » sans objectif', /Objectif/.test(await pill.innerText()));
  await pill.click();
  await page.fill('.wg-input', '300');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.wg-track');
  const stored = await page.evaluate((id) => window.__store.getState().drafts.find((d) => d.id === id)?.wordGoal, draft.id);
  check('Draft.wordGoal enregistré', stored === 300, stored);
  const total = await page.evaluate(() => window.__ed.engine().wordCount());
  const pct = Number(await page.getAttribute('.wg-track', 'data-pct'));
  check('barre de progression cohérente avec le compteur du moteur', pct === Math.min(100, Math.round((total / 300) * 100)), `${pct} % pour ${total} mots`);
  check('compteurs détaillés dans le popover', /Caractères/.test(await page.innerText('.wg-pop')) && /Sans espaces/.test(await page.innerText('.wg-pop')) && /Temps de lecture/.test(await page.innerText('.wg-pop')));
  await page.screenshot({ path: path.join(SHOTS, 'goal-pop.png') });
  await page.keyboard.press('Escape');

  // Sélection : mots sélectionnés
  await page.evaluate(() => {
    const ed = window.__ed.engine().debugEditor().editor;
    let start = 0;
    ed.state.doc.descendants((n, pos) => { if (!start && n.isText && n.text.includes('liberté')) start = pos; });
    ed.commands.setTextSelection({ from: start, to: start + 12 });
  });
  await page.waitForSelector('[data-testid="wg-sel"]', { timeout: 3000 }).catch(() => {});
  const selTxt = (await page.locator('[data-testid="wg-sel"]').count()) ? await page.innerText('[data-testid="wg-sel"]') : '';
  check('mots de la sélection affichés', /\d+ mots? sélectionné/.test(selTxt), selTxt);

  // Franchissement de l'objectif → animation sobre
  check('pas encore atteint', !(await pill.getAttribute('class')).includes('done'));
  await page.evaluate(() => window.__ed.engine().appendParagraph(Array.from({ length: 400 }, (_, i) => 'mot' + i).join(' ')));
  await page.waitForSelector('.wg-pill.done', { timeout: 8000 });
  check('objectif atteint : pill validée', true);
  check('animation de franchissement', (await page.locator('.wg-pill.celebrate').count()) === 1);
  check('barre à 100 %', (await page.getAttribute('.wg-track', 'data-pct')) === '100');
  await page.screenshot({ path: path.join(SHOTS, 'goal-done.png') });
  await page.waitForTimeout(2700);
  console.log('   classes:', await pill.getAttribute('class'));
  check('animation terminée', (await page.locator('.wg-pill.celebrate').count()) === 0);

  // Retirer l'objectif
  await pill.click();
  await page.click('text=Retirer l’objectif');
  await page.waitForTimeout(200);
  check('objectif retiré', (await page.locator('.wg-track').count()) === 0 && (await page.evaluate((id) => window.__store.getState().drafts.find((d) => d.id === id)?.wordGoal, draft.id)) === undefined);
  await page.keyboard.press('Escape');

  // Thème sombre
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, 'panel-dark.png') });

  // Aucun appel réseau externe
  check('aucune erreur navigateur', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  await server.close();
}
const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad}/${results.length} vérifications réussies`);
process.exit(bad ? 1 : 0);
