// ─────────────────────────────────────────────────────────────
// Boîte de dépôt : un dossier synchronisé avec le téléphone (iCloud Drive › Marginalia,
// OneDrive…). Marginalia le surveille ; chaque fichier déposé devient un élément de la
// « Boîte de réception ».
//  - Livres (PDF, EPUB) : ajoutés seuls à la bibliothèque.
//  - Texte dont le passage est retrouvé sans ambiguïté dans un livre : extrait ajouté seul.
//  - Le reste (texte non retrouvé, photo de page, page web, lien, document Word) attend une
//    décision dans la boîte.
// Un fichier traité est rangé dans le sous-dossier « Traités » (jamais supprimé). Le dossier
// fait foi : rien de la boîte n'est écrit dans la base.
// ─────────────────────────────────────────────────────────────
import { useEffect } from 'react';
import { create } from 'zustand';
import { useStore, uid } from '../../lib/store';
import { extOf, host, IMAGE_EXTENSIONS, type InboxFile, type InboxInfo, type PickedFile } from '../../lib/platform';
import type { PassageMatch } from './match';
import { createDraftFromFile } from '../../lib/draftImport';
import { displayableBlob, ORIENT } from '../reader/image/decode';
import type { PhotoSource } from '../library/photoDoc';
import type { Book } from '../../lib/types';
import type { PaperGuess } from './paperGuess';

export type InboxKind = 'book' | 'text' | 'image' | 'web' | 'link' | 'draft' | 'other';

export interface InboxItem {
  name: string;
  size: number;
  mtime: number;
  kind: InboxKind;
  /** Encore dans le nuage (iCloud télécharge le fichier). */
  pending?: boolean;
  /** Reçu par le Wi-Fi (effacé une fois traité) ; absent : dossier synchronisé. */
  source?: 'wifi';
  status: 'waiting' | 'working' | 'ready' | 'error';
  /** Étape en cours (« Lecture du texte de la photo… »). */
  step?: string;
  /** 0..1 pendant la reconnaissance du texte d'une photo. */
  progress?: number;
  /** Texte reçu (ou reconnu sur la photo), modifiable avant la recherche. */
  text?: string;
  /** Texte tel qu'il a été cherché (pour savoir s'il a changé depuis). */
  searchedText?: string;
  /** Livre auquel la dernière recherche était limitée. */
  searchedIn?: string | null;
  matches?: PassageMatch[];
  /** Titre (page web), adresse (lien). */
  title?: string;
  url?: string;
  /** Aperçu d'une photo (blob: URL). */
  preview?: string;
  error?: string;
  /** Photo d'une page de livre papier : livre et page devinés en local, à confirmer. */
  paper?: PaperGuess;
}

interface InboxState {
  info: InboxInfo | null;
  items: InboxItem[];
  /** Dernière lecture du dossier (ms) ; null tant qu'aucune. */
  scannedAt: number | null;
  /** Fenêtre « Recevoir depuis le téléphone » (réception par le Wi-Fi) ouverte. */
  wifiOpen: boolean;
  /** Ce qu'est devenu chaque élément (par nom de fichier) : affiché dans la fenêtre de réception et renvoyé au téléphone. */
  outcomes: Record<string, Outcome>;
  /**
   * Série de photos pour un livre papier (« Ajouter par photo » sur sa page, ou dernier rattachement) :
   * les photos qui arrivent sont lues aussitôt et proposées pour ce livre.
   */
  paperSeries: { bookId: string; at: number } | null;
}

/**
 * Devenir d'un élément reçu : où il se trouve maintenant.
 *  - library : ajouté à la bibliothèque (bookId) ; extract(s) : extrait(s) ajouté(s) (highlightId) ;
 *  - draft : écrit créé (draftId) ; waiting : attend une décision dans la Boîte ; dismissed ; error.
 */
export interface Outcome {
  state: 'library' | 'extract' | 'extracts' | 'draft' | 'waiting' | 'dismissed' | 'error';
  /** Phrase courte : « Ajouté à la bibliothèque : « Du contrat social » ». */
  label: string;
  bookId?: string;
  highlightId?: string;
  draftId?: string;
}

