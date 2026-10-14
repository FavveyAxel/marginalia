// Règles de la revue de style (dissertations / explications de texte en français).
// Module PUR : aucune dépendance (ni DOM, ni moteur d'édition) — testable sous node.
// Entrée : le texte des paragraphes. Sortie : des constats positionnés par (paragraphe, début, fin)
// en unités de caractères du paragraphe ; l'appelant les convertit en positions du document.

export type StyleCategory = 'long' | 'repeat' | 'adverb' | 'tic' | 'connector' | 'jepense';

export interface StyleFinding {
  id: string;
  cat: StyleCategory;
  /** Indice du paragraphe dans la liste fournie. */
  para: number;
  /** Début / fin (exclue) dans le texte du paragraphe. */
  from: number;
  to: number;
  /** Texte concerné (extrait du paragraphe). */
  text: string;
  /** Explication courte, affichée sous l'extrait. */
  msg: string;
}

export interface StyleOptions {
  /** Longueur au-delà de laquelle une phrase est jugée trop longue (défaut 40 mots). */
  maxSentenceWords?: number;
  /** Écart (en mots) sous lequel une répétition est signalée (défaut 30). */
  repeatGap?: number;
  /** Nombre d'adverbes en -ment par paragraphe à partir duquel on les signale (défaut 2). */
  adverbPerParagraph?: number;
  /** Mots d'un paragraphe à partir desquels l'absence de connecteur est signalée (défaut 80). */
  connectorMinWords?: number;
  /** Nombre d'attaques identiques (« En effet », « Ainsi »…) à partir duquel on signale (défaut 3). */
  starterRepeat?: number;
  /** Signaler « je pense que » & co. (défaut true ; à couper pour une fiche personnelle). */
  firstPerson?: boolean;
}

export const CATEGORY_INFO: Record<StyleCategory, { label: string; hint: string }> = {
  long: { label: 'Phrases trop longues', hint: 'Plus de 40 mots : coupez ou articulez.' },
  repeat: { label: 'Répétitions', hint: 'Un même mot plein à moins de 30 mots d’intervalle.' },
  adverb: { label: 'Adverbes en -ment', hint: 'Plusieurs adverbes dans un même paragraphe.' },
  tic: { label: 'Tics de copie', hint: 'Formules toutes faites et attaques répétées.' },
  connector: { label: 'Connecteurs logiques absents', hint: 'Long paragraphe sans « mais », « donc », « or »…' },
  jepense: { label: 'Première personne', hint: '« Je pense que » : à éviter dans une dissertation.' },
};

export const CATEGORY_ORDER: StyleCategory[] = ['long', 'repeat', 'adverb', 'tic', 'connector', 'jepense'];

