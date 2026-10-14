// Moteur de lecture HTML (EPUB, DOCX, Markdown, TXT, HTML) — agent A1.
//
// Rendu : défilement continu de tous les chapitres dans une seule colonne centrée,
// chaque chapitre dans une <section> en `content-visibility: auto` (seuls les chapitres
// proches de la vue sont mis en page et peints). Choix motivé dans html-reader.css.
//
// Ancrage : offsets dans le textContent de .html-chapter-text (canonique, voir parse.ts).
// Toutes les décorations (surlignages, connecteurs, résultats de recherche) enveloppent
// des nœuds texte sans jamais changer ce textContent ; les repères de mouvements vivent
// hors du conteneur de texte (.html-marks).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { BookmarkPlus, Copy } from 'lucide-react';
import type { Anchor, Bookmark, Highlight, HtmlAnchor, TocItem } from '../../../lib/types';
import { CONNECTORS } from '../../../lib/categories';
import { SelectionToolbar } from '../../../components/SelectionToolbar';
import { ContextMenu } from '../../workspaces/wsUi';
import type { BookmarkPoint, EngineHandle, EngineProps, SearchHit } from '../engine';
import { bookmarkColor, clipWords, proposeLabel, sentenceAt } from '../bookmarks/bookmarks';
import { allIndexes, fold, isBlockEl, locate, makeAnchor, offsetOf, rangeFor, resolveAnchor, unwrapAll, wrapOffsets, type Folded, type TextSpan } from './anchoring';
import { parseBook, printedPageAt, ReaderError, type ParsedDoc } from './parse';
import './html-reader.css';

interface HlState {
  sig: string;
  els: HTMLElement[];
  span: TextSpan | null;
}

interface ReadingAnchor {
  chapter: number;
  offset: number;
  dy: number;
}

interface SelInfo {
  chapter: number;
  start: number;
  end: number;
}

const POSITION_INTERVAL = 250; // ≤ 4 notifications par seconde
const MAX_HITS = 1000;
const SMOOTH_MS = 380; // glissé vers un extrait, un titre, un résultat

