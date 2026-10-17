// Tout ce que dit le petit cerveau dans sa bulle : citations (auteurs du domaine public, traductions
// françaises usuelles), blagues, questions, phrases qui dépendent du contexte, salutations.
// Règle de longueur : 90 caractères max par phrase, 140 pour une citation.

export type Quote = { text: string; author: string; source?: string };

/** Citations connues, auteurs du domaine public (morts avant 1955), traductions françaises usuelles. */
export const QUOTES: Quote[] = [
  // Antiquité
  { text: 'Une vie sans examen ne vaut pas la peine d’être vécue.', author: 'Socrate', source: 'Platon, Apologie de Socrate' },
  { text: 'Connais-toi toi-même.', author: 'Socrate', source: 'maxime de Delphes' },
  { text: 'Je sais que je ne sais rien.', author: 'Socrate', source: 'attribué' },
  { text: 'Nul n’est méchant volontairement.', author: 'Platon', source: 'Timée' },
  { text: 'Tous les hommes désirent naturellement savoir.', author: 'Aristote', source: 'Métaphysique' },
  { text: 'L’homme est par nature un animal politique.', author: 'Aristote', source: 'Politique' },
  { text: 'Une hirondelle ne fait pas le printemps.', author: 'Aristote', source: 'Éthique à Nicomaque' },
  { text: 'On ne se baigne jamais deux fois dans le même fleuve.', author: 'Héraclite', source: 'attribué' },
  { text: 'La nature aime à se cacher.', author: 'Héraclite', source: 'Fragments' },
  { text: 'La mort n’est rien pour nous.', author: 'Épicure', source: 'Lettre à Ménécée' },
  { text: 'Il y a ce qui dépend de nous, et ce qui ne dépend pas de nous.', author: 'Épictète', source: 'Manuel' },
  { text: 'Ce qui trouble les hommes, ce ne sont pas les choses, mais les jugements qu’ils portent sur les choses.', author: 'Épictète', source: 'Manuel' },
  { text: 'Ce n’est pas parce que les choses sont difficiles que nous n’osons pas, c’est parce que nous n’osons pas qu’elles sont difficiles.', author: 'Sénèque', source: 'Lettres à Lucilius' },
  { text: 'Nous n’avons pas trop peu de temps, mais nous en perdons beaucoup.', author: 'Sénèque', source: 'De la brièveté de la vie' },
  { text: 'Il n’y a pas de vent favorable pour celui qui ne sait où il va.', author: 'Sénèque', source: 'Lettres à Lucilius' },
  { text: 'Ce qui fait obstacle à l’action fait avancer l’action.', author: 'Marc Aurèle', source: 'Pensées pour moi-même' },
  { text: 'La meilleure façon de se venger d’un ennemi est de ne pas lui ressembler.', author: 'Marc Aurèle', source: 'Pensées pour moi-même' },
  { text: 'Rien ne naît de rien.', author: 'Lucrèce', source: 'De la nature' },
  { text: 'Qu’est-ce donc que le temps ? Si personne ne me le demande, je le sais ; si je veux l’expliquer, je ne le sais plus.', author: 'Augustin', source: 'Confessions' },
  // Renaissance et âge classique
  { text: 'Que sais-je ?', author: 'Montaigne', source: 'Essais' },
  { text: 'Philosopher, c’est apprendre à mourir.', author: 'Montaigne', source: 'Essais' },
  { text: 'Parce que c’était lui, parce que c’était moi.', author: 'Montaigne', source: 'Essais' },
  { text: 'Je suis moi-même la matière de mon livre.', author: 'Montaigne', source: 'Essais, Au lecteur' },
  { text: 'Je ne peins pas l’être. Je peins le passage.', author: 'Montaigne', source: 'Essais' },
  { text: 'Chaque homme porte la forme entière de l’humaine condition.', author: 'Montaigne', source: 'Essais' },
  { text: 'Je pense, donc je suis.', author: 'Descartes', source: 'Discours de la méthode' },
  { text: 'Le bon sens est la chose du monde la mieux partagée.', author: 'Descartes', source: 'Discours de la méthode' },
  { text: 'L’homme n’est qu’un roseau, le plus faible de la nature ; mais c’est un roseau pensant.', author: 'Pascal', source: 'Pensées' },
  { text: 'Le cœur a ses raisons que la raison ne connaît point.', author: 'Pascal', source: 'Pensées' },
  { text: 'Tout le malheur des hommes vient d’une seule chose, qui est de ne savoir pas demeurer en repos dans une chambre.', author: 'Pascal', source: 'Pensées' },
  { text: 'Le silence éternel de ces espaces infinis m’effraie.', author: 'Pascal', source: 'Pensées' },
  { text: 'L’homme n’est ni ange ni bête, et le malheur veut que qui veut faire l’ange fait la bête.', author: 'Pascal', source: 'Pensées' },
  { text: 'Je n’ai fait celle-ci plus longue que parce que je n’ai pas eu le loisir de la faire plus courte.', author: 'Pascal', source: 'Les Provinciales' },
  { text: 'Ne pas rire, ne pas pleurer, ne pas haïr, mais comprendre.', author: 'Spinoza', source: 'Traité politique' },
  { text: 'Tout ce qui est précieux est aussi difficile que rare.', author: 'Spinoza', source: 'Éthique' },
  { text: 'Le désir est l’essence même de l’homme.', author: 'Spinoza', source: 'Éthique' },
  { text: 'Pourquoi y a-t-il plutôt quelque chose que rien ?', author: 'Leibniz', source: 'Principes de la nature et de la grâce' },
  { text: 'Les monades n’ont point de fenêtres.', author: 'Leibniz', source: 'Monadologie' },
  { text: 'Nos vertus ne sont, le plus souvent, que des vices déguisés.', author: 'La Rochefoucauld', source: 'Maximes' },
  { text: 'Nous avons tous assez de force pour supporter les maux d’autrui.', author: 'La Rochefoucauld', source: 'Maximes' },
  { text: 'Tout est dit, et l’on vient trop tard depuis plus de sept mille ans qu’il y a des hommes et qui pensent.', author: 'La Bruyère', source: 'Les Caractères' },
  { text: 'Ce que l’on conçoit bien s’énonce clairement.', author: 'Boileau', source: 'L’Art poétique' },
  { text: 'Vingt fois sur le métier remettez votre ouvrage.', author: 'Boileau', source: 'L’Art poétique' },
  // Lumières
  { text: 'La raison est, et ne doit qu’être l’esclave des passions.', author: 'Hume', source: 'Traité de la nature humaine' },
  { text: 'Les grandes pensées viennent du cœur.', author: 'Vauvenargues', source: 'Réflexions et maximes' },
  { text: 'Je n’ai jamais eu de chagrin qu’une heure de lecture ne m’ait ôté.', author: 'Montesquieu', source: 'Mes pensées' },
  { text: 'Il faut cultiver notre jardin.', author: 'Voltaire', source: 'Candide' },
  { text: 'Le secret d’ennuyer est celui de tout dire.', author: 'Voltaire', source: 'Discours en vers sur l’homme' },
  { text: 'On doit exiger de moi que je cherche la vérité, mais non que je la trouve.', author: 'Diderot', source: 'Pensées philosophiques' },
  { text: 'L’homme est né libre, et partout il est dans les fers.', author: 'Rousseau', source: 'Du contrat social' },
  { text: 'Tout est bien sortant des mains de l’Auteur des choses, tout dégénère entre les mains de l’homme.', author: 'Rousseau', source: 'Émile' },
  { text: 'La plus perdue de toutes les journées est celle où l’on n’a pas ri.', author: 'Chamfort', source: 'Maximes et pensées' },
  { text: 'Sapere aude ! Aie le courage de te servir de ton propre entendement.', author: 'Kant', source: 'Qu’est-ce que les Lumières ?' },
  { text: 'Le ciel étoilé au-dessus de moi et la loi morale en moi.', author: 'Kant', source: 'Critique de la raison pratique' },
  { text: 'Des pensées sans contenu sont vides, des intuitions sans concepts sont aveugles.', author: 'Kant', source: 'Critique de la raison pure' },
  // XIXe et début XXe
  { text: 'Rien de grand ne s’est accompli dans le monde sans passion.', author: 'Hegel', source: 'Leçons sur la philosophie de l’histoire' },
  { text: 'La chouette de Minerve ne prend son envol qu’à la tombée de la nuit.', author: 'Hegel', source: 'Principes de la philosophie du droit' },
  { text: 'Le monde est ma représentation.', author: 'Schopenhauer', source: 'Le Monde comme volonté et comme représentation' },
  { text: 'L’angoisse est le vertige de la liberté.', author: 'Kierkegaard', source: 'Le Concept d’angoisse' },
  { text: 'La vie doit être comprise en arrière, mais elle doit être vécue en avant.', author: 'Kierkegaard', source: 'Journal' },
  { text: 'Sans la musique, la vie serait une erreur.', author: 'Nietzsche', source: 'Crépuscule des idoles' },
  { text: 'Ce qui ne me tue pas me rend plus fort.', author: 'Nietzsche', source: 'Crépuscule des idoles' },
  { text: 'Il faut encore porter du chaos en soi pour pouvoir enfanter une étoile dansante.', author: 'Nietzsche', source: 'Ainsi parlait Zarathoustra' },
  { text: 'Deviens ce que tu es.', author: 'Nietzsche', source: 'd’après Pindare' },
  { text: 'Le rire est du mécanique plaqué sur du vivant.', author: 'Bergson', source: 'Le Rire' },
  { text: 'Il faut agir en homme de pensée et penser en homme d’action.', author: 'Bergson', source: 'message au congrès Descartes' },
  { text: 'Penser, c’est dire non.', author: 'Alain', source: 'Propos sur la religion' },
  { text: 'Le pessimisme est d’humeur ; l’optimisme est de volonté.', author: 'Alain', source: 'Propos sur le bonheur' },
  { text: 'L’attention est la forme la plus rare et la plus pure de la générosité.', author: 'Simone Weil', source: 'lettre à Joë Bousquet' },
];

