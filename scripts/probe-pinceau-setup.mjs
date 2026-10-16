import { withApp } from './harness.mjs';
import { buildEssay, newDraft, settle } from './ed-helpers.mjs';
import * as P from './probe-pinceau-lib.mjs';
const { h, VIS, vis } = P;
await withApp(5498, async (page, errors) => {
  await newDraft(page, 'Probe');
  await buildEssay(page);
  await h(page, VIS);
  const sel = () => h(page, () => JSON.stringify(window.__h.sel()));
  await P.drag(page, 'première vérité', 0, 15); console.log('drag', await sel());
  await P.tbChars(page, 'smallCaps'); console.log('sc', await sel(), JSON.stringify(await vis(page, 'première', 2)), JSON.stringify(await h(page, () => window.__h.fmtAt('première', 2, 3).smallCaps)));
  await P.tbSize(page, 14); console.log('size', await sel(), JSON.stringify(await vis(page, 'première', 2)));
  await P.tbColor(page, 'color', 6); console.log('color', await sel(), JSON.stringify(await vis(page, 'première', 2)));
  await P.dbl(page, 'cette'); console.log('dbl cette', await sel());
  await P.tb(page, 'italic'); console.log('ital', await sel(), JSON.stringify(await vis(page, 'cette', 2)));
  await page.screenshot({ path: 'shots/pinceau/probe-setup.png' });
});
