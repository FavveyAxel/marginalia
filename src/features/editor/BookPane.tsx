// Panneau de l'éditeur, contenu « Livre » : le vrai lecteur (HtmlReader / PdfReader / ImageReader)
// en mode compact, via le volet du lecteur (ReaderPane) : défilement, sommaire, position mémorisée,
// surlignage, et « Citer dans l'écrit » sur une sélection.
//
// Performance : ce module est chargé et monté à la demande (React.lazy). Le volet de lecture est
// mémoïsé et reçoit des rappels stables ; l'état qui change en lisant (chapitre, progression)
// reste ici, l'éditeur n'est jamais re-rendu par le défilement du livre.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowLeftRight, ListTree, NotebookPen, Search, X } from 'lucide-react';
import { useStore, selectBook } from '../../lib/store';
import type { Book, Highlight, TocItem } from '../../lib/types';
import type { EngineHandle, NewHighlightInput } from '../reader/engine';
import { ReaderPane } from '../reader/ReaderView';
import { TocPanel } from '../reader/TocPanel';
import { StudyPanel } from '../study/StudyPanel';
import { HighlightPopover } from '../annotations/HighlightPopover';
import { BookCover } from '../library/BookCover';
import '../reader/reader.css';

const norm = (x: string) => x.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Catégorie donnée à un extrait créé par « Citer » (modifiable ensuite depuis l'extrait). */
const CITE_CATEGORY = 'argument' as const;

interface PaneState {
  toc: TocItem[];
  label: string;
  progress: number;
  ready: boolean;
}

/** Choix d'un livre : recherche rapide, livres récemment ouverts en premier. */
export function BookPicker({ currentId, onPick, onCancel }: { currentId: string | null; onPick(id: string): void; onCancel?: () => void }) {
  const books = useStore(useShallow((s) => s.books));
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const list = useMemo(() => {
    const nq = norm(q.trim());
    return [...books]
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.addedAt - a.addedAt)
      .filter((b) => !nq || norm(`${b.title} ${b.author}`).includes(nq))
      .slice(0, 60);
  }, [books, q]);
  useEffect(() => setCursor(0), [q]);
  return (
    <div className="ed-bookpick" role="dialog" aria-label="Choisir un livre">
      <div className="ed-bookpick-head">
        <label className="ed-search">
          <Search size={14} />
          <input
            className="input"
            autoFocus
            placeholder="Rechercher un livre"
            aria-label="Rechercher un livre"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(list.length - 1, c + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === 'Enter' && list[cursor]) onPick(list[cursor].id);
              else if (e.key === 'Escape' && onCancel) onCancel();
            }}
          />
        </label>
        {onCancel && (
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            Annuler
          </button>
        )}
      </div>
      <div className="ed-bookpick-list">
        {books.length === 0 ? (
          <div className="ed-extracts-empty">
            <strong>Bibliothèque vide</strong>
            <span>Importez un livre dans la Bibliothèque pour le lire ici, à côté de votre écrit.</span>
          </div>
        ) : list.length === 0 ? (
          <div className="ed-extracts-empty">
            <strong>Aucun livre trouvé</strong>
            <span>Essayez le titre ou le nom de l’auteur.</span>
          </div>
        ) : (
          <>
            {!q && <div className="ed-bookpick-label">Récents</div>}
            {list.map((b, i) => (
              <button
                key={b.id}
                className={`ed-bookpick-item ${i === cursor ? 'is-cursor' : ''} ${b.id === currentId ? 'is-current' : ''}`}
                data-book={b.id}
                onMouseEnter={() => setCursor(i)}
                onClick={() => onPick(b.id)}
              >
                <BookCover book={b} size="xs" />
                <span className="ed-bookpick-text">
                  <span className="truncate ed-bookpick-title">{b.title}</span>
                  <span className="truncate ed-bookpick-author">
                    {b.author || '—'}
                    {b.progress > 0.005 ? ` · ${Math.round(b.progress * 100)} %` : ''}
                  </span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** En-tête compact : titre, sommaire, fiche-texte, changer de livre. Re-rendu seul quand le livre change. */
const BookHead = memo(function BookHead({
  bookId,
  label,
  progress,
  tocOpen,
  studyOpen,
  onToc,
  onStudy,
  onChange,
}: {
  bookId: string;
  label: string;
  progress: number;
  tocOpen: boolean;
  studyOpen: boolean;
  onToc(): void;
  onStudy(): void;
  onChange(): void;
}) {
  const book = useStore(useShallow((s) => {
    const b = selectBook(bookId)(s);
    return b ? { id: b.id, title: b.title, author: b.author, cover: b.cover, format: b.format } : null;
  }));
  if (!book) return null;
  return (
    <div className="ed-book-head">
      <button className="ed-book-title" onClick={onChange} title="Changer de livre" aria-label={`Changer de livre (actuel : ${book.title})`}>
        <BookCover book={book as Book} size="xs" />
        <span className="ed-book-title-text">
          <span className="truncate ed-book-title-main">{book.title}</span>
          <span className="truncate ed-book-title-sub">{label || book.author || ' '}</span>
        </span>
        <ArrowLeftRight size={13} className="ed-book-swap" />
      </button>
      {book.format !== 'image' && (
        <button className={`icon-btn sm ${tocOpen ? 'active' : ''}`} onClick={onToc} title="Sommaire" aria-label="Sommaire" aria-pressed={tocOpen}>
          <ListTree size={15} />
        </button>
      )}
      <button className={`icon-btn sm ${studyOpen ? 'active' : ''}`} onClick={onStudy} title="Fiche-texte" aria-label="Fiche-texte" aria-pressed={studyOpen}>
        <NotebookPen size={15} />
      </button>
      <span className="ed-book-progress" aria-hidden style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }} />
    </div>
  );
});

export default function BookPane({
  bookId,
  onPickBook,
  onCite,
}: {
  bookId: string | null;
  onPickBook(id: string): void;
  /** Insère la citation de l'extrait au curseur de l'écrit ; renvoie false si impossible. */
  onCite(h: Highlight, b: Book): boolean;
}) {
  const exists = useStore((s) => !!bookId && s.books.some((b) => b.id === bookId));
  const [picking, setPicking] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [studyOpen, setStudyOpen] = useState(false);
  const [popover, setPopover] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [pane, setPane] = useState<PaneState>({ toc: [], label: '', progress: 0, ready: false });
  const engineRef = useRef<EngineHandle | null>(null);
  const onCiteRef = useRef(onCite);
  onCiteRef.current = onCite;

  // Nouveau livre : état du volet remis à zéro.
  useEffect(() => {
    setPane({ toc: [], label: '', progress: selectBook(bookId)(useStore.getState())?.progress ?? 0, ready: false });
    setPopover(null);
    setTocOpen(false);
    setStudyOpen(false);
  }, [bookId]);

  // Pas de nouvel état si rien ne change (le moteur remonte souvent la même position).
  const onState = useCallback(
    (p: Partial<PaneState>) =>
      setPane((cur) => ((Object.keys(p) as (keyof PaneState)[]).every((k) => Object.is(cur[k], p[k])) ? cur : { ...cur, ...p })),
    [],
  );
  const noop = useCallback(() => undefined, []);

  /** « Citer dans l'écrit » : crée l'extrait (comme le lecteur), puis le cite au curseur. */
  const cite = useCallback(
    (input: NewHighlightInput) => {
      const s = useStore.getState();
      const b = s.books.find((x) => x.id === bookId);
      if (!b || !bookId) return;
      const h = s.addHighlight({ ...input, category: input.category ?? CITE_CATEGORY, bookId });
      const ok = onCiteRef.current(h, b);
      if (ok) {
        s.toast('Citation insérée, extrait créé', 'success', {
          label: 'Classer',
          run: () => {
            const rect = engineRef.current?.getHighlightRect(h.id);
            if (rect) {
              useStore.getState().setActiveHighlight(h.id);
              setPopover({ id: h.id, rect });
            }
          },
        });
      } else s.toast('Extrait créé. Placez le curseur dans l’écrit pour l’y citer.', 'info');
    },
    [bookId],
  );

  const onTocSelect = useCallback((item: TocItem) => {
    engineRef.current?.goTo(item.target);
    setTocOpen(false);
  }, []);
  const onStudyGoTo = useCallback((anchor: Highlight['anchor']) => {
    setStudyOpen(false);
    engineRef.current?.goToAnchor(anchor);
  }, []);

  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPopover(null);
        useStore.getState().setActiveHighlight(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popover]);

  if (!bookId || !exists) {
    return (
      <div className="ed-book">
        <BookPicker currentId={null} onPick={onPickBook} />
      </div>
    );
  }

  return (
    <div className="ed-book" data-book={bookId}>
      <BookHead
        bookId={bookId}
        label={pane.label}
        progress={pane.progress}
        tocOpen={tocOpen}
        studyOpen={studyOpen}
        onToc={() => {
          setTocOpen((v) => !v);
          setStudyOpen(false);
        }}
        onStudy={() => {
          setStudyOpen((v) => !v);
          setTocOpen(false);
        }}
        onChange={() => setPicking(true)}
      />
      <div className="ed-book-body">
        <ReaderPane
          key={bookId}
          paneKey="a"
          bookId={bookId}
          focused
          onFocus={noop}
          engineRef={engineRef}
          onState={onState}
          onPopover={setPopover}
          split={false}
          onCite={cite}
        />
        {tocOpen && (
          <div className="ed-book-overlay ed-book-toc anim-fade">
            <TocPanel items={pane.toc} currentLabel={pane.label} progress={pane.progress} onSelect={onTocSelect} />
          </div>
        )}
        {studyOpen && (
          <div className="ed-book-overlay ed-book-study anim-fade">
            <div className="ed-book-overlay-head">
              <span>Fiche-texte</span>
              <button className="icon-btn sm" onClick={() => setStudyOpen(false)} aria-label="Fermer la fiche-texte">
                <X size={14} />
              </button>
            </div>
            <StudyPanel bookId={bookId} onGoTo={onStudyGoTo} />
          </div>
        )}
        {picking && (
          <div className="ed-book-overlay anim-fade">
            <BookPicker
              currentId={bookId}
              onCancel={() => setPicking(false)}
              onPick={(id) => {
                setPicking(false);
                if (id !== bookId) onPickBook(id);
              }}
            />
          </div>
        )}
      </div>
      {popover && (
        <HighlightPopover
          key={popover.id}
          highlightId={popover.id}
          rect={popover.rect}
          onClose={() => {
            setPopover(null);
            useStore.getState().setActiveHighlight(null);
          }}
        />
      )}
    </div>
  );
}

