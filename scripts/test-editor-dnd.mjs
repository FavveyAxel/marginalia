// Glisser-déposer du texte sélectionné dans l'écrit (dragText.tsx, engine.dragSource / dropTarget / moveText) — port 5407.
// Lancer : timeout 600 node scripts/test-editor-dnd.mjs
// Vrais glisser à la souris (pas à pas) : déplacer un mot (espaces à la Word), d'un paragraphe à l'autre,
// une seule étape d'annulation, texte déposé sélectionné → ⌥ en relâchant = copier (+ sur le fantôme) →
// relâcher dans la sélection / Échap = annuler → clic dans la sélection = curseur ; sélection ordinaire
// depuis l'extérieur → paragraphes entiers avec leur style (trait horizontal) → retour à la ligne et
// paragraphes coupés, appel de note, commentaire → ¶ et mode concentration → image non interceptée →
// défilement automatique à travers une fin de page → export Word → Windows (Alt) → captures
// shots/editeur/glisser.png et glisser-copie.png.
import { withApp } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, buildEssay, checker, exportDocx, mouseSelect, newDraft, settle } from './ed-helpers.mjs';

const PORT = 5407;
const OUT = path.join(ROOT, 'shots/editeur');
fs.mkdirSync(OUT, { recursive: true });
const { check, finish } = checker();
const h = (page, fn, arg) => page.evaluate(fn, arg);

/** Centre de la sélection courante (premier rectangle). */
const selCenter = (page) =>
  h(page, () => {
    const r = window.__ed.engine().selectionRects()[0];
    return r ? { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 } : null;
  });
/** Point juste avant le caractère `a` du passage `needle`. */
const pointAt = (page, needle, a = 0) =>
  h(
    page,
    ({ needle, a }) => {
      const r = window.__h.rect(needle, a, a + 1);
      return r ? { x: r.left + 1, y: (r.top + r.bottom) / 2 } : null;
    },
    { needle, a },
  );
/** Glisser réel : appui, petits pas, déplacement, (⌥), relâcher. */
async function drag(page, from, to, { alt = false, altKey = 'Alt', beforeUp = null, steps = 14 } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 6, from.y + 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps });
  if (alt) {
    await page.keyboard.down(altKey);
    await page.mouse.move(to.x + 1, to.y, { steps: 1 });
  }
  if (beforeUp) await beforeUp();
  await page.mouse.up();
  if (alt) await page.keyboard.up(altKey);
  await settle(page, 350);
}
const paras = (page) => h(page, () => window.__h.paras());