// ── Outils de texte ──────────────────────────────────────────
const WORD_RE = /[\p{L}\p{N}]+(?:['’\-‐][\p{L}\p{N}]+)*/gu;

/** Texte à offsets conservés : apostrophes typographiques et espaces insécables normalisés. */
const flat = (s: string) => s.replace(/[’‘]/g, "'").replace(/[  ]/g, ' ');

const strip = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function countWordsIn(text: string): number {
  return (text.match(WORD_RE) ?? []).length;
}

// ── Phrases ──────────────────────────────────────────────────
const ABBR = new Set(['m', 'mm', 'mme', 'mmes', 'mlle', 'dr', 'pr', 'cf', 'etc', 'p', 'pp', 'vol', 'ch', 'chap', 'art', 'éd', 'ed', 'ex', 'op', 'cit', 'n', 'no', 'vs', 'st', 'ibid', 'id', 'sq', 'sqq', 'trad', 'liv', 'l', 't', 'tt', 'fr']);

interface Sentence {
  from: number;
  to: number;
}

export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const re = /[.!?…]+/g;
  let m: RegExpExecArray | null;
  const push = (a: number, b: number) => {
    let f = a;
    let t = b;
    while (f < t && /[\s«»"“”\-–—(\[]/.test(text[f])) f++;
    while (t > f && /\s/.test(text[t - 1])) t--;
    if (t > f) out.push({ from: f, to: t });
  };
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const next = text.slice(end);
    // suite immédiate sans espace (« 3.5 », « www.x ») : pas une fin de phrase
    if (next.length && !/^[\s»"”)\]]/.test(next)) continue;
    const after = next.replace(/^[\s»"”)\]]+/, '');
    if (after && /^\p{Ll}/u.test(after)) continue;
    const before = text.slice(start, m.index);
    const prev = /(\p{L}+)$/u.exec(before)?.[1] ?? '';
    if (m[0] === '.' && (ABBR.has(prev.toLowerCase()) || (prev.length === 1 && /\p{Lu}/u.test(prev)))) continue;
    push(start, end);
    start = end;
  }
  push(start, text.length);
  return out;
}

// ── Lexique : mots-outils et racines ─────────────────────────
const STOP = new Set(
  (
    'le la les un une des du de d l au aux et ou ni mais donc or car que qui quoi dont où quand comme si ' +
    'ce cet cette ces celui celle ceux celles ceci cela ça ca ' +
    'je tu il elle on nous vous ils elles me te se lui leur leurs eux moi toi soi y en ' +
    'mon ma mes ton ta tes son sa ses notre nos votre vos ' +
    'ne pas plus moins très tres trop aussi encore déjà deja toujours jamais alors ainsi puis ' +
    'dans sur sous avec sans pour par vers chez entre contre depuis pendant avant après apres selon malgré ' +
    'tout tous toute toutes autre autres même meme mêmes quel quelle quels quelles quelque quelques chaque ' +
    'être etre est es sont sommes êtes etes suis était etait étaient etaient été ete sera seront serait seraient soit soient fut furent étant etant ' +
    'avoir ai as avons avez ont avait avaient aura auront aurait auraient eu eut eurent ayant ' +
    'faire fait font faisait faisant fais faut falloir peut peuvent pouvait pourrait pourraient pouvoir pu ' +
    'dit dire dis disent doit doivent devoir devait voir vu va vont aller veut veulent vouloir ' +
    'cependant pourtant puisque lorsque parce afin tandis bien peu beaucoup ici là la-bas ' +
    'effet ainsi donc certes enfin ensuite aucun aucune rien chose choses'
  ).split(/\s+/),
);

const SUFFIXES = [
  'issements', 'issement', 'ements', 'ement', 'ations', 'ation', 'ateurs', 'ateur', 'ances', 'ance', 'ences', 'ence',
  'ites', 'ite', 'ismes', 'isme', 'istes', 'iste', 'euses', 'euse', 'eurs', 'eur', 'ions', 'ion', 'ables', 'able',
  'ibles', 'ible', 'ives', 'ive', 'ifs', 'if', 'aux', 'elles', 'elle', 'els', 'el', 'ent', 'ant', 'er', 'es', 'e', 's', 'x',
];

/** Racine approchée (lemmatisation simple) : sans accents, sans désinence courante. */
export function stem(word: string): string {
  const w = strip(word);
  for (const suf of SUFFIXES) {
    if (w.length - suf.length >= 4 && w.endsWith(suf)) return w.slice(0, w.length - suf.length);
  }
  return w;
}

export function isStopWord(word: string): boolean {
  return STOP.has(word.toLowerCase()) || STOP.has(strip(word));
}

// ── Adverbes en -ment ────────────────────────────────────────
const NOUNS_MENT = new Set(
  (
    'moment document gouvernement sentiment élément argument comportement mouvement fondement jugement raisonnement changement ' +
    'enseignement commencement développement instrument monument ornement tempérament aliment ciment régiment vêtement événement ' +
    'évènement fragment segment complément supplément paiement engagement rassemblement avènement tourment testament établissement ' +
    'environnement médicament appartement bâtiment département parlement règlement traitement sacrement châtiment ressentiment ' +
    'consentiment assentiment attachement détachement accomplissement épanouissement rapprochement déroulement aboutissement ' +
    'accroissement assujettissement affranchissement abaissement agrément aveuglement bannissement bouleversement commandement ' +
    'déplacement discernement divertissement dénouement emplacement enrichissement entendement entraînement équipement étonnement ' +
    'gémissement hébergement management pansement placement recrutement refroidissement remplacement renforcement revêtement ' +
    'soulèvement tâtonnement asservissement dénuement anéantissement amendement ravissement éloignement enchaînement avertissement ' +
    'dépassement effondrement renoncement apaisement acheminement aménagement approvisionnement arrangement avancement ' +
    'bonheur-moment châtiment couronnement dérèglement désenchantement dévouement emportement encouragement engendrement ' +
    'enlèvement épuisement établissement fonctionnement gouvernement hurlement lancement mécontentement ménagement nivellement ' +
    'partiment pensement raffinement rattachement redressement rejaillissement relâchement remerciement rétablissement ' +
    'retranchement sacrement saisissement soulagement tremblement tiraillement vieillissement vêtements'
  ).split(/\s+/),
);

export function isAdverbMent(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length < 7 || !w.endsWith('ment')) return false;
  if (NOUNS_MENT.has(w) || NOUNS_MENT.has(w.replace(/s$/, ''))) return false;
  if (/(?:issement|ssement|gement|cement|ncement|timent|ciment)s?$/.test(w)) return false;
  if (/s$/.test(w)) return false;
  return true;
}

// ── Tics de copie ────────────────────────────────────────────
const sp = '\\s+';
const TIC_SRC: { re: string; label: string }[] = [
  { re: `on${sp}peut${sp}dire${sp}que`, label: 'Formule creuse : affirmez directement.' },
  { re: `il${sp}est${sp}(?:important|essentiel|nécessaire|utile|intéressant|bon)${sp}de${sp}(?:noter|souligner|préciser|rappeler|remarquer|mentionner|signaler)${sp}que`, label: 'Remplissage : dites-le sans l’annoncer.' },
  { re: `il${sp}(?:faut|convient${sp}de|importe${sp}de)${sp}(?:noter|souligner|remarquer|préciser)${sp}que`, label: 'Remplissage : dites-le sans l’annoncer.' },
  { re: `de${sp}nos${sp}jours`, label: 'Cliché d’introduction : datez ou situez précisément.' },
  { re: `à${sp}notre${sp}époque`, label: 'Cliché d’introduction : datez ou situez précisément.' },
  { re: `à${sp}l'heure${sp}actuelle`, label: 'Cliché d’introduction : datez ou situez précisément.' },
  { re: `depuis${sp}la${sp}nuit${sp}des${sp}temps`, label: 'Cliché d’introduction.' },
  { re: `de${sp}tout${sp}temps`, label: 'Cliché d’introduction.' },
  { re: `dans${sp}la${sp}vie${sp}de${sp}tous${sp}les${sp}jours`, label: 'Cliché : précisez de quelle expérience il s’agit.' },
  { re: `tout${sp}à${sp}fait`, label: 'Intensif vide : supprimez ou nuancez.' },
  { re: `bien${sp}évidemment`, label: 'Ce qui est évident n’a pas à être dit ; sinon, démontrez.' },
  { re: `bien${sp}entendu`, label: 'Ce qui va de soi n’a pas à être dit ; sinon, démontrez.' },
  { re: `il${sp}va${sp}de${sp}soi${sp}que`, label: 'Ce qui va de soi n’a pas à être dit ; sinon, démontrez.' },
  { re: `force${sp}est${sp}de${sp}constater`, label: 'Formule toute faite.' },
  { re: `comme${sp}chacun${sp}sait`, label: 'Appel à l’évidence : citez ou démontrez.' },
  { re: `il${sp}est${sp}(?:clair|évident|certain)${sp}que`, label: 'Affirmation sans preuve : démontrez plutôt.' },
  { re: `d'une${sp}certaine${sp}(?:manière|façon)`, label: 'Nuance floue : précisez en quel sens.' },
];
const TICS = TIC_SRC.map((t) => ({ re: new RegExp(`(?<!\\p{L})${t.re}(?!\\p{L})`, 'giu'), label: t.label }));

const STARTERS = ['en effet', 'ainsi', 'de plus', 'par ailleurs', 'en outre', 'cependant'];
const STARTER_RE = new RegExp(`^(${STARTERS.map((s) => s.replace(' ', '\\s+')).join('|')})(?![\\p{L}])`, 'iu');

// ── Connecteurs logiques ─────────────────────────────────────
const CONNECTORS = [
  'mais', 'donc', 'or', 'car', 'cependant', 'pourtant', 'ainsi', 'en effet', 'd’abord', 'ensuite', 'enfin', 'par ailleurs', 'de plus',
  'en outre', 'toutefois', 'néanmoins', 'en revanche', 'par conséquent', 'c’est pourquoi', 'alors que', 'tandis que', 'parce que',
  'puisque', 'certes', 'd’une part', 'd’autre part', 'en conclusion', 'autrement dit', 'c’est-à-dire', 'dès lors', 'aussi', 'lorsque',
  'bien que', 'même si', 'afin de', 'afin que', 'de sorte que', 'en somme', 'finalement', 'premièrement', 'deuxièmement', 'par suite',
  'si bien que', 'quoique', 'pour autant', 'au contraire', 'à l’inverse', 'en d’autres termes', 'à cet égard', 'de fait', 'en effet',
  'ou bien', 'quand', 'si', 'puis', 'en conséquence', 'd’ailleurs', 'sinon', 'à moins que', 'pourvu que', 'comme',
];
const CONN_RE = new RegExp(
  `(?<![\\p{L}])(?:${CONNECTORS.map((c) => c.replace(/’/g, "'").replace(/ /g, '\\s+')).join('|')})(?![\\p{L}])`,
  'iu',
);

// ── Première personne ────────────────────────────────────────
const JE_RE = new RegExp(
  `(?<![\\p{L}])(?:je${sp}(?:ne${sp})?(?:pense|crois|trouve|considère|suppose|ressens|dirais|sais)(?:${sp}pas)?${sp}que|j'estime${sp}que|j'ai${sp}l'impression${sp}que|à${sp}mon${sp}avis|selon${sp}moi|pour${sp}ma${sp}part|d'après${sp}moi|à${sp}mes${sp}yeux|personnellement)(?![\\p{L}])`,
  'giu',
);

// ── Analyse ──────────────────────────────────────────────────
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function analyze(paragraphs: string[], opts: StyleOptions = {}): StyleFinding[] {
  const maxWords = opts.maxSentenceWords ?? 40;
  const gap = opts.repeatGap ?? 30;
  const advMin = opts.adverbPerParagraph ?? 2;
  const connMin = opts.connectorMinWords ?? 80;
  const starterMin = opts.starterRepeat ?? 3;
  const firstPerson = opts.firstPerson ?? true;

  const out: StyleFinding[] = [];
  let n = 0;
  const add = (cat: StyleCategory, para: number, from: number, to: number, msg: string) => {
    out.push({ id: `${cat}-${n++}`, cat, para, from, to, text: paragraphs[para].slice(from, to), msg });
  };

  const last = new Map<string, number>(); // racine → indice du dernier mot
  let wordIdx = 0;
  const starters = new Map<string, { para: number; from: number; to: number }[]>();

  paragraphs.forEach((raw, pi) => {
    const text = flat(raw);

    // 1. phrases trop longues
    for (const s of splitSentences(text)) {
      const w = countWordsIn(text.slice(s.from, s.to));
      if (w > maxWords) add('long', pi, s.from, s.to, `${w} mots (au-delà de ${maxWords}).`);
      const st = STARTER_RE.exec(text.slice(s.from, s.to));
      if (st) {
        const key = strip(st[1]).replace(/\s+/g, ' ');
        const l = starters.get(key) ?? [];
        l.push({ para: pi, from: s.from, to: s.from + st[1].length });
        starters.set(key, l);
      }
    }

    // 2. répétitions + 3. adverbes (un seul parcours des mots)
    const adverbs: { from: number; to: number }[] = [];
    let paraWords = 0;
    for (const m of text.matchAll(WORD_RE)) {
      paraWords++;
      const idx = wordIdx++;
      const w = m[0];
      const from = m.index ?? 0;
      if (isAdverbMent(w)) adverbs.push({ from, to: from + w.length });
      // mots composés / élidés : on regarde chaque partie
      let off = 0;
      for (const part of w.split(/['\-‐]/)) {
        const pStart = from + w.indexOf(part, off);
        off = w.indexOf(part, off) + part.length;
        if (part.length < 4 || /\d/.test(part) || isStopWord(part)) continue;
        const key = stem(part);
        const prev = last.get(key);
        if (prev !== undefined && idx - prev <= gap) {
          add('repeat', pi, pStart, pStart + part.length, `« ${part.toLowerCase()} » déjà employé ${idx - prev} mot${idx - prev > 1 ? 's' : ''} plus tôt.`);
        }
        last.set(key, idx);
      }
    }
    if (adverbs.length >= advMin) {
      for (const a of adverbs) add('adverb', pi, a.from, a.to, `${adverbs.length} adverbes en -ment dans ce paragraphe.`);
    }

    // 4. tics de copie
    for (const t of TICS) {
      t.re.lastIndex = 0;
      for (const m of text.matchAll(t.re)) add('tic', pi, m.index ?? 0, (m.index ?? 0) + m[0].length, t.label);
    }

    // 5. connecteurs absents
    if (paraWords >= connMin && !CONN_RE.test(text)) {
      const a = text.search(/\S/);
      add('connector', pi, Math.max(0, a), text.trimEnd().length, `${paraWords} mots sans connecteur logique.`);
    }

    // 6. « je pense que »
    if (firstPerson) {
      for (const m of text.matchAll(JE_RE)) add('jepense', pi, m.index ?? 0, (m.index ?? 0) + m[0].length, 'Évitez l’opinion personnelle : argumentez.');
    }
  });

  // attaques de phrase répétées
  for (const [key, list] of starters) {
    if (list.length < starterMin) continue;
    for (const s of list) add('tic', s.para, s.from, s.to, `« ${cap(key)} » en tête de phrase : ${list.length} fois dans l’écrit.`);
  }

  // ordre du document (stable, par catégorie)
  return out.sort((a, b) => a.para - b.para || a.from - b.from);
}

export function countByCategory(findings: StyleFinding[]): Record<StyleCategory, number> {
  const c: Record<StyleCategory, number> = { long: 0, repeat: 0, adverb: 0, tic: 0, connector: 0, jepense: 0 };
  for (const f of findings) c[f.cat]++;
  return c;
}
