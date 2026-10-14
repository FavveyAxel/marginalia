// Reconnaissance de texte (OCR) locale et hors ligne : tesseract.js 7.0.0 (Apache-2.0),
// cœur WebAssembly et modèles fra + eng embarqués dans public/ocr/ (aucun CDN).
// Le résultat (mots + boîtes normalisées) est mis en cache dans la bibliothèque, à côté du
// fichier source : library/<id>/ocr.json. Il n'est jamais recalculé sans demande explicite.
import type { Worker } from 'tesseract.js';
import { host } from '../../../lib/platform';

export const OCR_FILE = 'ocr.json';
export const OCR_LANGS = 'fra+eng';
const ENGINE = 'tesseract.js 7.0.0';
/** Côté le plus long envoyé à l'OCR : au-delà, le gain de précision ne vaut pas le temps. */
const MAX_SIDE = 3400;

/** Mot reconnu ; coordonnées normalisées (0..1) dans l'image affichée. */
export interface OcrWord {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Confiance 0-100. */
  c: number;
}
export interface OcrLine {
  words: OcrWord[];
}
export interface OcrPara {
  lines: OcrLine[];
}
export interface OcrData {
  v: 1;
  engine: string;
  langs: string;
  /** Dimensions de l'image analysée (px). */
  width: number;
  height: number;
  paras: OcrPara[];
  /** Confiance moyenne des mots (0-100). */
  confidence: number;
  /** Durée de la reconnaissance (ms). */
  ms: number;
  createdAt: number;
  /** Date de la dernière correction manuelle. */
  editedAt?: number;
}

export interface OcrProgress {
  /** 0..1 */
  value: number;
  label: string;
}

const round = (v: number) => Math.round(v * 100000) / 100000;

export async function loadOcr(bookId: string): Promise<OcrData | null> {
  try {
    const buf = await host.readFile(bookId, OCR_FILE);
    const data = JSON.parse(new TextDecoder().decode(buf)) as OcrData;
    return data && data.v === 1 && Array.isArray(data.paras) ? data : null;
  } catch {
    return null;
  }
}

