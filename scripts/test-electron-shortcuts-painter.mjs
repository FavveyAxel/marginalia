// Raccourcis du pinceau de mise en forme dans l'app Electron réelle : ⌥⌘C / ⌥⌘V (Mac),
// Ctrl+Maj+C / Ctrl+Maj+V (Windows, Linux).
//   1. Build (dist/, app://) : menu Édition (« Copier / Coller la mise en forme », « Coller sans le style »
//      déplacé à Ctrl+Maj+Alt+V), aucun autre accélérateur sur ces combinaisons, branche macOS du gabarit ;
//      touches natives (webContents.sendInputEvent : avant-saisie, la page, puis le menu si la page ne les
//      a pas consommées) : la page les reçoit ; non consommées, le menu les relaie (une seule fois) ;
//      consommées (preventDefault), le menu se tait.
//   2. Serveur Vite (window.__ed) : dans le texte, Ctrl+Maj+C / V appellent copyFormat / applyFormat une
//      seule fois (pas de doublon par le menu) ; focus hors du texte, le menu relaie au pinceau ; clic sur
//      les éléments du menu.
// Lancer : npx vite build && DISPLAY=:99 timeout 300 node scripts/test-electron-shortcuts-painter.mjs
import { _electron as electron } from 'playwright-core';
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron');
const ok = (c, m, extra) => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== undefined ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const norm = (a) => (a || '').replace(/CommandOrControl|CmdOrCtrl/g, 'Ctrl').split('+').map((p) => p.trim().toLowerCase()).sort().join('+');

/** Touche native : keyDown (+ char) + keyUp, comme le clavier (avant-saisie → page → menu). */
const press = (app, keyCode, modifiers) =>
  app.evaluate(({ BrowserWindow }, [k, m]) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m });
  }, [keyCode, modifiers]);

async function launch(env) {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-painter-keys-'));
  return electron.launch({
    executablePath: EXE,
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, HOME: TMP, XDG_CONFIG_HOME: path.join(TMP, '.config'), MARGINALIA_E2E: '1', ...env },
    timeout: 60000,
  });
}

