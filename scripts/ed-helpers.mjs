// Aides communes aux tests du pinceau (test-editor-painter.mjs) et du glisser-déposer (test-editor-dnd.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function checker() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
    console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + String(detail).slice(0, 400) : ''}`);
  };
  const finish = () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
    process.exit(failed.length ? 1 : 0);
  };
  return { check, finish, results };
}

export const settle = (page, ms = 350) => page.waitForTimeout(ms);

export async function newDraft(page, title) {
  const draft = await page.evaluate(async (title) => (await import('/src/features/editor/api.ts')).createDraft({ title }), title);
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), draft.id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(900);
  await installHelpers(page);
  return draft.id;
}

/** window.__h : positions par texte, sélection, état, paragraphes. */
export async function installHelpers(page) {
  await page.evaluate(() => {
    const ed = () => window.__ed.engine().debugEditor().editor;
    /** Caractères du texte et leur position (un passage peut s'étendre sur plusieurs runs). */
    const textChars = () => {
      const chars = [];
      ed().state.doc.descendants((n, p) => {
        if (n.isText) for (let i = 0; i < n.text.length; i++) chars.push([n.text[i], p + i]);
        return true;
      });
      return chars;
    };
    /** Positions [from, to[ des caractères a..b du passage `needle` (nth-ième occurrence). */
    const span = (needle, a = 0, b = needle.length, nth = 0) => {
      const chars = textChars();
      const txt = chars.map((c) => c[0]).join('');
      let i = txt.indexOf(needle);
      for (let k = 0; k < nth && i >= 0; k++) i = txt.indexOf(needle, i + 1);
      if (i < 0) return null;
      const from = a < needle.length ? chars[i + a][1] : chars[i + needle.length - 1][1] + 1;
      const to = b > a ? chars[i + b - 1][1] + 1 : from;
      return { from, to };
    };
    const posOf = (needle, nth = 0) => span(needle, 0, needle.length, nth)?.from ?? null;
    window.__h = {
      ed,
      posOf,
      span,
      select(needle, a = 0, b = needle.length) {
        const r = span(needle, a, b);
        if (r == null) throw new Error('introuvable : ' + needle);
        ed().commands.setTextSelection(r);
        ed().view.focus();
        return posOf(needle);
      },
      /** Rectangle (fenêtre) d'un passage du texte. */
      rect(needle, a = 0, b = needle.length) {
        const r = span(needle, a, b);
        if (r == null) return null;
        const rs = window.__ed.engine().rangeRects(r.from, r.to);
        return rs[0] ?? null;
      },
      rects(needle, a = 0, b = needle.length) {
        const r = span(needle, a, b);
        return r == null ? [] : window.__ed.engine().rangeRects(r.from, r.to);
      },
      paras() {
        const a = [];
        ed().state.doc.forEach((n) => a.push(n.textContent));
        return a.filter((t, i) => i > 0 || t);
      },
      sel() {
        const s = ed().state.selection;
        return { from: s.from, to: s.to, text: ed().state.doc.textBetween(s.from, s.to, '\n', '^') };
      },
      /** État de mise en forme sur [a, b] du passage, sans changer la sélection visible ensuite. */
      fmtAt(needle, a = 0, b = 1) {
        const r = span(needle, a, b);
        if (r == null) throw new Error('introuvable : ' + needle);
        const s = ed().state.selection;
        ed().commands.setTextSelection(r);
        const st = window.__ed.engine().state();
        ed().commands.setTextSelection({ from: s.from, to: s.to });
        return st;
      },
      count(type) {
        let n = 0;
        ed().state.doc.descendants((x) => {
          if (x.type.name === type) n++;
        });
        return n;
      },
      styleOf(needle) {
        const p = posOf(needle);
        const $p = ed().state.doc.resolve(p);
        for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'paragraph') return $p.node(d).attrs.paragraphProperties?.styleId ?? null;
        return null;
      },
    };
  });
}

/** Sélection à la souris d'un passage (glisser de son début à sa fin). */
export async function mouseSelect(page, needle) {
  const r = await page.evaluate((n) => {
    const rs = window.__h.rects(n);
    return rs.length ? { a: rs[0], b: rs[rs.length - 1] } : null;
  }, needle);
  if (!r) throw new Error('passage introuvable : ' + needle);
  const y1 = (r.a.top + r.a.bottom) / 2;
  const y2 = (r.b.top + r.b.bottom) / 2;
  await page.mouse.move(r.a.left + 1, y1);
  await page.mouse.down();
  await page.mouse.move((r.a.left + r.b.right) / 2, (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(r.b.right - 1, y2, { steps: 4 });
  await page.mouse.up();
}

/** Export .docx du moteur → fichier ; renvoie le XML du corps (et des notes). */
export async function exportDocx(page, file) {
  const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.__ed.engine().exportDocx())));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(bytes));
  const read = (part) => {
    try {
      return execFileSync('python3', ['-I', '-c', 'import sys,zipfile\nprint(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode("utf-8"))', file, part], { maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch {
      return '';
    }
  };
  const paras = JSON.parse(execFileSync('python3', ['-I', '-c', 'import sys,json,docx\nd=docx.Document(sys.argv[1])\nprint(json.dumps([p.text for p in d.paragraphs]))', file], { maxBuffer: 16 << 20 }).toString());
  return { document: read('word/document.xml'), footnotes: read('word/footnotes.xml'), comments: read('word/comments.xml'), paras };
}

/** Texte réaliste pour les captures. */
export async function buildEssay(page) {
  await page.evaluate(async () => {
    const e = window.__ed.engine();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // le premier paragraphe (vide) d'un nouvel écrit reçoit le titre
    window.__h.ed().commands.setTextSelection({ from: 1, to: 1 });
    e.insertText('La conscience de soi');
    e.appendParagraph('Descartes fait du cogito la première vérité certaine : je pense, donc je suis. Mais cette certitude ne dit encore rien de ce que je suis, sinon une chose qui pense.');
    e.appendParagraph('Pour Hume, au contraire, l’introspection ne rencontre jamais un moi stable : seulement une succession de perceptions, de chaleur ou de froid, d’amour ou de haine.');
    e.appendParagraph('Kant dépasse l’opposition : le « je pense » doit pouvoir accompagner toutes mes représentations, sans être lui-même un objet que je pourrais observer.');
    e.appendParagraph('Conclusion provisoire : la conscience de soi est moins une chose qu’une activité, celle qui unifie l’expérience.');
    await sleep(500);
    window.__h.select('La conscience de soi', 2, 2);
    await e.setParagraphStyle('h1');
    await sleep(300);
  });
}
