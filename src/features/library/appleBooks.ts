// ─────────────────────────────────────────────────────────────
// Synchronisation avec l'app Livres d'Apple.
// Les livres ajoutés sur l'iPhone arrivent sur le Mac par iCloud Drive (dossier de Livres) ;
// Marginalia lit ce dossier local et importe les EPUB/PDF sans DRM qu'il n'a pas encore vus.
// Aucune requête réseau de notre côté : c'est macOS qui synchronise iCloud.
// ─────────────────────────────────────────────────────────────
import { useEffect } from 'react';
import { useStore } from '../../lib/store';
import { host, type AppleBook } from '../../lib/platform';

export const appleBooksAvailable = () => !!(host.appleBooksScan && host.appleBooksRead);

/** Échecs de lecture de cette session (on ne réessaie pas à chaque retour au premier plan). */
const failed = new Set<string>();
let running: Promise<number> | null = null;

function markSeen(names: Iterable<string>) {
  const s = useStore.getState();
  const seen = new Set(s.settings.appleBooksSeen ?? []);
  let changed = false;
  for (const n of names) if (!seen.has(n)) (seen.add(n), (changed = true));
  if (changed) s.updateSettings({ appleBooksSeen: [...seen] });
}

/** Importe une liste de livres de Livres, un par un ; renvoie le nombre de livres importés. */
export async function importAppleBooks(list: AppleBook[], onProgress?: (done: number, total: number) => void, toWorkspace = true): Promise<number> {
  let n = 0;
  let done = 0;
  for (const b of list) {
    try {
      const file = await host.appleBooksRead!(b.path);
      const books = await useStore.getState().importFiles([file], { toWorkspace });
      if (books.length) n++;
      markSeen([b.name]);
    } catch (e) {
      console.error('Livres :', b.name, e);
      failed.add(b.name);
    }
    onProgress?.(++done, list.length);
  }
  return n;
}

/** Une passe de synchronisation automatique (sans effet si elle est désactivée). */
export function syncAppleBooks(): Promise<number> {
  if (running) return running;
  running = (async () => {
    const s = useStore.getState();
    if (!appleBooksAvailable() || !s.settings.appleBooksSync) return 0;
    const list = await host.appleBooksScan!();
    const seen = new Set(s.settings.appleBooksSeen ?? []);
    const inLibrary = new Set(useStore.getState().books.map((b) => b.originalName));
    const fresh = list.filter((b) => !b.drm && !b.pending && !seen.has(b.name) && !failed.has(b.name));
    markSeen(fresh.filter((b) => inLibrary.has(b.name)).map((b) => b.name));
    const todo = fresh.filter((b) => !inLibrary.has(b.name));
    if (!todo.length) return 0;
    const n = await importAppleBooks(todo, undefined, false);
    if (n) useStore.getState().toast(n === 1 ? '1 livre ajouté depuis Livres' : `${n} livres ajoutés depuis Livres`, 'success');
    return n;
  })().finally(() => (running = null));
  return running;
}

/** Synchro au lancement, à chaque changement du dossier de Livres et au retour sur l'app. */
export function useAppleBooksSync() {
  const ready = useStore((s) => s.ready);
  const enabled = useStore((s) => !!s.settings.appleBooksSync);
  useEffect(() => {
    if (!ready || !enabled || !appleBooksAvailable()) return;
    const run = () => void syncAppleBooks().catch((e) => console.error(e));
    run();
    void host.appleBooksWatch?.();
    const off = host.onAppleBooksChanged?.(run);
    let last = Date.now();
    const onFocus = () => {
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      run();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      off?.();
      window.removeEventListener('focus', onFocus);
    };
  }, [ready, enabled]);
}