/** Phrases drôles du personnage (sans auteur). */
export const JOKES: string[] = [
  'Je pense, donc je suis. Je somnole, donc je suis un peu moins.',
  'Kant se promenait à heure fixe. Moi aussi : chaque fois que tu fermes un livre.',
  'On m’a dit de muscler mon esprit. J’ai pris ça très au pied de la lettre.',
  'Diogène vivait dans un tonneau. Moi, dans une boîte crânienne. Chacun son loyer.',
  'Zénon m’a prouvé que je n’arriverais jamais au bout de ce chapitre. Il avait raison.',
  'Je suis sorti de la caverne. Trop de soleil. Je suis rentré avec une lampe de lecture.',
  'Socrate posait des questions à tout le monde. Moi aussi. Tu lis quoi, là ?',
  'Mes synapses font la ola chaque fois que tu soulignes une phrase.',
  'J’ai deux hémisphères et aucun des deux ne veut ranger la bibliothèque.',
  'Thèse : je suis fatigué. Antithèse : encore un chapitre. Synthèse : un café.',
  'Je ne suis pas paresseux. Je pratique l’ataraxie à plein temps.',
  'Spinoza polissait des lentilles. Moi, je polis mes circonvolutions.',
  'Héraclite ne lisait jamais deux fois le même livre. Moi, je relis trois fois la même page.',
  'Mon cortex préfrontal veut travailler. Mon cortex préférentiel veut une sieste.',
  'Je fais partie du système nerveux, mais je reste très calme.',
  'Un neurone seul, ça ne pense pas. Heureusement, on est quatre-vingt-six milliards.',
  'Leibniz dit que c’est le meilleur des mondes possibles. Il n’a pas vu mes notes.',
  'Ce dont on ne peut parler, il faut le taire. Il me reste donc tout le reste.',
  'Pascal a fait un pari. Moi aussi : que tu liras la note de bas de page.',
  'Le rasoir d’Ockham ? Je n’ai pas un poil sur le cortex. Hypothèse superflue.',
  'L’âne de Buridan hésitait entre deux seaux. Moi, entre deux livres. Je lirai les deux.',
  'Être-pour-la-mort, d’accord. Mais d’abord, être-pour-le-goûter.',
  'Le rire, c’est du mécanique plaqué sur du vivant, dit Bergson. Regarde-moi marcher.',
  'Il faut imaginer Sisyphe heureux. Et moi aussi, quand je relis mes fiches.',
  'J’ai lu la Critique de la raison pure. Je crois qu’elle aussi m’a critiqué.',
  'Le moi est haïssable, dit Pascal. Le mien est surtout rose et un peu mou.',
  'Un cerveau dans une cuve ? Non merci. Je préfère un fauteuil et une lampe.',
  'Épicure conseille les plaisirs simples : un livre, un coin de canapé, trois pages.',
  'On dit qu’on n’utilise que 10 % de son cerveau. Faux : je suis au moins à 11 %.',
  'Le maître et l’esclave ? Ici, le maître, c’est la bibliographie.',
  'J’ai beaucoup de plis. C’est normal, je suis un cerveau, pas une chemise.',
  'Thalès est tombé dans un puits en regardant les étoiles. Moi, dans un chapitre.',
  'Aristote classait tout. J’ai essayé : catégorie « divers », quatre-vingts éléments.',
  'Mes neurones miroirs t’imitent. Tu bâilles, je bâille. Tu lis, je… bâille aussi.',
  'Je ne suis pas distrait. Je suis en train de suspendre mon jugement.',
  'Matière grise, oui. Mais un gris très élégant, presque taupe.',
  'Les sophistes se faisaient payer. Moi, je travaille pour une page cornée.',
];

