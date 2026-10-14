// Typographie française automatique pendant la frappe (insécables, guillemets, apostrophe, …, –).
// Greffée sur l'éditeur ProseMirror de SuperDoc par un plugin (handleTextInput) : le caractère tapé est
// inséré normalement, puis la correction est appliquée dans une transaction SÉPARÉE (groupe d'historique
// distinct) — un ⌘Z juste après annule donc la correction seulement et laisse le caractère tapé.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export const NNBSP = ' ';
export const NBSP = ' ';
const KEY = 'marginalia.ed.frTypography';

let enabled = true;
try {
  enabled = localStorage.getItem(KEY) !== '0';
} catch {
  /* stockage indisponible : activée par défaut */
}
const listeners = new Set<() => void>();
export const typographyEnabled = (): boolean => enabled;
export function setTypographyEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* ignoré */
  }
  listeners.forEach((l) => l());
}
export function subscribeTypography(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

interface Ch {
  ch: string;
  pos: number;
}
/** Caractères du paragraphe avant `from`, avec leur position (texte uniquement). */
function charsBefore(doc: Any, from: number, max = 160): Ch[] {
  const $f = doc.resolve(from);
  let d = $f.depth;
  while (d > 0 && $f.node(d).type.name !== 'paragraph') d--;
  const start = Math.max($f.start(d), from - max * 3);
  const out: Ch[] = [];
  doc.nodesBetween(start, from, (n: Any, pos: number) => {
    if (n.isText) {
      const t: string = n.text ?? '';
      for (let i = 0; i < t.length && pos + i < from; i++) if (pos + i >= start) out.push({ ch: t[i], pos: pos + i });
    }
    return true;
  });
  return out.slice(-max);
}

function inCode(state: Any, from: number): boolean {
  const $f = state.doc.resolve(from);
  for (let d = $f.depth; d > 0; d--) {
    const n = $f.node(d);
    if (/code|pre/i.test(n.type.name)) return true;
    const rp = n.attrs?.runProperties;
    if (rp && /mono|courier|consolas|menlo/i.test(JSON.stringify(rp))) return true;
  }
  for (const m of $f.marks()) if (/code/i.test(m.type.name)) return true;
  return false;
}

const URL_TOKEN = /(^|[^\p{L}])(https?:|ftp:|www\.)|:\/\/|@|\/\/|\w\.\w{2,}\//iu;
const SCHEMES = /^(https?|ftp|mailto|file|tel|data|www)$/i;

function trailingToken(chars: Ch[]): string {
  let i = chars.length;
  while (i > 0 && !/[\s  ]/.test(chars[i - 1].ch)) i--;
  return chars
    .slice(i)
    .map((c) => c.ch)
    .join('');
}

/** Calcule la correction pour `text` tapé en `from` : [début à remplacer, remplacement] ou null. */
export function correction(state: Any, from: number, text: string): { start: number; text: string } | null {
  if (text.length !== 1) return null;
  const chars = charsBefore(state.doc, from);
  const last = chars[chars.length - 1];
  const prev = chars[chars.length - 2];
  const token = trailingToken(chars);
  const contiguous = (a: Ch | undefined, b: number) => !!a && a.pos + 1 === b;
  const urlish = URL_TOKEN.test(token);
  if (urlish && text !== ' ') return null;

  switch (text) {
    case ';':
    case '!':
    case '?':
    case ':': {
      if (!last) return null;
      const sp = text === ':' ? NBSP : NNBSP;
      if (/[  ]/.test(last.ch)) return null;
      if (last.ch === ' ') {
        if (!prev || /\s/.test(prev.ch)) return null;
        return contiguous(last, from) ? { start: last.pos, text: sp + text } : null;
      }
      if (text === ':') {
        if (SCHEMES.test(token)) return null;
        if (!/[\p{L})\]»”]/u.test(last.ch)) return null;
      } else if (!/[\p{L}\p{N})\]»”’'%]/u.test(last.ch)) return null;
      return { start: from, text: sp + text };
    }
    case '"': {
      if (inCode(state, from)) return null;
      const opening = !last || /[\s  ([{–—‘«]/.test(last.ch);
      if (opening) return { start: from, text: '«' + NBSP };
      if (/[  ]/.test(last.ch)) return { start: from, text: '»' };
      return { start: from, text: NBSP + '»' };
    }
    case "'":
      return { start: from, text: '’' };
    case '.':
      if (last?.ch === '.' && prev?.ch === '.' && chars[chars.length - 3]?.ch !== '.' && contiguous(prev, last!.pos) && contiguous(last, from))
        return { start: prev.pos, text: '…' };
      return null;
    case '-':
      if (last?.ch === '-' && prev?.ch !== '-' && contiguous(last, from)) return { start: last.pos, text: '–' };
      if (last?.ch === '–' && contiguous(last, from)) return { start: last.pos, text: '—' };
      return null;
    case ' ':
      // Espace insécable après le tiret de dialogue en début de paragraphe.
      if (last && chars.length === 1 && /[–—]/.test(last.ch) && contiguous(last, from)) return { start: from, text: NBSP };
      return null;
    default:
      return null;
  }
}

const done = new WeakSet<object>();
const HIST_CLOSE = 'closeHistory$';

/** Installe la typographie sur un éditeur SuperDoc (idempotent). */
export function attachTypography(ed: Any): boolean {
  if (!ed || done.has(ed) || typeof ed.registerPlugin !== 'function' || !ed.state?.plugins?.length) return false;
  const PluginCtor = ed.state.plugins[0].constructor;
  const plugin = new PluginCtor({
    props: {
      handleTextInput(view: Any, from: number, to: number, text: string) {
        if (!enabled || view.composing || text.length !== 1) return false;
        const state = view.state;
        if (!state.selection.empty || from !== to) return false;
        // « Espace après un guillemet ouvrant » : déjà insérée → on l'avale.
        if (text === ' ') {
          const cs = charsBefore(state.doc, from, 2);
          const l = cs[cs.length - 1];
          if (l && l.ch === NBSP && cs[cs.length - 2]?.ch === '«' && l.pos + 1 === from) return true;
        }
        if (inCode(state, from) && text !== ' ') return false;
        let c: ReturnType<typeof correction>;
        try {
          c = correction(state, from, text);
        } catch {
          return false;
        }
        if (!c) return false;
        // 1) le caractère tapé, normalement ; 2) la correction, dans un groupe d'historique à part.
        view.dispatch(state.tr.insertText(text, from, to));
        const tr = view.state.tr.insertText(c.text, c.start, from + 1);
        tr.setMeta(HIST_CLOSE, true);
        view.dispatch(tr);
        return true;
      },
    },
  });
  ed.registerPlugin(plugin);
  done.add(ed);
  return true;
}
