// ─────────────────────────────────────────────────────────────
// Livres papier : un livre qu'on a en papier (aucun fichier). Métadonnées de l'édition, couverture
// (téléchargée puis rangée avec le livre, ou photographiée), extraits tapés ou venus de photos de
// pages. La recherche d'éditions passe par le processus principal (host.paper) ; le rendu ne charge
// jamais rien d'Internet.
// ─────────────────────────────────────────────────────────────
import { useEffect } from 'react';
import { useStore, uid, EMPTY_EDITION } from '../../lib/store';
import { host, type PaperEdition, type PaperSearchResult } from '../../lib/platform';
import type { Anchor, Book, CategoryId, Highlight, Route } from '../../lib/types';
import { imageThumbnail } from '../reader/image/decode';

export const isPaper = (b: Pick<Book, 'format'> | null | undefined): boolean => b?.format === 'paper';

/** Réglage « Rechercher les livres papier sur Internet » (défaut : oui) ; la recherche existe-t-elle ici ? */
export const paperOnline = () => useStore.getState().settings.paperOnline !== false;
export const paperSearchAvailable = () => !!host.paper;

/** Transmet le réglage au processus principal (au lancement, puis à chaque changement). */
export function usePaperOnlineSync() {
  const ready = useStore((s) => s.ready);
  const on = useStore((s) => s.settings.paperOnline !== false);
  useEffect(() => {
    if (ready) void host.paper?.setOnline(on).catch(() => undefined);
  }, [ready, on]);
}

const OFF: PaperSearchResult = { ok: false, off: true, results: [], error: 'La recherche sur Internet est désactivée dans les Réglages.' };

export async function searchEditions(q: string): Promise<PaperSearchResult> {
  if (!host.paper) return { ok: false, results: [], error: 'Recherche disponible dans l’app de bureau.' };
  if (!paperOnline()) return OFF;
  try {
    return await host.paper.search(q);
  } catch (e) {
    return { ok: false, results: [], error: String((e as Error)?.message ?? e) };
  }
}

export async function editionsByIsbn(isbn: string): Promise<PaperSearchResult> {
  if (!host.paper) return { ok: false, results: [], error: 'Recherche disponible dans l’app de bureau.' };
  if (!paperOnline()) return OFF;
  try {
    return await host.paper.isbn(isbn);
  } catch (e) {
    return { ok: false, results: [], error: String((e as Error)?.message ?? e) };
  }
}

// Couvertures des résultats : demandées une fois par adresse (le processus principal les télécharge).
const coverCache = new Map<string, Promise<string | null>>();
export function editionCover(url: string): Promise<string | null> {
  if (!url || !host.paper || !paperOnline()) return Promise.resolve(null);
  let p = coverCache.get(url);
  if (!p) {
    p = host.paper.cover(url).catch(() => null);
    coverCache.set(url, p);
    if (coverCache.size > 200) coverCache.delete(coverCache.keys().next().value as string);
  }
  return p;
}

/** Vignette JPEG (400 × 600 au plus) d'une image quelconque : la couverture rangée avec le livre. */
export async function coverThumb(data: ArrayBuffer | string, name = 'couverture.jpg'): Promise<string | null> {
  let bytes: ArrayBuffer;
  if (typeof data === 'string') {
    const m = /^data:[^;,]+;base64,(.*)$/.exec(data);
    if (!m) return null;
    const bin = atob(m[1]);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    bytes = u8.buffer;
  } else bytes = data;
  return imageThumbnail(bytes, name);
}

