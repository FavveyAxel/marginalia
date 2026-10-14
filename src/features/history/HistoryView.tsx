// Vue « Historique » : journal d'activité de toute l'app, jour par jour.
import { useMemo, useState, type CSSProperties } from 'react';
import { History, RotateCcw, X } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { ActivityAction, ActivityEntry, ActivityKind } from '../../lib/types';
import { KIND_LABEL, KIND_PLURAL, TRASHABLE } from './describe';
import { groupByDay, timeLabel } from './dates';
import { KindIcon } from './icons';
import { openTarget, targetExists } from './open';
import './history.css';
import { fmtKeys } from '../../lib/keys';

type ActionFilter = '' | 'create' | 'update' | 'delete' | 'restore' | 'io';
const ACTION_FILTERS: { id: ActionFilter; label: string }[] = [
  { id: '', label: 'Tout' },
  { id: 'create', label: 'Créations' },
  { id: 'update', label: 'Modifications' },
  { id: 'delete', label: 'Suppressions' },
  { id: 'restore', label: 'Restaurations' },
  { id: 'io', label: 'Imports et exports' },
];
const matchAction = (f: ActionFilter, a: ActivityAction) =>
  !f || (f === 'io' ? a === 'import' || a === 'export' : f === 'delete' ? a === 'delete' || a === 'purge' : f === 'update' ? a === 'update' || a === 'revert' : a === f);

