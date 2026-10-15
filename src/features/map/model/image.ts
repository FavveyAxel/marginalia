// ─────────────────────────────────────────────────────────────
// Rendu image / PDF d'un SVG de carte (navigateur : Image + canvas ; PDF : host.printToPdf).
//
// API :
//   svgToPng(svg, width, height, scale = 2) → Promise<ArrayBuffer>   PNG (×2 par défaut), fond clair
//   mapPdfHtml(svg, width, height, title)   → string                HTML autonome (A4, carte ajustée ;
//                                                                   carte large : pivotée en paysage)
//   svgToPdf(svg, width, height, title)     → Promise<ArrayBuffer>  via host.printToPdf (app de bureau)
// ─────────────────────────────────────────────────────────────
import { host } from '../../../lib/platform';
import { xml } from './svg';

/** Plus grand côté d'un canvas sûr (Chromium : ~16 384 px ; on reste en dessous). */
const MAX_CANVAS = 12000;

export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<ArrayBuffer> {
  const k = Math.max(0.1, Math.min(scale, MAX_CANVAS / Math.max(width, height)));
  const img = new Image();
  img.decoding = 'async';
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Rendu de la carte impossible'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.fillStyle = '#fbf9f4';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Export PNG impossible');
  return blob.arrayBuffer();
}

/** HTML imprimable (A4 portrait, marges 12 mm). Pas de JavaScript (la fenêtre d'impression l'interdit). */
export function mapPdfHtml(svg: string, width: number, height: number, title: string): string {
  const landscape = width > height * 1.15;
  // Zone utile A4 : 186 × 273 mm.
  const box = landscape
    ? 'width:273mm;height:186mm;transform:rotate(90deg) translate(0,-186mm);transform-origin:top left;'
    : 'width:186mm;height:273mm;';
  const inner = svg.replace(/^<svg([^>]*?) width="[\d.]+" height="[\d.]+"/, '<svg$1 width="100%" height="100%" preserveAspectRatio="xMidYMid meet"');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${xml(title)}</title>
<style>@page{size:A4;margin:12mm}html,body{margin:0;padding:0;background:#fbf9f4}.page{${box}overflow:hidden}svg{display:block}</style>
</head><body><div class="page">${inner}</div></body></html>`;
}

export async function svgToPdf(svg: string, width: number, height: number, title: string): Promise<ArrayBuffer> {
  return host.printToPdf(mapPdfHtml(svg, width, height, title));
}
