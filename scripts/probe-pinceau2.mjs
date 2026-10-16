import { withApp } from './harness.mjs';
import fs from 'node:fs';
import { installHelpers, settle } from './ed-helpers.mjs';
import * as P from './probe-pinceau-lib.mjs';
const { h, VIS, vis, copyK, pasteK } = P;
const FX = process.env.FX ?? 'fixtures/discours.docx';
const b64 = fs.readFileSync(FX).toString('base64');
async function fresh(page) {
  const id = await h(page, async ({ b64 }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const before = new Set(window.__store.getState().drafts.map((d) => d.id));
    await window.__store.getState().importFiles([{ name: 'discours.docx', data: bin.buffer }]);
    return window.__store.getState().drafts.find((d) => !before.has(d.id))?.id;
  }, { b64 });
  await h(page, (id) => window.__store.getState().navigate({ name: 'home' }), id);
  await settle(page, 300);
  await h(page, (id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
  await page.waitForFunction((id) => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), id, { timeout: 60000 });
  await settle(page, 1200);
  await installHelpers(page);
  await h(page, VIS);
  if (!process.env.FX) { await P.drag(page, 'mieux partagée', 0, 14);
  await P.tbFont(page, 'Georgia'); await P.tbSize(page, 14); await P.tb(page, 'bold'); await P.tbColor(page, 'color', 4); await P.tbColor(page, 'highlight', 0); }
}
const results = [];
const report = (name, src, dst, extra) => { const ok = P.same(src, dst); results.push(ok); console.log((ok ? 'SAME ' : 'DIFF ') + name + (ok ? '' : '\n   src ' + JSON.stringify(src) + '\n   dst ' + JSON.stringify(dst) + (extra ? '\n   ' + extra : ''))); };
await withApp(5497, async (page, errors) => {
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  const tryCase = async (name, srcN, srcO, copyFn, pasteFn, checks) => {
    if (only && !only.test(name)) return;
    await fresh(page);
    const src = await vis(page, srcN, srcO);
    const before = []; for (const [n, o] of checks) before.push(await vis(page, n, o));
    await copyFn(); await copyK(page);
    const cp = await h(page, () => JSON.stringify(window.__ed.engine().copyFormat()));
    await pasteFn(); const tsel = await h(page, () => window.__h.sel().text); await pasteK(page);
    for (const [n, o] of checks) report(`${name} [${n}+${o}]`, src, await vis(page, n, o), 'copy=' + cp + ' tsel=' + JSON.stringify(tsel));
    await page.keyboard.press('Control+z'); await settle(page, 400);
    let i = 0; for (const [n, o] of checks) report(`${name} [${n}+${o}] UNDO`, before[i++], await vis(page, n, o));
  };
  if (process.env.FX) {
    await fresh(page);
    for (const [n, o] of [['Méditations', 2], ['Le doute', 1], ['première vérité', 2], ['Hume', 1]]) console.log(n, JSON.stringify(await vis(page, n, o)));
    await tryCase('W dbl fmt → dbl plain', 'vérité', 2, () => P.dbl(page, 'vérité'), () => P.dbl(page, 'Hume'), [['Hume', 0], ['Hume', 3]]);
    await tryCase('W drag partial → drag partial', 'vérité', 2, () => P.drag(page, 'première vérité', 3, 10), () => P.drag(page, 'introspection', 3, 9), [['introspection', 3], ['introspection', 8], ['introspection', 1]]);
    await tryCase('W caret → caret', 'vérité', 2, () => P.caret(page, 'vérité', 3), () => P.caret(page, 'stable', 3), [['stable', 0], ['stable', 5]]);
    await tryCase('W plain → formatted', 'Hume', 1, () => P.dbl(page, 'Hume'), () => P.dbl(page, 'vérité'), [['vérité', 2]]);
    await tryCase('W plain → heading word', 'Hume', 1, () => P.dbl(page, 'Hume'), () => P.dbl(page, 'Méditations'), [['Méditations', 2]]);
    await tryCase('W heading → plain', 'Méditations', 2, () => P.dbl(page, 'Méditations'), () => P.dbl(page, 'Hume'), [['Hume', 1]]);
    await tryCase('W fmt → multi para', 'vérité', 2, () => P.dbl(page, 'vérité'), () => P.drag(page, 'perceptions.Kant dépasse', 0, 24), [['perceptions', 2], ['Kant', 1], ['dépasse', 3]]);
    await tryCase('W fmt → triple', 'vérité', 2, () => P.dbl(page, 'vérité'), () => P.triple(page, 'Kant'), [['Kant', 1], ['représentations', 3]]);
  }
  console.log('\n' + results.filter((r) => !r).length + ' DIFF / ' + results.length);
  console.log('errors', errors.join('\n').slice(0, 800));
});
