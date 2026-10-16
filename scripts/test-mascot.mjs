// Compagnon : apparition sur un encadré, ancrage au bord (face, profil, dos), rythme des poses
// (8 i/s en marchant, déplacement fluide), bulle de citation qui ne cache aucun texte, clic, musculature selon le nombre de documents, réglage « Jamais », absent du lecteur.
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
const hold = (page, pose, view, facing) => page.evaluate(([p, v, f]) => window.__mascot.act(p, 120000, undefined, v, f), [pose, view, facing]);

await withApp(5421, async (page, errors) => {
  await page.evaluate(() => window.__store.getState().updateSettings({ mascot: 'often', theme: 'light' }));
  await addDocs(page, 3);
  await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
  await sleep(800);
  await page.evaluate(() => window.__mascot.appear());
  let g = await waitShown(page);
  await page.evaluate(() => window.__mascot.calm());
  check(g.shown, 'accueil : le compagnon apparaît', g);
  check(/home-card/.test(g.perch ?? ''), 'il se pose sur une carte de l’accueil', g.perch);
  check(g.level === 0, 'niveau 0 avec 3 documents', g.level);

  for (const [pose, view, units, label] of [['stand', 'front', 124, 'debout de face : pieds sur le bord'], ['stand', 'side', 124, 'debout de profil : pieds sur le bord'], ['read', 'front', 70, 'lit de face : assise sur le bord'], ['sit', 'side', 64, 'assis de profil : assise sur le bord'], ['sit', 'back', 70, 'assis de dos : assise sur le bord']]) {
    await hold(page, pose, view); await sleep(500);
    const a = await anchor(page, units);
    check(Math.abs(a.line - a.edge) < 2 && a.inside, label, a);
  }

  // rythme : en marchant, ~8 poses par seconde et un déplacement fluide ; en lisant, ~4 poses par seconde
  const sample = async (ms) => {
    const out = [];
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      out.push(await page.evaluate(() => ({ f: window.__mascot.state().frame, tr: document.querySelector('.mascot').style.transform, pose: window.__mascot.state().pose })));
      await sleep(15);
    }
    return out;
  };
  const changes = (a, k) => a.filter((v, i) => i && v[k] !== a[i - 1][k]).length;
  await page.evaluate(() => { const el = window.__mascot.perchEl(); window.__mascot.perchOn(el, 6); window.__mascot.act('walk', 0, undefined, 'side', 1, 1); });
  await sleep(700);
  let smp = (await sample(1500)).filter((x) => x.pose === 'walk');
  const fw = changes(smp, 'f') / 1.5;
  const mv = changes(smp, 'tr') / 1.5;
  check(fw >= 6 && fw <= 10, `marche : environ 8 poses par seconde (${fw.toFixed(1)}/s)`, fw);
  check(mv >= 25, `marche : déplacement fluide (${mv.toFixed(0)} positions/s)`, mv);
  await hold(page, 'read', 'front'); await sleep(400);
  smp = await sample(2000);
  const fr = changes(smp, 'f') / 2;
  check(fr >= 3 && fr <= 5, `lecture : environ 4 poses par seconde (${fr.toFixed(1)}/s)`, fr);
  await shot(page, `${OUT}/app-accueil-lecture.png`);

  // GIF : une petite vie complète (12 images par seconde)
  fs.rmSync('/tmp/mascot-gif', { recursive: true, force: true });
  fs.mkdirSync('/tmp/mascot-gif', { recursive: true });
  await page.evaluate(() => { const el = window.__mascot.perchEl(); window.__mascot.perchOn(el, 20); });
  const clip = await page.evaluate(() => { const c = window.__mascot.perchEl().getBoundingClientRect(); return { x: Math.max(0, c.left - 10), y: Math.max(0, c.top - 150), width: 520, height: 220 }; });
  const walkTo = await page.evaluate(() => 150 / Math.max(1, window.__mascot.perchEl().getBoundingClientRect().width - 82));
  await page.evaluate((walkTo) => {
    const s = window.__mascot;
    s.act('walk', 700, undefined, 'back'); s.act('stand', 300, undefined, 'back');
    s.act('sitwave', 1500, 'hello', 'front');
    s.act('read', 3500, undefined, 'side', -1);
    s.act('read', 3500, undefined, 'front');
    s.act('stand', 400, undefined, 'front');
    s.act('walk', 0, undefined, undefined, undefined, walkTo);
  }, walkTo);
  const g0 = Date.now();
  let gi = 0;
  while (Date.now() - g0 < 15000) { const t = Date.now(); await page.screenshot({ path: `/tmp/mascot-gif/${String(gi++).padStart(4, '0')}.png`, clip }); await sleep(Math.max(0, 83 - (Date.now() - t))); }
  globalThis.gifMs = Math.round(15000 / gi);

  // la bulle ne cache rien : sur chaque carte de l'accueil, au début, au milieu et à la fin du bord
  const covered = () => page.evaluate(() => {
    const b = document.querySelector('.mascot-bubble');
    if (!b) return { none: true };
    const r = b.getBoundingClientRect();
    const hits = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      if (!n.textContent.trim() || n.parentElement.closest('.mascot-layer')) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const q of rg.getClientRects()) if (q.width > 1 && q.right > r.left && q.left < r.right && q.bottom > r.top && q.top < r.bottom) hits.push(n.textContent.trim().slice(0, 30));
    }
    for (const el of document.querySelectorAll('button, a, input, img')) {
      if (el.closest('.mascot-layer')) continue;
      const q = el.getBoundingClientRect();
      if (q.width * q.height > 30000) continue; // grandes cartes : couvrir leur fond ne cache rien
      if (q.width > 1 && q.right > r.left && q.left < r.right && q.bottom > r.top && q.top < r.bottom && !hits.includes('[' + el.tagName + ']')) hits.push('[' + el.tagName + ']');
    }
    if (getComputedStyle(b).visibility === 'hidden') return { waiting: true, hits: [] };
    return { hits, side: b.dataset.side, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
  });
  const cards = await page.evaluate(() => document.querySelectorAll('.home-card').length);
  let spots = 0, clean = 0, shown = 0;
  const bad = [];
  for (let ci = 0; ci < cards; ci++) {
    for (const fx of [0.02, 0.5, 0.95]) {
      const ok = await page.evaluate(([ci, fx]) => {
        const el = document.querySelectorAll('.home-card')[ci];
        const r = el.getBoundingClientRect();
        if (r.width < 90 || r.top < 90) return false;
        window.__mascot.hush();
        window.__mascot.perchOn(el, fx * (r.width - 70 - 12) + 6);
        window.__mascot.act('stand', 120000, 'quote', 'front');
        return true;
      }, [ci, fx]);
      if (!ok) continue;
      await sleep(900);
      const c = await covered();
      spots++;
      if (c.none) { bad.push({ ci, fx, err: 'pas de bulle' }); continue; }
      if (c.waiting) { clean++; continue; }
      shown++;
      if (!c.hits.length && c.inView) clean++;
      else bad.push({ ci, fx, ...c });
    }
  }
  check(spots >= 9 && clean === spots, `bulle : ne cache aucun texte ni contrôle (${clean}/${spots} positions)`, bad);
  check(shown >= spots * 0.75, `bulle : trouve une place libre presque partout (${shown}/${spots} affichées, les autres attendent)`, { shown, spots });
  // le cas signalé : sur « À réviser aujourd'hui », sous le titre de la carte voisine
  await page.evaluate(() => {
    const el = document.querySelector('.home-review');
    const r = el.getBoundingClientRect();
    window.__mascot.hush();
    window.__mascot.perchOn(el, r.width * 0.5);
    window.__mascot.act('think', 120000, 'quote', 'front');
  });
  await sleep(600);
  const c2 = await covered();
  check(!c2.none && !c2.hits.length, `bulle sur « À réviser » : rien de caché${c2.waiting ? ' (elle attend une place)' : ''}`, c2);
  // un clic : la bulle s'affiche toujours
  await page.evaluate(() => { window.__mascot.hush(); window.__mascot.act('sit', 120000, 'poke', 'front'); });
  await sleep(600);
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.mascot-bubble')).visibility === 'visible'), 'bulle demandée par un clic : toujours affichée');
  await shot(page, `${OUT}/app-bulle-libre.png`);

  // bulle de citation
  await page.evaluate(() => { window.__mascot.hush(); window.__mascot.act('think', 120000, 'poke', 'front'); });
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
  await page.evaluate(() => window.__mascot.act('flex', 120000, 'flex', 'front'));
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
fr[0].save('${OUT}/compagnon.gif', save_all=True, append_images=fr[1:], duration=${globalThis.gifMs ?? 83}, loop=0, optimize=True)"`);
  console.log('gif:', `${OUT}/compagnon.gif`);
} catch (e) { console.log('gif impossible', e.message); }
console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
