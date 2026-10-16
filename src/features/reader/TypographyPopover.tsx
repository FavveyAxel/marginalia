// Réglages d'affichage du lecteur (thème, police, taille, interligne, largeur, connecteurs, repères de page).
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../lib/store';
import { useFloating } from '../../components/ui';
import type { Settings, ThemeId } from '../../lib/types';
import './reader-tools.css';

const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'system', label: 'Système' },
  { id: 'light', label: 'Clair' },
  { id: 'sepia', label: 'Sépia' },
  { id: 'dark', label: 'Sombre' },
];

type PageMarkMode = Exclude<NonNullable<Settings['pageMarks']>, 'off'>;

/** Façons de marquer les pages (livres EPUB…) ; la première est le réglage par défaut. */
const PAGE_MARK_MODES: { id: PageMarkMode; label: string }[] = [
  { id: 'paper', label: 'Pages façon papier' },
  { id: 'numbered', label: 'Trait et numéro' },
  { id: 'rule', label: 'Trait seul' },
];

const PAGE_MARK_SUB: Record<NonNullable<Settings['pageMarks']>, string> = {
  paper: 'Une feuille par page, numéro en bas',
  numbered: 'Un trait discret à chaque changement de page',
  rule: 'Un trait discret à chaque changement de page',
  off: 'Aucun repère dans le texte',
};

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  id,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format(v: number): string;
  onChange(v: number): void;
  id: string;
}) {
  return (
    <div className="typo-row">
      <div className="typo-label">
        <label htmlFor={id}>{label}</label>
        <span className="typo-value">{format(value)}</span>
      </div>
      <input id={id} className="typo-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function TypographyPopover({ anchor, onClose }: { anchor: DOMRect; onClose(): void }) {
  const s = useStore((st) => st.settings);
  const update = useStore((st) => st.updateSettings);
  const [ref, style] = useFloating(anchor, 'below');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || rootRef.current?.contains(t)) return;
      // Le bouton d'ouverture (actif) gère lui-même la bascule
      if (t.closest('.icon-btn.active')) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const set = (patch: Partial<Settings>) => update(patch);
  const pageMarks = s.pageMarks ?? 'paper';

  return createPortal(
    <div
      ref={(el) => {
        rootRef.current = el;
        ref(el);
      }}
      className="floating typo-pop"
      style={{ ...style, width: 300 }}
      role="dialog"
      aria-label="Affichage"
    >
      <div className="typo-section">
        <div className="typo-title">Thème</div>
        <div className="segmented typo-seg" role="radiogroup" aria-label="Thème">
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={s.theme === t.id} className={s.theme === t.id ? 'active' : ''} onClick={() => set({ theme: t.id })} data-theme-id={t.id}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="typo-section">
        <div className="typo-title">Police</div>
        <div className="segmented typo-seg" role="radiogroup" aria-label="Police">
          <button role="radio" aria-checked={s.fontFamily === 'serif'} className={`typo-serif ${s.fontFamily === 'serif' ? 'active' : ''}`} onClick={() => set({ fontFamily: 'serif' })}>
            Serif
          </button>
          <button role="radio" aria-checked={s.fontFamily === 'sans'} className={s.fontFamily === 'sans' ? 'active' : ''} onClick={() => set({ fontFamily: 'sans' })}>
            Sans
          </button>
        </div>
      </div>
      <Slider id="typo-size" label="Taille" value={s.fontSize} min={14} max={28} step={1} format={(v) => `${v} px`} onChange={(v) => set({ fontSize: v })} />
      <Slider id="typo-lh" label="Interligne" value={s.lineHeight} min={1.4} max={2.0} step={0.05} format={(v) => v.toFixed(2).replace('.', ',')} onChange={(v) => set({ lineHeight: Math.round(v * 100) / 100 })} />
      <Slider id="typo-measure" label="Largeur du texte" value={s.measure} min={52} max={84} step={2} format={(v) => `${v} ch`} onChange={(v) => set({ measure: v })} />
      <label className="typo-switch-row">
        <span>
          <span className="typo-switch-title">Connecteurs logiques</span>
          <span className="typo-switch-sub">Souligne donc, car, mais, or…</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={s.showConnectors}
          className={`typo-switch ${s.showConnectors ? 'on' : ''}`}
          onClick={() => set({ showConnectors: !s.showConnectors })}
        >
          <span />
        </button>
      </label>
      <label className="typo-switch-row">
        <span>
          <span className="typo-switch-title">Marquer les pages</span>
          <span className="typo-switch-sub">{PAGE_MARK_SUB[pageMarks]}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={pageMarks !== 'off'}
          className={`typo-switch ${pageMarks !== 'off' ? 'on' : ''}`}
          onClick={() => set({ pageMarks: pageMarks === 'off' ? 'paper' : 'off' })}
          data-testid="page-marks-switch"
        >
          <span />
        </button>
      </label>
      {pageMarks !== 'off' && (
        <div className="typo-choices" role="radiogroup" aria-label="Repères de page" data-testid="page-marks-mode">
          {PAGE_MARK_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={pageMarks === m.id}
              className={`typo-choice ${pageMarks === m.id ? 'active' : ''}`}
              onClick={() => set({ pageMarks: m.id })}
              data-mode={m.id}
            >
              <span className={`typo-choice-icon pm-${m.id}`} aria-hidden="true">
                <i />
                <i />
              </span>
              <span className="typo-choice-label">{m.label}</span>
            </button>
          ))}
        </div>
      )}
      {/* Aspect papier — bascule provisoire (l'interface définitive viendra avec le nouveau panneau). */}
      <label className="typo-switch-row">
        <span>
          <span className="typo-switch-title">Aspect papier</span>
          <span className="typo-switch-sub">Grain et teinte d’un vrai papier</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={!!s.paperLook}
          className={`typo-switch ${s.paperLook ? 'on' : ''}`}
          onClick={() => set({ paperLook: !s.paperLook })}
          data-testid="paper-look-switch"
        >
          <span />
        </button>
      </label>
      <div
        className="typo-preview"
        style={{
          fontFamily: s.fontFamily === 'serif' ? 'var(--font-read)' : 'var(--font-ui)',
          fontSize: Math.min(s.fontSize, 18),
          lineHeight: s.lineHeight,
        }}
      >
        <div className="typo-preview-text">
          Je pense, <span className={s.showConnectors ? 'connector' : ''}>donc</span> je suis : cette vérité était si ferme que les suppositions des sceptiques ne pouvaient l’ébranler.
        </div>
      </div>
    </div>,
    document.body,
  );
}
