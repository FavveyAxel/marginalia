// 13. « Comparer deux auteurs » : carte libre avec les thèses et arguments de deux livres, une colonne
// par livre (placée par le modèle : addHighlightNodes, zones), prête à relier par « s’oppose à ».
// Les liens que chaque livre a déjà sur sa propre carte entre ces extraits sont repris.
import { separateUndoStep, uid, useStore } from '../../../../lib/store';
import type { ArgumentMap, Highlight, MapEdge, Route } from '../../../../lib/types';
import { compareAnchors } from '../../../study/studyUtils';
import { addHighlightNodes } from '../../model/boards';
import { createBoard, updateMap } from '../../model/actions';
import { NODE_W, nodeRect } from '../../model/geometry';
import { createZoneAround } from '../../model/zones';
import { bookShortName } from '../../ArgumentMapView';

const S = () => useStore.getState();

/** Espace d'où l'on vient (pour y ranger la carte de comparaison créée depuis un livre). */
let origin: { workspaceId: string; groupId: string | null } | null = null;
useStore.subscribe((s, prev) => {
  if (s.route === prev.route) return;
  const r: Route = s.route;
  if (r.name === 'workspace') origin = { workspaceId: r.workspaceId, groupId: r.groupId };
  else if (r.name !== 'reader' && r.name !== 'board') origin = null;
});
export const originWorkspace = () => (origin && S().workspaces.some((w) => w.id === origin!.workspaceId) ? origin : null);

/** Extraits retenus pour un livre : thèses puis arguments (ordre du texte) ; à défaut problèmes et thèses adverses. */
export function compareExtracts(bookId: string): { theses: Highlight[]; args: Highlight[]; fallback: boolean } {
  const all = S().highlights.filter((h) => h.bookId === bookId);
  const by = (c: Highlight['category']) => all.filter((h) => h.category === c).sort((a, b) => compareAnchors(a.anchor, b.anchor));
  const theses = by('these');
  const args = by('argument');
  if (theses.length || args.length) return { theses, args, fallback: false };
  return { theses: by('probleme'), args: by('objection'), fallback: true };
}

const COL_GAP = 240;
const ROW_GAP = 64;

/** Crée la carte de comparaison ; renvoie sa clé. `into` : espace (et groupe) où la ranger. */
export function compareBooks(a: string, b: string, into?: { workspaceId: string; groupId: string | null } | null): string | null {
  const books = S().books;
  const A = books.find((x) => x.id === a);
  const B = books.find((x) => x.id === b);
  if (!A || !B || a === b) return null;
  const title = `${bookShortName(A)} / ${bookShortName(B)}`;
  separateUndoStep();
  const key = createBoard(title, [a, b]);
  const lk = { highlights: S().highlights, books: S().books };
  updateMap(key, (m0) => {
    let m: ArgumentMap = m0;
    [A, B].forEach((book, col) => {
      const { theses, args } = compareExtracts(book.id);
      const list = [...theses, ...args];
      const x = col * (NODE_W + COL_GAP);
      let y = 0;
      const ids: string[] = [];
      for (const h of list) {
        const r = addHighlightNodes(m, [h], { id: uid, at: { x, y }, columns: 1 });
        if (!r.nodeIds.length) continue;
        m = r.map;
        ids.push(r.nodeIds[0]);
        const n = m.nodes.find((k) => k.id === r.nodeIds[0])!;
        // Hauteur estimée d'un extrait replié sur 3 lignes (+ référence, concepts) : la colonne ne se chevauche pas.
        y += nodeRect({ ...n, collapsed: true }, h.text).h + ROW_GAP + (h.note.trim() ? 40 : 0) + (h.conceptIds.length ? 24 : 0);
      }
      // Liens que le livre a déjà sur sa propre carte, entre ces extraits.
      const own = S().maps[book.id];
      if (own && ids.length > 1) {
        const byHl = new Map(m.nodes.filter((n) => ids.includes(n.id)).map((n) => [n.highlightId!, n.id]));
        const src = new Map(own.nodes.map((n) => [n.id, n.highlightId]));
        const edges: MapEdge[] = [];
        for (const e of own.edges) {
          const s = byHl.get(src.get(e.source) ?? '');
          const t = byHl.get(src.get(e.target) ?? '');
          if (s && t && s !== t) edges.push({ id: uid(), source: s, target: t, relation: e.relation, groupId: null, ...(e.strength ? { strength: e.strength } : {}) });
        }
        if (edges.length) m = { ...m, edges: [...m.edges, ...edges] };
      }
      if (ids.length) m = createZoneAround(m, ids, { title: bookShortName(book) || book.title, color: col ? '--cat-objection' : '--cat-these', lookup: lk, id: uid }).map;
    });
    return m;
  });
  if (into && S().workspaces.some((w) => w.id === into.workspaceId)) S().addToWorkspace(into.workspaceId, into.groupId, 'map', key);
  return key;
}