/** Petites questions ou pensées qui font réfléchir (sans auteur). */
export const PONDER: string[] = [
  'Si personne ne lit ce livre, a-t-il encore quelque chose à dire ?',
  'Peut-on vraiment lire deux fois le même livre ?',
  'Est-ce toi qui lis le livre, ou le livre qui te lit ?',
  'Une phrase soulignée appartient-elle encore tout à fait à son auteur ?',
  'Comprendre une idée, est-ce pouvoir la redire autrement ?',
  'Quelle idée as-tu aujourd’hui que tu n’avais pas hier ?',
  'Le doute est-il un point de départ ou une destination ?',
  'Peut-on être d’accord avec un auteur qu’on n’aime pas ?',
  'Ton auteur préféré serait-il d’accord avec toi ?',
  'Une marge vide, c’est un silence ou une promesse ?',
  'Que reste-t-il en nous d’un livre que l’on a oublié ?',
  'Savoir qu’on ne sait pas, est-ce déjà savoir quelque chose ?',
  'Quand as-tu changé d’avis pour la dernière fois ?',
  'Une question bien posée vaut-elle mieux qu’une réponse ?',
  'Le temps passé à relire est-il du temps perdu ?',
  'Peut-on penser sans mots ?',
  'Qui parle, quand tu écris « je » dans une dissertation ?',
  'Lire vite, est-ce lire moins ?',
  'Un exemple prouve-t-il quelque chose ?',
  'Si tu devais résumer ce livre en une phrase, laquelle choisirais-tu ?',
  'Qu’est-ce qui t’a étonné aujourd’hui ?',
  'Une objection, c’est un obstacle ou un cadeau ?',
  'Ce qui te semble évident, depuis quand l’est-il ?',
  'Pourquoi certaines phrases nous suivent-elles pendant des années ?',
  'Un concept, c’est un outil ou un paysage ?',
  'Peut-on désirer ce que l’on possède déjà ?',
  'Et si le passage obscur était le plus important ?',
  'Écrire, est-ce découvrir ce que l’on pense ?',
  'La mémoire garde-t-elle les livres, ou ce qu’ils ont fait de nous ?',
  'Qu’aurais-tu demandé à Socrate s’il t’avait laissé parler ?',
  'Un livre fini est-il un livre terminé ?',
  'Penser seul, est-ce vraiment penser seul ?',
];

