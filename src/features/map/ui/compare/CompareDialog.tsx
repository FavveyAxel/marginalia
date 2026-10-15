// 13. Dialogue « Comparer deux auteurs » : choix des deux livres (le premier peut être imposé : carte
// d'un livre), aperçu de ce qui sera posé dans chaque colonne, création de la carte libre.
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowRight, GitCompareArrows, Search } from 'lucide-react';
import { useStore } from '../../../../lib/store';
import { fmtKeys } from '../../../../lib/keys';
import type { Book } from '../../../../lib/types';
import { BookCover } from '../../../library/BookCover';
import { Modal } from '../../../workspaces/wsUi';
import { bookShortName } from '../../ArgumentMapView';
import { compareBooks, compareExtracts } from './compare';
import './compare.css';

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function summary(bookId: string): string {
  const { theses, args, fallback } = compareExtracts(bookId);
  if (!theses.length && !args.length) return 'Aucune thèse ni aucun argument classé';
  if (fallback) return `${plural(theses.length, 'problème', 'problèmes')}, ${plural(args.length, 'thèse adverse', 'thèses adverses')}`;
  return `${plural(theses.length, 'thèse', 'thèses')}, ${plural(args.length, 'argument', 'arguments')}`;
}

function BookList({ value, exclude, onPick, prefer }: { value: string | null; exclude: string | null; onPick(id: string): void; prefer?: string[] }) {
  const books = useStore(useShallow((s) => s.books));
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const nq = fold(q.trim());
    const pref = new Set(prefer ?? []);
    return [...books]
      .filter((b) => b.id !== exclude && (!nq || fold(`${b.title} ${b.author}`).includes(nq)))
      .sort((a, b) => Number(pref.has(b.id)) - Number(pref.has(a.id)) || (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
      .slice(0, 50);
  }, [books, q, exclude, prefer]);
  return (
    <div className="cmp-list">
      <label className="cmp-search">
        <Search size={13} />
        <input className="input" placeholder="Rechercher un livre ou un auteur" aria-label="Rechercher un livre" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </label>
      <div className="cmp-items" role="listbox">
        {list.map((b) => (
          <button key={b.id} role="option" aria-selected={b.id === value} className={`cmp-item ${b.id === value ? 'on' : ''}`} data-book={b.id} onClick={() => onPick(b.id)}>
            <BookCover book={b} size="xs" />
            <span className="cmp-item-text">
              <span className="truncate cmp-item-title">{b.title}</span>
              <span className="truncate cmp-item-sub">{b.author || '—'} · {summary(b.id)}</span>
            </span>
          </button>
        ))}
        {list.length === 0 && <p className="cmp-none">Aucun livre trouvé.</p>}
      </div>
    </div>
  );
}

function Side({ book, label }: { book: Book | undefined; label: string }) {
  return (
    <div className={`cmp-side ${book ? '' : 'empty'}`}>
      <span className="cmp-side-label">{label}</span>
      {book ? (
        <>
          <b className="truncate">{bookShortName(book) || book.title}</b>
          <span className="truncate">{book.title}</span>
          <small>{summary(book.id)}</small>
        </>
      ) : (
        <span className="cmp-side-hint">Choisissez un livre</span>
      )}
    </div>
  );
}

export function CompareDialog({
  firstId,
  prefer,
  into,
  onClose,
}: {
  /** Livre imposé (carte d'un livre) ; absent : les deux sont à choisir (espace). */
  firstId?: string | null;
  /** Livres proposés en premier (ceux de l'espace). */
  prefer?: string[];
  into?: { workspaceId: string; groupId: string | null } | null;
  onClose(): void;
}) {
  const books = useStore(useShallow((s) => s.books));
  const [a, setA] = useState<string | null>(firstId ?? null);
  const [b, setB] = useState<string | null>(null);
  const [slot, setSlot] = useState<'a' | 'b'>(firstId ? 'b' : 'a');
  const A = books.find((x) => x.id === a);
  const B = books.find((x) => x.id === b);
  const ws = useStore((s) => (into ? s.workspaces.find((w) => w.id === into.workspaceId) : undefined));
  const create = () => {
    if (!a || !b) return;
    const key = compareBooks(a, b, into);
    if (!key) return;
    onClose();
    const s = useStore.getState();
    s.navigate({ name: 'board', boardId: key });
    s.toast('Carte de comparaison créée : reliez les thèses opposées (« s’oppose à »)', 'success');
  };
  return (
    <Modal title="Comparer deux auteurs" onClose={onClose} wide>
      <div className="cmp-dialog" data-testid="compare-dialog">
        <header className="cmp-head">
          <GitCompareArrows size={18} />
          <div>
            <h3>Comparer deux auteurs</h3>
            <p>Une carte libre avec les thèses et les arguments des deux livres, une colonne par livre, prête à relier par « s’oppose à ».</p>
          </div>
        </header>
        <div className="cmp-pair">
          <button className={`cmp-slot ${slot === 'a' ? 'on' : ''}`} onClick={() => !firstId && setSlot('a')} disabled={!!firstId}>
            <Side book={A} label="Colonne 1" />
          </button>
          <ArrowRight size={16} className="cmp-vs" />
          <button className={`cmp-slot ${slot === 'b' ? 'on' : ''}`} onClick={() => setSlot('b')}>
            <Side book={B} label="Colonne 2" />
          </button>
        </div>
        <BookList
          key={slot}
          value={slot === 'a' ? a : b}
          exclude={slot === 'a' ? b : a}
          prefer={prefer}
          onPick={(id) => {
            if (slot === 'a') {
              setA(id);
              if (!b) setSlot('b');
            } else {
              setB(id);
              if (!a) setSlot('a');
            }
          }}
        />
        <footer className="cmp-foot">
          <span className="muted">{ws ? `La carte sera rangée dans « ${ws.name} ».` : fmtKeys('La carte se retrouve avec ⌘K.')}</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" disabled={!a || !b} onClick={create} data-testid="compare-create">
            Créer la carte {A && B ? `« ${bookShortName(A)} / ${bookShortName(B)} »` : ''}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
