// Moteur de lecture PDF (pdf.js 4.10) : défilement continu, rendu paresseux, surlignages normalisés,
// mouvements en marge, recherche, zoom. Aucun état global : plusieurs instances peuvent coexister.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { SelectionToolbar } from '../../../components/SelectionToolbar';
import type { CategoryId, NormRect, PdfAnchor, ReaderPosition, TocItem } from '../../../lib/types';
import type { EngineHandle, EngineProps, SearchHit } from '../engine';
import { PdfPage, type PageHl, type PageMv } from './PdfPage';
import { describeError, loadToc, openPdf, type PDFDocumentProxy } from './pdfjs';
import { readSelection, type PdfSelection } from './selection';
import { buildIndex, collectDomText, findAll, makeSnippet, mergeLineRects, normalizeQuery, rawSpanRects, spanOf, toNorm, type TextIndex } from './textindex';
import './pdf-reader.css';

const GUTTER = 36; // marge latérale (repères de mouvement)
const GAP = 14; // espace entre les pages
const PAD_TOP = 16;
const PAD_BOTTOM = 96; // dégagement sous la dernière page (pilule de zoom)
const READ_LINE = 0.25; // ligne de lecture : fraction de la hauteur de la fenêtre
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const EMPTY_HL: PageHl[] = [];
const EMPTY_MV: PageMv[] = [];

