// Rangements automatiques de la carte (algorithmes maison, sans dépendance) :
//  - « Arbre » : la thèse en haut, ce qui la soutient (ou l'attaque) dessous, de proche en proche ;
//  - « Débat » : la thèse à gauche, arguments puis objections à droite, réponses à côté des objections ;
//  - « Chronologique » : dans l'ordre du texte, les idées près des cartes qu'elles touchent ;
//  - « Radial » : carte mentale, le centre (problématique, sujet ou thèse) au milieu, ses branches autour (radial.ts).
// La racine (`centralId`) est le centre de la carte s'il y en a un (model/center.ts), sinon la thèse centrale.
import type { CategoryId, RelationId } from '../../../lib/types';
import type { Pt } from './geom';
import { radialPositions } from './radial';

export type LayoutKind = 'arbre' | 'debat' | 'chrono' | 'radial';

export const LAYOUTS: { id: LayoutKind; label: string; hint: string }[] = [
  { id: 'arbre', label: 'Arbre', hint: 'La thèse en haut, les arguments dessous' },
  { id: 'debat', label: 'Débat', hint: 'La thèse à gauche, objections et réponses à droite' },
  { id: 'chrono', label: 'Chronologique', hint: 'Dans l’ordre du texte' },
  { id: 'radial', label: 'Radial', hint: 'Le centre au milieu, les branches tout autour' },
];

export interface LNode {
  id: string;
  w: number;
  h: number;
  category: CategoryId | null;
  idea: boolean;
  /** Rang dans l'ordre du texte (extraits) ; null pour une idée. */
  textRank: number | null;
  /** Carte multi-livres : rang du livre de l'extrait (une colonne par livre en chronologique). */
  book?: number | null;
}
export interface LEdge {
  source: string;
  target: string;
  relation: RelationId;
}

const CAT_ORDER: (CategoryId | null)[] = ['these', 'probleme', 'argument', 'objection', 'concept', 'exemple', null];
const REL_ORDER: RelationId[] = ['repond', 'rattache', 'soutient', 'precise', 'illustre', 'repond', 'objecte', 'oppose'];
const CONTRA = new Set<RelationId>(['objecte', 'oppose']);

interface Forest {
  roots: string[];
  children: Map<string, { id: string; rel: RelationId }[]>;
  isolated: string[];
}

