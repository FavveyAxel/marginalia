// Fonctions pures de la fiche-texte : tri des mouvements, plan généré, HTML pour l'éditeur.
import type { Anchor, Movement, TextStudy } from '../../lib/types';

export const ROLE_SUGGESTIONS = [
  'pose le problème',
  'énonce la thèse',
  'argumente',
  'examine une objection',
  'répond à l’objection',
  'illustre',
  'conclut',
];

/** Position d'un ancrage dans le texte, pour trier (HTML : chapitre puis début ; PDF : page puis y). */
function anchorKey(a: Anchor): [number, number, number] {
  if (a.kind === 'html') return [0, a.chapter, a.start];
  const y = a.rects.length ? Math.min(...a.rects.map((r) => r.y)) : 0;
  return [1, a.page, y];
}

export function compareAnchors(a: Anchor, b: Anchor): number {
  const ka = anchorKey(a);
  const kb = anchorKey(b);
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

/** Mouvements dans l'ordre du texte (l'ordre ne se règle pas à la main). */
export function sortMovements(ms: Movement[]): Movement[] {
  return [...ms].sort((a, b) => compareAnchors(a.anchor, b.anchor));
}

const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];
export function roman(n: number): string {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out || String(n);
}

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export interface PlanLine {
  label: string;
  title: string;
  role: string;
  start: string;
}

export function planLines(study: TextStudy): PlanLine[] {
  return sortMovements(study.movements).map((m, i) => ({
    label: `${roman(i + 1)}.`,
    title: m.title.trim() || `Mouvement ${i + 1}`,
    role: m.role.trim(),
    start: clean(m.startText),
  }));
}

/** Plan en texte brut : « I. Titre (rôle) — « premiers mots… » ». */
export function planText(study: TextStudy): string {
  const head = study.title.trim();
  const lines = planLines(study).map(
    (l) => `${l.label} ${l.title}${l.role ? ` (${l.role})` : ''}${l.start ? ` — « ${l.start}… »` : ''}`,
  );
  return [head, ...lines].filter(Boolean).join('\n');
}

/** HTML simple pour createDraft : titre, problème, thèse, enjeu, un h2 par mouvement. */
export function studyHtml(study: TextStudy): string {
  const out: string[] = [];
  out.push(`<h1>${esc(study.title.trim() || 'Explication de texte')}</h1>`);
  const field = (label: string, v: string) => {
    if (v.trim()) out.push(`<p><strong>${label}.</strong> ${esc(clean(v))}</p>`);
  };
  field('Problème', study.probleme);
  field('Thèse', study.these);
  field('Enjeu', study.enjeu);
  for (const l of planLines(study)) {
    out.push(`<h2>${esc(`${l.label} ${l.title}`)}</h2>`);
    if (l.role) out.push(`<p><em>${esc(l.role)}</em></p>`);
    if (l.start) out.push(`<p>« ${esc(l.start)}… »</p>`);
  }
  return out.join('\n');
}
