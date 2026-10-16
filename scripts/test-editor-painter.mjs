// « Reproduire la mise en forme » (painter.tsx, engine.copyFormat / applyFormat) — port 5406.
// Lancer : timeout 600 node scripts/test-editor-painter.mjs
// Bouton pinceau au début de la barre (après Annuler / Rétablir), infobulle avec ⌥⌘C / ⌥⌘V → un clic :
// copie, bouton actif, curseur pinceau sur la page, la sélection suivante à la souris reçoit la mise en
// forme, puis le mode s'arrête → double-clic : maintenu jusqu'à Échap → ⌥⌘C (toast) / ⌥⌘V (mot sous le
// curseur) → paragraphe (curseur / paragraphe entier) ou caractères seuls (sélection partielle) → une
// seule étape d'annulation → palette de commandes → export Word → barre sur une ligne à 1440 px →
// Windows : Ctrl+Maj+C / Ctrl+Maj+V → capture shots/editeur/pinceau.png.
// Document Word stylé (PART=styled) : aspect CALCULÉ source / cible (titre → corps, corps → titre, couleur
// automatique, surlignage, source mixte, paragraphe entier, curseur seul, bouton, pinceau maintenu, mise en
// page en cours) → captures shots/pinceau/avant.png, apres.png, corps-vers-titre.png.
import { withApp } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, buildEssay, checker, exportDocx, installHelpers, mouseSelect, newDraft, settle } from './ed-helpers.mjs';

const PORT = 5406;
const OUT = path.join(ROOT, 'shots/editeur');
fs.mkdirSync(OUT, { recursive: true });
const { check, finish } = checker();
const h = (page, fn, arg) => page.evaluate(fn, arg);
const painterOn = (page) => page.locator('.ed-toolbar [data-tb="painter"]').evaluate((b) => b.getAttribute('aria-pressed') === 'true');
/** PART=base|styled|win : une seule partie (mise au point). */
const part = (name) => !process.env.PART || process.env.PART === name;
const toastText = (page) => page.evaluate(() => document.querySelector('.toasts')?.textContent ?? '');

