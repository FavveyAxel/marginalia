// Moteur de lecture des images (photo ou scan d'une page) : image nette avec zoom, texte reconnu
// localement (OCR) posé en calque transparent sélectionnable, surlignages en rectangles normalisés
// (PdfAnchor, page 1), annotation par zone quand l'image n'a pas de texte, recherche, mouvements.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { Maximize2, Milestone, Minus, Plus, RotateCcw, ScanText, SquareDashed, X } from 'lucide-react';
import { SelectionToolbar } from '../../../components/SelectionToolbar';
import { Skeleton } from '../../../components/ui';
import { host } from '../../../lib/platform';
import type { CategoryId, NormRect, PdfAnchor, ReaderPosition } from '../../../lib/types';
import { hlClass } from '../../../lib/categories';
import type { EngineHandle, EngineProps, SearchHit } from '../engine';
import { findAll, makeSnippet, normalizeQuery, spanOf } from '../pdf/textindex';
import { displayableBlob, ImageDecodeError, ORIENT } from './decode';
import { averageConfidence, editLine, loadOcr, runningOcr, saveOcr, startOcr, type OcrData, type OcrJob, type OcrProgress, type OcrWord } from './ocr';
import { useStore } from '../../../lib/store';
import { buildTextLayer, readImageSelection, rectsForWords, wordAtRaw, wordModel, wordsInRect, type ImageSelection } from './textlayer';
import './image-reader.css';
import { fmtKeys } from '../../../lib/keys';

const GUTTER = 36;
const PAD_TOP = 20;
const PAD_BOTTOM = 96;
const READ_LINE = 0.25;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 6;
const ZOOM_STEPS = [0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6];
const DISPLAY_FILE = 'display.jpg';
const ZONE_TEXT = '[Zone sans texte]';
/** Libellé de lieu des extraits : passage de texte reconnu, ou zone tracée (dessinée en cadre). */
const LABEL_TEXT = 'Image';
const LABEL_ZONE = 'Zone de l’image';

