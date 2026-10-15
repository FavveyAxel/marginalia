// Extraction des métadonnées à l'import. Ne lève jamais d'erreur pour une métadonnée manquante :
// en dernier recours, le titre est dérivé du nom de fichier.
import JSZip from 'jszip';
import type { BookFormat, Edition } from '../../lib/types';
import { extOf, IMAGE_EXTENSIONS, type PickedFile } from '../../lib/platform';
import { looksBinary, sniffFile } from '../../lib/sniff';
import { imageThumbnail } from '../reader/image/decode';

export interface BookMetadata {
  title: string;
  author: string;
  format: BookFormat;
  cover: string | null;
  /** Éditeur, année, traducteur… si trouvés dans les métadonnées. */
  edition?: Partial<Edition>;
}

const COVER_MAX_H = 600;

/** « jean-jacques_rousseau.du-contrat-social.epub » → « Jean-jacques rousseau du contrat social ». */
export function prettifyFileName(name: string): string {
  let base = name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ');
  // Nom « slug » (tirets sans espaces) : les tirets sont des séparateurs.
  if (!/\s/.test(base)) base = base.replace(/-+/g, ' ');
  base = base.replace(/\.+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return 'Sans titre';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function formatOf(ext: string): BookFormat {
  if (ext === 'markdown') return 'md';
  if (ext === 'htm') return 'html';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (['epub', 'pdf', 'docx', 'md', 'txt', 'html'].includes(ext)) return ext as BookFormat;
  return 'txt';
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function yearOf(s: string | null | undefined): string {
  const m = /(?<!\d)(1\d{3}|20\d{2})(?!\d)/.exec(s ?? '');
  return m ? m[1] : '';
}

function parseXml(text: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return null;
    return doc;
  } catch {
    return null;
  }
}

/** Premier élément dont le nom local est `local` (indépendant du préfixe de namespace). */
function firstByLocal(doc: Document | Element, local: string): Element | null {
  const all = doc.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) if (all[i].localName === local) return all[i];
  return null;
}
function allByLocal(doc: Document | Element, local: string): Element[] {
  const out: Element[] = [];
  const all = doc.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) if (all[i].localName === local) out.push(all[i]);
  return out;
}

// ── Couvertures ──────────────────────────────────────────────
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image illisible'));
    img.src = src;
  });
}

/** Redimensionne à 600 px de haut maximum et encode en JPEG (data URL). */
async function toJpegDataUrl(source: CanvasImageSource, w: number, h: number): Promise<string | null> {
  if (!w || !h) return null;
  const scale = Math.min(1, COVER_MAX_H / h);
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(source, 0, 0, cw, ch);
  return canvas.toDataURL('image/jpeg', 0.82);
}

async function coverFromBytes(bytes: Uint8Array, mime: string): Promise<string | null> {
  try {
    const blob = new Blob([bytes as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImage(url);
      return await toJpegDataUrl(img, img.naturalWidth, img.naturalHeight);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

function mimeOfPath(p: string, declared?: string | null): string {
  if (declared && declared.startsWith('image/')) return declared;
  const e = extOf(p);
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'png') return 'image/png';
  if (e === 'gif') return 'image/gif';
  if (e === 'webp') return 'image/webp';
  if (e === 'svg') return 'image/svg+xml';
  return 'image/png';
}

function resolvePath(base: string, href: string): string {
  const clean0 = decodeURIComponent(href.split('#')[0]);
  const parts = (base ? base.split('/').slice(0, -1) : []).concat(clean0.split('/'));
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

// ── EPUB ─────────────────────────────────────────────────────
async function epubMeta(f: PickedFile): Promise<Partial<BookMetadata>> {
  const zip = await JSZip.loadAsync(f.data);
  const container = zip.file('META-INF/container.xml');
  let opfPath = '';
  if (container) {
    const cdoc = parseXml(await container.async('string'));
    const rf = cdoc ? firstByLocal(cdoc, 'rootfile') : null;
    opfPath = rf?.getAttribute('full-path') ?? '';
  }
  if (!opfPath) opfPath = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith('.opf')) ?? '';
  const opfFile = opfPath ? zip.file(opfPath) : null;
  if (!opfFile) return {};
  const doc = parseXml(await opfFile.async('string'));
  if (!doc) return {};

  const title = clean(firstByLocal(doc, 'title')?.textContent);
  const creators = allByLocal(doc, 'creator');
  const author = creators.map((c) => clean(c.textContent)).filter(Boolean).join(', ');
  const publisher = clean(firstByLocal(doc, 'publisher')?.textContent);
  const year = yearOf(firstByLocal(doc, 'date')?.textContent);

  // Traducteur : dc:contributor avec opf:role="trl" ou meta refines role = trl.
  let translator = '';
  const metas = allByLocal(doc, 'meta');
  for (const c of allByLocal(doc, 'contributor')) {
    const role = c.getAttribute('opf:role') ?? c.getAttributeNS('http://www.idpf.org/2007/opf', 'role') ?? '';
    let isTrl = role === 'trl';
    const id = c.getAttribute('id');
    if (!isTrl && id) {
      isTrl = metas.some((m) => m.getAttribute('refines') === '#' + id && m.getAttribute('property') === 'role' && clean(m.textContent) === 'trl');
    }
    if (isTrl) {
      translator = clean(c.textContent);
      break;
    }
  }

  // Couverture : properties="cover-image", sinon <meta name="cover" content="id">.
  const items = allByLocal(doc, 'item');
  let coverItem = items.find((i) => (i.getAttribute('properties') ?? '').split(/\s+/).includes('cover-image')) ?? null;
  if (!coverItem) {
    const cm = metas.find((m) => m.getAttribute('name') === 'cover');
    const cid = cm?.getAttribute('content');
    if (cid) coverItem = items.find((i) => i.getAttribute('id') === cid) ?? null;
  }
  let cover: string | null = null;
  if (coverItem) {
    const href = coverItem.getAttribute('href');
    if (href) {
      const entry = zip.file(resolvePath(opfPath, href));
      if (entry) {
        const bytes = await entry.async('uint8array');
        cover = await coverFromBytes(bytes, mimeOfPath(href, coverItem.getAttribute('media-type')));
      }
    }
  }
  return { title, author, cover, edition: { publisher, year, translator } };
}

// ── PDF ──────────────────────────────────────────────────────
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      }
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

async function pdfMeta(f: PickedFile): Promise<Partial<BookMetadata>> {
  const pdfjs = await loadPdfjs();
  // pdf.js peut transférer (détacher) le tampon : on lui donne une copie.
  const task = pdfjs.getDocument({ data: new Uint8Array(f.data.slice(0)) });
  const pdf = await task.promise;
  try {
    let title = '';
    let author = '';
    try {
      const md = await pdf.getMetadata();
      const info = (md.info ?? {}) as Record<string, unknown>;
      title = clean(String(info.Title ?? ''));
      author = clean(String(info.Author ?? ''));
    } catch {
      /* métadonnées absentes */
    }
    let cover: string | null = null;
    try {
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, COVER_MAX_H / base.height);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        cover = canvas.toDataURL('image/jpeg', 0.82);
      }
    } catch {
      cover = null;
    }
    // L'année de création du fichier n'est pas l'année d'édition : on ne la propose pas.
    return { title, author, cover };
  } finally {
    try {
      await pdf.destroy();
    } catch {
      /* ignore */
    }
  }
}

