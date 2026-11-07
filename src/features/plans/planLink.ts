// Lien plan ↔ écrit. Fonctions pures (testées par scripts/test-plan-link.mjs).
//
// L'écrit rattaché garde ses titres dans `draft.outline` (relevés par l'éditeur à chaque
// modification). On y retrouve chaque partie du plan par son titre, sans la numérotation
// (« I. Le loisir conquis » ↔ « Le loisir conquis ») ; à défaut, par sa place (titre renommé).
//
// Sens écrit → plan (syncPlanFromDraft) : titres renommés, titres ajoutés et ordre des parties et
// sous-parties suivent l'écrit. Les parties du plan absentes de l'écrit restent à leur place.
// Sens plan → écrit : `pendingOrder` (fiches déplacées dans le plan) ; l'éditeur range alors les
// sections comme le plan à l'ouverture suivante (desiredOrder), puis efface le drapeau.
import type { DraftHeading, EssayPlan, PlanNode, PlanProgress, PlanStatus } from '../../lib/types';
// Identifiant local (même forme que store.uid ; ce module reste sans dépendance au magasin).
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const STATUSES: { id: PlanStatus; label: string }[] = [
  { id: 'todo', label: 'À écrire' },
  { id: 'draft', label: 'Brouillon' },
  { id: 'review', label: 'À relire' },
  { id: 'done', label: 'Terminé' },
];
export const statusOf = (p: PlanProgress | undefined): PlanStatus => p?.status ?? 'todo';
export const statusLabel = (s: PlanStatus) => STATUSES.find((x) => x.id === s)!.label;

const LABEL = /^\s*(?:(?:[IVXLCDM]+|[A-Za-z]|\d+(?:\.\d+)*)\s*[.)°–-]|\d+(?:\.\d+)*)\s+/;

/** Titre sans numérotation (« II. », « A) », « 1.2 »), tel qu'on l'affiche. */
export const stripLabel = (t: string) => t.replace(LABEL, '').replace(/\s+/g, ' ').trim();

/** Clé de comparaison d'un titre : sans numérotation, casse, apostrophes ni ponctuation finale. */
export function normTitle(t: string): string {
  return stripLabel(t.normalize('NFC'))
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .replace(/[\s.:;!?…]+$/u, '')
    .trim();
}

export type EntryKind = 'intro' | 'node' | 'conclusion';
export interface PlanEntry {
  key: string;
  kind: EntryKind;
  depth: number;
  title: string;
  node: PlanNode | null;
  parentId: string | null;
}

/** Introduction, parties dans l'ordre (profondeur d'abord), conclusion. */
export function planEntries(plan: EssayPlan): PlanEntry[] {
  const out: PlanEntry[] = [{ key: 'intro', kind: 'intro', depth: 0, title: 'Introduction', node: null, parentId: null }];
  const walk = (nodes: PlanNode[], depth: number, parentId: string | null) => {
    for (const n of nodes) {
      out.push({ key: n.id, kind: 'node', depth, title: n.title, node: n, parentId });
      walk(n.children, depth + 1, n.id);
    }
  };
  walk(plan.parts, 0, null);
  out.push({ key: 'conclusion', kind: 'conclusion', depth: 0, title: 'Conclusion', node: null, parentId: null });
  return out;
}

export interface Levels {
  /** Index du premier titre utile (le titre du document, un h1 seul en tête, est écarté). */
  start: number;
  part: 1 | 2 | 3;
  sub: 1 | 2 | 3;
}

/** Niveaux des parties et sous-parties dans l'écrit. */
export function levelsOf(outline: DraftHeading[]): Levels {
  const h1 = outline.filter((h) => h.level === 1).length;
  const start = outline[0]?.level === 1 && h1 === 1 && outline.length > 1 ? 1 : 0;
  const rest = outline.slice(start);
  const part = (rest.length ? Math.min(...rest.map((h) => h.level)) : 2) as 1 | 2 | 3;
  return { start, part, sub: Math.min(3, part + 1) as 1 | 2 | 3 };
}

export interface Match {
  /** Entrée du plan → index du titre dans l'outline. */
  byKey: Map<string, number>;
  /** Titres de l'écrit sans partie dans le plan (index). */
  extra: number[];
  /** Mots de la section de chaque titre (sous-titres compris). */
  sectionWords: number[];
  levels: Levels;
}

const expectedLevel = (e: PlanEntry, lv: Levels) => (e.kind !== 'node' || e.depth === 0 ? lv.part : lv.sub);

