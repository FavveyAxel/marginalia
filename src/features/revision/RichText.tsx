// Mise en forme minimale des cartes : **gras**, *italique*, [...] (trou), paragraphes.
import { Fragment, type ReactNode } from 'react';
import { citationParts, referenceParts } from '../../lib/citation';
import type { Book, Highlight, ReviewCard } from '../../lib/types';

export const BLANK = '[…]';

const TOKEN = /(\*\*[^*]+\*\*|\*[^*]+\*|\[…\])/g;

function inline(s: string): ReactNode[] {
  return s.split(TOKEN).map((part, i) => {
    if (part === BLANK) return <span key={i} className="rev-blank" aria-label="mot masqué" />;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Rich({ text, className }: { text: string; className?: string }) {
  const paras = text.trim().split(/\n{2,}/);
  return (
    <div className={className}>
      {paras.map((p, i) => (
        <p key={i}>
          {p.split('\n').map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {inline(line)}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

export const KIND_LABEL: Record<ReviewCard['kind'], string> = {
  definition: 'Définition',
  these: 'Thèse',
  trous: 'Texte à trous',
  citation: 'Citation',
  libre: 'Libre',
};

/** Source d'une carte, en Markdown (référence selon `citation.ts`) ; null si aucune. */
export function sourceOf(
  card: ReviewCard,
  books: Book[],
  highlights: Highlight[],
): { md: string; highlightId: string | null } | null {
  const h = card.highlightId ? highlights.find((x) => x.id === card.highlightId) : undefined;
  const book = books.find((b) => b.id === (h?.bookId ?? card.bookId));
  if (!book) return null;
  if (h) {
    const c = citationParts(h, book);
    return { md: `${c.referenceMd}${c.locator ? `, ${c.locator}` : ''}`, highlightId: h.id };
  }
  return { md: referenceParts(book).md, highlightId: null };
}
