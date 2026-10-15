// Marques de mise en forme de l'éditeur (marks.tsx) — port 5404.
// Lancer : timeout 400 node scripts/test-editor-marks.mjs
// Désactivées par défaut → bouton ¶ et ⌘8 (Ctrl+Maj+8 sous Windows) → ¶ sur chaque paragraphe
// (vides compris), · espaces, ° insécables, → tabulations, ↵ retours à la ligne → étiquettes de
// marge seulement là où style / police / taille / alignement changent → pointillé sous un passage
// Georgia 14 → aucune incidence sur la mise en page (rectangles identiques) → frappe suivie →
// carte « Mise en forme » (mixte) → réglage conservé après rechargement → exports sans marques →
// long écrit (300 paragraphes) : frappe fluide → captures clair / sombre / sépia.
import { withApp } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'shots/editor-marks');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5404;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('capture:', path.relative(ROOT, path.join(OUT, name)));
}
async function openDraft(page, id) {
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(900);
}
const marksOn = (page) => page.evaluate(() => !!window.__store.getState().settings.showFormatMarks);
const settle = (page, ms = 350) => page.waitForTimeout(ms);

/** Construit l'écrit de test (positions recherchées par le début du texte). */
async function buildDoc(page) {
  await page.evaluate(async () => {
    const e = window.__ed.engine();
    const ed = e.debugEditor().editor;
    const find = (pre) => {
      let p = null;
      ed.state.doc.forEach((n, pos) => {
        if (p == null && n.textContent.startsWith(pre)) p = pos;
      });
      return p;
    };
    const caret = (pre, off) => {
      const p = find(pre);
      ed.commands.setTextSelection({ from: p + off, to: p + off });
    };
    e.appendParagraph('Titre du devoir');
    e.appendParagraph('');
    e.appendParagraph('Premier paragraphe du corps avec quelques mots.');
    e.appendParagraph('Second paragraphe identique au premier par la forme.');
    e.appendParagraph('Un deux trois quatre');
    e.appendParagraph('Passage mixte ici puis la suite du texte.');
    e.appendParagraph('Tab ici et retour ensuite');
    e.appendParagraph('');
    e.appendParagraph('Paragraphe entier plus grand.');
    e.appendParagraph('Après le grand, retour au corps.');
    e.appendParagraph('Conclusion centrée');
    caret('Titre du devoir', 2);
    await e.setParagraphStyle('h1');
    // passage en Georgia 14 au milieu d'une ligne
    let p = find('Passage mixte');
    const t = 'Passage mixte ici puis';
    const i = t.indexOf('mixte');
    ed.commands.setTextSelection({ from: p + 2 + i, to: p + 2 + i + 'mixte ici'.length });
    e.setFontFamily('Georgia');
    e.setFontSize(14);
    // tabulation + retour à la ligne manuel
    caret('Tab ici', 2 + 3);
    ed.commands.insertTabNode();
    p = find('Tab');
    ed.commands.setTextSelection({ from: p + 2 + 'Tab ici et'.length + 1, to: p + 2 + 'Tab ici et'.length + 1 });
    ed.commands.insertLineBreak();
    // paragraphe entier en 16 pt
    p = find('Paragraphe entier');
    ed.commands.setTextSelection({ from: p + 1, to: p + ed.state.doc.nodeAt(p).nodeSize - 1 });
    e.setFontSize(16);
    caret('Conclusion', 2);
    e.setAlign('center');
    // espace insécable
    caret('Un deux', 2 + 'Un deux trois quatre'.length);
    e.insertText(' !');
  });
  await settle(page, 800);
}

/** Rectangles des lignes, passages et pages peints (comparaison avec / sans marques). */
const rects = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.superdoc-page, .superdoc-page .superdoc-line, .superdoc-page .superdoc-text-run')].map((el) => {
      const r = el.getBoundingClientRect();
      return [el.className.split(' ')[0], el.textContent.length, +r.left.toFixed(2), +r.top.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)].join(',');
    }),
  );

