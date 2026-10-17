// Compagnon : glisser-déposer à la souris (attraper, gigoter, lâcher sur un autre encadré, lâcher dans
// le vide → saut vers le bord le plus proche), et le simple clic qui reste un clic. Port 5431.
// Lancer : timeout 300 node scripts/test-mascot-drag.mjs
import { withApp, shot } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (ok, name, d) => { ok ? passed++ : failed++; console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${name}${!ok && d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 300) : ''}`); };
const st = (page) => page.evaluate(() => { const s = window.__mascot.state(); return { pose: s.pose, perch: s.perch, settled: s.settled, drag: !!s.drag, flight: s.flight, x: s.x }; });
const box = (page) => page.evaluate(() => { const r = document.querySelector('.mascot').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });

await withApp(5431, async (page, errors) => {
  await page.evaluate(async () => {
    window.__store.getState().updateSettings({ mascot: 'often', theme: 'light' });
    const enc = new TextEncoder();
    const files = Array.from({ length: 8 }, (_, i) => ({ name: `Texte ${i + 1}.txt`, data: enc.encode(`Texte ${i + 1}\n\nUn paragraphe.`).buffer }));
    await window.__store.getState().importFiles(files, { asBook: true });
    window.__store.getState().navigate({ name: 'library' });
  });
  await sleep(900);
  await page.evaluate(() => window.__mascot.appear());
  for (let i = 0; i < 60 && (await st(page)).pose === 'puff'; i++) await sleep(100);
  await page.evaluate(() => window.__mascot.calm());
  await page.evaluate(() => window.__mascot.act('sit', 60000, undefined, 'front'));
  await sleep(600);
  const s0 = await st(page);
  check(!!s0.perch, 'il est posé sur un encadré', s0);

  // 1. Clic simple : pas de prise, il réagit (coucou).
  let b = await box(page);
  await page.mouse.click(b.x + b.w / 2, b.y + b.h * 0.35);
  await sleep(250);
  let s1 = await st(page);
  check(!s1.drag && (s1.pose === 'sitwave' || s1.pose === 'wave'), 'un clic reste un clic (coucou)', s1);
  await page.evaluate(() => window.__mascot.act('sit', 60000, undefined, 'front'));
  await sleep(500);

  // 2. Attraper et déplacer vers une autre couverture.
  const target = await page.evaluate((cur) => {
    const els = [...document.querySelectorAll('.lib-card-cover')];
    const me = document.querySelector('.mascot').getBoundingClientRect();
    const el = els.map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.top > 100 && r.bottom < innerHeight && Math.abs(r.left - me.left) > 150).sort((a, b) => b.r.left - a.r.left)[0];
    el.e.dataset.dropTarget = '1';
    return { x: el.r.left + el.r.width / 2, y: el.r.top, l: el.r.left, r: el.r.right };
  }, s0.perch);
  b = await box(page);
  const gx = b.x + b.w / 2, gy = b.y + b.h * 0.3;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + 20, gy - 10, { steps: 3 });
  await sleep(200);
  const sd = await st(page);
  check(sd.drag && sd.pose === 'dangle', 'attrapé : il pend au bout de la souris et gigote', sd);
  const cls = await page.evaluate(() => document.querySelector('.mascot').classList.contains('is-dragging'));
  check(cls, 'curseur « main fermée » pendant la prise');
  // Au-dessus de la couverture visée, un peu plus haut que son bord.
  await page.mouse.move(target.x, target.y - 140, { steps: 12 });
  await sleep(250);
  const bd = await box(page);
  check(Math.abs(bd.x + (gx - b.x) - target.x) < 3, 'il suit le pointeur', { bd, target });
  await shot(page, 'shots/mascotte/glisser-1-tenu.png');
  await page.mouse.up();
  await sleep(120);
  await shot(page, 'shots/mascotte/glisser-2-chute.png');
  for (let i = 0; i < 30 && !(await st(page)).settled; i++) await sleep(100);
  await sleep(300);
  const sa = await st(page);
  const onTarget = await page.evaluate(() => window.__mascot.perchEl()?.dataset.dropTarget === '1');
  check(onTarget && !sa.drag, 'lâché au-dessus d’une couverture : il tombe dessus', sa);
  const after = await page.evaluate(() => { const m = document.querySelector('.mascot').getBoundingClientRect(); const p = window.__mascot.perchEl().getBoundingClientRect(); return { feet: m.top + (124 / 130) * m.height, edge: p.top }; });
  check(Math.abs(after.feet - after.edge) < 3, 'pieds sur le bord après la chute', after);
  await sleep(500);
  const bub = await page.evaluate(() => document.querySelector('.mascot-bubble')?.textContent ?? '');
  check(bub.length > 5, 'il commente le déménagement', bub);
  await shot(page, 'shots/mascotte/glisser-3-pose.png');

  // 3. Lâché dans le vide (au milieu de nulle part) : saut vers le bord libre le plus proche.
  await page.evaluate(() => window.__mascot.act('sit', 60000, undefined, 'front'));
  await sleep(500);
  b = await box(page);
  await page.mouse.move(b.x + b.w / 2, b.y + b.h * 0.3);
  await page.mouse.down();
  await page.mouse.move(b.x + b.w / 2 + 10, b.y + 10, { steps: 3 });
  const empty = await page.evaluate(() => ({ x: innerWidth - 60, y: innerHeight - 30 }));
  await page.mouse.move(empty.x, empty.y, { steps: 10 });
  await page.mouse.up();
  await sleep(80);
  const sv = await st(page);
  check(sv.flight || sv.pose === 'puff' || sv.settled, 'lâché dans le vide : il saute vers un bord (ou disparaît)', sv);
  for (let i = 0; i < 40 && ((await st(page)).flight); i++) await sleep(100);
  await sleep(600);
  const sz = await st(page);
  const vis = await page.evaluate(() => getComputedStyle(document.querySelector('.mascot') ?? document.body).visibility);
  check(!sz.drag && (vis === 'visible' ? !!sz.perch : true), 'il a retrouvé un encadré', { sz, vis });
  check(errors.length === 0, 'aucune erreur dans la console', errors.slice(0, 3));
});
console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
