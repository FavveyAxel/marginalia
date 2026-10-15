// Indicateur de page « p. 12 / 240 » et champ « Aller à la page… » (EPUB et PDF).
// Un clic (ou ⌘⌥G, ou ⌘K « page 45 ») ouvre le champ ; Entrée y va, Échap referme.
// Après un saut, une pastille « ← p. 12 » ramène à l’endroit quitté (20 s).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CornerUpLeft } from 'lucide-react';
import { fmtKeys } from '../../lib/keys';
import { ESTIMATED_NOTE, type PageRequest, type PageStatus } from './pages';

export type { PageRequest };
export const PAGE_JUMP_KEY = '⌘⌥G';

/** Endroit quitté par un saut, pour y revenir. */
export interface ReturnPoint {
  label: string;
  back(): void;
}

const BACK_MS = 20000;

export function PageJumpField({
  status,
  onGo,
  capture,
  request,
  variant,
}: {
  status: PageStatus | null;
  /** Va à la page : null si c'est fait, sinon le message d'erreur. */
  onGo(query: string): string | null;
  /** Endroit lu avant le saut (pastille de retour). */
  capture?(): ReturnPoint | null;
  request?: PageRequest | null;
  /** pill : pied du volet de lecture (EPUB, texte) ; inline : dans la barre de zoom du PDF. */
  variant: 'pill' | 'inline';
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [ret, setRet] = useState<ReturnPoint | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const retTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const [focusTick, setFocusTick] = useState(0);
  const open = (initial = '', err = '') => {
    setValue(initial);
    setError(err);
    setEditing(true);
    setFocusTick((n) => n + 1);
  };
  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [editing, focusTick]);
  const close = () => {
    setEditing(false);
    setError('');
  };

  /** Saut : true si fait (sinon le champ montre l'erreur). */
  const go = (q: string): boolean => {
    const here = capture?.() ?? null;
    const err = onGo(q);
    if (err) {
      open(q, err);
      return false;
    }
    close();
    if (retTimer.current) clearTimeout(retTimer.current);
    setRet(here);
    if (here) retTimer.current = setTimeout(() => setRet(null), BACK_MS);
    return true;
  };

  const lastNonce = useRef(request?.nonce ?? 0);
  useEffect(() => {
    if (!request || request.nonce === lastNonce.current) return;
    lastNonce.current = request.nonce;
    if (request.query) go(request.query);
    else open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  useEffect(() => () => void (retTimer.current && clearTimeout(retTimer.current)), []);

  if (!status) return null;
  const cur = status.label || '–';
  const title = status.estimated
    ? fmtKeys(`Page ${cur} sur ${status.last} — ${ESTIMATED_NOTE}. Cliquer pour aller à une page (${PAGE_JUMP_KEY})`)
    : fmtKeys(`Page ${cur} sur ${status.last}${status.physical ? ` (page ${status.physical} du fichier)` : ''}. Cliquer pour aller à une page (${PAGE_JUMP_KEY})`);

  return (
    <span className={`pagejump pagejump-${variant}${status.estimated ? ' is-estimated' : ''}`} data-testid="page-jump">
      {ret && !editing && (
        <button
          type="button"
          className="pagejump-back"
          onClick={() => {
            const r = ret;
            setRet(null);
            r.back();
          }}
          title={`Revenir à la page ${ret.label || 'précédente'}`}
          data-testid="page-back"
        >
          <CornerUpLeft size={12} /> {ret.label ? `p. ${ret.label}` : 'Retour'}
        </button>
      )}
      {editing ? (
        <form
          className="pagejump-form"
          onSubmit={(e) => {
            e.preventDefault();
            go(value);
          }}
        >
          <label className="pagejump-p" htmlFor="pagejump-input">
            p.
          </label>
          <input
            id="pagejump-input"
            ref={inputRef}
            className="pagejump-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
            onBlur={() => setTimeout(() => setEditing((v) => (document.activeElement === inputRef.current ? v : false)), 120)}
            placeholder={cur === '–' ? '1' : cur}
            aria-label="Aller à la page"
            aria-invalid={!!error}
            spellCheck={false}
            autoComplete="off"
            inputMode="text"
            data-testid="page-jump-input"
          />
          <span className="pagejump-total">/ {status.last}</span>
          {error && (
            <span className="pagejump-error" role="alert" data-testid="page-jump-error">
              {error}
            </span>
          )}
        </form>
      ) : (
        <button type="button" className="pagejump-btn" onClick={() => open()} title={title} aria-label={`Page ${cur} sur ${status.last} — aller à la page`} data-testid={variant === 'inline' ? 'pdf-page' : 'page-indicator'}>
          p. {cur} / {status.last}
        </button>
      )}
    </span>
  );
}