await withApp(PORT, async (page, errors) => {
  try {
    await newDraft(page, 'Glisser');
    await buildEssay(page);
    const before = await paras(page);

    // ── Déplacer un mot dans son paragraphe (espaces à la Word) ──
    await h(page, () => window.__h.select('provisoire'));
    let from = await selCenter(page);
    let to = await pointAt(page, 'Conclusion', 0);
    await drag(page, from, to, {
      beforeUp: async () => {
        const mid = await h(page, () => ({
          ghost: document.querySelector('.ed-drag-ghost')?.textContent ?? '',
          caret: !!document.querySelector('.ed-drop-caret:not([style*="display: none"])'),
          html: document.documentElement.classList.contains('ed-text-dragging'),
        }));
        check('pendant le glisser : fantôme du texte, trait d’insertion, curseur de glisser', mid.ghost.startsWith('provisoire') && mid.caret && mid.html, JSON.stringify(mid));
      },
    });
    let p = await paras(page);
    check('mot déplacé au début du paragraphe, espaces corrigés (comme Word)', p.includes('provisoire Conclusion : la conscience de soi est moins une chose qu’une activité, celle qui unifie l’expérience.'), p[p.length - 1]);
    check('texte déposé sélectionné', (await h(page, () => window.__h.sel().text)) === 'provisoire');
    check('fin du glisser : fantôme et trait retirés', await h(page, () => !document.querySelector('.ed-drag-ghost, .ed-drop-caret') && !document.documentElement.classList.contains('ed-text-dragging')));
    await page.keyboard.press('Control+z');
    await settle(page, 300);
    check('⌘Z une fois : retour exact au texte d’origine', JSON.stringify(await paras(page)) === JSON.stringify(before), JSON.stringify((await paras(page)).slice(-1)));

    // ── D'un paragraphe à l'autre ──
    await h(page, () => window.__h.select('au contraire, '));
    from = await selCenter(page);
    to = await pointAt(page, 'dépasse', 0);
    await drag(page, from, to);
    p = await paras(page);
    check('passage déplacé vers un autre paragraphe', p.some((t) => t.startsWith('Pour Hume, l’introspection')) && p.some((t) => t.startsWith('Kant au contraire, dépasse')), JSON.stringify(p.slice(2, 4)));
    await page.keyboard.press('Control+z');
    await settle(page, 300);
    check('⌘Z : une seule étape', JSON.stringify(await paras(page)) === JSON.stringify(before));

    // ── ⌥ en relâchant : copier ──
    await h(page, () => window.__h.select('Kant'));
    from = await selCenter(page);
    to = await pointAt(page, 'Hume,', 0);
    await drag(page, from, to, {
      alt: true,
      beforeUp: async () => {
        const st = await h(page, () => ({ copy: document.documentElement.classList.contains('ed-text-drag-copy'), plus: getComputedStyle(document.querySelector('.ed-drag-ghost-plus')).display }));
        check('⌥ pendant le glisser : curseur « + » et « + » sur le fantôme', st.copy && st.plus !== 'none', JSON.stringify(st));
      },
    });
    p = await paras(page);
    check('⌥ en relâchant : copie (la source reste)', p.some((t) => t.startsWith('Pour Kant Hume,')) && p.some((t) => t.startsWith('Kant dépasse')), JSON.stringify(p.slice(2, 4)));
    await page.keyboard.press('Control+z');
    await settle(page, 300);
    check('copie annulée en une étape', JSON.stringify(await paras(page)) === JSON.stringify(before));

    // ── Annuler : relâcher dans la sélection, Échap ──
    await h(page, () => window.__h.select('première vérité certaine'));
    from = await selCenter(page);
    const inside = await pointAt(page, 'vérité', 3);
    await drag(page, from, inside);
    check('relâcher dans la sélection : rien ne bouge', JSON.stringify(await paras(page)) === JSON.stringify(before));
    await h(page, () => window.__h.select('première vérité certaine'));
    from = await selCenter(page);
    to = await pointAt(page, 'activité', 0);
    await drag(page, from, to, { beforeUp: () => page.keyboard.press('Escape') });
    check('Échap pendant le glisser : annulé (le relâcher ne dépose rien)', JSON.stringify(await paras(page)) === JSON.stringify(before) && !(await h(page, () => !!document.querySelector('.ed-drag-ghost'))));

    // ── Clic dans la sélection : curseur ; sélection ordinaire depuis l'extérieur ──
    await h(page, () => window.__h.select('première vérité certaine'));
    const click = await pointAt(page, 'vérité', 2);
    await page.mouse.click(click.x, click.y);
    await settle(page, 300);
    const sel = await h(page, () => ({ s: window.__h.sel(), at: window.__h.posOf('vérité') }));
    check('clic sans glisser dans la sélection : curseur placé au clic', sel.s.from === sel.s.to && Math.abs(sel.s.from - (sel.at + 2)) <= 1, JSON.stringify(sel));
    await h(page, () => window.__h.select('première vérité certaine'));
    await mouseSelect(page, 'succession');
    await settle(page, 250);
    check('sélection à la souris commencée hors de la sélection : sélection ordinaire', (await h(page, () => window.__h.sel().text)) === 'succession' && JSON.stringify(await paras(page)) === JSON.stringify(before));
    // double-clic dans la sélection : mot (SuperDoc)
    await h(page, () => window.__h.select('première vérité certaine'));
    const dbl = await pointAt(page, 'vérité', 2);
    await page.mouse.dblclick(dbl.x, dbl.y);
    await settle(page, 300);
    check('double-clic dans la sélection : sélectionne le mot', (await h(page, () => window.__h.sel().text)).trim() === 'vérité', await h(page, () => window.__h.sel().text));

    // ── Paragraphes entiers : avec leur style, entre deux paragraphes ──
    await h(page, async () => {
      window.__h.select('Conclusion', 2, 2);
      await window.__ed.engine().setParagraphStyle('quote');
      await new Promise((r) => setTimeout(r, 250));
    });
    const quoteId = await h(page, () => window.__h.styleOf('Conclusion'));
    await h(page, () => {
      const ed = window.__h.ed();
      const a = window.__h.posOf('Kant dépasse');
      const b = window.__h.posOf('l’expérience.') + 'l’expérience.'.length;
      ed.commands.setTextSelection({ from: a, to: b });
    });
    from = await selCenter(page);
    to = await pointAt(page, 'Descartes', 1);
    let blockSeen = null;
    await drag(page, from, to, {
      beforeUp: async () => {
        blockSeen = await h(page, () => {
          const c = document.querySelector('.ed-drop-caret');
          return c ? { block: c.classList.contains('block'), w: c.getBoundingClientRect().width } : null;
        });
      },
    });
    p = await paras(page);
    check('paragraphes entiers : trait horizontal entre deux paragraphes', blockSeen?.block && blockSeen.w > 200, JSON.stringify(blockSeen));
    check('paragraphes entiers déplacés avant le paragraphe visé, dans l’ordre', p[1].startsWith('Kant dépasse') && p[2].startsWith('Conclusion') && p[3].startsWith('Descartes') && p.length === before.length, JSON.stringify(p.map((t) => t.slice(0, 12))));
    check('paragraphes entiers : style conservé (Citation)', (await h(page, () => window.__h.styleOf('Conclusion'))) === quoteId && quoteId);
    await page.keyboard.press('Control+z');
    await settle(page, 300);
    check('⌘Z : paragraphes remis en place', (await paras(page))[1].startsWith('Descartes'));

    // ── Retour à la ligne et passage à cheval sur deux paragraphes ──
    await h(page, () => {
      const ed = window.__h.ed();
      const p0 = window.__h.posOf('sans être lui-même');
      ed.commands.setTextSelection({ from: p0, to: p0 });
      ed.commands.insertLineBreak();
    });
    await settle(page, 300);
    const brk0 = await h(page, () => window.__h.count('lineBreak') + window.__h.count('hardBreak'));
    const nPara = (await paras(page)).length;
    await h(page, () => {
      const ed = window.__h.ed();
      const a = window.__h.posOf('toutes mes représentations');
      const b = window.__h.posOf('Conclusion') + 'Conclusion'.length;
      ed.commands.setTextSelection({ from: a, to: b });
    });
    const moved = await h(page, () => window.__h.sel().text);
    from = await selCenter(page);
    to = await pointAt(page, 'fait du cogito', 0);
    await drag(page, from, to);
    p = await paras(page);
    const brk1 = await h(page, () => window.__h.count('lineBreak') + window.__h.count('hardBreak'));
    check('retour à la ligne (⇧↩) et coupure de paragraphe conservés dans le passage déplacé', brk0 >= 1 && brk1 === brk0 && p.length === nPara && p.some((t) => t.startsWith('Descartes toutes mes représentations,')), JSON.stringify({ brk0, brk1, n: [nPara, p.length], moved, p1: p[1].slice(0, 60) }));
    await page.keyboard.press('Control+z');
    await settle(page, 300);
    check('⌘Z : passage à cheval remis en place', (await paras(page)).length === nPara && (await h(page, () => window.__h.posOf('Descartes fait du cogito'))) !== null);

    // ── Appel de note et commentaire suivent le texte ──
    await h(page, () => {
      const e = window.__ed.engine();
      window.__h.select('certaine', 8, 8);
      e.insertFootnote();
    });
    await settle(page, 400);
    // la saisie de la note s'ouvre : texte de la note, puis retour dans le texte
    await page.keyboard.type('Méditations métaphysiques, II.');
    await settle(page, 300);
    await h(page, () => {
      try {
        window.__ed.engine().presentation().exitActiveStorySurface?.();
      } catch {
        /* pas de session */
      }
    });
    await settle(page, 300);
    await h(page, () => {
      const e = window.__ed.engine();
      const a = window.__h.posOf('succession');
      e.addComment({ from: a, to: a + 'succession'.length }, 'À nuancer avec Kant');
    });
    await settle(page, 400);
    await h(page, () => {
      const ed = window.__h.ed();
      const a = window.__h.posOf('première vérité certaine');
      // jusqu'après l'appel de note
      let end = a;
      ed.state.doc.nodesBetween(a, a + 80, (n, pos) => {
        if (n.type.name === 'footnoteReference' && end === a) end = pos + n.nodeSize;
        return true;
      });
      ed.commands.setTextSelection({ from: a, to: end });
      ed.view.focus();
    });
    await settle(page, 200);
    from = await selCenter(page);
    to = await pointAt(page, 'activité', 0);
    await drag(page, from, to);
    const fn = await h(page, () => {
      const ed = window.__h.ed();
      let refPara = '';
      ed.state.doc.descendants((n, pos) => {
        if (n.type.name === 'footnoteReference') refPara = ed.state.doc.resolve(pos).node(1).textContent;
        return true;
      });
      return { n: window.__h.count('footnoteReference'), refPara };
    });
    check('appel de note déplacé avec son texte (un seul appel)', fn.n === 1 && /qu’une première vérité certaine/.test(fn.refPara), JSON.stringify(fn));
    await h(page, () => window.__h.select('succession', -4, 'succession'.length)); // « une succession » (le commentaire coupe le texte)
    from = await selCenter(page);
    to = await pointAt(page, 'stable', 0);
    await drag(page, from, to);
    const cm = await h(page, () => window.__ed.engine().listComments().map((c) => ({ q: c.quote, t: c.text })));
    p = await paras(page);
    check('commentaire déplacé avec son passage', cm.length === 1 && cm[0].q === 'succession' && p.some((t) => /moi une succession stable/.test(t)), JSON.stringify({ cm, p: p.find((t) => t.startsWith('Pour Hume')) }));

    // ── Export Word : le déplacement est dans le fichier ──
    const x = await exportDocx(page, path.join(OUT, 'out', 'glisser.docx'));
    check('export Word : texte déplacé, note et commentaire présents', x.paras.some((t) => /qu’une première vérité certaine/.test(t)) && /<w:footnoteReference/.test(x.document) && /<w:commentRangeStart|<w:commentReference/.test(x.document) && /À nuancer avec Kant/.test(x.comments), JSON.stringify(x.paras.slice(0, 6)).slice(0, 300));

    // ── ¶ et mode concentration ──
    await h(page, () => window.__store.getState().updateSettings({ showFormatMarks: true }));
    await page.keyboard.press('Meta+Shift+KeyF');
    await settle(page, 600);
    const modes = await h(page, () => ({ marks: !!document.querySelector('.ed-mk-para'), focus: !!document.querySelector('.ed-root.ed-focus') }));
    await h(page, () => window.__h.select('chaleur'));
    from = await selCenter(page);
    to = await pointAt(page, 'froid', 0);
    await drag(page, from, to);
    p = await paras(page);
    check('avec ¶ et en mode concentration', modes.marks && modes.focus && p.some((t) => /de ou de chaleur froid/.test(t)), JSON.stringify({ modes, p: p.find((t) => t.startsWith('Pour Hume')) }));
    await page.keyboard.press('Meta+Shift+KeyF');
    await h(page, () => window.__store.getState().updateSettings({ showFormatMarks: false }));
    await settle(page, 400);

    // ── Image : l'appui sur une image n'est pas pris pour un glisser de texte ──
    const img = await h(page, async () => {
      const e = window.__ed.engine();
      window.__h.select('Kant dépasse', 0, 0);
      const c = document.createElement('canvas');
      c.width = 60;
      c.height = 40;
      const g = c.getContext('2d');
      g.fillStyle = '#3d6fe0';
      g.fillRect(0, 0, 60, 40);
      e.insertImage(c.toDataURL('image/png'), 60, 40, 'carré');
      await new Promise((r) => setTimeout(r, 600));
      const ed = window.__h.ed();
      const a = window.__h.posOf('Kant dépasse');
      ed.commands.setTextSelection({ from: Math.max(1, a - 4), to: a + 10 });
      await new Promise((r) => setTimeout(r, 200));
      const el = document.querySelector('.superdoc-page img');
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true });
      el.dispatchEvent(ev);
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      return { found: true, ghost: !!document.querySelector('.ed-drag-ghost') };
    });
    check('appui sur une image : laissé à SuperDoc (pas de glisser de texte)', img.found && !img.ghost, JSON.stringify(img));

    // ── Captures (thème clair, 1440 × 900), sur un écrit neuf ──
    await newDraft(page, 'La conscience de soi');
    await buildEssay(page);
    await h(page, () => window.__h.select('Mais cette certitude ne dit encore rien de ce que je suis, sinon une chose qui pense.'));
    from = await selCenter(page);
    to = await pointAt(page, 'Conclusion', 0);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 6, from.y + 3, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 16 });
    await settle(page, 250);
    await page.screenshot({ path: path.join(OUT, 'glisser.png') });
    console.log('capture: shots/editeur/glisser.png');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settle(page, 300);
    await h(page, () => window.__h.select('je pense, donc je suis'));
    from = await selCenter(page);
    to = await pointAt(page, 'doit pouvoir', 0);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 6, from.y + 3, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 16 });
    await page.keyboard.down('Alt');
    await page.mouse.move(to.x + 1, to.y, { steps: 1 });
    await settle(page, 250);
    await page.screenshot({ path: path.join(OUT, 'glisser-copie.png') });
    console.log('capture: shots/editeur/glisser-copie.png');
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await settle(page, 300);
    p = await paras(page);
    check('capture « copie » : le passage est copié à l’endroit visé', p.some((t) => /je pense, donc je suis doit pouvoir/.test(t)) && p.some((t) => /: je pense, donc je suis\./.test(t)), JSON.stringify(p.find((t) => t.startsWith('Kant'))));

    check('aucune erreur de page', errors.length === 0, errors.join(' | ').slice(0, 600));
    errors.length = 0;
  } catch (e) {
    console.error(e);
    check('déroulement', false, String(e).slice(0, 300));
    await page.screenshot({ path: path.join(OUT, 'glisser-echec.png') }).catch(() => {});
  }
});

