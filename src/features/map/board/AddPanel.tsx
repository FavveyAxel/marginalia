// Panneau « Ajouter » d'une carte libre : extraits de tous les livres, cartes venues d'autres
// cartes (avec leurs liens), concepts, idées. Toutes les écritures passent par model/actions.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Highlighter, Lightbulb, Network, StickyNote, Waypoints, X } from 'lucide-react';
import { useStore } from '../../../lib/store';
import { CATEGORIES, catColor, kindColor, kindLabel, kindOf, type ExtractKind } from '../../../lib/categories';
import { locatorOf } from '../../../lib/citation';
import type { ArgumentMap } from '../../../lib/types';
import { addConcepts, addIdeas, copyNodesInto, lookup, placeHighlights } from '../model/actions';
import { nodeCategory, nodeText } from '../model/core';
import { mapDisplayTitle } from '../model/convert';
import { mapChoices, PORTAL_KIND_LABEL } from '../model/portals';
import { addPortal } from '../ui/portal';

type Tab = 'extraits' | 'cartes' | 'concepts' | 'idees';
const TABS: { id: Tab; label: string; icon: JSX.Element }[] = [
  { id: 'extraits', label: 'Extraits', icon: <Highlighter size={13} /> },
  { id: 'cartes', label: 'Autres cartes', icon: <Network size={13} /> },
  { id: 'concepts', label: 'Concepts', icon: <Lightbulb size={13} /> },
  { id: 'idees', label: 'Idées', icon: <StickyNote size={13} /> },
];
const LIMIT = 200;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function AddPanel({ boardKey, onClose }: { boardKey: string; onClose(): void }) {
  const [tab, setTab] = useState<Tab>('extraits');
  return (
    <aside className="board-add anim-slide" aria-label="Ajouter à la carte" data-testid="board-add">
      <header>
        <b>Ajouter</b>
        <span style={{ flex: 1 }} />
        <button className="icon-btn sm" title="Fermer" aria-label="Fermer" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="board-add-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`chip ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      {tab === 'extraits' && <ExtractsTab boardKey={boardKey} />}
      {tab === 'cartes' && <MapsTab boardKey={boardKey} />}
      {tab === 'concepts' && <ConceptsTab boardKey={boardKey} />}
      {tab === 'idees' && <IdeasTab boardKey={boardKey} />}
    </aside>
  );
}

const done = (n: number, what: [string, string], fem = false) =>
  useStore.getState().toast(`${plural(n, what[0], what[1])} ajouté${fem ? 'e' : ''}${n > 1 ? 's' : ''} à la carte`, 'success');

function Foot({ n, label, onAdd, onClear }: { n: number; label: string; onAdd(): void; onClear(): void }) {
  return (
    <footer className="board-add-foot">
      {n > 0 && (
        <button className="btn" onClick={onClear}>
          Décocher
        </button>
      )}
      <span style={{ flex: 1 }} />
      <button className="btn btn-primary" disabled={!n} onClick={onAdd} data-testid="board-add-confirm">
        {n ? `Ajouter ${label}` : 'Ajouter'}
      </button>
    </footer>
  );
}

function useToggleSet() {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return { sel, setSel, toggle, clear: () => setSel(new Set()) };
}

