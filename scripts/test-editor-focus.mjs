// Mode concentration de l'éditeur (focus.tsx) — port 5372.
// Lancer : timeout 300 node scripts/test-editor-focus.mjs
// Long écrit → ⌘⇧F → frappe : interface effacée (sans saut de mise en page), petit mouvement sans
// effet, retour par le haut de la fenêtre et par Échap → paragraphes estompés (opacités mesurées)
// → machine à écrire (ligne du curseur vers le milieu après plusieurs Entrée) → réglages conservés
// après rechargement → saisie intacte → captures clair / sombre.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/editor-focus');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5372;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
}
async function shot(page, name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p });
  console.log('capture:', path.relative(ROOT, p));
}
async function openDraft(page, id) {
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(900);
}
/** Clique dans le texte du paragraphe qui contient `needle` (pages peintes). */
async function clickInText(page, needle) {
  const pt = await page.evaluate((needle) => {
    for (const line of document.querySelectorAll('.superdoc-page .superdoc-line')) {
      if (line.textContent.includes(needle)) {
        line.scrollIntoView({ block: 'center' });
        const r = line.getBoundingClientRect();
        return { x: r.left + Math.min(60, r.width / 2), y: r.top + r.height / 2 };
      }
    }
    return null;
  }, needle);
  if (!pt) throw new Error('texte introuvable : ' + needle);
  await page.waitForTimeout(200);
  const pt2 = await page.evaluate((needle) => {
    for (const line of document.querySelectorAll('.superdoc-page .superdoc-line')) {
      if (line.textContent.includes(needle)) {
        const r = line.getBoundingClientRect();
        return { x: r.left + Math.min(60, r.width / 2), y: r.top + r.height / 2 };
      }
    }
    return null;
  }, needle);
  await page.mouse.click(pt2.x, pt2.y);
  await page.waitForTimeout(250);
  return pt2;
}
const chromeOpacity = (page) =>
  page.evaluate(() => {
    const o = (s) => {
      const el = document.querySelector(s);
      return el ? { op: Number(getComputedStyle(el).opacity), pe: getComputedStyle(el).pointerEvents } : null;
    };
    return { top: o('.ed-topbar'), tb: o('.ed-toolbar-row'), outline: o('.ed-outline'), side: o('.ed-side'), count: o('.ed-count'), goal: o('.wg-group') };
  });
const pageTop = (page) => page.evaluate(() => document.querySelector('.superdoc-page').getBoundingClientRect().top);
const caretRatio = (page) =>
  page.evaluate(() => {
    const c = window.__ed.engine().caretCoords();
    const sc = document.querySelector('.ed-scroll');
    const r = sc.getBoundingClientRect();
    return c ? ((c.top + c.bottom) / 2 - r.top) / sc.clientHeight : null;
  });
const dimOpacities = (page) =>
  page.evaluate(() => {
    const frags = [...document.querySelectorAll('.superdoc-page [data-layout-fragment-id]')];
    const vis = frags.filter((f) => {
      const r = f.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    });
    const cur = vis.filter((f) => f.classList.contains('ed-cur')).map((f) => Number(getComputedStyle(f).opacity));
    const others = vis.filter((f) => !f.classList.contains('ed-cur')).map((f) => Number(getComputedStyle(f).opacity));
    const curText = vis.filter((f) => f.classList.contains('ed-cur')).map((f) => f.textContent.slice(0, 40));
    return { cur, others, curText };
  });

