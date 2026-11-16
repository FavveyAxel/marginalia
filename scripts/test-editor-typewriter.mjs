// Machine à écrire de l'éditeur : chariot et sons de frappe (focus.tsx, typeSounds.ts) — port 5373.
// Lancer : timeout 300 node scripts/test-editor-typewriter.mjs
// ⌘⇧T → réglages (chariot et sons cochés par défaut) → frappe : le curseur reste au milieu de la
// largeur, la page glisse ; Entrée : le chariot revient → sons joués (touche, espace, retour
// arrière, retour chariot, clochette en fin de ligne) → chariot décoché : page recentrée → sons
// décochés : silence → réglages conservés après rechargement → saisie intacte.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/editor-typewriter');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5373;
const KEYS = ['typewriter', 'twCarriage', 'twSounds', 'twVolume'].map((k) => 'marginalia.ed.' + k);

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
async function clickInText(page, needle) {
  const find = (needle) => {
    for (const line of document.querySelectorAll('.superdoc-page .superdoc-line')) {
      if (line.textContent.includes(needle)) {
        line.scrollIntoView({ block: 'center' });
        const r = line.getBoundingClientRect();
        return { x: r.left + Math.min(60, r.width / 2), y: r.top + r.height / 2 };
      }
    }
    return null;
  };
  if (!(await page.evaluate(find, needle))) throw new Error('texte introuvable : ' + needle);
  await page.waitForTimeout(200);
  const pt = await page.evaluate(find, needle);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
}
/** Écart horizontal (px) entre le curseur et le milieu de la zone d'écriture, et position de la page. */
const carriage = (page) =>
  page.evaluate(() => {
    const c = window.__ed.engine().caretCoords();
    const sc = document.querySelector('.ed-scroll');
    const r = sc.getBoundingClientRect();
    const pg = document.querySelector('.superdoc-page').getBoundingClientRect();
    const col = document.querySelector('.ed-center').getBoundingClientRect();
    const body = document.querySelector('.ed-body').getBoundingClientRect();
    return { off: c ? c.left - (r.left + sc.clientWidth / 2) : null, pageLeft: pg.left, pageMid: pg.left + pg.width / 2 - (col.left + col.width / 2), wide: Math.abs(r.left - body.left) < 2 && Math.abs(r.right - body.right) < 2, scrollLeft: sc.scrollLeft, on: sc.classList.contains('ed-tw-x') };
  });
/** Mode concentration : rappelle l'interface (souris en haut) puis ouvre le menu des réglages. */
async function openMenu(page) {
  await page.mouse.move(700, 300);
  await page.mouse.move(700, 20);
  await page.waitForTimeout(350);
  await page.click('[data-focus-options]');
  await page.waitForSelector('.ed-focus-options');
  await page.waitForTimeout(200);
}
const log = (page) => page.evaluate(() => window.__twLog.splice(0));
const count = (l, k) => l.filter((x) => x === k).length;

