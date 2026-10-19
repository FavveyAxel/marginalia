// Page d'un livre papier : couverture et édition, « Ajouter un extrait » (texte recopié + page),
// « Ajouter par photo » (QR code : photos de pages depuis le téléphone, livre et page proposés),
// et les extraits, rangés par page. Sert aussi, en version compacte, dans le panneau « Livre » de
// l'éditeur (« Citer » insère la citation avec sa référence).
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BookOpenText, Camera, Check, ChevronLeft, Copy, Image as ImageIcon, PenLine, Plus, Quote, QrCode, Trash2, X } from 'lucide-react';
import { useStore } from '../../lib/store';
import { host } from '../../lib/platform';
import type { Book, CategoryId, Highlight } from '../../lib/types';
import { CATEGORIES, CATEGORY_BY_ID } from '../../lib/categories';
import { formatCitation } from '../../lib/citation';
import { BookCover } from '../library/BookCover';
import { useInbox, startPaperSeries, wifiAvailable } from '../inbox/inbox';
import { WifiReceive } from '../inbox/WifiReceive';
import { PaperProposal } from './PaperProposal';
import { addPaperExtract, byPage, cleanPage, coverThumb, editionLine, paperAnchor, paperBackLabel, paperGoBack, prettyIsbn } from './paper';
import { fmtKeys, isMod } from '../../lib/keys';
import './paper.css';

/** Choix de la catégorie : aucune (surlignage simple) ou l'une des six. */
function CategoryPicker({ value, onChange, name }: { value: CategoryId | null; onChange(c: CategoryId | null): void; name: string }) {
  return (
    <div className="pb-cats" role="radiogroup" aria-label="Catégorie de l’extrait">
      <button type="button" role="radio" aria-checked={value === null} className={`pb-cat ${value === null ? 'is-on' : ''}`} onClick={() => onChange(null)} name={name}>
        Aucune
      </button>
      {CATEGORIES.map((c) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === c.id}
          key={c.id}
          className={`pb-cat ${value === c.id ? 'is-on' : ''}`}
          style={{ ['--c' as string]: `var(${c.cssVar})` }}
          onClick={() => onChange(c.id)}
          title={c.description}
          name={name}
        >
          <span className="pb-cat-dot" aria-hidden="true" /> {c.label}
        </button>
      ))}
    </div>
  );
}

