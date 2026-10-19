// Livres et documents : les pointeurs des autres pendant « Travailler à plusieurs » (collab/cursors.ts).
//
// Position rattachée au contenu, jamais à l'écran :
//  - PDF et photos : numéro de page + fraction de la page (fx, fy). La page est une image fixe : la même
//    fraction désigne le même point quels que soient le zoom, la taille de la fenêtre et le défilement.
//  - EPUB / DOCX / Markdown / texte / HTML : chapitre + caractère sous le pointeur (offset dans le textContent
//    du chapitre, la règle d'ancrage des surlignages : le même chez tous, décorations comprises) + position
//    dans ce caractère (rx, ry). Le texte se recompose (largeur, taille de texte, page par page) : seul un
//    repère dans le texte reste juste ; une fraction de la page ou du chapitre glisserait d'une ligne à
//    l'autre. Hors du texte (marges), x devient une fraction de la largeur de la colonne (mx), y reste
//    celui de la ligne la plus proche.
// On ne voit le pointeur que si cette page / ce passage est affiché ici ; sinon « Marc lit page 12 ».
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCollab } from '../collab/collabState';
import { ctxKeyOf, Publisher, useCursorGate, type Loc } from '../collab/cursors';
import { LiveCursors, type CursorSurface, type Pt } from '../collab/LiveCursors';
import { locate, offsetOf } from './html/anchoring';
import { RemoteSelections, trackMySelection } from './ReaderSelections';

type Kind = 'pdf' | 'image' | 'html';
const SCROLL = '.pdf-scroll, .img-scroll, .html-scroll';
const PAGE = { pdf: '.pdf-page', image: '.img-page' } as const;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function ReaderCursors({ bookId, format, pageLabel }: { bookId: string; format: string; pageLabel: string }) {
  const on = useCursorGate((s) => s.on);
  const company = useCollab((s) => s.phase === 'live' && s.members.filter((m) => m.state === 'live').length > 1);
  const ctx = on && company ? ctxKeyOf('book', bookId) : null;
  if (!ctx) return null;
  const kind: Kind = format === 'pdf' ? 'pdf' : format === 'image' ? 'image' : 'html';
  return <ReaderCursorsOn ctx={ctx} kind={kind} pageLabel={pageLabel} />;
}

/** Point de la page (PDF, photo) sous (x, y), ou de la page la plus proche verticalement. */
function pageAt(host: HTMLElement, kind: 'pdf' | 'image', t: Element | null, x: number, y: number): HTMLElement | null {
  const hit = t?.closest<HTMLElement>(PAGE[kind]);
  if (hit) return hit;
  const sc = host.querySelector(SCROLL)?.getBoundingClientRect();
  if (!sc || y < sc.top || y > sc.bottom || x < sc.left || x > sc.right) return null;
  for (const dx of [0.5, 0.3, 0.7]) {
    const el = document.elementFromPoint(sc.left + sc.width * dx, y)?.closest<HTMLElement>(PAGE[kind]);
    if (el) return el;
  }
  return null;
}

function chapterAt(host: HTMLElement, t: Element | null, x: number, y: number): HTMLElement | null {
  const sec = t?.closest('.html-chapter');
  const root = sec?.querySelector<HTMLElement>('.html-chapter-text');
  if (root) return root;
  const sc = host.querySelector(SCROLL)?.getBoundingClientRect();
  if (!sc || y < sc.top || y > sc.bottom || x < sc.left || x > sc.right) return null;
  for (const dx of [0.5, 0.35, 0.65]) {
    const r = document.elementFromPoint(sc.left + sc.width * dx, y)?.closest('.html-chapter')?.querySelector<HTMLElement>('.html-chapter-text');
    if (r) return r;
  }
  return null;
}

/** Rectangle du caractère `off` de `node` (le dernier si on est en fin de nœud). */
function charRect(node: Text, off: number): { range: Range; at: number } | null {
  const len = node.data.length;
  if (!len) return null;
  const a = Math.min(Math.max(0, off), len - 1);
  const range = document.createRange();
  range.setStart(node, a);
  range.setEnd(node, a + 1);
  return { range, at: a };
}
function rectOf(range: Range): DOMRect | null {
  const rs = range.getClientRects();
  const r = rs.length ? rs[0] : range.getBoundingClientRect();
  return r.width === 0 && r.height === 0 ? null : r;
}

/**
 * Caractère de référence du pointeur : celui de la ligne sous le pointeur. caretRangeFromPoint rend un point
 * d'insertion entre deux caractères ; en bout de ligne, le caractère qui suit est déjà sur la ligne suivante
 * (et, en début de ligne, celui qui précède sur la ligne d'avant). Prendre toujours « le caractère après le
 * point d'insertion » faisait sauter le repère d'une ligne à l'autre pendant qu'on glisse le long du texte :
 * chez les autres (mise en page différente), le pointeur sautait de ligne et revenait. On garde donc, des
 * deux voisins, celui dont la ligne contient le pointeur (puis le plus proche horizontalement).
 * Au-delà du dernier caractère d'une ligne, le repère reste ce caractère (rx > 1) : l'ancien passage à une
 * fraction de la colonne (mx) dès 1,5 caractère de distance faisait bondir le pointeur chez les autres (le même
 * caractère n'y est pas au même endroit de la ligne), puis revenir au caractère suivant.
 */
