// Liste des cartes existantes : recherche, suspension, édition en ligne, suppression en ligne.
import { useMemo, useState, type CSSProperties } from 'react';
import { Pause, Pencil, Play, Search, Trash2 } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { ReviewCard } from '../../lib/types';
import { isNew } from './queue';
import { formatInterval } from './fsrs';
import { KIND_LABEL, Rich } from './RichText';

const stagger = (i: number) => ({ '--i': i }) as CSSProperties;
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function stateText(c: ReviewCard, now: number): string {
  if (c.suspended) return 'Suspendue';
  if (isNew(c)) return 'Nouvelle';
  if (c.fsrs.due <= now) return 'À revoir';
  return `Dans ${formatInterval(c.fsrs.due - now)}`;
}

export function CardList({ onCreate }: { onCreate: () => void }) {
  const cards = useStore((s) => s.cards);
  const books = useStore((s) => s.books);
  const patch = useStore((s) => s.patch);
  const remove = useStore((s) => s.remove);
  const toast = useStore((s) => s.toast);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<ReviewCard['kind'] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ front: '', back: '' });
  const [confirm, setConfirm] = useState<string | null>(null);
  const now = Date.now();

  const shown = useMemo(() => {
    const n = strip(q.trim());
    return cards
      .filter((c) => (!kind || c.kind === kind) && (!n || strip(c.front + ' ' + c.back).includes(n)))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [cards, q, kind]);

  if (!cards.length)
    return (
      <div className="empty rev-empty anim-in">
        <h3>Aucune carte pour l’instant</h3>
        <p>Créez une carte depuis le menu d’un extrait, depuis une fiche concept ou avec le générateur.</p>
        <button className="btn btn-primary" onClick={onCreate}>
          Créer des cartes
        </button>
      </div>
    );

  const startEdit = (c: ReviewCard) => {
    setEditing(c.id);
    setDraft({ front: c.front, back: c.back });
    setConfirm(null);
  };

  return (
    <section className="rev-list anim-in" aria-label="Toutes les cartes">
      <div className="rev-list-tools">
        <div className="rev-search">
          <Search size={14} />
          <input className="input" placeholder="Rechercher dans les cartes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher dans les cartes" />
        </div>
        <div className="rev-types">
          <button className={`chip ${kind === null ? 'active' : ''}`} onClick={() => setKind(null)}>
            Toutes
          </button>
          {(Object.keys(KIND_LABEL) as ReviewCard['kind'][]).map((k) => (
            <button key={k} className={`chip ${kind === k ? 'active' : ''}`} onClick={() => setKind(kind === k ? null : k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="muted rev-none-text">Aucune carte ne correspond à cette recherche.</p>
      ) : (
        <ul className="rev-cards anim-stagger">
          {shown.map((c, i) => {
            const book = books.find((b) => b.id === c.bookId);
            const isEditing = editing === c.id;
            return (
              <li key={c.id} className={`rev-item ${c.suspended ? 'suspended' : ''}`} style={stagger(i)}>
                {isEditing ? (
                  <div className="rev-edit">
                    <label className="rev-field">
                      <span>Recto</span>
                      <textarea className="textarea" rows={2} value={draft.front} onChange={(e) => setDraft({ ...draft, front: e.target.value })} />
                    </label>
                    <label className="rev-field">
                      <span>Verso</span>
                      <textarea className="textarea" rows={3} value={draft.back} onChange={(e) => setDraft({ ...draft, back: e.target.value })} />
                    </label>
                    <div className="rev-draft-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                        Annuler
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={!draft.front.trim() || !draft.back.trim()}
                        onClick={() => {
                          patch('cards', c.id, { front: draft.front.trim(), back: draft.back.trim() });
                          setEditing(null);
                          toast('Carte modifiée', 'success');
                        }}
                      >
                        Enregistrer
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rev-item-body">
                      <Rich text={c.front} className="rev-item-front" />
                      <div className="rev-item-meta">
                        <span className="rev-kind">{KIND_LABEL[c.kind]}</span>
                        {book && <span className="truncate">{book.title}</span>}
                        <span className="rev-state">{stateText(c, now)}</span>
                      </div>
                    </div>
                    <div className="rev-item-actions">
                      {confirm === c.id ? (
                        <>
                          <span className="muted rev-confirm-q">Supprimer cette carte ?</span>
                          <button className="btn btn-sm btn-danger" onClick={() => { remove('cards', c.id); setConfirm(null); toast('Carte supprimée'); }}>
                            Supprimer
                          </button>
                          <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>
                            Garder
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="icon-btn sm" title="Modifier" aria-label="Modifier la carte" onClick={() => startEdit(c)}>
                            <Pencil size={14} />
                          </button>
                          <button
                            className="icon-btn sm"
                            title={c.suspended ? 'Reprendre' : 'Suspendre'}
                            aria-label={c.suspended ? 'Reprendre la carte' : 'Suspendre la carte'}
                            onClick={() => patch('cards', c.id, { suspended: !c.suspended })}
                          >
                            {c.suspended ? <Play size={14} /> : <Pause size={14} />}
                          </button>
                          <button className="icon-btn sm" title="Supprimer" aria-label="Supprimer la carte" onClick={() => setConfirm(c.id)}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

