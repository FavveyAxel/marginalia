// Assembler plusieurs photos en un seul document de la bibliothèque (format « image », book.pages).
// Les photos viennent de la Boîte de réception (fichiers reçus) ou de la bibliothèque (photos déjà
// importées, y compris d'autres documents de photos, dont chaque page est reprise). Pour une photo de
// la bibliothèque, le texte déjà reconnu et les extraits suivent la page dans le nouveau document.
import { EMPTY_EDITION, uid, useStore } from '../../lib/store';
import { host } from '../../lib/platform';
import { sniffFile } from '../../lib/sniff';
import type { Book, Highlight } from '../../lib/types';
import { imageThumbnail } from '../reader/image/decode';
import { loadOcr, ocrKey, saveOcr } from '../reader/image/ocr';

/** Une page à assembler : un fichier reçu, ou une page d'une photo de la bibliothèque. */
export interface PhotoSource {
  /** Identifiant stable dans la fenêtre d'assemblage. */
  key: string;
  /** Nom affiché (et extension de secours). */
  name: string;
  read(): Promise<ArrayBuffer>;
  /** Photo de la bibliothèque : livre et page d'origine (texte reconnu et extraits repris). */
  from?: { bookId: string; page: number };
}

const extOf = (n: string) => /\.([a-z0-9]{1,5})$/i.exec(n)?.[1]?.toLowerCase() ?? '';

/** Pages d'un livre image de la bibliothèque (une pour une photo seule). */
export function sourcesOfBook(b: Book): PhotoSource[] {
  const files = b.pages && b.pages.length > 1 ? b.pages : [b.fileName];
  return files.map((f, i) => ({
    key: `${b.id}:${i + 1}`,
    name: files.length > 1 ? `${b.title} — page ${i + 1}` : b.title,
    read: () => host.readFile(b.id, f),
    from: { bookId: b.id, page: i + 1 },
  }));
}

/** Titre proposé : « Photos du 19 octobre » (ou le titre commun des photos de la bibliothèque). */
export function defaultTitle(): string {
  const d = new Date();
  return `Photos du ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
}

/** Libellé de lieu d'un extrait repris sur la page `n` du nouveau document. */
function relabel(h: Highlight, n: number): string {
  const l = h.locationLabel || '';
  return /^zone/i.test(l) ? `Zone, page ${n}` : `Page ${n}`;
}

/**
 * Crée le document (fichiers des pages, couverture, texte reconnu et extraits repris) et l'ajoute à
 * la bibliothèque. Renvoie le livre créé. Ne retire rien : l'appelant décide du sort des originaux.
 */
export async function assemblePhotos(sources: PhotoSource[], title: string, onProgress?: (done: number, total: number) => void): Promise<Book> {
  if (sources.length < 2) throw new Error('Choisissez au moins deux photos.');
  const id = uid();
  const pages: string[] = [];
  let size = 0;
  let cover: string | null = null;
  const copies: Highlight[] = [];
  const st0 = useStore.getState();
  try {
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const data = await src.read();
      const ext = sniffFile(data).ext ?? (extOf(src.name) || 'jpg');
      const file = `page-${i + 1}.${ext}`;
      await host.storeFile(id, file, data);
      pages.push(file);
      size += data.byteLength;
      if (i === 0) cover = await imageThumbnail(data, file).catch(() => null);
      if (src.from) {
        const ocr = await loadOcr(ocrKey(src.from.bookId, src.from.page));
        if (ocr) await saveOcr(ocrKey(id, i + 1), ocr).catch(() => undefined);
        const now = Date.now();
        for (const h of st0.highlights) {
          if (h.bookId !== src.from.bookId || h.anchor.kind !== 'pdf' || (h.anchor.page || 1) !== src.from.page) continue;
          copies.push({ ...h, id: uid(), bookId: id, anchor: { ...h.anchor, page: i + 1 }, locationLabel: relabel(h, i + 1), conceptIds: [...h.conceptIds], updatedAt: now });
        }
      }
      onProgress?.(i + 1, sources.length);
    }
  } catch (e) {
    // Rien d'ajouté à la base : les fichiers déjà écrits sont retirés.
    for (const f of pages) await host.deleteFile(id, f).catch(() => undefined);
    throw e;
  }
  const name = title.trim() || defaultTitle();
  const book: Book = {
    id,
    title: name,
    author: '',
    format: 'image',
    fileName: pages[0],
    originalName: `${name}.${extOf(pages[0]) || 'jpg'}`,
    size,
    addedAt: Date.now(),
    lastOpenedAt: null,
    progress: 0,
    position: null,
    cover,
    edition: { ...EMPTY_EDITION },
    pages,
  };
  useStore.getState().applyExternal((s) => ({ books: [book, ...s.books], highlights: copies.length ? [...copies, ...s.highlights] : s.highlights }), {
    action: 'import',
    kind: 'book',
    refId: id,
    bookId: id,
    title: name,
    summary: `${pages.length} photos assemblées en un document`,
  });
  return book;
}
