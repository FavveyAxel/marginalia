// Compagnon : apparition sur un encadré, ancrage au bord, à-coups (~3 i/s), bulle de citation, clic,
// musculature selon le nombre de documents, réglage « Jamais », absent du lecteur. Port 5421.
// Lancer : timeout 300 node scripts/test-mascot.mjs
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

const geom = (page) => page.evaluate(() => {
  const m = document.querySelector('.mascot');
  const st = window.__mascot.state();
  if (!m) return { shown: false, st };
  const r = m.getBoundingClientRect();
  const perch = document.querySelector('.' + String(st.perch).split(' ').filter(Boolean).join('.'));
  return { shown: getComputedStyle(m).visibility === 'visible', x: r.left, y: r.top, w: r.width, h: r.height, pose: st.pose, frame: st.frame, level: st.level, perch: st.perch };
});

async function waitPose(page, poses, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const g = await geom(page);
    if (g.shown && poses.includes(g.pose)) return g;
    await sleep(100);
  }
  return geom(page);
}

await withApp(5421, async (page, errors) => {
  await page.evaluate(() => window.__store.getState().updateSettings({ mascot: 'often', theme: 'light' }));
  await addDocs(page, 3);
  await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
  await sleep(800);
  await page.evaluate(() => window.__mascot.appear());
  let g = await waitPose(page, ['stand', 'wave', 'walk', 'sit', 'read', 'think', 'doze', 'flex']);
  check(g.shown, 'accueil : le compagnon apparaît', g);
  check(/home-card/.test(g.perch ?? ''), 'il se pose sur une carte de l’accueil', g.perch);
  check(g.level === 0, 'niveau 0 avec 3 documents', g.level);

  // ancrage : debout, ses pieds touchent le bord haut de la carte ; assis, l'assise est sur le bord
  await page.evaluate(() => window.__mascot.act('stand', 12));
  await sleep(500);
  let a = await page.evaluate(() => {
    const st = window.__mascot.state();
    const card = [...document.querySelectorAll('.home-card')].find((c) => c.className === st.perch);
    const m = document.querySelector('.mascot').getBoundingClientRect();
    const c = card.getBoundingClientRect();
    return { feet: m.top + (124 / 130) * m.height, edge: c.top, inside: m.left >= c.left - 1 && m.right <= c.right + 1 };
  });
  check(Math.abs(a.feet - a.edge) < 2, 'debout : pieds sur le bord de la carte', a);
  check(a.inside, 'reste dans la largeur de la carte', a);
  await page.evaluate(() => window.__mascot.act('read', 40));
  await sleep(500);
  a = await page.evaluate(() => {
    const st = window.__mascot.state();
    const card = [...document.querySelectorAll('.home-card')].find((c) => c.className === st.perch);
    const m = document.querySelector('.mascot').getBoundingClientRect();
    return { seat: m.top + (70 / 130) * m.height, edge: card.getBoundingClientRect().top };
  });
  check(Math.abs(a.seat - a.edge) < 2, 'assis : assise sur le bord de la carte', a);

  // à-coups : l'image ne change qu'environ 3 fois par seconde
  const frames = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 2000) { frames.push((await geom(page)).frame); await sleep(40); }
  const changes = frames.filter((f, i) => i && f !== frames[i - 1]).length;
  check(changes >= 4 && changes <= 8, `environ 3 images par seconde (${changes} changements en 2 s)`, frames);
  await shot(page, `${OUT}/app-accueil-lecture.png`);

  // GIF : il marche puis s'assoit et lit
  fs.rmSync('/tmp/mascot-gif', { recursive: true, force: true });
  fs.mkdirSync('/tmp/mascot-gif', { recursive: true });
  await page.evaluate(() => { const s = window.__mascot; s.act('read', 30); s.act('sit', 9); s.act('walk', 0); });
  await page.evaluate(() => { /* cible de marche : au bout de la carte */ });
  const clip = await page.evaluate(() => { const st = window.__mascot.state(); const c = [...document.querySelectorAll('.home-card')].find((x) => x.className === st.perch).getBoundingClientRect(); return { x: Math.max(0, c.left - 20), y: Math.max(0, c.top - 150), width: Math.min(c.width + 40, 900), height: 230 }; });
  for (let i = 0; i < 40; i++) { await page.screenshot({ path: `/tmp/mascot-gif/${String(i).padStart(3, '0')}.png`, clip }); await sleep(333); }

  // bulle de citation
  await page.evaluate(() => window.__mascot.act('think', 20, 'quote'));
  await sleep(800);
  const bub = await page.evaluate(() => { const b = document.querySelector('.mascot-bubble'); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent, vis: getComputedStyle(b).visibility, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 }; });
  check(!!bub && bub.vis === 'visible' && /«/.test(bub.text), 'bulle de citation affichée', bub);
  check(!!bub?.inView, 'bulle entièrement à l’écran', bub);
  await shot(page, `${OUT}/app-accueil-citation.png`);

  // clic : une citation
  await page.evaluate(() => window.__mascot.act('sit', 40));
  await sleep(700);
  await page.evaluate(() => document.querySelector('.mascot-bubble')?.remove());
  const box = await page.locator('.mascot').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
  await sleep(900);
  check(await page.locator('.mascot-bubble').count() === 1, 'un clic sur lui fait apparaître une citation');
  // le calque ne bloque pas les clics ailleurs
  const pe = await page.evaluate(() => getComputedStyle(document.querySelector('.mascot-layer')).pointerEvents);
  check(pe === 'none', 'le calque laisse passer les clics', pe);

  // musculature : 45 documents → niveau 3, il fait le costaud
  await addDocs(page, 42, 3);
  await sleep(1500);
  g = await geom(page);
  check(g.level === 3, 'niveau 3 avec 45 documents', g.level);
  const st = await page.evaluate(() => window.__mascot.state());
  check(st.pose === 'flex' || st.queue.some((q) => q.pose === 'flex') || st.pendingFlex, 'il fait le costaud en gagnant un niveau', { pose: st.pose });
  await page.evaluate(() => window.__mascot.act('sit', 40));
  await sleep(700);
  await shot(page, `${OUT}/app-accueil-niveau3.png`);
  await addDocs(page, 60, 45);
  await sleep(800);
  await page.evaluate(() => window.__mascot.act('flex', 40, 'flex'));
  await sleep(900);
  check((await geom(page)).level === 4, 'niveau 4 avec 105 documents');
  await shot(page, `${OUT}/app-accueil-niveau4.png`);

  // thème sombre
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
  await page.evaluate(() => window.__mascot.act('read', 40));
  await sleep(900);
  await shot(page, `${OUT}/app-accueil-sombre.png`);
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));

  // bibliothèque : sur une couverture
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await sleep(1000);
  await page.evaluate(() => window.__mascot.appear());
  g = await waitPose(page, ['stand', 'wave', 'flex', 'walk', 'sit', 'read', 'think', 'doze']);
  check(g.shown, 'bibliothèque : il apparaît', g);
  await page.evaluate(() => window.__mascot.act('doze', 40));
  await sleep(700);
  await shot(page, `${OUT}/app-bibliotheque.png`);

  // réglages : section Compagnon ; « Jamais » le fait disparaître
  await page.evaluate(() => window.__store.getState().navigate({ name: 'settings' }));
  await sleep(800);
  check(await page.locator('#set-mascot').count() === 1, 'réglages : section Compagnon');
  await page.locator('[aria-label="Visites du compagnon"] button', { hasText: 'Jamais' }).click();
  await sleep(500);
  check(await page.locator('.mascot').count() === 0, 'réglage « Jamais » : plus de compagnon');
  await page.locator('#set-mascot').scrollIntoViewIfNeeded();
  await shot(page, `${OUT}/app-reglages.png`);

  // lecteur : jamais
  await page.locator('[aria-label="Visites du compagnon"] button', { hasText: 'Souvent' }).click();
  const id = await page.evaluate(async (b64) => { const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const [b] = await window.__store.getState().importFiles([{ name: 'm.epub', data: bin.buffer }], { asBook: true }); window.__store.getState().openBook(b.id); return b.id; }, Buffer.from(await epubFrench()).toString('base64'));
  await sleep(1500);
  await page.evaluate(() => window.__mascot?.appear());
  await sleep(1500);
  check(await page.locator('.mascot').count() === 0, 'lecteur : pas de compagnon', id);
  check(errors.length === 0, 'aucune erreur de page', errors.slice(0, 3));
});

// GIF à 3 images par seconde
try {
  execSync(`python3 -c "
from PIL import Image; import glob
fr=[Image.open(f).convert('RGB') for f in sorted(glob.glob('/tmp/mascot-gif/*.png'))]
fr[0].save('${OUT}/compagnon.gif', save_all=True, append_images=fr[1:], duration=333, loop=0, optimize=True)"`);
  console.log('gif:', `${OUT}/compagnon.gif`);
} catch (e) { console.log('gif impossible', e.message); }
console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
