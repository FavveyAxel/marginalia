// Compagnon : apparition sur un encadré, ancrage au bord (face, profil, dos), à-coups (~3 i/s), bulle
// de citation, clic, musculature selon le nombre de documents, réglage « Jamais », absent du lecteur.
// Port 5421. Lancer : timeout 400 node scripts/test-mascot.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { withApp, shot } from './harness.mjs';
import { epubFrench } from './fixtures-books.mjs';

const OUT = 'shots/mascotte';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (ok, name, d) => { ok ? passed++ : failed++; console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${name}${!ok && d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 300) : ''}`); };

async function addDocs(page, n, start = 0) {
  await page.evaluate(async ({ n, start }) => {
    const enc = new TextEncoder();
    const files = Array.from({ length: n }, (_, i) => ({ name: `Texte ${start + i + 1}.txt`, data: enc.encode(`Texte ${start + i + 1}\n\nUn paragraphe de lecture.`).buffer }));
    await window.__store.getState().importFiles(files, { asBook: true });
  }, { n, start });
}
const state = (page) => page.evaluate(() => { const m = document.querySelector('.mascot'); const st = window.__mascot.state(); return { shown: !!m && getComputedStyle(m).visibility === 'visible', pose: st.pose, view: st.view, frame: st.frame, level: st.level, perch: st.perch, x: st.x }; });
async function waitShown(page, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const g = await state(page); if (g.shown && g.pose !== 'puff') return g; await sleep(100); }
  return state(page);
}
/** Ligne d'appui du sprite comparée au bord haut de son encadré. */
const anchor = (page, units) => page.evaluate((units) => {
  const st = window.__mascot.state();
  const perch = [...document.querySelectorAll('.home-card, .lib-card-cover, .ws-card, .set-list')].find((c) => c.className === st.perch);
  const m = document.querySelector('.mascot').getBoundingClientRect();
  const c = perch.getBoundingClientRect();
  return { line: m.top + (units / 130) * m.height, edge: c.top, inside: m.left >= c.left - 1 && m.right <= c.right + 1 };
}, units);
const hold = (page, pose, view, facing) => page.evaluate(([p, v, f]) => window.__mascot.act(p, 400, undefined, v, f), [pose, view, facing]);

await withApp(5421, async (page, errors) => {
  await page.evaluate(() => window.__store.getState().updateSettings({ mascot: 'often', theme: 'light' }));
  await addDocs(page, 3);
  await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
  await sleep(800);
  await page.evaluate(() => window.__mascot.appear());
  let g = await waitShown(page);
  check(g.shown, 'accueil : le compagnon apparaît', g);
  check(/home-card/.test(g.perch ?? ''), 'il se pose sur une carte de l’accueil', g.perch);
  check(g.level === 0, 'niveau 0 avec 3 documents', g.level);

  for (const [pose, view, units, label] of [['stand', 'front', 124, 'debout de face : pieds sur le bord'], ['stand', 'side', 124, 'debout de profil : pieds sur le bord'], ['read', 'front', 70, 'lit de face : assise sur le bord'], ['sit', 'side', 64, 'assis de profil : assise sur le bord'], ['sit', 'back', 70, 'assis de dos : assise sur le bord']]) {
    await hold(page, pose, view); await sleep(500);
    const a = await anchor(page, units);
    check(Math.abs(a.line - a.edge) < 2 && a.inside, label, a);
  }

  // à-coups : l'image ne change qu'environ 3 fois par seconde
  await hold(page, 'read', 'front'); await sleep(400);
  const frames = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 2000) { frames.push((await state(page)).frame); await sleep(40); }
  const changes = frames.filter((f, i) => i && f !== frames[i - 1]).length;
  check(changes >= 4 && changes <= 8, `environ 3 images par seconde (${changes} changements en 2 s)`, frames);
  await shot(page, `${OUT}/app-accueil-lecture.png`);

  // GIF : une petite vie complète, image par image (marche de profil, s'assoit, lit, coucou, s'en va)
  fs.rmSync('/tmp/mascot-gif', { recursive: true, force: true });
  fs.mkdirSync('/tmp/mascot-gif', { recursive: true });
  const clip = await page.evaluate(() => { const st = window.__mascot.state(); const c = [...document.querySelectorAll('.home-card')].find((x) => x.className === st.perch).getBoundingClientRect(); return { x: Math.max(0, c.left - 10), y: Math.max(0, c.top - 170), width: Math.min(c.width + 20, 820), height: 250 }; });
  await page.evaluate(() => {
    const s = window.__mascot;
    // empilé à l'envers (chaque act passe devant)
    s.act('walk', 3, undefined, 'back'); s.act('stand', 1, undefined, 'back');
    s.act('sitwave', 5, 'hello', 'front');
    s.act('read', 14, undefined, 'side', -1);
    s.act('read', 14, undefined, 'front');
    s.act('stand', 1, undefined, 'front');
    s.act('walk', 0);
  });
  for (let i = 0; i < 60; i++) { await page.screenshot({ path: `/tmp/mascot-gif/${String(i).padStart(3, '0')}.png`, clip }); await sleep(333); }

  // bulle de citation
  await page.evaluate(() => window.__mascot.act('think', 30, 'quote', 'front'));
  await sleep(800);
  const bub = await page.evaluate(() => { const b = document.querySelector('.mascot-bubble'); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent, vis: getComputedStyle(b).visibility, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 }; });
  check(!!bub && bub.vis === 'visible' && /«/.test(bub.text), 'bulle de citation affichée', bub);
  check(!!bub?.inView, 'bulle entièrement à l’écran', bub);
  await shot(page, `${OUT}/app-accueil-citation.png`);

  // clic : une citation
  await hold(page, 'sit', 'front'); await sleep(700);
  await page.evaluate(() => window.__mascot.hush()); await sleep(500);
  check((await page.locator('.mascot-bubble').count()) === 0, 'plus de bulle avant le clic');
  const box = await page.locator('.mascot').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
  await sleep(900);
  check((await page.locator('.mascot-bubble').count()) === 1, 'un clic sur lui fait apparaître une citation');
  check((await page.evaluate(() => getComputedStyle(document.querySelector('.mascot-layer')).pointerEvents)) === 'none', 'le calque laisse passer les clics ailleurs');

  // musculature
  await addDocs(page, 42, 3);
  await sleep(1500);
  g = await state(page);
  check(g.level === 3, 'niveau 3 avec 45 documents', g.level);
  const st = await page.evaluate(() => window.__mascot.state());
  check(st.pose === 'flex' || st.queue.some((q) => q.pose === 'flex') || st.pendingFlex, 'il fait le costaud en gagnant un niveau', { pose: st.pose });
  await hold(page, 'sit', 'side', 1); await sleep(700);
  await shot(page, `${OUT}/app-accueil-niveau3.png`);
  await addDocs(page, 60, 45);
  await sleep(800);
  await page.evaluate(() => window.__mascot.act('flex', 400, 'flex', 'front'));
  await sleep(900);
  check((await state(page)).level === 4, 'niveau 4 avec 105 documents');
  await shot(page, `${OUT}/app-accueil-niveau4.png`);

  // thème sombre
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
  await hold(page, 'read', 'front'); await sleep(900);
  await shot(page, `${OUT}/app-accueil-sombre.png`);
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));

  // bibliothèque
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await sleep(1000);
  await page.evaluate(() => window.__mascot.appear());
  g = await waitShown(page);
  check(g.shown, 'bibliothèque : il apparaît', g);
  await hold(page, 'doze', 'front'); await sleep(700);
  await shot(page, `${OUT}/app-bibliotheque.png`);

  // réglages
  await page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await sleep(800);
  check((await page.locator('#set-mascot').count()) === 1, 'réglages : section Compagnon');
  await page.locator('[aria-label="Visites du compagnon"] button', { hasText: 'Jamais' }).click();
  await sleep(500);
  check((await page.locator('.mascot').count()) === 0, 'réglage « Jamais » : plus de compagnon');
  await page.locator('#set-mascot').scrollIntoViewIfNeeded();
  await shot(page, `${OUT}/app-reglages.png`);

  // lecteur : jamais
  await page.locator('[aria-label="Visites du compagnon"] button', { hasText: 'Souvent' }).click();
  await page.evaluate(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const [b] = await window.__store.getState().importFiles([{ name: 'm.epub', data: bin.buffer }], { asBook: true }); window.__store.getState().openBook(b.id); }, Buffer.from(await epubFrench()).toString('base64'));
  await sleep(1500);
  await page.evaluate(() => window.__mascot?.appear());
  await sleep(1500);
  check((await page.locator('.mascot').count()) === 0, 'lecteur : pas de compagnon');
  check(errors.length === 0, 'aucune erreur de page', errors.slice(0, 3));
});

try {
  execSync(`python3 -c "
from PIL import Image; import glob
fr=[Image.open(f).convert('RGB') for f in sorted(glob.glob('/tmp/mascot-gif/*.png'))]
fr[0].save('${OUT}/compagnon.gif', save_all=True, append_images=fr[1:], duration=333, loop=0, optimize=True)"`);
  console.log('gif:', `${OUT}/compagnon.gif`);
} catch (e) { console.log('gif impossible', e.message); }
console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
