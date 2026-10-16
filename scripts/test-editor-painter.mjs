// « Reproduire la mise en forme » (painter.tsx, engine.copyFormat / applyFormat) — port 5406.
// Lancer : timeout 600 node scripts/test-editor-painter.mjs
// Bouton pinceau au début de la barre (après Annuler / Rétablir), infobulle avec ⌥⌘C / ⌥⌘V → un clic :
// copie, bouton actif, curseur pinceau sur la page, la sélection suivante à la souris reçoit la mise en
// forme, puis le mode s'arrête → double-clic : maintenu jusqu'à Échap → ⌥⌘C (toast) / ⌥⌘V (mot sous le
// curseur) → paragraphe (curseur / paragraphe entier) ou caractères seuls (sélection partielle) → une
// seule étape d'annulation → palette de commandes → export Word → barre sur une ligne à 1440 px →
// Windows : Ctrl+Maj+C / Ctrl+Maj+V → capture shots/editeur/pinceau.png.
import { withApp } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, buildEssay, checker, exportDocx, mouseSelect, newDraft, settle } from './ed-helpers.mjs';

const PORT = 5406;
const OUT = path.join(ROOT, 'shots/editeur');
fs.mkdirSync(OUT, { recursive: true });
const { check, finish } = checker();
const h = (page, fn, arg) => page.evaluate(fn, arg);
const painterOn = (page) => page.locator('.ed-toolbar [data-tb="painter"]').evaluate((b) => b.getAttribute('aria-pressed') === 'true');
const toastText = (page) => page.evaluate(() => document.querySelector('.toasts')?.textContent ?? '');

