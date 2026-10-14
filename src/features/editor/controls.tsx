// Petits contrôles partagés par la barre d'outils et la barre flottante.
import { useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover, usePop } from './Popover';
import { FONT_SIZES } from './engine';

/** Raccourcis affichés dans les infobulles et les menus. */
export const KEYS = {
  bold: '⌘B',
  italic: '⌘I',
  underline: '⌘U',
  strike: '⌘⇧X',
  superscript: '⌘.',
  subscript: '⌘,',
  clear: '⌘\\',
  bigger: '⌘⇧>',
  smaller: '⌘⇧<',
  left: '⌘L',
  center: '⌘E',
  right: '⌘R',
  justify: '⌘J',
  bullet: '⌘⇧8',
  ordered: '⌘⇧7',
  link: '⌘⇧K',
  pageBreak: '⌘↩',
  footnote: '⌘⌥F',
  h1: '⌘⌥1',
  h2: '⌘⌥2',
  h3: '⌘⌥3',
  body: '⌘⌥0',
  undo: '⌘Z',
  redo: '⌘⇧Z',
} as const;

export const tip = (label: string, key?: string) => (key ? `${label} (${key})` : label);

/** Empêche le bouton de prendre le focus (la sélection du document reste active). */
export const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export function TbButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
  className = '',
  ...rest
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  className?: string;
  [k: `data-${string}`]: string | undefined;
}) {
  return (
    <button
      className={`icon-btn sm ed-tb-btn ${active ? 'active' : ''} ${className}`}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onClick}
      title={tip(label, shortcut)}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Ligne de menu : icône, libellé, raccourci, coche. */
export function MenuRow({
  icon,
  label,
  shortcut,
  checked,
  disabled,
  onClick,
  className = '',
  style,
  ...rest
}: {
  icon?: ReactNode;
  label: ReactNode;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  style?: React.CSSProperties;
  [k: `data-${string}`]: string | undefined;
}) {
  return (
    <button
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked === undefined ? undefined : checked}
      className={`menu-item ed-mrow ${className}`}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onClick}
      style={style}
      {...rest}
    >
      <span className="ed-mrow-check">{checked && <Check size={13} />}</span>
      {icon && <span className="ed-mrow-icon">{icon}</span>}
      <span className="ed-mrow-label">{label}</span>
      {shortcut && <span className="ed-mrow-key">{shortcut}</span>}
    </button>
  );
}

// ── Couleurs (palettes sobres) ──
export const TEXT_COLORS: { label: string; hex: string | null }[] = [
  { label: 'Automatique', hex: null },
  { label: 'Noir', hex: '#000000' },
  { label: 'Gris anthracite', hex: '#3F3F3F' },
  { label: 'Gris', hex: '#7F7F7F' },
  { label: 'Bordeaux', hex: '#7A1F1F' },
  { label: 'Rouge brique', hex: '#B03A2E' },
  { label: 'Ocre', hex: '#9C6B12' },
  { label: 'Vert sapin', hex: '#2F6B3A' },
  { label: 'Bleu encre', hex: '#1F4E9A' },
  { label: 'Bleu nuit', hex: '#1B2A4A' },
  { label: 'Violet', hex: '#5B3A8C' },
];
export const HIGHLIGHTS: { label: string; hex: string | null }[] = [
  { label: 'Aucun', hex: null },
  { label: 'Jaune pâle', hex: '#FFF2A8' },
  { label: 'Vert pâle', hex: '#D8EFC8' },
  { label: 'Bleu pâle', hex: '#CFE3F7' },
  { label: 'Rose pâle', hex: '#F7D4DC' },
  { label: 'Orange pâle', hex: '#FBE0C3' },
  { label: 'Gris clair', hex: '#E4E4E4' },
];

const same = (a: string | null, b: string | null) => (a ?? '').toUpperCase() === (b ?? '').toUpperCase();

export function Swatches({
  colors,
  value,
  onPick,
  kind,
}: {
  colors: { label: string; hex: string | null }[];
  value: string | null;
  onPick: (hex: string | null) => void;
  kind: 'text' | 'highlight';
}) {
  return (
    <div className="ed-swatches" role="radiogroup" aria-label={kind === 'text' ? 'Couleur du texte' : 'Surlignage'}>
      {colors.map((c) => (
        <button
          key={c.label}
          role="radio"
          aria-checked={same(value, c.hex)}
          className={`ed-swatch ${c.hex ? '' : 'none'} ${same(value, c.hex) ? 'on' : ''}`}
          style={c.hex ? ({ '--sw': c.hex } as React.CSSProperties) : undefined}
          title={c.label}
          aria-label={c.label}
          onMouseDown={keepFocus}
          onClick={() => onPick(c.hex)}
          data-color={c.hex ?? 'none'}
        >
          {!c.hex && <span className="ed-swatch-none" />}
        </button>
      ))}
    </div>
  );
}

