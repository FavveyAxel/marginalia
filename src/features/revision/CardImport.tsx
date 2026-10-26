// Import de plusieurs cartes depuis Excel (.xlsx) ou .csv, avec un modèle à remplir (cardImport.ts).
// Aperçu avant création : nombre de cartes, lignes incomplètes, doublons, livres non trouvés.
import { useRef, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { uid, useStore } from '../../lib/store';
import { host } from '../../lib/platform';
import type { Book, ReviewCard } from '../../lib/types';
import { Modal } from '../workspaces/wsUi';
import { newFsrs } from './fsrs';
import { parseCardFile, templateXlsx, type ImportedCard, type ParsedCards } from './cardImport';

const norm = (s: string) =>
  s
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const plural = (n: number, one: string, many = one + 's') => `${n} ${n > 1 ? many : one}`;
const lines = (l: number[]) => (l.length > 6 ? `${l.slice(0, 6).join(', ')}…` : l.join(', '));

/** Livre de la colonne « Livre » : titre exact (sans accents ni casse), sinon début du titre. */
function matchBook(books: Book[], name: string): Book | null {
  const n = norm(name);
  if (!n) return null;
  return books.find((b) => norm(b.title) === n) ?? books.find((b) => norm(b.title).startsWith(n) || n.startsWith(norm(b.title))) ?? null;
}

interface Plan {
  file: string;
  parsed: ParsedCards;
  fresh: (ImportedCard & { bookId: string | null })[];
  duplicates: number;
  unknownBooks: string[];
}

export function CardImport() {
  const input = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [fallbackBook, setFallbackBook] = useState('');
  const books = useStore((s) => s.books);
  const toast = useStore((s) => s.toast);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = await parseCardFile(f.name, await f.arrayBuffer());
      const s = useStore.getState();
      const have = new Set(s.cards.map((c) => `${norm(c.front)}\u0000${norm(c.back)}`));
      const seen = new Set<string>();
      let duplicates = 0;
      const unknown = new Set<string>();
      const fresh: Plan['fresh'] = [];
      for (const c of parsed.cards) {
        const key = `${norm(c.front)}\u0000${norm(c.back)}`;
        if (have.has(key) || seen.has(key)) {
          duplicates++;
          continue;
        }
        seen.add(key);
        const b = matchBook(s.books, c.book);
        if (c.book && !b) unknown.add(c.book);
        fresh.push({ ...c, bookId: b?.id ?? null });
      }
      if (!parsed.cards.length && !parsed.incomplete.length) {
        toast('Le fichier est vide : remplissez les colonnes Question et Réponse du modèle.', 'info');
        return;
      }
      setFallbackBook('');
      setPlan({ file: f.name, parsed, fresh, duplicates, unknownBooks: [...unknown] });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ce fichier n’a pas pu être lu.', 'error');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const create = () => {
    if (!plan?.fresh.length) return;
    const now = Date.now();
    const made: ReviewCard[] = plan.fresh.map((c, i) => ({
      id: uid(),
      kind: 'libre',
      front: c.front,
      back: c.back,
      highlightId: null,
      conceptId: null,
      bookId: c.bookId ?? (fallbackBook || null),
      suspended: false,
      fsrs: newFsrs(),
      createdAt: now + i, // ordre du fichier conservé
    }));
    const ids = new Set(made.map((c) => c.id));
    // Une seule transaction : un seul ⌘Z retire tout l'import.
    useStore.setState((s) => ({ cards: [...s.cards, ...made] }));
    setPlan(null);
    toast(`${plural(made.length, 'carte créée', 'cartes créées')}`, 'success', {
      label: 'Annuler',
      run: () => useStore.setState((s) => ({ cards: s.cards.filter((c) => !ids.has(c.id)) })),
    });
  };

  const saveTemplate = async () => {
    try {
      const path = await host.saveBinary('Modèle cartes de révision.xlsx', await templateXlsx(), 'xlsx');
      if (path) toast('Modèle enregistré : remplissez une question et sa réponse par ligne, puis importez-le.', 'success');
    } catch {
      toast('Le modèle n’a pas pu être enregistré.', 'error');
    }
  };

  const p = plan;
  const noBook = p ? p.fresh.filter((c) => !c.bookId).length : 0;
  return (
    <div className="rev-import" data-testid="card-import">
      <span className="muted">Plusieurs cartes d’un coup :</span>
      <button className="btn btn-ghost btn-sm" onClick={() => input.current?.click()} data-act="import-cards">
        <FileSpreadsheet size={14} /> Importer depuis Excel ou .csv…
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => void saveTemplate()} data-act="card-template">
        <Download size={14} /> Télécharger le modèle
      </button>
      <input ref={input} type="file" hidden accept=".xlsx,.csv,.tsv,.txt" onChange={(e) => void onFile(e.target.files?.[0])} />

      {p && (
        <Modal title="Importer des cartes" onClose={() => setPlan(null)} wide>
          <div className="rev-import-dlg" data-testid="card-import-preview">
            <h3>Importer des cartes</h3>
            <p className="muted">
              {p.file} : {p.fresh.length ? plural(p.fresh.length, 'carte prête', 'cartes prêtes') : 'aucune nouvelle carte'}.
            </p>
            {(p.parsed.incomplete.length > 0 || p.duplicates > 0 || p.unknownBooks.length > 0 || !p.parsed.header) && (
              <ul className="rev-import-notes">
                {!p.parsed.header && <li>Pas de titres « Question » et « Réponse » en 1re ligne : colonne A = question, B = réponse, C = livre.</li>}
                {p.parsed.incomplete.length > 0 && (
                  <li>
                    {plural(p.parsed.incomplete.length, 'ligne ignorée', 'lignes ignorées')} (question ou réponse vide) : ligne{p.parsed.incomplete.length > 1 ? 's' : ''} {lines(p.parsed.incomplete)}.
                  </li>
                )}
                {p.duplicates > 0 && <li>{plural(p.duplicates, 'carte déjà présente', 'cartes déjà présentes')}, non recréée{p.duplicates > 1 ? 's' : ''}.</li>}
                {p.unknownBooks.length > 0 && <li>Livre introuvable dans la bibliothèque : {p.unknownBooks.slice(0, 3).map((b) => `« ${b} »`).join(', ')}{p.unknownBooks.length > 3 ? '…' : ''}. Ces cartes seront sans livre (ou avec celui choisi ci-dessous).</li>}
              </ul>
            )}
            {p.fresh.length > 0 && (
              <ol className="rev-import-list">
                {p.fresh.slice(0, 6).map((c) => (
                  <li key={c.line}>
                    <span className="q">{c.front}</span>
                    <span className="a muted">{c.back}</span>
                  </li>
                ))}
                {p.fresh.length > 6 && <li className="more muted">et {plural(p.fresh.length - 6, 'autre carte', 'autres cartes')}</li>}
              </ol>
            )}
            {p.fresh.length > 0 && noBook > 0 && books.length > 0 && (
              <label className="rev-import-book">
                <span>{noBook === p.fresh.length ? 'Livre associé' : `Livre pour les ${plural(noBook, 'carte', 'cartes')} sans livre`}</span>
                <select className="input rev-select" value={fallbackBook} onChange={(e) => setFallbackBook(e.target.value)}>
                  <option value="">Sans livre associé</option>
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="rev-import-actions">
              <button className="btn btn-ghost" onClick={() => setPlan(null)}>
                Annuler
              </button>
              <button className="btn btn-primary" disabled={!p.fresh.length} onClick={create} data-act="import-confirm">
                {p.fresh.length ? `Créer ${plural(p.fresh.length, 'carte', 'cartes')}` : 'Rien à créer'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
