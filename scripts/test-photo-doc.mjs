// Documents de photos : assembler plusieurs photos en un document (bibliothèque et Boîte de réception),
// le lire page par page (barre, ← / →), texte reconnu et extraits par page, saut vers un extrait d'une
// autre page, recherche sur toutes les pages, position retrouvée, originaux à la corbeille.
// Lancer : timeout 600 node scripts/test-photo-doc.mjs
import { withApp, shot } from './harness.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-photodoc-'));
const SHOTS = 'shots/photo-doc';
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};

// Pages : A et C simples (tailles distinctes), B = vraie page photographiée (texte à reconnaître).
const B = path.join(TMP, 'B.jpg');
spawnSync('python3', ['-I', path.join(ROOT, 'scripts/make-image-fixture.py'), B, path.join(TMP, 'b.txt'), '--clean'], { encoding: 'utf8' });
const gen = spawnSync(
  'python3',
  [
    '-I',
    '-c',
    `
from PIL import Image, ImageDraw, ImageFont
import sys
for name, size, tint, label in [('A', (900, 1200), (236, 226, 205), 'PAGE A'), ('C', (800, 1050), (214, 226, 236), 'PAGE C')]:
    im = Image.new('RGB', size, tint)
    d = ImageDraw.Draw(im)
    try:
        f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', 90)
    except Exception:
        f = ImageFont.load_default()
    d.text((120, 200), label, fill=(60, 50, 40), font=f)
    for i in range(14):
        d.rectangle((120, 420 + i * 46, size[0] - 120 - (i % 3) * 80, 432 + i * 46), fill=(150, 140, 125))
    im.save(sys.argv[1] + '/' + name + '.jpg', quality=85)
`,
    TMP,
  ],
  { encoding: 'utf8' },
);
if (gen.status !== 0) throw new Error(gen.stderr);
const b64 = (n) => fs.readFileSync(path.join(TMP, n)).toString('base64');

