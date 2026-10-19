// « Travailler à plusieurs » : pointeurs des autres en direct (cartes, PDF, EPUB). Deux processus Electron
// (dossiers de données distincts, réseau local simulé par MARGINALIA_E2E_LAN=127.0.0.1) — l'hôte Léa (A),
// l'invité Marc (B, par un relais d'écoute) — et une invitée « sans interface » Inès (electron/collab-net.cjs
// en Node) qui envoie ses pointeurs comme le ferait l'app (second pointeur, autre page, autre livre).
//  1. Carte : la souris de Léa bouge → son pointeur chez Marc, étiqueté « Léa », dans sa couleur, au bon
//     endroit du repère de la carte alors que Marc a un autre zoom ; cadence mesurée chez Léa (≤ 30/s, 0 à
//     l'arrêt) ; mouvement fluide chez Marc (échantillonné à chaque image) ; carte déplacée par Léa entourée
//     de sa couleur chez Marc ; pointeur effacé après inactivité ; parti avec Léa quand elle quitte la carte.
//  2. PDF (fenêtres de tailles différentes) : même point de la même page ; Inès sur la page 2 : pas de
//     pointeur, « Inès lit page 2 ».
//  2 bis. Photo : même point de l'image.
//  3. EPUB (fenêtre et taille de texte différentes) : le pointeur de Léa sur un mot apparaît sur ce même mot
//     chez Marc ; Inès dans un autre livre : rien.
//  4. Rien en clair dans le trafic capturé.
// Captures claires et sombres + animation dans shots/curseurs/. Prérequis : npx vite build ; Xvfb (:99).
// Lancer : DISPLAY=:99 LANG=C.UTF-8 timeout 600 node scripts/test-cursors.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

process.env.MARGINALIA_E2E = '1';
process.env.MARGINALIA_E2E_LAN = '127.0.0.1';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const collabNet = require(path.join(ROOT, 'electron/collab-net.cjs'));
const SHOTS = path.join(ROOT, 'shots/curseurs');
fs.mkdirSync(SHOTS, { recursive: true });
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
  return c;
};
if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
  console.error('dist/ manquant : lancez d’abord « npx vite build ».');
  process.exit(1);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dirs = [];
const apps = [];
async function launch(name, size) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `mg-cur-${name}-`));
  dirs.push(home);
  const app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: path.join(home, 'donnees'), MARGINALIA_E2E_LAN: '127.0.0.1', VITE_DEV_SERVER_URL: '' },
    timeout: 60000,
  });
  apps.push(app);
  const page = await app.firstWindow();
  await page.setViewportSize(size).catch(() => {});
  await page.waitForFunction(() => window.__store && window.__store.getState().ready && window.__collab, null, { timeout: 60000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
  });
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
  return { app, page, home, errors, name };
}
const theme = (p, t) => p.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), t).then(() => p.waitForTimeout(300));
const st = (p, fn, arg) => p.evaluate(fn, arg);
const until = async (p, fn, arg, ms = 20000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

// ── Relais d'écoute (TCP) sur le chemin de Marc ──
const wire = [];
let hostPort = 47804; // port réel de l'hôte (un autre test peut occuper 47804)
const proxy = net.createServer((c) => {
  const up = net.connect(hostPort, '127.0.0.1');
  c.on('data', (d) => {
    wire.push(Buffer.from(d));
    up.write(d);
  });
  up.on('data', (d) => {
    wire.push(Buffer.from(d));
    c.write(d);
  });
  const end = () => {
    c.destroy();
    up.destroy();
  };
  c.on('error', end);
  up.on('error', end);
  c.on('close', end);
  up.on('close', end);
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const proxyPort = proxy.address().port;

// Message de l'app (src/features/collab/wire.ts) : [longueur u32][enveloppe JSON][octets].
const pack = (head) => {
  const h = Buffer.from(JSON.stringify(head));
  const out = Buffer.alloc(4 + h.length);
  out.writeUInt32BE(h.length, 0);
  h.copy(out, 4);
  return out;
};

/** Pointeur d'une personne chez X : état, couleur, pointe de la flèche (écran). */
const cursorOf = (X, name) =>
  st(
    X.page,
    (name) => {
      const el = [...document.querySelectorAll('[data-testid="remote-cursor"]')].find((e) => e.dataset.name === name);
      if (!el) return null;
      const r = el.querySelector('svg').getBoundingClientRect();
      const path = el.querySelector('path');
      return { state: el.dataset.state, x: r.left + 1.6, y: r.top + 1.4, fill: path?.getAttribute('fill'), label: el.querySelector('.rc-name')?.textContent, labelBg: getComputedStyle(el.querySelector('.rc-name')).backgroundColor, opacity: getComputedStyle(el).opacity };
    },
    name,
  );

/** Souris qui avance à vitesse régulière (≈ 60 mouvements par seconde, comme une vraie souris). */
async function glide(X, pts, ms) {
  const t0 = Date.now();
  for (;;) {
    const u = Math.min(1, (Date.now() - t0) / ms);
    const f = u * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(f));
    const k = f - i;
    await X.page.mouse.move(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k);
    if (u >= 1) break;
    await wait(16);
  }
}
const circle = (cx, cy, r, n = 48, turns = 1) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI * turns), cy + r * Math.sin((i / n) * 2 * Math.PI * turns)]);