export const useInbox = create<InboxState>(() => ({ info: null, items: [], scannedAt: null, wifiOpen: false, outcomes: {}, paperSeries: null }));

/** Série de photos en cours pour ce livre papier (photos lues et proposées pour lui pendant une heure). */
export function startPaperSeries(bookId: string) {
  useInbox.setState({ paperSeries: { bookId, at: Date.now() } });
}
const seriesActive = () => {
  const s = useInbox.getState().paperSeries;
  return !!s && Date.now() - s.at < 3_600_000 && useStore.getState().books.some((b) => b.id === s.bookId && b.format === 'paper');
};
const hasPaperBooks = () => useStore.getState().books.some((b) => b.format === 'paper');

/** Enregistre le devenir d'un élément ; un envoi par le Wi-Fi le renvoie aussi au téléphone. */
function setOutcome(name: string, o: Outcome, wifi = get(name)?.source === 'wifi') {
  useInbox.setState((s) => ({ outcomes: { ...s.outcomes, [name]: o } }));
  if (wifi) void host.inbox?.wifiReport?.(name, { state: o.state, label: o.label }).catch(() => undefined);
}

/** Élément resté dans la Boîte : que lui faut-il ? */
function waitingLabel(it: InboxItem): string {
  if (it.status === 'error') return it.error || 'Lecture impossible.';
  const m = it.matches?.[0];
  switch (it.kind) {
    case 'image':
      if (it.paper?.bookId) return `${paperProposal(it.paper)} À confirmer sur l’ordinateur`;
      return m ? `Passage retrouvé dans « ${titleOf(m.bookId)} » : à valider dans la Boîte de réception` : it.text ? 'Texte lu sur la photo : à ranger dans la Boîte de réception' : 'Photo reçue : à ranger dans la Boîte de réception';
    case 'text':
      return m ? `Passage trouvé dans « ${titleOf(m.bookId)} » : à valider dans la Boîte de réception` : 'Passage non retrouvé dans vos livres : à ranger dans la Boîte de réception';
    case 'draft':
      return 'Document Word : à ouvrir comme écrit depuis la Boîte de réception';
    default:
      return 'Reçu : à ranger dans la Boîte de réception';
  }
}

/** Réception par le Wi-Fi possible (app de bureau). */
export const wifiAvailable = () => !!host.inbox?.wifiStart;

/** Ouvre la Boîte de réception et la fenêtre « Recevoir depuis le téléphone ». */
export function openWifiReceive() {
  if (useStore.getState().route.name !== 'inbox') useStore.getState().navigate({ name: 'inbox' });
  useInbox.setState({ wifiOpen: true });
}

export const inboxAvailable = () => !!host.inbox;

const BOOK_EXT = ['epub', 'pdf'];
const TEXT_EXT = ['txt', 'text', 'md', 'markdown'];
const WEB_EXT = ['html', 'htm'];
const LINK_EXT = ['url', 'webloc'];

export function kindOf(name: string): InboxKind {
  const e = extOf(name);
  if (BOOK_EXT.includes(e)) return 'book';
  if (TEXT_EXT.includes(e)) return 'text';
  if (IMAGE_EXTENSIONS.includes(e)) return 'image';
  if (WEB_EXT.includes(e)) return 'web';
  if (LINK_EXT.includes(e)) return 'link';
  if (e === 'docx') return 'draft';
  return 'other';
}

/** Nom sans extension, pour un titre. */
export const baseName = (name: string) => name.replace(/\.[^.]+$/, '').trim() || name;

/** « iCloud Drive › Marginalia », « OneDrive › Marginalia », sinon les deux derniers dossiers. */
export function prettyDir(dir: string): string {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  const icloud = parts.indexOf('com~apple~CloudDocs');
  if (icloud >= 0) return ['iCloud Drive', ...parts.slice(icloud + 1)].join(' › ');
  const od = parts.findIndex((p) => /^OneDrive\b/i.test(p));
  if (od >= 0) return ['OneDrive', ...parts.slice(od + 1)].join(' › ');
  return parts.slice(-2).join(' › ');
}

