// Utilitaires du module Concepts & Extraits (B2).
import type { Highlight } from '../../lib/types';

/** Minuscules sans accents ni apostrophes typographiques (recherche insensible aux accents). */
export const norm = (x: string) =>
  x
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[’‘]/g, "'")
    .toLowerCase();

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Clé d'ordre dans le texte : HTML (chapitre, début) ; PDF (page, premier y). */
export function textOrder(h: Highlight): [number, number] {
  const a = h.anchor;
  if (a.kind === 'html') return [a.chapter, a.start];
  return [a.page, a.rects.length ? Math.min(...a.rects.map((r) => r.y)) : 0];
}

export const byTextOrder = (a: Highlight, b: Highlight) => {
  const [a1, a2] = textOrder(a);
  const [b1, b2] = textOrder(b);
  return a1 - b1 || a2 - b2;
};

/** « Seconde partie · p. 42 » */
export function locationOf(h: Highlight): string {
  const p = h.printedPage.trim();
  const page = p ? `p. ${p}` : '';
  if (!h.locationLabel) return page;
  if (!page || h.locationLabel === page) return h.locationLabel;
  return `${h.locationLabel} · ${page}`;
}

export const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
export const clip = (s: string, n: number) => {
  const t = oneLine(s);
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

/** Pluriel simple : plural(2, 'extrait') → « 2 extraits ». */
export const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`;