// ── 1. Build ─────────────────────────────────────────────────
if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
  console.error('dist/ absent : lancer « npx vite build » d’abord.');
  process.exit(1);
}
{
  const app = await launch({ VITE_DEV_SERVER_URL: '' });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });

    // Menus : accélérateurs effectifs (rôles compris) de toute la barre de menus.
    const items = await app.evaluate(({ Menu }) => {
      const out = [];
      const walk = (menu, top) => {
        for (const i of menu.items) {
          const acc = i.accelerator || (i.role && typeof i.getDefaultRoleAccelerator === 'function' ? i.getDefaultRoleAccelerator() : null);
          out.push({ top, label: i.label, role: i.role || null, id: i.id || null, accelerator: acc || null, explicit: !!i.accelerator, register: i.registerAccelerator !== false });
          if (i.submenu) walk(i.submenu, top || i.label);
        }
      };
      walk(Menu.getApplicationMenu(), null);
      return out;
    });
    const edit = items.filter((i) => i.top === 'Édition');
    const copyF = edit.find((i) => i.label === 'Copier la mise en forme');
    const pasteF = edit.find((i) => i.label === 'Coller la mise en forme');
    const plain = edit.find((i) => i.label === 'Coller sans le style');
    ok(copyF && norm(copyF.accelerator) === norm('Ctrl+Shift+C') && copyF.register, 'Édition › Copier la mise en forme : Ctrl+Maj+C (actif)', copyF);
    ok(pasteF && norm(pasteF.accelerator) === norm('Ctrl+Shift+V') && pasteF.register, 'Édition › Coller la mise en forme : Ctrl+Maj+V (actif)', pasteF);
    ok(plain && norm(plain.accelerator) === norm('Ctrl+Shift+Alt+V') && plain.register, 'Édition › Coller sans le style : Ctrl+Maj+Alt+V (plus Ctrl+Maj+V)', plain);
    for (const combo of ['Ctrl+Shift+C', 'Ctrl+Shift+V']) {
      const users = items.filter((i) => i.accelerator && norm(i.accelerator) === norm(combo)).map((i) => i.label);
      ok(users.length === 1, `un seul élément de menu sur ${combo}`, users);
    }

    // Branche macOS du gabarit (construite depuis Linux) : ⌥⌘C / ⌥⌘V, ⌥⇧⌘V pour « Coller sans le style ».
    const mac = await app.evaluate(({ Menu }) => {
      const tpl = globalThis.__marginaliaEditMenuTemplate('darwin');
      const m = Menu.buildFromTemplate([tpl]).items[0].submenu.items;
      return m.map((i) => ({ label: i.label, role: i.role || null, accelerator: i.accelerator || (i.role && i.getDefaultRoleAccelerator ? i.getDefaultRoleAccelerator() : null) || null }));
    });
    const macNorm = (a) => norm((a || '').replace(/CommandOrControl|CmdOrCtrl|\bCmd\b/g, 'Command'));
    const macAcc = (label) => macNorm(mac.find((i) => i.label === label)?.accelerator);
    ok(macAcc('Copier la mise en forme') === norm('Alt+Command+C'), 'macOS : Copier la mise en forme ⌥⌘C', mac.find((i) => i.label === 'Copier la mise en forme'));
    ok(macAcc('Coller la mise en forme') === norm('Alt+Command+V'), 'macOS : Coller la mise en forme ⌥⌘V');
    ok(macAcc('Coller sans le style') === norm('Alt+Shift+Command+V'), 'macOS : Coller sans le style ⌥⇧⌘V (inchangé, sans conflit)');
    ok(macAcc('Copier') === norm('Command+C') && macAcc('Coller') === norm('Command+V'), 'macOS : Copier ⌘C, Coller ⌘V (pas de ⌥)');
    for (const combo of ['Alt+Command+C', 'Alt+Command+V'])
      ok(mac.filter((i) => i.accelerator && macNorm(i.accelerator) === norm(combo)).length === 1, `macOS : un seul élément sur ${combo}`);

    // Touches natives : la page les reçoit ; non consommées, le menu les relaie au pinceau.
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'probe';
      d.contentEditable = 'true';
      d.textContent = 'Texte de sonde';
      d.style.cssText = 'position:fixed;top:200px;left:200px;width:300px;height:60px;z-index:99999;background:#fff';
      document.body.appendChild(d);
      window.__keys = [];
      window.__relay = [];
      window.__consume = false;
      window.addEventListener(
        'keydown',
        (e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          window.__keys.push({ code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
          if (window.__consume) e.preventDefault();
        },
        true,
      );
      window.addEventListener('marginalia:format-painter', (e) => window.__relay.push(e.detail));
      d.focus();
    });
    const reset = (consume) => page.evaluate((c) => ((window.__keys = []), (window.__relay = []), (window.__consume = c), document.getElementById('probe').focus()), consume);
    const state = () => page.evaluate(() => ({ keys: window.__keys, relay: window.__relay }));

    await reset(false);
    await press(app, 'C', ['control', 'shift']);
    await press(app, 'V', ['control', 'shift']);
    await page.waitForTimeout(400);
    let s = await state();
    ok(s.keys.some((k) => k.code === 'KeyC' && k.ctrl && k.shift && !k.alt) && s.keys.some((k) => k.code === 'KeyV' && k.ctrl && k.shift && !k.alt), 'la page reçoit Ctrl+Maj+C et Ctrl+Maj+V (rien ne les intercepte avant)', s.keys);
    // Hors du document de l'éditeur et non consommé : Ctrl+Maj+V est le « coller en texte brut » de
    // Chromium dans un champ (la page le traite) ; Ctrl+Maj+C n'a pas d'action par défaut → relais du menu.
    ok(JSON.stringify(s.relay) === JSON.stringify(['copy']), 'non consommé : le menu relaie Ctrl+Maj+C au pinceau (une fois) ; Ctrl+Maj+V reste au champ', s.relay);

    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.evaluate(() => ((window.__keys = []), (window.__relay = []), (window.__consume = false)));
    await press(app, 'V', ['control', 'shift']);
    await page.waitForTimeout(400);
    s = await state();
    ok(JSON.stringify(s.relay) === JSON.stringify(['paste']), 'hors champ, non consommé : le menu relaie Ctrl+Maj+V au pinceau', s.relay);

    await reset(true);
    await press(app, 'C', ['control', 'shift']);
    await press(app, 'V', ['control', 'shift']);
    await page.waitForTimeout(400);
    s = await state();
    ok(s.keys.length === 2 && s.relay.length === 0, 'consommé par la page (preventDefault) : le menu ne se déclenche pas (pas de doublon)', s);

    await reset(false);
    await press(app, 'V', ['control', 'shift', 'alt']);
    await page.waitForTimeout(300);
    s = await state();
    ok(s.keys.some((k) => k.code === 'KeyV' && k.ctrl && k.shift && k.alt) && s.relay.length === 0, 'Ctrl+Maj+Alt+V atteint la page et ne déclenche pas le pinceau', s);

    // Clic sur les éléments du menu → pinceau.
    await reset(false);
    await app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu().getMenuItemById('copy-format').click();
      Menu.getApplicationMenu().getMenuItemById('paste-format').click();
    });
    await page.waitForTimeout(300);
    s = await state();
    ok(JSON.stringify(s.relay) === JSON.stringify(['copy', 'paste']), 'clic sur Édition › Copier / Coller la mise en forme → pinceau', s.relay);
  } finally {
    await app.close();
  }
}