// ── État ─────────────────────────────────────────────────────

const patch = (name: string, p: Partial<InboxItem>) =>
  useInbox.setState((s) => ({ items: s.items.map((i) => (i.name === name ? { ...i, ...p } : i)) }));
const get = (name: string) => useInbox.getState().items.find((i) => i.name === name) ?? null;
const drop = (name: string) =>
  useInbox.setState((s) => {
    const it = s.items.find((i) => i.name === name);
    if (it?.preview) URL.revokeObjectURL(it.preview);
    return { items: s.items.filter((i) => i.name !== name) };
  });

/** Noms traités pendant cette session : un fichier encore listé (déplacement en cours) n'est pas repris. */
const handled = new Set<string>();
let scanning: Promise<void> | null = null;
let rescan = false;
let queue: Promise<void> = Promise.resolve();

// Les envois par le Wi-Fi sont toujours lus ; le dossier synchronisé seulement s'il est activé
// (l'hôte ne liste ce dossier qu'après inbox.enable()).
const enabled = () => !!host.inbox;

/** Relit le dossier, ajoute les nouveaux fichiers et lance leur traitement. */
export function scanInbox(): Promise<void> {
  if (scanning) {
    rescan = true;
    return scanning;
  }
  scanning = (async () => {
    // Tests de bas niveau : la boîte de l'interface ne consomme pas les fichiers qu'ils examinent.
    if (!enabled() || (window as unknown as { __inboxPaused?: boolean }).__inboxPaused) return;
    let files: InboxFile[];
    try {
      files = await host.inbox!.list();
    } catch (e) {
      void host.diag?.('boite', 'lecture du dossier', String((e as Error)?.message ?? e));
      return;
    }
    const names = new Set(files.map((f) => f.name));
    for (const n of handled) if (!names.has(n)) handled.delete(n);
    const prev = new Map(useInbox.getState().items.map((i) => [i.name, i]));
    const items: InboxItem[] = [];
    const todo: string[] = [];
    for (const f of files) {
      if (handled.has(f.name)) continue;
      const old = prev.get(f.name);
      // Inchangé (ou en cours) : on garde l'élément tel quel.
      if (old && old.mtime === f.mtime && !(old.pending && !f.pending)) {
        items.push(old);
        continue;
      }
      if (old?.preview) URL.revokeObjectURL(old.preview);
      items.push({ name: f.name, size: f.size, mtime: f.mtime, kind: kindOf(f.name), pending: f.pending, source: f.source, status: 'waiting', step: f.pending ? 'Téléchargement depuis le nuage…' : undefined });
      if (!f.pending) todo.push(f.name);
    }
    for (const [n, it] of prev) if (!names.has(n) && it.preview) URL.revokeObjectURL(it.preview);
    useInbox.setState({ items, scannedAt: Date.now() });
    for (const n of todo) enqueue(n);
  })().finally(() => {
    scanning = null;
    if (rescan) {
      rescan = false;
      void scanInbox();
    }
  });
  return scanning;
}

function enqueue(name: string) {
  queue = queue.then(() => processItem(name)).catch((e) => console.error('Boîte :', e));
}

async function read(name: string): Promise<PickedFile> {
  return host.inbox!.read(name);
}

/** Range le fichier dans « Traités » et le retire de la boîte. */
async function finish(name: string): Promise<boolean> {
  try {
    await host.inbox!.done(name);
  } catch (e) {
    patch(name, { status: 'error', error: String((e as Error)?.message ?? e) });
    return false;
  }
  handled.add(name);
  drop(name);
  return true;
}

function decodeText(data: ArrayBuffer): string {
  let t: string;
  try {
    t = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    t = new TextDecoder('windows-1252').decode(data);
  }
  return t.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
}