// ── Extraits ────────────────────────────────────────────────
function ExtractsTab({ boardKey }: { boardKey: string }) {
  const highlights = useStore((s) => s.highlights);
  const books = useStore((s) => s.books);
  const map = useStore((s) => s.maps[boardKey]);
  const [q, setQ] = useState('');
  const [bookId, setBookId] = useState<string>('');
  const [kind, setKind] = useState<ExtractKind | null>(null);
  const { sel, toggle, clear } = useToggleSet();
  const placed = useMemo(() => new Set((map?.nodes ?? []).map((n) => n.highlightId).filter(Boolean)), [map]);
  const title = useMemo(() => new Map(books.map((b) => [b.id, b.title])), [books]);
  const withHl = useMemo(() => books.filter((b) => highlights.some((h) => h.bookId === b.id)), [books, highlights]);
  const shown = useMemo(() => {
    const t = fold(q.trim());
    return [...highlights]
      .filter((h) => (!bookId || h.bookId === bookId) && (!kind || kindOf(h) === kind) && (!t || fold(`${h.text} ${h.note} ${title.get(h.bookId) ?? ''}`).includes(t)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [highlights, bookId, kind, q, title]);
  const chip = (id: ExtractKind, label: string, dot?: string) => (
    <button key={id} className={`chip ${kind === id ? 'active' : ''}`} onClick={() => setKind(kind === id ? null : id)}>
      {dot && <span className="cat-dot" style={{ background: dot }} />}
      {label}
    </button>
  );
  return (
    <>
      <div className="board-add-filters">
        <input className="input board-add-search" placeholder="Rechercher un extrait" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un extrait" />
        <select className="input board-add-select" value={bookId} onChange={(e) => setBookId(e.target.value)} aria-label="Livre">
          <option value="">Tous les livres</option>
          {withHl.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
        <div className="board-add-chips">
          {CATEGORIES.map((c) => chip(c.id, c.label, catColor(c.id)))}
          {chip('plain', 'Surlignages', 'var(--cat-plain)')}
          {chip('note', 'Notes')}
        </div>
      </div>
      <div className="board-add-list" role="listbox" aria-multiselectable="true" aria-label="Extraits">
        {shown.length === 0 && <p className="muted board-add-empty">{highlights.length ? 'Aucun extrait ne correspond.' : 'Aucun extrait pour l’instant : surlignez un passage dans un livre.'}</p>}
        {shown.slice(0, LIMIT).map((h) => {
          const already = placed.has(h.id);
          const on = sel.has(h.id);
          return (
            <label
              key={h.id}
              className={`board-add-row ${on ? 'on' : ''} ${already ? 'disabled' : ''}`}
              style={{ '--c': kindColor(h) } as CSSProperties}
              data-hl={h.id}
              draggable={!already}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/marginalia-hl', h.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <input type="checkbox" checked={on || already} disabled={already} onChange={() => toggle(h.id)} />
              <span className="board-add-body">
                <span className="board-add-cat">
                  {kindLabel(h)} · {title.get(h.bookId) ?? ''}
                </span>
                <span className="board-add-text">{h.text.replace(/\s+/g, ' ').trim()}</span>
                <span className="board-add-loc muted">{already ? 'Déjà sur la carte' : locatorOf(h)}</span>
              </span>
            </label>
          );
        })}
        {shown.length > LIMIT && <p className="muted board-add-empty">{shown.length - LIMIT} autres : affinez la recherche.</p>}
      </div>
      <Foot
        n={sel.size}
        label={plural(sel.size, 'extrait', 'extraits')}
        onClear={clear}
        onAdd={() => {
          const ids = placeHighlights(boardKey, [...sel]);
          clear();
          if (ids.length) done(ids.length, ['extrait', 'extraits']);
        }}
      />
    </>
  );
}

// ── Autres cartes ───────────────────────────────────────────
function MapsTab({ boardKey }: { boardKey: string }) {
  const maps = useStore((s) => s.maps);
  const books = useStore((s) => s.books);
  const highlights = useStore((s) => s.highlights);
  const [src, setSrc] = useState<string | null>(null);
  const { sel, setSel, toggle, clear } = useToggleSet();
  const lk = useMemo(() => lookup(), [highlights, books]);
  // Toutes les autres cartes (une carte libre vide peut recevoir un portail, pas être copiée).
  const sources = useMemo(
    () =>
      mapChoices(maps, lk, boardKey)
        .map((t) => ({ key: t.key, title: t.kind === 'board' ? t.title : mapDisplayTitle(t.map, lk), kind: PORTAL_KIND_LABEL[t.kind], n: t.nodeCount }))
        .sort((a, b) => a.title.localeCompare(b.title, 'fr')),
    [maps, boardKey, lk],
  );
  const portalTo = (key: string, title: string) => {
    if (addPortal(boardKey, key)) useStore.getState().toast(`Lien vers « ${title} » posé sur la carte`, 'success');
  };
  useEffect(() => clear(), [src]); // eslint-disable-line react-hooks/exhaustive-deps

  const source: ArgumentMap | undefined = src ? maps[src] : undefined;
  if (!source)
    return (
      <div className="board-add-list" aria-label="Cartes">
        {sources.length === 0 && <p className="muted board-add-empty">Aucune autre carte n’a encore de contenu.</p>}
        {sources.map((s) => (
          <div key={s.key} className="board-add-mapitem" data-map={s.key}>
            <button className="board-add-maprow" onClick={() => setSrc(s.key)} disabled={!s.n} title={s.n ? 'Choisir des cartes à copier' : 'Carte vide : rien à copier'}>
              <Network size={14} />
              <span className="board-add-body">
                <span className="board-add-text">{s.title}</span>
                <span className="board-add-loc muted">
                  {s.kind} · {s.n ? plural(s.n, 'carte', 'cartes') : 'vide'}
                </span>
              </span>
            </button>
            <button className="board-add-portal" data-act="add-portal" onClick={() => portalTo(s.key, s.title)} title="Poser sur cette carte un portail qui mène à celle-ci">
              <Waypoints size={13} /> Poser un lien vers cette carte
            </button>
          </div>
        ))}
      </div>
    );
  const linked = (id: string) => source.edges.filter((e) => e.source === id || e.target === id).length;
  const allOn = source.nodes.length > 0 && source.nodes.every((n) => sel.has(n.id));
  return (
    <>
      <div className="board-add-filters">
        <button className="btn btn-sm" onClick={() => setSrc(null)}>
          ← Toutes les cartes
        </button>
        <b className="board-add-srctitle truncate">{mapDisplayTitle(source, lk)}</b>
        <label className="board-add-all">
          <input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(source.nodes.map((n) => n.id)))} /> Tout cocher
        </label>
        <span className="muted board-add-hint">Les liens entre les cartes cochées sont copiés avec elles.</span>
      </div>
      <div className="board-add-list" role="listbox" aria-multiselectable="true" aria-label="Cartes de la carte choisie">
        {source.nodes.map((n) => {
          const cat = nodeCategory(n, lk);
          const on = sel.has(n.id);
          const nl = linked(n.id);
          return (
            <label key={n.id} className={`board-add-row ${on ? 'on' : ''}`} style={{ '--c': cat ? catColor(cat) : 'var(--muted)' } as CSSProperties} data-node={n.id}>
              <input type="checkbox" checked={on} onChange={() => toggle(n.id)} />
              <span className="board-add-body">
                <span className="board-add-cat">{cat ? CATEGORIES.find((c) => c.id === cat)?.label : n.conceptId ? 'Concept' : 'Idée'}</span>
                <span className="board-add-text">{nodeText(n, lk) || 'Carte vide'}</span>
                {nl > 0 && <span className="board-add-loc muted">{plural(nl, 'lien', 'liens')}</span>}
              </span>
            </label>
          );
        })}
      </div>
      <Foot
        n={sel.size}
        label={plural(sel.size, 'carte', 'cartes')}
        onClear={clear}
        onAdd={() => {
          const ids = copyNodesInto(boardKey, src!, [...sel]);
          clear();
          if (ids.length) done(ids.length, ['carte', 'cartes'], true);
          else useStore.getState().toast('Ces cartes sont déjà sur la carte', 'info');
        }}
      />
    </>
  );
}

// ── Concepts ────────────────────────────────────────────────
function ConceptsTab({ boardKey }: { boardKey: string }) {
  const concepts = useStore((s) => s.concepts);
  const map = useStore((s) => s.maps[boardKey]);
  const [q, setQ] = useState('');
  const { sel, toggle, clear } = useToggleSet();
  const have = useMemo(() => new Set((map?.nodes ?? []).map((n) => n.conceptId).filter(Boolean)), [map]);
  const shown = useMemo(() => {
    const t = fold(q.trim());
    return [...concepts].filter((c) => !t || fold(`${c.name} ${c.definition}`).includes(t)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [concepts, q]);
  return (
    <>
      <div className="board-add-filters">
        <input className="input board-add-search" placeholder="Rechercher un concept" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un concept" />
      </div>
      <div className="board-add-list" role="listbox" aria-multiselectable="true" aria-label="Concepts">
        {shown.length === 0 && <p className="muted board-add-empty">{concepts.length ? 'Aucun concept ne correspond.' : 'Aucun concept pour l’instant.'}</p>}
        {shown.slice(0, LIMIT).map((c) => {
          const already = have.has(c.id);
          const on = sel.has(c.id);
          return (
            <label key={c.id} className={`board-add-row ${on ? 'on' : ''} ${already ? 'disabled' : ''}`} style={{ '--c': 'var(--cat-concept)' } as CSSProperties}>
              <input type="checkbox" checked={on || already} disabled={already} onChange={() => toggle(c.id)} />
              <span className="board-add-body">
                <span className="board-add-text">{c.name}</span>
                <span className="board-add-loc muted">{already ? 'Déjà sur la carte' : c.definition.replace(/\s+/g, ' ').slice(0, 120)}</span>
              </span>
            </label>
          );
        })}
      </div>
      <Foot
        n={sel.size}
        label={plural(sel.size, 'concept', 'concepts')}
        onClear={clear}
        onAdd={() => {
          const ids = addConcepts(boardKey, [...sel]);
          clear();
          if (ids.length) done(ids.length, ['concept', 'concepts']);
        }}
      />
    </>
  );
}

// ── Idées ───────────────────────────────────────────────────
function IdeasTab({ boardKey }: { boardKey: string }) {
  const [text, setText] = useState('');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const add = () => {
    const ids = addIdeas(boardKey, lines);
    setText('');
    if (ids.length) done(ids.length, ['idée', 'idées'], true);
  };
  return (
    <>
      <div className="board-add-filters board-add-ideas">
        <textarea
          className="textarea"
          rows={8}
          placeholder={'Une idée par ligne.\nEx. : La liberté n’est pas l’absence de loi.'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
          aria-label="Idées, une par ligne"
        />
        <span className="muted board-add-hint">Chaque ligne devient une carte « idée ». ⌘↩ pour ajouter.</span>
      </div>
      <Foot n={lines.length} label={plural(lines.length, 'idée', 'idées')} onClear={() => setText('')} onAdd={add} />
    </>
  );
}