/** Par paragraphe du corps : sa dernière ligne peinte porte-t-elle un ¶ ? */
const paraMarks = (page) =>
  page.evaluate(() => {
    const list = window.__ed.engine().paragraphFormats();
    const lines = [...document.querySelectorAll('.superdoc-page .superdoc-line')].filter((l) => !l.closest('.superdoc-page-header, .superdoc-page-footer'));
    return list.map((f) => {
      const mine = lines.filter((l) => Number(l.dataset.pmStart) >= f.pos && Number(l.dataset.pmStart) < f.end);
      if (!mine.length) return { pos: f.pos, painted: false };
      const last = mine.reduce((a, b) => (Number(b.dataset.pmEnd) >= Number(a.dataset.pmEnd) ? b : a));
      return { pos: f.pos, painted: true, empty: f.empty, para: mine.filter((l) => l.querySelector('.ed-mk-para')).length, isLast: !!last.querySelector('.ed-mk-para') };
    });
  });

/** Ligne peinte contenant `needle`. */
const lineInfo = (page, needle) =>
  page.evaluate((needle) => {
    const line = [...document.querySelectorAll('.superdoc-page .superdoc-line')].find((l) => (l.textContent || '').includes(needle));
    if (!line) return null;
    const runs = [...line.querySelectorAll('.superdoc-text-run')];
    const textRight = Math.max(...runs.map((r) => r.getBoundingClientRect().right));
    const para = line.querySelector('.ed-mk-para');
    return {
      text: line.textContent,
      sp: line.querySelectorAll('.ed-mk-sp').length,
      nb: line.querySelectorAll('.ed-mk-nb').length,
      tab: line.querySelectorAll('.ed-mk-tab').length,
      br: line.querySelectorAll('.ed-mk-br').length,
      run: line.querySelectorAll('.ed-mk-run').length,
      para: !!para,
      paraGap: para ? para.getBoundingClientRect().left - textRight : null,
      runTitles: runs.map((r) => r.title).filter(Boolean),
    };
  }, needle);

/** Mêmes glyphes, aux arrondis sous-pixel près (0,1 px). */
function sameGlyphs(a, b) {
  const num = /-?\d+\.\d+/g;
  if (a.replace(num, '#') !== b.replace(num, '#')) return false;
  const x = a.match(num) ?? [];
  const y = b.match(num) ?? [];
  return x.length === y.length && x.every((v, i) => Math.abs(Number(v) - Number(y[i])) <= 0.1);
}
const tagTexts = (page) => page.evaluate(() => [...document.querySelectorAll('.ed-mk-tag')].map((t) => ({ pos: Number(t.dataset.pos), text: t.dataset.text })));