/** « Ajouter un extrait » : texte recopié, page, catégorie, note facultative. */
function Composer({ bookId, compact, onAdded }: { bookId: string; compact?: boolean; onAdded?: (h: Highlight) => void }) {
  const [text, setText] = useState('');
  const [page, setPage] = useState('');
  const [cat, setCat] = useState<CategoryId | null>(null);
  const [note, setNote] = useState('');
  const [withNote, setWithNote] = useState(false);
  const [open, setOpen] = useState(!compact);
  const area = useRef<HTMLTextAreaElement>(null);
  const add = () => {
    if (!text.trim()) return;
    const h = addPaperExtract(bookId, { text, page, category: cat, note });
    setText('');
    setNote('');
    setWithNote(false);
    // La page reste : on recopie souvent plusieurs passages de la même page.
    useStore.getState().toast(`Extrait ajouté${h.printedPage ? `, p. ${h.printedPage}` : ''}`, 'success');
    onAdded?.(h);
    area.current?.focus();
  };
  if (!open)
    return (
      <button className="btn btn-sm pb-compose-open" onClick={() => setOpen(true)} data-testid="paper-compose-open">
        <Plus size={14} /> Ajouter un extrait
      </button>
    );
  return (
    <form
      className={`pb-compose ${compact ? 'is-compact' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
      aria-label="Ajouter un extrait"
    >
      <textarea
        ref={area}
        className="input pb-compose-text"
        placeholder="Recopiez le passage du livre…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && isMod(e)) {
            e.preventDefault();
            add();
          }
        }}
        rows={compact ? 3 : 4}
        aria-label="Texte de l’extrait"
        data-testid="paper-extract-text"
      />
      {!compact && <CategoryPicker value={cat} onChange={setCat} name="pb-new-cat" />}
      {withNote && (
        <textarea className="input pb-compose-note" placeholder="Ma note (reformulation, question, critique…)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} aria-label="Ma note" />
      )}
      <div className="pb-compose-foot">
        <label className="pb-page-field">
          <span>Page</span>
          <input className="input" value={page} onChange={(e) => setPage(e.target.value)} inputMode="numeric" placeholder="—" aria-label="Numéro de page" data-testid="paper-extract-page" />
        </label>
        {!withNote && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWithNote(true)}>
            <PenLine size={13} /> Ajouter une note
          </button>
        )}
        <span className="spacer" />
        {compact && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
            Fermer
          </button>
        )}
        <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim()} title={fmtKeys('Ajouter l’extrait (⌘↩)')} data-testid="paper-extract-add">
          <Check size={13} /> Ajouter l’extrait
        </button>
      </div>
    </form>
  );
}

/** Photo de la page d'un extrait (fichier du livre), affichée à la demande. */
function ExtractPhoto({ bookId, photo }: { bookId: string; photo: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    host
      .readFile(bookId, photo)
      .then((d) => {
        if (!alive) return;
        made = URL.createObjectURL(new Blob([d], { type: 'image/jpeg' }));
        setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [bookId, photo]);
  if (!url) return null;
  return (
    <>
      <button className="pb-photo" onClick={() => setBig(true)} title="Voir la photo de la page" aria-label="Voir la photo de la page">
        <img src={url} alt="" />
      </button>
      {big && (
        <div className="pb-photo-big anim-fade" role="dialog" aria-label="Photo de la page" onClick={() => setBig(false)} onKeyDown={(e) => e.key === 'Escape' && setBig(false)} tabIndex={-1}>
          <img src={url} alt="Photo de la page" />
          <button className="icon-btn pb-photo-close" aria-label="Fermer" onClick={() => setBig(false)} autoFocus>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}

const ExtractCard = memo(function ExtractCard({ h, book, active, compact, onCite, index }: { h: Highlight; book: Book; active: boolean; compact?: boolean; onCite?: (h: Highlight, b: Book) => void; index: number }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(h.text);
  const [page, setPage] = useState(h.printedPage);
  const [cat, setCat] = useState<CategoryId | null>(h.category);
  const [note, setNote] = useState(h.note);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);
  const c = h.category ? CATEGORY_BY_ID[h.category] : null;
  const save = () => {
    const p = cleanPage(page);
    useStore.getState().updateHighlight(h.id, { text: text.trim() || h.text, printedPage: p, locationLabel: p ? `p. ${p}` : '', anchor: paperAnchor(p), category: cat, note: note.trim() });
    setEdit(false);
  };
  const copy = async () => {
    const text = formatCitation(h, book);
    // Presse-papiers : API asynchrone, sinon l'ancienne commande « copier » (fenêtre sans permission).
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        return document.execCommand('copy');
      } finally {
        ta.remove();
      }
    };
    let done = false;
    try {
      await navigator.clipboard.writeText(text);
      done = true;
    } catch {
      done = fallback();
    }
    useStore.getState().toast(done ? 'Citation copiée, avec sa référence' : 'Copie impossible', done ? 'success' : 'error');
  };
  return (
    <li ref={ref} className={`pb-extract ${active ? 'is-active' : ''}`} data-hl={h.id} data-testid="paper-extract" style={{ ['--i' as string]: index, ...(c ? { ['--c' as string]: `var(${c.cssVar})` } : {}) }}>
      <span className="pb-extract-page">{h.printedPage ? `p. ${h.printedPage}` : '—'}</span>
      {edit ? (
        <div className="pb-extract-edit">
          <textarea className="input pb-compose-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label="Texte de l’extrait" autoFocus />
          <div className="pb-compose-row">
            <label className="pb-page-field">
              <span>p.</span>
              <input className="input" value={page} onChange={(e) => setPage(e.target.value)} inputMode="numeric" aria-label="Numéro de page" />
            </label>
            <CategoryPicker value={cat} onChange={setCat} name={`pb-cat-${h.id}`} />
          </div>
          <textarea className="input pb-compose-note" placeholder="Ma note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} aria-label="Ma note" />
          <div className="pb-compose-foot">
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => setEdit(false)}>
              Annuler
            </button>
            <button className="btn btn-sm btn-primary" onClick={save}>
              Enregistrer
            </button>
          </div>
        </div>
      ) : (
        <div className="pb-extract-body">
          <blockquote className="pb-extract-text">{h.text}</blockquote>
          {(c || h.note) && (
            <div className="pb-extract-meta">
              {c && (
                <span className="pb-extract-cat">
                  <span className="pb-cat-dot" aria-hidden="true" /> {c.label}
                </span>
              )}
              {h.note && <span className="pb-extract-note">{h.note}</span>}
            </div>
          )}
          {h.photo && !compact && <ExtractPhoto bookId={book.id} photo={h.photo} />}
        </div>
      )}
      {!edit && (
        <div className="pb-extract-actions">
          {onCite ? (
            <button className="btn btn-sm" onClick={() => onCite(h, book)} title="Insérer la citation au curseur de l’écrit, avec sa note de bas de page" data-testid="paper-cite">
              <Quote size={13} /> Citer
            </button>
          ) : (
            <button className="icon-btn sm" onClick={() => void copy()} title="Copier la citation (avec auteur, titre, éditeur, année, page)" aria-label="Copier la citation" data-testid="paper-copy-citation">
              <Copy size={14} />
            </button>
          )}
          <button className="icon-btn sm" onClick={() => setEdit(true)} title="Modifier" aria-label="Modifier l’extrait">
            <PenLine size={14} />
          </button>
          {!compact && (
            <button className="icon-btn sm pb-danger" onClick={() => useStore.getState().removeHighlight(h.id)} title="Supprimer (corbeille)" aria-label="Supprimer l’extrait">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
    </li>
  );
});

/** Extraits du livre papier, par page (et le formulaire d'ajout). */
export function PaperExtracts({ bookId, compact, onCite }: { bookId: string; compact?: boolean; onCite?: (h: Highlight, b: Book) => void }) {
  const book = useStore((s) => s.books.find((b) => b.id === bookId) ?? null);
  const highlights = useStore(useShallow((s) => s.highlights.filter((h) => h.bookId === bookId)));
  const active = useStore((s) => s.activeHighlightId);
  const sorted = useMemo(() => [...highlights].sort(byPage), [highlights]);
  if (!book) return null;
  return (
    <div className={`pb-extracts ${compact ? 'is-compact' : ''}`}>
      <Composer bookId={bookId} compact={compact} />
      {sorted.length === 0 ? (
        <div className="empty pb-empty">
          <h3>Aucun extrait pour l’instant</h3>
          <p>Recopiez un passage avec sa page, ou photographiez la page avec le téléphone : chaque extrait se cite ensuite avec sa référence complète.</p>
        </div>
      ) : (
        <ul className="pb-list anim-stagger" aria-label="Extraits">
          {sorted.map((h, i) => (
            <ExtractCard key={h.id} index={i} h={h} book={book} active={active === h.id} compact={compact} onCite={onCite} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function PaperBookView({ bookId }: { bookId: string }) {
  const book = useStore((s) => s.books.find((b) => b.id === bookId) ?? null);
  const count = useStore((s) => s.highlights.reduce((n, h) => n + (h.bookId === bookId ? 1 : 0), 0));
  const wifiOpen = useInbox((s) => s.wifiOpen);
  const proposals = useInbox(useShallow((s) => s.items.filter((i) => i.kind === 'image' && (i.paper?.bookId === bookId || (s.paperSeries?.bookId === bookId && i.status !== 'error' && !i.paper)))));
  const [editing, setEditing] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const jump = useStore((s) => s.jump);
  // Arrivée par un extrait (recherche, Extraits, citation) : il est mis en avant.
  useEffect(() => {
    if (!jump) return;
    const h = useStore.getState().highlights.find((x) => x.id === jump.highlightId);
    if (h?.bookId === bookId) useStore.getState().setActiveHighlight(h.id);
  }, [jump, bookId]);
  if (!book) {
    return (
      <div className="empty" style={{ marginTop: 80 }}>
        <h3>Ce livre n’existe plus</h3>
        <p>Il a peut-être été supprimé : regardez dans la corbeille.</p>
        <button className="btn" onClick={() => useStore.getState().navigate({ name: 'library' })}>
          Bibliothèque
        </button>
      </div>
    );
  }
  const ed = editionLine(book);
  const byPhoto = () => {
    startPaperSeries(book.id);
    useInbox.setState({ wifiOpen: true });
  };
  return (
    <>
      <header className="topbar">
        <button className="btn btn-sm btn-ghost" onClick={paperGoBack} title={`Revenir : ${paperBackLabel()}`}>
          <ChevronLeft size={15} /> {paperBackLabel()}
        </button>
        <span className="spacer" />
        {wifiAvailable() && (
          <button className="btn btn-sm" onClick={byPhoto} data-testid="paper-by-photo" title="Photographier des pages avec le téléphone : le livre et la page sont proposés">
            <QrCode size={14} /> Ajouter par photo
          </button>
        )}
      </header>
      <div className="pb-scroll">
        <div className="pb-page anim-view" data-testid="paper-page">
          <section className="pb-hero">
            <button className="pb-cover" onClick={() => coverInput.current?.click()} title="Changer la couverture (photo)" aria-label="Changer la couverture">
              <BookCover book={book} size="md" />
              <span className="pb-cover-edit">
                <Camera size={13} /> Couverture
              </span>
            </button>
            <input
              ref={coverInput}
              type="file"
              accept="image/*,.heic,.heif"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const thumb = await coverThumb(await f.arrayBuffer(), f.name).catch(() => null);
                if (thumb) useStore.getState().updateBook(book.id, { cover: thumb });
                else useStore.getState().toast('Cette image ne peut pas servir de couverture.', 'error');
              }}
            />
            <div className="pb-hero-body">
              <span className="lib-paper-tag">
                <BookOpenText size={11} /> Livre papier
              </span>
              <h1 className="pb-title">{book.title}</h1>
              {book.author && <p className="pb-author">{book.author}</p>}
              {editing ? (
                <EditionForm book={book} onDone={() => setEditing(false)} />
              ) : (
                <>
                  <p className="pb-edition">
                    {ed || <span className="muted">Édition non précisée</span>}
                    {book.edition.translator && <span> · trad. {book.edition.translator}</span>}
                    {book.isbn && <span className="pb-isbn"> · ISBN {prettyIsbn(book.isbn)}</span>}
                  </p>
                  <div className="pb-hero-actions">
                    <button className="btn btn-sm" onClick={() => setEditing(true)} data-testid="paper-edit-edition">
                      <PenLine size={13} /> Modifier l’édition
                    </button>
                    <span className="pb-count">
                      {count} extrait{count > 1 ? 's' : ''}
                    </span>
                  </div>
                </>
              )}
            </div>
          </section>

          {proposals.length > 0 && (
            <section className="pb-proposals" aria-label="Photos reçues à rattacher">
              <h2 className="pb-h2">
                <ImageIcon size={15} /> Photos reçues
              </h2>
              {proposals.map((it) =>
                it.paper || it.status === 'ready' ? (
                  <PaperProposal key={it.name} it={it} showPhoto />
                ) : (
                  <p key={it.name} className="pp-note" role="status">
                    <span className="ib-spinner" aria-hidden="true" /> {it.step ?? 'Réception de la photo…'}
                    {it.progress != null && ` ${Math.round(it.progress * 100)} %`}
                  </p>
                ),
              )}
            </section>
          )}

          <section aria-label="Extraits">
            <h2 className="pb-h2">Extraits</h2>
            <PaperExtracts bookId={book.id} />
          </section>
        </div>
      </div>
      {wifiOpen && <WifiReceive onClose={() => useInbox.setState({ wifiOpen: false })} />}
    </>
  );
}

function EditionForm({ book, onDone }: { book: Book; onDone(): void }) {
  const [v, setV] = useState({ title: book.title, author: book.author, publisher: book.edition.publisher, year: book.edition.year, translator: book.edition.translator, place: book.edition.place, isbn: book.isbn ?? '' });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = v.isbn.replace(/[\s-]/g, '').toUpperCase();
    useStore.getState().updateBook(book.id, {
      title: v.title.trim() || book.title,
      author: v.author.trim(),
      isbn: /^(97[89]\d{10}|\d{9}[\dX])$/.test(digits) ? digits : undefined,
      edition: { ...book.edition, publisher: v.publisher.trim(), year: v.year.trim(), translator: v.translator.trim(), place: v.place.trim() },
    });
    onDone();
  };
  return (
    <form className="pb-edition-form" onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && onDone()}>
      <div className="pp-field-row">
        <label className="pp-field">
          <span>Titre</span>
          <input className="input" value={v.title} onChange={set('title')} autoFocus />
        </label>
        <label className="pp-field">
          <span>Auteur</span>
          <input className="input" value={v.author} onChange={set('author')} />
        </label>
      </div>
      <div className="pp-field-row">
        <label className="pp-field">
          <span>Éditeur</span>
          <input className="input" value={v.publisher} onChange={set('publisher')} />
        </label>
        <label className="pp-field pp-field-year">
          <span>Année</span>
          <input className="input" value={v.year} onChange={set('year')} inputMode="numeric" />
        </label>
      </div>
      <div className="pp-field-row">
        <label className="pp-field">
          <span>Traducteur</span>
          <input className="input" value={v.translator} onChange={set('translator')} />
        </label>
        <label className="pp-field">
          <span>Lieu d’édition</span>
          <input className="input" value={v.place} onChange={set('place')} />
        </label>
        <label className="pp-field">
          <span>ISBN</span>
          <input className="input" value={v.isbn} onChange={set('isbn')} inputMode="numeric" />
        </label>
      </div>
      <div className="pp-actions">
        <button type="button" className="btn btn-sm" onClick={onDone}>
          Annuler
        </button>
        <button type="submit" className="btn btn-sm btn-primary">
          Enregistrer
        </button>
      </div>
    </form>
  );
}
