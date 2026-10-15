// Rangement « Radial » (carte mentale) : le centre au milieu, ses branches tout autour.
//
// Chaque branche reçoit un secteur d'angle proportionnel à son nombre de feuilles ; les cartes
// d'une même profondeur sont posées sur une même couronne (ellipse, plus large que haute, car
// les cartes le sont). La première branche part à gauche, les suivantes tournent dans le sens
// des aiguilles d'une montre (deux branches : gauche / droite, comme un débat). Si deux cartes se
// chevauchent, toutes les couronnes s'élargissent d'un cran, jusqu'à ce que plus rien ne se touche.
// Sans centre ni thèse centrale, les racines se partagent le cercle autour d'un centre vide.
import type { Pt } from './geom';

interface Size {
  w: number;
  h: number;
}

/** Ellipse : les cartes sont plus larges que hautes. */
const EX = 1.3;
const EY = 0.78;
const RING = 290;
const GAP = 26;

/**
 * Positions (coin haut-gauche) des cartes de l'arbre issu de `root` (ou des `roots`, autour d'un
 * centre vide si `root` est null). `children` : arbre couvrant (une carte = un parent).
 */
export function radialPositions(root: string | null, roots: string[], children: Map<string, { id: string }[]>, size: Map<string, Size>): Map<string, Pt> {
  const kids = (id: string | null): string[] => (id == null ? roots : (children.get(id) ?? []).map((c) => c.id));
  const weight = new Map<string, number>();
  const seen = new Set<string>();
  const leaves = (id: string): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const ks = kids(id);
    const w = ks.length ? ks.reduce((a, k) => a + leaves(k), 0) : 1;
    weight.set(id, Math.max(1, w));
    return Math.max(1, w);
  };
  const first = kids(root);
  const total = first.reduce((a, k) => a + leaves(k), 0) || 1;

  // Angle et profondeur de chaque carte.
  const polar = new Map<string, { a: number; d: number }>();
  const TAU = Math.PI * 2;
  const assign = (id: string, a0: number, span: number, d: number) => {
    polar.set(id, { a: a0 + span / 2, d });
    const ks = kids(id);
    const sum = ks.reduce((s, k) => s + (weight.get(k) ?? 1), 0) || 1;
    let a = a0;
    for (const k of ks) {
      const sp = (span * (weight.get(k) ?? 1)) / sum;
      assign(k, a, sp, d + 1);
      a += sp;
    }
  };
  const firstSpan = (TAU * (weight.get(first[0]) ?? 1)) / total;
  let a = Math.PI - firstSpan / 2;
  for (const k of first) {
    const sp = (TAU * (weight.get(k) ?? 1)) / total;
    assign(k, a, sp, 1);
    a += sp;
  }

  const rootSize = root ? (size.get(root) ?? { w: 0, h: 0 }) : { w: 0, h: 0 };
  // Première couronne : assez loin du centre, et assez grande pour que les feuilles tiennent.
  const base = Math.max(rootSize.w / 2 / EX + 190, (total * 300) / TAU / Math.max(EY, 0.8), 300);
  const place = (k: number): Map<string, Pt> => {
    const out = new Map<string, Pt>();
    if (root) out.set(root, { x: -rootSize.w / 2, y: -rootSize.h / 2 });
    for (const [id, p] of polar) {
      const s = size.get(id) ?? { w: 280, h: 160 };
      const r = (base + (p.d - 1) * RING) * k;
      out.set(id, { x: Math.cos(p.a) * r * EX - s.w / 2, y: Math.sin(p.a) * r * EY - s.h / 2 });
    }
    return out;
  };
  const overlaps = (pos: Map<string, Pt>) => {
    const boxes = [...pos].map(([id, p]) => ({ ...p, ...(size.get(id) ?? { w: 280, h: 160 }) }));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i];
        const B = boxes[j];
        if (A.x < B.x + B.w + GAP && B.x < A.x + A.w + GAP && A.y < B.y + B.h + GAP && B.y < A.y + A.h + GAP) return true;
      }
    return false;
  };
  let k = 1;
  let pos = place(k);
  for (let i = 0; i < 16 && overlaps(pos); i++) pos = place((k *= 1.12));
  return pos;
}