const sigOf = (h: Highlight) => {
  const a = h.anchor as HtmlAnchor;
  return `${h.category ?? 'note'}|${a.chapter}|${a.start}|${a.end}|${a.prefix}|${a.suffix}|${h.text}`;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function connectorRegex(): RegExp {
  // Espaces internes : espace simple ou insécable (fines comprises), jamais un saut de bloc.
  const alts = [...new Set(CONNECTORS.map((c) => c.toLowerCase()))]
    .sort((a, b) => b.length - a.length)
    .map((c) => escapeRe(c).replace(/ /g, '[ \\u00a0\\u202f]'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export const HtmlReader = forwardRef<EngineHandle, EngineProps>(function HtmlReader(props, ref) {
  const { book, data, settings } = props;
  const propsRef = useRef(props);
  propsRef.current = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const parsedRef = useRef<ParsedDoc | null>(null);
  const rootsRef = useRef<HTMLElement[]>([]); // .html-chapter-text
  const sectionsRef = useRef<HTMLElement[]>([]);
  const foldRef = useRef<(Folded | null)[]>([]);
  const cumRef = useRef<number[]>([]);
  const hlRef = useRef(new Map<string, HlState>());
  const activeElsRef = useRef<HTMLElement[]>([]);
  const connectorsOnRef = useRef(false);
  const readyRef = useRef(false);
  const restoringRef = useRef(0);
  const anchorRef = useRef<ReadingAnchor | null>(null);
  const currentHitRef = useRef<string | null>(null);
  const selInfoRef = useRef<SelInfo | null>(null);
  const mouseDownRef = useRef(false);
  const navTokenRef = useRef(0);
  /** Signets résolus (ancrage → offsets), recalculés seulement si l'ancrage change. */
  const bmCacheRef = useRef(new Map<string, { sig: string; span: TextSpan | null }>());
  const [loaded, setLoaded] = useState(0);
  const [selRect, setSelRect] = useState<DOMRect | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; point: BookmarkPoint; copy: string } | null>(null);
  /** Texte prêt : déclenche l'apparition douce (le shell montre <PageSkeleton> avant). */
  const [revealed, setRevealed] = useState(false);

  // ── Utilitaires DOM de cette instance ─────────────────────

  const texts = () => parsedRef.current?.chapters.map((c) => c.text) ?? [];

  const rootOf = (node: Node | null): HTMLElement | null => {
    const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
    const root = el?.closest('.html-chapter-text') as HTMLElement | null;
    return root && docRef.current?.contains(root) ? root : null;
  };
  const chapterOfRoot = (root: HTMLElement) => rootsRef.current.indexOf(root);

  /** Exécute une mutation du DOM en conservant la sélection courante (via offsets texte). */
  const preserveSelection = (fn: () => void) => {
    const s = window.getSelection();
    let saved: { c0: number; o0: number; c1: number; o1: number } | null = null;
    if (s && s.rangeCount && !s.isCollapsed) {
      const r = s.getRangeAt(0);
      const ra = rootOf(r.startContainer);
      const rb = rootOf(r.endContainer);
      if (ra && rb) {
        saved = {
          c0: chapterOfRoot(ra),
          o0: offsetOf(ra, r.startContainer, r.startOffset),
          c1: chapterOfRoot(rb),
          o1: offsetOf(rb, r.endContainer, r.endOffset),
        };
      }
    }
    fn();
    if (saved && s) {
      // Début repéré « vers l'avant », fin « vers l'arrière » : un point situé à la jonction
      // de deux nœuds texte doit tomber dans le nœud qui contient le texte sélectionné (sinon
      // Chromium ancre la sélection dans un blanc non rendu entre deux blocs et la vide).
      const a = locate(rootsRef.current[saved.c0], saved.o0, 'start');
      const b = locate(rootsRef.current[saved.c1], saved.o1, 'end');
      if (a && b) {
        const r = document.createRange();
        r.setStart(a.node, a.offset);
        r.setEnd(b.node, b.offset);
        s.removeAllRanges();
        s.addRange(r);
      }
    }
  };

  const sectionTop = (i: number) => {
    const sc = scrollRef.current!;
    const sec = sectionsRef.current[i];
    return sec.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
  };

  /** Rectangle du caractère `offset` (ou de la position) dans un chapitre. */
  const charRect = (chapter: number, offset: number): DOMRect | null => {
    const root = rootsRef.current[chapter];
    if (!root) return null;
    const len = parsedRef.current!.chapters[chapter].text.length;
    const r = rangeFor(root, Math.min(offset, Math.max(0, len - 1)), Math.min(len, offset + 1));
    if (!r) return null;
    const rects = r.getClientRects();
    return rects.length ? rects[0] : r.getBoundingClientRect();
  };

  /**
   * Fait défiler vers une cible recalculée à chaque image tant qu'elle bouge
   * (les chapitres en content-visibility prennent leur vraie hauteur en apparaissant).
   */
  const scrollStable = async (target: () => number | null, alive: () => boolean = () => true) => {
    const sc = scrollRef.current;
    if (!sc) return;
    restoringRef.current++;
    try {
      let stable = 0;
      for (let i = 0; i < 12 && stable < 2 && alive(); i++) {
        const t = target();
        if (t == null) break;
        const want = Math.max(0, Math.min(t, sc.scrollHeight - sc.clientHeight));
        if (Math.abs(sc.scrollTop - want) > 1) {
          sc.scrollTop = want;
          stable = 0;
        } else stable++;
        await nextFrame();
      }
    } finally {
      restoringRef.current--;
    }
  };

  /**
   * Défilement fluide vers une cible (sommaire, extrait, résultat, mouvement).
   * - cible recalculée à chaque image (les hauteurs estimées se corrigent en chemin) ;
   * - saut lointain : bond instantané jusqu'à ~0,6 écran de la cible, puis glissé court,
   *   pour ne pas faire défiler tout un livre sous les yeux ;
   * - interrompu par toute nouvelle navigation ou par l'utilisateur (molette, toucher, clavier) ;
   * - instantané si l'utilisateur a demandé moins d'animations.
   * Se termine par un recalage stable puis une notification de position.
   */
  const smoothTo = async (target: () => number | null) => {
    const sc = scrollRef.current;
    if (!sc) return;
    const token = ++navTokenRef.current;
    const alive = () => token === navTokenRef.current;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!reduce) {
      restoringRef.current++;
      try {
        const clamp = (t: number) => Math.max(0, Math.min(t, sc.scrollHeight - sc.clientHeight));
        const t0 = target();
        if (t0 != null) {
          const dist = clamp(t0) - sc.scrollTop;
          if (Math.abs(dist) > sc.clientHeight * 1.5) {
            sc.scrollTop = clamp(t0) - Math.sign(dist) * sc.clientHeight * 0.6;
            await nextFrame();
          }
          const from = sc.scrollTop;
          const began = performance.now();
          for (;;) {
            await nextFrame();
            if (!alive()) return;
            const t = target();
            if (t == null) break;
            const k = Math.min(1, (performance.now() - began) / SMOOTH_MS);
            const eased = 1 - Math.pow(1 - k, 3);
            sc.scrollTop = from + (clamp(t) - from) * eased;
            if (k >= 1) break;
          }
        }
      } finally {
        restoringRef.current--;
      }
    }
    if (!alive()) return;
    await scrollStable(target, alive);
    if (alive()) scheduleReport();
  };

  // ── Position de lecture ───────────────────────────────────

  const currentChapter = (): number => {
    const sc = scrollRef.current;
    const secs = sectionsRef.current;
    if (!sc || !secs.length) return 0;
    const top = sc.getBoundingClientRect().top + 1;
    let lo = 0;
    let hi = secs.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (secs[mid].getBoundingClientRect().top <= top) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  };

  const captureAnchor = (): ReadingAnchor | null => {
    const sc = scrollRef.current;
    if (!sc || !rootsRef.current.length) return null;
    const scRect = sc.getBoundingClientRect();
    const ch = currentChapter();
    const col = rootsRef.current[ch]?.parentElement;
    if (!col) return null;
    const colRect = col.getBoundingClientRect();
    const x = colRect.left + Math.min(colRect.width / 2, 120);
    for (const dy of [16, 48, 96, 160]) {
      const y = scRect.top + dy;
      if (y > scRect.bottom) break;
      const r = document.caretRangeFromPoint?.(x, y);
      const root = r && rootOf(r.startContainer);
      if (!r || !root) continue;
      const chapter = chapterOfRoot(root);
      const offset = offsetOf(root, r.startContainer, r.startOffset);
      const rect = charRect(chapter, offset);
      if (!rect) continue;
      return { chapter, offset, dy: rect.top - scRect.top };
    }
    return null;
  };

  const restoreAnchor = (a: ReadingAnchor | null) => {
    if (!a) return Promise.resolve();
    return scrollStable(() => {
      const sc = scrollRef.current;
      const rect = charRect(a.chapter, a.offset);
      if (!sc || !rect) return null;
      return sc.scrollTop + rect.top - sc.getBoundingClientRect().top - a.dy;
    });
  };

  const lastReport = useRef(0);
  const reportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const report = () => {
    const parsed = parsedRef.current;
    const sc = scrollRef.current;
    if (!parsed || !sc || !readyRef.current) return;
    lastReport.current = Date.now();
    const ch = currentChapter();
    const top = sectionTop(ch);
    const h = sectionsRef.current[ch].offsetHeight || 1;
    const fraction = Math.max(0, Math.min(1, (sc.scrollTop - top) / h));
    const total = cumRef.current[cumRef.current.length - 1] || 1;
    let progress = (cumRef.current[ch] + fraction * parsed.chapters[ch].text.length) / total;
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) progress = 1;
    if (!restoringRef.current) anchorRef.current = captureAnchor() ?? anchorRef.current;
    propsRef.current.onPosition({ kind: 'html', chapter: ch, scroll: Number(fraction.toFixed(5)) }, Math.max(0, Math.min(1, progress)), parsed.chapters[ch].label);
  };
  const scheduleReport = () => {
    if (reportTimer.current) clearTimeout(reportTimer.current);
    const wait = POSITION_INTERVAL - (Date.now() - lastReport.current);
    if (wait <= 0) report();
    reportTimer.current = setTimeout(report, Math.max(wait, POSITION_INTERVAL));
  };

  // ── Décorations ───────────────────────────────────────────

  const applyActive = () => {
    activeElsRef.current.forEach((el) => el.classList.remove('active'));
    const id = propsRef.current.activeHighlightId;
    const st = id ? hlRef.current.get(id) : undefined;
    activeElsRef.current = st ? st.els : [];
    activeElsRef.current.forEach((el) => el.classList.add('active'));
  };

  const syncHighlights = () => {
    const parsed = parsedRef.current;
    if (!parsed) return;
    const state = hlRef.current;
    const next = new Map<string, Highlight>();
    for (const h of propsRef.current.highlights) if (h.anchor.kind === 'html') next.set(h.id, h);
    const removeIds: string[] = [];
    const add: Highlight[] = [];
    state.forEach((st, id) => {
      const h = next.get(id);
      if (!h || sigOf(h) !== st.sig) removeIds.push(id);
    });
    next.forEach((h, id) => {
      const st = state.get(id);
      if (!st || st.sig !== sigOf(h)) add.push(h);
    });
    if (!removeIds.length && !add.length) return;
    const tx = texts();
    preserveSelection(() => {
      const touched = new Set<Node>();
      for (const id of removeIds) {
        unwrapAll(state.get(id)!.els).forEach((p) => touched.add(p));
        state.delete(id);
      }
      touched.forEach((p) => p.isConnected && (p as Element).normalize());
      add.sort((a, b) => a.createdAt - b.createdAt);
      for (const h of add) {
        const span = resolveAnchor(tx, h.anchor as HtmlAnchor, h.text);
        let els: HTMLElement[] = [];
        if (span) {
          els = wrapOffsets(rootsRef.current[span.chapter], span.start, span.end, () => {
            const el = document.createElement('span');
            el.className = `hl ${h.category ? `hl-${h.category}` : 'hl-note'}`;
            el.setAttribute('data-hl-id', h.id);
            return el;
          });
        }
        state.set(h.id, { sig: sigOf(h), els, span: span ? { chapter: span.chapter, start: span.start, end: span.end } : null });
      }
    });
    applyActive();
  };

  const setConnectors = (on: boolean) => {
    if (!parsedRef.current || connectorsOnRef.current === on) return;
    connectorsOnRef.current = on;
    preserveSelection(() => {
      rootsRef.current.forEach((root, i) => {
        if (on) {
          const text = parsedRef.current!.chapters[i].text;
          const re = connectorRegex();
          const found: [number, number][] = [];
          for (const m of text.matchAll(re)) {
            const s = m.index!;
            if (m[0].toLowerCase() === 'or' && /['’]/.test(text[s - 1] ?? '')) continue; // « l’or »
            found.push([s, s + m[0].length]);
          }
          for (const [s, e] of found) {
            wrapOffsets(root, s, e, () => {
              const el = document.createElement('span');
              el.className = 'connector';
              return el;
            });
          }
        } else {
          unwrapAll(root.querySelectorAll('span.connector'));
          root.normalize();
        }
      });
    });
  };

  const renderMarkers = () => {
    const parsed = parsedRef.current;
    if (!parsed) return;
    rootsRef.current.forEach((root) => {
      const layer = root.parentElement?.querySelector('.html-marks');
      if (layer) layer.textContent = '';
    });
    const tx = texts();
    for (const m of propsRef.current.movements) {
      if (m.anchor.kind !== 'html') continue;
      const a = m.anchor;
      const quote = m.startText || '';
      const adj: HtmlAnchor = quote && quote.length !== a.end - a.start ? { ...a, suffix: '' } : a;
      const span = resolveAnchor(tx, adj, quote);
      if (!span) continue;
      const root = rootsRef.current[span.chapter];
      const col = root.parentElement!;
      const layer = col.querySelector('.html-marks');
      const rect = charRect(span.chapter, span.start);
      if (!layer || !rect) continue;
      const colRect = col.getBoundingClientRect();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'html-mv';
      btn.setAttribute('data-mv-id', m.id);
      btn.title = m.role ? `${m.title} — ${m.role}` : m.title;
      const sign = document.createElement('span');
      sign.className = 'html-mv-sign';
      sign.textContent = '§';
      const label = document.createElement('span');
      label.className = 'html-mv-label';
      label.textContent = m.title;
      btn.append(sign, label);
      btn.style.top = `${rect.top - colRect.top + rect.height / 2}px`;
      layer.appendChild(btn);
      const room = colRect.left - (sectionsRef.current[span.chapter]?.getBoundingClientRect().left ?? 0);
      if (btn.offsetWidth + 22 > room) btn.classList.add('compact');
    }
    // Signets : un petit ruban dans la marge droite, à la hauteur de la ligne marquée.
    for (const b of propsRef.current.bookmarks ?? []) {
      const span = resolveBookmark(b);
      if (!span) continue;
      const col = rootsRef.current[span.chapter]?.parentElement;
      const layer = col?.querySelector('.html-marks');
      const rect = charRect(span.chapter, span.start);
      if (!col || !layer || !rect) continue;
      const colRect = col.getBoundingClientRect();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'html-bm';
      btn.setAttribute('data-bm-id', b.id);
      btn.title = `Signet : ${b.label}`;
      btn.style.top = `${rect.top - colRect.top + rect.height / 2}px`;
      btn.style.setProperty('--bm-c', bookmarkColor(b.color));
      layer.appendChild(btn);
    }
  };

  // ── Signets ───────────────────────────────────────────────

  const bmSig = (b: Bookmark) =>
    b.anchor?.kind === 'html' ? `a|${b.anchor.chapter}|${b.anchor.start}|${b.anchor.prefix}|${b.excerpt ?? ''}` : `p|${JSON.stringify(b.position)}`;

  /** Offsets du début du passage marqué (ancrage, sinon position de lecture). */
  const resolveBookmark = (b: Bookmark): TextSpan | null => {
    const parsed = parsedRef.current;
    if (!parsed) return null;
    const sig = bmSig(b);
    const hit = bmCacheRef.current.get(b.id);
    if (hit && hit.sig === sig) return hit.span;
    let span: TextSpan | null = null;
    const a = b.anchor;
    if (a?.kind === 'html') {
      const quote = b.excerpt ?? '';
      const adj: HtmlAnchor = quote && quote.length !== a.end - a.start ? { ...a, end: a.start + quote.length, suffix: '' } : a;
      span = resolveAnchor(texts(), adj, quote) ?? resolveLoose(adj);
    } else if (b.position.kind === 'html') {
      const p = b.position;
      const c = parsed.chapters[p.chapter];
      if (c) {
        const off = Math.max(0, Math.min(c.text.length, Math.round(p.scroll * c.text.length)));
        span = { chapter: p.chapter, start: off, end: off };
      }
    }
    bmCacheRef.current.set(b.id, { sig, span });
    return span;
  };

  /** Bloc (paragraphe, titre, élément de liste) qui contient un offset ; null s'il n'y en a pas. */
  const blockAt = (chapter: number, offset: number): HTMLElement | null => {
    const root = rootsRef.current[chapter];
    const loc = root && locate(root, offset, 'start');
    if (!root || !loc) return null;
    let el: Element | null = loc.node.parentElement;
    while (el && el !== root && !isBlockEl(el)) el = el.parentElement;
    return el && el !== root ? (el as HTMLElement) : null;
  };

  /** Titre de section le plus proche avant l'offset (sinon le titre du chapitre). */
  const sectionAt = (chapter: number, offset: number): string => {
    const root = rootsRef.current[chapter];
    let label = '';
    if (root)
      for (const h of Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
        if (offsetOf(root, h, 0) > offset) break;
        const t = (h.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t) label = t;
      }
    return label || parsedRef.current?.chapters[chapter]?.label || '';
  };

  /** Endroit à marquer : début du passage à `offset`, libellé proposé, position et progression. */
  const pointFor = (chapter: number, offset: number): BookmarkPoint | null => {
    const parsed = parsedRef.current;
    const sc = scrollRef.current;
    const ch = parsed?.chapters[chapter];
    if (!parsed || !sc || !ch) return null;
    const text = ch.text;
    let start = Math.max(0, Math.min(offset, text.length));
    while (start < text.length && /\s/.test(text[start])) start++;
    const root = rootsRef.current[chapter];
    const block = blockAt(chapter, start);
    const bStart = block ? offsetOf(root, block, 0) : Math.max(0, text.lastIndexOf('\n', start - 1) + 1);
    const bEnd = block ? bStart + (block.textContent ?? '').length : (() => { const n = text.indexOf('\n', start); return n < 0 ? text.length : n; })();
    // 40 premiers caractères du passage, sans déborder sur le paragraphe suivant (sauf fin de paragraphe très courte).
    const end = Math.min(text.length, start + 40, bEnd - start >= 12 ? bEnd : Infinity);
    const excerpt = text.slice(start, end);
    const anchor = makeAnchor(text, chapter, start, end);
    const section = sectionAt(chapter, start) || propsRef.current.book.title;
    const heading = !!block && /^H[1-6]$/.test(block.tagName);
    const label = heading ? clipWords(block!.textContent ?? '', 60) : proposeLabel(section, sentenceAt(text.slice(bStart, bEnd), start - bStart));
    const total = cumRef.current[cumRef.current.length - 1] || 1;
    const progress = Math.max(0, Math.min(1, (cumRef.current[chapter] + start) / total));
    const rect = charRect(chapter, start);
    const sec = sectionsRef.current[chapter];
    const h = sec?.offsetHeight || 1;
    const fraction = rect && sec ? Math.max(0, Math.min(1, (rect.top - sec.getBoundingClientRect().top) / h)) : start / Math.max(1, text.length);
    return {
      position: { kind: 'html', chapter, scroll: Number(fraction.toFixed(5)) },
      anchor,
      excerpt,
      progress,
      locationLabel: ch.label || section,
      label,
    };
  };

  /** Endroit lu : première ligne entière en haut de la fenêtre, ramenée au début de son paragraphe s'il commence là. */
  const readingPoint = (): BookmarkPoint | null => {
    const sc = scrollRef.current;
    const parsed = parsedRef.current;
    if (!sc || !parsed || !rootsRef.current.length) return null;
    const scRect = sc.getBoundingClientRect();
    const ch0 = currentChapter();
    const col = rootsRef.current[ch0]?.parentElement;
    if (!col) return null;
    const colRect = col.getBoundingClientRect();
    const x = colRect.left + Math.min(colRect.width / 2, 120);
    const s = propsRef.current.settings;
    const line = s.fontSize * s.lineHeight;
    for (const dy of [8, 24, 48, 80, 120, 180, 260, 360]) {
      const y = scRect.top + dy;
      if (y > scRect.bottom) break;
      const r = document.caretRangeFromPoint?.(x, y);
      const root = r && rootOf(r.startContainer);
      if (!r || !root) continue;
      const chapter = chapterOfRoot(root);
      const offset = offsetOf(root, r.startContainer, r.startOffset);
      const rect = charRect(chapter, offset);
      if (!rect || rect.top < scRect.top - 2) continue;
      const block = blockAt(chapter, offset);
      let start = offset;
      if (block && block.getBoundingClientRect().top >= scRect.top - line * 1.6) start = offsetOf(root, block, 0);
      else {
        const text = parsed.chapters[chapter].text;
        while (start > 0 && !/\s/.test(text[start - 1])) start--;
      }
      return pointFor(chapter, start);
    }
    return null;
  };

  /** Bref surlignage du paragraphe marqué (calque au-dessus du texte : le DOM du texte reste intact). */
  const flashBookmark = (span: TextSpan, b: Bookmark) => {
    const root = rootsRef.current[span.chapter];
    const col = root?.parentElement;
    if (!col) return;
    const block = blockAt(span.chapter, span.start);
    const line = charRect(span.chapter, span.start);
    const br = block?.getBoundingClientRect() ?? line;
    if (!br) return;
    // Long paragraphe commencé bien plus haut : le voile part de la ligne marquée.
    const s = propsRef.current.settings;
    const top = line && line.top - br.top > s.fontSize * s.lineHeight * 2.5 ? line.top : br.top;
    const r = { top, height: br.bottom - top };
    const colRect = col.getBoundingClientRect();
    col.querySelectorAll('.html-bm-flash').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'html-bm-flash';
    el.setAttribute('aria-hidden', 'true');
    el.style.top = `${r.top - colRect.top - 4}px`;
    el.style.height = `${r.height + 8}px`;
    el.style.setProperty('--bm-c', bookmarkColor(b.color));
    col.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  };

  const updateEstimates = () => {
    const parsed = parsedRef.current;
    const sc = scrollRef.current;
    if (!parsed || !sc) return;
    const s = propsRef.current.settings;
    const colPx = Math.min(sc.clientWidth - 48, s.measure * s.fontSize * 0.52) || 600;
    const charsPerLine = Math.max(20, colPx / (s.fontSize * 0.5));
    sectionsRef.current.forEach((sec, i) => {
      const c = parsed.chapters[i];
      const blocks = c.el.childElementCount;
      const imgs = c.el.querySelectorAll('img').length;
      const est = (c.text.length / charsPerLine) * s.fontSize * s.lineHeight + blocks * s.fontSize + imgs * 400 + 160;
      sec.style.containIntrinsicSize = `auto ${Math.round(est)}px`;
    });
  };

  const clearSearchMarks = () => {
    const doc = docRef.current;
    if (!doc) return;
    const hits = doc.querySelectorAll('span.search-hit');
    if (!hits.length) return;
    preserveSelection(() => {
      const parents = unwrapAll(hits);
      parents.forEach((p) => p.isConnected && (p as Element).normalize());
    });
    currentHitRef.current = null;
  };

  const markHits = (hits: SearchHit[]) => {
    preserveSelection(() => {
      for (const hit of hits) {
        const p = hit.payload as TextSpan;
        const root = rootsRef.current[p.chapter];
        if (!root) continue;
        wrapOffsets(root, p.start, p.end, () => {
          const el = document.createElement('span');
          el.className = 'search-hit';
          el.setAttribute('data-hit', hit.id);
          return el;
        });
      }
    });
  };

  // ── Chargement ────────────────────────────────────────────

  useEffect(() => {
    let alive = true;
    let mine: ParsedDoc | null = null;
    readyRef.current = false;
    parsedRef.current = null;
    hlRef.current = new Map();
    bmCacheRef.current = new Map();
    activeElsRef.current = [];
    connectorsOnRef.current = false;
    anchorRef.current = null;
    setRevealed(false);
    if (docRef.current) docRef.current.textContent = '';
    parseBook(book, data)
      .then((parsed) => {
        mine = parsed;
        if (!alive) {
          parsed.urls.forEach((u) => URL.revokeObjectURL(u));
          return;
        }
        const doc = docRef.current!;
        const roots: HTMLElement[] = [];
        const sections: HTMLElement[] = [];
        parsed.chapters.forEach((c, i) => {
          const sec = document.createElement('section');
          sec.className = 'html-chapter';
          sec.setAttribute('data-chapter', String(i));
          const col = document.createElement('div');
          col.className = 'html-col';
          c.el.setAttribute('data-chapter', String(i));
          const marks = document.createElement('div');
          marks.className = 'html-marks';
          marks.setAttribute('aria-hidden', 'true');
          col.append(c.el, marks);
          sec.appendChild(col);
          doc.appendChild(sec);
          roots.push(c.el);
          sections.push(sec);
        });
        if (parsed.lang) doc.setAttribute('lang', parsed.lang);
        else doc.removeAttribute('lang');
        rootsRef.current = roots;
        sectionsRef.current = sections;
        foldRef.current = parsed.chapters.map(() => null);
        const cum = [0];
        parsed.chapters.forEach((c) => cum.push(cum[cum.length - 1] + c.text.length));
        cumRef.current = cum;
        parsedRef.current = parsed;
        updateEstimates();
        setLoaded((n) => n + 1);
      })
      .catch((e) => {
        if (!alive) return;
        if (!(e instanceof ReaderError)) console.error(e);
        propsRef.current.onError(
          e instanceof ReaderError ? e.message : `Impossible d’ouvrir ce document : ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    return () => {
      alive = false;
      readyRef.current = false;
      if (mine) mine.urls.forEach((u) => URL.revokeObjectURL(u));
      if (reportTimer.current) clearTimeout(reportTimer.current);
    };
  }, [book.id, data]);

  // Connecteurs logiques
  useLayoutEffect(() => {
    if (!loaded) return;
    if (!readyRef.current) {
      setConnectors(settings.showConnectors);
      return;
    }
    const a = captureAnchor() ?? anchorRef.current;
    setConnectors(settings.showConnectors);
    restoreAnchor(a).then(renderMarkers);
  }, [settings.showConnectors, loaded]);

  // Surlignages
  useLayoutEffect(() => {
    if (loaded) syncHighlights();
  }, [props.highlights, loaded]);

  useLayoutEffect(() => {
    if (loaded) applyActive();
  }, [props.activeHighlightId, loaded]);

  // Mouvements et signets
  useLayoutEffect(() => {
    if (loaded) renderMarkers();
  }, [props.movements, props.bookmarks, loaded]);

  // Prêt : sommaire, position initiale, puis onReady
  useEffect(() => {
    if (!loaded) return;
    const parsed = parsedRef.current!;
    let alive = true;
    propsRef.current.onToc(parsed.toc);
    (async () => {
      await nextFrame();
      // Pré-mise en page (sous le squelette) : chaque chapitre est rendu une fois, avec les polices
      // définitives, pour que `contain-intrinsic-size: auto` mémorise sa vraie hauteur. Sans cela,
      // la première sélection forçait la mise en page des chapitres hors écran : saccade et saut
      // de la page (perçu comme un redimensionnement), puis plus rien aux sélections suivantes.
      try {
        await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);
      } catch {
        /* polices : on continue */
      }
      const host = sectionsRef.current[0]?.parentElement;
      if (host && alive) {
        host.classList.add('html-warm');
        void host.offsetHeight;
        await nextFrame();
        host.classList.remove('html-warm');
        await nextFrame();
      }
      if (!alive) return;
      const init = propsRef.current.initialPosition;
      if (init && init.kind === 'html' && init.chapter >= 0 && init.chapter < parsed.chapters.length && (init.chapter > 0 || init.scroll > 0)) {
        await scrollStable(() => sectionTop(init.chapter) + init.scroll * (sectionsRef.current[init.chapter].offsetHeight || 0));
      }
      if (!alive) return;
      readyRef.current = true;
      setRevealed(true);
      propsRef.current.onReady();
      renderMarkers();
      report();
      document.fonts?.ready.then(() => alive && renderMarkers());
    })();
    return () => {
      alive = false;
    };
  }, [loaded]);

  // Typographie : garder le passage lu à la même hauteur
  const typoKey = `${settings.fontFamily}|${settings.fontSize}|${settings.lineHeight}|${settings.measure}`;
  const lastTypo = useRef(typoKey);
  const pendingAnchor = useRef<ReadingAnchor | null>(null);
  if (lastTypo.current !== typoKey) {
    // Lecture du DOM avant que React n'applique le nouveau style.
    lastTypo.current = typoKey;
    if (readyRef.current) pendingAnchor.current = captureAnchor() ?? anchorRef.current;
  }
  useLayoutEffect(() => {
    if (!loaded || !readyRef.current) return;
    updateEstimates();
    const a = pendingAnchor.current;
    pendingAnchor.current = null;
    restoreAnchor(a).then(() => {
      renderMarkers();
      report();
    });
  }, [typoKey]);

  // Défilement, redimensionnement
  useEffect(() => {
    const sc = scrollRef.current!;
    let raf = 0;
    const onScroll = () => {
      if (!readyRef.current) return;
      if (!restoringRef.current) scheduleReport();
      if (selInfoRef.current) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(refreshSelRect);
      }
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    // L'utilisateur reprend la main : on interrompt tout glissé en cours.
    const interrupt = () => navTokenRef.current++;
    const onKey = (e: KeyboardEvent) => {
      if (/^(Arrow|Page|Home|End| )/.test(e.key)) interrupt();
    };
    sc.addEventListener('wheel', interrupt, { passive: true });
    sc.addEventListener('touchstart', interrupt, { passive: true });
    sc.addEventListener('keydown', onKey);
    let lastW = sc.clientWidth;
    let roTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (sc.clientWidth === lastW) return;
      lastW = sc.clientWidth;
      if (!readyRef.current) return;
      const a = anchorRef.current;
      if (roTimer) clearTimeout(roTimer);
      roTimer = setTimeout(() => {
        updateEstimates();
        restoreAnchor(a).then(renderMarkers);
      }, 60);
    });
    ro.observe(sc);
    return () => {
      sc.removeEventListener('scroll', onScroll);
      sc.removeEventListener('wheel', interrupt);
      sc.removeEventListener('touchstart', interrupt);
      sc.removeEventListener('keydown', onKey);
      ro.disconnect();
      cancelAnimationFrame(raf);
      if (roTimer) clearTimeout(roTimer);
    };
  }, []);

  // ── Sélection ─────────────────────────────────────────────

  const hideToolbar = () => {
    selInfoRef.current = null;
    setSelRect(null);
  };

  const selRange = (info: SelInfo) => rangeFor(rootsRef.current[info.chapter], info.start, info.end);

  const refreshSelRect = () => {
    const info = selInfoRef.current;
    const r = info && selRange(info);
    if (r) setSelRect(r.getBoundingClientRect());
  };

  const readSelection = useCallback(() => {
    const parsed = parsedRef.current;
    const sc = scrollRef.current;
    if (!parsed || !sc || !readyRef.current) return hideToolbar();
    const s = window.getSelection();
    if (!s || !s.rangeCount || s.isCollapsed) return hideToolbar();
    const r = s.getRangeAt(0);
    if (!sc.contains(r.commonAncestorContainer) && !sc.contains(r.startContainer)) return hideToolbar();
    let root = rootOf(r.startContainer);
    let start = 0;
    if (root) start = offsetOf(root, r.startContainer, r.startOffset);
    else {
      root = rootsRef.current.find((x) => r.intersectsNode(x)) ?? null;
      if (!root) return hideToolbar();
    }
    const chapter = chapterOfRoot(root);
    const text = parsed.chapters[chapter].text;
    // Sélection limitée au premier chapitre si elle déborde.
    let end = root.contains(r.endContainer) ? offsetOf(root, r.endContainer, r.endOffset) : text.length;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end <= start) return hideToolbar();
    selInfoRef.current = { chapter, start, end };
    const clamped = rangeFor(root, start, end);
    const rect = (clamped ?? r).getBoundingClientRect();
    setSelRect(rect);
  }, []);

  useEffect(() => {
    const sc = scrollRef.current!;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onSelChange = () => {
      if (mouseDownRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(readSelection, 80);
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      mouseDownRef.current = true;
      navTokenRef.current++; // un clic interrompt un glissé en cours
      if (selInfoRef.current) hideToolbar();
    };
    const onUp = () => {
      if (!mouseDownRef.current) return;
      mouseDownRef.current = false;
      if (timer) clearTimeout(timer);
      timer = setTimeout(readSelection, 0);
    };
    document.addEventListener('selectionchange', onSelChange);
    sc.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('selectionchange', onSelChange);
      sc.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      if (timer) clearTimeout(timer);
    };
  }, [readSelection]);

  const takeSelection = () => {
    const info = selInfoRef.current;
    const parsed = parsedRef.current;
    if (!info || !parsed) return null;
    const ch = parsed.chapters[info.chapter];
    const anchor = makeAnchor(ch.text, info.chapter, info.start, info.end);
    const quote = ch.text.slice(info.start, info.end);
    window.getSelection()?.removeAllRanges();
    hideToolbar();
    return { info, anchor, quote, label: ch.label };
  };

  const onPick = (category: Highlight['category'], withNote: boolean) => {
    const t = takeSelection();
    if (!t) return;
    const printedPage = printedPageAt(parsedRef.current!.pages, t.info.chapter, t.info.start);
    propsRef.current.onCreateHighlight({ anchor: t.anchor, text: t.quote, locationLabel: t.label, category, printedPage }, withNote);
  };

  const onCite = () => {
    const t = takeSelection();
    if (!t) return;
    const printedPage = printedPageAt(parsedRef.current!.pages, t.info.chapter, t.info.start);
    propsRef.current.onCite?.({ anchor: t.anchor, text: t.quote, locationLabel: t.label, category: null, printedPage });
  };

  const onMovement = () => {
    const t = takeSelection();
    if (!t) return;
    propsRef.current.onCreateMovement({ anchor: t.anchor, text: t.quote.slice(0, 80), locationLabel: t.label });
  };

  const onCopy = () => {
    const info = selInfoRef.current;
    const parsed = parsedRef.current;
    if (!info || !parsed) return;
    const quote = parsed.chapters[info.chapter].text.slice(info.start, info.end);
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = quote;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        ta.remove();
      }
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(quote).catch(fallback);
    else fallback();
    window.getSelection()?.removeAllRanges();
    hideToolbar();
  };

  const onDismiss = () => {
    window.getSelection()?.removeAllRanges();
    hideToolbar();
  };

  const onBookmarkSel = () => {
    const rect = selRect;
    const t = takeSelection();
    if (!t) return;
    const point = pointFor(t.info.chapter, t.info.start);
    if (point) propsRef.current.onAddBookmark?.(point, rect);
  };

  // Clic droit dans le texte : « Ajouter un signet ici » (début du paragraphe cliqué).
  const onContextMenu = (e: ReactMouseEvent) => {
    if (!propsRef.current.onAddBookmark || !readyRef.current) return;
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    const root = r && rootOf(r.startContainer);
    if (!r || !root) return;
    e.preventDefault();
    const chapter = chapterOfRoot(root);
    const offset = offsetOf(root, r.startContainer, r.startOffset);
    const block = blockAt(chapter, offset);
    let start = offset;
    if (block) start = offsetOf(root, block, 0);
    else {
      const text = parsedRef.current!.chapters[chapter].text;
      while (start > 0 && !/\s/.test(text[start - 1])) start--;
    }
    const point = pointFor(chapter, start);
    if (!point) return;
    const s = window.getSelection();
    const copy = s && !s.isCollapsed && scrollRef.current?.contains(s.anchorNode) ? s.toString() : '';
    setCtxMenu({ x: e.clientX, y: e.clientY, point, copy });
  };

  // ── Navigation ────────────────────────────────────────────

  const scrollToRect = (rectOf: () => DOMRect | null, ratio: number) =>
    smoothTo(() => {
      const sc = scrollRef.current;
      const rect = rectOf();
      if (!sc || !rect) return null;
      return sc.scrollTop + rect.top - sc.getBoundingClientRect().top - (sc.clientHeight * ratio - rect.height / 2);
    });

  const goTo = (target: TocItem['target']) => {
    if (target.kind !== 'html' || !parsedRef.current) return;
    const ch = Math.max(0, Math.min(target.chapter, rootsRef.current.length - 1));
    const root = rootsRef.current[ch];
    let el: Element | null = null;
    if (target.fragment) {
      el = root.querySelector(`[data-fid="${CSS.escape(target.fragment)}"]`);
      if (!el) {
        // Ancre absente du chapitre annoncé : la chercher ailleurs.
        for (const r of rootsRef.current) {
          el = r.querySelector(`[data-fid="${CSS.escape(target.fragment)}"]`);
          if (el) break;
        }
      }
    }
    smoothTo(() => {
      const sc = scrollRef.current;
      if (!sc) return null;
      const top = (el ?? root).getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
      return top - (el ? 32 : 40);
    });
  };

  const followLink = (a: Element) => {
    const parsed = parsedRef.current;
    if (!parsed || a.hasAttribute('data-ext')) return;
    const path = a.getAttribute('data-link-path') ?? '';
    const frag = a.getAttribute('data-link-frag') ?? undefined;
    let chapter = path ? parsed.chapters.findIndex((c) => c.path === path) : -1;
    if (chapter < 0 && frag) chapter = rootsRef.current.findIndex((r) => r.querySelector(`[data-fid="${CSS.escape(frag)}"]`));
    if (chapter < 0) return;
    goTo({ kind: 'html', chapter, ...(frag ? { fragment: frag } : {}) });
  };

  const pulse = (els: HTMLElement[]) => {
    els.forEach((el) => {
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
    });
    setTimeout(() => els.forEach((el) => el.classList.remove('pulse')), 2600);
  };

  const spanRect = (span: TextSpan) => {
    const r = rangeFor(rootsRef.current[span.chapter], span.start, span.end);
    if (!r) return null;
    return r.getClientRects()[0] ?? r.getBoundingClientRect();
  };

  const resolveLoose = (a: HtmlAnchor): TextSpan | null => {
    const tx = texts();
    const mv = propsRef.current.movements.find(
      (m) => m.anchor.kind === 'html' && m.anchor.chapter === a.chapter && m.anchor.start === a.start && m.anchor.end === a.end,
    );
    if (mv?.startText) {
      const adj: HtmlAnchor = mv.startText.length !== a.end - a.start ? { ...a, suffix: '' } : a;
      const s = resolveAnchor(tx, adj, mv.startText);
      if (s) return s;
    }
    const t0 = tx[a.chapter];
    if (t0 != null && t0.slice(Math.max(0, a.start - a.prefix.length), a.start) === a.prefix && a.start <= t0.length)
      return { chapter: a.chapter, start: a.start, end: Math.min(a.end, t0.length) };
    if (a.prefix.length >= 8) {
      let best: TextSpan | null = null;
      let score = Infinity;
      tx.forEach((t, chapter) => {
        for (const i of allIndexes(t, a.prefix, 200)) {
          const sc = Math.abs(chapter - a.chapter) * 1e12 + Math.abs(i + a.prefix.length - a.start);
          if (sc < score) {
            score = sc;
            best = { chapter, start: i + a.prefix.length, end: i + a.prefix.length + (a.end - a.start) };
          }
        }
      });
      if (best) return best;
    }
    if (t0 != null) return { chapter: a.chapter, start: Math.min(a.start, t0.length), end: Math.min(a.end, t0.length) };
    return null;
  };

  // ── Poignée moteur ────────────────────────────────────────

  useImperativeHandle(
    ref,
    (): EngineHandle => ({
      goTo,
      goToHighlight(h: Highlight) {
        if (!parsedRef.current || h.anchor.kind !== 'html') return;
        let st = hlRef.current.get(h.id);
        if (!st) {
          syncHighlights();
          st = hlRef.current.get(h.id);
        }
        const els = st?.els ?? [];
        if (els.length) {
          scrollToRect(() => els[0].getBoundingClientRect(), 0.4).then(() => pulse(els));
          return;
        }
        const span = st?.span ?? resolveAnchor(texts(), h.anchor, h.text) ?? resolveLoose(h.anchor);
        if (span) scrollToRect(() => spanRect(span), 0.4);
        else goTo({ kind: 'html', chapter: h.anchor.chapter });
      },
      goToAnchor(anchor: Anchor) {
        if (!parsedRef.current || anchor.kind !== 'html') return;
        const span = resolveLoose(anchor);
        if (span) scrollToRect(() => spanRect(span), 0.3);
      },
      getHighlightRect(id: string) {
        let st = hlRef.current.get(id);
        if (!st && propsRef.current.highlights.some((h) => h.id === id)) {
          syncHighlights();
          st = hlRef.current.get(id);
        }
        if (!st) return null;
        const rects = st.els.map((el) => el.getBoundingClientRect()).filter((r) => r.width || r.height);
        if (!rects.length) {
          const r = st.span && spanRect(st.span);
          return r ?? null;
        }
        const left = Math.min(...rects.map((r) => r.left));
        const top = Math.min(...rects.map((r) => r.top));
        const right = Math.max(...rects.map((r) => r.right));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        return new DOMRect(left, top, right - left, bottom - top);
      },
      async search(query: string) {
        const parsed = parsedRef.current;
        clearSearchMarks();
        if (!parsed) return [];
        const q = fold(query).text.trim();
        if (!q) return [];
        const hits: SearchHit[] = [];
        for (let i = 0; i < parsed.chapters.length && hits.length < MAX_HITS; i++) {
          const text = parsed.chapters[i].text;
          const f = (foldRef.current[i] ??= fold(text));
          for (const pos of allIndexes(f.text, q, MAX_HITS - hits.length)) {
            const start = f.starts[pos];
            const end = f.ends[pos + q.length - 1];
            // Extrait d'environ 120 caractères, borné au paragraphe du résultat (pas de titre
            // ni de fin du paragraphe précédent collés devant).
            const before = 48;
            const after = Math.max(24, 120 - before - (end - start));
            const blockStart = text.lastIndexOf('\n', start - 1) + 1;
            const nl = text.indexOf('\n', end);
            const blockEnd = nl < 0 ? text.length : nl;
            const s0 = Math.max(blockStart, start - before);
            const e0 = Math.min(blockEnd, end + after);
            const lead = s0 > blockStart ? '…' : '';
            const snippet = lead + text.slice(s0, e0).replace(/\s/g, ' ') + (e0 < blockEnd ? '…' : '');
            hits.push({
              id: `${i}:${start}`,
              snippet,
              matchStart: lead.length + start - s0,
              matchLength: end - start,
              locationLabel: parsed.chapters[i].label,
              payload: { chapter: i, start, end } satisfies TextSpan,
            });
          }
          if (i % 20 === 19) await new Promise((r) => setTimeout(r, 0));
        }
        markHits(hits);
        return hits;
      },
      goToSearchHit(hit: SearchHit) {
        const doc = docRef.current;
        const p = hit.payload as TextSpan;
        if (!doc || !p || !rootsRef.current[p.chapter]) return;
        doc.querySelectorAll('span.search-hit.current').forEach((el) => el.classList.remove('current'));
        let els = Array.from(doc.querySelectorAll<HTMLElement>(`span.search-hit[data-hit="${CSS.escape(hit.id)}"]`));
        if (!els.length) {
          markHits([hit]);
          els = Array.from(doc.querySelectorAll<HTMLElement>(`span.search-hit[data-hit="${CSS.escape(hit.id)}"]`));
        }
        els.forEach((el) => el.classList.add('current'));
        currentHitRef.current = hit.id;
        scrollToRect(() => (els[0] ? els[0].getBoundingClientRect() : spanRect(p)), 0.4);
      },
      clearSearch() {
        clearSearchMarks();
      },
      bookmarkPoint() {
        return readyRef.current ? readingPoint() : null;
      },
      goToBookmark(b: Bookmark) {
        const parsed = parsedRef.current;
        if (!parsed) return;
        const span = resolveBookmark(b);
        if (!span) {
          if (b.position.kind === 'html') goTo({ kind: 'html', chapter: b.position.chapter });
          return;
        }
        const lead = () => Math.max(40, (scrollRef.current?.clientHeight ?? 600) * 0.14);
        smoothTo(() => {
          const sc = scrollRef.current;
          const rect = charRect(span.chapter, span.start);
          if (!sc || !rect) return null;
          return sc.scrollTop + rect.top - sc.getBoundingClientRect().top - lead();
        }).then(() => {
          flashBookmark(span, b);
          renderMarkers();
        });
      },
      bookmarkAtView(list: Bookmark[]) {
        const sc = scrollRef.current;
        if (!sc || !readyRef.current || !list.length) return null;
        const top = sc.getBoundingClientRect().top;
        const s = propsRef.current.settings;
        const above = s.fontSize * s.lineHeight * 2;
        const below = sc.clientHeight * 0.4;
        const ch = currentChapter();
        let best: { id: string; d: number } | null = null;
        for (const b of list) {
          const span = resolveBookmark(b);
          if (!span || Math.abs(span.chapter - ch) > 1) continue;
          const rect = charRect(span.chapter, span.start);
          if (!rect || (!rect.width && !rect.height)) continue;
          const d = rect.top - top;
          if (d >= -above && d <= below && (!best || Math.abs(d) < Math.abs(best.d))) best = { id: b.id, d };
        }
        return best?.id ?? null;
      },
      getBookmarkRect(id: string) {
        const el = docRef.current?.querySelector(`[data-bm-id="${CSS.escape(id)}"]`);
        return el ? el.getBoundingClientRect() : null;
      },
    }),
    [],
  );

  // ── Clics ─────────────────────────────────────────────────

  const onClick = (e: ReactMouseEvent) => {
    const t = e.target as Element;
    const bm = t.closest('[data-bm-id]');
    if (bm) {
      propsRef.current.onBookmarkClick?.(bm.getAttribute('data-bm-id')!, bm.getBoundingClientRect());
      return;
    }
    const mv = t.closest('[data-mv-id]');
    if (mv) {
      propsRef.current.onMovementClick(mv.getAttribute('data-mv-id')!);
      return;
    }
    const s = window.getSelection();
    if (s && !s.isCollapsed && s.rangeCount && scrollRef.current?.contains(s.getRangeAt(0).commonAncestorContainer)) return;
    const link = t.closest('a.html-link');
    if (link && !link.hasAttribute('data-ext')) {
      e.preventDefault();
      followLink(link);
      return;
    }
    const hl = t.closest('[data-hl-id]') as HTMLElement | null;
    if (hl) {
      propsRef.current.onHighlightClick(hl.getAttribute('data-hl-id')!, hl.getBoundingClientRect());
      return;
    }
    propsRef.current.onBackgroundClick();
  };

  const docStyle = {
    fontFamily: settings.fontFamily === 'sans' ? 'var(--font-ui)' : 'var(--font-read)',
    lineHeight: settings.lineHeight,
    '--html-fs': `${settings.fontSize}px`,
    '--html-measure': `${settings.measure}ch`,
  } as CSSProperties;

  return (
    <div className="html-reader">
      <div className="html-scroll" ref={scrollRef} onClick={onClick} onContextMenu={onContextMenu} tabIndex={-1}>
        <div className={`html-doc html-fmt-${book.format}${revealed ? ' is-revealed' : ''}`} ref={docRef} style={docStyle} />
      </div>
      {selRect && (
        <SelectionToolbar
          rect={selRect}
          onPick={onPick}
          onMovement={onMovement}
          onCopy={onCopy}
          onDismiss={onDismiss}
          onCite={props.onCite ? onCite : undefined}
          onBookmark={props.onAddBookmark ? onBookmarkSel : undefined}
        />
      )}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          label="Menu du texte"
          onClose={() => setCtxMenu(null)}
          entries={[
            {
              label: 'Ajouter un signet ici',
              icon: <BookmarkPlus size={14} />,
              onClick: () => propsRef.current.onAddBookmark?.(ctxMenu.point, new DOMRect(ctxMenu.x, ctxMenu.y, 1, 1)),
            },
            ...(ctxMenu.copy
              ? [{ label: 'Copier', icon: <Copy size={14} />, onClick: () => void navigator.clipboard?.writeText(ctxMenu.copy).catch(() => undefined) }]
              : []),
          ]}
        />
      )}
    </div>
  );
});