function charOnLine(root: HTMLElement, node: Text, off: number, x: number, y: number): { node: Text; at: number; r: DOMRect } | null {
  // Voisins : dans le même nœud texte, ou à la frontière avec le nœud précédent / suivant (mot en italique…).
  const cands: [Text, number][] = [];
  const walker = () => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    w.currentNode = node;
    return w;
  };
  if (off > 0) cands.push([node, off - 1]);
  else {
    const prev = walker().previousNode() as Text | null;
    if (prev?.data.length) cands.push([prev, prev.data.length - 1]);
  }
  if (off < node.data.length) cands.push([node, off]);
  else {
    const next = walker().nextNode() as Text | null;
    if (next?.data.length) cands.push([next, 0]);
  }
  let best: { node: Text; at: number; r: DOMRect; score: number } | null = null;
  for (const [n, i] of cands) {
    const c = charRect(n, i);
    const r = c && rectOf(c.range);
    if (!c || !r) continue;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    // Espace de fin de ligne (largeur nulle) : on lui préfère le dernier caractère visible de la ligne, dont la
    // largeur donne l'échelle de rx (sinon rx compterait des pixels, sans rapport avec la taille du texte d'ici).
    const score = dy * 1e4 + dx + (r.width < 0.5 ? 5e3 : 0);
    if (!best || score < best.score) best = { node: n, at: c.at, r, score };
  }
  return best;
}

/** Position à envoyer pour le pointeur en (x, y) ; null : hors du contenu. */
function encode(host: HTMLElement, kind: Kind, t: Element | null, x: number, y: number): Loc | null {
  if (kind !== 'html') {
    const pg = pageAt(host, kind, t, x, y);
    const n = Number(pg?.dataset.page);
    if (!pg || !Number.isFinite(n)) return null;
    const r = pg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { u: `p${n}`, fx: clamp((x - r.left) / r.width, -1, 2), fy: clamp((y - r.top) / r.height, -1, 2) };
  }
  const root = chapterAt(host, t, x, y);
  const ch = Number(root?.dataset.chapter);
  if (!root || !Number.isFinite(ch)) return null;
  const u = `c${ch}`;
  const rr = root.getBoundingClientRect();
  if (!rr.width || !rr.height) return null;
  const cx = clamp(x, rr.left + 1, rr.right - 1);
  const cr = document.caretRangeFromPoint?.(cx, y);
  const node = cr?.startContainer;
  if (cr && node && node.nodeType === 3 && root.contains(node)) {
    const c = charOnLine(root, node as Text, cr.startOffset, cx, y);
    if (c) {
      const { r } = c;
      const o = offsetOf(root, c.node, c.at);
      const ry = clamp((y - r.top) / Math.max(r.height, 1), -40, 40);
      const rx = (x - r.left) / Math.max(r.width, 1);
      // Repère continu le long de la ligne (rx, même au-delà de son dernier caractère) ; hors de la colonne
      // de texte, ou très loin du caractère, fraction de la largeur du chapitre.
      const inCol = x >= rr.left && x <= rr.right && Math.abs(rx) <= 40;
      if (o >= 0) return inCol ? { u, o, rx, ry } : { u, o, mx: clamp((x - rr.left) / rr.width, -1, 2), ry };
    }
  }
  return { u, fx: clamp((x - rr.left) / rr.width, -1, 2), fy: clamp((y - rr.top) / rr.height, -1, 2) };
}

/** Lecture d'une position reçue (voir encode). */
function decode(host: HTMLElement, kind: Kind, loc: Loc): (() => Pt | null) | null {
  if ('x' in loc) return null;
  const n = Number(loc.u.slice(1));
  if (kind !== 'html') {
    if (loc.u[0] !== 'p' || !('fx' in loc)) return null;
    const sel = kind === 'pdf' ? `.pdf-page[data-page="${n}"]` : `.img-page[data-page="${n}"]`;
    return () => {
      const pg = host.querySelector<HTMLElement>(sel);
      const r = pg?.getBoundingClientRect();
      if (!r || !r.width) return null;
      return { x: r.left + loc.fx * r.width, y: r.top + loc.fy * r.height };
    };
  }
  if (loc.u[0] !== 'c') return null;
  const root = host.querySelector<HTMLElement>(`.html-chapter-text[data-chapter="${n}"]`);
  if (!root) return null;
  if ('fx' in loc)
    return () => {
      const rr = root.isConnected ? root.getBoundingClientRect() : null;
      return rr && rr.width ? { x: rr.left + loc.fx * rr.width, y: rr.top + loc.fy * rr.height } : null;
    };
  const at = locate(root, loc.o, 'start');
  const c = at && charRect(at.node, at.offset);
  if (!c) return null;
  return () => {
    if (!root.isConnected) return null;
    const r = rectOf(c.range);
    if (!r) return null;
    let x: number;
    if (loc.rx !== undefined) x = r.left + loc.rx * Math.max(r.width, 1);
    else {
      const rr = root.getBoundingClientRect();
      x = rr.left + (loc.mx ?? 0) * rr.width;
    }
    return { x, y: r.top + loc.ry * r.height };
  };
}

