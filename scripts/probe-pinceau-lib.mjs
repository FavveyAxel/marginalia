import { withApp } from './harness.mjs';
import { buildEssay, newDraft, settle } from './ed-helpers.mjs';
export const h = (page, fn, arg) => page.evaluate(fn, arg);
export const VIS = () => {
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
export async function R(page, needle, a = 0, b = needle.length) { const rs = await h(page, ({ needle, a, b }) => window.__h.rects(needle, a, b), { needle, a, b }); if (!rs.length) throw new Error('no rect ' + needle); return { a: rs[0], b: rs[rs.length - 1] }; }
export const mid = (r) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
export async function dbl(page, needle) { const r = await R(page, needle); await page.mouse.dblclick(...mid(r.a)); await settle(page, 300); }
export async function triple(page, needle) { const r = await R(page, needle); await page.mouse.click(...mid(r.a), { clickCount: 3 }); await settle(page, 300); }
export async function drag(page, needle, a, b) { const r = await R(page, needle, a, b); const y1 = (r.a.top + r.a.bottom) / 2, y2 = (r.b.top + r.b.bottom) / 2; await page.mouse.move(r.a.left + 0.5, y1); await page.mouse.down(); await page.mouse.move(r.b.right - 0.5, y2, { steps: 6 }); await page.mouse.up(); await settle(page, 300); }
export async function caret(page, needle, a) { const r = await R(page, needle, a, a + 1); await page.mouse.click(r.a.left + 0.3, (r.a.top + r.a.bottom) / 2); await settle(page, 300); }
export async function tbFont(page, fam) { await page.click('.ed-toolbar [data-tb="font"]'); await page.waitForSelector('.ed-font-row', { timeout: 15000 }); await page.fill('.ed-font-search input', fam); await settle(page, 200); await page.click(`.ed-font-row[data-font="${fam}"]`); await settle(page, 300); }
export async function tbSize(page, n) { await page.click('.ed-toolbar .ed-size-more'); await settle(page, 200); await page.click(`.ed-size-menu [data-size="${n}"]`); await settle(page, 300); }
export async function tb(page, k) { await page.click(`.ed-toolbar [data-tb="${k}"]`); await settle(page, 250); }
export async function tbColor(page, kind, i) { await page.click(`.ed-toolbar [data-tb="${kind}"]`); await settle(page, 250); const sw = page.locator('.ed-color-menu .ed-swatch:not(.none)').nth(i); const hex = await sw.getAttribute('data-color'); await sw.click(); await settle(page, 300); return hex; }
export async function tbStyle(page, s) { await page.click('.ed-toolbar [data-tb="style"]'); await settle(page, 250); await page.click(`.ed-style-menu [data-style="${s}"]`); await settle(page, 600); }
export async function tbChars(page, m) { await page.click('.ed-toolbar [data-tb="chars"]'); await settle(page, 200); await page.click(`.ed-chars-menu [data-mark="${m}"]`); await settle(page, 300); }
export async function tbAlign(page, a) { await page.click('.ed-toolbar [data-tb="align"]'); await settle(page, 200); await page.click(`.ed-align-menu [data-align="${a}"]`); await settle(page, 300); }
export async function tbLine(page, l) { await page.click('.ed-toolbar [data-tb="spacing"]'); await settle(page, 200); await page.click(`.ed-spacing-menu [data-line="${l}"]`); await settle(page, 300); }
export const copyK = (page) => page.keyboard.press('Meta+Alt+KeyC').then(() => settle(page, 300));
export const pasteK = (page) => page.keyboard.press('Meta+Alt+KeyV').then(() => settle(page, 500));
export const vis = (page, n, o = 1, nth = 0) => h(page, ({ n, o, nth }) => window.__vis(n, o, nth), { n, o, nth });
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