const FEMININE = new Set<ActivityKind>(['study', 'card', 'map']);
const PAST: Record<ActivityAction, string> = {
  create: 'créé',
  update: 'modifié',
  delete: 'supprimé',
  restore: 'restauré',
  import: 'importé',
  export: 'exporté',
  revert: 'remis à l’état d’avant',
  purge: 'supprimé définitivement',
};
function actionLine(e: ActivityEntry): string {
  if (e.action === 'export' && e.kind === 'file') return 'Export';
  if (e.action === 'purge' && e.kind === 'file') return 'Suppression définitive';
  if (e.action === 'revert') return `${KIND_LABEL[e.kind]} : retour en arrière`;
  if (e.kind === 'wsItem') return e.action === 'create' ? 'Ajout à un espace' : e.action === 'delete' ? 'Retrait d’un espace' : 'Rangement dans un espace';
  const many = !!e.refIds && e.refIds.length > 1;
  const fem = FEMININE.has(e.kind);
  const kind = many ? KIND_PLURAL[e.kind] : KIND_LABEL[e.kind].toLowerCase();
  // Accord du participe : « carte créée », « extraits ajoutés ».
  const past = PAST[e.action].replace(/^(\S+)/, (w) => w + (fem && w.endsWith('é') ? 'e' : '') + (many ? 's' : ''));
  const label = `${kind} ${past}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const PAGE = 150;

export function HistoryView() {
  const activity = useStore((s) => s.activity);
  const books = useStore((s) => s.books);
  const trash = useStore((s) => s.trash);
  // Re-rendre quand les données changent (existence des objets, réversibilité).
  useStore((s) => s.highlights.length + s.concepts.length + s.drafts.length + s.plans.length + s.arguments.length + s.cards.length + s.studies.length + s.groups.length + s.workspaces.length + s.wsItems.length);
  const [action, setAction] = useState<ActionFilter>('');
  const [kind, setKind] = useState<ActivityKind | ''>('');
  const [bookId, setBookId] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const kinds = useMemo(() => [...new Set(activity.map((e) => e.kind))].sort((a, b) => KIND_LABEL[a].localeCompare(KIND_LABEL[b], 'fr')), [activity]);
  const usedBooks = useMemo(() => {
    const ids = new Set(activity.map((e) => e.bookId).filter(Boolean) as string[]);
    return [...ids]
      .map((id) => ({ id, title: books.find((b) => b.id === id)?.title ?? activity.find((e) => e.kind === 'book' && e.refId === id)?.title ?? 'Livre supprimé' }))
      .sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
  }, [activity, books]);

  const filtered = useMemo(
    () => activity.filter((e) => matchAction(action, e.action) && (!kind || e.kind === kind) && (!bookId || e.bookId === bookId)).sort((a, b) => b.at - a.at),
    [activity, action, kind, bookId],
  );
  const days = useMemo(() => groupByDay(filtered.slice(0, limit), (e) => e.at), [filtered, limit]);
  const hasFilter = !!action || !!kind || !!bookId;
  const reset = () => {
    setAction('');
    setKind('');
    setBookId('');
  };

  let i = 0;
  return (
    <>
      <header className="topbar">
        <span className="spacer" />
      </header>
      <div className="hi-scroll">
        <div className="hi-page anim-view">
          <div className="hi-head">
            <h1 className="page-title">Historique</h1>
            <p className="hi-lede">
              Ce que vous avez créé, modifié, supprimé ou exporté, jour par jour. Hors d’un champ de texte, <span className="kbd">{fmtKeys('⌘Z')}</span> annule la dernière action et{' '}
              <span className="kbd">{fmtKeys('⇧⌘Z')}</span> la rétablit.
            </p>
          </div>

          {activity.length === 0 ? (
            <div className="empty">
              <History size={26} />
              <h3>Aucune activité pour l’instant</h3>
              <p>Vos créations, modifications, suppressions et exports s’afficheront ici, jour par jour.</p>
              <button className="btn" onClick={() => useStore.getState().navigate({ name: 'library' })}>
                Ouvrir la bibliothèque
              </button>
            </div>
          ) : (
            <>
              <div className="hi-filters">
                <div className="segmented hi-seg" role="group" aria-label="Action">
                  {ACTION_FILTERS.map((f) => (
                    <button key={f.id || 'all'} className={action === f.id ? 'active' : ''} aria-pressed={action === f.id} onClick={() => setAction(f.id)}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="hi-row">
                  <select className="input hi-select" aria-label="Type d’objet" value={kind} onChange={(e) => setKind(e.target.value as ActivityKind | '')}>
                    <option value="">Tous les types</option>
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <select className="input hi-select" aria-label="Livre" value={bookId} onChange={(e) => setBookId(e.target.value)}>
                    <option value="">Tous les livres</option>
                    {usedBooks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title}
                      </option>
                    ))}
                  </select>
                  <span className="hi-count muted" aria-live="polite">
                    {filtered.length} entrée{filtered.length > 1 ? 's' : ''}
                    {hasFilter ? ` sur ${activity.length}` : ''}
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
                  <h3>Rien pour ces filtres</h3>
                  <p>Aucune entrée ne correspond à cette combinaison d’action, de type et de livre.</p>
                  <button className="btn" onClick={reset}>
                    Effacer les filtres
                  </button>
                </div>
              ) : (
                days.map((d) => (
                  <section key={d.key} className="hi-day" aria-label={d.label}>
                    <h2 className="hi-day-title">{d.label}</h2>
                    <ol className="hi-list anim-stagger">
                      {d.items.map((e) => (
                        <HistoryItem key={e.id} e={e} index={i++} inTrash={!!e.trashId && trash.some((t) => t.id === e.trashId)} />
                      ))}
                    </ol>
                  </section>
                ))
              )}
              {filtered.length > limit && (
                <button className="btn hi-more" onClick={() => setLimit((n) => n + PAGE)}>
                  Afficher les entrées plus anciennes
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function canRevert(e: ActivityEntry, inTrash: boolean): boolean {
  if (e.action === 'delete' && e.trashId) return inTrash;
  if ((e.action === 'create' || e.action === 'import' || e.action === 'restore') && TRASHABLE.has(e.kind) && !e.changes)
    return (e.refIds ?? (e.refId ? [e.refId] : [])).some((id) => targetExists(e.kind, id, e.bookId));
  if (e.action === 'update' || e.action === 'revert' || (e.action === 'create' && e.changes) || (e.action === 'delete' && e.changes)) return !!e.changes?.length;
  return false;
}

function HistoryItem({ e, index, inTrash }: { e: ActivityEntry; index: number; inTrash: boolean }) {
  const exists = targetExists(e.kind, e.refId, e.bookId);
  const reversible = canRevert(e, inTrash);
  const open = () => {
    if (openTarget(e.kind, e.refId, e.bookId)) return;
    if (inTrash) useStore.getState().navigate({ name: 'trash' });
  };
  const clickable = exists || inTrash;
  return (
    <li className={`hi-item act-${e.action}`} style={{ '--i': index } as CSSProperties} data-act={e.action} data-kind={e.kind}>
      <time className="hi-time" dateTime={new Date(e.at).toISOString()}>
        {timeLabel(e.at)}
      </time>
      <span className="hi-dot" aria-hidden />
      <div className="hi-body">
        <div className="hi-what">
          <KindIcon kind={e.kind} size={12} /> {actionLine(e)}
        </div>
        {clickable ? (
          <button className={`hi-title ${e.kind === 'highlight' ? 'quote' : ''}`} onClick={open} title={exists ? 'Ouvrir' : 'Voir dans la corbeille'}>
            {e.kind === 'highlight' && !(e.refIds && e.refIds.length > 1) ? `« ${e.title} »` : e.title}
          </button>
        ) : (
          <span className={`hi-title static ${e.kind === 'highlight' ? 'quote' : ''}`}>{e.kind === 'highlight' && !(e.refIds && e.refIds.length > 1) ? `« ${e.title} »` : e.title}</span>
        )}
        {e.summary && <div className="hi-summary">{e.summary}</div>}
      </div>
      {reversible && (
        <button className="btn btn-sm btn-ghost hi-revert" onClick={() => useStore.getState().revertActivity(e.id)} title="Revenir à l’état d’avant cette action">
          <RotateCcw size={13} /> Revenir à l’état d’avant
        </button>
      )}
    </li>
  );
}
