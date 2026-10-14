// Vue « Concepts » : liste filtrable + fiche (sens par auteur, distinctions, lectures, mentions).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BookOpen,
  Check,
  FileDown,
  GraduationCap,
  Layers,
  Lightbulb,
  Link2,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useStore, uid } from '../../lib/store';
import { host } from '../../lib/platform';
import { CATEGORY_BY_ID, NOTE_KIND_BY_ID } from '../../lib/categories';
import { conceptToMarkdown, conceptsToMarkdown } from '../../lib/exportMarkdown';
import type { Book, Concept, ConceptLink, ConceptSense, Highlight, ReviewCard } from '../../lib/types';
import { CategoryDot } from '../../components/ui';
import { bareName, loadProgramme } from './programme';
import { byTextOrder, clip, locationOf, norm, plural } from './util';
import { useMultiSelect } from '../../lib/useMultiSelect';
import { SelectionActionBar, SelectCheck } from '../../components/MultiSelect';
import { CheckSquare, Trash2 as TrashIcon } from 'lucide-react';
import './concepts.css';
import { fmtKeys, isMod } from '../../lib/keys';

type FilterKey = 'all' | 'notion' | 'repere' | 'perso';

const FILTERS: { id: FilterKey; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'notion', label: 'Notions du programme' },
  { id: 'repere', label: 'Repères' },
  { id: 'perso', label: 'Mes concepts' },
];

const KIND_LABEL: Record<ConceptLink['kind'], string> = {
  distingue: 'se distingue de',
  oppose: 's’oppose à',
  proche: 'est proche de',
};

const FSRS_INIT: ReviewCard['fsrs'] = {
  due: 0,
  stability: 0,
  difficulty: 0,
  elapsed_days: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 0,
  lapses: 0,
  state: 0,
  last_review: null,
};

const stagger = (i: number) => ({ '--i': i }) as CSSProperties;

// ── Repérage des mentions ────────────────────────────────────
/** Termes à chercher dans le texte pour un concept (aucun pour un repère du programme : trop bruyant). */
function mentionTerms(c: Concept): string[] {
  if (c.programme === 'repere') return [];
  return c.name
    .split('/')
    .map((t) => bareName(t))
    .filter((t) => t.length >= 3);
}

