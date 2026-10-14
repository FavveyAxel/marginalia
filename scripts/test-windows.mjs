// Windows simulé côté rendu (?platform=win) et non-régression Mac — port 5351.
// Lancer : timeout 400 node scripts/test-windows.mjs
// Windows : classe platform-win, libellés Ctrl/Maj (Aide, éditeur, barre latérale), Ctrl+K, Ctrl+D,
// Ctrl+F, Ctrl+H, Ctrl+Maj+1 / Ctrl+Maj+P / Ctrl+Maj+S / Ctrl+Maj+B, F1, AltGr (Ctrl+Alt) sans effet,
// « Depuis Livres » absent, réserve à droite des barres du haut (boutons de fenêtre).
// Mac (sans paramètre) : libellés ⌘, ⌘K / ⌘D / ⌃⌘S, aucune réserve à droite.
// HEIC (vraie image, fabriquée hors ligne) et TIFF : décodeur JS/WASM embarqué.
// Captures Windows clair et sombre dans shots/windows/.
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importFixture } from './harness.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/windows');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5351;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-win-'));

let failed = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${name}${detail !== '' ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('capture:', path.relative(ROOT, path.join(OUT, name)));
};
const st = (page, fn, arg) => page.evaluate(fn, arg);

// ── Fixtures image : vraie HEIC (HEVC via ffmpeg/libx265) et TIFF (PIL), hors ligne ──
const JPG = path.join(TMP, 'page.jpg');
const HEIC = path.join(TMP, 'page-photo.heic');
const TIFF = path.join(TMP, 'page-scan.tiff');
let r = spawnSync('python3', ['-I', path.join(ROOT, 'scripts/make-image-fixture.py'), JPG, path.join(TMP, 'page.txt'), '--clean'], { encoding: 'utf8' });
if (r.status !== 0) throw new Error('fixture jpg : ' + r.stderr);
r = spawnSync('python3', ['-I', path.join(ROOT, 'scripts/make-heic-fixture.py'), JPG, HEIC], { encoding: 'utf8' });
const haveHeic = r.status === 0;
if (!haveHeic) console.log('HEIC non fabriqué (ffmpeg/libx265 absent ?) :', r.stderr.slice(0, 200));
r = spawnSync('python3', ['-I', '-c', `from PIL import Image; Image.open(${JSON.stringify(JPG)}).convert('RGB').save(${JSON.stringify(TIFF)}, compression='tiff_lzw')`], { encoding: 'utf8' });
if (r.status !== 0) throw new Error('fixture tiff : ' + r.stderr);

const server = await createServer({
  root: ROOT,
  cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`),
  server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errors = [];

async function open(query, { dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('request', (req) => {
    const u = req.url();
    if (!u.startsWith(`http://localhost:${PORT}`) && !/^(data|blob):/.test(u)) errors.push('requête externe : ' + u);
  });
  page.on('framenavigated', (f) => f === page.mainFrame() && console.log('navigation :', f.url()));
  page.on('response', (res) => res.status() >= 400 && errors.push(res.status() + ' : ' + res.url()));
  await page.goto(`http://localhost:${PORT}/${query}`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  return { ctx, page };
}

async function openDraft(page, html) {
  const d = await page.evaluate(async (html) => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Essai Windows', html }), html);
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), d.id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await sleep(1500);
  return d.id;
}
async function caret(page, needle) {
  await page.evaluate((needle) => {
    const ed = window.__ed.engine().debugEditor().editor;
    let at = null;
    ed.state.doc.descendants((n, pos) => {
      if (at !== null) return false;
      if (n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) + needle.length;
      return true;
    });
    ed.commands.setTextSelection({ from: at, to: at });
    ed.view.focus();
  }, needle);
  await sleep(150);
}
const topbarReserve = (page, sel = '.main .topbar') =>
  page.evaluate((sel) => {
    const t = document.querySelector(sel);
    if (!t) return null;
    const cs = getComputedStyle(t);
    const r = t.getBoundingClientRect();
    // élément interactif le plus à droite de la barre
    const right = Math.max(0, ...[...t.querySelectorAll('button, input, a')].map((b) => b.getBoundingClientRect().right).filter((x) => x > 0));
    return { pad: parseFloat(cs.paddingRight), padLeft: parseFloat(cs.paddingLeft), freeRight: Math.round(window.innerWidth - right), barRight: Math.round(r.right) };
  }, sel);

