// API publique du module Écrire (signatures FIGÉES — implémentation : agent Éditeur).
import type { Draft } from '../../lib/types';

export interface CreateDraftOptions {
  title: string;
  template?: Draft['template'];
  /**
   * Contenu initial en HTML simple (h1-h3, p, blockquote, ul/ol, em/strong) ;
   * les éléments <span data-footnote="texte de la note"></span> deviennent des notes de bas de page.
   */
  html?: string;
  /** Ou un .docx existant. */
  docx?: ArrayBuffer;
  externalPath?: string | null;
}

/** Crée un écrit (.docx stocké dans la bibliothèque) et le renvoie (sans naviguer). */
export async function createDraft(opts: CreateDraftOptions): Promise<Draft> {
  const m = await import('./impl');
  return m.createDraftImpl(opts);
}

/** Ouvre un .docx depuis le disque comme écrit (Enregistrer réécrira le fichier d'origine). */
export async function openDocxFromDisk(): Promise<Draft | null> {
  const m = await import('./impl');
  return m.openDocxFromDiskImpl();
}
