// Générateur de cartes : l'utilisateur choisit un livre ou un concept, coche des extraits, relit et valide chaque carte.
import { useMemo, useState, type CSSProperties } from 'react';
import { Check, Layers } from 'lucide-react';
import { uid, useStore } from '../../lib/store';
import { kindLabel } from '../../lib/categories';
import { CategoryDot, KindDot } from '../../components/ui';
import type { Book, Concept, ConceptSense, Highlight, ReviewCard } from '../../lib/types';
import { newFsrs } from './fsrs';
import { BLANK } from './RichText';

type Kind = ReviewCard['kind'];

const TYPES: { id: Kind; label: string; help: string }[] = [
  { id: 'definition', label: 'Définition', help: 'Un terme au recto, sa définition au verso. Extraits Concept et sens des concepts.' },
  { id: 'these', label: 'Thèse', help: 'Quelle est la thèse de l’auteur dans ce texte ? Extraits Thèse.' },
  { id: 'trous', label: 'Texte à trous', help: 'Vous choisissez les mots à masquer dans l’extrait.' },
  { id: 'citation', label: 'Citation', help: 'Retrouver l’auteur et l’œuvre d’un passage.' },
  { id: 'libre', label: 'Libre', help: 'Votre propre question, votre propre réponse.' },
];

type Src =
  | { key: string; kind: 'extract'; h: Highlight }
  | { key: string; kind: 'sense'; concept: Concept; sense: ConceptSense | null; bookId: string | null };

interface Draft {
  front: string;
  back: string;
  masked: number[];
  createdId: string | null;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);
const stagger = (i: number) => ({ '--i': i }) as CSSProperties;

const WORD = /[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu;
interface Seg {
  t: string;
  word: number | null;
}
function segments(text: string): Seg[] {
  const out: Seg[] = [];
  let last = 0;
  let w = 0;
  for (const m of text.matchAll(WORD)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: text.slice(last, i), word: null });
    out.push({ t: m[0], word: w++ });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), word: null });
  return out;
}
function cloze(text: string, masked: number[]): { front: string; back: string } {
  const set = new Set(masked);
  let front = '';
  let back = '';
  for (const s of segments(text)) {
    const hit = s.word != null && set.has(s.word);
    front += hit ? BLANK : s.t;
    back += hit ? `**${s.t}**` : s.t;
  }
  return { front, back };
}