export function matchPlan(plan: EssayPlan, outline: DraftHeading[]): Match {
  const lv = levelsOf(outline);
  const entries = planEntries(plan);
  const used = new Set<number>();
  const byKey = new Map<string, number>();
  const norms = outline.map((h) => normTitle(h.text));
  // 1. même titre
  for (const e of entries) {
    const n = normTitle(e.title);
    if (!n) continue;
    for (let i = lv.start; i < outline.length; i++)
      if (!used.has(i) && norms[i] === n) {
        used.add(i);
        byKey.set(e.key, i);
        break;
      }
  }
  // 2. même place (titre renommé) : entre les voisins déjà retrouvés, au niveau attendu
  entries.forEach((e, k) => {
    if (byKey.has(e.key) || e.kind !== 'node' || e.depth > 1) return;
    let lo = lv.start - 1;
    for (let j = k - 1; j >= 0; j--) if (byKey.has(entries[j].key)) { lo = byKey.get(entries[j].key)!; break; }
    let hi = outline.length;
    for (let j = k + 1; j < entries.length; j++) if (byKey.has(entries[j].key)) { hi = byKey.get(entries[j].key)!; break; }
    for (let i = lo + 1; i < hi; i++)
      if (!used.has(i) && outline[i].level === expectedLevel(e, lv) && norms[i] !== 'introduction' && norms[i] !== 'conclusion') {
        used.add(i);
        byKey.set(e.key, i);
        break;
      }
  });
  const sectionWords = outline.map((h, i) => {
    let w = h.words;
    for (let j = i + 1; j < outline.length && outline[j].level > h.level; j++) w += outline[j].words;
    return w;
  });
  const extra: number[] = [];
  for (let i = lv.start; i < outline.length; i++) if (!used.has(i) && outline[i].level <= lv.sub) extra.push(i);
  return { byKey, extra, sectionWords, levels: lv };
}

/** Mots écrits de chaque entrée du plan (absente de l'écrit : pas d'entrée). */
export function wordsByKey(m: Match): Map<string, number> {
  const out = new Map<string, number>();
  m.byKey.forEach((i, k) => out.set(k, m.sectionWords[i]));
  return out;
}

const cloneShallow = (n: PlanNode): PlanNode => ({ ...n, children: [...n.children] });

/**
 * Le plan suit l'écrit : titres renommés, titres ajoutés, ordre des parties et sous-parties.
 * Renvoie les nouvelles parties, ou null si rien ne change.
 */
export function syncPlanFromDraft(plan: EssayPlan, outline: DraftHeading[]): PlanNode[] | null {
  if (plan.pendingOrder || !outline.length) return null;
  const m = matchPlan(plan, outline);
  const lv = m.levels;
  const entries = planEntries(plan);
  const byIdx = new Map<number, PlanEntry>();
  m.byKey.forEach((i, k) => byIdx.set(i, entries.find((e) => e.key === k)!));

  const placed = new Set<string>();
  const newParts: PlanNode[] = [];
  let cur: PlanNode | null = null;
  const headNode = (i: number): PlanNode | null => {
    const e = byIdx.get(i);
    const text = stripLabel(outline[i].text);
    if (e && e.kind !== 'node') return null;
    if (e?.node) {
      if (e.depth > 1) return null; // sous-sous-partie : reste avec sa sous-partie
      const n = cloneShallow(e.node);
      // renommée dans l'écrit (sauf si on vient de la renommer dans le plan : l'écrit suivra)
      if (normTitle(n.title) !== normTitle(text) && !plan.pendingRenames?.[n.id]) n.title = text;
      return n;
    }
    const k = normTitle(text);
    if (k === 'introduction' || k === 'conclusion') return null;
    return { id: uid(), title: text, note: '', items: [], children: [] };
  };

  for (let i = lv.start; i < outline.length; i++) {
    const h = outline[i];
    if (h.level < lv.part) continue;
    if (h.level === lv.part) {
      const e = byIdx.get(i);
      if (e && e.kind !== 'node') {
        cur = null;
        continue;
      }
      const n = headNode(i);
      if (!n) {
        cur = null;
        continue;
      }
      // ses sous-parties d'avant sont reconstruites d'après l'écrit ; les sous-sous-parties restent
      n.children = [];
      newParts.push(n);
      placed.add(n.id);
      cur = n;
    } else if (h.level === lv.sub && lv.sub !== lv.part) {
      const n = headNode(i);
      if (!n) continue;
      placed.add(n.id);
      if (cur) cur.children.push(n);
      else newParts.push(n);
    }
  }

  // Parties et sous-parties du plan absentes de l'écrit : remises après leur voisine d'avant.
  const findIn = (nodes: PlanNode[], id: string): PlanNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const r = findIn(n.children, id);
      if (r) return r;
    }
    return null;
  };
  plan.parts.forEach((p, i) => {
    if (placed.has(p.id)) return;
    const n = cloneShallow(p);
    n.children = n.children.filter((c) => !placed.has(c.id));
    const prev = i > 0 ? newParts.findIndex((x) => x.id === plan.parts[i - 1].id) : -1;
    newParts.splice(prev >= 0 ? prev + 1 : Math.min(i, newParts.length), 0, n);
    placed.add(n.id);
    n.children.forEach((c) => placed.add(c.id));
  });
  for (const p of plan.parts)
    p.children.forEach((c, i) => {
      if (placed.has(c.id)) return;
      const parent = findIn(newParts, p.id);
      if (!parent) return;
      const prev = i > 0 ? parent.children.findIndex((x) => x.id === p.children[i - 1].id) : -1;
      parent.children.splice(prev >= 0 ? prev + 1 : Math.min(i, parent.children.length), 0, c);
      placed.add(c.id);
    });

  // Sous-parties retrouvées : elles gardent leurs propres enfants (sous-sous-parties).
  return JSON.stringify(newParts) === JSON.stringify(plan.parts) ? null : newParts;
}

