// Cartes-documents : une carte posée sur le liège qui renvoie vers un écrit, un livre (vidéo et
// image comprises) ou un plan. Modèle pur ; la carte React Flow est dans ui/docNode.tsx.
import type { Book, Draft, EssayPlan, MapDocRef, MapNode } from '../../../lib/types';

export function docNode(ref: MapDocRef, at: { x: number; y: number }, id: string, title = ''): MapNode {
  return { id, highlightId: null, text: title, x: Math.round(at.x), y: Math.round(at.y), doc: { kind: ref.kind, id: ref.id } };
}

export interface DocLookup {
  books: Book[];
  drafts: Draft[];
  plans: EssayPlan[];
}

export type DocKindLabel = 'Écrit' | 'Livre' | 'Vidéo' | 'Image' | 'Plan';

export interface DocTarget {
  label: DocKindLabel;
  title: string;
  book?: Book;
  draft?: Draft;
  plan?: EssayPlan;
}

/** L'original d'une carte-document, ou null s'il n'existe plus (supprimé, à la corbeille). */
export function docTarget(ref: MapDocRef, lk: DocLookup): DocTarget | null {
  if (ref.kind === 'book') {
    const b = lk.books.find((x) => x.id === ref.id);
    if (!b) return null;
    return { label: b.format === 'video' ? 'Vidéo' : b.format === 'image' ? 'Image' : 'Livre', title: b.title || 'Sans titre', book: b };
  }
  if (ref.kind === 'draft') {
    const d = lk.drafts.find((x) => x.id === ref.id);
    return d ? { label: 'Écrit', title: d.title || 'Sans titre', draft: d } : null;
  }
  const p = lk.plans.find((x) => x.id === ref.id);
  return p ? { label: 'Plan', title: p.sujet.trim() || p.title || 'Plan sans titre', plan: p } : null;
}

/** Documents déjà posés sur la carte (clé « kind:id »). */
export const docKey = (r: MapDocRef) => `${r.kind}:${r.id}`;
export const placedDocs = (nodes: MapNode[]) => new Set(nodes.filter((n) => n.doc).map((n) => docKey(n.doc!)));
