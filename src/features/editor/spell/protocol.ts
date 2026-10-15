// Messages échangés avec le Web Worker du correcteur.
import type { Miss } from './core';

export type SpellRequest =
  | { type: 'init'; affUrl: string; dicUrl: string; personal: string[] }
  | { type: 'check'; id: number; segments: { id: string; text: string }[]; ignoreProper: boolean }
  | { type: 'suggest'; id: number; word: string; max: number }
  | { type: 'add'; word: string };

export type SpellResponse =
  | { type: 'ready'; fetchMs: number; parseMs: number }
  | { type: 'failed'; error: string }
  | { type: 'error'; id: number; error: string }
  | { type: 'checked'; id: number; results: { id: string; misses: Miss[] }[]; ms: number; epoch: number }
  | { type: 'suggested'; id: number; suggestions: string[]; ms: number };