await withApp(PORT, async (page, errors) => {
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(r.status() + ' : ' + r.url()));
  try {
    const draft = await page.evaluate(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Marques' }));
    await openDraft(page, draft.id);
    await buildDoc(page);

    // ── Désactivées par défaut ──
    check('désactivées par défaut (réglage absent)', !(await marksOn(page)));
    check('désactivées : aucune marque ni étiquette ni carte', await page.evaluate(() => !document.querySelector('.ed-mk-layer, .ed-mk-tags, [data-reveal], [data-reveal-chip]') && !document.querySelector('.ed-root.ed-marks')));
    const btn = page.locator('.ed-toolbar [data-tb="marks"]');
    check('bouton ¶ dans la barre d’outils, non enfoncé', (await btn.count()) === 1 && !(await btn.evaluate((b) => b.classList.contains('active'))));
    const tip = await btn.evaluate((b) => b.getAttribute('title') || b.getAttribute('aria-label') || '');
    check('infobulle du bouton avec le raccourci ⌘8', /marques de mise en forme/i.test(tip) && /⌘8/.test(tip), tip);
    check('interligne et espacement : autre icône que ¶', await page.evaluate(() => !document.querySelector('[data-tb="spacing"] .lucide-pilcrow')));
    const before = await rects(page);

    // ── Bouton ──
    await btn.click();
    await settle(page);
    check('bouton : marques activées', (await marksOn(page)) && (await page.evaluate(() => document.querySelectorAll('.ed-mk-layer').length > 0)));
    check('bouton enfoncé', await btn.evaluate((b) => b.classList.contains('active')));
    const after = await rects(page);
    const diff = before.filter((r, i) => r !== after[i]);
    check('aucun déplacement : pages, lignes et passages aux mêmes rectangles', before.length > 20 && before.length === after.length && diff.length === 0, `${before.length} éléments, ${diff.length} différents ${diff.slice(0, 2).join(' / ')}`);

    // ── ¶ par paragraphe, vides compris ──
    const pm = await paraMarks(page);
    const painted = pm.filter((x) => x.painted);
    check('¶ sur la dernière ligne de chaque paragraphe', painted.length >= 12 && painted.every((x) => x.isLast && x.para === 1), JSON.stringify(painted.filter((x) => !x.isLast || x.para !== 1)));
    check('¶ sur les paragraphes vides', painted.filter((x) => x.empty).length >= 3 && painted.filter((x) => x.empty).every((x) => x.isLast), `${painted.filter((x) => x.empty).length} vides`);

    // ── Espaces, insécables, tabulations, retours à la ligne ──
    const l1 = await lineInfo(page, 'Un deux trois');
    check('· pour chaque espace (3)', l1 && l1.sp === 3, JSON.stringify(l1));
    check('° pour l’espace insécable', l1 && l1.nb === 1, JSON.stringify(l1));
    check('¶ juste après le texte', l1 && l1.para && l1.paraGap > -1 && l1.paraGap < 6, String(l1?.paraGap));
    const l2 = await lineInfo(page, 'Tab');
    check('→ pour la tabulation', l2 && l2.tab === 1, JSON.stringify(l2));
    check('↵ pour le retour à la ligne (et pas de ¶ sur cette ligne)', l2 && l2.br === 1 && !l2.para, JSON.stringify(l2));
    const l2b = await lineInfo(page, 'retour ensuite');
    check('¶ sur la ligne après le retour à la ligne', l2b && l2b.para, JSON.stringify(l2b));

    // ── Passage dans une autre police / taille ──
    const l3 = await lineInfo(page, 'Passage');
    check('pointillé sous le passage Georgia 14 (milieu de ligne)', l3 && l3.run === 1, JSON.stringify(l3));
    check('infobulle « Georgia 14 » sur le passage', l3 && l3.runTitles.some((t) => /^Georgia 14\b/.test(t)), JSON.stringify(l3?.runTitles));
    const l4 = await lineInfo(page, 'Premier paragraphe');
    check('pas de pointillé dans un paragraphe uniforme', l4 && l4.run === 0);
    const big = await lineInfo(page, 'Paragraphe entier');
    check('paragraphe entier en 16 pt : pas de pointillé (c’est sa taille dominante)', big && big.run === 0, JSON.stringify(big));

    // ── Étiquettes de marge ──
    const tags = await tagTexts(page);
    const fmts = await page.evaluate(() => window.__ed.engine().paragraphFormats().map((f) => ({ pos: f.pos, text: window.__ed.engine().debugEditor().editor.state.doc.nodeAt(f.pos).textContent, empty: f.empty })));
    const posOf = (pre) => fmts.find((f) => f.text.startsWith(pre))?.pos;
    const tagged = (pre) => tags.find((t) => t.pos === posOf(pre));
    console.log('   étiquettes :', tags.map((t) => t.text).join(' | '));
    check('étiquette sur le premier paragraphe (Titre 1, centré ou non)', tagged('Titre du devoir') && /^Titre 1 · /.test(tagged('Titre du devoir').text), JSON.stringify(tagged('Titre du devoir')));
    check('étiquette au retour au corps', tagged('Premier paragraphe') && /^Corps · .+ 12 · /.test(tagged('Premier paragraphe').text), JSON.stringify(tagged('Premier paragraphe')));
    check('pas d’étiquette sur les paragraphes identiques consécutifs', !tagged('Second paragraphe') && !tagged('Un deux') && !tagged('Passage mixte') && !tagged('Tab'));
    check('étiquette où la taille change (16)', tagged('Paragraphe entier') && / 16 · /.test(tagged('Paragraphe entier').text), JSON.stringify(tagged('Paragraphe entier')));
    check('étiquette au retour à 12', tagged('Après le grand') && / 12 · /.test(tagged('Après le grand').text));
    check('étiquette où l’alignement change (centré)', tagged('Conclusion') && /centré$/.test(tagged('Conclusion').text), JSON.stringify(tagged('Conclusion')));
    check('exactement 5 étiquettes', tags.length === 5, String(tags.length));
    const tagGeo = await page.evaluate(() => {
      const t = document.querySelector('.ed-mk-tag');
      const pg = document.querySelector('.superdoc-page');
      const line = [...document.querySelectorAll('.superdoc-page .superdoc-line')].find((l) => l.textContent.includes('Titre du devoir'));
      const tr = t.getBoundingClientRect();
      const lr = line.getBoundingClientRect();
      const text = [...line.querySelectorAll('.superdoc-text-run')][0].getBoundingClientRect();
      return { right: tr.right, pageLeft: pg.getBoundingClientRect().left, textLeft: lr.left, dy: Math.abs(tr.top + tr.height / 2 - (lr.top + lr.height / 2)), overlapsText: tr.right > text.left };
    });
    check('étiquette dans la marge gauche, à hauteur de la ligne, sans toucher le texte', tagGeo.right <= tagGeo.textLeft + 1 && tagGeo.dy < 6 && !tagGeo.overlapsText, JSON.stringify(tagGeo));
    // survol : détail complet
    await page.locator('.ed-mk-tag').first().hover();
    await settle(page, 200);
    const card = await page.evaluate(() => {
      const c = document.querySelector('.ed-mk-card');
      return c && getComputedStyle(c).display !== 'none' ? c.innerText : '';
    });
    check('survol d’une étiquette : style, police, taille, alignement, interligne, retraits, espacement', ['Style', 'Police', 'Taille', 'Alignement', 'Interligne', 'Retraits', 'Espacement'].every((k) => card.includes(k)), card.replace(/\n/g, ' / '));
    await page.mouse.move(5, 450);

    // ── Raccourci ⌘8 ──
    await page.keyboard.press('Control+8');
    await settle(page);
    check('⌘8 : marques masquées', !(await marksOn(page)) && (await page.evaluate(() => !document.querySelector('.ed-mk-layer, .ed-mk-tags'))));
    check('masquées : rectangles inchangés', JSON.stringify(await rects(page)) === JSON.stringify(before));
    await page.keyboard.press('Meta+8');
    await settle(page);
    check('⌘8 : marques réaffichées', (await marksOn(page)) && (await page.evaluate(() => document.querySelectorAll('.ed-mk-para').length >= 12)));
    check('⌘8 n’a pas modifié le texte', !(await page.evaluate(() => window.__ed.engine().plainText().includes('8'))));

    // ── Carte « Mise en forme » ──
    check('carte « Mise en forme » affichée', await page.evaluate(() => !!document.querySelector('[data-reveal]')));
    await page.evaluate(() => {
      const ed = window.__ed.engine().debugEditor().editor;
      let p = null;
      ed.state.doc.forEach((n, pos) => {
        if (p == null && n.textContent.startsWith('Passage mixte')) p = pos;
      });
      ed.commands.setTextSelection({ from: p + 2, to: p + 2 + 'Passage mixte ici puis'.length });
    });
    await settle(page);
    const rev = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-reveal] dd')].map((d) => [d.dataset.k, d.textContent])));
    let r = await rev();
    check('sélection sur deux polices : police et taille « mixte »', r.Police === 'mixte' && r.Taille === 'mixte', JSON.stringify(r));
    check('sélection : style Corps, alignement, interligne', r.Style === 'Corps' && !!r.Alignement && !!r.Interligne && !!r.Retraits && !!r.Espacement, JSON.stringify(r));
    await page.evaluate(() => {
      const ed = window.__ed.engine().debugEditor().editor;
      let p = null;
      ed.state.doc.forEach((n, pos) => {
        if (p == null && n.textContent.startsWith('Titre du devoir')) p = pos;
      });
      ed.commands.setTextSelection({ from: p + 3, to: p + 3 });
    });
    await settle(page);
    r = await rev();
    check('curseur dans le titre : Titre 1, 16 pt, gras', r.Style === 'Titre 1' && r.Taille === '16 pt' && /gras/.test(r.Effets), JSON.stringify(r));
    await page.click('[data-reveal] header button');
    await settle(page, 150);
    check('carte repliable en pastille', await page.evaluate(() => !document.querySelector('[data-reveal]') && !!document.querySelector('[data-reveal-chip]')));
    await page.click('[data-reveal-chip]');
    await settle(page, 150);
    check('pastille : carte rouverte', await page.evaluate(() => !!document.querySelector('[data-reveal]')));

    await shot(page, 'marks-light.png');

    // ── Frappe : marques suivies ──
    const paraCount0 = await page.evaluate(() => document.querySelectorAll('.ed-mk-para').length);
    const clickEnd = async (needle) => {
      const pt = await page.evaluate((needle) => {
        const line = [...document.querySelectorAll('.superdoc-page .superdoc-line')].find((l) => l.textContent.includes(needle));
        const runs = [...line.querySelectorAll('.superdoc-text-run')];
        const r = runs[runs.length - 1].getBoundingClientRect();
        return { x: r.right - 2, y: r.top + r.height / 2 };
      }, needle);
      await page.mouse.click(pt.x, pt.y);
      await page.keyboard.press('End');
    };
    await clickEnd('Un deux trois');
    await page.keyboard.type(' cinq six', { delay: 30 });
    await settle(page, 250);
    const l5 = await lineInfo(page, 'cinq six');
    check('frappe : nouveaux · comptés (5)', l5 && l5.sp === 5, JSON.stringify(l5));
    check('frappe : ¶ toujours juste après le texte', l5 && l5.para && l5.paraGap > -1 && l5.paraGap < 6, String(l5?.paraGap));
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await settle(page, 300);
    const paraCount1 = await page.evaluate(() => document.querySelectorAll('.ed-mk-para').length);
    check('Entrée ×2 : deux ¶ de plus (paragraphes vides)', paraCount1 === paraCount0 + 2, `${paraCount0} → ${paraCount1}`);
    const pm2 = (await paraMarks(page)).filter((x) => x.painted);
    check('après frappe : ¶ toujours sur chaque paragraphe', pm2.every((x) => x.isLast && x.para === 1));
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await settle(page, 300);
    check('Retour arrière ×2 : ¶ retirés', (await page.evaluate(() => document.querySelectorAll('.ed-mk-para').length)) === paraCount0);
    // les marques ne passent jamais dans le texte
    const plain = await page.evaluate(() => window.__ed.engine().plainText());
    check('texte du document sans ¶ · → ↵ °', !/[¶·→↵°]/.test(plain), plain.slice(0, 80));

    // ── Exports ──
    const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.__ed.engine().exportDocx())));
    const docxFile = path.join(OUT, 'marks.docx');
    fs.writeFileSync(docxFile, Buffer.from(bytes));
    const docx = execFileSync('python3', ['-I', '-c', 'import sys,zipfile\nprint(zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode("utf-8"))', docxFile], { maxBuffer: 64 << 20 }).toString();
    check('export Word : aucune marque', docx.length > 500 && !/[¶·↵]|ed-mk/.test(docx) && docx.includes('cinq six'));
    const outs = await page.evaluate(async () => {
      const { parseDocx } = await import('/src/features/editor/docx.ts');
      const { toPrintHtml, exportText } = await import('/src/features/editor/exporters.ts');
      const m = await parseDocx(await window.__ed.engine().exportDocx());
      return { pdf: toPrintHtml(m, 'x'), html: exportText(m, 'html', 'x'), md: exportText(m, 'md', 'x'), txt: exportText(m, 'txt', 'x') };
    });
    check('export PDF (HTML d’impression) : aucune marque', outs.pdf.includes('cinq six') && !/ed-mk|[¶↵]/.test(outs.pdf));
    check('exports page web, Markdown, texte : aucune marque', !/ed-mk|[¶↵·]/.test(outs.html + outs.md + outs.txt) && outs.txt.includes('cinq six'));
    check('impression : marques masquées (@media print)', await page.evaluate(() => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.media && /print/.test(r.media.mediaText) && /ed-mk-layer/.test(r.cssText)); } catch { return false; } })));

    // ── Thèmes ──
    await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'dark' }));
    await settle(page, 600);
    await shot(page, 'marks-dark.png');
    await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'sepia' }));
    await settle(page, 600);
    await shot(page, 'marks-sepia.png');
    await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));
    await page.evaluate(() => window.__ed.save(false));
    await settle(page, 800);

    // ── Rechargement : réglage conservé ──
    await page.reload();
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    check('rechargement : réglage conservé', await marksOn(page));
    await openDraft(page, draft.id);
    await settle(page, 400);
    check('rechargement : marques affichées à l’ouverture', await page.evaluate(() => document.querySelectorAll('.ed-mk-para').length >= 12 && document.querySelectorAll('.ed-mk-tag').length >= 3));
    check('rechargement : bouton enfoncé', await page.locator('.ed-toolbar [data-tb="marks"]').evaluate((b) => b.classList.contains('active')));

    // ── Palette de commandes ──
    await page.evaluate(() => window.__store.getState().setCommandOpen(true));
    await page.waitForSelector('.cmd-item');
    await page.keyboard.type('marques de mise');
    await settle(page, 200);
    const cmd = await page.evaluate(() => [...document.querySelectorAll('.cmd-item')].map((x) => x.textContent).find((t) => /marques de mise en forme/i.test(t)));
    check('palette : commande « Masquer les marques de mise en forme »', /Masquer les marques/.test(cmd ?? ''), cmd);
    await page.keyboard.press('Enter');
    await settle(page);
    check('palette : marques masquées', !(await marksOn(page)) && (await page.evaluate(() => !document.querySelector('.ed-mk-layer'))));

    // ── Long écrit : 300 paragraphes, frappe fluide ──
    const long = await page.evaluate(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Long' }));
    await openDraft(page, long.id);
    await page.evaluate(() => {
      const e = window.__ed.engine();
      const words = 'la conscience est elle le propre de l’homme ou bien une illusion que la réflexion entretient sur elle même'.split(' ');
      for (let i = 0; i < 300; i++) e.appendParagraph(i % 7 === 3 ? '' : `§${i} ` + Array.from({ length: 20 + ((i * 13) % 40) }, (_, k) => words[(i + k) % words.length]).join(' ') + '.');
    });
    await settle(page, 1500);
    const typeTime = async (txt) => {
      const pt = await page.evaluate(() => {
        const line = [...document.querySelectorAll('.superdoc-page .superdoc-line')].find((l) => l.textContent.startsWith('§2 '));
        line.scrollIntoView({ block: 'center' });
        return true;
      });
      void pt;
      await settle(page, 300);
      const p2 = await page.evaluate(() => {
        const line = [...document.querySelectorAll('.superdoc-page .superdoc-line')].find((l) => l.textContent.startsWith('§2 '));
        const r = line.getBoundingClientRect();
        return { x: r.left + 40, y: r.top + r.height / 2 };
      });
      await page.mouse.click(p2.x, p2.y);
      const t0 = Date.now();
      await page.keyboard.type(txt);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      return Date.now() - t0;
    };
    const tOff = await typeTime('abcdefghij klmnopqrst ');
    await page.keyboard.press('Control+8');
    await settle(page, 600);
    const tOn = await typeTime('uvwxyzabcd efghijklmn ');
    console.log(`   frappe 22 caractères, 300 paragraphes : sans marques ${tOff} ms, avec ${tOn} ms`);
    check('long écrit : frappe aussi fluide avec les marques', tOn < tOff * 1.6 + 400, `${tOff} → ${tOn} ms`);
    const syncLong = await page.evaluate(() => {
      const line = [...document.querySelectorAll('.superdoc-page .superdoc-line')].find((l) => l.textContent.includes('efghijklmn'));
      const words = (line.textContent.match(/ /g) || []).length;
      return { sp: line.querySelectorAll('.ed-mk-sp').length, spaces: words, pages: document.querySelectorAll('.superdoc-page').length, marked: [...document.querySelectorAll('.superdoc-page')].filter((p) => p.querySelector('.ed-mk-layer')).length };
    });
    check('long écrit : marques à jour dans la ligne tapée', syncLong.sp === syncLong.spaces, JSON.stringify(syncLong));
    // glyphes repris du cache pendant la frappe = glyphes remesurés à neuf (marques coupées puis remises)
    const layersNow = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.superdoc-page .superdoc-line')]
          .filter((l) => l.querySelector('.ed-mk-layer'))
          .map((l) => `${l.dataset.pmStart}:${l.querySelector('.ed-mk-layer').innerHTML}`)
          .join('\n'),
      );
    const cachedLayers = await layersNow();
    await page.keyboard.press('Control+8');
    await settle(page, 200);
    await page.keyboard.press('Control+8');
    await settle(page, 500);
    const freshLayers = await layersNow();
    check('long écrit : marques suivies pendant la frappe identiques à une mesure neuve', cachedLayers.length > 1000 && sameGlyphs(cachedLayers, freshLayers), `${cachedLayers.length} / ${freshLayers.length} ` + (() => { const a = cachedLayers.split('\n'), b = freshLayers.split('\n'); const i = a.findIndex((x, j) => x !== b[j]); return i < 0 ? '' : `ligne ${i}/${a.length}: ${a[i].slice(0, 400)} ≠ ${b[i].slice(0, 400)}`; })());
    check('long écrit : seules les pages proches sont marquées', syncLong.pages > 6 && syncLong.marked < syncLong.pages, JSON.stringify(syncLong));
    await page.evaluate(() => {
      const s = document.querySelector('.ed-scroll');
      s.scrollTop = s.scrollHeight;
    });
    await settle(page, 500);
    const bottom = await page.evaluate(() => {
      const s = document.querySelector('.ed-scroll').getBoundingClientRect();
      const vis = [...document.querySelectorAll('.superdoc-page .superdoc-line')].filter((l) => {
        const r = l.getBoundingClientRect();
        return r.bottom > s.top && r.top < s.bottom && !l.closest('.superdoc-page-header, .superdoc-page-footer');
      });
      return { vis: vis.length, withLayer: vis.filter((l) => l.querySelector('.ed-mk-layer')).length };
    });
    check('long écrit : défilement jusqu’à la fin, lignes visibles marquées', bottom.vis > 0 && bottom.withLayer === bottom.vis, JSON.stringify(bottom));
    await page.keyboard.press('Control+8');
    await settle(page);

    check('aucune erreur de page', errors.length === 0, errors.join(' | ').slice(0, 600));
  } catch (e) {
    console.error(e);
    check('déroulement', false, String(e).slice(0, 300));
    await shot(page, 'failure.png').catch(() => {});
  }
});