if (part('base')) await withApp(PORT, async (page, errors) => {
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
    // curseur : paragraphe copié aussi — appliqué si la cible couvre le paragraphe entier (comme Word)
    await h(page, () => window.__h.select('Kant dépasse', 3, 3));
    await page.keyboard.press('Meta+Alt+KeyC');
    await h(page, () => {
      const p = window.__h.posOf('Conclusion provisoire');
      const ed = window.__h.ed();
      const $p = ed.state.doc.resolve(p);
      let d = $p.depth;
      while ($p.node(d).type.name !== 'paragraph') d--;
      ed.commands.setTextSelection({ from: $p.start(d), to: $p.end(d) });
    });
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

// ── Document Word stylé (« Corps » Times 12, « Titre 1 » Arial 20 gras bleu centré) : on compare l'aspect
//    CALCULÉ des pages peintes (police, taille, graisse, italique, soulignement, couleur, surlignage) entre
//    le caractère source et la cible, sélections faites à la souris ──
const STYLED = path.join(OUT, 'out', 'pinceau-styles.docx');
fs.mkdirSync(path.dirname(STYLED), { recursive: true });
execFileSync('python3', ['-I', '-c', `
import sys, re, zipfile, shutil, docx
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX
d = docx.Document()
st = d.styles
n = st['Normal']; n.font.name = 'Times New Roman'; n.font.size = Pt(12); n.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
h1 = st['Heading 1']; h1.font.name = 'Arial'; h1.font.size = Pt(20); h1.font.bold = True; h1.font.color.rgb = RGBColor(0x1F,0x4E,0x79); h1.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
d.add_paragraph('Méditations métaphysiques', style='Heading 1')
p = d.add_paragraph('Le doute porte sur tout, et la ')
r = p.add_run('première vérité'); r.font.name = 'Georgia'; r.font.size = Pt(14); r.italic = True; r.font.color.rgb = RGBColor(0xC0,0,0)
p.add_run(' tient au cogito.')
d.add_paragraph('Pour Hume, au contraire, il ne rencontre jamais un moi stable.')
p = d.add_paragraph('')
r = p.add_run('Mais'); r.style = st['Strong']
p.add_run(' cette ')
r = p.add_run('certitude'); r.style = st['Emphasis']
p.add_run(' nous ')
r = p.add_run('trompe'); r.underline = True; r.font.highlight_color = WD_COLOR_INDEX.YELLOW
p.add_run(' parfois, dit Kant dans sa critique.')
p = d.add_paragraph('Texte gras rouge du corps.')
for r in p.runs: r.bold = True; r.font.color.rgb = RGBColor(0xC0,0,0)
d.add_paragraph('Dernier paragraphe ordinaire pour la conclusion.')
d.save(sys.argv[1] + '.tmp')
# polices de thème retirées du titre (sinon Calibri Light l'emporte sur Arial)
zin = zipfile.ZipFile(sys.argv[1] + '.tmp'); zout = zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED)
for it in zin.infolist():
    data = zin.read(it.filename)
    if it.filename == 'word/styles.xml':
        data = re.sub(r' w:(asciiTheme|hAnsiTheme|eastAsiaTheme|cstheme)="[^"]*"', '', data.decode()).encode()
    zout.writestr(it, data)
zout.close()
`, STYLED]);

const VIS = () => {
  /** Aspect calculé du caractère `off` du passage (span peint qui le contient). */
  window.__vis = (needle, off = 1) => {
    const r = window.__h.span(needle, off, off + 1);
    if (!r) return 'introuvable : ' + needle;
    const spans = [...document.querySelectorAll('.superdoc-page span[data-pm-start]')].filter((s) => !s.querySelector('[data-pm-start]'));
    const s = spans.find((x) => +x.dataset.pmStart <= r.from && r.from < +x.dataset.pmEnd);
    if (!s) return 'non peint : ' + needle;
    const cs = getComputedStyle(s);
    let bg = cs.backgroundColor;
    let el = s;
    for (let i = 0; i < 3 && bg === 'rgba(0, 0, 0, 0)'; i++) {
      el = el.parentElement;
      if (!el || el.classList.contains('superdoc-line')) break;
      bg = getComputedStyle(el).backgroundColor;
    }
    return { fontFamily: cs.fontFamily.split(',')[0].replace(/"/g, ''), fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, textDecoration: cs.textDecorationLine, color: cs.color, backgroundColor: bg, caps: cs.fontVariantCaps + '/' + cs.textTransform, va: cs.verticalAlign };
  };
  window.__align = (needle) => {
    const r = window.__h.span(needle, 0, 1);
    const line = [...document.querySelectorAll('.superdoc-page .superdoc-line')].find((l) => [...l.querySelectorAll('[data-pm-start]')].some((x) => +x.dataset.pmStart <= r.from && r.from < +x.dataset.pmEnd));
    if (!line) return null;
    const pg = line.closest('.superdoc-page').getBoundingClientRect();
    const box = line.getBoundingClientRect();
    const spans = [...line.querySelectorAll('span[data-pm-start]')].map((x) => x.getBoundingClientRect()).filter((b) => b.width > 0);
    const left = Math.min(...spans.map((b) => b.left));
    const right = Math.max(...spans.map((b) => b.right));
    return { gapLeft: Math.round(left - pg.left), gapRight: Math.round(pg.right - right), lineLeft: Math.round(box.left - pg.left) };
  };
};
const vis = (page, n, o = 1) => page.evaluate(({ n, o }) => window.__vis(n, o), { n, o });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diff = (a, b) => (typeof a !== 'object' || typeof b !== 'object' ? `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}` : Object.keys(a).filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k]} ≠ ${b[k]}`).join(', '));
async function rectsOf(page, needle, a = 0, b = needle.length) {
  const rs = await page.evaluate(({ needle, a, b }) => window.__h.rects(needle, a, b), { needle, a, b });
  if (!rs.length) throw new Error('passage non peint : ' + needle);
  return { a: rs[0], b: rs[rs.length - 1] };
}
const mid = (r) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
/** Clic neutre (ferme la barre de sélection flottante) puis pause : le clic suivant n'est pas compté double. */
async function neutral(page) {
  const r = await rectsOf(page, 'Dernier', 2, 3);
  await page.mouse.click(...mid(r.a));
  await settle(page, 650);
}
async function dbl(page, needle) {
  const r = await rectsOf(page, needle);
  await page.mouse.dblclick(...mid(r.a));
  await settle(page, 300);
}
async function triple(page, needle) {
  const r = await rectsOf(page, needle);
  await page.mouse.click(...mid(r.a), { clickCount: 3 });
  await settle(page, 300);
}
async function drag(page, needle, a = 0, b = needle.length) {
  const r = await rectsOf(page, needle, a, b);
  const y1 = (r.a.top + r.a.bottom) / 2;
  const y2 = (r.b.top + r.b.bottom) / 2;
  await page.mouse.move(r.a.left + 0.5, y1);
  await page.mouse.down();
  await page.mouse.move(r.b.right - 0.5, y2, { steps: 8 });
  await page.mouse.up();
  await settle(page, 400);
}
async function caret(page, needle, a) {
  const r = await rectsOf(page, needle, a, a + 1);
  await page.mouse.click(r.a.left + 0.5, (r.a.top + r.a.bottom) / 2);
  await settle(page, 300);
}
const copyK = (page) => page.keyboard.press('Meta+Alt+KeyC').then(() => settle(page, 300));
const pasteK = (page) => page.keyboard.press('Meta+Alt+KeyV').then(() => settle(page, 600));
const SHOTS = path.join(ROOT, 'shots/pinceau');
fs.mkdirSync(SHOTS, { recursive: true });

if (part('styled')) await withApp(PORT, async (page, errors) => {
  const b64 = fs.readFileSync(STYLED).toString('base64');
  const fresh = async () => {
    const id = await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const before = new Set(window.__store.getState().drafts.map((d) => d.id));
      await window.__store.getState().importFiles([{ name: 'Méditations.docx', data: bin.buffer }]);
      return window.__store.getState().drafts.find((d) => !before.has(d.id))?.id;
    }, b64);
    await page.evaluate(() => window.__store.getState().navigate({ name: 'home' }));
    await settle(page, 300);
    await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
    await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
    await page.waitForSelector('.superdoc-page span[data-pm-start]', { timeout: 60000 });
    await settle(page, 1200);
    await installHelpers(page);
    await page.evaluate(VIS);
  };
  /** Chaque caractère de `checks` doit avoir l'aspect `want`. */
  const looks = async (name, want, checks) => {
    const bad = [];
    for (const [n, o] of checks) {
      const got = await vis(page, n, o);
      if (!same(want, got)) bad.push(`${n}+${o} → ${diff(want, got)}`);
    }
    check(name, !bad.length, bad.join(' | ') || JSON.stringify(want));
  };
  try {
    // 1. Mot de « Titre 1 » → phrase du corps (sélections à la souris, ⌥⌘C / ⌥⌘V) ; captures avant / après
    await fresh();
    const H = await vis(page, 'Méditations', 2);
    const body = await vis(page, 'Hume', 1);
    check('document stylé : le titre et le corps diffèrent bien (police, taille, graisse, couleur)', H.fontFamily !== body.fontFamily && H.fontSize !== body.fontSize && H.fontWeight !== body.fontWeight && H.color !== body.color, JSON.stringify([H, body]));
    await dbl(page, 'Méditations');
    const src1 = await page.evaluate(() => window.__h.sel().text);
    await copyK(page);
    await neutral(page);
    await drag(page, 'Pour Hume, au contraire');
    const tsel = await page.evaluate(() => window.__h.sel().text);
    check('sélections à la souris : source et cible exactes', src1 === 'Méditations' && tsel === 'Pour Hume, au contraire', JSON.stringify([src1, tsel]));
    // capture : la barre flottante de la sélection masquerait le titre source
    const hideBar = await page.addStyleTag({ content: '.ed-selbar { visibility: hidden !important; }' });
    await page.screenshot({ path: path.join(SHOTS, 'avant.png') });
    await hideBar.evaluate((el) => el.remove());
    await pasteK(page);
    await looks('titre → corps : la phrase cible a l’aspect du mot du titre (Arial 20, gras, bleu)', H, [['Pour Hume', 0], ['Hume', 2], ['contraire', 8]]);
    await looks('titre → corps : le reste du paragraphe cible est intact', body, [['il ne rencontre', 3]]);
    const para1 = await page.evaluate(() => [window.__h.styleOf('Hume'), window.__align('Hume')]);
    check('titre → corps (sélection partielle) : le paragraphe cible reste « Corps », non centré', para1[0] === null && para1[1].gapLeft === para1[1].lineLeft, JSON.stringify(para1));
    await neutral(page);
    await page.screenshot({ path: path.join(SHOTS, 'apres.png') });
    console.log('captures: shots/pinceau/avant.png, apres.png');
    // export Word
    const x = await exportDocx(page, path.join(OUT, 'out', 'pinceau-titre-corps.docx'));
    const i = x.document.indexOf('Pour Hume, au contraire');
    const run = x.document.slice(x.document.lastIndexOf('<w:r>', i) >= 0 ? Math.max(x.document.lastIndexOf('<w:r>', i), x.document.lastIndexOf('<w:r ', i)) : 0, i);
    check('export Word : la phrase peinte porte Arial, 20 pt, gras, 1F4E79', /Arial/.test(run) && /<w:sz w:val="40"/.test(run) && /<w:b\/>|<w:b \/>|<w:b w:val="(1|true)"/.test(run) && /1F4E79/i.test(run), run.slice(0, 400));
    // une seule étape d'annulation
    await page.keyboard.press('Control+z');
    await settle(page, 500);
    await looks('⌘Z une fois : la phrase retrouve l’aspect du corps', body, [['Pour Hume', 0], ['contraire', 8]]);
    await looks('⌘Z : le titre source est intact', H, [['Méditations', 2]]);

    // 2. Mot du corps en Georgia 14 rouge italique (direct) → mot du titre : la couleur du style de titre,
    //    sa graisse, sa police et sa taille cèdent
    await fresh();
    const V = await vis(page, 'vérité', 2);
    await dbl(page, 'vérité');
    await copyK(page);
    await neutral(page);
    await dbl(page, 'métaphysiques');
    await pasteK(page);
    await looks('corps (Georgia 14 rouge italique) → titre : le mot du titre a exactement l’aspect source', V, [['métaphysiques', 0], ['métaphysiques', 6], ['métaphysiques', 12]]);
    await looks('corps → titre : l’autre mot du titre est intact', H, [['Méditations', 2]]);
    await neutral(page);
    await page.screenshot({ path: path.join(SHOTS, 'corps-vers-titre.png') });
    console.log('capture: shots/pinceau/corps-vers-titre.png');
    // corps ordinaire → mot du titre : redevient corps (noir, Times 12, maigre)
    await dbl(page, 'Dernier');
    await copyK(page);
    await neutral(page);
    await dbl(page, 'Méditations');
    await pasteK(page);
    const plainBody = await vis(page, 'Dernier', 2);
    await looks('corps ordinaire → mot du titre : il prend l’aspect du corps (couleur automatique comprise)', plainBody, [['Méditations', 2]]);

    // 3. Corps ordinaire → texte gras rouge : redevient corps ordinaire
    await fresh();
    await dbl(page, 'Hume');
    await copyK(page);
    await neutral(page);
    await drag(page, 'Texte gras rouge du corps.');
    await pasteK(page);
    await looks('corps ordinaire → texte gras rouge : il redevient corps ordinaire', body, [['Texte', 0], ['rouge', 2], ['corps.', 3]]);

    // 4. Souligné + surligné → corps
    const T = await vis(page, 'trompe', 2);
    await neutral(page);
    await dbl(page, 'trompe');
    await copyK(page);
    await neutral(page);
    await dbl(page, 'rencontre');
    await pasteK(page);
    await looks('souligné + surligné jaune → corps : reproduits', T, [['rencontre', 0], ['rencontre', 8]]);

    // 5. Source mixte : le premier caractère l'emporte (« Mais » gras par style de caractères, « cette » ordinaire)
    const M = await vis(page, 'Mais', 1);
    await neutral(page);
    await drag(page, 'Mais cette certitude');
    await copyK(page);
    await neutral(page);
    await dbl(page, 'jamais');
    await pasteK(page);
    await looks('source mixte : aspect du premier caractère (gras du style « Strong »)', M, [['jamais', 0], ['jamais', 5]]);
    // style de caractères en italique (Emphasis) → corps
    const E = await vis(page, 'certitude', 2);
    await neutral(page);
    await dbl(page, 'certitude');
    await copyK(page);
    await neutral(page);
    await dbl(page, 'stable');
    await pasteK(page);
    await looks('style de caractères (italique « Emphasis ») → corps : reproduit', E, [['stable', 2]]);

    // 6. Paragraphe « Titre 1 » entier (centré) → paragraphe du corps : style, alignement et caractères
    await fresh();
    await triple(page, 'Méditations');
    const whole = await page.evaluate(() => window.__h.sel().text);
    await copyK(page);
    const cp = await page.evaluate(() => window.__ed.engine().copyFormat());
    await neutral(page);
    await triple(page, 'Pour Hume');
    await pasteK(page);
    const p6 = await page.evaluate(() => [window.__h.styleOf('Hume'), window.__h.fmtAt('Hume', 0, 1).align, window.__align('Hume')]);
    check('paragraphe « Titre 1 » entier → paragraphe du corps : style « Titre 1 » et centrage', /Méditations métaphysiques/.test(whole) && cp?.para?.styleId === 'Heading1' && p6[0] === 'Heading1' && p6[1] === 'center' && Math.abs(p6[2].gapLeft - p6[2].gapRight) < 40, JSON.stringify([whole, cp?.para, p6]));
    await looks('paragraphe entier → paragraphe : les caractères ont l’aspect du titre', H, [['Pour Hume', 0], ['stable', 2]]);
    await page.keyboard.press('Control+z');
    await settle(page, 500);
    const p6u = await page.evaluate(() => [window.__h.styleOf('Hume'), window.__h.fmtAt('Hume', 0, 1).align]);
    check('⌘Z une fois : style de paragraphe et caractères annulés ensemble', p6u[0] === null && p6u[1] === 'justify' && same(await vis(page, 'Hume', 1), body), JSON.stringify(p6u));

    // 7. Cible : simple curseur → le mot sous le curseur, et lui seul
    await fresh();
    await dbl(page, 'vérité');
    await copyK(page);
    await neutral(page);
    await caret(page, 'contraire', 4);
    await pasteK(page);
    await looks('curseur seul : le mot sous le curseur prend l’aspect source', V, [['contraire', 0], ['contraire', 8]]);
    await looks('curseur seul : les mots voisins sont intacts', body, [['au contraire', 0], ['il ne', 0]]);

    // 8. Bouton (un clic) puis sélection au glisser : appliqué à la sélection FINALE, au relâchement
    await fresh();
    await dbl(page, 'Méditations');
    await page.click('.ed-toolbar [data-tb="painter"]');
    await settle(page, 250);
    await drag(page, 'il ne rencontre jamais');
    await settle(page, 300);
    await looks('bouton + glisser : la sélection finale reçoit l’aspect du titre', H, [['il ne', 0], ['rencontre', 4], ['jamais', 5]]);
    await looks('bouton + glisser : rien au-delà de la sélection', body, [['un moi', 1], ['contraire', 3]]);
    check('bouton (un clic) : le mode s’arrête', !(await painterOn(page)));

    // 9. Double-clic : trois sélections, puis Échap (la copie est celle de la sélection courante, pas l'ancienne)
    await neutral(page);
    await dbl(page, 'vérité');
    await page.dblclick('.ed-toolbar [data-tb="painter"]');
    await settle(page, 300);
    await drag(page, 'Dernier paragraphe');
    await dbl(page, 'critique');
    await drag(page, 'Le doute');
    await looks('pinceau maintenu : trois sélections reçoivent l’aspect source', V, [['Dernier', 1], ['paragraphe', 5], ['critique', 3], ['Le doute', 0], ['doute', 3]]);
    check('pinceau maintenu : toujours actif après trois applications', await painterOn(page));
    await page.keyboard.press('Escape');
    await settle(page, 200);
    await drag(page, 'conclusion');
    check('Échap : désarmé, la sélection suivante ne reçoit rien', !(await painterOn(page)) && same(await vis(page, 'conclusion', 3), body), JSON.stringify(await vis(page, 'conclusion', 3)));

    // 10. Mise en page en cours (réglage de page) : ⌥⌘C / ⌥⌘V et la commande de menu ne doivent ni tomber
    //     dans SuperDoc (⌘⌥C = « tout effacer », style de paragraphe compris) ni être perdus : ils sont
    //     exécutés à la fin de la mise en page
    await fresh();
    const busyNow = () => page.evaluate(() => !!document.querySelector('[aria-label="Mise en page en cours"]'));
    const startLayout = async (preset) => {
      await page.click('.ed-topbar [data-tb="page"]');
      await page.waitForSelector('.ed-page-setup');
      await page.evaluate((m) => document.querySelector(`.ed-page-setup [data-margins="${m}"]`).click(), preset);
      await page.waitForFunction(() => !!document.querySelector('[aria-label="Mise en page en cours"]'), null, { timeout: 5000 });
      await page.evaluate(() => window.__h.ed().view.focus());
    };
    const endLayout = async () => {
      await page.waitForFunction(() => !document.querySelector('[aria-label="Mise en page en cours"]'), null, { timeout: 30000 });
      await settle(page, 600);
      await page.keyboard.press('Escape');
      await settle(page, 200);
    };
    await dbl(page, 'Méditations');
    await startLayout('narrow');
    const b1 = await busyNow();
    await page.keyboard.press('Meta+Alt+KeyC');
    await endLayout();
    const h10 = await vis(page, 'Méditations', 2);
    check('mise en page en cours : ⌥⌘C n’efface pas la mise en forme du titre (SuperDoc n’est pas atteint)', b1 && same(h10, H) && (await page.evaluate(() => window.__h.styleOf('Méditations'))) === 'Heading1', JSON.stringify([b1, h10]));
    await neutral(page);
    await dbl(page, 'rencontre');
    await startLayout('wide');
    const b2 = await busyNow();
    await page.keyboard.press('Meta+Alt+KeyV');
    const early = await vis(page, 'rencontre', 3);
    await endLayout();
    await looks('mise en page en cours : ⌥⌘V est appliqué à la fin de la mise en page (copie faite pendant)', H, [['rencontre', 0], ['rencontre', 8]]);
    check('mise en page en cours : rien n’est appliqué pendant (ni collage brut)', b2 && same(early, body) && (await page.evaluate(() => window.__h.ed().state.doc.textContent)).includes('il ne rencontre jamais un moi stable.'), JSON.stringify([b2, early]));
    await neutral(page);
    await dbl(page, 'jamais');
    await startLayout('narrow');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('marginalia:format-painter', { detail: 'paste' })));
    await endLayout();
    await looks('mise en page en cours : la commande de menu « Coller la mise en forme » est exécutée ensuite', H, [['jamais', 0], ['jamais', 5]]);
    await page.keyboard.press('Control+z');
    await settle(page, 500);
    await looks('mise en page en cours : un ⌘Z annule l’application différée', body, [['jamais', 0]]);

    check('document stylé : aucune erreur de page', errors.length === 0, errors.join(' | ').slice(0, 600));
    errors.length = 0;
  } catch (e) {
    console.error(e);
    check('déroulement (document stylé)', false, String(e).slice(0, 300));
    await page.screenshot({ path: path.join(SHOTS, 'echec.png') }).catch(() => {});
  }
});

// ── Windows : Ctrl+Maj+C / Ctrl+Maj+V ──
if (part('win')) await withApp(PORT, async (page, errors) => {
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
