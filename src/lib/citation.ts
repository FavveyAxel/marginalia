// Mise en forme des citations (FIGÉ). Style français usuel :
// Prénom Nom, *Titre*, trad. X, Lieu, Éditeur, année, p. N.
import type { Book, Highlight } from './types';

export interface CitationParts {
  /** « René Descartes, Discours de la méthode, GF Flammarion, 2000 » (sans italiques). */
  reference: string;
  /** Même chose en Markdown (titre en *italique*). */
  referenceMd: string;
  /** « p. 42 » ou locationLabel si pas de page imprimée. */
  locator: string;
}

export function referenceParts(book: Book): { md: string; plain: string } {
  const e = book.edition;
  const tail = [e.translator ? `trad. ${e.translator}` : '', e.place, e.publisher, e.year].filter(Boolean);
  const head = [book.author].filter(Boolean);
  const plain = [...head, book.title, ...tail].join(', ');
  const md = [...head, `*${book.title}*`, ...tail].join(', ');
  return { md, plain };
}

export function locatorOf(h: Highlight): string {
  const p = h.printedPage.trim();
  if (p) return /[-–]/.test(p) ? `p. ${p}` : `p. ${p}`;
  return h.locationLabel;
}

export function citationParts(h: Highlight, book: Book): CitationParts {
  const r = referenceParts(book);
  return { reference: r.plain, referenceMd: r.md, locator: locatorOf(h) };
}

/** Citation prête à coller : « texte » (Auteur, *Titre*, éd., p. N). */
export function formatCitation(h: Highlight, book: Book, mode: 'md' | 'plain' = 'plain'): string {
  const c = citationParts(h, book);
  const ref = mode === 'md' ? c.referenceMd : c.reference;
  const text = h.text.replace(/\s+/g, ' ').trim();
  return `« ${text} » (${ref}${c.locator ? `, ${c.locator}` : ''}).`;
}

/** Texte de note de bas de page : Auteur, *Titre*, éd., p. N. */
export function formatFootnote(h: Highlight, book: Book, mode: 'md' | 'plain' = 'plain'): string {
  const c = citationParts(h, book);
  return `${mode === 'md' ? c.referenceMd : c.reference}${c.locator ? `, ${c.locator}` : ''}.`;
}
