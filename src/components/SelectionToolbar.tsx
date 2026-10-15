// Barre flottante au-dessus d'une sélection de texte (FIGÉ).
import { useContext, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BookmarkPlus, Copy, Highlighter, MessageSquarePlus, Milestone, Quote } from 'lucide-react';
import { CATEGORIES } from '../lib/categories';
import type { CategoryId } from '../lib/types';
import { CategoryDot, Kbd, useFloating } from './ui';
import { CiteActionCtx } from './selectionCite';

interface Props {
  rect: DOMRect;
  /** category null = note de marge pure ; `plain` : surlignage simple (sans catégorie ni note). */
  onPick(category: CategoryId | null, withNote: boolean, plain?: boolean): void;
  /** Marquer le début d'un mouvement (explication de texte). */
  onMovement(): void;
  onCopy(): void;
  onDismiss(): void;
  /** Facultatif : « Citer dans l'écrit » (lecteur ouvert à côté de l'éditeur). Raccourci C. */
  onCite?: () => void;
  /** Facultatif : « Ajouter un signet ici » (début de la sélection). Raccourci S. */
  onBookmark?: () => void;
}

export function SelectionToolbar({ rect, onPick, onMovement, onCopy, onDismiss, onCite, onBookmark }: Props) {
  const [ref, style] = useFloating(rect, 'above');
  // Action « Citer » personnalisée (panneau « Livre à côté » de la carte : « Sur la carte »).
  const ca = useContext(CiteActionCtx);
  useEffect(() => {
    if (!ca?.register || !onCite) return;
    ca.register(onCite);
    return () => ca.register?.(null);
  }, [ca, onCite]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const cat = CATEGORIES.find((c) => c.key === e.key);
      if (cat) {
        e.preventDefault();
        onPick(cat.id, e.shiftKey);
      } else if (e.key.toLowerCase() === 'h' || e.key === '0') {
        e.preventDefault();
        onPick(null, false, true);
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        onPick(null, true);
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        onMovement();
      } else if (onCite && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        onCite();
      } else if (onBookmark && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onBookmark();
      } else if (e.key === 'Escape') {
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPick, onMovement, onDismiss, onCite, onBookmark]);

  return createPortal(
    <div
      ref={ref}
      className="floating sel-toolbar"
      style={style}
      // Garder la sélection ; un bouton glissable doit pouvoir démarrer son glisser.
      onMouseDown={(e) => !(e.target as HTMLElement).closest('[draggable="true"]') && e.preventDefault()}
      role="toolbar"
      aria-label="Annoter la sélection"
    >
      <button
        className="cat-btn sel-plain"
        title="Surligner (H) — sans catégorie"
        aria-label="Surligner, sans catégorie"
        onClick={() => onPick(null, false, true)}
      >
        <Highlighter size={13} style={{ color: 'var(--cat-plain)' }} aria-hidden />
        <span className="sel-plain-lbl">Surligner</span>
        <Kbd>H</Kbd>
      </button>
      <span className="sep" />
      {onCite && (
        <>
          <button
            className={`cat-btn sel-cite ${ca?.onDragStart ? 'sel-cite-drag' : ''}`}
            title={ca?.title ?? 'Citer dans l’écrit : crée l’extrait et l’insère au curseur (C)'}
            onClick={onCite}
            draggable={ca?.onDragStart ? true : undefined}
            onDragStart={ca?.onDragStart}
            data-testid={ca?.testId}
          >
            {ca?.icon ?? <Quote size={13} />}
            {ca?.label ?? 'Citer'}
            <Kbd>C</Kbd>
          </button>
          <span className="sep" />
        </>
      )}
      {CATEGORIES.map((c) => (
        <button key={c.id} className="cat-btn" title={`${c.label} — ${c.description} (${c.key})`} onClick={() => onPick(c.id, false)}>
          <CategoryDot id={c.id} />
          {c.label}
          <Kbd>{c.key}</Kbd>
        </button>
      ))}
      <span className="sep" />
      <button className="icon-btn sm" title="Note personnelle (N)" onClick={() => onPick(null, true)}>
        <MessageSquarePlus size={15} />
      </button>
      <button className="icon-btn sm" title="Début de mouvement (M)" onClick={onMovement}>
        <Milestone size={15} />
      </button>
      {onBookmark && (
        <button className="icon-btn sm" title="Ajouter un signet ici (S)" aria-label="Ajouter un signet ici" onClick={onBookmark}>
          <BookmarkPlus size={15} />
        </button>
      )}
      <button className="icon-btn sm" title="Copier" onClick={onCopy}>
        <Copy size={14} />
      </button>
    </div>,
    document.body,
  );
}
