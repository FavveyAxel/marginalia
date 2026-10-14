// Test du moteur image + OCR — port 5219. Lancer : timeout 400 node scripts/test-image.mjs
// Fixture générée (PIL) : photo simulée d'une page du Discours de la méthode (rotation 1,2°, bruit, flou, JPEG).
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 5219;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'marg-img-'));
const SHOTS = 'shots/image';
let failed = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${extra !== '' ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => {
  fs.mkdirSync(path.join(ROOT, SHOTS), { recursive: true });
  await page.screenshot({ path: path.join(ROOT, SHOTS, name) });
  console.log('capture:', `${SHOTS}/${name}`);
};

// ── Fixtures ──
const IMG = path.join(TMP, 'discours-page.jpg');
const TRUTH = path.join(TMP, 'discours-page.txt');
const gen = spawnSync('python3', ['-I', path.join(ROOT, 'scripts/make-image-fixture.py'), IMG, TRUTH], { encoding: 'utf8' });
if (gen.status !== 0) throw new Error('fixture : ' + gen.stderr);
const BLANK = path.join(TMP, 'carte-sans-texte.png');
spawnSync('python3', ['-I', '-c', `
from PIL import Image, ImageDraw
im = Image.new('RGB', (1200, 800), (196, 186, 160))
d = ImageDraw.Draw(im)
for i in range(0, 1200, 40): d.line([(i, 0), (i + 300, 800)], fill=(170, 160, 135), width=6)
d.ellipse([400, 200, 800, 600], outline=(90, 70, 50), width=14)
im.save(${JSON.stringify(BLANK)})
`]);
const FAKE_HEIC = path.join(TMP, 'photo.heic');
fs.writeFileSync(FAKE_HEIC, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(64)]));