function linkOf(name: string, data: ArrayBuffer): string | null {
  const t = decodeText(data);
  const m = extOf(name) === 'webloc' ? t.match(/<string>\s*([^<\s]+)\s*<\/string>/) : t.match(/^\s*URL\s*=\s*(\S+)/im);
  const url = (m?.[1] ?? t.match(/https?:\/\/\S+/)?.[0] ?? '').replace(/&amp;/g, '&');
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Score à partir duquel un texte devient un extrait sans demander. */
const AUTO_SCORE = 0.8;
const isClear = (m: PassageMatch[]) => m.length > 0 && m[0].score >= AUTO_SCORE && (m.length === 1 || m[1].score < m[0].score - 0.2);

async function processItem(name: string) {
  const it = get(name);
  if (!it || it.pending || it.status !== 'waiting' || !enabled()) return;
  try {
    switch (it.kind) {
      case 'book': {
        patch(name, { status: 'working', step: 'Ajout à la bibliothèque…' });
        const f = await read(name);
        const added = await useStore.getState().importFiles([f], { toWorkspace: false });
        if (added.length) {
          setOutcome(name, { state: 'library', label: `Ajouté à la bibliothèque : « ${added[0].title} »`, bookId: added[0].id });
          await finish(name);
        } else patch(name, { status: 'error', error: 'Ce livre n’a pas pu être ajouté à la bibliothèque.' });
        return;
      }
      case 'text': {
        patch(name, { status: 'working', step: 'Lecture…' });
        const text = decodeText((await read(name)).data);
        if (!text) {
          patch(name, { status: 'ready', text: '', matches: [], searchedText: '' });
          return;
        }
        patch(name, { text, step: 'Recherche du passage dans la bibliothèque…' });
        // Plusieurs passages (notes d'un livre copiées depuis Livres, Play Livres…) : un extrait chacun.
        const several = await addSeveral(name, text);
        if (several === 'done') return;
        const left = several ?? text;
        if (several) patch(name, { text: left });
        const matches = await search(left);
        if (isClear(matches) && (await addExtract(name, matches[0], { auto: true }))) return;
        patch(name, { status: 'ready', step: undefined, matches, searchedText: text, searchedIn: null });
        return;
      }
      case 'image': {
        // Pas de reconnaissance automatique : la photo s'affiche, et son texte se lit à la demande
        // (« Lire le texte de la photo »), ou elle rejoint la bibliothèque telle quelle.
        patch(name, { status: 'working', step: 'Ouverture de la photo…', progress: undefined });
        const f = await read(name);
        const { blob } = await displayableBlob(f.data, f.name);
        patch(name, { status: 'ready', step: undefined, preview: URL.createObjectURL(blob) });
        // Photos prises pour un livre papier (« Ajouter par photo ») : lues aussitôt, livre et page proposés.
        if (seriesActive()) void readPhotoText(name);
        return;
      }
      case 'web': {
        const t = decodeText((await read(name)).data);
        const title = t.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
        patch(name, { status: 'ready', title: title ? decodeEntities(title) : baseName(name) });
        return;
      }
      case 'link': {
        const f = await read(name);
        const url = linkOf(name, f.data);
        patch(name, url ? { status: 'ready', url, title: baseName(name) } : { status: 'error', error: 'Adresse introuvable dans ce lien.' });
        return;
      }
      default:
        patch(name, { status: 'ready' });
    }
  } catch (e) {
    console.error('Boîte :', name, e);
    patch(name, { status: 'error', step: undefined, progress: undefined, error: String((e as Error)?.message ?? e) || 'Lecture impossible.' });
  } finally {
    // Resté dans la Boîte (décision attendue, erreur) : on le dit, sans écraser un devenir déjà connu.
    const left = get(name);
    if (left && (left.status === 'ready' || left.status === 'error')) {
      const prev = useInbox.getState().outcomes[name];
      if (!prev || prev.state === 'waiting' || prev.state === 'error') setOutcome(name, prev && prev.state === 'waiting' && left.status !== 'error' ? prev : { state: left.status === 'error' ? 'error' : 'waiting', label: waitingLabel(left) });
    }
  }
}

function decodeEntities(s: string) {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

/**
 * Texte à plusieurs passages : chaque passage retrouvé sans ambiguïté devient un extrait (avec la
 * note qui le suit). 'done' : tout est traité (fichier rangé) ; une chaîne : les passages non
 * retrouvés, qui restent dans la boîte ; null : un seul passage, traitement ordinaire.
 */
async function addSeveral(name: string, text: string): Promise<'done' | string | null> {
  const { splitBlocks, hasSeveralPassages, pairNotes } = await import('./passages');
  const blocks = splitBlocks(text);
  if (!hasSeveralPassages(blocks)) return null;
  const found: (PassageMatch | null)[] = [];
  for (let i = 0; i < blocks.length; i++) {
    patch(name, { step: `Recherche des passages dans la bibliothèque… (${Math.min(i + 1, blocks.length)} / ${blocks.length})` });
    const m = blocks[i].candidate ? await search(blocks[i].text) : [];
    found.push(isClear(m) ? m[0] : null);
  }
  const { found: hits, rest } = pairNotes(blocks, (i) => found[i]);
  if (!hits.length) return null;
  const st = useStore.getState();
  const books = new Set<string>();
  let added = 0;
  let firstId: string | null = null;
  for (const { match: m, note } of hits) {
    if (!st.books.some((b) => b.id === m.bookId)) continue;
    books.add(m.bookId);
    // Déjà là (même texte dans le même livre, envoi répété) : on ne double pas l'extrait.
    if (useStore.getState().highlights.some((h) => h.bookId === m.bookId && h.text === m.text)) continue;
    const n = note.trim();
    const h = st.addHighlight({ bookId: m.bookId, category: null, plain: !n, note: n, text: m.text, anchor: m.anchor, locationLabel: m.locationLabel, printedPage: m.printedPage });
    firstId ??= h.id;
    added++;
  }
  const where = books.size === 1 ? `« ${titleOf([...books][0])} »` : `${books.size} livres`;
  const msg = added ? `${added} extrait${added > 1 ? 's' : ''} reçu${added > 1 ? 's' : ''} du téléphone, ajouté${added > 1 ? 's' : ''} à ${where}` : 'Ces passages sont déjà dans vos extraits';
  const id = firstId;
  const base = { highlightId: id ?? undefined, bookId: books.size === 1 ? [...books][0] : undefined };
  if (!rest.length) {
    setOutcome(name, { state: 'extracts', label: added ? `${added} extrait${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} à ${where}` : 'Déjà dans vos extraits', ...base });
    if (!(await finish(name))) return rest.join('\n\n');
    st.toast(msg, 'success', id ? { label: 'Voir', run: () => useStore.getState().jumpToHighlight(id) } : undefined);
    return 'done';
  }
  setOutcome(name, {
    state: 'waiting',
    label: `${added ? `${added} extrait${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''} à ${where}` : 'Déjà dans vos extraits'} ; ${rest.length} passage${rest.length > 1 ? 's' : ''} non retrouvé${rest.length > 1 ? 's' : ''}, à voir dans la Boîte de réception`,
    ...base,
  });
  st.toast(`${msg}. ${rest.length} passage${rest.length > 1 ? 's' : ''} non retrouvé${rest.length > 1 ? 's' : ''} : à voir dans la boîte.`, 'success', id ? { label: 'Voir', run: () => useStore.getState().jumpToHighlight(id) } : undefined);
  return rest.join('\n\n');
}

async function search(text: string, bookIds?: string[]): Promise<PassageMatch[]> {
  if (!useStore.getState().books.length) return [];
  const { findPassage } = await import('./match');
  return findPassage(text, bookIds ? { bookIds } : {});
}

// ── Actions de la boîte ──────────────────────────────────────

const titleOf = (bookId: string) => useStore.getState().books.find((b) => b.id === bookId)?.title ?? 'ce livre';

/** Ajoute le passage retrouvé comme extrait (surlignage simple) du livre. */
export async function addExtract(name: string, m: PassageMatch, opts: { auto?: boolean } = {}): Promise<boolean> {
  const st = useStore.getState();
  if (!st.books.some((b) => b.id === m.bookId)) return false;
  const h = st.addHighlight({ bookId: m.bookId, category: null, plain: true, text: m.text, anchor: m.anchor, locationLabel: m.locationLabel, printedPage: m.printedPage });
  const prev = useInbox.getState().outcomes[name];
  const extra = prev?.state === 'waiting' && /extraits? ajouté/.test(prev.label) ? `${prev.label.split(' ; ')[0]}, et 1 de plus` : null;
  setOutcome(name, { state: 'extract', label: extra ?? `Extrait ajouté à « ${titleOf(m.bookId)} »${m.locationLabel ? `, ${m.printedPage ? 'p. ' + m.printedPage : m.locationLabel}` : ''}`, highlightId: h.id, bookId: m.bookId });
  if (!(await finish(name))) return false;
  st.toast(`${opts.auto ? 'Extrait reçu du téléphone, ajouté à' : 'Extrait ajouté à'} « ${titleOf(m.bookId)} »`, 'success', { label: 'Voir', run: () => useStore.getState().jumpToHighlight(h.id) });
  return true;
}

/** Relance la recherche avec le texte (éventuellement corrigé), dans un livre ou partout. */
export async function researchItem(name: string, text: string, bookId: string | null = null) {
  patch(name, { text, status: 'working', step: 'Recherche du passage…' });
  try {
    const matches = text.trim() ? await search(text, bookId ? [bookId] : undefined) : [];
    patch(name, { status: 'ready', step: undefined, matches, searchedText: text, searchedIn: bookId });
  } catch (e) {
    patch(name, { status: 'ready', step: undefined, error: String((e as Error)?.message ?? e) });
  }
}

/** Lit le texte d'une photo reçue (à la demande), puis cherche le passage dans la bibliothèque. */
export async function readPhotoText(name: string) {
  const it = get(name);
  if (!it || it.kind !== 'image' || it.status !== 'ready') return;
  try {
    patch(name, { status: 'working', step: 'Lecture du texte de la photo…', progress: 0 });
    const f = await read(name);
    const { recognize } = await import('../reader/image/ocr');
    const { blob } = await displayableBlob(f.data, f.name);
    const bmp = await createImageBitmap(blob, ORIENT);
    let ocr;
    try {
      ocr = await recognize(bmp, (p) => patch(name, { progress: p.value }));
    } finally {
      bmp.close();
    }
    const text = ocr.paras
      .map((p) => p.lines.map((l) => l.words.map((w) => w.t).join(' ')).join('\n'))
      .join('\n\n')
      .trim();
    // Livres papier : livre et page devinés en local (titre courant, série en cours, dernier extrait).
    let paper: PaperGuess | undefined;
    if (hasPaperBooks()) {
      const { guessPaperBook } = await import('./paperGuess');
      const st = useStore.getState();
      paper = guessPaperBook(ocr, { books: st.books, highlights: st.highlights, series: seriesActive() ? useInbox.getState().paperSeries : null });
    }
    const pageText = paper ? paper.text : text;
    patch(name, { text: pageText, paper, progress: undefined, step: 'Recherche du passage dans la bibliothèque…' });
    const matches = pageText ? await search(pageText) : [];
    patch(name, { status: 'ready', step: undefined, matches, searchedText: pageText, searchedIn: null });
    if (paper?.bookId) setOutcome(name, { state: 'waiting', label: `${paperProposal(paper)} À confirmer sur l’ordinateur` });
  } catch (e) {
    console.error('Boîte :', name, e);
    patch(name, { status: 'error', step: undefined, progress: undefined, error: 'Le texte de la photo n’a pas pu être lu.' });
  }
}

export const setItemText = (name: string, text: string) => patch(name, { text });

/** « « Du contrat social », p. 47 ? » */
export function paperProposal(g: PaperGuess): string {
  const t = titleOf(g.bookId ?? '');
  return `« ${t} »${g.page ? `, p. ${g.page}` : ''} ?`;
}

/** Change le livre ou la page proposés (avant confirmation). */
export function setPaperGuess(name: string, p: Partial<PaperGuess>) {
  const it = get(name);
  if (!it) return;
  patch(name, { paper: { bookId: null, reason: null, page: '', text: it.text ?? '', ...(it.paper ?? {}), ...p } });
}

/**
 * Rattache la photo d'une page à un livre papier : un extrait (texte lu, corrigeable ; page) est
 * ajouté au livre, la photo est rangée avec lui (copie JPEG, dossier du livre), et la série continue.
 */
export async function attachPhotoToPaper(name: string, bookId: string, opts: { page: string; text: string; category?: import('../../lib/types').CategoryId | null }): Promise<boolean> {
  const it = get(name);
  const st = useStore.getState();
  const book = st.books.find((b) => b.id === bookId && b.format === 'paper');
  if (!it || !book) return false;
  patch(name, { status: 'working', step: `Ajout à « ${book.title} »…` });
  try {
    const f = await read(name);
    const { blob } = await displayableBlob(f.data, f.name);
    const jpeg = await toStoredJpeg(blob);
    const photo = `photos/${uid()}.jpg`;
    await host.storeFile(bookId, photo, jpeg);
    const { addPaperExtract } = await import('../paper/paper');
    const h = addPaperExtract(bookId, { text: opts.text.trim() || '(photo de la page)', page: opts.page, category: opts.category ?? null, photo });
    startPaperSeries(bookId);
    setOutcome(name, { state: 'extract', label: `Extrait ajouté à « ${book.title} »${h.printedPage ? `, p. ${h.printedPage}` : ''}`, highlightId: h.id, bookId });
    if (!(await finish(name))) return false;
    useStore.getState().toast(`Extrait ajouté à « ${book.title} »${h.printedPage ? `, p. ${h.printedPage}` : ''}`, 'success', { label: 'Voir', run: () => useStore.getState().jumpToHighlight(h.id) });
    return true;
  } catch (e) {
    console.error('Boîte :', name, e);
    patch(name, { status: 'ready', step: undefined, error: String((e as Error)?.message ?? e) });
    useStore.getState().toast('La photo n’a pas pu être rattachée au livre.', 'error');
    return false;
  }
}

/** Copie de la photo gardée avec l'extrait : JPEG, 1800 px au plus (lisible, sans alourdir la bibliothèque). */
async function toStoredJpeg(blob: Blob): Promise<ArrayBuffer> {
  const bmp = await createImageBitmap(blob, ORIENT);
  try {
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (!out) throw new Error('Conversion de la photo impossible');
    return await out.arrayBuffer();
  } finally {
    bmp.close();
  }
}

/** Ajoute le fichier tel quel à la bibliothèque (photo, page web…). */
export async function addToLibrary(name: string) {
  patch(name, { status: 'working', step: 'Ajout à la bibliothèque…' });
  try {
    const f = await read(name);
    const added = await useStore.getState().importFiles([f], { toWorkspace: false, asBook: true });
    if (added.length) {
      setOutcome(name, { state: 'library', label: `Ajouté à la bibliothèque : « ${added[0].title} »`, bookId: added[0].id });
      await finish(name);
    } else patch(name, { status: 'ready', step: undefined });
  } catch (e) {
    patch(name, { status: 'error', step: undefined, error: String((e as Error)?.message ?? e) });
  }
}

/** Photos de la Boîte, à assembler en un document (fenêtre « Assembler en un document »). */
export function inboxPhotoSources(names: string[]): PhotoSource[] {
  return names.map((n) => ({ key: n, name: baseName(n), read: async () => (await read(n)).data }));
}

/** Après assemblage : chaque photo dit où elle est allée (page n du document), puis quitte la Boîte. */
export async function finishAssembled(names: string[], book: Book) {
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (!get(n)) continue;
    setOutcome(n, { state: 'library', label: `Page ${i + 1} de « ${book.title} », dans la bibliothèque`, bookId: book.id });
    await finish(n);
  }
}

/** Crée un écrit : à partir du texte (texte, photo) ou du document Word. */
export async function makeDraft(name: string) {
  const it = get(name);
  if (!it) return;
  patch(name, { status: 'working', step: 'Création de l’écrit…' });
  try {
    let d: { id: string; title: string };
    if (it.kind === 'draft') {
      const f = await read(name);
      d = await createDraftFromFile(f.name, f.data);
    } else {
      const text = (it.text ?? '').trim();
      // Paragraphes gardés ; les caractères Markdown du texte reçu sont échappés.
      const md = text.replace(/([\\`*_[\]#<>|])/g, '\\$1').replace(/\n(?!\n)/g, '  \n');
      d = await createDraftFromFile(`${baseName(name)}.md`, new TextEncoder().encode(md).buffer as ArrayBuffer);
    }
    setOutcome(name, { state: 'draft', label: `Écrit créé : « ${d.title} »`, draftId: d.id });
    if (!(await finish(name))) return;
    useStore.getState().toast(`Écrit « ${d.title} » créé`, 'success', { label: 'Ouvrir', run: () => useStore.getState().navigate({ name: 'write', draftId: d.id }) });
  } catch (e) {
    patch(name, { status: 'error', step: undefined, error: String((e as Error)?.message ?? e) });
  }
}

/** Retire de la boîte sans rien créer (le fichier est rangé dans « Traités »). */
export async function dismissItem(name: string) {
  const wifi = get(name)?.source === 'wifi';
  setOutcome(name, { state: 'dismissed', label: 'Retiré de la Boîte de réception' }, wifi);
  if (await finish(name)) useStore.getState().toast(wifi ? 'Retiré de la boîte' : 'Retiré de la boîte (rangé dans « Traités »)', 'info');
}

export function retryItem(name: string) {
  patch(name, { status: 'waiting', error: undefined, step: undefined });
  enqueue(name);
}

export async function revealInbox() {
  try {
    await host.inbox?.reveal();
  } catch (e) {
    useStore.getState().toast(String((e as Error)?.message ?? e), 'error');
  }
}

/** Active ou désactive la boîte (réglage + surveillance du dossier). */
export async function setInboxEnabled(on: boolean) {
  if (!host.inbox) return;
  useStore.getState().updateSettings({ inbox: on });
  if (on) {
    try {
      useInbox.setState({ info: await host.inbox.enable() });
    } catch (e) {
      useStore.getState().toast(String((e as Error)?.message ?? e), 'error');
    }
  }
}

export async function chooseInboxDir() {
  const info = await host.inbox?.choose().catch((e) => {
    useStore.getState().toast(String((e as Error)?.message ?? e), 'error');
    return null;
  });
  if (!info) return;
  useInbox.setState({ info, items: [] });
  handled.clear();
  void scanInbox();
}

export async function resetInboxDir() {
  const info = await host.inbox?.reset();
  if (!info) return;
  useInbox.setState({ info, items: [] });
  handled.clear();
  void scanInbox();
}

/** Branché une fois dans l'app : envois par le Wi-Fi toujours lus ; dossier synchronisé surveillé tant que la boîte est activée. */
export function useInboxSync() {
  const ready = useStore((s) => s.ready);
  const on = useStore((s) => !!s.settings.inbox);
  useEffect(() => {
    const api = host.inbox;
    if (!api || !ready) return;
    if (!useInbox.getState().info) void api.info().then((info) => useInbox.setState({ info })).catch(() => undefined);
    let alive = true;
    void (async () => {
      try {
        if (on) {
          const info = await api.enable();
          if (alive) useInbox.setState({ info });
        } else {
          await api.disable();
        }
      } catch (e) {
        void host.diag?.('boite', on ? 'activation' : 'désactivation', String((e as Error)?.message ?? e));
      }
      if (alive) void scanInbox();
    })();
    const off = api.onChange(() => void scanInbox());
    let last = Date.now();
    const onFocus = () => {
      if (Date.now() - last < 20_000) return;
      last = Date.now();
      void scanInbox();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      off();
      window.removeEventListener('focus', onFocus);
    };
  }, [ready, on]);
}

/**
 * Élément qui attend une décision : pas un livre en cours de rangement automatique, ni un texte
 * dont on cherche encore le passage (il deviendra peut-être un extrait tout seul).
 */
export const needsDecision = (i: InboxItem) => i.status === 'error' || (i.kind === 'book' ? false : i.kind === 'text' ? i.status === 'ready' : true);

/** Nombre d'éléments qui attendent une décision (dossier synchronisé et envois par le Wi-Fi). */
export function useInboxCount(): number {
  return useInbox((s) => s.items.reduce((k, i) => k + (needsDecision(i) ? 1 : 0), 0));
}
