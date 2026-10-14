// Côté interface du correcteur : Web Worker chargé à la demande, dictionnaire personnel,
// fournisseur de relecture (« proofing provider ») pour SuperDoc.
// Le dictionnaire (.aff/.dic) est une ressource de l'app (copiée dans dist/assets par Vite) :
// aucune requête réseau.
import affAsset from '../../../../node_modules/dictionary-fr/index.aff?url';
import dicAsset from '../../../../node_modules/dictionary-fr/index.dic?url';
import type { Miss } from './core';
import type { SpellRequest, SpellResponse } from './protocol';

// ── Préférences (localStorage, tolérant aux erreurs) ──
const ENABLED_KEY = 'marginalia.ed.spellcheck';
const PERSONAL_KEY = 'marginalia.ed.spell.personal';

export function readSpellEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}
export function writeSpellEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
  } catch {
    /* indisponible */
  }
}
export function personalWords(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PERSONAL_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function savePersonal(words: string[]): void {
  try {
    localStorage.setItem(PERSONAL_KEY, JSON.stringify(words));
  } catch {
    /* indisponible : le mot reste ajouté pour la session */
  }
}

// ── Worker ──
export interface SpellTimings {
  /** Lecture des fichiers du dictionnaire (ms). */
  fetchMs: number;
  /** Analyse du dictionnaire par nspell (ms). */
  parseMs: number;
  /** Du lancement du worker à « prêt » (ms). */
  readyMs: number;
  /** Dernière vérification (ms, dans le worker) et nombre de paragraphes. */
  lastCheckMs: number;
  lastCheckSegments: number;
  lastSuggestMs: number;
}

type Pending = { resolve: (v: SpellResponse) => void; reject: (e: Error) => void };

class SpellClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private readyP: Promise<void> | null = null;
  readonly timings: SpellTimings = { fetchMs: 0, parseMs: 0, readyMs: 0, lastCheckMs: 0, lastCheckSegments: 0, lastSuggestMs: 0 };
  /** Mots ignorés pour la session (« Ignorer »), toutes fenêtres d'édition confondues. */
  readonly ignored = new Set<string>();
  /** Résultats par texte de paragraphe (vidé quand le dictionnaire personnel change). */
  readonly cache = new Map<string, Miss[]>();

  ready(): Promise<void> {
    if (this.readyP) return this.readyP;
    const t0 = performance.now();
    this.readyP = new Promise<void>((resolve, reject) => {
      let w: Worker;
      try {
        w = new Worker(new URL('./spell.worker.ts', import.meta.url), { type: 'module', name: 'correcteur' });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      this.worker = w;
      w.onmessage = (ev: MessageEvent<SpellResponse>) => {
        const m = ev.data;
        if (m.type === 'ready') {
          Object.assign(this.timings, { fetchMs: m.fetchMs, parseMs: m.parseMs, readyMs: Math.round(performance.now() - t0) });
          resolve();
        } else if (m.type === 'failed') reject(new Error(m.error));
        else {
          const p = this.pending.get(m.id);
          if (!p) return;
          this.pending.delete(m.id);
          if (m.type === 'error') p.reject(new Error(m.error));
          else p.resolve(m);
        }
      };
      w.onerror = (e) => reject(new Error(e.message || 'Correcteur indisponible'));
      const abs = (u: string) => new URL(u, document.baseURI).href;
      this.post({ type: 'init', affUrl: abs(affAsset), dicUrl: abs(dicAsset), personal: personalWords() });
    });
    this.readyP.catch(() => {
      // nouvel essai possible plus tard
      this.worker?.terminate();
      this.worker = null;
      this.readyP = null;
    });
    return this.readyP;
  }

  private users = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Un éditeur utilise le correcteur. */
  retain(): void {
    this.users++;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
  /** Plus d'éditeur : le worker (≈ 300 Mo une fois le dictionnaire analysé) est arrêté après 5 min. */
  release(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users > 0 || !this.worker) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.users > 0) return;
      this.worker?.terminate();
      this.worker = null;
      this.readyP = null;
      for (const p of this.pending.values()) p.reject(new Error('Correcteur arrêté'));
      this.pending.clear();
    }, 5 * 60_000);
  }

  private post(m: SpellRequest) {
    this.worker?.postMessage(m);
  }

  private call(m: { type: 'check'; segments: { id: string; text: string }[] } | { type: 'suggest'; word: string; max: number }): Promise<SpellResponse> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ ...m, id } as SpellRequest);
    });
  }

  async check(segments: { id: string; text: string }[]) {
    await this.ready();
    const r = await this.call({ type: 'check', segments });
    if (r.type !== 'checked') return [];
    this.timings.lastCheckMs = Math.round(r.ms * 10) / 10;
    this.timings.lastCheckSegments = segments.length;
    return r.results;
  }

  async suggest(word: string, max = 5): Promise<string[]> {
    await this.ready();
    const r = await this.call({ type: 'suggest', word, max });
    if (r.type !== 'suggested') return [];
    this.timings.lastSuggestMs = Math.round(r.ms);
    return r.suggestions;
  }

  /** Ajoute `word` au dictionnaire personnel (persistant). */
  addToDictionary(word: string): void {
    const list = personalWords();
    if (!list.includes(word)) {
      list.push(word);
      savePersonal(list);
    }
    this.cache.clear();
    this.post({ type: 'add', word });
  }
}

