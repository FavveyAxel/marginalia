// Vidéo du site (section « À plusieurs, sur le même travail ») : la collaboration en direct, vue depuis l'écran
// de Marc. Deux processus Electron (hôte Léa, invité Marc) et une invitée « sans interface » Inès
// (electron/collab-net.cjs), comme scripts/test-cursors.mjs. Données de démonstration uniquement.
//  1. Carte : le pointeur de Léa glisse, attrape une carte et la déplace (cadre à sa couleur) ; Inès bouge aussi.
//  2. Écrit : Léa tape une phrase, qui apparaît lettre à lettre chez Marc avec son curseur et son prénom.
//  3. Livre : Léa sélectionne un passage du Discours de la méthode, teinté à sa couleur chez Marc.
// Enregistrement : images du compositeur de la fenêtre de Marc (CDP Page.startScreencast, JPEG haute qualité,
// horodatées), remises à 30 i/s par ffmpeg ; fondus entre les plans et retour au premier plan (boucle).
// Sorties : site/public/captures/ensemble.mp4, ensemble.webm, ensemble-poster.jpg ; brouillons dans shots/video/.
// Prérequis : npx vite build ; Xvfb (:99) ; ffmpeg (libx264, libvpx-vp9).
// Lancer : DISPLAY=:99 LANG=C.UTF-8 timeout 900 node scripts/video-collab.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';

