// ─────────────────────────────────────────────────────────────
// Synchro des annotations de Livres → Marginalia (sens unique, jamais d'écriture dans Livres).
// Surlignages (+ notes), signets et position de lecture des EPUB sans DRM déjà importés.
//
// Idempotente : chaque extrait / signet garde sa provenance (`source`, uuid de Livres + valeurs
// synchronisées). Ce que l'utilisateur a changé dans Marginalia n'est jamais écrasé ; une
// suppression dans Livres ne retire que ce qui n'a pas été enrichi. Aucune entrée ⌘Z, une seule
// entrée de journal groupée par synchro.
// ─────────────────────────────────────────────────────────────
import { useStore, uid, type State } from '../../lib/store';
import { host, type AppleBooksAnnotation, type AppleBooksAsset } from '../../lib/platform';
import type { AppleBooksColor, AppleBooksColorTarget, AppleBooksSyncReport, Book, Bookmark, CategoryId, Highlight, ReaderPosition, Settings } from '../../lib/types';
import { parseBook, printedPageAt, type ParsedDoc } from '../reader/html/parse';
import { makeAnchor } from '../reader/html/anchoring';
import { proposeLabel, sentenceAt } from '../reader/bookmarks/bookmarks';
import { loadCfiContext, resolveCfiPoint, resolveCfiRange, type CfiContext } from './appleBooksCfi';

export const appleBooksAnnotationsAvailable = () => !!host.appleBooksAnnotations;

// ── Réglages ─────────────────────────────────────────────────

export const APPLE_COLORS: { id: AppleBooksColor; label: string; swatch: string; style: number }[] = [
  { id: 'jaune', label: 'Jaune', swatch: '#f7d74a', style: 3 },
  { id: 'vert', label: 'Vert', swatch: '#8fd16a', style: 1 },
  { id: 'bleu', label: 'Bleu', swatch: '#7fb5f0', style: 2 },
  { id: 'rose', label: 'Rose', swatch: '#f59bb6', style: 4 },
  { id: 'violet', label: 'Violet', swatch: '#c19af0', style: 5 },
  { id: 'souligne', label: 'Souligné', swatch: '#e2533d', style: 0 },
];

export const DEFAULT_COLOR_MAP: Record<AppleBooksColor, AppleBooksColorTarget> = {
  jaune: 'these',
  vert: 'argument',
  bleu: 'concept',
  rose: 'objection',
  violet: 'exemple',
  souligne: 'probleme',
};

export function colorMapOf(s: Settings): Record<AppleBooksColor, AppleBooksColorTarget> {
  return { ...DEFAULT_COLOR_MAP, ...(s.appleBooksColorMap ?? {}) };
}

/** Interrupteurs effectifs (absents : suivent la synchro des livres). */
export function annotationToggles(s: Settings) {
  const on = !!s.appleBooksSync;
  const a = s.appleBooksAnnotations ?? {};
  return { highlights: a.highlights ?? on, bookmarks: a.bookmarks ?? on, position: a.position ?? on };
}

function colorOf(a: AppleBooksAnnotation): AppleBooksColor {
  if (a.underline || a.style === 0) return 'souligne';
  return APPLE_COLORS.find((c) => c.style === a.style)?.id ?? 'jaune'; // valeur inconnue : couleur par défaut de Livres
}

// ── Rattachement des livres ──────────────────────────────────

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Livre Marginalia correspondant : nom de fichier, sinon titre + auteur normalisés. */
export function matchBook(a: AppleBooksAsset, books: Book[], claimed: Set<string> = new Set()): Book | null {
  const name = a.fileName.normalize('NFC');
  const byName = name ? books.find((b) => (b.originalName ?? '').normalize('NFC') === name) : null;
  if (byName) return byName;
  const t = norm(a.title);
  if (!t) return null;
  const au = norm(a.author);
  // Un livre dont le nom de fichier est celui d'un autre livre de Livres lui appartient.
  const cands = books.filter((b) => !claimed.has((b.originalName ?? '').normalize('NFC')) && norm(b.title) === t && (!au || !norm(b.author) || norm(b.author) === au));
  return cands.length === 1 ? cands[0] : null;
}

// ── Utilitaires ──────────────────────────────────────────────

