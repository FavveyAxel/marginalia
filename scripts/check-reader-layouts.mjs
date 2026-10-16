// Vérifications automatiques des mises en page du lecteur, pour chaque combinaison de
// scripts/reader-layouts-common.mjs (readerLayout × livre × papier × thème) :
//  - textContent des chapitres identique dans toutes les combinaisons (les ancrages en dépendent) ;
//  - surlignages présents, exacts (texte, offsets) et visibles (fond coloré, à l'écran après un saut) ;
//  - indicateur de page valide (« p. X / 7 », « p. X–Y / 7 » en double page) ;
//  - aucune erreur console / page ; pas de débordement horizontal de l'application ;
//  - contraste du texte courant ≥ 4,5:1 sur son fond effectif ;
//  - défiler / tourner (molette, Page suivante, flèches) ne lève rien, et la lecture avance.
// Les combinaisons non reconnues par le code (réglages absents avant fusion) sont signalées, pas exclues.
// Lancer : timeout 600 node scripts/check-reader-layouts.mjs
import { withApp } from './harness.mjs';
import { combos, applyCombo, setupBook, showSpan, rootState, implemented, hasNewLayouts } from './reader-layouts-common.mjs';

const PORT = Number(process.env.PORT || 5415);
let passes = 0;
let failures = 0;
const failed = [];
const check = (cond, label, extra) => {
  if (cond) passes++;
  else {
    failures++;
    failed.push(label);
  }
  console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${label}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
};

const PAGE_RE = /^p\. (–|[ivxlcdm]+|\d+)([–-]([ivxlcdm]+|\d+))? \/ 7$/i;

const chapterTexts = (page) =>
  page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.reader-page[data-pane="a"] .html-chapter-text')].map((r) => [r.dataset.chapter, r.textContent])));

/** Surlignages : éléments, exactitude des offsets, couleur de fond. */
const highlightState = (page, bookId) =>
  page.evaluate((bookId) => {
    const pane = document.querySelector('.reader-page[data-pane="a"]');
    return window.__store
      .getState()
      .highlights.filter((h) => h.bookId === bookId)
      .map((h) => {
        const els = [...pane.querySelectorAll(`[data-hl-id="${h.id}"]`)];
        if (!els.length) return { id: h.id, chapter: h.anchor.chapter, ok: false, why: 'aucun élément' };
        const root = els[0].closest('.html-chapter-text');
        const r0 = document.createRange();
        r0.setStart(root, 0);
        r0.setEndBefore(els[0]);
        const r = document.createRange();
        r.setStartBefore(els[0]);
        r.setEndAfter(els[els.length - 1]);
        const exact = r.toString() === h.text && r0.toString().length === h.anchor.start && Number(root.dataset.chapter) === h.anchor.chapter;
        const cs = getComputedStyle(els[0]);
        const painted = !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none';
        const rendered = els.some((e) => e.getClientRects().length > 0) && cs.visibility !== 'hidden' && cs.display !== 'none';
        // Page par page : seul le chapitre lu est affiché (les autres sont display: none ou masqués) ;
        // un surlignage d'un chapitre non affiché doit être exact et coloré, pas forcément peint à l'écran.
        const chap = getComputedStyle(root.closest('.html-chapter') ?? root);
        const shown = chap.display !== 'none' && chap.visibility !== 'hidden';
        return { id: h.id, ok: exact && painted && (rendered || !shown), exact, painted, rendered, shown, bg: cs.backgroundColor };
      });
  }, bookId);

/** Le surlignage `id` a-t-il au moins un rectangle dans la zone visible du lecteur ? */
const onScreen = (page, id) =>
  page.evaluate((id) => {
    const sc = document.querySelector('.reader-page[data-pane="a"] .html-scroll') ?? document.querySelector('.reader-page[data-pane="a"]');
    const v = sc.getBoundingClientRect();
    const rects = [...document.querySelectorAll(`[data-hl-id="${id}"]`)].flatMap((e) => [...e.getClientRects()]).filter((r) => r.width > 0);
    return rects.some((r) => r.bottom > v.top + 2 && r.top < v.bottom - 2 && r.right > v.left + 2 && r.left < v.right - 2 && r.right <= innerWidth + 1);
  }, id);

