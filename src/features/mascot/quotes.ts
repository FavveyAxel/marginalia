// Citations que le compagnon dit dans sa bulle : des auteurs classiques (domaine public), avec la
// source quand elle est sûre. Les attributions traditionnelles mais incertaines sont marquées comme telles.
export type Quote = { text: string; author: string; source?: string };

export const QUOTES: Quote[] = [
  { text: 'Une vie sans examen ne vaut pas la peine d’être vécue.', author: 'Socrate', source: 'Platon, Apologie de Socrate' },
  { text: 'Connais-toi toi-même.', author: 'Maxime de Delphes', source: 'reprise par Socrate' },
  { text: 'Je sais que je ne sais rien.', author: 'Socrate', source: 'attribué' },
  { text: 'L’homme est par nature un animal politique.', author: 'Aristote', source: 'Politique' },
  { text: 'On ne se baigne jamais deux fois dans le même fleuve.', author: 'Héraclite', source: 'attribué' },
  { text: 'Il y a ce qui dépend de nous, et ce qui ne dépend pas de nous.', author: 'Épictète', source: 'Manuel' },
  { text: 'Ce qui trouble les hommes, ce ne sont pas les choses, mais les jugements qu’ils portent sur les choses.', author: 'Épictète', source: 'Manuel' },
  { text: 'Ce n’est pas parce que les choses sont difficiles que nous n’osons pas, c’est parce que nous n’osons pas qu’elles sont difficiles.', author: 'Sénèque', source: 'Lettres à Lucilius' },
  { text: 'Ce qui fait obstacle à l’action fait avancer l’action.', author: 'Marc Aurèle', source: 'Pensées pour moi-même' },
  { text: 'Que sais-je ?', author: 'Montaigne', source: 'Essais' },
  { text: 'Philosopher, c’est apprendre à mourir.', author: 'Montaigne', source: 'Essais' },
  { text: 'Parce que c’était lui, parce que c’était moi.', author: 'Montaigne', source: 'Essais' },
  { text: 'Je pense, donc je suis.', author: 'Descartes', source: 'Discours de la méthode' },
  { text: 'Le bon sens est la chose du monde la mieux partagée.', author: 'Descartes', source: 'Discours de la méthode' },
  { text: 'L’homme n’est qu’un roseau, le plus faible de la nature ; mais c’est un roseau pensant.', author: 'Pascal', source: 'Pensées' },
  { text: 'Le cœur a ses raisons que la raison ne connaît point.', author: 'Pascal', source: 'Pensées' },
  { text: 'Tout le malheur des hommes vient d’une seule chose, qui est de ne savoir pas demeurer en repos dans une chambre.', author: 'Pascal', source: 'Pensées' },
  { text: 'Ne pas rire, ne pas pleurer, ne pas haïr, mais comprendre.', author: 'Spinoza', source: 'Traité politique' },
  { text: 'Tout ce qui est précieux est aussi difficile que rare.', author: 'Spinoza', source: 'Éthique' },
  { text: 'L’homme est né libre, et partout il est dans les fers.', author: 'Rousseau', source: 'Du contrat social' },
  { text: 'Il faut cultiver notre jardin.', author: 'Voltaire', source: 'Candide' },
  { text: 'Sapere aude ! Aie le courage de te servir de ton propre entendement.', author: 'Kant', source: 'Qu’est-ce que les Lumières ?' },
  { text: 'Le ciel étoilé au-dessus de moi et la loi morale en moi.', author: 'Kant', source: 'Critique de la raison pratique' },
  { text: 'La chouette de Minerve ne prend son envol qu’à la tombée de la nuit.', author: 'Hegel', source: 'Principes de la philosophie du droit' },
  { text: 'Sans la musique, la vie serait une erreur.', author: 'Nietzsche', source: 'Crépuscule des idoles' },
  { text: 'Deviens ce que tu es.', author: 'Nietzsche', source: 'd’après Pindare' },
  { text: 'Nous avons tous assez de force pour supporter les maux d’autrui.', author: 'La Rochefoucauld', source: 'Maximes' },
  { text: 'Ce que l’on conçoit bien s’énonce clairement.', author: 'Boileau', source: 'L’Art poétique' },
];

/** Petites phrases à lui, sans auteur : au réveil, quand il se muscle, quand on le dérange. */
export const MUTTER = {
  hello: ['Je passais par là.', 'On lit quoi aujourd’hui ?', 'Pause dans la marge.'],
  flex: ['Encore un livre ? Je sens mes neurones gonfler.', 'Regarde-moi ces circonvolutions.', 'Ça, c’est du muscle conceptuel.'],
  poke: ['Hé ! Je réfléchissais.', 'Une citation ? En voilà une.'],
};

export const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
