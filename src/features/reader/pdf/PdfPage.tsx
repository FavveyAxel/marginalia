// Une page PDF : canvas net (devicePixelRatio), calque de texte, surlignages, marques de recherche,
// repères de mouvement. Le rendu lourd n'a lieu que lorsque la page est proche de la fenêtre.
import { memo, useEffect, useRef, type CSSProperties } from 'react';
import type { RenderTask } from 'pdfjs-dist';
import { Milestone } from 'lucide-react';
import type { CategoryId, NormRect } from '../../../lib/types';
import { pdfjsLib, type PDFDocumentProxy } from './pdfjs';

export interface PageHl {
  id: string;
  category: CategoryId | null;
  rects: NormRect[];
}

export interface PageMv {
  id: string;
  title: string;
  y: number;
}

export interface PageBm {
  id: string;
  y: number;
  label: string;
  /** Couleur CSS du ruban. */
  color: string;
}

interface Props {
  n: number;
  doc: PDFDocumentProxy;
  w: number;
  h: number;
  scale: number;
  near: boolean;
  hls: PageHl[];
  marks: NormRect[] | null;
  movements: PageMv[];
  activeId: string | null;
  pulse: { id: string; k: number } | null;
  onRendered(n: number): void;
  onMovement(id: string): void;
  /** Signets de la page (ruban dans la marge droite). */
  bookmarks?: PageBm[];
  /** Bref surlignage de la ligne d'un signet (retour au signet). */
  flash?: { rect: NormRect; color: string; k: number } | null;
  onBookmark?(id: string, rect: DOMRect): void;
}

/** Plafond de pixels du canvas (mémoire) : au-delà, la résolution baisse. */
const MAX_CANVAS_PIXELS = 12_000_000;

const pct = (v: number) => `${Math.round(v * 100000) / 1000}%`;

/**
 * Fige la page rendue : son image passe dans un canvas « bitmaprenderer » (transfert sans copie).
 * Pourquoi : un canvas 2D est ré-instantané (ProduceCanvasResource, copie de toute la page) chaque
 * fois que la page est repeinte — c'est-à-dire à CHAQUE mouvement de souris pendant une sélection
 * de texte (mesuré : ~1,2 s de fil principal sur un glissé de 40 mouvements, images à 66 ms).
 * Une image figée est simplement redessinée. Repli : le canvas 2D tel quel.
 */
async function freeze(canvas: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  try {
    if (typeof createImageBitmap !== 'function') return canvas;
    const bmp = await createImageBitmap(canvas);
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('bitmaprenderer');
    if (!ctx) {
      bmp.close();
      return canvas;
    }
    ctx.transferFromImageBitmap(bmp);
    Object.assign(out.dataset, canvas.dataset);
    canvas.width = 0;
    canvas.height = 0;
    return out;
  } catch {
    return canvas;
  }
}

function release(host: HTMLElement | null) {
  if (!host) return;
  host.querySelectorAll('canvas').forEach((c) => {
    c.width = 0;
    c.height = 0;
  });
  host.replaceChildren();
}

