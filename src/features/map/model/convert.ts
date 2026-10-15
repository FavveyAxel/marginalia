// ─────────────────────────────────────────────────────────────
// Conversions d'une carte (pur, sans store ni DOM) : carte → plan, carte → écrit (HTML).
// Les actions qui enregistrent le résultat (store, createDraft) sont dans actions.ts.
//
// Carte → plan (format EssayPlan des plans existants) :
//   problème → sujet ; thèse → problématique ; arguments → parties ; sous-arguments,
//   précisions, exemples → sous-parties ; objections et réponses → dernière partie « Discussion » ;
//   chaque carte apporte son extrait (élément { kind: 'highlight' }) ou son texte (élément 'text') ;
//   la note d'un lien devient l'idée directrice de la (sous-)partie.
//
// Carte → écrit : brouillon d'explication de texte (HTML de CreateDraftOptions), dans l'ordre de
//   la lecture guidée. Chaque extrait est cité « … » dans un <blockquote>, avec sa référence en note
//   de bas de page (citation.ts : formatFootnote) ; le texte cité est entouré de
//   <span data-cite-hl="<highlightId>"> : à la création de l'écrit, il devient le signet `_mglHl_<id>`
//   (même lien citation → extrait que l'insertion depuis l'éditeur, ⌘-clic pour ouvrir l'extrait).
//
// API :
//   mapToPlan(map, lk, opts?)       → EssayPlan (non enregistré)
//   mapToDraftHtml(map, lk, opts?)  → { title, html, citedHighlightIds }
//   mapDisplayTitle(map, lk)        → titre lisible d'une carte
// ─────────────────────────────────────────────────────────────
import type { ArgumentMap, EssayPlan, PlanItemRef, PlanNode } from '../../../lib/types';
import { formatFootnote } from '../../../lib/citation';
import { esc } from '../../study/studyUtils';
import { clean, defaultId, highlightOf, mapKindOf, nodeText, type IdFn, type MapLookup } from './core';
import { guidedReading, type GuidedStep } from './guided';

export function mapDisplayTitle(map: ArgumentMap, lk: MapLookup): string {
  if (map.title?.trim()) return map.title.trim();
  const b = lk.books.find((x) => x.id === map.bookId);
  if (mapKindOf(map) === 'book' && b) return b.title;
  return b ? b.title : 'Carte d’argument';
}

/** Titre court d'une partie : début du texte de la carte (≤ 90 caractères, coupé au mot). */
export function shortTitle(text: string, max = 90): string {
  const t = clean(text);
  if (t.length <= max) return t.replace(/[.;:,]$/, '');
  return t.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/[.;:,]$/, '') + '…';
}

const noteOf = (map: ArgumentMap, step: GuidedStep) =>
  step.edgesToHighlight
    .map((id) => map.edges.find((e) => e.id === id)?.note?.trim())
    .filter(Boolean)
    .join(' ');

export interface MapToPlanOpts {
  id?: IdFn;
  now?: number;
  title?: string;
}

