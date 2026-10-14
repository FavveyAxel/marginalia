// Petite barre affichée au survol d'une citation liée à un extrait (voir citeLink.ts).
import { BookOpen } from 'lucide-react';
import { useStore } from '../../lib/store';
import { openCitedExtract, type CiteHover } from './citeLink';
import './versions.css';

export function CiteBar({ hover }: { hover: CiteHover }) {
  const h = useStore((s) => s.highlights.find((x) => x.id === hover.highlightId) ?? null);
  const book = useStore((s) => (h ? (s.books.find((b) => b.id === h.bookId) ?? null) : null));
  const top = Math.max(8, hover.rect.top - 38);
  const left = Math.max(8, Math.min(window.innerWidth - 300, hover.rect.left));
  return (
    <div className="ed-citebar anim-fade" style={{ top, left }} role="toolbar" aria-label="Citation liée à un extrait">
      {h && book ? (
        <span className="ed-citebar-book truncate" title={`${book.author ? book.author + ', ' : ''}${book.title}`}>
          {book.title}
        </span>
      ) : (
        <span className="ed-citebar-gone">Extrait supprimé</span>
      )}
      <button className="btn btn-sm" onClick={() => openCitedExtract(hover.highlightId)} title="Ouvrir le livre à cet extrait (⌘-clic sur la citation)" data-act="open-extract">
        <BookOpen size={13} /> Ouvrir l’extrait
      </button>
    </div>
  );
}
