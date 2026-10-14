// Génération du HTML envoyé à l'éditeur (voir CreateDraftOptions.html : h1-h3, p, blockquote, span[data-footnote]).
import { formatFootnote } from '../../lib/citation';
import type { ArgumentReconstruction, Book, Concept, EssayPlan, Highlight, PlanNode } from '../../lib/types';
import { esc } from '../study/studyUtils';
import { nodeLabel } from './planTree';

export interface PlanLookup {
  highlights: Highlight[];
  books: Book[];
  concepts: Concept[];
  arguments: ArgumentReconstruction[];
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const paras = (s: string) =>
  s
    .split(/\n{2,}|\n/)
    .map(clean)
    .filter(Boolean)
    .map((t) => `<p>${esc(t)}</p>`);

export function planDraftTitle(plan: EssayPlan): string {
  return clean(plan.sujet) || clean(plan.title) || 'Dissertation';
}

export function planHtml(plan: EssayPlan, lk: PlanLookup): string {
  const out: string[] = [];
  out.push(`<h1>${esc(planDraftTitle(plan))}</h1>`);

  if (plan.definitions.trim() || plan.problematique.trim()) {
    out.push('<h2>Introduction</h2>');
    out.push(...paras(plan.definitions));
    if (plan.problematique.trim()) out.push(`<p><strong>Problématique.</strong> ${esc(clean(plan.problematique))}</p>`);
  }

  const item = (ref: PlanNode['items'][number]['ref']): string => {
    switch (ref.kind) {
      case 'highlight': {
        const h = lk.highlights.find((x) => x.id === ref.id);
        const b = h && lk.books.find((x) => x.id === h.bookId);
        if (!h || !b) return '';
        return `<blockquote><p>${esc(clean(h.text))}<span data-footnote="${esc(formatFootnote(h, b))}"></span></p></blockquote>`;
      }
      case 'concept': {
        const c = lk.concepts.find((x) => x.id === ref.id);
        if (!c) return '';
        return `<p><strong>Concept : ${esc(c.name)}.</strong>${c.definition.trim() ? ` ${esc(clean(c.definition))}` : ''}</p>`;
      }
      case 'argument': {
        const a = lk.arguments.find((x) => x.id === ref.id);
        if (!a) return '';
        const prem = a.premises.map((p) => clean(p.text)).filter(Boolean).join(' ; ');
        const concl = clean(a.conclusion.text);
        const body = [prem, concl ? `donc ${concl}` : ''].filter(Boolean).join(' ; ');
        return `<p><strong>Argument : ${esc(a.title || 'sans titre')}.</strong>${body ? ` ${esc(body)}` : ''}</p>`;
      }
      case 'text':
        return paras(ref.text).join('\n');
    }
  };

  const walk = (nodes: PlanNode[], depth: number) => {
    nodes.forEach((n, i) => {
      const tag = depth === 0 ? 'h2' : 'h3';
      out.push(`<${tag}>${esc(`${nodeLabel(depth, i)} ${clean(n.title) || 'Sans titre'}`)}</${tag}>`);
      out.push(...paras(n.note));
      for (const it of n.items) {
        const h = item(it.ref);
        if (h) out.push(h);
      }
      walk(n.children, depth + 1);
    });
  };
  walk(plan.parts, 0);

  if (plan.conclusion.trim()) {
    out.push('<h2>Conclusion</h2>');
    out.push(...paras(plan.conclusion));
  }
  return out.join('\n');
}
