import { withApp } from './harness.mjs';
import { buildEssay, newDraft, settle } from './ed-helpers.mjs';
import * as P from './probe-pinceau-lib.mjs';
const { h } = P;
await withApp(5498, async (page, errors) => {
  await newDraft(page, 'Probe');
  await buildEssay(page);
  const r = await h(page, async () => {
    const ed = window.__h.ed(); const out = [];
    const e = window.__ed.engine();
    const tgt = () => { const cur = ed.doc.selection.current({}); const sg = cur.target.segments; return { kind: 'selection', start: { kind: 'text', blockId: sg[0].blockId, offset: sg[0].range.start }, end: { kind: 'text', blockId: sg.at(-1).blockId, offset: sg.at(-1).range.end } }; };
    const CLEAR = { bold: null, italic: null, underline: null, strike: null, color: null, fontFamily: null, fontSize: null, highlight: null, vertAlign: null, smallCaps: null, caps: null };
    const dump = (needle) => { const p = window.__h.posOf(needle); const o = []; const $p = ed.state.doc.resolve(p); const para = $p.node($p.depth - 1).type.name === 'paragraph' ? $p.node($p.depth - 1) : $p.parent; para.forEach((n) => o.push(n.type.name + (n.attrs.runProperties ? JSON.stringify(n.attrs.runProperties) : '') + ':' + JSON.stringify(n.textContent.slice(0, 20)))); return o.join(' | '); };
    for (const [label, setup] of [
      ['bold', () => ed.doc.format.apply({ target: tgt(), inline: { bold: true } })],
      ['smallCaps', () => ed.doc.format.smallCaps({ target: tgt(), value: true })],
      ['color', () => ed.doc.format.apply({ target: tgt(), inline: { color: '#B03A2E' } })],
      ['fontFamily cmd', () => ed.commands.setFontFamily('Georgia')],
      ['bold cmd', () => ed.commands.toggleBold()],
    ]) {
      // fresh paragraph text each time: use different words
      const word = { bold: 'Hume', smallCaps: 'Kant', color: 'Conclusion', 'fontFamily cmd': 'Descartes', 'bold cmd': 'introspection' }[label];
      window.__h.select(word); setup();
      out.push(label + ' after setup: ' + dump(word));
      window.__h.select(word, 1, 3);
      const b = JSON.stringify(ed.state.selection.toJSON());
      ed.doc.format.apply({ target: tgt(), inline: CLEAR });
      out.push(label + ' CLEAR sel ' + b + ' -> ' + JSON.stringify(ed.state.selection.toJSON()) + '\n    ' + dump(word));
    }
    return out;
  });
  console.log(r.join('\n'));
});
