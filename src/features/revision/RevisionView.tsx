// Vue « Révision » : accueil (compte du jour, filtres, statistiques), générateur de cartes, liste, session.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Brain, Minus, Plus } from 'lucide-react';
import { useStore } from '../../lib/store';
import { Kbd } from '../../components/ui';
import type { ReviewCard } from '../../lib/types';
import { CardList } from './CardList';
import { Creator } from './Creator';
import { dayLabel, nextDue, NO_FILTERS, planDay, type Filters } from './queue';
import { KIND_LABEL } from './RichText';
import { Session } from './Session';
import { stateCounts, streak } from './stats';
import './revision.css';

type Tab = 'today' | 'create' | 'cards';

const stagger = (i: number) => ({ '--i': i }) as CSSProperties;
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

export function RevisionView() {
  const cards = useStore((s) => s.cards);
  const books = useStore((s) => s.books);
  const concepts = useStore((s) => s.concepts);
  const cap = useStore((s) => s.settings.newCardsPerBook);
  const updateSettings = useStore((s) => s.updateSettings);
  const navigate = useStore((s) => s.navigate);

  const [tab, setTab] = useState<Tab>('today');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [session, setSession] = useState<string[] | null>(null);

  const now = Date.now();
  const plan = useMemo(() => planDay(cards, cap, filters, Date.now()), [cards, cap, filters]);
  const total = plan.due.length + plan.fresh.length;

  const start = () => {
    if (!total) return;
    setSession([...plan.due, ...plan.fresh].map((c) => c.id));
  };

  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (session || tab !== 'today') return;
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName)) return;
      e.preventDefault();
      startRef.current();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [session, tab]);

  if (session) return <Session ids={session} onExit={() => setSession(null)} />;

  const counts = stateCounts(cards, now);
  const run = streak(cards, now);
  const next = nextDue(cards.filter((c) => !c.suspended), now);
  const bookIds = [...new Set(cards.map((c) => c.bookId).filter((x): x is string => !!x))];
  const conceptIds = [...new Set(cards.map((c) => c.conceptId).filter((x): x is string => !!x))];
  const filtered = filters.bookId || filters.kind || filters.conceptId;
  const date = new Date(now).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  const perBook = books
    .map((b) => ({
      b,
      due: plan.due.filter((c) => c.bookId === b.id).length,
      fresh: plan.fresh.filter((c) => c.bookId === b.id).length,
      waiting: cards.filter((c) => c.bookId === b.id && !c.suspended && c.fsrs.state === 0).length - plan.fresh.filter((c) => c.bookId === b.id).length,
    }))
    .filter((r) => r.due + r.fresh + r.waiting > 0);

  const sum = counts.fresh + counts.learning + counts.mastered;

  return (
    <>
      <header className="topbar">
        <div className="segmented" role="tablist" aria-label="Sections de la révision">
          <button role="tab" aria-selected={tab === 'today'} className={tab === 'today' ? 'active' : ''} onClick={() => setTab('today')}>
            Aujourd’hui
          </button>
          <button role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}>
            Créer des cartes
          </button>
          <button role="tab" aria-selected={tab === 'cards'} className={tab === 'cards' ? 'active' : ''} onClick={() => setTab('cards')}>
            Toutes les cartes{cards.length ? ` (${cards.length})` : ''}
          </button>
        </div>
        <div className="spacer" />
      </header>

      <div className="rev-scroll">
        <div className="rev-page anim-view">
          <h1 className="page-title">Révision</h1>
          <p className="rev-date muted">{date.charAt(0).toUpperCase() + date.slice(1)}</p>

          {tab === 'create' && <Creator />}
          {tab === 'cards' && <CardList onCreate={() => setTab('create')} />}

          {tab === 'today' && !cards.length && (
            <div className="empty rev-empty anim-in">
              <Brain size={26} />
              <h3>Aucune carte pour l’instant</h3>
              <p>
                Une carte pose une question dont vous retrouvez la réponse dans vos lectures. Créez-en depuis le menu d’un extrait, depuis une fiche concept ou
                avec le générateur.
              </p>
              <div className="rev-actions">
                <button className="btn btn-primary" onClick={() => setTab('create')}>
                  Créer des cartes
                </button>
                <button className="btn" onClick={() => navigate({ name: 'extracts' })}>
                  Voir les extraits
                </button>
              </div>
            </div>
          )}

          {tab === 'today' && cards.length > 0 && (
            <>
              <section className="rev-today panel anim-in" aria-label="Compte du jour">
                <div className="rev-numbers">
                  <div className="rev-number">
                    <span className={`rev-num ${plan.due.length ? '' : 'zero'}`} data-testid="due">
                      {plan.due.length}
                    </span>
                    <span className="rev-num-label">à revoir</span>
                  </div>
                  <div className="rev-number">
                    <span className={`rev-num ${plan.fresh.length ? '' : 'zero'}`} data-testid="fresh">
                      {plan.fresh.length}
                    </span>
                    <span className="rev-num-label">{plural(plan.fresh.length, 'nouvelle', 'nouvelles')}</span>
                  </div>
                </div>
                <div className="rev-cta">
                  {total > 0 ? (
                    <button className="btn btn-primary rev-start" onClick={start}>
                      Commencer <Kbd>↵</Kbd>
                    </button>
                  ) : (
                    <div className="rev-rest">
                      <strong>Rien à réviser {filtered ? 'avec ces filtres' : 'aujourd’hui'}.</strong>
                      <span className="muted">
                        {next ? `Prochaine échéance : ${dayLabel(next.at, now)} (${next.count} ${plural(next.count, 'carte', 'cartes')}).` : 'Aucune échéance à venir.'}
                      </span>
                    </div>
                  )}
                </div>
              </section>

              <div className="rev-cap">
                <span className="muted">Nouvelles cartes par livre et par jour</span>
                <div className="rev-stepper" role="group" aria-label="Plafond de nouvelles cartes par livre et par jour">
                  <button className="icon-btn sm" aria-label="Diminuer" onClick={() => updateSettings({ newCardsPerBook: Math.max(1, cap - 1) })}>
                    <Minus size={13} />
                  </button>
                  <span data-testid="cap">{cap}</span>
                  <button className="icon-btn sm" aria-label="Augmenter" onClick={() => updateSettings({ newCardsPerBook: Math.min(50, cap + 1) })}>
                    <Plus size={13} />
                  </button>
                </div>
                {plan.waiting > 0 && (
                  <span className="rev-waiting">
                    {plan.waiting} {plural(plan.waiting, 'nouvelle en attente', 'nouvelles en attente')} pour demain
                  </span>
                )}
              </div>

              <div className="rev-filters" aria-label="Filtres">
                <span className="muted rev-filter-label">Filtrer</span>
                <select className="input rev-select" value={filters.bookId ?? ''} onChange={(e) => setFilters({ ...filters, bookId: e.target.value || null })} aria-label="Filtrer par livre">
                  <option value="">Tous les livres</option>
                  {bookIds.map((id) => (
                    <option key={id} value={id}>
                      {books.find((b) => b.id === id)?.title ?? 'Livre supprimé'}
                    </option>
                  ))}
                </select>
                {conceptIds.length > 0 && (
                  <select className="input rev-select" value={filters.conceptId ?? ''} onChange={(e) => setFilters({ ...filters, conceptId: e.target.value || null })} aria-label="Filtrer par concept">
                    <option value="">Tous les concepts</option>
                    {conceptIds.map((id) => (
                      <option key={id} value={id}>
                        {concepts.find((c) => c.id === id)?.name ?? 'Concept supprimé'}
                      </option>
                    ))}
                  </select>
                )}
                <div className="rev-types">
                  {(Object.keys(KIND_LABEL) as ReviewCard['kind'][]).map((k) => (
                    <button key={k} className={`chip ${filters.kind === k ? 'active' : ''}`} onClick={() => setFilters({ ...filters, kind: filters.kind === k ? null : k })}>
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
                {filtered && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setFilters(NO_FILTERS)}>
                    Effacer les filtres
                  </button>
                )}
              </div>

              {perBook.length > 0 && (
                <ul className="rev-books anim-stagger" aria-label="Par livre">
                  {perBook.map((r, i) => (
                    <li key={r.b.id} style={stagger(i)}>
                      <span className="rev-books-title truncate">
                        {r.b.title}
                        {r.b.author && <span className="muted"> — {r.b.author}</span>}
                      </span>
                      <span className="rev-books-n">
                        {r.due} à revoir · {r.fresh} {plural(r.fresh, 'nouvelle', 'nouvelles')}
                        {r.waiting > 0 && <span className="muted"> (+{r.waiting} en attente)</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <section className="rev-stats" aria-label="Statistiques">
                <div className="rev-bar" role="img" aria-label={`${counts.fresh} nouvelles, ${counts.learning} en apprentissage, ${counts.mastered} acquises`}>
                  {sum > 0 && (
                    <>
                      <span style={{ flex: counts.fresh }} className="b-new" />
                      <span style={{ flex: counts.learning }} className="b-learn" />
                      <span style={{ flex: counts.mastered }} className="b-known" />
                    </>
                  )}
                </div>
                <dl className="rev-legend">
                  <div>
                    <dt><i className="b-new" />Nouvelles</dt>
                    <dd>{counts.fresh}</dd>
                  </div>
                  <div>
                    <dt><i className="b-learn" />En apprentissage</dt>
                    <dd>{counts.learning}</dd>
                  </div>
                  <div>
                    <dt><i className="b-known" />Acquises</dt>
                    <dd>{counts.mastered}</dd>
                  </div>
                  {counts.suspended > 0 && (
                    <div>
                      <dt>Suspendues</dt>
                      <dd>{counts.suspended}</dd>
                    </div>
                  )}
                </dl>
                <dl className="rev-legend rev-legend-b">
                  <div>
                    <dt>Série</dt>
                    <dd data-testid="streak">{run} {plural(run, 'jour', 'jours')}</dd>
                  </div>
                  {counts.retention != null && (
                    <div>
                      <dt>Rappel estimé</dt>
                      <dd>{Math.round(counts.retention * 100)} %</dd>
                    </div>
                  )}
                </dl>
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
