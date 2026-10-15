// ─────────────────────────────────────────────────────────────
// Outils communs du modèle de carte (purs, sans store ni DOM).
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, Book, CategoryId, Highlight, MapEdge, MapNode, RelationId, TextStudy } from '../../../lib/types';

/** Données nécessaires pour lire une carte (extraits, livres, fiches-texte). */
export interface MapLookup {
  highlights: Highlight[];
  books: Book[];
  studies?: TextStudy[];
}

/** Clé d'une carte dans `Database.maps` (cartes de livre : bookId ; autres : id). */
export const mapKeyOf = (m: ArgumentMap): string => m.id ?? m.bookId;

/** Nature d'une carte (bases anciennes : 'book'). */
export const mapKindOf = (m: ArgumentMap): 'book' | 'board' | 'movement' => m.kind ?? 'book';

/** Livres dont une carte peut citer des extraits. */
export function mapBookIds(m: ArgumentMap, lk?: MapLookup): string[] {
  const ids = new Set<string>();
  if (m.bookId) ids.add(m.bookId);
  for (const b of m.bookIds ?? []) ids.add(b);
  if (lk) {
    const hl = new Map(lk.highlights.map((h) => [h.id, h]));
    for (const n of m.nodes) {
      const h = n.highlightId ? hl.get(n.highlightId) : null;
      if (h) ids.add(h.bookId);
    }
  }
  return [...ids];
}

export const clean = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim();

export function highlightOf(n: MapNode, lk: MapLookup): Highlight | null {
  return n.highlightId ? (lk.highlights.find((h) => h.id === n.highlightId) ?? null) : null;
}

/** Texte affiché d'une carte : l'extrait cité, ou le texte de l'idée. */
export function nodeText(n: MapNode, lk: MapLookup): string {
  const h = highlightOf(n, lk);
  return clean(h ? h.text : n.text);
}

/** Catégorie d'une carte (celle de son extrait ; idée : null). */
export function nodeCategory(n: MapNode, lk: MapLookup): CategoryId | null {
  return highlightOf(n, lk)?.category ?? null;
}

export const incoming = (m: ArgumentMap, id: string, rel?: RelationId | RelationId[]): MapEdge[] =>
  m.edges.filter((e) => e.target === id && (!rel || (Array.isArray(rel) ? rel.includes(e.relation) : e.relation === rel)));
export const outgoing = (m: ArgumentMap, id: string, rel?: RelationId | RelationId[]): MapEdge[] =>
  m.edges.filter((e) => e.source === id && (!rel || (Array.isArray(rel) ? rel.includes(e.relation) : e.relation === rel)));

/** Copie profonde (JSON) d'une carte. */
export const cloneMap = (m: ArgumentMap): ArgumentMap => JSON.parse(JSON.stringify(m));

/** Compteur d'identifiants injectable (les tests passent un générateur déterministe). */
export type IdFn = () => string;
export const defaultId: IdFn = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