const indicator = (page) => page.evaluate(() => document.querySelector('.reader-page[data-pane="a"] [data-testid=page-indicator]')?.textContent?.trim() ?? null);

const overflow = (page) =>
  page.evaluate(() => {
    const W = innerWidth;
    const de = document.documentElement;
    const root = document.querySelector('#root');
    const top = document.querySelector('.reader-topbar');
    const pane = document.querySelector('.reader-page[data-pane="a"]');
    return {
      doc: de.scrollWidth - W,
      body: document.body.scrollWidth - W,
      root: root ? root.scrollWidth - root.clientWidth : 0,
      scrollX: scrollX + (root?.scrollLeft ?? 0),
      topbar: top ? top.scrollWidth - top.clientWidth : 0,
      pane: pane ? Math.round(pane.getBoundingClientRect().right - W) : 0,
    };
  });

/** Contraste des paragraphes visibles : couleur du texte contre le fond effectif (couches composées). */
const contrast = (page) =>
  page.evaluate(() => {
    const parse = (s) => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
    const lum = ({ r, g, b }) => {
      const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const sc = document.querySelector('.reader-page[data-pane="a"] .html-scroll');
    const v = sc.getBoundingClientRect();
    const ps = [...sc.querySelectorAll('.html-chapter-text p')].filter((p) => {
      const r = p.getBoundingClientRect();
      return r.bottom > v.top && r.top < v.bottom && r.right > 0 && r.left < innerWidth && !p.closest('blockquote');
    });
    return ps.slice(0, 4).map((p) => {
      const layers = [];
      let bgImage = false;
      for (let el = p; el; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.backgroundImage !== 'none') bgImage = true;
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) {
          layers.push(c);
          if (c.a >= 1) break;
        }
      }
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
      const fg = over(parse(getComputedStyle(p).color), bg);
      const [L1, L2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return { ratio: Math.round(((L1 + 0.05) / (L2 + 0.05)) * 100) / 100, fg: getComputedStyle(p).color, bg: `rgb(${bg.r | 0}, ${bg.g | 0}, ${bg.b | 0})`, bgImage };
    });
  });

/** Signature de la position de lecture (défilement vertical / horizontal, transformation, indicateur). */
const position = (page) =>
  page.evaluate(() => {
    const sc = document.querySelector('.reader-page[data-pane="a"] .html-scroll');
    const doc = sc.querySelector('.html-doc');
    const firstVisible = [...sc.querySelectorAll('.html-chapter-text p')].find((p) => {
      const r = p.getBoundingClientRect();
      const v = sc.getBoundingClientRect();
      return r.bottom > v.top && r.top < v.bottom && r.right > v.left && r.left < v.right;
    });
    return [Math.round(sc.scrollTop), Math.round(sc.scrollLeft), getComputedStyle(doc).transform, firstVisible?.textContent.slice(0, 30) ?? '', document.querySelector('.reader-page[data-pane="a"] [data-testid=page-indicator]')?.textContent].join('|');
  });