process.env.MARGINALIA_E2E = '1';
process.env.MARGINALIA_E2E_LAN = '127.0.0.1';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const collabNet = require(path.join(ROOT, 'electron/collab-net.cjs'));
const WORK = path.join(ROOT, 'shots/video');
const OUT = path.join(ROOT, 'site/public/captures');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
  console.error('dist/ manquant : lancez d’abord « npx vite build ».');
  process.exit(1);
}
const log = (...a) => console.log('·', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1440;
const H = 900;
const ZOOM = Number(process.env.ZOOM || 1.25); // interface de Marc agrandie : lisible à ~700 px de large
const FPS = 30;

const dirs = [];
const apps = [];
async function launch(name, size, zoom = 1, display = process.env.DISPLAY) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `mg-vid-${name}-`));
  dirs.push(home);
  const app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, DISPLAY: display, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: path.join(home, 'donnees'), MARGINALIA_E2E_LAN: '127.0.0.1', VITE_DEV_SERVER_URL: '' },
    timeout: 60000,
  });
  apps.push(app);
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, { size, zoom }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setContentBounds({ x: 0, y: 0, width: size.width, height: size.height });
    w.webContents.setZoomFactor(zoom);
  }, { size, zoom });
  await page.waitForFunction(() => window.__store && window.__store.getState().ready && window.__collab, null, { timeout: 60000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off', theme: 'light' }));
  return { app, page, home, errors, name };
}
const st = (p, fn, arg) => p.evaluate(fn, arg);
const until = async (p, fn, arg, ms = 20000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const pack = (head) => {
  const h = Buffer.from(JSON.stringify(head));
  const out = Buffer.alloc(4 + h.length);
  out.writeUInt32BE(h.length, 0);
  h.copy(out, 4);
  return out;
};

// ── Mouvements de souris crédibles ──
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2); // accélération et freinage doux
/** Courbe de Bézier cubique de a à b, bombée de `bend` (fraction de la distance, signe = côté). */
function curve(a, b, bend = 0.18) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const nx = -dy * bend;
  const ny = dx * bend;
  const c1 = [a[0] + dx * 0.3 + nx, a[1] + dy * 0.3 + ny];
  const c2 = [a[0] + dx * 0.72 + nx * 0.6, a[1] + dy * 0.72 + ny * 0.6];
  return (u) => {
    const v = 1 - u;
    return [v * v * v * a[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * b[0], v * v * v * a[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * b[1]];
  };
}
/** Fait suivre la courbe à la souris de X en `ms` (≈ 60 mouvements par seconde), avec une vitesse en cloche. */
async function glide(X, a, b, ms, bend = 0.18, easing = ease) {
  const f = curve(a, b, bend);
  const t0 = Date.now();
  for (;;) {
    const u = Math.min(1, (Date.now() - t0) / ms);
    const [x, y] = f(easing(u));
    await X.page.mouse.move(x, y);
    if (u >= 1) break;
    await wait(15);
  }
  return b;
}

// ── Enregistrement de la fenêtre de Marc : son propre écran X (Xvfb :100, 1440×900), capturé par ffmpeg ──
// (x11grab, sans pointeur système, sans perte). Les gestes de Léa sont joués SLOW fois plus lentement, puis la
// vidéo est accélérée d'autant : le rendu reste fluide même quand les deux fenêtres se partagent peu de CPU.
const SLOW = Number(process.env.SLOW || 2);
const T = (ms) => ms * SLOW;
const MARC_DISPLAY = process.env.MARC_DISPLAY || ':100';
const xvfb = spawn('Xvfb', [MARC_DISPLAY, '-screen', '0', '1600x1000x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
await wait(1200);
function startRec(X, name) {
  const file = path.join(WORK, `${name}.mkv`);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', String(FPS), '-video_size', `${W}x${H}`, '-draw_mouse', '0', '-i', `${MARC_DISPLAY}.0+0,0`, '-c:v', 'libx264rgb', '-preset', 'ultrafast', '-qp', '0', file], { stdio: ['pipe', 'ignore', 'inherit'] });
  const t0 = Date.now();
  // Cadence réelle de la fenêtre de Marc pendant la prise (images rendues par seconde, plus long trou).
  const meter = X.page.evaluate(() => {
    window.__rafOn = true;
    window.__raf = [];
    const f = (t) => {
      window.__raf.push(t);
      if (window.__rafOn) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  return {
    async stop() {
      await meter;
      const raf = await X.page.evaluate(() => {
        window.__rafOn = false;
        const r = window.__raf;
        let max = 0;
        for (let i = 1; i < r.length; i++) max = Math.max(max, r[i] - r[i - 1]);
        return { fps: (r.length - 1) / ((r[r.length - 1] - r[0]) / 1000), max };
      });
      ff.stdin.write('q');
      await new Promise((r) => ff.on('close', r));
      const seconds = (Date.now() - t0) / 1000;
      log(`${name} : ${seconds.toFixed(1)} s réelles (÷${SLOW} → ${(seconds / SLOW).toFixed(1)} s) ; fenêtre de Marc ${raf.fps.toFixed(0)} i/s réelles (${(raf.fps * SLOW).toFixed(0)} perçues), plus long trou ${raf.max.toFixed(0)} ms (${(raf.max / SLOW).toFixed(0)} perçues)`);
      return { file, seconds, fps: raf.fps, maxGap: raf.max };
    },
  };
}
/** Cache les boutons de fenêtre que Linux dessine en haut à droite (titleBarOverlay) : bande d'un pixel, couleur du fond. */
async function hideWindowControls(X) {
  await X.app.evaluate(({ BrowserWindow }) => {
    const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0]);
    if (!proto.__mgPatched && typeof proto.setTitleBarOverlay === 'function') {
      const orig = proto.setTitleBarOverlay;
      proto.setTitleBarOverlay = function (o) {
        return orig.call(this, { ...o, symbolColor: o.color || '#efebe3', height: 1 });
      };
      proto.__mgPatched = true;
    }
  });
  await X.page.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
  await wait(300);
  await X.page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));
  await wait(300);
}

const A = await launch('lea', { width: 1180, height: 760 });
const B = await launch('marc', { width: W, height: H }, ZOOM, MARC_DISPLAY);
await hideWindowControls(B);
const headless = [];
let inesOn = false;
try {
  // ── Espace « Parjure » chez Léa : le Discours de la méthode, une dissertation, une carte ──
  const epubB64 = fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')).toString('base64');
  const mdText = [
    '# Le parjure',
    '',
    'Peut-on promettre sans mentir ? Promettre, c’est s’engager pour un avenir que l’on ne connaît pas encore.',
    '',
    'Descartes conseille d’être « le plus ferme et le plus résolu » dans ses actions : tenir sa décision, même quand elle reste douteuse.',
    '',
    'Rousseau, lui, fait de l’engagement réciproque le fondement du contrat social.',
    '',
  ].join('\n');
  const seeded = await A.page.evaluate(
    async ({ epubB64, mdText }) => {
      const s = () => window.__store.getState();
      const b = (x) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0)).buffer;
      const [epub] = await s().importFiles([{ name: 'Discours de la méthode.epub', data: b(epubB64) }]);
      const ws = s().createWorkspace('Parjure').id;
      s().navigate({ name: 'workspace', workspaceId: ws, groupId: null });
      s().addToWorkspace(ws, null, 'book', epub.id);
      await s().importFiles([{ name: 'Dissertation.md', data: new TextEncoder().encode(mdText).buffer }]);
      const draft = s().drafts[0]?.id;
      if (draft && !s().wsItems.some((i) => i.kind === 'draft')) s().addToWorkspace(ws, null, 'draft', draft);
      const now = Date.now();
      const board = 'board-parjure';
      s().setMap(board, {
        id: board,
        kind: 'board',
        bookId: '',
        title: 'Promesse',
        bookIds: [],
        viewport: null,
        zones: [],
        nodes: [
          { id: 'n1', highlightId: null, text: 'Peut-on promettre sans mentir ?', x: 0, y: 0 },
          { id: 'n2', highlightId: null, text: 'Descartes : rester ferme et résolu', x: -250, y: 170 },
          { id: 'n3', highlightId: null, text: 'Rousseau : la parole fonde le contrat', x: 250, y: 170 },
          { id: 'n4', highlightId: null, text: 'Une promesse tenue malgré soi', x: 270, y: -175 },
        ],
        edges: [
          { id: 'e1', source: 'n2', target: 'n1', relation: 'soutient', groupId: null },
          { id: 'e2', source: 'n3', target: 'n1', relation: 'repond', groupId: null },
        ],
        createdAt: now,
        updatedAt: now,
      });
      s().addToWorkspace(ws, null, 'map', board);
      return { ws, epub: epub.id, draft, board };
    },
    { epubB64, mdText },
  );
  log('espace prêt', seeded);

  // ── Session : Léa ouvre, Marc rejoint, Inès (sans interface) aussi ──
  await A.page.click('button[aria-label="Actions"]');
  await A.page.getByText('Travailler à plusieurs…').click();
  await A.page.waitForSelector('[data-testid="collab-start"]');
  await A.page.fill('[data-testid="collab-name"]', 'Léa');
  await A.page.click('.cl-swatch[data-color="#c2410c"]');
  await A.page.click('[data-testid="collab-open"]');
  await A.page.waitForSelector('[data-testid="collab-code"]', { timeout: 30000 });
  const code = await A.page.getAttribute('[data-testid="collab-code"]', 'data-code');
  const addr = await st(A.page, () => window.__collab.state.getState().addresses[0] ?? '');
  const hostPort = Number(addr.split(':')[1]) || 47804;
  await B.page.evaluate(() => window.__store.getState().navigate({ name: 'import' }));
  await B.page.click('[data-testid="import-collab-open"]');
  await B.page.waitForSelector('[data-testid="join-form"]');
  await B.page.fill('[data-testid="collab-name"]', 'Marc');
  await B.page.click('.cl-swatch[data-color="#1d4ed8"]');
  await B.page.fill('[data-testid="join-code"]', code);
  await B.page.click('.br-trouble summary');
  await B.page.click('text=Saisir une adresse');
  await B.page.fill('[data-testid="join-address"]', `127.0.0.1:${hostPort}`);
  await B.page.click('[data-testid="join-go"]');
  await A.page.waitForSelector('[data-testid="collab-request"]', { timeout: 30000 });
  await A.page.click('[data-testid="collab-accept"]');
  if (!(await until(B.page, () => window.__collab.state.getState().phase === 'live' && window.__collab.state.getState().workspaceId, null, 60000))) throw new Error('Marc n’a pas rejoint');
  await A.page.keyboard.press('Escape');
  const ines = collabNet.createCollabGuest({ emit: () => {}, deviceName: () => 'Poste-d-Ines' });
  headless.push(ines);
  const fi = await ines.find(code, { manualAddress: `127.0.0.1:${hostPort}`, profile: { name: 'Inès', color: '#15803d' } });
  const pi = ines.join(fi.ticket);
  await A.page.waitForSelector('[data-testid="collab-asks"] [data-testid="collab-request"]', { timeout: 20000 });
  await A.page.click('[data-testid="collab-asks"] [data-testid="collab-accept"]');
  await pi;
  if (!(await until(B.page, () => window.__collab.state.getState().members.filter((m) => m.state === 'live').length === 3, null, 15000))) throw new Error('Inès absente');
  const inesSend = (head) => ines.send('all', pack({ t: 'cur', ts: Math.round(performance.now()), ...head }));
  log('session à trois, code', code);
  // Marc : fenêtres et bulles fermées ; espace « Parjure » déplié dans la barre latérale.
  for (let i = 0; i < 3; i++) await B.page.keyboard.press('Escape');
  const idB = (g, kind) =>
    st(B.page, ({ g, kind }) => {
      const s = window.__store.getState();
      if (kind === 'book') return s.books.find((b) => b.id === g || b.shareOrigin?.srcId === g)?.id ?? s.books.find((b) => b.format === 'epub')?.id;
      if (kind === 'draft') return s.drafts.find((d) => d.id === g || d.shareOrigin?.srcId === g)?.id ?? s.drafts[0]?.id;
      return Object.entries(s.maps).find(([, m]) => m.kind === 'board')?.[0];
    }, { g, kind });
  const bookB = await idB(seeded.epub, 'book');
  const draftB = await idB(seeded.draft, 'draft');
  const boardB = await idB(seeded.board, 'map');

  // Barre latérale de Marc : l'espace « Parjure » entièrement visible.
  const sidebarDown = () =>
    st(B.page, () => {
      const el = [...document.querySelectorAll('aside *')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Parjure');
      for (let p = el?.parentElement; p; p = p.parentElement)
        if (p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY)) {
          p.scrollTop = p.scrollHeight;
          break;
        }
    });

  // ════════ 1. Carte ════════
  await A.page.evaluate((k) => window.__store.getState().navigate({ name: 'board', boardId: k }), seeded.board);
  await B.page.evaluate((k) => window.__store.getState().navigate({ name: 'board', boardId: k }), boardB);
  for (const X of [A, B]) await X.page.waitForSelector('.react-flow__node', { timeout: 20000 });
  await wait(1500);
  const nodeRect = (X, txt) =>
    st(X.page, (txt) => {
      const el = [...document.querySelectorAll('.react-flow__node')].find((n) => n.textContent.includes(txt));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top };
    }, txt);
  const vp = (X) =>
    st(X.page, () => {
      const v = document.querySelector('.react-flow__viewport');
      const m = new DOMMatrixReadOnly(getComputedStyle(v).transform);
      const r = document.querySelector('.react-flow').getBoundingClientRect();
      return { tx: m.e, ty: m.f, z: m.a, left: r.left, top: r.top, w: r.width, h: r.height };
    });
  // Marc et Léa : vue réglée (zoom et cadrage), gardée par chacun (la vue de la carte n'est pas partagée).
  // Contenu (repère de la carte) : x ∈ [-250, 600], y ∈ [-175, 255] ; en haut, la légende et « À placer »
  // (≈ 60 px), en bas la barre d'outils (≈ 80 px). Sans la mini-carte (préférence locale de Marc).
  async function frame(X, key, z) {
    const r = await vp(X);
    const view = { x: Math.round(r.w / 2 - 175 * z), y: Math.round(60 + (r.h - 140) / 2 - 40 * z), zoom: z };
    await X.page.evaluate(({ key, view }) => {
      const s = window.__store.getState();
      s.setMap(key, { ...s.maps[key], viewport: view });
    }, { key, view });
    await X.page.evaluate((ws) => window.__store.getState().navigate({ name: 'workspace', workspaceId: ws, groupId: null }), await X.page.evaluate(() => window.__collab.state.getState().workspaceId));
    await wait(400);
    await X.page.evaluate((k) => window.__store.getState().navigate({ name: 'board', boardId: k }), key);
    await X.page.waitForSelector('.react-flow__node', { timeout: 20000 });
    await wait(900);
  }
  await B.page.evaluate(() => localStorage.setItem('marginalia.map.minimap', '0'));
  await frame(A, seeded.board, 0.85);
  await frame(B, boardB, 0.96);
  const vA = await vp(A);
  const vB = await vp(B);
  log('vues', { lea: vA, marc: vB }, await nodeRect(B, 'malgré soi'));
  await sidebarDown();
  await B.page.mouse.move(W / ZOOM - 4, H / ZOOM - 4); // souris de Marc hors du jeu
  await B.page.screenshot({ path: path.join(WORK, 'prep-carte.png') });

  const toFlow = (v, x, y) => ({ x: (x - v.left - v.tx) / v.z, y: (y - v.top - v.ty) / v.z });
  // Inès : un pointeur vert qui flâne doucement en bas à gauche de la carte (repère de la carte).
  const inesMap = `m:${seeded.board}`;
  const inesBase = { x: -150, y: 50 };
  inesOn = true;
  const inesLoop = (async () => {
    const t0 = Date.now();
    while (inesOn) {
      const t = (Date.now() - t0) / 1000 / SLOW;
      inesSend({ k: inesMap, p: { x: inesBase.x + 60 * Math.sin(t * 0.55) + 18 * Math.sin(t * 1.7), y: inesBase.y + 26 * Math.sin(t * 0.8 + 1) } });
      await wait(Math.round(40 / Math.max(1, SLOW / 1.5)));
    }
  })();
  await wait(600);
  // Léa (repère de la carte → son écran) : la souris entre en haut à gauche, passe au-dessus de la question,
  // attrape « Une promesse tenue malgré soi » et la range au-dessus de Descartes.
  const toScreenA = (fx, fy) => [vA.left + vA.tx + fx * vA.z, vA.top + vA.ty + fy * vA.z];
  const card = await nodeRect(A, 'malgré soi');
  const cardFlow = toFlow(vA, card.left, card.top);
  log('carte de Léa (repère)', cardFlow);
  let at = toScreenA(170, 140);
  await A.page.mouse.move(...at);
  await wait(300);
  const rec1 = await startRec(B, 'carte');
  await wait(T(700));
  at = await glide(A, at, toScreenA(420, -40), T(1000), 0.2);
  await wait(T(200));
  const grab = toScreenA(cardFlow.x + 70, cardFlow.y + 38);
  at = await glide(A, at, grab, T(900), -0.2);
  await wait(T(300));
  await A.page.mouse.down();
  await wait(T(250));
  const drop = toScreenA(-250 + 70, cardFlow.y + 38 - 5);
  at = await glide(A, at, drop, T(2000), 0.12);
  await wait(T(350));
  await A.page.mouse.up();
  await wait(T(350));
  at = await glide(A, at, toScreenA(-60, -30), T(800), -0.3);
  await wait(T(900));
  const clip1 = await rec1.stop();
  inesOn = false;
  await inesLoop;
  inesSend({ k: inesMap, bye: 1 });
  await B.page.screenshot({ path: path.join(WORK, 'fin-carte.png') });

  // ════════ 2. Écrit ════════
  async function openDraft(X, id) {
    await X.page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
    await X.page.waitForFunction((id) => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in') && window.__store.getState().route.draftId === id, id, { timeout: 60000 });
    await X.page.waitForSelector('[data-testid="ed-live"]', { timeout: 20000 });
  }
  await openDraft(A, seeded.draft);
  await openDraft(B, draftB);
  await wait(1200);
  // Marc : panneau latéral (Livre / Extraits) fermé, la page seule.
  for (let i = 0; i < 2; i++) {
    const close = B.page.locator('[aria-label="Panneau latéral"] [aria-label="Fermer le panneau"]');
    if (await close.count()) await close.first().click().catch(() => {});
    await wait(300);
  }
  await sidebarDown();
  await wait(800);
  // Texte un peu plus grand (réglé chez Léa, partagé) : lisible dans la vidéo.
  await A.page.evaluate(() => window.__ed.engine().focus());
  await A.page.keyboard.press('Control+A');
  await wait(200);
  await A.page.evaluate(() => {
    const e = window.__ed.engine();
    e.setFontSize(20);
    e.setAlign('left');
  });
  await wait(600);
  await A.page.evaluate(() => {
    const e = window.__ed.engine();
    e.focus();
    e.goTo(e.docEnd());
  });
  await wait(200);
  await A.page.keyboard.press('End');
  await wait(1200);
  await B.page.mouse.move(W / ZOOM - 4, H / ZOOM - 4);
  await B.page.screenshot({ path: path.join(WORK, 'prep-ecrit.png') });
  const rec2 = await startRec(B, 'ecrit');
  await wait(T(650));
  await A.page.keyboard.press('Enter');
  await wait(T(450));
  const PHRASE = 'Promettre, c’est se lier soi-même.';
  for (const ch of PHRASE) {
    await A.page.keyboard.type(ch);
    let d = 60 + Math.random() * 80;
    if (ch === ' ') d += 25;
    if (/[,:]/.test(ch)) d += 160;
    await wait(T(d));
  }
  await wait(T(1100));
  const clip2 = await rec2.stop();
  await B.page.screenshot({ path: path.join(WORK, 'fin-ecrit.png') });

  // ════════ 3. Livre ════════
  await A.page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), seeded.epub);
  await B.page.evaluate(() => window.__store.getState().updateSettings({ showExtracts: false, fontSize: 22 }));
  await B.page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), bookB);
  for (const X of [A, B]) await X.page.waitForSelector('.html-chapter-text', { timeout: 30000 });
  await wait(1500);
  const FROM = 'Le bon sens est la chose';
  const TO = 'en désirer plus';
  const charAt = (X, needle, k) =>
    st(X.page, ({ needle, k }) => {
      for (const root of document.querySelectorAll('.html-chapter-text')) {
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = tw.nextNode())) {
          const i = n.data.indexOf(needle);
          if (i < 0) continue;
          const j = i + (k < 0 ? needle.length + k : k);
          const r = document.createRange();
          r.setStart(n, j);
          r.setEnd(n, j + 1);
          const q = r.getClientRects()[0];
          return { left: q.left, right: q.right, top: q.top, bottom: q.bottom };
        }
      }
      return null;
    }, { needle, k });
  const bring = (X, frac) =>
    st(X.page, ({ w, frac }) => {
      for (const root of document.querySelectorAll('.html-chapter-text')) {
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = tw.nextNode()))
          if (n.data.includes(w)) {
            const el = n.parentElement;
            const sc = (function f(e) {
              for (let p = e.parentElement; p; p = p.parentElement) if (p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
              return document.scrollingElement;
            })(el);
            const r = el.getBoundingClientRect();
            const sr = sc.getBoundingClientRect();
            sc.scrollTop += r.top - sr.top - sr.height * frac;
            return true;
          }
      }
      return false;
    }, { w: FROM, frac });
  await bring(A, 0.3);
  await bring(B, 0.32);
  await wait(800);
  const s0 = await charAt(A, FROM, 0);
  const s1 = await charAt(A, TO, -1);
  log('passage chez Léa', s0, s1);
  await B.page.mouse.move(W / ZOOM - 4, H / ZOOM - 4);
  await B.page.screenshot({ path: path.join(WORK, 'prep-livre.png') });
  at = [s0.left + 160, s0.bottom + 150];
  await A.page.mouse.move(...at);
  await wait(200);
  await A.page.screenshot({ path: path.join(WORK, 'lea-livre-avant.png') }).catch(() => {});
  const rec3 = await startRec(B, 'livre');
  await wait(T(400));
  const start = [s0.left + 1, (s0.top + s0.bottom) / 2];
  at = await glide(A, at, start, T(1000), 0.2);
  await wait(T(300));
  await A.page.mouse.down();
  // Glisser ligne à ligne jusqu'au bout du passage.
  const lineH = s0.bottom - s0.top;
  const t0 = Date.now();
  const DUR = T(2300);
  for (;;) {
    const u = Math.min(1, (Date.now() - t0) / DUR);
    const e = ease(u);
    const y = start[1] + (((s1.top + s1.bottom) / 2) - start[1]) * e;
    // Sur chaque ligne, la souris va vers la droite ; à la dernière, vers la fin du passage.
    const x = u < 1 ? start[0] + (s1.right - 1 - start[0]) * e + Math.sin(e * Math.PI) * 220 : s1.right - 1;
    await A.page.mouse.move(x, y);
    if (u >= 1) break;
    await wait(15);
  }
  void lineH;
  await wait(T(250));
  await A.page.screenshot({ path: path.join(WORK, 'lea-livre-glisser.png') }).catch(() => {});
  await A.page.mouse.up();
  await wait(T(400));
  at = await glide(A, [s1.right - 1, (s1.top + s1.bottom) / 2], [s1.right + 60, s1.bottom + 50], T(600), 0.25);
  await wait(T(1100));
  const clip3 = await rec3.stop();
  await B.page.screenshot({ path: path.join(WORK, 'fin-livre.png') });
  const sel = await st(A.page, () => window.getSelection().toString());
  log('sélection de Léa', JSON.stringify(sel.slice(0, 200)));
  if (!sel.startsWith('Le bon sens')) throw new Error('la sélection de Léa a échoué : relancer');
  fs.writeFileSync(path.join(WORK, 'clips.json'), JSON.stringify({ clip1, clip2, clip3, SLOW }, null, 1));
} finally {
  inesOn = false;
  for (const X of [A, B]) if (X?.errors?.length) console.log(`(${X.name}) erreurs de page :`, [...new Set(X.errors)].slice(0, 6));
  for (const h of headless) h.leave?.();
  for (const a of apps) await a.close().catch(() => {});
  xvfb.kill();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

// ── Montage : trois plans accélérés de SLOW, fondus de 0,5 s, puis retour au premier plan (boucle sans saut) ──
const OUT_W = Number(process.env.OUT_W || 1440);
const OUT_H = Math.round((OUT_W * H) / W / 2) * 2;
const XF = 0.5;
const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
// Début de chaque plan (secondes perçues) : on coupe l'attente du départ.
const plans = [
  { file: path.join(WORK, 'carte.mkv'), from: 0.35 },
  { file: path.join(WORK, 'ecrit.mkv'), from: 0.3 },
  { file: path.join(WORK, 'livre.mkv'), from: 0.25 },
];
for (const p of plans) p.dur = probe(p.file) / SLOW - p.from - 0.05;
const STILL = 0.9;
const chain = plans.map((p, i) => `[${i}:v]trim=start=${(p.from * SLOW).toFixed(3)},setpts=(PTS-STARTPTS)/${SLOW},fps=${FPS},scale=${OUT_W}:${OUT_H}:flags=lanczos,trim=duration=${p.dur.toFixed(3)},setpts=PTS-STARTPTS,format=yuv444p[p${i}]`);
chain.push(`[3:v]trim=start=${(plans[0].from * SLOW).toFixed(3)}:duration=0.05,setpts=PTS-STARTPTS,fps=${FPS},scale=${OUT_W}:${OUT_H}:flags=lanczos,trim=end_frame=1,tpad=stop_mode=clone:stop_duration=${STILL},setpts=PTS-STARTPTS,format=yuv444p[still]`);
let off = plans[0].dur - XF;
chain.push(`[p0][p1]xfade=transition=fade:duration=${XF}:offset=${off.toFixed(3)}[x1]`);
off += plans[1].dur - XF;
chain.push(`[x1][p2]xfade=transition=fade:duration=${XF}:offset=${off.toFixed(3)}[x2]`);
off += plans[2].dur - XF;
chain.push(`[x2][still]xfade=transition=fade:duration=${XF}:offset=${off.toFixed(3)},format=yuv420p[v]`);
const total = off + STILL;
const master = path.join(WORK, 'master.mkv');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...plans.flatMap((p) => ['-i', p.file]), '-i', plans[0].file, '-filter_complex', chain.join(';'), '-map', '[v]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '10', '-an', master], { stdio: 'inherit' });
log(`montage : ${probe(master).toFixed(2)} s (prévu ${total.toFixed(2)} s), ${OUT_W}×${OUT_H}`);
const CRF = process.env.CRF || '23';
const mp4 = path.join(OUT, 'ensemble.mp4');
const webm = path.join(OUT, 'ensemble.webm');
const poster = path.join(OUT, 'ensemble-poster.jpg');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', master, '-c:v', 'libx264', '-preset', 'veryslow', '-crf', CRF, '-tune', 'animation', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-an', mp4], { stdio: 'inherit' });
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', master, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', process.env.VP9_CRF || '34', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '1', '-pix_fmt', 'yuv420p', '-an', webm], { stdio: 'inherit' });
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', master, '-frames:v', '1', '-q:v', '3', poster], { stdio: 'inherit' });
for (const f of [mp4, webm, poster]) log(`${path.relative(ROOT, f)} : ${(fs.statSync(f).size / 1e6).toFixed(2)} Mo`);
