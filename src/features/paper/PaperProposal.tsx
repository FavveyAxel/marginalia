// Photo d'une page reçue du téléphone : proposition de rattachement à un livre papier
// (« « Du contrat social », p. 47 ? »), devinée en local ; l'utilisateur confirme, corrige la page ou
// le texte, ou choisit un autre livre. Sert dans la Boîte de réception et sur la page du livre.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BookCheck, Loader2, ScanText } from 'lucide-react';
import { useStore } from '../../lib/store';
import { attachPhotoToPaper, readPhotoText, setPaperGuess, type InboxItem } from '../inbox/inbox';
import './paper.css';

const REASON: Record<string, string> = {
  header: 'titre lu en haut de la page',
  series: 'photos en cours pour ce livre',
  last: 'livre de votre dernier extrait',
};

export function PaperProposal({ it, showPhoto = false }: { it: InboxItem; showPhoto?: boolean }) {
  const papers = useStore(useShallow((s) => s.books.filter((b) => b.format === 'paper')));
  const sorted = useMemo(() => [...papers].sort((a, b) => a.title.localeCompare(b.title, 'fr')), [papers]);
  const g = it.paper;
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const text = g?.text ?? it.text ?? '';
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(220, el.scrollHeight + 2)}px`;
  }, [text]);
  if (!papers.length) return null;
  const working = it.status === 'working';

  // Photo pas encore lue : on la lit d'abord (texte, titre courant, numéro de page).
  if (!g) {
    return (
      <div className="pp-propose is-ask">
        <button className="btn btn-sm" onClick={() => void readPhotoText(it.name)} disabled={working} data-testid="paper-read-photo">
          {working ? <Loader2 size={14} className="pp-spin" /> : <ScanText size={14} />} Rattacher à un livre papier…
        </button>
      </div>
    );
  }
  const book = papers.find((b) => b.id === g.bookId) ?? null;
  const confirm = async () => {
    if (!book || busy) return;
    setBusy(true);
    await attachPhotoToPaper(it.name, book.id, { page: g.page, text });
    setBusy(false);
  };
  return (
    <div className="pp-propose" data-testid="paper-proposal">
      {showPhoto && it.preview && (
        <a className="pp-propose-photo" href={it.preview} target="_blank" rel="noreferrer" title="Voir la photo en grand">
          <img src={it.preview} alt="" />
        </a>
      )}
      <div className="pp-propose-main">
        <p className="pp-propose-q">
          {book ? (
            <>
              <strong>« {book.title} »</strong>
              {g.page ? `, p. ${g.page}` : ''} ?{g.reason && <span className="pp-propose-why"> — {REASON[g.reason]}</span>}
            </>
          ) : (
            <strong>De quel livre papier est cette page ?</strong>
          )}
        </p>
        <div className="pp-propose-fields">
          <label className="pp-field pp-propose-book">
            <span>Livre</span>
            <select className="input" value={g.bookId ?? ''} onChange={(e) => setPaperGuess(it.name, { bookId: e.target.value || null, reason: null })} disabled={busy || working} data-testid="paper-proposal-book">
              <option value="">Choisir un livre papier…</option>
              {sorted.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                  {b.author ? ` — ${b.author}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="pp-field pp-propose-page">
            <span>Page</span>
            <input className="input" value={g.page} onChange={(e) => setPaperGuess(it.name, { page: e.target.value })} inputMode="numeric" placeholder="—" disabled={busy || working} data-testid="paper-proposal-page" />
          </label>
        </div>
        <label className="pp-field">
          <span>Texte lu sur la photo — gardez le passage qui vous intéresse</span>
          <textarea ref={area} className="input pp-propose-text" value={text} onChange={(e) => setPaperGuess(it.name, { text: e.target.value })} spellCheck={false} disabled={busy || working} />
        </label>
        <div className="pp-actions">
          <button className="btn btn-sm btn-primary" onClick={() => void confirm()} disabled={!book || busy || working} data-testid="paper-proposal-confirm">
            {busy ? <Loader2 size={14} className="pp-spin" /> : <BookCheck size={14} />} {book ? 'Oui, ajouter l’extrait' : 'Ajouter l’extrait'}
          </button>
        </div>
      </div>
    </div>
  );
}
