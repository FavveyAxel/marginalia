// Vidéos : reconnaissance d'un lien (YouTube, Vimeo, Dailymotion, ou tout autre lien), ajout à la
// bibliothèque, extraits minutés, transcription (sous-titres YouTube) rangée avec la vidéo.
// Une vidéo est un document sans fichier (format « video ») ; ses extraits sont ancrés dans le
// temps (ancre « html », chapitre 0, début et fin en millisecondes ; voir VideoInfo dans types.ts).
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { uid, useStore } from '../../lib/store';
import { host, type VideoCue } from '../../lib/platform';
import type { Book, CategoryId, Highlight, HtmlAnchor, VideoInfo, VideoProvider } from '../../lib/types';

export const isVideo = (b: Pick<Book, 'format'> | null | undefined): boolean => !!b && b.format === 'video';

export const PROVIDER_LABEL: Record<VideoProvider, string> = { youtube: 'YouTube', vimeo: 'Vimeo', dailymotion: 'Dailymotion', link: 'Lien' };

/** Plateformes dont le lecteur s'intègre dans l'app. */
export const EMBEDDED = (p: VideoProvider) => p === 'youtube' || p === 'vimeo' || p === 'dailymotion';
/** Plateformes dont l'app sait suivre la lecture (minute en cours) et commander le lecteur. */
export const CONTROLLED = (p: VideoProvider) => p === 'youtube' || p === 'vimeo';

// ── Liens ────────────────────────────────────────────────────

