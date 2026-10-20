import { _electron as electron } from 'playwright-core';
import { createServer } from 'vite';
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5451;
const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true, hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-bs-'));
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env: { ...process.env, XDG_CONFIG_HOME: TMP, VITE_DEV_SERVER_URL: `http://localhost:${PORT}/` }, timeout: 60000 });
const page = await app.firstWindow();
await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
await page.evaluate(async () => {
  const d = await (await import('/src/features/editor/api.ts')).createDraft({ title: 'Essai' });
  window.__store.getState().navigate({ name: 'write', draftId: d.id });
});
await page.waitForFunction(() => document.querySelectorAll('.ed-engine-in .superdoc-page').length >= 1 && window.__ed, null, { timeout: 60000 });
await page.waitForTimeout(2500);
const pg = await page.evaluate(() => { const b = document.querySelector('.ed-engine-in .superdoc-page').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 160 }; });
await page.mouse.click(pg.x, pg.y);

const ok = (c, m, x = '') => { console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (x !== '' ? ' — ' + (typeof x === 'string' ? x : JSON.stringify(x)) : '')); if (!c) process.exitCode = 1; };
const shape = () => page.evaluate(() => {
  const st = window.__ed.engine().debugEditor().editor.state;
  const out = [];
  st.doc.forEach((p) => { let t = ''; p.descendants((c) => { if (c.isText) t += c.text; else if (c.type.name === 'lineBreak') t += '↵'; }); out.push(t); });
  return out;
});
const fresh = async (keys) => {
  await page.evaluate(() => { const ed = window.__ed.engine().debugEditor().editor; ed.view.dispatch(ed.state.tr.delete(1, ed.state.doc.content.size - 1)); });
  await page.waitForTimeout(150);
  for (const k of keys) { if (k.startsWith('#')) await page.keyboard.press(k.slice(1)); else await page.keyboard.type(k); }
  await page.waitForTimeout(250);
};
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

// 1. Ligne vide entre deux textes, Retour arrière au début du second
await fresh(['Jurer, sinon pourquoi jurer', '#Shift+Enter', '#Enter', 'Lorsque petit', '#Home']);
ok(JSON.stringify(await shape()) === JSON.stringify(['Jurer, sinon pourquoi jurer↵', 'Lorsque petit']), 'départ : texte ↵, ligne vide, texte', await shape());
await page.keyboard.press('Backspace');
await page.waitForTimeout(250);
ok(JSON.stringify(await shape()) === JSON.stringify(['Jurer, sinon pourquoi jurer↵Lorsque petit']), 'Retour arrière : la ligne vide disparaît (texte intact)', await shape());
await page.keyboard.press('Backspace');
await page.waitForTimeout(250);
ok(JSON.stringify(await shape()) === JSON.stringify(['Jurer, sinon pourquoi jurerLorsque petit']), 'Retour arrière suivant : le ↵ est effacé, pas le « r » de « jurer »', await shape());
await page.keyboard.press(`${mod}+z`);
await page.waitForTimeout(300);
ok((await shape()).join('|').includes('jurer↵Lorsque'), '⌘Z : le ↵ revient', await shape());

// 2. Curseur sur la ligne vide qui suit un ↵ en fin de paragraphe
await fresh(['Devant soi-même', '#Shift+Enter']);
await page.keyboard.press('Backspace');
await page.waitForTimeout(250);
ok(JSON.stringify(await shape()) === JSON.stringify(['Devant soi-même']), 'ligne vide après un ↵ en fin de paragraphe : le ↵ est effacé, le texte reste', await shape());

// 3. Suppr juste avant un ↵
await fresh(['Avant', '#Shift+Enter', 'Après', '#Home', '#ArrowUp', '#End']);
await page.keyboard.press('Delete');
await page.waitForTimeout(250);
ok(JSON.stringify(await shape()) === JSON.stringify(['AvantAprès']), 'Suppr juste avant un ↵ : le ↵ est effacé', await shape());

// 4. Retour arrière ordinaire
await fresh(['Promesse']);
await page.keyboard.press('Backspace');
await page.waitForTimeout(250);
ok(JSON.stringify(await shape()) === JSON.stringify(['Promess']), 'Retour arrière dans un mot : une lettre, comme avant', await shape());

// 5. Centrer une partie d'un paragraphe découpé de ↵ : seule la sélection est centrée
await fresh(['promesse faite sous serment.', '#Shift+Enter', 'Étymologie : du latin perjurium.', '#Shift+Enter', 'Littéralement : jurer à faux.', '#Shift+Enter', '#Shift+Enter', 'Je vais commencer par le serment.']);
const aligned = () => page.evaluate(() => {
  const st = window.__ed.engine().debugEditor().editor.state;
  const out = [];
  st.doc.forEach((p) => {
    let t = '';
    p.descendants((c) => { if (c.isText) t += c.text; else if (c.type.name === 'lineBreak') t += '↵'; });
    // espaces insécables (typographie française automatique) comptées comme des espaces
    out.push([t.replace(/[\u00a0\u202f]/g, ' '), /"center"/.test(JSON.stringify(p.attrs)) ? 'centré' : 'gauche']);
  });
  return out;
});
await page.evaluate(() => {
  const ed = window.__ed.engine().debugEditor().editor;
  let a = -1, z = -1;
  ed.state.doc.descendants((n, pos) => { if (n.isText) { const i = n.text.indexOf('Étymologie'); if (i >= 0) a = pos + i; const j = n.text.indexOf('à faux.'); if (j >= 0) z = pos + j + 'à faux.'.length; } });
  ed.commands.setTextSelection({ from: a, to: z });
});
await page.evaluate(() => window.__ed.engine().setAlign('center'));
await page.waitForTimeout(400);
const al = await aligned();
ok(JSON.stringify(al) === JSON.stringify([['promesse faite sous serment.', 'gauche'], ['Étymologie : du latin perjurium.↵Littéralement : jurer à faux.', 'centré'], ['↵Je vais commencer par le serment.', 'gauche']]), 'centrer une partie : seules les lignes sélectionnées sont centrées, le reste reste à gauche, texte intact', al);
const selText = await page.evaluate(() => { const st = window.__ed.engine().debugEditor().editor.state; return st.doc.textBetween(st.selection.from, st.selection.to, '|', '↵'); });
ok(selText.startsWith('Étymologie') && selText.replace(/[\u00a0\u202f]/g, ' ').endsWith('à faux.'), 'la sélection reste sur le texte choisi', selText);
// sans ↵ autour : alignement du paragraphe, comme avant
await fresh(['Un seul paragraphe.']);
await page.evaluate(() => window.__ed.engine().setAlign('center'));
await page.waitForTimeout(300);
ok(JSON.stringify(await aligned()) === JSON.stringify([['Un seul paragraphe.', 'centré']]), 'paragraphe sans ↵ : centré entier, comme avant', await aligned());

console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
await app.close(); await server.close(); process.exit(process.exitCode || 0);