/** Phrases contextuelles : des fonctions qui reçoivent le contexte et renvoient une phrase, ou null si elle ne s’applique pas. */
export type Ctx = {
  page: 'home' | 'library' | 'workspace' | 'other';
  hour: number; // 0-23
  books: number; // nombre de livres
  drafts: number; // nombre d’écrits
  level: 0 | 1 | 2 | 3 | 4; // musculature du cerveau
  book?: { title: string; author: string; progress: number }; // livre sur lequel il est assis / livre en cours (progress 0..1)
  space?: { name: string; items: number }; // espace sur lequel il est assis
  due?: number; // cartes de révision à revoir aujourd’hui
  // Ce qu’il y a à l’écran et dans la bibliothèque (tout est facultatif : une phrase ne sort que si son
  // information est connue).
  weekday?: number; // 0 dimanche … 6 samedi
  highlights?: number; // extraits en tout
  concepts?: number;
  conceptName?: string; // un concept au hasard
  cards?: number; // fiches de révision
  plans?: number;
  spaces?: number;
  trash?: number;
  inbox?: number; // éléments reçus du téléphone en attente
  unread?: number; // livres jamais ouverts
  finished?: number; // livres lus jusqu’au bout
  topAuthor?: { name: string; n: number }; // auteur le plus présent
  bookHl?: number; // extraits du livre (celui du contexte)
  bookFormat?: string; // epub, pdf, image…
  bookDays?: number | null; // jours depuis la dernière ouverture du livre
  lastExtract?: { text: string; book: string };
  lastDraft?: { title: string; words: number; days: number };
};

/** Coupe une chaîne trop longue et termine par une ellipse. */
const short = (s: string, n = 40): string => {
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};
const ttl = (b: { title: string }) => `« ${short(b.title)} »`;
const auth = (b: { author: string }) => short(b.author, 24);
const late = (h: number) => h >= 23 || h < 5;
/** Citation sans sa ponctuation finale (elle est remise après le guillemet). */
const quoteOf = (t: string, n: number) => short(t.replace(/[\s.!?…;:,]+$/u, ''), n);

