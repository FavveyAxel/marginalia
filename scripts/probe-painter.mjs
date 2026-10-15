import { withApp } from './harness.mjs';
await withApp(5406, async (page, errors) => {
  const draft = await page.evaluate(async () => (await import('/src/features/editor/api.ts')).createDraft({ title: 'Probe' }));
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), draft.id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(900);
  const out = await page.evaluate(async () => {
    const e = window.__ed.engine();
    const ed = e.debugEditor().editor;
    e.appendParagraph('Alpha beta gamma delta.');
    e.appendParagraph('Second line here.');
    await new Promise((r) => setTimeout(r, 800));
    let p = null, q = null;
    ed.state.doc.forEach((n, pos) => { if (p == null && n.textContent.startsWith('Alpha')) p = pos; if (q == null && n.textContent.startsWith('Second')) q = pos; });
    ed.view.dispatch(ed.state.tr.setMeta('closeHistory$', true));
    ed.commands.setTextSelection({ from: q + 2, to: q + 8 });
    const cur = ed.doc.selection.current({});
    const sg = cur.target.segments; const a = sg[0], b = sg[sg.length-1];
    const target = { kind: 'selection', start: { kind: 'text', blockId: a.blockId, offset: a.range.start }, end: { kind: 'text', blockId: b.blockId, offset: b.range.end } };
    let trs = 0; const orig = ed.view.dispatch.bind(ed.view);
    const r = ed.doc.format.apply({ target, inline: { bold: true, fontFamily: 'Georgia', fontSize: 14, color: '#C00000', smallCaps: true, underline: true, highlight: '#FFFF00', vertAlign: 'superscript', caps: null, italic: null, strike: null } });
    const after = JSON.stringify(ed.state.doc.nodeAt(q).toJSON());
    const st = e.state();
    // paragraph tr merged
    const node = ed.state.doc.nodeAt(q);
    ed.view.dispatch(ed.state.tr.setNodeMarkup(q, undefined, { ...node.attrs, paragraphProperties: { ...(node.attrs.paragraphProperties||{}), justification: 'center' } }).setMeta('appendedTransaction', ed.state.tr));
    const st2 = e.state();
    e.undo();
    await new Promise((r) => setTimeout(r, 100));
    ed.commands.setTextSelection({ from: q + 2, to: q + 8 });
    const st3 = e.state();
    // coords
    const pe = e.presentation();
    const c = pe.coordsAtPos(q + 4);
    const rects = e.rangeRects(q + 2, q + 8);
    const hit = pe.hitTest(rects[0].left + 3, (rects[0].top + rects[0].bottom) / 2);
    return { r, after, st: [st.bold, st.fontFamily, st.fontSize, st.color, st.smallCaps, st.underline, st.superscript], align2: st2.align, st3: [st3.bold, st3.fontFamily, st3.fontSize, st3.color, st3.smallCaps, st3.align], c, rects, hit, q };
  });
  console.log(JSON.stringify(out, null, 1));
  console.log(errors.join('\n'));
});
