// Compagnon : toutes les scènes de l'accueil, de la bibliothèque et d'un espace, à six tailles d'écran,
// puis la croissance du cerveau selon le nombre de documents.
// Vérifie à chaque instant : à l'écran, posé sur son encadré (hors saut), bulle qui ne cache aucun
// texte ni contrôle ; par scène : poses attendues (saut, lecture…), aucune erreur.
// Dispositions (LAYOUT) : open (barre latérale ouverte, défaut, + test de croissance), collapsed (barre
// repliée), list (bibliothèque en liste), dark (thème sombre). PORT pour lancer plusieurs dispositions en parallèle.
// Lancer : LAYOUT=collapsed PORT=5424 timeout 1500 node scripts/test-mascot-scenes.mjs
import fs from 'node:fs';
import { withApp, shot } from './harness.mjs';

const OUT = 'shots/mascotte/scenes';
const SIZES = [
  [1024, 700],
  [1280, 800],
  [1440, 900],
  [1680, 1050],
  [1920, 1080],
  [2560, 1440],
];
const SPEED = 5;
const LAYOUT = process.env.LAYOUT || 'open';
const PORT = Number(process.env.PORT || 5423);
const PAGES = LAYOUT === 'list' ? ['library'] : ['home', 'library', 'workspace'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (ok, name, d) => { ok ? passed++ : failed++; console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${name}${!ok && d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 400) : ''}`); };

const TITLES = [
  ['Arendt', 'Condition de l’homme moderne'], ['Descartes', 'Méditations métaphysiques'], ['Spinoza', 'Éthique'], ['Kant', 'Critique de la raison pure'],
  ['Pascal', 'Pensées'], ['Montaigne', 'Essais'], ['Platon', 'La République'], ['Rousseau', 'Du contrat social'], ['Nietzsche', 'Le Gai Savoir'],
  ['Épictète', 'Manuel'], ['Hume', 'Enquête sur l’entendement humain'], ['Bergson', 'Le Rire'],
];

async function seed(page) {
  await page.evaluate(async (titles) => {
    const st = window.__store.getState();
    const enc = new TextEncoder();
    const books = await st.importFiles(titles.map(([a, t]) => ({ name: `${t}.txt`, data: enc.encode(`${t}\n\n${a}. Un paragraphe de lecture.`).buffer })), { asBook: true });
    books.forEach((b, i) => window.__store.getState().updateBook(b.id, { author: titles[i][0], progress: [0, 0.3, 0.95, 1, 0.5][i % 5] }));
    const w1 = window.__store.getState().createWorkspace('liberté');
    const w2 = window.__store.getState().createWorkspace('Écrans du pouvoir');
    books.slice(0, 7).forEach((b) => window.__store.getState().addToWorkspace(w1.id, null, 'book', b.id));
    books.slice(7).forEach((b) => window.__store.getState().addToWorkspace(w2.id, null, 'book', b.id));
    return w1.id;
  }, TITLES);
}

/** Ce que cache la bulle (texte, petits contrôles), ou « attente » si elle attend une place. */
const bubbleCover = () => {
  const b = document.querySelector('.mascot-bubble');
  if (!b) return null;
  if (getComputedStyle(b).visibility === 'hidden') return { waiting: true, hits: [] };
  const r = b.getBoundingClientRect();
  const hits = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    if (!n.textContent.trim() || n.parentElement.closest('.mascot-layer')) continue;
    const rg = document.createRange();
    rg.selectNodeContents(n);
    for (const q of rg.getClientRects()) if (q.width > 1 && q.right > r.left + 1 && q.left < r.right - 1 && q.bottom > r.top + 1 && q.top < r.bottom - 1) hits.push(n.textContent.trim().slice(0, 30));
  }
  for (const el of document.querySelectorAll('button, a, input, img')) {
    if (el.closest('.mascot-layer')) continue;
    const q = el.getBoundingClientRect();
    if (q.width * q.height > 30000 || q.width < 1) continue;
    if (q.right > r.left + 1 && q.left < r.right - 1 && q.bottom > r.top + 1 && q.top < r.bottom - 1) hits.push('[' + el.tagName + ']');
  }
  return { hits, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, text: b.textContent.slice(0, 60) };
};

/** Un instant : état du personnage et ce qui ne va pas. */
const snapshot = (fnSrc) => {
  const st = window.__mascot.state();
  const m = document.querySelector('.mascot');
  const out = { pose: st.pose, view: st.view, visible: st.visible, problems: [] };
  if (!st.visible || !m) return out;
  const r = m.getBoundingClientRect();
  if (getComputedStyle(m).visibility === 'hidden') return out;
  if (st.pose !== 'jump' && st.pose !== 'puff' && (r.left < -2 || r.right > innerWidth + 2 || r.top < -2 || r.bottom > innerHeight + 2))
    out.problems.push({ k: 'hors écran', r: [r.left, r.top, r.right, r.bottom].map(Math.round) });
  if (st.settled) {
    const perch = window.__mascot.perchEl();
    if (perch) {
      // Ligne d'appui de la pose, donnée par l'application (unités du dessin, hauteur vbH).
      const line = r.top + (st.anchorUnits / st.vbH) * r.height;
      const c = perch.getBoundingClientRect();
      if (Math.abs(line - c.top) > 3) out.problems.push({ k: 'pas sur le bord', pose: st.pose, view: st.view, line: Math.round(line), edge: Math.round(c.top) });
      if (r.left < c.left - 2 || r.right > c.right + 2) out.problems.push({ k: 'déborde de l’encadré', l: Math.round(r.left - c.left), r: Math.round(c.right - r.right) });
    }
  }
  const bc = new Function('return (' + fnSrc + ')()')();
  if (bc && !bc.waiting && (bc.hits.length || !bc.inView)) out.problems.push({ k: 'bulle cache', ...bc, appCover: Math.round(window.__mascot.bubbleInfo()?.cover ?? -1), age: Math.round(performance.now() - (window.__mascot.state().bubblePos?.at ?? 0)), pos: window.__mascot.state().bubblePos, br: (() => { const q = document.querySelector('.mascot-bubble').getBoundingClientRect(); return [q.left, q.top, q.width, q.height].map(Math.round); })() });
  out.bubble = bc && !bc.waiting ? bc.text : bc?.waiting ? '(attend)' : null;
  return out;
};

await withApp(PORT, async (page, errors) => {
  await page.evaluate((L) => window.__store.getState().updateSettings({ mascot: 'often', theme: L === 'dark' ? 'dark' : 'light', sidebarCollapsed: L === 'collapsed' }), LAYOUT);
  console.log(`disposition : ${LAYOUT}`);
  await seed(page);
  const wsId = await page.evaluate(() => window.__store.getState().workspaces[0].id);
  fs.mkdirSync(OUT, { recursive: true });
  const src = bubbleCover.toString();

  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    for (const pg of PAGES) {
      await page.evaluate(([pg, wsId]) => window.__store.getState().navigate(pg === 'workspace' ? { name: 'workspace', workspaceId: wsId, groupId: null } : { name: pg }), [pg, wsId]);
      await sleep(900);
      if (pg === 'library' && LAYOUT === 'list') {
        await page.locator('[aria-label="Affichage"] button').nth(1).click();
        await sleep(500);
      }
      await page.evaluate(() => window.__mascot.appear());
      const t0 = Date.now();
      while (Date.now() - t0 < 8000 && !(await page.evaluate(() => window.__mascot.state().visible))) await sleep(100);
      const shown = await page.evaluate(() => window.__mascot.state().visible);
      check(shown, `${w}×${h} ${pg} : il apparaît`);
      if (!shown) continue;
      const n = await page.evaluate(() => ({ home: 5, library: 4, workspace: 4 })[window.__mascot.page()]);
      await page.evaluate((k) => { window.__mascot.calm(); window.__mascot.speed(k); }, SPEED);
      if (w === 1440 || LAYOUT === 'list') await shot(page, `${OUT}/${LAYOUT}-${pg}-${w}.png`);
      for (let i = 0; i < n; i++) {
        // la scène i, puis on s'arrête (pas de départ)
        await page.evaluate((i) => { const m = window.__mascot; m.hush(); m.act('stand', 600000, undefined, 'front'); m.scene(i); }, i);
        const poses = new Set();
        const problems = [];
        const bubbles = new Set();
        const s0 = Date.now();
        let shotDone = false;
        while (Date.now() - s0 < 60000) {
          const snap = await page.evaluate(snapshot, src);
          poses.add(snap.pose + (snap.pose === 'read' || snap.pose === 'sit' ? '/' + snap.view : ''));
          if (snap.bubble) bubbles.add(snap.bubble);
          for (const p of snap.problems) if (problems.length < 4) problems.push(p);
          if (!shotDone && snap.bubble && snap.bubble !== '(attend)' && w === 1440) {
            await shot(page, `${OUT}/${LAYOUT}-${pg}-scene${i}.png`);
            shotDone = true;
          }
          const st = await page.evaluate(() => { const s = window.__mascot.state(); return { pose: s.pose, q: s.queue.length, ms: s.act?.ms }; });
          if (st.pose === 'stand' && st.ms === 600000) break; // la scène est finie : il est revenu à la pose d'attente
          await sleep(90);
        }
        const label = `${w}×${h} ${pg} scène ${i}`;
        check(problems.length === 0, `${LAYOUT} ${label} : à l’écran, posé, bulle libre (${[...poses].join(' ')})`, problems);
        if (pg === 'library' && i === 0) check(poses.has('jump') || (await page.evaluate(() => document.querySelectorAll('.lib-card-cover, .lib-row').length)) < 3, `${label} : saute de livre en livre`, [...poses]);
        if (pg === 'library' && i === 0) check([...poses].some((p) => p.startsWith('read')), `${label} : puis lit`, [...poses]);
        if (pg === 'home' && i === 0) check([...poses].some((p) => p.startsWith('read')), `${label} : lit sur « Reprendre »`, [...poses]);
        if (bubbles.size && w === 1440) console.log(`        bulles : ${[...bubbles].join(' | ')}`);
      }
      
    }
  }
  check(errors.length === 0, 'aucune erreur de page', errors.slice(0, 3));

  if (LAYOUT !== 'open') return;
  // ── Croissance du cerveau selon le nombre de documents ──
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
  await sleep(700);
  await page.evaluate(async () => { const st = window.__store.getState(); for (const b of [...st.books]) await window.__store.getState().removeBook(b.id); });
  await sleep(300);
  const have = await page.evaluate(() => window.__store.getState().books.length + window.__store.getState().drafts.length);
  const counts = [0, 4, 5, 14, 15, 39, 40, 99, 100, 150].filter((c) => c >= have);
  const rows = [];
  let made = have;
  fs.rmSync('/tmp/mascot-levels', { recursive: true, force: true });
  fs.mkdirSync('/tmp/mascot-levels', { recursive: true });
  for (const c of counts) {
    if (c > made) {
      await page.evaluate(async ([from, n]) => {
        const enc = new TextEncoder();
        await window.__store.getState().importFiles(Array.from({ length: n }, (_, i) => ({ name: `Doc ${from + i}.txt`, data: enc.encode(`Doc ${from + i}\n\nx`).buffer })), { asBook: true });
      }, [made, c - made]);
      made = c;
    }
    await sleep(600);
    await page.evaluate(() => { const m = window.__mascot; if (!m.state().visible) m.appear(); });
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && !(await page.evaluate(() => window.__mascot.state().visible))) await sleep(100);
    await page.evaluate(() => { const m = window.__mascot; m.calm(); m.speed(1); m.hush(); m.act('stand', 600000, undefined, 'front'); });
    await sleep(900);
    const meas = await page.evaluate(() => {
      const svg = document.querySelector('.mascot-svg');
      const brain = [...svg.querySelectorAll('path')].find((p) => /url\(#mascot-vol/.test(p.getAttribute('fill') || ''));
      const b = brain.getBoundingClientRect();
      const box = document.querySelector('.mascot').getBoundingClientRect();
      const limb = Number(svg.querySelector('g[stroke-width]')?.getAttribute('stroke-width'));
      const veins = svg.querySelectorAll('path[stroke="#a3354b"]').length;
      return { level: window.__mascot.state().level, docs: window.__store.getState().books.length + window.__store.getState().drafts.length, w: b.width, h: b.height, top: b.top - box.top, limb, veins };
    });
    rows.push({ count: c, ...meas });
    const box = await page.locator('.mascot').boundingBox();
    await page.screenshot({ path: `/tmp/mascot-levels/${String(c).padStart(3, '0')}.png`, clip: { x: box.x - 20, y: box.y - 25, width: box.width + 40, height: box.height + 35 } });
  }
  console.log('        docs → niveau, largeur du cerveau, membres, veines :');
  for (const r of rows) console.log(`        ${String(r.docs).padStart(3)} → niveau ${r.level}, cerveau ${r.w.toFixed(1)}×${r.h.toFixed(1)} px, membres ${r.limb}, veines ${r.veins}, haut ${r.top.toFixed(1)}`);
  const expect = (n) => (n < 5 ? 0 : n < 15 ? 1 : n < 40 ? 2 : n < 100 ? 3 : 4);
  check(rows.every((r) => r.level === expect(r.docs)), 'niveau selon le nombre de documents (0-4 : 0, 5-14 : 1, 15-39 : 2, 40-99 : 3, 100+ : 4)', rows.map((r) => [r.docs, r.level]));
  let grows = true, regress = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (b.w < a.w - 0.3 || b.limb < a.limb) regress.push([a.docs, b.docs]);
    if (b.level > a.level && !(b.w > a.w + 1 && b.limb > a.limb)) grows = false;
  }
  check(grows && !regress.length, 'le cerveau et les membres grossissent à chaque niveau, sans jamais régresser', { regress, rows: rows.map((r) => [r.docs, +r.w.toFixed(1), r.limb]) });
  check(rows.filter((r) => r.level >= 2).every((r) => r.veins > 0) && rows.filter((r) => r.level < 2).every((r) => r.veins === 0), 'veines à partir du niveau 2');
  check(rows.every((r) => r.top > -14), 'le cerveau reste dans son cadre (dépasse de moins de 14 px en haut)', rows.map((r) => [r.docs, +r.top.toFixed(1)]));
});

// bande des niveaux
const { execSync } = await import('node:child_process');
if (LAYOUT === 'open') execSync(`python3 -c "
from PIL import Image, ImageDraw
import glob, os
fs=sorted(glob.glob('/tmp/mascot-levels/*.png'))
ims=[Image.open(f).convert('RGB') for f in fs]
h=max(i.height for i in ims)+22; w=sum(i.width for i in ims)
out=Image.new('RGB',(w,h),(239,235,227)); d=ImageDraw.Draw(out); x=0
for f,i in zip(fs,ims):
    out.paste(i,(x,0)); d.text((x+6,h-18),str(int(os.path.basename(f)[:3]))+' docs',fill=(80,70,60)); x+=i.width
out.save('${OUT}/croissance.png')"`);
if (LAYOUT === 'open') console.log(`capture: ${OUT}/croissance.png`);
console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
