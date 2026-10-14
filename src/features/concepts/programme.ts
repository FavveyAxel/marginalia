// Programme de philosophie de terminale générale (rentrée 2020) : 17 notions et 31 repères.
// Source citée dans research/3-besoins-philo.md [S2] (arrêté, PDF distant) : non relue ici,
// liste fournie par la consigne et recoupée avec « 31 repères » de la recherche.
import { useStore } from '../../lib/store';
import { norm } from './util';

export const NOTIONS = [
  'L’art', 'Le bonheur', 'La conscience', 'Le devoir', 'L’État', 'L’inconscient', 'La justice', 'Le langage', 'La liberté',
  'La nature', 'La raison', 'La religion', 'La science', 'La technique', 'Le temps', 'Le travail', 'La vérité',
];

export const REPERES = [
  'Absolu / relatif', 'Abstrait / concret', 'En acte / en puissance', 'Analyse / synthèse', 'Concept / image / métaphore',
  'Contingent / nécessaire', 'Croire / savoir', 'Essentiel / accidentel', 'Exemple / preuve', 'Expliquer / comprendre',
  'En fait / en droit', 'Formel / matériel', 'Genre / espèce / individu', 'Hypothèse / conséquence / conclusion',
  'Idéal / réel', 'Identité / égalité / différence', 'Impossible / possible', 'Intuitif / discursif', 'Légal / légitime',
  'Médiat / immédiat', 'Objectif / subjectif / intersubjectif', 'Obligation / contrainte', 'Origine / fondement',
  'Persuader / convaincre', 'Principe / cause / fin', 'Public / privé', 'Ressemblance / analogie', 'Théorie / pratique',
  'Transcendant / immanent', 'Universel / général / particulier / singulier', 'Vrai / probable / certain',
];

const ARTICLE = /^(?:l'|le |la |les |un |une |du |de la |des )/;

/** Nom sans article, normalisé : clé de comparaison et de repérage. */
export const bareName = (name: string) => norm(name.trim()).replace(ARTICLE, '').trim();

/** Charge le programme sans doublon (comparaison insensible aux accents, à la casse et à l'article). */
export function loadProgramme(): { added: number; notions: number; reperes: number } {
  const st = useStore.getState();
  const known = new Map(st.concepts.map((c) => [bareName(c.name), c]));
  let notions = 0;
  let reperes = 0;
  const add = (name: string, programme: 'notion' | 'repere') => {
    const key = bareName(name);
    const existing = known.get(key);
    if (existing) {
      if (!existing.programme) useStore.getState().updateConcept(existing.id, { programme });
      return;
    }
    const c = useStore.getState().addConcept(name, '', programme);
    known.set(key, c);
    if (programme === 'notion') notions++;
    else reperes++;
  };
  NOTIONS.forEach((n) => add(n, 'notion'));
  REPERES.forEach((n) => add(n, 'repere'));
  return { added: notions + reperes, notions, reperes };
}