await withApp(PORT, async (page, errors) => {
  try {
    await newDraft(page, 'Pinceau');
    await buildEssay(page);
    // Modèle : « cogito » en Georgia 14, gras, italique, souligné, rouge sombre, surligné jaune
    await h(page, async () => {
      const e = window.__ed.engine();
      window.__h.select('cogito');
      e.toggleMark('bold');
      e.toggleMark('italic');
      e.toggleMark('underline');
      e.setColor('#8B2E2E');
      e.setHighlight('#FFF2A8');
      e.setFontFamily('Georgia');
      e.setFontSize(14);
      await new Promise((r) => setTimeout(r, 300));
    });

    // ── Barre d'outils ──
    const tb = await h(page, () => {
      const btns = [...document.querySelectorAll('.ed-toolbar [data-tb]')].map((b) => b.dataset.tb);
      const b = document.querySelector('.ed-toolbar [data-tb="painter"]');
      return { order: btns.slice(0, 3), title: b?.getAttribute('title') ?? '', svg: !!b?.querySelector('svg') };
    });
    check('bouton pinceau après Annuler / Rétablir, au début de la barre', tb.order.join() === 'undo,redo,painter' && tb.svg, tb.order.join());
    check('infobulle : raccourcis ⌥⌘C / ⌥⌘V', /⌥⌘C/.test(tb.title) && /⌥⌘V/.test(tb.title), tb.title);
    const bar = await h(page, () => {
      const t = document.querySelector('.ed-toolbar');
      return { rows: new Set([...t.querySelectorAll(':scope > .ed-tb-group')].map((g) => Math.round(g.getBoundingClientRect().top))).size, more: !!t.querySelector('[data-tb="more"]'), panel: !!document.querySelector('.ed-has-extracts') };
    });
    check('barre de mise en forme : une ligne à 1440 px, panneau latéral ouvert, rien sous « … »', bar.rows === 1 && !bar.more && bar.panel, JSON.stringify(bar));

    // ── Un clic : copie, curseur pinceau, la sélection suivante reçoit la mise en forme ──
    await h(page, () => window.__h.select('cogito', 2, 2));
    await page.click('.ed-toolbar [data-tb="painter"]');
    await settle(page, 200);
    const armed = await h(page, () => {
      const span = [...document.querySelectorAll('.superdoc-page [data-pm-start]')].find((s) => s.textContent.includes('introspection'));
      return { root: !!document.querySelector('.ed-root.ed-painting'), cursor: span ? getComputedStyle(span).cursor : '' };
    });
    check('un clic : bouton actif', await painterOn(page));
    check('curseur pinceau sur la page', armed.root && /^url\("data:image\/svg\+xml/.test(armed.cursor) && /text$/.test(armed.cursor), armed.cursor.slice(0, 60));
    // capture : pinceau armé, pointeur au-dessus du texte (le curseur, absent des captures sans tête, est dessiné)
    const hover = await h(page, () => window.__h.rect('introspection', 3, 4));
    const hx = hover.left + 2;
    const hy = (hover.top + hover.bottom) / 2;
    await page.mouse.move(hx, hy);
    await settle(page, 150);
    await h(page, ({ x, y, cur }) => {
      const m = /url\("([^"]+)"\)/.exec(cur);
      const img = document.createElement('img');
      img.id = 'shot-cursor';
      img.src = m[1];
      img.style.cssText = `position:fixed;left:${x - 6}px;top:${y - 14}px;width:32px;height:32px;z-index:2147483647;pointer-events:none`;
      document.body.append(img);
    }, { x: hx, y: hy, cur: armed.cursor });
    await settle(page, 200);
    await page.screenshot({ path: path.join(OUT, 'pinceau.png') });
    console.log('capture: shots/editeur/pinceau.png');
    await h(page, () => document.getElementById('shot-cursor')?.remove());

    await mouseSelect(page, 'introspection');
    await settle(page, 400);
    const st1 = await h(page, () => window.__h.fmtAt('introspection', 2, 3));
    check('sélection suivante : police, taille, gras, italique, souligné, couleur, surlignage', st1.fontFamily === 'Georgia' && st1.fontSize === 14 && st1.bold && st1.italic && st1.underline && /8B2E2E/i.test(st1.color ?? '') && /FFF2A8/i.test(st1.highlight ?? ''), JSON.stringify([st1.fontFamily, st1.fontSize, st1.bold, st1.italic, st1.underline, st1.color, st1.highlight]));
    const nb = await h(page, () => window.__h.fmtAt('ne rencontre', 0, 1));
    check('le texte voisin garde sa mise en forme', !nb.bold && nb.fontFamily !== 'Georgia', JSON.stringify([nb.bold, nb.fontFamily]));
    check('un clic : le mode s’arrête après une application', !(await painterOn(page)) && !(await h(page, () => !!document.querySelector('.ed-painting'))));
    // une seule étape d'annulation
    await page.keyboard.press('Control+z');
    await settle(page, 300);
    const st1u = await h(page, () => window.__h.fmtAt('introspection', 2, 3));
    const cog = await h(page, () => window.__h.fmtAt('cogito', 2, 3));
    check('⌘Z une fois : la mise en forme appliquée est entièrement annulée (le modèle reste)', !st1u.bold && !st1u.italic && st1u.fontFamily !== 'Georgia' && !st1u.highlight && cog.bold && cog.fontFamily === 'Georgia', JSON.stringify([st1u.bold, st1u.fontFamily, st1u.highlight, cog.bold]));

    // ── Double-clic : pinceau maintenu jusqu'à Échap ──
    await h(page, () => window.__h.select('cogito', 1, 3));
    await page.dblclick('.ed-toolbar [data-tb="painter"]');
    await settle(page, 250);
    check('double-clic : pinceau maintenu', (await painterOn(page)) && (await h(page, () => document.querySelector('[data-tb="painter"]').classList.contains('sticky'))));
    await mouseSelect(page, 'succession');
    await settle(page, 350);
    await mouseSelect(page, 'représentations');
    await settle(page, 350);
    const s2 = await h(page, () => [window.__h.fmtAt('succession', 2, 3), window.__h.fmtAt('représentations', 2, 3)]);
    check('double-clic : deux passages reçoivent la mise en forme, le pinceau reste actif', s2.every((s) => s.bold && s.fontFamily === 'Georgia' && s.fontSize === 14) && (await painterOn(page)), JSON.stringify(s2.map((s) => [s.bold, s.fontFamily])));
    await page.keyboard.press('Escape');
    await settle(page, 200);
    check('Échap : pinceau désarmé', !(await painterOn(page)));
    await mouseSelect(page, 'activité');
    await settle(page, 300);
    check('après Échap : une sélection ne reçoit plus rien', !(await h(page, () => window.__h.fmtAt('activité', 2, 3).bold)));
    // un clic sur le bouton désarme aussi
    await page.click('.ed-toolbar [data-tb="painter"]');
    await settle(page, 150);
    const onAgain = await painterOn(page);
    await page.click('.ed-toolbar [data-tb="painter"]');
    await settle(page, 150);
    check('clic sur le pinceau armé : désarmé', onAgain && !(await painterOn(page)));

    // ── ⌥⌘C / ⌥⌘V ──
    await h(page, () => window.__h.select('cogito', 2, 2));
    await page.keyboard.press('Meta+Alt+KeyC');
    await settle(page, 250);
    check('⌥⌘C : toast « Mise en forme copiée »', /Mise en forme copiée/.test(await toastText(page)), await toastText(page));
    check('⌥⌘C : le texte n’est pas touché (SuperDoc : ⌘⌥C effaçait la mise en forme)', await h(page, () => window.__h.fmtAt('cogito', 2, 3).bold && window.__h.styleOf('cogito') === null));
    await h(page, () => window.__h.select('chaleur', 3, 3));
    await page.keyboard.press('Meta+Alt+KeyV');
    await settle(page, 350);
    const w = await h(page, () => [window.__h.fmtAt('chaleur', 0, 1), window.__h.fmtAt('chaleur', 6, 7), window.__h.fmtAt('de chaleur', 0, 1)]);
    check('⌥⌘V sans sélection : le mot sous le curseur (et lui seul)', w[0].bold && w[1].fontFamily === 'Georgia' && !w[2].bold, JSON.stringify(w.map((s) => [s.bold, s.fontFamily])));
    await page.keyboard.press('Control+z');
    await settle(page, 300);
    check('⌥⌘V : une seule étape d’annulation', !(await h(page, () => window.__h.fmtAt('chaleur', 0, 1).bold)));

    // ── Paragraphe : depuis le curseur (copié) / sélection partielle (caractères seuls) ──
    await h(page, async () => {
      const e = window.__ed.engine();
      window.__h.select('Kant dépasse', 2, 2);
      await e.setParagraphStyle('quote');
      e.setAlign('center');
      e.setParagraphSpacing({ before: 240, after: 360 });
      await new Promise((r) => setTimeout(r, 300));
    });
    const kantStyle = await h(page, () => window.__h.styleOf('Kant'));
    // sélection partielle dans la citation : caractères seulement
    await h(page, () => window.__h.select('Kant dépasse', 0, 4));
    await page.keyboard.press('Meta+Alt+KeyC');
    await h(page, () => window.__h.select('Conclusion', 0, 10));
    await page.keyboard.press('Meta+Alt+KeyV');
    await settle(page, 350);
    let c = await h(page, () => ({ st: window.__h.fmtAt('Conclusion', 2, 3), style: window.__h.styleOf('Conclusion') }));
    check('sélection partielle copiée : caractères seuls (paragraphe cible inchangé)', c.style === null && c.st.align !== 'center', JSON.stringify([c.style, c.st.align]));
    await page.keyboard.press('Control+z');
    await settle(page, 300);
    // curseur : paragraphe copié aussi
    await h(page, () => window.__h.select('Kant dépasse', 3, 3));
    await page.keyboard.press('Meta+Alt+KeyC');
    await h(page, () => window.__h.select('Conclusion', 0, 10));
    await page.keyboard.press('Meta+Alt+KeyV');
    await settle(page, 400);
    c = await h(page, () => ({ st: window.__h.fmtAt('Conclusion', 2, 3), style: window.__h.styleOf('Conclusion') }));
    check('curseur copié : style, alignement, espacements du paragraphe appliqués', c.style === kantStyle && c.st.align === 'center' && c.st.spaceBefore === 240 && c.st.spaceAfter === 360, JSON.stringify([c.style, kantStyle, c.st.align, c.st.spaceBefore, c.st.spaceAfter]));
    await page.keyboard.press('Control+z');
    await settle(page, 400);
    c = await h(page, () => ({ st: window.__h.fmtAt('Conclusion', 2, 3), style: window.__h.styleOf('Conclusion') }));
    check('⌘Z une fois : paragraphe et caractères annulés ensemble', c.style === null && c.st.align !== 'center' && c.st.spaceBefore === 0, JSON.stringify([c.style, c.st.align, c.st.spaceBefore]));
    // paragraphe entier sélectionné : paragraphe copié aussi
    await h(page, () => {
      const p = window.__h.posOf('Kant dépasse');
      const ed = window.__h.ed();
      const $p = ed.state.doc.resolve(p);
      let d = $p.depth;
      while ($p.node(d).type.name !== 'paragraph') d--;
      ed.commands.setTextSelection({ from: $p.start(d), to: $p.end(d) });
    });
    const fWhole = await h(page, () => window.__ed.engine().copyFormat());
    check('paragraphe entier sélectionné : mise en forme du paragraphe copiée', !!fWhole?.para && fWhole.para.styleId === kantStyle, JSON.stringify(fWhole?.para));

    // capitales, petites capitales, exposant, barré
    await h(page, async () => {
      const e = window.__ed.engine();
      window.__h.select('chose qui pense');
      e.toggleMark('strike');
      await new Promise((r) => setTimeout(r, 150));
      window.__h.select('chose qui pense');
      e.toggleMark('smallCaps');
      await new Promise((r) => setTimeout(r, 200));
      window.__h.select('donc');
      e.toggleMark('superscript');
      await new Promise((r) => setTimeout(r, 200));
    });
    await h(page, () => window.__h.select('chose qui pense', 1, 3));
    await page.keyboard.press('Meta+Alt+KeyC');
    await h(page, () => window.__h.select('perceptions'));
    await page.keyboard.press('Meta+Alt+KeyV');
    await settle(page, 300);
    const sc = await h(page, () => window.__h.fmtAt('perceptions', 2, 3));
    check('petites capitales et barré reproduits', sc.smallCaps && sc.strike, JSON.stringify([sc.smallCaps, sc.strike]));
    await h(page, () => window.__h.select('donc', 1, 2));
    await page.keyboard.press('Meta+Alt+KeyC');
    await h(page, () => window.__h.select('amour'));
    await page.keyboard.press('Meta+Alt+KeyV');
    await settle(page, 300);
    const sup = await h(page, () => window.__h.fmtAt('amour', 1, 2));
    check('exposant reproduit ; la mise en forme précédente de la cible est remplacée', sup.superscript && !sup.smallCaps, JSON.stringify([sup.superscript, sup.smallCaps]));
    // Remplacement : peindre du texte ordinaire sur « succession » (formatée plus haut) l'efface
    await h(page, () => window.__h.select('au contraire', 3, 4));
    await page.keyboard.press('Meta+Alt+KeyC');
    await h(page, () => window.__h.select('succession'));
    await page.keyboard.press('Meta+Alt+KeyV');
    await settle(page, 300);
    const plain = await h(page, () => window.__h.fmtAt('succession', 2, 3));
    check('texte ordinaire peint sur un passage formaté : mise en forme retirée', !plain.bold && !plain.italic && plain.fontFamily !== 'Georgia' && !plain.highlight, JSON.stringify([plain.bold, plain.fontFamily, plain.highlight]));

    // ── Palette de commandes ──
    await h(page, () => window.__h.select('cogito', 2, 2));
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.cmd-input');
    await page.keyboard.type('Copier la mise en forme');
    await settle(page, 200);
    const pal = await h(page, () => [...document.querySelectorAll('.cmd-item, [role="option"]')].map((x) => x.textContent).filter((t) => /mise en forme/.test(t)));
    await page.keyboard.press('Enter');
    await settle(page, 300);
    check('palette : « Copier la mise en forme » (⌥⌘C)', pal.some((t) => /Copier la mise en forme/.test(t) && /⌥⌘C/.test(t)) && /Mise en forme copiée/.test(await toastText(page)), JSON.stringify(pal));
    await h(page, () => window.__h.select('vérité'));
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('.cmd-input');
    await page.keyboard.type('Coller la mise en forme');
    await settle(page, 200);
    await page.keyboard.press('Enter');
    await settle(page, 400);
    const pv = await h(page, () => window.__h.fmtAt('vérité', 1, 2));
    check('palette : « Coller la mise en forme » applique à la sélection', pv.bold && pv.fontFamily === 'Georgia', JSON.stringify([pv.bold, pv.fontFamily]));

    // ── Export Word ──
    const x = await exportDocx(page, path.join(OUT, 'out', 'pinceau.docx'));
    const runOf = (word) => {
      const i = x.document.indexOf(`>${word}<`);
      const s = x.document.lastIndexOf('<w:r>', i) >= 0 ? Math.max(x.document.lastIndexOf('<w:r>', i), x.document.lastIndexOf('<w:r ', i)) : -1;
      return s >= 0 ? x.document.slice(s, i) : '';
    };
    const rv = runOf('vérité');
    check('export Word : gras, Georgia, 14 pt, couleur sur le passage peint', /<w:b ?\/>|<w:b w:val="(1|true)" ?\/>/.test(rv) && /Georgia/.test(rv) && /<w:sz w:val="28" ?\/>/.test(rv) && /8B2E2E/i.test(rv), rv.slice(0, 300));
    check('export Word : relu par python-docx', x.paras.some((p) => p.includes('vérité certaine')));

    check('aucune erreur de page', errors.length === 0, errors.join(' | ').slice(0, 600));
    errors.length = 0;
  } catch (e) {
    console.error(e);
    check('déroulement', false, String(e).slice(0, 300));
    await page.screenshot({ path: path.join(OUT, 'pinceau-echec.png') }).catch(() => {});
  }
});

// ── Windows : Ctrl+Maj+C / Ctrl+Maj+V ──
await withApp(PORT, async (page, errors) => {
  try {
    await page.goto(`http://localhost:${PORT}/?platform=win`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    await newDraft(page, 'Pinceau Windows');
    await buildEssay(page);
    await h(page, () => {
      const e = window.__ed.engine();
      window.__h.select('cogito');
      e.toggleMark('bold');
      e.setFontFamily('Georgia');
    });
    const title = await page.locator('.ed-toolbar [data-tb="painter"]').getAttribute('title');
    check('Windows : infobulle « Ctrl+Maj+C » / « Ctrl+Maj+V »', /Ctrl\+Maj\+C/.test(title) && /Ctrl\+Maj\+V/.test(title), title);
    await h(page, () => window.__h.select('cogito', 2, 2));
    await page.keyboard.press('Control+Alt+KeyC'); // AltGr+C : rien (ni copie, ni « tout effacer » de SuperDoc)
    await settle(page, 200);
    check('Windows : Ctrl+Alt+C (AltGr) ne copie pas et n’efface rien', !/copiée/.test(await toastText(page)) && (await h(page, () => window.__h.fmtAt('cogito', 2, 3).bold)));
    await page.keyboard.press('Control+Shift+KeyC');
    await settle(page, 250);
    check('Windows : Ctrl+Maj+C copie', /Mise en forme copiée/.test(await toastText(page)));
    await h(page, () => window.__h.select('Hume'));
    await page.keyboard.press('Control+Shift+KeyV');
    await settle(page, 300);
    const st = await h(page, () => window.__h.fmtAt('Hume', 1, 2));
    check('Windows : Ctrl+Maj+V applique', st.bold && st.fontFamily === 'Georgia', JSON.stringify([st.bold, st.fontFamily]));
    await page.keyboard.press('Control+z');
    await settle(page, 300);
    check('Windows : Ctrl+Z une fois annule', !(await h(page, () => window.__h.fmtAt('Hume', 1, 2).bold)));
    check('Windows : aucune erreur de page', errors.length === 0, errors.join(' | ').slice(0, 400));
  } catch (e) {
    console.error(e);
    check('déroulement Windows', false, String(e).slice(0, 300));
  }
});

finish();