const server = await createServer({
  root: ROOT,
  cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`),
  server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.__twLog = [];
  window.__twStrikes = [];
});
const page = await ctx.newPage();
const errors = [];
const sounds = new Set();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && !(m.location()?.url || '').endsWith('/favicon.ico') && errors.push('console: ' + m.text()));
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(r.status() + ' : ' + r.url());
  if (r.url().endsWith('.wav') && r.status() === 200) sounds.add(new URL(r.url()).pathname.split('/').pop());
});
page.on('request', (r) => !r.url().startsWith(`http://localhost:${PORT}/`) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && errors.push('requête externe : ' + r.url()));

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await page.evaluate((keys) => keys.forEach((k) => localStorage.removeItem(k)), KEYS);
  const draft = await page.evaluate(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Machine à écrire' }));
  await openDraft(page, draft.id);
  await page.evaluate(() => {
    const e = window.__ed.engine();
    const words = 'le souvenir revient par bribes comme une lampe que l’on rallume dans une maison longtemps fermée'.split(' ');
    for (let i = 0; i < 14; i++) e.appendParagraph(`§${i} ` + Array.from({ length: 30 + ((i * 13) % 30) }, (_, k) => words[(i + k) % words.length]).join(' ') + '.');
    for (const t of ['Un court paragraphe pour le chariot.', 'Un autre court paragraphe.', 'Le dernier court paragraphe.']) e.appendParagraph(t);
  });
  await page.waitForTimeout(1200);
  const rest = await carriage(page);
  check('au départ : pas de chariot, page au milieu', !rest.on && Math.abs(rest.pageMid) < 30, JSON.stringify(rest));

  // ── ⌘⇧T ──
  await clickInText(page, '§6 ');
  await page.keyboard.press('Control+Shift+KeyT');
  await page.waitForTimeout(700);
  check('⌘⇧T : machine à écrire allumée, en plein écran', await page.evaluate(() => localStorage.getItem('marginalia.ed.typewriter') === '1' && document.querySelector('.ed-scroll').classList.contains('ed-tw') && document.querySelector('.ed-root').classList.contains('ed-focus')));
  await openMenu(page);
  await page.waitForTimeout(300);
  check('menu : chariot et sons cochés par défaut, volume 50 %', await page.evaluate(() => {
    const q = (k) => document.querySelector(`[data-focus-opt="${k}"]`);
    return q('typewriter').checked && q('carriage').checked && q('sounds').checked && q('volume').value === '50';
  }));
  await shot(page, 'menu.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('fichiers son chargés depuis l’app (18)', sounds.size === 18, [...sounds].sort().join(' '));

  // ── Chariot ──
  await clickInText(page, 'Un court paragraphe');
  await page.keyboard.press('End');
  await page.waitForTimeout(900);
  const end = await carriage(page);
  check('chariot : le curseur se tient au milieu de la largeur', end.on && end.off !== null && Math.abs(end.off) < 4, JSON.stringify(end));
  check('chariot : la zone d’écriture prend toute la largeur de l’éditeur, repère affiché', end.wide && (await page.evaluate(() => {
    const g = document.querySelector('.ed-tw-guide')?.getBoundingClientRect();
    const c = window.__ed.engine().caretCoords();
    return !!g && Math.abs(g.left + g.width / 2 - c.left) < 4 && g.top >= c.bottom && g.top - c.bottom < 12;
  })));
  await log(page);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const home = await carriage(page);
  check('Entrée : le chariot revient (la page repart vers la droite)', Math.abs(home.off) < 4 && home.pageLeft > end.pageLeft + 100, `page ${Math.round(end.pageLeft)} → ${Math.round(home.pageLeft)}`);
  check('Entrée : son du retour chariot', JSON.stringify(await log(page)) === '["return"]');
  await shot(page, 'retour-chariot.png');

  await page.evaluate(() => window.__twStrikes.splice(0));
  await page.keyboard.type('Dix mots saisi', { delay: 60 });
  // dernière lettre : calque relevé pendant l'animation
  await page.keyboard.type('s');
  const struck = await page.waitForFunction(() => {
    const el = document.querySelector('.ed-tw-strike');
    const c = window.__ed.engine().caretCoords();
    if (!el || !c) return null;
    const r = el.getBoundingClientRect();
    return { ch: el.textContent, dx: Math.abs(r.right - c.left), dy: Math.abs((r.top + r.bottom) / 2 - (c.top + c.bottom) / 2), in: !!el.closest('.ed-scroll') };
  }, null, { timeout: 2000, polling: 'raf' }).then((h) => h.jsonValue()).catch(() => null);
  await page.keyboard.type('W');
  await page.waitForFunction(() => { const el = document.querySelector('.ed-tw-strike'); if (!el || el.textContent !== 'W') return false; const an = el.getAnimations()[0]; an.pause(); an.currentTime = 25; return true; }, null, { timeout: 2000, polling: 'raf' }).catch(() => {});
  { const c = await page.evaluate(() => window.__ed.engine().caretCoords()); await page.screenshot({ path: path.join(OUT, 'lettre.png'), clip: { x: c.left - 220, y: c.top - 60, width: 440, height: 140 } }); }
  await page.evaluate(() => document.querySelector('.ed-tw-strike')?.getAnimations()[0]?.finish());
  await page.keyboard.press('Backspace');
  await page.evaluate(() => window.__twLog.splice(-2));
  check('frappe : la lettre tapée s’anime sur place', !!struck && struck.ch === 's' && struck.dx < 14 && struck.dy < 12 && struck.in, JSON.stringify(struck));
  await page.waitForTimeout(400);
  const strikes = await page.evaluate(() => window.__twStrikes.splice(0));
  check('frappe : une animation par lettre, aucune pour les espaces, calques retirés', strikes.join('') === 'DixmotssaisisW' && (await page.evaluate(() => !document.querySelector('.ed-tw-strike'))), strikes.join(''));
  await page.waitForTimeout(700);
  const typed = await carriage(page);
  check('frappe : la page glisse vers la gauche, le curseur ne bouge pas', Math.abs(typed.off) < 4 && typed.pageLeft < home.pageLeft - 60, `page ${Math.round(home.pageLeft)} → ${Math.round(typed.pageLeft)}, écart ${typed.off.toFixed(1)}`);
  const l1 = await log(page);
  check('frappe : un son par touche, espaces à part', count(l1, 'key') === 13 && count(l1, 'space') === 2 && l1.length === 15, l1.join(' '));
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
  const back = await carriage(page);
  check('retour arrière : son et page qui recule', JSON.stringify(await log(page)) === '["back","back"]' && back.pageLeft > typed.pageLeft + 5 && Math.abs(back.off) < 4);
  await page.keyboard.press('Control+KeyB');
  await page.keyboard.press('Control+KeyB');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  check('raccourcis et flèches : silence', (await log(page)).length === 0);

  // ── Fin de ligne : clochette puis retour chariot ──
  await page.keyboard.type(' ' + Array.from({ length: 30 }, (_, i) => 'mot' + i).join(' '), { delay: 12 });
  await page.waitForTimeout(900);
  const l2 = await log(page);
  const bi = l2.indexOf('bell');
  check('fin de ligne : clochette puis retour chariot', bi > 0 && l2[bi + 1] === 'return' && count(l2, 'bell') >= 1 && count(l2, 'bell') <= 2 && count(l2, 'bell') === count(l2, 'return'), `${count(l2, 'bell')} clochette(s), ${count(l2, 'return')} retour(s)`);
  const wrapped = await carriage(page);
  check('après le passage à la ligne : curseur toujours au milieu', Math.abs(wrapped.off) < 4, `écart ${wrapped.off.toFixed(1)}`);
  await shot(page, 'frappe.png');
  await page.evaluate(() => window.__store.getState().setTheme?.('dark'));
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(500);
  await shot(page, 'frappe-sombre.png');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

  // ── Volume ──
  await openMenu(page);
  await page.fill('[data-focus-opt="volume"]', '80');
  check('volume réglé et mémorisé', await page.evaluate(() => localStorage.getItem('marginalia.ed.twVolume') === '0.8'));
  // ── Chariot décoché ──
  await page.click('[data-focus-opt="carriage"]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const off = await carriage(page);
  check('chariot décoché : page revenue au milieu, plus de repère', !off.on && off.scrollLeft === 0 && Math.abs(off.pageMid - rest.pageMid) < 6 && (await page.evaluate(() => !document.querySelector('.ed-tw-stage'))), JSON.stringify(off));
  await clickInText(page, 'Un autre court');
  await page.keyboard.press('End');
  await page.keyboard.type(' Sans chariot.', { delay: 15 });
  await page.waitForTimeout(600);
  const still = await carriage(page);
  const l3 = await log(page);
  check('sans chariot : la page ne glisse plus, les sons restent', Math.abs(still.pageLeft - off.pageLeft) < 1 && count(l3, 'key') === 12 && count(l3, 'space') === 2, l3.join(' '));
  // ── Sons décochés ──
  await openMenu(page);
  await page.click('[data-focus-opt="sounds"]');
  check('sons décochés : plus de réglage de volume', await page.evaluate(() => !document.querySelector('[data-focus-opt="volume"]')));
  await page.keyboard.press('Escape');
  await clickInText(page, 'Sans chariot.');
  await page.keyboard.press('End');
  await page.keyboard.type(' Silence.', { delay: 15 });
  await page.waitForTimeout(300);
  check('sons décochés : silence', (await log(page)).length === 0);

  const text = await page.evaluate(() => window.__ed.engine().plainText());
  check('saisie intacte', text.includes('Dix mots sais mot0 mot1') && text.includes('mot29') && text.includes('Sans chariot. Silence.'), JSON.stringify(text.slice(-300)));
  await page.evaluate(() => window.__ed.save(true));
  await page.waitForTimeout(600);

  // ── Rechargement ──
  await page.reload();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  await openDraft(page, draft.id);
  await openMenu(page);
  check('rechargement : réglages conservés', await page.evaluate(() => {
    const q = (k) => document.querySelector(`[data-focus-opt="${k}"]`);
    return q('typewriter').checked && !q('carriage').checked && !q('sounds').checked;
  }));
  await page.click('[data-focus-opt="carriage"]');
  await page.click('[data-focus-opt="sounds"]');
  check('volume conservé', await page.evaluate(() => document.querySelector('[data-focus-opt="volume"]').value === '80'));
  await page.keyboard.press('Escape');
  const text2 = await page.evaluate(() => window.__ed.engine().plainText());
  check('texte retrouvé après rechargement', text2.includes('Sans chariot. Silence.'));

  // ── Mouvement réduit : chariot sans glissement ──
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await clickInText(page, 'Le dernier court');
  await page.keyboard.press('End');
  await page.evaluate(() => window.__twStrikes.splice(0));
  await page.keyboard.type(' Net.', { delay: 15 });
  await page.waitForTimeout(500);
  check('mouvement réduit : pas d’animation de frappe', (await page.evaluate(() => window.__twStrikes.length)) === 0);
  const red = await carriage(page);
  check('mouvement réduit : curseur au milieu, sans glissement', red.on && Math.abs(red.off) < 4, JSON.stringify(red));
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // ── ⌘⇧T éteint tout ──
  await page.keyboard.press('Control+Shift+KeyT');
  await page.waitForTimeout(500);
  const out = await carriage(page);
  await log(page);
  await page.keyboard.type('x');
  await page.waitForTimeout(200);
  check('⌘⇧T : machine éteinte, éditeur revenu, page au milieu, silence', !out.on && out.scrollLeft === 0 && (await page.evaluate(() => !document.querySelector('.ed-focus'))) && (await log(page)).length === 0 && (await page.evaluate(() => !document.querySelector('.ed-scroll').classList.contains('ed-tw'))));
  await page.evaluate((keys) => keys.forEach((k) => localStorage.removeItem(k)), KEYS);

  check('aucune erreur de page, aucune requête hors de l’app', errors.length === 0, errors.join(' | '));
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