export const PdfPage = memo(function PdfPage({ n, doc, w, h, scale, near, hls, marks, movements, activeId, pulse, onRendered, onMovement, bookmarks, flash, onBookmark }: Props) {
  const canvasHost = useRef<HTMLDivElement>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onRendered);
  cbRef.current = onRendered;

  useEffect(() => {
    if (!near) {
      release(canvasHost.current);
      release(textHost.current);
      return;
    }
    let cancelled = false;
    let task: RenderTask | null = null;
    let textLayer: InstanceType<typeof pdfjsLib.TextLayer> | null = null;
    let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | null = null;

    (async () => {
      page = await doc.getPage(n);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });

      // Canvas : résolution physique, plafonnée.
      let dpr = Math.min(window.devicePixelRatio || 1, 3);
      const area = viewport.width * viewport.height;
      if (area * dpr * dpr > MAX_CANVAS_PIXELS) dpr = Math.max(0.5, Math.sqrt(MAX_CANVAS_PIXELS / area));
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.dataset.dpr = String(dpr);
      canvas.dataset.scale = String(scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      task = page.render({
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        background: 'rgba(0,0,0,0)',
      });

      // Calque de texte (sélection, recherche).
      const layer = document.createElement('div');
      layer.className = 'textLayer';
      textLayer = new pdfjsLib.TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
        container: layer,
        viewport,
      });
      const textDone = textLayer.render().then(() => {
        if (cancelled) return;
        const end = document.createElement('div');
        end.className = 'endOfContent';
        layer.append(end);
        layer.dataset.ready = '1';
        layer.dataset.scale = String(scale);
        textHost.current?.replaceChildren(layer);
      });
      // Page démontée pendant le rendu : textLayer.cancel() rejette `textDone` (AbortException)
      // alors que plus personne ne l'attend ; ne pas la laisser remonter comme erreur non gérée.
      textDone.catch(() => undefined);

      await task.promise;
      if (cancelled) return;
      const frozen = await freeze(canvas);
      if (cancelled) {
        frozen.width = 0;
        frozen.height = 0;
        return;
      }
      canvasHost.current?.replaceChildren(frozen);
      await textDone;
      if (!cancelled) cbRef.current(n);
    })().catch((e) => {
      if (e?.name === 'RenderingCancelledException' || e?.name === 'AbortException') return;
      if (!cancelled) console.warn(`[pdf] page ${n}`, e);
    });

    return () => {
      cancelled = true;
      task?.cancel();
      textLayer?.cancel();
    };
  }, [near, scale, doc, n]);

  useEffect(
    () => () => {
      release(canvasHost.current);
      release(textHost.current);
    },
    [],
  );

  const style = { width: w, height: h, '--scale-factor': scale, '--total-scale-factor': scale } as CSSProperties;

  return (
    <div className="pdf-page" data-page={n} style={style}>
      <div className="pdf-canvas" ref={canvasHost} />
      {hls.length > 0 && (
        <div className="pdf-hl-layer">
          {hls.flatMap((hl) =>
            hl.rects.map((r, i) => (
              <div
                key={`${hl.id}:${i}`}
                className={`hl ${hl.category ? `hl-${hl.category}` : 'hl-note'}${activeId === hl.id ? ' active' : ''}${pulse?.id === hl.id ? ' pulse' : ''}`}
                data-hl-id={hl.id}
                style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
              />
            )),
          )}
        </div>
      )}
      {marks && (
        <div className="pdf-search-layer">
          {marks.map((r, i) => (
            <div key={i} className="search-hit current" style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }} />
          ))}
        </div>
      )}
      <div className="pdf-text" ref={textHost} />
      {movements.map((m) => (
        <button
          key={m.id}
          type="button"
          className="pdf-mv"
          data-mv-id={m.id}
          style={{ top: pct(m.y) }}
          aria-label={`Mouvement : ${m.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onMovement(m.id);
          }}
        >
          <Milestone size={12} />
          <span className="pdf-mv-label">{m.title}</span>
        </button>
      ))}
      {flash && (
        <div
          key={flash.k}
          className="pdf-bm-flash"
          aria-hidden
          style={{ top: `calc(${pct(flash.rect.y)} - 4px)`, height: `calc(${pct(flash.rect.h)} + 8px)`, '--bm-c': flash.color } as CSSProperties}
        />
      )}
      {bookmarks?.map((b) => (
        <button
          key={b.id}
          type="button"
          className="pdf-bm"
          data-bm-id={b.id}
          title={`Signet : ${b.label}`}
          aria-label={`Signet : ${b.label}`}
          style={{ top: pct(b.y), '--bm-c': b.color } as CSSProperties}
          onClick={(e) => {
            e.stopPropagation();
            onBookmark?.(b.id, e.currentTarget.getBoundingClientRect());
          }}
        />
      ))}
    </div>
  );
});
