// Vue « Cartes » : toutes les cartes de l'app d'un coup d'œil — combien il y en a et où elles sont
// rangées (espaces de travail, livres, fiches-texte). Un clic ouvre la carte ; un clic sur un lieu
// ouvre l'espace ou le livre.
import { useMemo, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BookOpen, Folder, Network, Plus, Search, Waypoints } from 'lucide-react';
import { useStore } from '../../lib/store';
import type { ArgumentMap } from '../../lib/types';
import { BoardThumb } from '../map/ui/BoardThumb';
import { createBoard } from '../map/model/actions';
import { goToMovementMap, movementShort } from '../map/ui/movement/movement';
import './maps.css';

type Kind = 'board' | 'book' | 'movement';
type Place = { key: string; label: string; tint?: string; open(): void };
interface Row {
  key: string;
  map: ArgumentMap;
  kind: Kind;
  title: string;
  /** Espaces de travail où la carte est rangée (directement, ou via son livre). */
  spaces: Place[];
  /** Livre d'origine (carte de livre, de mouvement). */
  book: Place | null;
  updatedAt: number;
}

const KIND_LABEL: Record<Kind, string> = { board: 'Carte libre', book: 'Carte de livre', movement: 'Carte de mouvement' };
const FILTERS: { id: Kind | 'all'; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'board', label: 'Libres' },
  { id: 'book', label: 'De livres' },
  { id: 'movement', label: 'De mouvements' },
];

const plural = (n: number, one: string, many = one + 's') => `${n} ${n > 1 ? many : one}`;

