// Cœur du correcteur (sans DOM) : découpage en mots et vérification d'un mot avec nspell.
// Utilisé par le Web Worker ; testable hors navigateur.

export interface Speller {
  correct(word: string): boolean;
  suggest(word: string): string[];
  add(word: string): unknown;
}

export interface Token {
  word: string;
  start: number;
  end: number;
}

/** Fautes : position dans le texte du paragraphe (UTF-16) et mot fautif. */
export interface Miss {
  start: number;
  end: number;
  word: string;
}

const APOS = /['’ʼ]/;
// URL, adresses électroniques, chemins : ignorés en bloc.
const SKIP_RE = /(?:https?:\/\/|www\.|file:\/\/)[^\s<>"«»]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/giu;
// Mot : lettres (avec diacritiques) et chiffres, reliés par apostrophes, traits d'union ou points abréviatifs internes.
const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:[-‐‑'’ʼ][\p{L}\p{M}\p{N}]+)*/gu;
// Élisions du français (l’, d’, qu’, jusqu’…).
const ELISION_RE = /^(?:[cdjlmnst]|qu|jusqu|lorsqu|puisqu|quoiqu|presqu|quelqu)['’ʼ]/iu;

// Petits mots qui peuvent relier des mots capitalisés d'un même nom (Call of Duty, Gare de Lyon).
const CONNECTORS_FOREIGN = new Set(['of', 'the', 'and', 'von', 'van', 'der', 'den', 'di', 'da', 'del', 'el', 'al', 'for', 'in', 'on', 'to', 'at', '&']);
// Abréviations qui ne terminent pas une phrase (« M. Dupont »).
const ABBREV = new Set(['m', 'mm', 'mme', 'mmes', 'mlle', 'mlles', 'dr', 'pr', 'me', 'st', 'ste', 'mgr', 'cf', 'vs', 'etc', 'mr', 'mrs', 'ms', 'jr', 'sr', 'prof', 'gal', 'col', 'cdt', 'lt', 'bd', 'av']);
const OPENERS = /[\s«»“”"„()\[\]‘'’\-–—‐‑]/u;

/** Découpe `text` en mots à vérifier (URL et adresses exclues). */
export function tokenize(text: string): Token[] {
  const skips: [number, number][] = [];
  for (const m of text.matchAll(SKIP_RE)) skips.push([m.index!, m.index! + m[0].length]);
  const out: Token[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (skips.some(([a, b]) => start < b && end > a)) continue;
    out.push({ word: m[0], start, end });
  }
  return out;
}

/** Mots qu'on ne vérifie pas : chiffres, MAJUSCULES (sigles, chiffres romains), lettres isolées. */
export function skipWord(w: string): boolean {
  if (w.length < 2) return true;
  if (/\p{N}/u.test(w)) return true;
  const letters = w.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 2 && letters === letters.toLocaleUpperCase('fr') && letters !== letters.toLocaleLowerCase('fr')) return true;
  return false;
}

const isCap = (w: string) => w[0] !== w[0].toLocaleLowerCase('fr') && w[0] === w[0].toLocaleUpperCase('fr');
/** Partie du mot après une élision éventuelle (« l’Amérique » → « Amérique »). */
const baseOf = (w: string) => {
  const el = w.match(ELISION_RE);
  return el ? w.slice(el[0].length) : w;
};

/** `pos` est-il en début de phrase (début de paragraphe, après . ! ? … + espace, guillemet ouvrant ou tiret de dialogue) ? */
export function isSentenceStart(text: string, pos: number): boolean {
  let i = pos - 1;
  let sawGap = false;
  while (i >= 0 && OPENERS.test(text[i])) {
    if (/[\s«»“”"„)\]]/u.test(text[i])) sawGap = true;
    i--;
  }
  if (i < 0) return true;
  if (!/[.!?…]/.test(text[i])) return false;
  if (!sawGap) return false;
  if (text[i] === '.') {
    // abréviation ou initiale : « M. Dupont », « J. K. Rowling »
    let j = i - 1;
    while (j >= 0 && /\p{L}/u.test(text[j])) j--;
    const prev = text.slice(j + 1, i);
    if (prev.length === 1 && prev !== prev.toLocaleLowerCase('fr') && (j < 0 || /[\s«“"(]/u.test(text[j]))) return false;
    if (prev.length > 0 && (j < 0 || /\s/u.test(text[j])) && ABBREV.has(prev.toLocaleLowerCase('fr'))) return false;
  }
  return true;
}

export interface CheckOptions {
  /** Ignorer les noms propres (mots capitalisés hors début de phrase, séquences capitalisées). */
  ignoreProper?: boolean;
}

const normApos = (w: string) => w.replace(/[’ʼ]/g, '’');

export class Checker {
  private cache = new Map<string, boolean>();
  /** Formes capitalisées vues en milieu de phrase (tous paragraphes vérifiés) : noms propres probables. */
  private seenMid = new Set<string>();
  /** Incrémenté quand `seenMid` s'enrichit : les résultats en cache peuvent alors être périmés. */
  epoch = 0;
  constructor(private sp: Speller) {}

  private learn(forms: Iterable<string>): void {
    for (const f of forms)
      if (!this.seenMid.has(f)) {
        this.seenMid.add(f);
        this.epoch++;
      }
  }

  add(word: string): void {
    this.sp.add(word);
    this.cache.clear();
  }

  /** Le mot (sans élision ni trait d'union) est-il connu ? */
  private known(w: string): boolean {
    if (w.length < 2 || skipWord(w)) return true;
    const hit = this.cache.get(w);
    if (hit !== undefined) return hit;
    let ok = this.sp.correct(w);
    if (!ok && APOS.test(w)) {
      const a = normApos(w);
      ok = this.sp.correct(a) || this.sp.correct(a.replace(/’/g, "'"));
    }
    // Majuscule de début de phrase : « Philosophie » est juste si « philosophie » l'est.
    if (!ok && w[0] !== w[0].toLocaleLowerCase('fr')) ok = this.sp.correct(w[0].toLocaleLowerCase('fr') + w.slice(1));
    this.cache.set(w, ok);
    return ok;
  }

  /** Fautes d'un mot du texte (décalages relatifs au début du mot). */
  checkWord(word: string): Miss[] {
    if (skipWord(word) || this.known(word)) return [];
    // Élision : l’homne → « homne »
    const el = word.match(ELISION_RE);
    if (el) {
      const rest = word.slice(el[0].length);
      return this.checkWord(rest).map((m) => ({ ...m, start: m.start + el[0].length, end: m.end + el[0].length }));
    }
    // Trait d'union : dit-il, va-t-en, Merleau-Ponty… chaque partie est vérifiée.
    if (/[-‐‑]/.test(word)) {
      const out: Miss[] = [];
      let off = 0;
      for (const part of word.split(/[-‐‑]/)) {
        if (part.length > 1 && !this.known(part)) out.push(...this.checkWord(part).map((m) => ({ ...m, start: m.start + off, end: m.end + off })));
        off += part.length + 1;
      }
      return out;
    }
    // Apostrophe interne non élidée (aujourd’hui est connu ; « prud’homme »…) : mot entier.
    return [{ start: 0, end: word.length, word }];
  }

  /** Fautes d'un paragraphe. */
  checkText(text: string, opts: CheckOptions = {}): Miss[] {
    const toks = tokenize(text);
    const ignore = opts.ignoreProper ? this.properNouns(text, toks) : null;
    const out: Miss[] = [];
    toks.forEach((t, i) => {
      if (ignore?.[i]) return;
      for (const m of this.checkWord(t.word)) out.push({ start: t.start + m.start, end: t.start + m.end, word: m.word });
    });
    return out;
  }

  /** Vérifie plusieurs paragraphes : les noms propres vus dans l'un servent aux débuts de phrase des autres. */
  checkMany(texts: string[], opts: CheckOptions = {}): Miss[][] {
    for (const t of texts) this.collect(t, tokenize(t));
    return texts.map((t) => this.checkText(t, opts));
  }

  private collect(text: string, toks: Token[]): void {
    const forms: string[] = [];
    for (const t of toks) {
      const b = baseOf(t.word);
      if (b.length > 1 && isCap(b) && !skipWord(b) && !isSentenceStart(text, t.start)) forms.push(b);
    }
    this.learn(forms);
  }

  /** Pour chaque jeton : est-ce (une partie d')un nom propre à ne pas vérifier ? */
  private properNouns(text: string, toks: Token[]): boolean[] {
    this.collect(text, toks);
    const n = toks.length;
    const cap = toks.map((t) => isCap(baseOf(t.word)));
    const start = toks.map((t, i) => cap[i] && isSentenceStart(text, t.start));
    // jetons voisins séparés par de simples espaces
    const adj = (i: number) => i + 1 < n && /^[ \u00a0\u202f]+$/.test(text.slice(toks[i].end, toks[i + 1].start));
    const lower = (i: number) => toks[i].word.toLocaleLowerCase('fr');
    const out = new Array<boolean>(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (cap[i] && !start[i]) {
        out[i] = true;
        continue;
      }
      // mot de liaison entre deux mots capitalisés : « Call of Duty »
      if (!cap[i] && i > 0 && cap[i - 1] && adj(i - 1) && adj(i) && cap[i + 1] && CONNECTORS_FOREIGN.has(lower(i))) {
        out[i] = true;
        continue;
      }
      if (!cap[i] || !start[i]) continue;
      // début de phrase : séquence capitalisée (« Captain America »), ou liaison étrangère (« Call of Duty »)
      if (adj(i) && cap[i + 1] && !start[i + 1]) out[i] = true;
      else if (adj(i) && i + 2 < n && adj(i + 1) && cap[i + 2] && !start[i + 2] && (CONNECTORS_FOREIGN.has(lower(i + 1)))) out[i] = true;
      else if (this.seenMid.has(baseOf(toks[i].word))) out[i] = true;
    }
    return out;
  }

  suggest(word: string, max = 5): string[] {
    let list = this.sp.suggest(word);
    if (!list.length && APOS.test(word)) list = this.sp.suggest(normApos(word).replace(/’/g, "'"));
    // apostrophe typographique, comme le texte
    const typo = /’/.test(word) || !/'/.test(word);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s0 of list) {
      const s = typo ? s0.replace(/'/g, '’') : s0;
      if (s === word || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= max) break;
    }
    return out;
  }
}
