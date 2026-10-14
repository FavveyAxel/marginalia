// Popover « Lien » (⌘⇧K) : adresse, texte affiché si rien n'est sélectionné, retrait du lien.
import { useState } from 'react';
import { Unlink } from 'lucide-react';

/** Ajoute https:// si l'adresse n'a pas de schéma (« fr.wikipedia.org » → « https://fr.wikipedia.org »). */
export function normalizeHref(s: string): string | null {
  const v = s.trim();
  if (!v) return null;
  if (/^(https?:|mailto:)/i.test(v)) return v;
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(v)) return `mailto:${v}`;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v)) return `https://${v}`;
  return null;
}

export function LinkEditor({
  current,
  needsText,
  onApply,
  onRemove,
  onCancel,
}: {
  current: string | null;
  needsText: boolean;
  onApply: (href: string, text?: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [href, setHref] = useState(current ?? '');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const submit = () => {
    const h = normalizeHref(href);
    if (!h) {
      setError('Adresse non reconnue. Exemple : https://plato.stanford.edu');
      return;
    }
    onApply(h, needsText ? text.trim() || undefined : undefined);
  };
  return (
    <form
      className="ed-link-editor"
      data-dialog="link"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="ed-pop-title">{current ? 'Modifier le lien' : 'Insérer un lien'}</div>
      <input
        className="input"
        autoFocus
        value={href}
        placeholder="https://"
        aria-label="Adresse du lien"
        onChange={(e) => {
          setHref(e.target.value);
          setError('');
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        spellCheck={false}
        data-field="href"
      />
      {needsText && <input className="input" value={text} placeholder="Texte affiché (facultatif)" aria-label="Texte affiché" onChange={(e) => setText(e.target.value)} data-field="link-text" />}
      {error && (
        <p className="ed-field-error" role="alert">
          {error}
        </p>
      )}
      <div className="ed-confirm-actions">
        {current && (
          <button type="button" className="btn btn-sm btn-ghost ed-link-remove" onClick={onRemove} data-action="unlink">
            <Unlink size={13} /> Retirer le lien
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" className="btn btn-sm btn-primary" data-action="apply-link">
          {current ? 'Modifier' : 'Insérer'}
        </button>
      </div>
    </form>
  );
}