let client: SpellClient | null = null;
/** Client unique (le dictionnaire n'est chargé qu'une fois par session). */
export function spellClient(): SpellClient {
  client ??= new SpellClient();
  return client;
}

// ── Fournisseur pour SuperDoc (contrat ProofingProvider de SuperDoc 1.47) ──
interface ProofingSegment {
  id: string;
  text: string;
}
export interface ProofingIssue {
  segmentId: string;
  start: number;
  end: number;
  kind: 'spelling';
  message?: string;
}

export function createSpellProvider() {
  const c = spellClient();
  return {
    id: 'marginalia-nspell-fr',
    getCapabilities: () => ({ issueKinds: ['spelling'], supportsSuggestions: true, supportsMultipleLanguages: false, supportsBatching: true, requiresNetwork: false }),
    async check(req: { segments: ProofingSegment[]; signal?: AbortSignal }): Promise<{ issues: ProofingIssue[] }> {
      // Paragraphes déjà vérifiés (texte identique) : réponse immédiate depuis le cache ;
      // seuls les paragraphes nouveaux ou modifiés partent au worker.
      const issues: ProofingIssue[] = [];
      const push = (id: string, misses: Miss[]) => {
        for (const m of misses) issues.push({ segmentId: id, start: m.start, end: m.end, kind: 'spelling', message: m.word });
      };
      const todo: { id: string; text: string }[] = [];
      for (const s of req.segments) {
        const hit = c.cache.get(s.text);
        if (hit) push(s.id, hit);
        else todo.push({ id: s.id, text: s.text });
      }
      if (todo.length) {
        const results = await c.check(todo);
        if (req.signal?.aborted) return { issues: [] };
        const texts = new Map(todo.map((t) => [t.id, t.text]));
        if (c.cache.size > 20000) c.cache.clear();
        for (const r of results) {
          c.cache.set(texts.get(r.id) ?? '', r.misses);
          push(r.id, r.misses);
        }
      }
      return { issues };
    },
  };
}

/** Configuration `proofing` de SuperDoc. */
export function spellProofingConfig(onStatus?: (s: string) => void) {
  const c = spellClient();
  return {
    enabled: true,
    provider: createSpellProvider(),
    defaultLanguage: 'fr-FR',
    debounceMs: 400,
    maxSuggestions: 5,
    visibleFirst: true,
    allowIgnoreWord: true,
    ignoredWords: [...c.ignored],
    // premier appel : le dictionnaire se charge (≈ 5 s)
    timeoutMs: 60000,
    onStatusChange: onStatus,
    onProofingError: (e: { message?: string }) => console.warn('[correcteur]', e?.message ?? e),
  };
}