// ── Long écrit : défilement automatique à travers une fin de page ──
await withApp(PORT, async (page, errors) => {
  try {
    await newDraft(page, 'Long');
    await h(page, async () => {
      const e = window.__ed.engine();
      for (let i = 1; i <= 70; i++) e.appendParagraph(`Paragraphe ${i} : une phrase assez longue pour remplir la ligne, afin que le texte s’étende sur plusieurs pages de l’écrit.`);
      await new Promise((r) => setTimeout(r, 1200));
    });
    await h(page, () => window.__h.select('Paragraphe 2 ', 0, 'Paragraphe 2'.length));
    const from = await selCenter(page);
    const sc = await h(page, () => {
      const s = document.querySelector('.ed-scroll');
      const r = s.getBoundingClientRect();
      return { top: s.scrollTop, bottom: r.bottom, left: r.left + r.width / 2 };
    });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 6, from.y + 3, { steps: 3 });
    await page.mouse.move(from.x, sc.bottom - 8, { steps: 12 });
    // le pointeur reste près du bord bas : la page défile (jusqu'à la 2e page, puis il remonte au milieu)
    let st = sc.top;
    for (let i = 0; i < 80 && st < sc.top + 700; i++) {
      await page.mouse.move(from.x + (i % 2), sc.bottom - 8);
      await page.waitForTimeout(40);
      st = await h(page, () => document.querySelector('.ed-scroll').scrollTop);
    }
    await page.mouse.move(from.x, (sc.bottom + from.y) / 2, { steps: 4 });
    await settle(page, 300);
    st = await h(page, () => document.querySelector('.ed-scroll').scrollTop);
    check('près du bord bas : défilement automatique', st > sc.top + 400, `${sc.top} → ${st}`);
    // cible : un paragraphe peint sur la 2e page, visible
    const tgt = await h(page, () => {
      const s = document.querySelector('.ed-scroll').getBoundingClientRect();
      for (let n = 3; n <= 70; n++) {
        const r = window.__h.rect(`Paragraphe ${n} :`, 0, 1);
        if (!r || r.top < s.top + 80 || r.bottom > s.bottom - 80) continue;
        const x = r.left + 1;
        const y = (r.top + r.bottom) / 2;
        const pg = document.elementFromPoint(x, y)?.closest('.superdoc-page')?.getAttribute('data-page-index');
        if (pg && pg !== '0') return { n, x, y, page: pg };
      }
      return null;
    });
    if (!tgt) throw new Error('aucun paragraphe de la 2e page visible');
    await page.mouse.move(tgt.x, tgt.y, { steps: 10 });
    await settle(page, 200);
    await page.mouse.up();
    await settle(page, 400);
    const p = await h(page, () => window.__h.paras());
    const moved = p.find((t) => t.includes(`Paragraphe 2Paragraphe ${tgt.n}`) || t.includes(`Paragraphe 2 Paragraphe ${tgt.n}`));
    check('déposé sur la page suivante après défilement (fin de page franchie)', !!moved && !p.some((t) => t.startsWith('Paragraphe 2 :')), JSON.stringify({ n: tgt.n, moved }));
    await page.keyboard.press('Control+z');
    await settle(page, 300);
    check('⌘Z : retour en place', (await h(page, () => window.__h.paras())).some((t) => t.startsWith('Paragraphe 2 :')));
    check('long écrit : aucune erreur de page', errors.length === 0, errors.join(' | ').slice(0, 400));
  } catch (e) {
    console.error(e);
    check('déroulement long écrit', false, String(e).slice(0, 300));
  }
});