await withApp(PORT, async (page, errors) => {
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));
  const { bookId, hl } = await setupBook(page);
  const all = combos();
  await applyCombo(page, all[4]);
  const legacy = !(await hasNewLayouts(page));
  console.log(legacy ? '(code sans readerLayout : combinaisons approximées par pageMarks, rendu par défaut)' : '(code avec readerLayout)');

  await applyCombo(page, all[0], { legacy });
  const baseline = await chapterTexts(page);
  const nChapters = Object.keys(baseline).length;
  check(nChapters === 4, `référence : 4 chapitres rendus (${nChapters})`);
  const unrecognized = [];

  for (const c of all) {
    console.log(`\n== ${String(c.n).padStart(2, '0')} ${c.label} ==`);
    const errBefore = errors.length;
    await applyCombo(page, c, { legacy });
    const missing = implemented(c, await rootState(page));
    if (missing.length) {
      unrecognized.push(`${c.n} (${missing.join(', ')})`);
      console.log(`note  non reconnu par le code : ${missing.join(', ')}`);
    }
    const tag = `[${c.n} ${c.slug}]`;

    // 1. Texte des chapitres.
    const texts = await chapterTexts(page);
    const keys = Object.keys(texts);
    const diff = keys.filter((k) => texts[k] !== baseline[k]);
    check(keys.length > 0 && diff.length === 0, `${tag} textContent des chapitres identique à la référence (${keys.length}/${nChapters} rendus)`, { diff });
    if (keys.length !== nChapters) console.log(`note  ${keys.length} chapitre(s) dans le DOM sur ${nChapters}`);

    // 2. Surlignages.
    await showSpan(page, hl.span);
    const hs = await highlightState(page, bookId);
    check(hs.find((h) => h.id === hl.span)?.ok, `${tag} surlignage à cheval sur la page 2 : présent, exact, coloré`, hs.find((h) => h.id === hl.span));
    check(hs.length === 2 && hs.every((h) => h.ok || (h.why && !keys.includes(String(h.chapter)))), `${tag} surlignages exacts et colorés (chapitres rendus)`, hs);
    check(await onScreen(page, hl.span), `${tag} après saut : le surlignage est à l’écran`);

    // 3. Indicateur.
    const ind = await indicator(page);
    check(PAGE_RE.test(ind ?? ''), `${tag} indicateur de page valide (« ${ind} »)`, ind);

    // 4. Débordement horizontal.
    const ov = await overflow(page);
    check(ov.doc <= 1 && ov.body <= 1 && ov.root <= 1 && ov.scrollX === 0 && ov.topbar <= 1 && ov.pane <= 1, `${tag} pas de débordement horizontal de l’application`, ov);

    // 5. Contraste du texte courant.
    const cr = await contrast(page);
    const min = cr.length ? Math.min(...cr.map((x) => x.ratio)) : 0;
    check(cr.length > 0 && min >= 4.5, `${tag} contraste du texte ≥ 4,5:1 (min ${min})`, cr[0]);
    if (cr.some((x) => x.bgImage)) console.log('note  fond avec image/dégradé : contraste calculé sur la couleur de fond seule');

    // 6. Défiler / tourner.
    const errTurn = errors.length;
    const p0 = await position(page);
    await page.evaluate(() => document.querySelector('.reader-page[data-pane="a"] .html-scroll')?.focus());
    for (const k of ['PageDown', 'ArrowRight', 'ArrowDown']) {
      await page.keyboard.press(k);
      await page.waitForTimeout(250);
    }
    await page.mouse.move(720, 480);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(500);
    const p1 = await position(page);
    for (const k of ['PageUp', 'ArrowLeft']) {
      await page.keyboard.press(k);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(300);
    check(errors.length === errTurn, `${tag} défiler / tourner : aucune erreur`, errors.slice(errTurn));
    check(p1 !== p0, `${tag} défiler / tourner : la lecture avance`, { p0, p1 });
    const ind2 = await indicator(page);
    check(PAGE_RE.test(ind2 ?? ''), `${tag} indicateur valide après défilement (« ${ind2} »)`, ind2);

    // 7. Erreurs console de la combinaison.
    check(errors.length === errBefore, `${tag} aucune erreur console / page`, errors.slice(errBefore, errBefore + 3));
  }

  console.log(`\nCombinaisons non reconnues par le code (rendu par défaut) : ${unrecognized.length ? unrecognized.join(' ; ') : 'aucune'}`);
});

console.log(`\n${passes} OK, ${failures} échec(s)`);
if (failures) console.log('Échecs :\n- ' + failed.join('\n- '));
process.exit(failures ? 1 : 0);
