import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
const ROOT = '/home/claude/marginalia/.claude/worktrees/collab';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-spike-'));
const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', ROOT],
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home, MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: path.join(home, 'donnees'), VITE_DEV_SERVER_URL: '' },
  timeout: 60000,
});
const page = await app.firstWindow();
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
const asset = fs.readdirSync(path.join(ROOT, 'dist/assets')).find((f) => /^superdoc\.min-.*\.js$/.test(f));
const res = await page.evaluate(async (asset) => {
  await new Promise((r, j) => { const s = document.createElement('script'); s.src = './assets/' + asset; s.onload = r; s.onerror = j; document.head.appendChild(s); });
  const SD = window.SuperDoc;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px;overflow:hidden';
  document.body.appendChild(host);
  class ProbeWS { constructor() { this.readyState = 0; this.OPEN = 1; } send() {} close() {} }
  const realWS = window.WebSocket;
  const warn = console.warn;
  let sd;
  window.WebSocket = ProbeWS;
  console.warn = () => {};
  try {
    sd = new SD({ selector: host, documents: [{ id: 'probe', type: 'docx', name: 'p.docx' }], modules: { comments: false, collaboration: { providerType: 'superdoc', url: 'ws://mg.invalid' } }, telemetry: { enabled: false } });
  } finally {
    window.WebSocket = realWS;
    console.warn = warn;
  }
  const out = { hasProvider: !!sd.provider, hasYdoc: !!sd.ydoc };
  const Provider = sd.provider.constructor;
  const Doc = sd.ydoc.constructor;
  const Awareness = sd.provider.awareness.constructor;
  try { sd.provider.destroy(); } catch (e) { out.e1 = String(e); }
  try { sd.destroy(); } catch (e) { out.e2 = String(e); }
  host.remove();
  out.names = [Provider.name, Doc.name, Awareness.name];
  // Two docs linked by an in-memory relay.
  const peers = [];
  class RelayWS {
    constructor(url) { this.url = url; this.readyState = 0; this.OPEN = 1; this.CONNECTING = 0; this.binaryType = 'arraybuffer'; peers.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 10); }
    send(buf) { const data = buf instanceof Uint8Array ? buf.slice().buffer : buf; for (const p of peers) if (p !== this && p.readyState === 1) setTimeout(() => p.onmessage && p.onmessage({ data }), 0); }
    close() { this.readyState = 3; }
  }
  const d1 = new Doc({ gc: false });
  const d2 = new Doc({ gc: false });
  const p1 = new Provider('mg://relay', 'room', d1, { WebSocketPolyfill: RelayWS, disableBc: true, awareness: new Awareness(d1) });
  const p2 = new Provider('mg://relay', 'room', d2, { WebSocketPolyfill: RelayWS, disableBc: true, awareness: new Awareness(d2) });
  d1.getText('t').insert(0, 'bonjour ');
  await new Promise((r) => setTimeout(r, 200));
  d2.getText('t').insert(d2.getText('t').length, 'le monde');
  p1.awareness.setLocalStateField('user', { name: 'Léa' });
  await new Promise((r) => setTimeout(r, 200));
  out.t1 = d1.getText('t').toString();
  out.t2 = d2.getText('t').toString();
  out.aw = [...p2.awareness.getStates().values()].map((s) => s.user && s.user.name);
  out.synced = [p1.synced, p2.synced];
  out.yjsGlobal = Object.getOwnPropertySymbols(globalThis).map(String).concat(Object.keys(globalThis).filter((k) => /yjs|YJS/.test(k)));
  return out;
}, asset);
console.log(JSON.stringify(res, null, 1));
await app.close();
fs.rmSync(home, { recursive: true, force: true });