type Zoom = 'fit' | number;
interface Size {
  w: number;
  h: number;
}
interface Pos {
  page: number;
  offset: number;
}
interface SearchPayload {
  page: number;
  nth: number;
  q: string;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const PdfReader = forwardRef<EngineHandle, EngineProps>(function PdfReader(props, ref) {
  const P = useRef(props);
  P.current = props;

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[] | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [viewW, setViewW] = useState(0);
  const [near, setNear] = useState<Set<number>>(() => new Set());
  const [curPage, setCurPage] = useState(1);
  const [selRect, setSelRect] = useState<DOMRect | null>(null);
  const [marks, setMarks] = useState<{ page: number; rects: NormRect[] } | null>(null);
  const [pulse, setPulse] = useState<{ id: string; k: number } | null>(null);

  const selRef = useRef<PdfSelection | null>(null);
  const posRef = useRef<Pos>({ page: 1, offset: 0 });
  const hRatioRef = useRef(0.5);
  const restoredRef = useRef(false);
  const suppressRef = useRef(false);
  const readyRef = useRef({ fired: false, page: 1 });
  const rendered = useRef(new Set<number>());
  const textCache = useRef(new Map<number, Promise<TextIndex>>());
  const markToken = useRef(0);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  docRef.current = doc;

  // ── Chargement du document ──
  useEffect(() => {
    let alive = true;
    const task = openPdf(props.data);
    restoredRef.current = false;
    readyRef.current = { fired: false, page: 1 };
    rendered.current = new Set();
    textCache.current = new Map();
    setDoc(null);
    setSizes(null);
    setMarks(null);
    (async () => {
      const pdf = await task.promise;
      if (!alive) return;
      // Dimensions de toutes les pages (échelle 1) pour une mise en page exacte sans rendu.
      const out: Size[] = new Array(pdf.numPages);
      for (let i = 0; i < pdf.numPages; i += 40) {
        await Promise.all(
          Array.from({ length: Math.min(40, pdf.numPages - i) }, async (_, k) => {
            const p = await pdf.getPage(i + k + 1);
            const v = p.getViewport({ scale: 1 });
            out[i + k] = { w: v.width, h: v.height };
          }),
        );
        if (!alive) return;
      }
      const toc: TocItem[] = await loadToc(pdf).catch(() => []);
      if (!alive) return;
      P.current.onToc(toc);
      setSizes(out);
      setDoc(pdf);
    })().catch((e) => {
      if (alive) P.current.onError(describeError(e));
    });
    return () => {
      alive = false;
      task.destroy().catch(() => undefined);
    };
  }, [props.book.id, props.data]);

  // ── Géométrie ──
  const fitScale = useMemo(() => {
    if (!sizes || viewW <= 0) return null;
    const ws = sizes.map((s) => s.w).sort((a, b) => a - b);
    const typical = ws[Math.floor(ws.length / 2)] || 612;
    return clamp((viewW - 2 * GUTTER) / typical, MIN_ZOOM, 4);
  }, [sizes, viewW]);
  const lastScale = useRef(1);
  const scale = zoom === 'fit' ? fitScale ?? lastScale.current : zoom;
  lastScale.current = scale;

  const geom = useMemo(() => {
    if (!sizes) return null;
    const ws = sizes.map((s) => Math.floor(s.w * scale));
    const hs = sizes.map((s) => Math.floor(s.h * scale));
    const tops: number[] = [];
    let y = PAD_TOP;
    for (const h of hs) {
      tops.push(y);
      y += h + GAP;
    }
    return { ws, hs, tops };
  }, [sizes, scale]);
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const pageAt = useCallback((y: number): number => {
    const g = geomRef.current;
    if (!g) return 1;
    let lo = 0;
    let hi = g.tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (g.tops[mid] + g.hs[mid] > y) hi = mid;
      else lo = mid + 1;
    }
    return lo + 1;
  }, []);

  const scrollToPos = useCallback((p: Pos) => {
    const el = scrollRef.current;
    const g = geomRef.current;
    if (!el || !g) return;
    const i = clamp(p.page, 1, g.tops.length) - 1;
    el.scrollTop = Math.max(0, g.tops[i] + p.offset * g.hs[i] - READ_LINE * el.clientHeight);
  }, []);

  const scrollToY = useCallback((page: number, ny: number, lead: number) => {
    const el = scrollRef.current;
    const g = geomRef.current;
    if (!el || !g) return;
    const i = clamp(page, 1, g.tops.length) - 1;
    el.scrollTop = Math.max(0, g.tops[i] + ny * g.hs[i] - lead);
  }, []);

  // ── Observateur de taille (et de visibilité : display:none quand l'onglet Carte est actif) ──
  const visibleRef = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const visible = w > 0 && h > 0;
      if (visible && !visibleRef.current) {
        // Redevenu visible : le navigateur a perdu le défilement ; on le reprend.
        if (restoredRef.current) {
          suppressRef.current = true;
          const again = () => {
            scrollToPos(posRef.current);
            el.scrollLeft = hRatioRef.current * el.scrollWidth - el.clientWidth / 2;
          };
          requestAnimationFrame(again);
          setTimeout(again, 120);
          setTimeout(() => (suppressRef.current = false), 450);
        }
      }
      visibleRef.current = visible;
      if (visible) setViewW((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollToPos]);

  // ── Restauration de la position initiale / conservation de la position au zoom ──
  const prevScale = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !geom || !doc || viewW <= 0) return;
    if (!restoredRef.current) {
      restoredRef.current = true;
      suppressRef.current = true;
      const ip = props.initialPosition;
      const start: Pos = ip && ip.kind === 'pdf' ? { page: ip.page, offset: ip.offset } : { page: 1, offset: 0 };
      if (start.page > 1 || start.offset > 0) scrollToPos(start);
      posRef.current = start;
      readyRef.current.page = clamp(start.page, 1, doc.numPages);
      setCurPage(readyRef.current.page);
      prevScale.current = scale;
      const doc0 = doc;
      setTimeout(() => {
        if (docRef.current !== doc0) return;
        suppressRef.current = false;
        emitPosition();
      }, 400);
      setTimeout(() => {
        if (docRef.current === doc0) fireReady();
      }, 2500);
      if (rendered.current.has(readyRef.current.page)) fireReady();
      return;
    }
    if (prevScale.current !== null && prevScale.current !== scale) {
      scrollToPos(posRef.current);
      el.scrollLeft = Math.max(0, hRatioRef.current * el.scrollWidth - el.clientWidth / 2);
    }
    prevScale.current = scale;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geom, doc, viewW]);

  function fireReady() {
    if (readyRef.current.fired) return;
    readyRef.current.fired = true;
    P.current.onReady();
  }

  const onRendered = useCallback((n: number) => {
    rendered.current.add(n);
    if (restoredRef.current && n === readyRef.current.page) fireReady();
  }, []);

  // ── Rendu paresseux : pages proches du viewport ──
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !doc) return;
    const pages = Array.from(root.querySelectorAll<HTMLElement>('.pdf-page'));
    const num = (t: Element) => Number((t as HTMLElement).dataset.page);
    let queued = false;
    const add = new Set<number>();
    const del = new Set<number>();
    const flush = () => {
      queued = false;
      // Instantané des changements : l'updater de setState doit rester pur (rejoué en mode strict).
      const toAdd = [...add];
      const toDel = [...del];
      add.clear();
      del.clear();
      setNear((prev) => {
        const next = new Set(prev);
        toAdd.forEach((n) => next.add(n));
        toDel.forEach((n) => next.delete(n));
        if (next.size === prev.size && [...next].every((n) => prev.has(n))) return prev;
        return next;
      });
    };
    const schedule = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(flush);
      }
    };
    const enter = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) { add.add(num(e.target)); del.delete(num(e.target)); }
        schedule();
      },
      { root, rootMargin: '90% 0px 90% 0px' },
    );
    const leave = new IntersectionObserver(
      (es) => {
        for (const e of es) if (!e.isIntersecting) { del.add(num(e.target)); add.delete(num(e.target)); }
        schedule();
      },
      { root, rootMargin: '170% 0px 170% 0px' },
    );
    pages.forEach((p) => {
      enter.observe(p);
      leave.observe(p);
    });
    return () => {
      enter.disconnect();
      leave.disconnect();
    };
  }, [doc]);

  // ── Position, progression, page courante ──
  const lastEmit = useRef(0);
  const emitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitPosition = useCallback(() => {
    emitTimer.current = null;
    lastEmit.current = Date.now();
    const d = docRef.current;
    const el = scrollRef.current;
    if (!d || !el || !el.clientHeight) return;
    const { page, offset } = posRef.current;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2 && el.scrollTop > 0;
    const progress = atEnd ? 1 : clamp((page - 1 + offset) / d.numPages, 0, 1);
    const pos: ReaderPosition = { kind: 'pdf', page, offset: Math.round(offset * 10000) / 10000 };
    P.current.onPosition(pos, progress, `p. ${page}`);
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    const g = geomRef.current;
    if (!el || !g || !el.clientHeight) return;
    const line = el.scrollTop + READ_LINE * el.clientHeight;
    const page = pageAt(line);
    const offset = clamp((line - g.tops[page - 1]) / g.hs[page - 1], 0, 1);
    hRatioRef.current = el.scrollWidth ? (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth : 0.5;
    if (suppressRef.current || !restoredRef.current) return;
    posRef.current = { page, offset };
    setCurPage((p) => (p === page ? p : page));
    const since = Date.now() - lastEmit.current;
    if (since >= 250) emitPosition();
    else if (!emitTimer.current) emitTimer.current = setTimeout(emitPosition, 250 - since);
    if (selRef.current) refreshSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageAt, emitPosition]);

  useEffect(
    () => () => {
      if (emitTimer.current) {
        clearTimeout(emitTimer.current);
        if (restoredRef.current) emitPosition();
      }
    },
    [emitPosition],
  );

  // ── Zoom ──
  const applyZoom = useCallback((z: Zoom) => setZoom(z === 'fit' ? 'fit' : clamp(z, MIN_ZOOM, MAX_ZOOM)), []);
  const zoomIn = useCallback(() => {
    const cur = scaleRef.current;
    applyZoom(ZOOM_STEPS.find((s) => s > cur * 1.001) ?? MAX_ZOOM);
  }, [applyZoom]);
  const zoomOut = useCallback(() => {
    const cur = scaleRef.current;
    applyZoom([...ZOOM_STEPS].reverse().find((s) => s < cur * 0.999) ?? MIN_ZOOM);
  }, [applyZoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const root = rootRef.current;
      if (!root || !root.contains(document.activeElement)) return; // seulement si cette instance a le focus
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        applyZoom('fit');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomIn, zoomOut, applyZoom]);

  // Pincement du pavé tactile (ctrl + molette)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      applyZoom(scaleRef.current * Math.exp(-e.deltaY * 0.01));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  // ── Surlignages et mouvements par page ──
  // Listes par page STABLES : une page dont les surlignages n'ont pas changé garde le même tableau
  // (PdfPage est mémoïsée) ; créer un surlignage ne re-rend que sa page, pas toutes les pages annotées.
  const prevHlByPage = useRef(new Map<number, PageHl[]>());
  const hlByPage = useMemo(() => {
    const m = new Map<number, PageHl[]>();
    for (const h of props.highlights) {
      if (h.anchor.kind !== 'pdf') continue;
      const list = m.get(h.anchor.page) ?? [];
      list.push({ id: h.id, category: h.category, rects: h.anchor.rects });
      m.set(h.anchor.page, list);
    }
    const prev = prevHlByPage.current;
    m.forEach((list, page) => {
      const old = prev.get(page);
      if (old && old.length === list.length && old.every((o, i) => o.id === list[i].id && o.category === list[i].category && o.rects === list[i].rects)) m.set(page, old);
    });
    prevHlByPage.current = m;
    return m;
  }, [props.highlights]);
  const hlRef = useRef(hlByPage);
  hlRef.current = hlByPage;

  /** Page de chaque surlignage : seule la page concernée reçoit activeId / pulse (PdfPage reste mémoïsée). */
  const pageOfHl = useMemo(() => {
    const m = new Map<string, number>();
    hlByPage.forEach((list, page) => list.forEach((h) => m.set(h.id, page)));
    return m;
  }, [hlByPage]);
  const onMovementClick = useCallback((id: string) => P.current.onMovementClick(id), []);

  const mvByPage = useMemo(() => {
    const m = new Map<number, PageMv[]>();
    for (const mv of props.movements) {
      if (mv.anchor.kind !== 'pdf' || !mv.anchor.rects.length) continue;
      const list = m.get(mv.anchor.page) ?? [];
      list.push({ id: mv.id, title: mv.title, y: mv.anchor.rects[0].y });
      m.set(mv.anchor.page, list);
    }
    return m;
  }, [props.movements]);

  // ── Sélection ──
  const dragging = useRef(false);
  const selTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function refreshSelection() {
    const root = rootRef.current;
    const s = root ? readSelection(root) : null;
    selRef.current = s;
    setSelRect((prev) => {
      if (!s) return prev ? null : prev;
      if (prev && prev.x === s.rect.x && prev.y === s.rect.y && prev.width === s.rect.width && prev.height === s.rect.height) return prev;
      return s.rect;
    });
  }
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // « selecting » (étend .endOfContent, comme le lecteur de pdf.js) : seulement sur le calque
    // où commence la sélection. Le poser sur tous les calques recalculait le style de milliers
    // de spans à chaque clic.
    let selecting: Element | null = null;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      dragging.current = true;
      selecting = (e.target as Element | null)?.closest?.('.pdf-page')?.querySelector('.textLayer') ?? null;
      selecting?.classList.add('selecting');
      selRef.current = null;
      setSelRect((prev) => (prev ? null : prev));
    };
    const onUp = () => {
      selecting?.classList.remove('selecting');
      selecting = null;
      if (!dragging.current) return;
      dragging.current = false;
      setTimeout(refreshSelection, 0);
    };
    const onSelChange = () => {
      if (dragging.current) return;
      if (selTimer.current) clearTimeout(selTimer.current);
      selTimer.current = setTimeout(refreshSelection, 120);
    };
    root.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    document.addEventListener('selectionchange', onSelChange);
    return () => {
      root.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      document.removeEventListener('selectionchange', onSelChange);
      if (selTimer.current) clearTimeout(selTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    selRef.current = null;
    setSelRect(null);
  };

  const onPick = (category: CategoryId | null, withNote: boolean) => {
    const s = (rootRef.current && readSelection(rootRef.current)) || selRef.current;
    if (!s) return;
    const p = P.current;
    clearSelection();
    p.onCreateHighlight(
      {
        anchor: s.anchor,
        text: s.text,
        locationLabel: `p. ${s.page}`,
        category,
        printedPage: String(s.page + p.book.edition.pageOffset),
      },
      withNote,
    );
  };
  const onCite = () => {
    const s = (rootRef.current && readSelection(rootRef.current)) || selRef.current;
    if (!s) return;
    const p = P.current;
    clearSelection();
    p.onCite?.({ anchor: s.anchor, text: s.text, locationLabel: `p. ${s.page}`, category: null, printedPage: String(s.page + p.book.edition.pageOffset) });
  };
  const onMovementPick = () => {
    const s = (rootRef.current && readSelection(rootRef.current)) || selRef.current;
    if (!s) return;
    clearSelection();
    P.current.onCreateMovement({ anchor: s.anchor, text: s.text.slice(0, 80), locationLabel: `p. ${s.page}` });
  };
  const onCopy = () => {
    const s = selRef.current;
    if (s) navigator.clipboard?.writeText(s.text).catch(() => undefined);
    clearSelection();
  };

  // ── Clic sur un surlignage / arrière-plan ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hit = (x: number, y: number, target: EventTarget | null) => {
      const pageEl = ((target as Element | null)?.closest?.('.pdf-page') ?? null) as HTMLElement | null;
      if (!pageEl) return null;
      const pr = pageEl.getBoundingClientRect();
      const nx = (x - pr.left) / pr.width;
      const ny = (y - pr.top) / pr.height;
      const list = hlRef.current.get(Number(pageEl.dataset.page)) ?? [];
      for (let i = list.length - 1; i >= 0; i--) {
        for (const r of list[i].rects) {
          if (nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h) {
            return { id: list[i].id, rect: new DOMRect(pr.left + r.x * pr.width, pr.top + r.y * pr.height, r.w * pr.width, r.h * pr.height) };
          }
        }
      }
      return null;
    };
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element).closest('.pdf-mv')) return;
      const s = window.getSelection();
      if (s && !s.isCollapsed && el.contains(s.anchorNode)) return; // fin d'une sélection, pas un clic
      const h = hit(e.clientX, e.clientY, e.target);
      if (h) P.current.onHighlightClick(h.id, h.rect);
      else P.current.onBackgroundClick();
    };
    // Curseur « main » au-dessus d'un surlignage : la classe est posée sur la seule page
    // survolée et seulement quand l'état change (la poser sur le conteneur invalidait le style
    // de tous les calques de texte à chaque bascule). Rien pendant un glissé de sélection.
    let moving = false;
    let over: HTMLElement | null = null;
    const setOver = (pageEl: HTMLElement | null) => {
      if (pageEl === over) return;
      over?.classList.remove('is-over-hl');
      pageEl?.classList.add('is-over-hl');
      over = pageEl;
    };
    const onMove = (e: MouseEvent) => {
      if (e.buttons & 1) return;
      if (moving) return;
      moving = true;
      requestAnimationFrame(() => {
        moving = false;
        const pageEl = ((e.target as Element | null)?.closest?.('.pdf-page') ?? null) as HTMLElement | null;
        const any = pageEl && (hlRef.current.get(Number(pageEl.dataset.page))?.length ?? 0) > 0;
        setOver(any && hit(e.clientX, e.clientY, e.target) ? pageEl : null);
      });
    };
    el.addEventListener('click', onClick);
    el.addEventListener('mousemove', onMove);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('mousemove', onMove);
    };
  }, []);

  // ── Recherche ──
  const pageIndex = useCallback((n: number): Promise<TextIndex> => {
    const cache = textCache.current;
    let p = cache.get(n);
    if (!p) {
      const d = docRef.current;
      p = (async () => {
        if (!d) return buildIndex('');
        const page = await d.getPage(n);
        const content = await page.getTextContent({ disableNormalization: true });
        let raw = '';
        for (const it of content.items) {
          if (!('str' in it)) continue;
          raw += it.str;
          if (it.hasEOL) raw += '\n';
        }
        return buildIndex(raw);
      })();
      cache.set(n, p);
    }
    return p;
  }, []);

  const pageEl = (n: number) => scrollRef.current?.querySelector<HTMLElement>(`.pdf-page[data-page="${n}"]`) ?? null;

  const markHit = useCallback(
    async (payload: SearchPayload) => {
      const token = ++markToken.current;
      const g = geomRef.current;
      const el = scrollRef.current;
      if (!g || !el) return;
      scrollToY(payload.page, 0, 8);
      let layer: Element | null = null;
      for (let i = 0; i < 80 && token === markToken.current; i++) {
        layer = pageEl(payload.page)?.querySelector('.textLayer[data-ready="1"]') ?? null;
        if (layer) break;
        await sleep(50);
      }
      if (token !== markToken.current || !layer) return;
      const { raw, segs } = collectDomText(layer);
      const idx = buildIndex(raw);
      const starts = findAll(idx, payload.q);
      const ns = starts[payload.nth] ?? starts[0];
      if (ns === undefined) return;
      const sp = spanOf(idx, ns, payload.q.length);
      const px = mergeLineRects(rawSpanRects(segs, sp.rawStart, sp.rawEnd));
      const pe = pageEl(payload.page);
      if (!pe || !px.length) return;
      const pr = pe.getBoundingClientRect();
      const rects = px.map((r) => toNorm(r, pr));
      setMarks({ page: payload.page, rects });
      scrollToY(payload.page, rects[0].y, el.clientHeight * 0.35);
    },
    [scrollToY],
  );

  // ── EngineHandle ──
  useImperativeHandle(
    ref,
    (): EngineHandle => ({
      goTo(target) {
        if (target.kind !== 'pdf') return;
        scrollToY(target.page, 0, 6);
      },
      goToHighlight(h) {
        if (h.anchor.kind !== 'pdf') return;
        const a = h.anchor as PdfAnchor;
        scrollToY(a.page, a.rects[0]?.y ?? 0, (scrollRef.current?.clientHeight ?? 600) * 0.3);
        setPulse((p) => ({ id: h.id, k: (p?.k ?? 0) + 1 }));
        setTimeout(() => setPulse((p) => (p && p.id === h.id ? null : p)), 2800);
      },
      goToAnchor(anchor) {
        if (anchor.kind !== 'pdf') return;
        scrollToY(anchor.page, anchor.rects[0]?.y ?? 0, (scrollRef.current?.clientHeight ?? 600) * 0.3);
      },
      getHighlightRect(id) {
        const e = scrollRef.current?.querySelector(`.hl[data-hl-id="${CSS.escape(id)}"]`);
        return e ? e.getBoundingClientRect() : null;
      },
      async search(query) {
        const q = normalizeQuery(query);
        const d = docRef.current;
        if (!q || !d) return [];
        const hits: SearchHit[] = [];
        for (let i = 1; i <= d.numPages && hits.length < 500; i += 8) {
          const batch = await Promise.all(Array.from({ length: Math.min(8, d.numPages - i + 1) }, (_, k) => pageIndex(i + k)));
          batch.forEach((idx, k) => {
            const page = i + k;
            findAll(idx, q).forEach((ns, nth) => {
              const sp = spanOf(idx, ns, q.length);
              const sn = makeSnippet(idx.clean, sp.cleanStart, sp.cleanEnd);
              hits.push({
                id: `${page}:${nth}`,
                snippet: sn.snippet,
                matchStart: sn.matchStart,
                matchLength: sn.matchLength,
                locationLabel: `p. ${page}`,
                payload: { page, nth, q } satisfies SearchPayload,
              });
            });
          });
        }
        return hits;
      },
      goToSearchHit(hit) {
        const p = hit.payload as SearchPayload | undefined;
        if (!p || typeof p.page !== 'number') return;
        void markHit(p);
      },
      clearSearch() {
        markToken.current++;
        setMarks(null);
      },
    }),
    [markHit, pageIndex, scrollToY],
  );

  // ── Rendu ──
  const numPages = doc?.numPages ?? 0;
  const pct = Math.round(scale * 100);
  const activePage = props.activeHighlightId ? pageOfHl.get(props.activeHighlightId) ?? 0 : 0;

  return (
    <div className="pdf-reader" ref={rootRef} tabIndex={-1}>
      <div className="pdf-scroll" ref={scrollRef} onScroll={onScroll}>
        {doc && geom && (
          <div className="pdf-pages" style={{ padding: `${PAD_TOP}px ${GUTTER}px ${PAD_BOTTOM - GAP}px`, gap: GAP }}>
            {geom.ws.map((w, i) => (
              <PdfPage
                key={i}
                n={i + 1}
                doc={doc}
                w={w}
                h={geom.hs[i]}
                scale={scale}
                near={near.has(i + 1)}
                hls={hlByPage.get(i + 1) ?? EMPTY_HL}
                marks={marks && marks.page === i + 1 ? marks.rects : null}
                movements={mvByPage.get(i + 1) ?? EMPTY_MV}
                activeId={activePage === i + 1 ? props.activeHighlightId : null}
                pulse={pulse && pageOfHl.get(pulse.id) === i + 1 ? pulse : null}
                onRendered={onRendered}
                onMovement={onMovementClick}
              />
            ))}
          </div>
        )}
      </div>

      {doc && (
        <div className="pdf-zoombar" role="toolbar" aria-label="Zoom et page">
          <button className="icon-btn sm" onClick={zoomOut} title="Zoom arrière (⌘−)" aria-label="Zoom arrière">
            <Minus size={14} />
          </button>
          <span className="pdf-zoom-val" data-testid="pdf-zoom">
            {pct} %
          </span>
          <button className="icon-btn sm" onClick={zoomIn} title="Zoom avant (⌘+)" aria-label="Zoom avant">
            <Plus size={14} />
          </button>
          <span className="pdf-zoom-sep" />
          <span className="pdf-zoom-page" data-testid="pdf-page">
            p. {curPage} / {numPages}
          </span>
          <span className="pdf-zoom-sep" />
          <button className={`btn btn-ghost btn-sm pdf-fit ${zoom === 'fit' ? 'is-on' : ''}`} onClick={() => applyZoom('fit')} title="Ajuster à la largeur (⌘0)">
            <Maximize2 size={13} /> Ajuster
          </button>
        </div>
      )}

      {selRect && <SelectionToolbar rect={selRect} onPick={onPick} onMovement={onMovementPick} onCopy={onCopy} onDismiss={clearSelection} onCite={props.onCite ? onCite : undefined} />}
    </div>
  );
});