// ── Windows : Ctrl+Maj+8 (marques) et Ctrl+Maj+9 (liste à puces) ──
await withApp(PORT, async (page, errors) => {
  try {
    await page.goto(`http://localhost:${PORT}/?platform=win`);
    await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
    await page.evaluate(() => window.__store.getState().updateSettings({ showFormatMarks: false }));
    const draft = await page.evaluate(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Windows' }));
    await openDraft(page, draft.id);
    await page.evaluate(() => window.__ed.engine().appendParagraph('Un paragraphe sous Windows'));
    await settle(page, 500);
    const tip = await page.locator('.ed-toolbar [data-tb="marks"]').evaluate((b) => b.getAttribute('title') || b.getAttribute('aria-label') || '');
    check('Windows : infobulle « Ctrl+Maj+8 »', /Ctrl\+Maj\+8/.test(tip), tip);
    await page.keyboard.press('Control+8');
    await settle(page);
    check('Windows : Ctrl+8 seul ne bascule pas', !(await marksOn(page)));
    await page.keyboard.press('Control+Shift+8');
    await settle(page);
    check('Windows : Ctrl+Maj+8 affiche les marques', (await marksOn(page)) && (await page.evaluate(() => !!document.querySelector('.ed-mk-para'))));
    const line = await page.evaluate(() => {
      const l = [...document.querySelectorAll('.superdoc-page .superdoc-line')].find((x) => x.textContent.includes('sous Windows'));
      const r = l.getBoundingClientRect();
      return { x: r.left + 30, y: r.top + r.height / 2 };
    });
    await page.mouse.click(line.x, line.y);
    await page.keyboard.press('Control+Shift+9');
    await settle(page);
    check('Windows : Ctrl+Maj+9 = liste à puces', await page.evaluate(() => window.__ed.engine().state().list === 'bullet'), JSON.stringify(await page.evaluate(() => window.__ed.engine().state().list)));
    await page.keyboard.press('Control+Shift+8');
    await settle(page);
    check('Windows : Ctrl+Maj+8 masque les marques', !(await marksOn(page)));
    check('Windows : aucune erreur de page', errors.length === 0, errors.join(' | ').slice(0, 400));
    errors.length = 0;
  } catch (e) {
    console.error(e);
    check('déroulement Windows', false, String(e).slice(0, 300));
  }
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