try {
  // ═══════════════════ Windows simulé ═══════════════════
  {
    const { ctx, page } = await open('?platform=win');
    check('Windows : classe platform-win sur <html>', await page.evaluate(() => document.documentElement.classList.contains('platform-win')));
    const sideKbd = await page.textContent('.sidebar .nav-item .kbd');
    check('Windows : barre latérale « Ctrl+K »', sideKbd === 'Ctrl+K', sideKbd);
    const importKbd = await page.evaluate(() => [...document.querySelectorAll('.sidebar .btn .kbd')].map((k) => k.textContent).join(','));
    check('Windows : bouton Importer « Ctrl+O »', importKbd === 'Ctrl+O', importKbd);
    const toggleTitle = await page.getAttribute('.sidebar-toggle', 'title');
    check('Windows : bulle de la barre latérale « Ctrl+Maj+B »', /Ctrl\+Maj\+B/.test(toggleTitle), toggleTitle);
    check('Windows : thème « suit le système »', (await page.locator('[aria-label="Automatique (suit le système)"]').count()) === 1);

    // Accueil : réserve à droite pour les boutons de fenêtre
    const res = await topbarReserve(page);
    check('Windows : barre du haut réserve ≈ 140 px à droite', res && res.pad >= 150 && res.pad <= 170, res);

    // Ctrl+K / Meta+K
    await page.mouse.click(700, 400);
    await page.keyboard.press('Control+KeyK');
    await sleep(200);
    check('Windows : Ctrl+K ouvre la recherche', await st(page, () => window.__store.getState().commandOpen));
    await page.keyboard.press('Escape');
    await sleep(150);
    // AltGr (= Ctrl+Alt) ne déclenche pas Ctrl+K
    await page.keyboard.press('Control+Alt+KeyK');
    await sleep(150);
    check('Windows : Ctrl+Alt+K (AltGr) n’ouvre pas la recherche', !(await st(page, () => window.__store.getState().commandOpen)));
    await page.evaluate(() => window.__store.getState().setCommandOpen(false));

    // Ctrl+Maj+B : barre latérale ; F1 : aide
    const c0 = await st(page, () => !!window.__store.getState().settings.sidebarCollapsed);
    await page.keyboard.press('Control+Shift+KeyB');
    await sleep(200);
    const c1 = await st(page, () => !!window.__store.getState().settings.sidebarCollapsed);
    check('Windows : Ctrl+Maj+B replie la barre latérale', c1 === !c0);
    await shot(page, 'win-rail-clair.png');
    await page.keyboard.press('Control+Shift+KeyB');
    await sleep(200);
    await page.keyboard.press('F1');
    await sleep(400);
    check('Windows : F1 ouvre l’aide', (await st(page, () => window.__store.getState().route.name)) === 'help');

    // Aide : libellés Windows
    const table = await page.evaluate(() => [...document.querySelectorAll('.help-table tr')].map((tr) => tr.textContent));
    const has = (k) => table.some((t) => t.includes(k));
    check('Aide Windows : aucun symbole ⌘ ⌥ ⌃ dans le tableau', !table.some((t) => /[⌘⌥⌃]/.test(t)), table.filter((t) => /[⌘⌥⌃]/.test(t)).join(' | '));
    check('Aide Windows : Ctrl+K, Ctrl+O, Ctrl+Z / Ctrl+Maj+Z', has('Ctrl+KRechercher') && has('Ctrl+OImporter') && has('Ctrl+Z / Ctrl+Maj+Z'), table.slice(0, 3).join(' | '));
    check('Aide Windows : signets Ctrl+Maj+↓ / Ctrl+Maj+↑', has('Ctrl+Maj+↓ / Ctrl+Maj+↑'));
    check('Aide Windows : Ctrl+F / Ctrl+H (remplacer)', has('Ctrl+F / Ctrl+H'));
    check('Aide Windows : note de bas de page Ctrl+Maj+N, note privée Ctrl+Maj+P', has('Ctrl+Maj+NNote de bas') && has('Ctrl+Maj+PNote privée'));
    check('Aide Windows : version Ctrl+Maj+S, barre latérale Ctrl+Maj+B, aide F1', has('Ctrl+Maj+SCréer') && has('Ctrl+Maj+BReplier') && has('F1Ouvrir'));
    check('Aide Windows : Alt+Maj+↑ / Alt+Maj+↓ (plan)', has('Alt+Maj+↑ / Alt+Maj+↓'));
    const helpText = await page.textContent('.help-page');
    check('Aide Windows : phrase « Sur Windows, les raccourcis ⌘ deviennent Ctrl »', /Sur Windows, les raccourcis ⌘ deviennent Ctrl/.test(helpText));
    check('Aide Windows : pas de « Finder » ni de « votre Mac »', !/Finder|votre Mac|ce Mac/.test(helpText));
    check('Aide Windows : rubriques Livres masquées (pas d’app Livres)', !/Depuis l’app Livres \(iCloud\)/.test(helpText));
    const helpKeys = await page.evaluate(() => [...document.querySelectorAll('.help-item .help-kbd')].map((k) => k.textContent));
    check('Aide Windows : touches des rubriques en Ctrl', helpKeys.includes('Ctrl+Maj+B') && helpKeys.includes('Ctrl+K') && !helpKeys.some((k) => /[⌘⌥⌃]/.test(k)), helpKeys.join(','));
    await shot(page, 'win-aide-clair.png');

    // Bibliothèque : pas de « Depuis Livres »
    await page.evaluate(() => window.__store.getState().navigate({ name: 'library' }));
    await sleep(400);
    check('Windows : « Depuis Livres » absent de la Bibliothèque', (await page.getByText('Depuis Livres').count()) === 0 && (await page.getByText('Récupérer mes livres').count()) === 0);

    // Lecteur : Ctrl+D ajoute un signet
    const bookId = await importFixture(page, 'fixtures/discours.epub', { open: true });
    await page.waitForSelector('.html-doc.is-revealed', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.reader-loading.overlay'), null, { timeout: 30000 });
    await sleep(600);
    const rt = await topbarReserve(page, '.reader-topbar');
    check('Windows : lecteur sans réserve à gauche (pas de pastilles Mac), réserve à droite', rt && rt.padLeft <= 20 && rt.pad >= 150 && rt.freeRight >= 140, rt);
    const bmTitle = await page.getAttribute('[data-testid="bookmark-toggle"]', 'title');
    check('Windows : bulle du signet « Ctrl+D »', /Ctrl\+D/.test(bmTitle), bmTitle);
    await page.evaluate(() => (document.querySelector('.html-scroll').scrollTop = 2600));
    await sleep(700);
    await page.click('.html-scroll', { position: { x: 30, y: 300 } });
    const n0 = await st(page, (id) => window.__store.getState().bookmarks.filter((b) => b.bookId === id).length, bookId);
    await page.keyboard.press('Control+KeyD');
    await page.waitForSelector('.bm-pop', { timeout: 5000 }).catch(() => {});
    const n1 = await st(page, (id) => window.__store.getState().bookmarks.filter((b) => b.bookId === id).length, bookId);
    check('Windows : Ctrl+D ajoute un signet', n1 === n0 + 1, `${n0} → ${n1}`);
    await shot(page, 'win-lecteur-clair.png');
    await page.keyboard.press('Enter');
    await sleep(300);
    await page.evaluate(() => (document.querySelector('.html-scroll').scrollTop = 6000));
    await sleep(700);
    await page.click('.html-scroll', { position: { x: 30, y: 300 } });
    await page.keyboard.press('Control+Alt+KeyD');
    await sleep(400);
    const n2 = await st(page, (id) => window.__store.getState().bookmarks.filter((b) => b.bookId === id).length, bookId);
    check('Windows : Ctrl+Alt+D (AltGr) n’ajoute rien', n2 === n1, `${n1} → ${n2}`);

    // Éditeur
    await openDraft(page, '<p>Premier paragraphe.</p><p>Deuxième paragraphe.</p><p>Troisième paragraphe @ ici.</p>');
    const edTitles = await page.evaluate(() => [...document.querySelectorAll('.ed-root [title]')].map((e) => e.getAttribute('title')).join(' | '));
    check('Éditeur Windows : bulles en Ctrl (Gras Ctrl+B, Annuler Ctrl+Z)', /Ctrl\+B/.test(edTitles) && /Ctrl\+Z/.test(edTitles), edTitles.slice(0, 200));
    check('Éditeur Windows : aucune bulle avec ⌘ ⌥ ⌃', !/[⌘⌥⌃]/.test(edTitles), (edTitles.match(/[^|]*[⌘⌥⌃][^|]*/g) || []).join(' | '));
    check('Éditeur Windows : versions « Ctrl+Maj+S », concentration « Ctrl+Maj+F »', /Ctrl\+Maj\+S/.test(edTitles) && /Ctrl\+Maj\+F/.test(edTitles));
    const saveKbd = await page.evaluate(() => [...document.querySelectorAll('.ed-root .kbd')].map((k) => k.textContent).join(','));
    check('Éditeur Windows : « Enregistrer Ctrl+S »', /Ctrl\+S/.test(saveKbd), saveKbd);
    const edRes = await topbarReserve(page, '.ed-topbar');
    check('Éditeur Windows : boutons de la barre du haut hors des boutons de fenêtre', edRes && edRes.freeRight >= 140, edRes);

    // Ctrl+Maj+1 : Titre 1 ; Ctrl+Alt+1 (AltGr) : rien
    await caret(page, 'Premier paragraphe');
    const s0 = await page.evaluate(() => window.__ed.engine().state().styleId);
    // AltGr+à sur un clavier français : Windows envoie Ctrl+Alt avec la touche « @ » (code Digit0).
    // Le raccourci « Corps » (Ctrl+Maj+0) ne doit pas l'intercepter. (Playwright ne sait pas produire
    // ce caractère avec Ctrl+Alt : événement synthétique envoyé au document.)
    const altGr = await page.evaluate(() => {
      const target = document.querySelector('.ed-engine [contenteditable="true"]') || document.activeElement;
      const ev = new KeyboardEvent('keydown', { key: '@', code: 'Digit0', ctrlKey: true, altKey: true, bubbles: true, cancelable: true });
      target.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    await sleep(300);
    const s1 = await page.evaluate(() => window.__ed.engine().state().styleId);
    check('Éditeur Windows : AltGr+à (« @ », Ctrl+Alt) ni intercepté ni changé en style', !altGr && s1 === s0, `${s0} → ${s1}, preventDefault=${altGr}`);
    await page.keyboard.press('Control+Shift+Digit1');
    await sleep(500);
    const s2 = await page.evaluate(() => window.__ed.engine().state().styleId);
    check('Éditeur Windows : Ctrl+Maj+1 → Titre 1', s2 !== s0 && /1/.test(String(s2)), `${s0} → ${s2}`);
    await page.keyboard.press('Control+Shift+Digit0');
    await sleep(500);
    const s3 = await page.evaluate(() => window.__ed.engine().state().styleId);
    check('Éditeur Windows : Ctrl+Maj+0 → Corps', s3 === s0, `${s2} → ${s3}`);

    // Ctrl+Maj+P : note privée
    await caret(page, 'Deuxième paragraphe.');
    const p0 = await page.evaluate(() => window.__ed.engine().privateNoteCount());
    await page.keyboard.press('Control+Shift+KeyP');
    await sleep(400);
    const p1 = await page.evaluate(() => window.__ed.engine().privateNoteCount());
    check('Éditeur Windows : Ctrl+Maj+P insère une note privée', p1 === p0 + 1, `${p0} → ${p1}`);
    await page.keyboard.press('Control+z');
    await sleep(300);

    // Ctrl+F : rechercher ; Ctrl+H : remplacer
    await caret(page, 'Troisième');
    await page.keyboard.press('Control+KeyF');
    await sleep(400);
    check('Éditeur Windows : Ctrl+F ouvre « Rechercher »', (await page.locator('.ed-find').count()) === 1);
    await page.keyboard.press('Escape');
    await sleep(200);
    await caret(page, 'Troisième');
    await page.keyboard.press('Control+KeyH');
    await sleep(400);
    check('Éditeur Windows : Ctrl+H ouvre « Remplacer »', (await page.locator('.ed-find').count()) === 1 && (await page.locator('.ed-find-chev.open').count()) === 1);
    const findTitle = await page.getAttribute('.ed-find-chev', 'title');
    check('Éditeur Windows : bulle « (Ctrl+H) »', /Ctrl\+H/.test(findTitle || ''), findTitle);
    await page.keyboard.press('Escape');
    await sleep(200);

    // Ctrl+Maj+S : créer une version
    await page.keyboard.press('Control+Shift+KeyS');
    check('Éditeur Windows : Ctrl+Maj+S ouvre « Créer une version »', await page.waitForSelector('.ed-versions #ver-name', { timeout: 5000 }).then(() => true, () => false));
    await shot(page, 'win-editeur-clair.png');
    await page.keyboard.press('Escape');

    // Images : vraie HEIC et TIFF par le décodeur embarqué
    for (const [file, label] of [haveHeic ? [HEIC, 'HEIC'] : null, [TIFF, 'TIFF']].filter(Boolean)) {
      const id = await importFixture(page, path.relative(ROOT, file), { open: true });
      const okImg = await page
        .waitForFunction(() => {
          const img = document.querySelector('img.img-picture');
          return img && img.naturalWidth > 100 ? img.naturalWidth : false;
        }, null, { timeout: 60000 })
        .then((h) => h.jsonValue())
        .catch(() => 0);
      const err = await page.locator('.empty, [role="alert"]').first().textContent().catch(() => '');
      check(`Image ${label} : affichée après conversion JS (largeur ${okImg})`, okImg >= 1000, err || '');
      const cover = await st(page, (id) => !!window.__store.getState().books.find((b) => b.id === id)?.cover, id);
      check(`Image ${label} : miniature de couverture`, cover);
      if (label === 'HEIC') await shot(page, 'win-heic.png');
    }
    await ctx.close();
  }

  // Windows sombre : captures
  {
    const { ctx, page } = await open('?platform=win', { dark: true });
    await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
    await sleep(300);
    await shot(page, 'win-accueil-sombre.png');
    await page.evaluate(() => window.__store.getState().navigate({ name: 'help' }));
    await sleep(400);
    await shot(page, 'win-aide-sombre.png');
    await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));
    await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
    await sleep(300);
    await shot(page, 'win-accueil-clair.png');
    await ctx.close();
  }

  // ═══════════════════ Mac (comportement inchangé) ═══════════════════
  {
    const { ctx, page } = await open('');
    check('Mac : classe platform-mac', await page.evaluate(() => document.documentElement.classList.contains('platform-mac')));
    check('Mac : barre latérale « ⌘K »', (await page.textContent('.sidebar .nav-item .kbd')) === '⌘K');
    check('Mac : bulle « ⌃⌘S »', /\(⌃⌘S\)/.test(await page.getAttribute('.sidebar-toggle', 'title')));
    const res = await topbarReserve(page);
    check('Mac : aucune réserve à droite (padding 24 px max)', res && res.pad <= 24, res);
    check('Mac : aucune zone -webkit-app-region', (await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).getPropertyValue('-webkit-app-region').trim() === 'drag').length)) === 0);
    await page.mouse.click(700, 400);
    await page.keyboard.press('Meta+KeyK');
    await sleep(200);
    check('Mac : ⌘K ouvre la recherche', await st(page, () => window.__store.getState().commandOpen));
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__store.getState().setCommandOpen(false));
    const c0 = await st(page, () => !!window.__store.getState().settings.sidebarCollapsed);
    await page.keyboard.press('Control+Meta+KeyS');
    await sleep(200);
    check('Mac : ⌃⌘S replie la barre latérale', (await st(page, () => !!window.__store.getState().settings.sidebarCollapsed)) === !c0);
    await page.keyboard.press('Control+Meta+KeyS');
    await page.evaluate(() => window.__store.getState().navigate({ name: 'help' }));
    await sleep(400);
    const table = await page.evaluate(() => [...document.querySelectorAll('.help-table tr')].map((tr) => tr.textContent));
    check('Aide Mac : ⌘K, ⌘⌥F, ⌘⌥N, ⌃⌘S, ⌘?', ['⌘KRechercher', '⌘⌥FNote', '⌘⌥NNote privée', '⌃⌘SReplier', '⌘?Ouvrir'].every((k) => table.some((t) => t.includes(k))), table.join(' | ').slice(0, 300));
    check('Aide Mac : aucun « Ctrl+ »', !table.some((t) => /Ctrl\+/.test(t)));
    const bookId = await importFixture(page, 'fixtures/discours.epub', { open: true });
    await page.waitForSelector('.html-doc.is-revealed', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.reader-loading.overlay'), null, { timeout: 30000 });
    await sleep(600);
    const rt = await topbarReserve(page, '.reader-topbar');
    check('Mac : lecteur garde 84 px à gauche pour les pastilles', rt && rt.padLeft === 84, rt);
    await page.evaluate(() => (document.querySelector('.html-scroll').scrollTop = 2600));
    await sleep(700);
    await page.click('.html-scroll', { position: { x: 30, y: 300 } });
    await page.keyboard.press('Meta+KeyD');
    await page.waitForSelector('.bm-pop', { timeout: 5000 }).catch(() => {});
    await page.keyboard.press('Enter');
    const n = await st(page, (id) => window.__store.getState().bookmarks.filter((b) => b.bookId === id).length, bookId);
    check('Mac : ⌘D ajoute un signet', n === 1, n);
    await openDraft(page, '<p>Premier paragraphe.</p>');
    const edTitles = await page.evaluate(() => [...document.querySelectorAll('.ed-root [title]')].map((e) => e.getAttribute('title')).join(' | '));
    check('Éditeur Mac : bulles en ⌘ (⌘B, ⌘⌥S)', /⌘B/.test(edTitles) && /⌘⌥S/.test(edTitles) && !/Ctrl\+/.test(edTitles));
    await caret(page, 'Premier');
    await page.keyboard.press('Meta+Alt+Digit1');
    await sleep(500);
    check('Éditeur Mac : ⌘⌥1 → Titre 1', /1/.test(String(await page.evaluate(() => window.__ed.engine().state().styleId))));
    await page.keyboard.press('Meta+KeyF');
    await sleep(300);
    check('Éditeur Mac : ⌘F ouvre « Rechercher »', (await page.locator('.ed-find').count()) === 1);
    await ctx.close();
  }
} finally {
  const real = errors.filter((e) => !/favicon|ResizeObserver/.test(e));
  if (real.length) console.log('ERREURS NAVIGATEUR :\n' + real.join('\n'));
  await browser.close();
  await server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} échec(s)` : '\nTout est OK');
process.exit(failed ? 1 : 0);