// ── DOCX ─────────────────────────────────────────────────────
async function docxMeta(f: PickedFile): Promise<Partial<BookMetadata>> {
  const zip = await JSZip.loadAsync(f.data);
  const core = zip.file('docProps/core.xml');
  if (!core) return {};
  const doc = parseXml(await core.async('string'));
  if (!doc) return {};
  return {
    title: clean(firstByLocal(doc, 'title')?.textContent),
    author: clean(firstByLocal(doc, 'creator')?.textContent),
  };
}

// ── Markdown ─────────────────────────────────────────────────
function decode(data: ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(data);
}

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1).trim();
  return t;
}

function mdMeta(f: PickedFile): Partial<BookMetadata> {
  const text = decode(f.data).replace(/^\uFEFF/, '');
  const out: Partial<BookMetadata> = {};
  let body = text;
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  const edition: Partial<Edition> = {};
  if (fm) {
    body = text.slice(fm[0].length);
    for (const line of fm[1].split(/\r?\n/)) {
      const m = /^([A-Za-zÀ-ÿ_-]+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = unquote(m[2]);
      if (!val) continue;
      if (key === 'title' || key === 'titre') out.title = val;
      else if (key === 'author' || key === 'auteur') out.author = val;
      else if (key === 'publisher' || key === 'editeur' || key === 'éditeur') edition.publisher = val;
      else if (key === 'translator' || key === 'traducteur') edition.translator = val;
      else if (key === 'date' || key === 'year' || key === 'annee' || key === 'année') edition.year = yearOf(val);
    }
  }
  if (!out.title) {
    const h = /^#\s+(.+?)\s*#*\s*$/m.exec(body);
    if (h) out.title = clean(h[1].replace(/[*_`]/g, ''));
  }
  if (Object.keys(edition).length) out.edition = edition;
  return out;
}

// ── HTML ─────────────────────────────────────────────────────
function htmlMeta(f: PickedFile): Partial<BookMetadata> {
  const text = decode(f.data);
  try {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const title = clean(doc.querySelector('title')?.textContent);
    const author = clean(doc.querySelector('meta[name="author" i]')?.getAttribute('content'));
    const publisher = clean(doc.querySelector('meta[name="publisher" i]')?.getAttribute('content'));
    return { title, author, edition: publisher ? { publisher } : undefined };
  } catch {
    return {};
  }
}

export async function extractMetadata(f: PickedFile): Promise<BookMetadata> {
  const ext = extOf(f.name);
  // Le contenu l'emporte sur le nom : une photo sans extension reste une image.
  const sniffed = sniffFile(f.data);
  const format = sniffed.format ?? formatOf(ext);
  if (format === 'txt' && looksBinary(f.data)) throw new Error(`« ${f.name} » n’est pas un format pris en charge`);
  let found: Partial<BookMetadata> = {};
  try {
    if (format === 'epub') found = await epubMeta(f);
    else if (format === 'pdf') found = await pdfMeta(f);
    else if (format === 'docx') found = await docxMeta(f);
    else if (format === 'md') found = mdMeta(f);
    else if (format === 'html') found = htmlMeta(f);
    else if (format === 'image') {
      // Photo ou scan d'une page : la couverture est la miniature, le titre le nom du fichier.
      found = { title: f.name.replace(/\.[^.]+$/, '').trim(), cover: await imageThumbnail(f.data, f.name) };
    }
  } catch (e) {
    console.warn('métadonnées illisibles', f.name, e);
  }
  const edition: Partial<Edition> = {};
  for (const [k, v] of Object.entries(found.edition ?? {})) {
    if (typeof v === 'string' && v) (edition as Record<string, string>)[k] = v;
  }
  return {
    title: clean(found.title) || prettifyFileName(f.name),
    author: clean(found.author),
    format,
    cover: found.cover ?? null,
    edition: Object.keys(edition).length ? edition : undefined,
  };
}