export async function saveOcr(bookId: string, data: OcrData): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  await host.storeFile(bookId, OCR_FILE, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

export const allWords = (d: OcrData | null): OcrWord[] => (d ? d.paras.flatMap((p) => p.lines.flatMap((l) => l.words)) : []);

export function averageConfidence(paras: OcrPara[]): number {
  const ws = paras.flatMap((p) => p.lines.flatMap((l) => l.words));
  return ws.length ? Math.round(ws.reduce((n, w) => n + w.c, 0) / ws.length) : 0;
}

const asset = (rel: string) => new URL(rel, document.baseURI).href;

const STEPS: Record<string, [number, number, string]> = {
  'loading tesseract core': [0, 0.08, 'Préparation de la reconnaissance'],
  'initializing tesseract': [0.08, 0.1, 'Préparation de la reconnaissance'],
  'loading language traineddata': [0.1, 0.18, 'Préparation de la reconnaissance'],
  'initializing api': [0.18, 0.22, 'Préparation de la reconnaissance'],
  'recognizing text': [0.22, 1, 'Reconnaissance du texte'],
};

/**
 * Reconnaît le texte d'une image. `signal` interrompt le travail (le worker est arrêté).
 * Ne lève jamais pour une image sans texte : renvoie simplement aucun mot.
 */
export async function recognize(source: ImageBitmap, onProgress: (p: OcrProgress) => void, signal?: AbortSignal): Promise<OcrData> {
  const t0 = performance.now();
  const k = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  const W = Math.max(1, Math.round(source.width * k));
  const H = Math.max(1, Math.round(source.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, W, H);

  let worker: Worker | null = null;
  const abort = () => void worker?.terminate().catch(() => undefined);
  signal?.addEventListener('abort', abort);
  try {
    onProgress({ value: 0, label: 'Préparation de la reconnaissance' });
    // Chargé à la première image seulement (hors du paquet principal de l'app).
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker(OCR_LANGS, 1 /* OEM.LSTM_ONLY */, {
      workerPath: asset('ocr/worker.min.js'),
      corePath: asset('ocr/tesseract-core-simd-lstm.wasm.js'),
      langPath: asset('ocr/lang'),
      gzip: true,
      cacheMethod: 'none',
      // Worker chargé directement depuis son URL (pas de Blob) : compatible avec le schéma app://.
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        const s = STEPS[m.status];
        if (s) onProgress({ value: s[0] + (s[1] - s[0]) * (m.progress || 0), label: s[2] });
      },
    });
    if (signal?.aborted) throw new DOMException('Interrompu', 'AbortError');
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
    if (signal?.aborted) throw new DOMException('Interrompu', 'AbortError');
    const paras: OcrPara[] = [];
    for (const b of data.blocks ?? []) {
      for (const p of b.paragraphs) {
        const lines: OcrLine[] = [];
        for (const l of p.lines) {
          const words: OcrWord[] = [];
          for (const w of l.words) {
            const t = w.text.trim();
            if (!t) continue;
            // Bruit typique d'une photo (taches lues comme « | », « — »…) : faible confiance et pas de lettre.
            // Les points de conduite ou filets (« ……… », « ---- ») ne sont jamais du texte à citer.
            if (!/[\p{L}\p{N}]/u.test(t) && (w.confidence < 60 || t.length > 3)) continue;
            words.push({
              t,
              x: round(w.bbox.x0 / W),
              y: round(w.bbox.y0 / H),
              w: round((w.bbox.x1 - w.bbox.x0) / W),
              h: round((w.bbox.y1 - w.bbox.y0) / H),
              c: Math.round(w.confidence),
            });
          }
          if (words.length) lines.push({ words });
        }
        if (lines.length) paras.push({ lines });
      }
    }
    onProgress({ value: 1, label: 'Reconnaissance du texte' });
    return {
      v: 1,
      engine: ENGINE,
      langs: OCR_LANGS,
      width: W,
      height: H,
      paras,
      confidence: averageConfidence(paras),
      ms: Math.round(performance.now() - t0),
      createdAt: Date.now(),
    };
  } finally {
    signal?.removeEventListener('abort', abort);
    if (worker) await worker.terminate().catch(() => undefined);
  }
}

// ── Travaux en cours (un seul par image) ─────────────────────
// Une reconnaissance appartient à l'image, pas au volet qui l'a lancée : deux volets sur la même
// image la partagent, et fermer le lecteur ne la perd pas (rouvrir l'image reprend la progression
// au lieu de tout recommencer). Le résultat est enregistré par le travail lui-même.

export interface OcrJob {
  readonly bookId: string;
  readonly promise: Promise<OcrData>;
  /** Dernière progression connue. */
  progress: OcrProgress;
  subscribe(fn: (p: OcrProgress) => void): () => void;
  cancel(): void;
}

const jobs = new Map<string, OcrJob>();

export const runningOcr = (bookId: string): OcrJob | null => jobs.get(bookId) ?? null;

/**
 * Lance (ou rejoint) la reconnaissance d'une image. `keep()` est consulté avant l'enregistrement :
 * faux si le document a été supprimé entre-temps (rien n'est alors écrit dans la bibliothèque).
 * `restart` : interrompt un travail en cours et recommence (« Relancer la reconnaissance »).
 */
export function startOcr(bookId: string, source: ImageBitmap, keep: () => boolean, restart = false): OcrJob {
  const cur = jobs.get(bookId);
  if (cur && !restart) return cur;
  cur?.cancel();
  const ac = new AbortController();
  const listeners = new Set<(p: OcrProgress) => void>();
  const job: OcrJob = {
    bookId,
    progress: { value: 0, label: 'Préparation de la reconnaissance' },
    promise: null as unknown as Promise<OcrData>,
    subscribe(fn) {
      listeners.add(fn);
      fn(job.progress);
      return () => listeners.delete(fn);
    },
    cancel() {
      ac.abort();
      if (jobs.get(bookId) === job) jobs.delete(bookId);
    },
  };
  (job as { promise: Promise<OcrData> }).promise = (async () => {
    try {
      const data = await recognize(
        source,
        (p) => {
          job.progress = p;
          listeners.forEach((fn) => fn(p));
        },
        ac.signal,
      );
      if (ac.signal.aborted) throw new DOMException('Interrompu', 'AbortError');
      if (keep()) await saveOcr(bookId, data).catch((e) => console.warn('[image] cache OCR', e));
      return data;
    } finally {
      if (jobs.get(bookId) === job) jobs.delete(bookId);
    }
  })();
  // Personne n'attend forcément le résultat (lecteur fermé) : pas de rejet non géré.
  job.promise.catch(() => undefined);
  jobs.set(bookId, job);
  return job;
}

/**
 * Remplace le texte d'une ligne corrigée à la main. Les boîtes sont conservées quand le nombre
 * de mots est inchangé ; sinon la boîte de la ligne est répartie au prorata des longueurs.
 */
export function editLine(line: OcrLine, text: string): OcrLine {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { words: [] };
  if (parts.length === line.words.length) return { words: line.words.map((w, i) => ({ ...w, t: parts[i], c: w.t === parts[i] ? w.c : 100 })) };
  const x0 = Math.min(...line.words.map((w) => w.x));
  const x1 = Math.max(...line.words.map((w) => w.x + w.w));
  const y0 = Math.min(...line.words.map((w) => w.y));
  const y1 = Math.max(...line.words.map((w) => w.y + w.h));
  const total = parts.reduce((n, p) => n + p.length, 0) + (parts.length - 1);
  const unit = (x1 - x0) / Math.max(1, total);
  let x = x0;
  return {
    words: parts.map((t) => {
      const w: OcrWord = { t, x: round(x), y: y0, w: round(t.length * unit), h: round(y1 - y0), c: 100 };
      x += (t.length + 1) * unit;
      return w;
    }),
  };
}