const A = await launch('lea', { width: 1280, height: 840 });
const B = await launch('marc', { width: 1040, height: 760 });
const headless = [];
let wiggling = false;
/** Léa garde la souris en vie (petits mouvements) pendant les captures. */
function wiggle(X, x, y) {
  wiggling = true;
  void (async () => {
    let i = 0;
    while (wiggling) {
      await X.page.mouse.move(x + (i++ % 2 ? 1.5 : -1.5), y).catch(() => {});
      await wait(200);
    }
  })();
}
try {
  // ── Préparation de Léa : espace « Parjure » (EPUB, PDF, une carte à deux cartes) ──
  const epubB64 = fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')).toString('base64');
  const pdfB64 = fs.readFileSync(path.join(ROOT, 'fixtures/discours.pdf')).toString('base64');
  const pngB64 = fs.readFileSync(path.join(ROOT, 'fixtures/cover.png')).toString('base64');
  const seeded = await A.page.evaluate(
    async ({ epubB64, pdfB64, pngB64 }) => {
      const s = () => window.__store.getState();
      const b = (x) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0)).buffer;
      const [epub] = await s().importFiles([{ name: 'Discours de la méthode.epub', data: b(epubB64) }]);
      const [pdf] = await s().importFiles([{ name: 'Discours (PDF).pdf', data: b(pdfB64) }]);
      const [photo] = await s().importFiles([{ name: 'Photo de couverture.png', data: b(pngB64) }]);
      const ws = s().createWorkspace('Parjure').id;
      s().navigate({ name: 'workspace', workspaceId: ws, groupId: null });
      s().addToWorkspace(ws, null, 'book', epub.id);
      s().addToWorkspace(ws, null, 'book', pdf.id);
      s().addToWorkspace(ws, null, 'book', photo.id);
      const now = Date.now();
      const board = 'board-parjure';
      s().setMap(board, { id: board, kind: 'board', bookId: '', title: 'Promesse', bookIds: [], viewport: null, zones: [], nodes: [{ id: 'n1', highlightId: null, text: 'Peut-on promettre sans mentir ?', x: 0, y: 0 }, { id: 'n2', highlightId: null, text: 'Idée de Léa', x: 380, y: 60 }], edges: [], createdAt: now, updatedAt: now });
      s().addToWorkspace(ws, null, 'map', board);
      return { ws, epub: epub.id, pdf: pdf.id, photo: photo.id, photoFormat: photo.format, board };
    },
    { epubB64, pdfB64, pngB64 },
  );
  ok(!!seeded.epub && !!seeded.pdf && seeded.photoFormat === 'image', 'Léa : espace « Parjure » (EPUB, PDF, photo, carte)', seeded);

  // ── Session : Léa ouvre, Marc rejoint par le relais, Inès sans interface ──
  await A.page.click('button[aria-label="Actions"]');
  await A.page.getByText('Travailler à plusieurs…').click();
  await A.page.waitForSelector('[data-testid="collab-start"]');
  await A.page.fill('[data-testid="collab-name"]', 'Léa');
  await A.page.click('.cl-swatch[data-color="#c2410c"]');
  await A.page.click('[data-testid="collab-open"]');
  await A.page.waitForSelector('[data-testid="collab-code"]', { timeout: 30000 });
  const code = await A.page.getAttribute('[data-testid="collab-code"]', 'data-code');
  const addr = await st(A.page, () => window.__collab.state.getState().addresses[0] ?? '');
  hostPort = Number(addr.split(':')[1]) || 47804;
  await B.page.evaluate(() => window.__store.getState().navigate({ name: 'import' }));
  await B.page.click('[data-testid="import-collab-open"]');
  await B.page.waitForSelector('[data-testid="join-form"]');
  await B.page.fill('[data-testid="collab-name"]', 'Marc');
  await B.page.click('.cl-swatch[data-color="#1d4ed8"]');
  await B.page.fill('[data-testid="join-code"]', code);
  await B.page.click('text=Saisir une adresse');
  await B.page.fill('[data-testid="join-address"]', `127.0.0.1:${proxyPort}`);
  await B.page.click('[data-testid="join-go"]');
  await A.page.waitForSelector('[data-testid="collab-request"]', { timeout: 30000 });
  await A.page.click('[data-testid="collab-accept"]');
  ok(await until(B.page, () => window.__collab.state.getState().phase === 'live' && window.__collab.state.getState().workspaceId, null, 60000), 'Marc a rejoint « Parjure »');
  await A.page.keyboard.press('Escape');
  const ev = [];
  const ines = collabNet.createCollabGuest({ emit: (e) => ev.push(e), deviceName: () => 'Poste-d-Ines' });
  headless.push(ines);
  const fi = await ines.find(code, { manualAddress: `127.0.0.1:${hostPort}`, profile: { name: 'Inès', color: '#15803d' } });
  const pi = ines.join(fi.ticket);
  await A.page.waitForSelector('[data-testid="collab-asks"] [data-testid="collab-request"]', { timeout: 20000 });
  await A.page.click('[data-testid="collab-asks"] [data-testid="collab-accept"]');
  await pi;
  ok(await until(B.page, () => window.__collab.state.getState().members.filter((m) => m.state === 'live').length === 3, null, 15000), 'trois personnes (Inès sans interface)');
  const inesSend = (head) => ines.send('all', pack({ t: 'cur', ts: Math.round(performance.now()), ...head }));
  const membersB = await st(B.page, () => window.__collab.state.getState().members.map((m) => ({ id: m.id, name: m.name, color: m.color })));
  const colorOf = (n) => membersB.find((m) => m.name === n)?.color;
  const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

  // ════════ 1. Carte ════════
  const kB = await st(B.page, () => Object.entries(window.__store.getState().maps).find(([, m]) => m.kind === 'board')?.[0]);
  await A.page.evaluate((k) => window.__store.getState().navigate({ name: 'board', boardId: k }), seeded.board);
  await B.page.evaluate((k) => window.__store.getState().navigate({ name: 'board', boardId: k }), kB);
  for (const X of [A, B]) await X.page.waitForSelector('.react-flow__node', { timeout: 20000 });
  await wait(1200);
  // Marc zoome (autre zoom, autre défilement).
  await B.page.click('.react-flow__controls-zoomin');
  await B.page.click('.react-flow__controls-zoomin');
  await wait(600);
  const vp = (X) =>
    st(X.page, () => {
      const v = document.querySelector('.react-flow__viewport');
      const m = new DOMMatrixReadOnly(getComputedStyle(v).transform);
      const r = document.querySelector('.react-flow').getBoundingClientRect();
      return { tx: m.e, ty: m.f, z: m.a, left: r.left, top: r.top, w: r.width, h: r.height };
    });
  const [vA, vB] = [await vp(A), await vp(B)];
  ok(Math.abs(vA.z - vB.z) > 0.1, 'zooms différents chez Léa et Marc', { lea: vA.z.toFixed(2), marc: vB.z.toFixed(2) });
  const toFlow = (v, x, y) => ({ x: (x - v.left - v.tx) / v.z, y: (y - v.top - v.ty) / v.z });
  const toScreen = (v, f) => ({ x: v.left + v.tx + f.x * v.z, y: v.top + v.ty + f.y * v.z });

  // Échantillonneur chez Marc : position du pointeur de Léa à chaque image.
  await st(B.page, () => {
    window.__track = [];
    const loop = () => {
      const el = [...document.querySelectorAll('[data-testid="remote-cursor"]')].find((e) => e.dataset.name === 'Léa');
      if (el && el.dataset.state === 'on') {
        const r = el.getBoundingClientRect();
        window.__track.push([performance.now(), r.left, r.top]);
        // Positions reçues (repère de la carte → écran de Marc), pour la figure.
        const p = [...window.__cursors.peers.values()].find((q) => q.id === 'h' && q.ctx.startsWith('m:'));
        const v = document.querySelector('.react-flow__viewport');
        const m = new DOMMatrixReadOnly(getComputedStyle(v).transform);
        const f = document.querySelector('.react-flow').getBoundingClientRect();
        window.__raw ??= new Map();
        for (const sm of p?.samples ?? []) if (sm.loc && 'x' in sm.loc) window.__raw.set(sm.t, [sm.t, f.left + m.e + sm.loc.x * m.a, f.top + m.f + sm.loc.y * m.a]);
      }
      if (window.__trackOn) requestAnimationFrame(loop);
    };
    window.__trackOn = true;
    requestAnimationFrame(loop);
  });
  // Léa trace un cercle (2 s) ; cadence comptée chez elle.
  const cx = Math.round(vA.left + vA.w * 0.45);
  const cy = Math.round(vA.top + vA.h * 0.55);
  await A.page.mouse.move(cx + 140, cy);
  await wait(300);
  const n0 = await st(A.page, () => window.__cursors.sentStats.n);
  const t0 = Date.now();
  await glide(A, circle(cx, cy, 140, 64, 1), 2000);
  const dt = (Date.now() - t0) / 1000;
  await wait(150);
  await st(B.page, () => (window.__trackOn = false));
  await wait(60);
  const n1 = await st(A.page, () => window.__cursors.sentStats.n);
  const rate = (n1 - n0) / dt;
  ok(rate > 12 && rate <= 30, `cadence d’envoi pendant le mouvement : ${rate.toFixed(1)} messages/s (≤ 30)`, { messages: n1 - n0, secondes: dt.toFixed(2) });
  await wait(1500);
  const n2 = await st(A.page, () => window.__cursors.sentStats.n);
  ok(n2 - n1 === 0, 'souris immobile 1,5 s : 0 message', n2 - n1);
  await st(B.page, () => (window.__trackOn = false));
  // Position : même point du repère de la carte.
  const endFlow = toFlow(vA, cx + 140, cy);
  const want = toScreen(vB, endFlow);
  const cB = await cursorOf(B, 'Léa');
  ok(cB && cB.state === 'on', 'le pointeur de Léa apparaît chez Marc', cB);
  const err = cB ? Math.hypot(cB.x - want.x, cB.y - want.y) : 999;
  ok(err < 3, `au bon endroit du repère de la carte malgré un autre zoom (écart ${err.toFixed(2)} px)`, { attendu: want, vu: cB && { x: cB.x, y: cB.y } });
  ok(cB && cB.label === 'Léa' && cB.fill === colorOf('Léa') && cB.labelBg === rgb(colorOf('Léa')), 'étiqueté « Léa », dans sa couleur', cB);
  // Fluidité : pas d'à-coups (pas d'arrêts ni de sauts pendant le cercle).
  const track = await st(B.page, () => window.__track);
  const raw = await st(B.page, () => [...(window.__raw?.values() ?? [])].sort((a, b) => a[0] - b[0]));
  const steps = [];
  for (let i = 1; i < track.length; i++) steps.push(Math.hypot(track[i][1] - track[i - 1][1], track[i][2] - track[i - 1][2]));
  const mid = steps.slice(Math.floor(steps.length * 0.15), Math.floor(steps.length * 0.85));
  const sorted = [...mid].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const stalls = mid.filter((s) => s < 0.05).length;
  const jumps = mid.filter((s) => s > med * 3 + 2).length;
  // Aucun retour en arrière (la courbe ne repart jamais en sens inverse entre deux images).
  let back = 0;
  for (let i = 2; i < track.length; i++) {
    const ax = track[i - 1][1] - track[i - 2][1], ay = track[i - 1][2] - track[i - 2][2];
    const bx = track[i][1] - track[i - 1][1], by = track[i][2] - track[i - 1][2];
    if (Math.hypot(ax, ay) > 0.5 && Math.hypot(bx, by) > 0.5 && ax * bx + ay * by < 0) back++;
  }
  const fps = track.length > 1 ? (track.length - 1) / ((track[track.length - 1][0] - track[0][0]) / 1000) : 0;
  ok(mid.length > 40 && stalls <= Math.max(2, mid.length * 0.04) && jumps <= Math.max(1, mid.length * 0.03) && back <= 1, 'mouvement continu chez Marc (images sans arrêt, ni saut, ni retour en arrière)', { images: track.length, ips: fps.toFixed(0), pasMedian: med.toFixed(2), arrets: stalls, sauts: jumps, retours: back });
  fs.writeFileSync(path.join(SHOTS, 'trajectoire-carte.json'), JSON.stringify({ track, steps, raw }));

  // prefers-reduced-motion chez Marc : aucune interpolation (une position par paquet reçu), aucun fondu animé.
  await B.page.emulateMedia({ reducedMotion: 'reduce' });
  await st(B.page, () => {
    window.__seen = new Set();
    window.__seenOn = true;
    const loop = () => {
      const el = [...document.querySelectorAll('[data-testid="remote-cursor"]')].find((e) => e.dataset.name === 'Léa');
      if (el && el.dataset.state === 'on') window.__seen.add(el.style.transform);
      if (window.__seenOn) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const r0 = await st(A.page, () => window.__cursors.sentStats.n);
  await glide(A, circle(cx, cy, 120, 32, 0.5), 1000);
  await wait(300);
  const r1 = await st(A.page, () => window.__cursors.sentStats.n);
  const rm = await st(B.page, () => {
    window.__seenOn = false;
    const el = [...document.querySelectorAll('[data-testid="remote-cursor"]')].find((e) => e.dataset.name === 'Léa');
    return { distinct: window.__seen.size, transition: getComputedStyle(el).transitionDuration };
  });
  ok(rm.distinct <= r1 - r0 + 2 && parseFloat(rm.transition) <= 0.01, 'mouvement réduit (prefers-reduced-motion) : saut direct à chaque position reçue, sans fondu animé', { positionsAffichees: rm.distinct, paquets: r1 - r0, transition: rm.transition });
  await B.page.emulateMedia({ reducedMotion: 'no-preference' });

  // Animation : Léa trace un second cercle lentement ; images prises chez Marc.
  const box = { x: Math.max(0, want.x - 330), y: Math.max(0, want.y - 230), width: 520, height: 400 };
  const animDir = path.join(SHOTS, 'anim');
  fs.rmSync(animDir, { recursive: true, force: true });
  fs.mkdirSync(animDir, { recursive: true });
  let frames = 0;
  let moving = true;
  const mover = glide(A, circle(cx, cy, 140, 64, 1), 4500).then(() => (moving = false));
  const ft0 = Date.now();
  const stamps = [];
  while (moving) {
    await B.page.screenshot({ path: path.join(animDir, `f${String(frames).padStart(3, '0')}.png`), clip: box });
    stamps.push(Date.now() - ft0);
    frames++;
  }
  await mover;
  fs.writeFileSync(path.join(animDir, 'stamps.json'), JSON.stringify(stamps));
  ok(frames >= 12, `animation chez Marc : ${frames} images`);

  // Pointeur effacé après inactivité.
  await wait(4600);
  const idle = await cursorOf(B, 'Léa');
  ok(idle && idle.state === 'idle' && Number(idle.opacity) === 0, 'immobile 4,5 s : le pointeur de Léa s’est effacé en fondu', idle);

  // Carte en cours de déplacement : entourée de la couleur de Léa chez Marc.
  const nodeA = await st(A.page, () => {
    const el = [...document.querySelectorAll('.react-flow__node')].find((n) => n.textContent.includes('Idée de Léa'));
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  // Marc fait défiler sa carte : la carte « Idée de Léa » au centre de sa vue.
  const n2B = await st(B.page, () => {
    const el = [...document.querySelectorAll('.react-flow__node')].find((n) => n.textContent.includes('Idée de Léa'));
    const r = el.getBoundingClientRect();
    const f = document.querySelector('.react-flow').getBoundingClientRect();
    // Un point libre du fond, pour saisir la carte.
    let free = null;
    for (let y = f.top + 120; y < f.bottom - 160 && !free; y += 23)
      for (let x = f.left + 60; x < f.right - 200 && !free; x += 31) if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) free = { x, y };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, cx: f.left + f.width / 2, cy: f.top + f.height * 0.42, free };
  });
  if (n2B.free) {
    const dx = n2B.cx - n2B.x;
    const dy = n2B.cy - n2B.y;
    await B.page.mouse.move(n2B.free.x, n2B.free.y);
    await B.page.mouse.down();
    await B.page.mouse.move(n2B.free.x + dx / 2, n2B.free.y + dy / 2, { steps: 6 });
    await B.page.mouse.move(n2B.free.x + dx, n2B.free.y + dy, { steps: 6 });
    await B.page.mouse.up();
    await B.page.mouse.move(5, 5);
    await wait(400);
  }
  const vB2 = await vp(B);
  const fc = toFlow(vB2, vB2.left + vB2.w / 2, vB2.top + vB2.h / 2);
  // Inès bouge aussi sur la carte (second pointeur), en bas à gauche de la vue de Marc.
  const inesMap = `m:${seeded.board}`;
  let inesOn = true;
  const inesLoop = (async () => {
    let i = 0;
    while (inesOn) {
      const a = (i++ / 30) * Math.PI;
      inesSend({ k: inesMap, p: { x: fc.x - 170 + 36 * Math.cos(a), y: fc.y + 120 + 20 * Math.sin(a) } });
      await wait(40);
    }
  })();
  await A.page.mouse.move(nodeA.x, nodeA.y);
  await A.page.mouse.down();
  await glide(A, [[nodeA.x, nodeA.y], [nodeA.x + 60, nodeA.y + 80], [nodeA.x + 90, nodeA.y + 140]], 700);
  await wait(250);
  const frame = await st(B.page, () => {
    const f = [...document.querySelectorAll('[data-testid="remote-frame"]')].find((e) => e.dataset.state === 'on');
    if (!f) return null;
    const cs = getComputedStyle(f);
    return { border: cs.borderTopColor, label: f.querySelector('.rc-frame-name').textContent.trim(), ghost: f.querySelector('.rc-ghost')?.textContent.includes('Idée de Léa') ?? false, w: f.getBoundingClientRect().width, h: f.getBoundingClientRect().height };
  });
  ok(frame && frame.border === rgb(colorOf('Léa')) && frame.label === 'Léa' && frame.ghost && frame.w > 60, 'chez Marc : la carte que Léa déplace (sa copie suit le pointeur) est entourée de sa couleur, avec son prénom', frame);
  const both = await st(B.page, () => [...document.querySelectorAll('[data-testid="remote-cursor"]')].filter((e) => e.dataset.state === 'on').map((e) => e.dataset.name).sort());
  ok(both.join() === 'Inès,Léa', 'chez Marc : deux pointeurs (Léa et Inès)', both);
  wiggle(A, nodeA.x + 90, nodeA.y + 140);
  for (const [t, label] of [['light', 'clair'], ['dark', 'sombre']]) {
    await theme(B.page, t);
    await B.page.screenshot({ path: path.join(SHOTS, `carte-${label}.png`) });
  }
  await theme(B.page, 'light');
  wiggling = false;
  await wait(250);
  await A.page.mouse.up();
  const dropped = await until(B.page, (k) => {
    const n = window.__store.getState().maps[k].nodes.find((x) => x.id === 'n2');
    return n && (n.x !== 380 || n.y !== 60);
  }, kB, 10000);
  ok(dropped, 'carte lâchée chez Léa : nouvelle position chez Marc');
  ok(await until(B.page, () => ![...document.querySelectorAll('[data-testid="remote-frame"]')].some((e) => e.dataset.state === 'on'), null, 3000), 'carte lâchée : le cadre disparaît');
  // Modification : cadre pointillé « Léa modifie ».
  await A.page.mouse.dblclick(nodeA.x + 90, nodeA.y + 140).catch(() => {});
  const editing = await until(B.page, () => [...document.querySelectorAll('[data-testid="remote-frame"]')].some((e) => e.dataset.state === 'on' && e.dataset.kind === 'edit' && /Léa modifie/.test(e.textContent)), null, 5000);
  ok(editing, 'Léa modifie une carte : cadre « Léa modifie » chez Marc');
  await A.page.keyboard.press('Escape');
  inesOn = false;
  await inesLoop;
  // Léa quitte la carte : son pointeur disparaît aussitôt chez Marc.
  await A.page.mouse.move(cx, cy);
  await wait(200);
  ok((await cursorOf(B, 'Léa'))?.state === 'on', 'Léa revient sur la carte : visible');
  await A.page.evaluate((ws) => window.__store.getState().navigate({ name: 'workspace', workspaceId: ws, groupId: null }), seeded.ws);
  ok(await until(B.page, () => ![...document.querySelectorAll('[data-testid="remote-cursor"]')].some((e) => e.dataset.name === 'Léa'), null, 3000), 'Léa quitte la carte : son pointeur disparaît chez Marc');

  // ════════ 2. PDF (fenêtres de tailles différentes) ════════
  const pdfB = await st(B.page, (g) => {
    const s = window.__store.getState();
    return s.books.find((b) => b.id === g || b.shareOrigin?.srcId === g)?.id ?? s.books.find((b) => b.format === 'pdf')?.id;
  }, seeded.pdf);
  await A.page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), seeded.pdf);
  await B.page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), pdfB);
  for (const X of [A, B]) await X.page.waitForSelector('.pdf-page[data-page="1"] canvas', { timeout: 30000 });
  await wait(1200);
  const pageRect = (X, n) => st(X.page, (n) => { const r = document.querySelector(`.pdf-page[data-page="${n}"]`).getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; }, n);
  const [pA, pB] = [await pageRect(A, 1), await pageRect(B, 1)];
  ok(Math.abs(pA.w - pB.w) > 20, 'pages de tailles différentes chez Léa et Marc', { lea: Math.round(pA.w), marc: Math.round(pB.w) });
  const fx = 0.32;
  const fy = Math.min(0.45, (vA.h * 0.6) / pA.h);
  const pcx = pA.left + pA.w * fx;
  const pcy = pA.top + pA.h * fy;
  await glide(A, circle(pcx, pcy, 40, 24, 1), 800);
  await wait(400);
  // Le cercle finit à (cx + r, cy) : même fraction de page chez Marc.
  const wantP2 = { x: pB.left + pB.w * ((pcx + 40 - pA.left) / pA.w), y: pB.top + pB.h * ((pcy - pA.top) / pA.h) };
  const cP = await cursorOf(B, 'Léa');
  const errP = cP ? Math.hypot(cP.x - wantP2.x, cP.y - wantP2.y) : 999;
  ok(cP && cP.state === 'on' && errP < 3, `PDF : même point de la page 1 chez Marc (écart ${errP.toFixed(2)} px)`, { attendu: wantP2, vu: cP });
  // Inès sur la page 2 : pas de pointeur ici, « Inès lit page 2 ».
  const pdfCtx = `b:${seeded.pdf}`;
  inesSend({ k: pdfCtx, w: { u: 'p2', label: 'page 2' } });
  for (let i = 0; i < 6; i++) {
    inesSend({ k: pdfCtx, p: { u: 'p2', fx: 0.5, fy: 0.3 + i * 0.01 } });
    await wait(40);
  }
  await wait(400);
  const inesP = await cursorOf(B, 'Inès');
  ok(!inesP || inesP.state !== 'on', 'PDF : Inès sur la page 2 (non affichée chez Marc) : pas de pointeur', inesP);
  const whereTxt = await st(B.page, () => [...document.querySelectorAll('[data-testid="remote-where"]')].filter((e) => !e.hidden).map((e) => e.textContent.trim()));
  ok(whereTxt.some((t) => t === 'Inès lit page 2'), 'PDF : « Inès lit page 2 »', whereTxt);
  wiggle(A, pcx + 40, pcy);
  for (const [t, label] of [['light', 'clair'], ['dark', 'sombre']]) {
    await theme(B.page, t);
    await B.page.screenshot({ path: path.join(SHOTS, `pdf-${label}.png`) });
  }
  await theme(B.page, 'light');
  wiggling = false;
  // Marc va à la page 2 : Inès apparaît.
  await B.page.evaluate(() => document.querySelector('.pdf-page[data-page="2"]').scrollIntoView({ block: 'start' }));
  await wait(300);
  for (let i = 0; i < 8; i++) {
    inesSend({ k: pdfCtx, p: { u: 'p2', fx: 0.5 + i * 0.01, fy: 0.2 } });
    await wait(40);
  }
  await wait(300);
  const inesP2 = await cursorOf(B, 'Inès');
  const p2 = await pageRect(B, 2);
  const errI = inesP2 ? Math.hypot(inesP2.x - (p2.left + p2.w * 0.57), inesP2.y - (p2.top + p2.h * 0.2)) : 999;
  ok(inesP2 && inesP2.state === 'on' && errI < 3, `PDF : Marc à la page 2, Inès y apparaît au bon endroit (écart ${errI.toFixed(2)} px)`, inesP2);
  inesSend({ k: pdfCtx, bye: 1 });

  // ════════ 2 bis. Photo (image, fenêtres de tailles différentes) ════════
  const photoB = await st(B.page, (g) => window.__store.getState().books.find((b) => b.id === g || b.shareOrigin?.srcId === g)?.id, seeded.photo);
  await A.page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), seeded.photo);
  await B.page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), photoB);
  for (const X of [A, B]) await X.page.waitForSelector('.img-page[data-page="1"] img', { timeout: 30000 });
  await wait(1200);
  const imgRect = (X) => st(X.page, () => { const r = document.querySelector('.img-page').getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; });
  const [iA, iB] = [await imgRect(A), await imgRect(B)];
  const ix = Math.round(iA.left + iA.w * 0.6);
  const iy = Math.round(iA.top + Math.min(iA.h, vA.h * 0.5) * 0.5);
  await glide(A, [[ix - 80, iy - 40], [ix - 30, iy - 10], [ix, iy]], 600);
  await wait(400);
  const cI = await cursorOf(B, 'Léa');
  const wantI = { x: iB.left + iB.w * ((ix - iA.left) / iA.w), y: iB.top + iB.h * ((iy - iA.top) / iA.h) };
  const errImg = cI ? Math.hypot(cI.x - wantI.x, cI.y - wantI.y) : 999;
  ok(Math.abs(iA.w - iB.w) > 10 && cI && cI.state === 'on' && errImg < 3, `photo : même point de l’image chez Marc (écart ${errImg.toFixed(2)} px)`, { lea: Math.round(iA.w), marc: Math.round(iB.w), vu: cI && { x: cI.x, y: cI.y }, attendu: wantI });

  // ════════ 3. EPUB (fenêtre et taille de texte différentes) ════════
  await B.page.evaluate(() => window.__store.getState().updateSettings({ fontSize: (window.__store.getState().settings.fontSize || 18) + 6 }));
  const epubB = await st(B.page, (g) => {
    const s = window.__store.getState();
    return s.books.find((b) => b.id === g || b.shareOrigin?.srcId === g)?.id ?? s.books.find((b) => b.format === 'epub')?.id;
  }, seeded.epub);
  await A.page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), seeded.epub);
  await B.page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), epubB);
  for (const X of [A, B]) await X.page.waitForSelector('.html-chapter-text', { timeout: 30000 });
  await wait(1500);
  // Un mot visible chez les deux : le premier « bon sens » du texte, amené en vue.
  const WORD = 'bon sens';
  const wordRect = (X) =>
    st(X.page, (w) => {
      for (const root of document.querySelectorAll('.html-chapter-text')) {
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = tw.nextNode())) {
          const i = n.data.indexOf(w);
          if (i < 0) continue;
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + w.length);
          const rr = r.getClientRects()[0];
          return { left: rr.left, top: rr.top, w: rr.width, h: rr.height, ch: root.dataset.chapter };
        }
      }
      return null;
    }, WORD);
  const bring = (X) =>
    st(X.page, (w) => {
      for (const root of document.querySelectorAll('.html-chapter-text')) {
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = tw.nextNode())) if (n.data.includes(w)) return n.parentElement.scrollIntoView({ block: 'center' });
      }
    }, WORD);
  await bring(A);
  await bring(B);
  await wait(600);
  const [wA, wB] = [await wordRect(A), await wordRect(B)];
  ok(wA && wB && Math.abs(wA.h - wB.h) > 2, 'EPUB : texte de tailles différentes chez Léa et Marc', { lea: wA, marc: wB });
  // Léa pointe le mot « sens » (milieu du mot).
  const ex = wA.left + wA.w * 0.75;
  const ey = wA.top + wA.h * 0.5;
  await glide(A, [[ex - 120, ey + 60], [ex - 50, ey + 20], [ex, ey]], 700);
  await wait(400);
  const cE = await cursorOf(B, 'Léa');
  const wB2 = await wordRect(B);
  const inside = cE && cE.x >= wB2.left - 2 && cE.x <= wB2.left + wB2.w + 2 && cE.y >= wB2.top - 2 && cE.y <= wB2.top + wB2.h + 2;
  ok(cE && cE.state === 'on' && inside, 'EPUB : le pointeur de Léa est sur le même mot chez Marc (autre largeur, autre taille de texte)', { mot: wB2, vu: cE && { x: cE.x, y: cE.y } });
  // Inès dans un autre livre (le PDF) : rien ici.
  for (let i = 0; i < 6; i++) {
    inesSend({ k: pdfCtx, p: { u: 'p1', fx: 0.4, fy: 0.3 + i * 0.01 } });
    await wait(40);
  }
  await wait(300);
  const inesE = await st(B.page, () => [...document.querySelectorAll('[data-testid="remote-cursor"]')].filter((e) => e.dataset.name === 'Inès' && e.dataset.state === 'on').length);
  ok(inesE === 0, 'EPUB : Inès dans un autre livre : aucun pointeur ici', inesE);
  wiggle(A, ex, ey);
  for (const [t, label] of [['light', 'clair'], ['dark', 'sombre']]) {
    await theme(B.page, t);
    await B.page.screenshot({ path: path.join(SHOTS, `epub-${label}.png`) });
  }
  await theme(B.page, 'light');
  wiggling = false;
  await wait(300);

  // ════════ 4. Trafic ════════
  const all = Buffer.concat(wire);
  ok(all.length > 20000, 'le relais a vu passer la session de Marc', all.length);
  const secrets = ['Parjure', 'Léa', 'Marc', 'Inès', 'Promesse', 'Idée de Léa', '"cur"', 'board-parjure', seeded.pdf, seeded.epub, 'page 2', code];
  const hits = secrets.filter((x) => all.includes(Buffer.from(x)) || all.includes(Buffer.from(x, 'utf16le')));
  ok(hits.length === 0, 'aucune donnée en clair dans le trafic (prénoms, titres, identifiants, positions)', hits);

  // Animation (GIF) : Python / PIL.
  try {
    execFileSync('python3', [path.join(ROOT, 'scripts/cursors-gif.py'), animDir, path.join(SHOTS, 'carte-mouvement.gif'), path.join(SHOTS, 'trajectoire-carte.json'), path.join(SHOTS, 'trajectoire-carte.png')], { stdio: 'inherit' });
    ok(fs.existsSync(path.join(SHOTS, 'carte-mouvement.gif')), 'animation : shots/curseurs/carte-mouvement.gif');
  } catch (e) {
    ok(false, 'animation GIF', String(e));
  }
} finally {
  wiggling = false;
  for (const X of [A, B]) if (X.errors.length) console.log(`(${X.name}) erreurs de page :`, [...new Set(X.errors)].slice(0, 8));
  for (const h of headless) h.leave?.();
  for (const a of apps) await a.close().catch(() => {});
  proxy.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}