function isEnriched(h: Highlight, s: State): boolean {
  if (h.conceptIds.length || h.noteKind) return true;
  if (h.source && (h.note ?? '') !== (h.source.note ?? '')) return true;
  if (h.source && h.source.category !== undefined && h.category !== h.source.category) return true;
  if (h.source && !!h.source.plain !== !!h.plain) return true;
  if (s.cards.some((c) => c.highlightId === h.id)) return true;
  if (s.maps[h.bookId]?.nodes.some((n) => n.highlightId === h.id)) return true;
  if (s.arguments.some((a) => [...a.premises, a.conclusion].some((p) => p.highlightId === h.id))) return true;
  if (s.concepts.some((c) => c.senses.some((x) => x.highlightIds.includes(h.id)))) return true;
  const inPlan = (nodes: State['plans'][number]['parts']): boolean => nodes.some((n) => n.items.some((i) => i.ref.kind === 'highlight' && i.ref.id === h.id) || inPlan(n.children));
  return s.plans.some((p) => inPlan(p.parts));
}

function bookmarkEnriched(b: Bookmark): boolean {
  return !!(b.note || b.color || (b.source?.label !== undefined && b.label !== b.source.label));
}

function positionAt(parsed: ParsedDoc, chapter: number, offset: number): { position: ReaderPosition; progress: number } {
  const lens = parsed.chapters.map((c) => c.text.length);
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  const before = lens.slice(0, chapter).reduce((a, b) => a + b, 0);
  const len = lens[chapter] || 1;
  return { position: { kind: 'html', chapter, scroll: Number(Math.max(0, Math.min(1, offset / len)).toFixed(5)) }, progress: Math.max(0, Math.min(1, (before + offset) / total)) };
}

function pointFromProgress(parsed: ParsedDoc, p: number): { chapter: number; offset: number } {
  const lens = parsed.chapters.map((c) => c.text.length);
  let rest = Math.max(0, Math.min(1, p)) * lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lens.length; i++) {
    if (rest <= lens[i] || i === lens.length - 1) return { chapter: i, offset: Math.max(0, Math.min(lens[i], Math.round(rest))) };
    rest -= lens[i];
  }
  return { chapter: 0, offset: 0 };
}

/** Signet construit comme le lecteur le ferait à cet endroit (sans DOM). */
function bookmarkFields(parsed: ParsedDoc, chapter: number, offset: number) {
  const ch = parsed.chapters[chapter];
  const text = ch.text;
  let start = Math.max(0, Math.min(offset, text.length));
  while (start < text.length && /\s/.test(text[start])) start++;
  const nl = text.indexOf('\n', start);
  const bEnd = nl < 0 ? text.length : nl;
  const end = Math.min(text.length, start + 40, bEnd - start >= 12 ? bEnd : Infinity);
  const { position, progress } = positionAt(parsed, chapter, start);
  return {
    position,
    anchor: makeAnchor(text, chapter, start, end),
    excerpt: text.slice(start, end),
    progress,
    locationLabel: ch.label,
    label: proposeLabel(ch.label, sentenceAt(text, start)),
  };
}

// ── Synchro ──────────────────────────────────────────────────

/** Position de Livres plus récente proposée pour un livre ouvert (toast « Reprendre »). */
export interface PendingResume {
  bookId: string;
  position: ReaderPosition;
  anchor: Bookmark['anchor'];
  excerpt: string;
  progress: number;
}

/** Positions déjà proposées pendant cette session (pas de toast répété). */
const offered = new Set<string>();
/** Annotations introuvables (uuid → date Livres) : pas de nouvel essai tant qu'elles ne changent pas. */
const unresolved = new Map<string, number>();
let running: Promise<AppleBooksSyncReport | null> | null = null;
let again = false;

/** Événement écouté par le lecteur : aller à la position de Livres. */
export const RESUME_EVENT = 'marginalia:resume-livres';

function isOpen(s: State, bookId: string) {
  const r = s.route;
  return r.name === 'reader' && (r.bookId === bookId || r.splitBookId === bookId);
}

/**
 * Une passe de synchro des annotations. `manual` : même si tout est désactivé (bouton
 * « Synchroniser maintenant ») — les interrupteurs restent respectés pour chaque type.
 */
export function syncAppleBooksAnnotations(opts: { manual?: boolean } = {}): Promise<AppleBooksSyncReport | null> {
  if (running) {
    again = true;
    return running;
  }
  running = run(opts)
    .catch((e) => {
      console.error('Livres (annotations) :', e);
      void host.diag?.('livres', 'synchro des annotations', String(e?.message ?? e));
      return null;
    })
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        void syncAppleBooksAnnotations();
      }
    });
  return running;
}