export const CONTEXT: ((c: Ctx) => string | null)[] = [
  // Heure
  (c) => (late(c.hour) ? 'Il est tard. Même la chouette de Minerve est allée se coucher.' : null),
  (c) => (late(c.hour) ? 'Mes neurones font des heures sup. On en reparle demain ?' : null),
  (c) => (late(c.hour) && c.book ? `${ttl(c.book)} sera encore là demain matin, promis.` : null),
  (c) => (c.hour >= 5 && c.hour < 8 ? 'Déjà debout ? Kant serait fier. Moi, je bâille.' : null),
  (c) => (c.hour >= 5 && c.hour < 9 ? 'Lecture du matin, idées fraîches. Le café est en option.' : null),
  (c) => (c.hour >= 12 && c.hour < 14 ? 'Midi. Épicure approuverait une pause déjeuner.' : null),
  (c) => (c.hour >= 14 && c.hour < 16 ? 'Le creux de l’après-midi : moment idéal pour une page, une seule.' : null),
  // Pages
  (c) => (c.page === 'library' && c.books === 0 ? 'Une bibliothèque vide, c’est une table rase. Ajoute un premier livre ?' : null),
  (c) => (c.page === 'library' && c.books > 0 && c.books < 5 ? 'Petite bibliothèque, mais choisie. C’est le plus important.' : null),
  (c) =>
    c.page === 'library' && c.books >= 30
      ? `${c.books} livres. Montaigne en avait mille, mais tu as le temps.`
      : null,
  (c) => (c.page === 'library' && c.books >= 10 ? 'Je me promène entre tes livres. Ça sent le papier et les idées.' : null),
  (c) => (c.page === 'home' ? 'Bienvenue dans la marge. On reprend où on s’était arrêtés ?' : null),
  (c) => (c.page === 'workspace' ? 'Un espace de travail, c’est un atelier : on a le droit d’y mettre du désordre.' : null),
  // Livre en cours / livre sur lequel il est assis
  (c) => (c.book && c.book.progress <= 0 ? `${ttl(c.book)}, pas encore ouvert. On commence ?` : null),
  (c) => (c.book && c.book.progress <= 0 ? `Assis sur ${ttl(c.book)}. Confortable, mais meilleur lu.` : null),
  (c) =>
    c.book && c.book.progress > 0 && c.book.progress < 0.5
      ? `Tu en es au début de ${ttl(c.book)}. Le meilleur reste à venir.`
      : null,
  (c) =>
    c.book && c.book.progress >= 0.5 && c.book.progress <= 0.9
      ? `Plus de la moitié de ${ttl(c.book)}. On ne lâche rien.`
      : null,
  (c) =>
    c.book && c.book.progress > 0.9 && c.book.progress < 1
      ? `Presque fini, ${ttl(c.book)} ! Encore quelques pages.`
      : null,
  (c) => (c.book && c.book.progress >= 1 ? `${ttl(c.book)}, lu jusqu’au bout. Chapeau. Enfin, si j’en avais un.` : null),
  (c) => (c.book && c.book.author ? `Je me demande ce que ${auth(c.book)} penserait de tes notes.` : null),
  // Espace
  (c) => (c.space && c.space.items === 0 ? `« ${short(c.space.name, 30)} » est encore vide. Tout est possible.` : null),
  (c) =>
    c.space && c.space.items >= 20
      ? `${c.space.items} éléments dans « ${short(c.space.name, 30)} ». Ça commence à penser tout seul.`
      : null,
  (c) =>
    c.space && c.space.items > 0 && c.space.items < 20
      ? `Je m’assieds sur « ${short(c.space.name, 30)} ». Je ne dérange rien, promis.`
      : null,
  // Révisions
  (c) => (c.due === 0 ? 'Aucune carte à revoir aujourd’hui. Je m’autorise une petite sieste.' : null),
  (c) => (c.due !== undefined && c.due > 0 && c.due < 10 ? `${c.due} carte${c.due > 1 ? 's' : ''} à revoir. Cinq minutes, et c’est plié.` : null),
  (c) => (c.due !== undefined && c.due >= 10 ? `${c.due} cartes t’attendent. Une à la fois, comme Descartes.` : null),
  // Écrits
  (c) => (c.drafts === 0 ? 'Aucun écrit pour l’instant. Une seule phrase suffit pour commencer.' : null),
  (c) => (c.drafts === 0 && c.books > 0 ? 'Tu lis beaucoup. Et si tu écrivais ce que tu en penses ?' : null),
  (c) => (c.drafts >= 10 ? `${c.drafts} écrits ! Montaigne aussi a commencé par des essais.` : null),
  // Muscles
  (c) => (c.level === 0 ? 'Je suis encore un petit cerveau. Chaque livre me fait grandir.' : null),
  (c) => (c.level === 4 ? 'Regarde ces circonvolutions. Je pourrais soulever la Critique de la raison pure.' : null),
  (c) => (c.level === 4 ? 'Niveau maximal. Je fais des pompes sur les syllogismes.' : null),
  (c) => (c.level >= 2 && c.level < 4 ? 'Je sens mes neurones se raffermir. Continue comme ça.' : null),  // ── Ce qu’il y a à l’écran ─────────────────────────────────
  // Le livre du contexte : ses extraits, son format, la dernière fois qu’il a été ouvert.
  (c) => (c.book && c.bookHl === 0 && c.book.progress > 0.05 ? `Aucun extrait dans ${ttl(c.book)}. Rien ne t’a arrêté ? Méfie-toi des lectures trop lisses.` : null),
  (c) => (c.book && c.bookHl && c.bookHl > 0 && c.bookHl < 5 ? `${c.bookHl} extrait${c.bookHl > 1 ? 's' : ''} dans ${ttl(c.book)}. Peu, mais bien choisis, j’espère.` : null),
  (c) => (c.book && c.bookHl && c.bookHl >= 10 && c.bookHl < 20 ? `Les marges de ${ttl(c.book)} commencent à être bien remplies.` : null),
  (c) => (c.book && c.bookHl && c.bookHl >= 20 ? `${c.bookHl} extraits dans ${ttl(c.book)} ! Tu vas finir par surligner tout le livre.` : null),
  (c) => (c.book && c.bookHl && c.bookHl > 0 && c.book.progress < 0.1 ? `Déjà des extraits alors que tu viens de commencer ${ttl(c.book)}. Lecteur attentif.` : null),
  (c) => (c.book && c.bookFormat === 'pdf' ? `Un PDF. Je m’assieds dessus quand même : c’est plat, c’est confortable.` : null),
  (c) => (c.book && c.bookFormat === 'epub' ? `${ttl(c.book)} en EPUB : la page s’adapte à toi. Moi aussi, d’ailleurs.` : null),
  (c) => (c.book && c.bookFormat === 'image' ? 'Une photo de page. Le papier n’a jamais été aussi léger.' : null),
  (c) => (c.book && c.bookDays != null && c.bookDays >= 14 && c.bookDays < 60 ? `${c.bookDays} jours que tu n’as pas ouvert ${ttl(c.book)}. Il s’ennuie un peu.` : null),
  (c) => (c.book && c.bookDays != null && c.bookDays >= 60 ? `${ttl(c.book)} prend la poussière. Enfin, la poussière numérique.` : null),
  (c) => (c.book && c.bookDays === 0 && c.book.progress > 0 ? `Tu as lu ${ttl(c.book)} aujourd’hui. Je l’ai senti dans mes synapses.` : null),
  (c) => (c.book && c.book.progress >= 0.2 && c.book.progress < 0.35 ? `Un quart de ${ttl(c.book)} déjà. Le plus dur, c’était de commencer.` : null),
  (c) => (c.book && c.book.progress >= 0.45 && c.book.progress <= 0.55 ? `Pile la moitié de ${ttl(c.book)}. Le juste milieu, dirait Aristote.` : null),
  (c) => (c.book && c.book.author ? `${auth(c.book)}… J’aimerais bien lui poser deux ou trois questions.` : null),
  (c) => (c.book && c.book.author && c.bookHl ? `Si ${auth(c.book)} voyait tes surlignages, je crois que ça lui ferait plaisir.` : null),
  (c) => (c.page === 'library' && c.book ? `Je suis assis sur ${ttl(c.book)}. Si tu l’ouvres, je me pousse.` : null),
  (c) => (c.page === 'home' && c.book ? `${ttl(c.book)} t’attend sur « Reprendre ». Il a gardé ta page.` : null),
  // La bibliothèque
  (c) => (c.unread !== undefined && c.unread >= 5 ? `${c.unread} livres pas encore ouverts. Une pile à lire, c’est une promesse.` : null),
  (c) => (c.unread === 0 && c.books >= 3 ? 'Tous tes livres ont été ouverts au moins une fois. C’est rare, ça.' : null),
  (c) => (c.finished && c.finished >= 1 ? `${c.finished} livre${c.finished > 1 ? 's' : ''} lu${c.finished > 1 ? 's' : ''} jusqu’au bout. Je garde le compte.` : null),
  (c) => (c.topAuthor && c.topAuthor.n >= 3 ? `${c.topAuthor.n} livres de ${short(c.topAuthor.name, 24)}. C’est de la fidélité, ou une obsession ?` : null),
  (c) => (c.topAuthor && c.topAuthor.n === 2 ? `Deux livres de ${short(c.topAuthor.name, 24)} : tu prépares un dialogue avec lui-même ?` : null),
  (c) => (c.books >= 5 && c.books < 30 ? `${c.books} livres : de quoi tenir un long hiver.` : null),
  // Les extraits
  (c) => (c.highlights === 0 && c.books > 0 ? 'Pas encore un seul extrait. Le surligneur ne mord pas.' : null),
  (c) => (c.highlights !== undefined && c.highlights >= 50 && c.highlights < 300 ? `${c.highlights} extraits en tout. Tu tisses ta propre anthologie.` : null),
  (c) => (c.highlights !== undefined && c.highlights >= 300 ? `${c.highlights} extraits. Pascal a laissé près de mille fragments ; tu t’en approches.` : null),
  (c) => (c.lastExtract ? `J’ai relu ton dernier extrait : « ${quoteOf(c.lastExtract.text, 60)} ». Bien vu.` : null),
  (c) => (c.lastExtract ? `« ${quoteOf(c.lastExtract.text, 50)} »… Ça mériterait une fiche de révision, non ?` : null),
  (c) => (c.page === 'home' && c.highlights ? 'J’aime bien jeter un œil aux derniers extraits, en bas de l’accueil. Tu as bon goût.' : null),
  // Les concepts
  (c) => (c.concepts === 0 && c.highlights !== undefined && c.highlights >= 10 ? 'Beaucoup d’extraits, aucun concept. Et si tu nommais ce qui revient ?' : null),
  (c) => (c.conceptName ? `Le concept « ${short(c.conceptName, 28)} » me travaille. Tu en as une définition à toi ?` : null),
  (c) => (c.conceptName ? `« ${short(c.conceptName, 28)} »… Encore faudrait-il s’entendre sur les mots. Socrate y passait des journées.` : null),
  (c) => (c.concepts !== undefined && c.concepts >= 10 ? `${c.concepts} concepts : tu te construis un vrai vocabulaire philosophique.` : null),
  // Les fiches de révision
  (c) => (c.cards === 0 && c.highlights !== undefined && c.highlights >= 5 ? 'Aucune fiche de révision. La mémoire, ça s’entretient comme un muscle.' : null),
  (c) => (c.cards !== undefined && c.cards >= 50 ? `${c.cards} fiches de révision. Ta mémoire va devenir encyclopédique.` : null),
  (c) => (c.page === 'home' && c.due !== undefined && c.due > 0 ? 'Les fiches d’abord, le reste ensuite. Promis, ce sera rapide.' : null),
  (c) => (c.due !== undefined && c.due >= 30 ? `${c.due} cartes… Elles se sont multipliées pendant que tu dormais.` : null),
  // Les écrits et les plans
  (c) => (c.lastDraft && c.lastDraft.words > 0 && c.lastDraft.words < 100 ? `« ${short(c.lastDraft.title, 30)} » ne fait que ${c.lastDraft.words} mots. Les grands textes aussi ont commencé petits.` : null),
  (c) => (c.lastDraft && c.lastDraft.words >= 1000 ? `« ${short(c.lastDraft.title, 30)} » dépasse les ${(Math.floor(c.lastDraft.words / 1000) * 1000).toLocaleString('fr-FR')} mots. Ça devient sérieux.` : null),
  (c) => (c.lastDraft && c.lastDraft.days >= 7 ? `« ${short(c.lastDraft.title, 30)} » attend depuis ${c.lastDraft.days} jours. Une phrase aujourd’hui ?` : null),
  (c) => (c.lastDraft && c.lastDraft.days === 0 ? 'Tu as écrit aujourd’hui. Je l’ai vu. Je ne dis rien. Enfin, si.' : null),
  (c) => (c.plans && c.plans >= 1 && c.drafts === 0 ? 'Un plan sans écrit, c’est une carte sans voyage.' : null),
  (c) => (c.plans === 0 && c.drafts > 0 ? 'Tu écris sans plan ? Audacieux. Montaigne faisait pareil.' : null),
  (c) => (c.books && c.drafts && c.highlights && c.concepts && c.cards ? 'Lire, extraire, définir, réviser, écrire : tu as fait le tour complet. Bravo.' : null),
  // Les espaces
  (c) => (c.spaces === 0 && c.books >= 5 ? 'Et si tu rangeais tes lectures dans un espace de travail ?' : null),
  (c) => (c.space ? `« ${short(c.space.name, 30)} »… Joli nom pour un atelier de pensée.` : null),
  (c) => (c.space && c.space.items > 0 && c.space.items < 5 ? `Quelques éléments dans « ${short(c.space.name, 30)} ». Les fondations sont posées.` : null),
  // Téléphone, corbeille
  (c) => (c.inbox && c.inbox > 0 ? `${c.inbox === 1 ? 'Une chose reçue' : `${c.inbox} choses reçues`} du téléphone ${c.inbox === 1 ? 't’attend' : 't’attendent'} dans la bibliothèque.` : null),
  (c) => (c.trash !== undefined && c.trash >= 10 ? `${c.trash} éléments dans la corbeille. On fait le ménage, ou on garde tout par prudence ?` : null),
  // Le jour et l’heure
  (c) => (c.weekday === 1 && c.hour < 12 ? 'Lundi matin. Sisyphe aussi reprenait sa pierre. Il faut l’imaginer heureux.' : null),
  (c) => (c.weekday === 5 && c.hour >= 15 ? 'Vendredi après-midi. Épicure conseillerait de finir le chapitre au soleil.' : null),
  (c) => (c.weekday === 0 || c.weekday === 6 ? 'Le week-end, on lit pour le plaisir. Et le plaisir, c’est sérieux.' : null),
  (c) => (c.hour >= 18 && c.hour < 21 ? 'Fin de journée : le bon moment pour relire ses extraits.' : null),
  (c) => (c.hour >= 21 && c.hour < 23 ? 'Lecture du soir : les idées mûrissent pendant la nuit.' : null),
];


