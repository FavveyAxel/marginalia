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

const normApos = (w: string) => w.replace(/[’ʼ]/g, '’');

export class Checker {
  private cache = new Map<string, boolean>();
  constructor(private sp: Speller) {}

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
  checkText(text: string): Miss[] {
    const out: Miss[] = [];
    for (const t of tokenize(text)) for (const m of this.checkWord(t.word)) out.push({ start: t.start + m.start, end: t.start + m.end, word: m.word });
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