/** Bouton + palette (couleur du texte ou surlignage). */
export function ColorButton({
  kind,
  value,
  disabled,
  onPick,
  icon,
}: {
  kind: 'text' | 'highlight';
  value: string | null;
  disabled?: boolean;
  onPick: (hex: string | null) => void;
  icon: ReactNode;
}) {
  const pop = usePop();
  const label = kind === 'text' ? 'Couleur du texte' : 'Surlignage';
  const bar = value ?? (kind === 'text' ? 'var(--ink)' : 'transparent');
  return (
    <>
      <button
        className={`icon-btn sm ed-tb-btn ed-color-btn ${pop.isOpen ? 'active' : ''}`}
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={(e) => pop.toggle(e.currentTarget)}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        data-tb={kind === 'text' ? 'color' : 'highlight'}
      >
        {icon}
        <span className="ed-color-bar" style={{ background: bar }} />
      </button>
      <Popover pop={pop} label={label} className="ed-menu ed-color-menu">
        <div className="ed-pop-title">{label}</div>
        <Swatches
          kind={kind}
          colors={kind === 'text' ? TEXT_COLORS : HIGHLIGHTS}
          value={value}
          onPick={(hex) => {
            pop.close();
            onPick(hex);
          }}
        />
        {kind === 'highlight' && <p className="ed-pop-note">Pour le brouillon : à retirer avant de rendre le travail.</p>}
      </Popover>
    </>
  );
}

const fmtPt = (n: number) => String(n).replace('.', ',');

/** Taille : champ éditable (8–72 proposés, saisie libre de 1 à 400) + liste. */
export function SizeControl({ value, disabled, onPick }: { value: number | null; disabled?: boolean; onPick: (pt: number) => void }) {
  const pop = usePop();
  const [text, setText] = useState(value ? fmtPt(value) : '');
  useEffect(() => setText(value ? fmtPt(value) : ''), [value]);
  const commit = () => {
    const n = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(n) && n >= 1 && n <= 400) onPick(Math.round(n * 2) / 2);
    else setText(value ? fmtPt(value) : '');
  };
  return (
    <div className={`ed-size ${disabled ? 'disabled' : ''}`} title={`Taille (${KEYS.bigger} / ${KEYS.smaller})`}>
      <input
        className="ed-size-input"
        value={text}
        disabled={disabled}
        inputMode="decimal"
        aria-label="Taille de police (points)"
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(value ? fmtPt(value) : '');
            (e.target as HTMLInputElement).blur();
          }
        }}
        data-tb="size"
      />
      <button className="ed-size-more" disabled={disabled} onMouseDown={keepFocus} onClick={(e) => pop.toggle(e.currentTarget.parentElement as HTMLElement)} aria-label="Tailles proposées" aria-haspopup="listbox">
        <ChevronDown size={12} />
      </button>
      <Popover pop={pop} label="Taille" className="ed-menu ed-size-menu">
        <div role="listbox" aria-label="Tailles">
          {FONT_SIZES.filter((s) => s >= 8 && s <= 72).map((s) => (
            <MenuRow
              key={s}
              label={fmtPt(s)}
              checked={value === s}
              onClick={() => {
                pop.close();
                onPick(s);
              }}
              data-size={String(s)}
            />
          ))}
        </div>
      </Popover>
    </div>
  );
}

/** Champ numérique compact (cm, pt…) validé à la sortie ou à Entrée. */
export function NumField({
  label,
  value,
  unit,
  min,
  max,
  step = 0.1,
  onCommit,
  name,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step?: number;
  onCommit: (v: number) => void;
  name?: string;
}) {
  const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const n = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(n) && n >= min && n <= max) {
      if (Math.abs(n - value) > 1e-9) onCommit(n);
    } else setText(fmt(value));
  };
  return (
    <label className="ed-num">
      <span className="ed-num-label">{label}</span>
      <span className="ed-num-box">
        <input
          value={text}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const n = Math.min(max, Math.max(min, (parseFloat(text.replace(',', '.')) || 0) + (e.key === 'ArrowUp' ? step : -step)));
              setText(fmt(n));
              onCommit(Math.round(n * 100) / 100);
            }
          }}
          aria-label={`${label} (${unit})`}
          data-field={name}
        />
        <span className="ed-num-unit">{unit}</span>
      </span>
    </label>
  );
}