/** Arbre couvrant : le parent d'une carte est la cible de son premier lien sortant (A soutient B ⇒ B parent de A). */
function forest(nodes: LNode[], edges: LEdge[], centralId: string | null): Forest {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rank = (id: string) => {
    const n = byId.get(id)!;
    return n.textRank ?? 1e9;
  };
  const connected = new Set<string>();
  for (const e of edges) {
    if (byId.has(e.source) && byId.has(e.target) && e.source !== e.target) {
      connected.add(e.source);
      connected.add(e.target);
    }
  }
  const parent = new Map<string, { id: string; rel: RelationId }>();
  const sorted = [...edges]
    .filter((e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target)
    .sort((a, b) => REL_ORDER.indexOf(a.relation) - REL_ORDER.indexOf(b.relation));
  // La thèse centrale reste une racine.
  for (const e of sorted) {
    if (e.source === centralId || parent.has(e.source)) continue;
    // Pas de cycle : on remonte la chaîne de la cible.
    let p: string | undefined = e.target;
    let cyc = false;
    for (let k = 0; p && k < 500; k++) {
      if (p === e.source) {
        cyc = true;
        break;
      }
      p = parent.get(p)?.id;
    }
    if (!cyc) parent.set(e.source, { id: e.target, rel: e.relation });
  }
  const children = new Map<string, { id: string; rel: RelationId }[]>();
  for (const [c, p] of parent) children.set(p.id, [...(children.get(p.id) ?? []), { id: c, rel: p.rel }]);
  for (const list of children.values())
    list.sort((a, b) => REL_ORDER.indexOf(a.rel) - REL_ORDER.indexOf(b.rel) || rank(a.id) - rank(b.id));
  const catRank = (id: string) => CAT_ORDER.indexOf(byId.get(id)!.category);
  const roots = nodes
    .filter((n) => connected.has(n.id) && !parent.has(n.id))
    .map((n) => n.id)
    .sort((a, b) => (a === centralId ? -1 : b === centralId ? 1 : 0) || catRank(a) - catRank(b) || rank(a) - rank(b));
  const isolated = nodes
    .filter((n) => !connected.has(n.id))
    .map((n) => n.id)
    .sort((a, b) => (a === centralId ? -1 : b === centralId ? 1 : 0) || catRank(a) - catRank(b) || rank(a) - rank(b));
  // Une thèse isolée reste une racine (en tête), le reste va dans la grille du bas.
  const isoRoots = isolated.filter((id) => id === centralId || byId.get(id)!.category === 'these');
  return { roots: [...isoRoots.filter((id) => id === centralId), ...roots, ...isoRoots.filter((id) => id !== centralId)], children, isolated: isolated.filter((id) => !isoRoots.includes(id)) };
}

function grid(ids: string[], size: Map<string, LNode>, x0: number, y0: number, cols: number, gx: number, gy: number, out: Map<string, Pt>): number {
  // Colonnes régulières : largeur de chaque colonne = sa carte la plus large.
  const cw = Array.from({ length: cols }, (_, c) => Math.max(0, ...ids.filter((_, i) => i % cols === c).map((id) => size.get(id)!.w)));
  let y = y0;
  for (let i = 0; i < ids.length; i += cols) {
    const row = ids.slice(i, i + cols);
    let x = x0;
    let rh = 0;
    row.forEach((id, c) => {
      const n = size.get(id)!;
      out.set(id, { x: x + (cw[c] - n.w) / 2, y });
      x += cw[c] + gx;
      rh = Math.max(rh, n.h);
    });
    y += rh + gy;
  }
  return y;
}

function tree(nodes: LNode[], edges: LEdge[], centralId: string | null, horizontal: boolean): Map<string, Pt> {
  const size = new Map(nodes.map((n) => [n.id, n]));
  const f = forest(nodes, edges, centralId);
  const out = new Map<string, Pt>();
  // Axe principal (profondeur) et axe secondaire (frères).
  const along = (id: string) => (horizontal ? size.get(id)!.w : size.get(id)!.h);
  const across = (id: string) => (horizontal ? size.get(id)!.h : size.get(id)!.w);
  const SIB = horizontal ? 28 : 36;
  const LEVEL = horizontal ? 150 : 84;
  const CONTRA_GAP = horizontal ? 44 : 60;

  // Profondeurs, et taille max par niveau
  const depth = new Map<string, number>();
  const visit = (id: string, d: number) => {
    depth.set(id, d);
    for (const c of f.children.get(id) ?? []) visit(c.id, d + 1);
  };
  f.roots.forEach((r) => visit(r, 0));
  const maxAlong: number[] = [];
  for (const [id, d] of depth) maxAlong[d] = Math.max(maxAlong[d] ?? 0, along(id));
  const levelPos: number[] = [];
  let acc = 0;
  for (let d = 0; d < maxAlong.length; d++) {
    levelPos[d] = acc;
    acc += (maxAlong[d] ?? 0) + LEVEL;
  }

  // Largeur des sous-arbres (axe secondaire)
  const span = new Map<string, number>();
  const gapBefore = (list: { rel: RelationId }[], i: number) => (i === 0 ? 0 : SIB + (CONTRA.has(list[i].rel) && !CONTRA.has(list[i - 1].rel) ? CONTRA_GAP : 0));
  const measure = (id: string): number => {
    const kids = f.children.get(id) ?? [];
    let s = 0;
    kids.forEach((k, i) => (s += gapBefore(kids, i) + measure(k.id)));
    const v = Math.max(across(id), s);
    span.set(id, v);
    return v;
  };
  const place = (id: string, start: number) => {
    const sp = span.get(id)!;
    const d = depth.get(id)!;
    const kids = f.children.get(id) ?? [];
    let kidsSpan = 0;
    kids.forEach((k, i) => (kidsSpan += gapBefore(kids, i) + span.get(k.id)!));
    // Le parent est centré sur ses enfants (arbre : horizontalement ; débat : verticalement).
    const self = start + (sp - across(id)) / 2;
    out.set(id, horizontal ? { x: levelPos[d], y: self } : { x: self, y: levelPos[d] });
    let c = start + (sp - kidsSpan) / 2;
    kids.forEach((k, i) => {
      c += gapBefore(kids, i);
      place(k.id, c);
      c += span.get(k.id)!;
    });
  };
  let cursor = 0;
  const ROOT_GAP = horizontal ? 64 : 96;
  for (const r of f.roots) {
    measure(r);
    place(r, cursor);
    cursor += span.get(r)! + ROOT_GAP;
  }
  // Cartes sans lien : grille sous (ou après) l'ensemble.
  if (f.isolated.length) {
    const placed = [...out.entries()].map(([id, p]) => ({ ...p, w: size.get(id)!.w, h: size.get(id)!.h }));
    const bottom = placed.length ? Math.max(...placed.map((p) => p.y + p.h)) + 110 : 0;
    const right = placed.length ? Math.max(...placed.map((p) => p.x + p.w)) : 0;
    const cols = Math.max(2, Math.min(5, Math.round(Math.max(right, 900) / 330)));
    grid(f.isolated, size, 0, bottom, cols, 36, 40, out);
  }
  return out;
}

function chrono(nodes: LNode[], edges: LEdge[]): Map<string, Pt> {
  const size = new Map(nodes.map((n) => [n.id, n]));
  const extracts = nodes.filter((n) => !n.idea).sort((a, b) => (a.textRank ?? 0) - (b.textRank ?? 0));
  const ideas = nodes.filter((n) => n.idea);
  const seq: string[] = extracts.map((n) => n.id);
  // Les idées rejoignent leur voisin (lien direct), juste après lui ; sinon à la fin.
  const pending = [...ideas];
  for (let pass = 0; pass < 4 && pending.length; pass++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const idea = pending[i];
      const nb = edges.find((e) => (e.source === idea.id && seq.includes(e.target)) || (e.target === idea.id && seq.includes(e.source)));
      if (!nb) continue;
      const other = nb.source === idea.id ? nb.target : nb.source;
      let at = seq.indexOf(other) + 1;
      while (at < seq.length && size.get(seq[at])!.idea) at++;
      seq.splice(at, 0, idea.id);
      pending.splice(i, 1);
    }
  }
  seq.push(...pending.map((n) => n.id));
  const out = new Map<string, Pt>();
  // Plusieurs livres : une colonne par livre, chacune dans l'ordre du texte (les idées
  // suivent la carte qu'elles touchent ; les idées isolées ferment la marche à droite).
  const books = [...new Set(extracts.map((n) => n.book ?? 0))].sort((a, b) => a - b);
  if (books.length > 1) {
    const colOf = new Map<string, number>();
    let cur = books.length;
    for (const id of seq) {
      const n = size.get(id)!;
      if (!n.idea) cur = books.indexOf(n.book ?? 0);
      else if (!edges.some((e) => e.source === id || e.target === id)) cur = books.length;
      colOf.set(id, cur);
    }
    let x = 0;
    for (let c = 0; c <= books.length; c++) {
      const ids = seq.filter((id) => colOf.get(id) === c);
      if (!ids.length) continue;
      const w = Math.max(...ids.map((id) => size.get(id)!.w));
      let y = 0;
      for (const id of ids) {
        const n = size.get(id)!;
        out.set(id, { x: x + (w - n.w) / 2, y });
        y += n.h + 56;
      }
      x += w + 150;
    }
    return out;
  }
  const cols = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(seq.length * 1.4))));
  grid(seq, size, 0, 0, cols, 72, 80, out);
  return out;
}