const server = await createServer({
  root: ROOT,
  cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`),
  server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' ' + (e.stack || '').slice(0, 600)));
page.on('console', (m) => m.type() === 'error' && !(m.location()?.url || '').endsWith('/favicon.ico') && errors.push('console: ' + m.text() + ' ' + (m.location()?.url || '')));
page.on('response', (r) => r.status() >= 400 && errors.push(r.status() + ' : ' + r.url()));

const PARAS = 40;
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await page.evaluate(() => {
    localStorage.removeItem('marginalia.ed.focusDim');
    localStorage.removeItem('marginalia.ed.typewriter');
  });
  const draft = await page.evaluate(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Concentration' }));
  await openDraft(page, draft.id);
  await page.evaluate((n) => {
    const e = window.__ed.engine();
    const words = 'la conscience est elle le propre de l’homme ou bien une illusion que la réflexion entretient sur elle même'.split(' ');
    for (let i = 0; i < n; i++) {
      const len = 25 + ((i * 17) % 45);
      e.appendParagraph(`§${i} ` + Array.from({ length: len }, (_, k) => words[(i + k) % words.length]).join(' ') + '.');
    }
  }, PARAS);
  await page.waitForTimeout(1500);

  // ── Mode concentration au clavier ──
  await page.keyboard.press('Control+Shift+KeyF');
  await page.waitForTimeout(400);
  check('⌘⇧F : mode concentration', await page.evaluate(() => document.querySelector('.ed-root').classList.contains('ed-focus')));
  const before = await chromeOpacity(page);
  check('interface visible avant la frappe', before.top?.op === 1 && before.tb?.op === 1 && before.count?.op === 1, JSON.stringify(before));

  await clickInText(page, '§12 ');
  await page.mouse.move(700, 450);
  const topBefore = await pageTop(page);
  await page.keyboard.press('End');
  await page.keyboard.type(' Une phrase ajoutée en mode concentration.', { delay: 15 });
  await page.waitForTimeout(900);
  const hidden = await chromeOpacity(page);
  const topAfter = await pageTop(page);
  check(
    'frappe : barres, plan, panneau et pastilles effacés',
    ['top', 'tb', 'outline', 'side', 'count', 'goal'].every((k) => !hidden[k] || (hidden[k].op < 0.05 && hidden[k].pe === 'none')),
    JSON.stringify(hidden),
  );
  check('aucun saut de mise en page', Math.abs(topAfter - topBefore) < 1, `${topBefore} → ${topAfter}`);
  await shot(page, 'focus-typing-light.png');

  // petit mouvement : pas de retour
  await page.mouse.move(705, 453, { steps: 3 });
  await page.waitForTimeout(400);
  check('mouvement minime : interface toujours effacée', (await chromeOpacity(page)).top.op < 0.05);
  // vers le haut de la fenêtre : retour
  await page.mouse.move(700, 40, { steps: 8 });
  await page.waitForTimeout(500);
  const back = await chromeOpacity(page);
  check('souris en haut : interface revenue', back.top.op === 1 && back.tb.op === 1 && back.top.pe !== 'none', JSON.stringify(back.top));
  // Échap
  await page.mouse.move(700, 450, { steps: 4 });
  await page.keyboard.type(' Encore.', { delay: 15 });
  await page.waitForTimeout(900);
  check('nouvelle frappe : effacée', (await chromeOpacity(page)).top.op < 0.05);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('Échap : interface revenue, concentration toujours active', (await chromeOpacity(page)).top.op === 1 && (await page.evaluate(() => !!document.querySelector('.ed-focus'))));
  // bord gauche (zone du plan)
  await page.keyboard.type('!', { delay: 15 });
  await page.waitForTimeout(900);
  await page.mouse.move(120, 450, { steps: 8 });
  await page.waitForTimeout(400);
  check('survol de la zone du plan : interface revenue', (await chromeOpacity(page)).outline.op === 1);

  // ── Paragraphes estompés (activé par défaut) ──
  await clickInText(page, '§15 ');
  await page.waitForTimeout(600);
  const dim = await dimOpacities(page);
  check(
    'paragraphe courant à pleine opacité, autres estompés',
    dim.cur.length >= 1 && dim.cur.every((o) => o === 1) && dim.others.length > 3 && dim.others.every((o) => o >= 0.35 && o <= 0.45),
    `courant ${JSON.stringify(dim.cur)} « ${dim.curText[0]} », autres ${[...new Set(dim.others)].join(', ')} (${dim.others.length})`,
  );
  check('le courant est bien §15', dim.curText.some((t) => t.startsWith('§15')));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(600);
  const dim2 = await dimOpacities(page);
  check('le paragraphe estompé suit le curseur', dim2.curText.length && !dim2.curText.some((t) => t.startsWith('§15')), dim2.curText.join(' | '));

  // ── Menu : machine à écrire ──
  await page.mouse.move(700, 30, { steps: 6 });
  await page.waitForTimeout(400);
  await page.click('[data-focus-options]');
  await page.waitForSelector('.ed-focus-options');
  await page.waitForTimeout(350);
  check('menu : concentration cochée, estomper coché, machine à écrire décochée', await page.evaluate(() => {
    const c = (k) => document.querySelector(`[data-focus-opt="${k}"]`).checked;
    return c('focus') && c('dim') && !c('typewriter');
  }));
  await shot(page, 'focus-menu-light.png');
  await page.click('[data-focus-opt="typewriter"]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('machine à écrire : espace ajouté en haut et en bas', await page.evaluate(() => {
    const sc = document.querySelector('.ed-scroll');
    const cs = getComputedStyle(sc);
    return sc.classList.contains('ed-tw') && parseFloat(cs.paddingTop) > sc.clientHeight * 0.3 && parseFloat(cs.paddingBottom) > sc.clientHeight * 0.4;
  }));
  await clickInText(page, '§20 ');
  await page.keyboard.press('End');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(`Ligne ${i} de la machine à écrire.`, { delay: 10 });
  }
  await page.waitForTimeout(900);
  const r1 = await caretRatio(page);
  check('machine à écrire : ligne du curseur vers le milieu', r1 !== null && Math.abs(r1 - 0.45) < 0.07, `ratio ${r1?.toFixed(3)}`);
  await shot(page, 'focus-typewriter-light.png');
  // défilement manuel : pas de lutte, puis recentrage à la frappe suivante
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(700);
  const r2 = await caretRatio(page);
  check('défilement manuel respecté', r2 !== null && r2 < 0.2, `ratio ${r2?.toFixed(3)}`);
  await page.keyboard.type('x', { delay: 10 });
  await page.waitForTimeout(1300);
  const r3 = await caretRatio(page);
  check('recentrage à la frappe suivante', r3 !== null && Math.abs(r3 - 0.45) < 0.07, `ratio ${r3?.toFixed(3)}`);
  // début du document : la première ligne atteint le milieu
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1300);
  const r4 = await caretRatio(page);
  check('première ligne : peut atteindre le milieu', r4 !== null && Math.abs(r4 - 0.45) < 0.08, `ratio ${r4?.toFixed(3)}`);

  // prefers-reduced-motion : pas de fondu, recentrage instantané
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await clickInText(page, '§30 ');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Sans animation.', { delay: 5 });
  await page.waitForTimeout(110);
  const r5 = await caretRatio(page);
  const tr = await page.evaluate(() => getComputedStyle(document.querySelector('.ed-topbar')).transitionDuration);
  check('mouvement réduit : recentrage instantané, sans fondu', r5 !== null && Math.abs(r5 - 0.45) < 0.07 && /^0s|^0\.001s|^1ms/.test(tr), `ratio ${r5?.toFixed(3)}, transition ${tr}`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(700);

  // saisie intacte
  const text = await page.evaluate(() => window.__ed.engine().plainText());
  check(
    'saisie intacte',
    text.includes('Une phrase ajoutée en mode concentration. Encore.!') && [0, 1, 2, 3, 4, 5].every((i) => text.includes(`Ligne ${i} de la machine à écrire.`)) && text.includes('§39 '),
  );

  // ── Sombre ──
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
  await page.waitForTimeout(300);
  await clickInText(page, '§8 ');
  await page.keyboard.type(' Nuit.', { delay: 15 });
  await page.mouse.move(705, 455);
  await page.waitForTimeout(1000);
  const dimDark = await dimOpacities(page);
  check('sombre : estompage', dimDark.cur.every((o) => o === 1) && dimDark.others.every((o) => o >= 0.35 && o <= 0.48), `${[...new Set(dimDark.others)].join(', ')}`);
  await shot(page, 'focus-typing-dark.png');
  await page.mouse.move(700, 30, { steps: 6 });
  await page.waitForTimeout(500);
  await shot(page, 'focus-revealed-dark.png');
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));

  // quitter : ⌘⇧F (ou Échap quand l'interface est visible)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Échap (interface visible) : quitte la concentration', await page.evaluate(() => !document.querySelector('.ed-focus') && !document.querySelector('.ed-dim')));
  check('hors concentration : paragraphes non estompés', await page.evaluate(() => !document.querySelector('.ed-cur')));
  check('hors concentration : machine à écrire toujours active', await page.evaluate(() => document.querySelector('.ed-scroll').classList.contains('ed-tw')));
  await page.evaluate(() => window.__ed.save(false));
  await page.waitForTimeout(500);

  // ── Rechargement : réglages conservés ──
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await openDraft(page, draft.id);
  await page.click('[data-focus-options]');
  await page.waitForSelector('.ed-focus-options');
  check('rechargement : estomper et machine à écrire conservés', await page.evaluate(() => {
    const c = (k) => document.querySelector(`[data-focus-opt="${k}"]`).checked;
    return c('dim') && c('typewriter') && !c('focus');
  }));
  await page.click('[data-focus-opt="dim"]');
  await page.click('[data-focus-opt="focus"]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await clickInText(page, '§5 ');
  await page.waitForTimeout(400);
  check('estomper décoché : aucun paragraphe estompé en concentration', await page.evaluate(() => !!document.querySelector('.ed-focus') && !document.querySelector('.ed-dim')));
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  check('rechargement : « estomper » décoché conservé', await page.evaluate(() => localStorage.getItem('marginalia.ed.focusDim') === '0' && localStorage.getItem('marginalia.ed.typewriter') === '1'));
  await openDraft(page, draft.id);
  const text2 = await page.evaluate(() => window.__ed.engine().plainText());
  check('texte retrouvé après rechargement', text2.includes('Ligne 5 de la machine à écrire.') && text2.includes('Nuit.') && text2.includes('Sans animation.'), JSON.stringify({ l5: text2.includes('Ligne 5'), nuit: text2.includes('Nuit.'), sans: text2.includes('Sans animation.'), len: text2.length }));
  await page.evaluate(() => {
    localStorage.removeItem('marginalia.ed.focusDim');
    localStorage.removeItem('marginalia.ed.typewriter');
  });

  check('aucune erreur de page', errors.length === 0, errors.join(' | '));
} catch (e) {
  console.error(e);
  check('déroulement', false, String(e).slice(0, 300));
  await shot(page, 'failure.png').catch(() => {});
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