export function Creator() {
  const books = useStore((s) => s.books);
  const highlights = useStore((s) => s.highlights);
  const concepts = useStore((s) => s.concepts);
  const cards = useStore((s) => s.cards);
  const insert = useStore((s) => s.insert);
  const remove = useStore((s) => s.remove);
  const toast = useStore((s) => s.toast);

  const [mode, setMode] = useState<'book' | 'concept'>('book');
  const firstBook = books.find((b) => highlights.some((h) => h.bookId === b.id)) ?? books[0];
  const [bookId, setBookId] = useState<string>(firstBook?.id ?? '');
  const [conceptId, setConceptId] = useState<string>(concepts[0]?.id ?? '');
  const [kind, setKind] = useState<Kind>('definition');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [free, setFree] = useState({ front: '', back: '', bookId: '' });

  const book = books.find((b) => b.id === bookId) ?? null;
  const concept = concepts.find((c) => c.id === conceptId) ?? null;
  const bookOf = (id: string | null) => books.find((b) => b.id === id) ?? null;

  const sources = useMemo<Src[]>(() => {
    const out: Src[] = [];
    let ex: Highlight[] = [];
    if (mode === 'book' && book) ex = highlights.filter((h) => h.bookId === book.id);
    if (mode === 'concept' && concept) ex = highlights.filter((h) => h.conceptIds.includes(concept.id));
    if (kind === 'definition') {
      if (mode === 'concept' && concept) {
        if (concept.definition.trim()) out.push({ key: `s:${concept.id}:`, kind: 'sense', concept, sense: null, bookId: null });
        for (const s of concept.senses) if (s.definition.trim()) out.push({ key: `s:${concept.id}:${s.id}`, kind: 'sense', concept, sense: s, bookId: s.bookId });
      }
      if (mode === 'book' && book) {
        for (const c of concepts)
          for (const s of c.senses) if (s.bookId === book.id && s.definition.trim()) out.push({ key: `s:${c.id}:${s.id}`, kind: 'sense', concept: c, sense: s, bookId: s.bookId });
      }
      ex = ex.filter((h) => h.category === 'concept');
    } else if (kind === 'these') ex = ex.filter((h) => h.category === 'these');
    ex = ex.slice().sort((a, b) => a.createdAt - b.createdAt);
    for (const h of ex) out.push({ key: `e:${h.id}`, kind: 'extract', h });
    return out;
  }, [mode, book, concept, kind, highlights, concepts]);

  const termFor = (h: Highlight): string => concepts.find((c) => h.conceptIds.includes(c.id) && (!concept || c.id === concept.id))?.name ?? concept?.name ?? concepts.find((c) => h.conceptIds.includes(c.id))?.name ?? '';

  const initial = (src: Src): Draft => {
    if (src.kind === 'sense') {
      const who = src.sense?.author.trim();
      return {
        front: `Définir « ${src.concept.name} »${who ? ` (selon ${who})` : ''}`,
        back: (src.sense?.definition || src.concept.definition).trim(),
        masked: [],
        createdId: null,
      };
    }
    const h = src.h;
    const b = bookOf(h.bookId);
    const text = norm(h.text);
    const author = b?.author.trim() || '';
    if (kind === 'definition')
      return { front: `Définir « ${termFor(h)} »${author ? ` (selon ${author})` : ''}`, back: text, masked: [], createdId: null };
    if (kind === 'these')
      return {
        front: `Quelle est la thèse de ${author || 'l’auteur'} dans *${b?.title ?? 'ce texte'}*${h.locationLabel ? `, ${h.locationLabel}` : ''} ?`,
        back: text,
        masked: [],
        createdId: null,
      };
    if (kind === 'trous') return { front: text, back: text, masked: [], createdId: null };
    return { front: `Qui a écrit : « ${clip(text, 320)} » ?`, back: [author, b ? `*${b.title}*` : ''].filter(Boolean).join(', '), masked: [], createdId: null };
  };

  const dkey = (src: Src) => `${kind}|${src.key}`;
  const draftOf = (src: Src): Draft => drafts[dkey(src)] ?? initial(src);
  const setDraft = (src: Src, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [dkey(src)]: { ...(d[dkey(src)] ?? initial(src)), ...patch } }));

  const toggle = (src: Src) => setOpen((o) => ({ ...o, [dkey(src)]: !o[dkey(src)] }));

  const existing = (src: Src) =>
    src.kind === 'extract'
      ? cards.some((c) => c.highlightId === src.h.id && c.kind === kind)
      : cards.some((c) => c.kind === 'definition' && c.conceptId === src.concept.id && c.front === initial(src).front);

  const missingTerm = (d: Draft) => kind === 'definition' && /«\s*»/.test(d.front);

  const create = (src: Src) => {
    const d = draftOf(src);
    if (!d.front.trim() || !d.back.trim() || missingTerm(d)) return;
    const h = src.kind === 'extract' ? src.h : null;
    const card: ReviewCard = {
      id: uid(),
      kind,
      front: d.front.trim(),
      back: d.back.trim(),
      highlightId: h?.id ?? null,
      conceptId: src.kind === 'sense' ? src.concept.id : (concept?.id ?? (kind === 'definition' ? (h?.conceptIds[0] ?? null) : null)),
      bookId: h?.bookId ?? (src.kind === 'sense' ? src.bookId : null),
      suspended: false,
      fsrs: newFsrs(),
      createdAt: Date.now(),
    };
    insert('cards', card);
    setDraft(src, { createdId: card.id });
    toast('Carte créée', 'success');
  };

  const undoCreate = (src: Src) => {
    const id = draftOf(src).createdId;
    if (id) remove('cards', id);
    setDraft(src, { createdId: null });
  };

  const createFree = () => {
    if (!free.front.trim() || !free.back.trim()) return;
    insert('cards', {
      id: uid(),
      kind: 'libre',
      front: free.front.trim(),
      back: free.back.trim(),
      highlightId: null,
      conceptId: null,
      bookId: free.bookId || null,
      suspended: false,
      fsrs: newFsrs(),
      createdAt: Date.now(),
    });
    setFree({ front: '', back: '', bookId: free.bookId });
    toast('Carte créée', 'success');
  };

  const emptyHint =
    kind === 'definition'
      ? 'Aucun extrait Concept ni sens avec définition ici. Surlignez un passage en Concept (touche 5) ou rédigez le sens d’un concept.'
      : kind === 'these'
        ? 'Aucun extrait Thèse ici. Surlignez un passage en Thèse (touche 2) dans le lecteur.'
        : 'Aucun extrait ici. Surlignez des passages dans le lecteur pour pouvoir en tirer des cartes.';

  return (
    <section className="rev-create anim-in" aria-label="Créer des cartes">
      <div className="rev-create-head">
        <h2 className="rev-h2">Créer des cartes</h2>
        <p className="muted rev-lead">Vous choisissez les passages, vous relisez chaque carte avant de la créer. Rien n’est généré à votre place.</p>
      </div>

      <div className="rev-controls">
        <div className="segmented" role="tablist" aria-label="Source">
          <button className={mode === 'book' ? 'active' : ''} onClick={() => setMode('book')}>
            Un livre
          </button>
          <button className={mode === 'concept' ? 'active' : ''} onClick={() => setMode('concept')}>
            Un concept
          </button>
        </div>
        {mode === 'book' ? (
          <select className="input rev-select" value={bookId} onChange={(e) => setBookId(e.target.value)} aria-label="Livre" disabled={!books.length}>
            {!books.length && <option value="">Aucun livre</option>}
            {books.map((b: Book) => (
              <option key={b.id} value={b.id}>
                {b.title}
                {b.author ? ` — ${b.author}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <select className="input rev-select" value={conceptId} onChange={(e) => setConceptId(e.target.value)} aria-label="Concept" disabled={!concepts.length}>
            {!concepts.length && <option value="">Aucun concept</option>}
            {concepts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="rev-types" role="tablist" aria-label="Type de carte">
        {TYPES.map((t) => (
          <button key={t.id} className={`chip ${kind === t.id ? 'active' : ''}`} onClick={() => setKind(t.id)} role="tab" aria-selected={kind === t.id}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="rev-help muted">{TYPES.find((t) => t.id === kind)!.help}</p>

      {kind === 'libre' ? (
        <div className="rev-draft rev-free">
          <label className="rev-field">
            <span>Recto</span>
            <textarea className="textarea" rows={2} value={free.front} onChange={(e) => setFree({ ...free, front: e.target.value })} placeholder="Votre question" />
          </label>
          <label className="rev-field">
            <span>Verso</span>
            <textarea className="textarea" rows={3} value={free.back} onChange={(e) => setFree({ ...free, back: e.target.value })} placeholder="La réponse à retrouver" />
          </label>
          <div className="rev-draft-actions">
            <select className="input rev-select" value={free.bookId} onChange={(e) => setFree({ ...free, bookId: e.target.value })} aria-label="Livre associé (facultatif)">
              <option value="">Sans livre associé</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={createFree} disabled={!free.front.trim() || !free.back.trim()}>
              Créer la carte
            </button>
          </div>
        </div>
      ) : sources.length === 0 ? (
        <div className="rev-none">
          <Layers size={16} />
          <p>{mode === 'book' && !books.length ? 'Importez un livre pour en tirer des cartes.' : mode === 'concept' && !concepts.length ? 'Créez un concept pour en tirer des cartes.' : emptyHint}</p>
        </div>
      ) : (
        <ul className="rev-sources anim-stagger">
          {sources.map((src, i) => {
            const k = dkey(src);
            const isOpen = !!open[k];
            const d = isOpen ? draftOf(src) : null;
            const label = src.kind === 'extract' ? norm(src.h.text) : norm(src.sense?.definition || src.concept.definition);
            const b = src.kind === 'extract' ? bookOf(src.h.bookId) : bookOf(src.bookId);
            return (
              <li key={k} className={`rev-src ${isOpen ? 'open' : ''}`} style={stagger(i)}>
                <button className="rev-src-row" onClick={() => toggle(src)} role="checkbox" aria-checked={isOpen} aria-label={`Convertir : ${clip(label, 60)}`}>
                  <span className="rev-check" aria-hidden>
                    {isOpen && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="rev-src-main">
                    <span className="rev-src-text">{clip(label, 220)}</span>
                    <span className="rev-src-meta">
                      {src.kind === 'extract' ? (
                        <>
                          <KindDot h={src.h} size={7} />
                          {kindLabel(src.h)}
                          {src.h.locationLabel ? ` · ${src.h.locationLabel}` : ''}
                        </>
                      ) : (
                        <>
                          <CategoryDot id="concept" size={7} />
                          Sens de « {src.concept.name} »{src.sense?.author ? ` selon ${src.sense.author}` : ''}
                        </>
                      )}
                      {mode === 'concept' && b ? ` · ${b.title}` : ''}
                    </span>
                  </span>
                  {existing(src) && <span className="rev-badge">Déjà en carte</span>}
                </button>
                {isOpen && d && (
                  <div className="rev-draft anim-in">
                    {kind === 'trous' && src.kind === 'extract' && (
                      <div className="rev-picker">
                        <span className="rev-field-label">Touchez les mots à masquer</span>
                        <p className="rev-picker-text selectable">
                          {segments(norm(src.h.text)).map((s, j) =>
                            s.word == null ? (
                              <span key={j}>{s.t}</span>
                            ) : (
                              <button
                                key={j}
                                className={`rev-word ${d.masked.includes(s.word) ? 'on' : ''}`}
                                aria-pressed={d.masked.includes(s.word)}
                                onClick={() => {
                                  const w = s.word!;
                                  const masked = d.masked.includes(w) ? d.masked.filter((x) => x !== w) : [...d.masked, w];
                                  setDraft(src, { masked, ...cloze(norm(src.h.text), masked) });
                                }}
                              >
                                {s.t}
                              </button>
                            ),
                          )}
                        </p>
                      </div>
                    )}
                    <div className="rev-pair">
                      <label className="rev-field">
                        <span>Recto</span>
                        <textarea className="textarea" rows={kind === 'trous' ? 4 : 2} value={d.front} onChange={(e) => setDraft(src, { front: e.target.value })} disabled={!!d.createdId} />
                      </label>
                      <label className="rev-field">
                        <span>{kind === 'trous' ? 'Verso (**mot** = mis en évidence)' : 'Verso'}</span>
                        <textarea className="textarea" rows={kind === 'trous' ? 4 : 3} value={d.back} onChange={(e) => setDraft(src, { back: e.target.value })} disabled={!!d.createdId} />
                      </label>
                    </div>
                    <div className="rev-draft-actions">
                      {missingTerm(d) && !d.createdId && <span className="rev-warn">Indiquez le terme à définir entre les guillemets.</span>}
                      {kind === 'trous' && !d.masked.length && !d.createdId && <span className="rev-warn">Masquez au moins un mot.</span>}
                      {d.createdId ? (
                        <>
                          <span className="rev-done">
                            <Check size={14} /> Carte créée
                          </span>
                          <button className="btn btn-ghost btn-sm" onClick={() => undoCreate(src)}>
                            Annuler
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-primary"
                          onClick={() => create(src)}
                          disabled={!d.front.trim() || !d.back.trim() || missingTerm(d) || (kind === 'trous' && !d.masked.length)}
                        >
                          Créer la carte
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