/** Taux de mots corrects (alignement par plus longue sous-suite commune). */
function wordAccuracy(truth, ocr) {
  const norm = (s) => s.replace(/[’‘`]/g, "'").split(/\s+/).filter(Boolean);
  const a = norm(truth);
  const b = norm(ocr);
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]);
      diag = tmp;
    }
  }
  return { ok: prev[b.length], total: a.length };
}

async function importFile(page, file) {
  const b64 = fs.readFileSync(file).toString('base64');
  return page.evaluate(
    async ({ name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const [book] = await window.__store.getState().importFiles([{ name, data: bin.buffer }]);
      return book?.id ?? null;
    },
    { name: path.basename(file), b64 },
  );
}

const readOcr = (page, id) =>
  page.evaluate(async (id) => {
    const { host } = await import('/src/lib/platform.ts');
    try {
      return JSON.parse(new TextDecoder().decode(await host.readFile(id, 'ocr.json')));
    } catch {
      return null;
    }
  }, id);

/** Rectangle écran couvrant les mots `from`…`to` du calque de texte (spans consécutifs). */
const wordsBox = (page, words) =>
  page.evaluate((words) => {
    const spans = [...document.querySelectorAll('.img-text span[data-i]')];
    const txt = spans.map((s) => s.textContent.trim());
    for (let i = 0; i + words.length <= txt.length; i++) {
      if (words.every((w, k) => txt[i + k] === w)) {
        const rs = spans.slice(i, i + words.length).map((s) => s.getBoundingClientRect());
        return { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)), first: rs[0], last: rs[rs.length - 1] };
      }
    }
    return null;
  }, words);

const hlBox = (page, id) =>
  page.evaluate((id) => {
    const els = [...document.querySelectorAll(`.img-hl-layer .hl[data-hl-id="${id}"]`)];
    if (!els.length) return null;
    const rs = els.map((e) => e.getBoundingClientRect());
    const pg = document.querySelector('.img-page').getBoundingClientRect();
    const l = Math.min(...rs.map((r) => r.left));
    const t = Math.min(...rs.map((r) => r.top));
    const r = Math.max(...rs.map((r) => r.right));
    const b = Math.max(...rs.map((r) => r.bottom));
    return { left: l, top: t, right: r, bottom: b, n: els.length, rel: { x: (l - pg.left) / pg.width, y: (t - pg.top) / pg.height, w: (r - l) / pg.width, h: (b - t) / pg.height } };
  }, id);

const iou = (a, b) => {
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const inter = x * y;
  const area = (r) => (r.right - r.left) * (r.bottom - r.top);
  return inter / (area(a) + area(b) - inter);
};

async function dragOver(page, box) {
  await page.evaluate(([x, y]) => ((window.__x = x), (window.__y = y)), [box.first.left + 1, box.first.top + box.first.height / 2]);
  await page.mouse.move(box.first.left + 1, box.first.top + box.first.height / 2);
  await page.mouse.down();
  const x1 = box.last.right - 1;
  const y1 = box.last.top + box.last.height / 2;
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.first.left + ((x1 - box.first.left) * i) / 12, box.first.top + box.first.height / 2 + ((y1 - box.first.top - box.first.height / 2) * i) / 12);
  await page.mouse.up();
}

const newHighlight = (page, before) =>
  page.waitForFunction((n) => window.__store.getState().highlights.length > n, before, { timeout: 5000 }).then(() =>
    page.evaluate(() => {
      const hs = window.__store.getState().highlights;
      return hs[hs.length - 1];
    }),
  );

// ── Serveur ──
fs.rmSync('/tmp/vite-' + PORT, { recursive: true, force: true });
const server = await createServer({ root: ROOT, cacheDir: '/tmp/vite-' + PORT, server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
const requests = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('request', (r) => requests.push(r.url()));
ctx.on('request', (r) => requests.push(r.url()));
const ready = () => page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });

try {
  await page.goto(`http://localhost:${PORT}/`);
  await ready();

  // 1. Formats acceptés (bouton Importer, glisser-déposer)
  const accepted = await page.evaluate(async () => {
    const p = await import('/src/lib/platform.ts');
    const mk = (n) => new File([new Uint8Array([1, 2, 3])], n);
    const dropped = await p.filesFromDrop([mk('a.jpg'), mk('b.JPEG'), mk('c.png'), mk('d.webp'), mk('e.heic'), mk('f.tiff'), mk('g.exe')]);
    return { exts: p.ACCEPTED_EXTENSIONS, dropped: dropped.map((f) => f.name) };
  });
  ok(['jpg', 'jpeg', 'png', 'webp', 'heic', 'tiff', 'tif'].every((e) => accepted.exts.includes(e)), 'extensions images acceptées (Importer)', accepted.exts.join(','));
  ok(accepted.dropped.length === 6 && !accepted.dropped.includes('g.exe'), 'glisser-déposer : images retenues, autres fichiers écartés', accepted.dropped.join(','));

  // 2. Import
  const id = await importFile(page, IMG);
  const book = await page.evaluate((id) => window.__store.getState().books.find((b) => b.id === id), id);
  ok(book?.format === 'image', 'format « image »', book?.format);
  ok(book?.title === 'discours-page', 'titre = nom du fichier', book?.title);
  ok(typeof book?.cover === 'string' && book.cover.startsWith('data:image/jpeg'), 'couverture = miniature JPEG', book?.cover?.slice(0, 24));
  await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
  await page.waitForTimeout(600);
  await shot(page, '00-bibliotheque.png');

  // 3. Ouverture : image affichée vite, OCR en arrière-plan avec progression
  const t0 = Date.now();
  await page.evaluate((id) => window.__store.getState().openBook(id), id);
  await page.waitForSelector('.img-picture', { timeout: 20000 });
  const tImg = Date.now() - t0;
  ok(true, 'image affichée', `${tImg} ms`);
  const chip = await page.waitForSelector('.img-ocr-chip', { timeout: 10000 }).catch(() => null);
  ok(!!chip, 'barre de progression pendant la reconnaissance');
  await page.waitForFunction(() => Number(document.querySelector('.img-ocr-pct')?.textContent.replace(/\D/g, '') || 0) >= 30, null, { timeout: 60000 }).catch(() => null);
  await shot(page, '01-ocr-en-cours.png');
  await page.click('[data-testid="img-text-toggle"]');
  await page.waitForTimeout(300);
  await shot(page, '02-ocr-en-cours-panneau.png');
  await page.click('[data-testid="img-text-toggle"]');
  await page.waitForFunction(() => document.querySelectorAll('.img-text span[data-i]').length > 200, null, { timeout: 180000 });
  const tOcr = Date.now() - t0;
  ok(!(await page.$('.img-ocr-chip')), 'reconnaissance terminée', `${(tOcr / 1000).toFixed(1)} s (image + OCR)`);

  // 4. Qualité OCR (hors ligne, français)
  const ocr = await readOcr(page, id);
  ok(!!ocr && ocr.langs === 'fra+eng' && ocr.engine.startsWith('tesseract.js'), 'résultat mis en cache dans la bibliothèque (ocr.json)', ocr && `${ocr.engine}, ${ocr.langs}, ${ocr.ms} ms`);
  const ocrText = ocr.paras.map((p) => p.lines.map((l) => l.words.map((w) => w.t).join(' ')).join('\n')).join('\n\n');
  const acc = wordAccuracy(fs.readFileSync(TRUTH, 'utf8'), ocrText);
  const rate = acc.ok / acc.total;
  ok(rate >= 0.95, 'taux de mots corrects sur la page connue', `${acc.ok}/${acc.total} = ${(rate * 100).toFixed(1)} %, confiance moyenne ${ocr.confidence} %`);
  const external = [...new Set(requests.filter((u) => !u.startsWith(`http://localhost:${PORT}`) && !u.startsWith('data:') && !u.startsWith('blob:')))];
  ok(external.length === 0, 'aucune requête hors de l’app (OCR hors ligne)', external.slice(0, 3).join(' '));
  ok(requests.some((u) => u.includes('/ocr/lang/fra.traineddata.gz')) && requests.some((u) => u.includes('/ocr/tesseract-core-simd-lstm.wasm.js')), 'modèles et cœur chargés depuis l’app');

  // 5. Sélection réelle à la souris → barre → surlignage
  const words = ['puissance', 'de', 'bien', 'juger'];
  const box = await wordsBox(page, words);
  ok(!!box, 'mots du passage présents dans le calque de texte');
  await dragOver(page, box);
  if (!(await page.waitForSelector('.sel-toolbar', { timeout: 4000 }).catch(() => null)))
    console.log('DEBUG', JSON.stringify(await page.evaluate(() => {
      const s = window.getSelection();
      const el = document.elementFromPoint(0, 0);
      return { sel: s.toString(), rc: s.rangeCount, a: s.anchorNode?.nodeName + ':' + (s.anchorNode?.parentElement?.className), top: document.elementsFromPoint(window.__x, window.__y).slice(0, 5).map((e) => e.tagName + '.' + e.className) };
    })), JSON.stringify(box.first));
  const selText = await page.evaluate(() => window.getSelection().toString().replace(/\s+/g, ' ').trim());
  ok(selText === 'puissance de bien juger', 'sélection à la souris', JSON.stringify(selText));
  let before = await page.evaluate(() => window.__store.getState().highlights.length);
  await page.keyboard.press('2');
  const h1 = await newHighlight(page, before);
  ok(h1.text === 'puissance de bien juger' && h1.category === 'these' && h1.anchor.kind === 'pdf' && h1.anchor.page === 1, 'surlignage créé (Thèse, PdfAnchor page 1)', `${JSON.stringify(h1.text)} ${h1.anchor.rects.length} rect.`);
  await page.waitForTimeout(200);
  const hb1 = await hlBox(page, h1.id);
  const align1 = hb1 ? iou(hb1, box) : 0;
  ok(align1 > 0.6, 'surlignage aligné sur les mots de l’image', `IoU ${align1.toFixed(2)}`);
  {
    // Alignement sur la position RÉELLE des mots dans l'image (boîtes de l'OCR), indépendamment du calque.
    const ws = ocr.paras.flatMap((p) => p.lines.flatMap((l) => l.words));
    const k = ws.findIndex((w, i) => words.every((t, j) => ws[i + j]?.t === t));
    const sel = ws.slice(k, k + words.length);
    const truthBox = { left: Math.min(...sel.map((w) => w.x)), top: Math.min(...sel.map((w) => w.y)), right: Math.max(...sel.map((w) => w.x + w.w)), bottom: Math.max(...sel.map((w) => w.y + w.h)) };
    const rs = h1.anchor.rects;
    const hb = { left: Math.min(...rs.map((r) => r.x)), top: Math.min(...rs.map((r) => r.y)), right: Math.max(...rs.map((r) => r.x + r.w)), bottom: Math.max(...rs.map((r) => r.y + r.h)) };
    const v = iou(hb, truthBox);
    ok(k >= 0 && v > 0.75, 'surlignage aligné sur les boîtes des mots dans l’image', `IoU ${v.toFixed(2)}`);
  }
  await shot(page, '03-surlignage.png');

  // 6. Note (touche N) sur un autre passage
  const box2 = await wordsBox(page, ['bon', 'sens', 'ou', 'la', 'raison,']);
  await dragOver(page, box2);
  await page.waitForSelector('.sel-toolbar', { timeout: 4000 });
  before = await page.evaluate(() => window.__store.getState().highlights.length);
  await page.keyboard.press('n');
  const h2 = await newHighlight(page, before);
  ok(h2.category === null && /bon sens ou la raison/.test(h2.text), 'note de marge (category null)', JSON.stringify(h2.text));
  const area = await page.waitForSelector('.ann-note-area', { timeout: 4000 }).catch(() => null);
  ok(!!area, 'éditeur de note ouvert');
  if (area) {
    await area.type('Le bon sens = la raison : égalité de nature.');
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(300);
  const note = await page.evaluate((id) => window.__store.getState().highlights.find((h) => h.id === id)?.note, h2.id);
  ok(/égalité de nature/.test(note ?? ''), 'note enregistrée', JSON.stringify(note));

  // 7. Zoom : le surlignage suit l'image
  const z0 = await page.textContent('[data-testid="img-zoom"]');
  await page.click('.img-zoombar button[aria-label="Zoom avant"]');
  await page.click('.img-zoombar button[aria-label="Zoom avant"]');
  await page.waitForTimeout(400);
  const z1 = await page.textContent('[data-testid="img-zoom"]');
  await page.evaluate((id) => document.querySelector(`.hl[data-hl-id="${id}"]`)?.scrollIntoView({ block: 'center', inline: 'center' }), h1.id);
  await page.waitForTimeout(250);
  const zb = await wordsBox(page, words);
  const zh = await hlBox(page, h1.id);
  const alignZ = zh && zb ? iou(zh, zb) : 0;
  ok(z0 !== z1 && alignZ > 0.6, 'zoom : surlignage toujours aligné', `${z0.trim()} → ${z1.trim()}, IoU ${alignZ.toFixed(2)}`);
  await shot(page, '04-zoom.png');
  await page.click('.img-zoombar .img-tool >> text=Ajuster');
  await page.waitForTimeout(300);

  // 8. Recherche dans le texte reconnu
  await page.keyboard.press('Control+f');
  await page.waitForSelector('.search-bar-input', { timeout: 4000 });
  await page.fill('.search-bar-input', 'mieux partagée');
  await page.waitForSelector('.img-search-layer .search-hit', { timeout: 5000 }).catch(() => null);
  const hitBox = await page.evaluate(() => {
    const r = document.querySelector('.img-search-layer .search-hit')?.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  });
  const sb = await wordsBox(page, ['mieux', 'partagée']);
  ok(!!hitBox && !!sb && iou(hitBox, sb) > 0.5, 'recherche : résultat marqué sur l’image', hitBox && sb ? `IoU ${iou(hitBox, sb).toFixed(2)}` : 'aucun');
  await shot(page, '05-recherche.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // 9. Annotation par zone (Z) sur une partie sans texte
  await page.click('.img-zoombar .img-tool >> text=Zone');
  await page.waitForSelector('.img-zone-capture');
  const pg = await page.evaluate(() => {
    const r = document.querySelector('.img-page').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  await page.evaluate(() => (document.querySelector('.img-scroll').scrollTop = 0));
  const pg0 = await page.evaluate(() => {
    const r = document.querySelector('.img-page').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const zx0 = pg0.left + pg0.width * 0.62;
  const zy0 = pg0.top + pg0.height * 0.05;
  await page.mouse.move(zx0, zy0);
  await page.mouse.down();
  await page.mouse.move(zx0 + pg0.width * 0.15, zy0 + pg0.height * 0.04, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector('.sel-toolbar', { timeout: 4000 });
  await shot(page, '06-zone.png');
  before = await page.evaluate(() => window.__store.getState().highlights.length);
  await page.keyboard.press('n');
  const h3 = await newHighlight(page, before);
  const zr = h3.anchor.rects[0];
  ok(h3.anchor.rects.length === 1 && Math.abs(zr.x - 0.62) < 0.01 && Math.abs(zr.w - 0.15) < 0.01, 'zone tracée → extrait rectangulaire', `${JSON.stringify(zr)} ${JSON.stringify(h3.text)}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  void pg;

  // 10. Texte reconnu : panneau, correction d'une ligne
  await page.click('[data-testid="img-text-toggle"]');
  await page.waitForSelector('.img-panel .img-line');
  const lineIdx = await page.evaluate(() => [...document.querySelectorAll('.img-line')].findIndex((l) => /coutume/.test(l.textContent)));
  const line = (await page.$$('.img-line'))[lineIdx];
  const orig = await line.textContent();
  await line.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' [corrigé]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const ocr2 = await readOcr(page, id);
  const edited = ocr2.paras.flatMap((p) => p.lines).find((l) => l.words.some((w) => w.t === '[corrigé]'));
  ok(!!ocr2.editedAt && !!edited, 'correction d’une ligne enregistrée', JSON.stringify(orig.slice(0, 40)));
  await shot(page, '07-texte-reconnu.png');

  // 11. Rechargement : pas de nouvel OCR, surlignage au même endroit
  const rel1 = (await hlBox(page, h1.id)).rel;
  await page.waitForTimeout(800);
  requests.length = 0;
  await page.reload();
  await ready();
  const t1 = Date.now();
  await page.evaluate((id) => window.__store.getState().openBook(id), id);
  await page.waitForFunction(() => document.querySelectorAll('.img-text span[data-i]').length > 200, null, { timeout: 20000 });
  const tReopen = Date.now() - t1;
  const sawChip = !!(await page.$('.img-ocr-chip'));
  const ocr3 = await readOcr(page, id);
  ok(!sawChip && ocr3.createdAt === ocr.createdAt && !requests.some((u) => u.includes('traineddata')), 'réouverture sans nouvelle reconnaissance', `${tReopen} ms`);
  await page.waitForSelector(`.hl[data-hl-id="${h1.id}"]`);
  const rel2 = (await hlBox(page, h1.id)).rel;
  const drift = Math.max(Math.abs(rel1.x - rel2.x), Math.abs(rel1.y - rel2.y), Math.abs(rel1.w - rel2.w), Math.abs(rel1.h - rel2.h));
  ok(drift < 0.002, 'surlignage au même endroit après rechargement', `écart ${drift.toFixed(5)}`);
  ok(await page.evaluate(() => [...document.querySelectorAll('.img-text span')].some((s) => s.textContent.trim() === '[corrigé]')), 'correction conservée après rechargement');

  // 12. Image sans texte : invitation à tracer une zone
  const idBlank = await importFile(page, BLANK);
  await page.evaluate((id) => window.__store.getState().openBook(id), idBlank);
  const empty = await page.waitForSelector('.img-empty', { timeout: 120000 }).catch(() => null);
  ok(!!empty && /Aucun texte reconnu/.test(await empty.textContent()), 'image sans texte : état vide avec « Tracer une zone »');
  await shot(page, '08-sans-texte.png');

  // 13. HEIC non décodable dans un navigateur : message clair
  const idHeic = await importFile(page, FAKE_HEIC);
  await page.evaluate((id) => window.__store.getState().openBook(id), idHeic);
  const err = await page.waitForSelector('.reader-page .empty', { timeout: 10000 }).catch(() => null);
  ok(!!err && /HEIC/.test(await err.textContent()), 'HEIC sans convertisseur : message explicite', err ? (await err.textContent()).slice(0, 90) : '');

  // 14. Captures : clair, sombre, côte à côte
  await page.evaluate((id) => window.__store.getState().openBook(id), id);
  await page.waitForSelector(`.hl[data-hl-id="${h1.id}"]`);
  await page.waitForTimeout(400);
  await shot(page, '09-clair.png');
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
  await page.waitForTimeout(400);
  await shot(page, '10-sombre.png');
  await page.click('[data-testid="img-text-toggle"]').catch(() => undefined);
  await page.waitForTimeout(300);
  await shot(page, '11-sombre-texte.png');
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));
  const pdfId = await importFile(page, path.join(ROOT, 'fixtures/discours.pdf'));
  await page.evaluate(({ id, pdfId }) => window.__store.getState().navigate({ name: 'reader', bookId: id, tab: 'lecture', splitBookId: pdfId }), { id, pdfId });
  await page.waitForSelector('.reader-page[data-pane="b"] .textLayer', { timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(600);
  await shot(page, '12-cote-a-cote.png');

  const own = errors.filter((e) => !/Failed to load resource/.test(e));
  ok(own.length === 0, 'aucune erreur navigateur', own.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} ÉCHEC(S)` : '\nTOUS LES TESTS PASSENT');
process.exit(failed ? 1 : 0);