// ── Windows : Alt en relâchant = copier ──
await withApp(PORT, async (page, errors) => {
  try {
    await page.goto(`http://localhost:${PORT}/?platform=win`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    await newDraft(page, 'Glisser Windows');
    await buildEssay(page);
    await h(page, () => window.__h.select('Kant'));
    let from = await selCenter(page);
    let to = await pointAt(page, 'Hume,', 0);
    await drag(page, from, to, { alt: true });
    let p = await paras(page);
    check('Windows : Alt en relâchant = copier', p.some((t) => t.startsWith('Pour Kant Hume,')) && p.some((t) => t.startsWith('Kant dépasse')), JSON.stringify(p.slice(2, 4)));
    await page.keyboard.press('Control+z');
    await settle(page, 300);
    await h(page, () => window.__h.select('Kant'));
    from = await selCenter(page);
    to = await pointAt(page, 'Hume,', 0);
    await drag(page, from, to);
    p = await paras(page);
    check('Windows : sans Alt = déplacer', p.some((t) => t.startsWith('Pour Kant Hume,')) && !p.some((t) => t.startsWith('Kant dépasse')), JSON.stringify(p.slice(2, 4)));
    check('Windows : aucune erreur de page', errors.length === 0, errors.join(' | ').slice(0, 400));
  } catch (e) {
    console.error(e);
    check('déroulement Windows', false, String(e).slice(0, 300));
  }
});

finish();
