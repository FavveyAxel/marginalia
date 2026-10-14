// Plan déplaçable : sections (titre + contenu jusqu'au titre suivant de même niveau ou supérieur)
// déplacées en une seule transaction ProseMirror (une seule étape d'annulation). Les appels de
// notes de bas de page voyagent avec leur section ; la numérotation (affichage et Word) suit
// l'ordre du document. Appelé seulement par engine.ts.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export interface Section {
  /** Position du titre (début de la section). */
  from: number;
  /** Fin de la section (exclue). */
  to: number;
  level: 1 | 2 | 3;
  text: string;
}

/** Niveau de titre (1 à 3) d'un paragraphe, 0 sinon. */
export type LevelOf = (node: Any) => 0 | 1 | 2 | 3;

/** Sections des titres de premier niveau d'imbrication (hors tableaux, cadres…). */
export function sections(doc: Any, levelOf: LevelOf): Section[] {
  const heads: { pos: number; level: 1 | 2 | 3; text: string }[] = [];
  doc.forEach((n: Any, pos: number) => {
    if (n.type.name !== 'paragraph') return;
    const l = levelOf(n);
    const text = n.textContent.trim();
    if (l && text) heads.push({ pos, level: l, text });
  });
  const end = doc.content.size;
  return heads.map((h, i) => {
    let to = end;
    for (let j = i + 1; j < heads.length; j++)
      if (heads[j].level <= h.level) {
        to = heads[j].pos;
        break;
      }
    return { from: h.pos, to, level: h.level, text: h.text };
  });
}

/** Section dont le titre commence en `pos`, ou la plus petite section contenant `pos`. */
export function sectionAt(list: Section[], pos: number, exactHead = false): Section | null {
  if (exactHead) return list.find((s) => s.from === pos) ?? null;
  let best: Section | null = null;
  for (const s of list) if (s.from <= pos && pos < s.to && (!best || s.to - s.from < best.to - best.from)) best = s;
  return best;
}

/** Clé du méta « closeHistory » de prosemirror-history (PluginKey("closeHistory")). */
const CLOSE_HISTORY = 'closeHistory$';

/**
 * Déplace la section qui commence en `from` à la position `target` (début d'un bloc de premier
 * niveau, ou fin du document). Renvoie la nouvelle position du titre, ou null (rien à faire).
 */
export function moveSection(ed: Any, levelOf: LevelOf, from: number, target: number): number | null {
  const { state } = ed;
  const src = sectionAt(sections(state.doc, levelOf), from, true);
  if (!src) return null;
  if (target >= src.from && target <= src.to) return null;
  // la cible doit être une frontière de bloc de premier niveau
  const $t = state.doc.resolve(Math.max(0, Math.min(target, state.doc.content.size)));
  if ($t.depth !== 0) return null;
  const content = state.doc.slice(src.from, src.to).content;
  const tr = state.tr;
  tr.delete(src.from, src.to);
  const at = tr.mapping.map(target, -1);
  tr.insert(at, content);
  tr.setMeta(CLOSE_HISTORY, true);
  tr.scrollIntoView();
  ed.view.dispatch(tr);
  // la saisie qui suit ne doit pas fusionner avec le déplacement dans l'historique
  ed.view.dispatch(ed.state.tr.setMeta(CLOSE_HISTORY, true));
  try {
    ed.commands.setTextSelection({ from: at + 2, to: at + 2 });
  } catch {
    /* position hors texte */
  }
  return at;
}

/**
 * Monte (-1) ou descend (+1) la section : échange avec la section sœur précédente / suivante
 * (même niveau, même parent). Renvoie la nouvelle position du titre, ou null.
 */
export function stepSection(ed: Any, levelOf: LevelOf, pos: number, dir: -1 | 1, exactHead = false): number | null {
  const list = sections(ed.state.doc, levelOf);
  const cur = sectionAt(list, pos, exactHead);
  if (!cur) return null;
  if (dir < 0) {
    // sœur précédente : dernier titre de niveau ≤ avant la section ; doit être de même niveau
    const prev = [...list].reverse().find((s) => s.from < cur.from && s.level <= cur.level);
    if (!prev || prev.level !== cur.level) return null;
    return moveSection(ed, levelOf, cur.from, prev.from);
  }
  const next = list.find((s) => s.from === cur.to);
  if (!next || next.level !== cur.level) return null;
  return moveSection(ed, levelOf, cur.from, next.to);
}
