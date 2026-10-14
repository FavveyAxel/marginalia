// Panneau droit de l'éditeur de plan : extraits, concepts, arguments à glisser dans les parties.
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { GripVertical, Plus, Search } from 'lucide-react';
import { useStore } from '../../lib/store';
import { CategoryDot } from '../../components/ui';
import { RES_MIME, type ResRef } from './dnd';

type Tab = 'highlight' | 'concept' | 'argument';
const TABS: { id: Tab; label: string }[] = [
  { id: 'highlight', label: 'Extraits' },
  { id: 'concept', label: 'Concepts' },
  { id: 'argument', label: 'Arguments' },
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function ResourcePanel({
  placed,
  targetLabel,
  onAdd,
}: {
  /** Nombre de placements par id, par type. */
  placed: Record<Tab, Map<string, number>>;
  /** Libellé de la partie qui reçoit le « + » (null : aucune partie). */
  targetLabel: string | null;
  onAdd(ref: ResRef): void;
}) {
  const [tab, setTab] = useState<Tab>('highlight');
  const [q, setQ] = useState('');
  const [bookId, setBookId] = useState('');
  const books = useStore(useShallow((s) => s.books));
  const highlights = useStore(useShallow((s) => s.highlights));
  const concepts = useStore(useShallow((s) => s.concepts));
  const args = useStore(useShallow((s) => s.arguments));

  const bookName = (id: string | null) => books.find((b) => b.id === id)?.title ?? '';
  const needle = norm(q.trim());

  const rows = useMemo(() => {
    if (tab === 'highlight') {
      return highlights
        .filter((h) => h.category !== null || h.text.trim())
        .filter((h) => !bookId || h.bookId === bookId)
        .filter((h) => !needle || norm(`${h.text} ${h.note}`).includes(needle))
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((h) => ({
          ref: { kind: 'highlight', id: h.id } as ResRef,
          title: h.text.replace(/\s+/g, ' ').trim(),
          meta: [bookName(h.bookId), h.printedPage ? `p. ${h.printedPage}` : h.locationLabel].filter(Boolean).join(' · '),
          cat: h.category,
        }));
    }
    if (tab === 'concept') {
      return concepts
        .filter((c) => !needle || norm(`${c.name} ${c.definition}`).includes(needle))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        .map((c) => ({
          ref: { kind: 'concept', id: c.id } as ResRef,
          title: c.name,
          meta: c.definition.replace(/\s+/g, ' ').trim().slice(0, 90),
          cat: null,
        }));
    }
    return args
      .filter((a) => !bookId || a.bookId === bookId)
      .filter((a) => !needle || norm(`${a.title} ${a.conclusion.text}`).includes(needle))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((a) => ({
        ref: { kind: 'argument', id: a.id } as ResRef,
        title: a.title || 'Argument sans titre',
        meta: a.conclusion.text.replace(/\s+/g, ' ').trim().slice(0, 90),
        cat: null,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, highlights, concepts, args, needle, bookId, books]);

  const counts: Record<Tab, number> = { highlight: highlights.length, concept: concepts.length, argument: args.length };
  const emptyAll = counts[tab] === 0;
  const noun = tab === 'highlight' ? 'extrait' : tab === 'concept' ? 'concept' : 'argument';

  return (
    <aside className="plan-res anim-slide" aria-label="Ressources">
      <div className="plan-res-head">
        <div className="segmented plan-res-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
              data-tab={t.id}
            >
              {t.label}
              <span className="plan-res-n">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <div className="plan-search plan-res-search">
          <Search size={14} />
          <input
            className="plan-search-input"
            placeholder={`Rechercher un ${noun}`}
            aria-label={`Rechercher un ${noun}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {tab !== 'concept' && books.length > 1 && (
          <select
            className="plan-res-book"
            value={bookId}
            onChange={(e) => setBookId(e.target.value)}
            aria-label="Filtrer par livre"
          >
            <option value="">Tous les livres</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        )}
        <p className="plan-res-hint">
          {targetLabel ? (
            <>
              Glissez vers une partie, ou cliquez sur + (partie visée : <b>{targetLabel}</b>)
            </>
          ) : (
            'Ajoutez d’abord une partie, puis glissez-y vos éléments.'
          )}
        </p>
      </div>
      <div className="plan-res-list" data-testid="res-list">
        {emptyAll ? (
          <div className="plan-res-empty">
            <b>Aucun {noun} pour l’instant</b>
            <span>
              {tab === 'highlight'
                ? 'Surlignez un passage dans un livre : il apparaîtra ici.'
                : tab === 'concept'
                  ? 'Créez un concept depuis la vue Concepts : il apparaîtra ici.'
                  : 'Reconstruisez un argument depuis la vue Arguments : il apparaîtra ici.'}
            </span>
          </div>
        ) : rows.length === 0 ? (
          <div className="plan-res-empty">
            <b>Aucun résultat</b>
            <span>Essayez un autre mot, ou retirez le filtre de livre.</span>
          </div>
        ) : (
          rows.map((r) => {
            const n = placed[tab].get((r.ref as { id: string }).id) ?? 0;
            return (
              <div
                key={(r.ref as { id: string }).id}
                className="plan-res-item"
                draggable
                data-rid={(r.ref as { id: string }).id}
                onDragStart={(e) => {
                  e.dataTransfer.setData(RES_MIME, JSON.stringify(r.ref));
                  e.dataTransfer.setData('text/plain', r.title);
                  e.dataTransfer.effectAllowed = 'copy';
                  document.body.classList.add('plan-dragging');
                }}
                onDragEnd={() => document.body.classList.remove('plan-dragging')}
              >
                <GripVertical size={13} className="plan-grip" />
                <div className="plan-res-body">
                  <div className={`plan-res-title${tab === 'highlight' ? ' read' : ''}`}>
                    {r.cat && <CategoryDot id={r.cat} size={7} />}
                    <span>{r.title}</span>
                  </div>
                  {r.meta && <div className="plan-res-meta truncate">{r.meta}</div>}
                </div>
                {n > 0 && (
                  <span className="plan-res-placed" title={`Déjà placé ${n} fois`}>
                    placé
                  </span>
                )}
                <button
                  className="icon-btn sm plan-res-add"
                  aria-label={targetLabel ? `Ajouter à ${targetLabel}` : 'Ajouter à une partie'}
                  title={targetLabel ? `Ajouter à ${targetLabel}` : 'Créez d’abord une partie'}
                  disabled={!targetLabel}
                  onClick={() => onAdd(r.ref)}
                >
                  <Plus size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
