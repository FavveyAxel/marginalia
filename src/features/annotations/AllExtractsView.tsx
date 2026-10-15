// Vue « Extraits » : tous les extraits et notes, filtrables, groupés par livre.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, Copy, Highlighter, Search, X } from 'lucide-react';
import { useStore } from '../../lib/store';
import { CATEGORIES, NOTE_KINDS, NOTE_KIND_BY_ID, kindLabel, kindOf, kindColor } from '../../lib/categories';
import { formatCitation } from '../../lib/citation';
import type { Book, CategoryId, Highlight, NoteKind } from '../../lib/types';
import { CategoryDot } from '../../components/ui';
import { byTextOrder, copyText, locationOf, norm, plural } from '../concepts/util';
import './all-extracts.css';

type Sort = 'recent' | 'texte';
const NOTES = 'notes' as const;
const PLAIN = 'plain' as const;
type CatKey = CategoryId | typeof NOTES | typeof PLAIN;
const keyOf = (h: Highlight): CatKey => {
  const k = kindOf(h);
  return k === 'note' ? NOTES : k;
};

const stagger = (i: number) => ({ '--i': i }) as CSSProperties;
/** Texte de recherche normalisé, mémorisé par extrait (objets immuables du store). */
const searchMemo = new WeakMap<Highlight, string>();
const searchText = (h: Highlight) => {
  let v = searchMemo.get(h);
  if (v === undefined) searchMemo.set(h, (v = norm(`${h.text} ${h.note}`)));
  return v;
};
/** Extraits montés d'emblée, puis par tranches au défilement. */
const RENDER_FIRST = 150;
const RENDER_STEP = 300;

