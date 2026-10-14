/// <reference lib="webworker" />
// Web Worker du correcteur : charge le dictionnaire français (≈ 1,4 Mo, analyse ≈ 5 s)
// hors du fil de l'interface, puis vérifie les paragraphes et calcule les suggestions.
// Aucune requête réseau : les fichiers .aff/.dic sont des ressources de l'app (app://, dist/assets).
import nspell from 'nspell';
import { Checker } from './core';
import { PHILO_LEXICON } from './lexicon';
import type { SpellRequest, SpellResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let checker: Checker | null = null;
let failed: string | null = null;
let loading: Promise<void> | null = null;

const post = (m: SpellResponse) => self.postMessage(m);

async function load(affUrl: string, dicUrl: string, personal: string[]): Promise<void> {
  const t0 = performance.now();
  const [aff, dic] = await Promise.all(
    [affUrl, dicUrl].map(async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`Dictionnaire introuvable (${r.status})`);
      return r.text();
    }),
  );
  const t1 = performance.now();
  const sp = nspell({ aff, dic });
  for (const w of PHILO_LEXICON) sp.add(w);
  for (const w of personal) sp.add(w);
  checker = new Checker(sp);
  post({ type: 'ready', fetchMs: Math.round(t1 - t0), parseMs: Math.round(performance.now() - t1) });
}

self.onmessage = async (ev: MessageEvent<SpellRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    loading ??= load(msg.affUrl, msg.dicUrl, msg.personal).catch((e) => {
      failed = e instanceof Error ? e.message : String(e);
      post({ type: 'failed', error: failed });
    });
    return;
  }
  await loading;
  if (!checker) {
    if ('id' in msg) post({ type: 'error', id: msg.id, error: failed ?? 'Correcteur indisponible' });
    return;
  }
  if (msg.type === 'check') {
    const t0 = performance.now();
    const results = msg.segments.map((s) => ({ id: s.id, misses: checker!.checkText(s.text) }));
    post({ type: 'checked', id: msg.id, results, ms: performance.now() - t0 });
  } else if (msg.type === 'suggest') {
    const t0 = performance.now();
    const suggestions = checker.suggest(msg.word, msg.max);
    post({ type: 'suggested', id: msg.id, suggestions, ms: performance.now() - t0 });
  } else if (msg.type === 'add') {
    checker.add(msg.word);
  }
};