type Zoom = 'fit' | number;
type OcrPhase = 'idle' | 'running' | 'done' | 'error';
interface SearchPayload {
  a: number;
  b: number;
  aOff: number;
  bOff: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const pct = (v: number) => `${Math.round(v * 1000000) / 10000}%`;

export const ImageReader = forwardRef<EngineHandle, EngineProps>(function ImageReader(props, ref) {
  const P = useRef(props);
  P.current = props;
  const bookId = props.book.id;

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const textHost = useRef<HTMLDivElement>(null);

  const [url, setUrl] = useState<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  /** Image affichable (Blob) : redécodée seulement pour une nouvelle reconnaissance (pas de bitmap de 50 Mo gardé en mémoire). */
  const blobRef = useRef<Blob | null>(null);
  const [ocr, setOcr] = useState<OcrData | null>(null);
  const [phase, setPhase] = useState<OcrPhase>('idle');
  const [progress, setProgress] = useState<OcrProgress>({ value: 0, label: '' });
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [view, setView] = useState({ w: 0, h: 0 });
  const [selRect, setSelRect] = useState<DOMRect | null>(null);
  const [zoneMode, setZoneMode] = useState(false);
  const [draft, setDraft] = useState<NormRect | null>(null);
  const [zone, setZone] = useState<NormRect | null>(null);
  const [panel, setPanel] = useState(false);
  const [marks, setMarks] = useState<NormRect[] | null>(null);
  const [pulse, setPulse] = useState<{ id: string; k: number } | null>(null);
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [confirmRerun, setConfirmRerun] = useState(false);

  const selRef = useRef<ImageSelection | null>(null);
  const readyRef = useRef(false);
  const restoredRef = useRef(false);
  const posRef = useRef(0);

  const model = useMemo(() => wordModel(ocr), [ocr]);
  const modelRef = useRef(model);
  modelRef.current = model;

  // ── Chargement de l'image et du texte reconnu (cache) ──
  // La reconnaissance est un travail partagé (ocr.ts) : ce volet s'y abonne, et s'en désabonne
  // en se fermant sans l'interrompre.
  const jobUnsub = useRef<(() => void) | null>(null);
  const follow = useCallback(function follow(job: OcrJob) {
    jobUnsub.current?.();
    let alive = true;
    let raf = 0;
    let latest: OcrProgress | null = null;
    setPhase('running');
    setOcrError(null);
    const unsub = job.subscribe((p) => {
      latest = p;
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (alive && latest) setProgress(latest);
        });
    });
    jobUnsub.current = () => {
      alive = false;
      cancelAnimationFrame(raf);
      unsub();
    };
    job.promise.then(
      (data) => {
        if (!alive) return;
        jobUnsub.current?.();
        jobUnsub.current = null;
        setOcr(data);
        setPhase('done');
      },
      (e) => {
        if (!alive) return;
        jobUnsub.current?.();
        jobUnsub.current = null;
        if (e?.name === 'AbortError') {
          // Relancée depuis l'autre volet : suivre le nouveau travail.
          const next = runningOcr(job.bookId);
          if (next && next !== job) follow(next);
          else setPhase('idle');
          return;
        }
        console.warn('[image] OCR', e);
        setOcrError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      },
    );
  }, []);
  const runOcr = useCallback(
    (bmp: ImageBitmap, restart = false) => {
      const keep = () => useStore.getState().books.some((b) => b.id === bookId);
      follow(startOcr(bookId, bmp, keep, restart));
    },
    [bookId, follow],
  );
  useEffect(() => () => jobUnsub.current?.(), []);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    readyRef.current = false;
    restoredRef.current = false;
    setUrl(null);
    setNat(null);
    setOcr(null);
    setPhase('idle');
    (async () => {
      const book = P.current.book;
      const name = book.originalName || book.fileName;
      let blob: Blob | null = null;
      // Une image déjà convertie (HEIC, TIFF) est relue depuis la bibliothèque.
      if (/\.(heic|heif|tif|tiff)$/i.test(name)) {
        const cached = await host.readFile(book.id, DISPLAY_FILE).catch(() => null);
        if (cached) blob = new Blob([cached], { type: 'image/jpeg' });
      }
      if (!blob) {
        const r = await displayableBlob(props.data, name);
        blob = r.blob;
        if (r.converted) host.storeFile(book.id, DISPLAY_FILE, await blob.arrayBuffer()).catch(() => undefined);
      }
      const bmp = await createImageBitmap(blob, ORIENT);
      if (!alive) {
        bmp.close();
        return;
      }
      blobRef.current = blob;
      objectUrl = URL.createObjectURL(blob);
      setNat({ w: bmp.width, h: bmp.height });
      setUrl(objectUrl);
      P.current.onToc([]);
      const job = runningOcr(book.id);
      const cached = job ? null : await loadOcr(book.id);
      if (!alive) {
        bmp.close();
        return;
      }
      if (job) follow(job);
      else if (cached) {
        setOcr(cached);
        setPhase('done');
      } else runOcr(bmp); // l'image est copiée dans le travail de reconnaissance dès son lancement
      bmp.close();
    })().catch((e) => {
      if (!alive) return;
      P.current.onError(e instanceof ImageDecodeError ? e.message : `Impossible d’ouvrir cette image${e?.message ? ` (${e.message})` : ''}.`);
    });
    return () => {
      alive = false;
      jobUnsub.current?.();
      jobUnsub.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, props.data]);


  // ── Géométrie ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) setView((v) => (Math.abs(v.w - el.clientWidth) < 1 && Math.abs(v.h - el.clientHeight) < 1 ? v : { w: el.clientWidth, h: el.clientHeight }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitScale = nat && view.w > 0 ? clamp((view.w - 2 * GUTTER) / nat.w, MIN_ZOOM, 2) : null;
  const lastScale = useRef(1);
  const scale = zoom === 'fit' ? fitScale ?? lastScale.current : zoom;
  lastScale.current = scale;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const dispW = nat ? Math.round(nat.w * scale) : 0;
  const dispH = nat ? Math.round(nat.h * scale) : 0;

  // Position conservée au zoom (fraction verticale et horizontale)
  const hRatio = useRef(0.5);
  const prevScale = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !nat || !url || view.w <= 0) return;
    if (!restoredRef.current) {
      restoredRef.current = true;
      const ip = P.current.initialPosition;
      const off = ip && ip.kind === 'pdf' ? clamp(ip.offset, 0, 1) : 0;
      posRef.current = off;
      if (off > 0) el.scrollTop = Math.max(0, PAD_TOP + off * dispH - READ_LINE * el.clientHeight);
      prevScale.current = scale;
      return;
    }
    if (prevScale.current !== null && prevScale.current !== scale) {
      el.scrollTop = Math.max(0, PAD_TOP + posRef.current * dispH - READ_LINE * el.clientHeight);
      el.scrollLeft = Math.max(0, hRatio.current * el.scrollWidth - el.clientWidth / 2);
    }
    prevScale.current = scale;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispW, dispH, url, view.w]);

  const emitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emit = useCallback(() => {
    emitTimer.current = null;
    const el = scrollRef.current;
    if (!el || !readyRef.current) return;
    const max = el.scrollHeight - el.clientHeight;
    const progress = max <= 2 ? 1 : clamp(el.scrollTop / max, 0, 1);
    const pos: ReaderPosition = { kind: 'pdf', page: 1, offset: Math.round(posRef.current * 10000) / 10000 };
    P.current.onPosition(pos, progress, LABEL_TEXT);
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !dispH || !restoredRef.current) return;
    posRef.current = clamp((el.scrollTop + READ_LINE * el.clientHeight - PAD_TOP) / dispH, 0, 1);
    hRatio.current = el.scrollWidth ? (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth : 0.5;
    if (!emitTimer.current) emitTimer.current = setTimeout(emit, 250);
    if (selRef.current) refreshSelection();
    if (zone) setZone(null);
  };
  useEffect(() => () => {
    if (emitTimer.current) {
      clearTimeout(emitTimer.current);
      emit();
    }
  }, [emit]);

  const onImgLoad = () => {
    if (readyRef.current) return;
    readyRef.current = true;
    requestAnimationFrame(() => {
      P.current.onReady();
      emit();
    });
  };

  // ── Zoom ──
  const applyZoom = useCallback((z: Zoom) => setZoom(z === 'fit' ? 'fit' : clamp(z, MIN_ZOOM, MAX_ZOOM)), []);
  const zoomIn = useCallback(() => applyZoom(ZOOM_STEPS.find((s) => s > scaleRef.current * 1.001) ?? MAX_ZOOM), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom([...ZOOM_STEPS].reverse().find((s) => s < scaleRef.current * 0.999) ?? MIN_ZOOM), [applyZoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (!root.contains(document.activeElement)) return;
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
        return;
      }
      if (typing || e.altKey) return;
      if (!root.contains(document.activeElement) && document.activeElement !== document.body) return;
      if (e.key.toLowerCase() === 'z' && !selRef.current && !zone) {
        e.preventDefault();
        setZoneMode((v) => !v);
      } else if (e.key === 'Escape' && zoneMode && !zone) setZoneMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomIn, zoomOut, applyZoom, zoneMode, zone]);

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

  // ── Calque de texte (reconstruit seulement quand le texte reconnu change) ──
  useLayoutEffect(() => {
    const hostEl = textHost.current;
    if (!hostEl) return;
    if (!nat || !model.words.length) {
      hostEl.replaceChildren();
      return;
    }
    hostEl.replaceChildren(buildTextLayer(model, nat.w, nat.h));
  }, [model, nat, url]);

  // ── Sélection ──
  function refreshSelection() {
    const layer = textHost.current?.firstElementChild;
    const page = pageRef.current;
    const s = layer && page ? readImageSelection(layer, modelRef.current) : null;
    selRef.current = s;
    if (!s || !page) return setSelRect((p) => (p ? null : p));
    const pr = page.getBoundingClientRect();
    const xs = s.rects.map((r) => pr.left + r.x * pr.width);
    const ys = s.rects.map((r) => pr.top + r.y * pr.height);
    const x2 = s.rects.map((r) => pr.left + (r.x + r.w) * pr.width);
    const y2 = s.rects.map((r) => pr.top + (r.y + r.h) * pr.height);
    const rect = new DOMRect(Math.min(...xs), Math.min(...ys), Math.max(...x2) - Math.min(...xs), Math.max(...y2) - Math.min(...ys));
    setSelRect((p) => (p && p.x === rect.x && p.y === rect.y && p.width === rect.width && p.height === rect.height ? p : rect));
  }

  const dragging = useRef(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let selecting: Element | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as Element).closest('.img-zoombar, .img-panel, .img-ocr-chip, .img-empty')) return;
      dragging.current = true;
      selecting = (e.target as Element).closest('.img-page')?.querySelector('.img-text') ?? null;
      selecting?.classList.add('selecting');
      selRef.current = null;
      setSelRect((p) => (p ? null : p));
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
      if (timer) clearTimeout(timer);
      timer = setTimeout(refreshSelection, 80);
    };
    root.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    document.addEventListener('selectionchange', onSelChange);
    return () => {
      root.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      document.removeEventListener('selectionchange', onSelChange);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    selRef.current = null;
    setSelRect(null);
    setZone(null);
  };

  const printedPage = () => {
    const off = P.current.book.edition.pageOffset;
    return off ? String(1 + off) : '';
  };

  /** Sélection de texte, ou zone tracée, prête à devenir un extrait. */
  const takePending = (): { anchor: PdfAnchor; text: string; label: string } | null => {
    if (zone) {
      const inside = wordsInRect(modelRef.current, zone);
      const text = inside.map((w) => w.t).join(' ').trim() || ZONE_TEXT;
      return { anchor: { kind: 'pdf', page: 1, rects: [zone] }, text, label: LABEL_ZONE };
    }
    const layer = textHost.current?.firstElementChild;
    const s = (layer && readImageSelection(layer, modelRef.current)) || selRef.current;
    return s ? { anchor: { kind: 'pdf', page: 1, rects: s.rects }, text: s.text, label: LABEL_TEXT } : null;
  };

  const onPick = (category: CategoryId | null, withNote: boolean, plain?: boolean) => {
    const t = takePending();
    if (!t) return;
    clearSelection();
    setZoneMode(false);
    P.current.onCreateHighlight({ anchor: t.anchor, text: t.text, locationLabel: t.label, category, plain: plain || undefined, printedPage: printedPage() }, withNote);
  };
  const onCite = () => {
    const t = takePending();
    if (!t) return;
    clearSelection();
    setZoneMode(false);
    P.current.onCite?.({ anchor: t.anchor, text: t.text, locationLabel: t.label, category: null, printedPage: printedPage() });
  };
  const onMovementPick = () => {
    const t = takePending();
    if (!t) return;
    clearSelection();
    setZoneMode(false);
    P.current.onCreateMovement({ anchor: t.anchor, text: t.text.slice(0, 80), locationLabel: t.label });
  };
  const onCopy = () => {
    const t = takePending();
    if (t && t.text !== ZONE_TEXT) navigator.clipboard?.writeText(t.text).catch(() => undefined);
    clearSelection();
  };

  // ── Zone tracée à la souris ──
  const zoneStart = useRef<{ x: number; y: number } | null>(null);
  const normPoint = (e: RPointerEvent) => {
    const pr = pageRef.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - pr.left) / pr.width, 0, 1), y: clamp((e.clientY - pr.top) / pr.height, 0, 1) };
  };
  const onZoneDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setZone(null);
    zoneStart.current = normPoint(e);
    setDraft({ ...zoneStart.current, w: 0, h: 0 });
  };
  const onZoneMove = (e: RPointerEvent) => {
    const s = zoneStart.current;
    if (!s) return;
    const p = normPoint(e);
    setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onZoneUp = () => {
    const d = draft;
    zoneStart.current = null;
    setDraft(null);
    const pr = pageRef.current?.getBoundingClientRect();
    if (!d || !pr || d.w * pr.width < 8 || d.h * pr.height < 8) return;
    const r4 = (v: number) => Math.round(v * 10000) / 10000;
    setZone({ x: r4(d.x), y: r4(d.y), w: r4(d.w), h: r4(d.h) });
  };
  const zoneScreenRect = (() => {
    if (!zone || !pageRef.current) return null;
    const pr = pageRef.current.getBoundingClientRect();
    return new DOMRect(pr.left + zone.x * pr.width, pr.top + zone.y * pr.height, zone.w * pr.width, zone.h * pr.height);
  })();

  // ── Surlignages : clic et curseur ──
  const hlList = useMemo(
    () =>
      props.highlights
        .filter((h) => h.anchor.kind === 'pdf' && h.anchor.page === 1)
        .map((h) => ({ id: h.id, category: h.category, plain: h.plain, rects: (h.anchor as PdfAnchor).rects, zone: h.locationLabel === LABEL_ZONE })),
    [props.highlights],
  );
  const hlRef = useRef(hlList);
  hlRef.current = hlList;
  const mvList = useMemo(
    () => props.movements.filter((m) => m.anchor.kind === 'pdf' && m.anchor.rects.length).map((m) => ({ id: m.id, title: m.title, y: (m.anchor as PdfAnchor).rects[0].y })),
    [props.movements],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hit = (x: number, y: number) => {
      const page = pageRef.current;
      if (!page) return null;
      const pr = page.getBoundingClientRect();
      const nx = (x - pr.left) / pr.width;
      const ny = (y - pr.top) / pr.height;
      const list = hlRef.current;
      for (let i = list.length - 1; i >= 0; i--) {
        for (const r of list[i].rects) {
          if (nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h)
            return { id: list[i].id, rect: new DOMRect(pr.left + r.x * pr.width, pr.top + r.y * pr.height, r.w * pr.width, r.h * pr.height) };
        }
      }
      return null;
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest('.img-mv, .img-zone-capture')) return;
      const s = window.getSelection();
      if (s && !s.isCollapsed && el.contains(s.anchorNode)) return;
      const h = t.closest('.img-page') ? hit(e.clientX, e.clientY) : null;
      if (h) P.current.onHighlightClick(h.id, h.rect);
      else P.current.onBackgroundClick();
    };
    let moving = false;
    let over = false;
    const onMove = (e: MouseEvent) => {
      if (e.buttons & 1 || moving || !hlRef.current.length) return;
      moving = true;
      requestAnimationFrame(() => {
        moving = false;
        const now = !!hit(e.clientX, e.clientY);
        if (now !== over) {
          over = now;
          pageRef.current?.classList.toggle('is-over-hl', now);
        }
      });
    };
    el.addEventListener('click', onClick);
    el.addEventListener('mousemove', onMove);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('mousemove', onMove);
    };
  }, []);

  // ── Navigation ──
  const scrollToNorm = useCallback((ny: number, ratio = 0.3) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: Math.max(0, PAD_TOP + ny * dispH - el.clientHeight * ratio), behavior: 'smooth' });
  }, [dispH]);

  // ── Poignée moteur ──
  useImperativeHandle(
    ref,
    (): EngineHandle => ({
      goTo() {
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      },
      goToHighlight(h) {
        if (h.anchor.kind !== 'pdf') return;
        scrollToNorm(h.anchor.rects[0]?.y ?? 0);
        setPulse((p) => ({ id: h.id, k: (p?.k ?? 0) + 1 }));
        setTimeout(() => setPulse((p) => (p && p.id === h.id ? null : p)), 2800);
      },
      goToAnchor(anchor) {
        if (anchor.kind === 'pdf') scrollToNorm(anchor.rects[0]?.y ?? 0);
      },
      getHighlightRect(id) {
        const els = Array.from(pageRef.current?.querySelectorAll(`.hl[data-hl-id="${CSS.escape(id)}"]`) ?? []);
        if (!els.length) return null;
        const rs = els.map((e) => e.getBoundingClientRect());
        const l = Math.min(...rs.map((r) => r.left));
        const t = Math.min(...rs.map((r) => r.top));
        return new DOMRect(l, t, Math.max(...rs.map((r) => r.right)) - l, Math.max(...rs.map((r) => r.bottom)) - t);
      },
      async search(query) {
        const q = normalizeQuery(query);
        const m = modelRef.current;
        if (!q || !m.words.length) return [];
        return findAll(m.index, q, 500).map((ns, nth) => {
          const sp = spanOf(m.index, ns, q.length);
          const sn = makeSnippet(m.index.clean, sp.cleanStart, sp.cleanEnd);
          const a = wordAtRaw(m, sp.rawStart);
          const b = wordAtRaw(m, Math.max(sp.rawStart, sp.rawEnd - 1));
          return {
            id: `img:${nth}`,
            snippet: sn.snippet,
            matchStart: sn.matchStart,
            matchLength: sn.matchLength,
            locationLabel: LABEL_TEXT,
            payload: { a, b, aOff: sp.rawStart - m.starts[a], bOff: sp.rawEnd - m.starts[b] } satisfies SearchPayload,
          };
        });
      },
      goToSearchHit(hit: SearchHit) {
        const p = hit.payload as SearchPayload | undefined;
        const m = modelRef.current;
        if (!p || !m.words[p.a] || !m.words[p.b]) return;
        const rects = rectsForWords(m, { i: p.a, off: clamp(p.aOff, 0, m.words[p.a].t.length) }, { i: p.b, off: clamp(p.bOff, 0, m.words[p.b].t.length) });
        setMarks(rects);
        if (rects[0]) scrollToNorm(rects[0].y, 0.35);
      },
      clearSearch() {
        setMarks(null);
      },
    }),
    [scrollToNorm],
  );

  // ── Texte reconnu : correction ligne par ligne ──
  const lines = useMemo(() => {
    const out: { key: number; para: number; text: string; low: number; words: OcrWord[] }[] = [];
    let k = 0;
    ocr?.paras.forEach((p, pi) =>
      p.lines.forEach((l) => {
        out.push({ key: k++, para: pi, text: l.words.map((w) => w.t).join(' '), low: l.words.filter((w) => w.c < 60).length, words: l.words });
      }),
    );
    return out;
  }, [ocr]);

  const commitLine = (key: number, text: string) => {
    if (!ocr) return;
    let k = 0;
    let changed = false;
    const paras = ocr.paras
      .map((p) => ({
        lines: p.lines
          .map((l) => {
            if (k++ !== key) return l;
            const before = l.words.map((w) => w.t).join(' ');
            if (before === text.trim().replace(/\s+/g, ' ')) return l;
            changed = true;
            return editLine(l, text);
          })
          .filter((l) => l.words.length),
      }))
      .filter((p) => p.lines.length);
    if (!changed) return;
    const next: OcrData = { ...ocr, paras, confidence: averageConfidence(paras), editedAt: Date.now() };
    setOcr(next);
    saveOcr(bookId, next).catch((e) => console.warn('[image] cache OCR', e));
  };

  const rerun = () => {
    setConfirmRerun(false);
    const blob = blobRef.current;
    if (!blob) return;
    createImageBitmap(blob, ORIENT)
      .then((bmp) => {
        runOcr(bmp, true);
        bmp.close();
      })
      .catch((e) => {
        setOcrError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      });
  };

  const focusRect = useMemo(() => {
    if (focusLine === null) return null;
    const ws = model.words.filter((w) => w.line === focusLine);
    if (!ws.length) return null;
    const x = Math.min(...ws.map((w) => w.x));
    const y = Math.min(...ws.map((w) => w.y));
    return { x, y, w: Math.max(...ws.map((w) => w.x + w.w)) - x, h: Math.max(...ws.map((w) => w.y + w.h)) - y };
  }, [focusLine, model]);

  // ── Rendu ──
  const pctZoom = Math.round(scale * 100);
  const nWords = model.words.length;
  const pageStyle = { width: dispW, height: dispH, '--img-k': nat ? dispW / nat.w : 1 } as CSSProperties;
  const showEmpty = phase === 'done' && nWords === 0 && !hlList.length && !zoneMode;

  return (
    <div className={`img-reader${panel ? ' has-panel' : ''}`} ref={rootRef} tabIndex={-1}>
      <div className="img-main">
        <div className={`img-scroll${zoneMode ? ' is-zone' : ''}`} ref={scrollRef} onScroll={onScroll}>
          {url && nat && (
            <div className="img-stage" style={{ padding: `${PAD_TOP}px ${GUTTER}px ${PAD_BOTTOM}px` }}>
              <div className={`img-page${phase === 'running' ? ' is-scanning' : ''}`} ref={pageRef} style={pageStyle}>
                <img className="img-picture" src={url} alt="" draggable={false} onLoad={onImgLoad} />
                {panel && model.words.length > 0 && (
                  <div className="img-boxes" aria-hidden="true">
                    {model.words.map((w) => (
                      <div key={w.i} className={`img-box${w.c < 60 ? ' is-low' : ''}`} style={{ left: pct(w.x), top: pct(w.y), width: pct(w.w), height: pct(w.h) }} />
                    ))}
                  </div>
                )}
                {hlList.length > 0 && (
                  <div className="img-hl-layer">
                    {hlList.flatMap((hl) =>
                      hl.rects.map((r, i) => (
                        <div
                          key={`${hl.id}:${i}`}
                          className={`hl ${hlClass(hl)}${hl.zone ? ' is-zone' : ''}${props.activeHighlightId === hl.id ? ' active' : ''}${pulse?.id === hl.id ? ' pulse' : ''}`}
                          data-hl-id={hl.id}
                          style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
                        />
                      )),
                    )}
                  </div>
                )}
                {(marks || focusRect) && (
                  <div className="img-search-layer">
                    {marks?.map((r, i) => <div key={i} className="search-hit current" style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }} />)}
                    {focusRect && <div className="img-focus-line" style={{ left: pct(focusRect.x), top: pct(focusRect.y), width: pct(focusRect.w), height: pct(focusRect.h) }} />}
                  </div>
                )}
                <div className="img-text-host" ref={textHost} />
                {phase === 'running' && <div className="img-scan" aria-hidden="true" />}
                {(draft || zone) && (
                  <div
                    className={`img-zone${zone ? ' is-set' : ''}`}
                    style={{ left: pct((zone ?? draft)!.x), top: pct((zone ?? draft)!.y), width: pct((zone ?? draft)!.w), height: pct((zone ?? draft)!.h) }}
                  />
                )}
                {zoneMode && <div className="img-zone-capture" onPointerDown={onZoneDown} onPointerMove={onZoneMove} onPointerUp={onZoneUp} />}
                {mvList.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="img-mv"
                    data-mv-id={m.id}
                    style={{ top: pct(m.y) }}
                    aria-label={`Mouvement : ${m.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      P.current.onMovementClick(m.id);
                    }}
                  >
                    <Milestone size={12} />
                    <span className="img-mv-label">{m.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {phase === 'running' && (
          <div className="img-ocr-chip anim-in" role="status" aria-live="polite">
            <span className="img-ocr-label">{progress.label}…</span>
            <span className="img-ocr-pct">{Math.round(progress.value * 100)} %</span>
            <span className="img-ocr-bar">
              <span style={{ transform: `scaleX(${Math.max(0.02, progress.value)})` }} />
            </span>
          </div>
        )}
        {phase === 'error' && (
          <div className="img-ocr-chip is-error anim-in" role="alert">
            <span className="img-ocr-label">Le texte de l’image n’a pas pu être reconnu. Réessayez, ou annotez l’image par zones.</span>
            <button className="btn btn-sm" onClick={rerun}>
              Réessayer
            </button>
          </div>
        )}
        {showEmpty && (
          <div className="img-empty anim-in">
            <strong>Aucun texte reconnu</strong>
            <span>Tracez une zone sur l’image pour l’annoter.</span>
            <button className="btn btn-sm" onClick={() => setZoneMode(true)}>
              <SquareDashed size={14} /> Tracer une zone
            </button>
          </div>
        )}
        {zoneMode && !zone && !draft && (
          <div className="img-hint anim-in" role="status">
            Tracez un rectangle sur l’image <span className="img-hint-esc"><span className="kbd">Échap</span> pour annuler</span>
          </div>
        )}

        {url && (
          <div className="img-zoombar" role="toolbar" aria-label="Zoom et outils">
            <button className="icon-btn sm" onClick={zoomOut} title={fmtKeys("Zoom arrière (⌘−)")} aria-label="Zoom arrière">
              <Minus size={14} />
            </button>
            <span className="img-zoom-val" data-testid="img-zoom">
              {pctZoom} %
            </span>
            <button className="icon-btn sm" onClick={zoomIn} title={fmtKeys("Zoom avant (⌘+)")} aria-label="Zoom avant">
              <Plus size={14} />
            </button>
            <span className="img-zoom-sep" />
            <button className={`btn btn-ghost btn-sm img-tool ${zoom === 'fit' ? 'is-on' : ''}`} onClick={() => applyZoom('fit')} title={fmtKeys("Ajuster à la largeur (⌘0)")}
              aria-label="Ajuster à la largeur">
              <Maximize2 size={13} /> <span className="img-tool-label">Ajuster</span>
            </button>
            <span className="img-zoom-sep" />
            <button
              className={`btn btn-ghost btn-sm img-tool ${zoneMode ? 'is-on' : ''}`}
              onClick={() => {
                setZone(null);
                setZoneMode((v) => !v);
              }}
              title="Annoter une zone de l’image (Z)"
              aria-label="Annoter une zone"
              aria-pressed={zoneMode}
            >
              <SquareDashed size={13} /> <span className="img-tool-label">Zone</span>
            </button>
            <button
              className={`btn btn-ghost btn-sm img-tool ${panel ? 'is-on' : ''}`}
              onClick={() => setPanel((v) => !v)}
              title="Afficher le texte reconnu"
              aria-label="Texte reconnu"
              aria-pressed={panel}
              data-testid="img-text-toggle"
            >
              <ScanText size={13} /> <span className="img-tool-label">Texte</span>
            </button>
          </div>
        )}
      </div>

      {panel && (
        <aside className="img-panel anim-slide" aria-label="Texte reconnu">
          <header className="img-panel-head">
            <div>
              <h3>Texte reconnu</h3>
              <p className="muted">
                {phase === 'running'
                  ? 'Reconnaissance en cours…'
                  : ocr
                    ? nWords
                      ? `${nWords} mots · fiabilité ${ocr.confidence} %${ocr.editedAt ? ' · corrigé à la main' : ''}`
                      : 'Aucun mot reconnu dans cette image.'
                    : phase === 'error'
                      ? 'La reconnaissance a échoué.'
                      : ''}
              </p>
            </div>
            <button className="icon-btn sm" onClick={() => setPanel(false)} title="Fermer" aria-label="Fermer le texte reconnu">
              <X size={14} />
            </button>
          </header>
          <div className="img-panel-body">
            {phase === 'running' ? (
              <div className="img-panel-skeleton">
                <Skeleton lines={9} />
              </div>
            ) : (
              <>
                {lines.length > 0 && <p className="img-panel-tip muted">Cliquez sur une ligne pour la corriger (Entrée pour valider). Les mots incertains sont soulignés.</p>}
                <div className="img-lines">
                  {lines.map((l, idx) => (
                    // Numéro de ligne de la page (explication de texte : « l. 12 ») ; hors du texte éditable.
                    <div key={`${ocr?.editedAt ?? 0}:${l.key}`} className={`img-row${idx > 0 && lines[idx - 1].para !== l.para ? ' is-para' : ''}${focusLine === l.key ? ' is-focus' : ''}`}>
                    <span className="img-line-no" aria-hidden="true">
                      {idx + 1}
                    </span>
                    <div
                      className="img-line"
                      aria-label={`Ligne ${idx + 1}`}
                      contentEditable
                      suppressContentEditableWarning
                      spellCheck={false}
                      data-line={l.key}
                      onFocus={() => {
                        setFocusLine(l.key);
                        const w = l.words[0];
                        if (w) scrollToNorm(w.y, 0.4);
                      }}
                      onBlur={(e) => {
                        setFocusLine(null);
                        commitLine(l.key, e.currentTarget.textContent ?? '');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.currentTarget.blur();
                        } else if (e.key === 'Escape') {
                          e.currentTarget.textContent = l.text;
                          e.currentTarget.blur();
                        }
                      }}
                    >
                      {l.words.map((w, i) => (
                        <span key={i}>
                          {i > 0 ? ' ' : ''}
                          <span className={w.c < 60 ? 'img-low' : undefined}>{w.t}</span>
                        </span>
                      ))}
                    </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <footer className="img-panel-foot">
            {confirmRerun ? (
              <div className="img-confirm anim-in">
                <span>Une nouvelle reconnaissance remplacera vos corrections. Les extraits restent en place.</span>
                <div className="img-confirm-actions">
                  <button className="btn btn-sm btn-ghost" onClick={() => setConfirmRerun(false)}>
                    Garder mes corrections
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={rerun}>
                    Relancer
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn btn-sm" disabled={phase === 'running' || !nat} onClick={() => (ocr?.editedAt ? setConfirmRerun(true) : rerun())}>
                <RotateCcw size={13} /> Relancer la reconnaissance
              </button>
            )}
          </footer>
        </aside>
      )}

      {(selRect || zoneScreenRect) && (
        <SelectionToolbar rect={(zoneScreenRect ?? selRect)!} onPick={onPick} onMovement={onMovementPick} onCopy={onCopy} onDismiss={clearSelection} onCite={props.onCite ? onCite : undefined} />
      )}
    </div>
  );
});
