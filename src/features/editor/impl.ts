// Implémentation de l'API publique du module Écrire (voir api.ts, figé).
// Aucune dépendance au moteur d'édition : génération et contrôle des .docx par JSZip.
import type { Draft } from '../../lib/types';
import { host } from '../../lib/platform';
import { uid, useStore } from '../../lib/store';
import type { CreateDraftOptions } from './api';
import { countDocxWords, ensureA4SectPr, htmlToDocx } from './docx';
import { templateByKey, templateInfo, type TemplateKey } from './templates';
import { hasPrivateNotes, isExportOf } from './privateNotes';
import { newDraftFontName } from './view';

export const DRAFT_FILE = 'document.docx';
/** G3 : copie de la version précédente dans la bibliothèque. */
export const PREV_FILE = 'document.prev.docx';

export async function createDraftImpl(opts: CreateDraftOptions): Promise<Draft> {
  const id = uid();
  const title = (opts.title ?? '').trim() || (opts.template ? templateInfo(opts.template).defaultTitle : 'Sans titre');
  let data: ArrayBuffer;
  if (opts.docx) {
    // G1 : format de page A4 si le sectPr est absent ou vide (sinon octets d'origine conservés).
    data = (await ensureA4SectPr(opts.docx)).data;
  } else {
    // Modèle « Vide » et écrits créés sans modèle (Markdown importé…) : police choisie pour les
    // nouveaux écrits (Literata par défaut), 12 pt, interligne 1,5. Les autres modèles gardent Times.
    const plain = !opts.template || opts.template === 'vide';
    const layout = plain ? { font: newDraftFontName() } : {};
    data = await htmlToDocx(opts.html ?? templateInfo(opts.template ?? 'vide').html, title, layout);
  }
  let wordCount = 0;
  try {
    wordCount = await countDocxWords(data);
  } catch {
    /* comptage indicatif */
  }
  await host.storeFile(id, DRAFT_FILE, data);
  const now = Date.now();
  const draft: Draft = {
    id,
    title,
    fileName: DRAFT_FILE,
    externalPath: opts.externalPath ?? null,
    wordCount,
    template: opts.template ?? (opts.docx || opts.html != null ? null : 'vide'),
    createdAt: now,
    updatedAt: now,
  };
  const s = useStore.getState();
  s.insert('drafts', draft);
  const ws = s.settings.activeWorkspaceId;
  if (ws && s.workspaces.some((w) => w.id === ws)) s.addToWorkspace(ws, null, 'draft', id);
  return draft;
}

/** Nouvel écrit depuis un modèle (y compris « Présentation universitaire », hors Draft['template']). */
export async function createFromTemplateImpl(key: TemplateKey): Promise<Draft> {
  const t = templateByKey(key);
  if (!t.layout) return createDraftImpl({ title: t.defaultTitle, template: t.id });
  const data = await htmlToDocx(t.html, t.defaultTitle, t.layout);
  const d = await createDraftImpl({ title: t.defaultTitle, docx: data });
  useStore.getState().patch('drafts', d.id, { template: t.id });
  return useStore.getState().drafts.find((x) => x.id === d.id) ?? d;
}

export async function openDocxFromDiskImpl(): Promise<Draft | null> {
  const f = await host.openDocx();
  if (!f) return null;
  const s = useStore.getState();
  try {
    // Fichier déjà ouvert comme écrit : on réutilise cet écrit plutôt que d'en créer un second
    // (deux copies de travail réécrivant le même fichier finiraient par s'écraser l'une l'autre).
    const existing = f.path ? s.drafts.find((d) => d.externalPath === f.path) : undefined;
    if (existing) {
      if (getExternalDirty(existing.id)) {
        s.toast('Ce fichier est déjà ouvert : sa copie de travail contient des modifications pas encore écrites dans le fichier d’origine', 'info');
        return existing;
      }
      // Copie de travail à jour : on la remplace par la version du disque (modifiée ailleurs, p. ex. dans Word),
      // après avoir gardé la précédente (G3).
      const fixed = (await ensureA4SectPr(f.data)).data;
      // Notes privées : le fichier externe n'en a jamais. S'il est exactement ce que Marginalia y a
      // écrit, la copie de la bibliothèque (qui garde les notes) reste la copie de travail.
      const lib = await host.readFile(existing.id, existing.fileName).catch(() => null);
      if (lib && (await hasPrivateNotes(lib).catch(() => false))) {
        if (await isExportOf(lib, fixed)) return existing;
        s.toast('Ce fichier a été modifié hors de Marginalia : ses notes privées ne sont plus dans la copie de travail (elles restent dans la version précédente).', 'info');
      }
      try {
        await host.storeFile(existing.id, PREV_FILE, await host.readFile(existing.id, existing.fileName));
      } catch {
        /* pas de copie précédente */
      }
      await host.storeFile(existing.id, existing.fileName, fixed);
      let wordCount = existing.wordCount;
      try {
        wordCount = await countDocxWords(fixed);
      } catch {
        /* indicatif */
      }
      s.patch('drafts', existing.id, { wordCount });
      return useStore.getState().drafts.find((d) => d.id === existing.id) ?? existing;
    }
    const title = f.name.replace(/\.docx$/i, '').trim() || 'Sans titre';
    return await createDraftImpl({ title, docx: f.data, externalPath: f.path });
  } catch (e) {
    console.error(e);
    s.toast(`Impossible d’ouvrir « ${f.name} » : ce n’est pas un document Word valide`, 'error');
    return null;
  }
}

// ── Indicateur « modifications non écrites dans le fichier d'origine » (par écrit) ──
const extKey = (id: string) => `marginalia.ed.externalDirty.${id}`;
export function getExternalDirty(id: string): boolean {
  try {
    return localStorage.getItem(extKey(id)) === '1';
  } catch {
    return false;
  }
}
export function setExternalDirty(id: string, dirty: boolean): void {
  try {
    if (dirty) localStorage.setItem(extKey(id), '1');
    else localStorage.removeItem(extKey(id));
  } catch {
    /* stockage indisponible */
  }
}