export function mapToPlan(map: ArgumentMap, lk: MapLookup, opts: MapToPlanOpts = {}): EssayPlan {
  const id = opts.id ?? defaultId;
  const now = opts.now ?? Date.now();
  const steps = guidedReading(map, lk);
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const textOf = (s: GuidedStep) => nodeText(byId.get(s.nodeId)!, lk);
  const refOf = (s: GuidedStep): PlanItemRef => {
    const n = byId.get(s.nodeId)!;
    return highlightOf(n, lk) ? { kind: 'highlight', id: n.highlightId! } : { kind: 'text', text: clean(n.text) };
  };
  const item = (s: GuidedStep) => ({ id: id(), ref: refOf(s) });
  const pnode = (title: string, note: string, items: PlanNode['items'] = [], children: PlanNode[] = []): PlanNode => ({ id: id(), title, note, items, children });

  const problems = steps.filter((s) => s.role === 'probleme');
  const theses = steps.filter((s) => s.role === 'these');
  const parts: PlanNode[] = [];
  const nodeOfStep = new Map<string, PlanNode>();
  const discussion: PlanNode[] = [];
  const rest: PlanNode['items'] = [];

  for (const s of steps) {
    switch (s.role) {
      case 'argument':
      case 'opposition': {
        const p = pnode(shortTitle(textOf(s)), noteOf(map, s), [item(s)]);
        parts.push(p);
        nodeOfStep.set(s.nodeId, p);
        break;
      }
      case 'sous-argument':
      case 'exemple':
      case 'precision': {
        const parent = s.parentId ? nodeOfStep.get(s.parentId) : null;
        const prefix = s.role === 'exemple' ? 'Exemple : ' : s.role === 'precision' ? 'Précision : ' : '';
        const p = pnode(prefix + shortTitle(textOf(s)), noteOf(map, s), [item(s)]);
        if (parent) {
          parent.children.push(p);
          nodeOfStep.set(s.nodeId, p);
        } else {
          // Précision ou exemple de la thèse elle-même : à intégrer (introduction ou partie au choix).
          rest.push(item(s));
        }
        break;
      }
      case 'objection': {
        const p = pnode(`Objection : ${shortTitle(textOf(s))}`, noteOf(map, s), [item(s)]);
        discussion.push(p);
        nodeOfStep.set(s.nodeId, p);
        break;
      }
      case 'reponse': {
        const parent = s.parentId ? nodeOfStep.get(s.parentId) : null;
        const p = pnode(`Réponse : ${shortTitle(textOf(s))}`, noteOf(map, s), [item(s)]);
        if (parent) parent.children.push(p);
        else discussion.push(p);
        nodeOfStep.set(s.nodeId, p);
        break;
      }
      case 'reste':
        rest.push(item(s));
        break;
    }
  }
  if (discussion.length) parts.push(pnode('Discussion : objections et réponses', '', [], discussion));
  if (rest.length) parts.push(pnode('Idées à intégrer', 'Cartes restantes de la carte d’argument, à répartir dans le plan.', rest));

  const these = theses.map(textOf).join(' ');
  const title = opts.title?.trim() || `Plan — ${mapDisplayTitle(map, lk)}`;
  return {
    id: id(),
    title,
    sujet: problems.map(textOf).join(' '),
    definitions: '',
    problematique: these,
    parts,
    conclusion: '',
    draftId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export interface MapToDraftOpts {
  title?: string;
}

/**
 * Brouillon d'explication de texte en HTML (CreateDraftOptions.html), dans l'ordre de la lecture guidée.
 */
export function mapToDraftHtml(map: ArgumentMap, lk: MapLookup, opts: MapToDraftOpts = {}): { title: string; html: string; citedHighlightIds: string[] } {
  const steps = guidedReading(map, lk);
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const title = opts.title?.trim() || `Explication — ${mapDisplayTitle(map, lk)}`;
  const cited: string[] = [];
  const out: string[] = [`<h1>${esc(title)}</h1>`];

  const quote = (s: GuidedStep): string => {
    const n = byId.get(s.nodeId)!;
    const h = highlightOf(n, lk);
    if (!h) {
      const t = clean(n.text);
      return t ? `<p>${esc(t)}</p>` : '';
    }
    const b = lk.books.find((x) => x.id === h.bookId);
    cited.push(h.id);
    const fn = b ? `<span data-footnote="${esc(formatFootnote(h, b))}"></span>` : '';
    return `<blockquote><p><span data-cite-hl="${esc(h.id)}">« ${esc(clean(h.text))} »</span>${fn}</p></blockquote>`;
  };
  const block = (s: GuidedStep, heading?: string) => {
    if (heading) out.push(heading);
    out.push(`<p><em>${esc(s.caption)}.</em></p>`);
    const q = quote(s);
    if (q) out.push(q);
    const note = noteOf(map, s);
    if (note) out.push(`<p>${esc(note)}</p>`);
    out.push('<p>[Expliquer : ce que dit le passage, comment il le dit, pourquoi.]</p>');
  };

  const intro = steps.filter((s) => s.role === 'probleme' || s.role === 'these');
  out.push('<h2>Introduction</h2>');
  if (!intro.length) out.push('<p>[Situer le texte, dégager son problème et sa thèse.]</p>');
  for (const s of intro) block(s);
  const body = steps.filter((s) => s.role !== 'probleme' && s.role !== 'these' && s.role !== 'reste');
  if (body.length) out.push('<h2>Développement</h2>');
  for (const s of body) {
    const top = s.role === 'argument' || s.role === 'objection' || s.role === 'opposition';
    block(s, top ? `<h3>${esc(s.label.charAt(0).toUpperCase() + s.label.slice(1))}</h3>` : undefined);
  }
  const rest = steps.filter((s) => s.role === 'reste');
  if (rest.length) {
    out.push('<h2>Autres éléments</h2>');
    for (const s of rest) block(s);
  }
  out.push('<h2>Conclusion</h2>');
  out.push('<p>[Rappeler le problème, la thèse et la force de l’argumentation ; ouvrir.]</p>');
  return { title, html: out.join('\n'), citedHighlightIds: cited };
}