type Op =
  | { kind: 'addH'; h: Highlight }
  | { kind: 'patchH'; id: string; patch: Partial<Highlight> }
  | { kind: 'delH'; id: string }
  | { kind: 'addB'; b: Bookmark }
  | { kind: 'patchB'; id: string; patch: Partial<Bookmark> }
  | { kind: 'delB'; id: string }
  | { kind: 'book'; id: string; patch: Partial<Book> };

async function run(opts: { manual?: boolean }): Promise<AppleBooksSyncReport | null> {
  if (!host.appleBooksAnnotations) return null;
  const s0 = useStore.getState();
  const tog = annotationToggles(s0.settings);
  if (!tog.highlights && !tog.bookmarks && !tog.position) return null;
  const res = await host.appleBooksAnnotations();
  const prev = s0.settings.appleBooksLastSync;
  if (res.status !== 'ok') {
    if (res.status === 'absent' && !opts.manual) return null;
    const report: AppleBooksSyncReport = { ...(prev ?? { highlights: 0, bookmarks: 0, positions: 0 }), at: Date.now(), created: 0, updated: 0, removed: 0, notFound: 0, error: res.message ?? 'Lecture impossible' };
    useStore.getState().applyExternal((s) => ({ settings: { ...s.settings, appleBooksLastSync: report } }));
    return report;
  }

  const colorMap = colorMapOf(s0.settings);
  const known = new Set(s0.settings.appleBooksKnown ?? []);
  const forget = new Set<string>();
  const remember = new Set<string>();
  const ops: Op[] = [];
  let notFound = 0;
  let positions = 0;
  const counts = { hNew: 0, hUpd: 0, hDel: 0, bNew: 0, bUpd: 0, bDel: 0 };
  let resume: PendingResume | null = null;

  const claimed = new Set(res.books.map((b) => b.fileName.normalize('NFC')).filter(Boolean));
  for (const asset of res.books) {
    if (asset.protected) continue;
    const s = useStore.getState();
    const book = matchBook(asset, s.books, claimed);
    if (!book || book.format !== 'epub') continue;

    const live = asset.annotations.filter((a) => !a.deleted);
    const hl = tog.highlights ? live.filter((a) => a.type === 'highlight') : [];
    const bm = tog.bookmarks ? live.filter((a) => a.type === 'bookmark') : [];
    const posAnn = tog.position ? live.filter((a) => a.type === 'position').sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))[0] ?? null : null;
    const liveIds = new Set(live.map((a) => a.uuid));
    const deletedIds = new Set(asset.annotations.filter((a) => a.deleted).map((a) => a.uuid));
    const myH = s.highlights.filter((h) => h.bookId === book.id && h.source?.app === 'livres');
    const myB = s.bookmarks.filter((b) => b.bookId === book.id && b.source?.app === 'livres');
    const hBy = new Map(myH.map((h) => [h.source!.uuid, h]));
    const bBy = new Map(myB.map((b) => [b.source!.uuid, b]));

    // Position : date Livres (annotation de position ou dernière ouverture) contre Marginalia.
    const livresDate = Math.max(posAnn?.modified ?? 0, asset.lastOpened ?? 0);
    const wantPos = tog.position && (posAnn || asset.progress != null) && livresDate > 0;
    if (wantPos) positions++;
    const posNewer = wantPos && livresDate > (book.lastOpenedAt ?? 0);
    const posKey = `${book.id}|${livresDate}`;

    // Travail à faire ? (sinon pas d'analyse du livre : synchro suivante quasi gratuite)
    const fresh = (a: AppleBooksAnnotation, by: Map<string, { source?: { modified: number } }>) => {
      const cur = by.get(a.uuid);
      if (cur) return cur.source!.modified !== (a.modified ?? 0);
      if (known.has(a.uuid)) return false; // supprimé à la main dans Marginalia : on ne le recrée pas
      if (unresolved.get(a.uuid) === (a.modified ?? 0)) {
        notFound++; // déjà cherché en vain (cette session) : pas de nouvelle analyse
        return false;
      }
      if (a.type === 'highlight' && colorMap[colorOf(a)] === 'skip') return false;
      return true;
    };
    const todoH = hl.filter((a) => fresh(a, hBy));
    const todoB = bm.filter((a) => fresh(a, bBy));
    // Supprimé dans Livres : marqué supprimé, ou absent alors que Livres liste d'autres annotations
    // du livre (garde-fou : une base lue vide ne vide jamais Marginalia).
    const gone = (u: string) => deletedIds.has(u) || (!liveIds.has(u) && asset.annotations.length > 0);
    const goneH = tog.highlights ? myH.filter((h) => gone(h.source!.uuid)) : [];
    const goneB = tog.bookmarks ? myB.filter((b) => gone(b.source!.uuid)) : [];
    const needPos = posNewer && !offered.has(posKey);
    // uuid oubliés (supprimés dans Livres) : la mémoire « déjà importé » est purgée.
    for (const id of known) if (deletedIds.has(id) && !hBy.has(id) && !bBy.has(id)) forget.add(id);
    if (!todoH.length && !todoB.length && !goneH.length && !goneB.length && !needPos) continue;

    // Suppressions (sans analyse du livre)
    for (const h of goneH) {
      forget.add(h.source!.uuid);
      if (isEnriched(h, s)) ops.push({ kind: 'patchH', id: h.id, patch: { source: undefined } });
      else {
        ops.push({ kind: 'delH', id: h.id });
        counts.hDel++;
      }
    }
    for (const b of goneB) {
      forget.add(b.source!.uuid);
      if (bookmarkEnriched(b)) ops.push({ kind: 'patchB', id: b.id, patch: { source: undefined } });
      else {
        ops.push({ kind: 'delB', id: b.id });
        counts.bDel++;
      }
    }
    if (!todoH.length && !todoB.length && !needPos) continue;

    // Analyse du livre (comme le lecteur) puis contexte CFI.
    let parsed: ParsedDoc;
    let data: ArrayBuffer;
    try {
      data = await host.readFile(book.id, book.fileName);
      parsed = await parseBook(book, data);
    } catch (e) {
      void host.diag?.('livres', 'livre illisible', book.title, String((e as Error)?.message ?? e));
      notFound += todoH.length + todoB.length;
      continue;
    }
    for (const u of parsed.urls) URL.revokeObjectURL(u);
    const ctx: CfiContext | null = await loadCfiContext(data, parsed.chapters);
    if (!ctx) {
      notFound += todoH.length + todoB.length;
      continue;
    }

    let k = 0;
    // Rend la main à l'interface régulièrement (première synchro d'une grosse bibliothèque).
    const breathe = () => (++k % 8 === 0 ? new Promise((r) => setTimeout(r, 0)) : null);
    for (const a of todoH) {
      await breathe();
      const span = await resolveCfiRange(ctx, a.cfi, a.text);
      const cur = hBy.get(a.uuid);
      if (!span) {
        notFound++;
        void host.diag?.('livres', 'passage introuvable', book.title, a.cfi, a.text.slice(0, 60));
        if (!cur) unresolved.set(a.uuid, a.modified ?? 0);
        // Modifié dans Livres mais introuvable : on garde l'extrait tel quel (pas de nouvel essai à chaque synchro).
        if (cur) ops.push({ kind: 'patchH', id: cur.id, patch: { source: { ...cur.source!, modified: a.modified ?? 0 } } });
        continue;
      }
      const text = parsed.chapters[span.chapter].text;
      const target = colorMap[colorOf(a)];
      const category: CategoryId | null = target === 'note' || target === 'plain' || target === 'skip' ? null : target;
      // « Surlignage simple » : sans catégorie, et sans note si Livres n'en a pas.
      const plainTarget = target === 'plain';
      const quote = text.slice(span.start, span.end);
      const anchor = makeAnchor(text, span.chapter, span.start, span.end);
      const now = Date.now();
      if (!cur) {
        ops.push({
          kind: 'addH',
          h: {
            id: uid(),
            bookId: book.id,
            category,
            ...(plainTarget && !a.note.trim() ? { plain: true } : {}),
            text: quote,
            note: a.note,
            noteKind: null,
            conceptIds: [],
            anchor,
            locationLabel: parsed.chapters[span.chapter].label,
            printedPage: printedPageAt(parsed.pages, span.chapter, span.start),
            createdAt: a.created ?? now,
            updatedAt: a.modified ?? now,
            source: { app: 'livres', uuid: a.uuid, modified: a.modified ?? 0, category, ...(plainTarget && !a.note.trim() ? { plain: true } : {}), note: a.note, text: a.text },
          },
        });
        remember.add(a.uuid);
        counts.hNew++;
        continue;
      }
      // Mise à jour : ce que l'utilisateur a changé dans Marginalia reste à lui.
      const src = cur.source!;
      const patch: Partial<Highlight> = {};
      const userCat = src.category !== undefined && cur.category !== src.category;
      const userNote = (cur.note ?? '') !== (src.note ?? '');
      if (!userCat && target !== 'skip' && cur.category !== category) patch.category = category;
      if (!userNote && cur.note !== a.note) patch.note = a.note;
      // Surlignage simple <-> note de marge, tant que l'utilisateur n'a rien changé de son côté.
      const userKind = !!cur.plain !== !!src.plain;
      if (!userCat && !userNote && !userKind && target !== 'skip' && category === null) {
        const wantPlain = plainTarget && !(patch.note ?? cur.note).trim();
        if (!!cur.plain !== wantPlain) patch.plain = wantPlain || undefined;
      }
      if (cur.text !== quote || cur.anchor.kind !== 'html' || cur.anchor.chapter !== span.chapter || cur.anchor.start !== span.start || cur.anchor.end !== span.end) {
        patch.text = quote;
        patch.anchor = anchor;
        patch.locationLabel = parsed.chapters[span.chapter].label;
        patch.printedPage = printedPageAt(parsed.pages, span.chapter, span.start);
      }
      const changed = Object.keys(patch).length > 0;
      // Valeurs « synchronisées » : inchangées pour ce que l'utilisateur a modifié (on garde la trace).
      patch.source = {
        ...src,
        modified: a.modified ?? 0,
        text: a.text,
        category: userCat ? src.category : patch.category !== undefined ? patch.category : cur.category,
        note: userNote ? src.note : a.note,
        plain: userKind ? src.plain : patch.plain !== undefined || 'plain' in patch ? patch.plain : cur.plain,
      };
      if (changed) {
        patch.updatedAt = Math.max(cur.updatedAt, a.modified ?? 0);
        counts.hUpd++;
      }
      ops.push({ kind: 'patchH', id: cur.id, patch });
    }

    for (const a of todoB) {
      await breathe();
      const pt = await resolveCfiPoint(ctx, a.cfi);
      const cur = bBy.get(a.uuid);
      if (!pt) {
        notFound++;
        void host.diag?.('livres', 'signet introuvable', book.title, a.cfi);
        if (!cur) unresolved.set(a.uuid, a.modified ?? 0);
        if (cur) ops.push({ kind: 'patchB', id: cur.id, patch: { source: { ...cur.source!, modified: a.modified ?? 0 } } });
        continue;
      }
      const f = bookmarkFields(parsed, pt.chapter, pt.offset);
      if (!cur) {
        ops.push({
          kind: 'addB',
          b: { id: uid(), bookId: book.id, ...f, note: a.note || undefined, color: null, createdAt: a.created ?? Date.now(), source: { app: 'livres', uuid: a.uuid, modified: a.modified ?? 0, label: f.label } },
        });
        remember.add(a.uuid);
        counts.bNew++;
      } else {
        const userLabel = cur.source!.label !== undefined && cur.label !== cur.source!.label;
        ops.push({
          kind: 'patchB',
          id: cur.id,
          patch: { position: f.position, anchor: f.anchor, excerpt: f.excerpt, progress: f.progress, locationLabel: f.locationLabel, ...(userLabel ? {} : { label: f.label }), source: { ...cur.source!, modified: a.modified ?? 0, label: userLabel ? cur.source!.label : f.label } },
        });
        counts.bUpd++;
      }
    }

    if (needPos) {
      let pt: { chapter: number; offset: number } | null = posAnn ? await resolveCfiPoint(ctx, posAnn.cfi) : null;
      if (!pt && asset.progress != null) pt = pointFromProgress(parsed, asset.progress);
      if (!pt) offered.add(posKey); // position illisible : pas de nouvel essai pour cette date
      if (pt) {
        const f = bookmarkFields(parsed, pt.chapter, pt.offset);
        if (isOpen(useStore.getState(), book.id)) {
          // Jamais de saut sous les yeux : proposition, si Livres est plus loin.
          offered.add(posKey);
          if (f.progress > (useStore.getState().books.find((b) => b.id === book.id)?.progress ?? 0) + 0.002)
            resume = { bookId: book.id, position: f.position, anchor: f.anchor, excerpt: f.excerpt, progress: f.progress };
        } else ops.push({ kind: 'book', id: book.id, patch: { position: { ...f.position, offset: f.anchor.kind === 'html' ? f.anchor.start : undefined } as ReaderPosition, progress: f.progress, lastOpenedAt: livresDate } });
      }
    }
  }

  // Application en une fois, sur l'état le plus récent (l'analyse a pris du temps).
  const nCreated = counts.hNew + counts.bNew;
  const nUpdated = counts.hUpd + counts.bUpd;
  const nRemoved = counts.hDel + counts.bDel;
  const bits: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  if (counts.hNew || counts.hUpd || counts.hDel) bits.push(plural(counts.hNew + counts.hUpd + counts.hDel, 'surlignage', 'surlignages'));
  if (counts.bNew || counts.bUpd || counts.bDel) bits.push(plural(counts.bNew + counts.bUpd + counts.bDel, 'signet', 'signets'));
  const detail: string[] = [];
  if (nCreated) detail.push(`${nCreated} ajouté${nCreated > 1 ? 's' : ''}`);
  if (nUpdated) detail.push(`${nUpdated} mis à jour`);
  if (nRemoved) detail.push(`${nRemoved} retiré${nRemoved > 1 ? 's' : ''}`);

  let report: AppleBooksSyncReport | null = null;
  useStore.getState().applyExternal(
    (s) => {
      let highlights = s.highlights;
      let bookmarks = s.bookmarks;
      let books = s.books;
      const hasBook = (id: string) => s.books.some((b) => b.id === id);
      for (const op of ops) {
        switch (op.kind) {
          case 'addH':
            if (hasBook(op.h.bookId) && !highlights.some((h) => h.source?.uuid === op.h.source!.uuid)) highlights = [...highlights, op.h];
            break;
          case 'patchH':
            highlights = highlights.map((h) => (h.id === op.id ? stripUndefined({ ...h, ...op.patch }) : h));
            break;
          case 'delH':
            highlights = highlights.filter((h) => h.id !== op.id);
            break;
          case 'addB':
            if (hasBook(op.b.bookId) && !bookmarks.some((b) => b.source?.uuid === op.b.source!.uuid)) bookmarks = [...bookmarks, op.b];
            break;
          case 'patchB':
            bookmarks = bookmarks.map((b) => (b.id === op.id ? stripUndefined({ ...b, ...op.patch }) : b));
            break;
          case 'delB':
            bookmarks = bookmarks.filter((b) => b.id !== op.id);
            break;
          case 'book':
            // Le livre a pu être ouvert entre-temps : la règle « le plus récent gagne » est revérifiée.
            books = books.map((b) => (b.id === op.id && !isOpen(s, b.id) && (op.patch.lastOpenedAt ?? 0) > (b.lastOpenedAt ?? 0) ? { ...b, ...op.patch } : b));
            break;
        }
      }
      const knownNext = new Set(s.settings.appleBooksKnown ?? []);
      for (const id of remember) knownNext.add(id);
      for (const id of forget) knownNext.delete(id);
      report = {
        at: Date.now(),
        highlights: highlights.filter((h) => h.source?.app === 'livres').length,
        bookmarks: bookmarks.filter((b) => b.source?.app === 'livres').length,
        positions,
        created: nCreated,
        updated: nUpdated,
        removed: nRemoved,
        notFound,
      };
      const out: Partial<Pick<State, 'books' | 'highlights' | 'bookmarks' | 'settings'>> = {
        settings: { ...s.settings, appleBooksKnown: [...knownNext], appleBooksLastSync: report },
      };
      if (highlights !== s.highlights) out.highlights = highlights;
      if (bookmarks !== s.bookmarks) out.bookmarks = bookmarks;
      if (books !== s.books) out.books = books;
      return out;
    },
    bits.length
      ? { action: 'import', kind: 'file', refId: null, bookId: null, title: 'Livres d’Apple', summary: `Synchro Livres : ${bits.join(', ')}${detail.length ? ` (${detail.join(', ')})` : ''}` }
      : undefined,
  );

  const r = resume as PendingResume | null;
  if (r) {
    const st = useStore.getState();
    st.toast('Reprendre là où vous étiez dans Livres ?', 'info', {
      label: 'Reprendre',
      run: () => window.dispatchEvent(new CustomEvent(RESUME_EVENT, { detail: r })),
    });
  }
  return report;
}

function stripUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/** Texte du dernier résultat : « 128 surlignages, 14 signets, 6 positions — 3 passages introuvables ». */
export function reportText(r: AppleBooksSyncReport | undefined): string {
  if (!r) return 'Pas encore synchronisé.';
  if (r.error) return r.error;
  const p = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  let t = `${p(r.highlights, 'surlignage', 'surlignages')}, ${p(r.bookmarks, 'signet', 'signets')}, ${p(r.positions, 'position', 'positions')}`;
  if (r.notFound) t += ` — ${p(r.notFound, 'passage introuvable', 'passages introuvables')}`;
  return t;
}
