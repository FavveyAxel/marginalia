// Panneau « Extraits » du lecteur : filtres par catégorie, recherche, tri, cartes d'extraits.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Copy, Search, Trash2, Waypoints, X } from 'lucide-react';
import { useStore, selectBook } from '../../lib/store';
import { CATEGORIES, CATEGORY_BY_ID, NOTE_KIND_BY_ID } from '../../lib/categories';
import { formatCitation } from '../../lib/citation';
import type { CategoryId, Highlight } from '../../lib/types';
import { copyText, norm } from './util';
import './annotations.css';

type FilterKey = CategoryId | 'note';
type SortKey = 'texte' | 'recents';

/** Clé d'ordre dans le texte : HTML (chapitre, début) ; PDF (page, premier y). */
function textOrder(h: Highlight): [number, number] {
  const a = h.anchor;
  if (a.kind === 'html') return [a.chapter, a.start];
  return [a.page, a.rects.length ? Math.min(...a.rects.map((r) => r.y)) : 0];
}

function locationOf(h: Highlight): string {
  const p = h.printedPage.trim();
  const page = p ? `p. ${p}` : '';
  if (!h.locationLabel) return page;
  if (!page || h.locationLabel === page) return h.locationLabel;
  return `${h.locationLabel} · ${page}`;
}