function useRows(): Row[] {
  const { maps, books, workspaces, groups, wsItems } = useStore(
    useShallow((s) => ({ maps: s.maps, books: s.books, workspaces: s.workspaces, groups: s.groups, wsItems: s.wsItems })),
  );
  return useMemo(() => {
    const s = useStore.getState();
    const nav = s.navigate;
    const bookById = new Map(books.map((b) => [b.id, b]));
    const wsById = new Map(workspaces.map((w) => [w.id, w]));
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const placeOf = (workspaceId: string, groupId: string | null): Place | null => {
      const w = wsById.get(workspaceId);
      if (!w) return null;
      const path: string[] = [];
      for (let g = groupId ? groupById.get(groupId) : undefined; g; g = g.parentId ? groupById.get(g.parentId) : undefined) path.unshift(g.name);
      return {
        key: workspaceId + ':' + (groupId ?? ''),
        label: [w.name, ...path].join(' › '),
        tint: w.tint,
        open: () => nav({ name: 'workspace', workspaceId, groupId }),
      };
    };
    const spacesOf = (kind: 'map' | 'book', refId: string): Place[] => {
      const out: Place[] = [];
      const seen = new Set<string>();
      for (const i of wsItems) {
        if (i.kind !== kind || i.refId !== refId) continue;
        const p = placeOf(i.workspaceId, i.groupId);
        if (p && !seen.has(p.key)) (seen.add(p.key), out.push(p));
      }
      return out;
    };
    const rows: Row[] = [];
    for (const [key, m] of Object.entries(maps)) {
      const kind: Kind = m.kind === 'board' ? 'board' : m.kind === 'movement' ? 'movement' : 'book';
      // Les cartes de livre et de mouvement existent dès qu'on ouvre l'onglet : seules les non vides comptent.
      if (kind !== 'board' && !m.nodes.length) continue;
      const b = kind === 'board' ? undefined : bookById.get(m.bookId);
      if (kind !== 'board' && !b) continue;
      const book: Place | null = b
        ? { key: 'b:' + b.id, label: b.title, open: () => nav({ name: 'reader', bookId: b.id, tab: 'lecture', splitBookId: null }) }
        : null;
      const title =
        kind === 'board' ? m.title?.trim() || 'Carte sans titre' : kind === 'movement' ? movementShort(m) : `Carte de « ${b!.title} »`;
      rows.push({
        key,
        map: m,
        kind,
        title,
        spaces: kind === 'board' ? spacesOf('map', key) : spacesOf('book', m.bookId),
        book,
        updatedAt: m.updatedAt ?? m.createdAt ?? 0,
      });
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [maps, books, workspaces, groups, wsItems]);
}

function openRow(r: Row) {
  const s = useStore.getState();
  if (r.kind === 'board') s.navigate({ name: 'board', boardId: r.key });
  else if (r.kind === 'movement' && r.map.studyId && r.map.movementId) goToMovementMap(r.map.studyId, r.map.movementId);
  else s.navigate({ name: 'reader', bookId: r.map.bookId, tab: 'carte', splitBookId: null });
}

function MapCard({ r, i }: { r: Row; i: number }) {
  const n = r.map.nodes.length;
  const links = r.map.edges.length;
  return (
    <div className="mv-card lift" style={{ '--i': i } as CSSProperties} data-map-key={r.key} data-kind={r.kind}>
      <button className="mv-open" onClick={() => openRow(r)} aria-label={`Ouvrir ${r.title}`}>
        <div className={`mv-thumb mv-thumb-${r.kind}`}>
          <BoardThumb map={r.map} />
        </div>
        <div className="mv-body">
          <span className="mv-kind">{KIND_LABEL[r.kind]}</span>
          <span className="mv-title">{r.title}</span>
          <span className="mv-meta muted">
            {n ? plural(n, 'carte') : 'Vide'}
            {links > 0 && ` · ${plural(links, 'lien')}`}
            {r.updatedAt > 0 && ` · ${new Date(r.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`}
          </span>
        </div>
      </button>
      <div className="mv-places" data-testid="map-places">
        {r.book && (
          <button className="mv-place" onClick={r.book.open} title={`Ouvrir ${r.book.label}`}>
            <BookOpen size={11} /> <span className="truncate">{r.book.label}</span>
          </button>
        )}
        {r.spaces.map((p) => (
          <button key={p.key} className="mv-place" onClick={p.open} title={`Ouvrir l’espace ${p.label}`}>
            <span className="mv-dot" style={{ background: p.tint ? `var(${p.tint})` : undefined }} />
            <span className="truncate">{p.label}</span>
          </button>
        ))}
        {r.kind === 'board' && !r.spaces.length && (
          <span className="mv-place mv-place-none">
            <Folder size={11} /> Non rangée
          </span>
        )}
      </div>
    </div>
  );
}

export function MapsView() {
  const rows = useRows();
  const workspaces = useStore((s) => s.workspaces);
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [byPlace, setByPlace] = useState(true);
  const [q, setQ] = useState('');
  const count = (k: Kind) => rows.filter((r) => r.kind === k).length;
  const needle = q.trim().toLocaleLowerCase('fr');
  const shown = rows.filter(
    (r) =>
      (filter === 'all' || r.kind === filter) &&
      (!needle || [r.title, r.book?.label ?? '', ...r.spaces.map((p) => p.label)].join(' ').toLocaleLowerCase('fr').includes(needle)),
  );

  // Regroupement par lieu : chaque espace (une carte rangée dans deux espaces apparaît dans les deux),
  // puis les cartes hors espace.
  const sections = useMemo(() => {
    if (!byPlace) return [{ id: 'all', label: '', tint: undefined as string | undefined, rows: shown }];
    const out = [...workspaces]
      .sort((a, b) => a.order - b.order)
      .map((w) => ({ id: w.id, label: w.name, tint: w.tint as string | undefined, rows: shown.filter((r) => r.spaces.some((p) => p.key.startsWith(w.id + ':'))) }))
      .filter((s) => s.rows.length);
    const loose = shown.filter((r) => !r.spaces.length);
    if (loose.length) out.push({ id: 'none', label: 'Hors espace de travail', tint: undefined, rows: loose });
    return out;
  }, [byPlace, shown, workspaces]);

  const newBoard = () => {
    const key = createBoard('Nouvelle carte');
    useStore.getState().navigate({ name: 'board', boardId: key });
  };

  return (
    <div className="mv">
      <header className="topbar">
        <div className="spacer" />
        <button className="btn" onClick={newBoard} data-testid="maps-new">
          <Plus size={14} /> Nouvelle carte
        </button>
      </header>
      <div className="mv-scroll">
        <div className="mv-inner anim-view">
          <div className="mv-head">
            <h1 className="page-title">Cartes</h1>
            <p className="muted" data-testid="maps-summary">
              {rows.length
                ? `${plural(rows.length, 'carte')} : ${[
                    count('board') && plural(count('board'), 'libre'),
                    count('book') && `${count('book')} de livre${count('book') > 1 ? 's' : ''}`,
                    count('movement') && `${count('movement')} de mouvement${count('movement') > 1 ? 's' : ''}`,
                  ]
                    .filter(Boolean)
                    .join(', ')}`
                : 'Les cartes argumentatives de vos livres et les cartes libres de vos espaces apparaîtront ici.'}
            </p>
          </div>
          {rows.length > 0 && (
            <div className="mv-tools">
              <div className="segmented" role="radiogroup" aria-label="Type de carte">
                {FILTERS.map((f) => {
                  const n = f.id === 'all' ? rows.length : count(f.id);
                  if (!n && f.id !== filter) return null;
                  return (
                    <button key={f.id} role="radio" aria-checked={filter === f.id} className={filter === f.id ? 'active' : ''} onClick={() => setFilter(f.id)}>
                      {f.label} <span className="mv-n">{n}</span>
                    </button>
                  );
                })}
              </div>
              <div className="segmented" role="radiogroup" aria-label="Présentation">
                <button role="radio" aria-checked={byPlace} className={byPlace ? 'active' : ''} onClick={() => setByPlace(true)}>
                  Par espace
                </button>
                <button role="radio" aria-checked={!byPlace} className={!byPlace ? 'active' : ''} onClick={() => setByPlace(false)}>
                  Récentes
                </button>
              </div>
              <label className="mv-search">
                <Search size={13} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une carte, un livre, un espace" />
              </label>
            </div>
          )}
          {rows.length === 0 ? (
            <div className="empty anim-in">
              <Waypoints size={28} className="muted" />
              <h3>Aucune carte pour l’instant</h3>
              <p>Ouvrez l’onglet « Carte » d’un livre pour disposer ses extraits, ou créez une carte libre pour croiser plusieurs livres.</p>
              <button className="btn btn-primary" onClick={newBoard}>
                <Network size={14} /> Nouvelle carte libre
              </button>
            </div>
          ) : shown.length === 0 ? (
            <p className="muted mv-none">Aucune carte ne correspond.</p>
          ) : (
            sections.map((sec) => (
              <section key={sec.id} className="mv-section" data-testid={`maps-section-${sec.id}`}>
                {sec.label && (
                  <h2 className="mv-section-title">
                    {sec.tint ? <span className="mv-dot" style={{ background: `var(${sec.tint})` }} /> : <Folder size={13} />}
                    {sec.label}
                    <span className="mv-n">{sec.rows.length}</span>
                  </h2>
                )}
                <div className="mv-grid anim-stagger">
                  {sec.rows.map((r, i) => (
                    <MapCard key={r.key} r={r} i={i} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
