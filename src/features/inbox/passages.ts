// ─────────────────────────────────────────────────────────────
// Texte collé contenant plusieurs passages : notes d'un livre copiées depuis l'app Livres
// (iPhone, iPad), Google Play Livres, Kindle, ou une suite de citations.
//
// Le texte est découpé en blocs (lignes vides) ; on retire les mentions ajoutées par les apps
// (« Extrait de », « Ce document est peut-être protégé… », dates, numéros de page, en-têtes) et
// les guillemets autour des passages. Un bloc d'au moins MIN_WORDS mots est un passage candidat ;
// les blocs qui suivent un passage et ne sont pas eux-mêmes retrouvés dans un livre sont la note
// de l'utilisateur sur ce passage. Fonctions pures : la recherche est faite par l'appelant.
// ─────────────────────────────────────────────────────────────

/** Nombre de mots minimal d'un passage candidat (en dessous : titre, date, note courte…). */
export const MIN_WORDS = 6;

export interface Block {
  text: string;
  /** Assez long pour être un passage cherché dans les livres. */
  candidate: boolean;
  /** Entre guillemets dans le texte collé : une citation, jamais une note. */
  quoted: boolean;
}

const MONTHS = '(janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-zéû.]*';
const BOILERPLATE: RegExp[] = [
  /^(extrait de|extrait du livre|excerpt from|extract from)\b/i,
  /peut[- ]être protégé|droits? d['’]auteur|may be (protected|copyright)|copyright protected/i,
  /^(apple books|livres apple|ibooks|google play (livres|books)|kindle)\.?$/i,
  /^(mes notes|notes de|notes from|notes for|my notes|surlignages?|highlights?)\b.{0,80}$/i,
  /^(page|p\.|location|emplacement|loc\.)\s*[\divxlc]+(\s*[-–]\s*[\divxlc]+)?\.?$/i,
  /^[\divxlc]+\.?$/i,
  new RegExp(`^(le |the )?\\d{1,2}(er)? ${MONTHS} \\d{4}`, 'i'),
  new RegExp(`^${MONTHS} \\d{1,2},? \\d{4}`, 'i'),
  /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/,
  /^(ajouté|added|surligné|highlighted|note ajoutée)\b/i,
];

/** Ligne qui ouvre la référence ajoutée par l'app (suivie du titre et de l'auteur). */
const SOURCE_LINE = /^(extrait de|extrait du livre|excerpt from|extract from)\b|peut[- ]être protégé|may be (protected|copyright)/i;

/** Ligne qui introduit la note de l'utilisateur. */
const NOTE_LINE = /^(note|ma note|mes notes|commentaire|comment)\s*:\s*/i;

const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Ligne ajoutée par une app de lecture (mention, date, page) : pas un passage, pas une note. */
export function isBoilerplate(line: string): boolean {
  const l = line.trim();
  return !l || BOILERPLATE.some((r) => r.test(l));
}

/** Retire les guillemets qui encadrent un passage cité (“…”, « … », "…"). */
export function unquote(s: string): string {
  let t = s.trim();
  for (let i = 0; i < 2; i++) {
    const m = /^[“"«‘'„]\s*([\s\S]*?)\s*[”"»’'“]\.?$/.exec(t);
    if (!m) break;
    t = m[1].trim();
  }
  return t;
}

/** Blocs utiles du texte collé, dans l'ordre. */
export function splitBlocks(text: string): Block[] {
  const out: Block[] = [];
  const push = (lines: string[]) => {
    if (!lines.length) return;
    const joined = lines.join(' ').replace(/\s+/g, ' ');
    const t = unquote(joined);
    if (t) out.push({ text: t, candidate: words(t) >= MIN_WORDS, quoted: t !== joined.trim() });
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split(/\n\s*\n+/)) {
    const all = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    // Bloc de référence ajouté par l'app (« Extrait de » / titre / auteur / droits) : ignoré en entier.
    if (all.some((l) => SOURCE_LINE.test(l))) continue;
    const lines = all.filter((l) => !isBoilerplate(l));
    // « Note : … » dans le même bloc que le passage (Play Livres, Kindle) : bloc à part.
    const k = lines.findIndex((l) => NOTE_LINE.test(l));
    if (k > 0) {
      push(lines.slice(0, k));
      push([lines[k].replace(NOTE_LINE, ''), ...lines.slice(k + 1)]);
    } else push(lines);
  }
  return out;
}

/** Plusieurs passages à chercher séparément (sinon : traitement d'un texte unique). */
export const hasSeveralPassages = (blocks: Block[]) => blocks.filter((b) => b.candidate).length >= 2;

export interface Found<M> {
  match: M;
  note: string;
}

/**
 * Associe les blocs aux correspondances trouvées : `matchOf(i)` donne la correspondance sûre du
 * bloc i (ou null). Renvoie les passages retrouvés (avec la note qui les suit) et le texte des
 * passages candidats non retrouvés.
 */
export function pairNotes<M>(blocks: Block[], matchOf: (i: number) => M | null): { found: Found<M>[]; rest: string[] } {
  const found: Found<M>[] = [];
  const rest: string[] = [];
  let last: Found<M> | null = null;
  blocks.forEach((b, i) => {
    const m = b.candidate ? matchOf(i) : null;
    if (m) {
      last = { match: m, note: '' };
      found.push(last);
      return;
    }
    if (b.candidate && b.quoted) {
      // Citation non retrouvée (livre absent de la bibliothèque…) : à traiter à part.
      rest.push(b.text);
      last = null;
      return;
    }
    if (last) {
      // Ce qui suit un passage retrouvé (jusqu'au prochain) : la note de l'utilisateur.
      last.note = last.note ? `${last.note}\n\n${b.text}` : b.text;
      return;
    }
    if (b.candidate) rest.push(b.text);
  });
  return { found, rest };
}
