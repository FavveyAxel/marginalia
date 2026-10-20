// « Travailler à plusieurs » : la sélection de texte des autres, en direct (livres et écrits). Deux processus
// Electron (dossiers de données distincts, réseau local simulé par MARGINALIA_E2E_LAN=127.0.0.1) — l'hôte Léa
// (A), l'invité Marc (B, par un relais d'écoute) — et une invitée « sans interface » Inès
// (electron/collab-net.cjs en Node) qui envoie ses sélections comme le ferait l'app (autre page, autre livre).
//  1. EPUB (fenêtre et taille de texte différentes) : Léa glisse la souris sur un passage → chez Marc, les mêmes
//     mots sont teintés de sa couleur (texte relu sous la teinte = texte sélectionné chez Léa), étiquette
//     « Léa » au bout ; la teinte s'étend pendant le glisser (cadence ≤ 30/s, rien à l'arrêt) ; elle disparaît
//     quand Léa désélectionne, et quand elle crée l'extrait ; Inès dans un autre livre : rien.
//  2. PDF (pages de tailles différentes) : même zone de la page ; Inès sur la page 2 : rien tant que Marc est
//     en page 1, visible quand il y va ; Léa fait défiler loin de sa sélection : elle disparaît chez Marc.
//  3. Écrit (SuperDoc + Yjs) : la sélection de Marc est teintée chez Léa, à son prénom, trait de saisie gardé.
//  4. Rien en clair dans le trafic capturé (ni texte sélectionné, ni prénoms).
// Captures claires et sombres dans shots/selections/. Prérequis : npx vite build ; Xvfb (:99).
// Lancer : DISPLAY=:99 LANG=C.UTF-8 timeout 600 node scripts/test-selections.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { createRequire } from 'node:module';

