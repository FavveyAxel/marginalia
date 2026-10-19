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
await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
page.on('console', (m) => { const t = m.text(); if (!/Using SuperDoc/.test(t)) console.log('[console]', m.type(), t.slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
const asset = fs.readdirSync(path.join(ROOT, 'dist/assets')).find((f) => /^superdoc\.min-.*\.js$/.test(f));
const docx = fs.readFileSync(path.join(ROOT, 'fixtures/discours.docx')).toString('base64');
const res = await page.evaluate(async ({ asset, docx }) => {
  await new Promise((r, j) => { const s = document.createElement('script'); s.src = './assets/' + asset; s.onload = r; s.onerror = j; document.head.appendChild(s); });
  const SD = window.SuperDoc;
  const out = {};
  const probeHost = document.createElement('div');
  document.body.appendChild(probeHost);
  class ProbeWS { constructor() { this.readyState = 0; this.OPEN = 1; } send() {} close() {} }
  const realWS = window.WebSocket;
  window.WebSocket = ProbeWS;
  const sd0 = new SD({ selector: probeHost, documents: [{ id: 'probe', type: 'docx', name: 'p.docx' }], modules: { comments: false, collaboration: { providerType: 'superdoc', url: 'ws://mg.invalid' } }, telemetry: { enabled: false } });
  window.WebSocket = realWS;
  const Provider = sd0.provider.constructor, Doc = sd0.ydoc.constructor, Awareness = sd0.provider.awareness.constructor;
  sd0.provider.destroy(); sd0.destroy(); probeHost.remove();

  const peers = [];
  class RelayWS {
    constructor(url) { this.url = url; this.readyState = 0; this.OPEN = 1; this.binaryType = 'arraybuffer'; peers.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); if (peers.filter((p) => p.readyState === 1).length === 1) this.onmessage({ data: new Uint8Array([0, 1, 2, 0, 0]).buffer }); }, 10); }
    send(buf) { const data = buf instanceof Uint8Array ? buf.slice().buffer : buf; for (const p of peers) if (p !== this && p.readyState === 1) setTimeout(() => p.onmessage && p.onmessage({ data }), 0); }
    close() { this.readyState = 3; }
  }
  const bytes = Uint8Array.from(atob(docx), (c) => c.charCodeAt(0));
  const file = () => new File([bytes], 'd.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const mk = (left) => { const h = document.createElement('div'); h.style.cssText = `position:fixed;top:0;left:${left}px;width:690px;height:900px;overflow:auto;background:#fff`; document.body.appendChild(h); return h; };
  const hA = mk(0), hB = mk(700);
  // Host : ouvre le docx, puis passe en collaboration.
  const sdA = await new Promise((resolve) => { const i = new SD({ selector: hA, document: file(), documentMode: 'editing', telemetry: { enabled: false }, modules: { comments: false }, user: { name: 'Léa', email: 'lea@local', color: '#c2410c' }, onReady: () => resolve(i) }); });
  await new Promise((r) => setTimeout(r, 1500));
  out.beforeUpgrade = sdA.superdocStore.documents[0].getEditor().state.doc.textContent.length;
  const dA = new Doc({ gc: false });
  const pA = new Provider('mg://r', 'room', dA, { WebSocketPolyfill: RelayWS, disableBc: true, awareness: new Awareness(dA) });
  const t0 = performance.now();
  await sdA.upgradeToCollaboration({ ydoc: dA, provider: pA });
  out.upgradeMs = Math.round(performance.now() - t0);
  out.fragLen = dA.getXmlFragment('supereditor').length; out.afterUpgrade = sdA.superdocStore.documents[0].getEditor().state.doc.textContent.length;
  // Invité : Y.Doc vide, se synchronise.
  const dB = new Doc({ gc: false });
  const pB = new Provider('mg://r', 'room', dB, { WebSocketPolyfill: RelayWS, disableBc: true, awareness: new Awareness(dB) });
  const sdB = await new Promise((resolve) => { const i = new SD({ selector: hB, document: file(), documentMode: 'editing', telemetry: { enabled: false }, modules: { comments: false, collaboration: { ydoc: dB, provider: pB } }, user: { name: 'Marc', email: 'marc@local', color: '#1d4ed8' }, onReady: () => resolve(i) }); });
  await new Promise((r) => setTimeout(r, 1500));
  const ed = (sd) => sd.superdocStore.documents[0].getEditor();
  const text = (sd) => ed(sd).state.doc.textContent;
  out.sameAfterJoin = text(sdA) === text(sdB);
  out.lenA = text(sdA).length; out.lenB = text(sdB).length;
  // Saisie chez B
  ed(sdB).commands.setTextSelection({ from: 5, to: 5 });
  ed(sdB).commands.insertContent('[MARC]');
  ed(sdA).commands.setTextSelection({ from: 30, to: 30 });
  ed(sdA).commands.insertContent('[LEA]');
  await new Promise((r) => setTimeout(r, 1000));
  out.aHasMarc = text(sdA).includes('[MARC]');
  out.bHasLea = text(sdB).includes('[LEA]');
  out.same = text(sdA) === text(sdB);
  out.cursorsA = document.querySelectorAll('.presentation-editor__selection-layer--remote *').length;
  out.remoteLabels = Array.from(document.querySelectorAll('.presentation-editor__selection-layer--remote *')).map((e) => e.textContent).filter(Boolean).slice(0, 5);
  // Export du docx chez B
  const blob = await sdB.export({ exportType: ['docx'], commentsType: 'external', triggerDownload: false });
  out.exportB = blob.size;
  return out;
}, { asset, docx });
console.log(JSON.stringify(res, null, 1));
await page.screenshot({ path: '/tmp/claude-0/-home-claude/20780725-4b55-55db-8901-1877c1efdc09/scratchpad/spike2.png' });
await app.close();
fs.rmSync(home, { recursive: true, force: true });