/** Radial : l'arbre de la racine en couronnes ; le reste (autres racines, cartes isolées) en arbre dessous. */
function radial(nodes: LNode[], edges: LEdge[], centralId: string | null): Map<string, Pt> {
  const size = new Map(nodes.map((n) => [n.id, n]));
  const f = forest(nodes, edges, centralId);
  const root = centralId && f.roots.includes(centralId) ? centralId : f.roots.length === 1 ? f.roots[0] : null;
  const pos = radialPositions(root, root ? [] : f.roots, f.children, size);
  const rest = nodes.filter((n) => !pos.has(n.id));
  if (!rest.length) return pos;
  const ids = new Set(rest.map((n) => n.id));
  const sub = tree(rest, edges.filter((e) => ids.has(e.source) && ids.has(e.target)), null, false);
  const placed = [...pos].map(([id, p]) => ({ ...p, w: size.get(id)!.w, h: size.get(id)!.h }));
  const bottom = placed.length ? Math.max(...placed.map((p) => p.y + p.h)) + 140 : 0;
  const left = placed.length ? Math.min(...placed.map((p) => p.x)) : 0;
  const sx = Math.min(...[...sub.values()].map((p) => p.x));
  const sy = Math.min(...[...sub.values()].map((p) => p.y));
  for (const [id, p] of sub) pos.set(id, { x: p.x - sx + left, y: p.y - sy + bottom });
  return pos;
}

/** Positions cibles (coordonnées de la carte, coin haut-gauche), recalées sur l'ancien coin haut-gauche. */
export function layoutMap(kind: LayoutKind, nodes: LNode[], edges: LEdge[], centralId: string | null, origin: Pt): Map<string, Pt> {
  if (!nodes.length) return new Map();
  const raw = kind === 'chrono' ? chrono(nodes, edges) : kind === 'radial' ? radial(nodes, edges, centralId) : tree(nodes, edges, centralId, kind === 'debat');
  const xs = [...raw.values()].map((p) => p.x);
  const ys = [...raw.values()].map((p) => p.y);
  const dx = origin.x - Math.min(...xs);
  const dy = origin.y - Math.min(...ys);
  const out = new Map<string, Pt>();
  for (const [id, p] of raw) out.set(id, { x: Math.round(p.x + dx), y: Math.round(p.y + dy) });
  return out;
}