/** « Jean-Jacques Rousseau » ; plusieurs auteurs : « A et B », « A, B et C ». */
export function authorsText(a: string[]): string {
  const l = a.filter(Boolean);
  return l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}`;
}

/** « 978-2-08-070688-1 » */
export function prettyIsbn(isbn: string): string {
  return /^97[89]\d{10}$/.test(isbn) ? `${isbn.slice(0, 3)}-${isbn.slice(3, 4)}-${isbn.slice(4, 12)}-${isbn.slice(12)}` : isbn;
}

/** « GF Flammarion, 2001 » */
export function editionLine(b: Pick<Book, 'edition'>): string {
  return [b.edition.publisher, b.edition.year].filter(Boolean).join(', ');
}

export interface PaperInput {
  title: string;
  author: string;
  publisher?: string;
  year?: string;
  isbn?: string;
  translator?: string;
  /** Couverture déjà réduite (data: URL), ou null. */
  cover?: string | null;
}

/** Même livre papier déjà dans la bibliothèque (même ISBN, ou même titre + auteur + éditeur + année). */
export function findPaperBook(p: PaperInput): Book | null {
  const fold = (s = '') => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const books = useStore.getState().books.filter(isPaper);
  if (p.isbn) {
    const hit = books.find((b) => b.isbn === p.isbn);
    if (hit) return hit;
  }
  return books.find((b) => fold(b.title) === fold(p.title) && fold(b.author) === fold(p.author) && fold(b.edition.publisher) === fold(p.publisher) && (b.edition.year || '') === (p.year || '')) ?? null;
}

/** Ajoute un livre papier à la bibliothèque (et à l'espace d'où l'on vient, s'il y a lieu). */
export function addPaperBook(p: PaperInput, opts: { workspaceId?: string | null; groupId?: string | null } = {}): Book {
  const st = useStore.getState();
  const book: Book = {
    id: uid(),
    title: p.title.trim() || 'Sans titre',
    author: p.author.trim(),
    format: 'paper',
    paper: true,
    ...(p.isbn ? { isbn: p.isbn } : {}),
    fileName: '',
    originalName: '',
    size: 0,
    addedAt: Date.now(),
    lastOpenedAt: null,
    progress: 0,
    position: null,
    cover: p.cover ?? null,
    edition: { ...EMPTY_EDITION, publisher: (p.publisher ?? '').trim(), year: (p.year ?? '').trim(), translator: (p.translator ?? '').trim() },
  };
  st.insert('books', book);
  if (opts.workspaceId && st.workspaces.some((w) => w.id === opts.workspaceId)) st.addToWorkspace(opts.workspaceId, opts.groupId ?? null, 'book', book.id);
  return book;
}

/** Livre papier d'une édition trouvée : couverture téléchargée par le processus principal, réduite et rangée avec le livre. */
export async function addEdition(ed: PaperEdition, opts: { workspaceId?: string | null; groupId?: string | null } = {}): Promise<{ book: Book; existed: boolean }> {
  const input: PaperInput = { title: ed.subtitle && ed.subtitle.length < 60 && !ed.title.includes(ed.subtitle) ? `${ed.title}. ${ed.subtitle}` : ed.title, author: authorsText(ed.authors), publisher: ed.publisher, year: ed.year, isbn: ed.isbn };
  const existing = findPaperBook({ ...input, title: ed.title }) ?? findPaperBook(input);
  if (existing) return { book: existing, existed: true };
  const raw = ed.cover ? await editionCover(ed.cover) : null;
  const cover = raw ? await coverThumb(raw).catch(() => null) : null;
  return { book: addPaperBook({ ...input, cover }, opts), existed: false };
}

/** Ancrage d'un extrait de livre papier : la page (0 si inconnue), sans géométrie. */
export const paperAnchor = (page: string): Anchor => ({ kind: 'pdf', page: Math.max(0, Number.parseInt(page, 10) || 0), rects: [] });

/** Page saisie (« 47 », « 47-48 », « p. 47 ») → « 47 » / « 47-48 ». */
export function cleanPage(s: string): string {
  return s
    .replace(/^\s*(p\.?|page)\s*/i, '')
    .replace(/\s*[-–]\s*/g, '-')
    .trim()
    .slice(0, 20);
}

/** Ajoute un extrait (texte tapé ou lu sur une photo) au livre papier. */
export function addPaperExtract(bookId: string, x: { text: string; page: string; category?: CategoryId | null; note?: string; photo?: string }): Highlight {
  const page = cleanPage(x.page);
  const note = (x.note ?? '').trim();
  const category = x.category ?? null;
  return useStore.getState().addHighlight({
    bookId,
    category,
    ...(category === null && !note ? { plain: true } : {}),
    text: x.text.trim(),
    note,
    noteKind: null,
    conceptIds: [],
    anchor: paperAnchor(page),
    locationLabel: page ? `p. ${page}` : '',
    printedPage: page,
    ...(x.photo ? { photo: x.photo } : {}),
  });
}

/** Ordre des extraits d'un livre papier : par page, puis par date. */
export function byPage(a: Highlight, b: Highlight): number {
  const pa = Number.parseInt(a.printedPage, 10);
  const pb = Number.parseInt(b.printedPage, 10);
  const na = Number.isFinite(pa) ? pa : Infinity;
  const nb = Number.isFinite(pb) ? pb : Infinity;
  return na - nb || a.createdAt - b.createdAt;
}

// ── Retour depuis la page d'un livre papier : vers la vue d'où l'on vient ──
let paperReturn: Route = { name: 'library' };
useStore.subscribe((s, prev) => {
  if (s.route.name === 'reader' && prev.route.name !== 'reader') paperReturn = prev.route;
});
const RETURN_LABEL: Partial<Record<Route['name'], string>> = {
  home: 'Accueil',
  library: 'Bibliothèque',
  workspace: 'Espace',
  extracts: 'Extraits',
  concepts: 'Concepts',
  inbox: 'Boîte de réception',
  write: 'Écrits',
  plans: 'Plans',
  trash: 'Corbeille',
};
export function paperBackLabel(): string {
  const r = paperReturn;
  if (r.name === 'workspace') {
    const ws = useStore.getState().workspaces.find((w) => w.id === r.workspaceId);
    return ws && ws.name.length <= 22 ? ws.name : 'Espace';
  }
  return RETURN_LABEL[r.name] ?? 'Bibliothèque';
}
export function paperGoBack() {
  const r = paperReturn;
  const ok = r.name !== 'reader' && (r.name !== 'workspace' || useStore.getState().workspaces.some((w) => w.id === r.workspaceId));
  useStore.getState().navigate(ok ? r : { name: 'library' });
}