/** Salutations à l’arrivée. */
export const HELLO: string[] = [
  'Je passais par là.',
  'On lit quoi aujourd’hui ?',
  'Pause dans la marge.',
  'Coucou ! J’ai gardé ta page au chaud.',
  'Me revoilà. J’ai fait le tour de la bibliothèque.',
  'Bonjour ! Mes neurones sont tout ouïe.',
  'Salut. Je viens voir ce que tu penses.',
  'Tiens, te revoilà. On reprend la discussion ?',
  'Je me suis réveillé. Enfin, à moitié.',
  'Hop, un petit tour dans tes idées.',
];

/** Quand il gagne un niveau de muscle. */
export const FLEX: string[] = [
  'Encore un livre ? Je sens mes neurones gonfler.',
  'Regarde-moi ces circonvolutions.',
  'Ça, c’est du muscle conceptuel.',
  'Niveau supérieur ! Mes synapses font de la musculation.',
  'Je viens de prendre un pli. Un vrai.',
  'Plus fort ! Je pourrais porter un traité entier.',
  'Ce qui ne me tue pas me rend plus musclé.',
  'Admire ce lobe frontal. Que du travail, pas de triche.',
];

/** Quand on clique sur lui (il est un peu dérangé, puis donne une citation : ici juste la petite phrase d’avant). */
export const POKE: string[] = [
  'Hé ! Je réfléchissais.',
  'Aïe, c’était mon hippocampe.',
  'Doucement, il y a des idées là-dedans.',
  'Tu m’as fait perdre le fil. Tiens, une citation.',
  'Oui ? Ah, tu veux une citation. En voilà une.',
  'Ça chatouille, le cortex.',
  'Je méditais ! Bon, d’accord, je dormais.',
  'Tu me cherches ? Je te donne une pensée.',
  'Pas besoin de frapper, c’est ouvert.',
  'Hm ? Ah. J’ai justement quelque chose pour toi.',
];