for (const dark of [false, true]) {
  await withApp(
    5381 + (dark ? 1 : 0),
    async (page) => {
      const tag = dark ? '[sombre] ' : '';
      const st = (fn, a) => page.evaluate(fn, a);
      const importImg = (name) =>
        st(
          async ({ name, b }) => {
            const bin = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
            const [book] = await window.__store.getState().importFiles([{ name, data: bin.buffer }]);
            return book.id;
          },
          { name, b: b64(name) },
        );

      // ── 1. Bibliothèque : sélection de trois photos → Assembler ──
      const ids = { A: await importImg('A.jpg'), B: await importImg('B.jpg'), C: await importImg('C.jpg') };
      await st(() => window.__store.getState().navigate({ name: 'library' }));
      await page.waitForSelector('.lib-card[data-sel-id]');
      await page.click('button:has-text("Sélectionner")');
      for (const k of ['A', 'C', 'B']) await page.click(`.lib-card[data-sel-id="${ids[k]}"]`);
      await page.waitForSelector('[data-testid="lib-assemble"]');
      ok(true, `${tag}bibliothèque : « Assembler en un document » proposé pour 3 photos`);
      await page.click('[data-testid="lib-assemble"]');
      await page.waitForSelector('[data-testid="assemble"] .asm-page img', { timeout: 15000 });
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="assemble"] .asm-page img').length === 3, null, { timeout: 15000 });
      ok(true, `${tag}fenêtre : trois miniatures`);
      // Mettre B en 2e position avec les flèches, quel que soit l'ordre de départ.
      const order0 = await st(() => [...document.querySelectorAll('[data-testid="assemble"] .asm-page')].map((e) => e.getAttribute('data-key')));
      let bi = order0.indexOf(`${ids.B}:1`);
      while (bi > 1) {
        await page.click(`[data-testid="assemble"] .asm-page[data-key="${ids.B}:1"] button[aria-label^="Avancer"]`);
        bi--;
      }
      if (bi === 0) await page.click(`[data-testid="assemble"] .asm-page[data-key="${ids.B}:1"] button[aria-label^="Reculer"]`);
      const keys = await st(() => [...document.querySelectorAll('[data-testid="assemble"] .asm-page')].map((e) => e.getAttribute('data-key')));
      ok(keys[1] === `${ids.B}:1` && keys.length === 3, `${tag}réordonner aux flèches : la page photographiée en 2e`, keys);
      const firstIsA = keys[0] === `${ids.A}:1`;
      await page.fill('[data-testid="assemble-title"]', 'Chapitre 2');
      await shot(page, `${SHOTS}/${dark ? 'sombre' : 'clair'}-01-fenetre.png`);
      await page.click('[data-testid="assemble-go"]');
      await page.waitForSelector('[data-testid="assemble"]', { state: 'detached', timeout: 20000 });
      const doc = await st(() => window.__store.getState().books.find((b) => b.title === 'Chapitre 2'));
      ok(!!doc && doc.format === 'image' && doc.pages?.length === 3 && doc.fileName === doc.pages[0], `${tag}document créé : 3 pages`, doc?.pages);
      const left = await st((ids) => window.__store.getState().books.filter((b) => Object.values(ids).includes(b.id)).length, ids);
      ok(left === 0, `${tag}photos d’origine placées dans la corbeille`);
      await page.waitForTimeout(300);
      ok((await page.locator(`.lib-card[data-sel-id="${doc.id}"]`).innerText()).includes('Document de 3 photos'), `${tag}carte : « Document de 3 photos »`);
      if (!dark) await shot(page, `${SHOTS}/02-bibliotheque.png`);

      // ── 2. Lecture page par page ──
      await st((id) => window.__store.getState().openBook(id), doc.id);
      await page.waitForSelector('[data-testid="img-page"]', { timeout: 20000 });
      const pageTxt = () => page.textContent('[data-testid="img-page"]').then((t) => t.replace(/\s+/g, ' ').trim());
      const natW = () => page.evaluate(() => document.querySelector('.img-picture')?.naturalWidth ?? 0);
      ok((await pageTxt()) === '1 / 3' && (await natW()) === (firstIsA ? 900 : 800), `${tag}ouverture : page 1 / 3, la première photo`, `${await pageTxt()}, ${await natW()} px`);
      await page.click('[data-testid="img-next"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="img-page"]')?.textContent.replace(/\s+/g, ' ').trim() === '2 / 3');
      await page.waitForFunction(() => (document.querySelector('.img-picture')?.naturalWidth ?? 0) > 1000, null, { timeout: 10000 });
      ok(true, `${tag}« Page suivante » : 2 / 3, la page photographiée`);
      await page.click('.img-scroll');
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('[data-testid="img-page"]')?.textContent.replace(/\s+/g, ' ').trim() === '3 / 3');
      const lastW = firstIsA ? 800 : 900;
      const gotLast = await page.waitForFunction((w) => document.querySelector('.img-picture')?.naturalWidth === w, lastW, { timeout: 10000 }).then(() => true, () => false);
      ok(gotLast, `${tag}→ : page 3 / 3, la dernière photo`);
      ok(await page.locator('[data-testid="img-next"]').isDisabled(), `${tag}dernière page : « suivante » désactivée`);
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(() => document.querySelector('[data-testid="img-page"]')?.textContent.replace(/\s+/g, ' ').trim() === '2 / 3');
      await page.waitForFunction(() => (document.querySelector('.img-picture')?.naturalWidth ?? 0) > 1000, null, { timeout: 10000 });
      ok(true, `${tag}← : retour à la page 2`);
      await page.waitForSelector('[data-testid="img-ocr-offer"]');
      ok((await page.locator('[data-testid="img-ocr-offer"]').innerText()).includes('page 2'), `${tag}reconnaissance proposée pour cette page`);
      await shot(page, `${SHOTS}/${dark ? 'sombre' : 'clair'}-03-lecteur.png`);

      if (dark) return;

      // ── 3. Texte reconnu de la page 2, rangé à part ──
      await page.click('[data-testid="img-ocr-offer"] button');
      await page.waitForFunction(() => document.querySelectorAll('.img-text span[data-i]').length > 200, null, { timeout: 180000 });
      const files = await st(async (id) => {
        const { host } = await import('/src/lib/platform.ts');
        const r = async (f) => !!(await host.readFile(id, f).catch(() => null));
        return { p2: await r('ocr-p2.json'), p1: await r('ocr.json') };
      }, doc.id);
      ok(files.p2 && !files.p1, `${tag}texte de la page 2 enregistré à part (ocr-p2.json), page 1 intacte`, files);

      // ── 4. Extrait sur la page 2, puis saut depuis la page 1 ──
      const hid = await st((id) => {
        const h = window.__store.getState().addHighlight({ bookId: id, category: 'these', text: 'bon sens', anchor: { kind: 'pdf', page: 2, rects: [{ x: 0.2, y: 0.3, w: 0.4, h: 0.03 }] }, locationLabel: 'Page 2' });
        return h.id;
      }, doc.id);
      await page.click('[data-testid="img-prev"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="img-page"]')?.textContent.replace(/\s+/g, ' ').trim() === '1 / 3');
      ok(!(await page.$(`.hl[data-hl-id="${hid}"]`)), `${tag}page 1 : l’extrait de la page 2 n’y est pas`);
      await st((id) => window.__store.getState().jumpToHighlight(id), hid);
      await page.waitForSelector(`.hl[data-hl-id="${hid}"]`, { timeout: 10000 });
      ok((await pageTxt()) === '2 / 3', `${tag}aller à l’extrait : la page 2 s’ouvre et l’extrait est marqué`);

      // ── 5. Recherche sur toutes les pages ──
      await page.click('[data-testid="img-next"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="img-page"]')?.textContent.replace(/\s+/g, ' ').trim() === '3 / 3');
      await page.keyboard.press('Control+f');
      await page.waitForSelector('.search-bar-input', { timeout: 4000 });
      await page.fill('.search-bar-input', 'mieux partagée');
      await page.waitForSelector('.img-search-layer .search-hit', { timeout: 10000 }).catch(() => null);
      ok((await pageTxt()) === '2 / 3' && !!(await page.$('.img-search-layer .search-hit')), `${tag}recherche depuis la page 3 : résultat trouvé et montré page 2`, await pageTxt());
      await page.keyboard.press('Escape');

      // ── 6. Position retrouvée ──
      await page.waitForTimeout(800);
      await st(() => window.__store.getState().navigate({ name: 'library' }));
      await page.waitForTimeout(300);
      await st((id) => window.__store.getState().openBook(id), doc.id);
      await page.waitForSelector('[data-testid="img-page"]');
      await page.waitForTimeout(500);
      ok((await pageTxt()) === '2 / 3', `${tag}réouverture : on reprend à la page 2`, await pageTxt());

      // ── 7. Boîte de réception : cocher deux photos sur trois → un document ──
      await st(() => window.__store.getState().navigate({ name: 'inbox' }));
      await page.waitForSelector('.ib-ways, .ib-list, .ib-empty');
      await page.click('[data-testid="wifi-open"]');
      await page.waitForSelector('[data-testid="wifi-receive"]');
      for (const [n, f] of [
        ['Photo du 2026-10-19 10.01.10.jpg', 'A.jpg'],
        ['Photo du 2026-10-19 10.01.24.jpg', 'C.jpg'],
        ['Photo du 2026-10-19 10.02.03.jpg', 'B.jpg'],
      ])
        await st(({ n, b }) => window.__inbox.wifi(n, Uint8Array.from(atob(b), (c) => c.charCodeAt(0)), 'iPhone'), { n, b: b64(f) });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="ib-pick"]').length === 3, null, { timeout: 20000 });
      ok((await page.locator('[data-testid="ib-assemble"]').innerText()).includes('Cochez les photos'), `${tag}Boîte : invitation à cocher les photos`);
      ok(await page.locator('[data-testid="ib-assemble-go"]').isDisabled(), `${tag}« Assembler » inactif sans deux photos cochées`);
      const pick = (n) => page.check(`.ib-card[data-name="${n}"] [data-testid="ib-pick"]`);
      await pick('Photo du 2026-10-19 10.01.10.jpg');
      ok((await page.locator('[data-testid="ib-assemble"]').innerText()).includes('1 photo cochée'), `${tag}une photo : il en faut une autre`);
      await pick('Photo du 2026-10-19 10.01.24.jpg');
      ok((await page.locator('[data-testid="ib-assemble"]').innerText()).includes('2 photos cochées'), `${tag}deux photos cochées`);
      await shot(page, `${SHOTS}/04-boite.png`);
      await page.click('[data-testid="ib-assemble-go"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="assemble"] .asm-page img').length === 2, null, { timeout: 15000 });
      ok((await page.locator('[data-testid="assemble"]').innerText()).includes('quittent la Boîte de réception'), `${tag}fenêtre : les photos quittent la Boîte`);
      await page.fill('[data-testid="assemble-title"]', 'Notes de cours');
      await shot(page, `${SHOTS}/05-fenetre-boite.png`);
      await page.click('[data-testid="assemble-go"]');
      await page.waitForSelector('[data-testid="assemble"]', { state: 'detached', timeout: 20000 });
      const doc2 = await st(() => window.__store.getState().books.find((b) => b.title === 'Notes de cours'));
      ok(!!doc2 && doc2.pages?.length === 2, `${tag}Boîte : document de 2 pages dans la bibliothèque`, doc2?.pages);
      await page.waitForFunction(() => document.querySelectorAll('.ib-card').length === 1, null, { timeout: 10000 });
      ok((await page.locator('.ib-card').getAttribute('data-name')) === 'Photo du 2026-10-19 10.02.03.jpg', `${tag}la photo non cochée reste dans la Boîte`);
      ok(!(await page.$('[data-testid="ib-assemble"]')), `${tag}plus qu’une photo : la barre d’assemblage disparaît`);
      await shot(page, `${SHOTS}/06-boite-apres.png`);
    },
    { dark },
  );
}
fs.rmSync(TMP, { recursive: true, force: true });
