// Modèles d'écrits (HTML simple converti en .docx par docx.ts).
import type { Draft } from '../../lib/types';
import type { DocLayout } from './docx';

export type TemplateId = NonNullable<Draft['template']>;
/** Modèles proposés (« universitaire » est enregistré comme une dissertation : Draft['template'] est figé). */
export type TemplateKey = TemplateId | 'universitaire';

export interface TemplateInfo {
  key: TemplateKey;
  /** Valeur enregistrée dans l'écrit. */
  id: TemplateId;
  /** Mise en page du .docx généré. */
  layout?: DocLayout;
  label: string;
  /** Titre proposé pour un nouvel écrit. */
  defaultTitle: string;
  description: string;
  html: string;
}

const hint = (s: string) => `<p><em>${s}</em></p>`;

const DISSERTATION = [
  '<h1>Introduction</h1>',
  hint('Accroche : partir d’un exemple, d’une expérience commune ou d’une citation qui fait surgir le problème.'),
  hint('Analyse des termes du sujet : définir chaque notion et dégager les sens possibles.'),
  hint('Problématique : formuler la tension ou le paradoxe que le sujet recèle.'),
  hint('Annonce du plan.'),
  '<h1>I. Première partie</h1>',
  hint('Thèse de la partie, en une phrase.'),
  '<h2>1. Premier argument</h2>',
  '<p></p>',
  '<h2>2. Deuxième argument</h2>',
  '<p></p>',
  hint('Transition : ce que la partie établit et la limite qui oblige à aller plus loin.'),
  '<h1>II. Deuxième partie</h1>',
  hint('Thèse de la partie, en une phrase.'),
  '<h2>1. Premier argument</h2>',
  '<p></p>',
  '<h2>2. Deuxième argument</h2>',
  '<p></p>',
  hint('Transition.'),
  '<h1>III. Troisième partie</h1>',
  hint('Dépassement : reformuler le problème à un niveau plus élevé.'),
  '<h2>1. Premier argument</h2>',
  '<p></p>',
  '<h2>2. Deuxième argument</h2>',
  '<p></p>',
  '<h1>Conclusion</h1>',
  hint('Bilan : rappeler le parcours et répondre nettement à la problématique.'),
  hint('Ouverture (facultative).'),
].join('');

export const TEMPLATES: TemplateInfo[] = [
  {
    key: 'vide',
    id: 'vide',
    label: 'Vide',
    defaultTitle: 'Sans titre',
    description: 'Une page blanche au format A4.',
    html: '<p></p>',
  },
  {
    key: 'dissertation',
    id: 'dissertation',
    label: 'Dissertation',
    defaultTitle: 'Dissertation',
    description: 'Introduction, trois parties, conclusion.',
    html: DISSERTATION,
  },
  {
    key: 'explication',
    id: 'explication',
    label: 'Explication de texte',
    defaultTitle: 'Explication de texte',
    description: 'Situation, thèse, problème, mouvements.',
    html: [
      '<h1>Introduction</h1>',
      hint('Situation du texte : auteur, œuvre, contexte du passage.'),
      hint('Thème : de quoi parle le texte.'),
      hint('Thèse : ce que l’auteur soutient, en une phrase.'),
      hint('Problème : la question à laquelle le texte répond, et ce qui la rend difficile.'),
      hint('Enjeu : ce qui dépend de la réponse.'),
      hint('Annonce des mouvements du texte.'),
      '<h1>Premier mouvement (l. … à …)</h1>',
      hint('Idée directrice du mouvement et rôle dans l’argumentation.'),
      '<p></p>',
      '<h1>Deuxième mouvement (l. … à …)</h1>',
      hint('Idée directrice du mouvement et rôle dans l’argumentation.'),
      '<p></p>',
      '<h1>Troisième mouvement (l. … à …)</h1>',
      hint('Idée directrice du mouvement et rôle dans l’argumentation.'),
      '<p></p>',
      '<h1>Conclusion</h1>',
      hint('Reprise de la thèse et de sa démonstration ; intérêt philosophique du texte.'),
    ].join(''),
  },
  {
    key: 'fiche',
    id: 'fiche',
    label: 'Fiche de lecture',
    defaultTitle: 'Fiche de lecture',
    description: 'Référence, thèse, structure, concepts, citations.',
    html: [
      '<h1>Référence</h1>',
      '<ul><li>Auteur : </li><li>Titre : </li><li>Édition utilisée : </li><li>Date de première parution : </li></ul>',
      '<h1>Contexte</h1>',
      hint('Situation de l’œuvre dans la vie de l’auteur et dans l’histoire des idées.'),
      '<h1>Thèse principale</h1>',
      '<p></p>',
      '<h1>Structure de l’œuvre</h1>',
      '<ol><li></li><li></li><li></li></ol>',
      '<h1>Concepts clés</h1>',
      '<ul><li></li></ul>',
      '<h1>Citations</h1>',
      hint('Insérez des extraits depuis le panneau « Extraits ».'),
      '<h1>Discussion critique</h1>',
      hint('Objections, limites, prolongements.'),
    ].join(''),
  },
];

/** Présentation universitaire : page de garde, puis plan de dissertation (research/7 §10). */
TEMPLATES.push({
  key: 'universitaire',
  id: 'dissertation',
  layout: { academic: true },
  label: 'Présentation universitaire',
  defaultTitle: 'Dissertation',
  description: 'A4, Times 12, interligne 1,5, justifié, alinéa, page de garde, pages numérotées.',
  html: [
    '<p data-style="Title">Titre du devoir</p>',
    '<p data-style="Subtitle">Prénom Nom</p>',
    '<p data-style="Subtitle">Intitulé du cours — Nom de l’enseignant</p>',
    '<p data-style="Subtitle">Année universitaire</p>',
    '<p data-break="page"></p>',
    DISSERTATION,
  ].join(''),
});

export function templateByKey(key: TemplateKey): TemplateInfo {
  return TEMPLATES.find((t) => t.key === key) ?? TEMPLATES[0];
}

export function templateInfo(id: Draft['template']): TemplateInfo {
  return TEMPLATES.find((t) => t.key === id) ?? TEMPLATES[0];
}
