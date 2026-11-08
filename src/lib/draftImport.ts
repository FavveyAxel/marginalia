// Fichiers qui sont des écrits (éditables) et non des livres : Word, OpenDocument (.odt) et Markdown.
import type { CreateDraftOptions } from '../features/editor/api';
import { extOf } from './platform';

export const DRAFT_EXTENSIONS = ['docx', 'odt', 'md', 'markdown'];
export const isDraftFile = (name: string) => DRAFT_EXTENSIONS.includes(extOf(name));

export async function draftOptionsFromFile(name: string, data: ArrayBuffer): Promise<CreateDraftOptions> {
  const base = name.replace(/\.(docx|odt|md|markdown)$/i, '').trim() || 'Sans titre';
  if (extOf(name) === 'docx') return { title: base, docx: data };
  if (extOf(name) === 'odt') {
    const { odtToHtml } = await import('./odtImport');
    const r = await odtToHtml(data);
    return { title: r.title || base, html: r.html };
  }
  const text = new TextDecoder('utf-8').decode(data).replace(/^﻿/, '');
  const [{ marked }, { default: DOMPurify }] = await Promise.all([import('marked'), import('dompurify')]);
  const html = DOMPurify.sanitize(await marked.parse(text, { gfm: true }));
  const h1 = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return { title: h1 || base, html };
}

/** Crée un écrit à partir d'un fichier Word, OpenDocument ou Markdown. */
export async function createDraftFromFile(name: string, data: ArrayBuffer) {
  const { createDraft } = await import('../features/editor/api');
  return createDraft(await draftOptionsFromFile(name, data));
}