process.env.MARGINALIA_E2E = '1';
process.env.MARGINALIA_E2E_LAN = '127.0.0.1';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const collabNet = require(path.join(ROOT, 'electron/collab-net.cjs'));
const SHOTS = path.join(ROOT, 'shots/selections');
fs.mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) {
    process.exitCode = 1;
    fails++;
  }
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `mg-sel-${name}-`));
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
const theme = (p, t) => p.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), t).then(() => p.waitForTimeout(350));
const st = (p, fn, arg) => p.evaluate(fn, arg);
const until = async (p, fn, arg, ms = 20000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** Sans aucun blanc (le PDF n'a pas d'espace entre deux lignes de son calque de texte). */
const bare = (s) => String(s ?? '').replace(/\s+/g, '');

// ── Relais d'écoute (TCP) sur le chemin de Marc ──
const wire = [];
let hostPort = 47804;
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
const pack = (head) => {
  const h = Buffer.from(JSON.stringify(head));
  const out = Buffer.alloc(4 + h.length);
  out.writeUInt32BE(h.length, 0);
  h.copy(out, 4);
  return out;
};

/** Sélection d'une personne chez X : état, rectangles (écran), couleur, étiquette, texte relu sous la teinte. */
const selOf = (X, name) =>
  st(
    X.page,
    (name) => {
      const g = [...document.querySelectorAll('[data-testid="remote-selection"]')].find((e) => e.dataset.name === name);
      if (!g) return null;
      const rects = [...g.querySelectorAll('.rs-rect')].map((d) => {
        const r = d.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });
      const tag = g.querySelector('.rs-name');
      const end = g.querySelector('.rs-end').getBoundingClientRect();
      // Texte réellement sous la teinte : du bord gauche de la première ligne au bord droit de la dernière.
      let under = '';
      if (rects.length && g.dataset.state === 'on') {
        const f = rects[0];
        const l = rects.reduce((a, b) => (b.top > a.top + 1 || (Math.abs(b.top - a.top) <= 1 && b.right > a.right) ? b : a));
        const a = document.caretRangeFromPoint(f.left + 1, (f.top + f.bottom) / 2);
        const b = document.caretRangeFromPoint(l.right - 1, (l.top + l.bottom) / 2);
        if (a && b) {
          const r = document.createRange();
          r.setStart(a.startContainer, a.startOffset);
          r.setEnd(b.startContainer, b.startOffset);
          under = r.toString();
        }
      }
      return {
        state: g.dataset.state,
        opacity: getComputedStyle(g).opacity,
        rc: getComputedStyle(g).getPropertyValue('--rc').trim(),
        rectBg: rects.length ? getComputedStyle(g.querySelector('.rs-rect')).backgroundColor : null,
        pe: getComputedStyle(g.closest('.rs-layer')).pointerEvents,
        rects,
        label: tag?.textContent,
        labelBg: tag ? getComputedStyle(tag).backgroundColor : null,
        labelVisible: tag ? tag.getBoundingClientRect().width > 0 && g.dataset.tag !== '0' : false,
        end: { x: end.left + end.width / 2, top: end.top, bottom: end.bottom },
        under,
      };
    },
    name,
  );
/**
 * Fluidité d'un pointeur qui suit l'ordre du texte (positions à chaque image) : il ne remonte jamais (ups), ne
 * revient pas en arrière sur une même ligne (backs : un retour vers la gauche n'est permis que s'il accompagne un
 * passage à la ligne suivante, éventuellement adouci sur quelques images), ne saute pas de lignes (skips).
 */
function smoothness(track, line) {
  let ups = 0, backs = 0, skips = 0, jumps = 0;
  let run = null; // retour vers la gauche en cours : descente cumulée
  for (let i = 1; i < track.length; i++) {
    const dx = track[i].x - track[i - 1].x;
    const dy = track[i].y - track[i - 1].y;
    if (dy < -2) ups++;
    if (dy > line * 2.2) skips++;
    // Grand pas en avant sur une ligne (compté, pas exigé nul : quand la mise en page diffère, passer d'une fin de
    // ligne à la suivante chez l'un avance réellement de dizaines de caractères chez l'autre).
    if (dx > 50 && Math.abs(dy) < line * 0.5) jumps++;
    if (dx < -2) run = { dy: (run?.dy ?? 0) + dy, n: (run?.n ?? 0) + 1 };
    else if (run) {
      if (run.dy < line * 0.6) backs += run.n;
      run = null;
    }
  }
  if (run && run.dy < line * 0.6) backs += run.n;
  return { ups, backs, skips, jumps };
}
const union = (rs) => rs.reduce((u, r) => ({ left: Math.min(u.left, r.left), top: Math.min(u.top, r.top), right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });

const A = await launch('lea', { width: 1280, height: 840 });
const B = await launch('marc', { width: 1040, height: 760 });
const headless = [];
try {
  // ── Préparation de Léa : espace « Parjure » (EPUB, PDF, un écrit) ──
  const epubB64 = fs.readFileSync(path.join(ROOT, 'fixtures/discours.epub')).toString('base64');
  const pdfB64 = fs.readFileSync(path.join(ROOT, 'fixtures/discours.pdf')).toString('base64');
  const pngB64 = fs.readFileSync(path.join(ROOT, 'fixtures/cover.png')).toString('base64');
  const mdText = '# Le parjure\n\nPremier paragraphe : peut-on promettre sans mentir ?\n\nDeuxième paragraphe : la parole donnée engage.\n';
  const seeded = await A.page.evaluate(
    async ({ epubB64, pdfB64, pngB64, mdText }) => {
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
      await s().importFiles([{ name: 'Dissertation.md', data: new TextEncoder().encode(mdText).buffer }]);
      const draft = s().drafts[0]?.id;
      if (draft && !s().wsItems.some((i) => i.kind === 'draft')) s().addToWorkspace(ws, null, 'draft', draft);
      return { ws, epub: epub.id, pdf: pdf.id, photo: photo.id, draft, items: s().wsItems.filter((i) => i.workspaceId === ws).map((i) => i.kind).sort().join() };
    },
    { epubB64, pdfB64, pngB64, mdText },
  );
  ok(!!seeded.epub && !!seeded.pdf && !!seeded.draft && seeded.items === 'book,book,book,draft', 'Léa : espace « Parjure » (EPUB, PDF, photo, écrit)', seeded);

  // ── Session ──
  await A.page.click('button[aria-label="Actions"]');
  await A.page.locator('.ws-menu .menu-item', { hasText: 'Partager' }).click();
  await A.page.getByText('Travailler ensemble…').click();
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
  await B.page.click('.br-trouble summary');
  await B.page.click('text=Saisir une adresse');
  await B.page.fill('[data-testid="join-address"]', `127.0.0.1:${proxyPort}`);
  await B.page.click('[data-testid="join-go"]');
  await A.page.waitForSelector('[data-testid="collab-request"]', { timeout: 30000 });
  await A.page.click('[data-testid="collab-accept"]');
  ok(await until(B.page, () => window.__collab.state.getState().phase === 'live' && window.__collab.state.getState().workspaceId, null, 60000), 'Marc a rejoint « Parjure »');
  await A.page.keyboard.press('Escape');
  const ines = collabNet.createCollabGuest({ emit: () => {}, deviceName: () => 'Poste-d-Ines' });
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
  const LEA = colorOf('Léa');
  ok(LEA === '#c2410c', 'couleur de Léa : #c2410c', LEA);

  // ════════ 1. EPUB (fenêtre et taille de texte différentes) ════════
  await B.page.evaluate(() => window.__store.getState().updateSettings({ fontSize: (window.__store.getState().settings.fontSize || 18) + 6 }));
  const bookB = (g, fmt) =>
    st(B.page, ({ g, fmt }) => {
      const s = window.__store.getState();
      return s.books.find((b) => b.id === g || b.shareOrigin?.srcId === g)?.id ?? s.books.find((b) => b.format === fmt)?.id;
    }, { g, fmt });
  const epubB = await bookB(seeded.epub, 'epub');
  const pdfB = await bookB(seeded.pdf, 'pdf');
  await A.page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), seeded.epub);
  await B.page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), epubB);
  for (const X of [A, B]) await X.page.waitForSelector('.html-chapter-text', { timeout: 30000 });
  await wait(1500);
  const FROM = 'Le bon sens est la chose';
  const TO = 'les plus difficiles';
  /** Rectangle d'un caractère (index dans la chaîne trouvée) du premier nœud texte contenant `needle`. */
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
          return { left: q.left, right: q.right, top: q.top, bottom: q.bottom, h: q.height, ch: root.dataset.chapter };
        }
      }
      return null;
    }, { needle, k });
  const bring = (X) =>
    st(X.page, (w) => {
      for (const root of document.querySelectorAll('.html-chapter-text')) {
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = tw.nextNode())) if (n.data.includes(w)) return n.parentElement.scrollIntoView({ block: 'center' });
      }
    }, FROM);
  await bring(A);
  await bring(B);
  await wait(700);
  const [cA, cB] = [await charAt(A, FROM, 0), await charAt(B, FROM, 0)];
  ok(cA && cB && Math.abs(cA.h - cB.h) > 2, 'EPUB : texte de tailles différentes chez Léa et Marc (fenêtres 1280 et 1040 px)', { lea: cA?.h, marc: cB?.h });
  const s0 = await charAt(A, FROM, 0);
  const s1 = await charAt(A, TO, -1);
  const sMid = await charAt(A, 'chose du monde', -1);
  // Léa appuie avant « Le » et glisse jusqu'au milieu, puis jusqu'à « difficiles ».
  await A.page.mouse.move(s0.left + 1, (s0.top + s0.bottom) / 2);
  await A.page.mouse.down();
  const n0 = await st(A.page, () => window.__cursors.sentStats.n);
  const t0 = Date.now();
  await A.page.mouse.move(sMid.right - 1, (sMid.top + sMid.bottom) / 2, { steps: 12 });
  await wait(350);
  const part = await selOf(B, 'Léa');
  const partA = await st(A.page, () => window.getSelection().toString());
  ok(part && part.state === 'on' && norm(part.under) === norm(partA) && norm(partA).startsWith('Le bon sens est la chose du monde'), 'EPUB : pendant le glisser, la teinte de Léa couvre déjà chez Marc les mots sélectionnés', { marc: norm(part?.under), lea: norm(partA) });
  // Suite du glisser (≈ 60 mouvements par seconde).
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const y = sMid.top + (s1.top - sMid.top) * u + (s1.bottom - s1.top) / 2;
    const x = u < 1 ? sMid.right + (s1.right - sMid.right) * u : s1.right - 1;
    await A.page.mouse.move(x, y);
    await wait(16);
  }
  const dt = (Date.now() - t0) / 1000;
  await wait(250);
  const n1 = await st(A.page, () => window.__cursors.sentStats.n);
  const rate = (n1 - n0) / dt;
  ok(rate > 5 && rate <= 30, `cadence d’envoi pendant le glisser : ${rate.toFixed(1)} messages/s (≤ 30, pointeur et sélection ensemble)`, { messages: n1 - n0, secondes: dt.toFixed(2) });
  await A.page.mouse.up();
  await wait(500);
  const full = await selOf(B, 'Léa');
  const fullA = await st(A.page, () => window.getSelection().toString());
  ok(norm(fullA).startsWith(FROM) && norm(fullA).endsWith(TO), 'EPUB : Léa a sélectionné « Le bon sens … les plus difficiles »', norm(fullA));
  ok(full && full.state === 'on' && norm(full.under) === norm(fullA), 'EPUB : chez Marc (autre largeur, autre taille de texte), les mêmes mots sont teintés (texte relu sous la teinte = sélection de Léa)', { marc: norm(full?.under) });
  ok(full && full.rects.length >= 2 && full.rects.length > (part?.rects.length ?? 0) - 1 && norm(full.under).length > norm(part?.under).length, 'EPUB : la sélection s’est étendue pendant le glisser (plus de texte, plusieurs lignes)', { avant: part?.rects.length, apres: full?.rects.length });
  ok(full && full.rc === LEA && full.labelBg === rgb(LEA) && /rgba?\(|color\(/.test(full.rectBg ?? ''), 'EPUB : teinte et étiquette dans la couleur de Léa', { rc: full?.rc, label: full?.labelBg, teinte: full?.rectBg });
  // Un seul prénom, qui ne saute pas : tant que le pointeur de Léa est là, c'est lui qui le porte.
  const ptrName = await st(B.page, () => { const e = [...document.querySelectorAll('[data-testid="remote-cursor"]')].find((x) => x.dataset.name === 'Léa'); const n = e?.querySelector('.rc-name'); return e && n ? { state: e.dataset.state, visible: getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 0 } : null; });
  ok(ptrName && ptrName.state === 'on' && ptrName.visible && full && !full.labelVisible, 'EPUB : pointeur de Léa à l’écran : un seul prénom, sur le pointeur (pas encore au bout de la sélection)', { pointeur: ptrName, selection: full?.labelVisible });
  const lastB = await charAt(B, TO, -1);
  ok(full && lastB && Math.abs(full.end.x - lastB.right) < 3 && full.end.top <= lastB.bottom && full.end.bottom >= lastB.top, 'EPUB : étiquette au bout de la sélection (après « difficiles » chez Marc)', { bout: full?.end, mot: lastB });
  ok(full && full.pe === 'none', 'EPUB : couche sans interaction (pointer-events: none)', full?.pe);
  // Léa sort la souris du livre : son pointeur part, la sélection reprend son prénom au bout du passage.
  await A.page.mouse.move(3, 400, { steps: 4 });
  const tagged = await until(B.page, () => { const g = [...document.querySelectorAll('[data-testid="remote-selection"]')].find((e) => e.dataset.name === 'Léa'); return g && g.dataset.state === 'on' && g.dataset.tag === '1'; }, null, 3000);
  const afterOut = await selOf(B, 'Léa');
  const ptrOut = await st(B.page, () => [...document.querySelectorAll('[data-testid="remote-cursor"]')].find((e) => e.dataset.name === 'Léa')?.dataset.state ?? 'absent');
  ok(tagged && afterOut?.label === 'Léa' && afterOut.labelVisible && ptrOut !== 'on', 'EPUB : pointeur de Léa parti : étiquette « Léa » au bout de sa sélection', { etiquette: afterOut?.label, visible: afterOut?.labelVisible, pointeur: ptrOut });
  // Sélection locale de Marc possible malgré la couche : il sélectionne un autre mot.
  const mw = await charAt(B, 'diversité', 0);
  if (mw) {
    await B.page.mouse.dblclick(mw.left + 3, (mw.top + mw.bottom) / 2);
    await wait(250);
    const own = await st(B.page, () => window.getSelection().toString());
    ok(/diversit/.test(own), 'EPUB : Marc sélectionne lui-même un mot à travers la couche', own);
    await B.page.mouse.click(mw.left - 30, mw.bottom + 200).catch(() => {});
    await st(B.page, () => window.getSelection().removeAllRanges());
    await wait(200);
  }
  // Captures (Léa garde sa sélection) : chez Marc, claire et sombre.
  await B.page.mouse.move(5, 300);
  for (const [t, label] of [['light', 'clair'], ['dark', 'sombre']]) {
    await theme(B.page, t);
    await B.page.screenshot({ path: path.join(SHOTS, `epub-${label}.png`) });
  }
  await theme(B.page, 'light');
  // Inès dans un autre livre (le PDF) : rien ici.
  const pdfCtx = `b:${seeded.pdf}`;
  const epubCtx = `b:${seeded.epub}`;
  inesSend({ k: pdfCtx, s: { u: 'p1', a: 0, b: 40 } });
  await wait(400);
  const inesE = await selOf(B, 'Inès');
  ok(!inesE, 'EPUB : Inès sélectionne dans un autre livre : rien ici', inesE);
  // Inès dans un chapitre que Marc n'a pas à l'écran : rien d'affiché.
  const chapters = await st(B.page, () => [...document.querySelectorAll('.html-chapter-text')].map((e) => e.dataset.chapter));
  const farCh = chapters[chapters.length - 1];
  inesSend({ k: epubCtx, s: { u: `c${farCh}`, a: 5, b: 120 } });
  await wait(400);
  const inesFar = await selOf(B, 'Inès');
  ok(!inesFar || inesFar.state === 'off', `EPUB : Inès sélectionne au chapitre ${Number(farCh) + 1} (hors de la vue de Marc) : rien d’affiché`, inesFar && { state: inesFar.state, rects: inesFar.rects.length });
  inesSend({ k: epubCtx, bye: 1 });
  // Léa désélectionne (clic dans le texte) : la teinte disparaît chez Marc.
  await A.page.mouse.click(s0.left + 40, s0.bottom + 120);
  const gone = await until(B.page, () => ![...document.querySelectorAll('[data-testid="remote-selection"]')].some((e) => e.dataset.name === 'Léa' && e.dataset.state === 'on'), null, 3000);
  ok(gone, 'EPUB : Léa désélectionne : sa sélection disparaît chez Marc');
  // Léa sélectionne puis crée l'extrait : la teinte disparaît chez Marc.
  const hl0 = await st(A.page, () => window.__store.getState().highlights.length);
  await A.page.mouse.move(s0.left + 1, (s0.top + s0.bottom) / 2);
  await A.page.mouse.down();
  await A.page.mouse.move(sMid.right - 1, (sMid.top + sMid.bottom) / 2, { steps: 8 });
  await A.page.mouse.up();
  ok(await until(B.page, () => [...document.querySelectorAll('[data-testid="remote-selection"]')].some((e) => e.dataset.name === 'Léa' && e.dataset.state === 'on'), null, 3000), 'EPUB : nouvelle sélection de Léa visible chez Marc');
  await A.page.waitForSelector('.sel-toolbar', { timeout: 4000 });
  await A.page.click('.sel-toolbar button[title^="Surligner (H)"]');
  await wait(300);
  const hl1 = await st(A.page, () => window.__store.getState().highlights.length);
  const gone2 = await until(B.page, () => ![...document.querySelectorAll('[data-testid="remote-selection"]')].some((e) => e.dataset.name === 'Léa' && e.dataset.state === 'on'), null, 3000);
  ok(hl1 === hl0 + 1 && gone2, 'EPUB : Léa crée l’extrait : sa sélection disparaît chez Marc', { extraits: hl1 - hl0 });

  // ── Fluidité : Léa approche en courbe puis glisse en diagonale sur un paragraphe, au-delà des fins de ligne
  // (geste réel : y et x croissent, donc l'ordre du texte aussi). Chez Marc (autre mise en page), le pointeur
  // de Léa suit l'ordre du texte image par image : il ne remonte jamais d'une ligne, ne revient pas en arrière
  // sur une même ligne, ne saute pas de ligne ; un seul prénom (pointeur, puis bout de sélection), sans
  // clignoter ; et l'étiquette de la sélection reste près du pointeur (rejouées au même rythme).
  await st(A.page, () => window.getSelection().removeAllRanges());
  await wait(400);
  const P0 = 'Et ainsi la diversité';
  const P1 = 'appliquer bien';
  const bringTo = (X, w) =>
    st(X.page, (w) => {
      for (const root of document.querySelectorAll('.html-chapter-text')) {
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = tw.nextNode())) if (n.data.includes(w)) return n.parentElement.scrollIntoView({ block: 'center' });
      }
    }, w);
  await bringTo(A, P0);
  await bringTo(B, P0);
  await wait(700);
  const f0 = await charAt(A, P0, 0);
  const f1 = await charAt(A, P1, -1);
  const fB = await charAt(B, P0, 0);
  const colA = await st(A.page, () => { const r = document.querySelector('.html-chapter-text').getBoundingClientRect(); return { left: r.left, right: r.right }; });
  const lineB = fB.bottom - fB.top;
  await st(B.page, () => {
    window.__flow = [];
    window.__flowOn = true;
    const loop = () => {
      const el = [...document.querySelectorAll('[data-testid="remote-cursor"]')].find((e) => e.dataset.name === 'Léa');
      const g = [...document.querySelectorAll('[data-testid="remote-selection"]')].find((e) => e.dataset.name === 'Léa');
      if (el && el.dataset.state === 'on') {
        const r = el.querySelector('svg').getBoundingClientRect();
        const tag = g && g.dataset.state === 'on' ? g.querySelector('.rs-end').getBoundingClientRect() : null;
        window.__flow.push({ t: Date.now(), x: r.left, y: r.top, name: getComputedStyle(el.querySelector('.rc-name')).display !== 'none', tagName: !!(g && g.dataset.state === 'on' && g.dataset.tag !== '0'), tag: tag && { x: tag.left, y: tag.top, h: tag.height } });
      }
      if (window.__flowOn) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const sweep = async (pts, ms, fn = ease) => {
    const t0 = Date.now();
    for (;;) {
      const u = Math.min(1, (Date.now() - t0) / ms);
      const e = fn(u);
      // Bézier quadratique (approche en courbe) ou segment.
      const [a, b, c] = pts;
      const q = c ? [(1 - e) * (1 - e) * a[0] + 2 * (1 - e) * e * b[0] + e * e * c[0], (1 - e) * (1 - e) * a[1] + 2 * (1 - e) * e * b[1] + e * e * c[1]] : [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
      await A.page.mouse.move(q[0], q[1]);
      if (u >= 1) break;
      await wait(16);
    }
  };
  const p0 = [f0.left + 1, (f0.top + f0.bottom) / 2];
  await A.page.mouse.move(p0[0] + 120, p0[1] + 90);
  await wait(300);
  await sweep([[p0[0] + 120, p0[1] + 90], [p0[0] - 40, p0[1] + 70], p0], 700);
  await A.page.mouse.down();
  const tDown = Date.now();
  // Le long de la première ligne jusqu'au bord droit de la colonne (au-delà de la fin de ligne), puis vers le bas.
  await sweep([p0, [colA.right - 6, p0[1]], [colA.right - 6, (f1.top + f1.bottom) / 2]], 2600, (u) => u);
  await A.page.mouse.up();
  await wait(500);
  await st(B.page, () => (window.__flowOn = false));
  // Images du glisser seulement (rejoué chez Marc avec ≈ 110 ms de retard ; l'approche, elle, remonte).
  const flow = (await st(B.page, () => window.__flow)).filter((f) => f.t > tDown + 200);
  const selA2 = norm(await st(A.page, () => window.getSelection().toString()));
  fs.writeFileSync(path.join(SHOTS, 'fluidite-glisser.json'), JSON.stringify({ flow, ligne: lineB }));
  const { ups, backs, skips, jumps } = smoothness(flow, lineB);
  // Prénom : toujours sur le pointeur pendant le glisser, jamais aussi au bout de la sélection (un seul, stable).
  const twoOrNone = flow.filter((f) => f.name === f.tagName).length;
  const onTag = flow.filter((f) => f.tagName).length;
  // Sélection rejouée au rythme du pointeur : son bout reste près de lui (même ligne, ou celle d'avant quand le
  // pointeur vient de passer à la suivante), au lieu de courir devant.
  let far = 0;
  for (const f of flow) if (f.tag && Math.abs(f.tag.y - f.y) > lineB * 2.5) far++;
  ok(selA2.startsWith(P0) && flow.length > 60, 'EPUB : Léa glisse en diagonale sur « Et ainsi la diversité… » (geste réel, courbe puis glisser)', { images: flow.length, selection: selA2.slice(0, 60) });
  ok(ups === 0 && backs === 0 && skips === 0, 'EPUB : chez Marc, le pointeur de Léa suit le texte image par image pendant le glisser (ne remonte pas, ne revient pas en arrière, ne saute pas de ligne)', { remontees: ups, retours: backs, bonds: jumps, sauts: skips, ligne: lineB.toFixed(1) });
  ok(twoOrNone === 0 && onTag === 0 && far === 0, 'EPUB : pendant le glisser, un seul prénom, sur le pointeur, à chaque image ; le bout de la sélection suit le pointeur', { imagesSansOuAvecDeuxPrenoms: twoOrNone, prenomAuBout: onTag, boutLoin: far });
  await st(A.page, () => window.getSelection().removeAllRanges());
  await A.page.mouse.move(5, 300);
  await wait(300);

  // ════════ 2. PDF (pages de tailles différentes) ════════
  await A.page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), seeded.pdf);
  await B.page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), pdfB);
  for (const X of [A, B]) await X.page.waitForFunction(() => (document.querySelector('.pdf-page[data-page="1"] .textLayer')?.textContent ?? '').length > 100, null, { timeout: 30000 });
  await wait(1500);
  ok(!(await selOf(B, 'Léa')), 'PDF : Léa a changé de livre : plus rien de l’EPUB');
  const pageRect = (X, n) => st(X.page, (n) => { const r = document.querySelector(`.pdf-page[data-page="${n}"]`).getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; }, n);
  const [pA, pB] = [await pageRect(A, 1), await pageRect(B, 1)];
  ok(Math.abs(pA.w - pB.w) > 20, 'PDF : pages de tailles différentes chez Léa et Marc', { lea: Math.round(pA.w), marc: Math.round(pB.w) });
  // Léa glisse de « bon sens » (1re ligne) jusqu'à « contenter » (2e ligne).
  const spanChar = (X, needle, k) =>
    st(X.page, ({ needle, k }) => {
      const layer = document.querySelector('.pdf-page[data-page="1"] .textLayer');
      const tw = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
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
      return null;
    }, { needle, k });
  const q0 = await spanChar(A, 'bon sens est', 0);
  const q1 = await spanChar(A, 'contenter', -1);
  ok(!!q0 && !!q1, 'PDF : passage repéré dans le calque de texte de Léa', { q0, q1 });
  await A.page.mouse.move(q0.left + 0.5, (q0.top + q0.bottom) / 2);
  await A.page.mouse.down();
  await A.page.mouse.move((q0.left + q1.right) / 2, (q0.top + q1.bottom) / 2, { steps: 8 });
  await A.page.mouse.move(q1.right - 0.5, (q1.top + q1.bottom) / 2, { steps: 8 });
  await A.page.mouse.up();
  await wait(500);
  const selA = await st(A.page, () => {
    const s = window.getSelection();
    const r = s.getRangeAt(0);
    const pg = document.querySelector('.pdf-page[data-page="1"]').getBoundingClientRect();
    const rs = [];
    const tw = document.createTreeWalker(document.querySelector('.pdf-page[data-page="1"] .textLayer'), NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      if (!r.intersectsNode(n)) continue;
      const sub = document.createRange();
      sub.setStart(n, n === r.startContainer ? r.startOffset : 0);
      sub.setEnd(n, n === r.endContainer ? r.endOffset : n.data.length);
      for (const q of sub.getClientRects()) if (q.width > 0.5) rs.push({ left: (q.left - pg.left) / pg.width, right: (q.right - pg.left) / pg.width, top: (q.top - pg.top) / pg.height, bottom: (q.bottom - pg.top) / pg.height });
    }
    return { text: s.toString(), rs };
  });
  const sP = await selOf(B, 'Léa');
  ok(norm(selA.text).startsWith('bon sens') && /contenter$/.test(norm(selA.text)), 'PDF : Léa a sélectionné « bon sens … contenter »', norm(selA.text));
  const uA = union(selA.rs);
  const uB = sP ? union(sP.rects.map((r) => ({ left: (r.left - pB.left) / pB.w, right: (r.right - pB.left) / pB.w, top: (r.top - pB.top) / pB.h, bottom: (r.bottom - pB.top) / pB.h }))) : null;
  const dz = uB ? Math.max(...['left', 'right', 'top', 'bottom'].map((k) => Math.abs(uA[k] - uB[k]))) : 1;
  ok(sP && sP.state === 'on' && dz < 0.006, `PDF : chez Marc, même zone de la page 1 (écart max ${(dz * 100).toFixed(2)} % de la page)`, { lea: uA, marc: uB });
  ok(sP && bare(sP.under) === bare(selA.text), 'PDF : texte relu sous la teinte chez Marc = sélection de Léa (aux blancs de fin de ligne près)', norm(sP?.under));
  ok(sP && sP.rc === LEA && sP.label === 'Léa' && sP.labelBg === rgb(LEA), 'PDF : couleur et étiquette de Léa', { rc: sP?.rc, label: sP?.label });
  // Inès : sélection en page 2 (Marc est en page 1) : rien d'affiché ici.
  // Fin de la page 2 (le haut de la page 2 peut dépasser sous la page 1 dans la fenêtre de Marc).
  const len2 = await st(B.page, () => (document.querySelector('.pdf-page[data-page="2"] .textLayer')?.textContent ?? '').length);
  const I2 = { a: Math.max(0, len2 - 70), b: Math.max(10, len2 - 10) };
  inesSend({ k: pdfCtx, w: { u: 'p2', label: 'page 2' }, s: { u: 'p2', ...I2 } });
  await wait(500);
  const i1 = await selOf(B, 'Inès');
  const p2vis = await st(B.page, () => {
    const r = document.querySelector('.pdf-page[data-page="2"]')?.getBoundingClientRect();
    const sc = document.querySelector('.pdf-scroll').getBoundingClientRect();
    return !!r && r.top + r.height * 0.6 < sc.bottom;
  });
  ok(!p2vis && (!i1 || i1.state === 'off'), 'PDF : Inès sélectionne en bas de la page 2 (hors de la vue de Marc) : rien', i1 && { state: i1.state, rects: i1.rects.length });
  await B.page.mouse.move(5, 300);
  for (const [t, label] of [['light', 'clair'], ['dark', 'sombre']]) {
    await theme(B.page, t);
    await B.page.screenshot({ path: path.join(SHOTS, `pdf-${label}.png`) });
  }
  await theme(B.page, 'light');
  // Marc va en page 2 : la sélection d'Inès y apparaît.
  await B.page.evaluate(() => document.querySelector('.pdf-page[data-page="2"]').scrollIntoView({ block: 'end' }));
  await B.page.waitForFunction(() => (document.querySelector('.pdf-page[data-page="2"] .textLayer')?.textContent ?? '').length > 60, null, { timeout: 15000 }).catch(() => {});
  await wait(600);
  const i2 = await selOf(B, 'Inès');
  const t2 = await st(B.page, (I2) => (document.querySelector('.pdf-page[data-page="2"] .textLayer')?.textContent ?? '').slice(I2.a, I2.b), I2);
  ok(i2 && i2.state === 'on' && i2.rects.length > 0 && bare(i2.under) === bare(t2) && i2.rc === colorOf('Inès'), 'PDF : Marc descend en bas de la page 2 : la sélection d’Inès y apparaît (mêmes caractères, sa couleur)', { vu: norm(i2?.under), attendu: norm(t2) });
  inesSend({ k: pdfCtx, s: null });
  await wait(300);
  ok(!(await selOf(B, 'Inès')), 'PDF : Inès désélectionne : plus rien');
  // Marc remonte en page 1 ; Léa fait défiler loin de sa sélection : elle disparaît chez Marc.
  await B.page.evaluate(() => document.querySelector('.pdf-page[data-page="1"]').scrollIntoView({ block: 'start' }));
  await wait(400);
  ok((await selOf(B, 'Léa'))?.state === 'on', 'PDF : de retour en page 1, Marc revoit la sélection de Léa');
  await A.page.evaluate(() => document.querySelector('.pdf-page[data-page="2"]').scrollIntoView({ block: 'end' }));
  const gone3 = await until(B.page, () => ![...document.querySelectorAll('[data-testid="remote-selection"]')].some((e) => e.dataset.name === 'Léa' && e.dataset.state === 'on'), null, 3000);
  ok(gone3, 'PDF : Léa change de page (sa sélection sort de sa vue) : elle disparaît chez Marc');
  await A.page.evaluate(() => document.querySelector('.pdf-page[data-page="1"]').scrollIntoView({ block: 'start' }));
  ok(await until(B.page, () => [...document.querySelectorAll('[data-testid="remote-selection"]')].some((e) => e.dataset.name === 'Léa' && e.dataset.state === 'on'), null, 3000), 'PDF : Léa revient sur sa page : sa sélection réapparaît');
  // Léa quitte le livre : plus rien.
  await A.page.evaluate((ws) => window.__store.getState().navigate({ name: 'workspace', workspaceId: ws, groupId: null }), seeded.ws);
  ok(await until(B.page, () => ![...document.querySelectorAll('[data-testid="remote-selection"]')].some((e) => e.dataset.name === 'Léa'), null, 3000), 'PDF : Léa quitte le livre : sa sélection disparaît chez Marc');

  // ════════ 2 bis. Photo (texte reconnu) : rectangles en fractions de l'image ════════
  const photoB = await bookB(seeded.photo, 'image');
  await B.page.evaluate((id) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: null }), photoB);
  await B.page.waitForSelector('.img-page[data-page="1"] img', { timeout: 30000 });
  await wait(1200);
  const photoCtx = `b:${seeded.photo}`;
  const IR = [0.2, 0.3, 0.5, 0.04, 0.2, 0.36, 0.3, 0.04];
  inesSend({ k: photoCtx, s: { u: 'p1', r: IR } });
  await wait(500);
  const iP = await selOf(B, 'Inès');
  const imB = await st(B.page, () => { const r = document.querySelector('.img-page[data-page="1"]').getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; });
  const dP = iP && iP.rects.length === 2 ? Math.max(...iP.rects.map((r, i) => Math.max(Math.abs(r.left - (imB.left + IR[i * 4] * imB.w)), Math.abs(r.top - (imB.top + IR[i * 4 + 1] * imB.h)), Math.abs(r.right - r.left - IR[i * 4 + 2] * imB.w)))) : 999;
  ok(iP && iP.state === 'on' && dP < 1.5 && iP.label === 'Inès', `photo : sélection d’Inès (texte reconnu chez elle) au même endroit de l’image chez Marc (écart ${dP.toFixed(2)} px)`, { vu: iP?.rects });
  inesSend({ k: photoCtx, bye: 1 });
  await wait(300);
  ok(!(await selOf(B, 'Inès')), 'photo : Inès quitte l’image : plus rien');

  // ════════ 3. Écrit (SuperDoc + Yjs) ════════
  const draftOf = (X) => st(X.page, () => window.__store.getState().drafts.find((d) => d.title === 'Le parjure' || /Dissertation/.test(d.title))?.id ?? window.__store.getState().drafts[0]?.id);
  async function openDraft(X) {
    const id = await draftOf(X);
    await X.page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
    await X.page.waitForFunction((id) => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in') && window.__store.getState().route.draftId === id, id, { timeout: 60000 });
    await X.page.waitForSelector('[data-testid="ed-live"]', { timeout: 20000 });
    await wait(800);
  }
  await openDraft(A);
  await openDraft(B);
  // Marc place son curseur dans le premier paragraphe et sélectionne la ligne au clavier.
  await B.page.evaluate(() => {
    const e = window.__ed.engine();
    e.focus();
    const t = e.plainText();
    const i = t.indexOf('Premier');
    e.goTo(Math.max(1, i + 3));
  });
  await wait(200);
  await B.page.keyboard.press('Home');
  await B.page.keyboard.press('Shift+End');
  await wait(300);
  const selMarc = await st(B.page, () => window.__ed.engine().selectionRange());
  ok(selMarc && /Premier paragraphe/.test(selMarc.quote), 'écrit : Marc sélectionne « Premier paragraphe … »', selMarc);
  const edSel = async () =>
    st(A.page, () => {
      const els = [...document.querySelectorAll('.presentation-editor__remote-selection')].filter((e) => e.getBoundingClientRect().width > 1);
      const labels = [...document.querySelectorAll('.presentation-editor__remote-label')].map((e) => ({ t: e.textContent.trim(), bg: getComputedStyle(e).backgroundColor }));
      const carets = [...document.querySelectorAll('.presentation-editor__remote-caret')].map((e) => ({ bg: getComputedStyle(e).borderLeftColor, h: e.getBoundingClientRect().height, op: getComputedStyle(e).opacity }));
      const rects = els.map((e) => {
        const r = e.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, bg: getComputedStyle(e).backgroundColor, op: Number(getComputedStyle(e).opacity) };
      });
      let under = '';
      if (rects.length) {
        const f = rects[0];
        const l = rects[rects.length - 1];
        const a = document.caretRangeFromPoint(f.left + 1, (f.top + f.bottom) / 2);
        const b = document.caretRangeFromPoint(l.right - 1, (l.top + l.bottom) / 2);
        if (a && b) {
          const r = document.createRange();
          r.setStart(a.startContainer, a.startOffset);
          r.setEnd(b.startContainer, b.startOffset);
          under = r.toString();
        }
      }
      return { rects, labels, carets, under };
    });
  const seenSel = await until(A.page, () => [...document.querySelectorAll('.presentation-editor__remote-selection')].some((e) => e.getBoundingClientRect().width > 20), null, 10000);
  const es = await edSel();
  const marcRgb = rgb(colorOf('Marc'));
  const tinted = es.rects.length > 0 && es.rects.every((r) => r.bg === marcRgb && r.op > 0.1 && r.op < 0.6);
  ok(seenSel && tinted, 'écrit : chez Léa, la sélection de Marc est teintée de sa couleur (en transparence)', es.rects.slice(0, 3));
  ok(norm(es.under).includes('Premier paragraphe') && norm(es.under).length >= norm(selMarc?.quote).length - 2, 'écrit : texte sous la teinte chez Léa = sélection de Marc', norm(es.under));
  ok(es.labels.some((l) => l.t === 'Marc' && l.bg === marcRgb), 'écrit : étiquette « Marc » dans sa couleur', es.labels);
  ok(es.carets.some((c) => c.bg === marcRgb && c.h > 8 && Number(c.op) > 0.5), 'écrit : trait de saisie de Marc toujours affiché', es.carets);
  await A.page.mouse.move(5, 300);
  // Captures : fenêtre de Léa élargie (page entière à côté du plan et du volet).
  await A.page.setViewportSize({ width: 1600, height: 840 });
  await wait(900);
  for (const [t, label] of [['light', 'clair'], ['dark', 'sombre']]) {
    await theme(A.page, t);
    await wait(300);
    await A.page.screenshot({ path: path.join(SHOTS, `ecrit-${label}.png`) });
  }
  await theme(A.page, 'light');
  // Marc désélectionne : la teinte disparaît chez Léa, le trait reste.
  await B.page.keyboard.press('ArrowRight');
  const edGone = await until(A.page, () => ![...document.querySelectorAll('.presentation-editor__remote-selection')].some((e) => e.getBoundingClientRect().width > 20), null, 5000);
  ok(edGone, 'écrit : Marc désélectionne : la teinte disparaît chez Léa');

  // ════════ 4. Trafic ════════
  const all = Buffer.concat(wire);
  ok(all.length > 20000, 'le relais a vu passer la session de Marc', all.length);
  const secrets = ['Parjure', 'Léa', 'Marc', 'Inès', 'bon sens', 'la chose du monde', 'difficiles', 'contenter', 'Premier paragraphe', '"cur"', '"s":', seeded.pdf, seeded.epub, code];
  const hits = secrets.filter((x) => all.includes(Buffer.from(x)) || all.includes(Buffer.from(x, 'utf16le')));
  ok(hits.length === 0, 'aucune donnée en clair dans le trafic (texte sélectionné, prénoms, identifiants, repères)', hits);
} catch (e) {
  ok(false, 'exception', String(e).slice(0, 400));
} finally {
  for (const X of [A, B]) if (X.errors.length) console.log(`(${X.name}) erreurs de page :`, [...new Set(X.errors)].slice(0, 8));
  for (const h of headless) h.leave?.();
  for (const a of apps) await a.close().catch(() => {});
  proxy.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  console.log(fails ? `\n${fails} échec(s)` : '\nTout est vert.');
}