export function ExtractsPanel({ bookId, onJump }: { bookId: string; onJump(id: string): void }) {
  const book = useStore(selectBook(bookId));
  const highlights = useStore(useShallow((s) => s.highlights.filter((h) => h.bookId === bookId)));
  const concepts = useStore((s) => s.concepts);
  const activeId = useStore((s) => s.activeHighlightId);
  const [filters, setFilters] = useState<Set<FilterKey>>(new Set());
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('texte');
  const listRef = useRef<HTMLDivElement>(null);

  const conceptName = useMemo(() => new Map(concepts.map((c) => [c.id, c.name])), [concepts]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { note: 0 };
    for (const h of highlights) {
      const k = h.category ?? 'note';
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [highlights]);

  const visible = useMemo(() => {
    const q = norm(query.trim());
    const list = highlights.filter((h) => {
      if (filters.size && !filters.has((h.category ?? 'note') as FilterKey)) return false;
      if (!q) return true;
      const hay = norm(
        [h.text, h.note, h.locationLabel, h.printedPage, ...h.conceptIds.map((id) => conceptName.get(id) ?? '')].join(' '),
      );
      return q.split(/\s+/).every((t) => hay.includes(t));
    });
    if (sort === 'recents') return list.sort((a, b) => b.createdAt - a.createdAt);
    return list.sort((a, b) => {
      const [a1, a2] = textOrder(a);
      const [b1, b2] = textOrder(b);
      return a1 - b1 || a2 - b2 || a.createdAt - b.createdAt;
    });
  }, [highlights, filters, query, sort, conceptName]);

  // Carte active : visible dans la liste
  useEffect(() => {
    if (!activeId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-hid="${activeId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId, visible]);

  const toggle = (k: FilterKey) =>
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const copy = async (h: Highlight) => {
    if (!book) return;
    const ok = await copyText(formatCitation(h, book));
    useStore.getState().toast(ok ? 'Citation copiée' : 'Copie impossible', ok ? 'success' : 'error');
  };

  // Corbeille : le store affiche « Extrait placé dans la corbeille · Annuler » (restauration exacte).
  const del = (h: Highlight) => useStore.getState().removeHighlight(h.id);

  const filtered = filters.size > 0 || query.trim() !== '';

  return (
    <div className="ann-panel">
      <div className="ann-head">
        <div className="ann-count">
          {filtered ? (
            <>
              <strong>{visible.length}</strong> sur {highlights.length}
            </>
          ) : (
            <>
              <strong>{highlights.length}</strong> {highlights.length > 1 ? 'extraits' : 'extrait'}
            </>
          )}
        </div>
        <div className="segmented ann-sort" role="group" aria-label="Tri">
          <button className={sort === 'texte' ? 'active' : ''} onClick={() => setSort('texte')} title="Dans l’ordre du texte">
            Texte
          </button>
          <button className={sort === 'recents' ? 'active' : ''} onClick={() => setSort('recents')} title="Les plus récents d’abord">
            Récents
          </button>
        </div>
      </div>

      {highlights.length > 0 && (
        <>
          <div className="ann-chips">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className={`chip ann-chip ${filters.has(c.id) ? 'active' : ''}`}
                onClick={() => toggle(c.id)}
                disabled={!counts[c.id] && !filters.has(c.id)}
                aria-pressed={filters.has(c.id)}
                data-filter={c.id}
              >
                <span className="cat-dot" style={{ background: `var(${c.cssVar})` }} />
                {c.label}
                <span className="ann-chip-n">{counts[c.id] ?? 0}</span>
              </button>
            ))}
            <button
              className={`chip ann-chip ${filters.has('note') ? 'active' : ''}`}
              onClick={() => toggle('note')}
              disabled={!counts.note && !filters.has('note')}
              aria-pressed={filters.has('note')}
              data-filter="note"
            >
              <span className="cat-dot ann-dot-note" />
              Notes
              <span className="ann-chip-n">{counts.note ?? 0}</span>
            </button>
          </div>
          <div className="ann-search">
            <Search size={13} />
            <input
              className="ann-search-input"
              placeholder="Chercher dans les extraits"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && query && (e.stopPropagation(), setQuery(''))}
              aria-label="Chercher dans les extraits"
            />
            {query && (
              <button className="icon-btn sm" onClick={() => setQuery('')} title="Effacer">
                <X size={12} />
              </button>
            )}
          </div>
        </>
      )}

      <div className="ann-list" ref={listRef}>
        {highlights.length === 0 ? (
          <Legend />
        ) : visible.length === 0 ? (
          <div className="ann-none">
            <p>Aucun extrait ne correspond.</p>
            <button
              className="btn btn-sm"
              onClick={() => {
                setFilters(new Set());
                setQuery('');
              }}
            >
              Réinitialiser les filtres
            </button>
          </div>
        ) : (
          visible.map((h) => {
            const cat = h.category ? CATEGORY_BY_ID[h.category] : null;
            const kind = h.noteKind ? NOTE_KIND_BY_ID[h.noteKind] : null;
            const label = cat ? cat.label : kind ? `Note · ${kind.label}` : 'Note';
            const loc = locationOf(h);
            return (
              <div
                key={h.id}
                data-hid={h.id}
                className={`ann-card ${activeId === h.id ? 'active' : ''} ${cat ? '' : 'is-note'}`}
                style={{ ['--c' as string]: cat ? `var(${cat.cssVar})` : 'var(--muted)' }}
                role="button"
                tabIndex={0}
                onClick={() => {
                  useStore.getState().setActiveHighlight(h.id);
                  onJump(h.id);
                }}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    useStore.getState().setActiveHighlight(h.id);
                    onJump(h.id);
                  }
                }}
              >
                <div className="ann-card-top">
                  <span className="ann-card-cat">{label}</span>
                  {loc && <span className="ann-card-loc truncate">{loc}</span>}
                </div>
                <blockquote className="ann-card-text">{h.text}</blockquote>
                {h.note.trim() && (
                  <div className="ann-card-note">
                    {kind && cat && <span className="ann-note-kind">{kind.label}</span>}
                    <span className="ann-card-note-text">{h.note}</span>
                  </div>
                )}
                {h.conceptIds.length > 0 && (
                  <div className="ann-card-concepts">
                    {h.conceptIds.map((id) =>
                      conceptName.has(id) ? (
                        <span key={id} className="ann-concept">
                          {conceptName.get(id)}
                        </span>
                      ) : null,
                    )}
                  </div>
                )}
                <div className="ann-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn sm" title="Ajouter à la carte d’argument" onClick={() => useStore.getState().addHighlightToMap(h.id)}>
                    <Waypoints size={13} />
                  </button>
                  <button className="icon-btn sm" title="Copier la citation" onClick={() => copy(h)}>
                    <Copy size={13} />
                  </button>
                  <button className="icon-btn sm ann-del" title="Supprimer" onClick={() => del(h)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="ann-empty">
      <h3>Aucun extrait pour l’instant</h3>
      <p>Sélectionnez un passage dans le texte, puis choisissez ce qu’il fait dans l’argumentation.</p>
      <ul className="ann-legend">
        {CATEGORIES.map((c) => (
          <li key={c.id}>
            <span className="cat-dot" style={{ background: `var(${c.cssVar})` }} />
            <span className="ann-legend-label">{c.label}</span>
            <span className="ann-legend-desc">{c.description}</span>
            <span className="kbd">{c.key}</span>
          </li>
        ))}
        <li>
          <span className="cat-dot ann-dot-note" />
          <span className="ann-legend-label">Note de marge</span>
          <span className="ann-legend-desc">Votre voix, sans catégorie</span>
          <span className="kbd">N</span>
        </li>
        <li>
          <span className="cat-dot ann-dot-move" />
          <span className="ann-legend-label">Mouvement</span>
          <span className="ann-legend-desc">Début d’un mouvement du texte</span>
          <span className="kbd">M</span>
        </li>
      </ul>
    </div>
  );
}