/** Au moment de partir. */
export const BYE: string[] = [
  'Je vais faire un tour. Lis bien.',
  'Je file, mais je garde l’œil sur tes marges.',
  'À tout à l’heure. Pense à moi, ça me muscle.',
  'Je rentre dans ma boîte crânienne.',
  'Je vais méditer un peu plus loin.',
  'Je te laisse avec tes pensées. Elles sont en bonne compagnie.',
  'Promenade digestive, comme Kant. Je reviens.',
  'Je m’éclipse. Socratiquement.',
  'Bon, je vais ranger quelques idées.',
  'À plus tard. Ne souligne pas tout sans moi.',
];

/** Il joue de la guitare. */
export const GUITAR: string[] = [
  'Nietzsche aimait la musique. Il n’a jamais entendu la mienne, c’est plus prudent.',
  'Pythagore entendait l’harmonie des sphères. Moi, surtout ma corde de mi.',
  'Un do majeur, une dialectique mineure. Le reste, c’est de l’improvisation.',
  'Schopenhauer dit que la musique exprime la volonté. La mienne veut un accord.',
  'On est rarement d’accord en philosophie. À la guitare non plus, apparemment.',
  'Je joue d’oreille. Le problème, c’est que je n’en ai pas.',
  'Thèse, antithèse, synthé. Ah non, pardon, c’est une guitare.',
  'Mes accords sont comme mes arguments : un peu faux, mais très sincères.',
  'Pythagore a trouvé l’octave. Moi, je cherche encore le la.',
  'Nietzsche composait aussi, et mal. Je suis donc en excellente compagnie.',
];

