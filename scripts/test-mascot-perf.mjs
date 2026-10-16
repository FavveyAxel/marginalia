// Compagnon : coût en processeur et en mémoire. Temps du fil principal (CDP Performance.TaskDuration)
// sur 10 s : compagnon désactivé, entre deux visites, assis à lire, en train de marcher, pendant un
// défilement ; puis mémoire (tas JS après ramasse-miettes, nœuds du DOM) avant et après 40 visites accélérées.
// Port 5428. Lancer : timeout 600 node scripts/test-mascot-perf.mjs
import { withApp } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (ok, name, d) => { ok ? passed++ : failed++; console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${name}${!ok && d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 300) : ''}`); };

await withApp(5428, async (page, errors) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  /** Part du temps où le fil principal travaille pendant `ms`, et nombre de calculs de mise en page. */
  const measure = async (ms, during) => {
    const a = await metrics();
    const t0 = Date.now();
    const job = during?.();
    await sleep(ms);
    await job;
    const b = await metrics();
    const wall = (Date.now() - t0) / 1000;
    const pc = (k) => ((b[k] - a[k]) / wall) * 100;
    // own : ce qui revient à la page elle-même (script, styles, mise en page) ; cpu contient aussi le
    // travail natif du navigateur, qui varie d'une mesure à l'autre sans rapport avec le compagnon.
    return { cpu: pc('TaskDuration'), script: pc('ScriptDuration'), own: pc('ScriptDuration') + pc('LayoutDuration') + pc('RecalcStyleDuration'), layouts: (b.LayoutCount - a.LayoutCount) / wall, styles: (b.RecalcStyleCount - a.RecalcStyleCount) / wall };
  };
  const fmt = (m) => `${m.cpu.toFixed(2)} % du processeur (script ${m.script.toFixed(2)} %, script+styles+mise en page ${m.own.toFixed(2)} %), ${m.layouts.toFixed(1)} mises en page/s`;

  await page.evaluate(async () => {
    const enc = new TextEncoder();
    await window.__store.getState().importFiles(Array.from({ length: 20 }, (_, i) => ({ name: `Livre ${i + 1}.txt`, data: enc.encode(`Livre ${i + 1}\n\nUn paragraphe.`).buffer })), { asBook: true });
    window.__store.getState().navigate({ name: 'home' });
  });
  await sleep(1500);

  await page.evaluate(() => window.__store.getState().updateSettings({ mascot: 'off' }));
  // L'application finit son travail d'import (sauvegarde, index) : on attend qu'elle soit au repos.
  // (Changer un réglage l'enregistre aussi : même attente après chaque changement.)
  const settle = async (n = 20) => { for (let i = 0; i < n; i++) if ((await measure(2000)).cpu < 0.3) break; };
  await settle();
  const off = await measure(10000);
  console.log(`        désactivé : ${fmt(off)}`);

  await page.evaluate(() => window.__store.getState().updateSettings({ mascot: 'rare' }));
  await sleep(800);
  await settle(6);
  const idle = await measure(10000);
  console.log(`        entre deux visites : ${fmt(idle)}`);
  check(idle.own - off.own < 0.1 && idle.layouts < 0.5, `entre deux visites : coût négligeable (+${(idle.own - off.own).toFixed(3)} point de script/styles/mise en page, ${idle.layouts.toFixed(1)} mises en page/s)`, { idle, off });
  check(idle.cpu - off.cpu < 1, `entre deux visites : processeur total quasi inchangé (+${(idle.cpu - off.cpu).toFixed(2)})`, { idle, off });

  await page.evaluate(() => window.__store.getState().updateSettings({ mascot: 'often' }));
  await page.evaluate(() => window.__mascot.appear());
  await page.waitForFunction(() => window.__mascot.state().visible, null, { timeout: 15000 });
  await page.evaluate(() => { const m = window.__mascot; m.calm(); m.act('read', 600000, undefined, 'front'); });
  await sleep(1500);
  const sit = await measure(10000);
  console.log(`        assis, il lit : ${fmt(sit)}`);
  check(sit.cpu - off.cpu < 3, `assis à lire : moins de 3 points de processeur (+${(sit.cpu - off.cpu).toFixed(2)})`, sit);
  check(sit.own < 1.5, `assis à lire : script+styles+mise en page sous 1,5 % (${sit.own.toFixed(2)})`, sit);
  check(sit.layouts < 12, `assis à lire : pas de mise en page à chaque image (${sit.layouts.toFixed(1)}/s)`, sit);

  await page.evaluate(() => {
    const m = window.__mascot;
    const q = [];
    for (let i = 0; i < 12; i++) q.push(i % 2);
    q.reverse().forEach((to) => m.act('walk', 0, undefined, undefined, undefined, to));
  });
  await sleep(300);
  const walk = await measure(10000);
  console.log(`        il marche : ${fmt(walk)}`);
  check(walk.cpu - off.cpu < 12, `en marchant (60 images/s) : moins de 12 points de processeur (+${(walk.cpu - off.cpu).toFixed(2)})`, walk);

  await page.evaluate(() => window.__mascot.act('read', 600000, undefined, 'front'));
  await sleep(1000);
  const scroll = await measure(6000, async () => {
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, i % 2 ? -120 : 120);
      await sleep(180);
    }
  });
  console.log(`        défilement pendant qu'il lit : ${fmt(scroll)}`);
  check(scroll.cpu - off.cpu < 15, `défilement : il suit sans surcoût excessif (+${(scroll.cpu - off.cpu).toFixed(2)})`, scroll);

  // Mémoire : 40 visites accélérées (apparition, scènes, départ), puis comparaison après ramasse-miettes.
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await sleep(300);
    await cdp.send('HeapProfiler.collectGarbage');
    const m = await metrics();
    return { heap: m.JSHeapUsedSize / 1048576, nodes: m.Nodes, listeners: m.JSEventListeners };
  };
  await cdp.send('HeapProfiler.enable');
  await page.evaluate(() => { const m = window.__mascot; m.calm(false); m.speed(20); m.appear(); });
  await sleep(4000);
  const before = await heap();
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => window.__mascot.appear());
    await sleep(1200);
  }
  await page.evaluate(() => window.__mascot.speed(1));
  await sleep(500);
  const after = await heap();
  console.log(`        mémoire : tas ${before.heap.toFixed(2)} → ${after.heap.toFixed(2)} Mo, nœuds ${before.nodes} → ${after.nodes}, écouteurs ${before.listeners} → ${after.listeners}`);
  check(after.heap - before.heap < 1.5, `mémoire stable après 40 visites (+${(after.heap - before.heap).toFixed(2)} Mo)`, { before, after });
  check(after.nodes - before.nodes < 300, `pas de nœuds qui s’accumulent (${after.nodes - before.nodes >= 0 ? '+' : ''}${after.nodes - before.nodes})`, { before, after });
  check(after.listeners - before.listeners < 20, `pas d’écouteurs qui s’accumulent (${after.listeners - before.listeners >= 0 ? '+' : ''}${after.listeners - before.listeners})`, { before, after });
  check(errors.length === 0, 'aucune erreur de page', errors.slice(0, 3));
});
console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