/** Ordre voulu des sections de l'écrit d'après le plan (titres tels qu'ils sont dans l'écrit). */
export function desiredOrder(plan: EssayPlan, outline: DraftHeading[]): { text: string; subs: string[] }[] {
  const m = matchPlan(plan, outline);
  const txt = (key: string) => (m.byKey.has(key) ? outline[m.byKey.get(key)!].text : null);
  const out: { text: string; subs: string[] }[] = [];
  const intro = txt('intro');
  if (intro) out.push({ text: intro, subs: [] });
  for (const p of plan.parts) {
    const t = txt(p.id);
    if (!t) continue;
    out.push({ text: t, subs: p.children.map((c) => txt(c.id)).filter((x): x is string => !!x) });
  }
  const concl = txt('conclusion');
  if (concl) out.push({ text: concl, subs: [] });
  return out;
}

/** Parties du plan (et sous-parties) absentes de l'écrit, avec le titre voisin où les créer. */
export function missingEntries(plan: EssayPlan, outline: DraftHeading[]) {
  const m = matchPlan(plan, outline);
  const entries = planEntries(plan);
  const out = new Map<string, { level: 2 | 3; after: string | null; before: string | null }>();
  entries.forEach((e, k) => {
    if (e.kind !== 'node' || e.depth > 1 || m.byKey.has(e.key)) return;
    let after: string | null = null;
    for (let j = k - 1; j >= 0; j--) {
      const i = m.byKey.get(entries[j].key);
      if (i !== undefined && (entries[j].depth <= e.depth || entries[j].key === e.parentId)) {
        after = outline[i].text;
        break;
      }
    }
    let before: string | null = null;
    for (let j = k + 1; j < entries.length; j++) {
      const i = m.byKey.get(entries[j].key);
      if (i !== undefined && entries[j].depth <= e.depth) {
        before = outline[i].text;
        break;
      }
    }
    const level = (e.depth === 0 ? m.levels.part : m.levels.sub) as 2 | 3;
    out.set(e.key, { level, after, before });
  });
  return out;
}

/** Plan construit d'après les titres d'un écrit (« Créer le plan depuis les titres »). */
export function partsFromOutline(outline: DraftHeading[]): PlanNode[] {
  const empty: EssayPlan = { id: '', title: '', sujet: '', definitions: '', problematique: '', parts: [], conclusion: '', draftId: null, createdAt: 0, updatedAt: 0 };
  return syncPlanFromDraft(empty, outline) ?? [];
}

/** Avancement d'ensemble : nombre d'entrées par statut (introduction et conclusion comprises). */
export function statusCounts(plan: EssayPlan): Record<PlanStatus, number> {
  const c: Record<PlanStatus, number> = { todo: 0, draft: 0, review: 0, done: 0 };
  c[statusOf(plan.introProgress)]++;
  c[statusOf(plan.conclusionProgress)]++;
  const walk = (nodes: PlanNode[]) => nodes.forEach((n) => (c[statusOf(n)]++, walk(n.children)));
  walk(plan.parts);
  return c;
}

/** Objectif total : somme des objectifs (une partie sans objectif compte celui de ses sous-parties). */
export function totalGoal(plan: EssayPlan): number {
  const g = (n: PlanNode): number => n.goal ?? n.children.reduce((s, c) => s + g(c), 0);
  return (plan.introProgress?.goal ?? 0) + (plan.conclusionProgress?.goal ?? 0) + plan.parts.reduce((s, n) => s + g(n), 0);
}

/** Plan rattaché à un écrit, s'il y en a un. */
export const planOfDraft = (plans: EssayPlan[], draftId: string) => plans.find((p) => p.draftId === draftId) ?? null;

/** Titres à renommer dans l'écrit : [titre actuel dans l'écrit, nouveau titre (numérotation d'origine gardée)]. */
export function pendingRenameList(plan: EssayPlan): { from: string; to: string }[] {
  const r = plan.pendingRenames;
  if (!r) return [];
  const out: { from: string; to: string }[] = [];
  const walk = (nodes: PlanNode[]) =>
    nodes.forEach((n) => {
      const from = r[n.id];
      if (from !== undefined && n.title.trim() && normTitle(from) !== normTitle(n.title)) {
        const label = from.match(LABEL)?.[0] ?? '';
        out.push({ from, to: label + n.title.trim() });
      }
      walk(n.children);
    });
  walk(plan.parts);
  return out;
}
