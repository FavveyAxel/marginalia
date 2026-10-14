// Configuration de pdf.js et utilitaires (chargement, sommaire, erreurs en français).
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { TocItem } from '../../../lib/types';

export { pdfjsLib };
export type { PDFDocumentProxy };

let configured = false;
function configure() {
  if (configured) return;
  configured = true;
  // L'URL du worker est relative à la page (Vite, base './') : fonctionne aussi sous app://.
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
}

/** URL d'un dossier de public/ résolue contre la page (chemins relatifs, pas de CDN). */
function assetDir(rel: string): string {
  return new URL(rel, document.baseURI).href;
}

export function openPdf(data: ArrayBuffer): PDFDocumentLoadingTask {
  configure();
  return pdfjsLib.getDocument({
    // pdf.js transfère (détache) le tampon : on lui donne une copie.
    data: new Uint8Array(data.slice(0)),
    standardFontDataUrl: assetDir('pdfjs/standard_fonts/'),
    cMapUrl: assetDir('pdfjs/cmaps/'),
    cMapPacked: true,
    isEvalSupported: false,
    // Les récupérations de polices / cmaps passent par le thread principal (schéma app:// compatible).
    useWorkerFetch: false,
  });
}

export function describeError(e: unknown): string {
  const err = e as { name?: string; message?: string } | null;
  switch (err?.name) {
    case 'PasswordException':
      return 'Ce PDF est protégé par un mot de passe. Marginalia ne peut pas encore ouvrir les documents protégés : retirez la protection, puis importez de nouveau le fichier.';
    case 'InvalidPDFException':
      return 'Ce fichier PDF est invalide ou endommagé.';
    case 'MissingPDFException':
      return 'Le fichier PDF est introuvable.';
    default:
      return `Impossible d'ouvrir ce PDF${err?.message ? ` (${err.message})` : ''}.`;
  }
}

async function destToPage(pdf: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    let d: unknown = dest;
    if (typeof d === 'string') d = await pdf.getDestination(d);
    if (!Array.isArray(d) || !d.length) return null;
    const ref = d[0];
    if (typeof ref === 'number') return ref + 1;
    if (ref && typeof ref === 'object') return (await pdf.getPageIndex(ref as never)) + 1;
  } catch {
    /* destination invalide */
  }
  return null;
}

interface OutlineNode {
  title: string;
  dest: unknown;
  items?: OutlineNode[];
}

/** Sommaire (signets) du PDF, aplati avec profondeur et page résolue. */
export async function loadToc(pdf: PDFDocumentProxy): Promise<TocItem[]> {
  const outline = (await pdf.getOutline().catch(() => null)) as OutlineNode[] | null;
  if (!outline) return [];
  const items: TocItem[] = [];
  let idx = 0;
  const walk = async (nodes: OutlineNode[], depth: number, fallback: number | null) => {
    for (const node of nodes) {
      const page = (await destToPage(pdf, node.dest)) ?? fallback;
      if (page) {
        items.push({
          id: `pdf-toc-${idx++}`,
          label: (node.title || '').replace(/\s+/g, ' ').trim() || 'Sans titre',
          depth,
          target: { kind: 'pdf', page: Math.min(Math.max(1, page), pdf.numPages) },
        });
      }
      if (node.items?.length) await walk(node.items, depth + 1, page);
    }
  };
  await walk(outline, 0, null);
  return items;
}
