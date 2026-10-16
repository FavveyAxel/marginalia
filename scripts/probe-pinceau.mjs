import { withApp } from './harness.mjs';
import { buildEssay, newDraft, settle } from './ed-helpers.mjs';
const h = (page, fn, arg) => page.evaluate(fn, arg);
const VIS = () => {
  window.__vis = (needle, off = 1, nth = 0) => {
    const r = window.__h.span(needle, off, off + 1, nth);
    if (!r) return 'introuvable';
    const p = r.from;
    const spans = [...document.querySelectorAll('.superdoc-page span[data-pm-start]')].filter((s) => !s.querySelector('[data-pm-start]'));
    const s = spans.find((s) => +s.dataset.pmStart <= p && p < +s.dataset.pmEnd);
    if (!s) return null;
    const cs = getComputedStyle(s);
    let bg = cs.backgroundColor, el = s;
    for (let i = 0; i < 3 && (bg === 'rgba(0, 0, 0, 0)'); i++) { el = el.parentElement; if (!el || el.classList.contains('superdoc-line')) break; bg = getComputedStyle(el).backgroundColor; }
    return { ff: cs.fontFamily.split(',')[0].replace(/"/g, ''), fs: cs.fontSize, fw: cs.fontWeight, st: cs.fontStyle, td: cs.textDecorationLine, col: cs.color, bg, fv: cs.fontVariantCaps, tt: cs.textTransform, va: cs.verticalAlign };
  };
  window.__para = (needle) => {
    const r = window.__h.span(needle, 0, 1);
    const frag = [...document.querySelectorAll('.superdoc-page [data-layout-fragment-id][data-pm-start]')].find((f) => +f.dataset.pmStart <= r.from && r.from < +f.dataset.pmEnd);
    const st = window.__h.fmtAt(needle, 0, 1);
    return { align: st.align, lh: st.lineHeight, style: st.styleId, ta: frag ? getComputedStyle(frag.querySelector('.superdoc-line') ?? frag).textAlign : null };
  };
};
async function R(page, needle, a = 0, b = needle.length) { const rs = await h(page, ({ needle, a, b }) => window.__h.rects(needle, a, b), { needle, a, b }); if (!rs.length) throw new Error('no rect ' + needle); return { a: rs[0], b: rs[rs.length - 1] }; }
const mid = (r) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
async function dbl(page, needle) { const r = await R(page, needle); await page.mouse.dblclick(...mid(r.a)); await settle(page, 300); }
async function triple(page, needle) { const r = await R(page, needle); await page.mouse.click(...mid(r.a), { clickCount: 3 }); await settle(page, 300); }
async function drag(page, needle, a, b) { const r = await R(page, needle, a, b); const y1 = (r.a.top + r.a.bottom) / 2, y2 = (r.b.top + r.b.bottom) / 2; await page.mouse.move(r.a.left + 0.5, y1); await page.mouse.down(); await page.mouse.move(r.b.right - 0.5, y2, { steps: 6 }); await page.mouse.up(); await settle(page, 300); }
async function caret(page, needle, a) { const r = await R(page, needle, a, a + 1); await page.mouse.click(r.a.left + 0.3, (r.a.top + r.a.bottom) / 2); await settle(page, 300); }
async function tbFont(page, fam) { await page.click('.ed-toolbar [data-tb="font"]'); await page.waitForSelector('.ed-font-row', { timeout: 15000 }); await page.fill('.ed-font-search input', fam); await settle(page, 200); await page.click(`.ed-font-row[data-font="${fam}"]`); await settle(page, 300); }
async function tbSize(page, n) { await page.click('.ed-toolbar .ed-size-more'); await settle(page, 200); await page.click(`.ed-size-menu [data-size="${n}"]`); await settle(page, 300); }
async function tb(page, k) { await page.click(`.ed-toolbar [data-tb="${k}"]`); await settle(page, 250); }
async function tbColor(page, kind, i) { await page.click(`.ed-toolbar [data-tb="${kind}"]`); await settle(page, 250); const sw = page.locator('.ed-color-menu .ed-swatch:not(.none)').nth(i); const hex = await sw.getAttribute('data-color'); await sw.click(); await settle(page, 300); return hex; }
async function tbStyle(page, s) { await page.click('.ed-toolbar [data-tb="style"]'); await settle(page, 250); await page.click(`.ed-style-menu [data-style="${s}"]`); await settle(page, 600); }
async function tbChars(page, m) { await page.click('.ed-toolbar [data-tb="chars"]'); await settle(page, 200); await page.click(`.ed-chars-menu [data-mark="${m}"]`); await settle(page, 300); }
async function tbAlign(page, a) { await page.click('.ed-toolbar [data-tb="align"]'); await settle(page, 200); await page.click(`.ed-align-menu [data-align="${a}"]`); await settle(page, 300); }
async function tbLine(page, l) { await page.click('.ed-toolbar [data-tb="spacing"]'); await settle(page, 200); await page.click(`.ed-spacing-menu [data-line="${l}"]`); await settle(page, 300); }
const copyK = (page) => page.keyboard.press('Meta+Alt+KeyC').then(() => settle(page, 300));
const pasteK = (page) => page.keyboard.press('Meta+Alt+KeyV').then(() => settle(page, 500));
const vis = (page, n, o = 1, nth = 0) => h(page, ({ n, o, nth }) => window.__vis(n, o, nth), { n, o, nth });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function fresh(page) {
  await newDraft(page, 'Probe');
  await buildEssay(page);
  await h(page, VIS);
  // S1 cogito : Georgia 18 B I U couleur surlignage
  await dbl(page, 'cogito');
  await tbFont(page, 'Georgia'); await tbSize(page, 18); await tb(page, 'bold'); await tb(page, 'italic'); await tb(page, 'underline');
  await tbColor(page, 'color', 4); await tbColor(page, 'highlight', 0);
  // S2 « première vérité » : petites capitales, 14, couleur
  await drag(page, 'première vérité', 0, 15);
  await tbChars(page, 'smallCaps'); await tbSize(page, 14); await tbColor(page, 'color', 6);
  // S5 mixte « Mais cette » : Mais gras, cette italique Georgia
  await dbl(page, 'Mais'); await tb(page, 'bold');
  await dbl(page, 'cette certitude'); await tb(page, 'italic'); await tbFont(page, 'Georgia');
  // S4 paragraphe Kant : centré, interligne 2
  await caret(page, 'Kant', 2); await tbAlign(page, 'center'); await tbLine(page, 2);
  // Titre 2 sur Conclusion? non : le titre (Titre 1) existe déjà
}

const results = [];
const report = async (page, name, src, dst, extra) => {
  const ok = same(src, dst);
  results.push([ok, name]);
  console.log((ok ? 'SAME ' : 'DIFF ') + name + (ok ? '' : '\n   src ' + JSON.stringify(src) + '\n   dst ' + JSON.stringify(dst) + (extra ? '\n   ' + extra : '')));
};
const copied = (page) => h(page, () => JSON.stringify(window.__lastCopied ?? null));

await withApp(5499, async (page, errors) => {
  await fresh(page);
  const S1 = await vis(page, 'cogito', 2), S2 = await vis(page, 'première', 2), H = await vis(page, 'conscience de soi', 2), P = await vis(page, 'Descartes', 2);
  const Mais = await vis(page, 'Mais', 1);
  console.log('S1', JSON.stringify(S1), '\nS2', JSON.stringify(S2), '\nH', JSON.stringify(H), '\nP', JSON.stringify(P), '\nMais', JSON.stringify(Mais), '\ncette', JSON.stringify(await vis(page, 'cette', 1)));
  await page.screenshot({ path: 'shots/pinceau/probe-src.png' });
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  const tryCase = async (name, src, copyFn, pasteFn, checks) => {
    if (only && !only.test(name)) return;
    await fresh(page);
    const before = []; for (const [n, o] of checks) before.push(await vis(page, n, o));
    await copyFn(); await copyK(page);
    const cp = await h(page, () => JSON.stringify(window.__ed.engine().copyFormat()));
    await pasteFn(); const tsel = await h(page, () => window.__h.sel().text); await pasteK(page);
    for (const [n, o] of checks) await report(page, `${name} [${n}+${o}]`, src, await vis(page, n, o), 'copy=' + cp + ' tsel=' + JSON.stringify(tsel));
    await page.keyboard.press('Control+z'); await settle(page, 400);
    let i = 0; for (const [n, o] of checks) await report(page, `${name} [${n}+${o}] UNDO`, before[i++], await vis(page, n, o));
  };
  await tryCase('S1 dbl → dbl plain', S1, () => dbl(page, 'cogito'), () => dbl(page, 'Hume'), [['Hume', 0], ['Hume', 3]]);
  await tryCase('S1 drag-partial → drag-partial', S1, () => drag(page, 'cogito', 1, 4), () => drag(page, 'introspection', 2, 8), [['introspection', 2], ['introspection', 7]]);
  await tryCase('S1 caret → caret', S1, () => caret(page, 'cogito', 3), () => caret(page, 'succession', 4), [['succession', 0], ['succession', 9]]);
  await tryCase('S1 caret-at-start → word', S1, () => caret(page, 'cogito', 0), () => dbl(page, 'Hume'), [['Hume', 1]]);
  await tryCase('S1 dbl → heading word', S1, () => dbl(page, 'cogito'), () => dbl(page, 'conscience de soi'), [['conscience de soi', 2]]);
  await tryCase('S1 dbl → formatted (S2)', S1, () => dbl(page, 'cogito'), () => dbl(page, 'première'), [['première', 2]]);
  await tryCase('S1 dbl → multi-para drag', S1, () => dbl(page, 'cogito'), () => drag(page, 'stable : seulement une succession de perceptions, de chaleur ou de froid, d’amour ou de haine.Kant dépasse', 0, 114), [['stable', 2], ['Kant', 1]]);
  await tryCase('S2 drag → dbl plain', S2, () => drag(page, 'première vérité', 3, 10), () => dbl(page, 'Hume'), [['Hume', 1]]);
  await tryCase('S2 dbl → formatted S1', S2, () => dbl(page, 'première'), () => dbl(page, 'cogito'), [['cogito', 2]]);
  await tryCase('H dbl heading → plain', H, () => dbl(page, 'conscience de soi'), () => dbl(page, 'Hume'), [['Hume', 1]]);
  await tryCase('H triple heading → plain word', H, () => triple(page, 'conscience de soi'), () => dbl(page, 'Hume'), [['Hume', 1]]);
  await tryCase('P plain → heading word', P, () => dbl(page, 'Descartes'), () => dbl(page, 'conscience de soi'), [['conscience de soi', 2]]);
  await tryCase('P plain → formatted S1', P, () => dbl(page, 'Descartes'), () => dbl(page, 'cogito'), [['cogito', 2]]);
  await tryCase('P plain → formatted S2', P, () => dbl(page, 'Descartes'), () => dbl(page, 'première'), [['première', 2]]);
  await tryCase('Mixed drag Mais cette → plain (first char)', Mais, () => drag(page, 'Mais cette', 0, 10), () => dbl(page, 'Hume'), [['Hume', 1]]);
  await tryCase('Mixed backward-ish: dbl cette → plain', await vis(page, 'cette', 1), () => dbl(page, 'cette'), () => dbl(page, 'Hume'), [['Hume', 1]]);
  console.log('\n' + results.filter((r) => !r[0]).length + ' DIFF / ' + results.length);
  console.log('errors', errors.join('\n').slice(0, 1000));
});