function mentionRegex(terms: string[]): RegExp | null {
  if (!terms.length) return null;
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${esc.join('|')})(?:s|x)?(?![\\p{L}\\p{N}])`, 'u');
}

// ── Champ à sauvegarde automatique ───────────────────────────
function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
}

function AutoField({
  value,
  onCommit,
  multiline = false,
  delay = 450,
  onSaved,
  ...rest
}: {
  value: string;
  onCommit(v: string): void;
  multiline?: boolean;
  delay?: number;
  onSaved?(): void;
  className?: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  'aria-label'?: string;
}) {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  const latest = useRef(value);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!dirty.current) {
      setV(value);
      latest.current = value;
    }
  }, [value]);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      dirty.current = false;
      commit.current(latest.current);
      saved.current?.();
    }, delay);
    return () => clearTimeout(t);
  }, [v, delay]);

  // Enregistre ce qui reste à la fermeture (changement de fiche, de vue).
  useEffect(
    () => () => {
      if (dirty.current) commit.current(latest.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (multiline) autosize(ta.current);
  }, [v, multiline]);

  const change = (next: string) => {
    dirty.current = true;
    latest.current = next;
    setV(next);
  };
  const flush = () => {
    if (!dirty.current) return;
    dirty.current = false;
    commit.current(latest.current);
    saved.current?.();
  };

  if (multiline)
    return <textarea ref={ta} value={v} onChange={(e) => change(e.target.value)} onBlur={flush} {...rest} />;
  return (
    <input
      value={v}
      onChange={(e) => change(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      {...rest}
    />
  );
}

// ── Popover maison ───────────────────────────────────────────
function Pop({ onClose, children, className = '' }: { onClose(): void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = setTimeout(() => document.addEventListener('mousedown', down), 0);
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={`floating cpt-pop anim-scale ${className}`}>
      {children}
    </div>
  );
}

// ── Vue principale ───────────────────────────────────────────
export function ConceptsView({ conceptId }: { conceptId: string | null }) {
  const concepts = useStore((s) => s.concepts);
  const highlights = useStore((s) => s.highlights);
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [menu, setMenu] = useState(false);
  const newRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of highlights) for (const id of h.conceptIds) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [highlights]);

  const filterCounts = useMemo(() => {
    const m: Record<FilterKey, number> = { all: concepts.length, notion: 0, repere: 0, perso: 0 };
    for (const c of concepts) m[c.programme ?? 'perso']++;
    return m;
  }, [concepts]);

  const list = useMemo(() => {
    const q = norm(query.trim());
    return concepts
      .filter((c) => (filter === 'all' ? true : (c.programme ?? 'perso') === filter))
      .filter((c) => !q || norm(c.name).includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }, [concepts, query, filter]);

  const current = conceptId ? (concepts.find((c) => c.id === conceptId) ?? null) : null;

  // ── Sélection multiple (⌘-clic, ⇧-clic, ⌘A, mode « Sélectionner ») ──
  const order = useMemo(() => list.map((c) => c.id), [list]);
  const sel = useMultiSelect(order);
  const [selectMode, setSelectMode] = useState(false);
  const selecting = selectMode || sel.size > 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, [contenteditable="true"]') || t.isContentEditable)) return;
      if (isMod(e) && e.key.toLowerCase() === 'a' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        sel.selectAll();
      } else if (e.key === 'Escape' && (sel.size || selectMode)) {
        sel.clear();
        setSelectMode(false);
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && isMod(e) && sel.size) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const deleteSelected = () => {
    const ids = sel.ids;
    if (!ids.length) return;
    useStore.getState().trashDeleteMany('concept', ids);
    sel.clear();
    setSelectMode(false);
    if (conceptId && ids.includes(conceptId)) navigate({ name: 'concepts', conceptId: null });
  };

  useEffect(() => {
    if (creating) newRef.current?.focus();
  }, [creating]);

  const open = (id: string) => navigate({ name: 'concepts', conceptId: id });

  const submitNew = () => {
    const name = newName.trim();
    if (!name) return;
    const exists = useStore.getState().concepts.some((c) => norm(c.name) === norm(name));
    const c = useStore.getState().addConcept(name);
    if (exists) toast(`« ${c.name} » existe déjà`);
    setNewName('');
    setCreating(false);
    setQuery('');
    setFilter('all');
    open(c.id);
  };

  const doLoadProgramme = () => {
    const r = loadProgramme();
    setMenu(false);
    if (!r.added) toast('Le programme est déjà chargé');
    else toast(`${plural(r.notions, 'notion')} et ${plural(r.reperes, 'repère')} ajoutés`, 'success');
  };

  const exportAll = async () => {
    setMenu(false);
    if (!concepts.length) return;
    const ok = await host.saveText('Concepts.md', conceptsToMarkdown(useStore.getState()));
    if (ok) toast('Concepts exportés', 'success');
  };

  const nothing = concepts.length === 0;

  return (
    <>
      <header className="topbar">
        <span className="spacer" />
        <div className="cpt-pop-wrap">
          <button className="icon-btn" aria-label="Plus d’actions" title="Plus d’actions" onClick={() => setMenu((m) => !m)}>
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <Pop onClose={() => setMenu(false)} className="cpt-menu">
              <button className="menu-item" onClick={doLoadProgramme}>
                <GraduationCap size={14} /> Charger le programme de terminale
              </button>
              <button className="menu-item" onClick={exportAll} disabled={nothing}>
                <FileDown size={14} /> Exporter tous les concepts
              </button>
            </Pop>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={14} /> Nouveau concept
        </button>
      </header>

      {nothing && !creating ? (
        <div className="cpt-wrap">
          <div className="panel cpt-fullempty anim-view">
            <div className="empty">
              <Lightbulb size={26} />
              <h3>Aucun concept pour l’instant</h3>
              <p>Un concept se construit au fil des lectures : plusieurs sens selon les auteurs, des distinctions, des extraits.</p>
              <div className="cpt-actions-row">
                <button className="btn btn-primary" onClick={doLoadProgramme}>
                  <GraduationCap size={14} /> Charger le programme de terminale
                </button>
                <button className="btn" onClick={() => setCreating(true)}>
                  <Plus size={14} /> Nouveau concept
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="cpt-wrap">
          <aside className="panel cpt-list anim-view" aria-label="Liste des concepts">
            <div className="cpt-list-head">
              <h1 className="page-title cpt-list-title">Concepts</h1>
              <div className="cpt-search">
                <Search size={14} />
                <input
                  className="input"
                  placeholder="Rechercher un concept"
                  aria-label="Rechercher un concept"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button className="icon-btn sm" aria-label="Effacer la recherche" onClick={() => setQuery('')}>
                    <X size={13} />
                  </button>
                )}
              </div>
              <button
                className={`btn btn-ghost btn-sm cpt-select-btn ${selectMode ? 'active' : ''}`}
                onClick={() => (selectMode ? (setSelectMode(false), sel.clear()) : setSelectMode(true))}
                title={fmtKeys(selectMode ? 'Quitter la sélection (Échap)' : 'Sélectionner plusieurs concepts (⌘-clic, ⇧-clic, ⌘A)')}
                aria-pressed={selectMode}
              >
                <CheckSquare size={14} /> {selectMode ? 'Terminé' : 'Sélectionner'}
              </button>
              <div className="cpt-filters" role="group" aria-label="Filtres">
                {FILTERS.map((f) => (
                  <button key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
                    {f.label}
                    <span className="cpt-chip-n">{filterCounts[f.id]}</span>
                  </button>
                ))}
              </div>
              {creating && (
                <form
                  className="cpt-new anim-in"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitNew();
                  }}
                >
                  <input
                    ref={newRef}
                    className="input"
                    placeholder="Nom du concept"
                    aria-label="Nom du nouveau concept"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && (setCreating(false), setNewName(''))}
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={!newName.trim()}>
                    Créer
                  </button>
                  <button type="button" className="icon-btn sm" aria-label="Annuler" onClick={() => (setCreating(false), setNewName(''))}>
                    <X size={13} />
                  </button>
                </form>
              )}
            </div>
            <div className="cpt-list-scroll">
              {list.length === 0 ? (
                <p className="cpt-none muted">Aucun concept ne correspond.</p>
              ) : (
                <ul className="cpt-rows anim-stagger">
                  {list.map((c, i) => (
                    <li key={c.id} style={stagger(i)}>
                      <button
                        className={`cpt-row ${c.id === conceptId ? 'active' : ''} ${sel.has(c.id) ? 'is-selected' : ''}`}
                        onClick={(e) => sel.click(c.id, e, { toggle: selectMode }) || open(c.id)}
                        data-concept-id={c.id}
                        data-sel-id={c.id}
                        aria-selected={sel.has(c.id)}
                      >
                        {selecting && <SelectCheck checked={sel.has(c.id)} onToggle={() => sel.toggle(c.id)} label={`Sélectionner « ${c.name} »`} />}
                        <span className="cpt-row-name truncate">{c.name}</span>
                        {c.programme && <span className="cpt-tag">{c.programme === 'notion' ? 'Notion' : 'Repère'}</span>}
                        <span className="cpt-count" title="Extraits liés">
                          {counts.get(c.id) ?? 0}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <SelectionActionBar count={sel.size} label={sel.size > 1 ? 'concepts sélectionnés' : 'concept sélectionné'} onClear={() => (sel.clear(), setSelectMode(false))}>
            <button className="btn btn-ghost btn-sm" onClick={() => sel.selectAll()} title={fmtKeys("Tout sélectionner (⌘A)")}>
              Tout sélectionner
            </button>
            <button className="btn btn-ghost btn-sm btn-danger" onClick={deleteSelected} title={fmtKeys("Placer dans la corbeille (⌘⌫)")} data-action="delete-selected">
              <TrashIcon size={13} /> Supprimer
            </button>
          </SelectionActionBar>
          <section className="panel cpt-detail">
            {current ? (
              <ConceptSheet key={current.id} concept={current} />
            ) : (
              <div className="empty anim-fade">
                <Layers size={24} />
                <h3>{conceptId ? 'Concept introuvable' : 'Choisissez un concept'}</h3>
                <p>
                  {conceptId
                    ? 'Il a peut-être été supprimé.'
                    : 'Sa fiche réunit vos définitions par auteur, ses distinctions et les extraits où il apparaît.'}
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

// ── Fiche ────────────────────────────────────────────────────
function ConceptSheet({ concept }: { concept: Concept }) {
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  const highlights = useStore((s) => s.highlights);
  const books = useStore((s) => s.books);
  const concepts = useStore((s) => s.concepts);
  const cards = useStore((s) => s.cards);
  const updateConcept = useStore((s) => s.updateConcept);
  const [saved, setSaved] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [cardMenu, setCardMenu] = useState(false);

  const bookById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const linked = useMemo(() => highlights.filter((h) => h.conceptIds.includes(concept.id)), [highlights, concept.id]);
  const nCards = cards.filter((c) => c.conceptId === concept.id).length;

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(t);
  }, [saved]);

  const rename = (raw: string) => {
    const name = raw.trim();
    if (!name || name === concept.name) return;
    if (concepts.some((c) => c.id !== concept.id && norm(c.name) === norm(name))) {
      toast(`Un concept « ${name} » existe déjà`, 'error');
      return;
    }
    updateConcept(concept.id, { name });
    setSaved(true);
  };

  // Sources possibles d'une carte « définition ».
  const sources = useMemo(() => {
    const out: { key: string; label: string; author: string; bookId: string | null; definition: string }[] = [];
    if (concept.definition.trim())
      out.push({ key: 'synthese', label: 'Ma synthèse', author: '', bookId: null, definition: concept.definition });
    for (const s of concept.senses)
      if (s.definition.trim())
        out.push({ key: s.id, label: s.author.trim() ? `Selon ${s.author.trim()}` : 'Sens sans auteur', author: s.author.trim(), bookId: s.bookId, definition: s.definition });
    return out;
  }, [concept]);

  const makeCard = (src: (typeof sources)[number]) => {
    setCardMenu(false);
    const front = src.author ? `Définir « ${concept.name} » (selon ${src.author})` : `Définir « ${concept.name} »`;
    const st = useStore.getState();
    if (st.cards.some((c) => c.conceptId === concept.id && c.kind === 'definition' && c.front === front)) {
      toast('Cette carte existe déjà');
      return;
    }
    st.insert('cards', {
      id: uid(),
      kind: 'definition',
      front,
      back: src.definition.trim(),
      highlightId: null,
      conceptId: concept.id,
      bookId: src.bookId,
      suspended: false,
      fsrs: { ...FSRS_INIT, due: Date.now() },
      createdAt: Date.now(),
    });
    toast('Carte de révision créée', 'success', { label: 'Voir', run: () => navigate({ name: 'revision' }) });
  };

  const onCardClick = () => {
    if (sources.length === 1) makeCard(sources[0]);
    else if (sources.length > 1) setCardMenu((m) => !m);
  };

  const exportOne = async () => {
    const md = conceptToMarkdown(concept.id, useStore.getState());
    const fname = concept.name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Concept';
    const ok = await host.saveText(`${fname}.md`, md);
    if (ok) toast('Fiche exportée', 'success');
  };

  const del = () => {
    useStore.getState().removeConcept(concept.id);
    navigate({ name: 'concepts', conceptId: null });
    toast(`« ${concept.name} » supprimé`);
  };

  return (
    <div className="cpt-scroll">
      <div className="cpt-sheet anim-stagger">
        <header className="cpt-head" style={stagger(0)}>
          <div className="cpt-head-top">
            {concept.programme && (
              <span className="cpt-tag cpt-tag-lg">{concept.programme === 'notion' ? 'Notion du programme' : 'Repère du programme'}</span>
            )}
            <span className="spacer" />
            <span className={`cpt-saved ${saved ? 'on' : ''}`} aria-live="polite">
              <Check size={12} /> Enregistré
            </span>
          </div>
          <AutoField
            className="cpt-name"
            value={concept.name}
            onCommit={rename}
            delay={900}
            aria-label="Nom du concept"
          />
          <div className="cpt-head-actions">
            <div className="cpt-pop-wrap">
              <button
                className="btn btn-sm"
                onClick={onCardClick}
                disabled={!sources.length}
                title={sources.length ? undefined : 'Rédigez d’abord une définition'}
              >
                <Layers size={13} /> Créer une carte de révision
              </button>
              {cardMenu && (
                <Pop onClose={() => setCardMenu(false)} className="cpt-menu cpt-menu-left">
                  <div className="cpt-menu-title">Quelle définition réviser ?</div>
                  {sources.map((s) => (
                    <button key={s.key} className="menu-item cpt-menu-item" onClick={() => makeCard(s)}>
                      <span className="truncate">{s.label}</span>
                    </button>
                  ))}
                </Pop>
              )}
            </div>
            <button className="btn btn-sm" onClick={exportOne}>
              <FileDown size={13} /> Exporter
            </button>
            <span className="spacer" />
            {confirmDel ? (
              <span className="cpt-confirm anim-in" role="alertdialog" aria-label="Confirmer la suppression">
                <span>
                  Supprimer « {concept.name} » ?{' '}
                  <span className="muted">
                    {linked.length ? `${plural(linked.length, 'extrait')} délié${linked.length > 1 ? 's' : ''}` : ''}
                    {linked.length && nCards ? ' · ' : ''}
                    {nCards ? `${plural(nCards, 'carte')} supprimée${nCards > 1 ? 's' : ''}` : ''}
                  </span>
                </span>
                <button className="btn btn-sm" onClick={() => setConfirmDel(false)}>
                  Garder
                </button>
                <button className="btn btn-sm btn-danger" onClick={del} data-action="confirm-delete">
                  Supprimer le concept
                </button>
              </span>
            ) : (
              <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setConfirmDel(true)}>
                <Trash2 size={13} /> Supprimer
              </button>
            )}
          </div>
        </header>

        <section className="cpt-sec" style={stagger(1)}>
          <h2 className="cpt-h">Synthèse personnelle</h2>
          {concept.programme === 'repere' && (
            <p className="cpt-hint">
              Un repère se travaille par ses distinctions et ses emplois, pas par une définition figée : décrivez plutôt comment il
              sert à penser.
            </p>
          )}
          <AutoField
            multiline
            className="textarea cpt-synth"
            rows={3}
            placeholder="Ce que ce concept signifie pour vous, en quelques lignes…"
            aria-label="Synthèse personnelle"
            value={concept.definition}
            onCommit={(v) => updateConcept(concept.id, { definition: v })}
            onSaved={() => setSaved(true)}
          />
        </section>

        <SensesSection concept={concept} books={books} highlights={highlights} />
        <LinksSection concept={concept} concepts={concepts} />
        <ReadingsSection concept={concept} linked={linked} bookById={bookById} />
        <MentionsSection concept={concept} highlights={highlights} bookById={bookById} />
      </div>
    </div>
  );
}

function SectionHead({ title, hint, action, n }: { title: string; hint?: string; action?: ReactNode; n?: number }) {
  return (
    <div className="cpt-sec-head">
      <div>
        <h2 className="cpt-h">
          {title}
          {n !== undefined && <span className="cpt-h-n">{n}</span>}
        </h2>
        {hint && <p className="cpt-hint">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

// ── Sens par auteur ──────────────────────────────────────────
function SensesSection({ concept, books, highlights }: { concept: Concept; books: Book[]; highlights: Highlight[] }) {
  const updateConcept = useStore((s) => s.updateConcept);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const setSenses = (senses: ConceptSense[]) => updateConcept(concept.id, { senses });
  // Toujours repartir de l'état courant du store (les champs commitent en différé).
  const patchSense = (id: string, p: Partial<ConceptSense>) => {
    const cur = useStore.getState().concepts.find((c) => c.id === concept.id);
    if (!cur) return;
    setSenses(cur.senses.map((s) => (s.id === id ? { ...s, ...p } : s)));
  };
  const removeSense = (id: string) => {
    const cur = useStore.getState().concepts.find((c) => c.id === concept.id);
    if (cur) setSenses(cur.senses.filter((s) => s.id !== id));
  };
  const add = () => {
    const s: ConceptSense = { id: uid(), author: '', bookId: null, definition: '', highlightIds: [] };
    setSenses([...concept.senses, s]);
    setJustAdded(s.id);
  };

  return (
    <section className="cpt-sec" style={stagger(2)}>
      <SectionHead
        title="Sens par auteur"
        n={concept.senses.length}
        hint="Un même mot ne dit pas la même chose chez Descartes et chez Spinoza : notez ce que chacun en fait."
        action={
          <button className="btn btn-sm" onClick={add}>
            <Plus size={13} /> Ajouter un sens
          </button>
        }
      />
      {concept.senses.length === 0 ? (
        <p className="cpt-none muted">Aucun sens noté. Ajoutez celui d’un auteur que vous lisez.</p>
      ) : (
        <ul className="cpt-senses">
          {concept.senses.map((s) => (
            <SenseCard
              key={s.id}
              sense={s}
              concept={concept}
              books={books}
              highlights={highlights}
              autoFocus={s.id === justAdded}
              onPatch={(p) => patchSense(s.id, p)}
              onRemove={() => removeSense(s.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SenseCard({
  sense,
  concept,
  books,
  highlights,
  autoFocus,
  onPatch,
  onRemove,
}: {
  sense: ConceptSense;
  concept: Concept;
  books: Book[];
  highlights: Highlight[];
  autoFocus: boolean;
  onPatch(p: Partial<ConceptSense>): void;
  onRemove(): void;
}) {
  const jump = useStore((s) => s.jumpToHighlight);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState(false);

  const hlById = useMemo(() => new Map(highlights.map((h) => [h.id, h])), [highlights]);
  const attached = sense.highlightIds.map((id) => hlById.get(id)).filter((h): h is Highlight => !!h);
  const bookTitle = (id: string) => books.find((b) => b.id === id)?.title ?? '';

  const candidates = useMemo(() => {
    const nq = norm(q.trim());
    const rank = (h: Highlight) => (h.conceptIds.includes(concept.id) ? 0 : 1) + (sense.bookId && h.bookId !== sense.bookId ? 2 : 0);
    return highlights
      .filter((h) => !sense.highlightIds.includes(h.id))
      .filter((h) => !nq || norm(h.text + ' ' + h.note).includes(nq))
      .sort((a, b) => rank(a) - rank(b) || byTextOrder(a, b))
      .slice(0, 30);
  }, [highlights, q, sense.highlightIds, sense.bookId, concept.id]);

  const attach = (h: Highlight) => {
    onPatch({ highlightIds: [...sense.highlightIds, h.id] });
    if (!h.conceptIds.includes(concept.id)) useStore.getState().toggleHighlightConcept(h.id, concept.id);
  };

  return (
    <li className="cpt-sense anim-in" data-sense-id={sense.id}>
      <div className="cpt-sense-head">
        <AutoField
          className="input cpt-author"
          placeholder="Auteur (ex. Spinoza)"
          aria-label="Auteur du sens"
          autoFocus={autoFocus}
          value={sense.author}
          onCommit={(v) => onPatch({ author: v.trim() })}
          delay={300}
        />
        <select
          className="input cpt-book"
          aria-label="Livre du sens"
          value={sense.bookId ?? ''}
          onChange={(e) => {
            const id = e.target.value || null;
            const b = books.find((x) => x.id === id);
            onPatch({ bookId: id, ...(b && !sense.author.trim() ? { author: b.author } : {}) });
          }}
        >
          <option value="">Livre (facultatif)</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
        {confirm ? (
          <span className="cpt-confirm anim-in">
            <button className="btn btn-sm" onClick={() => setConfirm(false)}>
              Annuler
            </button>
            <button className="btn btn-sm btn-danger" onClick={onRemove} data-action="confirm-delete-sense">
              Supprimer
            </button>
          </span>
        ) : (
          <button className="icon-btn sm" aria-label="Supprimer ce sens" title="Supprimer ce sens" onClick={() => setConfirm(true)}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <AutoField
        multiline
        className="textarea cpt-sense-def"
        rows={2}
        placeholder="Définition ou emploi du terme chez cet auteur…"
        aria-label="Définition du sens"
        value={sense.definition}
        onCommit={(v) => onPatch({ definition: v })}
        delay={350}
      />
      {attached.length > 0 && (
        <ul className="cpt-sense-hls">
          {attached.map((h) => (
            <li key={h.id}>
              <button className="cpt-quote-chip" onClick={() => jump(h.id)} title="Aller à l’extrait">
                <BookOpen size={12} />
                <span className="truncate">{clip(h.text || h.note, 80)}</span>
              </button>
              <button
                className="icon-btn sm"
                aria-label="Détacher l’extrait"
                title="Détacher l’extrait"
                onClick={() => onPatch({ highlightIds: sense.highlightIds.filter((x) => x !== h.id) })}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="cpt-sense-foot">
        <button className="btn btn-sm btn-ghost" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>
          <Link2 size={13} /> Lier un extrait
        </button>
      </div>
      {picking && (
        <div className="cpt-picker anim-in">
          <input
            className="input"
            placeholder="Chercher dans vos extraits"
            aria-label="Chercher un extrait à lier"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          {candidates.length === 0 ? (
            <p className="cpt-none muted">Aucun extrait disponible.</p>
          ) : (
            <ul className="cpt-picker-list">
              {candidates.map((h) => (
                <li key={h.id}>
                  <button className="cpt-pick" onClick={() => attach(h)}>
                    <span className="cpt-pick-text">{clip(h.text || h.note, 130)}</span>
                    <span className="cpt-pick-meta muted truncate">
                      {bookTitle(h.bookId)}
                      {h.conceptIds.includes(concept.id) ? ' · déjà lié au concept' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

// ── Distinctions et oppositions ──────────────────────────────
type LinkRow = { key: string; kind: ConceptLink['kind']; other: Concept; note: string; own: boolean; index: number };

function LinksSection({ concept, concepts }: { concept: Concept; concepts: Concept[] }) {
  const navigate = useStore((s) => s.navigate);
  const [adding, setAdding] = useState(false);

  const rows = useMemo<LinkRow[]>(() => {
    const byId = new Map(concepts.map((c) => [c.id, c]));
    const out: LinkRow[] = [];
    concept.links.forEach((l, index) => {
      const other = byId.get(l.conceptId);
      if (other) out.push({ key: `o-${index}`, kind: l.kind, other, note: l.note, own: true, index });
    });
    // Réciproque : les autres concepts qui pointent vers celui-ci.
    for (const c of concepts) {
      if (c.id === concept.id) continue;
      c.links.forEach((l, index) => {
        if (l.conceptId !== concept.id) return;
        if (concept.links.some((x) => x.conceptId === c.id && x.kind === l.kind)) return;
        out.push({ key: `r-${c.id}-${index}`, kind: l.kind, other: c, note: l.note, own: false, index });
      });
    }
    const order = { distingue: 0, oppose: 1, proche: 2 };
    return out.sort((a, b) => order[a.kind] - order[b.kind]);
  }, [concept, concepts]);

  const owner = (r: LinkRow) => (r.own ? concept.id : r.other.id);
  const mutate = (r: LinkRow, fn: (links: ConceptLink[]) => ConceptLink[]) => {
    const st = useStore.getState();
    const c = st.concepts.find((x) => x.id === owner(r));
    if (c) st.updateConcept(c.id, { links: fn(c.links) });
  };
  const remove = (r: LinkRow) => mutate(r, (ls) => ls.filter((_, i) => i !== r.index));
  const setNote = (r: LinkRow, note: string) => mutate(r, (ls) => ls.map((l, i) => (i === r.index ? { ...l, note } : l)));

  return (
    <section className="cpt-sec" style={stagger(3)}>
      <SectionHead
        title="Distinctions et oppositions"
        n={rows.length}
        hint="Rapportez le concept à ses contraires et à ses proches : c’est là qu’il prend son sens."
        action={
          !adding && (
            <button className="btn btn-sm" onClick={() => setAdding(true)}>
              <Plus size={13} /> Ajouter un lien
            </button>
          )
        }
      />
      {adding && <LinkAdder concept={concept} concepts={concepts} onDone={() => setAdding(false)} />}
      {rows.length === 0 && !adding ? (
        <p className="cpt-none muted">Aucune distinction notée.</p>
      ) : (
        <ul className="cpt-links">
          {rows.map((r) => (
            <li key={r.key} className="cpt-link anim-in" data-link-kind={r.kind} data-own={r.own ? '1' : '0'}>
              <div className="cpt-link-line">
                <span className={`cpt-kind cpt-kind-${r.kind}`}>
                  {KIND_LABEL[r.kind]}
                </span>
                <button className="cpt-link-name" onClick={() => navigate({ name: 'concepts', conceptId: r.other.id })}>
                  {r.other.name}
                </button>
                {!r.own && <span className="cpt-recip" title={`Noté depuis la fiche « ${r.other.name} »`}>réciproque</span>}
                <span className="spacer" />
                <button className="icon-btn sm" aria-label="Retirer ce lien" title="Retirer ce lien" onClick={() => remove(r)}>
                  <X size={13} />
                </button>
              </div>
              {r.own ? (
                <AutoField
                  className="cpt-link-note"
                  placeholder="Note : en quoi se distinguent-ils ?"
                  aria-label="Note du lien"
                  value={r.note}
                  onCommit={(v) => setNote(r, v)}
                  delay={350}
                />
              ) : (
                r.note && <p className="cpt-link-note ro">{r.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LinkAdder({ concept, concepts, onDone }: { concept: Concept; concepts: Concept[]; onDone(): void }) {
  const [kind, setKind] = useState<ConceptLink['kind']>('distingue');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<{ id: string | null; name: string } | null>(null);
  const [note, setNote] = useState('');
  const [focus, setFocus] = useState(false);

  const taken = (id: string) =>
    concept.links.some((l) => l.conceptId === id && l.kind === kind) ||
    concepts.some((c) => c.id === id && c.links.some((l) => l.conceptId === concept.id && l.kind === kind));

  const suggestions = useMemo(() => {
    const nq = norm(q.trim());
    return concepts
      .filter((c) => c.id !== concept.id && !taken(c.id))
      .filter((c) => !nq || norm(c.name).includes(nq))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
      .slice(0, 7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, concepts, concept, kind]);

  const exact = concepts.some((c) => norm(c.name) === norm(q.trim()));
  const canCreate = q.trim().length > 0 && !exact;

  const submit = () => {
    if (!picked) return;
    const st = useStore.getState();
    const id = picked.id ?? st.addConcept(picked.name).id;
    if (id === concept.id) return;
    const cur = st.concepts.find((c) => c.id === concept.id);
    if (!cur) return;
    if (!cur.links.some((l) => l.conceptId === id && l.kind === kind))
      st.updateConcept(concept.id, { links: [...cur.links, { conceptId: id, kind, note: note.trim() }] });
    onDone();
  };

  return (
    <div className="cpt-adder anim-in">
      <div className="segmented" role="group" aria-label="Type de lien">
        {(Object.keys(KIND_LABEL) as ConceptLink['kind'][]).map((k) => (
          <button key={k} className={kind === k ? 'active' : ''} onClick={() => (setKind(k), setPicked(null))} data-kind={k}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {picked ? (
        <div className="cpt-picked">
          <span className="cpt-picked-name">{picked.name}</span>
          {!picked.id && <span className="cpt-tag">nouveau</span>}
          <button className="icon-btn sm" aria-label="Changer de concept" onClick={() => setPicked(null)}>
            <X size={12} />
          </button>
        </div>
      ) : (
        <div className="cpt-combo">
          <input
            className="input"
            placeholder="Choisir un concept existant ou en créer un"
            aria-label="Concept à lier"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocus(true)}
            autoFocus
          />
          {(focus || q) && (suggestions.length > 0 || canCreate) && (
            <ul className="cpt-combo-list anim-in" role="listbox">
              {suggestions.map((c) => (
                <li key={c.id}>
                  <button className="menu-item" role="option" onClick={() => setPicked({ id: c.id, name: c.name })}>
                    <span className="truncate">{c.name}</span>
                    {c.programme && <span className="cpt-tag">{c.programme === 'notion' ? 'Notion' : 'Repère'}</span>}
                  </button>
                </li>
              ))}
              {canCreate && (
                <li>
                  <button className="menu-item cpt-create" data-action="create-concept" onClick={() => setPicked({ id: null, name: q.trim() })}>
                    <Plus size={13} /> Créer « {q.trim()} »
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      <input
        className="input"
        placeholder="Note (facultatif)"
        aria-label="Note du nouveau lien"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <div className="cpt-adder-actions">
        <button className="btn btn-sm" onClick={onDone}>
          Annuler
        </button>
        <button className="btn btn-sm btn-primary" disabled={!picked} onClick={submit} data-action="add-link">
          Ajouter
        </button>
      </div>
    </div>
  );
}

// ── Dans vos lectures ────────────────────────────────────────
function groupByBook(hs: Highlight[], bookById: Map<string, Book>) {
  const m = new Map<string, Highlight[]>();
  for (const h of hs) m.set(h.bookId, [...(m.get(h.bookId) ?? []), h]);
  return [...m.entries()]
    .map(([bookId, items]) => ({ bookId, book: bookById.get(bookId) ?? null, items: items.sort(byTextOrder) }))
    .sort((a, b) => (a.book?.title ?? '').localeCompare(b.book?.title ?? '', 'fr', { sensitivity: 'base' }));
}

function ExtractItem({ h, action, book }: { h: Highlight; action?: ReactNode; book?: Book | null }) {
  const jump = useStore((s) => s.jumpToHighlight);
  const cat = h.category ? CATEGORY_BY_ID[h.category] : null;
  return (
    <li className="cpt-ex lift" data-highlight-id={h.id}>
      <button className="cpt-ex-main" onClick={() => jump(h.id)} title="Aller à l’extrait dans le livre">
        <span className="cpt-ex-cat">
          {cat ? <CategoryDot id={cat.id} size={8} /> : <span className="cpt-ex-notedot" />}
          <span>{cat ? cat.label : 'Note de marge'}</span>
          {book && <span className="muted"> · {book.title}</span>}
          {locationOf(h) && <span className="muted"> · {locationOf(h)}</span>}
        </span>
        {h.text.trim() && <span className="cpt-ex-text">{h.text}</span>}
        {h.note.trim() && (
          <span className="cpt-ex-note">
            <b>{h.noteKind ? NOTE_KIND_BY_ID[h.noteKind].label : 'Note'}</b> {h.note}
          </span>
        )}
      </button>
      {action}
    </li>
  );
}

function ReadingsSection({ concept, linked, bookById }: { concept: Concept; linked: Highlight[]; bookById: Map<string, Book> }) {
  const toggle = useStore((s) => s.toggleHighlightConcept);
  const groups = useMemo(() => groupByBook(linked, bookById), [linked, bookById]);
  return (
    <section className="cpt-sec" style={stagger(4)}>
      <SectionHead title="Dans vos lectures" n={linked.length} hint="Les extraits que vous avez reliés à ce concept, livre par livre." />
      {linked.length === 0 ? (
        <p className="cpt-none muted">Aucun extrait lié. Reliez un extrait depuis le lecteur, ou depuis les mentions ci-dessous.</p>
      ) : (
        groups.map((g) => (
          <div key={g.bookId} className="cpt-bookgroup">
            <h3 className="cpt-book-title">
              <BookOpen size={13} />
              <span className="truncate">{g.book?.title ?? 'Livre supprimé'}</span>
              {g.book?.author && <span className="muted truncate"> · {g.book.author}</span>}
            </h3>
            <ul className="cpt-exlist">
              {g.items.map((h) => (
                <ExtractItem
                  key={h.id}
                  h={h}
                  action={
                    <button className="icon-btn sm cpt-ex-act" aria-label="Délier de ce concept" title="Délier de ce concept" onClick={() => toggle(h.id, concept.id)}>
                      <X size={13} />
                    </button>
                  }
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

// ── Mentions possibles ───────────────────────────────────────
function MentionsSection({ concept, highlights, bookById }: { concept: Concept; highlights: Highlight[]; bookById: Map<string, Book> }) {
  const toggle = useStore((s) => s.toggleHighlightConcept);
  const [all, setAll] = useState(false);
  const terms = useMemo(() => mentionTerms(concept), [concept.name, concept.programme]);
  const found = useMemo(() => {
    const re = mentionRegex(terms);
    if (!re) return [];
    return highlights
      .filter((h) => !h.conceptIds.includes(concept.id))
      .filter((h) => re.test(norm(h.text + ' ' + h.note)))
      .sort((a, b) => a.bookId.localeCompare(b.bookId) || byTextOrder(a, b));
  }, [highlights, terms, concept.id]);

  if (concept.programme === 'repere') return null;
  const shown = all ? found : found.slice(0, 6);

  return (
    <section className="cpt-sec" style={stagger(5)}>
      <SectionHead title="Mentions possibles" n={found.length} hint="Extraits qui contiennent le nom du concept sans y être reliés." />
      {found.length === 0 ? (
        <p className="cpt-none muted">Aucune mention non reliée.</p>
      ) : (
        <>
          <ul className="cpt-exlist">
            {shown.map((h) => (
              <ExtractItem
                key={h.id}
                h={h}
                book={bookById.get(h.bookId)}
                action={
                  <button className="btn btn-sm cpt-ex-link" data-action="link-mention" onClick={() => toggle(h.id, concept.id)}>
                    <Link2 size={12} /> Lier
                  </button>
                }
              />
            ))}
          </ul>
          {found.length > 6 && (
            <button className="btn btn-sm btn-ghost" onClick={() => setAll((a) => !a)}>
              {all ? 'Réduire' : `Afficher les ${found.length} mentions`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