export interface ParsedVideo {
  provider: VideoProvider;
  id: string;
  url: string;
  /** Minute de départ indiquée dans le lien (?t=…), en secondes. */
  start?: number;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** « 1h2m3s », « 125 », « 2:05 » → secondes. */
function startOf(v: string | null): number | undefined {
  if (!v) return undefined;
  const t = parseTime(v.replace(/s$/, '')) ?? (() => {
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(v);
    return m && (m[1] || m[2] || m[3]) ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : null;
  })();
  return t != null && t > 0 ? t : undefined;
}

/** Lien collé → plateforme et identifiant ; tout autre lien web devient un simple lien. null : pas un lien. */
export function parseVideoUrl(input: string): ParsedVideo | null {
  const raw = input.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.hostname.includes('.')) return null;
  const h = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  const start = startOf(u.searchParams.get('t') ?? u.searchParams.get('start') ?? (u.hash.startsWith('#t=') ? u.hash.slice(3) : null));
  const withStart = (p: ParsedVideo): ParsedVideo => (start ? { ...p, start } : p);
  if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
    let id = u.searchParams.get('v') ?? '';
    if (!id && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) id = parts[1] ?? '';
    if (YT_ID.test(id)) return withStart({ provider: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}` });
  }
  if (h === 'youtu.be' && YT_ID.test(parts[0] ?? '')) return withStart({ provider: 'youtube', id: parts[0], url: `https://www.youtube.com/watch?v=${parts[0]}` });
  if (h === 'vimeo.com' || h === 'player.vimeo.com') {
    const id = [...parts].reverse().find((p) => /^\d{1,12}$/.test(p));
    if (id) return withStart({ provider: 'vimeo', id, url: `https://vimeo.com/${id}` });
  }
  if (h === 'dailymotion.com' || h === 'dai.ly' || h === 'geo.dailymotion.com') {
    const id = h === 'dai.ly' ? parts[0] : parts[0] === 'video' || parts[0] === 'embed' ? (parts[0] === 'embed' ? parts[2] : parts[1]) : u.searchParams.get('video') ?? '';
    const clean = (id ?? '').split('_')[0];
    if (/^[A-Za-z0-9]{5,12}$/.test(clean)) return withStart({ provider: 'dailymotion', id: clean, url: `https://www.dailymotion.com/video/${clean}` });
  }
  return { provider: 'link', id: '', url: u.toString() };
}

/** Adresse du lecteur intégré (sans cookie publicitaire pour YouTube, sans suivi pour Vimeo). */
export function embedUrl(provider: VideoProvider, id: string, start = 0): string {
  const testHook = (window as unknown as { __mgVideoEmbed?: (p: string, id: string, start: number) => string }).__mgVideoEmbed;
  if (testHook) return testHook(provider, id, start);
  const s = Math.max(0, Math.floor(start));
  if (provider === 'youtube') {
    const q = new URLSearchParams({ enablejsapi: '1', origin: location.origin, rel: '0', playsinline: '1', modestbranding: '1', hl: 'fr', cc_lang_pref: 'fr' });
    if (s) q.set('start', String(s));
    return `https://www.youtube-nocookie.com/embed/${id}?${q}`;
  }
  if (provider === 'vimeo') return `https://player.vimeo.com/video/${id}?dnt=1&api=1${s ? `#t=${s}s` : ''}`;
  if (provider === 'dailymotion') return `https://www.dailymotion.com/embed/video/${id}?${s ? `start=${s}&` : ''}ui-start-screen-info=0`;
  return '';
}

// ── Temps ────────────────────────────────────────────────────

/** 754 → « 12:34 » ; 3754 → « 1:02:34 ». */
export function fmtTime(sec: number): string {
  const t = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Durée lisible : « 52 min », « 1 h 08 ». */
export function fmtDuration(sec: number | undefined): string {
  const t = Math.round(sec || 0);
  if (!t) return '';
  const h = Math.floor(t / 3600);
  const m = Math.round((t % 3600) / 60);
  if (!h) return `${Math.max(1, m)} min`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

/** « 12:34 », « 1:02:34 », « 754 » → secondes ; null si illisible. */
export function parseTime(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export const videoAnchor = (startMs: number, endMs: number): HtmlAnchor => ({ kind: 'html', chapter: 0, start: Math.max(0, Math.round(startMs)), end: Math.max(Math.round(startMs), Math.round(endMs)), prefix: '', suffix: '' });

/** Début d'un extrait de vidéo, en secondes. */
export const startOfExtract = (h: Highlight): number => (h.anchor.kind === 'html' ? h.anchor.start / 1000 : 0);

/** Ordre des extraits d'une vidéo : par minutage. */
export const byTime = (a: Highlight, b: Highlight) => startOfExtract(a) - startOfExtract(b) || a.createdAt - b.createdAt;

// ── Bibliothèque ─────────────────────────────────────────────

export function findVideoBook(p: { provider: VideoProvider; id: string; url: string }, books = useStore.getState().books): Book | null {
  return books.find((b) => isVideo(b) && b.video && (p.provider === 'link' ? b.video.provider === 'link' && b.video.url === p.url : b.video.provider === p.provider && b.video.id === p.id)) ?? null;
}

export interface VideoInput {
  provider: VideoProvider;
  id: string;
  url: string;
  title: string;
  author: string;
  duration?: number;
  cover?: string | null;
}

/** Ajoute une vidéo à la bibliothèque (et à l'espace d'où l'on vient, s'il y a lieu). */
export function addVideoBook(v: VideoInput, opts: { workspaceId?: string | null; groupId?: string | null } = {}): Book {
  const st = useStore.getState();
  const video: VideoInfo = { provider: v.provider, id: v.provider === 'link' ? '' : v.id, url: v.url, ...(v.duration ? { duration: Math.round(v.duration) } : {}) };
  const book: Book = {
    id: uid(),
    title: v.title.trim() || 'Vidéo sans titre',
    author: v.author.trim(),
    format: 'video',
    video,
    fileName: '',
    originalName: '',
    size: 0,
    addedAt: Date.now(),
    lastOpenedAt: null,
    progress: 0,
    position: null,
    cover: v.cover ?? null,
    edition: { publisher: v.provider === 'link' ? '' : PROVIDER_LABEL[v.provider], year: '', translator: '', place: '', pageOffset: 0 },
  };
  st.insert('books', book);
  if (opts.workspaceId && st.workspaces.some((w) => w.id === opts.workspaceId)) st.addToWorkspace(opts.workspaceId, opts.groupId ?? null, 'book', book.id);
  return book;
}

/** Retient où l'on en est (secondes) ; progression = position / durée. */
export function saveVideoPosition(bookId: string, position: number, duration?: number) {
  const b = useStore.getState().books.find((x) => x.id === bookId);
  if (!b?.video) return;
  const dur = duration && duration > 0 ? Math.round(duration) : b.video.duration;
  const pos = Math.max(0, Math.round(position));
  if (pos === b.video.position && dur === b.video.duration) return;
  const progress = dur ? Math.min(1, pos / dur) : b.progress;
  useStore.getState().updateBook(bookId, { video: { ...b.video, position: pos, ...(dur ? { duration: dur } : {}) }, progress: dur && dur - pos < 15 ? 1 : progress });
}

/** Avancement (0 à 1) d'une vidéo, d'après sa position et sa durée. */
export const videoProgress = (b: Book): number => (b.video?.duration ? Math.min(1, b.progress || (b.video.position ?? 0) / b.video.duration) : 0);

export function addVideoExtract(bookId: string, x: { text: string; start: number; end?: number; category?: CategoryId | null; note?: string }): Highlight {
  const note = (x.note ?? '').trim();
  const category = x.category ?? null;
  const start = Math.max(0, x.start);
  return useStore.getState().addHighlight({
    bookId,
    category,
    ...(category === null && !note ? { plain: true } : {}),
    text: x.text.replace(/\s+/g, ' ').trim(),
    note,
    noteKind: null,
    conceptIds: [],
    anchor: videoAnchor(start * 1000, (x.end ?? start) * 1000),
    locationLabel: fmtTime(start),
    printedPage: '',
  });
}

// ── Transcription ────────────────────────────────────────────

/** Une ligne de la transcription : début et fin (ms), texte. */
export interface TranscriptLine {
  s: number;
  e: number;
  t: string;
}

export const TRANSCRIPT_FILE = 'transcript.json';

/**
 * Répliques des sous-titres → lignes lisibles : on regroupe jusqu'à la fin d'une phrase (ou au plus
 * une vingtaine de secondes, ou environ deux lignes de texte), pour une transcription qu'on lit.
 */
export function groupCues(cues: VideoCue[]): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let cur: TranscriptLine | null = null;
  const sorted = [...cues].filter((c) => c.t.trim()).sort((a, b) => a.s - b.s);
  for (const c of sorted) {
    const end = c.s + (c.d || 2000);
    if (!cur) cur = { s: c.s, e: end, t: c.t.trim() };
    else {
      cur.t = `${cur.t} ${c.t.trim()}`.replace(/\s+/g, ' ');
      cur.e = Math.max(cur.e, end);
    }
    const sentenceEnd = /[.?!…»"]$/.test(cur.t) && cur.t.length > 40;
    if (sentenceEnd || cur.e - cur.s > 20000 || cur.t.length > 220) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  // La fin d'une ligne ne dépasse pas le début de la suivante.
  for (let i = 0; i < out.length - 1; i++) out[i].e = Math.min(out[i].e, out[i + 1].s);
  return out;
}

/** Transcriptions déjà lues (recherche ⌘K, page de la vidéo). */
const transcriptCache = new Map<string, TranscriptLine[] | null>();

export async function loadTranscript(bookId: string): Promise<TranscriptLine[] | null> {
  if (transcriptCache.has(bookId)) return transcriptCache.get(bookId) ?? null;
  const lines = await readTranscript(bookId);
  transcriptCache.set(bookId, lines);
  return lines;
}

async function readTranscript(bookId: string): Promise<TranscriptLine[] | null> {
  try {
    const raw = await host.readFile(bookId, TRANSCRIPT_FILE);
    const j = JSON.parse(new TextDecoder().decode(raw)) as { lines?: unknown };
    if (!Array.isArray(j.lines)) return null;
    return j.lines.filter((l): l is TranscriptLine => !!l && typeof l === 'object' && typeof (l as TranscriptLine).t === 'string' && Number.isFinite((l as TranscriptLine).s) && Number.isFinite((l as TranscriptLine).e));
  } catch {
    return null;
  }
}

async function saveTranscript(bookId: string, lines: TranscriptLine[], info: { lang: string; auto: boolean }) {
  const data = new TextEncoder().encode(JSON.stringify({ v: 1, ...info, lines }));
  await host.storeFile(bookId, TRANSCRIPT_FILE, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
}

export const videoOnline = () => useStore.getState().settings.videoOnline !== false;
export const videoNetAvailable = () => !!host.video;

/** Récupère les sous-titres (YouTube) et range la transcription avec la vidéo. */
export async function fetchTranscript(bookId: string): Promise<{ ok: boolean; error?: string; lines?: TranscriptLine[]; chapters?: number }> {
  const b = useStore.getState().books.find((x) => x.id === bookId);
  if (!b?.video) return { ok: false, error: 'Vidéo introuvable.' };
  if (b.video.provider !== 'youtube') return { ok: false, error: 'La transcription automatique n’existe que pour les vidéos YouTube.' };
  if (!host.video) return { ok: false, error: 'Disponible dans l’app de bureau.' };
  if (!videoOnline()) return { ok: false, error: 'Les vidéos en ligne sont désactivées dans les Réglages.' };
  const r = await host.video.transcript('youtube', b.video.id, 'fr').catch(() => null);
  // Chapitres (sommaire) : gardés même quand la vidéo n'a pas de sous-titres.
  const chapters = cleanChapters(r?.chapters);
  if (chapters.length) {
    const cur = useStore.getState().books.find((x) => x.id === bookId);
    if (cur?.video) useStore.getState().updateBook(bookId, { video: { ...cur.video, chapters, ...(!cur.video.duration && r?.duration ? { duration: r.duration } : {}) } });
  }
  if (!r || !r.ok || !r.cues?.length) return { ok: false, chapters: chapters.length, error: r?.error ?? 'Impossible de récupérer les sous-titres pour l’instant.' };
  const lines = groupCues(r.cues);
  await saveTranscript(bookId, lines, { lang: r.lang ?? 'fr', auto: !!r.auto });
  transcriptCache.set(bookId, lines);
  const cur = useStore.getState().books.find((x) => x.id === bookId);
  if (cur?.video) {
    const duration = cur.video.duration || r.duration || Math.ceil((lines[lines.length - 1]?.e ?? 0) / 1000) || undefined;
    useStore.getState().updateBook(bookId, { video: { ...cur.video, ...(duration ? { duration } : {}), transcript: { lang: r.lang ?? 'fr', auto: !!r.auto, at: Date.now() } } });
  }
  return { ok: true, lines, chapters: chapters.length };
}

/** Miniature de la plateforme → data: URL réduite (16:9, 480 px), rangée avec la vidéo. */
export async function fetchThumb(url: string | undefined): Promise<string | null> {
  if (!url || !host.video || !videoOnline()) return null;
  const data = await host.video.thumb(url).catch(() => null);
  if (!data) return null;
  try {
    const img = new Image();
    img.src = data;
    await img.decode();
    const w = 480;
    const h = 270;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return data;
    // Recadrage au centre en 16:9 (les miniatures ont parfois des bandes noires en 4:3).
    const r = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * r;
    const dh = img.naturalHeight * r;
    g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return c.toDataURL('image/jpeg', 0.82);
  } catch {
    return data.length < 400_000 ? data : null;
  }
}

/** Transmet le réglage « Vidéos en ligne » au processus principal (au lancement et à chaque changement). */
export function useVideoOnlineSync() {
  const ready = useStore((s) => s.ready);
  const on = useStore((s) => s.settings.videoOnline !== false);
  useEffect(() => {
    if (ready) void host.video?.setOnline(on).catch(() => undefined);
  }, [ready, on]);
}

/** Chapitres reçus : titres non vides, débuts croissants, au plus 200. */
export function cleanChapters(raw: unknown): { s: number; t: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { s: number; t: string }[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const s = Number((c as { s: unknown }).s);
    const t = typeof (c as { t: unknown }).t === 'string' ? (c as { t: string }).t.replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    if (!t || !Number.isFinite(s) || s < 0 || (out.length && s <= out[out.length - 1].s)) continue;
    out.push({ s: Math.round(s), t });
    if (out.length >= 200) break;
  }
  return out.length >= 2 ? out : [];
}

/** Chapitre en cours à un moment (secondes), ou null. */
export function chapterAt(chapters: { s: number; t: string }[] | undefined, sec: number): { i: number; s: number; t: string } | null {
  if (!chapters?.length) return null;
  let i = -1;
  for (let k = 0; k < chapters.length && chapters[k].s <= sec + 0.5; k++) i = k;
  return i < 0 ? null : { i, ...chapters[i] };
}

// ── Aller à un moment d'une vidéo (recherche dans les transcriptions) ──

export const useVideoSeek = create<{ req: { bookId: string; sec: number; nonce: number } | null }>(() => ({ req: null }));

/** Ouvre la vidéo et l'amène à ce moment (le lecteur y va dès qu'il répond). */
export function openVideoAt(bookId: string, sec: number) {
  useVideoSeek.setState({ req: { bookId, sec, nonce: Date.now() } });
  useStore.getState().openBook(bookId);
}

/** Toutes les transcriptions des vidéos de la bibliothèque, lues à la demande (recherche ⌘K). */
export function useTranscriptIndex(enabled: boolean): Map<string, TranscriptLine[]> {
  const ids = useStore(useShallow((s) => s.books.filter((b) => b.format === 'video' && b.video?.transcript).map((b) => b.id)));
  const [index, setIndex] = useState<Map<string, TranscriptLine[]>>(() => new Map());
  useEffect(() => {
    if (!enabled || !ids.length) return;
    let alive = true;
    void Promise.all(ids.map(async (id) => [id, await loadTranscript(id)] as const)).then((pairs) => {
      if (!alive) return;
      setIndex(new Map(pairs.filter((p): p is readonly [string, TranscriptLine[]] => !!p[1]).map(([id, l]) => [id, l])));
    });
    return () => {
      alive = false;
    };
  }, [enabled, ids]);
  return index;
}

/** Signets d'une vidéo : signet à ce moment (position et ancre en temps, comme un extrait). */
export function addVideoBookmark(bookId: string, sec: number, label: string, excerpt = '') {
  const b = useStore.getState().books.find((x) => x.id === bookId);
  const t = Math.max(0, Math.round(sec));
  return useStore.getState().addBookmark({
    bookId,
    position: { kind: 'html', chapter: 0, scroll: t },
    anchor: videoAnchor(t * 1000, t * 1000),
    locationLabel: fmtTime(t),
    progress: b?.video?.duration ? Math.min(1, t / b.video.duration) : undefined,
    excerpt: excerpt.slice(0, 160),
    label: label.trim() || `Signet à ${fmtTime(t)}`,
  });
}

/** Moment d'un signet de vidéo, en secondes. */
export const secondsOfBookmark = (bm: { anchor?: { kind: string; start?: number }; position: { kind: string; scroll?: number } }): number =>
  bm.anchor && bm.anchor.kind === 'html' && typeof bm.anchor.start === 'number' ? bm.anchor.start / 1000 : bm.position.kind === 'html' ? Number(bm.position.scroll) || 0 : 0;