/** Il sifflote. */
export const WHISTLE: string[] = [
  'Ataraxie : absence de trouble. Et présence d’un petit air sifflé.',
  'Rousseau rêvait en se promenant seul. Moi, je siffle. C’est plus bruyant.',
  'Je flâne, je siffle, je ne pense à rien. Enfin, presque à rien.',
  'Épicure parlait de plaisir en repos. Je siffle en repos, c’est pareil.',
  'Pas de souci, pas de thèse à défendre. Juste un air à finir.',
  'Je siffle pour garder mes pensées en forme. Elles suivent le rythme.',
  'Rêveries du promeneur solitaire, première promenade. En sifflant.',
  'Siffler en marchant : la seule dialectique qui ne contredit personne.',
  'Pardon, je sifflotais. Mes neurones avaient besoin d’un petit air.',
  'Si tu reconnais l’air, ne dis rien. Moi, je l’ai oublié en route.',
];

/** Il écrit un livre. */
export const WRITE: string[] = [
  'Mon prochain livre : « Critique de la raison pure laine ». Ça va gratter.',
  'Titre de travail : « Traité des circonvolutions ». Il y aura des détours.',
  'Page blanche. Je pense, donc je suis… bloqué.',
  'Quarante notes de bas de page pour une seule phrase. Je tiens un style.',
  'Titre provisoire : « Ainsi parlait mon cervelet ». Tu en penses quoi ?',
  'Chapitre douze sur trois prévus. Le plan est devenu un système.',
  'J’écris un essai. Montaigne aussi a commencé comme ça, je me rassure.',
  'Tome II : « Le Monde comme volonté et comme sieste ».',
  'Le syndrome de la page blanche ? Moi, c’est la marge blanche. Plus grave.',
  'J’ai fini la préface. Il ne reste plus que le livre.',
];

/** Il fume un cigare en penseur de fauteuil. */
export const CIGAR: string[] = [
  'Parfois, disait à peu près Freud, un cigare n’est qu’un cigare. Ouf.',
  'Mes ronds de fumée sont comme mes arguments : ils tournent en rond.',
  'Ne fais pas comme moi : je suis un dessin.',
  'Penseur de fauteuil, c’est un métier. Surtout la partie fauteuil.',
  'Un rond, deux ronds, trois ronds. Voilà un raisonnement circulaire.',
  'Je médite sur le Tout. En prenant mon temps, comme le Tout.',
  'Descartes méditait près d’un poêle. Moi, avec un cigare. Même chaleur.',
  'Ce cigare est-il un symbole ? Je laisse la question au psychanalyste.',
  'Mes idées partent en fumée. Heureusement, j’en ai d’autres en réserve.',
];

export const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

// ── Répliques propres à chaque philosophe ──────────────────

/** Citations ajoutées pour les philosophes (en plus de celles de QUOTES du même auteur). */
const EXTRA_QUOTES: Quote[] = [
  { text: 'La pensée est un dialogue intérieur et silencieux de l’âme avec elle-même.', author: 'Platon', source: 'Le Sophiste' },
  { text: 'L’étonnement est le point de départ de la philosophie.', author: 'Platon', source: 'Théétète' },
  { text: 'Renoncer à sa liberté, c’est renoncer à sa qualité d’homme.', author: 'Rousseau', source: 'Du contrat social' },
];

/** Citations d'un auteur (le philosophe choisi comme compagnon cite surtout les siennes). */
export const quotesBy = (author: string): Quote[] => [...QUOTES, ...EXTRA_QUOTES].filter((q) => q.author === author);

/** Salutations propres à chaque philosophe. */
export const HELLO_BY: Record<string, string[]> = {
  Socrate: ['Je sais que je ne sais rien. Mais je suis curieux.', 'Une petite question, si tu permets…', 'Me revoilà sur l’agora.'],
  Platon: ['Sorti de la caverne, me voici.', 'Que nul n’entre ici s’il ne lit pas.', 'Les Idées m’envoient prendre des nouvelles.'],
  Aristote: ['J’ai classé ta bibliothèque. Enfin, presque.', 'Le Lycée est fermé aujourd’hui, je passe ici.', 'Je cherche le juste milieu de cette page.'],
  Rousseau: ['Je reviens de promenade, solitaire comme toujours.', 'J’herborisais dans tes marges.', 'Bonjour, citoyen lecteur.'],
};
