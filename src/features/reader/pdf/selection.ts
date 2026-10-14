// Lecture de la sélection de texte dans les pages PDF : ancrage normalisé, texte propre, rectangle.
import type { PdfAnchor } from '../../../lib/types';
import { buildIndex, mergeLineRects, toNorm, unionPx, type Px } from './textindex';

export interface PdfSelection {
  page: number;
  anchor: PdfAnchor;
  text: string;
  rect: DOMRect;
}

/**
 * Lit la sélection courante si elle débute dans `root`. Elle est limitée à la première page
 * concernée (une annotation = une page). Les rectangles sont calculés nœud texte par nœud texte
 * (équivalent de Range.getClientRects() sans les boîtes d'éléments), fusionnés par ligne,
 * puis normalisés (0..1) par rapport à la page.
 */
export function readSelection(root: HTMLElement): PdfSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const startEl = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement;
  const pageEl = startEl?.closest<HTMLElement>('.pdf-page');
  if (!pageEl) return null;
  const layer = pageEl.querySelector('.textLayer');
  if (!layer) return null;
  const page = Number(pageEl.dataset.page);

  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let raw = '';
  const px: Px[] = [];
  let prevLast: Px | null = null;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n.nodeType === 1) {
      if ((n as Element).tagName === 'BR' && raw && range.intersectsNode(n)) raw += '\n';
      continue;
    }
    const t = n as Text;
    if (!range.intersectsNode(t)) continue;
    const s = t === range.startContainer ? range.startOffset : 0;
    const e = t === range.endContainer ? range.endOffset : t.data.length;
    if (e <= s) continue;
    const sub = document.createRange();
    sub.setStart(t, s);
    sub.setEnd(t, e);
    const rects = Array.from(sub.getClientRects())
      .map((q) => ({ left: q.left, top: q.top, right: q.right, bottom: q.bottom }))
      .filter((q) => q.right - q.left > 0.5 && q.bottom - q.top > 0.5);
    if (!rects.length) continue;
    // Changement de ligne sans <br> : on matérialise la fin de ligne (pour recoller les césures).
    if (raw && prevLast && !/\s$/.test(raw) && rects[0].top > prevLast.top + (prevLast.bottom - prevLast.top) * 0.6) raw += '\n';
    raw += t.data.slice(s, e);
    px.push(...rects);
    prevLast = rects[rects.length - 1];
  }
  const text = buildIndex(raw).clean.trim();
  const merged = mergeLineRects(px);
  const box = unionPx(merged);
  if (!text || !box) return null;
  const pr = pageEl.getBoundingClientRect();
  const norm = merged.map((r) => toNorm(r, pr));
  return {
    page,
    anchor: { kind: 'pdf', page, rects: norm },
    text,
    rect: new DOMRect(box.left, box.top, box.right - box.left, box.bottom - box.top),
  };
}