// ── 2. Éditeur réel (serveur Vite, window.__ed) ──────────────
{
  const PORT = 5383;
  const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
  await server.listen();
  const app = await launch({ VITE_DEV_SERVER_URL: `http://localhost:${PORT}/` });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    const d = await page.evaluate(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Pinceau', html: '<p><strong>Gras</strong> puis un mot ordinaire ici.</p>' }));
    await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), d.id);
    await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 90000 });
    await page.waitForTimeout(800);
    // Espions sur le moteur : on compte les appels (la logique du pinceau est testée ailleurs).
    await page.evaluate(() => {
      const e = window.__ed.engine();
      window.__calls = { copy: 0, apply: 0 };
      const c = e.copyFormat.bind(e);
      const a = e.applyFormat.bind(e);
      e.copyFormat = (...x) => (window.__calls.copy++, c(...x));
      e.applyFormat = (...x) => (window.__calls.apply++, a(...x));
    });
    const calls = () => page.evaluate(() => ({ ...window.__calls }));
    const zero = () => page.evaluate(() => (window.__calls = { copy: 0, apply: 0 }));
    // Curseur dans « Gras »
    // (SuperDoc : le texte affiché est une mise en page ; la saisie passe par un ProseMirror caché.)
    const box = await page.evaluate(() => {
      const w = [...document.querySelectorAll('.ed-engine-in *')].find((n) => n.childElementCount === 0 && /Gras/.test(n.textContent) && !n.closest('.ProseMirror') && n.getBoundingClientRect().width > 0);
      const r = w.getBoundingClientRect();
      return { x: r.left + 6, y: r.top + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(200);
    const inDoc = await page.evaluate(() => !!document.activeElement?.closest?.('.ProseMirror'));
    ok(inDoc, 'focus dans le texte de l’éditeur');
    await zero();
    await press(app, 'C', ['control', 'shift']);
    await page.waitForTimeout(400);
    ok((await calls()).copy === 1, 'Ctrl+Maj+C dans le texte : copyFormat une seule fois (page, pas de doublon du menu)', await calls());
    await press(app, 'V', ['control', 'shift']);
    await page.waitForTimeout(400);
    ok((await calls()).apply === 1, 'Ctrl+Maj+V dans le texte : applyFormat une seule fois', await calls());

    // Focus hors du texte (titre) : le menu relaie au pinceau. (Après applyFormat, la mise en page se
    // recalcule et le pinceau est momentanément désactivé : on laisse passer ce temps.)
    await page.waitForTimeout(1500);
    await page.focus('.ed-title-input');
    await zero();
    await press(app, 'C', ['control', 'shift']);
    await page.waitForTimeout(400);
    ok((await calls()).copy === 1, 'focus dans le titre : Ctrl+Maj+C relayé par le menu → copyFormat', await calls());

    await zero();
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('copy-format').click());
    await page.waitForTimeout(300);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('paste-format').click());
    await page.waitForTimeout(300);
    const c = await calls();
    ok(c.copy === 1 && c.apply === 1, 'menu Édition › Copier / Coller la mise en forme → copyFormat / applyFormat', c);
  } finally {
    await app.close();
    await server.close();
  }
}
