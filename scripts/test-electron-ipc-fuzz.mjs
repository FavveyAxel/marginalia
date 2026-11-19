// Interface compromise : chaque fonction exposée à la page est appelée avec des arguments hostiles.
// Vérifie : le processus principal ne tombe pas, rien n'est écrit/lu/effacé hors des données de l'app.
// Prérequis : npx vite build ; Xvfb. Lancer : xvfb-run -a node scripts/test-electron-ipc-fuzz.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os'; import crypto from 'node:crypto';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-ipc-')); const UD = path.join(home, 'donnees');
const outside = path.join(home, 'dehors'); fs.mkdirSync(outside);
const CANARY = path.join(outside, 'canari.txt'); const CANARY_TXT = 'CANARI-' + crypto.randomBytes(8).toString('hex');
fs.writeFileSync(CANARY, CANARY_TXT);
fs.writeFileSync(path.join(outside, 'canari.docx'), CANARY_TXT);
const snap = (dir) => { const o = {}; const w = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) w(f); else if (e.isFile()) o[f] = fs.statSync(f).size + ':' + fs.statSync(f).mtimeMs; } }; w(dir); return o; };
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', ROOT], env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: UD, VITE_DEV_SERVER_URL: '', MARGINALIA_E2E_FAKE_SAFESTORAGE: '1' }, timeout: 120000 });
let mainGone = false; app.process().on('exit', () => (mainGone = true));
const page = await app.firstWindow(); let last=''; page.on('console', (m) => { const t = m.text(); if (t.startsWith('FZ ')) last = t; }); let done = false; page.on('close', () => { if (!done) console.log('PAGE FERMÉE après', last); }); page.on('crash', () => console.log('PAGE PLANTÉE après', last)); app.process().on('exit', (c, sig) => { if (!done) console.log('PRINCIPAL TERMINÉ', c, sig, 'après', last); });
let fails = 0; const ok = (c, m, x = '') => { console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (x ? ' — ' + x : '')); if (!c) fails++; };
try {
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__store.getState().updateSettings({ tourDone: true, mascot: 'off' }));
  await page.evaluate(async () => { const s = window.__store.getState(); await s.importFiles([{ name: 'Note.md', data: new TextEncoder().encode('# Note\n\ncontenu\n').buffer }]); s.updateSettings({}); });
  await new Promise((r) => setTimeout(r, 1200));
  const outsideBefore = snap(outside); const tmpBefore = new Set(fs.readdirSync(os.tmpdir())); const rootBefore = new Set(fs.readdirSync(home));
  const res = await page.evaluate(async ({ canary, outside, canaryTxt }) => {
    const SKIP = /^(relaunch|pickFiles|pickFolder|openDocx|saveText|saveBinary|popupMenu|printDocument|loadDb)$|update\.(install|download)|diskAccess\.(openSettings|revealApp|relaunch)|inbox\.(choose|reveal|enable)|spaces\.|security\.|^on[A-Z]|\.on[A-Z]|wifiStart|hostStart|sendStart|collab\.(find|join|internet)|share\.find|paper\.|video\./;
    const trav = ['../../../../../../../../' + canary.slice(1), canary, '..', '.', '', '\0', 'a\0b', '../' + 'x', '..\\..\\x', 'C:\\Windows\\win.ini', '/etc/passwd', 'file:///etc/passwd', '%2e%2e%2f', 'con', 'a'.repeat(5000), '__proto__', 'constructor', outside + '/canari.docx', outside + '/nouveau.docx', 'library/../../x', '....//....//x'];
    const vals = [undefined, null, 0, -1, NaN, 1e308, true, {}, [], { __proto__: { polluted: 1 } }, { toString: null }, new ArrayBuffer(8), new Uint8Array(0), 'x'.repeat(1 << 20), [[[[[[[[[[]]]]]]]]]], new Date(), /x/, 123n, Symbol.iterator, () => 1];
    const fns = []; const walk = (o, p) => { for (const k of Object.keys(o)) { const v = o[k]; const n = p ? p + '.' + k : k; if (typeof v === 'function') fns.push([n, v]); else if (v && typeof v === 'object') walk(v, n); } };
    walk(window.marginalia, '');
    const leaks = []; const log = []; let calls = 0;
    const call = async (name, fn, args) => {
      calls++; console.log('FZ ' + name + ' ' + args.map((a) => { try { return typeof a === 'string' ? JSON.stringify(a.slice(0, 50)) : Object.prototype.toString.call(a); } catch { return '?'; } }).join(', '));
      try {
        const r = await Promise.race([Promise.resolve().then(() => fn(...args)), new Promise((res) => setTimeout(() => res('__timeout__'), 4000))]);
        let txt = '';
        try { txt = r instanceof ArrayBuffer ? new TextDecoder('latin1').decode(r) : ArrayBuffer.isView(r) ? new TextDecoder('latin1').decode(r) : JSON.stringify(r, (k, v) => (v instanceof ArrayBuffer ? new TextDecoder('latin1').decode(v) : ArrayBuffer.isView(v) ? new TextDecoder('latin1').decode(v) : v)) || ''; } catch {}
        if (txt.includes(canaryTxt) || /root:.*:0:0:/.test(txt)) leaks.push(name + ' ' + JSON.stringify(args.map((a) => String(a).slice(0, 60))));
        if (r === '__timeout__') log.push('délai ' + name);
      } catch (e) { const m = String(e && e.message || e); if (m.includes(canaryTxt) || /root:.*:0:0:/.test(m)) leaks.push('ERR ' + name); }
    };
    const run = [];
    for (const [name, fn] of fns) {
      if (SKIP.test(name)) continue;
      run.push(name);
      for (const t of trav) { await call(name, fn, [t]); await call(name, fn, [t, t]); await call(name, fn, ['id1', t]); await call(name, fn, [t, 'f.txt', new ArrayBuffer(4)]); await call(name, fn, ['id1', t, new ArrayBuffer(4)]); await call(name, fn, [t, new TextEncoder().encode('PIRATE').buffer]); }
      for (const v of vals) { try { await call(name, fn, [v]); await call(name, fn, [v, v, v]); await call(name, fn, ['id1', v, v]); } catch {} }
    }
    return { run, skipped: fns.map((f) => f[0]).filter((n) => SKIP.test(n)), leaks, log: [...new Set(log)], calls, polluted: ({}).polluted };
  }, { canary: CANARY, outside, canaryTxt: CANARY_TXT });
  console.log(`${res.calls} appels hostiles sur ${res.run.length} fonctions ; non appelées (dialogue, réseau, redémarrage, testées ailleurs) : ${res.skipped.length}`);
  console.log('fonctions :', res.run.join(', '));
  if (res.log.length) console.log('délais :', res.log.join(' ; '));
  await new Promise((r) => setTimeout(r, 1500));
  ok(!mainGone, 'le processus principal est toujours vivant');
  ok(res.leaks.length === 0, 'aucune lecture de fichier hors de l’app', res.leaks.slice(0, 5).join(' | '));
  const after = snap(outside);
  ok(JSON.stringify(after) === JSON.stringify(outsideBefore) && fs.readFileSync(CANARY, 'utf8') === CANARY_TXT, 'dossier voisin : rien créé, modifié ni effacé', Object.keys(after).filter((k) => after[k] !== outsideBefore[k]).concat(Object.keys(outsideBefore).filter((k) => !(k in after))).join(', '));
  const newTmp = fs.readdirSync(os.tmpdir()).filter((n) => !tmpBefore.has(n)); const newRoot = fs.readdirSync(home).filter((n) => !rootBefore.has(n));
  ok(newRoot.length === 0, 'rien créé à côté du dossier de données', newRoot.join(', '));
  console.log('   nouveaux dans /tmp :', newTmp.join(', ') || '(rien)');
  const odd = Object.keys(snap(UD)).map((f) => path.relative(UD, f)).filter((f) => /PIRATE|\.\.|passwd|win\.ini|canari/.test(f)); 
  ok(odd.length === 0, 'aucun fichier au nom suspect dans les données', odd.join(', '));
  const alive = await page.evaluate(async () => { const t = await window.marginalia.loadDb(); return !!t; }).catch((e) => String(e));
  ok(alive === true, 'l’app répond encore et la base se relit', String(alive));
  let db = null; try { db = JSON.parse(fs.readFileSync(path.join(UD, 'db.json'), 'utf8')); } catch (e) { db = String(e); }
  console.log('   db.json après :', typeof db === 'string' ? db : `version ${db.version}, écrits ${db.drafts?.length}, clés ${Object.keys(db).length}`);
  console.log('   bibliothèque :', Object.keys(snap(path.join(UD, 'library'))).map((f) => path.relative(UD, f)).slice(0, 30).join(' ; '));
} catch (e) { console.log('EXCEPTION', e.stack || e); fails++; } finally { done = true; await app.close().catch(() => {}); fs.rmSync(home, { recursive: true, force: true }); console.log(fails ? `${fails} échec(s)` : 'tout est passé'); if (fails) process.exitCode = 1; }