/** Où je lis (unité affichée au centre de la vue). */
function whereNow(host: HTMLElement, kind: Kind, pageLabel: string): { u: string; label: string } | null {
  const sc = host.querySelector(SCROLL)?.getBoundingClientRect();
  if (!sc || !sc.width) return null;
  const cx = sc.left + sc.width / 2;
  const cy = sc.top + sc.height / 2;
  if (kind !== 'html') {
    const pg = pageAt(host, kind, null, cx, cy) ?? host.querySelector<HTMLElement>(PAGE[kind]);
    const n = Number(pg?.dataset.page);
    return Number.isFinite(n) && pg ? { u: `p${n}`, label: `page ${pageLabel || n}` } : null;
  }
  const root = chapterAt(host, null, cx, cy) ?? chapterAt(host, null, cx, sc.top + 20);
  const ch = Number(root?.dataset.chapter);
  if (!root || !Number.isFinite(ch)) return null;
  return { u: `c${ch}`, label: pageLabel ? `page ${pageLabel}` : `le chapitre ${ch + 1}` };
}

function ReaderCursorsOn({ ctx, kind, pageLabel }: { ctx: string; kind: Kind; pageLabel: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [unit, setUnit] = useState<string | null>(null);
  const label = useRef(pageLabel);
  label.current = pageLabel;
  const pubRef = useRef<Publisher | null>(null);

  useEffect(() => {
    const host = anchor.current?.parentElement;
    if (!host) return;
    const p = new Publisher(ctx);
    pubRef.current = p;
    // Ma sélection de texte (montrée aux autres, à leur couleur près).
    const mySel = trackMySelection(host, kind, p);
    mySel.refresh();
    const onMove = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && !t.closest(SCROLL)) {
        p.move(null);
        return;
      }
      p.move(encode(host, kind, t, e.clientX, e.clientY), e.timeStamp);
    };
    const onLeave = () => p.move(null);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const where = () => {
      timer = null;
      mySel.refresh(); // passage sorti de la vue : la sélection n'est plus montrée
      const w = whereNow(host, kind, label.current);
      p.setWhere(w);
      setUnit(w?.u ?? null);
    };
    const onScroll = () => {
      if (!timer) timer = setTimeout(where, 250);
    };
    host.addEventListener('pointermove', onMove, true);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('scroll', onScroll, true);
    const first = setTimeout(where, 300);
    // Photos : la page change sans défilement (← →).
    const mo = kind === 'image' ? new MutationObserver(onScroll) : null;
    mo?.observe(host, { subtree: true, attributes: true, attributeFilter: ['data-page'] });
    return () => {
      mo?.disconnect();
      host.removeEventListener('pointermove', onMove, true);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('scroll', onScroll, true);
      clearTimeout(first);
      if (timer) clearTimeout(timer);
      mySel.stop();
      p.close();
      pubRef.current = null;
    };
  }, [ctx, kind]);

  // Page affichée qui change sans défilement (photos : page suivante ; libellé de page mis à jour).
  useEffect(() => {
    const host = anchor.current?.parentElement;
    const p = pubRef.current;
    if (!host || !p) return;
    const t = setTimeout(() => {
      const w = whereNow(host, kind, pageLabel);
      p.setWhere(w);
      setUnit(w?.u ?? null);
    }, 120);
    return () => clearTimeout(t);
  }, [pageLabel, kind]);

  const surface = useMemo<CursorSurface>(
    () => ({
      resolve: (loc) => {
        const host = anchor.current?.parentElement;
        return host ? decode(host, kind, loc) : null;
      },
      clip: () => anchor.current?.parentElement?.querySelector(SCROLL)?.getBoundingClientRect() ?? null,
    }),
    [kind],
  );

  const hostRef = useMemo(
    () => ({
      get current() {
        return anchor.current?.parentElement ?? null;
      },
    }),
    [],
  );

  return (
    <>
      <span ref={anchor} hidden />
      <RemoteSelections ctx={ctx} kind={kind} hostRef={hostRef} />
      <LiveCursors ctx={ctx} surface={surface} unit={unit} />
    </>
  );
}
