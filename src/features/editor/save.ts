// Enregistrement protégé d'un écrit.
//  G2 : on n'écrase jamais si le .docx produit contient nettement moins de mots que
//       l'éditeur (export vide ou tronqué) ; à l'ouverture, on bloque l'enregistrement
//       si l'éditeur montre nettement moins de mots que le fichier (chargement incomplet).
//  G3 : copie de sauvegarde avant d'écraser (bibliothèque : document.prev.docx ;
//       fichier externe : .bak fait par l'hôte Electron dans writeExternal).
import { host } from '../../lib/platform';
import type { Draft } from '../../lib/types';
import { useStore } from '../../lib/store';
import { htmlToDocx, parseDocx, type DocModel } from './docx';
import type { DocEngine } from './engine';
import { DRAFT_FILE, PREV_FILE } from './impl';

/** Écart toléré entre deux comptages (2 %, au moins 2 mots) — recommandation de la recherche. */
export function tolerance(words: number): number {
  return Math.max(2, Math.ceil(words * 0.02));
}

/** true si `after` a perdu du texte par rapport à `before`. */
export function lostText(before: number, after: number): boolean {
  return before - after > tolerance(before);
}

export interface GuardedExport {
  ok: boolean;
  data: ArrayBuffer;
  model: DocModel | null;
  editorWords: number;
  exportedWords: number;
  reason?: string;
}

/** Hooks de test (développement uniquement) : simuler un export vide. */
interface TestHooks {
  corruptExport?: boolean;
  skipG1?: boolean;
}
export function testHooks(): TestHooks {
  if (!import.meta.env.DEV) return {};
  return ((window as unknown as { __edTest?: TestHooks }).__edTest ?? {}) as TestHooks;
}

/** Exporte et vérifie (G2) ; ne lève pas d'exception pour un export « vide », il renvoie ok=false. */
export async function guardedExport(engine: DocEngine): Promise<GuardedExport> {
  const editorWords = engine.wordCount();
  let data = await engine.exportDocx();
  if (testHooks().corruptExport) data = await htmlToDocx('<p></p>', 'vide');
  let model: DocModel | null = null;
  try {
    model = await parseDocx(data);
  } catch (e) {
    return { ok: false, data, model: null, editorWords, exportedWords: 0, reason: 'Le fichier produit est illisible.' };
  }
  const exportedWords = model.bodyWords;
  // Les zones de texte comptent ici (le moteur peut les afficher dans le flux) : on ne bloque
  // que si le texte manque vraiment dans le fichier produit.
  if (lostText(editorWords, exportedWords + model.extraWords)) {
    return {
      ok: false,
      data,
      model,
      editorWords,
      exportedWords,
      reason: `Le fichier produit ne contenait que ${words(exportedWords)} au lieu de ${fmtInt(editorWords)}.`,
    };
  }
  return { ok: true, data, model, editorWords, exportedWords };
}

export const fmtInt = (n: number) => n.toLocaleString('fr-FR');
/** « 0 mot », « 1 mot », « 2 mots » (en français, 0 et 1 au singulier). */
export const words = (n: number) => `${fmtInt(n)} mot${n >= 2 ? 's' : ''}`;

/** État de session : la copie G3 n'est faite qu'une fois par session d'édition. */
export interface SaveSession {
  prevSaved: boolean;
}

/** Écrit l'export (déjà vérifié) dans la bibliothèque, après copie de la version précédente. */
export async function writeLibrary(draft: Draft, data: ArrayBuffer, session: SaveSession, words: number): Promise<void> {
  if (!session.prevSaved) {
    try {
      const old = await host.readFile(draft.id, draft.fileName || DRAFT_FILE);
      await host.storeFile(draft.id, PREV_FILE, old);
    } catch (e) {
      console.warn('copie de sauvegarde impossible', e);
    }
    session.prevSaved = true;
  }
  await host.storeFile(draft.id, draft.fileName || DRAFT_FILE, data);
  useStore.getState().patch('drafts', draft.id, { wordCount: words });
}

/** Réécrit le fichier d'origine (Electron : .bak préalable côté hôte). */
export async function writeExternalFile(path: string, data: ArrayBuffer): Promise<void> {
  await host.writeExternal(path, data);
}

/** Export de secours : le texte de l'éditeur, tel quel, en .txt. */
export async function rescueExport(engine: DocEngine, title: string): Promise<string | null> {
  const text = engine.plainText();
  const bytes = new TextEncoder().encode(text.endsWith('\n') ? text : text + '\n');
  return host.saveBinary(`${title} (secours).txt`, bytes.buffer as ArrayBuffer, 'txt');
}

export { getExternalDirty, setExternalDirty } from './impl';
