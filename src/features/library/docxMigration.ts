// Les documents Word et Markdown importés autrefois comme « livres » deviennent des écrits (une seule fois).
// Seuls ceux sans extrait sont convertis ; le livre d'origine part à la corbeille (récupérable 30 jours),
// et ses places dans les espaces de travail sont reprises par l'écrit.
import { useEffect } from 'react';
import { useStore } from '../../lib/store';
import { host } from '../../lib/platform';

let done = false;

export async function migrateDocxBooks(): Promise<number> {
  const s = useStore.getState();
  if (s.settings.docxMigrated) return 0;
  const withHl = new Set(s.highlights.map((h) => h.bookId));
  const todo = s.books.filter((b) => (b.format === 'docx' || b.format === 'md') && !withHl.has(b.id));
  const { draftOptionsFromFile } = await import('../../lib/draftImport');
  const { createDraft } = await import('../editor/api');
  let n = 0;
  for (const b of todo) {
    try {
      const data = await host.readFile(b.id, b.fileName);
      const opts = await draftOptionsFromFile(b.originalName || b.fileName, data);
      const d = await createDraft({ ...opts, title: b.title || opts.title });
      const st = useStore.getState();
      st.patch('drafts', d.id, { createdAt: b.addedAt, updatedAt: b.lastOpenedAt ?? b.addedAt });
      for (const it of st.wsItems) if (it.kind === 'book' && it.refId === b.id) st.patch('wsItems', it.id, { kind: 'draft', refId: d.id });
      useStore.getState().trashDelete('book', b.id, { silent: true });
      n++;
    } catch (e) {
      console.error('Conversion en écrit impossible :', b.originalName, e);
    }
  }
  useStore.getState().updateSettings({ docxMigrated: true });
  if (n)
    useStore.getState().toast(n === 1 ? '1 document (Word ou Markdown) rangé dans tes écrits' : `${n} documents Word et Markdown rangés dans tes écrits`, 'success', {
      label: 'Voir',
      run: () => useStore.getState().navigate({ name: 'write', draftId: null }),
    });
  return n;
}

export function useDocxMigration() {
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    if (!ready || done) return;
    done = true;
    void migrateDocxBooks().catch((e) => console.error(e));
  }, [ready]);
}