export function AllExtractsView() {
  const highlights = useStore((s) => s.highlights);
  const books = useStore((s) => s.books);
  const concepts = useStore((s) => s.concepts);
  const jump = useStore((s) => s.jumpToHighlight);
  const toast = useStore((s) => s.toast);

  const [cats, setCats] = useState<Set<CatKey>>(new Set());
  const [noteKind, setNoteKind] = useState<NoteKind | ''>('');
  const [bookId, setBookId] = useState('');
  const [conceptId, setConceptId] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');

  const bookById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const conceptById = useMemo(() => new Map(concepts.map((c) => [c.id, c])), [concepts]);

  const counts = useMemo(() => {
    const m = new Map<CatKey, number>();
    for (const h of highlights) {
      const k = keyOf(h);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [highlights]);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    const out = highlights.filter((h) => {
      if (cats.size && !cats.has(keyOf(h))) return false;
      if (noteKind && h.noteKind !== noteKind) return false;
      if (bookId && h.bookId !== bookId) return false;
      if (conceptId && !h.conceptIds.includes(conceptId)) return false;
      if (q && !searchText(h).includes(q)) return false;
      return true;
    });
    return out;
  }, [highlights, cats, noteKind, bookId, conceptId, query]);

  const groups = useMemo(() => {
    const m = new Map<string, Highlight[]>();
    for (const h of filtered) {
      const list = m.get(h.bookId);
      if (list) list.push(h);
      else m.set(h.bookId, [h]);
    }
    const arr = [...m.entries()].map(([id, items]) => ({
      id,
      book: bookById.get(id) ?? null,
      items: items.sort(sort === 'recent' ? (a, b) => b.createdAt - a.createdAt : byTextOrder),
      latest: items.reduce((n, h) => Math.max(n, h.createdAt), -Infinity),
      count: items.length,
    }));
    return arr.sort((a, b) =>
      sort === 'recent' ? b.latest - a.latest : (a.book?.title ?? '').localeCompare(b.book?.title ?? '', 'fr', { sensitivity: 'base' }),
    );
  }, [filtered, bookById, sort]);

  // Rendu progressif : des milliers d'extraits montés d'un coup figeaient la vue plusieurs secondes
  // (DOM, styles, animations). On monte les premiers, puis la suite à l'approche du bas de la liste.
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(RENDER_FIRST);
  useEffect(() => setLimit(RENDER_FIRST), [cats, noteKind, bookId, conceptId, query, sort]);
  const truncated = filtered.length > limit;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!truncated || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setLimit((n) => n + RENDER_STEP), {
      root: scrollRef.current,
      rootMargin: '0px 0px 2000px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [truncated, limit]);
  const shown = useMemo(() => {
    if (!truncated) return groups;
    let budget = limit;
    const out: typeof groups = [];
    for (const g of groups) {
      if (budget <= 0) break;
      out.push(g.items.length <= budget ? g : { ...g, items: g.items.slice(0, budget) });
      budget -= g.items.length;
    }
    return out;
  }, [groups, limit, truncated]);

  const toggleCat = (k: CatKey) =>
    setCats((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const hasFilter = cats.size > 0 || !!noteKind || !!bookId || !!conceptId || !!query.trim();
  const reset = () => {
    setCats(new Set());
    setNoteKind('');
    setBookId('');
    setConceptId('');
    setQuery('');
  };

  const copy = async (h: Highlight, book: Book) => {
    const ok = await copyText(formatCitation(h, book));
    toast(ok ? 'Citation copiée' : 'Copie impossible', ok ? 'success' : 'error');
  };

  const usedBooks = useMemo(() => books.filter((b) => highlights.some((h) => h.bookId === b.id)), [books, highlights]);
  const usedConcepts = useMemo(
    () =>
      concepts
        .filter((c) => highlights.some((h) => h.conceptIds.includes(c.id)))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
    [concepts, highlights],
  );

  return (
    <>
      <header className="topbar">
        <span className="spacer" />
      </header>

      <div className="ax-scroll" ref={scrollRef}>
        <div className="ax-page anim-view">
          <h1 className="page-title ax-title">Extraits</h1>

          {highlights.length === 0 ? (
            <div className="empty">
              <Highlighter size={26} />
              <h3>Aucun extrait pour l’instant</h3>
              <p>Sélectionnez un passage dans un livre, puis choisissez sa catégorie : il apparaîtra ici avec sa référence.</p>
              <button className="btn btn-primary" onClick={() => useStore.getState().navigate({ name: 'library' })}>
                <BookOpen size={14} /> Ouvrir la bibliothèque
              </button>
            </div>
          ) : (
            <>
              <div className="ax-filters">
                <div className="ax-chips" role="group" aria-label="Catégories">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.id}
                      className={`chip ${cats.has(c.id) ? 'active' : ''}`}
                      aria-pressed={cats.has(c.id)}
                      onClick={() => toggleCat(c.id)}
                      data-cat={c.id}
                    >
                      <CategoryDot id={c.id} size={8} /> {c.label}
                      <span className="ax-n">{counts.get(c.id) ?? 0}</span>
                    </button>
                  ))}
                  <button
                    className={`chip ${cats.has(PLAIN) ? 'active' : ''}`}
                    aria-pressed={cats.has(PLAIN)}
                    onClick={() => toggleCat(PLAIN)}
                    data-cat="plain"
                    title="Passages simplement surlignés, sans catégorie"
                  >
                    <span className="ax-plaindot" /> Surlignages
                    <span className="ax-n">{counts.get(PLAIN) ?? 0}</span>
                  </button>
                  <button
                    className={`chip ${cats.has(NOTES) ? 'active' : ''}`}
                    aria-pressed={cats.has(NOTES)}
                    onClick={() => toggleCat(NOTES)}
                    data-cat="notes"
                  >
                    <span className="ax-notedot" /> Notes
                    <span className="ax-n">{counts.get(NOTES) ?? 0}</span>
                  </button>
                </div>
                <div className="ax-row">
                  <div className="ax-search">
                    <Search size={14} />
                    <input
                      className="input"
                      placeholder="Un mot, une note…"
                      aria-label="Rechercher dans les extraits"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <select className="input ax-select" aria-label="Type de note" value={noteKind} onChange={(e) => setNoteKind(e.target.value as NoteKind | '')}>
                    <option value="">Toutes mes notes</option>
                    {NOTE_KINDS.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <select className="input ax-select" aria-label="Livre" value={bookId} onChange={(e) => setBookId(e.target.value)}>
                    <option value="">Tous les livres</option>
                    {usedBooks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title}
                      </option>
                    ))}
                  </select>
                  <select className="input ax-select" aria-label="Concept" value={conceptId} onChange={(e) => setConceptId(e.target.value)}>
                    <option value="">Tous les concepts</option>
                    {usedConcepts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <div className="segmented" role="group" aria-label="Tri">
                    <button className={sort === 'recent' ? 'active' : ''} onClick={() => setSort('recent')} data-sort="recent">
                      Récents
                    </button>
                    <button className={sort === 'texte' ? 'active' : ''} onClick={() => setSort('texte')} data-sort="texte">
                      Ordre du texte
                    </button>
                  </div>
                </div>
                <div className="ax-status" aria-live="polite">
                  <span className="muted" data-testid="ax-count">
                    {plural(filtered.length, 'extrait')}
                    {hasFilter ? ` sur ${highlights.length}` : ''}
                  </span>
                  {hasFilter && (
                    <button className="btn btn-sm btn-ghost" onClick={reset}>
                      <X size={12} /> Effacer les filtres
                    </button>
                  )}
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="empty">
                  <Search size={24} />
                  <h3>Aucun extrait ne correspond</h3>
                  <p>Essayez de retirer un filtre ou de chercher un autre mot.</p>
                  <button className="btn" onClick={reset}>
                    Effacer les filtres
                  </button>
                </div>
              ) : (
                shown.map((g) => (
                  <section key={g.id} className="ax-group">
                    <h2 className="ax-book">
                      <BookOpen size={14} />
                      <span className="truncate">{g.book?.title ?? 'Livre supprimé'}</span>
                      {g.book?.author && <span className="muted truncate">{g.book.author}</span>}
                      <span className="spacer" />
                      <span className="ax-n">{g.count}</span>
                    </h2>
                    <ul className="ax-list anim-stagger">
                      {g.items.map((h, i) => {
                        const cat = h.category ? CATEGORIES.find((c) => c.id === h.category) ?? null : null;
                        const plain = kindOf(h) === 'plain';
                        const loc = locationOf(h);
                        return (
                          <li key={h.id} className="ax-item lift" style={stagger(i)} data-highlight-id={h.id}>
                            <button className="ax-main" onClick={() => jump(h.id)} title="Aller à l’extrait dans le livre">
                              <span className="ax-meta">
                                {cat ? <CategoryDot id={cat.id} size={8} /> : <span className={plain ? 'ax-plaindot' : 'ax-notedot'} />}
                                <span>{kindLabel(h)}</span>
                                {loc && <span className="muted">{loc}</span>}
                              </span>
                              {h.text.trim() && (
                                <span className="ax-text" style={cat || plain ? ({ '--ax-c': kindColor(h) } as CSSProperties) : undefined}>
                                  {h.text}
                                </span>
                              )}
                              {h.note.trim() && (
                                <span className="ax-note">
                                  <b>{h.noteKind ? NOTE_KIND_BY_ID[h.noteKind].label : 'Note'}</b>
                                  {h.note}
                                </span>
                              )}
                            </button>
                            <div className={`ax-foot ${!h.conceptIds.length && !(g.book && h.text.trim()) ? 'empty-foot' : !h.conceptIds.length ? 'float-foot' : ''}`}>
                              <span className="ax-concepts">
                                {h.conceptIds.map((id) => conceptById.get(id)).filter(Boolean).map((c) => (
                                  <button
                                    key={c!.id}
                                    className="ax-concept"
                                    onClick={() => useStore.getState().navigate({ name: 'concepts', conceptId: c!.id })}
                                    title="Ouvrir la fiche du concept"
                                  >
                                    {c!.name}
                                  </button>
                                ))}
                              </span>
                              {g.book && h.text.trim() && (
                                <button className="btn btn-sm btn-ghost ax-copy" onClick={() => copy(h, g.book!)} data-action="copy-citation">
                                  <Copy size={12} /> Copier la citation
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))
              )}
              {truncated && <div ref={sentinelRef} className="ax-more" aria-hidden="true" style={{ height: 1 }} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}
