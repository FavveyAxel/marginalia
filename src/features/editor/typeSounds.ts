// Sons de la machine à écrire (focus.tsx) : frappes, espace, retour arrière, clochette, retour
// chariot. Enregistrements CC0 embarqués dans l'app (typewriter/README.md) : rien ne vient du réseau.
const URLS = import.meta.glob('./typewriter/*.wav', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export type TypeSound = 'key' | 'space' | 'back' | 'return' | 'bell';

export interface TypeSounds {
  /** Joue un son (`delay` en secondes). Sans effet tant que les fichiers ne sont pas décodés. */
  play(kind: TypeSound, delay?: number): void;
  setVolume(v: number): void;
  dispose(): void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** Niveau et hauteur de chaque frappe : jamais deux fois exactement le même son. */
const VARY: Record<TypeSound, { gain: [number, number]; rate: [number, number] }> = {
  key: { gain: [0.8, 1], rate: [0.97, 1.03] },
  space: { gain: [0.75, 1], rate: [0.95, 1.05] },
  back: { gain: [0.85, 1], rate: [0.97, 1.03] },
  return: { gain: [0.9, 1], rate: [0.98, 1.02] },
  bell: { gain: [0.9, 1], rate: [1, 1] },
};

export function createTypeSounds(volume: number): TypeSounds | null {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctx({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);

  const bank: Record<TypeSound, AudioBuffer[]> = { key: [], space: [], back: [], return: [], bell: [] };
  let closed = false;
  for (const [path, url] of Object.entries(URLS)) {
    const kind = /\/([a-z]+)\d*\.wav$/.exec(path)?.[1] as TypeSound | undefined;
    if (!kind || !(kind in bank)) continue;
    void fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => {
        if (!closed) bank[kind].push(buf);
      })
      .catch(() => {
        /* fichier illisible : ce son manque, les autres jouent */
      });
  }

  const last: Partial<Record<TypeSound, AudioBuffer>> = {};
  let bell: AudioBufferSourceNode | null = null;
  return {
    play(kind, delay = 0) {
      if (closed) return;
      (window as unknown as { __twLog?: string[] }).__twLog?.push(kind);
      const list = bank[kind];
      if (!list.length) return;
      if (ctx.state === 'suspended') void ctx.resume();
      const pool = list.length > 1 ? list.filter((b) => b !== last[kind]) : list;
      const buf = pool[Math.floor(Math.random() * pool.length)];
      last[kind] = buf;
      const v = VARY[kind];
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rand(v.rate[0], v.rate[1]);
      const g = ctx.createGain();
      g.gain.value = rand(v.gain[0], v.gain[1]);
      src.connect(g).connect(master);
      if (kind === 'bell') {
        // une seule clochette à la fois
        try {
          bell?.stop();
        } catch {
          /* déjà finie */
        }
        bell = src;
      }
      src.start(ctx.currentTime + delay);
    },
    setVolume(v) {
      master.gain.value = Math.max(0, Math.min(1, v));
    },
    dispose() {
      closed = true;
      void ctx.close().catch(() => {});
    },
  };
}
