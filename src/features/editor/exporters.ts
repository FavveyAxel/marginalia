// Exports texte (Markdown, HTML, TXT) et HTML d'impression A4 (PDF), générés depuis
// le .docx exporté (modèle de blocs de docx.ts) : ce qui est exporté est exactement
// ce que contient le fichier Word.
import type { Block, BlockFmt, DocModel, DocTypography, Inline, TextFmt } from './docx';

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
/** Index des blocs vides « voulus » (lignes blanches entre deux textes, hors listes) : à garder dans les exports. */
function blankLines(m: DocModel): Set<number> {
  let first = -1;
  let last = -1;
  m.blocks.forEach((b, i) => {
    if (!isEmpty(b)) {
      if (first < 0) first = i;
      last = i;
    }
  });
  const out = new Set<number>();
  m.blocks.forEach((b, i) => {
    if (i > first && i < last && isEmpty(b) && b.kind !== 'li' && !b.inlines.some((x) => x.t === 'br')) out.add(i);
  });
  return out;
}
/** Marqueur de ligne blanche (MD, TXT) : survit à la fusion des lignes vides, retiré à la fin. */
const BLANK = '\u0000blank';
const finishText = (out: string[]) =>
  out.join('\n').replace(/\n{3,}/g, '\n\n').trim().replace(new RegExp(BLANK, 'g'), '') + '\n';

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
function inlineHtml(inl: Inline[], nums: Map<string, number>, noteLinks = true, tc?: TypoCtx, para?: BlockFmt): string {
  return inl
    .map((i) => {
      if (i.t === 'br') return '<br>';
      if (i.t === 'note') {
        const n = nums.get(i.id);
        if (!n) return '';
        return noteLinks ? `<sup class="fnref"><a href="#fn${n}" id="fnref${n}">${n}</a></sup>` : `<sup class="fnref">${n}</sup>`;
      }
      let t = escHtml(i.text);
      const css = tc ? runCss(i, para ?? tc.typo.base, tc) : '';
      if (css) t = `<span style="${escHtml(css)}">${t}</span>`;
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
const MD_PAGE_BREAK = '<div style="page-break-after: always; break-after: page;"></div>';
export function toMarkdown(m: DocModel): string {
  const nums = noteNumbers(m);
  const shift = headingShift(m);
  const out: string[] = [];
  const counters: number[] = [];
  let prevList: string | null = null;
  const blanks = blankLines(m);
  for (const [bi, b] of m.blocks.entries()) {
    // saut de page : balise reconnue par les convertisseurs (Pandoc, Typora, impression du HTML)
    if (b.pageBreak && out.some((l) => l.trim())) {
      if (prevList !== null) out.push('');
      prevList = null;
      out.push(MD_PAGE_BREAK, '');
    }
    if (isEmpty(b)) {
      // ligne blanche voulue : paragraphe insécable (affiché vide par les lecteurs Markdown)
      if (blanks.has(bi)) out.push('&nbsp;', '');
      continue;
    }
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
  const blanks = blankLines(m);
  for (const [bi, b] of m.blocks.entries()) {
    // saut de page : caractère de saut de page (form feed), compris par les imprimantes et éditeurs
    if (b.pageBreak && out.some((l) => l.trim())) {
      if (prevList !== null) out.push('');
      prevList = null;
      out.push('\f');
    }
    if (isEmpty(b)) {
      if (blanks.has(bi)) out.push(BLANK); // une ligne vide de plus que l'écart normal entre paragraphes
      continue;
    }
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
  return finishText(out);
}

// ── Typographie du document (PDF, HTML) ──────────────────────
// Les exports PDF et HTML reprennent la police, les tailles, l'interligne, l'alignement, les
// retraits et la mise en forme des runs du .docx (DocModel.typo, Block.fmt, Inline). Un modèle
// sans typographie (construit à la main) garde la présentation par défaut.

type Mode = 'print' | 'screen';
interface TypoCtx {
  typo: DocTypography;
  mode: Mode;
}

const SANS_RE = /sans|arial|helvetica|verdana|tahoma|calibri|segoe|avenir|futura|gill|optima|grotesk|\binter\b|roboto|lato|frutiger|myriad|trebuchet|gothic|franklin|aptos|candara|corbel|lucida grande|system-ui|-apple-system/i;
const MONO_RE = /mono|courier|consolas|menlo|monaco|\bcode\b|typewriter/i;
const SCRIPT_RE = /caveat|script|brush|handwrit|comic/i;
const FALLBACKS: Record<'serif' | 'sans-serif' | 'monospace' | 'cursive', string[]> = {
  // Même repli que l'éditeur (SuperDoc retombe sur Times New Roman) : le PDF ressemble à l'écran.
  serif: ['Times New Roman', 'Times', 'Georgia', 'serif'],
  'sans-serif': ['Helvetica Neue', 'Arial', 'sans-serif'],
  monospace: ['Menlo', 'Consolas', 'Courier New', 'monospace'],
  cursive: ['cursive'],
};
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
const cssFontName = (f: string) => f.replace(/['"\\<>;{}]/g, '').trim();

/** Famille générique d'une police (table des polices du .docx, sinon d'après le nom). */
export function genericFamily(font: string, fonts: DocTypography['fonts'] = {}): 'serif' | 'sans-serif' | 'monospace' | 'cursive' {
  const g = fonts[font]?.generic;
  if (g) return g;
  if (MONO_RE.test(font)) return 'monospace';
  if (SCRIPT_RE.test(font)) return 'cursive';
  if (SANS_RE.test(font)) return 'sans-serif';
  return 'serif';
}

/** Pile CSS : la police du document d'abord, puis sa remplaçante déclarée, puis des polices de même genre. */
export function fontStack(font: string, fonts: DocTypography['fonts'] = {}): string {
  const out: string[] = [];
  const add = (f: string | undefined) => {
    const n = f && cssFontName(f);
    if (n && !out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  };
  add(font);
  add(fonts[font]?.alt);
  for (const f of FALLBACKS[genericFamily(font, fonts)]) add(f);
  return out.map((f) => (GENERIC.has(f) ? f : `'${f}'`)).join(', ');
}

const r3 = (n: number) => String(Math.round(n * 1000) / 1000);
/** Taille : points (impression) ou em relatifs à `rel` (écran). */
const len = (pt: number, tc: TypoCtx, rel: number) => (tc.mode === 'print' ? `${r3(pt)}pt` : `${r3(pt / rel)}em`);
/** Interligne CSS : un « simple » de Word vaut environ 1,15 fois la taille de la police. */
function lineHeight(f: BlockFmt, tc: TypoCtx, size: number, heading = false): string | null {
  if (f.line === undefined) return null;
  if (f.lineRule === 'auto' || f.lineRule === undefined) {
    const v = f.line * 1.15;
    if (tc.mode === 'screen') return heading ? r3(Math.min(1.4, Math.max(1.15, v))) : r3(Math.min(2.2, Math.max(1.5, v)));
    return r3(v);
  }
  if (tc.mode === 'screen') return heading ? '1.25' : '1.6';
  // exact / au moins : hauteur en points
  return f.lineRule === 'atLeast' ? r3(Math.max(f.line / size, 1.15)) : `${r3(f.line)}pt`;
}

/** Déclarations de caractères de `f` qui diffèrent de `ref` (toutes si `ref` est absent). */
function textDecls(f: TextFmt, tc: TypoCtx, relSize: number, ref?: TextFmt, tags = false): string[] {
  const d: string[] = [];
  const diff = (k: keyof TextFmt) => f[k] !== undefined && (!ref || f[k] !== ref[k]);
  if (f.font && diff('font')) d.push(`font-family: ${fontStack(f.font, tc.typo.fonts)}`);
  if (f.size && diff('size')) d.push(`font-size: ${len(f.size, tc, relSize)}`);
  // gras / italique / souligné à true : balises <strong>, <em>, <u> pour les runs
  if (diff('b') && !(tags && f.b)) d.push(`font-weight: ${f.b ? 'bold' : 'normal'}`);
  if (diff('i') && !(tags && f.i)) d.push(`font-style: ${f.i ? 'italic' : 'normal'}`);
  const u = tags ? false : !!(f.u ?? ref?.u);
  const s = !!(f.s ?? ref?.s);
  if (diff('s') || (!tags && diff('u'))) d.push(`text-decoration: ${[u ? 'underline' : '', s ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'}`);
  else if (tags && f.u === false && ref?.u) d.push('text-decoration: none');
  // écran : le noir « imprimé » suit le thème clair / sombre de la page ; les autres couleurs sont gardées
  if (f.color && diff('color') && !(tc.mode === 'screen' && f.color === '#000000')) d.push(`color: ${f.color}`);
  if (f.hl && diff('hl')) d.push(`background-color: ${f.hl}`);
  if (diff('sc')) d.push(`font-variant: ${f.sc ? 'small-caps' : 'normal'}`);
  if (diff('caps')) d.push(`text-transform: ${f.caps ? 'uppercase' : 'none'}`);
  if (f.va && diff('va')) {
    d.push(`vertical-align: ${f.va}`);
    if (!f.size) d.push('font-size: 0.65em');
  }
  return d;
}

/** Déclarations de paragraphe (complètes si `ref` est absent : remplacent la présentation par défaut). */
function paraDecls(f: BlockFmt, tc: TypoCtx, ref?: BlockFmt, opts: { heading?: boolean; list?: boolean } = {}): string[] {
  const d: string[] = [];
  const size = f.size ?? tc.typo.base.size ?? 12;
  const diff = (k: keyof BlockFmt) => !ref || f[k] !== ref[k];
  // écran : longueurs en em, à recalculer quand la taille du bloc change
  const resized = tc.mode === 'screen' && diff('size');
  if (diff('align')) d.push(`text-align: ${f.align ?? 'left'}`);
  if (diff('firstLine') || (resized && f.firstLine)) d.push(`text-indent: ${f.firstLine ? len(f.firstLine, tc, size) : '0'}`);
  if (!opts.list) {
    // retrait suspendu : la première ligne revient vers la gauche, le reste du paragraphe reste en retrait
    if (diff('indLeft') || (resized && f.indLeft)) d.push(`margin-left: ${f.indLeft ? len(f.indLeft, tc, size) : '0'}`);
    if (diff('indRight') || (resized && f.indRight)) d.push(`margin-right: ${f.indRight ? len(f.indRight, tc, size) : '0'}`);
  }
  if (diff('before') || (resized && f.before)) d.push(`margin-top: ${f.before ? len(f.before, tc, size) : '0'}`);
  if (diff('after') || (resized && f.after)) d.push(`margin-bottom: ${f.after ? len(f.after, tc, size) : '0'}`);
  if (diff('line') || diff('lineRule') || resized || (f.lineRule === 'atLeast' && diff('size'))) {
    const lh = lineHeight(f, tc, size, opts.heading);
    if (lh) d.push(`line-height: ${lh}`);
  }
  return d;
}

/** Règle complète d'un genre de bloc (police, taille relative à la base en mode écran). */
function kindRule(sel: string, f: BlockFmt, tc: TypoCtx, opts: { heading?: boolean; list?: boolean } = {}): string {
  const base = tc.typo.base;
  const full: TextFmt = { ...f, b: !!f.b, i: !!f.i, u: !!f.u, s: !!f.s, sc: !!f.sc, caps: !!f.caps };
  const text = textDecls(full, tc, 1).map((x) =>
    // écran : tailles relatives à la taille de base du document (variable --b)
    tc.mode === 'screen' && x.startsWith('font-size:') && f.size ? `font-size: calc(var(--b) * ${r3(f.size / (base.size ?? 12))})` : x,
  );
  if (!f.color) text.push('color: inherit');
  if (!f.hl) text.push('background-color: transparent');
  return `${sel} { ${[...text, ...paraDecls(f, tc, undefined, opts)].join('; ')}; }`;
}

/** Format CSS de la page : nom (A4, letter…) quand il correspond, pour un PDF aux dimensions exactes. */
const PAPERS: [string, number, number][] = [
  ['A4', 595.28, 841.89],
  ['A5', 419.53, 595.28],
  ['A3', 841.89, 1190.55],
  ['letter', 612, 792],
  ['legal', 612, 1008],
];
function pageSize(w: number, h: number): string {
  const near = (a: number, b: number) => Math.abs(a - b) < 1.5;
  for (const [name, pw, ph] of PAPERS) {
    if (near(w, pw) && near(h, ph)) return name;
    if (near(w, ph) && near(h, pw)) return `${name} landscape`;
  }
  return `${r3(w)}pt ${r3(h)}pt`;
}

function typoCss(m: DocModel, tc: TypoCtx): string {
  const t = tc.typo;
  const base = t.base;
  const size = base.size ?? 12;
  const shift = headingShift(m);
  const out: string[] = [];
  const root = tc.mode === 'print' ? 'body' : 'main';
  const rootDecls = [`font-family: ${fontStack(base.font ?? 'Times New Roman', t.fonts)}`];
  if (tc.mode === 'print') rootDecls.push(`font-size: ${r3(size)}pt`);
  else rootDecls.push(`--b: ${r3((1.125 * size) / 12)}rem`, 'font-size: var(--b)');
  const lh = lineHeight(base, tc, size);
  if (lh) rootDecls.push(`line-height: ${lh}`);
  if (base.color && !(tc.mode === 'screen' && base.color === '#000000')) rootDecls.push(`color: ${base.color}`);
  out.push(`${root} { ${rootDecls.join('; ')}; }`);
  // Césure comme dans Word : seulement si le document l'active (sinon des coupures « ju-rare » apparaissent).
  if (t.hyphenate) out.push('p, li { hyphens: auto; }');
  if (tc.mode === 'print' && t.page) {
    const p = t.page;
    out.push(`@page { size: ${pageSize(p.width, p.height)}; margin: ${r3(p.top)}pt ${r3(p.right)}pt ${r3(p.bottom)}pt ${r3(p.left)}pt; }`);
  }
  // Citation : la mise en forme passe par le paragraphe (retraits, taille).
  out.push('blockquote { margin: 0; font-size: inherit; line-height: inherit; }');
  const k = t.kinds;
  out.push(kindRule('p', k.p ?? base, tc));
  if (k.quote) out.push(kindRule('blockquote p', k.quote, tc));
  if (k.li) out.push(kindRule('li', k.li, tc, { list: true }));
  if (k.title) out.push(kindRule('h1.title', k.title, tc, { heading: true }));
  (['h1', 'h2', 'h3', 'h4'] as const).forEach((kind) => {
    const f = k[kind];
    if (!f) return;
    const lvl = headingLevel({ kind, inlines: [] }, shift);
    out.push(kindRule(`h${lvl}:not(.title)`, f, tc, { heading: true }));
  });
  if (k.note) {
    const nf: BlockFmt = { ...k.note, firstLine: 0, indLeft: 0, indRight: 0, before: 0 };
    out.push(kindRule('.footnotes li', nf, tc, { list: true }));
    if (k.note.size) out.push(`.footnotes { font-size: ${tc.mode === 'print' ? `${r3(k.note.size)}pt` : `calc(var(--b) * ${r3(k.note.size / size)})`}; }`);
  }
  return out.join('\n');
}

/** Style en ligne d'un bloc : ce qui diffère du style usuel de son genre (mise en forme directe, autre style). */
function blockCss(b: Block, tc: TypoCtx): string {
  if (!b.fmt) return '';
  const ref = (b.kind === 'p' ? tc.typo.kinds.p : tc.typo.kinds[b.kind]) ?? tc.typo.base;
  const size = b.fmt.size ?? 12;
  const text = textDecls(b.fmt, tc, ref.size ?? size, ref).map((x) =>
    tc.mode === 'screen' && x.startsWith('font-size:') && b.fmt?.size ? `font-size: calc(var(--b) * ${r3(b.fmt.size / (tc.typo.base.size ?? 12))})` : x,
  );
  return [...text, ...paraDecls(b.fmt, tc, ref, { heading: b.kind !== 'p' && b.kind !== 'quote' && b.kind !== 'li', list: b.kind === 'li' })].join('; ');
}

/** Style en ligne d'un run : ce qui diffère de son paragraphe. */
function runCss(i: TextFmt, para: BlockFmt, tc: TypoCtx): string {
  return textDecls(i, tc, para.size ?? tc.typo.base.size ?? 12, para, true).join('; ');
}

// ── HTML ─────────────────────────────────────────────────────
function bodyHtml(m: DocModel, noteLinks: boolean, tc?: TypoCtx): string {
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
  // Paragraphes vides : avec la typographie du document (PDF, page web), ce sont des lignes blanches
  // voulues pour aérer le texte — gardées, sauf en fin de document. Sans typographie : ignorés.
  const blanks = blankLines(m);
  for (const [bi, b] of m.blocks.entries()) {
    // saut de page : la suite commence une nouvelle page (impression) ; à l'écran, un filet discret
    if (b.pageBreak && out.length) {
      if (b.kind !== 'li') closeTo(0);
      out.push('<div class="page-break" role="separator" aria-label="Saut de page"></div>');
    }
    if (isEmpty(b)) {
      if (!tc || !blanks.has(bi)) continue;
      const css = blockCss(b, tc);
      out.push(`<p class="blank"${css ? ` style="${escHtml(css)}"` : ''}>&nbsp;</p>`);
      continue;
    }
    const html = inlineHtml(b.inlines, nums, noteLinks, tc, b.fmt);
    const css = tc ? blockCss(b, tc) : '';
    const st = css ? ` style="${escHtml(css)}"` : '';
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
      out.push(`<li${st}>${html}`);
      top.liOpen = true;
      continue;
    }
    closeTo(0);
    if (isHeading(b)) {
      const l = headingLevel(b, shift);
      out.push(`<h${l}${b.kind === 'title' ? ' class="title"' : ''}${st}>${html}</h${l}>`);
    } else if (b.kind === 'quote') out.push(`<blockquote><p${st}>${html}</p></blockquote>`);
    else out.push(`<p${st}>${html}</p>`);
  }
  closeTo(0);
  if (m.noteOrder.length) {
    out.push('<section class="footnotes" aria-label="Notes"><hr><ol>');
    const nf = tc?.typo.kinds.note ?? tc?.typo.base;
    for (const id of m.noteOrder) {
      const n = nums.get(id)!;
      const paras = (m.notes.get(id) ?? []).map((p) => inlineHtml(p, nums, noteLinks, tc, nf).trim()).join(' ');
      out.push(`<li id="fn${n}">${paras}${noteLinks ? ` <a href="#fnref${n}" class="fnback" aria-label="Retour au texte">↩</a>` : ''}</li>`);
    }
    out.push('</ol></section>');
  }
  return out.join('\n');
}

/** Polices (familles) employées par le document : base, styles, paragraphes et runs. */
export function usedFonts(m: DocModel): string[] {
  const set = new Set<string>();
  const t = m.typo;
  if (!t) return [];
  const add = (f?: string) => f && set.add(f);
  add(t.base.font);
  Object.values(t.kinds).forEach((k) => add(k?.font));
  const inl = (xs: Inline[]) => xs.forEach((x) => x.t === 'text' && add(x.font));
  for (const b of m.blocks) {
    if (isEmpty(b)) continue;
    add(b.fmt?.font);
    inl(b.inlines);
  }
  for (const id of m.noteOrder) (m.notes.get(id) ?? []).forEach(inl);
  return [...set];
}

export interface ExportOptions {
  /** Règles @font-face (polices fournies avec l'app, en data:) à inclure dans le document. */
  fontCss?: string;
}

const SCREEN_CSS = `
:root { color-scheme: light; }
.page-break { border: 0; border-top: 1px dashed #c9c1b2; margin: 2.5em 0; height: 0; }
@media print { .page-break { border: 0; margin: 0; break-after: page; page-break-after: always; } }
body { margin: 0; background: #fbf9f4; color: #1d1a15; }
main { max-width: 42rem; margin: 0 auto; padding: 3rem 1.5rem 5rem; font-family: 'Iowan Old Style', 'Literata', Georgia, 'Times New Roman', serif; font-size: 1.125rem; line-height: 1.65; }
h1, h2, h3, h4 { line-height: 1.25; font-weight: 600; margin: 2em 0 0.6em; }
h1.title { text-align: center; font-weight: 400; font-size: 2.2rem; margin-top: 0; }
p { margin: 0 0 0.9em; text-align: justify; hyphens: manual; }
blockquote { margin: 1.2em 2.2rem; font-size: 0.95em; }
blockquote p { margin: 0; }
sup.fnref a { text-decoration: none; color: inherit; }
.footnotes { margin-top: 3rem; font-size: 0.85em; }
.footnotes hr { border: 0; border-top: 1px solid #c9c1b2; width: 30%; margin: 0 0 1rem; }
.fnback { text-decoration: none; }
@media (prefers-color-scheme: dark) { body { background: #1c1b19; color: #ece6da; } .footnotes hr { border-color: #4a443a; } a { color: #7aa2ff; } }
`;

/** Typographie écran : le document garde ses polices, tailles et mises en forme, dans une colonne lisible. */
function screenTypoCss(m: DocModel): string {
  return m.typo ? typoCss(m, { typo: m.typo, mode: 'screen' }) : '';
}

export function toHtml(m: DocModel, title: string, opts: ExportOptions = {}): string {
  const tc: TypoCtx | undefined = m.typo ? { typo: m.typo, mode: 'screen' } : undefined;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>${opts.fontCss ?? ''}${SCREEN_CSS}${screenTypoCss(m)}</style>
</head>
<body>
<main>
${bodyHtml(m, true, tc)}
</main>
</body>
</html>
`;
}

/** HTML autonome pour l'impression (format et marges du document, A4 2,5 cm par défaut), notes en fin de document. */
export function toPrintHtml(m: DocModel, title: string, opts: ExportOptions = {}): string {
  const tc: TypoCtx | undefined = m.typo ? { typo: m.typo, mode: 'print' } : undefined;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${escHtml(title)}</title>
<style>
${opts.fontCss ?? ''}
@page { size: A4; margin: 2.5cm; }
html { -webkit-print-color-adjust: exact; }
body { margin: 0; color: #000; background: #fff; font-family: 'Times New Roman', 'Iowan Old Style', Georgia, serif; font-size: 12pt; line-height: 1.5; }
h1, h2, h3, h4 { font-weight: bold; line-height: 1.25; page-break-after: avoid; break-after: avoid; }
.page-break { height: 0; margin: 0; border: 0; break-after: page; page-break-after: always; }
h1 { font-size: 16pt; margin: 24pt 0 6pt; }
h2 { font-size: 14pt; margin: 18pt 0 6pt; }
h3 { font-size: 12pt; font-style: italic; margin: 12pt 0 6pt; }
h1.title { text-align: center; font-weight: normal; font-size: 20pt; margin: 0 0 18pt; }
p { margin: 0 0 6pt; text-align: justify; hyphens: manual; orphans: 3; widows: 3; }
blockquote { margin: 6pt 1cm 10pt 1.5cm; font-size: 11pt; line-height: 1.25; }
blockquote p { margin: 0; }
ul, ol { margin: 0 0 6pt; padding-left: 1.2cm; }
li { margin: 0 0 3pt; }
sup.fnref { font-size: 8pt; line-height: 0; }
.footnotes { margin-top: 18pt; font-size: 10pt; line-height: 1.25; break-inside: auto; }
.footnotes hr { border: 0; border-top: 0.5pt solid #000; width: 5cm; margin: 0 0 6pt; }
.footnotes ol { padding-left: 0.8cm; margin: 0; }
.footnotes li { margin: 0 0 3pt; }
${tc ? typoCss(m, tc) : ''}
</style>
</head>
<body>
${bodyHtml(m, false, tc)}
</body>
</html>
`;
}

export function exportText(m: DocModel, format: TextFormat, title: string, opts: ExportOptions = {}): string {
  if (format === 'md') return toMarkdown(m);
  if (format === 'html') return toHtml(m, title, opts);
  return toText(m);
}

/** Nom de fichier sûr (sans / : etc.). */
export function safeFileName(title: string): string {
  const t = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (t || 'Sans titre').slice(0, 120);
}
