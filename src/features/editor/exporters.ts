// Exports texte (Markdown, HTML, TXT) et HTML d'impression A4 (PDF), générés depuis
// le .docx exporté (modèle de blocs de docx.ts) : ce qui est exporté est exactement
// ce que contient le fichier Word.
import type { Block, DocModel, Inline } from './docx';

export type TextFormat = 'md' | 'html' | 'txt';

function noteNumbers(m: DocModel): Map<string, number> {
  const map = new Map<string, number>();
  m.noteOrder.forEach((id, i) => map.set(id, i + 1));
  return map;
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escMd = (s: string) => s.replace(/([\\`*_[\]<>])/g, '\\$1');

function headingShift(m: DocModel): number {
  return m.blocks.some((b) => b.kind === 'title') ? 1 : 0;
}
function headingLevel(b: Block, shift: number): number {
  const base = b.kind === 'title' ? 1 : b.kind === 'h1' ? 1 : b.kind === 'h2' ? 2 : b.kind === 'h3' ? 3 : 4;
  return Math.min(6, b.kind === 'title' ? 1 : base + shift);
}
const isHeading = (b: Block) => b.kind === 'title' || b.kind === 'h1' || b.kind === 'h2' || b.kind === 'h3' || b.kind === 'h4';
const isEmpty = (b: Block) => !b.inlines.some((i) => (i.t === 'text' && i.text.trim()) || i.t === 'note');

// ── Inline ───────────────────────────────────────────────────
function inlineMd(inl: Inline[], nums: Map<string, number>): string {
  return inl
    .map((i) => {
      if (i.t === 'br') return '  \n';
      if (i.t === 'note') return nums.has(i.id) ? `[^${nums.get(i.id)}]` : '';
      let t = escMd(i.text.replace(/\t/g, ' '));
      if (!t.trim()) return t;
      const lead = t.match(/^\s*/)![0];
      const trail = t.match(/\s*$/)![0];
      t = t.trim();
      if (i.b) t = `**${t}**`;
      if (i.i) t = `*${t}*`;
      return lead + t + trail;
    })
    .join('');
}
function inlineHtml(inl: Inline[], nums: Map<string, number>, noteLinks = true): string {
  return inl
    .map((i) => {
      if (i.t === 'br') return '<br>';
      if (i.t === 'note') {
        const n = nums.get(i.id);
        if (!n) return '';
        return noteLinks ? `<sup class="fnref"><a href="#fn${n}" id="fnref${n}">${n}</a></sup>` : `<sup class="fnref">${n}</sup>`;
      }
      let t = escHtml(i.text);
      if (i.u) t = `<u>${t}</u>`;
      if (i.b) t = `<strong>${t}</strong>`;
      if (i.i) t = `<em>${t}</em>`;
      return t;
    })
    .join('');
}
function inlineTxt(inl: Inline[], nums: Map<string, number>): string {
  return inl.map((i) => (i.t === 'br' ? '\n' : i.t === 'note' ? (nums.has(i.id) ? `[${nums.get(i.id)}]` : '') : i.text)).join('');
}

// ── Markdown ─────────────────────────────────────────────────
export function toMarkdown(m: DocModel): string {
  const nums = noteNumbers(m);
  const shift = headingShift(m);
  const out: string[] = [];
  const counters: number[] = [];
  let prevList: string | null = null;
  for (const b of m.blocks) {
    if (isEmpty(b)) continue;
    const text = inlineMd(b.inlines, nums).trim();
    if (b.kind === 'li') {
      const lvl = b.level ?? 0;
      if (prevList !== b.listId) counters.length = 0;
      counters.length = Math.max(counters.length, lvl + 1);
      counters[lvl] = (counters[lvl] ?? 0) + 1;
      counters.length = lvl + 1;
      out.push(`${'   '.repeat(lvl)}${b.ordered ? `${counters[lvl]}.` : '-'} ${text}`);
      prevList = b.listId ?? null;
      continue;
    }
    if (prevList !== null) out.push('');
    prevList = null;
    counters.length = 0;
    if (isHeading(b)) out.push(`${'#'.repeat(headingLevel(b, shift))} ${text}`, '');
    else if (b.kind === 'quote') out.push(text.split('\n').map((l) => `> ${l}`).join('\n'), '');
    else out.push(text, '');
  }
  if (prevList !== null) out.push('');
  if (m.noteOrder.length) {
    for (const id of m.noteOrder) {
      const paras = m.notes.get(id) ?? [];
      out.push(`[^${nums.get(id)}]: ${paras.map((p) => inlineMd(p, nums).trim()).join(' ')}`);
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ── Texte brut ───────────────────────────────────────────────
export function toText(m: DocModel): string {
  const nums = noteNumbers(m);
  const out: string[] = [];
  const counters: number[] = [];
  let prevList: string | null = null;
  for (const b of m.blocks) {
    if (isEmpty(b)) continue;
    const text = inlineTxt(b.inlines, nums).trim();
    if (b.kind === 'li') {
      const lvl = b.level ?? 0;
      if (prevList !== b.listId) counters.length = 0;
      counters[lvl] = (counters[lvl] ?? 0) + 1;
      counters.length = lvl + 1;
      out.push(`${'  '.repeat(lvl)}${b.ordered ? `${counters[lvl]}.` : '•'} ${text}`);
      prevList = b.listId ?? null;
      continue;
    }
    if (prevList !== null) out.push('');
    prevList = null;
    if (isHeading(b)) out.push(b.kind === 'title' || b.kind === 'h1' ? text.toUpperCase() : text, '');
    else if (b.kind === 'quote') out.push(text.split('\n').map((l) => `    ${l}`).join('\n'), '');
    else out.push(text, '');
  }
  if (m.noteOrder.length) {
    out.push('', 'Notes', '');
    for (const id of m.noteOrder) {
      const paras = m.notes.get(id) ?? [];
      out.push(`[${nums.get(id)}] ${paras.map((p) => inlineTxt(p, nums).trim()).join(' ')}`);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ── HTML ─────────────────────────────────────────────────────
function bodyHtml(m: DocModel, noteLinks: boolean): string {
  const nums = noteNumbers(m);
  const shift = headingShift(m);
  const out: string[] = [];
  // pile des listes ouvertes : { ordered, liOpen }
  const stack: { ordered: boolean; liOpen: boolean; listId?: string }[] = [];
  const closeTo = (n: number) => {
    while (stack.length > n) {
      const top = stack.pop()!;
      if (top.liOpen) out.push('</li>');
      out.push(top.ordered ? '</ol>' : '</ul>');
    }
  };
  for (const b of m.blocks) {
    if (isEmpty(b)) continue;
    const html = inlineHtml(b.inlines, nums, noteLinks);
    if (b.kind === 'li') {
      const lvl = b.level ?? 0;
      if (stack.length && lvl === 0 && stack[0].listId !== b.listId) closeTo(0);
      closeTo(lvl + 1);
      if (stack.length === lvl + 1 && stack[lvl].ordered !== !!b.ordered) closeTo(lvl);
      while (stack.length < lvl + 1) {
        out.push(b.ordered ? '<ol>' : '<ul>');
        stack.push({ ordered: !!b.ordered, liOpen: false, listId: b.listId });
      }
      const top = stack[stack.length - 1];
      if (top.liOpen) out.push('</li>');
      out.push(`<li>${html}`);
      top.liOpen = true;
      continue;
    }
    closeTo(0);
    if (isHeading(b)) {
      const l = headingLevel(b, shift);
      out.push(`<h${l}${b.kind === 'title' ? ' class="title"' : ''}>${html}</h${l}>`);
    } else if (b.kind === 'quote') out.push(`<blockquote><p>${html}</p></blockquote>`);
    else out.push(`<p>${html}</p>`);
  }
  closeTo(0);
  if (m.noteOrder.length) {
    out.push('<section class="footnotes" aria-label="Notes"><hr><ol>');
    for (const id of m.noteOrder) {
      const n = nums.get(id)!;
      const paras = (m.notes.get(id) ?? []).map((p) => inlineHtml(p, nums, noteLinks).trim()).join(' ');
      out.push(`<li id="fn${n}">${paras}${noteLinks ? ` <a href="#fnref${n}" class="fnback" aria-label="Retour au texte">↩</a>` : ''}</li>`);
    }
    out.push('</ol></section>');
  }
  return out.join('\n');
}

const SCREEN_CSS = `
:root { color-scheme: light; }
body { margin: 0; background: #fbf9f4; color: #1d1a15; }
main { max-width: 42rem; margin: 0 auto; padding: 3rem 1.5rem 5rem; font-family: 'Iowan Old Style', 'Literata', Georgia, 'Times New Roman', serif; font-size: 1.125rem; line-height: 1.65; }
h1, h2, h3, h4 { line-height: 1.25; font-weight: 600; margin: 2em 0 0.6em; }
h1.title { text-align: center; font-weight: 400; font-size: 2.2rem; margin-top: 0; }
p { margin: 0 0 0.9em; text-align: justify; hyphens: auto; }
blockquote { margin: 1.2em 2.2rem; font-size: 0.95em; }
blockquote p { margin: 0; }
sup.fnref a { text-decoration: none; color: inherit; }
.footnotes { margin-top: 3rem; font-size: 0.85em; }
.footnotes hr { border: 0; border-top: 1px solid #c9c1b2; width: 30%; margin: 0 0 1rem; }
.fnback { text-decoration: none; }
@media (prefers-color-scheme: dark) { body { background: #1c1b19; color: #ece6da; } .footnotes hr { border-color: #4a443a; } a { color: #7aa2ff; } }
`;

export function toHtml(m: DocModel, title: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>${SCREEN_CSS}</style>
</head>
<body>
<main>
${bodyHtml(m, true)}
</main>
</body>
</html>
`;
}

/** HTML autonome pour l'impression A4 (marges 2,5 cm), notes regroupées en fin de document. */
export function toPrintHtml(m: DocModel, title: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${escHtml(title)}</title>
<style>
@page { size: A4; margin: 2.5cm; }
html { -webkit-print-color-adjust: exact; }
body { margin: 0; color: #000; background: #fff; font-family: 'Times New Roman', 'Iowan Old Style', Georgia, serif; font-size: 12pt; line-height: 1.5; }
h1, h2, h3, h4 { font-weight: bold; line-height: 1.25; page-break-after: avoid; break-after: avoid; }
h1 { font-size: 16pt; margin: 24pt 0 6pt; }
h2 { font-size: 14pt; margin: 18pt 0 6pt; }
h3 { font-size: 12pt; font-style: italic; margin: 12pt 0 6pt; }
h1.title { text-align: center; font-weight: normal; font-size: 20pt; margin: 0 0 18pt; }
p { margin: 0 0 6pt; text-align: justify; hyphens: auto; orphans: 3; widows: 3; }
blockquote { margin: 6pt 1cm 10pt 1.5cm; font-size: 11pt; line-height: 1.25; }
blockquote p { margin: 0; }
ul, ol { margin: 0 0 6pt; padding-left: 1.2cm; }
li { margin: 0 0 3pt; }
sup.fnref { font-size: 8pt; line-height: 0; }
.footnotes { margin-top: 18pt; font-size: 10pt; line-height: 1.25; break-inside: auto; }
.footnotes hr { border: 0; border-top: 0.5pt solid #000; width: 5cm; margin: 0 0 6pt; }
.footnotes ol { padding-left: 0.8cm; margin: 0; }
.footnotes li { margin: 0 0 3pt; }
</style>
</head>
<body>
${bodyHtml(m, false)}
</body>
</html>
`;
}

export function exportText(m: DocModel, format: TextFormat, title: string): string {
  if (format === 'md') return toMarkdown(m);
  if (format === 'html') return toHtml(m, title);
  return toText(m);
}

/** Nom de fichier sûr (sans / : etc.). */
export function safeFileName(title: string): string {
  const t = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (t || 'Sans titre').slice(0, 120);
}
